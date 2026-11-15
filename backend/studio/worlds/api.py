"""/api/worlds — dünya yapıcı (Faz 7a, S30). Bkz.

GET /api/worlds → {worlds: [özet…], limits}
POST /api/worlds/validate → {issues} (yazmaz)
POST /api/worlds → yeni kullanıcı dünyası (kimlik sunucuda üretilir: w_…)
POST /api/worlds/import → dosyadan içe aktar (meta.sha256 zorunlu ve doğrulanır; yeni kimlik)
GET /api/worlds/{id} → dünya belgesi
PUT /api/worlds/{id} → kaydet (yerleşik dünya → 403; geçersiz → 422 + karolu sorunlar);
                                           isteğe bağlı `If-Match: <meta.sha256>` → kayıtlı özet farklıysa 409
POST /api/worlds/{id}/duplicate → kopya (meta.basedOn dolar)
GET /api/worlds/{id}/export → indirilebilir.voxcrew-world.json (güncel sha256)
DELETE /api/worlds/{id} → sil (etkin sahneyse sahne ofise döner)
Olaylar: worlds.changed {id, action}, (silmede) scene.changed. kilitli yerleşik sahnenin kopyası etkin sahne
yapılamaz ve çoğaltılamaz (403); kilitli dekor kayıtta yeni yerleştirilemez (403). Bkz. `worlds/locks.py`.
"""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, Header, HTTPException
from fastapi.responses import JSONResponse, Response

from studio.i18n import translate
from studio.worlds import locks
from studio.worlds.service import MAX_WORLDS, SUFFIX, WorldError, get_store
from studio.worlds.validate import MAX_BLOCKS, MAX_LIGHTS, MAX_PREFABS, validate_world

if TYPE_CHECKING:
    from studio.api import Studio


def _localized(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{**i, "message": translate(i["message"])} for i in issues]


def _etag(value: str | None) -> str | None:
    """If-Match değeri: `"<sha>"`, `W/"<sha>"` ya da çıplak özet → özet; boş/`*` → None (koşulsuz kayıt)."""
    v = (value or "").strip()
    if v.startswith("W/"):
        v = v[2:]
    v = v.strip().strip('"').strip()
    return None if v in ("", "*") else v


def _fail(exc: WorldError) -> JSONResponse:
    detail: Any = translate(exc.message)
    if exc.issues:
        detail = {"message": detail, "issues": _localized(exc.issues)}
    return JSONResponse({"detail": detail}, status_code=exc.status)


def build_router(st: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/worlds")
    store = get_store(st)

    def publish(world_id: str, action: str) -> None:
        st.bus.publish("worlds.changed", id=world_id, action=action)

    def plan_gate() -> None:
        """ E8: yeni özel dünya (oluştur, içe aktar, kopyala) paket sınırında 409; var olanlar açılır, düzenlenir."""
        from studio.entitlements import gate  # noqa: PLC0415

        if (ent := gate(st)) is not None:
            ent.require("worlds")

    @r.get("")
    async def list_worlds() -> dict[str, Any]:
        worlds = await asyncio.to_thread(store.list)
        return {"worlds": worlds, "limits": {"worlds": MAX_WORLDS, "blocks": MAX_BLOCKS, "prefabs": MAX_PREFABS, "lights": MAX_LIGHTS}}

    @r.post("/validate")
    async def validate(doc: Any = Body(...)) -> dict[str, Any]:
        issues = await asyncio.to_thread(validate_world, doc)
        return {"issues": _localized(issues)}

    def decor_gate(doc: Any, *, previous: Any = None, new_world: bool = False) -> None:
        """kilitli dekor (S35) yeni yerleştirilemez; var olan eşyalar kilitlenmez."""
        hit = locks.added_locked_decor(st, store, doc, previous=previous, new_world=new_world)
        if hit is not None:
            raise WorldError(locks.DECOR_LOCKED.format(*hit), 403)

    @r.post("")
    async def create(doc: Any = Body(...)) -> Any:
        await asyncio.to_thread(plan_gate)
        try:
            await asyncio.to_thread(lambda: decor_gate(doc, new_world=True))
            out = await asyncio.to_thread(store.create, doc)
        except WorldError as exc:
            return _fail(exc)
        publish(out["id"], "created")
        return out

    @r.post("/import")
    async def import_world(doc: Any = Body(...)) -> Any:
        await asyncio.to_thread(plan_gate)
        try:
            out = await asyncio.to_thread(store.import_doc, doc)
        except WorldError as exc:
            return _fail(exc)
        publish(out["id"], "imported")
        return out

    @r.get("/{world_id}")
    async def get_world(world_id: str) -> Any:
        try:
            return await asyncio.to_thread(store.get, world_id)
        except WorldError as exc:
            return _fail(exc)

    @r.put("/{world_id}")
    async def save(world_id: str, doc: Any = Body(...), if_match: str | None = Header(None, alias="If-Match")) -> Any:
        try:
            if store.exists(world_id):
                prev = await asyncio.to_thread(store.get, world_id)
                await asyncio.to_thread(lambda: decor_gate(doc, previous=prev))
            # etkin dünyaya kilitli sahne içeriği kaydedilemez (sahne değişmediği için ayar kapısı görmez)
            if world_id == st.settings.get("scene") and await asyncio.to_thread(
                    locks.locked_scene_of_doc, st, store, doc):
                raise WorldError(locks.SCENE_LOCKED, 403)
            out = await asyncio.to_thread(store.save, world_id, doc, _etag(if_match))
        except WorldError as exc:
            return _fail(exc)
        publish(world_id, "saved")
        return out

    @r.post("/{world_id}/duplicate")
    async def duplicate(world_id: str, body: dict[str, Any] | None = Body(None)) -> Any:
        name = (body or {}).get("name")
        await asyncio.to_thread(plan_gate)
        try:
            if await asyncio.to_thread(locks.locked_scene_of, st, store, world_id):
                raise WorldError(locks.SCENE_LOCKED, 403)
            out = await asyncio.to_thread(store.duplicate, world_id, name if isinstance(name, str) and name.strip() else None)
        except WorldError as exc:
            return _fail(exc)
        publish(out["id"], "created")
        return out

    @r.get("/{world_id}/export")
    async def export(world_id: str) -> Any:
        try:
            doc = await asyncio.to_thread(store.export, world_id)
        except WorldError as exc:
            return _fail(exc)
        text = json.dumps(doc, ensure_ascii=False, indent=1)
        return Response(text, media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="{world_id}{SUFFIX}"'})

    @r.delete("/{world_id}")
    async def delete(world_id: str) -> Any:
        try:
            await asyncio.to_thread(store.delete, world_id)
        except WorldError as exc:
            return _fail(exc)
        publish(world_id, "deleted")
        if st.settings.get("scene") == world_id:
            st.settings.update({"scene": "office"})
            st.bus.publish("scene.changed", scene="office")
        return {"ok": True}

    return r


def scene_allowed(st: "Studio", scene: Any) -> bool:
    """Ayarlardaki sahne bir kullanıcı dünyası mı (api.py `PUT /settings` için; kilit/mağaza mantığına girmez)."""
    return isinstance(scene, str) and get_store(st).exists(scene)


def scene_locked(st: "Studio", scene: Any) -> bool:
    """kullanıcı dünyası kilitli bir yerleşik sahnenin kopyası mı (api.py `PUT /settings` reddeder)."""
    return isinstance(scene, str) and locks.locked_scene_of(st, get_store(st), scene) is not None


__all__ = ["build_router", "scene_allowed", "scene_locked", "HTTPException"]
