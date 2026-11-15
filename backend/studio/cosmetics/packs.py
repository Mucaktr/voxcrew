"""HERO-PACKS — karakter ve kostüm paketleri.

Saf veri: `catalog.py` bu tanımlardan `CosmeticSet` kurar (bu modül hiçbir şey içe aktarmaz). Her paket mevcut kozmetik
set kurallarına uyar: tek öğe satılmaz, para fiyatı bağlanmaz, jeton fiyatı [H] ve para fiyatından türetilmez, imza parçası
süresiz bir başarımla kazanılır, set her yüzeyde çizilmeden satılamaz, yalnız görünüştür.

Fikri mülkiyet ( ve §8.2):
- Her parçanın kendi `ip_risk` ve `culture_risk` (0–3) değeri ve gerekçesi vardır; set değeri parçaların en yükseğidir.
  ≤ 1 yayınlanır, 2 insan/avukat incelemesi, 3 red (`catalog.RISK_PUBLISH_MAX`).
- Ad, açıklama ve parça adları `studio.heroes.presets.IP_DENYLIST` ile taranır (`catalog.validate`).
- Kaynak türü: `original` (özgün arketip), `pd-myth` / `pd-folklore` / `pd-literature` (kamu malı, KAYNAKTAKİ tarif),
  `generic` (genel kostüm/yaratık).

Büyük set (8–10 parça) jeton fiyatı 2.400 [H]: mevcut "birkaç haftada kazanılır" tavanının (≈ 6 haftalık görev
jetonu) içinde kalır; parça başına küçük setten ucuzdur (paket indirimi), para fiyatından türetilmez.

`proposal` YALNIZ ÖNERİDİR (`binding: False`): fiyat kovası D13 hipotez kovalarından birinin adıdır (tutar burada yazmaz;
), paket dahil olma önerisi plans.py `included_hero_packs` modeline göre yazıldı ve
hiçbir hak, teklif ya da plan kapsamına bağlanmadı. Para ile satış ödeme kapısı (go-live) arkasındadır ve kapalıdır.
"""

from __future__ import annotations

from typing import Any

SOURCES = ("original", "pd-myth", "pd-folklore", "pd-literature", "generic")
OUTFIT = ("avatar", "me", "collection")
DESK = ("desk", "collection")
CELEB = ("celebration", "collection")


def _i(part: str, kind: str, surfaces: tuple[str, ...], tr: str, en: str, ip: int, culture: int, note: str) -> dict[str, Any]:
    return {"part": part, "kind": kind, "surfaces": surfaces, "label": (tr, en), "ip_risk": ip, "culture_risk": culture,
            "ip_note": note}


def _proposal(bucket: str = "small", plus: str = "pick1", pro: str = "included") -> dict[str, Any]:
    """Öneri: fiyat kovası (D13 adı: small = küçük set, large = büyük set); kahraman paketi gibi Plus "yılda 1 paket
    seç", Pro "dahil" (2026-10-25 lider kararı). Yine yalnız öneri, bağlayıcı değil."""
    return {"price_bucket": bucket, "plus": plus, "pro": pro, "binding": False}


