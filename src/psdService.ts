import { readPsd, writePsd, type Layer, type Psd } from 'ag-psd';

export interface PsdLayerInfo {
  id: string;
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
  hidden: boolean;
  previewDataUrl: string;
  children?: PsdLayerInfo[];
}

export interface LayerBox {
  name: string;
  /** 相对坐标 0~1 */
  left: number;
  top: number;
  right: number;
  bottom: number;
  z?: number;
}

function genId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function canvasToDataUrl(canvas: HTMLCanvasElement | OffscreenCanvas): string {
  if (canvas instanceof HTMLCanvasElement) {
    return canvas.toDataURL('image/png');
  }
  // OffscreenCanvas fallback: draw to temporary canvas
  const tmp = document.createElement('canvas');
  tmp.width = canvas.width;
  tmp.height = canvas.height;
  const ctx = tmp.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(canvas as OffscreenCanvas, 0, 0);
  return tmp.toDataURL('image/png');
}

async function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

export async function imageSourceToDataUrl(src: string, readLocalBase64: (path: string) => Promise<string>): Promise<string> {
  if (src.startsWith('data:')) return src;
  if (src.startsWith('http://') || src.startsWith('https://')) {
    const resp = await fetch(src);
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('网络图片读取失败'));
      reader.readAsDataURL(blob);
    });
  }
  return readLocalBase64(src);
}

function layerFromAg(layer: Layer, depth = 0): PsdLayerInfo {
  const left = layer.left ?? 0;
  const top = layer.top ?? 0;
  const right = layer.right ?? left;
  const bottom = layer.bottom ?? top;
  let previewDataUrl = '';
  if (layer.canvas) {
    previewDataUrl = canvasToDataUrl(layer.canvas as HTMLCanvasElement);
  }
  const children = layer.children?.map(c => layerFromAg(c, depth + 1));
  return {
    id: genId(),
    name: layer.name || `图层 ${depth}`,
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    opacity: typeof layer.opacity === 'number' ? layer.opacity : 1,
    hidden: !!layer.hidden,
    previewDataUrl,
    children: children && children.length > 0 ? children : undefined,
  };
}

export function parsePsdBuffer(buffer: ArrayBuffer): { width: number; height: number; layers: PsdLayerInfo[]; compositeDataUrl?: string } {
  const psd = readPsd(buffer, { useImageData: false });
  const layers = (psd.children || []).map(c => layerFromAg(c));
  let compositeDataUrl: string | undefined;
  if (psd.canvas) {
    compositeDataUrl = canvasToDataUrl(psd.canvas as HTMLCanvasElement);
  }
  return {
    width: psd.width,
    height: psd.height,
    layers,
    compositeDataUrl,
  };
}

/** 追加在提取模块 prompt 后，要求产出 PSD 定位信息 */
export const PSD_PLACEMENT_APPENDIX = `

---

## PSD 图层定位（必须输出）
在完成所有「### 生成提示词 - 分组N」之后，额外输出以下区块（用于把拆出的图按原图位置拼成 PSD）：

### PSD图层定位
\`\`\`json
{
  "layers": [
    { "group": 1, "name": "完整页面底图", "left": 0, "top": 0, "right": 1, "bottom": 1 },
    { "group": 2, "name": "主面板", "left": 0.1, "top": 0.15, "right": 0.9, "bottom": 0.85 }
  ]
}
\`\`\`

规则：
1. group 对应「生成提示词 - 分组N」的编号。
2. left/top/right/bottom 为相对原图宽高的比例（0~1），表示该分组素材在原图中的大致位置。
3. 页面底图通常接近全图 (0,0,1,1)。
4. 网格合图类分组可给整组在画面中的大致区域；无法判断时可给居中区域。
`;

