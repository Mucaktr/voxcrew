"""Tek olay türü kaydı (Faz B-1): olay yolunda (`EventBus.publish`) yayınlanan her tür burada kayıtlıdır.

Önceden aynı bilgi elle kopyalanmıştı: `events.py` (sınıflandırma), `workflow/engine.py` (`PERSIST_EVENTS`) ve arayüzde
dört dosya. Artık:
- `events.py` sınıflandırmayı (DROPPABLE / CRITICAL_*) buradan alır, motorun `PERSIST_EVENTS`'i `RUN_PERSISTED`'dır.
- Arayüz listesi `frontend/src/lib/eventTypes.gen.ts` bu modülden üretilir (`python -m studio.event_types --write`);
  `GET /api/events/types` aynı kaydı döner. `tests/test_event_types.py` üretilmiş dosyanın güncel olduğunu,
  kaynakta yayınlanan her türün kayıtlı olduğunu denetler; `EventBus` çalışırken kayıtsız türü `unregistered()`a yazar
  (Sistem sağlığı değişmezi; test oturumu sonunda conftest kayıtsız tür görürse oturumu düşürür).

Kayıt kuralı: tür ya tam olarak listelenmiştir ya da ad alanı (`game.` gibi) `OPEN_FAMILIES`'tedir. Açık aileler yalnız
türünü çalışma anında kuran üreticiler içindir (oyun/pazar/yürüyüş defterleri); kritik ad alanları (koşu, adım, bütçe…)
KAPALIDIR: her tür tek tek yazılmalı.
"""

from __future__ import annotations

import json
import sys
import threading
from pathlib import Path

# Üretilmiş arayüz kaydı (depo kökünden frontend/src/lib/eventTypes.gen.ts)
GEN_TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "eventTypes.gen.ts"

# Taşmada atılabilir olaylar: anlık durum / akış. Kalıcı günlüğe yazılmaz.
DROPPABLE = frozenset({"agent.state", "step.delta", "step.thought", "memory.processing", "clients.seen",
                       "game.sync"})

# Kritik (kalıcı + yeniden gönderilebilir) olaylar: önekler ve tek tek türler.
CRITICAL_PREFIXES: tuple[str, ...] = (
    "run.", "approval", "budget.", "goal.", "orchestrate.",
    # Faz 6 (diğer ekiplerin yayınladığı önekler)
    "message.", "schedule.", "acceptance.", "eval.", "guard.",
)
CRITICAL_TYPES = frozenset({
    # adım yaşam döngüsü ve kararlar
    "step.started", "step.finished", "step.awaiting", "step.decided", "step.ask", "step.tool_approval",
    "step.tool_approval_resolved", "step.error", "step.failed", "step.retried", "step.retry_scheduled", "step.added", "step.plan",
    "connection.degraded", "agent.hired", "handoff",
    # koşu başına kalıcı (run_events) ayrıntılar: replay'de koşu ekranı eksiksiz kalsın
    "step.tool", "step.tool_result", "step.recalled", "step.round", "step.warning", "step.artifacts", "step.effect",
    "step.prompt", "step.dispatched", "memory.updated",
    # G4-REST: devamda sürüm manifesti farkı (uyarı / onay durumu)
    "manifest.diff",
    # önceki denemeden tekrar kullanım ve baştan çalıştırma (yeniden başlatmadan sonra izde)
    "step.tool_reused", "step.fresh",
})

