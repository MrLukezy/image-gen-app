import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { homedir } from 'node:os';

const APP_ID = 'com.lukezy.image-gen';

export interface McpConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
  defaultSize: string;
  stylePrefix: string;
  outputDir: string;
  providerId: string;
}

interface ConvEntry {
  id: string;
  type: 'user' | 'assistant';
  prompt?: string;
  images?: string[];
  refImages?: string[];
  error?: string;
  loading?: boolean;
  timestamp: number;
  size?: string;
  duration?: number;
  completedAt?: number;
  imageCount?: number;
  model?: string;
  batchId?: string;
  batchTotal?: number;
  batchImages?: BatchTask[];
  batchErrors?: number;
}

interface BatchTask {
  id: number;
  status: 'loading' | 'success' | 'failed';
  image?: string;
  error?: string;
}

interface Conversation {
  id: string;
  title: string;
  entries: ConvEntry[];
  createdAt: number;
  updatedAt: number;
  source: string;
}

function getAppDataDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming'), APP_ID);
  } else if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', APP_ID);
  } else {
    return path.join(homedir(), '.config', APP_ID);
  }
}

function loadMcpConfig(): McpConfig {
  const configPath = path.join(getAppDataDir(), 'mcp_config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const cfg = JSON.parse(raw);
    return {
      apiKey: cfg.apiKey || '',
      apiUrl: cfg.apiUrl || 'https://www.hfsyapi.cn/v1/images/generations',
      model: cfg.model || 'gpt-image-2',
      defaultSize: cfg.defaultSize || '1024x1024',
      stylePrefix: cfg.stylePrefix || '',
      outputDir: cfg.outputDir || '',
      providerId: cfg.providerId || '',
    };
  } catch {
    return {
      apiKey: '',
      apiUrl: 'https://www.hfsyapi.cn/v1/images/generations',
      model: 'gpt-image-2',
      defaultSize: '1024x1024',
      stylePrefix: '',
      outputDir: '',
      providerId: '',
    };
  }
}

function loadProviderConfig(providerId?: string): McpConfig {
  if (!providerId) {
    const mcpCfg = loadMcpConfig();
    if (mcpCfg.apiKey) return mcpCfg;
  }
  try {
    let providers: any[] = [];
    const storagePath = path.join(getAppDataDir(), 'providers.json');
    try {
      const raw = fs.readFileSync(storagePath, 'utf-8');
      providers = JSON.parse(raw);
    } catch {
      providers = [];
    }
    const activeId = providerId || mcpCfgDefault().providerId;
    const prov = providers.find((p: any) => p.id === activeId) || providers[0];
    if (prov) {
      const mcpCfg = loadMcpConfig();
      return {
        apiKey: prov.apiKey || mcpCfg.apiKey,
        apiUrl: prov.baseUrl || mcpCfg.apiUrl,
        model: mcpCfg.model || 'gpt-image-2',
        defaultSize: mcpCfg.defaultSize || '1024x1024',
        stylePrefix: mcpCfg.stylePrefix || '',
        outputDir: mcpCfg.outputDir || '',
        providerId: prov.id,
      };
    }
  } catch {}
  return loadMcpConfig();
}

function mcpCfgDefault(): McpConfig {
  return loadMcpConfig();
}

function mcpConvDir(): string {
  return path.join(getAppDataDir(), 'mcp_conversations');
}

function mcpSessionDir(sessionId: string): string {
  return path.join(mcpConvDir(), sanitizeId(sessionId));
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200);
}

function loadSession(sessionId: string): Conversation | null {
  const dir = mcpSessionDir(sessionId);
  const metaPath = path.join(dir, 'meta.json');
  try {
    const raw = fs.readFileSync(metaPath, 'utf-8');
    const obj = JSON.parse(raw);
    const createdAt = obj.created_at ?? obj.createdAt ?? 0;
    const updatedAt = obj.updated_at ?? obj.updatedAt ?? 0;
    return {
      id: obj.id,
      title: obj.title,
      entries: obj.entries || [],
      createdAt,
      updatedAt,
      source: obj.source || 'mcp',
    };
  } catch {
    return null;
  }
}

function saveSession(conv: Conversation): void {
  const dir = mcpSessionDir(conv.id);
  fs.mkdirSync(dir, { recursive: true });
  const metaPath = path.join(dir, 'meta.json');
  const tmpPath = metaPath + '.tmp';
  const diskObj = {
    id: conv.id,
    title: conv.title,
    entries: conv.entries,
    created_at: conv.createdAt,
    updated_at: conv.updatedAt,
    source: conv.source || 'mcp',
  };
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(diskObj, null, 2), 'utf-8');
    fs.renameSync(tmpPath, metaPath);
  } catch {
    fs.writeFileSync(metaPath, JSON.stringify(diskObj, null, 2), 'utf-8');
  }
}

function loadAllMcpConversations(): Conversation[] {
  const base = mcpConvDir();
  if (!fs.existsSync(base)) return [];
  try {
    return fs.readdirSync(base, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => loadSession(d.name))
      .filter((c): c is Conversation => c !== null);
  } catch {
    return [];
  }
}

function resolveSessionId(nameOrId?: string): string {
  if (!nameOrId) return '';
  const direct = loadSession(nameOrId);
  if (direct) return direct.id;
  const all = loadAllMcpConversations();
  const byTitle = all.find(c => c.title === nameOrId);
  if (byTitle) return byTitle.id;
  const lowerName = nameOrId.toLowerCase();
  const byLower = all.find(c => c.title.toLowerCase() === lowerName);
  if (byLower) return byLower.id;
  return '';
}

function getOrCreateSession(nameOrId?: string): Conversation {
  const resolved = resolveSessionId(nameOrId);
  if (resolved) {
    const existing = loadSession(resolved);
    if (existing) return existing;
  }
  const id = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const title = nameOrId || `MCP ${new Date().toLocaleString('zh-CN')}`;
  const conv: Conversation = {
    id,
    title,
    entries: [],
    createdAt: nowMs(),
    updatedAt: nowMs(),
    source: 'mcp',
  };
  saveSession(conv);
  return conv;
}

