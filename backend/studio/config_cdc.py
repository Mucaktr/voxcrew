"""FAZB2 — yapılandırma değişiklik günlüğü: `settings.json` ve `<veri>/workflows/*.yaml`.

Graf CDC'sinin (`graph_changes`) yapılandırma eşi. Yan dosya `<veri>/cdc.sqlite`'a (fazb1 imleç dosyası) üç YENİ tablo eklenir;
mevcut tablolar ve dosyalar değişmez:

- `config_changes(id, ts, actor, file, op, hash, keys, n_keys)` — değişiklik satırı. **Değer YOK**: yalnız dosyanın tuzlu
  özeti ve değişen anahtar yolları (`providers.openai.model`, `steps.0.prompt`). Sır görünümlü yol parçası (jeton, `sk-…`)
  `••••` olarak yazılır. `op`: create | update | delete.
- `config_state(file, hash, fp)` — son görülen hâl: tuzlu yol özeti → [tuzlu değer özeti, maskeli yol] (karşılaştırma için;
  özetler API'ye ve sayfaya hiç çıkmaz; sözlük ANAHTARI sır olabileceği için ham yol da yazılmaz). Tuz kuruluma özgü rastgele 32 bayttır (`config_meta`); düz SHA-256 yazılmaz (kısa parola özetten
  geri bulunamasın).
- `config_meta(k, v)` — tuz ve ilk tarama işareti.

Yakalama iki yoldan: (1) uygulama yazımı — `Settings.update` ve `WorkflowLibrary.save/delete` yazdıktan sonra `on_write`
kancasını çağırır; aktör graf CDC bağlamından (`user`, `mcp:<istemci>`, `system`…). (2) dışarıdan düzenleme — açılışta ve
`SCAN_S` aralıkla tarama; aktör `file`. İlk kurulumda var olan dosyalar sessizce temel alınır (satır yazılmaz).
Kanca ve tarama hiçbir zaman çağıranı düşürmez (hata yalnız günlüğe).

Sistem sağlığı sayfası "Son yapılandırma değişiklikleri" bölümünü `recent`'ten gösterir.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

import yaml

if TYPE_CHECKING:
    from studio.api import Studio

log = logging.getLogger("studio.config_cdc")

SCAN_S = 30.0          # dış düzenleme taraması
MAX_DEPTH = 8          # daha derin alt ağaç tek anahtar sayılır
MAX_KEYS_ROW = 50      # satıra yazılan en çok anahtar yolu (n_keys gerçek sayı)
RETENTION = 5000       # en çok satır
MASK = "••••"
EXTERNAL_ACTOR = "file"

SCHEMA = """
CREATE TABLE IF NOT EXISTS config_changes (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    ts     REAL NOT NULL,
    actor  TEXT NOT NULL,
    file   TEXT NOT NULL,
    op     TEXT NOT NULL,
    hash   TEXT,
    keys   TEXT NOT NULL,
    n_keys INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS config_state (file TEXT PRIMARY KEY, hash TEXT NOT NULL, fp TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS config_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
"""

# yol parçası jeton gibi görünüyorsa (uzun, harf+rakam karışık) ad da sırdır
_TOKENISH = re.compile(r"^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_\-.+/=]{20,}$")


def mask_segment(seg: str) -> str:
    from studio.changes import redact_text  # noqa: PLC0415

    s = str(seg)
    return MASK if redact_text(s) != s or _TOKENISH.match(s) else s


def flatten(obj: Any, prefix: tuple[str, ...] = (), out: dict[tuple[str, ...], Any] | None = None
            ) -> dict[tuple[str, ...], Any]:
    """{yol: yaprak değer}. Boş sözlük/liste ve MAX_DEPTH altı yaprak sayılır."""
    out = {} if out is None else out
    if isinstance(obj, dict) and obj and len(prefix) < MAX_DEPTH:
        for k, v in obj.items():
            flatten(v, (*prefix, str(k)), out)
    elif isinstance(obj, list) and obj and len(prefix) < MAX_DEPTH:
        for i, v in enumerate(obj):
            flatten(v, (*prefix, str(i)), out)
    else:
        out[prefix or ("(kök)",)] = obj
    return out


def _parse(path: Path, raw: str) -> Any:
    return json.loads(raw) if path.suffix.lower() == ".json" else yaml.safe_load(raw)


class ConfigCdc:
    """Yapılandırma dosyalarının değişiklik günlüğü (kendi bağlantısı; cdc.sqlite WAL)."""

    def __init__(self, db_path: Path | str, settings_path: Path | str, workflows_dir: Path | str | None = None):
        self.settings_path = Path(settings_path)
        self.workflows_dir = Path(workflows_dir) if workflows_dir else None
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(db_path), isolation_level=None, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.executescript(SCHEMA)
        row = self._conn.execute("SELECT v FROM config_meta WHERE k='salt'").fetchone()
        if row is None:
            self._conn.execute("INSERT OR IGNORE INTO config_meta(k, v) VALUES('salt', ?)", (os.urandom(32).hex(),))
            row = self._conn.execute("SELECT v FROM config_meta WHERE k='salt'").fetchone()
        self._salt = bytes.fromhex(row[0])

    # ------------------------------------------------------------ yardımcılar
    def _fp(self, value: Any) -> str:
        blob = json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
        return hmac.new(self._salt, blob, hashlib.sha256).hexdigest()[:16]

    def name_of(self, path: Path) -> str:
        p = Path(path)
        if self.workflows_dir is not None and p.parent.resolve() == self.workflows_dir.resolve():
            return f"workflows/{p.name}"
        return p.name

    def tracked(self) -> list[Path]:
        out = [self.settings_path]
        if self.workflows_dir is not None and self.workflows_dir.is_dir():
            out += sorted(self.workflows_dir.glob("*.yaml"))
        return out

    def _path_for(self, name: str) -> Path:
        if name.startswith("workflows/") and self.workflows_dir is not None:
            return self.workflows_dir / name.split("/", 1)[1]
        return self.settings_path.parent / name

    # ------------------------------------------------------------ yakalama
    def record(self, path: Path | str, actor: str | None = None, *, baseline: bool = False) -> dict[str, Any] | None:
        """Dosyanın şimdiki hâlini son görülenle karşılaştırır; fark varsa satır yazar ve döndürür."""
        if actor is None:
            from studio.graph import cdc  # noqa: PLC0415
            actor = cdc.current().actor
        path = Path(path)
        name = self.name_of(path)
        try:
            raw = path.read_text("utf-8")
        except FileNotFoundError:
            raw = None
        if raw is None:
            fps: dict[str, str] | None = None
            fhash = None
        else:
            fhash = hmac.new(self._salt, raw.encode("utf-8"), hashlib.sha256).hexdigest()[:16]
            try:
                flat = flatten(_parse(path, raw))
            except (ValueError, yaml.YAMLError):
                flat = {("(okunamadı)",): raw}
            # anahtar yolu da tuzlu özet (sözlük ANAHTARI sır olabilir); gösterim için maskeli yol yanında
            fps = {self._fp(list(k)): [self._fp(v), ".".join(mask_segment(x) for x in k)] for k, v in flat.items()}
        with self._lock:
            prev = self._conn.execute("SELECT hash, fp FROM config_state WHERE file=?", (name,)).fetchone()
            if prev is None and fps is None:
                return None
            if prev is not None and fps is not None and prev[0] == fhash:
                return None
            old: dict[str, list[str]] = json.loads(prev[1]) if prev else {}
            new = fps or {}
            changed = sorted({v[1] for k, v in new.items() if old.get(k) != v}
                             | {v[1] for k, v in old.items() if k not in new})
            if fps is None:
                self._conn.execute("DELETE FROM config_state WHERE file=?", (name,))
                op = "delete"
            else:
                self._conn.execute("INSERT INTO config_state(file, hash, fp) VALUES(?,?,?) ON CONFLICT(file) DO UPDATE "
                                   "SET hash=excluded.hash, fp=excluded.fp", (name, fhash, json.dumps(new)))
                op = "create" if prev is None else "update"
            if baseline or (op == "update" and not changed):
                return None  # ilk temel ya da yalnız biçim (boşluk/sıra) değişikliği
            keys = changed
            entry = {"ts": time.time(), "actor": str(actor)[:120], "file": name, "op": op, "hash": fhash,
                     "keys": keys[:MAX_KEYS_ROW], "n_keys": len(keys)}
            cur = self._conn.execute(
                "INSERT INTO config_changes(ts, actor, file, op, hash, keys, n_keys) VALUES(?,?,?,?,?,?,?)",
                (entry["ts"], entry["actor"], name, op, fhash, json.dumps(entry["keys"], ensure_ascii=False),
                 entry["n_keys"]))
            entry["id"] = cur.lastrowid
            self._conn.execute("DELETE FROM config_changes WHERE id <= ?", (int(cur.lastrowid) - RETENTION,))
        return entry

    def scan(self, actor: str = EXTERNAL_ACTOR) -> list[dict[str, Any]]:
        """Bütün izlenen dosyalar + kayıtlı ama artık olmayanlar. İlk taramada (işaret yok) var olan dosyalar temel alınır."""
        with self._lock:
            first = self._conn.execute("SELECT 1 FROM config_meta WHERE k='scanned'").fetchone() is None
            known = [r[0] for r in self._conn.execute("SELECT file FROM config_state").fetchall()]
        paths = {self.name_of(p): p for p in self.tracked()}
        for name in known:
            paths.setdefault(name, self._path_for(name))
        out = []
        for p in paths.values():
            e = self.record(p, actor, baseline=first)
            if e:
                out.append(e)
        if first:
            with self._lock:
                self._conn.execute("INSERT OR IGNORE INTO config_meta(k, v) VALUES('scanned', ?)", (str(time.time()),))
        return out

    def hook(self) -> Callable[[Path], None]:
        """`on_write` kancası: yazımdan sonra çağrılır, hiçbir zaman hata atmaz."""
        def on_write(path: Path) -> None:
            try:
                self.record(path)
            except Exception:  # noqa: BLE001 - günlük yazımı ayar/akış kaydını asla bozmaz
                log.warning("yapılandırma değişikliği kaydedilemedi: %s", Path(path).name, exc_info=True)
        return on_write

    def recent(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute("SELECT id, ts, actor, file, op, hash, keys, n_keys FROM config_changes "
                                      "ORDER BY id DESC LIMIT ?", (max(1, int(limit)),)).fetchall()
        return [{"id": r[0], "ts": r[1], "actor": r[2], "file": r[3], "op": r[4], "hash": r[5],
                 "keys": json.loads(r[6]), "n_keys": r[7]} for r in rows]

    def close(self) -> None:
        with self._lock:
            self._conn.close()


# ------------------------------------------------------------------ yaşam döngüsü
async def _loop(studio: "Studio") -> None:
    while True:
        await asyncio.sleep(SCAN_S)
        try:
            await asyncio.to_thread(studio._config_cdc.scan)  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            log.warning("yapılandırma taraması başarısız", exc_info=True)


async def start(studio: "Studio") -> None:
    if getattr(studio, "_config_cdc", None) is not None:
        return
    lib = getattr(studio, "library", None)
    cc = ConfigCdc(Path(studio.changes.data_dir) / "cdc.sqlite", studio.settings.path, getattr(lib, "dir", None))
    studio._config_cdc = cc  # type: ignore[attr-defined]
    try:
        await asyncio.to_thread(cc.scan)  # kapalıyken yapılan düzenlemeler (ya da ilk temel)
    except Exception:  # noqa: BLE001
        log.warning("yapılandırma açılış taraması başarısız", exc_info=True)
    studio.settings.on_write = cc.hook()
    if lib is not None:
        lib.on_write = cc.hook()
    studio._config_cdc_task = asyncio.create_task(_loop(studio), name="config-cdc")  # type: ignore[attr-defined]


async def stop(studio: "Studio") -> None:
    task = getattr(studio, "_config_cdc_task", None)
    if task is not None:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        studio._config_cdc_task = None  # type: ignore[attr-defined]
    studio.settings.on_write = None
    lib = getattr(studio, "library", None)
    if lib is not None:
        lib.on_write = None
    cc = getattr(studio, "_config_cdc", None)
    if cc is not None:
        cc.close()
        studio._config_cdc = None  # type: ignore[attr-defined]


__all__ = ["ConfigCdc", "flatten", "mask_segment", "start", "stop"]
