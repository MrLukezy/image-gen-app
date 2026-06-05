const STORE_KEY = 'image_gen_state';
const DEFAULT_API_URL = 'https://www.hfsyapi.cn/v1/images/generations';
const DEFAULT_MODEL = 'gpt-image-2';

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
}

export function getAppConfig(): PersistedState {
  const raw = getLocal(STORE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return {
        apiUrl: parsed.apiUrl || DEFAULT_API_URL,
        apiKey: parsed.apiKey || '',
        model: parsed.model || DEFAULT_MODEL,
      };
    } catch {
      // fallthrough
    }
  }
  return { apiUrl: DEFAULT_API_URL, apiKey: '', model: DEFAULT_MODEL };
}

export function saveAppConfig(config: PersistedState) {
  setLocal(STORE_KEY, JSON.stringify(config));
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
