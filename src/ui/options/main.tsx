import { createRoot } from 'react-dom/client';
import '../shared/styles.css';
import './options.css';
import { Field, Toggle, useSettings, useTheme } from '../shared/components';
import { DEFAULT_SETTINGS } from '../../core/settings';
import { deleteAllData, pruneOldReports, pruneOrphanBlobs } from '../../core/storage';
import type { Settings } from '../../core/types';

function Options() {
  const { settings, loaded, update } = useSettings();
  useTheme(settings.theme);
  if (!loaded) return <main className="options">Loading…</main>;
  const setCapture = (patch: Partial<Settings['capture']>) =>
    update((current) => ({ ...current, capture: { ...current.capture, ...patch } }));
  const setRedaction = (patch: Partial<Settings['redaction']>) =>
    update((current) => ({ ...current, redaction: { ...current.redaction, ...patch } }));
  return (
    <main className="options">
      <h1>BugCapture settings</h1>
      <section className="card">
        <h2>Capture</h2>
        <Toggle
          label="Record video by default"
          checked={settings.capture.video}
          onChange={(video) => setCapture({ video })}
        />
        <Toggle
          label="Include microphone audio"
          checked={settings.capture.microphone}
          onChange={(microphone) => setCapture({ microphone })}
        />
        <Toggle
          label="Capture console logs"
          checked={settings.capture.console}
          onChange={(console) => setCapture({ console })}
        />
        <Toggle
          label="Capture network logs"
          checked={settings.capture.network}
          onChange={(network) => setCapture({ network })}
        />
        <Toggle
          label="Record session replay"
          checked={settings.capture.replay}
          onChange={(replay) => setCapture({ replay })}
        />
        <Toggle
          label="Keep a 2-minute rewind buffer"
          checked={settings.capture.rewind}
          onChange={(rewind) => setCapture({ rewind })}
        />
        <Field label="Theme">
          <select
            value={settings.theme}
            onChange={(e) => update((s) => ({ ...s, theme: e.target.value as Settings['theme'] }))}
          >
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Field>
      </section>
      <section className="card">
        <h2>Privacy</h2>
        <Toggle
          label="Enable redaction"
          checked={settings.redaction.enabled}
          onChange={(enabled) => setRedaction({ enabled })}
        />
        <Toggle
          label="Redact sensitive headers"
          checked={settings.redaction.redactHeaders}
          onChange={(redactHeaders) => setRedaction({ redactHeaders })}
        />
        <Toggle
          label="Redact request/response bodies"
          checked={settings.redaction.redactBodies}
          onChange={(redactBodies) => setRedaction({ redactBodies })}
        />
        <Toggle
          label="Redact email addresses"
          checked={settings.redaction.redactEmails}
          onChange={(redactEmails) => setRedaction({ redactEmails })}
        />
        <Field label="Custom redaction patterns">
          <textarea
            value={settings.redaction.customPatterns.join('\n')}
            onChange={(e) =>
              setRedaction({
                customPatterns: e.target.value.split('\n').filter((line) => line.trim()),
              })
            }
          />
        </Field>
        <p className="muted">
          Add <code>data-bugcapture="ignore"</code> to exclude an element from replay.
        </p>
      </section>
      <section className="card">
        <h2>Data</h2>
        <Field label="Delete reports older than (days)">
          <input
            type="number"
            min={0}
            value={settings.retentionDays}
            onChange={(e) => update((s) => ({ ...s, retentionDays: Number(e.target.value) }))}
          />
        </Field>
        <button
          type="button"
          onClick={() => void pruneOldReports(settings.retentionDays).then(pruneOrphanBlobs)}
        >
          Run cleanup now
        </button>{' '}
        <button
          type="button"
          className="danger"
          onClick={() => void update(() => ({ ...DEFAULT_SETTINGS }))}
        >
          Reset settings
        </button>{' '}
        <button
          type="button"
          className="danger"
          onClick={() => {
            if (
              confirm(
                'Delete every stored report, screenshot and recording? This cannot be undone.',
              )
            ) {
              void deleteAllData();
            }
          }}
        >
          Delete all data
        </button>
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Options />);