function appendEntriesToSession(nameOrId: string, newEntries: ConvEntry[]): Conversation {
  const conv = getOrCreateSession(nameOrId);
  conv.entries.push(...newEntries);
  conv.updatedAt = nowMs();
  if (!nameOrId) {
    const firstUserPrompt = conv.entries.find(e => e.type === 'user' && e.prompt)?.prompt;
    if (firstUserPrompt && conv.entries.filter(e => e.type === 'user').length === 1) {
      conv.title = firstUserPrompt.slice(0, 40);
    }
  }
  saveSession(conv);
  return conv;
}

function genId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowMs(): number {
  return Date.now();
}

function httpRequest(options: any, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const lib = options.protocol === 'http:' ? http : https;
    const req = lib.request(options, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function callImageApi(
  apiUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  size: string,
  referenceImages?: string[],
  onKeepalive?: () => void,
): Promise<{ images: string[]; error: string | null }> {
  const apiCallId = `api_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  process.stderr.write(`\n${'='.repeat(60)}\n`);
  process.stderr.write(`[${apiCallId}] callImageApi START\n`);
  process.stderr.write(`[${apiCallId}] apiUrl: ${apiUrl}\n`);
  process.stderr.write(`[${apiCallId}] model: ${model}, size: ${size}\n`);
  process.stderr.write(`[${apiCallId}] prompt: ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}\n`);

  if (referenceImages && referenceImages.length > 0) {
    process.stderr.write(`[${apiCallId}] referenceImages count: ${referenceImages.length}\n`);
    referenceImages.forEach((img, idx) => {
      const prefix = img.slice(0, 80);
      const isDataUri = img.startsWith('data:');
      const isUrl = img.startsWith('http://') || img.startsWith('https://');
      const hasComma = img.includes(',');
      process.stderr.write(`[${apiCallId}]   [${idx + 1}] type=${isDataUri ? 'dataURI' : isUrl ? 'URL' : 'rawBase64'}, len=${img.length}, hasComma=${hasComma}\n`);
      process.stderr.write(`[${apiCallId}]   [${idx + 1}] preview: ${prefix}${img.length > 80 ? '...' : ''}\n`);
    });
  } else {
    process.stderr.write(`[${apiCallId}] referenceImages: none\n`);
  }

  const payload = JSON.stringify({
    model,
    prompt,
    reference_images: referenceImages && referenceImages.length > 0 ? referenceImages : undefined,
    size,
    n: 1,
    response_format: 'b64_json',
  });

  process.stderr.write(`[${apiCallId}] payload size: ${payload.length} bytes\n`);

  // Dump a debug report (not the full base64) to file
  const debugDir = path.join(homedir(), '.opencode', 'image-gen-debug');
  try {
    fs.mkdirSync(debugDir, { recursive: true });
    const debugReport = {
      timestamp: new Date().toISOString(),
      apiCallId,
      apiUrl,
      model,
      size,
      promptLen: prompt.length,
      hasRefImages: !!(referenceImages && referenceImages.length > 0),
      refImageCount: referenceImages?.length || 0,
      refImageSummary: referenceImages?.map((img, i) => ({
        idx: i + 1,
        len: img.length,
        type: img.startsWith('http') ? 'URL' : img.startsWith('data:') ? 'dataURI' : 'rawBase64',
        first50: img.slice(0, 50),
        last30: img.slice(-30),
        hasComma: img.includes(','),
      })) || [],
    };
    fs.writeFileSync(
      path.join(debugDir, `req_${apiCallId}.json`),
      JSON.stringify(debugReport, null, 2),
    );
    process.stderr.write(`[${apiCallId}] debug report written to: ${path.join(debugDir, `req_${apiCallId}.json`)}\n`);
  } catch (e: any) {
    process.stderr.write(`[${apiCallId}] failed to write debug report: ${e.message}\n`);
  }

  const url = new URL(apiUrl);
  const bodyBytes = Buffer.byteLength(payload, 'utf-8');
  const options = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Content-Length': bodyBytes,
    },
  };

  try {
    const resp = await httpRequest(options, payload);
    process.stderr.write(`[${apiCallId}] response status: ${resp.status}\n`);

    if (resp.status !== 200) {
      process.stderr.write(`[${apiCallId}] ERROR response body: ${resp.body.slice(0, 1000)}\n`);
      let errMsg = `HTTP ${resp.status}: ${resp.body.slice(0, 500)}`;
      if (referenceImages && referenceImages.length > 0 && resp.status === 400) {
        errMsg += `\n[ref_images debug]`
          + referenceImages.map((r, i) => {
            const first4bytes = Buffer.from(r.slice(0, 10), 'utf-8').toString('hex');
            const fmt = r.startsWith('http') ? 'URL' : r.startsWith('data:') ? 'dataURI' : r.length > 1000 ? `rawB64(len=${r.length})` : `short(len=${r.length})`;
            return `\n  #${i + 1}: format=${fmt} first40="${r.slice(0, 40)}" hex[0:10]=${first4bytes}`;
          }).join('');
      }
      process.stderr.write(`[${apiCallId}] returning error: ${errMsg}\n`);
      process.stderr.write(`${'='.repeat(60)}\n\n`);
      return { images: [], error: errMsg };
    }

    process.stderr.write(`[${apiCallId}] response size: ${resp.body.length} bytes\n`);
    const genResp = JSON.parse(resp.body);

    if (genResp.status === 'FAILED' || genResp.status === 'ERROR') {
      return { images: [], error: genResp.fail_reason || resp.body };
    }

    let images: string[] = [];

    if (genResp.result_url) {
      images.push(genResp.result_url);
    }

    if (images.length === 0 && genResp.data && Array.isArray(genResp.data)) {
      for (const item of genResp.data) {
        if (item.b64_json) {
          images.push(`data:image/png;base64,${item.b64_json}`);
        } else if (item.url) {
          images.push(item.url);
        }
      }
    }

    if (images.length === 0 && genResp.task_id) {
      const pollUrl = new URL(`${apiUrl.replace(/\/generations$/, '')}/${genResp.task_id}`);
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 5000));
        onKeepalive?.();
        const pollOpts = {
          protocol: pollUrl.protocol,
          hostname: pollUrl.hostname,
          port: pollUrl.port || (pollUrl.protocol === 'https:' ? 443 : 80),
          path: pollUrl.pathname + pollUrl.search,
          method: 'GET',
          headers: { 'Authorization': `Bearer ${apiKey}` },
        };
        try {
          const pollResp = await httpRequest(pollOpts, '');
          const pollData = JSON.parse(pollResp.body);
          if (pollData.status === 'SUCCESS') {
            if (pollData.result_url) {
              images.push(pollData.result_url);
              break;
            }
            if (pollData.data && Array.isArray(pollData.data)) {
              for (const item of pollData.data) {
                if (item.b64_json) images.push(`data:image/png;base64,${item.b64_json}`);
                else if (item.url) images.push(item.url);
              }
              break;
            }
          } else if (pollData.status === 'FAILED' || pollData.status === 'ERROR') {
            return { images: [], error: pollData.fail_reason || 'Generation failed' };
          }
        } catch {}
      }
      if (images.length === 0) {
        return { images: [], error: 'Generation timeout (5 minutes)' };
      }
    }

    return { images, error: null };
  } catch (e: any) {
    return { images: [], error: `Request failed: ${e.message}` };
  }
}

