import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/styles.css';
import './popup.css';
import { Toggle, useSettings, useTheme } from '../shared/components';
import { sendMessage, type RewindStatus } from '../../core/messages';
import { deleteReport, getStorageUsage, listReports, type StorageUsage } from '../../core/storage';
import type { BugReport, CaptureState } from '../../core/types';
import { formatBytes, formatDuration } from '../../core/util';
import { hostFromUrl } from '../../core/rewind';

function useCaptureState(): [CaptureState | undefined, (state: CaptureState) => void] {
  const [state, setState] = useState<CaptureState>();
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const next = await sendMessage<CaptureState>({ type: 'capture:get-state' });
      if (!cancelled && next) setState(next);
    };
    void poll();
    const timer = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return [state, setState];
}

/** Current page host plus the live state of its Rewind buffer. */
function useRewind(): {
  host: string;
  status: RewindStatus | undefined;
  refresh: () => Promise<void>;
} {
  const [host, setHost] = useState('');
  const [status, setStatus] = useState<RewindStatus>();

  const refresh = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    setHost(hostFromUrl(tab?.url));
    setStatus(await sendMessage<RewindStatus>({ type: 'rewind:status' }));
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { host, status, refresh };
}

function Popup() {
  const { settings, loaded, update } = useSettings();
  useTheme(settings.theme);
  const [state, setState] = useCaptureState();
  const [reports, setReports] = useState<BugReport[]>([]);
  const rewind = useRewind();
  const [usage, setUsage] = useState<StorageUsage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setReports((await listReports()).slice(0, 8));
    setUsage(await getStorageUsage());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const recording = Boolean(state?.recording);
  const pausedSoFar = state?.pausedAt ? Date.now() - state.pausedAt : 0;
  const elapsed = state?.startedAt
    ? Date.now() - state.startedAt - state.pausedMs - pausedSoFar
    : 0;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      const result = (await action()) as { ok?: boolean; error?: string } | undefined;
      if (result && result.ok === false) setError(result.error ?? 'Something went wrong.');
      await refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleCapture = () =>
    run(async () => {
      if (recording) {
        const result = await sendMessage<{ ok: boolean; error?: string }>({ type: 'capture:stop' });
        setState({ recording: false, paused: false, pausedMs: 0, videoActive: false });
        window.close();
        return result;
      }
      const result = await sendMessage<{ ok: boolean; error?: string; state?: CaptureState }>({
        type: 'capture:start',
      });
      if (result?.state) setState(result.state);
      return result;
    });

  const screenshot = () =>
    run(async () => {
      const result = await sendMessage<{ ok: boolean; error?: string }>({
        type: 'capture:screenshot',
      });
      if (result?.ok) window.close();
      return result;
    });

  if (!loaded) return <main className="popup">Loading…</main>;

  return (
    <main className="popup">
      <header className="spread">
        <h1>BugCapture</h1>
        <button
          type="button"
          className="ghost"
          onClick={() => chrome.runtime.openOptionsPage()}
          aria-label="Open options"
        >
          ⚙
        </button>
      </header>

      {error ? (
        <div className="notice danger" role="alert">
          {error}
        </div>
      ) : null}

      <div className="card">
        <div className="spread">
          <div>
            <strong>{recording ? (state?.paused ? 'Paused' : 'Recording') : 'Idle'}</strong>
            <div className="muted">{recording ? formatDuration(elapsed) : 'Alt+Shift+B'}</div>
          </div>
          <div className="row">
            {recording ? (
              <button
                type="button"
                onClick={() =>
                  run(() =>
                    sendMessage({ type: state?.paused ? 'capture:resume' : 'capture:pause' }),
                  )
                }
                disabled={busy}
              >
                {state?.paused ? 'Resume' : 'Pause'}
              </button>
            ) : null}
            <button type="button" className="primary" onClick={toggleCapture} disabled={busy}>
              {recording ? 'Stop & report' : 'Start capture'}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Capture</h3>
        <Toggle
          label="Screen recording"
          checked={settings.capture.video}
          onChange={(video) =>
            update((current) => ({ ...current, capture: { ...current.capture, video } }))
          }
        />
        <Toggle
          label="Microphone audio"
          checked={settings.capture.microphone}
          disabled={!settings.capture.video}
          onChange={(microphone) =>
            update((current) => ({ ...current, capture: { ...current.capture, microphone } }))
          }
        />
        <Toggle
          label="Console logs"
          checked={settings.capture.console}
          onChange={(value) =>
            update((current) => ({ ...current, capture: { ...current.capture, console: value } }))
          }
        />
        <Toggle
          label="Network logs"
          checked={settings.capture.network}
          onChange={(network) =>
            update((current) => ({ ...current, capture: { ...current.capture, network } }))
          }
        />
        <Toggle
          label="Session replay (rrweb)"
          checked={settings.capture.replay}
          onChange={(replay) =>
            update((current) => ({ ...current, capture: { ...current.capture, replay } }))
          }
        />
        <button type="button" onClick={screenshot} disabled={busy || recording}>
          📸 Quick screenshot (Alt+Shift+S)
        </button>
      </div>

      <div className="card">
        <div className="spread">
          <h3>Rewind</h3>
          <span className="muted">
            {rewind.status?.allowed
              ? `${formatDuration(rewind.status.durationMs)} buffered`
              : 'off here'}
          </span>
        </div>
        {settings.capture.rewind ? null : (
          <p className="muted">
            Rewind is off. Turn it on in settings to keep a rolling buffer of the last{' '}
            {settings.capture.rewindBufferSeconds} seconds.
          </p>
        )}
        {settings.capture.rewind && rewind.host ? (
          <Toggle
            label={`Buffer ${rewind.host}`}
            hint="Rewind only ever runs on sites you opt in here."
            checked={Boolean(rewind.status?.allowed)}
            onChange={(enabled) =>
              run(async () => {
                // Chrome only grants host permissions from a user gesture, so
                // the request has to happen here rather than in the worker.
                const origins = [`*://${rewind.host}/*`, `*://*.${rewind.host}/*`];
                if (enabled && !(await chrome.permissions.request({ origins }))) {
                  return { ok: false, error: `Access to ${rewind.host} was declined.` };
                }
                const result = await sendMessage<{ ok: boolean; error?: string }>({
                  type: 'rewind:consent',
                  domain: rewind.host,
                  enabled,
                });
                if (!enabled) await chrome.permissions.remove({ origins }).catch(() => false);
                await rewind.refresh();
                return result;
              })
            }
          />
        ) : null}
        {settings.capture.rewind && !rewind.host ? (
          <p className="muted">Rewind only runs on http(s) pages.</p>
        ) : null}
        <button
          type="button"
          disabled={busy || !rewind.status?.allowed || (rewind.status?.events ?? 0) === 0}
          onClick={() =>
            run(async () => {
              const result = await sendMessage<{ ok: boolean; error?: string }>({
                type: 'rewind:capture',
              });
              if (result?.ok) window.close();
              return result;
            })
          }
        >
          ⏪ Save last {formatDuration(rewind.status?.durationMs ?? 0)} (Alt+Shift+R)
        </button>
      </div>

      <div className="card">
        <div className="spread">
          <h3>Reports</h3>
          <span className="muted">{reports.length ? `${reports.length} recent` : 'none yet'}</span>
        </div>
        <ul className="reports">
          {reports.map((report) => (
            <li key={report.id} className="spread">
              <button
                type="button"
                className="ghost report-link"
                onClick={() =>
                  chrome.tabs.create({ url: chrome.runtime.getURL(`report.html?id=${report.id}`) })
                }
                title={report.title}
              >
                <span className="report-title">{report.title || 'Untitled'}</span>
                <span className="muted">{new Date(report.createdAt).toLocaleString()}</span>
              </button>
              <button
                type="button"
                className="ghost danger"
                aria-label={`Delete ${report.title}`}
                onClick={() => run(async () => deleteReport(report.id))}
              >
                🗑
              </button>
            </li>
          ))}
          {reports.length === 0 ? <li className="muted">Start a capture to create one.</li> : null}
        </ul>
      </div>

      {usage && usage.quotaBytes > 0 ? (
        <div className="card">
          <div className="spread">
            <h3>Storage</h3>
            <span className="muted">
              {formatBytes(usage.usageBytes)} / {formatBytes(usage.quotaBytes)}
            </span>
          </div>
          <div
            className="meter"
            role="progressbar"
            aria-valuenow={Math.round(usage.percent)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${Math.max(2, usage.percent)}%` }} />
          </div>
        </div>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Popup />);
