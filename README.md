# 🎨 AI Image Generator

一个基于 Tauri 2 + React 的桌面端 AI 图片生成应用，支持 OpenAI 兼容的图片生成 API，内置丰富的提示词预设系统。

## ✨ 功能特性

### 🖼️ 图片生成
- **多模型支持** - 兼容 OpenAI 图片生成 API（默认 `gpt-image-2`）
- **多种尺寸** - 10 种宽高比预设（1:1、16:9、9:16、4:3 等）
- **批量生成** - 支持 1-8 张并行生成
- **参考图功能** - 从剪贴板粘贴或输入 URL 添加参考图（最多 6 张）
- **对话上下文** - 自动携带最近 5 次历史提示词作为上下文

### 🎭 提示词预设系统
内置 8 大分类、98 个专业提示词预设，鼠标悬浮查看效果缩略图：

| 分类 | 数量 | 说明 |
|------|------|------|
| 🎨 艺术风格 | 20 | 油画、水彩、动漫、赛博朋克、吉卜力等 |
| 💡 光影 | 14 | 电影光效、金色时刻、体积光、霓虹灯光等 |
| ✨ 画质 | 10 | 8K、大师级、虚幻引擎、电影画质等 |
| 📷 镜头 | 12 | 人像镜头、广角、微距、航拍、移轴等 |
| 🌙 氛围 | 12 | 梦幻、史诗、神秘、怀旧、未来感等 |
| 🎨 色调 | 12 | 鲜艳、粉彩、黑白、霓虹、大地色等 |
| 📐 构图 | 12 | 特写、全身、三分法、仰拍、鸟瞰等 |
| 🚫 负面提示 | 6 | 过滤低质量、畸变、水印等 |

### 🎬 快捷模板
8 个精选场景模板，一键注入完整提示词：
- 赛博朋克城市
- 奇幻森林
- 中国水墨山水
- 日系动漫少女
- 微距自然
- 蒸汽朋克机械
- 太空科幻
- 古堡夜景

### 💬 对话管理
- **多对话** - 支持创建、切换、重命名、删除对话
- **多窗口** - 可在新窗口打开独立对话
- **持久化存储** - 对话历史本地保存

### 🖥️ 界面特性
- **无边框窗口** - 自定义标题栏，支持拖动、最小化、最大化、关闭
- **深色主题** - 优雅的暗色 UI，金色点缀
- **Lightbox** - 点击图片放大预览
- **响应式布局** - 可折叠侧边栏

## 🚀 快速开始

### 环境要求

- **Node.js** >= 18.x
- **npm** >= 8.x
- **Rust** (Tauri 2 需要)
- **Tauri CLI** (会自动安装)

#### Windows 额外依赖
- Microsoft Visual Studio C++ Build Tools
- WebView2 (Windows 10/11 通常已内置)

详见 [Tauri 官方指南](https://v2.tauri.app/start/prerequisites/)

### 安装

```bash
# 克隆仓库
git clone https://github.com/MrLukezy/image-gen-app.git
cd image-gen-app

# 安装依赖
npm install
```

### 开发模式

```bash
npm run tauri dev
```

应用会自动打开开发窗口，支持热重载。

### 构建生产版本

```bash
npm run tauri build
```

构建完成后，安装包位于 `src-tauri/target/release/bundle/` 目录。

## 📖 使用指南

### 配置 API

首次使用需要配置 API 信息：

1. 点击右上角 ⚙️ **设置** 按钮
2. 填写：
   - **API Key** - 你的 API 密钥
   - **API 地址** - 图片生成 API 端点（默认 `https://www.hfsyapi.cn/v1/images/generations`）
   - **模型** - 模型名称（默认 `gpt-image-2`），也可点击刷新按钮获取可用模型列表

### 生成图片

1. 在输入框输入描述（支持 Shift+Enter 换行）
2. 可选：点击 **预设** 按钮打开预设面板，勾选想要的风格/光影/画质等参数
3. 可选：点击 **模板** 按钮选择快捷模板一键注入
4. 可选：粘贴参考图或点击 📎 按钮添加参考图 URL
5. 选择尺寸和生成数量
6. 按 Enter 或点击发送按钮开始生成

### 提示词预设

- 点击 **预设** 按钮打开预设面板
- 切换不同分类标签页
- 鼠标悬停预设标签可查看效果缩略图
- 点击预设标签选中/取消选中
- 选中的预设会自动拼接到提示词末尾
- 底部显示已选预设，支持单项移除或一键清空

### 参考图

- **粘贴** - 直接从剪贴板粘贴图片（Ctrl+V）
- **URL** - 点击 📎 按钮展开 URL 输入框，每行一个 URL
- 最多支持 6 张参考图（包含历史上下文图片）

### 对话管理

- 左上角 **+** 按钮创建新对话
- 侧边栏切换不同对话
- 右键对话可重命名/删除
- 点击 🪟 按钮在新窗口打开对话

## 🛠️ 技术栈

- **前端框架**: React 18 + TypeScript
- **构建工具**: Vite 6
- **桌面框架**: Tauri 2
- **后端语言**: Rust
- **HTTP 客户端**: reqwest (Rust)
- **UI 组件**: 纯手写（无第三方 UI 库）

## 📁 项目结构

```
image-gen-app/
├── src/                          # 前端源码
│   ├── App.tsx                   # 主应用组件
│   ├── types.ts                  # TypeScript 类型定义
│   ├── store.ts                  # LocalStorage 持久化
│   ├── promptPresets.ts          # 提示词预设数据
│   └── styles/                   # 样式文件
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   └── lib.rs                # Tauri 命令实现
│   └── tauri.conf.json           # Tauri 配置
├── public/
│   └── presets/                  # 预设效果缩略图（98 张）
├── scripts/
│   └── generatePresets.mjs       # 批量生成缩略图脚本
└── package.json
```

## 🔄 重新生成预设缩略图

如需重新生成效果缩略图：

```bash
node scripts/generatePresets.mjs [API_KEY] [API_URL] [MODEL]
```

脚本支持断点续传，已存在的图片会自动跳过。

## 📝 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📮 问题反馈

遇到问题或有建议？请 [提交 Issue](https://github.com/MrLukezy/image-gen-app/issues)