async function saveImageToLocal(
  imageData: string,
  sessionId: string,
  entryId: string,
  index: number,
  outputDir?: string,
): Promise<string> {
  const dir = outputDir || path.join(mcpSessionDir(sessionId), 'images');
  fs.mkdirSync(dir, { recursive: true });
  const fname = `${entryId}_${index}.png`;
  const fpath = path.join(dir, fname);

  if (imageData.startsWith('data:')) {
    const b64 = imageData.split(',')[1] || imageData;
    fs.writeFileSync(fpath, Buffer.from(b64, 'base64'));
    return fpath;
  }

  if (imageData.startsWith('http')) {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const url = new URL(imageData);
          const lib = url.protocol === 'http:' ? http : https;
          lib.get(imageData, { timeout: 30000 }, (res: any) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              // follow redirect
              const newUrl = new URL(res.headers.location, imageData).toString();
              const lib2 = newUrl.startsWith('https') ? https : http;
              lib2.get(newUrl, { timeout: 30000 }, (res2: any) => {
                const chunks: Buffer[] = [];
                res2.on('data', (chunk: Buffer) => chunks.push(chunk));
                res2.on('end', () => {
                  if (chunks.length === 0) return reject(new Error('Empty response after redirect'));
                  fs.writeFileSync(fpath, Buffer.concat(chunks));
                  resolve();
                });
                res2.on('error', reject);
              }).on('error', reject);
              return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              if (chunks.length === 0) return reject(new Error('Empty image data'));
              fs.writeFileSync(fpath, Buffer.concat(chunks));
              resolve();
            });
            res.on('error', reject);
          }).on('error', reject);
        });
        return fpath;
      } catch (e: any) {
        process.stderr.write(`[saveImageToLocal] URL download attempt ${attempt + 1}/${MAX_RETRIES} failed: ${e.message}\n`);
        if (attempt < MAX_RETRIES - 1) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    // all retries failed - save URL to a .txt so we have a traceable record, but return the URL as fallback
    try { fs.writeFileSync(fpath.replace(/\.png$/, '.url.txt'), imageData); } catch {}
    process.stderr.write(`[saveImageToLocal] All retries failed, returning URL: ${imageData.slice(0, 100)}\n`);
    return imageData;
  }

  // raw base64
  try {
    fs.writeFileSync(fpath, Buffer.from(imageData, 'base64'));
    return fpath;
  } catch {
    return imageData;
  }
}

async function saveRefImagesToLocal(
  rawRefImages: string[],
  sessionId: string,
  entryId: string,
  outputDir?: string,
): Promise<string[]> {
  const saved: string[] = [];
  const dir = outputDir || path.join(mcpSessionDir(sessionId), 'images');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < rawRefImages.length; i++) {
    const img = rawRefImages[i];
    const fname = `${entryId}_ref_${i}.png`;
    const fpath = path.join(dir, fname);
    try {
      if (img.startsWith('data:')) {
        const b64 = img.split(',')[1];
        if (b64) {
          fs.writeFileSync(fpath, Buffer.from(b64, 'base64'));
          saved.push(fpath);
        }
      } else if (img.startsWith('http://') || img.startsWith('https://')) {
        saved.push(img);
      } else if (fs.existsSync(img) && fs.statSync(img).isFile()) {
        fs.copyFileSync(img, fpath);
        saved.push(fpath);
      } else {
        saved.push(img);
      }
    } catch {
      saved.push(img);
    }
  }
  return saved;
}

function detectMimeFromExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'bmp': return 'image/bmp';
    default: return 'image/png';
  }
}

function diagnoseBase64(label: string, value: string): void {
  const len = value.length;
  const first100 = value.slice(0, 100);
  const last50 = value.slice(-50);
  const b64Regex = /^[A-Za-z0-9+/=]+$/;
  let validB64Region = '';
  for (const region of [first100, value.slice(0, 20), value.slice(len / 2, len / 2 + 20), last50]) {
    if (!b64Regex.test(region)) {
      for (let i = 0; i < region.length; i++) {
        const ch = region.charCodeAt(i);
        if (!/[A-Za-z0-9+/=]/.test(region[i])) {
          process.stderr.write(`${label} INVALID CHAR at offset ${i}: '${region[i]}' (U+${ch.toString(16).padStart(4, '0')})\n`);
          break;
        }
      }
    }
  }
  process.stderr.write(`${label} len=${len}, first80: ${first100.slice(0, 80)}\n`);
  process.stderr.write(`${label} last30:  ${last50.slice(-30)}\n`);

  const dataUriMatch = value.match(/^data:([^;]+);base64,(.*)$/);
  if (dataUriMatch) {
    const mime = dataUriMatch[1];
    const rawB64 = dataUriMatch[2];
    process.stderr.write(`${label} dataURI mime=${mime}, rawB64 len=${rawB64.length}\n`);
    const b64Valid = b64Regex.test(rawB64.slice(0, 200));
    process.stderr.write(`${label} first200 of raw b64 valid=${b64Valid}\n`);
  } else if (b64Regex.test(value.slice(0, 200))) {
    process.stderr.write(`${label} looks like raw b64\n`);
  } else if (value.startsWith('http')) {
    process.stderr.write(`${label} is URL\n`);
  } else {
    process.stderr.write(`${label} UNKNOWN FORMAT\n`);
  }
}

