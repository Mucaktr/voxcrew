"""Ollama: kurulu mu (dosya), çalışıyor mu (port), yanıt veriyor mu (HTTP), model var mı, Hermes uyumlu model var mı."""

from __future__ import annotations

from typing import Any

import httpx

from studio.connectors import discovery as disc
from studio.connectors.discovery import port_open
from studio.connectors.ollama import HERMES_MIN_CTX, _num_ctx
from studio.connections.providers.base import Provider, ProviderContext, finder_kwargs, fix_button, fix_link, problem

INSTALL_URL = "https://ollama.com/download"


def _is_loopback(url: str) -> bool:
    from urllib.parse import urlsplit  # noqa: PLC0415
    host = (urlsplit(url if "://" in url else f"http://{url}").hostname or "").lower()
    return host in ("127.0.0.1", "localhost", "::1") or host.startswith("127.")
HTTP_TIMEOUT_S = 8.0
LOOPBACK_RETRY_TIMEOUT_S = 3.0


class OllamaProvider(Provider):
    kind = "ollama"
    name = "Ollama"
    subtitle_key = "sub_ollama"
    order = 20

    def fast(self, ctx: ProviderContext) -> dict[str, Any]:
        exe = disc.find_ollama(**finder_kwargs(ctx))
        urls = disc.ollama_url_from(str(ctx.settings.get("ollama_url")), ctx.env)
        listening = port_open(urls["url"])
        managed = bool(ctx.ollama_runner and ctx.ollama_runner.managed)
        # SETUP: Windows kapalı YEREL porta bağlanmayı ~2 sn yeniden dener; 0,6 sn'lik kontrol zaman aşımına düşüp
        # "bilinmiyor" diyordu ve kart kurulum rehberi yerine "ulaşılamıyor" gösteriyordu. Çalıştırıcı yoksa ve adres bu
        # bilgisayarsa bir kez daha uzun süreyle sor: ret (False) → "kurulu değil"; yine zaman aşımı → bilinmiyor kalır.
        if listening is None and not exe and _is_loopback(urls["url"]):
            again = port_open(urls["url"], LOOPBACK_RETRY_TIMEOUT_S)
            if again is not None:
                listening = again
        return {
            # Ollama, port dinliyorsa "kurulu" sayılır (uzak/WSL kurulumunda dosya yoktur)
            # çözümlenemeyen adres / zaman aşımı (listening None) → kurulum bilinmiyor, "kurulu değil" denmez (QA-F56)
            "installed": True if (exe or listening) else (None if listening is None else False),
            "install_path": str(exe) if exe else None,
            "runner_running": listening, "service_reachable": listening if listening else (None if listening is None else False),
            "session_valid": None,
            "extra": {"url": urls["url"], "env_url": urls["env_url"], "url_mismatch": urls["mismatch"], "managed": managed,
                      "exe_found": bool(exe), "unreachable": listening is None},
        }

    async def slow(self, ctx: ProviderContext, fast: dict[str, Any]) -> dict[str, Any]:
        if not fast.get("runner_running"):
            return {"models_ready": None}
        url = fast["extra"]["url"]
        out: dict[str, Any] = {}
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_S, trust_env=False, transport=ctx.http_transport) as client:
                # HTTP hata kodu "model yok" sayılmaz: protokol hatası ayrı karttır (QA-F56)
                out["version"] = (await client.get(f"{url}/api/version")).raise_for_status().json().get("version")
                tags = (await client.get(f"{url}/api/tags")).raise_for_status().json().get("models", [])
                loaded = (await client.get(f"{url}/api/ps")).raise_for_status().json().get("models", [])
                hermes_ready: list[str] = []
                tools: list[str] = []
                for t in tags[:40]:  # /api/show her model için: büyük listelerde sınırlı
                    try:
                        info = (await client.post(f"{url}/api/show", json={"model": t["name"]})).json()
                    except (httpx.HTTPError, ValueError):
                        info = {}
                    caps = t.get("capabilities") or info.get("capabilities") or []
                    nctx = _num_ctx(info.get("parameters"))
                    if "tools" in caps:
                        tools.append(t["name"])
                        if nctx and nctx >= HERMES_MIN_CTX:
                            hermes_ready.append(t["name"])
            local = [t["name"] for t in tags if not (t.get("remote_host") or t.get("remote_model")
                                                     or t["name"].endswith(("-cloud", ":cloud")))]
            out["service_reachable"] = True
            out["timeout"] = False
            out["models_ready"] = {"count": len(local), "names": local[:50], "tools": tools, "hermes_ready": hermes_ready,
                                   "loaded": [m.get("name") for m in loaded], "total": len(tags)}
        except httpx.TimeoutException:
            out["timeout"] = True  # yanıt vermedi ≠ kurulu değil; önceki model listesi korunur
            out["models_ready"] = (ctx.previous or {}).get("models_ready")
        except (httpx.HTTPError, ValueError) as exc:
            out["service_reachable"] = False
            out["error"] = str(exc)[:200]
            out["models_ready"] = None
        return out

    def problems(self, state: dict[str, Any], ctx: ProviderContext) -> list[dict[str, Any]]:
        x = state.get("extra") or {}
        out: list[dict[str, Any]] = []
        if x.get("unreachable") and not state.get("runner_running"):
            out.append(problem("ollama_unreachable", fix_button("fix_retry", "rescan"), url=x.get("url")))
            return out
        if not state.get("installed"):
            out.append(problem("ollama_not_installed", fix_link("fix_install_guide", INSTALL_URL, guide="ollama")))
            return out
        if x.get("url_mismatch"):
            out.append(problem("ollama_host_mismatch", None, severity="warn", url=x.get("url"), env_url=x.get("env_url")))
        if not state.get("runner_running"):
            fix = fix_button("fix_start_ollama", "ollama.start") if x.get("exe_found") else None
            out.append(problem("ollama_stopped", fix, url=x.get("url")))
            return out
        if state.get("timeout"):
            out.append(problem("ollama_slow", fix_button("fix_retry", "rescan"), severity="warn"))
        if state.get("service_reachable") is False:
            out.append(problem("ollama_http_error", fix_button("fix_retry", "rescan"), error=state.get("error")))
            return out
        mr = state.get("models_ready")
        if mr is not None and mr.get("count", 0) == 0:
            out.append(problem("ollama_no_models", fix_button("fix_pull_model", "ollama.pick_model")))
        elif mr is not None and not mr.get("tools"):
            out.append(problem("ollama_no_tools_model", fix_button("fix_pull_model", "ollama.pick_model"), severity="warn"))
        return out

    def legacy(self, state: dict[str, Any]) -> dict[str, Any]:
        mr = state.get("models_ready") or {}
        x = state.get("extra") or {}
        running = bool(state.get("runner_running"))
        return {"available": running and state.get("service_reachable") is not False, "path": x.get("url"),
                "models": mr.get("count"), "loaded": mr.get("loaded", []), "error": state.get("error")}
