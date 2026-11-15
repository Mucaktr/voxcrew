"""D3 — "Klasörde göster" (DELIV-P0, K1): plan → açık onay (özet) → dosya yöneticisi.

Kurallar:
- Yol İSTEMCİDEN GELMEZ: sunucu graf kaydından çözer (`DeliverableService.reveal_target`: çalışma klasöründe `resolve_inside`
  ya da sha256'dan türetilen salt okunur kasa yolu).
- İki adım: `plan` (hiçbir şey çalışmaz; ad, konum, platform, `plan_hash` döner — mutlak yol dönmez) → `confirm: true` +
  aynı `plan_hash` (yol/konum/platform değiştiyse 409) → komut çalışır. Kendiliğinden hiçbir şey açılmaz.
- Komut kabuksuz (`shell=False`): Windows `explorer /select,"<dosya>"` (yol tırnaklı tek belirteç), macOS `open -R <dosya>`, Linux `xdg-open <üst klasör>`.
- Dakikada en çok 10 istek (plan + onay birlikte). Olay `deliverable.revealed {id}` (yol yok).
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

RATE_MAX = 10
RATE_WINDOW_S = 60.0


class RevealError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "reveal_error"):
        super().__init__(message)
        self.status, self.code = status, code


class _Rate:
    def __init__(self) -> None:
        self._hits: deque[float] = deque()
        self._lock = threading.Lock()

    def hit(self) -> None:
        now = time.monotonic()
        with self._lock:
            while self._hits and now - self._hits[0] > RATE_WINDOW_S:
                self._hits.popleft()
            if len(self._hits) >= RATE_MAX:
                raise RevealError("Çok sık istek: bir dakika içinde en çok 10 kez", 429, "rate_limited")
            self._hits.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


RATE = _Rate()


def platform_kind() -> str:
    if sys.platform == "win32":
        return "windows"
    return "macos" if sys.platform == "darwin" else "linux"


def build_argv(path: Path, plat: str) -> list[str]:
    """Kabuksuz argv (ilk öğe yürütülebilir ad; `spawn` mutlak yola çözer)."""
    if plat == "windows":
        return ["explorer.exe", "/select,", str(path)]
    if plat == "macos":
        return ["open", "-R", str(path)]
    return ["xdg-open", str(path.parent)]


def plan_hash(did: str, path: Path, location: str, plat: str) -> str:
    blob = json.dumps({"id": did, "path": str(path), "location": location, "platform": plat}, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def windows_cmdline(exe: str, argv: list[str]) -> str:
    """Windows komut satırı. Explorer `/select,"<yol>"` bekler: `list2cmdline` yalnız boşlukta tırnaklar, virgüllü
    dosya adında ("rapor,son.pptx") Explorer virgülü ayraç sayıp yanlış nesneyi seçer. Yol her zaman tırnaklı tek bir
    belirteç olarak verilir (Windows dosya adında `"` olamaz); başka komutlar için standart kurallar."""
    if len(argv) == 3 and argv[1] == "/select,":
        return f'"{exe}" /select,"{argv[2]}"'
    return subprocess.list2cmdline([exe, *argv[1:]])


def spawn(argv: list[str]) -> None:
    """Dosya yöneticisini başlatır (bekleme yok). Testler bunu değiştirir; gerçek süreç yalnızca onaydan sonra."""
    from studio.connectors.base import group_popen_kwargs
    exe = shutil.which(argv[0])
    if not exe:
        raise RevealError("Bu sistemde dosya yöneticisi bulunamadı", 501, "no_file_manager")
    command: Any = [exe, *argv[1:]]
    if sys.platform == "win32" and len(argv) == 3 and argv[1] == "/select,":  # tek tırnaklı belirteç
        command = windows_cmdline(exe, argv)
    try:
        proc = subprocess.Popen(command, shell=False, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, **group_popen_kwargs())
    except OSError as exc:
        raise RevealError("Dosya yöneticisi başlatılamadı", 500, "spawn_failed") from exc
    threading.Thread(target=proc.wait, daemon=True).start()  # zombi bırakma


def plan(svc: Any, did: str) -> dict[str, Any]:
    """Önizleme: hiçbir süreç başlamaz. Yanıtta mutlak yol YOK (kısa ad + konum)."""
    RATE.hit()
    path, location, name = svc.reveal_target(did)
    plat = platform_kind()
    return {"plan": {"deliverable_id": did, "name": name, "location": location, "platform": plat,
                     "plan_hash": plan_hash(did, path, location, plat)},
            "needs_confirm": True}


def confirm(svc: Any, did: str, given_hash: Any) -> dict[str, Any]:
    RATE.hit()
    if not isinstance(given_hash, str) or not given_hash:
        raise RevealError("Önce planı al: plan_hash gerekli", 400, "approval_required")
    path, location, _name = svc.reveal_target(did)
    plat = platform_kind()
    if plan_hash(did, path, location, plat) != given_hash:
        raise RevealError("Dosya ya da konum plandan sonra değişti; planı yenile", 409, "stale_plan")
    spawn(build_argv(path, plat))
    return {"ok": True, "revealed": True, "location": location}
