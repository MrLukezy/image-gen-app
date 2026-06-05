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
