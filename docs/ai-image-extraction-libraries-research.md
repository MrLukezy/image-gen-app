# AI Image Extraction & Editing - Open Source Libraries Research

## 1. AI Segmentation & Object Extraction

### Grounded-SAM (GroundingDINO + SAM)
| Item | Detail |
|------|--------|
| GitHub | https://github.com/IDEA-Research/Grounded-Segment-Anything |
| Stars | ~17.7k |
| License | Apache-2.0 |
| What it does | Combines GroundingDINO (text-prompt object detection) with Segment Anything (SAM) to detect AND segment objects using only text prompts. Also includes inpainting pipeline with Stable Diffusion. |
| Text-prompt extraction | **YES** - Type "dog" and it detects + segments the dog with a precise mask |
| Model format | PyTorch (.pth), ONNX export supported |
| CPU-only | Possible but very slow; GPU strongly recommended |
| Model size | GroundingDINO-T: ~700MB; SAM-ViT-H: ~2.5GB; total ~3.2GB+ |
| JS/WASM/Node | No native JS port. Replicate API available (cjwbw/grounded-recognize-anything) |
| HTTP API | Yes via Gradio app, HuggingFace Space, and Replicate |
| **Best for** | **The #1 tool for "give me text prompt, extract specific element from image"** |

### GroundingDINO (standalone)
| Item | Detail |
|------|--------|
| GitHub | https://github.com/IDEA-Research/GroundingDINO |
| Stars | ~10.4k |
| License | Apache-2.0 |
| What it does | Open-set object detection with text prompts. Given image + text, returns bounding boxes. COCO zero-shot: 52.5 AP |
| Text-prompt extraction | YES - detects objects by text description |
| Model format | PyTorch (.pth) |
| CPU-only | Yes, supports CPU-only mode |
| Model size | SwinT: ~700MB; SwinB: ~1.2GB |
| JS/WASM/Node | No |
| HTTP API | HuggingFace Space demo, Gradio web UI included |
| Supported in HuggingFace | `transformers` library: `AutoProcessor`, `AutoModelForZeroShotObjectDetection` |

### SAM (Segment Anything Model)
| Item | Detail |
|------|--------|
| GitHub | https://github.com/facebookresearch/segment-anything |
| Stars | ~54.5k |
| License | Apache-2.0 |
| What it does | Foundation model for image segmentation. Generates masks from points, boxes, or automatic mode. Trained on 11M images, 1.1B masks |
| Text-prompt extraction | No native text support (requires GroundingDINO or similar for text->box->mask) |
| Model format | PyTorch (.pth), ONNX export supported |
| CPU-only | Yes but slow |
| Model sizes | ViT-B: ~375MB; ViT-L: ~1.25GB; ViT-H: ~2.5GB |
| JS/WASM/Node | **YES** - official ONNX export + React web demo with browser-based inference |
| HTTP API | HuggingFace, Replicate |

### SAM 2 (Segment Anything Model 2)
| Item | Detail |
|------|--------|
| GitHub | https://github.com/facebookresearch/sam2 (facebookresearch/sam2) |
| Stars | ~19.5k |
| License | Apache-2.0 |
| What it does | Extends SAM to video segmentation with streaming memory. Works on both images and videos. |
| Text-prompt extraction | No native text support (prompt-based: points/boxes) |
| Model format | PyTorch |
| CPU-only | Technically yes, very slow |
| Model sizes | Tiny: 39M params; Small: 46M; Base+: 81M; Large: 224M |
| JS/WASM/Node | No |
| HTTP API | Replicate (meta/sam-2-video) |
| Loadable from HuggingFace | `SAM2ImagePredictor.from_pretrained("facebook/sam2-hiera-large")` |

### LISA (Large Instructable Segmentation Assistant)
| Item | Detail |
|------|--------|
| GitHub | https://github.com/JIA-Lab-research/LISA (formerly dvlab-research/LISA) |
| Stars | ~2.7k |
| License | Apache-2.0 |
| What it does | Multi-modal LLM that can segment objects based on complex natural language instructions with reasoning. E.g., "segment the founder of Alibaba" |
| Text-prompt extraction | **YES** - supports complex reasoning + world knowledge for segmentation |
| Model format | PyTorch (LLaVA-based + SAM) |
| CPU-only | Possible with 4-bit quantization (~9GB VRAM for 13B model) |
| Model size | 7B: ~14GB; 13B: ~26GB (fp16); 4-bit: ~9GB |
| JS/WASM/Node | No |
| HTTP API | Gradio web app included |
| **Best for** | Complex reasoning segmentation ("segment the thing that doesn't belong") |

