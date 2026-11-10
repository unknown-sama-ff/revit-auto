import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { ELEMENT_DEPENDENCIES_MAX_ITEMS, elementDependenciesResponseSchema } from './element-dependencies.mjs';

export const LIFECYCLE_METHODS = Object.freeze([
  'revit.lifecycle.prepare', 'revit.lifecycle.get', 'revit.lifecycle.verify_scope',
  'revit.lifecycle.save_once', 'revit.lifecycle.post_exit_once',
  'revit.lifecycle.open_saved_copy_once', 'revit.lifecycle.stop'
]);
export const LIFECYCLE_MAX_RECIPES = 100;
export const LIFECYCLE_MAX_RECORDS = 1024;
export const LIFECYCLE_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const LIFECYCLE_STAGES = Object.freeze([
  'PREVIEW_READY', 'BACKUP_VERIFIED', 'SAVE_STARTED', 'SAVE_READBACK_PENDING', 'SAVE_VERIFIED',
  'EXIT_STARTED', 'EXIT_POSTED', 'OLD_PROCESS_EXITED', 'NEW_PROCESS_READY', 'OPEN_STARTED', 'OPEN_READBACK_PENDING',
  'REOPEN_VERIFIED', 'SAVE_OUTCOME_UNKNOWN', 'OPEN_OUTCOME_UNKNOWN', 'FAILED', 'STOPPED', 'CANCELLED'
]);

const nonblank = z.string().min(1).refine(value => value.trim().length > 0, 'Value must not be blank.');
const identity = nonblank.max(200);
const safeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveId = safeInteger.positive();
const nativeId = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const lifecycleOperationIdSchema = z.string().regex(/^[a-f0-9]{32}$/);
export const lifecycleSha256Schema = z.string().regex(/^[a-fA-F0-9]{64}$/);
const mvid = z.string().regex(/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/);
const timestamp = nonblank.refine(value => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/.test(value) && Number.isFinite(Date.parse(value)), 'A valid UTC timestamp is required.');
const filePath = nonblank.max(32767);
const unique = values => new Set(values).size === values.length;
const sameHash = (first, second) => first.toUpperCase() === second.toUpperCase();

export const lifecyclePrepareSchema = z.object({}).strict();
export const lifecycleRequestSchema = z.object({ operationId: lifecycleOperationIdSchema, requestSha256: lifecycleSha256Schema }).strict();
export const lifecycleVerifyScopeSchema = lifecycleRequestSchema.extend({ readIndex: z.number().int().min(0).max(2 * LIFECYCLE_MAX_RECIPES - 1) }).strict();

const contextRecipeSchema = z.object({ method: z.literal('revit.context.get'), params: z.object({}).strict() }).strict();
const searchRecipeSchema = z.object({ method: z.literal('revit.search'), params: z.object({ category: nonblank.max(200), types: z.boolean(), limit: z.literal(500), offset: z.number().int().min(0).max(100000) }).strict() }).strict();
const inspectRecipeSchema = z.object({ method: z.literal('revit.inspect'), params: z.object({ elementIds: z.array(positiveId).min(1).max(100).refine(unique, 'Inspection IDs must be unique.') }).strict() }).strict();
// Registration fixes element membership across sessions. The prepared document
// pin and native scope read supply identity/revision, never a prior session recipe.
const dependencyRecipeSchema = z.object({ method: z.literal('revit.element.dependencies'), params: z.object({ elementIds: z.array(positiveId).min(1).max(ELEMENT_DEPENDENCIES_MAX_ITEMS).refine(unique, 'Dependency IDs must be unique.') }).strict() }).strict();
export const lifecycleReadRecipeSchema = z.discriminatedUnion('method', [contextRecipeSchema, searchRecipeSchema, inspectRecipeSchema, dependencyRecipeSchema]);

// Existing native inspection and context formats carry geometry and parameters.
// Preserve every JSON field instead of narrowing their records to a lossy view.
const jsonValue = z.lazy(() => z.union([z.null(), z.boolean(), z.string(), z.number().finite(), z.array(jsonValue), z.record(z.string(), jsonValue)]));
const jsonObject = z.record(z.string(), jsonValue);
const nativeSummarySchema = z.object({ id: positiveId, uniqueId: nonblank, name: z.string(), className: nonblank, levelId: nativeId, typeId: nativeId, ownerViewId: nativeId }).passthrough();
const nativeInspectionSchema = z.object({ summary: nativeSummarySchema, parameters: z.array(jsonObject), connectors: z.array(jsonObject), piping: jsonObject }).passthrough();

