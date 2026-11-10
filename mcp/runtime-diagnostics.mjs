import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {clipArgumentName,describeArgumentKeys} from './argument-diagnostics.mjs';

// Design references: rvt-mcp HealthTools/ToolArgumentGuard and RevitMCP ResultStore.
// Independent implementation: strict arguments and this project's native boundary are retained.
const name=z.string().min(1).max(200).refine(s=>s.trim().length>0);
const names=z.array(name).max(64).refine(a=>new Set(a).size===a.length);
const mvid=z.string().uuid();
export const runtimeDiagnosticOptionsSchema=z.object({
 expectedMvid:mvid.optional(),requiredFeatures:names.default([]),requiredWorkflows:names.default([]),
 requireActiveDocument:z.boolean().default(false),
 observationScope:z.enum(['fresh-sdk-process','current-connected-mcp']).default('fresh-sdk-process')
}).strict();
const pluginSchema=z.object({protocol:z.literal('revit-auto-2027-v2'),moduleVersionId:mvid,
 pid:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),features:z.array(name).max(512)
 .refine(a=>new Set(a).size===a.length)}).passthrough();
const documentSchema=z.object({title:z.string(),path:z.string(),identity:name,
 revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),isFamilyDocument:z.boolean(),
 isModified:z.boolean(),isReadOnly:z.boolean()}).passthrough();
const scopeSchema=z.object({ownerFamilyAvailable:z.boolean(),documentTitle:z.string(),familyName:z.string().nullable(),
 categoryId:z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).nullable()}).strict();
