#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { callRevit } from './bridge.mjs';
import { stableContext, assertTestDocument } from './acceptance-helpers.mjs';
import { parseElectricalCircuitInput } from './electrical-circuit.mjs';
import { verifyExistingElectricalCircuitCreation } from './circuit-creation-verification.mjs';
import { discoverElectricalCircuitCandidates } from './circuit-candidates.mjs';

const argv = process.argv.slice(2);
const command = argv[0];
const option = name => {
  const index = argv.indexOf('--' + name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const root = path.resolve(import.meta.dirname, '..');
const originalProject = path.resolve(root, '../考生文件夹/sample-lighting-model.rvt');
const workspace = path.resolve(root);
const client = new Client({ name: 'electrical-circuit-acceptance', version: '0.4.0' });

async function call(name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  const raw = response.content?.[0]?.text;
  let data;
  try { data = JSON.parse(raw); }
  catch {
    const error = new Error(`MCP tool ${name} returned non-JSON error text: ${String(raw).slice(0, 1000)}`);
    error.code = 'mcp_non_json_error';
    throw error;
  }
  if (response.isError) {
    const error = new Error(data.message);
    error.code = data.code;
    error.details = data.details;
    throw error;
  }
  return data;
}

async function contextSeries() {
  const reads = [];
  for (let index = 0; index < 5; index += 1) reads.push(await call('revit_context_get'));
  const current = stableContext(reads);
  for (const read of reads) assertStableState(current, read);
  return current;
}

function requireStateFile() {
  const value = option('state');
  if (!value) throw new Error('Specify --state with an acceptance record path.');
  const state = path.resolve(value);
  const relative = path.relative(path.join(workspace, 'acceptance'), state);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || !state.endsWith('.json'))
    throw new Error('Acceptance records must remain in the package acceptance directory.');
  return state;
}

function parseReviewedInput(file) {
  const input = JSON.parse(file.replace(/^\uFEFF/, ''));
  const parsed = parseElectricalCircuitInput(input);
  if ((parsed.circuits ?? []).length !== 1 || (parsed.panelDistributionSystems ?? []).length || (parsed.parameterChanges ?? []).length ||
      (parsed.panelSchedules ?? []).length || (parsed.tags ?? []).length || (parsed.dimensions ?? []).length)
    throw new Error('This acceptance runner requires exactly one existing-member circuit and no additional operations.');
  return parsed;
}

function selectedIds(input) {
  const row = input.circuits[0];
  return [...row.elementIds, ...(row.switchIds ?? []), row.panelId];
}

function inspectItems(report, ids) {
  if (!Array.isArray(report?.items) || report.items.length !== ids.length)
    throw new Error('Native inspection did not return the complete reviewed circuit scope.');
  const map = new Map();
  for (const item of report.items) {
    const id = item?.summary?.id ?? item?.id;
    if (!Number.isSafeInteger(id) || id <= 0 || map.has(id)) throw new Error('Native inspection contains missing or duplicate element evidence.');
    map.set(id, item);
  }
  for (const id of ids) if (!map.has(id)) throw new Error(`Native inspection omitted reviewed element ${id}.`);
  return map;
}

async function inspectScope(ids) {
  const response = await call('revit_inspect', { elementIds: ids });
  return inspectItems(response, ids);
}

function assertStableState(before, after) {
  for (const context of [before, after]) {
    if (context?.active !== true || typeof context.document?.identity !== 'string' || !context.document.identity.trim() ||
        !Number.isSafeInteger(context.document.revision) || context.document.revision < 0 || typeof context.document.path !== 'string' ||
        ['isModified', 'isReadOnly', 'isFamilyDocument', 'isWorkshared'].some(field => typeof context.document[field] !== 'boolean') ||
        !context.counts || typeof context.counts !== 'object' || Array.isArray(context.counts) || Object.values(context.counts).some(value => !Number.isSafeInteger(value) || value < 0))
      throw new Error('Native context lacks complete document or category count evidence.');
  }
  if (!isDeepStrictEqual(before.document, after.document) || !isDeepStrictEqual(before.counts, after.counts) ||
      !isDeepStrictEqual(before.activeView, after.activeView) || !isDeepStrictEqual(before.selectedElementIds, after.selectedElementIds))
    throw new Error('The reviewed document changed during the read-only acceptance step.');
}

try {
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [path.join(import.meta.dirname, 'revit-custom.mjs')], stderr: 'pipe',
    env: {
      ...(process.env.REVIT_AI_CONFIG ? { REVIT_AI_CONFIG: process.env.REVIT_AI_CONFIG } : {}),
      ...(process.env.REVIT_AI_TIMEOUT_MS ? { REVIT_AI_TIMEOUT_MS: process.env.REVIT_AI_TIMEOUT_MS } : {})
    }
  }));
  const plugin = await callRevit('revit.bridge.info');
  if (plugin.confirmationMode !== 'chat' || plugin.requiresRevitConfirmation !== false)
    throw new Error('The loaded Revit plugin does not expose the chat-only confirmation contract. No model plan was requested.');

  if (command === 'probe') {
    const current = await contextSeries();
    console.log(JSON.stringify({ status: 'READ_ONLY_PROBE', plugin, document: current.document, counts: current.counts, reads: 5, modelWritesRequested: 0 }, null, 2));
  } else if (command === 'discover') {
    const project = option('project');
    if (!project) throw new Error('Usage: discover --project TEST_COPY.rvt');
    const current = await contextSeries();
    assertTestDocument(current, project, originalProject);
    const candidates = await discoverElectricalCircuitCandidates(call, undefined, current.counts);
    const after = await call('revit_context_get');
    assertStableState(current, after);
    console.log(JSON.stringify({ ...candidates, document: current.document, counts: current.counts }, null, 2));
  } else if (command === 'prepare') {
    const state = requireStateFile();
    const project = option('project');
    const inputFile = option('input');
    if (!project || !inputFile) throw new Error('Usage: prepare --project TEST_COPY.rvt --input REVIEWED_CIRCUIT.json --state NEW_RECORD.json');
    const before = await contextSeries();
    assertTestDocument(before, project, originalProject);
    const input = parseReviewedInput(await fs.readFile(inputFile, 'utf8'));
    const scopeIds = selectedIds(input);
    const beforeScope = await inspectScope(scopeIds);
    const beforePanel = beforeScope.get(input.circuits[0].panelId);
    const inspected = await call('revit_context_get');
    assertStableState(before, inspected);
    const proposal = await call('revit_workflow_run', {
      name: 'electrical.circuit',
      planningMode: 'explicit',
      documentIdentity: before.document.identity,
      expectedRevision: before.document.revision,
      summary: '副本验收：既有成员创建单个电气回路',
      input
    });
    const after = await call('revit_context_get');
    assertStableState(before, after);
    if (!proposal.planCreated || proposal.plan?.status !== 'pending') throw new Error('Native host did not return a pending circuit preview.');
    await fs.mkdir(path.dirname(state), { recursive: true });
    await fs.writeFile(state, JSON.stringify({
      formatVersion: 1,
      acceptance: 'existing-member-circuit',
      expectedProject: path.resolve(project),
      documentIdentity: before.document.identity,
      baselineDocument: before.document,
      baselineCounts: before.counts,
      input,
      scopeIds,
      beforeItems: [...beforeScope.values()].filter(item => item.summary.id !== input.circuits[0].panelId),
      beforePanel,
      preview: proposal.plan,
      domainReview: proposal.domainReview
    }, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ status: 'PREVIEW_ONLY', planId: proposal.plan.planId, document: before.document, operations: proposal.plan.operations, domainReview: proposal.domainReview, expiresAtUtc: proposal.plan.expiresAtUtc, stateFile: state, modelWritesRequested: 0, next: 'Show this exact preview in chat. After approval, confirm the same plan id once, then run verify. This runner never confirms or saves.' }, null, 2));
  } else if (command === 'verify') {
    const state = requireStateFile();
    const record = JSON.parse((await fs.readFile(state, 'utf8')).replace(/^\uFEFF/, ''));
    if (record.formatVersion !== 1 || record.acceptance !== 'existing-member-circuit' || !record.preview?.planId) throw new Error('Invalid electrical circuit acceptance record.');
    const current = await contextSeries();
    assertTestDocument(current, record.expectedProject, originalProject);
    if (current.document.identity !== record.documentIdentity) throw new Error('The Revit document session changed; the existing circuit preview cannot certify this session.');
    const plan = await call('revit_plan_get', { planId: record.preview.planId });
    if (!isDeepStrictEqual(plan.operations, record.preview.operations)) throw new Error('The current plan differs from the immutable reviewed preview.');
    if (plan.status !== 'committed') throw new Error(`Plan status is ${plan.status}; execution has not been verified.`);
    const operation = plan.operations[0];
    const circuitId = plan.receipt?.references?.[operation.id];
    if (!Number.isSafeInteger(circuitId) || circuitId <= 0) throw new Error('The committed receipt lacks a stable circuit reference.');
    const scopeIds = [...record.scopeIds];
    const afterScope = await inspectScope([...scopeIds, circuitId]);
    const afterCircuit = afterScope.get(circuitId);
    const afterPanel = afterScope.get(operation.panelId);
    const afterItems = scopeIds.filter(id => id !== operation.panelId).map(id => afterScope.get(id));
    const verified = verifyExistingElectricalCircuitCreation({
      plan,
      receipt: plan.receipt,
      beforeItems: record.beforeItems,
      afterItems,
      afterCircuit,
      beforePanel: record.beforePanel,
      afterPanel,
      beforeCounts: record.baselineCounts,
      afterCounts: current.counts
    });
    const final = await contextSeries();
    assertStableState(current, final);
    await fs.writeFile(state + '.verified.json', JSON.stringify({ ...verified, status: verified.status, checkedAtUtc: new Date().toISOString(), plugin, document: final.document, receipt: plan.receipt, modelWritesRequested: 0, modelSavesRequested: 0, closeReopenPersistenceVerified: false }, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ ...verified, evidenceFile: state + '.verified.json', modelWritesRequested: 0, modelSavesRequested: 0 }, null, 2));
  } else {
    throw new Error('Use probe, discover, prepare or verify. This acceptance runner never confirms, commits, saves or restarts Revit.');
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'NOT_VERIFIED', code: error.code || 'electrical_circuit_acceptance_failed', message: error.message, details: error.details }, null, 2));
  process.exitCode = 1;
} finally {
  await client.close();
}
