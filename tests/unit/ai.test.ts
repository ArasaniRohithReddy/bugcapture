import { describe, expect, it } from 'vitest';
import {
  buildAiPayload,
  buildErrorExplanationPrompt,
  buildNetworkSummaryPrompt,
  buildReportPrompt,
  payloadPreview,
} from '../../src/ai/prompt';
import { parseGeneratedReport } from '../../src/ai/parse';
import { findSimilarReports } from '../../src/ai/similarity';
import { emptyEnvironment } from '../../src/core/env';
import { normalizeNetworkEvent } from '../../src/core/network';
import { REDACTED } from '../../src/core/redact';
import type { BugReport, ConsoleLogEntry } from '../../src/core/types';

const SECRET = ['ey' + 'J' + 'hbGciOiJIUzI1NiJ9', 'eyJzdWIiOiI0MiJ9', 'Fak3Sign4tureValue00'].join(
  '.',
);

function log(
  level: ConsoleLogEntry['level'],
  text: string,
  timestamp = 0,
  stack?: string,
): ConsoleLogEntry {
  const entry: ConsoleLogEntry = {
    id: `log_${level}_${timestamp}`,
    timestamp,
    level,
    args: [text],
    text,
    source: 'console',
  };
  if (stack) entry.stack = stack;
  return entry;
}

function makeReport(overrides: Partial<BugReport> = {}): BugReport {
  return {
    id: 'report_1',
    createdAt: 0,
    updatedAt: 0,
    title: 'Checkout crashes',
    description: 'It breaks',
    severity: 'high',
    stepsToReproduce: '',
    expectedBehavior: '',
    actualBehavior: '',
    url: 'https://shop.test/checkout',
    environment: { ...emptyEnvironment('1.0.0'), browser: 'Chrome', browserVersion: '120', os: 'macOS' },
    console: [],
    network: [],
    replayEvents: [],
    media: [],
    ai: [],
    tags: [],
    ...overrides,
  };
}

describe('buildAiPayload', () => {
  it('redacts everything that leaves the browser', () => {
    const report = makeReport({
      title: `Fails for dev@example.com`,
      console: [log('error', `auth token ${SECRET} rejected`)],
      network: [
        normalizeNetworkEvent({
          id: 'net_1',
          initiator: 'fetch',
          url: 'https://api.test/login',
          startedAt: 0,
          status: 401,
          requestHeaders: { authorization: `token ${SECRET}` },
          responseBody: `{"token":"${SECRET}"}`,
        }),
      ],
    });

    const payload = buildAiPayload(report, `my key is ${SECRET}`);
    const serialized = payloadPreview(payload);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('dev@example.com');
    expect(serialized).toContain(REDACTED);
  });

  it('prioritizes errors and failing requests, and caps the payload', () => {
    const report = makeReport({
      console: [
        log('log', 'noise a', 1),
        log('warn', 'careful', 2),
        log('error', 'boom', 3),
      ],
      network: [
        normalizeNetworkEvent({ id: 'ok', initiator: 'fetch', url: 'https://a.test/ok', startedAt: 0, status: 200 }),
        normalizeNetworkEvent({ id: 'bad', initiator: 'fetch', url: 'https://a.test/bad', startedAt: 0, status: 500 }),
      ],
    });

    const payload = buildAiPayload(report, '', undefined, { maxConsole: 2, maxNetwork: 1 });
    expect(payload.console.map((entry) => entry.level)).toEqual(['error', 'warn']);
    expect(payload.consoleTotal).toBe(3);
    expect(payload.network).toHaveLength(1);
    expect(payload.network[0]!.url).toBe('https://a.test/bad');
    expect(payload.networkTotal).toBe(2);
  });

  it('clamps long text', () => {
    const payload = buildAiPayload(makeReport({ console: [log('error', 'x'.repeat(100))] }), '', undefined, {
      maxTextLength: 20,
    });
    expect(payload.console[0]!.text).toHaveLength(21);
    expect(payload.console[0]!.text.endsWith('…')).toBe(true);
  });

  it('summarizes the environment', () => {
    const payload = buildAiPayload(makeReport());
    expect(payload.environment.browser).toBe('Chrome');
    expect(payload.environment.viewport).toMatch(/^\d+x\d+$/);
  });
});

