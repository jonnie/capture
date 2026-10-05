# Changelog

User-visible changes are recorded here. Capture is a local-first, open-source capture tool.

## 0.1.0 — 2026-10-05

Initial release.

### Added

- One-keystroke capture overlay (`N`) with Enter-for-newline and `Ctrl/⌘+Enter` to save; works on desktop and mobile.
- LLM auto-tagging via any OpenAI-compatible chat-completions endpoint. The model has free rein over the tag vocabulary — it prefers the configured and already-used tags but may coin a new general one — and any failure falls back to `inbox`, so capturing is never blocked by the LLM.
- Three views: a board grouped by tag, a chronological list with a tag filter, and a force-directed tag-connection graph with pan/zoom and a right-side zoom slider.
- Edit (reuses the capture overlay), archive (instant, with an **Undo** toast), and delete (with a confirmation prompt).
- A streamable-HTTP MCP endpoint at `/mcp` exposing list, search, add, edit, archive, and delete for MCP-capable agents.
- A REST API with interactive OpenAPI docs at `/docs`.
- `capture install` / `capture uninstall` to run Capture as a background service (systemd, launchd, Task Scheduler).
- Single-file `settings.yaml` configuration, created from `example.settings.yaml` and read from disk as needed so tag changes need no restart.
