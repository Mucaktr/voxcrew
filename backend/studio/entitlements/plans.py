"""Durağan plan tablosu ( K1–K6).

Rakamlar YALNIZCA burada. Arayüz `/api/plan/compare` ile buradan okur; motor `engine.py` buradan sınır alır.
`PLAN_TABLE_VERSION`, K1 geri alınabilir kalsın diye (§10) tabloyu sürümler.

`None` = paket sınırı yok (teknik tavanlar geçerli: `limits.max_agents`, `MAX_WORLDS` …).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from studio._edition import EDITION

PLAN_TABLE_VERSION = 1

# Sayım sınırı anahtarları (usage.py aynı anahtarlarla sayar)
COUNT_KEYS = ("workflows", "schedules", "worlds", "api_connections")


@dataclass(frozen=True)
class Plan:
    id: str
    seats: int
    price_month: float
    price_year: float
    limits: dict[str, int | None]
    features: frozenset[str]
    # Abonelik süresince açık içerik (sahne/kahraman paketleri). Envantere yazılmaz (§4.6).
    included_scene_packs: str = "none"     # none | pick1 | all
    included_hero_packs: str = "free"      # free | pick1 | all
    addon: dict[str, Any] | None = None
    devices: int | None = None
    order: int = 0


# Özellik bayrakları (feature_tier denetimi). Sayım sınırları `limits` içinde.
F_DELEGATE = "delegate"            # orkestratör: devretme ve orkestrasyon (her pakette; Free'de var olan ajanlarla)
F_HIRE = "hire"                    # orkestratörün yeni ajan işe alması (Plus, Pro) — kullanıcı kararı 2026-10-18
F_SEASON_PREMIUM = "season_premium"
F_REPORTS = "reports"              # gelişmiş raporlar (bildirilmiş; uygulanmaz)
F_REMOTE = "remote"                # bulut relay (bildirilmiş)
F_BOOSTERS = "boosters"            # ücretsiz 3 booster dışındakiler (Plus, Pro) — karar 2026-10-28

if EDITION == "full":  # liste fiyatları yalnız tam sürümde; free sürüm satış yapmaz ve fiyat taşımaz
    from studio.full.plan_prices import ADDON_PRICES, PRICES, SEASON_PRICE
else:
    PRICES, ADDON_PRICES, SEASON_PRICE = {}, {}, None


def _addon(sku: str, per: int, top: int) -> dict[str, Any]:
    month, year = ADDON_PRICES.get(sku, (0, 0))
    return {"sku": sku, "seats_per_unit": per, "max_units": top, "price_month": month, "price_year": year}


PLANS: dict[str, Plan] = {
    "free": Plan("free", 2, 0, 0,
                 {"workflows": 5, "schedules": 1, "worlds": 3, "api_connections": 1, "history_days": 90,
                  "publish_month": 2},
                 frozenset({F_DELEGATE}), order=0),
    "plus": Plan("plus", 10, *PRICES.get("plus", (0, 0)),
                 {"workflows": 50, "schedules": 10, "worlds": 20, "api_connections": 5, "history_days": 365,
                  "publish_month": 30},
                 frozenset({F_DELEGATE, F_HIRE, F_BOOSTERS}), included_scene_packs="pick1", included_hero_packs="pick1",
                 addon=_addon("addon:seat", 1, 5),
                 devices=3, order=1),
    "pro": Plan("pro", 20, *PRICES.get("pro", (0, 0)),
                {"workflows": None, "schedules": None, "worlds": None, "api_connections": None, "history_days": None,
                 "publish_month": 100},
                frozenset({F_DELEGATE, F_HIRE, F_BOOSTERS, F_SEASON_PREMIUM, F_REPORTS, F_REMOTE}), included_scene_packs="all",
                included_hero_packs="all",
                addon=_addon("addon:seat5", 5, 16),
                devices=5, order=2),
}

ADDONS = {p.addon["sku"]: {"plan": p.id, **p.addon} for p in PLANS.values() if p.addon}


def plan_by_id(pid: str | None) -> Plan | None:
    return PLANS.get(pid or "")


def addon_units(plan: Plan, requested: Any) -> tuple[int, bool]:
    """Ek adedini plan tavanına kırpar (T8). Dönen: (adet, kırpıldı mı). Free'de ek yoktur → 0."""
    try:
        n = max(0, int(requested or 0))
    except (TypeError, ValueError):
        n = 0
    if not plan.addon:
        return 0, n > 0
    cap = int(plan.addon["max_units"])
    return min(n, cap), n > cap