async function prepareReferenceImages(images: string[]): Promise<string[]> {
  const prepared: string[] = [];
  const b64Re = /^[A-Za-z0-9+/]+(=*)$/;
  process.stderr.write(`\n[prepareRef] ── ENTER: got ${images.length} image(s) ──\n`);
  for (let idx = 0; idx < images.length; idx++) {
    const img = images[idx];
    if (!img || typeof img !== 'string') {
      process.stderr.write(`[prepareRef] [${idx + 1}] SKIP: not a string (type=${typeof img})\n`);
      continue;
    }

    let value = img.trim();
    process.stderr.write(`[prepareRef] [${idx + 1}] INPUT: len=${value.length}, starts='${value.slice(0, 60)}'\n`);

    if (value.startsWith('data:')) {
      prepared.push(value);
      process.stderr.write(`[prepareRef] [${idx + 1}] OUTPUT: data URI passthrough (len=${value.length})\n`);
    } else if (value.startsWith('http://') || value.startsWith('https://')) {
      process.stderr.write(`[prepareRef] [${idx + 1}] OUTPUT: URL passthrough\n`);
      prepared.push(value);
    } else if (value.length >= 100 && b64Re.test(value.slice(0, 100))) {
      // Looks like raw base64 (long string of b64 chars, not a file path) — wrap as data URI
      const dataUri = `data:image/png;base64,${value}`;
      process.stderr.write(`[prepareRef] [${idx + 1}] OUTPUT: raw base64 wrapped as data URI (len=${value.length})\n`);
      prepared.push(dataUri);
    } else {
      let resolvedPath = value;
      if (!fs.existsSync(value) || !fs.statSync(value).isFile()) {
        const normalized = value.replace(/\\\\/g, '\\').replace(/\//g, path.sep);
        if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
          resolvedPath = normalized;
        } else {
          throw new Error(`Reference image #${idx + 1}: file not found: ${value.slice(0, 200)}`);
        }
      }

      const bytes = fs.readFileSync(resolvedPath);
      if (bytes.length === 0) {
        throw new Error(`Reference image #${idx + 1}: file is empty: ${resolvedPath}`);
      }
      const b64 = bytes.toString('base64');
      if (!b64) throw new Error(`Reference image #${idx + 1}: base64 encoding failed`);
      const mime = detectMimeFromExt(resolvedPath);
      const dataUri = `data:${mime};base64,${b64}`;
      process.stderr.write(`[prepareRef] [${idx + 1}] FROM FILE: ${path.basename(resolvedPath)} ${bytes.length}B → data URI (len=${dataUri.length})\n`);
      prepared.push(dataUri);
    }
  }

  const total = prepared.reduce((s, p) => s + p.length, 0);
  process.stderr.write(`[prepareRef] ── EXIT: ${prepared.length} prepared, total chars=${total} ──\n\n`);
  if (total > 50_000_000) {
    throw new Error(`Reference images total size ${(total / 1024 / 1024).toFixed(1)}MB exceeds limit (max 50MB).`);
  }
  return prepared;
}

let defaultSessionId = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
let currentStyle = '';
let currentOutputDir = '';
let currentSize = '1024x1024';
let currentModel = '';

// ──────────────────────────── Background Jobs ────────────────────────────

interface Job {
  jobId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  total: number;
  completed: number;
  errors: number;
  startTime: number;
  endTime?: number;
  sessionId: string;
  entryId: string;
  images: string[];
  cancelled: boolean;
}

const activeJobs = new Map<string, Job>();

function cleanupOldJobs() {
  const cutoff = nowMs() - 30 * 60 * 1000;
  for (const [id, job] of activeJobs) {
    if (job.endTime && job.endTime < cutoff) activeJobs.delete(id);
  }
}

function getJob(jobId: string): Job | null {
  return activeJobs.get(jobId) || null;
}

function listAllJobs(): Job[] {
  cleanupOldJobs();
  return [...activeJobs.values()].sort((a, b) => b.startTime - a.startTime).slice(0, 50);
}

function cancelJob(jobId: string): boolean {
  const job = activeJobs.get(jobId);
  if (!job || job.status !== 'running') return false;
  job.cancelled = true;
  return true;
}

async function handleRunParallelJob(
  jobId: string,
  cfg: McpConfig,
  enrichedPrompt: string,
  model: string,
  size: string,
  apiRefImages: string[] | undefined,
  count: number,
  sessionId: string,
  assistantId: string,
  outputDir: string,
  sendNotification?: SendNotification,
): Promise<void> {
  const job = activeJobs.get(jobId)!;
  const batchImages: BatchTask[] = [];
  const allImages: string[] = [];
  let errorCount = 0;

  const KEEPALIVE_MS = 3000;
  const kaTimer = setInterval(() => {
    const elapsed = Math.round((nowMs() - job.startTime) / 1000);
    sendNotification?.('notifications/message', {
      level: 'info', logger: 'image-gen',
      data: `[keepalive][${jobId}] Background job: ${job.completed}/${job.total} done (${elapsed}s)`,
    });
  }, KEEPALIVE_MS);

  const apiKeepalive = sendNotification
    ? () => {
        const elapsed = Math.round((nowMs() - job.startTime) / 1000);
        sendNotification('notifications/message', {
          level: 'info', logger: 'image-gen',
          data: `[keepalive][${jobId}] API polling... ${job.completed}/${job.total} (${elapsed}s)`,
        });
      }
    : undefined;

  try {
    const BATCH_SIZE = 5;
    for (let bs = 0; bs < count; bs += BATCH_SIZE) {
      if (job.cancelled) break;
      const be = Math.min(bs + BATCH_SIZE, count);
      const promises: Promise<void>[] = [];
      for (let i = bs; i < be; i++) {
        const idx = i;
        promises.push((async () => {
          if (job.cancelled) return;
          const result = await callImageApi(cfg.apiUrl, cfg.apiKey, model, enrichedPrompt, size, apiRefImages, apiKeepalive);
          if (result.images.length > 0) {
            try {
              const lp = await saveImageToLocal(result.images[0], sessionId, assistantId, idx, outputDir || undefined);
              batchImages[idx] = { id: idx, status: 'success', image: lp };
              allImages[idx] = lp;
            } catch {
              batchImages[idx] = { id: idx, status: 'success', image: result.images[0] };
              allImages[idx] = result.images[0];
            }
          } else {
            batchImages[idx] = { id: idx, status: 'failed', error: result.error || 'Unknown error' };
            errorCount++;
          }
          job.completed = batchImages.filter(b => b && (b.status === 'success' || b.status === 'failed')).length;
          job.errors = errorCount;
          job.images = allImages.filter(Boolean) as string[];
          if (sendNotification) {
            sendNotification('notifications/message', {
              level: 'info', logger: 'image-gen',
              data: `[${jobId}] Progress: ${job.completed}/${count}, ${errorCount} errors`,
            });
          }
        })());
      }
      await Promise.allSettled(promises);
    }
  } finally {
    clearInterval(kaTimer);
    job.status = job.cancelled ? 'cancelled' : 'completed';
    job.endTime = nowMs();
    const successCount = allImages.filter(Boolean).length;
    job.images = allImages.filter(Boolean) as string[];
    job.errors = errorCount;

    const finalEntry: ConvEntry = {
      id: assistantId, type: 'assistant', loading: false,
      images: allImages.filter(Boolean),
      error: successCount === 0 ? `All ${errorCount} tasks failed` : undefined,
      timestamp: nowMs(), size, model,
      duration: job.endTime - job.startTime, completedAt: job.endTime,
      imageCount: successCount,
      batchId: jobId, batchTotal: count, batchImages, batchErrors: errorCount,
    };
    try {
      const conv = getOrCreateSession(sessionId);
      const ei = conv.entries.findIndex(e => e.id === assistantId);
      if (ei >= 0) conv.entries[ei] = finalEntry; else conv.entries.push(finalEntry);
      conv.updatedAt = nowMs();
      saveSession(conv);
    } catch {}
    if (sendNotification) {
      sendNotification('notifications/message', {
        level: 'info', logger: 'image-gen',
        data: `[${jobId}] Done: ${successCount}/${count} OK (${((job.endTime - job.startTime) / 1000).toFixed(1)}s)`,
      });
    }
  }
}

