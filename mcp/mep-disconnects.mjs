import { z } from 'zod';

const nonblank = z.string().min(1).max(200).refine(v => v.trim() === v && v.length > 0 && !/[\u0000-\u001f\u007f-\u009f]/u.test(v));
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const safeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const mepDisconnectsRequestSchema = {
  documentIdentity: nonblank,
  expectedRevision: revision,
  domain: z.enum(['all', 'hvac', 'piping', 'electrical', 'cableTrayConduit']).optional(),
  viewId: safeId.optional(),
  offset: z.number().int().min(0).max(100000).optional(),
  limit: z.number().int().min(1).max(200).optional()
};

const schemaObject = z.object(mepDisconnectsRequestSchema).strict();

function invalid(message) {
  return Object.assign(new Error(message), { code: 'invalid_mep_disconnects_request' });
}

export function validateMepDisconnectsArgs(args) {
  const parsed = schemaObject.safeParse(args);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message || 'Invalid MEP disconnects arguments.');
  return parsed.data;
}

export async function readMepDisconnects(args, call, signal) {
  const request = validateMepDisconnectsArgs(args);
  return call('revit.mep.disconnects', request, signal);
}
