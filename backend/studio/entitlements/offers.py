"""Teklif sürümü (-paketler §2.5).

Her satılabilir ya da pakete dahil teklifin (plan, ek, özellik paketi) bir `scope_hash`'i vardır: kullanıcının ne
aldığının kanonik JSON'unun sha256'sı. Fiyat ve metin kapsam değildir; sınırlar, özellikler, paketler, sandık hakkı ve
ek koltuk birimi kapsamdır. Planın kapsamı, dahil ettiği paketlerin kapsam özetini de içerir (paket değişirse plan da
yeni sürüm olur).

`offer_version` kapsamdan türetilir: `SCOPE_HISTORY` her teklifin bilinen kapsam özetlerini sırayla tutar. Kapsam
geçmişte varsa sürümü odur; yoksa sürüm `len(geçmiş) + 1` olur ve `registered=False` döner. Böylece kapsam değişince
sürüm de değişir; `tests/test_rev_ledgers.py` her güncel kapsamın kayıtlı olmasını ister (sınır değişip geçmişe yeni
satır eklenmezse test kırılır). Eski sürümlerin satırı silinmez: eski sürümle alınan hak, satın alınma anındaki kapsam
kopyasıyla (`ledger.purchased.scope`) korunur.

Fiyat KOPYALANMAZ: `list_price_ref` yalnız `plans.py`'deki alanı gösterir; `list_price` canlı okur. Ödeme, ağ yok.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any

from studio.entitlements import plans as P

CURRENCY = "USD"
_REF_RE = re.compile(r"^(?P<id>[a-z0-9:_-]{1,60})@(?P<ver>[0-9]{1,6})$")

# Teklif kimliği → sırayla (scope_hash, valid_from). Yalnız EKLENİR; satır silinmez ya da değiştirilmez.
SCOPE_HISTORY: dict[str, tuple[tuple[str, str], ...]] = {
    # BOOSTER-TIER (karar 2026-10-28): planlara F_BOOSTERS eklendi → kapsam değişti, sürüm 2 (satış kapalı; @1 satın alınmadı)
    "plus_m": (("1ed528461282c4954501ae0d7c851f2c63ee50e3cec0b1330f123bed260a3d71", "2026-10-19"),
               ("b5d04ba23bebcd27386a9e05a1f17df648c1316f4c0a9403ed74c4af35fa0ede", "2026-10-28")),
    "plus_y": (("1ed528461282c4954501ae0d7c851f2c63ee50e3cec0b1330f123bed260a3d71", "2026-10-19"),
               ("b5d04ba23bebcd27386a9e05a1f17df648c1316f4c0a9403ed74c4af35fa0ede", "2026-10-28")),
    "pro_m": (("d94f3b65e7add6e3311f608a11f7e8ed85a0a8fb3d70b9d766ada33d1d4c4fb9", "2026-10-19"),
              ("45b2e11564995d835b549f8a78d49f3e1eae2d0c48fda83340260fc680a2055a", "2026-10-28")),
    "pro_y": (("d94f3b65e7add6e3311f608a11f7e8ed85a0a8fb3d70b9d766ada33d1d4c4fb9", "2026-10-19"),
              ("45b2e11564995d835b549f8a78d49f3e1eae2d0c48fda83340260fc680a2055a", "2026-10-28")),
    "addon:seat": (("7677adf8568937ff64495bbbc15272bb7197e809b0aa617fd36aa31560c85a86", "2026-10-19"),),
    "addon:seat5": (("2f8cd140ea1e3eb0c171bb63c06bfc8a5d39802a9d39452cc82390d8a8570027", "2026-10-19"),),
    "addon:pack:heroes": (("6da31ce8b6fdea259707880c1819058c8d82f5fbf28bd468e4d507f08b8dbdd9", "2026-10-19"),),
    "addon:pack:reports": (("c303f6dcebcd9652f43e04bd20d114adc8792cfc5d544129daf92297e893a398", "2026-10-19"),),
    "pack:plots_plus": (("feb4ccccf01ff2286cc0cb102b60d6fd093fd04a32acba13a23938e8476f9a7f", "2026-10-19"),),
    "pack:builder_materials": (("fe8f6b78e078b63900fd75529b84c0334bb40b97b5fe5b01147ce420d676e5ff", "2026-10-19"),),
    "pack:scenes": (("b4421b39013b1bff58c492a00da500a81154dc6c5a18528ef3cdf68b8bd6f460", "2026-10-19"),),
    "pack:heroes": (("918351b2080c83e30f23208c675deab5f62236efc81dd09600e30bdf4e3f1c34", "2026-10-19"),),
    "pack:reports": (("7973a3f96641ea9f7ba8ee914ecb3a28c087a53d716f061e4e49131581a89cf6", "2026-10-19"),),
    "pack:remote": (("f7928769727fa6555273a20947dc88c6da0c36ae62d2e6ff660947d58f256a55", "2026-10-19"),),
}


@dataclass(frozen=True)
class Offer:
    id: str                       # plus_m | plus_y | pro_m | pro_y | addon:seat | addon:pack:<id> | pack:<id>
    version: int
    sku: str
    plan: str | None              # plan ya da ekin bağlı olduğu plan; paket için None
    period: str | None            # month | year | None
    currency: str
    list_price_ref: str | None    # plans.py alanına gösterge (fiyat kopyası değil)
    scope_hash: str
    valid_from: str | None        # kayıtlı sürümün başlangıç tarihi; kayıtsızsa None
    registered: bool

    @property
    def ref(self) -> str:
        return f"{self.id}@{self.version}"

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "version": self.version, "ref": self.ref, "sku": self.sku, "plan": self.plan,
                "period": self.period, "currency": self.currency, "list_price_ref": self.list_price_ref,
                "scope_hash": self.scope_hash, "valid_from": self.valid_from, "registered": self.registered}


def scope_hash(scope: dict[str, Any]) -> str:
    raw = json.dumps(scope, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- kapsamlar (fiyat ve metin yok)
def pack_scope(pack_id: str) -> dict[str, Any]:
    p = P.PACK_BY_ID[pack_id]
    scope: dict[str, Any] = {"pack": p.id, "kind": p.kind, "checkpoint": p.checkpoint, "enforced": p.enforced}
    if p.id == P.PACK_PLOTS:
        scope["extra_plot_slots"] = P.EXTRA_PLOT_SLOTS
    return scope


def plan_scope(plan_id: str) -> dict[str, Any]:
    p = P.PLANS[plan_id]
    addon = {k: p.addon[k] for k in ("sku", "seats_per_unit", "max_units")} if p.addon else None
    return {"plan": p.id, "seats": p.seats, "limits": dict(p.limits), "features": sorted(p.features),
            "scene_packs": p.included_scene_packs, "hero_packs": p.included_hero_packs, "devices": p.devices,
            "chests": dict(P.CHESTS.get(p.id, P.CHESTS["free"])),
            "packs": {k: scope_hash(pack_scope(k)) for k in sorted(P.TIER_PACKS.get(p.id, frozenset()))},
            "addon": addon}


def addon_scope(sku: str) -> dict[str, Any]:
    if sku in P.ADDONS:
        a = P.ADDONS[sku]
        return {"sku": sku, "plan": a["plan"], "seats_per_unit": a["seats_per_unit"], "max_units": a["max_units"]}
    a = P.ADDON_PACKS[sku]
    return {"sku": sku, "plans": sorted(a["plans"]), "pack": scope_hash(pack_scope(a["pack"]))}


# ---------------------------------------------------------------- katalog
def _catalog() -> list[tuple[str, str, str | None, str | None, str | None, dict[str, Any]]]:
    """(id, sku, plan, period, list_price_ref, scope)."""
    out = []
    for pid in ("plus", "pro"):
        scope = plan_scope(pid)
        for period, suffix, field in (("month", "m", "price_month"), ("year", "y", "price_year")):
            oid = f"{pid}_{suffix}"
            out.append((oid, oid, pid, period, f"plans.PLANS['{pid}'].{field}", scope))
    for sku, a in sorted(P.ADDONS.items()):
        out.append((sku, sku, a["plan"], "month", f"plans.ADDONS['{sku}'].price_month", addon_scope(sku)))
    for sku, a in sorted(P.ADDON_PACKS.items()):
        out.append((sku, sku, a["plans"][0] if len(a["plans"]) == 1 else None, None,
                    f"plans.ADDON_PACKS['{sku}'].price", addon_scope(sku)))
    for pack in P.FEATURE_PACKS:
        oid = f"pack:{pack.id}"
        out.append((oid, oid, None, None, None, pack_scope(pack.id)))
    return out


def version_of(offer_id: str, h: str,
               history: dict[str, tuple[tuple[str, str], ...]] | None = None) -> tuple[int, bool, str | None]:
    hist = (SCOPE_HISTORY if history is None else history).get(offer_id, ())
    for i, (known, since) in enumerate(hist, 1):
        if known == h:
            return i, True, since
    return len(hist) + 1, False, None


def offers() -> list[Offer]:
    result = []
    for oid, sku, plan, period, ref, scope in _catalog():
        h = scope_hash(scope)
        ver, reg, since = version_of(oid, h)
        result.append(Offer(oid, ver, sku, plan, period, CURRENCY, ref, h, since, reg))
    return result


def offer(offer_id: str) -> Offer | None:
    return next((o for o in offers() if o.id == offer_id), None)


def scope_of(offer_id: str) -> dict[str, Any] | None:
    """Teklifin GÜNCEL kapsamı (satın alma anında deftere kopyalanır)."""
    return next((s for oid, *_rest, s in _catalog() if oid == offer_id), None)


def parse_ref(ref: Any) -> tuple[str, int] | None:
    if not isinstance(ref, str):
        return None
    m = _REF_RE.match(ref)
    return (m["id"], int(m["ver"])) if m else None


def lookup(ref: Any) -> dict[str, Any] | None:
    """`id@sürüm` → kayıtlı geçmiş satırı (eski sürüm de bulunur; silinmez). Bilinmiyorsa None."""
    parsed = parse_ref(ref)
    if parsed is None:
        return None
    oid, ver = parsed
    hist = SCOPE_HISTORY.get(oid, ())
    if not 1 <= ver <= len(hist):
        return None
    h, since = hist[ver - 1]
    cur = offer(oid)
    return {"id": oid, "version": ver, "scope_hash": h, "valid_from": since,
            "current": bool(cur and cur.version == ver)}


def list_price(o: Offer) -> float | None:
    """Fiyatı plans.py'den canlı okur (kopya yok). Paket teklifleri ve fiyatsız ekler None."""
    if o.sku in ("plus_m", "plus_y", "pro_m", "pro_y"):
        p = P.PLANS[o.plan or ""]
        return p.price_month if o.period == "month" else p.price_year
    if o.sku in P.ADDONS:
        return P.ADDONS[o.sku]["price_month"]
    if o.sku in P.ADDON_PACKS:
        return P.ADDON_PACKS[o.sku]["price"]
    return None


