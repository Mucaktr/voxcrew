"""REST + SSE API. Uygulama durumu Studio nesnesinde tutulur; rotalar yalnızca ince bir katmandır."""

from __future__ import annotations

import copy
import os
import re

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from studio import __version__, workspace
from pathlib import Path

from studio.agents import AgentRegistry, RouteError
from studio.changes import ChangeService
from studio.changes import mask_value
from studio._edition import EDITION
from studio.cities import NEW_CITY_IDS
from studio.clients.tracker import MCP_TOOL_CHOICES, mcp_blocked_settings, mcp_client
from studio.presence import ui_present
from studio import temp_filter
from studio._edition import EDITION
from studio.config import (ONTOLOGY_FILE, DATA_DIR, EXAMPLE_WORKFLOWS_DIR, USER_WORKFLOWS_DIR, Settings,
                           SettingsCorrupt, platform_state_dir)
from studio.connectors.base import Connector, Invocation, Route
from studio.connectors.claude import ClaudeConnector
from studio.connectors.codex import CodexConnector
from studio.connectors.discovery import ConnectionProbe
from studio.connectors.openai_compat import OpenAICompatConnector
from studio.connections.secrets import SecretStore
from studio.connectors.hermes import HermesConnector
from studio.connectors.hermes_api import HermesApiConnector, HermesDispatcher
from studio.gateway.manager import GatewayManager
from studio.connectors.ollama import OllamaConnector, list_models
from studio.eventlog import EventLog
from studio.events import DEFAULT_REPLAY_LIMIT, EventBus, sse_stream
from studio.graph import redact as graph_redact
from studio.graph.memory import GraphMemory
from studio.graph.store import GraphStore
from studio.ontology import Ontology, OntologyError
from studio.workflow import idem
from studio.workflow.engine import Engine
from studio.i18n import translate_detail
from studio.workflow.spec import WorkflowError, WorkflowLibrary, parse, validate

# Faz 3 (S7): eğlenceli sahneler; kilitleri oyunlaştırma mağazası yönetir (scene:<id>)
_ORIGIN_RE = re.compile(r"^(ui|goal|mcp:[a-z0-9][a-z0-9-]{0,39})$")


def run_origin(data: dict[str, Any], request: Request | None = None) -> str | None:
    """Koşunun kökeni: gövdedeki `origin` (ui | goal | mcp:<istemci>) ya da MCP sunucusunun
    `X-Studio-Client: mcp/<istemci>` başlığı. Tanınmayan değerler yok sayılır (serbest metin grafa girmesin).
    A-08: MCP başlığı varsa köken her zaman başlıktan gelir; gövdedeki `origin` onu ezemez (ui sahteciliği yok)."""
    client = mcp_client(request)
    if client:
        raw = f"mcp:{client}"
    else:
        raw = str(data.get("origin") or "").strip().lower()
        # notu: başlıksız yerel süreç gövdeye "ui" yazarak kullanıcı yetkisi (işe alım vb.) kazanamaz;
        # gövdedeki köken yalnızca arayüz jetonu taşıyan istekte geçerlidir.
        if raw and request is not None:
            from studio.presence import ui_present  # noqa: PLC0415
            if not ui_present(request):
                return None
    return raw if _ORIGIN_RE.match(raw) else None


def request_actor(request: Request | None) -> str:
    """isteği kimin yaptığı — `user` (arayüz jetonu, MCP başlığı yok) | `mcp:<istemci>` | `local` (başlıksız
    yerel süreç). Oyun ödülleri yalnız `user` eylemlerini sayar ( deseni)."""
    if request is None:
        return "local"
    client = mcp_client(request)
    if client:
        return f"mcp:{client}"
    return "user" if ui_present(request) else "local"


def user_started(request: Request | None) -> bool:
    """ (A-08): koşu bütçesi gibi kullanıcı kararları yalnız arayüzden gelir (MCP ve başlıksız süreç değil)."""
    return request is not None and request_actor(request) == "user"


SCENES = ["office", "park", "home", "beach", "cafe", "camp", "battlefield", "sea", "yacht", "space", "snow", "mall", "school",
          "istanbul", "londra", "kapadokya",
          *NEW_CITY_IDS]  # yeni dünya şehirleri (studio/cities; frontend/src/voxel/cities/<id>/catalog.json)
if EDITION == "full":  # kaldırılan şehir ve premium sahneler dahil tam liste (studio/full)
    from studio.full.scene_lists import API_SCENES
    SCENES = [*API_SCENES, *NEW_CITY_IDS]
MCP_VIEWER = "\x00mcp"  # MCP okumalarında özel notları gizleyen sahte görüntüleyici (gerçek ajan adı olamaz)
SSE_BATCH = 64  # tek yazımda gönderilen en çok SSE çerçevesi
LIGHT_PROPS = {"Agent": ["slug", "color", "avatar"], "Concept": ["kind", "mentions", "namespaces"],
               "Fact": ["confidence", "agent", "importance", "pinned", "invalid_at", "namespace",
                        "origin", "epistemic_status", "lifecycle", "trust", "visibility"],
               "Episode": ["agent", "created_at", "importance", "namespace"], "Run": ["status", "kind", "project"],
               "Step": ["status", "agent"],
               "Model": ["connection"], "Tool": ["uses"]}


