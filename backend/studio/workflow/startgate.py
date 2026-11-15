"""ad alanı başlatma kapısı — unutma uygulanırken o bellek ad alanında yeni koşu açılmaz.

`ForgetService.apply` kapsamın ad alanını kapatır (iç içe sayaç; "durdur ve unut" ucu da durdurma + uygulama boyunca
kapatır) ve iş bitince açar. Motorun eşzamansız giriş noktaları (`start_task`, `start_workflow`, devretme/orkestrasyon;
zamanlayıcı tetikleri de bunlardan geçer) kapı açılana kadar bekler (en çok `WAIT_S`); eşzamanlı yol (`_launch`: çatal,
yeniden deneme …) kapalı kapıda 409 alır. Böylece uygulama sırasında başlayan koşu silinmekte olan bilgiyi hatırlayamaz.

biten/duraklatılmış koşuyu yeniden çalıştıran yollar (`resume`, `retry_step`) da kapıdan geçer (409).
`memory.isolation` kapalıyken hatırlama ad alanları arasında geçer; unutma kapıyı `ALL` ile BÜTÜN ad alanları
için kapatır (uygulama süresince hiçbir koşu başlamaz).
bekleyen koşuyu SÜRDÜREN her karar da kapıdan geçer — adım onayı ve bütün sorular (`Engine.decide`: hata,
bütçe, günlük tavan, bilinmeyen etki, sürüm değişikliği), araç onayı (`resolve_tool_approval`) ve kabul kararı
(terfi belleğe yazar). Kapı kapalıyken karar 409 `ERR_GATED_DECISION` alır (kart açık kalır, sonra yeniden verilir);
zamanlayıcının gözetimsiz reddi kapı açılınca uygulanır.
denetim ile yazım arasında `await` olan karar (kabul: artefakt karşılaştırması) yazımı `hold` içinde yapar:
tutma sürerken kapı kapanmaz (`close` tutmanın bitmesini en çok `HOLD_WAIT_S` bekler), kapı kapalıysa tutma 409 alır.
Böylece "kapı açık" denetimi ile belleğe terfi yazımı arasında unutma başlayamaz.
"""

from __future__ import annotations

import asyncio
import contextlib
import threading
import time
from typing import Iterator

from fastapi import HTTPException

WAIT_S = 60.0
POLL_S = 0.02
ERR_GATED = "Bu bellek alanında unutma uygulanıyor; koşu biraz sonra başlatılabilir"
ERR_GATED_DECISION = ("Bu bellek alanında unutma uygulanıyor; karar şimdi verilemez. Unutma bitince (birkaç saniye) "
                      "yeniden dene; kart açık kalır")
ALL = "*"  # bütün ad alanları (bellek yalıtımı kapalı)
HOLD_WAIT_S = 10.0  # kapanış, süren tutmaların (kısa, eşzamanlı yazımlar) bitmesini en çok bu kadar bekler


class StartGateClosed(HTTPException):
    def __init__(self, msg: str = ERR_GATED) -> None:
        super().__init__(409, msg)


class StartGate:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)
        self._closed: dict[str, int] = {}
        self._held: dict[str, int] = {}  # süren tutmalar (ad alanı → sayı)

    def close(self, ns: str) -> None:
        with self._cond:
            self._closed[ns] = self._closed.get(ns, 0) + 1
            # bu ad alanında (ALL ise herhangi birinde) süren tutma bitene kadar bekle (üst sınırlı)
            end = time.monotonic() + HOLD_WAIT_S
            while any(n > 0 and (ns == ALL or k == ns) for k, n in self._held.items()):
                left = end - time.monotonic()
                if left <= 0:
                    break
                self._cond.wait(left)

    def open(self, ns: str) -> None:
        with self._cond:
            n = self._closed.get(ns, 0) - 1
            if n > 0:
                self._closed[ns] = n
            else:
                self._closed.pop(ns, None)

    @contextlib.contextmanager
    def hold(self, ns: str | None, msg: str = ERR_GATED_DECISION) -> Iterator[None]:
        """kapı açıksa blok boyunca kapanmasını engeller (kapalıysa `StartGateClosed`). Blok kısa ve
        eşzamanlı olmalıdır (içinde `await` yok)."""
        key = str(ns or "")
        with self._cond:
            if self.closed(key):
                raise StartGateClosed(msg)
            self._held[key] = self._held.get(key, 0) + 1
        try:
            yield
        finally:
            with self._cond:
                n = self._held.get(key, 0) - 1
                if n > 0:
                    self._held[key] = n
                else:
                    self._held.pop(key, None)
                self._cond.notify_all()

    def closed(self, ns: str | None) -> bool:
        return bool(self._closed) and (str(ns or "") in self._closed or ALL in self._closed)

    def check(self, ns: str | None, msg: str = ERR_GATED) -> None:
        if self.closed(ns):
            raise StartGateClosed(msg)

    async def wait(self, ns: str | None, timeout: float = WAIT_S) -> None:
        """Kapı açılana kadar bekler; süre dolarsa 409."""
        if not self.closed(ns):
            return
        end = time.monotonic() + timeout
        while self.closed(ns):
            if time.monotonic() >= end:
                raise StartGateClosed()
            await asyncio.sleep(POLL_S)


__all__ = ["StartGate", "StartGateClosed", "ERR_GATED", "ERR_GATED_DECISION", "ALL", "WAIT_S", "HOLD_WAIT_S"]