def seats_with_addons(plan: Plan, units: int) -> int:
    per = int(plan.addon["seats_per_unit"]) if plan.addon else 0
    return plan.seats + per * max(0, units)


# ---------------------------------------------------------------- kontrol noktaları (12)
@dataclass(frozen=True)
class Checkpoint:
    id: str
    feature: str
    spec_ref: str            # E-kodu
    where: str               # kancanın dosyası
    enforced: bool           # uygulanıyor mu (özellik bugün var mı)
    note: str = ""


CHECKPOINTS: tuple[Checkpoint, ...] = (
    Checkpoint("C1", "seats", "E1–E4", "agents.py · workflow/engine.py · entitlements/seats.py", True,
               "Ajan oluşturma, etkinleştirme, koşu başlatma, orkestratör işe alımı"),
    Checkpoint("C2", "scene", "E10", "game/service.py is_owned", True,
               "Pakete dahil sahne paketleri (Pro); 11 açık sahne ve tüm kazanım yolları değişmez"),
    Checkpoint("C3", "schedules", "E6", "schedule/service.py", True, "Oluşturma ve etkinleştirme"),
    Checkpoint("C4", "workflows", "E7", "api.py save_workflow", True, "Yalnız yeni özel akış; düzenleme serbest"),
    Checkpoint("C5", "worlds", "E8", "worlds/api.py", True, "Oluşturma, içe aktarma, kopyalama"),
    Checkpoint("C6", "api_connections", "E9", "connections/api.py compat_add", True, "Yeni adlandırılmış API bağlantısı"),
    Checkpoint("C7", "history", "E11", "arayüz (RunsPage)", False,
               "Arayüzde arama penceresi; veri silinmez, dışa aktarma açık. Sınır /api/plan'da yayımlanır"),
    Checkpoint("C8", "hire", "E4–E5", "workflow/engine.py", True,
               "Devretme ve hedef başlatma her pakette; Free'de orkestratör yeni ajan işe alamaz (reddedilen işe alım "
               "yolu, alt görev yöneticide/var olan ajanda kalır)"),
    Checkpoint("C9", "publish", "E12", "bulut (PK-3)", False, "Bulut yayını henüz yok"),
    Checkpoint("C10", "hero_pack", "E12", "heroes/ (PK-3)", False, "Bugün yalnız 5 ücretsiz kahraman var"),
    Checkpoint("C11", "plots", "—", "expanse/service.py · expanse/build.py (game/service.py feature_pack)", True,
               "Arsa ve yapı modu her pakette aynı (kazanım). Ek arsa paketi +4 yuva, yapı malzemeleri paketi +8 renk "
               "(yalnız yeni yerleştirme); parseller yine seviye + kazanılmış jetonla"),
    Checkpoint("C12", "season_premium", "E12", "game/service.py season_premium", True,
               "Sezon premium yolu yalnız kozmetik; Pro ve kurucu kendiliğinden alır, satın alma yolu yok (PK-4)"),
    Checkpoint("C13", "boosters", "—", "tam sürüm", True,
               "3 booster her pakette ücretsiz; diğerleri tam sürümde. Açma 402 ile reddedilir; "
               "hak biterse ücretli booster'lar çalışma anında kapanır"),
)
CHECKPOINT_FEATURES = {c.feature for c in CHECKPOINTS}

# Asla kısıtlanmayanlar (§0.5, §2.3). `check()` bunlar için her zaman izin verir.
NEVER_GATED: tuple[str, ...] = (
    "local_models", "brains", "approvals", "budgets", "security", "export", "mcp", "integrations", "walk",
    "recognition", "academy", "free_heroes", "open_scenes", "earn_paths", "game_progress", "goals",
    "workflow_run", "concurrency",
)


