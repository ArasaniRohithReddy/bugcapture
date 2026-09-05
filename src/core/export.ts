/**
 * Export helpers (Markdown / JSON / self-contained ZIP).
 *
 * Only imported by extension pages built with Vite: the ZIP bundle inlines the
 * rrweb player with `?raw` imports so the exported viewer works offline.
 */
import JSZip from 'jszip';
import playerScript from 'virtual:rrweb-player-umd?raw';
import playerStyle from 'virtual:rrweb-player-css?raw';
import type { BugReport } from './types';
import { reportToMarkdown } from './markdown';
import { getReportMedia } from './storage';
import { slugify } from './util';

export function reportToJson(report: BugReport): string {
  return JSON.stringify(report, null, 2);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build the standalone HTML viewer shipped inside the ZIP bundle. */
export function buildStandaloneViewer(report: BugReport, mediaFiles: string[]): string {
  const events = JSON.stringify(report.replayEvents);
  const summary = escapeHtml(reportToMarkdown(report, { maxEntries: 200 }));
  const media = mediaFiles
    .map((file) =>
      file.endsWith('.webm')
        ? `<video controls src="${escapeHtml(file)}" style="max-width:100%"></video>`
        : `<img src="${escapeHtml(file)}" alt="screenshot" style="max-width:100%" />`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BugCapture – ${escapeHtml(report.title || 'Bug report')}</title>
    <style>${playerStyle}</style>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 24px; background: #0f1116; color: #e6e8ee; }
      h1 { font-size: 20px; }
      pre { white-space: pre-wrap; background: #171a21; padding: 16px; border-radius: 8px; overflow: auto; }
      section { margin-bottom: 32px; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(report.title || 'Bug report')}</h1>
    <section id="replay"></section>
    <section>${media}</section>
    <section><pre>${summary}</pre></section>
    <script>${playerScript}</script>
    <script>
      var events = ${events};
      if (events.length > 1) {
        new rrwebPlayer({
          target: document.getElementById('replay'),
          props: { events: events, width: Math.min(1024, window.innerWidth - 48), autoPlay: false },
        });
      } else {
        document.getElementById('replay').textContent = 'No session replay was captured.';
      }
    </script>
  </body>
</html>`;
}

/** Build a `.zip` containing the report, media, replay and a viewer. */
export async function buildZipBundle(report: BugReport): Promise<Blob> {
  const zip = new JSZip();
  const media = await getReportMedia(report);
  const mediaFiles: string[] = [];

  zip.file('report.json', reportToJson(report));
  zip.file('report.md', reportToMarkdown(report, { maxEntries: 500 }));
  zip.file('replay.json', JSON.stringify(report.replayEvents));

  for (const item of media) {
    const path = `media/${item.name}`;
    zip.file(path, item.blob);
    mediaFiles.push(path);
  }

  zip.file('viewer.html', buildStandaloneViewer(report, mediaFiles));
  zip.file(
    'README.txt',
    'BugCapture export.\n\nOpen viewer.html in a browser to replay the session and read the report.\n',
  );
  return zip.generateAsync({ type: 'blob' });
}

export function reportFileName(report: BugReport, extension: string): string {
  const date = new Date(report.createdAt).toISOString().slice(0, 10);
  return `bugcapture-${date}-${slugify(report.title)}.${extension}`;
}

/** Trigger a browser download for the given blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
