"""Kalite denetim tanımı (checklist): tariften (CG-RECIPES), görev girdisinden ya da istemden.

Kabul edilen biçim (her alan isteğe bağlı):

    {"required_sections": [{"id", "title": {"tr", "en"}} | "Özet", ...],
     "rules": ["cite_sources", "no_unverified_claims", "has_owner_and_date", "min_words:N", "max_words:N",
               "min_chars:N", "max_chars:N", "no_pii", "drafts_only", ...],
     "file_type": "md" | "docx" | "diff" | "json" | ...,
     "reviewer": bool, "required": bool, "check": "<komut>" | [argv],
     "min_chars" | "max_chars" | "min_words" | "max_words": int, "citations": bool, "pii": bool}

ya da aynı alanlar `{"quality": {...}}` altında. Kaynak sırası (koşu sonunda): koşu girdisi `_recipe.quality` →
`register_checklist` önbelleği → tarif kalite kontrol listesi (full sürüm) → iş akışı YAML `quality:` bloğu →
koşu girdisi `_quality` (görev başına
geçersiz kılma; ör. denetçiyi aç) → istemdeki açık bölüm listesi ("Bölümler: A, B, C").
"""

from __future__ import annotations

import re
import threading
from collections import OrderedDict
from typing import Any

from studio._edition import EDITION

KNOWN_RULES = ("cite_sources", "no_unverified_claims", "has_owner_and_date", "min_words", "max_words", "min_chars",
               "max_chars", "no_pii", "drafts_only")
INT_KEYS = ("min_chars", "max_chars", "min_words", "max_words")
MAX_SECTIONS = 30
_REGISTRY_MAX = 500

_lock = threading.Lock()
_registry: "OrderedDict[str, dict[str, Any]]" = OrderedDict()


def register_checklist(run_id: str, checklist: dict[str, Any]) -> None:
    """CG-RECIPES kancası: koşu başlarken tarifin denetim listesi (bellekte; kalıcı kaynak koşu girdisi `_recipe`)."""
    if not run_id or not isinstance(checklist, dict):
        return
    with _lock:
        _registry[str(run_id)] = dict(checklist)
        _registry.move_to_end(str(run_id))
        while len(_registry) > _REGISTRY_MAX:
            _registry.popitem(last=False)


def registered(run_id: str) -> dict[str, Any] | None:
    with _lock:
        v = _registry.get(str(run_id))
        return dict(v) if v else None


def _as_int(v: Any) -> int | None:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None


def normalize(raw: Any, *, source: str = "spec") -> dict[str, Any]:
    """Herhangi bir biçim → düz denetim tanımı. Bilinmeyen kurallar `unknown_rules` altında (atlandı diye listelenir)."""
    base = raw if isinstance(raw, dict) else {}
    inner = base.get("quality") if isinstance(base.get("quality"), dict) else {}
    merged = {**{k: v for k, v in base.items() if k != "quality"}, **inner}
    out: dict[str, Any] = {"required_sections": [], "rules": [], "unknown_rules": [], "file_type": None,
                           "reviewer": None, "required": False, "check": None, "citations": False, "pii": False,
                           "owner_date": False, "source": source}
    for k in INT_KEYS:
        out[k] = _as_int(merged.get(k))
    secs = merged.get("required_sections") or merged.get("sections") or []
    if isinstance(secs, (list, tuple)):
        out["required_sections"] = [s for s in secs if isinstance(s, (str, dict)) and s][:MAX_SECTIONS]
    rules = merged.get("rules") or []
    if isinstance(rules, str):
        rules = [rules]
    for rule in rules if isinstance(rules, (list, tuple)) else []:
        name, _sep, arg = str(rule).strip().partition(":")
        name = name.strip().lower()
        if name in ("cite_sources", "no_unverified_claims"):
            out["citations"] = True
        elif name == "has_owner_and_date":
            out["owner_date"] = True
        elif name == "no_pii":
            out["pii"] = True
        elif name in INT_KEYS:
            n = _as_int(arg)
            if n is not None:
                out[name] = n
        elif name not in KNOWN_RULES:
            out["unknown_rules"].append(str(rule)[:60])
            continue
        out["rules"].append(str(rule)[:60])
    if merged.get("citations") is True:
        out["citations"] = True
    if merged.get("pii") is True:
        out["pii"] = True
    ft = merged.get("file_type")
    out["file_type"] = str(ft).lower().lstrip(".")[:10] if ft else None
    if isinstance(merged.get("reviewer"), bool):
        out["reviewer"] = merged["reviewer"]
    out["required"] = merged.get("required") is True
    chk = merged.get("check")
    if isinstance(chk, (str, list)) and chk:
        out["check"] = chk
    return out


