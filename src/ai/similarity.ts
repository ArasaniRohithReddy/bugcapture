/**
 * Heuristic duplicate/related-report detection.
 *
 * Runs entirely locally against reports already in IndexedDB — no embeddings
 * service and no network access required.
 */
import type { BugReport } from '../core/types';

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'at',
  'by',
  'from',
  'it',
  'this',
  'that',
  'as',
  'not',
  'no',
  'error',
  'bug',
  'issue',
  'when',
  'then',
  'i',
  'we',
  'you',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_$.]+/)
    .map((token) => token.replace(/^[.]+|[.]+$/g, ''))
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

/** Term-frequency vector used for cosine similarity. */
export function termFrequencies(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  for (const [term, weight] of a) {
    const other = b.get(term);
    if (other) dot += weight * other;
  }
  if (dot === 0) return 0;
  const norm = (vector: Map<string, number>) =>
    Math.sqrt([...vector.values()].reduce((sum, value) => sum + value * value, 0));
  return dot / (norm(a) * norm(b));
}

/** The text a report is compared on: title, notes, errors and failing URLs. */
export function reportFingerprint(report: BugReport): string {
  const errors = report.console
    .filter((entry) => entry.level === 'error')
    .slice(0, 10)
    .map((entry) => entry.text);
  const failures = report.network
    .filter((entry) => entry.status === 0 || entry.status >= 400)
    .slice(0, 10)
    .map((entry) => `${entry.method} ${entry.url} ${entry.status}`);
  let pathname = '';
  try {
    pathname = new URL(report.url || report.environment.url).pathname;
  } catch {
    pathname = report.url;
  }
  return [report.title, report.description, pathname, ...errors, ...failures].join('\n');
}

export interface SimilarReport {
  report: BugReport;
  score: number;
  reasons: string[];
}

export interface SimilarityOptions {
  threshold?: number;
  limit?: number;
}

/** Rank existing reports by similarity to `target`. */
export function findSimilarReports(
  target: BugReport,
  candidates: readonly BugReport[],
  options: SimilarityOptions = {},
): SimilarReport[] {
  const threshold = options.threshold ?? 0.25;
  const limit = options.limit ?? 5;
  const targetVector = termFrequencies(tokenize(reportFingerprint(target)));
  const targetErrors = new Set(
    target.console.filter((entry) => entry.level === 'error').map((entry) => entry.text),
  );

  const scored: SimilarReport[] = [];
  for (const candidate of candidates) {
    if (candidate.id === target.id) continue;
    const score = cosineSimilarity(
      targetVector,
      termFrequencies(tokenize(reportFingerprint(candidate))),
    );
    if (score < threshold) continue;

    const reasons: string[] = [];
    const sharedError = candidate.console.find(
      (entry) => entry.level === 'error' && targetErrors.has(entry.text),
    );
    if (sharedError) reasons.push(`Same console error: ${sharedError.text.slice(0, 120)}`);
    if (candidate.url && target.url && candidate.url === target.url) {
      reasons.push('Captured on the same URL');
    }
    reasons.push(`Text similarity ${(score * 100).toFixed(0)}%`);
    scored.push({ report: candidate, score, reasons });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
