"""SQLite storage layer.

Two tables: ``captures`` (id, content, archived, created_at, updated_at) and
``capture_tags`` (capture_id, tag) — a capture can carry several tags.
Timestamps are ISO-8601 UTC strings, so plain string ordering works.
The database runs in WAL mode so the web app and MCP endpoint can be
served concurrently.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS captures (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    content     TEXT    NOT NULL,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS capture_tags (
    capture_id  INTEGER NOT NULL REFERENCES captures (id) ON DELETE CASCADE,
    tag         TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_captures_archived ON captures (archived);
CREATE INDEX IF NOT EXISTS idx_capture_tags_tag  ON capture_tags (tag);
"""


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def _open(db_path: Path) -> Iterator[sqlite3.Connection]:
    conn = _connect(db_path)
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _capture(row: sqlite3.Row, tags: list[str]) -> dict:
    return {
        "id": row["id"],
        "content": row["content"],
        "tags": tags,
        "archived": bool(row["archived"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _tags_for(conn: sqlite3.Connection, ids: list[int]) -> dict[int, list[str]]:
    out: dict[int, list[str]] = {cid: [] for cid in ids}
    if not ids:
        return out
    ph = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"SELECT capture_id, tag FROM capture_tags WHERE capture_id IN ({ph}) ORDER BY tag", ids
    ).fetchall()
    for r in rows:
        out[r["capture_id"]].append(r["tag"])
    return out


def _escape_like(q: str) -> str:
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def init_db(db_path: Path) -> None:
    with _open(db_path) as conn:
        conn.executescript(SCHEMA)


def create_capture(db_path: Path, content: str, tags: list[str]) -> dict:
    now = _now()
    with _open(db_path) as conn:
        cur = conn.execute(
            "INSERT INTO captures (content, archived, created_at, updated_at) VALUES (?, 0, ?, ?)",
            (content, now, now),
        )
        capture_id = cur.lastrowid
        conn.executemany(
            "INSERT INTO capture_tags (capture_id, tag) VALUES (?, ?)",
            [(capture_id, tag) for tag in tags],
        )
    return get_capture(db_path, capture_id)


def get_capture(db_path: Path, capture_id: int) -> dict | None:
    with _open(db_path) as conn:
        row = conn.execute("SELECT * FROM captures WHERE id = ?", (capture_id,)).fetchone()
        if row is None:
            return None
        tags = [
            r["tag"]
            for r in conn.execute(
                "SELECT tag FROM capture_tags WHERE capture_id = ? ORDER BY tag", (capture_id,)
            )
        ]
    return _capture(row, tags)


def list_captures(
    db_path: Path,
    archived: bool | None = False,
    tag: str | None = None,
    q: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> list[dict]:
    """List captures, newest first.

    ``archived``: True → only archived, False → only active, None → all.
    ``tag``: only captures carrying this tag. ``q``: substring match on
    content or tag name.
    """
    sql = "SELECT c.* FROM captures c"
    clauses: list[str] = []
    args: list[object] = []
    if archived is not None:
        clauses.append("c.archived = ?")
        args.append(1 if archived else 0)
    if tag:
        clauses.append(
            "EXISTS (SELECT 1 FROM capture_tags t WHERE t.capture_id = c.id AND t.tag = ?)"
        )
        args.append(tag)
    if q:
        clauses.append(
            "(c.content LIKE ? ESCAPE '\\' OR EXISTS "
            "(SELECT 1 FROM capture_tags t WHERE t.capture_id = c.id AND t.tag LIKE ? ESCAPE '\\'))"
        )
        like = _escape_like(q)
        args += [like, like]
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?"
    args += [limit, offset]
    with _open(db_path) as conn:
        rows = conn.execute(sql, args).fetchall()
        tag_map = _tags_for(conn, [r["id"] for r in rows])
    return [_capture(r, tag_map.get(r["id"], [])) for r in rows]


def distinct_tags(db_path: Path) -> list[str]:
    """Every tag currently in use (across active and archived captures), alphabetical."""
    with _open(db_path) as conn:
        rows = conn.execute("SELECT DISTINCT tag FROM capture_tags ORDER BY tag").fetchall()
    return [r["tag"] for r in rows]


def update_capture(
    db_path: Path,
    capture_id: int,
    content: str | None = None,
    tags: list[str] | None = None,
) -> dict | None:
    """Update content and/or tags. ``tags`` replaces the full tag set."""
    if content is None and tags is None:
        return get_capture(db_path, capture_id)
    now = _now()
    with _open(db_path) as conn:
        row = conn.execute("SELECT id FROM captures WHERE id = ?", (capture_id,)).fetchone()
        if row is None:
            return None
        if content is not None:
            conn.execute(
                "UPDATE captures SET content = ?, updated_at = ? WHERE id = ?",
                (content, now, capture_id),
            )
        if tags is not None:
            conn.execute("DELETE FROM capture_tags WHERE capture_id = ?", (capture_id,))
            conn.executemany(
                "INSERT INTO capture_tags (capture_id, tag) VALUES (?, ?)",
                [(capture_id, tag) for tag in tags],
            )
            conn.execute("UPDATE captures SET updated_at = ? WHERE id = ?", (now, capture_id))
    return get_capture(db_path, capture_id)


def set_archived(db_path: Path, capture_id: int, archived: bool) -> dict | None:
    with _open(db_path) as conn:
        cur = conn.execute(
            "UPDATE captures SET archived = ?, updated_at = ? WHERE id = ?",
            (1 if archived else 0, _now(), capture_id),
        )
        if cur.rowcount == 0:
            return None
    return get_capture(db_path, capture_id)


def delete_capture(db_path: Path, capture_id: int) -> bool:
    with _open(db_path) as conn:
        cur = conn.execute("DELETE FROM captures WHERE id = ?", (capture_id,))
        return cur.rowcount > 0
