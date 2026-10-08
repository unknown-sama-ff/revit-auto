const ready = (id, domain, legacySources, inputSchema, requiredQueries, affectedCategories, destructiveLevel, verificationPolicy, notes = []) => ({
  workflowId: id,
  domain,
  legacySources,
  planningModes: ['pump_room.build','pump_room.route','pump_room.connect'].includes(id) ? ['explicit', 'ask', 'assisted'] : ['explicit'],
  inputSchema,
  requiredQueries,
  operationBuilder: destructiveLevel === 'read-only' ? null : id,
  readAdapter: destructiveLevel === 'read-only' ? id : null,
  affectedCategories,
  destructiveLevel,
  rollbackPolicy: destructiveLevel === 'read-only' ? 'not-applicable-read-only' : 'single-transaction-group',
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
  ready('pump_room.build', 'mep', ['ModelBuilder.cs','inspect-connectors.csx'], 'equipment/pipes/ducts/fittings/connections/views, explicit XYZ/flowIntent and required clearanceCheck', ['context','inspect','connector.resolve','flow.diagnose?','collision.check?'], ['OST_MechanicalEquipment','OST_PipeCurves','OST_PipeFitting','OST_DuctCurves','OST_DuctFitting'], 'batch-write', 'native-connectors-systems-and-collision-scope', ['Native pipe/duct builder is a new 2027 capability; ModelBuilder.Build is a stub, not a legacy MEP implementation.','planningMode is explicit/ask/assisted; test-fixture warnings are not design intent.']),
  ready('audit', 'audit', ['audit-final.csx','audit-template.csx','audit-windows.csx'], 'reviewed documentIdentity/expectedRevision; optional matching nested pins only, no script/file inputs', ['context','audit','context recheck'], ['multiple-read-only-categories'], 'read-only', 'audit-report-with-unknown-state'),
  ready('electrical.circuit', 'electrical', ['create-circuits.csx','test-circuit.csx','test-three-phase-panel.csx'], 'panel, loads, circuit naming and electrical intent', ['context','inspect','type.resolve'], ['OST_ElectricalCircuit'], 'batch-write', 'electrical-circuit-native-members-and-panel', ['Current operation builder supports create_circuit; specialized three-phase adapter remains a follow-up.']),
  ready('electrical.wire', 'electrical', ['create-wires.csx','test-wire.csx'], 'panel/load connectors, view, wire type, bends', ['context','inspect','connector.resolve','view.get'], ['OST_Wire'], 'batch-write', 'wire-native-endpoints-and-view', ['Current operation builder supports create_wire; legacy fixed-wire-count assumptions are not copied.']),
  ready('electrical.sheet', 'electrical', ['create-sheets.csx','export-sheets.csx','fix-sheet-layout.csx'], 'title block, sheet number/name, views and schedules', ['context','search','inspect','view.get'], ['OST_Sheets','OST_Views','OST_Schedules'], 'batch-write', 'sheet-view-schedule-native-relations', ['Current operation builder supports create_sheet/create_schedule/place_viewport; export remains read-only verification.']),
  ready('architecture.rooms', 'architecture', ['rooms.csx'], 'level, boundary, room names/numbers/marks', ['context','room.get','type.resolve'], ['OST_Rooms','OST_RoomTags'], 'batch-write', 'room-native-boundaries-and-tags', ['Current operation builder supports create_room; rooms/openings/stairs remain separate.']),
  ready('architecture.openings', 'architecture', ['openings.csx'], 'explicit door/window family types, hosts, levels and points', ['context','inspect','type.resolve'], ['OST_Doors','OST_Windows'], 'batch-write', 'hosted-door-window-native-elements', ['Current operation builder uses explicit family instances; host/type parameters remain required.']),
  ready('architecture.stairs', 'architecture', ['stairs.csx','inspect-stairs.csx','inspect-stair-api.csx','test-stair-repair.csx','inspect-stair-detail.csx'], 'base/top levels, explicit straight-run geometry, width, landing strategy', ['context','inspect'], ['OST_Stairs','OST_StairsRuns','OST_StairsLandings'], 'batch-write', 'native-stairs-edit-scope-and-run-landing-evidence', ['Dedicated single-operation StairsEditScope path; explicit straight runs only; automatic landings are requested, never guessed.']),
  ready('architecture.documentation', 'architecture', ['create-sheets.csx','export-sheets.csx','inspect-views.csx','inspect-titleblocks.csx','inspect-schedule-api.csx'], 'views/viewConfigurations/schedules/panelSchedules/sheets/viewports', ['context','view.get','search','inspect'], ['OST_Views','OST_Sheets','OST_Schedules','OST_Viewers'], 'batch-write', 'views-schedules-sheets-native-relations', ['Export remains read-only verification; layout parameters are explicit.']),
  ready('pump_room.route', 'mep', ['ModelBuilder.cs','inspect-connectors.csx','inspect-power.csx','test-220-system.csx'], 'explicit XYZ route points, pipe type/system type/diameter, flowIntent and clearanceCheck skip|screen_existing', ['context','inspect','connector.resolve','flow.diagnose','collision.check'], ['OST_PipeCurves','OST_PipeFitting','OST_MechanicalEquipment'], 'batch-write', 'explicit-route-pipe-segments-and-connector-evidence', ['Only explicit points become straight pipe segments; no inferred route, flow direction, engineering clearance or predicted connector IDs.']),
  ready('pump_room.connect', 'mep', ['ModelBuilder.cs','inspect-connectors.csx'], 'reviewed connector IDs or criteria, flowIntent and required clearanceCheck skip|screen_existing', ['context','inspect','connector.resolve','flow.diagnose'], ['OST_PipeCurves','OST_PipeFitting','OST_MechanicalEquipment'], 'batch-write', 'native-connector-compatibility-and-system-evidence', ['No predicted new connector IDs; each side requires exactly one reviewed connector ID or criteria.']),
  pending('pump_room.audit', 'mep', ['audit-final.csx','inspect-distribution.csx','inspect-control.csx','inspect-power.csx'], 'read-only equipment/system audit', ['context','inspect','audit','flow.diagnose'], ['OST_MechanicalEquipment','OST_PipeCurves','OST_PipeFitting'], ['Test-fixture warnings remain evidence, not production requirements.']),
  pending('pump_room.collision', 'mep', ['collision-check developed in v0.3.22'], 'target instances, exclusions, clearance screen', ['context','inspect','collision.check'], ['declared-local-collision-scope'], ['Read-only; exact intersection, unknown and conservative candidate evidence stay separate.']),
  pending('pump_room.clearance', 'mep', ['collision-check developed in v0.3.22'], 'target instances and user-provided clearanceMm', ['context','inspect','collision.check'], ['declared-local-clearance-scope'], ['No default engineering standard; assistant screening values must be labeled.']),
  ready('families.load', 'families', ['load-families.csx','test-load-window.csx'], 'approved familyKey and explicit reject/keep_existing/replace plus overwriteTypeParameters', ['context','family.library.get'], ['Family','FamilySymbol'], 'replace-may-affect-existing-instances', 'native-family-name-category-types-and-hash-evidence', ['Approved local RFA catalog only; no path/code input. Load-only plan; no predicted type IDs or automatic save. Requires controlled-family-loading native capability; keep_existing branch is natively accepted, new RFA load/replace remains unaccepted.']),
  ready('families.audit', 'families', ['check-families.csx','inspect-symbols.csx','inspect-types.csx','inspect-enums.csx'], 'exact family names with reviewed document/revision and bounded pagination', ['context','search'], ['FamilySymbol'], 'read-only', 'family-symbol-catalog-and-candidates', ['Shared exact-name active-project catalog adapter; no external family files, type selection, or automatic loading.']),
  ready('imports.parameter_table', 'imports', ['examples/csv-import.template.json','lights.csv','mcp/imports.mjs'], 'CSV/TSV/XLSX/JSON rows and explicit field mapping', ['context','type.resolve','inspect'], ['mapped-target-categories'], 'batch-write', 'imported-operations-and-native-plan-receipt', ['Explicit mapping and existing table parser are enforced; preview is pinned to document identity/revision; no automatic family/type guessing or save.']),
  pending('imports.dwg_candidate', 'imports', ['mcp/export-dwg.ps1','dwg_*.json','extract_dwg_com.ps1'], 'DWG path/calibration/layer mapping', ['context','search'], ['candidate-geometry'], ['Candidate-only; never direct model write.']),
  pending('imports.image_candidate', 'imports', ['lighting-plan*.jpg'], 'image/calibration/candidate mapping', ['context','search'], ['candidate-geometry'], ['Candidate-only; human review required.']),
  ready('verification.saved', 'verification', ['verify-saved.csx','save-as.csx','mcp/acceptance.mjs'], 'current document identity/revision plus bounded saved-state and change-history request', ['context','changes.get'], ['read-only-saved-state-evidence'], 'read-only', 'saved-state-and-change-history-evidence', ['Read-only current-session verification is implemented; automatic legacy SaveAs is intentionally not exposed.']),
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
