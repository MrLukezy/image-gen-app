import { writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

const API_KEY = process.argv[2] || 'sk-TrMSFvkoCYd5flGiJGuTNKDwxvunzw2Lw1AlvWbHeaY0Y0lg';
const API_URL = process.argv[3] || 'https://www.hfsyapi.cn/v1/images/generations';
const MODEL   = process.argv[4] || 'gpt-image-2';
const CONCURRENCY = 10;
const SIZE = '512x512';

// ─── Preset Definitions ────────────────────────────────────────────────────────

const CATEGORIES = [
  {
    id: 'style',
    subject: 'A serene landscape with mountains and a lake',
    presets: [
      { label: '油画', value: 'oil painting, rich brushstrokes, canvas texture', extra: 'thick impasto, visible palette knife work' },
      { label: '水彩', value: 'watercolor painting, soft washes, translucent layers', extra: 'wet on wet technique, paper texture visible' },
      { label: '素描', value: 'pencil sketch, graphite shading, crosshatching, hand-drawn', extra: 'white paper, monochrome graphite' },
      { label: '数字绘画', value: 'digital painting, smooth rendering, concept art', extra: 'highly polished digital art' },
      { label: '动漫', value: 'anime style, cel-shaded, vibrant, manga illustration', extra: 'Japanese anime key visual' },
      { label: '吉卜力', value: 'Studio Ghibli style, soft pastel, whimsical, hand-drawn anime', extra: 'Miyazaki inspired' },
      { label: '像素艺术', value: 'pixel art, retro 8-bit, pixelated sprites', extra: '16 color palette, retro game aesthetic' },
      { label: '3D渲染', value: '3D render, octane render, physically based rendering, CGI', extra: 'photorealistic 3D scene' },
      { label: '概念艺术', value: 'concept art, professional illustration, industry standard', extra: 'epic concept art for film or game' },
      { label: '赛博朋克', value: 'cyberpunk aesthetic, neon glow, futuristic, dystopian', extra: 'rainy neon-lit street' },
      { label: '蒸汽朋克', value: 'steampunk aesthetic, gears, brass, Victorian machinery', extra: 'Victorian London with clockwork' },
      { label: '哥特式', value: 'gothic style, dark cathedral, ornate, dramatic', extra: 'spires, stained glass windows' },
      { label: '极简主义', value: 'minimalist design, clean lines, simple shapes, less is more', extra: 'white space, geometric forms' },
      { label: '波普艺术', value: 'pop art, bold colors, halftone dots, comic book style', extra: 'Andy Warhol inspired, bold primary colors' },
      { label: '浮世绘', value: 'ukiyo-e style, Japanese woodblock print, flat colors, traditional', extra: 'Hokusai wave style' },
      { label: '印象派', value: 'impressionist painting, visible brushstrokes, light and color', extra: 'Monet inspired, plein air' },
      { label: '超现实主义', value: 'surrealism, dreamlike, impossible, Salvador Dali inspired', extra: 'melting clocks, floating objects' },
      { label: '新艺术', value: 'Art Nouveau, flowing organic lines, Alphonse Mucha style, ornamental', extra: 'decorative border, floral motifs' },
      { label: 'Low Poly', value: 'low poly art, geometric, faceted, 3D minimalist', extra: 'pastel low poly landscape' },
      { label: '写实', value: 'photorealistic, hyperrealistic, ultra detailed, lifelike', extra: 'DSLR photograph, nature magazine quality' },
    ],
  },
  {
    id: 'lighting',
    subject: 'An old stone cottage in a forest clearing',
    presets: [
      { label: '电影光效', value: 'cinematic lighting, dramatic shadows, moody atmosphere', extra: 'anamorphic lens flare' },
      { label: '金色时刻', value: 'golden hour lighting, warm sunlight, soft glow, magic hour', extra: 'sunset casting long shadows' },
      { label: '蓝色时刻', value: 'blue hour, cool twilight, soft ambient light', extra: 'dusk, peaceful blue sky' },
      { label: '体积光', value: 'volumetric lighting, god rays, light shafts, atmospheric', extra: 'sunlight filtering through mist' },
      { label: '边缘光', value: 'rim lighting, backlit, glowing outline, silhouette', extra: 'figure outlined by bright light from behind' },
      { label: '影棚光', value: 'studio lighting, professional three-point lighting setup', extra: 'key light, fill light, hair light' },
      { label: '自然光', value: 'natural lighting, soft diffused daylight', extra: 'overcast day, even illumination' },
      { label: '霓虹灯光', value: 'neon lights, colorful glow, cyberpunk nightlife', extra: 'pink and cyan neon signs' },
      { label: '烛光', value: 'candlelight, warm flicker, intimate atmosphere', extra: 'multiple candles casting warm shadows' },
      { label: '月光', value: 'moonlight, cool blue cast, night scene, ethereal', extra: 'full moon, silvery glow on trees' },
      { label: '逆光', value: 'backlight, silhouette, strong contrast, dark foreground', extra: 'sun behind subject, dramatic silhouette' },
      { label: 'HDR', value: 'HDR, high dynamic range, rich detail in highlights and shadows', extra: 'balanced exposure, vivid colors' },
      { label: '暗调', value: 'low-key lighting, dark moody, deep shadows, chiaroscuro', extra: 'Caravaggio style, single light source' },
      { label: '亮调', value: 'high-key lighting, bright, clean, minimal shadows', extra: 'airy, bright white tones dominate' },
    ],
  },
  {
    id: 'quality',
    subject: 'A detailed mechanical pocket watch',
    presets: [
      { label: '高清8K', value: '8K UHD, ultra high definition, extremely detailed', extra: 'every gear visible' },
      { label: '超精细', value: 'highly detailed, intricate details, sharp focus', extra: 'microscopic attention to craftsmanship' },
      { label: '大师级', value: 'masterpiece, best quality, award-winning', extra: 'museum quality, fine art' },
      { label: '专业级', value: 'professional quality, polished, industry standard', extra: 'product photography standard' },
      { label: '照片级真实', value: 'photorealistic, lifelike, DSLR quality', extra: 'indistinguishable from photograph' },
      { label: '虚幻引擎', value: 'unreal engine 5, UE5 render, real-time ray tracing', extra: 'nanite and lumen technology' },
      { label: '电影画质', value: 'cinematic quality, film grain, anamorphic lens', extra: 'shot on ARRI Alexa, 35mm anamorphic' },
      { label: '锐利清晰', value: 'sharp focus, tack sharp, crystal clear details', extra: 'tack sharp macro photography' },
      { label: '柔和细腻', value: 'soft focus, painterly, gentle rendering', extra: 'dreamy soft focus, romantic' },
      { label: '精致纹理', value: 'detailed textures, PBR materials, surface detail', extra: 'metal scratches, patina visible' },
    ],
  },
  {
    id: 'camera',
    subject: 'A red rose with morning dew',
    presets: [
      { label: '人像镜头', value: 'portrait lens, shallow depth of field, bokeh, 85mm', extra: 'creamy bokeh background' },
      { label: '广角镜头', value: 'wide angle lens, expansive view, 24mm', extra: 'vast environment, rose in foreground' },
      { label: '长焦镜头', value: 'telephoto lens, compressed perspective, 200mm', extra: 'background compression, isolated subject' },
      { label: '微距', value: 'macro photography, extreme close-up, tiny details', extra: '1:1 magnification, water droplets visible' },
      { label: '鱼眼', value: 'fisheye lens, barrel distortion, ultra-wide', extra: '180-degree field of view, strong curvature' },
      { label: '航拍', value: 'aerial photography, drone shot, bird eye view', extra: 'garden seen from above, rose patch visible' },
      { label: '倾斜构图', value: 'dutch angle, tilted framing, dynamic tension', extra: 'frame tilted 30 degrees, dramatic' },
      { label: '景深', value: 'shallow depth of field, bokeh, lens blur', extra: 'only petals in focus, dreamy background' },
      { label: '全景', value: 'panoramic view, 360 degree, ultra-wide', extra: 'wide rose garden panorama, sweeping view' },
      { label: '移轴', value: 'tilt-shift photography, miniature effect, selective focus', extra: 'miniature rose garden, tilt-shift blur' },
      { label: '复古胶片', value: 'vintage film, 35mm analog, Kodak Portra 400', extra: 'film grain, warm analog tones' },
      { label: '暗角', value: 'vignetting, darkened corners, center focus', extra: 'strong vignette directing eye to rose' },
    ],
  },
  {
    id: 'mood',
    subject: 'A lone figure standing on a hilltop overlooking a valley',
    presets: [
      { label: '梦幻', value: 'dreamlike, ethereal, fantasy, magical', extra: 'floating particles, soft glow' },
      { label: '史诗', value: 'epic, grand, monumental, awe-inspiring', extra: 'dramatic sky, vast scale' },
      { label: '神秘', value: 'mysterious, enigmatic, dark, foreboding', extra: 'thick fog, unknown figure' },
      { label: '宁静', value: 'serene, peaceful, tranquil, calm atmosphere', extra: 'morning mist, still water below' },
      { label: '忧郁', value: 'melancholic, somber, moody, contemplative', extra: 'rain approaching, grey sky' },
      { label: '欢快', value: 'cheerful, joyful, vibrant, uplifting', extra: 'butterflies, sunshine, bright colors' },
      { label: '恐怖', value: 'horror, eerie, unsettling, creepy atmosphere', extra: 'dead trees, ravens, blood-red sunset' },
      { label: '浪漫', value: 'romantic, soft, intimate, tender', extra: 'sunset glow, rose petals in wind' },
      { label: '怀旧', value: 'nostalgic, vintage feel, retro, warm memories', extra: 'sepia tones, old film effect' },
      { label: '未来感', value: 'futuristic, sci-fi, advanced technology, utopian', extra: 'holographic valley, neon sky' },
      { label: '田园', value: 'pastoral, countryside, idyllic, rural beauty', extra: 'sheep grazing, wildflowers, idyllic' },
      { label: '紧张', value: 'tense, dramatic, suspenseful, high stakes', extra: 'storm clouds gathering, lightning in distance' },
    ],
  },
  {
    id: 'color',
    subject: 'An abstract still life with fruits and flowers on a table',
    presets: [
      { label: '鲜艳', value: 'vibrant colors, saturated, bold hues', extra: 'explosion of color, vivid palette' },
      { label: '粉彩', value: 'pastel colors, soft tones, cotton candy palette', extra: 'pink, lavender, mint, baby blue' },
      { label: '暖色调', value: 'warm color palette, amber, orange, gold tones', extra: 'autumn warmth, cozy fire tones' },
      { label: '冷色调', value: 'cool color palette, blue, teal, cyan tones', extra: 'ice blue, deep teal, frost' },
      { label: '黑白', value: 'black and white, monochrome, grayscale', extra: 'high contrast B&W, dramatic' },
      { label: '复古色调', value: 'vintage color grading, faded, analog film look', extra: 'faded warmth, old photograph' },
      { label: '高对比', value: 'high contrast, bold shadows, striking difference', extra: 'deep blacks and bright highlights' },
      { label: '低饱和', value: 'desaturated, muted tones, subtle colors', extra: 'nearly monochromatic, understated' },
      { label: '互补色', value: 'complementary colors, contrasting hues, color theory', extra: 'orange and blue dominant pairing' },
      { label: '单色调', value: 'monochromatic, single hue variations, harmonious', extra: 'all blue with varying saturations' },
      { label: '霓虹', value: 'neon colors, electric, glowing hues, vivid', extra: 'electric pink, glowing green, ultraviolet' },
      { label: '大地色', value: 'earth tones, natural browns, olive, warm neutrals', extra: 'sienna, olive green, raw umber' },
    ],
  },
  {
    id: 'composition',
    subject: 'A cat sitting on a wooden fence',
    presets: [
      { label: '特写', value: 'close-up shot, tight framing, facial details', extra: 'cat face close up, whiskers visible' },
      { label: '半身', value: 'medium shot, waist up, upper body framing', extra: 'cat from chest up, fence visible' },
      { label: '全身', value: 'full body shot, head to toe, complete figure', extra: 'whole cat visible, tail hanging' },
      { label: '三分法', value: 'rule of thirds composition, balanced framing', extra: 'cat positioned at thirds intersection' },
      { label: '居中对称', value: 'centered composition, symmetrical, balanced', extra: 'cat dead center, symmetrical background' },
      { label: '黄金比例', value: 'golden ratio composition, proportional harmony', extra: 'spiral composition, Fibonacci layout' },
      { label: '仰拍', value: 'low angle shot, looking up, imposing perspective', extra: 'camera on ground looking up at cat' },
      { label: '俯拍', value: 'high angle shot, looking down, diminishing perspective', extra: 'camera above looking down at cat' },
      { label: '鸟瞰', value: 'bird eye view, top-down perspective, aerial', extra: 'top-down view of cat on fence' },
      { label: '正面', value: 'front view, facing camera, direct perspective', extra: 'cat facing camera directly' },
      { label: '侧面', value: 'side profile, lateral view, silhouette', extra: 'perfect side profile silhouette' },
      { label: '背景虚化', value: 'shallow depth of field, blurred background, bokeh', extra: 'sharp cat, completely blurred background' },
    ],
  },
  {
    id: 'negative',
    subject: 'A portrait of a young woman',
    presets: [
      { label: '画质差', value: '[negative: low quality, worst quality, blurry, jpeg artifacts]', extra: '(show good quality reference)' },
      { label: '畸变', value: '[negative: deformed, distorted, disfigured, mutated]', extra: '(show well-formed reference)' },
      { label: '比例失调', value: '[negative: bad anatomy, bad proportions, extra limbs]', extra: '(show correct proportions reference)' },
      { label: '水印文字', value: '[negative: watermark, text, signature, logo, username]', extra: '(show clean reference)' },
      { label: '模糊低分辨率', value: '[negative: blurry, out of focus, low resolution, pixelated]', extra: '(show sharp reference)' },
      { label: '过曝欠曝', value: '[negative: overexposed, underexposed, blown highlights]', extra: '(show perfect exposure reference)' },
    ],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function slugify(label, idx) {
  return `${String(idx).padStart(2, '0')}_${label.replace(/[\s\/\\:*?"<>|]/g, '_')}`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function buildPrompt(cat, preset) {
  const extra = preset.extra ? `, ${preset.extra}` : '';
  return `${cat.subject}, ${preset.value}${extra}, single subject, clear composition, showcase ${cat.id} effect, no text, no watermark`;
}

async function callApi(prompt) {
  const body = {
    model: MODEL,
    prompt,
    size: SIZE,
    n: 1,
    response_format: 'b64_json',
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });

  const data = await res.json();

  if (data.data?.[0]?.b64_json) {
    return Buffer.from(data.data[0].b64_json, 'base64');
  }

  if (data.data?.[0]?.url) {
    const r = await fetch(data.data[0].url);
    return Buffer.from(await r.arrayBuffer());
  }

  if (data.result_url) {
    const r = await fetch(data.result_url);
    return Buffer.from(await r.arrayBuffer());
  }

  if (data.task_id) {
    const baseUrl = API_URL.replace(/\/[^/]+$/, '');
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      const poll = await fetch(`${baseUrl}/${data.task_id}`, {
        headers: { 'Authorization': `Bearer ${API_KEY}` },
      });
      const pollData = await poll.json();
      if (pollData.status === 'SUCCESS' || pollData.status === 'completed') {
        if (pollData.data?.[0]?.b64_json) {
          return Buffer.from(pollData.data[0].b64_json, 'base64');
        }
        if (pollData.data?.[0]?.url) {
          const r = await fetch(pollData.data[0].url);
          return Buffer.from(await r.arrayBuffer());
        }
      }
      if (pollData.status === 'FAILED' || pollData.status === 'error') {
        throw new Error('Async task failed: ' + JSON.stringify(pollData));
      }
      process.stdout.write(`  ⏱ poll ${i + 1}...\r`);
    }
    throw new Error('Timeout polling for async task');
  }

  if (data.error) {
    throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
  }

  throw new Error('Unknown response format: ' + JSON.stringify(data).slice(0, 200));
}

// ─── Parallel Runner ─────────────────────────────────────────────────────────────

async function runWithConcurrency(tasks, concurrency) {
  const results = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: concurrency }, worker);
  await Promise.all(workers);
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  if (!API_KEY || API_KEY.length < 5) {
    console.error('Error: API key required.');
    console.error('Usage: node scripts/generatePresets.mjs [API_KEY] [API_URL] [MODEL]');
    process.exit(1);
  }

  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│  Preset Thumbnail Generator                             │');
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log(`│  Model:      ${MODEL.padEnd(42)}│`);
  console.log(`│  Size:       ${SIZE.padEnd(42)}│`);
  console.log(`│  URL:        ${API_URL.replace(/^https?:\/\//, '').slice(0, 42).padEnd(42)}│`);
  console.log(`│  Concurrency:${String(CONCURRENCY).padEnd(42)}│`);
  console.log('└─────────────────────────────────────────────────────────┘\n');

  const allTasks = [];

  for (const cat of CATEGORIES) {
    const catDir = join(PUBLIC_DIR, 'presets', cat.id);
    await mkdir(catDir, { recursive: true });
    const existing = await readdir(catDir).catch(() => []);

    for (const [idx, preset] of cat.presets.entries()) {
      const filename = `${slugify(preset.label, idx)}.jpg`;
      if (existing.includes(filename)) {
        console.log(`  ⏩ [${cat.id}] ${preset.label} (already exists)`);
        continue;
      }
      allTasks.push({
        catId: cat.id,
        catName: cat.name,
        idx,
        total: cat.presets.length,
        filename,
        filepath: join(catDir, filename),
        prompt: buildPrompt(cat, preset),
        label: preset.label,
      });
    }
  }

  console.log(`\n📋 Total tasks: ${allTasks.length}\n`);

  const startTime = Date.now();

  const tasks = allTasks.map((task) => async () => {
    const tag = `[${task.catId}] ${task.label}`;
    process.stdout.write(`  🖼  ${tag.padEnd(20)} ...\r`);
    const t0 = Date.now();
    try {
      const buffer = await callApi(task.prompt);
      await writeFile(task.filepath, buffer);
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      const kb = (buffer.length / 1024).toFixed(0);
      console.log(`  ✓ ${tag.padEnd(20)} ${sec}s  ${kb}KB`);
    } catch (err) {
      console.log(`  ✗ ${tag.padEnd(20)} ${err.message.slice(0, 80)}`);
      await sleep(3000);
    }
  });

  await runWithConcurrency(tasks, CONCURRENCY);

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ All ${allTasks.length} presets processed in ${totalSec}s`);

  // Write manifest
  const manifest = {};
  for (const cat of CATEGORIES) {
    manifest[cat.id] = {};
    const catDir = join(PUBLIC_DIR, 'presets', cat.id);
    const files = await readdir(catDir).catch(() => []);
    for (const [idx, preset] of cat.presets.entries()) {
      const filename = `${slugify(preset.label, idx)}.jpg`;
      if (files.includes(filename)) {
        manifest[cat.id][preset.label] = `/presets/${cat.id}/${filename}`;
      }
    }
  }
  const manifestPath = join(PUBLIC_DIR, 'presets', 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`📋 Manifest written to public/presets/manifest.json`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
