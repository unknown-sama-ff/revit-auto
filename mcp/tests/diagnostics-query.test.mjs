import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticsInputSchema, runDiagnosticsWorkflow } from '../diagnostics-query.mjs';
import { getWorkflow } from '../workflow-registry.mjs';

const initial = { active: true, document: { identity: 'doc-a', revision: 0, title:'test',path: 'test.rvt', isModified: false,isReadOnly:false,isFamilyDocument:false } };
function fixture(contexts = [initial]) {
  const calls = []; let index = 0;
  const call = async (method, args,signal,requirements) => { calls.push({ method, args,requirements }); if (method === 'revit.context.get') return structuredClone(contexts[Math.min(index++, contexts.length - 1)]); if (method === 'revit.search') return { items: [{ summary: { id: 101 } }], hasMore: false }; if (method === 'revit.inspect') return { items: [{ summary: { id: 101 } }] }; throw new Error(`Unexpected method ${method}`); };
  return { call, calls };
}

test('diagnostics query is an enabled read-only workflow', () => { const workflow = getWorkflow('diagnostics.query'); assert.equal(workflow.enabled, true); assert.equal(workflow.destructiveLevel, 'read-only'); assert.equal(workflow.operationBuilder, null); });
test('diagnostics schema rejects scripts and requires a query field', () => { assert.equal(diagnosticsInputSchema.safeParse({}).success, false); assert.equal(diagnosticsInputSchema.safeParse({ code: 'unsafe' }).success, false); assert.equal(diagnosticsInputSchema.safeParse({ query: '泵' }).success, true); });
test('ask mode asks before contacting native bridge', async () => { const f = fixture(); const result = await runDiagnosticsWorkflow({ name: 'diagnostics.query', documentIdentity: 'doc-a', planningMode: 'ask', input: { query: '泵' } }, f.call); assert.equal(result.requiresClarification, true); assert.deepEqual(f.calls, []); });
test('explicit diagnostics query pins context, searches and optionally inspects without planning', async () => { const f = fixture(); const result = await runDiagnosticsWorkflow({ name: 'diagnostics.query', documentIdentity: 'doc-a', expectedRevision: 0, planningMode: 'explicit', input: { category: 'OST_MechanicalEquipment', query: '泵', inspectElementIds: [101] } }, f.call); assert.equal(result.readOnly, true); assert.equal(result.planCreated, false); assert.equal(result.documentRevision, 0); assert.deepEqual(f.calls.map(x => x.method), ['revit.context.get', 'revit.search', 'revit.inspect', 'revit.context.get']); assert.equal(f.calls[1].args.category, 'OST_MechanicalEquipment'); });
test('stale revision discards diagnostic evidence without retry', async () => { const f = fixture([initial, { active: true, document: { ...initial.document, revision: 1 } }]); await assert.rejects(runDiagnosticsWorkflow({ name: 'diagnostics.query', documentIdentity: 'doc-a', expectedRevision: 0, planningMode: 'explicit', input: { query: '泵' } }, f.call), error => error.code === 'document_revision_changed'); assert.deepEqual(f.calls.map(x => x.method), ['revit.context.get', 'revit.search', 'revit.context.get']); });

test('both native reads receive the same captured pins and explicit capability requirement',async()=>{
 const f=fixture();await runDiagnosticsWorkflow({documentIdentity:'doc-a',input:{query:'泵',inspectElementIds:[101]}},f.call);
 const target=f.calls.filter(c=>c.method!=='revit.context.get');
 assert.deepEqual(target.map(c=>c.args),[{query:'泵',documentIdentity:'doc-a',expectedRevision:0},{elementIds:[101],documentIdentity:'doc-a',expectedRevision:0}]);
 assert.ok(target.every(c=>c.requirements.requiredFeatures[0]==='readonly-query-pins'));
 assert.equal(f.calls.length,4);
});
test('malformed state and family documents are refused before search or inspect',async()=>{
 for(const [edit,code] of [[d=>delete d.isModified,'diagnostics_context_invalid'],[d=>delete d.isReadOnly,'diagnostics_context_invalid'],
  [d=>delete d.isFamilyDocument,'diagnostics_context_invalid'],[d=>d.isFamilyDocument=true,'project_required']]){
  const c=structuredClone(initial);edit(c.document);const f=fixture([c]);
  await assert.rejects(runDiagnosticsWorkflow({documentIdentity:'doc-a',input:{inspectElementIds:[101]}},f.call),{code});
  assert.deepEqual(f.calls.map(c=>c.method),['revit.context.get']);
 }
});
test('path saved readonly and title drift discard the report without extra queries',async()=>{
 for(const edit of [d=>d.path='other.rvt',d=>d.isModified=true,d=>d.isReadOnly=true,d=>d.title='renamed']){
  const next=structuredClone(initial);edit(next.document);const f=fixture([initial,next]);
  await assert.rejects(runDiagnosticsWorkflow({documentIdentity:'doc-a',input:{query:'泵'}},f.call),{code:'diagnostics_state_changed'});
  assert.equal(f.calls.length,3);
 }
});
test('cancellation and native errors do not issue another target read or retry',async()=>{
 const ac=new AbortController(),calls=[];
 await assert.rejects(runDiagnosticsWorkflow({documentIdentity:'doc-a',input:{query:'泵',inspectElementIds:[101]}},async m=>{
  calls.push(m);if(m==='revit.context.get')return initial;ac.abort();return {items:[]};
 },ac.signal));assert.deepEqual(calls,['revit.context.get','revit.search']);
 calls.length=0;await assert.rejects(runDiagnosticsWorkflow({documentIdentity:'doc-a',input:{query:'泵'}},async m=>{
  calls.push(m);if(m==='revit.context.get')return initial;throw Object.assign(new Error('native pin refused'),{code:'document_changed'});
 }),{code:'document_changed'});assert.deepEqual(calls,['revit.context.get','revit.search']);
});
test('ported spelling hints reject unknown diagnostic keys before native access and omit values',async()=>{
 const f=fixture();await assert.rejects(runDiagnosticsWorkflow({documentIdentity:'doc-a',input:{inspect_element_ids:['PRIVATE-VALUE']}},f.call),e=>{
  assert.equal(e.code,'invalid_diagnostics_input');
  assert.equal(e.details.invalid_arguments.unknown[0].did_you_mean,'inspectElementIds');
  assert.ok(!JSON.stringify(e.details).includes('PRIVATE-VALUE'));return true;
 });assert.deepEqual(f.calls,[]);
});
test('an explicit revision inside input remains binding when workflow revision is omitted',async()=>{
 const f=fixture();await assert.rejects(runDiagnosticsWorkflow({documentIdentity:'doc-a',input:{query:'泵',expectedRevision:2}},f.call),{code:'document_revision_changed'});
 assert.deepEqual(f.calls.map(c=>c.method),['revit.context.get']);
});
