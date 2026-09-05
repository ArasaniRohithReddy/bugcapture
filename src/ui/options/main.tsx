import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/styles.css';
import './options.css';
import { Field, Tabs, Toggle, useSettings, useTheme } from '../shared/components';
import { requiredOriginsForAi } from '../../ai/client';
import { DEFAULT_SETTINGS } from '../../core/settings';
import { pruneOldReports, pruneOrphanBlobs } from '../../core/storage';
import type { Settings } from '../../core/types';

type TabId = 'backend' | 'ai' | 'capture' | 'privacy' | 'integrations' | 'data';

async function requestOrigins(origins: string[]): Promise<boolean> {
  if (origins.length === 0) return true;
  try {
    return await chrome.permissions.request({ origins });
  } catch {
    return false;
  }
}

function BackendTab({
  settings,
  update,
}: {
  settings: Settings;
  update: (updater: (current: Settings) => Settings) => Promise<void>;
}) {
  const [status, setStatus] = useState('');

  const test = async () => {
    setStatus('Testing…');
    const endpoint = settings.backend.endpoint.replace(/\/$/, '');
    if (!endpoint) {
      setStatus('Set an endpoint first.');
      return;
    }
    if (!(await requestOrigins([`${new URL(endpoint).origin}/*`]))) {
      setStatus('Permission for that origin was denied.');
      return;
    }
    try {
      const response = await fetch(`${endpoint}/api/health`);
      setStatus(response.ok ? '✅ Backend reachable.' : `❌ Backend responded ${response.status}.`);
    } catch (error) {
      setStatus(`❌ ${(error as Error).message}`);
    }
  };

  return (
    <section>
      <p className="muted">
        The backend is optional. Without it, reports stay in this browser and can still be exported
        as Markdown, JSON or a ZIP bundle.
      </p>
      <Field
        label="Backend endpoint"
        hint="Base URL of your self-hosted BugCapture server, e.g. https://bugs.example.com"
      >
        <input
          type="url"
          value={settings.backend.endpoint}
          placeholder="https://bugs.example.com"
          onChange={(event) =>
            update((current) => ({
              ...current,
              backend: { ...current.backend, endpoint: event.target.value.trim() },
            }))
          }
        />
      </Field>
      <Field label="API token" hint="Sent as a bearer token to the backend.">
        <input
          type="password"
          value={settings.backend.token}
          onChange={(event) =>
            update((current) => ({
              ...current,
              backend: { ...current.backend, token: event.target.value },
            }))
          }
        />
      </Field>
      <div className="row">
        <button type="button" onClick={test}>
          Test connection
        </button>
        <span className="muted">{status}</span>
      </div>
    </section>
  );
}

function AiTab({
  settings,
  update,
}: {
  settings: Settings;
  update: (updater: (current: Settings) => Settings) => Promise<void>;
}) {
  const [status, setStatus] = useState('');
  const ai = settings.ai;

  const grantOrigins = async () => {
    const granted = await requestOrigins(requiredOriginsForAi(ai, settings.backend));
    setStatus(granted ? '✅ Host permission granted.' : '❌ Permission denied.');
  };

  return (
    <section>
      <Toggle
        label="Enable AI features"
        checked={ai.enabled}
        hint="AI is optional. Capture, replay and export work with AI switched off."
        onChange={(enabled) => update((current) => ({ ...current, ai: { ...current.ai, enabled } }))}
      />

      <Field label="Provider mode">
        <select
          value={ai.mode}
          onChange={(event) =>
            update((current) => ({
              ...current,
              ai: { ...current.ai, mode: event.target.value as Settings['ai']['mode'] },
            }))
          }
        >
          <option value="proxy">Proxy — self-hosted backend holds the key (recommended)</option>
          <option value="ollama">Ollama — local model, nothing leaves your machine</option>
          <option value="direct">Direct — your own API key in this browser</option>
        </select>
      </Field>

      {ai.mode === 'direct' ? (
        <div className="notice danger">
          <strong>Security warning.</strong> In direct mode your API key is stored in
          <code> chrome.storage.local</code> on this machine and is sent from the browser to the
          provider. Anyone with access to this Chrome profile — or any extension with storage access
          — can read it. Prefer the proxy or Ollama mode, and use a key with a low spending cap.
        </div>
      ) : null}

      {ai.mode === 'ollama' ? (
        <Field label="Ollama endpoint" hint="Default installation listens on http://localhost:11434">
          <input
            type="url"
            value={ai.ollamaEndpoint}
            onChange={(event) =>
              update((current) => ({
                ...current,
                ai: { ...current.ai, ollamaEndpoint: event.target.value.trim() },
              }))
            }
          />
        </Field>
      ) : null}

      {ai.mode === 'direct' ? (
        <>
          <Field label="Vendor">
            <select
              value={ai.directVendor}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  ai: {
                    ...current.ai,
                    directVendor: event.target.value as Settings['ai']['directVendor'],
                  },
                }))
              }
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </Field>
          <Field label="API key" hint="Stored locally only. Never synced.">
            <input
              type="password"
              value={ai.directApiKey}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  ai: { ...current.ai, directApiKey: event.target.value.trim() },
                }))
              }
            />
          </Field>
        </>
      ) : null}

      <Field label="Model">
        <input
          type="text"
          value={ai.model}
          onChange={(event) =>
            update((current) => ({ ...current, ai: { ...current.ai, model: event.target.value } }))
          }
        />
      </Field>

      <Toggle
        label="Stream responses"
        checked={ai.streaming}
        onChange={(streaming) =>
          update((current) => ({ ...current, ai: { ...current.ai, streaming } }))
        }
      />

      <Field label="Timeout (seconds)">
        <input
          type="number"
          min={5}
          max={600}
          value={Math.round(ai.timeoutMs / 1000)}
          onChange={(event) =>
            update((current) => ({
              ...current,
              ai: { ...current.ai, timeoutMs: Number(event.target.value) * 1000 },
            }))
          }
        />
      </Field>

      <div className="row">
        <button type="button" onClick={grantOrigins}>
          Grant host permission
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() =>
            update((current) => ({ ...current, ai: { ...current.ai, consentGivenAt: undefined } }))
          }
        >
          Revoke AI consent
        </button>
        <span className="muted">
          {status ||
            (ai.consentGivenAt
              ? `Consent granted ${new Date(ai.consentGivenAt).toLocaleString()}`
              : 'Consent will be requested before the first AI call.')}
        </span>
      </div>
    </section>
  );
}

