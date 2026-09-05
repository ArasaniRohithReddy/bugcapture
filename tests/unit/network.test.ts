import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_BODY_BYTES,
  groupFailures,
  isFailure,
  normalizeHeaders,
  normalizeNetworkEvent,
  parseRawHeaders,
  templatizeUrl,
  truncateBody,
} from '../../src/core/network';
import type { NetworkEntry } from '../../src/core/types';

describe('normalizeHeaders', () => {
  it('lower-cases names from plain objects', () => {
    expect(normalizeHeaders({ 'Content-Type': 'application/json' })).toEqual({
      'content-type': 'application/json',
    });
  });

  it('supports Headers instances, arrays and raw strings', () => {
    expect(normalizeHeaders(new Headers({ Accept: 'text/html' }))).toEqual({ accept: 'text/html' });
    expect(normalizeHeaders([['X-Trace', '1']])).toEqual({ 'x-trace': '1' });
    expect(normalizeHeaders('Content-Length: 12\r\nX-Trace: 9')).toEqual({
      'content-length': '12',
      'x-trace': '9',
    });
  });

  it('joins duplicated headers', () => {
    expect(
      normalizeHeaders([
        ['set-cookie', 'a=1'],
        ['Set-Cookie', 'b=2'],
      ]),
    ).toEqual({ 'set-cookie': 'a=1, b=2' });
  });

  it('returns an empty object for nullish input', () => {
    expect(normalizeHeaders(undefined)).toEqual({});
    expect(parseRawHeaders('')).toEqual({});
  });
});

describe('truncateBody', () => {
  it('leaves small bodies alone', () => {
    expect(truncateBody('hello')).toEqual({ body: 'hello', truncated: false });
  });

  it('truncates bodies over the limit and records the original size', () => {
    const result = truncateBody('a'.repeat(200), 50);
    expect(result.truncated).toBe(true);
    expect(result.body).toContain('truncated, original 200 bytes');
    expect(result.body.length).toBeLessThan(200);
  });

  it('defaults to 64KB', () => {
    expect(DEFAULT_MAX_BODY_BYTES).toBe(65536);
    expect(truncateBody('a'.repeat(65536)).truncated).toBe(false);
    expect(truncateBody('a'.repeat(65537)).truncated).toBe(true);
  });
});

describe('normalizeNetworkEvent', () => {
  it('normalizes a successful fetch', () => {
    const entry = normalizeNetworkEvent({
      id: 'net_1',
      initiator: 'fetch',
      method: 'post',
      url: '/api/users',
      baseUrl: 'https://app.test/page',
      startedAt: 1000,
      endedAt: 1250,
      status: 201,
      statusText: 'Created',
      requestHeaders: { 'Content-Type': 'application/json' },
      responseHeaders: 'x-request-id: abc',
      requestBody: '{"name":"x"}',
      responseBody: '{"id":1}',
    });

    expect(entry).toMatchObject({
      method: 'POST',
      url: 'https://app.test/api/users',
      status: 201,
      ok: true,
      duration: 250,
      requestHeaders: { 'content-type': 'application/json' },
      responseHeaders: { 'x-request-id': 'abc' },
    });
    expect(entry.requestBodyTruncated).toBeUndefined();
  });

  it('marks network/CORS failures as not ok', () => {
    const entry = normalizeNetworkEvent({
      id: 'net_2',
      initiator: 'xhr',
      url: 'https://api.test/x',
      startedAt: 0,
      endedAt: 10,
      status: 0,
      error: 'Network request failed (or blocked by CORS)',
    });
    expect(entry.ok).toBe(false);
    expect(entry.status).toBe(0);
    expect(isFailure(entry)).toBe(true);
  });

  it('flags truncated bodies', () => {
    const entry = normalizeNetworkEvent({
      id: 'net_3',
      initiator: 'fetch',
      url: 'https://api.test/x',
      startedAt: 0,
      status: 200,
      responseBody: 'a'.repeat(500),
      maxBodyBytes: 100,
    });
    expect(entry.responseBodyTruncated).toBe(true);
    expect(entry.duration).toBeUndefined();
  });

  it('treats 4xx and 5xx as failures but 3xx as ok', () => {
    const build = (status: number): NetworkEntry =>
      normalizeNetworkEvent({
        id: `n${status}`,
        initiator: 'fetch',
        url: 'https://a.test/',
        startedAt: 0,
        status,
      });
    expect(isFailure(build(302))).toBe(false);
    expect(isFailure(build(404))).toBe(true);
    expect(isFailure(build(500))).toBe(true);
  });
});

describe('grouping', () => {
  it('collapses ids and uuids in URLs', () => {
    expect(templatizeUrl('https://api.test/users/42/posts')).toBe(
      'https://api.test/users/:id/posts',
    );
    expect(templatizeUrl('https://api.test/a/2f1c8b2e-6d4a-4a54-9f42-7a1b6f0d1c33')).toBe(
      'https://api.test/a/:uuid',
    );
  });

  it('groups failures by endpoint template and status', () => {
    const entries = [1, 2, 3].map((id) =>
      normalizeNetworkEvent({
        id: `net_${id}`,
        initiator: 'fetch',
        method: 'GET',
        url: `https://api.test/users/${id}`,
        startedAt: 0,
        status: 500,
      }),
    );
    entries.push(
      normalizeNetworkEvent({
        id: 'net_ok',
        initiator: 'fetch',
        url: 'https://api.test/ping',
        startedAt: 0,
        status: 200,
      }),
    );

    const groups = groupFailures(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.count).toBe(3);
    expect(groups[0]!.endpoint).toBe('https://api.test/users/:id');
    expect(groups[0]!.samples).toHaveLength(3);
  });
});
