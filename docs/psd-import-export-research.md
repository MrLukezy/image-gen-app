# PSD 导入 / 导出 技术调研报告

**调研日期**：2026-07-14  
**调研版本**：v1.0  

---

## 执行摘要

**推荐方案**：**前端 `ag-psd` 做 PSD 读写** + **仿提取模块用 LLM 视觉做语义框分层（裁切原图像素）** 作为第一期；后续有条件再接入 **LayerD / SAM2（psdfy）** 做真实 mask 分层。

**核心理由**：项目是 Tauri + React，`ag-psd` 是目前最成熟且同时支持读/写的 TS 库，浏览器 Canvas 即可用，无需 Node canvas。当前「提取」模块本质是 LLM 再生成，不是像素分割；要「按原图像素位置拼 PSD」，必须在原图上裁层而不是再生成图。LLM 输出相对坐标框是与现有栈最贴合的可验证路径。

**主要风险**：框选裁切得到的是矩形层，没有精细 alpha；复杂图层重叠/漏切。缓解：第一期先验证读写与定位；第二期接 SAM/LayerD。

**下一步**：已在本仓库落地 POC（PSD 分栏 + 导入 + LLM 导出）。

---

## 一、背景与目标

### 1.1 背景

- 需求：右键「导出 PSD」打开 PSD 分栏；分栏内有导入（看层级/图层图）与导出（语义分层 → PSD）。
- 现状：提取模块 = LLM 分析 + 图生图，**无 mask、无真实图层树**；无 PSD 依赖。

### 1.2 调研目标

1. 能否在本技术栈读写 PSD？
2. 语义分割 → PSD 有哪些成熟方案？
3. 第一期最可行落地路径是什么？

### 1.3 约束

| 约束 | 要求 |
|------|------|
| 技术栈 | Tauri 2 + React + TS，尽量少引入重型 Python/GPU 依赖 |
| 体验 | 保持原图像素位置与层级 |
| 许可证 | 优先 MIT/Apache |

---

## 二、方案对比

### 2.1 PSD 读写库

| 方案 | 读写 | Stars/下载 | 与本项目契合度 |
|------|------|------------|----------------|
| **ag-psd** (TS) | 读+写 | ~700★ / ~7万周下 | **最佳**：浏览器 Canvas、`left/top` 定位层 |
| psd.js |  predominantly 读 | 中等 | 写能力弱，不适合导出 |
| ag-psd (Rust crate) | 读+写 | 新 | 可后期迁入 Rust，非必须 |

### 2.2 语义分层 → PSD

| 方案 | 能力 | 局限 | 适用 |
|------|------|------|------|
| **LLM 框选 + 原图裁切**（本期） | 零额外模型、对接现有 `llm_chat` | 矩形层、无精细抠图 | UI/粗分层 POC |
| [LayerD](https://github.com/CyberAgentAILab/LayerD) | 平面设计图分解 + 原生 PSD | Python/模型重，偏设计稿 | 第二期（UI/海报类） |
| [psdfy](https://pypi.org/project/psdfy/) | SAM2 自动物例 → PSD | Python/GPU、服务化成本高 | 第二期（通用照片） |
| Grounded-SAM（见现有 `docs/ai-image-extraction-libraries-research.md`） | 文本提示精确 mask | 模型体积大 | 第二期「按提示提取层」 |

---

## 三、结论

1. **PSD 导入/导出：可行**，推荐 `ag-psd`。
2. **「原像素位置分层」：框裁可行；真抠图需 SAM/LayerD**。
3. **不要用当前提取结果直接当 PSD 层**：再生成图尺寸/像素与原图不对齐。

---

## 四、参考资料

- https://github.com/Agamnentzar/ag-psd  
- https://www.npmjs.com/package/ag-psd  
- https://github.com/CyberAgentAILab/LayerD  
- https://pypi.org/project/psdfy/  
- 项目内：`docs/ai-image-extraction-libraries-research.md`
