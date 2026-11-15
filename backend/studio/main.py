"""Uygulama girişi: FastAPI + derlenmiş arayüzün sunulması. Varsayılan olarak yalnızca 127.0.0.1'e bağlanır (Docker imajı hariç, bkz. bind_host)."""

from __future__ import annotations

import argparse
import os
import sys
import webbrowser
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from studio import __version__
from studio._edition import EDITION
from studio.api import Studio, build_router
from studio.brand import NAME as BRAND_NAME
from studio.config import FRONTEND_DIST, STUDIO_PORT


def create_app(studio: Studio | None = None) -> FastAPI:
    st = studio or Studio()

    if EDITION == "full":
        from studio.full import plugins as paid  # ücretli modüllerin yuvaları (free sürümde bu paket yoktur)
    else:
        paid = None

    def slot_mods(slot: str) -> list[Any]:
        return paid.mods(slot) if paid is not None else []

    def slot_routers(slot: str) -> tuple[Any, ...]:
        return paid.routers(slot) if paid is not None else ()

    from studio.game import api as game_api
    from studio.goals import api as goals_api
    # Faz 5: skill'ler, booster'lar, pazar yeri (her biri açılışta istem aşamalarını kaydedebilir)
    from studio.skills import api as skills_api
    # Faz 6: mesajlaşma, zamanlayıcı, iz (iskeletler; ekipler doldurur)
    from studio.messaging import api as messaging_api
    from studio.schedule import api as schedule_api
    from studio.trace import api as trace_api
    from studio.tools import api as tools_api  # S27: araç köprüsü + guardrail
    from studio.deliverables import api as deliverables_api  # S50: çıktılar (teslim, kütüphane, dışa aktarım)
    from studio.metrics import api as metrics_api  # G1-A: yerel ölçüm defteri ve kuzey yıldızı
    from studio import cdc_consumers, health  # Faz B-1: CDC tüketicileri + Sistem sağlığı
    from studio import config_cdc  # FAZB2: settings.json + iş akışı YAML değişiklik günlüğü (cdc.sqlite)

    life_mods = [skills_api, *slot_mods("after_skills"), messaging_api, trace_api, tools_api, *slot_mods("after_tools"),
                 schedule_api]

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        await st.startup()
        # Faz 3–4 servisleri: oyunlaştırma olay aboneliği, harici kaynak izleyicileri (ayar kapalıysa çalışmaz)
        await game_api.start(st)
        await goals_api.start(st)  # S10: goal.run_finished → hedef durumu/ilerlemesi
        for mod in slot_mods("after_goals"):  # academy (S31), external
            await mod.start(st)
        for mod in life_mods:
            await mod.start(st)
        await deliverables_api.start(st)  # S50: koşu bitişi → teslim kaydı + gelen kutusu
        for mod in slot_mods("after_deliverables"):  # recognition (W1b), estimate (CG-COST)
            await mod.start(st)
        await metrics_api.start(st)  # G1-A: yerel ölçüm defteri (Faz B-1: graf CDC tüketicisi olarak bağlanır)
        await cdc_consumers.start(st)  # Faz B-1: kayıtlı CDC tüketicilerini imleçle besler (metrics vb.)
        await health.start(st)  # Faz B-1: Sistem sağlığı eşik uyarıları (health.alert)
        await config_cdc.start(st)  # FAZB2: yapılandırma değişiklikleri (Sistem sağlığı "son yapılandırma değişiklikleri")
        yield
        await config_cdc.stop(st)
        await health.stop(st)
        await cdc_consumers.stop(st)
        await metrics_api.stop(st)
        for mod in reversed(slot_mods("after_deliverables")):
            await mod.stop(st)
        await deliverables_api.stop(st)
        for mod in reversed(life_mods):
            await mod.stop(st)
        for mod in reversed(slot_mods("after_goals")):
            await mod.stop(st)
        await goals_api.stop(st)
        await game_api.stop(st)
        await st.gateway.shutdown()  # S2: stüdyonun başlattığı gateway stüdyodan uzun yaşamaz
        runner = getattr(st.connections, "runner", None)  # S29: stüdyonun başlattığı `ollama serve` (stop_on_exit)
        if runner is not None:
            await runner.shutdown()
        st.shutdown()  # olay günlüğü (events.db) kapanır, seq tavanı yazılır
        st.store.close()

    # free sürümde /docs, /redoc ve /openapi.json yok (Swagger UI dış CDN'den yüklenir; yüzey gereksiz yere açılmaz)
    no_docs: dict[str, Any] = {} if EDITION == "full" else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(title=BRAND_NAME, version=__version__, lifespan=lifespan, **no_docs)
    app.state.studio = st
    # Yerel-yalnız: Host doğrulaması (DNS rebinding) + başka siteden durum değiştiren istek reddi (CSRF)
    # Kullanıcı varlığı: kullanıcıya ait uçlar (USER_ONLY_RE + onay kararı) arayüz jetonu ister
    #.
    # LocalOnly'den önce eklenir; böylece Host/köken denetimi dışta kalır ve önce o çalışır.
    # ayrık değerlendirme sürerken mühürlü ad alanı okuma uçlarından görünmez (mühür yokken maliyetsiz geçiş)
    from studio.graph.cdc import GraphActorMiddleware
    app.add_middleware(GraphActorMiddleware)  # CDC (C1): istek boyunca graf yazımlarının aktörü (user / mcp:<ad>)
    from studio.graph.sealed import SealedReadMiddleware
    app.add_middleware(SealedReadMiddleware)
    from studio.presence import UserPresenceMiddleware
    app.add_middleware(UserPresenceMiddleware)
    from studio.security import LocalOnlyMiddleware
    app.add_middleware(LocalOnlyMiddleware)
    # Faz 5: istek dili (X-Studio-Lang) → contextvar; hata iletileri ve ajan istemleri bu dili izler
    from studio.i18n import I18nMiddleware, register_stages
    app.add_middleware(I18nMiddleware)
    register_stages()  # istem hattı: dil aşaması (order 10) — ajan istemleri agents.language'a göre TR/EN
    if paid is not None:
        paid.register_stages()  # W1b: takdir aşaması (order 40) — bellekli adımlarda referans örnekler
    # S11: `X-Studio-Client: mcp/<istemci>` başlıklı istekler (Claude Code / Codex MCP sunucusu) son-görülme
    # kaydına ve `clients.seen` olayına çevrilir; MCP kapalıysa bu istekler 403 alır. /api/clients kendisi bağlar.
    from fastapi import Depends
    from studio.clients.tracker import client_seen
    seen = [Depends(client_seen(st))]
    app.include_router(build_router(st), dependencies=seen)
    # Faz 2 ekip modülleri (her ekip kendi router'ını doldurur)
    from studio.changes_api import build_router as changes_router
    from studio.connections.api import build_router as connections_router
    from studio.gateway.api import build_router as gateway_router
    from studio.hermes.api import build_router as hermes_router
    from studio.office.api import build_router as office_router
    for factory in (changes_router, hermes_router, gateway_router, office_router, connections_router):
        app.include_router(factory(st), dependencies=seen)
    # Faz 3–4 ekip modülleri
    from studio.clients.api import build_router as clients_router
    for factory in (game_api.build_router, goals_api.build_router, skills_api.build_router,
                    *slot_routers("after_skills"), messaging_api.build_router, schedule_api.build_router,
                    trace_api.build_router, tools_api.build_router, *slot_routers("after_tools")):
        app.include_router(factory(st), dependencies=seen)
    # Faz 7a (S30): dünya yapıcı — kullanıcı dünyaları
    from studio.worlds.api import build_router as worlds_router
    app.include_router(worlds_router(st), dependencies=seen)
    for factory in slot_routers("after_worlds"):  # academy (S31)
        app.include_router(factory(st), dependencies=seen)
    app.include_router(deliverables_api.build_router(st), dependencies=seen)  # S50
    for factory in slot_routers("after_deliverables"):  # recognition (W1b)
        app.include_router(factory(st), dependencies=seen)
    from studio.walk.api import build_router as walk_router  # W4: /api/walk (yazma kullanıcı-yalnız)
    app.include_router(walk_router(st), dependencies=seen)
    from studio.expanse.api import build_router as expanse_router  # E2: /api/expanse (parseller; yazma kullanıcı-yalnız)
    app.include_router(expanse_router(st), dependencies=seen)
    from studio.heroes.api import build_router as heroes_router  # S44: kahramanlar (işe al / kaldır)
    app.include_router(heroes_router(st), dependencies=seen)
    from studio.entitlements.api import build_router as plan_router  # /api/plan (hak motoru; yazma kullanıcı-yalnız)
    app.include_router(plan_router(st), dependencies=seen)
    for factory in slot_routers("after_plan"):  # account, recipes (CG-RECIPES), estimate (CG-COST)
        app.include_router(factory(st), dependencies=seen)
    from studio.connections.catalog_api import build_router as mcp_catalog_router  # CG2: /api/mcp-catalog
    for factory in (mcp_catalog_router, *slot_routers("after_mcp_catalog")):  # CG2: time-saved ücretli yuvada
        app.include_router(factory(st), dependencies=seen)
    from studio.share.api import build_router as share_router  # SHARE: /api/share (içe aktarma kullanıcı-yalnız)
    app.include_router(share_router(st), dependencies=seen)
    from studio.portability.api import build_router as portability_router  # her şeyi dışa aktar (kullanıcı-yalnız)
    app.include_router(portability_router(st), dependencies=seen)
    from studio.safemode import build_router as safe_mode_router  # TRUST: /api/safe-mode (güvenli mod, 18+ beyanı)
    app.include_router(safe_mode_router(st), dependencies=seen)
    from studio.workflow.daily_api import build_router as daily_budget_router  # karar 13: /api/budget/daily
    app.include_router(daily_budget_router(st), dependencies=seen)
    from studio.workflow.error_class_api import build_router as error_class_router  # /api/error-classes
    app.include_router(error_class_router(st), dependencies=seen)
    from studio.game.loop_api import build_router as loop_router  # /api/game/loop (ilk oturum, açılım, sağlık, boss)
    app.include_router(loop_router(st), dependencies=seen)
    from studio.game.chests_api import build_router as chests_router  # 2026-10-19: /api/game/chests (üyelik sandıkları)
    app.include_router(chests_router(st), dependencies=seen)
    for factory in slot_routers("after_chests"):  # G2-D R-3: /api/game/fun
        app.include_router(factory(st), dependencies=seen)
    app.include_router(metrics_api.build_router(st), dependencies=seen)  # G1-A: /api/metrics (silme kullanıcı-yalnız)
    app.include_router(health.build_router(st), dependencies=seen)  # Faz B-1: /api/health/details, /api/events/types
    from studio.cities.graph_sync import build_router as world_graph_router  # FAZB2: /api/world-graph (eşitleme kullanıcı-yalnız)
    app.include_router(world_graph_router(st), dependencies=seen)
    from studio.graph.taxonomy import build_router as taxonomy_router  # FAZB2: /api/taxonomy (yazma kullanıcı-yalnız)
    app.include_router(taxonomy_router(st), dependencies=seen)
    for factory in slot_routers("after_taxonomy"):  # REV-C: tam sürüm
        app.include_router(factory(st), dependencies=seen)
    from studio.cosmetics.api import build_router as cosmetics_router  # COS-A: /api/cosmetics (yazma kullanıcı-yalnız)
    app.include_router(cosmetics_router(st), dependencies=seen)
    from studio.citypacks.api import build_router as citypacks_router  # CITY-PACKS: /api/citypacks (yalnız okuma)
    app.include_router(citypacks_router(st), dependencies=seen)
    for factory in slot_routers("after_citypacks"):  # G6: sergi, iki yaklaşım, nerede kalmıştım, bildirim
        app.include_router(factory(st), dependencies=seen)
    from studio.connectors.claude_isolation import build_router as claude_isolation_router  # (yazma kullanıcı-yalnız)
    app.include_router(claude_isolation_router(st), dependencies=seen)
    from studio.connectors.codex_isolation import build_router as codex_isolation_router  # PROC-FIX (kullanıcı-yalnız)
    app.include_router(codex_isolation_router(st), dependencies=seen)
    from studio.buildinfo import build_router as build_meta_router  # STALE-DIST: /api/meta/build (salt okunur)
    from studio.workzones.api import build_router as work_zones_router  # WORK-ZONES: /api/work-zones (yazma kullanıcı-yalnız)
    app.include_router(work_zones_router(st), dependencies=seen)
    app.include_router(build_meta_router(st), dependencies=seen)
    for factory in slot_routers("after_build_meta"):  # G7: /api/telemetry (rızalı toplu telemetri; kullanıcı-yalnız)
        app.include_router(factory(st), dependencies=seen)
    for factory in (*(paid.ingest_routers() if paid is not None else ()), clients_router):  # alım uçları / kendi bağımlılığı olanlar
        app.include_router(factory(st))

    if (FRONTEND_DIST / "index.html").is_file():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str) -> Any:
            # free'de kapalı belge uçları SPA'ya düşüp 200 dönmesin (tam sürümde bu yollar daha önce eşleşir)
            if path.startswith("api/") or path in ("docs", "redoc", "openapi.json"):
                return JSONResponse({"detail": "Bulunamadı"}, status_code=404)
            target = (FRONTEND_DIST / path).resolve()
            if path and target.is_file() and FRONTEND_DIST.resolve() in target.parents:
                return FileResponse(target)
            return FileResponse(FRONTEND_DIST / "index.html")
    return app


