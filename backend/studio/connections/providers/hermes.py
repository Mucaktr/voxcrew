"""Hermes Agent: veri kökü adayları, çalıştırıcı, profiller, API sunucusu (gateway) durumu."""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any

from studio.connectors import discovery as disc
from studio.i18n import translate
from studio.connections.providers.base import (
    Provider, ProviderContext, finder_kwargs, fix_button, fix_command, fix_link, problem,
)

INSTALL_URL = "https://hermes-agent.nousresearch.com/docs/getting-started/installation"
_LOCAL_PROVIDERS = ("custom", "ollama", "ollama-launch", "lmstudio", "llamacpp")


def _is_cloud_model(model: str) -> bool:
    """Ollama bulut modeli adı (`gpt-oss:120b-cloud`, `x:cloud`): bu bilgisayarda çalışmaz, Ollama hesabı ister."""
    m = (model or "").strip().lower()
    return m.endswith(("-cloud", ":cloud"))


def profile_models(home: Path | None) -> list[dict[str, Any]]:
    """Her Hermes profilinin model özeti (BRAINS-LIVE): {profile, provider, model, local, cloud}. Yalnızca config.yaml'ın
    `model` bölümü okunur (anahtar ya da adres döndürülmez). Hermes yoksa boş liste."""
    if home is None:
        return []
    from studio.agents import _host_port, scan_profiles  # noqa: PLC0415 - döngüsel içe aktarım
    try:
        rows = scan_profiles(home)
    except Exception:  # noqa: BLE001 - bozuk profil bağlantı kartını düşürmesin
        return []
    out: list[dict[str, Any]] = []
    for r in rows:
        provider, model, base = r.get("provider") or "auto", r.get("model") or "", r.get("base_url") or ""
        host = _host_port(base)[0] if base else ""
        local = provider in _LOCAL_PROVIDERS and (not base or host in ("127.0.0.1", "localhost"))
        out.append({"profile": r["profile"], "provider": provider, "model": model, "local": local,
                    "cloud": _is_cloud_model(model)})
    return out


def recommended_test_profile(rows: list[dict[str, Any]]) -> str:
    """Bağlantı testi için önerilen profil: önce yerel (ücretsiz) modelli, sonra bulut olmayan, en son `default`.
    Kullanıcının varsayılan profili bu bilgisayarda olmayan bir bulut modeline bağlıysa test oraya gitmez."""
    for want in (lambda r: r["local"] and not r["cloud"] and r["model"], lambda r: not r["cloud"] and r["model"]):
        hit = next((r for r in rows if want(r)), None)
        if hit:
            return str(hit["profile"])
    return "default"