# ---------------------------------------------------------------- üyelik: özellik paketleri ve sandıklar
# "Üyelik paketleri, sandıklar ve özellik paketleri (2026-10-19)". Jeton SATILMAZ (yalnız kazanılır); gelir yalnız
# üyelik (Plus, Pro) ve isteğe bağlı eklerden gelir. Özellik paketi ("kurgu") çekirdek işi (görev, akış, tarif, teslim,
# kalite, tetikleyici) asla kilitlemez: yalnız oyun/yapı içeriği ve profesyonel araç ekler.
@dataclass(frozen=True)
class FeaturePack:
    id: str
    kind: str              # content (oyun/yapı içeriği) | tool (profesyonel araç)
    label_tr: str
    label_en: str
    desc_tr: str
    desc_en: str
    checkpoint: str        # CHECKPOINTS kimliği (kontrol noktası sayısı 12'de kalır)
    enforced: bool         # bugün kodda kapılı mı (False = bildirilmiş, özellik henüz yok)


PACK_PLOTS = "plots_plus"            # +4 parsel yuvası (dünya başına 12 → 16); parseller yine seviye + kazanılmış jetonla
PACK_BUILDER = "builder_materials"   # +8 yapı malzemesi rengi (yalnız YENİ yerleştirme kapılı; var olan blok kalır)
PACK_HEROES = "heroes"               # birinci taraf kahraman paketleri (bugün 5 ücretsiz kahraman)
PACK_SCENES = "scenes"               # sahne paketi demeti (C2: Pro'da tüm Dünya Turu + Premium Koleksiyon)
PACK_REPORTS = "reports"             # Gelişmiş raporlar (maliyet/token, model arenası, değerlendirme panosu)
PACK_REMOTE = "remote"               # uzaktan izleme ve mobil onay (bulut relay; sonra)
EXTRA_PLOT_SLOTS = 4                 # PACK_PLOTS'un eklediği yuva (expanse/service.py MAX_PLOTS + bu)

FEATURE_PACKS: tuple[FeaturePack, ...] = (
    FeaturePack(PACK_PLOTS, "content", "Ek arsa paketi", "Extra plots pack",
                "Her dünyada 12 yerine 16 parsel yuvası. Yeni parseller yine ofis seviyesi ve kazanılmış jetonla alınır; "
                "paket parsel vermez, yalnız yer açar.",
                "16 plot slots per world instead of 12. New plots are still claimed with office level and earned coins; "
                "the pack gives no plots, only room for them.", "C11", True),
    FeaturePack(PACK_BUILDER, "content", "Yapı malzemeleri paketi", "Builder materials pack",
                "Yapı modunda 8 ek blok rengi. Paket biterse yerleştirdiğin bloklar kalır; yalnız yenisi konamaz.",
                "8 extra block colours in build mode. If the pack ends, blocks you placed stay; you just cannot place new "
                "ones.", "C11", True),
    FeaturePack(PACK_SCENES, "content", "Sahne paketi demeti", "Scene pack bundle",
                "Dünya Turu ve Premium Koleksiyon sahneleri abonelik süresince açık. 11 açık sahne ve tüm kazanım "
                "yolları her pakette aynı.",
                "World Tour and Premium Collection scenes stay open while subscribed. The 11 open scenes and every earn "
                "path are the same on every plan.", "C2", True),
    FeaturePack(PACK_HEROES, "content", "Kahraman paketleri", "Hero packs",
                "Birinci taraf kahraman paketleri (görünüş ve kişilik). 5 ücretsiz kahraman her pakette.",
                "First-party hero packs (look and personality). The 5 free heroes are on every plan.", "C10", False),
    FeaturePack(PACK_REPORTS, "tool", "Gelişmiş raporlar", "Advanced reports",
                "Maliyet ve token raporu, model arenası, değerlendirme panosu. Temel koşu geçmişi ve dışa aktarma "
                "her pakette açık.",
                "Cost and token report, model arena, evaluation board. Basic run history and export are open on every "
                "plan.", "C7", False),
    FeaturePack(PACK_REMOTE, "tool", "Uzaktan onay", "Remote approval",
                "Telefondan izleme ve onay (bulut relay). Sonra gelecek; yerel onay kapıları her pakette aynı.",
                "Watch and approve from your phone (relay). Coming later; local approval gates are the same on "
                "every plan.", "C9", False),
)
PACK_BY_ID = {p.id: p for p in FEATURE_PACKS}
TOOL_PACKS = frozenset(p.id for p in FEATURE_PACKS if p.kind == "tool")