async function handleGenerateImage(args: any, progressToken?: string | number, sendNotification?: SendNotification): Promise<any> {
  const cfg = loadProviderConfig(args.provider_id);
  if (!cfg.apiKey) {
    return { content: [{ type: 'text', text: 'Error: No API key configured. Please configure the MCP provider in the AI Image Generator app.' }] };
  }

  const nameOrId = args.session_id || '';
  const prompt = args.prompt || '';
  const size = args.size || currentSize || cfg.defaultSize;
  const stylePrefix = args.style || currentStyle || cfg.stylePrefix;
  const outputDir = args.output_dir || currentOutputDir || cfg.outputDir;
  const rawRefImages = args.reference_images || undefined;
  const model = args.model || currentModel || cfg.model;

  process.stderr.write(`\n[handleGenerateImage] ── ENTER ──\n`);
  process.stderr.write(`[handleGenerateImage] prompt: "${prompt.slice(0, 80)}"\n`);
  process.stderr.write(`[handleGenerateImage] model: ${model}, size: ${size}\n`);
  if (rawRefImages && rawRefImages.length > 0) {
    process.stderr.write(`[handleGenerateImage] RAW reference_images from client: ${rawRefImages.length} item(s)\n`);
    rawRefImages.forEach((img: string, i: number) => {
      process.stderr.write(`[handleGenerateImage]   #${i + 1}: type=${typeof img}, len=${img?.length}, preview="${(img || '').slice(0, 80)}"\n`);
    });
  } else {
    process.stderr.write(`[handleGenerateImage] reference_images: none\n`);
  }

  let enrichedPrompt = prompt;
  if (stylePrefix) {
    enrichedPrompt = `${stylePrefix}\n\n${prompt}`;
  }

  let apiRefImages: string[] | undefined;
  if (rawRefImages && rawRefImages.length > 0) {
    try {
      apiRefImages = await prepareReferenceImages(rawRefImages);
    } catch (e: any) {
      return { content: [{ type: 'text', text: `Error preparing reference images: ${e.message}` }] };
    }
  }

  const userEntryId = genId();
  const preSession = getOrCreateSession(nameOrId);
  const sessionId = preSession.id;

  const savedRefImages = rawRefImages && rawRefImages.length > 0
    ? await saveRefImagesToLocal(rawRefImages, sessionId, userEntryId, outputDir || undefined).catch(() => rawRefImages)
    : undefined;

  const userEntry: ConvEntry = {
    id: userEntryId,
    type: 'user',
    prompt,
    timestamp: nowMs(),
    size,
    model,
    refImages: savedRefImages,
  };

  const assistantId = genId();
  const loadingEntry: ConvEntry = {
    id: assistantId,
    type: 'assistant',
    loading: true,
    timestamp: nowMs(),
    size,
    model,
  };

  const initialConv = appendEntriesToSession(nameOrId, [userEntry, loadingEntry]);

  const startTime = nowMs();
  if (progressToken != null && sendNotification) {
    sendNotification('notifications/progress', { progressToken, progress: 0, total: 3, message: 'Preparing image generation...' });
    sendNotification('notifications/message', { level: 'info', logger: 'image-gen', data: `Starting single image generation: ${enrichedPrompt.slice(0, 80)}` });
  }

  const KEEPALIVE_INTERVAL_MS = 3000;
  const keepaliveStart = nowMs();
  const keepaliveTimer = (sendNotification && progressToken != null)
    ? setInterval(() => {
        const elapsed = Math.round((nowMs() - keepaliveStart) / 1000);
        sendNotification('notifications/message', {
          level: 'info',
          logger: 'image-gen',
          data: `[keepalive] Still generating image... (${elapsed}s elapsed)`,
        });
      }, KEEPALIVE_INTERVAL_MS)
    : null;

  const apiKeepalive = sendNotification
    ? () => {
        const elapsed = Math.round((nowMs() - keepaliveStart) / 1000);
        sendNotification('notifications/message', {
          level: 'info',
          logger: 'image-gen',
          data: `[keepalive] Waiting for API result... (${elapsed}s elapsed)`,
        });
      }
    : undefined;

  const result = await callImageApi(cfg.apiUrl, cfg.apiKey, model, enrichedPrompt, size, apiRefImages, apiKeepalive);

  if (keepaliveTimer) clearInterval(keepaliveTimer);

  if (progressToken != null && sendNotification) {
    sendNotification('notifications/progress', { progressToken, progress: 2, total: 3, message: 'Saving image...' });
  }
  const endTime = nowMs();

  let savedImages: string[] = [];
  if (result.images.length > 0) {
    for (let i = 0; i < result.images.length; i++) {
      try {
        const localPath = await saveImageToLocal(result.images[i], sessionId, assistantId, i, outputDir || undefined);
        savedImages.push(localPath);
      } catch {
        savedImages.push(result.images[i]);
      }
    }
  }

  const finalEntry: ConvEntry = {
    id: assistantId,
    type: 'assistant',
    loading: false,
    images: savedImages.length > 0 ? savedImages : undefined,
    error: result.error || undefined,
    timestamp: nowMs(),
    size,
    model,
    duration: endTime - startTime,
    completedAt: endTime,
    imageCount: savedImages.length,
  };

  const conv = getOrCreateSession(sessionId);
  const idx = conv.entries.findIndex(e => e.id === assistantId);
  if (idx >= 0) {
    conv.entries[idx] = finalEntry;
  } else {
    conv.entries.push(finalEntry);
  }
  conv.updatedAt = nowMs();
  saveSession(conv);

  if (result.error) {
    return { content: [{ type: 'text', text: `Image generation failed: ${result.error}` }] };
  }

  return {
    content: [
      { type: 'text', text: `Generated ${savedImages.length} image(s) successfully. ${savedImages.map((p, i) => `\nImage ${i + 1}: ${p}`).join('')}` },
      ...(savedImages.length > 0 ? [{ type: 'text', text: `Images saved to: ${outputDir || path.join(mcpSessionDir(sessionId), 'images')}` }] : []),
    ],
  };
}

