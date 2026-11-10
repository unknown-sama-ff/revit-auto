#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { callRevit } from './bridge.mjs';

// The batch runner is intentionally narrower than the complete MCP surface.
// A scope must name one of these read-only MCP tools; no plan or lifecycle
// action can be smuggled into a baseline run through a JSON scope file.
export const READONLY_TOOLS = new Set([
  'revit_search',
  'revit_inspect',
  'revit_type_resolve',
  'revit_families_audit',
  'revit_family_library_get',
  'revit_saved_verify',
  'revit_view_get',
  'revit_room_get',
  'revit_element_dependencies',
  'revit_stairs_connections',
  'revit_sheet_layout',
  'revit_electrical_audit',
  'revit_audit_run',
  'revit_flow_diagnose',
  'revit_collision_check',
  'revit_connector_resolve'
]);

// Match action tokens, so the explicitly allowed saved-state reader is not
// confused with a save action. The exact tool whitelist remains mandatory.
const FORBIDDEN_TOOL = /(?:plan_(?:create|confirm|cancel|get)|import_(?:commit|preview)|lifecycle_(?:save_once|post_exit_once|open_saved_copy_once|stop)|(?:^|_)(?:commit|save|restart|exit)(?:_|$))/i;
const MVID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TASK_ID = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const CONTRACT_SCHEMA_VERSION = 1;

function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function contractDigest(tools) {
  return createHash('sha256').update(JSON.stringify(canonicalize(tools))).digest('hex');
}

function contractDescriptor(tool) {
  return {
    name: tool.name,
    annotations: clone(tool.annotations),
    inputSchema: clone(tool.inputSchema)
  };
}

function buildContractSnapshot(tools, names) {
  const wanted = new Set(['revit_context_get', ...names]);
  const descriptors = tools.filter((tool) => wanted.has(tool.name)).map(contractDescriptor).sort((left, right) => left.name.localeCompare(right.name));
  return { schemaVersion: CONTRACT_SCHEMA_VERSION, tools: descriptors, sha256: contractDigest(descriptors) };
}

function assertContractDescriptor(descriptor, { requirePins = true } = {}) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor) ||
      typeof descriptor.name !== 'string' || !descriptor.name ||
      !descriptor.annotations || descriptor.annotations.readOnlyHint !== true || descriptor.annotations.destructiveHint !== false ||
      !descriptor.inputSchema || typeof descriptor.inputSchema !== 'object' || Array.isArray(descriptor.inputSchema) ||
      !descriptor.inputSchema.properties || typeof descriptor.inputSchema.properties !== 'object' || Array.isArray(descriptor.inputSchema.properties) ||
      (requirePins && (!Object.hasOwn(descriptor.inputSchema.properties, 'documentIdentity') || !Object.hasOwn(descriptor.inputSchema.properties, 'expectedRevision')))) {
    fail('invalid_evidence_contract', 'Baseline MCP contract snapshot is incomplete or not read-only with both document pins.');
  }
}

function assertContractSnapshot(contract, scopes) {
  if (!contract || contract.schemaVersion !== CONTRACT_SCHEMA_VERSION || !Array.isArray(contract.tools) ||
      typeof contract.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(contract.sha256) ||
      contractDigest(contract.tools) !== contract.sha256) {
    fail('invalid_evidence_contract', 'Baseline MCP contract snapshot is missing or has a mismatched digest.');
  }
  const descriptors = new Map();
  for (const descriptor of contract.tools) {
    assertContractDescriptor(descriptor, { requirePins: descriptor.name !== 'revit_context_get' });
    if (descriptors.has(descriptor.name)) fail('invalid_evidence_contract', 'Baseline MCP contract snapshot contains duplicate tools.');
    descriptors.set(descriptor.name, descriptor);
  }
  const context = descriptors.get('revit_context_get');
  if (!context) fail('invalid_evidence_contract', 'Baseline MCP contract snapshot is missing revit_context_get.');
  assertContractDescriptor(context, { requirePins: false });
  for (const scope of scopes) {
    if (!descriptors.has(scope.tool)) fail('invalid_evidence_contract', `Baseline scope ${scope.id} is absent from the MCP contract snapshot.`);
  }
}

