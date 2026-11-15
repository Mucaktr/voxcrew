"""Hata taksonomisi (Rehber 1 §16.4, MAST uyarlaması): başarısız ya da kısmen başarısız koşu ve adıma
sabit kümeden bir `error_class`.

Sınıflama DETERMİNİSTİKTİR ve yalnız motorun zaten bildiğinden çıkar (model çağrısı yok). Motor her hata yolunda
bir **neden anahtarı** (`cause`) verir; anahtar yoksa adım bağlamından (`infer_step`) türetilir. Eşleme toplamdır:
bilinmeyen anahtar ya da çıkarılamayan durum `unknown` olur, `None` hiçbir hata yolunda kalmaz.

Eşleme tablosu (`CAUSES`; belge:):

| Neden anahtarı | Sınıf | Motor yolu |
|---|---|---|
| `budget.stop`, `budget.rejected`, `budget.daily_rejected`, `budget.partial`, `deadline` | budget | bütçe kartı ret / durdur, günlük tavan, kısmi çıktıyla devam, mutlak süre |
| `connector.error`, `connector.timeout`, `connector.missing`, `route.error`, `connector.empty`, `exception.io` | infrastructure | bağlayıcı süreç çöktü, zaman aşımı, ağ, bağlayıcı/rota yok, boş çıktı |
| `tool.error` | tool | bağlayıcının bildirdiği araç hatası ya da başarısız araç sonucu |
| `review.rejected`, `acceptance.failed` | verification | kullanıcı/onay kapısı çıktıyı reddetti, zorunlu kabul kontrolü kaldı |
| `output_schema`, `agent.missing`, `role.missing`, `exception.contract` | contract | çıktı şeması uymadı, akışın andığı ajan/rol yok, ontoloji/şema hatası |
| `plan.invalid`, `plan.rejected`, `replan.limit`, `gate.rejected_before` | plan | yönetici geçerli plan üretemedi, plan reddedildi, yeniden plan sınırı |
| `delegate.children`, `delegate.synthesis`, `delegate.partial`, `handler.delegate` | handoff | devretme: alt görevler ya da sentez tamamlanamadı |
| `recall.error` | retrieval | bellek geri çağırma hata verdi |
| `decision.timeout` | interface | araç onayı / karar kartı süresinde yanıtlanmadı |
| `exception`, bilinmeyen | unknown | sınıflanamayan istisna |
| `class:<sınıf>` | o sınıf | bağlayıcı hata olayında açık `error_class` işareti (ya da on_fail kararında önceki sınıf) |
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

ERROR_CLASSES: tuple[str, ...] = ("contract", "plan", "handoff", "retrieval", "tool", "verification", "budget",
                                  "infrastructure", "interface", "unknown")

LABELS: dict[str, dict[str, str]] = {
    "contract": {"tr": "sözleşme", "en": "contract"},
    "plan": {"tr": "plan", "en": "plan"},
    "handoff": {"tr": "devretme", "en": "handoff"},
    "retrieval": {"tr": "getirme", "en": "retrieval"},
    "tool": {"tr": "araç", "en": "tool"},
    "verification": {"tr": "doğrulama", "en": "verification"},
    "budget": {"tr": "bütçe", "en": "budget"},
    "infrastructure": {"tr": "altyapı", "en": "infrastructure"},
    "interface": {"tr": "arayüz", "en": "interface"},
    "unknown": {"tr": "bilinmiyor", "en": "unknown"},
}

# neden anahtarı → sınıf (tek doğruluk kaynağı; testler toplamlığı denetler)
CAUSES: dict[str, str] = {
    # bütçe
    "budget.stop": "budget", "budget.rejected": "budget", "budget.daily_rejected": "budget", "deadline": "budget",
    "budget.partial": "budget",  # kullanıcı bütçe kartında kısmi çıktıyla devam etti (adım eksik olabilir)
    # altyapı
    "connector.error": "infrastructure", "connector.timeout": "infrastructure", "connector.missing": "infrastructure",
    "connector.empty": "infrastructure", "route.error": "infrastructure", "exception.io": "infrastructure",
    # araç
    "tool.error": "tool",
    # doğrulama
    "review.rejected": "verification", "acceptance.failed": "verification",
    # sözleşme
    "output_schema": "contract", "agent.missing": "contract", "role.missing": "contract",
    "exception.contract": "contract",
    # plan
    "plan.invalid": "plan", "plan.rejected": "plan", "replan.limit": "plan", "gate.rejected_before": "plan",
    # devretme
    "delegate.children": "handoff", "delegate.synthesis": "handoff", "delegate.partial": "handoff",
    "handler.delegate": "handoff",
    # getirme
    "recall.error": "retrieval",
    # arayüz
    "decision.timeout": "interface",
    # bilinmiyor
    "exception": "unknown",
}

FAILED_STATUSES = ("failed", "rejected")
DELEGATION_TYPES = ("delegate", "orchestrate", "handoff")
PLAN_KINDS = ("plan", "replan")
_IO_EXC = ("TimeoutError", "ConnectionError", "ConnectionResetError", "ConnectionRefusedError", "BrokenPipeError",
           "OSError", "FileNotFoundError", "PermissionError", "CancelledError", "ProcessLookupError")
_CONTRACT_EXC = ("OntologyError", "ValidationError", "SpecError", "JSONDecodeError")


def valid(cls: Any) -> bool:
    return isinstance(cls, str) and cls in ERROR_CLASSES


def of_cause(cause: str | None) -> str:
    """Neden anahtarı → sınıf; `class:<sınıf>` (bağlayıcının açık işareti) doğrudan; bilinmeyen anahtar `unknown`."""
    key = str(cause or "")
    if key.startswith("class:") and valid(key[6:]):
        return key[6:]
    return CAUSES.get(key, "unknown")


def label(cls: str | None, lang: str = "tr") -> str:
    row = LABELS.get(str(cls or ""), LABELS["unknown"])
    return row.get(lang, row["tr"])


def of_exception(exc: BaseException | str | None) -> str:
    """İstisna türünden neden anahtarı (yalnız tür adı; ileti okunmaz)."""
    name = exc if isinstance(exc, str) else type(exc).__name__ if exc is not None else ""
    if name in _IO_EXC:
        return "exception.io"
    if name in _CONTRACT_EXC:
        return "exception.contract"
    return "exception"


def of_connector(error_events: Iterable[Mapping[str, Any]], tools: Iterable[Mapping[str, Any]], *,
                 timed_out: bool = False, decision_timeout: bool = False) -> str:
    """Bağlayıcı denemesi başarısız: neden anahtarı. Sıra: bağlayıcının açık `error_class` işareti → karar zaman aşımı
    (arayüz) → adım zaman aşımı (altyapı) → araç işaretli hata olayı → son araç sonucu başarısız (araç) → hata olayı
    var (süreç/ağ; altyapı) → boş çıktı (altyapı)."""
    events = [e for e in error_events if isinstance(e, Mapping)]
    for e in events:
        hinted = e.get("error_class")
        if valid(hinted):
            return f"class:{hinted}"
    if decision_timeout:
        return "decision.timeout"
    if timed_out:
        return "connector.timeout"
    if any(e.get("tool") or e.get("kind") == "tool" for e in events):
        return "tool.error"
    last = [t for t in tools if isinstance(t, Mapping) and t.get("ok") is not None]
    if last and last[-1].get("ok") is False:
        return "tool.error"
    if events:
        return "connector.error"
    return "connector.empty"


def infer_step(status: str, *, step_type: str | None = None, kind: str | None = None,
               error_events: Iterable[Mapping[str, Any]] = (), tools: Iterable[Mapping[str, Any]] = (),
               deadline: bool = False, decision_timeout: bool = False) -> str:
    """Açık neden verilmediğinde adım bağlamından neden anahtarı (deterministik)."""
    if deadline:
        return "deadline"
    if status == "rejected":
        if kind == "budget":
            return "budget.rejected"
        if kind in PLAN_KINDS:
            return "plan.rejected"
        return "review.rejected"
    events = list(error_events)
    if events or decision_timeout:
        return of_connector(events, tools, decision_timeout=decision_timeout)
    if kind in PLAN_KINDS:
        return "plan.invalid"
    if step_type in DELEGATION_TYPES:
        return "handler.delegate"
    return "exception"


def run_class(status: str, steps: Iterable[Mapping[str, Any]], *, deadline: bool = False,
              stopped_by_budget: bool = False) -> str | None:
    """Koşu sınıfı. `failed`: süre/bütçe durdurması; değilse kök (üst düzey) başarısız/reddedilen ilk adımın sınıfı
    (bitiş sırasına göre), o da yoksa herhangi bir sınıflı adım, o da yoksa `unknown`. `done` ama sınıflı adım var
    (on_fail skip/continue, kısmen başarısız devretme) → kısmi: ilk sınıflı adımın sınıfı. Diğer durumlar → None."""
    rows = [s for s in steps if isinstance(s, Mapping)]
    order = sorted(rows, key=lambda s: str(s.get("finished_at") or "~"))
    if status == "failed":
        if deadline:
            return "budget"
        if stopped_by_budget:
            return "budget"
        top = [s for s in order if not s.get("parent") and s.get("status") in FAILED_STATUSES]
        for s in top:
            if valid(s.get("error_class")):
                return str(s["error_class"])
        for s in order:
            if valid(s.get("error_class")) and s.get("status") in FAILED_STATUSES:
                return str(s["error_class"])
        return "unknown"
    if status == "done":
        for s in order:
            if valid(s.get("error_class")) and (s.get("soft_fail") or s.get("status") in ("done", "skipped")):
                return str(s["error_class"])
    return None


def counts(values: Iterable[Any]) -> dict[str, int]:
    """Sınıf başına sayım; her sınıf (0 dahil) yer alır, geçersiz değer `unknown` sayılır."""
    out = {c: 0 for c in ERROR_CLASSES}
    for v in values:
        out[v if valid(v) else "unknown"] += 1
    return out
