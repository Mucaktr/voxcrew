"""Şehir paketleri kataloğu (CITY-PACKS).

Kurallar:
- Paket = set; tek öğe satılmaz. Mağaza kimliği `store:city-<paket>`, öğe `store:city-<paket>-<öğe>` (kozmetik setlerin
  `store:<set>` biçimiyle aynı ad alanı ama `city-` önekiyle ayrık; `cosmetics.catalog` kimlikleriyle kesişmez).
- Para fiyatı YOK (`price` her zaman `None`, `for_sale` False). `price_proposal` yalnız CEO'ya ÖNERİDİR (plans.py ve
  araştırmayla hizalı); satış ödeme kapısının (RUNBOOK §11) ve avukat incelemesinin arkasındadır.
- Jeton fiyatı oyun ekonomisinden seçilir (kozmetik setlerle aynı ölçek: parça başına ≈ 300–400 jeton), para fiyatından
  TÜRETİLMEZ; jeton satılmaz.
- Yalnız görünüş: bu modülde XP, jeton ödülü, damga, hız, koltuk ya da izin alanı yoktur (`ADVANTAGE_FIELDS` testi).
- `ip_risk` / `culture_risk` 0–3: ≤ 1 yayınlanır, 2 insan/avukat incelemesi, 3 red. Her öğe tek satırlık gerekçe taşır.
  `esinli` öğe (korunan yapı yerine o mimari türü andıran özgün tasarım; karar 2026-10-25) her zaman
  `legal_review_before_sale=True`'dur.
- Adlar genel ve betimleyicidir: gerçek yapı adı, takma adı, marka, sponsor ya da dükkân adı yok (`BRAND_BLOCKLIST` testi).
- Ön yüz eşi `frontend/src/voxel/citypacks/catalog.ts` CITYPACKS bloğudur (kimlik, ad, ayak izi, risk, jeton fiyatı;
  tests/test_citypacks.py karşılaştırır).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Mapping

from studio._edition import EDITION

STORE_PREFIX = "store:city-"
PACK_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")
KINDS = ("landmark", "furniture", "material", "decor")
SURFACES = ("builder", "city")
RISK_PUBLISH_MAX = 1
# Öğe başına çizim bütçesi (kutu): şehir parseli yakın bütçesi solid 192 / cam 12 / parıltı 12 (citymap/district.ts) ve
# dünya yapıcı decor sınırı 400 parça. Ön yüz testi (frontend/scripts/citypacks.test.mjs) gerçek sayıları bu tabloyla denetler.
BOX_BUDGET = MappingProxyType({"landmark": 120, "furniture": 40, "material": 60, "decor": 60})
GLOW_BUDGET = 12
GLASS_BUDGET = 12

# Gerçek yapı, marka, sponsor ve kurum adları: hiçbir ad, açıklama ya da kimlikte geçmez (küçük harf, aksansız karşılaştırma).
BRAND_BLOCKLIST: tuple[str, ...] = (
    "eiffel", "eyfel", "louvre", "garnier", "opera national", "alexandre", "wallace", "guimard", "ratp", "sete",
    "big ben", "elizabeth tower", "tower bridge", "royal albert", "albert hall", "kew", "marble arch", "routemaster", "tfl",
    "empire state", "chrysler", "flatiron", "grand central", "washington square", "mta",
    "nihonbashi", "marunouchi", "jr east", "skytree", "sensoji", "senso-ji",
    "valens", "bozdogan", "beyazit", "constantine", "cemberlitas", "yedikule", "sarihan", "ortahisar", "galata", "ayasofya",
    "christ", "cristo", "redentor", "redeemer", "corcovado", "sugarloaf", "pao de acucar", "bondinho", "copacabana",
    "burle marx", "selaron",
    "colosseum", "kolezyum", "sydney", "hollywood", "atomium", "burj", "gherkin", "stonehenge",
    "coca", "pepsi", "starbucks", "mcdonald", "nike", "adidas", "lego", "disney", "minecraft", "roblox", "fortnite",
)
ADVANTAGE_FIELDS = ("xp", "coins_reward", "sp", "stamp", "speed", "seats", "permission", "tier")


@dataclass(frozen=True)
class Item:
    id: str                         # paket içi kimlik (`aqueduct`)
    name_tr: str
    name_en: str
    w: int
    d: int
    solid: bool
    ip_risk: int
    culture_risk: int
    ip_note: str                    # tek satırlık gerekçe (EN; avukat incelemesine girdi)
    esinli: bool = False            # korunan yapının birebiri değil, türünü andıran özgün tasarım
    legal_review_before_sale: bool = False


@dataclass(frozen=True)
class Pack:
    id: str
    name_tr: str
    name_en: str
    description_tr: str
    description_en: str
    kind: str
    city: str | None
    surfaces: tuple[str, ...]
    coin_price: int                 # [H] jeton; para fiyatından türetilmez
    price_proposal_usd: float | None  # YALNIZ ÖNERİ (satış kapalı); free sürümde None
    plans_proposal: Mapping[str, str]
    items: tuple[Item, ...]
    seasonal: bool = False          # sezonluk tema ama yıl boyu satılık/kazanılır (FOMO yok)
    price: None = None              # para fiyatı bağlanmaz
    extra: Mapping[str, Any] = field(default_factory=lambda: MappingProxyType({}))

    @property
    def store_id(self) -> str:
        return f"{STORE_PREFIX}{self.id}"

    def piece_id(self, item: Item) -> str:
        return f"{STORE_PREFIX}{self.id}-{item.id}"

    @property
    def pieces(self) -> tuple[str, ...]:
        return tuple(self.piece_id(i) for i in self.items)

    @property
    def ip_risk(self) -> int:
        return max(i.ip_risk for i in self.items)

    @property
    def culture_risk(self) -> int:
        return max(i.culture_risk for i in self.items)

    @property
    def legal_review_before_sale(self) -> bool:
        return any(i.legal_review_before_sale for i in self.items)


def _i(id_: str, tr: str, en: str, w: int, d: int, ip: int, note: str, *, solid: bool = True, culture: int = 0,
       esinli: bool = False) -> Item:
    return Item(id_, tr, en, w, d, solid, ip, culture, note, esinli, esinli)


# Plan önerileri (plans.py ile hizalı): yapı paketleri sahne/şehir içeriğidir → Plus "pick1" (included_scene_packs), Pro
# "included" (all). Mağaza setleri (mobilya, ışık, bahçe, festival, malzeme) gereği pakete DAHİL
# DEĞİLDİR; Pro'ya %20 indirim önerisi.
if EDITION == "full":  # para fiyatı önerisi yalnız tam sürümde; free sürümde fiyat yok
    from studio.full.plan_prices import CITYPACK_PROPOSALS_USD as _PROPOSALS
else:
    _PROPOSALS = {}


def _usd(pack_id: str) -> float | None:
    return _PROPOSALS[pack_id] if EDITION == "full" else None


LANDMARK_PLANS = MappingProxyType({"free": "earn_or_buy", "plus": "pick1", "pro": "included"})
STORE_PLANS = MappingProxyType({"free": "earn_or_buy", "plus": "buy", "pro": "discount_20"})

PACKS: tuple[Pack, ...] = (
    Pack("istanbul-heritage", "İstanbul Tarihî Yapılar", "Istanbul Heritage",
         "Yarımadanın dört kadim yapısı: iki katlı Roma su kemeri, beyaz taş yangın gözetleme kulesi, porfir anıt sütun ve "
         "çokgen kuleli hisar kapısı. Dünya yapıcıda yerleşir; İstanbul haritasında Tarihî Yarımada'da görünür.",
         "Four ancient structures of the old city: a two-tier Roman aqueduct, a white-stone fire-watch tower, a porphyry "
         "column and a fortress gate with polygonal towers. Place them in the world builder; they also appear in the "
         "Historic Peninsula of the Istanbul map.",
         "landmark", "istanbul", ("builder", "city"), 1600, _usd("istanbul-heritage"), LANDMARK_PLANS, (
             _i("aqueduct", "Su kemeri", "Roman aqueduct", 10, 2, 0, "4th-century Roman work, public domain; generic name; "
                "Law 2863 governs on-site filming and physical copies, not original depictions."),
             _i("fire-tower", "Yangın gözetleme kulesi", "Fire-watch tower", 3, 3, 0, "1828 tower (architect d. 19th c.), "
                "public domain; generic name; no mark or image licensing found."),
             _i("honor-column", "Anıt sütun", "Porphyry column", 2, 2, 0, "4th-century column, public domain; generic name."),
             _i("fortress-gate", "Hisar kapısı", "Fortress gate", 6, 2, 0, "5th/15th-century fortification, public domain; "
                "stylised gate, not a site map; museum rules cover on-site photography only."),
         )),
    Pack("cappadocia-caravan", "Kapadokya Kervan Yolu", "Cappadocia Caravan Road",
         "İpek Yolu konaklarının ruhu: yüksek taç kapılı avlulu kervansaray, oyma pencereli tüf kaya kalesi ve kambur taş "
         "kemer köprü. Kapadokya haritasında balon kalkış vadisinde görünür.",
         "The spirit of the old caravan stops: a courtyard caravanserai with a tall carved portal, a tuff rock castle with "
         "cut windows and a humpback stone bridge. They appear in the balloon valley of the Cappadocia map.",
         "landmark", "kapadokya", ("builder", "city"), 1200, _usd("cappadocia-caravan"), LANDMARK_PLANS, (
             _i("caravanserai", "Kervansaray", "Caravanserai", 8, 6, 0, "13th-century Seljuk building type, public domain; "
                "generic type name, no venue name or logo."),
             _i("rock-castle", "Kaya kalesi", "Rock castle", 4, 4, 0, "Natural carved tuff outcrop; no IP; generic name."),
             _i("hump-bridge", "Taş kemer köprü", "Humpback stone bridge", 6, 2, 0, "Generic medieval bridge type."),
         )),
    Pack("london-victorian", "Londra Viktorya Dönemi", "London Victorian Era",
         "Demir ve camın çağı: kaburgalı cam palmiye serası, pişmiş toprak frizli kubbeli konser salonu ve üç açıklıklı mermer "
         "zafer kemeri. Londra haritasında park ve çarşı semtlerinde görünür.",
         "The age of iron and glass: a ribbed glass palm house, a domed concert hall with a terracotta frieze and a "
         "three-bay marble triumphal arch. They appear in the park and market districts of the London map.",
         "landmark", "londra", ("builder", "city"), 1200, _usd("london-victorian"), LANDMARK_PLANS, (
             _i("palm-house", "Cam palmiye serası", "Glass palm house", 8, 4, 0, "1848 glasshouse (architect d. 1881), public "
                "domain; UK s.62 freedom of panorama; no garden name or branding."),
             _i("domed-hall", "Kubbeli konser salonu", "Domed concert hall", 6, 6, 1, "1871 hall, public domain; the venue "
                "name is a registered UK mark, so only a generic name is used."),
             _i("triumphal-arch", "Mermer zafer kemeri", "Marble triumphal arch", 4, 2, 0, "1827 arch (architect d. 1835), "
                "public domain; generic name."),
         )),
    Pack("street-furniture", "Şehir Mobilyası", "Street Furniture",
         "Şehri yaşanır kılan on bir parça: bank, sokak lambası, içme çeşmesi, gazete büfesi, simit arabası, sokak yemeği "
         "arabası, tramvay ve otobüs durağı, saksı, bisiklet parkı ve pazar tezgâhı. Marka ve yazı yok. Bütün şehir "
         "haritalarının meydanlarında da görünür.",
         "Eleven pieces that make a city liveable: bench, street lamp, drinking fountain, news kiosk, simit cart, "
         "street-food cart, tram stop and bus shelter, planter, bike rack and market stall. No brands or lettering. They "
         "also appear on the squares of every city map.",
         "furniture", None, ("builder", "city"), 3200, _usd("street-furniture"), STORE_PLANS, (
             _i("bench", "Park bankı", "Park bench", 2, 1, 0, "Generic."),
             _i("street-lamp", "Sokak lambası", "Street lamp", 1, 1, 0, "Generic cast-iron type."),
             _i("drinking-fountain", "İçme çeşmesi", "Drinking fountain", 1, 1, 0, "Generic."),
             _i("news-kiosk", "Gazete büfesi", "News kiosk", 2, 2, 0, "Generic; colour swatches instead of titles."),
             _i("simit-cart", "Simit arabası", "Simit cart", 2, 1, 0, "Generic street-food cart; no vendor name.",
                culture=0),
             _i("food-cart", "Sokak yemeği arabası", "Street-food cart", 2, 1, 0, "Generic; no brand."),
             _i("tram-stop", "Tramvay durağı", "Tram stop", 3, 1, 0, "Generic; pictogram plate, no operator logo."),
             _i("bus-shelter", "Otobüs durağı", "Bus shelter", 3, 1, 0, "Generic; no advertising or map."),
             _i("planter", "Saksı", "Planter", 1, 1, 0, "Generic."),
             _i("bike-rack", "Bisiklet parkı", "Bike rack", 2, 1, 0, "Generic; no bike-share livery."),
             _i("market-stall", "Pazar tezgâhı", "Market stall", 2, 2, 0, "Generic."),
         )),
    Pack("night-lights", "Gece Işıkları", "Night Lights",
         "Akşam için sıcak ışıklar: sarkık ışık zinciri, çift fenerli direk, kenarı ışıklı çeşme ve yol işaret ışıkları. "
         "Statik ışık; yanıp sönme yok.",
         "Warm lights for the evening: draped fairy lights, a twin lantern post, a fountain with a lit rim and path "
         "lights. Static light; no flashing.",
         "decor", None, ("builder", "city"), 1200, _usd("night-lights"), STORE_PLANS, (
             _i("fairy-lights", "Işık zinciri", "Fairy lights", 4, 1, 0, "Generic.", solid=False),
             _i("lantern-post", "Çift fenerli direk", "Twin lantern post", 1, 1, 0, "Generic."),
             _i("lit-fountain", "Işıklı çeşme", "Lit fountain", 2, 2, 0, "Generic; no protected lighting design."),
             _i("path-lights", "Yol işaret ışıkları", "Path lights", 3, 1, 0, "Generic.", solid=False),
         )),
    Pack("park-garden", "Park ve Bahçe", "Park & Garden",
         "Yeşil köşeler: çiçek tarhı, beyaz çardak, nilüferli havuz, budama heykel, gül kemeri ve kuş banyosu.",
         "Green corners: a flower bed, a white gazebo, a lily pond, a topiary, a rose arch and a bird bath.",
         "decor", None, ("builder", "city"), 1600, _usd("park-garden"), STORE_PLANS, (
             _i("flower-bed", "Çiçek tarhı", "Flower bed", 2, 2, 0, "Generic."),
             _i("gazebo", "Çardak", "Gazebo", 3, 3, 0, "Generic."),
             _i("lily-pond", "Nilüferli havuz", "Lily pond", 3, 2, 0, "Generic."),
             _i("topiary", "Budama heykel", "Topiary", 1, 1, 0, "Generic."),
             _i("garden-arch", "Gül kemeri", "Rose arch", 2, 1, 0, "Generic.", solid=False),
             _i("bird-bath", "Kuş banyosu", "Bird bath", 1, 1, 0, "Generic."),
         )),
    Pack("festival", "Bayram ve Festival Süsleri", "Festival Decorations",
         "Yılın kutlamaları için: yeni yıl çamı, kâğıt fener dizisi, hasat balkabakları, ikram tezgâhı ve ışıklı kemer kapı. "
         "Sezonluk tema, yıl boyu açık; geri sayım yok. Dinî simge yok.",
         "For the year's celebrations: a New Year tree, a paper lantern string, harvest pumpkins, a treat stall and a "
         "light arch. Seasonal theme, available all year; no countdown. No religious symbols.",
         "decor", None, ("builder",), 1600, _usd("festival"), STORE_PLANS, (
             _i("new-year-tree", "Yeni yıl çamı", "New Year tree", 2, 2, 0, "Generic decorated fir; star topper is a "
                "plain shape, no religious symbol; secular New Year custom in Turkey.", culture=1),
             _i("lantern-string", "Kâğıt fener dizisi", "Paper lantern string", 4, 1, 0, "Generic.", solid=False),
             _i("harvest-pumpkins", "Hasat balkabakları", "Harvest pumpkins", 2, 1, 0, "Generic carved pumpkins; no "
                "character or brand."),
             _i("treat-stall", "İkram tezgâhı", "Treat stall", 2, 2, 0, "Generic sweets stall for any holiday; no text."),
             _i("light-arch", "Işıklı kemer kapı", "Light arch", 3, 1, 0, "Generic.", solid=False),
         ), seasonal=True),
    Pack("live-materials", "Canlı Malzemeler", "Live Materials",
         "Hareket eden dokular: dalgalanan havuz, parlayan lav ve titreşen alev, kar yağan köşe, suda sallanan fenerler, "
         "rüzgârda dalgalanan flamalar, neon çerçeve ve cam köşk. Hareket azaltma açıkken hepsi durağan çizilir. Yalnız "
         "dünya yapıcıda.",
         "Textures that move: a rippling pool, glowing lava with flickering flames, a snowfall corner, lanterns bobbing on "
         "water, bunting fluttering in the wind, a neon frame and a glass pavilion. With reduced motion everything is "
         "drawn still. World builder only.",
         "material", None, ("builder",), 2400, _usd("live-materials"), STORE_PLANS, (
             _i("ripple-pool", "Dalgalı havuz", "Ripple pool", 3, 3, 0, "Generic."),
             _i("lava-basin", "Lav havzası", "Lava basin", 2, 2, 0, "Generic."),
             _i("snow-corner", "Kar yağan köşe", "Snowfall corner", 3, 3, 0, "Generic."),
             _i("floating-lanterns", "Yüzen fenerler", "Floating lanterns", 3, 3, 0, "Generic; no ritual use."),
             _i("festival-bunting", "Dalgalanan flamalar", "Fluttering bunting", 4, 1, 0, "Abstract colours; no flags.",
                solid=False),
             _i("neon-frame", "Neon çerçeve", "Neon frame", 2, 1, 0, "Abstract pattern; no lettering or logo."),
             _i("glass-pavilion", "Cam köşk", "Glass pavilion", 3, 3, 0, "Generic."),
         )),
)

if EDITION == "full":  # kaldırılan şehirlerin yapı paketleri (studio/full)
    from studio.full.citypacks import splice_city_packs
    PACKS = splice_city_packs(PACKS, Pack, _i, LANDMARK_PLANS)

PACK_BY_ID: Mapping[str, Pack] = MappingProxyType({p.id: p for p in PACKS})
PIECE_PACK: Mapping[str, str] = MappingProxyType({pid: p.id for p in PACKS for pid in p.pieces})


def pick(tr: str, en: str) -> str:
    from studio.i18n import request_lang  # noqa: PLC0415

    return en if request_lang() == "en" and en else tr


def get(pack_id: Any) -> Pack | None:
    if not isinstance(pack_id, str):
        return None
    pid = pack_id[len(STORE_PREFIX):] if pack_id.startswith(STORE_PREFIX) else pack_id
    return PACK_BY_ID.get(pid)


def risk_state(p: Pack) -> str:
    worst = max(p.ip_risk, p.culture_risk)
    return "ok" if worst <= RISK_PUBLISH_MAX else ("review" if worst == 2 else "rejected")


def _fold(s: str) -> str:
    table = str.maketrans("çğıöşüâîûéèêàáãõôí", "cgiosuaiueeeaaaooi")
    return s.lower().translate(table)


def validate() -> list[str]:
    """Katalog tutarlılığı (testler; açılışta yalnız okuma)."""
    errs: list[str] = []
    seen: set[str] = set()
    for p in PACKS:
        if not PACK_ID_RE.match(p.id) or p.id in seen:
            errs.append(f"{p.id}: geçersiz ya da yinelenen kimlik")
        seen.add(p.id)
        if p.kind not in KINDS or not p.surfaces or any(s not in SURFACES for s in p.surfaces):
            errs.append(f"{p.id}: tür/yüzey")
        if p.price is not None:
            errs.append(f"{p.id}: para fiyatı bağlanmaz")
        if isinstance(p.coin_price, bool) or not isinstance(p.coin_price, int) or not 0 < p.coin_price <= 5000:
            errs.append(f"{p.id}: jeton fiyatı 1–5000")
        if (p.price_proposal_usd is None) != (EDITION != "full") or not 0 < (p.price_proposal_usd or 1) < 50:
            errs.append(f"{p.id}: fiyat önerisi aralık dışı")
        if not p.items:
            errs.append(f"{p.id}: öğesiz paket")
        text = " ".join([p.id, p.name_tr, p.name_en, p.description_tr, p.description_en,
                         *(f"{i.id} {i.name_tr} {i.name_en}" for i in p.items)])
        folded = _fold(text)
        for bad in BRAND_BLOCKLIST:
            if re.search(rf"(?<![a-z]){re.escape(bad)}(?![a-z])", folded):
                errs.append(f"{p.id}: yasaklı ad '{bad}'")
        ids = [i.id for i in p.items]
        if len(set(ids)) != len(ids):
            errs.append(f"{p.id}: yinelenen öğe")
        for i in p.items:
            if not PACK_ID_RE.match(i.id) or not (1 <= i.w <= 16 and 1 <= i.d <= 16):
                errs.append(f"{p.id}/{i.id}: kimlik/ayak izi")
            if not (0 <= i.ip_risk <= 3 and 0 <= i.culture_risk <= 3) or not i.ip_note.strip():
                errs.append(f"{p.id}/{i.id}: risk ya da gerekçe eksik")
            if i.esinli and not i.legal_review_before_sale:
                errs.append(f"{p.id}/{i.id}: esinli öğe avukat incelemesi ister")
    from studio.cosmetics.policy import citypack_errors  # noqa: PLC0415 - kostüm içerik kuralı (saf veri)
    return errs + citypack_errors(PACKS)
