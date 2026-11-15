"""E3 yapı modu — parsel gövdesi şeması ve inşa kuralları ( BUILD-*).

Arayüz eşi: `frontend/src/voxel/build/{catalog,volume}.ts` (aynı kimlikler, gruplar, sınırlar ve kural kodları;
`tests/test_expanse_build.py` iki tarafı karşılaştırır). Sunucu yetkilidir: arazi bilgisi gerektirmeyen bütün kuralları
burada uygular; istemci ek olarak gerçek araziyle (çit, bank, rozet, deniz) kesin yürünebilirliği ve yerleştirme anındaki destek
kuralını denetler.

Parsel gövdesi (v1.2 `expanse.plots[]` ile aynı; parsel yerel koordinat):
    {"edits": [[li, y, lj, blok, dönüş], …], "prefabs": [Prefab, …]}
- `blok`: dünya yapıcı palet biçimindeki kimlik (`block_stone`, `block_glass`, `block_glow` …; 32 sabit renk). Nadir bloklar
  (`elem:block.*`) E4'e ayrıldı ve şimdilik reddedilir.
- `dönüş` 0…3 (çeyrek tur), `li < 12`, `y < 8`, `lj < 16`; hücre tekil.
- `prefabs`: beyaz liste (`service.PREFAB_TYPES`), alanlar dünya biçimiyle aynı (`worlds/validate.py FIELDS/RANGE`).

Kurallar:
- BUILD-ZONE-001: kenar halkası (li 0/11, lj 0/15: çit ve dikiş şeridi) inşa edilemez.
- BUILD-NAV-001: omurga (li 5–6 sütunu, lj 7–8 satırı) gövde katmanında (y < 2) boş → dört kenar geçidi ve "Parselime git" karosu
  açık; gövde katmanında dolu karo ≤ 48 (parselin ≥ %50'si yürünebilir); kenar halkası (geçitler hariç) ve dolu karolar
  dışındaki her karo omurgaya 4-komşu bağlı (cep yok).
- BUILD-BUDGET-001: ≤ 600 blok, ≤ 40 prefab, dünya ≤ 6000 blok, ≤ 64 KB (service.py).
- Prefab sütunu özeldir: prefab karosunda hiçbir katta blok yok; prefab'lar çakışmaz.
- Kilitli dekor ( / S35): `game.catalog.DECOR` seviyesinin altındayken önceki gövdeye göre YENİ `block_glow` ya da `lantern`
  reddedilir (var olan eşya kilitlenmez; oyun kapalı / yaratıcı / yönetici modda açık).
- Destek kuralı (havada blok yok) yerleştirme anında istemcide denetlenir: kırma serbest olduğundan tam gövdede geçmişe bağlıdır.
"""

from __future__ import annotations

import re
from collections import Counter, deque
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from studio.api import Studio

PLOT_W, PLOT_D, PLOT_H = 12, 16, 8
PLOT_N = PLOT_W * PLOT_D
MAX_GROUND = 48
SPINE_I = (5, 6)
SPINE_J = (7, 8)
BODY_LAYERS = 2  # gövde katmanı: y < 2 karoyu engeller (kapı 2 blok yüksek)

