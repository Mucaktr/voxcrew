"""Çalışma klasörü: adım öncesi/sonrası anlık görüntü ile ajanın ürettiği dosyaları yakalar ve
yalnızca klasör içindeki dosyaların salt okunur önizlemesini verir."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", ".hermes", ".cache"}
TEXT_EXT = {".md", ".txt", ".json", ".jsonl", ".csv", ".yaml", ".yml", ".py", ".js", ".ts", ".tsx", ".html",
            ".css", ".xml", ".toml", ".ini", ".log", ".sql", ".sh", ".ps1"}

Snapshot = dict[str, tuple[float, int]]


def snapshot(root: Path, max_files: int = 5000, max_depth: int = 5) -> Snapshot:
    out: Snapshot = {}
    if not root.is_dir():
        return out
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = Path(dirpath).relative_to(root)
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        if len(rel_dir.parts) >= max_depth:
            dirnames[:] = []
        for name in filenames:
            p = Path(dirpath) / name
            try:
                st = p.stat()
            except OSError:
                continue
            out[(rel_dir / name).as_posix()] = (st.st_mtime, st.st_size)
            if len(out) >= max_files:
                return out
    return out


def changed(before: Snapshot, after: Snapshot) -> list[dict[str, Any]]:
    return [{"name": rel, "size": size, "new": rel not in before}
            for rel, (mtime, size) in sorted(after.items()) if before.get(rel) != (mtime, size)]


def resolve_inside(root: Path, rel: str) -> Path:
    target = (root / rel).resolve()
    base = root.resolve()
    if target != base and base not in target.parents:
        raise PermissionError("Çalışma klasörü dışındaki dosyalar okunamaz")
    if not target.is_file():
        raise FileNotFoundError(rel)
    return target


def read_preview(root: Path, rel: str, limit: int = 200_000) -> dict[str, Any]:
    path = resolve_inside(root, rel)
    size = path.stat().st_size
    is_text = path.suffix.lower() in TEXT_EXT
    text = None
    if is_text:
        with path.open("rb") as fh:
            text = fh.read(limit).decode("utf-8", "replace")
    return {"name": rel, "size": size, "kind": "markdown" if path.suffix.lower() == ".md" else "text" if is_text else "binary",
            "text": text, "truncated": bool(is_text and size > limit)}