export function parseExtractGroupPrompts(text: string): { prompts: string[]; titles: string[] } {
  const prompts: string[] = [];
  const titles: string[] = [];
  const groupRegex = /### 生成提示词\s*[-–—]\s*分组(\d+)\s*([\s\S]*?)(?=### 生成提示词|### PSD图层定位|$)/g;
  let m;
  while ((m = groupRegex.exec(text)) !== null) {
    titles.push(`分组${m[1]}`);
    prompts.push(m[2].trim());
  }
  if (prompts.length === 0) {
    const fallback = text.match(/### 生成提示词\s*([\s\S]*?)(?=### PSD图层定位|$)/);
    if (fallback?.[1]?.trim()) {
      prompts.push(fallback[1].trim());
      titles.push('分组1');
    }
  }
  return { prompts, titles };
}

export function parsePsdPlacementFromLlm(content: string): LayerBox[] {
  const section = content.match(/###\s*PSD图层定位\s*([\s\S]*?)(?=###\s|$)/i);
  let jsonStr = (section?.[1] || content).trim();
  const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) jsonStr = fence[1].trim();
  const objMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!objMatch) return [];
  try {
    const parsed = JSON.parse(objMatch[0]) as {
      layers?: Array<LayerBox & { group?: number; name?: string }>;
    };
    if (!parsed.layers?.length) return [];
    return parsed.layers.map((l, i) => {
      const left = clamp01(Number(l.left));
      const top = clamp01(Number(l.top));
      const right = clamp01(Number(l.right));
      const bottom = clamp01(Number(l.bottom));
      return {
        name: (l.name || `分组${l.group ?? i + 1}`).toString(),
        left: Math.min(left, right),
        top: Math.min(top, bottom),
        right: Math.max(left, right),
        bottom: Math.max(top, bottom),
        z: typeof l.group === 'number' ? l.group - 1 : i,
      };
    }).filter(l => l.right - l.left > 0.01 && l.bottom - l.top > 0.01);
  } catch {
    return [];
  }
}

export function stripAnalysisForDisplay(text: string): string {
  return text
    .replace(/### 生成提示词[\s\S]*$/m, '')
    .replace(/###\s*PSD图层定位[\s\S]*$/im, '')
    .trim();
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export async function cropLayerBoxesToCanvases(
  imageDataUrl: string,
  boxes: LayerBox[],
): Promise<{ width: number; height: number; layerInfos: PsdLayerInfo[]; layerCanvases: { name: string; left: number; top: number; canvas: HTMLCanvasElement }[] }> {
  const img = await loadImageElement(imageDataUrl);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  const layerCanvases: { name: string; left: number; top: number; canvas: HTMLCanvasElement }[] = [];
  const layerInfos: PsdLayerInfo[] = [];

  for (const box of boxes) {
    const left = Math.round(box.left * width);
    const top = Math.round(box.top * height);
    const right = Math.round(box.right * width);
    const bottom = Math.round(box.bottom * height);
    const w = Math.max(1, right - left);
    const h = Math.max(1, bottom - top);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 canvas');
    ctx.drawImage(img, left, top, w, h, 0, 0, w, h);

    layerCanvases.push({ name: box.name, left, top, canvas });
    layerInfos.push({
      id: genId(),
      name: box.name,
      left,
      top,
      width: w,
      height: h,
      opacity: 1,
      hidden: false,
      previewDataUrl: canvas.toDataURL('image/png'),
    });
  }

  return { width, height, layerInfos, layerCanvases };
}

export function buildPsdFromLayerCanvases(
  width: number,
  height: number,
  layerCanvases: { name: string; left: number; top: number; canvas: HTMLCanvasElement }[],
  compositeSource?: HTMLCanvasElement | HTMLImageElement,
): ArrayBuffer {
  const children: Layer[] = layerCanvases.map(l => ({
    name: l.name,
    left: l.left,
    top: l.top,
    canvas: l.canvas,
    opacity: 1,
    blendMode: 'normal',
  }));

  const composite = document.createElement('canvas');
  composite.width = width;
  composite.height = height;
  const ctx = composite.getContext('2d');
  if (ctx) {
    if (compositeSource) {
      ctx.drawImage(compositeSource, 0, 0, width, height);
    } else {
      for (const l of layerCanvases) {
        ctx.drawImage(l.canvas, l.left, l.top);
      }
    }
  }

  const psd: Psd = {
    width,
    height,
    children,
    canvas: composite,
  };

  return writePsd(psd, { generateThumbnail: true, trimImageData: false, noBackground: true });
}

export async function exportBoxesToPsdBuffer(imageDataUrl: string, boxes: LayerBox[]): Promise<{
  buffer: ArrayBuffer;
  width: number;
  height: number;
  layers: PsdLayerInfo[];
}> {
  const { width, height, layerInfos, layerCanvases } = await cropLayerBoxesToCanvases(imageDataUrl, boxes);
  const img = await loadImageElement(imageDataUrl);
  const buffer = buildPsdFromLayerCanvases(width, height, layerCanvases, img);
  return { buffer, width, height, layers: layerInfos };
}

function ensureDataUrl(src: string): string {
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) return src;
  return `data:image/png;base64,${src}`;
}

/**
 * 将提取模块拆出的多张图，按定位框（或居中）叠到原图尺寸画布上，写出 PSD。
 * 底层默认放入原图作为「原图参考」。
 */
export async function exportExtractedImagesToPsd(
  sourceDataUrl: string,
  extracted: { name: string; dataUrl: string; box?: LayerBox }[],
  options?: { includeSourceLayer?: boolean },
): Promise<{ buffer: ArrayBuffer; width: number; height: number; layers: PsdLayerInfo[] }> {
  const source = await loadImageElement(ensureDataUrl(sourceDataUrl));
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  const includeSource = options?.includeSourceLayer !== false;

  const layerCanvases: { name: string; left: number; top: number; canvas: HTMLCanvasElement }[] = [];
  const layerInfos: PsdLayerInfo[] = [];

  if (includeSource) {
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = width;
    srcCanvas.height = height;
    const sctx = srcCanvas.getContext('2d');
    if (!sctx) throw new Error('无法创建 canvas');
    sctx.drawImage(source, 0, 0, width, height);
    layerCanvases.push({ name: '原图参考', left: 0, top: 0, canvas: srcCanvas });
    layerInfos.push({
      id: genId(),
      name: '原图参考',
      left: 0,
      top: 0,
      width,
      height,
      opacity: 1,
      hidden: false,
      previewDataUrl: srcCanvas.toDataURL('image/png'),
    });
  }

  for (const item of extracted) {
    const img = await loadImageElement(ensureDataUrl(item.dataUrl));
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas');
    let left = 0;
    let top = 0;
    let w = iw;
    let h = ih;

    if (item.box) {
      left = Math.round(item.box.left * width);
      top = Math.round(item.box.top * height);
      w = Math.max(1, Math.round((item.box.right - item.box.left) * width));
      h = Math.max(1, Math.round((item.box.bottom - item.box.top) * height));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0, w, h);
    } else {
      // 无定位：居中放置，且不超过画布
      const scale = Math.min(1, width / iw, height / ih);
      w = Math.max(1, Math.round(iw * scale));
      h = Math.max(1, Math.round(ih * scale));
      left = Math.round((width - w) / 2);
      top = Math.round((height - h) / 2);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0, w, h);
    }

    layerCanvases.push({ name: item.name, left, top, canvas });
    layerInfos.push({
      id: genId(),
      name: item.name,
      left,
      top,
      width: w,
      height: h,
      opacity: 1,
      hidden: false,
      previewDataUrl: canvas.toDataURL('image/png'),
    });
  }

  const buffer = buildPsdFromLayerCanvases(width, height, layerCanvases, source);
  return { buffer, width, height, layers: layerInfos };
}

