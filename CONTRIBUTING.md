# Contributing to BugCapture

Thanks for helping out! BugCapture is MIT-licensed and contributions of any size are welcome.

## Getting set up

```bash
git clone https://github.com/ArasaniRohithReddy/bugcapture.git
cd bugcapture
npm install
npm run dev
```

Load `dist/` via `chrome://extensions` → **Developer mode** → **Load unpacked**. After a rebuild, press the reload button on the extension card; content scripts additionally need the page to be reloaded.

For the backend:

```bash
cd server && npm install && npm run dev
```

## Before opening a pull request

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

and, if you touched capture or storage:

```bash
npm run test:e2e
```

CI runs exactly these commands for both the extension and `server/`, so a green local run should mean a green pipeline.

## Project layout

| Path                | Contents                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/core/`         | Framework-free logic: types, redaction, serialization, network normalization, storage, settings, export |
| `src/content/`      | `MAIN`-world hooks (`injected.ts`), isolated content script, Shadow-DOM widget                          |
| `src/background/`   | MV3 service worker: capture orchestration, message router, retention cleanup                            |
| `src/offscreen/`    | `MediaRecorder` host for tab video                                                                      |
| `src/ai/`           | Payload builder, prompts, provider client, similarity, Markdown parser                                  |
| `src/integrations/` | GitHub Issues, upload, stubs                                                                            |
| `src/ui/`           | React pages: popup, options, report editor, replay viewer                                               |
| `server/`           | Self-hostable Express + TypeScript backend                                                              |
| `tests/unit/`       | Vitest unit tests                                                                                       |
| `tests/e2e/`        | Playwright test + fixture page and server                                                               |

## Conventions

- **TypeScript strict**, no `any` in new code where a real type is possible.
- **Keep `src/core/` free of `chrome.*` and DOM-framework imports** so it stays unit-testable in Node/jsdom.
- Anything that can contain user data must pass through `src/core/redact.ts` **before** it is stored or sent.
- New capture surfaces need a unit test; new UI needs to work in both themes and be keyboard reachable.
- Prettier decides formatting — do not hand-format.
- Adding a new script entry point? Register it in `scripts/build.mjs` **and** `public/manifest.json`.

## Adding a permission

Permissions are deliberately minimal. If a change needs a new one:

1. Justify it in the README permission table.
2. Prefer an **optional** permission requested at runtime.
3. Explain in the PR why the feature cannot work without it.

## Adding an integration

Implement the interface in `src/integrations/stubs.ts`, store credentials in `chrome.storage.local` only, request the host permission at runtime, and add the settings UI to the Options page.

## Commit and PR style

- Small, logically scoped commits with imperative subjects (`Add rrweb masking options`).
- Describe user-visible behaviour changes and any new data flows in the PR body.
- Include a screenshot or GIF for UI changes.

## Reporting security issues

Please do **not** open a public issue for a vulnerability. Open a private security advisory on the repository instead.
