"""E2 parsel servisi (kararlar D1–D5 = A).

İlkeler:
- **Konum saklanmaz.** Parselin yalnız yuva sırası (`slot`, 0…11) vardır; arayüz `voxel/expanse/plots.ts` ile yuvayı yapılı dünya
  kutusunu saran ilk halkaya her seferinde yerleştirir (dünya büyüyünce parsel içeriğiyle birlikte kayar).
- **Ekonomi (D4 A):** sahiplenme sırasına (yönetici parselleri hariç, bütün dünyalarda) göre ilk parsel ücretsiz; sonrakiler ofis
  seviyesi eşiği ve kazanılmış jetonla (artan fiyat, tavan 3000). Jeton harcaması `game/` defterinden (`game_coins`) geçer ve
  idempotenttir (`expanse:plot:<dünya>:<yuva>`). Parsel ajan kapasitesi, hız ya da kalite vermez (İ2).
- **Yönetici / test modu (S40):** jeton harcanmaz, akış/ödül yazılmaz; deneme parseli `source = admin` olarak tutulur, mod
  kapanınca görünmez ve yuva gerçek sahiplenmeyle yeniden alınabilir. Keşif kümesi yönetici modunda kaydedilmez.
- **Kullanıcı-yalnız yazma:** `/api/expanse/` yolu `clients/tracker.py USER_ONLY_RE` içindedir (MCP 403).
- Keşif kümesi yalnız mini harita içindir; ödül yoktur (§13.1 "yürüme ödüllendirilmez").
- E3 yapı modu: parsel gövdesi şeması ve inşa kuralları `build.py`'de (dünya yapıcı blok kimlikleri, kenar/omurga/yürünebilirlik,
  kilitli dekor). Deneme parseli (yönetici / test modu) üzerinde inşa doğrulanır ama **kaydedilmez** (`persisted: false`).
"""

from __future__ import annotations

import base64
import binascii
import json
import math
import re
import secrets
import threading
import time
from collections import deque
from typing import TYPE_CHECKING, Any

from studio.expanse import build as B
from studio.expanse.db import ensure_schema
from studio.game import rules as R

if TYPE_CHECKING:
    from studio.api import Studio
    from studio.game.db import GameDB
    from studio.game.service import GameService

# ---------------------------------------------------------------- sınırlar (plan §7, §9.1, §10.1)
MAX_PLOTS = 12                       # dünya başına yuva (frontend voxel/expanse/context.ts MAX_PLOTS)
# 2026-10-19 ek arsa paketi (entitlements/plans.py PACK_PLOTS, EXTRA_PLOT_SLOTS): +4 yuva. Yalnız GERÇEK paket hakkı açar
# (yönetici/test paketi önizler); parsel yine seviye + kazanılmış jetonla alınır. Arayüz eşi context.ts MAX_PLOT_SLOTS.
MAX_PLOT_SLOTS = 16
PACK_PLOTS = "plots_plus"
PACK_BUILDER = "builder_materials"
PLOT_W, PLOT_D, PLOT_H = 12, 16, 8   # parsel yerel hacmi (li < 12, lj < 16, y < 8)
MAX_PLOT_BYTES = 64 * 1024           # PUT gövdesi (parsel başına)
MAX_EDITS = 600                      # parsel başına blok farkı
MAX_EDITS_TOTAL = 6000               # dünya başına
MAX_PREFABS = 40
MAX_NAME = 40
RADIUS_MIN, RADIUS_MAX = 4, 12       # keşif yarıçapı (D2 A): seviyeyle 4 → 12 parsel
RADIUS_LEVELS_PER_RING = 3           # [VARSAYIM] her 3 ofis seviyesinde +1 halka (seviye 25'te 12)
# Keşif bit kümesi: taban çerçevesinde (cx, cz) ∈ [−32, 32)² → 64 × 64 bit = 512 bayt (yarıçap 12 + en büyük dünya sığar)
EXPLORED_SPAN = 64
EXPLORED_OFFSET = 32
EXPLORED_BYTES = EXPLORED_SPAN * EXPLORED_SPAN // 8
WRITES_PER_MIN = 60

