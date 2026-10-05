"""Install Capture as a background service.

Supported platforms:

- **Linux with systemd** (Ubuntu, Fedora, RHEL, Arch, openSUSE, NixOS, …):
  a systemd *user* unit by default (no root needed), or a *system* unit with
  ``--system``. The app is re-launched on failure.
- **macOS**: a per-user launchd *LaunchAgent* that starts at login and keeps
  the app alive.
- **Windows**: a Task Scheduler task that runs the app at logon. A true SCM
  service would require a third-party wrapper (e.g. NSSM); the built-in
  scheduler is the clean, dependency-free option.

All generated units use absolute paths (the running interpreter, the project
root and ``settings.yaml``), so the service behaves exactly like running the
CLI with the same flags.
"""

from __future__ import annotations

import getpass
import os
import platform
import plistlib
import shlex
import shutil
import socket
import subprocess
import sys
from pathlib import Path

import yaml

SERVICE_NAME = "capture"  # systemd unit: capture.service
LABEL = "com.capture.app"  # launchd label; plist file is <LABEL>.plist
TASK_NAME = "Capture"  # Windows scheduled task name

_DESCRIPTION = "Capture — local-first capture app"


class ServiceError(RuntimeError):
    """Raised when the service cannot be installed or removed."""


def project_root() -> Path:
    """The project root (this file lives in ``src/capture/``)."""
    return Path(__file__).resolve().parents[2]


def _run(
    cmd: list[str], *, sudo: bool = False, input_: bytes | None = None
) -> subprocess.CompletedProcess:
    full = (["sudo"] if sudo else []) + cmd
    return subprocess.run(full, input=input_, check=True, capture_output=True, text=input_ is None)


def _port_in_use(host: str, port: int) -> bool:
    """True if something is already listening on the app's bind address."""
    bind_host = "0.0.0.0" if host in ("0.0.0.0", "::") else host
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((bind_host, port))
        except OSError:
            return True
    return False


# ---------------------------------------------------------------------------
# unit file builders (pure — easy to test without touching the system)
# ---------------------------------------------------------------------------


def systemd_unit(python: str, root: str, settings: str, host: str, port: int, system: bool) -> str:
    def q(p: str) -> str:
        return shlex.quote(p)

    unit = f"""[Unit]
Description={_DESCRIPTION}
After={"network-online.target" if system else "network.target"}
"""
    if system:
        unit += f"User={getpass.getuser()}\n"
    unit += f"""
[Service]
Environment=PYTHONUNBUFFERED=1
WorkingDirectory={root}
ExecStart={q(python)} -m capture --settings {q(settings)} --host {host} --port {port}
Restart=on-failure
RestartSec=3

[Install]
WantedBy={"multi-user.target" if system else "default.target"}
"""
    return unit


def launchd_plist(python: str, root: str, settings: str, host: str, port: int, logs: Path) -> dict:
    return {
        "Label": LABEL,
        "ProgramArguments": [
            python,
            "-m",
            "capture",
            "--settings",
            settings,
            "--host",
            host,
            "--port",
            str(port),
        ],
        "WorkingDirectory": root,
        "RunAtLoad": True,
        "KeepAlive": True,
        "StandardOutPath": str(logs / "capture.out.log"),
        "StandardErrorPath": str(logs / "capture.err.log"),
    }


def windows_command(python: str, settings: str, host: str, port: int) -> str:
    return f'"{python}" -m capture --settings "{settings}" --host {host} --port {port}'


# ---------------------------------------------------------------------------
# installation / removal, one section per platform
# ---------------------------------------------------------------------------


