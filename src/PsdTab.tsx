import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Provider, LlmConfig } from './store';
import type { PsdConversation } from './types';
import { getToolById } from './extractTools';
import LocalImage from './LocalImage';
import {
  PSD_PLACEMENT_APPENDIX,
  downloadArrayBuffer,
  exportExtractedImagesToPsd,
  flattenLayerTree,
  imageSourceToDataUrl,
  layersToPsdBuffer,
  parseExtractGroupPrompts,
  parsePsdBuffer,
  parsePsdPlacementFromLlm,
  stripAnalysisForDisplay,
  type LayerBox,
  type PsdLayerInfo,
} from './psdService';

interface PsdTabProps {
  providers: Provider[];
  llmConfig: LlmConfig;
  conversations: PsdConversation[];
  setConversations: React.Dispatch<React.SetStateAction<PsdConversation[]>>;
  activeConvId: string | null;
  setActiveConvId: React.Dispatch<React.SetStateAction<string | null>>;
  pendingSourceImage: string | null;
  onPendingConsumed: () => void;
  setLightboxSrc: (src: string | null) => void;
  onSessionsChange?: (sessions: PsdConversation[]) => void;
  /** 生图用 model，与提取模块一致 */
  imageModel: string;
}

function genId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const MAX_LLM_RETRIES = 3;
const MAX_GEN_RETRIES = 3;

