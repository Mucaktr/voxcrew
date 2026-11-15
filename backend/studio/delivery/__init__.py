"""Çıktı teslimi (CG-DELIVER, dalga 1): sonuç, işin yapıldığı yere kullanıcının onayıyla gider.

Hedefler: yerel klasör, e-posta taslağı (.eml / mailto / posta MCP taslağı; asla gönderim yok), GitHub PR / issue
(kullanıcının `gh` CLI'si), Notion / Google Docs / Slack (yalnızca kullanıcının MCP sunucuları), pano ve indirme.

Diğer ekipler için kancalar (isteğe bağlı içe aktarma):
- `TARGET_IDS`, `targets(studio)` → hedefler ve hazır olma durumu (eşzamansız),
- `list_targets` → `[{kind, ready, reason, label, external}]` (eşzamanlı; uygulama açıldıktan sonra tam liste),
- `suggest_targets(run_id, [{kind, label?, options?}])` → tarifin önerdiği hedefler (yalnızca ön seçim; teslim etmez),
- `normalize_default(value)` → tarif `delivery` değerini doğrular,
- `preview(studio, deliverable_id, target, options)` ve `deliver(studio, …)` (yalnızca kullanıcı rotasından çağrılır).
"""

from __future__ import annotations

from typing import Any

from studio.delivery.adapters import ADAPTERS, ALIASES

TARGET_IDS: tuple[str, ...] = tuple(ADAPTERS)
_STUDIO: list[Any] = []


def bind(studio: Any) -> None:
    _STUDIO[:] = [studio]


def _svc(studio: Any) -> Any:
    from studio.delivery.api import get_service
    return get_service(studio)


async def targets(studio: Any, *, deliverable_id: str | None = None, check: bool = False) -> list[dict[str, Any]]:
    return (await _svc(studio).targets(deliverable_id=deliverable_id, check=check))["targets"]


def list_targets() -> list[dict[str, Any]]:
    """Eşzamanlı, süreç başlatmayan özet (tarif arayüzü için). MCP hedefleri ayarlı sunuculara göre hazırdır."""
    from studio.delivery.adapters import exe, mcp_services
    studio = _STUDIO[0] if _STUDIO else None
    services = mcp_services(studio) if studio is not None else []
    out = []
    for tid, a in ADAPTERS.items():
        if tid.startswith("github_"):
            ready, reason = exe("gh") is not None, None if exe("gh") else "GitHub CLI (`gh`) kurulu değil"
        elif tid in ("notion", "gdocs", "slack"):
            ok = [s for s in services if s["service"] == tid and s["ready"]]
            ready, reason = bool(ok), None if ok else "MCP ile bağlan (Bağlantılar sayfası)"
        else:
            ready, reason = True, None
        out.append({"kind": tid, "ready": ready, "reason": reason, "label": a.label, "external": a.external})
    return out


def suggest_targets(run_id: str, targets_: list[dict[str, Any]]) -> None:
    from studio.delivery.service import suggest
    suggest(run_id, targets_)


def normalize_default(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    tid = str(value.get("target") or value.get("kind") or "")
    tid = ALIASES.get(tid, tid)
    if tid not in ADAPTERS:
        return None
    opts = value.get("options")
    return {"target": tid, "options": opts if isinstance(opts, dict) else {}}


async def preview(studio: Any, deliverable_id: str, target: str, options: dict[str, Any]) -> dict[str, Any]:
    return await _svc(studio).preview(deliverable_id, target, options)


async def deliver(studio: Any, deliverable_id: str, target: str, options: dict[str, Any], preview_hash: str,
                  override_reason: str | None = None, *, approved: bool = False) -> dict[str, Any]:
    """Yalnızca kullanıcıya ait rotadan, arayüzdeki onaydan sonra çağrılır (`approved=True` açıkça verilmeli)."""
    return await _svc(studio).deliver(deliverable_id, target, options, preview_hash_=preview_hash,
                                      approved=approved, override_reason=override_reason)
