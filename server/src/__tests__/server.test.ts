import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>['app'];
let dataDir: string;
const AUTH_TOKEN = 'test-secret-token-12345';

function bearerHeader(token: string): string {
  return ['Bearer', token].join(' ');
}

beforeAll(async () => {
  dataDir = join(process.cwd(), '.test-data-' + Date.now());
  const result = createApp({
    authToken: AUTH_TOKEN,
    dataDir,
    publicUrl: 'http://localhost:3000',
    openaiApiKey: '',
    anthropicApiKey: '',
    aiProvider: 'auto',
  } as never);
  app = result.app;
});

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('GET /api/health', () => {
  it('returns ok and version', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('version');
  });
});

describe('Auth', () => {
  it('rejects POST /api/reports without token', async () => {
    const res = await request(app).post('/api/reports');
    expect(res.status).toBe(401);
  });

  it('rejects POST /api/reports with wrong token', async () => {
    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', bearerHeader('wrong-token'));
    expect(res.status).toBe(403);
  });

  it('rejects POST /api/ai/generate without token', async () => {
    const res = await request(app).post('/api/ai/generate').send({ system: 'x', user: 'y' });
    expect(res.status).toBe(401);
  });
});

describe('Report upload and retrieval', () => {
  let reportId: string;

  it('uploads a report', async () => {
    const reportJson = JSON.stringify({
      id: 'client-id-123',
      title: 'Test bug',
      createdAt: Date.now(),
      description: 'Something broke',
      severity: 'high',
      url: 'https://example.com',
      environment: {
        browser: 'Chrome',
        browserVersion: '120',
        os: 'Linux',
        userAgent: 'test',
        viewport: { width: 1920, height: 1080 },
      },
      console: [
        {
          id: 'c1',
          timestamp: Date.now(),
          level: 'error',
          args: ['err'],
          text: 'Error!',
          source: 'console',
        },
      ],
      network: [],
      media: [],
      ai: [],
      tags: [],
    });

    const replayJson = JSON.stringify([{ type: 0, data: {} }]);

    const pngPixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRElFTkSuQmCC',
      'base64',
    );

    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', bearerHeader(AUTH_TOKEN))
      .attach('report', Buffer.from(reportJson), {
        filename: 'report.json',
        contentType: 'application/json',
      })
      .attach('replay', Buffer.from(replayJson), {
        filename: 'replay.json',
        contentType: 'application/json',
      })
      .attach('media', pngPixel, {
        filename: 'screenshot.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('url');
    reportId = res.body.id;
  });

  it('retrieves the HTML viewer', async () => {
    const res = await request(app).get(`/api/reports/${reportId}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Test bug');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('retrieves the raw report JSON', async () => {
    const res = await request(app).get(`/api/reports/${reportId}/report.json`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body.title).toBe('Test bug');
  });

  it('retrieves media file', async () => {
    const res = await request(app).get(`/api/reports/${reportId}/media/screenshot.png`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });

  it('returns 404 for missing report', async () => {
    const res = await request(app).get('/api/reports/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('XSS prevention', () => {
  it('escapes malicious title in viewer HTML', async () => {
    const reportJson = JSON.stringify({
      id: 'xss-test',
      title: '<script>alert("xss")</script>',
      createdAt: Date.now(),
      description: '<img onerror="alert(1)" src=x>',
      severity: 'low',
    });

    const uploadRes = await request(app)
      .post('/api/reports')
      .set('Authorization', bearerHeader(AUTH_TOKEN))
      .attach('report', Buffer.from(reportJson), {
        filename: 'report.json',
        contentType: 'application/json',
      });

    expect(uploadRes.status).toBe(201);

    const viewRes = await request(app).get(`/api/reports/${uploadRes.body.id}`);
    expect(viewRes.status).toBe(200);
    expect(viewRes.text).not.toContain('<script>alert("xss")</script>');
    expect(viewRes.text).toContain('&lt;script&gt;');
    expect(viewRes.text).not.toContain('onerror="alert(1)"');
  });
});

describe('Rate limiting', () => {
  it('blocks after too many requests', async () => {
    const freshResult = createApp({
      authToken: AUTH_TOKEN,
      dataDir,
      openaiApiKey: 'fake-key',
      anthropicApiKey: '',
      aiProvider: 'openai',
    } as never);

    const results = [];
    for (let i = 0; i < 25; i++) {
      const res = await request(freshResult.app)
        .post('/api/ai/generate')
        .set('Authorization', bearerHeader(AUTH_TOKEN))
        .send({ system: 'test', user: 'test' });
      results.push(res.status);
    }

    expect(results.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});

describe('AI proxy', () => {
  it('returns 503 when no provider key is configured', async () => {
    const res = await request(app)
      .post('/api/ai/generate')
      .set('Authorization', bearerHeader(AUTH_TOKEN))
      .set('Content-Type', 'application/json')
      .send({ system: 'test', user: 'test' });
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('No AI provider configured');
  });

  describe('with mocked fetch', () => {
    let aiApp: ReturnType<typeof createApp>['app'];

    beforeAll(() => {
      const result = createApp({
        authToken: AUTH_TOKEN,
        dataDir,
        openaiApiKey: 'fake-openai-key',
        anthropicApiKey: '',
        aiProvider: 'openai',
      } as never);
      aiApp = result.app;
    });

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('proxies non-streaming OpenAI response', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Hello from AI' } }],
        model: 'gpt-4o-mini',
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const res = await request(aiApp)
        .post('/api/ai/generate')
        .set('Authorization', bearerHeader(AUTH_TOKEN))
        .send({ system: 'You are helpful', user: 'Say hi', stream: false });

      expect(res.status).toBe(200);
      expect(res.body.text).toBe('Hello from AI');
      expect(res.body.model).toBe('gpt-4o-mini');
    });

    it('proxies streaming OpenAI response as SSE', async () => {
      const sseBody =
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
        'data: [DONE]\n\n';

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(sseBody, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      );

      const res = await request(aiApp)
        .post('/api/ai/generate')
        .set('Authorization', bearerHeader(AUTH_TOKEN))
        .send({ system: 'You are helpful', user: 'Say hi', stream: true });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.text).toContain('data: {"delta":"Hello"}');
      expect(res.text).toContain('data: {"delta":" world"}');
      expect(res.text).toContain('data: [DONE]');
    });
  });
});
