/**
 * MV3 service worker: orchestrates capture, storage and report creation.
 */
import { getSettings } from '../core/settings';
import { emptyEnvironment } from '../core/env';
import {
  sendMessage,
  sendTabMessage,
  type CapturePayload,
  type Message,
  type RecordingResult,
} from '../core/messages';
import {
  assignBlobs,
  getReport,
  pruneOldReports,
  pruneOrphanBlobs,
  putBlob,
  saveReport,
} from '../core/storage';
import type { BugReport, CaptureState, MediaItem } from '../core/types';
import { dataUrlToBlob, uid } from '../core/util';

const STATE_KEY = 'bugcapture:capture-state';
const PENDING_MEDIA_KEY = 'bugcapture:pending-media';
const OFFSCREEN_URL = 'offscreen.html';

const IDLE_STATE: CaptureState = {
  recording: false,
  paused: false,
  pausedMs: 0,
  videoActive: false,
};

async function getState(): Promise<CaptureState> {
  const stored = await chrome.storage.session.get(STATE_KEY);
  return (stored[STATE_KEY] as CaptureState | undefined) ?? IDLE_STATE;
}

async function setState(state: CaptureState): Promise<void> {
  await chrome.storage.session.set({ [STATE_KEY]: state });
  await updateBadge(state);
  if (state.tabId !== undefined) {
    await sendTabMessage(state.tabId, { type: 'capture:state', state });
  }
}

async function updateBadge(state: CaptureState): Promise<void> {
  try {
    await chrome.action.setBadgeText({
      text: state.recording ? (state.paused ? '❚❚' : 'REC') : '',
    });
    await chrome.action.setBadgeBackgroundColor({ text: '#e5484d' } as never);
  } catch {
    // Badge updates are best effort.
  }
}

async function getActiveTab(tabId?: number): Promise<chrome.tabs.Tab | undefined> {
  if (tabId !== undefined) return chrome.tabs.get(tabId).catch(() => undefined);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isCapturableUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /^https?:|^file:/.test(url);
}

/** Inject the MAIN-world hooks and the isolated content script into a tab. */
async function injectContentScripts(tabId: number): Promise<boolean> {
  try {
    const alive = await sendTabMessage<{ ok: boolean }>(tabId, { type: 'content:ping' });
    if (alive?.ok) return true;
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ['assets/injected.js'],
      world: 'MAIN',
      injectImmediately: true,
    });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ['assets/content.js'],
      world: 'ISOLATED',
      injectImmediately: true,
    });
    return true;
  } catch (error) {
    console.warn('[BugCapture] Could not inject into tab', tabId, error);
    return false;
  }
}

async function ensureOffscreen(): Promise<boolean> {
  try {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    });
    if (existing.length > 0) return true;
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA' as chrome.offscreen.Reason],
      justification: 'Record the captured tab into a WebM video for the bug report.',
    });
    return true;
  } catch (error) {
    console.warn('[BugCapture] Offscreen document unavailable:', error);
    return false;
  }
}

async function startVideo(tabId: number, microphone: boolean): Promise<boolean> {
  if (!(await ensureOffscreen())) return false;
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    const mediaId = uid('video');
    await chrome.storage.session.set({ [PENDING_MEDIA_KEY]: mediaId });
    const result = await sendMessage<{ ok: boolean; error?: string }>({
      type: 'offscreen:start',
      streamId,
      microphone,
      mediaId,
    });
    if (!result?.ok) {
      console.warn('[BugCapture] Video recording failed to start:', result?.error);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[BugCapture] tabCapture failed:', error);
    return false;
  }
}

async function stopVideo(): Promise<MediaItem | undefined> {
  const result = await sendMessage<RecordingResult>({ type: 'offscreen:stop' });
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // Already closed.
  }
  await chrome.storage.session.remove(PENDING_MEDIA_KEY);
  if (result?.error) console.warn('[BugCapture] Recording error:', result.error);
  return result?.media;
}

