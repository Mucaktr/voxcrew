"""Ofis şablonları (veri olarak YAML): ekipler, roller, rütbeler, raporlama hattı ve iş akışı.

Şablon dosyaları `office/templates/*.yaml`. Rol anahtarı (key) hem ajan slug'ının hem Role.id'nin tabanıdır
(önek verilirse "<önek>-<key>"). İş akışı adımları `role: <key>` (eski şablonlarda `agent: <key>`) ile role
başvurur; kurulumda adımlar `role: <Role.id>` olarak yazılır ve ajan çalışma anında rolden çözülür (QA-M1).
`skills_hint` gerçek Hermes skill adlarıdır (QA-M2; kurulu olmayanlar arayüzde "kurulu değil" işaretlenir).
`brain_hint` (light | standard | heavy) beyin stratejisinde rolün ağırlığıdır (QA-M5).

Dil (S16): şablonlarda `name_en`, `description_en` (şablon ve iş akışı), ekiplerde `name_en`/`mission_en`,
rollerde `title_en`/`role_en`/`persona_en`, adımlarda `title_en`/`message_en`, girdilerde `label_en` alanları vardır.
`summary(t, lang)` ve `localize_template(t, lang)` istek diline göre doğru alanı döner; EN alanı olmayan (ör. pazar
yerinden kurulan) şablon Türkçesiyle kalır. `missing_translations(t)` eksik EN alanlarını listeler.
"""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, Callable

import yaml

from studio.i18n import request_lang
from studio.office.ranks import RANKS, rank_label
from studio.workflow.spec import AGENTIC_TYPES

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"

ROLE_FIELDS = ("key", "name", "title", "team", "reports_to", "color", "role", "persona",
               "skills_hint", "toolsets_hint", "avatar", "permissions", "rank", "brain_hint")
TEAM_FIELDS = ("key", "name", "mission", "color", "icon", "lead")
BRAIN_HINTS = ("light", "standard", "heavy")


def step_role_key(step: dict[str, Any]) -> str | None:
    """Şablon adımının başvurduğu rol anahtarı (`role:` ya da eski `agent:`)."""
    return step.get("role") or step.get("agent")


def levels(t: dict[str, Any]) -> int:
    """Raporlama hattındaki düzey sayısı (kök = 1)."""
    parent = {r.get("key"): r.get("reports_to") for r in t.get("roles") or []}
    best = 0
    for key in parent:
        depth, cur, seen = 0, key, set()
        while cur and cur not in seen:
            seen.add(cur)
            depth += 1
            cur = parent.get(cur)
        best = max(best, depth)
    return best


def install_order(t: dict[str, Any]) -> list[str]:
    """Kurulum kuralı : roller hiyerarşide yukarıdan aşağı (kök önce), aynı düzeyde dosya sırasıyla.
    Ajanlar bu sırayla oluşturulur; koltuk dolunca kalanlar yedekte doğar (E1). Böylece etkin kadro = ilk N rol."""
    roles = t.get("roles") or []
    parent = {r.get("key"): r.get("reports_to") for r in roles}

    def depth(key: str) -> int:
        d, cur, seen = 0, parent.get(key), {key}
        while cur and cur not in seen:
            seen.add(cur)
            d += 1
            cur = parent.get(cur)
        return d
    order = {r.get("key"): i for i, r in enumerate(roles)}
    return sorted((r["key"] for r in roles), key=lambda k: (depth(k), order[k]))


class TemplateError(ValueError):
    pass


def check_template(t: dict[str, Any]) -> list[str]:
    """Şablonun iç tutarlılığı: benzersiz anahtarlar, bilinen ekip/rol başvuruları, döngüsüz raporlama."""
    errors: list[str] = []
    tid = t.get("id") or "?"
    teams = [tm.get("key") for tm in t.get("teams") or []]
    roles = [r.get("key") for r in t.get("roles") or []]
    if not teams or not roles:
        errors.append(f"{tid}: ekip ve rol listesi boş olamaz")
    if len(set(teams)) != len(teams):
        errors.append(f"{tid}: ekip anahtarları benzersiz olmalı")
    if len(set(roles)) != len(roles):
        errors.append(f"{tid}: rol anahtarları benzersiz olmalı")
    for tm in t.get("teams") or []:
        if tm.get("lead") and tm["lead"] not in roles:
            errors.append(f"{tid}: {tm.get('key')} ekibinin lideri bilinmiyor: {tm['lead']}")
    parent: dict[str, str | None] = {}
    for r in t.get("roles") or []:
        if r.get("team") not in teams:
            errors.append(f"{tid}: {r.get('key')} rolünün ekibi bilinmiyor: {r.get('team')}")
        if r.get("reports_to") and r["reports_to"] not in roles:
            errors.append(f"{tid}: {r.get('key')} bilinmeyen role raporluyor: {r['reports_to']}")
        if not r.get("title") or not r.get("name"):
            errors.append(f"{tid}: {r.get('key')} rolünün adı ve unvanı olmalı")
        if r.get("permissions", "read") not in ("read", "write"):
            errors.append(f"{tid}: {r.get('key')} izni 'read' ya da 'write' olmalı")
        if r.get("rank") is not None and r.get("rank") not in RANKS:
            errors.append(f"{tid}: {r.get('key')} rütbesi bilinmiyor: {r.get('rank')}")
        if r.get("brain_hint") is not None and r.get("brain_hint") not in BRAIN_HINTS:
            errors.append(f"{tid}: {r.get('key')} beyin ağırlığı light/standard/heavy olmalı")
        parent[r.get("key")] = r.get("reports_to")
    for start in parent:
        seen, cur = set(), start
        while cur:
            if cur in seen:
                errors.append(f"{tid}: raporlama hattında döngü var ({start})")
                break
            seen.add(cur)
            cur = parent.get(cur)
    wf = t.get("workflow") or {}
    if not wf.get("slug"):
        errors.append(f"{tid}: iş akışı slug'ı yok")
    for s in wf.get("steps") or []:
        if s.get("type", "agent") in AGENTIC_TYPES and step_role_key(s) not in roles:
            errors.append(f"{tid}: iş akışı adımı {s.get('id')} bilinmeyen role bağlı: {step_role_key(s)}")
    return errors


