"""Yerleşik salt okunur `studio__skill_load(key)` aracı (AUDIT §3.2 kural 7 "kademeli açılım"; AW-T19).

Araç döngüsü olan beyinlerde (Ollama araç döngüsü, OpenAI uyumlu, Anthropic API — `tools/loop.py`) `catalog` kipindeki
skill'lerin yalnız ad + açıklaması öneke girer; model gövdeye ihtiyaç duyarsa bu araçla ister.

Kurallar:
- **Yalnız bu ajana bağlı skill'ler** (G1-D bağlama kaydı + sabitleme): durumu `ok` (onaylı sha, diskteki kopya sha ile
  uyuşuyor) ve kipi `catalog` ya da `always` olan anahtarlar. Bağlı olmayan, bilinmeyen, `never`, onaysız (`pending`) ya
  da kopyası bozuk (`blocked`) anahtar hata döner; kayıt etkin değilse (göç yok) araç sunulmaz.
- **Sabitlenmiş içerik:** gövde çağrı anında sabitlenen sha'nın kopyasından yeniden okunur ve doğrulanır (canlı
  `~/.claude/skills` asla okunmaz). Ad ve açıklama sha kapsamındaki SKILL.md'den gelir ( ile aynı).
- **Onaysız ve salt okunur:** onay kartı açılmaz; hiçbir dosyaya yazmaz (büyük gövde dışında — o da araç çıktısı
  artefakt deposuna, `tools/outputs.offload`).
- **Sunulma koşulu:** ajanın en az bir `catalog` + `ok` skill'i varsa. Araç tanımı ajana göre sabittir (görev metnine
  bağlı değil), önbellek öneki bozulmaz.
- **İz:** başarılı her yükleme bağlayıcı `meta.invocation.skills_loaded` ile motora bildirilir; motor
  `Step -USED_SKILL{how: tool, sha, status: used}-> Skill` kenarını yazar (`workflow/step_gate.link_tool_skills`).
- **Ad ayrılmıştır:** dış MCP aracı bu işlev adını alamaz (`tools/bridge.RESERVED_FNS`).
"""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger("studio.tools.builtin_skill")

SKILL_FN = "studio__skill_load"
SKILL_TOOL = "studio:skill_load"
TOOL_HOW = "tool"
LOADABLE_MODES = ("catalog", "always")

DESCRIPTION = {
    "tr": "Sana bağlı bir skill'in (yetenek paketinin) tam yönergesini yükler. Yalnız '# SKILL'LER' katalogundaki "
          "anahtarlar; görevle ilgili olduğunda çağır. Salt okunur.",
    "en": "Loads the full instructions of a skill bound to you. Only keys from the '# SKILLS' catalog; call it when the "
          "skill is relevant to the task. Read-only.",
}
ERR_UNKNOWN = {"tr": "Bu ajana bağlı olmayan ya da bilinmeyen skill: {}. Yalnız katalogdaki anahtarlar yüklenebilir.",
               "en": "Unknown skill or not bound to this agent: {}. Only catalog keys can be loaded."}
ERR_BLOCKED = {"tr": "Skill yüklenemedi: sabitlenmiş kopya doğrulanamadı ({}).",
               "en": "Skill could not be loaded: pinned copy failed verification ({})."}
HEADER = {"tr": "# Skill: {name} ({key})\nSabitlenmiş sürüm: {sha}\n\n", "en": "# Skill: {name} ({key})\nPinned version: {sha}\n\n"}
REFS = {"tr": "\n\nReferans dosyaları (yalnız ad): {}", "en": "\n\nReference files (names only): {}"}


def _lang(lang: str | None) -> str:
    return "en" if lang == "en" else "tr"


def schema() -> dict[str, Any]:
    return {"properties": {"key": {"description": "skill key from the catalog (e.g. claude:docx)", "type": "string"}},
            "required": ["key"], "type": "object"}


def library() -> Any:
    """İstem hattındaki skill aşamasının kütüphanesi (skills/api.start kaydeder); yoksa None."""
    try:
        from studio.workflow import prompting  # noqa: PLC0415 - döngüsel içe aktarmayı önler

        stage = next((x for x in prompting.stages() if getattr(x, "name", None) == "skills"), None)
        return getattr(stage, "library", None)
    except Exception:  # noqa: BLE001
        return None