# 32 sabit blok: kimlik → (renk, grup). İlk 7'si dünya yapıcı paletiyle (lib/builder.ts PALETTE) birebir.
BLOCKS: dict[str, tuple[str, str]] = {
    "block_stone": ("#9CA3AF", "solid"), "block_brick": ("#B5543C", "solid"), "block_wood": ("#7B5236", "solid"),
    "block_metal": ("#64748B", "solid"), "block_glass": ("#A8D8F0", "glass"), "block_glow": ("#FDE68A", "glow"),
    "block_hedge": ("#2F7D32", "solid"),
    "block_white": ("#F1F5F9", "solid"), "block_cream": ("#F1E3D3", "solid"), "block_sand": ("#EBD9A8", "solid"),
    "block_terracotta": ("#C8643B", "solid"), "block_plank": ("#C08A57", "solid"), "block_oak": ("#B88758", "solid"),
    "block_darkwood": ("#4A3222", "solid"), "block_charcoal": ("#374151", "solid"), "block_black": ("#1F2937", "solid"),
    "block_slate": ("#4A5066", "solid"), "block_marble": ("#E5E7EB", "solid"), "block_cobble": ("#78716C", "solid"),
    "block_moss": ("#4D7C0F", "solid"), "block_leaf": ("#6DBE45", "solid"), "block_teal": ("#0F766E", "solid"),
    "block_sky": ("#7DD3FC", "solid"), "block_blue": ("#2563EB", "solid"), "block_navy": ("#1E3A8A", "solid"),
    "block_lilac": ("#A78BFA", "solid"), "block_purple": ("#7C3AED", "solid"), "block_pink": ("#F472B6", "solid"),
    "block_red": ("#DC2626", "solid"), "block_orange": ("#F97316", "solid"), "block_yellow": ("#FACC15", "solid"),
    "block_clay": ("#A16207", "solid"),
}
# 2026-10-19 yapı malzemeleri paketi (entitlements/plans.py PACK_BUILDER): 8 ek sabit renk. Arayüz eşi
# `voxel/build/catalog.ts PACK_BLOCKS`. Yalnız YENİ yerleştirme pakete bağlıdır (service.put_plot); var olan blok kalır,
# çizilir ve dışa aktarılır. Temel 32 renk her pakette ücretsizdir.
PACK_BLOCKS: dict[str, tuple[str, str]] = {
    "block_copper": ("#B87333", "solid"), "block_mint": ("#6EE7B7", "solid"), "block_rose": ("#FDA4AF", "solid"),
    "block_gold": ("#D4A017", "solid"), "block_ice": ("#CFFAFE", "glass"), "block_lavender": ("#C4B5FD", "solid"),
    "block_ochre": ("#CC7722", "solid"), "block_jade": ("#00A86B", "solid"),
}
ALL_BLOCKS: dict[str, tuple[str, str]] = {**BLOCKS, **PACK_BLOCKS}
BLOCK_ID_RE = re.compile(r"^block_[a-z0-9]{1,24}$")
BUILD_GROUPS = ("solid", "glass", "glow")
# Kilitli dekor kimlikleri (palet kimliği = game.catalog.DECOR kimliği)
DECOR_IDS = ("block_glow", "lantern")

E_BLOCK_ID = "Bilinmeyen blok kimliği: {}"
E_BORDER = "Parsel kenarına (çit ve dikiş şeridi) inşa edilemez"
E_SPINE = "Orta yol ve geçitler iki kat yüksekliğe kadar boş kalmalı"
E_PREFAB_COLUMN = "Eşyanın karosuna blok konamaz"
E_PREFAB_OVERLAP = "Eşyalar üst üste gelemez"
E_PREFAB_FIELD = "Prefab alanı geçersiz: {}"
E_GROUND = "Zeminde en çok 48 dolu karo olabilir (parselin yarısı yürünebilir kalmalı)"
E_SPLIT = "Yürünebilir alan bölünüyor ya da dünyaya bağlantısı kopuyor"


def _err(status: int, message: str) -> Exception:
    from studio.expanse.service import ExpanseError  # noqa: PLC0415 (döngüsel içe aktarma yok)
    return ExpanseError(status, message)


def is_border(li: int, lj: int) -> bool:
    return li in (0, PLOT_W - 1) or lj in (0, PLOT_D - 1)


def is_spine(li: int, lj: int) -> bool:
    return li in SPINE_I or lj in SPINE_J


def prefab_tiles(p: dict[str, Any]) -> list[tuple[int, int]]:
    """Prefab ayak izi (dünya biçimiyle aynı `footprint`; boşsa çapa karosu)."""
    from studio.worlds.validate import footprint  # noqa: PLC0415
    cells = footprint(p)
    return cells or [(int(p["i"]), int(p["j"]))]


