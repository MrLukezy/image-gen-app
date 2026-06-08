import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ConvEntry, Conversation, TrashItem } from './types';
import { PRESET_CATEGORIES, QUICK_TEMPLATES } from './promptPresets';
import {
  getAppConfig, saveAppConfig,
  getOpenWindowConvIds, saveOpenWindowConvIds,
  getCurrConvId, setCurrConvId,
  getCustomPresets, saveCustomPresets,
  getProviders, saveProviders, getActiveProviderId, saveActiveProviderId,
  PROVIDER_PRESETS,
  type Provider,
} from './store';
import './styles/App.css';
import LocalImage from './LocalImage';

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

function buildContext(entries: ConvEntry[], currentUserRefImageCount = 0) {
  const lastAssistantImages = (() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.type === 'assistant' && e.images && e.images.length > 0) return e.images;
    }
    return [];
  })();

  const lastUserRefs = (() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.type === 'user' && e.refImages && e.refImages.length > 0) return e.refImages;
    }
    return [];
  })();

  const contextImages = [...lastUserRefs, ...lastAssistantImages];
  const totalImageCount = currentUserRefImageCount + contextImages.length;

  return {
    contextImages,
    userRefImageCount: currentUserRefImageCount,
    historyImageCount: contextImages.length,
    totalImageCount,
  };
}

interface ModelInfo {
  id: string;
  pricing?: string | null;
  resolution?: string | null;
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
  const [providers, setProvidersState] = useState<Provider[]>(() => {
    const stored = getProviders();
    if (stored.length > 0) return stored;
    if (config.apiKey && config.apiUrl) {
      const defaultProvider: Provider = {
        id: genId(),
        name: '默认代理',
        baseUrl: config.apiUrl,
        apiKey: config.apiKey,
        createdAt: new Date().toISOString(),
      };
      saveProviders([defaultProvider]);
      return [defaultProvider];
    }
    return [];
  });

  const resolveInitialProvider = () => {
    const savedId = config.activeProviderId || getActiveProviderId();
    if (savedId && providers.find(p => p.id === savedId)) return savedId;
    return providers[0]?.id || '';
  };

