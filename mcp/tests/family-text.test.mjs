import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {familyTextRequestSchema,familyTextResponseSchema,readFamilyText} from '../family-text.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const input={documentIdentity:'family-session',expectedRevision:0,familyName:'THS-A1'};
const document={title:'THS-A1',path:'THS-A1.rfa',identity:'family-session',revision:0,isModified:false,isReadOnly:false,isFamilyDocument:true};
const context={active:true,document};
const known=value=>({supported:true,value});
const unknown=()=>({supported:false,value:null,reason:'native_value_unavailable'});
const xyz=(xMm,yMm,zMm)=>({xMm,yMm,zMm});
const note=(id=1,text='说明\nNotes')=>({id,uniqueId:'note-'+id,ownerViewId:2,typeId:3,
 text:{supported:true,complete:true,value:text,originalLength:text.length,truncated:false},
 coord:known(xyz(10,20,0)),widthMm:known(100),heightMm:known(10),
 bounds:known({min:xyz(10,10,0),max:xyz(110,20,0),origin:xyz(0,0,0),
  basisX:{x:1,y:0,z:0},basisY:{x:0,y:1,z:0},basisZ:{x:0,y:0,z:1}}),
 typeFont:known('宋体'),typeTextSizeMm:known(2.5),typeWidthFactor:known(1)});
const report=()=>({documentIdentity:input.documentIdentity,documentRevision:0,document:structuredClone(document),
 family:{name:'THS-A1',uniqueId:'family-owner',categoryId:-2000280},notes:[note()],totalCount:1,returnedCount:1,
 truncated:false,complete:true,textCharacterBudgetUsed:note().text.value.length,selectionOrder:'native subset sorted by ID',
 coordinateUnits:'family-document mm / sheet mm',fontScope:'TextNoteType defaults only',coverage:'TextNote only',
 readOnly:true,planCreated:false,modelWritesRequested:false,automaticSave:false,documentOpened:false,documentClosed:false,
 familyLoaded:false,projectAssociationVerified:false,visualAccepted:false,allModelSideEffectsVerified:false});
const mutate=(v,change)=>{const c=structuredClone(v);change(c);return c;};

test('family text input requires exact pins bounded count and no path or executable payload',()=>{
 assert.deepEqual(familyTextRequestSchema.parse(input),input);
 for(const v of [{...input,path:'a.rfa'},{...input,code:'anything'},{...input,expectedRevision:undefined},
  {...input,expectedRevision:-1},{...input,expectedRevision:Number.MAX_SAFE_INTEGER+1},{...input,familyName:' '},
  {...input,maxNotes:0},{...input,maxNotes:101},{...input,maxNotes:1.5}])assert.equal(familyTextRequestSchema.safeParse(v).success,false);
});

test('family text page and view selectors are explicit safe IDs without coercion',()=>{
 assert.equal(familyTextRequestSchema.safeParse({...input,afterNoteId:0,boundsViewId:2}).success,true);
 for(const key of ['afterNoteId','boundsViewId'])for(const value of [null,'2',true,-1,1.5,Number.MAX_SAFE_INTEGER+1,...(key==='boundsViewId'?[0]:[])])
  assert.equal(familyTextRequestSchema.safeParse({...input,[key]:value}).success,false);
});

const pagedReport=()=>{
 const r=report();r.notes=[note(101),note(102)];r.totalCount=110;r.returnedCount=2;r.complete=false;r.truncated=true;r.textCharacterBudgetUsed*=2;
 r.page={afterNoteId:100,skippedCount:100,remainingCount:8,nextAfterNoteId:102};return r;
};
test('family text page counts order cursor and missing or unsolicited page evidence are checked',async()=>{
 const request={...input,afterNoteId:100,maxNotes:2},r=pagedReport();
 const call=report=>async m=>m==='revit.context.get'?context:report;
 assert.deepEqual(await readFamilyText(request,call(r)),r);
 for(const edit of [r=>r.page.skippedCount++,r=>r.page.afterNoteId=99,r=>r.page.nextAfterNoteId=101,
  r=>r.notes.reverse(),r=>r.notes[0].id=100,r=>delete r.page])
  await assert.rejects(readFamilyText(request,call(mutate(r,edit))),{code:'family_text_response_invalid'});
 await assert.rejects(readFamilyText(input,call(r)),{code:'family_text_response_invalid'});
 const last=report();last.notes=[];last.totalCount=110;last.returnedCount=last.textCharacterBudgetUsed=0;last.complete=false;last.truncated=true;
 last.page={afterNoteId:110,skippedCount:110,remainingCount:0,nextAfterNoteId:null};
 assert.deepEqual(await readFamilyText({...input,afterNoteId:110},call(last)),last);
 assert.equal(familyTextResponseSchema.safeParse(mutate(last,r=>delete r.page.nextAfterNoteId)).success,false);
});

