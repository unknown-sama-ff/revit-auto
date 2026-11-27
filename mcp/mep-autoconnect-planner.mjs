import fs from 'node:fs/promises';
import path from 'node:path';
import { loadGeometryPrimitives } from './cad-topology-solver.mjs';

const DEG = Math.PI / 180;

function round2(v) {
  return Math.round(v * 100) / 100;
}

function dist3(a, b) {
  return Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm, (a.zMm ?? 0) - (b.zMm ?? 0));
}

function dist2(a, b) {
  return Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
}

function sub3(a, b) {
  return { x: a.xMm - b.xMm, y: a.yMm - b.yMm, z: (a.zMm ?? 0) - (b.zMm ?? 0) };
}

function norm3(v) {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-9) return null;
  return { x: v.x / len, y: v.y / len, z: v.z / len, len };
}

function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function matchLayer(layer, layerList) {
  if (!layerList || layerList.length === 0) return true;
  const lower = String(layer || '').toLowerCase();
  return layerList.some(item => {
    if (typeof item !== 'string') return false;
    if (item.startsWith('/') && item.endsWith('/') && item.length > 2) {
      return new RegExp(item.slice(1, -1), 'i').test(layer || '');
    }
    return lower === item.toLowerCase();
  });
}

function makeTransform(calibration) {
  if (!calibration) return p => ({ x: p[0], y: p[1] });
  const scale = calibration.scaleMmPerUnit ?? 1;
  const ox = calibration.origin?.x ?? 0;
  const oy = calibration.origin?.y ?? 0;
  const offX = calibration.offsetMm?.x ?? 0;
  const offY = calibration.offsetMm?.y ?? 0;
  const ySign = calibration.sourceYAxis === 'down' ? -1 : 1;
  const rad = (calibration.rotationDegrees ?? 0) * DEG;
  const cs = Math.cos(rad);
  const sn = Math.sin(rad);
  return p => {
    const x = (p[0] - ox) * scale;
    const y = (p[1] - oy) * scale * ySign;
    return { x: offX + x * cs - y * sn, y: offY + x * sn + y * cs };
  };
}

function inCrop2D(a, b, crop) {
  if (!crop) return true;
  return !(Math.max(a.x, b.x) < crop.min.xMm || Math.min(a.x, b.x) > crop.max.xMm ||
    Math.max(a.y, b.y) < crop.min.yMm || Math.min(a.y, b.y) > crop.max.yMm);
}

function extractDoubleLineCenterlines(segs, widthRules, minOverlapMm = 80) {
  const rules = [...widthRules]
    .map(r => ({
      cadWidthMm: Number(r.cadWidthMm),
      toleranceMm: Number(r.toleranceMm ?? 15),
      widthMm: Number(r.widthMm ?? r.cadWidthMm),
      heightMm: Number(r.heightMm ?? 300),
      diameterMm: r.diameterMm !== undefined ? Number(r.diameterMm) : undefined,
      ductTypeId: r.ductTypeId,
      cableTrayTypeId: r.cableTrayTypeId,
      systemTypeId: r.systemTypeId
    }))
    .sort((a, b) => a.cadWidthMm - b.cadWidthMm);

  const used = new Set();
  const out = [];
  const angleTol = 2 * DEG;

  for (const rule of rules) {
    const minW = Math.max(20, rule.cadWidthMm - rule.toleranceMm);
    const maxW = rule.cadWidthMm + rule.toleranceMm;
    for (let i = 0; i < segs.length; i++) {
      if (used.has(i)) continue;
      const a = segs[i];
      let bestJ = -1;
      let bestScore = -1;
      let bestMid = null;
      for (let j = i + 1; j < segs.length; j++) {
        if (used.has(j)) continue;
        const b = segs[j];
        let dAng = Math.abs(a.ang - b.ang);
        if (dAng > Math.PI / 2) dAng = Math.PI - dAng;
        if (dAng > angleTol) continue;
        const perpSigned = (b.x1 - a.x1) * (-a.uy) + (b.y1 - a.y1) * a.ux;
        const perp = Math.abs(perpSigned);
        if (perp < minW || perp > maxW) continue;
        const u0 = (b.x1 - a.x1) * a.ux + (b.y1 - a.y1) * a.uy;
        const u1 = (b.x2 - a.x1) * a.ux + (b.y2 - a.y1) * a.uy;
        const s0 = Math.max(0, Math.min(u0, u1));
        const s1 = Math.min(a.len, Math.max(u0, u1));
        const ov = s1 - s0;
        if (ov < minOverlapMm) continue;
        const score = ov - Math.abs(perp - rule.cadWidthMm) * 4;
        if (score > bestScore) {
          bestScore = score;
          bestJ = j;
          const off = perpSigned * 0.5;
          bestMid = {
            x1: a.x1 + s0 * a.ux + off * (-a.uy),
            y1: a.y1 + s0 * a.uy + off * a.ux,
            x2: a.x1 + s1 * a.ux + off * (-a.uy),
            y2: a.y1 + s1 * a.uy + off * a.ux
          };
        }
      }
      if (bestJ >= 0 && bestMid) {
        used.add(i);
        used.add(bestJ);
        out.push({ ...bestMid, rule });
      }
    }
  }
  return out;
}

