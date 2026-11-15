"""Ajan ↔ skill bağlamaları ve onaylı sürümler (G1-D, AUDIT §3.2 kural 2 ve 4; kullanıcı kararı 2).

Kayıt `<veri>/skills/bindings.json` içindedir (ontoloji değişmez; `agents.skills` listesi atamanın kaynağı olarak kalır):

```
{"format": "voxcrew-skill-bindings/1", "migrated_at": <ts>,
 "agents":   {"<slug>": {"<anahtar>": {"sha": "<sha256>|null", "mode": "catalog|always|never",
                                     "bound_at": <ts>, "origin": "migration|assign|user"}}},
 "versions": {"<anahtar>": [{"sha": "…", "approved_at": <ts>, "origin": "migration|import", "name": "…"}]}}
```

Kurallar:
- **Göç** (`migrate`, açılışta bir kez; dosya yoksa): o anda atanmış ve istemle giden her skill'in canlı içeriği
  anlık görüntüye alınır, `always` + o sha ile bağlanır. Bugünkü istem bayt bayt aynı kalır.
- **Yeni atama** `catalog`'dur: istemde yalnız ad + açıklama; gövde seçiciyle ihtiyaçta. Sha, anahtarın en son onaylı
  sürümüdür; onaylı sürüm yoksa bağlama `pending` kalır ve skill isteme hiç girmez (AW-T19).
- **Sürüm geçişi otomatik değildir:** kaynakta yeni içerik görülünce bağlı ajan eski sha'da kalır; "güncelleme var"
  bayrağı çıkar. Yeni sürüm yalnız kullanıcının onayıyla (`/api/skills/import/confirm`, `/api/skills/bind`) devreye girer.
- **Dosya yoksa (göç çalışmadıysa)** kayıt etkin değildir: eski davranış (canlı içerik, `always`). Uygulama açılışı
  `skills.api.start` içinde göçü her zaman çalıştırır.
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Iterable

from .snapshot import SHA_RE, SnapshotError, SnapshotStore, collect

MODES: tuple[str, ...] = ("catalog", "always", "never")
DEFAULT_NEW_MODE = "catalog"      # kullanıcı kararı 2
FORMAT = "voxcrew-skill-bindings/1"


class BindingError(ValueError):
    pass


def _empty() -> dict[str, Any]:
    return {"format": FORMAT, "migrated_at": None, "agents": {}, "versions": {}}


class BindingStore:
    def __init__(self, skills_root: Path):
        self.path = Path(skills_root) / "bindings.json"
        self._lock = threading.RLock()
        self._cache: tuple[int, dict[str, Any]] | None = None

    # ------------------------------------------------------------------ dosya
    @property
    def active(self) -> bool:
        return self.path.is_file()

    def load(self) -> dict[str, Any]:
        with self._lock:
            try:
                mtime = self.path.stat().st_mtime_ns
            except OSError:
                return _empty()
            if self._cache and self._cache[0] == mtime:
                return self._cache[1]
            try:
                data = json.loads(self.path.read_text("utf-8"))
            except (OSError, ValueError):
                data = None
            if not isinstance(data, dict):
                # bozuk kayıt: güvenli taraf — bağlamalar yok sayılır (yeni atamalar onay bekler), dosyaya dokunulmaz
                data = {**_empty(), "migrated_at": 0, "corrupt": True}
            data.setdefault("agents", {})
            data.setdefault("versions", {})
            self._cache = (mtime, data)
            return data

    def _save(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(f".bindings.{uuid.uuid4().hex[:6]}.tmp")
        try:
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", "utf-8")
            os.replace(tmp, self.path)
        finally:
            tmp.unlink(missing_ok=True)
        self._cache = None

    def _mutate(self, fn: Any) -> Any:
        with self._lock:
            data = json.loads(json.dumps(self.load()))
            if data.get("corrupt"):
                raise BindingError("bindings.json okunamadı; elle incele (üzerine yazılmaz)")
            data.pop("corrupt", None)
            if not data.get("migrated_at"):
                data["migrated_at"] = time.time()
            out = fn(data)
            self._save(data)
            return out

    # ------------------------------------------------------------------ okuma
    def binding(self, slug: str, key: str) -> dict[str, Any] | None:
        b = self.load()["agents"].get(slug, {}).get(key)
        return dict(b) if isinstance(b, dict) else None

    def agent(self, slug: str) -> dict[str, dict[str, Any]]:
        return {k: dict(v) for k, v in self.load()["agents"].get(slug, {}).items() if isinstance(v, dict)}

    def versions(self, key: str) -> list[dict[str, Any]]:
        return [dict(v) for v in self.load()["versions"].get(key, []) if isinstance(v, dict)]

    def latest(self, key: str) -> str | None:
        vs = self.versions(key)
        return vs[-1]["sha"] if vs else None

    def is_approved(self, key: str, sha: str | None) -> bool:
        return bool(sha) and any(v.get("sha") == sha for v in self.versions(key))

    # ------------------------------------------------------------------ yazma
    def add_version(self, key: str, sha: str, *, origin: str, name: str | None = None) -> None:
        if not SHA_RE.match(sha or ""):
            raise BindingError("Geçersiz sürüm özeti")

        def fn(data: dict[str, Any]) -> None:
            vs = [v for v in data["versions"].get(key, []) if v.get("sha") != sha]
            vs.append({"sha": sha, "approved_at": time.time(), "origin": origin, "name": name})
            data["versions"][key] = vs[-20:]
        self._mutate(fn)

    def bind(self, slug: str, key: str, *, mode: str, sha: str | None, origin: str) -> dict[str, Any]:
        if mode not in MODES:
            raise BindingError(f"mode: {', '.join(MODES)} olmalı")
        if sha is not None and not self.is_approved(key, sha):
            raise BindingError("Bu sürüm onaylanmamış; önce içe aktarma önizlemesini onayla")
        rec = {"sha": sha, "mode": mode, "bound_at": time.time(), "origin": origin}

        def fn(data: dict[str, Any]) -> dict[str, Any]:
            data["agents"].setdefault(slug, {})[key] = rec
            return rec
        return self._mutate(fn)

    def record_new(self, slug: str, keys: Iterable[str], *, origin: str = "assign") -> list[str]:
        """Yeni atamaları `catalog` + en son onaylı sha ile kaydeder (var olan bağlama korunur)."""
        keys = list(keys)

        def fn(data: dict[str, Any]) -> list[str]:
            cur = data["agents"].setdefault(slug, {})
            added = []
            for k in keys:
                if k in cur:
                    continue
                vs = data["versions"].get(k) or []
                cur[k] = {"sha": vs[-1]["sha"] if vs else None, "mode": DEFAULT_NEW_MODE,
                          "bound_at": time.time(), "origin": origin}
                added.append(k)
            return added
        return self._mutate(fn) if keys else []

    def drop(self, slug: str, keys: Iterable[str]) -> None:
        keys = set(keys)
        if not keys or not any(k in self.agent(slug) for k in keys):
            return

        def fn(data: dict[str, Any]) -> None:
            cur = data["agents"].get(slug, {})
            for k in keys:
                cur.pop(k, None)
        self._mutate(fn)

    def mark_migrated(self) -> None:
        self._mutate(lambda data: None)


# ---------------------------------------------------------------------- göç
def snapshot_entry(snapshots: SnapshotStore, key: str, entry: dict[str, Any]) -> str:
    """Kütüphane girdisinin canlı içeriğini (yalnız okuyarak) değişmez kopyaya alır → sha."""
    md = Path(entry["path"])
    files = collect(md.parent, md)
    meta = {"id": entry.get("id"), "source": entry.get("source"), "name": entry.get("name"),
            "description": entry.get("description"), "tags": list(entry.get("tags") or []), "version": entry.get("version")}
    return snapshots.write(key, files, meta)


def migrate(store: BindingStore, snapshots: SnapshotStore, library: Any, agents: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Bir kez: bugünkü atamalar → `always` + bugünkü canlı sha. Kayıt zaten varsa hiçbir şey yapmaz."""
    if store.active:
        return {"migrated": False, "bound": 0}
    bound: list[tuple[str, str, str, str | None]] = []
    failed: list[str] = []
    for agent in agents:
        props = agent.get("props", agent)
        slug = props.get("slug")
        if not slug:
            continue
        for r in library.resolve_assigned(agent):
            if r["how"] != "prompt" or not r["entry"]:
                continue        # Hermes -s yolu ve eksik skill'ler göçe girmez (davranışları değişmez)
            try:
                sha = snapshot_entry(snapshots, r["key"], r["entry"])
            except (SnapshotError, OSError):
                failed.append(f"{slug}:{r['key']}")
                continue
            bound.append((slug, r["key"], sha, r["entry"].get("name")))

    def fn(data: dict[str, Any]) -> None:
        for slug, key, sha, name in bound:
            vs = data["versions"].setdefault(key, [])
            if not any(v.get("sha") == sha for v in vs):
                vs.append({"sha": sha, "approved_at": time.time(), "origin": "migration", "name": name})
            data["agents"].setdefault(slug, {})[key] = {"sha": sha, "mode": "always", "bound_at": time.time(),
                                                        "origin": "migration"}
    store._mutate(fn)
    return {"migrated": True, "bound": len(bound), "failed": failed}