def _install_systemd(
    python: str, root: str, settings: str, host: str, port: int, system: bool
) -> None:
    unit_text = systemd_unit(python, root, settings, host, port, system)
    if system:
        need_sudo = os.geteuid() != 0
        if need_sudo and not shutil.which("sudo"):
            raise ServiceError("system-wide install requires root privileges (or sudo)")
        unit_path = Path(f"/etc/systemd/system/{SERVICE_NAME}.service")
        _run(["tee", str(unit_path)], sudo=need_sudo, input_=unit_text.encode())

        def sc(*args: str) -> None:
            _run(list(args), sudo=need_sudo)

        sc("systemctl", "daemon-reload")
        sc("systemctl", "enable", "--now", f"{SERVICE_NAME}.service")
        logs = "journalctl -u capture -f" + ("" if need_sudo else " (run with sudo)")
        status = "systemctl status capture"
    else:
        unit_path = (
            Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")).expanduser()
            / "systemd"
            / "user"
        )
        unit_path.mkdir(parents=True, exist_ok=True)
        unit_path = unit_path / f"{SERVICE_NAME}.service"
        unit_path.write_text(unit_text)
        _run(["systemctl", "--user", "daemon-reload"])
        _run(["systemctl", "--user", "enable", "--now", f"{SERVICE_NAME}.service"])
        logs = "journalctl --user -u capture -f"
        status = "systemctl --user status capture"
        # Best effort: keep the user service running after logout.
        if shutil.which("loginctl"):
            r = subprocess.run(
                ["loginctl", "enable-linger", getpass.getuser()],
                capture_output=True,
                text=True,
            )
            if r.returncode != 0:
                print(
                    f"  hint: run `sudo loginctl enable-linger {getpass.getuser()}` to keep the "
                    "service running after you log out."
                )
    print(f"Wrote {unit_path}")
    print(f"  status: {status}")
    print(f"  logs:   {logs}")
    print("  stop:   capture uninstall")


