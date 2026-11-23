import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { buildStallReceipt, classifyRevitBridgeStall, inspectRevitHostState } from './stall-recovery.mjs';
const runtime = path.resolve(import.meta.dirname,'..','runtime','bridge.json');
// Adapted from rvt-mcp ToolGateway.TransportGrace (e49c796, Apache-2.0).
// The native deadline stays authoritative; let its structured receipt arrive before the transport gives up.
const TRANSPORT_GRACE_MS = 5000;
const READONLY_RETRY_DELAY_MS = 150;
const READONLY_NATIVE_METHODS = new Set([
  'revit.audit.run', 'revit.changes.get', 'revit.collision.check', 'revit.connector.resolve',
  'revit.context.get', 'revit.electrical.audit', 'revit.element.dependencies', 'revit.element.storage_schemas', 'revit.document.version_diff',
  'revit.family.library.get', 'revit.family.text_notes', 'revit.flow.diagnose', 'revit.inspect', 'revit.room.get', 'revit.material.quantities',
  'revit.links.list', 'revit.links.elements', 'revit.schedule.data', 'revit.mep.disconnects',
  'revit.saved.verify', 'revit.search', 'revit.sheet.layout', 'revit.stairs.connections', 'revit.type.resolve', 'revit.view.get'
]);
const SAFE_READONLY_RETRY_METHODS = new Set([...READONLY_NATIVE_METHODS, 'revit.plan.get']);
const WRITE_COMMIT_METHODS = new Set(['revit.plan.confirm', 'revit.import.commit']);
let cachedReadOnlyBridgeInfo;
let cachedReadOnlyBridgeInfoExpiresAt = 0;
let lastKnownRevitPid = null;

function requireFeatures(info,required){
  const missing=required.filter(feature=>!Array.isArray(info?.features)||!info.features.includes(feature));
  if(missing.length){const error=new Error('The loaded plugin lacks required read capabilities: '+missing.join(', ')+'. No target query was sent.');
    error.code='feature_not_loaded';error.details={requiredFeatures:missing,loadedVersion:info.version};throw error;}
}

