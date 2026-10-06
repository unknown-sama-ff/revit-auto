import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WORKFLOW_REGISTRY, getWorkflow, listWorkflows, assertWorkflowEnabled } from '../workflow-registry.mjs';
import { buildRegisteredWorkflow, registryPreviewMetadata } from '../workflow-adapter.mjs';

const root = path.resolve(import.meta.dirname, '../..');

test('workflow registry covers legacy migration domains and required metadata', () => {
  assert.ok(WORKFLOW_REGISTRY.length >= 20);
  for (const workflow of WORKFLOW_REGISTRY) {
    for (const field of ['workflowId','domain','legacySources','planningModes','inputSchema','requiredQueries','operationBuilder','affectedCategories','destructiveLevel','rollbackPolicy','verificationPolicy','acceptanceStatus','enabled']) {
      assert.ok(Object.hasOwn(workflow, field), `${workflow.workflowId} missing ${field}`);
    }
    assert.ok(workflow.legacySources.length > 0, `${workflow.workflowId} has no legacy source`);
    assert.ok(workflow.requiredQueries.length > 0, `${workflow.workflowId} has no required queries`);
    assert.ok(workflow.affectedCategories.length > 0, `${workflow.workflowId} has no affected categories`);
  }
});

test('registry exposes enabled workflows and blocks pending migration workflows', () => {
  assert.equal(getWorkflow('lighting.full').enabled, true);
  assert.equal(getWorkflow('pump_room.build').enabled, true);
  assert.equal(getWorkflow('architecture.stairs').enabled, false);
  assert.throws(() => assertWorkflowEnabled('architecture.stairs'), error => error.code === 'workflow_migration_pending' && error.details.legacySources.includes('stairs.csx'));
  assert.throws(() => assertWorkflowEnabled('unknown.workflow'), /Unknown registered workflow/);
});

test('registered enabled workflow builds through the same operation validator', () => {
  const built = buildRegisteredWorkflow('lighting.full', {
    lights: [{symbolId: 123, levelId: 311, xMm: 0, yMm: 0, zMm: 3000}],
    panels: [], switches: [], typeCopies: [], parameterChanges: [], circuits: [], wires: [], views: [],
    viewConfigurations: [], schedules: [], panelSchedules: [], sheets: [], viewports: [], tags: [], dimensions: []
  });
  assert.equal(built.workflow.workflowId, 'lighting.full');
  assert.equal(built.operations[0].operationType, 'create_family_instance');
  assert.equal(built.operations[0].id, 'light1');
});

test('registry list is safe metadata and does not expose script execution', () => {
  const list = listWorkflows();
  assert.ok(list.some(item => item.workflowId === 'families.load' && item.enabled === false));
  assert.ok(list.every(item => item.legacySources.every(source => !source.includes('..'))));
  assert.ok(list.every(item => item.operationBuilder === null || typeof item.operationBuilder === 'string'));
  assert.doesNotMatch(JSON.stringify(list), /send_code_to_revit|execute_script|child_process|powershell/i);
});

test('MCP exposes workflow registry and controlled workflow gate', async () => {
  const source = await fs.readFile(path.join(root, 'mcp/revit-custom.mjs'), 'utf8');
  assert.match(source, /revit\.workflow\.list/);
  assert.match(source, /assertWorkflowEnabled\(args\.name\)/);
  assert.match(source, /buildRegisteredWorkflow\(args\.name/);
  assert.match(source, /workflowId:workflow\.workflowId/);
});

test('registry metadata explains the Revit 2027-only runtime boundary', async () => {
  const source = await fs.readFile(path.join(root, 'mcp/revit-custom.mjs'), 'utf8');
  assert.match(source, /Revit 2027\.3\/.NET 10 only/);
  assert.match(source, /legacy2025:'independent fallback'/);
});

test('disabled legacy workflows remain discoverable without becoming callable writes', () => {
  const pending = registryPreviewMetadata('architecture.stairs');
  assert.equal(pending.acceptanceStatus, 'legacy-source-registered-migration-pending');
  assert.deepEqual(pending.planningModes, ['explicit','ask','assisted']);
});
