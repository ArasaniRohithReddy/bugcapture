/**
 * Rewind: a rolling buffer of the most recent rrweb events for the active tab
 * so a bug that has already happened can still be captured.
 *
 * The buffer is bounded by wall-clock time, is continuously overwritten and
 * lives only in `chrome.storage.local`. Nothing is ever uploaded: turning the
 * buffer into a report is always an explicit user action.
 */
import type { CaptureSettings } from './types';

/** Rolling window kept for the active tab. */
export const REWIND_BUFFER_MS = 2 * 60 * 1000;
/** Shortest clip the timeline cropper will produce. */
export const REWIND_MIN_CLIP_MS = 10 * 1000;
/** Hard cap on buffered events, so a noisy page cannot exhaust storage. */
export const REWIND_MAX_EVENTS = 20_000;

export interface RewindEvent<T> {
  timestamp: number;
  value: T;
}

/**
 * Time-bounded circular buffer. Events older than the window are dropped on
 * every push, so memory use is a function of the window, not of session length.
 */
export class RewindBuffer<T> {
  private events: RewindEvent<T>[] = [];
  readonly bufferMs: number;
  readonly maxEvents: number;

  constructor(bufferMs: number = REWIND_BUFFER_MS, maxEvents: number = REWIND_MAX_EVENTS) {
    this.bufferMs = Math.max(REWIND_MIN_CLIP_MS, bufferMs);
    this.maxEvents = Math.max(1, maxEvents);
  }

  push(value: T, timestamp: number = Date.now()): void {
    this.events.push({ value, timestamp });
    this.trim(timestamp);
  }

  pushAll(events: readonly RewindEvent<T>[], now: number = Date.now()): void {
    for (const event of events) this.events.push(event);
    this.events.sort((a, b) => a.timestamp - b.timestamp);
    this.trim(now);
  }

  /** Drop everything outside the rolling window and above the event cap. */
  trim(now: number = Date.now()): void {
    const cutoff = now - this.bufferMs;
    this.events = this.events.filter((event) => event.timestamp >= cutoff);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(this.events.length - this.maxEvents);
    }
  }

  entries(): RewindEvent<T>[] {
    return [...this.events];
  }

  values(): T[] {
    return this.events.map((event) => event.value);
  }

  /** Events inside `[from, to]`, used by the timeline cropper. */
  range(from: number, to: number): RewindEvent<T>[] {
    return this.events.filter((event) => event.timestamp >= from && event.timestamp <= to);
  }

  clear(): void {
    this.events = [];
  }

  get size(): number {
    return this.events.length;
  }

  get startedAt(): number | undefined {
    return this.events[0]?.timestamp;
  }

  get endedAt(): number | undefined {
    return this.events[this.events.length - 1]?.timestamp;
  }

  /** Wall-clock length of the buffered clip in milliseconds. */
  get durationMs(): number {
    if (this.events.length < 2) return 0;
    return (this.endedAt as number) - (this.startedAt as number);
  }
}

