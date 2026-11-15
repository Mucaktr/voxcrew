"""İstem aşaması `skills` (order 30): Hermes dışı beyinlere skill bağlamı enjekte eder.

- Hermes beyni: profilde kurulu skill'ler `-s` bayrağıyla gider (bağlayıcı; burada dokunulmaz). Yalnızca
  Hermes'e verilemeyen atamalar (VoxCrew / Claude kaynaklı) isteme eklenir.
- Diğer beyinler (Ollama, Codex, Claude Code): atanmış tüm skill'ler için önce kısa katalog (ad + açıklama),
  ardından gövdeler `skills.max_chars` bütçesiyle. Bütçe aşılırsa öncelik en son atananlardadır; sığmayanlar
  katalogda kalır ve `ctx.note("skills", injected=[…], truncated=[…], chars=…)` ile raporlanır.
- `skills.inject=false` ise aşama çalışmaz.

Metinler ajan diline (ctx.lang) göre seçilir; görev metnine (TASK) dokunulmaz.

G1-D (sabitleme, kullanıcı kararı 2): bağlama kaydı (`bindings.json`) etkinse yalnız sabitlenmiş sha'nın doğrulanmış
kopyası okunur. `always` gövdesi her adımda, `catalog` yalnız katalogda (anahtara göre sıralı) ve gövdesi yalnız
deterministik seçici seçerse (en çok 2, ayrı `skills_selected` bölümünde), `never` atlanır. Onaysız (`pending`) ya da
kopyası sha ile uyuşmayan (`blocked`) skill isteme girmez ve rapora yazılır. Aşama sırası (order 30) değişmez.
"""

from __future__ import annotations

import re
from typing import Any

from studio.tokens import est_tokens
from studio.workflow.prompting import SKILLS, PromptContext, Section

from .binding import effective
from .library import MAX_SKILL_MD, SkillLibrary, parse_skill_md
from .selector import select

SELECTED = "skills_selected"  # G1-D: seçicinin yüklediği catalog gövdeleri (göreve bağlı, ayrı bölüm)
MIN_BODY_CHARS = 400      # bu kadar yer kalmadıysa gövde eklenmez, skill yalnızca katalogda kalır
DESC_CHARS = 180

TEXT: dict[str, dict[str, str]] = {
    "tr": {
        "title": "SKILL'LER (YETENEK PAKETLERİ)",
        "intro": "Sana atanmış skill'ler aşağıda. Görevle ilgili olanların yönergelerini uygula; ilgisizleri yok say.",
        "catalog": "Katalog:",
        "no_desc": "açıklama yok",
        "omitted": "(gövde bütçeye sığmadı; yalnızca katalogda)",
        "truncated": "[… kırpıldı: skill bağlam bütçesi aşıldı]",
        "skill": "Skill",
        "system": "İstemde '# SKILL'LER' bölümü varsa oradaki yetenek paketlerini görevle ilgili olduğunda kullan.",
    },
    "en": {
        "title": "SKILLS",
        "intro": "Your assigned skills are below. Follow the instructions of the ones relevant to the task; ignore the rest.",
        "catalog": "Catalog:",
        "no_desc": "no description",
        "omitted": "(body omitted: over budget)",
        "truncated": "[… truncated: skill context budget exceeded]",
        "skill": "Skill",
        "system": "If the prompt has a '# SKILLS' section, use those skill packs when they are relevant to the task.",
    },
}


def _clean_body(body: str) -> str:
    text = (body or "").replace("\r\n", "\n").strip()
    return re.sub(r"\n{3,}", "\n\n", text)


_CTRL = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]")


def one_line(text: Any, limit: int = 200) -> str:
    """katalog satırına giren ad/açıklama/anahtar tek satır olur (satır sonu ve denetim karakteri yok;
    `# başlık` enjekte edilemez)."""
    s = " ".join(_CTRL.sub(" ", str(text or "")).split())
    return s[:limit]


def _desc_line(description: str | None, t: dict[str, str]) -> str:
    d = one_line(description, 100000)
    return (d[:DESC_CHARS] + "…") if len(d) > DESC_CHARS else (d or t["no_desc"])


