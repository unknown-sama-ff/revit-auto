import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
test('same-value native parameter operations return no changed IDs instead of an unconditional modification receipt (source contract)',async()=>{
 const executor=await fs.readFile(path.join(root,'v27/ModelExecutor.cs'),'utf8');
 const branch=executor.slice(executor.indexOf('            case "set_parameter":',executor.indexOf('public OperationReceipt Execute')),executor.indexOf('            case "delete_element":',executor.indexOf('public OperationReceipt Execute')));
 assert.match(branch,/var wroteParameter = SetParameter\(/);
 assert.match(branch,/OperationReceipt\.ForParameter\(target\.Id\.Value, parameterName, wroteParameter\)/);
 assert.doesNotMatch(branch,/OperationReceipt\.Modified/);
 const setter=executor.slice(executor.indexOf('    private bool SetParameter'),executor.indexOf('    private static void SetBuiltIn'));
 assert.match(setter,/if \(same\) return false;/);assert.match(setter,/if \(!changed\) throw/);assert.match(setter,/return true;/);
});