test('family text explicit view bounds never replace model bounds or borrow another owner view',async()=>{
 const r=report();r.notes[0].bounds=unknown();r.notes[0].viewBounds=known(note().bounds.value);
 r.boundsView={id:2,uniqueId:'view-2',name:'Front',viewType:'Elevation'};
 const request={...input,boundsViewId:2},call=r=>async m=>m==='revit.context.get'?context:r;
 assert.deepEqual(await readFamilyText(request,call(r)),r);
 for(const edit of [r=>delete r.boundsView,r=>delete r.notes[0].viewBounds,r=>r.boundsView.id=4,r=>r.notes[0].ownerViewId=3])
  await assert.rejects(readFamilyText(request,call(mutate(r,edit))),{code:'family_text_response_invalid'});
 const other=mutate(r,r=>{r.notes[0].ownerViewId=3;r.notes[0].viewBounds={supported:false,value:null,reason:'note_not_owned_by_bounds_view'};});
 assert.deepEqual(await readFamilyText(request,call(other)),other);
 await assert.rejects(readFamilyText(input,call(r)),{code:'family_text_response_invalid'});
});
test('family text preserves plaintext geometry and type defaults with exactly one native query',async()=>{
 const calls=[],raw=report(),original=structuredClone(raw);
 const r=await readFamilyText(input,async(m,a)=>{calls.push({m,a});return m==='revit.context.get'?context:raw;});
 assert.deepEqual(r,original);assert.deepEqual(raw,original);
 assert.deepEqual(calls.map(c=>c.m),['revit.context.get','revit.family.text_notes','revit.context.get']);
 assert.deepEqual(calls[1].a,input);
});
test('known-empty family owner requires a title and preserves blank native evidence',async()=>{
 const request={...input,familyName:'',familyDocumentTitle:document.title};
 assert.equal(familyTextRequestSchema.safeParse({...input,familyName:''}).success,false);
 assert.equal(familyTextRequestSchema.safeParse({...request,familyDocumentTitle:' '}).success,false);
 const c={...structuredClone(context),familyDocumentScope:{ownerFamilyAvailable:true,documentTitle:document.title,familyName:'',categoryId:-2000280}};
 const r=report();r.family.name='';
 assert.deepEqual(await readFamilyText(request,async m=>m==='revit.context.get'?c:r),r);
 for(const change of [v=>v.familyDocumentScope.familyName=null,v=>v.familyDocumentScope.categoryId=-2000150,
  v=>v.familyDocumentScope.ownerFamilyAvailable=false,v=>v.document.title='other.rfa',v=>delete v.familyDocumentScope]){
  const calls=[];await assert.rejects(readFamilyText(request,async m=>{calls.push(m);return mutate(c,change);}),{code:'family_text_scope_mismatch'});
  assert.deepEqual(calls,['revit.context.get']);
 }
 await assert.rejects(readFamilyText(request,async m=>m==='revit.context.get'?c:mutate(r,v=>v.document.title='other.rfa')),{code:'family_text_scope_mismatch'});
});
test('family text keeps unknown empty partial text and collection completeness independent',()=>{
 const r=report();r.notes=[note(1,''),note(2,''),note(3,'😀')];
 r.notes[1].text={supported:false,complete:false,value:null,originalLength:null,truncated:false,reason:'unavailable'};
 r.notes[1].typeFont=unknown();r.notes[1].bounds=unknown();
 r.notes[2].text={supported:true,complete:false,value:'😀',originalLength:5,truncated:true};
 r.totalCount=r.returnedCount=3;r.textCharacterBudgetUsed=2;
 assert.deepEqual(familyTextResponseSchema.parse(r),r);
 r.totalCount=4;r.complete=false;r.truncated=true;assert.deepEqual(familyTextResponseSchema.parse(r),r);
 r.notes=[];r.totalCount=r.returnedCount=r.textCharacterBudgetUsed=0;r.complete=true;r.truncated=false;
 assert.equal(familyTextResponseSchema.safeParse(r).success,true);
});
test('family text rejects malformed geometry fonts unknown fields and overstated completeness',()=>{
 const changes=[r=>r.notes.push(note()),r=>r.notes[0].id=0,r=>r.notes[0].typeId=-1,
  r=>r.notes[0].coord.value.xMm=Infinity,r=>r.notes[0].bounds.value.min.xMm=1000,
  r=>r.notes[0].typeTextSizeMm.value=0,r=>r.notes[0].typeFont.value='',r=>r.notes[0].typeWidthFactor.value=-1,
  r=>r.notes[0].heightMm.value=-1,r=>r.notes[0].typeFont={supported:false,value:'',reason:'unavailable'},
  r=>r.notes[0].text.complete=false,r=>r.notes[0].text.value='\ud83d',r=>r.notes[0].text.originalLength=-1,
  r=>r.notes[0].text={supported:false,complete:true,value:null,originalLength:null,truncated:false,reason:'x'},
  r=>r.textCharacterBudgetUsed++,r=>r.complete=false,r=>r.totalCount=0,
  r=>r.document.identity='other',r=>r.document.isFamilyDocument=false,r=>r.notes[0].script='anything',
  ...['planCreated','modelWritesRequested','automaticSave','documentOpened','documentClosed','familyLoaded',
   'projectAssociationVerified','visualAccepted','allModelSideEffectsVerified'].map(k=>r=>r[k]=true)];
 for(const edit of changes)assert.equal(familyTextResponseSchema.safeParse(mutate(report(),edit)).success,false);
});
test('family text refuses project document wrong identity and revision before querying notes',async()=>{
 for(const [change,code] of [[d=>d.isFamilyDocument=false,'family_document_required'],[d=>d.identity='other','document_changed'],
  [d=>d.revision=1,'document_revision_changed']]){
  const calls=[];await assert.rejects(readFamilyText(input,async m=>{calls.push(m);return mutate(context,c=>change(c.document));}),{code});
  assert.deepEqual(calls,['revit.context.get']);
 }
});
test('family text rejects mismatched scope report state and later context changes',async()=>{
 for(const [edit,code] of [[r=>r.family.name='other','family_text_scope_mismatch'],[r=>r.family.categoryId=-2000011,'family_text_scope_mismatch'],
  [r=>r.documentIdentity='other','document_changed'],[r=>r.documentRevision=1,'document_revision_changed'],
  [r=>r.document.isModified=true,'family_text_state_changed'],[r=>r.document.path='other.rfa','family_text_state_changed'],
  [r=>r.document.isReadOnly=true,'family_text_state_changed'],[r=>r.notes[0].coord=unknown(),'ok']]){
  const call=async m=>m==='revit.context.get'?context:mutate(report(),edit);
  if(code==='ok')await readFamilyText(input,call);else await assert.rejects(readFamilyText(input,call),{code});
 }
 for(const change of [d=>d.path='other.rfa',d=>d.isModified=true,d=>d.isReadOnly=true]){
  let reads=0;await assert.rejects(readFamilyText(input,async m=>m==='revit.family.text_notes'?report():
   ++reads===1?context:mutate(context,c=>change(c.document))),{code:'family_text_state_changed'});
 }
});
test('family text enforces requested count shared character budget and bytes',async()=>{
 const r=report();r.notes=[note(1),note(2)];r.totalCount=r.returnedCount=2;r.textCharacterBudgetUsed*=2;
 await assert.rejects(readFamilyText({...input,maxNotes:1},async m=>m==='revit.context.get'?context:r),{code:'family_text_response_invalid'});
 r.notes=Array.from({length:9},(_,i)=>note(i+1,'中'.repeat(2048)));r.totalCount=r.returnedCount=9;r.textCharacterBudgetUsed=18432;
 assert.equal(familyTextResponseSchema.safeParse(r).success,false);
 await assert.rejects(readFamilyText(input,async m=>m==='revit.context.get'?context:{...report(),oversized:'中'.repeat(180000)}),{code:'family_text_response_invalid'});
});
test('family text cancellation timeout and native errors never retry or open documents',async()=>{
 const ac=new AbortController();ac.abort();let calls=[];
 await assert.rejects(readFamilyText(input,async m=>calls.push(m),ac.signal));assert.deepEqual(calls,[]);
 for(const code of ['family_text_timeout','native_error']){
  calls=[];await assert.rejects(readFamilyText(input,async m=>{calls.push(m);if(m==='revit.context.get')return context;throw Object.assign(new Error(code),{code});}),{code});
  assert.deepEqual(calls,['revit.context.get','revit.family.text_notes']);
 }
 const during=new AbortController();calls=[];
 await assert.rejects(readFamilyText(input,async m=>{calls.push(m);if(m==='revit.context.get')return context;during.abort();return report();},during.signal));
 assert.deepEqual(calls,['revit.context.get','revit.family.text_notes']);
});

