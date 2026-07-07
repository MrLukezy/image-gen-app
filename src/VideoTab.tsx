import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { VideoTask, VideoConversation, VideoModel, VideoOrientation } from './types';

interface VideoTabProps {
  apiKey: string;
  apiUrl: string;
  conversations: VideoConversation[];
  setConversations: React.Dispatch<React.SetStateAction<VideoConversation[]>>;
  activeConvId: string | null;
  setActiveConvId: React.Dispatch<React.SetStateAction<string | null>>;
}

// ──────────────────────────── Constants ──────────────────────────────────

const VIDEO_MODELS: { value: VideoModel; label: string }[] = [
  { value: 'sora-2', label: 'Sora 2' },
  { value: 'sd-2', label: 'SD-2' },
  { value: 'sd-2-vip', label: 'SD-2 VIP' },
  { value: 'Kling Omni', label: 'Kling Omni' },
];

const VIDEO_MODEL_DURATIONS: Record<VideoModel, string[]> = {
  'sora-2': ['4', '8', '12'],
  'sd-2': Array.from({ length: 12 }, (_, i) => String(i + 4)),  // 4-15
  'sd-2-vip': Array.from({ length: 12 }, (_, i) => String(i + 4)),
  'Kling Omni': ['3', '5', '8', '10', '12', '15'],
};

const VIDEO_MODEL_ORIENTATIONS: Record<VideoModel, { label: string; value: VideoOrientation }[]> = {
  'sora-2': [{ label: '横屏', value: 'landscape' }, { label: '竖屏', value: 'portrait' }],
  'sd-2': [{ label: '横屏', value: 'landscape' }, { label: '竖屏', value: 'portrait' }],
  'sd-2-vip': [{ label: '横屏', value: 'landscape' }, { label: '竖屏', value: 'portrait' }],
  'Kling Omni': [{ label: '横屏', value: 'landscape' }, { label: '竖屏', value: 'portrait' }, { label: '方屏', value: 'square' }],
};

const VIDEO_MODEL_MAX_IMAGES: Record<VideoModel, number> = {
  'sora-2': 1,
  'sd-2': 9,
  'sd-2-vip': 9,
  'Kling Omni': 7,
};

const ORIENTATION_LABELS: Record<VideoOrientation, string> = {
  landscape: '横屏',
  portrait: '竖屏',
  square: '方屏',
};

// ──────────────────────────── Helpers ────────────────────────────────────

function genId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

// ──────────────────────────── Component ──────────────────────────────────

