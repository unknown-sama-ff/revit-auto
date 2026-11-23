import { z } from 'zod';

const nonblank = z.string().min(1).max(200).refine(v => v.trim() === v && v.length > 0 && !/[\u0000-\u001f\u007f-\u009f]/u.test(v));
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const safeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const linksListRequestSchema = {
  documentIdentity: nonblank,
  expectedRevision: revision,
  includeRevitLinks: z.boolean().optional(),
  includeCad: z.boolean().optional(),
  includeUnloaded: z.boolean().optional(),
  includeInstances: z.boolean().optional(),
  includeCadLinks: z.boolean().optional(),
  includeCadImports: z.boolean().optional(),
  offset: z.number().int().min(0).max(100000).optional(),
  limit: z.number().int().min(1).max(200).optional()
};

export const linksElementsRequestSchema = {
  documentIdentity: nonblank,
  expectedRevision: revision,
  linkInstanceId: safeId,
  category: nonblank.optional(),
  offset: z.number().int().min(0).max(100000).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  includeBounds: z.boolean().optional()
};

const listSchemaObject = z.object(linksListRequestSchema).strict();
const elementsSchemaObject = z.object(linksElementsRequestSchema).strict();

function invalid(message) {
  return Object.assign(new Error(message), { code: 'invalid_links_request' });
}

export function validateLinksListArgs(args) {
  const parsed = listSchemaObject.safeParse(args);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message || 'Invalid links list arguments.');
  const data = parsed.data;
  if (data.includeRevitLinks === false && data.includeCad === false) {
    throw invalid('At least one of includeRevitLinks or includeCad must be true.');
  }
  if (data.includeCad !== false && data.includeCadLinks === false && data.includeCadImports === false) {
    throw invalid('When includeCad is enabled, at least one of includeCadLinks or includeCadImports must be true.');
  }
  return data;
}

export function validateLinkElementsArgs(args) {
  const parsed = elementsSchemaObject.safeParse(args);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message || 'Invalid link elements arguments.');
  return parsed.data;
}

export async function listLinks(args, call, signal) {
  const request = validateLinksListArgs(args);
  return call('revit.links.list', request, signal);
}

export async function readLinkElements(args, call, signal) {
  const request = validateLinkElementsArgs(args);
  return call('revit.links.elements', request, signal);
}
