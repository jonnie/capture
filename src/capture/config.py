"""Configuration loading for Capture.

All configuration lives in a single ``settings.yaml`` at the project root.
Per the spec, the supported tag list is always read from the file rather than
held in memory, so tags can be added or removed by editing the file alone —
no code changes, no restart.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml

_TRUTHY = {"yes", "on", "true", "1"}
_FALSY = {"no", "off", "false", "0"}


def default_settings_path() -> Path:
    """The project-root ``settings.yaml`` (this file lives in ``src/capture/``)."""
    return Path(__file__).resolve().parents[2] / "settings.yaml"


@dataclass
class LLMSettings:
    enabled: bool = True
    url: str = "http://localhost:8080/v1"
    model: str = "qwen3.8-27b"


@dataclass
class Settings:
    host: str = "0.0.0.0"
    port: int = 8000
    db_path: Path = Path("captures.db")
    llm: LLMSettings = field(default_factory=LLMSettings)
    tags: list[str] = field(default_factory=lambda: ["inbox", "todo", "idea", "urgent"])


def load_settings(path: str | os.PathLike[str] | None = None) -> Settings:
    """Load and validate settings from ``settings.yaml`` (fresh read)."""
    settings_path = Path(path) if path is not None else default_settings_path()
    if not settings_path.is_file():
        msg = f"settings file not found: {settings_path}"
        if settings_path.name == "settings.yaml":
            msg += " — copy the bundled example first: `cp example.settings.yaml settings.yaml`"
        raise FileNotFoundError(msg)
    data = yaml.safe_load(settings_path.read_text()) or {}

    server = data.get("server") or {}
    database = data.get("database") or {}
    llm_data = data.get("llm") or {}

    tags = [str(t).strip() for t in data.get("tags") or ["inbox", "todo", "idea", "urgent"]]
    if not tags:
        raise ValueError("settings.yaml: 'tags' must list at least one tag")

    settings = Settings(
        host=str(server.get("host", "0.0.0.0")),
        port=int(server.get("port", 8000)),
        db_path=(settings_path.parent / str(database.get("path", "data/captures.db"))).resolve(),
        llm=LLMSettings(
            enabled=_as_bool(llm_data.get("enabled", True)),
            url=str(llm_data.get("url", "http://localhost:8080/v1")).rstrip("/"),
            model=str(llm_data.get("model", "qwen3.8-27b")),
        ),
        tags=tags,
    )
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    return settings


def supported_tags(path: str | os.PathLike[str] | None = None) -> list[str]:
    """Freshly read the supported tag list from ``settings.yaml``."""
    return load_settings(path).tags


def _as_bool(value: object) -> bool:
    """Accept YAML booleans as well as quoted ``yes``/``no`` strings."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        v = value.strip().lower()
        if v in _TRUTHY:
            return True
        if v in _FALSY:
            return False
    raise ValueError(f"invalid boolean setting: {value!r} (use yes/no)")
