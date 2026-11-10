import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
const runtime = path.resolve(import.meta.dirname,'..','runtime','bridge.json');
const READONLY_NATIVE_METHODS = new Set([
  'revit.audit.run', 'revit.changes.get', 'revit.collision.check', 'revit.connector.resolve',
  'revit.context.get', 'revit.electrical.audit', 'revit.element.dependencies', 'revit.element.storage_schemas', 'revit.document.version_diff',
  'revit.family.library.get', 'revit.family.text_notes', 'revit.flow.diagnose', 'revit.inspect', 'revit.room.get',
  'revit.saved.verify', 'revit.search', 'revit.sheet.layout', 'revit.stairs.connections', 'revit.type.resolve', 'revit.view.get'
]);
let cachedReadOnlyBridgeInfo;
let cachedReadOnlyBridgeInfoExpiresAt = 0;

function requireFeatures(info,required){
  const missing=required.filter(feature=>!Array.isArray(info?.features)||!info.features.includes(feature));
  if(missing.length){const error=new Error('The loaded plugin lacks required read capabilities: '+missing.join(', ')+'. No target query was sent.');
    error.code='feature_not_loaded';error.details={requiredFeatures:missing,loadedVersion:info.version};throw error;}
}

// Internal dispatch requirements never become native request parameters.
export async function callRevit(method,params = {},signal,{requiredFeatures=[]}={}) {
  if(!Array.isArray(requiredFeatures)||requiredFeatures.length>64||requiredFeatures.some(f=>typeof f!=='string'||!f.trim()||f.length>200))
    throw Object.assign(new Error('Invalid internal requiredFeatures.'),{code:'invalid_required_features'});
  if (method === 'revit.bridge.info') {const info=await exchange(method,params,signal);requireFeatures(info,requiredFeatures);return info;}
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
  if (cacheMs && info !== cachedReadOnlyBridgeInfo) {
    cachedReadOnlyBridgeInfo = info;
    cachedReadOnlyBridgeInfoExpiresAt = Date.now() + cacheMs;
  }
  if (info.protocol !== 'revit-auto-2027-v2') throw new Error('An old or incompatible Revit add-in is still running. Save your project and restart Revit. Writes are blocked before sending any model operation.');
  requireFeatures(info,requiredFeatures);
  const requiredFeature = {'revit.changes.get':'document-change-history','revit.room.get':'room-boundaries','revit.type.resolve':'native-type-resolver','revit.view.export_image':'view-image-export','revit.view.export_images':'batch-view-image-export','revit.view.get':'view-settings','revit.connector.resolve':'connector-resolution','revit.audit.run':'mechanical-port-audit-tristate','revit.electrical.audit':'electrical-circuit-audit','revit.collision.check':'collision-check','revit.flow.diagnose':'flow-direction-diagnostic','revit.family.library.get':'controlled-family-loading','revit.family.text_notes':'family-text-notes','revit.element.dependencies':'bounded-element-dependencies','revit.stairs.connections':'native-stair-connections','revit.element.storage_schemas':'element-storage-schema-audit','revit.document.version_diff':'document-version-diff','revit.sheet.layout':'sheet-layout-diagnostics',...Object.fromEntries(['prepare','get','verify_scope','save_once','post_exit_once','open_saved_copy_once','stop'].map(action=>['revit.lifecycle.'+action,'local-test-copy-lifecycle']))}[method];
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
    if(params.operations?.some(op=>op.operationType==='create_grid'))required.push('explicit-grid-geometry');
    if(params.operations?.some(op=>op.operationType==='create_room'))required.push('room-creation-readback');
    if(params.operations?.some(op=>op.operationType==='change_titleblock_type'))required.push('controlled-titleblock-change');
    if(params.operations?.some(op=>op.operationType==='load_family'))required.push('controlled-family-loading','family-catalog-snapshot');
    if(params.operations?.some(op=>op.operationType==='create_stair'))required.push('controlled-stairs-edit-scope','explicit-stair-geometry');
    if(params.operations?.some(op=>['connect_elements','create_fitting'].includes(op.operationType)&&(Object.hasOwn(op,'firstConnector')||Object.hasOwn(op,'secondConnector'))))required.push('connector-criteria-connections');
    if(params.operations?.some(op=>op.operationType==='configure_view'))required.push('view-configuration');
    if(params.operations?.some(op=>op.operationType==='move_drawing_placement'))required.push('drawing-placement-move');
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
  return exchange(method,params,signal);
}
async function exchange(method,params = {},signal) {
  const settings = JSON.parse((await fs.readFile(process.env.REVIT_AI_CONFIG || runtime,'utf8')).replace(/^\uFEFF/,''));
  const port = Number(settings.port); const token = settings.token;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || typeof token !== 'string' || token.length < 40)
    throw new Error('Invalid bridge settings. Run install-v27.ps1 first.');
  const requestedTimeout=Number(process.env.REVIT_AI_TIMEOUT_MS || 180000);
  if (!Number.isFinite(requestedTimeout)) throw new Error('REVIT_AI_TIMEOUT_MS must be a finite number.');
  const timeout = Math.max(1000,Math.min(180000,requestedTimeout));
  return new Promise((resolve,reject) => {
    if (signal?.aborted) {reject(new Error('MCP request was cancelled.')); return;}
    const socket = net.createConnection({host:'127.0.0.1',port});
    const decoder = new StringDecoder('utf8'); let buffer = ''; let settled = false;
    const cancelled = () => finish(reject,new Error('MCP request cancelled. Revit will skip queued work or roll back uncommitted operations.'));
    const timer = setTimeout(() => finish(reject,new Error(`Revit bridge timed out. Check whether Revit is busy. Do not recreate/retry a write automatically; query revit.plan.get for its status.`)),timeout);
    const finish = (callback,value) => {if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort',cancelled); socket.destroy(); callback(value);};
    signal?.addEventListener('abort',cancelled,{once:true});
    socket.on('connect',() => socket.write(JSON.stringify({requestId:randomUUID(),method,params,token,deadlineUnixMs:Date.now()+timeout})+'\n'));
    socket.on('data',chunk => {
      buffer += decoder.write(chunk);
      if (buffer.length > 16*1024*1024) return finish(reject,new Error('Bridge response exceeds 16 MB. Narrow the search.'));
      const i = buffer.indexOf('\n'); if (i < 0) return;
      try {
        const payload = JSON.parse(buffer.slice(0,i));
        if (payload.protocol !== 'revit-auto-2027-v2') return finish(reject,new Error('An old/incompatible Revit add-in answered. Restart Revit to load the installed safety engine before modeling.'));
        if (payload.ok) finish(resolve,payload.result || {});
        else {const error = new Error(payload.error?.message || 'Revit rejected the operation.'); error.code=payload.error?.code; error.details=payload.error?.details; finish(reject,error);}
      } catch(error) {finish(reject,error);}
    });
    socket.on('error',error => finish(reject,new Error(`Revit connection unavailable (${error.code || error.message}). Start/restart Revit 2027 with the installed add-in and open a project.`)));
    socket.on('end',() => {if (!settled) finish(reject,new Error('Revit closed the connection before returning a result. Query the existing plan status; never duplicate a possibly committed write.'));});
  });
}