async function handleParallelGenerate(args: any, progressToken?: string | number, sendNotification?: SendNotification): Promise<any> {
  const cfg = loadProviderConfig(args.provider_id);
  if (!cfg.apiKey) {
    return { content: [{ type: 'text', text: 'Error: No API key configured.' }] };
  }

  const nameOrId = args.session_id || '';
  const prompt = args.prompt || '';
  const count = Math.min(args.count || 2, 20);
  const size = args.size || currentSize || cfg.defaultSize;
  const stylePrefix = args.style || currentStyle || cfg.stylePrefix;
  const outputDir = args.output_dir || currentOutputDir || cfg.outputDir;
  const rawRefImages = args.reference_images || undefined;
  const model = args.model || currentModel || cfg.model;

  process.stderr.write(`\n[handleParallelGenerate] ── ENTER ──\n`);
  process.stderr.write(`[handleParallelGenerate] count: ${count}, prompt: "${prompt.slice(0, 80)}"\n`);
  if (rawRefImages && rawRefImages.length > 0) {
    process.stderr.write(`[handleParallelGenerate] RAW reference_images from client: ${rawRefImages.length} item(s)\n`);
    rawRefImages.forEach((img: string, i: number) => {
      process.stderr.write(`[handleParallelGenerate]   #${i + 1}: type=${typeof img}, len=${img?.length}, preview="${(img || '').slice(0, 80)}"\n`);
    });
  } else {
    process.stderr.write(`[handleParallelGenerate] reference_images: none\n`);
  }

  let enrichedPrompt = prompt;
  if (stylePrefix) {
    enrichedPrompt = `${stylePrefix}\n\n${prompt}`;
  }

  let apiRefImages: string[] | undefined;
  if (rawRefImages && rawRefImages.length > 0) {
    try {
      apiRefImages = await prepareReferenceImages(rawRefImages);
    } catch (e: any) {
      return { content: [{ type: 'text', text: `Error preparing reference images: ${e.message}` }] };
    }
  }

  const userEntryId = genId();
  const preSession = getOrCreateSession(nameOrId);
  const sessionId = preSession.id;

  const savedRefImages = rawRefImages && rawRefImages.length > 0
    ? await saveRefImagesToLocal(rawRefImages, sessionId, userEntryId, outputDir || undefined).catch(() => rawRefImages)
    : undefined;

  const userEntry: ConvEntry = {
    id: userEntryId,
    type: 'user',
    prompt: `${prompt} (${count} parallel)`,
    timestamp: nowMs(),
    size,
    model,
    refImages: savedRefImages,
  };

  const batchId = genId();
  const initialTasks: BatchTask[] = Array.from({ length: count }, (_, i) => ({
    id: i, status: 'loading' as const,
  }));

  const assistantId = genId();
  const loadingEntry: ConvEntry = {
    id: assistantId,
    type: 'assistant',
    loading: true,
    timestamp: nowMs(),
    size,
    model,
    batchId,
    batchTotal: count,
    batchImages: initialTasks,
  };

  const initialConv = appendEntriesToSession(nameOrId, [userEntry, loadingEntry]);

  const isBackground = args.background === true || args.background === 'true';

  if (isBackground) {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    activeJobs.set(jobId, {
      jobId,
      status: 'running',
      total: count,
      completed: 0,
      errors: 0,
      startTime: nowMs(),
      sessionId,
      entryId: assistantId,
      images: [],
      cancelled: false,
    });
    handleRunParallelJob(jobId, cfg, enrichedPrompt, model, size, apiRefImages, count, sessionId, assistantId, outputDir, sendNotification).catch(() => {});
    return {
      content: [{
        type: 'text',
        text: [
          `Generation started in background.`,
          `Job ID: ${jobId}`,
          `Session ID: ${sessionId}`,
          `Tasks: ${count} images`,
          ``,
          `Use 'get_job_status' tool to check progress (pass job_id: "${jobId}").`,
          `Images will be saved to session and visible in the MCP session panel.`,
        ].join('\n'),
      }],
    };
  }

  const startTime = nowMs();
  const allImages: string[] = [];
  const batchImages: BatchTask[] = [];
  let errorCount = 0;
  let completedCount = 0;

  const notifyProgress = () => {
    if (sendNotification) {
      if (progressToken != null) {
        sendNotification('notifications/progress', {
          progressToken,
          progress: completedCount,
          total: count,
          message: `Generated ${completedCount}/${count} images${errorCount > 0 ? ` (${errorCount} failed)` : ''}`,
        });
      }
      sendNotification('notifications/message', {
        level: 'info',
        logger: 'image-gen',
        data: `Progress: ${completedCount}/${count} completed, ${errorCount} errors`,
      });
    }
  };

  if (sendNotification) {
    if (progressToken != null) {
      sendNotification('notifications/progress', { progressToken, progress: 0, total: count, message: `Starting ${count} parallel image generation...` });
    }
    sendNotification('notifications/message', { level: 'info', logger: 'image-gen', data: `Starting parallel generation: ${count} images, prompt: ${enrichedPrompt.slice(0, 80)}` });
  }

  const KEEPALIVE_INTERVAL_MS = 3000;
  const keepaliveTimer = sendNotification
    ? setInterval(() => {
        const elapsed = Math.round((nowMs() - startTime) / 1000);
        if (progressToken != null) {
          sendNotification('notifications/progress', {
            progressToken,
            progress: completedCount,
            total: count,
            message: `[keepalive] ${completedCount}/${count} done (${elapsed}s elapsed)${errorCount > 0 ? `, ${errorCount} errors` : ''}`,
          });
        }
        sendNotification('notifications/message', {
          level: 'info',
          logger: 'image-gen',
          data: `[keepalive] Still generating: ${completedCount}/${count} done, ${elapsed}s elapsed`,
        });
      }, KEEPALIVE_INTERVAL_MS)
    : null;

  const apiKeepalive = sendNotification
    ? () => {
        const elapsed = Math.round((nowMs() - startTime) / 1000);
        sendNotification('notifications/message', {
          level: 'info',
          logger: 'image-gen',
          data: `[keepalive] API polling... ${completedCount}/${count} done, ${elapsed}s elapsed`,
        });
      }
    : undefined;

  const updateProgress = () => {
    try {
      const conv = getOrCreateSession(sessionId);
      const entryIdx = conv.entries.findIndex(e => e.id === assistantId);
      if (entryIdx >= 0) {
        conv.entries[entryIdx] = {
          ...conv.entries[entryIdx],
          batchImages: [...batchImages],
          timestamp: nowMs(),
        };
        conv.updatedAt = nowMs();
        saveSession(conv);
      }
    } catch {}
    notifyProgress();
  };

  const BATCH_SIZE = 5;
  for (let batchStart = 0; batchStart < count; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, count);
    const promises: Promise<void>[] = [];
    for (let i = batchStart; i < batchEnd; i++) {
      const idx = i;
      promises.push((async () => {
        const result = await callImageApi(cfg.apiUrl, cfg.apiKey, model, enrichedPrompt, size, apiRefImages, apiKeepalive);
        if (result.images.length > 0) {
          try {
            const localPath = await saveImageToLocal(result.images[0], sessionId, assistantId, idx, outputDir || undefined);
            batchImages[idx] = { id: idx, status: 'success', image: localPath };
            allImages[idx] = localPath;
          } catch {
            batchImages[idx] = { id: idx, status: 'success', image: result.images[0] };
            allImages[idx] = result.images[0];
          }
        } else {
          batchImages[idx] = { id: idx, status: 'failed', error: result.error || 'Unknown error' };
          errorCount++;
        }
        completedCount++;
        updateProgress();
      })());
    }
    await Promise.allSettled(promises);
    updateProgress();
  }

  if (keepaliveTimer) clearInterval(keepaliveTimer);

  if (sendNotification) {
    if (progressToken != null) {
      sendNotification('notifications/progress', { progressToken, progress: count, total: count, message: `Complete: ${count - errorCount}/${count} succeeded` });
    }
    sendNotification('notifications/message', { level: 'info', logger: 'image-gen', data: `Parallel generation complete: ${count - errorCount}/${count} succeeded in ${((nowMs() - startTime) / 1000).toFixed(1)}s` });
  }

  const endTime = nowMs();
  const finalEntry: ConvEntry = {
    id: assistantId,
    type: 'assistant',
    loading: false,
    images: allImages.filter(Boolean),
    error: allImages.filter(Boolean).length === 0 ? `All ${errorCount} tasks failed` : undefined,
    timestamp: nowMs(),
    size,
    model,
    duration: endTime - startTime,
    completedAt: endTime,
    imageCount: allImages.filter(Boolean).length,
    batchId,
    batchTotal: count,
    batchImages,
    batchErrors: errorCount,
  };

  const conv = getOrCreateSession(sessionId);
  const entryIdx = conv.entries.findIndex(e => e.id === assistantId);
  if (entryIdx >= 0) {
    conv.entries[entryIdx] = finalEntry;
  } else {
    conv.entries.push(finalEntry);
  }
  conv.updatedAt = nowMs();
  saveSession(conv);

  const successCount = allImages.filter(Boolean).length;
  return {
    content: [
      {
        type: 'text',
        text: `Parallel generation complete: ${successCount}/${count} succeeded${errorCount > 0 ? `, ${errorCount} failed` : ''}.\n${allImages.filter(Boolean).map((p, i) => `Image ${i + 1}: ${p}`).join('\n')}`,
      },
    ],
  };
}

