# Capture

> Capture anything the moment it occurs to you.

Capture is a fast, local-first web app for catching thoughts, ideas and tasks
the instant they happen. One keystroke drops you into a focused capture
overlay; an LLM auto-tags what you captured; a calm, responsive UI keeps
everything organised by tag. An MCP endpoint lets agents add, search, edit,
archive and delete captures without ever touching the UI.

Everything is stored in a local SQLite database — no third-party services,
no account, no network beyond your LLM endpoint.

## Features

- **One-keystroke capture** — press `N` (or click **New**) and a blurred
  overlay takes over. Enter adds a new line; `Ctrl/⌘+Enter` (or the Save
  button) captures. Works on desktop and mobile.
- **LLM auto-tagging** — new captures are tagged by any OpenAI-compatible
  chat-completions endpoint. The LLM has free rein: it prefers the default
  tags and any tag already in use, but may coin a new *general* tag (one or
  two words, never a sentence) when nothing fits. Tagging can be disabled;
  the capture is never blocked by the LLM (failures fall back to `inbox`).
- **Three views** — a board grouped by tag (for the visual), a chronological
  list with a tag filter (for the data-driven), and a force-directed **graph**
  that links each capture to the tag hubs it carries — click a tag to isolate
  its cluster and see where captures interconnect. Live search across content
  and tags in all three.
- **Edit, archive, delete** — editing reuses the capture overlay with an
  "Editing capture" context; archiving is instant with an **Undo** toast;
  deleting asks for confirmation first.
