import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/styles.css';
import { ReplayPanel } from '../report/panels';
import { useSettings, useTheme } from '../shared/components';
import { getReport } from '../../core/storage';
import type { BugReport } from '../../core/types';

function Viewer() {
  const { settings } = useSettings();
  useTheme(settings.theme);
  const [report, setReport] = useState<BugReport>();
  const [loading, setLoading] = useState(true);
  const id = new URLSearchParams(location.search).get('id');

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

  if (loading) return <main className="viewer">Loading replay…</main>;
  if (!report) {
    return (
      <main className="viewer">
        <h1>Replay not found</h1>
        <p className="muted">Open a report from the BugCapture popup, then use the Replay tab.</p>
      </main>
    );
  }

  return (
    <main className="viewer">
      <header className="spread">
        <h1>{report.title || 'Session replay'}</h1>
        <a href={`report.html?id=${report.id}`}>Back to report</a>
      </header>
      <p className="muted">
        {report.replayEvents.length} rrweb events · captured{' '}
        {new Date(report.createdAt).toLocaleString()}
      </p>
      <ReplayPanel events={report.replayEvents} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Viewer />);
