/**
 * Persistence for the Rewind buffer.
 *
 * The buffer lives in `chrome.storage.local` under a per-tab key and is
 * overwritten on every flush, so only the most recent window is ever on disk.
 * It is removed when the tab goes away, when consent is withdrawn, or when the
 * user deletes their data.
 */
import { RewindBuffer, REWIND_BUFFER_MS, domainMatches, type RewindEvent } from './rewind';

export const REWIND_KEY_PREFIX = 'bugcapture:rewind:';

export interface StoredRewind {
  host: string;
  updatedAt: number;
  events: RewindEvent<unknown>[];
}

export function rewindKey(tabId: number): string {
  return `${REWIND_KEY_PREFIX}${tabId}`;
}

export async function readRewind(tabId: number): Promise<StoredRewind | undefined> {
  const key = rewindKey(tabId);
  const stored = await chrome.storage.local.get(key);
  return stored[key] as StoredRewind | undefined;
}

export async function clearRewind(tabId: number): Promise<void> {
  await chrome.storage.local.remove(rewindKey(tabId));
}

/** Drop every buffered clip, e.g. when Rewind is switched off. */
export async function clearAllRewind(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(REWIND_KEY_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
}

/** Drop the buffered clips of one domain, leaving other tabs untouched. */
export async function clearRewindForDomain(domain: string): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.entries(all)
    .filter(([key, value]) => {
      if (!key.startsWith(REWIND_KEY_PREFIX)) return false;
      return domainMatches((value as StoredRewind | undefined)?.host ?? '', domain);
    })
    .map(([key]) => key);
  if (keys.length) await chrome.storage.local.remove(keys);
}

/**
 * Merge a batch of freshly recorded events into the tab's buffer, trim it to
 * the rolling window, and overwrite what was stored before.
 */
export async function appendRewind(
  tabId: number,
  host: string,
  events: readonly RewindEvent<unknown>[],
  bufferMs: number = REWIND_BUFFER_MS,
  now: number = Date.now(),
): Promise<StoredRewind> {
  const existing = await readRewind(tabId);
  const buffer = new RewindBuffer<unknown>(bufferMs);
  // A navigation to another host starts a new clip rather than mixing origins.
  if (existing && existing.host === host) buffer.pushAll(existing.events, now);
  buffer.pushAll(events, now);
  const next: StoredRewind = { host, updatedAt: now, events: buffer.entries() };
  await chrome.storage.local.set({ [rewindKey(tabId)]: next });
  return next;
}
