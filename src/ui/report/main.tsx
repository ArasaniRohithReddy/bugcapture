import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/styles.css';
import './report.css';
import { Field, Tabs, useSettings, useTheme } from '../shared/components';
import { Annotator } from './Annotator';
import { ConsolePanel, EnvironmentPanel, MediaPanel, NetworkPanel, ReplayPanel } from './panels';
import {
  buildZipBundle,
  copyToClipboard,
  downloadBlob,
  reportFileName,
  reportToJson,
} from '../../core/export';
import { reportToMarkdown } from '../../core/markdown';
import { redactReport } from '../../core/redact';
import { buildLocalAiPrompt } from '../../ai/prompt';
import { getBlob, getReport, putBlob, saveReport } from '../../core/storage';
import type { BugReport, MediaItem, Severity } from '../../core/types';
import { uid } from '../../core/util';

type TabId = 'console' | 'network' | 'replay' | 'media' | 'environment';

function useReport(id: string | null) {
  const [report, setReport] = useState<BugReport>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    void getReport(id).then((value) => {
      setReport(value);
      setLoading(false);
    });
  }, [id]);

  const patch = useCallback((update: Partial<BugReport>) => {
    setReport((current) => {
      if (!current) return current;
      const next = { ...current, ...update, updatedAt: Date.now() };
      void saveReport(next);
      return next;
    });
  }, []);

  return { report, loading, patch };
}

