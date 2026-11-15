"""/api/game/chests — üyelik sandıkları.

| Yöntem | Yol | Not |
|---|---|---|
| GET | /api/game/chests | hak edilen sandıkları yazar (önizlemede yazmaz) ve içerikleri AÇMADAN ÖNCE gösterir |
| POST | /api/game/chests/{id}/open `{choice?}` | sandığı açar (yalnız kullanıcı; bedel yok, yeniden çekme yok) |

Satın alma, jetonla açma ya da yeniden çekme ucu YOKTUR (tests/test_chests.py mimari testi). Açma ucu
`clients/tracker.USER_ONLY_RE` ile MCP'ye kapalıdır.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, HTTPException

from studio.game import chests
from studio.game.api import _publish, get_service

if TYPE_CHECKING:
    from studio.api import Studio


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/game/chests", tags=["game"])
    S = studio

    @r.get("")
    async def chest_view() -> dict[str, Any]:
        g = get_service(S)
        _publish(S, await asyncio.to_thread(chests.sync, g))
        return await asyncio.to_thread(chests.view, g)

    @r.post("/{chest_id}/open")
    async def chest_open(chest_id: str, data: dict[str, Any] | None = Body(None)) -> dict[str, Any]:
        choice = (data or {}).get("choice")
        choice = str(choice) if isinstance(choice, str) and choice else None
        try:
            res = await asyncio.to_thread(chests.open_chest, get_service(S), chest_id, choice)
        except KeyError as exc:
            raise HTTPException(404, str(exc).strip("'\"")) from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        _publish(S, res.pop("events", []))
        return res

    return r
