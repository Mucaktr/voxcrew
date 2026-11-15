"""Türetilmiş koşu sonucu (G1-C, Rehber 1 §12.1 / R36; Rehber 2 §13.2): yürütme ≠ doğrulama ≠ kullanıcı incelemesi.

Üç ayrı alan:
- **Yürütme** `Run.status` (motor; değişmez): `running | paused | interrupted | done | failed | cancelled`.
- **Doğrulama** `verification_status` (`passed | failed | not_run`): zorunlu otomatik kontroller + artefakt bütünlüğü +
  "çıktı var mı". Kullanıcı ya da ajan hakem kararı doğrulama DEĞİLDİR.
- **İnceleme** `review_status` (`unreviewed | accepted | revision_requested | rejected`): kullanıcının (ya da ayar
  izin veriyorsa ajan hakemin) bu artefakt sürümü hakkındaki kararı.

`derive_outcome` bu üçünü ve dış etkileri tek bir sonuca indirger:
`accepted | partial | failed | cancelled | indeterminate | pending`. "partial" tam başarı sayılmaz ve eksikler
listesini taşır. İşlevler SAFTIR: yalnız sözlük/liste okur, graf, ağ, saat ya da dosya kullanmaz; G1-A (ölçüm defteri)
ve (yanlış kabul oranı) doğrudan içe aktarır.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

OUTCOMES = ("accepted", "partial", "failed", "cancelled", "indeterminate", "pending")
VERIFICATION_STATUSES = ("passed", "failed", "not_run")
REVIEW_STATUSES = ("unreviewed", "accepted", "revision_requested", "rejected")
USABLE = ("full", "partial")

# Kullanıcı incelemesi sayılmayan kontrol türleri (doğrulama dışı): manuel ölçüt hakem kararıdır, ajan hakem tavsiyedir.
_REVIEW_KINDS = ("manual", "reviewer")
_UNRESOLVED_EFFECT = "unknown"   # effects.py: pending → (kesinti) unknown → (onay) acknowledged
_NOT_TERMINAL = ("running", "paused", "interrupted", "pending", "awaiting", "awaiting_approval")


def verification_status(checks: Iterable[Mapping[str, Any]], has_output: bool = True) -> str:
    """Zorunlu otomatik kontrollerden doğrulama durumu. Çıktısız koşu (çıktı ve artefakt yok) her zaman `failed`.

    - zorunlu, kullanıcı-inceleme-dışı bir kontrol `failed` → `failed`;
    - biri henüz çalışmadı (`not_run` / `running`) → `not_run`;
    - hepsi `passed` (ya da yalnız manuel ölçüt var ve artefaktlar sağlam) → `passed`.
    """
    if not has_output:
        return "failed"
    state = "passed"
    for c in checks:
        if not c.get("required") or c.get("kind") in _REVIEW_KINDS:
            continue
        st = c.get("status")
        if st == "failed":
            return "failed"
        if st != "passed":
            state = "not_run"
    return state


def legacy_review_status(acceptance: Mapping[str, Any]) -> str:
    """Alan öncesi kayıtlar için: eski `status` → `review_status` (geriye uyum)."""
    rs = acceptance.get("review_status")
    if rs in REVIEW_STATUSES:
        return str(rs)
    return {"accepted": "accepted", "rejected": "rejected"}.get(str(acceptance.get("status") or ""), "unreviewed")


def unresolved_effects(effects: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Sonucu belirsiz kalan (onaylanmamış `unknown`) dış etkiler → yalnız kimlik alanları."""
    return [{"id": e.get("id"), "step": e.get("step"), "kind": e.get("kind")}
            for e in effects if e.get("status") == _UNRESOLVED_EFFECT]