# Motorun koşu başına `studio.db.run_events`'e de yazdığı türler (eski `workflow.engine.PERSIST_EVENTS`).
RUN_PERSISTED = frozenset({
    "run.started", "run.finished", "step.started", "step.finished", "step.tool",
    "step.tool_result", "step.recalled", "step.awaiting", "step.decided", "step.round",
    "step.error", "memory.updated", "step.artifacts", "handoff",
    "step.tool_approval", "step.tool_approval_resolved", "step.warning",
    # Faz 3: devretme
    "step.added", "step.plan", "agent.hired",
    # Faz 6: dayanıklılık, politika, bütçe
    "run.paused", "run.resumed", "run.forked", "step.retried", "step.retry_scheduled",
    "connection.degraded", "budget.warning", "budget.exceeded", "budget.updated", "step.effect",
    "budget.overrun",  # PROC-FIX çıktısı korunan aşım
    "budget.partial_kept",  # PROC2-FIX P1: adım sürerken durdurulan denemenin yarım çıktısı korundu
    # S26 iz görünümü: istem raporu ve kuyruk bekleme / sağlayıcı gecikmesi ayrımı
    "step.prompt", "step.dispatched",
    # S24 orkestratör: plan / yeniden plan turları ve insan kapısı
    "orchestrate.plan", "orchestrate.replan", "orchestrate.gate",
    # G1-B: iptal isteği ve iptal uzlaştırma özeti (`run.late_event` bilerek kalıcı DEĞİL)
    "run.cancel_requested", "run.cancel_reconciled",
    # atomik bütçe rezervasyonu
    "budget.reserved", "budget.settled", "budget.released",
    # mutlak koşu süresi doldu
    "run.deadline",
    # G4-REST: devamda sürüm manifesti farkı (uyarı / onay)
    "manifest.diff",
    # hata taksonomisi
    "step.failed", "run.failed",
    "step.tool_reused", "budget.runaway", "step.fresh", "budget.card_closed",
    "budget.estimated_unrecorded",
    "run.crashed", "budget.unrecorded_possible",
})

# Kritik öneklerin altındaki, yukarıda tek tek yazılmamış türler (kapalı ad alanı: hepsi burada).
CRITICAL_OTHER = frozenset({
    "acceptance.revision_requested", "acceptance.updated", "budget.covered", "budget.daily",
    "eval.finished", "eval.matrix.finished", "eval.matrix.progress", "eval.matrix.started", "eval.progress",
    "eval.started", "goal.completed", "goal.created", "goal.deleted", "goal.run_finished", "goal.updated",
    "guard.flagged", "message.read", "message.sent", "orchestrate.monitor", "run.late_event", "run.pausing",
    "schedule.changed", "schedule.denied", "schedule.fired", "schedule.heartbeat", "schedule.paused_run",
    "schedule.skipped",
})

# Diğer bildirimler: atılmaz ama kalıcı da değildir (ayar, ofis, oyun, teslim…).
NOTICE = frozenset({
    "academy.lesson_done", "academy.settings", "account.changed", "admin.changed", "agent.claude_isolation",
    "agent.codex_isolation", "agent.removed", "agent.updated", "artifact_exported", "artifact_opened",
    "bizdev.changed", "boost.agent_changed", "boost.changed", "boost.gate.finished", "boost.gate.progress",
    "boost.gate.started", "boost.saved", "boost.settings", "clients.delete_refused", "config.changed",
    "connection.changed", "connection.job", "defaults.budget", "deliverable.quality", "deliverable.ready",
    "deliverable.revealed", "deliverable.revision", "deliverable.updated", "deliverable.zipped", "delivery.done",
    "ext.activity", "ext.ended", "ext.session", "ext.settings", "game.achievement", "game.chest", "game.levelup",
    "game.quest", "game.season", "game.settings", "game.surprise", "game.unlock", "game.xp", "gateway.changed",
    "graph.changed", "hero.recruited", "market.installed", "market.sources", "market.uninstalled", "memory.fact",
    "memory.forget_undone", "memory.forgotten", "messaging.policy", "metrics.erased", "office.changed",
    "plan.changed", "recognition.deleted", "recognition.given", "recognition.settings", "recognition.team_lunch",
    "recognition.updated", "recognition.weekly_pick", "safe_mode.changed", "scene.changed", "seat.changed",
    "share.imported", "skills.assigned", "skills.changed", "step.continued", "step.gate", "step.held",
    "step.invocation", "system.call", "tools.changed", "tools.probed", "ui.presence", "walk.avatar", "walk.cards",
    "walk.city", "walk.collected", "walk.discovered", "walk.explored", "walk.fish", "walk.minigame", "walk.ritual",
    "workzone.changed", "worlds.changed",
    # Faz B-1: Sistem sağlığı eşik uyarısı (arayüz bildirim akışına düşer)
    "health.alert",
})