# Sahiplenme merdiveni (D4 A; plan §13.1 "300 → 600 → 1000 → … tavan 3000"). Sıra = bütün dünyalarda gerçek (yönetici
# olmayan) parsel sayısı. [KARAR] seviye eşikleri planda açık bırakıldı: ılımlı varsayılan (her parselde +2 seviye).
LADDER: tuple[tuple[int, int], ...] = (
    (0, 1), (300, 3), (600, 5), (1000, 7), (1400, 9), (1800, 11),
    (2200, 13), (2600, 15), (3000, 17), (3000, 19), (3000, 21), (3000, 23),
)

# Rozet renkleri (yazısız; dünyada yalnız renk). Arayüz `voxel/expanse/plots.ts PLOT_COLORS` ile aynı sıra.
PLOT_COLORS: tuple[str, ...] = ("#E5484D", "#F59E0B", "#22C55E", "#06B6D4", "#3B82F6", "#8B5CF6", "#EC4899", "#F5F5F4")

# E3 inşa için güvenli prefab türleri (plan §8: ağaç, çalı, bank, lamba işareti, masa, sandık, çit). İstasyon, uyku ve araç
# noktası prefab'ı yok: parsel ajan alanı değildir (D5 A). Alanlar worlds/validate.py FIELDS/RANGE (build.check_prefab_fields).
PREFAB_TYPES: frozenset[str] = frozenset({"plant", "pine", "palm", "snowyPine", "tree", "rock", "crate", "table", "sofa",
                                          "lantern", "sandbags"})
BLOCK_RE = B.BLOCK_ID_RE  # E3: dünya yapıcı palet biçimi (`block_*`); katalog denetimi build.validate_rules
WORLD_RE = re.compile(r"^(?:w_[a-z0-9]{6,32}|[a-z][a-z0-9_]{1,31})$")
PLOT_ID_RE = re.compile(r"^p_[a-f0-9]{12}$")
_CTRL = re.compile(r"[\x00-\x1f\x7f]")


class ExpanseError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def ladder(index: int) -> tuple[int, int]:
    """Sıradaki (0 tabanlı) parselin (fiyat, en düşük ofis seviyesi)."""
    return LADDER[min(max(index, 0), len(LADDER) - 1)]