async function extractRunsFromCad(input, kind) {
  const primitives = await loadGeometryPrimitives(input);
  const xform = makeTransform(input.calibration);
  const crop = input.cropBounds || null;
  const layers = input.layers || [];
  const elevationMm = input.elevationMm ?? 3000;
  const extractionMode = input.extractionMode ?? 'auto';
  const widthRules = Array.isArray(input.widthRules) ? input.widthRules : [];

  const rawSegs = [];
  const push = (p1, p2, layer) => {
    const a = xform(p1);
    const b = xform(p2);
    if (!inCrop2D(a, b, crop)) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 30) return;
    let ang = Math.atan2(dy, dx) % Math.PI;
    if (ang < 0) ang += Math.PI;
    rawSegs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, len, ux: dx / len, uy: dy / len, ang, layer });
  };

  for (const prim of primitives) {
    const t = prim.t || prim.type;
    const layer = String(prim.l || prim.layer || '0');
    if (!matchLayer(layer, layers)) continue;
    if (t === 'LINE' && Array.isArray(prim.p1) && Array.isArray(prim.p2)) {
      push(prim.p1, prim.p2, layer);
    } else if ((t === 'LWPOLYLINE' || t === 'POLYLINE') && Array.isArray(prim.pts) && prim.pts.length >= 2) {
      const pts = prim.pts;
      const closed = prim.c === true || prim.closed === true;
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) push(pts[i], pts[(i + 1) % pts.length], layer);
    }
  }

  const useDoubleLine = (kind === 'duct' || kind === 'cable_tray') &&
    (extractionMode === 'double_line' || (extractionMode === 'auto' && widthRules.length > 0));
  const pairs = useDoubleLine && widthRules.length > 0 ? extractDoubleLineCenterlines(rawSegs, widthRules) : [];

  const baseDefaults = {
    levelId: input.levelId,
    systemTypeId: input.systemTypeId,
    pipeTypeId: input.pipeTypeId,
    ductTypeId: input.ductTypeId,
    cableTrayTypeId: input.cableTrayTypeId,
    conduitTypeId: input.conduitTypeId,
    diameterMm: input.diameterMm,
    widthMm: input.widthMm,
    heightMm: input.heightMm
  };

  if (pairs.length > 0) {
    return pairs.map(p => ({
      ...baseDefaults,
      ...(p.rule.ductTypeId !== undefined ? { ductTypeId: p.rule.ductTypeId } : {}),
      ...(p.rule.cableTrayTypeId !== undefined ? { cableTrayTypeId: p.rule.cableTrayTypeId } : {}),
      ...(p.rule.systemTypeId !== undefined ? { systemTypeId: p.rule.systemTypeId } : {}),
      ...(p.rule.diameterMm !== undefined ? { diameterMm: p.rule.diameterMm } : { widthMm: p.rule.widthMm, heightMm: p.rule.heightMm }),
      start: { xMm: round2(p.x1), yMm: round2(p.y1), zMm: round2(elevationMm) },
      end: { xMm: round2(p.x2), yMm: round2(p.y2), zMm: round2(elevationMm) }
    }));
  }

  return rawSegs.map(s => ({
    ...baseDefaults,
    start: { xMm: round2(s.x1), yMm: round2(s.y1), zMm: round2(elevationMm) },
    end: { xMm: round2(s.x2), yMm: round2(s.y2), zMm: round2(elevationMm) }
  }));
}

