# BugCapture

BugCapture is a local-first Manifest V3 extension for recording reproducible browser bugs.
It captures video, screenshots, console and network evidence, rrweb replay, and environment
metadata into IndexedDB. Nothing is uploaded and there are no provider keys, OAuth flows, or
backend services.

## Features

- Local report editor with redaction and JSON/Markdown/ZIP export.
- **Copy as AI prompt**: formats a prompt for any AI tool without sending it. Evidence is redacted;
  title, description, steps, expected behavior, and actual behavior remain exactly user-authored.
- Add `data-bugcapture="ignore"` to omit sensitive replay regions.
- Two-minute in-memory rewind buffer; see [docs/REWIND.md](docs/REWIND.md).
- Optional stdio MCP server for exported JSON reports; see [docs/MCP.md](docs/MCP.md).
- GraphQL operation metadata is parsed from captured request bodies.

## Development

```sh
npm install
npm run build
npm run typecheck
npm run lint
npm test
```

See [docs/PRIVACY.md](docs/PRIVACY.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and
[docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).