function assertPlugin(plugin, expectedBuild, expectedMvid) {
  if (!plugin || plugin.protocol !== 'revit-auto-2027-v2') {
    fail('native_candidate_not_loaded', 'The active Revit bridge is not the supported protocol.');
  }
  if (expectedBuild !== undefined && plugin.informationalVersion !== expectedBuild) {
    fail('native_candidate_not_loaded', `Expected build ${expectedBuild}, got ${plugin.informationalVersion || 'unknown'}.`);
  }
  if (typeof plugin.moduleVersionId !== 'string' || !MVID.test(plugin.moduleVersionId)) {
    fail('native_build_identity_unknown', 'The loaded assembly has no verified module identity.');
  }
  if (expectedMvid !== undefined && plugin.moduleVersionId.toLowerCase() !== expectedMvid.toLowerCase()) {
    fail('native_candidate_not_loaded', `Expected module version ID ${expectedMvid}, got ${plugin.moduleVersionId}.`);
  }
  if (!Array.isArray(plugin.features) || plugin.features.some((feature) => typeof feature !== 'string')) {
    fail('native_build_identity_unknown', 'The loaded assembly did not report a valid capability list.');
  }
  if (typeof plugin.revitVersion !== 'string' || !plugin.revitVersion.trim() || typeof plugin.revitBuild !== 'string' || !plugin.revitBuild.trim()) {
    fail('native_build_identity_unknown', 'The Revit product version/build is unknown.');
  }
  if (!Number.isSafeInteger(plugin.pid) || plugin.pid <= 0) {
    fail('native_build_identity_unknown', 'The loaded Revit process identity is unknown.');
  }
  return plugin;
}

function assertContext(context, project) {
  if (!context?.active || !context.document || typeof context.document.identity !== 'string' || !context.document.identity) {
    fail('native_context_unknown', 'The current Revit document has no verified identity.');
  }
  if (!Number.isSafeInteger(context.document.revision) || context.document.revision < 0) {
    fail('native_context_unknown', 'The current Revit document has no verified revision.');
  }
  if (typeof context.document.isModified !== 'boolean' || !context.counts || Array.isArray(context.counts)) {
    fail('native_context_unknown', 'The current Revit document has no complete saved-state/counts snapshot.');
  }
  for (const [category, count] of Object.entries(context.counts)) {
    if (!Number.isSafeInteger(count) || count < 0) fail('native_context_unknown', `Invalid count for ${category}.`);
  }
  if (typeof context.document.path !== 'string' || !context.document.path) {
    fail('native_context_unknown', 'The active Revit document path is unknown.');
  }
  if (project && path.resolve(context.document.path).toLowerCase() !== path.resolve(project).toLowerCase()) {
    fail('native_project_mismatch', 'The active project is not the exact reviewed test project.');
  }
  return context;
}

function assertScope(scope, index) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) fail('invalid_readonly_scope', `Scope ${index + 1} must be an object.`);
  if (typeof scope.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,79}$/.test(scope.id)) fail('invalid_readonly_scope', `Scope ${index + 1} has an invalid id.`);
  if (typeof scope.tool !== 'string' || !READONLY_TOOLS.has(scope.tool) || FORBIDDEN_TOOL.test(scope.tool)) {
    fail('readonly_tool_not_allowed', `Scope ${scope.id} is not an allowed read-only tool.`);
  }
  if (scope.args !== undefined && (!scope.args || typeof scope.args !== 'object' || Array.isArray(scope.args))) {
    fail('invalid_readonly_scope', `Scope ${scope.id} args must be an object.`);
  }
  if (scope.taskIds !== undefined && (!Array.isArray(scope.taskIds) || scope.taskIds.some((id) => typeof id !== 'string' || !TASK_ID.test(id)))) {
    fail('invalid_readonly_scope', `Scope ${scope.id} taskIds must be an array of strings.`);
  }
  return { id: scope.id, tool: scope.tool, args: scope.args || {}, taskIds: scope.taskIds || [] };
}