function CaptureTab({
  settings,
  update,
}: {
  settings: Settings;
  update: (updater: (current: Settings) => Settings) => Promise<void>;
}) {
  const capture = settings.capture;
  const set = (patch: Partial<Settings['capture']>) =>
    update((current) => ({ ...current, capture: { ...current.capture, ...patch } }));

  return (
    <section>
      <Toggle label="Record video by default" checked={capture.video} onChange={(video) => set({ video })} />
      <Toggle
        label="Include microphone audio"
        checked={capture.microphone}
        onChange={(microphone) => set({ microphone })}
      />
      <Toggle label="Capture console logs" checked={capture.console} onChange={(value) => set({ console: value })} />
      <Toggle label="Capture network logs" checked={capture.network} onChange={(network) => set({ network })} />
      <Toggle label="Record session replay" checked={capture.replay} onChange={(replay) => set({ replay })} />
      <Toggle
        label="Take a screenshot when the capture stops"
        checked={capture.screenshotOnStop}
        onChange={(screenshotOnStop) => set({ screenshotOnStop })}
      />
      <Field
        label="Maximum request/response body size (KB)"
        hint="Larger bodies are truncated before they are stored."
      >
        <input
          type="number"
          min={1}
          max={4096}
          value={Math.round(capture.maxBodyBytes / 1024)}
          onChange={(event) => set({ maxBodyBytes: Math.max(1, Number(event.target.value)) * 1024 })}
        />
      </Field>
      <Field label="Theme">
        <select
          value={settings.theme}
          onChange={(event) =>
            update((current) => ({ ...current, theme: event.target.value as Settings['theme'] }))
          }
        >
          <option value="system">Match system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Field>
      <p className="muted">
        Keyboard shortcuts are configured at <code>chrome://extensions/shortcuts</code> (defaults:
        Alt+Shift+B to start/stop, Alt+Shift+S for a screenshot).
      </p>
    </section>
  );
}

function PrivacyTab({
  settings,
  update,
}: {
  settings: Settings;
  update: (updater: (current: Settings) => Settings) => Promise<void>;
}) {
  const redaction = settings.redaction;
  const capture = settings.capture;
  const set = (patch: Partial<Settings['redaction']>) =>
    update((current) => ({ ...current, redaction: { ...current.redaction, ...patch } }));

  return (
    <section>
      <Toggle
        label="Enable redaction"
        checked={redaction.enabled}
        hint="Applies to logs, network bodies, exports and anything sent to AI."
        onChange={(enabled) => set({ enabled })}
      />
      <Toggle
        label="Redact sensitive headers (Authorization, Cookie, Set-Cookie, X-API-Key…)"
        checked={redaction.redactHeaders}
        onChange={(redactHeaders) => set({ redactHeaders })}
      />
      <Toggle
        label="Redact secrets in request/response bodies"
        checked={redaction.redactBodies}
        onChange={(redactBodies) => set({ redactBodies })}
      />
      <Toggle
        label="Redact email addresses"
        checked={redaction.redactEmails}
        onChange={(redactEmails) => set({ redactEmails })}
      />
      <Toggle
        label="Redact credit-card-like numbers"
        checked={redaction.redactCreditCards}
        onChange={(redactCreditCards) => set({ redactCreditCards })}
      />
      <Field
        label="Custom redaction patterns"
        hint="One JavaScript regular expression per line. Invalid patterns are ignored."
      >
        <textarea
          value={redaction.customPatterns.join('\n')}
          onChange={(event) =>
            set({ customPatterns: event.target.value.split('\n').filter((line) => line.trim()) })
          }
        />
      </Field>

      <h3>Session replay masking</h3>
      <Toggle
        label="Mask all input values"
        checked={capture.maskAllInputs}
        hint="Password fields are always masked."
        onChange={(maskAllInputs) =>
          update((current) => ({ ...current, capture: { ...current.capture, maskAllInputs } }))
        }
      />
      <Field
        label="Blocked selectors"
        hint="Comma separated. Matching elements are replaced with a placeholder in the replay."
      >
        <input
          type="text"
          value={capture.blockSelectors.join(', ')}
          onChange={(event) =>
            update((current) => ({
              ...current,
              capture: {
                ...current.capture,
                blockSelectors: event.target.value
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean),
              },
            }))
          }
        />
      </Field>
      <Field label="Masked selectors" hint="Comma separated. Matching text is replaced with asterisks.">
        <input
          type="text"
          value={capture.maskSelectors.join(', ')}
          onChange={(event) =>
            update((current) => ({
              ...current,
              capture: {
                ...current.capture,
                maskSelectors: event.target.value
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean),
              },
            }))
          }
        />
      </Field>
      <p className="muted">
        Add <code>data-bugcapture-mask</code> or <code>data-bugcapture-block</code> to elements on
        your own pages to exclude them from the replay.
      </p>
    </section>
  );
}

