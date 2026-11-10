#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { callRevit } from './bridge.mjs';
import { diagnoseSheetLayout } from './sheet-layout.mjs';

export const FORMAT_VERSION = 1;
export const REQUIRED_FEATURE = 'sheet-layout-diagnostics';
export const NATIVE_READ_METHODS = Object.freeze([
  'revit.bridge.info',
  'revit.context.get',
  'revit.search',
  'revit.sheet.layout'
]);
const NATIVE_READ_METHOD_SET = new Set(NATIVE_READ_METHODS);
const IDENTITY_RE = /^[a-f0-9]{32}$/i;
const MVID_RE = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function samePath(first, second) {
  return path.resolve(first).toLowerCase() === path.resolve(second).toLowerCase();
}

function assertSafeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail('sheet_acceptance_invalid_native', `${label} is not a valid native integer.`);
}

export function validateBridgeInfo(info, expectedMvid) {
  if (!info || info.protocol !== 'revit-auto-2027-v2') fail('sheet_acceptance_plugin_invalid', 'The loaded bridge protocol is not revit-auto-2027-v2.');
  if (typeof info.moduleVersionId !== 'string' || !MVID_RE.test(info.moduleVersionId)) fail('sheet_acceptance_plugin_invalid', 'The loaded plugin has no valid moduleVersionId.');
  if (expectedMvid !== undefined && info.moduleVersionId.toLowerCase() !== String(expectedMvid).toLowerCase()) fail('sheet_acceptance_plugin_mismatch', 'The loaded plugin moduleVersionId differs from the reviewed build.');
  if (!Array.isArray(info.features) || new Set(info.features).size !== info.features.length) fail('sheet_acceptance_plugin_invalid', 'The loaded plugin feature list is missing or duplicated.');
  if (!info.features.includes(REQUIRED_FEATURE)) fail('feature_not_loaded', `The running Revit plugin lacks ${REQUIRED_FEATURE}. Restart Revit with the registered diagnostic build.`);
  if (typeof info.version !== 'string' || !info.version.trim()) fail('sheet_acceptance_plugin_invalid', 'The loaded plugin version is missing.');
  if (typeof info.confirmationMode !== 'string' || info.confirmationMode !== 'chat') fail('sheet_acceptance_plugin_invalid', 'The loaded plugin confirmation mode is not chat.');
  if (info.requiresRevitConfirmation !== false) fail('sheet_acceptance_plugin_invalid', 'The loaded plugin still requires a Revit confirmation dialog.');
  return info;
}

export function validateContext(context, expectedProject, { allowIdentityChange = false, expectedIdentity } = {}) {
  if (!context || context.active !== true) fail('sheet_acceptance_no_active_document', 'A project must be active before read-only sheet acceptance.');
  const document = context.document;
  if (!document || typeof document.path !== 'string' || !samePath(document.path, expectedProject)) fail('sheet_acceptance_project_mismatch', 'The active project is not the explicitly reviewed test copy.');
  if (typeof document.identity !== 'string' || !IDENTITY_RE.test(document.identity)) fail('sheet_acceptance_document_invalid', 'The active document identity is not a native session identity.');
  assertSafeInteger(document.revision, 'document.revision');
  if (typeof document.isModified !== 'boolean' || document.isModified !== false) fail('sheet_acceptance_unsaved', 'The reviewed test copy must be saved before read-only acceptance.');
  if (typeof document.isReadOnly !== 'boolean' || document.isReadOnly !== false) fail('sheet_acceptance_read_only', 'The reviewed test copy must be writable for acceptance.');
  if (document.isFamilyDocument !== false) fail('sheet_acceptance_family_document', 'The native context must explicitly identify a project document.');
  if (!context.counts || typeof context.counts !== 'object' || Array.isArray(context.counts) || Object.values(context.counts).some(count => !Number.isSafeInteger(count) || count < 0)) fail('sheet_acceptance_counts_invalid', 'The native context category counts are invalid.');
  if (expectedIdentity !== undefined && !allowIdentityChange && document.identity !== expectedIdentity) fail('sheet_acceptance_document_changed', 'The native document session changed during one acceptance pass.');
  return document;
}

