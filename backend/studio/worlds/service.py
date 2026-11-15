"""Kullanıcı dünyaları deposu (Faz 7a, S30): `<veri dizini>/worlds/<id>.voxcrew-world.json`.

- Yalnızca `w_…` kimlikli kullanıcı dünyaları burada yaşar; 11 yerleşik dünya depoda (`frontend/src/voxel/worlds`)
  salt okunurdur. Yerleşik bir dünyayı "düzenle" arayüzde kopyasını oluşturur (`meta.basedOn` dolar) ve buraya kaydeder.
- Her yazma doğrulanır (`validate.validate_world`); hata varsa dosyaya dokunulmaz. Yazma atomiktir (geçici dosya → replace).
- `meta.sha256` her kayıtta yeniden hesaplanır; içe aktarmada dosyadaki özet doğrulanır (bozuk/değiştirilmiş dosya reddi).
- Depoya ya da kullanıcı yapılandırma klasörlerine (`~/.hermes` vb.) asla yazılmaz.
"""

from __future__ import annotations

import copy
import json
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from studio.worlds.validate import MAX_DEPTH, USER_ID_RE, errors_of, too_deep, validate_world, world_sha256

SUFFIX = ".voxcrew-world.json"
MAX_WORLDS = 200
MAX_FILE_BYTES = 2 * 1024 * 1024


BAD_FORMAT = "Dünya dosyası biçimi tanınmadı (voxcrew-world v1 bekleniyor)"
TOO_DEEP = f"Dünya dosyası çok derin iç içe yapı içeriyor (en çok {MAX_DEPTH} düzey)"
STALE = "Dünya bu arada başka bir yerde kaydedildi; üzerine yazılmadı. Yeniden yükleyip tekrar dene"


