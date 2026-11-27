import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const ROOT = path.resolve(import.meta.dirname, '..');
const nonblank = z.string().min(1).max(200).refine(v => v.trim() === v && !/[\u0000-\u001f\u007f-\u009f]/u.test(v));
const safeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const deliveryExportRequestSchema = {
  documentIdentity: nonblank,
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  outputDirectory: z.string().trim().min(1).max(1024),
  scheduleIds: z.array(safeId).max(30).optional(),
  includeAudit: z.boolean().optional(),
  includeMepDisconnects: z.boolean().optional(),
  mepDisconnectDomain: z.enum(['all', 'hvac', 'piping', 'electrical', 'cableTrayConduit']).optional(),
  includeElectricalAudit: z.boolean().optional(),
  includeIfc: z.boolean().optional(),
  ifcFileName: z.string().trim().min(5).max(200).optional(),
  ifcVersion: z.enum(['IFC2x3CV2', 'IFC4', 'IFC4RV', 'IFC4DTV']).optional(),
  exportBaseQuantities: z.boolean().optional(),
  spaceBoundaryLevel: z.number().int().min(0).max(2).optional(),
  filterViewId: safeId.optional()
};

function within(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

async function resolveSafeOutputDir(rawDir) {
  if (/^(?:\\|\/\/|https?:|file:)/i.test(rawDir)) {
    throw Object.assign(new Error('outputDirectory must be a local filesystem directory.'), { code: 'invalid_delivery_export_request' });
  }
  const resolved = path.resolve(rawDir);
  const roots = (process.env.REVIT_AI_IMPORT_ROOTS || `${ROOT}${path.delimiter}${path.resolve(ROOT, '..')}`)
    .split(path.delimiter)
    .filter(Boolean)
    .map(r => path.resolve(r));
  if (!roots.some(r => within(r, resolved))) {
    throw Object.assign(new Error('outputDirectory must stay inside the workspace or configured REVIT_AI_IMPORT_ROOTS.'), { code: 'invalid_delivery_export_request' });
  }
  if (resolved.toLowerCase().includes(`${path.sep}runtime${path.sep}`)) {
    throw Object.assign(new Error('Cannot write delivery artifacts into runtime directory.'), { code: 'invalid_delivery_export_request' });
  }
  await fs.mkdir(resolved, { recursive: true });
  return resolved;
}

function csvEscape(cell) {
  const text = cell === null || cell === undefined ? '' : String(cell);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function sanitizeFileName(name, fallback) {
  const clean = String(name || fallback).replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').trim();
  return clean ? clean.slice(0, 80) : fallback;
}

export async function exportDeliveryPackage(args, callRevit, signal) {
  const outDir = await resolveSafeOutputDir(args.outputDirectory);
  const pins = { documentIdentity: args.documentIdentity, expectedRevision: args.expectedRevision };
  const includeAudit = args.includeAudit !== false;
  const includeMepDisconnects = args.includeMepDisconnects === true;
  const includeElectricalAudit = args.includeElectricalAudit === true;
  const includeIfc = args.includeIfc === true;

  const audit = includeAudit ? await callRevit('revit.audit.run', pins, signal) : null;
  let mepDisconnects = null;
  if (includeMepDisconnects) {
    mepDisconnects = await callRevit('revit.mep.disconnects', {
      ...pins,
      domain: args.mepDisconnectDomain || 'all',
      offset: 0,
      limit: 200
    }, signal);
  }
  let electricalAudit = null;
  if (includeElectricalAudit) {
    electricalAudit = await callRevit('revit.electrical.audit', pins, signal);
  }
  const exportedSchedules = [];
  const warnings = [];

  if (Array.isArray(args.scheduleIds) && args.scheduleIds.length > 0) {
    const schedDir = path.join(outDir, 'schedules');
    await fs.mkdir(schedDir, { recursive: true });
    for (const scheduleId of args.scheduleIds) {
      const allRows = [];
      let columns = [];
      let scheduleName = `schedule_${scheduleId}`;
      let offset = 0;
      const limit = 200;
      while (offset < 20000) {
        const page = await callRevit('revit.schedule.data', { ...pins, scheduleId, offset, limit }, signal);
        if (page.scheduleName) scheduleName = page.scheduleName;
        if (Array.isArray(page.columns) && columns.length === 0) columns = page.columns;
        const rows = Array.isArray(page.rows) ? page.rows : [];
        allRows.push(...rows);
        if (!page.hasMore || rows.length === 0) break;
        offset += rows.length;
      }
      const csvLines = [];
      if (columns.length > 0) csvLines.push(columns.map(c => csvEscape(typeof c === 'string' ? c : (c?.heading || c?.name || ''))).join(','));
      for (const r of allRows) {
        const cells = Array.isArray(r?.cells) ? r.cells : (Array.isArray(r) ? r : []);
        csvLines.push(cells.map(csvEscape).join(','));
      }
      const base = sanitizeFileName(scheduleName, `schedule_${scheduleId}`);
      const csvPath = path.join(schedDir, `${base}_${scheduleId}.csv`);
      await fs.writeFile(csvPath, '\uFEFF' + csvLines.join('\n'), 'utf8');
      exportedSchedules.push({
        scheduleId,
        scheduleName,
        rowCount: allRows.length,
        columnCount: columns.length,
        csvPath
      });
    }
  }

  let ifcResult = null;
  if (includeIfc) {
    const fileName = args.ifcFileName || 'delivery_model.ifc';
    ifcResult = await callRevit('revit.export.ifc', {
      ...pins,
      outputDirectory: outDir,
      fileName,
      ...(args.ifcVersion ? { ifcVersion: args.ifcVersion } : {}),
      ...(args.exportBaseQuantities !== undefined ? { exportBaseQuantities: args.exportBaseQuantities } : {}),
      ...(args.spaceBoundaryLevel !== undefined ? { spaceBoundaryLevel: args.spaceBoundaryLevel } : {}),
      ...(args.filterViewId !== undefined ? { filterViewId: args.filterViewId } : {})
    }, signal);
  }

  const arch = audit?.architectureGeometryAudit || null;
  const mdLines = [
    '# RevitAuto BIM Delivery Report',
    '',
    `- **Generated UTC**: ${new Date().toISOString()}`,
    `- **Document Identity**: \`${args.documentIdentity}\``,
    `- **Document Revision**: \`${args.expectedRevision}\``,
    `- **Output Directory**: \`${outDir}\``,
    ''
  ];

  if (arch) {
    mdLines.push('## Architecture & Structural Geometry Self-Audit', '');
    mdLines.push(`- **Overall HasIssues**: \`${arch.hasIssues}\``);
    mdLines.push(`- **Counts**: Walls=${arch.scannedWallCount}, Floors=${arch.scannedFloorCount}, Roofs=${arch.scannedRoofCount}, Columns=${arch.scannedColumnCount}, Beams=${arch.scannedBeamCount ?? 0}, Doors=${arch.doorCount}, Windows=${arch.windowCount}, Stairs=${arch.scannedStairCount}`);
    mdLines.push(`- **Wall-to-Wall Endpoint Gaps**: ${arch.wallToWallEndpointGapTotalCount ?? 0}`);
    mdLines.push(`- **Wall-to-Column Endpoint Gaps**: ${arch.wallColumnEndpointGapTotalCount ?? 0}`);
    mdLines.push(`- **Wall Vertical Gaps**: ${arch.wallVerticalGapTotalCount ?? 0}`);
    mdLines.push(`- **Structural Beam Endpoint Gaps**: ${arch.beamEndpointGapTotalCount ?? 0}`);
    mdLines.push(`- **Uncovered Structural Beams**: ${arch.uncoveredStructuralBeamTotalCount ?? 0}`);
    mdLines.push(`- **Structural Family Mismatches**: ${arch.structuralFamilyMismatchTotalCount ?? 0}`);
    mdLines.push(`- **Floating Hosted Walls**: ${arch.floatingHostedWallTotalCount ?? 0}`);
    mdLines.push(`- **Opening Collisions**: ${arch.openingCollisionTotalCount ?? 0}`);
    mdLines.push(`- **Close Parallel Double-Wall Boxes**: ${arch.closeParallelOverlappingWallTotalCount ?? 0}`);
    mdLines.push(`- **Isolated Short Wall Stubs**: ${arch.isolatedShortWallStubTotalCount ?? 0}`);
    mdLines.push('');
  }

  if (audit?.mechanicalPortAudit || mepDisconnects || electricalAudit) {
    mdLines.push('## Systems & MEP Audit', '');
    if (audit?.mechanicalPortAudit) {
      mdLines.push(`- **Mechanical Equipment Ports**: Connected=${audit.connectedMechanicalPorts?.length ?? 0}, Unconnected=${audit.unconnectedMechanicalPorts?.length ?? 0}, Unknown=${audit.unknownMechanicalPorts?.length ?? 0}`);
    }
    if (mepDisconnects) {
      mdLines.push(`- **MEP Open Connectors (${mepDisconnects.domainFilter ?? 'all'})**: Elements=${mepDisconnects.elementsWithOpenConnectors ?? 0}, OpenConnectors=${mepDisconnects.totalOpenConnectors ?? 0}, Unknown=${mepDisconnects.unknownConnectorCount ?? 0}`);
    }
    if (electricalAudit) {
      mdLines.push(`- **Electrical Circuits**: Scanned=${electricalAudit.circuits?.length ?? electricalAudit.circuitCount ?? 0}, Warnings=${electricalAudit.warnings?.length ?? 0}`);
    }
    mdLines.push('');
  }

  if (exportedSchedules.length > 0) {
    mdLines.push('## Exported Schedules (CSV)', '');
    for (const s of exportedSchedules) {
      mdLines.push(`- **${s.scheduleName}** (ID ${s.scheduleId}): ${s.rowCount} rows → \`${s.csvPath}\``);
    }
    mdLines.push('');
  }

  if (ifcResult) {
    mdLines.push('## IFC Export', '');
    mdLines.push(`- **File**: \`${ifcResult.outputPath}\``);
    mdLines.push(`- **Version**: \`${ifcResult.ifcVersion}\` | **Size**: ${ifcResult.bytes} bytes | **SHA-256**: \`${ifcResult.sha256}\``);
    mdLines.push(`- **RVT Unmodified/Unsaved**: \`saved=${ifcResult.saved}\``);
    mdLines.push('');
  }

  const reportMarkdownPath = path.join(outDir, 'delivery-report.md');
  const manifestJsonPath = path.join(outDir, 'delivery-manifest.json');
  const manifest = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    documentIdentity: args.documentIdentity,
    expectedRevision: args.expectedRevision,
    outputDirectory: outDir,
    reportMarkdownPath,
    auditSummary: arch ? {
      hasIssues: arch.hasIssues,
      wallCount: arch.scannedWallCount,
      columnCount: arch.scannedColumnCount,
      beamCount: arch.scannedBeamCount ?? 0,
      wallToWallEndpointGapTotalCount: arch.wallToWallEndpointGapTotalCount ?? 0,
      wallColumnEndpointGapTotalCount: arch.wallColumnEndpointGapTotalCount ?? 0,
      wallVerticalGapTotalCount: arch.wallVerticalGapTotalCount ?? 0,
      beamEndpointGapTotalCount: arch.beamEndpointGapTotalCount ?? 0,
      uncoveredStructuralBeamTotalCount: arch.uncoveredStructuralBeamTotalCount ?? 0,
      structuralFamilyMismatchTotalCount: arch.structuralFamilyMismatchTotalCount ?? 0
    } : null,
    mepSummary: (audit?.mechanicalPortAudit || mepDisconnects || electricalAudit) ? {
      mechanicalPorts: audit?.mechanicalPortAudit ? {
        connected: audit.connectedMechanicalPorts?.length ?? 0,
        unconnected: audit.unconnectedMechanicalPorts?.length ?? 0,
        unknown: audit.unknownMechanicalPorts?.length ?? 0
      } : null,
      mepDisconnects: mepDisconnects ? {
        domainFilter: mepDisconnects.domainFilter ?? 'all',
        elementsWithOpenConnectors: mepDisconnects.elementsWithOpenConnectors ?? 0,
        totalOpenConnectors: mepDisconnects.totalOpenConnectors ?? 0,
        unknownConnectorCount: mepDisconnects.unknownConnectorCount ?? 0
      } : null,
      electricalAudit: electricalAudit ? {
        circuitCount: electricalAudit.circuits?.length ?? electricalAudit.circuitCount ?? 0,
        warningCount: electricalAudit.warnings?.length ?? 0
      } : null
    } : null,
    exportedSchedules,
    ifc: ifcResult,
    warnings,
    saved: false
  };

  await fs.writeFile(reportMarkdownPath, mdLines.join('\n'), 'utf8');
  await fs.writeFile(manifestJsonPath, JSON.stringify(manifest, null, 2), 'utf8');

  return {
    status: 'delivery_package_exported',
    readOnly: !includeIfc,
    saved: false,
    reportMarkdownPath,
    manifestJsonPath,
    exportedSchedules,
    ifc: ifcResult,
    auditSummary: manifest.auditSummary,
    mepSummary: manifest.mepSummary,
    warnings
  };
}
