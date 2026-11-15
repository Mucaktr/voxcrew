"""Deterministik skill seçici (G1-D; AUDIT §3.2 kural 7, G-3).

`catalog` kipindeki skill'lerin gövdesi her adımda isteme girmez. Seçici görev metnini skill'in adı, anahtarı,
etiketleri ve açıklamasıyla anahtar kelime düzeyinde eşleştirir ve en çok K = 2 gövde seçer. Model çağrısı, rastgelelik
ya da saat yoktur: aynı girdi her zaman aynı sonucu verir (önbellek öneki kararlı kalır).

Puan: ad / anahtar / etiket eşleşmesi 2, açıklama eşleşmesi 1 (her görev sözcüğü bir kez sayılır). Türkçe ekler için
basit önek eşleşmesi: iki sözcük de en az 4 harfliyse biri ötekinin önekiyse eşleşir ("raporu" ~ "rapor").
Eşitlikte anahtar sırası belirler. Puanı 2'nin altında olan skill seçilmez. `skill_load` aracı gelir.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

from studio.hermes.caps import fold

K = 2
MIN_SCORE = 2      # tek bir açıklama sözcüğü ("hazırla" gibi) gövde yüklemeye yetmez
MIN_LEN = 3
PREFIX_LEN = 4
_WORD = re.compile(r"[0-9a-zçğıöşüâîû]+")
STOPWORDS = frozenset("""
ve ile bir bu şu için gibi daha çok en mi mu mü mı da de ki ya veya ama fakat olarak olan olur yap yapın lütfen
the and for with this that from into your you are was were will can not but all any use using about have has
""".split())


def words(text: Any) -> set[str]:
    return {w for w in _WORD.findall(fold(text)) if len(w) >= MIN_LEN and w not in STOPWORDS}


def _hit(a: str, b: str) -> bool:
    if a == b:
        return True
    return len(a) >= PREFIX_LEN and len(b) >= PREFIX_LEN and (a.startswith(b) or b.startswith(a))


def score(task_words: set[str], item: dict[str, Any]) -> int:
    strong = words(" ".join([str(item.get("name") or ""), str(item.get("key") or "").replace(":", " ").replace("-", " "),
                             " ".join(str(t) for t in item.get("tags") or [])]))
    weak = words(item.get("description") or "")
    total = 0
    for w in task_words:
        if any(_hit(w, s) for s in strong):
            total += 2
        elif any(_hit(w, s) for s in weak):
            total += 1
    return total


def select(task: str | None, items: Iterable[dict[str, Any]], k: int = K) -> list[str]:
    """[{key, name, description, tags}] → görevle ilgili en çok k anahtar (puan azalan, sonra anahtar)."""
    tw = words(task or "")
    if not tw or k <= 0:
        return []
    scored = [(score(tw, it), str(it["key"])) for it in items]
    ranked = sorted(((s, key) for s, key in scored if s >= MIN_SCORE), key=lambda x: (-x[0], x[1]))
    return [key for _s, key in ranked[:k]]
