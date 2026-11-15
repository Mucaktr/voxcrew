"""`/api/plan/*`. Okumalar herkese (yerel-yalnız); yazmalar kullanıcı-yalnız
(`clients.tracker.USER_ONLY_RE`; MCP istemcileri kadro değiştiremez).

Lisans uçları (`/api/license/*`) ağ, giriş ve ödeme yok.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, HTTPException, Query

from studio._edition import EDITION
from studio.entitlements import seats as S
from studio.entitlements.engine import attach
from studio.entitlements.plans import compare_table

if TYPE_CHECKING:
    from studio.api import Studio


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/plan", tags=["plan"])
    ent = attach(studio)
    st = studio
    try:  # açılışta bir kez: kurucu kararı + düşürme uyumu (yönetici modunda yazmaz)
        S.reconcile(st, ent)
    except Exception:  # noqa: BLE001 - paket uyumu açılışı asla engellemez
        pass

    def publish(kind: str, **data: Any) -> None:
        st.bus.publish(kind, **data)

    def seat_call(fn: Any) -> None:
        try:
            fn()
        except S.SeatError as exc:
            raise HTTPException(exc.status, exc.detail) from exc

    def changed(slugs: list[str]) -> dict[str, Any]:
        for slug in slugs:
            agent = st.agents.get(slug)
            if agent:
                publish("agent.updated", agent=agent)
        roster = S.roster(st, ent)
        publish("seat.changed", used=roster["used"], limit=roster["limit"])
        return roster

    @r.get("")
    async def plan() -> dict[str, Any]:
        await asyncio.to_thread(S.reconcile, st, ent)
        return await asyncio.to_thread(ent.snapshot)

    @r.get("/check")
    async def check(feature: str = Query(..., min_length=1, max_length=80)) -> dict[str, Any]:
        d = await asyncio.to_thread(ent.check, feature)
        return d.to_dict()

    @r.get("/compare")
    def compare() -> dict[str, Any]:
        from studio.i18n import request_lang

        return compare_table(request_lang())

    # ---- salt okuma uçları (yazma ucu yok; ödeme ve ağ yok)
    def _xp_reader() -> dict[str, Any] | None:
        svc = getattr(st, "_game_service", None)    # oyun içe aktarılmaz; varsa salt okunur kopya
        db = getattr(svc, "db", None)
        if db is None:
            return None
        xp, level = db.state("office", "office")
        return {"office_level": level, "office_xp": xp}

    def _refunded() -> set[str]:
        """iade edilen kozmetik işlemleri (oyun veritabanından salt okuma; tablo yoksa boş)."""
        db = getattr(getattr(st, "_game_service", None), "db", None)
        if db is None:
            return set()
        try:
            return {str(r["source_txn"]) for r in db.q("SELECT source_txn FROM cosmetic_refunds")}
        except Exception:  # noqa: BLE001 - tablo henüz yok
            return set()

    def _ledger_view() -> dict[str, Any]:
        view = ent.ledgers.view(xp_reader=_xp_reader)
        refunded = _refunded()
        for rows in view.values():
            for e in rows if isinstance(rows, list) else []:
                if isinstance(e, dict) and e.get("source_txn") in refunded:
                    e["refunded"], e["active"] = True, False  # iade görünümde de görünür
        return view

    @r.get("/ledgers")
    async def ledgers() -> dict[str, Any]:
        return await asyncio.to_thread(_ledger_view)

    @r.get("/offers")
    def offers_list() -> dict[str, Any]:
        from studio.entitlements import offers as O  # noqa: PLC0415

        return {"offers": [o.to_dict() for o in O.offers()] if EDITION == "full" else [], "currency": O.CURRENCY}

    @r.get("/roster")
    async def roster() -> dict[str, Any]:
        return await asyncio.to_thread(S.roster, st, ent)

    def _slug(data: dict[str, Any], key: str = "slug") -> str:
        v = data.get(key)
        if not isinstance(v, str) or not v.strip():
            raise HTTPException(400, f"{key} gerekli")
        return v.strip()

    @r.post("/seats/bench")
    async def bench(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        slug = _slug(data)
        await asyncio.to_thread(seat_call, lambda: S.bench(st, ent, slug))
        return changed([slug])

    @r.post("/seats/activate")
    async def activate(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        slug = _slug(data)
        await asyncio.to_thread(seat_call, lambda: S.activate(st, ent, slug))
        return changed([slug])

    @r.post("/seats/swap")
    async def swap(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        on, off = _slug(data, "activate"), _slug(data, "bench")
        await asyncio.to_thread(seat_call, lambda: S.activate(st, ent, on, swap_out=off))
        return changed([on, off])

    if EDITION == "full":  # fatura durumu ve test paketi uçları (kurucu/lisans/yönetici modu ile birlikte)
        from studio.full.plan_routes import add_routes  # noqa: PLC0415
        add_routes(r, ent, st, publish)

    return r