def quality_required(spec: Any) -> bool:
    """CG-DELIVER / CG-RECIPES: bu tanım teslimden önce kalite kapısı istiyor mu (açık `required` ya da bölüm/kural)."""
    if spec is None:
        return False
    s = spec if isinstance(spec, dict) and "unknown_rules" in spec else normalize(spec)
    return bool(s.get("required") or s.get("required_sections") or s.get("rules"))


def merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    """Görev başına geçersiz kılma: boş olmayan alanlar ezer, bölümler/kurallar birleşir."""
    out = dict(base)
    for k, v in over.items():
        if k in ("required_sections", "rules", "unknown_rules"):
            out[k] = list(base.get(k) or []) + [x for x in v or [] if x not in (base.get(k) or [])]
        elif k in ("citations", "pii", "owner_date", "required"):
            out[k] = bool(base.get(k)) or bool(v)
        elif k == "source":
            continue
        elif v is not None:
            out[k] = v
    return out


_SECTION_LIST = re.compile(r"(?:bölümler|başlıklar|bölüm başlıkları|sections|headings)\s*[:：]\s*(.*)$", re.I)


def sections_from_prompt(prompt: str) -> list[str]:
    """İstemde açıkça istenen bölümler: "Bölümler: Özet, Riskler ve Kaynaklar" ya da hemen altındaki liste."""
    out: list[str] = []
    lines = str(prompt or "").splitlines()
    for i, line in enumerate(lines):
        m = _SECTION_LIST.search(line)
        if not m:
            continue
        rest = m.group(1).strip()
        if rest:
            parts = re.split(r"\s*(?:,|;|\s+ve\s+|\s+and\s+)\s*", rest.rstrip("."))
        else:
            parts = []
            for nxt in lines[i + 1:i + 1 + MAX_SECTIONS]:
                item = re.match(r"^\s*(?:[-*+]|\d+[.)])\s+(.+)$", nxt)
                if not item:
                    break
                parts.append(item.group(1))
        for p in parts:
            name = p.strip(" *_`\"'#").strip()
            if 1 < len(name) <= 60 and name not in out:
                out.append(name)
    return out[:MAX_SECTIONS]


def from_run(run: Any) -> dict[str, Any]:
    """Koşudan (motor `RunState` ya da `to_dict`) denetim tanımı."""
    inputs = getattr(run, "inputs", None)
    if inputs is None and isinstance(run, dict):
        inputs = run.get("inputs")
    inputs = inputs if isinstance(inputs, dict) else {}
    run_id = str(getattr(run, "id", None) or (run.get("id") if isinstance(run, dict) else "") or "")
    recipe = inputs.get("_recipe") if isinstance(inputs.get("_recipe"), dict) else None
    spec: dict[str, Any] | None = None
    if recipe and isinstance(recipe.get("quality"), dict):
        spec = normalize(recipe["quality"], source="recipe")
    if spec is None and run_id:
        reg = registered(run_id)
        if reg:
            spec = normalize(reg, source="recipe")
    if EDITION == "full" and spec is None and recipe and recipe.get("id"):
        try:
            from studio.full.recipes import quality_checklist_for  # CG-RECIPES (isteğe bağlı)
            got = quality_checklist_for(str(recipe["id"]))
            if isinstance(got, dict):
                spec = normalize(got, source="recipe")
        except Exception:  # noqa: BLE001 - tarif modülü yoksa ya da hata verirse istem kaynağına düşülür
            spec = None
    if spec is None:
        # FOLLOWUP: iş akışı YAML'ındaki `quality:` bloğu (tarif yoksa; görev girdisi `_quality` yine üstüne biner)
        wf_quality = getattr(getattr(run, "spec", None), "quality", None)
        if wf_quality is None and isinstance(run, dict) and isinstance(run.get("spec"), dict):
            wf_quality = run["spec"].get("quality")
        if isinstance(wf_quality, dict) and wf_quality:
            spec = normalize(wf_quality, source="workflow")
    if spec is None:
        spec = normalize({}, source="none")
    task = inputs.get("_quality")
    if isinstance(task, dict):
        spec = merge(spec, normalize(task, source="task"))
    if not spec["required_sections"]:
        prompts = []
        steps = getattr(getattr(run, "spec", None), "steps", None) or []
        for st in steps:
            prompts.append(str(getattr(st, "prompt", "") or ""))
        found = sections_from_prompt("\n".join(prompts))
        if found:
            spec["required_sections"] = found
            if spec["source"] == "none":
                spec["source"] = "prompt"
    return spec