async function sdk(t,{old=false,nativeScopeError=false,knownEmpty=false,emptyOwnerFeature=true,pageFeature=true}={}){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'family-text-sdk-')),token='family-text-test-token-'.repeat(4),requests=[],sockets=new Set();
 const plugin={protocol:'revit-auto-2027-v2',version:'0.4.0',moduleVersionId:'11111111-2222-4333-8444-555555555555',
  features:old?['readonly-query-pins']:['readonly-query-pins','family-text-notes',...(emptyOwnerFeature?['family-text-known-empty-owner']:[]),...(pageFeature?['family-text-pagination-view-bounds']:[])],confirmationMode:'chat'};
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';
  socket.on('data',chunk=>{buffer+=chunk.toString('utf8');if(!buffer.includes('\n'))return;
   const req=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));assert.equal(req.token,token);requests.push({method:req.method,args:req.params});
   if(nativeScopeError&&req.method==='revit.family.text_notes'){
    socket.end(JSON.stringify({protocol:plugin.protocol,ok:false,error:{code:'family_text_scope_mismatch',message:'Exact owner mismatch',
     details:{requestedFamilyName:'THS-A1',expectedCategoryId:-2000280,actualFamilyScope:{ownerFamilyAvailable:true,documentTitle:'THS-A1.rfa',familyName:'native-owner-name',categoryId:-2000280}}}})+'\n');return;
   }
   const nativeContext=knownEmpty?{...context,familyDocumentScope:{ownerFamilyAvailable:true,documentTitle:document.title,familyName:'',categoryId:-2000280}}:context;
   const nativeReport=report();if(knownEmpty)nativeReport.family.name='';
   if(Object.hasOwn(req.params,'afterNoteId'))nativeReport.page={afterNoteId:req.params.afterNoteId,skippedCount:0,remainingCount:0,nextAfterNoteId:null};
   if(Object.hasOwn(req.params,'boundsViewId')){
    nativeReport.boundsView={id:req.params.boundsViewId,uniqueId:'view-2',name:'Front',viewType:'Elevation'};
    nativeReport.notes[0].viewBounds=nativeReport.notes[0].bounds;
   }
   const result=req.method==='revit.bridge.info'?plugin:req.method==='revit.context.get'?nativeContext:req.method==='revit.family.text_notes'?nativeReport:undefined;
   socket.end(JSON.stringify(result?{protocol:plugin.protocol,ok:true,result}:{protocol:plugin.protocol,ok:false,error:{code:'unexpected_native_query',message:req.method}})+'\n');
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const config=path.join(folder,'bridge.json');
 await fs.writeFile(config,JSON.stringify({port:server.address().port,token}));
 const client=new Client({name:'family-text-sdk-test',version:'1'});
 t.after(async()=>{await client.close();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));
  assert.equal(path.dirname(path.resolve(folder)),path.resolve(os.tmpdir()));assert.ok(path.basename(folder).startsWith('family-text-sdk-'));
  await fs.rm(folder,{recursive:true,force:true});});
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/revit-custom.mjs')],stderr:'pipe',
  env:{REVIT_AI_CONFIG:config,REVIT_AI_READONLY_BRIDGE_INFO_CACHE_MS:'0'}}));
 const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});
  const v=JSON.parse(r.content.find(c=>c.type==='text').text);if(r.isError)throw Object.assign(new Error(v.message),v);return v;};
 return {client,requests,call};
}
const workflowInput={name:'families.text_notes',documentIdentity:input.documentIdentity,expectedRevision:0,planningMode:'explicit',input:{familyName:input.familyName}};
test('SDK existing workflow discovers and reads family notes without adding a dedicated tool',async t=>{
 const f=await sdk(t),tools=(await f.client.listTools()).tools;
 assert.ok(tools.some(t=>t.name==='revit_workflow_run'));assert.ok(!tools.some(t=>t.name==='revit_family_text_notes'));
 const list=await f.call('revit_workflow_list');const w=list.workflows.find(w=>w.workflowId==='families.text_notes');
 assert.equal(w.destructiveLevel,'read-only');assert.equal(w.operationBuilder,null);
 assert.deepEqual(await f.call('revit_workflow_run',workflowInput),report());
 assert.deepEqual(f.requests.filter(r=>r.method==='revit.family.text_notes').map(r=>r.args),[input]);
 assert.ok(f.requests.every(r=>['revit.bridge.info','revit.context.get','revit.family.text_notes'].includes(r.method)));
});
test('SDK rejects invalid family input and unsupported planning mode before native dispatch',async t=>{
 const f=await sdk(t);
 await assert.rejects(f.call('revit_workflow_run',{...workflowInput,input:{familyName:'THS-A1',path:'anything.rfa'}}));
 await assert.rejects(f.call('revit_workflow_run',{...workflowInput,expectedRevision:undefined}));
 await assert.rejects(f.call('revit_workflow_run',{...workflowInput,planningMode:'assisted'}));
 assert.deepEqual(f.requests,[]);
});
test('SDK old plugin feature guard refuses the new family method with no retry',async t=>{
 const f=await sdk(t,{old:true});await assert.rejects(f.call('revit_workflow_run',workflowInput),{code:'feature_not_loaded'});
 assert.equal(f.requests.filter(r=>r.method==='revit.context.get').length,1);
 assert.ok(!f.requests.some(r=>r.method==='revit.family.text_notes'));
});

