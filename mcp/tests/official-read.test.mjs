import test from 'node:test';
import assert from 'node:assert/strict';
import {readonlyTools} from '../autodesk-read-proxy.mjs';
test('official read guard denies unreviewed tools even if tagged read-only',()=>assert.deepEqual(readonlyTools([{name:'get',annotations:{readOnlyHint:true}}],[]),[]));
test('official read guard denies write tools even when allowlisted',()=>assert.deepEqual(readonlyTools([{name:'delete',annotations:{readOnlyHint:false,destructiveHint:true}}],['delete']),[]));
test('official read guard denies tools without explicit read metadata',()=>assert.deepEqual(readonlyTools([{name:'execute_code'}],['execute_code']),[]));
test('official read guard passes only reviewed read tools',()=>assert.equal(readonlyTools([{name:'query',annotations:{readOnlyHint:true,destructiveHint:false}}],['query']).length,1));
