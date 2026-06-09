import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ConvEntry, Conversation, TrashItem, BatchTask, McpConversation, ExtractConversation, ExtractTask } from './types';
import { PRESET_CATEGORIES, QUICK_TEMPLATES } from './promptPresets';
import { EXTRACT_TOOLS, EXTRACT_CATEGORIES, getToolById } from './extractTools';
import {
  getAppConfig, saveAppConfig,
  getOpenWindowConvIds, saveOpenWindowConvIds,
  getCurrConvId, setCurrConvId,
  getCustomPresets, saveCustomPresets,
  getProviders, saveProviders, getActiveProviderId, saveActiveProviderId,
  getMcpConfig, saveMcpConfig,
  getLlmConfig, saveLlmConfig,
  getFavoriteFolders, saveFavoriteFolders,
  getFavorites, saveFavorites, addFavorite, removeFavorite, updateFavorite,
  getExtractSessions, saveExtractSessions,
  PROVIDER_PRESETS,
  type Provider,
  type McpConfig,
  type LlmConfig,
  type StoredFavorite,
  type StoredFavoriteFolder,
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

function buildContext(entries: ConvEntry[], currentUserRefImageCount = 0, autoCtx = true) {
  if (!autoCtx) {
    return {
      contextImages: [] as string[],
      userRefImageCount: currentUserRefImageCount,
      historyImageCount: 0,
      totalImageCount: currentUserRefImageCount,
    };
  }

  const lastAssistantImages = (() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.type === 'assistant' && e.images && e.images.length > 0) {
        if (e.images.length === 1) return e.images;
        return [];
      }
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

function finalizeEntries(entries: ConvEntry[]): ConvEntry[] {
  return entries.map(e => {
    if (!e.loading) return e;
    if (e.batchId && e.batchImages) {
      const updatedTasks = e.batchImages.map(t =>
        t.status === 'loading' ? { ...t, status: 'failed' as const, error: '应用已关闭，生成中断' } : t
      );
      const successTasks = updatedTasks.filter(t => t.status === 'success');
      const failCount = updatedTasks.filter(t => t.status === 'failed').length;
      const successImages = successTasks.map(t => t.image!);
      return {
        ...e,
        loading: false,
        images: successImages.length > 0 ? successImages : undefined,
        error: successImages.length === 0 ? `${failCount} 个任务中断（应用已关闭）`
             : failCount > 0 ? `${failCount} 个任务中断（应用已关闭）` : undefined,
        completedAt: Date.now(),
        imageCount: successImages.length,
        batchErrors: failCount,
        batchImages: updatedTasks,
      };
    }
    return { ...e, loading: false, error: '生成中断（应用已关闭）' };
  });
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
  const [showMcpGuide, setShowMcpGuide] = useState(false);
  const [mcpBatchDetailEntryId, setMcpBatchDetailEntryId] = useState<string | null>(null);
  const [mcpRemoteUrl, setMcpRemoteUrl] = useState('http://localhost:3845/mcp');
  const [copiedCmdIdx, setCopiedCmdIdx] = useState<number>(-1);
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [providerFormPreset, setProviderFormPreset] = useState('custom');
  const [providerFormName, setProviderFormName] = useState('');
  const [providerFormUrl, setProviderFormUrl] = useState('');
  const [providerFormKey, setProviderFormKey] = useState('');
  const [parallelCount, setParallelCount] = useState(1);
  const [autoContext, setAutoContext] = useState(true);
  const [showBatchDetail, setShowBatchDetail] = useState<string | null>(null);
  const [sidebarCategory, setSidebarCategory] = useState<'normal' | 'mcp' | 'extract' | 'favorites'>('normal');
  const [mcpConversations, setMcpConversations] = useState<McpConversation[]>([]);
  const [activeMcpSessionId, setActiveMcpSessionId] = useState<string | null>(null);
  const [mcpConfig, setMcpConfigState] = useState<McpConfig>(() => getMcpConfig());
  const [llmConfig, setLlmConfigState] = useState<LlmConfig>(() => getLlmConfig());
  const [settingsTab, setSettingsTab] = useState<'image' | 'mcp' | 'llm'>('image');
  const [llmModels, setLlmModels] = useState<{id: string}[]>([{ id: 'gpt-4o' }]);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number;
    imageUrl: string;
    convId?: string;
    entryId?: string;
  } | null>(null);
  const [extractConversations, setExtractConversations] = useState<ExtractConversation[]>([]);
  const [activeExtractConvId, setActiveExtractConvId] = useState<string | null>(null);
  const [extractImage, setExtractImage] = useState<string | null>(null);
  const [extractLoadingConvs, setExtractLoadingConvs] = useState<Set<string>>(new Set());
  const [extractError, setExtractError] = useState<string | null>(null);
  const [activeExtractCat, setActiveExtractCat] = useState('extract');
  const [favoriteFolders, setFavoriteFolders] = useState<StoredFavoriteFolder[]>(() => getFavoriteFolders());
  const [favorites, setFavorites] = useState<StoredFavorite[]>(() => getFavorites());
  const [activeFolderId, setActiveFolderId] = useState<string>('all');
  const [editingFavoriteId, setEditingFavoriteId] = useState<string | null>(null);
  const [editingFavoriteName, setEditingFavoriteName] = useState('');
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showAddToFavMenu, setShowAddToFavMenu] = useState<{ x: number; y: number; imageUrl: string; convId?: string; entryId?: string } | null>(null);
  const [pendingExtractFromImage, setPendingExtractFromImage] = useState<string | null>(null);
  const [extractNotes, setExtractNotes] = useState<Record<string, string>>({});
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const mcpPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const batchProgressRef = useRef<Record<string, BatchTask[]>>({});
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
  const batchConvIdRef = useRef<string | null>(null);
  const batchSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const batchSaveEntriesRef = useRef<ConvEntry[] | null>(null);
  const loadConvsRunningRef = useRef(false);
  const loadConvsQueuedRef = useRef(false);

  // ── Init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    loadConversations();
    fetchModelsList();
    fetchLlmModels();
    const sess = getExtractSessions();
    setExtractConversations(sess as ExtractConversation[]);
  }, []);

  useEffect(() => {
    const handleClick = () => { setContextMenu(null); setShowAddToFavMenu(null); };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
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

  useEffect(() => {
    saveExtractSessions(extractConversations);
  }, [extractConversations]);

  useEffect(() => {
    const activeProv = providers.find(p => p.id === mcpConfig.providerId);
    const cfgToSave: Record<string, unknown> = {
      providerId: mcpConfig.providerId,
      defaultSize: mcpConfig.defaultSize,
      stylePrefix: mcpConfig.stylePrefix,
      outputDir: mcpConfig.outputDir,
    };
    if (activeProv) {
      cfgToSave.apiKey = activeProv.apiKey;
      cfgToSave.apiUrl = activeProv.baseUrl;
    } else {
      cfgToSave.apiKey = apiKey;
      cfgToSave.apiUrl = apiUrl;
    }
    cfgToSave.model = model;
    invoke('save_mcp_config_file', { config: cfgToSave }).catch(() => {});
  }, [providers, model, apiKey, apiUrl, mcpConfig]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (batchSaveTimerRef.current) {
        clearTimeout(batchSaveTimerRef.current);
        batchSaveTimerRef.current = null;
      }
      const convId = batchConvIdRef.current;
      const entries = batchSaveEntriesRef.current;
      if (convId && entries) {
        const title = entries.find((e: ConvEntry) => e.type === 'user' && e.prompt)?.prompt?.slice(0, 30) || 'New Chat';
        invoke('save_conversation', { conversationId: convId, title, entries }).catch(() => {});
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (mcpPollRef.current) clearInterval(mcpPollRef.current);
    };
  }, []);

  const loadConversations = async () => {
    if (loadConvsRunningRef.current) {
      loadConvsQueuedRef.current = true;
      return;
    }
    loadConvsRunningRef.current = true;
    try {
      const all = await invoke<Conversation[]>('list_conversations');
      setConversations(all);

      // Only set activeConvId + entries on initial load or if current active doesn't exist anymore
      if (!activeConvId || !all.find(c => c.id === activeConvId)) {
        const urlConvId = getConvIdFromUrl();
        if (urlConvId) {
          const conv = all.find(c => c.id === urlConvId);
          if (conv) {
            const finalized = finalizeEntries(conv.entries);
            setActiveConvId(conv.id);
            setEntries(finalized);
            if (conv.entries.some(e => e.loading)) {
              invoke('save_conversation', { conversationId: conv.id, title: conv.title, entries: finalized }).catch(() => {});
            }
            return;
          }
        }

        const savedId = getCurrConvId();
        if (savedId) {
          const conv = all.find(c => c.id === savedId);
          if (conv) {
            const finalized = finalizeEntries(conv.entries);
            setActiveConvId(conv.id);
            setEntries(finalized);
            if (conv.entries.some(e => e.loading)) {
              invoke('save_conversation', { conversationId: conv.id, title: conv.title, entries: finalized }).catch(() => {});
            }
            return;
          }
        }

        if (all.length > 0) {
          const latest = [...all].sort((a, b) => b.updatedAt - a.updatedAt)[0];
          const finalized = finalizeEntries(latest.entries);
          setActiveConvId(latest.id);
          setEntries(finalized);
          if (latest.entries.some(e => e.loading)) {
            invoke('save_conversation', { conversationId: latest.id, title: latest.title, entries: finalized }).catch(() => {});
          }
        } else {
          const newId = await invoke<string>('create_conversation', { title: 'New Chat' });
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
    } finally {
      loadConvsRunningRef.current = false;
      if (loadConvsQueuedRef.current) {
        loadConvsQueuedRef.current = false;
        loadConversations();
      }
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
      const isStillLoading = loadingConvs.has(id);
      const hasLoading = conv.entries.some(e => e.loading);
      if (hasLoading && !isStillLoading) {
        const finalEntries = finalizeEntries(conv.entries);
        setActiveConvId(id);
        setEntries(finalEntries);
        const title = finalEntries.find((e: ConvEntry) => e.type === 'user' && e.prompt)?.prompt?.slice(0, 30) || conv.title;
        invoke('save_conversation', { conversationId: id, title, entries: finalEntries }).catch(() => {});
      } else {
        setActiveConvId(id);
        setEntries(conv.entries);
      }
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
        setEntries(finalizeEntries(latest.entries));
      } else {
        setActiveConvId('');
        setEntries([]);
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
  const deleteAllTrash = async () => {
    await invoke('permanent_delete_all_trash');
    setTrashItems([]);
  };

  const openTrashView = () => {
    setShowTrash(true);
    loadTrash();
  };

  const closeTrashView = () => {
    setShowTrash(false);
    loadConversations();
  };

  const loadMcpConversations = async () => {
    try {
      const all = await invoke<McpConversation[]>('list_mcp_conversations');
      setMcpConversations(prev => {
        const sorted = [...all].sort((a, b) => b.updatedAt - a.updatedAt);
        if (prev.length !== sorted.length) return sorted;
        for (let i = 0; i < prev.length; i++) {
          if (prev[i]!.id !== sorted[i]!.id || prev[i]!.updatedAt !== sorted[i]!.updatedAt) return sorted;
        }
        return prev;
      });
    } catch {
      // keep existing state on transient IPC error
    }
  };

  const switchSidebarCategory = (cat: 'normal' | 'mcp' | 'extract' | 'favorites') => {
    if (cat === sidebarCategory) return;
    if (mcpPollRef.current) {
      clearInterval(mcpPollRef.current);
      mcpPollRef.current = null;
    }
    setSidebarCategory(cat);
    if (cat === 'mcp') {
      loadMcpConversations();
      mcpPollRef.current = setInterval(loadMcpConversations, 800);
    } else if (cat === 'extract') {
      // load extract sessions
      const sess = getExtractSessions() as ExtractConversation[];
      setExtractConversations(sess);
    } else if (cat === 'favorites') {
      setFavorites(getFavorites());
      setFavoriteFolders(getFavoriteFolders());
    } else {
      setActiveMcpSessionId(null);
      setMcpBatchDetailEntryId(null);
      loadConversations();
    }
  };

  const deleteMcpSession = async (sessionId: string) => {
    try {
      await invoke('delete_mcp_conversation', { sessionId });
      if (activeMcpSessionId === sessionId) setActiveMcpSessionId(null);
      loadMcpConversations();
    } catch {}
  };

  const updateMcpConfig = (updates: Partial<McpConfig>) => {
    const updated = { ...mcpConfig, ...updates };
    setMcpConfigState(updated);
    saveMcpConfig(updated);
    const activeProv = providers.find(p => p.id === updated.providerId);
    const cfgToSave: Record<string, unknown> = {
      providerId: updated.providerId,
      defaultSize: updated.defaultSize,
      stylePrefix: updated.stylePrefix,
      outputDir: updated.outputDir,
    };
    if (activeProv) {
      cfgToSave.apiKey = activeProv.apiKey;
      cfgToSave.apiUrl = activeProv.baseUrl;
    }
    cfgToSave.model = model;
    invoke('save_mcp_config_file', { config: cfgToSave }).catch(() => {});
  };

  const copyToClipboard = (text: string, idx: number) => {
    const done = () => {
      setCopiedCmdIdx(idx);
      setTimeout(() => setCopiedCmdIdx(-1), 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    }
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

  // ── Extract Handlers ──────────────────────────────────────────────────

  const openExtractFromImage = (imageUrl: string) => {
    setContextMenu(null);
    setSidebarCategory('extract');
    setExtractImage(imageUrl);
    setExtractError(null);
    const id = genId();
    const newConv: ExtractConversation = {
      id,
      title: `提取 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
      sourceImage: imageUrl,
      tasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const updated = [newConv, ...extractConversations];
    setExtractConversations(updated);
    setActiveExtractConvId(id);
  };

  useEffect(() => {
    if (pendingExtractFromImage) {
      openExtractFromImage(pendingExtractFromImage);
      setPendingExtractFromImage(null);
    }
  }, [pendingExtractFromImage]);

  const deleteExtractConv = (id: string) => {
    const updated = extractConversations.filter(c => c.id !== id);
    setExtractConversations(updated);
    if (activeExtractConvId === id) {
      setActiveExtractConvId(updated[0]?.id || null);
      setExtractImage(updated[0]?.sourceImage || null);
    }
  };

  const switchExtractConv = (id: string) => {
    const conv = extractConversations.find(c => c.id === id);
    if (conv) {
      setActiveExtractConvId(id);
      setExtractImage(conv.sourceImage);
      setExtractError(null);
    }
  };

  const runExtractTool = async (toolId: string) => {
    const convId = activeExtractConvId;
    const image = extractImage;
    if (!image || !convId || extractLoadingConvs.has(convId)) return;
    const tool = getToolById(toolId);
    if (!tool) return;

    const prov = providers.find(p => p.id === llmConfig.providerId) || activeProvider;
    if (!prov) {
      setExtractError('请先在设置中配置语言模型代理');
      return;
    }

    setExtractLoadingConvs(prev => new Set(prev).add(convId));
    setExtractError(null);

    const activeConv = extractConversations.find(c => c.id === convId);
    if (!activeConv) { 
      setExtractLoadingConvs(prev => { 
        const next = new Set(prev); 
        next.delete(convId); 
        return next; 
      }); 
      return; 
    }

    // Get user notes for this category
    const notes = extractNotes[tool.category]?.trim() || '';
    const enhancedPrompt = notes
      ? `${tool.prompt}\n\n【用户额外要求】\n${notes}`
      : tool.prompt;

    const userTask: ExtractTask = {
      id: genId(),
      type: 'user',
      sourceImage: image,
      extractType: toolId,
      timestamp: Date.now(),
      resultText: notes || undefined,
    };

    const loadingTask: ExtractTask = {
      id: genId(),
      type: 'assistant',
      sourceImage: image,
      extractType: toolId,
      loading: true,
      step: 'analyzing',
      timestamp: Date.now(),
    };

    let currentTasks = [...activeConv.tasks, userTask, loadingTask];
    let currentConvs = extractConversations.map(c =>
      c.id === convId ? { ...c, tasks: currentTasks, updatedAt: Date.now() } : c
    );
    setExtractConversations(currentConvs);

    const updateTask = (updates: Partial<ExtractTask>) => {
      currentTasks = currentTasks.map(t => t.id === loadingTask.id ? { ...t, ...updates } : t);
      currentConvs = currentConvs.map(c =>
        c.id === convId ? { ...c, tasks: currentTasks, updatedAt: Date.now() } : c
      );
      setExtractConversations(currentConvs);
    };

    try {
      const imageBase64 = image.startsWith('data:')
        ? image
        : await invoke<string>('read_image_base64', { path: image });

      const llmApiUrl = prov.baseUrl.replace('/images/generations', '/chat/completions');
      const llmResult = await invoke<{ content: string; error: string | null }>('llm_chat', {
        apiUrl: llmApiUrl,
        apiKey: prov.apiKey,
        model: llmConfig.model,
        prompt: enhancedPrompt,
        imageBase64,
      });

      if (llmResult.error) {
        updateTask({ loading: false, error: llmResult.error });
        return;
      }

      const analysisText = llmResult.content;

      // Handle multi-image generation (for extract_objects)
      if (tool.responseFormat === 'multi-image') {
        // Parse grouped prompts: "### 生成提示词 - 分组1", "### 生成提示词 - 分组2", etc.
        const groupPrompts: string[] = [];
        const groupTitles: string[] = [];
        const groupRegex = /### 生成提示词 - 分组(\d+)\s*([\s\S]*?)(?=### 生成提示词 - 分组\d+|$)/g;
        let match;
        while ((match = groupRegex.exec(analysisText)) !== null) {
          groupTitles.push(`分组${match[1]}`);
          groupPrompts.push(match[2].trim());
        }

        if (groupPrompts.length === 0) {
          // Fallback: try to extract single prompt
          const promptMatch = analysisText.match(/### 生成提示词[\s\S]*?([\s\S]+?)$/);
          if (promptMatch && promptMatch[1]) {
            groupPrompts.push(promptMatch[1].trim());
            groupTitles.push('全部物体');
          }
        }

        if (groupPrompts.length === 0) {
          updateTask({ loading: false, error: '未能解析生成提示词', resultText: analysisText });
          return;
        }

        // Extract display analysis (remove generation prompts from display)
        const displayAnalysis = analysisText
          .replace(/### 生成提示词 - 分组\d+[\s\S]*?$/gm, '')
          .replace(/### 生成提示词[\s\S]*$/, '')
          .trim();

        updateTask({ 
          resultText: displayAnalysis, 
          step: 'generating',
          groupTitles
        });

        // Generate images in parallel
        const genApiUrl = prov.baseUrl;
        const imageResults = await Promise.all(
          groupPrompts.map(async (genPrompt, idx) => {
            try {
              const genResult = await invoke<{ images: string[]; error: string | null }>('generate_image', {
                prompt: genPrompt,
                apiKey: prov.apiKey,
                apiUrl: genApiUrl,
                model,
                size: '1024x1024',
                n: 1,
                referenceImages: [imageBase64],
                responseFormat: 'b64_json',
              });

              if (genResult.error || !genResult.images?.[0]) {
                return { 
                  image: null, 
                  error: genResult.error || `分组${idx + 1}生图失败`,
                  groupIdx: idx 
                };
              }

              return { image: genResult.images[0], error: null, groupIdx: idx };
            } catch (err) {
              return { image: null, error: String(err), groupIdx: idx };
            }
          })
        );

        const successImages = imageResults
          .filter(r => r.image)
          .map(r => r.image as string);
        const failedCount = imageResults.filter(r => !r.image).length;

        if (successImages.length === 0) {
          updateTask({ 
            loading: false, 
            error: `所有分组生图失败`,
            step: undefined 
          });
          return;
        }

        const errorText = failedCount > 0 
          ? `\n\n⚠️ ${failedCount}个分组生图失败` 
          : undefined;

        updateTask({ 
          loading: false, 
          resultImages: successImages,
          resultText: displayAnalysis + (errorText || ''),
          step: undefined 
        });
        return;
      }

      if (tool.responseFormat === 'image') {
        const promptMatch = analysisText.match(/<<<GENERATION_PROMPT_START>>>([\s\S]*?)<<<GENERATION_PROMPT_END>>>/);
        const generationPrompt = promptMatch ? promptMatch[1].trim() : analysisText;
        const displayAnalysis = promptMatch
          ? analysisText.replace(/<<<GENERATION_PROMPT_START>>>[\s\S]*?<<<GENERATION_PROMPT_END>>>/, '').trim()
          : analysisText;

        updateTask({ resultText: displayAnalysis, step: 'generating' });

        const genApiUrl = prov.baseUrl;
        const genResult = await invoke<{ images: string[]; error: string | null }>('generate_image', {
          prompt: generationPrompt,
          apiKey: prov.apiKey,
          apiUrl: genApiUrl,
          model,
          size: '1024x1024',
          n: 1,
          referenceImages: [imageBase64],
          responseFormat: 'b64_json',
        });

        if (genResult.error) {
          updateTask({ loading: false, error: `生图失败: ${genResult.error}` });
          return;
        }

        const resultImage = genResult.images?.[0];
        if (!resultImage) {
          updateTask({ loading: false, error: '生图未返回图片' });
          return;
        }

        updateTask({ loading: false, resultImage, step: undefined });
      } else {
        updateTask({ loading: false, resultText: analysisText, step: undefined });
      }
    } catch (err) {
      updateTask({ loading: false, error: String(err), step: undefined });
    } finally {
      setExtractLoadingConvs(prev => {
        const next = new Set(prev);
        next.delete(convId);
        return next;
      });
    }
  };

  const handleExtractFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setExtractImage(reader.result as string);
      setExtractError(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ── Favorites Handlers ────────────────────────────────────────────────

  const handleAddFavorite = (imageUrl: string, folderId: string, convId?: string, entryId?: string) => {
    const item: StoredFavorite = {
      id: genId(),
      imageUrl,
      folderId,
      sourceConversationId: convId,
      sourceEntryId: entryId,
      createdAt: Date.now(),
    };
    addFavorite(item);
    setFavorites(getFavorites());
    setShowAddToFavMenu(null);
    setContextMenu(null);
  };

  const handleRemoveFavorite = (id: string) => {
    removeFavorite(id);
    setFavorites(getFavorites());
  };

  const handleUpdateFavoriteName = (id: string, name: string) => {
    updateFavorite(id, { name });
    setFavorites(getFavorites());
    setEditingFavoriteId(null);
  };

  const handleAddFolder = () => {
    if (!newFolderName.trim()) return;
    const folder: StoredFavoriteFolder = {
      id: genId(),
      name: newFolderName.trim(),
      createdAt: Date.now(),
    };
    const updated = [...favoriteFolders, folder];
    setFavoriteFolders(updated);
    saveFavoriteFolders(updated);
    setNewFolderName('');
    setShowAddFolder(false);
  };

  const handleDeleteFolder = (id: string) => {
    const updated = favoriteFolders.filter(f => f.id !== id);
    setFavoriteFolders(updated);
    saveFavoriteFolders(updated);
    const updatedFavs = favorites.filter(f => f.folderId !== id);
    saveFavorites(updatedFavs);
    setFavorites(updatedFavs);
  };

  const filteredFavorites = activeFolderId === 'all'
    ? favorites
    : favorites.filter(f => f.folderId === activeFolderId);

  // ── Context Menu Handlers ─────────────────────────────────────────────

  const openContextMenu = (e: React.MouseEvent, imageUrl: string, convId?: string, entryId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, imageUrl, convId, entryId });
  };

  const handleCopyImage = async (imageUrl: string) => {
    setContextMenu(null);
    try {
      if (imageUrl.startsWith('data:')) {
        const resp = await fetch(imageUrl);
        const blob = await resp.blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      } else if (imageUrl.startsWith('http')) {
        await navigator.clipboard.writeText(imageUrl);
      } else {
        const b64 = await invoke<string>('read_image_base64', { path: imageUrl });
        const resp = await fetch(b64);
        const blob = await resp.blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      }
    } catch {}
  };

  const handleCopyImageLink = (imageUrl: string) => {
    setContextMenu(null);
    navigator.clipboard.writeText(imageUrl).catch(() => {});
  };

  const handleExtractFromContextMenu = (imageUrl: string) => {
    setContextMenu(null);
    setPendingExtractFromImage(imageUrl);
  };

  // ── LLM Models Fetch ──────────────────────────────────────────────────
  const fetchLlmModels = async () => {
    const prov = providers.find(p => p.id === llmConfig.providerId);
    const key = prov?.apiKey || apiKey;
    const url = prov?.baseUrl?.replace('/images/generations', '') || apiUrl.replace('/images/generations', '');
    if (!key) return;
    try {
      const result = await invoke<{id: string}[]>('fetch_llm_models', { apiKey: key, apiUrl: url });
      if (result.length > 0) setLlmModels(result);
    } catch {}
  };

  const updateLlmConfig = (updates: Partial<LlmConfig>) => {
    const updated = { ...llmConfig, ...updates };
    setLlmConfigState(updated);
    saveLlmConfig(updated);
  };

  // ── Send ─────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!prompt.trim() || isLoading || !activeConvId) return;
    if (parallelCount > 1) { handleBatchSend(); return; }

    const convId = activeConvId;
    const userPrompt = prompt.trim();

    const urlRefs = showRefInput
      ? refUrls.split('\n').map(u => u.trim()).filter(u => u.length > 0)
      : [];
    const allRefs = [...urlRefs, ...pastedImages];

    const { contextImages, historyImageCount } =
      buildContext(entries, allRefs.length, autoContext);

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

  const updateEntryImages = (batchId: string, taskIdx: number, image: string) => {
    if (!batchProgressRef.current[batchId]) return;
    batchProgressRef.current[batchId]![taskIdx] = {
      ...batchProgressRef.current[batchId]![taskIdx], status: 'success', image,
    };
    if (activeConvIdRef.current !== batchConvIdRef.current) return;
    setEntries(prev => {
      const updated = prev.map(e =>
        e.batchId === batchId && e.loading
          ? { ...e, batchImages: [...(batchProgressRef.current[batchId] || [])] }
          : e
      );
      scheduleBatchSave(updated);
      return updated;
    });
  };

  const updateEntryError = (batchId: string, taskIdx: number, error: string) => {
    if (!batchProgressRef.current[batchId]) return;
    batchProgressRef.current[batchId]![taskIdx] = {
      ...batchProgressRef.current[batchId]![taskIdx], status: 'failed', error,
    };
    if (activeConvIdRef.current !== batchConvIdRef.current) return;
    setEntries(prev => {
      const updated = prev.map(e =>
        e.batchId === batchId && e.loading
          ? { ...e, batchImages: [...(batchProgressRef.current[batchId] || [])] }
          : e
      );
      scheduleBatchSave(updated);
      return updated;
    });
  };

  const scheduleBatchSave = (updatedEntries: ConvEntry[]) => {
    batchSaveEntriesRef.current = updatedEntries;
    if (batchSaveTimerRef.current) clearTimeout(batchSaveTimerRef.current);
    batchSaveTimerRef.current = setTimeout(() => {
      const convId = batchConvIdRef.current;
      const entries = batchSaveEntriesRef.current;
      if (!convId || !entries) return;
      const title = entries.find((e: ConvEntry) => e.type === 'user' && e.prompt)?.prompt?.slice(0, 30) || 'New Chat';
      invoke('save_conversation', { conversationId: convId, title, entries }).catch(() => {});
      batchSaveTimerRef.current = null;
    }, 1500);
  };

  const handleBatchSend = async () => {
    if (!prompt.trim() || isLoading || !activeConvId) return;
    const convId = activeConvId;
    batchConvIdRef.current = convId;
    const userPrompt = prompt.trim();
    const urlRefs = showRefInput ? refUrls.split('\n').map(u => u.trim()).filter(u => u.trim().length > 0) : [];
    const allRefs = [...urlRefs, ...pastedImages];
    const { contextImages, historyImageCount } = buildContext(entries, allRefs.length, false);
    const totalRefs = allRefs.length + historyImageCount;
    if (totalRefs > 6) {
      setValidationError(`参考图数量不能超过 6 张（当前 ${totalRefs} 张），请减少参考图或清空历史对话`);
      setTimeout(() => setValidationError(''), 5000);
      return;
    }
    setValidationError('');
    let enrichedPrompt = userPrompt;
    const presetParts: string[] = [];
    const negativeParts: string[] = [];
    selectedPresets.forEach(v => {
      if (v.startsWith('[negative:')) negativeParts.push(v);
      else presetParts.push(v);
    });
    if (presetParts.length > 0) enrichedPrompt += `\n\n[风格参数] ${presetParts.join(', ')}`;
    if (negativeParts.length > 0) {
      const negFlat = negativeParts.map(n => n.replace('[negative: ', '').replace(']', '')).join(', ');
      enrichedPrompt += `\n\n[Negative prompt] ${negFlat}`;
    }
    const refImages = totalRefs > 0 ? [...allRefs, ...contextImages] : undefined;
    const userEntry: ConvEntry = {
      id: genId(), type: 'user', prompt: userPrompt, timestamp: Date.now(),
      size, model, refImages: allRefs.length > 0 ? allRefs : undefined,
    };
    const batchId = genId();
    const initialBatchImages: BatchTask[] = Array.from({ length: parallelCount }, (_, i) => ({ id: i, status: 'loading' as const }));
    batchProgressRef.current[batchId] = [...initialBatchImages];
    const loadingEntry: ConvEntry = {
      id: genId(), type: 'assistant', loading: true, timestamp: Date.now(),
      size, batchId, batchTotal: parallelCount, batchImages: initialBatchImages,
    };
    setPrompt('');
    setPastedImages([]);
    cancelledRef.current = false;
    const snapshotEntries = [...entries];
    const beforeEntries = [...snapshotEntries, userEntry, loadingEntry];
    setEntries(beforeEntries);
    setLoadingConvs(prev => { const n = new Set(prev); n.add(convId); return n; });
    const inProgressTitle = userPrompt.slice(0, 30) || 'New Chat';
    await invoke('save_conversation', { conversationId: convId, title: inProgressTitle, entries: beforeEntries });
    setTimeout(() => loadConversations(), 50);
    const startTime = Date.now();
    const BATCH_SIZE = 5;
    const allResults: ({ images: string[]; error: string | null } | null)[] = Array(parallelCount).fill(null);
    for (let batchStart = 0; batchStart < parallelCount; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, parallelCount);
      const promises: Promise<void>[] = [];
      for (let i = batchStart; i < batchEnd; i++) {
        const idx = i;
        promises.push(
          invoke<{ images: string[]; error: string | null }>('generate_image', {
            prompt: enrichedPrompt, apiKey, apiUrl, model, size, n: 1,
            referenceImages: refImages, responseFormat: 'b64_json',
          }).then(result => {
            allResults[idx] = result;
            if (result.images && result.images.length > 0) updateEntryImages(batchId, idx, result.images[0]);
            else updateEntryError(batchId, idx, result.error || 'Unknown error');
          }).catch(err => {
            allResults[idx] = { images: [], error: String(err) };
            updateEntryError(batchId, idx, String(err));
          })
        );
      }
      await Promise.allSettled(promises);
    }
    if (cancelledRef.current && activeConvIdRef.current === convId) return;
    const endTime = Date.now();
    const images: string[] = [];
    const batchImages: BatchTask[] = [];
    let errorCount = 0;
    const taskErrors: string[] = [];
    allResults.forEach((result, i) => {
      const imgs = result?.images ?? [];
      const err = result?.error ?? null;
      if (imgs.length > 0) {
        images.push(imgs[0]);
        batchImages.push({ id: i, status: 'success', image: imgs[0] });
      } else {
        errorCount++;
        batchImages.push({ id: i, status: 'failed', error: err || 'Unknown error' });
        taskErrors.push(err || `生成 #${i + 1} 失败`);
      }
    });
    const done: ConvEntry = {
      ...loadingEntry, loading: false,
      images: images.length > 0 ? images : undefined,
      error: images.length === 0 ? `全部 ${errorCount} 个任务失败` : undefined,
      duration: endTime - startTime, completedAt: endTime,
      imageCount: images.length, model,
      contextImageCount: historyImageCount,
      batchId, batchTotal: parallelCount,
      batchImages, batchErrors: errorCount,
    };
    const base = snapshotEntries.filter(e => e.id !== loadingEntry.id && e.id !== userEntry.id);
    const finalEntries = [...base, userEntry, done];
    setLoadingConvs(prev => { const n = new Set(prev); n.delete(convId); return n; });
    delete batchProgressRef.current[batchId];
    if (batchSaveTimerRef.current) { clearTimeout(batchSaveTimerRef.current); batchSaveTimerRef.current = null; }
    batchConvIdRef.current = null;
    batchSaveEntriesRef.current = null;
    const title = userPrompt.slice(0, 30) || 'New Chat';
    await invoke('save_conversation', { conversationId: convId, title, entries: finalEntries });
    if (activeConvIdRef.current === convId) setEntries(finalEntries);
    setTimeout(() => loadConversations(), 100);
    inputRef.current?.focus();
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
          if (sidebarCategory === 'extract') {
            setExtractImage(dataUrl);
            setExtractError(null);
          } else {
            setPastedImages(prev => prev.length < 6 ? [...prev, dataUrl] : prev);
          }
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
  const contextInfo = buildContext(entries, currentUserRefCount, autoContext && parallelCount <= 1);

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
            <div className="sidebar-category-tabs">
              <button
                className={`sidebar-cat-tab ${sidebarCategory === 'normal' ? 'active' : ''}`}
                onClick={() => switchSidebarCategory('normal')}
              >
                对话
              </button>
              <button
                className={`sidebar-cat-tab ${sidebarCategory === 'mcp' ? 'active' : ''}`}
                onClick={() => switchSidebarCategory('mcp')}
              >
                MCP
              </button>
              <button
                className={`sidebar-cat-tab ${sidebarCategory === 'extract' ? 'active' : ''}`}
                onClick={() => switchSidebarCategory('extract')}
              >
                提取
              </button>
              <button
                className={`sidebar-cat-tab ${sidebarCategory === 'favorites' ? 'active' : ''}`}
                onClick={() => switchSidebarCategory('favorites')}
              >
                收藏
              </button>
            </div>
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
          {sidebarCategory === 'normal' ? (
            <>
              <div className="sidebar-actions">
                <button className="sidebar-new-btn" onClick={() => createConv(false)} title="在此窗口新建对话">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  新对话
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
            </>
          ) : sidebarCategory === 'mcp' ? (
            <>
              <div className="sidebar-actions">
                <button className="sidebar-new-btn" onClick={loadMcpConversations} title="刷新 MCP 会话列表">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                  刷新
                </button>
              </div>
              <div className="sidebar-actions" style={{ borderTop: 'none', paddingTop: 0 }}>
                <button className="sidebar-new-btn" onClick={() => {
                  setShowMcpGuide(true);
                  invoke<string>('get_mcp_server_url').then(url => setMcpRemoteUrl(url)).catch(() => {});
                }} title="查看 MCP 使用指南">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  MCP 指令
                </button>
              </div>
              <div className="sidebar-list">
                {mcpConversations.length === 0 ? (
                  <div className="sidebar-empty-hint">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                    </svg>
                    <p>暂无 MCP 会话</p>
                  </div>
                ) : (
                  [...mcpConversations]
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                    .map(mconv => {
                      const mImgCount = mconv.entries.reduce((s, e) => s + (e.imageCount || 0), 0);
                      const mPromptCount = mconv.entries.filter(e => e.type === 'user').length;
                      const mIsLoading = mconv.entries.some(e => e.loading);
                      return (
                        <div
                          key={mconv.id}
                          className={`conv-item ${activeMcpSessionId === mconv.id ? 'active' : ''}`}
                          onClick={() => { setActiveMcpSessionId(mconv.id); setMcpBatchDetailEntryId(null); }}
                        >
                          <div className="conv-item-info">
                            <div className="conv-item-title">
                              {mconv.title}
                              {mIsLoading && <span className="conv-loading-dot" />}
                            </div>
                            <div className="conv-item-preview">
                              {mPromptCount} 条 · {mImgCount} 张
                            </div>
                          </div>
                          <div className="conv-item-actions">
                            <button
                              className="conv-action-btn conv-delete-btn"
                              title="删除"
                              onClick={e => { e.stopPropagation(); deleteMcpSession(mconv.id); }}
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
            </>
          ) : sidebarCategory === 'extract' ? (
            <>
              <div className="sidebar-actions">
                <button className="sidebar-new-btn" onClick={() => {
                  setExtractImage(null);
                  setExtractError(null);
                  setActiveExtractConvId(null);
                }} title="开始新的提取会话">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  新提取
                </button>
              </div>
              <div className="sidebar-list">
                {extractConversations.length === 0 ? (
                  <div className="sidebar-empty-hint">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                    </svg>
                    <p>暂无提取记录</p>
                    <p style={{ fontSize: '11px', opacity: 0.7 }}>上传图片或右键对话中的图片开始提取</p>
                  </div>
                ) : (
                  [...extractConversations]
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                    .map(ec => (
                      <div
                        key={ec.id}
                        className={`conv-item ${activeExtractConvId === ec.id ? 'active' : ''}`}
                        onClick={() => switchExtractConv(ec.id)}
                      >
                        <div className="conv-item-info">
                          <div className="conv-item-title">{ec.title}</div>
                          <div className="conv-item-preview">{ec.tasks.length} 条操作</div>
                        </div>
                        <div className="conv-item-actions">
                          <button
                            className="conv-action-btn conv-delete-btn"
                            title="删除"
                            onClick={e => { e.stopPropagation(); deleteExtractConv(ec.id); }}
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
            </>
          ) : sidebarCategory === 'favorites' ? (
            <>
              <div className="sidebar-actions">
                <button className="sidebar-new-btn" onClick={() => setShowAddFolder(true)} title="新建收藏夹">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  新建收藏夹
                </button>
              </div>
              {showAddFolder && (
                <div className="sidebar-add-folder-form">
                  <input
                    className="conv-rename-input"
                    placeholder="收藏夹名称"
                    value={newFolderName}
                    autoFocus
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddFolder(); if (e.key === 'Escape') setShowAddFolder(false); }}
                  />
                  <div className="sidebar-folder-form-actions">
                    <button className="sidebar-new-btn" onClick={handleAddFolder}>确定</button>
                    <button className="sidebar-new-btn" onClick={() => { setShowAddFolder(false); setNewFolderName(''); }}>取消</button>
                  </div>
                </div>
              )}
              <div className="sidebar-list">
                <div
                  className={`conv-item ${activeFolderId === 'all' ? 'active' : ''}`}
                  onClick={() => setActiveFolderId('all')}
                >
                  <div className="conv-item-info">
                    <div className="conv-item-title">全部收藏</div>
                    <div className="conv-item-preview">{favorites.length} 项</div>
                  </div>
                </div>
                {favoriteFolders.map(folder => (
                  <div
                    key={folder.id}
                    className={`conv-item ${activeFolderId === folder.id ? 'active' : ''}`}
                    onClick={() => setActiveFolderId(folder.id)}
                  >
                    <div className="conv-item-info">
                      <div className="conv-item-title">
                        {folder.icon || '📁'} {folder.name}
                      </div>
                      <div className="conv-item-preview">
                        {favorites.filter(f => f.folderId === folder.id).length} 项
                      </div>
                    </div>
                    <div className="conv-item-actions">
                      <button
                        className="conv-action-btn conv-delete-btn"
                        title="删除收藏夹"
                        onClick={e => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
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
                {trashItems.length > 0 && (
                  <button
                    className="header-icon-btn trash-clear-btn"
                    onClick={deleteAllTrash}
                    title="清空回收站（不可恢复）"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <line x1="2" y1="2" x2="22" y2="22" />
                    </svg>
                    清空
                  </button>
                )}
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
        ) : sidebarCategory === 'mcp' ? (
          <>
            <header className="app-header">
              <div className="header-left">
                {!showSidebar && (
                  <button className="header-icon-btn" onClick={() => setShowSidebar(true)} title="展开侧边栏">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                    </svg>
                  </button>
                )}
                <div className="logo">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                </div>
                <h1 className="app-title">MCP 会话</h1>
                <span className="model-badge">{mcpConversations.length} 个会话</span>
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
            <main className="mcp-session-detail">
              {activeMcpSessionId ? (() => {
                const conv = mcpConversations.find(c => c.id === activeMcpSessionId);
                if (!conv) {
                  return <div className="mcp-empty-detail"><p>会话不存在</p></div>;
                }
                if (conv.entries.length === 0) {
                  return <div className="mcp-empty-detail"><p>此会话暂无记录</p></div>;
                }
                if (mcpBatchDetailEntryId) {
                  const batchEntry = conv.entries.find(e => e.id === mcpBatchDetailEntryId);
                  if (batchEntry) {
                    const tasks = batchEntry.batchImages || [];
                    const successTasks = tasks.filter(t => t.status === 'success');
                    const failedTasks = tasks.filter(t => t.status === 'failed');
                    const loadingTasks = tasks.filter(t => t.status === 'loading');
                    const total = batchEntry.batchTotal || 0;
                    const progress = successTasks.length + failedTasks.length;
                    const progressPct = total > 0 ? (progress / total) * 100 : 0;
                    return (
                      <>
                        <div className="batch-detail-header">
                          <button className="header-icon-btn" onClick={() => setMcpBatchDetailEntryId(null)} title="返回会话">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
                            </svg>
                          </button>
                          <h2 className="batch-detail-title">生成结果</h2>
                          <span className="model-badge">{successTasks.length}/{total} 成功</span>
                          {failedTasks.length > 0 && <span className="model-badge" style={{ color: 'var(--error)' }}>{failedTasks.length} 失败</span>}
                          {loadingTasks.length > 0 && <span className="model-badge" style={{ color: 'var(--text-secondary)' }}>{loadingTasks.length} 进行中</span>}
                        </div>
                        <div className="batch-detail-stats">
                          <div className="batch-detail-stat">
                            <span className="stat-number">{total}</span>
                            <span className="stat-label">总任务</span>
                          </div>
                          <div className="batch-detail-stat success">
                            <span className="stat-number">{successTasks.length}</span>
                            <span className="stat-label">成功</span>
                          </div>
                          <div className="batch-detail-stat failed">
                            <span className="stat-number">{failedTasks.length}</span>
                            <span className="stat-label">失败</span>
                          </div>
                          <div className="batch-detail-stat loading-stat">
                            <span className="stat-number">{loadingTasks.length}</span>
                            <span className="stat-label">进行中</span>
                          </div>
                        </div>
                        {loadingTasks.length > 0 && (
                          <div className="batch-detail-progress">
                            <div className="batch-loading-bar">
                              <div className="batch-loading-fill" style={{ width: `${progressPct}%` }} />
                            </div>
                            <span className="batch-progress-text">{Math.round(progressPct)}%</span>
                          </div>
                        )}
                        <div className="batch-detail-grid">
                          {tasks.map((task, i) => (
                            <div key={i} className={`batch-detail-card ${task.status}`}>
                              {task.status === 'loading' && (
                                <div className="batch-detail-placeholder">
                                  <div className="loading-spinner" />
                                  <span>生成中 #{i + 1}</span>
                                </div>
                              )}
                              {task.status === 'success' && task.image && (
                                <>
                                  <div className="batch-detail-img" onClick={() => setLightboxSrc(task.image!)}>
                                    <LocalImage src={task.image} alt={`图片 #${i + 1}`} style={{ cursor: 'zoom-in' }} />
                                  </div>
                                  <div className="batch-detail-overlay-actions">
                                    <a href={task.image} target="_blank" rel="noreferrer" className="img-action-btn" title="新窗口打开" onClick={e => e.stopPropagation()}>
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                        <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                                      </svg>
                                    </a>
                                  </div>
                                </>
                              )}
                              {task.status === 'failed' && (
                                <div className="batch-detail-placeholder batch-detail-error">
                                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                                  </svg>
                                  <span>#{i + 1}</span>
                                  <span className="batch-detail-err-reason" title={task.error}>{task.error?.slice(0, 40) || '失败'}</span>
                                </div>
                              )}
                              <div className="batch-detail-index">#{i + 1}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    );
                  }
                }
                return conv.entries.map(entry => (
                  <div key={entry.id} className={`chat-entry ${entry.type}`}>
                    {entry.type === 'user' ? (
                      <div className="user-msg">
                        <div className="msg-avatar">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
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
                            <span className="meta-mcp-badge">MCP</span>
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
                          {entry.loading && !entry.batchTotal && (
                            <div className="loading-container">
                              <div className="loading-spinner" />
                              <span className="loading-text">正在生成图片...</span>
                            </div>
                          )}
                          {(() => {
                            const isBatch = entry.batchTotal != null && entry.batchTotal > 1;
                            const isLoadingBatch = entry.loading && isBatch;
                            const doneBatch = !entry.loading && isBatch;
                            if (!isLoadingBatch && !doneBatch) return null;
                            const tasks = entry.batchImages || [];
                            const successTasks = tasks.filter(t => t.status === 'success');
                            const failedTasks = tasks.filter(t => t.status === 'failed');
                            const loadingTasks = tasks.filter(t => t.status === 'loading');
                            const total = entry.batchTotal || 1;
                            const progressPct = total > 0 ? ((successTasks.length + failedTasks.length) / total) * 100 : 0;
                            const allSuccess = loadingTasks.length === 0 && failedTasks.length === 0 && successTasks.length > 0;
                            return (
                              <div className={`batch-group-card ${entry.loading ? 'loading' : ''}`} onClick={() => setMcpBatchDetailEntryId(entry.id)}>
                                <div className="batch-group-header">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                                    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                                  </svg>
                                  {entry.loading ? (
                                    <span className="batch-group-count">
                                      生成中 {successTasks.length}/{total}
                                      {failedTasks.length > 0 && <span className="batch-group-errors-inline">{failedTasks.length}失败</span>}
                                    </span>
                                  ) : (
                                    <>
                                      <span className="batch-group-count">{successTasks.length} 张图片</span>
                                      {entry.batchErrors != null && entry.batchErrors > 0 && (
                                        <span className="batch-group-errors">{entry.batchErrors} 失败</span>
                                      )}
                                      {allSuccess && <span className="batch-group-success">全部成功</span>}
                                    </>
                                  )}
                                  <span className="batch-group-hint">点击查看详情</span>
                                </div>
                                {entry.loading && (
                                  <div className="batch-loading-bar">
                                    <div className="batch-loading-fill" style={{ width: `${progressPct}%` }} />
                                  </div>
                                )}
                                <div className="batch-group-grid">
                                  {tasks.filter(t => t.status === 'success').map((t, i) => (
                                    <div key={`s${i}`} className="batch-group-thumb">
                                      <LocalImage src={t.image!} alt={`图 ${i + 1}`} />
                                    </div>
                                  ))}
                                  {tasks.filter(t => t.status === 'loading').slice(0, 6).map((t, i) => (
                                    <div key={`l${i}`} className="batch-group-thumb loading-thumb">
                                      <div className="loading-spinner" />
                                      <div className="batch-group-task-id">#{t.id + 1}</div>
                                    </div>
                                  ))}
                                  {tasks.filter(t => t.status === 'failed').map((t, i) => (
                                    <div key={`f${i}`} className="batch-group-thumb failed-thumb">
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                                      </svg>
                                      <div className="batch-group-task-id">#{t.id + 1}</div>
                                    </div>
                                  ))}
                                  {tasks.filter(t => t.status === 'loading').length > 6 && (
                                    <div className="batch-group-more">+{tasks.filter(t => t.status === 'loading').length - 6} 排队中</div>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                          {entry.error && !entry.batchTotal && (
                            <div className="error-msg">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                              </svg>
                              {entry.error}
                            </div>
                          )}
                          {!entry.loading && (!entry.batchTotal || entry.batchTotal <= 1) && entry.images && entry.images.length > 0 && (
                            <div className="image-grid">
                              {entry.images.map((img, i) => (
                                <div key={i} className="image-card" onContextMenu={e => openContextMenu(e, img, activeMcpSessionId || undefined, entry.id)}>
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
                              {entry.duration != null && (
                                <span className="summary-item">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                                  </svg>
                                  {formatDuration(entry.duration)}
                                </span>
                              )}
                              {entry.imageCount != null && entry.imageCount > 0 && (
                                <span className="summary-item">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                                  {entry.imageCount} 张
                                </span>
                              )}
                              {entry.batchTotal != null && entry.batchTotal > 1 && (
                                <span className="summary-item batch-summary">
                                  {entry.batchTotal}并行{entry.batchErrors != null && entry.batchErrors > 0 ? ` ${entry.batchErrors}失败` : ''}
                                </span>
                              )}
                              <span className="summary-item">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                                </svg>
                                {formatTime(entry.completedAt)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ));
              })() : (
                <div className="mcp-empty-detail">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                  <p>从左侧选择一个 MCP 会话</p>
                </div>
              )}
            </main>
          </>
        ) : sidebarCategory === 'extract' ? (
          <>
            <header className="app-header">
              <div className="header-left">
                {!showSidebar && (
                  <button className="header-icon-btn" onClick={() => setShowSidebar(true)} title="展开侧边栏">
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
                <h1 className="app-title">图片提取</h1>
                <span className="model-badge">{extractConversations.length} 个会话</span>
              </div>
              <div className="header-right">
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
            <main className="extract-main" onPaste={handlePaste} tabIndex={0}>
              {!extractImage && !activeExtractConvId ? (
                <div className="extract-upload-area">
                  <div className="extract-upload-box">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                    </svg>
                    <h2>上传图片开始提取</h2>
                    <p>支持上传或粘贴本地图片，或在对话中右键图片选择"提取"</p>
                    <label className="extract-upload-btn">
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={handleExtractFileUpload}
                      />
                      选择图片文件
                    </label>
                    <p className="extract-hint">也可以按 Ctrl+V 粘贴剪贴板中的图片</p>
                  </div>
                </div>
              ) : (
                <div className="extract-content">
                  <div className="extract-image-panel">
                    <div className="extract-source-image">
                      {extractImage && (
                        <LocalImage src={extractImage} alt="提取源图片" style={{ maxHeight: '400px', objectFit: 'contain' }} />
                      )}
                      {extractImage && (
                        <button className="extract-change-btn" onClick={() => { setExtractImage(null); setActiveExtractConvId(null); }}>
                          更换图片
                        </button>
                      )}
                    </div>
                    <div className="extract-tools-panel">
                      <div className="extract-cat-tabs">
                        {EXTRACT_CATEGORIES.map(cat => (
                          <button
                            key={cat.id}
                            className={`extract-cat-tab ${activeExtractCat === cat.id ? 'active' : ''}`}
                            onClick={() => setActiveExtractCat(cat.id)}
                          >
                            <span>{cat.icon}</span>
                            <span>{cat.name}</span>
                          </button>
                        ))}
                      </div>
                      <div className="extract-tools-grid">
                        {EXTRACT_TOOLS.filter(t => t.category === activeExtractCat).map(tool => (
                          <button
                            key={tool.id}
                            className="extract-tool-btn"
                            onClick={() => runExtractTool(tool.id)}
                            disabled={(activeExtractConvId && extractLoadingConvs.has(activeExtractConvId)) || !extractImage}
                            title={tool.description}
                          >
                            <span className="extract-tool-icon">{tool.icon}</span>
                            <span className="extract-tool-name">{tool.name}</span>
                          </button>
                        ))}
                      </div>
                      {(activeExtractCat === 'extract' || activeExtractCat === 'ai-tools') && (
                        <div className="extract-notes-section">
                          <label className="extract-notes-label">
                            {activeExtractCat === 'extract' ? '📝 提取额外要求' : '📝 AI工具额外要求'}
                          </label>
                          <textarea
                            className="extract-notes-input"
                            placeholder={activeExtractCat === 'extract' 
                              ? '输入额外的提取要求或约束（例如：特定细节强调、输出格式要求等）' 
                              : '输入额外的处理要求（例如：强度调整、风格偏好等）'}
                            value={extractNotes[activeExtractCat] || ''}
                            onChange={(e) => setExtractNotes(prev => ({ ...prev, [activeExtractCat]: e.target.value }))}
                            rows={3}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="extract-results-panel">
                    {(() => {
                      const conv = extractConversations.find(c => c.id === activeExtractConvId);
                      if (!conv || conv.tasks.length === 0) return (
                        <div className="extract-empty">
                          <p>选择一个提取工具开始处理</p>
                        </div>
                      );
                      return conv.tasks.map(task => (
                        <div key={task.id} className={`extract-task ${task.type}`}>
                          {task.type === 'user' && (
                            <div className="extract-user-task">
                              <div className="extract-tool-badge">{getToolById(task.extractType || '')?.name || '操作'}</div>
                              <div className="extract-task-time">{formatTime(task.timestamp)}</div>
                            </div>
                          )}
                          {task.type === 'assistant' && (
                            <div className="extract-assistant-task">
                              {task.loading && (
                                <div className="loading-container">
                                  <div className="loading-spinner" />
                                  <span className="loading-text">
                                    {task.step === 'generating'
                                      ? 'LLM 已优化提示词，正在生成图片...'
                                      : 'LLM 正在分析图片并优化提示词...'}
                                  </span>
                                  <div className="extract-step-indicator">
                                    <span className={task.step === 'analyzing' ? 'extract-step active' : 'extract-step done'}>
                                      {task.step === 'analyzing' ? '●' : '✓'} 分析
                                    </span>
                                    <span className="extract-step-arrow">→</span>
                                    <span className={`extract-step ${task.step === 'generating' ? 'active' : 'pending'}`}>
                                      {task.step === 'generating' ? '●' : '○'} 生图
                                    </span>
                                  </div>
                                </div>
                              )}
                              {task.error && (
                                <div className="error-msg">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                                  </svg>
                                  {task.error}
                                </div>
                              )}
                              {task.resultText && (
                                <div className="extract-result-text">
                                  {task.resultText.split('\n').map((line, i) => (
                                    line.startsWith('**### ') ? (
                                      <h3 key={i} className="extract-result-section">{line.replace(/\*\*/g, '').replace('### ', '')}</h3>
                                    ) : line.startsWith('**') && line.endsWith('**') ? (
                                      <h4 key={i} className="extract-result-heading">{line.replace(/\*\*/g, '')}</h4>
                                    ) : line.startsWith('- ') ? (
                                      <li key={i} className="extract-result-item">{line.slice(2)}</li>
                                    ) : line.startsWith('1. ') || line.startsWith('2. ') || line.match(/^\d+\. /) ? (
                                      <li key={i} className="extract-result-item">{line}</li>
                                    ) : line.trim() ? (
                                      <p key={i} className="extract-result-para">{line}</p>
                                    ) : <br key={i} />
                                  ))}
                                </div>
                              )}
                              {task.resultImage && (
                                <div className="extract-result-image-container">
                                  <div className="extract-result-label">生成结果</div>
                                  <div
                                    className="extract-result-image"
                                    onContextMenu={e => openContextMenu(e, task.resultImage!)}
                                    onClick={() => setLightboxSrc(task.resultImage!)}
                                  >
                                    <LocalImage
                                      src={task.resultImage}
                                      alt="提取结果"
                                      style={{ cursor: 'zoom-in', width: '100%', borderRadius: 8 }}
                                    />
                                  </div>
                                  <div className="extract-result-image-actions">
                                    <button
                                      className="extract-img-action-btn"
                                      onClick={() => handleCopyImage(task.resultImage!)}
                                      title="复制图片"
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                      </svg>
                                      复制
                                    </button>
                                    <button
                                      className="extract-img-action-btn"
                                      onClick={() => handleExtractFromContextMenu(task.resultImage!)}
                                      title="继续提取"
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                                      </svg>
                                      继续处理
                                    </button>
                                    <button
                                      className="extract-img-action-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setShowAddToFavMenu({ x: e.clientX, y: e.clientY, imageUrl: task.resultImage! });
                                      }}
                                      title="收藏"
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                                      </svg>
                                      收藏
                                    </button>
                                  </div>
                                </div>
                              )}
                              {task.resultImages && task.resultImages.length > 0 && (
                                <div className="extract-result-images-container">
                                  {task.resultImages.map((img, idx) => (
                                    <div key={idx} className="extract-result-image-group">
                                      <div className="extract-result-label">
                                        {task.groupTitles?.[idx] || `分组${idx + 1}`}
                                      </div>
                                      <div
                                        className="extract-result-image"
                                        onContextMenu={e => openContextMenu(e, img)}
                                        onClick={() => setLightboxSrc(img)}
                                      >
                                        <LocalImage
                                          src={img}
                                          alt={`分组${idx + 1}结果`}
                                          style={{ cursor: 'zoom-in', width: '100%', borderRadius: 8 }}
                                        />
                                      </div>
                                      <div className="extract-result-image-actions">
                                        <button
                                          className="extract-img-action-btn"
                                          onClick={() => handleCopyImage(img)}
                                          title="复制图片"
                                        >
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                          </svg>
                                          复制
                                        </button>
                                        <button
                                          className="extract-img-action-btn"
                                          onClick={() => handleExtractFromContextMenu(img)}
                                          title="继续提取"
                                        >
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                                          </svg>
                                          继续处理
                                        </button>
                                        <button
                                          className="extract-img-action-btn"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setShowAddToFavMenu({ x: e.clientX, y: e.clientY, imageUrl: img });
                                          }}
                                          title="收藏"
                                        >
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                                          </svg>
                                          收藏
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}
              {extractError && (
                <div className="validation-error">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{extractError}</span>
                </div>
              )}
            </main>
          </>
        ) : sidebarCategory === 'favorites' ? (
          <>
            <header className="app-header">
              <div className="header-left">
                {!showSidebar && (
                  <button className="header-icon-btn" onClick={() => setShowSidebar(true)} title="展开侧边栏">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                    </svg>
                  </button>
                )}
                <div className="logo">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                </div>
                <h1 className="app-title">收藏夹</h1>
                <span className="model-badge">{activeFolderId === 'all' ? favorites.length : filteredFavorites.length} 项</span>
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
            <main className="favorites-main">
              {filteredFavorites.length === 0 ? (
                <div className="favorites-empty">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  <h2>暂无收藏</h2>
                  <p>在对话中右键图片即可收藏到此</p>
                </div>
              ) : (
                <div className="favorites-grid">
                  {filteredFavorites.map(fav => (
                    <div key={fav.id} className="favorite-card">
                      <div className="favorite-img-wrap" onClick={() => setLightboxSrc(fav.imageUrl)}>
                        <LocalImage src={fav.imageUrl} alt={fav.name || '收藏图片'} style={{ cursor: 'zoom-in' }} />
                      </div>
                      <div className="favorite-info">
                        {editingFavoriteId === fav.id ? (
                          <input
                            className="favorite-name-input"
                            value={editingFavoriteName}
                            autoFocus
                            onChange={e => setEditingFavoriteName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleUpdateFavoriteName(fav.id, editingFavoriteName);
                              if (e.key === 'Escape') setEditingFavoriteId(null);
                            }}
                            onBlur={() => handleUpdateFavoriteName(fav.id, editingFavoriteName)}
                          />
                        ) : (
                          <div
                            className="favorite-name"
                            onClick={() => { setEditingFavoriteId(fav.id); setEditingFavoriteName(fav.name || ''); }}
                            title="点击编辑名称"
                          >
                            {fav.name || <span className="favorite-name-hint">点击添加名称</span>}
                          </div>
                        )}
                        <div className="favorite-meta">
                          <span>{fav.name ? `@${fav.name}` : ''}</span>
                          <span>{new Date(fav.createdAt).toLocaleDateString('zh-CN')}</span>
                        </div>
                      </div>
                      <div className="favorite-actions">
                        <button
                          className="favorite-action-btn"
                          title="删除"
                          onClick={() => handleRemoveFavorite(fav.id)}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </main>
          </>
        ) : showBatchDetail ? (
          <div className="trash-view">
            <header className="app-header">
              <div className="header-left">
                <button className="header-icon-btn" onClick={() => setShowBatchDetail(null)} title="返回对话">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
                  </svg>
                </button>
                <h1 className="app-title">生成结果</h1>
                {(() => {
                  const batchEntry = entries.find(e => e.batchId === showBatchDetail);
                  if (!batchEntry) return null;
                  const successTasks = (batchEntry.batchImages || []).filter(t => t.status === 'success');
                  const failedTasks = (batchEntry.batchImages || []).filter(t => t.status === 'failed');
                  const loadingTasks = (batchEntry.batchImages || []).filter(t => t.status === 'loading');
                  const total = batchEntry.batchTotal || 0;
                  return (
                    <>
                      <span className="model-badge">{successTasks.length}/{total} 成功</span>
                      {failedTasks.length > 0 && <span className="model-badge" style={{ color: 'var(--error)' }}>{failedTasks.length} 失败</span>}
                      {loadingTasks.length > 0 && <span className="model-badge" style={{ color: 'var(--text-secondary)' }}>{loadingTasks.length} 进行中</span>}
                    </>
                  );
                })()}
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
            <main className="batch-detail-main">
              {(() => {
                const batchEntry = entries.find(e => e.batchId === showBatchDetail);
                if (!batchEntry) return <div className="welcome"><h2>批次不存在</h2></div>;
                const tasks = batchEntry.batchImages || [];
                const successCount = tasks.filter(t => t.status === 'success').length;
                const failedCount = tasks.filter(t => t.status === 'failed').length;
                const loadingCount = tasks.filter(t => t.status === 'loading').length;
                const total = batchEntry.batchTotal || 0;
                const progress = successCount + failedCount;
                const progressPct = total > 0 ? (progress / total) * 100 : 0;
                return (
                  <>
                    <div className="batch-detail-stats">
                      <div className="batch-detail-stat">
                        <span className="stat-number">{total}</span>
                        <span className="stat-label">总任务</span>
                      </div>
                      <div className="batch-detail-stat success">
                        <span className="stat-number">{successCount}</span>
                        <span className="stat-label">成功</span>
                      </div>
                      <div className="batch-detail-stat failed">
                        <span className="stat-number">{failedCount}</span>
                        <span className="stat-label">失败</span>
                      </div>
                      <div className="batch-detail-stat loading-stat">
                        <span className="stat-number">{loadingCount}</span>
                        <span className="stat-label">进行中</span>
                      </div>
                    </div>
                    {loadingCount > 0 && (
                      <div className="batch-detail-progress">
                        <div className="batch-loading-bar">
                          <div className="batch-loading-fill" style={{ width: `${progressPct}%` }} />
                        </div>
                        <span className="batch-progress-text">{Math.round(progressPct)}%</span>
                      </div>
                    )}
                    <div className="batch-detail-grid">
                      {tasks.map((task, i) => (
                        <div key={i} className={`batch-detail-card ${task.status}`}>
                          {task.status === 'loading' && (
                            <div className="batch-detail-placeholder">
                              <div className="loading-spinner" />
                              <span>生成中 #{i + 1}</span>
                            </div>
                          )}
                          {task.status === 'success' && task.image && (
                            <>
                              <div className="batch-detail-img" onClick={() => setLightboxSrc(task.image!)}>
                                <LocalImage src={task.image} alt={`图片 #${i + 1}`} style={{ cursor: 'zoom-in' }} />
                              </div>
                              <div className="batch-detail-overlay-actions">
                                <a href={task.image} target="_blank" rel="noreferrer" className="img-action-btn" title="新窗口打开" onClick={e => e.stopPropagation()}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                    <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                                  </svg>
                                </a>
                              </div>
                            </>
                          )}
                          {task.status === 'failed' && (
                            <div className="batch-detail-placeholder batch-detail-error">
                              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                              </svg>
                              <span>#{i + 1}</span>
                              <span className="batch-detail-err-reason" title={task.error}>{task.error?.slice(0, 40) || '失败'}</span>
                            </div>
                          )}
                          <div className="batch-detail-index">#{i + 1}</div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
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
              <span className="context-badge" title={`上下文：本次上传 ${contextInfo.userRefImageCount} 张${contextInfo.historyImageCount > 0 ? `\n历史参考图 ${contextInfo.historyImageCount} 张（自动上下文）` : ''}${parallelCount > 1 ? '\n（多图生成时自动上下文已关闭）' : ''}`}>
                上下文: {contextInfo.totalImageCount}图
              </span>
            )}
            {!autoContext && contextInfo.totalImageCount === 0 && (
              <span className="context-badge" style={{ opacity: 0.6 }} title="已关闭自动上下文，本次对话不会自动关联历史生成图">
                上下文: 关闭
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
                    {entry.loading && !entry.batchTotal && (
                      <div className="loading-container">
                        <div className="loading-spinner" />
                        <span className="loading-text">正在生成图片...</span>
                      </div>
                    )}
                    {(() => {
                      const isBatch = entry.batchTotal != null && entry.batchTotal > 1;
                      const isLoadingBatch = entry.loading && isBatch;
                      const doneBatch = !entry.loading && isBatch;

                      if (!isLoadingBatch && !doneBatch) return null;

                      const tasks = entry.batchImages || [];
                      const successTasks = tasks.filter(t => t.status === 'success');
                      const failedTasks = tasks.filter(t => t.status === 'failed');
                      const loadingTasks = tasks.filter(t => t.status === 'loading');
                      const total = entry.batchTotal || 1;
                      const progressPct = total > 0 ? ((successTasks.length + failedTasks.length) / total) * 100 : 0;
                      const allSuccess = loadingTasks.length === 0 && failedTasks.length === 0 && successTasks.length > 0;

                      return (
                        <div className={`batch-group-card ${entry.loading ? 'loading' : ''}`} onClick={() => setShowBatchDetail(entry.batchId!)}>
                          <div className="batch-group-header">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                              <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                            </svg>
                            {entry.loading ? (
                              <span className="batch-group-count">
                                生成中 {successTasks.length}/{total}
                                {failedTasks.length > 0 && <span className="batch-group-errors-inline">{failedTasks.length}失败</span>}
                              </span>
                            ) : (
                              <>
                                <span className="batch-group-count">{successTasks.length} 张图片</span>
                                {entry.batchErrors != null && entry.batchErrors > 0 && (
                                  <span className="batch-group-errors">{entry.batchErrors} 失败</span>
                                )}
                                {allSuccess && <span className="batch-group-success">全部成功</span>}
                              </>
                            )}
                            <span className="batch-group-hint">点击查看详情</span>
                          </div>
                          {entry.loading && (
                            <div className="batch-loading-bar">
                              <div className="batch-loading-fill" style={{ width: `${progressPct}%` }} />
                            </div>
                          )}
                          <div className="batch-group-grid">
                            {tasks.filter(t => t.status === 'success').map((t, i) => (
                              <div key={`s${i}`} className="batch-group-thumb">
                                <LocalImage src={t.image!} alt={`图 ${i + 1}`} />
                              </div>
                            ))}
                            {tasks.filter(t => t.status === 'loading').slice(0, 6).map((t, i) => (
                              <div key={`l${i}`} className="batch-group-thumb loading-thumb">
                                <div className="loading-spinner" />
                                <div className="batch-group-task-id">#{t.id + 1}</div>
                              </div>
                            ))}
                            {tasks.filter(t => t.status === 'failed').map((t, i) => (
                              <div key={`f${i}`} className="batch-group-thumb failed-thumb">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                                </svg>
                                <div className="batch-group-task-id">#{t.id + 1}</div>
                              </div>
                            ))}
                            {tasks.filter(t => t.status === 'loading').length > 6 && (
                              <div className="batch-group-more">+{tasks.filter(t => t.status === 'loading').length - 6} 排队中</div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    {entry.error && (
                      <div className="error-msg">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                        {entry.error}
                      </div>
                    )}
                    {!entry.loading && (!entry.batchTotal || entry.batchTotal <= 1) && entry.images && entry.images.length > 0 && (
                      <div className="image-grid">
                        {entry.images.map((img, i) => (
                          <div key={i} className="image-card" onContextMenu={e => openContextMenu(e, img, activeConvId, entry.id)}>
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
                        {entry.batchTotal != null && entry.batchTotal > 1 && (
                          <span className="summary-item batch-summary">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                              <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                            </svg>
                            {entry.batchTotal}并行{entry.batchErrors != null && entry.batchErrors > 0 ? ` ${entry.batchErrors}失败` : ''}
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

            <div className="batch-count-control" title="并行生成数量">
              <span className="batch-count-label">并行</span>
              <button
                className="batch-count-btn"
                onClick={() => setParallelCount(c => Math.max(1, c - 1))}
                disabled={isLoading || parallelCount <= 1}
              >
                <svg width="8" height="8" viewBox="0 0 12 12"><line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" /></svg>
              </button>
              <input
                type="number"
                className="batch-count-input"
                value={parallelCount}
                min={1}
                max={20}
                onChange={e => {
                  const v = parseInt(e.target.value);
                  if (!isNaN(v) && v >= 1 && v <= 20) setParallelCount(v);
                }}
                disabled={isLoading}
              />
              <button
                className="batch-count-btn"
                onClick={() => setParallelCount(c => Math.min(20, c + 1))}
                disabled={isLoading || parallelCount >= 20}
              >
                <svg width="8" height="8" viewBox="0 0 12 12"><line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" /><line x1="6" y1="2" x2="6" y2="10" stroke="currentColor" strokeWidth="1.5" /></svg>
              </button>
            </div>

            <label
              className={`auto-context-toggle ${autoContext ? 'active' : ''} ${parallelCount > 1 ? 'disabled' : ''}`}
              title="勾选自动设定上下文：单张图片生成后，最后一张图片默认作为上下文参考图。多张图片中，自动上下文无效，仅使用复制粘贴的参考图。"
            >
              <input
                type="checkbox"
                checked={autoContext && parallelCount <= 1}
                onChange={e => { setAutoContext(e.target.checked); if (e.target.checked) setValidationError(''); }}
                disabled={isLoading || parallelCount > 1}
              />
              <span className="auto-context-slider" />
              <span className="auto-context-text">自动上下文</span>
            </label>

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
            {showMentionDropdown && favorites.filter(f => f.name && f.name.toLowerCase().includes(mentionFilter.toLowerCase())).length > 0 && (
              <div className="mention-dropdown">
                {favorites.filter(f => f.name && f.name.toLowerCase().includes(mentionFilter.toLowerCase())).slice(0, 8).map(fav => (
                  <button
                    key={fav.id}
                    className="mention-item"
                    onClick={() => {
                      const match = prompt.match(/@([^@]*)$/);
                      const atPos = match ? prompt.length - match[0].length : prompt.length;
                      const newPrompt = prompt.slice(0, atPos) + `[ref:${fav.name}] `;
                      setPrompt(newPrompt);
                      setPastedImages(prev => prev.includes(fav.imageUrl) ? prev : [...prev, fav.imageUrl]);
                      setShowMentionDropdown(false);
                      setMentionFilter('');
                      inputRef.current?.focus();
                    }}
                  >
                    <div className="mention-thumb">
                      <LocalImage src={fav.imageUrl} alt={fav.name} />
                    </div>
                    <div className="mention-info">
                      <span className="mention-name">@{fav.name}</span>
                      <span className="mention-folder">{favoriteFolders.find(f => f.id === fav.folderId)?.name || '未分类'}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={inputRef}
              className="input-field"
              value={prompt}
              onChange={e => {
                const v = e.target.value;
                setPrompt(v);
                const match = v.match(/@([^@\s]*)$/);
                if (match) {
                  setShowMentionDropdown(true);
                  setMentionFilter(match[1]);
                } else {
                  setShowMentionDropdown(false);
                  setMentionFilter('');
                }
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onBlur={() => setTimeout(() => setShowMentionDropdown(false), 200)}
              placeholder="描述你想生成的图片... (粘贴图片作为参考图，Shift+Enter 换行，@引用收藏图片)"
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
            <div className="settings-tabs">
              <button
                className={`settings-tab ${settingsTab === 'image' ? 'active' : ''}`}
                onClick={() => setSettingsTab('image')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                </svg>
                图片模型
              </button>
              <button
                className={`settings-tab ${settingsTab === 'mcp' ? 'active' : ''}`}
                onClick={() => setSettingsTab('mcp')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
                MCP
              </button>
              <button
                className={`settings-tab ${settingsTab === 'llm' ? 'active' : ''}`}
                onClick={() => setSettingsTab('llm')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                语言模型
              </button>
            </div>
            <div className="settings-body">
              {settingsTab === 'image' && (
                <>
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
                    <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." />
                  </div>
                  <div className="setting-item">
                    <label>API 地址</label>
                    <input type="text" value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="https://api.example.com/v1/images/generations" />
                  </div>
                  <div className="setting-item">
                    <label>模型</label>
                    <div className="model-setting-row">
                      <input type="text" value={model} onChange={e => setModel(e.target.value)} placeholder="gpt-image-2" />
                      <button className="refresh-models-btn" onClick={fetchModelsList} title="从 API 获取可用模型">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </>
              )}

              {settingsTab === 'mcp' && (
                <div className="setting-item mcp-settings-section">
                  <label>MCP 服务器配置</label>
                  <div className="mcp-settings-description">
                    外部 AI 工具通过 MCP 协议调用本工具生成图片。配置用于 MCP 调用的 Provider 和默认参数。
                  </div>
                  <div className="mcp-setting-row">
                    <label className="mcp-sub-label">MCP Provider</label>
                    <select className="model-select" value={mcpConfig.providerId} onChange={e => updateMcpConfig({ providerId: e.target.value })}>
                      <option value="">跟随当前</option>
                      {providers.map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
                    </select>
                  </div>
                  <div className="mcp-setting-row">
                    <label className="mcp-sub-label">默认尺寸</label>
                    <select className="size-select" value={mcpConfig.defaultSize} onChange={e => updateMcpConfig({ defaultSize: e.target.value })}>
                      {SIZE_OPTIONS.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                    </select>
                  </div>
                  <div className="mcp-setting-row">
                    <label className="mcp-sub-label">风格前缀</label>
                    <input type="text" className="provider-form-input" value={mcpConfig.stylePrefix} onChange={e => updateMcpConfig({ stylePrefix: e.target.value })} placeholder="留空则不添加" />
                  </div>
                  <div className="mcp-setting-row">
                    <label className="mcp-sub-label">输出目录</label>
                    <input type="text" className="provider-form-input" value={mcpConfig.outputDir} onChange={e => updateMcpConfig({ outputDir: e.target.value })} placeholder="留空使用默认目录" />
                  </div>
                  <div className="mcp-startup-hint">
                    <span className="mcp-sub-label">MCP 启动命令</span>
                    <code className="mcp-cmd-code" onClick={e => { const range = document.createRange(); range.selectNode(e.currentTarget as Node); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range); }}>
                      npx tsx scripts/mcp-server.ts
                    </code>
                    <span className="mcp-hint-text">在 AI 工具的 MCP 配置中添加上述命令</span>
                  </div>
                </div>
              )}

              {settingsTab === 'llm' && (
                <>
                  <div className="setting-item">
                    <label>语言模型配置</label>
                    <div className="mcp-settings-description">
                      提取功能使用的语言模型，用于分析图片内容。需要配置一个支持图片输入的 LLM 服务（如 GPT-4o、Claude 3 等）。
                    </div>
                  </div>
                  <div className="setting-item">
                    <label className="mcp-sub-label">语言模型 Provider</label>
                    <select
                      className="model-select"
                      value={llmConfig.providerId}
                      onChange={e => updateLlmConfig({ providerId: e.target.value })}
                    >
                      <option value="">跟随当前图片模型代理</option>
                      {providers.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="setting-item">
                    <label className="mcp-sub-label">语言模型名称</label>
                    <div className="model-setting-row">
                      <input
                        type="text"
                        value={llmConfig.model}
                        onChange={e => updateLlmConfig({ model: e.target.value })}
                        placeholder="gpt-4o"
                      />
                      <button className="refresh-models-btn" onClick={fetchLlmModels} title="从 API 获取可用模型">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="setting-item">
                    <label>可用语言模型</label>
                    <div className="mcp-settings-description">
                      以下是检测到的可用语言模型（需支持图片输入）：
                    </div>
                    <div className="llm-models-list">
                      {llmModels.map(m => (
                        <button
                          key={m.id}
                          className={`llm-model-item ${llmConfig.model === m.id ? 'active' : ''}`}
                          onClick={() => updateLlmConfig({ model: m.id })}
                        >
                          {m.id}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Context Menu ───────────────────────────────────────────────── */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <button className="context-menu-item" onClick={() => handleCopyImage(contextMenu.imageUrl)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            复制图片
          </button>
          <button className="context-menu-item" onClick={() => handleCopyImageLink(contextMenu.imageUrl)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            复制图片链接
          </button>
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={() => handleExtractFromContextMenu(contextMenu.imageUrl)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
            </svg>
            提取图片
          </button>
          <div className="context-menu-divider" />
          <div className="context-menu-submenu">
            <div className="context-menu-item context-menu-parent-item">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              收藏到
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
            <div className="context-submenu-panel">
              {favoriteFolders.map(folder => (
                <button
                  key={folder.id}
                  className="context-menu-item"
                  onClick={() => handleAddFavorite(contextMenu.imageUrl, folder.id, contextMenu.convId, contextMenu.entryId)}
                >
                  {folder.icon || '📁'} {folder.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Add to Favorites Popup ──────────────────────────────────────── */}
      {showAddToFavMenu && (
        <div
          className="context-menu"
          style={{ left: showAddToFavMenu.x, top: showAddToFavMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <div className="context-menu-item context-menu-parent-item" style={{ cursor: 'default', fontWeight: 600, color: 'var(--text-secondary)' }}>
            收藏到
          </div>
          {favoriteFolders.map(folder => (
            <button
              key={folder.id}
              className="context-menu-item"
              onClick={() => handleAddFavorite(showAddToFavMenu.imageUrl, folder.id, showAddToFavMenu.convId, showAddToFavMenu.entryId)}
            >
              {folder.icon || '📁'} {folder.name}
            </button>
          ))}
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

      {/* ── MCP Guide Modal ──────────────────────────────────────────── */}
      {showMcpGuide && (() => {
        const cc = copyToClipboard;
        const ci = copiedCmdIdx;
        const remoteUrl = mcpRemoteUrl;

        const claudeDesktopConfig = `{
  "mcpServers": {
    "image-gen": {
      "type": "streamable-http",
      "url": "${remoteUrl}"
    }
  }
}`;

        const cursorConfig = `{
  "mcpServers": {
    "image-gen": {
      "type": "streamable-http",
      "url": "${remoteUrl}"
    }
  }
}`;

        const vscodeConfig = `{
  "mcp": {
    "servers": {
      "image-gen": {
        "type": "http",
        "url": "${remoteUrl}"
      }
    }
  }
}`;

        const openCodeConfig = `{
  "mcp": {
    "image-gen": {
      "type": "remote",
      "url": "${remoteUrl}",
      "enabled": true
    }
  }
}`;

        const commands = [
          {
            title: '生成单张图片',
            desc: '使用 AI 工具调用 MCP 生成一张图片。可指定尺寸、风格、参考图等参数。',
            code: `使用 image-gen MCP 生成一张图片：一张赛博朋克风格的猫咪，尺寸为 1024x1024`,
          },
          {
            title: '并行生成多张图片',
            desc: '一次性生成多张不同变体图片，适合批量出图、方案对比。',
            code: `使用 image-gen MCP 并行生成 4 张不同风格的日落风景图，尺寸 1280x720`,
          },
          {
            title: '设置风格前缀',
            desc: '在后续所有生图调用中自动加上风格前缀，保持一致风格。',
            code: `使用 image-gen MCP 设置风格为：电影级光影、8K 超清、写实风格`,
          },
          {
            title: '指定输出目录',
            desc: '将生成的图片保存到指定文件夹，而不是默认的 MCP 会话目录。',
            code: `使用 image-gen MCP 将后续生成的图片保存到 D:\\projects\\my-art\\output 目录`,
          },
          {
            title: '带参考图生成',
            desc: '传入参考图进行图生图（最多 6 张）。支持本地文件路径（自动转 base64）、HTTP URL 或 base64 data URI。',
            code: `使用 image-gen MCP 参考 D:\\\\ref\\\\cat.png 生成同风格但背景为星空的版本`,
          },
          {
            title: '切换模型',
            desc: '临时切换使用的生图模型（不影响 app 内设置）。',
            code: `使用 image-gen MCP 切换模型为 gpt-image-1，然后生成一张水墨画风格的山水`,
          },
          {
            title: '查看当前状态',
            desc: '查询 MCP 服务当前的配置与运行状态。',
            code: `使用 image-gen MCP 查看当前状态`,
          },
          {
            title: '批量 + 风格组合调用',
            desc: '先设风格，再批量生成，多步串行的典型工作流。',
            code: `1. 先用 image-gen MCP 设置风格为：宫崎骏动画风格\n2. 然后用 image-gen MCP 并行生成 6 张不同场景的图片（森林城堡、海边小屋、空中飞船、魔法学院、蒸汽朋克城市、海底王国），尺寸 1024x1024\n3. 最后用 image-gen MCP 查看当前状态`,
          },
          {
            title: '统一会话 ID（推荐）',
            desc: '在 AI 工具中通过 session_id 参数传入会话标题（即在 MCP 标签页里看到的名称），多次调用同一标题将聚合到同一个会话里，方便集中查看。',
            code: `使用 image-gen MCP，会话标题设为"我的猫咪系列"，生成一张超现实主义猫咪，尺寸 1024x1024`,
          },
          {
            title: '清空风格 + 重新配置',
            desc: '清除之前的风格前缀并重新设置。',
            code: `1. 先用 image-gen MCP 清空风格\n2. 然后用 image-gen MCP 设置风格为：黑白素描、极简线条\n3. 最后生成一张极简风格的猫`,
          },
        ];

        const CopyBtn = ({ text, idx, compact = false }: { text: string; idx: number; compact?: boolean }) => (
          <button className={`mcp-copy-btn ${compact ? 'mcp-copy-btn-compact' : ''}`} onClick={() => cc(text, idx)}>
            {ci === idx ? '已复制！' : compact ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                复制
              </>
            ) : '复制'}
          </button>
        );

        return (
          <div className="settings-overlay mcp-guide-overlay" onClick={() => setShowMcpGuide(false)}>
            <div className="mcp-guide-panel" onClick={e => e.stopPropagation()}>
              <div className="settings-header">
                <h3>MCP 指令中心</h3>
                <button className="close-settings" onClick={() => setShowMcpGuide(false)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="mcp-guide-body">
                <section className="mcp-guide-section">
                  <h4>什么是 MCP？</h4>
                  <p>MCP（Model Context Protocol）是一种让 AI 工具（如 Claude Desktop、Cursor、VS Code Copilot 等）调用外部能力的标准协议。配置好本工具的 MCP 服务后，你可以在这些 AI 工具中直接通过自然语言指令调用本 app 生成图片，所有生图记录会自动归档到本 app 的 MCP 会话列表中。</p>
                </section>

                <section className="mcp-guide-section">
                  <h4>使用前提</h4>
                  <ul className="mcp-guide-list">
                    <li>确保本工具已启动（MCP HTTP 服务会自动在端口 3845 上运行）</li>
                    <li>服务器地址已自动检测为本机局域网 IP，下方配置片段可直接复制使用</li>
                    <li>将下方对应 AI 工具的 JSON 配置片段粘贴到其配置文件中</li>
                    <li>重启 AI 工具使配置生效</li>
                  </ul>
                </section>

                <section className="mcp-guide-section">
                  <h4>AI 工具配置片段</h4>

                  <div className="mcp-url-config">
                    <label className="mcp-url-label">服务器地址（已自动检测）</label>
                    <input
                      className="mcp-url-input"
                      type="text"
                      value={mcpRemoteUrl}
                      readOnly
                    />
                    <button className="mcp-url-redetect" onClick={() => {
                      invoke<string>('get_mcp_server_url').then(url => setMcpRemoteUrl(url)).catch(() => {});
                    }} title="重新检测">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                    </button>
                    <CopyBtn text={mcpRemoteUrl} idx={99} compact />
                  </div>

                  {mcpRemoteUrl.includes('localhost') && (
                    <div className="mcp-note-card">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>MCP 服务正在本机运行。如需局域网内其他设备访问，确保端口 3845 已放行，地址已自动检测为局域网 IP。</span>
                    </div>
                  )}

                  <div className="mcp-config-block">
                    <div className="mcp-config-head">
                      <span className="mcp-config-title">Claude Desktop</span>
                      <CopyBtn text={claudeDesktopConfig} idx={0} />
                    </div>
                    <pre className="mcp-code-block">{claudeDesktopConfig}</pre>
                    <span className="mcp-config-hint">位置：Claude Desktop → Settings → Developer → Edit Config → claude_desktop_config.json</span>
                  </div>

                  <div className="mcp-config-block">
                    <div className="mcp-config-head">
                      <span className="mcp-config-title">Cursor</span>
                      <CopyBtn text={cursorConfig} idx={1} />
                    </div>
                    <pre className="mcp-code-block">{cursorConfig}</pre>
                    <span className="mcp-config-hint">位置：~/.cursor/mcp.json（全局）或项目 .cursor/mcp.json（项目级）</span>
                  </div>

                  <div className="mcp-config-block">
                    <div className="mcp-config-head">
                      <span className="mcp-config-title">VS Code (Copilot MCP)</span>
                      <CopyBtn text={vscodeConfig} idx={2} />
                    </div>
                    <pre className="mcp-code-block">{vscodeConfig}</pre>
                    <span className="mcp-config-hint">位置：项目 .vscode/mcp.json 或在用户 settings.json 中添加</span>
                  </div>

                  <div className="mcp-config-block">
                    <div className="mcp-config-head">
                      <span className="mcp-config-title">OpenCode</span>
                      <CopyBtn text={openCodeConfig} idx={3} />
                    </div>
                    <pre className="mcp-code-block">{openCodeConfig}</pre>
                    <span className="mcp-config-hint">位置：项目 opencode.json 的 "mcp" 字段，或全局 ~/.config/opencode/opencode.json</span>
                  </div>
                </section>

                <section className="mcp-guide-section">
                  <h4>常用指令模板</h4>
                  <p className="mcp-guide-intro">以下是在 AI 工具中可以直接说的自然语言指令（点击右侧按钮复制整段指令）：</p>

                  <div className="mcp-cmd-list">
                    {commands.map((cmd, i) => {
                      const idx = i + 10;
                      return (
                        <div key={idx} className="mcp-cmd-card">
                          <div className="mcp-cmd-head">
                            <div>
                              <div className="mcp-cmd-title">{cmd.title}</div>
                              <div className="mcp-cmd-desc">{cmd.desc}</div>
                            </div>
                            <CopyBtn text={cmd.code} idx={idx} compact />
                          </div>
                          <pre className="mcp-cmd-code">{cmd.code}</pre>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="mcp-guide-section">
                  <h4>MCP 暴露的工具（Tools）</h4>
                  <p className="mcp-guide-intro">AI 工具也可直接调用以下函数名（用于结构化调用而非自然语言）：</p>
                  <div className="mcp-tools-table">
                    <div className="mcp-tools-row mcp-tools-header">
                      <span className="mcp-col-name">Tool 名称</span>
                      <span className="mcp-col-desc">说明</span>
                      <span className="mcp-col-params">关键参数</span>
                    </div>
                    {[
                      { name: 'generate_image', desc: '生成单张图片', params: 'prompt, size?, style?, model?, reference_images?, output_dir?, session_id?' },
                      { name: 'generate_images_parallel', desc: '并行生成多张', params: 'prompt, count, size?, style?, reference_images?, session_id?' },
                      { name: 'set_style', desc: '设置全局风格前缀', params: 'style' },
                      { name: 'set_output_dir', desc: '设置输出目录', params: 'output_dir' },
                      { name: 'set_config', desc: '更新运行时配置', params: 'model?, size?, style?, output_dir?' },
                      { name: 'get_status', desc: '查看当前状态', params: '无' },
                    ].map(t => (
                      <div key={t.name} className="mcp-tools-row">
                        <span className="mcp-col-name"><code>{t.name}</code></span>
                        <span className="mcp-col-desc">{t.desc}</span>
                        <span className="mcp-col-params">{t.params}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="mcp-guide-section">
                  <h4>提示</h4>
                  <ul className="mcp-guide-list">
                    <li>每次调用 MCP 生图后，本 app 内的 MCP 标签页会自动出现对应会话</li>
                    <li>使用 session_id 参数传入会话"标题"（即 MCP 标签页中看到的名称）可聚合多次调用到同一会话；相同标题 = 同一会话</li>
                    <li>输出目录留空时使用默认路径：mcp_conversations/&lt;session&gt;/images/</li>
                    <li>风格前缀是运行时临时状态，重启 MCP 服务后会重置</li>
                  </ul>
                </section>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
