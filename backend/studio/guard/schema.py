"""Adım çıktısı şema doğrulaması — bağımlılıksız JSON Schema alt kümesi, saf fonksiyonlar.

Desteklenen anahtarlar: `type` (string | number | integer | boolean | object | array | null ya da liste), `properties`,
`required`, `items`, `enum`, `const`, `minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum`,
`minLength`/`maxLength`, `minItems`/`maxItems`, `additionalProperties` (bool ya da şema). Bilinmeyen anahtarlar yok
sayılır (daha sıkı değil, daha gevşek: yanlış ret yerine kaçırma).

`validate_output(text, schema)` model çıktısından JSON'u çıkarır (``` çitleri, metin içindeki ilk dengeli {…}/[…])
ve doğrular → `(ok, errors, parsed)`. `repair_prompt(errors, lang)` tek düzeltme turu için modele gidecek metni kurar.
Motor/spec bağlantısı (`output_schema`, `guard.output_schema_retries`) teknik liderde.
"""

from __future__ import annotations

import json
import re
from typing import Any

from studio.tools.texts import tt

MAX_ERRORS = 20
_FENCE = re.compile(r"```(?:json|JSON)?\s*\n?(.*?)```", re.S)
_TYPE_NAMES = ("string", "number", "integer", "boolean", "object", "array", "null")


def extract_json(text: str) -> tuple[bool, Any]:
    """Metinden JSON değerini çıkarır → (bulundu mu, değer)."""
    s = (text or "").strip()
    if not s:
        return False, None
    candidates = [s] + [m.group(1).strip() for m in _FENCE.finditer(s)]
    for c in candidates:
        try:
            return True, json.loads(c)
        except (json.JSONDecodeError, ValueError):
            pass
    # metin içindeki ilk dengeli nesne/dizi
    for start, ch in enumerate(s):
        if ch not in "{[":
            continue
        end = _balanced_end(s, start)
        if end is None:
            continue
        try:
            return True, json.loads(s[start:end + 1])
        except (json.JSONDecodeError, ValueError):
            continue
    return False, None


