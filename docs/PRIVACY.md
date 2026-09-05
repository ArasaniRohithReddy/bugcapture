# Privacy

BugCapture is built so that **capture is local by default**. This document states precisely what is collected, where it is stored, and the only three ways data can leave your browser.

## What is captured

Capture happens **only while a capture session is running**, and **only on the tab you started it on**. Nothing is recorded in the background.

| Data             | Details                                                                                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Console output   | `log`, `info`, `warn`, `error`, `debug`, plus `window.onerror` and `unhandledrejection`. Includes timestamps, levels, serialized arguments and stack traces.                                                                      |
| Network activity | `fetch` and `XMLHttpRequest` only: method, URL, status, duration, initiator, request/response headers, and bodies truncated at a configurable limit (default 64 KB). Failed and CORS-blocked requests are recorded as status `0`. |
| Session replay   | rrweb DOM mutation/input/scroll events for the recorded tab.                                                                                                                                                                      |
| Video            | The recorded tab's video, plus tab audio, plus microphone audio **only if you enable it**.                                                                                                                                        |
| Screenshots      | The visible area of the tab, on demand or on stop, plus any annotations you draw.                                                                                                                                                 |
| Environment      | URL, page title, user agent, browser and version, OS, viewport and screen size, device pixel ratio, language, timezone, cookies-enabled, online status, `navigator.deviceMemory`, extension version.                              |

**Not captured:** browsing history, other tabs, cookies (the API is not requested), passwords typed into masked fields, `chrome://` pages, or anything at all when no capture is running.

## Redaction

Redaction runs **before the report is written to storage** — the unredacted values never reach IndexedDB — and again when an AI payload is built.

Always removed:

- Headers: `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, `X-Auth-Token`, and similar.
- Values: JWTs, `bearer`/`basic`/`token` credentials, `sk-…`, `ghp_…`, `github_pat_…`, `AKIA…`, `AIza…`, `xox?-…` keys.
- Secret-looking JSON properties (`password`, `api_key`, `access_token`, `secret`, …) and the equivalent query parameters.

Enabled by default, configurable in Options:

- Email addresses.
- Credit-card-like numbers (only when they pass a Luhn checksum, to avoid mangling order IDs).
- Your own custom regular expressions.

For session replay:

- **All inputs are masked** and password fields are masked unconditionally.
- Elements with `data-bugcapture-mask` are masked; you can add CSS selectors in Options to block or mask entire regions.

> Redaction is pattern-based and cannot be perfect. Review the Console and Network tabs in the report editor before sharing a report, and use the report editor's redaction controls to remove anything sensitive that got through.

## Where data is stored

- **Reports, logs, replay events, screenshots and video** — IndexedDB database `bugcapture` in the extension's own origin, on your machine. The `unlimitedStorage` permission exists solely so that video does not hit the default quota.
- **Settings, tokens and (in `direct` AI mode) your provider key** — `chrome.storage.local`, on your machine.
- Nothing is written to any remote system automatically. There is **no telemetry, no analytics and no crash reporting** in this extension.

Reports are deleted by the retention policy you configure (age and/or count), and can be deleted individually at any time from the popup or the report editor.

## When data leaves your browser

There are exactly three paths, all user-initiated:

1. **Upload** — you press _Upload_ in the report editor. The report bundle (redacted logs, replay, media) is sent to the backend URL **you** configured in Options, authenticated with **your** bearer token. If you configure no backend, this never happens.
2. **GitHub issue** — you press _Create GitHub issue_. The formatted Markdown report is sent to `api.github.com` using the personal access token you supplied, into the repository you specified.
3. **AI** — you press an AI action, after granting one-time consent. The redacted, size-capped payload shown to you in the preview dialog is sent to the provider you selected:
   - `proxy` → your own server, which forwards it to OpenAI/Anthropic;
   - `ollama` → `http://localhost:11434` on your own machine (no internet at all);
   - `direct` → OpenAI/Anthropic directly from your browser, with your key.

The host permission for each of these destinations is **optional** and requested at runtime — the extension has no host access until you configure an endpoint and approve it.

## AI consent

AI is disabled by default. On first use a consent dialog explains what is sent and where, and shows the **exact JSON payload** that will be transmitted. You can cancel from that dialog, and consent can be revoked in Options at any time. Every subsequent AI action shows the payload preview again before sending. Duplicate detection runs entirely locally and never sends anything.

## Direct-mode key warning

In `direct` mode your API key is stored in `chrome.storage.local`. It is readable by anyone with access to your Chrome profile directory and is billed to you for every request. Prefer `proxy` (key stays on your server) or `ollama` (no key at all) for anything beyond personal experimentation.

## Your responsibilities

Recording a real session may capture other people's personal data. Before recording:

- Get consent where required, and avoid recording production sessions containing third-party data.
- Mask sensitive regions with `data-bugcapture-mask` or Options selectors before you start.
- Review a report before uploading or filing it.

## Data deletion

- A single report: delete it from the popup list or the report editor.
- Everything: remove the extension, or use _Clear all data_ in Options — this drops the IndexedDB database and clears `chrome.storage.local`.
- Uploaded reports: delete them on your own backend; BugCapture cannot remove data from a server it does not control.
