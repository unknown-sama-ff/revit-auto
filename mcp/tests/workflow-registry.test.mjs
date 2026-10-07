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
  assert.ok(list.some(item => item.workflowId === 'families.load' && item.enabled === true));
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


test('electrical parity adapters build circuit, wire and sheet operation subsets',()=>{
  const circuit=buildRegisteredWorkflow('electrical.circuit',{circuits:[{elementIds:[101,102],panelId:103,name:'照明回路'}]});
  assert.equal(circuit.operations[0].operationType,'create_circuit');
  const wire=buildRegisteredWorkflow('electrical.wire',{wires:[{firstElementId:101,secondElementId:102,viewId:104,wireTypeId:105}]});
  assert.equal(wire.operations[0].operationType,'create_wire');
  const sheet=buildRegisteredWorkflow('electrical.sheet',{sheets:[{number:'E201',name:'照明图纸'}],schedules:[{category:'OST_LightingFixtures',fields:['标记'],name:'灯具表'}]});
  assert.deepEqual(sheet.operations.map(op=>op.operationType),['create_schedule','create_sheet']);
});

test('architecture room adapter builds room tags, schedules and view artifacts',()=>{
  const built=buildRegisteredWorkflow('architecture.rooms',{rooms:[{levelId:311,xMm:1000,yMm:1000,zMm:0,number:'101',name:'办公室'}],tags:[{elementId:'@room1',viewId:500,xMm:1000,yMm:1000,zMm:0,id:'roomTag1'}],views:[],schedules:[],sheets:[],viewports:[]});
  assert.deepEqual(built.operations.map(op=>op.operationType),['create_room','create_tag']);
  assert.equal(built.operations[0].id,'room1');
});


test('room and openings adapters are enabled while stairs remain blocked',()=>{
  assert.equal(getWorkflow('architecture.rooms').enabled,true);
  assert.equal(getWorkflow('architecture.openings').enabled,true);
  assert.equal(getWorkflow('architecture.stairs').enabled,false);
});


test('architecture openings adapter builds explicit hosted door and window operations',()=>{
  const built=buildRegisteredWorkflow('architecture.openings',{doors:[{symbolId:201,hostElementId:301,levelId:311,xMm:1000,yMm:0,zMm:0}],windows:[{symbolId:202,hostElementId:302,levelId:311,xMm:2000,yMm:0,zMm:900}],schedules:[],sheets:[],viewports:[]});
  assert.deepEqual(built.operations.map(op=>op.operationType),['create_family_instance','create_family_instance']);
  assert.equal(built.operations[0].hostElementId,301);
  assert.equal(built.operations[1].hostElementId,302);
});


test('architecture documentation adapter builds views, schedules, sheets and viewports',()=>{
  const built=buildRegisteredWorkflow('architecture.documentation',{views:[{viewFamilyTypeId:601,levelId:311,name:'AI建筑平面'}],viewConfigurations:[],schedules:[{category:'OST_Walls',fields:['标记'],name:'墙表'}],panelSchedules:[],sheets:[{number:'A201',name:'建筑平面',titleBlockId:701}],viewports:[{sheetId:'@sheet1',viewId:'@view1',xMm:420,yMm:297,zMm:0}]});
  assert.deepEqual(built.operations.map(op=>op.operationType),['create_view_plan','create_schedule','create_sheet','place_viewport']);
  assert.equal(built.operations[0].id,'view1');
  assert.equal(built.operations[2].id,'sheet1');
});


test('parameter table import is enabled as a controlled write-preview adapter',()=>{
  const imported=getWorkflow('imports.parameter_table');
  assert.equal(imported.enabled,true);assert.equal(imported.destructiveLevel,'batch-write');assert.equal(imported.operationBuilder,'imports.parameter_table');
});

test('saved verification is enabled as a read-only registry adapter',()=>{
  const saved=getWorkflow('verification.saved');
  assert.equal(saved.enabled,true);assert.equal(saved.destructiveLevel,'read-only');assert.equal(saved.operationBuilder,null);assert.equal(saved.readAdapter,'verification.saved');
});

test('family audit is enabled as a read-only registry adapter',()=>{
  const family=getWorkflow('families.audit');
  assert.equal(family.enabled,true);assert.equal(family.destructiveLevel,'read-only');assert.equal(family.operationBuilder,null);assert.equal(family.readAdapter,'families.audit');
});
test('family audit MCP surface is read-only and never loads files',async()=>{const source=await fs.readFile(path.join(root,'mcp/revit-custom.mjs'),'utf8');assert.match(source,/revit\.families\.audit/);assert.match(source,/auditFamilies\(args,callRevit,signal\)/);assert.match(source,/no family files are loaded/);});
