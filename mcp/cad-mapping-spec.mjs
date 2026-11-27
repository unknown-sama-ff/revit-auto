import fs from 'node:fs/promises';
import path from 'node:path';
import { loadGeometryPrimitives } from './cad-topology-solver.mjs';

const LAYER_PATTERNS = [
  // Architecture
  { role: 'walls', regex: /(?:^|[-_\s])(?:a[-_]?wall|s[-_]?wall|wall|walls|qwall|墙|墙体|砌体|剪力墙|外墙|内墙|隔墙)(?:$|[-_\s\d])/i },
  { role: 'doors', regex: /(?:^|[-_\s])(?:a[-_]?door|door|doors|门)(?:$|[-_\s\d])/i },
  { role: 'windows', regex: /(?:^|[-_\s])(?:a[-_]?wind|win|window|windows|窗|门窗)(?:$|[-_\s\d])/i },
  { role: 'stairs', regex: /(?:stair|stairs|楼梯)/i },
  { role: 'ceilings', regex: /(?:^|[-_\s])(?:a[-_]?clng|clng|ceiling|ceilings|吊顶|天棚)(?:$|[-_\s\d])/i },
  { role: 'roofs', regex: /(?:^|[-_\s])(?:a[-_]?roof|roof|roofs|屋面|屋顶)(?:$|[-_\s\d])/i },
  // Structure
  { role: 'columns', regex: /(?:^|[-_\s])(?:s[-_]?col|a[-_]?col|col|cols|column|columns|kz|gz|柱|结构柱|构造柱|框柱)(?:$|[-_\s\d])/i },
  { role: 'beams', regex: /(?:^|[-_\s])(?:s[-_]?beam|beam|beams|kl|wkl|ll|jl|l|梁|主梁|次梁|框梁|连梁|基础梁)(?:$|[-_\s\d])/i },
  { role: 'foundations', regex: /(?:^|[-_\s])(?:s[-_]?fndn|fndn|footing|foundation|pile|cap|基础|独基|独立基础|条基|承台|桩)(?:$|[-_\s\d])/i },
  { role: 'slabs', regex: /(?:^|[-_\s])(?:s[-_]?slab|a[-_]?flor|slab|floor|floors|板|楼板|结构板|底板|顶板)(?:$|[-_\s\d])/i },
  { role: 'grids', regex: /(?:axis|grid|dote|轴|轴网|轴线)/i },
  // MEP / Systems
  { role: 'pipes', regex: /(?:^|[-_\s])(?:p[-_]?pipe|m[-_]?pipe|fp[-_]?pipe|pipe|pipes|plumb|cws|dws|chws|hws|spr|给水|排水|雨水|污水|消防|喷淋|消火栓|采暖|冷冻水|冷却水|冷凝水|暖通管|水管|立管)(?:$|[-_\s\d])/i },
  { role: 'ducts', regex: /(?:^|[-_\s])(?:m[-_]?duct|h[-_]?duct|duct|ducts|hvac|sa|ra|ea|fa|oa|风管|送风|回风|排风|新风|排烟|加压送风)(?:$|[-_\s\d])/i },
  { role: 'cableTrays', regex: /(?:^|[-_\s])(?:e[-_]?tray|tray|cable[-_]?tray|bridge|ct|桥架|线槽|强电桥架|弱电桥架|消防桥架)(?:$|[-_\s\d])/i },
  { role: 'conduits', regex: /(?:^|[-_\s])(?:e[-_]?cond|conduit|conduits|sc|jdg|kbg|pvc管|线管|穿线管|配管)(?:$|[-_\s\d])/i },
  { role: 'mepEquipment', regex: /(?:^|[-_\s])(?:e[-_]?eqpm|m[-_]?eqpm|p[-_]?eqpm|eqpm|equip|pump|ahu|fcu|fan|panel|db|light|ltng|diffuser|sprinkler|设备|水泵|风机|空调|配电箱|灯具|风口|喷头|洁具)(?:$|[-_\s\d])/i },
  // Ignore / drafting aids
  { role: 'ignore', regex: /(?:dim|text|txt|hatch|rebar|rein|pub_dim|pub_text|pub_hatch|defpoints|furn|家具|标注|文字|图框|填充|索引)/i }
];

