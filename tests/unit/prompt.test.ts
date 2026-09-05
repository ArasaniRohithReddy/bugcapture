import { expect, it } from 'vitest';
import { buildLocalAiPrompt } from '../../src/ai/prompt';
import { emptyEnvironment } from '../../src/core/env';
import type { BugReport } from '../../src/core/types';

it('keeps user-authored fields while redacting evidence', () => {
  const report = {
    id: 'r',
    createdAt: 1,
    updatedAt: 1,
    title: 'Contact me at author@example.com',
    description: 'secret note',
    severity: 'low',
    stepsToReproduce: 'Do it',
    expectedBehavior: 'Works',
    actualBehavior: 'Fails',
    url: '',
    environment: emptyEnvironment(),
    console: [],
    network: [],
    replayEvents: [],
    media: [],
    ai: [],
    tags: [],
  } satisfies BugReport;
  const prompt = buildLocalAiPrompt(report);
  expect(prompt).toContain(report.title);
  expect(prompt).toContain('[REDACTED BY BUGCAPTURE]');
});