function pinnedArgs(scope, pin, toolByName) {
  const tool = toolByName.get(scope.tool);
  const args = { ...scope.args };
  for (const [field, value] of [['documentIdentity', pin.identity], ['expectedRevision', pin.revision]]) {
    if (Object.hasOwn(args, field) && args[field] !== value) {
      fail('scope_pin_mismatch', `Scope ${scope.id} contains a stale ${field}.`);
    }
    args[field] = value;
  }
  return args;
}

function assertReadOnlyResult(scope, result) {
  if (!result || typeof result !== 'object') return;
  if (result.readOnly === false) {
    fail('readonly_scope_mutated', `Scope ${scope.id} returned evidence that is not read-only.`);
  }
  const mutationFlags = new Set([
    'automaticSave', 'automaticRestart', 'commitPerformed', 'exitPerformed',
    'modelMutated', 'modelWritePerformed', 'mutationPerformed', 'planCreated',
    'restartPerformed', 'savePerformed', 'writePerformed'
  ]);
  const mutationCounters = new Set([
    'automaticRetries', 'confirmCalls', 'modelWritesRequested', 'planCreateCalls',
    'restartCalls', 'saveCalls'
  ]);
  const pending = [result];
  const seen = new Set();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if ((mutationFlags.has(key) && child === true) ||
          (mutationCounters.has(key) && typeof child === 'number' && child > 0)) {
        fail('readonly_scope_mutated', `Scope ${scope.id} returned evidence that is not read-only.`);
      }
      if (child && typeof child === 'object') pending.push(child);
    }
  }
}

function assertStableContext(before, after) {
  if (!isDeepStrictEqual(before.document, after.document) || !isDeepStrictEqual(before.counts, after.counts)) {
    fail('native_read_state_changed', 'Document identity, revision, saved state or counts changed during the read-only batch.');
  }
}

