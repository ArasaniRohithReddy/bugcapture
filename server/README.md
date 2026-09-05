# BugCapture Server

Self-hostable backend for the [BugCapture](https://github.com/ArasaniRohithReddy/bugcapture) Chrome extension.

## Quick Start

```bash
cd server
cp .env.example .env   # edit as needed
npm install
npm run dev            # starts with hot-reload via tsx
```

## Docker

```bash
cd server
cp .env.example .env   # configure AUTH_TOKEN, AI keys, etc.
docker compose up -d
```

The server listens on port 3000 by default. Data is persisted in a named Docker volume.

## Environment Variables

| Variable                | Default              | Description                                                                                          |
| ----------------------- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| `PORT`                  | `3000`               | Server listen port                                                                                   |
| `DATA_DIR`              | `./data`             | Report storage directory                                                                             |
| `PUBLIC_URL`            | _(empty)_            | Base URL for report links (e.g. `https://bugs.example.com`). When unset, relative URLs are returned. |
| `AUTH_TOKEN`            | _(empty)_            | ****** for write endpoints. **If unset, all endpoints are unprotected** (for local dev).             |
| `REQUIRE_AUTH_FOR_READ` | `false`              | Gate viewer/media/JSON read endpoints behind auth                                                    |
| `ALLOWED_ORIGINS`       | `*`                  | Comma-separated CORS origins                                                                         |
| `MAX_UPLOAD_BYTES`      | `209715200` (200 MB) | Maximum total upload size                                                                            |
| `MAX_FILE_BYTES`        | `52428800` (50 MB)   | Maximum single file size                                                                             |
| `AI_PROVIDER`           | `auto`               | `openai`, `anthropic`, or `auto` (picks whichever key is set)                                        |
| `OPENAI_API_KEY`        | _(empty)_            | OpenAI API key for the AI proxy                                                                      |
| `ANTHROPIC_API_KEY`     | _(empty)_            | Anthropic API key for the AI proxy                                                                   |

## API Reference

### `GET /api/health`

Returns `{ ok: true, version }`. No auth required.

### `POST /api/reports`

Upload a bug report. Multipart form-data with fields:

- `report` — JSON blob (the BugReport object without `replayEvents`)
- `replay` — JSON blob (array of rrweb events)
- `media` — zero or more files (video/webm, image/png, image/jpeg)

Authorization: `******

Returns `{ id, url }` (201).

### `GET /api/reports/:id`

Self-contained HTML viewer page for a report. Public by default.

### `GET /api/reports/:id/report.json`

Raw report JSON.

### `GET /api/reports/:id/media/:file`

Streams a stored media file.

### `POST /api/ai/generate`

Proxy to OpenAI or Anthropic.

Body: `{ system, user, model?, stream? }`

Authorization: `******

- **Non-streaming**: returns `{ text, model }`
- **Streaming**: SSE with `data: {"delta":"..."}` lines, terminated by `data: [DONE]`

Returns 503 when no provider key is configured.

## Scripts

| Script              | Description                        |
| ------------------- | ---------------------------------- |
| `npm run dev`       | Development server with hot-reload |
| `npm run build`     | Compile TypeScript to `dist/`      |
| `npm start`         | Run compiled server                |
| `npm test`          | Run tests with vitest              |
| `npm run typecheck` | Type-check without emitting        |

## Security Notes

- All user content in the HTML viewer is HTML-escaped to prevent XSS.
- The viewer is served with a restrictive Content Security Policy.
- ****** comparison uses `crypto.timingSafeEqual`.
- Media uploads are restricted to `video/webm`, `image/png`, `image/jpeg`.
- Filenames are sanitized against path traversal.
- The AI proxy never leaks provider API keys or raw provider errors.
- Per-IP rate limiting is applied to the AI proxy endpoint.