function handleSetStyle(args: any): any {
  currentStyle = args.style || '';
  return {
    content: [
      { type: 'text', text: currentStyle ? `Style set to: ${currentStyle}` : 'Style cleared.' },
    ],
  };
}

function handleSetOutputDir(args: any): any {
  const dir = args.output_dir || args.dir || '';
  if (dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      currentOutputDir = dir;
      return { content: [{ type: 'text', text: `Output directory set to: ${dir}` }] };
    } catch (e: any) {
      return { content: [{ type: 'text', text: `Failed to set output directory: ${e.message}` }] };
    }
  }
  currentOutputDir = '';
  return { content: [{ type: 'text', text: 'Output directory cleared.' }] };
}

function handleGetStatus(): any {
  const cfg = loadMcpConfig();
  const hasConfig = !!cfg.apiKey;
  const all = loadAllMcpConversations();
  cleanupOldJobs();
  const runningJobs = [...activeJobs.values()].filter(j => j.status === 'running');
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          configured: hasConfig,
          provider: cfg.providerId || 'default',
          model: currentModel || cfg.model,
          apiUrl: cfg.apiUrl,
          defaultSize: currentSize || cfg.defaultSize,
          currentStyle: currentStyle || cfg.stylePrefix || '(none)',
          outputDir: currentOutputDir || cfg.outputDir || '(default session dir)',
          defaultSessionId,
          existingSessions: all.map(c => ({ id: c.id, title: c.title, entries: c.entries.length })),
          activeJobs: runningJobs.map(j => ({
            jobId: j.jobId,
            status: j.status,
            progress: `${j.completed}/${j.total}`,
            errors: j.errors,
            elapsed: `${Math.round((nowMs() - j.startTime) / 1000)}s`,
          })),
        }, null, 2),
      },
    ],
  };
}

function handleSetConfig(args: any): any {
  if (args.model) currentModel = args.model;
  if (args.size) currentSize = args.size;
  if (args.style !== undefined) currentStyle = args.style;
  if (args.output_dir !== undefined) currentOutputDir = args.output_dir;
  return {
    content: [{ type: 'text', text: `Config updated. model=${currentModel || '(default)'}, size=${currentSize}, style=${currentStyle || '(none)'}, outputDir=${currentOutputDir || '(default)'}` }],
  };
}