export async function runReadonlyBatch({ runId, taskId, expectedBuild, expectedMvid, project, scopes, bridgeCall, toolCall, tools, now = () => new Date().toISOString() }) {
  if (typeof bridgeCall !== 'function' || typeof toolCall !== 'function') fail('invalid_batch_runner', 'bridgeCall and toolCall are required.');
  if (typeof runId !== 'string' || !RUN_ID.test(runId) || typeof taskId !== 'string' || !TASK_ID.test(taskId)) {
    fail('invalid_run_identity', 'A UUIDv7 runId and registered taskId are required before a baseline can be captured.');
  }
  if (expectedMvid !== undefined && (typeof expectedMvid !== 'string' || !MVID.test(expectedMvid))) {
    fail('invalid_expected_mvid', 'expectedMvid must be a valid module version ID.');
  }
  if (!Array.isArray(tools)) fail('readonly_tool_contract_missing', 'Pass the current MCP listTools contract so every scope can be checked as read-only.');
  if (!Array.isArray(scopes) || scopes.length < 1 || scopes.length > 200) fail('invalid_readonly_scope', 'Provide 1 to 200 explicit read-only scopes.');

  const normalized = scopes.map(assertScope);
  const ids = new Set();
  for (const scope of normalized) {
    if (ids.has(scope.id)) fail('duplicate_readonly_scope', `Scope id '${scope.id}' is duplicated.`);
    ids.add(scope.id);
  }
  const contract = buildContractSnapshot(tools, normalized.map((scope) => scope.tool));

  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const contextTool = toolByName.get('revit_context_get');
  if (!contextTool || contextTool.annotations?.readOnlyHint !== true || contextTool.annotations?.destructiveHint !== false ||
      !contextTool.inputSchema || !contextTool.inputSchema.properties || typeof contextTool.inputSchema.properties !== 'object') {
    fail('readonly_tool_not_verified', 'MCP contract does not declare revit_context_get read-only.');
  }
  for (const scope of normalized) {
    const tool = toolByName.get(scope.tool);
    if (!tool || tool.annotations?.readOnlyHint !== true || tool.annotations?.destructiveHint !== false ||
        !tool.inputSchema || !tool.inputSchema.properties || typeof tool.inputSchema.properties !== 'object' || Array.isArray(tool.inputSchema.properties) ||
        !Object.hasOwn(tool.inputSchema.properties, 'documentIdentity') || !Object.hasOwn(tool.inputSchema.properties, 'expectedRevision')) {
      fail('readonly_tool_not_verified', `MCP contract does not declare ${scope.tool} read-only with both document pins.`);
    }
  }
  const plugin = assertPlugin(await bridgeCall('revit.bridge.info'), expectedBuild, expectedMvid);
  if (!plugin.features?.includes('readonly-query-pins')) {
    fail('native_candidate_not_loaded', 'The active Revit plugin does not enforce the read-only query pins.');
  }
  const before = assertContext(await toolCall('revit_context_get', {}), project);
  const pin = { identity: before.document.identity, revision: before.document.revision };
  const pinnedScopes = normalized.map((scope) => ({ ...scope, args: pinnedArgs(scope, pin, toolByName) }));
  const results = [];
  for (const scope of pinnedScopes) {
    let value;
    try {
      value = await toolCall(scope.tool, scope.args);
      assertReadOnlyResult(scope, value);
    } catch (error) {
      results.push({ id: scope.id, tool: scope.tool, taskIds: scope.taskIds, status: 'failed', error: { code: error.code || 'readonly_scope_failed', message: error.message } });
      continue;
    }
    results.push({ id: scope.id, tool: scope.tool, taskIds: scope.taskIds, status: 'captured', result: clone(value) });
  }

  const after = assertContext(await toolCall('revit_context_get', {}), project);
  assertStableContext(before, after);
  const afterPlugin = assertPlugin(await bridgeCall('revit.bridge.info'), expectedBuild, expectedMvid);
  if (afterPlugin.moduleVersionId !== plugin.moduleVersionId || afterPlugin.pid !== plugin.pid ||
      afterPlugin.informationalVersion !== plugin.informationalVersion ||
      afterPlugin.revitVersion !== plugin.revitVersion || afterPlugin.revitBuild !== plugin.revitBuild) {
    fail('native_host_changed', 'The Revit process or loaded assembly changed during the read-only batch.');
  }

  return {
    schemaVersion: 1,
    artifactType: 'baseline',
    runId,
    taskId,
    capturedAtUtc: now(),
    status: results.every((scope) => scope.status === 'captured') && after.document.isModified === false ? 'accepted' : 'unknown',
    readOnly: true,
    plugin: clone(plugin),
    document: clone(after.document),
    contract,
    before: clone(before),
    after: clone(after),
    scopes: results,
    comparison: { documentAndCountsUnchanged: true, documentWasSaved: after.document.isModified === false, pluginIdentityUnchanged: true },
    sideEffectCounters: { planCreateCalls: 0, confirmCalls: 0, modelWritesRequested: 0, saveCalls: 0, restartCalls: 0, automaticRetries: 0 }
  };
}

