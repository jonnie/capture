"""Command-line entry points."""
from __future__ import annotations

import argparse
import logging
import sys


def _configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        stream=sys.stderr,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="capture",
        description="Run the Capture web app (web UI, REST API and MCP endpoint).",
    )
    parser.add_argument(
        "--settings",
        default=None,
        metavar="PATH",
        help="path to settings.yaml (default: <project root>/settings.yaml)",
    )
    parser.add_argument("--host", default=None, metavar="HOST", help="override server.host")
    parser.add_argument(
        "--port", type=int, default=None, metavar="PORT", help="override server.port"
    )
    args = parser.parse_args()

    _configure_logging()
    log = logging.getLogger("capture")

    import uvicorn

    from .app import create_app
    from .config import load_settings

    settings = load_settings(args.settings)
    host = args.host or settings.host
    port = args.port or settings.port
    app = create_app(args.settings)

    shown = host if host not in ("0.0.0.0", "::") else "localhost"
    log.info(
        "Capture available at http://%s:%d (MCP endpoint: http://%s:%d/mcp)",
        shown, port, shown, port,
    )
    uvicorn.run(app, host=host, port=port, log_level="info")