# Katman → dahil özellik paketleri. Free hiçbir paketi gerektirmeden tam çalışır (çekirdek iş kilitlenmez).
TIER_PACKS: dict[str, frozenset[str]] = {
    "free": frozenset(),
    "plus": frozenset({PACK_PLOTS, PACK_BUILDER}),
    "pro": frozenset(PACK_BY_ID),
}

# Ek özellik paketleri (stub): ana aboneliğin kalemi olur. Satış YOK, fiyat bağlanmadı (`price` None).
ADDON_PACKS: dict[str, dict[str, Any]] = {
    f"addon:pack:{PACK_REPORTS}": {"pack": PACK_REPORTS, "plans": ("plus",), "available": False, "price": None},
    f"addon:pack:{PACK_HEROES}": {"pack": PACK_HEROES, "plans": ("plus",), "available": False, "price": None},
}

# Üyelik sandıkları (game/chests.py): içerik AÇMADAN ÖNCE bellidir (sabit set ya da gösterilen 3 öğeden 1 seçim).
# Satın alınamaz, jetonla açılamaz, yeniden çekilemez. Free'de mevcut ücretsiz sürpriz kutu (olasılık yazılı) sürer.
CHESTS: dict[str, dict[str, Any]] = {
    "free": {"monthly": 0, "tier_up": False},
    "plus": {"monthly": 1, "tier_up": True},
    "pro": {"monthly": 2, "tier_up": True},
}


def packs_for(plan_id: str | None) -> frozenset[str]:
    return TIER_PACKS.get(plan_id or "", frozenset())


# ---------------------------------------------------------------- karşılaştırma tablosu (TR/EN)
_ROWS: tuple[tuple[str, str, str], ...] = (
    ("seats", "Etkin ajan koltuğu", "Active agent seats"),
    ("addon", "Ek koltuk", "Extra seats"),
    ("run_agents", "Bir akışta en çok farklı ajan", "Most distinct agents in one run"),
    ("delegate", "Orkestratör: devretme ve hedef başlatma", "Orchestrator: delegation and goal launch"),
    ("hire", "Orkestratörün yeni ajan işe alması", "Orchestrator hiring new agents"),
    ("boosters", "Token booster'ları", "Token boosters"),
    ("schedules", "Zamanlanmış iş", "Scheduled jobs"),
    ("workflows", "Kayıtlı özel akış", "Saved custom workflows"),
    ("worlds", "Özel dünya", "Custom worlds"),
    ("api_connections", "Adlandırılmış API bağlantısı", "Named API connections"),
    ("history", "Arayüzde koşu geçmişi", "Run history in the UI"),
    ("scenes", "Sahneler", "Scenes"),
    ("heroes", "Kahramanlar", "Heroes"),
    ("season", "Sezon premium kozmetik yolu", "Season premium cosmetic track"),
    ("chests", "Üyelik sandığı (içerik açmadan önce belli)", "Membership chests (contents shown before opening)"),
    ("packs", "Dahil özellik paketleri", "Included feature packs"),
    ("devices", "Cihaz", "Devices"),
)

# free sürümde tabloda yalnız Free'nin kendi satırları: ek koltuk, işe alma, sezon, sandık ve paket satırları ücretli
# katmanları anlatır, orada gösterilmez
_FREE_ROWS = frozenset({"seats", "run_agents", "delegate", "boosters", "schedules", "workflows", "worlds",
                        "api_connections", "history", "scenes", "heroes", "devices"})

