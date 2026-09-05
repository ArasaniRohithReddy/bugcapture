import { describe, expect, it } from 'vitest';
import {
  REWIND_MIN_CLIP_MS,
  RewindBuffer,
  addDomain,
  clampTrim,
  cropEvents,
  domainMatches,
  evaluateRewind,
  eventTimestamp,
  hostFromUrl,
  isRewindAllowed,
  normalizeDomain,
  removeDomain,
  toggleDomain,
} from '../../src/core/rewind';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import type { CaptureSettings } from '../../src/core/types';

function capture(patch: Partial<CaptureSettings> = {}): CaptureSettings {
  return { ...DEFAULT_SETTINGS.capture, ...patch };
}

describe('RewindBuffer', () => {
  it('keeps only the configured rolling window', () => {
    const buffer = new RewindBuffer<string>(120_000);
    buffer.push('old', 0);
    buffer.push('mid', 60_000);
    buffer.push('new', 121_000);
    expect(buffer.values()).toEqual(['mid', 'new']);
  });

  it('overwrites continuously so the size stays bounded', () => {
    const buffer = new RewindBuffer<number>(10_000);
    for (let i = 0; i <= 100; i += 1) buffer.push(i, i * 1000);
    // 100s of events at 1/s in a 10s window leaves the last 11.
    expect(buffer.size).toBe(11);
    expect(buffer.values()[0]).toBe(90);
    expect(buffer.durationMs).toBe(10_000);
  });

  it('drops the oldest events once the event cap is reached', () => {
    const buffer = new RewindBuffer<number>(120_000, 5);
    for (let i = 0; i < 20; i += 1) buffer.push(i, 1_000 + i);
    expect(buffer.size).toBe(5);
    expect(buffer.values()).toEqual([15, 16, 17, 18, 19]);
  });

  it('merges batches in timestamp order', () => {
    const buffer = new RewindBuffer<string>(120_000);
    buffer.pushAll(
      [
        { timestamp: 3_000, value: 'c' },
        { timestamp: 1_000, value: 'a' },
      ],
      3_000,
    );
    buffer.pushAll([{ timestamp: 2_000, value: 'b' }], 3_000);
    expect(buffer.values()).toEqual(['a', 'b', 'c']);
    expect(buffer.startedAt).toBe(1_000);
    expect(buffer.endedAt).toBe(3_000);
  });

  it('never shrinks the window below the minimum clip length', () => {
    const buffer = new RewindBuffer<string>(1_000);
    expect(buffer.bufferMs).toBe(REWIND_MIN_CLIP_MS);
  });

  it('clears on demand', () => {
    const buffer = new RewindBuffer<string>();
    buffer.push('a');
    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.durationMs).toBe(0);
  });
});

describe('domain helpers', () => {
  it('normalises user input', () => {
    expect(normalizeDomain('  https://WWW.Example.com:8443/path?q=1 ')).toBe('example.com');
    expect(normalizeDomain('')).toBe('');
  });

  it('matches subdomains but not unrelated suffixes', () => {
    expect(domainMatches('app.example.com', 'example.com')).toBe(true);
    expect(domainMatches('example.com', 'example.com')).toBe(true);
    expect(domainMatches('notexample.com', 'example.com')).toBe(false);
    expect(domainMatches('example.com.evil.test', 'example.com')).toBe(false);
  });

  it('only accepts http(s) pages', () => {
    expect(hostFromUrl('https://example.com/a')).toBe('example.com');
    expect(hostFromUrl('chrome://extensions')).toBe('');
    expect(hostFromUrl('file:///tmp/page.html')).toBe('');
    expect(hostFromUrl(undefined)).toBe('');
  });

  it('adds, removes and toggles list entries without duplicates', () => {
    expect(addDomain(['example.com'], 'https://Example.com')).toEqual(['example.com']);
    expect(addDomain([], '  ')).toEqual([]);
    expect(removeDomain(['example.com', 'other.test'], 'EXAMPLE.com')).toEqual(['other.test']);
    expect(toggleDomain([], 'example.com')).toEqual(['example.com']);
    expect(toggleDomain(['example.com'], 'example.com')).toEqual([]);
  });
});

