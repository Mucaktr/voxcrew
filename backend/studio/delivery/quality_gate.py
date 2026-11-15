"""Kalite kapısı kancası (CG-QUALITY `studio.quality`, isteğe bağlı içe aktarma).

Dış hedeflerden önce kayıtlı rapor TESLİM EDİLEN içeriğe karşı denetlenir: `assess(studio, id)` raporun
`content_hash`'ini çıktının şimdiki içeriğiyle karşılaştırır; içerik değiştiyse ya da rapor yoksa yeniden değerlendirir
(yanlış-pozitif işaretleri korunur, "yine de kabul" yalnız aynı içerikte kalır). Sonra `gate_decision` → pass | warn |
block. Modül yoksa kapı yoktur (None). kapı çalışamazsa dış teslim DURUR (kapı kapalı değilse `block`,
`error: true`); kullanıcı ancak gerekçe yazarak "yine de teslim et" diyebilir.
"""

from __future__ import annotations

import inspect
import logging
from typing import Any

log = logging.getLogger("studio.delivery.quality")
GATE_ERROR_BLOCK = ("Kalite kapısı çalıştırılamadı; dış hedefe teslim bu yüzden durduruldu. İçeriği kontrol edip yine "
                    "de teslim etmek için gerekçe yaz.")
GATE_ERROR_WARN = "Kalite kapısı çalıştırılamadı"


def _mode_safe(q: Any, studio: Any) -> str:
    try:
        return str(q.gate_mode(studio, "external"))
    except Exception:  # noqa: BLE001 - kip okunamıyorsa en temkinlisi
        return "block"


async def _maybe(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


def _module() -> Any:
    import importlib
    try:
        return importlib.import_module("studio.quality")
    except ImportError:
        return None


async def check(studio: Any, item: dict[str, Any], text: str | None, *, external: bool) -> dict[str, Any] | None:
    q = _module()
    if q is None:
        return None
    try:
        mode = await _maybe(q.gate_mode(studio, "external" if external else "internal"))             if hasattr(q, "gate_mode") else None
        report = None
        if mode == "off":
            report = {}
        elif hasattr(q, "assess"):
            # studio biçimi: kayıtlı rapor yalnızca içerik özeti (content_hash) tutuyorsa döner, yoksa yeniden denetler
            rep = await _maybe(q.assess(studio, item["id"]))
            report = rep.to_dict() if hasattr(rep, "to_dict") else rep
        elif hasattr(q, "latest_report"):
            report = await _maybe(q.latest_report(studio.store, item["id"]))
        if hasattr(report, "to_dict"):
            report = report.to_dict()
        report = report if isinstance(report, dict) else {}
        if hasattr(q, "gate_decision"):
            decision = await _maybe(q.gate_decision(report, target="external" if external else "internal",
                                                    settings=studio.settings))
        else:
            decision = {"action": "pass" if report.get("passed", True) else "warn", "reasons": []}
        decision = decision if isinstance(decision, dict) else {"action": "pass"}
    except Exception as exc:  # noqa: BLE001 - dış teslimde kapı hatası güvenli tarafta kalır (durdurur)
        log.warning("kalite kapısı çalıştırılamadı: %s", exc)
        closed = external and _mode_safe(q, studio) != "off"
        return {"action": "block" if closed else "warn", "error": True,
                "reasons": [GATE_ERROR_BLOCK if closed else GATE_ERROR_WARN]}
    action = str(decision.get("action") or "pass")
    if action not in ("pass", "warn", "block"):
        action = "warn"
    return {"action": action, "reasons": [str(r) for r in decision.get("reasons") or []][:10],
            "score": report.get("score"), "status": report.get("status"), "summary": report.get("summary"),
            "accepted_anyway": bool(report.get("accepted_anyway"))}


async def accept_anyway(studio: Any, deliverable_id: str, reason: str) -> None:
    q = _module()
    if q is None or not hasattr(q, "accept_anyway"):
        return
    try:
        await _maybe(q.accept_anyway(studio, deliverable_id, reason))
    except Exception as exc:  # noqa: BLE001
        log.warning("kalite raporu 'yine de kabul' işaretlenemedi: %s", exc)