### Inpaint-Anything
| Item | Detail |
|------|--------|
| GitHub | https://github.com/geekyutao/Inpaint-Anything |
| Stars | ~7.7k |
| License | Apache-2.0 |
| What it does | SAM + LaMa/SD inpainting. Click to select object, then: Remove Anything, Fill Anything (text-prompt), Replace Anything (text-prompt background) |
| Text-prompt extraction | YES for fill/replace; point-based for selection |
| Model format | PyTorch |
| CPU-only | Possible |
| Model size | SAM (~2.5GB) + LaMa (~500MB) + SD (~4GB) |
| JS/WASM/Node | No |
| HTTP API | HuggingFace Space, local Gradio web UI |

---

## 2. AI Image Editing Libraries

### InstructPix2Pix
| Item | Detail |
|------|--------|
| GitHub | https://github.com/timothybrooks/instruct-pix2pix |
| Stars | ~6.9k |
| License | MIT (custom license file) |
| What it does | Text-guided image editing. Give an image + instruction like "turn him into a cyborg" and it edits the image accordingly |
| Text-prompt extraction | **YES** - modifies images based on natural language instructions |
| Model format | PyTorch (.ckpt) |
| CPU-only | Technically possible but very slow; 18GB+ VRAM recommended |
| Model size | ~4GB (based on SD 1.5) |
| JS/WASM/Node | No, but available via HuggingFace diffusers pipeline |
| HTTP API | Replicate API (timothybrooks/instruct-pix2pix), HuggingFace Space |
| Diffusers integration | `StableDiffusionInstructPix2PixPipeline.from_pretrained("timbrooks/instruct-pix2pix")` |

### HuggingFace Diffusers
| Item | Detail |
|------|--------|
| GitHub | https://github.com/huggingface/diffusers |
| Stars | ~34k |
| License | Apache-2.0 |
| What it does | **The** library for diffusion models. Covers text-to-image, image-to-image, inpainting, InstructPix2Pix, ControlNet, upscaling, and 30,000+ checkpoints |
| Key pipelines | StableDiffusionInpaintPipeline, StableDiffusionInstructPix2PixPipeline, ControlNet pipeline, SD Upscale |
| Model format | PyTorch, safetensors, HuggingFace Hub format |
| CPU-only | Yes with `--cpu` but extremely slow |
| Model size | Varies: SD 1.5 (~4GB), SDXL (~6.5GB), Flux (~24GB) |
| JS/WASM/Node | No JS port but extensive Python API; can serve as HTTP API |
| HTTP API | Can be wrapped with FastAPI/Flask; used by Gradio spaces |
| **Best for** | The universal building block library - use it to compose any diffusion pipeline |

---

## 3. Complete Open-Source Tools/Platforms

### ComfyUI
| Item | Detail |
|------|--------|
| GitHub | https://github.com/comfyanonymous/ComfyUI (now Comfy-Org/ComfyUI) |
| Stars | ~120k |
| License | GPL-3.0 |
| What it does | Node-based visual workflow editor for diffusion models. Supports SD1-3, SDXL, Flux, Hunyuan, Wan, and dozens more. Has inpainting, ControlNet, IP-Adapter, SAM nodes |
| Text-prompt extraction | YES via workflow nodes (GroundingDINO + SAM nodes available as custom nodes) |
| Model format | safetensors, ckpt, PyTorch, GGUF |
| CPU-only | Yes with `--cpu` flag (slow) |
| Model size | User-managed, no built-in models |
| JS/WASM/Node | Frontend is JS (Vue); **has full REST API** with WebSocket support |
| HTTP API | **YES** - native API server with `openapi.yaml`; workflows can be triggered via API |
| **Best for** | Most flexible/powerful platform. Best API support. Steeper learning curve |

### Fooocus
| Item | Detail |
|------|--------|
| GitHub | https://github.com/lllyasviel/Fooocus |
| Stars | ~50.8k |
| License | GPL-3.0 |
| What it does | Simplified Midjourney-like image generator based on SDXL. Features: inpainting, outpainting, image variation, image prompt (IP-Adapter), face swap |
| Text-prompt extraction | Limited - mainly text-to-image; inpaint/outpaint use text prompts |
| Model format | safetensors |
| CPU-only | Min 4GB Nvidia GPU + 8GB RAM; CPU mode ~17x slower |
| Model size | SDXL models ~6.5GB; inpaint model ~1.28GB |
| JS/WASM/Node | No |
| HTTP API | Gradio-based with `--share` flag; `--listen` for local network access |
| Status | Limited LTS, bug fixes only. Author recommends Forge/ComfyUI for newer models |

### Stable Diffusion WebUI (A1111)
| Item | Detail |
|------|--------|
| GitHub | https://github.com/AUTOMATIC1111/stable-diffusion-webui |
| Stars | ~164k |
| License | AGPL-3.0 |
| What it does | The original popular SD web UI. txt2img, img2img, inpainting, outpainting, upscaling, ControlNet (via extension), InstructPix2Pix support |
| Text-prompt extraction | Inpaint mode: paint mask + text prompt to replace region |
| Model format | ckpt, safetensors |
| CPU-only | 4GB VRAM minimum; CPU mode very slow |
| Model size | Varies |
| JS/WASM/Node | No |
| HTTP API | **YES** - full REST API (`--api` flag) with `/sdapi/v1/` endpoints |