function fixOffAxisRun(run, fixOffAxisDegrees) {
  if (!fixOffAxisDegrees || fixOffAxisDegrees <= 0) return run;
  const s = run.start;
  const e = run.end;
  if (Math.abs((e.zMm ?? 0) - (s.zMm ?? 0)) > 1) return run; // Preserve sloped/riser segments.
  const dx = e.xMm - s.xMm;
  const dy = e.yMm - s.yMm;
  const len = Math.hypot(dx, dy);
  if (len < 1) return run;
  let ang = Math.atan2(dy, dx) % Math.PI;
  if (ang < 0) ang += Math.PI;
  const tol = fixOffAxisDegrees * DEG;
  const midX = (s.xMm + e.xMm) * 0.5;
  const midY = (s.yMm + e.yMm) * 0.5;
  const z = s.zMm ?? 0;
  if (ang <= tol || Math.PI - ang <= tol) {
    const sign = dx >= 0 ? 1 : -1;
    return {
      ...run,
      start: { xMm: round2(midX - sign * len * 0.5), yMm: round2(midY), zMm: round2(z) },
      end: { xMm: round2(midX + sign * len * 0.5), yMm: round2(midY), zMm: round2(z) }
    };
  }
  if (Math.abs(ang - Math.PI / 2) <= tol) {
    const sign = dy >= 0 ? 1 : -1;
    return {
      ...run,
      start: { xMm: round2(midX), yMm: round2(midY - sign * len * 0.5), zMm: round2(z) },
      end: { xMm: round2(midX), yMm: round2(midY + sign * len * 0.5), zMm: round2(z) }
    };
  }
  return run;
}

