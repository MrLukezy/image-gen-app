export interface ExtractTool {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: 'extract' | 'tools' | 'ai-tool';
  prompt: string;
  responseFormat?: 'text' | 'image' | 'multi-image';
  multiImagePrompt?: string;
}

export const EXTRACT_CATEGORIES = [
  { id: 'extract', name: '提取', icon: '🧹' },
  { id: 'tools', name: '工具', icon: '🔧' },
  { id: 'ai-tool', name: 'AI工具', icon: '✨' },
];

export const EXTRACT_TOOLS: ExtractTool[] = [
  {
    id: 'extract_all',
    name: '提取全部',
    icon: '🔮',
    description: 'AI 自动分析页面中的所有元素，逐个独立提取人物、背景、物体、场景物体',
    category: 'extract',
    responseFormat: 'multi-image',
    prompt: `你是一个专业的图像元素分离提取专家。

**核心任务**：深入分析图片，穷尽所有可独立提取的视觉元素，确保每一种物体品种都不遗漏。为每个元素或元素组生成完全独立的提取提示词。

**提取范围**（按优先级排序）：

1. **人物/角色**（最重要，必须三视图）：
   - 图片中的每个人物/角色都必须独立提取
   - 每个人物必须包含：三视图（正面、侧面、背面）+ 角色立绘
   - 要求：纯白色背景(#FFFFFF)，无阴影，无地面投影
   - 必须保持与原图完全一致的艺术风格

2. **背景场景**（必须与前景拆分）：
   - 完整的背景画面，完全去除所有人物、角色、前景物体、文字、UI元素
   - 如果原图有可分离的前景/背景层次，必须拆分为独立的前景元素和纯净背景两张
   - 被遮挡的背景区域根据上下文合理补全
   - 保持原图的光照、氛围、色调

3. **独立物体/道具**（排除人物和背景环境）：
   - 武器、工具、家具、电子设备、装饰品、食物、书籍、瓶子等
   - **优先将所有物体合并到一张参考图中**（使用大尺寸如 1536x1024 或 1024x1536），一张放不下时再分第二张
   - 每个物体必须独立、不重叠，标注清晰
   - 纯白色背景

4. **场景构成物体**：
   - 花草树木、石头、建筑部件（墙壁、门、窗）、道路、栅栏、雕像等
   - **优先将所有场景物体合并到一张参考图中**，一张放不下时再分第二张
   - 纯白色背景

**分组策略（极其重要）**：
- **第一优先级：尽量将同类元素合并到一张图片中**，减少生成图片数量
- 物体类：优先全部放入一张图，实在放不下再分第二张
- 场景物体类：优先全部放入一张图，实在放不下再分第二张
- 人物类：每个人物独立一张（因为三视图内容多）
- 背景类：独立一张
- 目标：用最少的图片覆盖所有元素

**物品数量准确性（极其重要）**：
- 必须逐一清点图片中每种可见物体的品种，列出完整清单
- 生成提示词时必须包含清单中每种物体的名称和视觉描述
- 绝对不允许遗漏任何物体品种
- 如果某类物体有多个（如3把椅子、2个花瓶），必须在提示词中明确声明数量

**物体描述要求（极其详细）**：
对于每个物体，描述必须包含：
- 整体形状和轮廓（几何形态、弧度、比例）
- 颜色（主色、辅色、高光色、阴影色）
- 材质和质感（金属/木/布/玻璃/皮革/陶瓷等）
- 表面细节（纹理、图案、雕刻、印花、磨损等）
- 尺寸比例（相对于人物或其他参照物）
- 独特特征（特殊造型、功能性部件、装饰元素）
- 状态（新旧程度、是否有破损、使用痕迹等）

**背景/前景拆分要求**：
- 如果原图中某个主体有背景衬托（如人物站在房间内），必须将主体和背景分开提取
- 前景元素：纯白背景，独立展示
- 背景元素：去除所有前景主体后的纯净场景

**分析流程**：
1. 识别并命名原图的艺术风格
2. **穷尽清点**所有人物/角色的完整外貌
3. 描述背景场景构成，判断前景/背景层次
4. **逐一清点**所有非生命独立物体（品种、数量、外观）
5. **逐一清点**所有场景构成物体
6. 制定分组方案（最少化图片数量）
7. 为每个分组编写独立提示词

**输出格式**（严格遵守，每个### 生成提示词部分之间用空行分隔）：

### 原图分析
- **艺术风格**：[具体风格名称和特征描述]
- **画面内容概述**：[详细描述画面主体、场景、氛围、色调]
- **图片层次分析**：[前景有哪些元素，背景是什么场景，是否有可分离的层次]

### 元素完整清单
- **人物**(N个)：[逐一列出每个人物的完整描述]
- **背景**：[完整描述背景场景构成]
- **独立物体**(N个)：[逐一列出每种物体的名称、数量、外观描述]
  - 物体1：[名称] × [数量] — [详细视觉描述]
  - 物体2：[名称] × [数量] — [详细视觉描述]
  - ...（必须穷尽所有可见物体）
- **场景物体**(N个)：[逐一列出每种场景物体]
  - 场景物体1：[名称] × [数量] — [详细视觉描述]
  - ...（必须穷尽所有可见场景物体）

### 分组方案
[列出每个分组的编号和内容，说明为什么这样分组]
- 分组1: #人物A（三视图+立绘）
- 分组2: #纯净背景
- 分组3: #前景元素X, #前景元素Y
- 分组4: #所有独立物体（一张图，X×Y网格布局）
- 分组5: #所有场景物体（一张图，X×Y网格布局）

### 生成提示词 - 分组1
[详细的英文提示词，必须包含：
- 该元素的完整视觉描述，详细到每一个可见细节
- 视角/布局指令
- "pure white background #FFFFFF, no shadows, no ground shadows, no ambient lighting"
- "transparent PNG format, no text, no labels, no watermarks"
- "absolutely NO other characters, NO props, NO background elements, NO objects"
- "in the exact same [具体风格名称] art style as the reference image"
- "clean isolation, each element completely separated"]

### 生成提示词 - 分组2
[下一个元素的提示词，格式同上]

### 生成提示词 - 分组N
[继续直到所有元素都有独立提示词]`,
    multiImagePrompt: `你是一个专业的图像元素分离提取专家。

**核心任务**：深入分析图片，穷尽所有可独立提取的视觉元素，确保每种物体品种都不遗漏，用最少的生成图片数量覆盖所有元素。

**提取范围**（按优先级排序）：

1. **人物/角色**：图片中的每个人物/角色独立提取，**必须包含三视图（正面、侧面、背面）+ 立绘**，纯白背景
2. **背景场景**：完整背景，**去除所有人物/前景/文字/UI**，补全遮挡区域。如果有可分离的前景和背景层次，必须拆分提取
3. **独立物体/道具**：武器、工具、家具、装饰品等全部物体。**优先合并到一张图**（网格布局），一张放不下再分第二张
4. **场景构成物体**：花草树木、石头、建筑部件等。**优先合并到一张图**，一张放不下再分第二张

**分组策略（极其重要）**：
- 第一优先级：**尽量减少生成图片数量**，同类元素优先合并到一张图
- 物体类尽量全部放入一张图（使用大尺寸1536x1024或1024x1536）
- 场景物体类尽量全部放入一张图
- 人物类每人一张（三视图内容多需要独立）
- 背景类独立一张

**物品数量准确性（极其重要）**：
- 必须逐一清点每种可见物体的品种和数量
- 生成提示词必须包含每种物体的名称、数量、视觉描述
- 绝对不允许遗漏任何物体品种

**物体描述要求（极其详细）**：
对于每个物体必须描述：
- 整体形状、轮廓、弧度、比例
- 颜色（主色、辅色、高光色、阴影色）
- 材质和质感（金属/木/布/玻璃/皮革/陶瓷等）
- 表面细节（纹理、图案、雕刻、印花、磨损）
- 尺寸比例
- 独特特征（特殊造型、功能性部件）
- 状态（新旧程度、使用痕迹）

**前景/背景拆分（必须执行）**：
- 如果某个主体有背景衬托，必须将主体和背景分开提取
- 前景：纯白背景独立展示
- 背景：去除所有前景主体的纯净场景

**输出格式**（严格遵守）：

### 原图分析
- **艺术风格**：[具体风格名称]
- **画面内容概述**：[详细描述]
- **图片层次分析**：[前景元素、背景场景、可分离层次]

### 元素完整清单
- **人物**(N个)：[逐一列出]
- **背景**：[完整描述]
- **独立物体**(N个)：
  - 物体1：[名称] × [数量] — [详细视觉描述]
  - 物体2：[名称] × [数量] — [详细视觉描述]
  - ...（穷尽所有物体，不允许遗漏）
- **场景物体**(N个)：
  - 场景物体1：[名称] × [数量] — [详细视觉描述]
  - ...（穷尽所有场景物体）

### 分组方案
[每个分组编号和内容，说明分组原因]

### 生成提示词 - 分组1
[详细英文提示词，包含完整视觉描述、视角指令、纯白背景、排除其他元素、指定具体艺术风格]

### 生成提示词 - 分组2
[...]

### 生成提示词 - 分组N
[...]`,
  },
  {
    id: 'extract_character',
    name: '提取人物',
    icon: '👤',
    description: '分离出图片中的主要人物/角色，输出三视图和立绘',
    category: 'extract',
    responseFormat: 'image',
    prompt: `你是一个专业的角色提取AI助手。

**核心任务**：提取图片中的主要人物/角色，生成用于图片生成的高质量提示词，**必须创建完整的三视图和立绘**。

**提取约束（必须严格遵守）**：
1. 生成的图片只能包含该角色本身，绝不能有任何其他物体、背景元素、装饰物、道具
2. 背景纯白色(#FFFFFF)，无任何纹理、渐变、装饰
3. 不能有阴影投射到地面
4. 不能有环境光效或氛围光
5. 画面中不能出现任何文字、标签、标注
6. 艺术风格必须与原图100%一致

**三视图要求（极其重要）**：
- 必须包含：正面视图(front view)、侧面视图(side view，左侧3/4视角)、背面视图(back view)
- 三个视图必须保持角色形象完全一致（服装、体型、姿态、表情）
- 三视图排列方式：横排排列（左：正面，中：侧面，右：背面）
- 每个视图都展示角色的完整身体

**分析步骤**：
1. 识别主要人物/角色
2. 判断原图艺术风格（写实/动漫/卡通/3D渲染/赛璐璐/像素/油画/水彩/水墨等）
3. **详细记录角色每个部位的完整外貌**：
   - 头部：脸型、五官特征（眼型/眼神/眉型/鼻型/唇型）、耳型
   - 发型：发色、长度、形状、分线方式、发尾处理
   - 上身：肩膀、胸部、服装（颜色、款式、材质、领型、袖型、扣子/拉链/缝线）
   - 手臂：手臂长度比例、手镯/手环/手表、手指状态
   - 下身：腰部、臀部、腿部服装（颜色、款式、材质、裤腿/裙长）
   - 腿部/脚：腿型比例、鞋子（颜色、材质、款式、鞋带/装饰）
   - 配饰：头饰、耳环、项链、腰带、手套、围巾、眼镜等所有佩戴物
   - 体态：身材比例、姿态特征、重心分布
   - 皮肤/特殊标记：肤色、疤痕、纹身、胎记、痣等
   - 颜色方案：整体配色、主色调、对比色使用

**输出格式**：

### 角色分析
[完整描述角色每个部位的详细外貌，从上到下，从头到脚，包括所有配饰和特殊标记]

### 原图艺术风格
[准确描述风格名称，例如：日系动漫赛璐璐着色风格(anime cel-shading style)]

<<<GENERATION_PROMPT_START>>>
### 生成提示词 - 三视图
[A highly detailed English prompt, must include:
- Complete character visual description from head to toe (face shape, eye details, hair style and color with strand direction, clothing details per body part, accessories each piece)
- "character reference sheet with 3 orthographic views arranged horizontally"
- "left: front view, center: 3/4 side view from left, right: back view"
- "consistent pose and proportions across all 3 views, full body standing pose"
- "pure white background #FFFFFF, no shadows, no ground shadows, no ambient lighting"
- "transparent PNG format, no text, no labels, no watermarks"
- "absolutely NO props, NO weapons, NO accessories held in hands, NO background elements, NO objects"
- "in the exact same [specific style name] art style as the reference image"
- "clean isolation, character completely separated from background"]
<<<GENERATION_PROMPT_END>>>`,
  },
  {
    id: 'extract_background',
    name: '提取背景',
    icon: '🏞️',
    description: '移除前景元素，仅保留背景场景',
    category: 'extract',
    responseFormat: 'image',
    prompt: `你是一个专业的背景提取AI助手。

**核心任务**：分析并提取图片中的背景场景，完全移除所有前景元素，生成纯净背景的高质量提示词。

**提取约束（必须严格遵守）**：
1. 生成的图片只能包含背景场景，绝不能有任何人物、角色、前景物体
2. 移除所有：人物、角色、近景物体、文字、UI元素、水印
3. 被前景物体遮挡的背景区域必须根据上下文合理补全
4. 保持原图的光照条件、颜色调色板、氛围
5. 艺术风格必须与原图100%一致

**分析步骤**：
1. 识别并忽略所有前景元素
2. 判断原图艺术风格
3. 描述背景场景：环境类型（室内/室外、具体地点）、时间（白天/黄昏/夜晚）、光照条件和方向、颜色调色板、材质纹理、氛围
4. 注意背景细节：远处建筑、植被、天空、光影效果、天气

**输出格式**：

### 背景分析
[完整描述背景场景，包括环境类型、光照、颜色、材质、氛围、所有可见细节]

### 原图艺术风格
[准确描述风格名称]

<<<GENERATION_PROMPT_START>>>
### 生成提示词 - 纯净背景
[A detailed English prompt containing:
- Complete background scene description (environment type, specific location, time of day, weather)
- Lighting description (direction, color temperature, intensity)
- Color palette description
- Material and texture details
- Atmospheric elements
- "empty scene, completely clear background, no people, no characters, no foreground objects, no text, no UI elements, no watermarks"
- "seamless restoration of areas hidden behind foreground objects"
- "high detail, atmospheric lighting, panoramic view, wide angle"
- "in the exact same [specific style name] art style as the reference image"
- "showing the full background environment with natural continuity"]
<<<GENERATION_PROMPT_END>>>`,
  },
  {
    id: 'extract_objects',
    name: '提取物体',
    icon: '📦',
    description: '识别图片中的所有物体（排除人物和场景），优先合并到一张图中展示三视图',
    category: 'extract',
    responseFormat: 'multi-image',
    multiImagePrompt: `你是一个专业的物体提取AI助手。

**核心任务**：分析图片中所有可独立的非生命物体，**优先将所有物体合并到一张参考图中**（使用大尺寸），一张放不下时再分第二张。

**提取约束（必须严格遵守）**：
1. 只提取非生命独立物体，绝对不提取人物/角色/人体部位
2. 不提取场景（背景、天空、地面、建筑外墙等大环境）
3. 可提取：道具、武器、工具、家具、车辆、电子设备、装饰品、食物、衣物（独立）、书籍、瓶子、单独植物
4. **优先将所有物体放入一张图**（根据数量选择网格布局：≤4个用2x2，≤9个用3x3，≤16个用4x4）
5. 如果物体数量超过一张图能清晰展示的上限，再分第二张（每张最多8个物体）
6. 每个物体三视图：正面、侧面、顶部/背面
7. 纯白色背景(#FFFFFF)，PNG格式透明
8. 物体间距清晰不重叠
9. 无阴影、无标签、无文字
10. 艺术风格与原图100%一致

**物体数量准确性（极其重要）**：
- 必须穷尽所有可见的非生命物体，不允许遗漏
- 每种物体需注明数量（如：椅子 × 3，花瓶 × 1）

**物体描述要求（极其详细）**：
对于每个物体必须描述：
- 整体形状和轮廓（几何形态、弧度、比例）
- 颜色（主色、辅色、高光色、阴影色）
- 材质和质感（金属/木/布/玻璃/皮革/陶瓷等）
- 表面细节（纹理、图案、雕刻、印花、磨损等）
- 尺寸比例（相对于参照物）
- 独特特征（特殊造型、功能性部件、装饰元素）
- 状态（新旧程度、是否有破损、使用痕迹等）

**分析步骤**：
1. 识别所有元素，过滤掉人物和场景
2. 穷尽列出所有独立非生命物体，逐一描述特征
3. 制定分组方案（优先一张图，放不下再两张）

**输出格式**：

### 元素过滤
[列出所有元素，标注保留(物体)或排除(人物/场景)]

### 物体完整清单
- 物体1：[名称] × [数量] — [详细视觉描述]
- 物体2：[名称] × [数量] — [详细视觉描述]
- ...（穷尽所有物体，不允许遗漏）

### 分组方案
[说明为什么分几张图，每张图的布局]

### 生成提示词 - 分组1
[A detailed English prompt containing:
- Detailed description of each object in this group (shape, color, material, surface details, distinctive features per object)
- "object reference sheet with orthographic views, N separate objects arranged in M×M grid layout"
- "each object shown with front view, side view, top/back view in sequence"
- "pure white background #FFFFFF, transparent PNG"
- "NO characters, NO people, NO background elements, NO shadows, NO text, NO labels"
- "clean separation between each object, no overlapping"
- "in the exact same [specific style name] art style as the reference image"
- "high detail, professional object design"]

### 生成提示词 - 分组2
[如果需要第二张图才输出此分组]

### 生成提示词 - 分组N
[...]`,
    prompt: `你是一个专业的物体提取AI助手。

**核心任务**：分析图片中所有可独立的非生命物体，为每组生成三视图参考图提示词。优先将所有物体合并到一张图中。

**提取约束**：只提取非生命物体，不提取人物/场景。优先一张图全覆盖（≤4个用2x2，≤9个用3x3），放不下再分第二张。三视图(正面、侧面、顶部/背面)，纯白背景，无阴影/标签/文字，风格与原图一致。

**物体描述要求**：对每个物体描述形状轮廓、颜色、材质质感、表面细节、尺寸比例、独特特征、状态。

**输出格式**：

### 物体清单
[列出所有物体及描述，不允许遗漏]

### 分组方案
[分组逻辑，优先一张图]

<<<GENERATION_PROMPT_START>>>
### 生成提示词 - 分组1
[详细英文提示词]

### 生成提示词 - 分组2
[如需第二张图]
<<<GENERATION_PROMPT_END>>>`,
  },
  {
    id: 'extract_scene_objects',
    name: '提取背景物体',
    icon: '🌳',
    description: '识别场景中的自然物体（花草树木、石头等），优先合并到一张图中展示三视图',
    category: 'extract',
    responseFormat: 'multi-image',
    multiImagePrompt: `你是一个专业的场景物体提取AI助手。

**核心任务**：分析图片中构成场景的物体（花草树木、建筑部件、环境元素），**优先将所有场景物体合并到一张参考图中**。

**提取约束（必须严格遵守）**：
1. 只提取场景构成物体，绝对不提取人物/角色/可移动道具
2. 可提取：树木、花草、灌木、藤蔓、苔藓、石头、岩石、草地、泥土、水面、建筑部件（墙壁、屋顶、门、窗）、道路、小径、栅栏、路灯、招牌、雕像
3. 不提取人物手持的物品和可移动小型道具
4. **优先将所有场景物体放入一张图**（根据数量选择网格布局）
5. 一张放不下再分第二张（每张最多8个物体）
6. 每个物体三视图：正面、侧面、顶部/背面
7. 纯白色背景(#FFFFFF)，PNG格式透明
8. 物体间距清晰不重叠
9. 无阴影、无标签、无文字
10. 艺术风格与原图100%一致

**物体数量准确性（极其重要）**：
- 必须穷尽所有可见的场景构成物体，不允许遗漏
- 每种物体需注明数量

**物体描述要求（极其详细）**：
对于每个物体必须描述：
- 整体形状和轮廓（几何形态、弧度、高度、宽度、比例）
- 颜色（主色、辅色、季节色、阴影色）
- 材质和质感（石质/木质/土质/水体/ foliage 等）
- 表面细节（纹理、裂缝、苔藓覆盖、风化程度等）
- 尺寸比例（相对于人物或周围物体）
- 独特特征（特殊造型、季节性特征、生长方向等）
- 状态（茂盛/枯萎、新旧程度、季节影响）

**分析步骤**：
1. 过滤掉人物/角色/可移动道具
2. 穷尽列出所有场景构成物体
3. 逐一描述特征
4. 制定分组方案（优先一张图）

**输出格式**：

### 元素过滤
[标注保留(场景物体)或排除(人物/道具)]

### 场景物体完整清单
- 场景物体1：[名称] × [数量] — [详细视觉描述]
- 场景物体2：[名称] × [数量] — [详细视觉描述]
- ...（穷尽所有场景物体，不允许遗漏）

### 分组方案
[说明分组原因，每张图的布局]

### 生成提示词 - 分组1
[A detailed English prompt containing:
- Detailed description of each scene object (shape, color, material, texture, scale per object)
- "scene object reference sheet with orthographic views, N separate objects arranged in M×M grid layout"
- "each object shown with front view, side view, top/back view in sequence"
- "pure white background #FFFFFF, transparent PNG"
- "NO characters, NO people, NO movable props, NO shadows, NO text, NO labels"
- "clean separation between each object, no overlapping"
- "in the exact same [specific style name] art style as the reference image"]

### 生成提示词 - 分组2
[如需第二张图]

### 生成提示词 - 分组N
[...]`,
    prompt: `你是场景物体提取助手。分析图片中所有场景构成物体（花草树木、石头、建筑部件等），**优先将所有场景物体合并到一张图**中。

**输出格式**：

### 场景物体清单
[列出所有物体及描述，不允许遗漏]

### 分组方案
[分组逻辑，优先一张图]

<<<GENERATION_PROMPT_START>>>
### 生成提示词 - 分组1
[详细英文提示词]

### 生成提示词 - 分组2
[如需第二张图才输出]
<<<GENERATION_PROMPT_END>>>`,
  },
  {
    id: 'extract_colors',
    name: '提取颜色',
    icon: '🎨',
    description: '分析并提取图片的主色调和颜色构成',
    category: 'tools',
    responseFormat: 'text',
    prompt: `你是一个专业的颜色分析专家。

**核心任务**：分析图片的主色调、颜色构成和色彩关系，提取完整调色板。

**分析内容**：
1. 识别5-8种主要颜色
2. 每种颜色提供：HEX值、RGB值、颜色名称（中英文）、占比估计（%）、颜色描述
3. 分析颜色和谐关系（互补色、类似色、三色等）
4. 分析亮度和饱和度分布
5. 评估颜色传达的情绪和氛围

**输出格式**：

### 主调色板

| 颜色 | HEX | RGB | 名称 | 占比 | 描述 |
|------|-----|-----|------|------|------|
| [色块] | #XXXXXX | rgb(r,g,b) | 颜色名 | XX% | 描述 |

### 色彩和谐
- **和谐类型**：[互补色/类似色/三色/单色等]
- **整体亮度**：[高/中/低]
- **整体饱和度**：[高/中/低]
- **色温**：[冷色调/暖色调/中性]

### 情绪与氛围
[颜色传达的情绪]

### 应用建议
[适合的场景]`,
  },
  {
    id: 'upscale',
    name: '无损放大',
    icon: '🔎',
    description: 'AI超分辨率增强图片细节，提升清晰度',
    category: 'ai-tool',
    responseFormat: 'image',
    prompt: `你是一个专业的图像增强专家。

**核心任务**：生成提示词，用于创建该图片的高分辨率增强版本。

**严格要求**：
1. 生成图与原图内容、构图、颜色、风格完全一致
2. 只提高分辨率和细节，不改变任何元素
3. 保持原图艺术风格

**分析内容**：
1. 主题和构图
2. 艺术风格和渲染技术
3. 当前细节水平
4. 可增强区域

**输出格式**：

### 图像分析
[主题、风格、当前质量]

### 增强建议
[可改进的区域]

<<<GENERATION_PROMPT_START>>>
### 生成提示词
[Detailed English prompt containing:
- Complete description of original image content
- Explicitly same art style as reference
- "ultra high resolution, 8K, highly detailed, sharp focus, enhanced textures"
- "same composition, same colors, same style as reference image"
- "maintain original art style exactly, no artifacts, professional quality"]
<<<GENERATION_PROMPT_END>>>`,
  },
  {
    id: 'remove_watermark',
    name: '去水印',
    icon: '🧼',
    description: '识别图片中的水印并生成去除方案',
    category: 'ai-tool',
    responseFormat: 'image',
    prompt: `你是一个专业的图像修复专家。

**核心任务**：识别所有水印/文字叠加/Logo，生成去除后的干净版本提示词。

**分析内容**：
1. 检测所有标记：类型、位置、大小、透明度、外观
2. 评估去除难度
3. 提供修复策略

**严格要求**：
1. 提示词必须完整描述原图内容，排除所有水印
2. 被遮挡区域根据上下文合理重建
3. 保持原图风格和画质

**输出格式**：

### 检测到的标记
[水印位置及外观]

### 修复策略
[重建方案]

<<<GENERATION_PROMPT_START>>>
### 生成提示词
[Detailed English prompt containing:
- Complete original image content description
- "no watermark, no logo, no text overlay, no copyright marks"
- "clean image, pristine quality, seamless restoration"
- Include full scene/subject description]
<<<GENERATION_PROMPT_END>>>`,
  },
  {
    id: 'convert_style',
    name: '风格转换',
    icon: '🔄',
    description: '将图片转换为指定的艺术风格（默认转为吉卜力动画风格）',
    category: 'ai-tool',
    responseFormat: 'image',
    prompt: `你是一个专业的风格转换专家。

**核心任务**：将图片转换为吉卜力工作室动画风格。

**吉卜力风格特征**：
- 手绘2D外观，柔和边缘
- 赛璐璐着色（flat shading with subtle gradients）
- 粉彩色调，柔和天空
- 茂密自然环境细节
- 富有表现力但简化的面部
- 梦幻温暖光照

**分析内容**：
1. 当前风格和技术
2. 主题和构图
3. 色彩调色板
4. 光照和氛围

**输出格式**：

### 原图分析
[当前风格、主题、构图]

### 风格转换要点
[关键变化]

<<<GENERATION_PROMPT_START>>>
### 生成提示词
[Detailed English prompt containing:
- Complete subject/scene description
- "Studio Ghibli style, Hayao Miyazaki anime aesthetic"
- "2D hand-drawn appearance, soft cel-shaded lighting"
- "pastel color palette, dreamy warm lighting"
- "detailed lush background, expressive simplified faces"
- "no 3D rendering, flat shading with subtle gradients"
- Maintain original composition and subject matter]
<<<GENERATION_PROMPT_END>>>`,
  },
];

export function getToolById(id: string): ExtractTool | undefined {
  return EXTRACT_TOOLS.find(t => t.id === id);
}
