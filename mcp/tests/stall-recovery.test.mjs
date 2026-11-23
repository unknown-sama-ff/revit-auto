import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CircuitBreaker,
  buildStallReceipt,
  classifyCadConsoleLog,
  classifyRevitBridgeStall
} from '../stall-recovery.mjs';
import {
  resetCadPreflightCircuitBreaker,
  runCadPreflight
} from '../cad-preflight.mjs';
import { callRevit } from '../bridge.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const psScript = path.join(repoRoot, 'tools', 'inspect-cad-preflight.ps1');
const quote = value => `'${value.replaceAll("'", "''")}'`;

function minimalPreflightData() {
  return {
    schemaVersion: 1,
    status: 'cad-preflight-readonly',
    readOnlyRequested: true,
    saveRequested: false,
    dbmodBefore: 0,
    dbmodAfter: 0,
    insunits: 4,
    layouts: ['Model'],
    layers: [{ name: 'AXIS', flags: 0, color: 1, frozen: false, locked: false, off: false }],
    layerCount: 1,
    modelSpaceEntityCount: 12,
    paperSpaceEntityCount: 0,
    proxyEntityCount: 0,
    geometrySummary: { line: 8, polyline: 2, circle: 0, arc: 0, text: 1, dimension: 1, insert: 0, proxy: 0, other: 0 },
    countsByType: { LINE: 8, LWPOLYLINE: 2, TEXT: 1, DIMENSION: 1 },
    countsByLayer: { AXIS: 12 },
    texts: [{ handle: '10', type: 'TEXT', layer: 'AXIS', text: '一层平面图 比例 1:100 标高 ±0.000 1~3轴 墙柱梁' }],
    dimensions: [{ handle: '11', layer: 'AXIS', textOverride: '', measurement: 3000 }],
    blocks: [],
    paperSpaceTexts: []
  };
}

async function createBridgeFixture(handler, { pid = 4321, features = [] } = {}) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'revit-stall-bridge-'));
  const token = 'stall-test-token-'.repeat(4);
  const sockets = new Set();
  const calls = [];
  let bridgeInfoCalls = 0;
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const idx = buffer.indexOf('\n');
      if (idx < 0) return;
      const req = JSON.parse(buffer.slice(0, idx));
      buffer = '';
      if (req.method === 'revit.bridge.info') {
        bridgeInfoCalls++;
        socket.end(JSON.stringify({
          protocol: 'revit-auto-2027-v2',
          ok: true,
          result: { protocol: 'revit-auto-2027-v2', confirmationMode: 'chat', pid, features }
        }) + '\n');
        return;
      }
      calls.push(req);
      handler(req, socket);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = path.join(folder, 'bridge.json');
  await fs.writeFile(config, JSON.stringify({ port: server.address().port, token }));
  return {
    config,
    calls,
    get bridgeInfoCalls() { return bridgeInfoCalls; },
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise(r => server.close(r));
      await fs.rm(folder, { recursive: true, force: true });
    }
  };
}

test('classifyCadConsoleLog detects interactive prompt hangs, corrupt drawings, and ignores normal success logs', () => {
  assert.equal(classifyCadConsoleLog('Command: (cp-main)\n((_>\n').reason, 'interactive_prompt_hang');
  assert.equal(classifyCadConsoleLog('Press ENTER to continue:').reason, 'interactive_prompt_hang');
  assert.equal(classifyCadConsoleLog('Specify font for style Standard:').reason, 'interactive_prompt_hang');
  assert.equal(classifyCadConsoleLog('Drawing file is not valid.').reason, 'drawing_recovery_prompt');
  assert.equal(classifyCadConsoleLog('FATAL ERROR: Unhandled Access Violation').reason, 'cad_fatal_or_license_error');
  assert.deepEqual(classifyCadConsoleLog('CAD_PREFLIGHT_SUCCESS modelSpace=120\n_.QUIT\n'), {
    stalled: false,
    reason: null,
    matchedPattern: null
  });
});