def check_prefab_fields(p: dict[str, Any]) -> None:
    """Alan türleri ve aralıkları (worlds/validate.py FIELDS + RANGE; ızgara = parsel)."""
    from studio.worlds.validate import FIELDS, RANGE, _check, _is_num  # noqa: PLC0415
    for raw_name, kind in FIELDS[p["t"]].items():
        name = raw_name.rstrip("?")
        if name not in p:
            if raw_name.endswith("?"):
                continue
            raise _err(422, E_PREFAB_FIELD.format(name))
        v = p[name]
        rng = RANGE.get(name)
        if not _check(kind, v, PLOT_W, PLOT_D) or (rng and _is_num(v) and not rng[0] <= v <= rng[1]):
            raise _err(422, E_PREFAB_FIELD.format(name))


def ground_tiles(body: dict[str, Any]) -> set[tuple[int, int]]:
    """Gövde katmanında (y < 2) dolu karolar: bloklar + prefab ayak izleri."""
    out = {(e[0], e[2]) for e in body.get("edits", []) if e[1] < BODY_LAYERS}
    for p in body.get("prefabs", []):
        out.update(prefab_tiles(p))
    return out


def connected(ground: set[tuple[int, int]]) -> bool:
    """Mantıksal yürünebilirlik (kenar halkası geçitler hariç engelli) omurga merkezinden tek bileşen mi?"""
    def walk(li: int, lj: int) -> bool:
        if (li, lj) in ground:
            return False
        return not is_border(li, lj) or is_spine(li, lj)

    tiles = {(li, lj) for li in range(PLOT_W) for lj in range(PLOT_D) if walk(li, lj)}
    root = (SPINE_I[0], SPINE_J[0])
    if root not in tiles:
        return False
    seen = {root}
    queue = deque([root])
    while queue:
        li, lj = queue.popleft()
        for n in ((li + 1, lj), (li - 1, lj), (li, lj + 1), (li, lj - 1)):
            if n in tiles and n not in seen:
                seen.add(n)
                queue.append(n)
    return len(seen) == len(tiles)


def validate_rules(body: dict[str, Any]) -> None:
    """Şekli doğrulanmış gövdede (service.validate_body) E3 kuralları; ihlalde ExpanseError (422)."""
    prefab_at: dict[tuple[int, int], int] = {}
    for k, p in enumerate(body.get("prefabs", [])):
        check_prefab_fields(p)
        for li, lj in prefab_tiles(p):
            if not (0 <= li < PLOT_W and 0 <= lj < PLOT_D):
                raise _err(422, "Prefab parselin dışında")
            if is_border(li, lj):
                raise _err(422, E_BORDER)
            if is_spine(li, lj):
                raise _err(422, E_SPINE)
            if (li, lj) in prefab_at:
                raise _err(422, E_PREFAB_OVERLAP)
            prefab_at[(li, lj)] = k
    for li, y, lj, block, _rot in body.get("edits", []):
        if block not in ALL_BLOCKS:
            raise _err(422, E_BLOCK_ID.format(block))
        if is_border(li, lj):
            raise _err(422, E_BORDER)
        if is_spine(li, lj) and y < BODY_LAYERS:
            raise _err(422, E_SPINE)
        if (li, lj) in prefab_at:
            raise _err(422, E_PREFAB_COLUMN)
    ground = ground_tiles(body)
    if len(ground) > MAX_GROUND:
        raise _err(422, E_GROUND)
    if not connected(ground):
        raise _err(422, E_SPLIT)


def added_pack_blocks(previous: dict[str, Any] | None, body: dict[str, Any]) -> list[str]:
    """Önceki gövdeye göre sayısı ARTAN paket blokları (yalnız yeni yerleştirme kapılıdır; kırmak ve var olanı tutmak serbest)."""
    def count(b: dict[str, Any] | None) -> Counter[str]:
        return Counter(e[3] for e in (b or {}).get("edits", []) if e[3] in PACK_BLOCKS)
    before, after = count(previous), count(body)
    return sorted(k for k in after if after[k] > before[k])


def decor_counts(body: dict[str, Any] | None) -> Counter[str]:
    out: Counter[str] = Counter()
    for e in (body or {}).get("edits", []):
        if e[3] in DECOR_IDS:
            out[e[3]] += 1
    for p in (body or {}).get("prefabs", []):
        if p.get("t") in DECOR_IDS:
            out[p["t"]] += 1
    return out