function selectedCategories(context, requested) {
  const available = context.counts && typeof context.counts === 'object' && !Array.isArray(context.counts)
    ? Object.keys(context.counts).filter(category => category.startsWith('OST_')).sort()
    : [];
  const categories = requested === undefined
    ? available
    : [...new Set(String(requested).split(',').map(value => value.trim()).filter(Boolean))].sort();
  if (!categories.includes('OST_Sheets')) categories.push('OST_Sheets');
  categories.sort();
  for (const category of categories) {
    if (!/^OST_[A-Za-z0-9_]+$/.test(category)) fail('sheet_acceptance_category_invalid', `Invalid category '${category}'.`);
    if (!Object.hasOwn(context.counts || {}, category)) fail('sheet_acceptance_category_unknown', `The active context has no count for ${category}.`);
    assertSafeInteger(context.counts[category], `counts.${category}`);
  }
  return categories;
}

async function categoryIds(call, category) {
  const ids = [];
  let offset = 0;
  for (;;) {
    const page = await call('revit.search', { category, limit: 500, offset });
    if (!page || page.offset !== offset || page.limit !== 500 || typeof page.hasMore !== 'boolean' || !Array.isArray(page.items) || page.items.length > 500)
      fail('sheet_acceptance_search_invalid', `The native search page for ${category} is malformed.`);
    for (const item of page.items) {
      assertSafeInteger(item?.id, `${category} element id`, 1);
      ids.push(item.id);
    }
    if (!page.hasMore) break;
    if (!page.items.length || ids.length > 100000) fail('sheet_acceptance_search_invalid', `The native search pagination for ${category} cannot be completed safely.`);
    offset += page.items.length;
  }
  if (new Set(ids).size !== ids.length) fail('sheet_acceptance_search_invalid', `The native search for ${category} returned duplicate IDs.`);
  return ids.sort((a, b) => a - b);
}

export async function readCategoryScope(call, context, requested) {
  const categories = selectedCategories(context, requested);
  const scope = {};
  for (const category of categories) {
    const ids = await categoryIds(call, category);
    if (ids.length !== context.counts[category]) fail('sheet_acceptance_category_mismatch', `${category} search membership does not match the native context count.`);
    scope[category] = { count: context.counts[category], ids };
  }
  return scope;
}

function validateSheetReport(report, document, sheetId) {
  assertSafeInteger(sheetId, 'sheetId', 1);
  if (!report || report.status !== 'read_only_result' || report.readOnly !== true || report.planCreated !== false || report.modelWritesRequested !== false || report.automaticSave !== false || report.allModelSideEffectsVerified !== false)
    fail('sheet_acceptance_report_invalid', 'The sheet diagnostic did not return the declared read-only contract.');
  if (report.documentIdentity !== document.identity || report.documentRevision !== document.revision || report.sheetId !== sheetId)
    fail('sheet_acceptance_report_scope_mismatch', 'The sheet diagnostic is not pinned to the current document session, revision and sheet.');
  for (const key of ['titleBlocks', 'viewports', 'schedulePlacements', 'annotationPlacements', 'unknownGeometry', 'outOfSheet', 'intersectionCandidates'])
    if (!Array.isArray(report[key])) fail('sheet_acceptance_report_invalid', `The sheet diagnostic field ${key} is missing.`);
  if (typeof report.complete !== 'boolean' || typeof report.intersectionCandidateCount !== 'number' || typeof report.intersectionCandidatesTruncated !== 'boolean')
    fail('sheet_acceptance_report_invalid', 'The sheet diagnostic completeness fields are missing.');
  return report;
}

function comparableSheetReport(report) {
  const value = structuredClone(report);
  delete value.documentIdentity;
  delete value.documentRevision;
  return value;
}

async function runReadOnly(call, method, args = {}) {
  if (!NATIVE_READ_METHOD_SET.has(method)) fail('sheet_acceptance_write_blocked', `Method ${method} is outside the read-only acceptance allowlist.`);
  const result = await call(method, args);
  if (method === 'revit.sheet.layout' && (result?.modelWritesRequested !== false || result?.automaticSave !== false || result?.allModelSideEffectsVerified !== false)) fail('sheet_acceptance_native_contract_invalid', 'The raw native sheet response lacks its explicit read-only declarations.');
  return result;
}