/** Normalise user input such as `https://Example.com/path` to `example.com`. */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return '';
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const host = withoutScheme.split(/[/?#]/)[0] ?? '';
  return host
    .replace(/^www\./, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

/** Extract a comparable host from a page URL, or `''` for non-web pages. */
export function hostFromUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return normalizeDomain(parsed.hostname);
  } catch {
    return '';
  }
}

/** A rule matches its own domain and any subdomain of it. */
export function domainMatches(host: string, rule: string): boolean {
  const target = normalizeDomain(host);
  const pattern = normalizeDomain(rule);
  if (!target || !pattern) return false;
  return target === pattern || target.endsWith(`.${pattern}`);
}

function matchesAny(host: string, rules: readonly string[]): boolean {
  return rules.some((rule) => domainMatches(host, rule));
}

export type RewindDenialReason =
  'disabled' | 'unsupported-page' | 'blocked-site' | 'no-site-consent';

export interface RewindDecision {
  allowed: boolean;
  host: string;
  reason?: RewindDenialReason;
}

/**
 * Decide whether the rolling buffer may run on a page.
 *
 * Consent is never implicit: the master toggle must be on *and* the site must
 * be on the always-allow list or the per-site opt-in list. The blocked list
 * wins over a per-site opt-in; always-allow wins over the blocked list so a
 * broad block rule can still have exceptions.
 */
export function evaluateRewind(settings: CaptureSettings, url: string | undefined): RewindDecision {
  const host = hostFromUrl(url);
  if (!settings.rewind) return { allowed: false, host, reason: 'disabled' };
  if (!host) return { allowed: false, host, reason: 'unsupported-page' };
  if (matchesAny(host, settings.rewindAlwaysAllowSites)) return { allowed: true, host };
  if (matchesAny(host, settings.rewindBlockedSites)) {
    return { allowed: false, host, reason: 'blocked-site' };
  }
  if (matchesAny(host, settings.rewindSites)) return { allowed: true, host };
  return { allowed: false, host, reason: 'no-site-consent' };
}

export function isRewindAllowed(settings: CaptureSettings, url: string | undefined): boolean {
  return evaluateRewind(settings, url).allowed;
}

export const REWIND_DENIAL_MESSAGES: Record<RewindDenialReason, string> = {
  disabled: 'Rewind is turned off. Enable it in settings to keep a rolling buffer.',
  'unsupported-page': 'Rewind only runs on http(s) pages.',
  'blocked-site': 'Rewind is blocked on this site.',
  'no-site-consent': 'Rewind is not enabled for this site yet.',
};

export interface RewindTrim {
  start: number;
  end: number;
}

/**
 * Clamp a user-chosen trim to the clip and to the ten-second minimum, growing
 * the selection outwards when the clip is long enough to allow it.
 */
export function clampTrim(
  clip: RewindTrim,
  selection: RewindTrim,
  minimumMs: number = REWIND_MIN_CLIP_MS,
): RewindTrim {
  const clipStart = Math.min(clip.start, clip.end);
  const clipEnd = Math.max(clip.start, clip.end);
  const clipLength = clipEnd - clipStart;
  // A clip shorter than the minimum cannot be trimmed at all.
  if (clipLength <= minimumMs) return { start: clipStart, end: clipEnd };

  let start = Math.min(Math.max(selection.start, clipStart), clipEnd);
  let end = Math.max(Math.min(selection.end, clipEnd), clipStart);
  if (end < start) [start, end] = [end, start];

  if (end - start < minimumMs) {
    end = start + minimumMs;
    if (end > clipEnd) {
      end = clipEnd;
      start = clipEnd - minimumMs;
    }
  }
  return { start, end };
}

/** Timestamp of an rrweb event (they carry their own `timestamp` field). */
export function eventTimestamp(event: unknown): number {
  const value = (event as { timestamp?: unknown } | null)?.timestamp;
  return typeof value === 'number' ? value : 0;
}

/**
 * Crop a timestamped event list to a trim selection, enforcing the minimum
 * clip length. Used both for buffered entries and for stored rrweb events.
 */
export function cropEvents<T>(
  events: readonly T[],
  selection: RewindTrim,
  getTimestamp: (event: T) => number = eventTimestamp,
  minimumMs: number = REWIND_MIN_CLIP_MS,
): { events: T[]; trim: RewindTrim } {
  if (events.length === 0) return { events: [], trim: { ...selection } };
  const stamps = events.map(getTimestamp);
  const clip = { start: Math.min(...stamps), end: Math.max(...stamps) };
  const trim = clampTrim(clip, selection, minimumMs);
  return {
    events: events.filter((event) => {
      const timestamp = getTimestamp(event);
      return timestamp >= trim.start && timestamp <= trim.end;
    }),
    trim,
  };
}

/** Add or remove a domain from one of the Rewind site lists. */
export function toggleDomain(list: readonly string[], domain: string): string[] {
  const normalized = normalizeDomain(domain);
  if (!normalized) return [...list];
  const without = list.filter((entry) => normalizeDomain(entry) !== normalized);
  return without.length === list.length ? [...without, normalized] : without;
}

/** Add a domain to a list, ignoring blanks and duplicates. */
export function addDomain(list: readonly string[], domain: string): string[] {
  const normalized = normalizeDomain(domain);
  if (!normalized) return [...list];
  if (list.some((entry) => normalizeDomain(entry) === normalized)) return [...list];
  return [...list, normalized];
}

export function removeDomain(list: readonly string[], domain: string): string[] {
  const normalized = normalizeDomain(domain);
  return list.filter((entry) => normalizeDomain(entry) !== normalized);
}
