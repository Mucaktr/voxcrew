"""Kozmetik set kataloğu (`store:*`).

Kurallar:
- Tek öğe satılmaz; **set** satılır. Set kimliği `store:<set>`, parça kimliği `store:<set>-<parça>`.
- Kimlikler jeton mağazası (`game.catalog.SHOP`), üyelik sandığı (`chest:*`) ve sezon (`season:*`) ile kesişmez; aynı
  öğe adı da iki katalogda bulunmaz (tests/test_cosmetics_catalog.py).
- Para fiyatı yok (`price` her zaman `None`); fiyat kovası yalnız bir etikettir ([H], kullanıcı kararı D13).
- 2026-10-19 gece kararı ("Minecraft gibi her şey satılabilir"): aynı set jetonla da alınabilir (`coin_price` [H]).
  Jeton fiyatı oyun ekonomisinden seçilir, para fiyatından TÜRETİLMEZ (sabit kur yok); jeton satılmaz. Gerekçe
  (`game/rules.py`, `game/catalog.py`): normal kullanımda XP'den günde ≈ 30–80 jeton (150 yumuşak tavan), günlük
  görevler 3 × 15, haftalık 2 × 60 → haftada ≈ 400–700 jeton. Jeton mağazasında tek kıyafet/kutlama 150 (yaygın) –
  400 (nadir). 3 parçalık küçük set 1200, 4 parçalık set 1600 → "birkaç haftada kazanılır" (≈ 2–4 hafta).
- Her parça `surfaces` taşır; set ancak her yüzeyde çizildiğinde satılabilir (`cosmetics.coverage`).
- Her setin bir **imza parçası** süresiz bir başarımla kazanılır; satıştan `free_after_months` ay sonra tüm set süresiz
  bir arşiv görevi zinciriyle (başarımlar) kazanılır. Jetonla alınamaz.
- `ip_risk` / `culture_risk` 0–3: ≤ 1 yayınlanır, 2 insan/avukat incelemesi, 3 reddedilir. Kültürel ya da yöresel kıyafet,
  bayrak, logo, marka, gerçek yazı, dinî simge yok.
- Set hiçbir zaman XP, jeton, SP, kademe, koltuk, hız ya da izin vermez: bu modülde böyle bir alan yoktur.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Mapping

SURFACES = ("avatar", "desk", "world", "celebration", "build", "me", "hero", "collection")
PIECE_KINDS = ("outfit", "hat", "glasses", "desk", "celebration", "world_theme", "material", "me", "hero")
BUCKETS = ("small", "large", "collection")
SET_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,40}$")
STORE_PREFIX = "store:"
RISK_PUBLISH_MAX = 1          # ≤ 1 yayınlanır; 2 inceleme; 3 red


@dataclass(frozen=True)
class Piece:
    id: str                         # store:<set>-<parça>
    kind: str
    label_tr: str
    label_en: str
    surfaces: tuple[str, ...]


@dataclass(frozen=True)
class CosmeticSet:
    id: str                         # kısa kimlik (`polar-team`); hak `cosmetic:<id>`, öğe öneki `store:<id>-`
    name_tr: str
    name_en: str
    description_tr: str
    description_en: str
    bucket: str                     # small | large | collection ([H] etiket; fiyat değil)
    pieces: tuple[Piece, ...] = ()
    sets: tuple[str, ...] = ()      # yalnız koleksiyon: içerdiği set kimlikleri (parçası yoktur)
    ip_risk: int = 0
    culture_risk: int = 0
    signature_piece: str | None = None
    signature_achievement: str | None = None
    archive_quest: tuple[str, ...] = ()   # süresiz başarım zinciri (tam set, satıştan N ay sonra)
    free_after_months: int = 12           # [H]
    released_at: str | None = None        # satışa açıldığı gün (ISO); satış yokken None → arşiv yolu kapalı
    price: None = None                    # para fiyatı bağlanmaz (§11.7)
    coin_price: int = 0                   # [H] jeton fiyatı (aynı eşya; para fiyatından türetilmez, sabit kur yok)
    extra: Mapping[str, Any] = field(default_factory=lambda: MappingProxyType({}))

    @property
    def store_id(self) -> str:
        return f"{STORE_PREFIX}{self.id}"

    @property
    def right(self) -> str:
        return f"cosmetic:{self.id}"

    @property
    def is_collection(self) -> bool:
        return self.bucket == "collection"

    def surfaces(self) -> tuple[str, ...]:
        seen: list[str] = []
        for p in self.pieces:
            seen.extend(s for s in p.surfaces if s not in seen)
        return tuple(seen)


def _p(set_id: str, part: str, kind: str, tr: str, en: str, *surfaces: str) -> Piece:
    return Piece(f"{STORE_PREFIX}{set_id}-{part}", kind, tr, en, tuple(surfaces))


# İlk dalga (COS-B ile ortak): yalnız var olan parça türleri — kıyafet, masa süsü, kutlama, dünya teması varyantı (§11.3/5).
# Parça kimlikleri arayüz kayıt defterindeki (`frontend/src/voxel/cosmetics/registry.ts`) kimliklerle aynıdır.
POLAR = CosmeticSet(
    "polar-team", "Kutup Araştırma Ekibi", "Polar Research Team",
    "Kurgusal bir buz istasyonu ekibi: saha montu, bere ve kar gözlüğü; masada buz karotu rafı, kar patlaması kutlaması "
    "ve kutup gecesi ofis teması.",
    "A fictional ice-station crew: field parka, beanie and snow goggles; an ice-core rack on the desk, a snow-burst "
    "celebration and a polar-night office theme.",
    "small",
    pieces=(
        _p("polar-team", "parka", "outfit", "Kutup saha montu (bere ve gözlükle)", "Polar field parka (with beanie "
           "and goggles)", "avatar", "me", "collection"),
        _p("polar-team", "core-rack", "desk", "Buz karotu rafı", "Ice-core rack", "desk", "collection"),
        _p("polar-team", "snowburst", "celebration", "Kar patlaması kutlaması", "Snow-burst celebration",
           "celebration", "collection"),
        _p("polar-team", "aurora", "world_theme", "Kutup gecesi ofis teması", "Polar-night office theme",
           "world", "collection"),
    ),
    signature_piece="store:polar-team-core-rack", signature_achievement="sabir_tasi", coin_price=1600,
    archive_quest=("sabir_tasi", "temiz_is", "kusursuz_akis"),
)

NIGHT = CosmeticSet(
    "night-workshop", "Gece Atölyesi", "Night Workshop",
    "Geç saatte çalışan bir üretici atölyesi: lacivert gece ve sıcak lamba paleti, masada eklemli lamba ve kavanoz "
    "ışıkları, kıvılcım çarkı kutlaması.",
    "A late-night maker workshop: navy night and a warm lamp palette, an articulated lamp and jar lights on the desk, "
    "and a spark-wheel celebration.",
    "small",
    pieces=(
        _p("night-workshop", "lamplight", "world_theme", "Gece atölyesi teması", "Night workshop theme",
           "world", "collection"),
        _p("night-workshop", "desk-lamps", "desk", "Masa lambası dizisi", "Desk lamp string", "desk", "collection"),
        _p("night-workshop", "spark-wheel", "celebration", "Kıvılcım çarkı kutlaması", "Spark-wheel celebration",
           "celebration", "collection"),
    ),
    signature_piece="store:night-workshop-desk-lamps", signature_achievement="kusursuz_akis", coin_price=1200,
    archive_quest=("kusursuz_akis", "akis_mimari", "temiz_is"),
)

GARDEN = CosmeticSet(
    "garden-lab", "Bahçe Laboratuvarı", "Garden Lab",
    "Bitki deneyleri yapan bir sera ekibi: yaprak desenli laboratuvar önlüğü, masada cam filiz kuvözü ve fide tepsisi, "
    "tohum yağmuru kutlaması.",
    "A greenhouse crew running plant experiments: a leaf-pattern lab coat, a glass sprout incubator and seedling tray "
    "on the desk, and a seed-shower celebration.",
    "small",
    pieces=(
        _p("garden-lab", "lab-coat", "outfit", "Yapraklı laboratuvar önlüğü", "Leaf lab coat",
           "avatar", "me", "collection"),
        _p("garden-lab", "sprout-box", "desk", "Filiz kuvözü", "Sprout incubator", "desk", "collection"),
        _p("garden-lab", "seed-shower", "celebration", "Tohum yağmuru kutlaması", "Seed-shower celebration",
           "celebration", "collection"),
    ),
    signature_piece="store:garden-lab-sprout-box", signature_achievement="bellek_bahcivani", coin_price=1200,
    archive_quest=("bellek_bahcivani", "yanlisi_duzelt", "akis_mimari"),
)

def _costume(pk: dict[str, Any]) -> CosmeticSet:
    """HERO-PACKS: `packs.py` verisinden set. Risk = parçaların en yükseği; jeton fiyatı [H]."""
    from studio.cosmetics import packs as PK  # noqa: PLC0415 - saf veri

    sid = pk["id"]
    ip, culture = PK.pack_risk(pk)
    return CosmeticSet(
        sid, pk["name"][0], pk["name"][1], pk["lore"][0], pk["lore"][1], pk.get("bucket", "small"),
        pieces=tuple(_p(sid, i["part"], i["kind"], i["label"][0], i["label"][1], *i["surfaces"]) for i in pk["items"]),
        ip_risk=ip, culture_risk=culture, signature_piece=f"{STORE_PREFIX}{sid}-{pk['signature']}",
        signature_achievement=pk["signature_achievement"], archive_quest=tuple(pk["archive_quest"]),
        coin_price=int(pk["coin_price"]), extra=MappingProxyType({"group": "costume", "source": pk["source"]}),
    )


def _costume_sets() -> tuple[CosmeticSet, ...]:
    from studio.cosmetics import packs as PK  # noqa: PLC0415

    return tuple(_costume(pk) for pk in PK.PACKS)


COSTUME_SETS: tuple[CosmeticSet, ...] = _costume_sets()
SETS: tuple[CosmeticSet, ...] = (POLAR, NIGHT, GARDEN, *COSTUME_SETS)
SET_BY_ID: Mapping[str, CosmeticSet] = MappingProxyType({s.id: s for s in SETS})
PIECE_BY_ID: Mapping[str, Piece] = MappingProxyType({p.id: p for s in SETS for p in s.pieces})
PIECE_SET: Mapping[str, str] = MappingProxyType({p.id: s.id for s in SETS for p in s.pieces})


def pick(tr: str, en: str) -> str:
    from studio.i18n import request_lang  # noqa: PLC0415

    return en if request_lang() == "en" and en else tr


def get(set_id: str) -> CosmeticSet | None:
    sid = set_id[len(STORE_PREFIX):] if isinstance(set_id, str) and set_id.startswith(STORE_PREFIX) else set_id
    return SET_BY_ID.get(sid) if isinstance(sid, str) else None


def pieces_of(cs: CosmeticSet) -> tuple[Piece, ...]:
    """Setin (koleksiyonda: içerdiği setlerin) bütün parçaları. Sete sonradan eklenen parça sahibine ücretsizdir."""
    if not cs.is_collection:
        return cs.pieces
    out: list[Piece] = []
    for sid in cs.sets:
        member = SET_BY_ID.get(sid)
        if member is not None:
            out.extend(member.pieces)
    return tuple(out)


def scope_items(cs: CosmeticSet) -> dict[str, list[str]]:
    """Teklif kapsamı: parça → yüzeyler (entitlements.offers.cosmetic_scope girdisi)."""
    return {p.id: sorted(p.surfaces) for p in pieces_of(cs)}


def risk_state(cs: CosmeticSet) -> str:
    worst = max(cs.ip_risk, cs.culture_risk)
    return "ok" if worst <= RISK_PUBLISH_MAX else ("review" if worst == 2 else "rejected")


def all_store_ids() -> set[str]:
    return {s.store_id for s in SETS} | set(PIECE_BY_ID)


def validate() -> list[str]:
    """Katalog tutarlılığı (testler ve açılışta yalnız okuma)."""
    errs: list[str] = []
    for s in SETS:
        if not SET_ID_RE.match(s.id):
            errs.append(f"{s.id}: geçersiz kimlik")
        if s.bucket not in BUCKETS:
            errs.append(f"{s.id}: geçersiz kova")
        if s.price is not None:
            errs.append(f"{s.id}: fiyat bağlanmaz")
        if isinstance(s.coin_price, bool) or not isinstance(s.coin_price, int) or not 0 < s.coin_price <= 5000:
            errs.append(f"{s.id}: jeton fiyatı 1–5000 [H]")
        if not 0 <= s.ip_risk <= 3 or not 0 <= s.culture_risk <= 3:
            errs.append(f"{s.id}: risk 0–3 olmalı")
        if s.is_collection:
            if len(s.sets) != 3 or any(m not in SET_BY_ID or SET_BY_ID[m].bucket != "large" for m in s.sets):
                errs.append(f"{s.id}: koleksiyon 3 büyük setten oluşur")
            continue
        if not s.pieces:
            errs.append(f"{s.id}: parçasız set")
        for p in s.pieces:
            if not p.id.startswith(f"{s.store_id}-"):
                errs.append(f"{p.id}: set önekiyle başlamalı")
            if p.kind not in PIECE_KINDS:
                errs.append(f"{p.id}: bilinmeyen tür")
            if not p.surfaces or any(x not in SURFACES for x in p.surfaces):
                errs.append(f"{p.id}: yüzey listesi geçersiz")
        if s.signature_piece not in {p.id for p in s.pieces}:
            errs.append(f"{s.id}: imza parçası setin parçası değil")
        if not s.signature_achievement or not s.archive_quest:
            errs.append(f"{s.id}: ücretsiz yol eksik")
        hits = ip_hits(s)
        if hits:
            errs.append(f"{s.id}: korumalı ad/marka çağrışımı: {', '.join(hits)}")
    from studio.cosmetics.policy import cosmetic_errors  # noqa: PLC0415 - kostüm içerik kuralı (saf veri)
    return errs + cosmetic_errors(SETS)


def ip_hits(cs: CosmeticSet) -> list[str]:
    """HERO-PACKS: set ve parça adlarında/açıklamada yasaklı ad (kahraman paketleriyle aynı liste; TR ve EN)."""
    from studio.heroes.presets import ip_scan  # noqa: PLC0415 - saf ad listesi (heroes → cosmetics bağımlılığı yok)

    texts = [cs.id, cs.name_tr, cs.name_en, cs.description_tr, cs.description_en]
    texts += [t for p in cs.pieces for t in (p.id, p.label_tr, p.label_en)]
    return ip_scan(*texts)
