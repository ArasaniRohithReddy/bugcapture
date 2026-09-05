import { escapeHtml } from '../utils/helpers.js';

function escapeJsonForScript(data: unknown): string {
  // Safely embed JSON in a script tag by escaping </script and <!-- sequences
  return JSON.stringify(data)
    .replace(/<\//g, '<\\/')
    .replace(/<!--/g, '<\\!--');
}

export function renderViewer(
  id: string,
  report: Record<string, unknown>,
  replay: unknown[],
  mediaFiles: string[],
): string {
  const title = escapeHtml(String(report['title'] ?? 'Untitled'));
  const description = escapeHtml(String(report['description'] ?? ''));
  const severity = escapeHtml(String(report['severity'] ?? 'unknown'));
  const url = escapeHtml(String(report['url'] ?? ''));
  const createdAt = report['createdAt']
    ? new Date(report['createdAt'] as number).toISOString()
    : 'unknown';

  const env = (report['environment'] ?? {}) as Record<string, unknown>;
  const envHtml = env
    ? `<dl class="env">
        <dt>Browser</dt><dd>${escapeHtml(String(env['browser'] ?? ''))} ${escapeHtml(String(env['browserVersion'] ?? ''))}</dd>
        <dt>OS</dt><dd>${escapeHtml(String(env['os'] ?? ''))}</dd>
        <dt>Viewport</dt><dd>${escapeHtml(JSON.stringify(env['viewport'] ?? ''))}</dd>
        <dt>User Agent</dt><dd>${escapeHtml(String(env['userAgent'] ?? ''))}</dd>
      </dl>`
    : '';

  const consoleLogs = (report['console'] ?? []) as Array<Record<string, unknown>>;
  const consoleHtml = consoleLogs.length
    ? `<h2>Console Logs (${consoleLogs.length})</h2>
       <table><thead><tr><th>Level</th><th>Message</th></tr></thead><tbody>
       ${consoleLogs
         .map(
           (e) =>
             `<tr class="log-${escapeHtml(String(e['level'] ?? 'log'))}"><td>${escapeHtml(String(e['level'] ?? ''))}</td><td><pre>${escapeHtml(String(e['text'] ?? ''))}</pre></td></tr>`,
         )
         .join('')}
       </tbody></table>`
    : '';

  const networkLogs = (report['network'] ?? []) as Array<Record<string, unknown>>;
  const networkHtml = networkLogs.length
    ? `<h2>Network Logs (${networkLogs.length})</h2>
       <table><thead><tr><th>Method</th><th>URL</th><th>Status</th><th>Duration</th></tr></thead><tbody>
       ${networkLogs
         .map(
           (e) =>
             `<tr class="${(e['ok'] as boolean) ? '' : 'error'}"><td>${escapeHtml(String(e['method'] ?? ''))}</td><td>${escapeHtml(String(e['url'] ?? ''))}</td><td>${escapeHtml(String(e['status'] ?? ''))}</td><td>${e['duration'] != null ? `${e['duration']}ms` : '-'}</td></tr>`,
         )
         .join('')}
       </tbody></table>`
    : '';

  const screenshots = mediaFiles.filter(
    (f) => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg'),
  );
  const videos = mediaFiles.filter((f) => f.endsWith('.webm'));

  const mediaHtml =
    screenshots.length || videos.length
      ? `<h2>Media</h2>
         ${videos.map((f) => `<video controls src="/api/reports/${escapeHtml(id)}/media/${escapeHtml(f)}"></video>`).join('')}
         ${screenshots.map((f) => `<img src="/api/reports/${escapeHtml(id)}/media/${escapeHtml(f)}" alt="screenshot" />`).join('')}`
      : '';

  const replaySection = replay.length
    ? `<h2>Session Replay</h2>
       <div id="replay-container"></div>
       <script>
         (function() {
           var events = ${escapeJsonForScript(replay)};
           if (typeof rrwebPlayer !== 'undefined' && events.length) {
             new rrwebPlayer.Replayer({
               target: document.getElementById('replay-container'),
               props: { events: events, showController: true, autoPlay: false }
             });
           }
         })();
       </script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Bug Report: ${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 960px; margin: 0 auto; padding: 1rem; background: #f8f9fa; color: #212529; }
    h1 { margin-top: 0; }
    .meta { color: #6c757d; font-size: 0.9rem; }
    .severity { display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.85rem; }
    .severity-critical { background: #dc3545; color: #fff; }
    .severity-high { background: #fd7e14; color: #fff; }
    .severity-medium { background: #ffc107; color: #212529; }
    .severity-low { background: #28a745; color: #fff; }
    pre { background: #e9ecef; padding: 0.5rem; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.9rem; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #dee2e6; }
    th { background: #e9ecef; }
    .log-error, .log-warn { color: #dc3545; }
    .error td { color: #dc3545; }
    dl.env { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; }
    dt { font-weight: 600; }
    img, video { max-width: 100%; margin: 0.5rem 0; border-radius: 4px; }
    #replay-container { border: 1px solid #dee2e6; border-radius: 4px; margin: 1rem 0; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p class="meta">
    <span class="severity severity-${severity}">${severity}</span>
    &nbsp; ${escapeHtml(createdAt)} &nbsp; <a href="${url}">${url}</a>
  </p>
  ${description ? `<p>${description}</p>` : ''}

  <h2>Environment</h2>
  ${envHtml}

  ${consoleHtml}
  ${networkHtml}
  ${mediaHtml}
  ${replaySection}
</body>
</html>`;
}