export async function writeBaselineEvidence(runDirectory, evidence, repoRoot) {
  if (!path.isAbsolute(runDirectory)) fail('invalid_evidence_path', 'runDirectory must be absolute.');
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) fail('invalid_evidence_path', 'An absolute repository root is required.');
  if (!evidence || evidence.artifactType !== 'baseline') fail('invalid_evidence', 'Only baseline evidence can be written by this helper.');
  runDirectory = await assertRunDirectory(runDirectory, repoRoot);
  const directoryStat = await fs.lstat(runDirectory).catch(() => null);
  if (!directoryStat?.isDirectory() || directoryStat.isSymbolicLink()) {
    fail('invalid_evidence_path', 'runDirectory must be a real directory.');
  }
  const manifestPath = path.join(runDirectory, 'manifest.json');
  const baselinePath = path.join(runDirectory, 'baseline.json');
  let existingBaseline;
  for (const [name, filePath] of [['manifest', manifestPath], ['baseline', baselinePath]]) {
    const stat = await fs.lstat(filePath).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat?.isSymbolicLink() || (stat && !stat.isFile())) {
      fail('invalid_evidence_path', `${name} evidence path must be a regular file.`);
    }
    if (name === 'baseline') existingBaseline = stat;
  }
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest?.schemaVersion !== 1 || manifest?.artifactType !== 'manifest' ||
      typeof manifest.runId !== 'string' || !RUN_ID.test(manifest.runId) ||
      typeof manifest.taskId !== 'string' || !TASK_ID.test(manifest.taskId)) {
    fail('invalid_manifest', 'Run manifest has an invalid schema, runId or taskId.');
  }
  if (manifest.runId !== path.basename(runDirectory)) {
    fail('invalid_manifest', 'Run directory name does not match manifest.runId.');
  }
  if (manifest.baseline !== undefined && manifest.baseline !== 'baseline.json') {
    fail('invalid_manifest', 'Run manifest points to an unexpected baseline artifact.');
  }
  if (manifest.baseline === 'baseline.json' || existingBaseline) {
    fail('EEXIST', 'Run manifest already records a baseline artifact.');
  }
  if (manifest.status !== 'initialized') {
    fail('invalid_manifest', 'Only an initialized run can receive its first baseline.');
  }
  if (manifest.runId !== evidence.runId) fail('run_id_mismatch', 'Baseline runId does not match manifest.');
  if (manifest.taskId !== evidence.taskId) fail('task_id_mismatch', 'Baseline taskId does not match manifest.');
  assertBaselineEvidence(evidence);
  const output = { ...evidence, runId: manifest.runId, taskId: manifest.taskId };
  const baselineTempPath = path.join(runDirectory, `.baseline.${process.pid}.${randomUUID()}.tmp`);
  const manifestTempPath = path.join(runDirectory, `.manifest.${process.pid}.${randomUUID()}.tmp`);
  let baselineCommitted = false;
  try {
    await fs.writeFile(baselineTempPath, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
    await fs.link(baselineTempPath, baselinePath);
    baselineCommitted = true;
    await fs.unlink(baselineTempPath);
    const updatedManifest = { ...manifest, status: output.status, plugin: output.plugin, document: output.document, baseline: 'baseline.json' };
    await fs.writeFile(manifestTempPath, `${JSON.stringify(updatedManifest, null, 2)}\n`, { flag: 'wx' });
    await fs.rename(manifestTempPath, manifestPath);
  } catch (error) {
    await Promise.all([
      fs.rm(baselineTempPath, { force: true }).catch(() => {}),
      fs.rm(manifestTempPath, { force: true }).catch(() => {})
    ]);
    if (baselineCommitted) await fs.rm(baselinePath, { force: true }).catch(() => {});
    throw error;
  }
  return baselinePath;
}

