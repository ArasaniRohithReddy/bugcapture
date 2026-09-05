/**
 * Offscreen document: owns the MediaRecorder for tab video capture.
 *
 * MV3 service workers have no DOM and cannot hold a MediaStream, so recording
 * happens here. The finished blob is written straight into the extension's
 * IndexedDB (same origin) to avoid shipping large payloads over messaging.
 */
import type { Message, RecordingResult } from '../core/messages';
import { putBlob } from '../core/storage';
import type { MediaItem } from '../core/types';

interface Session {
  recorder: MediaRecorder;
  stream: MediaStream;
  micStream?: MediaStream;
  chunks: Blob[];
  mediaId: string;
  startedAt: number;
  mimeType: string;
}

let session: Session | undefined;

function pickMimeType(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'video/webm';
}

async function start(streamId: string, microphone: boolean, mediaId: string): Promise<void> {
  if (session) throw new Error('A recording is already in progress.');

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
    } as unknown as MediaTrackConstraints,
    video: {
      mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
    } as unknown as MediaTrackConstraints,
  });

  // Keep the tab's own audio audible while it is being captured.
  const audioContext = new AudioContext();
  audioContext.createMediaStreamSource(stream).connect(audioContext.destination);

  let micStream: MediaStream | undefined;
  if (microphone) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of micStream.getAudioTracks()) stream.addTrack(track);
    } catch (error) {
      console.warn('[BugCapture] Microphone unavailable:', error);
    }
  }

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start(1000);

  session = { recorder, stream, chunks, mediaId, startedAt: Date.now(), mimeType };
  if (micStream) session.micStream = micStream;
}

function stopTracks(current: Session): void {
  for (const track of current.stream.getTracks()) track.stop();
  current.micStream?.getTracks().forEach((track) => track.stop());
}

async function stop(): Promise<RecordingResult> {
  const current = session;
  if (!current) return { error: 'No recording in progress.' };
  session = undefined;

  const blob = await new Promise<Blob>((resolve) => {
    current.recorder.onstop = () => resolve(new Blob(current.chunks, { type: current.mimeType }));
    if (current.recorder.state === 'inactive') {
      resolve(new Blob(current.chunks, { type: current.mimeType }));
    } else {
      current.recorder.stop();
    }
  });
  stopTracks(current);

  if (blob.size === 0) return { error: 'Recording produced no data.' };

  const media: MediaItem = {
    id: current.mediaId,
    kind: 'video',
    name: `recording-${new Date(current.startedAt).toISOString().replace(/[:.]/g, '-')}.webm`,
    mimeType: current.mimeType,
    size: blob.size,
    createdAt: current.startedAt,
    durationMs: Date.now() - current.startedAt,
  };
  await putBlob(media.id, blob);
  return { media };
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case 'offscreen:start':
      start(message.streamId, message.microphone, message.mediaId)
        .then(() => sendResponse({ ok: true }))
        .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
      return true;
    case 'offscreen:stop':
      stop()
        .then(sendResponse)
        .catch((error: Error) => sendResponse({ error: error.message } satisfies RecordingResult));
      return true;
    case 'offscreen:pause':
      if (session?.recorder.state === 'recording') session.recorder.pause();
      sendResponse({ ok: true });
      return false;
    case 'offscreen:resume':
      if (session?.recorder.state === 'paused') session.recorder.resume();
      sendResponse({ ok: true });
      return false;
    default:
      return false;
  }
});