describe('rewind consent gating', () => {
  it('never buffers while the master toggle is off', () => {
    const settings = capture({ rewind: false, rewindSites: ['example.com'] });
    const decision = evaluateRewind(settings, 'https://example.com/checkout');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('disabled');
  });

  it('never buffers a site that has not been opted in', () => {
    const settings = capture({ rewind: true, rewindSites: ['other.test'] });
    const decision = evaluateRewind(settings, 'https://example.com/checkout');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('no-site-consent');
    expect(isRewindAllowed(settings, 'https://example.com/')).toBe(false);
  });

  it('buffers an opted-in site and its subdomains', () => {
    const settings = capture({ rewind: true, rewindSites: ['example.com'] });
    expect(isRewindAllowed(settings, 'https://example.com/a')).toBe(true);
    expect(isRewindAllowed(settings, 'https://app.example.com/a')).toBe(true);
  });

  it('lets the blocked list win over a per-site opt-in', () => {
    const settings = capture({
      rewind: true,
      rewindSites: ['example.com'],
      rewindBlockedSites: ['example.com'],
    });
    const decision = evaluateRewind(settings, 'https://example.com/');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('blocked-site');
  });

  it('lets always-allow override a broad blocked entry', () => {
    const settings = capture({
      rewind: true,
      rewindBlockedSites: ['example.com'],
      rewindAlwaysAllowSites: ['status.example.com'],
    });
    expect(isRewindAllowed(settings, 'https://status.example.com/')).toBe(true);
    expect(isRewindAllowed(settings, 'https://example.com/')).toBe(false);
  });

  it('refuses pages Rewind cannot run on', () => {
    const settings = capture({ rewind: true, rewindSites: ['example.com'] });
    expect(evaluateRewind(settings, 'chrome://extensions').reason).toBe('unsupported-page');
  });

  it('is off for every site by default', () => {
    expect(DEFAULT_SETTINGS.capture.rewind).toBe(false);
    expect(DEFAULT_SETTINGS.capture.rewindSites).toEqual([]);
    expect(isRewindAllowed(DEFAULT_SETTINGS.capture, 'https://example.com/')).toBe(false);
  });
});

describe('timeline cropper', () => {
  const clip = { start: 0, end: 120_000 };

  it('keeps a valid selection untouched', () => {
    expect(clampTrim(clip, { start: 30_000, end: 90_000 })).toEqual({
      start: 30_000,
      end: 90_000,
    });
  });

  it('enforces the ten-second minimum by growing the end', () => {
    expect(clampTrim(clip, { start: 30_000, end: 32_000 })).toEqual({
      start: 30_000,
      end: 40_000,
    });
  });

  it('pulls the start back when the selection sits at the end of the clip', () => {
    expect(clampTrim(clip, { start: 119_000, end: 120_000 })).toEqual({
      start: 110_000,
      end: 120_000,
    });
  });

  it('clamps a selection that runs outside the clip', () => {
    expect(clampTrim(clip, { start: -5_000, end: 500_000 })).toEqual(clip);
  });

  it('leaves a clip shorter than the minimum alone', () => {
    const short = { start: 0, end: 4_000 };
    expect(clampTrim(short, { start: 1_000, end: 2_000 })).toEqual(short);
  });

  it('crops rrweb events to the trimmed range', () => {
    const events = Array.from({ length: 13 }, (_, index) => ({
      type: 3,
      timestamp: index * 10_000,
    }));
    const cropped = cropEvents(events, { start: 40_000, end: 90_000 });
    expect(cropped.trim).toEqual({ start: 40_000, end: 90_000 });
    expect(cropped.events.map((event) => event.timestamp)).toEqual([
      40_000, 50_000, 60_000, 70_000, 80_000, 90_000,
    ]);
  });

  it('still returns at least ten seconds of events after a too-tight trim', () => {
    const events = Array.from({ length: 13 }, (_, index) => ({
      type: 3,
      timestamp: index * 10_000,
    }));
    const cropped = cropEvents(events, { start: 60_000, end: 61_000 });
    expect(cropped.trim.end - cropped.trim.start).toBe(REWIND_MIN_CLIP_MS);
    expect(cropped.events).toHaveLength(2);
  });

  it('handles an empty buffer and untimestamped events', () => {
    expect(cropEvents([], { start: 0, end: 10_000 }).events).toEqual([]);
    expect(eventTimestamp({})).toBe(0);
    expect(eventTimestamp(null)).toBe(0);
    expect(eventTimestamp({ timestamp: 5 })).toBe(5);
  });
});
