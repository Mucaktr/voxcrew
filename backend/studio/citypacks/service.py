"""Şehir paketleri vitrini ve jeton yolu kaydı (CITY-PACKS).

```text
GET /api/citypacks/store ─▶ paketler, öğeler, risk, ÖNERİ fiyat (satış kapalı), sahiplik (bayrak açıkken)
jeton (bayrak açık) ─▶ POST /api/game/shop/store:city-<paket>/buy {confirm:true} ─▶ GameService (tek game_coins satırı,
                       idempotent) ─▶ game_inventory(item_id='store:city-<paket>-<öğe>', source='coin')
```

Kurallar:
- Para ile satın alma, ödeme ve ağ YOK. `price` her zaman None; `price_proposal` yalnız bilgi (öneri).
- Bu modül jeton, XP, SP, başarım ya da hak defterine YAZMAZ; envantere yalnız oyunun mevcut onaylı alım akışı yazar.
- Bayrak (`store.cosmetics_enabled`, kozmetik mağazasıyla ortak) kapalıyken jetonla alma kapalıdır; vitrin yalnız önizler.
- Yönetici/test modu sahiplik yazmaz (alım GameService'te zaten kapalı); arayüzde yalnız önizleme (şehir vitrini dahil).
- Sahiplik: paketin bütün öğeleri envanterde (kaynak fark etmez). Yeni öğe eklenen pakette eksik parça oranında jeton.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from studio.citypacks import catalog as K

if TYPE_CHECKING:
    from studio.game.service import GameService

FLAG = "store.cosmetics_enabled"


def enabled(studio: Any) -> bool:
    settings = getattr(studio, "settings", None)
    try:
        return settings is not None and settings.get(FLAG, False) is True
    except Exception:  # noqa: BLE001 - emin değilsek kapalı
        return False


def owned_pieces(svc: "GameService") -> set[str]:
    """Envanterdeki şehir paketi öğeleri (salt okuma)."""
    try:
        rows = svc.db.q("SELECT item_id FROM game_inventory WHERE item_id LIKE 'store:city-%'")
    except Exception:  # noqa: BLE001 - tablo yoksa sahiplik yok
        return set()
    return {r["item_id"] for r in rows if r["item_id"] in K.PIECE_PACK}


def coin_sellable(p: K.Pack, svc: "GameService") -> bool:
    """Jetonla alınabilir mi: bayrak açık ve paket yayın eşiğinde (risk ≤ 1)."""
    return enabled(svc.studio) and K.risk_state(p) == "ok"


def pack_view(svc: "GameService" | None, p: K.Pack, have: set[str], *, admin: bool, flag: bool) -> dict[str, Any]:
    missing = [pid for pid in p.pieces if pid not in have]
    cost = 0 if not missing else -(-p.coin_price * len(missing) // len(p.pieces))
    balance = svc.db.balance() if (svc is not None and flag) else None
    return {
        "id": p.id, "store_id": p.store_id, "kind": p.kind, "city": p.city, "surfaces": list(p.surfaces),
        "name": K.pick(p.name_tr, p.name_en), "description": K.pick(p.description_tr, p.description_en),
        "seasonal": p.seasonal,
        "items": [{"id": i.id, "store_id": p.piece_id(i), "name": K.pick(i.name_tr, i.name_en), "w": i.w, "d": i.d,
                   "solid": i.solid, "ip_risk": i.ip_risk, "culture_risk": i.culture_risk, "ip_note": i.ip_note,
                   "esinli": i.esinli, "legal_review_before_sale": i.legal_review_before_sale,
                   "owned": p.piece_id(i) in have} for i in p.items],
        "owned": not missing, "owned_count": len(p.pieces) - len(missing),
        "ip_risk": p.ip_risk, "culture_risk": p.culture_risk, "risk": K.risk_state(p),
        "legal_review_before_sale": p.legal_review_before_sale,
        # para: satış kapalı; yalnız öneri (karar ve ödeme kapısı bekleniyor)
        "price": None, "currency": None, "for_sale": False,
        "price_proposal": None if p.price_proposal_usd is None else {"usd": p.price_proposal_usd, "status": "proposal"},
        "plans_proposal": dict(p.plans_proposal),
        # jeton: oyunun mevcut onaylı alım akışı (bayrak arkasında); para fiyatından türetilmez
        "coin_price": p.coin_price, "coin_cost": cost,
        "coin_buy": {"method": "POST", "path": f"/api/game/shop/{p.store_id}/buy", "confirm": True},
        "can_buy_coins": bool(svc is not None and flag and not admin and missing and balance is not None
                              and balance >= cost and K.risk_state(p) == "ok"),
        "cosmetic_only": True,
    }


def store_view(svc: "GameService" | None, studio: Any) -> dict[str, Any]:
    flag = enabled(studio)
    admin = bool(svc is not None and svc.admin())
    have = owned_pieces(svc) if (svc is not None and flag) else set()
    return {
        "enabled": flag, "admin": admin, "mode": "preview", "for_sale": False, "price": None,
        "packs": [pack_view(svc, p, have, admin=admin, flag=flag) for p in K.PACKS],
        "balance": svc.db.balance() if (svc is not None and flag) else None,
        "rules": {"random": False, "countdown": False, "coin_sale": False, "coin_price_derived": False,
                  "advantage": False, "stamps": False},
    }


def register_coin_packs() -> None:
    """Jeton yolu: her paketi oyunun kozmetik set kaydına ekler (bağımlılık citypacks → game; game içe aktarmaz)."""
    from studio.game.service import StoreSet, register_store_labels, register_store_set  # noqa: PLC0415

    labels: dict[str, tuple[str, str]] = {p.store_id: (p.name_tr, p.name_en) for p in K.PACKS}
    labels.update({p.piece_id(i): (i.name_tr, i.name_en) for p in K.PACKS for i in p.items})
    register_store_labels(labels)
    for p in K.PACKS:
        register_store_set(StoreSet(p.store_id, p.name_tr, p.coin_price, p.pieces,
                                    enabled=lambda svc, _p=p: coin_sellable(_p, svc)))


register_coin_packs()
