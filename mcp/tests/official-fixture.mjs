import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
const server=new Server({name:'mock-autodesk-read-fixture',version:'1.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[
 {name:'query_model',description:'Read-only fixture',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true,destructiveHint:false}},
 {name:'delete_model',description:'Denied write fixture',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:false,destructiveHint:true}}
]}));
server.setRequestHandler(CallToolRequestSchema,async request=>({content:[{type:'text',text:JSON.stringify({tool:request.params.name,readOnly:request.params.name==='query_model'})}]}));
await server.connect(new StdioServerTransport());