export async function layersToPsdBuffer(
  width: number,
  height: number,
  layers: PsdLayerInfo[],
  compositeDataUrl?: string,
): Promise<ArrayBuffer> {
  const layerCanvases: { name: string; left: number; top: number; canvas: HTMLCanvasElement }[] = [];

  async function walk(list: PsdLayerInfo[]) {
    for (const layer of list) {
      if (layer.children?.length) {
        await walk(layer.children);
        continue;
      }
      if (!layer.previewDataUrl || layer.width <= 0 || layer.height <= 0) continue;
      const img = await loadImageElement(layer.previewDataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = layer.width;
      canvas.height = layer.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0, layer.width, layer.height);
      layerCanvases.push({ name: layer.name, left: layer.left, top: layer.top, canvas });
    }
  }

  await walk(layers);

  let compositeSource: HTMLImageElement | undefined;
  if (compositeDataUrl) {
    compositeSource = await loadImageElement(compositeDataUrl);
  }

  return buildPsdFromLayerCanvases(width, height, layerCanvases, compositeSource);
}

export function downloadArrayBuffer(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function flattenLayerTree(layers: PsdLayerInfo[]): PsdLayerInfo[] {
  const out: PsdLayerInfo[] = [];
  const walk = (list: PsdLayerInfo[]) => {
    for (const l of list) {
      out.push(l);
      if (l.children?.length) walk(l.children);
    }
  };
  walk(layers);
  return out;
}