### SD WebUI Forge
| Item | Detail |
|------|--------|
| GitHub | https://github.com/lllyasviel/stable-diffusion-webui-forge |
| Stars | ~12.8k |
| License | AGPL-3.0 |
| What it does | Enhanced fork of A1111 with better GPU memory management, faster inference, Flux/GGUF/BNF4 support, and cleaner extension API |
| Text-prompt extraction | Same as A1111 + better ControlNet/IP-Adapter integration |
| Model format | safetensors, ckpt, GGUF, BNF4 |
| CPU-only | Better memory management than A1111 |
| Model size | Varies |
| JS/WASM/Node | No |
| HTTP API | Yes (inherits A1111 API) |
| **Best for** | If you want A1111 UI but better performance + newer model support |

### InvokeAI
| Item | Detail |
|------|--------|
| GitHub | https://github.com/invoke-ai/InvokeAI |
| Stars | ~27.6k |
| License | Apache-2.0 |
| What it does | Professional creative engine with polished web UI. Features: unified canvas, node-based workflows, model management, SAM/SAM2 integration for object segmentation |
| Text-prompt extraction | YES - has built-in SAM/SAM2 for object selection + inpainting with text prompts |
| Model format | ckpt, diffusers, GGUF |
| CPU-only | Limited support |
| Model size | Varies |
| JS/WASM/Node | Frontend is React/TypeScript |
| HTTP API | Yes, full REST API |
| **Best for** | Most polished UI for professionals; best built-in SAM integration |
| Models supported | SD1.5, SD2, SDXL, SD3.5, Flux (dev/schnell/kontext), CogView4, Qwen Image |

---

## 4. Replicate API Models (Cloud, No GPU Needed)

| Model | What it does | Endpoint |
|-------|-------------|----------|
| `schananas/grounded_sam` | Text-prompt object detection + segmentation | Replicate API |
| `meta/sam-2-video` | Video segmentation | Replicate API |
| `cjwbw/semantic-segment-anything` | Semantic segmentation | Replicate API |
| `timothybrooks/instruct-pix2pix` | Text-guided image editing | Replicate API |
| `lucataco/remove-bg` | AI background removal | Replicate API |
| `851-labs/background-remover` | Background removal | Replicate API |
| Image editing collection | 36+ models for image editing | replicate.com/collections/image-editing |
| Object detection collection | 18+ models for detection/segmentation | replicate.com/collections/ai-detect-objects |
| Remove backgrounds collection | 13+ models | replicate.com/collections/remove-backgrounds |

---

## 5. Summary: Which Tool to Use for What

### "Extract specific element from image using text prompt"
1. **Grounded-SAM** (GroundingDINO + SAM) - Best overall solution
2. **LISA** - For complex reasoning ("segment the unusual thing")
3. **InvokeAI** with built-in SAM - Best UI for this

### "Remove/replace specific element"
1. **Inpaint-Anything** - Click + text prompt to remove/fill/replace
2. **Grounded-SAM + SD inpainting** - Text prompt to find + inpaint
3. **Diffusers InpaintPipeline** - Programmatic control

### "Edit image via text instruction"
1. **InstructPix2Pix** - Direct text-guided editing
2. **ComfyUI** with Flux Kontext - State-of-the-art editing
3. **Fooocus** - Simplified inpaint/outpaint

### "Need HTTP API (no GPU)"
1. **Replicate API** - Cloud-based, pay per use
2. **ComfyUI API** - Self-hosted, full control
3. **A1111/Forge API** - Self-hosted with `--api` flag

### "Lightweight/fast extraction"
1. **GroundingDINO** alone (~700MB) - Text to bounding boxes
2. **SAM ViT-B** (~375MB) - Fast segmentation
3. **MobileSAM** - Tiny SAM variant for edge devices

### "JavaScript/browser integration"
1. **SAM with ONNX** - Official ONNX export + React demo for browser inference
2. **ComfyUI** - Full REST API callable from any language
3. **Replicate API** - Simple HTTP calls from any language

---

## 6. Recommended Architecture for Image Extraction App

```
User provides: Image + Text Prompt ("extract the red car")
                          |
                          v
           [GroundingDINO] --text--> Bounding Boxes
                          |
                          v
           [SAM / SAM2] --boxes--> Precise Masks
                          |
                          v
           [Extract masked region] --mask + image--> Isolated Element (PNG with alpha)
                          |
                          v (optional)
           [SD Inpainting] --mask + prompt--> Replace/Remove/Fill
```

**All components are Apache-2.0 licensed** (GroundingDINO, SAM, SAM2, Diffusers), making this pipeline commercially safe.
