"""Ontoloji destekli özellik grafı (SQLite + FTS5).

Tek yazma kapısı: upsert_node / link. Her yazım ontolojiye göre doğrulanır, aynı tür+anahtar
tek düğüme çözülür (varlık çözümleme). FTS5 dizini graf belleğinin hatırlama yoludur.
Çalıştırma olay günlüğü (run_events) zaman çizelgesi içindir; graf yapısının parçası değildir.

Eşzamanlılık (S15, 300 ajan):
- Yazmalar tek bağlantı (`conn`) + RLock üzerinden gider; `bulk` içinde commit sona ertelenir.
- Okumalar WAL sayesinde kilitsizdir: her iş parçacığı kendi salt okunur bağlantısını kullanır (`query_only`),
  böylece yazıcı okuyucuları, okuyucular da yazıcıyı bekletmez. Eski "tek bağlantı paylaşımı" bozulması
  (eşzamanlı imleç durumu) kökten ortadan kalkar; bellek içi (":memory:") veritabanında okumalar kilit altındadır.
- Yazma kilidini tutan iş parçacığı kendi yazdığını (henüz commit edilmemiş olsa da) okur: yazma içindeki okumalar
  yazıcı bağlantısından yapılır.
- Şema `IF NOT EXISTS` ile kurulur: var olan studio.db açılışta yerinde yükseltilir (yeni indeksler eklenir, veri
  korunur).

Değişiklik günlüğü (CDC, ürün sahibi C1 —):
- Her düğüm/kenar yazımı (`upsert_node`, `patch_node`, `retag`, `delete_node` + kademeli kenar silme, `link`, `unlink`,
  `delete_edges`, `restore_node_row`/`restore_edge_row`, `replace_node_content`) AYNI işlemde `graph_changes`'e bir satır
  ekler: seq (AUTOINCREMENT, tekrar kullanılmaz), op (insert/update/delete), kind (node/edge), tür, kimlik, kenarda
  src/dst, önce/sonra içerik özeti (anahtarlı BLAKE2b, veritabanına özgü anahtar; İÇERİK YOK), değişen anahtar adları, aktör/koşu/adım
  (`graph/cdc.py` bağlamı), işlem kimliği (txn), zaman. İçerik değişmeyen güncelleme günlüğe yazılmaz.
- Geri alınan işlem günlük satırı bırakmaz (aynı işlem); `bulk` dışında hata veren yazım da geri alınır.
- Commit sonrası `cdc_listener` (bkz. `graph/cdc.ChangeNotifier`) seq aralığı + sayımlarla çağrılır.
- Saklama: `cdc_max_rows` / `cdc_max_age_s` penceresi; budama her `CDC_PRUNE_EVERY` günlük satırında bir (ve açılışta),
  yazma kilidi altında ayrı küçük işlemle. Budanan son seq `graph_meta.cdc_floor`'dadır (imleç `resync_required`).
- Unutma `cdc_rotate_key` ile özet anahtarını değiştirir: eski özetler doğrulanamaz olur (kripto-kırpma).
- `run_events` (koşu zaman çizelgesi) graf durumu değildir; günlüğe girmez.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import os
import sqlite3
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

from studio.graph import cdc
from studio.ontology import Ontology, OntologyError

log = logging.getLogger("studio.graph.store")

SCHEMA = """
CREATE TABLE IF NOT EXISTS nodes (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL,
    key        TEXT NOT NULL,
    label      TEXT NOT NULL,
    props      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(type, key)
);
CREATE TABLE IF NOT EXISTS edges (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL,
    src        TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    dst        TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    weight     REAL NOT NULL DEFAULT 1,
    props      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(type, src, dst)
);
CREATE INDEX IF NOT EXISTS ix_nodes_type ON nodes(type, updated_at);
CREATE INDEX IF NOT EXISTS ix_edges_src ON edges(src, type);
CREATE INDEX IF NOT EXISTS ix_edges_dst ON edges(dst, type);
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    node_id UNINDEXED, type UNINDEXED, label, body,
    tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS run_events (
    run_id TEXT NOT NULL,
    seq    INTEGER NOT NULL,
    ts     REAL NOT NULL,
    type   TEXT NOT NULL,
    data   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_run_events ON run_events(run_id, seq);
-- S15 (Faz 5): liste uçları created_at'e göre sıralanır; sık json_extract süzgeçleri için ifade indeksleri.
-- (nodes(type,key) UNIQUE kısıtı zaten indekslidir.)
CREATE INDEX IF NOT EXISTS ix_nodes_type_created ON nodes(type, created_at);
CREATE INDEX IF NOT EXISTS ix_nodes_updated ON nodes(updated_at);
CREATE INDEX IF NOT EXISTS ix_nodes_reports_to ON nodes(type, json_extract(props, '$.reports_to'));
CREATE INDEX IF NOT EXISTS ix_nodes_team ON nodes(type, json_extract(props, '$.team'));
CREATE INDEX IF NOT EXISTS ix_nodes_status ON nodes(type, json_extract(props, '$.status'));
CREATE INDEX IF NOT EXISTS ix_nodes_hidden ON nodes(type, json_extract(props, '$.hidden'));
-- CDC (CEO C1): graf değişiklik günlüğü — içerik YOK (yalnız anahtarlı özetler ve özellik adları). Yalnız GraphStore yazar.
CREATE TABLE IF NOT EXISTS graph_changes (
    seq          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           REAL NOT NULL,
    txn          TEXT NOT NULL,
    op           TEXT NOT NULL,
    kind         TEXT NOT NULL,
    etype        TEXT NOT NULL,
    entity_id    TEXT NOT NULL,
    src          TEXT,
    dst          TEXT,
    before_hash  TEXT,
    after_hash   TEXT,
    hash_epoch   INTEGER NOT NULL DEFAULT 0,
    changed_keys TEXT,
    actor        TEXT NOT NULL,
    run_id       TEXT,
    step_id      TEXT
);
CREATE TABLE IF NOT EXISTS graph_meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);
"""

ORDERS = ("updated_at DESC", "created_at DESC", "label ASC", "created_at ASC", "updated_at ASC")
IN_CHUNK = 500  # IN (...) parametre öbeği (SQLite değişken sınırı çok üstte ama ifade uzunluğu makul kalsın)
MMAP_BYTES = 256 * 1024 * 1024  # okuyucu bağlantıları için mmap üst sınırı (dosya küçükse daha az kullanılır)
CHECKPOINT_EVERY = 200           # şu kadar commit'te bir WAL bakımı
WAL_RESTART_BYTES = 64 * 1024 * 1024  # WAL bu boyutu aşarsa RESTART checkpoint (dosya yeniden kullanılır)
CDC_FP_EVERY = 256               # şu kadar günlük satırında bir veritabanı-dışı parmak izi yazılır
CDC_MAX_ROWS = 200_000           # günlük saklama: en çok satır (ayar: graph.cdc.max_rows)
CDC_MAX_AGE_DAYS = 30.0          # günlük saklama: en çok yaş (ayar: graph.cdc.max_age_days)
CDC_PRUNE_EVERY = 1000           # şu kadar günlük satırında bir budama (amorti)
CDC_HASH_HEX = 24                # özet uzunluğu (96 bit)
CDC_INSERT = ("INSERT INTO graph_changes(ts,txn,op,kind,etype,entity_id,src,dst,before_hash,after_hash,hash_epoch,"
              "changed_keys,actor,run_id,step_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class GraphStore:
    def __init__(self, db_path: str | Path, ontology: Ontology, anchor_dir: str | Path | None = None):
        self.path = Path(db_path)
        self._anchor_dir = Path(anchor_dir) if anchor_dir else None  # veri klasörü DIŞI parmak izi dizini
        self._memory = str(db_path) == ":memory:"
        if not self._memory:
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self.ontology = ontology
        self._lock = threading.RLock()
        self._writer_tid: int | None = None
        self._writer_depth = 0
        self._bulk_depth = 0
        self._commits = 0
        self._closed = False
        # unutma mezar kaydı bekçisi (`graph/forget.py` kurar). upsert_node'a giren özellikleri görür; unutulmuş
        # bir kaydın geri yüklenen/içe aktarılan kopyasını `ForgottenError` ile reddeder ya da metnini karartır.
        self.write_guard: Any = None
        self._readers = threading.local()
        self._reader_conns: list[sqlite3.Connection] = []
        self._readers_lock = threading.Lock()
        self.conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA busy_timeout=5000")
        self.conn.execute("PRAGMA journal_mode=WAL")
        # NORMAL: WAL'da commit başına fsync yok (yalnızca checkpoint'te); elektrik kesintisinde son işlemler
        # kaybolabilir ama veritabanı bozulmaz. Windows'ta commit süresini ~10 ms'den <1 ms'ye indirir.
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.execute(f"PRAGMA journal_size_limit={WAL_RESTART_BYTES}")  # sıfırlanan WAL dosyası küçülür
        self.conn.execute("PRAGMA foreign_keys=ON")
        # silinen/üzerine yazılan içerik sayfada ve serbest sayfalarda sıfırlanır; unutulan metin ham
        # dosyada okunamaz. Maliyet: silme/güncellemede serbest kalan baytlar da yazılır (küçük ek G/Ç).
        self.conn.execute("PRAGMA secure_delete=ON")
        # CDC: commit sonrası dinleyici + bekleyen işlem özeti (yazma kilidi altında değişir)
        self.cdc_listener: Any = None
        self.cdc_max_rows = CDC_MAX_ROWS
        self.cdc_max_age_s = CDC_MAX_AGE_DAYS * 86400.0
        self._txn: str | None = None
        self._txn_rows: list[tuple[int, str, str]] = []  # (seq, kind, op) — commit sonrası özet için
        self._cdc_since_prune = 0
        self._cdc_since_fp = 0
        # Günlüğün bu açılışta yeni kurulduğu `graph_meta.cdc_journal` yokluğundan anlaşılır (bkz. `_cdc_init`).
        self.conn.executescript(SCHEMA)
        self._cdc_init()
        self.conn.commit()
        self._cdc_verify_restore()  # yedekten dönen veritabanı -> yeni journal_id
        self._cdc_prune()

    # ---------------- bağlantı yönetimi ----------------
    def _read_conn(self) -> sqlite3.Connection:
        """Bu iş parçacığının salt okunur bağlantısı (WAL okuyucusu; yazıcıyı beklemez)."""
        conn = getattr(self._readers, "conn", None)
        if conn is not None and self._closed:
            # B-18: depo kapatıldıktan sonra bu iş parçacığının bağlantısı ilk okumada kendi iş parçacığında kapatılır
            # (başka iş parçacığından kapatmak çökmesine yol açıyordu); okuma kapalı veritabanı gibi reddedilir.
            with contextlib.suppress(sqlite3.Error):
                conn.close()
            with contextlib.suppress(AttributeError):
                del self._readers.conn
            raise sqlite3.ProgrammingError("Cannot operate on a closed database.")
        if conn is None:
            if self._closed:
                raise sqlite3.ProgrammingError("Cannot operate on a closed database.")
            conn = sqlite3.connect(str(self.path), check_same_thread=False, isolation_level=None)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA busy_timeout=5000")
            conn.execute("PRAGMA query_only=ON")  # bu bağlantıdan yazma denemesi hata verir
            # bellek eşlemeli okuma: iş parçacığı başına soğuk sayfa önbelleği yerine paylaşılan OS önbelleği
            conn.execute(f"PRAGMA mmap_size={MMAP_BYTES}")
            self._readers.conn = conn
            with self._readers_lock:
                self._reader_conns.append(conn)
        return conn

    @contextlib.contextmanager
    def _read(self) -> Iterator[sqlite3.Connection]:
        """Okuma bağlantısı: yazma kilidini tutan iş parçacığı yazıcı bağlantısını (kendi yazdığını görür),
        bellek içi veritabanı kilit altında tek bağlantıyı, diğerleri kilitsiz salt okunur bağlantıyı kullanır."""
        if self._writer_tid == threading.get_ident():
            yield self.conn
        elif self._memory:
            with self._lock:
                yield self.conn
        else:
            yield self._read_conn()

    @contextlib.contextmanager
    def _write(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._writer_depth += 1
            self._writer_tid = threading.get_ident()
            try:
                yield self.conn
            except BaseException:
                # CDC: `bulk()` dışında yarıda kalan yazım geri alınır (eskiden açık işlem bir sonraki commit'le
                # kalıcılaşıyordu). Böylece veri ve günlük satırı ya birlikte kalır ya birlikte gider.
                if self._writer_depth == 1 and self._bulk_depth == 0:
                    self._rollback()
                raise
            finally:
                self._writer_depth -= 1
                if self._writer_depth == 0:
                    self._writer_tid = None

    def _commit(self) -> None:
        if self._bulk_depth == 0:
            self._commit_now()
            self._commits += 1
            if self._commits % CHECKPOINT_EVERY == 0:
                self._checkpoint()

    def _commit_now(self) -> None:
        """Gerçek commit + CDC sonrası işleri (özet bildirimi, amorti budama). Yazma kilidi altında çağrılır."""
        self.conn.commit()
        self._cdc_committed()

    def _rollback(self) -> None:
        with contextlib.suppress(sqlite3.Error):
            self.conn.rollback()
            self._cdc_load_key()  # geri alınan cdc_rotate_key: bellekteki anahtar da eskiye döner
        self._txn, self._txn_rows = None, []

    # ---------------- CDC günlüğü ----------------
    def _cdc_init(self) -> None:
        """Özet anahtarı, günlük kimliği ve taban (floor). Var olan (günlüksüz) dolu bir veritabanı yükseltilirken taban 1
        yapılır: önceki durum günlükte yok, `after=0` imleci `resync_required` alır (önce anlık görüntü)."""
        meta = dict(self.conn.execute("SELECT k, v FROM graph_meta").fetchall())
        if "cdc_key" not in meta:
            self.conn.execute("INSERT OR REPLACE INTO graph_meta(k, v) VALUES('cdc_key', ?)", (os.urandom(32).hex(),))
            self.conn.execute("INSERT OR REPLACE INTO graph_meta(k, v) VALUES('cdc_epoch', '0')")
        if "cdc_journal" not in meta:
            self.conn.execute("INSERT OR REPLACE INTO graph_meta(k, v) VALUES('cdc_journal', ?)", (uuid.uuid4().hex,))
            self.conn.execute("INSERT OR REPLACE INTO graph_meta(k, v) VALUES('cdc_since', ?)", (now_iso(),))
            floor = 0
            if self.conn.execute("SELECT 1 FROM nodes LIMIT 1").fetchone() is not None:
                floor = 1
                self.conn.execute("INSERT INTO sqlite_sequence(name, seq) VALUES('graph_changes', 1)")
            self.conn.execute("INSERT OR REPLACE INTO graph_meta(k, v) VALUES('cdc_floor', ?)", (str(floor),))
        self._cdc_load_key()

    def _cdc_load_key(self) -> None:
        meta = dict(self.conn.execute("SELECT k, v FROM graph_meta WHERE k IN ('cdc_key','cdc_epoch')").fetchall())
        self._cdc_key = bytes.fromhex(meta["cdc_key"])
        self._cdc_epoch = int(meta.get("cdc_epoch") or 0)

    def _cdc_hash(self, *parts: Any) -> str:
        msg = "\x1f".join("" if p is None else str(p) for p in parts).encode("utf-8", "surrogatepass")
        # anahtarlı BLAKE2b (RFC 7693 MAC kipi): HMAC-SHA256 ile aynı güvenlik sınıfı, ~3x hızlı (yazma yolunda)
        return hashlib.blake2b(msg, key=self._cdc_key, digest_size=CDC_HASH_HEX // 2).hexdigest()

    def _node_hash(self, label: Any, props_json: str) -> str:
        return self._cdc_hash("n", label, props_json)

    def _edge_hash(self, weight: Any, props_json: str) -> str:
        return self._cdc_hash("e", float(weight or 0), props_json)

    def _journal(self, op: str, kind: str, etype: str, entity_id: str, *, before: str | None = None,
                 after: str | None = None, keys: Iterable[str] | None = None, src: str | None = None,
                 dst: str | None = None) -> None:
        """Günlük satırı — çağıran yazma kilidini tutar ve aynı işlemde veri satırını yazmıştır."""
        if self._txn is None:
            self._txn = uuid.uuid4().hex[:16]
        ctx = cdc.current()
        cur = self.conn.execute(CDC_INSERT, (
            time.time(), self._txn, op, kind, etype, entity_id, src, dst, before, after, self._cdc_epoch,
            json.dumps(sorted(keys), ensure_ascii=False) if keys is not None else None,
            ctx.actor, ctx.run_id, ctx.step_id))
        self._txn_rows.append((int(cur.lastrowid or 0), kind, op))

    def _journal_edge_deletes(self, rows: Iterable[sqlite3.Row]) -> None:
        for e in rows:
            self._journal("delete", "edge", e["type"], e["id"], before=self._edge_hash(e["weight"], e["props"]),
                          src=e["src"], dst=e["dst"])

    def _cdc_committed(self) -> None:
        rows, self._txn, self._txn_rows = self._txn_rows, None, []
        if not rows:
            return
        self._cdc_since_prune += len(rows)
        self._cdc_since_fp += len(rows)
        listener = self.cdc_listener
        if listener is not None:
            counts: dict[str, dict[str, int]] = {"nodes": {}, "edges": {}}
            for _seq, kind, op in rows:
                bucket = counts["nodes" if kind == "node" else "edges"]
                bucket[op] = bucket.get(op, 0) + 1
            try:
                listener({"first_seq": rows[0][0], "last_seq": rows[-1][0], "rows": len(rows), **counts})
            except Exception:  # noqa: BLE001 - bildirim yan etkidir; yazımı etkilemez
                log.exception("graf CDC dinleyicisi hata verdi")
        if self._cdc_since_prune >= CDC_PRUNE_EVERY:
            self._cdc_prune()
        if self._cdc_since_fp >= CDC_FP_EVERY:
            self._cdc_write_fp()

    # ---- veritabanı dışı parmak izi (geri yükleme algılama) ----
    @property
    def _cdc_fp_path(self) -> Path:
        return Path(str(self.path) + ".cdcfp")

    @property
    def _cdc_anchor_path(self) -> Path:
        """parmak izinin VERİ KLASÖRÜ DIŞINDAki kopyası. Klasör bütün olarak (db + yan dosya) yedekten dönse de bu
        dosya dönmez. Dizin: `anchor_dir` (Studio: kullanıcı durum dizini) → `STUDIO_STATE_DIR` → sistem geçici dizini.
        Ad, veritabanı yolunun özetidir (farklı veri dizinleri karışmaz)."""
        base = self._anchor_dir or (Path(os.environ["STUDIO_STATE_DIR"]).expanduser()
                                    if os.environ.get("STUDIO_STATE_DIR") else Path(tempfile.gettempdir()) / "voxcrew-cdc")
        key = hashlib.sha1(str(self.path.resolve()).lower().encode("utf-8", "surrogatepass")).hexdigest()[:24]
        return base / f"{key}.cdcfp"

    @staticmethod
    def _cdc_row_fp(row: Any) -> str:
        return hashlib.sha1(f"{row[0]!r}|{row[1]}|{row[2]}|{row[3]}".encode("utf-8", "surrogatepass")).hexdigest()

    def _cdc_fingerprint(self) -> dict[str, Any]:
        head = self._cdc_head(self.conn)
        row = self.conn.execute("SELECT ts, txn, op, entity_id FROM graph_changes WHERE seq=?", (head,)).fetchone() \
            if head else None
        return {"journal": self._meta(self.conn, "cdc_journal"), "head": head,
                "fp": self._cdc_row_fp(row) if row is not None else ""}

    def _cdc_write_fp(self) -> None:
        """Günlük kimliği + head + son satır özetini veritabanının YANINA (`.cdcfp`) ve veri klasörü DIŞINA (anchor)
        yazar. Açılışta karşılaştırılır (`_cdc_verify_restore`). En iyi çaba: yazılamazsa günlük etkilenmez."""
        if self._memory:
            return
        self._cdc_since_fp = 0
        data = json.dumps(self._cdc_fingerprint())
        for target in (self._cdc_fp_path, self._cdc_anchor_path):
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                tmp = Path(str(target) + ".tmp")
                tmp.write_text(data, "utf-8")
                os.replace(tmp, target)
            except (OSError, sqlite3.Error):
                log.warning("graf CDC parmak izi yazılamadı: %s", target.name, exc_info=True)

    def _cdc_stale(self, path: Path, cur: dict[str, Any]) -> bool:
        """Yazılmış parmak izi bu veritabanıyla uyuşmuyor mu (aynı `journal_id`'de head geride / son satır başka)?"""
        try:
            side = json.loads(path.read_text("utf-8")) if path.is_file() else None
        except (OSError, ValueError):
            return False
        if not isinstance(side, dict) or side.get("journal") != cur["journal"]:
            return False
        old_head = int(side.get("head") or 0)
        if cur["head"] < old_head:
            return True
        if old_head > 0 and side.get("fp"):
            row = self.conn.execute("SELECT ts, txn, op, entity_id FROM graph_changes WHERE seq=?",
                                    (old_head,)).fetchone()
            return row is not None and self._cdc_row_fp(row) != side["fp"]
        return False

    def _cdc_verify_restore(self) -> None:
        """Açılışta: yan dosya YA DA veri klasörü dışındaki parmak izi günlükle uyuşmuyorsa veritabanı yedekten dönmüş
        demektir -> `cdc_reset_journal()`. Parmak izi yoksa (ilk açılış/yükseltme) yalnız yazılır."""
        if self._memory:
            return
        try:
            cur = self._cdc_fingerprint()
            if any(self._cdc_stale(path, cur) for path in (self._cdc_fp_path, self._cdc_anchor_path)):
                log.warning("graf CDC: veritabanı yedekten dönmüş görünüyor; journal_id yenileniyor")
                self.cdc_reset_journal()
        except (OSError, ValueError, TypeError, sqlite3.Error):
            log.warning("graf CDC parmak izi doğrulanamadı", exc_info=True)
        self._cdc_write_fp()

    def cdc_reset_journal(self) -> str:
        """Günlük kimliğini yeniler ve tabanı head'e çeker: eski imleçli her istemci `resync_required` alır (anlık
        görüntü + head). Veritabanı yedekten dönünce / dışarıdan içe aktarılınca (stüdyonun kendi yolları ve açılış
        algılaması) çağrılır. seq sayacı SIFIRLANMAZ. Dönüş: yeni `journal_id`."""
        with self._write() as conn:
            jid = uuid.uuid4().hex
            head = self._cdc_head(conn)
            n = int(self._meta(conn, "cdc_restores") or 0) + 1
            for k, v in (("cdc_journal", jid), ("cdc_since", now_iso()), ("cdc_floor", str(head)),
                         ("cdc_restores", str(n))):
                conn.execute("INSERT OR REPLACE INTO graph_meta(k, v) VALUES(?, ?)", (k, v))
            self._commit()
        self._cdc_write_fp()
        return jid

    def _cdc_prune(self) -> int:
        """Saklama penceresi dışındaki satırları siler (ayrı küçük işlem). Dönüş: silinen satır sayısı."""
        with self._lock:
            if self._closed or self.conn.in_transaction:
                return 0  # açık bir işlemin ortasında budanmaz (bir sonraki commit'te yeniden)
            self._cdc_since_prune = 0
            try:
                head = self._cdc_head(self.conn)
                floor = int(self._meta(self.conn, "cdc_floor") or 0)
                cut = head - int(self.cdc_max_rows) if self.cdc_max_rows and self.cdc_max_rows > 0 else floor
                if self.cdc_max_age_s and self.cdc_max_age_s > 0:
                    row = self.conn.execute("SELECT seq FROM graph_changes WHERE ts >= ? ORDER BY seq LIMIT 1",
                                            (time.time() - float(self.cdc_max_age_s),)).fetchone()
                    cut = max(cut, (int(row[0]) - 1) if row is not None else head)
                if cut <= floor:
                    return 0
                n = self.conn.execute("DELETE FROM graph_changes WHERE seq <= ?", (cut,)).rowcount
                self.conn.execute("INSERT OR REPLACE INTO graph_meta(k, v) VALUES('cdc_floor', ?)", (str(cut),))
                self.conn.commit()
                return int(n)
            except sqlite3.Error:
                log.warning("graf CDC budaması başarısız (bir sonraki fırsatta yeniden)", exc_info=True)
                with contextlib.suppress(sqlite3.Error):
                    self.conn.rollback()
                return 0

    @staticmethod
    def _meta(conn: sqlite3.Connection, key: str) -> str | None:
        row = conn.execute("SELECT v FROM graph_meta WHERE k=?", (key,)).fetchone()
        return None if row is None else str(row[0])

    @staticmethod
    def _cdc_head(conn: sqlite3.Connection) -> int:
        row = conn.execute("SELECT seq FROM sqlite_sequence WHERE name='graph_changes'").fetchone()
        return int(row[0]) if row is not None and row[0] is not None else 0

    def set_cdc_retention(self, *, max_rows: int | None = None, max_age_days: float | None = None) -> None:
        """Saklama penceresi (ayar: graph.cdc.max_rows / graph.cdc.max_age_days). 0 = o sınır kapalı."""
        if max_rows is not None:
            self.cdc_max_rows = max(0, int(max_rows))
        if max_age_days is not None:
            self.cdc_max_age_s = max(0.0, float(max_age_days)) * 86400.0

    def prune_changes(self) -> int:
        """Saklama penceresini hemen uygular (bakım/test). Açık işlem varken 0 döner."""
        return self._cdc_prune()

    def cdc_rotate_key(self) -> int:
        """ unutma: özet anahtarını yeniler (eski özetler artık doğrulanamaz — kripto-kırpma). Çağıranın işlemine
        katılır (unutma `bulk` içinde; geri alınırsa eski anahtar geri yüklenir). Dönüş: yeni özet dönemi."""
        with self._write() as conn:
            epoch = self._cdc_epoch + 1
            conn.execute("INSERT OR REPLACE INTO graph_meta(k, v) VALUES('cdc_key', ?)", (os.urandom(32).hex(),))
            conn.execute("INSERT OR REPLACE INTO graph_meta(k, v) VALUES('cdc_epoch', ?)", (str(epoch),))
            self._cdc_load_key()
            self._commit()
            return epoch

    def changes(self, *, after: int = 0, limit: int = 500, journal: str | None = None) -> dict[str, Any]:
        """İmleç okuması: `after` sonrası en çok `limit` satır (içerik yok). `resync_required`: imleç tabanın (budanan son
        seq) gerisinde ya da günlük başından ileride (başka/geri yüklenmiş veritabanı) → anlık görüntü + `head`."""
        after, limit = max(0, int(after)), max(1, min(int(limit), 5000))
        with self._read() as conn:
            # head, taban ve satırlar TEK okuma işleminde (aynı anlık görüntü). Okuyucu bağlantıları otomatik
            # işlemlidir: ayrı ifadeler ayrı anlık görüntü görür, arada budama commit'lenirse sessiz boşluk olurdu.
            began = False
            try:
                conn.execute("BEGIN")
                began = True
            except sqlite3.OperationalError:  # zaten işlemde (yazıcı iş parçacığı): kendi görünümü tutarlı
                pass
            try:
                head = self._cdc_head(conn)
                meta = dict(conn.execute("SELECT k, v FROM graph_meta WHERE k IN "
                                         "('cdc_floor','cdc_journal','cdc_epoch','cdc_since','cdc_restores')").fetchall())
                floor = int(meta.get("cdc_floor") or 0)
                base = {"after": after, "head": head, "floor": floor, "journal_id": meta.get("cdc_journal"),
                        "journal_epoch": int(meta.get("cdc_restores") or 0),
                        "since": meta.get("cdc_since"), "hash_epoch": int(meta.get("cdc_epoch") or 0),
                        "retention": {"max_rows": self.cdc_max_rows, "max_age_days": self.cdc_max_age_s / 86400.0}}
                # `journal`: istemcinin sakladığı journal_id; farklıysa (veritabanı geri yüklendi / değişti) imleç geçersiz
                if after < floor or after > head or (journal and journal != meta.get("cdc_journal")):
                    return {**base, "changes": [], "next": head, "more": False, "resync_required": True}
                rows = conn.execute("SELECT * FROM graph_changes WHERE seq > ? ORDER BY seq LIMIT ?",
                                    (after, limit + 1)).fetchall()
                if rows and int(rows[0]["seq"]) > after + 1:  # savunma: günlükte boşluk -> imleç güvenilmez, yeniden eşitle
                    return {**base, "changes": [], "next": head, "more": False, "resync_required": True}
            finally:
                if began:
                    with contextlib.suppress(sqlite3.Error):
                        conn.execute("COMMIT")
        more = len(rows) > limit
        rows = rows[:limit]
        out = [{"seq": r["seq"], "ts": r["ts"], "txn": r["txn"], "op": r["op"], "kind": r["kind"], "type": r["etype"],
                "id": r["entity_id"], "src": r["src"], "dst": r["dst"], "before_hash": r["before_hash"],
                "after_hash": r["after_hash"], "hash_epoch": r["hash_epoch"],
                "changed_keys": json.loads(r["changed_keys"]) if r["changed_keys"] else None,
                "actor": r["actor"], "run_id": r["run_id"], "step_id": r["step_id"]} for r in rows]
        return {**base, "changes": out, "next": out[-1]["seq"] if out else after, "more": more,
                "resync_required": False}

    def _checkpoint(self) -> None:
        """WAL bakımı (yazma kilidi altında): sürekli okuyucu varken WAL kendiliğinden sıfırlanamaz ve sınırsız
        büyür (ölçüm: 30 sn yoğun yazmada 240 MB). PASSIVE checkpoint okuyucuları bekletmez; dosya yine de
        WAL_RESTART_BYTES'ı aştıysa RESTART ile sıfırlanır (kısa okumaların bitmesini en çok 200 ms bekler)."""
        if self._memory:
            return
        try:
            self.conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
            wal = Path(str(self.path) + "-wal")
            if wal.exists() and wal.stat().st_size > WAL_RESTART_BYTES:
                self.conn.execute("PRAGMA busy_timeout=200")
                try:
                    self.conn.execute("PRAGMA wal_checkpoint(RESTART)")
                finally:
                    self.conn.execute("PRAGMA busy_timeout=5000")
        except sqlite3.Error:
            pass  # bakım başarısızsa bir sonraki denemede yeniden; veri etkilenmez

    def scrub_free_space(self, vacuum_max_bytes: int = 256 * 1024 * 1024) -> dict[str, Any]:
        """unutmadan sonra eski içerik dosyada kalmasın. FTS5 birleştirilir (eski bölütler serbest kalır ve
        `secure_delete` ile sıfırlanır), veritabanı `vacuum_max_bytes`'tan küçükse VACUUM (secure_delete açılmadan önce
        serbest kalmış eski sayfalar için), sonra `wal_checkpoint(TRUNCATE)` ile WAL'daki eski sayfa sürümleri silinir.
        Seyrek (yalnız kullanıcı unuttuğunda) çalışır; VACUUM veritabanı boyutuyla orantılı sürer."""
        out = {"fts_optimize": False, "vacuum": False, "wal_truncated": False}
        if self._memory:
            return {**out, "wal_truncated": True}  # bellek içi: WAL dosyası yok, bekleyen iş yok
        with self._write():
            with contextlib.suppress(sqlite3.Error):
                self._commit_now()
            try:
                self.conn.execute("INSERT INTO nodes_fts(nodes_fts) VALUES('optimize')")
                self.conn.commit()
                out["fts_optimize"] = True
            except sqlite3.Error:
                log.exception("FTS birleştirme başarısız")
            try:
                if Path(self.path).stat().st_size <= vacuum_max_bytes:
                    self.conn.execute("VACUUM")
                    out["vacuum"] = True
            except (OSError, sqlite3.Error):
                log.warning("VACUUM yapılamadı (meşgul); secure_delete + checkpoint ile devam")
        out["wal_truncated"] = self.wal_truncate()
        return out

    def wal_truncate(self, busy_ms: int = 500) -> bool:
        """`wal_checkpoint(TRUNCATE)`; okuyucu anlık görüntü tutuyorsa en çok `busy_ms` bekler ve False döner
        (çağıran yeniden dener). True = WAL tamamen aktarıldı ve dosya sıfırlandı (eski sayfa sürümleri silindi)."""
        if self._memory:
            return True
        with self._write():
            try:
                self.conn.execute(f"PRAGMA busy_timeout={max(0, int(busy_ms))}")
                try:
                    row = self.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
                finally:
                    self.conn.execute("PRAGMA busy_timeout=5000")
                ok = bool(row is not None and int(row[0]) == 0)
                if ok:
                    self._wipe_tail()
                return ok
            except sqlite3.Error:
                return False

    def _wipe_tail(self) -> None:
        """ (canlı deneme): VACUUM veritabanını küçültünce SQLite denetim noktasında dosyayı kısaltır; Windows'ta
        okuyucu bağlantıları dosyayı eşlemiş (mmap) olduğundan kısaltma sessizce başarısız olur ve mantıksal sonun
        ötesindeki eski sayfalar (unutulan içerik dahil) dosyada kalır. Yazma kilidi altında ve WAL boşken bu kuyruk
        kısaltılır; kısaltılamazsa sıfırla üzerine yazılır (SQLite mantıksal boyutun ötesini okumaz)."""
        try:
            size = int(self.conn.execute("PRAGMA page_count").fetchone()[0]) * \
                int(self.conn.execute("PRAGMA page_size").fetchone()[0])
            path = Path(self.path)
            phys = path.stat().st_size
            if size <= 0 or phys <= size:
                return
            with path.open("r+b") as fh:
                try:
                    fh.truncate(size)
                    return
                except OSError:
                    pass
                fh.seek(size)
                left = phys - size
                while left > 0:
                    n = min(left, 1 << 20)
                    fh.write(b"\0" * n)
                    left -= n
                fh.flush()
                os.fsync(fh.fileno())
        except (OSError, sqlite3.Error, TypeError, ValueError):
            log.warning("veritabanı dosyasının kuyruğu temizlenemedi", exc_info=True)

    @contextlib.contextmanager
    def bulk(self) -> Iterator[None]:
        """Toplu yazma: blok boyunca yazma kilidi tutulur, commit sona ertelenir (tohumlama, içe aktarma).
        Hata olursa blok geri alınır. Diğer iş parçacıklarının okumaları bu sırada beklemez."""
        with self._write():
            self._bulk_depth += 1
            try:
                yield
            except BaseException:
                if self._bulk_depth == 1:
                    self._rollback()
                raise
            else:
                if self._bulk_depth == 1:
                    self._commit_now()
            finally:
                self._bulk_depth -= 1

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            with contextlib.suppress(sqlite3.Error):
                self._commit_now()
            with contextlib.suppress(Exception):
                self._cdc_write_fp()  # kapanışta son durum (açılışta geri yükleme algılama)
            self._closed = True
            self.conn.close()
            # Başka iş parçacıklarının okuyucu bağlantıları BURADAN kapatılmaz: kullanımdayken başka iş parçacığından
            # close çağırmak sqlite3'te erişim ihlaline (çökme) yol açıyor (kapanışta oyun defteri
            # grafa yazarken). Yalnızca bu iş parçacığının bağlantısı kapatılır; diğer iş parçacıkları bir sonraki
            # okumalarında `_closed` bayrağını görüp kendi bağlantılarını kapatır ve hata alır (B-18).
            with self._readers_lock:
                self._reader_conns = []
            mine = getattr(self._readers, "conn", None)
            if mine is not None:
                with contextlib.suppress(sqlite3.Error):
                    mine.close()
            with contextlib.suppress(AttributeError):
                del self._readers.conn

    def pragma(self, name: str) -> Any:
        """Tanı: yazıcı bağlantısında bir PRAGMA değeri (ör. journal_mode → 'wal')."""
        with self._lock:
            row = self.conn.execute(f"PRAGMA {name}").fetchone()
        return row[0] if row else None

    # ---------------- yazma ----------------
    def upsert_node(self, type_name: str, props: dict[str, Any], *, replace: bool = False) -> dict[str, Any]:
        """Düğümü ekler ya da anahtarına göre birleştirir. replace=False iken listeler birleşir,
        boş olmayan yeni değerler eskisinin üzerine yazar."""
        if self.write_guard is not None:  # mezar kaydı (unutulan veri geri gelmez)
            props = self.write_guard(type_name, props)
        with self._write() as conn:
            key = self.ontology.canonical_key(type_name, props)
            row = conn.execute("SELECT * FROM nodes WHERE type=? AND key=?", (type_name, key)).fetchone()
            now = now_iso()
            if row is None:
                clean = self.ontology.validate(type_name, props)
                node_id = f"{type_name[:3].lower()}_{uuid.uuid4().hex[:12]}"
                label = self.ontology.label_of(type_name, clean)
                raw = _dumps(clean)
                conn.execute(
                    "INSERT INTO nodes(id,type,key,label,props,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                    (node_id, type_name, key, label, raw, now, now))
                self._journal("insert", "node", type_name, node_id, after=self._node_hash(label, raw), keys=clean)
            else:
                node_id = row["id"]
                patch = self.ontology.validate(type_name, props, partial=True)
                old = json.loads(row["props"])
                merged = patch if replace else _merge(old, patch)
                label = self.ontology.label_of(type_name, merged)
                raw = _dumps(merged)
                conn.execute("UPDATE nodes SET props=?, label=?, updated_at=? WHERE id=?",
                             (raw, label, now, node_id))
                self._journal_node_update(row, old, merged, label, raw)
                clean = merged
            self._index(node_id, type_name, label, clean)
            self._commit()
            return self.get_node(node_id)

    def _journal_node_update(self, row: sqlite3.Row, old: dict[str, Any], new: dict[str, Any], label: Any,
                             raw: str) -> None:
        """Güncelleme satırı; içerik (etiket + özellikler) değişmediyse günlüğe yazılmaz (yalnız updated_at)."""
        keys = _changed_keys(old, new)
        if row["label"] != label:
            keys.add("label")
        if not keys and row["props"] == raw:
            return
        self._journal("update", "node", row["type"], row["id"], before=self._node_hash(row["label"], row["props"]),
                      after=self._node_hash(label, raw), keys=keys)

    def patch_node(self, node_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        """Kısmi güncelleme; değeri None olan özellik silinir. Birleşmiş sonuç da ontolojiye uymalıdır (B-17):
        zorunlu özellik silinemez, anahtar özelliği (varlık kimliği) değiştirilemez ya da silinemez."""
        with self._write() as conn:
            row = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
            if row is None:
                raise KeyError(f"Düğüm yok: {node_id}")
            node = _node(row)
            type_name = node["type"]
            clean = self.ontology.validate(type_name, patch, partial=True)
            merged = {**node["props"], **clean}
            for k, v in patch.items():  # None = özelliği sil
                if v is None:
                    merged.pop(k, None)
            et = self.ontology.entity(type_name)
            if et.key in patch and (merged.get(et.key) in (None, "")
                                    or self.ontology.canonical_key(type_name, merged) != node["key"]):
                raise OntologyError(f"{type_name}.{et.key} anahtar özelliğidir; değiştirilemez ya da silinemez")
            for pname, spec in et.properties.items():
                if spec.required and merged.get(pname) in (None, ""):
                    raise OntologyError(f"{type_name}.{pname} zorunlu")
            label = self.ontology.label_of(node["type"], merged)
            raw = _dumps(merged)
            conn.execute("UPDATE nodes SET props=?, label=?, updated_at=? WHERE id=?",
                         (raw, label, now_iso(), node_id))
            self._journal_node_update(row, node["props"], merged, label, raw)
            self._index(node_id, node["type"], label, merged)
            self._commit()
            return self.get_node(node_id)

    def retag(self, types: Iterable[str], prop: str, old: Any, new: Any, *, skip_if_set: str | None = None) -> int:
        """`types` türlerinde `prop == old` olan tüm düğümlerde özelliği `new` yapar (silmeden yeniden damgalama;
        ör. silinen ajanın anılarını mezar taşı değerine taşımak — B-16). `skip_if_set`: bu özelliği dolu olan
        düğümler atlanır. Değiştirilen düğüm sayısını döner."""
        type_list = list(types)
        if not type_list or not prop.isidentifier() or (skip_if_set is not None and not skip_if_set.isidentifier()):
            raise ValueError("Geçersiz tür ya da özellik adı")
        changed = 0
        with self._write() as conn:
            for t in type_list:
                if self.ontology.entity(t).key == prop:
                    raise OntologyError(f"{t}.{prop} anahtar özelliğidir; yeniden damgalanamaz")
                self.ontology.validate(t, {prop: new}, partial=True)
            marks = ",".join("?" * len(type_list))
            rows = conn.execute(f"SELECT * FROM nodes WHERE type IN ({marks}) "
                                f"AND json_extract(props, '$.{prop}') = ?"
                                + (f" AND json_extract(props, '$.{skip_if_set}') IS NULL" if skip_if_set else ""),
                                (*type_list, _sql_value(old))).fetchall()
            now = now_iso()
            for r in rows:
                before = json.loads(r["props"])
                props = {**before, prop: new}
                label = self.ontology.label_of(r["type"], props)
                raw = _dumps(props)
                conn.execute("UPDATE nodes SET props=?, label=?, updated_at=? WHERE id=?",
                             (raw, label, now, r["id"]))
                self._journal_node_update(r, before, props, label, raw)
                self._index(r["id"], r["type"], label, props)
                changed += 1
            self._commit()
        return changed

    def delete_node(self, node_id: str) -> None:
        """Düğümü ve (ON DELETE CASCADE) kenarlarını siler; kademeli silinen her kenar da günlüğe yazılır."""
        with self._write() as conn:
            row = conn.execute("SELECT id, type, label, props FROM nodes WHERE id=?", (node_id,)).fetchone()
            if row is not None:
                self._journal_edge_deletes(conn.execute(
                    "SELECT id, type, src, dst, weight, props FROM edges WHERE src=? "
                    "UNION SELECT id, type, src, dst, weight, props FROM edges WHERE dst=?", (node_id, node_id)))
            conn.execute("DELETE FROM nodes_fts WHERE node_id=?", (node_id,))
            conn.execute("DELETE FROM nodes WHERE id=?", (node_id,))
            if row is not None:
                self._journal("delete", "node", row["type"], node_id, before=self._node_hash(row["label"], row["props"]))
            self._commit()

    def replace_node_content(self, node_id: str, props: dict[str, Any], *, label: str | None = None,
                             updated_at: str | None = None, reindex: bool = True) -> bool:
        """CDC C5: ontoloji birleştirmesi OLMADAN özellikleri yerinde yazar — göç (`assertion.migrate_facts`: zaman damgası
        ve FTS korunur, `reindex=False`) ve unutma geri alımı (`forget._restore`: yedekteki etiket/zaman). `label` ya da
        `updated_at` verilmezse eskisi kalır. Düğüm yoksa False."""
        with self._write() as conn:
            row = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
            if row is None:
                return False
            new_label = row["label"] if label is None else label
            raw = _dumps(props)
            conn.execute("UPDATE nodes SET props=?, label=?, updated_at=? WHERE id=?",
                         (raw, new_label, updated_at or row["updated_at"], node_id))
            self._journal_node_update(row, json.loads(row["props"]), props, new_label, raw)
            if reindex:
                self._index(node_id, row["type"], new_label, props)
            self._commit()
            return True

    def restore_node_row(self, row: dict[str, Any]) -> bool:
        """CDC C5 ( geri alma / içe aktarma): yedekteki düğüm satırını kimliği ve zamanlarıyla AYNEN ekler (INSERT OR
        IGNORE; ontoloji doğrulaması yok — yedek zaten doğrulanmış veridir). `props` JSON metni ya da sözlük. Eklendiyse
        FTS dizinlenir ve günlüğe `insert` yazılır; var olan kimlik/anahtar → False."""
        raw = row["props"] if isinstance(row["props"], str) else _dumps(row["props"])
        with self._write() as conn:
            cur = conn.execute("INSERT OR IGNORE INTO nodes(id,type,key,label,props,created_at,updated_at) "
                               "VALUES(?,?,?,?,?,?,?)", (row["id"], row["type"], row["key"], row["label"], raw,
                                                         row["created_at"], row["updated_at"]))
            if not cur.rowcount:
                return False
            props = json.loads(raw)
            self._journal("insert", "node", row["type"], row["id"], after=self._node_hash(row["label"], raw),
                          keys=props if isinstance(props, dict) else ())
            self._index(row["id"], row["type"], row["label"], props)
            self._commit()
            return True

    def restore_edge_row(self, edge: dict[str, Any]) -> bool:
        """CDC C5: yedekteki kenarı kimliğiyle ekler — yalnız iki ucu da varsa (INSERT OR IGNORE). Eklendiyse True."""
        raw = edge["props"] if isinstance(edge["props"], str) else _dumps(edge["props"])
        with self._write() as conn:
            ok = conn.execute("SELECT COUNT(*) FROM nodes WHERE id IN (?, ?)", (edge["src"], edge["dst"])).fetchone()[0]
            if ok != (1 if edge["src"] == edge["dst"] else 2):
                return False
            cur = conn.execute(
                "INSERT OR IGNORE INTO edges(id,type,src,dst,weight,props,created_at) VALUES(?,?,?,?,?,?,?)",
                (edge["id"], edge["type"], edge["src"], edge["dst"], edge["weight"], raw, edge["created_at"]))
            if not cur.rowcount:
                return False
            self._journal("insert", "edge", edge["type"], edge["id"], after=self._edge_hash(edge["weight"], raw),
                          src=edge["src"], dst=edge["dst"])
            self._commit()
            return True

    def link(self, rel: str, src_id: str, dst_id: str, props: dict[str, Any] | None = None,
             weight_inc: float | None = None) -> dict[str, Any]:
        with self._write() as conn:
            src, dst = self.get_node(src_id), self.get_node(dst_id)
            self.ontology.check_relation(rel, src["type"], dst["type"])
            row = conn.execute(
                "SELECT * FROM edges WHERE type=? AND src=? AND dst=?", (rel, src_id, dst_id)).fetchone()
            if row is None:
                edge_id = f"e_{uuid.uuid4().hex[:12]}"
                weight, raw = float(weight_inc or 1.0), _dumps(props or {})
                conn.execute(
                    "INSERT INTO edges(id,type,src,dst,weight,props,created_at) VALUES(?,?,?,?,?,?,?)",
                    (edge_id, rel, src_id, dst_id, weight, raw, now_iso()))
                self._journal("insert", "edge", rel, edge_id, after=self._edge_hash(weight, raw),
                              keys=props or {}, src=src_id, dst=dst_id)
            else:
                edge_id = row["id"]
                if weight_inc or props:
                    old = json.loads(row["props"])
                    merged = {**old, **(props or {})}
                    weight, raw = float(row["weight"]) + float(weight_inc or 0), _dumps(merged)
                    conn.execute("UPDATE edges SET weight=?, props=? WHERE id=?", (weight, raw, edge_id))
                    keys = _changed_keys(old, merged)
                    if float(weight_inc or 0):
                        keys.add("weight")
                    if keys or raw != row["props"]:
                        self._journal("update", "edge", rel, edge_id, before=self._edge_hash(row["weight"], row["props"]),
                                      after=self._edge_hash(weight, raw), keys=keys, src=src_id, dst=dst_id)
            self._commit()
            return _edge(conn.execute("SELECT * FROM edges WHERE id=?", (edge_id,)).fetchone())

    def has_edge(self, rel: str, src_id: str, dst_id: str) -> bool:
        """Kenar var mı (idempotent yeniden işleme — sayaç yalnız yeni kenarda artar)."""
        with self._read() as conn:
            return conn.execute("SELECT 1 FROM edges WHERE type=? AND src=? AND dst=?",
                                (rel, src_id, dst_id)).fetchone() is not None

    def unlink(self, rel: str, src_id: str, dst_id: str | None = None) -> None:
        with self._write() as conn:
            if dst_id is None:
                where, params = "type=? AND src=?", (rel, src_id)
            else:
                where, params = "type=? AND src=? AND dst=?", (rel, src_id, dst_id)
            rows = conn.execute(f"SELECT id, type, src, dst, weight, props FROM edges WHERE {where}", params).fetchall()
            if rows:
                conn.execute(f"DELETE FROM edges WHERE {where}", params)
                self._journal_edge_deletes(rows)
            self._commit()

    def delete_edges(self, edge_ids: Iterable[str]) -> int:
        """CDC C5: kenarları kimlikle siler ( unutma: paylaşılan kavramın ad alanı kenarları). Silinen sayıyı döner."""
        ids = list(dict.fromkeys(edge_ids))
        n = 0
        with self._write() as conn:
            for i in range(0, len(ids), IN_CHUNK):
                chunk = ids[i:i + IN_CHUNK]
                marks = ",".join("?" * len(chunk))
                rows = conn.execute(f"SELECT id, type, src, dst, weight, props FROM edges WHERE id IN ({marks})",
                                    chunk).fetchall()
                if rows:
                    n += conn.execute(f"DELETE FROM edges WHERE id IN ({marks})", chunk).rowcount
                    self._journal_edge_deletes(rows)
            self._commit()
        return n

    def _index(self, node_id: str, type_name: str, label: str, props: dict[str, Any]) -> None:
        body = self.ontology.search_text(type_name, props)
        self.conn.execute("DELETE FROM nodes_fts WHERE node_id=?", (node_id,))
        if self.ontology.entity(type_name).search:
            self.conn.execute("INSERT INTO nodes_fts(node_id,type,label,body) VALUES(?,?,?,?)",
                              (node_id, type_name, label, body))

    # ---------------- okuma ----------------
    def get_node(self, node_id: str) -> dict[str, Any]:
        with self._read() as conn:
            row = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if row is None:
            raise KeyError(f"Düğüm yok: {node_id}")
        return _node(row)

    def get_nodes(self, node_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
        """Toplu düğüm okuma: {id: düğüm} (olmayanlar atlanır)."""
        ids = list(dict.fromkeys(node_ids))
        out: dict[str, dict[str, Any]] = {}
        with self._read() as conn:
            for i in range(0, len(ids), IN_CHUNK):
                chunk = ids[i:i + IN_CHUNK]
                for r in conn.execute(f"SELECT * FROM nodes WHERE id IN ({','.join('?' * len(chunk))})", chunk):
                    out[r["id"]] = _node(r)
        return out

    def find(self, type_name: str, key_value: str) -> dict[str, Any] | None:
        et = self.ontology.entity(type_name)
        key = self.ontology.canonical_key(type_name, {et.key: key_value})
        with self._read() as conn:
            row = conn.execute("SELECT * FROM nodes WHERE type=? AND key=?", (type_name, key)).fetchone()
        return _node(row) if row else None

    @staticmethod
    def _where(type_name: str | None, props: dict[str, Any] | None, q: str | None,
               contains: dict[str, Any] | None, exclude: dict[str, Any] | None = None) -> tuple[str, list[Any]]:
        """Liste süzgeçleri → (WHERE ifadesi, parametreler).
        props: {özellik: değer} eşitlik (None → IS NULL; liste → IN); q: etiket ya da anahtarda geçen metin;
        contains: {"<liste özelliği>.<öğe anahtarı>": değer} → listedeki bir öğenin alanı eşit (json_each)."""
        clauses: list[str] = []
        params: list[Any] = []
        if type_name:
            clauses.append("type=?")
            params.append(type_name)
        for prop, value in (props or {}).items():
            if not prop.isidentifier():
                raise ValueError("Geçersiz özellik adı")
            expr = f"json_extract(props, '$.{prop}')"
            if value is None:
                clauses.append(f"{expr} IS NULL")
            elif isinstance(value, (list, tuple, set)):
                vals = [_sql_value(v) for v in value]
                if not vals:
                    clauses.append("0")
                else:
                    clauses.append(f"{expr} IN ({','.join('?' * len(vals))})")
                    params += vals
            else:
                clauses.append(f"{expr} = ?")
                params.append(_sql_value(value))
        for path, value in (contains or {}).items():
            list_prop, _, item_key = path.partition(".")
            if not list_prop.isidentifier() or not item_key.isidentifier():
                raise ValueError("Geçersiz özellik adı")
            clauses.append(f"EXISTS (SELECT 1 FROM json_each(nodes.props, '$.{list_prop}') "
                           f"WHERE json_extract(json_each.value, '$.{item_key}') = ?)")
            params.append(_sql_value(value))
        for prop, value in (exclude or {}).items():  # eşit OLMAYAN (yok sayılan kayıtlar SQL'de elenir)
            if not prop.isidentifier():
                raise ValueError("Geçersiz özellik adı")
            expr = f"json_extract(props, '$.{prop}')"
            if isinstance(value, str) and value.endswith("*"):  # önek: "system:*"
                clauses.append(f"({expr} IS NULL OR substr({expr}, 1, ?) != ?)")
                params += [len(value) - 1, value[:-1]]
            else:
                clauses.append(f"({expr} IS NULL OR {expr} != ?)")
                params.append(_sql_value(value))
        if q:
            like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            clauses.append("(label LIKE ? ESCAPE '\\' OR key LIKE ? ESCAPE '\\')")
            params += [like, like]
        return (" WHERE " + " AND ".join(clauses)) if clauses else "", params

    def nodes(self, type_name: str | None = None, limit: int = 500, order: str = "updated_at DESC", *,
              offset: int = 0, props: dict[str, Any] | None = None, q: str | None = None,
              contains: dict[str, Any] | None = None, exclude: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Düğüm listesi. Parametresiz davranış eski: türün son güncellenen `limit` düğümü.
        Sayfalama/süzgeç isteğe bağlı: offset, props (eşitlik), q (etiket/anahtar metni), contains (liste öğesi),
        exclude (eşit olmayan; `"önek*"` önek dışlar)."""
        order = order if order in ORDERS else "updated_at DESC"
        where, params = self._where(type_name, props, q, contains, exclude)
        sql = f"SELECT * FROM nodes{where} ORDER BY {order} LIMIT ? OFFSET ?"
        with self._read() as conn:
            rows = conn.execute(sql, (*params, int(limit), max(0, int(offset)))).fetchall()
        return [_node(r) for r in rows]

    def count(self, type_name: str | None = None, *, props: dict[str, Any] | None = None, q: str | None = None,
              contains: dict[str, Any] | None = None, exclude: dict[str, Any] | None = None) -> int:
        where, params = self._where(type_name, props, q, contains, exclude)
        with self._read() as conn:
            return int(conn.execute(f"SELECT COUNT(*) FROM nodes{where}", params).fetchone()[0])

    def find_by_prop(self, type_name: str, prop: str, value: Any, limit: int = 200) -> list[dict[str, Any]]:
        return self.nodes(type_name, limit=limit, props={prop: value})

    def neighbors(self, node_id: str, rels: Iterable[str] | None = None,
                  direction: str = "both") -> list[tuple[dict[str, Any], dict[str, Any], str]]:
        """(kenar, komşu düğüm, yön) listesi; yön 'out' veya 'in'."""
        return self.neighbors_many([node_id], rels, direction).get(node_id, [])

    def neighbors_many(self, node_ids: Iterable[str], rels: Iterable[str] | None = None,
                       direction: str = "both") -> dict[str, list[tuple[dict[str, Any], dict[str, Any], str]]]:
        """Toplu komşu sorgusu: {düğüm id: [(kenar, komşu, yön), …]} — N+1 yerine yön başına tek sorgu
        (öbekler hâlinde). Komşu düğüm aynı sorguda okunur."""
        ids = list(dict.fromkeys(node_ids))
        rel_list = list(rels) if rels else None
        out: dict[str, list[tuple[dict[str, Any], dict[str, Any], str]]] = {i: [] for i in ids}
        if not ids:
            return out
        select = ("SELECT e.id, e.type, e.src, e.dst, e.weight, e.props, e.created_at, "
                  "n.id n_id, n.type n_type, n.key n_key, n.label n_label, n.props n_props, "
                  "n.created_at n_created_at, n.updated_at n_updated_at FROM edges e JOIN nodes n ON n.id=")
        queries: list[tuple[str, str, str]] = []
        if direction in ("both", "out"):
            queries.append(("out", select + "e.dst WHERE e.src IN ({marks})", "src"))
        if direction in ("both", "in"):
            queries.append(("in", select + "e.src WHERE e.dst IN ({marks})", "dst"))
        with self._read() as conn:
            for dir_, sql, anchor in queries:
                for i in range(0, len(ids), IN_CHUNK):
                    chunk = ids[i:i + IN_CHUNK]
                    stmt = sql.format(marks=",".join("?" * len(chunk)))
                    params: list[Any] = list(chunk)
                    if rel_list:
                        stmt += f" AND e.type IN ({','.join('?' * len(rel_list))})"
                        params += rel_list
                    for r in conn.execute(stmt, params):
                        out[r[anchor]].append((_edge(r), _node_prefixed(r), dir_))
        return out

    def search(self, fts_query: str, types: Iterable[str] | None = None, limit: int = 30) -> list[tuple[dict[str, Any], float]]:
        """FTS5 araması; skor büyük = daha alakalı."""
        type_list = list(types) if types else None
        sql = "SELECT node_id, bm25(nodes_fts, 0.0, 0.0, 2.0, 1.0) AS s FROM nodes_fts WHERE nodes_fts MATCH ?"
        params: list[Any] = [fts_query]
        if type_list:
            sql += f" AND type IN ({','.join('?' * len(type_list))})"
            params += type_list
        sql += " ORDER BY s LIMIT ?"
        params.append(limit)
        with self._read() as conn:
            try:
                rows = conn.execute(sql, params).fetchall()
            except sqlite3.OperationalError:
                return []
            nodes = self.get_nodes(r["node_id"] for r in rows)
        return [(nodes[r["node_id"]], -float(r["s"])) for r in rows if r["node_id"] in nodes]

    def dump(self, types: Iterable[str] | None = None, limit: int = 400, *, offset: int = 0,
             q: str | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        type_list = list(types) if types else None
        where, params = self._where(None, None, q, None)
        if type_list:
            type_clause = f"type IN ({','.join('?' * len(type_list))})"
            where = (where + " AND " if where else " WHERE ") + type_clause
            params += type_list
        with self._read() as conn:
            rows = conn.execute(f"SELECT * FROM nodes{where} ORDER BY updated_at DESC LIMIT ? OFFSET ?",
                                (*params, int(limit), max(0, int(offset)))).fetchall()
            nodes = [_node(r) for r in rows]
            ids = [n["id"] for n in nodes]
            if not ids:
                return [], []
            marks = ",".join("?" * len(ids))
            edges = [_edge(r) for r in conn.execute(
                f"SELECT * FROM edges WHERE src IN ({marks}) AND dst IN ({marks})", (*ids, *ids)).fetchall()]
        return nodes, edges

    def stats(self) -> dict[str, Any]:
        with self._read() as conn:
            by_type = {r["type"]: r["c"] for r in conn.execute(
                "SELECT type, COUNT(*) c FROM nodes GROUP BY type").fetchall()}
            n_edges = conn.execute("SELECT COUNT(*) c FROM edges").fetchone()["c"]
        return {"nodes": sum(by_type.values()), "edges": n_edges, "by_type": by_type}

    # ---------------- çalıştırma olayları ----------------
    def add_run_event(self, run_id: str, event: dict[str, Any]) -> None:
        with self._write() as conn:
            data = {k: v for k, v in event.items() if k not in ("seq", "ts", "type", "run_id")}
            conn.execute("INSERT INTO run_events(run_id,seq,ts,type,data) VALUES(?,?,?,?,?)",
                         (run_id, event.get("seq", 0), event.get("ts", 0.0), event["type"], _dumps(data)))
            self._commit()

    def run_events(self, run_id: str, *, after_seq: int | None = None, limit: int | None = None) -> list[dict[str, Any]]:
        """Koşunun olayları sıra numarasıyla. İsteğe bağlı: `after_seq` sonrası, en çok `limit` olay. negatif sıra
        numaralı satırlar koşunun iç günlüğüdür (`run_journal`; araç yürütme defteri) ve olay listesinde yoktur."""
        sql = "SELECT * FROM run_events WHERE run_id=?"
        params: list[Any] = [run_id]
        sql += " AND seq>?"
        params.append(int(after_seq) if after_seq is not None else -1)
        sql += " ORDER BY seq"
        if limit is not None:
            sql += " LIMIT ?"
            params.append(int(limit))
        with self._read() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [{"seq": r["seq"], "ts": r["ts"], "type": r["type"], "run_id": run_id, **json.loads(r["data"])}
                for r in rows]

    # ---------------- koşu iç günlüğü (yalnız ekleme) ----------------
    # Araç yürütme defterinin asıl kayıtları kontrol noktasına her yazımda baştan yazılmaz (karesel büyüme): yalnız YENİ
    # kayıtlar bu günlüğe eklenir. Satırlar `run_events` tablosunda NEGATİF sıra numarasıyla durur: olay listesinde
    # görünmez (`run_events`), ama koşunun bütün olay satırlarıyla birlikte silinir (`delete_run_events`) ve unutma
    # taramasına / karartmasına girer (`run_event_rows`, `set_run_event_data`).
    def add_run_journal(self, run_id: str, rows: list[tuple[str, dict[str, Any]]]) -> int:
        """Günlüğe satır ekler (tek işlem, sıra korunur). Dönüş: eklenen satır sayısı."""
        if not rows:
            return 0
        with self._write() as conn:
            cur = conn.execute("SELECT MIN(seq) m FROM run_events WHERE run_id=? AND seq<0", (run_id,)).fetchone()
            low = int(cur["m"]) if cur is not None and cur["m"] is not None else 0
            ts = time.time()
            for k, (typ, data) in enumerate(rows):
                conn.execute("INSERT INTO run_events(run_id,seq,ts,type,data) VALUES(?,?,?,?,?)",
                             (run_id, low - 1 - k, ts, str(typ), _dumps(data)))
            self._commit()
        return len(rows)

    def run_journal(self, run_id: str, type_: str | None = None) -> list[dict[str, Any]]:
        """Günlük satırları ekleme sırasıyla: [{type, data...}]."""
        sql = "SELECT type, data FROM run_events WHERE run_id=? AND seq<0"
        params: list[Any] = [run_id]
        if type_ is not None:
            sql += " AND type=?"
            params.append(type_)
        sql += " ORDER BY seq DESC"
        with self._read() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [{"type": r["type"], **json.loads(r["data"])} for r in rows]

    def delete_run_events(self, run_ids: Iterable[str]) -> int:
        """koşuların olay satırlarını siler (değerlendirme denemesi ölçüldükten sonra)."""
        ids = list(dict.fromkeys(run_ids))
        n = 0
        with self._write() as conn:
            for i in range(0, len(ids), IN_CHUNK):
                chunk = ids[i:i + IN_CHUNK]
                n += conn.execute(f"DELETE FROM run_events WHERE run_id IN ({','.join('?' * len(chunk))})",
                                  chunk).rowcount
            self._commit()
        return n

    def run_event_rows(self, run_ids: Iterable[str]) -> list[dict[str, Any]]:
        """ (unutma): koşuların ham olay satırları `{rowid, run_id, seq, type, data}` (data çözülmemiş JSON)."""
        ids = list(dict.fromkeys(run_ids))
        out: list[dict[str, Any]] = []
        with self._read() as conn:
            for i in range(0, len(ids), IN_CHUNK):
                chunk = ids[i:i + IN_CHUNK]
                out += [dict(r) for r in conn.execute(
                    f"SELECT rowid, run_id, seq, type, data FROM run_events WHERE run_id IN ({','.join('?' * len(chunk))})",
                    chunk)]
        return out

    def set_run_event_data(self, rows: Iterable[tuple[int, str]]) -> int:
        """koşu olayı yükünü yerinde değiştirir (koşuya göre yük karartma ve geri alma). [(rowid, json)]."""
        n = 0
        with self._write() as conn:
            for rowid, data in rows:
                n += conn.execute("UPDATE run_events SET data=? WHERE rowid=?", (data, int(rowid))).rowcount
            self._commit()
        return n


def _sql_value(value: Any) -> Any:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (str, int, float)) or value is None:
        return value
    return json.loads(json.dumps(value, default=str))


def _dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str)


def _changed_keys(old: dict[str, Any], new: dict[str, Any]) -> set[str]:
    """Değeri değişen, eklenen ya da silinen üst düzey özellik adları (CDC `changed_keys`; değer yok)."""
    return {k for k in old.keys() | new.keys() if old.get(k, _MISSING) != new.get(k, _MISSING)}


_MISSING = object()


def _merge(old: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    merged = dict(old)
    for k, v in new.items():
        if isinstance(v, list) and isinstance(merged.get(k), list):
            seen = list(merged[k])
            for item in v:
                if item not in seen:
                    seen.append(item)
            merged[k] = seen
        elif v not in (None, ""):
            merged[k] = v
    return merged


def _node(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": row["id"], "type": row["type"], "key": row["key"], "label": row["label"],
            "props": json.loads(row["props"]), "created_at": row["created_at"], "updated_at": row["updated_at"]}


def _node_prefixed(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": row["n_id"], "type": row["n_type"], "key": row["n_key"], "label": row["n_label"],
            "props": json.loads(row["n_props"]), "created_at": row["n_created_at"], "updated_at": row["n_updated_at"]}


def _edge(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": row["id"], "type": row["type"], "src": row["src"], "dst": row["dst"],
            "weight": row["weight"], "props": json.loads(row["props"]), "created_at": row["created_at"]}
