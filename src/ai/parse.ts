/**
 * Parser for the Markdown produced by the report-generation prompt.
 *
 * Kept separate from the UI so it can be unit-tested without a DOM.
 */
import type { BugReport } from '../core/types';

/** Pull the structured sections out of the model's Markdown answer. */
export function parseGeneratedReport(markdown: string): Partial<BugReport> {
  const section = (name: string): string => {
    const pattern = new RegExp(`##\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
    return markdown.match(pattern)?.[1]?.trim() ?? '';
  };
  const severityText = section('Suggested severity').toLowerCase();
  const severity = (['critical', 'high', 'medium', 'low'] as const).find((value) =>
    severityText.includes(value),
  );

  const patch: Partial<BugReport> = {};
  const title = section('Title').replace(/^#+\s*/, '');
  if (title) patch.title = title;
  const summary = section('Summary');
  if (summary) patch.description = summary;
  const steps = section('Steps to reproduce');
  if (steps) patch.stepsToReproduce = steps;
  const expected = section('Expected behavior');
  if (expected) patch.expectedBehavior = expected;
  const actual = section('Actual behavior');
  if (actual) patch.actualBehavior = actual;
  if (severity) patch.severity = severity;
  return patch;
}
