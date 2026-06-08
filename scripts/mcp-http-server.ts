#!/usr/bin/env node
import http from 'node:http';
import { handleJsonRpc } from './mcp-handlers.js';

const PORT = parseInt(process.env.MCP_PORT || '3845', 10);
const MCP_PATH = process.env.MCP_PATH || '/mcp';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: any): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendSseEvent(res: http.ServerResponse, event: string, data: any): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  res.write(payload);
}

const sseClients: Set<http.ServerResponse> = new Set();

function broadcastNotification(method: string, params?: any): void {
  const msg = { jsonrpc: '2.0', method, params };
  for (const client of sseClients) {
    try {
      sendSseEvent(client, 'message', msg);
    } catch {}
  }
}

async function handlePost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const msg = JSON.parse(body);

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (Array.isArray(msg)) {
      const results = [];
      for (const m of msg) {
        const r = await handleJsonRpc(m);
        if (r) results.push(r);
      }
      sendJson(res, 200, results);
      return;
    }

    const result = await handleJsonRpc(msg);

    if (!result) {
      res.writeHead(202, CORS_HEADERS);
      res.end();
      return;
    }

    if (result.result?.serverInfo) {
      res.writeHead(200, {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId || 'default-session',
      });
      res.end(JSON.stringify(result));
      return;
    }

    sendJson(res, 200, result);
  } catch (e: any) {
    sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: `Parse error: ${e.message}` } });
  }
}

function handleGet(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    ...CORS_HEADERS,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  sendSseEvent(res, 'endpoint', { uri: MCP_PATH });

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
}

function handleOptions(_req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(204, CORS_HEADERS);
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (url.pathname === MCP_PATH) {
    if (req.method === 'POST') {
      await handlePost(req, res);
    } else if (req.method === 'GET') {
      handleGet(req, res);
    } else if (req.method === 'OPTIONS') {
      handleOptions(req, res);
    } else if (req.method === 'DELETE') {
      res.writeHead(200, CORS_HEADERS);
      res.end();
    } else {
      res.writeHead(405, CORS_HEADERS);
      res.end('Method Not Allowed');
    }
  } else if (url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok', server: 'image-gen-mcp', version: '1.0.0' });
  } else {
    res.writeHead(404, CORS_HEADERS);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  process.stderr.write(`[mcp-http-server] Image Gen MCP Server listening on http://localhost:${PORT}${MCP_PATH}\n`);
  process.stderr.write(`[mcp-http-server] Health check: http://localhost:${PORT}/health\n`);
});