# SSE katmanının kendi çerçeveleri ve arayüzün sentetik olayı (olay yolundan geçmez ama arayüz dinler).
SYNTHETIC = frozenset({"hello", "resync_required", "resync.full"})

# Türünü çalışma anında kuran üreticilerin ad alanları (defterden dönen (tür, yük) listeleri).
OPEN_FAMILIES: tuple[str, ...] = (
    "academy.", "account.", "deliverable.", "delivery.", "ext.", "game.", "market.", "recognition.", "walk.",
    "cosmetics.", "chest.", "seat.", "plan.", "tools.",
)

ALL = frozenset(DROPPABLE | CRITICAL_TYPES | RUN_PERSISTED | CRITICAL_OTHER | NOTICE | SYNTHETIC)

_lock = threading.Lock()
_unregistered: dict[str, int] = {}
_known: dict[str, bool] = {}


def is_registered(type_: str | None) -> bool:
    if not type_:
        return False
    hit = _known.get(type_)
    if hit is None:
        hit = type_ in ALL or type_.startswith(OPEN_FAMILIES)
        if len(_known) < 4096:
            _known[type_] = hit
    return hit


def note(type_: str | None) -> None:
    """Olay yolu her yayında çağırır: kayıtsız tür sayılır (Sistem sağlığı + test oturumu denetimi)."""
    if is_registered(type_):
        return
    with _lock:
        key = str(type_)[:120]
        if key in _unregistered or len(_unregistered) < 256:
            _unregistered[key] = _unregistered.get(key, 0) + 1


def unregistered() -> dict[str, int]:
    with _lock:
        return dict(_unregistered)


def reset_unregistered() -> None:
    with _lock:
        _unregistered.clear()


def classify(type_: str) -> str:
    if type_ in SYNTHETIC:
        return "synthetic"
    if type_ in DROPPABLE:
        return "droppable"
    if type_ in CRITICAL_TYPES or type_.startswith(CRITICAL_PREFIXES):
        return "critical"
    return "notice"


def registry() -> dict:
    """`GET /api/events/types` ve üretilmiş TS dosyasının ortak gövdesi."""
    return {"types": {t: {"class": classify(t), "run_persisted": t in RUN_PERSISTED} for t in sorted(ALL)},
            "critical_prefixes": list(CRITICAL_PREFIXES), "open_families": list(OPEN_FAMILIES)}


def render_ts() -> str:
    reg = registry()
    types = list(reg["types"])
    lines = ["// ÜRETİLMİŞ DOSYA — elle düzenleme. Kaynak: backend/studio/event_types.py",
             "// Yeniden üret: (backend) python -m studio.event_types --write",
             "export const EVENT_TYPES = " + json.dumps(types, ensure_ascii=False, indent=2) + " as const;",
             "export type EventType = (typeof EVENT_TYPES)[number];",
             "export const EVENT_CLASS: Record<EventType, string> = "
             + json.dumps({t: v["class"] for t, v in reg["types"].items()}, ensure_ascii=False, indent=2) + ";",
             "export const CRITICAL_PREFIXES = " + json.dumps(reg["critical_prefixes"]) + " as const;",
             "export const OPEN_FAMILIES = " + json.dumps(reg["open_families"]) + " as const;",
             "/** registerEventHandler önekleri: kayıtlı bir türün kendisi ya da öneki olmalı (scripts/event_types.test.mjs). */",
             "export function isKnownEventPattern(p: string): boolean {",
             "  return (EVENT_TYPES as readonly string[]).some((t) => t.startsWith(p)) || OPEN_FAMILIES.some((f) => p.startsWith(f) || f.startsWith(p));",
             "}",
             ""]
    return "\n".join(lines)


if __name__ == "__main__":  # pragma: no cover - üretim yardımcısı
    if "--write" in sys.argv:
        GEN_TS.write_text(render_ts(), encoding="utf-8", newline="\n")
        print(GEN_TS)
    else:
        print(json.dumps(registry(), ensure_ascii=False, indent=2))
