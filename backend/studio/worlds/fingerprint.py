"""Dünya içerik parmak izi (karar 10, eki): içe aktarılan/düzenlenen bir dünyanın yerleşik bir sahnenin kopyası
olup olmadığını `meta.basedOn` olmadan da anlar (`basedOn` JSON'dan silinebilir).

Yöntem (ucuz ve belirlenimci):
- Her prefab bir **simgeye** dönüşür: `i`/`j` dışındaki alanların kanonik JSON'u; sayılar 1 ondalığa yuvarlanır
  (küçük kaydırmalar parmak izini bozmasın), renkler büyük harfe çevrilir. Simge + karo = konumlu jeton.
- Birden çok yerleşik sahnede aynı karoda duran jetonlar (ortak kit) ayırt edici değildir; tabandan çıkarılır.
- Benzerlik = yerleşik sahnenin kalan konumlu jeton çoklu kümesinin adayda bulunan payı (kapsama; eklemeler benzerliği
  düşürmez). Tüm dünya birkaç karo kaydırılmışsa bulunsun diye, sahnede seyrek (≤ 4 kez) geçen simgelerin karo
  farklarından en çok oy alan 3 kaydırma da denenir; en yüksek skor alınır.
- Eşik `MATCH_THRESHOLD` = 0,35: yerleşik sahnelerin birbirini kapsaması en çok ≈ 0,07 (test < 0,15 diye sabitler);
  prefabların %40'ı silinmiş ve kalanların dörtte biri bir karo kaydırılmış kopya ≈ 0,43–0,51 kalır.
- aday ayrıca 8 ızgara simetrisi altında (4 dönüş × ayna) puanlanır; simetri adayın kendi sınır kutusu içinde
  uygulanır, kalan kayma oylamayla bulunur. Simge (şekil anahtarı) değişmez; eşik aynıdır.
- Bilinen sınır: tüm prefabları yeniden boyamak ya da yarıdan fazlasını değiştirmek eşleşmeyi düşürür; bu artık
  "orta düzeyde düzenlenmiş kopya" sayılmaz.
- En az `MIN_TOKENS` (20) ayırt edici jetonu olmayan yerleşik sahne eşleştirilmez. Yerleşik dosyalar okunamazsa
  (paketlenmiş kurulum) eşleştirme yapılmaz — kilit `basedOn` denetimine geri düşer.
"""

from __future__ import annotations

import hashlib
import json
import threading
from collections import Counter
from pathlib import Path
from typing import Any

MATCH_THRESHOLD = 0.35
MIN_TOKENS = 20
SPARSE_SHAPE = 4
TRY_OFFSETS = 3
MAX_OFFSET = 48

_cache_lock = threading.Lock()
_builtin_cache: dict[str, tuple[Counter[tuple[str, int, int]], dict[str, list[tuple[int, int]]]]] | None = None
_builtin_cache_dir: Path | None = None


