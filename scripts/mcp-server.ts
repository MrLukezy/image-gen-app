#!/usr/bin/env node
import { handleJsonRpc, type SendNotification } from './mcp-handlers.js';

let buffer = Buffer.alloc(0);

function sendMessage(msg: any): void {
  const json = JSON.stringify(msg);
  const content = Buffer.from(json, 'utf-8');
  const header = `Content-Length: ${content.length}\r\n\r\n`;
  process.stdout.write(header + json);
}

const sendNotification: SendNotification = (method: string, params?: any) => {
  sendMessage({ jsonrpc: '2.0', method, params });
};

function processData(): void {
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    const header = buffer.slice(0, headerEnd).toString('utf-8');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = parseInt(match[1], 10);
    const totalLen = headerEnd + 4 + length;
    if (buffer.length < totalLen) break;
    const body = buffer.slice(headerEnd + 4, totalLen).toString('utf-8');
    buffer = buffer.slice(totalLen);
    try {
      const msg = JSON.parse(body);
      handleJsonRpc(msg, sendNotification).then(result => {
        if (result) sendMessage(result);
      }).catch(e => {
        process.stderr.write(`[mcp-server] Error: ${e.message}\n`);
      });
    } catch (e: any) {
      process.stderr.write(`[mcp-server] Parse error: ${e.message}\n`);
    }
  }
}

process.stdin.on('data', (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  processData();
});

process.stdin.on('end', () => {
  process.exit(0);
});

process.stderr.write(`[mcp-server] Image Gen MCP Server started (STDIO transport)\n`);