test('CircuitBreaker trips after threshold consecutive same-reason failures and resets on success', () => {
  let now = 1000;
  const breaker = new CircuitBreaker({ threshold: 2, windowMs: 60000, now: () => now });
  assert.equal(breaker.check('k').open, false);
  assert.equal(breaker.recordFailure('k', 'no_progress_timeout').open, false);
  assert.equal(breaker.recordFailure('k', 'no_progress_timeout').open, true);
  assert.equal(breaker.check('k').consecutiveFailures, 2);
  // Different failure reason resets consecutive count to 1
  assert.equal(breaker.recordFailure('k', 'interactive_prompt_hang').open, false);
  // Window expiry clears stale failures
  now += 70000;
  assert.equal(breaker.check('k').open, false);
  breaker.recordFailure('k', 'total_timeout');
  breaker.recordFailure('k', 'total_timeout');
  assert.equal(breaker.check('k').open, true);
  breaker.recordSuccess('k');
  assert.equal(breaker.check('k').open, false);
});

test('PowerShell watchdog helpers classify interactive hangs and strictly verify owned orphan candidates', { skip: process.platform !== 'win32' }, () => {
  const cmd = [
    `$ErrorActionPreference='Stop'`,
    `$tokens=$null;$errors=$null`,
    `$ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(psScript)},[ref]$tokens,[ref]$errors)`,
    `if($errors.Count){throw ($errors|Out-String)}`,
    `$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)|ForEach-Object{Invoke-Expression $_.Extent.Text}`,
    `if((Test-PreflightInteractiveHangText "Command:\`n((_>\`n") -ne 'interactive_prompt_hang'){throw 'Failed to detect unclosed LISP prompt'}`,
    `if((Test-PreflightInteractiveHangText "Press ENTER to continue") -ne 'interactive_prompt_hang'){throw 'Failed to detect ENTER prompt'}`,
    `if($null -ne (Test-PreflightInteractiveHangText "CAD_PREFLIGHT_SUCCESS modelSpace=10")){throw 'False positive hang detection'}`,
    `$ownedCmd='/i "C:\\t\\source.dwg" /s "C:\\t\\preflight.scr" /product ACAD /isolate cad-pf-0123456789abcdef0123456789abcdef "C:\\t\\profile" /readonly'`,
    `if(-not (Test-OwnedPreflightOrphanCandidate -CommandLine $ownedCmd -ParentAlive $false -AgeSeconds 10)){throw 'Dead-parent owned orphan was not detected'}`,
    `if(-not (Test-OwnedPreflightOrphanCandidate -CommandLine $ownedCmd -ParentAlive $true -AgeSeconds 400)){throw 'Expired owned orphan was not detected'}`,
    `if(Test-OwnedPreflightOrphanCandidate -CommandLine $ownedCmd -ParentAlive $true -AgeSeconds 20){throw 'Active owned console must not be treated as orphan'}`,
    `if(Test-OwnedPreflightOrphanCandidate -CommandLine '/i "user.dwg" /s "other.scr"' -ParentAlive $false -AgeSeconds 999){throw 'Unrelated accoreconsole must never be treated as owned orphan'}`,
    `Write-Output 'ok'`
  ].join(';');
  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', timeout: 20000 });
  assert.equal(res.status, 0, res.stderr || res.error?.message);
  assert.equal(res.stdout.trim(), 'ok');
});