class WorldError(Exception):
    """Kullanıcıya gösterilecek hata (Türkçe ileti; EN karşılığı locales/en.py)."""

    def __init__(self, message: str, status: int = 400, issues: list[dict[str, Any]] | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.issues = issues or []


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_id() -> str:
    return f"w_{secrets.token_hex(6)}"


def is_user_id(world_id: str) -> bool:
    return isinstance(world_id, str) and bool(USER_ID_RE.match(world_id))


class WorldStore:
    def __init__(self, data_dir: Path):
        self.dir = Path(data_dir) / "worlds"
        self._lock = threading.Lock()

    # ------------------------------------------------------------ okuma
    def path(self, world_id: str) -> Path:
        if not is_user_id(world_id):
            raise WorldError("Yerleşik dünyalar salt okunur; düzenlemek için kopyasını oluştur", 403)
        return self.dir / f"{world_id}{SUFFIX}"

    def exists(self, world_id: str) -> bool:
        return is_user_id(world_id) and (self.dir / f"{world_id}{SUFFIX}").is_file()

    def get(self, world_id: str) -> dict[str, Any]:
        if not is_user_id(world_id):
            raise WorldError("Dünya yok", 404)
        p = self.dir / f"{world_id}{SUFFIX}"
        if not p.is_file():
            raise WorldError("Dünya yok", 404)
        try:
            return json.loads(p.read_text("utf-8"))
        except (OSError, ValueError) as exc:
            raise WorldError("Dünya dosyası okunamadı", 500) from exc

    def count(self) -> int:
        """Kayıtlı dünya dosyası sayısı (sınır denetimi için; dosyalar ayrıştırılmaz — QA O-09)."""
        if not self.dir.is_dir():
            return 0
        return sum(1 for _ in self.dir.glob(f"w_*{SUFFIX}"))

    def list(self) -> list[dict[str, Any]]:
        if not self.dir.is_dir():
            return []
        out = []
        for p in self.dir.glob(f"w_*{SUFFIX}"):
            try:
                doc = json.loads(p.read_text("utf-8"))
            except (OSError, ValueError):
                continue
            out.append(summary(doc))
        # str(): tek bir bozuk zaman damgası (ör. sayı) tüm listeyi 500'e düşürmesin (QA-F56)
        out.sort(key=lambda s: str(s.get("updated") or ""), reverse=True)
        return out

    # ------------------------------------------------------------ yazma
    def _write(self, doc: dict[str, Any]) -> dict[str, Any]:
        issues = validate_world(doc)
        if errors_of(issues):
            raise WorldError("Dünya geçersiz; işaretli karoları düzelt", 422, issues)
        doc["meta"]["sha256"] = world_sha256(doc)
        try:  # NaN/Infinity geçerli JSON değildir: dışa aktarılan dosya arayüzde açılamıyordu (QA-F56)
            text = json.dumps(doc, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        except ValueError as exc:
            raise WorldError("Dünya geçersiz sayı (NaN/Infinity) içeriyor", 422) from exc
        if len(text.encode("utf-8")) > MAX_FILE_BYTES:
            raise WorldError("Dünya dosyası çok büyük", 413)
        target = self.path(doc["id"])
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(f".{target.name}.{os.getpid()}.{int(time.time() * 1000)}.tmp")
        tmp.write_text(text, "utf-8")
        os.replace(tmp, target)
        return doc

    def _prepare(self, doc: Any, world_id: str) -> dict[str, Any]:
        if not isinstance(doc, dict):
            raise WorldError(BAD_FORMAT, 422)
        if too_deep(doc):  # QA O-08: deepcopy özyinelemelidir; derin belge 500 yerine 422
            raise WorldError(TOO_DEEP, 422)
        out = copy.deepcopy(doc)
        out["id"] = world_id
        out["baked"] = None
        meta = out.get("meta")
        if isinstance(meta, dict):
            meta.setdefault("created", _now())
            meta["updated"] = _now()
            if isinstance(meta.get("tags"), list):
                meta["tags"] = [t for t in meta["tags"] if t != "builtin"]
        return out

    def create(self, doc: Any) -> dict[str, Any]:
        with self._lock:
            if self.count() >= MAX_WORLDS:
                raise WorldError(f"En fazla {MAX_WORLDS} dünya kaydedilebilir", 409)
            prepared = self._prepare(doc, new_id())
            if isinstance(prepared.get("meta"), dict):
                prepared["meta"]["created"] = _now()
            return self._write(prepared)

    def save(self, world_id: str, doc: Any, if_match: str | None = None) -> dict[str, Any]:
        """`if_match` (PUT If-Match: <meta.sha256>) verilirse ve kayıtlı özet farklıysa 409: eski sekmenin kaydı başka
        bir yerde yapılmış değişikliği sessizce ezmez (QA O-06). Başlıksız istek eskisi gibi davranır."""
        with self._lock:
            if not self.path(world_id).is_file():
                raise WorldError("Dünya yok", 404)
            prepared = self._prepare(doc, world_id)
            old = self.get(world_id)
            if if_match is not None:
                stored = (old.get("meta") or {}).get("sha256") if isinstance(old.get("meta"), dict) else None
                if stored != if_match:
                    raise WorldError(STALE, 409)
            if isinstance(prepared.get("meta"), dict) and isinstance(old.get("meta"), dict):
                prepared["meta"]["created"] = old["meta"].get("created") or prepared["meta"]["created"]
            return self._write(prepared)

    def duplicate(self, world_id: str, name: str | None = None) -> dict[str, Any]:
        src = self.get(world_id)
        copy_doc = copy.deepcopy(src)
        meta = copy_doc.setdefault("meta", {})
        meta["basedOn"] = {"id": world_id, "sha256": src.get("meta", {}).get("sha256") or world_sha256(src)}
        base = str(meta.get("name") or "").strip()
        meta["name"] = (name or f"{base} (kopya)")[:80]
        return self.create(copy_doc)

    def delete(self, world_id: str) -> None:
        with self._lock:
            p = self.path(world_id)
            if not p.is_file():
                raise WorldError("Dünya yok", 404)
            p.unlink()

    # ------------------------------------------------------------ dışa / içe aktarma
    def export(self, world_id: str) -> dict[str, Any]:
        doc = self.get(world_id)
        doc["meta"]["sha256"] = world_sha256(doc)
        return doc

    def import_doc(self, doc: Any) -> dict[str, Any]:
        if not isinstance(doc, dict) or not isinstance(doc.get("meta"), dict):
            raise WorldError(BAD_FORMAT, 422)
        if too_deep(doc):  # özet (özyinelemeli) ve deepcopy'den önce (QA O-08)
            raise WorldError(TOO_DEEP, 422)
        claimed = doc["meta"].get("sha256")
        # paket özetle taşınır: özetsiz dosya kabul edilmez (QA-F56)
        if not isinstance(claimed, str) or not re.fullmatch(r"[0-9a-f]{64}", claimed):
            raise WorldError("Dünya paketinde geçerli bir sha256 özeti yok", 422)
        if claimed != world_sha256(doc):
            raise WorldError("Dosya bozuk ya da değiştirilmiş: sha256 özeti uyuşmuyor", 422)
        with self._lock:
            if self.count() >= MAX_WORLDS:
                raise WorldError(f"En fazla {MAX_WORLDS} dünya kaydedilebilir", 409)
            out = copy.deepcopy(doc)
            out["baked"] = None
            # gidiş-dönüş özeti korusun: kimlik boşsa ve geçerliyse aynen kalır; zaman damgaları dosyadakidir
            keep = is_user_id(out.get("id")) and not self.exists(out["id"])
            if not keep:
                out["id"] = new_id()
            for k in ("created", "updated"):  # zaman damgası metin değilse (ör. 5) yenisiyle değiştirilir (QA-F56)
                if not isinstance(out["meta"].get(k), str):
                    out["meta"].pop(k, None)
            out["meta"].setdefault("created", _now())
            out["meta"].setdefault("updated", out["meta"]["created"])
            return self._write(out)


def summary(doc: dict[str, Any]) -> dict[str, Any]:
    meta = doc.get("meta") or {}
    layers = doc.get("layers") or {}
    nav = doc.get("nav") or {}
    env = doc.get("env") or {}
    return {
        "id": doc.get("id"), "name": meta.get("name"), "description": meta.get("description", ""),
        "updated": meta.get("updated"), "created": meta.get("created"), "basedOn": meta.get("basedOn"),
        "sha256": meta.get("sha256"), "swatch": env.get("swatch"), "annex": (doc.get("grid") or {}).get("annex"),
        "prefabs": len(layers.get("prefabs") or []), "stations": len(nav.get("stations") or []),
        "match": _content_match(doc) if not meta.get("basedOn") else None,
    }


def _content_match(doc: dict[str, Any]) -> str | None:
    """Karar 10: `basedOn` yoksa içerikçe en çok benzediği yerleşik sahne (eşik üstü) — arayüz kilit rozeti için;
    asıl kilit sunucuda `locks.locked_scene_of` ile denetlenir."""
    from studio.worlds import fingerprint  # noqa: PLC0415

    try:
        hits = fingerprint.matches_cached(doc)
    except Exception:  # noqa: BLE001
        return None
    return hits[0][0] if hits else None


def get_store(studio: Any) -> WorldStore:
    """Studio başına tek depo (veri dizini: değişiklik servisinin dizini → DATA_DIR; testlerde geçici klasör)."""
    store = getattr(studio, "_world_store", None)
    if store is None:
        changes = getattr(studio, "changes", None)
        if changes is not None and getattr(changes, "data_dir", None):
            root = Path(changes.data_dir)
        else:
            from studio.config import DATA_DIR
            root = Path(DATA_DIR)
        store = WorldStore(root)
        studio._world_store = store
    return store