export default function VideoTab(props: VideoTabProps) {
  const {
    apiKey, apiUrl,
    conversations, setConversations,
    activeConvId, setActiveConvId,
  } = props;

  // Form state
  const [prompt, setPrompt] = useState('');
  const [videoModel, setVideoModel] = useState<VideoModel>('sora-2');
  const [orientation, setOrientation] = useState<VideoOrientation>('landscape');
  const [duration, setDuration] = useState('8');
  const [refImageUrls, setRefImageUrls] = useState('');
  const [refVideoUrls, setRefVideoUrls] = useState('');
  const [refAudioUrls, setRefAudioUrls] = useState('');
  const [startFrameUrl, setStartFrameUrl] = useState('');
  const [endFrameUrl, setEndFrameUrl] = useState('');
  const [sdSize, setSdSize] = useState<'large' | 'small'>('large');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const chatAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pastedImages, setPastedImages] = useState<string[]>([]);

  const activeConv = conversations.find(c => c.id === activeConvId);

  // Auto-scroll chat area
  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }
  }, [activeConv?.tasks]);

  // Derived: available options based on model
  const availableDurations = VIDEO_MODEL_DURATIONS[videoModel];
  const availableOrientations = VIDEO_MODEL_ORIENTATIONS[videoModel];
  const maxRefImages = VIDEO_MODEL_MAX_IMAGES[videoModel];
  const isKling = videoModel === 'Kling Omni';
  const canUseVideoRef = videoModel !== 'sora-2';
  const canUseAudioRef = videoModel === 'sd-2' || videoModel === 'sd-2-vip';
  const showSdSize = videoModel === 'sd-2' || videoModel === 'sd-2-vip' || videoModel === 'Kling Omni';

  // Reset duration/orientation when model changes
  const handleModelChange = (m: VideoModel) => {
    setVideoModel(m);
    const durations = VIDEO_MODEL_DURATIONS[m];
    if (!durations.includes(duration)) {
      setDuration(durations[0]);
    }
    const orient = VIDEO_MODEL_ORIENTATIONS[m];
    if (!orient.find(o => o.value === orientation)) {
      setOrientation(orient[0].value);
    }
  };

  // Handle paste for reference images
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
          setPastedImages(prev => prev.length < maxRefImages ? [...prev, dataUrl] : prev);
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
        setPastedImages(prev => prev.length < maxRefImages ? [...prev, dataUrl] : prev);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  // ── Conversation Management ──────────────────────────────────────────

  const createConversation = (): VideoConversation => {
    const id = genId();
    const now = Date.now();
    const conv: VideoConversation = {
      id,
      title: prompt.slice(0, 30) || '新对话',
      tasks: [],
      createdAt: now,
      updatedAt: now,
    };
    setConversations(prev => [conv, ...prev]);
    setActiveConvId(id);
    return conv;
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

  const renameConversation = (id: string, title: string) => {
    setConversations(prev => prev.map(c =>
      c.id === id ? { ...c, title } : c
    ));
  };

  // ── Generate Video ────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (!apiKey) {
      setError('请先配置 API Key');
      return;
    }

    setError(null);
    setLoading(true);

    let conv = activeConv;
    if (!conv) {
      conv = createConversation();
    }

    const taskId = genId();
    const now = Date.now();
    const trimmedPrompt = prompt.trim();

    // Collect reference images
    const urlImages = refImageUrls.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    const allRefImages = [...pastedImages, ...urlImages];

    const urlVideos = refVideoUrls.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    const urlAudios = refAudioUrls.split('\n').map(u => u.trim()).filter(u => u.length > 0);

    // Create user entry
    const userTask: VideoTask = {
      id: `${taskId}_user`,
      type: 'user',
      prompt: trimmedPrompt,
      model: videoModel,
      orientation,
      duration,
      timestamp: now,
      referenceImages: allRefImages.length > 0 ? [...allRefImages] : undefined,
      referenceVideos: urlVideos.length > 0 ? [...urlVideos] : undefined,
      referenceAudios: urlAudios.length > 0 ? [...urlAudios] : undefined,
      startFrameImage: (isKling && startFrameUrl.trim()) ? startFrameUrl.trim() : undefined,
      endFrameImage: (isKling && endFrameUrl.trim()) ? endFrameUrl.trim() : undefined,
    };

    // Create assistant loading entry
    const assistantTask: VideoTask = {
      id: taskId,
      type: 'assistant',
      prompt: trimmedPrompt,
      model: videoModel,
      orientation,
      duration,
      loading: true,
      timestamp: now,
      progress: '提交中...',
    };

    const newTitle = conv.tasks.length === 0 ? trimmedPrompt.slice(0, 30) : conv.title;

    setConversations(prev => prev.map(c => {
      if (c.id !== conv!.id) return c;
      return {
        ...c,
        title: newTitle,
        tasks: [...c.tasks, userTask, assistantTask],
        updatedAt: now,
      };
    }));

    setPrompt('');

    const updateAssistantTask = (updates: Partial<VideoTask>) => {
      setConversations(prev => prev.map(c => {
        if (c.id !== conv!.id) return c;
        return {
          ...c,
          tasks: c.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t),
          updatedAt: Date.now(),
        };
      }));
    };

    try {
      const result = await invoke<{
        video_url: string | null;
        thumbnail_url: string | null;
        error: string | null;
        progress: string | null;
      }>('generate_video', {
        prompt: trimmedPrompt,
        apiKey,
        apiUrl,
        model: videoModel,
        orientation,
        duration: parseInt(duration),
        imageUrls: allRefImages.length > 0 ? allRefImages : null,
        videoUrls: urlVideos.length > 0 ? urlVideos : null,
        audioUrls: urlAudios.length > 0 ? urlAudios : null,
        startImageUrl: (isKling && startFrameUrl.trim()) ? startFrameUrl.trim() : null,
        endImageUrl: (isKling && endFrameUrl.trim()) ? endFrameUrl.trim() : null,
        sdSize: showSdSize ? sdSize : null,
      });

      if (result.error) {
        updateAssistantTask({ loading: false, error: result.error, completedAt: Date.now() });
      } else if (result.video_url) {
        updateAssistantTask({
          loading: false,
          videoUrl: result.video_url,
          thumbnailUrl: result.thumbnail_url || undefined,
          progress: '100%',
          completedAt: Date.now(),
        });
      } else {
        updateAssistantTask({ loading: false, error: '未获取到视频结果', completedAt: Date.now() });
      }
    } catch (err) {
      updateAssistantTask({ loading: false, error: String(err), completedAt: Date.now() });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleGenerate();
    }
  };

  // Inline rename state
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="video-tab">
      {/* Sidebar */}
      <aside className="video-sidebar">
        <div className="sidebar-actions">
          <button
            className="sidebar-new-btn"
            onClick={() => {
              setPrompt('');
              setPastedImages([]);
              setRefImageUrls('');
              setRefVideoUrls('');
              setRefAudioUrls('');
              setStartFrameUrl('');
              setEndFrameUrl('');
              setActiveConvId(null);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新视频
          </button>
        </div>
        <div className="sidebar-list">
          {conversations.length === 0 ? (
            <div className="sidebar-empty-hint">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              <p>暂无视频记录</p>
            </div>
          ) : (
            [...conversations]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map(conv => {
                const videoCount = conv.tasks.filter(t => t.type === 'assistant' && t.videoUrl).length;
                const hasLoading = conv.tasks.some(t => t.loading);
                return (
                  <div
                    key={conv.id}
                    className={`conv-item ${activeConvId === conv.id ? 'active' : ''}`}
                    onClick={() => switchConversation(conv.id)}
                  >
                    {editingConvId === conv.id ? (
                      <input
                        className="conv-rename-input"
                        value={editingTitle}
                        autoFocus
                        onChange={e => setEditingTitle(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            renameConversation(conv.id, editingTitle);
                            setEditingConvId(null);
                          }
                          if (e.key === 'Escape') setEditingConvId(null);
                        }}
                        onBlur={() => { renameConversation(conv.id, editingTitle); setEditingConvId(null); }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <div className="conv-item-info">
                        <div className="conv-item-title">
                          {conv.title}
                          {hasLoading && <span className="conv-loading-dot" />}
                        </div>
                        <div className="conv-item-preview">
                          {videoCount} 个视频 · {conv.tasks.filter(t => t.type === 'user').length} 条
                        </div>
                      </div>
                    )}
                    <div className="conv-item-actions">
                      <button
                        className="conv-action-btn"
                        title="重命名"
                        onClick={e => { e.stopPropagation(); setEditingConvId(conv.id); setEditingTitle(conv.title); }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                        </svg>
                      </button>
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
                );
              })
          )}
        </div>
      </aside>

      {/* Main: Form + Chat */}
      <main className="video-main" onPaste={handlePaste} tabIndex={0}>
        {/* Form */}
        <div className="video-form">
          {/* Prompt */}
          <div className="video-form-row">
            <div className="video-prompt-area">
              <textarea
                className="video-prompt-input"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="描述你想生成的视频内容...&#10;Ctrl+Enter 发送"
                disabled={loading}
                rows={3}
              />
            </div>
            <button
              className="video-generate-btn"
              onClick={handleGenerate}
              disabled={loading || !prompt.trim()}
            >
              {loading ? (
                <div className="loading-spinner" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              )}
              <span>{loading ? '生成中...' : '生成'}</span>
            </button>
          </div>

          {/* Parameters Row */}
          <div className="video-params-row">
            <div className="video-param">
              <label>模型</label>
              <select
                value={videoModel}
                onChange={e => handleModelChange(e.target.value as VideoModel)}
                disabled={loading}
              >
                {VIDEO_MODELS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div className="video-param">
              <label>方向</label>
              <div className="video-segmented">
                {availableOrientations.map(o => (
                  <button
                    key={o.value}
                    className={`segmented-btn ${orientation === o.value ? 'active' : ''}`}
                    onClick={() => setOrientation(o.value)}
                    disabled={loading}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="video-param">
              <label>时长(秒)</label>
              <select
                value={duration}
                onChange={e => setDuration(e.target.value)}
                disabled={loading}
              >
                {availableDurations.map(d => (
                  <option key={d} value={d}>{d}s</option>
                ))}
              </select>
            </div>

            {showSdSize && (
              <div className="video-param">
                <label>画质</label>
                <div className="video-segmented">
                  <button
                    className={`segmented-btn ${sdSize === 'large' ? 'active' : ''}`}
                    onClick={() => setSdSize('large')}
                    disabled={loading}
                  >高清</button>
                  <button
                    className={`segmented-btn ${sdSize === 'small' ? 'active' : ''}`}
                    onClick={() => setSdSize('small')}
                    disabled={loading}
                  >标清</button>
                </div>
              </div>
            )}

            <button
              className={`video-advanced-toggle ${showAdvanced ? 'active' : ''}`}
              onClick={() => setShowAdvanced(v => !v)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9" />
              </svg>
              {showAdvanced ? '收起' : '素材'}
            </button>
          </div>

          {/* Advanced Section */}
          {showAdvanced && (
            <div className="video-advanced-section">
              {/* Reference Images */}
              <div className="video-advanced-group">
                <label>参考图片 URL（每行一个，最多 {maxRefImages} 个）</label>
                <textarea
                  className="video-url-input"
                  value={refImageUrls}
                  onChange={e => setRefImageUrls(e.target.value)}
                  placeholder="https://example.com/image1.png&#10;https://example.com/image2.png"
                  rows={2}
                  disabled={loading}
                />
                {/* Pasted images */}
                {pastedImages.length > 0 && (
                  <div className="reference-images-grid" style={{ marginTop: 8 }}>
                    {pastedImages.map((img, idx) => (
                      <div key={idx} className="reference-image-item">
                        <img src={img} alt={`参考图 ${idx + 1}`} />
                        <button
                          className="remove-reference-btn"
                          onClick={() => setPastedImages(prev => prev.filter((_, i) => i !== idx))}
                          disabled={loading}
                        >×</button>
                      </div>
                    ))}
                    {pastedImages.length < maxRefImages && (
                      <button
                        className="upload-reference-btn"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={loading}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        上传
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
                )}
              </div>

              {/* Reference Videos */}
              {canUseVideoRef && (
                <div className="video-advanced-group">
                  <label>参考视频 URL（每行一个）</label>
                  <textarea
                    className="video-url-input"
                    value={refVideoUrls}
                    onChange={e => setRefVideoUrls(e.target.value)}
                    placeholder="https://example.com/video1.mp4"
                    rows={2}
                    disabled={loading}
                  />
                </div>
              )}

              {/* Reference Audio */}
              {canUseAudioRef && (
                <div className="video-advanced-group">
                  <label>参考音频 URL（每行一个，最多 3 个）</label>
                  <textarea
                    className="video-url-input"
                    value={refAudioUrls}
                    onChange={e => setRefAudioUrls(e.target.value)}
                    placeholder="https://example.com/audio1.mp3"
                    rows={2}
                    disabled={loading}
                  />
                </div>
              )}

              {/* Kling Keyframes */}
              {isKling && (
                <div className="video-advanced-group">
                  <label>Kling 首尾帧</label>
                  <div className="video-keyframes-row">
                    <input
                      type="text"
                      placeholder="首帧图片 URL"
                      value={startFrameUrl}
                      onChange={e => setStartFrameUrl(e.target.value)}
                      disabled={loading}
                    />
                    <input
                      type="text"
                      placeholder="尾帧图片 URL"
                      value={endFrameUrl}
                      onChange={e => setEndFrameUrl(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="validation-error">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Chat Area */}
        <div className="video-chat-area" ref={chatAreaRef}>
          {activeConv && activeConv.tasks.length > 0 ? (
            activeConv.tasks.map(task => (
              <div key={task.id} className={`video-task-entry ${task.type} ${task.loading ? 'loading' : ''}`}>
                {task.type === 'user' && (
                  <div className="video-user-msg">
                    <div className="video-user-prompt">{task.prompt}</div>
                    <div className="video-user-meta">
                      <span className="video-model-badge">{task.model}</span>
                      <span>{ORIENTATION_LABELS[task.orientation]} · {task.duration}s</span>
                      <span>{formatTime(task.timestamp)}</span>
                    </div>
                    {task.referenceImages && task.referenceImages.length > 0 && (
                      <div className="video-ref-grid">
                        {task.referenceImages.map((img, idx) => (
                          <img key={idx} src={img} alt={`参考图 ${idx + 1}`} className="video-ref-thumb" />
                        ))}
                      </div>
                    )}
                    {task.referenceVideos && task.referenceVideos.length > 0 && (
                      <div className="video-ref-grid">
                        {task.referenceVideos.map((_url, idx) => (
                          <span key={idx} className="video-ref-url-badge">🎬 视频 {idx + 1}</span>
                        ))}
                      </div>
                    )}
                    {(task.startFrameImage || task.endFrameImage) && (
                      <div className="video-ref-grid">
                        {task.startFrameImage && <span className="video-ref-url-badge">🖼️ 首帧</span>}
                        {task.endFrameImage && <span className="video-ref-url-badge">🖼️ 尾帧</span>}
                      </div>
                    )}
                  </div>
                )}

                {task.type === 'assistant' && (
                  <div className="video-assistant-msg">
                    {task.loading && (
                      <div className="video-loading-state">
                        <div className="loading-spinner" />
                        <div className="video-loading-info">
                          <span className="video-loading-text">{task.progress || '视频生成中...'}</span>
                          <span className="video-loading-hint">
                            通常需要 2-10 分钟，请耐心等待
                          </span>
                        </div>
                      </div>
                    )}

                    {task.error && !task.loading && (
                      <div className="video-error-msg">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                        {task.error}
                      </div>
                    )}

                    {task.videoUrl && !task.loading && (
                      <div className="video-result">
                        <div className="video-player-container">
                          <video
                            src={task.videoUrl}
                            controls
                            preload="metadata"
                            className="video-player"
                          />
                        </div>
                        <div className="video-result-meta">
                          <span className="video-model-badge">{task.model}</span>
                          {task.completedAt && (
                            <span>{formatDuration(task.completedAt - task.timestamp)}</span>
                          )}
                          <a
                            href={task.videoUrl}
                            download
                            className="video-download-btn"
                            title="下载视频"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            下载
                          </a>
                          <a
                            href={task.videoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="video-download-btn"
                            title="新窗口打开"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                              <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="video-empty">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              <h3>AI 视频生成</h3>
              <p>输入描述，生成 AI 视频</p>
              <div className="video-tips">
                <div>支持 Sora 2 / SD-2 / Kling Omni 等模型</div>
                <div>可上传参考图片控制画面风格</div>
                <div>Kling 支持首尾帧控制</div>
                <div>生成通常需要 2-10 分钟</div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