test('SDK family page and view options reject an old DLL before target dispatch and preserve new selectors',async t=>{
 const args={...workflowInput,input:{familyName:'THS-A1',afterNoteId:0,boundsViewId:2}};
 const old=await sdk(t,{pageFeature:false});
 await assert.rejects(old.call('revit_workflow_run',args),e=>e.code==='feature_not_loaded'&&e.details.requiredFeatures.includes('family-text-pagination-view-bounds'));
 assert.ok(!old.requests.some(r=>r.method==='revit.family.text_notes'));
 const fresh=await sdk(t);const r=await fresh.call('revit_workflow_run',args);
 assert.equal(r.page.nextAfterNoteId,null);assert.equal(r.boundsView.id,2);assert.equal(r.notes[0].viewBounds.supported,true);
 assert.deepEqual(fresh.requests.filter(r=>r.method==='revit.family.text_notes').map(r=>r.args),[{...input,afterNoteId:0,boundsViewId:2}]);
});
test('SDK preserves exact native owner scope on refusal without guessing or retrying',async t=>{
 const f=await sdk(t,{nativeScopeError:true});
 await assert.rejects(f.call('revit_workflow_run',workflowInput),e=>{
  assert.equal(e.code,'family_text_scope_mismatch');
  assert.deepEqual(e.details,{requestedFamilyName:'THS-A1',expectedCategoryId:-2000280,
   actualFamilyScope:{ownerFamilyAvailable:true,documentTitle:'THS-A1.rfa',familyName:'native-owner-name',categoryId:-2000280}});
  return true;
 });
 assert.equal(f.requests.filter(r=>r.method==='revit.family.text_notes').length,1);
 assert.ok(f.requests.every(r=>['revit.bridge.info','revit.context.get','revit.family.text_notes'].includes(r.method)));
});
test('SDK title-bound known-empty workflow preserves input and refuses old owner contract before dispatch',async t=>{
 const args={...workflowInput,input:{familyName:'',familyDocumentTitle:document.title}};
 const old=await sdk(t,{knownEmpty:true,emptyOwnerFeature:false});
 await assert.rejects(old.call('revit_workflow_run',args),e=>e.code==='feature_not_loaded'&&e.details.requiredFeatures.includes('family-text-known-empty-owner'));
 assert.ok(!old.requests.some(r=>r.method==='revit.family.text_notes'));
 const fresh=await sdk(t,{knownEmpty:true});const r=await fresh.call('revit_workflow_run',args);
 assert.equal(r.family.name,'');assert.equal(r.document.title,document.title);
 assert.deepEqual(fresh.requests.filter(r=>r.method==='revit.family.text_notes').map(r=>r.args),[{...input,familyName:'',familyDocumentTitle:document.title}]);
});
test('native family service source stays read-only and freezes bounded pinned data on UI thread',async()=>{
 const source=await fs.readFile(path.join(root,'v27/FamilyTextService.cs'),'utf8');
 assert.doesNotMatch(source,/\b(?:EditFamily|OpenDocumentFile|OpenAndActivateDocument|LoadFamily|SaveAs|Save|Close|Transaction|TransactionGroup)\s*\(/);
 for(const pattern of [/IsFamilyDocument/,/OwnerFamily/,/FamilyTextRules.RequireScope/,/DocumentReadPinRules.Validate/,
  /ThrowIfCancellationRequested/,/FromSeconds\(20\)/,/Take\(input.MaxNotes\)/,/NativeReadSnapshot.Freeze/,
  /FamilyTextRules.RequireResponseBudget/,/doc.IsModifiable/])assert.match(source,pattern);
});
