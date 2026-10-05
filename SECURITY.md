# Security policy

Capture is a local-first personal capture tool. It stores everything in a single local SQLite file and has no account system or built-in authentication. It is not hardened for exposure to untrusted networks.

## Reporting a vulnerability

Please do not disclose exploitable details, credentials, or captured content in a public issue.

If GitHub private vulnerability reporting is enabled, use [Report a vulnerability](https://github.com/jonnie/capture/security/advisories/new). If that option is unavailable, open a minimal public issue asking the maintainer for a private reporting channel, without technical exploit details or sensitive data. No response-time guarantee is currently advertised.

Include the affected version, Python version and OS, the impact, and a minimal safe reproduction. Security fixes are best-effort for the latest release and current `main`; older versions have no guaranteed backport support.

## Boundaries and known limitations

- **No authentication.** The web UI, REST API, and MCP endpoint are served without any credential check. Run Capture on a trusted network only. Binding `server.host: 0.0.0.0` (the default) exposes it to your LAN; set `server.host: 127.0.0.1` for local-only use.
- **Local storage.** All captures live in `database.path` (default `data/captures.db`). Back it up if it matters; deleting the file (and its `-wal`/`-shm` siblings) wipes the store.
- **LLM endpoint.** `llm.url` is an outbound integration point. The untagged capture text is sent to the endpoint you configure, so point it only at an endpoint you trust.
- **MCP.** The `/mcp` endpoint lets any client that can reach it add, edit, archive, and delete captures. Treat it as unauthenticated write access to your local captures.
- **Configuration.** `settings.yaml` is not committed to git; keep it out of the repository and do not store secrets in it beyond the endpoint URL you already trust.

Use a trusted or private network, keep the database and configuration out of version control, and keep Python and its dependencies patched.
