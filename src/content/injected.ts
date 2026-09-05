/**
 * MAIN-world capture script.
 *
 * Injected into the page's own JavaScript context so it can observe the real
 * `console`, `fetch` and `XMLHttpRequest` objects. It never touches extension
 * APIs; results are handed to the content script via `window.postMessage`.
 */
import { PAGE_MESSAGE_SOURCE, type ContentCommand, type PageMessage } from '../core/messages';
import { normalizeNetworkEvent, DEFAULT_MAX_BODY_BYTES } from '../core/network';
import { captureStack, formatArgs, serializeArgs } from '../core/serialize';
import type { ConsoleLogEntry, LogLevel, LogSource } from '../core/types';

declare global {
  interface Window {
    __bugcaptureInjected?: boolean;
  }
}

if (!window.__bugcaptureInjected) {
  window.__bugcaptureInjected = true;
  install();
}

function install(): void {
  const config = {
    console: true,
    network: true,
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    active: true,
  };

  let counter = 0;
  const nextId = (prefix: string): string => {
    counter += 1;
    return `${prefix}_${Date.now().toString(36)}_${counter}`;
  };

  const post = (message: PageMessage): void => {
    try {
      window.postMessage(message, window.location.origin === 'null' ? '*' : window.location.origin);
    } catch {
      // Never let reporting break the page.
    }
  };

  const emitConsole = (
    level: LogLevel,
    source: LogSource,
    args: unknown[],
    stack?: string,
  ): void => {
    if (!config.active || !config.console) return;
    const serialized = serializeArgs(args);
    const entry: ConsoleLogEntry = {
      id: nextId('log'),
      timestamp: Date.now(),
      level,
      args: serialized,
      text: formatArgs(serialized),
      source,
      url: location.href,
    };
    if (stack) entry.stack = stack;
    post({ source: PAGE_MESSAGE_SOURCE, kind: 'console', entry });
  };

  // --- console -------------------------------------------------------------
  const levels: LogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];
  for (const level of levels) {
    const original = console[level]?.bind(console);
    if (!original) continue;
    console[level] = (...args: unknown[]) => {
      const errorArg = args.find((arg): arg is Error => arg instanceof Error);
      emitConsole(
        level,
        'console',
        args,
        errorArg?.stack ?? (level === 'error' ? captureStack(1) : undefined),
      );
      original(...args);
    };
  }

  window.addEventListener('error', (event) => {
    const error = event.error as Error | undefined;
    emitConsole(
      'error',
      'window.onerror',
      [error?.message ?? event.message ?? 'Uncaught error'],
      error?.stack ?? `${event.filename}:${event.lineno}:${event.colno}`,
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown;
    const error = reason instanceof Error ? reason : undefined;
    emitConsole(
      'error',
      'unhandledrejection',
      [`Unhandled promise rejection: ${error ? error.message : String(reason)}`],
      error?.stack,
    );
  });

  // --- network -------------------------------------------------------------
  const emitNetwork = (event: Parameters<typeof normalizeNetworkEvent>[0]): void => {
    if (!config.active || !config.network) return;
    try {
      post({
        source: PAGE_MESSAGE_SOURCE,
        kind: 'network',
        entry: normalizeNetworkEvent({ ...event, maxBodyBytes: config.maxBodyBytes }),
      });
    } catch {
      // Ignore normalization failures.
    }
  };

  const readBody = async (body: unknown): Promise<string | undefined> => {
    if (body === undefined || body === null) return undefined;
    if (typeof body === 'string') return body;
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      return body.toString();
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      const parts: string[] = [];
      body.forEach((value, key) => {
        parts.push(`${key}=${typeof value === 'string' ? value : '[file]'}`);
      });
      return parts.join('&');
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) return `[Blob ${body.size} bytes]`;
    if (body instanceof ArrayBuffer) return `[ArrayBuffer ${body.byteLength} bytes]`;
    return undefined;
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function patchedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      if (!config.active || !config.network) return originalFetch.call(this, input, init);

      const startedAt = Date.now();
      const id = nextId('net');
      const request = input instanceof Request ? input : undefined;
      const url = request ? request.url : String(input);
      const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
      const requestHeaders = init?.headers ?? request?.headers;
      let requestBody: string | undefined;
      try {
        requestBody = await readBody(init?.body ?? undefined);
      } catch {
        requestBody = undefined;
      }

      try {
        const response = await originalFetch.call(this, input, init);
        let responseBody: string | undefined;
        try {
          responseBody = await response.clone().text();
        } catch {
          responseBody = undefined;
        }
        emitNetwork({
          id,
          initiator: 'fetch',
          method,
          url,
          startedAt,
          endedAt: Date.now(),
          status: response.status,
          statusText: response.statusText,
          requestHeaders,
          responseHeaders: response.headers,
          requestBody,
          responseBody,
          responseSize: responseBody ? responseBody.length : 0,
          baseUrl: location.href,
        });
        return response;
      } catch (error) {
        // Network failures and CORS rejections land here with no status.
        emitNetwork({
          id,
          initiator: 'fetch',
          method,
          url,
          startedAt,
          endedAt: Date.now(),
          status: 0,
          requestHeaders,
          requestBody,
          error: (error as Error)?.message ?? 'Network request failed',
          baseUrl: location.href,
        });
        throw error;
      }
    };
  }

  interface XhrMeta {
    id: string;
    method: string;
    url: string;
    startedAt: number;
    requestHeaders: Record<string, string>;
    requestBody?: string;
  }
  const xhrMeta = new WeakMap<XMLHttpRequest, XhrMeta>();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    xhrMeta.set(this, {
      id: nextId('net'),
      method: String(method).toUpperCase(),
      url: String(url),
      startedAt: Date.now(),
      requestHeaders: {},
    });
    return (originalOpen as any).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.setRequestHeader = function patchedSetHeader(
    this: XMLHttpRequest,
    name: string,
    value: string,
  ) {
    const meta = xhrMeta.get(this);
    if (meta) meta.requestHeaders[String(name).toLowerCase()] = String(value);
    return originalSetHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function patchedSend(this: XMLHttpRequest, body?: unknown) {
    const meta = xhrMeta.get(this);
    if (meta && config.active && config.network) {
      meta.startedAt = Date.now();
      void readBody(body)
        .then((text) => {
          meta.requestBody = text;
        })
        .catch(() => undefined);

      const finish = (error?: string) => {
        let responseBody: string | undefined;
        try {
          if (!this.responseType || this.responseType === 'text') {
            responseBody = this.responseText;
          } else if (this.responseType === 'json') {
            responseBody = JSON.stringify(this.response);
          }
        } catch {
          responseBody = undefined;
        }
        let responseHeaders = '';
        try {
          responseHeaders = this.getAllResponseHeaders();
        } catch {
          responseHeaders = '';
        }
        const event: Parameters<typeof normalizeNetworkEvent>[0] = {
          id: meta.id,
          initiator: 'xhr',
          method: meta.method,
          url: meta.url,
          startedAt: meta.startedAt,
          endedAt: Date.now(),
          status: this.status,
          statusText: this.statusText,
          requestHeaders: meta.requestHeaders,
          responseHeaders,
          responseBody,
          baseUrl: location.href,
        };
        if (meta.requestBody !== undefined) event.requestBody = meta.requestBody;
        if (error) event.error = error;
        emitNetwork(event);
      };

      this.addEventListener('load', () => finish());
      this.addEventListener('error', () => finish('Network request failed (or blocked by CORS)'));
      this.addEventListener('timeout', () => finish('Request timed out'));
      this.addEventListener('abort', () => finish('Request aborted'));
    }
    return (originalSend as any).call(this, body);
  } as typeof XMLHttpRequest.prototype.send;

  // --- commands from the content script ------------------------------------
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as ContentCommand | undefined;
    if (!data || data.source !== 'bugcapture:content') return;
    if (data.kind === 'configure') {
      config.console = data.console;
      config.network = data.network;
      config.maxBodyBytes = data.maxBodyBytes;
      config.active = true;
    } else if (data.kind === 'stop') {
      config.active = false;
    }
  });

  post({ source: PAGE_MESSAGE_SOURCE, kind: 'ready' });
}
