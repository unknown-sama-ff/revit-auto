import test from 'node:test';
import assert from 'node:assert/strict';
import {batchViewExportSchema,exportViewImages} from '../view-export.mjs';

const request={documentIdentity:'doc-a',expectedRevision:2,viewIds:[20,10]};
test('batch export defaults retain selected view order and explicit high resolution',()=>{
  assert.deepEqual(batchViewExportSchema.parse(request),{...request,pixelSize:4096,resolutionDpi:300});
  for(const resolutionDpi of [72,150,300,600])assert.equal(batchViewExportSchema.parse({...request,pixelSize:8192,resolutionDpi}).resolutionDpi,resolutionDpi);
});
test('batch export rejects unpinned duplicate unsafe unbounded and arbitrary-path requests',async()=>{
  const invalid=[
    {...request,documentIdentity:undefined},{...request,documentIdentity:' '},{...request,expectedRevision:undefined},{...request,expectedRevision:-1},
    {...request,expectedRevision:Number.MAX_SAFE_INTEGER+1},{...request,viewIds:[]},{...request,viewIds:[10,10]},
    {...request,viewIds:[0]},{...request,viewIds:[10.5]},{...request,viewIds:['10']},{...request,viewIds:[Number.MAX_SAFE_INTEGER+1]},
    {...request,viewIds:Array.from({length:21},(_,i)=>i+1)},
    {...request,pixelSize:599},{...request,pixelSize:8193},{...request,pixelSize:null},{...request,resolutionDpi:96},
    {...request,outputPath:'elsewhere'},{...request,script:'anything.csx'}
  ];
  let calls=0;
  for(const input of invalid)await assert.rejects(exportViewImages(input,()=>{calls++;}));
  assert.equal(calls,0);
});
test('batch export calls the read-only native operation once and never retries failures',async()=>{
  const calls=[],receipt={exports:[{viewId:20,file:'one.png'},{viewId:10,file:'two.png'}],savedModel:false};
  const result=await exportViewImages(request,(...args)=>{calls.push(args);return receipt;});
  assert.equal(result,receipt);
  assert.deepEqual(calls, [['revit.view.export_images',{...request,pixelSize:4096,resolutionDpi:300},undefined]]);
  const nativeError=new Error('native disconnected');let attempts=0;
  await assert.rejects(exportViewImages(request,()=>{attempts++;throw nativeError;}),error=>error===nativeError);
  assert.equal(attempts,1);
});
test('cancelled batch exports make no native request',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(exportViewImages(request,()=>{calls++;},controller.signal));assert.equal(calls,0);
});