_NEVER_ROWS: tuple[tuple[str, str], ...] = (
    ("Yerel modeller ve tüm beyinler (Ollama, Codex, Claude Code, Hermes)",
     "Local models and every brain (Ollama, Codex, Claude Code, Hermes)"),
    ("Onay kapıları, bütçe ve güvenlik", "Approvals, budgets and security"),
    ("Dışa aktarma; hiçbir veri silinmez", "Export; no data is ever deleted"),
    ("MCP ve Claude/Codex entegrasyonu", "MCP and Claude/Codex integration"),
    ("Yürüme modu ve takdir", "Walk mode and recognition"),
    ("Akademi", "Academy"),
    ("11 açık sahne, tüm kazanım yolları ve 5 ücretsiz kahraman", "The 11 open scenes, every earn path and the 5 free heroes"),
    ("XP, seviye, görev, başarım ve jeton: her pakette aynı", "XP, levels, quests, achievements and coins: the same in every plan"),
    ("Eşzamanlılık paketle sınırlanmaz", "Concurrency is never capped by plan"),
)


def _fmt(v: int | None, lang: str) -> str:
    return ("∞" if v is None else str(v))


def _cell(key: str, p: Plan, lang: str) -> str:
    en = lang == "en"
    L = p.limits
    if key == "seats":
        return str(p.seats)
    if key == "addon":
        if not p.addon:
            return "—"
        a = p.addon
        top = seats_with_addons(p, a["max_units"])
        if a["seats_per_unit"] == 1:
            return (f"+1 seat, ${a['price_month']}/mo (up to {top})" if en
                    else f"+1 koltuk, {a['price_month']} $/ay (en çok {top})")
        return (f"+{a['seats_per_unit']} seats, ${a['price_month']}/mo (up to {top})" if en
                else f"+{a['seats_per_unit']} koltuk, {a['price_month']} $/ay (en çok {top})")
    if key == "run_agents":
        return str(p.seats) if p.id == "free" else ("seat count" if en else "koltuk sayısı")
    if key == "delegate":
        if F_DELEGATE not in p.features:
            return "—"
        return "✔" if F_HIRE in p.features else ("With existing agents" if en else "Var olan ajanlarla")
    if key == "hire":
        return "✔" if F_HIRE in p.features else "—"
    if key == "boosters":
        return ("All boosters" if en else "Tüm booster'lar") if F_BOOSTERS in p.features else (
            "3 free boosters" if en else "3 ücretsiz booster")
    if key in ("schedules", "workflows", "worlds", "api_connections"):
        return _fmt(L.get(key), lang)
    if key == "history":
        d = L.get("history_days")
        if d is None:
            return "∞"
        if d >= 365:
            return "1 year" if en else "1 yıl"
        return f"{d} days" if en else f"{d} gün"
    if key == "scenes":
        return {"none": "11 open + every earn path" if en else "11 açık + tüm kazanım yolları",
                "pick1": "+1 World Tour pack" if en else "+1 Dünya Turu paketi",
                "all": "All scene packs included" if en else "Tüm sahne paketleri dahil"}[p.included_scene_packs]
    if key == "heroes":
        return {"free": "5 free heroes" if en else "5 ücretsiz kahraman",
                "pick1": "+1 hero pack a year" if en else "+yılda 1 kahraman paketi",
                "all": "All first-party packs" if en else "Tüm birinci taraf paketler"}[p.included_hero_packs]
    if key == "season":
        if F_SEASON_PREMIUM in p.features:
            return "Included" if en else "Dahil"
        if SEASON_PRICE is None:  # free: satış yok, fiyat yazılmaz
            return "Coming soon" if en else "Yakında"
        return f"${SEASON_PRICE}" if en else f"{SEASON_PRICE} $".replace(".", ",")
    if key == "chests":
        c = CHESTS.get(p.id, CHESTS["free"])
        if not c["monthly"]:
            return "Free surprise box (odds shown)" if en else "Ücretsiz sürpriz kutu (olasılık yazılı)"
        return (f"{c['monthly']}/mo + level-up chest" if en else f"Ayda {c['monthly']} + yükselme sandığı")
    if key == "packs":
        ids = [x.id for x in FEATURE_PACKS if x.id in TIER_PACKS.get(p.id, frozenset())]
        if not ids:
            return "—"
        if len(ids) == len(FEATURE_PACKS):
            return "All packs" if en else "Tüm paketler"
        return ", ".join(PACK_BY_ID[i].label_en if en else PACK_BY_ID[i].label_tr for i in ids)
    if key == "devices":
        return ("Unlimited (local)" if en else "Sınırsız (yerel)") if p.devices is None else str(p.devices)
    return ""


