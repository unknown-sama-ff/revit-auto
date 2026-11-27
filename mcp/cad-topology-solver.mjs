import fs from 'node:fs/promises';
import path from 'node:path';

const DEG = Math.PI / 180;

function round2(v) {
  return Math.round(v * 100) / 100;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

function hypot(dx, dy) {
  return Math.sqrt(dx * dx + dy * dy);
}

function normAngleRad(angle) {
  let a = angle % Math.PI;
  if (a < 0) a += Math.PI;
  if (Math.PI - a < 1e-6) a = 0;
  return a;
}

function angleDiffRad(a, b) {
  let d = Math.abs(normAngleRad(a) - normAngleRad(b));
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}

function pointToSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function intersectLines2D(a, b) {
  const d1x = a.x2 - a.x1;
  const d1y = a.y2 - a.y1;
  const d2x = b.x2 - b.x1;
  const d2y = b.y2 - b.y1;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const dx = b.x1 - a.x1;
  const dy = b.y1 - a.y1;
  const t = (dx * d2y - dy * d2x) / denom;
  const u = (dx * d1y - dy * d1x) / denom;
  const x = a.x1 + t * d1x;
  const y = a.y1 + t * d1y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, t, u };
}

function segmentInCrop(x1, y1, x2, y2, crop) {
  if (!crop) return true;
  const minX = crop.min.xMm;
  const minY = crop.min.yMm;
  const maxX = crop.max.xMm;
  const maxY = crop.max.yMm;
  if (Math.max(x1, x2) < minX || Math.min(x1, x2) > maxX || Math.max(y1, y2) < minY || Math.min(y1, y2) > maxY) {
    return false;
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - minX, maxX - x1, y1 - minY, maxY - y1];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
}

function pointInBox(x, y, box, margin = 0) {
  return x >= box.min.xMm - margin && x <= box.max.xMm + margin && y >= box.min.yMm - margin && y <= box.max.yMm + margin;
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
    return {
      x: offX + x * cs - y * sn,
      y: offY + x * sn + y * cs
    };
  };
}

export async function loadGeometryPrimitives({ geometryJsonlPath, primitives } = {}) {
  if (Array.isArray(primitives)) return primitives;
  if (typeof geometryJsonlPath === 'string' && geometryJsonlPath.trim()) {
    const raw = await fs.readFile(geometryJsonlPath, 'utf8');
    const out = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed));
      } catch {
        // Ignore malformed trailing lines gracefully.
      }
    }
    return out;
  }
  throw new Error('Provide either geometryJsonlPath or primitives array.');
}

function fixOffAxisSegment(seg, fixOffAxisDegrees) {
  if (!fixOffAxisDegrees || fixOffAxisDegrees <= 0) return seg;
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const len = hypot(dx, dy);
  if (len < 1e-3) return seg;
  const tolRad = fixOffAxisDegrees * DEG;
  const ang = normAngleRad(Math.atan2(dy, dx));
  const midX = (seg.x1 + seg.x2) * 0.5;
  const midY = (seg.y1 + seg.y2) * 0.5;
  if (ang <= tolRad || Math.PI - ang <= tolRad) {
    const half = len * 0.5;
    return {
      ...seg,
      x1: midX - half,
      y1: midY,
      x2: midX + half,
      y2: midY,
      offAxisFixed: ang > 1e-5 && Math.PI - ang > 1e-5
    };
  }
  if (Math.abs(ang - Math.PI / 2) <= tolRad) {
    const half = len * 0.5;
    return {
      ...seg,
      x1: midX,
      y1: midY - half,
      x2: midX,
      y2: midY + half,
      offAxisFixed: Math.abs(ang - Math.PI / 2) > 1e-5
    };
  }
  return { ...seg, offAxisFixed: false };
}

function canonicalizeSegment(seg) {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const len = hypot(dx, dy);
  if (len < 1e-3) return null;
  let { x1, y1, x2, y2 } = seg;
  if (x2 < x1 - 1e-6 || (Math.abs(x2 - x1) <= 1e-6 && y2 < y1)) {
    [x1, y1, x2, y2] = [x2, y2, x1, y1];
  }
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const angle = normAngleRad(Math.atan2(y2 - y1, x2 - x1));
  return { ...seg, x1, y1, x2, y2, len, ux, uy, angle };
}

function subtractIntervals(intervals, cutStart, cutEnd) {
  const out = [];
  for (const [a, b] of intervals) {
    if (cutEnd <= a + 0.5 || cutStart >= b - 0.5) {
      out.push([a, b]);
    } else {
      if (cutStart > a + 0.5) out.push([a, cutStart]);
      if (cutEnd < b - 0.5) out.push([cutEnd, b]);
    }
  }
  return out;
}

function matchLayer(layer, layerList) {
  if (!layerList || layerList.length === 0) return false;
  const lower = String(layer || '').toLowerCase();
  return layerList.some(item => {
    if (typeof item !== 'string') return false;
    if (item.startsWith('/') && item.endsWith('/') && item.length > 2) {
      return new RegExp(item.slice(1, -1), 'i').test(layer || '');
    }
    return lower === item.toLowerCase();
  });
}

function extractClosedRects(primitives, layerList, xform, crop, { minMm = 80, maxMm = 3000 } = {}) {
  const rects = [];
  for (const prim of primitives) {
    const t = prim.t || prim.type;
    const layer = prim.l || prim.layer || '0';
    if (!matchLayer(layer, layerList)) continue;
    if (t === 'LWPOLYLINE' || t === 'POLYLINE') {
      const rawPts = prim.pts || [];
      if (rawPts.length < 4) continue;
      const pts = rawPts.map(xform);
      // Drop repeated closing vertex if present.
      if (pts.length >= 5 && hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) <= 2) {
        pts.pop();
      }
      if (pts.length !== 4) continue;
      const xs = pts.map(p => p.x);
      const ys = pts.map(p => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const cx = (minX + maxX) * 0.5;
      const cy = (minY + maxY) * 0.5;
      if (crop && !pointInBox(cx, cy, crop)) continue;
      const e0x = pts[1].x - pts[0].x;
      const e0y = pts[1].y - pts[0].y;
      const e1x = pts[2].x - pts[1].x;
      const e1y = pts[2].y - pts[1].y;
      const w = hypot(e0x, e0y);
      const h = hypot(e1x, e1y);
      if (w < minMm || h < minMm || w > maxMm || h > maxMm) continue;
      const dot = Math.abs((e0x * e1x + e0y * e1y) / (w * h));
      if (dot > 0.08) continue;
      const rot = normAngleRad(Math.atan2(e0y, e0x)) / DEG;
      const orthoRot = Math.abs(rot) <= 1 || Math.abs(rot - 90) <= 1 || Math.abs(rot - 180) <= 1 ? 0 : round2(rot);
      const widthMm = orthoRot === 0 ? Math.round(maxX - minX) : Math.round(w);
      const depthMm = orthoRot === 0 ? Math.round(maxY - minY) : Math.round(h);
      rects.push({
        cx: round2(cx),
        cy: round2(cy),
        widthMm,
        depthMm,
        halfX: (maxX - minX) * 0.5,
        halfY: (maxY - minY) * 0.5,
        rotationDegrees: orthoRot,
        layer,
        handle: prim.h || null
      });
    }
  }
  // Deduplicate co-located column rectangles.
  const deduped = [];
  for (const r of rects) {
    if (!deduped.some(d => hypot(d.cx - r.cx, d.cy - r.cy) <= 30 && Math.abs(d.widthMm - r.widthMm) <= 20 && Math.abs(d.depthMm - r.depthMm) <= 20)) {
      deduped.push(r);
    }
  }
  return deduped;
}

function extractOpenings(primitives, openingLayers, kind, xform, crop, fixOffAxisDegrees) {
  if (!openingLayers || openingLayers.length === 0) return [];
  const openings = [];
  const rawSegs = [];

  for (const prim of primitives) {
    const t = prim.t || prim.type;
    const layer = prim.l || prim.layer || '0';
    if (!matchLayer(layer, openingLayers)) continue;
    if (t === 'INSERT' && Array.isArray(prim.p)) {
      const pt = xform(prim.p);
      if (crop && !pointInBox(pt.x, pt.y, crop)) continue;
      const sx = Math.abs(prim.s?.[0] ?? 1);
      const sy = Math.abs(prim.s?.[1] ?? 1);
      const rotRad = Number(prim.r ?? 0);
      const angle = normAngleRad(rotRad);
      const name = String(prim.b || '');
      const widthHint = inferWidthFromTag(name) || (sx >= 400 && sx <= 5000 ? Math.round(sx) : (sy >= 400 && sy <= 5000 ? Math.round(sy) : null));
      openings.push({
        kind,
        source: 'INSERT',
        blockName: name,
        layer,
        handle: prim.h || null,
        cx: round2(pt.x),
        cy: round2(pt.y),
        widthMm: widthHint || (kind === 'door' ? 900 : 1500),
        angleRad: angle
      });
    } else if (t === 'LINE' && Array.isArray(prim.p1) && Array.isArray(prim.p2)) {
      const a = xform(prim.p1);
      const b = xform(prim.p2);
      if (!segmentInCrop(a.x, a.y, b.x, b.y, crop)) continue;
      const fixed = canonicalizeSegment(fixOffAxisSegment({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, layer, handle: prim.h || null }, fixOffAxisDegrees));
      if (fixed && fixed.len >= 350 && fixed.len <= 8000) rawSegs.push(fixed);
    }
  }

  // Group parallel line-drawn window/door symbols into opening boxes (when not already covered by INSERT).
  const used = new Array(rawSegs.length).fill(false);
  for (let i = 0; i < rawSegs.length; i++) {
    if (used[i]) continue;
    const seed = rawSegs[i];
    const cluster = [seed];
    used[i] = true;
    for (let j = i + 1; j < rawSegs.length; j++) {
      if (used[j]) continue;
      const cand = rawSegs[j];
      if (angleDiffRad(seed.angle, cand.angle) > 3 * DEG) continue;
      const perp = Math.abs((cand.x1 - seed.x1) * (-seed.uy) + (cand.y1 - seed.y1) * seed.ux);
      if (perp > 360) continue;
      const u0 = (cand.x1 - seed.x1) * seed.ux + (cand.y1 - seed.y1) * seed.uy;
      const u1 = (cand.x2 - seed.x1) * seed.ux + (cand.y2 - seed.y1) * seed.uy;
      const ov = Math.min(seed.len, Math.max(u0, u1)) - Math.max(0, Math.min(u0, u1));
      if (ov >= Math.min(seed.len, cand.len) * 0.6) {
        cluster.push(cand);
        used[j] = true;
      }
    }
    if (cluster.length >= 2) {
      let minU = Infinity;
      let maxU = -Infinity;
      let sumV = 0;
      for (const s of cluster) {
        const u1 = (s.x1 - seed.x1) * seed.ux + (s.y1 - seed.y1) * seed.uy;
        const u2 = (s.x2 - seed.x1) * seed.ux + (s.y2 - seed.y1) * seed.uy;
        const v1 = (s.x1 - seed.x1) * (-seed.uy) + (s.y1 - seed.y1) * seed.ux;
        minU = Math.min(minU, u1, u2);
        maxU = Math.max(maxU, u1, u2);
        sumV += v1;
      }
      const midU = (minU + maxU) * 0.5;
      const midV = sumV / cluster.length;
      const cx = seed.x1 + midU * seed.ux - midV * seed.uy;
      const cy = seed.y1 + midU * seed.uy + midV * seed.ux;
      const widthMm = Math.round(maxU - minU);
      if (!openings.some(o => hypot(o.cx - cx, o.cy - cy) <= 250)) {
        openings.push({
          kind,
          source: 'LINE_SYMBOL',
          blockName: null,
          layer: seed.layer,
          handle: seed.handle,
          cx: round2(cx),
          cy: round2(cy),
          widthMm,
          angleRad: seed.angle
        });
      }
    }
  }
  return openings;
}

