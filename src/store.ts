export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  createdAt: string;
}

export const PROVIDER_PRESETS = [
  { value: "hfsy", label: "HFSY", baseUrl: "https://www.hfsyapi.cn/v1/images/generations" },
  { value: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1/images/generations" },
  { value: "siliconflow", label: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1/images/generations" },
  { value: "zhipu", label: "Zhipu (GLM-Image)", baseUrl: "https://open.bigmodel.cn/api/paas/v4/images/generations" },
  { value: "volcengine", label: "火山方舟 (即梦/Seedream)", baseUrl: "https://ark.cn-beijing.volces.com/api/v3/images/generations" },
  { value: "minimax", label: "MiniMax (Image-01)", baseUrl: "https://api.minimax.chat/v1/image_generation" },
  { value: "custom", label: "自定义", baseUrl: "" },
];

export function getProviders(): Provider[] {
  const raw = getLocal(PROVIDERS_KEY);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      // fallthrough
    }
  }
  return [];
}

export function saveProviders(providers: Provider[]) {
  setLocal(PROVIDERS_KEY, JSON.stringify(providers));
}

export function getActiveProviderId(): string | null {
  return getLocal(ACTIVE_PROVIDER_KEY);
}

export function saveActiveProviderId(id: string) {
  setLocal(ACTIVE_PROVIDER_KEY, id);
}

const STORE_KEY = 'image_gen_state';
const DEFAULT_API_URL = 'https://www.hfsyapi.cn/v1/images/generations';
const DEFAULT_MODEL = 'gpt-image-2';
const PROVIDERS_KEY = 'image_gen_providers';
const ACTIVE_PROVIDER_KEY = 'image_gen_active_provider';

export function getLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // quota exceeded
  }
}

export function removeLocal(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ──────────────────────────── App State ───────────────────────────────────

interface PersistedState {
  apiUrl: string;
  apiKey: string;
  model: string;
  activeProviderId?: string;
}

export function getAppConfig(): PersistedState {
  const raw = getLocal(STORE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const provId = parsed.activeProviderId || getActiveProviderId();
      return {
        apiUrl: parsed.apiUrl || DEFAULT_API_URL,
        apiKey: parsed.apiKey || '',
        model: parsed.model || DEFAULT_MODEL,
        activeProviderId: provId || undefined,
      };
    } catch {
      // fallthrough
    }
  }
  return { apiUrl: DEFAULT_API_URL, apiKey: '', model: DEFAULT_MODEL };
}

export function saveAppConfig(config: PersistedState) {
  setLocal(STORE_KEY, JSON.stringify(config));
  if (config.activeProviderId) {
    saveActiveProviderId(config.activeProviderId);
  }
}

// ──────────────────────────── Open Windows ────────────────────────────────

const OPEN_WINDOWS_KEY = 'image_gen_open_windows';

export function getOpenWindowConvIds(): string[] {
  const raw = getLocal(OPEN_WINDOWS_KEY);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      // fallthrough
    }
  }
  return [];
}

export function saveOpenWindowConvIds(ids: string[]) {
  setLocal(OPEN_WINDOWS_KEY, JSON.stringify(ids));
}

// ──────────────────────────── Current Conv ID ────────────────────────────

const CURR_CONV_KEY = 'image_gen_current_conv';

export function getCurrConvId(): string | null {
  return getLocal(CURR_CONV_KEY);
}

export function setCurrConvId(id: string) {
  setLocal(CURR_CONV_KEY, id);
}

// ──────────────────────────── Custom Presets ────────────────────────────────

const CUSTOM_PRESETS_KEY = 'image_gen_custom_presets';

export function getCustomPresets(): { label: string; value: string }[] {
  const raw = getLocal(CUSTOM_PRESETS_KEY);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      // fallthrough
    }
  }
  return [];
}

