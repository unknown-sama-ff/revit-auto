import net from 'node:net';
import { readFileSync } from 'node:fs';

const method = process.argv[2] ?? 'get_current_view_info';
const params = method === 'send_code_to_revit' && process.argv[3]?.endsWith('.csx')
  ? { code: readFileSync(process.argv[3], 'utf8'), transactionMode: process.argv[4] ?? 'none' }
  : process.argv[3] ? JSON.parse(process.argv[3]) : {};
const socket = net.createConnection({ host: '127.0.0.1', port: 8080 });
let response = '';

socket.setTimeout(Number(process.env.MCP_TIMEOUT_MS) || (method === 'send_code_to_revit' ? 120000 : 5000));
socket.on('connect', () => {
  socket.write(`${JSON.stringify({ jsonrpc: '2.0', method, params, id: 'codex-probe' })}\n`);
});
socket.on('data', chunk => {
  response += chunk.toString();
  try {
    JSON.parse(response);
    process.stdout.write(response);
    socket.end();
  } catch {}
});
socket.on('timeout', () => {
  process.stderr.write('MCP connection timed out\n');
  socket.destroy();
  process.exitCode = 1;
});
socket.on('error', error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
