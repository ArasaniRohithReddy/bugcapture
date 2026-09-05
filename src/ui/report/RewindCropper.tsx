/**
 * Timeline cropper for a Rewind clip.
 *
 * The buffered clip is trimmed from both ends before the report is kept. The
 * selection can never be shorter than ten seconds, which keeps enough context
 * around the bug for the replay to make sense.
 */
import { useMemo, useState } from 'react';
import {
  REWIND_MIN_CLIP_MS,
  clampTrim,
  cropEvents,
  eventTimestamp,
  type RewindTrim,
} from '../../core/rewind';
import type { BugReport, RewindClip } from '../../core/types';
import { formatDuration } from '../../core/util';

export function RewindCropper({
  report,
  onApply,
}: {
  report: BugReport;
  onApply: (patch: { replayEvents: unknown[]; rewind: RewindClip }) => void;
}) {
  const clip = report.rewind;
  const stamps = useMemo(
    () => report.replayEvents.map(eventTimestamp).filter((value) => value > 0),
    [report.replayEvents],
  );
  const bounds = useMemo(() => {
    if (stamps.length === 0) return undefined;
    return { start: Math.min(...stamps), end: Math.max(...stamps) };
  }, [stamps]);

  const [selection, setSelection] = useState<RewindTrim | undefined>(bounds);
  const current = selection ?? bounds;
  if (!clip || !bounds || !current) return null;

  const total = bounds.end - bounds.start;
  const selected = current.end - current.start;
  const trimmable = total > REWIND_MIN_CLIP_MS;

  const move = (next: RewindTrim) => setSelection(clampTrim(bounds, next));

  const apply = () => {
    const cropped = cropEvents(report.replayEvents, current);
    setSelection(undefined);
    onApply({
      replayEvents: cropped.events,
      rewind: {
        ...clip,
        startedAt: cropped.trim.start,
        endedAt: cropped.trim.end,
      },
    });
  };

  return (
    <section className="card rewind-cropper">
      <div className="spread">
        <h2>Rewind clip</h2>
        <span className="badge">{formatDuration(selected)} selected</span>
      </div>
      <p className="muted">
        Buffered {formatDuration(total)} ending {new Date(bounds.end).toLocaleTimeString()}. Trim
        both ends to the moment the bug happened; clips stay at least {REWIND_MIN_CLIP_MS / 1000}{' '}
        seconds long.
      </p>
      <label className="field">
        <span>Start (+{formatDuration(current.start - bounds.start)})</span>
        <input
          type="range"
          min={bounds.start}
          max={bounds.end}
          step={500}
          value={current.start}
          disabled={!trimmable}
          onChange={(event) => move({ start: Number(event.target.value), end: current.end })}
        />
      </label>
      <label className="field">
        <span>End (−{formatDuration(bounds.end - current.end)})</span>
        <input
          type="range"
          min={bounds.start}
          max={bounds.end}
          step={500}
          value={current.end}
          disabled={!trimmable}
          onChange={(event) => move({ start: current.start, end: Number(event.target.value) })}
        />
      </label>
      <div className="row">
        <button type="button" className="primary" onClick={apply} disabled={!trimmable}>
          Trim clip
        </button>
        <button type="button" onClick={() => setSelection(bounds)} disabled={!trimmable}>
          Reset
        </button>
      </div>
      {trimmable ? null : (
        <p className="hint">
          This clip is already at or below the {REWIND_MIN_CLIP_MS / 1000}-second minimum.
        </p>
      )}
    </section>
  );
}
