/**
 * MV3 service worker: orchestrates capture, storage and report creation.
 */
import { getSettings, onSettingsChanged, updateSettings } from '../core/settings';
import { emptyEnvironment } from '../core/env';
import { redactReport } from '../core/redact';
import {
  sendMessage,
  sendTabMessage,
  type CapturePayload,
  type Message,
  type RecordingResult,
  type RewindStatus,
} from '../core/messages';
import {
  REWIND_DENIAL_MESSAGES,
  REWIND_MIN_CLIP_MS,
  addDomain,
  evaluateRewind,
  normalizeDomain,
  removeDomain,
  type RewindEvent,
} from '../core/rewind';
import {
  appendRewind,
  clearAllRewind,
  clearRewind,
  clearRewindForDomain,
  readRewind,
} from '../core/rewindStore';
import {
  assignBlobs,
  getReport,
  pruneOldReports,
  pruneOrphanBlobs,
  putBlob,
  saveReport,
} from '../core/storage';
import type {
  BugReport,
  CaptureSettings,
  CaptureState,
  MediaItem,
  RedactionSettings,
} from '../core/types';
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
    await chrome.action.setBadgeBackgroundColor({ color: '#e5484d' });
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
  redaction: RedactionSettings,
): BugReport {
  const now = Date.now();
  const environment = payload?.environment ?? {
    ...emptyEnvironment(version),
    url: tab?.url ?? '',
    title: tab?.title ?? '',
  };
  const report: BugReport = {
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
    tags: [],
  };
  // Secrets must never reach storage: redact before the report is persisted.
  return redactReport(report, redaction);
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

  const report = buildReport(
    payload,
    media,
    tab,
    chrome.runtime.getManifest().version,
    settings.redaction,
  );
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

  const settings = await getSettings();
  let payload: CapturePayload | undefined;
  if (await injectContentScripts(tab.id)) {
    payload = await sendTabMessage<CapturePayload>(tab.id, { type: 'content:collect' });
  }
  const report = buildReport(
    payload,
    [media],
    tab,
    chrome.runtime.getManifest().version,
    settings.redaction,
  );
  report.title = tab.title ? `Screenshot of “${tab.title}”` : 'Screenshot';
  await saveReport(report);
  await assignBlobs([media.id], report.id);
  await openReport(report.id);
  return report.id;
}

async function setPaused(paused: boolean): Promise<CaptureState> {
  const state = await getState();
  if (!state.recording || state.paused === paused) return state;
  const now = Date.now();
  const next: CaptureState = { ...state, paused };
  if (paused) {
    next.pausedAt = now;
  } else {
    // Only the duration of this pause is added, not the whole capture so far.
    next.pausedMs = state.pausedMs + (state.pausedAt ? now - state.pausedAt : 0);
    delete next.pausedAt;
  }
  if (state.videoActive) {
    await sendMessage({ type: paused ? 'offscreen:pause' : 'offscreen:resume' });
  }
  await setState(next);
  return next;
}

/* --------------------------------------------------------------------------
 * Rewind
 *
 * The rolling buffer only runs where the user has opted in, so the recorder is
 * registered as a dynamic content script for consented origins and removed as
 * soon as consent is withdrawn. Nothing is uploaded: turning the buffer into a
 * report is always an explicit user action.
 * ------------------------------------------------------------------------ */

const REWIND_SCRIPT_ID = 'bugcapture-rewind';

/** Origin match patterns for every site currently opted into Rewind. */
function consentedOrigins(capture: CaptureSettings): string[] {
  if (!capture.rewind) return [];
  const domains = new Set<string>();
  for (const site of capture.rewindSites) {
    const domain = normalizeDomain(site);
    const blocked = capture.rewindBlockedSites.some((rule) => normalizeDomain(rule) === domain);
    if (domain && !blocked) domains.add(domain);
  }
  for (const site of capture.rewindAlwaysAllowSites) {
    const domain = normalizeDomain(site);
    if (domain) domains.add(domain);
  }
  return [...domains].flatMap((domain) => [`*://${domain}/*`, `*://*.${domain}/*`]);
}

/** Keep the registered recorder in step with the consent lists. */
async function syncRewindScripts(): Promise<void> {
  const settings = await getSettings();
  const wanted = consentedOrigins(settings.capture);
  // Only register where the user has actually granted the host permission.
  const granted: string[] = [];
  for (const pattern of wanted) {
    if (await chrome.permissions.contains({ origins: [pattern] }).catch(() => false)) {
      granted.push(pattern);
    }
  }
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [REWIND_SCRIPT_ID],
    });
    if (granted.length === 0) {
      if (existing.length)
        await chrome.scripting.unregisterContentScripts({ ids: [REWIND_SCRIPT_ID] });
      await clearAllRewind();
      return;
    }
    const script: chrome.scripting.RegisteredContentScript = {
      id: REWIND_SCRIPT_ID,
      js: ['assets/rewind.js'],
      matches: granted,
      runAt: 'document_start',
      allFrames: false,
      persistAcrossSessions: true,
    };
    if (existing.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  } catch (error) {
    console.warn('[BugCapture] Could not sync the Rewind recorder:', error);
  }
}