const catalogSchema=z.object({workflows:z.array(z.object({workflowId:name,enabled:z.boolean()}).passthrough()).max(1000)
 .refine(a=>new Set(a.map(w=>w.workflowId)).size===a.length)}).passthrough();
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function assessRuntimeDiagnostic(observations,options={}){
 const opts=runtimeDiagnosticOptionsSchema.parse(options),issues=[];
 const add=(code,message,expected,observed,nextAction)=>issues.push({code,message,expected,observed,nextAction,automaticRetryAllowed:false});
 const {pluginBefore,pluginAfter,context,workflowCatalog,serverInfo,toolCount,errors=[]}=observations;
 const plugin=pluginSchema.safeParse(pluginBefore),last=pluginSchema.safeParse(pluginAfter);
 const bindingVerified=plugin.success&&last.success&&pluginBefore.pid===pluginAfter.pid&&
  pluginBefore.moduleVersionId===pluginAfter.moduleVersionId&&isDeepStrictEqual(pluginBefore.features,pluginAfter.features);
 if(!plugin.success)add('NATIVE_IDENTITY_UNAVAILABLE','No complete compatible plugin identity was observed.',
  'protocol, moduleVersionId, pid and capabilities',null,'Check the bridge connection and the selected Revit process.');
 else if(!bindingVerified)add('NATIVE_IDENTITY_CHANGED_OR_UNVERIFIED','Plugin identity changed or could not be rechecked.',
  {mvid:pluginBefore.moduleVersionId,pid:pluginBefore.pid},last.success?{mvid:pluginAfter.moduleVersionId,pid:pluginAfter.pid}:null,
  'Re-observe the selected process; do not execute a model plan from this report.');
 if(plugin.success&&opts.expectedMvid&&pluginBefore.moduleVersionId.toLowerCase()!==opts.expectedMvid.toLowerCase())
  add('PLUGIN_MODULE_MISMATCH','The loaded DLL differs from the requested build.',opts.expectedMvid,pluginBefore.moduleVersionId,
   'Check the registered DLL and listening process. Manually restart the intended Revit process only when needed.');
 const featureChecks=opts.requiredFeatures.map(feature=>({name:feature,available:plugin.success?pluginBefore.features.includes(feature):null}));
 for(const check of featureChecks)if(check.available===false)add('NATIVE_FEATURE_MISSING','The loaded plugin lacks a required capability.',check.name,null,
  'Load the separately approved build containing this capability before calling it.');
 const catalog=catalogSchema.safeParse(workflowCatalog);
 if(!catalog.success)add('MCP_CATALOG_UNAVAILABLE','The observed MCP workflow catalog is missing or malformed.',
  'unique enabled workflow identifiers',null,'Check this MCP connection; a fresh SDK process does not prove that the current chat reloaded.');
 const workflowChecks=opts.requiredWorkflows.map(id=>({name:id,available:catalog.success?
  workflowCatalog.workflows.some(w=>w.workflowId===id&&w.enabled):null}));
 for(const check of workflowChecks)if(check.available===false)add('MCP_WORKFLOW_MISSING','The observed MCP connection lacks the required enabled workflow.',
  check.name,null,'Reconnect this MCP connection and check its workflow catalog; this alone does not require restarting Revit.');
 let doc=null,familyScope=null,documentState='unknown';
 if(context?.active===false){documentState='none';if(opts.requireActiveDocument)add('NO_ACTIVE_DOCUMENT','No active document was observed.',
  'an explicitly reviewed document',null,'Manually open the intended document; this diagnostic does not open it.');}
 else if(context?.active===true&&documentSchema.safeParse(context.document).success){
  const d=context.document;documentState=d.isFamilyDocument?'family':'project';
  doc={title:d.title,path:d.path,identity:d.identity,revision:d.revision,isFamilyDocument:d.isFamilyDocument,isModified:d.isModified,isReadOnly:d.isReadOnly};
  if(d.isFamilyDocument){
   const s=scopeSchema.safeParse(context.familyDocumentScope);
   if(s.success&&s.data.documentTitle===d.title){familyScope=s.data;
    if(!s.data.ownerFamilyAvailable||s.data.familyName===null||s.data.familyName.length>200||
       (s.data.familyName!==''&&!s.data.familyName.trim())||s.data.categoryId===null||
       (s.data.familyName===''&&(!s.data.documentTitle.trim()||s.data.documentTitle.length>200)))
     add('FAMILY_SCOPE_INCOMPLETE','The native family scope cannot satisfy an exact family request.',
      'available native owner, known exact name, usable title and known category',familyScope,'Retain the unknown values and inspect the native scope; do not infer the owner name from the document title.');
    else if(s.data.familyName===''&&plugin.success&&!pluginBefore.features.includes('family-text-known-empty-owner'))
     add('FAMILY_QUERY_CONTRACT_UNSUPPORTED','The owner name is known empty; this plugin cannot yet query that title-bound scope.',
      'family-text-known-empty-owner',familyScope,'Load the separately approved known-empty-owner query build; preserve the empty name and bind the exact document title.');
   }else add('FAMILY_SCOPE_UNAVAILABLE','This family context does not expose consistent native owner metadata.',
    'familyDocumentScope with matching documentTitle',null,'Use the approved metadata build; do not guess the family name or repeatedly submit the refused query.');
  }
 }else add('DOCUMENT_CONTEXT_UNAVAILABLE','The active document context is incomplete.',
  'native identity, revision, document kind and state',null,'Inspect the context error before requesting a model operation.');
 for(const error of errors)add('OBSERVATION_FAILED','A diagnostic read failed.',error.stage,
  {code:typeof error.code==='string'?error.code:null,message:typeof error.message==='string'?error.message.slice(0,500):null},
  'Review this failed read; this report never retries a call.');
 const catalogRows=catalog.success?workflowCatalog.workflows.map(w=>({id:w.workflowId,enabled:w.enabled})).sort((a,b)=>a.id.localeCompare(b.id)):null;
 return {schemaVersion:1,status:issues.length?'attention-required':'observed',observationScope:opts.observationScope,
  currentChatConnectionVerified:opts.observationScope==='current-connected-mcp'&&catalog.success&&workflowChecks.every(c=>c.available===true),
  plugin:plugin.success?{protocol:pluginBefore.protocol,version:pluginBefore.version??null,informationalVersion:pluginBefore.informationalVersion??null,
   moduleVersionId:pluginBefore.moduleVersionId,pid:pluginBefore.pid,revitVersion:pluginBefore.revitVersion??null,
   revitBuild:pluginBefore.revitBuild??null,bindingVerified,expectedMvid:opts.expectedMvid??null,featureChecks}:null,
  mcp:{serverInfo:serverInfo&&typeof serverInfo.name==='string'&&typeof serverInfo.version==='string'?
   {name:serverInfo.name,version:serverInfo.version}:null,toolCount:Number.isSafeInteger(toolCount)&&toolCount>=0?toolCount:null,
   workflowCount:catalogRows?.length??null,workflowCatalogSha256:catalogRows?sha(catalogRows):null,workflowChecks},
  documentState,document:doc,familyDocumentScope:familyScope,issues,
  observationOnly:true,writeAuthorization:false,nativeAcceptanceCertified:false,
  actionCounters:{modelWritesRequested:0,planCreateCalls:0,confirmCalls:0,saveCalls:0,restartCalls:0,documentOpenCloseCalls:0,familyLoadCalls:0}};
}

