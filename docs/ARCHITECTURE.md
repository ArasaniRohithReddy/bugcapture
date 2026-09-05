# Architecture

BugCapture is a Manifest V3 Chrome extension with an optional self-hosted backend. This document explains how the pieces fit together.

## Components

| Component                    | Runs in                    | Responsibility                                                                              |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| `src/background/index.ts`    | MV3 service worker         | Capture orchestration, message router, keyboard commands, retention cleanup                 |
| `src/content/injected.ts`    | Page `MAIN` world          | Patches `console`, `window.onerror`, `unhandledrejection`, `fetch`, `XMLHttpRequest`        |
| `src/content/index.ts`       | Isolated content world     | Buffers page events, runs the rrweb recorder, hosts the widget, returns the capture payload |
| `src/content/widget.ts`      | Isolated world, Shadow DOM | Floating recording indicator, timer, pause/stop, "Report bug"                               |
| `src/offscreen/offscreen.ts` | Offscreen document         | `MediaRecorder` for tab video; writes the blob straight to IndexedDB                        |
| `src/ui/*`                   | Extension pages            | Popup, Options, report editor, replay viewer (React 19)                                     |
| `src/core/*`                 | Everywhere                 | Types, redaction, serialization, network normalization, storage, settings, export, Markdown |
| `server/`                    | Node.js                    | Report upload + shareable viewer + AI proxy                                                 |

`src/core/` deliberately contains **no** `chrome.*` or React imports so it can be unit-tested in plain jsdom.

## Capture flow

1. The user starts a capture (popup button, `Alt+Shift+B`, or the widget).
2. The service worker resolves the target tab and injects, via `chrome.scripting`:
   - `assets/injected.js` into the **MAIN** world (needs page globals to patch), and
   - `assets/content.js` into the **ISOLATED** world.
3. It sends `content:start` with the current capture settings.
4. The MAIN-world script posts each console/network entry to the content script with `window.postMessage`, tagged `bugcapture:page`.
5. The content script buffers entries (caps: **2000** console, **1000** network, **20000** rrweb events — oldest dropped first), records rrweb events, and shows the widget.
6. If video is enabled, the worker calls `chrome.tabCapture.getMediaStreamId`, creates an offscreen document (`reasons: ['USER_MEDIA']`), and the offscreen document opens the stream with `getUserMedia({ chromeMediaSource: 'tab' })`. Tab audio is re-piped through an `AudioContext` so the tab stays audible; the microphone track is added only when opted in.
7. On stop the worker sends `content:stop`, receives the payload, takes a `captureVisibleTab` screenshot, stops the recorder, **redacts everything**, writes the report to IndexedDB and opens `report.html?id=…`.

```
Popup / command / widget
        │ capture:start
        ▼
Service worker ──chrome.scripting──► injected.js (MAIN)  ──postMessage──► content.js (ISOLATED)
        │                                                                      │ rrweb + buffers
        │ getMediaStreamId                                                     │
        ▼                                                                      │ content:stop
Offscreen document ── MediaRecorder ──► Blob ──► IndexedDB ◄────────────── redacted report
        │
        ▼
    report.html
```

## Message protocol

All messages are typed in `src/core/messages.ts`:

- `capture:*` — start / stop / pause / resume / get-state / screenshot (popup, widget, commands → worker)
- `content:*` — start / stop / collect / ping (worker → content script)
- `offscreen:*` — start / stop / pause / resume (worker → offscreen document)
- `report:open`, `settings:request-host-permission`
- `PAGE_MESSAGE_SOURCE` (`bugcapture:page`) — MAIN world → content script
- `ContentCommand` (`bugcapture:content`) — content script → MAIN world

`sendMessage`/`sendTabMessage` are promise wrappers that never reject, so a missing receiver degrades to `undefined` rather than an unhandled rejection.

## Storage

IndexedDB database `bugcapture` (via `idb`):

| Store     | Key  | Contents                                                                                              |
| --------- | ---- | ----------------------------------------------------------------------------------------------------- |
| `reports` | `id` | The full report: metadata, environment, console, network, rrweb events, AI outputs, media descriptors |
| `blobs`   | `id` | Screenshot and video `Blob`s, referenced by `MediaItem.blobId`                                        |

Media is stored separately so large binaries are never passed through `chrome.runtime` messaging or serialized with the report JSON. `navigator.storage.estimate()` powers the quota indicator, and retention cleanup (age and count limits) runs on install, on startup and after each capture.

Settings live in `chrome.storage.local` (`src/core/settings.ts`), not IndexedDB, so the service worker can read them cheaply.

## Redaction pipeline

`src/core/redact.ts` is pure and dependency-free:

1. `SENSITIVE_HEADERS` are dropped entirely (`Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, …).
2. Ordered `SECRET_RULES` replace JWTs, `bearer`/`basic`/`token` values, vendor keys (`sk-`, `ghp_`, `github_pat_`, `AKIA`, `AIza`, `xox*`), secret-looking JSON properties and query parameters.
3. Optional rules redact emails and Luhn-valid card numbers.
4. User regexes from Options are compiled last; invalid patterns are skipped silently rather than breaking a capture.

Redaction runs **before storage** and again when an AI payload is built. Media blobs are never rewritten.

## AI

`src/ai/prompt.ts` builds the size-capped, redacted `AiPayload` that is both shown in the consent preview and sent to the provider — there is no second, hidden serialization path. `src/ai/client.ts` requires `ai.enabled` **and** `ai.consentGivenAt`, then talks to the configured provider, handling SSE (proxy/OpenAI/Anthropic) and NDJSON (Ollama) streams through one shared line reader with `AbortController` timeouts. `src/ai/similarity.ts` does local TF-cosine duplicate detection with no network access at all.

## Build pipeline

MV3 content scripts and service workers must be **classic** scripts, which Vite's ESM output cannot provide, so `scripts/build.mjs` runs two passes:

1. **Vite** builds the four HTML pages (`popup`, `options`, `report`, `viewer`) as an MPA into `dist/`, emitting `assets/[name].js`.
2. **esbuild** bundles `background`, `content`, `injected` and `offscreen` as `iife`, target `chrome116`, into `dist/assets/<name>.js` — minified for production, inline sourcemaps in watch mode.

`public/` (manifest and icons) is copied verbatim. `--watch` re-runs both passes. Because the script clears `dist/` itself, Vite is configured with `emptyOutDir: false`.

`rrweb-player`'s package `exports` map only exposes `.` and `./dist/style.css`, so the standalone ZIP viewer inlines the UMD bundle through the `virtual:rrweb-player-umd` / `virtual:rrweb-player-css` aliases in `vite.config.ts`. Those aliases must use **regex** `find` values, because a string `find` does not match an id carrying a `?raw` query.

## Backend

See [`server/README.md`](../server/README.md). The extension only depends on this contract:

| Endpoint                | Contract                                                          |
| ----------------------- | ----------------------------------------------------------------- |
| `GET /api/health`       | `200` when reachable                                              |
| `POST /api/reports`     | multipart bundle → `{ id, url }`                                  |
| `GET /api/reports/:id`  | HTML viewer with media, logs and replay                           |
| `POST /api/ai/generate` | SSE stream of `data: {"delta": "…"}` terminated by `data: [DONE]` |

Any server implementing that contract can be pointed at from Options.
