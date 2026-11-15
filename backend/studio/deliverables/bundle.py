""""Paket (.zip)": bir koşunun çıktıları ya da seçilen çıktılar tek zip.

Sözleşme (karar: yalnız arayüz, K1 titizliği):
- `POST /api/deliverables/zip` `{run_id | ids[], unmasked?, dry_run?}` ve `POST /api/deliverables/{id}/zip` `{unmasked?, dry_run?}`
  (paket çıktısı ya da tek çıktı). Kapı = `ui_present_strict` (D1 `/original` ile aynı: arayüz jetonu + bağlı çerez + aynı
  köken Origin + `X-Studio-Client` yok + istek stüdyonun başlattığı süreçten gelmiyor); POST olduğundan tarayıcı Origin
  gönderir. MCP / kanca / alt süreç / Origin'siz / çapraz site = 403. Dakikada en çok 10 indirme (reveal gibi), 20 önizleme.
- `dry_run: true` zip üretmez: onay penceresinin göstereceği sayı, boyut, atlananlar ve maskeleme bilgisi döner (yol yok).
- İçerik YALNIZ kasa baytlarından gelir (`Vault.path_for(sha256)`); çalışma klasörüne (canlı dosya) hiç bakılmaz. Kasada
  olmayan (`forgotten` / `missing` / `too_large` / `quota` / kasaya hiç alınmamış) kalemler zip'e girmez; neden
  `MANIFEST.txt`'e ve yanıta yazılır. Kasa baytlarının sha256'sı kayıtla karşılaştırılır; uyuşmayan (bozuk) blob atlanır.
- Metin dosyaları (`is_masked_text`) varsayılan MASKELİ girer (`redact_text`, D1 / indirme ile aynı); kullanıcı açıkça
  `unmasked: true` seçerse kasa baytları olduğu gibi girer ve `X-Studio-Unmasked: 1` + MANIFEST uyarısı eklenir. İkili
  dosyalar olduğu gibi (D1: maskelenemez). Sonuç metni (`source: output`) grafikte durur, kasada değildir: her zaman maskeli.
- Üye adları sunucuda üretilir ve temizlenir: `..`/`.`/boş parça atılır, `\\` ve `/` ayraç, sürücü/UNC iki nokta üstüste
  `_` olur, mutlak yol olmaz, NFC, kontrol / çift yönlü karakterler atılır, Windows ayrılmış adları öne `_` alır, uzunluk
  sınırı, büyük-küçük harfe duyarsız tekilleştirme (`ad (2).uzantı`), dosya/klasör çakışması giderilir.
- Sınırlar: dosya başına = kasa `max_file_mb`; toplam (sıkıştırılmamış) varsayılan 512 MB (`deliverables.zip.max_mb` ya da
  `STUDIO_ZIP_MAX_MB`); dosya sayısı 500 (`deliverables.zip.max_files`); istekte en çok 200 kimlik. Aşan kalem atlanır.
- Yanıt: geçici (diskte taşan) dosyadan akar; `attachment`, `nosniff`, `no-store`, uzunluk bilinir. Eşzamanlı en çok 2 üretim.
- Olay `deliverable.zipped {run_id?, count, skipped, bytes, unmasked}` — kimlik listesi, ad, yol YOK.
- Grafiğe YAZMAZ (Delivery kaydı yok: çok kalemli paket tek `DELIVERY_OF` kaydına sığmaz); dolayısıyla CDC günlüğü ve MCP
  sansürü değişmez.
"""

from __future__ import annotations

import asyncio
import codecs
import hashlib
import os
import re
import tempfile
import threading
import time
import unicodedata
import zipfile
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from studio.deliverables.formats import BINARY_EXT
from studio.deliverables.vault import is_sha, limits as vault_limits

if TYPE_CHECKING:
    from studio.api import Studio
    from studio.deliverables.service import DeliverableService

USER_ONLY_ZIP = "Zip paketi yalnızca uygulama arayüzünden, kullanıcı tarafından indirilebilir"
MAX_IDS = 200
DEFAULT_MAX_TOTAL_MB = 512
DEFAULT_MAX_FILES = 500
RUN_SCAN = 500
MANIFEST_NAME = "MANIFEST.txt"
# maskeleme kararı UZANTIYA göre "metin mi" değil, "bilinen ikili mi" sorusudur. Yalnız bilinen ikili biçimler olduğu gibi
# girer (maskelenemez); geri kalan her dosya UTF-8 (NUL'suz) çözülürse MASKELENİR, çözülmezse atlanır (`unmaskable`).
KNOWN_BINARY = BINARY_EXT | {".woff", ".woff2", ".ttf", ".otf", ".eot", ".wasm"}
SNIFF = 64 * 1024
MASK_MAX = 16 * 1024 * 1024  # maskelenecek metin dosyası üst sınırı (regex tüm metni belleğe alır); aşan = atlanır
MAX_CONCURRENT = 2
BUILD_RATE_MAX, PLAN_RATE_MAX, RATE_WINDOW_S = 10, 20, 60.0
SPOOL_MAX = 16 * 1024 * 1024  # bellekte tutulan üst sınır; aşınca geçici dosyaya taşar (otomatik silinir)
CHUNK = 1024 * 1024
_STORED_EXT = frozenset({".pptx", ".xlsx", ".docx", ".odt", ".ods", ".odp", ".zip", ".gz", ".tgz", ".7z", ".rar", ".bz2",
                         ".xz", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp3", ".mp4", ".webm", ".m4a", ".mov",
                         ".mkv", ".ogg", ".flac", ".woff", ".woff2", ".pdf"})

