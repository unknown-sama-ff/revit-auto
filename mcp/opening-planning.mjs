import {workflowOperations} from './workflows.mjs';
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
export async function previewOpeningsWorkflow(args,call,signal){
 const mode=args.planningMode??'explicit',input=args.input??{};
 if(!['ask','explicit','assisted'].includes(mode))fail('invalid_planning_mode','Unknown opening planning mode.');
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>key!=='openings'))fail('invalid_opening_input','openings.create accepts only openings, never code, file paths or unreviewed operations.');
 const missing=[];
 if(!Array.isArray(input.openings)||!input.openings.length)missing.push('openings: a nonempty list of explicitly selected wall/floor/shaft openings');
 else input.openings.forEach((op,i)=>{
  if(!op||typeof op!=='object'||Array.isArray(op))fail('invalid_opening_input','Each opening must be an object.');
  const fields={wall_rectangle:['hostElementId','start','end','hostToleranceMm'],floor_profile:['hostElementId','boundary','cutDirection','hostToleranceMm'],shaft:['baseLevelId','topLevelId','boundary','hostToleranceMm']}[op.openingKind];
  if(!fields){if(op.openingKind!==undefined)fail('invalid_opening_input','Unsupported openingKind.');missing.push(`openings[${i}].openingKind: wall_rectangle, floor_profile or shaft`);return;}
  fields.filter(field=>op[field]===undefined||op[field]===null).forEach(field=>missing.push(`openings[${i}].${field}`));
 });
 if(mode==='ask'||missing.length)return{workflowId:'openings.create',planningMode:'ask',status:'needs_clarification',requiresClarification:true,questions:missing.length?missing:['请明确洞口种类、现有宿主或上下标高、完整 XYZ、轮廓与切割方式、宿主容差；不推断结构设计。'],missingInputs:missing,assumptions:[],candidateOnly:false,planCreated:false};
 if(mode==='assisted'&&!args.assumptions?.length)fail('assumptions_required','Assisted openings need explicitly listed assumptions and user permission for candidate inference.');
 const operations=workflowOperations('openings.create',input);
 signal?.throwIfAborted();
 const plan=await call('revit.plan.create',{documentIdentity:args.documentIdentity,expectedRevision:args.expectedRevision,source:'workflow:openings.create:'+mode,
 summary:[args.summary||'受控洞口预览',mode==='assisted'?'候选方案；假设：'+args.assumptions.join('；'):'用户明确洞口约束；宿主将被切割，结构及防火需人工核对'].join('；'),operations},signal);
 return{workflowId:'openings.create',planningMode:mode,requiresClarification:false,questions:[],missingInputs:[],assumptions:mode==='assisted'?[...args.assumptions]:[],candidateOnly:mode==='assisted',planCreated:true,plan,engineeringComplianceVerified:false};
}
