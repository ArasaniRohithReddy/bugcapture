# Rewind

Rewind keeps a rolling buffer of the most recent activity on a page so a bug that has **already
happened** can still be captured. There is nothing to start ahead of time: when something breaks,
open the popup and save the last couple of minutes.

## How it works

- A dedicated rrweb recorder (`src/content/rewind.ts`) runs at `document_start` and emits events
  into a time-bounded circular buffer (`src/core/rewind.ts`).
- Batches are flushed to the service worker every five seconds, which merges them, trims everything
  older than the window, and **overwrites** the tab's single entry in `chrome.storage.local`
  (`src/core/rewindStore.ts`).
- The default window is **2 minutes** (configurable between 10 and 600 seconds in settings) with a
  hard cap of 20,000 events, so a noisy page cannot grow the buffer without bound.
- The buffer belongs to the tab: it is discarded when the tab closes, when the tab navigates to a
  different host, when consent is withdrawn, at browser startup, and when "Delete all data" is used.

## Consent model

Rewind never runs without explicit consent, and consent is never implicit.

1. **Master toggle** — off by default. With it off nothing is buffered anywhere.
2. **Per-site opt-in** — enable Rewind for the current site from the popup. BugCapture then asks
   Chrome for the host permission for that site and registers the recorder for that origin only.
   The extension declares no `host_permissions`; every origin is optional and user-granted.
3. **Blocked sites** — never buffered, even when opted in.
4. **Always allow** — exceptions that win over a broader blocked entry.

Precedence is: always-allow → blocked → per-site opt-in → deny. Domains are matched against the
site and its subdomains, and can be typed by hand in settings. The recorder re-checks consent
in-page on every settings change, so a site removed from the lists stops buffering immediately and
its buffer is discarded.

## Privacy

- The buffer lives only on this device, in `chrome.storage.local`, and is continuously overwritten.
- It is **never** uploaded and never leaves the browser on its own. Turning a buffer into a report
  is always an explicit user action (popup button or `Alt+Shift+R`).
- All inputs are masked and passwords are never recorded. Elements marked
  `data-bugcapture="ignore"` are excluded, as are the `bugcapture-block`, `bugcapture-mask` and
  `bugcapture-ignore` classes.
- A saved clip becomes an ordinary report and goes through the same redaction as every other
  capture; the redaction marker is `[REDACTED BY BUGCAPTURE]`.

## Timeline cropper

Saving the buffer opens the report with a timeline cropper. Both ends can be trimmed to the moment
the bug happened, and the resulting clip is always at least **10 seconds** long: if the selection is
tighter than that it is grown outwards, and a buffer that is already shorter than 10 seconds cannot
be trimmed at all. Trimming rewrites the stored rrweb events, so the discarded parts are gone.

## Deliberate performance exclusions

These are trade-offs, not omissions. They bound the buffer size and keep the page responsive:

| Excluded          | Behaviour                            | Why                                                                       |
| ----------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| Iframes           | Not recorded at all                  | Each frame needs its own recorder and snapshot; cost grows with the page. |
| Canvas elements   | Not recorded (`recordCanvas: false`) | Canvas capture serialises frames, which dominates buffer size and janks.  |
| Playing `<video>` | Blacked out while playing            | Video frames cannot be serialised cheaply; the placeholder keeps layout.  |

A video is blacked out from the moment it starts playing and is recorded normally again once it is
paused. If replaying an iframe, a canvas, or video content matters for a particular bug, use a
regular capture with screen recording instead — Rewind is optimised for cheap, always-on buffering.

## Performance profile

- One rrweb recorder per opted-in tab; nothing runs on other tabs.
- Storage writes are batched to one per tab every five seconds.
- Memory and storage are bounded by the window (2 minutes) and the 20,000-event cap, not by how
  long the tab has been open.
- A full snapshot is taken at least twice per window, so any cropped clip can still be replayed.
