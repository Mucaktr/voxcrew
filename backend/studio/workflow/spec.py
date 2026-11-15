"""İş akışı tanımı (YAML), DAG doğrulama ve istem şablonları.

Adım türleri:
  agent — bir ajana görev; prompt şablonu {{input.x}} ve {{steps.<id>.output}} kullanabilir
  approval — insan onay kapısı; onaylanana kadar bağımlı adımlar bekler
  delegate — yönetici ajan hedefi alt görevlere böler, gerekirse işe alır, astlarına dağıtır ve sonucu
             birleştirir (Faz 3, S6). Alanlar: depth (1–3), max_subtasks (≤8), allow_hiring,
             hiring_approval (ask | auto), hire_budget (≤3).
Ajan yerine rol (QA-M1): agent/delegate adımı `agent:` yerine `role: <Role.id>` alabilir; rolü taşıyan ajan
çalışma anında çözülür (rol başka ajana verilince akış yeni ajanı çalıştırır).
Gözden geçir-düzelt döngüsü: bir agent adımına `revise: {target, until, max_rounds}` verilirse,
çıktısında `until` geçmedikçe hedef adım geri bildirimle yeniden çalıştırılır.
Faz 6 (S24): orchestrate — delegate + döngü: plan (plan_approval: ask | auto) → görev mesajları → izleme
             (monitor_every_s) → başarısız/eksik çocuklar için yeniden plan (max_replans ≤ 2, aşımda insan kapısı)
             → sentez. delegate alanlarının hepsini, ayrıca `budget` ve `policy` alır.
Eklenti adım türleri: `register_step_type(ad, doğrulayıcı)` (motor `Engine.register_step_type` ile çağırır) —
doğrulayıcı `(StepSpec) -> list[str]` hata listesi döner.
Faz 6 (S23): adım `policy: {retries 0–5, backoff exp|fixed, base_s, timeout_min, on_fail fail|skip|continue|ask}`
ve `budget: {tokens, cost_usd, minutes, steps, on_exceeded}`; akış düzeyinde `defaults: {policy, budget}` ve
`budget:` (koşu bütçesi). Doğrulama `policy.py` / `budget.py` ile yapılır.
Faz 6 (S28): akış düzeyinde `acceptance: {criteria: [...], reviewer}` — kanıtlı kapanış ölçütleri
(`validate_acceptance`); kabul kaydı tam sürümün değerlendirme modülünde.
 (AW-R23): ajan adımı `approval: before | after | none` — adım başı insan onayı (motor `_step_gate`).
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable

import yaml

from studio.config import atomic_write_text
from studio.i18n import request_lang


class WorkflowError(ValueError):
    pass


@dataclass
class StepSpec:
    id: str
    type: str = "agent"
    title: str = ""
    agent: str | None = None
    prompt: str = ""
    depends_on: list[str] = field(default_factory=list)
    connection: str | None = None
    model: str | None = None
    memory: bool = True
    remember: bool = True
    message: str = ""
    revise: dict[str, Any] | None = None
    # QA-M1: ajan yerine rol (Role.id); ajan çalışma anında rolden çözülür
    role: str | None = None
    # Faz 3 — delegate adımı (None = varsayılan; YAML'a yalnızca verilen alanlar yazılır)
    depth: int | None = None
    max_subtasks: int | None = None
    allow_hiring: bool | None = None
    hiring_approval: str | None = None
    hire_budget: int | None = None
    # Faz 6 — adım politikası ve adım bütçesi; None = akış/ayar varsayılanı
    policy: dict[str, Any] | None = None
    budget: dict[str, Any] | None = None
    # Faz 6 (S24) — orchestrate adımı (None = varsayılan)
    plan_approval: str | None = None
    max_replans: int | None = None
    monitor_every_s: float | None = None
    # Faz 6 — ajan adımı çıktı şeması (JSON Schema alt kümesi, guard/schema.py); uymazsa
    # `guard.output_schema_retries` kadar düzeltme turu, sonra adım başarısız. Ollama'da `format` olarak da verilir.
    output_schema: dict[str, Any] | None = None
    # (AW-R23) — adım başı onay: before = model çağrısından ve bütçe rezervasyonundan önce istem kartı,
    # after = çıktı onaylanana kadar tutulur (bağımlılar başlamaz), none/None = onay yok. Yalnız ajan adımında.
    approval: str | None = None
    # PROC-FIX adım niteliği — `review` = denetim/gözden geçirme adımı (teslim değil; düzenleyici uyarır)
    kind: str | None = None
    # PROC-FIX bu adımda web araması izni (Codex yalıtılmış kipte varsayılan KAPALI; True = açık izin)
    web_search: bool | None = None


STEP_KINDS = ("review",)
STEP_TYPES = ("agent", "approval", "delegate", "orchestrate")
# Ajan (ya da rol) ve görev metni isteyen türler
AGENTIC_TYPES = ("agent", "delegate", "orchestrate")
# Eklenti adım türleri: ad → doğrulayıcı (StepSpec → hata listesi) ya da None
_EXTRA_TYPES: dict[str, Any] = {}


def register_step_type(name: str, validator: Any = None) -> None:
    """Motorun eklenti adım türünü şema doğrulamasına tanıtır (yerleşik türler değişmez)."""
    if name in STEP_TYPES:
        return
    _EXTRA_TYPES[name] = validator


def known_step_types() -> tuple[str, ...]:
    return STEP_TYPES + tuple(k for k in _EXTRA_TYPES if k not in STEP_TYPES)


# motorun iç adım türleri (yalnız `system:` kökenli gizli koşular, bellekteki tanımla) kullanıcı iş akışına
# kaydedilemez ve paylaşım paketiyle içe aktarılamaz.
INTERNAL_STEP_TYPES = frozenset({"system_llm"})


def internal_step_problem(data: Any) -> str | None:
    """İş akışı verisinde iç adım türü varsa Türkçe neden; yoksa None."""
    steps = data.get("steps") if isinstance(data, dict) else None
    for s in steps if isinstance(steps, list) else []:
        if isinstance(s, dict) and s.get("type") in INTERNAL_STEP_TYPES:
            return f"{str(s.get('id'))[:40]}: '{s.get('type')}' motorun iç adım türüdür; iş akışına eklenemez"
    return None
# Devretme sınırları
DELEGATE_DEFAULTS: dict[str, Any] = {"depth": 2, "max_subtasks": 6, "allow_hiring": True,
                                     "hiring_approval": "ask", "hire_budget": 2}
MAX_DELEGATE_DEPTH = 3
MAX_SUBTASKS = 8
MAX_HIRE_BUDGET = 3
HIRING_APPROVALS = ("ask", "auto")
# Orkestratör sınırları
ORCHESTRATE_DEFAULTS: dict[str, Any] = {"plan_approval": "ask", "max_replans": 1, "monitor_every_s": 30.0}
PLAN_APPROVALS = ("ask", "auto")
STEP_APPROVALS = ("before", "after", "none")  # adım başı onay
MAX_REPLANS = 2
MONITOR_RANGE = (0.05, 3600.0)


def delegate_options(step: StepSpec) -> dict[str, Any]:
    """delegate adımının etkin seçenekleri (varsayılanlar + sınırlara kırpılmış değerler)."""
    out = dict(DELEGATE_DEFAULTS)
    for k in DELEGATE_DEFAULTS:
        v = getattr(step, k, None)
        if v is not None:
            out[k] = v
    out["depth"] = max(1, min(MAX_DELEGATE_DEPTH, int(out["depth"])))
    out["max_subtasks"] = max(1, min(MAX_SUBTASKS, int(out["max_subtasks"])))
    out["hire_budget"] = max(0, min(MAX_HIRE_BUDGET, int(out["hire_budget"])))
    out["allow_hiring"] = bool(out["allow_hiring"])
    if out["hiring_approval"] not in HIRING_APPROVALS:
        out["hiring_approval"] = "ask"
    return out


def orchestrate_options(step: StepSpec) -> dict[str, Any]:
    """orchestrate adımının etkin seçenekleri: delegate seçenekleri + plan_approval, max_replans, monitor_every_s."""
    out = delegate_options(step)
    out.update(ORCHESTRATE_DEFAULTS)
    for k in ORCHESTRATE_DEFAULTS:
        v = getattr(step, k, None)
        if v is not None:
            out[k] = v
    if out["plan_approval"] not in PLAN_APPROVALS:
        out["plan_approval"] = "ask"
    out["max_replans"] = max(0, min(MAX_REPLANS, int(out["max_replans"])))
    out["monitor_every_s"] = max(MONITOR_RANGE[0], min(MONITOR_RANGE[1], float(out["monitor_every_s"])))
    return out


@dataclass
class InputSpec:
    name: str
    label: str = ""
    type: str = "text"
    default: str = ""
    required: bool = True


@dataclass
class WorkflowSpec:
    slug: str
    name: str
    description: str = ""
    icon: str = "workflow"
    inputs: list[InputSpec] = field(default_factory=list)
    steps: list[StepSpec] = field(default_factory=list)
    # Faz 6: akış varsayılanları {policy, budget} ve koşu bütçesi
    defaults: dict[str, Any] = field(default_factory=dict)
    budget: dict[str, Any] | None = None
    # Faz 6 (S28): kanıtlı kapanış — {criteria: [...], reviewer: user | agent:<slug>}; None = varsayılanlar
    acceptance: dict[str, Any] | None = None
    # FOLLOWUP: akış düzeyinde kalite denetim listesi (`quality:` — required_sections, rules, file_type, reviewer…;
    # biçim `studio.quality.spec.normalize`). Kalite kapısı koşu sonunda `quality.spec.from_run` ile okur.
    quality: dict[str, Any] | None = None
    # PROC-FIX akışın teslim adımı (kabul kartı, kalite kapısı, sergi ve revizyon bunu hedefler). None = son üst
    # düzey ajan adımı (geriye uyum). PROC2-FIX adım kimlikleri listesi de olabilir (ör. [brif, plan]); teslim
    # bunların çıktılarının sırayla, başlıklı birleşimidir. Tek kimlik eskisi gibi çalışır.
    deliverable: str | list[str] | None = None

    def step(self, step_id: str) -> StepSpec:
        for s in self.steps:
            if s.id == step_id:
                return s
        raise WorkflowError(f"Adım yok: {step_id}")

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        for s in d["steps"]:
            for k in [k for k, v in s.items() if v in (None, "", [])]:
                if k not in ("id", "type"):
                    s.pop(k)
        if not d.get("defaults"):
            d.pop("defaults", None)
        if d.get("budget") is None:
            d.pop("budget", None)
        if d.get("acceptance") is None:
            d.pop("acceptance", None)
        if d.get("quality") is None:
            d.pop("quality", None)
        if d.get("deliverable") is None:
            d.pop("deliverable", None)
        return d


_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,40}$")


def _opt_int(raw: dict[str, Any], key: str) -> int | None:
    v = raw.get(key)
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        raise WorkflowError(f"{raw.get('id')}: {key} bir tam sayı olmalı")
    try:
        return int(v)
    except (TypeError, ValueError):
        raise WorkflowError(f"{raw.get('id')}: {key} bir tam sayı olmalı") from None


def _opt_dict(raw: dict[str, Any], key: str) -> dict[str, Any] | None:
    v = raw.get(key)
    if v is None:
        return None
    if not isinstance(v, dict):
        raise WorkflowError(f"{raw.get('id') or 'akış'}: {key} bir sözlük olmalı")
    return dict(v)


def _opt_float(raw: dict[str, Any], key: str) -> float | None:
    v = raw.get(key)
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        raise WorkflowError(f"{raw.get('id')}: {key} bir sayı olmalı")
    try:
        return float(v)
    except (TypeError, ValueError):
        raise WorkflowError(f"{raw.get('id')}: {key} bir sayı olmalı") from None


def effective_policy(spec: WorkflowSpec, step: StepSpec) -> dict[str, Any]:
    """Adımın etkin politikası (akış `defaults.policy` üstüne adım `policy`); doğrulanmış sözlük."""
    from studio.workflow.policy import StepPolicy  # döngüsel içe aktarmadan kaçın
    base = StepPolicy.parse((spec.defaults or {}).get("policy"), where="defaults")
    return StepPolicy.parse(step.policy, base=base, where=step.id).to_dict()


# Faz 6 (S28) — akış düzeyinde `acceptance:` bloğu (kanıtlı kapanış). "Tamamlandı" ≠ "kabul edildi":
#   acceptance:
#     reviewer: user | agent:<slug>          # hakem (çıktıyı üreten ajan olamaz; çalışma anında denetlenir)
#     criteria:
#       - {id, text, required: true, kind: manual}                     # hakem kararıyla onaylanır
#       - {id, kind: keyword, keywords: [..], match: all|any, case_sensitive: false}
#       - {id, kind: regex, pattern: "..."}                            # son çıktıda aranır
#       - {id, kind: json_schema, schema: {...}}                       # son çıktıdaki JSON doğrulanır
#       - {id, kind: command, command: [..] | "..", timeout_s: 300}    # YALNIZCA kullanıcı tıklamasıyla, kabuksuz
# Blok verilmezse varsayılan ölçütler kullanılır (manuel hakem kontrolü); artefakt özeti bütünlüğü her zaman eklenir.
ACCEPTANCE_KINDS = ("manual", "keyword", "regex", "json_schema", "command")
ACCEPTANCE_RESERVED_IDS = ("artifacts", "reviewer")
MAX_ACCEPTANCE_CRITERIA = 20
COMMAND_TIMEOUT_RANGE = (1, 3600)
_CRITERION_KEYS = {
    "manual": set(),
    "keyword": {"keywords", "match", "case_sensitive"},
    "regex": {"pattern", "case_sensitive"},
    "json_schema": {"schema"},
    "command": {"command", "timeout_s"},
}
_REVIEWER = re.compile(r"^(user|agent:[a-z0-9][a-z0-9_-]{0,60})$")


def validate_acceptance(block: Any) -> list[str]:
    """`acceptance:` bloğunun yapısal doğrulaması → hata listesi (boş = geçerli). Bilinmeyen anahtarlar hatadır
    (yanlış yazılmış bir ölçüt sessizce yok sayılıp kabulü gevşetmesin)."""
    errors: list[str] = []
    if not isinstance(block, dict):
        return ["acceptance bir sözlük olmalı"]
    for k in block:
        if k not in ("criteria", "reviewer"):
            errors.append(f"acceptance: bilinmeyen alan {k}")
    reviewer = block.get("reviewer")
    if reviewer is not None and (not isinstance(reviewer, str) or not _REVIEWER.match(reviewer.strip())):
        errors.append("acceptance.reviewer 'user' ya da 'agent:<slug>' olmalı")
    criteria = block.get("criteria")
    if criteria is None:
        return errors
    if not isinstance(criteria, list):
        return errors + ["acceptance.criteria bir liste olmalı"]
    if len(criteria) > MAX_ACCEPTANCE_CRITERIA:
        errors.append(f"acceptance.criteria en fazla {MAX_ACCEPTANCE_CRITERIA} ölçüt içerebilir")
    seen: set[str] = set()
    for i, c in enumerate(criteria):
        where = f"acceptance.criteria[{i}]"
        if not isinstance(c, dict):
            errors.append(f"{where} bir sözlük olmalı")
            continue
        cid = c.get("id")
        if not isinstance(cid, str) or not _ID.match(cid):
            errors.append(f"{where}: id küçük harf, rakam, - ve _ içermeli")
        elif cid in ACCEPTANCE_RESERVED_IDS:
            errors.append(f"{where}: '{cid}' ayrılmış bir kimlik")
        elif cid in seen:
            errors.append(f"{where}: ölçüt id'leri benzersiz olmalı ({cid})")
        else:
            seen.add(cid)
            where = f"acceptance.{cid}"
        kind = c.get("kind", "manual")
        if kind not in ACCEPTANCE_KINDS:
            errors.append(f"{where}: bilinmeyen ölçüt türü {kind}")
            continue
        allowed = {"id", "text", "required", "kind"} | _CRITERION_KEYS[kind]
        for k in c:
            if k not in allowed:
                errors.append(f"{where}: {kind} ölçütünde bilinmeyen alan {k}")
        if c.get("text") is not None and (not isinstance(c["text"], str) or len(c["text"]) > 500):
            errors.append(f"{where}: text en fazla 500 karakterlik bir metin olmalı")
        for flag in ("required", "case_sensitive"):
            if c.get(flag) is not None and not isinstance(c[flag], bool):
                errors.append(f"{where}: {flag} true ya da false olmalı")
        if kind == "keyword":
            kws = c.get("keywords")
            if not isinstance(kws, list) or not kws or not all(isinstance(k, str) and k.strip() for k in kws):
                errors.append(f"{where}: keywords boş olmayan metinlerden oluşan bir liste olmalı")
            if c.get("match", "all") not in ("all", "any"):
                errors.append(f"{where}: match 'all' ya da 'any' olmalı")
        elif kind == "regex":
            pat = c.get("pattern")
            if not isinstance(pat, str) or not pat:
                errors.append(f"{where}: pattern gerekli")
            else:
                try:
                    re.compile(pat)
                except re.error as exc:
                    errors.append(f"{where}: geçersiz düzenli ifade: {exc}")
        elif kind == "json_schema":
            schema = c.get("schema")
            if not isinstance(schema, dict):
                errors.append(f"{where}: schema bir sözlük olmalı")
            else:
                from studio.guard.schema import check_schema  # döngüsel içe aktarmadan kaçın
                errors.extend(f"{where}: schema: {e}" for e in check_schema(schema))
        elif kind == "command":
            cmd = c.get("command")
            ok = (isinstance(cmd, str) and cmd.strip()) or (
                isinstance(cmd, list) and cmd and all(isinstance(a, str) for a in cmd) and cmd[0].strip())
            if not ok:
                errors.append(f"{where}: command boş olmayan bir metin ya da metin listesi olmalı")
            t = c.get("timeout_s")
            if t is not None and (isinstance(t, bool) or not isinstance(t, (int, float))
                                  or not COMMAND_TIMEOUT_RANGE[0] <= t <= COMMAND_TIMEOUT_RANGE[1]):
                errors.append(f"{where}: timeout_s {COMMAND_TIMEOUT_RANGE[0]}–{COMMAND_TIMEOUT_RANGE[1]} sn olmalı")
    return errors


QUALITY_KEYS = ("required_sections", "sections", "rules", "file_type", "reviewer", "required", "check", "min_chars",
                "max_chars", "min_words", "max_words", "citations", "pii")


def validate_quality(block: Any) -> list[str]:
    """FOLLOWUP: akış `quality:` bloğunun yapısal doğrulaması (anlamı `studio.quality.spec.normalize`'da)."""
    if not isinstance(block, dict):
        return ["quality bir sözlük olmalı"]
    errors = [f"quality: bilinmeyen alan {k}" for k in block if k not in QUALITY_KEYS]
    for k in ("required_sections", "sections"):
        if k in block and not isinstance(block[k], list):
            errors.append(f"quality.{k} bir liste olmalı")
    if "rules" in block and not isinstance(block["rules"], (list, str)):
        errors.append("quality.rules bir liste olmalı")
    for k in ("reviewer", "required", "citations", "pii"):
        if k in block and not isinstance(block[k], bool):
            errors.append(f"quality.{k} true/false olmalı")
    if "file_type" in block and not isinstance(block["file_type"], str):
        errors.append("quality.file_type metin olmalı")
    for k in ("min_chars", "max_chars", "min_words", "max_words"):
        if k in block and (isinstance(block[k], bool) or not isinstance(block[k], int) or block[k] < 0):
            errors.append(f"quality.{k} sıfır ya da pozitif bir tam sayı olmalı")
    return errors


def parse(data: dict[str, Any]) -> WorkflowSpec:
    if not isinstance(data, dict):
        raise WorkflowError("İş akışı bir sözlük olmalı")
    steps = []
    for raw in data.get("steps") or []:
        if not isinstance(raw, dict) or not raw.get("id"):
            raise WorkflowError("Her adımın bir id'si olmalı")
        deps = raw.get("depends_on") or []
        steps.append(StepSpec(
            id=str(raw["id"]), type=raw.get("type", "agent"), title=raw.get("title", ""),
            agent=raw.get("agent") or None, prompt=raw.get("prompt", ""),
            depends_on=[deps] if isinstance(deps, str) else list(deps),
            connection=raw.get("connection"), model=raw.get("model"),
            memory=bool(raw.get("memory", True)), remember=bool(raw.get("remember", True)),
            message=raw.get("message", ""), revise=raw.get("revise"),
            role=str(raw["role"]).strip() or None if raw.get("role") else None,
            depth=_opt_int(raw, "depth"), max_subtasks=_opt_int(raw, "max_subtasks"),
            allow_hiring=None if raw.get("allow_hiring") is None else bool(raw.get("allow_hiring")),
            hiring_approval=str(raw["hiring_approval"]) if raw.get("hiring_approval") else None,
            hire_budget=_opt_int(raw, "hire_budget"),
            policy=_opt_dict(raw, "policy"), budget=_opt_dict(raw, "budget"),
            plan_approval=str(raw["plan_approval"]) if raw.get("plan_approval") else None,
            max_replans=_opt_int(raw, "max_replans"), monitor_every_s=_opt_float(raw, "monitor_every_s"),
            output_schema=_opt_dict(raw, "output_schema"),
            approval=str(raw["approval"]).strip().lower() if raw.get("approval") else None,
            kind=str(raw["kind"]).strip().lower() if raw.get("kind") else None,
            web_search=None if raw.get("web_search") is None else raw.get("web_search")))
    inputs = [InputSpec(**{k: v for k, v in i.items() if k in InputSpec.__dataclass_fields__})
              if isinstance(i, dict) else InputSpec(name=str(i)) for i in data.get("inputs") or []]
    defaults = data.get("defaults") or {}
    if not isinstance(defaults, dict):
        raise WorkflowError("defaults bir sözlük olmalı")
    spec = WorkflowSpec(slug=str(data.get("slug") or ""), name=data.get("name") or data.get("slug") or "",
                        description=data.get("description", ""), icon=data.get("icon", "workflow"),
                        inputs=inputs, steps=steps, defaults=dict(defaults), budget=_opt_dict(data, "budget"),
                        acceptance=_opt_dict(data, "acceptance"), quality=_opt_dict(data, "quality"),
                        deliverable=_parse_deliverable(data.get("deliverable")))
    errors = validate(spec)
    if errors:
        raise WorkflowError("; ".join(errors))
    return spec


def validate(spec: WorkflowSpec, agents: set[str] | None = None, roles: set[str] | None = None) -> list[str]:
    """Yapısal doğrulama. `agents` verilirse ajan slug'ları, `roles` verilirse (rolü taşıyan bir ajanı olan
    Role.id kümesi) rol adımları da denetlenir: "X rolünde ajan yok"."""
    from studio.workflow.budget import Budget, BudgetError
    from studio.workflow.policy import PolicyError, StepPolicy

    errors: list[str] = []
    if not _ID.match(spec.slug or ""):
        errors.append("slug yalnızca küçük harf, rakam, - ve _ içerebilir")
    base_policy = StepPolicy()
    try:
        base_policy = StepPolicy.parse((spec.defaults or {}).get("policy"), where="defaults")
    except PolicyError as exc:
        errors.append(str(exc))
    for label, raw in (("defaults.budget", (spec.defaults or {}).get("budget")), ("budget", spec.budget)):
        try:
            Budget.parse(raw)
        except BudgetError as exc:
            errors.append(f"{label}: {exc}")
    for s in spec.steps:
        try:
            StepPolicy.parse(s.policy, base=base_policy, where=s.id)
        except PolicyError as exc:
            errors.append(str(exc))
        try:
            Budget.parse(s.budget)
        except BudgetError as exc:
            errors.append(f"{s.id}: {exc}")
        if s.output_schema is not None:
            if s.type != "agent":
                errors.append(f"{s.id}: output_schema yalnızca ajan adımında kullanılabilir")
            else:
                from studio.guard.schema import check_schema  # döngüsel içe aktarmadan kaçın
                errors.extend(f"{s.id}: output_schema: {e}" for e in check_schema(s.output_schema))
        if s.approval is not None:
            if s.approval not in STEP_APPROVALS:
                errors.append(f"{s.id}: approval 'before', 'after' ya da 'none' olmalı")
            elif s.approval != "none" and s.type != "agent":
                errors.append(f"{s.id}: adım başı onay (approval) yalnızca ajan adımında kullanılabilir")
        if s.kind is not None and s.kind not in STEP_KINDS:  # PROC-FIX
            errors.append(f"{s.id}: kind yalnızca 'review' olabilir")
        if s.web_search is not None and not isinstance(s.web_search, bool):  # PROC-FIX
            errors.append(f"{s.id}: web_search true ya da false olmalı")
    for did in deliverable_ids(spec):  # PROC-FIX / PROC2-FIX (liste)
        target = next((s for s in spec.steps if s.id == did), None)
        if target is None:
            errors.append(f"deliverable: adım yok: {did}")
        elif target.type not in AGENTIC_TYPES:
            errors.append(f"deliverable ({did}) bir ajan adımı olmalı")
    if spec.acceptance is not None:
        errors.extend(validate_acceptance(spec.acceptance))
    if spec.quality is not None:
        errors.extend(validate_quality(spec.quality))
    if not spec.steps:
        errors.append("En az bir adım gerekli")
    ids = [s.id for s in spec.steps]
    if len(ids) != len(set(ids)):
        errors.append("Adım id'leri benzersiz olmalı")
    types = {s.id: s.type for s in spec.steps}
    for s in spec.steps:
        if not _ID.match(s.id):
            errors.append(f"Geçersiz adım id: {s.id}")
        if s.type not in known_step_types():
            errors.append(f"{s.id}: bilinmeyen adım türü {s.type}")
        elif s.type in _EXTRA_TYPES and callable(_EXTRA_TYPES[s.type]):
            try:
                errors.extend(str(e) for e in (_EXTRA_TYPES[s.type](s) or []))
            except Exception as exc:  # noqa: BLE001 - eklenti doğrulayıcısı şemayı kırmamalı
                errors.append(f"{s.id}: {s.type} doğrulanamadı: {exc}")
        if s.type in AGENTIC_TYPES:
            who = "kök yönetici (ajan ya da rol)" if s.type in ("delegate", "orchestrate") else "ajan ya da rol"
            if not s.agent and not s.role:
                errors.append(f"{s.id}: {who} seçilmeli")
            elif s.role and not s.agent:
                if roles is not None and s.role not in roles:
                    errors.append(f"{s.id}: '{s.role}' rolünde ajan yok")
            elif agents is not None and s.agent not in agents:
                errors.append(f"{s.id}: '{s.agent}' adlı ajan yok")
            if not s.prompt.strip():
                errors.append(f"{s.id}: {'görev' if s.type == 'agent' else 'hedef'} metni boş")
        if s.type in ("delegate", "orchestrate"):
            if s.depth is not None and not 1 <= s.depth <= MAX_DELEGATE_DEPTH:
                errors.append(f"{s.id}: devretme derinliği 1–{MAX_DELEGATE_DEPTH} olmalı")
            if s.max_subtasks is not None and not 1 <= s.max_subtasks <= MAX_SUBTASKS:
                errors.append(f"{s.id}: alt görev sayısı 1–{MAX_SUBTASKS} olmalı")
            if s.hire_budget is not None and not 0 <= s.hire_budget <= MAX_HIRE_BUDGET:
                errors.append(f"{s.id}: işe alım bütçesi 0–{MAX_HIRE_BUDGET} olmalı")
            if s.hiring_approval is not None and s.hiring_approval not in HIRING_APPROVALS:
                errors.append(f"{s.id}: işe alım onayı 'ask' ya da 'auto' olmalı")
            if s.revise:
                errors.append(f"{s.id}: gözden geçirme döngüsü yalnızca ajan adımında kullanılabilir")
        if s.type == "orchestrate":
            if s.plan_approval is not None and s.plan_approval not in PLAN_APPROVALS:
                errors.append(f"{s.id}: plan onayı 'ask' ya da 'auto' olmalı")
            if s.max_replans is not None and not 0 <= s.max_replans <= MAX_REPLANS:
                errors.append(f"{s.id}: yeniden plan sayısı 0–{MAX_REPLANS} olmalı")
            if s.monitor_every_s is not None and not MONITOR_RANGE[0] <= s.monitor_every_s <= MONITOR_RANGE[1]:
                errors.append(f"{s.id}: izleme aralığı {MONITOR_RANGE[0]:g}–{MONITOR_RANGE[1]:g} sn olmalı")
        elif s.plan_approval is not None or s.max_replans is not None or s.monitor_every_s is not None:
            errors.append(f"{s.id}: plan_approval, max_replans ve monitor_every_s yalnızca orchestrate adımında kullanılabilir")
        for d in s.depends_on:
            if d not in ids:
                errors.append(f"{s.id}: bilinmeyen bağımlılık {d}")
        if s.revise and s.type not in ("delegate", "orchestrate"):
            target = s.revise.get("target")
            if target not in ids:
                errors.append(f"{s.id}: revise hedefi yok: {target}")
            elif target not in ancestors(spec, s.id):
                errors.append(f"{s.id}: revise hedefi ({target}) bu adımdan önce gelmeli")
            elif types.get(target) != "agent":
                errors.append(f"{s.id}: revise hedefi ({target}) bir ajan adımı olmalı")
    if not errors:
        try:
            topo_order(spec)
        except WorkflowError as exc:
            errors.append(str(exc))
    return errors


def _kahn(ids: list[str], deps: dict[str, set[str]]) -> list[str] | None:
    """Kararlı topolojik sıra (bildirilen sırayla); döngü varsa None."""
    indeg = {i: len([d for d in deps[i] if d in deps]) for i in ids}
    children: dict[str, list[str]] = {i: [] for i in ids}
    for i in ids:
        for d in deps[i]:
            if d in children:
                children[d].append(i)
    order, ready = [], [i for i in ids if indeg[i] == 0]
    while ready:
        cur = ready.pop(0)
        order.append(cur)
        for c in children[cur]:
            indeg[c] -= 1
            if indeg[c] == 0:
                ready.append(c)
    return order if len(order) == len(ids) else None


def _ordered(steps: list[tuple[str, set[str], str]]) -> list[str] | None:
    """(id, bildirilen bağımlılıklar, şablon metni) → sıra. `{{steps.X.output}}` okuyan adım X'ten SONRA
    sıralanır (örtük kenar); örtük kenarlar döngü yaratıyorsa yalnız bildirilen sıra kullanılır."""
    ids = [i for i, _d, _t in steps]
    declared = {i: set(d) for i, d, _t in steps}
    base = _kahn(ids, declared)
    if base is None:
        return None
    known = set(ids)
    implicit = {i: declared[i] | {r for r in references(t) if r in known and r != i} for i, _d, t in steps}
    return _kahn(ids, implicit) or base


def topo_order(spec: WorkflowSpec) -> list[str]:
    order = _ordered([(s.id, set(s.depends_on), " ".join((s.prompt or "", s.message or ""))) for s in spec.steps])
    if order is None:
        raise WorkflowError("İş akışında döngü var (DAG olmalı)")
    return order


def ancestors(spec: WorkflowSpec, step_id: str) -> set[str]:
    seen: set[str] = set()
    stack = list(spec.step(step_id).depends_on)
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        try:
            stack.extend(spec.step(cur).depends_on)
        except WorkflowError:
            pass
    return seen


_VAR = re.compile(r"\{\{\s*([\w.\-]+)\s*\}\}")


def render(template: str, ctx: dict[str, Any]) -> str:
    def sub(m: re.Match[str]) -> str:
        cur: Any = ctx
        for part in m.group(1).split("."):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                return m.group(0)
        return str(cur)
    return _VAR.sub(sub, template)


def references(template: str) -> set[str]:
    """Şablonun doğrudan kullandığı adım çıktıları."""
    return {m.group(1).split(".")[1] for m in _VAR.finditer(template)
            if m.group(1).startswith("steps.") and len(m.group(1).split(".")) >= 2}


def effective_deps(steps: list[dict[str, Any]]) -> dict[str, set[str]]:
    """adımın etkin bağımlılıkları = bildirilen `depends_on` + istem/ileti şablonunda `{{steps.X.output}}` ile
    okuduğu X (motorun yürütme sırasıyla aynı kural: `topo_order` örtük kenarları; döngü yaratan referans sayılmaz).
    Girdi: `id`, `depends_on`, `prompt`, `message` alanlı sözlükler (spec ya da kontrol noktası)."""
    rows = [(str(s.get("id")), {str(d) for d in (s.get("depends_on") or [])},
             " ".join((str(s.get("prompt") or ""), str(s.get("message") or "")))) for s in steps]
    order = _ordered(rows) or [i for i, _d, _t in rows]
    pos = {i: n for n, i in enumerate(order)}
    return {i: d | {r for r in references(t) if r in pos and r != i and pos[r] < pos[i]} for i, d, t in rows}


class WorkflowLibrary:
    """Kullanıcı iş akışları (`directory`, yazılabilir) + isteğe bağlı salt okunur örnekler (`examples`).

    Aynı slug iki yerde varsa kullanıcınınki geçerlidir. Kaydetme her zaman kullanıcı klasörüne yazar (örneği
    düzenlemek onu kullanıcı klasörüne kopyalar); örnekler silinemez. `examples` verilmezse tek klasörlü eski
    davranış sürer (iki dizin config sabitlerinden gelir; bağlantı api.py'de)."""

    def __init__(self, directory: Path, examples: Path | None = None):
        self.dir = directory
        self.dir.mkdir(parents=True, exist_ok=True)
        self.examples = examples if examples and Path(examples).resolve() != Path(directory).resolve() else None
        self.on_write: Callable[[Path], None] | None = None  # FAZB2: yazım/silme sonrası kanca (studio.config_cdc)

    def _dirs(self) -> list[Path]:
        return [self.dir] + ([self.examples] if self.examples and self.examples.is_dir() else [])

    def _localized(self, path: Path) -> Path:
        """Örnek akışın İngilizce kopyası (`<örnekler>/en/<slug>.yaml`, aynı slug ve adım kimlikleri) istek dili
        EN ise kullanılır; kullanıcı akışları olduğu gibi kalır."""
        if request_lang() == "en" and self.examples and path.parent == self.examples:
            en = path.parent / "en" / path.name
            if en.is_file():
                return en
        return path

    def list(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        seen: set[str] = set()
        for d in self._dirs():
            example = d is not self.dir
            for path in sorted(d.glob("*.yaml")):
                if path.stem in seen:
                    continue
                seen.add(path.stem)
                try:
                    item = self._load(self._localized(path)).to_dict()
                except (WorkflowError, yaml.YAMLError, OSError) as exc:
                    item = {"slug": path.stem, "name": path.stem, "error": str(exc), "steps": [], "inputs": []}
                if example:
                    item["example"] = True
                out.append(item)
        return sorted(out, key=lambda w: w["slug"])

    def _path(self, slug: str, base: Path | None = None) -> Path:
        """Slug'ı doğrular ve yolun kütüphane klasöründe kaldığını garanti eder (QA-B1: '..\\' ile yol
        geçişi). Geçersiz slug 'bulunamadı' (KeyError → 404) sayılır."""
        root = base or self.dir
        if not isinstance(slug, str) or not _ID.match(slug):
            raise KeyError(slug)
        path = (root / f"{slug}.yaml").resolve()
        if path.parent != root.resolve():
            raise KeyError(slug)
        return path

    def _find(self, slug: str) -> Path | None:
        for d in self._dirs():
            path = self._path(slug, d)
            if path.is_file():
                return self._localized(path)
        return None

    def exists(self, slug: str) -> bool:
        try:
            return self._find(slug) is not None
        except KeyError:
            return False

    def get(self, slug: str) -> WorkflowSpec:
        path = self._find(slug)
        if path is None:
            raise KeyError(slug)
        return self._load(path)

    def save(self, data: dict[str, Any]) -> WorkflowSpec:
        problem = internal_step_problem(data)
        if problem:
            raise WorkflowError(problem)
        spec = parse(data)
        atomic_write_text(self._path(spec.slug), yaml.safe_dump(spec.to_dict(), allow_unicode=True, sort_keys=False))
        if self.on_write is not None:
            self.on_write(self._path(spec.slug))
        return spec

    def delete(self, slug: str) -> None:
        path = self._path(slug)
        if not path.is_file():
            if self.examples and self._path(slug, self.examples).is_file():
                raise ValueError("Örnek iş akışları silinemez; kopyasını oluşturup düzenleyebilirsin")
            raise KeyError(slug)
        path.unlink()
        if self.on_write is not None:
            self.on_write(path)

    @staticmethod
    def _load(path: Path) -> WorkflowSpec:
        data = yaml.safe_load(path.read_text("utf-8")) or {}
        data.setdefault("slug", path.stem)
        return parse(data)


# ---------------------------------------------------------------- PROC-FIX teslim adımı
REVIEW_WORDS = ("denetçi", "denetci", "denetim", "review", "reviewer", "auditor", "audit", "gözden geçir", "hakem")


def _parse_deliverable(raw: Any) -> str | list[str] | None:
    """PROC2-FIX `deliverable` → tek kimlik (metin) ya da sıralı, tekrarsız kimlik listesi. Tek öğeli liste metne
    iner (eski kayıtlarla aynı biçim); boş → None. Liste dışı/metin dışı değer WorkflowError."""
    if raw is None or raw == "" or raw == []:
        return None
    if isinstance(raw, str):
        return raw.strip() or None
    if isinstance(raw, (list, tuple)):
        out: list[str] = []
        for x in raw:
            if not isinstance(x, str):
                raise WorkflowError("deliverable bir adım kimliği ya da kimlik listesi olmalı")
            x = x.strip()
            if x and x not in out:
                out.append(x)
        if len(out) > MAX_DELIVERABLE_STEPS:
            raise WorkflowError(f"deliverable en çok {MAX_DELIVERABLE_STEPS} adım olabilir")
        return None if not out else out[0] if len(out) == 1 else out
    raise WorkflowError("deliverable bir adım kimliği ya da kimlik listesi olmalı")


MAX_DELIVERABLE_STEPS = 8


def deliverable_ids(spec_or_value: Any) -> list[str]:
    """Teslim adımı kimlikleri (sıralı). `WorkflowSpec`, sözlük (kontrol noktası tanımı) ya da ham değer alır."""
    raw = spec_or_value
    if isinstance(spec_or_value, WorkflowSpec):
        raw = spec_or_value.deliverable
    elif isinstance(spec_or_value, dict):
        raw = spec_or_value.get("deliverable")
    elif hasattr(spec_or_value, "deliverable") and not isinstance(spec_or_value, (str, list, tuple)):
        raw = getattr(spec_or_value, "deliverable", None)
    if isinstance(raw, str):
        return [raw] if raw.strip() else []
    if isinstance(raw, (list, tuple)):
        out: list[str] = []
        for x in raw:
            if isinstance(x, str) and x.strip() and x.strip() not in out:
                out.append(x.strip())
        return out
    return []


def combine_deliverable(parts: list[tuple[str, str]]) -> str:
    """PROC2-FIX çok adımlı teslim = adım çıktılarının sırayla, başlıklı birleşimi. Tek parça başlıksız aynen."""
    parts = [(t, o) for t, o in parts if (o or "").strip()]
    if len(parts) == 1:
        return parts[0][1]
    sep, nl = chr(10) * 2, chr(10)
    return sep.join(f"## {title}{nl}{nl}{out.strip()}" for title, out in parts)


def default_deliverable(spec: WorkflowSpec) -> str | None:
    """Teslim adımı: `deliverable:` verildiyse ilki, yoksa son ajan adımı (geriye uyum)."""
    ids = [d for d in deliverable_ids(spec) if any(s.id == d for s in spec.steps)]
    if ids:
        return ids[0]
    agentic = [s.id for s in spec.steps if s.type in AGENTIC_TYPES]
    return agentic[-1] if agentic else None


def review_like(step: StepSpec, agent: dict[str, Any] | None = None) -> bool:
    """Denetim/gözden geçirme türü adım mı: açık `kind: review` ya da ajanın rolü/açıklaması denetçi/review diyor."""
    if step.type not in AGENTIC_TYPES:
        return False
    if step.kind == "review":
        return True
    props = (agent or {}).get("props", agent) or {}
    text = " ".join(str(props.get(k) or "") for k in ("role", "description", "title", "name")).lower()
    text += " " + str(step.role or "").lower()
    return any(w in text for w in REVIEW_WORDS)


def deliverable_warning(spec: WorkflowSpec, agent_of: Any = None) -> dict[str, Any] | None:
    """Düzenleyici uyarısı: teslim adımı seçilmemiş ve son ajan adımı denetim türündeyse teslim olarak denetim listesi
    sayılır (süreç testi A). `agent_of(slug)` ajan düğümünü döner.

    Öneri (PROC2-FIX): denetim adımının denetlediği (bağımlı olduğu) denetim dışı adımlar — yazan/üreten adımlar;
    hiçbiri yoksa son denetim dışı adım. Denetim adımı asla önerilmez. `suggest` = ilk öneri (geriye uyum);
    birden çok üretici varsa `suggest_all` = hepsi (adım sırasıyla)."""
    if spec.deliverable:
        return None
    agentic = [s for s in spec.steps if s.type in AGENTIC_TYPES]
    if not agentic:
        return None

    def agent(st: StepSpec) -> Any:
        return agent_of(st.agent) if callable(agent_of) and st.agent else None

    last = agentic[-1]
    if not review_like(last, agent(last)):
        return None
    order = [s.id for s in spec.steps]
    reviewed = {d for d in effective_deps([asdict(s) for s in spec.steps]).get(last.id, set())}
    producers = [s.id for s in agentic[:-1] if s.id in reviewed and not review_like(s, agent(s))]
    producers.sort(key=order.index)
    if not producers:
        fallback = next((s.id for s in reversed(agentic[:-1]) if not review_like(s, agent(s))), None)
        producers = [fallback] if fallback else []
    out: dict[str, Any] = {"code": "last_step_is_review", "step": last.id, "suggest": producers[0] if producers else None}
    if len(producers) > 1:
        out["suggest_all"] = producers
    return out


# ---------------------------------------------------------------- PROC2-FIX zayıf yazar uyarısı
# Doğrulanmış olgulara sadakat isteyen adım: istemi doğrulama tablosuna uymayı söyler ya da bir denetim/doğrulama
# adımından sonra gelir. Böyle bir adım küçük (≤ 9B) yerel modele verilirse düzenleyici uyarır; beyni kendisi değiştirmez.
FAITHFUL_RE = re.compile(r"do[gğ]rulama\s+tablo|do[gğ]rulanm[ıi][sş]\s+olgu|verification\s+table|verified\s+facts",
                         re.IGNORECASE)
VERIFY_TITLE_RE = re.compile(r"do[gğ]rula|verif", re.IGNORECASE)
SMALL_MODEL_B = 9.0
_SIZE_RE = re.compile(r"(?<![\d.])(\d+(?:\.\d+)?)\s*b(?![a-z])", re.IGNORECASE)
# uzmanlar karışımı (MoE) "8x7B" = 8 uzman × 7B; dikkat katmanları ortak olduğundan toplam ≈ n × s × 0,835
# (Mixtral 8x7B ≈ 46,7B; 8x22B ≈ 141B). "7B" diye okunmaz.
_MOE_RE = re.compile(r"(?<![\d.])(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*([bm])(?![a-z])", re.IGNORECASE)
MOE_SHARED_FACTOR = 0.835


def _moe_b(text: str) -> float | None:
    m = _MOE_RE.search(text)
    if not m:
        return None
    per = float(m.group(2)) / (1000 if m.group(3).lower() == "m" else 1)
    return round(int(m.group(1)) * per * MOE_SHARED_FACTOR, 1)


def model_size_b(model: str | None) -> float | None:
    """Model adındaki parametre sayısı (milyar): "qwen3.5-9b-64k" → 9, "qwen3:8b" → 8, "mixtral:8x7b" → ≈ 46,8 (MoE
    toplamı); bulunamazsa None."""
    text = str(model or "")
    moe = _moe_b(text)
    if moe is not None:
        return moe
    m = _SIZE_RE.search(text)
    return float(m.group(1)) if m else None


def needs_faithful_writer(spec: WorkflowSpec, step: StepSpec) -> bool:
    if step.type not in AGENTIC_TYPES or step.kind == "review":
        return False
    if FAITHFUL_RE.search(step.prompt or ""):
        return True
    deps = effective_deps([asdict(s) for s in spec.steps]).get(step.id, set())
    for s in spec.steps:
        if s.id in deps and (s.kind == "review" or VERIFY_TITLE_RE.search(s.title or "")):
            return True
    return False


_PARAM_SIZE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*([BM])", re.IGNORECASE)


def param_size_b(value: Any) -> float | None:
    """Ollama `/api/show` / `/api/tags` ayrıntısındaki `parameter_size` ("3.2B", "800M", MoE "8x7B" → ≈ 46,8) → milyar;
    yoksa None."""
    moe = _moe_b(str(value or ""))
    if moe is not None:
        return moe
    m = _PARAM_SIZE_RE.search(str(value or ""))
    if not m:
        return None
    n = float(m.group(1))
    return n / 1000 if m.group(2).upper() == "M" else n


def weak_writer_warnings(spec: WorkflowSpec, route_of: Any, size_of: Any = None) -> list[dict[str, Any]]:
    """`route_of(step) -> (yerel mi, model)`; uyarılar `[{code, step, model, size_b}]` (beyin değiştirilmez).

    adında boyut olmayan yerel model (`llama3.2`, `gemma3`, `phi4-mini`, `mistral` …) için boyut
    `size_of(model)` ile Ollama ayrıntısından (`parameter_size`) okunur. Orada da yoksa model "küçük olabilir" sayılır:
    `weak_local_writer_unknown` (daha yumuşak uyarı, `size_b: None`)."""
    out: list[dict[str, Any]] = []
    for s in spec.steps:
        if not needs_faithful_writer(spec, s):
            continue
        try:
            local, model = route_of(s)
        except Exception:  # noqa: BLE001 - rota çözülemezse uyarı yok
            continue
        if not local or not model:
            continue
        size = model_size_b(model)
        if size is None and size_of is not None:
            try:
                size = param_size_b(size_of(model))
            except Exception:  # noqa: BLE001 - ayrıntı okunamazsa boyut bilinmiyor
                size = None
        if size is None:
            out.append({"code": "weak_local_writer_unknown", "step": s.id, "model": model, "size_b": None})
        elif size <= SMALL_MODEL_B:
            out.append({"code": "weak_local_writer", "step": s.id, "model": model, "size_b": size})
    return out