async function stableRead(call, expectedProject, identity) {
  const context = await runReadOnly(call, 'revit.context.get');
  validateContext(context, expectedProject, { expectedIdentity: identity });
  return context;
}

function compareContexts(before, after, expectedProject, { allowIdentityChange = false } = {}) {
  validateContext(before, expectedProject);
  validateContext(after, expectedProject, { allowIdentityChange, expectedIdentity: before.document.identity });
  if (before.document.path.toLowerCase() !== after.document.path.toLowerCase() || before.document.revision !== after.document.revision || before.document.isModified !== after.document.isModified || before.document.isReadOnly !== after.document.isReadOnly)
    fail('sheet_acceptance_state_changed', 'The project path, revision or saved state changed during the read-only probe.');
  for (const field of ['document', 'counts', 'activeView', 'selectedElementIds']) {
    if (!Object.hasOwn(before, field) || !Object.hasOwn(after, field) || !isDeepStrictEqual(before[field], after[field])) fail('sheet_acceptance_state_changed', `The complete native ${field} changed or is unavailable during the read-only probe.`);
  }
  return { pathStable: true, revisionStable: true, savedStateStable: true, identityChanged: before.document.identity !== after.document.identity };
}

export async function prepareSheetLayoutAcceptance({ project, sheetId, state, categories, expectedMvid }, nativeCall = callRevit) {
  if (typeof project !== 'string' || !project.trim() || !path.isAbsolute(project)) fail('sheet_acceptance_project_invalid', 'Specify the absolute path of the reviewed local test copy.');
  const expectedProject = path.resolve(project);
  const plugin = validateBridgeInfo(await runReadOnly(nativeCall, 'revit.bridge.info'), expectedMvid);
  const before = await runReadOnly(nativeCall, 'revit.context.get');
  validateContext(before, expectedProject);
  const categoryScope = await readCategoryScope((method, args) => runReadOnly(nativeCall, method, args), before, categories);
  if (!categoryScope.OST_Sheets.ids.includes(Number(sheetId))) fail('sheet_acceptance_sheet_missing', 'The explicitly reviewed sheet is absent from the complete sheet category scope.');
  const diagnostic = validateSheetReport(await diagnoseSheetLayout({
    documentIdentity: before.document.identity,
    expectedRevision: before.document.revision,
    sheetId: Number(sheetId)
  }, (method, args) => runReadOnly(nativeCall, method, args)), before.document, Number(sheetId));
  const after = await runReadOnly(nativeCall, 'revit.context.get');
  compareContexts(before, after, expectedProject);
  if (!isDeepStrictEqual(before.counts, after.counts)) fail('sheet_acceptance_counts_changed', 'The native category counts changed during the read-only probe.');
  const pluginAfter = validateBridgeInfo(await runReadOnly(nativeCall, 'revit.bridge.info'), plugin.moduleVersionId);
  if (!isDeepStrictEqual(pluginAfter, plugin)) fail('sheet_acceptance_plugin_changed', 'The loaded bridge changed during one read-only pass.');
  return {
    formatVersion: FORMAT_VERSION,
    acceptance: 'sheet-layout-read-only',
    expectedProject,
    sheetId: Number(sheetId),
    categories: Object.keys(categoryScope),
    plugin: { moduleVersionId: plugin.moduleVersionId, informationalVersion: plugin.informationalVersion ?? null, version: plugin.version, requiredFeature: REQUIRED_FEATURE },
    baseline: { document: before.document, counts: Object.fromEntries(Object.keys(categoryScope).map(category => [category, before.counts[category]])), categoryScope, diagnostic },
    modelWritesRequested: false,
    planCreated: false,
    confirmationCalls: 0,
    saveCalls: 0,
    lifecycleCalls: 0,
    automaticSave: false,
    wholeSheetLayoutAccepted: false,
    checkedAtUtc: new Date().toISOString()
  };
}