# neden kodları (arayüz yerelleştirir; MANIFEST yerelleştirir)
REASONS = ("forgotten", "missing", "too_large", "quota", "not_vaulted", "corrupt", "not_found", "zip_size_cap",
           "zip_files_cap", "in_bundle", "text_too_large", "unmaskable", "run_scan_cap")

_L: dict[str, dict[str, str]] = {
    "title": {"tr": "Çıktı paketi", "en": "Output bundle"},
    "created": {"tr": "Oluşturma", "en": "Created"},
    "source": {"tr": "Kaynak", "en": "Source"},
    "run": {"tr": "Koşu", "en": "Run"},
    "selection": {"tr": "{n} seçilen çıktı", "en": "{n} selected outputs"},
    "mode": {"tr": "Metin dosyaları", "en": "Text files"},
    "mode_masked": {"tr": "maskeli (gizli görünen değerler ••••)", "en": "masked (secret-looking values replaced with ••••)"},
    "mode_unmasked": {"tr": "MASKELENMEMİŞ - gizli görünen değerler içerebilir; paylaşmadan önce kontrol et",
                      "en": "UNMASKED - may contain secret-looking values; check before sharing"},
    "binary_note": {"tr": "Bilinen ikili biçimler (pptx, xlsx, zip, görsel, yazı tipi…) olduğu gibi eklenir; maskelenemez. Diğer tüm dosyalar "
                          "UTF-8 metin olarak maskelenir; çözülemeyenler atlanır.",
                    "en": "Known binary formats (pptx, xlsx, zip, images, fonts…) are included as-is; they cannot be masked. All other files "
                          "are masked as UTF-8 text; those that cannot be decoded are skipped."},
    "vault_note": {"tr": "İçerik teslim anında kasaya alınan kopyalardandır; çalışma klasörü okunmadı.",
                   "en": "Contents come from the copies vaulted at delivery; the working folder was not read."},
    "files": {"tr": "DOSYALAR ({n})", "en": "FILES ({n})"},
    "skipped": {"tr": "ATLANANLAR ({n})", "en": "SKIPPED ({n})"},
    "merged": {"tr": "PAKETLE BİRLEŞTİRİLEN DOSYALAR ({n}; uygulama paketi klasöründe zaten var)",
               "en": "FILES MERGED INTO A BUNDLE ({n}; already in the app bundle folder)"},
    "none": {"tr": "(yok)", "en": "(none)"},
    "cols": {"tr": "ad | tür | boyut | sha256 | sürüm | koşu | metin", "en": "name | kind | size | sha256 | version | run | text"},
    "text_masked": {"tr": "maskeli", "en": "masked"},
    "text_unmasked": {"tr": "maskelenmemiş", "en": "unmasked"},
    "text_binary": {"tr": "ikili", "en": "binary"},
    "sha_note": {"tr": "sha256 = zip içindeki baytların özeti" , "en": "sha256 = digest of the bytes inside the zip"},
    "r_forgotten": {"tr": "unutuldu (kasa kopyası silindi)", "en": "forgotten (vault copy removed)"},
    "r_missing": {"tr": "kasada yok (dosya teslim anında alınamadı)", "en": "not in the vault (file could not be captured at delivery)"},
    "r_too_large": {"tr": "kasa dosya sınırını aştı", "en": "exceeded the vault file limit"},
    "r_quota": {"tr": "kasa toplam kotası doldu", "en": "vault total quota was full"},
    "r_not_vaulted": {"tr": "kasaya hiç alınmadı (eski kayıt)", "en": "never vaulted (older record)"},
    "r_corrupt": {"tr": "kasa kopyası kayıtla uyuşmuyor", "en": "vault copy does not match the record"},
    "r_not_found": {"tr": "çıktı bulunamadı", "en": "output not found"},
    "r_zip_size_cap": {"tr": "zip toplam boyut sınırı aşılırdı", "en": "would exceed the zip total size limit"},
    "r_zip_files_cap": {"tr": "zip dosya sayısı sınırı aşılırdı", "en": "would exceed the zip file count limit"},
    "r_in_bundle": {"tr": "uygulama paketi klasöründe", "en": "in the app bundle folder"},
    "r_unmaskable": {"tr": "UTF-8 metin değil ve bilinen ikili biçim de değil: maskelenemez; yalnız maskelenmemiş kipte eklenir",
                     "en": "not UTF-8 text and not a known binary format: cannot be masked; only included in unmasked mode"},
    "r_run_scan_cap": {"tr": "koşuda çok çıktı var: ilk {n} çıktı tarandı, kalanlar pakete GİRMEDİ",
                       "en": "the run has too many outputs: the first {n} were scanned, the rest are NOT in the bundle"},
    "r_text_too_large": {"tr": "metin dosyası maskelenemeyecek kadar büyük (16 MB üstü); yalnız maskelenmemiş kipte eklenir",
                         "en": "text file too large to mask (over 16 MB); only included in unmasked mode"},
}


