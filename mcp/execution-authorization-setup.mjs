import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const key = value => process.platform === 'win32' ? value.toLowerCase() : value;
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function localPath(value) {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value) ||
      /^[\\/]{2}/.test(value) || value.includes('\0') || /[*?]/.test(value) ||
      (process.platform === 'win32' && !/^[a-z]:[\\/]/i.test(value)))
    fail('invalid_authorization_path', 'Use an absolute existing local path, without network, device or wildcard scope.');
  return path.resolve(value);
}
async function absent(file) {
  try { await fs.lstat(file); return false; } catch (e) { if (e.code === 'ENOENT') return true; throw e; }
}
async function inspectPaths(paths) {
  const ancestors = new Set();
  for (const file of paths) {
    for (let current = file; ; current = path.dirname(current)) {
      ancestors.add(current);
      if (path.dirname(current) === current) break;
    }
  }
  const existing = [];
  for (const current of ancestors) {
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) fail('authorization_reparse_scope', 'Symbolic links and junctions cannot define authorization scope.');
      existing.push(current);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  // lstat catches symlinks/junctions; Windows attributes additionally catch other reparse tags.
  if (process.platform === 'win32') {
    try {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "$ErrorActionPreference='Stop'; $items=ConvertFrom-Json $env:REVIT_AUTH_SETUP_PATHS; foreach($itemPath in $items){$item=Get-Item -LiteralPath $itemPath -Force; if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse scope refused'}; $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($itemPath)); if($drive.DriveType -in @([IO.DriveType]::Network,[IO.DriveType]::Unknown,[IO.DriveType]::NoRootDirectory)){throw 'Nonlocal drive refused'}}"],
        { env: { ...process.env, REVIT_AUTH_SETUP_PATHS: JSON.stringify(existing) }, windowsHide: true, timeout: 15000, maxBuffer: 2048 });
    } catch { fail('authorization_reparse_scope', 'Local-drive and reparse-point inspection failed; no authorization was created.'); }
  }
}

export async function setupExecutionAuthorization({ repoRoot, documentPaths, userStatement, userAuthorized, policyPath, grantedBy = 'user-chat' } = {}) {
  if (userAuthorized !== true || typeof userStatement !== 'string' || !userStatement.trim() || userStatement.length > 8192)
    fail('explicit_authorization_required', 'Explicit user authorization and the actual nonblank user statement are required.');
  if (!['user-chat', 'user-installation'].includes(grantedBy))
    fail('invalid_authorization_source', 'Authorization source must be user-chat or user-installation.');
  if (!Array.isArray(documentPaths) || !documentPaths.length)
    fail('invalid_authorization_documents', 'At least one specific existing local .rvt file is required.');
  const declaredRoot = localPath(repoRoot);
  const documents = documentPaths.map(localPath);
  if (documents.some(file => path.extname(file).toLowerCase() !== '.rvt'))
    fail('invalid_authorization_documents', 'Only specific .rvt files may be authorized.');
  await inspectPaths([declaredRoot, ...documents]);
  const root = await fs.realpath(declaredRoot);
  if (!(await fs.stat(root)).isDirectory()) fail('invalid_authorization_path', 'Project root must be an existing local directory.');
  const allowedDocuments = [];
  const seen = new Set();
  for (const file of documents) {
    const canonicalPath = await fs.realpath(file);
    if (!(await fs.stat(canonicalPath)).isFile()) fail('invalid_authorization_documents', 'Each document must be an existing regular .rvt file.');
    if (!seen.has(key(canonicalPath))) {
      seen.add(key(canonicalPath)); allowedDocuments.push({ path: canonicalPath, canonicalPath });
    }
  }
  if (allowedDocuments.length > 20) fail('invalid_authorization_documents', 'At most 20 distinct documents may be authorized.');
  let file = policyPath === undefined ? path.join(root, 'runtime', 'execution-authorization.json') : localPath(policyPath);
  await inspectPaths([file, file + '.revoked']);
  // Canonicalize the existing ancestor too (Windows short-name/case aliases may
  // differ from root even though they identify the very same local directory).
  let ancestor = path.dirname(file); const suffix = [path.basename(file)];
  while (await absent(ancestor)) { suffix.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
  file = path.join(await fs.realpath(ancestor), ...suffix);
  const relative = path.relative(root, file);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    fail('invalid_authorization_path', 'Authorization file must be inside the project root.');
  await inspectPaths([root, file, file + '.revoked']);
  if (!await absent(file + '.revoked')) fail('execution_authorization_revoked', 'A revocation marker exists. Reuse, revocation and rotation require a separate explicit workflow.');
  if (!await absent(file)) fail('execution_authorization_exists', 'An authorization already exists. Reuse or rotate it explicitly; it was not overwritten.');
  const grant = { schemaVersion: 1, mode: 'project-authorization', enabled: true,
    authorizationId: randomBytes(16).toString('hex'), grantedBy, grantedAtUtc: new Date().toISOString(),
    userStatement, projectRoot: root, allowedDocuments,
    allowedActions: ['revit.plan.confirm', 'revit.import.commit'], automaticSave: false, automaticRestart: false };
  const bytes = JSON.stringify(grant, null, 2) + '\n';
  if (Buffer.byteLength(bytes) > 32768) fail('invalid_authorization_documents', 'Authorization exceeds the existing runtime policy size limit.');
  // Validate every input before creating directories or touching the grant. Exclusive creation
  // also prevents an existing policy from being replaced by a competing setup invocation.
  await fs.mkdir(path.dirname(file), { recursive: true });
  await inspectPaths([root, file, file + '.revoked']);
  if (!await absent(file + '.revoked')) fail('execution_authorization_revoked', 'Authorization was revoked during setup.');
  try { await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code === 'EEXIST') fail('execution_authorization_exists', 'An authorization already exists; it was not overwritten.'); throw e; }
  return { policyPath: file, grant };
}

async function cli() {
  const options = { repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), documentPaths: [] };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--user-authorized') { if (options.userAuthorized) fail('invalid_setup_arguments', 'Duplicate authorization flag.'); options.userAuthorized = true; continue; }
    if (!['--document', '--user-statement', '--project-root', '--granted-by'].includes(flag) || i + 1 >= args.length || args[i + 1].startsWith('--'))
      fail('invalid_setup_arguments', 'Use --document <absolute.rvt> (repeatable), --user-statement <actual statement>, --user-authorized and optional --project-root <directory> / --granted-by <user-chat|user-installation>.');
    const value = args[++i];
    if (flag === '--document') options.documentPaths.push(value);
    else {
      const property = flag === '--user-statement' ? 'userStatement' : flag === '--granted-by' ? 'grantedBy' : 'repoRoot';
      if (flag === '--user-statement' && options.userStatement !== undefined) fail('invalid_setup_arguments', 'Duplicate user statement.');
      options[property] = value;
    }
  }
  const result = await setupExecutionAuthorization(options);
  process.stdout.write(JSON.stringify({ created: true, policyPath: result.policyPath, documentCount: result.grant.allowedDocuments.length,
    authorizationId: result.grant.authorizationId, automaticSave: false, automaticRestart: false }) + '\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  cli().catch(error => { process.stderr.write(JSON.stringify({ code: error.code ?? 'authorization_setup_failed', message: error.message }) + '\n'); process.exitCode = 1; });