async function captureScreenshot(windowId?: number): Promise<MediaItem | undefined> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId as number, {
      format: 'png',
    });
    const blob = dataUrlToBlob(dataUrl);
    const media: MediaItem = {
      id: uid('shot'),
      kind: 'screenshot',
      name: `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
      mimeType: 'image/png',
      size: blob.size,
      createdAt: Date.now(),
    };
    await putBlob(media.id, blob);
    return media;
  } catch (error) {
    console.warn('[BugCapture] Screenshot failed:', error);
    return undefined;
  }
}

function buildReport(
  payload: CapturePayload | undefined,
  media: MediaItem[],
  tab: chrome.tabs.Tab | undefined,
  version: string,
): BugReport {
  const now = Date.now();
  const environment = payload?.environment ?? {
    ...emptyEnvironment(version),
    url: tab?.url ?? '',
    title: tab?.title ?? '',
  };
  return {
    id: uid('report'),
    createdAt: now,
    updatedAt: now,
    title: tab?.title ? `Bug on “${tab.title}”` : 'Bug report',
    description: '',
    severity: 'medium',
    stepsToReproduce: '',
    expectedBehavior: '',
    actualBehavior: '',
    url: tab?.url ?? environment.url,
    environment,
    console: payload?.console ?? [],
    network: payload?.network ?? [],
    replayEvents: payload?.replayEvents ?? [],
    media,
    ai: [],
    tags: [],
  };
}

async function openReport(reportId: string): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL(`report.html?id=${reportId}`) });
}

async function startCapture(tabId?: number): Promise<CaptureState> {
  const state = await getState();
  if (state.recording) return state;

  const settings = await getSettings();
  const tab = await getActiveTab(tabId);
  if (!tab?.id || !isCapturableUrl(tab.url)) {
    throw new Error('BugCapture cannot capture this page. Open a regular http(s) page first.');
  }

  const injected = await injectContentScripts(tab.id);
  if (injected) {
    await sendTabMessage(tab.id, { type: 'content:start', settings: settings.capture });
  }

  const videoActive = settings.capture.video
    ? await startVideo(tab.id, settings.capture.microphone)
    : false;

  const next: CaptureState = {
    recording: true,
    paused: false,
    startedAt: Date.now(),
    pausedMs: 0,
    tabId: tab.id,
    videoActive,
  };
  await setState(next);
  return next;
}

async function stopCapture(): Promise<string | undefined> {
  const state = await getState();
  if (!state.recording) return undefined;

  const settings = await getSettings();
  const tab = await getActiveTab(state.tabId);
  const payload = state.tabId
    ? await sendTabMessage<CapturePayload>(state.tabId, { type: 'content:stop' })
    : undefined;

  const media: MediaItem[] = [];
  if (settings.capture.screenshotOnStop && tab?.windowId !== undefined) {
    const shot = await captureScreenshot(tab.windowId);
    if (shot) media.push(shot);
  }
  if (state.videoActive) {
    const video = await stopVideo();
    if (video) media.push(video);
  }

  await setState({ ...IDLE_STATE });

  const report = buildReport(payload, media, tab, chrome.runtime.getManifest().version);
  await saveReport(report);
  await assignBlobs(
    media.map((item) => item.id),
    report.id,
  );
  await openReport(report.id);
  void runRetentionCleanup();
  return report.id;
}

async function quickScreenshot(): Promise<string | undefined> {
  const tab = await getActiveTab();
  if (!tab?.id || !isCapturableUrl(tab.url)) {
    throw new Error('BugCapture cannot capture this page.');
  }
  const media = await captureScreenshot(tab.windowId);
  if (!media) return undefined;

  let payload: CapturePayload | undefined;
  if (await injectContentScripts(tab.id)) {
    payload = await sendTabMessage<CapturePayload>(tab.id, { type: 'content:collect' });
  }
  const report = buildReport(payload, [media], tab, chrome.runtime.getManifest().version);
  report.title = tab.title ? `Screenshot of “${tab.title}”` : 'Screenshot';
  await saveReport(report);
  await assignBlobs([media.id], report.id);
  await openReport(report.id);
  return report.id;
}

async function setPaused(paused: boolean): Promise<CaptureState> {
  const state = await getState();
  if (!state.recording || state.paused === paused) return state;
  const next: CaptureState = {
    ...state,
    paused,
    pausedMs: paused
      ? state.pausedMs
      : state.pausedMs + (Date.now() - (state.startedAt ?? Date.now())),
  };
  if (state.videoActive) {
    await sendMessage({ type: paused ? 'offscreen:pause' : 'offscreen:resume' });
  }
  await setState(next);
  return next;
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case 'capture:start':
      startCapture(message.tabId)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
      return true;
    case 'capture:stop':
      stopCapture()
        .then((reportId) => sendResponse({ ok: true, reportId }))
        .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
      return true;
    case 'capture:pause':
      void setPaused(true).then((state) => sendResponse({ ok: true, state }));
      return true;
    case 'capture:resume':
      void setPaused(false).then((state) => sendResponse({ ok: true, state }));
      return true;
    case 'capture:get-state':
      void getState().then((state) => sendResponse(state));
      return true;
    case 'capture:screenshot':
      quickScreenshot()
        .then((reportId) => sendResponse({ ok: true, reportId }))
        .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
      return true;
    case 'report:open':
      void getReport(message.reportId).then((report) => {
        if (report) void openReport(report.id);
        sendResponse({ ok: Boolean(report) });
      });
      return true;
    default:
      return false;
  }
});

chrome.commands?.onCommand.addListener((command) => {
  void (async () => {
    try {
      if (command === 'toggle-capture') {
        const state = await getState();
        if (state.recording) await stopCapture();
        else await startCapture();
      } else if (command === 'take-screenshot') {
        await quickScreenshot();
      }
    } catch (error) {
      console.warn('[BugCapture]', (error as Error).message);
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const state = await getState();
    if (state.recording && state.tabId === tabId) await stopCapture();
  })();
});

/** Retention cleanup. Runs on startup and after every capture instead of
 * requiring the extra `alarms` permission. */
async function runRetentionCleanup(): Promise<void> {
  try {
    const settings = await getSettings();
    await pruneOldReports(settings.retentionDays);
    await pruneOrphanBlobs();
  } catch (error) {
    console.warn('[BugCapture] Retention cleanup failed:', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void setState({ ...IDLE_STATE });
  void runRetentionCleanup();
});

chrome.runtime.onStartup?.addListener(() => {
  void setState({ ...IDLE_STATE });
  void runRetentionCleanup();
});
