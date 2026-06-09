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
    prompt: `You are an image processing assistant. Analyze the provided image and identify the main character(s) or person(s) in it.

Your task: Describe in precise detail the appearance of the main character(s) - their clothing, hair, pose, facial features, accessories, and any distinguishing characteristics.

Then generate a clean description that could be used to recreate JUST the character with a transparent/plain background:

Format your response as:
**Character Description**
[detailed appearance description]

**Transparent Background Prompt**
[precise prompt to recreate the character alone on transparent background, high quality, detailed]`,
  },
  {
    id: 'extract_background',
    name: '提取背景',
    icon: '🏞️',
    description: '移除前景元素，仅保留背景场景',
    category: 'extract',
    responseFormat: 'image',
    prompt: `You are an image processing assistant. Analyze the provided image and remove all foreground subjects (people, objects, text, UI elements) to isolate just the background.

Your task: Describe the background scene in detail - the environment, lighting, colors, textures, and any atmospheric elements.

Format your response as:
**Background Description**
[detailed background description]

**Background Only Prompt**  
[precise prompt to recreate the background without any foreground subjects, maintaining the same style and atmosphere]`,
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
    description: '选择图片中的特定区域进行提取和放大',
    category: 'extract',
    requiresRegion: true,
    responseFormat: 'image',
    prompt: `You are an image processing assistant. The user has selected a specific region of the image. 

Extract and analyze the selected region. Zoom in and describe the details in that area with high precision.

Format your response as:
**Region Description**
[detailed description of what is in the selected region]

**Enhanced View Prompt**
[prompt to recreate a zoomed-in, high-detail version of just this region]`,
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
    prompt: `You are an image enhancement specialist. Analyze the provided image and generate a prompt for recreating it at higher resolution with enhanced details.

Examine:
1. Subject matter and composition
2. Art style and rendering technique
3. Level of detail and any areas that could be enhanced
4. Color palette and lighting

Format your response as:
**Enhancement Analysis**
[assessment of current quality and areas for improvement]

**High-Resolution Recreation Prompt**
[detailed prompt to recreate the image at higher resolution with enhanced clarity, maintaining the original style and composition]`,
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
    description: '将图片转换为指定的艺术风格',
    category: 'edit',
    responseFormat: 'image',
    prompt: `You are a style transfer specialist. Analyze the provided image and help the user convert it to a different artistic style.

First, describe the current style of the image briefly. Then provide prompts for converting it to popular alternative styles:

**Current Style**: [brief description]

**Style Conversion Options**:
1. **Anime/Cel Shaded**: [prompt]
2. **Oil Painting**: [prompt]  
3. **Watercolor**: [prompt]
4. **Pixel Art**: [prompt]
5. **Line Art/Sketch**: [prompt]
6. **Photorealistic**: [prompt]

Note: Ask the user which style they'd like, or describe a custom style.`,
  },
  {
    id: 'remove_watermark',
    name: '去水印',
    icon: '🧼',
    description: '识别图片中的水印位置并生成去除方案',
    category: 'edit',
    responseFormat: 'text',
    prompt: `You are an image analysis assistant. Check the provided image for any watermarks, text overlays, logos, or unwanted marks.

For each mark found:
- Describe its position, size, opacity
- Describe what it looks like
- Suggest how to remove it cleanly

Format your response as:
**Detected Marks**:
1. [Type] at [position] - [description]
...

**Removal Prompt**
[a prompt to recreate the image without any watermarks, preserving original content]

**Notes**: [any considerations about the removal process]`,
  },
];

export function getToolById(id: string): ExtractTool | undefined {
  return EXTRACT_TOOLS.find(t => t.id === id);
}
