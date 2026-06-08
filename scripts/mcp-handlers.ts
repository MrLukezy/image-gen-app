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
  const diskObj = {
    id: conv.id,
    title: conv.title,
    entries: conv.entries,
    created_at: conv.createdAt,
    updated_at: conv.updatedAt,
    source: conv.source || 'mcp',
  };
  fs.writeFileSync(metaPath, JSON.stringify(diskObj, null, 2), 'utf-8');
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
): Promise<{ images: string[]; error: string | null }> {
  const payload = JSON.stringify({
    model,
    prompt,
    reference_images: referenceImages && referenceImages.length > 0 ? referenceImages : undefined,
    size,
    n: 1,
    response_format: 'b64_json',
  });

  const url = new URL(apiUrl);
  const options = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  };

  try {
    const resp = await httpRequest(options, payload);
    if (resp.status !== 200) {
      return { images: [], error: `HTTP ${resp.status}: ${resp.body.slice(0, 500)}` };
    }

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
  } else if (imageData.startsWith('http')) {
    const url = new URL(imageData);
    const lib = url.protocol === 'http:' ? http : https;
    await new Promise<void>((resolve, reject) => {
      lib.get(imageData, (res: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          fs.writeFileSync(fpath, Buffer.concat(chunks));
          resolve();
        });
        res.on('error', reject);
      }).on('error', reject);
    });
  } else {
    fs.writeFileSync(fpath, Buffer.from(imageData, 'base64'));
  }

  return fpath;
}

async function prepareReferenceImages(images: string[]): Promise<string[]> {
  const prepared: string[] = [];
  for (const img of images) {
    if (img.startsWith('data:') || img.startsWith('http://') || img.startsWith('https://')) {
      prepared.push(img);
    } else if (fs.existsSync(img) && fs.statSync(img).isFile()) {
      try {
        const bytes = fs.readFileSync(img);
        const ext = path.extname(img).toLowerCase().slice(1) || 'png';
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                   : ext === 'webp' ? 'image/webp'
                   : ext === 'gif' ? 'image/gif'
                   : 'image/png';
        const b64 = Buffer.from(bytes).toString('base64');
        prepared.push(`${mime};base64,${b64}`);
      } catch {
        prepared.push(img);
      }
    } else if (/^[A-Za-z0-9+/=]{20,}$/.test(img)) {
      prepared.push(`data:image/png;base64,${img}`);
    } else {
      try {
        const bytes = fs.readFileSync(img);
        const b64 = Buffer.from(bytes).toString('base64');
        prepared.push(`data:image/png;base64,${b64}`);
      } catch {
        prepared.push(img);
      }
    }
  }
  const total = prepared.reduce((s, p) => s + p.length, 0);
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

async function handleGenerateImage(args: any): Promise<any> {
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

  const userEntry: ConvEntry = {
    id: genId(),
    type: 'user',
    prompt,
    timestamp: nowMs(),
    size,
    model,
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
  const sessionId = initialConv.id;

  const startTime = nowMs();
  const result = await callImageApi(cfg.apiUrl, cfg.apiKey, model, enrichedPrompt, size, apiRefImages);
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

async function handleParallelGenerate(args: any): Promise<any> {
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

  const userEntry: ConvEntry = {
    id: genId(),
    type: 'user',
    prompt: `${prompt} (${count} parallel)`,
    timestamp: nowMs(),
    size,
    model,
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
  const sessionId = initialConv.id;

  const startTime = nowMs();
  const allImages: string[] = [];
  const batchImages: BatchTask[] = [];
  let errorCount = 0;

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
  };

  const BATCH_SIZE = 5;
  for (let batchStart = 0; batchStart < count; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, count);
    const promises: Promise<void>[] = [];
    for (let i = batchStart; i < batchEnd; i++) {
      const idx = i;
      promises.push((async () => {
        const result = await callImageApi(cfg.apiUrl, cfg.apiKey, model, enrichedPrompt, size, apiRefImages);
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
        updateProgress();
      })());
    }
    await Promise.allSettled(promises);
    updateProgress();
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
    description: 'Generate multiple images in parallel from the same prompt.',
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
];

export async function handleJsonRpc(msg: any): Promise<any> {
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
          version: '1.0.0',
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

    try {
      let result: any;
      switch (toolName) {
        case 'generate_image':
          result = await handleGenerateImage(args);
          break;
        case 'generate_images_parallel':
          result = await handleParallelGenerate(args);
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
