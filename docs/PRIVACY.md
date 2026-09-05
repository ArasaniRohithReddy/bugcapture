# Privacy

Capture stays in this browser. Redaction is applied to captured logs, network data, and exports.
The marker is exactly `[REDACTED BY BUGCAPTURE]`. User-authored report fields are never redacted
when copying an AI prompt. Media is not rewritten.

The Rewind buffer is off by default, runs only on sites the user opts in to, stays in
`chrome.storage.local`, is continuously overwritten and is never uploaded; see
[REWIND.md](REWIND.md).

No backend, OAuth flow, provider API, or automatic integration exists. Sharing requires an explicit
JSON/Markdown/ZIP export or copying the prompt. Replay regions can be excluded with
`data-bugcapture="ignore"`.
