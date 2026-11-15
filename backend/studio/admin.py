"""Administrator / test mode: not part of this edition. The rest of the code only asks whether the mode is on (it never is)."""
from __future__ import annotations

from typing import Any, Mapping


def launch_build(env: Mapping[str, str] | None = None) -> bool:
    return True


def available() -> bool:
    return False


def is_active(settings: Any = None, env: Mapping[str, str] | None = None) -> bool:
    return False


def _restore_scene(studio: Any) -> str | None:
    return None
