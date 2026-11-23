import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { nativeDwgExport, dwgExporterMode } from '../native-dwg-export.mjs';
import { importInput } from '../imports.mjs';
import { drawingCandidates } from '../drawing-candidates.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const calibration = { scaleMmPerUnit: 1, origin: { x: 0, y: 0 }, offsetMm: { x: 0, y: 0, z: 0 }, rotationDegrees: 0, levelId: 311 };
const mapping = { test: { operationType: 'create_wall', wallTypeId: 1, heightMm: 3000 } };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-dwg-adapter-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'tools')); await fs.writeFile(path.join(root, 'tools/export-dwg-native.ps1'), '# inert mock CLI');
  await fs.writeFile(path.join(root, 'tools/native-dwg-readonly.lsp'), '; inert mock Lisp');
  const source = path.join(root, 'source.dwg'), consolePath = path.join(root, 'accoreconsole.exe');
  await fs.writeFile(source, 'AC1032-inert-test-source'); await fs.writeFile(consolePath, 'mock executable, never launched');
  const env = { REVIT_AI_DWG_EXPORTER: 'native-console', REVIT_AI_DWG_CONSOLE_PATH: consolePath,
    REVIT_AI_IMPORT_ARTIFACTS_DIR: path.join(root, 'artifacts'), REVIT_AI_DWG_TIMEOUT_SECONDS: '1' };
  return { root, source, consolePath, env, input: { source, repoRoot: root, env } };
}
function mockCli(change = async () => {}) {
  return async options => {
    const { outputRoot, source, consolePath, timeoutSeconds, script } = options;
    const run = path.join(outputRoot, 'native-dwg-' + 'a'.repeat(32)); await fs.mkdir(run);
    const entities = [{ handle: 'A', nativeType: 'LINE', layer: 'test', objectName: 'AcDbLine', coordinateSpace: 'native-world-xyz',
      start: { x: 0, y: 0, z: 4 }, end: { x: 10, y: 0, z: 4 } },
    { handle: 'B', nativeType: 'CIRCLE', layer: 'test', objectName: 'UnknownNativeGeometry', geometryUnknown: true, readError: 'Geometry not extracted.' }];
    const sourceSha = sha(await fs.readFile(source));
    const native = { schemaVersion: 2, scope: 'selected-ModelSpace-main-graphical-entities', wholeDrawingDecodeAccepted: false,
      entireDatabaseInventoryComplete: false, designScaleVerified: false, dbmodBefore: 0, dbmodAfter: 0, saveRequested: false, readOnlyRequested: true,
      selectionHandlesStable: true, selectionCount: 2, selectionCountAfter: 2, modelSpaceEntityCount: 2,
      lineGeometryCount: 1, unsupportedGeometryCount: 1, entities: entities.map(entity => ({ handle: entity.handle, type: entity.nativeType,
        layer: entity.layer, ...(entity.nativeType === 'LINE' ? { coordinateSpace: 'native-world-xyz',
          start: [entity.start.x, entity.start.y, entity.start.z], end: [entity.end.x, entity.end.y, entity.end.z] } : { geometryUnknown: true }) })) };
    const data = { document: path.basename(source), entities, extraction: { sourceSha256: sourceSha, readOnly: true, modelUploaded: false,
      sourceCopyMatched: true, modifiedStateBefore: 0, modifiedStateAfter: 0, entityCountBefore: 2, entityCountAfter: 2,
      scope: 'selected-ModelSpace-main-graphical-entities', wholeDrawingDecodeAccepted: false, designScaleVerified: false,
      exactPersistenceVerified: false, lineGeometryCount: 1, unsupportedGeometryCount: 1 } };
    await fs.copyFile(source, path.join(run, 'source.dwg'));
    const manifest = { schemaVersion: 1, status: 'scoped-export-complete-review-logs', source, sourceCopy: path.join(run, 'source.dwg'),
      sourceSha256Before: sourceSha, sourceSha256After: sourceSha, copySha256After: sourceSha, executable: consolePath,
      executableSha256: sha(await fs.readFile(consolePath)), lispSha256: sha(await fs.readFile(path.join(path.dirname(script), 'native-dwg-readonly.lsp'))),
      exportPath: path.join(run, 'export.json'), consoleExitCode: 0, timedOut: false, saveRequested: false, modelWriteRequested: false,
      timeoutSeconds, ownedPid: 12345, ownedStartTimeUtc: new Date().toISOString(), finishedUtc: new Date().toISOString(), artifacts: {} };
    const result = { exitCode: 0, exitSignal: null, cliPid: 54321 };
    await change({ ...options, run, manifest, native, data, result });
    await fs.writeFile(path.join(run, 'native.json'), JSON.stringify(native));
    await fs.writeFile(path.join(run, 'export.json'), JSON.stringify(data));
    for (const name of ['stdout.log', 'stderr.log', 'extract.scr', 'console.decoded.log']) await fs.writeFile(path.join(run, name), name);
    for (const name of ['native.json', 'export.json', 'stdout.log', 'stderr.log', 'extract.scr', 'console.decoded.log']) {
      const bytes = await fs.readFile(path.join(run, name)); manifest.artifacts[name] = { sha256: sha(bytes), bytes: bytes.length };
    }
    await fs.writeFile(path.join(run, 'manifest.json'), JSON.stringify(manifest));
    return result;
  };
}
test('explicit native source preserves known/unknown inventory and returns candidates through existing calibration', async t => {
  const f = await fixture(t); const original = await fs.readFile(f.source);
  const data = await nativeDwgExport({ ...f.input, runCli: mockCli() });
  assert.equal(data.entities.length, 2); assert.equal(data.entities[1].geometryUnknown, true);
  const candidates = drawingCandidates(data, calibration, mapping);
  assert.equal(candidates.operations.length, 1); assert.equal(candidates.issues.length, 1);
  assert.equal(candidates.operations[0].start.zMm, 4); assert.equal(candidates.sourceGeometryCount, 2);
  assert.match(candidates.issues[0].message, /Unknown source geometry/); assert.equal(candidates.candidateOnly, true);
  assert.match(data.extraction.manifestPath, /manifest\.json$/); assert.deepEqual(await fs.readFile(f.source), original);
});
test('native completion refuses dirty state timeout exit/hash mismatch and never accepts partial output', async t => {
  const f = await fixture(t);
  for (const change of [({ manifest }) => { manifest.status = 'failed-unaccepted'; },
    ({ manifest }) => { manifest.timedOut = true; manifest.consoleExitCode = -1; },
    ({ native }) => { native.dbmodAfter = 1; }, ({ data }) => { data.extraction.modifiedStateBefore = 1; },
    ({ manifest }) => { manifest.copySha256After = '0'.repeat(64); },
    ({ manifest }) => { manifest.sourceSha256After = '0'.repeat(64); },
    ({ result }) => { result.exitCode = 1; }, ({ manifest }) => { manifest.saveRequested = true; },
    ({ manifest }) => { manifest.cleanupFailure = 'ownership not verified'; }]) {
    await assert.rejects(nativeDwgExport({ ...f.input, runCli: mockCli(change) }), asyncError => {
      assert.ok(asyncError.details.manifestPath); return true;
    });
  }
  const runs = await fs.readdir(f.env.REVIT_AI_IMPORT_ARTIFACTS_DIR); assert.equal(runs.length, 9);
});
test('manifest cannot redirect source copy or export outside its fixed owned filenames', async t => {
  const f = await fixture(t);
  for (const field of ['source', 'sourceCopy', 'exportPath', 'executable'])
    await assert.rejects(nativeDwgExport({ ...f.input, runCli: mockCli(({ manifest }) => { manifest[field] = path.join(f.root, 'escape.json'); }) }), { code: 'native_dwg_unaccepted' });
});
test('artifact hash and byte count are checked independently of CLI stdout', async t => {
  const f = await fixture(t); const normal = mockCli();
  for (const tamper of [async options => { await fs.appendFile(options.path, 'changed'); }, async options => {
    const data = JSON.parse(await fs.readFile(options.manifestPath)); data.artifacts['export.json'].bytes++;
    await fs.writeFile(options.manifestPath, JSON.stringify(data));
  }]) {
    await assert.rejects(nativeDwgExport({ ...f.input, runCli: async options => { const result = await normal(options);
      const run = path.join(options.outputRoot, 'native-dwg-' + 'a'.repeat(32));
      await tamper({ path: path.join(run, 'export.json'), manifestPath: path.join(run, 'manifest.json') }); return { ...result, stdout: 'SUCCESS arbitrary.json' }; } }), { code: 'native_dwg_artifact_changed' });
  }
});
test('native mode and console timeout paths require explicit bounded configuration', async t => {
  const f = await fixture(t); assert.equal(dwgExporterMode({}), 'com'); assert.equal(dwgExporterMode({ REVIT_AI_DWG_EXPORTER: 'com' }), 'com');
  assert.throws(() => dwgExporterMode({ REVIT_AI_DWG_EXPORTER: 'auto' }), { code: 'native_dwg_invalid_mode' });
  for (const env of [{ ...f.env, REVIT_AI_DWG_CONSOLE_PATH: '\\\\server\\share\\accoreconsole.exe' },
    { ...f.env, REVIT_AI_DWG_CONSOLE_PATH: 'accoreconsole.exe' },
    { ...f.env, REVIT_AI_DWG_TIMEOUT_SECONDS: '121' }, { ...f.env, REVIT_AI_DWG_TIMEOUT_SECONDS: '0' }])
    await assert.rejects(nativeDwgExport({ ...f.input, env, runCli: () => { throw new Error('Must not start.'); } }));
});
test('abort before start dispatches nothing and abort after start waits for owned CLI completion then rejects with manifest', async t => {
  const f = await fixture(t); const early = new AbortController(); early.abort(); let calls = 0;
  await assert.rejects(nativeDwgExport({ ...f.input, signal: early.signal, runCli: () => { calls++; } })); assert.equal(calls, 0);
  const late = new AbortController(); let cleanupFinished = false;
  const normal = mockCli();
  await assert.rejects(nativeDwgExport({ ...f.input, signal: late.signal, runCli: async options => {
    assert.equal(options.signal, undefined); late.abort(); await new Promise(resolve => setTimeout(resolve, 10));
    const result = await normal(options); cleanupFinished = true; return result;
  } }), error => { assert.equal(cleanupFinished, true); assert.equal(error.code, 'native_dwg_cancelled'); assert.ok(error.details.manifestPath); return true; });
});
test('unknown native entities cannot be silently rewritten as known normalized geometry', async t => {
  const f = await fixture(t);
  await assert.rejects(nativeDwgExport({ ...f.input, runCli: mockCli(({ data }) => { data.entities[1].geometryUnknown = false; }) }), { code: 'native_dwg_invalid_inventory' });
});
test('source mutation and early CLI failure preserve original failure and owned manifest pointers', async t => {
  const f = await fixture(t);
  await assert.rejects(nativeDwgExport({ ...f.input, runCli: mockCli(async () => { await fs.appendFile(f.source, 'modified after initial hash'); }) }), { code: 'native_dwg_source_changed' });
  const normal = mockCli();
  await assert.rejects(nativeDwgExport({ ...f.input, runCli: async options => {
    await normal(options); throw Object.assign(new Error('CLI wait budget ended; cleanup unknown'), { code: 'native_dwg_cleanup_outcome_unknown' });
  } }), asyncError => { assert.equal(asyncError.code, 'native_dwg_cleanup_outcome_unknown'); assert.ok(asyncError.details.manifestPath);
    assert.equal(asyncError.details.cleanupVerified, false); return true; });
});
test('real spawn ENOENT is handled before any await and retains adapter state without starting CAD', async t => {
  const f = await fixture(t); let called = false;
  await assert.rejects(nativeDwgExport({ ...f.input, spawnProcess: (_executable, _args, options) => {
    called = true; assert.equal(options.windowsHide, true); assert.equal(options.shell, false); assert.equal(options.signal, undefined);
    // A nonexistent executable produces the real child-process asynchronous error event.
    return spawn(path.join(f.root, 'intentionally-missing-adapter-test.exe'), [], options);
  } }), error => { assert.equal(error.code, 'ENOENT'); assert.ok(error.details.adapterStatePath); assert.equal(error.details.cleanupVerified, false); return true; });
  assert.equal(called, true);
  const dirs = await fs.readdir(f.env.REVIT_AI_IMPORT_ARTIFACTS_DIR);
  const state = JSON.parse(await fs.readFile(path.join(f.env.REVIT_AI_IMPORT_ARTIFACTS_DIR, dirs[0], 'adapter.json')));
  assert.equal(state.status, 'failed-unaccepted'); assert.equal(state.errorCode, 'ENOENT');
});
test('self-consistent artifact hashes cannot hide native/export identity or LINE coordinate mismatch', async t => {
  const f = await fixture(t);
  for (const change of [({ data }) => { data.entities[0].end.x += 100; },
    ({ data }) => { data.entities[0].layer = 'other'; }, ({ data }) => { data.entities[0].handle = 'CC'; },
    ({ native }) => { native.schemaVersion = 1; }, ({ native }) => { native.scope = 'entire-drawing'; },
    ({ native }) => { native.entities[1].handle = native.entities[0].handle; }])
    await assert.rejects(nativeDwgExport({ ...f.input, runCli: mockCli(change) }), { code: 'native_dwg_invalid_inventory' });
});
test('cancellation during validated artifact reading cannot return accepted candidates', async t => {
  const f = await fixture(t); const controller = new AbortController(); let validationStarted = false;
  await assert.rejects(nativeDwgExport({ ...f.input, signal: controller.signal, runCli: mockCli(), readFile: async file => {
    const bytes = await fs.readFile(file);
    if (path.basename(file) === 'native.json') { validationStarted = true; controller.abort(); }
    return bytes;
  } }), error => { assert.equal(validationStarted, true); assert.equal(error.code, 'native_dwg_cancelled');
    assert.ok(error.details.manifestPath); return true; });
});
test('imports retains default COM branch and uses native only when explicitly configured without fallback', async t => {
  const f = await fixture(t); const oldRoots = process.env.REVIT_AI_IMPORT_ROOTS;
  process.env.REVIT_AI_IMPORT_ROOTS = f.root;
  t.after(() => { if (oldRoots === undefined) delete process.env.REVIT_AI_IMPORT_ROOTS; else process.env.REVIT_AI_IMPORT_ROOTS = oldRoots; });
  let com = 0, native = 0;
  const args = { filePath: f.source, format: 'dwg', calibration, layerMapping: mapping };
  const result = await importInput(args, { env: {}, exec: async (_exe, parameters) => {
    com++; await fs.writeFile(parameters[parameters.indexOf('-OutputPath') + 1], JSON.stringify({ entities: [] }));
  }, nativeDwgExport: async () => { throw new Error('Native must not run.'); } });
  assert.equal(com, 1); assert.equal(result.candidateOnly, true);
  await assert.rejects(importInput(args, { env: f.env, nativeDwgExport: async ({ source }) => { native++; assert.equal(source, await fs.realpath(f.source));
    throw Object.assign(new Error('native timeout'), { code: 'native_dwg_unaccepted' }); }, exec: () => { throw new Error('COM fallback forbidden'); } }), { code: 'native_dwg_unaccepted' });
  assert.equal(native, 1); assert.equal(com, 1);
});
