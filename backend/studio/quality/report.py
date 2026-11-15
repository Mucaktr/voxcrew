"""`QualityReport`: puan (0–10), denetim sonuçları, konumlu bulgular, denetçi notları ve rozet özeti."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any

STATUSES = ("passed", "warn", "failed")
PENALTY = {"error": 2.0, "warn": 1.0, "info": 0.0}
CHECK_PENALTY_CAP = 3.0        # tek denetimin en çok düşürebileceği puan (25 kaynaksız iddia puanı sıfırlamasın)
FAIL_BELOW = 5.0
# FOLLOWUP (kalibrasyon): yalnız uyarı içeren (hatasız) deterministik rapor ancak puan bunun altına düşerse başarısız
# sayılır — üç ayrı denetimin her biri tavana vurmadıkça uyarılar teslimi engellemez. Denetçi puanı varsa FAIL_BELOW.
WARN_ONLY_FAIL_BELOW = 2.0

# rozet özetinde sayılan bulgu türleri (TR / EN; tekil-çoğul EN'de ayrı)
_LABELS: dict[str, tuple[str, str, str]] = {
    "unsourced_claim": ("kaynaksız iddia", "unsourced claim", "unsourced claims"),
    "missing_section": ("eksik bölüm", "missing section", "missing sections"),
    "placeholder": ("yer tutucu", "placeholder", "placeholders"),
    "empty": ("boş çıktı", "empty output", "empty outputs"),
    "pii": ("olası kişisel veri", "possible personal data", "possible personal data"),
    "malformed_link": ("bozuk bağlantı", "broken link", "broken links"),
    "empty_link": ("bozuk bağlantı", "broken link", "broken links"),
    "undefined_ref": ("bozuk bağlantı", "broken link", "broken links"),
    "too_short": ("uzunluk sorunu", "length issue", "length issues"),
    "too_long": ("uzunluk sorunu", "length issue", "length issues"),
}


def finding_id(f: dict[str, Any]) -> str:
    """Kararlı bulgu kimliği (yeniden denetimde yanlış-pozitif işareti korunur): denetim + kod + satır + kesit."""
    loc = f.get("location") or {}
    key = f"{f.get('check')}|{f.get('code')}|{loc.get('line')}|{loc.get('excerpt') or f.get('message')}"
    return "f_" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]


def content_hash(text: str) -> str:
    return hashlib.sha256(str(text or "").encode("utf-8")).hexdigest()[:24]


@dataclass
class QualityReport:
    deliverable_id: str | None
    checks: list[dict[str, Any]]
    findings: list[dict[str, Any]]
    spec: dict[str, Any] = field(default_factory=dict)
    reviewer: dict[str, Any] | None = None
    content_hash: str | None = None
    created_at: str | None = None
    accepted_anyway: bool = False
    accept_reason: str | None = None
    accepted_at: str | None = None
    revision_run_id: str | None = None
    run_id: str | None = None
    id: str | None = None

    # ------------------------------------------------------------ hesap
    def open_findings(self) -> list[dict[str, Any]]:
        return [f for f in self.findings if not f.get("false_positive")]

    @property
    def deterministic_score(self) -> float:
        by_check: dict[str, float] = {}
        for f in self.open_findings():
            if f.get("source") == "reviewer":
                continue
            by_check[f["check"]] = by_check.get(f["check"], 0.0) + PENALTY.get(f.get("severity", "warn"), 1.0)
        return max(0.0, 10.0 - sum(min(CHECK_PENALTY_CAP, v) for v in by_check.values()))

    @property
    def score(self) -> float:
        det = self.deterministic_score
        rev = (self.reviewer or {}).get("score")
        if isinstance(rev, (int, float)) and (self.reviewer or {}).get("status") == "done":
            return round((det + float(rev)) / 2, 1)
        return round(det, 1)

    @property
    def status(self) -> str:
        open_ = self.open_findings()
        rev = self.reviewer or {}
        reviewed = rev.get("status") == "done" and isinstance(rev.get("score"), (int, float))
        if any(f.get("severity") == "error" for f in open_) or self.score < (FAIL_BELOW if reviewed
                                                                             else WARN_ONLY_FAIL_BELOW):
            return "failed"
        if any(f.get("severity") == "warn" for f in open_):
            return "warn"
        return "passed"

    @property
    def passed(self) -> bool:
        """Kapı geçer mi: başarısız değil ya da kullanıcı "yine de kabul et" dedi."""
        return self.accepted_anyway or self.status != "failed"

    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for f in self.open_findings():
            out[f["code"]] = out.get(f["code"], 0) + 1
        out["errors"] = sum(1 for f in self.open_findings() if f.get("severity") == "error")
        out["warnings"] = sum(1 for f in self.open_findings() if f.get("severity") == "warn")
        out["false_positive"] = sum(1 for f in self.findings if f.get("false_positive"))
        return out

    def headline(self) -> tuple[str, int] | None:
        """Rozette gösterilecek en önemli bulgu türü ve sayısı (önce hata, sonra en sık)."""
        tally: dict[str, list[int]] = {}  # etiket → [sayı, en yüksek önem]
        for f in self.open_findings():
            if f["code"] not in _LABELS:
                continue
            cur = tally.setdefault(_LABELS[f["code"]][0], [0, 0])
            cur[0] += 1
            cur[1] = max(cur[1], 2 if f.get("severity") == "error" else 1)
        if not tally:
            return None
        key = max(tally, key=lambda k: (tally[k][1], tally[k][0]))
        return key, tally[key][0]

    def headline_key(self) -> str | None:
        """Rozet başlığının dil bağımsız anahtarı (arayüz çevirisi için): o etiketi taşıyan ilk kod."""
        hl = self.headline()
        return next((code for code, v in _LABELS.items() if v[0] == hl[0]), None) if hl else None

    def summary(self, lang: str = "tr") -> str:
        score = self.score
        num = f"{score:g}"
        head = f"Kalite {num}/10" if lang != "en" else f"Quality {num}/10"
        hl = self.headline()
        if hl:
            tr_label, n = hl
            if lang == "en":
                en = next(v for v in _LABELS.values() if v[0] == tr_label)
                head += f" · {n} {en[1] if n == 1 else en[2]}"
            else:
                head += f" · {n} {tr_label}"
        if self.accepted_anyway:
            head += " · yine de kabul edildi" if lang != "en" else " · accepted anyway"
        return head

    # ------------------------------------------------------------ dışa
    def to_dict(self, lang: str = "tr") -> dict[str, Any]:
        open_ = self.open_findings()
        return {"id": self.id, "deliverable_id": self.deliverable_id, "run_id": self.run_id,
                "score": self.score, "deterministic_score": round(self.deterministic_score, 1),
                "status": self.status, "passed": self.passed, "summary": self.summary(lang),
                "checks": self.checks, "findings": self.findings, "issues": open_, "counts": self.counts(),
                "reviewer": self.reviewer, "spec": self.spec, "content_hash": self.content_hash,
                "accepted_anyway": self.accepted_anyway, "accept_reason": self.accept_reason,
                "accepted_at": self.accepted_at, "revision_run_id": self.revision_run_id,
                "created_at": self.created_at}

    def badge(self, lang: str = "tr") -> dict[str, Any]:
        """Deliverable düğümüne yansıtılan kısa özet (listeler birleştirme yapmadan rozet çizer)."""
        hl = self.headline()
        return {"score": self.score, "status": self.status, "summary": self.summary(lang),
                "headline": {"label": hl[0], "count": hl[1], "key": self.headline_key()} if hl else None,
                "counts": self.counts(), "accepted_anyway": self.accepted_anyway,
                "reviewer": (self.reviewer or {}).get("status"), "report_id": self.id}

    @classmethod
    def from_props(cls, p: dict[str, Any]) -> "QualityReport":
        return cls(deliverable_id=p.get("deliverable_id"), checks=list(p.get("checks") or []),
                   findings=list(p.get("findings") or []), spec=dict(p.get("spec") or {}),
                   reviewer=p.get("reviewer"), content_hash=p.get("content_hash"), created_at=p.get("created_at"),
                   accepted_anyway=bool(p.get("accepted_anyway")), accept_reason=p.get("accept_reason"),
                   accepted_at=p.get("accepted_at"), revision_run_id=p.get("revision_run_id"),
                   run_id=p.get("run_id"), id=p.get("id"))
