"""FREE-MAP-IP — ücretsiz harita ve sahnelerde IP riski ≥ 2 olan yapıların özgün "esinli yapı"ya dönüşümü için kimlik göçü.

Karar (CEO, 2026-10-25): korunan yapılar kendi genel adıyla anılır, gerçek ad/takma ad/marka kimliklerde de kullanılmaz
. Kimlik değişince eski kayıtlar kaybolmasın diye:

- `migrate(db)`: kullanıcının kayıtlı ilerlemesini (pasaport damgaları `walk_city`, keşifler `walk_explore`, simge vizeleri
  `walk_visas`) eski kimlikten yenisine taşır. İdempotenttir (ikinci çağrıda 0 satır); yeni kimlik zaten varsa eski satır
  silinir (ilk kayıt korunur, damga iki kez sayılmaz). Kilitliyken alınmış durakların `locked_for` semt listesi ve
  `walk_city.district` sütunu da çevrilir. Göç sayısı `game_meta` içinde `walk:ip_migration` anahtarına yazılır (kanıt).
- `alias(id)`: eski bir istemcinin (önbellekteki eski arayüz) gönderdiği eski kimliği yenisine çevirir; yazma uçları
  doğrulamadan önce çağırır. Böylece eski sekme açık kalsa da damga doğru kimliğe yazılır.

Arayüz tarafında eşlem gerekmez: ilerleme yalnız sunucuda tutulur (tarayıcıda damga önbelleği yoktur).
`frontend/scripts/free_map_ip.test.mjs` aşağıdaki IP-RENAMES ve IP-BLOCKLIST bloklarını işaretleri arasından okur.
"""

from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING, Any

from studio._edition import EDITION

if TYPE_CHECKING:
    from studio.game.db import GameDB

# Tam kimlik eşlemi (eski → yeni). Şehir semti yeniden adlandırması önek kuralıyla (`DISTRICT_RENAMES`) yapılır.
# IP-RENAMES-START
IP_RENAMES: dict[str, str] = {}
# (şehir, eski semt) → yeni semt: `city:<şehir>:<eski>` ve `city:<şehir>:<eski>:*` kimlikleri yeni semte taşınır
DISTRICT_RENAMES: dict[tuple[str, str], str] = {}
if EDITION == "full":  # kaldırılan şehirlerin kimlik göçü (studio/full; ön yüz free_map_ip.test.mjs bloğu orada da okur)
    from studio.full.walk_misc import DISTRICT_RENAMES_EXTRA, IP_RENAMES_EXTRA
    IP_RENAMES.update(IP_RENAMES_EXTRA)
    DISTRICT_RENAMES.update(DISTRICT_RENAMES_EXTRA)
# IP-RENAMES-END

# Ücretsiz harita verisinde, yer adlarında ve arayüz metninde geçmemesi gereken gerçek adlar, takma adlar ve markalar
# (küçük harf, alt dize). Gerekçe ve kaynaklar:. Yalnız bu dosyada ve o belgede yazılır.
# IP-BLOCKLIST-START
IP_BLOCKLIST: tuple[str, ...] = (
    "empire", "chrysler", "louvre", "tuileries", "carrousel", "telefon kulübesi", "phone box", "phonebox",
    # DONME-DOLAP: körfez arenasının sahibi/işletmecisi şirket ve takım adı (marka); arena genel adla anılır
    "toyota", "alvark",
)
# IP-BLOCKLIST-END

META_KEY = "walk:ip_migration"
_CITY_ID = re.compile(r"^city:([a-z][a-z0-9_]*):([a-z][a-z0-9_]*)(:.*)?$")


def alias(id_: Any) -> Any:
    """Eski kimlik → yeni kimlik (bilinmeyen ya da zaten yeni kimlik aynen döner)."""
    if not isinstance(id_, str):
        return id_
    if id_ in IP_RENAMES:
        return IP_RENAMES[id_]
    m = _CITY_ID.match(id_)
    if m:
        city, district, tail = m.group(1), m.group(2), m.group(3) or ""
        new = DISTRICT_RENAMES.get((city, district))
        if new:
            return IP_RENAMES.get(f"city:{city}:{new}{tail}", f"city:{city}:{new}{tail}")
    return id_


