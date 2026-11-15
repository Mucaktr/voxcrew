"""Model API'leri (S29 → S37): adlandırılmış ÇOKLU uç nokta — yerel OpenAI uyumlu sunucular (LM Studio 1234,
llama.cpp 8080, vLLM 8000, Jan 1337) keşfi; kullanıcının eklediği bulut API'leri (Mistral, OpenRouter, Groq, Gemini…)
ve Anthropic Messages API — hepsi "kendi anahtarınla" (hesap aracılığı yok).

Tek ConnectionService kartı (`openai_compat`) kalır: üst düzey alanlar VARSAYILAN uç noktayı anlatır (geriye uyum);
`extra.endpoints[]` her uç noktanın kendi durumunu (`ready`, `problems`, `models`, maskeli anahtar) taşır.
Anahtar `secrets.json`'da (SecretStore); yanıtlarda yalnızca maskeli. Uyumluluk yalnızca uç biçiminden varsayılmaz:
`/models` yanıtı alınınca "ulaşıldı", gerçek yetenek testi `test` eylemiyle ayrıca yapılır.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

from studio.changes import redact_text
from studio.connectors import anthropic_api
from studio.connectors import openai_compat as compat_conn
from studio.connectors.discovery import port_open
from studio.connections import endpoints as E
from studio.connections.providers.base import Provider, ProviderContext, fix_button, problem

LOCAL_CANDIDATES = (
    ("LM Studio", "http://127.0.0.1:1234/v1"),
    ("llama.cpp server", "http://127.0.0.1:9931/v1"),  # güncel llama-server varsayılanı
    ("llama.cpp server", "http://127.0.0.1:8080/v1"),  # eski sürümler / Docker örnekleri
    ("vLLM", "http://127.0.0.1:8000/v1"),
    ("Jan", "http://127.0.0.1:1337/v1"),
)
HTTP_TIMEOUT_S = 4.0
SECRET_NAME = E.LEGACY_SECRET


def _same_url(a: str, b: str) -> bool:
    n = lambda u: (u or "").rstrip("/").replace("://localhost", "://127.0.0.1")  # noqa: E731
    return n(a) == n(b)


def config_of(settings: Any) -> dict[str, Any]:
    """Varsayılan uç noktanın eski biçimli özeti (enabled, base_url, label, model)."""
    ep = E.get_endpoint(settings)
    if not ep:
        return {"enabled": False, "base_url": "", "label": "", "model": ""}
    return {"enabled": True, "base_url": ep["base_url"], "label": ep["label"], "model": ep["model"]}


async def probe(ep: dict[str, Any], key: str | None, transport: Any = None) -> dict[str, Any]:
    """Tek uç nokta: `/models` ile ulaşılabilirlik, anahtar geçerliliği ve model listesi."""
    lister = anthropic_api.list_models if ep["api"] == "anthropic" else compat_conn.list_models
    try:
        code, names = await lister(ep["base_url"], key, transport=transport, timeout=HTTP_TIMEOUT_S)
    except httpx.TimeoutException:
        return {"timeout": True, "reachable": None}
    except (httpx.HTTPError, ValueError) as exc:
        return {"reachable": False, "error": redact_text(str(exc), (key,))[:200], "models": None, "timeout": False}
    if code in (401, 403):
        return {"reachable": True, "session_valid": False, "models": None, "timeout": False, "status": code}
    if code == 200:
        return {"reachable": True, "session_valid": True if key else None, "timeout": False,
                "models": {"count": len(names), "names": names[:200]}}
    if code in (404, 405):  # /models yok ama sunucu yanıt veriyor: model adı elle girilir
        return {"reachable": True, "session_valid": None, "models": None, "timeout": False, "status": code}
    return {"reachable": False, "error": f"HTTP {code}", "models": None, "timeout": False, "status": code}


def endpoint_problems(ep: dict[str, Any], st: dict[str, Any]) -> list[dict[str, Any]]:
    """Uç nokta başına sorunlar (kodlar endpoints.TEXTS; service.public dile çevirir)."""
    label = ep.get("label") or ep.get("host")
    fix_cfg = fix_button("fix_configure", "openai_compat.edit", endpoint=ep["id"])
    if ep.get("key_required") and not ep.get("has_key"):
        return [problem("ep_key_missing", fix_cfg, label=label)]
    if st.get("listening") is False:
        return [problem("ep_stopped", fix_button("fix_retry", "rescan"), label=label)]
    if st.get("session_valid") is False:
        return [problem("ep_key_rejected", fix_cfg, label=label)]
    if st.get("reachable") is False:
        return [problem("ep_http_error", fix_button("fix_retry", "rescan"), label=label, error=st.get("error"))]
    last = st.get("last_use") or {}
    if last.get("ok") is False:
        # QA O-15: /models yanıt verse de son gerçek test (ör. sohbet ucu 404) başarısızsa kart "hazır" görünmez;
        # sonraki başarılı test `last_use.ok`u True yapar ve sorun kalkar (anahtar reddi yukarıda ayrıca ele alınır)
        return [problem("ep_test_failed", fix_cfg, label=label, error=str(last.get("error") or "")[:200] or "?")]
    if not ep.get("model") and st.get("reachable"):
        return [problem("ep_pick_model", fix_cfg, severity="warn", label=label)]
    if st.get("reachable") and not last:
        # QA O-29: /models yanıtı yalnız "ulaşıldı" demektir; ilk başarılı yetenek testine kadar "hazır" denmez
        return [problem("ep_untested", fix_button("fix_test", "openai_compat.test", endpoint=ep["id"]),
                        severity="warn", label=label)]
    return []


def endpoint_ready(ep: dict[str, Any], st: dict[str, Any], problems: list[dict[str, Any]]) -> str:
    if any(p["severity"] == "block" or p["code"] == "ep_untested" for p in problems):
        return "needs_action"
    if st.get("reachable") is None and st.get("listening") is not False and not st.get("checked"):
        return "checking"
    if st.get("reachable") is None and st.get("timeout"):
        return "checking"
    return "ok"


class OpenAICompatProvider(Provider):
    kind = "openai_compat"
    name = "Model API'leri"
    subtitle_key = "sub_openai_compat"
    optional = True
    order = 60

    def fast(self, ctx: ProviderContext) -> dict[str, Any]:
        settings = ctx.settings
        eps = E.endpoints_of(settings)
        default_id = E.default_endpoint_id(settings)
        configured_urls = [e["base_url"] for e in eps]
        discovered = []
        for label, url in LOCAL_CANDIDATES:
            if any(_same_url(url, c) for c in configured_urls):
                continue
            if port_open(url, 0.4):
                discovered.append({"label": label, "base_url": url})
        pub = []
        listening: dict[str, bool | None] = {}
        corrupt = bool(ctx.secrets and getattr(ctx.secrets, "is_corrupt", lambda: False)())   # listeleme başına bir kez
        for ep in eps:
            p = E.public_endpoint(ep, ctx.secrets, default_id, corrupt)
            listening[ep["id"]] = port_open(ep["base_url"], 0.4) if p["local"] and ep["enabled"] else None
            pub.append(p)
        dflt = next((p for p in pub if p["id"] == default_id), None)
        cfg = ({"enabled": True, "base_url": dflt["base_url"], "label": dflt["label"], "model": dflt["model"],
                "api_key_masked": dflt["api_key_masked"], "has_key": dflt["has_key"], "local": dflt["local"],
                "id": dflt["id"], "api": dflt["api"]}
               if dflt else {"enabled": False, "base_url": "", "label": "", "model": "", "api_key_masked": None,
                             "has_key": False, "local": False, "id": None, "api": "openai"})
        configured = bool(dflt)
        prev_status = dict((ctx.previous or {}).get("endpoint_status") or {})
        for eid, lis in listening.items():
            cur = dict(prev_status.get(eid) or {})
            cur["listening"] = lis
            prev_status[eid] = cur
        return {
            "installed": configured or bool(discovered), "install_path": cfg["base_url"] or None,
            "runner_running": listening.get(default_id) if configured else (True if discovered else None),
            "service_reachable": None, "session_valid": None,
            "endpoint_status": prev_status,
            "extra": {"config": cfg, "endpoints": pub, "default_endpoint": default_id, "discovered": discovered},
        }

    async def slow(self, ctx: ProviderContext, fast: dict[str, Any]) -> dict[str, Any]:
        x = fast.get("extra") or {}
        eps: list[dict[str, Any]] = [e for e in (x.get("endpoints") or []) if e.get("enabled", True)]
        status: dict[str, Any] = dict(fast.get("endpoint_status") or {})
        if not eps:
            return {"models_ready": None, "endpoint_status": status}

        async def one(ep: dict[str, Any]) -> tuple[str, dict[str, Any]]:
            st = dict(status.get(ep["id"]) or {})
            if st.get("listening") is False:
                return ep["id"], {**st, "reachable": None, "models": None, "checked": True}
            if ep.get("key_required") and not ep.get("has_key"):
                return ep["id"], {**st, "reachable": None, "session_valid": None, "models": None, "checked": True}
            key = ctx.secrets.get(E.secret_name(ep["id"])) if ctx.secrets else None
            res = await probe(ep, key, ctx.http_transport)
            if res.get("timeout"):  # yavaş yanıt ≠ kapalı: önceki model listesi korunur
                return ep["id"], {**st, "timeout": True, "checked": True}
            st.update({"session_valid": None, "error": None, "status": None}, **res)
            st["checked"] = True
            return ep["id"], st

        results = await asyncio.gather(*(one(e) for e in eps))
        status.update(dict(results))
        did = x.get("default_endpoint")
        d = status.get(did) or {}
        out: dict[str, Any] = {"endpoint_status": status, "timeout": bool(d.get("timeout"))}
        if did:
            out.update({"service_reachable": d.get("reachable"), "session_valid": d.get("session_valid"),
                        "models_ready": d.get("models"), "error": d.get("error")})
        return out

    def problems(self, state: dict[str, Any], ctx: ProviderContext) -> list[dict[str, Any]]:
        x = state.get("extra") or {}
        status = state.get("endpoint_status") or {}
        # uç nokta başına durum (arayüz: kart içi liste, BrainPicker, görev penceresi)
        for ep in x.get("endpoints") or []:
            st = status.get(ep["id"]) or {}
            probs = endpoint_problems(ep, st) if ep.get("enabled", True) else []
            ep["problems"] = probs
            ep["ready"] = endpoint_ready(ep, st, probs) if ep.get("enabled", True) else "unavailable"
            ep["models_live"] = (st.get("models") or {}).get("names")
            ep["last_use"] = st.get("last_use")
        cfg = x.get("config") or {}
        out: list[dict[str, Any]] = []
        if not cfg.get("base_url"):
            if x.get("discovered"):
                d = x["discovered"][0]
                out.append(problem("compat_found", fix_button("fix_use_server", "openai_compat.configure",
                                                               base_url=d["base_url"], label=d["label"]), label=d["label"]))
            else:
                out.append(problem("compat_unconfigured", fix_button("fix_configure", "openai_compat.pick"), severity="info"))
            return out
        dflt = next((e for e in x.get("endpoints") or [] if e["id"] == cfg.get("id")), None)
        if dflt and dflt.get("key_required") and not dflt.get("has_key"):
            out.append(problem("compat_key_missing", fix_button("fix_configure", "openai_compat.edit", endpoint=dflt["id"]),
                               label=cfg.get("label") or cfg["base_url"]))
            return out
        if state.get("runner_running") is False:
            out.append(problem("compat_stopped", fix_button("fix_retry", "rescan"), label=cfg.get("label") or cfg["base_url"]))
            return out
        if state.get("session_valid") is False:
            out.append(problem("compat_key_rejected", fix_button("fix_configure", "openai_compat.pick")))
        elif state.get("service_reachable") is False:
            out.append(problem("compat_http_error", fix_button("fix_retry", "rescan"), error=state.get("error")))
        elif not cfg.get("model") and (state.get("models_ready") or {}).get("count"):
            out.append(problem("compat_pick_model", fix_button("fix_configure", "openai_compat.pick"), severity="warn"))
        elif dflt and any(p["code"] == "ep_untested" for p in dflt.get("problems") or []):
            # QA SP-QA-02: varsayılan uç nokta hiç test edilmediyse kart da "hazır" demez ve beyin listesine girmez
            out.append(problem("compat_untested", fix_button("fix_test", "openai_compat.test", endpoint=dflt["id"]),
                               label=cfg.get("label") or cfg["base_url"]))
        elif dflt and dflt.get("ready") == "needs_action":
            # kartın hazırlığı varsayılan uç noktanın `ready` değerini izler (ör. son test başarısız → kart
            # "hazır" demez ve beyin `brains_ready` listesine girmez)
            first = next((p for p in dflt.get("problems") or [] if p.get("severity") == "block"), None) or {}
            params = first.get("params") or {}
            out.append(problem("compat_default_failed",
                               first.get("fix") or fix_button("fix_configure", "openai_compat.edit", endpoint=dflt["id"]),
                               label=cfg.get("label") or cfg["base_url"], error=str(params.get("error") or "?")[:200]))
        return out

    def legacy(self, state: dict[str, Any]) -> dict[str, Any]:
        cfg = (state.get("extra") or {}).get("config") or {}
        return {"available": bool(cfg.get("base_url")) and state.get("service_reachable") is True,
                "path": cfg.get("base_url") or None, "optional": True, "default_model": cfg.get("model") or None}