class Studio:
    def __init__(self, settings: Settings | None = None, connectors: dict[str, Connector] | None = None,
                 db_path: str | None = None):
        self.settings = settings or Settings()
        self.ontology = Ontology.load(ONTOLOGY_FILE)
        # varsayılan veri dizininde (db_path / STUDIO_DATA_DIR yok) günlük parmak izi veri klasörü DIŞINDAki kullanıcı
        # durum dizinine de yazılır; açık veri dizininde (test, geliştirme) `STUDIO_STATE_DIR` ya da geçici dizin kullanılır
        self.store = GraphStore(db_path or DATA_DIR / "studio.db", self.ontology,
                                anchor_dir=None if db_path or os.environ.get("STUDIO_DATA_DIR") else platform_state_dir())
        # kalıcı kritik olay günlüğü (veri dizininde ayrı events.db; bellek içi graf ya da
        # events.persist_critical=false → bellek içi günlük). Ayrıntı: studio/eventlog.py
        persist = bool(self.settings.get("events.persist_critical", True)) and db_path != ":memory:"
        self.events_log = EventLog.open(
            ((Path(db_path).parent if db_path else DATA_DIR) / "events.db") if persist else None,
            retention=int(self.settings.get("events.retention", 20000) or 20000))
        # S15: sınırlı SSE kuyruğu + ajan başına durum olayı hızı (limits bloğu)
        self.bus = EventBus(maxsize=int(self.settings.get("limits.sse_queue", 2000) or 2000),
                            state_rate_hz=float(self.settings.get("limits.state_events_per_sec", 4) or 0),
                            log=self.events_log)
        from studio.graph import cdc as graph_cdc  # noqa: PLC0415 - CDC (C1): commit sonrası graph.changed + saklama ayarı

        graph_cdc.attach(self)
        self.memory = GraphMemory(self.store, self.settings)
        self.agents = AgentRegistry(self.store, self.settings)
        # Claude `~/.claude` devralma kaydı yalnız stüdyonun API'si yazdığında geçerli (son yazım özeti grafta)
        from studio.connectors import claude_isolation  # noqa: PLC0415

        claude_isolation.bind(self.settings, self.store)
        from studio.connectors import codex_isolation  # noqa: PLC0415 - PROC-FIX Codex devralma/web kaydı (graf)

        codex_isolation.bind(self.settings, self.store)
        # çökme/iptal artıkları (koşuya özel eklenti kökleri, istem dosyaları) yalnız stüdyonun klasörlerinde
        try:
            claude_isolation.sweep_leftovers(self.settings)
        except Exception:  # noqa: BLE001 - süpürme açılışı düşürmez
            pass
        self.probe = ConnectionProbe(self.settings)
        # S29: tek bağlantı durumu modeli (probe ve /api/connections aynı servisi kullanır)
        self.connections = self.probe.service
        # Hermes dosyalarına yapılan her yazım buradan geçer (önizle → onay → yedek → atomik yaz → geri al)
        self.changes = ChangeService(Path(db_path).parent if db_path and db_path != ":memory:" else DATA_DIR)
        # kullanıcı akışları veri dizininde (yazılabilir); depodaki workflows/ salt okunur örnekler (S8/S6)
        self.library = WorkflowLibrary(USER_WORKFLOWS_DIR, examples=EXAMPLE_WORKFLOWS_DIR)
        # Hermes API gateway'i: yalnızca kullanıcı tıklamasıyla başlar (burada süreç/ağ çağrısı yok)
        self.gateway = GatewayManager(self.settings, self.changes.data_dir)
        # "hermes" bağlayıcısı bir dağıtıcıdır: ajan başına CLI (subprocess) ya da Hermes API (/v1/runs + SSE)
        self.connectors = connectors or {c.kind: c for c in (
            HermesDispatcher(self.settings, cli=HermesConnector(self.settings),
                             api=HermesApiConnector(self.settings, self.gateway), gateway=self.gateway),
            OllamaConnector(self.settings), CodexConnector(self.settings), ClaudeConnector(self.settings),
            # S29: OpenAI uyumlu sunucu (LM Studio / llama.cpp / vLLM ya da kendi anahtarınla bir API)
            OpenAICompatConnector(self.settings, SecretStore(self.changes.data_dir)))}
        self.engine = Engine(store=self.store, memory=self.memory, agents=self.agents, bus=self.bus,
                             settings=self.settings, connectors=self.connectors)
        self.engine.on_connector_result = self.probe.record
        # R-13: koşu başlatma kapısı, kurulu beyinlere ek olarak yoklamanın "hazır" dediklerini de kullanılabilir sayar
        self.engine.brains_ready = lambda: list((self.connections.summary() or {}).get("brains_ready") or [])
        self.engine.refresh_brains = self.refresh_brains  # engellemeden önce bir kez ucuz yenileme
        self.connections.on_change.append(self._connection_changed)  # Ollama durumu değişince model listesi
        self._bg_tasks: set[asyncio.Task[Any]] = set()
        self.engine.workflow_library = self.library  # G4-REST: devamda akış tanımı değişti mi
        self.started = time.time()

    async def startup(self) -> None:
        from studio.graph import cdc as graph_cdc  # noqa: PLC0415

        graph_cdc.attach(self).bind_loop()  # CDC: graph.changed olay döngüsünde yayınlanır
        self.engine.mark_interrupted()
        await asyncio.to_thread(self.events_log.prune)  # retention (ayar küçültüldüyse)
        from studio.graph.forget import reapply_on_start  # noqa: PLC0415 - yedekten dönen veride mezar kaydı
        await asyncio.to_thread(reapply_on_start, self)
        # model listesi tohumdan ÖNCE — başlangıç ekibi erişilebilir Ollama'yı (modeliyle) görsün
        await self.refresh_models()
        self.agents.sync_profiles()

    def shutdown(self) -> None:
        """olay günlüğünü kapatır (son seq tavanı yazılır). Lifespan kapanışında çağrılmalı."""
        self.bus.close()

    async def refresh_brains(self) -> None:
        """koşu başlatma kapısı beyin bulamadığında engellemeden önce çağrılır. Ollama stüdyodan sonra açıldıysa
        model listesi bayattır ve sunucu tarafında kendiliğinden yenilenmez (yoklamayı yalnız arayüz tetikler). Model listesi
        yenilenir; bağlantı durumu varsa ucuz yeniden tarama yapılır (süreç başlatmaz). Hatalar yutulur."""
        jobs: list[Any] = [self.refresh_models()]
        if self.connections.states:
            jobs.append(self.connections.recheck(wait_s=1.0, min_interval=0.0))
        await asyncio.gather(*jobs, return_exceptions=True)

    def _connection_changed(self, kind: str, _state: dict[str, Any]) -> None:
        """Bağlantı yoklaması Ollama'nın durumunun değiştiğini bildirince model listesini de yenile (olay döngüsünde)."""
        if kind != "ollama":
            return
        try:
            task = asyncio.get_running_loop().create_task(self.refresh_models())
        except RuntimeError:  # döngü dışı iş parçacığı: bir sonraki başlatma kapısı yine yeniler
            return
        self._bg_tasks.add(task)
        task.add_done_callback(self._bg_tasks.discard)

    async def refresh_models(self) -> list[dict[str, Any]]:
        try:
            models = await list_models(self.settings.get("ollama_url"))
        except Exception:  # noqa: BLE001 - Ollama kapalıysa boş liste
            return self.agents.ollama_models
        self.agents.ollama_models = models
        for m in models:
            node = self.store.upsert_node("Model", {
                "name": m["name"], "connection": "ollama", "family": m["family"], "parameter_size": m["parameter_size"],
                "quantization": m["quantization"], "size_bytes": m["size_bytes"], "num_ctx": m["num_ctx"],
                "capabilities": list(m["capabilities"]), "local": m["local"]})
            conn = self.store.upsert_node("Connection", {"kind": "ollama", "name": "Ollama"})
            self.store.link("SERVED_BY", node["id"], conn["id"])
        return models

    def agents_with_state(self, **filters: Any) -> list[dict[str, Any]]:
        """Ajan listesi + canlı durum. `filters` → AgentRegistry.list (q, team, limit, offset, include_hidden)."""
        states = self.engine.snapshot_states()
        out = []
        for a in self.agents.list(**filters):
            a["state"] = states.get(a["slug"], {"state": "idle", "activity": ""})
            out.append(a)
        return out

    def run_summaries(self, limit: int = 50, *, offset: int = 0, status: str | None = None,
                      kind: str | None = None, q: str | None = None, agent: str | None = None) -> list[dict[str, Any]]:
        """Hafif koşu özetleri (adım ayrıntısı yok) — Engine.list_runs ile aynı şekil; süzgeç ve sayfalama
        SQL tarafında (indeksli created_at sırası). Canlı koşuların durumu motordan alınır."""
        props: dict[str, Any] = {}
        if status:
            props["status"] = status
        if kind:
            props["kind"] = kind
        nodes = self.store.nodes("Run", limit=limit, order="created_at DESC", offset=offset, props=props or None,
                                 q=q or None, contains={"steps.agent": agent} if agent else None,
                                 exclude=HIDDEN_RUNS)  # gizli koşular limit/offset ÖNCESİ elenir
        out = []
        for node in nodes:
            p = node["props"]
            if p.get("hidden"):
                continue  # AUDIT P1: gizli sistem koşusu (kalite denetçisi) listede yok; ayrıntı/iz uçlarında var
            live = self.engine.runs.get(p["id"])
            out.append({"id": p["id"], "title": p.get("title"), "kind": p.get("kind"), "workflow": p.get("workflow"),
                        "origin": p.get("origin"), "goal": p.get("goal"), "project": p.get("project") or "global",
                        "status": live.status if live else p.get("status"), "started_at": p.get("started_at"),
                        "finished_at": p.get("finished_at"), "duration_ms": p.get("duration_ms"),
                        "tokens": p.get("tokens"),
                        "error_class": p.get("error_class"),  # (Run düğümünden; yalnız sınıf adı)
                        "steps": [st.to_dict() | {"output": None, "thought": None, "prompt": None}
                                  for st in list(live.steps.values())] if live else p.get("steps") or []})
        return out

    def run_count(self, *, status: str | None = None, kind: str | None = None, q: str | None = None,
                  agent: str | None = None) -> int:
        props = {k: v for k, v in (("status", status), ("kind", kind)) if v}
        return self.store.count("Run", props=props or None, q=q or None,
                                contains={"steps.agent": agent} if agent else None, exclude=HIDDEN_RUNS)


