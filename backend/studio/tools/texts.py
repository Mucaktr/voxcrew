"""Araç köprüsü ve guardrail'in koşu içi iletileri: TR şablon → koşu dilinde metin (EN: `locales/en_tools.py`)."""

from __future__ import annotations

from typing import Any


def lang_of(settings: Any) -> str:
    try:
        from studio.i18n import agent_lang
        return agent_lang(settings)
    except Exception:  # noqa: BLE001 - dil çözülemezse varsayılan TR
        return "tr"


def tt(lang: str | None, template: str, *args: Any) -> str:
    """Motorun `_t` deseni: TR'de şablon olduğu gibi; EN'de katalogdaki karşılık (yoksa TR)."""
    text = template.format(*args) if args else template
    if lang != "en":
        return text
    try:
        from studio.locales import en as _en
        target = _en.MESSAGES.get(template)
        if target is not None:
            return target.format(*args) if args else target
    except (ImportError, IndexError, KeyError, ValueError):
        pass
    return text
