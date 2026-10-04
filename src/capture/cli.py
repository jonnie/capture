"""Command-line entry points.

Usage:
    capture                     run the app in the foreground (default)
    capture run [options]       same as above, explicit
    capture install [options]   install as a background service
    capture uninstall           remove the background service

Options shared with ``run``/``install``: --settings, --host, --port.
"""
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


def _common_args(suppress_defaults: bool) -> argparse.ArgumentParser:
    """Shared --settings/--host/--port flags.

    Subparsers use ``suppress_defaults=True`` so they never clobber values
    already parsed at the top level (``capture --port 9000 install``).
    """
    p = argparse.ArgumentParser(add_help=False)
    d = argparse.SUPPRESS if suppress_defaults else None
    p.add_argument(
        "--settings",
        default=d,
        metavar="PATH",
        help="path to settings.yaml (default: <project root>/settings.yaml)",
    )
    p.add_argument("--host", default=d, metavar="HOST", help="override server.host")
    p.add_argument(
        "--port", type=int, default=d, metavar="PORT", help="override server.port"
    )
    return p


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="capture",
        description="Capture — capture anything the moment it occurs to you.",
        parents=[_common_args(suppress_defaults=False)],
    )
    sub = parser.add_subparsers(dest="command")
    sub.add_parser(
        "run",
        help="run the web app in the foreground (default)",
        parents=[_common_args(suppress_defaults=True)],
    )
    p_install = sub.add_parser(
        "install",
        help="install Capture as a background service",
        parents=[_common_args(suppress_defaults=True)],
    )
    p_install.add_argument(
        "--system",
        action="store_true",
        help="install a system-wide service instead of a per-user one (Linux, needs root)",
    )
    sub.add_parser(
        "uninstall",
        help="remove the background service installed by `capture install`",
    )
    return parser


def _run_app(args: argparse.Namespace) -> None:
    _configure_logging()
    log = logging.getLogger("capture")

    import uvicorn

    from .app import create_app
    from .config import load_settings

    try:
        settings = load_settings(args.settings)
        app = create_app(args.settings)
    except (FileNotFoundError, ValueError) as exc:
        sys.exit(f"capture: {exc}")

    host = args.host or settings.host
    port = args.port or settings.port
    shown = host if host not in ("0.0.0.0", "::") else "localhost"
    log.info("Capture available at http://%s:%d (MCP endpoint: http://%s:%d/mcp)", shown, port, shown, port)
    uvicorn.run(app, host=host, port=port, log_level="info")


def _run_service_command(args: argparse.Namespace) -> None:
    from .service import ServiceError, install, uninstall

    try:
        if args.command == "install":
            install(args.settings, args.host, args.port, args.system)
        else:
            uninstall()
    except ServiceError as exc:
        sys.exit(f"capture: {exc}")


def main(argv: list[str] | None = None) -> None:
    args = _build_parser().parse_args(argv)
    if args.command in (None, "run"):
        _run_app(args)
    else:
        _run_service_command(args)
