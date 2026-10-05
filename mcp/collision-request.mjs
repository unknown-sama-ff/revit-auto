import {z} from 'zod';
export const collisionCategories = ['OST_MechanicalEquipment','OST_PipeCurves','OST_PipeFitting','OST_DuctCurves','OST_DuctFitting','OST_Walls','OST_Floors','OST_StructuralColumns','OST_StructuralFraming','OST_StructuralFoundation','OST_Columns','OST_Ceilings','OST_Roofs'];
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ids = max => z.array(id).max(max).refine(values => new Set(values).size === values.length, 'Duplicate element IDs are not allowed.');
export const collisionInputSchema = z.object({
  documentIdentity: z.string().min(1).max(200).refine(value => value.trim().length > 0, 'Read the current identity.'),
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  targetElementIds: ids(50).min(1),
  excludeElementIds: ids(500).optional(),
  candidateCategories: z.array(z.enum(collisionCategories)).max(collisionCategories.length).refine(values => new Set(values).size === values.length, 'Duplicate categories are not allowed.').optional(),
  clearanceMm: z.number().finite().min(0).max(10000).optional(),
  toleranceMm: z.number().finite().gt(0).max(10).optional(),
  maxCandidates: z.number().int().min(1).max(1000).optional()
}).strict().refine(input => !(input.excludeElementIds || []).some(id => input.targetElementIds.includes(id)), 'A target cannot also be excluded.');
