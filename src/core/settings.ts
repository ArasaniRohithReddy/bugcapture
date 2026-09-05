/** Settings storage backed by `chrome.storage.local`. */
import type { Settings } from './types';
import { DEFAULT_MAX_BODY_BYTES } from './network';
import { DEFAULT_REDACTION } from './redact';

export const SETTINGS_KEY = 'bugcapture:settings';

export const DEFAULT_SETTINGS: Settings = {
  capture: {
    video: true,
    microphone: false,
    console: true,
    network: true,
    replay: true,
    screenshotOnStop: true,
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    maskAllInputs: true,
    blockSelectors: ['[data-bugcapture="ignore"]'],
    maskSelectors: [],
    rewind: false,
    rewindBufferSeconds: 120,
    rewindSites: [],
    rewindBlockedSites: [],
    rewindAlwaysAllowSites: [],
  },
  redaction: { ...DEFAULT_REDACTION },
  exportFolder: '',
  retentionDays: 30,
  theme: 'system',
};

type Plain = Record<string, unknown>;

/** Deep-merge stored settings over the defaults so new keys are picked up. */
export function mergeSettings<T>(defaults: T, stored: unknown): T {
  if (stored === undefined || stored === null) return defaults;
  if (Array.isArray(defaults) || Array.isArray(stored)) return (stored as T) ?? defaults;
  if (typeof defaults !== 'object' || typeof stored !== 'object') return stored as T;

  const result: Plain = { ...(defaults as unknown as Plain) };
  for (const [key, value] of Object.entries(stored as Plain)) {
    if (!(key in result)) continue;
    result[key] = mergeSettings((defaults as unknown as Plain)[key], value);
  }
  return result as unknown as T;
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(DEFAULT_SETTINGS, stored[SETTINGS_KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = mergeSettings(current, patch as unknown);
  await saveSettings(next);
  return next;
}

export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
    listener(mergeSettings(DEFAULT_SETTINGS, changes[SETTINGS_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
