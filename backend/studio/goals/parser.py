"""Toplu hedef metni ayrıştırıcı (saf fonksiyonlar; graf ve ağ erişimi yok).

Söz dizimi (frontend `lib/goals.ts` → `parseBulk` birebir aynı kuralları uygular):
- Boş olmayan her satır bir hedeftir. Baştaki `- `, `* `, `• ` ya da `1. ` / `1) ` imi isteğe bağlıdır.
- Girinti (boşluk = 1, sekme = 4) hiyerarşi kurar: daha içerideki satır üstündeki hedefin alt hedefidir.
- `KR:` (ya da `KR1:` …) ile başlayan satır, üstündeki hedefin anahtar sonucudur. Hedef değeri isteğe bağlı:
  `KR: Yeni kurumsal müşteri = 3 adet`, `KR: Test kapsamı = %80`.
- Satır sonundaki isteğe bağlı etiketler: `!yüksek` (öncelik), `son:2026-12-31` (son tarih),
  `@ajan-slug` (sahip ajan), `#ekip-slug` (sahip ekip).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Iterable

MAX_GOALS = 200
MAX_KRS = 20
MAX_TITLE = 200
MAX_TEXT = 50_000

PRIORITY_ALIASES = {
    "düşük": "low", "dusuk": "low", "low": "low",
    "orta": "medium", "normal": "medium", "medium": "medium",
    "yüksek": "high", "yuksek": "high", "high": "high",
    "kritik": "critical", "acil": "critical", "critical": "critical",
}
PRIORITIES = ("low", "medium", "high", "critical")

_BULLET = re.compile(r"^(?:[-*•]|\d{1,3}[.)])\s+")
_KR = re.compile(r"^KR\d{0,2}\s*:\s*", re.IGNORECASE)
_KR_TARGET = re.compile(r"^(?P<title>.+?)\s*(?:=|→|->)\s*(?P<pct>%)?\s*(?P<num>\d+(?:[.,]\d+)?)\s*(?P<unit>.*)$")
_TOK_PRIORITY = re.compile(r"^!(\S+)$")
_TOK_DUE = re.compile(r"^(?:son|due|bitiş|bitis):(\S+)$", re.IGNORECASE)
_TOK_AGENT = re.compile(r"^@([A-Za-z0-9_.-]+)$")
_TOK_TEAM = re.compile(r"^#([A-Za-z][A-Za-z0-9_.-]*)$")  # harfle başlar: "Sürüm #2" etiket sayılmaz


class BulkParseError(ValueError):
    """Satır hatalarıyla birlikte ayrıştırma hatası (400 olarak döner)."""

    def __init__(self, errors: list[dict[str, Any]]):
        self.errors = errors
        first = errors[0] if errors else {"line": 0, "message": "Bilinmeyen hata"}
        where = f"Satır {first['line']}: " if first.get("line") else ""
        more = f" (+{len(errors) - 1} hata daha)" if len(errors) > 1 else ""
        super().__init__(f"{where}{first['message']}{more}")


@dataclass
class ParsedGoal:
    title: str
    line: int
    indent: int = 0
    priority: str | None = None
    due: str | None = None
    owner_agent: str | None = None
    owner_team: str | None = None
    key_results: list[dict[str, Any]] = field(default_factory=list)
    children: list["ParsedGoal"] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {"title": self.title, "line": self.line, "priority": self.priority, "due": self.due,
                "owner_agent": self.owner_agent, "owner_team": self.owner_team,
                "key_results": [dict(k) for k in self.key_results],
                "children": [c.to_dict() for c in self.children]}


def normalize_priority(value: Any) -> str | None:
    if value in (None, ""):
        return None
    key = str(value).strip().replace("İ", "i").lower()
    if key not in PRIORITY_ALIASES:
        raise ValueError(f"Bilinmeyen öncelik: {value} (düşük, orta, yüksek, kritik)")
    return PRIORITY_ALIASES[key]


def normalize_due(value: Any) -> str | None:
    """`YYYY-MM-DD`, `GG.AA.YYYY`, `GG/AA/YYYY` ya da ISO tarih-saat → `YYYY-MM-DD`."""
    if value in (None, ""):
        return None
    s = str(value).strip()
    m = re.fullmatch(r"(\d{1,2})[./](\d{1,2})[./](\d{4})", s)
    try:
        if m:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1))).isoformat()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
            return date.fromisoformat(s).isoformat()
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        raise ValueError(f"Geçersiz tarih: {s} (ör. 2026-12-31 ya da 31.12.2026)") from None


def _number(text: str) -> float | int:
    v = float(text.replace(",", "."))
    return int(v) if v.is_integer() else v


def parse_kr(text: str) -> dict[str, Any]:
    """`Başlık = 3 adet` → {title, target, unit}. Hedef değeri yoksa target=None (yapıldı/yapılmadı)."""
    text = text.strip()
    m = _KR_TARGET.match(text)
    if m and m.group("title").strip():
        unit = "%" if m.group("pct") else (m.group("unit") or "").strip() or None
        return {"title": m.group("title").strip(), "target": _number(m.group("num")), "unit": unit}
    return {"title": text, "target": None, "unit": None}


def _indent_of(raw: str) -> tuple[int, str]:
    n = 0
    for i, ch in enumerate(raw):
        if ch == " ":
            n += 1
        elif ch == "\t":
            n += 4
        else:
            return n, raw[i:]
    return n, ""


def _split_tokens(text: str, line: int, agents: set[str] | None, teams: set[str] | None,
                  errors: list[dict[str, Any]]) -> tuple[str, dict[str, Any]]:
    """Satır sonundaki etiketleri ayıklar; tanınmayan son kelime başlığın parçası kalır."""
    words = text.split()
    meta: dict[str, Any] = {}
    while words:
        w = words[-1]
        if (m := _TOK_PRIORITY.match(w)) and "priority" not in meta:
            try:
                meta["priority"] = normalize_priority(m.group(1))
            except ValueError as exc:
                errors.append({"line": line, "message": str(exc)})
                meta["priority"] = None
        elif (m := _TOK_DUE.match(w)) and "due" not in meta:
            try:
                meta["due"] = normalize_due(m.group(1))
            except ValueError as exc:
                errors.append({"line": line, "message": str(exc)})
                meta["due"] = None
        elif (m := _TOK_AGENT.match(w)) and "owner_agent" not in meta:
            slug = m.group(1)
            if agents is not None and slug not in agents:
                errors.append({"line": line, "message": f"Bilinmeyen ajan: @{slug}"})
            meta["owner_agent"] = slug
        elif (m := _TOK_TEAM.match(w)) and "owner_team" not in meta:
            slug = m.group(1)
            if teams is not None and slug not in teams:
                errors.append({"line": line, "message": f"Bilinmeyen ekip: #{slug}"})
            meta["owner_team"] = slug
        else:
            break
        words.pop()
    return " ".join(words), meta


def parse_bulk(text: str, *, agents: Iterable[str] | None = None,
               teams: Iterable[str] | None = None) -> tuple[list[ParsedGoal], list[dict[str, Any]]]:
    """Çok satırlı metni hedef ağacına çevirir. Dönüş: (kök hedefler, satır hataları)."""
    agent_set = set(agents) if agents is not None else None
    team_set = set(teams) if teams is not None else None
    errors: list[dict[str, Any]] = []
    if len(text) > MAX_TEXT:
        return [], [{"line": 0, "message": f"Metin çok uzun (en fazla {MAX_TEXT} karakter)"}]
    roots: list[ParsedGoal] = []
    stack: list[ParsedGoal] = []
    count = 0
    for no, raw in enumerate(text.splitlines(), start=1):
        if not raw.strip():
            continue
        indent, body = _indent_of(raw.rstrip())
        body = _BULLET.sub("", body, count=1).strip()
        if not body:
            continue
        kr = _KR.match(body)
        if kr:
            owner = next((g for g in reversed(stack) if g.indent < indent), None) \
                or next((g for g in reversed(stack) if g.indent <= indent), None)
            content = body[kr.end():].strip()
            if owner is None:
                errors.append({"line": no, "message": "Anahtar sonucun üstünde bir hedef yok"})
            elif not content:
                errors.append({"line": no, "message": "Anahtar sonuç metni boş"})
            elif len(owner.key_results) >= MAX_KRS:
                errors.append({"line": no, "message": f"Bir hedefte en fazla {MAX_KRS} anahtar sonuç olabilir"})
            else:
                item = parse_kr(content)
                if len(item["title"]) > MAX_TITLE:
                    errors.append({"line": no, "message": f"Anahtar sonuç {MAX_TITLE} karakteri aşıyor"})
                elif item["target"] is not None and item["target"] <= 0:
                    errors.append({"line": no, "message": "Anahtar sonucun hedef değeri sıfırdan büyük olmalı"})
                else:
                    owner.key_results.append({**item, "line": no})
            continue
        title, meta = _split_tokens(body, no, agent_set, team_set, errors)
        if not title:
            errors.append({"line": no, "message": "Hedef başlığı boş"})
            continue
        if len(title) > MAX_TITLE:
            errors.append({"line": no, "message": f"Başlık {MAX_TITLE} karakteri aşıyor"})
            continue
        count += 1
        if count > MAX_GOALS:
            errors.append({"line": no, "message": f"Tek seferde en fazla {MAX_GOALS} hedef eklenebilir"})
            break
        goal = ParsedGoal(title=title, line=no, indent=indent, **meta)
        while stack and stack[-1].indent >= indent:
            stack.pop()
        (stack[-1].children if stack else roots).append(goal)
        stack.append(goal)
    if not roots and not errors:
        errors.append({"line": 0, "message": "Metinde hedef bulunamadı"})
    return roots, errors


def count_goals(goals: Iterable[ParsedGoal]) -> int:
    return sum(1 + count_goals(g.children) for g in goals)