def refs_for_compare() -> dict[str, Any]:
    """compare_table için: plan → {month, year}, paket → ref, ek → ref."""
    by_id = {o.id: o for o in offers()}
    return {
        "plans": {pid: {"month": by_id[f"{pid}_m"].ref, "year": by_id[f"{pid}_y"].ref} for pid in ("plus", "pro")},
        "packs": {p.id: by_id[f"pack:{p.id}"].ref for p in P.FEATURE_PACKS},
        "addons": [{"sku": sku, "offer": by_id[sku].ref,
                    "available": bool(P.ADDON_PACKS[sku]["available"]) if sku in P.ADDON_PACKS else False}
                   for sku in (*sorted(P.ADDONS), *sorted(P.ADDON_PACKS))],
    }


# ---------------------------------------------------------------- COS-A: kozmetik set teklifi (§11.5)
# Set kataloğu `cosmetics/catalog.py`'dedir ve bağımlılık yönü tektir (cosmetics → entitlements): bu modül kataloğu içe
# AKTARMAZ, kapsamı çağıran verir. Kozmetik teklifleri bu yüzden `offers()` listesine girmez ve ayrı geçmiş tutar;
# tests/test_cosmetics_ledger.py her güncel set kapsamının burada kayıtlı olmasını ister. Fiyat yok: `list_price_ref`
# None. Sete parça eklenirse kapsam (parça → yüzeyler) değişir ve sürüm artar; eski sürümle alan yeni parçayı ücretsiz
# alır (hak `cosmetic:<set>`, sürümden bağımsızdır).
COSMETIC_KIND = "cosmetic"
COSMETIC_SCOPE_HISTORY: dict[str, tuple[tuple[str, str], ...]] = {
    "cosmetic:polar-team": (("8ce601507e9f07a93dd58e76d9f097eeff16d76a93744fc7de9668fadda4d82f", "2026-10-19"),),
    "cosmetic:night-workshop": (("044da54b2c7ff26583a61439319faefb6f546b62b861719e9b019075648a8abb", "2026-10-19"),),
    "cosmetic:garden-lab": (("5fb492a7d10afded2cca96bf18b666aad233666dbbceac1c1ac1af67a6caf3ad", "2026-10-19"),),
    # HERO-PACKS: kapsam kaydı satış DEĞİLDİR; para ile satış ödeme kapısı arkasında kapalı
    "cosmetic:legend-squad": (("2a835e112b5e4bade3b9f23c45792e758a33f4aaa5396d72875d79233c29698d", "2026-10-25"),),
    "cosmetic:element-wardens": (("1a972a11093fd467e24a655f69ffafda0751c996f711b71b785805d463aa7286", "2026-10-25"),),
    "cosmetic:anatolian-legends": (("69945f0389a055cfb5fd22aeb1d00d7b8b75d1d068b389f897f88cfb57ea528c", "2026-10-25"),),
    "cosmetic:olympus-myths": (("a5a63ef2a14a157d03e90493b2c8e07f1b40f98147d099068842cc108b640ce4", "2026-10-25"),),
    "cosmetic:northlands": (("1ad246ba14b547a359adb62d38cdea43fb59b76b7e5c036325ee76e9a012031a", "2026-10-25"),),
    "cosmetic:yokai-night": (("651d2f0fcd9c4667aca6a9e23781424b3408d69bf6fc78fbb879bebf6d84602e", "2026-10-25"),),
    "cosmetic:gothic-classics": (("831d974d1305e050a7b5e0dc2fbf8a2c7fa0ddec838ed8e1d8890f35c354e830", "2026-10-25"),),
    "cosmetic:star-wayfarers": (("8dcd6c80cbb67faecb424bbe01a14bea72ed286f9a762836c57c8e6cdf6dd5ab", "2026-10-25"),),
    "cosmetic:creature-workshop": (("332b012668004375e27142cdbdd5a965bfc61a2633b7d613f4e71b958fbfb383", "2026-10-25"),),
    "cosmetic:spooky-night": (("38e5a4eb89b2c1e5273d7e172ff14b9bd7513cca3df5a696dbba332756d3f95e", "2026-10-25"),),
}


