import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_API_KEY } from './config';
import './styles/App.css';

const SIZE_OPTIONS = [
  { label: '1:1', value: '1024x1024' },
  { label: '5:4', value: '1040x832' },
  { label: '4:5', value: '832x1040' },
  { label: '16:9', value: '1280x720' },
  { label: '9:16', value: '720x1280' },
  { label: '4:3', value: '1024x768' },
  { label: '3:4', value: '768x1024' },
  { label: '3:2', value: '1008x672' },
  { label: '2:3', value: '672x1008' },
  { label: '21:9', value: '1344x576' },
];

interface ChatEntry {
  id: string;
  type: 'user' | 'assistant';
  prompt?: string;
  images?: string[];
  error?: string;
  loading?: boolean;
  timestamp: number;
  size?: string;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export default function App() {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [refUrls, setRefUrls] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState(DEFAULT_API_KEY);
  const [isLoading, setIsLoading] = useState(false);
  const [numImages, setNumImages] = useState(1);
  const [showRefInput, setShowRefInput] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatAreaRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  const handleSend = async () => {
    if (!prompt.trim() || isLoading) return;

    const userPrompt = prompt.trim();
    const userId = `user_${Date.now()}`;
    const assistantId = `assistant_${Date.now()}`;

    const userEntry: ChatEntry = {
      id: userId,
      type: 'user',
      prompt: userPrompt,
      timestamp: Date.now(),
      size,
    };

    const loadingEntry: ChatEntry = {
      id: assistantId,
      type: 'assistant',
      loading: true,
      timestamp: Date.now(),
    };

    setPrompt('');
    setEntries(prev => [...prev, userEntry, loadingEntry]);
    setIsLoading(true);

    const refImages = showRefInput
      ? refUrls
          .split('\n')
          .map(u => u.trim())
          .filter(u => u.length > 0)
      : undefined;

    try {
      const result = await invoke<{ images: string[]; error: string | null }>(
        'generate_image',
        {
          prompt: userPrompt,
          apiKey,
          size,
          n: numImages,
          referenceImages: refImages && refImages.length > 0 ? refImages : undefined,
          responseFormat: 'b64_json',
        }
      );

      setEntries(prev =>
        prev.map(e =>
          e.id === assistantId
            ? {
                ...e,
                loading: false,
                images: result.images,
                error: result.error || undefined,
              }
            : e
        )
      );
    } catch (err) {
      setEntries(prev =>
        prev.map(e =>
          e.id === assistantId
            ? { ...e, loading: false, error: String(err) }
            : e
        )
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleWindowClose = () => invoke('window_close');
  const handleWindowMinimize = () => invoke('window_minimize');
  const handleWindowMaximize = () => invoke('window_maximize');

  const clearHistory = () => {
    setEntries([]);
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <div className="logo">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
          <h1 className="app-title">AI Image Gen</h1>
          <span className="model-badge">gpt-image-2</span>
        </div>
        <div className="header-center" />
        <div className="header-right">
          <button
            className={`header-icon-btn ${showRefInput ? 'active' : ''}`}
            onClick={() => setShowRefInput(v => !v)}
            title="参考图片 (图生图)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <button
            className="header-icon-btn"
            onClick={clearHistory}
            title="清空历史"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </button>
          <button
            className="header-icon-btn"
            onClick={() => setShowSettings(true)}
            title="设置"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <div className="window-controls">
            <button className="win-ctrl" onClick={handleWindowMinimize} title="最小化">
              <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="1" fill="currentColor"/></svg>
            </button>
            <button className="win-ctrl" onClick={handleWindowMaximize} title="最大化">
              <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
            </button>
            <button className="win-ctrl win-ctrl-close" onClick={handleWindowClose} title="关闭">
              <svg width="12" height="12" viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2"/><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.2"/></svg>
            </button>
          </div>
        </div>
      </header>

      <main className="chat-area" ref={chatAreaRef}>
        {entries.length === 0 && (
          <div className="welcome">
            <div className="welcome-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </div>
            <h2>AI 图片生成器</h2>
            <p>输入提示词，生成你想要的图片</p>
            <div className="welcome-tips">
              <div className="tip">支持 10 种尺寸比例</div>
              <div className="tip">可附带最多 6 张参考图</div>
              <div className="tip">批量生成多张图片</div>
            </div>
          </div>
        )}

        {entries.map(entry => (
          <div key={entry.id} className={`chat-entry ${entry.type}`}>
            {entry.type === 'user' ? (
              <div className="user-msg">
                <div className="msg-avatar">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <div className="msg-body">
                  <div className="msg-text">{entry.prompt}</div>
                  <div className="msg-meta">
                    <span className="meta-time">{formatTime(entry.timestamp)}</span>
                    {entry.size && <span className="meta-size">{entry.size}</span>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="assistant-msg">
                <div className="msg-avatar ai-avatar">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                </div>
                <div className="msg-body">
                  {entry.loading && (
                    <div className="loading-container">
                      <div className="loading-spinner" />
                      <span className="loading-text">正在生成图片...</span>
                    </div>
                  )}
                  {entry.error && (
                    <div className="error-msg">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="15" y1="9" x2="9" y2="15" />
                        <line x1="9" y1="9" x2="15" y2="15" />
                      </svg>
                      {entry.error}
                    </div>
                  )}
                  {entry.images && entry.images.length > 0 && (
                    <div className="image-grid">
                      {entry.images.map((img, i) => (
                        <div key={i} className="image-card">
                          <img src={img} alt={`生成图片 ${i + 1}`} loading="lazy" />
                          <div className="image-overlay">
                            <a href={img} target="_blank" rel="noreferrer" className="img-action-btn" title="新窗口打开">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                              </svg>
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="msg-meta">
                    <span className="meta-time">{formatTime(entry.timestamp)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={chatEndRef} />
      </main>

      {showRefInput && (
        <div className="ref-input-bar">
          <div className="ref-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            参考图片 URL（每行一个，最多 6 张）
          </div>
          <textarea
            className="ref-textarea"
            value={refUrls}
            onChange={e => setRefUrls(e.target.value)}
            placeholder="https://example.com/image1.png&#10;https://example.com/image2.png"
            rows={3}
          />
        </div>
      )}

      <footer className="input-area">
        <div className="input-controls">
          <select
            className="size-select"
            value={size}
            onChange={e => setSize(e.target.value)}
            disabled={isLoading}
          >
            {SIZE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label} ({opt.value})
              </option>
            ))}
          </select>

          <div className="num-wrapper" title="生成数量">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
            <input
              className="num-input"
              type="number"
              min={1}
              max={4}
              value={numImages}
              onChange={e => setNumImages(Math.max(1, Math.min(4, Number(e.target.value))))}
              disabled={isLoading}
            />
          </div>
        </div>

        <div className="input-row">
          <textarea
            ref={inputRef}
            className="input-field"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你想生成的图片... (Shift+Enter 换行)"
            rows={1}
            disabled={isLoading}
          />
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={!prompt.trim() || isLoading}
          >
            {isLoading ? (
              <div className="btn-loading-dot" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
      </footer>

      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-panel" onClick={e => e.stopPropagation()}>
            <div className="settings-header">
              <h3>设置</h3>
              <button className="close-settings" onClick={() => setShowSettings(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="settings-body">
              <div className="setting-item">
                <label>API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-..."
                />
              </div>
              <div className="setting-item">
                <label>API 地址</label>
                <input
                  type="text"
                  value="https://www.hfsyapi.cn/v1/images/generations"
                  disabled
                />
              </div>
              <div className="setting-item">
                <label>模型</label>
                <input type="text" value="gpt-image-2" disabled />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
