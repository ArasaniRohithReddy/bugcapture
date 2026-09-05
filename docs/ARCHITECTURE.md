# Architecture

BugCapture is a local-only Chrome extension. A service worker coordinates capture, an isolated
content script owns rrweb and the in-page widget, and a MAIN-world script observes console and
network activity. Reports and media are stored in IndexedDB. The report page exports selected
evidence and can copy a locally formatted AI prompt; it does not make AI or backend requests.

The `core` modules are dependency-light and include serialization, redaction, GraphQL parsing,
rewind buffering, storage, and export formatting. The optional `mcp` package reads exported JSON
files over stdio.
