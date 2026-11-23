import { validateHorizontalProfile } from './ceiling-creation.mjs';

const invalid = message => Object.assign(new Error(message), { code: 'invalid_roof_creation' });

export function validateRoofCreation(op) {
  const allowed = ['operationType', 'id', 'dependencies', 'roofTypeId', 'levelId', 'boundary', 'edgeSlopes'];
  if (op?.operationType !== 'create_footprint_roof' || typeof op !== 'object' || Array.isArray(op) ||
      Object.keys(op).some(key => !allowed.includes(key))) {
    throw invalid('Specify one explicit footprint roof object without extra fields.');
  }
  for (const field of ['roofTypeId', 'levelId']) {
    if (!Number.isSafeInteger(op[field]) || op[field] <= 0) throw invalid(field + ' must be an existing native ID.');
  }
  try { validateHorizontalProfile(op.boundary); }
  catch (error) { throw invalid(error.message.replaceAll('Ceiling', 'Roof')); }
  if (!Array.isArray(op.edgeSlopes) || op.edgeSlopes.length !== op.boundary.length ||
      op.edgeSlopes.some(ratio => typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0 || ratio > 12)) {
    throw invalid('Supply one rise/run ratio from 0 through 12 per edge. Zero disables slope on that edge.');
  }
}

export function validateRoofPlan(operations) {
  const sources = new Set();
  for (const op of operations) {
    if (op.operationType === 'create_footprint_roof') {
      sources.add(op.roofTypeId);
      sources.add(op.levelId);
    }
  }
  for (const op of operations) {
    if (['set_parameter', 'delete_element'].includes(op.operationType) && sources.has(op.elementId)) {
      throw invalid('Change a roof source type or level in a separate plan.');
    }
  }
}