describe('prompts', () => {
  it('asks for the required report sections', () => {
    const prompt = buildReportPrompt(buildAiPayload(makeReport({ console: [log('error', 'boom')] })));
    for (const section of [
      '## Title',
      '## Summary',
      '## Steps to reproduce',
      '## Expected behavior',
      '## Actual behavior',
      '## Suggested severity',
    ]) {
      expect(prompt.system).toContain(section);
    }
    expect(prompt.user).toContain('https://shop.test/checkout');
    expect(prompt.user).toContain('[error] boom');
  });

  it('states when nothing was captured', () => {
    const prompt = buildReportPrompt(buildAiPayload(makeReport()));
    expect(prompt.user).toContain('- none captured');
  });

  it('includes the stack in the error explanation prompt', () => {
    const prompt = buildErrorExplanationPrompt(log('error', 'boom', 0, 'at handler (app.js:1)'), 'clicked pay');
    expect(prompt.user).toContain('at handler (app.js:1)');
    expect(prompt.user).toContain('clicked pay');
  });

  it('groups failures for the network summary prompt', () => {
    const entries = [1, 2].map((id) =>
      normalizeNetworkEvent({
        id: `net_${id}`,
        initiator: 'fetch',
        method: 'GET',
        url: `https://api.test/orders/${id}`,
        startedAt: 0,
        status: 503,
      }),
    );
    expect(buildNetworkSummaryPrompt(entries).user).toContain('https://api.test/orders/:id → 503 (2×)');
    expect(buildNetworkSummaryPrompt([]).user).toContain('No failing requests');
  });
});

describe('parseGeneratedReport', () => {
  it('extracts every section', () => {
    const patch = parseGeneratedReport(
      [
        '## Title',
        'Checkout returns 500',
        '',
        '## Summary',
        'The order endpoint fails.',
        '',
        '## Steps to reproduce',
        '1. Open checkout',
        '2. Pay',
        '',
        '## Expected behavior',
        'Order is created.',
        '',
        '## Actual behavior',
        'A 500 is returned.',
        '',
        '## Suggested severity',
        'High — blocks purchases.',
        '',
        '## Likely cause',
        'Server bug.',
      ].join('\n'),
    );

    expect(patch).toEqual({
      title: 'Checkout returns 500',
      description: 'The order endpoint fails.',
      stepsToReproduce: '1. Open checkout\n2. Pay',
      expectedBehavior: 'Order is created.',
      actualBehavior: 'A 500 is returned.',
      severity: 'high',
    });
  });

  it('returns an empty patch for unstructured output', () => {
    expect(parseGeneratedReport('Sorry, I could not help.')).toEqual({});
  });
});

describe('findSimilarReports', () => {
  it('finds reports sharing an error and skips itself', () => {
    const error = log('error', 'TypeError: cannot read property total of undefined');
    const target = makeReport({ id: 'a', console: [error] });
    const duplicate = makeReport({ id: 'b', console: [error] });
    const unrelated = makeReport({
      id: 'c',
      title: 'Newsletter signup layout broken on mobile',
      description: 'The footer overlaps the form',
      url: 'https://shop.test/newsletter',
    });

    const matches = findSimilarReports(target, [target, duplicate, unrelated]);
    expect(matches.map((match) => match.report.id)).toContain('b');
    expect(matches.map((match) => match.report.id)).not.toContain('a');
    expect(matches[0]!.reasons.some((reason) => reason.startsWith('Same console error'))).toBe(true);
    expect(matches[0]!.score).toBeGreaterThan(0.25);
  });

  it('respects the limit option', () => {
    const target = makeReport({ id: 'a' });
    const candidates = [1, 2, 3].map((n) => makeReport({ id: `dup_${n}` }));
    expect(findSimilarReports(target, candidates, { limit: 2 })).toHaveLength(2);
  });
});
