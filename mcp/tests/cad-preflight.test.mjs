import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { evaluateCadCompleteness, evaluateSkillsReadiness, runCadPreflight } from '../cad-preflight.mjs';
import { getWorkflow } from '../workflow-registry.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const psScript = path.join(repoRoot, 'tools', 'inspect-cad-preflight.ps1');
const lspScript = path.join(repoRoot, 'tools', 'cad-preflight-readonly.lsp');
const quote = value => `'${value.replaceAll("'", "''")}'`;

function completeFixture() {
  return {
    schemaVersion: 1,
    status: 'cad-preflight-readonly',
    readOnlyRequested: true,
    saveRequested: false,
    dbmodBefore: 0,
    dbmodAfter: 0,
    insunits: 4,
    lunits: 2,
    measurement: 1,
    extMin: [0, 0, 0],
    extMax: [18000, 12000, 0],
    layouts: ['Model', 'Layout1'],
    layers: [
      { name: 'AXIS', flags: 0, color: 1, frozen: false, locked: false, off: false },
      { name: 'PIPE-CW', flags: 0, color: 4, frozen: false, locked: false, off: false },
      { name: 'DIM', flags: 0, color: 2, frozen: false, locked: false, off: false },
      { name: 'TEXT', flags: 0, color: 7, frozen: false, locked: false, off: false }
    ],
    layerCount: 4,
    layersTruncated: false,
    modelSpaceEntityCount: 55,
    paperSpaceEntityCount: 0,
    proxyEntityCount: 0,
    geometrySummary: { line: 30, polyline: 10, circle: 2, arc: 0, text: 6, dimension: 4, insert: 3, proxy: 0, other: 0 },
    countsByType: { LINE: 30, LWPOLYLINE: 10, CIRCLE: 2, TEXT: 4, MTEXT: 2, DIMENSION: 4, INSERT: 3 },
    countsByLayer: { AXIS: 8, 'PIPE-CW': 32, DIM: 4, TEXT: 11 },
    paperSpaceCountsByType: {},
    textsTruncated: false,
    texts: [
      { handle: '10', type: 'MTEXT', layer: 'TEXT', text: '水泵房平面图 比例 1:50 单位: mm' },
      { handle: '11', type: 'TEXT', layer: 'TEXT', text: '1-1 剖面图 地面标高 ±0.000 管中心标高 +1.200m' },
      { handle: '12', type: 'TEXT', layer: 'TEXT', text: '冷却水供水管 DN100 离心水泵 Q=50m3/h' },
      { handle: '13', type: 'TEXT', layer: 'AXIS', text: '1~4轴 A~C轴 轴网定位' }
    ],
    dimensionsTruncated: false,
    dimensions: [
      { handle: '20', layer: 'DIM', textOverride: '', measurement: 6000, dimStyle: 'ISO-25', dimType: 32 },
      { handle: '21', layer: 'DIM', textOverride: '', measurement: 4500, dimStyle: 'ISO-25', dimType: 32 }
    ],
    blocksTruncated: false,
    blocks: [
      { handle: '30', layer: 'PIPE-CW', blockName: 'PUMP_VERTICAL', point: [2000, 3000, 0], scale: [1, 1, 1], rotation: 0, attributes: [{ tag: 'MODEL', value: 'ISG80-160' }] }
    ],
    paperSpaceTextsTruncated: false,
    paperSpaceTexts: []
  };
}