function inferWidthFromTag(text) {
  const m = /(?:^|[^A-Za-z0-9])(?:M|FM|GM|C|LC|PC|TC|BYC|MC)(\d{2})(\d{2})/i.exec(text || '');
  if (!m) return null;
  const w = Number(m[1]) * 100;
  return w >= 500 && w <= 6000 ? w : null;
}

function pairDoubleLines(wallSegments, thicknessRules, minPairOverlapMm = 80) {
  // Sort rules thinner-first (unless explicit priority orders them) so conventional partitions
  // pair cleanly before wider basement/retaining walls up to 550mm+.
  const rules = [...thicknessRules]
    .map((r, idx) => ({
      cadWidthMm: Number(r.cadWidthMm),
      toleranceMm: Number(r.toleranceMm ?? 5),
      wallTypeId: r.wallTypeId,
      name: r.name || `Wall_${r.cadWidthMm}mm`,
      structural: Boolean(r.structural),
      priority: Number.isFinite(r.priority) ? Number(r.priority) : (r.structural ? 1000 : 0) + Number(r.cadWidthMm),
      layers: Array.isArray(r.layers) ? r.layers : (typeof r.layer === 'string' ? [r.layer] : null),
      ruleIndex: idx
    }))
    .sort((a, b) => a.cadWidthMm - b.cadWidthMm || a.ruleIndex - b.ruleIndex);

  const states = wallSegments.map((seg, idx) => ({
    idx,
    seg,
    remaining: [[0, seg.len]]
  }));

  const paired = [];
  const angleTolRad = 1.5 * DEG;
  const maxRuleWidth = Math.max(...rules.map(r => r.cadWidthMm + r.toleranceMm), 0);

  // Spatial grid bucket by cell size = max(1000, maxRuleWidth * 2) for O(N) lookup.
  const cellSize = Math.max(1000, maxRuleWidth * 2);
  const grid = new Map();
  const addToCell = (gx, gy, idx) => {
    const key = `${gx},${gy}`;
    let bucket = grid.get(key);
    if (!bucket) { bucket = []; grid.set(key, bucket); }
    bucket.push(idx);
  };
  for (const st of states) {
    const minGX = Math.floor((Math.min(st.seg.x1, st.seg.x2) - maxRuleWidth) / cellSize);
    const maxGX = Math.floor((Math.max(st.seg.x1, st.seg.x2) + maxRuleWidth) / cellSize);
    const minGY = Math.floor((Math.min(st.seg.y1, st.seg.y2) - maxRuleWidth) / cellSize);
    const maxGY = Math.floor((Math.max(st.seg.y1, st.seg.y2) + maxRuleWidth) / cellSize);
    for (let gx = minGX; gx <= maxGX; gx++) {
      for (let gy = minGY; gy <= maxGY; gy++) addToCell(gx, gy, st.idx);
    }
  }

  for (const rule of rules) {
    const minW = Math.max(10, rule.cadWidthMm - rule.toleranceMm);
    const maxW = rule.cadWidthMm + rule.toleranceMm;
    const candidates = [];

    const seenPair = new Set();
    for (const stA of states) {
      if (stA.remaining.length === 0) continue;
      if (rule.layers && !matchLayer(stA.seg.layer, rule.layers)) continue;
      const minGX = Math.floor((Math.min(stA.seg.x1, stA.seg.x2) - maxW) / cellSize);
      const maxGX = Math.floor((Math.max(stA.seg.x1, stA.seg.x2) + maxW) / cellSize);
      const minGY = Math.floor((Math.min(stA.seg.y1, stA.seg.y2) - maxW) / cellSize);
      const maxGY = Math.floor((Math.max(stA.seg.y1, stA.seg.y2) + maxW) / cellSize);
      for (let gx = minGX; gx <= maxGX; gx++) {
        for (let gy = minGY; gy <= maxGY; gy++) {
          const bucket = grid.get(`${gx},${gy}`);
          if (!bucket) continue;
          for (const bIdx of bucket) {
            if (bIdx <= stA.idx) continue;
            const pairKey = `${stA.idx}:${bIdx}`;
            if (seenPair.has(pairKey)) continue;
            seenPair.add(pairKey);
            const stB = states[bIdx];
            if (stB.remaining.length === 0) continue;
            if (rule.layers && !matchLayer(stB.seg.layer, rule.layers)) continue;
            if (angleDiffRad(stA.seg.angle, stB.seg.angle) > angleTolRad) continue;

            const ux = stA.seg.ux;
            const uy = stA.seg.uy;
            const nx = -uy;
            const ny = ux;
            const perpSigned = (stB.seg.x1 - stA.seg.x1) * nx + (stB.seg.y1 - stA.seg.y1) * ny;
            const perp = Math.abs(perpSigned);
            if (perp < minW || perp > maxW) continue;

            const bU0 = (stB.seg.x1 - stA.seg.x1) * ux + (stB.seg.y1 - stA.seg.y1) * uy;
            const bU1 = (stB.seg.x2 - stA.seg.x1) * ux + (stB.seg.y2 - stA.seg.y1) * uy;
            const bMin = Math.min(bU0, bU1);
            const bMax = Math.max(bU0, bU1);
            const ov0 = Math.max(0, bMin);
            const ov1 = Math.min(stA.seg.len, bMax);
            const ovLen = ov1 - ov0;
            if (ovLen < minPairOverlapMm) continue;

            candidates.push({
              aIdx: stA.idx,
              bIdx,
              perp,
              perpSigned,
              widthErr: Math.abs(perp - rule.cadWidthMm),
              ovLen,
              bU0,
              bU1
            });
          }
        }
      }
    }

    // Prefer exact width matches and longer overlaps first.
    candidates.sort((p, q) => p.widthErr - q.widthErr || q.ovLen - p.ovLen || p.aIdx - q.aIdx || p.bIdx - q.bIdx);

    for (const c of candidates) {
      const stA = states[c.aIdx];
      const stB = states[c.bIdx];
      if (stA.remaining.length === 0 || stB.remaining.length === 0) continue;
      const ux = stA.seg.ux;
      const uy = stA.seg.uy;
      const nx = -uy;
      const ny = ux;
      const bSign = c.bU1 >= c.bU0 ? 1 : -1;

      // Project stB's remaining intervals into stA's 1D u-space and intersect with stA.remaining.
      const bIntervalsInA = stB.remaining.map(([s, e]) => {
        const u0 = c.bU0 + bSign * s;
        const u1 = c.bU0 + bSign * e;
        return [Math.min(u0, u1), Math.max(u0, u1)];
      });

      const matchedSpans = [];
      for (const [a0, a1] of stA.remaining) {
        for (const [b0, b1] of bIntervalsInA) {
          const lo = Math.max(a0, b0);
          const hi = Math.min(a1, b1);
          if (hi - lo >= minPairOverlapMm) matchedSpans.push([lo, hi]);
        }
      }
      if (matchedSpans.length === 0) continue;

      for (const [lo, hi] of matchedSpans) {
        // Reject pairing across an intermediate parallel line (e.g., corridor or double shaft).
        const midU = (lo + hi) * 0.5;
        const midX = stA.seg.x1 + midU * ux + (c.perpSigned * 0.5) * nx;
        const midY = stA.seg.y1 + midU * uy + (c.perpSigned * 0.5) * ny;
        const cellBucket = grid.get(`${Math.floor(midX / cellSize)},${Math.floor(midY / cellSize)}`) || [];
        let blocked = false;
        for (const otherIdx of cellBucket) {
          if (otherIdx === c.aIdx || otherIdx === c.bIdx) continue;
          const o = states[otherIdx].seg;
          if (angleDiffRad(o.angle, stA.seg.angle) > angleTolRad) continue;
          const oPerp = (o.x1 - stA.seg.x1) * nx + (o.y1 - stA.seg.y1) * ny;
          const frac = oPerp / c.perpSigned;
          if (frac <= 0.12 || frac >= 0.88) continue;
          const ou0 = (o.x1 - stA.seg.x1) * ux + (o.y1 - stA.seg.y1) * uy;
          const ou1 = (o.x2 - stA.seg.x1) * ux + (o.y2 - stA.seg.y1) * uy;
          const oOv = Math.min(hi, Math.max(ou0, ou1)) - Math.max(lo, Math.min(ou0, ou1));
          if (oOv >= (hi - lo) * 0.45) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        const halfOffset = c.perpSigned * 0.5;
        const x1 = stA.seg.x1 + lo * ux + halfOffset * nx;
        const y1 = stA.seg.y1 + lo * uy + halfOffset * ny;
        const x2 = stA.seg.x1 + hi * ux + halfOffset * nx;
        const y2 = stA.seg.y1 + hi * uy + halfOffset * ny;

        stA.remaining = subtractIntervals(stA.remaining, lo, hi);
        const bLo = bSign > 0 ? lo - c.bU0 : c.bU0 - hi;
        const bHi = bSign > 0 ? hi - c.bU0 : c.bU0 - lo;
        stB.remaining = subtractIntervals(stB.remaining, Math.min(bLo, bHi), Math.max(bLo, bHi));

        const canon = canonicalizeSegment({
          x1, y1, x2, y2,
          thicknessMm: rule.cadWidthMm,
          measuredThicknessMm: round2(c.perp),
          wallTypeId: rule.wallTypeId,
          wallTypeName: rule.name,
          structural: rule.structural,
          priority: rule.priority,
          layer: stA.seg.layer,
          sourceHandles: [stA.seg.handle, stB.seg.handle].filter(Boolean)
        });
        if (canon) paired.push(canon);
      }
    }
  }

  return paired;
}

function mergeCollinearWalls(walls, { bridgeGapRangeMm = [0, 1500], noBridgeZones = [], bridgeMode = 'bimify_range', columns = [], openings = [] } = {}) {
  if (walls.length <= 1) return walls.map(w => ({ ...w }));
  const [minGap, maxGap] = bridgeGapRangeMm;
  const groups = [];

  for (const w of walls) {
    let targetGroup = null;
    for (const g of groups) {
      if (g.wallTypeId !== w.wallTypeId || g.thicknessMm !== w.thicknessMm || g.structural !== w.structural) continue;
      if (angleDiffRad(g.angle, w.angle) > 1.5 * DEG) continue;
      const perp = Math.abs((w.x1 - g.ox) * (-g.uy) + (w.y1 - g.oy) * g.ux);
      if (perp <= Math.max(15, w.thicknessMm * 0.15)) {
        targetGroup = g;
        break;
      }
    }
    if (!targetGroup) {
      targetGroup = {
        wallTypeId: w.wallTypeId,
        wallTypeName: w.wallTypeName,
        thicknessMm: w.thicknessMm,
        structural: w.structural,
        priority: w.priority,
        layer: w.layer,
        angle: w.angle,
        ox: w.x1,
        oy: w.y1,
        ux: w.ux,
        uy: w.uy,
        items: []
      };
      groups.push(targetGroup);
    }
    targetGroup.items.push(w);
  }

  const merged = [];
  for (const g of groups) {
    const intervals = g.items.map(w => {
      const u1 = (w.x1 - g.ox) * g.ux + (w.y1 - g.oy) * g.uy;
      const u2 = (w.x2 - g.ox) * g.ux + (w.y2 - g.oy) * g.uy;
      const v = ((w.x1 - g.ox) * (-g.uy) + (w.y1 - g.oy) * g.ux + (w.x2 - g.ox) * (-g.uy) + (w.y2 - g.oy) * g.ux) * 0.5;
      return { u0: Math.min(u1, u2), u1: Math.max(u1, u2), v, len: w.len, handles: w.sourceHandles || [], measuredThicknessMm: w.measuredThicknessMm };
    }).sort((a, b) => a.u0 - b.u0 || a.u1 - b.u1);

    const acc = [];
    for (const cur of intervals) {
      if (acc.length === 0) {
        acc.push({ ...cur, weight: cur.len });
        continue;
      }
      const prev = acc[acc.length - 1];
      const gap = cur.u0 - prev.u1;
      let shouldBridge = gap <= 2;
      if (!shouldBridge && gap >= minGap && gap <= maxGap) {
        const midU = (prev.u1 + cur.u0) * 0.5;
        const midX = g.ox + midU * g.ux - prev.v * g.uy;
        const midY = g.oy + midU * g.uy + prev.v * g.ux;
        const blockedByNoBridge = noBridgeZones.some(z => pointInBox(midX, midY, z));
        if (!blockedByNoBridge) {
          if (bridgeMode === 'bimify_range') {
            shouldBridge = true;
          } else {
            // Evidence-only mode: bridge only when a door/window/column sits inside the gap.
            const hasOpening = openings.some(o => pointToSegDist(o.cx, o.cy, g.ox + prev.u1 * g.ux - prev.v * g.uy, g.oy + prev.u1 * g.uy + prev.v * g.ux, g.ox + cur.u0 * g.ux - prev.v * g.uy, g.oy + cur.u0 * g.uy + prev.v * g.ux) <= g.thicknessMm + 180);
            const hasCol = columns.some(c => pointToSegDist(c.cx, c.cy, g.ox + prev.u1 * g.ux - prev.v * g.uy, g.oy + prev.u1 * g.uy + prev.v * g.ux, g.ox + cur.u0 * g.ux - prev.v * g.uy, g.oy + cur.u0 * g.uy + prev.v * g.ux) <= Math.max(c.halfX, c.halfY) + g.thicknessMm);
            shouldBridge = hasOpening || hasCol || gap <= g.thicknessMm + 40;
          }
        }
      }
      if (shouldBridge) {
        const wSum = prev.weight + cur.len;
        prev.v = (prev.v * prev.weight + cur.v * cur.len) / wSum;
        prev.u1 = Math.max(prev.u1, cur.u1);
        prev.weight = wSum;
        prev.handles = [...new Set([...prev.handles, ...cur.handles])];
      } else {
        acc.push({ ...cur, weight: cur.len });
      }
    }

    for (const item of acc) {
      const x1 = g.ox + item.u0 * g.ux - item.v * g.uy;
      const y1 = g.oy + item.u0 * g.uy + item.v * g.ux;
      const x2 = g.ox + item.u1 * g.ux - item.v * g.uy;
      const y2 = g.oy + item.u1 * g.uy + item.v * g.ux;
      const canon = canonicalizeSegment({
        x1, y1, x2, y2,
        thicknessMm: g.thicknessMm,
        measuredThicknessMm: item.measuredThicknessMm,
        wallTypeId: g.wallTypeId,
        wallTypeName: g.wallTypeName,
        structural: g.structural,
        priority: g.priority,
        layer: g.layer,
        sourceHandles: item.handles
      });
      if (canon) merged.push(canon);
    }
  }
  return merged;
}

function solveCornerGraph(walls, columns, { cornerExtendMaxMm = 450, columnSnapMaxMm = 400, minWallLengthMm = 150 } = {}) {
  // Single-pass immutable snapshot: evaluate every endpoint against original wall geometry
  // so no parallel wall pulls an outer wall endpoint inward during iteration.
  const snapDecisions = walls.map(() => ({
    start: null,
    end: null
  }));

  for (let i = 0; i < walls.length; i++) {
    const wi = walls[i];
    const maxExtI = Math.max(cornerExtendMaxMm, wi.thicknessMm * 1.5);
    for (const endKey of ['start', 'end']) {
      const ex = endKey === 'start' ? wi.x1 : wi.x2;
      const ey = endKey === 'start' ? wi.y1 : wi.y2;
      const outX = endKey === 'start' ? -wi.ux : wi.ux;
      const outY = endKey === 'start' ? -wi.uy : wi.uy;

      let best = null;
      for (let j = 0; j < walls.length; j++) {
        if (i === j) continue;
        const wj = walls[j];
        // Non-parallel wall intersection check (sin >= 0.25 => angle >= ~14.5 deg).
        const sinAng = Math.abs(wi.ux * wj.uy - wi.uy * wj.ux);
        if (sinAng < 0.25) continue;

        const hit = intersectLines2D(wi, wj);
        if (!hit) continue;

        const alongOut = (hit.x - ex) * outX + (hit.y - ey) * outY;
        const maxTrim = Math.min(wi.len * 0.35, Math.max(wj.thicknessMm, 250));
        if (alongOut < -maxTrim || alongOut > maxExtI) continue;

        const maxExtJ = Math.max(cornerExtendMaxMm, wj.thicknessMm * 1.5, wi.thicknessMm * 1.2);
        const uOnJ = hit.u * wj.len;
        if (uOnJ < -maxExtJ || uOnJ > wj.len + maxExtJ) continue;

        const dist = hypot(hit.x - ex, hit.y - ey);
        const isOnInteriorJ = uOnJ >= -wj.thicknessMm * 0.6 && uOnJ <= wj.len + wj.thicknessMm * 0.6;
        const nearJStart = Math.abs(uOnJ) <= maxExtJ;
        const nearJEnd = Math.abs(uOnJ - wj.len) <= maxExtJ;
        const cornerKind = isOnInteriorJ && !nearJStart && !nearJEnd ? 'T_ABUT' : 'L_MITER';
        const score = dist + (isOnInteriorJ ? 0 : 15);

        if (!best || score < best.score) {
          best = {
            kind: cornerKind,
            targetWallIdx: j,
            x: hit.x,
            y: hit.y,
            dist,
            score,
            uOnJ,
            nearJStart,
            nearJEnd
          };
        }
      }

      if (best) {
        snapDecisions[i][endKey] = best;
      } else {
        // Fallback: check structural columns along outward ray ONLY if no closer wall intersection exists.
        let bestCol = null;
        for (let cIdx = 0; cIdx < columns.length; cIdx++) {
          const c = columns[cIdx];
          const rx = c.cx - ex;
          const ry = c.cy - ey;
          const along = rx * outX + ry * outY;
          const perp = Math.abs(-rx * outY + ry * outX);
          const colPerpHalf = Math.abs(outY) * c.halfX + Math.abs(outX) * c.halfY;
          const colAlongHalf = Math.abs(outX) * c.halfX + Math.abs(outY) * c.halfY;
          if (perp > colPerpHalf + wi.thicknessMm * 0.5 + 40) continue;
          const gapToFace = along - colAlongHalf;
          if (gapToFace >= -colAlongHalf * 1.5 && gapToFace <= columnSnapMaxMm) {
            const targetDist = Math.abs(along);
            if (!bestCol || targetDist < bestCol.dist) {
              bestCol = {
                kind: 'COLUMN_SNAP',
                columnIdx: cIdx,
                x: ex + along * outX,
                y: ey + along * outY,
                dist: targetDist
              };
            }
          }
        }
        if (bestCol) snapDecisions[i][endKey] = bestCol;
      }
    }
  }

  // Apply snapped coordinates cleanly without cascading drift.
  const solved = [];
  const columnJoins = [];
  const wallJoins = [];

  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const ds = snapDecisions[i].start;
    const de = snapDecisions[i].end;
    const x1 = ds ? ds.x : w.x1;
    const y1 = ds ? ds.y : w.y1;
    const x2 = de ? de.x : w.x2;
    const y2 = de ? de.y : w.y2;
    const newLen = hypot(x2 - x1, y2 - y1);

    // Protect short Z-fold connectors if at least one end connected; filter only truly tiny noise.
    const connectedEnds = (ds ? 1 : 0) + (de ? 1 : 0);
    if (newLen < 20 || (connectedEnds === 0 && newLen < minWallLengthMm)) continue;

    const joinTypeStart = ds?.kind === 'L_MITER' ? 'miter' : (ds?.kind === 'T_ABUT' ? 'abut' : undefined);
    const joinTypeEnd = de?.kind === 'L_MITER' ? 'miter' : (de?.kind === 'T_ABUT' ? 'abut' : undefined);

    solved.push({
      ...w,
      originalIdx: i,
      x1: round2(x1),
      y1: round2(y1),
      x2: round2(x2),
      y2: round2(y2),
      len: round2(newLen),
      ux: (x2 - x1) / newLen,
      uy: (y2 - y1) / newLen,
      startSnap: ds,
      endSnap: de,
      disallowJoinStart: false,
      disallowJoinEnd: false,
      joinTypeStart,
      joinTypeEnd
    });
  }

  // Detect close parallel walls where auto-join would pull endpoints laterally and mark ONLY the affected end.
  for (let i = 0; i < solved.length; i++) {
    const a = solved[i];
    for (let j = i + 1; j < solved.length; j++) {
      const b = solved[j];
      if (angleDiffRad(a.angle, b.angle) > 2 * DEG) continue;
      const perp = Math.abs((b.x1 - a.x1) * (-a.uy) + (b.y1 - a.y1) * a.ux);
      if (perp > 5 && perp < (a.thicknessMm + b.thicknessMm) * 0.5 + 80) {
        if (hypot(a.x1 - b.x1, a.y1 - b.y1) < 220 || hypot(a.x1 - b.x2, a.y1 - b.y2) < 220) a.disallowJoinStart = true;
        if (hypot(a.x2 - b.x1, a.y2 - b.y1) < 220 || hypot(a.x2 - b.x2, a.y2 - b.y2) < 220) a.disallowJoinEnd = true;
      }
    }
  }

  // Re-index originalIdx -> solvedIdx for column & dissimilar-wall JoinGeometryUtils pairs.
  const origToSolved = new Map(solved.map((w, idx) => [w.originalIdx, idx]));
  const seenWallJoin = new Set();
  for (let idx = 0; idx < solved.length; idx++) {
    const w = solved[idx];
    for (const snap of [w.startSnap, w.endSnap]) {
      if (!snap) continue;
      if (snap.kind === 'COLUMN_SNAP') {
        columnJoins.push({ wallIdx: idx, columnIdx: snap.columnIdx });
      } else if (snap.targetWallIdx !== undefined && origToSolved.has(snap.targetWallIdx)) {
        const otherIdx = origToSolved.get(snap.targetWallIdx);
        const key = idx < otherIdx ? `${idx}:${otherIdx}` : `${otherIdx}:${idx}`;
        if (!seenWallJoin.has(key) && (w.thicknessMm !== solved[otherIdx].thicknessMm || w.structural !== solved[otherIdx].structural)) {
          seenWallJoin.add(key);
          wallJoins.push({ firstWallIdx: Math.min(idx, otherIdx), secondWallIdx: Math.max(idx, otherIdx) });
        }
      }
    }
    // Also detect columns sitting along a continuous wall interior for JoinGeometryUtils.
    for (let cIdx = 0; cIdx < columns.length; cIdx++) {
      const c = columns[cIdx];
      if (pointToSegDist(c.cx, c.cy, w.x1, w.y1, w.x2, w.y2) <= Math.max(c.halfX, c.halfY) + w.thicknessMm * 0.5) {
        if (!columnJoins.some(j => j.wallIdx === idx && j.columnIdx === cIdx)) {
          columnJoins.push({ wallIdx: idx, columnIdx: cIdx });
        }
      }
    }
  }

  return { walls: solved, columnJoins, wallJoins };
}

