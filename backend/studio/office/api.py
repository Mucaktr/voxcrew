"""/api/office uç noktaları — Ekip S3 (Faz 2) + S6 (Faz 3: rütbe, roller, işe alınanlar, beyin stratejisi).

GET    /api/office                                 → {teams, members, roles, ranks, templates}
GET    /api/office/templates                       → şablon listesi
GET    /api/office/templates/{id}                  → tek şablon
POST   /api/office/templates/{id}/preview          → kurulum önizlemesi (yazmaz): rol başına beyin, skill'ler
                                                     (kurulu/kurulu değil), "X adım Codex, Y adım Ollama"
POST   /api/office/templates/{id}/instantiate      → ekipler + roller + ajanlar + iş akışı (idempotent)
                                                     {strategy?: economy|balanced|quality, brain?, runtime?,
                                                      hermes_profile?, model?, prefix?, assign_skills?}
GET    /api/office/teams                           → ekipler
POST   /api/office/teams                           → ekip oluştur {name, mission?, color?, icon?, lead?}
PATCH  /api/office/teams/{slug}                    → {name?, mission?, color?, icon?, order?, lead?}
DELETE /api/office/teams/{slug}                    → ekip silinir; üyeler ekipsiz kalır, ajan silinmez
PATCH  /api/office/members/{slug}                  → {team?, title?, reports_to?, rank?, role_id?}
                                                     (döngü → 400; rütbe sırası tutarsızsa `warnings`)
POST   /api/office/members/{slug}/fire             → işe alınan ajanı işten çıkar {mode: hide|delete}
GET    /api/office/roles                           → roller (taşıyıcısıyla)
POST   /api/office/roles                           → rol oluştur {name, description?, team?, rank?, skills_hint?,
                                                     brain_hint?, holder?}
PATCH  /api/office/roles/{id}                      → {name?, description?, team?, rank?, skills_hint?,
                                                     brain_hint?, holder?} (holder: rolü bir ajana ver/boşalt)
DELETE /api/office/roles/{id}                      → rol silinir (rol adımlı akışlar "rolünde ajan yok" der)
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any, Callable, TypeVar

from fastapi import APIRouter, Body, HTTPException

from studio.office import catalog
from studio.office.service import Office

if TYPE_CHECKING:
    from studio.api import Studio

T = TypeVar("T")


def _guard(fn: Callable[[], T]) -> T:
    try:
        return fn()
    except KeyError as exc:
        raise HTTPException(404, str(exc).strip("'\"")) from exc
    except ValueError as exc:  # OfficeError, OntologyError, WorkflowError, TemplateError
        raise HTTPException(400, str(exc)) from exc


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/office", tags=["office"])
    office = Office(studio)
    # Yazan uç noktalar async: EventBus.publish yalnızca olay döngüsü iş parçacığından çağrılmalı
    # (sync rotalar thread havuzunda koşar). İşlemler kısa SQLite yazımlarıdır.

    # Okuyan rotalar da async: graf deposu tek SQLite bağlantısını paylaşır ve okumalar kilitsizdir; iş parçacığı
    # havuzunda eşzamanlı okumalar bozuk sonuç/500 verebiliyor (teknik lidere bildirildi). Olay döngüsünde koşmak
    # bu modülün katkısını sıraya sokar; şablon YAML'ları (dosya okuma) ayrı iş parçacığında yüklenir.
    @r.get("")
    async def overview() -> dict[str, Any]:
        # okumalar artık iş parçacığı güvenli (S15): olay döngüsünü bloklamadan ayrı iş parçacığında kur
        return await asyncio.to_thread(lambda: office.overview(catalog.load_templates()))

    # ------------------------------------------------------------ şablonlar
    @r.get("/templates")
    def templates() -> list[dict[str, Any]]:
        return [catalog.summary(t) for t in catalog.load_templates()]

    @r.get("/templates/{template_id}")
    def template(template_id: str) -> dict[str, Any]:
        return _guard(lambda: catalog.summary(catalog.get_template(template_id)))

    async def _avail(data: dict[str, Any], always: bool = False) -> dict[str, Any] | None:
        # Strateji yalnızca kurulumdaki mevcut bağlantılardan seçer (yoklama önbellekli, ~30 sn)
        return await office.availability() if (always or data.get("strategy")) else None

    @r.post("/templates/{template_id}/preview")
    async def preview(template_id: str, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        avail = await _avail(data, always=True)
        return _guard(lambda: office.preview(template_id, data, avail))

    @r.post("/templates/{template_id}/instantiate")
    async def instantiate(template_id: str, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        avail = await _avail(data)
        return _guard(lambda: office.instantiate(template_id, data, avail))

    # ------------------------------------------------------------ ekipler
    @r.get("/teams")
    async def teams() -> list[dict[str, Any]]:
        return await asyncio.to_thread(office.teams)

    @r.post("/teams")
    async def create_team(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return _guard(lambda: office.create_team(data))

    @r.patch("/teams/{slug}")
    async def update_team(slug: str, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return _guard(lambda: office.update_team(slug, data))

    @r.delete("/teams/{slug}")
    async def delete_team(slug: str) -> dict[str, Any]:
        return _guard(lambda: office.delete_team(slug))

    # ------------------------------------------------------------ üyeler
    @r.patch("/members/{slug}")
    async def assign_member(slug: str, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return _guard(lambda: office.assign(slug, data))

    @r.post("/members/{slug}/fire")
    async def fire_member(slug: str, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        return _guard(lambda: office.fire(slug, str(data.get("mode") or "hide")))

    # ------------------------------------------------------------ roller
    @r.get("/roles")
    async def roles() -> list[dict[str, Any]]:
        return await asyncio.to_thread(office.roles)

    @r.post("/roles")
    async def create_role(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return _guard(lambda: office.create_role(data))

    @r.patch("/roles/{role_id}")
    async def update_role(role_id: str, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return _guard(lambda: office.update_role(role_id, data))

    @r.delete("/roles/{role_id}")
    async def delete_role(role_id: str) -> dict[str, Any]:
        return _guard(lambda: office.delete_role(role_id))

    return r
