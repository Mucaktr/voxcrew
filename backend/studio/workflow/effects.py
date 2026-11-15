"""Dış etki günlüğü ve idempotency anahtarları (paket kararı A4 →).

Dış etkisi olan adım eylemleri (araç çağrısı, dosya yazma, işe alım, mesaj) `Effect` olarak kaydedilir:
`{id, step, kind, idempotency_key, status: pending | applied | unknown | acknowledged, detail, at}`.
- `pending`: başladı, sonucu gelmedi. Koşu bu sırada duraklar/kesilirse `unknown` olur.
- `applied`: tamamlandı; devam/yeniden denemede **tekrarlanmaz** (motor kendi yürüttüğü etkilerde — işe alım —
  anahtarı bulunca eylemi atlar; ajanın araç/dosya etkileri için isteme "zaten uygulandı" notu düşülür).
- `unknown`: sonucu belirsiz; adım yeniden çalışmadan önce kullanıcıya "etkisi belirsiz — yine de devam?" onayı
  sorulur (dinamik approval adımı). Onaylanınca `acknowledged`.
Kayıt Run.checkpoint içinde taşınır ve `step.effect` olayı olarak run_events'e yazılır.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import asdict, dataclass
from typing import Any

from studio.graph.store import now_iso

KINDS = ("tool", "file", "hire", "message", "workdir")
PENDING, APPLIED, UNKNOWN, ACKNOWLEDGED = "pending", "applied", "unknown", "acknowledged"


def idempotency_key(step: str, kind: str, *parts: Any) -> str:
    """Denemeler arasında sabit anahtar: adım + tür + içerik özeti (deneme numarası girmez)."""
    raw = json.dumps([str(p) for p in parts], ensure_ascii=False, sort_keys=True)
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]
    return f"{step}:{kind}:{digest}"


@dataclass
class Effect:
    id: str
    step: str
    kind: str
    idempotency_key: str
    status: str = PENDING
    detail: str = ""
    at: str = ""
    attempt: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Effect":
        return cls(id=str(d.get("id") or f"eff_{uuid.uuid4().hex[:10]}"), step=str(d.get("step") or ""),
                   kind=str(d.get("kind") or "tool"), idempotency_key=str(d.get("idempotency_key") or ""),
                   status=str(d.get("status") or PENDING), detail=str(d.get("detail") or "")[:400],
                   at=str(d.get("at") or ""), attempt=int(d.get("attempt") or 0))


class EffectLog:
    """Koşu başına etki kaydı (anahtar → Effect)."""

    def __init__(self, items: list[dict[str, Any]] | None = None):
        self.items: dict[str, Effect] = {}
        for raw in items or []:
            if isinstance(raw, dict) and raw.get("idempotency_key"):
                e = Effect.from_dict(raw)
                self.items[e.idempotency_key] = e

    def get(self, key: str) -> Effect | None:
        return self.items.get(key)

    def applied(self, key: str) -> bool:
        e = self.items.get(key)
        return bool(e and e.status == APPLIED)

    def begin(self, step: str, kind: str, key: str, detail: str = "", attempt: int = 0) -> Effect:
        """Etkiyi `pending` olarak kaydeder; zaten `applied` ise dokunmaz (idempotent)."""
        e = self.items.get(key)
        if e and e.status == APPLIED:
            return e
        e = Effect(id=f"eff_{uuid.uuid4().hex[:10]}", step=step, kind=kind, idempotency_key=key, status=PENDING,
                   detail=detail[:400], at=now_iso(), attempt=attempt)
        self.items[key] = e
        return e

    def apply(self, key: str, detail: str | None = None) -> Effect | None:
        e = self.items.get(key)
        if e is None:
            return None
        e.status, e.at = APPLIED, now_iso()
        if detail is not None:
            e.detail = detail[:400]
        return e

    def record_applied(self, step: str, kind: str, key: str, detail: str = "", attempt: int = 0) -> Effect:
        e = self.begin(step, kind, key, detail, attempt)
        if e.status != APPLIED:
            self.apply(key)
        return e

    def mark_unknown(self, step: str | None = None, kinds: tuple[str, ...] | None = None) -> list[Effect]:
        """Bekleyen etkiler (isteğe bağlı: tek adımın, yalnız `kinds` türlerinin) → unknown. Döndürülen liste değişenler."""
        out = []
        for e in self.items.values():
            if e.status == PENDING and (step is None or e.step == step) and (kinds is None or e.kind in kinds):
                e.status, e.at = UNKNOWN, now_iso()
                out.append(e)
        return out

    def unknown_for(self, step: str) -> list[Effect]:
        return [e for e in self.items.values() if e.step == step and e.status == UNKNOWN]

    def acknowledge(self, step: str) -> list[Effect]:
        out = []
        for e in self.unknown_for(step):
            e.status, e.at = ACKNOWLEDGED, now_iso()
            out.append(e)
        return out

    def applied_for(self, step: str) -> list[Effect]:
        return [e for e in self.items.values() if e.step == step and e.status == APPLIED]

    def for_step(self, step: str) -> list[dict[str, Any]]:
        return [e.to_dict() for e in self.items.values() if e.step == step]

    def to_list(self) -> list[dict[str, Any]]:
        return [e.to_dict() for e in self.items.values()]

    def __len__(self) -> int:
        return len(self.items)