function IntegrationsTab({
  settings,
  update,
}: {
  settings: Settings;
  update: (updater: (current: Settings) => Settings) => Promise<void>;
}) {
  const github = settings.integrations.github;
  const setGithub = (patch: Partial<Settings['integrations']['github']>) =>
    update((current) => ({
      ...current,
      integrations: { ...current.integrations, github: { ...current.integrations.github, ...patch } },
    }));

  return (
    <section>
      <h3>GitHub Issues</h3>
      <Field label="Repository" hint="owner/repo, e.g. ArasaniRohithReddy/bugcapture">
        <input
          type="text"
          value={github.repository}
          placeholder="owner/repo"
          onChange={(event) => setGithub({ repository: event.target.value.trim() })}
        />
      </Field>
      <Field
        label="Personal access token"
        hint="Needs the `repo` scope (classic) or issues:write (fine-grained). Stored locally."
      >
        <input
          type="password"
          value={github.token}
          onChange={(event) => setGithub({ token: event.target.value.trim() })}
        />
      </Field>
      <Field label="Labels" hint="Comma separated.">
        <input
          type="text"
          value={github.labels.join(', ')}
          onChange={(event) =>
            setGithub({
              labels: event.target.value
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
            })
          }
        />
      </Field>

      <h3>Coming soon</h3>
      <p className="muted">
        Jira, Linear, Slack and generic webhook adapters are stubbed in
        <code> src/integrations/</code>. They expose the same interface as the GitHub adapter — see
        the TODOs there to finish one.
      </p>
    </section>
  );
}

function DataTab({
  settings,
  update,
}: {
  settings: Settings;
  update: (updater: (current: Settings) => Settings) => Promise<void>;
}) {
  const [status, setStatus] = useState('');

  return (
    <section>
      <Field
        label="Delete reports older than (days)"
        hint="0 keeps reports forever. Cleanup runs on browser start and after each capture."
      >
        <input
          type="number"
          min={0}
          max={3650}
          value={settings.retentionDays}
          onChange={(event) =>
            update((current) => ({ ...current, retentionDays: Number(event.target.value) }))
          }
        />
      </Field>
      <div className="row">
        <button
          type="button"
          onClick={async () => {
            const removed = await pruneOldReports(settings.retentionDays);
            const orphans = await pruneOrphanBlobs();
            setStatus(`Removed ${removed} report(s) and ${orphans} orphaned file(s).`);
          }}
        >
          Run cleanup now
        </button>
        <button
          type="button"
          className="danger"
          onClick={async () => {
            await update(() => ({ ...DEFAULT_SETTINGS }));
            setStatus('Settings reset to defaults.');
          }}
        >
          Reset settings
        </button>
        <span className="muted">{status}</span>
      </div>
    </section>
  );
}

function Options() {
  const { settings, loaded, update } = useSettings();
  useTheme(settings.theme);
  const [tab, setTab] = useState<TabId>('backend');

  if (!loaded) return <main className="options">Loading…</main>;

  return (
    <main className="options">
      <h1>BugCapture settings</h1>
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'backend', label: 'Backend' },
          { id: 'ai', label: 'AI' },
          { id: 'capture', label: 'Capture' },
          { id: 'privacy', label: 'Privacy' },
          { id: 'integrations', label: 'Integrations' },
          { id: 'data', label: 'Data' },
        ]}
      />
      <div className="card">
        {tab === 'backend' ? <BackendTab settings={settings} update={update} /> : null}
        {tab === 'ai' ? <AiTab settings={settings} update={update} /> : null}
        {tab === 'capture' ? <CaptureTab settings={settings} update={update} /> : null}
        {tab === 'privacy' ? <PrivacyTab settings={settings} update={update} /> : null}
        {tab === 'integrations' ? <IntegrationsTab settings={settings} update={update} /> : null}
        {tab === 'data' ? <DataTab settings={settings} update={update} /> : null}
      </div>
      <p className="muted">
        Settings are stored with <code>chrome.storage.local</code> and never leave this browser.
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Options />);
