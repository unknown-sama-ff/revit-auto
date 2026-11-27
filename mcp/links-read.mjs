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

const cropXYSchema = z.object({ xMm: z.number().finite(), yMm: z.number().finite() }).strict();

export const cadGeometryRequestSchema = {
  documentIdentity: nonblank,
  expectedRevision: revision,
  cadInstanceId: safeId,
  layers: z.array(nonblank).max(200).optional(),
  cropBounds: z.object({ min: cropXYSchema, max: cropXYSchema }).strict().optional(),
  cropViewId: safeId.optional(),
  includeLines: z.boolean().optional(),
  includePolylines: z.boolean().optional(),
  includeArcs: z.boolean().optional(),
  maxPrimitives: z.number().int().min(1).max(100000).optional(),
  offset: z.number().int().min(0).max(100000).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  outputJsonlPath: z.string().trim().min(1).max(1024).optional()
};

const listSchemaObject = z.object(linksListRequestSchema).strict();
const elementsSchemaObject = z.object(linksElementsRequestSchema).strict();
const cadGeometrySchemaObject = z.object(cadGeometryRequestSchema).strict();

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

export function validateCadGeometryArgs(args) {
  const parsed = cadGeometrySchemaObject.safeParse(args);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message || 'Invalid CAD geometry arguments.');
  const data = parsed.data;
  if (data.cropBounds && data.cropViewId !== undefined) {
    throw invalid('Specify either cropBounds or cropViewId, not both.');
  }
  if (data.cropBounds && (data.cropBounds.max.xMm - data.cropBounds.min.xMm < 1 || data.cropBounds.max.yMm - data.cropBounds.min.yMm < 1)) {
    throw invalid('cropBounds must be ordered and at least 1 mm wide and high.');
  }
  if (data.includeLines === false && data.includePolylines === false && data.includeArcs === false) {
    throw invalid('At least one of includeLines, includePolylines, or includeArcs must be true.');
  }
  if (data.outputJsonlPath !== undefined) {
    if (!data.outputJsonlPath.toLowerCase().endsWith('.jsonl') || /^(?:\\|\/\/|https?:|file:)/i.test(data.outputJsonlPath) || data.outputJsonlPath.includes('..')) {
      throw invalid('outputJsonlPath must be a local .jsonl path without traversal segments.');
    }
  }
  return data;
}

export async function readCadGeometry(args, call, signal) {
  const request = validateCadGeometryArgs(args);
  return call('revit.links.cad_geometry', request, signal);
}
