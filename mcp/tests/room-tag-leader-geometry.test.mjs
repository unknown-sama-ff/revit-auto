import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('SDK readonly inspect preserves RoomTag endpoints and distinguishes no leader from unknown geometry',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'room-tag-geometry-')),
  token='room-tag-geometry-fixture-'.repeat(4),requests=[],sockets=new Set();
 const known=value=>({state:'known',value});
 const absent={state:'not-applicable',value:null,reason:'tag-has-no-leader'};
 const geometry={supported:true,scope:'room-tag-leader-geometry-observations',tagId:2296196,className:'RoomTag',viewId:2295811,
  units:'mm',hasLeader:known(true),hasElbow:known(true),end:known({xMm:34000.125,yMm:3000,zMm:1200}),
  elbow:{state:'unknown',value:null,reason:'native-read-failed',errorType:'InvalidOperationException'},
  requestedGeometryVerified:false,endInsideRoomVerified:false,visualVerified:false};
 const report={documentIdentity:'tag-doc',documentRevision:0,items:[
  {summary:{id:2296196},tagLeaderGeometry:geometry},
  {summary:{id:2295836},tagLeaderGeometry:{...geometry,tagId:2295836,hasLeader:known(false),hasElbow:absent,end:absent,elbow:absent}}
 ]};
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';
  socket.on('data',chunk=>{buffer+=chunk.toString('utf8');if(!buffer.includes('\n'))return;
   const req=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));assert.equal(req.token,token);requests.push({method:req.method,args:req.params});
   const result=req.method==='revit.bridge.info'?{protocol:'revit-auto-2027-v2',version:'0.4.0',features:['readonly-query-pins','room-tag-leader-geometry-snapshot']}:
    req.method==='revit.inspect'?report:undefined;
   socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:!!result,...(result?{result}:{error:{code:'unexpected_method',message:req.method}})})+'\n');
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const config=path.join(folder,'bridge.json');await fs.writeFile(config,JSON.stringify({port:server.address().port,token}));
 const client=new Client({name:'room-tag-geometry-sdk',version:'1'});
 t.after(async()=>{await client.close();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));
  assert.equal(path.dirname(path.resolve(folder)),path.resolve(os.tmpdir()));assert.ok(path.basename(folder).startsWith('room-tag-geometry-'));
  await fs.rm(folder,{recursive:true,force:true});});
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../revit-custom.mjs')],stderr:'ignore',env:{REVIT_AI_CONFIG:config}}));
 const contract=(await client.listTools()).tools.find(t=>t.name==='revit_inspect');assert.equal(contract.annotations.readOnlyHint,true);
 const args={documentIdentity:'tag-doc',expectedRevision:0,elementIds:[2296196,2295836]};
 const result=await client.callTool({name:'revit_inspect',arguments:args});assert.notEqual(result.isError,true);
 assert.deepEqual(JSON.parse(result.content.find(c=>c.type==='text').text),report);
 assert.deepEqual(requests.filter(r=>r.method==='revit.inspect').map(r=>r.args),[args]);
 assert.ok(requests.every(r=>['revit.bridge.info','revit.inspect'].includes(r.method)));
});