def _t(key: str, lang: str, **kw: Any) -> str:
    text = _L[key]["en" if lang == "en" else "tr"]
    return text.format(**kw) if kw else text


# ------------------------------------------------------------------ üye adı temizliği
_ILLEGAL = re.compile(r'[<>:"|?*\x00-\x1f\x7f-\x9f]')  # C0 + C1 denetim karakterleri (NEL \x85, CSI \x9b…) dahil
# görünmez / yön / satır ayırıcı karakterler: ZWSP-RLM, bidi gömme+geçersiz kılma, ALM, yumuşak tire, Mongol VS, U+2028/2029,
# kelime birleştirici…görünmez işlemciler, bidi izolasyon, BOM
_INVISIBLE = re.compile("[​-‏‪-‮⁠-⁤⁦-⁩﻿؜  ­᠎]")
_LABEL_CTRL = re.compile("[\x00-\x1f\x7f-\x9f  ]")
_SPLIT = re.compile(r"[\\/]+")
_RESERVED = frozenset({"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))})
SEGMENT_MAX = 100
PATH_MAX = 200
DEPTH_MAX = 10


def _clip(seg: str, limit: int) -> str:
    """Kırpar; sonuç hiçbir zaman `.`/boşlukla bitmez (Windows çıkarımda atar → iki üye aynı ada düşerdi)."""
    if len(seg) > limit:
        stem, dot, ext = seg.rpartition(".")
        if dot and 0 < len(ext) <= 12 and stem:
            stem = stem[: max(1, limit - len(ext) - 1)].rstrip(" .") or "_"
            seg = stem + "." + ext
        else:
            seg = seg[:limit]
            k = seg.rfind(".")
            if k != -1 and len(seg) - k - 1 <= 12:  # kırpma yeni bir ".xxx" sonu (ör. ".png") ÜRETMEZ
                seg = seg[:k] + "_" + seg[k + 1:]
    return seg.rstrip(" .")


def safe_segment(seg: str) -> str:
    seg = unicodedata.normalize("NFC", str(seg))
    seg = _INVISIBLE.sub("", seg)
    seg = _ILLEGAL.sub("_", seg).strip(" ").rstrip(" .")
    if not seg:
        return ""
    if seg.split(".")[0].strip().lower() in _RESERVED:
        seg = "_" + seg
    return _clip(seg, SEGMENT_MAX)


def safe_path(raw: Any, fallback: str = "dosya") -> str:
    """Zip üye adı: göreli, `/` ayraçlı, kök dışına çıkamaz (zip-slip yok). Kaçış parçaları (`..`, `.`, boş) atılır; her
    parça `.`/boşlukla bitmez. Uzunluk sınırı aşılırsa BAŞTAKİ parçalar bütün olarak atılır (kısmi parça / baştaki `/` yok)."""
    segs = [s for s in (safe_segment(p) for p in _SPLIT.split(unicodedata.normalize("NFC", str(raw or "")))) if s]
    segs = segs[-DEPTH_MAX:]
    if segs and len("/".join(segs)) > PATH_MAX:
        kept: list[str] = []
        total = 0
        for seg in reversed(segs):
            add = len(seg) + (1 if kept else 0)
            if total + add > PATH_MAX:
                break
            kept.insert(0, seg)
            total += add
        segs = kept or [segs[-1]]
    return "/".join(segs).lstrip("/") or fallback


def clean_label(value: Any, limit: int = 160) -> str:
    """MANIFEST / `skipped[].name` / özet için serbest etiket: tek satır (satır sonu, C0/C1, U+2028/2029, görünmez ve yön
    karakterleri atılır), sütun ayracı `|` → `¦`, uzunluk sınırlı. Ad üretmez; yalnız gösterim."""
    text = unicodedata.normalize("NFC", str(value if value is not None else ""))
    text = _INVISIBLE.sub("", text)
    text = _LABEL_CTRL.sub(" ", text).replace("|", "¦")
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


class _Names:
    """Tekil üye adları: büyük-küçük harfe duyarsız, dosya ↔ klasör çakışması yok, `MANIFEST.txt` ayrılmış."""

    def __init__(self) -> None:
        self.files: set[str] = {MANIFEST_NAME.casefold()}
        self.dirs: set[str] = set()

    def _clash(self, segs: list[str]) -> int | None:
        """Çakışan parçanın dizini (yok = None): bir üst dizin zaten DOSYA ise o parça, aksi hâlde son parça."""
        keys = [s.casefold() for s in segs]
        for i in range(1, len(keys)):
            if "/".join(keys[:i]) in self.files:
                return i - 1
        full = "/".join(keys)
        return len(segs) - 1 if full in self.files or full in self.dirs else None

    def take(self, name: str) -> str:
        orig = name.split("/")
        segs, counts = list(orig), [1] * len(orig)
        while (lvl := self._clash(segs)) is not None:
            counts[lvl] += 1
            seg = orig[lvl]
            stem, dot, ext = seg.rpartition(".")
            if lvl != len(orig) - 1 or not dot or not stem:
                stem, ext = seg, ""
            else:
                ext = "." + ext
            tag = f" ({counts[lvl]})"  # sayaç hiçbir zaman kırpılmaz (döngü mutlaka biter)
            segs[lvl] = stem[: max(1, SEGMENT_MAX - len(tag) - len(ext))] + tag + ext
        cand = "/".join(segs)
        key = cand.casefold()
        self.files.add(key)
        parts = key.split("/")
        for i in range(1, len(parts)):
            self.dirs.add("/".join(parts[:i]))
        return cand


# ------------------------------------------------------------------ sınırlar ve hız
def zip_limits(settings: Any = None) -> tuple[int, int, int]:
    """(üye başına bayt [kasa dosya sınırı], toplam bayt, dosya sayısı)."""
    getter = getattr(settings, "get", None)

    def pick(env: str, key: str, default: int) -> int:
        raw = os.environ.get(env) or (getter(key) if callable(getter) else None)
        try:
            n = int(float(raw))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return default
        return n if n > 0 else default

    per_entry, _vault_total = vault_limits(settings)
    total = pick("STUDIO_ZIP_MAX_MB", "deliverables.zip.max_mb", DEFAULT_MAX_TOTAL_MB) * 1024 * 1024
    return per_entry, total, pick("STUDIO_ZIP_MAX_FILES", "deliverables.zip.max_files", DEFAULT_MAX_FILES)


class _Rate:
    def __init__(self, limit: int) -> None:
        self.limit = limit
        self._hits: deque[float] = deque()
        self._lock = threading.Lock()

    def hit(self) -> bool:
        now = time.monotonic()
        with self._lock:
            while self._hits and now - self._hits[0] > RATE_WINDOW_S:
                self._hits.popleft()
            if len(self._hits) >= self.limit:
                return False
            self._hits.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


BUILD_RATE, PLAN_RATE = _Rate(BUILD_RATE_MAX), _Rate(PLAN_RATE_MAX)
_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT)


# ------------------------------------------------------------------ plan
@dataclass
class Entry:
    name: str
    kind: str
    version: int
    run_id: str
    did: str
    when: str | None
    size: int                       # zip'e girecek bayt (önizlemede tahmin; metin maskeleme sonrası kesinleşir)
    sha256: str                     # kasadaki kaydın özeti (kaynak)
    text: str = "binary"            # masked | unmasked | binary
    blob: Path | None = None        # kasa yolu (yalnız sha256'dan türetilir)
    data: bytes | None = None       # sonuç metni (grafikten, maskeli)


@dataclass
class Skip:
    name: str
    reason: str
    did: str = ""
    run_id: str = ""

    def __post_init__(self) -> None:
        self.name = clean_label(self.name)  # ham ad satır sonu / sahte satır taşıyamaz
        self.run_id = clean_label(self.run_id, 200)


@dataclass
class Plan:
    entries: list[Entry] = field(default_factory=list)
    skipped: list[Skip] = field(default_factory=list)
    merged: list[Skip] = field(default_factory=list)
    run_id: str | None = None
    run_title: str | None = None
    zip_name: str = "ciktilar.zip"
    unmasked: bool = False

    @property
    def total(self) -> int:
        return sum(e.size for e in self.entries)

    @property
    def masked_text(self) -> int:
        return sum(1 for e in self.entries if e.text in ("masked", "unmasked"))


def _skip_reason(p: dict[str, Any], has_blob: bool) -> str:
    status = str(p.get("vault_status") or "")
    if status == "forgotten":
        return "forgotten"
    if status in ("too_large", "quota"):
        return status
    if status == "missing":
        return "missing"
    return "missing" if status == "stored" or has_blob else "not_vaulted"  # kayıt var ama kasada yok / kasaya hiç alınmamış


def _norm(path: Any) -> str:
    return str(path or "").replace("\\", "/").strip("/")


def _bundle_dir(p: dict[str, Any]) -> str | None:
    full, entry = _norm(p.get("path")), _norm(p.get("entry"))
    if not full or not entry or not full.endswith(entry):
        return None
    return full[: len(full) - len(entry)]


def resolve(svc: "DeliverableService", ids: list[str], *, unmasked: bool, run_id: str | None = None,
            scan_capped: int = 0) -> Plan:
    """Çıktı kimliklerinden zip planı. Dosyaya DOKUNMAZ (yalnız kasa `stat`); zip'e girecek/atlanacak kalemleri ve
    tekilleştirilmiş, temizlenmiş üye adlarını belirler."""
    per_entry, total_cap, files_cap = zip_limits(svc.settings)
    plan = Plan(run_id=run_id, unmasked=unmasked)
    if scan_capped:  # koşu sınırdan fazla çıktı taşıyor; fazlası pakete GİRMEDİ (sessiz kayıp yok)
        plan.skipped.append(Skip(f">{scan_capped}", "run_scan_cap", "", run_id or ""))
    nodes: list[dict[str, Any]] = []
    for did in ids:
        node = svc.store.find("Deliverable", did)
        if not node:
            plan.skipped.append(Skip(name=did[:60], reason="not_found", did=did))
        else:
            nodes.append(node)
    bundle_keys: dict[str, str] = {}  # tam normalleşmiş yol → sha256 (paket manifestinden)
    for node in nodes:
        p = node["props"]
        base = _bundle_dir(p) if p.get("source") == "bundle" and p.get("vault_status") != "forgotten" else None
        if base is not None:
            for m in p.get("manifest") or []:
                if isinstance(m, dict) and is_sha(m.get("sha256")):
                    bundle_keys[base + _norm(m.get("path"))] = str(m["sha256"])
    names = _Names()
    for node in nodes:
        p = node["props"]
        did, run = str(p.get("id") or node["id"]), str(p.get("run_id") or "")
        src, kind = p.get("source"), str(p.get("kind") or "other")
        version = int(p.get("version") or 1)
        when = p.get("created_at") or node.get("created_at")
        label = str(p.get("name") or p.get("title") or did)
        if not plan.run_title and run_id and run == run_id:
            plan.run_title = clean_label(p.get("run_title") or "", 200) or None
        if p.get("vault_status") == "forgotten":
            plan.skipped.append(Skip(label, "forgotten", did, run))
            continue
        if src == "output":
            from studio.deliverables.service import redact
            text = redact(svc._output_text(p))
            data = text.encode("utf-8")
            if not data.strip():
                plan.skipped.append(Skip(label, "missing", did, run))
            elif len(data) > per_entry:
                plan.skipped.append(Skip(label, "too_large", did, run))
            else:
                plan.entries.append(Entry(names.take(safe_path(p.get("name"), "sonuc.md")), kind, version, run, did, when,
                                          len(data), hashlib.sha256(data).hexdigest(), "masked", None, data))
            continue
        if src == "bundle":
            folder = safe_path(p.get("name") or p.get("title"), "uygulama")
            for m in p.get("manifest") or []:
                if not isinstance(m, dict):
                    continue
                rel = str(m.get("path") or "")
                shown = f"{folder}/{rel}"
                sha = m.get("sha256")
                blob = svc.vault.path_for(sha) if svc.vault is not None and is_sha(sha) and svc.vault.has(sha) else None
                if blob is None:
                    why = "forgotten" if m.get("forgotten") else _skip_reason(p, False)  # unutma: girdi sha256'sını yitirir
                    plan.skipped.append(Skip(shown, why, did, run))
                    continue
                _add_blob(plan, names, blob, safe_path(shown, "uygulama/dosya"), kind="app", version=version, run=run,
                          did=did, when=when, sha=str(sha), shown=shown, unmasked=unmasked, per_entry=per_entry, orig=rel)
            continue
        # source == "file": YALNIZ kasa kopyası (canlı çalışma dosyası asla)
        blob = svc._blob(p)
        key = _norm(p.get("path"))
        if blob is not None and key and bundle_keys.get(key) == p.get("sha256"):
            plan.merged.append(Skip(label, "in_bundle", did, run))
            continue
        if blob is None:
            plan.skipped.append(Skip(label, _skip_reason(p, bool(p.get("blob"))), did, run))
            continue
        rel = str(p.get("path") or p.get("name") or "dosya")
        _add_blob(plan, names, blob, safe_path(rel, safe_path(p.get("name"), "dosya")), kind=kind, version=version, run=run,
                  did=did, when=when, sha=str(p.get("sha256")), shown=label, unmasked=unmasked, per_entry=per_entry, orig=rel)
    # sayı ve toplam sınırı (sıra korunur; aşan kalem atlanır)
    kept: list[Entry] = []
    used = 0
    for e in plan.entries:
        if len(kept) >= files_cap:
            plan.skipped.append(Skip(e.name, "zip_files_cap", e.did, e.run_id))
        elif used + e.size > total_cap:
            plan.skipped.append(Skip(e.name, "zip_size_cap", e.did, e.run_id))
        else:
            kept.append(e)
            used += e.size
    plan.entries = kept
    return plan


def _sniff_text(blob: Path) -> bool:
    """İlk 64 KB: NUL yok ve (kesik son karaktere izin veren) UTF-8 çözülüyor mu."""
    try:
        with blob.open("rb") as fh:
            head = fh.read(SNIFF)
    except OSError:
        return False
    if b"\x00" in head:
        return False
    try:
        codecs.getincrementaldecoder("utf-8")().decode(head, final=False)
    except UnicodeDecodeError:
        return False
    return True


def _add_blob(plan: Plan, names: _Names, blob: Path, name: str, *, kind: str, version: int, run: str, did: str,
              when: Any, sha: str, shown: str, unmasked: bool, per_entry: int, orig: str = "") -> None:
    try:
        size = blob.stat().st_size
    except OSError:
        plan.skipped.append(Skip(shown, "missing", did, run))
        return
    if size > per_entry:
        plan.skipped.append(Skip(shown, "too_large", did, run))
        return
    # ikili/metin kararı KIRPILMAMIŞ özgün adın uzantısıyla verilir (temizlik/kırpma bir uzantıyı ikiliye çeviremez)
    if Path(str(orig or name).replace("\\", "/")).suffix.lower() in KNOWN_BINARY:
        mode = "binary"
    elif unmasked:
        mode = "unmasked"  # kullanıcı açıkça istedi: ham baytlar (maskelenmedi)
    else:
        if not _sniff_text(blob):  # UTF-8 değil / NUL var (UTF-16, bilinmeyen ikili): maskelenemez → ham girmez
            plan.skipped.append(Skip(shown, "unmaskable", did, run))
            return
        if size > MASK_MAX:  # maskelenemeyen metin asla maskesiz sızdırılmaz
            plan.skipped.append(Skip(shown, "text_too_large", did, run))
            return
        mode = "masked"
    plan.entries.append(Entry(names.take(name), kind, version, run, did, when, size, sha, mode, blob, None))


# ------------------------------------------------------------------ üretim
def _dos_time(when: Any) -> tuple[int, int, int, int, int, int]:
    try:
        dt = datetime.fromisoformat(str(when).replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        if dt.year >= 1980:
            return (dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second - dt.second % 2)
    except (TypeError, ValueError):
        pass
    now = time.gmtime()
    return (now.tm_year, now.tm_mon, now.tm_mday, now.tm_hour, now.tm_min, now.tm_sec - now.tm_sec % 2)


def _info(name: str, when: Any, stored: bool, size: int) -> zipfile.ZipInfo:
    zi = zipfile.ZipInfo(name, _dos_time(when))
    zi.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
    zi.external_attr = 0o644 << 16
    zi.create_system = 3
    zi.file_size = size
    return zi


def _strict_utf8(raw: bytes) -> str | None:
    if bytes([0]) in raw:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _file_sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


def manifest_text(plan: Plan, rows: list[tuple[Entry, str, int]], lang: str, *, total_cap: int) -> str:
    from studio.deliverables.service import redact
    out = [f"{_t('title', lang)}", "=" * 40,
           f"{_t('created', lang)}: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"]
    if plan.run_id:
        out.append(f"{_t('run', lang)}: {clean_label(plan.run_id, 200)}"
                   + (f" ({clean_label(redact(plan.run_title), 200)})" if plan.run_title else ""))
    else:
        out.append(f"{_t('source', lang)}: {_t('selection', lang, n=len(rows) + len(plan.skipped))}")
    out.append(f"{_t('mode', lang)}: {_t('mode_unmasked' if plan.unmasked else 'mode_masked', lang)}")
    out += [_t("binary_note", lang), _t("vault_note", lang), _t("sha_note", lang), ""]
    out += [f"{_t('files', lang, n=len(rows))}", _t("cols", lang)]
    for e, sha, size in rows:
        out.append(" | ".join([e.name, clean_label(e.kind, 40), str(size), sha, f"v{int(e.version)}", clean_label(e.run_id, 200) or "-",
                               _t(f"text_{e.text}", lang)]))
    if not rows:
        out.append(_t("none", lang))
    out += ["", _t("skipped", lang, n=len(plan.skipped))]
    for s in plan.skipped:
        out.append(f"{s.name} | {_t('r_' + s.reason, lang, n=RUN_SCAN)}")
    if not plan.skipped:
        out.append(_t("none", lang))
    if plan.merged:
        out += ["", _t("merged", lang, n=len(plan.merged))]
        out += [f"{s.name} | {_t('r_in_bundle', lang)}" for s in plan.merged]
    return "\n".join(out) + "\n"


def build(svc: "DeliverableService", plan: Plan, lang: str) -> tuple[Any, int, Plan]:
    from studio.deliverables.service import redact
    """Zip'i geçici (diskte taşan) dosyaya yazar → (dosya, bayt, plan). Kasa baytları sha256 ile doğrulanır; bozuk blob
    atlanır. Toplam sınır gerçek bayt sayısıyla uygulanır (maskeleme boyutu değiştirebilir)."""
    _per_entry, total_cap, _files = zip_limits(svc.settings)
    spool = tempfile.SpooledTemporaryFile(max_size=SPOOL_MAX)  # noqa: SIM115 - akış bitince çağıran kapatır
    rows: list[tuple[Entry, str, int]] = []
    used = 0
    try:
        with zipfile.ZipFile(spool, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as zf:
            for e in list(plan.entries):
                try:
                    if e.data is not None:
                        data: bytes | None = e.data
                        sha_out = hashlib.sha256(data).hexdigest()
                        size = len(data)
                    elif e.text == "masked":
                        assert e.blob is not None
                        raw = e.blob.read_bytes()
                        if hashlib.sha256(raw).hexdigest() != e.sha256:
                            plan.skipped.append(Skip(e.name, "corrupt", e.did, e.run_id))
                            continue
                        text = _strict_utf8(raw)  # kesin çözüm: çözülemeyen / NUL'lu dosya maskelenmeden girmez
                        if text is None:
                            plan.skipped.append(Skip(e.name, "unmaskable", e.did, e.run_id))
                            continue
                        data = redact(text).encode("utf-8")
                        sha_out, size = hashlib.sha256(data).hexdigest(), len(data)
                    else:
                        assert e.blob is not None
                        if _file_sha(e.blob) != e.sha256:  # kasa kopyası kayıtla uyuşmuyor (bozulma / kurcalama)
                            plan.skipped.append(Skip(e.name, "corrupt", e.did, e.run_id))
                            continue
                        data, sha_out, size = None, e.sha256, e.blob.stat().st_size
                except OSError:
                    plan.skipped.append(Skip(e.name, "missing", e.did, e.run_id))
                    continue
                if used + size > total_cap:
                    plan.skipped.append(Skip(e.name, "zip_size_cap", e.did, e.run_id))
                    continue
                zi = _info(e.name, e.when, Path(e.name).suffix.lower() in _STORED_EXT, size)
                if data is not None:
                    zf.writestr(zi, data)
                else:
                    assert e.blob is not None
                    try:
                        src = e.blob.open("rb")  # zip'e yazmadan ÖNCE açılır: blob bu arada silindiyse (unutma) üye yarım kalmaz
                    except OSError:
                        plan.skipped.append(Skip(e.name, "missing", e.did, e.run_id))
                        continue
                    with src, zf.open(zi, "w", force_zip64=size >= 0x7FFFFFFF) as dst:
                        while chunk := src.read(CHUNK):
                            dst.write(chunk)
                used += size
                rows.append((e, sha_out, size))
            zi = _info(MANIFEST_NAME, None, False, 0)
            zf.writestr(zi, manifest_text(plan, rows, lang, total_cap=total_cap).encode("utf-8"))
        plan.entries = [r[0] for r in rows]
        size = spool.tell()
        spool.seek(0)
        return spool, size, plan
    except BaseException:
        spool.close()
        raise


async def _stream(spool: Any) -> AsyncIterator[bytes]:
    try:
        while True:
            chunk = await asyncio.to_thread(spool.read, CHUNK)
            if not chunk:
                break
            yield chunk
    finally:
        spool.close()


# ------------------------------------------------------------------ uç noktalar
def _summary(plan: Plan, *, dry: bool) -> dict[str, Any]:
    return {"ok": True, "dry_run": dry, "name": plan.zip_name, "count": len(plan.entries), "bytes": plan.total,
            "unmasked": plan.unmasked, "masked_text": plan.masked_text,
            "skipped": [{"name": s.name, "reason": s.reason} for s in plan.skipped],
            "run_scan_cap": any(s.reason == "run_scan_cap" for s in plan.skipped),
            "merged": len(plan.merged)}


def _zip_name(plan: Plan, fallback: str) -> str:
    from studio.deliverables.service import slug_name
    base = re.sub(r"\.{2,}", "-", slug_name(plan.run_title or fallback, "ciktilar"))  # indirme adında ".." yok
    return f"{safe_segment(base)[:100].strip('.-_ ') or 'ciktilar'}.zip"


def build_router(studio: "Studio", get_service: Any) -> APIRouter:
    r = APIRouter(tags=["deliverables"])

    async def strict(request: Request) -> None:
        from studio.presence import ui_present_strict
        if not await asyncio.to_thread(ui_present_strict, request):
            raise HTTPException(403, USER_ONLY_ZIP)

    async def body_of(request: Request) -> dict[str, Any]:
        try:
            data = await request.json()
        except ValueError:
            data = {}
        if data is None:
            data = {}
        if not isinstance(data, dict):
            raise HTTPException(400, "Gövde bir nesne olmalı")
        for key in ("unmasked", "dry_run"):
            if key in data and not isinstance(data[key], bool):
                raise HTTPException(400, f"{key} true/false olmalı")
        return data

    async def run_zip(request: Request, ids: list[str], data: dict[str, Any], run_id: str | None, fallback: str,
                      scan_capped: int = 0) -> Any:
        from studio.i18n import request_lang
        svc = get_service(studio)
        dry = bool(data.get("dry_run"))
        if not (PLAN_RATE if dry else BUILD_RATE).hit():
            return JSONResponse({"detail": "Çok sık istek: bir dakika içinde en çok 10 kez", "code": "rate_limited"},
                                status_code=429)
        lang = request_lang()
        plan = await asyncio.to_thread(lambda: resolve(svc, ids, unmasked=bool(data.get("unmasked")), run_id=run_id,
                                                       scan_capped=scan_capped))
        plan.zip_name = _zip_name(plan, fallback)
        if not plan.entries:
            return JSONResponse({"detail": "Pakete eklenecek dosya yok", "code": "nothing_to_zip",
                                 **{k: v for k, v in _summary(plan, dry=dry).items() if k in ("skipped", "merged")}},
                                status_code=422)
        if dry:
            return _summary(plan, dry=True)
        if not _SLOTS.acquire(blocking=False):
            return JSONResponse({"detail": "Başka bir paket hazırlanıyor; biraz sonra tekrar dene", "code": "busy"},
                                status_code=429)
        try:
            spool, size, plan = await asyncio.to_thread(build, svc, plan, lang)
        finally:
            _SLOTS.release()
        svc._publish("deliverable.zipped", run_id=run_id, count=len(plan.entries), skipped=len(plan.skipped),
                     bytes=size, unmasked=plan.unmasked)  # kimlik listesi / ad / yol yok
        from studio.deliverables.api import _disposition
        headers = {"Content-Disposition": _disposition(plan.zip_name), "X-Content-Type-Options": "nosniff",
                   "Cache-Control": "no-store", "Content-Length": str(size),
                   "X-Studio-Zip-Entries": str(len(plan.entries)), "X-Studio-Zip-Skipped": str(len(plan.skipped))}
        if plan.unmasked:
            headers["X-Studio-Unmasked"] = "1"  # D1 ile aynı uyarı etiketi
        return StreamingResponse(_stream(spool), media_type="application/zip", headers=headers)

    @r.post("/api/deliverables/zip", response_model=None)
    async def zip_many(request: Request) -> Any:
        await strict(request)
        data = await body_of(request)
        run_id, ids = data.get("run_id"), data.get("ids")
        if (run_id is None) == (ids is None):
            raise HTTPException(400, "run_id ya da ids verilmeli (yalnız biri)")
        svc = get_service(studio)
        capped = False
        if run_id is not None:
            if not isinstance(run_id, str) or not run_id.strip() or len(run_id) > 200:
                raise HTTPException(400, "run_id geçersiz")
            run_id = run_id.strip()
            nodes = await asyncio.to_thread(lambda: svc.store.nodes("Deliverable", limit=RUN_SCAN + 1, order="created_at ASC",
                                                                    props={"run_id": run_id}))
            if not nodes:
                raise HTTPException(404, "Bu koşunun çıktısı yok")
            capped = len(nodes) > RUN_SCAN  # sınır aşıldı → fazlası sessizce düşmez, "run_scan_cap" olarak bildirilir
            nodes = nodes[:RUN_SCAN]
            order = {"output": 0, "file": 1, "bundle": 2}
            nodes.sort(key=lambda n: (order.get(str(n["props"].get("source")), 3), str(n["props"].get("path") or ""),
                                      str(n["props"].get("id") or "")))
            ids = [str(n["props"].get("id") or n["id"]) for n in nodes]
        else:
            if not isinstance(ids, list) or not ids or not all(isinstance(i, str) and 0 < len(i) <= 200 for i in ids):
                raise HTTPException(400, "ids boş olmayan bir kimlik listesi olmalı")
            ids = list(dict.fromkeys(ids))
            if len(ids) > MAX_IDS:
                raise HTTPException(413, f"En çok {MAX_IDS} çıktı seçilebilir")
        return await run_zip(request, ids, data, run_id, "ciktilar", RUN_SCAN if run_id is not None and capped else 0)

    @r.post("/api/deliverables/{did}/zip", response_model=None)
    async def zip_one(did: str, request: Request) -> Any:
        await strict(request)
        data = await body_of(request)
        svc = get_service(studio)
        node = await asyncio.to_thread(svc.store.find, "Deliverable", did)
        if not node:
            raise HTTPException(404, f"Çıktı yok: {did}")
        props = node["props"]
        return await run_zip(request, [did], data, None, str(props.get("title") or props.get("name") or "ciktilar"))

    return r