export const lifecyclePreparedRequestSchema = z.object({
  schemaVersion: z.literal(1),
  operationId: lifecycleOperationIdSchema,
  createdAtUtc: timestamp,
  expiresAtUtc: timestamp,
  registrationSha256: lifecycleSha256Schema,
  registration: z.object({
    modelPath: filePath,
    baselineEvidenceFile: filePath,
    baselineEvidenceSha256: lifecycleSha256Schema,
    readRecipes: z.array(lifecycleReadRecipeSchema).min(1).max(LIFECYCLE_MAX_RECIPES)
  }).strict(),
  document: z.object({ identity, revision: safeInteger, path: filePath, isModified: z.boolean() }).strict(),
  process: z.object({
    pid: positiveId,
    startTimeUtc: timestamp,
    exePath: filePath,
    exeSha256: lifecycleSha256Schema,
    version: z.string().regex(/^27\.3\.\d+\.\d+$/),
    moduleVersionId: mvid,
    userSid: nonblank,
    sessionId: safeInteger
  }).strict(),
  bridgeConfig: z.object({ path: filePath, sha256: lifecycleSha256Schema, aclSddl: nonblank, port: z.number().int().min(1024).max(65535) }).strict(),
  savedFile: z.object({ path: filePath, bytes: safeInteger, sha256: lifecycleSha256Schema, fileIdentity: z.string().regex(/^[0-9a-f]{8}:[0-9a-f]{16}$/) }).strict(),
  baselineSnapshotFile: filePath,
  baselineSnapshotSha256: lifecycleSha256Schema,
  recipeCount: z.number().int().min(1).max(LIFECYCLE_MAX_RECIPES)
}).strict().superRefine((request, context) => {
  if (request.recipeCount !== request.registration.readRecipes.length) context.addIssue({ code: 'custom', message: 'Recipe count differs from the fixed registered reads.' });
  if (request.registration.readRecipes.filter(recipe => recipe.method === 'revit.context.get').length !== 1) context.addIssue({ code: 'custom', message: 'Exactly one fixed context recipe is required.' });
  if (request.registration.modelPath !== request.document.path || request.savedFile.path !== request.document.path) context.addIssue({ code: 'custom', message: 'Registered, active and saved file paths differ.' });
  const lifetime = Date.parse(request.expiresAtUtc) - Date.parse(request.createdAtUtc);
  if (lifetime !== 600000) context.addIssue({ code: 'custom', message: 'Lifecycle preview lifetime must be exactly ten minutes.' });
});

export const lifecycleStateSchema = z.object({
  schemaVersion: z.literal(1), operationId: lifecycleOperationIdSchema, requestSha256: lifecycleSha256Schema,
  sequence: z.number().int().min(1).max(LIFECYCLE_MAX_RECORDS), previousSha256: lifecycleSha256Schema.nullable(), stage: z.enum(LIFECYCLE_STAGES), atUtc: timestamp,
  data: jsonObject
}).strict().superRefine((state, context) => {
  if ((state.sequence === 1) !== (state.previousSha256 === null)) context.addIssue({ code: 'custom', message: 'Immutable state sequence and prior digest differ.' });
});

const scopeSchema = z.object({
  phase: z.enum(['SAVE_READBACK_PENDING', 'OPEN_READBACK_PENDING']),
  readIndex: safeInteger,
  method: z.enum(['revit.context.get', 'revit.search', 'revit.inspect', 'revit.element.dependencies']),
  documentIdentity: identity,
  documentRevision: safeInteger,
  result: jsonObject,
  matched: z.literal(true)
}).strict();

