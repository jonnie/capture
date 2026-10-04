"""MCP server: exposes Capture's functions to agents over streamable HTTP.

The server is mounted on the FastAPI app at ``/mcp`` (see ``app.py``) and
operates on the same SQLite database as the web UI.
"""
from __future__ import annotations

from mcp.server.mcpserver import MCPServer

from . import db
from .config import load_settings
from .llm import auto_tag


def build_mcp(settings_path: str | None = None) -> MCPServer:
    settings = load_settings(settings_path)
    db.init_db(settings.db_path)
    mcp = MCPServer(
        "capture",
        title="Capture",
        description="Local-first capture store: add, search, edit, archive and delete captures.",
        instructions=(
            "Capture stores short text captures with tags. Captures are listed newest "
            "first. Use list_captures/search_captures to read, add_capture to create, and "
            "edit_capture/archive_capture/delete_capture to modify. Tag names must come "
            "from the configured tag list; omit tags on add_capture to let the LLM auto-tag."
        ),
    )

    def _require_tags(tags: list[str]) -> list[str]:
        supported = load_settings(settings_path).tags  # fresh read, per spec
        unknown = sorted(set(tags) - set(supported))
        if unknown:
            raise ValueError(
                f"Unsupported tag(s): {', '.join(unknown)}. "
                f"Supported tags: {', '.join(supported)}"
            )
        return list(dict.fromkeys(tags))

    @mcp.tool()
    async def list_captures(
        include_archived: bool = False,
        tag: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        """List all captures, newest first.

        Args:
            include_archived: also include archived captures (default: active only).
            tag: only return captures carrying this tag.
            limit: maximum number of captures to return (default 50, max 200).
        """
        limit = max(1, min(limit, 200))
        return db.list_captures(
            settings.db_path,
            archived=None if include_archived else False,
            tag=tag,
            limit=limit,
        )

    @mcp.tool()
    async def search_captures(
        query: str,
        tag: str | None = None,
        include_archived: bool = False,
        limit: int = 50,
    ) -> list[dict]:
        """Search captures by content text and/or tags.

        Args:
            query: substring matched against capture content and tag names.
            tag: restrict results to captures carrying this exact tag.
            include_archived: also search archived captures (default: active only).
            limit: maximum number of captures to return (default 50, max 200).
        """
        limit = max(1, min(limit, 200))
        return db.list_captures(
            settings.db_path,
            archived=None if include_archived else False,
            tag=tag,
            q=query,
            limit=limit,
        )

    @mcp.tool()
    async def add_capture(content: str, tags: list[str] | None = None) -> dict:
        """Add a new capture.

        Args:
            content: the capture text (required, non-empty).
            tags: optional tags from the configured tag list. If omitted, the
                capture is auto-tagged by the LLM (or tagged 'inbox' when the
                LLM is disabled or unreachable).
        """
        content = content.strip()
        if not content:
            raise ValueError("content must not be empty")
        if tags:
            tags = _require_tags(tags)
        else:
            tags = [await auto_tag(content, settings_path)]
        return db.create_capture(settings.db_path, content, tags)

    @mcp.tool()
    async def edit_capture(
        id: int,
        content: str | None = None,
        tags: list[str] | None = None,
    ) -> dict:
        """Edit an existing capture's content and/or tags.

        Args:
            id: capture id.
            content: new content (provide at least content or tags).
            tags: full replacement tag list (must be configured tags).
        """
        if content is None and tags is None:
            raise ValueError("Provide content, tags, or both")
        if content is not None:
            content = content.strip()
            if not content:
                raise ValueError("content must not be empty")
        if tags is not None:
            tags = _require_tags(tags)
        updated = db.update_capture(settings.db_path, id, content=content, tags=tags)
        if updated is None:
            raise ValueError(f"Capture {id} not found")
        return updated

    @mcp.tool()
    async def archive_capture(id: int, archived: bool = True) -> dict:
        """Archive a capture (archived=true) or restore it (archived=false).

        This only changes the capture's state; the capture is kept in the
        database.

        Args:
            id: capture id.
            archived: True to archive (default), False to restore.
        """
        updated = db.set_archived(settings.db_path, id, archived)
        if updated is None:
            raise ValueError(f"Capture {id} not found")
        return updated

    @mcp.tool()
    async def delete_capture(id: int) -> dict:
        """Permanently delete a capture from the database. This cannot be undone.

        Args:
            id: capture id to delete.
        """
        if not db.delete_capture(settings.db_path, id):
            raise ValueError(f"Capture {id} not found")
        return {"deleted": id}

    return mcp