function assertBaselineEvidence(evidence) {
  const timestamp = typeof evidence.capturedAtUtc === 'string' ? Date.parse(evidence.capturedAtUtc) : NaN;
  const plugin = evidence.plugin;
  const document = evidence.document;
  const before = evidence.before;
  const after = evidence.after;
  const counters = evidence.sideEffectCounters;
  const contract = evidence.contract;
  const counterKeys = ['planCreateCalls', 'confirmCalls', 'modelWritesRequested', 'saveCalls', 'restartCalls', 'automaticRetries'];
  const scopes = evidence.scopes;
  if (evidence.schemaVersion !== 1 || !RUN_ID.test(evidence.runId || '') || !TASK_ID.test(evidence.taskId || '') ||
      !Number.isFinite(timestamp) || evidence.status !== 'accepted' && evidence.status !== 'unknown' || evidence.readOnly !== true ||
      !plugin || plugin.protocol !== 'revit-auto-2027-v2' || typeof plugin.informationalVersion !== 'string' ||
      !MVID.test(plugin.moduleVersionId || '') || !Array.isArray(plugin.features) || !plugin.features.includes('readonly-query-pins') ||
      !Number.isSafeInteger(plugin.pid) || plugin.pid <= 0 || typeof plugin.revitVersion !== 'string' || !plugin.revitVersion ||
      typeof plugin.revitBuild !== 'string' || !plugin.revitBuild ||
      !document || typeof document.identity !== 'string' || !document.identity ||
      !Number.isSafeInteger(document.revision) || document.revision < 0 || typeof document.path !== 'string' || !document.path ||
      typeof document.isModified !== 'boolean' || !before?.active || !after?.active || !before || !after ||
      !isDeepStrictEqual(before.document, document) || !isDeepStrictEqual(after.document, document) ||
      !before.counts || Array.isArray(before.counts) || !after.counts || Array.isArray(after.counts) ||
      !isDeepStrictEqual(before.counts, after.counts) || !evidence.comparison ||
      evidence.comparison.documentAndCountsUnchanged !== true || evidence.comparison.pluginIdentityUnchanged !== true ||
      evidence.comparison.documentWasSaved !== (document.isModified === false) ||
      !counters || counterKeys.some((key) => !Number.isSafeInteger(counters[key]) || counters[key] !== 0) ||
      !Array.isArray(scopes) || scopes.length < 1) {
    fail('invalid_evidence', 'Baseline evidence is missing valid host, document, comparison, scope or side-effect evidence.');
  }
  assertContractSnapshot(contract, scopes);
  const ids = new Set();
  for (const scope of scopes) {
    if (!scope || typeof scope !== 'object' || Array.isArray(scope) || typeof scope.id !== 'string' ||
        !/^[a-z0-9][a-z0-9._-]{1,79}$/.test(scope.id) || ids.has(scope.id) ||
        typeof scope.tool !== 'string' || !READONLY_TOOLS.has(scope.tool) ||
        !Array.isArray(scope.taskIds) || scope.taskIds.some((taskId) => typeof taskId !== 'string' || !TASK_ID.test(taskId)) ||
        !['captured', 'failed'].includes(scope.status) ||
        (scope.status === 'captured' && (!scope.result || typeof scope.result !== 'object')) ||
        (scope.status === 'failed' && (!scope.error || typeof scope.error.code !== 'string' || typeof scope.error.message !== 'string'))) {
      fail('invalid_evidence', 'Baseline scope evidence is malformed or duplicated.');
    }
    if (scope.status === 'captured') assertReadOnlyResult(scope, scope.result);
    ids.add(scope.id);
  }
  const acceptedByEvidence = scopes.every((scope) => scope.status === 'captured') && document.isModified === false;
  if ((evidence.status === 'accepted') !== acceptedByEvidence) {
    fail('invalid_evidence_status', 'Baseline acceptance must be derived from complete captured scopes and a saved document.');
  }
}

export async function assertRunDirectory(runDirectory, repoRoot) {
  const canonicalRepoRoot = await fs.realpath(repoRoot).catch(() => null);
  if (!canonicalRepoRoot) fail('invalid_evidence_path', 'Repository root must exist.');
  const acceptanceRoot = path.join(canonicalRepoRoot, 'acceptance');
  const runsRoot = path.join(acceptanceRoot, 'runs');
  const lexicalRunsRoot = path.resolve(repoRoot, 'acceptance', 'runs');
  for (const [label, directory] of [['acceptance', acceptanceRoot], ['runs', runsRoot]]) {
    const stat = await fs.lstat(directory).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      fail('invalid_evidence_path', `${label} evidence directory must be a real directory.`);
    }
  }
  const candidate = path.resolve(runDirectory);
  const relative = path.relative(lexicalRunsRoot, candidate);
  if (!relative || !RUN_ID.test(path.basename(candidate)) || path.dirname(candidate) !== lexicalRunsRoot || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('invalid_evidence_path', 'Run directory must be a direct child of acceptance/runs.');
  }
  const candidateStat = await fs.lstat(candidate).catch(() => null);
  if (!candidateStat?.isDirectory() || candidateStat.isSymbolicLink()) {
    fail('invalid_evidence_path', 'Run directory must be an existing real directory.');
  }
  const [realRoot, realCandidate] = await Promise.all([fs.realpath(runsRoot), fs.realpath(candidate)]);
  const realRelative = path.relative(realRoot, realCandidate);
  if (!realRelative || realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    fail('invalid_evidence_path', 'Run directory resolves outside acceptance/runs.');
  }
  return realCandidate;
}