- **MCP server** — the six core functions are exposed over
  [streamable HTTP](https://modelcontextprotocol.io/) at `/mcp`, so any
  MCP-capable agent can work with your captures.
- **Runs as a service** — `capture install` installs it as a background
  service on Linux (systemd), macOS (launchd) and Windows (Task
  Scheduler), with auto-restart on Linux and macOS.
- **Single-file configuration** — everything lives in `settings.yaml`,
  including the tag list, which is read from disk as needed: add a tag in
  the file and it appears in the UI, the LLM prompt and the MCP tools
  immediately.

## Quick start

Requirements: **Python 3.10+**.

```bash
git clone <your-fork-of-this-repo> capture
cd capture
python -m venv .venv
source .venv/bin/activate
pip install -e .

capture                 # or: python -m capture
```

Then open <http://localhost:8000>.

- **In the background:** `capture install` sets up a service that starts at
  boot/login and keeps the app running —
  [Running as a background service](#running-as-a-background-service).
- **From your phone:** the app binds to `0.0.0.0` by default, so on the
  same Wi-Fi open `http://<your-machine's-ip>:8000`. Set
  `server.host: 127.0.0.1` in `settings.yaml` to keep it local-only.
- **CLI overrides:** `capture --host 127.0.0.1 --port 9000 --settings /path/to/settings.yaml`.

The first run creates the SQLite database (`data/captures.db` by default).

## Running as a background service

`capture install` installs the app as a service that starts at boot/login and keeps
running in the background. `capture uninstall` stops and removes it again.

| Platform | What you get |
| --- | --- |
| **Linux (systemd)** — Ubuntu, Fedora, RHEL, Arch, openSUSE, NixOS, … | a systemd **user** service by default (no root needed); `capture install --system` installs a system-wide unit instead (runs as your user, needs root) |
| **macOS** | a launchd **LaunchAgent** (per-user, starts at login, auto-restarts) |
| **Windows** | a **Task Scheduler** task that runs the app at logon |

```bash
capture install                # per-user service (default; host/port from settings.yaml)
capture install --port 9000    # override the port (--host / --settings work too)
capture install --system       # Linux only: system-wide service (needs root)
capture uninstall              # stop and remove the service
```

How it works:

- The unit is generated with absolute paths (the interpreter you ran from, the
  project root, `settings.yaml`), so the service behaves exactly like the CLI.
  **Keep the repo and its venv where they are** — the unit points at them.
- Linux units restart the app automatically on crash (`Restart=on-failure`);
  the macOS LaunchAgent does the same via `KeepAlive`. The Windows scheduled
  task re-runs the app at each logon but does not restart crashes — a true
  Windows service needs a wrapper such as [NSSM](https://nssm.cc/), which this
  tool deliberately avoids as a dependency.
- `capture install` refuses to start if the port is already in use, so you can't
  end up with two instances fighting over it.

Logs and status:

| Platform | Status | Logs |
| --- | --- | --- |
| Linux (user) | `systemctl --user status capture` | `journalctl --user -u capture -f` |
| Linux (system) | `systemctl status capture` | `journalctl -u capture -f` |
| macOS | `launchctl print gui/$(id -u)/com.capture.app` | `tail -f ~/Library/Logs/capture/capture.err.log` |
| Windows | `schtasks /Query /TN Capture /V /FO LIST` | run the app in the foreground to see console output |

Notes:

- **Linux:** the user service runs inside your login session. To keep it running
  after you log out, enable lingering with `sudo loginctl enable-linger <your-user>`
  — the installer prints this hint when it applies.
- **macOS:** the agent lives at `~/Library/LaunchAgents/com.capture.app.plist`;
  log files in `~/Library/Logs/capture/` are kept after uninstall.
- **Windows:** the task is created for the current user; no password is stored.


## Using the web UI

| Action | How |
| --- | --- |
| New capture | `N` or the **+ New** button |
| Add a line | `Enter` (never submits) |
| Save capture | `Ctrl/⌘+Enter` or **Save** |
| Cancel | `Esc` or **Cancel** (warns if the draft is non-empty) |
| Search | `/` focuses the search box; matches content *and* tags |
| Switch view | **Board** (grouped by tag) / **List** (chronological + tag filter) / **Graph** (tag-connection map) |
| Edit | pencil icon on a card — reuses the overlay, pre-filled, shows "Editing capture" |
| Archive | archive icon — instant, no confirmation, toast offers **Undo** for a few seconds |
| Restore | from the *Archived* section (board) or the divider section (list) |
| Delete | trash icon — a confirmation dialog must be accepted first |
| Graph: cards | captures render as small **cards** (tag hubs stay circular); zoom in and each card shows a short truncated snippet of its content |
| Graph: hover | hover a node — captures show content, id, time and tags (plus a *double-click to edit* hint); tags show their capture count |
| Graph: focus | click a tag hub to isolate its cluster and dim the rest; click empty space to clear |
| Graph: zoom to a card | click a capture to zoom in on it while keeping its neighbours in view; **double-click** a capture to open the edit overlay |
| Graph: pan/zoom | drag empty space to pan, scroll to zoom (snappy, up to 8×), drag a node to reposition it |

Tags are multi-valued: a capture can carry several, and in the board view it
appears under each. In the capture overlay you can pick tags manually — the
picker lists the configured tags plus any the LLM has already coined. If you
leave tags blank (on a new capture only) the LLM assigns one.

## Configuration

All settings live in a single `settings.yaml` at the project root:

```yaml
server:
  host: 0.0.0.0        # bind address (127.0.0.1 = local-only)
  port: 8000

database:
  path: data/captures.db   # relative to the project root

llm:
  enabled: yes                     # no = skip the LLM, tag everything inbox
  url: http://localhost:8080/v1    # any OpenAI-compatible base URL
  model: qwen3.8-27b               # model name served at that URL

tags:
  - inbox
  - todo
  - idea
  - urgent
```

| Key | Meaning |
| --- | --- |
| `server.host` / `server.port` | Where the web app (and MCP endpoint) listen. Overridable with `--host`/`--port`. |
| `database.path` | SQLite file location, relative to the project root. |
| `llm.enabled` | `yes`/`no`. When `no`, new captures without explicit tags are tagged `inbox` and no LLM call is made. |
| `llm.url` | Base URL of an OpenAI-compatible chat-completions endpoint (a `/chat/completions` POST is made to it). |
| `llm.model` | Model identifier. |
| `tags` | The default tag list. The LLM prefers these (and any tag already in use) but may coin a new general tag; the UI and MCP/API accept this list plus every tag already in use. **Re-read from the file as needed — editing it requires no restart.** |

## LLM auto-tagging

When a capture is added **without explicit tags**, Capture calls
`POST {llm.url}/chat/completions` with a classifier prompt. The model sees the
capture text, the default tag list, and the tags already in use across your
captures — and must answer with a JSON object `{"tag": "<tag>"}`.

The LLM has free rein over the vocabulary:

- **It prefers existing tags** (the defaults, then anything already in use) so
  related captures share tags and stay consistent over time.
- **It may coin a new tag** when nothing fits, but is told to keep it general —
  one or two words, never a sentence or specific detail. The parser enforces
  this: a new tag that isn't one or two short words is rejected and the capture
  falls back to `inbox`.
- `inbox` is for text that genuinely resists any tag.

Guarantees:

- **The capture is saved no matter what.** If the LLM is down, times out
  (30 s), returns an unusable tag, or returns nothing parseable, the capture
  is tagged `inbox` (or the first configured tag if `inbox` isn't in the
  list). A failed LLM call is logged, never fatal.
- **Reasoning models are supported.** The completion budget is generous
  (512 tokens) so models that "think" before answering still fit their
  answer; the parser takes the JSON object (with a bare-word fallback).
- **Manual tags always win.** If you (or an agent) supply tags, the LLM is
  not consulted.
- **The context is always current** — the prompt is built from a fresh read of
  `settings.yaml` *and* a fresh query of the tags in use, on every capture.

## MCP

The app serves a streamable-HTTP MCP endpoint at:

```
http://<host>:<port>/mcp
```

(point at the machine:port from `settings.yaml` — e.g.
`http://localhost:8000/mcp`, or your LAN IP for agents on other devices).

Add it to any MCP-capable client. Generic config:

```json
{
  "mcpServers": {
    "capture": {
      "url": "http://localhost:8000/mcp"
    }
  }
}
```

### Tools

| Tool | Purpose |
| --- | --- |
| `list_captures` | All captures, newest first. `include_archived` (default `false`), `tag` filter, `limit` (default 50, max 200). |
| `search_captures` | `query` matches capture content **and** tag names; optional `tag` exact filter, `include_archived`, `limit`. |
| `add_capture` | `content` (required), optional `tags`. No tags → LLM auto-tag (prefers existing tags, may coin a new general one; `inbox` when disabled). |
| `edit_capture` | `id`, and/or `content`, and/or `tags` (full replacement; configured tags or tags already in use). |
| `archive_capture` | `id`, `archived` (default `true`) — state change only; pass `false` to restore. |
| `delete_capture` | `id` — removes the capture from the database permanently. |

Example session:

```
> list_captures()
[{"id": 3, "content": "Idea: ...", "tags": ["idea"], "archived": false, ...}, ...]

> add_capture(content="Call the dentist tomorrow")
{"id": 4, "content": "Call the dentist tomorrow", "tags": ["todo"], ...}

> archive_capture(id=4)
{"id": 4, ..., "archived": true, ...}
```

## REST API

The web UI is a thin client of this API — useful for scripting too.

| Method & path | Description |
| --- | --- |
| `GET /api/tags` | `{"tags": [...]}` — current supported tags. |
| `GET /api/captures` | `?archived=true\|false` (omit = all), `?tag=`, `?q=` (content/tag substring), `?limit=`, `?offset=`. |
| `POST /api/captures` | `{"content": "...", "tags": [...]}` — `tags` optional → LLM auto-tag. `201` with the capture. |
| `GET /api/captures/{id}` | One capture, or `404`. |
| `PATCH /api/captures/{id}` | Any of `{"content", "tags", "archived"}`. `tags` replaces the set. |
| `DELETE /api/captures/{id}` | `204` on success, `404` if missing. |

```bash
curl -s localhost:8000/api/captures -H 'Content-Type: application/json' \
  -d '{"content": "Idea: ..."}'

curl -s -X PATCH localhost:8000/api/captures/1 -d '{"archived": true}'
```

Interactive OpenAPI docs: <http://localhost:8000/docs>.

## Data & storage

A single SQLite file (`database.path`, default `data/captures.db`), WAL
mode:

```sql
captures(
    id          INTEGER PRIMARY KEY,
    content     TEXT    NOT NULL,
    archived    INTEGER NOT NULL DEFAULT 0,   -- 0 = active, 1 = archived
    created_at  TEXT    NOT NULL,             -- ISO-8601 UTC
    updated_at  TEXT    NOT NULL
);

capture_tags(
    capture_id  INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
    tag         TEXT    NOT NULL
);
```

A capture keeps its full history: editing updates `content`/`updated_at`,
archiving flips `archived`, only `DELETE` removes the row. Delete the file
(and its `-wal`/`-shm` siblings) to wipe the store.

## Project layout

```
capture/
├── settings.yaml           # all configuration (tags live here)
├── pyproject.toml
├── LICENSE                 # MIT
├── src/capture/
│   ├── cli.py              # `capture` CLI: run / install / uninstall
│   ├── app.py              # FastAPI app: REST API, static UI, MCP mount
│   ├── mcp_server.py       # the six MCP tools (streamable HTTP)
│   ├── llm.py              # auto-tagging (JSON contract, inbox fallback)
│   ├── db.py               # SQLite layer (WAL, capture_tags join table)
│   ├── service.py          # background-service install (systemd/launchd/schtasks)
│   ├── config.py           # settings.yaml loader (fresh reads for tags)
│   └── static/             # web UI: index.html, style.css, app.js (no build step)
└── data/captures.db        # created on first run (gitignored)
```

## Development

Run with `capture` (or `python -m capture`) and reload the page after
editing `src/capture/static/*`. Background-service commands work the same
way: `capture install` / `capture uninstall` (or `python -m capture install`).

## License

[MIT](LICENSE) — do whatever you want with it, no warranty.
