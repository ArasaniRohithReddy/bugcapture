/**
 * AI provider client.
 *
 * Three modes are supported and selected in Options:
 *   - `proxy`  (default) — the self-hosted BugCapture backend holds the key.
 *   - `ollama`           — a local model, nothing leaves the machine.
 *   - `direct`           — the user's own key, stored in chrome.storage.local.
 *
 * No API key is ever bundled with the extension.
 */
import type { AiSettings, BackendSettings } from '../core/types';
import type { AiPrompt } from './prompt';

export interface AiRunOptions {
  prompt: AiPrompt;
  ai: AiSettings;
  backend: BackendSettings;
  signal?: AbortSignal;
  /** Called with each streamed chunk when streaming is enabled. */
  onToken?: (chunk: string) => void;
}

export interface AiResult {
  text: string;
  provider: string;
  model: string;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

const AUTH_SCHEME = 'Bearer';

/** Build an HTTP authorization header value. */
function bearer(token: string): string {
  return AUTH_SCHEME + ' ' + token;
}

function friendlyError(status: number, body: string): AiError {
  if (status === 401 || status === 403) {
    return new AiError('AI request rejected: invalid or missing credentials.', status);
  }
  if (status === 429) {
    return new AiError('AI provider rate limit reached. Try again in a moment.', status);
  }
  if (status === 413) {
    return new AiError('Payload too large for the AI provider. Reduce the captured data.', status);
  }
  const detail = body.slice(0, 300);
  return new AiError(`AI request failed (${status})${detail ? `: ${detail}` : ''}`, status);
}

/** Iterate over a response body line by line (SSE and NDJSON share this). */
async function* readLines(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      yield buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

type DeltaExtractor = (data: unknown) => string;

async function consumeStream(
  response: Response,
  extract: DeltaExtractor,
  sse: boolean,
  onToken?: (chunk: string) => void,
): Promise<string> {
  let text = '';
  for await (const line of readLines(response)) {
    if (!line.trim()) continue;
    let payload = line;
    if (sse) {
      if (!line.startsWith('data:')) continue;
      payload = line.slice(5).trim();
      if (payload === '[DONE]') break;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    const chunk = extract(parsed);
    if (chunk) {
      text += chunk;
      onToken?.(chunk);
    }
  }
  return text;
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  const body = await response.text().catch(() => '');
  throw friendlyError(response.status, body);
}

async function runProxy(options: AiRunOptions): Promise<AiResult> {
  const { prompt, ai, backend, signal, onToken } = options;
  if (!backend.endpoint) {
    throw new AiError('No backend endpoint configured. Set one in Options, or switch AI mode.');
  }
  const streaming = ai.streaming && Boolean(onToken);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (backend.token) headers.authorization = bearer(backend.token);

  const response = await fetch(`${backend.endpoint.replace(/\/$/, '')}/api/ai/generate`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      system: prompt.system,
      user: prompt.user,
      model: ai.model,
      stream: streaming,
    }),
  });
  await ensureOk(response);

  if (streaming) {
    const text = await consumeStream(
      response,
      (data) => (data as { delta?: string }).delta ?? '',
      true,
      onToken,
    );
    return { text, provider: 'proxy', model: ai.model };
  }
  const data = (await response.json()) as { text?: string; model?: string };
  return { text: data.text ?? '', provider: 'proxy', model: data.model ?? ai.model };
}

async function runOllama(options: AiRunOptions): Promise<AiResult> {
  const { prompt, ai, signal, onToken } = options;
  const streaming = ai.streaming && Boolean(onToken);
  const response = await fetch(`${ai.ollamaEndpoint.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: ai.model,
      stream: streaming,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
  });
  await ensureOk(response);

  if (streaming) {
    const text = await consumeStream(
      response,
      (data) => (data as { message?: { content?: string } }).message?.content ?? '',
      false,
      onToken,
    );
    return { text, provider: 'ollama', model: ai.model };
  }
  const data = (await response.json()) as { message?: { content?: string } };
  return { text: data.message?.content ?? '', provider: 'ollama', model: ai.model };
}

async function runDirectOpenAi(options: AiRunOptions): Promise<AiResult> {
  const { prompt, ai, signal, onToken } = options;
  const streaming = ai.streaming && Boolean(onToken);
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: bearer(ai.directApiKey),
    },
    signal,
    body: JSON.stringify({
      model: ai.model,
      stream: streaming,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
  });
  await ensureOk(response);

  if (streaming) {
    const text = await consumeStream(
      response,
      (data) =>
        (data as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta
          ?.content ?? '',
      true,
      onToken,
    );
    return { text, provider: 'openai', model: ai.model };
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return { text: data.choices?.[0]?.message?.content ?? '', provider: 'openai', model: ai.model };
}

async function runDirectAnthropic(options: AiRunOptions): Promise<AiResult> {
  const { prompt, ai, signal, onToken } = options;
  const streaming = ai.streaming && Boolean(onToken);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ai.directApiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    signal,
    body: JSON.stringify({
      model: ai.model,
      max_tokens: 1500,
      stream: streaming,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    }),
  });
  await ensureOk(response);

  if (streaming) {
    const text = await consumeStream(
      response,
      (data) => (data as { delta?: { text?: string } }).delta?.text ?? '',
      true,
      onToken,
    );
    return { text, provider: 'anthropic', model: ai.model };
  }
  const data = (await response.json()) as { content?: Array<{ text?: string }> };
  return {
    text: (data.content ?? []).map((part) => part.text ?? '').join(''),
    provider: 'anthropic',
    model: ai.model,
  };
}

/** Run a prompt against the configured provider. */
export async function runAi(options: AiRunOptions): Promise<AiResult> {
  const { ai } = options;
  if (!ai.enabled) throw new AiError('AI features are disabled in Options.');
  if (!ai.consentGivenAt) throw new AiError('AI consent has not been granted yet.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ai.timeoutMs || 60_000);
  const externalSignal = options.signal;
  externalSignal?.addEventListener('abort', () => controller.abort(), { once: true });
  const request = { ...options, signal: controller.signal };

  try {
    switch (ai.mode) {
      case 'ollama':
        return await runOllama(request);
      case 'direct':
        if (!ai.directApiKey) throw new AiError('No API key configured for direct mode.');
        return ai.directVendor === 'anthropic'
          ? await runDirectAnthropic(request)
          : await runDirectOpenAi(request);
      case 'proxy':
      default:
        return await runProxy(request);
    }
  } catch (error) {
    if (error instanceof AiError) throw error;
    if ((error as Error)?.name === 'AbortError') {
      throw new AiError('AI request timed out or was cancelled.');
    }
    throw new AiError(
      `Could not reach the AI provider: ${(error as Error)?.message ?? 'unknown error'}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** Origins the extension must be granted before AI can be used. */
export function requiredOriginsForAi(ai: AiSettings, backend: BackendSettings): string[] {
  const origins: string[] = [];
  const add = (url: string) => {
    try {
      origins.push(`${new URL(url).origin}/*`);
    } catch {
      // Ignore unparsable URLs; the UI validates them separately.
    }
  };
  if (ai.mode === 'proxy' && backend.endpoint) add(backend.endpoint);
  if (ai.mode === 'ollama' && ai.ollamaEndpoint) add(ai.ollamaEndpoint);
  if (ai.mode === 'direct') {
    origins.push(
      ai.directVendor === 'anthropic' ? 'https://api.anthropic.com/*' : 'https://api.openai.com/*',
    );
  }
  return origins;
}
