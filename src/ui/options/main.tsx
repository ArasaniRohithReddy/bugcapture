import { createRoot } from 'react-dom/client';
import '../shared/styles.css';
import './options.css';
import { DomainList, Field, Toggle, useSettings, useTheme } from '../shared/components';
import { REWIND_MIN_CLIP_MS, addDomain, removeDomain } from '../../core/rewind';
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
        <h2>Rewind</h2>
        <p className="muted">
          Rewind keeps a rolling buffer of the last couple of minutes so a bug that already happened
          can still be captured. It is off by default and only ever runs on sites listed below; the
          buffer stays on this device, is continuously overwritten and is only saved when you ask
          for it.
        </p>
        <Toggle
          label="Enable Rewind"
          hint="Master switch. With this off, nothing is buffered anywhere."
          checked={settings.capture.rewind}
          onChange={(rewind) => setCapture({ rewind })}
        />
        <Field label="Buffer length (seconds)">
          <input
            type="number"
            min={REWIND_MIN_CLIP_MS / 1000}
            max={600}
            value={settings.capture.rewindBufferSeconds}
            onChange={(e) =>
              setCapture({
                rewindBufferSeconds: Math.min(
                  600,
                  Math.max(REWIND_MIN_CLIP_MS / 1000, Number(e.target.value) || 120),
                ),
              })
            }
          />
        </Field>
        <DomainList
          label="Sites Rewind may buffer"
          hint="Opt a site in from the popup so BugCapture can ask for access to it."
          domains={settings.capture.rewindSites}
          onAdd={(domain) =>
            setCapture({ rewindSites: addDomain(settings.capture.rewindSites, domain) })
          }
          onRemove={(domain) =>
            setCapture({ rewindSites: removeDomain(settings.capture.rewindSites, domain) })
          }
        />
        <DomainList
          label="Blocked sites"
          hint="Never buffered, even if the site is opted in. Subdomains are covered too."
          domains={settings.capture.rewindBlockedSites}
          onAdd={(domain) =>
            setCapture({
              rewindBlockedSites: addDomain(settings.capture.rewindBlockedSites, domain),
            })
          }
          onRemove={(domain) =>
            setCapture({
              rewindBlockedSites: removeDomain(settings.capture.rewindBlockedSites, domain),
            })
          }
        />
        <DomainList
          label="Always allow"
          hint="Exceptions that win over a broader blocked entry."
          domains={settings.capture.rewindAlwaysAllowSites}
          onAdd={(domain) =>
            setCapture({
              rewindAlwaysAllowSites: addDomain(settings.capture.rewindAlwaysAllowSites, domain),
            })
          }
          onRemove={(domain) =>
            setCapture({
              rewindAlwaysAllowSites: removeDomain(settings.capture.rewindAlwaysAllowSites, domain),
            })
          }
        />
        <p className="muted">
          Iframes and canvas elements are never recorded and playing videos are blacked out, so the
          buffer stays small and the page stays responsive. See docs/REWIND.md.
        </p>
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
