export interface PromptPreset {
  label: string;
  value: string;
  desc?: string;
  img: string;
}

export interface PresetCategory {
  id: string;
  name: string;
  icon: string;
  presets: PromptPreset[];
}

export const PRESET_CATEGORIES: PresetCategory[] = [
  {
    id: 'style',
    name: '艺术风格',
    icon: '🎨',
    presets: [
      { label: '油画', value: 'oil painting, rich brushstrokes, canvas texture', img: '/presets/style/00_油画.jpg' },
      { label: '水彩', value: 'watercolor painting, soft washes, translucent layers', img: '/presets/style/01_水彩.jpg' },
      { label: '素描', value: 'pencil sketch, graphite shading, crosshatching, hand-drawn', img: '/presets/style/02_素描.jpg' },
      { label: '数字绘画', value: 'digital painting, smooth rendering, concept art', img: '/presets/style/03_数字绘画.jpg' },
      { label: '动漫', value: 'anime style, cel-shaded, vibrant, manga illustration', img: '/presets/style/04_动漫.jpg' },
      { label: '吉卜力', value: 'Studio Ghibli style, soft pastel, whimsical, hand-drawn anime', img: '/presets/style/05_吉卜力.jpg' },
      { label: '像素艺术', value: 'pixel art, retro 8-bit, pixelated sprites', img: '/presets/style/06_像素艺术.jpg' },
      { label: '3D渲染', value: '3D render, octane render, physically based rendering, CGI', img: '/presets/style/07_3D渲染.jpg' },
      { label: '概念艺术', value: 'concept art, professional illustration, industry standard', img: '/presets/style/08_概念艺术.jpg' },
      { label: '赛博朋克', value: 'cyberpunk aesthetic, neon glow, futuristic, dystopian', img: '/presets/style/09_赛博朋克.jpg' },
      { label: '蒸汽朋克', value: 'steampunk aesthetic, gears, brass, Victorian machinery', img: '/presets/style/10_蒸汽朋克.jpg' },
      { label: '哥特式', value: 'gothic style, dark cathedral, ornate, dramatic', img: '/presets/style/11_哥特式.jpg' },
      { label: '极简主义', value: 'minimalist design, clean lines, simple shapes, less is more', img: '/presets/style/12_极简主义.jpg' },
      { label: '波普艺术', value: 'pop art, bold colors, halftone dots, comic book style', img: '/presets/style/13_波普艺术.jpg' },
      { label: '浮世绘', value: 'ukiyo-e style, Japanese woodblock print, flat colors, traditional', img: '/presets/style/14_浮世绘.jpg' },
      { label: '印象派', value: 'impressionist painting, visible brushstrokes, light and color', img: '/presets/style/15_印象派.jpg' },
      { label: '超现实主义', value: 'surrealism, dreamlike, impossible, Salvador Dali inspired', img: '/presets/style/16_超现实主义.jpg' },
      { label: '新艺术', value: 'Art Nouveau, flowing organic lines, Alphonse Mucha style, ornamental', img: '/presets/style/17_新艺术.jpg' },
      { label: 'Low Poly', value: 'low poly art, geometric, faceted, 3D minimalist', img: '/presets/style/18_Low_Poly.jpg' },
      { label: '写实', value: 'photorealistic, hyperrealistic, ultra detailed, lifelike', img: '/presets/style/19_写实.jpg' },
    ],
  },
  {
    id: 'lighting',
    name: '光影',
    icon: '💡',
    presets: [
      { label: '电影光效', value: 'cinematic lighting, dramatic shadows, moody atmosphere', img: '/presets/lighting/00_电影光效.jpg' },
      { label: '金色时刻', value: 'golden hour lighting, warm sunlight, soft glow, magic hour', img: '/presets/lighting/01_金色时刻.jpg' },
      { label: '蓝色时刻', value: 'blue hour, cool twilight, soft ambient light', img: '/presets/lighting/02_蓝色时刻.jpg' },
      { label: '体积光', value: 'volumetric lighting, god rays, light shafts, atmospheric', img: '/presets/lighting/03_体积光.jpg' },
      { label: '边缘光', value: 'rim lighting, backlit, glowing outline, silhouette', img: '/presets/lighting/04_边缘光.jpg' },
      { label: '影棚光', value: 'studio lighting, professional three-point lighting setup', img: '/presets/lighting/05_影棚光.jpg' },
      { label: '自然光', value: 'natural lighting, soft diffused daylight', img: '/presets/lighting/06_自然光.jpg' },
      { label: '霓虹灯光', value: 'neon lights, colorful glow, cyberpunk nightlife', img: '/presets/lighting/07_霓虹灯光.jpg' },
      { label: '烛光', value: 'candlelight, warm flicker, intimate atmosphere', img: '/presets/lighting/08_烛光.jpg' },
      { label: '月光', value: 'moonlight, cool blue cast, night scene, ethereal', img: '/presets/lighting/09_月光.jpg' },
      { label: '逆光', value: 'backlight, silhouette, strong contrast, dark foreground', img: '/presets/lighting/10_逆光.jpg' },
      { label: 'HDR', value: 'HDR, high dynamic range, rich detail in highlights and shadows', img: '/presets/lighting/11_HDR.jpg' },
      { label: '暗调', value: 'low-key lighting, dark moody, deep shadows, chiaroscuro', img: '/presets/lighting/12_暗调.jpg' },
      { label: '亮调', value: 'high-key lighting, bright, clean, minimal shadows', img: '/presets/lighting/13_亮调.jpg' },
    ],
  },
  {
    id: 'quality',
    name: '画质',
    icon: '✨',
    presets: [
      { label: '高清8K', value: '8K UHD, ultra high definition, extremely detailed', img: '/presets/quality/00_高清8K.jpg' },
      { label: '超精细', value: 'highly detailed, intricate details, sharp focus', img: '/presets/quality/01_超精细.jpg' },
      { label: '大师级', value: 'masterpiece, best quality, award-winning', img: '/presets/quality/02_大师级.jpg' },
      { label: '专业级', value: 'professional quality, polished, industry standard', img: '/presets/quality/03_专业级.jpg' },
      { label: '照片级真实', value: 'photorealistic, lifelike, DSLR quality', img: '/presets/quality/04_照片级真实.jpg' },
      { label: '虚幻引擎', value: 'unreal engine 5, UE5 render, real-time ray tracing', img: '/presets/quality/05_虚幻引擎.jpg' },
      { label: '电影画质', value: 'cinematic quality, film grain, anamorphic lens', img: '/presets/quality/06_电影画质.jpg' },
      { label: '锐利清晰', value: 'sharp focus, tack sharp, crystal clear details', img: '/presets/quality/07_锐利清晰.jpg' },
      { label: '柔和细腻', value: 'soft focus, painterly, gentle rendering', img: '/presets/quality/08_柔和细腻.jpg' },
      { label: '精致纹理', value: 'detailed textures, PBR materials, surface detail', img: '/presets/quality/09_精致纹理.jpg' },
    ],
  },
  {
    id: 'camera',
    name: '镜头',
    icon: '📷',
    presets: [
      { label: '人像镜头', value: 'portrait lens, shallow depth of field, bokeh, 85mm', img: '/presets/camera/00_人像镜头.jpg' },
      { label: '广角镜头', value: 'wide angle lens, expansive view, 24mm', img: '/presets/camera/01_广角镜头.jpg' },
      { label: '长焦镜头', value: 'telephoto lens, compressed perspective, 200mm', img: '/presets/camera/02_长焦镜头.jpg' },
      { label: '微距', value: 'macro photography, extreme close-up, tiny details', img: '/presets/camera/03_微距.jpg' },
      { label: '鱼眼', value: 'fisheye lens, barrel distortion, ultra-wide', img: '/presets/camera/04_鱼眼.jpg' },
      { label: '航拍', value: 'aerial photography, drone shot, bird\'s eye view', img: '/presets/camera/05_航拍.jpg' },
      { label: '倾斜构图', value: 'dutch angle, tilted framing, dynamic tension', img: '/presets/camera/06_倾斜构图.jpg' },
      { label: '景深', value: 'shallow depth of field, bokeh, lens blur', img: '/presets/camera/07_景深.jpg' },
      { label: '全景', value: 'panoramic view, 360 degree, ultra-wide', img: '/presets/camera/08_全景.jpg' },
      { label: '移轴', value: 'tilt-shift photography, miniature effect, selective focus', img: '/presets/camera/09_移轴.jpg' },
      { label: '复古胶片', value: 'vintage film, 35mm analog, Kodak Portra 400', img: '/presets/camera/10_复古胶片.jpg' },
      { label: '暗角', value: 'vignetting, darkened corners, center focus', img: '/presets/camera/11_暗角.jpg' },
    ],
  },
  {
    id: 'mood',
    name: '氛围',
    icon: '🌙',
    presets: [
      { label: '梦幻', value: 'dreamlike, ethereal, fantasy, magical', img: '/presets/mood/00_梦幻.jpg' },
      { label: '史诗', value: 'epic, grand, monumental, awe-inspiring', img: '/presets/mood/01_史诗.jpg' },
      { label: '神秘', value: 'mysterious, enigmatic, dark, foreboding', img: '/presets/mood/02_神秘.jpg' },
      { label: '宁静', value: 'serene, peaceful, tranquil, calm atmosphere', img: '/presets/mood/03_宁静.jpg' },
      { label: '忧郁', value: 'melancholic, somber, moody, contemplative', img: '/presets/mood/04_忧郁.jpg' },
      { label: '欢快', value: 'cheerful, joyful, vibrant, uplifting', img: '/presets/mood/05_欢快.jpg' },
      { label: '恐怖', value: 'horror, eerie, unsettling, creepy atmosphere', img: '/presets/mood/06_恐怖.jpg' },
      { label: '浪漫', value: 'romantic, soft, intimate, tender', img: '/presets/mood/07_浪漫.jpg' },
      { label: '怀旧', value: 'nostalgic, vintage feel, retro, warm memories', img: '/presets/mood/08_怀旧.jpg' },
      { label: '未来感', value: 'futuristic, sci-fi, advanced technology, utopian', img: '/presets/mood/09_未来感.jpg' },
      { label: '田园', value: 'pastoral, countryside, idyllic, rural beauty', img: '/presets/mood/10_田园.jpg' },
      { label: '紧张', value: 'tense, dramatic, suspenseful, high stakes', img: '/presets/mood/11_紧张.jpg' },
    ],
  },
  {
    id: 'color',
    name: '色调',
    icon: '🎨',
    presets: [
      { label: '鲜艳', value: 'vibrant colors, saturated, bold hues', img: '/presets/color/00_鲜艳.jpg' },
      { label: '粉彩', value: 'pastel colors, soft tones, cotton candy palette', img: '/presets/color/01_粉彩.jpg' },
      { label: '暖色调', value: 'warm color palette, amber, orange, gold tones', img: '/presets/color/02_暖色调.jpg' },
      { label: '冷色调', value: 'cool color palette, blue, teal, cyan tones', img: '/presets/color/03_冷色调.jpg' },
      { label: '黑白', value: 'black and white, monochrome, grayscale', img: '/presets/color/04_黑白.jpg' },
      { label: '复古色调', value: 'vintage color grading, faded, analog film look', img: '/presets/color/05_复古色调.jpg' },
      { label: '高对比', value: 'high contrast, bold shadows, striking difference', img: '/presets/color/06_高对比.jpg' },
      { label: '低饱和', value: 'desaturated, muted tones, subtle colors', img: '/presets/color/07_低饱和.jpg' },
      { label: '互补色', value: 'complementary colors, contrasting hues, color theory', img: '/presets/color/08_互补色.jpg' },
      { label: '单色调', value: 'monochromatic, single hue variations, harmonious', img: '/presets/color/09_单色调.jpg' },
      { label: '霓虹', value: 'neon colors, electric, glowing hues, vivid', img: '/presets/color/10_霓虹.jpg' },
      { label: '大地色', value: 'earth tones, natural browns, olive, warm neutrals', img: '/presets/color/11_大地色.jpg' },
    ],
  },
  {
    id: 'composition',
    name: '构图',
    icon: '📐',
    presets: [
      { label: '特写', value: 'close-up shot, tight framing, facial details', img: '/presets/composition/00_特写.jpg' },
      { label: '半身', value: 'medium shot, waist up, upper body framing', img: '/presets/composition/01_半身.jpg' },
      { label: '全身', value: 'full body shot, head to toe, complete figure', img: '/presets/composition/02_全身.jpg' },
      { label: '三分法', value: 'rule of thirds composition, balanced framing', img: '/presets/composition/03_三分法.jpg' },
      { label: '居中对称', value: 'centered composition, symmetrical, balanced', img: '/presets/composition/04_居中对称.jpg' },
      { label: '黄金比例', value: 'golden ratio composition, proportional harmony', img: '/presets/composition/05_黄金比例.jpg' },
      { label: '仰拍', value: 'low angle shot, looking up, imposing perspective', img: '/presets/composition/06_仰拍.jpg' },
      { label: '俯拍', value: 'high angle shot, looking down, diminishing perspective', img: '/presets/composition/07_俯拍.jpg' },
      { label: '鸟瞰', value: 'bird\'s eye view, top-down perspective, aerial', img: '/presets/composition/08_鸟瞰.jpg' },
      { label: '正面', value: 'front view, facing camera, direct perspective', img: '/presets/composition/09_正面.jpg' },
      { label: '侧面', value: 'side profile, lateral view, silhouette', img: '/presets/composition/10_侧面.jpg' },
      { label: '背景虚化', value: 'shallow depth of field, blurred background, bokeh', img: '/presets/composition/11_背景虚化.jpg' },
    ],
  },
  {
    id: 'negative',
    name: '负面提示',
    icon: '🚫',
    presets: [
      { label: '画质差', value: '[negative: low quality, worst quality, blurry, jpeg artifacts]', img: '/presets/negative/00_画质差.jpg' },
      { label: '畸变', value: '[negative: deformed, distorted, disfigured, mutated]', img: '/presets/negative/01_畸变.jpg' },
      { label: '比例失调', value: '[negative: bad anatomy, bad proportions, extra limbs]', img: '/presets/negative/02_比例失调.jpg' },
      { label: '水印文字', value: '[negative: watermark, text, signature, logo, username]', img: '/presets/negative/03_水印文字.jpg' },
      { label: '模糊低分辨率', value: '[negative: blurry, out of focus, low resolution, pixelated]', img: '/presets/negative/04_模糊低分辨率.jpg' },
      { label: '过曝欠曝', value: '[negative: overexposed, underexposed, blown highlights]', img: '/presets/negative/05_过曝欠曝.jpg' },
    ],
  },
];