PACKS: tuple[dict[str, Any], ...] = (
    {
        "id": "legend-squad", "source": "original",
        "name": ("Efsane Ekibi", "Legend Squad"),
        "lore": ("Özgün bir kahraman takımı: kuyruklu yıldız amblemli Gök Muhafızı, şapkalı Gölge Dedektifi, petek zırhlı Çark "
                 "Mucidi, menekşe Rüzgâr Koşucusu, renk bantlı Biçim Değiştiren ve yıldız pelerinli Kozmik Muhafız; masada "
                 "karargâh maketi ve yardımcı dron, kutlamada kuyruklu yıldız geçişi. Yalnız görünüş.",
                 "An original hero team: the comet-emblem Sky Warden, the hatted Shadow Sleuth, the honeycomb-armoured "
                 "Gearwright, the violet Gale Runner, the colour-banded Shapeshifter and the star-caped Cosmic Guardian; an "
                 "HQ model and a helper drone on the desk and a comet-pass celebration. Looks only."),
        "bucket": "large", "coin_price": 2400, "signature": "sky-warden", "signature_achievement": "tam_kadro",
        "archive_quest": ("tam_kadro", "devretme_ustasi", "hedef_avcisi"), "proposal": _proposal("large"),
        "items": (
            _i("sky-warden", "outfit", OUTFIT, "Gök Muhafızı kostümü", "Sky Warden costume", 1, 0,
               "Generic caped-flyer archetype. Teal/copper/cream, comet glyph, cream cape: avoids red cape + blue suit + "
               "letter shield. Risk 1 because any caped flyer invites comparison."),
            _i("shadow-sleuth", "outfit", OUTFIT, "Gölge Dedektifi kostümü", "Shadow Sleuth costume", 1, 0,
               "Pulp detective archetype. Plum coat, slate hat, mustard scarf, domino band; no pointed ears, no bat, no "
               "black cowl, no blue suit + red tie, no red scarf. Risk 1 (pulp heroes share hat + mask)."),
            _i("gearwright", "outfit", OUTFIT, "Çark Mucidi zırhı", "Gearwright armour", 1, 0,
               "Armoured inventor archetype. Mint/graphite, honeycomb chest grid, back tool pack; no red/gold, no chest "
               "disc or ring, no faceplate. Risk 1 (armoured-inventor heroes are crowded)."),
            _i("gale-runner", "outfit", OUTFIT, "Rüzgâr Koşucusu kostümü", "Gale Runner costume", 1, 0,
               "Speedster archetype. Violet/white/lime parallel wind stripes, rear fin; no lightning bolt, no red/yellow, "
               "no head wings."),
            _i("shapeshifter", "outfit", OUTFIT, "Biçim Değiştiren kostümü", "Shapeshifter costume", 1, 0,
               "Shapeshifter archetype. Coral to sand horizontal bands, slate eye band; no blue skin, no green skin, no "
               "red/yellow stretch suit, no harlequin diamond pattern."),
            _i("cosmic-guardian", "outfit", OUTFIT, "Kozmik Muhafız kostümü", "Cosmic Guardian costume", 1, 0,
               "Cosmic guardian archetype. Night-purple suit, aurora-teal light lines, five-dot orbit glyph, star-dotted "
               "cape; no silver body + board, no red/blue + gold star, no ring emblem, no forehead gem."),
            _i("hq-model", "desk", DESK, "Ekip karargâhı maketi", "Squad HQ model", 0, 0,
               "Generic stepped tower with lit windows and a landing pad; no logo, letter or known headquarters shape."),
            _i("helper-drone", "desk", DESK, "Yardımcı dron", "Helper drone", 0, 0,
               "Generic four-rotor drone with one lit eye; no product or film robot design."),
            _i("comet-pass", "celebration", CELEB, "Kuyruklu yıldız geçişi", "Comet-pass celebration", 0, 0,
               "Abstract comet arc in the pack colours; static form for reduced motion."),
        ),
    },
    {
        "id": "element-wardens", "source": "original",
        "name": ("Element Bekçileri", "Element Wardens"),
        "lore": ("Altı bekçi: kor, gelgit, kaya, esinti, kırağı ve koru. Her tulumun omuz tepesi ve göğüs glifi elementini "
                 "soyut biçimle anlatır; masada element küreleri ve kor semenderi, kutlamada element sarmalı.",
                 "Six wardens: ember, tide, stone, breeze, frost and grove. Each suit's shoulder crest and chest glyph tell "
                 "its element in an abstract way; element orbs and an ember salamander on the desk and an element-spiral "
                 "celebration."),
        "bucket": "large", "coin_price": 2400, "signature": "ember", "signature_achievement": "cok_yonlu",
        "archive_quest": ("cok_yonlu", "temiz_is", "yerli_uretim"), "proposal": _proposal("large"),
        "items": (
            _i("ember", "outfit", OUTFIT, "Kor Bekçisi tulumu", "Ember Warden suit", 1, 0,
               "Four classical elements are ancient public domain. Human in armoured suit, no flame body, no nation "
               "emblems or East Asian dress from a known animated series. Risk 1 (element casts are common)."),
            _i("tide", "outfit", OUTFIT, "Gelgit Bekçisi tulumu", "Tide Warden suit", 1, 0,
               "As ember; deep teal/seafoam, abstract wave crest; no water-body character."),
            _i("stone", "outfit", OUTFIT, "Kaya Bekçisi tulumu", "Stone Warden suit", 0, 0,
               "Moss/slate suit with slab pauldrons; no rock-skin giant."),
            _i("breeze", "outfit", OUTFIT, "Esinti Bekçisi tulumu", "Breeze Warden suit", 1, 0,
               "Pale sky/silver suit with fins; no arrow tattoos or monk robes."),
            _i("frost", "outfit", OUTFIT, "Kırağı Bekçisi tulumu", "Frost Warden suit", 1, 0,
               "Ice-blue/white armoured suit with a crystal crest; no ice-body hero, no snow-queen gown, no blue-skin "
               "freezer villain."),
            _i("grove", "outfit", OUTFIT, "Koru Bekçisi tulumu", "Grove Warden suit", 1, 0,
               "Moss/bark suit with a leaf crest; no tree-body giant, no green-skin plant villain."),
            _i("element-orbs", "desk", DESK, "Element küreleri", "Element orbs", 0, 0,
               "Six glowing orbs on a stone stand; not the gem set of a known franchise, no symbols."),
            _i("ember-salamander", "desk", DESK, "Kor semenderi", "Ember salamander", 0, 0,
               "Fire salamander of early-modern natural philosophy (public domain); original small lizard figure."),
            _i("element-spiral", "celebration", CELEB, "Element sarmalı kutlaması", "Element-spiral celebration", 0, 0,
               "Abstract rising orbs; static ring for reduced motion."),
        ),
    },
    {
        "id": "anatolian-legends", "source": "pd-folklore",
        "name": ("Anadolu Efsaneleri", "Anatolian Legends"),
        "lore": ("Halk anlatılarından yaratıklar: masada Zümrüdüanka ve tek gözlü dev Tepegöz figürü, tüy yağmuru kutlaması ve "
                 "Kaf Dağı'na giden özgün bir gezginin pelerini.",
                 "Creatures from folk tales: a Zümrüdüanka (simurgh) and a one-eyed giant Tepegöz figure on the desk, a "
                 "feather-rain celebration and an original wanderer's cloak for the road to Mount Qaf."),
        "coin_price": 1600, "signature": "simurgh", "signature_achievement": "kasif",
        "archive_quest": ("kasif", "ilk_hatira", "manzara_avcisi"), "proposal": _proposal(),
        "items": (
            _i("kaf-wanderer", "outfit", OUTFIT, "Kaf Dağı gezgini pelerini", "Mount Qaf wanderer cloak", 0, 1,
               "Original fantasy travel cloak with a feather motif, NOT regional or traditional dress (rule §11.3/2: "
               "cultural dress is not sold). Culture 1: the name evokes a shared regional myth."),
            _i("simurgh", "desk", DESK, "Zümrüdüanka figürü", "Simurgh figure", 0, 1,
               "Mythic bird of Persian and Turkic tales (public domain). Original voxel design; no religious use, no "
               "writing. Culture 1: shared heritage symbol, depicted respectfully as a figurine."),
            _i("tepegoz", "desk", DESK, "Tepegöz figürü", "Tepegöz figure", 0, 1,
               "One-eyed giant from the Book of Dede Korkut (public domain). Calm seated figure, no weapon, no gore."),
            _i("feather-rain", "celebration", CELEB, "Tüy yağmuru kutlaması", "Feather-rain celebration", 0, 0,
               "Abstract falling feathers; static ring for reduced motion."),
        ),
    },
    {
        "id": "olympus-myths", "source": "pd-myth",
        "name": ("Olimpos Masalları", "Olympian Myths"),
        "lore": ("Antik mitlerden: tunç zırhlı muhafız, defne taçlı ozan, masada kanatlı tay ve Girit'i koruyan tunç dev "
                 "anlatısından bir otomat.",
                 "From the ancient myths: a bronze-armoured guard, a laurel-crowned bard, and on the desk a winged foal and "
                 "an automaton from the tale of Crete's bronze giant."),
        "coin_price": 1600, "signature": "winged-foal", "signature_achievement": "karar_verici",
        "archive_quest": ("karar_verici", "yapici_elestirmen", "muhur_sende"), "proposal": _proposal(),
        "items": (
            _i("bronze-guard", "outfit", OUTFIT, "Tunç muhafız zırhı", "Bronze guard armour", 1, 1,
               "Historical bronze-age armour (public domain). Olive crest and cape: avoids red cape + lambda shield (a "
               "film look) and pale skin + red tattoo (a game look). Culture 1: historical dress of a real culture."),
            _i("laurel-bard", "outfit", OUTFIT, "Defne ozanı giysisi", "Laurel bard robe", 0, 1,
               "Draped robe, laurel wreath, small lyre; no god, no temple. Culture 1: historical dress."),
            _i("winged-foal", "desk", DESK, "Kanatlı tay figürü", "Winged foal figure", 1, 0,
               "Winged horse is ancient myth; our own name and a foal design, not a studio's pastel or toy version."),
            _i("bronze-giant", "desk", DESK, "Tunç dev otomatı", "Bronze giant automaton", 1, 0,
               "Bronze guardian of Crete from ancient sources. Original blocky automaton, not the 1963 stop-motion "
               "design; no name from the myth used."),
        ),
    },
    {
        "id": "northlands", "source": "pd-myth",
        "name": ("Kuzey Diyarı", "Northlands"),
        "lore": ("Sagalardan esinli: dilimli kalkanlı kalkan bekçisi, kürk pelerinli ozan, masada buz kurdu yavrusu ve tünekte "
                 "iki kuzgun.",
                 "Inspired by the sagas: a shield-bearer with a quartered shield, a fur-cloaked skald, and on the desk a "
                 "frost-wolf pup and two ravens on a perch."),
        "coin_price": 1600, "signature": "frost-wolf", "signature_achievement": "sabir_tasi",
        "archive_quest": ("sabir_tasi", "yerli_uretim", "uzun_zincir"), "proposal": _proposal(),
        "items": (
            _i("shieldbearer", "outfit", OUTFIT, "Kalkan bekçisi giysisi", "Shield-bearer outfit", 1, 1,
               "Saga-era tunic, round iron cap, quartered shield. No winged helmet + red cape + hammer (comic god look), "
               "no horns, no runes (real writing), no religious symbols. Culture 1: historical dress."),
            _i("skald", "outfit", OUTFIT, "Kuzey ozanı giysisi", "Northern skald outfit", 0, 1,
               "Fur-cloaked poet; generic. Culture 1: historical dress."),
            _i("frost-wolf", "desk", DESK, "Buz kurdu yavrusu", "Frost-wolf pup", 0, 0,
               "Generic white wolf pup; no direwolf sigil or series styling."),
            _i("raven-pair", "desk", DESK, "Kuzgun çifti", "Raven pair", 0, 0,
               "Two ravens on a perch; generic birds, no deity, no emblem."),
        ),
    },
    {
        "id": "yokai-night", "source": "pd-folklore",
        "name": ("Yōkai Gecesi", "Yōkai Night"),
        "lore": ("Eski resimli yaratık kataloglarından: kabuklu kappa tulumu, masada tek gözlü kâğıt fener ruhu ve tek ayaklı "
                 "şemsiye ruhu.",
                 "From old illustrated creature catalogues: a shelled kappa suit, and on the desk a one-eyed paper-lantern "
                 "spirit and a one-legged umbrella spirit."),
        "coin_price": 1200, "signature": "lantern-spirit", "signature_achievement": "ic_mekan_gezgini",
        "archive_quest": ("ic_mekan_gezgini", "hatira_avcisi", "ilk_hatira"), "proposal": _proposal(),
        "items": (
            _i("kappa", "outfit", OUTFIT, "Kappa tulumu", "Kappa suit", 1, 1,
               "Edo-period folklore creature (public domain). Creature onesie, not a kimono; no shrine, no fox mask. IP 1: "
               "many franchises reuse yōkai, so we avoid every known design. Culture 1: another culture's folklore."),
            _i("lantern-spirit", "desk", DESK, "Fener ruhu", "Lantern spirit", 1, 1,
               "Chōchin-obake folk motif. Plain paper lantern with NO characters written on it; original colours."),
            _i("umbrella-spirit", "desk", DESK, "Şemsiye ruhu", "Umbrella spirit", 1, 1,
               "Kasa-obake folk motif. Violet canopy, original face; not a franchise mascot design."),
        ),
    },
    {
        "id": "gothic-classics", "source": "pd-literature",
        "name": ("Gotik Klasikler", "Gothic Classics"),
        "lore": ("19. yüzyıl romanlarındaki tariflerle: siyahlar içinde beyaz bıyıklı Karpat Kontu, uzun saçlı Yapılmış Dev, "
                 "pelerinli Sisli Sokak Dedektifi ve sargılı Yabancı; halk anlatısının Ay Kurdu ve Kuzgunlu Şair; masada "
                 "şamdan ve kule saati, kutlamada dolunay ve sis.",
                 "Drawn from the descriptions in 19th-century novels: the Carpathian Count in black with a white "
                 "moustache, the long-haired Made Giant, the caped Foggy Street Detective and the Bandaged Stranger; the "
                 "folk-tale Moon Wolf and the Raven Poet; a candelabra and a tower clock on the desk and a full-moon fog "
                 "celebration."),
        "bucket": "large", "coin_price": 2400, "signature": "fog-detective", "signature_achievement": "not_defteri",
        "archive_quest": ("not_defteri", "bellek_bahcivani", "yanlisi_duzelt"), "proposal": _proposal("large"),
        "items": (
            _i("carpathian-count", "outfit", OUTFIT, "Karpat Kontu kostümü", "Carpathian Count costume", 1, 0,
               "Stoker 1897 (public domain): old man, long white moustache, black from head to foot. No opera cape with "
               "high collar, no widow's peak (1931 film look); character's name not used."),
            _i("made-giant", "outfit", OUTFIT, "Yapılmış Dev kostümü", "Made Giant costume", 1, 0,
               "Shelley 1818 (public domain): long flowing black hair, patched old clothes. No flat head, neck bolts or "
               "green skin (studio make-up and trade dress)."),
            _i("fog-detective", "outfit", OUTFIT, "Sisli Sokak Dedektifi kostümü", "Foggy Street Detective costume", 1, 0,
               "1890s magazine illustrations (public domain): cape coat and ear-flap cap. Name, TV/film titles and their "
               "styling not used; name stays on the blocklist."),
            _i("bandaged-stranger", "outfit", OUTFIT, "Sargılı Yabancı kostümü", "Bandaged Stranger costume", 1, 0,
               "Wells 1897 (public domain): bandaged head, big blue spectacles, gloves, long coat, wide hat. Novel and "
               "studio titles not used."),
            _i("moon-wolf", "outfit", OUTFIT, "Ay Kurdu kostümü", "Moon Wolf costume", 1, 0,
               "Generic folk-tale werewolf as a hooded fur costume (face open). No 1941 film make-up or its title; no gore."),
            _i("raven-poet", "outfit", OUTFIT, "Kuzgunlu Şair kostümü", "Raven Poet costume", 1, 0,
               "Generic Victorian poet with a raven on the shoulder, after a public-domain 1845 poem; no likeness or name "
               "of a real person."),
            _i("candelabra", "desk", DESK, "Gotik şamdan", "Gothic candelabra", 0, 0,
               "Generic three-arm iron candelabra; no religious symbol."),
            _i("tower-clock", "desk", DESK, "Gotik kule saati", "Gothic tower clock", 0, 0,
               "Generic pointed clock with a numeral-free dial (no real writing); not a real landmark."),
            _i("moon-fog", "celebration", CELEB, "Dolunay ve sis kutlaması", "Full-moon fog celebration", 0, 0,
               "Rising full moon and drifting fog boxes; static form for reduced motion."),
        ),
    },
    {
        "id": "star-wayfarers", "source": "generic",
        "name": ("Yıldız Gezginleri", "Star Wayfarers"),
        "lore": ("Jet çantalı halka pilotu, yıldız noktalı haritacı ceketi, masada altı tekerlekli mini keşif aracı ve dört "
                 "gözlü bir uzaylı dost.",
                 "A ring pilot with a jet pack, a star-dotted cartographer coat, and on the desk a six-wheeled mini rover "
                 "and a four-eyed alien friend."),
        "coin_price": 1600, "signature": "rover", "signature_achievement": "gezgin",
        "archive_quest": ("gezgin", "acik_deniz", "kasif"), "proposal": _proposal(),
        "items": (
            _i("ring-pilot", "outfit", OUTFIT, "Halka pilotu tulumu", "Ring pilot suit", 1, 0,
               "Generic space pilot. Charcoal/mint, bubble helmet, jet pack; no agency patches or flags, not the orange "
               "suit + white vest of a film rebel pilot; differs from the chest astronaut skin."),
            _i("star-cartographer", "outfit", OUTFIT, "Yıldız haritacısı ceketi", "Star cartographer coat", 0, 0,
               "Original indigo coat with glowing star dots and lilac lines; no real constellation map, no navy + yellow."),
            _i("rover", "desk", DESK, "Mini keşif aracı", "Mini rover", 0, 0,
               "Generic six-wheeled rover; no agency livery, not a specific real rover."),
            _i("four-eyed-friend", "desk", DESK, "Dört gözlü dost", "Four-eyed friend", 1, 0,
               "Original coral jelly alien with four eyes in a row; avoids three-eyed green toy aliens and one-eyed "
               "green monsters."),
        ),
    },
    {
        "id": "creature-workshop", "source": "generic",
        "name": ("Yaratık Atölyesi", "Creature Workshop"),
        "lore": ("Dikenli dinozor tulumu, masada ejder yavrusu ve kristal dikenli mercan devi, yumurta çatlaması kutlaması.",
                 "A spiky dinosaur suit, a dragon hatchling and a crystal-spined coral giant on the desk, and an "
                 "egg-hatch celebration."),
        "coin_price": 1600, "signature": "dragon-hatchling", "signature_achievement": "ise_alim",
        "archive_quest": ("ise_alim", "ilk_terfi", "org_semasi"), "proposal": _proposal(),
        "items": (
            _i("dino-suit", "outfit", OUTFIT, "Dinozor tulumu", "Dinosaur suit", 0, 0,
               "Generic dinosaur onesie; no film logo or franchise dinosaur."),
            _i("dragon-hatchling", "desk", DESK, "Ejder yavrusu", "Dragon hatchling", 1, 0,
               "Generic dragon. Sage/gold; avoids the black dragon with big green eyes (animated film) and the purple "
               "game-mascot dragon."),
            _i("coral-giant", "desk", DESK, "Mercan devi", "Coral giant", 1, 0,
               "Original giant monster: round shell, crystal spines, four eye stalks. No charcoal dorsal plates or blue "
               "breath (trademarked film monster), no giant ape."),
            _i("egg-hatch", "celebration", CELEB, "Yumurta çatlaması kutlaması", "Egg-hatch celebration", 0, 0,
               "Generic hatching egg; deterministic, static form for reduced motion."),
        ),
    },
    {
        "id": "spooky-night", "source": "generic",
        # mevsimlik NOT (yalnız vitrin notu): geri sayım, "son gün", sıralama ya da bildirim yok; set süresizdir
        "seasonal": "halloween",
        "name": ("Cadılar Gecesi", "Spooky Night"),
        "lore": ("Mevsimlik ama süresiz: mürdüm gece cadısı, deniz yeşili fırtına korsanı, masada oyulmuş kabak feneri ve "
                 "hayalet dansı kutlaması.",
                 "Seasonal but permanent: a plum night witch, a sea-green storm pirate, a carved pumpkin lantern on the "
                 "desk and a ghost-dance celebration."),
        "coin_price": 1600, "signature": "pumpkin-lantern", "signature_achievement": "akademi",
        "archive_quest": ("akademi", "geri_donus", "tek_atista"), "proposal": _proposal(),
        "items": (
            _i("night-witch", "outfit", OUTFIT, "Gece cadısı kostümü", "Night witch costume", 0, 0,
               "Generic witch (top adult costume). Plum/amber, no green skin + black dress (stage musical look)."),
            _i("storm-pirate", "outfit", OUTFIT, "Fırtına korsanı kostümü", "Storm pirate costume", 0, 0,
               "Generic pirate. Sea-green coat, brass buttons, ochre sash; no red bandana + braids + beads (film "
               "pirate), no red coat + hook, no skull flag."),
            _i("pumpkin-lantern", "desk", DESK, "Kabak feneri", "Pumpkin lantern", 0, 0, "Generic carved pumpkin."),
            _i("ghost-dance", "celebration", CELEB, "Hayalet dansı kutlaması", "Ghost-dance celebration", 0, 0,
               "Generic sheet ghosts; static form for reduced motion."),
        ),
    },
)

PACK_BY_ID: dict[str, dict[str, Any]] = {p["id"]: p for p in PACKS}


def pack_risk(pack: dict[str, Any]) -> tuple[int, int]:
    """Set riski = parçaların en yükseği (ip, kültür)."""
    items = pack["items"]
    return max(i["ip_risk"] for i in items), max(i["culture_risk"] for i in items)


def item_notes() -> dict[str, dict[str, Any]]:
    """`store:<set>-<parça>` → {ip_risk, culture_risk, ip_note} (testler ve belge için)."""
    return {f"store:{p['id']}-{i['part']}": {"ip_risk": i["ip_risk"], "culture_risk": i["culture_risk"],
                                              "ip_note": i["ip_note"]}
            for p in PACKS for i in p["items"]}
