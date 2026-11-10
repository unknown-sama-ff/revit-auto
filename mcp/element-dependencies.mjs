import { z } from 'zod';

export const ELEMENT_DEPENDENCIES_MAX_ITEMS = 20;
export const ELEMENT_DEPENDENCIES_MAX_IDS_PER_LIST = 4096;
export const ELEMENT_DEPENDENCIES_MAX_TOTAL_IDS = 16384;

const nonblank = z.string().min(1).refine(value => value.trim().length > 0, 'Value must not be blank.');
const documentIdentity = nonblank.max(200);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const elementId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nativeId = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const unique = ids => new Set(ids).size === ids.length;
const sortedUnique = ids => ids.every((id, index) => index === 0 || ids[index - 1] < id);

export const elementDependenciesRequestSchema = z.object({
  documentIdentity,
  expectedRevision: revision,
  elementIds: z.array(elementId).min(1).max(ELEMENT_DEPENDENCIES_MAX_ITEMS).refine(unique, 'Element IDs must be unique.')
}).strict();

const evidenceFields = {
  supported: z.boolean(),
  complete: z.boolean(),
  ids: z.array(elementId).max(ELEMENT_DEPENDENCIES_MAX_IDS_PER_LIST).refine(sortedUnique, 'Evidence IDs must be sorted and unique.'),
  count: revision.nullable(),
  truncated: z.literal(false),
  reason: nonblank.optional()
};

function validateEvidence(value, context) {
  if (value.supported) {
    if (!value.complete || value.count !== value.ids.length) context.addIssue({ code: 'custom', message: 'Supported evidence must be complete and count every returned ID.' });
  } else if (value.complete || value.ids.length !== 0 || value.count !== null || value.reason === undefined) {
    context.addIssue({ code: 'custom', message: 'Unsupported evidence must remain unknown with empty IDs, null count and an explicit reason.' });
  }
}

const dependencyEvidenceSchema = z.object(evidenceFields).strict().superRefine(validateEvidence);
const familySymbolEvidenceSchema = z.object({ applicable: z.boolean(), ...evidenceFields }).strict().superRefine((value, context) => {
  validateEvidence(value, context);
  if (!value.applicable && value.supported) context.addIssue({ code: 'custom', message: 'Inapplicable family membership cannot be supported.' });
});

const summarySchema = z.object({
  id: elementId,
  uniqueId: nonblank,
  name: z.string(),
  className: nonblank,
  category: z.string().nullable().optional(),
  categoryId: nativeId.nullable().optional(),
  typeId: nativeId,
  ownerViewId: nativeId,
  levelId: nativeId
}).strict();

const itemSchema = z.object({
  elementId,
  exists: z.boolean(),
  summary: summarySchema.nullable(),
  dependencies: dependencyEvidenceSchema,
  familySymbols: familySymbolEvidenceSchema
}).strict().superRefine((item, context) => {
  if (!item.exists) {
    if (item.summary !== null || item.familySymbols.applicable || [item.dependencies, item.familySymbols].some(evidence => evidence.supported || evidence.reason !== 'element_not_found')) {
      context.addIssue({ code: 'custom', message: 'Missing elements require a null summary and explicit element_not_found evidence.' });
    }
    return;
  }
  if (item.summary === null || item.summary.id !== item.elementId) {
    context.addIssue({ code: 'custom', message: 'Existing elements require their matching native summary.' });
    return;
  }
  const isFamily = item.summary.className === 'Family';
  if (item.familySymbols.applicable !== isFamily || (!isFamily && item.familySymbols.reason !== 'not_family')) {
    context.addIssue({ code: 'custom', message: 'Only a native Family can have applicable family-symbol membership; other elements require not_family evidence.' });
  }
});

export const elementDependenciesResponseSchema = z.object({
  documentIdentity,
  documentRevision: revision,
  items: z.array(itemSchema).min(1).max(ELEMENT_DEPENDENCIES_MAX_ITEMS),
  modelWritesRequested: z.literal(false),
  automaticSave: z.literal(false),
  relationshipScope: z.literal('native-logical-dependents-and-family-symbol-membership'),
  allModelSideEffectsVerified: z.literal(false)
}).strict().superRefine((response, context) => {
  if (!unique(response.items.map(item => item.elementId))) context.addIssue({ code: 'custom', message: 'Response element IDs must be unique.' });
  const total = response.items.reduce((sum, item) => sum + item.dependencies.ids.length + item.familySymbols.ids.length, 0);
  if (total > ELEMENT_DEPENDENCIES_MAX_TOTAL_IDS) context.addIssue({ code: 'custom', message: 'Combined relationship evidence exceeds the bounded ID budget.' });
});

const contextSchema = z.object({
  active: z.literal(true),
  document: z.object({
    identity: documentIdentity,
    revision,
    path: z.string(),
    isModified: z.boolean(),
    isReadOnly: z.boolean()
  }).passthrough()
}).passthrough();

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

function snapshot(context, request) {
  if (context?.active === false) fail('no_active_document', 'Open the reviewed document before querying element dependencies.');
  const parsed = contextSchema.safeParse(context);
  if (!parsed.success) fail('element_dependencies_context_invalid', 'Native context lacks complete document identity, revision, path or saved/read-only state.');
  const document = parsed.data.document;
  if (document.identity !== request.documentIdentity) fail('document_changed', 'The active document differs from the reviewed dependency request.');
  if (document.revision !== request.expectedRevision) fail('document_revision_changed', 'The document revision differs from the reviewed dependency request.');
  return { identity: document.identity, revision: document.revision, path: document.path, isModified: document.isModified, isReadOnly: document.isReadOnly };
}

export async function readElementDependencies(input, call, signal) {
  const request = elementDependenciesRequestSchema.parse(input);
  signal?.throwIfAborted();
  const before = snapshot(await call('revit.context.get', {}, signal), request);
  signal?.throwIfAborted();
  const parsed = elementDependenciesResponseSchema.safeParse(await call('revit.element.dependencies', request, signal));
  if (!parsed.success) fail('element_dependencies_response_invalid', 'Native dependency evidence is malformed, incomplete or exceeds its bounded budget; discard this report.');
  const report = parsed.data;
  if (report.documentIdentity !== request.documentIdentity) fail('document_changed', 'Native dependency evidence belongs to another document.');
  if (report.documentRevision !== request.expectedRevision) fail('document_revision_changed', 'Native dependency evidence belongs to another document revision.');
  if (report.items.length !== request.elementIds.length || report.items.some((item, index) => item.elementId !== request.elementIds[index])) fail('element_dependencies_scope_mismatch', 'Native dependency evidence does not contain exactly the explicitly requested elements in the reviewed order.');
  signal?.throwIfAborted();
  const after = snapshot(await call('revit.context.get', {}, signal), request);
  if (after.path !== before.path || after.isModified !== before.isModified || after.isReadOnly !== before.isReadOnly) fail('element_dependencies_state_changed', 'The document path or saved/read-only state changed during dependency reads; discard this report.');
  signal?.throwIfAborted();
  return report;
}