def loadable(settings: Any, agent: dict[str, Any] | None, lib: Any = None, *,
             include_blocked: bool = False) -> dict[str, dict[str, Any]]:
    """Ajanın yüklenebilir skill'leri: {anahtar: {sha, mode}} (bağlı, onaylı, kopyası doğrulanmış; never hariç).
    `include_blocked` (çağrı anı): kopyası doğrulanamayan bağlı skill de döner; `load_for_model` onu yeniden
    doğrular ve "doğrulanamadı" gerekçesiyle reddeder (bilinmeyen anahtar iletisi yerine)."""
    if not agent:
        return {}
    try:
        if settings is not None and settings.get("skills.inject", True) is False:
            return {}
    except Exception:  # noqa: BLE001
        pass
    lib = lib if lib is not None else library()
    store = getattr(lib, "bindings", None)
    snaps = getattr(lib, "snapshots", None)
    if lib is None or store is None or snaps is None or not store.active:
        return {}
    from studio.skills.binding import effective  # noqa: PLC0415

    props = agent.get("props", agent)
    slug = props.get("slug")
    out: dict[str, dict[str, Any]] = {}
    try:
        resolved = lib.resolve_assigned(agent)
    except Exception as exc:  # noqa: BLE001 - kütüphane okunamazsa araç sunulmaz
        log.warning("skill_load: atamalar çözülemedi: %s", exc)
        return {}
    for r in resolved:
        if r.get("how") != "prompt" or not r.get("entry"):
            continue  # Hermes -s yolu ve eksik skill'ler bu araçla yüklenmez
        eff = effective(store, snaps, slug, r["key"])
        status_ok = eff.get("status") == "ok" or (include_blocked and eff.get("status") == "blocked")
        if status_ok and eff.get("mode") in LOADABLE_MODES and eff.get("sha"):
            out[str(r["key"])] = {"sha": str(eff["sha"]), "mode": eff["mode"]}
    return out


def current_loadable(settings: Any, agent: dict[str, Any] | None, lib: Any = None) -> dict[str, dict[str, Any]]:
    """çağrı anındaki yüklenebilir küme. Ajanın skill listesi kütüphanenin ajan kaydından TAZE okunur (adım
    başındaki anlık görüntü değil); ajan silinmişse küme boştur."""
    lib = lib if lib is not None else library()
    if not agent or lib is None:
        return {}
    props = agent.get("props", agent)
    slug = props.get("slug")
    registry = getattr(lib, "agents", None)
    if slug and registry is not None:
        node = registry.node(str(slug))
        if node is None:
            return {}
        agent = {**props, **node["props"]}
    return loadable(settings, agent, lib, include_blocked=True)


def offered(skills: dict[str, dict[str, Any]] | None) -> bool:
    """Araç yalnız kademeli açılım gerektiğinde sunulur: en az bir `catalog` skill."""
    return any(v.get("mode") == "catalog" for v in (skills or {}).values())


def _resolve_key(raw: str, skills: dict[str, dict[str, Any]]) -> str | None:
    if raw in skills:
        return raw
    # model bazen kaynak önekini atar ("docx" → "claude:docx"); yalnız TEK eşleşme kabul edilir
    hits = [k for k in skills if k.split(":", 1)[-1] == raw]
    return hits[0] if len(hits) == 1 else None


def load_for_model(skills: dict[str, dict[str, Any]], args: dict[str, Any], lang: str | None,
                   lib: Any = None) -> tuple[bool, str, dict[str, Any] | None]:
    """(ok, modele dönecek metin, kullanım kaydı {key, sha} | None)."""
    from studio.skills.library import parse_skill_md  # noqa: PLC0415

    lg = _lang(lang)
    raw = " ".join(str(args.get("key") or args.get("name") or "").split())[:200]
    key = _resolve_key(raw, skills) if raw else None
    if key is None:
        return False, ERR_UNKNOWN[lg].format(raw or "—"), None
    sha = skills[key]["sha"]
    lib = lib if lib is not None else library()
    snaps = getattr(lib, "snapshots", None)
    content = snaps.load(key, sha) if snaps is not None else None   # çağrı anında yeniden doğrulama
    if content is None:
        reason = snaps.verify(key, sha) if snaps is not None else "missing"
        return False, ERR_BLOCKED[lg].format(reason), None
    files = content.get("files") or {}
    parsed = parse_skill_md(files.get("SKILL.md") or "", key.split(":", 1)[-1])
    from studio.skills.stage import one_line  # noqa: PLC0415 - başlık satırı enjekte edilemesin

    name = one_line(parsed.get("name") or key, 120) or one_line(key)
    body = str(parsed.get("body") or "").replace("\r\n", "\n").strip()
    text = HEADER[lg].format(name=name, key=one_line(key), sha=sha[:12]) + body
    refs = sorted(p for p in files if p != "SKILL.md")
    if refs:
        text += REFS[lg].format(", ".join(one_line(p, 160) for p in refs[:20]))
    return True, text, {"key": key, "sha": sha}
