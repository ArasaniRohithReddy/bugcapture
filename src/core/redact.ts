/**
 * Redaction engine.
 *
 * Everything that can leave the browser (uploads, AI prompts, exports) is run
 * through this module first. It is deliberately dependency-free and pure so it
 * can be unit tested and reused by local exports.
 */
import type { BugReport, ConsoleLogEntry, NetworkEntry, RedactionSettings } from './types';

export const REDACTED = '[REDACTED BY BUGCAPTURE]';

/** Header names that are always removed when header redaction is on. */
export const SENSITIVE_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-session-token',
  'api-key',
];

interface Rule {
  pattern: RegExp;
  replacement: string;
}

/** Secret-shaped strings. Ordered most specific first. */
const SECRET_RULES: Rule[] = [
  // JSON Web Tokens.
  {
    pattern: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
    replacement: REDACTED,
  },
  // `Authorization: ****** style values appearing inside free text.
  {
    pattern: /\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: `$1 ${REDACTED}`,
  },
  // Vendor-prefixed API keys (OpenAI, GitHub, AWS, Google, Slack, Stripe).
  { pattern: /\b(?:sk|pk|rk)-(?:proj-)?[A-Za-z0-9_-]{16,}/g, replacement: REDACTED },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, replacement: REDACTED },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: REDACTED },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: REDACTED },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, replacement: REDACTED },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replacement: REDACTED },
  // Secret-ish JSON properties: {"api_key": "..."} .
  {
    pattern:
      /("(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|password|passwd|pwd|authorization)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
    replacement: `$1"${REDACTED}"`,
  },
  // Secrets in query strings and form bodies.
  {
    pattern:
      /\b(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|password|passwd|pwd|token|auth)=([^&\s"'#]+)/gi,
    replacement: `$1=${REDACTED}`,
  },
];

const EMAIL_RULE: Rule = {
  pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  replacement: REDACTED,
};

/** 13-19 digit runs, optionally separated by spaces or dashes. */
const CARD_CANDIDATE = /\b(?:\d[ -]?){12,18}\d\b/g;

/** Luhn checksum, used to avoid redacting arbitrary long numbers. */
export function isLuhnValid(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Compile user-provided regex sources, silently skipping invalid ones so a
 * typo in the options page can never break capture.
 */
export function compileCustomPatterns(sources: readonly string[]): RegExp[] {
  const compiled: RegExp[] = [];
  for (const source of sources) {
    const trimmed = source.trim();
    if (!trimmed) continue;
    try {
      compiled.push(new RegExp(trimmed, 'g'));
    } catch {
      // Ignore invalid user patterns.
    }
  }
  return compiled;
}

export const DEFAULT_REDACTION: RedactionSettings = {
  enabled: true,
  redactHeaders: true,
  redactBodies: true,
  redactEmails: true,
  redactCreditCards: true,
  customPatterns: [],
};

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.includes(name.trim().toLowerCase());
}

/** Redact a free-form string (log message, body, note, stack trace). */
export function redactText(input: string, settings: RedactionSettings = DEFAULT_REDACTION): string {
  if (!input || !settings.enabled) return input;
  let output = input;

  for (const rule of SECRET_RULES) {
    output = output.replace(rule.pattern, rule.replacement);
  }
  if (settings.redactEmails) {
    output = output.replace(EMAIL_RULE.pattern, EMAIL_RULE.replacement);
  }
  if (settings.redactCreditCards) {
    output = output.replace(CARD_CANDIDATE, (match) =>
      isLuhnValid(match.replace(/[ -]/g, '')) ? REDACTED : match,
    );
  }
  for (const pattern of compileCustomPatterns(settings.customPatterns)) {
    output = output.replace(pattern, REDACTED);
  }
  return output;
}

export function redactHeaders(
  headers: Record<string, string>,
  settings: RedactionSettings = DEFAULT_REDACTION,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (settings.enabled && settings.redactHeaders && isSensitiveHeader(name)) {
      result[name] = REDACTED;
    } else {
      result[name] = redactText(value, settings);
    }
  }
  return result;
}

export function redactConsoleEntry(
  entry: ConsoleLogEntry,
  settings: RedactionSettings = DEFAULT_REDACTION,
): ConsoleLogEntry {
  if (!settings.enabled) return entry;
  return {
    ...entry,
    args: entry.args.map((arg) => redactText(arg, settings)),
    text: redactText(entry.text, settings),
    stack: entry.stack ? redactText(entry.stack, settings) : entry.stack,
    url: entry.url ? redactText(entry.url, settings) : entry.url,
  };
}

export function redactNetworkEntry(
  entry: NetworkEntry,
  settings: RedactionSettings = DEFAULT_REDACTION,
): NetworkEntry {
  if (!settings.enabled) return entry;
  const bodies = settings.redactBodies;
  return {
    ...entry,
    url: redactText(entry.url, settings),
    requestHeaders: redactHeaders(entry.requestHeaders, settings),
    responseHeaders: redactHeaders(entry.responseHeaders, settings),
    requestBody:
      bodies && entry.requestBody ? redactText(entry.requestBody, settings) : entry.requestBody,
    responseBody:
      bodies && entry.responseBody ? redactText(entry.responseBody, settings) : entry.responseBody,
    error: entry.error ? redactText(entry.error, settings) : entry.error,
  };
}

/** Redact an entire report. Media blobs are untouched. */
export function redactReport(
  report: BugReport,
  settings: RedactionSettings = DEFAULT_REDACTION,
): BugReport {
  if (!settings.enabled) return report;
  return {
    ...report,
    url: redactText(report.url, settings),
    environment: { ...report.environment, url: redactText(report.environment.url, settings) },
    console: report.console.map((entry) => redactConsoleEntry(entry, settings)),
    network: report.network.map((entry) => redactNetworkEntry(entry, settings)),
  };
}
