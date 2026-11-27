import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { callRevit } from '../bridge.mjs';
import { solveCadTopology, orderWallsTopologically } from '../cad-topology-solver.mjs';
import { draftCadMappingSpec } from '../cad-mapping-spec.mjs';
import { planMepAutoConnect } from '../mep-autoconnect-planner.mjs';
import { exportDeliveryPackage } from '../delivery-export.mjs';
import { validateOperations, workflowOperations, OPERATIONS } from '../workflows.mjs';
import { previewRegisteredWriteWorkflow } from '../registered-planning.mjs';
import { getWorkflow } from '../workflow-registry.mjs';
import { validateStructuralElement } from '../structural-elements.mjs';
import { validateCadGeometryArgs, readCadGeometry } from '../links-read.mjs';

test('solveCadTopology seals L-corner, T-junction, diagonal wall, and wall-column joins with zero corner gaps', async () => {
  // Build double-line CAD walls (240mm outer box + 180mm interior T-partition + 400x400 column)
  // deliberately stopping inner lines short at corners (just like real CAD drawings!).
  const primitives = [
    // South 240mm wall (y = -120 and y = +120; inner face stops 120mm short of corners!)
    { t: 'LINE', l: 'WALL', p1: [-120, -120], p2: [6120, -120] },
    { t: 'LINE', l: 'WALL', p1: [120, 120], p2: [5880, 120] },
    // North 240mm wall (y = 3880 and y = 4120)
    { t: 'LINE', l: 'WALL', p1: [120, 3880], p2: [5880, 3880] },
    { t: 'LINE', l: 'WALL', p1: [-120, 4120], p2: [6120, 4120] },
    // West 240mm wall (x = -120 and x = +120, slightly off-axis by ~0.15 deg!)
    { t: 'LINE', l: 'WALL', p1: [-120, -120], p2: [-110, 4120] },
    { t: 'LINE', l: 'WALL', p1: [120, 120], p2: [130, 3880] },
    // East 240mm wall (x = 5880 and x = 6120)
    { t: 'LINE', l: 'WALL', p1: [5880, 120], p2: [5880, 3880] },
    { t: 'LINE', l: 'WALL', p1: [6120, -120], p2: [6120, 4120] },
    // Interior 180mm T-partition at x=3000 with a 900mm door gap in the middle (y=120..1500 and y=2400..3880)
    { t: 'LINE', l: 'WALL', p1: [2910, 120], p2: [2910, 1500] },
    { t: 'LINE', l: 'WALL', p1: [3090, 120], p2: [3090, 1500] },
    { t: 'LINE', l: 'WALL', p1: [2910, 2400], p2: [2910, 3880] },
    { t: 'LINE', l: 'WALL', p1: [3090, 2400], p2: [3090, 3880] },
    // Column at (3000, 0) 400x400
    { t: 'LWPOLYLINE', l: '柱', c: true, pts: [[2800, -200], [3200, -200], [3200, 200], [2800, 200]] },
    // Door INSERT inside the interior T-partition at (3000, 1950), rotated 90 deg (vertical)
    { t: 'INSERT', l: 'DOOR', b: 'M0921', p: [3000, 1950], s: [1, 1], r: Math.PI / 2 }
  ];

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cad-topo-'));
  const svgPath = path.join(tmpDir, 'preview.svg');
  const csvPath = path.join(tmpDir, 'components.csv');

  try {
    const res = await solveCadTopology({
      primitives,
      wallLayers: ['WALL'],
      columnLayers: ['柱'],
      doorLayers: ['DOOR'],
      wallThicknessRules: [
        { cadWidthMm: 180, toleranceMm: 5, wallTypeId: 101, name: '内墙180', structural: false },
        { cadWidthMm: 240, toleranceMm: 8, wallTypeId: 102, name: '外墙240', structural: true }
      ],
      bridgeGapRangeMm: [0, 1500],
      fixOffAxisDegrees: 0.5,
      levelId: 311,
      topLevelId: 312,
      columnSymbolId: 501,
      doorSymbolId: 601,
      outputSvgPath: svgPath,
      outputCsvPath: csvPath
    });

    assert.equal(res.summary.solvedWallCount, 5, 'Should produce 4 exterior walls + 1 bridged T-partition');
    assert.equal(res.summary.suspiciousCornerGapCount, 0, 'Must have ZERO suspicious corner gaps');
    assert.equal(res.summary.openEndCount, 0, 'All 10 wall endpoints must be sealed at corners/T-junctions');
    assert.ok(res.summary.offAxisFixedCount >= 2, 'Should straighten slight off-axis west wall lines');
    assert.equal(res.summary.columnCount, 1);
    assert.equal(res.summary.boundOpeningCount, 1);

    // Every emitted Revit operation must pass strict validateOperations!
    validateOperations(res.operations);

    // Verify topological order: structural 240mm walls appear BEFORE non-structural 180mm partition,
    // and join_geometry appears AFTER walls & columns!
    const wallOps = res.operations.filter(o => o.operationType === 'create_wall');
    assert.equal(wallOps.slice(0, 4).every(w => w.wallTypeId === 102), true);
    assert.equal(wallOps[4].wallTypeId, 101);
    const joinOps = res.operations.filter(o => o.operationType === 'join_geometry');
    assert.ok(joinOps.length >= 1, 'Should emit JoinGeometryUtils operations for wall-column/dissimilar wall joins');

    // Verify SVG and CSV intermediate artifacts were generated cleanly.
    const svg = await fs.readFile(svgPath, 'utf8');
    assert.ok(svg.includes('<svg') && svg.includes('RevitAuto 2D Arch+Struct Topology'));
    const csv = await fs.readFile(csvPath, 'utf8');
    assert.ok(csv.includes('OST_Walls') && csv.includes('OST_StructuralColumns') && csv.includes('OST_Doors'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('solveCadTopology supports interval subtraction on long T-wall and respects noBridgeZones', async () => {
  const primitives = [
    // Continuous exterior bottom line y=0 (x=0..8000) paired with TWO separate inner lines:
    // left room (x=0..3000, y=200) and right room (x=5000..8000, y=200), with a 2000mm recessed lobby in between!
    { t: 'LINE', l: 'WALL', p1: [0, 0], p2: [8000, 0] },
    { t: 'LINE', l: 'WALL', p1: [0, 200], p2: [3000, 200] },
    { t: 'LINE', l: 'WALL', p1: [5000, 200], p2: [8000, 200] }
  ];

  // With noBridgeZones blocking x=3200..4800, the two wall segments must NOT be blindly bridged across the recessed lobby!
  const res = await solveCadTopology({
    primitives,
    wallLayers: ['WALL'],
    wallThicknessRules: [{ cadWidthMm: 200, toleranceMm: 5, wallTypeId: 201 }],
    bridgeGapRangeMm: [0, 2500],
    noBridgeZones: [{ min: { xMm: 3200, yMm: -200 }, max: { xMm: 4800, yMm: 400 } }],
    levelId: 1,
    heightMm: 3000
  });

  assert.equal(res.summary.solvedWallCount, 2, 'Interval subtraction must pair BOTH room segments and noBridgeZones must prevent bridging across recessed lobby');
});

test('draftCadMappingSpec auto-classifies layers and detects dominant wall thicknesses from parallel line histogram', async () => {
  const primitives = [
    { t: 'LINE', l: 'WALL', p1: [0, 0], p2: [5000, 0] },
    { t: 'LINE', l: 'WALL', p1: [0, 240], p2: [5000, 240] },
    { t: 'LINE', l: 'WALL', p1: [0, 1000], p2: [4000, 1000] },
    { t: 'LINE', l: 'WALL', p1: [0, 1180], p2: [4000, 1180] },
    { t: 'LINE', l: 'WINDOW', p1: [1000, 0], p2: [2500, 0] },
    { t: 'LWPOLYLINE', l: '柱', c: true, pts: [[0, 0], [400, 0], [400, 400], [0, 400]] },
    { t: 'LINE', l: 'PUB_DIM', p1: [0, -500], p2: [5000, -500] }
  ];
  const drafted = await draftCadMappingSpec({ primitives });
  assert.deepEqual(drafted.spec.layerMapping.wallLayers, ['WALL']);
  assert.deepEqual(drafted.spec.layerMapping.windowLayers, ['WINDOW']);
  assert.deepEqual(drafted.spec.layerMapping.columnLayers, ['柱']);
  assert.deepEqual(drafted.spec.layerMapping.ignoredLayers, ['PUB_DIM']);
  const detectedWidths = drafted.spec.advancedSettings.wallThicknessRules.map(r => r.cadWidthMm);
  assert.ok(detectedWidths.includes(240), 'Histogram must detect 240mm wall width');
  assert.ok(detectedWidths.includes(180), 'Histogram must detect 180mm wall width');
});

test('planMepAutoConnect creates elbows, splits T-junction mains for tees, handles transitions, and skips 180-deg U-turns cleanly', async () => {
  const res = await planMepAutoConnect({
    domain: 'pipe',
    runs: [
      // Main horizontal run from (0,0,3000) to (6000,0,3000)
      { start: { xMm: 0, yMm: 0, zMm: 3000 }, end: { xMm: 6000, yMm: 0, zMm: 3000 }, pipeTypeId: 10, systemTypeId: 20, levelId: 3, diameterMm: 100 },
      // Branch run teeing into the middle at (3000,0,3000) -> (3000,3000,3000)
      { start: { xMm: 3000, yMm: 5, zMm: 3000 }, end: { xMm: 3000, yMm: 3000, zMm: 3000 }, pipeTypeId: 10, systemTypeId: 20, levelId: 3, diameterMm: 100 },
      // 90-degree elbow continuation from (6000,0,3000) -> (6000,2000,3000)
      { start: { xMm: 6000, yMm: 0, zMm: 3000 }, end: { xMm: 6000, yMm: 2000, zMm: 3000 }, pipeTypeId: 10, systemTypeId: 20, levelId: 3, diameterMm: 100 },
      // Collinear reducer transition from (6000,2000,3000) -> (6000,4000,3000) DN80
      { start: { xMm: 6000, yMm: 2000, zMm: 3000 }, end: { xMm: 6000, yMm: 4000, zMm: 3000 }, pipeTypeId: 10, systemTypeId: 20, levelId: 3, diameterMm: 80 }
    ]
  });

  assert.equal(res.status, 'auto_connect_complete');
  assert.equal(res.summary.emittedStraightCount, 5, 'Main run must be split into 2 segments at the T-junction (2 + 3 = 5)');
  assert.equal(res.summary.fittingsByType.tee, 1);
  assert.equal(res.summary.fittingsByType.elbow, 1);
  assert.equal(res.summary.fittingsByType.transition, 1);

  // Combined operations must pass full RevitAuto validateOperations & port-reservation validation!
  validateOperations(res.combinedOperations);

  // Test partial Auto-Connect graceful handling of a 180-deg U-turn hairpin.
  const partial = await planMepAutoConnect({
    domain: 'duct',
    runs: [
      { start: { xMm: 0, yMm: 0, zMm: 3200 }, end: { xMm: 3000, yMm: 0, zMm: 3200 }, ductTypeId: 11, systemTypeId: 21, levelId: 3, widthMm: 500, heightMm: 300 },
      { start: { xMm: 3000, yMm: 0, zMm: 3200 }, end: { xMm: 500, yMm: 0, zMm: 3200 }, ductTypeId: 11, systemTypeId: 21, levelId: 3, widthMm: 500, heightMm: 300 }
    ]
  });
  assert.equal(partial.status, 'auto_connect_partial');
  assert.equal(partial.summary.emittedStraightCount, 2);
  assert.equal(partial.summary.skippedJunctionCount, 1);
  assert.equal(partial.skippedJunctions[0].reason, 'sharp_u_turn_180_deg');
  validateOperations(partial.combinedOperations);
});

test('workflows and structural-elements validate per-end join flags, joinType, join_geometry, and cad_geometry args', () => {
  assert.ok(OPERATIONS.has('join_geometry'));
  validateOperations([
    {
      operationType: 'create_wall',
      id: 'w1',
      wallTypeId: 10,
      levelId: 1,
      heightMm: 3000,
      start: { xMm: 0, yMm: 0 },
      end: { xMm: 4000, yMm: 0 },
      disallowJoinStart: true,
      disallowJoinEnd: false,
      joinTypeEnd: 'miter'
    },
    {
      operationType: 'join_geometry',
      firstElementId: '@w1',
      secondElementId: 99,
      action: 'join',
      ignoreAlreadyJoined: true
    }
  ]);

  validateStructuralElement({
    operationType: 'create_structural_beam',
    symbolId: 10,
    levelId: 20,
    start: { xMm: 0, yMm: 0, zMm: 4000 },
    end: { xMm: 6000, yMm: 0, zMm: 4000 },
    disallowJoinStart: true,
    disallowJoinEnd: false
  });

  assert.throws(() => validateOperations([{ operationType: 'join_geometry', firstElementId: 10, secondElementId: 10 }]), /distinct/i);
  assert.throws(() => validateCadGeometryArgs({
    documentIdentity: 'doc-1',
    expectedRevision: 0,
    cadInstanceId: 123,
    cropBounds: { min: { xMm: 0, yMm: 0 }, max: { xMm: 100, yMm: 100 } },
    cropViewId: 45
  }), /not both/i);
});

test('exportDeliveryPackage writes delivery-report.md, schedule CSVs, and optional IFC metadata', async () => {
  const tmpDir = await fs.mkdtemp(path.join(path.resolve(import.meta.dirname, '..', '..'), 'delivery-test-'));
  try {
    const calls = [];
    const mockCall = async (method, params) => {
      calls.push({ method, params });
      if (method === 'revit.audit.run') {
        return {
          architectureGeometryAudit: {
            hasIssues: false,
            scannedWallCount: 12,
            scannedFloorCount: 2,
            scannedRoofCount: 1,
            scannedColumnCount: 6,
            doorCount: 4,
            windowCount: 8,
            scannedStairCount: 1,
            wallToWallEndpointGapTotalCount: 0,
            wallColumnEndpointGapTotalCount: 0,
            wallVerticalGapTotalCount: 0,
            floatingHostedWallTotalCount: 0,
            openingCollisionTotalCount: 0,
            structuralFamilyMismatchTotalCount: 0,
            closeParallelOverlappingWallTotalCount: 0,
            isolatedShortWallStubTotalCount: 0
          }
        };
      }
      if (method === 'revit.schedule.data') {
        return {
          scheduleName: '门窗明细表',
          columns: ['标记', '宽度', '高度'],
          rows: [{ cells: ['M0921', '900', '2100'] }],
          hasMore: false
        };
      }
      if (method === 'revit.export.ifc') {
        return {
          exported: true,
          outputPath: path.join(params.outputDirectory, params.fileName),
          bytes: 1024,
          sha256: 'abc123',
          ifcVersion: params.ifcVersion || 'IFC4',
          saved: false
        };
      }
      throw new Error('Unexpected mock call: ' + method);
    };

    const res = await exportDeliveryPackage({
      documentIdentity: 'doc-1',
      expectedRevision: 4,
      outputDirectory: tmpDir,
      scheduleIds: [888],
      includeAudit: true,
      includeIfc: true,
      ifcFileName: 'final.ifc',
      ifcVersion: 'IFC4'
    }, mockCall);

    assert.equal(res.status, 'delivery_package_exported');
    assert.equal(res.exportedSchedules.length, 1);
    assert.equal(res.ifc.exported, true);
    const md = await fs.readFile(res.reportMarkdownPath, 'utf8');
    assert.ok(md.includes('RevitAuto BIM Delivery Report') && md.includes('门窗明细表') && md.includes('IFC4'));
    const csv = await fs.readFile(res.exportedSchedules[0].csvPath, 'utf8');
    assert.ok(csv.includes('M0921'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('orderWallsTopologically orders structural, join-enabled, thicker, longer walls first', () => {
  const ordered = orderWallsTopologically([
    { opId: 'stub', structural: false, disallowJoinStart: true, disallowJoinEnd: true, thicknessMm: 100, len: 500, x1: 0, y1: 0, x2: 500, y2: 0 },
    { opId: 'part', structural: false, disallowJoinStart: false, disallowJoinEnd: false, thicknessMm: 180, len: 3000, x1: 0, y1: 0, x2: 3000, y2: 0 },
    { opId: 'core', structural: true, disallowJoinStart: false, disallowJoinEnd: false, thicknessMm: 240, len: 6000, x1: 0, y1: 0, x2: 6000, y2: 0 }
  ]);
  assert.deepEqual(ordered.map(w => w.opId), ['core', 'part', 'stub']);
});

test('bridge gates cad_geometry, ifc export, join_geometry, and per-end join features before forwarding', async t => {
  const token = 't'.repeat(48);
  const requests = [];
  const server = net.createServer(socket => {
    let buf = '';
    socket.on('data', chunk => {
      buf += chunk.toString('utf8');
      const idx = buf.indexOf('\n');
      if (idx < 0) return;
      const req = JSON.parse(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
      requests.push(req.method);
      socket.write(JSON.stringify({
        protocol: 'revit-auto-2027-v2',
        ok: true,
        result: { protocol: 'revit-auto-2027-v2', version: '0.4.0', features: [], confirmationMode: 'chat', pid: process.pid }
      }) + '\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const cfgDir = await fs.mkdtemp(path.join(os.tmpdir(), 'revit-bridge-gate-'));
  const cfgPath = path.join(cfgDir, 'bridge.json');
  await fs.writeFile(cfgPath, JSON.stringify({ port, token }), 'utf8');
  const prevCfg = process.env.REVIT_AI_CONFIG;
  process.env.REVIT_AI_CONFIG = cfgPath;
  t.after(async () => {
    if (prevCfg === undefined) delete process.env.REVIT_AI_CONFIG;
    else process.env.REVIT_AI_CONFIG = prevCfg;
    server.close();
    await fs.rm(cfgDir, { recursive: true, force: true });
  });

  await assert.rejects(
    readCadGeometry({ documentIdentity: 'doc-1', expectedRevision: 0, cadInstanceId: 12 }, callRevit),
    err => err.code === 'feature_not_loaded' && err.details?.requiredFeatures?.includes('readonly-cad-link-geometry')
  );
  await assert.rejects(
    callRevit('revit.export.ifc', { documentIdentity: 'doc-1', expectedRevision: 0, outputDirectory: 'D:\\exports', fileName: 'a.ifc' }),
    err => err.code === 'feature_not_loaded' && err.details?.requiredFeatures?.includes('controlled-ifc-export')
  );
  await assert.rejects(
    callRevit('revit.plan.create', {
      documentIdentity: 'doc-1',
      summary: 'join gate',
      operations: [{ operationType: 'join_geometry', firstElementId: 10, secondElementId: 20 }]
    }),
    err => err.code === 'feature_not_loaded' && err.details?.requiredFeatures?.includes('controlled-geometry-join')
  );
  await assert.rejects(
    callRevit('revit.plan.create', {
      documentIdentity: 'doc-1',
      summary: 'per-end gate',
      operations: [{ operationType: 'create_wall', wallTypeId: 1, levelId: 1, heightMm: 3000, start: { xMm: 0, yMm: 0 }, end: { xMm: 2000, yMm: 0 }, disallowJoinStart: true }]
    }),
    err => err.code === 'feature_not_loaded' && err.details?.requiredFeatures?.includes('wall-per-end-join-control')
  );
  assert.ok(requests.every(m => m === 'revit.bridge.info'));
});

test('revit-custom MCP server registers all 5 new auto-modeling tools and executes revit_cad_solve_topology live over stdio', async t => {
  const entry = path.resolve(import.meta.dirname, '..', 'revit-custom.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry] });
  const client = new Client({ name: 'upgrade-test', version: '1.0.0' });
  await client.connect(transport);
  t.after(async () => { await client.close(); });

  const { tools } = await client.listTools();
  const names = new Set(tools.map(tool => tool.name));
  for (const expected of [
    'revit_links_cad_geometry',
    'revit_cad_mapping_draft',
    'revit_cad_solve_topology',
    'revit_mep_autoconnect_plan',
    'revit_delivery_export'
  ]) {
    assert.ok(names.has(expected), `MCP server must register ${expected}`);
  }

  const callRes = await client.callTool({
    name: 'revit_cad_solve_topology',
    arguments: {
      primitives: [
        { t: 'LINE', l: 'WALL', p1: [0, 0], p2: [4000, 0] },
        { t: 'LINE', l: 'WALL', p1: [0, 200], p2: [3800, 200] },
        { t: 'LINE', l: 'WALL', p1: [3800, 200], p2: [3800, 3000] },
        { t: 'LINE', l: 'WALL', p1: [4000, 0], p2: [4000, 3000] }
      ],
      wallLayers: ['WALL'],
      wallThicknessRules: [{ cadWidthMm: 200, toleranceMm: 5, wallTypeId: 100 }],
      levelId: 1,
      heightMm: 3000
    }
  });
  assert.equal(callRes.isError, undefined);
  const parsed = JSON.parse(callRes.content[0].text);
  assert.equal(parsed.summary.solvedWallCount, 2);
  assert.equal(parsed.summary.suspiciousCornerGapCount, 0);
  // Both walls must share the exact mathematical L-corner intersection (3900, 100)!
  const walls = parsed.operations.filter(o => o.operationType === 'create_wall');
  assert.equal(walls.length, 2);
  const ptsA = [walls[0].start, walls[0].end];
  const ptsB = [walls[1].start, walls[1].end];
  assert.ok(ptsA.some(a => ptsB.some(b => Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm) <= 0.1)), 'L-corner walls must share an exact vertex');
});

test('solveCadTopology solves structural columns, beams (column+girder snap), foundations, slabs, joins, and upper-floor door Z', async () => {
  const primitives = [
    // Two 400x400 structural columns at (0,0) and (6000,0) and (6000,4000)
    { t: 'LWPOLYLINE', l: 'S_COL', c: true, pts: [[-200, -200], [200, -200], [200, 200], [-200, 200]] },
    { t: 'LWPOLYLINE', l: 'S_COL', c: true, pts: [[5800, -200], [6200, -200], [6200, 200], [5800, 200]] },
    { t: 'LWPOLYLINE', l: 'S_COL', c: true, pts: [[5800, 3800], [6200, 3800], [6200, 4200], [5800, 4200]] },
    // Primary double-line girder (300mm wide) stopping at column inner faces x=200..5800, y=±150!
    { t: 'LINE', l: 'S_BEAM', p1: [200, -150], p2: [5800, -150] },
    { t: 'LINE', l: 'S_BEAM', p1: [200, 150], p2: [5800, 150] },
    // Secondary double-line beam (200mm wide) stopping 150mm short of girder at y=150..4000, x=3000±100!
    { t: 'LINE', l: 'S_BEAM', p1: [2900, 150], p2: [2900, 4000] },
    { t: 'LINE', l: 'S_BEAM', p1: [3100, 150], p2: [3100, 4000] },
    // Structural slab closed polygon
    { t: 'LWPOLYLINE', l: 'S_SLAB', c: true, pts: [[0, 0], [6000, 0], [6000, 4000], [0, 4000]] },
    // Upper-floor wall + window to verify absolute Z = levelElevationMm + sill
    { t: 'LINE', l: 'A_WALL', p1: [0, -100], p2: [6000, -100] },
    { t: 'LINE', l: 'A_WALL', p1: [0, 100], p2: [6000, 100] },
    { t: 'INSERT', l: 'A_WIN', b: 'C1515', p: [3000, 0], s: [1, 1], r: 0 }
  ];

  const res = await solveCadTopology({
    primitives,
    wallLayers: ['A_WALL'],
    columnLayers: ['S_COL'],
    beamLayers: ['S_BEAM'],
    floorLayers: ['S_SLAB'],
    windowLayers: ['A_WIN'],
    wallThicknessRules: [{ cadWidthMm: 200, toleranceMm: 5, wallTypeId: 100 }],
    beamWidthRules: [
      { cadWidthMm: 200, toleranceMm: 10, symbolId: 702, name: 'L200x450', priority: 1200 },
      { cadWidthMm: 300, toleranceMm: 10, symbolId: 701, name: 'KL300x600', priority: 2300 }
    ],
    alignFoundationsToColumns: true,
    levelId: 2,
    topLevelId: 3,
    levelElevationMm: 3600,
    beamElevationMm: 7200,
    foundationElevationMm: 3100,
    columnSymbolId: 501,
    foundationSymbolId: 601,
    floorTypeId: 801,
    windowSymbolId: 901,
    defaultWindowSillMm: 900
  });

  assert.equal(res.summary.columnCount, 3);
  assert.equal(res.summary.foundationCount, 3);
  assert.equal(res.summary.beamCount, 2);
  assert.equal(res.summary.floorCount, 1);
  assert.equal(res.summary.beamSuspiciousGapCount, 0, 'Beams must snap cleanly to exact column centers & girder centerline');

  // Every emitted Arch+Struct operation must pass strict validateOperations!
  validateOperations(res.operations);

  const beamOps = res.operations.filter(o => o.operationType === 'create_structural_beam');
  assert.equal(beamOps.length, 2);
  // Primary girder must come before secondary beam and snap to exact column centers (0,0) -> (6000,0)!
  assert.equal(beamOps[0].symbolId, 701);
  assert.equal(beamOps[0].start.xMm, 0);
  assert.equal(beamOps[0].end.xMm, 6000);
  // Secondary beam must snap to exact girder centerline (3000,0)!
  assert.equal(beamOps[1].symbolId, 702);
  assert.equal(beamOps[1].start.yMm, 0);

  // Upper-floor window must use absolute project Z (3600 + 900 = 4500mm)!
  const winOp = res.operations.find(o => o.operationType === 'create_family_instance');
  assert.equal(winOp.zMm, 4500);

  // Auto-generated join_geometry ops must set skipIfUnjoinable: true!
  const joinOps = res.operations.filter(o => o.operationType === 'join_geometry');
  assert.ok(joinOps.length >= 3 && joinOps.every(j => j.skipIfUnjoinable === true));
});

test('planMepAutoConnect supports cable_tray, conduit, CAD double-line duct extraction, vertical risers, and existing equipment', async () => {
  // 1. Cable Tray elbow + tee using DomainCableTrayConduit + valid against validateOperations!
  const trayPlan = await planMepAutoConnect({
    domain: 'cable_tray',
    runs: [
      { start: { xMm: 0, yMm: 0, zMm: 3200 }, end: { xMm: 6000, yMm: 0, zMm: 3200 }, cableTrayTypeId: 81, levelId: 1, widthMm: 300, heightMm: 100 },
      { start: { xMm: 3000, yMm: 0, zMm: 3200 }, end: { xMm: 3000, yMm: 2000, zMm: 3200 }, cableTrayTypeId: 81, levelId: 1, widthMm: 300, heightMm: 100 },
      { start: { xMm: 6000, yMm: 0, zMm: 3200 }, end: { xMm: 6000, yMm: 2000, zMm: 3200 }, cableTrayTypeId: 81, levelId: 1, widthMm: 300, heightMm: 100 }
    ]
  });
  assert.equal(trayPlan.revitConnectorDomain, 'DomainCableTrayConduit');
  assert.equal(trayPlan.summary.fittingsByType.tee, 1);
  assert.equal(trayPlan.summary.fittingsByType.elbow, 1);
  validateOperations(trayPlan.combinedOperations);

  // 2. Conduit with automatic vertical riser between Z=3000 and Z=1400 + existing panel target!
  const conduitPlan = await planMepAutoConnect({
    domain: 'conduit',
    autoGenerateRisers: true,
    runs: [
      { start: { xMm: 0, yMm: 0, zMm: 3000 }, end: { xMm: 2000, yMm: 0, zMm: 3000 }, conduitTypeId: 82, levelId: 1, diameterMm: 25 },
      { start: { xMm: 2000, yMm: 0, zMm: 1400 }, end: { xMm: 3500, yMm: 0, zMm: 1400 }, conduitTypeId: 82, levelId: 1, diameterMm: 25 }
    ],
    existingTargets: [
      { elementId: 999, connectorId: 0, point: { xMm: 3500, yMm: 0, zMm: 1400 } }
    ]
  });
  assert.equal(conduitPlan.summary.generatedRiserCount, 1);
  assert.equal(conduitPlan.summary.fittingsByType.elbow, 2, 'Vertical riser needs upper + lower elbows');
  assert.equal(conduitPlan.summary.emittedExistingConnectionCount, 1);
  validateOperations(conduitPlan.combinedOperations);

  // 3. CAD-to-MEP double-line duct extraction directly from primitives!
  const ductPlan = await planMepAutoConnect({
    domain: 'duct',
    primitives: [
      { t: 'LINE', l: 'M_DUCT', p1: [0, -250], p2: [4000, -250] },
      { t: 'LINE', l: 'M_DUCT', p1: [0, 250], p2: [4000, 250] }
    ],
    layers: ['M_DUCT'],
    widthRules: [{ cadWidthMm: 500, toleranceMm: 20, widthMm: 500, heightMm: 300, ductTypeId: 11, systemTypeId: 21 }],
    levelId: 1,
    elevationMm: 3200
  });
  assert.equal(ductPlan.summary.emittedStraightCount, 1);
  validateOperations(ductPlan.combinedOperations);
});

test('registered-planning accepts joins in architecture.build, columns+floors+joins in structure.build, and fittings in mep.electrical_runs', async () => {
  const ctx = { active: true, document: { identity: 'doc-1', revision: 0, path: 'm.rvt', isModified: false, isFamilyDocument: false, isReadOnly: false } };
  const mockCall = async (method, args) => {
    if (method === 'revit.context.get') return structuredClone(ctx);
    if (method === 'revit.bridge.info') return {
      moduleVersionId: 'test',
      features: ['controlled-structural-elements', 'controlled-structural-columns', 'controlled-geometry-join', 'controlled-electrical-runs', 'multi-discipline-topology-and-mep-fittings']
    };
    if (method === 'revit.plan.create') return { planId: 'p1', status: 'pending', documentIdentity: 'doc-1', documentRevision: 0, operations: args.operations };
    throw new Error('Unexpected: ' + method);
  };

  const archRes = await previewRegisteredWriteWorkflow({
    name: 'architecture.build', documentIdentity: 'doc-1', expectedRevision: 0,
    input: {
      walls: [{ id: 'w1', wallTypeId: 10, levelId: 1, heightMm: 3000, start: { xMm: 0, yMm: 0 }, end: { xMm: 4000, yMm: 0 } }],
      joins: [{ firstElementId: '@w1', secondElementId: 50, skipIfUnjoinable: true }]
    }
  }, getWorkflow('architecture.build'), mockCall);
  assert.equal(archRes.planCreated, true);

  const structRes = await previewRegisteredWriteWorkflow({
    name: 'structure.build', documentIdentity: 'doc-1', expectedRevision: 0,
    input: {
      columns: [{ id: 'c1', symbolId: 50, baseLevelId: 1, topLevelId: 2, baseOffsetMm: 0, topOffsetMm: 0, point: { xMm: 0, yMm: 0 } }],
      beams: [{ id: 'b1', symbolId: 60, levelId: 2, start: { xMm: 0, yMm: 0, zMm: 3600 }, end: { xMm: 6000, yMm: 0, zMm: 3600 }, topologyPriority: 2300 }],
      joins: [{ firstElementId: '@c1', secondElementId: '@b1', skipIfUnjoinable: true }]
    }
  }, getWorkflow('structure.build'), mockCall);
  assert.equal(structRes.planCreated, true);

  const elecOps = workflowOperations('mep.electrical_runs', {
    cableTrays: [
      { id: 't1', cableTrayTypeId: 80, levelId: 1, start: { xMm: 0, yMm: 0, zMm: 3000 }, end: { xMm: 3000, yMm: 0, zMm: 3000 }, widthMm: 300, heightMm: 100 },
      { id: 't2', cableTrayTypeId: 80, levelId: 1, start: { xMm: 3000, yMm: 0, zMm: 3000 }, end: { xMm: 3000, yMm: 2000, zMm: 3000 }, widthMm: 300, heightMm: 100 }
    ],
    fittings: [
      { fittingType: 'elbow', firstElementId: '@t1', firstConnector: { domain: 'DomainCableTrayConduit', shape: 'Rectangular', point: { xMm: 3000, yMm: 0, zMm: 3000 }, toleranceMm: 10 }, secondElementId: '@t2', secondConnector: { domain: 'DomainCableTrayConduit', shape: 'Rectangular', point: { xMm: 3000, yMm: 0, zMm: 3000 }, toleranceMm: 10 } }
    ]
  });
  assert.equal(elecOps.length, 3);
});