def _balanced_end(s: str, start: int) -> int | None:
    depth, in_str, esc = 0, False, False
    for i in range(start, len(s)):
        c = s[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c in "{[":
            depth += 1
        elif c in "}]":
            depth -= 1
            if depth == 0:
                return i
    return None


def _type_ok(value: Any, t: str) -> bool:
    if t == "string":
        return isinstance(value, str)
    if t == "boolean":
        return isinstance(value, bool)
    if t == "integer":
        return (isinstance(value, int) and not isinstance(value, bool)) or (
            isinstance(value, float) and value.is_integer())
    if t == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if t == "object":
        return isinstance(value, dict)
    if t == "array":
        return isinstance(value, list)
    if t == "null":
        return value is None
    return True  # bilinmeyen tür adı: gevşek


def _tname(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _short(value: Any) -> str:
    s = json.dumps(value, ensure_ascii=False)
    return s if len(s) <= 60 else s[:57] + "…"


def _validate(value: Any, schema: Any, path: str, errors: list[str], lang: str) -> None:
    if len(errors) >= MAX_ERRORS or not isinstance(schema, dict):
        return
    t = schema.get("type")
    if t is not None:
        types = [t] if isinstance(t, str) else [x for x in t if isinstance(x, str)] if isinstance(t, list) else []
        if types and not any(_type_ok(value, x) for x in types):
            errors.append(tt(lang, "{}: beklenen tür {}, gelen {}", path, " | ".join(types), _tname(value)))
            return
    if "const" in schema and value != schema["const"]:
        errors.append(tt(lang, "{}: değer {} olmalı", path, _short(schema["const"])))
    enum = schema.get("enum")
    if isinstance(enum, list) and value not in enum:
        errors.append(tt(lang, "{}: değer şunlardan biri olmalı: {}", path, ", ".join(_short(e) for e in enum[:12])))
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        for key, bad, tmpl in (("minimum", lambda v, m: v < m, "{}: en az {} olmalı (gelen {})"),
                               ("maximum", lambda v, m: v > m, "{}: en çok {} olmalı (gelen {})"),
                               ("exclusiveMinimum", lambda v, m: v <= m, "{}: {} değerinden büyük olmalı (gelen {})"),
                               ("exclusiveMaximum", lambda v, m: v >= m, "{}: {} değerinden küçük olmalı (gelen {})")):
            lim = schema.get(key)
            if isinstance(lim, (int, float)) and not isinstance(lim, bool) and bad(value, lim):
                errors.append(tt(lang, tmpl, path, _short(lim), _short(value)))
    if isinstance(value, str):
        if isinstance(schema.get("minLength"), int) and len(value) < schema["minLength"]:
            errors.append(tt(lang, "{}: en az {} karakter olmalı", path, schema["minLength"]))
        if isinstance(schema.get("maxLength"), int) and len(value) > schema["maxLength"]:
            errors.append(tt(lang, "{}: en çok {} karakter olmalı", path, schema["maxLength"]))
    if isinstance(value, list):
        if isinstance(schema.get("minItems"), int) and len(value) < schema["minItems"]:
            errors.append(tt(lang, "{}: en az {} öğe olmalı", path, schema["minItems"]))
        if isinstance(schema.get("maxItems"), int) and len(value) > schema["maxItems"]:
            errors.append(tt(lang, "{}: en çok {} öğe olmalı", path, schema["maxItems"]))
        items = schema.get("items")
        if isinstance(items, dict):
            for i, item in enumerate(value):
                _validate(item, items, f"{path}[{i}]", errors, lang)
    if isinstance(value, dict):
        props = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
        for key in schema.get("required") or []:
            if isinstance(key, str) and key not in value:
                errors.append(tt(lang, "{}: zorunlu alan eksik: {}", path, key))
        for key, sub in props.items():
            if key in value:
                _validate(value[key], sub, f"{path}.{key}", errors, lang)
        extra = schema.get("additionalProperties", True)
        for key in value:
            if key in props:
                continue
            if extra is False:
                errors.append(tt(lang, "{}: beklenmeyen alan: {}", path, key))
            elif isinstance(extra, dict):
                _validate(value[key], extra, f"{path}.{key}", errors, lang)


def check_schema(schema: Any) -> list[str]:
    """Şemanın kendisi desteklenen alt kümede anlamlı mı (spec doğrulaması için yardımcı)."""
    problems: list[str] = []

    def walk(s: Any, path: str) -> None:
        if not isinstance(s, dict):
            problems.append(f"{path}: şema bir nesne olmalı")
            return
        t = s.get("type")
        for name in ([t] if isinstance(t, str) else t if isinstance(t, list) else []):
            if name not in _TYPE_NAMES:
                problems.append(f"{path}: bilinmeyen tür {name}")
        for key, sub in (s.get("properties") or {}).items() if isinstance(s.get("properties"), dict) else []:
            walk(sub, f"{path}.{key}")
        if isinstance(s.get("items"), dict):
            walk(s["items"], f"{path}[]")
        if isinstance(s.get("additionalProperties"), dict):
            walk(s["additionalProperties"], f"{path}.*")

    walk(schema, "$")
    return problems


def validate_output(text: str, schema: dict[str, Any], lang: str = "tr") -> tuple[bool, list[str], Any]:
    """Model çıktısını şemaya göre doğrular → (geçerli mi, hatalar, ayrıştırılmış değer | None)."""
    found, parsed = extract_json(text)
    if not found:
        return False, [tt(lang, "Çıktıda geçerli JSON bulunamadı")], None
    errors: list[str] = []
    _validate(parsed, schema or {}, "$", errors, lang)
    return not errors, errors, parsed


def repair_prompt(errors: list[str], lang: str = "tr", schema: dict[str, Any] | None = None) -> str:
    """Tek düzeltme turu için modele gidecek istem: hatalar + (varsa) şema; yalnızca JSON istenir."""
    lines = [tt(lang, "Önceki yanıtın istenen JSON şemasına uymuyor. Hatalar:")]
    lines += [f"- {e}" for e in errors[:MAX_ERRORS]]
    if schema:
        lines += ["", tt(lang, "Şema:"), json.dumps(schema, ensure_ascii=False)]
    lines += ["", tt(lang, "Yalnızca şemaya uyan geçerli JSON döndür; açıklama, markdown ya da kod çiti ekleme.")]
    return "\n".join(lines)