test('CAD preflight LISP and PowerShell scripts enforce read-only safety and balanced syntax', async () => {
  const [psSource, lspSource] = await Promise.all([
    fs.readFile(psScript, 'utf8'),
    fs.readFile(lspScript, 'utf8')
  ]);
  assert.match(psSource, /\/readonly/);
  assert.match(psSource, /\/isolate/);
  assert.match(psSource, /FileAttributes\]::ReadOnly/);
  assert.match(psSource, /SHA256\]::Create/);
  assert.doesNotMatch(psSource, /Stop-Process|taskkill|New-Object\s+-ComObject|Documents\.Open|\.Save(?:As)?\(/i);
  assert.doesNotMatch(lspSource, /\((?:setvar|entmod|entdel|entmake|vl-load-com|vlax-get-acad-object|command)\b/i);
  assert.match(psSource, /Assert-PreflightScriptSyntax/);
  assert.match(psSource, /CAD_PREFLIGHT_GEOMETRY_OUTPUT/);
  assert.match(lspSource, /CAD_PREFLIGHT_GEOMETRY_OUTPUT/);

  const rawLines = lspSource.split(/\r?\n/);
  for (let idx = 0; idx < rawLines.length; idx++) {
    assert.ok(
      rawLines[idx].length <= 240,
      `Line ${idx + 1} in cad-preflight-readonly.lsp is ${rawLines[idx].length} chars (>240); wrap lines to avoid .scr buffer truncation`
    );
  }

  const stripped = rawLines.filter(line => !line.trimStart().startsWith(';')).join('\n');
  let depth = 0;
  let inString = false;
  let escape = false;
  for (const ch of stripped) {
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      assert.ok(depth >= 0, 'Unbalanced closing paren in cad-preflight-readonly.lsp');
    }
  }
  assert.equal(inString, false);
  assert.equal(depth, 0);
});

