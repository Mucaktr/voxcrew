"""Oyunlaştırma kataloğu: başarımlar, görev şablonları ve mağaza (kozmetik, kutlama stili, sahne, ikram).

Kaynak: B.9 (başarımlar), B.10 (görevler), B.11 (jeton ve fiyatlar).
Sahne kilitleri'e göredir: mevcut 6 sahne ve "Açık deniz" her zaman açık; yeni sahneler ofis
seviyesiyle kendiliğinden ya da jetonla açılır.

Dil (S16): her öğenin Türkçe (`*_tr`) ve İngilizce (`*_en`) metin alanları vardır. `name`, `description`, `title`,
`why`, `label`, `condition`, `hint` özellikleri istek diline (`studio.i18n.request_lang`) göre doğru alanı döner;
böylece oyun API'si (S5, game/service.py) değişmeden EN döner. Açık dil için `localized(item, lang)`.
`CATEGORIES` de dil duyarlıdır (`CATEGORIES_EN` ham İngilizce).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterator

from studio._edition import EDITION
from studio.cities import NEW_CITY_CATALOGS, CityIndexError
from studio.i18n import request_lang

TEXT_FIELDS = ("name", "description", "condition", "hint", "title", "why", "label")


def _pick(tr: str, en: str, lang: str | None = None) -> str:
    return en if (lang or request_lang()) == "en" and en else tr


def localized(item: Any, lang: str | None = None) -> dict[str, str]:
    """Öğenin metin alanları verilen dilde: {"name": …, "description": …} (öğede olan alanlar)."""
    out: dict[str, str] = {}
    for f in TEXT_FIELDS:
        if hasattr(item, f"{f}_tr"):
            out[f] = _pick(getattr(item, f"{f}_tr"), getattr(item, f"{f}_en", ""), lang)
    return out


class LangDict(dict):
    """Türkçe değerleri taşıyan sözlük; istek dili "en" iken okumalar İngilizce karşılığı döner (JSON'a da)."""

    def __init__(self, tr: dict[str, str], en: dict[str, str]):
        super().__init__(tr)
        self._en = dict(en)

    def __getitem__(self, key: str) -> str:
        value = super().__getitem__(key)
        return self._en.get(key, value) if request_lang() == "en" else value

    def get(self, key: str, default: Any = None) -> Any:  # type: ignore[override]
        return self[key] if key in self else default

    def items(self) -> Iterator[tuple[str, str]]:  # type: ignore[override]
        return ((k, self[k]) for k in self)

    def values(self) -> Iterator[str]:  # type: ignore[override]
        return (self[k] for k in self)

    def for_lang(self, lang: str | None = None) -> dict[str, str]:
        return dict(self._en) if (lang or request_lang()) == "en" else {k: dict.__getitem__(self, k) for k in self}


# ================================================================= başarımlar
CATEGORIES_TR = {"ilk_adimlar": "İlk adımlar", "kalite": "Kalite", "ekip": "Ekip", "gelisim": "Gelişim",
                 "yonetici": "Yönetici", "dunya": "Dünya", "ozel": "Özel"}
CATEGORIES_EN = {"ilk_adimlar": "First steps", "kalite": "Quality", "ekip": "Team", "gelisim": "Growth",
                 "yonetici": "Manager", "dunya": "World", "ozel": "Special"}
CATEGORIES = LangDict(CATEGORIES_TR, CATEGORIES_EN)
ROMAN = ["I", "II", "III", "IV", "V"]


def category_label(key: str, lang: str | None = None) -> str:
    return _pick(CATEGORIES_TR.get(key, key), CATEGORIES_EN.get(key, ""), lang)


@dataclass(frozen=True)
class Achievement:
    id: str
    name_tr: str
    description_tr: str
    subject: str                      # agent | human | office
    category: str
    icon: str                         # lucide simge adı (ön yüz eşler)
    tiers: tuple[tuple[int, str], ...]  # (eşik, nadirlik)
    counter: str | None = None        # sayaç adı (None: özel denetim)
    condition_tr: str = ""            # kilitliyken açıkça yazılan koşul
    hidden: bool = False
    hint_tr: str = ""
    reward_item: str | None = None    # ücretsiz açılan öğe
    special: bool = False             # jeton/XP ödülü yok (ör. kurucu ekip)
    name_en: str = ""
    description_en: str = ""
    condition_en: str = ""
    hint_en: str = ""

    @property
    def name(self) -> str:
        return _pick(self.name_tr, self.name_en)

    @property
    def description(self) -> str:
        return _pick(self.description_tr, self.description_en)

    @property
    def condition(self) -> str:
        return _pick(self.condition_tr, self.condition_en)

    @property
    def hint(self) -> str:
        return _pick(self.hint_tr, self.hint_en)

    def tier_name(self, tier: int, lang: str | None = None) -> str:
        name = _pick(self.name_tr, self.name_en, lang)
        return name if len(self.tiers) == 1 else f"{name} {ROMAN[tier - 1]}"

    def node_id(self, tier: int) -> str:
        return self.id if len(self.tiers) == 1 else f"{self.id}-{tier}"


def _a(id_: str, name: str, description: str, subject: str, category: str, icon: str,
       tiers: list[tuple[int, str]], counter: str | None, condition: str, *,
       en: tuple[str, str, str], hint: str = "", hint_en: str = "", **kw: Any) -> Achievement:
    name_en, description_en, condition_en = en
    return Achievement(id_, name, description, subject, category, icon, tuple(tiers), counter, condition,
                       hint_tr=hint, hint_en=hint_en,
                       name_en=name_en, description_en=description_en, condition_en=condition_en, **kw)


ACHIEVEMENTS: list[Achievement] = [
    # ---- yönetici (sen)
    # Karar 4 (2026-10-19): ilk KABUL EDİLEN teslimde açılır (kullanıcı kararı; ajan hakem kararı sayılmaz)
    _a("ilk_mesai", "İlk Mesai", "İlk teslimini inceleyip kabul ettin.", "human", "ilk_adimlar", "clock",
       [(1, "common")], "deliveries_accepted", "1 teslimi kabul et",
       en=("First Shift", "You reviewed and accepted your first delivery.", "Accept 1 delivery")),
    _a("muhur_sende", "Mühür Sende", "İlk onay kapısını karara bağladın. Onay da ret de sayılır.", "human",
       "ilk_adimlar", "stamp", [(1, "common")], "decisions", "1 onay kapısı kararı ver",
       en=("You Hold the Seal", "You decided your first approval gate. Approving and rejecting both count.",
           "Decide 1 approval gate")),
    _a("ise_alim", "İşe Alım", "İlk ajanını oluşturdun ya da bir ofis şablonu kurdun.", "human", "ilk_adimlar",
       "id-card", [(1, "common")], "agents_created", "Bir ajan oluştur ya da şablon kur",
       en=("Hiring", "You created your first agent or set up an office template.",
           "Create an agent or set up a template")),
    _a("stil_ikonu", "Stil İkonu", "Bir ajanın görünüşünü özelleştirdin.", "human", "ilk_adimlar", "sparkles",
       [(1, "common")], "avatar_changes", "Bir ajanın avatarını değiştirip kaydet",
       en=("Style Icon", "You customized an agent's look.", "Change and save an agent's avatar")),
    _a("not_defteri", "Not Defteri", "Belleğe ilk bilgiyi sabitledin.", "human", "ilk_adimlar", "pin",
       [(1, "common")], "pins", "Bellekte bir bilgiyi sabitle",
       en=("Notebook", "You pinned your first fact to memory.", "Pin a fact in memory")),
    _a("kaputun_alti", "Kaputun Altı", "Bir adımın bağlamını açıp isteme giden metni inceledin.", "human",
       "ilk_adimlar", "search", [(1, "common")], "context_opened", "Bir adımın bağlamını aç",
       en=("Under the Hood", "You opened a step's context and inspected the prompt text.",
           "Open a step's context")),
    _a("akis_mimari", "Akış Mimarı", "Kendi tasarladığın bir iş akışı ilk kez başarıyla bitti.", "human",
       "yonetici", "drafting-compass", [(1, "rare")], "workflows_succeeded",
       "Kendi iş akışını bir kez başarıyla bitir",
       en=("Flow Architect", "A workflow you designed finished successfully for the first time.",
           "Finish a workflow of your own successfully once")),
    _a("karar_verici", "Karar Verici", "Onay kapısı kararları verdin. Onay ve ret eşit sayılır.", "human",
       "yonetici", "gavel", [(10, "common"), (100, "rare"), (500, "epic")], "decisions",
       "10 / 100 / 500 onay kapısı kararı",
       en=("Decision Maker", "You decided approval gates. Approvals and rejections count equally.",
           "10 / 100 / 500 approval gate decisions")),
    _a("yapici_elestirmen", "Yapıcı Eleştirmen", "Onay kapısı kararlarına 10 kez gerekçe notu yazdın.", "human",
       "yonetici", "pen-line", [(10, "rare")], "decision_notes", "10 karara gerekçe notu yaz",
       en=("Constructive Critic", "You added a reasoning note to 10 approval gate decisions.",
           "Write a note on 10 decisions")),
    _a("bellek_bahcivani", "Bellek Bahçıvanı", "20 bilgiyi sabitledin, düzelttin ya da geçersiz kıldın.", "human",
       "yonetici", "sprout", [(20, "rare")], "curations", "20 bilgi bakımı yap",
       en=("Memory Gardener", "You pinned, corrected or invalidated 20 facts.", "Curate 20 facts")),
    _a("yanlisi_duzelt", "Yanlışı Düzelt", "Yanlış bir bilgiyi geçersiz kıldın; artık hiçbir ajan onu hatırlamayacak.",
       "human", "yonetici", "eraser", [(1, "common")], "invalidations", "Bir bilgiyi geçersiz kıl",
       en=("Set It Right", "You invalidated a wrong fact; no agent will recall it again.", "Invalidate a fact")),
    _a("mesai_arkadasi", "Mesai Arkadaşı", "Uygulamayı farklı günlerde kullandın. Ardışık olması gerekmez.", "human",
       "gelisim", "calendar-days", [(7, "common"), (30, "rare"), (100, "epic")], "active_days",
       "Toplam 7 / 30 / 100 farklı gün",
       en=("Regular", "You used the studio on different days. They need not be consecutive.",
           "7 / 30 / 100 distinct days in total")),
    _a("hedef_avcisi", "Hedef Avcısı", "Hedeflerini tamamladın.", "human", "yonetici", "flag-triangle-right",
       [(1, "common"), (10, "rare"), (50, "epic")], "goals_completed", "1 / 10 / 50 hedef tamamla",
       en=("Goal Hunter", "You completed your goals.", "Complete 1 / 10 / 50 goals")),
    _a("tur_kasifi", "Tür Kâşifi", "Avatar düzenleyicide sekiz türün hepsini önizledin.", "human", "dunya",
       "paw-print", [(8, "common")], "species_previewed", "8 türün hepsini önizle",
       en=("Species Explorer", "You previewed all eight species in the avatar editor.",
           "Preview all 8 species")),
    _a("gardirop", "Gardırop", "Kozmetik koleksiyonun büyüyor.", "human", "dunya", "shirt",
       [(10, "common"), (20, "rare")], "wardrobe", "10 / 20 kozmetik parçaya sahip ol",
       en=("Wardrobe", "Your cosmetic collection is growing.", "Own 10 / 20 cosmetic items")),
    _a("parti_zamani", "Parti Zamanı", "İlk ofis partisini düzenledin.", "human", "dunya", "party-popper",
       [(1, "common")], "parties", "Mağazadan ofis partisi düzenle",
       en=("Party Time", "You threw your first office party.", "Throw an office party from the shop")),
    _a("akademi", "Akademi", "Akademi derslerini gerçek işle tamamladın.", "human", "ilk_adimlar", "graduation-cap",
       [(3, "common"), (10, "rare")], "academy_lessons", "3 / 10 Akademi dersi tamamla",
       en=("Academy", "You finished Academy lessons by doing the real thing.", "Finish 3 / 10 Academy lessons")),
    _a("kurucu_ekip", "Kurucu Ekip", "Oyunlaştırma gelmeden önce de buradaydın.", "human", "ozel", "gem",
       [(1, "rare")], None, "Yalnızca oyunlaştırmaya geçişte verilir", special=True,
       en=("Founding Team", "You were here before gamification arrived.",
           "Granted only on the switch to gamification")),
    # W1b takdir: jeton/XP vermez (special) — takdir bir jeton lavabosudur, kazanç kapısı değil
    _a("ilk_tesekkur", "İlk Teşekkür", "Bir ajana ilk kez teşekkür notu ya da ikram verdin.", "human", "yonetici",
       "heart-handshake", [(1, "common")], "thanks_given", "Bir ajanın işine teşekkür et", special=True,
       en=("First Thanks", "You gave an agent a thank-you note or a treat for the first time.",
           "Thank an agent for their work")),
    _a("ekip_yemegi", "Ekip Yemeği", "Bir ekibe toplu yemek ısmarladın.", "human", "yonetici", "utensils",
       [(1, "common")], "team_lunches", "Bir ekibe ekip yemeği ısmarla", special=True,
       en=("Team Lunch", "You treated a team to lunch.", "Treat a team to lunch")),
    # W4 takdir bağları: ücretsiz notla da kazanılır, jeton/XP vermez (special)
    _a("takdir_ustasi", "Takdir Ustası", "Farklı çıktılar için ajanlara teşekkür ettin.", "human", "yonetici",
       "award", [(5, "common"), (25, "rare"), (100, "rare")], "thanked_outputs",
       "5 / 25 / 100 farklı çıktıya teşekkür et", special=True,
       en=("Master of Thanks", "You thanked agents for different outputs.", "Thank agents for 5 / 25 / 100 outputs")),
    _a("haftanin_secimi", "Haftanın Seçimi", "İlk kez haftanın çalışanını kendin seçtin.", "human", "yonetici",
       "medal", [(1, "common")], "weekly_picks", "Haftanın çalışanını seç", special=True,
       en=("Pick of the Week", "You picked your employee of the week for the first time.",
           "Pick your employee of the week")),
    # W4 yürüme (walk/service.py): sonlu hatıra ve vize; mini oyun kartları yalnızca ödülsüz rozet (D2 A)
    _a("ilk_hatira", "İlk Hatıra", "Yürürken ilk hatırayı buldun.", "human", "dunya", "gem", [(1, "common")],
       "souvenirs_found", "Bir sahnede bir hatıra bul",
       en=("First Souvenir", "You found your first souvenir while walking.", "Find a souvenir in a scene")),
    _a("hatira_avcisi", "Hatıra Avcısı", "Bir sahnenin hatıra albümünü tamamladın.", "human", "dunya", "images",
       [(1, "common"), (5, "rare")], "albums_completed", "1 / 5 sahne albümünü tamamla",
       en=("Souvenir Hunter", "You completed a scene's souvenir album.", "Complete 1 / 5 scene albums")),
    _a("kasif", "Kâşif", "Simgelere yürüyüp pasaportuna vize ekledin.", "human", "dunya", "map-pinned",
       [(5, "common"), (15, "rare"), (30, "rare")], "visas", "5 / 15 / 30 simge vizesi topla",
       en=("Explorer", "You walked up to landmarks and added visas to your passport.",
           "Collect 5 / 15 / 30 landmark visas")),
    _a("ilk_balik", "İlk Balık", "Oltayla ilk balık kartını yakaladın.", "human", "dunya", "fish", [(1, "common")],
       "fish_cards", "Oltayla bir balık kartı yakala", special=True,
       en=("First Catch", "You caught your first fish card.", "Catch a fish card")),
    _a("ilk_galibiyet", "İlk Galibiyet", "Masa oyununda bir ajanı ilk kez yendin.", "human", "dunya", "grid-3x3",
       [(1, "common")], "board_wins", "Masa oyununda bir ajanı yen", special=True,
       en=("First Win", "You beat an agent at the board game for the first time.", "Beat an agent at the board game")),
    # WALK-EXPLORE (walk/explore.py): sonlu iç mekân ve seyir noktası keşfi; kullanıcının kendi yürüme eylemi
    _a("ic_mekan_gezgini", "İç Mekân Gezgini", "Simge binaların içine girip gezdin.", "human", "dunya", "building-2",
       [(1, "common"), (5, "common"), (12, "rare")], "interiors_visited", "1 / 5 / 12 iç mekân gez",
       en=("Interior Explorer", "You walked into landmark buildings and looked around.", "Visit 1 / 5 / 12 interiors")),
    _a("manzara_avcisi", "Manzara Avcısı", "Seyir noktalarından şehre yukarıdan baktın.", "human", "dunya", "compass",
       [(3, "common"), (10, "rare")], "viewpoints", "3 / 10 seyir noktası bul",
       en=("View Hunter", "You looked out over the city from viewpoints.", "Find 3 / 10 viewpoints")),
    # ---- ajan
    _a("ilk_teslimat", "İlk Teslimat", "Ajanın ilk işi kabul edildi.", "agent", "ilk_adimlar", "package",
       [(1, "common")], "steps_done", "Bir işini kabul et (R-2: XP doğrulanmış işten gelir)",
       en=("First Delivery", "The agent's first work was accepted.", "Accept one of its deliveries (XP comes from verified work)")),
    _a("tek_atista", "Tek Atışta", "Adımları ilk turda ONAY aldı.", "agent", "kalite", "target",
       [(1, "common"), (10, "rare"), (50, "epic"), (200, "legendary")], "first_try",
       "İlk turda onay: 1 / 10 / 50 / 200",
       en=("One Shot", "Its steps were APPROVED on the first round.", "First-round approvals: 1 / 10 / 50 / 200")),
    _a("geri_donus", "Geri Dönüş", "Revizeye giren adımı sonunda onaylandı.", "agent", "kalite", "feather",
       [(1, "common"), (10, "rare"), (50, "epic")], "recovery", "Revizeden toparlanma: 1 / 10 / 50",
       en=("Comeback", "A step that went into revision was approved in the end.",
           "Recoveries from revision: 1 / 10 / 50")),
    _a("yonetici_takdiri", "Yönetici Takdiri", "Katkı verdiği çıktı onay kapısından geçti.", "agent", "kalite",
       "medal", [(25, "rare"), (100, "epic")], "gate_share", "Onaylı kapı payı: 25 / 100",
       en=("Manager's Praise", "Output it contributed to passed an approval gate.",
           "Approved gate share: 25 / 100")),
    _a("temiz_is", "Temiz İş", "En az 100 araç çağrısında %95 ve üstü başarıya ulaştı.", "agent", "kalite",
       "wrench", [(1, "rare")], None, "≥100 araç çağrısında ≥%95 başarı",
       en=("Clean Work", "Reached 95% or higher success over at least 100 tool calls.",
           "≥95% success over ≥100 tool calls")),
    _a("sabir_tasi", "Sabır Taşı", "Yerel modelde 30 dakikadan uzun süren bir adımı başarıyla bitirdi.", "agent",
       "kalite", "hourglass", [(1, "rare")], "long_local_steps", "Yerel modelde 30 dk+ süren adımı bitir",
       en=("Patience", "Finished a step that took over 30 minutes on a local model.",
           "Finish a 30+ minute step on a local model")),
    _a("cok_yonlu", "Çok Yönlü", "Tek çalıştırmada beş araç türünün hepsini başarıyla kullandı.", "agent",
       "kalite", "zap", [(1, "rare")], None, "Tek çalıştırmada web, okuma, kabuk, plan ve yazma",
       en=("Versatile", "Used all five tool types successfully in a single run.",
           "Web, read, shell, plan and write in one run")),
    _a("kidemli_kadro", "Kıdemli Kadro", "Ajan 10. seviyeye ulaştı.", "agent", "gelisim", "graduation-cap",
       [(10, "rare")], "level", "Seviye 10",
       en=("Senior Staff", "The agent reached level 10.", "Level 10")),
    _a("usta", "Usta", "Ajan 20. seviyeye ulaştı.", "agent", "gelisim", "award", [(20, "epic")], "level", "Seviye 20",
       en=("Master", "The agent reached level 20.", "Level 20")),
    _a("efsane", "Efsane", "Ajan 30. seviyeye ulaştı.", "agent", "gelisim", "crown", [(30, "legendary")], "level",
       "Seviye 30", reward_item="hat:crown",
       en=("Legend", "The agent reached level 30.", "Level 30")),
    _a("ekip_kurucu", "Ekip Kurucu", "Devretme sırasında ekibine yeni bir ajan aldı.", "agent", "ekip",
       "user-plus", [(1, "rare")], "hires", "Devretme sırasında bir ajan işe al",
       en=("Team Builder", "Brought a new agent into the team during delegation.",
           "Hire an agent during delegation")),
    _a("devretme_ustasi", "Devretme Ustası", "İşi en az 3 asta dağıttı ve toplanan sonuç başarıyla bitti.", "agent",
       "ekip", "users", [(1, "epic")], "delegations", "Devretme koşusunda ≥3 ast ile başarı",
       en=("Delegation Master", "Split the work among at least 3 reports and the combined result succeeded.",
           "Succeed in a delegation run with ≥3 reports")),
    # ---- ofis
    # en az bir onay kapısı ve bir gözden geçiren adım şart; örnek, alıştırma ve tarif akışları sayılmaz
    _a("kusursuz_akis", "Kusursuz Akış", "Kendi akışın (en az 3 ajan adımı, bir gözden geçiren adım ve bir onay "
       "kapısı) hiç revize turu olmadan ve tüm kapılar onaylanarak bitti.", "office", "kalite", "gem", [(1, "rare")],
       "perfect_runs", "Kendi akışın: ≥3 ajan adımı, ≥1 inceleme, ≥1 kapı; 0 revize, tüm kapılar onaylı",
       en=("Flawless Flow", "Your own flow (at least 3 agent steps, a reviewer step and an approval gate) finished "
           "with no revision rounds and every gate approved.",
           "Your own flow: ≥3 agent steps, ≥1 review, ≥1 gate; 0 revisions, all gates approved")),
    _a("yerli_uretim", "Yerli Üretim", "Yerel modellerle adımlar tamamlandı.", "office", "gelisim", "house",
       [(10, "common"), (100, "rare"), (1000, "epic")], "local_steps", "Yerel modelle 10 / 100 / 1.000 adım",
       en=("Made Locally", "Steps were completed with local models.", "10 / 100 / 1,000 steps on a local model")),
    _a("bayrak_yarisi", "Bayrak Yarışı", "Teslim parşömeni sonraki ajana ulaştı ve iş tamamlandı.", "office", "ekip",
       "flag", [(10, "common"), (100, "rare"), (1000, "epic")], "handoffs_used", "İşe yarayan teslim: 10 / 100 / 1.000",
       en=("Relay Race", "The handoff scroll reached the next agent and the work got done.",
           "Useful handoffs: 10 / 100 / 1,000")),
    _a("tam_kadro", "Tam Kadro", "En az 3 farklı ekipten ajanın çalıştığı bir akış başarıyla bitti.", "office",
       "ekip", "puzzle", [(1, "rare")], "multi_team_runs", "3 farklı ekipten ajanla akış bitir",
       en=("Full Roster", "A flow with agents from at least 3 different teams finished successfully.",
           "Finish a flow with agents from 3 different teams")),
    _a("uzun_zincir", "Uzun Zincir", "En az 8 ajan adımlı bir akış başarıyla bitti.", "office", "ekip", "link",
       [(1, "epic")], "long_runs", "≥8 ajan adımlı akış bitir",
       en=("Long Chain", "A flow with at least 8 agent steps finished successfully.",
           "Finish a flow with ≥8 agent steps")),
    _a("org_semasi", "Organizasyon Şeması", "Genel müdürden analiste beş kademenin hepsi dolu bir ofis kurdun.",
       "office", "ekip", "network", [(1, "rare")], None, "GM, GMY/Direktör, Müdür, Lider, Uzman/Analist kademeleri",
       en=("Org Chart", "You built an office with all five tiers filled, from chief executive to analyst.",
           "CEO, Deputy/Director, Manager, Lead and Specialist/Analyst tiers")),
    _a("ilk_terfi", "İlk Terfi", "Bir ajanı daha üst bir pozisyona terfi ettirdin.", "office", "ekip", "star",
       [(1, "rare")], "promotions", "Bir ajanın rütbesini yükselt", reward_item="outfit:suit",
       en=("First Promotion", "You promoted an agent to a higher position.", "Raise an agent's rank")),
    _a("ofis_buyuyor", "Ofis Büyüyor", "Ofis seviyesi yükseldi.", "office", "gelisim", "building-2",
       [(5, "common"), (10, "rare"), (20, "epic")], "office_level", "Ofis seviyesi 5 / 10 / 20",
       en=("Growing Office", "The office level went up.", "Office level 5 / 10 / 20")),
    _a("gezgin", "Gezgin", "Altı başlangıç sahnesinin her birinde en az bir adım tamamlandı.", "office", "dunya",
       "compass", [(6, "rare")], "scenes_visited", "6 başlangıç sahnesinde adım bitir",
       en=("Wanderer", "At least one step was completed in each of the six starter scenes.",
           "Finish a step in all 6 starter scenes")),
    _a("acik_deniz", "Açık Deniz", "Deniz ya da yat sahnesinde bir iş akışı bitti.", "office", "dunya", "anchor",
       [(1, "rare")], "sea_runs", "Deniz ya da yat sahnesinde akış bitir",
       en=("Open Sea", "A workflow finished in the sea or yacht scene.", "Finish a flow in the sea or yacht scene")),
    _a("ates_basi", "Ateş Başı Hikâyesi", "Kamp sahnesinde bir rapor akışı bitti.", "office", "dunya", "flame",
       [(1, "rare")], "camp_reports", "Gizli", hidden=True, hint="Ateşin başında anlatılan raporlar…",
       en=("Campfire Story", "A report flow finished in the camp scene.", "Hidden"),
       hint_en="Reports told around the fire…"),
    _a("pes_etmek_yok", "Pes Etmek Yok", "Başarısız biten bir akışı aynı gün yeniden çalıştırıp başarıyla bitirdin.",
       "office", "ozel", "repeat", [(1, "rare")], "comebacks", "Gizli", hidden=True, hint="İkinci deneme…",
       en=("Never Give Up", "You re-ran a failed flow the same day and it finished successfully.", "Hidden"),
       hint_en="Second try…"),
]
if EDITION == "full":  # premium sahne ödülleri (studio/full)
    from studio.full.game_catalog import apply_achievement_rewards
    ACHIEVEMENTS = apply_achievement_rewards(ACHIEVEMENTS)
ACH_BY_ID = {a.id: a for a in ACHIEVEMENTS}
ACH_BY_COUNTER: dict[tuple[str, str], list[Achievement]] = {}
for _ach in ACHIEVEMENTS:
    if _ach.counter:
        ACH_BY_COUNTER.setdefault((_ach.subject, _ach.counter), []).append(_ach)

# org_semasi için beş kademe (S6 rütbeleri)
ORG_TIERS: list[set[str]] = [{"ceo"}, {"deputy", "director"}, {"manager"}, {"lead"},
                             {"senior", "specialist", "analyst", "intern"}]
STARTER_SCENES = ("office", "park", "home", "beach", "cafe", "camp")


# ================================================================= görev şablonları (B.10)
@dataclass(frozen=True)
class QuestTemplate:
    id: str
    kind: str          # daily | weekly
    title_tr: str      # {n} hedefle doldurulur
    why_tr: str
    signal: str        # ilerlemeyi artıran oyun sinyali
    target: int = 1
    requires: str | None = None   # uygulanabilirlik koşulu (bkz. service._applicable)
    adaptive: bool = False
    go: str = ""       # ön yüzde "Git" derin bağlantısı
    distinct: bool = False   # aynı anahtar (ör. sahne) bir kez sayılır
    title_en: str = ""
    why_en: str = ""

    @property
    def title(self) -> str:
        return _pick(self.title_tr, self.title_en)

    @property
    def why(self) -> str:
        return _pick(self.why_tr, self.why_en)


QUESTS: list[QuestTemplate] = [
    QuestTemplate("karar_turu", "daily", "Bekleyen {n} kararı ver (onay ya da ret)",
                  "Uzun işler bir onay yüzünden saatlerce beklemesin.", "decision", 1, "pending", go="/gorevler",
                  title_en="Make {n} pending decision(s) (approve or reject)",
                  why_en="Long jobs should not wait hours for one approval."),
    QuestTemplate("gerekceli_karar", "daily", "Bir onay kapısı kararına not ekle",
                  "Not, sonraki turda ajana geri bildirim olur.", "decision_note", 1, "approval_flows", go="/gorevler",
                  title_en="Add a note to an approval gate decision",
                  why_en="The note becomes feedback for the agent in the next round."),
    QuestTemplate("bellek_bakimi", "daily", "{n} bilgiyi gözden geçir: sabitle, düzelt ya da geçersiz kıl",
                  "Yanlış bilgi tüm ajanları zehirlemesin.", "curation", 3, "facts10", go="/bellek",
                  title_en="Review {n} facts: pin, correct or invalidate",
                  why_en="Don't let a wrong fact poison every agent."),
    QuestTemplate("yerel_guc", "daily", "Yerel modelle bir adım tamamla",
                  "Ücretsiz ve yerel çalışma kotanı korur.", "local_step", 1, "ollama", go="/gorevler",
                  title_en="Complete a step with a local model",
                  why_en="Free and local; it saves your quota."),
    QuestTemplate("tek_atis", "daily", "Bir adım ilk turda ONAY alsın",
                  "İyi istem, tur ve zaman kazandırır.", "first_try", 1, "review_flows", go="/akislar",
                  title_en="Get a step APPROVED on the first round",
                  why_en="A good prompt saves rounds and time."),
    QuestTemplate("mekan_degisikligi", "daily", "Ekibini başka bir sahnede çalıştır",
                  "Biraz hava değişimi.", "scene_step", 1, None, go="/",
                  title_en="Run your team in a different scene", why_en="A little change of scenery."),
    QuestTemplate("gunun_isi", "daily", "Bir adımı başarıyla tamamla",
                  "Küçük bir teslim de ilerlemedir.", "step_done", 1, None, go="/gorevler",
                  title_en="Complete a step successfully", why_en="A small delivery is progress too."),
    QuestTemplate("kalite_haftasi", "weekly", "{n} adım ilk turda onay alsın",
                  "Kaliteli istem, revize turlarını azaltır.", "first_try", 3, "review_flows", adaptive=True,
                  go="/akislar",
                  title_en="Get {n} steps approved on the first round",
                  why_en="Quality prompts mean fewer revision rounds."),
    QuestTemplate("ekip_isi", "weekly", "3 farklı ekipten ajanın katıldığı bir akışı bitir",
                  "Ekipler birlikte çalışınca iş büyür.", "multi_team_run", 1, "teams3", go="/akislar",
                  title_en="Finish a flow with agents from 3 different teams",
                  why_en="Work grows when teams work together."),
    QuestTemplate("bahar_temizligi", "weekly", "{n} bilgiyi gözden geçir",
                  "Temiz bellek, isabetli hatırlama.", "curation", 10, "facts30", go="/bellek",
                  title_en="Review {n} facts", why_en="Clean memory, accurate recall."),
    QuestTemplate("yeni_surec", "weekly", "Yeni bir iş akışı tasarla ve bir kez başarıyla çalıştır",
                  "İyi süreç, tekrar eden işi kolaylaştırır.", "wf_first_success", 1, None, go="/akislar",
                  title_en="Design a new workflow and run it successfully once",
                  why_en="A good process makes repeated work easier."),
    QuestTemplate("saha_gezisi", "weekly", "{n} farklı sahnede akış tamamla",
                  "Ekibin yeni yerler görsün.", "scene_run", 2, None, go="/", distinct=True,
                  title_en="Complete flows in {n} different scenes", why_en="Let your team see new places."),
    QuestTemplate("hedef_haftasi", "weekly", "Bir hedefi tamamla",
                  "Hedefler işin neden yapıldığını görünür kılar.", "goal_completed", 1, "goals", go="/hedefler",
                  title_en="Complete a goal", why_en="Goals make it visible why the work is done."),
    # W4 yürüme görevleri: `requires: walk*`; günlük ve haftalık panoda en çok 1 yuva (service._pick)
    QuestTemplate("ziyaret_turu", "daily", "{n} ajanı ziyaret et ve birer çıktısına bak",
                  "Çıktıları gözden geçirmek işi yakından tanımaktır.", "walk_review", 3, "walk", go="/",
                  title_en="Visit {n} agents and look at one output from each",
                  why_en="Reviewing outputs is how you get to know the work."),
    QuestTemplate("kafeden_gorev", "daily", "Kahve noktasından bir görev başlat",
                  "Gerçek bir iş, kahve molasında da başlar.", "walk_run", 1, "walk", go="/",
                  title_en="Start a task from the coffee spot", why_en="Real work can start on a coffee break too."),
    QuestTemplate("tesekkur_et", "daily", "Bir çıktı için bir ajana teşekkür et",
                  "Ajan neyi takdir ettiğini hatırlar.", "thanks_output", 1, "walk", go="/",
                  title_en="Thank an agent for an output", why_en="The agent remembers what you appreciated."),
    QuestTemplate("hatira_bul", "daily", "{n} hatıra bul", "Her sahnede saklı hatıralar var.", "walk_souvenir", 2,
                  "walk_souvenirs", go="/", title_en="Find {n} souvenirs", why_en="Every scene hides a few souvenirs."),
    QuestTemplate("kasif", "daily", "Bir simge keşfet", "Pasaportuna bir vize ekle.", "walk_visa", 1,
                  "walk_landmarks", go="/", title_en="Discover a landmark", why_en="Add a visa to your passport."),
    QuestTemplate("sehir_gezgini", "weekly", "{n} farklı sahnede birer hatıra bul",
                  "Yeni yerler, yeni hatıralar.", "walk_souvenir", 3, "walk_souvenir_scenes", go="/", distinct=True,
                  title_en="Find a souvenir in {n} different scenes", why_en="New places, new souvenirs."),
    QuestTemplate("haftanin_calisani", "weekly", "Haftanın çalışanını seç (isteğe bağlı)",
                  "Seçim senin; sistem aday önermez.", "weekly_pick", 1, "walk", go="/",
                  title_en="Pick your employee of the week (optional)",
                  why_en="The choice is yours; the studio never suggests anyone."),
]
QUEST_BY_ID = {q.id: q for q in QUESTS}
WALK_REQUIRES = frozenset({"walk", "walk_souvenirs", "walk_souvenir_scenes", "walk_landmarks"})


def is_walk_quest(tpl: QuestTemplate | None) -> bool:
    """Yürüme görevi mi? (günlük ve haftalık panoda en çok 1 yuva)"""
    return tpl is not None and tpl.requires in WALK_REQUIRES
SLOTS = {"daily": 3, "weekly": 2}


# ================================================================= mağaza (B.11)
@dataclass(frozen=True)
class ShopItem:
    id: str            # tür:ad — ör. hat:crown, scene:yacht, celebration:hearts, treat:party
    kind: str          # cosmetic | celebration | scene | consumable
    label_tr: str
    price: int
    rarity: str = "common"
    min_level: int = 0          # satın almak için gereken ofis seviyesi
    unlock_level: int = 0       # bu ofis seviyesinde kendiliğinden (ücretsiz) açılır
    achievement: str | None = None   # bu başarımla ücretsiz açılır
    description_tr: str = ""
    legacy: bool = False        # oyunlaştırmadan önce de vardı (geçişte açık kalır)
    extra: dict[str, Any] = field(default_factory=dict)
    label_en: str = ""
    description_en: str = ""

    @property
    def label(self) -> str:
        return _pick(self.label_tr, self.label_en)

    @property
    def description(self) -> str:
        return _pick(self.description_tr, self.description_en)


# ================================================================= SP-W0 sahne paketleri
# Katman: core (mevcut 13 sahne) · city (Dünya Turu şehirleri) · premium (5 premium sahne). Her yeni sahnenin bir KAZANIM
# kapısı vardır (ofis seviyesi, başarım ya da pasaport damgası) ve bu kapı kaldırılmaz. Gerçek para kodu YOK: Faz 8c
# açılana kadar para düğmesi gizlidir; jeton paketi yoktur. Paketler yalnız gruplama ve kazanım yolu metnidir.
SCENE_TIERS = ("core", "city", "premium")
CORE_SCENES = ("office", "park", "home", "beach", "cafe", "camp", "mall", "school", "battlefield", "sea", "yacht", "space",
               "snow")


@dataclass(frozen=True)
class ScenePack:
    id: str
    tier: str
    label_tr: str
    label_en: str
    # planlanan sahne kimlikleri (sahne kodu geldikçe SHOP'a / ALWAYS_OPEN_SCENES'e eklenir)
    scenes: tuple[str, ...]
    free: bool = False

    @property
    def label(self) -> str:
        return _pick(self.label_tr, self.label_en)


SCENE_PACKS: dict[str, ScenePack] = {p.id: p for p in (
    ScenePack("world_tour_turkey", "city", "Türkiye", "Türkiye", ("istanbul", "kapadokya"), free=True),
    ScenePack("world_tour_europe", "city", "Dünya Turu: Avrupa", "World Tour: Europe", ("londra",)),
)}
if EDITION == "full":  # kaldırılan şehir ve premium paketleri (studio/full; ücretsiz sürümde silinir)
    from studio.full.game_catalog import scene_packs
    SCENE_PACKS = scene_packs(SCENE_PACKS, ScenePack)


def _with_new_cities(packs: dict[str, ScenePack]) -> dict[str, ScenePack]:
    """yeni şehir catalog.json `shop.pack` paketine eklenir (planlı kimlik zaten listedeyse aynen kalır). Bilinmeyen paket
    ya da ücretsiz paket reddedilir (FREE_CITY_SCENES değişmez; yeni şehir damga/jetonla açılır, O3)."""
    out = dict(packs)
    for cid, c in NEW_CITY_CATALOGS.items():
        pid = c["shop"]["pack"]
        p = out.get(pid)
        if p is None or p.tier != "city" or p.free:
            raise CityIndexError([f"{cid}: paket {pid!r} ücretli bir şehir paketi değil"])
        if cid not in p.scenes:
            out[pid] = ScenePack(p.id, p.tier, p.label_tr, p.label_en, (*p.scenes, cid), free=p.free)
    return out


SCENE_PACKS = _with_new_cities(SCENE_PACKS)
# Pasaport damgası (§4.2): bir şehir sahnesinde biten her akış sayılır; ilk akış ilk damgayı, sonra her 10 akış bir damga
# daha verir. Bir damga, seçilen bir şehri (tier "city") kalıcı açar.
PASSPORT_FLOWS = 10


def scene_pack(scene_id: str) -> ScenePack | None:
    return next((p for p in SCENE_PACKS.values() if scene_id in p.scenes), None)


def scene_tier(scene_id: str) -> str | None:
    """Sahnenin katmanı: core / city / premium (bilinmeyen kimlikte None)."""
    if scene_id in CORE_SCENES:
        return "core"
    pack = scene_pack(scene_id)
    return pack.tier if pack else None


def is_city(scene_id: str | None) -> bool:
    return bool(scene_id) and scene_tier(scene_id or "") == "city"


def stamps_earned(city_flows: int) -> int:
    """Biten şehir akışı → kazanılan damga: 0 → 0, 1 → 1, 11 → 2, 21 → 3 …"""
    return 0 if city_flows < 1 else 1 + (int(city_flows) - 1) // PASSPORT_FLOWS


def scene_extra(scene_id: str, earn: str, *, ip_risk: int = 0, culture_risk: int = 0) -> dict[str, Any]:
    """Sahne mağaza öğesinin `extra` alanı: katman, paket, kazanım yolu (level | achievement | stamp | free) ve risk puanı."""
    pack = scene_pack(scene_id)
    return {"tier": scene_tier(scene_id) or "core", "pack": pack.id if pack else None, "earn": earn,
            "ip_risk": ip_risk, "culture_risk": culture_risk}


def coin_buyable(item: ShopItem) -> bool:
    """Ücretsiz sürümde damgayla kazanılan şehir (`earn: stamp`, ör. Londra) jetonla satın alınamaz; yalnız pasaport damgası açar."""
    return EDITION == "full" or (item.extra or {}).get("earn") != "stamp"


SHOP: list[ShopItem] = [
    ShopItem("hat:beret", "cosmetic", "Ressam beresi", 150, legacy=True, label_en="Painter's beret"),
    ShopItem("hat:straw", "cosmetic", "Hasır şapka", 150, legacy=True, label_en="Straw hat"),
    ShopItem("hat:party", "cosmetic", "Parti şapkası", 150, legacy=True, label_en="Party hat"),
    ShopItem("hat:tophat", "cosmetic", "Silindir", 1000, "epic", legacy=True, label_en="Top hat"),
    ShopItem("hat:crown", "cosmetic", "Taç", 2500, "legendary", min_level=15, achievement="efsane", legacy=True,
             description_tr="Ofis seviyesi 15 gerekir; Efsane başarımıyla ücretsiz açılır.",
             label_en="Crown", description_en="Requires office level 15; unlocked free with the Legend achievement."),
    ShopItem("glasses:sun", "cosmetic", "Güneş gözlüğü", 150, legacy=True, label_en="Sunglasses"),
    ShopItem("glasses:star", "cosmetic", "Yıldız gözlük", 400, "rare", legacy=True, label_en="Star glasses"),
    ShopItem("outfit:labcoat", "cosmetic", "Laboratuvar önlüğü", 150, legacy=True, label_en="Lab coat"),
    ShopItem("outfit:dress", "cosmetic", "Elbise", 150, legacy=True, label_en="Dress"),
    ShopItem("outfit:hawaii", "cosmetic", "Hawaii gömleği", 400, "rare", legacy=True, label_en="Hawaiian shirt"),
    ShopItem("outfit:suit", "cosmetic", "Takım elbise", 400, "rare", achievement="ilk_terfi", legacy=True,
             description_tr="İlk Terfi başarımıyla ücretsiz açılır.",
             label_en="Suit", description_en="Unlocked free with the First Promotion achievement."),
    ShopItem("celebration:hearts", "celebration", "Kalp konfeti", 150,
             description_tr="Kutlamalarda kalp biçimli konfeti.",
             label_en="Heart confetti", description_en="Heart-shaped confetti at celebrations."),
    ShopItem("celebration:balloons", "celebration", "Balonlar", 150, description_tr="Kutlamalarda yükselen balonlar.",
             label_en="Balloons", description_en="Rising balloons at celebrations."),
    ShopItem("celebration:fireworks", "celebration", "Havai fişek", 400, "rare",
             description_tr="Kutlamalarda havai fişek (hareket azaltmada statik).",
             label_en="Fireworks", description_en="Fireworks at celebrations (static with reduced motion)."),
    ShopItem("scene:snow", "scene", "Karlı köy", 2500, "epic", unlock_level=6,
             description_tr="Ofis seviyesi 6'da ücretsiz açılır.",
             label_en="Snowy village", description_en="Unlocked free at office level 6.", extra=scene_extra("snow", "level")),
    ShopItem("scene:battlefield", "scene", "Savaş sahası", 3000, "epic", unlock_level=8,
             description_tr="Oyuncak siperler ve karargâh çadırı. Ofis seviyesi 8'de ücretsiz açılır.",
             label_en="Battlefield", description_en="Toy trenches and a command tent. Unlocked free at office level 8.",
             extra=scene_extra("battlefield", "level")),
    ShopItem("scene:space", "scene", "Uzay üssü", 4000, "epic", unlock_level=10,
             description_tr="Ofis seviyesi 10'da ücretsiz açılır.",
             label_en="Space station", description_en="Unlocked free at office level 10.", extra=scene_extra("space", "level")),
    ShopItem("scene:yacht", "scene", "Yat", 5000, "legendary", unlock_level=12,
             description_tr="Güverte, havuz ve kokpit. Ofis seviyesi 12'de ücretsiz açılır.",
             label_en="Yacht", description_en="Deck, pool and cockpit. Unlocked free at office level 12.",
             extra=scene_extra("yacht", "level")),
    # SP-W2a: Londra (Dünya Turu: Avrupa) — kazanım: pasaport damgası (ya da jeton); para paketi Faz 8c'ye kadar kapalı
    ShopItem("scene:londra", "scene", "Londra", 3000, "epic",
             description_tr="Tuğla teraslı evler, köşe pubu, ördekli park ve nehir rıhtımı. Pasaport damgasıyla ücretsiz açılır.",
             label_en="London", description_en="Brick terraces, a corner pub, a duck pond and a river embankment. "
                                                "Unlocked free with a passport stamp.",
             extra=scene_extra("londra", "stamp", ip_risk=1, culture_risk=0)),
    ShopItem("treat:coffee", "consumable", "Kahve ısmarla", 30, description_tr="Ekibe kahve. Yalnızca eğlence.",
             label_en="Buy a coffee", description_en="Coffee for the team. Just for fun."),
    ShopItem("treat:fireworks", "consumable", "Havai fişek gösterisi", 100, description_tr="Bir kutlama gösterisi.",
             label_en="Fireworks show", description_en="A celebration show."),
    ShopItem("treat:party", "consumable", "Ofis partisi", 250, description_tr="Herkese konfeti ve parti havası.",
             label_en="Office party", description_en="Confetti and a party mood for everyone."),
]
if EDITION == "full":  # kaldırılan şehir ve premium sahne öğeleri (studio/full)
    from studio.full.game_catalog import splice_scene_items
    SHOP = splice_scene_items(SHOP, ShopItem, scene_extra)
# yeni dünya şehirlerinin mağaza öğeleri (catalog.json `shop` + `ip`): pasaport damgasıyla ya da jetonla açılır
SHOP.extend(
    ShopItem(f"scene:{cid}", "scene", c["shop"]["label_tr"], c["shop"]["price"], c["shop"]["rarity"],
             description_tr=c["shop"]["description_tr"], label_en=c["shop"]["label_en"], description_en=c["shop"]["description_en"],
             extra=scene_extra(cid, c["shop"]["earn"], ip_risk=c["ip"]["ip_risk"], culture_risk=c["ip"]["culture_risk"]))
    for cid, c in NEW_CITY_CATALOGS.items())
SHOP_BY_ID = {i.id: i for i in SHOP}
# Her zaman açık sahneler: mevcut 6 sahne + başlangıçta açık yeni sahne "sea".
# SP-W0: ücretsiz şehirler (Türkiye paketi: İstanbul, Kapadokya) sahne kodu geldikçe buraya eklenir — mevcut 13 sahnenin
# kilitleri değişmez (İ10). SP-W1: İstanbul (her zaman açık; mağazada öğesi yok, AVM/okul gibi).
FREE_CITY_SCENES: tuple[str, ...] = ("istanbul", "kapadokya")
ALWAYS_OPEN_SCENES = (*STARTER_SCENES, "sea", "mall", "school", *FREE_CITY_SCENES)  # S34 AVM, S42 okul: ücretsiz (STARTER_SCENES'e eklenmez → Gezgin hesabı değişmez)
# Başlangıç kozmetikleri (gardırop sayımı için; kimlik ifadesi öğeleri her zaman ücretsiz, Y15)
STARTER_COSMETICS = ("hat:cap", "hat:beanie", "hat:headphones", "glasses:round", "glasses:square",
                     "outfit:tshirt", "outfit:hoodie", "outfit:sweater", "outfit:overalls")


# ================================================================= ofis dekoru (S35)
@dataclass(frozen=True)
class Decor:
    """Ofis seviyesiyle (ekip XP'si) kendiliğinden açılan dünya yapıcı eşyası. Satılmaz, jetonla açılmaz; yalnızca
    kozmetiktir. `id`, dünya yapıcı paletindeki öğe kimliğidir (frontend/src/lib/builder.ts PALETTE) — burada yalnızca
    başvurulur. Var olan dünyalardaki eşyalar kilitlenmez; kilit yalnızca palette yeni yerleştirmeyi etkiler.
    Oyunlaştırma kapalı ya da yaratıcı moddayken hepsi açıktır."""
    id: str
    unlock_level: int
    label_tr: str
    label_en: str

    @property
    def label(self) -> str:
        return _pick(self.label_tr, self.label_en)


DECOR: list[Decor] = [
    Decor("flag", 2, "Bayrak", "Flag"),
    Decor("lantern", 3, "Fener", "Lantern"),
    Decor("block_glow", 4, "Işıklı blok", "Glow block"),
    Decor("campfire", 5, "Kamp ateşi", "Campfire"),
    Decor("snowman", 6, "Kardan adam", "Snowman"),
]
DECOR_BY_ID = {d.id: d for d in DECOR}


# Kıdem bantları, yönetici unvanları (game/rules.py, S5) ve ofis seviyesi etiketi — EN karşılıkları
GAME_TITLES_EN: dict[str, str] = {
    "Stajyer": "Intern", "Analist": "Analyst", "Kıdemli": "Senior", "Lider": "Lead", "Müdür": "Manager",
    "GMY": "Deputy CEO", "Genel Müdür": "Chief Executive",
    "Girişimci": "Entrepreneur", "Kurucu": "Founder", "Patron": "Boss", "Yönetim Kurulu Başkanı": "Chairman",
    "Holding Başkanı": "Holding President", "Efsane Kurucu": "Legendary Founder",
}
_OFFICE_LEVEL = re.compile(r"^Ofis Sv (\d+)$")


def localize_title(title: str, lang: str | None = None) -> str:
    """Oyun unvanı ("Stajyer", "Patron", "Ofis Sv 3") verilen dilde; bilinmeyen metin olduğu gibi döner."""
    if (lang or request_lang()) != "en" or not title:
        return title
    m = _OFFICE_LEVEL.match(title)
    if m:
        return f"Office Lv {m.group(1)}"
    return GAME_TITLES_EN.get(title, title)


def missing_translations() -> list[str]:
    """EN alanı boş kalan katalog öğeleri ("achievement:id.alan" biçiminde); test ve bakım için."""
    out: list[str] = []
    for a in ACHIEVEMENTS:
        for f in ("name", "description", "condition", "hint"):
            if getattr(a, f"{f}_tr") and not getattr(a, f"{f}_en"):
                out.append(f"achievement:{a.id}.{f}")
    for q in QUESTS:
        for f in ("title", "why"):
            if getattr(q, f"{f}_tr") and not getattr(q, f"{f}_en"):
                out.append(f"quest:{q.id}.{f}")
    for i in SHOP:
        for f in ("label", "description"):
            if getattr(i, f"{f}_tr") and not getattr(i, f"{f}_en"):
                out.append(f"shop:{i.id}.{f}")
    out += [f"decor:{d.id}.label" for d in DECOR if not d.label_en]
    out += [f"category:{k}" for k in CATEGORIES_TR if not CATEGORIES_EN.get(k)]
    return out


# ================================================================= W1b hediye kataloğu
# Takdir ve hediye. Fiyatlar [VARSAYIM]; jeton yalnızca kazanılmış jetondur (lavabo). Tür ve
# fiyat yalnızca görseldir: istem etkisi (RecognitionStage) her hediyede ve ücretsiz notta AYNIDIR.
@dataclass(frozen=True)
class GiftItem:
    id: str
    kind: str                   # thanks | coffee | tea | snack | meal | dessert | plant | trophy | team_lunch
    category: str               # note | consumable | keepsake | team
    label_tr: str
    price: int                  # team_lunch: üye başına
    duration_min: int = 0       # kozmetik keyif süresi (görsel)
    per_agent_max: int = 0      # kalıcı süs üst sınırı (0 = yok)
    description_tr: str = ""
    label_en: str = ""
    description_en: str = ""

    @property
    def label(self) -> str:
        return _pick(self.label_tr, self.label_en)

    @property
    def description(self) -> str:
        return _pick(self.description_tr, self.description_en)


GIFTS: list[GiftItem] = [
    GiftItem("thanks", "thanks", "note", "Teşekkür notu", 0, description_tr="Ücretsiz. Ajan neyi takdir ettiğini hatırlar.",
             label_en="Thank-you note", description_en="Free. The agent remembers what you appreciated."),
    GiftItem("coffee", "coffee", "consumable", "Kahve", 5, 20, description_tr="Bir fincan kahve.",
             label_en="Coffee", description_en="A cup of coffee."),
    GiftItem("tea", "tea", "consumable", "Çay", 5, 20, description_tr="Bir bardak çay.",
             label_en="Tea", description_en="A glass of tea."),
    GiftItem("snack", "snack", "consumable", "Atıştırmalık", 10, 30, description_tr="Kurabiye ya da meyve.",
             label_en="Snack", description_en="A cookie or some fruit."),
    GiftItem("meal", "meal", "consumable", "Yemek", 20, 60, description_tr="Bir tepsi yemek.",
             label_en="Meal", description_en="A tray of food."),
    GiftItem("dessert", "dessert", "consumable", "Tatlı", 15, 30, description_tr="Bir dilim pasta.",
             label_en="Dessert", description_en="A slice of cake."),
    GiftItem("plant", "plant", "keepsake", "Masa bitkisi", 60, per_agent_max=2,
             description_tr="Masaya kalıcı bir saksı (ajan başına en çok 2).",
             label_en="Desk plant", description_en="A permanent pot for the desk (at most 2 per agent)."),
    GiftItem("trophy", "trophy", "keepsake", "Masa kupası", 120, per_agent_max=3,
             description_tr="Masaya kalıcı bir kupa (ajan başına en çok 3).",
             label_en="Desk trophy", description_en="A permanent trophy for the desk (at most 3 per agent)."),
    GiftItem("team_lunch", "team_lunch", "team", "Ekip yemeği", 15, 60,
             description_tr="Ekibin tüm üyelerine yemek (üye başına 15, en çok 150 jeton).",
             label_en="Team lunch", description_en="Lunch for every team member (15 per member, at most 150 coins)."),
]
GIFT_BY_ID = {g.id: g for g in GIFTS}
TEAM_LUNCH_MAX = 150
