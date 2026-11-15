"""Paylaşım paketi (`voxcrew-share`, sürüm 1): katı şema, boyut sınırı ve dışa aktarma temizliği. Saf; G/Ç yok.

Paket dosyası GÜVENİLMEYEN VERİDİR:
- En çok `MAX_BUNDLE_BYTES` (256 KB) ve `MAX_ITEMS` öğe. Bilinmeyen alan (üst düzeyde, öğede, iş akışında, adımda,
  girdide) paketin tamamını reddeder; sessizce yok sayılmaz.
- Kimlikler `ID_RE` ile sınırlıdır (küçük harf, rakam, - ve _): `../` ya da mutlak yol içeren ad dosya adına, slug'a
  ya da graf anahtarına dönüşemez.
- Metinler NUL ve denetim karakteri içeremez (satır sonu ve sekme hariç) ve alan başına uzunluk sınırlıdır.

Dışa aktarmada her metin `delivery.safety.redact(pii=True)` (sır + kişisel veri) ve mutlak yol temizliğinden geçer:
çalışma klasörü → `<WORKDIR>`, ev klasörü → `~`, kalan mutlak yollar → `<PATH>`.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from studio.workflow.spec import InputSpec, StepSpec

FORMAT = "voxcrew-share"
VERSION = 1
MAX_BUNDLE_BYTES = 256 * 1024
MAX_ITEMS = 50
KINDS = ("job", "agent", "output")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,40}$")
TOP_KEYS = frozenset({"format", "version", "exported_at", "items"})
ITEM_KEYS = {
    "job": frozenset({"kind", "id", "name", "workflow", "baseline"}),
    "agent": frozenset({"kind", "id", "name", "title", "role", "persona", "rank", "color", "avatar", "brain",
                        "permissions"}),
    "output": frozenset({"kind", "id", "name", "description", "format", "sections", "rules"}),
}
WORKFLOW_KEYS = frozenset({"slug", "name", "description", "icon", "inputs", "steps", "defaults", "budget", "acceptance",
                           "quality"})
STEP_KEYS = frozenset(StepSpec.__dataclass_fields__)
INPUT_KEYS = frozenset(InputSpec.__dataclass_fields__)
BASELINE_KEYS = frozenset({"manual_minutes", "review_minutes"})
BRAIN_KEYS = frozenset({"connection", "model"})
BRAINS = ("ollama", "codex", "claude", "openai_compat", "hermes", "profile")
IMPORT_BRAINS = ("ollama", "codex", "claude", "openai_compat")  # Hermes profili yereldir: içe aktarılamaz
PERMISSIONS = ("read", "write")
RANKS = ("ceo", "deputy", "director", "manager", "lead", "senior", "specialist", "analyst", "intern")
OUTPUT_FORMATS = ("md", "docx", "diff", "json", "txt")
RULE_RE = re.compile(r"^(?:cite_sources|no_unverified_claims|has_owner_and_date|no_pii|drafts_only"
                     r"|(?:min|max)_(?:words|chars):\d{1,6})$")
HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
AVATAR_KEY_RE = re.compile(r"^[A-Za-z]{1,24}$")
MODEL_RE = re.compile(r"^[\w.:/@+-]{0,120}$")
MAX_SECTIONS = 30
MAX_RULES = 20
MAX_AVATAR_KEYS = 20
LIMITS = {"name": 120, "title": 120, "role": 2000, "persona": 4000, "description": 1000, "section": 160, "any": 20000}
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# yön değiştirme (bidi gömme/geçersiz kılma/yalıtma) denetimleri her metinde; sıfır genişlikli ve yön işaretleri
# ad/başlık gibi kısa alanlarda reddedilir (istemlerde önizlemede görünür yapılır: `visible`).
_BIDI = re.compile(r"[‪-‮⁦-⁩]")
_INVISIBLE = re.compile(r"[​‌‎‏‪-‮⁠-⁤⁦-⁩﻿؜]")  # ZWJ (emoji) serbest
_NAME_FIELDS = ("name", "title", "id", "slug", "agent")


def visible(text: str) -> str:
    """Görünmez/yön denetim karakterlerini `⟨U+202E⟩` biçiminde görünür yapar (içe aktarma önizlemesi)."""
    return _INVISIBLE.sub(lambda m: f"⟨U+{ord(m.group(0)):04X}⟩", str(text or ""))


class BundleError(ValueError):
    """Paket reddedildi; `errors` kullanıcıya gösterilir (değer değil, alan yolu)."""

    def __init__(self, errors: list[str], status: int = 400):
        super().__init__("; ".join(errors[:5]))
        self.errors = errors[:50]
        self.status = status


# ---------------------------------------------------------------- doğrulama (içe aktarma)
def _text(v: Any, where: str, errors: list[str], limit: int, *, required: bool = False) -> None:
    if v is None:
        if required:
            errors.append(f"{where}: gerekli")
        return
    if not isinstance(v, str):
        errors.append(f"{where}: metin olmalı")
        return
    if required and not v.strip():
        errors.append(f"{where}: boş olamaz")
    if len(v) > limit:
        errors.append(f"{where}: en fazla {limit} karakter")
    if _CTRL.search(v):
        errors.append(f"{where}: denetim karakteri içeremez")
    short = limit <= LIMITS["section"] or where.rsplit(".", 1)[-1].split("[", 1)[0] in _NAME_FIELDS
    if _BIDI.search(v) or (short and _INVISIBLE.search(v)):
        errors.append(f"{where}: yön değiştiren ya da görünmez karakter içeremez")


def _unknown(d: dict[str, Any], allowed: frozenset[str], where: str, errors: list[str]) -> None:
    for k in d:
        if k not in allowed:
            errors.append(f"{where}: bilinmeyen alan {str(k)[:40]!r}")


def _strings(obj: Any, where: str, errors: list[str], depth: int = 0) -> None:
    """Ağacın her metin yaprağı: denetim karakteri yok, genel uzunluk sınırı; aşırı derin yapı yok."""
    if depth > 12:
        errors.append(f"{where}: yapı çok derin")
        return
    if isinstance(obj, str):
        _text(obj, where, errors, LIMITS["any"])
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if not isinstance(k, str) or len(k) > 80 or _CTRL.search(k):
                errors.append(f"{where}: geçersiz anahtar")
                continue
            _strings(v, f"{where}.{k}", errors, depth + 1)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _strings(v, f"{where}[{i}]", errors, depth + 1)
    elif obj is not None and not isinstance(obj, (bool, int, float)):
        errors.append(f"{where}: desteklenmeyen değer")


def _check_job(item: dict[str, Any], where: str, errors: list[str]) -> None:
    wf = item.get("workflow")
    if not isinstance(wf, dict):
        errors.append(f"{where}.workflow: nesne olmalı")
        return
    _unknown(wf, WORKFLOW_KEYS, f"{where}.workflow", errors)
    if wf.get("slug") not in (None, item.get("id")):
        errors.append(f"{where}.workflow.slug: öğe kimliğiyle aynı olmalı")
    _text(wf.get("name"), f"{where}.workflow.name", errors, LIMITS["name"])
    _text(wf.get("description"), f"{where}.workflow.description", errors, LIMITS["description"])
    steps = wf.get("steps")
    if not isinstance(steps, list) or not steps or len(steps) > 60:
        errors.append(f"{where}.workflow.steps: 1–60 adımlık liste olmalı")
    else:
        for i, s in enumerate(steps):
            if not isinstance(s, dict):
                errors.append(f"{where}.workflow.steps[{i}]: nesne olmalı")
                continue
            _unknown(s, STEP_KEYS, f"{where}.workflow.steps[{i}]", errors)
    inputs = wf.get("inputs") or []
    if not isinstance(inputs, list) or len(inputs) > 30:
        errors.append(f"{where}.workflow.inputs: en çok 30 girdilik liste olmalı")
    else:
        for i, inp in enumerate(inputs):
            if not isinstance(inp, dict):
                errors.append(f"{where}.workflow.inputs[{i}]: nesne olmalı")
                continue
            _unknown(inp, INPUT_KEYS, f"{where}.workflow.inputs[{i}]", errors)
    base = item.get("baseline")
    if base is not None:
        if not isinstance(base, dict):
            errors.append(f"{where}.baseline: nesne olmalı")
        else:
            _unknown(base, BASELINE_KEYS, f"{where}.baseline", errors)
            man, rev = base.get("manual_minutes"), base.get("review_minutes", 0)
            if (isinstance(man, bool) or isinstance(rev, bool) or not isinstance(man, int) or not isinstance(rev, int)
                    or not 0 < man <= 1440 or not 0 <= rev <= 1440):
                errors.append(f"{where}.baseline: manual_minutes 1–1440, review_minutes 0–1440 tam sayı olmalı")


def _check_agent(item: dict[str, Any], where: str, errors: list[str]) -> None:
    for k in ("title",):
        _text(item.get(k), f"{where}.{k}", errors, LIMITS["title"])
    _text(item.get("role"), f"{where}.role", errors, LIMITS["role"])
    _text(item.get("persona"), f"{where}.persona", errors, LIMITS["persona"])
    if item.get("rank") is not None and item.get("rank") not in RANKS:
        errors.append(f"{where}.rank: bilinmeyen rütbe")
    if item.get("color") is not None and not (isinstance(item["color"], str) and HEX_RE.match(item["color"])):
        errors.append(f"{where}.color: #RRGGBB olmalı")
    if item.get("permissions") is not None and item.get("permissions") not in PERMISSIONS:
        errors.append(f"{where}.permissions: read ya da write olmalı")
    av = item.get("avatar")
    if av is not None:
        if not isinstance(av, dict) or len(av) > MAX_AVATAR_KEYS:
            errors.append(f"{where}.avatar: en çok {MAX_AVATAR_KEYS} alanlı nesne olmalı")
        else:
            for k, v in av.items():
                if not AVATAR_KEY_RE.match(str(k)) or not isinstance(v, str) or len(v) > 40 or _CTRL.search(v):
                    errors.append(f"{where}.avatar: geçersiz alan {str(k)[:24]!r}")
    brain = item.get("brain")
    if brain is not None:
        if not isinstance(brain, dict):
            errors.append(f"{where}.brain: nesne olmalı")
        else:
            _unknown(brain, BRAIN_KEYS, f"{where}.brain", errors)
            if brain.get("connection") is not None and brain.get("connection") not in BRAINS:
                errors.append(f"{where}.brain.connection: bilinmeyen beyin")
            m = brain.get("model")
            if m is not None and not (isinstance(m, str) and MODEL_RE.match(m)):
                errors.append(f"{where}.brain.model: geçersiz model adı")


def _check_output(item: dict[str, Any], where: str, errors: list[str]) -> None:
    _text(item.get("description"), f"{where}.description", errors, LIMITS["description"])
    if item.get("format", "md") not in OUTPUT_FORMATS:
        errors.append(f"{where}.format: {', '.join(OUTPUT_FORMATS)} olmalı")
    secs = item.get("sections")
    if not isinstance(secs, list) or not secs or len(secs) > MAX_SECTIONS:
        errors.append(f"{where}.sections: 1–{MAX_SECTIONS} bölümlük liste olmalı")
    else:
        for i, s in enumerate(secs):
            _text(s, f"{where}.sections[{i}]", errors, LIMITS["section"], required=True)
    rules = item.get("rules") or []
    if not isinstance(rules, list) or len(rules) > MAX_RULES:
        errors.append(f"{where}.rules: en çok {MAX_RULES} kurallık liste olmalı")
    else:
        for r in rules:
            if not isinstance(r, str) or not RULE_RE.match(r):
                errors.append(f"{where}.rules: bilinmeyen kalite kuralı {str(r)[:40]!r}")


def check_bundle(data: Any) -> list[dict[str, Any]]:
    """Paket → doğrulanmış öğe listesi (yapısal). Hata varsa tamamı reddedilir (BundleError)."""
    errors: list[str] = []
    if not isinstance(data, dict):
        raise BundleError(["Paket bir JSON nesnesi olmalı"])
    _unknown(data, TOP_KEYS, "paket", errors)
    if data.get("format") != FORMAT:
        errors.append(f"paket.format: '{FORMAT}' olmalı")
    if data.get("version") != VERSION:
        errors.append(f"paket.version: desteklenen sürüm {VERSION}")
    _text(data.get("exported_at"), "paket.exported_at", errors, 40)
    items = data.get("items")
    if not isinstance(items, list) or not items:
        errors.append("paket.items: boş olmayan bir liste olmalı")
        raise BundleError(errors)
    if len(items) > MAX_ITEMS:
        raise BundleError(errors + [f"paket.items: en çok {MAX_ITEMS} öğe"])
    seen: set[tuple[str, str]] = set()
    for i, item in enumerate(items):
        where = f"items[{i}]"
        if not isinstance(item, dict):
            errors.append(f"{where}: nesne olmalı")
            continue
        kind = item.get("kind")
        if kind not in KINDS:
            errors.append(f"{where}.kind: job, agent ya da output olmalı")
            continue
        _unknown(item, ITEM_KEYS[kind], where, errors)
        iid = item.get("id")
        if not isinstance(iid, str) or not ID_RE.match(iid):
            errors.append(f"{where}.id: küçük harf, rakam, - ve _ (en çok 41) olmalı; yol ya da '..' içeremez")
        elif (kind, iid) in seen:
            errors.append(f"{where}.id: aynı türde tekrarlanan kimlik {iid}")
        else:
            seen.add((kind, iid))
        _text(item.get("name"), f"{where}.name", errors, LIMITS["name"], required=True)
        _strings(item, where, errors)
        {"job": _check_job, "agent": _check_agent, "output": _check_output}[kind](item, where, errors)
    if errors:
        raise BundleError(errors)
    return items


# ---------------------------------------------------------------- temizleme (dışa aktarma)
_ABS_PATH = re.compile(
    r"(?<![\w/\\:.~<>-])(?:[A-Za-z]:[\\/]|\\\\[^\s\\/]+[\\/]"
    r"|/(?:home|Users|root|mnt|media|var|etc|opt|tmp|private|Volumes|srv|usr|data|workspace|run|snap)/)"
    r"[^\s\"'<>|`)\]]*")
_FILE_URL = re.compile(r"\bfile:/{2,3}[^\s\"'<>|`)\]]+", re.I)  # file:///C:/… da yerel yoldur


class Scrubber:
    """Dışa giden metin: sır + kişisel veri maskesi ve mutlak yol temizliği. Değişen alan yolları `hits`te."""

    def __init__(self, home: str | None = None, workdir: str | None = None):
        self.home = home if home is not None else str(Path.home())
        self.workdir = workdir or ""
        self.hits: list[str] = []

    @staticmethod
    def _replace_root(text: str, root: str, repl: str) -> str:
        if not root or len(root) < 3:
            return text
        variants = {root, root.replace("\\", "/"), root.replace("/", "\\")}
        for v in sorted(variants, key=len, reverse=True):
            flags = re.I if os.name == "nt" else 0
            text = re.sub(re.escape(v.rstrip("\\/")) + r"(?=[\\/]|\b|$)", lambda _m: repl, text, flags=flags)
        return text

    def text(self, value: Any, where: str = "") -> str:
        from studio.delivery.safety import redact  # noqa: PLC0415 - döngüsel içe aktarmadan kaçın
        raw = "" if value is None else str(value)
        out = redact(raw, pii=True)
        out = self._replace_root(out, self.workdir, "<WORKDIR>")
        out = self._replace_root(out, self.home, "~")
        out = _FILE_URL.sub("<PATH>", out)
        out = _ABS_PATH.sub("<PATH>", out)
        if out != raw and where:
            self.hits.append(where)
        return out

    def tree(self, obj: Any, where: str, skip: frozenset[str] = frozenset()) -> Any:
        if isinstance(obj, str):
            return self.text(obj, where)
        if isinstance(obj, dict):
            return {k: (v if k in skip else self.tree(v, f"{where}.{k}", skip)) for k, v in obj.items()}
        if isinstance(obj, list):
            return [self.tree(v, f"{where}[{i}]", skip) for i, v in enumerate(obj)]
        return obj


# iş akışında yapısal (kimlik / sıralama / enum) alanlar: maskelenmez (anlamı bozulmasın)
WORKFLOW_STRUCT_KEYS = frozenset({"slug", "id", "type", "agent", "role", "depends_on", "connection", "icon",
                                  "hiring_approval", "plan_approval", "backoff", "on_fail", "on_exceeded", "reviewer",
                                  "kind", "match", "file_type", "rules", "target", "until", "required"})


# ---------------------------------------------------------------- fark (çakışan öğe)
def _flat(obj: Any, prefix: str, out: dict[str, str], depth: int = 0) -> None:
    if depth > 8 or len(out) > 400:
        return
    if isinstance(obj, dict):
        for k in sorted(obj):
            _flat(obj[k], f"{prefix}.{k}" if prefix else str(k), out, depth + 1)
    elif isinstance(obj, list) and obj and all(isinstance(x, dict) and "id" in x for x in obj):
        for x in obj:
            _flat({k: v for k, v in x.items() if k != "id"}, f"{prefix}[{x['id']}]", out, depth + 1)
    elif isinstance(obj, list):
        out[prefix] = ", ".join(str(x) if not isinstance(x, (dict, list)) else "…" for x in obj)
    elif obj not in (None, ""):
        out[prefix] = str(obj)


def flat_diff(before: Any, after: Any, limit: int = 40) -> list[dict[str, str]]:
    """Mevcut ↔ gelen: değişen alanlar [{field, before, after}] (kısaltılmış)."""
    a: dict[str, str] = {}
    b: dict[str, str] = {}
    _flat(before, "", a)
    _flat(after, "", b)
    out = []
    for k in sorted(set(a) | set(b)):
        if a.get(k) != b.get(k):
            out.append({"field": k, "before": (a.get(k) or "")[:300], "after": (b.get(k) or "")[:300]})
        if len(out) >= limit:
            break
    return out