def radius_for(level: int) -> int:
    """Keşif yarıçapı (D2 A): 4 + (seviye − 1) // 3, en çok 12."""
    return max(RADIUS_MIN, min(RADIUS_MAX, RADIUS_MIN + (max(1, level) - 1) // RADIUS_LEVELS_PER_RING))


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _int_in(v: Any, lo: int, hi: int) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and lo <= v < hi


def _name(raw: Any) -> str:
    if raw is None:
        return ""
    if not isinstance(raw, str) or len(raw) > MAX_NAME or _CTRL.search(raw) or "<" in raw or ">" in raw:
        raise ExpanseError(400, "Parsel adı en çok 40 karakterlik düz metin olmalı")
    return raw.strip()


def _color(raw: Any, default: str | None = None) -> str:
    if raw is None and default is not None:
        return default
    if not isinstance(raw, str) or raw.upper() not in PLOT_COLORS:
        raise ExpanseError(400, "Parsel rengi sabit paletten olmalı")
    return raw.upper()


def validate_body(data: Any) -> dict[str, Any]:
    """Parsel gövdesi şeması (§9.1 `plots[]`): {name?, color?, edits?, prefabs?}; kapalı şema, parsel yerel koordinat.
    E3: şekil denetiminden sonra inşa kuralları (build.validate_rules: katalog, kenar, omurga, prefab sütunu, ≤ 48 zemin karosu,
    bağlantı)."""
    if not isinstance(data, dict):
        raise ExpanseError(400, "Gövde bir nesne olmalı")
    unknown = set(data) - {"name", "color", "edits", "prefabs", "client_request_id"}
    if unknown:
        raise ExpanseError(422, "Parsel gövdesinde tanınmayan alan var")
    edits = data.get("edits", [])
    if not isinstance(edits, list) or len(edits) > MAX_EDITS:
        raise ExpanseError(422, "edits en çok 600 öğelik bir dizi olmalı")
    seen: set[tuple[int, int, int]] = set()
    for e in edits:
        if not (isinstance(e, list) and len(e) == 5 and _int_in(e[0], 0, PLOT_W) and _int_in(e[1], 0, PLOT_H)
                and _int_in(e[2], 0, PLOT_D) and isinstance(e[3], str) and BLOCK_RE.match(e[3]) and _int_in(e[4], 0, 4)):
            raise ExpanseError(422, "Blok farkı [li, y, lj, blok, dönüş] biçiminde ve parsel içinde olmalı")
        key = (e[0], e[1], e[2])
        if key in seen:
            raise ExpanseError(422, "Aynı hücrede birden çok blok var")
        seen.add(key)
    prefabs = data.get("prefabs", [])
    if not isinstance(prefabs, list) or len(prefabs) > MAX_PREFABS:
        raise ExpanseError(422, "prefabs en çok 40 öğelik bir dizi olmalı")
    from studio.worlds.validate import PREFAB_KEYS  # noqa: PLC0415 (dünya biçimiyle aynı alan adları)
    for p in prefabs:
        if not isinstance(p, dict) or p.get("t") not in PREFAB_TYPES:
            raise ExpanseError(422, "Parselde bu prefab türü kullanılamaz")
        if not (_int_in(p.get("i"), 0, PLOT_W) and _int_in(p.get("j"), 0, PLOT_D)):
            raise ExpanseError(422, "Prefab parselin dışında")
        if set(p) - PREFAB_KEYS[p["t"]]:
            raise ExpanseError(422, "Prefab alanı tanınmıyor")
        for k, v in p.items():
            if k == "t":
                continue
            ok = isinstance(v, bool) or _num(v) or (isinstance(v, str) and len(v) <= 32 and not _CTRL.search(v))
            if not ok:
                raise ExpanseError(422, "Prefab alanı tanınmıyor")
    body = {"edits": edits, "prefabs": prefabs}
    if len(json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > MAX_PLOT_BYTES:
        raise ExpanseError(413, "Parsel gövdesi 64 KB sınırını aşıyor")
    B.validate_rules(body)
    return body


class ExpanseService:
    def __init__(self, studio: "Studio"):
        self.studio = studio
        self._rl_lock = threading.Lock()
        self._writes: deque[float] = deque()

    # ------------------------------------------------------------------ yardımcılar
    @property
    def game(self) -> "GameService":
        from studio.game.api import get_service  # noqa: PLC0415
        g = get_service(self.studio)
        ensure_schema(g.db)
        return g

    def _rate(self) -> None:
        now = time.monotonic()
        with self._rl_lock:
            while self._writes and now - self._writes[0] > 60:
                self._writes.popleft()
            if len(self._writes) >= WRITES_PER_MIN:
                raise ExpanseError(429, "Çok fazla istek; biraz bekle")
            self._writes.append(now)

    def _world(self, world: Any) -> str:
        """Dünya anahtarı: yerleşik sahne kimliği ya da var olan kullanıcı dünyası (`w_…`)."""
        from studio.walk import catalog as W  # noqa: PLC0415 (25 yerleşik sahne listesi)
        if not isinstance(world, str) or not WORLD_RE.match(world):
            raise ExpanseError(400, "Geçersiz dünya kimliği")
        if world.startswith("w_"):
            from studio.worlds.service import get_store  # noqa: PLC0415
            if not get_store(self.studio).exists(world):
                raise ExpanseError(404, "Dünya yok")
            return world
        if world not in W.SCENES:
            raise ExpanseError(404, "Dünya yok")
        return world

    def _scene_open(self, g: "GameService", world: str) -> bool:
        """Gerçek sahiplik (kullanıcı dünyası her zaman açık); yaratıcı/yönetici atlaması sayılmaz (walk ile aynı)."""
        return world.startswith("w_") or g.is_owned(f"scene:{world}", bypass=False)

    @staticmethod
    def _slots(g: "GameService") -> tuple[int, str]:
        """(bu kurulumdaki yuva sayısı, ek arsa paketi durumu). Ek yuvalar yalnız gerçek pakette ("active")."""
        state = g.feature_pack(PACK_PLOTS)
        return (MAX_PLOT_SLOTS if state == "active" else MAX_PLOTS), state

    @staticmethod
    def _rid(data: dict[str, Any], route: str) -> str | None:
        raw = data.get("client_request_id")
        if raw is None or raw == "":
            return None
        if not isinstance(raw, str) or len(raw) > 80:
            raise ExpanseError(400, "client_request_id en çok 80 karakterlik metin olmalı")
        return f"{route}:{raw}"

    @staticmethod
    def _replayed(db: "GameDB", rid: str | None) -> dict[str, Any] | None:
        if not rid:
            return None
        row = db.one("SELECT response FROM expanse_requests WHERE request_id=?", rid)
        return None if row is None else {**json.loads(row["response"]), "already": True}

    @staticmethod
    def _remember(db: "GameDB", rid: str | None, resp: dict[str, Any], now: float) -> None:
        if rid:
            db.exec("INSERT OR IGNORE INTO expanse_requests(request_id,response,ts) VALUES(?,?,?)", rid,
                    json.dumps(resp, ensure_ascii=False), now)

    @staticmethod
    def _ordinal(db: "GameDB") -> int:
        """Gerçek (yönetici olmayan) parsel sayısı: sıradaki parselin merdiven sırası."""
        return int(db.scalar("SELECT COUNT(*) FROM expanse_plots WHERE source != 'admin'"))

    @staticmethod
    def _plot_view(row: Any, *, full: bool = False) -> dict[str, Any]:
        body = json.loads(row["body"] or "{}")
        out = {"id": row["id"], "slot": int(row["slot"]), "color": row["color"], "name": row["name"],
               "source": row["source"], "price": int(row["price"]), "trial": row["source"] == "admin",
               "claimed_at": row["claimed_at"], "updated": row["updated"],
               "edits": len(body.get("edits", [])), "prefabs": len(body.get("prefabs", []))}
        if full:
            out["body"] = {"edits": body.get("edits", []), "prefabs": body.get("prefabs", [])}
        return out

    def _visible(self, g: "GameService", world: str) -> list[Any]:
        admin = g.admin()
        rows = g.db.q("SELECT * FROM expanse_plots WHERE world=? ORDER BY slot", world)
        return [r for r in rows if admin or r["source"] != "admin"]

    def _row(self, g: "GameService", world: str) -> Any:
        return g.db.one("SELECT * FROM expanse_worlds WHERE world=?", world)

    @staticmethod
    def _explored(blob: bytes | None) -> bytes:
        b = bytes(blob or b"")
        return b.ljust(EXPLORED_BYTES, b"\0")[:EXPLORED_BYTES]

    # ------------------------------------------------------------------ okuma (MCP okuyabilir)
    def state(self, world: Any) -> dict[str, Any]:
        world = self._world(world)
        g = self.game
        db = g.db
        level, balance, admin = g.office_level(), db.balance(), g.admin()
        row = self._row(g, world)
        explored = self._explored(row["explored"] if row else None)
        plots = [self._plot_view(r) for r in self._visible(g, world)]
        index = self._ordinal(db)
        price, min_level = ladder(index)
        taken = {p["slot"] for p in plots}
        slots, pack = self._slots(g)
        free_slots = [s for s in range(slots) if s not in taken]
        is_open = self._scene_open(g, world)
        reason = None
        if not free_slots:
            reason = "full"
        elif not admin and not is_open:
            reason = "locked"
        elif not admin and level < min_level:
            reason = "level"
        elif not admin and balance < price:
            reason = "coins"
        return {
            "world": world, "seed": (int(row["seed"]) if row and row["seed"] is not None else None),
            "radius": radius_for(level), "office_level": level, "balance": balance, "admin": admin, "open": is_open,
            "max_plots": slots, "colors": list(PLOT_COLORS), "plots": plots,
            "extra_slots": {"pack": PACK_PLOTS, "state": pack or None, "base": MAX_PLOTS, "with_pack": MAX_PLOT_SLOTS},
            "next": {"index": index, "price": 0 if admin else price, "min_level": min_level, "can_claim": reason is None,
                     "reason": reason},
            "ladder": [{"price": p, "min_level": m} for p, m in LADDER],
            "explored": base64.b64encode(explored).decode("ascii"),
            "explored_count": sum(bin(b).count("1") for b in explored),
            "explored_span": EXPLORED_SPAN, "explored_offset": EXPLORED_OFFSET,
        }

    def plot(self, world: Any, plot_id: str) -> dict[str, Any]:
        world = self._world(world)
        g = self.game
        if not PLOT_ID_RE.match(plot_id or ""):
            raise ExpanseError(404, "Parsel yok")
        row = g.db.one("SELECT * FROM expanse_plots WHERE id=? AND world=?", plot_id, world)
        if row is None or (row["source"] == "admin" and not g.admin()):
            raise ExpanseError(404, "Parsel yok")
        return self._plot_view(row, full=True)

    # ------------------------------------------------------------------ yazma (yalnız kullanıcı)
    def claim(self, world: Any, data: Any) -> dict[str, Any]:
        """Sahiplen `{slot, confirm, color?, name?, client_request_id?}`. Seviye ve jeton denetimi; harcama defterden."""
        if not isinstance(data, dict):
            raise ExpanseError(400, "Gövde bir nesne olmalı")
        world = self._world(world)
        slot = data.get("slot")
        if not _int_in(slot, 0, MAX_PLOT_SLOTS):
            raise ExpanseError(400, "slot 0–11 arasında tam sayı olmalı")
        if data.get("confirm") is not True:
            raise ExpanseError(400, "Parsel sahiplenmek için açık onay gerekli (confirm: true)")
        name = _name(data.get("name"))
        color = _color(data.get("color"), PLOT_COLORS[slot % len(PLOT_COLORS)])
        rid = self._rid(data, f"claim:{world}")
        self._rate()
        g = self.game
        if slot >= MAX_PLOTS and self._slots(g)[0] <= slot:
            # Free ve önizleme: ek yuva yok (eski davranış: 0–11 dışı 400)
            raise ExpanseError(400, "slot 0–11 arasında tam sayı olmalı")
        db = g.db
        now = time.time()
        with g._lock, db.tx():
            if (hit := self._replayed(db, rid)) is not None:
                return hit
            admin = g.admin()
            row = db.one("SELECT * FROM expanse_plots WHERE world=? AND slot=?", world, slot)
            if row is not None and (row["source"] != "admin" or admin):
                return {"ok": True, "already": True, "plot": self._plot_view(row), "balance": db.balance(),
                        "admin": admin, "spent": 0}
            if not admin and not self._scene_open(g, world):
                raise ExpanseError(403, "Bu sahne açık değil")
            index = self._ordinal(db)
            price, min_level = ladder(index)
            if admin:
                source, price = "admin", 0
            else:
                if g.office_level() < min_level:
                    raise ExpanseError(400, f"Bu parsel için ofis seviyesi {min_level} gerekir")
                balance = db.balance()
                if balance < price:
                    raise ExpanseError(400, f"Yetersiz jeton: {price} gerekli, bakiye {balance}")
                source = "free" if price == 0 else "coins"
            if row is not None:  # gerçek sahiplenme yönetici deneme parselinin yerini alır
                db.exec("DELETE FROM expanse_plots WHERE id=?", row["id"])
            if price > 0 and not db.add_coins(f"expanse:plot:{world}:{slot}", now, R.day_of(now), -price, "expanse_plot",
                                               f"Parsel {slot + 1} (−{price} jeton)", ref=f"{world}:{slot}"):
                raise ExpanseError(409, "Bu parsel için harcama zaten yazılmış")
            pid = f"p_{secrets.token_hex(6)}"
            db.exec("INSERT INTO expanse_plots(id,world,slot,source,price,color,name,body,claimed_at,updated) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?)", pid, world, slot, source, price, color, name, "{}", now, now)
            db.exec("INSERT INTO expanse_worlds(world,seed,explored,created,updated) VALUES(?,NULL,x'',?,?) "
                    "ON CONFLICT(world) DO UPDATE SET updated=excluded.updated", world, now, now)
            if not admin:
                db.feed(now, "plot", "human", "me", f"Parsel {slot + 1} sahiplenildi", -price or None,
                        {"world": world, "slot": slot})
            plot = self._plot_view(db.one("SELECT * FROM expanse_plots WHERE id=?", pid))
            resp = {"ok": True, "plot": plot, "balance": db.balance(), "admin": admin, "spent": price}
            self._remember(db, rid, resp, now)
        return resp

    def put_plot(self, world: Any, plot_id: str, data: Any) -> dict[str, Any]:
        """Parsel gövdesi (tam): şema ve inşa kuralları doğrulanır, ≤ 64 KB, dünya toplamı ≤ 6000 blok, kilitli dekor yeni
        yerleştirilemez. Ödül yazılmaz. Deneme parselinde (yönetici / test modu) doğrulanır ama yazılmaz."""
        world = self._world(world)
        if not PLOT_ID_RE.match(plot_id or ""):
            raise ExpanseError(404, "Parsel yok")
        body = validate_body(data)
        name = _name(data.get("name")) if "name" in data else None
        color = _color(data["color"]) if "color" in data else None
        self._rate()
        g = self.game
        db = g.db
        now = time.time()
        with g._lock, db.tx():
            row = db.one("SELECT * FROM expanse_plots WHERE id=? AND world=?", plot_id, world)
            if row is None or (row["source"] == "admin" and not g.admin()):
                raise ExpanseError(404, "Parsel yok")
            others = sum(len(json.loads(r["body"] or "{}").get("edits", []))
                         for r in db.q("SELECT body FROM expanse_plots WHERE world=? AND id!=?", world, plot_id))
            if others + len(body["edits"]) > MAX_EDITS_TOTAL:
                raise ExpanseError(422, "Dünyadaki parsel blok toplamı 6000 sınırını aşıyor")
            prev = json.loads(row["body"] or "{}")
            extra = B.added_pack_blocks(prev, body)
            if extra:
                pack = g.feature_pack(PACK_BUILDER)
                # gerçek paket ya da (önizleme + kaydedilmeyen deneme parseli); var olan paket blokları hiç kilitlenmez
                if not (pack == "active" or (pack == "preview" and row["source"] == "admin")):
                    raise ExpanseError(403, f"Bu blok rengi yapı malzemeleri paketiyle gelir: {extra[0]}")
            hit = B.added_locked_decor(self.studio, prev, body)
            if hit is not None:
                from studio.worlds.locks import DECOR_LOCKED  # noqa: PLC0415 ( ile aynı ileti)
                raise ExpanseError(403, DECOR_LOCKED.format(*hit))
            if row["source"] == "admin":
                # E2 kuralı: deneme parseli kalıcı değildir — inşa doğrulanır, yazılmaz (arayüz oturum boyunca gösterir)
                out = {**self._plot_view(row, full=True), "body": body}
                return {"ok": True, "persisted": False, "plot": out}
            db.exec("UPDATE expanse_plots SET body=?, name=COALESCE(?, name), color=COALESCE(?, color), updated=? WHERE id=?",
                    json.dumps(body, ensure_ascii=False, separators=(",", ":")), name, color, now, plot_id)
            out = self._plot_view(db.one("SELECT * FROM expanse_plots WHERE id=?", plot_id), full=True)
        return {"ok": True, "persisted": True, "plot": out}

    def explored(self, world: Any, data: Any) -> dict[str, Any]:
        """Keşfedilen parsel bit kümesi (base64, 512 bayt; birleşim). Ödül yok; yönetici modunda kaydedilmez."""
        if not isinstance(data, dict):
            raise ExpanseError(400, "Gövde bir nesne olmalı")
        world = self._world(world)
        raw = data.get("bits")
        if not isinstance(raw, str) or len(raw) > 1024:
            raise ExpanseError(400, "bits base64 bit kümesi olmalı")
        try:
            bits = base64.b64decode(raw, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ExpanseError(400, "bits base64 bit kümesi olmalı") from exc
        if len(bits) > EXPLORED_BYTES:
            raise ExpanseError(400, "bits base64 bit kümesi olmalı")
        self._rate()
        g = self.game
        db = g.db
        if g.admin():
            return {"ok": True, "recorded": False, "admin": True}
        now = time.time()
        with g._lock, db.tx():
            row = self._row(g, world)
            cur = self._explored(row["explored"] if row else None)
            new = bytes(a | b for a, b in zip(cur, self._explored(bits)))
            db.exec("INSERT INTO expanse_worlds(world,seed,explored,created,updated) VALUES(?,NULL,?,?,?) "
                    "ON CONFLICT(world) DO UPDATE SET explored=excluded.explored, updated=excluded.updated",
                    world, new, now, now)
        return {"ok": True, "recorded": True, "admin": False, "explored_count": sum(bin(b).count("1") for b in new)}