export function saveCustomPresets(presets: { label: string; value: string }[]) {
  setLocal(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
}

// ──────────────────────────── MCP Config ──────────────────────────────────

export interface McpConfig {
  providerId: string;
  defaultSize: string;
  stylePrefix: string;
  outputDir: string;
  autoStart: boolean;
}

const MCP_CONFIG_KEY = 'image_gen_mcp_config';

export function getMcpConfig(): McpConfig {
  const raw = getLocal(MCP_CONFIG_KEY);
  if (raw) {
    try {
      const cfg = JSON.parse(raw);
      return {
        providerId: cfg.providerId || '',
        defaultSize: cfg.defaultSize || '1024x1024',
        stylePrefix: cfg.stylePrefix || '',
        outputDir: cfg.outputDir || '',
        autoStart: cfg.autoStart ?? false,
      };
    } catch {}
  }
  return { providerId: '', defaultSize: '1024x1024', stylePrefix: '', outputDir: '', autoStart: false };
}

export function saveMcpConfig(config: McpConfig) {
  setLocal(MCP_CONFIG_KEY, JSON.stringify(config));
}

// ──────────────────────────── LLM Config ──────────────────────────────────

export interface LlmConfig {
  providerId: string;
  model: string;
}

const LLM_CONFIG_KEY = 'image_gen_llm_config';

export function getLlmConfig(): LlmConfig {
  const raw = getLocal(LLM_CONFIG_KEY);
  if (raw) {
    try {
      const cfg = JSON.parse(raw);
      return {
        providerId: cfg.providerId || '',
        model: cfg.model || 'gpt-4o',
      };
    } catch {}
  }
  return { providerId: '', model: 'gpt-4o' };
}

export function saveLlmConfig(config: LlmConfig) {
  setLocal(LLM_CONFIG_KEY, JSON.stringify(config));
}

// ──────────────────────────── Favorites ──────────────────────────────────

const FAVORITES_KEY = 'image_gen_favorites';
const FAVORITE_FOLDERS_KEY = 'image_gen_favorite_folders';

export interface StoredFavorite {
  id: string;
  imageUrl: string;
  folderId: string;
  name?: string;
  tags?: string[];
  sourceConversationId?: string;
  sourceEntryId?: string;
  createdAt: number;
}

export interface StoredFavoriteFolder {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  createdAt: number;
}

const DEFAULT_FOLDERS: StoredFavoriteFolder[] = [
  { id: 'chars', name: '角色管理', icon: '👤', description: '管理游戏角色立绘、头像等', createdAt: Date.now() },
  { id: 'scenes', name: '场景', icon: '🏞️', description: '管理场景、背景图片', createdAt: Date.now() },
  { id: 'items', name: '道具', icon: '🎁', description: '管理道具、UI素材图片', createdAt: Date.now() },
];

export function getFavoriteFolders(): StoredFavoriteFolder[] {
  const raw = getLocal(FAVORITE_FOLDERS_KEY);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    } catch {}
  }
  saveFavoriteFolders(DEFAULT_FOLDERS);
  return DEFAULT_FOLDERS;
}

export function saveFavoriteFolders(folders: StoredFavoriteFolder[]) {
  setLocal(FAVORITE_FOLDERS_KEY, JSON.stringify(folders));
}

export function getFavorites(): StoredFavorite[] {
  const raw = getLocal(FAVORITES_KEY);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {}
  }
  return [];
}

export function saveFavorites(favorites: StoredFavorite[]) {
  setLocal(FAVORITES_KEY, JSON.stringify(favorites));
}

export function addFavorite(item: StoredFavorite) {
  const all = getFavorites();
  all.push(item);
  saveFavorites(all);
}

export function removeFavorite(id: string) {
  const all = getFavorites().filter(f => f.id !== id);
  saveFavorites(all);
}

export function updateFavorite(id: string, updates: Partial<StoredFavorite>) {
  const all = getFavorites().map(f => f.id === id ? { ...f, ...updates } : f);
  saveFavorites(all);
}

// ──────────────────────────── Extract Sessions ──────────────────────────

const EXTRACT_SESSIONS_KEY = 'image_gen_extract_sessions';

export function getExtractSessions(): unknown[] {
  const raw = getLocal(EXTRACT_SESSIONS_KEY);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {}
  }
  return [];
}

export function saveExtractSessions(sessions: unknown[]) {
  setLocal(EXTRACT_SESSIONS_KEY, JSON.stringify(sessions));
}

// ──────────────────────────── Video Conversations ────────────────────────

const VIDEO_CONVERSATIONS_KEY = 'image_gen_video_conversations';

export function getVideoConversations(): unknown[] {
  const raw = getLocal(VIDEO_CONVERSATIONS_KEY);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {}
  }
  return [];
}

export function saveVideoConversations(sessions: unknown[]) {
  setLocal(VIDEO_CONVERSATIONS_KEY, JSON.stringify(sessions));
}
