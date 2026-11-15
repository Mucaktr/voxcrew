"""İçerik adresli çıktı kasası (-P0 D2).

Teslim anında çalışma klasöründeki dosya `<veri dizini>/deliverables/blobs/<sha256[:2]>/<sha256>` yoluna KOPYALANIR
(salt okunur; aynı içerik bir kez). Böylece ortak çalışma klasörü sonradan değişse de eski çıktı eski baytları gösterir.
Kasa çalışma klasörünü ve kullanıcı dizinlerini değiştirmez; blob yolu yalnızca sha256'dan türetilir (istemci yol veremez).

Sınırlar (D2, ayarlanabilir): dosya başına 100 MB, toplam 2 GB. Aşımda dosya KOPYALANMAZ, neden `status` ile döner
(`too_large` / `quota`) ve arayüz açık bir ileti gösterir. Ayar: `deliverables.vault.max_file_mb` / `max_total_mb`
(ayar dosyası ya da `STUDIO_VAULT_MAX_FILE_MB` / `STUDIO_VAULT_MAX_TOTAL_MB` ortam değişkeni).

Bu modül graf tablolarına dokunmaz; kasa dosyalarını yalnızca burası yazar.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import stat
import threading
import uuid
from pathlib import Path
from typing import Any

log = logging.getLogger("studio.deliverables.vault")

DEFAULT_MAX_FILE_MB = 100
DEFAULT_MAX_TOTAL_MB = 2048
CHUNK = 1024 * 1024
_SHA = re.compile(r"^[0-9a-f]{64}$")


def _mb(value: Any, default: int) -> int:
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        return default
    return n if n > 0 else default


def limits(settings: Any = None) -> tuple[int, int]:
    """(dosya başına bayt, toplam bayt)."""
    getter = getattr(settings, "get", None)
    # ortam değişkeni ayarın önüne geçer (ayar artık varsayılanlı: 100 / 2048)
    file_mb = (os.environ.get("STUDIO_VAULT_MAX_FILE_MB")
               or (getter("deliverables.vault.max_file_mb") if callable(getter) else None))
    total_mb = (os.environ.get("STUDIO_VAULT_MAX_TOTAL_MB")
                or (getter("deliverables.vault.max_total_mb") if callable(getter) else None))
    return (_mb(file_mb, DEFAULT_MAX_FILE_MB) * 1024 * 1024, _mb(total_mb, DEFAULT_MAX_TOTAL_MB) * 1024 * 1024)


def is_sha(value: Any) -> bool:
    return isinstance(value, str) and bool(_SHA.match(value))


def sha256_file(path: Path) -> tuple[str, int]:
    h, n = hashlib.sha256(), 0
    with path.open("rb") as fh:
        while chunk := fh.read(CHUNK):
            h.update(chunk)
            n += len(chunk)
    return h.hexdigest(), n


class Vault:
    def __init__(self, root: Path, settings: Any = None):
        self.root = Path(root) / "deliverables" / "blobs"
        self.settings = settings
        self._lock = threading.Lock()
        self._pending_lock = threading.Lock()  # pending.json oku-değiştir-yaz (purge_pending / pending_add / açılış temizliği)
        self._total: int | None = None
        # bekleyen silmeler, hâlâ unutulmamış bir çıktının kullandığı özeti silmesin (DeliverableService bağlar)
        self.live_shas: Any = None

    # ------------------------------------------------------------ yollar
    @staticmethod
    def rel(sha: str) -> str:
        return f"{sha[:2]}/{sha}"

    def path_for(self, sha: str) -> Path:
        """Blob yolu; yalnızca 64 hane onaltılık özetten türetilir (yol kaçışı imkânsız)."""
        if not is_sha(sha):
            raise ValueError("Geçersiz içerik özeti")
        return self.root / sha[:2] / sha

    def has(self, sha: str) -> bool:
        try:
            return is_sha(sha) and self.path_for(sha).is_file()
        except OSError:
            return False

    # ------------------------------------------------------------ boyut
    def total_size(self) -> int:
        with self._lock:
            if self._total is None:
                total = 0
                if self.root.is_dir():
                    for p in self.root.rglob("*"):
                        try:
                            if p.is_file() and not p.name.startswith(".tmp-"):
                                total += p.stat().st_size
                        except OSError:
                            pass
                self._total = total
            return self._total

    # ------------------------------------------------------------ yazma
    def put_file(self, src: Path) -> dict[str, Any]:
        """Dosyayı kasaya kopyalar. Dönüş: `{status, sha256?, size, blob?}`; status: stored | too_large | quota | missing.
        Boyut sınırı aşılırsa özet hesaplanmaz (büyük dosya okunmaz)."""
        max_file, max_total = limits(self.settings)
        try:
            size = src.stat().st_size
        except OSError:
            return {"status": "missing", "size": None}
        if size > max_file:
            return {"status": "too_large", "size": size}
        tmp = self.root / ".tmp-{}".format(uuid.uuid4().hex[:10])
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            h, n = hashlib.sha256(), 0
            with src.open("rb") as fin, tmp.open("wb") as fout:
                while chunk := fin.read(CHUNK):
                    n += len(chunk)
                    if n > max_file:
                        return {"status": "too_large", "size": n}
                    h.update(chunk)
                    fout.write(chunk)
            sha = h.hexdigest()
            dest = self.path_for(sha)
            if dest.is_file():  # aynı içerik zaten kasada
                return {"status": "stored", "sha256": sha, "size": n, "blob": self.rel(sha)}
            if self.total_size() + n > max_total:
                return {"status": "quota", "sha256": sha, "size": n}
            dest.parent.mkdir(parents=True, exist_ok=True)
            os.replace(tmp, dest)
            try:
                dest.chmod(stat.S_IREAD)  # salt okunur kopya
            except OSError:
                pass
            with self._lock:
                self._total = (self._total or 0) + n
            return {"status": "stored", "sha256": sha, "size": n, "blob": self.rel(sha)}
        except OSError:
            log.exception("kasa yazımı başarısız")
            return {"status": "missing", "size": None}
        finally:
            tmp.unlink(missing_ok=True)

    def iter_blobs(self) -> list[tuple[str, float]]:
        """Kasadaki [(sha256, değişiklik zamanı)]; geçici/yabancı dosyalar atlanır."""
        out: list[tuple[str, float]] = []
        if self.root.is_dir():
            for p in self.root.rglob("*"):
                try:
                    if p.is_file() and is_sha(p.name) and p.parent.name == p.name[:2]:
                        out.append((p.name, p.stat().st_mtime))
                except OSError:
                    pass
        return out

    # ------------------------------------------------------------ silinemeyen blob'lar (Windows: açık dosya)
    @property
    def pending_path(self) -> Path:
        return self.root.parent / "vault_pending.json"

    def pending(self) -> list[str]:
        try:
            raw = json.loads(self.pending_path.read_text("utf-8")) if self.pending_path.is_file() else []
        except (OSError, ValueError):
            return []
        return [s for s in raw if is_sha(s)] if isinstance(raw, list) else []

    def pending_add(self, shas: Any) -> None:
        """Unutma sırasında silinemeyen blob özetleri (içerik değil, yalnız sha256) sonra yeniden denenmek üzere yazılır."""
        with self._pending_lock:
            cur = self.pending()
            new = [s for s in dict.fromkeys([*cur, *shas]) if is_sha(s)]
            self._write_pending(new)

    def _write_pending(self, new: list[str]) -> None:
        try:
            if not new:
                self.pending_path.unlink(missing_ok=True)
                return
            self.pending_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.pending_path.with_name(f"{self.pending_path.name}.{uuid.uuid4().hex[:8]}.tmp")
            tmp.write_text(json.dumps(new), "utf-8")
            os.replace(tmp, self.pending_path)
        except OSError:
            log.exception("bekleyen kasa silmeleri yazılamadı")

    def purge_pending(self) -> int:
        """Bekleyen blob'ları yeniden silmeyi dener (açık tutamaç kapandıysa başarır); silinen sayıyı döner."""
        todo = self.pending()
        if not todo:
            return 0
        live: set[str] = set()
        if callable(self.live_shas):
            try:
                live = set(self.live_shas())
            except Exception:  # noqa: BLE001 - kullanımda mı bilinemiyorsa SİLME (veri kaybı > gecikme); bekleyen kalır
                log.exception("kasa kullanım denetimi başarısız")
                return 0
        left: list[str] = []
        deleted = 0
        for sha in todo:
            if sha in live or not self.has(sha):  # kullanımdakiler / zaten gitmiş olanlar listeden düşer (silinmez)
                continue
            if self.delete(sha):
                deleted += 1
            else:
                left.append(sha)
        with self._pending_lock:  # işlenirken eklenen yeni girdiler korunur: (güncel - işlenen) + kalan
            done = set(todo) - set(left)
            self._write_pending([s for s in dict.fromkeys([*left, *(s for s in self.pending() if s not in done)])])
        return deleted

    def delete(self, sha: str) -> bool:
        """Blob'u siler (unutma akışı için kanca; başka çıktı aynı özeti kullanıyorsa çağıran önce denetler)."""
        if not is_sha(sha):
            return False
        path = self.path_for(sha)
        try:
            size = path.stat().st_size
            path.chmod(stat.S_IWRITE | stat.S_IREAD)
            path.unlink()
        except OSError:
            return False
        with self._lock:
            if self._total is not None:
                self._total = max(0, self._total - size)
        return True
