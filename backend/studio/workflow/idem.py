"""Gönderim idempotency defteri (G1-B; Rehber 1 R06, T10; "aynı göreve çift tıklama").

Koşu açan uçlar (`POST /api/tasks`, `/api/workflows/{slug}/run`, `/api/goals/{id}/launch`; tam sürümde tarif başlatma ucu)
isteğe bağlı bir anahtar kabul eder: `Idempotency-Key` başlığı ya da gövdede `client_request_id`.

- Aynı anahtar + aynı yük → ilk yanıt aynen döner (aynı `run_id`), `replayed: true` eklenir; yeni koşu açılmaz.
- Aynı anahtar + farklı yük (uç ya da gövde farklı) → `IdemConflict` (API 409).
- Anahtar yoksa davranış değişmez.
- Kayıt `<veri>/idem.sqlite` içinde 24 saat tutulur (`anahtar → {payload_sha, run_id, response, at}`).
- Başarısız başlatma (istisna) kaydedilmez: aynı anahtarla yeniden denemek yeni bir girişimdir.
- Aynı anahtarla eşzamanlı iki istek (çift tıklama) anahtar başına kilitle sıraya girer; ikincisi ilkinin sonucunu alır.
- (sınır): kilitler süreç içidir. Stüdyo tek süreç olarak çalışır (bir veri dizini = bir sunucu); aynı veri
  dizinini iki süreç paylaşırsa defter ve günlük bütçe defteri güncellemeleri yarışabilir. Bu desteklenmez.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

FILE = "idem.sqlite"
TTL_S = 24 * 3600
HEADER = "Idempotency-Key"
BODY_FIELD = "client_request_id"
_KEY_RE = re.compile(r"^[A-Za-z0-9._:\-]{8,200}$")


class IdemError(ValueError):
    """Geçersiz anahtar (API 400)."""


class IdemConflict(ValueError):
    """Aynı anahtar farklı yükle kullanıldı (API 409)."""


def payload_sha(scope: str, body: Any) -> str:
    """Kanonik yük özeti: uç (`scope`) + gövde (`client_request_id` hariç), anahtar sıralı JSON."""
    data = {k: v for k, v in body.items() if k != BODY_FIELD} if isinstance(body, dict) else body
    raw = json.dumps({"scope": scope, "body": data}, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class IdemLedger:
    def __init__(self, path: Path | None = None):
        self.path = path
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path) if path else ":memory:", check_same_thread=False)
        with self._lock:
            self._db.execute("CREATE TABLE IF NOT EXISTS idem (key TEXT PRIMARY KEY, payload_sha TEXT NOT NULL, "
                             "run_id TEXT, response TEXT NOT NULL, at REAL NOT NULL)")
            self._db.commit()
        self._key_locks: dict[str, tuple[asyncio.Lock, int]] = {}  # anahtar → (kilit, bekleyen sayısı)

    def lookup(self, key: str, now: float | None = None) -> dict[str, Any] | None:
        now = time.time() if now is None else now
        with self._lock:
            row = self._db.execute("SELECT payload_sha, run_id, response, at FROM idem WHERE key = ?", (key,)).fetchone()
        if row is None or now - float(row[3]) > TTL_S:
            return None
        return {"payload_sha": row[0], "run_id": row[1], "response": json.loads(row[2]), "at": float(row[3])}

    def record(self, key: str, sha: str, response: dict[str, Any], now: float | None = None) -> None:
        now = time.time() if now is None else now
        run_id = response.get("run_id") if isinstance(response, dict) else None
        with self._lock:
            self._db.execute("DELETE FROM idem WHERE at < ?", (now - TTL_S,))
            self._db.execute("INSERT OR REPLACE INTO idem (key, payload_sha, run_id, response, at) VALUES (?, ?, ?, ?, ?)",
                             (key, sha, str(run_id) if run_id else None,
                              json.dumps(response, ensure_ascii=False, default=str), now))
            self._db.commit()

    def close(self) -> None:
        with self._lock:
            self._db.close()

    async def once(self, key: str | None, scope: str, body: Any,
                   start: Callable[[], Awaitable[dict[str, Any]]]) -> dict[str, Any]:
        """Anahtar yoksa `start()`; varsa yukarıdaki kurallarla tek mantıksal gönderim."""
        if key is None:
            return await start()
        sha = payload_sha(scope, body)
        lock, users = self._key_locks.get(key) or (asyncio.Lock(), 0)
        self._key_locks[key] = (lock, users + 1)
        try:
            async with lock:
                hit = self.lookup(key)
                if hit is not None:
                    if hit["payload_sha"] != sha:
                        raise IdemConflict("Bu istek anahtarı farklı bir istekle zaten kullanıldı")
                    return {**hit["response"], "replayed": True}
                response = await start()
                if isinstance(response, dict):
                    self.record(key, sha, response)
                return response
        finally:
            lock, users = self._key_locks[key]
            if users <= 1:
                self._key_locks.pop(key, None)
            else:
                self._key_locks[key] = (lock, users - 1)


def request_key(headers: Any, body: Any) -> str | None:
    """Başlık (`Idempotency-Key`) ya da gövde (`client_request_id`) anahtarı; ikisi de yoksa None. Geçersiz → IdemError."""
    raw = None
    try:
        raw = headers.get(HEADER) if headers is not None else None
    except AttributeError:
        raw = None
    if not raw and isinstance(body, dict) and body.get(BODY_FIELD) not in (None, ""):
        raw = body.get(BODY_FIELD)
    if raw in (None, ""):
        return None
    key = str(raw).strip()
    if not _KEY_RE.match(key):
        raise IdemError("Geçersiz istek anahtarı (8-200 karakter; harf, rakam, . _ : -)")
    return key


def ledger_for(settings: Any) -> IdemLedger:
    """Aynı Settings nesnesi için tek defter (veri dizini: ayar dosyasının klasörü; yoksa bellek içi)."""
    led = getattr(settings, "_idem_ledger", None)
    if isinstance(led, IdemLedger):
        return led
    path = None
    try:
        if getattr(settings, "path", None):
            path = Path(settings.path).parent / FILE
    except (TypeError, ValueError):
        path = None
    led = IdemLedger(path)
    try:
        settings._idem_ledger = led  # type: ignore[attr-defined]
    except AttributeError:
        pass
    return led


async def guarded(settings: Any, request: Any, scope: str, body: Any,
                  start: Callable[[], Awaitable[dict[str, Any]]]) -> dict[str, Any]:
    """FastAPI uçları için: anahtarı istekten okur, defterden geçirir; hataları HTTP koduna çevirir (400 / 409)."""
    from fastapi import HTTPException  # noqa: PLC0415
    try:
        key = request_key(getattr(request, "headers", None), body)
    except IdemError as exc:
        raise HTTPException(400, str(exc)) from exc
    if key is not None and request is not None and hasattr(request, "scope"):
        from studio.api import request_actor  # noqa: PLC0415 - döngüsel içe aktarmadan kaçın
        key = f"{request_actor(request)}|{key}"  # anahtar isteği yapana göre ayrılır (MCP UI kaydını almaz)
    try:
        return await ledger_for(settings).once(key, scope, body, start)
    except IdemConflict as exc:
        raise HTTPException(409, str(exc)) from exc
