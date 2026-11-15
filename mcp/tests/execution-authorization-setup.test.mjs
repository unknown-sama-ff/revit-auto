import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setupExecutionAuthorization } from '../execution-authorization-setup.mjs';
import { createExecutionAuthorization } from '../execution-authorization.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'revit-auth-setup-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const model = path.join(root, 'Model.rvt');
  const bytes = Buffer.from('untouched-model-fixture');
  await fs.writeFile(model, bytes);
  return { root, model, bytes, options: { repoRoot: root, documentPaths: [model], userAuthorized: true,
    userStatement: 'I authorize agent review and execution for this exact local test model.' } };
}
async function noGrant(root) { await assert.rejects(fs.access(path.join(root, 'runtime')), { code: 'ENOENT' }); }

test('setup requires actual explicit authorization before any policy I/O', async t => {
  const f = await fixture(t);
  for (const change of [{ userAuthorized: undefined }, { userAuthorized: false }, { userAuthorized: 'true' },
    { userStatement: '' }, { userStatement: '  ' }, { userStatement: 'x'.repeat(8193) }])
    await assert.rejects(setupExecutionAuthorization({ ...f.options, ...change }), { code: 'explicit_authorization_required' });
  await noGrant(f.root);
});
test('setup records installation authorization truthfully and rejects invented sources', async t => {
  const f = await fixture(t);
  await assert.rejects(setupExecutionAuthorization({ ...f.options, grantedBy: 'automatic' }), { code: 'invalid_authorization_source' });
  await noGrant(f.root);
  const result = await setupExecutionAuthorization({ ...f.options, grantedBy: 'user-installation' });
  assert.equal(result.grant.grantedBy, 'user-installation');
  const authorization = await createExecutionAuthorization({ repoRoot: f.root, policyPath: result.policyPath, call: async () => { throw new Error('No native calls'); } });
  assert.equal(authorization.summary().mode, 'project-authorization');
});
test('setup creates exact canonical grant loadable by current authorization service and leaves models untouched', async t => {
  const f = await fixture(t);
  const result = await setupExecutionAuthorization(f.options);
  const grant = JSON.parse(await fs.readFile(result.policyPath, 'utf8'));
  assert.deepEqual(grant, result.grant);
  assert.match(grant.authorizationId, /^[a-f0-9]{32}$/);
  assert.equal(grant.grantedBy, 'user-chat'); assert.ok(Number.isFinite(Date.parse(grant.grantedAtUtc)));
  assert.equal(grant.userStatement, f.options.userStatement);
  assert.equal(grant.projectRoot, await fs.realpath(f.root));
  assert.deepEqual(grant.allowedDocuments, [{ path: await fs.realpath(f.model), canonicalPath: await fs.realpath(f.model) }]);
  assert.deepEqual(grant.allowedActions, ['revit.plan.confirm', 'revit.import.commit']);
  assert.equal(grant.automaticSave, false); assert.equal(grant.automaticRestart, false);
  const authorization = await createExecutionAuthorization({ repoRoot: f.root, policyPath: result.policyPath,
    call: async () => { throw new Error('Setup must not call Revit.'); } });
  assert.equal(authorization.summary().mode, 'project-authorization');
  assert.deepEqual(await fs.readFile(f.model), f.bytes);
});
test('setup deduplicates canonical case and dot aliases', async t => {
  const f = await fixture(t);
  const aliases = [f.model, path.join(f.root, '.', 'Model.rvt'), f.model];
  if (process.platform === 'win32') aliases.push(f.model.toUpperCase());
  const { grant } = await setupExecutionAuthorization({ ...f.options, documentPaths: aliases });
  assert.equal(grant.allowedDocuments.length, 1);
});
test('existing grant is never overwritten or inherited by another setup', async t => {
  const f = await fixture(t); const first = await setupExecutionAuthorization(f.options);
  const original = await fs.readFile(first.policyPath);
  await assert.rejects(setupExecutionAuthorization(f.options), { code: 'execution_authorization_exists' });
  assert.deepEqual(await fs.readFile(first.policyPath), original);
  const other = await fs.mkdtemp(path.join(os.tmpdir(), 'revit-auth-other-'));
  t.after(() => fs.rm(other, { recursive: true, force: true }));
  await assert.rejects(setupExecutionAuthorization({ repoRoot: other, documentPaths: [f.model], userStatement: 'different root' }),
    { code: 'explicit_authorization_required' });
  await noGrant(other);
});
test('revocation marker prevents setup whether or not a grant remains', async t => {
  const f = await fixture(t); const file = path.join(f.root, 'runtime', 'execution-authorization.json');
  await fs.mkdir(path.dirname(file)); await fs.writeFile(file + '.revoked', 'revoked');
  await assert.rejects(setupExecutionAuthorization(f.options), { code: 'execution_authorization_revoked' });
  await fs.writeFile(file, 'previous-grant');
  await assert.rejects(setupExecutionAuthorization(f.options), { code: 'execution_authorization_revoked' });
  assert.equal(await fs.readFile(file, 'utf8'), 'previous-grant');
  assert.equal(await fs.readFile(file + '.revoked', 'utf8'), 'revoked');
});
test('invalid multi-document inputs leave runtime absent and source bytes unchanged', async t => {
  const f = await fixture(t);
  const folder = path.join(f.root, 'folder.rvt'); await fs.mkdir(folder);
  for (const documentPaths of [[], [f.model, path.join(f.root, 'missing.rvt')], [f.model, folder],
    [f.model, path.join(f.root, 'wrong.docx')], [f.model, '\\\\server\\share\\Model.rvt'],
    [f.model, '//server/share/Model.rvt'], [f.model, 'relative.rvt'], [f.model, f.root], [f.model, '']]) {
    await assert.rejects(setupExecutionAuthorization({ ...f.options, documentPaths }));
    await noGrant(f.root); assert.deepEqual(await fs.readFile(f.model), f.bytes);
  }
});
test('more than twenty unique specific documents refuses before creating runtime', async t => {
  const f = await fixture(t); const documents = [];
  for (let i = 0; i < 21; i++) { const file = path.join(f.root, `${i}.rvt`); await fs.writeFile(file, 'fixture'); documents.push(file); }
  await assert.rejects(setupExecutionAuthorization({ ...f.options, documentPaths: documents }), { code: 'invalid_authorization_documents' });
  await noGrant(f.root);
});
test('junction or symbolic ancestor cannot broaden model or policy scope', async t => {
  const f = await fixture(t); const link = path.join(f.root, 'linked');
  await fs.symlink(f.root, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(setupExecutionAuthorization({ ...f.options, documentPaths: [path.join(link, 'Model.rvt')] }), { code: 'authorization_reparse_scope' });
  await assert.rejects(setupExecutionAuthorization({ ...f.options, policyPath: path.join(link, 'grant.json') }), { code: 'authorization_reparse_scope' });
  await noGrant(f.root);
});
test('custom policy destination cannot escape project root', async t => {
  const f = await fixture(t);
  await assert.rejects(setupExecutionAuthorization({ ...f.options, policyPath: path.join(f.root, '..', 'external-policy.json') }), { code: 'invalid_authorization_path' });
  await noGrant(f.root);
});
test('CLI uses only explicit document and user authorization and outputs a compact summary', async t => {
  const f = await fixture(t); const run = promisify(execFile);
  const cli = fileURLToPath(new URL('../execution-authorization-setup.mjs', import.meta.url));
  const args = [cli, '--project-root', f.root, '--document', f.model, '--user-statement', f.options.userStatement];
  await assert.rejects(run(process.execPath, args), error => error.code === 1 && error.stderr.includes('explicit_authorization_required'));
  await noGrant(f.root);
  const { stdout } = await run(process.execPath, [...args, '--user-authorized']);
  const result = JSON.parse(stdout);
  assert.equal(result.created, true); assert.equal(result.documentCount, 1);
  assert.equal(result.policyPath, path.join(await fs.realpath(f.root), 'runtime', 'execution-authorization.json'));
  assert.equal(stdout.includes(f.options.userStatement), false);
  assert.deepEqual(await fs.readFile(f.model), f.bytes);
});