function classifyLayer(name) {
  for (const rule of LAYER_PATTERNS) {
    if (rule.regex.test(name)) return rule.role;
  }
  return 'unclassified';
}

function estimateParallelSpacingHistogram(primitives, targetLayers, { minWidthMm = 60, maxWidthMm = 650, binSizeMm = 5, maxPeaks = 8 } = {}) {
  if (!Array.isArray(targetLayers) || targetLayers.length === 0) return [];
  const layerSet = new Set(targetLayers.map(l => l.toLowerCase()));
  const segs = [];
  for (const prim of primitives) {
    const t = prim.t || prim.type;
    const layer = String(prim.l || prim.layer || '0');
    if (!layerSet.has(layer.toLowerCase())) continue;
    const push = (p1, p2) => {
      const dx = p2[0] - p1[0];
      const dy = p2[1] - p1[1];
      const len = Math.hypot(dx, dy);
      if (len < 150) return;
      const ux = dx / len;
      const uy = dy / len;
      let ang = Math.atan2(dy, dx) % Math.PI;
      if (ang < 0) ang += Math.PI;
      segs.push({ x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], len, ux, uy, ang, layer });
    };
    if (t === 'LINE' && Array.isArray(prim.p1) && Array.isArray(prim.p2)) {
      push(prim.p1, prim.p2);
    } else if ((t === 'LWPOLYLINE' || t === 'POLYLINE') && Array.isArray(prim.pts)) {
      const pts = prim.pts;
      const closed = prim.c === true || prim.closed === true;
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) push(pts[i], pts[(i + 1) % pts.length]);
    }
  }

  const sample = segs.length > 2500 ? segs.slice(0, 2500) : segs;
  const bins = new Map();
  const tolRad = 1.5 * (Math.PI / 180);

  for (let i = 0; i < sample.length; i++) {
    const a = sample[i];
    for (let j = i + 1; j < sample.length; j++) {
      const b = sample[j];
      let dAng = Math.abs(a.ang - b.ang);
      if (dAng > Math.PI / 2) dAng = Math.PI - dAng;
      if (dAng > tolRad) continue;
      const perp = Math.abs((b.x1 - a.x1) * (-a.uy) + (b.y1 - a.y1) * a.ux);
      if (perp < minWidthMm || perp > maxWidthMm) continue;
      const u0 = (b.x1 - a.x1) * a.ux + (b.y1 - a.y1) * a.uy;
      const u1 = (b.x2 - a.x1) * a.ux + (b.y2 - a.y1) * a.uy;
      const ov = Math.min(a.len, Math.max(u0, u1)) - Math.max(0, Math.min(u0, u1));
      if (ov < 120) continue;
      const bin = Math.round(perp / binSizeMm) * binSizeMm;
      bins.set(bin, (bins.get(bin) || 0) + ov);
    }
  }

  const sortedBins = [...bins.entries()].sort((a, b) => b[1] - a[1]);
  const peaks = [];
  for (const [widthMm, weight] of sortedBins) {
    if (peaks.some(p => Math.abs(p.cadWidthMm - widthMm) <= Math.max(15, binSizeMm * 2))) continue;
    peaks.push({ cadWidthMm: widthMm, totalOverlapMm: Math.round(weight) });
    if (peaks.length >= maxPeaks) break;
  }
  return peaks.sort((a, b) => a.cadWidthMm - b.cadWidthMm);
}

