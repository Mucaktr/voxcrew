"""Bellek ad alanları: projeler arası bellek izolasyonu.

Ad alanı biçimi: `"global"` ya da `"project:<anahtar>"`. Ad alanı dizgesini kuran TEK yer bu modüldür; diğer modüller
`normalize` / `for_project` / `for_eval` çağırır, dizgeyi elle birleştirmez.

- Anahtar `^[a-z0-9][a-z0-9_-]{0,40}$` (küçük harf; baş/son boşluk ve büyük harf normalize edilir). Grafta `Project`
  düğümü olan anahtarlar (Claude Code izleyicisi `<ad>-<6 hane>` üretir, 47 karaktere kadar) `project_exists` geri
  çağrısıyla kabul edilir (aynı karakter kümesi, ≤64).
- Eski (ad alanı alanı olmayan) Episode/Fact düğümleri `global` sayılır; Concept'in `namespaces` listesi yoksa
  `["global"]` sayılır. Yıkıcı göç yoktur: eski düğümler yerinde kalır, yazıldıkça damgalanır.
- Değerlendirme koşuları (S28) yalıtılmış `project:eval-<id>` ad alanında koşar: `for_eval(eval_id)`.

Okuma kuralı (`memory.isolation: true`): koşu yalnızca KENDİ ad alanını görür. `project:A` koşusu `global` anılarını da
OKUMAZ (karar: çapraz okuma yok — global bellek eski/karışık projelerden türemiş olabilir; "paylaşılabilir" işaretli
global bilgiler kapsam dışıdır). `memory.isolation: false` iken okuma eski davranıştır (ad alanı süzgeci yok) ama
yazmalar yine damgalanır.
"""

from __future__ import annotations

import re
from typing import Any, Callable, Iterable

GLOBAL = "global"
PROJECT_PREFIX = "project:"
EVAL_PREFIX = "eval-"
KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,40}$")
# Grafta var olan Project düğümlerinin anahtarları (external.normalize.project_key) için gevşek ama güvenli küme
PROJECT_NODE_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
ALL = "*"  # yalnızca yönetici/gezgin görünümleri (graf gezgini) için: "süzme" — recall yolu bunu KABUL ETMEZ


class NamespaceError(ValueError):
    """Geçersiz ad alanı ya da ad alanları arası işlem girişimi."""


# değerlendirme matrisi ve booster kapısının iç ad alanı/ajan önekleri ayrılmıştır. Olağan API'lerle bu önekte
# proje (ad alanı) ya da ajan oluşturulamaz (400). Kurtarma süpürmesi ad/önek değil, oluşturulurken yazılan iç işarete
# (`eval_matrix` = matris/kapı kimliği) bakar; önceden bu adla oluşturulmuş kullanıcı kayıtları silinmez.
RESERVED_PREFIXES = ("eval-mx", "evalmx")
ERR_RESERVED = ("'{}' ayrılmış bir ad: 'eval-mx' ve 'evalmx' ile başlayan proje ve ajan adları değerlendirme matrisinin "
                "geçici kayıtlarına ayrılmıştır; başka bir ad seç")


def is_reserved(key: str | None) -> bool:
    k = str(key or "").strip().lower()
    if k.startswith(PROJECT_PREFIX):
        k = k[len(PROJECT_PREFIX):]
    return k.startswith(RESERVED_PREFIXES)


def reject_reserved(value: Any) -> None:
    """kullanıcı/istek girdisindeki proje anahtarı ayrılmış önekle başlıyorsa `NamespaceError` (→ 400)."""
    if isinstance(value, str) and is_reserved(value):
        raise NamespaceError(ERR_RESERVED.format(value.strip()[:60]))


def is_valid_key(key: str) -> bool:
    return bool(KEY_RE.match(key or ""))


def normalize(value: Any, *, project_exists: Callable[[str], bool] | None = None) -> str:
    """Kullanıcı/istek girdisinden kanonik ad alanı.

    `None`, `""`, `"global"` → `"global"`; `"project:<k>"` ya da çıplak `"<k>"` → `"project:<k>"`.
    Geçersiz anahtar → `NamespaceError` (sessizce `global`e düşmez: yanlış yazılan proje adı başka bir belleğe
    yazmasın)."""
    if value is None:
        return GLOBAL
    if not isinstance(value, str):
        raise NamespaceError("Proje anahtarı metin olmalı")
    raw = value.strip().lower()
    if raw in ("", GLOBAL):
        return GLOBAL
    key = raw[len(PROJECT_PREFIX):] if raw.startswith(PROJECT_PREFIX) else raw
    if KEY_RE.match(key):
        return PROJECT_PREFIX + key
    if project_exists is not None and PROJECT_NODE_KEY_RE.match(key) and project_exists(key):
        return PROJECT_PREFIX + key
    raise NamespaceError(f"Geçersiz proje anahtarı: {value!r} (küçük harf, rakam, - ve _; en çok 41 karakter)")


def maybe(value: Any, *, project_exists: Callable[[str], bool] | None = None) -> str | None:
    """`normalize`, ama değer verilmediyse (None/boş) `None` döner (ör. hedefte proje alanı yok)."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    return normalize(value, project_exists=project_exists)


def for_project(key: str) -> str:
    return normalize(key)


def for_eval(eval_id: str) -> str:
    """S28: değerlendirme koşuları için yalıtılmış ad alanı `project:eval-<id>` (id küçültülür, izin verilmeyen
    karakterler `-` olur, anahtar 41 karaktere kırpılır)."""
    slug = re.sub(r"[^a-z0-9_-]+", "-", str(eval_id or "").strip().lower()).strip("-_") or "x"
    return normalize((EVAL_PREFIX + slug)[:41].rstrip("-_"))


def key_of(ns: str | None) -> str | None:
    """`project:<k>` → `<k>`; `global`/None → None."""
    if ns and ns.startswith(PROJECT_PREFIX):
        return ns[len(PROJECT_PREFIX):]
    return None


def is_global(ns: str | None) -> bool:
    return not ns or ns == GLOBAL


def of_node(node: dict[str, Any]) -> str:
    """Episode/Fact düğümünün ad alanı (eski düğüm → global)."""
    ns = (node.get("props") or {}).get("namespace")
    return ns if isinstance(ns, str) and ns else GLOBAL


def concept_namespaces(node: dict[str, Any]) -> list[str]:
    """Concept'in görüldüğü ad alanları (eski kavram → ["global"])."""
    vals = (node.get("props") or {}).get("namespaces")
    if isinstance(vals, list) and vals:
        return [str(v) for v in vals]
    return [GLOBAL]


def node_in(node: dict[str, Any], ns: str) -> bool:
    """Düğüm bu ad alanında mı? Concept: listesinde varsa; Episode/Fact: ad alanı eşitse."""
    if node.get("type") == "Concept":
        return ns in concept_namespaces(node)
    return of_node(node) == ns


def merged_concept_namespaces(existing: dict[str, Any] | None, ns: str) -> list[str]:
    """Kavrama yeni ad alanı eklerken yazılacak liste. Eski (listesiz) var olan kavram global anılarla bağlı
    olabileceği için listeye `global` da korunur."""
    base = concept_namespaces(existing) if existing else []
    out: list[str] = list(dict.fromkeys([*base, ns]))
    return out


def label(ns: str | None, lang: str = "tr") -> str:
    k = key_of(ns)
    if k is None:
        return "Genel" if lang == "tr" else "Global"
    return k


def distinct(values: Iterable[str | None]) -> list[str]:
    return sorted({v or GLOBAL for v in values}, key=lambda v: (v != GLOBAL, v))