def cosmetic_scope(set_id: str, items: dict[str, list[str]]) -> dict[str, Any]:
    """Kapsam = set kimliği + her parçanın yüzeyleri (fiyat ve metin kapsam değildir)."""
    return {"kind": COSMETIC_KIND, "set": set_id,
            "items": {k: sorted(set(v)) for k, v in sorted(items.items())}}


def cosmetic_offer(set_id: str, items: dict[str, list[str]]) -> Offer:
    oid = f"cosmetic:{set_id}"
    h = scope_hash(cosmetic_scope(set_id, items))
    ver, reg, since = version_of(oid, h, COSMETIC_SCOPE_HISTORY)
    return Offer(oid, ver, oid, None, None, CURRENCY, None, h, since, reg)


# ---------------------------------------------------------------- sahne teklifi (2026-10-19 gece kararı; K6 gevşedi)
# Sahne parayla da alınabilir; jeton + seviye yolu aynen kalır. Sahne kataloğu `game/catalog.py`'dedir ve bu modül onu
# içe AKTARMAZ (game ↔ entitlements ayrık). Kapsam = sahne kimliği (+ çağıranın verdiği katman/paket); fiyat yok
# (`list_price_ref` None). Bir sahne satışa açılacağı gün kapsamı SCENE_SCOPE_HISTORY'ye eklenir; o güne dek teklif
# `registered=False` döner ve satılmaz. Sahiplik: GameService.is_owned (jeton/seviye/paket YA DA etkin `scene:` hakkı).
SCENE_KIND = "scene"
SCENE_SCOPE_HISTORY: dict[str, tuple[tuple[str, str], ...]] = {}


def scene_scope(scene_id: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"kind": SCENE_KIND, "scene": scene_id, **{k: v for k, v in sorted((extra or {}).items())
                                                       if k not in ("kind", "scene", "price")}}


def scene_offer(scene_id: str, extra: dict[str, Any] | None = None) -> Offer:
    oid = f"scene:{scene_id}"
    h = scope_hash(scene_scope(scene_id, extra))
    ver, reg, since = version_of(oid, h, SCENE_SCOPE_HISTORY)
    return Offer(oid, ver, oid, None, None, CURRENCY, None, h, since, reg)
