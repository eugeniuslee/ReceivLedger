import { useSyncExternalStore } from 'react';

/** Per-browser display preferences. Never holds wallet, application or financial data. */
export interface Preferences {
  showBadges: boolean;
  textSize: 'default' | 'large';
  reduceMotion: boolean;
}
export const DEFAULT_PREFERENCES: Preferences = { showBadges: true, textSize: 'default', reduceMotion: false };
const KEY = 'receivledger:preferences:v1';
const listeners = new Set<() => void>();
let cache: Preferences | null = null;

function read(): Preferences {
  if (cache) return cache;
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    cache = { ...DEFAULT_PREFERENCES, ...(saved && typeof saved === 'object' ? saved : {}) };
  } catch { cache = { ...DEFAULT_PREFERENCES }; }
  return cache!;
}

/** Returns false when browser storage is unavailable (the change still applies until the page closes). */
export function savePreferences(next: Preferences): boolean {
  cache = next;
  listeners.forEach(listener => listener());
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); return true; } catch { return false; }
}

export function usePreferences() {
  const preferences = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, read, () => DEFAULT_PREFERENCES);
  return {
    preferences,
    update: (patch: Partial<Preferences>) => savePreferences({ ...preferences, ...patch }),
    reset: () => savePreferences({ ...DEFAULT_PREFERENCES }),
  };
}

/** Test helper: forget the in-memory copy so the next read comes from storage. */
export function resetPreferencesCache() { cache = null; }