async function readInitialManifest(runDirectory) {
  const manifestPath = path.join(runDirectory, 'manifest.json');
  const stat = await fs.lstat(manifestPath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) fail('invalid_manifest', 'Run manifest must be a regular file.');
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    fail('invalid_manifest', 'Run manifest is missing or invalid JSON.');
  }
  if (manifest?.schemaVersion !== 1 || manifest?.artifactType !== 'manifest' || manifest.status !== 'initialized' ||
      typeof manifest.runId !== 'string' || !RUN_ID.test(manifest.runId) || manifest.runId !== path.basename(runDirectory) ||
      typeof manifest.taskId !== 'string' || !TASK_ID.test(manifest.taskId)) {
    fail('invalid_manifest', 'Run manifest identity, status or schema is invalid.');
  }
  return manifest;
}

async function runCli() {
  const args = process.argv.slice(2);
  const value = (name) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
  const runDirectory = value('run-dir');
  const project = value('project');
  const expectedBuild = value('build');
  const expectedMvid = value('mvid');
  const scopesPath = value('scopes');
  if (!runDirectory || !project || !expectedBuild || !expectedMvid || !scopesPath) throw new Error('Usage: node mcp/readonly-batch.mjs --run-dir ACCEPTANCE_RUN_DIR --project TEST_COPY.rvt --build INFORMATIONAL_VERSION --mvid MODULE_VERSION_ID --scopes READONLY_SCOPES.json');
  const scopes = JSON.parse(await fs.readFile(path.resolve(scopesPath), 'utf8'));
  const root = path.resolve(import.meta.dirname, '..');
  const safeRunDirectory = await assertRunDirectory(runDirectory, root);
  const initialManifest = await readInitialManifest(safeRunDirectory);
  const client = new Client({ name: 'revit-readonly-batch', version: '0.4.0' });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, 'mcp/revit-custom.mjs')],
      stderr: 'pipe',
      env: { REVIT_AI_READONLY_BRIDGE_INFO_CACHE_MS: '120000' }
    }));
    const toolCall = async (name, input) => {
      const response = await client.callTool({ name, arguments: input });
      const data = JSON.parse(response.content[0].text);
      if (response.isError) fail(data.code || 'readonly_scope_failed', data.message || `MCP tool ${name} failed.`);
      return data;
    };
    const contract = await client.listTools();
    const evidence = await runReadonlyBatch({ runId: initialManifest.runId, taskId: initialManifest.taskId, expectedBuild, expectedMvid, project: path.resolve(project), scopes, bridgeCall: callRevit, toolCall, tools: contract.tools });
    const baselinePath = await writeBaselineEvidence(safeRunDirectory, evidence, root);
    const manifest = JSON.parse(await fs.readFile(path.join(safeRunDirectory, 'manifest.json'), 'utf8'));
    process.stdout.write(`${JSON.stringify({ status: evidence.status, runId: manifest.runId, taskId: manifest.taskId, scopeCount: evidence.scopes.length, failedScopes: evidence.scopes.filter((scope) => scope.status === 'failed').map((scope) => scope.id), baselinePath, modelWritesRequested: 0 }, null, 2)}\n`);
  } finally {
    await client.close();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runCli().catch((error) => { process.stderr.write(`${JSON.stringify({ status: 'NOT_VERIFIED', code: error.code || 'readonly_batch_failed', message: error.message, details: error.details }, null, 2)}\n`); process.exitCode = 1; });
}
