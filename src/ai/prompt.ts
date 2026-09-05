/**
 * AI prompt builder.
 *
 * The prompt is formatted locally for the "Copy as AI prompt" action and
 * nothing is ever sent anywhere: the user pastes it into whichever AI tool
 * they already use. Evidence is redacted first; user-authored fields are not.
 */
import type { BugReport, ConsoleLogEntry, NetworkEntry, RedactionSettings } from '../core/types';
import { groupFailures, isFailure } from '../core/network';
import {
  DEFAULT_REDACTION,
  redactConsoleEntry,
  redactNetworkEntry,
  redactText,
} from '../core/redact';

export interface PromptLimits {
  maxConsole?: number;
  maxNetwork?: number;
  maxTextLength?: number;
}

const DEFAULT_LIMITS: Required<PromptLimits> = {
  maxConsole: 30,
  maxNetwork: 20,
  maxTextLength: 2000,
};

export interface AiPayloadConsole {
  timestamp: number;
  level: string;
  text: string;
  stack?: string;
}

export interface AiPayloadNetwork {
  method: string;
  url: string;
  status: number;
  duration?: number;
  error?: string;
  responseBody?: string;
}

/** The redacted, size-capped view of a report that AI providers receive. */
export interface AiPayload {
  url: string;
  title: string;
  userNotes: string;
  environment: {
    browser: string;
    browserVersion: string;
    os: string;
    viewport: string;
    language: string;
  };
  console: AiPayloadConsole[];
  network: AiPayloadNetwork[];
  consoleTotal: number;
  networkTotal: number;
  replayEventCount: number;
}

