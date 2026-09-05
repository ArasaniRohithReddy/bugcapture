import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const distPath = fileURLToPath(new URL('../../dist', import.meta.url));
const FIXTURE = 'http://127.0.0.1:5599/index.html';

let context: BrowserContext;
let worker: Worker;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [
      '--headless=new',
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
      '--no-sandbox',
    ],
  });

  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
});

test.afterAll(async () => {
  await context?.close();
});

test('captures console logs, network logs, replay events and environment into a report', async () => {
  // Video needs a real tab-capture user gesture, which headless Chrome cannot grant.
  await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('settings');
    const settings = stored.settings ?? {};
    settings.capture = { ...(settings.capture ?? {}), video: false, screenshotOnStop: true };
    await chrome.storage.local.set({ settings });
  });

  const page = await context.newPage();
  await page.goto(FIXTURE);
  await page.bringToFront();

  const tabId = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.id;
  });
  expect(tabId).toBeDefined();

  const state = await worker.evaluate(
    async (id) => chrome.runtime.sendMessage({ type: 'capture:start', tabId: id }),
    tabId,
  );
  expect(state).toMatchObject({ status: 'recording' });

  // The floating widget lives in a Shadow DOM injected by the content script.
  await expect(page.locator('#bugcapture-widget-host')).toBeAttached();

  await page.click('#throw');
  await page.click('#request');
  await page.waitForFunction(() => document.getElementById('log')?.textContent === 'requested');
  await page.fill('#secret', 'topsecret');

  const reportId = await worker.evaluate(async () =>
    chrome.runtime.sendMessage({ type: 'capture:stop' }),
  );
  expect(typeof reportId).toBe('string');

  const report = await worker.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('bugcapture');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise((resolve, reject) => {
      const request = db
        .transaction('reports')
        .objectStore('reports')
        .get(id as string);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }, reportId);

  const captured = report as {
    console: { level: string; text: string }[];
    network: { url: string; status: number; requestHeaders: Record<string, string> }[];
    replayEvents: unknown[];
    media: { kind: string }[];
    environment: { browser: string; url: string; viewport: { width: number } };
  };

  expect(captured.console.some((entry) => entry.level === 'error')).toBe(true);
  expect(captured.console.some((entry) => entry.text.includes('Checkout failed'))).toBe(true);

  const failing = captured.network.filter((entry) => entry.url.includes('/api/fail'));
  expect(failing.length).toBeGreaterThanOrEqual(2);
  expect(failing.every((entry) => entry.status === 500)).toBe(true);
  // Redaction must have stripped the Authorization header before storage.
  expect(JSON.stringify(captured.network)).not.toContain('token abc123');

  expect(captured.replayEvents.length).toBeGreaterThan(0);
  expect(captured.media.some((item) => item.kind === 'screenshot')).toBe(true);
  expect(captured.environment.browser).toBeTruthy();
  expect(captured.environment.url).toContain('/index.html');
  expect(captured.environment.viewport.width).toBeGreaterThan(0);

  await page.close();
});
