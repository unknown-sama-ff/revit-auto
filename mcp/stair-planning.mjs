import {validateOperations,workflowOperations} from './workflows.mjs';
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
const required=['stairTypeId','baseLevelId','topLevelId','desiredRisersNumber','treadDepthMm','geometryToleranceMm','landingMode','runs'];
export async function previewStairWorkflow(args,call,signal){
 const mode=args.planningMode??'ask',input=args.input??{};
 if(!['explicit','ask','assisted'].includes(mode))fail('invalid_planning_mode','Unknown stair planning mode.');
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>key!=='stairs'))fail('invalid_stair_input','architecture.stairs accepts only stairs input, not code, files or raw operations.');
 const rows=input.stairs;
 if(!Array.isArray(rows)||rows.length<1) return {workflowId:'architecture.stairs',planningMode:'ask',status:'needs_clarification',requiresClarification:true,questions:['请明确楼梯类型、起止标高、总踢面数、踏面深度、几何容差、梯段完整绝对 XYZ、每跑踢面数和平台策略。'],missingInputs:['stairs'],assumptions:[],candidateOnly:false,planCreated:false};
 if(rows.length!==1)fail('invalid_stair_input','One stair per plan is required by the native StairsEditScope; review separate stair plans sequentially.');
 const missing=[];rows.forEach((stair,index)=>{for(const field of required)if(stair?.[field]===undefined||stair?.[field]===null)missing.push(`stairs[${index}].${field}`);if(stair?.landingMode==='sketched'&&(stair.landings===undefined||stair.landings===null))missing.push(`stairs[${index}].landings`);if(stair?.landingMode!=='sketched'&&stair?.landings!==undefined)fail('invalid_stair_input','Landings are only accepted in sketched mode, not ignored.');
  if(Array.isArray(stair?.runs))stair.runs.forEach((run,runIndex)=>{
    for(const field of ['start','end','widthMm','risersNumber'])if(run?.[field]===undefined||run?.[field]===null)missing.push(`stairs[${index}].runs[${runIndex}].${field}`);
    for(const end of ['start','end'])if(run?.[end]&&typeof run[end]==='object')for(const axis of ['xMm','yMm','zMm'])if(run[end][axis]===undefined||run[end][axis]===null)missing.push(`stairs[${index}].runs[${runIndex}].${end}.${axis}`);
  });
 });
 if(mode==='ask'||missing.length)return{workflowId:'architecture.stairs',planningMode:'ask',status:'needs_clarification',requiresClarification:true,questions:missing.length?missing:['请明确楼梯类型、几何、平台与原生结果约束。'],missingInputs:missing,assumptions:[],candidateOnly:false,planCreated:false};
 if(mode==='assisted'&&!args.assumptions?.length)fail('assumptions_required','Assisted stairs need explicit assumptions and user permission for candidate inference.');
 const operations=workflowOperations('architecture.stairs',input);validateOperations(operations);signal?.throwIfAborted();
 const plan=await call('revit.plan.create',{documentIdentity:args.documentIdentity,expectedRevision:args.expectedRevision,source:'workflow:architecture.stairs:'+mode,summary:[args.summary||'受控楼梯预览',mode==='assisted'?'候选方案；假设：'+args.assumptions.join('；'):'用户明确楼梯类型、梯段和平台约束；不认证结构/消防'].join('；'),operations},signal);
 return{workflowId:'architecture.stairs',planningMode:mode,requiresClarification:false,questions:[],missingInputs:[],assumptions:mode==='assisted'?[...args.assumptions]:[],candidateOnly:mode==='assisted',planCreated:true,plan,engineeringComplianceVerified:false};
}
