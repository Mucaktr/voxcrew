"""DEPO-TESLIM — iki çıktı sürümünün karşılaştırması (yalnız okuma).

Saf işlevler (graf/dosya yok): `text_diff` iki MASKELİ metnin satır farkını sınırlı boyutta üretir; `manifest_diff` iki paket
özetinin dosya farkını verir. Maskeleme çağıranın işidir (`DeliverableService.compare` yalnız `content` çıktısını verir,
o da `redact_text`'ten geçmiştir); bu modül hiçbir yerden okumaz ve yazmaz.

Sınırlar (hizmet reddi / bellek): yan başına en çok `MAX_LINES` satır (aşan kuyruk karşılaştırılmaz, `lines_truncated`),
satır başına `MAX_LINE_CHARS` karakter, yanıtta en çok `MAX_ROWS` satır (`rows_truncated`). Fark `difflib.SequenceMatcher`
(`autojunk` açık: çok tekrarlanan satırlar ikinci dereceden maliyeti yaratmaz).

Satır biçimi `{t, a, b, x}`: `t` = `=` (aynı) | `+` (eklendi) | `-` (silindi) | `…` (atlanan aynı satırlar: `n`);
`a` / `b` = eski / yeni sürümdeki 1 tabanlı satır numarası (yoksa null); `x` = satır metni.
"""

from __future__ import annotations

import difflib
from typing import Any

MAX_LINES = 3000
MAX_ROWS = 4000
MAX_LINE_CHARS = 2000
CONTEXT = 3


def _lines(text: str) -> list[str]:
    s = text.replace("\r\n", "\n").replace("\r", "\n")
    out = s.split("\n")
    if out and out[-1] == "":  # son satır sonu fazladan boş satır sayılmaz
        out.pop()
    return out


def _cut(line: str) -> str:
    return line if len(line) <= MAX_LINE_CHARS else line[:MAX_LINE_CHARS] + "…"


def text_diff(old: str, new: str, *, context: int = CONTEXT) -> dict[str, Any]:
    """İki metnin birleşik (satır içi) farkı. Dönüş: `{identical, added, removed, rows, lines_truncated, rows_truncated, tail_unchecked}`."""
    a_all, b_all = _lines(old), _lines(new)
    lines_truncated = len(a_all) > MAX_LINES or len(b_all) > MAX_LINES
    a, b = a_all[:MAX_LINES], b_all[:MAX_LINES]
    if a == b and not lines_truncated:
        return {"identical": a_all == b_all, "added": 0, "removed": 0, "rows": [], "lines_truncated": False,
                "rows_truncated": False, "tail_unchecked": False}
    sm = difflib.SequenceMatcher(None, a, b)
    rows: list[dict[str, Any]] = []
    added = removed = 0
    codes = sm.get_opcodes()
    for idx, (tag, i1, i2, j1, j2) in enumerate(codes):
        if tag == "equal":
            span = i2 - i1
            head = 0 if idx == 0 else context               # önceki değişimden sonraki bağlam
            tail = 0 if idx == len(codes) - 1 else context  # sonraki değişimden önceki bağlam
            show_all = span <= head + tail + 1
            for k in range(span):
                if not show_all and head <= k < span - tail:
                    if k == head:
                        rows.append({"t": "…", "n": span - head - tail})
                    continue
                rows.append({"t": "=", "a": i1 + k + 1, "b": j1 + k + 1, "x": _cut(a[i1 + k])})
            continue
        if tag in ("delete", "replace"):
            for ai in range(i1, i2):
                rows.append({"t": "-", "a": ai + 1, "b": None, "x": _cut(a[ai])})
            removed += i2 - i1
        if tag in ("insert", "replace"):
            for bj in range(j1, j2):
                rows.append({"t": "+", "a": None, "b": bj + 1, "x": _cut(b[bj])})
            added += j2 - j1
    rows_truncated = len(rows) > MAX_ROWS
    # kuyruk (MAX_LINES sonrası) karşılaştırılmadı; baştaki satırlar aynıysa "aynı" denmez, açık bir bayrak verilir
    tail_unchecked = lines_truncated and added == 0 and removed == 0
    return {"identical": False, "added": added, "removed": removed, "rows": rows[:MAX_ROWS],
            "lines_truncated": lines_truncated, "rows_truncated": rows_truncated, "tail_unchecked": tail_unchecked}


def manifest_diff(old: list[dict[str, Any]], new: list[dict[str, Any]], limit: int = 200) -> dict[str, Any]:
    """Uygulama paketi dosya farkı (yol + sha256; içerik yok): added | removed | changed | same."""
    def index(items: list[dict[str, Any]]) -> dict[str, str]:
        return {str(m.get("path")): str(m.get("sha256") or "") for m in items if isinstance(m, dict) and m.get("path")}
    o, n = index(old), index(new)
    added = sorted(p for p in n if p not in o)
    removed = sorted(p for p in o if p not in n)
    changed = sorted(p for p in n if p in o and n[p] != o[p])
    same = sum(1 for p in n if p in o and n[p] == o[p])
    return {"added": added[:limit], "removed": removed[:limit], "changed": changed[:limit], "same": same,
            "truncated": max(len(added), len(removed), len(changed)) > limit}