def alias_district(city: Any, district: Any) -> Any:
    if isinstance(city, str) and isinstance(district, str):
        return DISTRICT_RENAMES.get((city, district), district)
    return district


def _move(db: "GameDB", table: str, col: str, old: str, new: str, extra: str = "", args: tuple[Any, ...] = ()) -> int:
    """`old` satırını `new`'e taşır. `new` zaten varsa iki kayıt birleşir: ilk bulunan (MIN(ts)) satır — ts, gün, jeton ve
    diğer sütunlarıyla — kalır, diğeri silinir (damga iki kez sayılmaz, ilk keşif kaybolmaz). Değişen satır sayısı."""
    if db.conn.execute(f"SELECT 1 FROM {table} WHERE {col}=?", (old,)).fetchone() is None:
        return 0
    other = db.conn.execute(f"SELECT ts FROM {table} WHERE {col}=?", (new,)).fetchone()
    if other is not None:
        mine = db.conn.execute(f"SELECT ts FROM {table} WHERE {col}=?", (old,)).fetchone()
        if mine[0] >= other[0]:
            db.conn.execute(f"DELETE FROM {table} WHERE {col}=?", (old,))
            return 1
        db.conn.execute(f"DELETE FROM {table} WHERE {col}=?", (new,))  # eski kayıt daha erken: o kalır, anahtarı yenilenir
    db.conn.execute(f"UPDATE {table} SET {col}=?{extra} WHERE {col}=?", (new, *args, old))
    return 1


def _tables(db: "GameDB") -> set[str]:
    return {r[0] for r in db.conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}


def migrate(db: "GameDB") -> dict[str, int]:
    """Kayıtlı ilerlemeyi yeni kimliklere taşır (idempotent). Döner: tablo başına taşınan satır sayısı."""
    counts = {"walk_city": 0, "walk_explore": 0, "walk_visas": 0}
    with db._lock:
        own = not db.conn.in_transaction
        if own:
            db.conn.execute("BEGIN IMMEDIATE")
        try:
            _migrate(db, counts)
        except Exception:
            if own:
                db.conn.execute("ROLLBACK")
            raise
        if own:
            db.conn.execute("COMMIT")
    return counts


def _migrate(db: "GameDB", counts: dict[str, int]) -> None:
    tables = _tables(db)
    if "walk_city" in tables:
        cols = {r[1] for r in db.conn.execute("PRAGMA table_info(walk_city)").fetchall()}
        rows = db.conn.execute("SELECT id FROM walk_city").fetchall()
        for (old,) in rows:
            new = alias(old)
            if new == old:
                continue
            m = _CITY_ID.match(new)
            district = None if (":stop:" in new or not m) else m.group(2)
            counts["walk_city"] += _move(db, "walk_city", "id", old, new, ", district=?", (district,))
        if "locked_for" in cols:
            for rid, raw in db.conn.execute("SELECT id, locked_for FROM walk_city WHERE locked_for IS NOT NULL").fetchall():
                city = rid.split(":")[1] if rid.count(":") >= 2 else ""
                parts = [p for p in str(raw).split(",") if p]
                fixed = [alias_district(city, p) for p in parts]
                if fixed != parts:
                    db.conn.execute("UPDATE walk_city SET locked_for=? WHERE id=?", (",".join(fixed), rid))
                    counts["walk_city"] += 1
    if "walk_explore" in tables:
        for (old,) in db.conn.execute("SELECT id FROM walk_explore").fetchall():
            new = alias(old)
            if new != old:
                counts["walk_explore"] += _move(db, "walk_explore", "id", old, new)
    if "walk_visas" in tables:
        for (old,) in db.conn.execute("SELECT landmark FROM walk_visas").fetchall():
            new = alias(old)
            if new != old:
                counts["walk_visas"] += _move(db, "walk_visas", "landmark", old, new)
    total = sum(counts.values())
    if total and "game_meta" in tables:
        prev = db.conn.execute("SELECT value FROM game_meta WHERE key=?", (META_KEY,)).fetchone()
        log = json.loads(prev[0]) if prev and prev[0] else {}
        for k, v in counts.items():
            log[k] = int(log.get(k, 0)) + v
        db.conn.execute("INSERT OR REPLACE INTO game_meta(key, value) VALUES(?, ?)", (META_KEY, json.dumps(log)))
