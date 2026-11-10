import {describeArgumentKeys} from './argument-diagnostics.mjs';

const common=['operationType','id','dependencies','parameters','mark'];
const fields={
 create_tag:[...common,'elementId','viewId','tagTypeId','xMm','yMm','zMm','leader'],
 create_dimension:[...common,'viewId','dimensionTypeId','start','end','references']
};
const invalid=message=>Object.assign(new Error(message),{code:'invalid_annotation_input'});

export function validateAnnotationInput(op){
 const allowed=fields[op.operationType];if(!allowed)return;
 const diagnostics=describeArgumentKeys(Object.keys(op),allowed);
 if(diagnostics.counts.unknown)throw Object.assign(invalid(`${op.operationType}: unsupported annotation fields.`),{details:diagnostics});
 const typeField=op.operationType==='create_tag'?'tagTypeId':'dimensionTypeId';
 if(Object.hasOwn(op,typeField)){
  const value=op[typeField];
  if(!(Number.isSafeInteger(value)&&value>0)&&!(typeof value==='string'&&value.startsWith('@')&&value.length>1))
   throw invalid(`${op.operationType}: ${typeField} must be a positive id or a prior @reference when supplied.`);
 }
 if(op.operationType==='create_dimension'){
  const refs=op.references;
  if(!Array.isArray(refs)||refs.length<2||refs.length>128||refs.some(r=>typeof r!=='string'||!r.trim()||r.length>4096)||new Set(refs).size!==refs.length)
   throw invalid('create_dimension: references must contain 2..128 distinct nonblank stable-reference strings, each at most 4096 characters.');
 }
}
