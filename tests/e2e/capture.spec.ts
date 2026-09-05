import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SETTINGS_KEY } from '../../src/core/settings';

const distPath = fileURLToPath(new URL('../../dist', import.meta.url));
const FIXTURE_ORIGIN = 'http://127.0.0.1:5599';
const FIXTURE = `${FIXTURE_ORIGIN}/index.html`;

async function buildTestExtension(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bugcapture-e2e-'));
  await cp(distPath, dir, { recursive: true });
  return dir;
}

let context: BrowserContext;
let worker: Worker;
let extensionId: string;
/** An extension page is needed to talk to the service worker: a worker cannot message itself. */
let extensionPage: Page;

test.beforeAll(async () => {
  const extensionPath = await buildTestExtension();
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [
      '--headless=new',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
    ],
  });

  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;

  // Video needs a real tab-capture user gesture, which headless Chrome cannot grant.
  await worker.evaluate(async (key) => {
    const stored = await chrome.storage.local.get(key);
    const settings = (stored[key] as Record<string, unknown>) ?? {};
    const capture = (settings.capture as Record<string, unknown>) ?? {};
    settings.capture = { ...capture, video: false, screenshotOnStop: true };
    await chrome.storage.local.set({ [key]: settings });
  }, SETTINGS_KEY);

  extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/options.html`);
});

test.afterAll(async () => {
  await context?.close();
});

test('the built extension loads without manifest or service-worker errors', async () => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);

  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.name).toBe('BugCapture');

  await expect(extensionPage.locator('.options')).toBeVisible();
});

test('captures console logs, network logs, replay events and environment into a report', async () => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  await page.bringToFront();

  const tabId = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'http://127.0.0.1:5599/*' });
    return tab?.id;
  });
  expect(tabId).toBeDefined();

  const started = await extensionPage.evaluate(
    async (id) => chrome.runtime.sendMessage({ type: 'capture:start', tabId: id }),
    tabId,
  );
  expect(started).toMatchObject({ ok: true, state: { recording: true } });

  // The floating widget lives in a Shadow DOM injected by the content script.
  await expect(page.locator('#bugcapture-widget-host')).toBeAttached();

  await page.click('#throw');
  await page.click('#request');
  await page.waitForFunction(() => document.getElementById('log')?.textContent === 'requested');
  await page.fill('#secret', 'topsecret');

  // The stop-screenshot uses captureVisibleTab, so the fixture must be the active tab.
  await worker.evaluate(async (id) => {
    await chrome.tabs.update(id as number, { active: true });
  }, tabId);

  const stopped = (await extensionPage.evaluate(async () =>
    chrome.runtime.sendMessage({ type: 'capture:stop' }),
  )) as { ok: boolean; reportId?: string };
  expect(stopped.ok).toBe(true);
  expect(typeof stopped.reportId).toBe('string');
  const reportId = stopped.reportId!;

  const captured = (await extensionPage.evaluate(async (id) => {
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
  }, reportId)) as {
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
