/**
 * Floating in-page widget.
 *
 * Rendered inside a closed-off Shadow DOM with an `all: initial` reset so host
 * page CSS cannot leak in and the widget cannot leak out.
 */
import type { CaptureState } from '../core/types';
import { formatDuration } from '../core/util';

export interface WidgetHandlers {
  onStop: () => void;
  onPause: (paused: boolean) => void;
  onReport: () => void;
}

export interface Widget {
  show(): void;
  hide(): void;
  setState(state: CaptureState): void;
  destroy(): void;
}

const STYLE = `
:host { all: initial; }
.root {
  all: initial;
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 999px;
  background: #14161c;
  color: #f4f5f7;
  font: 500 13px/1.2 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ff4d4f;
  animation: pulse 1.4s ease-in-out infinite;
}
.dot.paused { background: #f0a020; animation: none; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
@media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
.timer { font-variant-numeric: tabular-nums; min-width: 44px; }
button {
  all: unset;
  cursor: pointer;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  color: inherit;
  font: inherit;
}
button:hover { background: rgba(255, 255, 255, 0.2); }
button:focus-visible { outline: 2px solid #6aa1ff; outline-offset: 2px; }
button.primary { background: #3b82f6; }
button.primary:hover { background: #2f6fd8; }
`;

export function createWidget(handlers: WidgetHandlers): Widget {
  const host = document.createElement('div');
  host.id = 'bugcapture-widget-host';
  host.setAttribute('data-bugcapture-block', '');
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = STYLE;

  const root = document.createElement('div');
  root.className = 'root';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-label', 'BugCapture recording controls');

  const dot = document.createElement('span');
  dot.className = 'dot';

  const timer = document.createElement('span');
  timer.className = 'timer';
  timer.textContent = '00:00';

  const pauseButton = document.createElement('button');
  pauseButton.type = 'button';
  pauseButton.textContent = 'Pause';

  const stopButton = document.createElement('button');
  stopButton.type = 'button';
  stopButton.className = 'primary';
  stopButton.textContent = 'Stop';

  const reportButton = document.createElement('button');
  reportButton.type = 'button';
  reportButton.textContent = 'Report bug';

  root.append(dot, timer, pauseButton, stopButton, reportButton);
  shadow.append(style, root);

  let paused = false;
  let startedAt = Date.now();
  let pausedMs = 0;
  let interval: ReturnType<typeof setInterval> | undefined;

  const tick = () => {
    if (paused) return;
    timer.textContent = formatDuration(Date.now() - startedAt - pausedMs);
  };

  pauseButton.addEventListener('click', () => {
    paused = !paused;
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
    dot.classList.toggle('paused', paused);
    handlers.onPause(paused);
  });
  stopButton.addEventListener('click', () => handlers.onStop());
  reportButton.addEventListener('click', () => handlers.onReport());

  return {
    show() {
      if (!host.isConnected) (document.body ?? document.documentElement).appendChild(host);
      startedAt = Date.now();
      pausedMs = 0;
      tick();
      interval ??= setInterval(tick, 500);
    },
    hide() {
      if (interval) clearInterval(interval);
      interval = undefined;
      host.remove();
    },
    setState(state: CaptureState) {
      paused = state.paused;
      pausedMs = state.pausedMs;
      if (state.startedAt) startedAt = state.startedAt;
      pauseButton.textContent = paused ? 'Resume' : 'Pause';
      dot.classList.toggle('paused', paused);
      if (state.recording) {
        if (!host.isConnected) (document.body ?? document.documentElement).appendChild(host);
        interval ??= setInterval(tick, 500);
        tick();
      } else {
        this.hide();
      }
    },
    destroy() {
      if (interval) clearInterval(interval);
      host.remove();
    },
  };
}