function ReportEditor({ id }: { id: string }) {
  const { settings, loaded } = useSettings();
  useTheme(settings.theme);
  const { report, loading, patch } = useReport(id);
  const [tab, setTab] = useState<TabId>('console');
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [annotating, setAnnotating] = useState<{ item: MediaItem; blob: Blob }>();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const mediaKey = report?.media.map((item) => item.id).join(',') ?? '';

  useEffect(() => {
    if (!report) return;
    let cancelled = false;
    const urls: Record<string, string> = {};
    void (async () => {
      for (const item of report.media) {
        const blob = await getBlob(item.id);
        if (blob) urls[item.id] = URL.createObjectURL(blob);
      }
      if (!cancelled) setMediaUrls(urls);
    })();
    return () => {
      cancelled = true;
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
    // Keyed by media ids so swapping an item (same count) still refreshes.
  }, [report?.id, mediaKey]);

  const redacted = useMemo(
    () => (report ? redactReport(report, settings.redaction) : undefined),
    [report, settings.redaction],
  );

  const run = async (label: string, action: () => Promise<string | void>) => {
    setBusy(true);
    setStatus(`${label}…`);
    try {
      const result = await action();
      setStatus(result || `${label} done.`);
    } catch (error) {
      setStatus(`❌ ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !loaded) return <main className="report">Loading report…</main>;
  if (!report || !redacted) {
    return (
      <main className="report">
        <h1>Report not found</h1>
        <p className="muted">It may have been deleted by the retention policy.</p>
      </main>
    );
  }

  const markdown = reportToMarkdown(redacted, { includeMediaLinks: true });

  return (
    <main className="report">
      <header className="spread">
        <h1>Bug report</h1>
        <div className="row">
          <button
            type="button"
            onClick={() =>
              void run('Copying Markdown', async () => {
                const ok = await copyToClipboard(markdown);
                return ok ? 'Markdown copied to clipboard.' : '❌ Clipboard permission denied.';
              })
            }
          >
            Copy Markdown
          </button>
          <button
            type="button"
            onClick={() =>
              void run('Exporting Markdown', async () => {
                downloadBlob(
                  new Blob([markdown], { type: 'text/markdown' }),
                  reportFileName(report, 'md'),
                );
              })
            }
          >
            Export .md
          </button>
          <button
            type="button"
            onClick={() =>
              void run('Exporting JSON', async () => {
                downloadBlob(
                  new Blob([reportToJson(redacted)], { type: 'application/json' }),
                  reportFileName(report, 'json'),
                );
              })
            }
          >
            Export .json
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run('Building ZIP bundle', async () => {
                downloadBlob(await buildZipBundle(redacted), reportFileName(report, 'zip'));
              })
            }
          >
            Export .zip
          </button>
          <button
            type="button"
            onClick={() =>
              void run('Copying AI prompt', async () => {
                const ok = await copyToClipboard(buildLocalAiPrompt(report, settings.redaction));
                return ok
                  ? 'AI prompt copied. Nothing was sent automatically.'
                  : '❌ Clipboard permission denied.';
              })
            }
          >
            Copy as AI prompt
          </button>
        </div>
      </header>

      {status ? (
        <div className="notice" role="status">
          {status}
        </div>
      ) : null}

      <div className="report-grid">
        <section className="card">
          <Field label="Title">
            <input
              type="text"
              value={report.title}
              onChange={(event) => patch({ title: event.target.value })}
            />
          </Field>
          <Field label="Description / notes">
            <textarea
              value={report.description}
              placeholder="What went wrong?"
              onChange={(event) => patch({ description: event.target.value })}
            />
          </Field>
          <Field label="Steps to reproduce">
            <textarea
              value={report.stepsToReproduce}
              placeholder={'1. Go to …\n2. Click …\n3. See error'}
              onChange={(event) => patch({ stepsToReproduce: event.target.value })}
            />
          </Field>
          <div className="row">
            <Field label="Expected behavior">
              <textarea
                value={report.expectedBehavior}
                onChange={(event) => patch({ expectedBehavior: event.target.value })}
              />
            </Field>
            <Field label="Actual behavior">
              <textarea
                value={report.actualBehavior}
                onChange={(event) => patch({ actualBehavior: event.target.value })}
              />
            </Field>
          </div>
          <Field label="Severity">
            <select
              value={report.severity}
              onChange={(event) => patch({ severity: event.target.value as Severity })}
            >
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </Field>
          <p className="muted">
            Captured {new Date(report.createdAt).toLocaleString()} on{' '}
            <a href={report.url} target="_blank" rel="noreferrer">
              {report.url || 'unknown page'}
            </a>
          </p>
        </section>

        <section className="card">
          <h2>Local sharing</h2>
          <p className="muted">
            Reports remain in this browser. Export JSON, Markdown, or ZIP to share them.
          </p>
        </section>
      </div>

      <section className="card">
        <div className="spread">
          <h2>Evidence</h2>
          <span className="badge">
            {settings.redaction.enabled ? 'redaction on' : 'redaction off'}
          </span>
        </div>
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'console', label: 'Console', count: redacted.console.length },
            { id: 'network', label: 'Network', count: redacted.network.length },
            { id: 'replay', label: 'Replay', count: redacted.replayEvents.length },
            { id: 'media', label: 'Media', count: redacted.media.length },
            { id: 'environment', label: 'Environment' },
          ]}
        />
        {tab === 'console' ? <ConsolePanel entries={redacted.console} /> : null}
        {tab === 'network' ? <NetworkPanel entries={redacted.network} /> : null}
        {tab === 'replay' ? <ReplayPanel events={report.replayEvents} /> : null}
        {tab === 'media' ? (
          <MediaPanel
            media={report.media}
            urls={mediaUrls}
            onAnnotate={async (item) => {
              const blob = await getBlob(item.id);
              if (blob) setAnnotating({ item, blob });
            }}
            onDelete={(item) =>
              patch({ media: report.media.filter((entry) => entry.id !== item.id) })
            }
          />
        ) : null}
        {tab === 'environment' ? <EnvironmentPanel report={redacted} /> : null}
      </section>

      {annotating ? (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-label="Annotate screenshot">
            <Annotator
              blob={annotating.blob}
              onCancel={() => setAnnotating(undefined)}
              onSave={async (annotated) => {
                const media: MediaItem = {
                  ...annotating.item,
                  id: uid('shot'),
                  name: annotating.item.name.replace(/\.png$/, '-annotated.png'),
                  size: annotated.size,
                  createdAt: Date.now(),
                };
                await putBlob(media.id, annotated, report.id);
                patch({ media: [...report.media, media] });
                setAnnotating(undefined);
              }}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}

function App() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) {
    return (
      <main className="report">
        <h1>No report selected</h1>
        <p className="muted">Open a report from the BugCapture popup.</p>
      </main>
    );
  }
  return <ReportEditor id={id} />;
}

createRoot(document.getElementById('root')!).render(<App />);
