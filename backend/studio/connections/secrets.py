"""Stüdyo veri dizinindeki `secrets.json`: isteğe bağlı API anahtarları (openai_compat vb.).

Kurallar: asla settings.json'a ya da depoya yazılmaz; dosya 0600 (POSIX) / yalnızca kullanıcı ACL'si (Windows,
icacls); yanıtlarda yalnızca maskeli gösterim (••••son4). Anahtar değerleri loglanmaz.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

from studio.changes import mask_value
from studio.config import atomic_write_text

_FLAGS = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
_log = logging.getLogger(__name__)
BACKUP_CAP = 5     # `.corrupt`, `.corrupt.1` … `.corrupt.4`
_RECOVERY = (
    "Dosya: {path}. Kurtarma: 1) Uygulamayı kapat. 2) {name}.corrupt dosyasını bir metin düzenleyicide aç; JSON'u (süslü parantez, "
    "tırnak, virgül) onarabiliyorsan {name} olarak kaydet. 3) Onaramıyorsan {name} dosyasını silme: önce yan klasöre taşı "
    "(kayıtlı anahtarların tümü kaybolur, anahtarları yeniden girersin). 4) Uygulamayı yeniden aç.",
    "File: {path}. Recovery: 1) Close the studio. 2) Open {name}.corrupt in a text editor; if you can repair the JSON "
    "(braces, quotes, commas) save it as {name}. 3) If you cannot, do not delete {name}: move it to another folder first "
    "(all stored keys are lost; you will re-enter them). 4) Reopen the studio.",
)


class SecretsCorrupt(RuntimeError):
    """secrets.json okunamadı/bozuk: yazma reddedilir, aksi halde kayıtlı tüm anahtarlar boş kümeyle ezilirdi (F02)."""


class SecretsNotProtected(SecretsCorrupt):
    """Dosya izinleri (Windows ACL) kısıtlanamadı: anahtarlar başkalarının okuyabileceği dosyaya yazılmaz (yazma reddedilir)."""


def display_path(p: Path) -> str:
    """Ana dizin `~` ile kısaltılır (kullanıcı adı yanıtlara/arayüze sızmasın); ana dizin dışındaki yol aynen kalır."""
    try:
        return "~/" + Path(p).relative_to(Path.home()).as_posix()
    except ValueError:
        return str(p)


def restrict_permissions(path: Path, platform: str | None = None, run: Any = subprocess.run) -> bool:
    """Dosyayı yalnızca geçerli kullanıcı okuyabilsin. Başarısızlık False döner (çağıran reddeder: `SecretStore._write`)."""
    platform = platform or sys.platform
    try:
        if platform == "win32":
            user = os.environ.get("USERNAME")
            if not user:
                return False
            # kalıtımı kes, var olan izinleri sil, yalnızca kullanıcıya tam yetki
            res = run(["icacls", str(path), "/inheritance:r", "/grant:r", f"{user}:(F)"], capture_output=True,
                      timeout=10, creationflags=_FLAGS)
            if getattr(res, "returncode", 0) != 0:      # F02/F03: icacls başarısızlığı sessiz "başarı" sayılmaz
                _log.warning("secrets dosyası ACL kısıtlaması başarısız (icacls çıkış kodu %s): %s", res.returncode, path)
                return False
            return True
        os.chmod(path, 0o600)
        return True
    except (OSError, subprocess.SubprocessError):
        return False


class SecretStore:
    def __init__(self, data_dir: Path, platform: str | None = None, run: Any = subprocess.run):
        self.path = Path(data_dir) / "secrets.json"
        self._platform = platform or sys.platform
        self._run = run
        self._lock = threading.Lock()
        self._logged = False    # bozuk-dosya hatası bozukluk başına bir kez loglanır (has()/is_corrupt() her çağrıda tekrarlamasın)

    def _load(self) -> tuple[dict[str, str], bool]:
        """(veri, güvenilir). Dosya yoksa ({}, True); okunamayan/bozuksa .corrupt yedeği alınır ve ({}, False)."""
        try:
            raw = self.path.read_text("utf-8")
        except FileNotFoundError:
            return {}, True
        except OSError:
            _log.error("secrets.json okunamadı (G/Ç hatası): %s", self.path)
            return {}, False
        try:
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("kök nesne değil")
        except ValueError:
            self._flag_corrupt()
            return {}, False
        self._logged = False
        return {str(k): str(v) for k, v in data.items()}, True

    def _flag_corrupt(self) -> None:
        """`.corrupt` yedeği al ve logla (yol var, değer yok); yazmalar `set()`te reddedilir.
        Var olan yedek ASLA ezilmez: içerik farklıysa `.corrupt.1`…`.corrupt.4`e yazılır, hepsi doluysa yeni kopya alınmaz."""
        try:
            raw = self.path.read_bytes()
            for i in range(BACKUP_CAP):
                dst = self.path.with_name(self.path.name + ".corrupt" + (f".{i}" if i else ""))
                if not dst.exists():
                    shutil.copy2(self.path, dst)
                    restrict_permissions(dst, self._platform, self._run)   # copy2 ACL taşımaz: yedek düz metin anahtar içerebilir
                    break
                if dst.read_bytes() == raw:
                    break
        except OSError:
            pass
        if not self._logged:
            self._logged = True
            _log.error("%s bozuk; .corrupt yedeği alındı, yazmalar reddedilecek (değerler loglanmaz): %s",
                       self.path.name, display_path(self.path))

    def is_corrupt(self) -> bool:
        """Dosya var ama okunamıyor/bozuk: arayüz "anahtar yok" yerine uyarı + kurtarma adımları göstersin."""
        return not self._load()[1]

    def recovery(self, lang: str = "tr") -> str:
        """Kurtarma adımları (TR/EN); silme önerilmez, önce `.corrupt` yedeği denenir."""
        tr, en = _RECOVERY
        return (en if lang == "en" else tr).format(path=display_path(self.path), name=self.path.name)

    def _write(self, data: dict[str, str]) -> None:
        def _lock_down(tmp: Path) -> None:      # içerik yazılmadan ÖNCE: Windows'ta 0600 etkisiz, geçici dosya miras ACL taşır
            if not restrict_permissions(tmp, self._platform, self._run):
                from studio.i18n import request_lang  # noqa: PLC0415

                raise SecretsNotProtected(
                    "{n} için yalnız-kullanıcı izni ayarlanamadı; anahtar yazılmadı. icacls çalışıyor mu, veri klasörü yazılabilir mi kontrol et."
                    .format(n=self.path.name) if request_lang() != "en" else
                    "Could not restrict permissions for {n} to the current user; the key was not written. "
                    "Check that icacls works and the data folder is writable.".format(n=self.path.name))

        atomic_write_text(self.path, json.dumps(data, ensure_ascii=False, indent=2), private=True, prepare=_lock_down)
        restrict_permissions(self.path, self._platform, self._run)

    def _read(self) -> dict[str, str]:
        return self._load()[0]

    def get(self, name: str) -> str | None:
        return self._read().get(name) or None

    def has(self, name: str) -> bool:
        return bool(self.get(name))

    def masked(self, name: str) -> str | None:
        v = self.get(name)
        return mask_value(v) if v else None

    def set(self, name: str, value: str | None) -> None:
        with self._lock:
            data, ok = self._load()
            if not ok:
                from studio.i18n import request_lang  # noqa: PLC0415 - istek dilinde TR/EN (account/service.py deseni)

                lang = request_lang()
                head = ("{n} is corrupt or unreadable; stored keys were not overwritten (backup: {n}.corrupt). "
                        if lang == "en" else
                        "{n} bozuk ya da okunamadı; kayıtlı anahtarlar üzerine yazılmadı (yedek: {n}.corrupt). ")
                raise SecretsCorrupt(head.format(n=self.path.name) + self.recovery(lang))
            if value:
                data[name] = value
            else:
                data.pop(name, None)
            self._write(data)