def user_templates_dir() -> Path:
    """Kullanıcı/pazar yeri şablonları: <veri dizini>/office/templates (paketler buraya kurulur)."""
    from studio.config import DATA_DIR
    return DATA_DIR / "office" / "templates"


def _load_dir(directory: Path, source: str) -> list[dict[str, Any]]:
    out = []
    if not directory.is_dir():
        return out
    for path in sorted(directory.glob("*.yaml")):
        try:
            data = yaml.safe_load(path.read_text("utf-8")) or {}
        except (OSError, yaml.YAMLError):
            continue
        if not isinstance(data, dict):
            continue
        data.setdefault("id", path.stem)
        data.setdefault("source", source)
        out.append(data)
    return out


_CACHE: dict[str, Any] = {"key": None, "value": []}


def _dir_key(directory: Path) -> tuple[tuple[str, int, int], ...]:
    try:
        return tuple(sorted((p.name, int(p.stat().st_mtime_ns), p.stat().st_size) for p in directory.glob("*.yaml")))
    except OSError:
        return ()


def load_templates(directory: Path | None = None) -> list[dict[str, Any]]:
    """Yerleşik şablonlar + kullanıcı dizinindekiler (aynı id'de kullanıcınınki kazanır). `directory` verilirse
    yalnızca o dizin okunur (testler). Sonuç dosya mtime/size anahtarıyla önbelleklenir (S15: 146 ms → ~0);
    çağıranlar listeyi değiştirmemeli (derin kopya döndürülür)."""
    import copy
    if directory is not None:
        return sorted(_load_dir(directory, "builtin"), key=lambda t: (t.get("order", 99), t["id"]))
    key = (_dir_key(TEMPLATES_DIR), _dir_key(user_templates_dir()))
    if _CACHE["key"] != key:
        merged = {t["id"]: t for t in _load_dir(TEMPLATES_DIR, "builtin")}
        merged.update({t["id"]: t for t in _load_dir(user_templates_dir(), "user")})
        _CACHE["key"], _CACHE["value"] = key, sorted(merged.values(), key=lambda t: (t.get("order", 99), t["id"]))
    return copy.deepcopy(_CACHE["value"])


def get_template(template_id: str) -> dict[str, Any]:
    for t in load_templates():
        if t["id"] == template_id:
            return t
    raise KeyError(f"Şablon yok: {template_id}")


# Dil duyarlı metin alanları (anahtar → "<anahtar>_en" karşılığı okunur)
TEMPLATE_TEXT = ("name", "description")
TEAM_TEXT = ("name", "mission")
ROLE_TEXT = ("title", "role", "persona")
STEP_TEXT = ("title", "message")
INPUT_TEXT = ("label",)
CATEGORY_EN = {"ofis": "office", "şirket": "company", "stüdyo": "studio", "ajans": "agency",
               "danışmanlık": "consulting", "araştırma": "research", "ikili": "duo"}


def text(d: dict[str, Any], key: str, lang: str | None = None, default: Any = None) -> Any:
    """`d[key]`'in istenen dildeki değeri: lang "en" ve `d[key + "_en"]` doluysa o, yoksa Türkçesi."""
    if (lang or request_lang()) == "en" and d.get(f"{key}_en"):
        return d[f"{key}_en"]
    return d.get(key, default)


def _localize(d: dict[str, Any], keys: tuple[str, ...], lang: str) -> dict[str, Any]:
    out = {k: v for k, v in d.items() if not (k.endswith("_en") and k[:-3] in keys)}
    for k in keys:
        if k in d:
            out[k] = text(d, k, lang)
    return out


