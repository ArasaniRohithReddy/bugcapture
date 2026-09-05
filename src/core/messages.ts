/** Typed message protocol used across popup, content, background and offscreen. */
import type { RewindEvent } from './rewind';
import type {
  CaptureSettings,
  CaptureState,
  ConsoleLogEntry,
  EnvironmentInfo,
  MediaItem,
  NetworkEntry,
} from './types';

export interface CapturePayload {
  console: ConsoleLogEntry[];
  network: NetworkEntry[];
  replayEvents: unknown[];
  environment: EnvironmentInfo;
}

export type Message =
  | { type: 'capture:start'; tabId?: number }
  | { type: 'capture:stop' }
  | { type: 'capture:pause' }
  | { type: 'capture:resume' }
  | { type: 'capture:get-state' }
  | { type: 'capture:state'; state: CaptureState }
  | { type: 'capture:screenshot'; annotate?: boolean }
  | { type: 'content:start'; settings: CaptureSettings }
  | { type: 'content:stop' }
  | { type: 'content:collect' }
  | { type: 'content:ping' }
  | { type: 'offscreen:start'; streamId: string; microphone: boolean; mediaId: string }
  | { type: 'offscreen:stop' }
  | { type: 'offscreen:pause' }
  | { type: 'offscreen:resume' }
  | { type: 'report:open'; reportId: string }
  | { type: 'rewind:events'; events: RewindEvent<unknown>[] }
  | { type: 'rewind:discard' }
  | { type: 'rewind:status'; tabId?: number }
  | { type: 'rewind:capture'; tabId?: number }
  | { type: 'rewind:consent'; domain: string; enabled: boolean };

export interface ScreenshotResult {
  media: MediaItem;
  dataUrl: string;
}

export interface RewindStatus {
  /** Whether the rolling buffer may run on this page. */
  allowed: boolean;
  /** Host of the active tab, or `''` for a page Rewind cannot run on. */
  host: string;
  /** Why buffering is off, when it is. */
  reason?: string;
  /** Number of buffered events. */
  events: number;
  /** Wall-clock length of the buffered clip, in ms. */
  durationMs: number;
}

export interface RecordingResult {
  media?: MediaItem;
  error?: string;
}

/** Promise wrapper around `chrome.runtime.sendMessage` that never rejects. */
export async function sendMessage<T = unknown>(message: Message): Promise<T | undefined> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch {
    return undefined;
  }
}

export async function sendTabMessage<T = unknown>(
  tabId: number,
  message: Message,
): Promise<T | undefined> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    return undefined;
  }
}

/** Message channel used between the MAIN-world script and the content script. */
export const PAGE_MESSAGE_SOURCE = 'bugcapture:page';

export type PageMessage =
  | { source: typeof PAGE_MESSAGE_SOURCE; kind: 'console'; entry: ConsoleLogEntry }
  | { source: typeof PAGE_MESSAGE_SOURCE; kind: 'network'; entry: NetworkEntry }
  | { source: typeof PAGE_MESSAGE_SOURCE; kind: 'ready' };

export type ContentCommand =
  | {
      source: 'bugcapture:content';
      kind: 'configure';
      maxBodyBytes: number;
      console: boolean;
      network: boolean;
    }
  | { source: 'bugcapture:content'; kind: 'stop' };