def _degradations(run: Mapping[str, Any], quality: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Sonucu DEĞİŞTİRMEYEN uyarılar (yan yana gösterilir): yumuşak başarısız/atlanan adımlar ve kalite uyarıları.
    Lider kararı (G1-C): kullanıcı kabulü uyarı yüzünden `partial` olmaz; `partial` yalnız kullanıcı eksik işaretlerse
    ya da zorunlu otomatik kontrol kaldıysa."""
    out: list[dict[str, Any]] = []
    for s in run.get("steps") or []:
        if s.get("soft_fail"):
            code = "skipped_step" if s.get("status") == "skipped" else "soft_fail_step"
            out.append({"code": code, "ref": s.get("id")})
    for q in quality:
        if q.get("accepted_anyway") and q.get("status") == "failed":
            out.append({"code": "quality_failed_accepted_anyway", "ref": q.get("deliverable_id") or q.get("id")})
        elif q.get("status") in ("warn", "failed"):
            out.append({"code": f"quality_{q.get('status')}", "ref": q.get("deliverable_id") or q.get("id")})
    return out


def derive_outcome(run: Mapping[str, Any] | None, acceptance: Mapping[str, Any] | None = None,
                   effects: Iterable[Mapping[str, Any]] = (),
                   quality: Iterable[Mapping[str, Any]] = ()) -> dict[str, Any]:
    """Run + Acceptance + etkiler (+ kalite raporları) → `{outcome, missing, warnings, reasons, verification_status,
    review_status}`. `warnings` sonucu değiştirmez; yalnız bilgi.

    Girdiler düz sözlüklerdir:
    - `run`: `{status, output?, steps?: [{id, status, soft_fail?}], indeterminate?: bool}`;
    - `acceptance`: kabul görünümü (`checks`, `artifacts`, `has_output`, `review_status`, `usable`, `user_missing`,
      `superseded_by` …) ya da None;
    - `effects`: `[{id, step, kind, status}]` (Run.checkpoint.effects);
    - `quality`: `[{deliverable_id, status: passed|warn|failed, accepted_anyway}]` (CG-QUALITY raporları).

    Öncelik: yürütme bitmemiş → pending; çözülmemiş belirsiz etki → indeterminate; iptal → cancelled; başarısız →
    failed; çıktısız → failed; ret ya da doğrulama başarısız → failed; kullanıcı kabulü → accepted ya da (kullanıcı
    eksik işaretlediyse ya da zorunlu otomatik kontrol kaldıysa) partial; aksi halde pending.
    """
    if not run:
        return _result("pending", reasons=["no_run"])
    status = str(run.get("status") or "")
    unknown = unresolved_effects(effects)
    flagged = bool(run.get("indeterminate"))
    missing_effects = [{"code": "unknown_effect", "ref": e.get("id"), "step": e.get("step")} for e in unknown]
    if status in _NOT_TERMINAL or status.startswith("awaiting") or not status:
        return _result("pending", reasons=[f"run_{status or 'unknown'}"])
    if (unknown or flagged) and status in ("cancelled", "failed", "done", "interrupted"):
        return _result("indeterminate", missing=missing_effects or [{"code": "unknown_effect"}],
                       reasons=[f"run_{status}", "unresolved_effects"])
    if status == "cancelled":
        return _result("cancelled", reasons=["run_cancelled"])
    if status != "done":
        return _result("failed", reasons=[f"run_{status}"])

    acc = acceptance or {}
    warnings = _degradations(run, quality)
    if acceptance is None:
        has_output = bool(str(run.get("output") or "").strip()) or bool(run.get("artifacts")) or any(
            s.get("artifacts") for s in run.get("steps") or [])
    else:  # alan öncesi kabul kaydında `has_output` yok: geriye dönük başarısız sayılmaz
        has_output = acc.get("has_output") is not False
    if not has_output:
        return _result("failed", missing=[{"code": "output"}], reasons=["no_output"], warnings=warnings,
                       verification="failed", review=legacy_review_status(acc) if acceptance else "unreviewed")
    if acceptance is None:
        return _result("pending", reasons=["no_acceptance"], verification="not_run", warnings=warnings)

    verification = acc.get("verification_status")
    if verification not in VERIFICATION_STATUSES:
        verification = verification_status(acc.get("checks") or [], has_output)
    review = legacy_review_status(acc)
    failed_checks = [{"code": "check", "ref": c.get("id")} for c in acc.get("checks") or []
                     if c.get("required") and c.get("kind") not in _REVIEW_KINDS and c.get("status") == "failed"]
    if review == "rejected":
        return _result("failed", missing=failed_checks, reasons=["review_rejected"], verification=verification,
                       review=review, warnings=warnings)
    if review == "revision_requested":
        reasons = ["revision_requested"] + (["superseded"] if acc.get("superseded_by") else [])
        return _result("pending", reasons=reasons, verification=verification, review=review, warnings=warnings)
    if review == "accepted":
        missing = list(failed_checks)
        if acc.get("usable") == "partial":
            notes = [str(m) for m in acc.get("user_missing") or [] if str(m).strip()]
            missing += [{"code": "user_marked", "text": n} for n in notes] or [{"code": "user_marked"}]
        if missing:
            return _result("partial", missing=missing, reasons=["accepted_with_gaps"], verification=verification,
                           review=review, warnings=warnings)
        return _result("accepted", reasons=["review_accepted"], verification=verification, review=review,
                       warnings=warnings)
    if verification == "failed":
        return _result("failed", missing=failed_checks or [{"code": "verification"}], reasons=["verification_failed"],
                       verification=verification, review=review, warnings=warnings)
    return _result("pending", reasons=["awaiting_review"], verification=verification, review=review,
                   warnings=warnings)


def _result(outcome: str, *, missing: list[dict[str, Any]] | None = None, reasons: list[str] | None = None,
            verification: str | None = None, review: str | None = None,
            warnings: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {"outcome": outcome, "missing": missing or [], "warnings": warnings or [], "reasons": reasons or [],
            "verification_status": verification, "review_status": review}


# ---------------------------------------------------------------- ajan hakem ↔ kullanıcı uyuşması ( verisi)
def agreement_of(agent_verdict: str | None, user_decision: str | None) -> str | None:
    """Ajan kararı (`accepted|rejected`) ile kullanıcının SONRAKİ kararı → `agree | false_accept | false_reject`.

    Kullanıcının `revision_requested` kararı "kabul değil" sayılır. Eksik taraf varsa None (çift oluşmadı)."""
    if agent_verdict not in ("accepted", "rejected") or user_decision not in ("accepted", "rejected",
                                                                             "revision_requested"):
        return None
    user_ok = user_decision == "accepted"
    agent_ok = agent_verdict == "accepted"
    if agent_ok == user_ok:
        return "agree"
    return "false_accept" if agent_ok else "false_reject"


def agreement_summary(records: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """Uyuşma kayıtları → sayılar ve oranlar. Payda 0 ise oran None (tanımsız; 0 değil).

    - `false_accept_rate` = ajanın kabul edip kullanıcının kabul etmediği / ajanın kabul ettiği (eşleşmiş) çiftler;
    - `false_reject_rate` = ajanın reddedip kullanıcının kabul ettiği / ajanın reddettiği (eşleşmiş) çiftler.
    Kullanıcı ajan kararından ÖNCE karar verdiyse (`after_user`) çift sayılmaz."""
    pairs = agree = fa = fr = agent_acc = agent_rej = open_ = 0
    for r in records:
        if r.get("after_user"):
            continue
        res = agreement_of(r.get("agent_verdict"), r.get("user_decision"))
        if res is None:
            open_ += 1
            continue
        pairs += 1
        if r.get("agent_verdict") == "accepted":
            agent_acc += 1
        else:
            agent_rej += 1
        if res == "agree":
            agree += 1
        elif res == "false_accept":
            fa += 1
        else:
            fr += 1
    return {"pairs": pairs, "agree": agree, "false_accept": fa, "false_reject": fr, "open": open_,
            "false_accept_rate": round(fa / agent_acc, 4) if agent_acc else None,
            "false_reject_rate": round(fr / agent_rej, 4) if agent_rej else None,
            "agreement_rate": round(agree / pairs, 4) if pairs else None}
