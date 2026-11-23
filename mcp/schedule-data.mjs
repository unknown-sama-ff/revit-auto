import { z } from 'zod';

const nonblank = z.string().min(1).max(200).refine(v => v.trim() === v && v.length > 0 && !/[\u0000-\u001f\u007f-\u009f]/u.test(v));
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const safeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const scheduleDataRequestSchema = {
  documentIdentity: nonblank,
  expectedRevision: revision,
  scheduleId: safeId,
  startRow: z.number().int().min(0).max(1000000).optional(),
  maxRows: z.number().int().min(1).max(200).optional(),
  includeCellMeta: z.boolean().optional()
};

const schemaObject = z.object(scheduleDataRequestSchema).strict();

function invalid(message) {
  return Object.assign(new Error(message), { code: 'invalid_schedule_data_request' });
}

export function validateScheduleDataArgs(args) {
  const parsed = schemaObject.safeParse(args);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message || 'Invalid schedule data arguments.');
  return parsed.data;
}

export async function readScheduleData(args, call, signal) {
  const request = validateScheduleDataArgs(args);
  return call('revit.schedule.data', request, signal);
}