def open_browser(url: str) -> None:
    """Tarayıcıyı kısa ömürlü ayrık bir yardımcı süreçle açar: tarayıcı bu sunucunun torunu olmaz. Kullanıcı varlığı
    kapısı stüdyonun başlattığı süreçlerden gelen kullanıcı işlemlerini reddeder (studio.peer, ADR-kullanici-varligi)."""
    import subprocess

    from studio.connectors.base import group_popen_kwargs
    try:
        subprocess.Popen([sys.executable, "-c", "import sys, webbrowser; webbrowser.open(sys.argv[1])", url],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         close_fds=True, **group_popen_kwargs())
    except OSError:
        webbrowser.open(url)


def bind_host() -> str:
    """Dinlenen adres: 127.0.0.1. Tek istisna Docker imajı (VOXCREW_CONTAINER=1 + STUDIO_BIND_HOST): konteyner içinde
    0.0.0.0 gerekir, ana makineye yalnızca docker-compose.yml'deki 127.0.0.1:7420 eşlemesiyle açılır. Konteyner
    dışında STUDIO_BIND_HOST yok sayılmaz, açıkça reddedilir; Host/Origin denetimleri (security.py) hiç gevşemez."""
    host = os.environ.get("STUDIO_BIND_HOST", "").strip() or "127.0.0.1"
    if host != "127.0.0.1" and os.environ.get("VOXCREW_CONTAINER") != "1":
        raise SystemExit(f"STUDIO_BIND_HOST={host} yalnızca Docker imajında (VOXCREW_CONTAINER=1) kullanılabilir; "
                         "yoksa yalnızca 127.0.0.1'e bağlanılır. / STUDIO_BIND_HOST is only honoured inside the Docker image.")
    return host