  const [activeProviderId, setActiveProviderId] = useState<string>(() => resolveInitialProvider());
  const activeProvider = providers.find(p => p.id === activeProviderId);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>('');
  const [entries, setEntries] = useState<ConvEntry[]>([]);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [refUrls, setRefUrls] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [apiKey, setApiKey] = useState(activeProvider?.apiKey || config.apiKey);
  const [apiUrl, setApiUrl] = useState(activeProvider?.baseUrl || config.apiUrl);
  const [model, setModel] = useState(config.model);
  const [models, setModels] = useState<ModelInfo[]>([{ id: config.model || 'gpt-image-2', pricing: null, resolution: null }]);
  const [loadingConvs, setLoadingConvs] = useState<Set<string>>(() => new Set());
  const isLoading = activeConvId ? loadingConvs.has(activeConvId) : false;
  const [showRefInput, setShowRefInput] = useState(false);
  const [pastedImages, setPastedImages] = useState<string[]>([]);
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [validationError, setValidationError] = useState('');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [showPresets, setShowPresets] = useState(false);
  const [selectedPresets, setSelectedPresets] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState('style');
  const [showTemplates, setShowTemplates] = useState(false);
  const [hoveredPreset, setHoveredPreset] = useState<{ img: string; x: number; y: number } | null>(null);
  const [customPresets, setCustomPresets] = useState<{ label: string; value: string }[]>(() => getCustomPresets());
  const [showAddCustomPreset, setShowAddCustomPreset] = useState(false);
  const [newPresetLabel, setNewPresetLabel] = useState('');
  const [newPresetValue, setNewPresetValue] = useState('');
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [providerFormPreset, setProviderFormPreset] = useState('custom');
  const [providerFormName, setProviderFormName] = useState('');
  const [providerFormUrl, setProviderFormUrl] = useState('');
  const [providerFormKey, setProviderFormKey] = useState('');
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePresetHover = (p: { img: string }, e: React.MouseEvent) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHoveredPreset({ img: p.img, x: rect.left + rect.width / 2, y: rect.top });
  };

  const handlePresetLeave = () => {
    hoverTimer.current = setTimeout(() => setHoveredPreset(null), 200);
  };

  const togglePreset = (value: string) => {
    setSelectedPresets(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const injectTemplate = (tmplPrompt: string) => {
    setPrompt(prev => prev.trim() ? `${prev}\n${tmplPrompt}` : tmplPrompt);
    setShowTemplates(false);
    inputRef.current?.focus();
  };

  const clearAllPresets = () => setSelectedPresets(new Set());

  const switchProvider = (provId: string) => {
    const prov = providers.find(p => p.id === provId);
    if (prov) {
      setActiveProviderId(provId);
      setApiKey(prov.apiKey);
      setApiUrl(prov.baseUrl);
      saveActiveProviderId(provId);
      setModels(prev => (prev.length > 0 ? prev : [{ id: model || 'gpt-image-2', pricing: null, resolution: null }]));
    }
  };

  const addOrUpdateProvider = () => {
    if (!providerFormName.trim() || !providerFormUrl.trim() || !providerFormKey.trim()) return;
    if (editingProvider) {
      const updated = providers.map(p =>
        p.id === editingProvider.id
          ? { ...p, name: providerFormName.trim(), baseUrl: providerFormUrl.trim(), apiKey: providerFormKey.trim() }
          : p
      );
      setProvidersState(updated);
      saveProviders(updated);
      if (activeProviderId === editingProvider.id) {
        setApiKey(providerFormKey.trim());
        setApiUrl(providerFormUrl.trim());
      }
    } else {
      const newProv: Provider = {
        id: genId(),
        name: providerFormName.trim(),
        baseUrl: providerFormUrl.trim(),
        apiKey: providerFormKey.trim(),
        createdAt: new Date().toISOString(),
      };
      const updated = [...providers, newProv];
      setProvidersState(updated);
      saveProviders(updated);
      if (providers.length === 0) {
        switchProvider(newProv.id);
      }
    }
    setShowProviderForm(false);
    setEditingProvider(null);
    setProviderFormPreset('custom');
    setProviderFormName('');
    setProviderFormUrl('');
    setProviderFormKey('');
  };

  const deleteProvider = (provId: string) => {
    const updated = providers.filter(p => p.id !== provId);
    setProvidersState(updated);
    saveProviders(updated);
    if (activeProviderId === provId) {
      if (updated.length > 0) {
        switchProvider(updated[0].id);
      } else {
        setActiveProviderId('');
        setApiKey('');
        setApiUrl('');
      }
    }
  };

  const openAddProviderForm = () => {
    setEditingProvider(null);
    setProviderFormPreset('custom');
    setProviderFormName('');
    setProviderFormUrl('');
    setProviderFormKey('');
    setShowProviderForm(true);
  };

  const openEditProviderForm = (prov: Provider) => {
    setEditingProvider(prov);
    const matchedPreset = PROVIDER_PRESETS.find(p => p.value !== 'custom' && prov.baseUrl.includes(p.baseUrl.replace('/v1/images/generations', '').replace('/v1', '')));
    setProviderFormPreset(matchedPreset?.value || 'custom');
    setProviderFormName(prov.name);
    setProviderFormUrl(prov.baseUrl);
    setProviderFormKey(prov.apiKey);
    setShowProviderForm(true);
  };

  const handleProviderPresetChange = (presetValue: string) => {
    setProviderFormPreset(presetValue);
    const preset = PROVIDER_PRESETS.find(p => p.value === presetValue);
    if (preset && presetValue !== 'custom') {
      setProviderFormUrl(preset.baseUrl);
      if (!providerFormName) setProviderFormName(preset.label);
    }
  };

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
    saveAppConfig({ apiUrl, apiKey, model, activeProviderId });
  }, [apiUrl, apiKey, model, activeProviderId]);

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

  const loadTrash = async () => {
    try {
      const items = await invoke<TrashItem[]>('list_trash');
      setTrashItems(items);
    } catch { /* ignore */ }
  };

  const restoreFromTrash = async (id: string) => {
    await invoke('restore_trash', { conversationId: id });
    loadTrash();
    loadConversations();
  };

  const permanentDelete = async (id: string) => {
    await invoke('permanent_delete_trash', { conversationId: id });
    loadTrash();
  };

  const openTrashView = () => {
    setShowTrash(true);
    loadTrash();
  };

  const closeTrashView = () => {
    setShowTrash(false);
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
      const result = await invoke<ModelInfo[]>('fetch_models', { apiKey, apiUrl });
      if (result.length > 0) setModels(result);
    } catch {
      // ignore – keep defaults
    }
  };

  const addCustomPreset = () => {
    if (!newPresetLabel.trim() || !newPresetValue.trim()) return;
    const updated = [...customPresets, { label: newPresetLabel.trim(), value: newPresetValue.trim() }];
    setCustomPresets(updated);
    saveCustomPresets(updated);
    setNewPresetLabel('');
    setNewPresetValue('');
    setShowAddCustomPreset(false);
  };

  const deleteCustomPreset = (value: string) => {
    const updated = customPresets.filter(p => p.value !== value);
    setCustomPresets(updated);
    saveCustomPresets(updated);
    setSelectedPresets(prev => {
      const next = new Set(prev);
      next.delete(value);
      return next;
    });
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

    const { contextImages, historyImageCount } =
      buildContext(entries, allRefs.length);

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

    const presetParts: string[] = [];
    const negativeParts: string[] = [];
    selectedPresets.forEach(v => {
      if (v.startsWith('[negative:')) negativeParts.push(v);
      else presetParts.push(v);
    });

    if (presetParts.length > 0) {
      enrichedPrompt += `\n\n[风格参数] ${presetParts.join(', ')}`;
    }
    if (negativeParts.length > 0) {
      const negFlat = negativeParts.map(n => n.replace('[negative: ', '').replace(']', '')).join(', ');
      enrichedPrompt += `\n\n[Negative prompt] ${negFlat}`;
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
          n: 1,
          referenceImages: refImages,
          responseFormat: 'b64_json',
        },
      );
      images = result.images ?? [];
      error = result.error ?? null;

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

  const currentUserRefCount =
    pastedImages.length + refUrls.split('\n').filter(u => u.trim().length > 0).length;
  const contextInfo = buildContext(entries, currentUserRefCount);

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, [prompt]);

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
          <div className="sidebar-footer">
            <button className={`sidebar-trash-btn ${showTrash ? 'active' : ''}`} onClick={() => showTrash ? closeTrashView() : openTrashView()} title={showTrash ? "关闭回收站" : "回收站"}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              回收站
            </button>
          </div>
        </aside>
      )}

      {/* ── Main Panel ───────────────────────────────────────────────── */}
      <div className="main-panel">
        {showTrash ? (
          <div className="trash-view">
            <header className="app-header">
              <div className="header-left">
                <button className="header-icon-btn" onClick={closeTrashView} title="返回对话">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
                  </svg>
                </button>
                <h1 className="app-title">回收站</h1>
                <span className="model-badge">{trashItems.length} 项</span>
              </div>
              <div className="header-right">
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
            <main className="trash-list">
              {trashItems.length === 0 && (
                <div className="welcome">
                  <div className="welcome-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </div>
                  <h2>回收站为空</h2>
                  <p>删除的会话将在此处保留 7 天</p>
                </div>
              )}
              {trashItems
                .sort((a, b) => b.movedAt - a.movedAt)
                .map(item => {
                  const movedDate = new Date(item.movedAt);
                  const now = Date.now();
                  const daysLeft = Math.max(0, Math.ceil((7 * 24 * 60 * 60 * 1000 - (now - item.movedAt)) / (24 * 60 * 60 * 1000)));
                  return (
                    <div key={item.id} className="trash-item">
                      <div className="trash-item-info">
                        <div className="trash-item-title">{item.title}</div>
                        <div className="trash-item-meta">
                          <span>{item.imageCount} 张图片</span>
                          <span>删除于 {movedDate.toLocaleDateString('zh-CN')} {movedDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                          <span className="trash-item-expire">{daysLeft > 0 ? `${daysLeft} 天后自动清理` : '即将清理'}</span>
                        </div>
                      </div>
                      <div className="trash-item-actions">
                        <button className="trash-action-btn restore-btn" onClick={() => restoreFromTrash(item.id)} title="恢复">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 105.64-11.36L1 10" />
                          </svg>
                          恢复
                        </button>
                        <button className="trash-action-btn delete-btn" onClick={() => permanentDelete(item.id)} title="彻底删除">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />
                          </svg>
                          彻底删除
                        </button>
                      </div>
                    </div>
                  );
                })}
            </main>
          </div>
        ) : (
          <>
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
            {contextInfo.totalImageCount > 0 && (
              <span className="context-badge" title={`上下文：本次上传 ${contextInfo.userRefImageCount} 张\n历史参考图 ${contextInfo.historyImageCount} 张`}>
                上下文: {contextInfo.totalImageCount}图
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
                              <LocalImage src={src} alt={`参考图 ${i + 1}`} />
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
                        <span className="loading-text">正在生成图片...</span>
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
                            <LocalImage
                              src={img}
                              alt={`生成图片 ${i + 1}`}
                              onClick={() => setLightboxSrc(img)}
                              style={{ cursor: 'zoom-in' }}
                            />
                            <div className="image-overlay">
                              <a href={img} target="_blank" rel="noreferrer" className="img-action-btn" title="新窗口打开" onClick={e => e.stopPropagation()}>
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
                        {entry.contextImageCount != null && entry.contextImageCount > 0 ? (
                          <span className="summary-item context-summary" title="使用了上下文参考图">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                            </svg>
                            上下文: {entry.contextImageCount}图
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
            {providers.length > 0 && (
              <select
                className="provider-select"
                value={activeProviderId}
                onChange={e => switchProvider(e.target.value)}
                disabled={isLoading}
                title="选择代理"
              >
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}

            <select
              className="model-select"
              value={model}
              onChange={e => setModel(e.target.value)}
              disabled={isLoading}
              title="选择模型"
            >
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.id}{m.resolution ? ` [${m.resolution}]` : ''}{m.pricing ? ` (${m.pricing})` : ''}
                </option>
              ))}
              {model && !models.find(m => m.id === model) && (
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

            <div className="preset-toggle-group">
              <button
                className={`preset-toggle-btn ${showPresets ? 'active' : ''}`}
                onClick={() => { setShowPresets(!showPresets); setShowTemplates(false); }}
                title="提示词预设"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                预设
                {selectedPresets.size > 0 && (
                  <span className="preset-badge">{selectedPresets.size}</span>
                )}
              </button>
              <button
                className={`preset-toggle-btn ${showTemplates ? 'active' : ''}`}
                onClick={() => { setShowTemplates(!showTemplates); setShowPresets(false); }}
                title="快捷模板"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
                </svg>
                模板
              </button>
            </div>
          </div>

          {selectedPresets.size > 0 && (
            <div className="active-presets-bar">
              <span className="active-presets-label">已选预设:</span>
              <div className="active-presets-chips">
                {Array.from(selectedPresets).map(v => {
                  const preset = PRESET_CATEGORIES.flatMap(c => c.presets).find(p => p.value === v)
                    ?? customPresets.find(p => p.value === v);
                  return preset ? (
                    <span key={v} className="active-preset-chip">
                      {preset.label}
                      <button onClick={() => togglePreset(v)} className="chip-remove">
                        <svg width="8" height="8" viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="2" /><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="2" /></svg>
                      </button>
                    </span>
                  ) : null;
                })}
              </div>
              <button className="clear-presets-btn" onClick={clearAllPresets} title="清除所有预设">
                <svg width="10" height="10" viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" /><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.5" /></svg>
                清空
              </button>
            </div>
          )}

          {showPresets && (
            <div className="preset-panel">
              <div className="preset-category-tabs">
                {PRESET_CATEGORIES.map(cat => (
                  <button
                    key={cat.id}
                    className={`preset-cat-tab ${activeCategory === cat.id ? 'active' : ''}`}
                    onClick={() => setActiveCategory(cat.id)}
                  >
                    <span className="cat-icon">{cat.icon}</span>
                    <span className="cat-name">{cat.name}</span>
                  </button>
                ))}
                <button
                  className={`preset-cat-tab ${activeCategory === '__custom__' ? 'active' : ''}`}
                  onClick={() => setActiveCategory('__custom__')}
                >
                  <span className="cat-icon">✏️</span>
                  <span className="cat-name">自定义</span>
                </button>
              </div>
              {activeCategory !== '__custom__' ? (
                <div className="preset-chips">
                  {PRESET_CATEGORIES.find(c => c.id === activeCategory)?.presets.map(p => {
                    const isSelected = selectedPresets.has(p.value);
                    return (
                      <button
                        key={p.value}
                        className={`preset-chip ${isSelected ? 'selected' : ''}`}
                        onClick={() => togglePreset(p.value)}
                        onMouseEnter={(e) => handlePresetHover(p, e)}
                        onMouseLeave={handlePresetLeave}
                        title={p.value}
                      >
                        {isSelected && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="preset-chips">
                  {customPresets.map(p => {
                    const isSelected = selectedPresets.has(p.value);
                    return (
                      <span key={p.value} className={`preset-chip ${isSelected ? 'selected' : ''}`}>
                        <button
                          className="custom-preset-label"
                          onClick={() => togglePreset(p.value)}
                        >
                          {isSelected && (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                          {p.label}
                        </button>
                        <button
                          className="custom-preset-delete"
                          title="删除预设"
                          onClick={() => deleteCustomPreset(p.value)}
                        >
                          <svg width="8" height="8" viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="2" /><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="2" /></svg>
                        </button>
                      </span>
                    );
                  })}
                  {showAddCustomPreset ? (
                    <div className="custom-preset-form">
                      <input
                        className="custom-preset-input"
                        placeholder="预设名称"
                        value={newPresetLabel}
                        onChange={e => setNewPresetLabel(e.target.value)}
                        autoFocus
                      />
                      <textarea
                        className="custom-preset-textarea"
                        placeholder="预设提示词内容（例如：cinematic lighting, high detail）"
                        value={newPresetValue}
                        onChange={e => setNewPresetValue(e.target.value)}
                        rows={2}
                      />
                      <div className="custom-preset-form-actions">
                        <button className="custom-preset-save" onClick={addCustomPreset}>保存</button>
                        <button className="custom-preset-cancel" onClick={() => setShowAddCustomPreset(false)}>取消</button>
                      </div>
                    </div>
                  ) : (
                    <button className="preset-chip add-custom-preset-btn" onClick={() => setShowAddCustomPreset(true)}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      添加预设
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {showTemplates && (
            <div className="templates-panel">
              <div className="templates-grid">
                {QUICK_TEMPLATES.map((tmpl, i) => (
                  <button
                    key={i}
                    className="template-card"
                    onClick={() => injectTemplate(tmpl.prompt)}
                    title={tmpl.prompt}
                  >
                    <span className="template-label">{tmpl.label}</span>
                    <span className="template-desc">{tmpl.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

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
        </>
        )}
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
                <label>代理 (Provider)</label>
                <div className="provider-list">
                  {providers.map(prov => (
                    <div key={prov.id} className={`provider-item ${prov.id === activeProviderId ? 'active' : ''}`}>
                      <div className="provider-item-main" onClick={() => switchProvider(prov.id)}>
                        <span className="provider-item-name">{prov.name}</span>
                        <span className="provider-item-url">{prov.baseUrl.replace(/https?:\/\//, '')}</span>
                      </div>
                      <div className="provider-item-actions">
                        <button
                          className="provider-action-btn"
                          onClick={e => { e.stopPropagation(); openEditProviderForm(prov); }}
                          title="编辑"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                          </svg>
                        </button>
                        <button
                          className="provider-action-btn provider-delete-btn"
                          onClick={e => { e.stopPropagation(); deleteProvider(prov.id); }}
                          title="删除"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                  <button className="provider-add-btn" onClick={openAddProviderForm}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    添加代理
                  </button>
                </div>
              </div>

              {showProviderForm && (
                <div className="provider-form">
                  <div className="provider-form-header">
                    <span>{editingProvider ? '编辑代理' : '添加代理'}</span>
                    <button className="provider-form-close" onClick={() => { setShowProviderForm(false); setEditingProvider(null); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                  <select
                    className="provider-form-select"
                    value={providerFormPreset}
                    onChange={e => handleProviderPresetChange(e.target.value)}
                  >
                    {PROVIDER_PRESETS.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="provider-form-input"
                    placeholder="代理名称"
                    value={providerFormName}
                    onChange={e => setProviderFormName(e.target.value)}
                  />
                  <input
                    type="text"
                    className="provider-form-input"
                    placeholder="API 地址 (https://...)"
                    value={providerFormUrl}
                    onChange={e => setProviderFormUrl(e.target.value)}
                  />
                  <input
                    type="password"
                    className="provider-form-input"
                    placeholder="API Key"
                    value={providerFormKey}
                    onChange={e => setProviderFormKey(e.target.value)}
                  />
                  <div className="provider-form-actions">
                    <button className="provider-form-save" onClick={addOrUpdateProvider}>
                      {editingProvider ? '保存' : '添加'}
                    </button>
                    <button className="provider-form-cancel" onClick={() => { setShowProviderForm(false); setEditingProvider(null); }}>
                      取消
                    </button>
                  </div>
                </div>
              )}

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
          <LocalImage
            src={lightboxSrc}
            alt="参考图预览"
            className="lightbox-img"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* ── Preset Hover Preview ────────────────────────────────────── */}
      {hoveredPreset && (
        <div
          className="preset-preview-popup"
          style={{ left: hoveredPreset.x, top: hoveredPreset.y - 12 }}
          onMouseEnter={() => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }}
          onMouseLeave={() => setHoveredPreset(null)}
        >
          <img src={hoveredPreset.img} alt="效果预览" />
          <div className="preset-preview-arrow" />
        </div>
      )}
    </div>
  );
}
