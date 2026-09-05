# BugCapture

**Open-source, self-hostable Chrome extension for bug reporting** — screen recording, console + network capture, rrweb session replay, environment metadata and optional AI-generated bug reports.

BugCapture is an MIT-licensed alternative to closed-source bug-capture tools such as BetterBugs. Everything is captured locally, stored locally in IndexedDB, and **nothing leaves your browser** unless you explicitly upload a report, file a GitHub issue, or use an AI feature.

[![CI](https://github.com/ArasaniRohithReddy/bugcapture/actions/workflows/ci.yml/badge.svg)](https://github.com/ArasaniRohithReddy/bugcapture/actions/workflows/ci.yml)

---

## Screenshots

> Placeholders — replace with real captures after loading the extension.

| Popup                           | Report editor                            | Session replay                    |
| ------------------------------- | ---------------------------------------- | --------------------------------- |
| ![Popup](docs/images/popup.png) | ![Report editor](docs/images/report.png) | ![Replay](docs/images/replay.png) |

![Capture demo](docs/images/demo.gif)

---

## Features

### Capture

- **Tab video recording** — `chrome.tabCapture` + `MediaRecorder` in an offscreen document, producing a `.webm`. Start / pause / resume / stop, with **opt-in microphone audio**. The tab stays audible while recording.
- **Screenshots** — `chrome.tabs.captureVisibleTab` plus an **annotation canvas**: rectangle, arrow, freehand pen, text, colour picker and undo.
- **Console logs** — a `MAIN`-world script patches `console.log/info/warn/error/debug`, `window.onerror` and `unhandledrejection`. Timestamps, levels, stack traces and safely serialized arguments (circular refs, DOM nodes, `Error`s, `Map`/`Set`, `BigInt`, hostile getters).
- **Network logs** — `fetch` and `XMLHttpRequest` are patched in the `MAIN` world. Method, URL, status, duration, request/response headers and bodies (truncated over a configurable limit, default **64 KB**), initiator, and **failed/CORS requests** (status `0`).
- **Session replay** — [rrweb](https://github.com/rrweb-io/rrweb) events are recorded and replayed in a bundled `rrweb-player` viewer.
- **Environment** — URL, title, user agent, browser + version, OS, viewport, screen size, DPR, language, timezone, cookies enabled, online status, device memory and extension version.

### UI

- **Popup** — start/stop, quick screenshot, capture toggles, saved-report list, storage usage, link to Options.
- **In-page floating widget** — rendered in a **Shadow DOM** so host-page CSS cannot leak in. Recording indicator, timer, pause, stop and "Report bug".
- **Report editor** (`report.html`) — title, description, severity, steps to reproduce, expected vs actual, and tabs for **Console / Network / Replay / Media / Environment**, redaction controls and AI actions.
- **Options** — backend endpoint and token, AI provider settings, capture defaults, redaction rules, integrations and data retention.
- Dark + light themes that follow `prefers-color-scheme`, keyboard accessible, and keyboard shortcuts (**Alt+Shift+B** toggle capture, **Alt+Shift+S** screenshot).

### AI (optional, off by default)

- Generate a full bug report, explain the top console error, summarize network failures, and find likely duplicate reports locally.
- Three provider modes: **proxy** (recommended), **ollama** (fully local), **direct** (your own key, with a security warning).
- Explicit consent screen on first use, with a **preview of the exact redacted payload** before anything is sent.

### Privacy

- Automatic redaction of `Authorization`, `Cookie`, `Set-Cookie` and `X-API-Key` headers, JWTs, bearer tokens, vendor API keys, secret-looking JSON properties and query parameters, plus optional email and credit-card (Luhn-validated) redaction.
- rrweb masks all inputs and password fields by default; `data-bugcapture-mask` and custom CSS selectors block or mask further elements.
- Custom redaction regexes configurable in Options.

### Export & integrations

- **GitHub Issues** — create an issue in a configured repository from the formatted Markdown report (implemented end to end).
- Export as **Markdown**, **JSON**, or a self-contained **`.zip`** (report + media + replay + standalone viewer HTML).
- Copy the formatted Markdown report to the clipboard.
- Interface stubs for Jira, Linear, Slack and generic webhooks.

---

## Install from source

```bash
git clone https://github.com/ArasaniRohithReddy/bugcapture.git
cd bugcapture
npm install
npm run build      # production build into dist/
# or: npm run dev  # watch build, reload the extension in Chrome after changes
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder.
4. Pin BugCapture to the toolbar and open a page to capture.

> Chrome 116+ is required (offscreen documents + `chrome.tabCapture.getMediaStreamId`).

### Scripts

| Command                                 | What it does                                           |
| --------------------------------------- | ------------------------------------------------------ |
| `npm run dev`                           | Watch build into `dist/`                               |
| `npm run build`                         | Production build                                       |
| `npm run typecheck`                     | `tsc --noEmit` (strict)                                |
| `npm run lint` / `npm run format:check` | ESLint / Prettier                                      |
| `npm test`                              | Vitest unit tests                                      |
| `npm run test:e2e`                      | Playwright end-to-end test against the built extension |

---

## Self-hosting the backend

The backend is optional — the extension is fully functional without it. It provides report upload with shareable links and the AI proxy that keeps provider keys off the client.

```bash
cd server
cp .env.example .env      # set AUTH_TOKEN and your provider key
docker compose up --build
```

The API is then on `http://localhost:3000`:

| Endpoint                | Purpose                                            |
| ----------------------- | -------------------------------------------------- |
| `GET /api/health`       | Health check                                       |
| `POST /api/reports`     | Upload a report bundle (multipart) → `{ id, url }` |
| `GET /api/reports/:id`  | Shareable HTML viewer (media, logs, rrweb replay)  |
| `POST /api/ai/generate` | AI proxy (streaming, rate limited, size limited)   |

Without Docker:

```bash
cd server && npm install && npm run build && npm start
```

Then in the extension's **Options** page set the endpoint to `http://localhost:3000` and paste the same bearer token. See [`server/README.md`](server/README.md) for the full configuration reference.

---

## Configuring AI

AI is **disabled by default** and requires an explicit one-time consent that shows exactly what will be sent. See [`docs/AI.md`](docs/AI.md) for details.

| Mode                | Where the key lives                    | When to use it                          |
| ------------------- | -------------------------------------- | --------------------------------------- |
| `proxy` _(default)_ | On your server, in `.env`              | Teams — no key ever reaches the browser |
| `ollama`            | Nowhere (local model)                  | Maximum privacy, fully offline          |
| `direct`            | `chrome.storage.local` on your machine | Solo experimentation only               |

> ⚠️ **Security warning for `direct` mode.** Your provider API key is stored in `chrome.storage.local`. Any other extension with sufficient permissions, or anyone with access to your Chrome profile on disk, can read it. Keys are also billed to you for every request. Use a key scoped to the minimum possible permissions with a spending cap, and prefer `proxy` or `ollama` for anything shared.

The extension never ships an API key, and capture works completely with AI disabled.

---

## Privacy

Full details in [`docs/PRIVACY.md`](docs/PRIVACY.md). In short:

- **Captured:** page URL/title, console output, network metadata and (truncated) bodies, rrweb DOM events, screenshots, tab video, and environment metadata — only while a capture is running, and only on the tab you started it on.
- **Stored:** locally, in the extension's IndexedDB (`bugcapture`). Reports are pruned by your configured retention policy.
- **Sent off-device:** nothing, unless you (a) press **Upload** — sends the report to _your_ configured backend, (b) press **Create GitHub issue** — sends the Markdown report to the GitHub API, or (c) use an **AI action** — sends the previewed, redacted payload to your chosen provider.
- **Never sent:** anything captured before redaction runs. Redaction is applied before storage and again before any AI payload is built.

### Permissions and why they are needed

| Permission                  | Why                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `activeTab`                 | Access the tab you explicitly start a capture on                                                  |
| `tabs`                      | Read the active tab's URL/title and open the report editor                                        |
| `scripting`                 | Inject the capture scripts (`MAIN` + isolated worlds) on demand                                   |
| `storage`                   | Store settings (`chrome.storage.local`)                                                           |
| `unlimitedStorage`          | Video and replay data easily exceed the default IndexedDB quota                                   |
| `tabCapture`                | Obtain the tab media stream for video recording                                                   |
| `downloads`                 | Save Markdown/JSON/ZIP exports                                                                    |
| `offscreen`                 | MV3 service workers cannot use `MediaRecorder`; recording runs in an offscreen document           |
| `optional_host_permissions` | Requested **at runtime** only for the backend/AI endpoints you configure — never granted up front |

Notably **not** requested: `<all_urls>` host permissions, `webRequest`, `debugger`, `cookies`, `history` or `identity`.

---

## Architecture

```
┌──────────┐   messages   ┌──────────────────┐   getMediaStreamId  ┌────────────────┐
│  Popup   │◄────────────►│  Service worker  │────────────────────►│ Offscreen doc  │
│ Options  │              │  (background)    │                     │ MediaRecorder  │
│ Report   │              └────────┬─────────┘                     └───────┬────────┘
└────┬─────┘                       │ chrome.scripting                      │ Blob
     │ IndexedDB                   ▼                                       ▼
     │                   ┌────────────────────┐                     ┌──────────────┐
     └──────────────────►│ IndexedDB (idb)    │◄────────────────────│  blobs store │
                         └────────▲───────────┘                     └──────────────┘
                                  │ capture payload
              ┌───────────────────┴────────────────────┐
              │ Content script (ISOLATED)              │
              │  • rrweb recorder  • Shadow-DOM widget │
              │  • buffers + caps  • redaction         │
              └───────────────────▲────────────────────┘
                                  │ window.postMessage
              ┌───────────────────┴────────────────────┐
              │ Injected script (MAIN world)           │
              │  console/onerror/unhandledrejection    │
              │  fetch / XMLHttpRequest                │
              └────────────────────────────────────────┘
```

More detail — including the build pipeline, message protocol and storage schema — in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Comparison vs BetterBugs

|                           | **BugCapture**                                 | **BetterBugs**                        |
| ------------------------- | ---------------------------------------------- | ------------------------------------- |
| License                   | MIT, open source                               | Proprietary                           |
| Hosting                   | Self-hosted or fully local                     | Vendor cloud only                     |
| Data residency            | Your machine / your server                     | Vendor servers                        |
| Video + screenshot        | ✅                                             | ✅                                    |
| Console + network logs    | ✅                                             | ✅                                    |
| Session replay            | ✅ rrweb, bundled player                       | ✅                                    |
| AI bug reports            | ✅ proxy / local Ollama / your key             | ✅ vendor-managed                     |
| Local-only AI option      | ✅ Ollama                                      | ❌                                    |
| Redaction rules           | ✅ built-in + custom regexes                   | Limited                               |
| Works offline             | ✅ (capture, storage, export)                  | ❌                                    |
| Integrations              | GitHub Issues; Jira/Linear/Slack/webhook stubs | Jira, Linear, Slack, GitHub, Asana, … |
| Team dashboard, SSO, SLAs | ❌ (bring your own)                            | ✅                                    |
| Price                     | Free                                           | Paid tiers                            |

BetterBugs is a polished commercial product with a managed team workspace. BugCapture is for teams that need to own the data, audit the code, or customise the pipeline.

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Issues and PRs are welcome.

## License

[MIT](LICENSE)