def cli() -> None:
    # Yoğun iş parçacığı (SQLite okumaları, alt süreç akışları) altında olay döngüsü aç kalmasın
    sys.setswitchinterval(0.0005)
    # Çıktı dosyaya yönlendirildiğinde Windows kod sayfası (cp1254) "→" gibi karakterlerde çökmesin
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description=f"{BRAND_NAME} sunucusu")
    parser.add_argument("--port", type=int, default=STUDIO_PORT)
    parser.add_argument("--open", action="store_true", help="Tarayıcıda aç")
    args = parser.parse_args()
    import uvicorn

    url = f"http://127.0.0.1:{args.port}"
    print(f"{BRAND_NAME} → {url}  (durdurmak için Ctrl+C)")
    # STALE-DIST: sunulan arayüz derlemesi kaynaktan eskiyse açılışta açıkça söyle (yeniden derleme kullanıcının kararı)
    # (start.ps1 / start.sh denetimi kendisi yapıp gösterdiyse ikinci kez yazılmaz)
    from studio.buildinfo import CHECKED_ENV, warn_if_stale
    if os.environ.get(CHECKED_ENV) != "1":
        warn_if_stale()
    if args.open:
        open_browser(url)
    uvicorn.run(create_app(), host=bind_host(), port=args.port, log_level="warning")


if __name__ == "__main__":
    cli()
