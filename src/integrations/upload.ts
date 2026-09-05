/** Upload a report bundle to the self-hosted BugCapture backend. */
import type { BackendSettings, BugReport, RedactionSettings } from '../core/types';
import { getReportMedia } from '../core/storage';
import { redactReport } from '../core/redact';

export interface UploadResult {
  id: string;
  url: string;
}

export async function ensureBackendPermission(endpoint: string): Promise<boolean> {
  try {
    const origin = `${new URL(endpoint).origin}/*`;
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

/** POST the report (multipart, media included) to `/api/reports`. */
export async function uploadReport(
  report: BugReport,
  backend: BackendSettings,
  redaction: RedactionSettings,
): Promise<UploadResult> {
  if (!backend.endpoint) throw new Error('No backend endpoint configured. Add one in Options.');
  if (!(await ensureBackendPermission(backend.endpoint))) {
    throw new Error('Permission to reach the backend origin was denied.');
  }

  const endpoint = backend.endpoint.replace(/\/$/, '');
  const redacted = redactReport(report, redaction);
  const form = new FormData();
  form.append(
    'report',
    new Blob([JSON.stringify({ ...redacted, replayEvents: undefined })], {
      type: 'application/json',
    }),
    'report.json',
  );
  form.append(
    'replay',
    new Blob([JSON.stringify(redacted.replayEvents)], { type: 'application/json' }),
    'replay.json',
  );
  for (const media of await getReportMedia(report)) {
    form.append('media', media.blob, media.name);
  }

  const headers: Record<string, string> = {};
  if (backend.token) headers.authorization = `${'Bearer'} ${backend.token}`;

  const response = await fetch(`${endpoint}/api/reports`, { method: 'POST', headers, body: form });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Upload failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  const result = (await response.json()) as { id: string; url: string };
  return { id: result.id, url: result.url.startsWith('http') ? result.url : `${endpoint}${result.url}` };
}