def localize_template(t: dict[str, Any], lang: str | None = None) -> dict[str, Any]:
    """Şablonun derin kopyası; tüm metin alanları istenen dilde, `*_en` anahtarları kaldırılmış.

    Ofis servisi (S3/S6) kurulum ve önizlemede bunu kullanırsa ajan unvanı/rol/persona ve ekip adları da istek
    dilinde oluşur (TR'de birebir aynı şablon döner)."""
    lang = lang or request_lang()
    out = _localize(copy.deepcopy(t), TEMPLATE_TEXT, lang)
    out["teams"] = [_localize(tm, TEAM_TEXT, lang) for tm in t.get("teams") or []]
    out["roles"] = [_localize(r, ROLE_TEXT, lang) for r in t.get("roles") or []]
    if isinstance(t.get("workflow"), dict):
        wf = _localize(copy.deepcopy(t["workflow"]), TEMPLATE_TEXT, lang)
        wf["steps"] = [_localize(s, STEP_TEXT, lang) for s in t["workflow"].get("steps") or []]
        if t["workflow"].get("inputs"):
            wf["inputs"] = [_localize(i, INPUT_TEXT, lang) for i in t["workflow"]["inputs"]]
        out["workflow"] = wf
    return out


def missing_translations(t: dict[str, Any]) -> list[str]:
    """Türkçesi dolu olup `*_en` karşılığı boş kalan alanlar ("roles.po.title" gibi); yerleşik şablon testi için."""
    out: list[str] = []

    def check(d: dict[str, Any], keys: tuple[str, ...], where: str) -> None:
        for k in keys:
            if d.get(k) and not d.get(f"{k}_en"):
                out.append(f"{where}.{k}")

    check(t, TEMPLATE_TEXT, t.get("id", "?"))
    for tm in t.get("teams") or []:
        check(tm, TEAM_TEXT, f"teams.{tm.get('key')}")
    for r in t.get("roles") or []:
        check(r, ROLE_TEXT, f"roles.{r.get('key')}")
    wf = t.get("workflow") or {}
    check(wf, TEMPLATE_TEXT, "workflow")
    for s in wf.get("steps") or []:
        check(s, STEP_TEXT, f"workflow.steps.{s.get('id')}")
    for i in wf.get("inputs") or []:
        check(i, INPUT_TEXT, f"workflow.inputs.{i.get('name')}")
    return out


def summary(t: dict[str, Any], lang: str | None = None) -> dict[str, Any]:
    """API'ye dönen şablon görünümü (iş akışı yalnızca slug + adım özetiyle); metinler istek dilinde."""
    lang = lang or request_lang()
    wf = t.get("workflow") or {}
    category = t.get("category", "ofis")
    return {
        "id": t["id"],
        "name": text(t, "name", lang, t["id"]),
        "description": text(t, "description", lang, ""),
        "icon": t.get("icon", "building"),
        "category": CATEGORY_EN.get(category, category) if lang == "en" else category,
        "levels": levels(t),
        "install_order": install_order(t),  # koltuk sırası (yukarıdan aşağı; fazlası yedeğe)
        "teams": [{k: text(tm, k, lang) for k in TEAM_FIELDS} for tm in t.get("teams") or []],
        "roles": [{**{k: text(r, k, lang) for k in ROLE_FIELDS},
                   "permissions": "write" if r.get("permissions") == "write" else "read",
                   "rank_label": rank_label(r.get("rank"), lang),
                   "brain_hint": r.get("brain_hint") or "standard",
                   "skills_hint": list(r.get("skills_hint") or []),
                   "toolsets_hint": list(r.get("toolsets_hint") or [])} for r in t.get("roles") or []],
        "workflow": wf.get("slug"),
        "workflow_name": text(wf, "name", lang, wf.get("slug")),
        "workflow_description": text(wf, "description", lang, ""),
        "workflow_steps": [{"id": s.get("id"), "type": s.get("type", "agent"),
                            "title": text(s, "title", lang, s.get("id")),
                            "role": step_role_key(s) if s.get("type", "agent") != "approval" else None,
                            # geriye uyum: eski arayüz `agent` alanını rol anahtarı olarak okur
                            "agent": step_role_key(s) if s.get("type", "agent") != "approval" else None,
                            "depends_on": list(s.get("depends_on") or [])}
                           for s in wf.get("steps") or []],
    }


def build_workflow(t: dict[str, Any], slug_of: Callable[[str], str], prefix: str = "") -> dict[str, Any]:
    """Şablonun iş akışını `role: <Role.id>` adımlarıyla somutlaştırır (WorkflowLibrary.save'e verilecek sözlük).

    Rol id'si ajan slug'ıyla aynı tabandan üretilir (`slug_of(key)`); ajan çalışma anında rolden çözülür, böylece
    rol başka bir ajana verilince akış YAML düzenlemeden yeni ajanı çalıştırır."""
    wf = copy.deepcopy(t.get("workflow") or {})
    if not wf.get("slug"):
        raise TemplateError(f"{t.get('id')}: iş akışı tanımı yok")
    wf["slug"] = f"{prefix}-{wf['slug']}" if prefix else wf["slug"]
    if prefix:
        wf["name"] = f"{wf.get('name') or wf['slug']} · {prefix}"
    for step in wf.get("steps") or []:
        if step.get("type", "agent") in AGENTIC_TYPES:
            key = step_role_key(step)
            step.pop("agent", None)
            if key:
                step["role"] = slug_of(key)
    return wf
