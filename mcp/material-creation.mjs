const operationKinds = new Set(['create_material', 'duplicate_material']);

function invalid(message) {
  return Object.assign(new Error(message), { code: 'invalid_material_creation' });
}

function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) {
    throw invalid('Material data must be an object containing only the fields for the selected operation.');
  }
}

function text(value, field, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > 200 ||
      value.trim() !== value || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw invalid(field + ' requires a string up to 200 characters without controls or surrounding whitespace.');
  }
}

function integer(value, field, max) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw invalid(field + ' must be an integer from 0 through ' + max + '.');
  }
}

export function validateMaterialCreation(operation) {
  const kind = operation?.operationType;
  if (!operationKinds.has(kind)) throw invalid('Expected create_material or duplicate_material.');
  const copying = kind === 'duplicate_material';
  fields(operation, ['operationType', 'id', 'dependencies', 'name',
    ...(copying ? ['sourceMaterialId'] : ['materialClass', 'materialCategory', 'color', 'transparency'])]);
  text(operation.name, 'name');
  if (/[{}\[\]|;<>?\u0060~]/u.test(operation.name)) throw invalid('name contains a prohibited material name character.');
  if (copying) {
    if (!Number.isSafeInteger(operation.sourceMaterialId) || operation.sourceMaterialId <= 0) {
      throw invalid('sourceMaterialId must identify an existing native material using a positive safe integer.');
    }
    return;
  }
  for (const field of ['materialClass', 'materialCategory']) {
    if (Object.hasOwn(operation, field)) text(operation[field], field, true);
  }
  if (Object.hasOwn(operation, 'color')) {
    fields(operation.color, ['red', 'green', 'blue']);
    for (const channel of ['red', 'green', 'blue']) integer(operation.color[channel], 'color.' + channel, 255);
  }
  if (Object.hasOwn(operation, 'transparency')) integer(operation.transparency, 'transparency', 100);
}

export function validateMaterialAssignment(operation) {
  fields(operation, ['operationType', 'id', 'dependencies', 'elementId', 'parameter', 'materialId']);
  if (!Number.isSafeInteger(operation.elementId) || operation.elementId <= 0) {
    throw invalid('Select an existing model instance by its native ID.');
  }
  text(operation.parameter, 'parameter');
  const material = operation.materialId;
  if (!(Number.isSafeInteger(material) && material > 0) && !(typeof material === 'string' && material.startsWith('@') && material.length > 1)) {
    throw invalid('materialId requires an existing material ID or a reference to an earlier material.');
  }
}

export function validateMaterialPlan(operations) {
  const names = new Set();
  const materialReferences = new Set();
  const sources = new Set();
  const targets = new Set();
  for (const operation of operations) {
    if (!operationKinds.has(operation.operationType)) continue;
    const name = operation.name.toUpperCase();
    if (names.has(name)) throw invalid('New material names must be distinct within a plan.');
    names.add(name);
    if (operation.id !== undefined) materialReferences.add('@' + operation.id);
    if (operation.operationType === 'duplicate_material') sources.add(operation.sourceMaterialId);
  }
  for (const operation of operations) {
    if (operation.operationType !== 'assign_material') continue;
    if (targets.has(operation.elementId)) throw invalid('Use one explicit material assignment per target instance in a plan.');
    targets.add(operation.elementId);
    if (Number.isSafeInteger(operation.materialId)) sources.add(operation.materialId);
    else if (!materialReferences.has(operation.materialId)) throw invalid('A material reference must point to an earlier material creation or duplication.');
  }
  for (const operation of operations) {
    if (['set_parameter', 'delete_element'].includes(operation.operationType) &&
        (sources.has(operation.elementId) || targets.has(operation.elementId))) {
      throw invalid('Modify a reviewed material or assignment target in a separate plan.');
    }
  }
}
