"""Donanım özeti (RAM, varsa GPU/VRAM) — ek bağımlılık yok (psutil kullanılmaz).

RAM: Windows GlobalMemoryStatusEx (ctypes), Linux /proc/meminfo, macOS `sysctl -n hw.memsize`.
GPU: yalnızca `nvidia-smi` PATH'teyse kısa bir sorgu (zaman aşımı 5 sn); Apple Silicon'da birleşik bellek notu.
Bulunamayan her şey None → arayüzde "bilinmiyor". Sonuç 10 dk önbelleklenir.
"""

from __future__ import annotations

import ctypes
import os
import platform as _platform
import shutil
import subprocess
import sys
import time
from typing import Any

CACHE_TTL_S = 600.0
_FLAGS = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
GB = 1024 ** 3


def ram_bytes(platform: str | None = None) -> tuple[int | None, int | None]:
    """(toplam, boş) bayt; bilinmiyorsa None."""
    platform = platform or sys.platform
    try:
        if platform == "win32":
            class MemStatus(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
            st = MemStatus()
            st.dwLength = ctypes.sizeof(MemStatus)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st)):  # type: ignore[attr-defined]
                return int(st.ullTotalPhys), int(st.ullAvailPhys)
            return None, None
        if platform.startswith("linux"):
            total = avail = None
            with open("/proc/meminfo", encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("MemTotal:"):
                        total = int(line.split()[1]) * 1024
                    elif line.startswith("MemAvailable:"):
                        avail = int(line.split()[1]) * 1024
            return total, avail
        if platform == "darwin":
            out = subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, timeout=3).stdout
            return int(out.decode().strip()), None
    except (OSError, ValueError, AttributeError, subprocess.SubprocessError):
        pass
    return None, None


def gpu_info(platform: str | None = None, which: Any = shutil.which) -> list[dict[str, Any]]:
    """NVIDIA GPU'lar (nvidia-smi varsa). Diğer üreticiler için şimdilik bilinmiyor."""
    exe = which("nvidia-smi")
    if not exe:
        return []
    try:
        proc = subprocess.run([exe, "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
                              capture_output=True, timeout=5, creationflags=_FLAGS)
    except (OSError, subprocess.SubprocessError):
        return []
    gpus = []
    for line in proc.stdout.decode("utf-8", "replace").splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 2 and parts[1].isdigit():
            gpus.append({"name": parts[0], "vram_bytes": int(parts[1]) * 1024 * 1024, "vendor": "nvidia"})
    return gpus


def summarize(platform: str | None = None, which: Any = shutil.which) -> dict[str, Any]:
    platform = platform or sys.platform
    total, avail = ram_bytes(platform)
    gpus = gpu_info(platform, which)
    unified = platform == "darwin" and _platform.machine().lower() in ("arm64", "aarch64")
    vram = max((g["vram_bytes"] for g in gpus), default=None)
    if unified and total and vram is None:
        vram = total  # birleşik bellek: GPU sistem belleğini paylaşır
    return {
        "platform": platform, "cpu_count": os.cpu_count(), "ram_bytes": total, "ram_available_bytes": avail,
        "ram_gb": round(total / GB, 1) if total else None, "gpus": gpus, "vram_bytes": vram,
        "vram_gb": round(vram / GB, 1) if vram else None, "unified_memory": unified,
        "gpu_known": bool(gpus) or unified,
        "note": None if (gpus or unified) else "GPU bilgisi alınamadı (yalnızca NVIDIA algılanır); öneriler RAM'e göre",
        "checked_at": time.time(),
    }


class HardwareCache:
    def __init__(self, fn: Any = summarize, ttl: float = CACHE_TTL_S):
        self._fn, self._ttl = fn, ttl
        self._value: dict[str, Any] | None = None
        self._ts = 0.0

    def get(self, force: bool = False) -> dict[str, Any]:
        if force or self._value is None or time.monotonic() - self._ts > self._ttl:
            self._value = self._fn()
            self._ts = time.monotonic()
        return dict(self._value)