# ---------------------------------------------------------------------- çalışma anı çözümü
def effective(store: BindingStore, snapshots: SnapshotStore, slug: str | None, key: str) -> dict[str, Any]:
    """Bir atamanın çalışma anındaki durumu.

    status: `legacy` (kayıt etkin değil; canlı içerik) · `ok` · `pending` (onaylı sürüm yok) · `off` (never) ·
    `blocked` (sabitlenen kopya diskte yok ya da sha ile uyuşmuyor → yüklenmez)."""
    if not store.active:
        return {"mode": "always", "sha": None, "status": "legacy", "origin": None, "content": None}
    b = store.binding(slug, key) if slug else None
    if b is None:
        b = {"sha": store.latest(key), "mode": DEFAULT_NEW_MODE, "origin": "implicit"}
    mode = b.get("mode") if b.get("mode") in MODES else DEFAULT_NEW_MODE
    sha = b.get("sha")
    out = {"mode": mode, "sha": sha, "origin": b.get("origin"), "content": None}
    if mode == "never":
        return {**out, "status": "off"}
    if not sha:
        return {**out, "status": "pending"}
    content = snapshots.load(key, sha)
    if content is None:
        return {**out, "status": "blocked", "reason": snapshots.verify(key, sha)}
    return {**out, "status": "ok", "content": content}