export function orderWallsTopologically(walls) {
  return [...walls].sort((a, b) => {
    const sr = (a.structural ? 0 : 1) - (b.structural ? 0 : 1);
    if (sr !== 0) return sr;
    const jrA = (a.disallowJoinStart ? 1 : 0) + (a.disallowJoinEnd ? 1 : 0);
    const jrB = (b.disallowJoinStart ? 1 : 0) + (b.disallowJoinEnd ? 1 : 0);
    if (jrA !== jrB) return jrA - jrB;
    const pr = (b.priority ?? b.thicknessMm) - (a.priority ?? a.thicknessMm);
    if (pr !== 0) return pr;
    const lr = b.len - a.len;
    if (Math.abs(lr) > 0.01) return lr;
    const minXA = Math.min(a.x1, a.x2);
    const minXB = Math.min(b.x1, b.x2);
    if (minXA !== minXB) return minXA - minXB;
    return Math.min(a.y1, a.y2) - Math.min(b.y1, b.y2);
  });
}

function bindOpeningsToWalls(openings, orderedWalls) {
  const bound = [];
  const unbound = [];
  for (const op of openings) {
    let best = null;
    for (let i = 0; i < orderedWalls.length; i++) {
      const w = orderedWalls[i];
      // Force same-orientation host match (horizontal opening -> horizontal wall, vertical -> vertical).
      const cosDiff = Math.abs(Math.cos(op.angleRad) * w.ux + Math.sin(op.angleRad) * w.uy);
      if (cosDiff < 0.96) continue;
      const dist = pointToSegDist(op.cx, op.cy, w.x1, w.y1, w.x2, w.y2);
      if (dist > w.thicknessMm * 0.5 + 220) continue;
      const along = (op.cx - w.x1) * w.ux + (op.cy - w.y1) * w.uy;
      if (along < op.widthMm * 0.35 || along > w.len - op.widthMm * 0.35) continue;
      if (!best || dist < best.dist) {
        best = {
          wallIdx: i,
          wallId: w.opId,
          dist,
          projX: round2(w.x1 + along * w.ux),
          projY: round2(w.y1 + along * w.uy),
          along: round2(along),
          cornerClearanceOk: along >= op.widthMm * 0.5 + 100 && along <= w.len - op.widthMm * 0.5 - 100
        };
      }
    }
    if (best) {
      bound.push({ ...op, hostWallId: best.wallId, hostWallIdx: best.wallIdx, xMm: best.projX, yMm: best.projY, cornerClearanceOk: best.cornerClearanceOk });
    } else {
      unbound.push({ ...op, reason: 'no_same_orientation_host_wall_within_tolerance' });
    }
  }
  return { bound, unbound };
}