function clamp(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function scoreConsole(entry: ConsoleLogEntry): number {
  if (entry.source !== 'console') return 3;
  if (entry.level === 'error') return 3;
  if (entry.level === 'warn') return 2;
  return 1;
}

/** Build the redacted payload. Errors and failures are prioritized. */
export function buildAiPayload(
  report: BugReport,
  notes = '',
  redaction: RedactionSettings = DEFAULT_REDACTION,
  limits: PromptLimits = {},
): AiPayload {
  const { maxConsole, maxNetwork, maxTextLength } = { ...DEFAULT_LIMITS, ...limits };

  const consoleEntries = [...report.console]
    .sort((a, b) => scoreConsole(b) - scoreConsole(a) || a.timestamp - b.timestamp)
    .slice(0, maxConsole)
    .map((entry) => redactConsoleEntry(entry, redaction))
    .map((entry) => {
      const item: AiPayloadConsole = {
        timestamp: entry.timestamp,
        level: entry.level,
        text: clamp(entry.text, maxTextLength) ?? '',
      };
      const stack = clamp(entry.stack, maxTextLength);
      if (stack) item.stack = stack;
      return item;
    });

  const failures = report.network.filter(isFailure);
  const others = report.network.filter((entry) => !isFailure(entry));
  const networkEntries = [...failures, ...others]
    .slice(0, maxNetwork)
    .map((entry) => redactNetworkEntry(entry, redaction))
    .map((entry) => {
      const item: AiPayloadNetwork = {
        method: entry.method,
        url: entry.url,
        status: entry.status,
      };
      if (entry.duration !== undefined) item.duration = entry.duration;
      if (entry.error) item.error = entry.error;
      const body = clamp(entry.responseBody, 500);
      if (body && !entry.ok) item.responseBody = body;
      return item;
    });

  const env = report.environment;
  return {
    url: redactText(report.url || env.url, redaction),
    title: redactText(report.title || env.title, redaction),
    userNotes: clamp(redactText(notes, redaction), maxTextLength) ?? '',
    environment: {
      browser: env.browser,
      browserVersion: env.browserVersion,
      os: env.os,
      viewport: `${env.viewport.width}x${env.viewport.height}`,
      language: env.language,
    },
    console: consoleEntries,
    network: networkEntries,
    consoleTotal: report.console.length,
    networkTotal: report.network.length,
    replayEventCount: report.replayEvents.length,
  };
}

export interface AiPrompt {
  system: string;
  user: string;
}

const REPORT_SYSTEM = [
  'You are an experienced QA engineer writing precise, actionable bug reports.',
  'Use only the evidence provided. Never invent stack traces, endpoints or versions.',
  'If information is missing, say so explicitly instead of guessing.',
  'Respond in GitHub-flavoured Markdown using exactly these sections:',
  '## Title, ## Summary, ## Steps to reproduce, ## Expected behavior,',
  '## Actual behavior, ## Suggested severity (one of critical/high/medium/low), ## Likely cause.',
].join('\n');

export function buildReportPrompt(payload: AiPayload): AiPrompt {
  return {
    system: REPORT_SYSTEM,
    user: [
      `Page: ${payload.title || '(untitled)'} — ${payload.url}`,
      `Environment: ${payload.environment.browser} ${payload.environment.browserVersion} on ${payload.environment.os}, viewport ${payload.environment.viewport}, language ${payload.environment.language}`,
      '',
      `Reporter notes: ${payload.userNotes || '(none provided)'}`,
      '',
      `Console entries (${payload.console.length} of ${payload.consoleTotal}):`,
      payload.console.length
        ? payload.console
            .map(
              (entry) =>
                `- [${entry.level}] ${entry.text}${entry.stack ? `\n  ${entry.stack}` : ''}`,
            )
            .join('\n')
        : '- none captured',
      '',
      `Network requests (${payload.network.length} of ${payload.networkTotal}):`,
      payload.network.length
        ? payload.network
            .map(
              (entry) =>
                `- ${entry.method} ${entry.url} → ${entry.error ? `failed: ${entry.error}` : entry.status}${entry.responseBody ? `\n  body: ${entry.responseBody}` : ''}`,
            )
            .join('\n')
        : '- none captured',
      '',
      `Session replay events captured: ${payload.replayEventCount}`,
      '',
      'Write the bug report now.',
    ].join('\n'),
  };
}

export function buildErrorExplanationPrompt(entry: ConsoleLogEntry, notes = ''): AiPrompt {
  return {
    system:
      'You explain JavaScript runtime errors to developers in plain language. ' +
      'Give: (1) what the error means, (2) the most likely cause given the stack trace, ' +
      '(3) a concrete direction for a fix. Be concise — at most 200 words. Do not invent code that is not shown.',
    user: [
      `Error level: ${entry.level}`,
      `Message: ${entry.text}`,
      entry.stack ? `Stack trace:\n${entry.stack}` : 'Stack trace: (not captured)',
      notes ? `Context from reporter: ${notes}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export function buildNetworkSummaryPrompt(entries: readonly NetworkEntry[]): AiPrompt {
  const groups = groupFailures(entries);
  return {
    system:
      'You analyse failing HTTP requests captured in a browser session. ' +
      'Group related failures, state the likely cause (auth, CORS, 5xx, offline, rate limiting), ' +
      'and suggest what to check next. Be concise and use bullet points.',
    user: groups.length
      ? groups
          .map(
            (group) =>
              `- ${group.method} ${group.endpoint} → ${group.status || 'network error'} (${group.count}×)` +
              (group.samples[0]?.error ? ` error: ${group.samples[0].error}` : ''),
          )
          .join('\n')
      : 'No failing requests were captured.',
  };
}

/** Human-readable preview shown on the consent screen before anything is sent. */
export function payloadPreview(payload: AiPayload): string {
  return JSON.stringify(payload, null, 2);
}

/** Build a copyable, local-only prompt. Reporter-authored fields are never redacted. */
export function buildLocalAiPrompt(
  report: BugReport,
  redaction: RedactionSettings = DEFAULT_REDACTION,
): string {
  const payload = buildAiPayload(report, '', redaction);
  const authored = [
    `Title: ${report.title || '(untitled)'}`,
    `Description: ${report.description || '(none)'}`,
    `Steps to reproduce: ${report.stepsToReproduce || '(none)'}`,
    `Expected behavior: ${report.expectedBehavior || '(none)'}`,
    `Actual behavior: ${report.actualBehavior || '(none)'}`,
  ].join('\n');
  const prompt = buildReportPrompt(payload);
  return `${prompt.system}\n\n${authored}\n\n${prompt.user}`;
}
