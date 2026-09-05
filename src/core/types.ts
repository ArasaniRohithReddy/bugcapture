/** Shared domain types for BugCapture. */

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export type LogSource = 'console' | 'window.onerror' | 'unhandledrejection';

export interface ConsoleLogEntry {
  id: string;
  /** Epoch milliseconds. */
  timestamp: number;
  level: LogLevel;
  /** Human readable, already-serialized arguments. */
  args: string[];
  /** Single-line rendering of `args`, used for previews and prompts. */
  text: string;
  stack?: string;
  source: LogSource;
  /** Page URL the entry was recorded on. */
  url?: string;
}

export type NetworkInitiator = 'fetch' | 'xhr';

export interface NetworkEntry {
  id: string;
  startedAt: number;
  /** Milliseconds; `undefined` while the request is still in flight. */
  duration?: number;
  method: string;
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  initiator: NetworkInitiator;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  requestBodyTruncated?: boolean;
  responseBodyTruncated?: boolean;
  responseSize?: number;
  /** Populated for network/CORS failures, where no status is available. */
  error?: string;
}

export interface EnvironmentInfo {
  url: string;
  title: string;
  userAgent: string;
  browser: string;
  browserVersion: string;
  os: string;
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
  devicePixelRatio: number;
  language: string;
  timezone: string;
  cookiesEnabled: boolean;
  online: boolean;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  jsHeapSizeMB?: number;
  extensionVersion: string;
  capturedAt: number;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type MediaKind = 'video' | 'screenshot';

export interface MediaItem {
  id: string;
  kind: MediaKind;
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
  /** Milliseconds, video only. */
  durationMs?: number;
}

export interface AiOutput {
  generatedAt: number;
  provider: string;
  model: string;
  kind: 'report' | 'error-explanation' | 'network-summary';
  content: string;
}

export interface BugReport {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  description: string;
  severity: Severity;
  stepsToReproduce: string;
  expectedBehavior: string;
  actualBehavior: string;
  url: string;
  environment: EnvironmentInfo;
  console: ConsoleLogEntry[];
  network: NetworkEntry[];
  /** rrweb events, stored as plain JSON. */
  replayEvents: unknown[];
  media: MediaItem[];
  ai: AiOutput[];
  tags: string[];
  /** Set once the report has been uploaded to a backend. */
  remoteUrl?: string;
  /** Set once a GitHub issue has been created. */
  issueUrl?: string;
}

export type AiProviderMode = 'proxy' | 'ollama' | 'direct';

export type DirectVendor = 'openai' | 'anthropic';

export interface RedactionSettings {
  enabled: boolean;
  redactHeaders: boolean;
  redactBodies: boolean;
  redactEmails: boolean;
  redactCreditCards: boolean;
  /** Extra user-supplied regular expressions (source strings). */
  customPatterns: string[];
}

export interface CaptureSettings {
  video: boolean;
  microphone: boolean;
  console: boolean;
  network: boolean;
  replay: boolean;
  screenshotOnStop: boolean;
  /** Bytes; request/response bodies larger than this are truncated. */
  maxBodyBytes: number;
  maskAllInputs: boolean;
  /** CSS selectors blocked from the rrweb recording. */
  blockSelectors: string[];
  /** CSS selectors whose text is masked in the rrweb recording. */
  maskSelectors: string[];
}

export interface AiSettings {
  enabled: boolean;
  consentGivenAt?: number;
  mode: AiProviderMode;
  model: string;
  /** Used by the `ollama` mode. */
  ollamaEndpoint: string;
  /** Used by the `direct` mode only; stored in chrome.storage.local. */
  directVendor: DirectVendor;
  directApiKey: string;
  streaming: boolean;
  timeoutMs: number;
}

export interface BackendSettings {
  endpoint: string;
  token: string;
}

export interface GithubSettings {
  token: string;
  /** `owner/repo`. */
  repository: string;
  labels: string[];
}

export interface IntegrationSettings {
  github: GithubSettings;
  jira: { enabled: boolean; baseUrl: string; project: string; email: string; apiToken: string };
  linear: { enabled: boolean; apiKey: string; teamId: string };
  slack: { enabled: boolean; webhookUrl: string };
  webhook: { enabled: boolean; url: string; secret: string };
}

export interface Settings {
  backend: BackendSettings;
  ai: AiSettings;
  capture: CaptureSettings;
  redaction: RedactionSettings;
  integrations: IntegrationSettings;
  /** Reports older than this many days are deleted automatically. 0 disables. */
  retentionDays: number;
  theme: 'system' | 'light' | 'dark';
}

export interface CaptureState {
  recording: boolean;
  paused: boolean;
  /** Epoch ms when the current capture started. */
  startedAt?: number;
  /** Accumulated paused time in ms. */
  pausedMs: number;
  tabId?: number;
  videoActive: boolean;
}