def _norm(v: Any) -> Any:
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float)):
        r = round(float(v), 1)
        return 0.0 if r == 0 else r
    if isinstance(v, str):
        return v.upper() if v.startswith("#") else v
    if isinstance(v, list):
        return [_norm(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _norm(x) for k, x in sorted(v.items())}
    return None


def shape_key(p: dict[str, Any]) -> str:
    body = {k: v for k, v in p.items() if k not in ("i", "j")}
    text = json.dumps(_norm(body), sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def tokens(doc: Any) -> Counter[tuple[str, int, int]]:
    """Dünyanın konumlu prefab jetonları (simge, i, j); bozuk girdiler atlanır."""
    layers = doc.get("layers") if isinstance(doc, dict) else None
    prefabs = layers.get("prefabs") if isinstance(layers, dict) else None
    out: Counter[tuple[str, int, int]] = Counter()
    for p in prefabs if isinstance(prefabs, list) else []:
        if not isinstance(p, dict):
            continue
        i, j = p.get("i"), p.get("j")
        if isinstance(i, bool) or isinstance(j, bool) or not isinstance(i, (int, float)) or not isinstance(j, (int, float)):
            continue
        out[(shape_key(p), int(i), int(j))] += 1
    return out


def _shapes(tok: Counter[tuple[str, int, int]]) -> dict[str, list[tuple[int, int]]]:
    out: dict[str, list[tuple[int, int]]] = {}
    for (s, i, j) in tok:
        out.setdefault(s, []).append((i, j))
    return out


def containment(base: Counter[tuple[str, int, int]], cand: Counter[tuple[str, int, int]],
                base_shapes: dict[str, list[tuple[int, int]]] | None = None) -> float:
    """`base` (yerleşik) jetonlarının `cand` içinde bulunan payı; en iyi karo kaydırmasıyla. 0..1."""
    total = sum(base.values())
    if total == 0 or not cand:
        return 0.0
    base_shapes = base_shapes if base_shapes is not None else _shapes(base)
    votes: Counter[tuple[int, int]] = Counter()
    for (s, i, j), _n in cand.items():
        spots = base_shapes.get(s)
        if not spots or len(spots) > SPARSE_SHAPE:
            continue
        for (bi, bj) in spots:
            di, dj = i - bi, j - bj
            if (di or dj) and abs(di) <= MAX_OFFSET and abs(dj) <= MAX_OFFSET:
                votes[(di, dj)] += 1
    offsets = [(0, 0)] + [o for o, _ in votes.most_common(TRY_OFFSETS)]
    best = 0
    for di, dj in offsets:
        hit = 0
        for (s, i, j), n in base.items():
            m = cand.get((s, i + di, j + dj), 0)
            if m:
                hit += min(n, m)
        best = max(best, hit)
    return best / total


def builtin_dir() -> Path:
    from studio.config import ROOT  # noqa: PLC0415
    return Path(ROOT) / "frontend" / "src" / "voxel" / "worlds"


def _builtins(root: Path | None = None) -> dict[str, tuple[Counter[tuple[str, int, int]], dict[str, list[tuple[int, int]]]]]:
    """Yerleşik sahnelerin jetonları (süreç başına bir kez okunur)."""
    global _builtin_cache, _builtin_cache_dir
    d = root or builtin_dir()
    with _cache_lock:
        if _builtin_cache is not None and _builtin_cache_dir == d:
            return _builtin_cache
        out: dict[str, tuple[Counter[tuple[str, int, int]], dict[str, list[tuple[int, int]]]]] = {}
        if d.is_dir():
            for path in sorted(d.glob("*.json")):
                try:
                    doc = json.loads(path.read_text("utf-8"))
                except (OSError, ValueError):
                    continue
                out[path.stem] = (tokens(doc), {})
        # birden çok yerleşik sahnede aynı karoda duran jetonlar (ortak kit: zemin bloğu, terminal …) ayırt edici
        # değildir; her sahnenin tabanından çıkarılır
        seen: Counter[tuple[str, int, int]] = Counter()
        for tok, _ in out.values():
            seen.update(set(tok))
        final = {}
        for scene, (tok, _) in out.items():
            own = Counter({k: n for k, n in tok.items() if seen[k] == 1})
            if sum(own.values()) >= MIN_TOKENS:
                final[scene] = (own, _shapes(own))
        out = final
        _builtin_cache, _builtin_cache_dir = out, d
        return out


def symmetries(cand: Counter[tuple[str, int, int]]) -> list[Counter[tuple[str, int, int]]]:
    """adayın 8 ızgara simetrisi (kimlik dahil), adayın sınır kutusunun köşesine hizalı."""
    if not cand:
        return [cand]
    i0 = min(i for _s, i, _j in cand)
    j0 = min(j for _s, _i, j in cand)
    i1 = max(i for _s, i, _j in cand)
    j1 = max(j for _s, _i, j in cand)
    maps = (lambda i, j: (i, j), lambda i, j: (i1 + i0 - i, j), lambda i, j: (i, j1 + j0 - j),
            lambda i, j: (i1 + i0 - i, j1 + j0 - j), lambda i, j: (i0 + (j - j0), j0 + (i - i0)),
            lambda i, j: (i0 + (j1 - j), j0 + (i - i0)), lambda i, j: (i0 + (j - j0), j0 + (i1 - i)),
            lambda i, j: (i0 + (j1 - j), j0 + (i1 - i)))
    out = []
    for f in maps:
        c: Counter[tuple[str, int, int]] = Counter()
        for (sk, i, j), n in cand.items():
            ni, nj = f(i, j)
            c[(sk, ni, nj)] += n
        out.append(c)
    return out


def matches(doc: Any, *, root: Path | None = None, threshold: float = MATCH_THRESHOLD) -> list[tuple[str, float]]:
    """Eşiği geçen yerleşik sahneler, skora göre azalan sırada: [(sahne, skor), …]."""
    cand = tokens(doc)
    if not cand:
        return []
    variants = symmetries(cand)
    out = []
    for scene, (tok, shapes) in _builtins(root).items():
        score = max(containment(tok, v, shapes) for v in variants)
        if score >= threshold:
            out.append((scene, round(score, 3)))
    out.sort(key=lambda x: (-x[1], x[0]))
    return out


_doc_cache: dict[str, list[tuple[str, float]]] = {}


def matches_cached(doc: Any) -> list[tuple[str, float]]:
    """`meta.sha256` ile önbellekli `matches` (liste ve etkinleştirme her istekte yeniden hesaplamasın)."""
    meta = doc.get("meta") if isinstance(doc, dict) else None
    sha = meta.get("sha256") if isinstance(meta, dict) else None
    if not isinstance(sha, str) or not sha:
        return matches(doc)
    with _cache_lock:
        hit = _doc_cache.get(sha)
    if hit is not None:
        return hit
    out = matches(doc)
    with _cache_lock:
        if len(_doc_cache) > 512:
            _doc_cache.clear()
        _doc_cache[sha] = out
    return out
