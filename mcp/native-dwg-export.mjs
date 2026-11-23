import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const MAX_BYTES = 20 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
function failure(code, message, details = {}) { return Object.assign(new Error(message), { code, details }); }
function local(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /^[\\/]{2}/.test(value) || /[\x00-\x1f"*?]/.test(value) ||
      (process.platform === 'win32' && !/^[a-z]:[\\/]/i.test(value))) throw failure('native_dwg_invalid_path', `${label} must be an absolute local path.`);
  return path.resolve(value);
}
async function noLinks(file) {
  for (let current = file; ; current = path.dirname(current)) {
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw failure('native_dwg_invalid_path', 'Symbolic or junction paths are not allowed.'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (path.dirname(current) === current) break;
  }
}
async function regular(file, maximum = MAX_BYTES, readFile = fs.readFile) {
  await noLinks(file); const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > maximum) throw failure('native_dwg_invalid_artifact', 'Required native artifact is not a bounded regular file.');
  return readFile(file);
}
const json = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));

// The CLI owns its Core Console PID/start time and cleanup. Never pass an AbortSignal,
// exec timeout or output-buffer kill to the PowerShell process that owns that cleanup.
async function runNativeCli({ script, source, consolePath, outputRoot, timeoutSeconds, adapterDirectory, spawnProcess = spawn }) {
  const stdoutPath = path.join(adapterDirectory, 'cli.stdout.log'), stderrPath = path.join(adapterDirectory, 'cli.stderr.log');
  const stdout = await fs.open(stdoutPath, 'wx');
  let stderr;
  let child;
  try {
    stderr = await fs.open(stderrPath, 'wx');
    // Drive letters can represent mapped network drives. Check native drive type and
    // all reparse tags before dispatching the unchanged CLI, using data in an env JSON
    // value rather than interpolating any source/executable path into PowerShell code.
    const command = "$ErrorActionPreference='Stop'; try {$p=ConvertFrom-Json $env:REVIT_AI_DWG_NATIVE_ARGUMENTS; foreach($itemPath in @($p.source,$p.consolePath,$p.outputRoot,$p.script)) {$drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($itemPath)); if($drive.DriveType -in @([IO.DriveType]::Network,[IO.DriveType]::Unknown,[IO.DriveType]::NoRootDirectory)){throw 'Nonlocal native DWG path refused'}; $current=$itemPath; while($current){if(Test-Path -LiteralPath $current){$item=Get-Item -LiteralPath $current -Force; if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse native DWG path refused'}}; $parent=[IO.Path]::GetDirectoryName($current); if($parent -eq $current){break}; $current=$parent}}; & $p.script -SourcePath $p.source -ConsolePath $p.consolePath -OutputDirectory $p.outputRoot -TimeoutSeconds $p.timeoutSeconds; if($LASTEXITCODE){exit $LASTEXITCODE}} catch {Write-Error $_ -ErrorAction Continue; exit 1}";
    child = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, shell: false, stdio: ['ignore', stdout.fd, stderr.fd],
        env: { ...process.env, REVIT_AI_DWG_NATIVE_ARGUMENTS: JSON.stringify({ script, source, consolePath, outputRoot, timeoutSeconds }) } });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
      // This is a wait limit, not permission to kill an unverified native process.
      // Leave ownership cleanup with the CLI and retain all logs/artifacts.
      child.unref();
      reject(failure('native_dwg_cleanup_outcome_unknown', 'CLI did not finish its watchdog/cleanup budget. Inspect retained artifacts; no fallback or retry was attempted.',
        { cliPid: child.pid, cleanupVerified: false, stdoutPath, stderrPath }));
      }, (timeoutSeconds + 60) * 1000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', (exitCode, exitSignal) => { clearTimeout(timer); resolve({ exitCode, exitSignal, cliPid: child.pid }); });
    });
  } finally { await stdout.close(); await stderr?.close(); }
}