// Internal dispatch requirements never become native request parameters.
export async function callRevit(method,params = {},signal,{requiredFeatures=[],inspectHostState=inspectRevitHostState,probeTimeoutMs=2000}={}) {
  if(!Array.isArray(requiredFeatures)||requiredFeatures.length>64||requiredFeatures.some(f=>typeof f!=='string'||!f.trim()||f.length>200))
    throw Object.assign(new Error('Invalid internal requiredFeatures.'),{code:'invalid_required_features'});
  if(method==='revit.inspect'&&params.includeBounds===true)
    requiredFeatures=[...new Set([...requiredFeatures,'element-bounds-snapshot'])];
  if(method==='revit.material.quantities')
    requiredFeatures=[...new Set([...requiredFeatures,'readonly-material-quantities'])];
  if(['revit.links.list','revit.links.elements'].includes(method))
    requiredFeatures=[...new Set([...requiredFeatures,'readonly-links-audit'])];
  if(method==='revit.schedule.data')
    requiredFeatures=[...new Set([...requiredFeatures,'readonly-schedule-data'])];
  if(method==='revit.mep.disconnects')
    requiredFeatures=[...new Set([...requiredFeatures,'readonly-mep-disconnects'])];
  if (method === 'revit.bridge.info') {const info=await exchange(method,params,signal);if(Number.isInteger(info?.pid)&&info.pid>0)lastKnownRevitPid=info.pid;requireFeatures(info,requiredFeatures);return info;}
  // Explicit safety requirements use fresh host evidence, including when a caller enabled the optional cache.
  const cacheMs = READONLY_NATIVE_METHODS.has(method)&&requiredFeatures.length===0
    ? Math.max(0, Math.min(600000, Number(process.env.REVIT_AI_READONLY_BRIDGE_INFO_CACHE_MS) || 0))
    : 0;
  if (!cacheMs) {
    cachedReadOnlyBridgeInfo = undefined;
    cachedReadOnlyBridgeInfoExpiresAt = 0;
  }
  const info = cacheMs && cachedReadOnlyBridgeInfo && Date.now() < cachedReadOnlyBridgeInfoExpiresAt
    ? cachedReadOnlyBridgeInfo
    : await exchange('revit.bridge.info',{},signal);
  if (Number.isInteger(info?.pid) && info.pid > 0) lastKnownRevitPid = info.pid;
  if (cacheMs && info !== cachedReadOnlyBridgeInfo) {
    cachedReadOnlyBridgeInfo = info;
    cachedReadOnlyBridgeInfoExpiresAt = Date.now() + cacheMs;
  }
  if (info.protocol !== 'revit-auto-2027-v2') throw new Error('An old or incompatible Revit add-in is still running. Save your project and restart Revit. Writes are blocked before sending any model operation.');
  requireFeatures(info,requiredFeatures);
  const requiredFeature = {'revit.changes.get':'document-change-history','revit.room.get':'room-boundaries','revit.type.resolve':'native-type-resolver','revit.view.export_image':'view-image-export','revit.view.export_images':'batch-view-image-export','revit.view.get':'view-settings','revit.connector.resolve':'connector-resolution','revit.audit.run':'mechanical-port-audit-tristate','revit.electrical.audit':'electrical-circuit-audit','revit.collision.check':'collision-check','revit.flow.diagnose':'flow-direction-diagnostic','revit.external_asset.metadata':'external-family-metadata-audit','revit.family.library.get':'controlled-family-loading','revit.family.text_notes':'family-text-notes','revit.element.dependencies':'bounded-element-dependencies','revit.stairs.connections':'native-stair-connections','revit.element.storage_schemas':'element-storage-schema-audit','revit.document.version_diff':'document-version-diff','revit.sheet.layout':'sheet-layout-diagnostics',...Object.fromEntries(['prepare','get','verify_scope','save_once','post_exit_once','open_saved_copy_once','stop'].map(action=>['revit.lifecycle.'+action,'local-test-copy-lifecycle']))}[method];
  if (requiredFeature && !info.features?.includes(requiredFeature)) {
    const error=new Error(method==='revit.stairs.connections' ? 'The loaded Revit plugin lacks native-stair-connections. Load the separately approved stair-query build before using this read-only tool. No model write was requested.' : 'The running Revit plugin does not yet expose '+method+'. Save your work and restart Revit to load v0.4.0. No model write was requested.');
    error.code='feature_not_loaded';error.details={requiredFeatures:[requiredFeature],loadedVersion:info.version};throw error;
  }
  if(method==='revit.family.text_notes'&&(Object.hasOwn(params,'afterNoteId')||Object.hasOwn(params,'boundsViewId')))
    requireFeatures(info,['family-text-pagination-view-bounds']);
  if(method==='revit.family.text_notes'&&params.familyName===''&&!info.features?.includes('family-text-known-empty-owner')){
    const error=new Error('The loaded plugin lacks title-bound known-empty family owner support. Load the separately approved build; no family query was sent.');
    error.code='feature_not_loaded';error.details={requiredFeatures:['family-text-known-empty-owner'],loadedVersion:info.version};throw error;
  }
  if (['revit.plan.confirm','revit.import.commit'].includes(method) && info.confirmationMode !== 'chat') {
    const error = new Error('Revit is still running a version that requires a second confirmation dialog. Save your work and restart Revit to load chat-only confirmation. No write was sent.');
    error.code = 'confirmation_mode_mismatch';
    throw error;
  }
  if (method==='revit.plan.create') {
    const required=[];
    if(params.operations?.some(op=>op.operationType==='duplicate_architecture_type'))required.push('architecture-type-copy');
    if(params.operations?.some(op=>op.operationType==='create_structural_column'))required.push('controlled-structural-columns');
    if(params.operations?.some(op=>['create_structural_beam','create_isolated_foundation'].includes(op.operationType)))required.push('controlled-structural-elements');
    if(params.operations?.some(op=>op.operationType==='create_wall_foundation'))required.push('controlled-wall-foundation');
    if(params.operations?.some(op=>['create_rebar_set','create_rebar_stirrup'].includes(op.operationType)))required.push('controlled-rebar-creation');
    if(params.operations?.some(op=>op.operationType==='create_ceiling'))required.push('controlled-ceiling-creation');
    if(params.operations?.some(op=>op.operationType==='create_material'||op.operationType==='duplicate_material'))required.push('controlled-material-creation');
    if(params.operations?.some(op=>op.operationType==='assign_material'))required.push('controlled-material-assignment');
    if(params.operations?.some(op=>op.operationType==='create_footprint_roof'))required.push('controlled-roof-creation');
    if(params.operations?.some(op=>['create_text_note','create_detail_line'].includes(op.operationType)))required.push('controlled-2d-annotations');
    if(params.operations?.some(op=>['create_cable_tray','create_conduit'].includes(op.operationType)))required.push('controlled-electrical-runs');
    if(params.operations?.some(op=>op.operationType==='create_grid'))required.push('explicit-grid-geometry');
    if(params.operations?.some(op=>op.operationType==='create_room'))required.push('room-creation-readback');
    if(params.operations?.some(op=>op.operationType==='change_titleblock_type'))required.push('controlled-titleblock-change');
    if(params.operations?.some(op=>op.operationType==='load_family'))required.push('controlled-family-loading','family-catalog-snapshot');
    if(params.operations?.some(op=>op.operationType==='create_stair'))required.push('controlled-stairs-edit-scope','explicit-stair-geometry');
    if(params.operations?.some(op=>['connect_elements','create_fitting'].includes(op.operationType)&&['first','second','third','fourth'].some(side=>Object.hasOwn(op,side+'Connector'))))required.push('connector-criteria-connections');
    if(params.operations?.some(op=>op.operationType==='create_fitting'&&!['tee','cross'].includes(op.fittingType)))required.push('fitting-connection-readback');
    if(params.operations?.some(op=>op.operationType==='create_fitting'&&['tee','cross'].includes(op.fittingType)))required.push('multiport-fitting-readback');
    if(params.operations?.some(op=>op.operationType==='connect_elements'&&op.allowUnassignedEquipmentPort===true))required.push('known-unassigned-equipment-connection');
    if(params.operations?.some(op=>op.operationType==='configure_view'))required.push('view-configuration');
    if(params.operations?.some(op=>op.operationType==='move_drawing_placement'))required.push('drawing-placement-move');
    if(params.operations?.some(op=>op.operationType==='move_lighting_fixtures'))required.push('controlled-lighting-move');
    if(params.operations?.some(op=>op.operationType==='move_viewport_label'))required.push('viewport-label-offset');
    if(params.operations?.some(op=>op.operationType==='configure_view'&&Object.hasOwn(op,'cropBounds')))required.push('explicit-crop-bounds');
    if(params.operations?.some(op=>op.placementMode==='legacyPoint'))required.push('legacy-point-placement');
    if(params.operations?.some(op=>op.operationType==='create_panel_schedule'&&op.name!==undefined))required.push('panel-schedule-naming');
    if(params.operations?.some(op=>op.operationType==='create_opening'))required.push('native-opening');
    if(params.operations?.some(op=>op.operationType==='create_tag'&&Object.hasOwn(op,'leader')))required.push('tag-leader-readback');
    if(params.operations?.some(op=>op.operationType==='create_tag'))required.push('tag-target-readback');
    if(params.operations?.some(op=>op.operationType==='create_dimension'))required.push('dimension-creation-readback');
    if(params.operations?.some(op=>['create_tag','create_dimension'].includes(op.operationType)))required.push('annotation-input-contracts');
    const missing=required.filter(feature=>!info.features?.includes(feature));
    if(missing.length){const error=new Error('The running plugin lacks '+missing.join(', ')+'. Save your work and restart Revit to load the staged plugin. No model plan was created or submitted.');error.code='feature_not_loaded';error.details={requiredFeatures:missing,loadedVersion:info.version};throw error;}
  }
  return executeWithStallRecovery(method, params, signal, { observedPid: info?.pid ?? lastKnownRevitPid, inspectHostState, probeTimeoutMs });
}