def _pinned_items(library: SkillLibrary, agent: dict[str, Any], inject: list[dict[str, Any]],
                  result: dict[str, Any]) -> list[dict[str, Any]]:
    """Atamaları bağlama kaydına göre süzer (G1-D). Kayıt etkin değilse eski davranış: canlı içerik, `always`.

    Kayıt etkinse yalnız sabitlenmiş sha'nın doğrulanmış kopyası okunur; `never` atlanır, onaysız (`pending`) ve
    kopyası sha ile uyuşmayan (`blocked`) skill isteme hiç girmez ve raporlanır."""
    props = agent.get("props", agent)
    slug = props.get("slug")
    store = getattr(library, "bindings", None)
    snaps = getattr(library, "snapshots", None)
    items: list[dict[str, Any]] = []
    for r in inject:
        key, e = r["key"], r["entry"]
        eff = effective(store, snaps, slug, key) if store is not None and snaps is not None else {
            "mode": "always", "sha": None, "status": "legacy", "content": None}
        result["modes"][key] = eff["mode"]
        if eff.get("sha"):
            result["shas"][key] = eff["sha"]
        status = eff["status"]
        if status == "off":
            result["disabled"].append(key)
            continue
        if status == "pending":
            result["pending"].append(key)
            continue
        if status == "blocked":
            result["blocked"].append(key)
            continue
        item = {"key": key, "mode": eff["mode"], "name": e.get("name"), "description": e.get("description"),
                "tags": list(e.get("tags") or []), "entry": e, "body": None}
        if status == "ok":
            # ad/açıklama/etiketler sha kapsamındaki SKILL.md'den türetilir; sha dışındaki `meta.json`
            # isteme hiçbir metin taşımaz (elle değiştirilse bile)
            files = eff["content"]["files"]
            parsed = parse_skill_md(files["SKILL.md"], e.get("name") or key)
            item["name"] = parsed["name"] or e.get("name")
            item["description"] = parsed["description"]
            item["tags"] = list(parsed["tags"] or [])
            item["body"] = parsed["body"][:MAX_SKILL_MD]
        item["name"] = one_line(item["name"], 120) or None
        items.append(item)
    return items


def plan_injection(library: SkillLibrary, agent: dict[str, Any], *, is_hermes: bool, max_chars: int,
                   lang: str = "tr", task: str | None = None) -> dict[str, Any]:
    """Hangi skill'lerin isteme gireceğini ve metni hesaplar (aşama ve /api/skills/agents/{slug} önizlemesi için).

    G1-D: `always` gövdeleri atama sırasıyla, ardından `catalog` skill'leri anahtara göre sıralı katalogda; catalog
    gövdeleri yalnız seçici (görev metni) seçerse (en çok K = 2). Yalnız `always` atamaları olan ajanın (göç) metni
    eski davranışla bayt bayt aynıdır."""
    t = TEXT.get(lang, TEXT["tr"])
    resolved = library.resolve_assigned(agent)
    flagged = [r["key"] for r in resolved if r["how"] == "hermes_flag"]
    missing = [r["key"] for r in resolved if r["how"] == "missing"]
    inject = [r for r in resolved if r["how"] == "prompt" and r["entry"]]
    result: dict[str, Any] = {"text": "", "selected_text": "", "chars": 0, "injected": [], "truncated": [],
                              "omitted": [], "via_flags": flagged, "missing": missing, "max_chars": max_chars, "lang": lang,
                              "blocked": [], "pending": [], "disabled": [], "catalog_only": [], "selected": [],
                              "modes": {}, "shas": {}, "tokens": {"catalog": 0, "bodies": 0}, "used": []}
    if not inject:
        return result
    items = _pinned_items(library, agent, inject, result)
    always = [i for i in items if i["mode"] != "catalog"]
    catalog = sorted((i for i in items if i["mode"] == "catalog"), key=lambda i: i["key"])
    display = always + catalog
    if not display:
        return result
    selected = select(task, catalog)
    result["selected"] = selected
    cands = [i for i in display if i["mode"] != "catalog" or i["key"] in selected]

    header = [f"# {t['title']}", t["intro"], "", t["catalog"]]
    header += [f"- {one_line(i['key'])}: {_desc_line(i['description'], t)}" for i in display]
    head_text = "\n".join(header)
    # katalog satırına sonradan eklenebilecek "(gövde bütçeye sığmadı…)" işareti için yer ayrılır
    remaining = max_chars - len(head_text) - 2 - len(cands) * (len(t["omitted"]) + 1)
    bodies: dict[str, str] = {}
    truncated: list[str] = []
    # öncelik: en son atanan (listenin sonu) önce
    for i in reversed(cands):
        key, e = i["key"], i["entry"]
        raw = i["body"] if i["body"] is not None else (library.detail(e["id"]).get("body") or "")
        body = _clean_body(raw)
        label = f"## {t['skill']}: {i['name'] or one_line(key)} ({one_line(key)})"
        need = len(label) + len(body) + 4
        if remaining <= 0 or (remaining < need and remaining < MIN_BODY_CHARS):
            continue
        if need > remaining:
            cut = max(0, remaining - len(label) - len(t["truncated"]) - 6)
            body = body[:cut].rstrip() + "\n" + t["truncated"]
            truncated.append(key)
            need = len(label) + len(body) + 4
        bodies[key] = f"{label}\n{body}"
        remaining -= need
    omitted = [i["key"] for i in cands if i["key"] not in bodies]
    if omitted:
        header = [ln + (f" {t['omitted']}" if any(ln.startswith(f"- {one_line(k)}:") for k in omitted) else "")
                  for ln in header]
        head_text = "\n".join(header)
    # kararlı kısım: katalog + `always` gövdeleri (ajan sürümüne bağlı, önbellek önekinde kalabilir)
    parts = [head_text] + [bodies[i["key"]] for i in display if i["key"] in bodies and i["mode"] != "catalog"]
    text = "\n\n".join(parts)
    # göreve bağlı kısım: seçicinin yüklediği catalog gövdeleri ayrı bölümde (SELECTED; kararlı öneki bozmaz)
    selected_text = "\n\n".join(bodies[i["key"]] for i in display if i["key"] in bodies and i["mode"] == "catalog")
    result.update({"text": text, "selected_text": selected_text,
                   "chars": len(text) + (len(selected_text) + 2 if selected_text else 0),
                   "injected": [i["key"] for i in display if i["key"] in bodies],
                   "truncated": truncated, "omitted": omitted,
                   "catalog_only": [i["key"] for i in display if i not in cands],
                   # isteme giren her skill → USED_SKILL {sha, how} (gövde: always | selected; yalnız katalog: catalog)
                   "used": [{"key": i["key"], "sha": result["shas"].get(i["key"]),
                             "how": ("selected" if i["mode"] == "catalog" else "always") if i["key"] in bodies
                             else "catalog"} for i in display],
                   "tokens": {"catalog": est_tokens(head_text, lang),
                              "bodies": est_tokens("\n\n".join(bodies.values()), lang)}})
    return result