export function dwgExporterMode(env = process.env) {
  const mode = env.REVIT_AI_DWG_EXPORTER || 'com';
  if (!['com', 'native-console'].includes(mode)) throw failure('native_dwg_invalid_mode', 'REVIT_AI_DWG_EXPORTER must be com or native-console.');
  return mode;
}

export async function nativeDwgExport({ source, repoRoot, signal, env = process.env, runCli = runNativeCli, spawnProcess = spawn, readFile = fs.readFile }) {
  const read = (file, maximum) => regular(file, maximum, readFile);
  signal?.throwIfAborted();
  if (dwgExporterMode(env) !== 'native-console') throw failure('native_dwg_not_selected', 'Native Console export must be explicitly selected.');
  const root = await fs.realpath(local(repoRoot, 'Package root'));
  source = local(source, 'Resolved DWG source');
  if (path.extname(source).toLowerCase() !== '.dwg') throw failure('native_dwg_invalid_path', 'Native export accepts a resolved .dwg source only.');
  const before = await read(source); const sourceSha = hash(before);
  const consolePath = local(env.REVIT_AI_DWG_CONSOLE_PATH, 'REVIT_AI_DWG_CONSOLE_PATH');
  if (path.basename(consolePath).toLowerCase() !== 'accoreconsole.exe') throw failure('native_dwg_invalid_path', 'Explicit console must be accoreconsole.exe.');
  const executableSha = hash(await read(consolePath, 256 * 1024 * 1024));
  const script = path.join(root, 'tools', 'export-dwg-native.ps1');
  const lisp = path.join(root, 'tools', 'native-dwg-readonly.lsp');
  await read(script); const lispSha = hash(await read(lisp));
  const timeoutSeconds = env.REVIT_AI_DWG_TIMEOUT_SECONDS === undefined ? 120 : Number(env.REVIT_AI_DWG_TIMEOUT_SECONDS);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 120) throw failure('native_dwg_invalid_timeout', 'Native DWG timeout must be 1..120 seconds.');
  const artifacts = local(env.REVIT_AI_IMPORT_ARTIFACTS_DIR || path.join(root, 'imports'), 'Import artifact directory');
  await noLinks(artifacts); await fs.mkdir(artifacts, { recursive: true }); await noLinks(artifacts);
  const artifactRoot = await fs.realpath(artifacts);
  const adapterDirectory = await fs.mkdtemp(path.join(artifactRoot, 'native-console-'));
  const outputRoot = path.join(adapterDirectory, 'runs'); await fs.mkdir(outputRoot);
  const statePath = path.join(adapterDirectory, 'adapter.json');
  const state = { schemaVersion: 1, status: 'starting', source, sourceSha256: sourceSha, timeoutSeconds,
    outputRoot, manifestPath: null, cleanupVerified: false, saveRequested: false, modelWriteRequested: false };
  const save = () => fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
  await save();
  let aborted = signal?.aborted === true;
  const onAbort = () => { aborted = true; };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    signal?.throwIfAborted();
    const result = await runCli({ script, source, consolePath, outputRoot, timeoutSeconds, adapterDirectory, spawnProcess });
    state.cliExitCode = result.exitCode; state.cliPid = result.cliPid ?? null;
    const children = await fs.readdir(outputRoot, { withFileTypes: true });
    if (children.length !== 1 || !children[0].isDirectory() || !/^native-dwg-[a-f0-9]{32}$/i.test(children[0].name))
      throw failure('native_dwg_invalid_manifest', 'Expected exactly one owned native run directory.');
    const run = path.join(outputRoot, children[0].name); await noLinks(run);
    const manifestPath = path.join(run, 'manifest.json'); state.manifestPath = manifestPath;
    const manifest = json(await read(manifestPath, 1024 * 1024));
    if (aborted) throw failure('native_dwg_cancelled', 'Import cancelled after waiting for the CLI watchdog/cleanup. Inspect the retained manifest; no candidate data was accepted.');
    const exportPath = path.join(run, 'export.json'), copyPath = path.join(run, 'source.dwg');
    const equalHash = value => typeof value === 'string' && value.toLowerCase() === sourceSha;
    if (result.exitCode !== 0 || result.exitSignal || manifest.schemaVersion !== 1 ||
        manifest.status !== 'scoped-export-complete-review-logs' || manifest.consoleExitCode !== 0 || manifest.timedOut !== false ||
        manifest.saveRequested !== false || manifest.modelWriteRequested !== false || manifest.failure || manifest.cleanupFailure || manifest.integrityFailure ||
        !Number.isSafeInteger(manifest.ownedPid) || manifest.ownedPid <= 0 || !Number.isFinite(Date.parse(manifest.ownedStartTimeUtc)) ||
        !Number.isFinite(Date.parse(manifest.finishedUtc)) || manifest.timeoutSeconds !== timeoutSeconds ||
        typeof manifest.source !== 'string' || !samePath(manifest.source, source) ||
        typeof manifest.sourceCopy !== 'string' || !samePath(manifest.sourceCopy, copyPath) ||
        typeof manifest.exportPath !== 'string' || !samePath(manifest.exportPath, exportPath) ||
        typeof manifest.executable !== 'string' || !samePath(manifest.executable, consolePath) ||
        manifest.executableSha256?.toLowerCase() !== executableSha || manifest.lispSha256?.toLowerCase() !== lispSha ||
        !equalHash(manifest.sourceSha256Before) || !equalHash(manifest.sourceSha256After) || !equalHash(manifest.copySha256After))
      throw failure('native_dwg_unaccepted', 'Native CLI failed or its completed safety/integrity manifest is not acceptable.');
    if (hash(await read(source)) !== sourceSha || hash(await read(copyPath)) !== sourceSha)
      throw failure('native_dwg_source_changed', 'Source or owned DWG copy differs from the permitted hashed input.');
    for (const name of ['native.json', 'export.json', 'stdout.log', 'stderr.log', 'extract.scr', 'console.decoded.log']) {
      const bytes = await read(path.join(run, name)); const recorded = manifest.artifacts?.[name];
      if (!recorded || recorded.bytes !== bytes.length || recorded.sha256?.toLowerCase() !== hash(bytes))
        throw failure('native_dwg_artifact_changed', 'A fixed native artifact is missing, oversized or has changed bytes/hash.');
    }
    const data = json(await read(exportPath)); const extraction = data?.extraction;
    const native = json(await read(path.join(run, 'native.json')));
    if (data.document !== path.basename(source) || !Array.isArray(data.entities) || data.entities.length < 1 || data.entities.length > 10000 ||
        !extraction || !equalHash(extraction.sourceSha256) || extraction.readOnly !== true || extraction.modelUploaded !== false ||
        extraction.sourceCopyMatched !== true || extraction.modifiedStateBefore !== 0 || extraction.modifiedStateAfter !== 0 ||
        extraction.entityCountBefore !== data.entities.length || extraction.entityCountAfter !== data.entities.length ||
        extraction.scope !== 'selected-ModelSpace-main-graphical-entities' || extraction.wholeDrawingDecodeAccepted !== false ||
        extraction.designScaleVerified !== false || extraction.exactPersistenceVerified !== false ||
        native.schemaVersion !== 2 || native.scope !== extraction.scope || native.wholeDrawingDecodeAccepted !== false ||
        native.entireDatabaseInventoryComplete !== false || native.designScaleVerified !== false ||
        native.dbmodBefore !== 0 || native.dbmodAfter !== 0 || native.saveRequested !== false || native.readOnlyRequested !== true ||
        native.selectionHandlesStable !== true || native.selectionCount !== data.entities.length || native.selectionCountAfter !== data.entities.length ||
        native.modelSpaceEntityCount !== data.entities.length || !Array.isArray(native.entities) || native.entities.length !== data.entities.length)
      throw failure('native_dwg_invalid_inventory', 'Normalized/native scope, modified-state or count evidence is incomplete.');
    const nativeEntities = new Map();
    for (const entity of native.entities) {
      if (typeof entity.handle !== 'string' || !/^[a-f0-9]+$/i.test(entity.handle) || nativeEntities.has(entity.handle.toUpperCase()) ||
          typeof entity.type !== 'string' || typeof entity.layer !== 'string')
        throw failure('native_dwg_invalid_inventory', 'Native entity identity is invalid or duplicated.');
      nativeEntities.set(entity.handle.toUpperCase(), entity);
    }
    let lines = 0; const handles = new Set();
    for (const entity of data.entities) {
      if (typeof entity.handle !== 'string' || !/^[a-f0-9]+$/i.test(entity.handle) || handles.has(entity.handle.toUpperCase()) ||
          typeof entity.layer !== 'string' || typeof entity.nativeType !== 'string') throw failure('native_dwg_invalid_inventory', 'Native entity identity is invalid or duplicated.');
      handles.add(entity.handle.toUpperCase());
      const original = nativeEntities.get(entity.handle.toUpperCase());
      if (!original || original.type !== entity.nativeType || original.layer !== entity.layer)
        throw failure('native_dwg_invalid_inventory', 'Normalized entity identity/type/layer differs from the retained native inventory.');
      if (entity.nativeType === 'LINE') {
        lines++;
        if (entity.objectName !== 'AcDbLine' || entity.coordinateSpace !== 'native-world-xyz' || entity.geometryUnknown === true ||
            original.coordinateSpace !== 'native-world-xyz' ||
            !['start', 'end'].every(name => entity[name] && Array.isArray(original[name]) && original[name].length === 3 &&
              ['x', 'y', 'z'].every((axis, index) => typeof entity[name][axis] === 'number' && Number.isFinite(entity[name][axis]) && entity[name][axis] === original[name][index])))
          throw failure('native_dwg_invalid_inventory', 'LINE must retain complete native world XYZ.');
      } else if (original.geometryUnknown !== true || entity.geometryUnknown !== true || entity.objectName !== 'UnknownNativeGeometry' || entity.start || entity.end || entity.insertion || entity.coordinates)
        throw failure('native_dwg_invalid_inventory', 'Unsupported native geometry must remain explicitly unknown.');
    }
    if (extraction.lineGeometryCount !== lines || extraction.unsupportedGeometryCount !== data.entities.length - lines ||
        native.lineGeometryCount !== lines || native.unsupportedGeometryCount !== data.entities.length - lines)
      throw failure('native_dwg_invalid_inventory', 'Known/unknown geometry ledger differs from the normalized inventory.');
    if (aborted) throw failure('native_dwg_cancelled', 'Import cancelled after native cleanup; retained artifacts are not candidate acceptance.');
    state.status = 'accepted-scoped-candidate-source'; state.cleanupVerified = true; await save();
    return { document: data.document, entities: data.entities,
      extraction: { ...extraction, exporter: 'native-console', manifestPath, adapterStatePath: statePath } };
  } catch (error) {
    // An early CLI failure or exhausted adapter wait can still have a useful failed
    // manifest. Discover only the fixed filename in this invocation's fresh root.
    if (!state.manifestPath) {
      try {
        const runs = await fs.readdir(outputRoot, { withFileTypes: true });
        if (runs.length === 1 && runs[0].isDirectory() && /^native-dwg-[a-f0-9]{32}$/i.test(runs[0].name)) {
          const candidate = path.join(outputRoot, runs[0].name, 'manifest.json');
          await noLinks(candidate); if ((await fs.stat(candidate)).isFile()) state.manifestPath = candidate;
        }
      } catch { /* The adapter state/output-root pointer remains useful when no manifest exists. */ }
    }
    state.status = aborted ? 'cancelled-unaccepted' : 'failed-unaccepted'; state.errorCode = error.code ?? 'native_dwg_export_failed';
    state.message = error.message; await save();
    throw failure(aborted ? 'native_dwg_cancelled' : state.errorCode, error.message,
      { ...error.details, artifactDirectory: adapterDirectory, adapterStatePath: statePath, manifestPath: state.manifestPath, cleanupVerified: false });
  } finally { signal?.removeEventListener('abort', onAbort); }
}