export async function verifySheetLayoutAcceptance(record, nativeCall = callRevit) {
  if (!record || record.formatVersion !== FORMAT_VERSION || record.acceptance !== 'sheet-layout-read-only') fail('sheet_acceptance_record_invalid', 'The sheet acceptance record is invalid.');
  if (typeof record.expectedProject !== 'string' || !path.isAbsolute(record.expectedProject)) fail('sheet_acceptance_record_invalid', 'The acceptance record does not pin an absolute test-copy path.');
  if (!Array.isArray(record.categories) || !record.categories.length || new Set(record.categories).size !== record.categories.length || !record.categories.includes('OST_Sheets') || !record.baseline?.document || !record.baseline?.categoryScope || !record.baseline?.counts) fail('sheet_acceptance_record_invalid', 'The acceptance record lacks complete category and document baselines.');
  const expectedProject = path.resolve(record.expectedProject);
  assertSafeInteger(record.sheetId, 'record.sheetId', 1);
  validateSheetReport(record.baseline.diagnostic, record.baseline.document, record.sheetId);
  if (!record.plugin?.moduleVersionId || !MVID_RE.test(record.plugin.moduleVersionId)) fail('sheet_acceptance_record_invalid', 'The reviewed plugin MVID is missing from the acceptance record.');
  const plugin = validateBridgeInfo(await runReadOnly(nativeCall, 'revit.bridge.info'), record.plugin.moduleVersionId);
  const before = await runReadOnly(nativeCall, 'revit.context.get');
  validateContext(before, expectedProject, { allowIdentityChange: true });
  const categoryScope = await readCategoryScope((method, args) => runReadOnly(nativeCall, method, args), before, record.categories.join(','));
  if (!isDeepStrictEqual(categoryScope, record.baseline.categoryScope)) fail('sheet_acceptance_category_changed', 'The selected native category membership changed after reopen.');
  if (!categoryScope.OST_Sheets.ids.includes(record.sheetId)) fail('sheet_acceptance_sheet_missing', 'The reviewed sheet is absent from the complete sheet category scope.');
  const diagnostic = validateSheetReport(await diagnoseSheetLayout({
    documentIdentity: before.document.identity,
    expectedRevision: before.document.revision,
    sheetId: record.sheetId
  }, (method, args) => runReadOnly(nativeCall, method, args)), before.document, record.sheetId);
  if (!isDeepStrictEqual(comparableSheetReport(diagnostic), comparableSheetReport(record.baseline.diagnostic))) fail('sheet_acceptance_layout_changed', 'The native and derived sheet layout diagnostics changed after the prepared read.');
  const after = await stableRead(nativeCall, expectedProject, before.document.identity);
  compareContexts(before, after, expectedProject);
  if (!isDeepStrictEqual(Object.fromEntries(record.categories.map(category => [category, before.counts[category]])), record.baseline.counts)) fail('sheet_acceptance_counts_changed', 'The selected native category counts changed after reopen.');
  const pluginAfter = validateBridgeInfo(await runReadOnly(nativeCall, 'revit.bridge.info'), plugin.moduleVersionId);
  if (!isDeepStrictEqual(pluginAfter, plugin)) fail('sheet_acceptance_plugin_changed', 'The loaded bridge changed during one read-only pass.');
  return {
    ...record,
    status: before.document.identity === record.baseline.document.identity ? 'PASS_SHEET_LAYOUT_READ_ONLY_CURRENT_SESSION' : 'PASS_SHEET_LAYOUT_READ_ONLY_REOPEN',
    checkedAtUtc: new Date().toISOString(),
    pluginAfter: { moduleVersionId: plugin.moduleVersionId, informationalVersion: plugin.informationalVersion ?? null, version: plugin.version, requiredFeature: REQUIRED_FEATURE },
    documentBefore: before.document,
    documentAfter: after.document,
    identityChangedAfterReopen: before.document.identity !== record.baseline.document.identity,
    revisionAfterReopen: before.document.revision,
    categoryScopeAfterReopen: categoryScope,
    diagnosticAfterReopen: diagnostic,
    wholeSheetLayoutAccepted: false,
    verification: { pathVerified: samePath(before.document.path, expectedProject), savedStateVerified: before.document.isModified === false && after.document.isModified === false, revisionVerified: Number.isSafeInteger(before.document.revision) && before.document.revision >= 0 && before.document.revision === after.document.revision, categoryScopeVerified: true, moduleVersionVerified: plugin.moduleVersionId.toLowerCase() === record.plugin.moduleVersionId.toLowerCase(), sheetLayoutCapabilityVerified: plugin.features.includes(REQUIRED_FEATURE), identityChangedFromPreparedSession: before.document.identity !== record.baseline.document.identity, reopenVerified: before.document.identity !== record.baseline.document.identity, modelWritesRequested: false, planCreated: false, confirmationCalls: 0, saveCalls: 0, lifecycleCalls: 0, automaticSave: false }
  };
}