test('runCadPreflight auto-recovers once with degraded summary-only fallback after no_progress_timeout stall', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cad-preflight-recover-'));
  try {
    const dwg = path.join(dir, 'heavy.dwg');
    const fakeConsole = path.join(dir, 'accoreconsole.exe');
    await fs.writeFile(dwg, 'AC1021-heavy');
    await fs.writeFile(fakeConsole, 'mock');
    resetCadPreflightCircuitBreaker();

    const attempts = [];
    const mockRunner = async ({ skipGeometryJsonl }) => {
      attempts.push({ skipGeometryJsonl });
      if (!skipGeometryJsonl) {
        const failedDir = path.join(dir, 'run-1');
        await fs.mkdir(failedDir, { recursive: true });
        const manifestPath = path.join(failedDir, 'manifest.json');
        await fs.writeFile(manifestPath, JSON.stringify({
          schemaVersion: 1,
          status: 'failed-unaccepted',
          stallDetected: true,
          stallReason: 'no_progress_timeout',
          failure: 'Core Console stalled and was terminated by watchdog: no_progress_timeout'
        }), 'utf8');
        throw Object.assign(new Error('CAD preflight extraction failed (exit 1): watchdog stall'), {
          code: 'cad_preflight_extraction_failed',
          details: { exitCode: 1, manifestPath }
        });
      }
      const okDir = path.join(dir, 'run-2');
      await fs.mkdir(okDir, { recursive: true });
      const preflightPath = path.join(okDir, 'preflight.json');
      const manifestPath = path.join(okDir, 'manifest.json');
      await fs.writeFile(preflightPath, JSON.stringify(minimalPreflightData()), 'utf8');
      await fs.writeFile(manifestPath, JSON.stringify({
        schemaVersion: 1,
        status: 'cad-preflight-complete-review-logs',
        preflightPath,
        geometryPath: null,
        skipGeometryJsonl: true,
        orphanCleanup: { cleanedCount: 0, cleaned: [], remainingActiveCount: 0 },
        sourceSha256Before: 'AA',
        sourceSha256After: 'AA',
        copySha256After: 'AA',
        dwgSignature: 'AC1021',
        artifacts: {}
      }), 'utf8');
      return { manifestPath, stdout: manifestPath, stderr: '' };
    };

    const result = await runCadPreflight(
      { filePath: dwg, consolePath: fakeConsole, outputDirectory: dir },
      undefined,
      { runPreflightScript: mockRunner }
    );
    assert.deepEqual(attempts, [{ skipGeometryJsonl: false }, { skipGeometryJsonl: true }]);
    assert.equal(result.stallRecovery.stallDetected, true);
    assert.equal(result.stallRecovery.stallReason, 'no_progress_timeout');
    assert.equal(result.stallRecovery.autoRecoveryAttempted, true);
    assert.equal(result.stallRecovery.recoveryOutcome, 'recovered_degraded');
    assert.equal(result.sourceEvidence.skipGeometryJsonl, true);
    assert.equal(result.sourceEvidence.geometryJsonlPath, null);
    assert.ok(result.warnings.some(w => /降级为仅摘要模式/.test(w)));
  } finally {
    resetCadPreflightCircuitBreaker();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runCadPreflight does not auto-retry corrupt DWG errors and trips circuit breaker after two consecutive stalls', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cad-preflight-cb-'));
  try {
    const dwg = path.join(dir, 'corrupt.dwg');
    const fakeConsole = path.join(dir, 'accoreconsole.exe');
    await fs.writeFile(dwg, 'AC1021-corrupt');
    await fs.writeFile(fakeConsole, 'mock');
    resetCadPreflightCircuitBreaker();

    let runnerCalls = 0;
    const mockRunner = async () => {
      runnerCalls++;
      const runDir = path.join(dir, `run-${runnerCalls}`);
      await fs.mkdir(runDir, { recursive: true });
      const manifestPath = path.join(runDir, 'manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify({
        schemaVersion: 1,
        status: 'failed-unaccepted',
        stallDetected: true,
        stallReason: 'drawing_recovery_prompt',
        failure: 'Drawing file is not valid'
      }), 'utf8');
      throw Object.assign(new Error('Drawing file is not valid'), {
        code: 'cad_preflight_extraction_failed',
        details: { exitCode: 1, manifestPath }
      });
    };

    await assert.rejects(
      runCadPreflight({ filePath: dwg, consolePath: fakeConsole, outputDirectory: dir }, undefined, { runPreflightScript: mockRunner }),
      err => err.details?.stallReceipt?.stallReason === 'drawing_recovery_prompt' && err.details?.stallReceipt?.automaticRetryAllowed === false
    );
    assert.equal(runnerCalls, 1, 'Non-recoverable drawing corruption must not trigger degraded retry');

    await assert.rejects(
      runCadPreflight({ filePath: dwg, consolePath: fakeConsole, outputDirectory: dir }, undefined, { runPreflightScript: mockRunner }),
      err => err.details?.stallReceipt?.circuitState?.open === true
    );
    assert.equal(runnerCalls, 2);

    // 3rd call must be short-circuited without spawning runner
    await assert.rejects(
      runCadPreflight({ filePath: dwg, consolePath: fakeConsole, outputDirectory: dir }, undefined, { runPreflightScript: mockRunner }),
      err => err.code === 'cad_preflight_circuit_open' && err.details?.stallReceipt?.circuitState?.open === true
    );
    assert.equal(runnerCalls, 2, 'Open circuit breaker must block repeated launches');
  } finally {
    resetCadPreflightCircuitBreaker();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runCadPreflight surfaces orphan cleanup telemetry on clean recovery', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cad-preflight-orphan-'));
  try {
    const dwg = path.join(dir, 'ok.dwg');
    const fakeConsole = path.join(dir, 'accoreconsole.exe');
    await fs.writeFile(dwg, 'AC1021-ok');
    await fs.writeFile(fakeConsole, 'mock');
    resetCadPreflightCircuitBreaker();

    const mockRunner = async () => {
      const runDir = path.join(dir, 'run-ok');
      await fs.mkdir(runDir, { recursive: true });
      const preflightPath = path.join(runDir, 'preflight.json');
      const geometryPath = path.join(runDir, 'geometry.jsonl');
      const manifestPath = path.join(runDir, 'manifest.json');
      await fs.writeFile(preflightPath, JSON.stringify(minimalPreflightData()), 'utf8');
      await fs.writeFile(geometryPath, '{"t":"LINE"}\n', 'utf8');
      await fs.writeFile(manifestPath, JSON.stringify({
        schemaVersion: 1,
        status: 'cad-preflight-complete-review-logs',
        preflightPath,
        geometryPath,
        orphanCleanup: { cleanedCount: 1, cleaned: [{ pid: 9999, terminated: true }], remainingActiveCount: 0 },
        sourceSha256Before: 'AA',
        sourceSha256After: 'AA',
        copySha256After: 'AA',
        dwgSignature: 'AC1021',
        artifacts: { 'geometry.jsonl': { bytes: 13, sha256: 'BB' } }
      }), 'utf8');
      return { manifestPath, stdout: manifestPath, stderr: '' };
    };

    const result = await runCadPreflight({ filePath: dwg, consolePath: fakeConsole, outputDirectory: dir }, undefined, { runPreflightScript: mockRunner });
    assert.equal(result.sourceEvidence.orphanCleanedCount, 1);
    assert.equal(result.stallRecovery.recoveryOutcome, 'recovered_full');
    assert.ok(result.stallRecovery.recoveryActions.includes('cleaned_owned_orphan_console'));
  } finally {
    resetCadPreflightCircuitBreaker();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('bridge retries a read-only query once after transient mid-flight socket drop', async t => {
  let searchAttempts = 0;
  const f = await createBridgeFixture((req, socket) => {
    if (req.method === 'revit.search') {
      searchAttempts++;
      if (searchAttempts === 1) { socket.end(); return; }
      socket.end(JSON.stringify({ protocol: 'revit-auto-2027-v2', ok: true, result: { items: [{ id: 7 }] } }) + '\n');
    }
  });
  t.after(f.close);
  const oldConfig = process.env.REVIT_AI_CONFIG;
  process.env.REVIT_AI_CONFIG = f.config;
  t.after(() => { if (oldConfig === undefined) delete process.env.REVIT_AI_CONFIG; else process.env.REVIT_AI_CONFIG = oldConfig; });

  const res = await callRevit('revit.search', { query: 'wall' });
  assert.equal(searchAttempts, 2);
  assert.deepEqual(res.items, [{ id: 7 }]);
});

test('bridge timeout on write commit probes modal dialog state and runs read-only plan verification without retrying write', async t => {
  let confirmCalls = 0;
  let planGetCalls = 0;
  const f = await createBridgeFixture((req, socket) => {
    if (req.method === 'revit.plan.confirm') {
      confirmCalls++;
      // Intentionally hang to simulate Revit modal dialog blocking ExternalEvent
      return;
    }
    if (req.method === 'revit.plan.get') {
      planGetCalls++;
      socket.end(JSON.stringify({
        protocol: 'revit-auto-2027-v2',
        ok: true,
        result: { planId: req.params.planId, status: 'pending' }
      }) + '\n');
    }
  }, { pid: 8888 });
  t.after(f.close);
  const oldConfig = process.env.REVIT_AI_CONFIG;
  const oldTimeout = process.env.REVIT_AI_TIMEOUT_MS;
  process.env.REVIT_AI_CONFIG = f.config;
  process.env.REVIT_AI_TIMEOUT_MS = '1000';
  t.after(() => {
    if (oldConfig === undefined) delete process.env.REVIT_AI_CONFIG; else process.env.REVIT_AI_CONFIG = oldConfig;
    if (oldTimeout === undefined) delete process.env.REVIT_AI_TIMEOUT_MS; else process.env.REVIT_AI_TIMEOUT_MS = oldTimeout;
  });

  const mockHostProbe = async ({ pid }) => ({
    available: true,
    processAlive: true,
    revitProcessCount: 1,
    pid,
    mainWindowResponding: true,
    modalDialogDetected: true,
    modalDialogCount: 1,
    modalDialogClasses: ['#32770']
  });

  await assert.rejects(
    callRevit('revit.plan.confirm', { planId: 'modal-blocked-plan' }, undefined, { inspectHostState: mockHostProbe, probeTimeoutMs: 1000 }),
    err => {
      assert.equal(err.code, 'bridge_timeout');
      assert.equal(err.details.automaticRetryAllowed, false);
      assert.equal(err.details.bridgeAlive, true);
      const sr = err.details.stallReceipt;
      assert.equal(sr.stallDetected, true);
      assert.equal(sr.stallReason, 'revit_modal_dialog');
      assert.equal(sr.recoveryOutcome, 'verified_state_only');
      assert.equal(sr.automaticRetryAllowed, false);
      assert.equal(sr.hostState.modalDialogDetected, true);
      assert.equal(sr.hostState.pid, 8888);
      assert.equal(sr.postTimeoutVerification.attempted, true);
      assert.equal(sr.postTimeoutVerification.verified, true);
      assert.equal(sr.postTimeoutVerification.observedStatus, 'pending');
      assert.equal(sr.postTimeoutVerification.committed, false);
      return true;
    }
  );
  assert.equal(confirmCalls, 1, 'Write commit must NEVER be retried automatically');
  assert.equal(planGetCalls, 1, 'Read-only revit.plan.get verification must run once');
});

test('classifyRevitBridgeStall distinguishes process exit, modal dialog, unresponsive UI, and queued stall', () => {
  assert.equal(
    classifyRevitBridgeStall({ code: 'bridge_timeout', hostState: { available: true, processAlive: false } }).stallReason,
    'revit_process_not_running'
  );
  assert.equal(
    classifyRevitBridgeStall({ code: 'bridge_timeout', hostState: { available: true, processAlive: true, modalDialogDetected: true, modalDialogClasses: ['#32770'] } }).stallReason,
    'revit_modal_dialog'
  );
  assert.equal(
    classifyRevitBridgeStall({ code: 'bridge_timeout', hostState: { available: true, processAlive: true, modalDialogDetected: false, mainWindowResponding: false } }).stallReason,
    'revit_ui_unresponsive'
  );
  assert.equal(
    classifyRevitBridgeStall({ code: 'bridge_timeout', bridgeAlive: true, hostState: { available: false } }).stallReason,
    'revit_external_event_stalled'
  );
  const r = buildStallReceipt({ stallDetected: true, stallReason: 'revit_modal_dialog', automaticRetryAllowed: false, nextSafeAction: 'Close dialog' });
  assert.equal(r.schemaVersion, 1);
  assert.equal(r.automaticRetryAllowed, false);
});

test('MCP server advertises stallRecoveryPolicy in cad-preflight-guide resource', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, 'mcp', 'revit-custom.mjs')],
    cwd: repoRoot,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'stall-policy-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const guideRes = await client.readResource({ uri: 'revit-custom://cad-preflight-guide' });
    const guide = JSON.parse(guideRes.contents[0].text);
    assert.ok(guide.stallRecoveryPolicy);
    assert.match(guide.stallRecoveryPolicy.cadWatchdog, /interactive prompt/i);
    assert.match(guide.stallRecoveryPolicy.revitBridgeProtection, /never auto-retry writes/i);
  } finally {
    await client.close();
  }
});