export const lifecycleResponseSchema = z.object({
  operationId: lifecycleOperationIdSchema,
  requestSha256: lifecycleSha256Schema,
  stage: z.enum(LIFECYCLE_STAGES),
  recipeCount: z.number().int().min(1).max(LIFECYCLE_MAX_RECIPES),
  readIndex: safeInteger,
  readRound: safeInteger,
  leaseActive: z.boolean(),
  exitPosted: z.boolean(),
  modelWritesRequested: z.literal(false),
  automaticRetry: z.literal(false),
  allModelSideEffectsVerified: z.literal(false),
  requestFile: filePath,
  request: lifecyclePreparedRequestSchema,
  latestState: lifecycleStateSchema,
  stateSha256: lifecycleSha256Schema,
  eventCount: z.number().int().min(0).max(LIFECYCLE_MAX_RECORDS),
  eventTailSha256: lifecycleSha256Schema.nullable(),
  stopReason: nonblank.nullable(),
  scope: scopeSchema.nullable()
}).strict().superRefine((response, context) => {
  if (response.request.operationId !== response.operationId || response.latestState.operationId !== response.operationId || !sameHash(response.latestState.requestSha256, response.requestSha256)) context.addIssue({ code: 'custom', message: 'Lifecycle request and state identities differ.' });
  if (response.recipeCount !== response.request.recipeCount || response.readIndex > 2 * response.recipeCount || response.readRound !== Math.floor(response.readIndex / response.recipeCount) || response.latestState.data.readIndex !== response.readIndex) context.addIssue({ code: 'custom', message: 'Lifecycle fixed-read position is invalid or differs from its immutable state.' });
  if (response.latestState.stage !== response.stage) context.addIssue({ code: 'custom', message: 'Lifecycle stage differs from its latest immutable state.' });
  if ((response.eventCount === 0) !== (response.eventTailSha256 === null)) context.addIssue({ code: 'custom', message: 'Event count and tail digest differ.' });
});

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

function validateReadResult(scope, recipe, request) {
  if (scope.method !== recipe.method) fail('lifecycle_scope_mismatch', 'Lifecycle read response differs from its fixed recipe.');
  const result = scope.result;
  if (recipe.method === 'revit.context.get') {
    const parsed = z.object({ active: z.literal(true), document: z.object({ identity, revision: safeInteger, path: filePath, isModified: z.boolean(), isReadOnly: z.boolean() }).passthrough() }).passthrough().safeParse(result);
    if (!parsed.success || result.document.identity !== scope.documentIdentity || result.document.revision !== scope.documentRevision || result.document.path !== request.document.path || result.document.isModified || result.document.isReadOnly) fail('lifecycle_scope_invalid', 'Lifecycle context read lacks the pinned stable document evidence.');
  } else if (recipe.method === 'revit.search') {
    const parsed = z.object({ items: z.array(nativeSummarySchema).max(500), offset: safeInteger, limit: z.literal(500), hasMore: z.boolean() }).strict().safeParse(result);
    if (!parsed.success || result.offset !== recipe.params.offset || result.limit !== recipe.params.limit || result.items.length > recipe.params.limit || result.items.some(item => !positiveId.safeParse(item.id).success) || !unique(result.items.map(item => item.id))) fail('lifecycle_scope_invalid', 'Lifecycle membership read is malformed or differs from its fixed page.');
  } else if (recipe.method === 'revit.inspect') {
    const parsed = z.object({ items: z.array(nativeInspectionSchema).min(1).max(100) }).strict().safeParse(result);
    if (!parsed.success || !isDeepStrictEqual(result.items.map(item => item.summary?.id), recipe.params.elementIds) || result.items.some(item => item.exists === false)) fail('lifecycle_scope_invalid', 'Lifecycle inspection lacks its exact complete registered elements.');
  } else {
    const parsed = elementDependenciesResponseSchema.safeParse(result);
    if (!parsed.success || result.documentIdentity !== scope.documentIdentity || result.documentRevision !== scope.documentRevision || !isDeepStrictEqual(result.items.map(item => item.elementId), recipe.params.elementIds)) fail('lifecycle_scope_invalid', 'Lifecycle dependency read differs from its complete fixed relationship request.');
  }
}

