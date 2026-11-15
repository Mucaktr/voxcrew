"""Kahraman paketi (`voxcrew-agent-preset`, sürüm 1) yükleme ve doğrulama.

Paketler depoda `backend/studio/heroes/presets/*.agent-preset.json` olarak durur (ücretsiz başlangıç kahramanları,
). Pazar yeri kurucusu `agent-preset` türünü bilerek kurmaz (ajan oluşturma, salt dosya kopyalamakla geri
alınamaz); kahramanlar bu modülün kendi işe al → kaldır akışıyla kurulur ve eksiksiz geri alınır.

Kurallar ( "IP kontrol listesi" ve):
- `ip_risk` 0–3 zorunlu; yalnızca 0–1 yayımlanır (`SHIP_MAX_IP_RISK`). Ad/köken/slogan metinleri bilinen karakter,
  marka ve gerçek kişi adlarına karşı taranır.
- Oyun verisi yok: XP, seviye, jeton, başarım ya da envanter alanı içeren paket reddedilir (kahraman önde başlamaz).
- Beyin zinciri tek bir ücretli sağlayıcıya bağlı olamaz: en az iki seçenek ve yerel `ollama` yedeği gerekir.
- Araçlar yalnızca ÖNERİDİR: `auto_enable` yasaktır, erişim `read` ya da `write` olarak beyan edilir.
- Hazır hafıza 15–40 düğüm (bilgi + kavram), her bilgi TR ve EN metinli; başlangıç akışında en az bir onay kapısı.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from studio._edition import EDITION

FORMAT = "voxcrew-agent-preset"
VERSION = 1
SHIP_MAX_IP_RISK = 1
PRESETS_DIR = Path(__file__).parent / "presets"
SKILLS_DIR = Path(__file__).parent / "skills"
LANGS = ("tr", "en")
ID_RE = re.compile(r"^hero:([a-z0-9][a-z0-9-]{1,40})$")
SKILL_ID_RE = re.compile(r"^hero-[a-z0-9][a-z0-9-]{1,50}$")
HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
LICENSES = ("MIT", "CC-BY-4.0", "CC-BY-NC-4.0", "CC0-1.0", "VoxCrew-Pack-1.0", "LicenseRef-PolyForm-Shield-1.0.0")
BRAINS = ("hermes", "codex", "claude", "openai_compat", "ollama")
RANKS = ("senior", "specialist", "analyst")
TOOL_ACCESS = ("read", "write")
# Kahraman görünümü (frontend/src/voxel/avatar.ts HERO_* listeleriyle aynı)
CAPES = ("none", "short", "long")
MASKS = ("none", "domino", "visor", "cowl")
EMBLEMS = ("none", "ring", "check", "spark", "wave", "bubble", "book", "lock", "chevron", "gear", "arrows")
SPECIES = ("human", "cat", "dog", "fox", "bear", "rabbit", "panda", "penguin")
# Kahraman önde başlamaz: bu anahtarlar paketin hiçbir düzeyinde bulunamaz
FORBIDDEN_KEYS = frozenset({"xp", "level", "coins", "achievements", "inventory", "game", "streak", "rarity_bonus"})
MIN_MEMORY, MAX_MEMORY = 15, 40

# Bilinen karakter / marka / gerçek kişi adları (küçük harf, kelime sınırıyla). Liste örnekleyicidir; asıl güvence
# özgün yazım ve kontrol listesidir. Eşleşen paket ip_risk'ten bağımsız olarak reddedilir.
IP_DENYLIST = (
    "superman", "süpermen", "batman", "yarasa adam", "spider-man", "spiderman", "örümcek adam", "wonder woman",
    "iron man", "ironman", "demir adam", "captain america", "kaptan amerika", "hulk", "avengers", "justice league",
    "marvel", "dc comics", "x-men", "wolverine", "aquaman", "green lantern", "black panther", "deadpool", "joker",
    "catwoman", "krypton", "gotham", "wakanda", "asgard", "jedi", "sith", "pokemon", "pokémon", "mario", "zelda",
    "sherlock", "gandalf", "hogwarts", "naruto", "goku", "messi", "ronaldo", "einstein", "tesla",
    # HERO-PACKS: karakter ve kostüm paketleri için genişletildi. Genel İngilizce kelimeler
    # ("vision", "venom", "sonic", "spawn" gibi) bilinçli olarak yok: yanlış alarm üretirler; insan kontrol listesi kapsar.
    # çizgi roman yayıncıları ve ekipleri
    "detective comics", "image comics", "dark horse comics", "fantastic four", "guardians of the galaxy", "teen titans",
    "suicide squad", "watchmen", "yenilmezler", "adalet birliği",
    # süper kahraman ve kötüler (EN + yaygın TR çevirileri; yakın yazımlar dahil)
    "super man", "superboy", "supergirl", "batgirl", "batwoman", "nightwing", "harley quinn", "lex luthor", "the flash",
    "shazam", "black adam", "martian manhunter", "spider-woman", "spider-gwen", "miles morales", "green goblin",
    "doctor octopus", "doctor strange", "doktor strange", "captain marvel", "kaptan marvel", "ms. marvel", "thanos", "loki",
    "thor", "odin", "valkyrie", "scarlet witch", "black widow", "kara dul", "hawkeye", "ant-man", "karınca adam", "magneto",
    "professor x", "daredevil", "punisher", "ghost rider", "silver surfer", "galactus", "groot", "rocket raccoon",
    "star-lord", "moon knight", "she-hulk", "harika kadın", "yeşil fener", "kara panter", "invisible woman",
    "mister fantastic", "human torch", "the shadow", "the phantom", "flash gordon", "buck rogers", "zorro", "tarzan",
    "conan the barbarian", "barbar conan", "red sonja", "hellboy", "judge dredd",
    # stüdyo, oyun ve anime evrenleri
    "disney", "pixar", "dreamworks", "ghibli", "totoro", "mickey", "minnie", "donald duck", "moana", "buzz lightyear",
    "toy story", "shrek", "minions", "star wars", "darth vader", "yoda", "skywalker", "stormtrooper", "mandalorian",
    "wookiee", "lightsaber", "ışın kılıcı", "harry potter", "voldemort", "dumbledore", "nintendo", "luigi", "bowser",
    "kirby", "metroid", "pikachu", "pokeball", "minecraft", "enderman", "fortnite", "roblox", "sonic the hedgehog",
    "pac-man", "lego", "barbie", "transformers", "optimus prime", "power rangers", "ninja turtles", "teenage mutant",
    "dragon ball", "one piece", "sailor moon", "demon slayer", "jujutsu kaisen", "attack on titan", "yo-kai watch",
    "kitaro", "digimon", "godzilla", "gojira", "king kong", "mothra", "ghostbusters", "jurassic park", "jurassic world",
    "doctor who", "dalek", "the witcher", "game of thrones", "lord of the rings", "yüzüklerin efendisi", "hobbit",
    "elphaba", "jack sparrow", "pirates of the caribbean", "captain hook", "kaptan kanca", "peter pan",
    "universal monsters", "bela lugosi", "boris karloff", "dracula", "drakula", "frankenstein", "invisible man",
    "görünmez adam", "addams", "spongebob", "smurfs", "şirinler", "asterix", "tintin", "red kit", "lucky luke",
    "temel reis", "popeye",
    # Türkiye: çizgi roman, film ve çocuk yayını karakterleri; kulüp adları (renk çiftleri)
    "kara murat", "karaoğlan", "malkoçoğlu", "tarkan", "kaptan swing", "pepee", "rafadan tayfa", "kral şakir", "niloya",
    "galatasaray", "fenerbahçe", "beşiktaş", "trabzonspor",
    # gerçek kişiler (örnekleyici)
    "atatürk", "elon musk", "taylor swift", "michael jackson", "bruce lee", "jackie chan",
)
_DENY_RE = re.compile(r"(?<![\wçğıöşü])(" + "|".join(re.escape(w) for w in IP_DENYLIST) + r")(?![\wçğıöşü])", re.I)


def ip_scan(*texts: str) -> list[str]:
    """Serbest metinlerde yasaklı ad eşleşmeleri (küçük harf, sıralı, tekrarsız). Kozmetik/kostüm kataloğu da kullanır
    (`studio.cosmetics.catalog.ip_hits`)."""
    return sorted({m.group(1).lower() for t in texts if t for m in _DENY_RE.finditer(str(t))})


class PresetError(ValueError):
    pass


@dataclass
class HeroPreset:
    id: str                     # hero:<ad>
    key: str                    # <ad>
    data: dict[str, Any]
    skills: dict[str, dict[str, str]] = field(default_factory=dict)   # skill id → {tr: md, en: md}

    @property
    def ip_risk(self) -> int:
        return int(self.data["ip_risk"])

    @property
    def shippable(self) -> bool:
        return self.ip_risk <= SHIP_MAX_IP_RISK

    def text(self, key: str, lang: str) -> str:
        return pick(self.data.get(key), lang)

    @property
    def memory_size(self) -> int:
        mem = self.data["memory"]
        return len(mem.get("facts") or []) + len(mem.get("concepts") or [])


def pick(value: Any, lang: str) -> str:
    """{tr, en} → istenen dil (yoksa TR). Liste değerler satır satır birleştirilir."""
    if isinstance(value, dict):
        v = value.get(lang) or value.get("tr") or ""
    else:
        v = value or ""
    if isinstance(v, list):
        return "\n".join(str(x) for x in v)
    return str(v)


def _bi(obj: Any, where: str, *, required: bool = True, limit: int = 4000) -> None:
    if obj is None and not required:
        return
    if not isinstance(obj, dict) or not all(k in obj for k in LANGS):
        raise PresetError(f"{where}: TR ve EN metni gerekli")
    for lang in LANGS:
        v = obj[lang]
        text = "\n".join(v) if isinstance(v, list) else v
        if not isinstance(text, str) or not text.strip():
            raise PresetError(f"{where}.{lang}: boş olamaz")
        if len(text) > limit:
            raise PresetError(f"{where}.{lang}: en çok {limit} karakter")


def _walk_keys(obj: Any, path: str = "") -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if str(k).lower() in FORBIDDEN_KEYS:
                raise PresetError(f"{path or 'paket'}: oyun verisi içeremez ({k}) — kahraman önde başlamaz")
            _walk_keys(v, f"{path}.{k}" if path else str(k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _walk_keys(v, f"{path}[{i}]")


def ip_hits(data: dict[str, Any]) -> list[str]:
    """Kimlik metinlerinde (ad, unvan, köken, slogan, arketip) yasaklı ad eşleşmeleri."""
    texts: list[str] = [str(data.get("archetype") or "")]
    for key in ("name", "title", "origin", "catchphrase", "problem"):
        v = data.get(key)
        if isinstance(v, dict):
            texts += [pick(v, lang) for lang in LANGS]
    return sorted({m.group(1).lower() for t in texts for m in _DENY_RE.finditer(t)})


def validate_avatar(a: Any, where: str = "avatar") -> dict[str, Any]:
    if not isinstance(a, dict):
        raise PresetError(f"{where}: nesne olmalı")
    if a.get("species") not in SPECIES:
        raise PresetError(f"{where}.species geçersiz")
    for k in ("skin", "hairColor", "outfitColor", "accent", "capeColor"):
        if k in a and not HEX_RE.match(str(a[k])):
            raise PresetError(f"{where}.{k}: #RRGGBB renk olmalı")
    if a.get("aura", "none") != "none" and not HEX_RE.match(str(a.get("aura"))):
        raise PresetError(f"{where}.aura: 'none' ya da #RRGGBB olmalı")
    for k, allowed in (("cape", CAPES), ("mask", MASKS), ("emblem", EMBLEMS)):
        if k in a and a[k] not in allowed:
            raise PresetError(f"{where}.{k}: geçersiz değer {a[k]!r}")
    for k in ("boots", "gloves", "hover"):
        if k in a and not isinstance(a[k], bool):
            raise PresetError(f"{where}.{k}: true/false olmalı")
    if a.get("cape", "none") != "none" and "capeColor" not in a:
        raise PresetError(f"{where}: pelerin için capeColor gerekli")
    return a


def validate(data: Any, *, skills_dir: Path | None = SKILLS_DIR) -> HeroPreset:
    """Ham JSON → doğrulanmış HeroPreset. `ip_risk` > 1 olan paket doğrulanır ama `shippable=False` olur;
    yayımlama kapısı (`load_all`) onu listeden çıkarır."""
    if not isinstance(data, dict):
        raise PresetError("Paket bir JSON nesnesi olmalı")
    if data.get("format") != FORMAT or data.get("version") != VERSION:
        raise PresetError(f"Biçim '{FORMAT}' sürüm {VERSION} olmalı")
    m = ID_RE.match(str(data.get("id") or ""))
    if not m:
        raise PresetError("Kimlik 'hero:<küçük-harf-ad>' biçiminde olmalı")
    pid, key = data["id"], m.group(1)
    where = pid
    _walk_keys(data)
    risk = data.get("ip_risk")
    if isinstance(risk, bool) or not isinstance(risk, int) or not 0 <= risk <= 3:
        raise PresetError(f"{where}: ip_risk 0–3 arası tam sayı olmalı")
    hits = ip_hits(data)
    if hits:
        raise PresetError(f"{where}: kimlik metninde korumalı ad/marka çağrışımı var: {', '.join(hits)}")
    if data.get("license") not in LICENSES:
        raise PresetError(f"{where}: lisans {', '.join(LICENSES)} içinden olmalı")
    if not str(data.get("archetype") or "").strip():
        raise PresetError(f"{where}: archetype gerekli")
    for k in ("name", "title", "problem", "origin", "catchphrase"):
        _bi(data.get(k), f"{where}.{k}", limit=600)
    if not HEX_RE.match(str(data.get("color") or "")):
        raise PresetError(f"{where}: color #RRGGBB olmalı")
    role = data.get("role") or {}
    if role.get("rank") not in RANKS:
        raise PresetError(f"{where}.role.rank {', '.join(RANKS)} içinden olmalı")
    persona = data.get("persona") or {}
    _bi(persona.get("system"), f"{where}.persona.system", limit=1800)
    _bi(persona.get("tone"), f"{where}.persona.tone", limit=200)
    # beyin zinciri
    brains = data.get("brains")
    if not isinstance(brains, list) or len(brains) < 2 or any(b not in BRAINS for b in brains):
        raise PresetError(f"{where}: brains en az iki geçerli beyin içermeli ({', '.join(BRAINS)})")
    if "ollama" not in brains:
        raise PresetError(f"{where}: brains yerel 'ollama' yedeğini içermeli (tek ücretli sağlayıcı şartı yok)")
    if len(set(brains)) != len(brains):
        raise PresetError(f"{where}: brains tekrar içeremez")
    if data.get("permissions") not in ("read", "write"):
        raise PresetError(f"{where}: permissions read ya da write olmalı")
    # booster profili
    boosters = data.get("boosters") or {}
    if not isinstance(boosters, dict):
        raise PresetError(f"{where}: boosters nesne olmalı")
    if EDITION == "full":
        from studio.full.boost import BY_ID
    else:
        BY_ID = boosters  # booster yok: kimlik denetimi yapılmaz, yalnız biçim denetlenir
    for bid, on in boosters.items():
        if bid not in BY_ID:
            raise PresetError(f"{where}: bilinmeyen booster {bid}")
        if not isinstance(on, bool):
            raise PresetError(f"{where}: boosters.{bid} true/false olmalı")
    # araç önerileri
    tools = data.get("tools") or []
    if not isinstance(tools, list):
        raise PresetError(f"{where}: tools liste olmalı")
    for i, t in enumerate(tools):
        if not isinstance(t, dict) or not str(t.get("id") or "").strip():
            raise PresetError(f"{where}.tools[{i}]: id gerekli")
        if t.get("access") not in TOOL_ACCESS:
            raise PresetError(f"{where}.tools[{i}]: access read ya da write olmalı")
        if "auto_enable" in t or "install" in t or "command" in t:
            raise PresetError(f"{where}.tools[{i}]: araçlar yalnızca öneridir (auto_enable/install/command yasak)")
        _bi(t.get("why"), f"{where}.tools[{i}].why", limit=400)
    validate_avatar(data.get("avatar"), f"{where}.avatar")
    # hazır hafıza
    mem = data.get("memory") or {}
    facts, concepts = mem.get("facts") or [], mem.get("concepts") or []
    if not isinstance(facts, list) or not isinstance(concepts, list):
        raise PresetError(f"{where}.memory: facts/concepts liste olmalı")
    total = len(facts) + len(concepts)
    if not MIN_MEMORY <= total <= MAX_MEMORY:
        raise PresetError(f"{where}.memory: {MIN_MEMORY}–{MAX_MEMORY} düğüm olmalı (şu an {total})")
    concept_names = set()
    for i, c in enumerate(concepts):
        if not isinstance(c, dict) or not str(c.get("name") or "").strip():
            raise PresetError(f"{where}.memory.concepts[{i}]: name gerekli")
        concept_names.add(str(c["name"]).strip().lower())
    seen: set[str] = set()
    for i, f in enumerate(facts):
        _bi(f, f"{where}.memory.facts[{i}]", limit=400)
        for lang in LANGS:
            norm = f[lang].strip().lower()
            if norm in seen:
                raise PresetError(f"{where}.memory.facts[{i}]: tekrar eden bilgi")
            seen.add(norm)
        for name in f.get("about") or []:
            if str(name).strip().lower() not in concept_names:
                raise PresetError(f"{where}.memory.facts[{i}]: bilinmeyen kavram {name!r}")
    # skill'ler
    skills: dict[str, dict[str, str]] = {}
    for sid in data.get("skills") or []:
        if not SKILL_ID_RE.match(str(sid)):
            raise PresetError(f"{where}: skill kimliği 'hero-<ad>' biçiminde olmalı: {sid!r}")
        if skills_dir is not None:
            texts = {}
            for lang in LANGS:
                p = skills_dir / f"{sid}.{lang}.md"
                if not p.is_file():
                    raise PresetError(f"{where}: skill dosyası yok: {p.name}")
                texts[lang] = p.read_text("utf-8")
            skills[sid] = texts
    if not data.get("skills"):
        raise PresetError(f"{where}: en az bir skill gerekli")
    # başlangıç akışı
    validate_workflow(data.get("workflow"), where)
    for i, t in enumerate(data.get("starter_tasks") or []):
        _bi((t or {}).get("title"), f"{where}.starter_tasks[{i}].title", limit=160)
        _bi((t or {}).get("prompt"), f"{where}.starter_tasks[{i}].prompt", limit=1200)
    return HeroPreset(pid, key, data, skills)


def validate_workflow(wf: Any, where: str) -> None:
    if not isinstance(wf, dict):
        raise PresetError(f"{where}: workflow gerekli")
    _bi(wf.get("name"), f"{where}.workflow.name", limit=120)
    _bi(wf.get("description"), f"{where}.workflow.description", limit=400)
    steps = wf.get("steps") or []
    if not steps or not any(s.get("type") == "approval" for s in steps):
        raise PresetError(f"{where}.workflow: en az bir onay (approval) adımı gerekli")
    # gerçek motor şemasıyla da dene (sahte ajan adıyla)
    from studio.workflow.spec import WorkflowError, parse, validate as wf_validate
    for lang in LANGS:
        try:
            spec = parse(render_workflow(wf, "test-ajan", lang, "kahraman-test-ajan"))
        except WorkflowError as exc:
            raise PresetError(f"{where}.workflow ({lang}): {exc}") from exc
        errors = wf_validate(spec, {"test-ajan"})
        if errors:
            raise PresetError(f"{where}.workflow ({lang}): {'; '.join(errors)}")


def render_workflow(wf: dict[str, Any], agent_slug: str, lang: str, slug: str) -> dict[str, Any]:
    """Paket akışı → motorun YAML/dict biçimi. `@hero` ajan yer tutucusu işe alınan ajanın slug'ı olur."""
    steps = []
    for s in wf["steps"]:
        step: dict[str, Any] = {"id": s["id"], "type": s.get("type", "agent"), "title": pick(s.get("title"), lang)}
        if s.get("depends_on"):
            step["depends_on"] = list(s["depends_on"])
        if step["type"] == "approval":
            step["message"] = pick(s.get("message"), lang)
        else:
            step["agent"] = agent_slug if s.get("agent", "@hero") == "@hero" else s["agent"]
            step["prompt"] = pick(s.get("prompt"), lang)
        steps.append(step)
    inputs = [{"name": i["name"], "label": pick(i.get("label"), lang), "type": i.get("type", "text"),
               "default": i.get("default", ""), "required": bool(i.get("required", True))}
              for i in wf.get("inputs") or []]
    return {"slug": slug, "name": pick(wf["name"], lang), "description": pick(wf["description"], lang),
            "icon": wf.get("icon") or "sparkles", "inputs": inputs, "steps": steps}


def load_file(path: Path, *, skills_dir: Path | None = SKILLS_DIR) -> HeroPreset:
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError) as exc:
        raise PresetError(f"{path.name}: okunamadı ({exc})") from exc
    preset = validate(data, skills_dir=skills_dir)
    if not path.name.startswith(preset.key + "."):
        raise PresetError(f"{path.name}: dosya adı kimlikle aynı olmalı ({preset.key}.agent-preset.json)")
    return preset


def load_all(directory: Path = PRESETS_DIR, *, include_unshippable: bool = False) -> dict[str, HeroPreset]:
    """Dizindeki tüm paketler (kimlik sırasıyla). Bozuk paket PresetError fırlatır (depodaki içerik test edilir);
    yayımlama kapısı: ip_risk > SHIP_MAX_IP_RISK olanlar varsayılan olarak listeye girmez."""
    out: dict[str, HeroPreset] = {}
    for path in sorted(directory.glob("*.agent-preset.json")):
        p = load_file(path)
        if p.shippable or include_unshippable:
            out[p.key] = p
    return out
