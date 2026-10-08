import {z} from 'zod';
import {resolvePlanningMode} from './planning-mode.mjs';
import {buildRegisteredWorkflow} from './workflow-adapter.mjs';
import {collisionInputSchema} from './collision-request.mjs';

export const pumpWorkflowIds=['pump_room.build','pump_room.route','pump_room.connect'];
const item=z.record(z.string(),z.unknown());
const items=z.array(item).max(1000);
const shape={clearanceCheck:item.optional()};
const keys={
 'pump_room.build':['equipment','pipes','ducts','fittings','connections','schedules','views','tags','dimensions'],
 'pump_room.route':['routes','connections','tags','dimensions'],
 'pump_room.connect':['connections','tags','dimensions']
};
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
const present=v=>v!==undefined&&v!==null&&v!=='';
const flow=v=>['supply','return','neutral'].includes(v);
function gapsFor(name,input){
 const missing=[];
 const need=(field,question)=>missing.push({field,question});
 const requireField=(row,key,field,question)=>{if(!present(row[key]))need(field,question);};
 const level=(row,prefix)=>{if(!present(row.levelId)&&!present(row.level))need(prefix+'.levelId','请明确 '+prefix+' 的标高 ID 或精确标高名称，不从样板默认取一层。');};
 const point=(value,field)=>{for(const axis of ['xMm','yMm','zMm'])if(!present(value?.[axis]))need(field+'.'+axis,'请明确 '+field+' 的绝对毫米 '+axis+' 坐标，不把未知 Z 填为0。');};
 const flowField=(row,prefix)=>{if(!present(row.flowIntent))need(prefix+'.flowIntent','请明确 '+prefix+' 的 supply/return/neutral 意图；测试文件警告不作为工程设计。');else if(!flow(row.flowIntent))fail('invalid_flow_intent','flowIntent must be supply, return or explicitly neutral.');};
 const connection=(row,prefix)=>{
  flowField(row,prefix);
  for(const side of ['first','second']){
   requireField(row,side+'ElementId',prefix+'.'+side+'ElementId','请明确连接两侧的当前元素 ID，不自动选择设备或接口。');
   const hasId=present(row[side+'ConnectorId']),hasCriteria=present(row[side+'Connector']);
   if(!hasId&&!hasCriteria)need(prefix+'.'+side+'Connector','请核对 '+side+' 端连接器 ID 或 domain/shape/XYZ/tolerance criteria；新元素不能预测 ConnectorId。');
   if(hasId&&hasCriteria)fail('invalid_connector','Each side needs exactly one ConnectorId or connector criteria.');
   if(hasCriteria){const c=row[side+'Connector'];if(!c||typeof c!=='object'||Array.isArray(c))fail('invalid_connector','Connector criteria must be an object.');for(const key of ['domain','shape','toleranceMm'])requireField(c,key,prefix+'.'+side+'Connector.'+key,'请明确连接器条件的 '+key+'。');point(c.point,prefix+'.'+side+'Connector.point');}
  }
 };
 let modelingRows=0;
 for(const key of keys[name]){
  const rows=input[key]||[];if(!['tags','dimensions','views','schedules'].includes(key))modelingRows+=rows.length;
  rows.forEach((row,i)=>{
   const prefix=key+'['+i+']';
   if(key==='equipment'){
    if(!present(row.symbolId)&&!(present(row.family)&&present(row.type)))need(prefix+'.symbolId','请明确设备族类型 ID 或精确 family/type；不自动匹配测试文件。');
    level(row,prefix);point(row.point||row,prefix+'.point');
   }else if(['pipes','ducts','routes'].includes(key)){
    requireField(row,key==='ducts'?'ductTypeId':'pipeTypeId',prefix+'.'+(key==='ducts'?'ductTypeId':'pipeTypeId'),'请明确当前模型中管道/风管类型 ID。');
    requireField(row,'systemTypeId',prefix+'.systemTypeId','请明确系统类型 ID，不能仅根据供回水名称猜测系统分类。');level(row,prefix);flowField(row,prefix);
    if(key!=='ducts'||present(row.diameterMm))requireField(row,'diameterMm',prefix+'.diameterMm','请明确毫米管径，不从水泵或测试管道推断。');
    else for(const key of ['widthMm','heightMm'])requireField(row,key,prefix+'.'+key,'请明确矩形风管的毫米宽、高。');
    if(key==='routes'){
     if(!Array.isArray(row.points)||row.points.length<2)need(prefix+'.points','请提供至少两个明确的路线点；允许AI候选时也必须披露具体点位。');
     else row.points.forEach((p,j)=>point(p,prefix+'.points['+j+']'));
    }else{point(row.start,prefix+'.start');point(row.end,prefix+'.end');}
   }else if(key==='connections'||key==='fittings')connection(row,prefix);
  });
 }
 if(modelingRows===0)need('modelingScope','请明确要放置的设备、路线或连接列表；不把空请求当作建模计划。');
 if(!input.clearanceCheck)need('clearanceCheck','请明确净距检查范围与毫米要求，或明确选择 skip 并说明不检查的原因。');
 return missing;
}
function parseClearance(value){
 if(value.mode==='skip')return z.object({mode:z.literal('skip'),reason:z.string().trim().min(1).max(1000)}).strict().parse(value);
 if(value.mode==='screen_existing')return z.object({mode:z.literal('screen_existing'),...collisionInputSchema.shape,documentIdentity:z.never().optional(),expectedRevision:z.never().optional(),clearanceMm:z.number().finite().min(0).max(10000)}).strict().parse(value);
 fail('invalid_clearance_policy','clearanceCheck.mode must be skip or screen_existing; no engineering clearance is inferred.');
}
export async function previewPumpWorkflow(args,call,signal){
 if(!pumpWorkflowIds.includes(args.name))fail('unknown_workflow','Unsupported pump workflow.');
 const policy=resolvePlanningMode(args.name,args.planningMode,args.assumptions||[]);
 const fields={...shape};for(const key of keys[args.name])fields[key]=items.optional();
 const input=z.object(fields).strict().parse(args.input||{});
 const missingInputs=gapsFor(args.name,input);
 const warnings=['仅验证受控建模输入；flowIntent 是审阅意图，不会设置原生水力流向或证明工程规范。','现有元素净距粗筛不证明新增路线、链接模型或维护净距通过。'];
 const preflight={newGeometryVerified:false};
 const response={workflowId:args.name,requestedPlanningMode:args.planningMode||'ask',planningMode:policy.mode,assumptions:policy.assumptions,candidateOnly:policy.candidateOnly===true,warnings,missingInputs,alternatives:[],reviewNote:policy.reviewNote,preflight};
 if(policy.requiresClarification||missingInputs.length)return {...response,status:'needs_clarification',planningMode:'ask',requiresClarification:true,questions:missingInputs.length?missingInputs.map(g=>g.question):policy.questions,planCreated:false};
 const clearance=parseClearance(input.clearanceCheck);preflight.clearanceCheck=clearance;
 // Build and validate explicit operations before any native reads. Unknown/malformed rows are errors, not defaults.
 const built=buildRegisteredWorkflow(args.name,input);
 const before=await call('revit.context.get',{},signal);
 if(!before.active||!before.document||before.document.isFamilyDocument)fail('no_active_document','Open a project before professional modeling preview.');
 if(before.document.identity!==args.documentIdentity)fail('document_changed','Pump workflow belongs to another active document.');
 if(args.expectedRevision!==undefined&&args.expectedRevision!==before.document.revision)fail('document_revision_changed','Pump workflow source revision changed.');
 const pin={documentIdentity:before.document.identity,expectedRevision:before.document.revision};
 if(clearance.mode==='screen_existing'){
  const {mode,...request}=clearance;const report=await call('revit.collision.check',collisionInputSchema.parse({...request,...pin}),signal);
  if(report?.documentIdentity!==pin.documentIdentity)fail('document_changed','Clearance evidence belongs to a different document.');
  if(report.documentRevision!==pin.expectedRevision)fail('document_revision_changed','Clearance evidence is stale; discard and re-read.');
  if(!Array.isArray(report.collisions)||!Array.isArray(report.unknown)||!Array.isArray(report.clearanceCandidates)||!report.scope||!report.diagnostics)fail('invalid_preflight_evidence','Native report lacks collision/unknown/truncation evidence.');
  const sameIds=(actual,expected)=>Array.isArray(actual)&&actual.length===expected.length&&[...actual].sort((a,b)=>a-b).every((id,i)=>id===[...expected].sort((a,b)=>a-b)[i]);
  if(!sameIds(report.scope.targetElementIds,request.targetElementIds)||!sameIds(report.scope.excludeElementIds,request.excludeElementIds||[])||report.scope.clearanceMm!==request.clearanceMm)
   fail('invalid_preflight_evidence','Native clearance report scope does not match the reviewed targets, exclusions or millimeter request.');
  preflight.clearanceReport=report;
  const unresolved=report.diagnostics.complete!==true||report.scope.truncated!==false||report.diagnostics.truncated!==false||report.collisions.length||report.unknown.length||report.clearanceCandidates.length;
  if(unresolved)return {...response,status:'needs_clarification',planningMode:'ask',requiresClarification:true,questions:['现有范围粗筛含碰撞、候选、未知或截断。请复核报告并调整路线/范围；不自动忽略或修改模型。'],missingInputs:[{field:'clearanceCheck.review',question:'需要复核现有范围粗筛证据。'}],planCreated:false};
 }else warnings.push('用户明确选择不检查净距：'+clearance.reason);
 const summary=[args.summary||args.name,policy.reviewNote,'净距策略：'+clearance.mode,clearance.mode==='skip'?'不检查原因：'+clearance.reason:'现有元素粗筛；新增几何未验证',...policy.assumptions.map(a=>'候选假设：'+a)].filter(Boolean).join('；');
 const plan=await call('revit.plan.create',{...pin,summary,source:'workflow:'+args.name+':'+policy.mode,operations:built.operations},signal);
 if(plan.documentIdentity!==pin.documentIdentity||plan.documentRevision!==pin.expectedRevision){if(plan.planId)await call('revit.plan.cancel',{planId:plan.planId},signal);fail('document_revision_changed','Pump preview is stale; create a new reviewed plan, never automatically commit.');}
 return {...response,requiresClarification:false,questions:[],planCreated:true,plan};
}