def _install_macos(python: str, root: str, settings: str, host: str, port: int) -> None:
    agents_dir = Path.home() / "Library" / "LaunchAgents"
    agents_dir.mkdir(parents=True, exist_ok=True)
    logs_dir = Path.home() / "Library" / "Logs" / "capture"
    logs_dir.mkdir(parents=True, exist_ok=True)

    plist_path = agents_dir / f"{LABEL}.plist"
    plist_path.write_bytes(
        plistlib.dumps(launchd_plist(python, root, settings, host, port, logs_dir))
    )
    print(f"Wrote {plist_path}")

    uid = os.getuid()
    # Re-install path: drop any existing registration first.
    subprocess.run(
        ["launchctl", "bootout", f"gui/{uid}", LABEL],
        capture_output=True,
        text=True,
    )
    r = subprocess.run(
        ["launchctl", "bootstrap", f"gui/{uid}", str(plist_path)],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        # Older macOS without `bootstrap`.
        _run(["launchctl", "load", "-w", str(plist_path)])
    print("  status: launchctl print gui/{uid}/{label}".format(uid=uid, label=LABEL))
    print(f"  logs:   tail -f {logs_dir}/capture.err.log")
    print("  stop:   capture uninstall")


def _install_windows(python: str, settings: str, host: str, port: int) -> None:
    command = windows_command(python, settings, host, port)
    _run(
        ["schtasks", "/Create", "/F", "/TN", TASK_NAME, "/TR", command, "/SC", "ONLOGON", "/IT"],
    )
    _run(["schtasks", "/Run", "/TN", TASK_NAME])
    print(f"Created scheduled task `{TASK_NAME}` (runs at logon) and started it.")
    print(f"  status: schtasks /Query /TN {TASK_NAME} /V /FO LIST")
    print("  stop:   capture uninstall")
    print(
        "  note: this uses Task Scheduler (a true Windows service needs a wrapper like NSSM);\n"
        "        the task re-runs the app at each logon but does not auto-restart crashes."
    )


# ---------------------------------------------------------------------------
# public entry points (called from the CLI)
# ---------------------------------------------------------------------------


def install(settings_path: str | None, host: str | None, port: int | None, system: bool) -> None:
    """Install Capture as a background service on the current platform."""
    from .config import default_settings_path, load_settings

    settings_file = Path(settings_path) if settings_path else default_settings_path()
    if not settings_file.is_file():
        raise ServiceError(f"settings file not found: {settings_file}")
    try:
        settings = load_settings(settings_file)
    except (ValueError, yaml.YAMLError) as exc:
        raise ServiceError(f"invalid settings file: {exc}") from exc
    host = host or settings.host
    port = port or settings.port
    python = sys.executable  # venv-aware absolute interpreter path
    root = str(project_root())
    settings_abs = str(settings_file.resolve())

    if system and platform.system() != "Linux":
        raise ServiceError(
            f"--system is only supported on Linux (this platform: {platform.system()}); "
            "install the per-user service (drop the flag)"
        )
    if _port_in_use(host, port):
        raise ServiceError(
            f"port {port} is already in use — stop the other Capture instance "
            f"(or install with --port) first"
        )

    system_platform = platform.system()
    try:
        if system_platform == "Windows":
            print("Installing Capture as a Windows scheduled task...")
            _install_windows(python, settings_abs, host, port)
        elif system_platform == "Darwin":
            print("Installing Capture as a macOS LaunchAgent...")
            _install_macos(python, root, settings_abs, host, port)
        elif system_platform == "Linux":
            if not Path("/run/systemd/system").exists():
                raise ServiceError(
                    "systemd not detected — this distro is not supported automatically; "
                    "see README 'Running as a background service' for manual options"
                )
            unit_kind = "systemd system" if system else "systemd user"
            print(f"Installing Capture as a {unit_kind} service...")
            _install_systemd(python, root, settings_abs, host, port, system)
        else:
            raise ServiceError(
                f"unsupported platform: {system_platform} — see README for manual options"
            )
    except subprocess.CalledProcessError as exc:
        raise ServiceError(
            f"`{' '.join(exc.cmd)}` failed: {(exc.stderr or exc.stdout or '').strip()}"
        ) from exc
    shown = host if host not in ("0.0.0.0", "::") else "localhost"
    print(f"Capture is running at http://{shown}:{port} (MCP: http://{shown}:{port}/mcp)")


def uninstall() -> None:
    """Remove the Capture background service installed by `capture install`."""
    system_platform = platform.system()
    if system_platform == "Windows":
        r = subprocess.run(
            ["schtasks", "/Delete", "/F", "/TN", TASK_NAME], capture_output=True, text=True
        )
        if r.returncode != 0:
            raise ServiceError(f"could not delete scheduled task {TASK_NAME!r}: {r.stderr.strip()}")
        print(f"Deleted scheduled task `{TASK_NAME}`.")
    elif system_platform == "Darwin":
        uid = os.getuid()
        plist_path = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
        subprocess.run(
            ["launchctl", "bootout", f"gui/{uid}", LABEL],
            capture_output=True,
            text=True,
        )
        r = subprocess.run(["launchctl", "unload", str(plist_path)], capture_output=True, text=True)
        if r.returncode != 0 and not plist_path.exists():
            raise ServiceError("no Capture LaunchAgent found (already uninstalled?)")
        plist_path.unlink(missing_ok=True)
        print(f"Removed {plist_path} (log files in ~/Library/Logs/capture are kept).")
    elif system_platform == "Linux":
        if not Path("/run/systemd/system").exists():
            raise ServiceError("systemd not detected — nothing to remove via this tool")
        user_unit = (
            Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")).expanduser()
            / "systemd"
            / "user"
            / f"{SERVICE_NAME}.service"
        )
        system_unit = Path(f"/etc/systemd/system/{SERVICE_NAME}.service")
        try:
            if system_unit.exists():
                need_sudo = os.geteuid() != 0

                def sc(*args: str) -> None:
                    _run(list(args), sudo=need_sudo)

                sc("systemctl", "disable", "--now", f"{SERVICE_NAME}.service")
                system_unit.unlink()
                sc("systemctl", "daemon-reload")
                print(f"Removed {system_unit}.")
            elif user_unit.exists():
                _run(["systemctl", "--user", "disable", "--now", f"{SERVICE_NAME}.service"])
                user_unit.unlink()
                _run(["systemctl", "--user", "daemon-reload"])
                print(f"Removed {user_unit}.")
            else:
                raise ServiceError(
                    f"no Capture service found (looked for {user_unit} and {system_unit})"
                )
        except subprocess.CalledProcessError as exc:
            raise ServiceError(
                f"`{' '.join(exc.cmd)}` failed: {(exc.stderr or exc.stdout or '').strip()}"
            ) from exc
    else:
        raise ServiceError(f"unsupported platform: {system_platform}")
