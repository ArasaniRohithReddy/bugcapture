/**
 * Content script (isolated world).
 *
 * Owns the rrweb recording, the in-page widget and the buffers fed by the
 * MAIN-world script. It is injected on demand by the service worker, so it is
 * only present on tabs the user actively captures.
 */
import { record } from 'rrweb';
import { PAGE_MESSAGE_SOURCE, type CapturePayload, type ContentCommand, type Message, type PageMessage } from '../core/messages';
import { collectEnvironment } from '../core/env';
import type { CaptureSettings, ConsoleLogEntry, NetworkEntry } from '../core/types';
import { createWidget, type Widget } from './widget';

const MAX_CONSOLE = 2000;
const MAX_NETWORK = 1000;
const MAX_REPLAY_EVENTS = 20_000;

const consoleEntries: ConsoleLogEntry[] = [];
const networkEntries: NetworkEntry[] = [];
const replayEvents: unknown[] = [];

let stopReplay: (() => void) | undefined;
let widget: Widget | undefined;
let started = false;

function pushCapped<T>(list: T[], item: T, max: number): void {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as PageMessage | undefined;
  if (!data || data.source !== PAGE_MESSAGE_SOURCE) return;
  if (data.kind === 'console') pushCapped(consoleEntries, data.entry, MAX_CONSOLE);
  else if (data.kind === 'network') pushCapped(networkEntries, data.entry, MAX_NETWORK);
});

function sendToPage(command: ContentCommand): void {
  window.postMessage(command, window.location.origin === 'null' ? '*' : window.location.origin);
}

function startReplay(settings: CaptureSettings): void {
  if (!settings.replay || stopReplay) return;
  try {
    stopReplay =
      record({
        emit(event) {
          pushCapped(replayEvents, event, MAX_REPLAY_EVENTS);
        },
        maskAllInputs: settings.maskAllInputs,
        maskInputOptions: { password: true },
        blockSelector: settings.blockSelectors.join(',') || undefined,
        maskTextSelector: settings.maskSelectors.join(',') || undefined,
        blockClass: 'bugcapture-block',
        maskTextClass: 'bugcapture-mask',
        recordCanvas: false,
        collectFonts: false,
      }) ?? undefined;
  } catch (error) {
    console.warn('[BugCapture] Session replay could not start:', error);
  }
}

function start(settings: CaptureSettings): void {
  if (started) return;
  started = true;

  sendToPage({
    source: 'bugcapture:content',
    kind: 'configure',
    console: settings.console,
    network: settings.network,
    maxBodyBytes: settings.maxBodyBytes,
  });
  startReplay(settings);

  widget ??= createWidget({
    onStop: () => void chrome.runtime.sendMessage({ type: 'capture:stop' } satisfies Message),
    onPause: (paused) =>
      void chrome.runtime.sendMessage({
        type: paused ? 'capture:pause' : 'capture:resume',
      } satisfies Message),
    onReport: () => void chrome.runtime.sendMessage({ type: 'capture:stop' } satisfies Message),
  });
  widget.show();
}

function stop(): void {
  started = false;
  sendToPage({ source: 'bugcapture:content', kind: 'stop' });
  stopReplay?.();
  stopReplay = undefined;
  widget?.hide();
}

function collect(): CapturePayload {
  return {
    console: [...consoleEntries],
    network: [...networkEntries],
    replayEvents: [...replayEvents],
    environment: collectEnvironment(chrome.runtime.getManifest().version),
  };
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case 'content:ping':
      sendResponse({ ok: true, started });
      return false;
    case 'content:start':
      start(message.settings);
      sendResponse({ ok: true });
      return false;
    case 'content:collect':
      sendResponse(collect());
      return false;
    case 'content:stop': {
      const payload = collect();
      stop();
      sendResponse(payload);
      return false;
    }
    case 'capture:state':
      widget?.setState(message.state);
      return false;
    default:
      return false;
  }
});

// The service worker may have restarted mid-capture; ask for the current state.
void chrome.runtime
  .sendMessage({ type: 'capture:get-state' } satisfies Message)
  .then((state) => {
    if (state && (state as { recording?: boolean }).recording) widget?.setState(state as never);
  })
  .catch(() => undefined);