function analyzeConnectivity(orderedWalls, columns) {
  const sealedVertices = [];
  const openEnds = [];
  const suspiciousGaps = [];

  for (let i = 0; i < orderedWalls.length; i++) {
    const w = orderedWalls[i];
    for (const [endKey, px, py, snap] of [
      ['start', w.x1, w.y1, w.startSnap],
      ['end', w.x2, w.y2, w.endSnap]
    ]) {
      let minDist = Infinity;
      let minClear = Infinity;
      let nearestWallId = null;
      for (let j = 0; j < orderedWalls.length; j++) {
        if (i === j) continue;
        const ow = orderedWalls[j];
        const d = pointToSegDist(px, py, ow.x1, ow.y1, ow.x2, ow.y2);
        const clear = Math.max(0, d - ow.thicknessMm * 0.5);
        if (d < minDist) {
          minDist = d;
          minClear = clear;
          nearestWallId = ow.opId;
        }
      }
      const inCol = columns.some(c => Math.abs(px - c.cx) <= c.halfX + 120 && Math.abs(py - c.cy) <= c.halfY + 120);
      if (minDist <= 5 || inCol) {
        if (!sealedVertices.some(v => hypot(v.xMm - px, v.yMm - py) <= 5)) {
          sealedVertices.push({ xMm: round2(px), yMm: round2(py), kind: inCol ? 'column_anchor' : (snap?.kind || 'wall_join') });
        }
      } else {
        const entry = { wallId: w.opId, endpoint: endKey, xMm: round2(px), yMm: round2(py), nearestWallId, clearGapMm: round2(minClear) };
        openEnds.push(entry);
        if (minClear >= 20 && minClear <= 450) suspiciousGaps.push(entry);
      }
    }
  }

  return {
    sealedVertexCount: sealedVertices.length,
    sealedVertices,
    openEndCount: openEnds.length,
    openEnds,
    suspiciousGapCount: suspiciousGaps.length,
    suspiciousGaps
  };
}

