export interface ExtractTool {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: 'extract' | 'analyze' | 'edit';
  prompt: string;
  requiresRegion?: boolean;
  requiresPixelColor?: boolean;
  responseFormat?: 'text' | 'image';
}

export const EXTRACT_CATEGORIES = [
  { id: 'extract', name: '提取', icon: '🧹' },
  { id: 'analyze', name: '分析', icon: '🔍' },
  { id: 'edit', name: '编辑', icon: '✏️' },
];

export const EXTRACT_TOOLS: ExtractTool[] = [
  {
    id: 'extract_character',
    name: '提取人物',
    icon: '👤',
    description: '分离出图片中的主要人物/角色，输出带透明背景的结果',
    category: 'extract',
    responseFormat: 'image',
    prompt: `You are an image processing assistant specialized in character extraction.

Step 1 — Analyze: Carefully examine the image. Identify the main character/subject. Describe their appearance in precise detail: clothing, hairstyle, hair color, pose, facial features, expression, accessories, body type, distinguishing marks.

Step 2 — Compose: Write a complete image-generation prompt that will recreate this character as a standalone full-body portrait with a clean plain background (pure white or single-color), in the same artistic style as the source image, high detail, sharp focus.

You MUST output your response in **exactly this two-section format** (do not add any other sections or commentary outside these blocks):

**### Analysis**
[Your detailed character description here, 3-6 bullet points]

**### Generation Prompt**
<<<GENERATION_PROMPT_START>>>
[One single paragraph prompt suitable for an image generation model, including: subject description, pose, clothing, style, background ("on plain white background" or "isolated on clean single-color background"), quality tags. Example: "a young woman with long black hair, wearing a red leather jacket and jeans, confident standing pose, anime cel-shaded style, on pure white background, full body, detailed, 4k"]
<<<GENERATION_PROMPT_END>>>`,
  },
  {
    id: 'extract_background',
    name: '提取背景',
    icon: '🏞️',
    description: '移除前景元素，仅保留背景场景',
    category: 'extract',
    responseFormat: 'image',
    prompt: `You are an image processing assistant specialized in background extraction.

Step 1 — Analyze: Examine the image. Identify and describe the background environment, completely ignoring any foreground subjects (people, characters, objects, text, UI elements). Describe the scene, environment, lighting, colors, atmosphere, textures, time of day, weather.

Step 2 — Compose: Write a complete image-generation prompt that will recreate only this background scene — with all foreground subjects removed — in the same artistic style as the source image.

You MUST output your response in **exactly this two-section format**:

**### Analysis**
[Your detailed background analysis here, 3-6 bullet points]

**### Generation Prompt**
<<<GENERATION_PROMPT_START>>>
[One paragraph prompt describing only the background, no people/characters/foreground objects, maintaining style, lighting, time of day, atmosphere. Example: "a bustling cyberpunk alley at night, neon signs in pink and blue, wet reflective streets, steam rising from vents, cinematic lighting, painterly style, no people, empty scene"]
<<<GENERATION_PROMPT_END>>>`,
  },
  {
    id: 'extract_colors',
    name: '提取色板',
    icon: '🎨',
    description: '分析图片的主色调和颜色构成',
    category: 'analyze',
    responseFormat: 'text',
    prompt: `You are a color analysis expert. Analyze the provided image and extract its color palette.

Identify:
1. The dominant colors (top 5 colors with approximate hex codes)
2. The overall color harmony (complementary, analogous, triadic, etc.)
3. The mood/atmosphere conveyed by the color scheme
4. Saturation and brightness characteristics

Format your response as:
**Color Palette**
- Color 1: #[HEX] - [description] ([percentage]% of image)
- Color 2: #[HEX] - [description] ([percentage]% of image)
...

**Color Harmony**: [type]
**Mood**: [description]
**Usage Recommendation**: [how these colors could be applied]`,
  },
  {
    id: 'extract_style',
    name: '提取风格',
    icon: '🖼️',
    description: '分析图片的艺术风格、技法和特征',
    category: 'analyze',
    responseFormat: 'text',
    prompt: `You are an art analysis expert. Analyze the provided image and identify its style characteristics.

Examine:
1. Art style (realistic, anime, cartoon, painterly, etc.)
2. Rendering technique (cel shading, watercolor, oil paint, digital, etc.)
3. Line quality and weight
4. Lighting style
5. Color grading approach
6. Key stylistic markers

Format your response as:
**Art Style**: [primary style classification]
**Rendering**: [technique description]
**Key Characteristics**:
- [characteristic 1]
- [characteristic 2]
...

**Style Prompt**: [a detailed prompt that could recreate this exact style]
**Similar Artists/Sources**: [comparable styles or references]`,
  },
  {
    id: 'extract_region',
    name: '提取区域',
    icon: '⬛',
    description: '提取图片中的特定区域并进行高清放大',
    category: 'extract',
    responseFormat: 'image',
    prompt: `You are an image processing assistant specializing in region zoom-in and enhancement.

The user wants to extract a close-up detail from this image. Analyze the image and identify the most interesting focal area (usually the face, a key object, or the center of action).

Step 1 — Describe: What is the main focal point? Describe it in precise visual detail.
Step 2 — Compose: Write a prompt that recreates a zoomed-in close-up version of just that focal region, with high clarity and added detail.

You MUST output your response in **exactly this two-section format**:

**### Analysis**
[Your analysis of the focal region]

**### Generation Prompt**
<<<GENERATION_PROMPT_START>>>
[One paragraph close-up prompt describing only the focal region in high detail, including: subject close-up angle, fine details to enhance, style matching the original. Example: "extreme close-up of a young warrior's face, detailed eyes with golden irises, scar across left cheek, short brown hair, medieval leather collar, cinematic lighting, hyper-realistic detail, 8k"]
<<<GENERATION_PROMPT_END>>>`,
  },
  {
    id: 'extract_pixel_color',
    name: '取色器',
    icon: '💧',
    description: '获取图片任意位置的精确颜色值',
    category: 'analyze',
    requiresPixelColor: true,
    responseFormat: 'text',
    prompt: `You are a color extraction assistant. The user has selected a specific pixel/area in the image.

Provide the exact color information for that selected point:

Format your response as:
**Selected Color**
- HEX: #[color]
- RGB: rgb(r, g, b)  
- HSL: hsl(h, s%, l%)
- Named Color: [closest named color]

**Color Context**
[brief note about how this color is used in context of the image]`,
  },
  {
    id: 'extract_objects',
    name: '提取物体',
    icon: '📦',
    description: '识别并逐个提取图片中的所有物体',
    category: 'extract',
    responseFormat: 'text',
    prompt: `You are an object detection assistant. Analyze the provided image and identify all distinct objects present.

For each object, describe:
- What it is
- Its position in the image (relative location)
- Its visual characteristics (color, size, shape)
- Any distinguishing details

Format your response as a numbered list:
1. **[Object Name]** - [position], [description]
2. **[Object Name]** - [position], [description]
...

**Scene Composition**: [overall description of how objects relate to each other]`,
  },
  {
    id: 'extract_text',
    name: '提取文字',
    icon: '📄',
    description: 'OCR识别图片中的所有文字内容',
    category: 'analyze',
    responseFormat: 'text',
    prompt: `You are an OCR (Optical Character Recognition) assistant. Extract ALL text visible in the provided image.

For each text element found:
- The exact text content
- Its location in the image
- The style of the text (font type, color, size relative to image)
- The language detected

Format your response as:
**Extracted Text**:
1. "[text]" - [location], [style], [language]
2. "[text]" - [location], [style], [language]
...

**Full Plain Text**:
[all text concatenated in reading order]

**Notes**: [any observations about text quality, readability issues, or context]`,
  },
  {
    id: 'upscale',
    name: '无损放大',
    icon: '🔎',
    description: 'AI超分辨率增强图片细节，提升清晰度',
    category: 'edit',
    responseFormat: 'image',
    prompt: `You are an image enhancement specialist. Analyze the provided image and produce a prompt that will recreate it at higher resolution with enhanced detail.

Step 1 — Analyze: Describe the image composition, subject, art style, current detail level, and areas that could be sharpened/enhanced.
Step 2 — Compose: Write a prompt that will recreate this exact image at higher resolution, with enhanced textures, finer detail, and sharp focus, while preserving the original subject, composition and style.

You MUST output your response in **exactly this two-section format**:

**### Analysis**
[Your analysis including composition, style, and detail opportunities]

**### Generation Prompt**
<<<GENERATION_PROMPT_START>>>
[One paragraph describing the SAME image as the original but emphasizing "ultra high resolution, 8k, highly detailed, sharp focus, masterwork quality" and specifying the exact same subject, pose, setting, colors, style as the source image. Must be faithful recreation, not a new image.]
<<<GENERATION_PROMPT_END>>>`,
  },
  {
    id: 'describe_image',
    name: '图片描述',
    icon: '💬',
    description: '生成详细的图片自然语言描述',
    category: 'analyze',
    responseFormat: 'text',
    prompt: `You are an expert image captioner. Provide a comprehensive, natural language description of the provided image.

Cover:
1. Main subject(s) and their appearance
2. Scene/environment/context
3. Lighting and atmosphere
4. Colors and mood
5. Artistic style and technical qualities
6. Composition and framing

Provide two descriptions:
**Short Caption** (1 sentence):
[concise description]

**Detailed Description** (3-5 sentences):
[comprehensive description capturing all visual elements]

**Keywords**: [comma-separated list of key tags]`,
  },
  {
    id: 'convert_style',
    name: '风格转换',
    icon: '🔄',
    description: '将图片转换为指定的艺术风格（默认转为吉卜力动画风格）',
    category: 'edit',
    responseFormat: 'image',
    prompt: `You are a style transfer specialist. The user wants to convert this image into a different artistic style.

Default conversion: **Studio Ghibli anime style** (Hayao Miyazaki style). If the image suggests a more appropriate target style, suggest alternatives.

Step 1 — Analyze: Briefly describe the current style, subject, and composition of the image.
Step 2 — Compose: Write a prompt that will recreate this same image's subject, pose, and composition but in Studio Ghibli anime style: hand-drawn 2D aesthetic, soft cel-shading, pastel sky gradients, lush green environments, expressive simple faces, dreamy warm lighting.

You MUST output your response in **exactly this two-section format**:

**### Analysis**
[Your brief analysis of current style and subject]

**### Generation Prompt**
<<<GENERATION_PROMPT_START>>>
[One paragraph describing the SAME subject and composition but explicitly in "Studio Ghibli style, Hayao Miyazaki anime, 2D hand-drawn, soft cel-shaded, pastel colors, dreamy warm lighting, detailed background, no 3D rendering, flat shading". Must preserve the original subject/scene.]
<<<GENERATION_PROMPT_END>>>`,
  },
  {
    id: 'remove_watermark',
    name: '去水印',
    icon: '🧼',
    description: '识别图片中的水印并生成无水印版本',
    category: 'edit',
    responseFormat: 'image',
    prompt: `You are an image restoration specialist. Analyze the provided image for any watermarks, logos, text overlays, stock photo marks, or unwanted stamps.

Step 1 — Detect: Identify all marks found — describe position, size, appearance, and opacity.
Step 2 — Compose: Write a prompt that will recreate the image's content EXACTLY as it is, in the same style and composition, but completely free of any watermarks, logos, or text overlays — a clean version.

You MUST output your response in **exactly this two-section format**:

**### Analysis**
[List the detected marks and the original image content to be preserved]

**### Generation Prompt**
<<<GENERATION_PROMPT_START>>>
[One paragraph that describes the original image's content and style faithfully, ending with: "no watermark, no logo, no text overlay, completely clean image, pristine quality". Must preserve subject, composition, colors, style exactly.]
<<<GENERATION_PROMPT_END>>>`,
  },
];

export function getToolById(id: string): ExtractTool | undefined {
  return EXTRACT_TOOLS.find(t => t.id === id);
}
