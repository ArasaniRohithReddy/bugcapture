# AI features

AI in BugCapture is **optional, opt-in and pluggable**. Capture, storage, replay and export all work with AI switched off — AI only enriches a report you already have.

## What the AI can do

| Feature                        | Input                                                                      | Output                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Generate bug report**        | Prioritized console errors, failing network calls, your notes, environment | Title, summary, steps to reproduce, expected vs actual, suggested severity, likely cause |
| **Explain the error**          | The top console error and its stack trace                                  | Plain-language explanation and a fix direction (≤200 words)                              |
| **Summarize network failures** | Failing requests, grouped by templated endpoint and status                 | Grouped causes (auth, CORS, 5xx, offline, rate limiting) and what to check next          |
| **Suggest duplicates**         | Your locally stored reports                                                | Ranked related reports with reasons — **runs entirely offline**                          |

Duplicate detection uses local TF/cosine similarity (`src/ai/similarity.ts`). It never contacts a provider, so it works even with AI disabled.

## Provider modes

Choose one in **Options → AI**.

### 1. `proxy` — recommended (default)

The extension POSTs to your self-hosted backend, which holds the provider key.

```
Extension ──► your server (/api/ai/generate) ──► OpenAI / Anthropic
```

- The provider key **never** exists in the browser.
- Central rate limiting, payload-size limits and auditing on your server.
- Setup: run the backend (see [`server/README.md`](../server/README.md)), then set the endpoint and bearer token in **Options → Backend**.

### 2. `ollama` — fully local

```
Extension ──► http://localhost:11434 (Ollama) ──► local model
```

- Nothing leaves your machine — the only mode with no third party at all.
- Setup:
  ```bash
  ollama pull llama3.1
  # Chrome extensions send an Origin header, so allow it:
  OLLAMA_ORIGINS='chrome-extension://*' ollama serve
  ```
  Then set the model to `llama3.1` (or whatever you pulled) in Options.
- Streaming uses Ollama's NDJSON format and is handled automatically.

### 3. `direct` — your own key

```
Extension ──► api.openai.com / api.anthropic.com
```

> ⚠️ **Security warning.** Your API key is stored in `chrome.storage.local`. Anyone with access to your Chrome profile directory — or any sufficiently privileged extension — can read it, and every request is billed to you. Use a restricted key with a spending cap, and never use this mode on a shared machine or for a team.

The Options UI shows this warning inline, and the extension **never ships a key of its own**.

## Consent and the payload preview

1. AI is disabled by default (`ai.enabled = false`).
2. The first AI action shows a consent screen explaining exactly what will be sent and to which destination.
3. Every AI action then shows the **exact JSON payload** that will be transmitted, already redacted, and lets you cancel.
4. Consent can be revoked at any time with **Revoke AI consent** in Options.

`runAi()` refuses to send anything unless both `ai.enabled` and `ai.consentGivenAt` are set — there is no code path that reaches a provider without consent.

## What is in the payload

Built by `buildAiPayload()` in `src/ai/prompt.ts`, and capped by default at:

- 30 console entries (errors first, then warnings, then the rest),
- 20 network entries (failures first),
- 2000 characters per text field, 500 characters per response body,
- plus the page URL/title, your notes, and a five-field environment summary.

Everything passes through the redaction engine first. Screenshots, video and raw rrweb events are **never** sent to a provider. The consent preview is generated from the same object that is serialized to the wire — there is no second, hidden path.

## Configuration reference

| Setting             | Default                  | Notes                                           |
| ------------------- | ------------------------ | ----------------------------------------------- |
| `ai.enabled`        | `false`                  | Master switch                                   |
| `ai.mode`           | `proxy`                  | `proxy` \| `ollama` \| `direct`                 |
| `ai.model`          | `gpt-4o-mini`            | Passed through to the provider                  |
| `ai.ollamaEndpoint` | `http://localhost:11434` | `ollama` mode only                              |
| `ai.directVendor`   | `openai`                 | `openai` \| `anthropic`                         |
| `ai.streaming`      | `true`                   | SSE (proxy/OpenAI/Anthropic) or NDJSON (Ollama) |
| `ai.timeoutMs`      | `60000`                  | Enforced with `AbortController`                 |

Host permissions for the chosen endpoint are **optional** and requested at runtime from the Options page.

## Streaming and error handling

`src/ai/client.ts` shares one incremental line reader across SSE and NDJSON, so tokens appear as they arrive. Failures are surfaced as readable messages rather than raw stack traces:

| Condition       | Message                                              |
| --------------- | ---------------------------------------------------- |
| `401` / `403`   | Authentication failed — check the token or key       |
| `429`           | Rate limited — wait and retry                        |
| `413`           | Payload too large — reduce the capture or the limits |
| Timeout / abort | The request timed out                                |
| Network error   | The provider could not be reached                    |

If a provider is unreachable, the report editor stays fully usable: you can still edit, export, upload and file the issue by hand.

## Adding a provider

1. Add the mode to `AiProviderMode` in `src/core/types.ts`.
2. Add request building and stream parsing to `src/ai/client.ts`.
3. Add the required origin to `requiredOriginsForAi()` so the runtime permission request covers it.
4. Add the settings UI to `src/ui/options/main.tsx`.
5. Add a unit test for the prompt/payload changes in `tests/unit/ai.test.ts`.

Prompt construction lives in `src/ai/prompt.ts` and response parsing in `src/ai/parse.ts`, both free of `chrome.*` and React so they can be unit-tested directly.