export function validateLifecycleResponse(method, input, value, expected = {}) {
  if (!LIFECYCLE_METHODS.includes(method)) fail('lifecycle_method_not_allowed', 'Only the controlled lifecycle routes may be validated.');
  const parsed = lifecycleResponseSchema.safeParse(value);
  if (!parsed.success) fail('lifecycle_response_invalid', 'Native lifecycle response is malformed, incomplete or contradicts its fixed state.');
  const response = parsed.data;
  if (Buffer.byteLength(JSON.stringify(response), 'utf8') + 2 > LIFECYCLE_MAX_RESPONSE_BYTES) fail('lifecycle_response_invalid', 'The complete native lifecycle response exceeds its bounded evidence budget.');
  if (method !== 'revit.lifecycle.prepare' && (response.operationId !== input.operationId || !sameHash(response.requestSha256, input.requestSha256))) fail('lifecycle_request_mismatch', 'Native lifecycle response belongs to another reviewed request.');
  if (method === 'revit.lifecycle.prepare' && (response.stage !== 'PREVIEW_READY' || response.leaseActive || response.exitPosted || response.scope !== null || response.readIndex !== 0 || response.stopReason !== null)) fail('lifecycle_response_invalid', 'Lifecycle preview must not acquire a lease or advance any action.');
  if (method === 'revit.lifecycle.verify_scope') {
    const scope = response.scope;
    if (scope === null || scope.readIndex !== input.readIndex || input.readIndex >= response.recipeCount * 2 || response.readIndex !== input.readIndex + 1) fail('lifecycle_scope_mismatch', 'Lifecycle read response differs from its requested fixed read index.');
    validateReadResult(scope, response.request.registration.readRecipes[input.readIndex % response.recipeCount], response.request);
    if (scope.phase === 'SAVE_READBACK_PENDING' && (scope.documentIdentity !== response.request.document.identity || scope.documentRevision !== response.request.document.revision)) fail('lifecycle_scope_mismatch', 'Saved-scope evidence differs from the reviewed document session.');
    if (scope.phase === 'OPEN_READBACK_PENDING' && (scope.documentIdentity === response.request.document.identity || scope.documentRevision !== 0)) fail('lifecycle_scope_mismatch', 'Reopened-scope evidence requires a new native identity and revision zero.');
    const completed = response.readIndex === response.recipeCount * 2;
    const expectedNativeStage = scope.phase === 'SAVE_READBACK_PENDING' ? (completed ? 'SAVE_VERIFIED' : 'SAVE_READBACK_PENDING') : (completed ? 'REOPEN_VERIFIED' : 'OPEN_READBACK_PENDING');
    if (response.stage !== expectedNativeStage) fail('lifecycle_scope_mismatch', 'Lifecycle stage does not match its verified read phase and completion index.');
    const expectedLease = scope.phase === 'SAVE_READBACK_PENDING' || !completed;
    if (response.leaseActive !== expectedLease || response.exitPosted || response.stopReason !== null) fail('lifecycle_scope_mismatch', 'Lifecycle lease or stop state does not match the active readback phase.');
    if (expected.phase !== undefined && scope.phase !== expected.phase) fail('lifecycle_scope_mismatch', 'Lifecycle read response differs from the locally expected phase.');
    if (expected.documentIdentity !== undefined && scope.documentIdentity !== expected.documentIdentity) fail('document_changed', 'Lifecycle read belongs to another locally pinned document.');
    if (expected.documentRevision !== undefined && scope.documentRevision !== expected.documentRevision) fail('document_revision_changed', 'Lifecycle read belongs to another locally pinned document revision.');
  } else if (response.scope !== null) fail('lifecycle_response_invalid', 'Only the fixed verification route may return a scope read.');
  if (expected.request !== undefined && !isDeepStrictEqual(response.request, expected.request)) fail('lifecycle_request_mismatch', 'Lifecycle response changed the locally reviewed immutable request.');
  if (expected.stage !== undefined && response.stage !== expected.stage) fail('lifecycle_stage_mismatch', 'Lifecycle response differs from the locally expected stage.');
  return response;
}

export async function callDocumentLifecycle(method, input, call, signal, expected) {
  if (!LIFECYCLE_METHODS.includes(method)) fail('lifecycle_method_not_allowed', 'Only the controlled lifecycle routes may be called.');
  const schema = method === 'revit.lifecycle.prepare' ? lifecyclePrepareSchema : method === 'revit.lifecycle.verify_scope' ? lifecycleVerifyScopeSchema : lifecycleRequestSchema;
  const request = schema.parse(input);
  signal?.throwIfAborted();
  // Exactly one native dispatch: get is observation, and errors never trigger an action or retry.
  return validateLifecycleResponse(method, request, await call(method, request, signal), expected);
}

export const prepareLifecycle = (input, call, signal, expected) => callDocumentLifecycle('revit.lifecycle.prepare', input, call, signal, expected);
export const getLifecycle = (input, call, signal, expected) => callDocumentLifecycle('revit.lifecycle.get', input, call, signal, expected);
export const verifyLifecycleScope = (input, call, signal, expected) => callDocumentLifecycle('revit.lifecycle.verify_scope', input, call, signal, expected);
export const saveLifecycleOnce = (input, call, signal, expected) => callDocumentLifecycle('revit.lifecycle.save_once', input, call, signal, expected);
export const postLifecycleExitOnce = (input, call, signal, expected) => callDocumentLifecycle('revit.lifecycle.post_exit_once', input, call, signal, expected);
export const openSavedCopyOnce = (input, call, signal, expected) => callDocumentLifecycle('revit.lifecycle.open_saved_copy_once', input, call, signal, expected);
export const stopLifecycle = (input, call, signal, expected) => callDocumentLifecycle('revit.lifecycle.stop', input, call, signal, expected);
