import { useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AnimationTask, AnimationConversation } from './types';
import { buildSpriteSheetPrompt, buildFinalFramesPrompt, validateFrameCount, getDefaultFrameCount } from './animationPrompt';
import LocalImage from './LocalImage';

interface AnimationTabProps {
  apiKey: string;
  apiUrl: string;
  model: string;
  conversations: AnimationConversation[];
  setConversations: React.Dispatch<React.SetStateAction<AnimationConversation[]>>;
  activeConvId: string | null;
  setActiveConvId: React.Dispatch<React.SetStateAction<string | null>>;
  setLightboxSrc: (src: string | null) => void;
}

function genId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function AnimationTab(props: AnimationTabProps) {
  const {
    apiKey, apiUrl, model,
    conversations, setConversations, activeConvId, setActiveConvId,
    setLightboxSrc,
  } = props;

  const [characterName, setCharacterName] = useState('');
  const [actionName, setActionName] = useState('');
  const [frameCount, setFrameCount] = useState(getDefaultFrameCount());
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  const activeConv = conversations.find(c => c.id === activeConvId);

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const blob = items[i].getAsFile();
        if (!blob) continue;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string;
          setReferenceImages(prev => prev.length < 6 ? [...prev, dataUrl] : prev);
        };
        reader.readAsDataURL(blob);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setReferenceImages(prev => prev.length < 6 ? [...prev, dataUrl] : prev);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removeReferenceImage = (idx: number) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== idx));
  };

  const createConversation = (): AnimationConversation => {
    const id = genId();
    const now = Date.now();
    const title = `${characterName || '角色'} - ${actionName || '动画'} ${new Date(now).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    const conv: AnimationConversation = {
      id,
      title,
      characterName: characterName || '未命名',
      tasks: [],
      createdAt: now,
      updatedAt: now,
    };
    setConversations(prev => [conv, ...prev]);
    setActiveConvId(id);
    return conv;
  };

  const handleGenerate = async () => {
    if (!apiKey || !apiUrl) {
      setError('请先配置 API Key 和 URL');
      return;
    }
    if (!actionName.trim()) {
      setError('请输入动作名称');
      return;
    }
    if (!validateFrameCount(frameCount)) {
      setError('帧数必须在 2-16 之间');
      return;
    }

    setError(null);
    setLoading(true);

    let conv = activeConv ? conversations.find(c => c.id === activeConvId) : null;
    if (!conv) {
      conv = createConversation();
    }

    const taskId = genId();
    const now = Date.now();
    const task: AnimationTask = {
      id: taskId,
      type: 'assistant',
      actionName: actionName.trim(),
      frameCount,
      loading: true,
      step: 'generating_sheets',
      referenceImages: referenceImages.length > 0 ? [...referenceImages] : undefined,
      timestamp: now,
    };

    setConversations(prev => prev.map(c => {
      if (c.id !== activeConvId) return c;
      return { ...c, tasks: [...c.tasks, task], updatedAt: now };
    }));

    const updateTask = (updates: Partial<AnimationTask>) => {
      setConversations(prev => prev.map(c => {
        if (c.id !== activeConvId) return c;
        return {
          ...c,
          tasks: c.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t),
          updatedAt: Date.now(),
        };
      }));
    };

    try {
      const sheetPrompt = buildSpriteSheetPrompt(actionName, frameCount);

      const sheetResult = await invoke<{ images: string[]; error: string | null }>('generate_image', {
        prompt: sheetPrompt,
        apiKey,
        apiUrl,
        model,
        size: '1344x576',
        n: 1,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        responseFormat: 'b64_json',
      });

      if (sheetResult.error || !sheetResult.images?.[0]) {
        updateTask({ loading: false, error: sheetResult.error || '生成序列帧图失败' });
        setLoading(false);
        return;
      }

      const spriteSheet = sheetResult.images[0];
      updateTask({
        spriteSheet,
        step: 'generating_frames',
      });

      const framesPrompt = buildFinalFramesPrompt(actionName, frameCount, referenceImages.length > 0);
      const refImages = referenceImages.length > 0 ? [...referenceImages, spriteSheet] : [spriteSheet];

      const framesResult = await invoke<{ images: string[]; error: string | null }>('generate_image', {
        prompt: framesPrompt,
        apiKey,
        apiUrl,
        model,
        size: '1344x576',
        n: 1,
        referenceImages: refImages,
        responseFormat: 'b64_json',
      });

      if (framesResult.error || !framesResult.images?.[0]) {
        updateTask({
          loading: false,
          error: framesResult.error || '生成最终帧失败',
          step: undefined,
        });
        setLoading(false);
        return;
      }

      updateTask({
        loading: false,
        finalFrames: framesResult.images,
        step: undefined,
      });
    } catch (err) {
      updateTask({ loading: false, error: String(err), step: undefined });
    } finally {
      setLoading(false);
    }
  };

  const deleteConversation = (id: string) => {
    setConversations(prev => {
      const updated = prev.filter(c => c.id !== id);
      if (activeConvId === id) {
        const next = updated[0];
        setActiveConvId(next?.id || null);
      }
      return updated;
    });
  };

  const switchConversation = (id: string) => {
    setActiveConvId(id);
  };

  return (
    <div className="animation-tab">
      <aside className="animation-sidebar">
        <div className="sidebar-actions">
          <button
            className="sidebar-new-btn"
            onClick={() => {
              setCharacterName('');
              setActionName('');
              setReferenceImages([]);
              setActiveConvId(null);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新动画
          </button>
        </div>
        <div className="sidebar-list">
          {conversations.length === 0 ? (
            <div className="sidebar-empty-hint">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
              </svg>
              <p>暂无动画记录</p>
            </div>
          ) : (
            [...conversations]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map(conv => (
                <div
                  key={conv.id}
                  className={`conv-item ${activeConvId === conv.id ? 'active' : ''}`}
                  onClick={() => switchConversation(conv.id)}
                >
                  <div className="conv-item-info">
                    <div className="conv-item-title">{conv.title}</div>
                    <div className="conv-item-preview">{conv.tasks.length} 条操作</div>
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

      <main className="animation-main" ref={mainRef} onPaste={handlePaste} tabIndex={0}>
        <div className="animation-form">
          <div className="form-group">
            <label>角色名称（可选）</label>
            <input
              type="text"
              value={characterName}
              onChange={e => setCharacterName(e.target.value)}
              placeholder="例如：战士、法师、猫"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label>动作名称 *</label>
            <input
              type="text"
              value={actionName}
              onChange={e => setActionName(e.target.value)}
              placeholder="例如：走路、跑步、攻击、跳跃"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label>
              帧数: {frameCount}
              <span className="form-hint">(最高 16 帧)</span>
            </label>
            <input
              type="range"
              min="2"
              max="16"
              value={frameCount}
              onChange={e => setFrameCount(Number(e.target.value))}
              disabled={loading}
            />
            <div className="frame-count-display">
              {Array.from({ length: frameCount }, (_, i) => (
                <span key={i} className="frame-indicator">{i + 1}</span>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>
              角色参考图（可选，最多 6 张）
              <span className="form-hint">用于保持角色一致性，支持 Ctrl+V 粘贴</span>
            </label>
            <div className="reference-images-grid">
              {referenceImages.map((img, idx) => (
                <div key={idx} className="reference-image-item">
                  <img src={img} alt={`参考图 ${idx + 1}`} onClick={() => setLightboxSrc(img)} />
                  <button
                    className="remove-reference-btn"
                    onClick={() => removeReferenceImage(idx)}
                    disabled={loading}
                  >
                    ×
                  </button>
                </div>
              ))}
              {referenceImages.length < 6 && (
                <button
                  className="upload-reference-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  上传图片
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
            </div>
          </div>

          <button
            className="generate-btn"
            onClick={handleGenerate}
            disabled={loading || !actionName.trim()}
          >
            {loading ? '生成中...' : '生成动画序列帧'}
          </button>

          {error && (
            <div className="validation-error">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="animation-results">
          {activeConv && activeConv.tasks.length > 0 ? (
            <>
              <h3 className="results-title">{activeConv.characterName} - 历史记录</h3>
              {activeConv.tasks.map(task => (
                <div key={task.id} className="animation-task-result">
                  <div className="task-header">
                    <span className="task-action">{task.actionName}</span>
                    <span className="task-meta">
                      {task.frameCount} 帧 · {formatTime(task.timestamp)}
                    </span>
                  </div>

                  {task.loading && (
                    <div className="task-loading">
                      <div className="loading-spinner" />
                      <span className="loading-text">
                        {task.step === 'generating_sheets' && '正在生成序列帧图...'}
                        {task.step === 'generating_frames' && '正在生成最终动画帧...'}
                      </span>
                      <div className="step-indicator">
                        <span className={task.step === 'generating_sheets' ? 'step active' : task.step === 'generating_frames' ? 'step done' : 'step pending'}>
                          {task.step === 'generating_sheets' ? '●' : task.step === 'generating_frames' ? '✓' : '○'} 序列帧图
                        </span>
                        <span className="step-arrow">→</span>
                        <span className={`step ${task.step === 'generating_frames' ? 'active' : 'pending'}`}>
                          {task.step === 'generating_frames' ? '●' : '○'} 最终帧
                        </span>
                      </div>
                    </div>
                  )}

                  {task.error && (
                    <div className="task-error">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                      </svg>
                      {task.error}
                    </div>
                  )}

                  {task.spriteSheet && (
                    <div className="sprite-sheet-result">
                      <div className="result-label">序列帧图（{task.frameCount} 帧）</div>
                      <div
                        className="sprite-sheet-image"
                        onClick={() => setLightboxSrc(task.spriteSheet!)}
                      >
                        <LocalImage
                          src={task.spriteSheet}
                          alt="序列帧图"
                          style={{ cursor: 'zoom-in', width: '100%', borderRadius: 8 }}
                        />
                      </div>
                    </div>
                  )}

                  {task.finalFrames && task.finalFrames.length > 0 && (
                    <div className="final-frames-result">
                      <div className="result-label">最终动画帧</div>
                      <div className="final-frames-grid">
                        {task.finalFrames.map((frame, idx) => (
                          <div
                            key={idx}
                            className="final-frame-item"
                            onClick={() => setLightboxSrc(frame)}
                          >
                            <LocalImage
                              src={frame}
                              alt={`帧 ${idx + 1}`}
                              style={{ cursor: 'zoom-in', width: '100%', borderRadius: 4 }}
                            />
                            <span className="frame-number">#{idx + 1}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {task.referenceImages && task.referenceImages.length > 0 && (
                    <div className="task-reference-images">
                      <div className="result-label">使用的参考图</div>
                      <div className="task-ref-grid">
                        {task.referenceImages.map((img, idx) => (
                          <img
                            key={idx}
                            src={img}
                            alt={`参考图 ${idx + 1}`}
                            onClick={() => setLightboxSrc(img)}
                            style={{ cursor: 'zoom-in' }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </>
          ) : (
            <div className="animation-empty">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
              </svg>
              <h3>开始创建动画</h3>
              <p>输入动作名称和角色信息，生成序列帧动画</p>
              <div className="animation-tips">
                <div>支持 2-16 帧序列帧动画</div>
                <div>上传角色参考图可提高一致性</div>
                <div>首先生成序列帧图，然后生成最终帧</div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