function projectPointOnSeg3(p, a, b) {
  const ab = sub3(b, a);
  const len2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  if (len2 < 1e-9) return null;
  const ap = sub3(p, a);
  const t = (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / len2;
  const proj = {
    xMm: a.xMm + t * ab.x,
    yMm: a.yMm + t * ab.y,
    zMm: (a.zMm ?? 0) + t * ab.z
  };
  return { t, proj, dist: dist3(p, proj), segLen: Math.sqrt(len2) };
}

function sameSize(a, b, kind) {
  if (kind === 'pipe' || kind === 'conduit') {
    return a.diameterMm !== undefined && b.diameterMm !== undefined && Math.abs(a.diameterMm - b.diameterMm) <= 0.5;
  }
  if (kind === 'cable_tray') {
    return a.widthMm !== undefined && b.widthMm !== undefined && a.heightMm !== undefined && b.heightMm !== undefined &&
      Math.abs(a.widthMm - b.widthMm) <= 0.5 && Math.abs(a.heightMm - b.heightMm) <= 0.5;
  }
  if (a.diameterMm !== undefined && b.diameterMm !== undefined) {
    return Math.abs(a.diameterMm - b.diameterMm) <= 0.5;
  }
  if (a.widthMm !== undefined && b.widthMm !== undefined && a.heightMm !== undefined && b.heightMm !== undefined) {
    return Math.abs(a.widthMm - b.widthMm) <= 0.5 && Math.abs(a.heightMm - b.heightMm) <= 0.5;
  }
  return false;
}

function shapeOf(run, kind) {
  if (kind === 'cable_tray') return 'Rectangular';
  if (kind === 'conduit' || kind === 'pipe') return 'Round';
  return run.diameterMm !== undefined ? 'Round' : 'Rectangular';
}

function networkKeyOf(run, kind) {
  if (kind === 'pipe' || kind === 'duct') return `sys:${run.systemTypeId ?? 'default'}`;
  if (kind === 'cable_tray') return `tray:${run.cableTrayTypeId ?? 'default'}`;
  return `cond:${run.conduitTypeId ?? 'default'}`;
}

function buildConnectorCriteria(revitDomain, kind, run, pt, toleranceMm) {
  return {
    domain: revitDomain,
    shape: shapeOf(run, kind),
    point: { xMm: round2(pt.xMm), yMm: round2(pt.yMm), zMm: round2(pt.zMm ?? 0) },
    toleranceMm
  };
}

function renderMepSvg({ runs, fittingPoints, riserPoints, skippedJunctions, domain }) {
  const xs = [];
  const ys = [];
  for (const r of runs) { xs.push(r.start.xMm, r.end.xMm); ys.push(r.start.yMm, r.end.yMm); }
  if (xs.length === 0) return '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><text x="20" y="40">No MEP runs</text></svg>';
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const spanX = Math.max(1000, maxX - minX); const spanY = Math.max(1000, maxY - minY);
  const pad = Math.max(spanX, spanY) * 0.08;
  const W = 1200;
  const H = Math.max(500, Math.min(1100, Math.round(W * ((spanY + 2 * pad) / (spanX + 2 * pad)))));
  const scale = Math.min((W - 40) / (spanX + 2 * pad), (H - 80) / (spanY + 2 * pad));
  const sx = x => round2(20 + (x - (minX - pad)) * scale);
  const sy = y => round2(H - 50 - (y - (minY - pad)) * scale);
  const strokeColor = domain === 'pipe' ? '#38bdf8' : domain === 'duct' ? '#34d399' : domain === 'cable_tray' ? '#f59e0b' : '#c084fc';

  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#0f172a;font-family:system-ui,sans-serif">`,
    `<text x="20" y="24" fill="#e2e8f0" font-size="14" font-weight="600">RevitAuto MEP Auto-Connect (${domain}) | Runs: ${runs.length} | Fittings: ${fittingPoints.length} | Risers: ${riserPoints.length} | Skipped: ${skippedJunctions.length}</text>`,
    '<g>'
  ];
  for (const r of runs) {
    const sw = Math.max(2, round2((r.widthMm || r.diameterMm || 100) * scale * 0.6));
    lines.push(`<line x1="${sx(r.start.xMm)}" y1="${sy(r.start.yMm)}" x2="${sx(r.end.xMm)}" y2="${sy(r.end.yMm)}" stroke="${strokeColor}" stroke-width="${sw}" stroke-opacity="0.45"/>`);
    lines.push(`<line x1="${sx(r.start.xMm)}" y1="${sy(r.start.yMm)}" x2="${sx(r.end.xMm)}" y2="${sy(r.end.yMm)}" stroke="#f8fafc" stroke-width="1.3"/>`);
  }
  for (const fp of fittingPoints) {
    lines.push(`<circle cx="${sx(fp.xMm)}" cy="${sy(fp.yMm)}" r="4" fill="#22c55e" stroke="#0f172a" stroke-width="1"/>`);
  }
  for (const rp of riserPoints) {
    lines.push(`<circle cx="${sx(rp.xMm)}" cy="${sy(rp.yMm)}" r="6" fill="none" stroke="#38bdf8" stroke-width="2"/>`);
  }
  for (const sj of skippedJunctions) {
    lines.push(`<circle cx="${sx(sj.point.xMm)}" cy="${sy(sj.point.yMm)}" r="7" fill="none" stroke="#ef4444" stroke-width="2.2"/>`);
    lines.push(`<text x="${sx(sj.point.xMm) + 9}" y="${sy(sj.point.yMm) + 4}" fill="#fca5a5" font-size="11">${sj.reason}</text>`);
  }
  lines.push('</g></svg>');
  return lines.join('\n');
}

