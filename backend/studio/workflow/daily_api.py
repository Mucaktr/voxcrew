"""/api/budget/daily — günlük toplam bütçe tavanı (karar 13; bkz. `workflow/daily.py`).

| Uç | Gövde | Yanıt |
|---|---|---|
| `GET /api/budget/daily` | — | `{enabled, day, cap, effective, raised, spent, reached, metric, resets_at}` (MCP de okur) |
| `PUT /api/budget/daily` | `{cost_usd?, tokens?}` (boş/None = o metrik kapalı) | durum |
| `POST /api/budget/daily/raise` | `{cost_usd?, tokens?}` ya da `{}` (+%50) | durum — yalnız BUGÜN için |

Yazma uçları yalnızca kullanıcıdan: `/api/budget/` yolu `clients/tracker.py USER_ONLY_RE` içindedir (MCP 403; başlıksız
yerel süreç arayüz jetonu olmadan 403); rota ayrıca MCP başlığını ve arayüz varlığını denetler. `limits.daily_budget`
genel `PUT /api/settings` ile yazılamaz (`limits` zaten MCP'ye kapalı; arayüz de bu uca yönlendirilir).
Olay: `budget.daily` (durum) — arayüzdeki göstergeler yenilenir.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, HTTPException, Request

from studio.workflow.daily import METRICS, ledger_for, parse_cap, propose_raise

if TYPE_CHECKING:
    from studio.api import Studio

USER_ONLY = "Günlük bütçe tavanı yalnızca uygulama arayüzünden, kullanıcı tarafından değiştirilebilir"


def _user_only(request: Request) -> None:
    from studio.clients.tracker import mcp_client  # noqa: PLC0415
    from studio.presence import ui_present  # noqa: PLC0415
    if mcp_client(request) is not None or not ui_present(request):
        raise HTTPException(403, USER_ONLY)


def status(studio: "Studio") -> dict[str, Any]:
    return ledger_for(studio.settings).status(studio.settings)


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/budget", tags=["budget"])
    S = studio

    def publish() -> dict[str, Any]:
        st = status(S)
        try:
            S.bus.publish("budget.daily", **st)
        except Exception:  # noqa: BLE001 - olay yayını yalnız kolaylık
            pass
        return st

    @r.get("/daily")
    def get_daily() -> dict[str, Any]:
        return status(S)

    @r.put("/daily")
    async def put_daily(request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        _user_only(request)
        try:
            cap = parse_cap({k: data.get(k) for k in METRICS if k in data})
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        S.settings.update({"limits": {"daily_budget": cap}})
        return publish()

    @r.post("/daily/raise")
    async def raise_daily(request: Request, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        """Bugün için yükselt (ayar değişmez; gün dönümünde biter). Gövde boşsa açık metrikler +%50."""
        _user_only(request)
        led = ledger_for(S.settings)
        eff = led.effective(S.settings)
        if all(eff[k] is None for k in METRICS):
            raise HTTPException(409, "Günlük bütçe tavanı kapalı; yükseltilecek bir sınır yok")
        try:
            asked = parse_cap({k: data.get(k) for k in METRICS if k in data}) if data else None
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        new: dict[str, float | None] = {}
        auto = propose_raise(eff, led.spent())  # sıfır tavanda da yer açar; harcananın üstüne çıkar
        for k in METRICS:
            if eff[k] is None:
                new[k] = None
            elif asked is not None:
                if asked.get(k) is None:
                    new[k] = float(eff[k])  # type: ignore[arg-type]  # verilmeyen metrik olduğu gibi kalır
                    continue
                if float(asked[k]) < float(eff[k]):  # type: ignore[arg-type]
                    raise HTTPException(400, "Bugün için tavan yalnızca yükseltilebilir")
                new[k] = float(asked[k])  # type: ignore[arg-type]
            else:
                new[k] = auto[k]
        led.raise_today(new)
        return publish()

    return r