def _source_note(en: bool) -> str:
    return ("This edition is licensed under the PolyForm Shield License 1.0.0 and always runs the Free plan (2 agents)."
            if en else "Bu sürüm PolyForm Shield License 1.0.0 ile lisanslıdır ve her zaman Free paketle (2 ajan) çalışır.")


def compare_table(lang: str = "tr") -> dict[str, Any]:
    en = lang == "en"
    # free sürüm yalnız kendi paketini gösterir
    plans = [PLANS[k] for k in (("free", "plus", "pro") if EDITION == "full" else ("free",))]
    taglines = {
        "free": ("A 2-agent personal assistant office. Play everything, earn every scene." if en
                 else "2 ajanla kişisel asistan ofisin. Her şeyi oyna, her sahneyi kazan."),
        "plus": ("A 10-person company or agency: delegation, scheduled daily jobs." if en
                 else "10 kişilik şirket ya da ajans: devretme, zamanlanmış günlük işler, bulut."),
        "pro": ("20+ agents and every scene and hero pack; reports and remote approval are coming." if en
                else "20+ ajan, bütün sahne ve kahraman paketleri; raporlar ve uzaktan onay yolda."),
    }
    from studio.entitlements.offers import refs_for_compare  # noqa: PLC0415 - offers bu modülü içe aktarır

    refs = refs_for_compare()   # her plan, ek ve pakete kapsamdan türeyen `id@sürüm`
    return {
        "version": PLAN_TABLE_VERSION,
        "plans": [{"id": p.id, "seats": p.seats,
                   **({"price_month": p.price_month, "price_year": p.price_year} if EDITION == "full" else {}),
                   "tagline": taglines[p.id], "offers": refs["plans"].get(p.id)} for p in plans],
        "addons": refs["addons"],
        "rows": [{"key": k, "label": en_l if en else tr_l, "values": {p.id: _cell(k, p, lang) for p in plans}}
                 for k, tr_l, en_l in _ROWS if EDITION == "full" or k in _FREE_ROWS],
        "never_gated": [en_l if en else tr_l for tr_l, en_l in _NEVER_ROWS],
        "feature_packs": [{"id": x.id, "kind": x.kind, "label": x.label_en if en else x.label_tr,
                           "description": x.desc_en if en else x.desc_tr, "enforced": x.enforced,
                           "plans": [k for k in ("free", "plus", "pro") if x.id in TIER_PACKS[k]],
                           "addon": any(a["pack"] == x.id for a in ADDON_PACKS.values()),
                           "offer": refs["packs"][x.id]} for x in FEATURE_PACKS] if EDITION == "full" else [],
        "chests": {k: dict(v) for k, v in CHESTS.items()} if EDITION == "full" else {},
        "coins_for_sale": False,   # jeton yalnız kazanılır (J-A; 2026-10-19 üyelik kararı)
        "source_note": _source_note(en),
    }


@dataclass
class Resolved:
    """Çözümlenmiş etkin plan (motorun iç durumu; API'ye `engine.snapshot()` ile çıkar)."""

    plan: str                       # free (çekirdek); full sürümde ayrıca plus | pro | founder | admin
    source: str                     # default | test | founder | token | admin
    seats: int
    limits: dict[str, int | None]
    features: frozenset[str]
    scene_packs: str = "none"
    hero_packs: str = "free"
    base: str = "free"              # tablo satırı (founder → pro)
    founder_seats: int | None = None
    license: dict[str, Any] = field(default_factory=dict)
    packs: frozenset[str] = frozenset()   # dahil özellik paketleri (TIER_PACKS)
    chests: str = "free"                  # sandık hakkı hangi katmandan (CHESTS anahtarı)


if EDITION == "full":  # geliştirici/test paketi ve ona bağlı seçenekler (yalnız burada yüklenir)
    from studio.full.plan_ext import *  # noqa: E402,F401,F403
