const ready = (id, domain, legacySources, inputSchema, requiredQueries, affectedCategories, destructiveLevel, verificationPolicy, notes = []) => ({
  workflowId: id,
  domain,
  legacySources,
  planningModes: id === 'pump_room.build' ? ['explicit', 'ask', 'assisted'] : ['explicit'],
  inputSchema,
  requiredQueries,
  operationBuilder: id === 'audit' ? null : id,
  affectedCategories,
  destructiveLevel,
  rollbackPolicy: 'single-transaction-group',
  verificationPolicy,
  acceptanceStatus: 'implemented-not-fully-migrated',
  enabled: true,
  notes
});
const pending = (id, domain, legacySources, inputSchema, requiredQueries, affectedCategories, notes = []) => ({
  workflowId: id,
  domain,
  legacySources,
  planningModes: ['explicit', 'ask', 'assisted'],
  inputSchema,
  requiredQueries,
  operationBuilder: null,
  affectedCategories,
  destructiveLevel: 'write',
  rollbackPolicy: 'single-transaction-group',
  verificationPolicy: 'native-result-and-baseline-diff',
  acceptanceStatus: 'legacy-source-registered-migration-pending',
  enabled: false,
  notes
});

export const WORKFLOW_REGISTRY = [
  ready('lighting.full', 'electrical', ['place-lighting.csx','create-circuits.csx','create-wires.csx','create-sheets.csx','name-circuits.csx'], 'lights/panels/switches/circuits/wires/views/schedules/sheets', ['context','inspect','type.resolve','room.get?'], ['OST_LightingFixtures','OST_LightingDevices','OST_ElectricalEquipment','OST_ElectricalCircuit','OST_Wire','OST_Views','OST_Sheets'], 'batch-write', 'lighting-native-elements-and-drawing-relations', ['Retains reviewed legacyPoint behavior for inspected work-plane lighting.']),
  ready('lighting.place', 'electrical', ['place-lighting.csx','test-electrical-placement.csx','test-wall-hosting.csx'], 'explicit family/type, level/host, coordinates, marks', ['context','inspect','type.resolve','room.get?'], ['OST_LightingFixtures','OST_LightingDevices'], 'batch-write', 'lighting-native-elements-and-hosts'),
  ready('architecture.build', 'architecture', ['architecture.csx'], 'levels/grids/walls/floors/doors/windows', ['context','search','type.resolve'], ['OST_Levels','OST_Grids','OST_Walls','OST_Doors','OST_Windows','OST_Floors'], 'batch-write', 'architecture-native-elements', ['rooms/openings/stairs/documentation remain separate registered migrations.']),
  ready('pump_room.build', 'mep', ['ModelBuilder.cs','inspect-connectors.csx'], 'equipment/pipes/ducts/fittings/connections/views', ['context','inspect','connector.resolve','flow.diagnose?','collision.check?'], ['OST_MechanicalEquipment','OST_PipeCurves','OST_PipeFitting','OST_DuctCurves','OST_DuctFitting'], 'batch-write', 'native-connectors-systems-and-collision-scope', ['planningMode is explicit/ask/assisted; test-fixture warnings are not design intent.']),
  ready('audit', 'audit', ['audit-final.csx','audit-template.csx','audit-windows.csx'], 'read-only audit request', ['context','search','inspect','audit'], ['multiple-read-only-categories'], 'read-only', 'audit-report-with-unknown-state'),
  ready('electrical.circuit', 'electrical', ['create-circuits.csx','test-circuit.csx','test-three-phase-panel.csx'], 'panel, loads, circuit naming and electrical intent', ['context','inspect','type.resolve'], ['OST_ElectricalCircuit'], 'batch-write', 'electrical-circuit-native-members-and-panel', ['Current operation builder supports create_circuit; specialized three-phase adapter remains a follow-up.']),
  ready('electrical.wire', 'electrical', ['create-wires.csx','test-wire.csx'], 'panel/load connectors, view, wire type, bends', ['context','inspect','connector.resolve','view.get'], ['OST_Wire'], 'batch-write', 'wire-native-endpoints-and-view', ['Current operation builder supports create_wire; legacy fixed-wire-count assumptions are not copied.']),
  ready('electrical.sheet', 'electrical', ['create-sheets.csx','export-sheets.csx','fix-sheet-layout.csx'], 'title block, sheet number/name, views and schedules', ['context','search','inspect','view.get'], ['OST_Sheets','OST_Views','OST_Schedules'], 'batch-write', 'sheet-view-schedule-native-relations', ['Current operation builder supports create_sheet/create_schedule/place_viewport; export remains read-only verification.']),
  pending('architecture.rooms', 'architecture', ['rooms.csx'], 'level, boundary, room names/numbers/marks', ['context','room.get','type.resolve'], ['OST_Rooms','OST_RoomTags'], ['Preserve room-boundary evidence and tag verification.']),
  pending('architecture.openings', 'architecture', ['openings.csx'], 'host, opening geometry, level and category', ['context','inspect','type.resolve'], ['OST_ShaftOpening','OST_WallOpening'], ['Deletion/replacement dependencies require explicit preview.']),
  pending('architecture.stairs', 'architecture', ['stairs.csx','inspect-stairs.csx','inspect-stair-api.csx','test-stair-repair.csx','inspect-stair-detail.csx'], 'stair run/landing/height and repair intent', ['context','search','inspect','type.resolve'], ['OST_Stairs','OST_StairsRailing'], ['Requires a dedicated Revit 2027 stair adapter.']),
  pending('architecture.documentation', 'architecture', ['create-sheets.csx','export-sheets.csx','inspect-views.csx','inspect-titleblocks.csx','inspect-schedule-api.csx'], 'view/schedule/sheet layout and export intent', ['context','view.get','search','inspect'], ['OST_Views','OST_Sheets','OST_Schedules','OST_Viewers'], ['Use native view/viewport configuration and post-export checks.']),
  pending('pump_room.route', 'mep', ['ModelBuilder.cs','inspect-connectors.csx','inspect-power.csx','test-220-system.csx'], 'system, endpoints, route points, diameters, flow intent, clearance', ['context','inspect','connector.resolve','flow.diagnose','collision.check'], ['OST_PipeCurves','OST_PipeFitting','OST_MechanicalEquipment'], ['Current route safety and collision checks become adapter gates.']),
  pending('pump_room.connect', 'mep', ['ModelBuilder.cs','inspect-connectors.csx'], 'reviewed connector IDs/criteria and compatibility evidence', ['context','inspect','connector.resolve','flow.diagnose'], ['OST_PipeCurves','OST_PipeFitting','OST_MechanicalEquipment'], ['No predicted new connector IDs.']),
  pending('pump_room.audit', 'mep', ['audit-final.csx','inspect-distribution.csx','inspect-control.csx','inspect-power.csx'], 'read-only equipment/system audit', ['context','inspect','audit','flow.diagnose'], ['OST_MechanicalEquipment','OST_PipeCurves','OST_PipeFitting'], ['Test-fixture warnings remain evidence, not production requirements.']),
  pending('pump_room.collision', 'mep', ['collision-check developed in v0.3.22'], 'target instances, exclusions, clearance screen', ['context','inspect','collision.check'], ['declared-local-collision-scope'], ['Read-only; exact intersection, unknown and conservative candidate evidence stay separate.']),
  pending('pump_room.clearance', 'mep', ['collision-check developed in v0.3.22'], 'target instances and user-provided clearanceMm', ['context','inspect','collision.check'], ['declared-local-clearance-scope'], ['No default engineering standard; assistant screening values must be labeled.']),
  pending('families.load', 'families', ['load-families.csx','test-load-window.csx','audit-windows.csx','check-families.csx'], 'explicit family file/type mapping and conflict policy', ['context','search','type.resolve'], ['Family','FamilySymbol'], ['Whitelist only; no arbitrary file execution.']),
  pending('families.audit', 'families', ['check-families.csx','inspect-symbols.csx','inspect-types.csx','inspect-enums.csx'], 'family/type audit request', ['context','search','inspect','type.resolve'], ['Family','FamilySymbol','ElementType'], ['Read-only registry workflow.']),
  pending('imports.parameter_table', 'imports', ['examples/csv-import.template.json','lights.csv','mcp/imports.mjs'], 'CSV/TSV/XLSX rows and explicit field mapping', ['context','type.resolve','inspect'], ['mapped-target-categories'], ['Preview-only until chat-approved plan.']),
  pending('imports.dwg_candidate', 'imports', ['mcp/export-dwg.ps1','dwg_*.json','extract_dwg_com.ps1'], 'DWG path/calibration/layer mapping', ['context','search'], ['candidate-geometry'], ['Candidate-only; never direct model write.']),
  pending('imports.image_candidate', 'imports', ['lighting-plan*.jpg'], 'image/calibration/candidate mapping', ['context','search'], ['candidate-geometry'], ['Candidate-only; human review required.']),
  pending('verification.saved', 'verification', ['verify-saved.csx','save-as.csx','mcp/acceptance.mjs'], 'baseline and saved-project verification request', ['context','inspect','search','changes.get'], ['declared-scope'], 'read-only', 'saved-file-and-native-diff'),
  pending('diagnostics.query', 'diagnostics', ['probe.csx','inspect-revit-api.csx','inspect-layout.csx','inspect-electrical.csx','inspect-control.csx','inspect-distribution.csx','inspect-power.csx','inspect-panel-api.csx'], 'read-only diagnostic query', ['context','search','inspect'], ['declared-read-only-scope'], ['Do not expose arbitrary script execution; add focused read tools.'])
];

const BY_ID = new Map(WORKFLOW_REGISTRY.map(entry => [entry.workflowId, entry]));
export function getWorkflow(workflowId) { return BY_ID.get(workflowId) || null; }
export function listWorkflows() { return WORKFLOW_REGISTRY.map(entry => ({ ...entry, legacySources: [...entry.legacySources], requiredQueries: [...entry.requiredQueries], affectedCategories: [...entry.affectedCategories], planningModes: [...entry.planningModes], notes: [...entry.notes] })); }
export function assertWorkflowEnabled(workflowId) {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown registered workflow '${workflowId}'.`);
  if (!workflow.enabled) {
    const error = new Error(`Workflow '${workflowId}' is registered but migration is pending; no model plan was created.`);
    error.code = 'workflow_migration_pending';
    error.details = { workflowId, acceptanceStatus: workflow.acceptanceStatus, legacySources: workflow.legacySources, notes: workflow.notes };
    throw error;
  }
  return workflow;
}
