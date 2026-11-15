"""Kalite kapısı (CG-QUALITY): teslimden önce ikinci, denetleyen göz.

Diğer ekiplerin kancaları (hepsi isteğe bağlı içe aktarmayla kullanılır):

- `assess(deliverable_dict, spec=None, *, text=None, settings=None, studio=None) -> QualityReport`
  Kalıcılık olmadan deterministik denetim (`text` verilmezse ve `studio` varsa çıktının maskeli metni okunur).
- `assess(studio, deliverable_id) -> dict` — kayıtlı raporu döner (içerik değiştiyse yeniden denetleyip bağlar):
  `{passed, score, summary, issues, status, accepted_anyway, report_id, checks, findings, reviewer}`.
- `latest_report(store, deliverable_id) -> dict | None`
- `gate_decision(report, *, target="external", settings=None) -> {"action": pass|warn|block, "reasons": [...]}`
- `gate_mode(studio, target="external") -> "off" | "warn" | "block"`
- `accept_anyway(studio, deliverable_id, reason) -> dict` (yalnız kullanıcıya ait uçlardan çağrılır)
- `quality_required(spec) -> bool`, `register_checklist(run_id, checklist)` (CG-RECIPES)
"""

from __future__ import annotations

from typing import Any

from studio.quality.report import QualityReport
from studio.quality.spec import normalize as normalize_spec
from studio.quality.spec import quality_required, register_checklist

__all__ = ["QualityReport", "accept_anyway", "assess", "gate_decision", "gate_mode", "latest_report",
           "normalize_spec", "quality_required", "register_checklist", "attach"]


def _is_studio(obj: Any) -> bool:
    return hasattr(obj, "store") and hasattr(obj, "engine") and not isinstance(obj, dict)


def assess(target: Any, spec: Any = None, *, text: str | None = None, settings: Any = None,
           studio: Any = None) -> Any:
    from studio.quality.service import evaluate, get_service
    if _is_studio(target):
        svc = get_service(target)
        rep = svc.assess(str(spec), force=False)
        if rep is None:
            return {"passed": True, "score": None, "status": "skipped", "issues": [], "checks": [], "findings": [],
                    "summary": "Metin içermeyen çıktı denetlenmedi", "accepted_anyway": False, "report_id": None,
                    "reviewer": None}
        out = rep.to_dict(svc._lang())
        out["report_id"] = rep.id
        return out
    deliverable = target if isinstance(target, dict) else {}
    if text is None and studio is not None and deliverable.get("id"):
        from studio.quality.service import TEXT_VIEWS
        from studio.deliverables.api import get_service as dsvc
        content = dsvc(studio).content(str(deliverable["id"]))
        text = content.get("text") if content.get("kind") in TEXT_VIEWS else ""
    return evaluate(str(text or ""), spec, deliverable=deliverable)


def latest_report(store: Any, deliverable_id: str) -> dict[str, Any] | None:
    from studio.quality.service import report_id
    node = store.find("QualityReport", report_id(str(deliverable_id)))
    if not node:
        return None
    out = QualityReport.from_props(node["props"]).to_dict()
    out["report_id"] = out.get("id")
    return out


def gate_mode(studio: Any, target: str = "external") -> str:
    from studio.quality.service import get_service
    return get_service(studio).gate_mode(target)


def gate_decision(report: Any, *, target: str = "external", settings: Any = None) -> dict[str, Any]:
    """Teslim kararı. Kapı kapalı → pass; rapor yok → pass (gerekiyorsa çağıran önce `assess` çalıştırır);
    "yine de kabul" → pass; başarısız → kipe göre warn | block; uyarılı → warn."""
    if isinstance(report, QualityReport):
        report = report.to_dict()
    if settings is not None and settings.get("quality.enabled", True) is False:
        mode = "off"
    elif settings is not None:
        key = "quality.gate_external" if target == "external" else "quality.gate"
        mode = str(settings.get(key, "block" if target == "external" else "warn") or "")
    else:
        mode = "block" if target == "external" else "warn"
    if mode not in ("off", "warn", "block"):
        mode = "block" if target == "external" else "warn"
    if mode == "off" or not report:
        return {"action": "pass", "mode": mode, "reasons": []}
    if report.get("accepted_anyway"):
        return {"action": "pass", "mode": mode, "reasons": ["accepted_anyway"], "summary": report.get("summary")}
    issues = report.get("issues") or [f for f in report.get("findings") or [] if not f.get("false_positive")]
    reasons = [str(f.get("message")) for f in issues if f.get("severity") == "error"][:10]
    status = report.get("status")
    if status == "failed":
        return {"action": "block" if mode == "block" else "warn", "mode": mode,
                "reasons": reasons or [str(report.get("summary") or "")], "summary": report.get("summary")}
    if status == "warn":
        return {"action": "warn", "mode": mode, "summary": report.get("summary"),
                "reasons": [str(f.get("message")) for f in issues if f.get("severity") == "warn"][:10]}
    return {"action": "pass", "mode": mode, "reasons": [], "summary": report.get("summary")}


def accept_anyway(studio: Any, deliverable_id: str, reason: str = "") -> dict[str, Any]:
    from studio.quality.service import get_service
    return get_service(studio).accept_anyway(str(deliverable_id), reason).to_dict()


def attach(engine: Any, deliverables: Any = None) -> None:
    """Teslim servisi motor kancasını kurduktan SONRA çağrılır: kalite kancası teslim kaydından sonra çalışır."""
    from studio.quality.service import service_for_engine
    service_for_engine(engine, deliverables).attach(engine)