def added_locked_decor(studio: "Studio", previous: dict[str, Any] | None, body: dict[str, Any]) -> tuple[str, int] | None:
    """ kuralı parselde: kilitli dekor YENİ yerleştirildiyse (etiket, seviye). Oyun kapalı / yaratıcı / yönetici modda None."""
    from studio.worlds import locks as L  # noqa: PLC0415
    game = L._game(studio)
    if game is None or game.creative() or game.admin():
        return None
    from studio.game import catalog as C  # noqa: PLC0415
    level = game.office_level()
    before, after = decor_counts(previous), decor_counts(body)
    for d in C.DECOR:
        if d.id in DECOR_IDS and level < d.unlock_level and after[d.id] > before[d.id]:
            return d.label, d.unlock_level
    return None


# ---------------------------------------------------------------- dünya biçimi v1.2 `expanse` bloğu
MAX_PALETTE = 64
ELEM_BLOCK_RE = re.compile(r"^elem:block\.[a-z0-9_]{1,32}$")


def expanse_issues(exp: Any, annex_ids: tuple[str, ...]) -> list[str]:
    """v1.2 `expanse` bloğunun sorunlu alan yolları (boş liste → geçerli). Arayüz eşi `worldFormat.ts expanseIssues`."""
    from studio.expanse.service import MAX_EDITS_TOTAL, MAX_PLOT_SLOTS, PLOT_COLORS, ExpanseError, validate_body  # noqa: PLC0415
    if not isinstance(exp, dict):
        return ["expanse"]
    out: list[str] = []
    allowed = {"seed", "biome", "radius", "plots", "blocks"}
    out += [f"expanse.{k}" for k in exp if k not in allowed]
    seed = exp.get("seed")
    if not (isinstance(seed, int) and not isinstance(seed, bool) and 0 <= seed < 2 ** 32):
        out.append("expanse.seed")
    if exp.get("biome") is not None and exp.get("biome") not in annex_ids:
        out.append("expanse.biome")
    radius = exp.get("radius")
    if radius is not None and not (isinstance(radius, int) and not isinstance(radius, bool) and 2 <= radius <= 12):
        out.append("expanse.radius")
    blocks = exp.get("blocks")
    if blocks is not None:
        ok = isinstance(blocks, dict) and len(blocks) <= MAX_PALETTE and all(
            isinstance(k, str) and (k in ALL_BLOCKS or ELEM_BLOCK_RE.match(k)) and isinstance(v, dict) and set(v) == {"group", "color"}
            and v["group"] in BUILD_GROUPS and isinstance(v["color"], str) and re.match(r"^#[0-9A-Fa-f]{6}$", v["color"])
            for k, v in blocks.items())
        if not ok:
            out.append("expanse.blocks")
    plots = exp.get("plots")
    if not isinstance(plots, list) or len(plots) > MAX_PLOT_SLOTS:
        out.append("expanse.plots")
        return out
    slots: set[int] = set()
    total = 0
    for n, p in enumerate(plots):
        path = f"expanse.plots[{n}]"
        if not isinstance(p, dict) or set(p) - {"slot", "name", "color", "edits", "prefabs"}:
            out.append(path)
            continue
        slot = p.get("slot")
        if not (isinstance(slot, int) and not isinstance(slot, bool) and 0 <= slot < MAX_PLOT_SLOTS) or slot in slots:
            out.append(f"{path}.slot")
        else:
            slots.add(slot)
        if "color" in p and (not isinstance(p["color"], str) or p["color"].upper() not in PLOT_COLORS):
            out.append(f"{path}.color")
        if "name" in p and not (isinstance(p["name"], str) and len(p["name"]) <= 40 and "<" not in p["name"] and ">" not in p["name"]):
            out.append(f"{path}.name")
        try:
            body = validate_body({k: p[k] for k in ("edits", "prefabs") if k in p})
            total += len(body["edits"])
        except ExpanseError:
            out.append(f"{path}.body")
    if total > MAX_EDITS_TOTAL:
        out.append("expanse.plots")
    return out