HIDDEN_RUNS = {"hidden": True, "origin": "system:*"}  # gizli sistem koşuları (SQL'de dışlanır)


def _mask_url(url: str) -> str:
    """Adresi kullanıcı bilgisi ve sorgu olmadan gösterir (ör. `https://••••@host/v1/traces?••••`)."""
    from urllib.parse import urlsplit, urlunsplit

    try:
        parts = urlsplit(url)
    except ValueError:
        return "••••"
    netloc = parts.netloc
    if "@" in netloc:
        netloc = "••••@" + netloc.rsplit("@", 1)[1]
    return urlunsplit((parts.scheme, netloc, parts.path, "••••" if parts.query else "", ""))


def weak_writer_report(S: Any, spec: Any) -> list[dict[str, Any]]:
    """doğrulanmış olgulara sadakat isteyen adım küçük (≤ 9B) ya da boyutu bilinmeyen yerel modelde → uyarı
    (`spec.weak_writer_warnings`). Rota ajandan (adımın açık bağlantı/modeli önce); boyut adda yoksa Ollama
    ayrıntısından (`parameter_size`). Uyarı yalnız bilgidir; beyin değişmez, kayıt engellenmez."""
    from studio.workflow.spec import weak_writer_warnings  # noqa: PLC0415

    def route_of(step: Any) -> tuple[bool, str | None]:
        node = S.agents.node(step.agent or "") if step.agent else None
        if node is None:
            raise LookupError(step.agent)
        r = S.agents.route(node, step.connection, step.model)
        conn = r.connection or r.connector
        if conn == "profile" and not r.model:
            # Hermes profilinin kendi modeli (A2 Yazar: profil ayarında yerel qwen3.5-9b-64k). Profil ayarı
            # yalnız okunur (`profile_models`: config.yaml'ın `model` bölümü; anahtar/adres döndürülmez).
            prof = r.profile or (node.get("props") or {}).get("hermes_profile")
            row = next((x for x in _profile_rows() if x.get("profile") == prof), None)
            if row and row.get("model"):
                return bool(row.get("local")) and not bool(row.get("cloud")), str(row["model"])
        return bool(S.engine._local_connection(conn, r.to_dict())), r.model  # noqa: SLF001

    cache: dict[str, Any] = {}

    def _profile_rows() -> list[dict[str, Any]]:
        if "rows" not in cache:
            from pathlib import Path  # noqa: PLC0415
            from studio.connections.providers.hermes import profile_models  # noqa: PLC0415
            home = str(S.settings.get("hermes_home") or "")
            try:
                cache["rows"] = profile_models(Path(home)) if home else []
            except Exception:  # noqa: BLE001 - profil okunamazsa uyarı yok (uydurulmaz)
                cache["rows"] = []
        return cache["rows"]

    def size_of(model: str) -> Any:
        m = next((x for x in getattr(S.agents, "ollama_models", None) or [] if x.get("name") == model), None)
        return (m or {}).get("parameter_size")

    try:
        warns = weak_writer_warnings(spec, route_of, size_of)
    except Exception:  # noqa: BLE001 - uyarı hesaplanamazsa kayıt/doğrulama etkilenmez
        return []
    titles = {s.id: (s.title or s.id) for s in spec.steps}
    for w in warns:
        if w["code"] == "weak_local_writer":
            w["message"] = (f"{titles.get(w['step'], w['step'])} · {w['model']}: Bu adım doğrulanmış olgulara sadık kalmayı "
                            f"gerektiriyor; küçük yerel modeller burada zayıf kalabiliyor. Daha güçlü bir beyin önerilir; "
                            f"beyin kendiliğinden değişmez.")
        else:
            w["message"] = (f"{titles.get(w['step'], w['step'])} · {w['model']}: Bu adım doğrulanmış olgulara sadık kalmayı "
                            f"gerektiriyor; bu yerel modelin boyutu bilinmiyor ve küçük olabilir. Emin değilsen daha güçlü "
                            f"bir beyin seç; beyin kendiliğinden değişmez.")
    return warns