export async function probeRuntimeDiagnostic({nativeCall,toolCall,serverInfo,toolCount,signal,...options}){
 const opts=runtimeDiagnosticOptionsSchema.parse(options),errors=[],calls=[];
 const read=async(stage,fn)=>{signal?.throwIfAborted();calls.push(stage);try{const value=await fn();signal?.throwIfAborted();return value;}
  catch(e){signal?.throwIfAborted();errors.push({stage,code:e.code??null,message:e.message});return undefined;}};
 const pluginBefore=await read('native-info-before',()=>nativeCall('revit.bridge.info',{},signal));
 const workflowCatalog=await read('mcp-workflows',()=>toolCall('revit_workflow_list',{},signal));
 const context=pluginSchema.safeParse(pluginBefore).success?
  await read('native-context',()=>toolCall('revit_context_get',{},signal)):undefined;
 const pluginAfter=pluginBefore?await read('native-info-after',()=>nativeCall('revit.bridge.info',{},signal)):undefined;
 const observations={pluginBefore,pluginAfter,context,workflowCatalog,serverInfo,toolCount,errors};
 return {report:assessRuntimeDiagnostic(observations,opts),evidence:{...observations,calls,observedAtUtc:new Date().toISOString()}};
}

export function parseRuntimeDiagnosticArgs(args){
 const options={requiredFeatures:[],requiredWorkflows:[]};let evidence=false;
 const expected=['--expected-mvid','--require-feature','--require-workflow','--require-active-document','--evidence'];
 const received=[];
 const invalid=(message,extra={})=>Object.assign(new Error(message),{code:'invalid_diagnostic_arguments',
  details:{invalid_arguments:describeArgumentKeys(received,expected),...extra}});
 for(let i=0;i<args.length;i++){
  const flag=args[i],key=/^--[a-z][a-z0-9_-]*$/i.test(flag)?flag:'<positional-or-invalid-option>';received.push(key);
  if(flag==='--evidence'){if(evidence)throw invalid('Duplicate --evidence.',{duplicate:'--evidence'});evidence=true;continue;}
  if(flag==='--require-active-document'){if(options.requireActiveDocument)throw invalid('Duplicate --require-active-document.',{duplicate:flag});options.requireActiveDocument=true;continue;}
  if(!['--expected-mvid','--require-feature','--require-workflow'].includes(flag))
   throw invalid('Unknown diagnostic option: '+clipArgumentName(key));
  const value=args[++i];if(!value||value.startsWith('--'))throw invalid('Missing value for '+flag,{missingValueFor:flag});
  if(flag==='--expected-mvid'){if(options.expectedMvid)throw invalid('Duplicate --expected-mvid.',{duplicate:flag});options.expectedMvid=value;}
  else options[flag==='--require-feature'?'requiredFeatures':'requiredWorkflows'].push(value);
 }
 const parsed=runtimeDiagnosticOptionsSchema.safeParse(options);
 if(!parsed.success)throw invalid('Invalid diagnostic option values.',{valueErrors:parsed.error.issues.map(i=>({field:i.path.join('.'),code:i.code,message:i.message}))});
 return {options:parsed.data,evidence};
}
