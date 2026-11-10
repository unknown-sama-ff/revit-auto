import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { auditAcceptanceRun } from './acceptance-archive.mjs';
export { auditAcceptanceRun };
export {
  createPreviewEvidence, createConfirmationEvidence, createAttemptEvidence,
  createExecutionEvidence, describeEvidencePng, createSummaryEvidence
} from './acceptance-evidence.mjs';

export const EXPECTED_ARTIFACTS = [
  'manifest.json',
  'baseline.json',
  'preview.json',
  'confirmation.json',
  'attempt.json',
  'execution.json',
  'readback.json',
  'saved.json',
  'reopen.json',
  'visual.json',
  'visual/',
  'summary.json'
];

const TASK_ID = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function createUuidV7(nowMs = Date.now(), bytes = randomBytes(10)) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > 0xffffffffffff) {
    throw new Error('UUIDv7 timestamp must be a non-negative 48-bit millisecond value.');
  }
  if (!Buffer.isBuffer(bytes) || bytes.length !== 10) {
    throw new Error('UUIDv7 requires exactly 10 random bytes.');
  }

  const uuidBytes = Buffer.alloc(16);
  let timestamp = BigInt(nowMs);
  for (let index = 5; index >= 0; index -= 1) {
    uuidBytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes.copy(uuidBytes, 6);
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x70;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;

  const hex = uuidBytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function loadQueue(repoRoot) {
  const queuePath = path.join(repoRoot, 'docs', 'capability-task-queue.json');
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  if (queue.schemaVersion !== 1 || !Array.isArray(queue.tasks)) {
    throw new Error('Capability task queue has an unsupported schema.');
  }
  return queue;
}

export function createRunScaffold({ repoRoot, taskId, clock = Date.now, idFactory = createUuidV7 }) {
  if (typeof taskId !== 'string' || !TASK_ID.test(taskId)) {
    throw new Error('taskId must be a lowercase queue identifier.');
  }

  const root = path.resolve(repoRoot);
  const task = loadQueue(root).tasks.find((entry) => entry.id === taskId);
  if (!task) throw new Error(`Unknown taskId '${taskId}'. Add it to docs/capability-task-queue.json first.`);

  const nowMs = clock();
  const runId = idFactory(nowMs);
  if (!RUN_ID.test(runId)) throw new Error('The run ID factory must return a UUIDv7.');

  const runsRoot = path.resolve(root, 'acceptance', 'runs');
  const runDirectory = path.resolve(runsRoot, runId);
  if (path.dirname(runDirectory) !== runsRoot) throw new Error('Run directory escaped acceptance/runs.');

  fs.mkdirSync(runsRoot, { recursive: true });
  fs.mkdirSync(runDirectory);

  const manifest = {
    schemaVersion: 1,
    artifactType: 'manifest',
    runId,
    taskId,
    capturedAtUtc: new Date(nowMs).toISOString(),
    status: 'initialized',
    currentStateAtStart: task.currentState,
    expectedArtifacts: EXPECTED_ARTIFACTS,
    repository: { commit: null, dirty: null },
    plugin: null,
    document: null,
    validity: 'current',
    policy: {
      modelWritesRequested: false,
      automaticSave: false,
      automaticRestart: false,
      automaticRetries: false
    }
  };

  const manifestPath = path.join(runDirectory, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return { runId, taskId, runDirectory, manifestPath, manifest };
}

function runCli() {
  const [command, taskId, ...extra] = process.argv.slice(2);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (command === 'audit' && taskId && !extra.length) {
    const report = auditAcceptanceRun({ repoRoot, runId: taskId });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.archiveConsistent) process.exitCode = 1;
    return;
  }
  if (command !== 'init' || !taskId || extra.length) {
    throw new Error('Usage: node mcp/acceptance-run.mjs init <taskId> | audit <runId>');
  }

  const result = createRunScaffold({ repoRoot, taskId });
  process.stdout.write(`${JSON.stringify({ runId: result.runId, taskId, runDirectory: result.runDirectory, manifest: result.manifestPath })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
