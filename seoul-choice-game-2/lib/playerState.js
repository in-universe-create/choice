const STORAGE_KEY = "seoul-choice-save";

function normalizeState(state) {
  if (!state || typeof state !== "object") return state;
  const unique = (value) => Array.isArray(value) ? [...new Set(value.filter(Boolean))] : [];
  return {
    ...state,
    inventory: unique(state.inventory),
    abilities: unique(state.abilities),
    flags: unique(state.flags),
    keywords: unique(state.keywords),
    history: Array.isArray(state.history) ? state.history : [],
  };
}

export function loadPlayerState() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const normalized = normalizeState(JSON.parse(raw));
    // 기존 버전에서 저장된 중복 플래그/아이템/키워드도 불러오는 즉시 정리한다.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function savePlayerState(state) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
}

export function clearPlayerState() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