export default function PsdTab(props: PsdTabProps) {
  const {
    providers, llmConfig, imageModel,
    conversations, setConversations, activeConvId, setActiveConvId,
    pendingSourceImage, onPendingConsumed, setLightboxSrc, onSessionsChange,
  } = props;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const psdInputRef = useRef<HTMLInputElement>(null);

  const activeConv = conversations.find(c => c.id === activeConvId) || null;
  const flatLayers = activeConv ? flattenLayerTree(activeConv.layers) : [];
  const selectedLayer = flatLayers.find(l => l.id === selectedLayerId) || flatLayers[0] || null;

  useEffect(() => {
    onSessionsChange?.(conversations);
  }, [conversations, onSessionsChange]);

  useEffect(() => {
    if (!pendingSourceImage) return;
    void openExportFromImage(pendingSourceImage);
    onPendingConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSourceImage]);

  const updateConversations = (updater: (prev: PsdConversation[]) => PsdConversation[]) => {
    setConversations(prev => updater(prev));
  };

  const patchConv = (convId: string, updates: Partial<PsdConversation>) => {
    updateConversations(prev => prev.map(c => c.id === convId ? { ...c, ...updates, updatedAt: Date.now() } : c));
  };

  const upsertConversation = (conv: PsdConversation) => {
    updateConversations(prev => {
      const idx = prev.findIndex(c => c.id === conv.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = conv;
        return next;
      }
      return [conv, ...prev];
    });
    setActiveConvId(conv.id);
  };

  const createEmptyExportSession = (sourceImage: string): PsdConversation => ({
    id: genId(),
    title: 'PSD 导出',
    mode: 'export',
    sourceImage,
    width: 0,
    height: 0,
    layers: [],
    status: 'idle',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const openExportFromImage = async (imageUrl: string) => {
    setError(null);
    const conv = createEmptyExportSession(imageUrl);
    upsertConversation(conv);
    await runExportPipeline(conv.id, imageUrl);
  };

  const generateImageWithRetry = async (params: {
    prompt: string;
    apiKey: string;
    apiUrl: string;
    model: string;
    size: string;
    referenceImages: string[];
  }): Promise<{ image: string | null; error: string | null }> => {
    let lastError: string | null = null;
    for (let attempt = 1; attempt <= MAX_GEN_RETRIES; attempt++) {
      try {
        const modelLower = (params.model || '').toLowerCase().replace(/_/g, '-');
        const isBanana = modelLower.includes('nano-banana') || modelLower.includes('nanobanana')
          || (modelLower.includes('gemini') && modelLower.includes('image'));
        const sizeMap: Record<string, string> = {
          '1024x1024': '1:1', '1040x832': '5:4', '832x1040': '4:5',
          '1280x720': '16:9', '720x1280': '9:16', '1024x768': '4:3',
          '768x1024': '3:4', '1008x672': '3:2', '672x1008': '2:3', '1344x576': '21:9',
          '1536x1024': '3:2',
        };
        const normalizedRefs: string[] = [];
        for (const img of params.referenceImages || []) {
          if (!img) continue;
          if (img.startsWith('data:') || img.startsWith('http://') || img.startsWith('https://')) {
            normalizedRefs.push(img);
          } else {
            normalizedRefs.push(await invoke<string>('read_image_base64', { path: img }));
          }
        }
        const result = await invoke<{ images: string[]; error: string | null }>('generate_image', {
          ...params,
          size: isBanana ? (sizeMap[params.size] || params.size) : params.size,
          referenceImages: normalizedRefs,
          n: 1,
          responseFormat: 'b64_json',
        });
        if (!result.error && result.images?.length > 0) {
          return { image: result.images[0], error: null };
        }
        lastError = result.error || '生图未返回图片';
      } catch (err) {
        lastError = String(err);
      }
      if (attempt < MAX_GEN_RETRIES) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    return { image: null, error: `重试${MAX_GEN_RETRIES}次后仍失败: ${lastError}` };
  };

  /**
   * 分步流程（对齐提取模块 UI元素拆分）：
   * 1. analyzing — LLM 语义分析，解析分组提示词 + PSD 定位
   * 2. generating — 逐组图生图拆图
   * 3. building — 按定位拼成 PSD 并下载
   */
  const runExportPipeline = async (convId: string, imageUrl: string) => {
    const prov = providers.find(p => p.id === llmConfig.providerId) || providers[0];
    if (!prov?.apiKey) {
      setError('请先在设置中配置带 LLM 能力的 API Key');
      patchConv(convId, { status: 'error', error: '缺少 API Key' });
      return;
    }

    const extractTool = getToolById('extract_all');
    if (!extractTool) {
      setError('找不到提取工具 extract_all');
      return;
    }

    setBusy(true);
    setStatusText('步骤 1/3：读取原图…');
    try {
      const imageBase64 = await imageSourceToDataUrl(imageUrl, (path) => invoke<string>('read_image_base64', { path }));
      patchConv(convId, {
        sourceImage: imageBase64,
        status: 'analyzing',
        error: undefined,
        layers: [],
      });

      // 与提取模块完全一致：/images/generations → /chat/completions
      const llmApiUrl = prov.baseUrl.replace('/images/generations', '/chat/completions');
      const basePrompt = extractTool.multiImagePrompt || extractTool.prompt;
      const enhancedPrompt = `${basePrompt}${PSD_PLACEMENT_APPENDIX}`;

      setStatusText('步骤 1/3：LLM 语义分析拆分中（同提取模块）…');
      let lastContent = '';
      let groupPrompts: string[] = [];
      let groupTitles: string[] = [];

      for (let attempt = 1; attempt <= MAX_LLM_RETRIES; attempt++) {
        const actualPrompt = attempt > 1
          ? `${enhancedPrompt}\n\n【格式修正提醒 - 第${attempt}次重试】上一次输出缺少正确的"### 生成提示词 - 分组1"标记。请严格按照输出格式。`
          : enhancedPrompt;

        const llmResult = await invoke<{ content: string; error: string | null }>('llm_chat', {
          apiUrl: llmApiUrl,
          apiKey: prov.apiKey,
          model: llmConfig.model,
          prompt: actualPrompt,
          imageBase64,
        });
        if (llmResult.error) throw new Error(llmResult.error);

        lastContent = llmResult.content;
        const parsed = parseExtractGroupPrompts(lastContent);
        groupPrompts = parsed.prompts;
        groupTitles = parsed.titles;
        if (groupPrompts.length > 0) break;
      }

      if (groupPrompts.length === 0) {
        throw new Error(`LLM 返回格式不正确（重试${MAX_LLM_RETRIES}次后仍未能解析分组提示词）`);
      }

      const placements = parsePsdPlacementFromLlm(lastContent);
      const displayAnalysis = stripAnalysisForDisplay(lastContent);

      patchConv(convId, {
        status: 'generating',
        analysisText: displayAnalysis,
        groupTitles,
        title: `导出 ${groupPrompts.length} 组素材`,
      });

      // 步骤 2：分组生图
      const genApiUrl = prov.baseUrl;
      const extracted: { name: string; dataUrl: string; box?: LayerBox }[] = [];
      const progressiveLayers: PsdLayerInfo[] = [];

      for (let idx = 0; idx < groupPrompts.length; idx++) {
        const genPrompt = groupPrompts[idx]!;
        const title = groupTitles[idx] || `分组${idx + 1}`;
        setStatusText(`步骤 2/3：生图拆分 ${idx + 1}/${groupPrompts.length} — ${title}`);

        const promptLower = genPrompt.toLowerCase();
        const isGrid = /grid layout|2x2|3x3|4x4|multiple objects|multiple scene objects|all objects|all scene objects/i.test(promptLower);
        const isCharacter = /character reference sheet|三视图|three views|front view.*side view.*back view/i.test(promptLower);
        const genSize = isCharacter ? '1536x1024' : isGrid ? '1536x1024' : '1024x1024';

        const genResult = await generateImageWithRetry({
          prompt: genPrompt,
          apiKey: prov.apiKey,
          apiUrl: genApiUrl,
          model: imageModel,
          size: genSize,
          referenceImages: [imageBase64],
        });

        if (!genResult.image) {
          setStatusText(`步骤 2/3：${title} 生图失败，跳过…`);
          continue;
        }

        const box = placements[idx];
        extracted.push({
          name: box?.name || title,
          dataUrl: genResult.image,
          box,
        });

        // 预览层先按中间结果展示（最终位置在 building 时校正）
        progressiveLayers.push({
          id: genId(),
          name: box?.name || title,
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          opacity: 1,
          hidden: false,
          previewDataUrl: genResult.image.startsWith('data:')
            ? genResult.image
            : `data:image/png;base64,${genResult.image}`,
        });
        patchConv(convId, { layers: [...progressiveLayers] });
        setSelectedLayerId(progressiveLayers[progressiveLayers.length - 1]?.id || null);
      }

      if (extracted.length === 0) {
        throw new Error('所有分组生图均失败，无法生成 PSD');
      }

      // 步骤 3：拼 PSD
      setStatusText(`步骤 3/3：按原图位置拼接 ${extracted.length} 个图层为 PSD…`);
      patchConv(convId, { status: 'building' });

      const { buffer, width, height, layers } = await exportExtractedImagesToPsd(imageBase64, extracted, {
        includeSourceLayer: true,
      });

      patchConv(convId, {
        title: `导出 ${extracted.length} 层`,
        width,
        height,
        layers,
        status: 'done',
        analysisText: displayAnalysis,
        groupTitles,
        error: undefined,
      });
      setSelectedLayerId(layers.find(l => l.name !== '原图参考')?.id || layers[0]?.id || null);
      setStatusText(`完成：${layers.length} 层 / ${width}×${height}，正在下载 PSD…`);
      downloadArrayBuffer(buffer, `extract_export_${Date.now()}.psd`);
    } catch (err) {
      const msg = String(err);
      setError(msg);
      patchConv(convId, { status: 'error', error: msg });
    } finally {
      setBusy(false);
      setTimeout(() => setStatusText(null), 3000);
    }
  };

  const handleImportPsdFile = async (file: File) => {
    setError(null);
    setBusy(true);
    setStatusText('正在解析 PSD…');
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parsePsdBuffer(buffer);
      const id = genId();
      const conv: PsdConversation = {
        id,
        title: file.name.replace(/\.psd$/i, '') || '导入 PSD',
        mode: 'import',
        sourceImage: parsed.compositeDataUrl || '',
        width: parsed.width,
        height: parsed.height,
        layers: parsed.layers,
        status: 'done',
        analysisText: `导入 ${flattenLayerTree(parsed.layers).length} 个图层`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      upsertConversation(conv);
      setSelectedLayerId(flattenLayerTree(parsed.layers)[0]?.id || null);
      setStatusText(`已导入：${parsed.width}×${parsed.height}`);
    } catch (err) {
      setError(`PSD 解析失败：${String(err)}`);
    } finally {
      setBusy(false);
      setTimeout(() => setStatusText(null), 2500);
    }
  };

  const handleImageFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      void openExportFromImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const reDownloadActive = async () => {
    if (!activeConv || activeConv.layers.length === 0) return;
    setBusy(true);
    try {
      const buffer = await layersToPsdBuffer(
        activeConv.width,
        activeConv.height,
        activeConv.layers,
        activeConv.sourceImage || undefined,
      );
      downloadArrayBuffer(buffer, `${activeConv.title || 'export'}_${Date.now()}.psd`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const deleteConversation = (id: string) => {
    updateConversations(prev => {
      const updated = prev.filter(c => c.id !== id);
      if (activeConvId === id) {
        setActiveConvId(updated[0]?.id || null);
        setSelectedLayerId(null);
      }
      return updated;
    });
  };

  const statusLabel = (status: PsdConversation['status']) => {
    switch (status) {
      case 'analyzing': return '分析中';
      case 'generating': return '拆图中';
      case 'building': return '拼 PSD';
      case 'done': return '完成';
      case 'error': return '失败';
      default: return '';
    }
  };

  const renderLayerRow = (layer: PsdLayerInfo, depth = 0) => {
    const isActive = selectedLayer?.id === layer.id;
    return (
      <div key={layer.id}>
        <button
          type="button"
          className={`psd-layer-item ${isActive ? 'active' : ''} ${layer.hidden ? 'hidden-layer' : ''}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => setSelectedLayerId(layer.id)}
        >
          {layer.previewDataUrl ? (
            <img src={layer.previewDataUrl} alt="" className="psd-layer-thumb" />
          ) : (
            <div className="psd-layer-thumb placeholder" />
          )}
          <div className="psd-layer-meta">
            <div className="psd-layer-name">{layer.name}</div>
            <div className="psd-layer-size">
              {layer.width > 0 ? `${layer.width}×${layer.height} @ (${layer.left},${layer.top})` : '生成中…'}
            </div>
          </div>
        </button>
        {layer.children?.map(child => renderLayerRow(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="psd-tab">
      <aside className="psd-sidebar">
        <div className="sidebar-actions" style={{ flexDirection: 'column', gap: 8 }}>
          <button
            className="sidebar-new-btn"
            disabled={busy}
            onClick={() => imageInputRef.current?.click()}
            title="按提取模块分步拆图并导出 PSD"
          >
            导出 PSD
          </button>
          <button
            className="sidebar-new-btn"
            disabled={busy}
            onClick={() => psdInputRef.current?.click()}
            title="导入 PSD 查看层级"
            style={{ opacity: 0.92 }}
          >
            导入 PSD
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void handleImageFile(f);
              e.target.value = '';
            }}
          />
          <input
            ref={psdInputRef}
            type="file"
            accept=".psd,image/vnd.adobe.photoshop"
            hidden
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void handleImportPsdFile(f);
              e.target.value = '';
            }}
          />
        </div>
        <div className="sidebar-list">
          {conversations.length === 0 ? (
            <div className="sidebar-empty-hint">
              <p>暂无 PSD 记录</p>
              <p style={{ fontSize: 11, opacity: 0.7 }}>右键图片「导出 PSD」，流程同提取拆分</p>
            </div>
          ) : (
            [...conversations]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map(conv => (
                <div
                  key={conv.id}
                  className={`conv-item ${activeConvId === conv.id ? 'active' : ''}`}
                  onClick={() => {
                    setActiveConvId(conv.id);
                    setSelectedLayerId(conv.layers[0]?.id || null);
                  }}
                >
                  <div className="conv-item-info">
                    <div className="conv-item-title">{conv.title}</div>
                    <div className="conv-item-preview">
                      {conv.mode === 'import' ? '导入' : '导出'} · {flattenLayerTree(conv.layers).length} 层
                      {statusLabel(conv.status) ? ` · ${statusLabel(conv.status)}` : ''}
                    </div>
                  </div>
                  <div className="conv-item-actions">
                    <button
                      className="conv-action-btn conv-delete-btn"
                      title="删除"
                      onClick={e => { e.stopPropagation(); deleteConversation(conv.id); }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))
          )}
        </div>
      </aside>

      <main className="psd-main">
        {!activeConv ? (
          <div className="welcome">
            <h2>PSD 分层工作台</h2>
            <p>流程对齐提取模块：语义分析 → 分组拆图 → 按原图位置拼成 PSD。</p>
            <div className="psd-welcome-actions">
              <button className="extract-change-btn" disabled={busy} onClick={() => imageInputRef.current?.click()}>导出 PSD</button>
              <button className="extract-change-btn" disabled={busy} onClick={() => psdInputRef.current?.click()}>导入 PSD</button>
            </div>
          </div>
        ) : (
          <div className="psd-content">
            <div className="psd-preview-panel">
              <div className="psd-panel-title">
                {activeConv.mode === 'import' ? '合成预览' : '原图'}
                {activeConv.width > 0 && (
                  <span className="psd-size-badge">{activeConv.width}×{activeConv.height}</span>
                )}
              </div>
              <div className="psd-source-frame">
                {activeConv.sourceImage ? (
                  <LocalImage
                    src={activeConv.sourceImage}
                    alt="source"
                    onClick={() => setLightboxSrc(activeConv.sourceImage)}
                  />
                ) : (
                  <div className="psd-empty">无预览</div>
                )}
              </div>

              <div className="psd-panel-title" style={{ marginTop: 16 }}>选中图层</div>
              <div className="psd-source-frame">
                {selectedLayer?.previewDataUrl ? (
                  <img
                    src={selectedLayer.previewDataUrl}
                    alt={selectedLayer.name}
                    onClick={() => setLightboxSrc(selectedLayer.previewDataUrl)}
                    style={{ cursor: 'zoom-in', maxWidth: '100%', maxHeight: 280, objectFit: 'contain' }}
                  />
                ) : (
                  <div className="psd-empty">选择左侧图层查看</div>
                )}
              </div>

              <div className="psd-actions">
                <button className="extract-change-btn" disabled={busy || activeConv.layers.length === 0 || activeConv.status !== 'done'} onClick={() => void reDownloadActive()}>
                  下载 PSD
                </button>
                {activeConv.mode === 'export' && activeConv.sourceImage && (
                  <button
                    className="extract-change-btn"
                    disabled={busy}
                    onClick={() => void runExportPipeline(activeConv.id, activeConv.sourceImage)}
                  >
                    重新拆图导出
                  </button>
                )}
              </div>
            </div>

            <div className="psd-layers-panel">
              <div className="psd-panel-title">
                图层列表 ({flatLayers.length})
                {activeConv.status !== 'idle' && activeConv.status !== 'done' && (
                  <span className="psd-size-badge">{statusLabel(activeConv.status)}</span>
                )}
              </div>
              {activeConv.analysisText && (
                <div className="psd-analysis">{activeConv.analysisText.slice(0, 800)}{activeConv.analysisText.length > 800 ? '…' : ''}</div>
              )}
              {(busy || statusText) && (
                <div className="psd-status">{statusText || '处理中…'}</div>
              )}
              {error && <div className="psd-error">{error}</div>}
              {activeConv.error && <div className="psd-error">{activeConv.error}</div>}
              <div className="psd-layer-list">
                {activeConv.layers.length === 0 ? (
                  <div className="psd-empty">
                    {activeConv.status === 'analyzing'
                      ? '正在语义分析拆分…'
                      : activeConv.status === 'generating'
                        ? '正在分组生图…'
                        : activeConv.status === 'building'
                          ? '正在拼接 PSD…'
                          : '暂无图层'}
                  </div>
                ) : (
                  activeConv.layers.map(l => renderLayerRow(l))
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
