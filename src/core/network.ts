/**
 * Normalizers shared by the network capture (MAIN world) and the UI.
 *
 * Keeping the normalization here means `fetch`, `XMLHttpRequest` and imported
 * HAR-like data all produce identical `NetworkEntry` shapes.
 */
import type { NetworkEntry, NetworkInitiator } from './types';

export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/** Lower-case header names and collapse duplicates the way the platform does. */
export function normalizeHeaders(input: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!input) return result;

  const add = (name: unknown, value: unknown) => {
    const key = String(name).trim().toLowerCase();
    if (!key) return;
    const text = String(value ?? '');
    result[key] = result[key] ? `${result[key]}, ${text}` : text;
  };

  if (typeof Headers !== 'undefined' && input instanceof Headers) {
    input.forEach((value, name) => add(name, value));
    return result;
  }
  if (Array.isArray(input)) {
    for (const pair of input) {
      if (Array.isArray(pair) && pair.length >= 2) add(pair[0], pair[1]);
    }
    return result;
  }
  if (typeof input === 'string') return parseRawHeaders(input);
  if (typeof input === 'object') {
    for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
      add(name, value);
    }
  }
  return result;
}

/** Parse the CRLF-delimited blob returned by `XMLHttpRequest.getAllResponseHeaders()`. */
export function parseRawHeaders(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const index = line.indexOf(':');
    if (index === -1) continue;
    const name = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (!name) continue;
    result[name] = result[name] ? `${result[name]}, ${value}` : value;
  }
  return result;
}

export function byteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return text.length;
}

export interface TruncatedBody {
  body: string;
  truncated: boolean;
}

/** Truncate a body to `maxBytes`, appending a marker when it was cut. */
export function truncateBody(
  body: string | undefined,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): TruncatedBody {
  if (!body) return { body: '', truncated: false };
  const size = byteLength(body);
  if (size <= maxBytes) return { body, truncated: false };
  // Byte budget is approximated with characters, then trimmed defensively.
  let sliced = body.slice(0, maxBytes);
  while (byteLength(sliced) > maxBytes && sliced.length > 0) {
    sliced = sliced.slice(0, Math.floor(sliced.length * 0.9));
  }
  return {
    body: `${sliced}… [truncated, original ${size} bytes]`,
    truncated: true,
  };
}

export function absoluteUrl(url: string, base?: string): string {
  try {
    return new URL(url, base ?? (typeof location !== 'undefined' ? location.href : undefined)).href;
  } catch {
    return url;
  }
}

export interface RawNetworkEvent {
  id: string;
  initiator: NetworkInitiator;
  method?: string;
  url: string;
  startedAt: number;
  endedAt?: number;
  status?: number;
  statusText?: string;
  requestHeaders?: unknown;
  responseHeaders?: unknown;
  requestBody?: string;
  responseBody?: string;
  responseSize?: number;
  error?: string;
  baseUrl?: string;
  maxBodyBytes?: number;
}

/** Turn a raw capture event into the canonical `NetworkEntry`. */
export function normalizeNetworkEvent(event: RawNetworkEvent): NetworkEntry {
  const maxBodyBytes = event.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const request = truncateBody(event.requestBody, maxBodyBytes);
  const response = truncateBody(event.responseBody, maxBodyBytes);
  const status = typeof event.status === 'number' ? event.status : 0;
  const duration =
    typeof event.endedAt === 'number' ? Math.max(0, Math.round(event.endedAt - event.startedAt)) : undefined;

  const entry: NetworkEntry = {
    id: event.id,
    initiator: event.initiator,
    method: (event.method || 'GET').toUpperCase(),
    url: absoluteUrl(event.url, event.baseUrl),
    startedAt: event.startedAt,
    status,
    statusText: event.statusText ?? '',
    // A status of 0 means the request never completed (network error / CORS).
    ok: status >= 200 && status < 400,
    requestHeaders: normalizeHeaders(event.requestHeaders),
    responseHeaders: normalizeHeaders(event.responseHeaders),
  };

  if (duration !== undefined) entry.duration = duration;
  if (request.body) {
    entry.requestBody = request.body;
    if (request.truncated) entry.requestBodyTruncated = true;
  }
  if (response.body) {
    entry.responseBody = response.body;
    if (response.truncated) entry.responseBodyTruncated = true;
  }
  if (typeof event.responseSize === 'number') entry.responseSize = event.responseSize;
  if (event.error) entry.error = event.error;
  return entry;
}

export function isFailure(entry: NetworkEntry): boolean {
  return Boolean(entry.error) || entry.status === 0 || entry.status >= 400;
}

export interface FailureGroup {
  key: string;
  method: string;
  /** Origin + pathname, with numeric/uuid path segments collapsed. */
  endpoint: string;
  status: number;
  count: number;
  samples: NetworkEntry[];
}

/** Collapse `/users/42` and `/users/43` onto the same endpoint template. */
export function templatizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname
      .split('/')
      .map((segment) => {
        if (/^\d+$/.test(segment)) return ':id';
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
          return ':uuid';
        }
        return segment;
      })
      .join('/');
    return `${parsed.origin}${path}`;
  } catch {
    return url;
  }
}

/** Group failing requests so the UI (and the AI prompt) stays compact. */
export function groupFailures(entries: readonly NetworkEntry[]): FailureGroup[] {
  const groups = new Map<string, FailureGroup>();
  for (const entry of entries) {
    if (!isFailure(entry)) continue;
    const endpoint = templatizeUrl(entry.url);
    const key = `${entry.method} ${endpoint} ${entry.status}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (existing.samples.length < 3) existing.samples.push(entry);
    } else {
      groups.set(key, {
        key,
        method: entry.method,
        endpoint,
        status: entry.status,
        count: 1,
        samples: [entry],
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