function waitBounded(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(Object.assign(new Error('Cancelled during backoff.'), { code: 'bridge_cancelled' })); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(Object.assign(new Error('Cancelled during backoff.'), { code: 'bridge_cancelled' })); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function executeWithStallRecovery(method, params, signal, { observedPid = null, inspectHostState = inspectRevitHostState, probeTimeoutMs = 2000 } = {}) {
  const canRetryReadOnly = SAFE_READONLY_RETRY_METHODS.has(method);
  const planId = typeof params?.planId === 'string' && params.planId.trim() && params.planId.length <= 200 ? params.planId : undefined;
  let readOnlyRetried = false;

  try {
    return await exchange(method, params, signal);
  } catch (firstError) {
    let error = firstError;

    // Layer 3a: Safe single bounded reconnect retry for transient mid-flight disconnects on read-only methods ONLY.
    // Never auto-retry write methods, timeouts, cancellations, or native rejections.
    if (canRetryReadOnly && error?.code === 'bridge_connection_closed' && !signal?.aborted) {
      readOnlyRetried = true;
      try {
        await waitBounded(READONLY_RETRY_DELAY_MS, signal);
        return await exchange(method, params, signal);
      } catch (retryError) {
        error = retryError;
      }
    }

    // Layer 3b: On bridge_timeout (actual stall), run fast read-only liveness + host modal dialog probe
    // and, for write commits, read-only revit.plan.get state verification (never re-submitting writes).
    if (error?.code === 'bridge_timeout' && !signal?.aborted) {
      const recoveryActions = readOnlyRetried ? ['readonly_bridge_reconnect_retry'] : [];
      let bridgeAlive = false;
      let pid = Number.isInteger(observedPid) && observedPid > 0 ? observedPid : lastKnownRevitPid;

      recoveryActions.push('bridge_liveness_probe');
      try {
        const probeInfo = await exchange('revit.bridge.info', {}, signal, { timeoutOverrideMs: Math.min(2000, probeTimeoutMs), skipGrace: true });
        bridgeAlive = probeInfo?.protocol === 'revit-auto-2027-v2';
        if (Number.isInteger(probeInfo?.pid) && probeInfo.pid > 0) {
          pid = probeInfo.pid;
          lastKnownRevitPid = pid;
        }
      } catch {
        bridgeAlive = false;
      }

      let hostState = null;
      if (typeof inspectHostState === 'function') {
        try {
          hostState = await inspectHostState({ pid, timeoutMs: Math.min(2000, probeTimeoutMs) });
          if (hostState?.available) recoveryActions.push('revit_host_modal_dialog_probe');
        } catch {
          hostState = { available: false, reason: 'probe_threw' };
        }
      }

      let postTimeoutVerification = null;
      if (WRITE_COMMIT_METHODS.has(method) && planId && bridgeAlive && error?.details?.requestMayHaveBeenSent === true) {
        recoveryActions.push('post_timeout_readonly_plan_verification');
        try {
          const plan = await exchange('revit.plan.get', { planId }, signal, { timeoutOverrideMs: Math.min(2500, probeTimeoutMs), skipGrace: true });
          const observedStatus = typeof plan?.status === 'string' ? plan.status : 'unknown';
          postTimeoutVerification = {
            attempted: true,
            method: 'revit.plan.get',
            planId,
            verified: true,
            observedStatus,
            committed: observedStatus === 'committed'
          };
        } catch (verifyErr) {
          postTimeoutVerification = {
            attempted: true,
            method: 'revit.plan.get',
            planId,
            verified: false,
            errorCode: verifyErr?.code || 'verification_failed'
          };
        }
      }

      const classified = classifyRevitBridgeStall({ code: error.code, bridgeAlive, hostState, method, planId });
      const stallReceipt = buildStallReceipt({
        stallDetected: true,
        stallReason: classified.stallReason,
        autoRecoveryAttempted: true,
        recoveryActions,
        recoveryOutcome: postTimeoutVerification?.verified ? 'verified_state_only' : 'failed',
        automaticRetryAllowed: false,
        nextSafeAction: classified.nextSafeAction,
        hostState: hostState?.available ? hostState : null,
        postTimeoutVerification
      });
      error.details = {
        ...(error.details || {}),
        bridgeAlive,
        stallReceipt
      };
      if (classified.stallReason === 'revit_modal_dialog') {
        error.message = `Revit bridge timed out: Revit UI thread appears blocked by a modal dialog. ${classified.nextSafeAction}`;
      } else if (classified.stallReason === 'revit_process_not_running') {
        error.message = `Revit bridge timed out: Revit process is not running. ${classified.nextSafeAction}`;
      } else if (postTimeoutVerification?.verified) {
        error.message = `Revit bridge timed out on ${method}; read-only verification observed plan "${planId}" status=${postTimeoutVerification.observedStatus}. Never automatically recreate a write.`;
      }
      throw error;
    }

    // For non-timeout transport failures (e.g., bridge_connection_closed / unavailable),
    // attach a synchronous structured stallReceipt without emitting extra TCP calls.
    if (error?.code && ['bridge_connection_closed', 'bridge_connection_unavailable'].includes(error.code)) {
      const classified = classifyRevitBridgeStall({ code: error.code, method, planId });
      error.details = {
        ...(error.details || {}),
        stallReceipt: buildStallReceipt({
          stallDetected: true,
          stallReason: classified.stallReason,
          autoRecoveryAttempted: readOnlyRetried,
          recoveryActions: readOnlyRetried ? ['readonly_bridge_reconnect_retry'] : [],
          recoveryOutcome: 'failed',
          automaticRetryAllowed: false,
          nextSafeAction: classified.nextSafeAction
        })
      };
    }
    throw error;
  }
}

async function exchange(method,params = {},signal,{timeoutOverrideMs=null,skipGrace=false}={}) {
  const settings = JSON.parse((await fs.readFile(process.env.REVIT_AI_CONFIG || runtime,'utf8')).replace(/^\uFEFF/,''));
  const port = Number(settings.port); const token = settings.token;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || typeof token !== 'string' || token.length < 40)
    throw new Error('Invalid bridge settings. Run install-v27.ps1 first.');
  const requestedTimeout=timeoutOverrideMs !== null ? Number(timeoutOverrideMs) : Number(process.env.REVIT_AI_TIMEOUT_MS || 180000);
  if (!Number.isFinite(requestedTimeout)) throw new Error('REVIT_AI_TIMEOUT_MS must be a finite number.');
  const minTimeout = timeoutOverrideMs !== null ? 100 : 1000;
  const timeout = Math.max(minTimeout,Math.min(180000,requestedTimeout));
  const transportBudget = timeout + (skipGrace ? 0 : TRANSPORT_GRACE_MS);
  return new Promise((resolve,reject) => {
    const requestId = randomUUID();
    let requestMayHaveBeenSent = false;
    const transportError = (code,message) => {
      const planId = typeof params.planId === 'string' && params.planId.trim() && params.planId.length <= 200 ? params.planId : undefined;
      return Object.assign(new Error(message),{code,details:{
        method,requestId,requestMayHaveBeenSent,
        executionOutcome:requestMayHaveBeenSent?'unknown':'not_sent',
        automaticRetryAllowed:false,
        ...(planId?{planId}:{}),
        recovery:requestMayHaveBeenSent&&planId
          ? {method:'revit.plan.get',params:{planId}}
          : {action:'check_existing_bridge_connection_without_model_retry'}
      }});
    };
    if (signal?.aborted) {reject(transportError('bridge_cancelled','MCP request was cancelled before sending.')); return;}
    const socket = net.createConnection({host:'127.0.0.1',port});
    const decoder = new StringDecoder('utf8'); let buffer = ''; let settled = false;
    const cancelled = () => finish(reject,transportError('bridge_cancelled','MCP request cancelled. Query the existing plan to establish its outcome; cancellation is not proof of rollback.'));
    const timer = setTimeout(() => finish(reject,transportError('bridge_timeout',`Revit bridge timed out. Check whether Revit is busy. Do not recreate/retry a write automatically; query revit.plan.get for its status.`)),transportBudget);
    const finish = (callback,value) => {if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort',cancelled); socket.destroy(); callback(value);};
    signal?.addEventListener('abort',cancelled,{once:true});
    socket.on('connect',() => {
      requestMayHaveBeenSent = true;
      socket.write(JSON.stringify({requestId,method,params,token,deadlineUnixMs:Date.now()+timeout})+'\n');
    });
    socket.on('data',chunk => {
      buffer += decoder.write(chunk);
      if (buffer.length > 16*1024*1024) return finish(reject,transportError('bridge_response_too_large','Bridge response exceeds 16 MB. Narrow the search; a lost response does not authorize repeating a write.'));
      const i = buffer.indexOf('\n'); if (i < 0) return;
      try {
        const payload = JSON.parse(buffer.slice(0,i));
        if (payload.protocol !== 'revit-auto-2027-v2') return finish(reject,transportError('bridge_protocol_mismatch','An old/incompatible Revit add-in answered. Verify the original plan status before changing the connection or retrying a write.'));
        if (payload.ok) finish(resolve,payload.result || {});
        else {const error = new Error(payload.error?.message || 'Revit rejected the operation.'); error.code=payload.error?.code; error.details=payload.error?.details; finish(reject,error);}
      } catch(error) {finish(reject,transportError('invalid_bridge_response','Revit returned an unreadable bridge response. Preserve the original plan and query its status.'));}
    });
    socket.on('error',error => finish(reject,transportError('bridge_connection_unavailable',`Revit connection unavailable (${error.code || error.message}). Check the existing Revit bridge connection and preserve the original plan.`)));
    socket.on('end',() => {if (!settled) finish(reject,transportError('bridge_connection_closed','Revit closed the connection before returning a result. Query the existing plan status; never duplicate a possibly committed write.'));});
  });
}
