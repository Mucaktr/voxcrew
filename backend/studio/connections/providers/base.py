"""Sağlayıcı sözleşmesi: hızlı (dosya/port, eşzamanlı) ve yavaş (HTTP, --version; arka plan) kontroller.

Her sağlayıcı yalnızca alan ÜRETİR; durum birleştirme, önbellek, sürümleme ve olay yayını service.py'dedir.
Sorunlar kod + parametre + düzeltme (düğme / komut / bağlantı) olarak döner; metinler service.MESSAGES'ta TR/EN.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping


@dataclass
class ProviderContext:
    """Keşif bağlamı. env/home/which None = gerçek ortam (keşif işlevleri çağrı anında os.environ / Path.home() /
    shutil.which kullanır; böylece testlerin monkeypatch'leri etkili olur). Testler sahte değer verir."""
    settings: Any
    env: Mapping[str, str] | None = None
    home: Path | None = None
    platform: str = sys.platform
    which: Callable[[str], str | None] | None = None
    http_transport: Any = None          # testlerde httpx.MockTransport
    run_quick: Callable[..., tuple[int, str]] | None = None
    gateway: Any = None                 # GatewayManager (Hermes API sunucusu durumu)
    secrets: Any = None                 # SecretStore
    ollama_runner: Any = None           # setup.OllamaRunner (stüdyonun başlattığı `ollama serve`)
    hardware: Any = None                # HardwareCache
    previous: dict[str, Any] = field(default_factory=dict)  # bir önceki birleşik durum (zaman aşımında korunur)
    last_use: dict[str, Any] | None = None


def finder_kwargs(ctx: "ProviderContext") -> dict[str, Any]:
    """Keşif işlevlerine geçecek argümanlar: gerçek ortamda BOŞ (paylaşılan testler `find_x = lambda: ...` yamalar)."""
    if ctx.env is None and ctx.home is None and ctx.which is None:
        return {}
    return {"env": ctx.env, "home": ctx.home, "platform": ctx.platform, "which": ctx.which}


def problem(code: str, fix: dict[str, Any] | None = None, *, severity: str = "block", **params: Any) -> dict[str, Any]:
    """severity: block (hazır değil) | warn (çalışır ama dikkat) | info."""
    return {"code": code, "params": params, "fix": fix, "severity": severity}


def fix_button(label_key: str, action: str, **args: Any) -> dict[str, Any]:
    return {"kind": "button", "label": label_key, "action": action, "args": args}


def fix_command(label_key: str, command: str) -> dict[str, Any]:
    return {"kind": "command", "label": label_key, "command": command}


def fix_link(label_key: str, url: str, *, guide: str | None = None) -> dict[str, Any]:
    """`guide`: arayüzde açılacak kurulum rehberinin türü (SETUP). Rehberi tanımayan istemciler `url`i açar."""
    out: dict[str, Any] = {"kind": "link", "label": label_key, "url": url}
    if guide:
        out["guide"] = guide
    return out


class Provider:
    kind = "base"
    name = "?"
    subtitle_key = ""
    optional = False
    order = 50

    def fast(self, ctx: ProviderContext) -> dict[str, Any]:  # pragma: no cover - arayüz
        return {}

    async def slow(self, ctx: ProviderContext, fast: dict[str, Any]) -> dict[str, Any]:
        return {}

    def problems(self, state: dict[str, Any], ctx: ProviderContext) -> list[dict[str, Any]]:
        return []

    def legacy(self, state: dict[str, Any]) -> dict[str, Any]:
        """Eski /api/connections alanları: available, path, detail… (geriye uyum)."""
        return {"available": bool(state.get("installed")), "path": state.get("install_path")}
