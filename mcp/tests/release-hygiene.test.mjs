import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const tracked = execFileSync('git', ['ls-files', '-z'], {cwd: root}).toString().split('\0').filter(Boolean);


test('private model, family, runtime and generated manifest files are not tracked', () => {
  const forbidden = tracked.filter(file => /(^|\/)(runtime|acceptance)\//i.test(file)
    || /(^|\/)families\/library\.json$/i.test(file)
    || /\.(rvt|rfa|rte|dwg|bak|slog|addin)$/i.test(file)
    || /(^|\/)bridge\.json$/i.test(file)
    || /^(audit|preflight)\.json$/i.test(file));
  assert.deepEqual(forbidden, []);
});

test('new runtime deployment code has no developer-specific paths', () => {
  // Legacy 2025 scripts remain independent fallback assets, not portable 2027 entry points.
  const files = ['v27/RevitAutoV27.csproj', 'v27/deployment.ps1', 'build-v27.ps1', 'install-v27.ps1'];
  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /[A-Za-z]:\\/i, file);
  }
});
test('tracked installer template is portable and deployment helper is present', () => {
  assert.ok(tracked.includes('v27/RevitAutoV27.addin.example'));
  assert.ok(tracked.includes('v27/deployment.ps1'));
  const template = fs.readFileSync(path.join(root, 'v27/RevitAutoV27.addin.example'), 'utf8');
  assert.doesNotMatch(template, /[A-Za-z]:\\/);
  assert.doesNotMatch(template, /runtime|bridge\.json/i);
});

test('CI validates the same public test entry points used locally', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/validate.yml'), 'utf8');
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /dotnet run --project tests\/CoreTests\/CoreTests\.csproj/);
  assert.match(workflow, /release-hygiene\.test\.mjs/);
});