function estimateRectSizeHistogram(primitives, targetLayers, { minMm = 150, maxMm = 6000 } = {}) {
  if (!Array.isArray(targetLayers) || targetLayers.length === 0) return [];
  const layerSet = new Set(targetLayers.map(l => l.toLowerCase()));
  const counts = new Map();
  for (const prim of primitives) {
    const t = prim.t || prim.type;
    const layer = String(prim.l || prim.layer || '0');
    if (!layerSet.has(layer.toLowerCase())) continue;
    if ((t !== 'LWPOLYLINE' && t !== 'POLYLINE') || !Array.isArray(prim.pts) || prim.pts.length < 4) continue;
    const pts = prim.pts.slice();
    if (pts.length >= 5 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 2) pts.pop();
    if (pts.length !== 4) continue;
    const w = Math.round(Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) / 10) * 10;
    const h = Math.round(Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]) / 10) * 10;
    if (w < minMm || h < minMm || w > maxMm || h > maxMm) continue;
    const key = `${Math.min(w, h)}x${Math.max(w, h)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([size, count]) => ({ sizeMm: size, count, symbolId: null }));
}

function estimateWallThicknessHistogram(primitives, wallLayers, opts = {}) {
  return estimateParallelSpacingHistogram(primitives, wallLayers, opts).map(p => ({
    cadWidthMm: p.cadWidthMm,
    toleranceMm: 5,
    totalOverlapMm: p.totalOverlapMm,
    wallTypeId: null,
    structural: p.cadWidthMm >= 240,
    note: 'Confirm Revit wallTypeId before running revit_cad_solve_topology'
  }));
}

export async function draftCadMappingSpec(input) {
  let layerCounts = {};
  if (input.preflightJsonPath) {
    const pf = JSON.parse((await fs.readFile(input.preflightJsonPath, 'utf8')).replace(/^\uFEFF/, ''));
    layerCounts = pf.countsByLayer || {};
  }

  let primitives = null;
  if (input.geometryJsonlPath || Array.isArray(input.primitives)) {
    primitives = await loadGeometryPrimitives(input);
    if (Object.keys(layerCounts).length === 0) {
      for (const p of primitives) {
        const layer = String(p.l || p.layer || '0');
        layerCounts[layer] = (layerCounts[layer] || 0) + 1;
      }
    }
  }

  const byRole = {
    walls: [],
    columns: [],
    beams: [],
    foundations: [],
    slabs: [],
    doors: [],
    windows: [],
    stairs: [],
    ceilings: [],
    roofs: [],
    grids: [],
    pipes: [],
    ducts: [],
    cableTrays: [],
    conduits: [],
    mepEquipment: [],
    ignore: [],
    unclassified: []
  };

  for (const [layer, count] of Object.entries(layerCounts).sort((a, b) => b[1] - a[1])) {
    const role = classifyLayer(layer);
    byRole[role].push({ layer, count });
  }

  const detectedWallLayers = byRole.walls.map(x => x.layer);
  const detectedBeamLayers = byRole.beams.map(x => x.layer);
  const detectedColumnLayers = byRole.columns.map(x => x.layer);
  const detectedFoundationLayers = byRole.foundations.map(x => x.layer);
  const detectedDuctLayers = byRole.ducts.map(x => x.layer);
  const detectedTrayLayers = byRole.cableTrays.map(x => x.layer);

  const suggestedWallThicknessRules = primitives
    ? estimateWallThicknessHistogram(primitives, detectedWallLayers)
    : [];
  const suggestedBeamWidthRules = primitives
    ? estimateParallelSpacingHistogram(primitives, detectedBeamLayers, { minWidthMm: 120, maxWidthMm: 1200, binSizeMm: 10 }).map(p => ({
        cadWidthMm: p.cadWidthMm,
        toleranceMm: 10,
        totalOverlapMm: p.totalOverlapMm,
        symbolId: null,
        priority: p.cadWidthMm >= 300 ? 2000 + p.cadWidthMm : 1000 + p.cadWidthMm,
        note: 'Confirm concrete/steel structural beam FamilySymbol ID before running revit_cad_solve_topology'
      }))
    : [];
  const suggestedColumnSizes = primitives ? estimateRectSizeHistogram(primitives, detectedColumnLayers, { minMm: 150, maxMm: 2500 }) : [];
  const suggestedFoundationSizes = primitives ? estimateRectSizeHistogram(primitives, detectedFoundationLayers, { minMm: 400, maxMm: 8000 }) : [];
  const suggestedDuctWidths = primitives
    ? estimateParallelSpacingHistogram(primitives, detectedDuctLayers, { minWidthMm: 100, maxWidthMm: 2500, binSizeMm: 20 }).map(p => ({
        cadWidthMm: p.cadWidthMm,
        toleranceMm: 15,
        totalOverlapMm: p.totalOverlapMm,
        ductTypeId: null,
        systemTypeId: null,
        defaultHeightMm: Math.min(500, Math.max(200, Math.round(p.cadWidthMm * 0.5 / 50) * 50))
      }))
    : [];
  const suggestedCableTrayWidths = primitives
    ? estimateParallelSpacingHistogram(primitives, detectedTrayLayers, { minWidthMm: 100, maxWidthMm: 1200, binSizeMm: 25 }).map(p => ({
        cadWidthMm: p.cadWidthMm,
        toleranceMm: 15,
        totalOverlapMm: p.totalOverlapMm,
        cableTrayTypeId: null,
        defaultHeightMm: 100
      }))
    : [];

  const detectedDisciplines = [];
  if (detectedWallLayers.length || byRole.doors.length || byRole.windows.length || byRole.stairs.length || byRole.ceilings.length || byRole.roofs.length) detectedDisciplines.push('architecture');
  if (detectedColumnLayers.length || detectedBeamLayers.length || detectedFoundationLayers.length || byRole.slabs.length) detectedDisciplines.push('structure');
  if (byRole.pipes.length || detectedDuctLayers.length || detectedTrayLayers.length || byRole.conduits.length || byRole.mepEquipment.length) detectedDisciplines.push('mep');

  const spec = {
    schemaVersion: 2,
    draftedAtUtc: new Date().toISOString(),
    requiresHumanReview: true,
    detectedDisciplines,
    source: {
      preflightJsonPath: input.preflightJsonPath || null,
      geometryJsonlPath: input.geometryJsonlPath || null
    },
    layerMapping: {
      wallLayers: detectedWallLayers,
      columnLayers: detectedColumnLayers,
      beamLayers: detectedBeamLayers,
      foundationLayers: detectedFoundationLayers,
      slabLayers: byRole.slabs.map(x => x.layer),
      doorLayers: byRole.doors.map(x => x.layer),
      windowLayers: byRole.windows.map(x => x.layer),
      stairLayers: byRole.stairs.map(x => x.layer),
      ceilingLayers: byRole.ceilings.map(x => x.layer),
      roofLayers: byRole.roofs.map(x => x.layer),
      gridLayers: byRole.grids.map(x => x.layer),
      pipeLayers: byRole.pipes.map(x => x.layer),
      ductLayers: detectedDuctLayers,
      cableTrayLayers: detectedTrayLayers,
      conduitLayers: byRole.conduits.map(x => x.layer),
      mepEquipmentLayers: byRole.mepEquipment.map(x => x.layer),
      ignoredLayers: byRole.ignore.map(x => x.layer),
      unclassifiedLayers: byRole.unclassified.slice(0, 30)
    },
    advancedSettings: {
      wallThicknessRules: suggestedWallThicknessRules,
      beamWidthRules: suggestedBeamWidthRules,
      columnSizeSuggestions: suggestedColumnSizes,
      foundationSizeSuggestions: suggestedFoundationSizes,
      ductWidthRules: suggestedDuctWidths,
      cableTrayWidthRules: suggestedCableTrayWidths,
      bridgeGapRangeMm: [0, 1500],
      bridgeMode: 'bimify_range',
      fixOffAxisDegrees: 0.5,
      cornerExtendMaxMm: 450,
      columnSnapMaxMm: 400,
      beamSnapMaxMm: 450,
      minPairOverlapMm: 80,
      minWallLengthMm: 150,
      emitJoinGeometry: true,
      topologicalBuildOrder: true,
      cropBounds: input.cropBounds || null
    },
    levelAndNamingRules: {
      levelId: null,
      topLevelId: null,
      levelElevationMm: 0,
      baseOffsetMm: 0,
      topOffsetMm: 0,
      beamElevationMm: null,
      foundationElevationMm: null,
      mepElevationMm: null,
      columnSymbolId: null,
      beamSymbolId: null,
      foundationSymbolId: null,
      floorTypeId: null,
      doorSymbolId: null,
      windowSymbolId: null,
      defaultWindowSillMm: 900,
      markPrefix: input.markPrefix || 'AI'
    }
  };

  let outputSpecPath = null;
  if (typeof input.outputSpecPath === 'string' && input.outputSpecPath.trim()) {
    await fs.mkdir(path.dirname(input.outputSpecPath), { recursive: true });
    await fs.writeFile(input.outputSpecPath, JSON.stringify(spec, null, 2), 'utf8');
    outputSpecPath = input.outputSpecPath;
  }

  return {
    status: 'cad_mapping_spec_drafted',
    readOnly: true,
    outputSpecPath,
    spec
  };
}
