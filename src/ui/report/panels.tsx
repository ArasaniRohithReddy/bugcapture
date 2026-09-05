/** Tab panels of the report editor. */
import { useEffect, useMemo, useRef, useState } from 'react';
import rrwebPlayer from 'rrweb-player';
import 'rrweb-player/dist/style.css';
import type { BugReport, ConsoleLogEntry, MediaItem, NetworkEntry } from '../../core/types';
import { groupFailures, isFailure } from '../../core/network';
import { formatBytes, formatTime } from '../../core/util';

export function ConsolePanel({ entries }: { entries: ConsoleLogEntry[] }) {
  const [level, setLevel] = useState<'all' | 'error' | 'warn'>('all');
  const [query, setQuery] = useState('');

  const filtered = entries.filter((entry) => {
    if (level === 'error' && entry.level !== 'error') return false;
    if (level === 'warn' && !['warn', 'error'].includes(entry.level)) return false;
    if (query && !entry.text.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <select value={level} onChange={(event) => setLevel(event.target.value as typeof level)} style={{ width: 160 }}>
          <option value="all">All levels</option>
          <option value="warn">Warnings & errors</option>
          <option value="error">Errors only</option>
        </select>
        <input
          type="search"
          placeholder="Filter console output"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ flex: 1, minWidth: 180 }}
        />
        <span className="muted">
          {filtered.length}/{entries.length}
        </span>
      </div>
      {filtered.length === 0 ? (
        <p className="muted">No console entries captured.</p>
      ) : (
        <div className="log-list">
          {filtered.map((entry) => (
            <div className="log-row" key={entry.id}>
              <span className="muted">{formatTime(entry.timestamp)}</span>
              <span className={`badge ${entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : ''}`}>
                {entry.level}
              </span>
              <span>
                {entry.text}
                {entry.stack ? <pre>{entry.stack}</pre> : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function NetworkPanel({ entries }: { entries: NetworkEntry[] }) {
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [selected, setSelected] = useState<NetworkEntry>();
  const visible = failuresOnly ? entries.filter(isFailure) : entries;
  const groups = useMemo(() => groupFailures(entries), [entries]);

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <label className="toggle">
          <input
            type="checkbox"
            checked={failuresOnly}
            onChange={(event) => setFailuresOnly(event.target.checked)}
          />
          <span>Failures only</span>
        </label>
        <span className="muted">
          {visible.length}/{entries.length} requests · {groups.length} failing endpoint(s)
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="muted">No network requests captured.</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Method</th>
              <th>URL</th>
              <th>Status</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry) => (
              <tr key={entry.id} onClick={() => setSelected(entry)} style={{ cursor: 'pointer' }}>
                <td>{entry.method}</td>
                <td>{entry.url}</td>
                <td>
                  <span className={`badge ${isFailure(entry) ? 'error' : 'ok'}`}>
                    {entry.error ? 'failed' : entry.status}
                  </span>
                </td>
                <td>{entry.duration === undefined ? '—' : `${entry.duration}ms`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="spread">
            <h3>
              {selected.method} {selected.url}
            </h3>
            <button type="button" className="ghost" onClick={() => setSelected(undefined)}>
              ✕
            </button>
          </div>
          {selected.error ? <p className="badge error">{selected.error}</p> : null}
          <h3>Request headers</h3>
          <pre>{JSON.stringify(selected.requestHeaders, null, 2)}</pre>
          {selected.requestBody ? (
            <>
              <h3>Request body{selected.requestBodyTruncated ? ' (truncated)' : ''}</h3>
              <pre>{selected.requestBody}</pre>
            </>
          ) : null}
          <h3>Response headers</h3>
          <pre>{JSON.stringify(selected.responseHeaders, null, 2)}</pre>
          {selected.responseBody ? (
            <>
              <h3>Response body{selected.responseBodyTruncated ? ' (truncated)' : ''}</h3>
              <pre>{selected.responseBody}</pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ReplayPanel({ events }: { events: unknown[] }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = container.current;
    if (!target || events.length < 2) return;
    target.innerHTML = '';
    let player: { $destroy?: () => void } | undefined;
    try {
      player = new rrwebPlayer({
        target,
        props: {
          events: events as never,
          width: Math.min(1100, target.clientWidth || 900),
          height: 480,
          autoPlay: false,
          showController: true,
        },
      }) as unknown as { $destroy?: () => void };
    } catch (error) {
      target.textContent = `Replay could not be rendered: ${(error as Error).message}`;
    }
    return () => {
      player?.$destroy?.();
      target.innerHTML = '';
    };
  }, [events]);

  if (events.length < 2) {
    return (
      <p className="muted">
        No session replay was captured. Enable “Session replay” in the popup before starting a
        capture.
      </p>
    );
  }
  return <div ref={container} className="replay-host" />;
}

export function MediaPanel({
  media,
  urls,
  onAnnotate,
  onDelete,
}: {
  media: MediaItem[];
  urls: Record<string, string>;
  onAnnotate: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
}) {
  if (media.length === 0) return <p className="muted">No video or screenshots attached.</p>;
  return (
    <div className="media-grid">
      {media.map((item) => (
        <figure key={item.id} className="card">
          {item.kind === 'video' ? (
            <video controls src={urls[item.id]} style={{ width: '100%' }} />
          ) : (
            <img src={urls[item.id]} alt={item.name} style={{ width: '100%' }} />
          )}
          <figcaption className="spread">
            <span className="muted">
              {item.name} · {formatBytes(item.size)}
            </span>
            <span className="row">
              {item.kind === 'screenshot' ? (
                <button type="button" onClick={() => onAnnotate(item)}>
                  Annotate
                </button>
              ) : null}
              <button type="button" className="danger ghost" onClick={() => onDelete(item)}>
                Remove
              </button>
            </span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function EnvironmentPanel({ report }: { report: BugReport }) {
  const env = report.environment;
  const rows: Array<[string, string]> = [
    ['URL', env.url],
    ['Page title', env.title],
    ['Browser', `${env.browser} ${env.browserVersion}`],
    ['Operating system', env.os],
    ['User agent', env.userAgent],
    ['Viewport', `${env.viewport.width}×${env.viewport.height}`],
    ['Screen', `${env.screen.width}×${env.screen.height}`],
    ['Device pixel ratio', String(env.devicePixelRatio)],
    ['Language', env.language],
    ['Timezone', env.timezone],
    ['Cookies enabled', env.cookiesEnabled ? 'yes' : 'no'],
    ['Online', env.online ? 'yes' : 'no'],
    ['Device memory', env.deviceMemory ? `${env.deviceMemory} GB` : 'n/a'],
    ['CPU cores', env.hardwareConcurrency ? String(env.hardwareConcurrency) : 'n/a'],
    ['JS heap', env.jsHeapSizeMB ? `${env.jsHeapSizeMB} MB` : 'n/a'],
    ['Extension version', env.extensionVersion],
    ['Captured at', new Date(env.capturedAt).toLocaleString()],
  ];
  return (
    <table className="data">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th style={{ width: 200 }}>{label}</th>
            <td>{value || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
