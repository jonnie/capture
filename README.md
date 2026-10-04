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
- **LLM auto-tagging** — new captures are tagged by any
  OpenAI-compatible chat-completions endpoint based on the capture text
  alone. Tagging can be disabled; the capture is never blocked by the LLM
  (failures fall back to `inbox`).
- **Two views** — a board grouped by tag (for the visual) or a
  chronological list with a tag filter (for the data-driven). Live search
  across content and tags in both.
- **Edit, archive, delete** — editing reuses the capture overlay with an
  "Editing capture" context; archiving is instant with an **Undo** toast;
  deleting asks for confirmation first.
- **MCP server** — the six core functions are exposed over
  [streamable HTTP](https://modelcontextprotocol.io/) at `/mcp`, so any
  MCP-capable agent can work with your captures.
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

- **From your phone:** the app binds to `0.0.0.0` by default, so on the
  same Wi-Fi open `http://<your-machine's-ip>:8000`. Set
  `server.host: 127.0.0.1` in `settings.yaml` to keep it local-only.
- **CLI overrides:** `capture --host 127.0.0.1 --port 9000 --settings /path/to/settings.yaml`.

The first run creates the SQLite database (`data/captures.db` by default).

## Using the web UI

| Action | How |
| --- | --- |
| New capture | `N` or the **+ New** button |
| Add a line | `Enter` (never submits) |
| Save capture | `Ctrl/⌘+Enter` or **Save** |
| Cancel | `Esc` or **Cancel** (warns if the draft is non-empty) |
| Search | `/` focuses the search box; matches content *and* tags |
| Switch view | **Board** (grouped by tag) / **List** (chronological + tag filter) |
| Edit | pencil icon on a card — reuses the overlay, pre-filled, shows "Editing capture" |
| Archive | archive icon — instant, no confirmation, toast offers **Undo** for a few seconds |
| Restore | from the *Archived* section (board) or the divider section (list) |
| Delete | trash icon — a confirmation dialog must be accepted first |

Tags are multi-valued: a capture can carry several, and in the board view it
appears under each. In the capture overlay you can pick tags manually; if
you leave them blank (on a new capture only) the LLM assigns one.

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
| `tags` | The supported tag list. The LLM may only assign these, the UI only offers these, and the MCP/API reject anything else. **This list is re-read from the file as needed — editing it requires no restart.** |

## LLM auto-tagging

When a capture is added **without explicit tags**, Capture calls
`POST {llm.url}/chat/completions` with a strict classifier prompt: the model
sees only the capture text and the configured tag list, and must answer with
a JSON object `{"tag": "<one of the tags>"}`. `inbox` is reserved for text
where no other tag clearly fits.

Guarantees:

- **The capture is saved no matter what.** If the LLM is down, times out
  (30 s), returns an unknown tag, or returns nothing parseable, the capture
  is tagged `inbox` (or the first configured tag if `inbox` isn't in the
  list). A failed LLM call is logged, never fatal.
- **Reasoning models are supported.** The completion budget is generous
  (512 tokens) so models that "think" before answering still fit their
  answer; the parser takes the JSON object (with a bare-word fallback).
- **Manual tags always win.** If you (or an agent) supply tags, the LLM is
  not consulted.
- **Tag list changes apply immediately** — the prompt is built from a fresh
  read of `settings.yaml` on every capture.

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
| `add_capture` | `content` (required), optional `tags`. No tags → LLM auto-tag (or `inbox` when disabled). |
| `edit_capture` | `id`, and/or `content`, and/or `tags` (full replacement, must be configured tags). |
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
│   ├── cli.py              # `capture` entry point (uvicorn)
│   ├── app.py              # FastAPI app: REST API, static UI, MCP mount
│   ├── mcp_server.py       # the six MCP tools (streamable HTTP)
│   ├── llm.py              # auto-tagging (JSON contract, inbox fallback)
│   ├── db.py               # SQLite layer (WAL, capture_tags join table)
│   ├── config.py           # settings.yaml loader (fresh reads for tags)
│   └── static/             # web UI: index.html, style.css, app.js (no build step)
└── data/captures.db        # created on first run (gitignored)
```

## Development

No frontend build step — the UI is plain HTML/CSS/JS served by the app.
Run with `capture` (or `python -m capture`) and reload the page after
editing `src/capture/static/*`.

## License

[MIT](LICENSE) — do whatever you want with it, no warranty.
