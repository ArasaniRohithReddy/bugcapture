import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  REWIND_KEY_PREFIX,
  appendRewind,
  clearAllRewind,
  clearRewind,
  clearRewindForDomain,
  readRewind,
  rewindKey,
} from '../../src/core/rewindStore';

/** Minimal in-memory stand-in for `chrome.storage.local`. */
function installStorage(): Map<string, unknown> {
  const data = new Map<string, unknown>();
  const local = {
    get: (key: string | null) =>
      Promise.resolve(
        key === null ? Object.fromEntries(data) : data.has(key) ? { [key]: data.get(key) } : {},
      ),
    set: (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
      return Promise.resolve();
    },
    remove: (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key);
      return Promise.resolve();
    },
  };
  (globalThis as { chrome?: unknown }).chrome = { storage: { local } };
  return data;
}

describe('rewind buffer storage', () => {
  let data: Map<string, unknown>;

  beforeEach(() => {
    data = installStorage();
  });

  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('overwrites the same key instead of accumulating clips', async () => {
    await appendRewind(7, 'example.com', [{ timestamp: 1_000, value: 'a' }], 120_000, 1_000);
    await appendRewind(7, 'example.com', [{ timestamp: 2_000, value: 'b' }], 120_000, 2_000);
    const keys = [...data.keys()].filter((key) => key.startsWith(REWIND_KEY_PREFIX));
    expect(keys).toEqual([rewindKey(7)]);
    const stored = await readRewind(7);
    expect(stored?.events.map((event) => event.value)).toEqual(['a', 'b']);
  });

  it('drops events that fall outside the rolling window', async () => {
    await appendRewind(1, 'example.com', [{ timestamp: 0, value: 'old' }], 10_000, 0);
    const stored = await appendRewind(
      1,
      'example.com',
      [{ timestamp: 20_000, value: 'new' }],
      10_000,
      20_000,
    );
    expect(stored.events.map((event) => event.value)).toEqual(['new']);
  });

  it('starts a fresh clip when the tab navigates to another host', async () => {
    await appendRewind(2, 'example.com', [{ timestamp: 1_000, value: 'a' }], 120_000, 1_000);
    const stored = await appendRewind(
      2,
      'other.test',
      [{ timestamp: 2_000, value: 'b' }],
      120_000,
      2_000,
    );
    expect(stored.host).toBe('other.test');
    expect(stored.events.map((event) => event.value)).toEqual(['b']);
  });

  it('clears only the tabs of a de-consented domain', async () => {
    await appendRewind(5, 'example.com', [{ timestamp: 1, value: 'a' }], 120_000, 1);
    await appendRewind(6, 'app.example.com', [{ timestamp: 1, value: 'a' }], 120_000, 1);
    await appendRewind(8, 'other.test', [{ timestamp: 1, value: 'a' }], 120_000, 1);
    await clearRewindForDomain('example.com');
    expect(await readRewind(5)).toBeUndefined();
    expect(await readRewind(6)).toBeUndefined();
    expect(await readRewind(8)).toBeDefined();
  });

  it('clears a single tab and every tab', async () => {
    await appendRewind(3, 'example.com', [{ timestamp: 1, value: 'a' }], 120_000, 1);
    await appendRewind(4, 'example.com', [{ timestamp: 1, value: 'a' }], 120_000, 1);
    await clearRewind(3);
    expect(await readRewind(3)).toBeUndefined();
    expect(await readRewind(4)).toBeDefined();
    await clearAllRewind();
    expect(await readRewind(4)).toBeUndefined();
  });
});