function option(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function evidencePath(value, { mustBeNew = false } = {}) {
  if (!value) fail('sheet_acceptance_output_missing', 'Specify an acceptance JSON path inside the package acceptance directory.');
  const root = path.resolve(import.meta.dirname, '..');
  const base = path.join(root, 'acceptance');
  const output = path.resolve(value);
  const relative = path.relative(base, output);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || path.extname(output).toLowerCase() !== '.json') fail('sheet_acceptance_output_invalid', 'Evidence must be a JSON file inside the package acceptance directory.');
  await fs.mkdir(path.dirname(output), { recursive: true });
  if (mustBeNew) {
    try { await fs.access(output); fail('sheet_acceptance_output_exists', 'Evidence file already exists; choose a new path.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return output;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!['prepare', 'verify'].includes(command)) throw new Error('Usage: node sheet-layout-acceptance.mjs prepare|verify ...');
  if (command === 'prepare') {
    const project = option(argv, 'project');
    if (!project || !path.isAbsolute(project)) fail('sheet_acceptance_project_invalid', 'prepare requires --project with an absolute test-copy path.');
    const expectedMvid = option(argv, 'expected-mvid');
    if (!expectedMvid) fail('sheet_acceptance_mvid_missing', 'prepare requires --expected-mvid from the independently reviewed registration request.');
    const state = await evidencePath(option(argv, 'state'), { mustBeNew: true });
    const sheetId = Number(option(argv, 'sheet'));
    assertSafeInteger(sheetId, '--sheet', 1);
    const record = await prepareSheetLayoutAcceptance({ project, sheetId, categories: option(argv, 'categories'), expectedMvid });
    await fs.writeFile(state, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: 'READ_ONLY_BASELINE_CAPTURED', stateFile: state, document: record.baseline.document, moduleVersionId: record.plugin.moduleVersionId, requiredFeature: REQUIRED_FEATURE, categories: record.categories, sheetId: record.sheetId, diagnosticComplete: record.baseline.diagnostic.complete, unknownGeometryCount: record.baseline.diagnostic.unknownGeometry.length, outOfSheetCount: record.baseline.diagnostic.outOfSheet.length, intersectionCandidateCount: record.baseline.diagnostic.intersectionCandidateCount, wholeSheetLayoutAccepted: false, modelWritesRequested: false, planCreated: false, confirmationCalls: 0, saveCalls: 0, lifecycleCalls: 0 }, null, 2));
    return;
  }
  const stateFile = await evidencePath(option(argv, 'state'));
  const record = JSON.parse((await fs.readFile(stateFile, 'utf8')).replace(/^\uFEFF/, ''));
  const verified = await verifySheetLayoutAcceptance(record);
  const output = await evidencePath(`${stateFile}.verified.json`, { mustBeNew: true });
  await fs.writeFile(output, JSON.stringify(verified, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: verified.status, evidenceFile: output, document: verified.documentAfter, moduleVersionId: verified.pluginAfter.moduleVersionId, identityChangedAfterReopen: verified.identityChangedAfterReopen, revisionAfterReopen: verified.revisionAfterReopen, categories: verified.categories, sheetId: verified.sheetId, diagnosticComplete: verified.diagnosticAfterReopen.complete, unknownGeometryCount: verified.diagnosticAfterReopen.unknownGeometry.length, outOfSheetCount: verified.diagnosticAfterReopen.outOfSheet.length, intersectionCandidateCount: verified.diagnosticAfterReopen.intersectionCandidateCount, wholeSheetLayoutAccepted: false, verification: verified.verification }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(JSON.stringify({ status: 'NOT_VERIFIED', code: error.code || 'sheet_acceptance_failed', message: error.message, details: error.details }, null, 2)); process.exitCode = 1; });
