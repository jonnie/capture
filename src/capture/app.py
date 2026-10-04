"""FastAPI application: REST API for the web UI, static assets, and the MCP endpoint."""
from __future__ import annotations

import contextlib
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__, db
from .config import load_settings
from .llm import auto_tag
from .mcp_server import build_mcp

log = logging.getLogger("capture")

STATIC_DIR = Path(__file__).parent / "static"


class CaptureIn(BaseModel):
    content: str = Field(..., min_length=1, max_length=20_000)
    tags: list[str] | None = None


class CaptureUpdate(BaseModel):
    content: str | None = Field(None, min_length=1, max_length=20_000)
    tags: list[str] | None = None
    archived: bool | None = None


def create_app(settings_path: str | Path | None = None) -> FastAPI:
    settings = load_settings(settings_path)
    db.init_db(settings.db_path)

    # Build the MCP sub-app before the host app: Starlette does not run the
    # lifespan of a mounted sub-app, so the MCP session manager (which owns
    # the request task group) must be started from the host app's lifespan.
    mcp = build_mcp(settings_path)
    mcp_app = mcp.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,
        host=settings.host,
    )

    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI):
        async with mcp.session_manager.run():
            yield

    app = FastAPI(title="Capture", version=__version__, lifespan=lifespan)
    app.state.settings = settings

    def _require_tags(tags: list[str]) -> list[str]:
        valid = _valid_tags()
        unknown = sorted(set(tags) - valid)
        if unknown:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Unsupported tag(s): {', '.join(unknown)}. "
                    f"Valid tags: {', '.join(sorted(valid))}"
                ),
            )
        return list(dict.fromkeys(tags))

    def _valid_tags() -> set[str]:
        """Config tags plus every tag already in use (fresh reads, per spec)."""
        supported = load_settings(settings_path).tags  # fresh read, per spec
        return set(supported) | set(db.distinct_tags(settings.db_path))

    # --- API ---

    @app.get("/api/tags")
    async def api_tags() -> dict:
        # Config tags first (config order), then any the LLM has coined, so the
        # UI can offer every tag that is actually valid.
        supported = load_settings(settings_path).tags
        return {"tags": list(dict.fromkeys(supported + db.distinct_tags(settings.db_path)))}

    @app.get("/api/captures")
    async def api_list_captures(
        archived: bool | None = None,
        tag: str | None = None,
        q: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> dict:
        limit = max(1, min(limit, 1000))
        offset = max(0, offset)
        captures = db.list_captures(
            settings.db_path, archived=archived, tag=tag, q=q, limit=limit, offset=offset
        )
        return {"captures": captures}

    @app.post("/api/captures", status_code=201)
    async def api_create_capture(payload: CaptureIn) -> dict:
        content = payload.content.strip()
        if not content:
            raise HTTPException(status_code=400, detail="Capture content is empty")
        if payload.tags:
            tags = _require_tags(payload.tags)
        else:
            tags = [
                await auto_tag(content, settings_path, db.distinct_tags(settings.db_path))
            ]
        capture = db.create_capture(settings.db_path, content, tags)
        log.info("capture %s created (tags=%s)", capture["id"], ",".join(tags))
        return capture

    @app.get("/api/captures/{capture_id}")
    async def api_get_capture(capture_id: int) -> dict:
        capture = db.get_capture(settings.db_path, capture_id)
        if capture is None:
            raise HTTPException(status_code=404, detail="Capture not found")
        return capture

    @app.patch("/api/captures/{capture_id}")
    async def api_update_capture(capture_id: int, payload: CaptureUpdate) -> dict:
        tags = _require_tags(payload.tags) if payload.tags is not None else None
        content = payload.content.strip() if payload.content is not None else None
        capture = db.update_capture(settings.db_path, capture_id, content=content, tags=tags)
        if capture is None:
            raise HTTPException(status_code=404, detail="Capture not found")
        if payload.archived is not None:
            capture = db.set_archived(settings.db_path, capture_id, payload.archived)
        return capture

    @app.delete("/api/captures/{capture_id}", status_code=204)
    async def api_delete_capture(capture_id: int) -> None:
        if not db.delete_capture(settings.db_path, capture_id):
            raise HTTPException(status_code=404, detail="Capture not found")

    # --- static web UI ---
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    # --- MCP (streamable HTTP at /mcp) ---
    # Mounted at "/" and added last: the routes above take precedence, so the
    # sub-app only ever sees the /mcp path — the endpoint is served exactly
    # at /mcp, with no trailing-slash redirect.
    app.mount("/", mcp_app)

    return app
