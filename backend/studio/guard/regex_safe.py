"""Güvenilmeyen düzenli ifadeyi zaman sınırıyla değerlendirme.

Kabul ölçütündeki `regex` (paylaşım paketinden de gelebilir) `^(a+)+$` gibi felaket geri izleme yapan bir kalıp olabilir.
CPython `re` eşleşme sırasında GIL'i bırakmaz ve kesilemez: iş parçacığında bile olay döngüsünü dondurur. Bu yüzden
eşleşme kısa ömürlü, yalıtılmış (`-I -S`) bir alt süreçte yapılır ve süre dolunca süreç öldürülür. Yeni bağımlılık yok.

- `search(...)` engelleyicidir: async koddan `asyncio.to_thread(search,...)` ile çağrılır (bekleyen iş parçacığı GIL
  tutmaz; CPU işi alt süreçtedir).
- `nested_quantifier(pattern)`: içe aktarmada kaba ama hızlı ret — niceleyicili bir grup yeniden nicelenirse
  (`(a+)+`, `(\\w*)*`, `(a|b+){2,}`) kalıp reddedilir.
- Girdi ve kalıp uzunluğu sınırlıdır.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from typing import Any

MAX_PATTERN = 500
MAX_TEXT = 100_000
TIMEOUT_S = 2.0

_CHILD = (
    "import json,re,sys\n"
    "d=json.loads(sys.stdin.read())\n"
    "try:\n"
    "    m=re.search(d['p'],d['t'],d['f'])\n"
    "    print(json.dumps({'m':None if m is None else m.group(0)[:200]}))\n"
    "except re.error as e:\n"
    "    print(json.dumps({'e':str(e)}))\n"
)

# Niceleyici: *, +, ?, {n,} / {n,m} (tembel/iyelik ekleri dahil)
_QUANT = r"(?:[*+]|\{\d*,\d*\}|\{\d+\})"


def _strip_classes(pattern: str) -> str:
    """Kaçışları ve karakter sınıflarını nötr bir harfe indirger (içlerindeki `+*()` niceleyici/grup değildir)."""
    out: list[str] = []
    i, n = 0, len(pattern)
    while i < n:
        ch = pattern[i]
        if ch == "\\" and i + 1 < n:
            out.append("x")
            i += 2
            continue
        if ch == "[":
            j = i + 1
            if j < n and pattern[j] == "^":
                j += 1
            if j < n and pattern[j] == "]":
                j += 1
            while j < n and pattern[j] != "]":
                j += 2 if pattern[j] == "\\" else 1
            out.append("x")
            i = j + 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def nested_quantifier(pattern: str) -> bool:
    """Kaba felaket kalıbı denetimi: içinde niceleyici bulunan bir grup kendisi nicelenmiş mi."""
    s = _strip_classes(str(pattern or ""))
    stack: list[int] = []
    for i, ch in enumerate(s):
        if ch == "(":
            stack.append(i)
        elif ch == ")" and stack:
            start = stack.pop()
            body = s[start + 1:i]
            after = s[i + 1:i + 12]
            if re.match(_QUANT, after) and re.search(_QUANT, body):
                return True
    return False


def pattern_problem(pattern: Any) -> str | None:
    """İçe aktarılan kalıp için Türkçe ret nedeni; uygunsa None."""
    p = str(pattern or "")
    if len(p) > MAX_PATTERN:
        return f"Düzenli ifade çok uzun (en çok {MAX_PATTERN} karakter)"
    if nested_quantifier(p):
        return "Düzenli ifade iç içe niceleyici içeriyor (felaket geri izleme riski): " + p[:80]
    return None


def search(pattern: str, text: str, flags: int = 0, timeout_s: float = TIMEOUT_S) -> tuple[str | None, str | None]:
    """(eşleşen metin | None, hata | None). Hata: geçersiz kalıp, zaman aşımı ya da çok uzun kalıp."""
    p = str(pattern or "")
    if len(p) > MAX_PATTERN:
        return None, f"Düzenli ifade çok uzun (en çok {MAX_PATTERN} karakter)"
    t = str(text or "")[:MAX_TEXT]
    payload = json.dumps({"p": p, "t": t, "f": int(flags)})
    try:
        proc = subprocess.run([sys.executable, "-I", "-S", "-c", _CHILD], input=payload, capture_output=True,
                              text=True, encoding="utf-8", timeout=timeout_s, check=False)
    except subprocess.TimeoutExpired:
        return None, f"Düzenli ifade zaman sınırını aştı ({timeout_s:g} sn); kalıp felaket geri izleme yapıyor olabilir"
    except OSError as exc:
        return None, f"Düzenli ifade değerlendirilemedi: {exc}"
    try:
        data = json.loads((proc.stdout or "").strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError):
        return None, "Düzenli ifade değerlendirilemedi"
    if "e" in data:
        return None, f"Geçersiz düzenli ifade: {data['e']}"
    return data.get("m"), None
