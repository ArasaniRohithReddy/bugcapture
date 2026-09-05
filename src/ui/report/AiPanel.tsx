/** AI assistance panel: consent, payload preview, generation and results. */
import { useState } from 'react';
import { AiError, runAi } from '../../ai/client';
import {
  buildAiPayload,
  buildErrorExplanationPrompt,
  buildNetworkSummaryPrompt,
  buildReportPrompt,
  payloadPreview,
  type AiPrompt,
} from '../../ai/prompt';
import { parseGeneratedReport } from '../../ai/parse';
import { findSimilarReports } from '../../ai/similarity';
import { listReports } from '../../core/storage';
import type { AiOutput, BugReport, Settings } from '../../core/types';
import { Dialog } from '../shared/components';

type Action = 'report' | 'error' | 'network';

const ACTION_LABELS: Record<Action, string> = {
  report: 'Generate bug report',
  error: 'Explain top error',
  network: 'Summarize network failures',
};

export function AiPanel({
  report,
  settings,
  notes,
  onConsent,
  onApply,
  onSaveOutput,
}: {
  report: BugReport;
  settings: Settings;
  notes: string;
  onConsent: () => Promise<void>;
  onApply: (patch: Partial<BugReport>) => void;
  onSaveOutput: (output: AiOutput) => void;
}) {
  const [action, setAction] = useState<Action>('report');
  const [preview, setPreview] = useState<{ prompt: AiPrompt; payloadText: string }>();
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [duplicates, setDuplicates] = useState<Array<{ id: string; title: string; why: string }>>();

  const payload = buildAiPayload(report, notes, settings.redaction);

  const promptFor = (kind: Action): AiPrompt => {
    if (kind === 'error') {
      const topError = report.console.find((entry) => entry.level === 'error') ?? report.console[0];
      if (!topError) throw new AiError('There are no console entries to explain.');
      return buildErrorExplanationPrompt(topError, notes);
    }
    if (kind === 'network') return buildNetworkSummaryPrompt(report.network);
    return buildReportPrompt(payload);
  };

  const openPreview = () => {
    setError('');
    try {
      setPreview({ prompt: promptFor(action), payloadText: payloadPreview(payload) });
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const send = async () => {
    if (!preview) return;
    setRunning(true);
    setOutput('');
    setError('');
    try {
      if (!settings.ai.consentGivenAt) await onConsent();
      const result = await runAi({
        prompt: preview.prompt,
        ai: { ...settings.ai, consentGivenAt: settings.ai.consentGivenAt ?? Date.now() },
        backend: settings.backend,
        onToken: settings.ai.streaming
          ? (chunk) => setOutput((current) => current + chunk)
          : undefined,
      });
      const text = result.text || output;
      setOutput(text);
      if (text) {
        onSaveOutput({
          generatedAt: Date.now(),
          provider: result.provider,
          model: result.model,
          kind:
            action === 'report'
              ? 'report'
              : action === 'error'
                ? 'error-explanation'
                : 'network-summary',
          content: text,
        });
      }
      setPreview(undefined);
    } catch (caught) {
      setError((caught as Error).message);
      setPreview(undefined);
    } finally {
      setRunning(false);
    }
  };

  const findDuplicates = async () => {
    const all = await listReports();
    setDuplicates(
      findSimilarReports(report, all).map((match) => ({
        id: match.report.id,
        title: match.report.title || 'Untitled',
        why: match.reasons.join(' · '),
      })),
    );
  };

  return (
    <div className="card">
      <div className="spread">
        <h2>AI assistance</h2>
        <span className="badge">{settings.ai.enabled ? settings.ai.mode : 'disabled'}</span>
      </div>

      {!settings.ai.enabled ? (
        <p className="muted">
          AI is disabled. Everything else — capture, replay, export, GitHub — keeps working. Enable
          it in{' '}
          <button type="button" className="ghost" onClick={() => chrome.runtime.openOptionsPage()}>
            Options
          </button>
          .
        </p>
      ) : (
        <>
          <div className="row">
            <select
              value={action}
              onChange={(event) => setAction(event.target.value as Action)}
              style={{ width: 260 }}
            >
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button type="button" className="primary" onClick={openPreview} disabled={running}>
              {running ? 'Working…' : 'Review & run'}
            </button>
            <button type="button" onClick={findDuplicates}>
              Find related reports
            </button>
          </div>
          <p className="hint">
            Nothing is sent until you review the exact redacted payload in the next step.
          </p>
        </>
      )}

      {error ? (
        <div className="notice danger" role="alert">
          {error}
        </div>
      ) : null}

      {duplicates ? (
        <div style={{ marginTop: 12 }}>
          <h3>Related reports</h3>
          {duplicates.length === 0 ? (
            <p className="muted">No similar reports found locally.</p>
          ) : (
            <ul>
              {duplicates.map((match) => (
                <li key={match.id}>
                  <a href={`report.html?id=${match.id}`}>{match.title}</a> —{' '}
                  <span className="muted">{match.why}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {output ? (
        <div style={{ marginTop: 12 }}>
          <div className="spread">
            <h3>AI output</h3>
            {action === 'report' ? (
              <button type="button" onClick={() => onApply(parseGeneratedReport(output))}>
                Apply to report fields
              </button>
            ) : null}
          </div>
          <pre>{output}</pre>
        </div>
      ) : null}

      {preview ? (
        <Dialog
          title="Review what will be sent"
          onClose={() => setPreview(undefined)}
          footer={
            <>
              <button type="button" onClick={() => setPreview(undefined)}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={send} disabled={running}>
                Send to {settings.ai.mode}
              </button>
            </>
          }
        >
          {!settings.ai.consentGivenAt ? (
            <div className="notice">
              <strong>First AI use.</strong> By continuing you agree that the redacted payload below
              leaves your browser and is sent to the provider you configured (
              <code>{settings.ai.mode}</code>). Media files, cookies and the session replay are
              never sent. Consent can be revoked in Options at any time.
            </div>
          ) : null}
          <h3>
            Payload ({payload.console.length} console, {payload.network.length} network entries)
          </h3>
          <pre style={{ maxHeight: 240 }}>{preview.payloadText}</pre>
          <h3>Prompt</h3>
          <pre style={{ maxHeight: 200 }}>{preview.prompt.user}</pre>
        </Dialog>
      ) : null}
    </div>
  );
}