export const QUICK_TEMPLATES: { label: string; desc: string; prompt: string }[] = [
  {
    label: '赛博朋克城市',
    desc: '未来感霓虹城市',
    prompt: 'A futuristic cyberpunk cityscape at night, neon signs in Chinese and Japanese, towering skyscrapers with holographic billboards, flying vehicles, rain-soaked streets reflecting colorful lights, ultra detailed, cinematic lighting, 8K',
  },
  {
    label: '奇幻森林',
    desc: '魔幻精灵森林',
    prompt: 'An enchanted magical forest with bioluminescent plants, giant ancient trees with glowing runes, fireflies, a crystal clear stream, mystical fog, ethereal light rays filtering through the canopy, fantasy concept art, highly detailed, dreamlike atmosphere',
  },
  {
    label: '中国水墨山水',
    desc: '传统国画风格',
    prompt: 'Chinese ink wash painting, majestic mountains shrouded in mist, pine trees on cliff edges, a lone fisherman on a small boat, flowing river, traditional shanshui landscape, elegant brushwork, rice paper texture, minimalist composition',
  },
  {
    label: '日系动漫少女',
    desc: '动漫风格人物',
    prompt: 'A beautiful anime girl with long flowing hair, detailed expressive eyes, soft lighting, cherry blossom petals floating in the wind, Studio Ghibli inspired, pastel color palette, hand-drawn style, high quality anime illustration',
  },
  {
    label: '微距自然',
    desc: '微观自然摄影',
    prompt: 'Macro photography of a dewdrop on a flower petal, reflecting the morning sun, extreme close-up, sharp focus, bokeh background, natural lighting, 8K ultra detailed, DSLR quality, nature photography',
  },
  {
    label: '蒸汽朋克机械',
    desc: '复古机械装置',
    prompt: 'An intricate steampunk mechanical device, brass gears and cogs, steam pipes, copper rivets, Victorian era craftsmanship, dramatic studio lighting, highly detailed, concept art, photorealistic materials',
  },
  {
    label: '太空科幻',
    desc: '宇宙星际场景',
    prompt: 'A massive spacecraft approaching a ringed exoplanet, distant nebula in vibrant colors, stars scattered across deep space, cinematic wide shot, lens flare, sci-fi concept art, unreal engine quality, epic scale',
  },
  {
    label: '古堡夜景',
    desc: '哥特式城堡',
    prompt: 'A gothic castle on a cliff at night, full moon, dramatic clouds, torchlight from windows, ancient stone architecture, ravens flying, moody atmosphere, volumetric fog, cinematic lighting, dark fantasy, highly detailed',
  },
];
