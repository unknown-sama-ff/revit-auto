import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
const runtime = path.resolve(import.meta.dirname,'..','runtime','bridge.json');

export async function callRevit(method,params = {},signal) {
  const info = await exchange('revit.bridge.info',{},signal);
  if (info.protocol !== 'revit-auto-2027-v2') throw new Error('An old or incompatible Revit add-in is still running. Save your project and restart Revit. Writes are blocked before sending any model operation.');
  const requiredFeature = {'revit.changes.get':'document-change-history','revit.room.get':'room-boundaries','revit.type.resolve':'native-type-resolver','revit.view.export_image':'view-image-export','revit.view.get':'view-settings','revit.connector.resolve':'connector-resolution'}[method];
  if (requiredFeature && !info.features?.includes(requiredFeature)) {
    const error=new Error('The running Revit plugin does not yet expose '+method+'. Save your work and restart Revit to load v0.3.17. No model write was requested.');
    error.code='feature_not_loaded';throw error;
  }
  if (['revit.plan.confirm','revit.import.commit'].includes(method) && info.confirmationMode !== 'chat') {
    const error = new Error('Revit is still running a version that requires a second confirmation dialog. Save your work and restart Revit to load chat-only confirmation. No write was sent.');
    error.code = 'confirmation_mode_mismatch';
    throw error;
  }
  if (method==='revit.plan.create') {
    const required=[];
    if(params.operations?.some(op=>['connect_elements','create_fitting'].includes(op.operationType)&&(Object.hasOwn(op,'firstConnector')||Object.hasOwn(op,'secondConnector'))))required.push('connector-criteria-connections');
    if(params.operations?.some(op=>op.operationType==='configure_view'))required.push('view-configuration');
    if(params.operations?.some(op=>op.operationType==='configure_view'&&Object.hasOwn(op,'cropBounds')))required.push('explicit-crop-bounds');
    if(params.operations?.some(op=>op.placementMode==='legacyPoint'))required.push('legacy-point-placement');
    if(params.operations?.some(op=>op.operationType==='create_panel_schedule'&&op.name!==undefined))required.push('panel-schedule-naming');
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

