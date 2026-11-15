"""Seçilebilir modeller — bağlantı başına tek liste (UI-CLARITY).

`GET /api/connections/models/available` bu modüldeki `build()` sonucunu döner. Yeni ağ çağrısı yoktur: veri,
`ConnectionService`in önbellekli durumundan, stüdyonun Ollama model listesinden ve kayıtlı API uç noktalarından gelir
(ağ yalnızca durum tazelemesinde, kısa zaman aşımıyla — `api.py`). Yanıt biçimi:

    {"connections": {kind: {"ready": bool, "reason": str|None, "reason_text": str|None, "link": "/baglantilar",
                            "default_model": str|None,
                            "models": [{"id", "label", "source", "default", "group"?, "local"?}]}},
     "generated_at": float}

`id`, eval ve ajan `model` alanına olduğu gibi yazılabilir: openai_compat için `<uç nokta>::<model>` (endpoints.model_ref).
Boş model her zaman "bağlantının varsayılanı" demektir; arayüz bunu ayrıca sunar.
"""

from __future__ import annotations

import time
from typing import Any

from studio.connections import endpoints as E

KINDS = ("ollama", "codex", "claude", "openai_compat")
LINK = "/baglantilar"
# Claude Code CLI `--model` takma adları (BrainPicker ile aynı üçlü); CLI kendi sürümünü çözer.
CLAUDE_ALIASES = (("sonnet", "Sonnet"), ("opus", "Opus"), ("haiku", "Haiku"))
# Fiyat tablosunda doğrulanmış Codex/OpenAI model adları — kurulu model listesi değil, bilinen adlar.
CODEX_KNOWN = ("gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol")


def _entry(mid: str, label: str, source: str, *, default: bool = False, **extra: Any) -> dict[str, Any]:
    return {"id": mid, "label": label, "source": source, "default": default, **extra}


def _dedupe(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out = []
    for it in items:
        if it["id"] and it["id"] not in seen:
            seen.add(it["id"])
            out.append(it)
    return out


def _block(state: dict[str, Any] | None, fallback: str) -> tuple[str | None, str | None]:
    """(neden kodu, yerelleştirilmiş neden metni) — ilk engelleyici sorundan; yoksa `fallback` kodu."""
    if not state:
        return fallback, None
    probs = state.get("problems") or []
    first = next((p for p in probs if p.get("severity") == "block"), None) or (probs[0] if probs else None)
    if first:
        return str(first.get("code") or fallback), str(first.get("message") or "") or None
    if state.get("checking"):
        return "checking", None
    return fallback, None


def _ollama(state: dict[str, Any] | None, models: list[dict[str, Any]]) -> dict[str, Any]:
    names = list(((state or {}).get("models_ready") or {}).get("names") or [])
    items: list[dict[str, Any]] = []
    for m in models:
        name = str(m.get("name") or "")
        size = m.get("parameter_size")
        local = bool(m.get("local", True))
        items.append(_entry(name, f"{name} · {size}" if size else name, "ollama" if local else "ollama-remote", local=local))
    if not items:
        items = [_entry(n, n, "ollama", local=True) for n in names]
    items = _dedupe(items)
    reach = (state or {}).get("service_reachable")
    ok = bool(items) and (state or {}).get("installed") is not False and reach is not False
    reason, text = (None, None) if ok else (_block(state, "no_models" if reach else "unavailable"))
    if not ok and items:  # model var ama hizmet yanıtsız
        reason = reason or "unavailable"
    return {"ready": ok, "reason": reason, "reason_text": text, "models": items, "default_model": None}


def _cli(kind: str, state: dict[str, Any] | None, settings: Any) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    dflt = (state or {}).get("default_model") if state else None
    if kind == "claude":
        items = [_entry(a, label, "cli-alias") for a, label in CLAUDE_ALIASES]
    else:
        hermes_model = str((settings.get("codex_hermes_model") if hasattr(settings, "get") else "") or "")
        if dflt:
            items.append(_entry(str(dflt), str(dflt), "cli-config", default=True))
        if hermes_model:
            items.append(_entry(hermes_model, hermes_model, "studio"))
        items += [_entry(n, n, "known") for n in CODEX_KNOWN]
    items = _dedupe(items)
    ok = bool(state) and state.get("ready") == "ok"
    reason, text = (None, None) if ok else _block(state, "unavailable")
    return {"ready": ok, "reason": reason, "reason_text": text, "models": items, "default_model": dflt or None}


def _compat(state: dict[str, Any] | None, settings: Any) -> dict[str, Any]:
    eps = [e for e in ((state or {}).get("extra") or {}).get("endpoints") or [] if e.get("enabled", True)]
    if not eps:  # durum henüz yoksa kayıtlı listeden
        eps = [e for e in E.endpoints_of(settings) if e.get("enabled", True)]
    items: list[dict[str, Any]] = []
    ready_any = False
    first_block: tuple[str | None, str | None] = (None, None)
    for ep in eps:
        label = str(ep.get("label") or ep.get("host") or ep.get("id"))
        live = ep.get("models_live")
        names = list(live if live else ep.get("models") or [])
        chosen = str(ep.get("model") or "")
        if chosen and chosen not in names:
            names.insert(0, chosen)
        ep_ok = ep.get("ready", "checking") == "ok"
        ready_any = ready_any or ep_ok
        if not ep_ok and first_block == (None, None):
            probs = ep.get("problems") or []
            p = next((q for q in probs if q.get("severity") == "block"), None) or (probs[0] if probs else None)
            first_block = (str(p.get("code")), str(p.get("message") or "") or None) if p else ("unavailable", None)
        if not ep_ok:
            continue  # hazır olmayan uç noktanın modelleri seçilemez (neden `reason`da)
        for n in names:
            items.append(_entry(E.model_ref(ep["id"], n), f"{n} · {label}" if len(eps) > 1 else n,
                                f"endpoint:{ep['id']}", default=bool(ep.get("is_default") and n == chosen),
                                group=label, local=bool(ep.get("local"))))
    ok = ready_any and bool(items)
    if ok:
        reason, text = None, None
    elif not eps:
        reason, text = _block(state, "compat_unconfigured")
    elif ready_any:  # hazır uç nokta var, model listesi boş (ör. /models yok): model elle yazılır
        reason, text = "no_models", None
    else:
        reason, text = first_block
    dflt = next((i["id"] for i in items if i["default"]), None)
    return {"ready": ok, "reason": reason, "reason_text": text, "models": _dedupe(items), "default_model": dflt}


def build(settings: Any, states: dict[str, dict[str, Any]], ollama_models: list[dict[str, Any]]) -> dict[str, Any]:
    """`states`: kind → `ConnectionService.public(kind)`. Eksik tür hazır değil sayılır."""
    out = {
        "ollama": _ollama(states.get("ollama"), ollama_models),
        "codex": _cli("codex", states.get("codex"), settings),
        "claude": _cli("claude", states.get("claude"), settings),
        "openai_compat": _compat(states.get("openai_compat"), settings),
    }
    for v in out.values():
        v["link"] = LINK
    return {"connections": out, "generated_at": time.time()}
