import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ConvEntry, Conversation } from './types';
import {
  getAppConfig, saveAppConfig,
  getOpenWindowConvIds, saveOpenWindowConvIds,
  getCurrConvId, setCurrConvId,
} from './store';
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

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m ${rem}s`;
}

function buildContext(
  entries: ConvEntry[],
  hasUserRefs: boolean,
  currentUserRefImageCount = 0
) {
  const userPrompts = entries
    .filter(e => e.type === 'user' && e.prompt)
    .map(e => e.prompt!);
  const recentPrompts = userPrompts.slice(-5);

  const assistantBatches = entries.filter(
    e => e.type === 'assistant' && e.images && e.images.length > 0
  );
  const batches = hasUserRefs
    ? assistantBatches.slice(-1)
    : assistantBatches.slice(-5);
  const contextImages = batches.flatMap(e => e.images ?? []);
  const totalImageCount = currentUserRefImageCount + contextImages.length;

  return {
    recentPrompts,
    contextImages,
    promptCount: recentPrompts.length,
    userRefImageCount: currentUserRefImageCount,
    historyImageCount: contextImages.length,
    totalImageCount,
  };
}

function genId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getConvIdFromUrl(): string | null {
  const hash = window.location.hash;
  const match = hash.match(/conv=([^&]+)/);
  return match ? match[1] : null;
}

export default function App() {
  const config = getAppConfig();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>('');
  const [entries, setEntries] = useState<ConvEntry[]>([]);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [refUrls, setRefUrls] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [apiUrl, setApiUrl] = useState(config.apiUrl);
  const [model, setModel] = useState(config.model);
  const [models, setModels] = useState<string[]>([config.model || 'gpt-image-2']);
  const [loadingConvs, setLoadingConvs] = useState<Set<string>>(() => new Set());
  const isLoading = activeConvId ? loadingConvs.has(activeConvId) : false;
  const [numImages, setNumImages] = useState(1);
  const [showRefInput, setShowRefInput] = useState(false);
  const [pastedImages, setPastedImages] = useState<string[]>([]);
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [validationError, setValidationError] = useState('');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cancelledRef = useRef(false);
  const activeConvIdRef = useRef(activeConvId);
  activeConvIdRef.current = activeConvId;

  // ── Init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    loadConversations();
    fetchModelsList();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  useEffect(() => {
    if (activeConvId) {
      setCurrConvId(activeConvId);
    }
  }, [activeConvId]);

  useEffect(() => {
    saveAppConfig({ apiUrl, apiKey, model });
  }, [apiUrl, apiKey, model]);

  const loadConversations = async () => {
    try {
      const all = await invoke<Conversation[]>('list_conversations');
      setConversations(all);

      // Only set activeConvId + entries on initial load or if current active doesn't exist anymore
      if (!activeConvId || !all.find(c => c.id === activeConvId)) {
        const urlConvId = getConvIdFromUrl();
        if (urlConvId) {
          const conv = all.find(c => c.id === urlConvId);
          if (conv) {
            setActiveConvId(conv.id);
            setEntries(conv.entries.filter(e => !e.loading));
            return;
          }
        }

        const savedId = getCurrConvId();
        if (savedId) {
          const conv = all.find(c => c.id === savedId);
          if (conv) {
            setActiveConvId(conv.id);
            setEntries(conv.entries.filter(e => !e.loading));
            return;
          }
        }

        if (all.length > 0) {
          const latest = [...all].sort((a, b) => b.updatedAt - a.updatedAt)[0];
          setActiveConvId(latest.id);
          setEntries(latest.entries.filter(e => !e.loading));
        } else {
          const newId = genId();
          await invoke('create_conversation', { title: 'New Chat' });
          setActiveConvId(newId);
          setEntries([]);
          await invoke('save_conversation', {
            conversationId: newId,
            title: 'New Chat',
            entries: [],
          });
          loadConversations();
        }
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  };

  const createConv = async (inNewWindow = false) => {
    const id = genId();
    const title = `Chat ${conversations.length + 1}`;
    await invoke('save_conversation', { conversationId: id, title, entries: [] });

    if (inNewWindow) {
      try {
        await invoke('open_conversation_in_window', { convId: id });
        const openIds = getOpenWindowConvIds();
        saveOpenWindowConvIds([...openIds, id]);
      } catch (err) {
        console.error('Failed to open window:', err);
        setActiveConvId(id);
        setEntries([]);
      }
    } else {
      setActiveConvId(id);
      setEntries([]);
    }
    loadConversations();
  };

  const switchConv = (id: string) => {
    const conv = conversations.find(c => c.id === id);
    if (conv) {
      setActiveConvId(id);
      setEntries(conv.entries);
    }
  };

  const renameConv = async (id: string, title: string) => {
    await invoke('rename_conversation', { conversationId: id, title });
    loadConversations();
  };

  const deleteConv = async (id: string) => {
    await invoke('delete_conversation', { conversationId: id });
    if (id === activeConvId) {
      const remaining = conversations.filter(c => c.id !== id);
      if (remaining.length > 0) {
        const latest = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        setActiveConvId(latest.id);
        setEntries(latest.entries.filter(e => !e.loading));
      } else {
        createConv(false);
      }
    }
    loadConversations();
  };

  const saveEntries = async (newEntries: ConvEntry[]) => {
    if (!activeConvId) return;
    setEntries(newEntries);
    const title = newEntries.find(e => e.type === 'user' && e.prompt)?.prompt?.slice(0, 30) || 'New Chat';
    await invoke('save_conversation', {
      conversationId: activeConvId,
      title,
      entries: newEntries,
    });
    setTimeout(() => loadConversations(), 100);
  };

  // ── Model Fetch ──────────────────────────────────────────────────────
  const fetchModelsList = async () => {
    if (!apiKey) return;
    try {
      const result = await invoke<string[]>('fetch_models', { apiKey, apiUrl });
      if (result.length > 0) setModels(result);
    } catch {
      // ignore – keep defaults
    }
  };

  // ── Send ─────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!prompt.trim() || isLoading || !activeConvId) return;

    const convId = activeConvId;
    const userPrompt = prompt.trim();

    const urlRefs = showRefInput
      ? refUrls.split('\n').map(u => u.trim()).filter(u => u.length > 0)
      : [];
    const allRefs = [...urlRefs, ...pastedImages];
    const hasUserRefs = allRefs.length > 0;

    const { recentPrompts, contextImages, promptCount, historyImageCount } =
      buildContext(entries, hasUserRefs, allRefs.length);

    // Validate total reference images (user + context) <= 6
    const totalRefs = allRefs.length + historyImageCount;
    if (totalRefs > 6) {
      setValidationError(
        `参考图数量不能超过 6 张（当前 ${totalRefs} 张：用户 ${allRefs.length} + 上下文 ${contextImages.length}），请减少参考图或清空历史对话`
      );
      setTimeout(() => setValidationError(''), 5000);
      return;
    }
    setValidationError('');

    // Build enriched prompt with context
    let enrichedPrompt = userPrompt;
    if (recentPrompts.length > 0) {
      const ctxSection = recentPrompts
        .map((p, i) => `${i + 1}. ${p}`)
        .join('\n');
      enrichedPrompt = `【对话上下文 - 历史提示词】\n${ctxSection}\n\n【本次生成请求】\n${userPrompt}`;
    }

    // Merge reference images: user-provided + historical context images
    const refImages = totalRefs > 0 ? [...allRefs, ...contextImages] : undefined;

    const userEntry: ConvEntry = {
      id: genId(),
      type: 'user',
      prompt: userPrompt,
      timestamp: Date.now(),
      size,
      model,
      refImages: allRefs.length > 0 ? allRefs : undefined,
    };

    const loadingEntry: ConvEntry = {
      id: genId(),
      type: 'assistant',
      loading: true,
      timestamp: Date.now(),
      size,
    };

    setPrompt('');
    setPastedImages([]);
    cancelledRef.current = false;

    const snapshotEntries = [...entries];
    const beforeEntries = [...snapshotEntries, userEntry, loadingEntry];
    setEntries(beforeEntries);
    setLoadingConvs(prev => { const n = new Set(prev); n.add(convId); return n; });

    // Save in-progress state immediately so switching back shows the user prompt + spinner
    const inProgressTitle = beforeEntries.find((e: ConvEntry) => e.type === 'user' && e.prompt)?.prompt?.slice(0, 30) || 'New Chat';
    await invoke('save_conversation', {
      conversationId: convId,
      title: inProgressTitle,
      entries: beforeEntries,
    });
    setTimeout(() => loadConversations(), 50);

    const startTime = Date.now();
    const finalize = async (images: string[], error: string | null) => {
      if (cancelledRef.current && activeConvIdRef.current === convId) return;
      const endTime = Date.now();
      const done: ConvEntry = {
        ...loadingEntry,
        loading: false,
        images: images.length > 0 ? images : undefined,
        error: error ?? undefined,
        duration: endTime - startTime,
        completedAt: endTime,
        imageCount: images.length,
        model,
        contextCount: promptCount,
        contextImageCount: historyImageCount,
      };
      const base = snapshotEntries.filter(e => e.id !== loadingEntry.id && e.id !== userEntry.id);
      const finalEntries = [...base, userEntry, done];
      setLoadingConvs(prev => { const n = new Set(prev); n.delete(convId); return n; });
      const title = finalEntries.find((e: ConvEntry) => e.type === 'user' && e.prompt)?.prompt?.slice(0, 30) || 'New Chat';
      await invoke('save_conversation', {
        conversationId: convId,
        title,
        entries: finalEntries,
      });
      // only update local entries if still on the same conversation
      if (activeConvIdRef.current === convId) {
        setEntries(finalEntries);
      }
      setTimeout(() => loadConversations(), 100);
      inputRef.current?.focus();
    };

    try {
      let images: string[] = [];
      let error: string | null = null;

      const result = await invoke<{ images: string[]; error: string | null }>(
        'generate_image',
        {
          prompt: enrichedPrompt,
          apiKey,
          apiUrl,
          model,
          size,
          n: numImages,
          referenceImages: refImages,
          responseFormat: 'b64_json',
        },
      );
      images = result.images ?? [];
      error = result.error ?? null;

      if (!error && images.length === 0 && numImages > 1) {
        const promptsArr = Array(numImages).fill(enrichedPrompt);
        const results = await invoke<{ images: string[]; error: string | null }[]>(
          'generate_images_parallel',
          {
            prompts: promptsArr,
            apiKey,
            apiUrl,
            model,
            size,
            referenceImages: refImages,
            responseFormat: 'b64_json',
          },
        );
        images = results.flatMap(r => r.images ?? []);
        const errors = results.filter(r => r.error).map(r => r.error!);
        if (errors.length > 0) error = errors.join('; ');
      }

      finalize(images, error);
    } catch (err) {
      finalize([], String(err));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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
          setPastedImages(prev => prev.length < 6 ? [...prev, dataUrl] : prev);
        };
        reader.readAsDataURL(blob);
      }
    }
  };

  const clearHistory = () => {
    cancelledRef.current = true;
    setValidationError('');
    if (activeConvId) {
      setLoadingConvs(prev => { const n = new Set(prev); n.delete(activeConvId); return n; });
    }
    saveEntries([]);
  };

  const hasUserRefs = pastedImages.length > 0 || refUrls.split('\n').some(u => u.trim().length > 0);
  const currentUserRefCount =
    pastedImages.length + refUrls.split('\n').filter(u => u.trim().length > 0).length;
  const contextInfo = buildContext(entries, hasUserRefs, currentUserRefCount);

  const sortedConversations = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="app">
      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      {showSidebar && (
        <aside className="app-sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title-text">对话列表</span>
            <button
              className="sidebar-close-btn"
              onClick={() => setShowSidebar(false)}
              title="收起侧边栏"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>
          <div className="sidebar-actions">
            <button className="sidebar-new-btn" onClick={() => createConv(false)} title="在此窗口新建对话">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              新对话
            </button>
            <button className="sidebar-new-btn sidebar-new-window-btn" onClick={() => createConv(true)} title="新建独立窗口">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              新窗口
            </button>
          </div>
          <div className="sidebar-list">
            {sortedConversations.map(conv => (
              <div
                key={conv.id}
                className={`conv-item ${conv.id === activeConvId ? 'active' : ''}`}
                onClick={() => switchConv(conv.id)}
              >
                {editingConvId === conv.id ? (
                  <input
                    className="conv-rename-input"
                    value={editingTitle}
                    autoFocus
                    onChange={e => setEditingTitle(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        renameConv(conv.id, editingTitle);
                        setEditingConvId(null);
                      }
                      if (e.key === 'Escape') setEditingConvId(null);
                    }}
                    onBlur={() => { renameConv(conv.id, editingTitle); setEditingConvId(null); }}
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <div className="conv-item-info">
                    <div className="conv-item-title">
                      {conv.title}
                      {loadingConvs.has(conv.id) && <span className="conv-loading-dot" />}
                    </div>
                    <div className="conv-item-preview">
                      {conv.entries.filter(e => e.type === 'user').length} 条提示词
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
                    onClick={e => { e.stopPropagation(); deleteConv(conv.id); }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* ── Main Panel ───────────────────────────────────────────────── */}
      <div className="main-panel">
        {/* Header */}
        <header className="app-header">
          <div className="header-left">
            {!showSidebar && (
              <button
                className="header-icon-btn"
                onClick={() => setShowSidebar(true)}
                title="展开侧边栏"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            )}
            <div className="logo">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
              </svg>
            </div>
            <h1 className="app-title">AI Image Gen</h1>
            <span className="model-badge">{model || 'gpt-image-2'}</span>
          </div>
          <div className="header-center" />
          <div className="header-right">
            {(contextInfo.promptCount > 0 || contextInfo.totalImageCount > 0) && (
              <span className="context-badge" title={`上下文：${contextInfo.promptCount} 条提示词 + 用户${contextInfo.userRefImageCount}张 + 历史${contextInfo.historyImageCount}张参考图`}>
                上下文: {contextInfo.promptCount}提示/总{contextInfo.totalImageCount}图
                {contextInfo.userRefImageCount > 0 && ` (含上传${contextInfo.userRefImageCount})`}
              </span>
            )}
            <button
              className={`header-icon-btn ${showRefInput ? 'active' : ''}`}
              onClick={() => setShowRefInput(v => !v)}
              title="参考图片 (图生图)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button className="header-icon-btn" onClick={clearHistory} title="清空当前对话">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </button>
            <button className="header-icon-btn" onClick={() => setShowSettings(true)} title="设置">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <div className="window-controls">
              <button className="win-ctrl" onClick={() => invoke('window_minimize')} title="最小化">
                <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="1" fill="currentColor" /></svg>
              </button>
              <button className="win-ctrl" onClick={() => invoke('window_maximize')} title="最大化">
                <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
              </button>
              <button className="win-ctrl win-ctrl-close" onClick={() => invoke('window_close')} title="关闭">
                <svg width="12" height="12" viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" /><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.2" /></svg>
              </button>
            </div>
          </div>
        </header>

        {/* Chat Area */}
        <main className="chat-area">
          {entries.length === 0 && (
            <div className="welcome">
              <div className="welcome-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                </svg>
              </div>
              <h2>AI 图片生成器</h2>
              <p>输入提示词，生成你想要的图片</p>
              <div className="welcome-tips">
                <div className="tip">支持 10 种尺寸比例</div>
                <div className="tip">可附带最多 6 张参考图</div>
                <div className="tip">多张图片并行生成</div>
                <div className="tip">多窗口独立对话</div>
              </div>
            </div>
          )}

          {entries.map(entry => (
            <div key={entry.id} className={`chat-entry ${entry.type}`}>
              {entry.type === 'user' ? (
                <div className="user-msg">
                  <div className="msg-avatar">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <div className="msg-body">
                    {entry.refImages && entry.refImages.length > 0 && (
                      <div className="ref-images-bar">
                        <span className="ref-images-label">参考图 ({entry.refImages.length})</span>
                        <div className="ref-images-grid">
                          {entry.refImages.map((src, i) => (
                            <div key={i} className="ref-thumb" onClick={() => setLightboxSrc(src)} title="点击查看原图">
                              <img src={src} alt={`参考图 ${i + 1}`} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="msg-text">{entry.prompt}</div>
                    <div className="msg-meta">
                      <span className="meta-time">{formatTime(entry.timestamp)}</span>
                      {entry.size && <span className="meta-size">{entry.size}</span>}
                      {entry.model && <span className="meta-model">{entry.model}</span>}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="assistant-msg">
                  <div className="msg-avatar ai-avatar">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                    </svg>
                  </div>
                  <div className="msg-body">
                    {entry.loading && (
                      <div className="loading-container">
                        <div className="loading-spinner" />
                        <span className="loading-text">
                          {numImages > 1 ? `正在生成 ${numImages} 张图片...` : '正在生成图片...'}
                        </span>
                      </div>
                    )}
                    {entry.error && (
                      <div className="error-msg">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
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
                                  <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                                </svg>
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {entry.completedAt && (
                      <div className="gen-summary">
                        <span className="summary-item">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                          </svg>
                          {entry.duration != null && formatDuration(entry.duration)}
                        </span>
                        {entry.size && (
                          <span className="summary-item">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
                            {entry.size}
                          </span>
                        )}
                        {entry.imageCount != null && entry.imageCount > 0 && (
                          <span className="summary-item">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                            {entry.imageCount} 张
                          </span>
                        )}
                        {(entry.contextCount != null && entry.contextCount > 0) ||
                         (entry.contextImageCount != null && entry.contextImageCount > 0) ? (
                          <span className="summary-item context-summary" title="使用了上下文">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                            </svg>
                            上下文: {entry.contextCount ?? 0}提示/{entry.contextImageCount ?? 0}图
                          </span>
                        ) : null}
                        <span className="summary-item">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                          </svg>
                          {formatTime(entry.completedAt)}
                        </span>
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

        {/* Reference Image Bar */}
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

        {/* Input Area */}
        <footer className="input-area">
          {validationError && (
            <div className="validation-error">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{validationError}</span>
              <button className="validation-close" onClick={() => setValidationError('')} title="关闭">
                <svg width="12" height="12" viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" /><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.5" /></svg>
              </button>
            </div>
          )}
          <div className="input-controls">
            <select
              className="model-select"
              value={model}
              onChange={e => setModel(e.target.value)}
              disabled={isLoading}
              title="选择模型"
            >
              {models.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
              {model && !models.includes(model) && (
                <option value={model}>{model} (自定义)</option>
              )}
            </select>

            <select
              className="size-select"
              value={size}
              onChange={e => setSize(e.target.value)}
              disabled={isLoading}
              title="尺寸比例"
            >
              {SIZE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            <div className="num-wrapper" title="生成数量 (并行生成)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
              </svg>
              <input
                className="num-input"
                type="number"
                min={1}
                max={8}
                value={numImages}
                onChange={e => setNumImages(Math.max(1, Math.min(8, Number(e.target.value))))}
                disabled={isLoading}
              />
            </div>
          </div>

          {pastedImages.length > 0 && (
            <div className="pasted-images-bar">
              {pastedImages.map((img, i) => (
                <div key={i} className="pasted-thumb">
                  <img src={img} alt={`参考图 ${i + 1}`} />
                  <button
                    className="pasted-remove"
                    onClick={() => setPastedImages(prev => prev.filter((_, idx) => idx !== i))}
                    title="移除"
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" /><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.5" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="input-row">
            <textarea
              ref={inputRef}
              className="input-field"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="描述你想生成的图片... (粘贴图片作为参考图，Shift+Enter 换行)"
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
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </button>
          </div>
        </footer>
      </div>

      {/* ── Settings Modal ───────────────────────────────────────────── */}
      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-panel" onClick={e => e.stopPropagation()}>
            <div className="settings-header">
              <h3>设置</h3>
              <button className="close-settings" onClick={() => setShowSettings(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
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
                  value={apiUrl}
                  onChange={e => setApiUrl(e.target.value)}
                  placeholder="https://api.example.com/v1/images/generations"
                />
              </div>
              <div className="setting-item">
                <label>模型</label>
                <div className="model-setting-row">
                  <input
                    type="text"
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    placeholder="gpt-image-2"
                  />
                  <button
                    className="refresh-models-btn"
                    onClick={fetchModelsList}
                    title="从 API 获取可用模型"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox ─────────────────────────────────────────────────── */}
      {lightboxSrc && (
        <div className="lightbox-overlay" onClick={() => setLightboxSrc(null)}>
          <button className="lightbox-close" onClick={() => setLightboxSrc(null)} title="关闭">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <img
            src={lightboxSrc}
            alt="参考图预览"
            className="lightbox-img"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