function handleListJobs(): any {
  const jobs = listAllJobs();
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        jobs: jobs.map(j => ({
          jobId: j.jobId,
          status: j.status,
          progress: `${j.completed}/${j.total}`,
          errors: j.errors,
          elapsed: j.endTime ? `${((j.endTime - j.startTime) / 1000).toFixed(1)}s` : `${Math.round((nowMs() - j.startTime) / 1000)}s`,
          sessionId: j.sessionId,
          imageCount: j.images.length,
        })),
        total: jobs.length,
      }, null, 2),
    }],
  };
}

function handleGetJobStatus(args: any): any {
  const jobId = args.job_id;
  if (!jobId) {
    return { content: [{ type: 'text', text: 'Error: job_id is required.' }] };
  }
  const job = getJob(jobId);
  if (!job) {
    return { content: [{ type: 'text', text: `Job not found: ${jobId}. Use list_jobs to see all jobs.` }] };
  }
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        jobId: job.jobId,
        status: job.status,
        progress: `${job.completed}/${job.total}`,
        errors: job.errors,
        cancelled: job.cancelled,
        startTime: new Date(job.startTime).toISOString(),
        endTime: job.endTime ? new Date(job.endTime).toISOString() : null,
        elapsed: job.endTime
          ? `${((job.endTime - job.startTime) / 1000).toFixed(1)}s`
          : `${Math.round((nowMs() - job.startTime) / 1000)}s`,
        sessionId: job.sessionId,
        images: job.images,
      }, null, 2),
    }],
  };
}

function handleCancelJob(args: any): any {
  const jobId = args.job_id;
  if (!jobId) {
    return { content: [{ type: 'text', text: 'Error: job_id is required.' }] };
  }
  const ok = cancelJob(jobId);
  return {
    content: [{ type: 'text', text: ok ? `Job ${jobId} cancelled.` : `Job ${jobId} not found or not running.` }],
  };
}

export const TOOLS = [
  {
    name: 'generate_image',
    description: 'Generate a single image. Supports style presets, reference images, and custom output directory.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The text prompt describing the image to generate' },
        size: { type: 'string', description: 'Image size, e.g. 1024x1024, 1040x832, 1280x720' },
        style: { type: 'string', description: 'Style prefix to prepend to the prompt' },
        reference_images: { type: 'array', items: { type: 'string' }, description: 'Reference image paths, URLs, or base64 URIs. Max 6.' },
        model: { type: 'string', description: 'Model name override' },
        output_dir: { type: 'string', description: 'Directory to save generated images' },
        session_id: { type: 'string', description: 'Session identifier for grouping calls' },
        provider_id: { type: 'string', description: 'Provider ID to use' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_images_parallel',
    description: 'Generate multiple images in parallel from the same prompt. IMPORTANT: For count >= 3, always use background:true to avoid timeout. Returns immediately with jobId; poll progress with get_job_status tool.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The text prompt' },
        count: { type: 'number', description: 'Number of images (default: 2, max: 20)' },
        size: { type: 'string', description: 'Image size' },
        style: { type: 'string', description: 'Style prefix' },
        reference_images: { type: 'array', items: { type: 'string' }, description: 'Reference images' },
        model: { type: 'string', description: 'Model name override' },
        output_dir: { type: 'string', description: 'Directory to save images' },
        session_id: { type: 'string', description: 'Session identifier' },
        provider_id: { type: 'string', description: 'Provider ID' },
        background: { type: 'boolean', description: 'If true, start generation in background and return immediately with a jobId. Use get_job_status to poll.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'set_style',
    description: 'Set a style prefix prepended to all subsequent prompts. Pass empty string to clear.',
    inputSchema: {
      type: 'object',
      properties: {
        style: { type: 'string', description: 'Style description to prepend to prompts' },
      },
      required: ['style'],
    },
  },
  {
    name: 'set_output_dir',
    description: 'Set the directory where generated images will be saved.',
    inputSchema: {
      type: 'object',
      properties: {
        output_dir: { type: 'string', description: 'Absolute path to output directory' },
        dir: { type: 'string', description: 'Alias for output_dir' },
      },
    },
  },
  {
    name: 'set_config',
    description: 'Update runtime configuration (model, size, style, output directory).',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'Model name' },
        size: { type: 'string', description: 'Default image size' },
        style: { type: 'string', description: 'Style prefix' },
        output_dir: { type: 'string', description: 'Output directory' },
      },
    },
  },
  {
    name: 'get_status',
    description: 'Get current MCP server configuration and status.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_jobs',
    description: 'List all active and recent background image generation jobs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_job_status',
    description: 'Get the status of a specific background job. Returns progress, elapsed time, and image paths if completed. Poll every 5-10 seconds until status is completed/cancelled.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'The job ID returned by generate_images_parallel with background:true' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'cancel_job',
    description: 'Cancel a running background image generation job.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'The job ID to cancel' },
      },
      required: ['job_id'],
    },
  },
];

export type SendNotification = (method: string, params?: any) => void;

export async function handleJsonRpc(msg: any, sendNotification?: SendNotification): Promise<any> {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'image-gen-mcp',
          version: '1.1.0',
        },
      },
    };
  }

  if (method === 'notifications/initialized') {
    return null;
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};
    const progressToken = params?._meta?.progressToken;

    try {
      let result: any;
      switch (toolName) {
        case 'generate_image':
          result = await handleGenerateImage(args, progressToken, sendNotification);
          break;
        case 'generate_images_parallel':
          result = await handleParallelGenerate(args, progressToken, sendNotification);
          break;
        case 'set_style':
          result = handleSetStyle(args);
          break;
        case 'set_output_dir':
          result = handleSetOutputDir(args);
          break;
        case 'set_config':
          result = handleSetConfig(args);
          break;
        case 'get_status':
          result = handleGetStatus();
          break;
        case 'list_jobs':
          result = handleListJobs();
          break;
        case 'get_job_status':
          result = handleGetJobStatus(args);
          break;
        case 'cancel_job':
          result = handleCancelJob(args);
          break;
        default:
          return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${toolName}` } };
      }
      return { jsonrpc: '2.0', id, result };
    } catch (e: any) {
      return { jsonrpc: '2.0', id, error: { code: -32603, message: `Tool execution error: ${e.message}` } };
    }
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } };
}