export async function planMepAutoConnect(input) {
  const validDomains = new Set(['pipe', 'duct', 'cable_tray', 'conduit']);
  const kind = validDomains.has(input?.domain) ? input.domain : null;
  if (!kind) throw new Error("planMepAutoConnect requires domain: 'pipe', 'duct', 'cable_tray', or 'conduit'.");

  let inputRuns = Array.isArray(input.runs) ? input.runs : null;
  if ((!inputRuns || inputRuns.length === 0) && (input.geometryJsonlPath || Array.isArray(input.primitives))) {
    inputRuns = await extractRunsFromCad(input, kind);
  }
  if (!Array.isArray(inputRuns) || inputRuns.length === 0 || inputRuns.length > 500) {
    throw new Error('Provide runs (1..500 straight segments) or CAD geometryJsonlPath/primitives that yield 1..500 runs.');
  }

  const junctionToleranceMm = input.junctionToleranceMm ?? 25;
  const connectorToleranceMm = input.connectorToleranceMm ?? Math.max(10, junctionToleranceMm);
  const minSegmentLengthMm = input.minSegmentLengthMm ?? 50;
  const fixOffAxisDegrees = input.fixOffAxisDegrees ?? 0.5;
  const autoGenerateRisers = input.autoGenerateRisers === true;
  const existingTargets = Array.isArray(input.existingTargets) ? input.existingTargets : [];

  const revitDomain = kind === 'pipe'
    ? 'DomainPiping'
    : kind === 'duct'
      ? 'DomainHvac'
      : 'DomainCableTrayConduit';
  const opType = kind === 'pipe'
    ? 'create_pipe'
    : kind === 'duct'
      ? 'create_duct'
      : kind === 'cable_tray'
        ? 'create_cable_tray'
        : 'create_conduit';

  // Step 1: Normalize & straighten slight off-axis horizontal runs.
  let segments = inputRuns.map((r, idx) => {
    const fixed = fixOffAxisRun({
      ...r,
      start: { xMm: round2(r.start.xMm), yMm: round2(r.start.yMm), zMm: round2(r.start.zMm ?? 0) },
      end: { xMm: round2(r.end.xMm), yMm: round2(r.end.yMm), zMm: round2(r.end.zMm ?? 0) },
      networkKey: networkKeyOf(r, kind),
      sourceIndex: idx
    }, fixOffAxisDegrees);
    return fixed;
  });

  // Step 1b: Optional vertical riser generation when two same-network runs meet in XY at different elevations Z.
  const generatedRisers = [];
  if (autoGenerateRisers) {
    const riserKeys = new Set();
    const baseCount = segments.length;
    for (let i = 0; i < baseCount; i++) {
      for (let j = i + 1; j < baseCount; j++) {
        const a = segments[i];
        const b = segments[j];
        if (a.networkKey !== b.networkKey) continue;
        for (const endA of ['start', 'end']) {
          for (const endB of ['start', 'end']) {
            const pA = a[endA];
            const pB = b[endB];
            const dz = Math.abs(pA.zMm - pB.zMm);
            if (dist2(pA, pB) <= junctionToleranceMm && dz >= minSegmentLengthMm) {
              const rx = round2((pA.xMm + pB.xMm) * 0.5);
              const ry = round2((pA.yMm + pB.yMm) * 0.5);
              const zLow = Math.min(pA.zMm, pB.zMm);
              const zHigh = Math.max(pA.zMm, pB.zMm);
              const key = `${a.networkKey}:${Math.round(rx)}:${Math.round(ry)}:${Math.round(zLow)}:${Math.round(zHigh)}`;
              if (riserKeys.has(key)) continue;
              riserKeys.add(key);
              const riser = {
                ...a,
                id: `riser_${generatedRisers.length + 1}`,
                start: { xMm: rx, yMm: ry, zMm: round2(zLow) },
                end: { xMm: rx, yMm: ry, zMm: round2(zHigh) },
                isGeneratedRiser: true
              };
              generatedRisers.push(riser);
              segments.push(riser);
            }
          }
        }
      }
    }
  }

  // Step 2: Detect T-junctions where an endpoint of a NON-collinear run B lands in the interior of run A,
  // and split run A cleanly into two segments meeting at the exact T-vertex so NewTeeFitting works.
  const splitPoints = segments.map(() => []);
  for (let i = 0; i < segments.length; i++) {
    const segA = segments[i];
    const dirA = norm3(sub3(segA.end, segA.start));
    if (!dirA) continue;
    for (let j = 0; j < segments.length; j++) {
      if (i === j) continue;
      const segB = segments[j];
      if (segA.networkKey !== segB.networkKey) continue;
      const dirB = norm3(sub3(segB.end, segB.start));
      if (!dirB || Math.abs(dot3(dirA, dirB)) > 0.95) continue;
      for (const endKey of ['start', 'end']) {
        const pt = segB[endKey];
        const proj = projectPointOnSeg3(pt, segA.start, segA.end);
        if (!proj) continue;
        if (proj.dist <= junctionToleranceMm && proj.t * proj.segLen > minSegmentLengthMm && (1 - proj.t) * proj.segLen > minSegmentLengthMm) {
          splitPoints[i].push({ t: proj.t, pt: proj.proj });
        }
      }
    }
  }

  const splitSegments = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const cuts = splitPoints[i].sort((a, b) => a.t - b.t);
    const dedupCuts = [];
    for (const c of cuts) {
      if (dedupCuts.length === 0 || dist3(dedupCuts[dedupCuts.length - 1].pt, c.pt) > minSegmentLengthMm) {
        dedupCuts.push(c);
      }
    }
    if (dedupCuts.length === 0) {
      splitSegments.push(seg);
    } else {
      const pts = [seg.start, ...dedupCuts.map(c => ({ xMm: round2(c.pt.xMm), yMm: round2(c.pt.yMm), zMm: round2(c.pt.zMm) })), seg.end];
      for (let k = 0; k < pts.length - 1; k++) {
        splitSegments.push({ ...seg, id: seg.id ? `${seg.id}_${k + 1}` : undefined, start: pts[k], end: pts[k + 1] });
      }
    }
  }
  segments = splitSegments;

  // Step 3: Cluster endpoints within junctionToleranceMm into exact shared 3D junction vertices.
  const nodes = [];
  const findOrCreateNode = (pt, networkKey) => {
    for (const n of nodes) {
      if (n.networkKey === networkKey && dist3(n.point, pt) <= junctionToleranceMm) {
        return n;
      }
    }
    const node = { id: nodes.length + 1, networkKey, point: { ...pt }, endpoints: [] };
    nodes.push(node);
    return node;
  };

  const skippedShortSegments = [];
  const validRuns = [];

  for (const seg of segments) {
    const nodeA = findOrCreateNode(seg.start, seg.networkKey);
    const nodeB = findOrCreateNode(seg.end, seg.networkKey);
    const snappedStart = { xMm: round2(nodeA.point.xMm), yMm: round2(nodeA.point.yMm), zMm: round2(nodeA.point.zMm) };
    const snappedEnd = { xMm: round2(nodeB.point.xMm), yMm: round2(nodeB.point.yMm), zMm: round2(nodeB.point.zMm) };
    const len = dist3(snappedStart, snappedEnd);
    if (len < 1) {
      skippedShortSegments.push({ sourceIndex: seg.sourceIndex, lengthMm: round2(len), reason: 'degenerate_zero_length_after_snap' });
      continue;
    }
    const opId = seg.id || `${kind}_${validRuns.length + 1}`;
    const runRec = { ...seg, opId, start: snappedStart, end: snappedEnd, lengthMm: round2(len), nodeA, nodeB };
    validRuns.push(runRec);
    const dirFromA = norm3(sub3(snappedEnd, snappedStart));
    const dirFromB = norm3(sub3(snappedStart, snappedEnd));
    nodeA.endpoints.push({ run: runRec, endKey: 'start', dir: dirFromA });
    nodeB.endpoints.push({ run: runRec, endKey: 'end', dir: dirFromB });
  }

  // Step 4: Build strictly schema-compliant straight segment operations.
  const straightOperations = validRuns.map(r => {
    if (kind === 'pipe') {
      return {
        operationType: 'create_pipe',
        id: r.opId,
        levelId: r.levelId,
        systemTypeId: r.systemTypeId,
        pipeTypeId: r.pipeTypeId,
        diameterMm: r.diameterMm,
        start: r.start,
        end: r.end,
        ...(r.mark ? { mark: r.mark } : {})
      };
    }
    if (kind === 'duct') {
      return {
        operationType: 'create_duct',
        id: r.opId,
        levelId: r.levelId,
        systemTypeId: r.systemTypeId,
        ductTypeId: r.ductTypeId,
        ...(r.diameterMm !== undefined ? { diameterMm: r.diameterMm } : { widthMm: r.widthMm, heightMm: r.heightMm }),
        start: r.start,
        end: r.end,
        ...(r.mark ? { mark: r.mark } : {})
      };
    }
    if (kind === 'cable_tray') {
      return {
        operationType: 'create_cable_tray',
        id: r.opId,
        cableTrayTypeId: r.cableTrayTypeId,
        levelId: r.levelId,
        start: r.start,
        end: r.end,
        widthMm: r.widthMm,
        heightMm: r.heightMm
      };
    }
    return {
      operationType: 'create_conduit',
      id: r.opId,
      conduitTypeId: r.conduitTypeId,
      levelId: r.levelId,
      start: r.start,
      end: r.end,
      diameterMm: r.diameterMm
    };
  });

  // Step 5: Auto-Connect every junction node (elbow / union / transition / tee / cross),
  // plus open endpoints landing on inspected existingTargets (equipment / existing runs).
  const fittingOperations = [];
  const connectionOperations = [];
  const fittingPoints = [];
  const skippedJunctions = [];

  for (const node of nodes) {
    const eps = node.endpoints;
    if (eps.length === 1 && existingTargets.length > 0) {
      const ep = eps[0];
      const hit = existingTargets.find(t => t?.point && dist3(t.point, node.point) <= connectorToleranceMm);
      if (hit && Number.isSafeInteger(hit.elementId) && hit.elementId > 0) {
        const mode = hit.connectionMode === 'elbow' || hit.connectionMode === 'union' || hit.connectionMode === 'transition'
          ? 'create_fitting'
          : 'connect_elements';
        const firstSide = Number.isSafeInteger(hit.connectorId) && hit.connectorId >= 0
          ? { firstConnectorId: hit.connectorId }
          : { firstConnector: hit.connector || buildConnectorCriteria(revitDomain, kind, ep.run, hit.point, connectorToleranceMm) };
        const connOp = {
          operationType: mode,
          id: `conn_${connectionOperations.length + 1}`,
          ...(mode === 'create_fitting' ? { fittingType: hit.connectionMode } : {}),
          firstElementId: hit.elementId,
          ...firstSide,
          secondElementId: `@${ep.run.opId}`,
          secondConnector: buildConnectorCriteria(revitDomain, kind, ep.run, node.point, connectorToleranceMm)
        };
        connectionOperations.push(connOp);
        fittingPoints.push(node.point);
      }
      continue;
    }
    if (eps.length < 2) continue;

    const tooShort = eps.filter(ep => ep.run.lengthMm < minSegmentLengthMm);
    if (tooShort.length > 0) {
      skippedJunctions.push({
        point: node.point,
        degree: eps.length,
        connectedIds: eps.map(e => e.run.opId),
        reason: 'segment_too_short_for_fitting',
        details: `One or more segments (${tooShort.map(e => `${e.run.opId}=${e.run.lengthMm}mm`).join(', ')}) are shorter than ${minSegmentLengthMm}mm.`
      });
      continue;
    }

    if (eps.length === 2) {
      const [e1, e2] = eps;
      const d = dot3(e1.dir, e2.dir);
      if (d > 0.96) {
        skippedJunctions.push({
          point: node.point,
          degree: 2,
          connectedIds: [e1.run.opId, e2.run.opId],
          reason: 'sharp_u_turn_180_deg',
          details: 'Two collinear overlapping or 180-degree hairpin segments cannot accept a single standard fitting.'
        });
        continue;
      }
      let fittingType;
      if (d <= -0.985) {
        fittingType = sameSize(e1.run, e2.run, kind) ? 'union' : 'transition';
      } else {
        if (!sameSize(e1.run, e2.run, kind)) {
          skippedJunctions.push({
            point: node.point,
            degree: 2,
            connectedIds: [e1.run.opId, e2.run.opId],
            reason: 'elbow_size_mismatch_needs_explicit_transition',
            details: 'Angled junction connects differing sizes; add a short transition reducer before the elbow.'
          });
          continue;
        }
        fittingType = 'elbow';
      }
      fittingOperations.push({
        operationType: 'create_fitting',
        id: `fit_${fittingOperations.length + 1}`,
        fittingType,
        firstElementId: `@${e1.run.opId}`,
        firstConnector: buildConnectorCriteria(revitDomain, kind, e1.run, node.point, connectorToleranceMm),
        secondElementId: `@${e2.run.opId}`,
        secondConnector: buildConnectorCriteria(revitDomain, kind, e2.run, node.point, connectorToleranceMm)
      });
      fittingPoints.push(node.point);
    } else if (eps.length === 3) {
      let mainPair = null;
      let branch = null;
      const pairs = [[0, 1, 2], [0, 2, 1], [1, 2, 0]];
      for (const [a, b, c] of pairs) {
        if (dot3(eps[a].dir, eps[b].dir) <= -0.96) {
          mainPair = [eps[a], eps[b]];
          branch = eps[c];
          break;
        }
      }
      if (!mainPair) {
        skippedJunctions.push({
          point: node.point,
          degree: 3,
          connectedIds: eps.map(e => e.run.opId),
          reason: 'non_collinear_3way_junction',
          details: 'Revit NewTeeFitting requires two collinear main runs plus one branch run.'
        });
        continue;
      }
      fittingOperations.push({
        operationType: 'create_fitting',
        id: `fit_${fittingOperations.length + 1}`,
        fittingType: 'tee',
        firstElementId: `@${mainPair[0].run.opId}`,
        firstConnector: buildConnectorCriteria(revitDomain, kind, mainPair[0].run, node.point, connectorToleranceMm),
        secondElementId: `@${mainPair[1].run.opId}`,
        secondConnector: buildConnectorCriteria(revitDomain, kind, mainPair[1].run, node.point, connectorToleranceMm),
        thirdElementId: `@${branch.run.opId}`,
        thirdConnector: buildConnectorCriteria(revitDomain, kind, branch.run, node.point, connectorToleranceMm)
      });
      fittingPoints.push(node.point);
    } else if (eps.length === 4) {
      let pairA = null;
      let pairB = null;
      const combos = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
      for (const [[a1, a2], [b1, b2]] of combos) {
        if (dot3(eps[a1].dir, eps[a2].dir) <= -0.96 && dot3(eps[b1].dir, eps[b2].dir) <= -0.96) {
          pairA = [eps[a1], eps[a2]];
          pairB = [eps[b1], eps[b2]];
          break;
        }
      }
      if (!pairA) {
        skippedJunctions.push({
          point: node.point,
          degree: 4,
          connectedIds: eps.map(e => e.run.opId),
          reason: 'non_orthogonal_4way_junction',
          details: 'Revit NewCrossFitting requires two collinear opposing main/branch pairs.'
        });
        continue;
      }
      fittingOperations.push({
        operationType: 'create_fitting',
        id: `fit_${fittingOperations.length + 1}`,
        fittingType: 'cross',
        firstElementId: `@${pairA[0].run.opId}`,
        firstConnector: buildConnectorCriteria(revitDomain, kind, pairA[0].run, node.point, connectorToleranceMm),
        secondElementId: `@${pairA[1].run.opId}`,
        secondConnector: buildConnectorCriteria(revitDomain, kind, pairA[1].run, node.point, connectorToleranceMm),
        thirdElementId: `@${pairB[0].run.opId}`,
        thirdConnector: buildConnectorCriteria(revitDomain, kind, pairB[0].run, node.point, connectorToleranceMm),
        fourthElementId: `@${pairB[1].run.opId}`,
        fourthConnector: buildConnectorCriteria(revitDomain, kind, pairB[1].run, node.point, connectorToleranceMm)
      });
      fittingPoints.push(node.point);
    } else {
      skippedJunctions.push({
        point: node.point,
        degree: eps.length,
        connectedIds: eps.map(e => e.run.opId),
        reason: 'unsupported_high_degree_junction',
        details: `Junction degree ${eps.length} exceeds 4-way cross fitting support.`
      });
    }
  }

  let outputSvgPath = null;
  if (typeof input.outputSvgPath === 'string' && input.outputSvgPath.trim()) {
    const svg = renderMepSvg({
      runs: validRuns,
      fittingPoints,
      riserPoints: generatedRisers.map(r => r.start),
      skippedJunctions,
      domain: kind
    });
    await fs.mkdir(path.dirname(input.outputSvgPath), { recursive: true });
    await fs.writeFile(input.outputSvgPath, svg, 'utf8');
    outputSvgPath = input.outputSvgPath;
  }

  return {
    status: skippedJunctions.length === 0 ? 'auto_connect_complete' : 'auto_connect_partial',
    readOnly: true,
    candidateOnly: true,
    domain: kind,
    revitConnectorDomain: revitDomain,
    artifacts: { svgPreviewPath: outputSvgPath },
    summary: {
      inputRunCount: inputRuns.length,
      generatedRiserCount: generatedRisers.length,
      emittedStraightCount: straightOperations.length,
      emittedFittingCount: fittingOperations.length,
      emittedExistingConnectionCount: connectionOperations.length,
      skippedJunctionCount: skippedJunctions.length,
      skippedShortSegmentCount: skippedShortSegments.length,
      fittingsByType: fittingOperations.reduce((acc, f) => {
        acc[f.fittingType] = (acc[f.fittingType] || 0) + 1;
        return acc;
      }, {})
    },
    skippedJunctions,
    skippedShortSegments,
    straightOperations,
    fittingOperations,
    connectionOperations,
    combinedOperations: [...straightOperations, ...fittingOperations, ...connectionOperations]
  };
}
