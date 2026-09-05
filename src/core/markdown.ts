/** Markdown rendering of a report (used for export, clipboard and GitHub). */
import type { BugReport, ConsoleLogEntry, NetworkEntry } from './types';
import { groupFailures, isFailure } from './network';
import { formatBytes } from './util';

function codeBlock(content: string, language = ''): string {
  return `\`\`\`${language}\n${content}\n\`\`\``;
}

export function formatConsoleLine(entry: ConsoleLogEntry): string {
  const time = new Date(entry.timestamp).toISOString();
  return `[${time}] ${entry.level.toUpperCase()} ${entry.text}${entry.stack ? `\n${entry.stack}` : ''}`;
}

export function formatNetworkLine(entry: NetworkEntry): string {
  const status = entry.error
    ? `ERR (${entry.error})`
    : `${entry.status} ${entry.statusText}`.trim();
  const duration = entry.duration === undefined ? '' : ` – ${entry.duration}ms`;
  return `${entry.method} ${entry.url} → ${status}${duration}`;
}

export interface MarkdownOptions {
  /** Maximum console/network lines rendered. */
  maxEntries?: number;
}

export function reportToMarkdown(report: BugReport, options: MarkdownOptions = {}): string {
  const maxEntries = options.maxEntries ?? 50;
  const env = report.environment;
  const errors = report.console.filter((entry) => entry.level === 'error');
  const failures = report.network.filter(isFailure);

  const lines: string[] = [];
  lines.push(`# ${report.title || 'Untitled bug report'}`, '');
  lines.push(`**Severity:** ${report.severity}`);
  lines.push(`**URL:** ${report.url || env.url}`);
  lines.push(`**Captured:** ${new Date(report.createdAt).toISOString()}`);
  lines.push('');

  if (report.description) lines.push('## Description', '', report.description, '');
  if (report.stepsToReproduce) {
    lines.push('## Steps to reproduce', '', report.stepsToReproduce, '');
  }
  if (report.expectedBehavior) lines.push('## Expected behavior', '', report.expectedBehavior, '');
  if (report.actualBehavior) lines.push('## Actual behavior', '', report.actualBehavior, '');

  lines.push('## Environment', '');
  lines.push('| Field | Value |', '| --- | --- |');
  lines.push(`| Browser | ${env.browser} ${env.browserVersion} |`);
  lines.push(`| OS | ${env.os} |`);
  lines.push(
    `| Viewport | ${env.viewport.width}×${env.viewport.height} @${env.devicePixelRatio}x |`,
  );
  lines.push(`| Screen | ${env.screen.width}×${env.screen.height} |`);
  lines.push(`| Language | ${env.language} |`);
  lines.push(`| Timezone | ${env.timezone} |`);
  lines.push(`| Online | ${env.online ? 'yes' : 'no'} |`);
  if (env.deviceMemory) lines.push(`| Device memory | ${env.deviceMemory} GB |`);
  if (env.jsHeapSizeMB) lines.push(`| JS heap | ${env.jsHeapSizeMB} MB |`);
  lines.push(`| User agent | \`${env.userAgent}\` |`);
  lines.push(`| BugCapture | ${env.extensionVersion} |`);
  lines.push('');

  if (errors.length) {
    lines.push(`## Console errors (${errors.length})`, '');
    lines.push(codeBlock(errors.slice(0, maxEntries).map(formatConsoleLine).join('\n')));
    lines.push('');
  }

  if (failures.length) {
    lines.push(`## Failed network requests (${failures.length})`, '');
    for (const group of groupFailures(failures)) {
      lines.push(
        `- \`${group.method} ${group.endpoint}\` → **${group.status || 'failed'}** ×${group.count}`,
      );
    }
    lines.push('');
  }

  if (report.console.length) {
    lines.push('<details><summary>All console logs</summary>', '');
    lines.push(codeBlock(report.console.slice(0, maxEntries).map(formatConsoleLine).join('\n')));
    lines.push('', '</details>', '');
  }

  if (report.network.length) {
    lines.push('<details><summary>All network requests</summary>', '');
    lines.push(codeBlock(report.network.slice(0, maxEntries).map(formatNetworkLine).join('\n')));
    lines.push('', '</details>', '');
  }

  if (report.media.length) {
    lines.push('## Attachments', '');
    for (const media of report.media) {
      lines.push(`- ${media.kind}: ${media.name} (${formatBytes(media.size)})`);
    }
    lines.push('');
  }

  if (report.replayEvents.length) {
    lines.push(`_Session replay: ${report.replayEvents.length} rrweb events captured._`, '');
  }

  lines.push(
    '---',
    '',
    '_Generated with [BugCapture](https://github.com/ArasaniRohithReddy/bugcapture)._',
  );
  return lines.join('\n');
}
