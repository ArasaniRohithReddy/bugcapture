/**
 * Rewind recorder (isolated world, `document_start`).
 *
 * Registered dynamically by the service worker for opted-in origins only, so
 * this script is never present on a site the user has not consented to. It
 * records rrweb events into a rolling buffer and flushes them to the service
 * worker, which keeps only the most recent window in `chrome.storage.local`.
 *
 * Deliberate exclusions (see docs/REWIND.md): iframes and canvas elements are
 * never captured and playing videos are blacked out. Serialising them would
 * make the buffer grow without bound and causes visible jank on busy pages.
 */
import { record } from 'rrweb';
import { getSettings, onSettingsChanged } from '../core/settings';
import { evaluateRewind, type RewindEvent } from '../core/rewind';
import type { Message } from '../core/messages';

/** rrweb renders blocked nodes as an opaque placeholder box. */
const BLOCK_CLASS = 'bugcapture-block';
const BLOCK_SELECTOR = 'iframe,canvas,[data-bugcapture="ignore"]';
const FLUSH_MS = 5_000;
const MAX_PENDING = 2_000;

let stopRecording: (() => void) | undefined;
let flushTimer: number | undefined;
let pending: RewindEvent<unknown>[] = [];

function markPlayingVideo(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.tagName !== 'VIDEO') return;
  // Playing video is blacked out rather than recorded frame by frame.
  if (event.type === 'play' || event.type === 'playing') target.classList.add(BLOCK_CLASS);
  else target.classList.remove(BLOCK_CLASS);
}

const VIDEO_EVENTS = ['play', 'playing', 'pause', 'ended'] as const;

function listenForVideos(): void {
  for (const type of VIDEO_EVENTS) {
    document.addEventListener(type, markPlayingVideo, true);
  }
}

function stopListeningForVideos(): void {
  for (const type of VIDEO_EVENTS) {
    document.removeEventListener(type, markPlayingVideo, true);
  }
}

async function flush(): Promise<void> {
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  try {
    await chrome.runtime.sendMessage({ type: 'rewind:events', events: batch } satisfies Message);
  } catch {
    // The service worker was asleep or the extension reloaded; the buffer is
    // best effort, so the batch is simply dropped.
  }
}

function start(bufferSeconds: number): void {
  if (stopRecording) return;
  listenForVideos();
  try {
    stopRecording =
      record({
        emit(event) {
          pending.push({ timestamp: Date.now(), value: event });
          if (pending.length > MAX_PENDING) void flush();
        },
        maskAllInputs: true,
        maskInputOptions: { password: true },
        blockClass: BLOCK_CLASS,
        blockSelector: BLOCK_SELECTOR,
        maskTextClass: 'bugcapture-mask',
        ignoreClass: 'bugcapture-ignore',
        recordCanvas: false,
        recordCrossOriginIframes: false,
        collectFonts: false,
        // Re-snapshot within the window so a cropped clip can always replay.
        checkoutEveryNms: Math.max(10_000, (bufferSeconds * 1000) / 2),
      }) ?? undefined;
  } catch (error) {
    console.warn('[BugCapture] Rewind could not start:', error);
    return;
  }
  flushTimer = setInterval(() => void flush(), FLUSH_MS) as unknown as number;
  window.addEventListener('pagehide', () => void flush());
}

function stop(): void {
  stopRecording?.();
  stopRecording = undefined;
  stopListeningForVideos();
  if (flushTimer !== undefined) clearInterval(flushTimer);
  flushTimer = undefined;
  pending = [];
}

async function sync(): Promise<void> {
  const settings = await getSettings();
  const decision = evaluateRewind(settings.capture, location.href);
  if (decision.allowed) {
    start(settings.capture.rewindBufferSeconds);
    return;
  }
  const wasRecording = stopRecording !== undefined;
  stop();
  // Withdrawing consent also discards whatever was buffered for this tab.
  if (wasRecording) {
    try {
      await chrome.runtime.sendMessage({ type: 'rewind:discard' } satisfies Message);
    } catch {
      // The service worker is asleep; the buffer expires on its own.
    }
  }
}

onSettingsChanged(() => void sync());
void sync();