class SkillsStage:
    name = "skills"
    order = 30

    def __init__(self, library: SkillLibrary):
        self.library = library

    def enabled(self, ctx: PromptContext) -> bool:
        settings = ctx.settings
        return bool(settings.get("skills.inject", True)) if settings is not None else True

    def finalize(self, ctx: PromptContext) -> None:
        settings = ctx.settings
        max_chars = int(settings.get("skills.max_chars", 6000) or 6000) if settings is not None else 6000
        is_hermes = ctx.route.connector == "hermes"
        plan = plan_injection(self.library, ctx.agent, is_hermes=is_hermes, max_chars=max_chars, lang=ctx.lang,
                              task=ctx.task)
        pins: dict[str, Any] = {k: plan[k] for k in ("blocked", "pending", "disabled", "selected", "catalog_only")
                                if plan[k]}
        if plan["shas"]:
            pins["shas"] = {k: v[:12] for k, v in plan["shas"].items()}
        if not plan["text"]:
            if plan["via_flags"] or plan["missing"] or pins:
                ctx.note(self.name, injected=[], truncated=[], chars=0, via_flags=plan["via_flags"], missing=plan["missing"],
                         **pins)
            return
        t = TEXT.get(ctx.lang, TEXT["tr"])
        # Başlık metnin içinde ("# …"); Section başlıksız yazılır ki render iki kez başlık basmasın
        ctx.add(Section(SKILLS, plan["text"], None, compressible=False,
                        meta={"injected": plan["injected"], "truncated": plan["truncated"]}))
        if plan["selected_text"]:
            # tabloda olmayan anahtar → değişken katman (görevle değişir); sabitlenmiş, onaylı içerik
            ctx.add(Section(SELECTED, plan["selected_text"], None, compressible=False,
                            meta={"selected": plan["selected"]}))
        ctx.system_lines.append(t["system"])
        ctx.note(self.name, injected=plan["injected"], truncated=plan["truncated"], omitted=plan["omitted"],
                 chars=plan["chars"], via_flags=plan["via_flags"], missing=plan["missing"], tokens=plan["tokens"],
                 used=plan["used"], **pins)
