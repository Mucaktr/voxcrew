"""Referanslı araç çıktısı (AUDIT §5.2 T-4; AW-R15, R19).

Eşikten (`tools.inline_max_chars`, varsayılan 12 000) büyük araç sonucu modele sessizce kesilerek gitmez:

- tam metin **önce maskelenir** (`mcp_client.mask_secrets`, `result_text` içinde) ve enjeksiyon korumasından geçer, sonra
  `<veri>/tool_outputs/<koşu>/<sha256>.txt` olarak bir kez yazılır (aynı içerik aynı dosya; üzerine yazılmaz);
- modele baş + son kesiti ve `artifact://<id>` referansı gider; model `studio__artifact_read(id, offset, length)`
  yerleşik salt okunur aracıyla istediği dilimi alır (yalnız kendi koşusunun artefaktı; dilim ≤ `READ_MAX`);
- dizin `<veri>/tool_outputs/index.sqlite`: yalnız kimlik ve sayı (koşu, adım, araç adı, sha, boyut, modele giden
  karakter, geri okunan karakter, unutulma anı). İçerik dizinde tutulmaz.

Unutma (`graph/forget.py`) bu artefaktları kapsar: önizleme eşleşen artefaktları sayar, uygulama içeriği
`[unutuldu]` ile karartıp yeniden yazar (yeni sha, `forgotten_at`), özgün metin şifreli unutma yedeğine girer, geri alma
yalnız değişmemiş dosyayı geri yazar. Ölçü: `savings` → kaçınılan karakter (`metrics.service.token_report`).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Iterable

log = logging.getLogger("studio.tools.outputs")

SUBDIR = "tool_outputs"
INDEX_FILE = "index.sqlite"
DEFAULT_INLINE_MAX = 12_000      # bundan büyük sonuç artefakt olur
HEAD_CHARS = 6_000
TAIL_CHARS = 2_000
READ_MAX = 8_000                 # tek okumada en çok
STORE_MAX = 5_000_000            # saklanan en büyük metin (fazlası saklanmaz; kesitte açıkça yazılır)
REF_PREFIX = "artifact://"
READ_FN = "studio__artifact_read"
READ_TOOL = "studio:artifact_read"
_ID_RE = re.compile(r"^to_[0-9a-f]{16}$")
_RUN_RE = re.compile(r"[^A-Za-z0-9_.-]+")

READ_DESCRIPTION = {
    "tr": "Büyük araç çıktısının (artifact://to_…) bir dilimini okur. Yalnız salt okunur; bu koşunun artefaktları.",
    "en": "Reads a slice of a large tool output (artifact://to_…). Read-only; this run's artifacts only.",
}
NOTE = {
    "tr": "[… {omitted} karakter atlandı; tam çıktı {size} karakter: {ref} — dilim için {fn}(id=\"{id}\", "
          "offset, length ≤ {max}) kullan]",
    "en": "[… {omitted} chars omitted; full output is {size} chars: {ref} — use {fn}(id=\"{id}\", offset, "
          "length ≤ {max}) for a slice]",
}
CAPPED = {"tr": "[saklama sınırı: ilk {cap} karakter saklandı]", "en": "[storage cap: first {cap} chars stored]"}
ERR_ID = {"tr": "Geçersiz artefakt kimliği: {}", "en": "Invalid artifact id: {}"}
ERR_MISSING = {"tr": "Bu koşuda böyle bir artefakt yok: {}", "en": "No such artifact in this run: {}"}

COLUMNS = ("id TEXT NOT NULL", "run_id TEXT NOT NULL", "step_id TEXT", "tool TEXT", "sha TEXT NOT NULL",
           "size INTEGER NOT NULL", "inline_chars INTEGER NOT NULL", "read_chars INTEGER NOT NULL DEFAULT 0",
           "reads INTEGER NOT NULL DEFAULT 0", "capped INTEGER NOT NULL DEFAULT 0", "created_at REAL NOT NULL",
           "forgotten_at TEXT")


def _lang(lang: str | None) -> str:
    return "en" if lang == "en" else "tr"


def data_dir_of(settings: Any) -> Path | None:
    try:
        path = getattr(settings, "path", None)
        return Path(path).parent if path else None
    except (TypeError, ValueError):
        return None


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def ref(art_id: str) -> str:
    return f"{REF_PREFIX}{art_id}"


def _int(v: Any, default: int, lo: int, hi: int) -> int:
    try:
        x = int(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, x))


def inline_max(settings: Any) -> int:
    try:
        raw = settings.get("tools.inline_max_chars", DEFAULT_INLINE_MAX) if settings is not None else None
    except Exception:  # noqa: BLE001
        raw = None
    return _int(raw, DEFAULT_INLINE_MAX, HEAD_CHARS + TAIL_CHARS, STORE_MAX)


class ToolOutputStore:
    """`<veri>/tool_outputs` deposu. Tüm dizin yazmaları tek kilit altında (motor iş parçacığı + API)."""

    def __init__(self, base: Path):
        self.base = Path(base)
        self._lock = threading.Lock()

    # ------------------------------------------------------------ yollar
    @property
    def index_path(self) -> Path:
        return self.base / INDEX_FILE

    def _run_dir(self, run_id: str) -> Path:
        raw = str(run_id or "-")
        safe = _RUN_RE.sub("_", raw)[:80].strip(".") or "-"
        if safe != raw:  # dönüştürülen kimlik üst dizine çıkmaz ve başka kimlikle aynı dizine düşmez
            safe = f"{safe[:63]}-{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:12]}"
        return self.base / safe

    def delete_run(self, run_id: str) -> int:
        """koşunun bütün artefaktlarını (dizin satırları + dosyalar) siler."""
        if not self.index_path.is_file():
            return 0
        import shutil  # noqa: PLC0415
        with self._lock:
            conn = self._conn()
            try:
                with conn:
                    n = conn.execute("DELETE FROM outputs WHERE run_id=?", (run_id,)).rowcount
            finally:
                conn.close()
            shutil.rmtree(self._run_dir(run_id), ignore_errors=True)
        return n

    def path_of(self, run_id: str, sha: str) -> Path:
        return self._run_dir(run_id) / f"{sha}.txt"

    def _conn(self) -> sqlite3.Connection:
        self.base.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.index_path), timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute(f"CREATE TABLE IF NOT EXISTS outputs ({', '.join(COLUMNS)}, PRIMARY KEY (run_id, id))")
        return conn

    # ------------------------------------------------------------ yazma
    def put(self, text: str, *, run_id: str, step_id: str | None, tool: str | None, inline_chars: int,
            capped: bool = False) -> dict[str, Any]:
        """Metni (zaten maskelenmiş) bir kez yazar; aynı koşuda aynı içerik aynı kaydı döndürür."""
        sha = sha256(text)
        art_id = f"to_{sha[:16]}"
        path = self.path_of(run_id, sha)
        with self._lock:
            if not path.is_file():
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:6]}.tmp")
                tmp.write_text(text, "utf-8")
                os.replace(tmp, path)  # değişmez: aynı sha'ya bir daha yazılmaz; yalnız unutma yeniden yazar
            conn = self._conn()
            try:
                with conn:
                    conn.execute("INSERT OR IGNORE INTO outputs(id, run_id, step_id, tool, sha, size, inline_chars, "
                                 "capped, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                                 (art_id, run_id, step_id, tool, sha, len(text), int(inline_chars), int(capped),
                                  time.time()))
                row = conn.execute("SELECT * FROM outputs WHERE run_id=? AND id=?", (run_id, art_id)).fetchone()
            finally:
                conn.close()
        return dict(row)

    def note_read(self, run_id: str, art_id: str, chars: int) -> None:
        with self._lock:
            conn = self._conn()
            try:
                with conn:
                    conn.execute("UPDATE outputs SET read_chars = read_chars + ?, reads = reads + 1 "
                                 "WHERE run_id=? AND id=?", (int(chars), run_id, art_id))
            finally:
                conn.close()

    # ------------------------------------------------------------ okuma
    def get(self, run_id: str, art_id: str) -> dict[str, Any] | None:
        if not self.index_path.is_file():
            return None
        conn = self._conn()
        try:
            row = conn.execute("SELECT * FROM outputs WHERE run_id=? AND id=?", (run_id, art_id)).fetchone()
        finally:
            conn.close()
        return dict(row) if row else None

    def text(self, row: dict[str, Any]) -> str | None:
        try:
            return self.path_of(row["run_id"], row["sha"]).read_text("utf-8")
        except OSError:
            return None

    def read(self, run_id: str, art_id: str, offset: int = 0, length: int = READ_MAX) -> dict[str, Any] | None:
        row = self.get(run_id, art_id)
        if row is None:
            return None
        text = self.text(row)
        if text is None:
            return None
        offset = max(0, min(int(offset), len(text)))
        length = max(1, min(int(length), READ_MAX))
        chunk = text[offset:offset + length]
        self.note_read(run_id, art_id, len(chunk))
        return {"id": art_id, "offset": offset, "length": len(chunk), "size": len(text),
                "next_offset": offset + len(chunk) if offset + len(chunk) < len(text) else None, "text": chunk}

    def rows(self, run_ids: Iterable[str] | None = None) -> list[dict[str, Any]]:
        if not self.index_path.is_file():
            return []
        conn = self._conn()
        try:
            if run_ids is None:
                rows = conn.execute("SELECT * FROM outputs ORDER BY created_at").fetchall()
            else:
                ids = sorted(set(run_ids))
                rows = []
                for i in range(0, len(ids), 500):
                    chunk = ids[i:i + 500]
                    rows += conn.execute(f"SELECT * FROM outputs WHERE run_id IN ({','.join('?' * len(chunk))})",
                                         chunk).fetchall()
        finally:
            conn.close()
        return [dict(r) for r in rows]

    def for_run(self, run_id: str) -> list[dict[str, Any]]:
        return self.rows([run_id])

    def savings(self, since: float | None = None) -> dict[str, Any]:
        """Kaçınılan karakter: Σ(boyut − modele giden) ve geri okunan; net = kaçınılan − geri okunan."""
        rows = [r for r in self.rows() if since is None or float(r["created_at"]) >= since]
        avoided = sum(max(0, int(r["size"]) - int(r["inline_chars"])) for r in rows)
        read = sum(int(r["read_chars"] or 0) for r in rows)
        return {"artifacts": len(rows), "stored_chars": sum(int(r["size"]) for r in rows),
                "inline_chars": sum(int(r["inline_chars"]) for r in rows), "chars_avoided": avoided,
                "chars_read_back": read, "net_chars_avoided": max(0, avoided - read),
                "reads": sum(int(r["reads"] or 0) for r in rows), "basis": "chars"}

    # ------------------------------------------------------------ unutma
    def rewrite(self, row: dict[str, Any], new_text: str, *, forgotten_at: str | None) -> dict[str, Any]:
        """Unutma / geri alma: içeriği yeni sha ile yazar, eski dosyayı siler, dizini günceller."""
        sha = sha256(new_text)
        old = self.path_of(row["run_id"], row["sha"])
        new = self.path_of(row["run_id"], sha)
        with self._lock:
            if not new.is_file():
                new.parent.mkdir(parents=True, exist_ok=True)
                tmp = new.with_name(f".{new.name}.{uuid.uuid4().hex[:6]}.tmp")
                tmp.write_text(new_text, "utf-8")
                os.replace(tmp, new)
            conn = self._conn()
            try:
                with conn:
                    conn.execute("UPDATE outputs SET sha=?, size=?, forgotten_at=? WHERE run_id=? AND id=?",
                                 (sha, len(new_text), forgotten_at, row["run_id"], row["id"]))
                still = conn.execute("SELECT COUNT(*) FROM outputs WHERE run_id=? AND sha=?",
                                     (row["run_id"], row["sha"])).fetchone()[0]
            finally:
                conn.close()
            if old != new and not still:
                try:
                    old.unlink()
                except OSError:
                    pass
        return {**row, "sha": sha, "size": len(new_text), "forgotten_at": forgotten_at}


def store_for(settings: Any) -> ToolOutputStore | None:
    """Aynı Settings nesnesi için tek depo; veri dizini yoksa None (referanssız kesme yerine eşik metni kalır)."""
    st = getattr(settings, "_tool_output_store", None)
    if isinstance(st, ToolOutputStore):
        return st
    base = data_dir_of(settings)
    if base is None:
        return None
    st = ToolOutputStore(base / SUBDIR)
    try:
        settings._tool_output_store = st  # type: ignore[attr-defined]
    except AttributeError:
        pass
    return st


def excerpt(text: str, row: dict[str, Any], lang: str | None, *, capped: bool = False) -> str:
    """Modele giden metin: baş + referans notu + son. Not, kimliği ve okuma aracını açıkça adlandırır."""
    lg = _lang(lang)
    head, tail = text[:HEAD_CHARS], text[-TAIL_CHARS:] if len(text) > HEAD_CHARS + TAIL_CHARS else ""
    omitted = len(text) - len(head) - len(tail)
    note = NOTE[lg].format(omitted=omitted, size=row["size"], ref=ref(row["id"]), fn=READ_FN, id=row["id"],
                           max=READ_MAX)
    if capped:
        note += " " + CAPPED[lg].format(cap=STORE_MAX)
    return f"{head}\n{note}\n{tail}" if tail else f"{head}\n{note}"


def offload(settings: Any, text: str, *, run_id: str | None, step_id: str | None, tool: str | None,
            lang: str | None) -> tuple[str, dict[str, Any] | None]:
    """Eşik altı metin olduğu gibi döner. Üstü: artefakt + kesit. Depo yoksa ya da yazma başarısızsa açık notla kesit
    (sessiz kesme yok). Dönüş: (modele giden metin, artefakt kaydı | None)."""
    limit = inline_max(settings)
    if len(text) <= limit:
        return text, None
    capped = len(text) > STORE_MAX
    body = text[:STORE_MAX] if capped else text
    st = store_for(settings) if run_id else None
    if st is not None:
        try:
            probe = {"id": f"to_{sha256(body)[:16]}", "size": len(body)}
            out = excerpt(body, probe, lang, capped=capped)
            row = st.put(body, run_id=str(run_id), step_id=step_id, tool=tool, inline_chars=len(out), capped=capped)
            return out, row
        except OSError as exc:
            log.warning("araç çıktısı saklanamadı: %s", exc)
    lg = _lang(lang)
    note = ("[… {} karakter kırpıldı; artefakt deposu kullanılamadı]" if lg == "tr"
            else "[… {} chars cut; artifact store unavailable]").format(len(text) - limit)
    return text[:limit] + "\n" + note, None


def read_tool_schema() -> dict[str, Any]:
    return {"type": "object", "properties": {
        "id": {"type": "string", "description": "artifact id (to_…) or artifact://to_…"},
        "length": {"type": "integer", "description": f"chars to read (1–{READ_MAX})"},
        "offset": {"type": "integer", "description": "start offset in chars (0-based)"}},
        "required": ["id"]}


def read_for_model(settings: Any, run_id: str | None, args: dict[str, Any], lang: str | None) -> tuple[bool, str]:
    """`studio__artifact_read` gövdesi: yalnız bu koşunun artefaktı; sonuç JSON (dilim + sonraki offset)."""
    lg = _lang(lang)
    raw = str(args.get("id") or "").strip()
    art_id = raw[len(REF_PREFIX):] if raw.startswith(REF_PREFIX) else raw
    if not _ID_RE.match(art_id):
        return False, ERR_ID[lg].format(raw[:80])
    st = store_for(settings)
    res = st.read(str(run_id or ""), art_id, _int(args.get("offset"), 0, 0, 10**12),
                  _int(args.get("length"), READ_MAX, 1, READ_MAX)) if st is not None and run_id else None
    if res is None:
        return False, ERR_MISSING[lg].format(art_id)
    return True, json.dumps(res, ensure_ascii=False)