export function renderTopologySvg({ rawSegments = [], walls = [], columns = [], beams = [], foundations = [], floors = [], openings = [], connectivity, beamConnectivity }) {
  const xs = [];
  const ys = [];
  for (const s of rawSegments) { xs.push(s.x1, s.x2); ys.push(s.y1, s.y2); }
  for (const w of walls) { xs.push(w.x1, w.x2); ys.push(w.y1, w.y2); }
  for (const b of beams) { xs.push(b.x1, b.x2); ys.push(b.y1, b.y2); }
  for (const c of columns) { xs.push(c.cx - c.halfX, c.cx + c.halfX); ys.push(c.cy - c.halfY, c.cy + c.halfY); }
  for (const f of foundations) { xs.push(f.cx - f.halfX, f.cx + f.halfX); ys.push(f.cy - f.halfY, f.cy + f.halfY); }
  for (const fl of floors) { for (const p of fl.boundary) { xs.push(p.xMm); ys.push(p.yMm); } }
  if (xs.length === 0) return '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><text x="20" y="40">No geometry</text></svg>';

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1000, maxX - minX);
  const spanY = Math.max(1000, maxY - minY);
  const pad = Math.max(spanX, spanY) * 0.06;
  const W = 1200;
  const H = Math.max(500, Math.min(1200, Math.round(W * ((spanY + 2 * pad) / (spanX + 2 * pad)))));
  const scale = Math.min((W - 40) / (spanX + 2 * pad), (H - 80) / (spanY + 2 * pad));
  const sx = x => round2(20 + (x - (minX - pad)) * scale);
  const sy = y => round2(H - 50 - (y - (minY - pad)) * scale);

  const totalGaps = (connectivity?.suspiciousGapCount ?? 0) + (beamConnectivity?.suspiciousGapCount ?? 0);
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#0f172a;font-family:system-ui,sans-serif">`,
    `<text x="20" y="24" fill="#e2e8f0" font-size="14" font-weight="600">RevitAuto 2D Arch+Struct Topology | Walls: ${walls.length} | Beams: ${beams.length} | Cols: ${columns.length} | Fndns: ${foundations.length} | Slabs: ${floors.length} | Openings: ${openings.length} | Gaps: ${totalGaps}</text>`,
    `<g stroke="#334155" stroke-width="0.8" opacity="0.55">`
  ];
  for (const s of rawSegments.slice(0, 6000)) {
    lines.push(`<line x1="${sx(s.x1)}" y1="${sy(s.y1)}" x2="${sx(s.x2)}" y2="${sy(s.y2)}"/>`);
  }
  lines.push('</g><g>');
  for (const fl of floors) {
    const pts = fl.boundary.map(p => `${sx(p.xMm)},${sy(p.yMm)}`).join(' ');
    lines.push(`<polygon points="${pts}" fill="#64748b" fill-opacity="0.14" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4 3"/>`);
  }
  for (const f of foundations) {
    const x = sx(f.cx - f.halfX);
    const y = sy(f.cy + f.halfY);
    const rw = Math.max(6, round2(f.halfX * 2 * scale));
    const rh = Math.max(6, round2(f.halfY * 2 * scale));
    lines.push(`<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="none" stroke="#fb923c" stroke-width="1.3" stroke-dasharray="4 2"/>`);
  }
  for (const w of walls) {
    const sw = Math.max(2, round2(w.thicknessMm * scale));
    const color = w.structural ? '#38bdf8' : '#60a5fa';
    lines.push(`<line x1="${sx(w.x1)}" y1="${sy(w.y1)}" x2="${sx(w.x2)}" y2="${sy(w.y2)}" stroke="${color}" stroke-width="${sw}" stroke-opacity="0.35" stroke-linecap="butt"/>`);
    lines.push(`<line x1="${sx(w.x1)}" y1="${sy(w.y1)}" x2="${sx(w.x2)}" y2="${sy(w.y2)}" stroke="#e0f2fe" stroke-width="1.3"/>`);
  }
  for (const b of beams) {
    const sw = Math.max(2.5, round2((b.widthMm || 250) * scale));
    const color = b.isPrimary ? '#c084fc' : '#e879f9';
    lines.push(`<line x1="${sx(b.x1)}" y1="${sy(b.y1)}" x2="${sx(b.x2)}" y2="${sy(b.y2)}" stroke="${color}" stroke-width="${sw}" stroke-opacity="0.32" stroke-linecap="butt"/>`);
    lines.push(`<line x1="${sx(b.x1)}" y1="${sy(b.y1)}" x2="${sx(b.x2)}" y2="${sy(b.y2)}" stroke="${color}" stroke-width="1.6" stroke-dasharray="${b.isPrimary ? '' : '6 3'}"/>`);
  }
  lines.push('</g><g>');
  for (const c of columns) {
    const x = sx(c.cx - c.halfX);
    const y = sy(c.cy + c.halfY);
    const rw = Math.max(4, round2(c.halfX * 2 * scale));
    const rh = Math.max(4, round2(c.halfY * 2 * scale));
    lines.push(`<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="#f59e0b" fill-opacity="0.7" stroke="#fef3c7" stroke-width="1"/>`);
  }
  for (const o of openings) {
    const color = o.kind === 'door' ? '#22d3ee' : '#a78bfa';
    lines.push(`<circle cx="${sx(o.xMm ?? o.cx)}" cy="${sy(o.yMm ?? o.cy)}" r="4.5" fill="${color}" stroke="#0f172a" stroke-width="1"/>`);
  }
  for (const v of (connectivity?.sealedVertices || [])) {
    lines.push(`<circle cx="${sx(v.xMm)}" cy="${sy(v.yMm)}" r="3.2" fill="#22c55e"/>`);
  }
  for (const v of (beamConnectivity?.sealedVertices || [])) {
    lines.push(`<circle cx="${sx(v.xMm)}" cy="${sy(v.yMm)}" r="3.2" fill="#4ade80"/>`);
  }
  for (const g of [...(connectivity?.suspiciousGaps || []), ...(beamConnectivity?.suspiciousGaps || [])]) {
    lines.push(`<circle cx="${sx(g.xMm)}" cy="${sy(g.yMm)}" r="7" fill="none" stroke="#ef4444" stroke-width="2.2"/>`);
    lines.push(`<text x="${sx(g.xMm) + 9}" y="${sy(g.yMm) + 4}" fill="#fca5a5" font-size="11">${g.wallId || g.beamId}:${g.clearGapMm}mm</text>`);
  }
  lines.push('</g>');
  lines.push(`<text x="20" y="${H - 14}" fill="#94a3b8" font-size="12">Legend: Blue=Walls | Purple=Beams (dashed=Secondary) | Amber=Columns | Orange=Foundations | Slate=Slabs | Green=Sealed | Red=Gap</text>`);
  lines.push('</svg>');
  return lines.join('\n');
}

export function buildComponentTable(orderedWalls, columns, boundOpenings, orderedBeams = [], foundations = [], floors = []) {
  const rows = [];
  for (const w of orderedWalls) {
    rows.push({
      id: w.opId,
      category: 'OST_Walls',
      type: w.wallTypeName,
      wallTypeId: w.wallTypeId,
      thicknessMm: w.thicknessMm,
      lengthMm: w.len,
      structural: w.structural,
      disallowJoinStart: w.disallowJoinStart,
      disallowJoinEnd: w.disallowJoinEnd,
      start: `${w.x1},${w.y1}`,
      end: `${w.x2},${w.y2}`
    });
  }
  for (const c of columns) {
    rows.push({
      id: c.opId,
      category: 'OST_StructuralColumns',
      type: `${c.widthMm}x${c.depthMm}`,
      widthMm: c.widthMm,
      depthMm: c.depthMm,
      center: `${c.cx},${c.cy}`,
      rotationDegrees: c.rotationDegrees
    });
  }
  for (const b of orderedBeams) {
    rows.push({
      id: b.opId,
      category: 'OST_StructuralFraming',
      type: b.beamTypeName || `Beam_${b.widthMm}mm`,
      symbolId: b.symbolId,
      widthMm: b.widthMm,
      lengthMm: b.len,
      isPrimary: b.isPrimary,
      elevationMm: b.elevationMm,
      start: `${b.x1},${b.y1}`,
      end: `${b.x2},${b.y2}`
    });
  }
  for (const f of foundations) {
    rows.push({
      id: f.opId,
      category: 'OST_StructuralFoundation',
      type: `${f.widthMm}x${f.depthMm}`,
      widthMm: f.widthMm,
      depthMm: f.depthMm,
      center: `${f.cx},${f.cy}`,
      elevationMm: f.elevationMm
    });
  }
  for (const fl of floors) {
    rows.push({
      id: fl.opId,
      category: 'OST_Floors',
      type: fl.layer || 'Slab',
      areaM2: fl.areaM2,
      vertexCount: fl.boundary.length
    });
  }
  for (const o of boundOpenings) {
    rows.push({
      id: o.opId,
      category: o.kind === 'door' ? 'OST_Doors' : 'OST_Windows',
      type: o.blockName || `${o.kind}_${o.widthMm}`,
      widthMm: o.widthMm,
      hostWallId: o.hostWallId,
      position: `${o.xMm},${o.yMm}`,
      cornerClearanceOk: o.cornerClearanceOk
    });
  }
  const csvHeader = 'id,category,type,sizeOrThicknessMm,lengthMm,hostOrLocation,notes';
  const csvRows = [csvHeader];
  for (const r of rows) {
    if (r.category === 'OST_Walls') {
      csvRows.push(`"${r.id}","OST_Walls","${r.type}",${r.thicknessMm},${r.lengthMm},"(${r.start})->(${r.end})","disStart=${r.disallowJoinStart};disEnd=${r.disallowJoinEnd}"`);
    } else if (r.category === 'OST_StructuralColumns') {
      csvRows.push(`"${r.id}","OST_StructuralColumns","${r.type}","${r.widthMm}x${r.depthMm}",,"(${r.center})","rot=${r.rotationDegrees}"`);
    } else if (r.category === 'OST_StructuralFraming') {
      csvRows.push(`"${r.id}","OST_StructuralFraming","${r.type}",${r.widthMm},${r.lengthMm},"(${r.start})->(${r.end})@z=${r.elevationMm}","primary=${r.isPrimary}"`);
    } else if (r.category === 'OST_StructuralFoundation') {
      csvRows.push(`"${r.id}","OST_StructuralFoundation","${r.type}","${r.widthMm}x${r.depthMm}",,"(${r.center})@z=${r.elevationMm}",""`);
    } else if (r.category === 'OST_Floors') {
      csvRows.push(`"${r.id}","OST_Floors","${r.type}",${r.areaM2}m2,,"vertices=${r.vertexCount}",""`);
    } else {
      csvRows.push(`"${r.id}","${r.category}","${r.type}",${r.widthMm},,"host=${r.hostWallId}@(${r.position})","clearanceOk=${r.cornerClearanceOk}"`);
    }
  }
  return { rows, csv: csvRows.join('\n') };
}

function extractClosedFloorPolygons(primitives, floorLayers, xform, crop, elevationMm) {
  if (!floorLayers || floorLayers.length === 0) return [];
  const floors = [];
  for (const prim of primitives) {
    const t = prim.t || prim.type;
    const layer = prim.l || prim.layer || '0';
    if (!matchLayer(layer, floorLayers)) continue;
    if ((t !== 'LWPOLYLINE' && t !== 'POLYLINE') || !Array.isArray(prim.pts) || prim.pts.length < 3) continue;
    const pts = prim.pts.map(xform);
    const closed = prim.c === true || prim.closed === true || hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) <= 5;
    if (!closed) continue;
    if (pts.length >= 4 && hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) <= 5) pts.pop();
    if (pts.length < 3) continue;
    if (crop && !pts.some(p => pointInBox(p.x, p.y, crop))) continue;
    let area2 = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area2 += a.x * b.y - b.x * a.y;
    }
    const areaM2 = round2(Math.abs(area2) * 0.5 / 1e6);
    if (areaM2 < 0.5) continue;
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    floors.push({
      opId: `slab_${floors.length + 1}`,
      layer,
      areaM2,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      boundary: pts.map(p => ({ xMm: round2(p.x), yMm: round2(p.y), zMm: round2(elevationMm) }))
    });
  }
  return floors;
}

