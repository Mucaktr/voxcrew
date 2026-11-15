"""Koşu ve adım durum sabitleri + A2A eşlemesi ( "tek yerde").

Durumlar serbest dizgidir (ontoloji enum tutmaz); burada adlandırılır ki motor, API ve testler aynı adları kullansın.
A2A 1.0 görev durumları: submitted · working · input-required · completed · canceled · failed · rejected · unknown.
"""

from __future__ import annotations

# ---- koşu
RUN_RUNNING = "running"
RUN_PAUSED = "paused"            # kullanıcı/bütçe duraklattı; canlı durum bellekte, devam edilebilir
RUN_INTERRUPTED = "interrupted"  # sunucu yeniden başladı; checkpoint'ten devam edilebilir
RUN_DONE = "done"
RUN_FAILED = "failed"
RUN_CANCELLED = "cancelled"

RUN_TERMINAL = frozenset({RUN_DONE, RUN_FAILED, RUN_CANCELLED})
RUN_RESUMABLE = frozenset({RUN_PAUSED, RUN_INTERRUPTED})
RUN_SUSPENDED = RUN_RESUMABLE

# ---- adım
STEP_PENDING = "pending"
STEP_RUNNING = "running"
STEP_AWAITING = "awaiting_approval"
STEP_AWAITING_TOOL = "awaiting_tool_approval"
STEP_DONE = "done"
STEP_FAILED = "failed"
STEP_SKIPPED = "skipped"
STEP_REJECTED = "rejected"
STEP_CANCELLED = "cancelled"

STEP_TERMINAL = frozenset({STEP_DONE, STEP_FAILED, STEP_SKIPPED, STEP_REJECTED, STEP_CANCELLED})
STEP_WAITING = frozenset({STEP_AWAITING, STEP_AWAITING_TOOL})
# Devamda "pending"e dönen (baştan çalışacak) adım durumları
STEP_RESETTABLE = frozenset({STEP_RUNNING, STEP_AWAITING, STEP_AWAITING_TOOL})

_A2A = {
    RUN_RUNNING: "working", STEP_RUNNING: "working",
    STEP_PENDING: "submitted",
    RUN_PAUSED: "input-required", RUN_INTERRUPTED: "input-required",
    STEP_AWAITING: "input-required", STEP_AWAITING_TOOL: "input-required",
    RUN_DONE: "completed",
    RUN_FAILED: "failed",
    RUN_CANCELLED: "canceled", STEP_SKIPPED: "canceled",
    STEP_REJECTED: "rejected",
}


def to_a2a(status: str | None) -> str:
    """Yerel durum → A2A görev durumu; bilinmeyen için "unknown"."""
    return _A2A.get(str(status or ""), "unknown")


def is_terminal(status: str | None) -> bool:
    return status in STEP_TERMINAL
