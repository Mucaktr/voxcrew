"""Dünya yapıcı ↔ oyun kilitleri.

- **Sahne kilidi:** kilitli bir yerleşik sahnenin (`meta.basedOn` zinciri `scene:<id>`'ye varan) kullanıcı kopyası etkin
  sahne yapılamaz ve çoğaltılamaz; kopya oluşturmak ve düzenlemek serbesttir. Oyun kapalıyken, yaratıcı modda ve
  yönetici/test modunda her şey açıktır (`GameService.is_owned` varsayılan görüntüleme kilidi).
  Karar 10: `basedOn` JSON'dan silinebildiği için ayrıca içerik parmak izi denetlenir (`worlds/fingerprint.py`;
  kilitli bir yerleşik sahneye eşik üstünde benzeyen içe aktarılmış/düzenlenmiş dünya da kilitli sayılır).
- **Dekor kilidi (S35):** ofis seviyesiyle açılan dekor (`game.catalog.DECOR`) kayıtta YENİ yerleştirilemez. Var olan
  dünyalardaki eşyalar kilitlenmez: kayıtta önceki sürümle, yerleşik kopyasında yerleşik dünyayla karşılaştırılır;
  içe aktarma denetlenmez (var olan dünya).
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import TYPE_CHECKING, Any

from studio.worlds import fingerprint
from studio.worlds.service import is_user_id

if TYPE_CHECKING:
    from studio.api import Studio
    from studio.worlds.service import WorldStore

MAX_CHAIN = 16
SCENE_LOCKED = "Bu dünya kilitli bir sahnenin kopyası; önce sahneyi Başarılar → Mağaza'dan aç"
DECOR_LOCKED = "Kilitli dekor yerleştirilemez: {} (ofis seviyesi {} gerekir)"


def _builtin_dir() -> Path:
    from studio.config import ROOT  # noqa: PLC0415
    return Path(ROOT) / "frontend" / "src" / "voxel" / "worlds"


def _game(st: "Studio") -> Any | None:
    """Kilitler etkin mi: oyun açık değilse None (oyun kapalıyken her şey açıktır)."""
    try:
        if not st.settings.get("game.enabled", True):
            return None
        from studio.game.api import get_service  # noqa: PLC0415
        return get_service(st)
    except Exception:  # noqa: BLE001 - oyun yoksa kilit de yok
        return None


def builtin_root(store: "WorldStore", doc: dict[str, Any] | None) -> str | None:
    """`meta.basedOn` zincirini izleyip yerleşik kökü (`office`, `londra` …) döndürür; yoksa None."""
    seen: set[str] = set()
    cur = doc
    for _ in range(MAX_CHAIN):
        meta = cur.get("meta") if isinstance(cur, dict) else None
        based = meta.get("basedOn") if isinstance(meta, dict) else None
        bid = based.get("id") if isinstance(based, dict) else None
        if not isinstance(bid, str) or not bid:
            return None
        if bid.startswith("scene:"):
            return bid[len("scene:"):] or None
        if not is_user_id(bid) or bid in seen or not store.exists(bid):
            return None
        seen.add(bid)
        try:
            cur = store.get(bid)
        except Exception:  # noqa: BLE001
            return None
    return None


def locked_scene_of(st: "Studio", store: "WorldStore", world_id: str) -> str | None:
    """Kullanıcı dünyası kilitli bir yerleşik sahneden türetildiyse o sahnenin kimliği; değilse None."""
    game = _game(st)
    if game is None or not store.exists(world_id):
        return None
    try:
        doc = store.get(world_id)
    except Exception:  # noqa: BLE001
        return None
    return locked_scene_of_doc(st, store, doc, cached=True)


def locked_scene_of_doc(st: "Studio", store: "WorldStore", doc: Any, *, cached: bool = False) -> str | None:
    """henüz kaydedilmemiş bir dünya belgesi için aynı kilit kararı (etkin dünyaya kayıt denetimi). İstemciden
    gelen belgede `meta.sha256` önbellek anahtarı olarak kullanılmaz (`cached=False`)."""
    game = _game(st)
    if game is None or not isinstance(doc, dict):
        return None
    try:
        root = builtin_root(store, doc)
    except Exception:  # noqa: BLE001
        return None
    if root and not game.is_owned(f"scene:{root}"):
        return root
    # karar 10: `basedOn` silinebilir (ya da açık bir sahneyi gösterecek biçimde değiştirilebilir) → içerik eşleşmesi
    try:
        hits = fingerprint.matches_cached(doc) if cached else fingerprint.matches(doc)
    except Exception:  # noqa: BLE001 - parmak izi hatası kilidi düşürmez, basedOn denetimi geçerli kalır
        return None
    for scene, _score in hits:
        if not game.is_owned(f"scene:{scene}"):
            return scene
    return None


# ------------------------------------------------------------------ dekor
def _decor_id(p: Any) -> str | None:
    """Prefab → dekor paleti kimliği (frontend/src/lib/builder.ts PALETTE ile aynı eşleme)."""
    if not isinstance(p, dict):
        return None
    t = p.get("t")
    if t == "cube":
        return "block_glow" if p.get("g") == "glow" else None
    return t if t in ("flag", "lantern", "campfire", "snowman") else None


def decor_counts(doc: Any) -> Counter[str]:
    layers = doc.get("layers") if isinstance(doc, dict) else None
    prefabs = layers.get("prefabs") if isinstance(layers, dict) else None
    out: Counter[str] = Counter()
    for p in prefabs if isinstance(prefabs, list) else []:
        if (d := _decor_id(p)) is not None:
            out[d] += 1
    return out


def _builtin_doc(scene: str) -> dict[str, Any] | None:
    try:
        path = _builtin_dir() / f"{scene}.json"
        if path.resolve().parent != _builtin_dir().resolve():
            return None
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return None


def added_locked_decor(st: "Studio", store: "WorldStore", doc: Any, *, previous: Any = None,
                       new_world: bool = False) -> tuple[str, int] | None:
    """Kilitli bir dekor yeni yerleştirildiyse (kimlik, gereken seviye); değilse None.

    `previous`: kayıtta önceki sürüm. `new_world`: oluşturmada taban `meta.basedOn` (yerleşik dosya ya da kullanıcı
    dünyası); yerleşik dosyası okunamazsa (paketlenmiş kurulum) denetim atlanır — var olan eşya kilitlenmez."""
    game = _game(st)
    if game is None or game.creative() or game.admin():
        return None
    from studio.game import catalog as C  # noqa: PLC0415
    level = game.office_level()
    locked = {d.id: d.unlock_level for d in C.DECOR if level < d.unlock_level}
    if not locked:
        return None
    base: Any = previous
    if new_world and base is None:
        meta = doc.get("meta") if isinstance(doc, dict) else None
        based = meta.get("basedOn") if isinstance(meta, dict) else None
        bid = based.get("id") if isinstance(based, dict) else None
        if isinstance(bid, str) and bid.startswith("scene:"):
            base = _builtin_doc(bid[len("scene:"):])
            if base is None:
                return None
        elif isinstance(bid, str) and is_user_id(bid) and store.exists(bid):
            base = store.get(bid)
    before, after = decor_counts(base), decor_counts(doc)
    for did, need in locked.items():
        if after[did] > before[did]:
            label = C.DECOR_BY_ID[did].label
            return label, need
    return None