function solveStructuralBeams(primitives, beamLayers, columns, options) {
  if (!beamLayers || beamLayers.length === 0) {
    return {
      beams: [],
      beamColumnJoins: [],
      beamBeamJoins: [],
      beamConnectivity: { sealedVertexCount: 0, sealedVertices: [], openEndCount: 0, openEnds: [], suspiciousGapCount: 0, suspiciousGaps: [] }
    };
  }
  const {
    xform,
    crop,
    fixOffAxisDegrees,
    beamWidthRules = [],
    beamExtractionMode = 'auto',
    beamSymbolId,
    defaultBeamWidthMm = 250,
    beamElevationMm = 3000,
    beamSnapMaxMm = 450,
    minPairOverlapMm = 80,
    minBeamLengthMm = 300
  } = options;

  const rawBeamSegs = [];
  const pushBeamSeg = (p1, p2, layer, handle) => {
    const a = xform(p1);
    const b = xform(p2);
    if (!segmentInCrop(a.x, a.y, b.x, b.y, crop)) return;
    const fixed = fixOffAxisSegment({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, layer, handle }, fixOffAxisDegrees);
    const canon = canonicalizeSegment(fixed);
    if (canon && canon.len >= 50) rawBeamSegs.push(canon);
  };

  for (const prim of primitives) {
    const t = prim.t || prim.type;
    const layer = prim.l || prim.layer || '0';
    if (!matchLayer(layer, beamLayers)) continue;
    if (t === 'LINE' && Array.isArray(prim.p1) && Array.isArray(prim.p2)) {
      pushBeamSeg(prim.p1, prim.p2, layer, prim.h || null);
    } else if ((t === 'LWPOLYLINE' || t === 'POLYLINE') && Array.isArray(prim.pts) && prim.pts.length >= 2) {
      const pts = prim.pts;
      const closed = prim.c === true || prim.closed === true;
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) pushBeamSeg(pts[i], pts[(i + 1) % pts.length], layer, prim.h || null);
    }
  }

  let baseBeams = [];
  const useDoubleLine = beamExtractionMode === 'double_line' || (beamExtractionMode === 'auto' && Array.isArray(beamWidthRules) && beamWidthRules.length > 0);
  if (useDoubleLine && beamWidthRules.length > 0) {
    const asWallRules = beamWidthRules.map(r => ({
      cadWidthMm: Number(r.cadWidthMm),
      toleranceMm: Number(r.toleranceMm ?? 10),
      wallTypeId: r.symbolId ?? beamSymbolId ?? null,
      name: r.name || `Beam_${r.cadWidthMm}mm`,
      structural: true,
      priority: Number.isFinite(r.priority) ? Number(r.priority) : 1000 + Number(r.cadWidthMm),
      layers: r.layers || null
    }));
    baseBeams = pairDoubleLines(rawBeamSegs, asWallRules, minPairOverlapMm).map(b => ({
      ...b,
      symbolId: b.wallTypeId ?? beamSymbolId ?? null,
      beamTypeName: b.wallTypeName,
      widthMm: b.thicknessMm
    }));
  }

  // Fallback or centerline mode: treat straight lines directly as beam centerlines.
  if (beamExtractionMode === 'centerline' || (beamExtractionMode === 'auto' && baseBeams.length === 0)) {
    const seen = new Set();
    for (const s of rawBeamSegs) {
      const key = `${Math.round(s.x1)}:${Math.round(s.y1)}:${Math.round(s.x2)}:${Math.round(s.y2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      baseBeams.push({
        x1: s.x1,
        y1: s.y1,
        x2: s.x2,
        y2: s.y2,
        ux: s.ux,
        uy: s.uy,
        angle: s.angle,
        len: s.len,
        widthMm: defaultBeamWidthMm,
        thicknessMm: defaultBeamWidthMm,
        wallTypeId: beamSymbolId ?? null,
        symbolId: beamSymbolId ?? null,
        beamTypeName: `Beam_${defaultBeamWidthMm}mm`,
        wallTypeName: `Beam_${defaultBeamWidthMm}mm`,
        structural: true,
        priority: 1000 + defaultBeamWidthMm,
        layer: s.layer
      });
    }
  }

  // Collinear merge across column faces or drafting breaks.
  const merged = mergeCollinearWalls(baseBeams, {
    bridgeGapRangeMm: [0, Math.max(beamSnapMaxMm * 2, 1200)],
    noBridgeZones: [],
    bridgeMode: 'bimify_range',
    columns,
    openings: []
  });

  // Single-pass immutable endpoint snap: snap to exact column center first, then supporting beam centerline!
  const snapshot = merged.map((b, idx) => ({
    ...b,
    symbolId: b.symbolId ?? b.wallTypeId ?? beamSymbolId ?? null,
    widthMm: b.widthMm ?? b.thicknessMm ?? defaultBeamWidthMm,
    beamTypeName: b.beamTypeName ?? b.wallTypeName ?? `Beam_${b.thicknessMm ?? defaultBeamWidthMm}mm`,
    originalIdx: idx
  }));
  const beamColumnJoins = [];
  const beamBeamJoins = [];
  const solved = [];

  for (let i = 0; i < snapshot.length; i++) {
    const b = snapshot[i];
    let x1 = b.x1; let y1 = b.y1;
    let x2 = b.x2; let y2 = b.y2;
    let startSnap = null;
    let endSnap = null;

    const snapEndpoint = (ex, ey, outUx, outUy) => {
      // 1. Exact column center anchor (highest priority for structural framing).
      let bestCol = null;
      for (let cIdx = 0; cIdx < columns.length; cIdx++) {
        const c = columns[cIdx];
        const rx = c.cx - ex;
        const ry = c.cy - ey;
        const along = rx * outUx + ry * outUy;
        const perp = Math.abs(-rx * outUy + ry * outUx);
        const colHalfAlong = Math.abs(outUx) * c.halfX + Math.abs(outUy) * c.halfY;
        const colHalfPerp = Math.abs(outUy) * c.halfX + Math.abs(outUx) * c.halfY;
        if (perp <= colHalfPerp + b.widthMm * 0.5 + 80 && along >= -colHalfAlong - 80 && along <= colHalfAlong + beamSnapMaxMm) {
          const dist = hypot(rx, ry);
          if (!bestCol || dist < bestCol.dist) bestCol = { kind: 'COLUMN_CENTER', columnIdx: cIdx, x: c.cx, y: c.cy, dist };
        }
      }
      if (bestCol) return bestCol;

      // 2. Supporting non-parallel beam centerline intersection (T/L/X girder-to-secondary-beam).
      let bestBeam = null;
      for (let j = 0; j < snapshot.length; j++) {
        if (i === j) continue;
        const ob = snapshot[j];
        if (angleDiffRad(b.angle, ob.angle) < 10 * DEG) continue;
        const hit = intersectLines2D(b, ob);
        if (!hit) continue;
        const dist = hypot(hit.x - ex, hit.y - ey);
        const outProj = (hit.x - ex) * outUx + (hit.y - ey) * outUy;
        const onOther = hit.u * ob.len >= -beamSnapMaxMm && hit.u * ob.len <= ob.len + beamSnapMaxMm;
        if (onOther && dist <= beamSnapMaxMm && outProj >= -b.widthMm) {
          if (!bestBeam || dist < bestBeam.dist) {
            bestBeam = { kind: 'BEAM_INTERSECT', targetBeamIdx: j, x: hit.x, y: hit.y, dist };
          }
        }
      }
      return bestBeam;
    };

    const sHit = snapEndpoint(x1, y1, -b.ux, -b.uy);
    if (sHit) { x1 = sHit.x; y1 = sHit.y; startSnap = sHit; }
    const eHit = snapEndpoint(x2, y2, b.ux, b.uy);
    if (eHit) { x2 = eHit.x; y2 = eHit.y; endSnap = eHit; }

    const len = hypot(x2 - x1, y2 - y1);
    if (len < minBeamLengthMm) continue;
    const isPrimary = (startSnap?.kind === 'COLUMN_CENTER' && endSnap?.kind === 'COLUMN_CENTER') || (b.priority ?? 0) >= 2000;
    solved.push({
      ...b,
      x1: round2(x1),
      y1: round2(y1),
      x2: round2(x2),
      y2: round2(y2),
      len: round2(len),
      elevationMm: round2(beamElevationMm),
      isPrimary,
      topologyPriority: (isPrimary ? 2000 : 1000) + (b.widthMm || defaultBeamWidthMm),
      startSnap,
      endSnap
    });
  }

  // Topologically order beams: primary girders first -> wider -> longer -> XY.
  const orderedBeams = [...solved].sort((a, b) => {
    const pr = b.topologyPriority - a.topologyPriority;
    if (pr !== 0) return pr;
    const lr = b.len - a.len;
    if (Math.abs(lr) > 0.01) return lr;
    return Math.min(a.x1, a.x2) - Math.min(b.x1, b.x2) || Math.min(a.y1, a.y2) - Math.min(b.y1, b.y2);
  }).map((b, idx) => ({ ...b, opId: `beam_${idx + 1}` }));

  const origToOrdered = new Map(orderedBeams.map((b, idx) => [b.originalIdx, idx]));
  const seenBeamBeam = new Set();
  const seenBeamCol = new Set();

  for (let i = 0; i < orderedBeams.length; i++) {
    const b = orderedBeams[i];
    for (const snap of [b.startSnap, b.endSnap]) {
      if (!snap) continue;
      if (snap.kind === 'COLUMN_CENTER') {
        const key = `${i}:${snap.columnIdx}`;
        if (!seenBeamCol.has(key)) {
          seenBeamCol.add(key);
          beamColumnJoins.push({ beamIdx: i, columnIdx: snap.columnIdx });
        }
      } else if (snap.kind === 'BEAM_INTERSECT' && origToOrdered.has(snap.targetBeamIdx)) {
        const j = origToOrdered.get(snap.targetBeamIdx);
        const key = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (i !== j && !seenBeamBeam.has(key)) {
          seenBeamBeam.add(key);
          beamBeamJoins.push({ firstBeamIdx: Math.min(i, j), secondBeamIdx: Math.max(i, j) });
        }
      }
    }
    // Also attach columns sitting along the interior of a continuous girder.
    for (let cIdx = 0; cIdx < columns.length; cIdx++) {
      const c = columns[cIdx];
      if (pointToSegDist(c.cx, c.cy, b.x1, b.y1, b.x2, b.y2) <= Math.max(c.halfX, c.halfY) + (b.widthMm || 250) * 0.5) {
        const key = `${i}:${cIdx}`;
        if (!seenBeamCol.has(key)) {
          seenBeamCol.add(key);
          beamColumnJoins.push({ beamIdx: i, columnIdx: cIdx });
        }
      }
    }
  }

  // Analyze beam endpoint connectivity.
  const sealedVertices = [];
  const openEnds = [];
  const suspiciousGaps = [];
  for (let i = 0; i < orderedBeams.length; i++) {
    const b = orderedBeams[i];
    for (const [endKey, px, py] of [['start', b.x1, b.y1], ['end', b.x2, b.y2]]) {
      const inCol = columns.some(c => Math.abs(px - c.cx) <= c.halfX + 20 && Math.abs(py - c.cy) <= c.halfY + 20);
      let minBeamDist = Infinity;
      let nearestId = null;
      for (let j = 0; j < orderedBeams.length; j++) {
        if (i === j) continue;
        const d = pointToSegDist(px, py, orderedBeams[j].x1, orderedBeams[j].y1, orderedBeams[j].x2, orderedBeams[j].y2);
        if (d < minBeamDist) { minBeamDist = d; nearestId = orderedBeams[j].opId; }
      }
      if (inCol || minBeamDist <= 10) {
        if (!sealedVertices.some(v => hypot(v.xMm - px, v.yMm - py) <= 5)) {
          sealedVertices.push({ xMm: round2(px), yMm: round2(py), kind: inCol ? 'column_anchor' : 'beam_join' });
        }
      } else {
        const entry = { beamId: b.opId, endpoint: endKey, xMm: round2(px), yMm: round2(py), nearestTargetId: nearestId, clearGapMm: round2(minBeamDist) };
        openEnds.push(entry);
        if (minBeamDist >= 20 && minBeamDist <= 500) suspiciousGaps.push(entry);
      }
    }
  }

  return {
    beams: orderedBeams,
    beamColumnJoins,
    beamBeamJoins,
    beamConnectivity: {
      sealedVertexCount: sealedVertices.length,
      sealedVertices,
      openEndCount: openEnds.length,
      openEnds,
      suspiciousGapCount: suspiciousGaps.length,
      suspiciousGaps
    }
  };
}

export async function solveCadTopology(input) {
  const primitives = await loadGeometryPrimitives(input);
  const xform = makeTransform(input.calibration);
  const crop = input.cropBounds || null;
  const fixOffAxisDegrees = input.fixOffAxisDegrees ?? 0.5;
  const bridgeGapRangeMm = input.bridgeGapRangeMm ?? [0, 1500];
  const bridgeMode = input.bridgeMode ?? 'bimify_range';
  const cornerExtendMaxMm = input.cornerExtendMaxMm ?? 450;
  const columnSnapMaxMm = input.columnSnapMaxMm ?? 400;
  const beamSnapMaxMm = input.beamSnapMaxMm ?? 450;
  const minPairOverlapMm = input.minPairOverlapMm ?? 80;
  const minWallLengthMm = input.minWallLengthMm ?? 150;
  const minBeamLengthMm = input.minBeamLengthMm ?? 300;
  const wallLayers = input.wallLayers || [];
  const columnLayers = input.columnLayers || [];
  const beamLayers = input.beamLayers || [];
  const foundationLayers = input.foundationLayers || [];
  const floorLayers = input.floorLayers || [];
  const doorLayers = input.doorLayers || [];
  const windowLayers = input.windowLayers || [];
  const wallThicknessRules = input.wallThicknessRules || [];
  const beamWidthRules = input.beamWidthRules || [];
  const noBridgeZones = input.noBridgeZones || [];

  const hasStructuralInput = beamLayers.length > 0 || columnLayers.length > 0 || foundationLayers.length > 0 || floorLayers.length > 0;
  if ((!Array.isArray(wallThicknessRules) || wallThicknessRules.length === 0) && !hasStructuralInput) {
    throw new Error('Provide wallThicknessRules (for architecture walls) and/or structural layers (columnLayers, beamLayers, foundationLayers, floorLayers).');
  }

  const rawWallSegments = [];
  const curvedSegments = [];
  let offAxisFixedCount = 0;

  const pushSeg = (p1, p2, layer, handle) => {
    const a = xform(p1);
    const b = xform(p2);
    if (!segmentInCrop(a.x, a.y, b.x, b.y, crop)) return;
    const fixed = fixOffAxisSegment({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, layer, handle }, fixOffAxisDegrees);
    if (fixed.offAxisFixed) offAxisFixedCount++;
    const canon = canonicalizeSegment(fixed);
    if (canon && canon.len >= 20) rawWallSegments.push(canon);
  };

  if (Array.isArray(wallThicknessRules) && wallThicknessRules.length > 0) {
    for (const prim of primitives) {
      const t = prim.t || prim.type;
      const layer = prim.l || prim.layer || '0';
      const handle = prim.h || null;
      const isWallLayer = wallLayers.length === 0 || matchLayer(layer, wallLayers);
      if (!isWallLayer) continue;

      if (t === 'LINE' && Array.isArray(prim.p1) && Array.isArray(prim.p2)) {
        pushSeg(prim.p1, prim.p2, layer, handle);
      } else if ((t === 'LWPOLYLINE' || t === 'POLYLINE') && Array.isArray(prim.pts) && prim.pts.length >= 2) {
        const pts = prim.pts;
        const bulges = Array.isArray(prim.b) ? prim.b : null;
        const closed = prim.c === true || prim.closed === true;
        const segCount = closed ? pts.length : pts.length - 1;
        for (let i = 0; i < segCount; i++) {
          const p1 = pts[i];
          const p2 = pts[(i + 1) % pts.length];
          const bulge = bulges ? Number(bulges[i] ?? 0) : 0;
          if (Math.abs(bulge) > 1e-4) {
            curvedSegments.push({ layer, handle, p1: xform(p1), p2: xform(p2), bulge });
          } else {
            pushSeg(p1, p2, layer, handle);
          }
        }
      } else if (t === 'ARC' && Array.isArray(prim.p)) {
        curvedSegments.push({ layer, handle, center: xform(prim.p), radiusMm: prim.r, a1: prim.a1, a2: prim.a2 });
      }
    }
  }

  // Deduplicate exact/near-identical wall face segments.
  const dedupedWallSegs = [];
  const seenSegKey = new Set();
  for (const s of rawWallSegments) {
    const key = `${s.layer}:${Math.round(s.x1)}:${Math.round(s.y1)}:${Math.round(s.x2)}:${Math.round(s.y2)}`;
    if (!seenSegKey.has(key)) {
      seenSegKey.add(key);
      dedupedWallSegs.push(s);
    }
  }

  const levelElevationMm = input.levelElevationMm ?? 0;
  const beamElevationMm = input.beamElevationMm ?? (levelElevationMm + (input.heightMm ?? 3000));
  const foundationElevationMm = input.foundationElevationMm ?? levelElevationMm;

  const columns = extractClosedRects(primitives, columnLayers, xform, crop)
    .map((c, idx) => ({ ...c, opId: `col_${idx + 1}` }));

  let foundations = extractClosedRects(primitives, foundationLayers, xform, crop, { minMm: 300, maxMm: 12000 })
    .map((f, idx) => ({ ...f, elevationMm: round2(foundationElevationMm), opId: `fndn_${idx + 1}` }));
  if (foundations.length === 0 && input.alignFoundationsToColumns === true && columns.length > 0) {
    foundations = columns.map((c, idx) => ({
      cx: c.cx,
      cy: c.cy,
      widthMm: c.widthMm,
      depthMm: c.depthMm,
      halfX: c.halfX,
      halfY: c.halfY,
      rotationDegrees: c.rotationDegrees,
      elevationMm: round2(foundationElevationMm),
      alignedColumnOpId: c.opId,
      opId: `fndn_${idx + 1}`
    }));
  }

  const floors = extractClosedFloorPolygons(primitives, floorLayers, xform, crop, levelElevationMm);

  const rawDoors = extractOpenings(primitives, doorLayers, 'door', xform, crop, fixOffAxisDegrees);
  const rawWindows = extractOpenings(primitives, windowLayers, 'window', xform, crop, fixOffAxisDegrees);
  const allOpenings = [...rawDoors, ...rawWindows];

  const pairedWalls = wallThicknessRules.length > 0 ? pairDoubleLines(dedupedWallSegs, wallThicknessRules, minPairOverlapMm) : [];
  const mergedWalls = pairedWalls.length > 0 ? mergeCollinearWalls(pairedWalls, {
    bridgeGapRangeMm,
    noBridgeZones,
    bridgeMode,
    columns,
    openings: allOpenings
  }) : [];
  const cornerResult = mergedWalls.length > 0 ? solveCornerGraph(mergedWalls, columns, {
    cornerExtendMaxMm,
    columnSnapMaxMm,
    minWallLengthMm
  }) : { walls: [], columnJoins: [], wallJoins: [] };

  const oldToNew = new Map();
  const orderedWalls = orderWallsTopologically(cornerResult.walls).map((w, idx) => {
    const oldIdx = cornerResult.walls.indexOf(w);
    oldToNew.set(oldIdx, idx);
    return { ...w, opId: `wall_${idx + 1}` };
  });

  const beamResult = solveStructuralBeams(primitives, beamLayers, columns, {
    xform,
    crop,
    fixOffAxisDegrees,
    beamWidthRules,
    beamExtractionMode: input.beamExtractionMode ?? 'auto',
    beamSymbolId: input.beamSymbolId,
    defaultBeamWidthMm: input.defaultBeamWidthMm ?? 250,
    beamElevationMm,
    beamSnapMaxMm,
    minPairOverlapMm,
    minBeamLengthMm
  });
  const orderedBeams = beamResult.beams;

  const { bound: boundOpenings, unbound: unboundOpenings } = bindOpeningsToWalls(allOpenings, orderedWalls);
  boundOpenings.forEach((o, idx) => { o.opId = `${o.kind}_${idx + 1}`; });

  const connectivity = analyzeConnectivity(orderedWalls, columns);
  const table = buildComponentTable(orderedWalls, columns, boundOpenings, orderedBeams, foundations, floors);

  // Build ready-to-preview multi-discipline Revit operations in strict topological order:
  // foundations -> columns -> walls -> beams (primary first) -> slabs -> join_geometry -> openings.
  const levelId = input.levelId;
  const topLevelId = input.topLevelId;
  const heightMm = input.heightMm ?? 3000;
  const baseOffsetMm = input.baseOffsetMm ?? 0;
  const topOffsetMm = input.topOffsetMm ?? 0;
  const emitJoinGeometry = input.emitJoinGeometry !== false;
  const operations = [];

  if (Number.isSafeInteger(levelId) && levelId > 0) {
    const hasFoundations = Number.isSafeInteger(input.foundationSymbolId) && input.foundationSymbolId > 0;
    if (hasFoundations) {
      for (const f of foundations) {
        operations.push({
          operationType: 'create_isolated_foundation',
          id: f.opId,
          symbolId: input.foundationSymbolId,
          levelId,
          point: { xMm: f.cx, yMm: f.cy, zMm: f.elevationMm },
          ...(f.rotationDegrees ? { rotationDegrees: f.rotationDegrees } : {})
        });
      }
    }

    const hasColumns = Number.isSafeInteger(input.columnSymbolId) && input.columnSymbolId > 0 && Number.isSafeInteger(topLevelId) && topLevelId > 0;
    if (hasColumns) {
      for (const c of columns) {
        operations.push({
          operationType: 'create_structural_column',
          id: c.opId,
          symbolId: input.columnSymbolId,
          baseLevelId: levelId,
          topLevelId,
          baseOffsetMm,
          topOffsetMm,
          point: { xMm: c.cx, yMm: c.cy },
          ...(c.rotationDegrees ? { rotationDegrees: c.rotationDegrees } : {})
        });
      }
    }

    for (const w of orderedWalls) {
      const wallOp = {
        operationType: 'create_wall',
        id: w.opId,
        wallTypeId: w.wallTypeId,
        levelId,
        ...(Number.isSafeInteger(topLevelId) && topLevelId > 0
          ? { topLevelId, topOffsetMm }
          : { heightMm }),
        ...(baseOffsetMm !== 0 ? { offsetMm: baseOffsetMm } : {}),
        ...(w.structural ? { structural: true } : {}),
        ...(w.disallowJoinStart ? { disallowJoinStart: true } : {}),
        ...(w.disallowJoinEnd ? { disallowJoinEnd: true } : {}),
        ...(!w.disallowJoinStart && w.joinTypeStart ? { joinTypeStart: w.joinTypeStart } : {}),
        ...(!w.disallowJoinEnd && w.joinTypeEnd ? { joinTypeEnd: w.joinTypeEnd } : {}),
        topologyPriority: w.priority ?? w.thicknessMm,
        start: { xMm: w.x1, yMm: w.y1 },
        end: { xMm: w.x2, yMm: w.y2 }
      };
      operations.push(wallOp);
    }

    const emittedBeamIds = new Set();
    for (const b of orderedBeams) {
      const sym = b.symbolId ?? input.beamSymbolId;
      if (Number.isSafeInteger(sym) && sym > 0) {
        emittedBeamIds.add(b.opId);
        operations.push({
          operationType: 'create_structural_beam',
          id: b.opId,
          symbolId: sym,
          levelId: input.beamLevelId ?? levelId,
          start: { xMm: b.x1, yMm: b.y1, zMm: b.elevationMm },
          end: { xMm: b.x2, yMm: b.y2, zMm: b.elevationMm },
          topologyPriority: b.topologyPriority
        });
      }
    }

    const hasFloors = Number.isSafeInteger(input.floorTypeId) && input.floorTypeId > 0;
    if (hasFloors) {
      for (const fl of floors) {
        operations.push({
          operationType: 'create_floor',
          id: fl.opId,
          floorTypeId: input.floorTypeId,
          levelId,
          boundary: fl.boundary
        });
      }
    }

    if (emitJoinGeometry) {
      const emittedJoins = new Set();
      const pushJoin = (aId, bId) => {
        if (!aId || !bId || aId === bId) return;
        const key = aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`;
        if (emittedJoins.has(key)) return;
        emittedJoins.add(key);
        operations.push({
          operationType: 'join_geometry',
          firstElementId: `@${aId}`,
          secondElementId: `@${bId}`,
          action: 'join',
          ignoreAlreadyJoined: true,
          skipIfUnjoinable: true
        });
      };

      if (hasColumns) {
        for (const pair of cornerResult.columnJoins) {
          const newWallIdx = oldToNew.get(pair.wallIdx);
          if (newWallIdx !== undefined) pushJoin(columns[pair.columnIdx].opId, orderedWalls[newWallIdx].opId);
        }
        for (const pair of beamResult.beamColumnJoins) {
          const bId = orderedBeams[pair.beamIdx]?.opId;
          if (emittedBeamIds.has(bId)) pushJoin(columns[pair.columnIdx].opId, bId);
        }
        if (hasFoundations) {
          for (const f of foundations) {
            const matchCol = columns.find(c => hypot(c.cx - f.cx, c.cy - f.cy) <= Math.max(f.halfX, f.halfY) + 100);
            if (matchCol) pushJoin(f.opId, matchCol.opId);
          }
        }
      }
      for (const pair of cornerResult.wallJoins) {
        const idxA = oldToNew.get(pair.firstWallIdx);
        const idxB = oldToNew.get(pair.secondWallIdx);
        if (idxA !== undefined && idxB !== undefined && idxA !== idxB) {
          pushJoin(orderedWalls[Math.min(idxA, idxB)].opId, orderedWalls[Math.max(idxA, idxB)].opId);
        }
      }
      for (const pair of beamResult.beamBeamJoins) {
        const aId = orderedBeams[pair.firstBeamIdx]?.opId;
        const bId = orderedBeams[pair.secondBeamIdx]?.opId;
        if (emittedBeamIds.has(aId) && emittedBeamIds.has(bId)) pushJoin(aId, bId);
      }
      if (hasFloors && emittedBeamIds.size > 0) {
        for (const fl of floors) {
          for (const b of orderedBeams) {
            if (!emittedBeamIds.has(b.opId)) continue;
            const mx = (b.x1 + b.x2) * 0.5;
            const my = (b.y1 + b.y2) * 0.5;
            if (mx >= fl.minX - 250 && mx <= fl.maxX + 250 && my >= fl.minY - 250 && my <= fl.maxY + 250) {
              pushJoin(b.opId, fl.opId);
            }
          }
        }
      }
    }

    for (const o of boundOpenings) {
      const symbolId = o.kind === 'door' ? input.doorSymbolId : input.windowSymbolId;
      if (Number.isSafeInteger(symbolId) && symbolId > 0) {
        operations.push({
          operationType: 'create_family_instance',
          id: o.opId,
          symbolId,
          hostElementId: `@${o.hostWallId}`,
          levelId,
          xMm: o.xMm,
          yMm: o.yMm,
          zMm: round2(levelElevationMm + (o.kind === 'window' ? (input.defaultWindowSillMm ?? 900) : 0))
        });
      }
    }
  }

  let writtenSvgPath = null;
  let writtenCsvPath = null;
  const svgContent = renderTopologySvg({
    rawSegments: dedupedWallSegs,
    walls: orderedWalls,
    columns,
    beams: orderedBeams,
    foundations,
    floors,
    openings: boundOpenings,
    connectivity,
    beamConnectivity: beamResult.beamConnectivity
  });
  if (typeof input.outputSvgPath === 'string' && input.outputSvgPath.trim()) {
    await fs.mkdir(path.dirname(input.outputSvgPath), { recursive: true });
    await fs.writeFile(input.outputSvgPath, svgContent, 'utf8');
    writtenSvgPath = input.outputSvgPath;
  }
  if (typeof input.outputCsvPath === 'string' && input.outputCsvPath.trim()) {
    await fs.mkdir(path.dirname(input.outputCsvPath), { recursive: true });
    await fs.writeFile(input.outputCsvPath, table.csv, 'utf8');
    writtenCsvPath = input.outputCsvPath;
  }

  const distinctColumnSizes = [...new Set(columns.map(c => `${c.widthMm}x${c.depthMm}`))].sort();
  const distinctBeamWidthsMm = [...new Set(orderedBeams.map(b => b.widthMm))].sort((a, b) => a - b);
  const distinctFoundationSizes = [...new Set(foundations.map(f => `${f.widthMm}x${f.depthMm}`))].sort();
  const distinctDoorWidthsMm = [...new Set(boundOpenings.filter(o => o.kind === 'door').map(o => o.widthMm))].sort((a, b) => a - b);
  const distinctWindowWidthsMm = [...new Set(boundOpenings.filter(o => o.kind === 'window').map(o => o.widthMm))].sort((a, b) => a - b);

  return {
    status: 'cad_topology_solved',
    candidateOnly: true,
    readOnly: true,
    summary: {
      rawWallSegmentCount: dedupedWallSegs.length,
      offAxisFixedCount,
      curvedWallSegmentCount: curvedSegments.length,
      pairedWallCount: pairedWalls.length,
      mergedWallCount: mergedWalls.length,
      solvedWallCount: orderedWalls.length,
      columnCount: columns.length,
      beamCount: orderedBeams.length,
      primaryBeamCount: orderedBeams.filter(b => b.isPrimary).length,
      foundationCount: foundations.length,
      floorCount: floors.length,
      boundOpeningCount: boundOpenings.length,
      unboundOpeningCount: unboundOpenings.length,
      sealedCornerVertexCount: connectivity.sealedVertexCount,
      openEndCount: connectivity.openEndCount,
      suspiciousCornerGapCount: connectivity.suspiciousGapCount,
      beamSealedVertexCount: beamResult.beamConnectivity.sealedVertexCount,
      beamSuspiciousGapCount: beamResult.beamConnectivity.suspiciousGapCount,
      emittedOperationCount: operations.length,
      distinctColumnSizes,
      distinctBeamWidthsMm,
      distinctFoundationSizes,
      distinctDoorWidthsMm,
      distinctWindowWidthsMm
    },
    artifacts: {
      svgPreviewPath: writtenSvgPath,
      componentTableCsvPath: writtenCsvPath
    },
    connectivity: {
      sealedVertexCount: connectivity.sealedVertexCount,
      openEndCount: connectivity.openEndCount,
      suspiciousGapCount: connectivity.suspiciousGapCount,
      suspiciousGaps: connectivity.suspiciousGaps.slice(0, 50)
    },
    beamConnectivity: {
      sealedVertexCount: beamResult.beamConnectivity.sealedVertexCount,
      openEndCount: beamResult.beamConnectivity.openEndCount,
      suspiciousGapCount: beamResult.beamConnectivity.suspiciousGapCount,
      suspiciousGaps: beamResult.beamConnectivity.suspiciousGaps.slice(0, 50)
    },
    curvedSegments: curvedSegments.slice(0, 50),
    unboundOpenings: unboundOpenings.slice(0, 50),
    componentTableRows: table.rows.slice(0, 200),
    operations
  };
}
