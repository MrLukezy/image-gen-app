const { spawn } = require('child_process');

const proc = spawn(
  'C:\\Program Files\\nodejs\\node.exe',
  [
    '--import', 'file:///C:/Users/elex/AppData/Roaming/npm/node_modules/promptfoo/node_modules/tsx/dist/loader.mjs',
    'D:\\lukezy\\image-gen-app\\scripts\\mcp-server.ts',
  ],
  { stdio: ['pipe', 'pipe', 'pipe'] }
);

let buffer = '';
proc.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf-8');
  console.log('[STDOUT RAW]', JSON.stringify(chunk.toString('utf-8')));
});

proc.stderr.on('data', (chunk) => {
  console.log('[STDERR]', chunk.toString('utf-8').trimEnd());
});

function send(msg) {
  const body = JSON.stringify(msg);
  const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
  proc.stdin.write(frame);
}

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'opencode', version: '1.0.0' },
  },
});

setTimeout(() => {
  send({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });
}, 1500);

setTimeout(() => {
  console.log('[FINAL BUFFER]', buffer);
  const tools = buffer.match(/tools":\s*\[/g);
  console.log('[TOOLS ARRAY FOUND]', !!tools);
  proc.kill();
  process.exit(0);
}, 4000);

setTimeout(() => {
  console.log('[TIMEOUT - exiting]');
  proc.kill();
  process.exit(1);
}, 8000);