def build_router(studio: Studio) -> APIRouter:
    r = APIRouter(prefix="/api")
    S = studio

    from studio.graph.namespace import reject_reserved as nsm_reserved  # noqa: PLC0415 -

    def guard(fn: Any) -> Any:
        try:
            return fn()
        except KeyError as exc:
            raise HTTPException(404, str(exc).strip("'")) from exc
        except (ValueError, WorkflowError, OntologyError, RouteError) as exc:
            raise HTTPException(400, str(exc)) from exc

    # ---------------------------------------------------------------- genel
    @r.get("/health")
    def health() -> dict[str, Any]:
        return {"ok": True, "version": __version__, "uptime_s": int(time.time() - S.started)}

    @r.get("/overview")
    async def overview() -> dict[str, Any]:
        # S15: depo okumaları olay döngüsünü bloklamasın (okumalar kilitsiz ve iş parçacığı güvenli)
        runs, agents_, stats = await asyncio.to_thread(
            lambda: (S.run_summaries(200), temp_filter.agents(S.agents_with_state()), S.store.stats()))
        today = datetime.now(timezone.utc).date().isoformat()
        from studio.game.spotlight import is_system_run  # noqa: PLC0415 -
        user_runs = [x for x in runs if not is_system_run(x.get("origin"))]  # eval/hakem/sistem koşuları sayılmaz
        return {
            "agents": agents_,
            "stats": stats,
            "runs": {"running": sum(1 for x in user_runs if x["status"] == "running"),
                     "done_today": sum(1 for x in user_runs if x["status"] == "done" and (x.get("started_at") or "").startswith(today)),
                     "failed_today": sum(1 for x in user_runs if x["status"] == "failed" and (x.get("started_at") or "").startswith(today)),
                     "recent": user_runs[:8]},
            "connections": await S.probe.get(),
            "scene": S.settings.get("scene"),
        }

    # ---------------------------------------------------------------- ajanlar
    @r.get("/agents")
    def agents(limit: int | None = Query(None, ge=1, le=5000), offset: int = Query(0, ge=0),
               q: str | None = None, team: str | None = None, include_hidden: bool = True) -> Any:
        """Ajan listesi. Parametresiz: tümü (eski davranış). İsteğe bağlı sayfalama/süzgeç: limit, offset, q, team,
        include_hidden. Toplam sayı `X-Total-Count` başlığında. (JSONResponse: 300 ajanda jsonable_encoder maliyeti yok.)"""
        raw = S.agents_with_state(limit=limit, offset=offset, q=q, team=team, include_hidden=include_hidden)
        items = temp_filter.agents(raw)  # değerlendirme/matris/kapı geçici ajanları listede yok
        if limit is None and not offset:
            total = len(items)
        else:
            temp = sum(1 for a in S.agents.list(include_hidden, q=q, team=team)
                       if temp_filter.is_temp_agent(a)) if include_hidden else 0  # yalnız iç işaret
            total = max(0, S.agents.count(include_hidden, q=q, team=team) - temp)
        return JSONResponse(items, headers={"X-Total-Count": str(total)})

    def mcp_permissions_gate(request: Request, data: dict[str, Any], current: Any) -> None:
        """A-08: MCP istemcisi ajan iznini (permissions) belirleyemez/yükseltemez; yalnızca arayüz değiştirir.
        Kullanıcı varlığı: arayüz jetonu olmayan başlıksız yerel süreç de (ör. koşudaki curl) MCP gibi sınırlanır."""
        if not ui_present(request) and "permissions" in data and (data.get("permissions") or "read") != current:
            raise HTTPException(403, "Ajan izinleri MCP üzerinden değiştirilemez; izni uygulama arayüzünden ayarla")
        # COS-A: giyilen kozmetik (avatar.wear) kullanıcının seçimidir; MCP/başlıksız süreç değiştiremez (sessizce yok sayılır)
        if not ui_present(request) and isinstance(data.get("avatar"), dict) and "wear" in data["avatar"]:
            data["avatar"] = {k: v for k, v in data["avatar"].items() if k != "wear"}

    def mcp_skills_gate(request: Request, data: dict[str, Any], current: Any) -> None:
        """skill ataması bağlamayı değiştirir (atanan skill onaylı en son sürüme bağlanır ve yüklenebilir olur);
        MCP / başlıksız süreç ajanın skill listesini değiştiremez (aynı listeyi göndermek serbest)."""
        if ui_present(request) or "skills" not in data:
            return
        from studio.hermes.caps import clean_name_list  # noqa: PLC0415

        if clean_name_list(data.get("skills")) != clean_name_list(current):
            raise HTTPException(403, "Ajanın skill atamaları MCP üzerinden değiştirilemez; uygulama arayüzünden ata")

    @r.post("/agents")
    async def create_agent(request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        mcp_permissions_gate(request, data, "read")
        mcp_skills_gate(request, data, [])
        return guard(lambda: S.agents.create(data))

    @r.patch("/agents/{slug}")
    async def update_agent(slug: str, request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        node = S.agents.node(slug)
        mcp_permissions_gate(request, data, ((node or {}).get("props") or {}).get("permissions") or "read")
        mcp_skills_gate(request, data, ((node or {}).get("props") or {}).get("skills") or [])
        if not ui_present(request) and "avatar" in data:  # MCP/başlıksız avatar değişimi giyimi korur
            if not isinstance(data["avatar"], dict):
                raise HTTPException(403, "Avatar MCP üzerinden silinemez; uygulama arayüzünden değiştir")
            cur = ((node or {}).get("props") or {}).get("avatar")
            if isinstance(cur, dict) and cur.get("wear"):
                data["avatar"] = {**data["avatar"], "wear": cur["wear"]}
        agent = guard(lambda: S.agents.update(slug, data))
        S.bus.publish("agent.updated", agent=agent)
        return agent

    @r.delete("/agents/{slug}")
    async def delete_agent(slug: str) -> dict[str, Any]:
        guard(lambda: S.agents.delete(slug))
        S.bus.publish("agent.removed", agent=slug)
        return {"ok": True}

    @r.post("/agents/sync")
    async def sync_agents() -> dict[str, Any]:
        return S.agents.sync_profiles()

    @r.get("/agents/{slug}/memory")
    def agent_memory(slug: str, project: str | None = None) -> dict[str, Any]:
        """Ajanın son anıları + bilgileri. `project` (anahtar | project:<k> | global; varsayılan global)
        ad alanıyla süzülür (`memory.isolation: false` iken süzgeçsiz, eski davranış)."""
        node = S.agents.node(slug)
        if not node:
            raise HTTPException(404, "Ajan yok")
        return guard(lambda: S.memory.agent_memory(node["id"], project))

    # ---------------------------------------------------------------- bağlantılar (S29: tek ConnectionService)
    # /api/connections* rotaları studio.connections.api içindedir ve main.py'de kaydedilir.

    @r.get("/ollama/models")
    async def ollama_models() -> list[dict[str, Any]]:
        before = [m.get("name") for m in S.agents.ollama_models]
        models = await S.refresh_models()
        # yalnızca model listesi DEĞİŞTİYSE bağlantı durumu tazelenir: her okumada geçersiz kılmak, arayüzün 2 sn'lik
        # yoklamasıyla birleşip yavaş kontrolleri sürekli iptal ediyor, kartlar "kontrol ediliyor"da kalıyordu (QA-F56)
        if [m.get("name") for m in models] != before:
            S.connections.invalidate("ollama")
        return models

    # ---------------------------------------------------------------- görevler & çalıştırmalar
    @r.post("/tasks")
    async def create_task(request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        prompt = str(data.get("prompt") or "").strip()
        if not prompt:
            raise HTTPException(400, "Görev metni boş")
        budget = data.get("budget")
        if budget is not None and not user_started(request):  # CG-COST/A-08, bütçe kullanıcının kararı
            raise HTTPException(403, "Bu işlem yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir")
        deadline_min = data.get("deadline_min")
        if deadline_min is not None and not user_started(request):  # süre sınırı da kullanıcının kararı
            raise HTTPException(403, "Bu işlem yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir")
        # isteğe bağlı "beklenen çıktı" kullanıcının kabul ölçütüdür (MCP kendi işinin ölçütünü yazamaz)
        expected = str(data.get("expected_output") or "").strip()[:1000]
        if expected and not user_started(request):
            raise HTTPException(403, "Bu işlem yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir")

        from studio.workzones import api as zone_api  # noqa: PLC0415 - WORK-ZONES: çalışma bölgesi (kullanıcı-yalnız, sahnede geçerli)
        work_zone = zone_api.task_zone(S, data, request)

        async def start() -> dict[str, Any]:
            try:
                nsm_reserved(data.get("project"))  # matrisin ayrılmış öneki (400)
                run_id = await S.engine.start_task(
                    agent=str(data.get("agent") or ""), prompt=prompt, title=data.get("title"),
                    connection=data.get("connection") or None, model=data.get("model") or None,
                    memory=bool(data.get("memory", True)), remember=bool(data.get("remember", True)),
                    origin=run_origin(data, request), project=data.get("project"),  # bellek ad alanı
                    budget=budget,  # CG-COST: başlangıç tavanı (yarış yok: ilk jetondan önce sınırlı)
                    deadline_min=deadline_min)  # koşu başına mutlak süre
            except KeyError as exc:
                raise HTTPException(404, str(exc).strip("'")) from exc
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
            if expected:  # koşu düğümüne (bekleme yok: koşu görevi henüz bir tur bile dönmedi); kabul kaydı okur
                live = S.engine.runs.get(run_id)
                if live is not None and live.node_id:
                    S.store.patch_node(live.node_id, {"expected_output": expected})
            zone_api.attach(S, run_id, work_zone)  # WORK-ZONES: Run.work_zone (GraphStore) + workzone.changed
            return {"run_id": run_id}

        # G1-B: `Idempotency-Key` / `client_request_id` → aynı istek tek koşu; farklı yük 409
        return await idem.guarded(S.settings, request, "tasks", data, start)

    @r.get("/runs")
    def runs(request: Request, limit: int = Query(50, le=500), offset: int = Query(0, ge=0), status: str | None = None,
             kind: str | None = None, q: str | None = None, agent: str | None = None) -> Any:
        """Hafif koşu özetleri (Engine.list_runs ile aynı şekil). İsteğe bağlı: offset, status, kind, q (başlık),
        agent (adımlarında bu ajan olan koşular). Toplam `X-Total-Count` başlığında. (lead kararı 3): MCP
        değerlendirme/matris/kapı deneme koşularını (`eval:` kökenli, süren dahil) görmez (`temp_filter`)."""
        items = S.run_summaries(limit, offset=offset, status=status, kind=kind, q=q, agent=agent)
        total = S.run_count(status=status, kind=kind, q=q, agent=agent)
        if mcp_client(request):
            kept = temp_filter.runs(items)
            total -= len(items) - len(kept)
            items = kept
        return JSONResponse(items, headers={"X-Total-Count": str(max(0, total))})

    @r.get("/runs/{run_id}")
    def run_detail(run_id: str) -> dict[str, Any]:
        data = S.engine.get_run(run_id)
        if not data:
            raise HTTPException(404, "Çalıştırma yok")
        from studio.workzones import api as zone_api  # noqa: PLC0415 - WORK-ZONES: görevin çalışma bölgesi
        return zone_api.decorate(S, run_id, data)

    @r.post("/runs/{run_id}/cancel")
    async def cancel_run(run_id: str) -> dict[str, Any]:
        guard(lambda: S.engine.cancel(run_id))
        return {"ok": True}

    @r.post("/runs/{run_id}/steps/{step_id}/decision")
    async def decide(run_id: str, step_id: str, request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        from studio.workflow.engine import RunSuspended  # duraklatılmış koşu → 409 "önce sürdür"
        _run = S.engine.runs.get(run_id)
        _card = _run.steps.get(step_id) if _run is not None else None
        if (data.get("approved") and _card is not None and isinstance(_card.ask, dict)
                and _card.ask.get("scope") == "daily" and mcp_client(request)):
            # karar 13: günlük tavanı yükseltmek kullanıcının kararı (MCP yalnız durdurabilir)
            raise HTTPException(403, "Günlük bütçe tavanı yalnızca uygulama arayüzünden, kullanıcı tarafından "
                                     "değiştirilebilir")
        if (_card is not None and isinstance(_card.ask, dict) and _card.ask.get("kind") == "manifest_diff"
                and mcp_client(request)):
            # G4-REST: koşu başladıktan sonra değişen beyin/model, akış ya da skill ile devam kararı kullanıcınındır
            raise HTTPException(403, "Sürüm değişikliği onayı yalnızca uygulama arayüzünden, kullanıcı tarafından "
                                     "verilebilir")
        if (_card is not None and isinstance(_card.ask, dict) and _card.ask.get("kind") == "step_approval"
                and mcp_client(request)):
            # adım başı onay kullanıcının kararıdır (onay da ret de); MCP istemcisi bu kartı karara bağlayamaz
            raise HTTPException(403, "Adım onayı yalnızca uygulama arayüzünden, kullanıcı tarafından verilebilir")
        if (_card is not None and _run is not None and isinstance(_card.ask, dict) and _card.ask.get("kind") == "on_fail"
                and mcp_client(request) and data.get("approved")):
            # onaylı adımda "başka beyinle dene" (`route:`) seçimi kullanıcıya ait; MCP istemi başka bir
            # bağlantıya/modele yönlendiremez (onay rota özetine bağlı olduğu için yeni rota zaten yeniden sorulur)
            from studio.workflow import step_gate  # noqa: PLC0415
            from studio.workflow.policy import parse_ask_choice  # noqa: PLC0415
            parent = _run.steps.get(_card.parent or "")
            gated = parent is not None and (parent.spec.approval in ("before", "after")
                                            or step_gate.wants(S.engine, _run, parent, "before"))
            if gated and parse_ask_choice(str(data.get("note") or ""))[0] == "route":
                raise HTTPException(403, "Onaylı adımda başka beyin seçimi yalnızca uygulama arayüzünden, kullanıcı "
                                         "tarafından yapılabilir")
        try:
            S.engine.decide(run_id, step_id, bool(data.get("approved")), str(data.get("note") or ""))
        except RunSuspended as exc:
            raise HTTPException(409, str(exc)) from exc
        except KeyError as exc:
            raise HTTPException(404, str(exc).strip("'")) from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return {"ok": True}

    @r.post("/runs/{run_id}/approvals/{approval_id}")
    async def tool_approval(run_id: str, approval_id: str, request: Request,
                            data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Hermes araç onayı kararı: choice ∈ once|session|always|deny (yalnızca kullanıcı tıklaması).
        A-08: MCP istemcisi yalnızca once|deny seçebilir (kalıcı izin arayüzden)."""
        if mcp_client(request) and str(data.get("choice") or "") not in MCP_TOOL_CHOICES:
            raise HTTPException(403, "MCP üzerinden yalnızca tek seferlik izin (once) ya da ret (deny) verilebilir")
        return guard(lambda: S.engine.resolve_tool_approval(run_id, approval_id, str(data.get("choice") or ""),
                                                            str(data.get("note") or "")))

    # ---------------------------------------------------------------- Faz 6 (S23): dayanıklı koşu ve bütçe
    @r.post("/runs/{run_id}/pause")
    async def pause_run(run_id: str) -> dict[str, Any]:
        """Çalışan koşuyu duraklatır (adımlar pending'e döner, onaylar korunur). Olay: run.paused."""
        return guard(lambda: S.engine.pause(run_id))

    @r.post("/runs/{run_id}/resume")
    async def resume_run(run_id: str, data: dict[str, Any] | None = Body(None)) -> dict[str, Any]:
        """Duraklatılmış/kesilmiş koşuyu sürdürür; isteğe bağlı {from_step}. Olay: run.resumed."""
        from_step = str((data or {}).get("from_step") or "") or None
        return guard(lambda: S.engine.resume(run_id, from_step=from_step))

    @r.post("/runs/{run_id}/steps/{step_id}/retry")
    async def retry_step(run_id: str, step_id: str, request: Request,
                         data: dict[str, Any] | None = Body(None)) -> dict[str, Any]:
        """Adımı ve bağımlılarını yeniden açar; koşu çalışmıyorsa sürdürür. Olaylar: run.resumed, step.retried.
        `{fresh: true}` = "baştan çalıştır": önceki yan etkili yürütmeler tekrar kullanılmaz (yalnız arayüzden;
        ajan / MCP yinelenen yan etkiyi açamaz)."""
        fresh = (data or {}).get("fresh") is True
        if fresh:
            from studio.presence import DENIED, DENIED_CODE, ui_present  # noqa: PLC0415
            if not ui_present(request):
                raise HTTPException(403, {"code": DENIED_CODE, "message": DENIED})
        return guard(lambda: S.engine.retry_step(run_id, step_id, fresh=fresh))

    @r.post("/runs/{run_id}/fork")
    async def fork_run(run_id: str, request: Request, data: dict[str, Any] | None = Body(None)) -> dict[str, Any]:
        """Düzenle-devam et: {from_step?, edits?: {step_id: output | {prompt?, output?}}} → yeni koşu (forked_from).
        Ebeveyn değişmez."""
        body = data or {}
        edits = body.get("edits") or {}
        if not isinstance(edits, dict):
            raise HTTPException(400, "edits bir sözlük olmalı")
        from_step = str(body.get("from_step") or "") or None
        # çatal ebeveynin ad alanını devralır (gövdedeki `project` yok sayılır); ebeveyn değerlendirme
        # matrisinin ayrılmış ad alanındaysa olağan uçtan çatal açılamaz (400)
        parent = S.engine.runs.get(run_id)
        parent_ns = getattr(parent, "project", None) if parent is not None else \
            ((S.store.find("Run", run_id) or {}).get("props") or {}).get("project")
        if body.get("project") is not None:
            guard(lambda: nsm_reserved(body.get("project")))
        if isinstance(parent_ns, str) and parent_ns:
            guard(lambda: nsm_reserved(parent_ns))
        child = guard(lambda: S.engine.fork(run_id, from_step=from_step, edits=edits,
                                            origin=run_origin(body, request)
                                            if body.get("origin") or mcp_client(request) else None))
        return {"ok": True, "run_id": child, "forked_from": run_id}

    @r.patch("/runs/{run_id}/budget")
    async def run_budget(run_id: str, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Koşu bütçesini günceller/yükseltir: {tokens?, cost_usd?, minutes?, steps?, on_exceeded?}. Olay: budget.updated."""
        return guard(lambda: S.engine.set_budget(run_id, data))

    # ---------------------------------------------------------------- iş akışları
    @r.get("/workflows")
    def workflows() -> list[dict[str, Any]]:
        return S.library.list()

    @r.get("/workflows/{slug}")
    def workflow(slug: str) -> dict[str, Any]:
        return guard(lambda: S.library.get(slug).to_dict())

    @r.post("/workflows/validate")
    def validate_workflow(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            spec = parse(data)
        except WorkflowError as exc:
            return {"ok": False, "errors": translate_detail(str(exc).split("; "))}
        from studio.office.service import Office  # rol adımları: rolü taşıyan ajanı olan roller (QA-M1)
        from studio.workflow.starter_alias import resolvable  # PROC-FIX P2: örneklerin başlangıç slug'ları
        errors = validate(spec, {a["slug"] for a in S.agents.list()} | resolvable(S.agents),
                          roles=Office(S).roles_with_holders())
        # 200 yanıtı ara katmanda çevrilmez; doğrulama iletileri burada istek diline çevrilir
        # zayıf yazar uyarısı sunucuda da (API/MCP ile kaydedilen akışlar ve düzenleyici aynı kuralı görür)
        return {"ok": not errors, "errors": translate_detail(errors),
                "warnings": translate_detail(weak_writer_report(S, spec))}

    @r.put("/workflows/{slug}")
    async def save_workflow(slug: str, request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        data["slug"] = slug
        from studio.entitlements import gate as plan_gate  # E7: yalnız YENİ özel akış sayılır; düzenleme serbest
        if (ent := plan_gate(S)) is not None and not S.library.exists(slug):
            ent.require("workflows")
        spec = guard(lambda: S.library.save(data))
        # son kaydedenin kimliği (user | mcp:<istemci> | local); oyun "ilk başarı" ve "ilk turda onay"
        # ödüllerini yalnız kullanıcının arayüzden kaydettiği akışa verir
        S.store.upsert_node("Workflow", {"slug": spec.slug, "name": spec.name, "description": spec.description,
                                         "author": request_actor(request)})
        return {**spec.to_dict(), "warnings": translate_detail(weak_writer_report(S, spec))}

    @r.delete("/workflows/{slug}")
    async def delete_workflow(slug: str) -> dict[str, Any]:
        guard(lambda: S.library.delete(slug))
        return {"ok": True}

    @r.post("/workflows/{slug}/run")
    async def run_workflow(slug: str, request: Request, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        spec = guard(lambda: S.library.get(slug))
        budget = data.get("budget")
        if budget is not None and not user_started(request):  # CG-COST/A-08, bütçe kullanıcının kararı
            raise HTTPException(403, "Bu işlem yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir")
        deadline_min = data.get("deadline_min")
        if deadline_min is not None and not user_started(request):  # süre sınırı da kullanıcının kararı
            raise HTTPException(403, "Bu işlem yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir")
        # PROC-FIX P2: akış başlatmada da "beklenen çıktı" ( kabul ölçütü; yalnız kullanıcı)
        expected = str(data.get("expected_output") or "").strip()[:1000]
        if expected and not user_started(request):
            raise HTTPException(403, "Bu işlem yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir")

        async def start() -> dict[str, Any]:
            try:
                nsm_reserved(data.get("project"))  # matrisin ayrılmış öneki (400)
                run_id = await S.engine.start_workflow(spec, dict(data.get("inputs") or {}),
                                                       origin=run_origin(data, request),
                                                       project=data.get("project"),  # bellek ad alanı
                                                       budget=budget,  # başlangıç tavanı (sonradan PATCH yarışı yok)
                                                       deadline_min=deadline_min)
            except KeyError as exc:
                raise HTTPException(404, str(exc).strip("'")) from exc
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
            if expected:  # PROC-FIX P2: kabul kaydı koşu düğümünden okur
                live = S.engine.runs.get(run_id)
                if live is not None and live.node_id:
                    S.store.patch_node(live.node_id, {"expected_output": expected})
            # zayıf yazar uyarıları koşu başlatmada da döner (diyalog, API ve MCP ile başlatılan koşular)
            return {"run_id": run_id, "warnings": translate_detail(weak_writer_report(S, spec))}

        return await idem.guarded(S.settings, request, f"workflow:{slug}", data, start)  # G1-B

    # ---------------------------------------------------------------- graf & bellek
    @r.get("/ontology")
    def ontology() -> dict[str, Any]:
        return S.ontology.to_dict()

    def _private(n: dict[str, Any]) -> bool:
        return n.get("type") in ("Fact", "Episode") and (n.get("props") or {}).get("visibility") == "private"

    @r.get("/graph")
    def graph(request: Request, types: str = "", limit: int = Query(400, le=3000), offset: int = Query(0, ge=0),
              q: str | None = None, project: str | None = None) -> Any:
        """Hafif graf görünümü. İsteğe bağlı: offset (son güncellenenden geriye sayfa), q (etiket metni),
        project (Episode/Fact/Concept yalnızca bu bellek ad alanından; verilmezse tüm graf — yönetici
        gezgini, hiçbir ajan istemine girmez)."""
        type_list = [t for t in types.split(",") if t] or None
        if project:
            nodes, edges = guard(lambda: S.memory.dump(type_list, limit, project, offset=offset, q=q))
        else:
            nodes, edges = S.store.dump(type_list, limit, offset=offset, q=q)
        # değerlendirme, matris ve booster kapısı geçicileri (ajan, deneme koşusu, adım, görev, tohum bilgi)
        # bellek grafına çıkmaz (MCP ve arayüz)
        nodes, edges = temp_filter.graph(nodes, edges)
        if mcp_client(request):  # MCP başka ajanların kabul edilmemiş özel notlarını görmez (R-1)
            hidden = {n["id"] for n in nodes if _private(n)}
            nodes = [n for n in nodes if n["id"] not in hidden]
            edges = [e for e in edges if e.get("src") not in hidden and e.get("dst") not in hidden]
        if mcp_client(request):  # türe bağlı MCP süzgeci (teslim kaydı: yerel yol / dal / file: bağlantısı)
            nodes = [graph_redact.for_mcp(n) for n in nodes]
        light = [{"id": n["id"], "type": n["type"], "label": n["label"], "created_at": n["created_at"],
                  "props": {k: n["props"].get(k) for k in LIGHT_PROPS.get(n["type"], []) if k in n["props"]}}
                 for n in nodes]
        return JSONResponse({"nodes": light, "edges": edges, "stats": S.store.stats()})

    @r.get("/graph/node/{node_id}")
    def graph_node(node_id: str, request: Request) -> dict[str, Any]:
        node = guard(lambda: S.store.get_node(node_id))
        if mcp_client(request) and _private(node):
            raise HTTPException(404, f"Düğüm yok: {node_id}")
        if mcp_client(request):
            node = graph_redact.for_mcp(node)
        return {"node": node, "neighbors": [
            {"edge": e, "dir": d, "node": {"id": n["id"], "type": n["type"], "label": n["label"]}}
            for e, n, d in S.store.neighbors(node_id)][:200]}

    @r.get("/memory/recall")
    def recall(request: Request, q: str, agent: str | None = None, project: str | None = None,
               purpose: str = "task") -> dict[str, Any]:
        """`project` (anahtar | project:<k> | global; varsayılan global) — yalnızca o ad alanının anıları.
        MCP için özel (kabul edilmemiş) notlar hiçbir ajan adına görünmez."""
        if mcp_client(request):
            agent = MCP_VIEWER
        node = S.agents.node(agent) if agent and agent != MCP_VIEWER else None
        scope = node["props"].get("memory_scope", "shared") if node else "shared"
        # GIFTS-GENDER: hediye/teşekkür anıları yalnız konuşma amaçlı çağrıda (purpose=conversation) hatırlanır
        # (MCP hariç); görev yürütmede ve önizlemede asla — eşit etki.
        chat = purpose == "conversation" and not mcp_client(request)
        pack = guard(lambda: S.memory.recall(q, agent=agent, scope=scope, namespace=project or "global",
                                             include_gifts=chat))
        return {"text": pack.text, "items": pack.items, "namespace": pack.namespace}

    @r.get("/memory/namespaces")
    def memory_namespaces() -> dict[str, Any]:
        """bilinen bellek ad alanları (anı sayılarıyla) + Project düğümleri; seçiciler için."""
        return {"isolation": S.memory.isolated, "namespaces": S.memory.namespaces()}

    @r.post("/memory/facts/{fact_id}")
    async def fact_state(fact_id: str, request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Sabitle/geçersiz kıl. `project` verilirse bilgi o ad alanında değilse 400 (ad alanları arası işlem yok)."""
        ns = data.get("project") if data.get("project") not in (None, "") else None

        def _fact_sig(n: Any) -> tuple[bool, bool]:  # gerçek değişiklik mi (sabit / geçersiz durumu)
            p = (n or {}).get("props") or {}
            return bool(p.get("pinned")), bool(p.get("invalid_at"))

        try:
            before = _fact_sig(S.store.get_node(fact_id))
        except Exception:  # noqa: BLE001 - yoksa aşağıdaki guard 404 verir
            before = None
        try:  # güvenilmeyen bilgi kullanıcı dışında sabitlenemez (AW-R24) → 403
            node = guard(lambda: S.memory.set_fact_state(
                fact_id, pinned=data.get("pinned"), invalid=data.get("invalid"), reason=data.get("reason"),
                namespace=ns, by="agent" if mcp_client(request) else "user"))
        except PermissionError as exc:
            raise HTTPException(403, str(exc)) from exc
        # oyun yalnızca kullanıcının (arayüz) yaptığı gerçek değişikliği bellek bakımı sayar
        S.bus.publish("memory.fact", fact=node, changed=before is not None and before != _fact_sig(node),
                      by="user" if ui_present(request) and not mcp_client(request) else "agent")
        return node

    from studio.graph import assertion_api  # noqa: PLC0415 - bellek iddiası uçları (doğrula/itiraz/düzelt/terfi)
    assertion_api.register(r, S)
    from studio.graph import forget_api  # noqa: PLC0415 - unutma planı (önizle → onay → yedek → uygula → geri al)
    forget_api.register(r, S)
    from studio.graph import cdc as graph_cdc  # noqa: PLC0415 - CDC (C1): GET /api/graph/changes kalıcı imleç
    graph_cdc.register(r, S)

    @r.get("/files")
    def file_preview(path: str) -> dict[str, Any]:
        try:
            return workspace.read_preview(S.settings.workdir, path)
        except PermissionError as exc:
            raise HTTPException(403, str(exc)) from exc
        except (FileNotFoundError, OSError) as exc:
            raise HTTPException(404, f"Dosya yok: {path}") from exc

    # ---------------------------------------------------------------- ayarlar
    def public_settings(data: dict[str, Any]) -> dict[str, Any]:
        """Ayarları istemciye maskeli verir: alım jetonu yalnızca ••••son4 görünür (S8 isteği)."""
        out = copy.deepcopy(data)
        cc = (out.get("external") or {}).get("claude_code") or {}
        if cc.get("token"):
            cc["token"] = mask_value(str(cc["token"]))
        obs = out.get("observability") or {}
        if obs.get("otlp_url"):  # adresteki kullanıcı:parola ve sorgu (anahtar taşıyabilir) gösterilmez (AUDIT B-14)
            obs["otlp_url"] = _mask_url(str(obs["otlp_url"]))
        return {**out, "scenes": SCENES}

    @r.get("/settings")
    def get_settings() -> dict[str, Any]:
        return public_settings(S.settings.data)

    @r.put("/settings")
    async def put_settings(request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        # S40: yönetici/test modu yalnızca /api/admin/mode ile değişir (MCP'nin genel ayar yoluyla açamaması için)
        # S37: model erişim politikası da yalnızca /api/connections/models/* (USER_ONLY) ile değişir
        data = {k: v for k, v in data.items() if k not in ("admin", "models")}
        # TRUST: güvenli mod durumu ve yerel 18+ beyanı yalnız /api/safe-mode/* (kullanıcıya ait) ile değişir
        data.pop("safe_mode", None)
        data.pop("trust", None)
        # bulut hesabı ayarları (taban adres doğrulaması, açık/kapalı) yalnız hesap ayarları ucuyla değişir
        data.pop("cloud", None)
        # A-08: MCP kendi kapısını (clients), çalışma klasörünü ve güvenlik ayarlarını genel yoldan değiştiremez
        # Kullanıcı varlığı: arayüz jetonu olmayan başlıksız yerel süreç de (curl) MCP gibi sınırlanır — yoksa
        # clients.mcp.allow_decisions açılıp onay kapısı dolanılabilirdi
        blocked = mcp_blocked_settings(data) if not ui_present(request) else []  # izin listesi
        if blocked:
            detail = f"Bu ayarlar MCP üzerinden değiştirilemez: {', '.join(blocked)}"
            if not request.headers.get("x-studio-client"):
                # jetonu düşmüş arayüz sekmesi oturumu yenileyip yeniden denesin (lib/presence.ts)
                from studio.presence import DENIED_CODE
                return JSONResponse({"detail": detail, "code": DENIED_CODE}, status_code=403)  # type: ignore[return-value]
            raise HTTPException(403, detail)
        if isinstance(data.get("tools"), dict) and "mcp_servers" in data["tools"]:
            # karar 1: sunucu ortam aktarımı (env_refs) adları sayan açık onayla yalnız /api/tools/servers'tan değişir
            raise HTTPException(400, "MCP sunucuları yalnızca /api/tools/servers üzerinden değiştirilebilir")
        if isinstance(data.get("tools"), dict) and "tool_classes" in data["tools"]:
            # aracın yan etki sınıfı (defterin yeniden oynatma kuralı) yalnız kullanıcı ucundan değişir
            raise HTTPException(400, "Araç sınıfları yalnızca /api/tools/classes üzerinden değiştirilebilir")
        if isinstance(data.get("limits"), dict) and "daily_budget" in data["limits"]:
            # karar 13: günlük bütçe tavanı doğrulamalı kendi ucundan (/api/budget/daily) değişir
            raise HTTPException(400, "Günlük bütçe tavanı yalnızca /api/budget/daily üzerinden değiştirilebilir")
        if isinstance(data.get("limits"), dict) and "step_tokens" in data["limits"]:
            # adım jeton tavanı "auto" ya da pozitif tam sayı (bozuk değer tavanı sessizce kapatmasın)
            v = data["limits"]["step_tokens"]
            if isinstance(v, str) and v.strip().lower() == "auto":
                data["limits"]["step_tokens"] = "auto"
                data["limits"]["step_tokens_explicit"] = False
            elif isinstance(v, bool) or not isinstance(v, int) or not 1_000 <= v <= 100_000_000:
                raise HTTPException(400, "Adım token tavanı 'auto' ya da 1 000–100 000 000 arası bir tam sayı olmalı")
            else:  # açık sayı işaretlenir (işaretsiz eski 2 000 000 yine "auto" okunur)
                data["limits"]["step_tokens_explicit"] = True
        if isinstance(data.get("limits"), dict) and "step_tokens" not in data["limits"]:
            data["limits"].pop("step_tokens_explicit", None)  # işaret yalnız tavanla birlikte yazılır
        # sayısal alanlar sınırlı; -5 / "abc" / 99999999999 "kaydedildi" olmasın
        from studio.settings_limits import validate_numeric_settings  # noqa: PLC0415
        if (num_errors := validate_numeric_settings(data)):
            raise HTTPException(400, "; ".join(num_errors))
        if isinstance(data.get("ui"), dict) and "mode" in data["ui"]:
            # DASH-MVP: görünüm yalnız world | board (eski `plain` → board); bilinmeyen değer kaydedilmez
            from studio.config import ui_mode_value
            try:
                data["ui"]["mode"] = ui_mode_value(data["ui"]["mode"])
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
        if EDITION != "full":
            data.pop("boost", None)  # booster ayarı yalnız full sürümde vardır
        if EDITION == "full" and "boost" in data:
            # `boost` bölümü yazılmadan önce katı doğrulanır ("false" metni bool("false") = açık olurdu)
            from studio.full.boost import BoostService  # noqa: PLC0415
            try:
                BoostService.validate_settings_boost(data["boost"])
            except (TypeError, ValueError) as exc:
                raise HTTPException(400, str(exc)) from exc
        if EDITION == "full" and "boost" in data and not ui_present(request):
            # MCP/jetonsuz süreç genel ayar yoluyla da booster AÇAMAZ (enabled/profile/on/off); kapatma serbest
            from studio.full.boost import deny_enable, boost_service  # noqa: PLC0415
            deny_enable(request, await asyncio.to_thread(boost_service(S).would_enable_settings, data["boost"]))
        if EDITION == "full" and "boost" in data:
            # karar 2026-10-28: ücretli booster'ı genel listeye eklemek hak ister (402); profil değişimi serbest,
            # yalnız ücretsiz alt küme çalışır (describe().tier.profile_held_back)
            from studio.full import boost as boost_api  # noqa: PLC0415
            _bs = boost_api.boost_service(S)
            _bs.invalidate_tier()
            boost_api.deny_locked(_bs, boost_api.settings_enabling(_bs, data["boost"]))
        if isinstance(data.get("memory"), dict) and "graph_expand" in data["memory"]:
            from studio.graph.memory import graph_expand_value  # tam sayı 0..2 (Infinity, metin, None → 400)
            if graph_expand_value(data["memory"]["graph_expand"]) is None:
                raise HTTPException(400, "memory.graph_expand 0, 1 ya da 2 olmalı")
            data["memory"]["graph_expand"] = graph_expand_value(data["memory"]["graph_expand"])
        if isinstance(data.get("connections"), dict) and "openai_compat" in data["connections"]:
            # uç noktalar adres doğrulaması ve anahtar kuralıyla yalnız kendi uçlarından değişir (AUDIT B-10)
            raise HTTPException(400, "OpenAI uyumlu uç noktalar yalnızca /api/connections/openai_compat üzerinden "
                                     "değiştirilebilir")
        # Faz 7a (S30): kullanıcı dünyaları (w_…) da sahne olabilir; mağaza/kilit mantığına girmez (hep açık)
        from studio.worlds.api import scene_allowed
        user_world = "scene" in data and data["scene"] not in SCENES and scene_allowed(S, data["scene"])
        if "scene" in data and data["scene"] not in SCENES and not user_world:
            raise HTTPException(400, "Bilinmeyen sahne")
        if "scene" in data and not user_world and data["scene"] != S.settings.get("scene") and S.settings.get("game.enabled", True):
            # QA-F3 m2: kilitli sahne yalnızca arayüzde değil sunucuda da reddedilir (oyun kapalıyken hepsi açık)
            from studio.game.api import get_service
            if not get_service(S).is_owned(f"scene:{data['scene']}"):
                raise HTTPException(403, "Bu sahne kilitli — Başarılar → Mağaza'dan açabilirsin")
        if user_world and data["scene"] != S.settings.get("scene"):
            # kilitli yerleşik sahnenin kopyası (`meta.basedOn`) kilidi aşamaz (oyun kapalı/yönetici modda açık)
            from studio.worlds.api import scene_locked
            if scene_locked(S, data["scene"]):
                raise HTTPException(403, "Bu dünya kilitli bir sahnenin kopyası; önce sahneyi Başarılar → Mağaza'dan aç")
        # maskeli jeton geri gönderildiyse mevcut jetonu koru (istemci maskeyi asıl değer sanmasın)
        cc = (data.get("external") or {}).get("claude_code") if isinstance(data.get("external"), dict) else None
        if isinstance(cc, dict) and isinstance(cc.get("token"), str) and cc["token"].startswith("••••"):
            cc.pop("token")
        try:
            result = S.settings.update(data)
        except SettingsCorrupt as exc:
            raise HTTPException(409, str(exc))
        if isinstance(data.get("schedule"), dict) and data["schedule"].get("enabled") is False:
            from studio.schedule.api import get_runtime as schedule_runtime  # kapanınca sıradaki tetikler atılır
            schedule_runtime(S).runner.drop_queued()
        if "scene" in data:
            S.bus.publish("scene.changed", scene=data["scene"])
        return public_settings(result)

    # ---------------------------------------------------------------- canlı olaylar
    def replay_limit() -> int:
        return max(1, min(100000, int(S.settings.get("events.replay_limit", DEFAULT_REPLAY_LIMIT) or DEFAULT_REPLAY_LIMIT)))

    @r.get("/events")
    async def events(request: Request, since: int | None = Query(None, ge=0)) -> StreamingResponse:
        """SSE. kalıcı (kritik) olay çerçeveleri `id: <seq>` taşır. Yeniden bağlanmada `Last-Event-ID`
        başlığı (tarayıcı kendisi gönderir) ya da `?since=<seq>` → imleçten sonraki kritik olaylar `replay_limit`
        kadar yeniden gönderilir, sonra canlı akışa geçilir (çift/boşluk yok). İmleç saklanan pencereden eskiyse,
        ileri/geçersizse ya da replay sınırı aşılırsa açık `resync_required {reason, from, oldest, latest}` + `hello`.
        S15: kuyrukta biriken olaylar tek yazımda gönderilir, JSON istemciler arasında bir kez üretilir."""
        cursor = request.headers.get("last-event-id")
        if cursor is None or not cursor.strip():
            cursor = since  # tarayıcının kendi başlığı, elle verilen ?since='den daha yenidir
        stream = sse_stream(
            S.bus, cursor=cursor, replay_limit=replay_limit(), is_disconnected=request.is_disconnected,
            hello=lambda: {"type": "hello", "states": S.engine.snapshot_states(), "ts": time.time()})
        return StreamingResponse(stream, media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @r.get("/events/log")
    async def events_log(since: int | None = Query(None, ge=0), limit: int = Query(500, ge=1, le=5000)) -> Any:
        """SSE kullanmayan istemciler (MCP vb.) için kalıcı kritik olaylar. `since` verilirse ondan sonraki
        en çok `limit` olay (artan; `more` → sonraki sayfa `since=next`), verilmezse en son `limit` olay.
        `resync_required`: imleç saklanan pencereden eski ya da günlükten ileri (tam yenileme gerekir)."""
        log = S.events_log
        info = await asyncio.to_thread(log.info)
        if since is None:
            rows = await asyncio.to_thread(log.tail, limit)
            more = False
        else:
            rows = await asyncio.to_thread(log.read_after, since, limit + 1)
            more = len(rows or []) > limit
            rows = (rows or [])[:limit]
        resync = since is not None and (since < info["pruned_through"] or since > info["latest"])
        return JSONResponse({
            "events": [json.loads(d) for _s, d in rows], "since": since,
            "next": rows[-1][0] if rows else (since if since is not None else info["latest"]), "more": more,
            "resync_required": resync, "oldest": info["oldest"], "latest": info["latest"],
            "pruned_through": info["pruned_through"], "persistent": info["persistent"], "retention": info["retention"],
            "replay_limit": replay_limit(), "bus": S.bus.stats()})

    if EDITION == "full":  # S40: yönetici/test modu (brand.ADMIN_MODE_AVAILABLE False iken tüm uçlar 404); free'de yok
        from studio.admin import build_router as admin_router
        r.include_router(admin_router(S))
    return r
