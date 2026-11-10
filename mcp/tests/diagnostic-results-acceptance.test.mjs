import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {hashRunArtifacts} from '../diagnostic-results-acceptance.mjs';

test('readonly acceptance archive hashes top-level evidence while preserving nested source snapshots',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'diagnostic-archive-'));
 t.after(async()=>{assert.equal(path.dirname(path.resolve(folder)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(folder).startsWith('diagnostic-archive-'));await fs.rm(folder,{recursive:true,force:true});});
 const manifest=JSON.stringify({sourceHashes:{'module.mjs':'separately-bound-source-hash'}});
 await fs.writeFile(path.join(folder,'manifest.json'),manifest);
 await fs.mkdir(path.join(folder,'source-snapshot'));await fs.writeFile(path.join(folder,'source-snapshot/module.mjs'),'immutable source');
 const hashes=await hashRunArtifacts(folder);
 assert.deepEqual(Object.keys(hashes),['manifest.json']);
 assert.equal(hashes['manifest.json'],createHash('sha256').update(manifest).digest('hex'));
 assert.equal(await fs.readFile(path.join(folder,'source-snapshot/module.mjs'),'utf8'),'immutable source');
});