/** Store a flushed batch, re-checking consent against the sender's own URL. */
async function ingestRewind(
  tab: chrome.tabs.Tab | undefined,
  events: readonly RewindEvent<unknown>[],
): Promise<boolean> {
  if (!tab?.id) return false;
  const settings = await getSettings();
  const decision = evaluateRewind(settings.capture, tab.url);
  if (!decision.allowed) {
    await clearRewind(tab.id);
    return false;
  }
  await appendRewind(
    tab.id,
    decision.host,
    events,
    Math.max(REWIND_MIN_CLIP_MS, settings.capture.rewindBufferSeconds * 1000),
  );
  return true;
}

async function rewindStatus(tabId?: number): Promise<RewindStatus> {
  const settings = await getSettings();
  const tab = await getActiveTab(tabId);
  const decision = evaluateRewind(settings.capture, tab?.url);
  const stored = tab?.id === undefined ? undefined : await readRewind(tab.id);
  const timestamps = stored?.events.map((event) => event.timestamp) ?? [];
  return {
    allowed: decision.allowed,
    host: decision.host,
    reason: decision.reason ? REWIND_DENIAL_MESSAGES[decision.reason] : undefined,
    events: timestamps.length,
    durationMs: timestamps.length > 1 ? Math.max(...timestamps) - Math.min(...timestamps) : 0,
  };
}

/** Turn the buffered clip into a report. Always user initiated. */
async function captureRewind(tabId?: number): Promise<string> {
  const settings = await getSettings();
  const tab = await getActiveTab(tabId);
  const decision = evaluateRewind(settings.capture, tab?.url);
  if (!decision.allowed || tab?.id === undefined) {
    throw new Error(
      decision.reason ? REWIND_DENIAL_MESSAGES[decision.reason] : 'Rewind is unavailable here.',
    );
  }
  const stored = await readRewind(tab.id);
  if (!stored || stored.events.length === 0) {
    throw new Error('The Rewind buffer is still empty. Give it a few seconds on the page.');
  }
  const timestamps = stored.events.map((event) => event.timestamp);
  const startedAt = Math.min(...timestamps);
  const endedAt = Math.max(...timestamps);

  let payload: CapturePayload | undefined;
  if (await injectContentScripts(tab.id)) {
    payload = await sendTabMessage<CapturePayload>(tab.id, { type: 'content:collect' });
  }
  const report = buildReport(
    payload,
    [],
    tab,
    chrome.runtime.getManifest().version,
    settings.redaction,
  );
  report.title = tab.title ? `Rewind of \u201c${tab.title}\u201d` : 'Rewind capture';
  report.replayEvents = stored.events.map((event) => event.value);
  report.rewind = { startedAt, endedAt, originalStartedAt: startedAt, originalEndedAt: endedAt };
  await saveReport(report);
  await openReport(report.id);
  void runRetentionCleanup();
  return report.id;
}

/**
 * Record a per-site opt-in. The host permission itself is requested by the
 * calling extension page, because Chrome only grants it from a user gesture.
 */
async function setRewindConsent(domain: string, enabled: boolean): Promise<boolean> {
  const normalized = normalizeDomain(domain);
  if (!normalized) throw new Error('Enter a domain such as example.com.');
  const origins = [`*://${normalized}/*`, `*://*.${normalized}/*`];
  if (enabled) {
    const granted = await chrome.permissions.contains({ origins }).catch(() => false);
    if (!granted) throw new Error(`BugCapture needs access to ${normalized} to buffer it.`);
  }
  const settings = await getSettings();
  const rewindSites = enabled
    ? addDomain(settings.capture.rewindSites, normalized)
    : removeDomain(settings.capture.rewindSites, normalized);
  await updateSettings({ capture: { ...settings.capture, rewindSites } });
  if (!enabled) await clearRewindForDomain(normalized);
  await syncRewindScripts();
  return enabled;
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
    case 'rewind:events':
      ingestRewind(_sender.tab, message.events)
        .then((stored) => sendResponse({ ok: stored }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    case 'rewind:discard':
      void (async () => {
        if (_sender.tab?.id !== undefined) await clearRewind(_sender.tab.id);
        sendResponse({ ok: true });
      })();
      return true;
    case 'rewind:status':
      void rewindStatus(message.tabId).then((status) => sendResponse(status));
      return true;
    case 'rewind:capture':
      captureRewind(message.tabId)
        .then((reportId) => sendResponse({ ok: true, reportId }))
        .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
      return true;
    case 'rewind:consent':
      setRewindConsent(message.domain, message.enabled)
        .then((enabled) => sendResponse({ ok: true, enabled }))
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
      } else if (command === 'capture-rewind') {
        await captureRewind();
      }
    } catch (error) {
      console.warn('[BugCapture]', (error as Error).message);
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    // The buffer belongs to the tab and never outlives it.
    await clearRewind(tabId);
    const state = await getState();
    if (state.recording && state.tabId === tabId) await stopCapture();
  })();
});

onSettingsChanged(() => void syncRewindScripts());

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
  void syncRewindScripts();
});

chrome.runtime.onStartup?.addListener(() => {
  void setState({ ...IDLE_STATE });
  void runRetentionCleanup();
  void clearAllRewind();
  void syncRewindScripts();
});

// A revoked permission must stop the recorder immediately.
chrome.permissions.onRemoved?.addListener(() => void syncRewindScripts());
