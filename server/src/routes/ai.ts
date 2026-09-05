import { Router } from 'express';
import type { Config } from '../config.js';
import { authMiddleware } from '../middleware/auth.js';
import { createRateLimitMiddleware } from '../middleware/rate-limit.js';
import { AiGenerateSchema } from '../schemas.js';

export function aiRouter(config: Config): Router {
  const router = Router();

  const rateLimitMiddleware = createRateLimitMiddleware();

  router.post(
    '/api/ai/generate',
    authMiddleware(config, true),
    rateLimitMiddleware,
    async (req, res): Promise<void> => {
      try {
        // Determine provider
        const provider = resolveProvider(config);
        if (!provider) {
          res.status(503).json({
            error: 'No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.',
          });
          return;
        }

        const parsed = AiGenerateSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: 'Invalid request body.',
            details: parsed.error.issues.map((i) => i.message),
          });
          return;
        }

        const { system, user, model, stream } = parsed.data;

        if (provider === 'openai') {
          await handleOpenAi(config, system, user, model, stream, res);
        } else {
          await handleAnthropic(config, system, user, model, stream, res);
        }
      } catch (err) {
        console.error('AI proxy error:', err);
        if (!res.headersSent) {
          res.status(502).json({ error: 'AI provider request failed.' });
        }
      }
    },
  );

  return router;
}

function resolveProvider(config: Config): 'openai' | 'anthropic' | null {
  if (config.aiProvider === 'openai' && config.openaiApiKey) return 'openai';
  if (config.aiProvider === 'anthropic' && config.anthropicApiKey) return 'anthropic';
  if (config.aiProvider === 'auto') {
    if (config.openaiApiKey) return 'openai';
    if (config.anthropicApiKey) return 'anthropic';
  }
  return null;
}

async function handleOpenAi(
  config: Config,
  system: string,
  user: string,
  model: string,
  stream: boolean,
  res: import('express').Response,
): Promise<void> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + config.openaiApiKey,
    },
    body: JSON.stringify({
      model,
      stream,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!response.ok) {
    const status = response.status === 429 ? 429 : 502;
    res.status(status).json({ error: 'AI provider request failed.' });
    return;
  }

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body?.getReader();
    if (!reader) {
      res.status(502).json({ error: 'No response body from provider.' });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx = buffer.indexOf('\n');
        while (idx !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);

          if (line.startsWith('data:')) {
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') {
              res.write('data: [DONE]\n\n');
            } else {
              try {
                const json = JSON.parse(payload) as {
                  choices?: Array<{ delta?: { content?: string } }>;
                };
                const delta = json.choices?.[0]?.delta?.content ?? '';
                if (delta) {
                  res.write(`data: ${JSON.stringify({ delta })}\n\n`);
                }
              } catch {
                // skip malformed chunks
              }
            }
          }
          idx = buffer.indexOf('\n');
        }
      }
    } finally {
      res.end();
    }
  } else {
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };
    res.json({
      text: data.choices?.[0]?.message?.content ?? '',
      model: data.model ?? model,
    });
  }
}

async function handleAnthropic(
  config: Config,
  system: string,
  user: string,
  model: string,
  stream: boolean,
  res: import('express').Response,
): Promise<void> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      stream,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!response.ok) {
    const status = response.status === 429 ? 429 : 502;
    res.status(status).json({ error: 'AI provider request failed.' });
    return;
  }

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body?.getReader();
    if (!reader) {
      res.status(502).json({ error: 'No response body from provider.' });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx = buffer.indexOf('\n');
        while (idx !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);

          if (line.startsWith('data:')) {
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') {
              res.write('data: [DONE]\n\n');
            } else {
              try {
                const json = JSON.parse(payload) as {
                  type?: string;
                  delta?: { text?: string };
                };
                if (json.type === 'content_block_delta' && json.delta?.text) {
                  res.write(`data: ${JSON.stringify({ delta: json.delta.text })}\n\n`);
                }
                if (json.type === 'message_stop') {
                  res.write('data: [DONE]\n\n');
                }
              } catch {
                // skip
              }
            }
          }
          idx = buffer.indexOf('\n');
        }
      }
    } finally {
      res.end();
    }
  } else {
    const data = (await response.json()) as {
      content?: Array<{ text?: string }>;
      model?: string;
    };
    res.json({
      text: (data.content ?? []).map((p) => p.text ?? '').join(''),
      model: data.model ?? model,
    });
  }
}
