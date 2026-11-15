"""Koleksiyon listesi: sezon ödülleri (`season:*`) ve sürpriz kutunun masa süsleri (`desk:*`).

Bu öğelerin dünyada henüz bir görüntüsü ya da seçicisi yok; kazanılanlar yine de görünür olsun diye adlarıyla listelenir
ve arayüz "dünyada yakında görünecek" notunu dürüstçe gösterir. Salt okunur; hiçbir şey yazmaz.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from studio.game import catalog as C

if TYPE_CHECKING:
    from studio.game.service import GameService

PREFIXES = ("season:", "desk:")


def _season_items() -> dict[str, dict[str, Any]]:
    from studio.game.season import SEASONS  # noqa: PLC0415

    out: dict[str, dict[str, Any]] = {}
    for s in SEASONS:
        for track, rewards in (("free", s.free), ("premium", s.premium)):
            for rw in rewards:
                if rw.item and rw.item.startswith("season:"):
                    out[rw.item] = {"label": C._pick(rw.label_tr, rw.label_en), "kind": rw.kind, "rarity": None,
                                    "origin": "season", "season": s.id, "track": track}
    return out


def _desk_items() -> dict[str, dict[str, Any]]:
    from studio.game.surprise import EXTRAS  # noqa: PLC0415

    return {e.id: {"label": e.label, "kind": "desk", "rarity": e.rarity, "origin": "surprise", "season": None,
                   "track": None} for e in EXTRAS}


def view(svc: "GameService") -> dict[str, Any]:
    known = {**_season_items(), **_desk_items()}
    rows = svc.db.q("SELECT item_id, source, acquired_at FROM game_inventory WHERE item_id LIKE 'season:%' "
                    "OR item_id LIKE 'desk:%' ORDER BY acquired_at DESC")
    items = []
    for r in rows:
        meta = known.get(r["item_id"]) or {"label": r["item_id"], "kind": "desk" if r["item_id"].startswith("desk:")
                                           else "item", "rarity": None, "origin": "season", "season": None,
                                           "track": None}
        items.append({"id": r["item_id"], **meta, "source": r["source"], "acquired_at": r["acquired_at"],
                      "rendered": False})   # dünyada henüz çizilmiyor (dürüst not)
    return {"items": items, "count": len(items)}
