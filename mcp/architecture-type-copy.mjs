import { z } from 'zod';

export const architectureTypeCategories = ['OST_StructuralColumns','OST_Doors','OST_Windows'];
const hasControls = value=>/[\u0000-\u001f\u007f-\u009f]/.test(value);
const exactName = z.string().min(1).max(200).refine(value=>value.trim()===value&&value.trim().length>0&&!hasControls(value),'Names must be exact native names without control characters or surrounding whitespace.');
const typeName = exactName.refine(value=>!/[\\/:{}\[\]|;<>?`~]/.test(value),'Type names cannot be paths or contain prohibited Revit name characters.');
const operationId = z.string().min(1).max(80).refine(value=>value.trim()===value&&value.trim().length>0&&!hasControls(value),'Operation IDs must be explicit and without control characters or surrounding whitespace.');
const existingId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const dimension = z.object({
  parameterId:z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).refine(value=>value!==0,'A dimension parameter needs a nonzero native parameter ID.'),
  name:exactName,
  valueMm:z.number().finite().positive().max(1e8)
}).strict();
const copyShape = {
  sourceTypeId:existingId,
  name:typeName,
  category:z.enum(architectureTypeCategories),
  dimensions:z.array(dimension).length(2)
    .refine(rows=>new Set(rows.map(row=>row.parameterId)).size===rows.length,'Dimension parameter IDs must be distinct.')
    .refine(rows=>new Set(rows.map(row=>row.name)).size===rows.length,'Dimension parameter names must be distinct.'),
  id:operationId.optional(),
  dependencies:z.array(operationId).max(1000).refine(rows=>new Set(rows).size===rows.length,'Dependencies must be distinct.').optional()
};
const notSelfDependent = row=>row.id===undefined||!row.dependencies?.includes(row.id);
export const architectureTypeCopySchema = z.object(copyShape).strict().refine(notSelfDependent,'A type copy cannot depend on itself.');
const operationSchema = z.object({...copyShape,operationType:z.literal('duplicate_architecture_type')}).strict().refine(notSelfDependent,'A type copy cannot depend on itself.');
const inputSchema = z.object({typeCopies:z.array(architectureTypeCopySchema).max(1000).optional()}).strict();

function fail(code,message){const error=new Error(message);error.code=code;throw error;}

export function architectureTypeCopyOperations(input={}) {
  return (inputSchema.parse(input).typeCopies??[]).map((row,index)=>operationSchema.parse({...row,operationType:'duplicate_architecture_type',id:row.id??'type'+(index+1)}));
}

export function validateArchitectureTypeCopy(operation) { return operationSchema.parse(operation); }

export function validateArchitectureTypeCopyPlan(operations) {
  const copies=operations.filter(operation=>operation.operationType==='duplicate_architecture_type');
  const protectedSources=new Set(),protectedReferences=new Set(),names=new Map();
  for(const operation of copies) {
    const copy=validateArchitectureTypeCopy(operation);
    const sourceNames=names.get(copy.sourceTypeId)??new Set();
    if(sourceNames.has(copy.name))fail('architecture_type_copy_conflict','A plan cannot copy the same source to the same name more than once.');
    sourceNames.add(copy.name);names.set(copy.sourceTypeId,sourceNames);
    protectedSources.add(copy.sourceTypeId);
    if(copy.id!==undefined)protectedReferences.add('@'+copy.id);
  }
  if(copies.length)for(const operation of operations) {
    if(operation.operationType==='load_family')
      fail('architecture_type_copy_conflict','An architecture type-copy plan cannot include load_family; loading could change the reviewed source.');
    const target=['set_parameter','delete_element'].includes(operation.operationType)?operation.elementId:
      operation.operationType==='duplicate_type'?operation.sourceTypeId:undefined;
    if(protectedSources.has(target)||protectedReferences.has(target))
      fail('architecture_type_copy_conflict','The source and new architecture type are protected from same-plan parameter changes, deletion or generic duplication.');
    if(['create_family_instance','create_structural_column'].includes(operation.operationType)&&protectedSources.has(operation.symbolId))
      fail('architecture_type_copy_conflict','Placement cannot activate a reviewed copy source in the same plan; place the explicitly copied type instead.');
  }
  const earlier=new Map();
  for(const operation of operations) {
    const reference=typeof operation.symbolId==='string'&&operation.symbolId.startsWith('@')?operation.symbolId.slice(1):null;
    if(reference!==null&&operation.operationType==='create_structural_column') {
      const source=earlier.get(reference);
      if(source?.operationType!=='duplicate_architecture_type'||source.category!=='OST_StructuralColumns')
        fail('architecture_type_reference_mismatch','A column type reference requires an earlier dedicated architecture copy with the matching structural-column category.');
    }
    if(reference!==null&&operation.operationType==='create_family_instance') {
      const source=earlier.get(reference);
      if(source?.operationType==='duplicate_architecture_type'||architectureTypeCategories.includes(operation.category)) {
        if(source?.operationType!=='duplicate_architecture_type')
          fail('architecture_type_reference_mismatch','An architecture placement reference requires an earlier dedicated architecture type copy.');
        if(!['OST_Doors','OST_Windows'].includes(operation.category)||source.category!==operation.category)
          fail('architecture_type_reference_mismatch','A dedicated copied type requires a matching door or window placement category; columns use create_structural_column.');
      }
    }
    for(const [field,value] of Object.entries(operation)) {
      if(field.endsWith('Id')&&protectedReferences.has(value)&&!(field==='symbolId'&&['create_family_instance','create_structural_column'].includes(operation.operationType)))
        fail('architecture_type_reference_mismatch','A copied architecture type may be referenced only as the symbol of its matching reviewed placement.');
      if(field.endsWith('Ids')&&Array.isArray(value)&&value.some(id=>protectedReferences.has(id)))
        fail('architecture_type_reference_mismatch','Copied architecture types cannot be used as instance-element references.');
    }
    if(operation.id!==undefined)earlier.set(operation.id,operation);
  }
  return operations;
}