test('PowerShell 5.1 parser accepts inspect-cad-preflight.ps1 and CheckOnly runs without spawning CAD', { skip: process.platform !== 'win32' }, async () => {
  const parseRes = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile(${quote(psScript)},[ref]$t,[ref]$e);if($e.Count){$e|Out-String|Write-Error;exit 1}`
  ], { encoding: 'utf8', timeout: 20000 });
  assert.equal(parseRes.status, 0, parseRes.stderr || parseRes.error?.message);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cad-preflight-check-'));
  try {
    const input = path.join(dir, 'sample.dwg');
    const fakeConsole = path.join(dir, 'accoreconsole.exe');
    const outDir = path.join(dir, 'must-not-exist');
    await fs.writeFile(input, 'AC1021fixture');
    await fs.writeFile(fakeConsole, 'mock-console');
    const cmd = `function Get-AuthenticodeSignature {param($LiteralPath) [pscustomobject]@{Status='Valid';SignerCertificate=[pscustomobject]@{Subject='CN=Autodesk mock'}}}; & ${quote(psScript)} -SourcePath ${quote(input)} -ConsolePath ${quote(fakeConsole)} -OutputDirectory ${quote(outDir)} -CheckOnly`;
    const checkRes = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', timeout: 20000 });
    assert.equal(checkRes.status, 0, checkRes.stderr);
    const parsed = JSON.parse(checkRes.stdout.replace(/^\uFEFF/, ''));
    assert.equal(parsed.status, 'inputs-checked');
    assert.equal(parsed.processStarted, false);
    await assert.rejects(fs.access(outDir));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('evaluateCadCompleteness marks a complete drawing complete with Yes-to-start gate', () => {
  const report = evaluateCadCompleteness(completeFixture(), {
    modelingGoal: 'pump_room',
    availableSkills: ['revit-cad-auto-modeling', 'dwg-field-review']
  });
  assert.equal(report.verdict, 'complete');
  assert.equal(report.missingOrAmbiguousItems.length, 0);
  assert.equal(report.readOnly, true);
  assert.equal(report.planCreated, false);
  assert.equal(report.skillsCheck.requiresSkillInstallConfirmation, false);
  assert.equal(report.userConfirmationGate.required, true);
  assert.equal(report.userConfirmationGate.canStartModelingNow, false);
  assert.equal(report.userConfirmationGate.bypassedByProjectAuthorization, false);
  assert.equal(report.userConfirmationGate.choices[0].id, 'confirm_start_modeling');
});

test('evaluateCadCompleteness flags proxy entities, missing elevations/grids, and unitless drawings as incomplete', () => {
  const incomplete = completeFixture();
  incomplete.insunits = 0;
  incomplete.proxyEntityCount = 14;
  incomplete.geometrySummary.proxy = 14;
  incomplete.layers = [{ name: '0', flags: 0, color: 7, frozen: false, locked: false, off: false }];
  incomplete.countsByLayer = { '0': 20 };
  incomplete.texts = [{ handle: '1', type: 'TEXT', layer: '0', text: '仅平面草图' }];
  incomplete.dimensions = [];
  incomplete.geometrySummary.dimension = 0;

  const report = evaluateCadCompleteness(incomplete, { modelingGoal: 'pump_room' });
  assert.equal(report.verdict, 'incomplete');
  assert.ok(report.missingOrAmbiguousItems.some(msg => /ACAD_PROXY_ENTITY/.test(msg)));
  assert.ok(report.missingOrAmbiguousItems.some(msg => /标高/.test(msg)));
  assert.ok(report.missingOrAmbiguousItems.some(msg => /轴网/.test(msg)));
  assert.ok(report.missingOrAmbiguousItems.some(msg => /INSUNITS=0/.test(msg)));
  assert.ok(report.missingOrAmbiguousItems.some(msg => /尺寸标注/.test(msg)));
  assert.deepEqual(
    report.userConfirmationGate.choices.map(c => c.id),
    ['proceed_incomplete_modeling', 'supplement_drawings']
  );
});

test('evaluateSkillsReadiness requires user confirmation when required skills are missing', () => {
  const missing = evaluateSkillsReadiness({
    availableSkills: ['libredwg'],
    requiredSkills: ['revit-cad-auto-modeling', 'dwg-field-review']
  });
  assert.equal(missing.requiresSkillInstallConfirmation, true);
  assert.deepEqual(missing.missingSkills, ['revit-cad-auto-modeling', 'dwg-field-review']);
});

test('workflow registry exposes imports.cad_preflight as read-only', () => {
  const wf = getWorkflow('imports.cad_preflight');
  assert.ok(wf);
  assert.equal(wf.enabled, true);
  assert.equal(wf.destructiveLevel, 'read-only');
});

test('revit-custom MCP exposes revit_cad_preflight tool and cad-preflight-guide resource offline', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, 'mcp', 'revit-custom.mjs')],
    cwd: repoRoot,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'cad-preflight-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const tool = listed.tools.find(item => item.name === 'revit_cad_preflight');
    assert.ok(tool, 'revit_cad_preflight must be registered in revit-custom MCP');
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);

    const guideRes = await client.readResource({ uri: 'revit-custom://cad-preflight-guide' });
    const guide = JSON.parse(guideRes.contents[0].text);
    assert.equal(guide.apiIntegrationDeferred, true);
    assert.equal(guide.mandatoryPreModelingGate.length, 4);
    assert.equal(guide.mandatoryPreDeliveryAuditGate.length, 5);
    assert.deepEqual(
      guide.mandatoryPreDeliveryAuditGate.map(item => item.id),
      [
        'xy_plan_geometry_and_topology',
        'z_axis_elevation_and_construction',
        'material_family_consistency',
        'native_audit_clash_and_visual_proof',
        'completeness_schedules_and_hygiene'
      ]
    );

    const callRes = await client.callTool({
      name: 'revit_cad_preflight',
      arguments: { preflightData: completeFixture(), modelingGoal: 'pump_room', availableSkills: ['revit-cad-auto-modeling'] }
    });
    assert.equal(callRes.isError, undefined);
    const payload = JSON.parse(callRes.content[0].text);
    assert.equal(payload.verdict, 'complete');
    assert.equal(payload.userConfirmationGate.canStartModelingNow, false);
  } finally {
    await client.close();
  }
});

test('runCadPreflight rejects conflicting or missing sources', async () => {
  await assert.rejects(() => runCadPreflight({}), /Provide either filePath/);
  await assert.rejects(() => runCadPreflight({ filePath: 'a.json', preflightData: {} }), /not both/);
});

test('Assert-PreflightScriptSyntax rejects oversized LISP lines and unbalanced expressions before starting CAD', { skip: process.platform !== 'win32' }, () => {
  const cmd = [
    `$ErrorActionPreference='Stop'`,
    `$tokens=$null;$errors=$null`,
    `$ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(psScript)},[ref]$tokens,[ref]$errors)`,
    `if($errors.Count){throw ($errors|Out-String)}`,
    `$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)|ForEach-Object{Invoke-Expression $_.Extent.Text}`,
    `$long='(defun x () \"' + ('a'*520) + '\")'`,
    `$rejectedLong=$false; try { [void](Assert-PreflightScriptSyntax $long) } catch { if ($_.Exception.Message -match 'exceeds 500 characters') { $rejectedLong=$true } }`,
    `if (-not $rejectedLong) { throw 'Oversized LISP line was not rejected' }`,
    `$unbalanced='(defun x () (princ \"hi\")'`,
    `$rejectedUnbalanced=$false; try { [void](Assert-PreflightScriptSyntax $unbalanced) } catch { if ($_.Exception.Message -match 'unbalanced') { $rejectedUnbalanced=$true } }`,
    `if (-not $rejectedUnbalanced) { throw 'Unbalanced LISP was not rejected' }`,
    `Write-Output 'ok'`
  ].join(';');
  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', timeout: 20000 });
  assert.equal(res.status, 0, res.stderr || res.error?.message);
  assert.equal(res.stdout.trim(), 'ok');
});

test('runCadPreflight serializes concurrent DWG preflight runs and returns geometryJsonlPath', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cad-preflight-queue-'));
  try {
    const dwgA = path.join(dir, 'a.dwg');
    const dwgB = path.join(dir, 'b.dwg');
    const fakeConsole = path.join(dir, 'accoreconsole.exe');
    await fs.writeFile(dwgA, 'AC1021-a');
    await fs.writeFile(dwgB, 'AC1021-b');
    await fs.writeFile(fakeConsole, 'mock');

    let active = 0;
    let maxConcurrent = 0;
    const order = [];

    const mockRunner = async ({ sourcePath }) => {
      active++;
      maxConcurrent = Math.max(maxConcurrent, active);
      order.push(`start:${path.basename(sourcePath)}`);
      await new Promise(r => setTimeout(r, 25));
      const runDir = path.join(dir, `run-${path.basename(sourcePath, '.dwg')}`);
      await fs.mkdir(runDir, { recursive: true });
      const preflightPath = path.join(runDir, 'preflight.json');
      const geometryPath = path.join(runDir, 'geometry.jsonl');
      const manifestPath = path.join(runDir, 'manifest.json');
      const fixture = { ...completeFixture(), geometryJsonlCount: 42 };
      await fs.writeFile(preflightPath, JSON.stringify(fixture), 'utf8');
      await fs.writeFile(geometryPath, '{"t":"LINE","h":"10","l":"AXIS","p1":[0,0],"p2":[1000,0]}\n', 'utf8');
      await fs.writeFile(manifestPath, JSON.stringify({
        schemaVersion: 1,
        status: 'cad-preflight-complete-review-logs',
        preflightPath,
        geometryPath,
        sourceSha256Before: 'AA',
        sourceSha256After: 'AA',
        copySha256After: 'AA',
        dwgSignature: 'AC1021',
        artifacts: { 'geometry.jsonl': { bytes: 58, sha256: 'BB' } }
      }), 'utf8');
      order.push(`end:${path.basename(sourcePath)}`);
      active--;
      return { manifestPath, stdout: manifestPath, stderr: '' };
    };

    const [resA, resB] = await Promise.all([
      runCadPreflight({ filePath: dwgA, consolePath: fakeConsole, outputDirectory: dir, modelingGoal: 'pump_room' }, undefined, { runPreflightScript: mockRunner }),
      runCadPreflight({ filePath: dwgB, consolePath: fakeConsole, outputDirectory: dir, modelingGoal: 'pump_room' }, undefined, { runPreflightScript: mockRunner })
    ]);

    assert.equal(maxConcurrent, 1, 'Concurrent DWG preflight runs must be serialized');
    assert.deepEqual(order, ['start:a.dwg', 'end:a.dwg', 'start:b.dwg', 'end:b.dwg']);
    assert.ok(resA.sourceEvidence.geometryJsonlPath.endsWith('geometry.jsonl'));
    assert.equal(resA.sourceEvidence.geometryJsonlBytes, 58);
    assert.equal(resA.drawingStats.geometryJsonlCount, 42);
    assert.ok(resB.sourceEvidence.geometryJsonlPath.endsWith('geometry.jsonl'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