class HermesProvider(Provider):
    kind = "hermes"
    name = "Hermes Agent"
    subtitle_key = "sub_hermes"
    optional = True
    order = 10

    def fast(self, ctx: ProviderContext) -> dict[str, Any]:
        setting = str(ctx.settings.get("hermes_home") or "")
        kw = finder_kwargs(ctx)
        cands = disc.hermes_home_candidates(setting, **kw)
        current = next((c for c in cands if "setting" in c["sources"]), None)
        home = Path(setting) if setting else None
        exe = (disc.find_hermes(home, **{k: v for k, v in kw.items() if k in ("platform", "which")})
               if home and home.is_dir() else None)
        home_ok = bool(current and current["exists"] and current["looks_like_home"])
        if not home_ok:
            # Ayarlı klasör Hermes veri kökü değil (boş/yanlış): PATH'teki hermes başka bir köke aittir; bu ayarla
            # çalıştırmak bozulur. "Kurulu" sayma; aday öner (D-02).
            exe = None
        better = next((c for c in cands if c["recommended"] and "setting" not in c["sources"]), None)
        pm = profile_models(home) if exe else []
        return {
            "installed": bool(exe), "install_path": str(exe) if exe else None,
            "version": disc.hermes_version(home) if home and home.is_dir() else None,
            "runner_running": None, "service_reachable": None, "session_valid": None,
            "extra": {
                "home": setting, "home_exists": bool(home and home.is_dir()), "home_ok": home_ok,
                "profiles": current["profiles"] if current else [], "candidates": cands,
                "better_candidate": better["path"] if better else None, "wsl": disc.wsl_hint(ctx.platform, ctx.which),
                "profile_models": pm, "test_profile": recommended_test_profile(pm) if pm else "default",
            },
        }

    async def slow(self, ctx: ProviderContext, fast: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        exe = fast.get("install_path")
        if exe and not fast.get("version"):
            # Kurulum damgası yoksa (nadir) --version; damga varsa bu yavaş çağrı hiç yapılmaz (yoğun makinede 25 sn sürebiliyordu)
            rq = ctx.run_quick or disc.run_quick
            rc, text = await asyncio.to_thread(rq, [exe, "--version"], 25)
            if rc == -1 and "timed out" in text.lower():
                out["timeout"] = True
            elif rc == 0:
                m = re.search(r"\bv?(\d+\.\d+(?:\.\d+)?)\b", text)
                out["version"] = m.group(1) if m else None
            if "pm repair" in text:
                out["warning_code"] = "hermes_pm_repair"
        if ctx.gateway is not None and fast.get("installed"):
            try:
                g = await ctx.gateway.gateway_info()
                out["runner_running"] = bool(g.get("running"))
                out["service_reachable"] = bool(g.get("healthy"))
                try:
                    key_present = bool(ctx.gateway.key_present("default"))
                except Exception:  # noqa: BLE001
                    key_present = False
                out["extra_gateway"] = {"state": g.get("state"), "port": g.get("port"), "url": g.get("url"),
                                        "can_start": g.get("can_start"), "start_blocker": g.get("start_blocker"),
                                        "key_present": key_present}
            except Exception:  # noqa: BLE001 - gateway durumu alınamazsa bilinmiyor kalır
                pass
        return out

    def problems(self, state: dict[str, Any], ctx: ProviderContext) -> list[dict[str, Any]]:
        x = state.get("extra") or {}
        out: list[dict[str, Any]] = []
        if not state.get("installed"):
            if x.get("better_candidate") and "hermes_home" in getattr(ctx.settings, "env_locked", []):
                # HERMES_HOME ortam değişkeni stüdyo ayarını kilitler: "Bu klasörü kullan" işe yaramaz (400 döner);
                # kullanıcıya değişkeni düzeltmesini söyle, bulunan yolu kopyalanabilir ver
                out.append(problem("hermes_home_env_locked", fix_command("fix_copy_path", x["better_candidate"]),
                                   home=x.get("home"), path=x["better_candidate"]))
            elif x.get("better_candidate"):
                out.append(problem("hermes_home_wrong", fix_button("fix_use_folder", "hermes.apply_home", path=x["better_candidate"]),
                                   home=x.get("home"), path=x["better_candidate"]))
            elif x.get("home_ok"):
                # veri kökü doğru, çalıştırıcı yok (PATH eksik): klasör seçtirmek yanlış çözüm olur (QA-F56)
                out.append(problem("hermes_runner_missing", fix_link("fix_install_guide", INSTALL_URL, guide="hermes"), home=x.get("home")))
            elif sum(1 for c in x.get("candidates") or [] if c.get("exists")) >= 2:
                # "birden çok aday" yalnız gerçekten iki ya da daha çok var olan klasör varken
                out.append(problem("hermes_pick_home", fix_button("fix_pick_folder", "hermes.pick_home")))
            elif x.get("home") and x.get("home_exists"):
                # ayarlı (ya da HERMES_HOME) tek klasör var ama boş / Hermes kurulumu değil: kurulu değil, isteğe bağlı
                out.append(problem("hermes_home_empty", fix_link("fix_install_guide", INSTALL_URL, guide="hermes"),
                                   severity="info", home=x.get("home")))
            else:
                out.append(problem("hermes_not_installed", fix_link("fix_install_guide", INSTALL_URL, guide="hermes"), severity="info"))
            return out
        if state.get("warning_code") == "hermes_pm_repair":
            out.append(problem("hermes_pm_repair", {"kind": "command", "label": "fix_run_command", "command": "hermes pm repair"},
                               severity="warn"))
        gw = state.get("extra_gateway") or {}
        if gw and not gw.get("key_present"):
            out.append(problem("hermes_api_off", fix_button("fix_enable_api", "hermes.enable_api"), severity="info"))
        elif gw and not state.get("service_reachable"):
            out.append(problem("hermes_gateway_stopped", fix_button("fix_start_gateway", "hermes.start_gateway"), severity="info"))
        return out

    def legacy(self, state: dict[str, Any]) -> dict[str, Any]:
        from studio.connections.service import msg  # noqa: PLC0415 - döngüsel içe aktarım
        x = state.get("extra") or {}
        detail = None
        if not state.get("installed"):
            # eski `detail`: Hermes isteğe bağlıdır notu her zaman görünür; aday önerisi sorun listesinde
            detail = msg("hermes_not_installed")
            if x.get("better_candidate"):
                detail += " " + msg("hermes_home_wrong", {"home": x.get("home"), "path": x["better_candidate"]})
        return {"available": bool(state.get("installed")), "path": state.get("install_path"), "optional": True,
                "profiles": x.get("profiles", []), "detail": detail,
                "warning": translate("Hermes bağımlılık ortamı kayıtlı değil; sorun yaşarsanız terminalde "
                                     "`hermes pm repair` çalıştırın.")
                if state.get("warning_code") == "hermes_pm_repair" else None}  # 200 yanıt: burada çevrilir (C-04)
