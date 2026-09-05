/** Environment metadata collection (runs in the page context). */
import type { EnvironmentInfo } from './types';

export interface BrowserInfo {
  browser: string;
  version: string;
  os: string;
}

/** Parse a user-agent string into browser/OS names. Pure, so it is testable. */
export function parseUserAgent(userAgent: string): BrowserInfo {
  const ua = userAgent || '';
  let browser = 'Unknown';
  let version = '';

  const matchers: Array<[string, RegExp]> = [
    ['Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/],
    ['Opera', /OPR\/([\d.]+)/],
    ['Brave', /Brave\/([\d.]+)/],
    ['Firefox', /Firefox\/([\d.]+)/],
    ['Chrome', /Chrom(?:e|ium)\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari/],
  ];
  for (const [name, pattern] of matchers) {
    const match = ua.match(pattern);
    if (match) {
      browser = name;
      version = match[1] ?? '';
      break;
    }
  }

  let os = 'Unknown';
  if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/(iPhone|iPad|iPod)/.test(ua)) os = 'iOS';
  else if (/Mac OS X ([\d_.]+)/.test(ua)) {
    os = `macOS ${(ua.match(/Mac OS X ([\d_.]+)/)?.[1] ?? '').replace(/_/g, '.')}`.trim();
  } else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  return { browser, version, os };
}

/** Collect environment metadata from the current page. */
export function collectEnvironment(extensionVersion = ''): EnvironmentInfo {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { brands?: Array<{ brand: string; version: string }>; platform?: string };
  };
  const { browser, version, os } = parseUserAgent(nav.userAgent);
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;

  const info: EnvironmentInfo = {
    url: location.href,
    title: document.title,
    userAgent: nav.userAgent,
    browser,
    browserVersion: version,
    os,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    screen: { width: window.screen?.width ?? 0, height: window.screen?.height ?? 0 },
    devicePixelRatio: window.devicePixelRatio,
    language: nav.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cookiesEnabled: nav.cookieEnabled,
    online: nav.onLine,
    extensionVersion,
    capturedAt: Date.now(),
  };
  if (typeof nav.deviceMemory === 'number') info.deviceMemory = nav.deviceMemory;
  if (typeof nav.hardwareConcurrency === 'number') {
    info.hardwareConcurrency = nav.hardwareConcurrency;
  }
  if (memory) info.jsHeapSizeMB = Math.round(memory.usedJSHeapSize / (1024 * 1024));
  return info;
}

/** Placeholder used when a report is created without a live page. */
export function emptyEnvironment(extensionVersion = ''): EnvironmentInfo {
  return {
    url: '',
    title: '',
    userAgent: '',
    browser: 'Unknown',
    browserVersion: '',
    os: 'Unknown',
    viewport: { width: 0, height: 0 },
    screen: { width: 0, height: 0 },
    devicePixelRatio: 1,
    language: '',
    timezone: '',
    cookiesEnabled: false,
    online: false,
    extensionVersion,
    capturedAt: Date.now(),
  };
}
