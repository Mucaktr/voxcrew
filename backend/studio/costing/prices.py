"""Yerel fiyat tablosu (CG-COST): model → giriş/çıkış $/1M jeton, kaynak ve doğrulama tarihi.

Çalışma anında AĞA ÇIKILMAZ. Tablo el ile güncellenir; her satır `verified` (resmî sayfanın okunduğu gün, `None` =
doğrulanamadı) ve `source` taşır. Kullanıcı geçersiz kılması öngörü defterinde (`estimate.sqlite`, arayüzden düzenlenir) tutulur; ayar
`limits.pricing` da okunur. Gerçekleşen/öngörü karşılaştırması aynı tabloyla yeniden fiyatlanır.

Motorun tablosu (`workflow.pricing.ESTIMATED_PRICES`) tek fiyat kaynağıdır; burada yalnızca üst veri (sağlayıcı, tarih,
kaynak) ve motorun bilmediği sağlayıcı satırları (`EXTRA`) eklenir. Ön ek eşleşmesi: en uzun eşleşen ön ek kazanır.
"""

from __future__ import annotations

import math
from typing import Any

from studio.workflow.pricing import ESTIMATED_PRICES

# ön ek → (sağlayıcı, doğrulama günü | None, kaynak)
META: dict[str, tuple[str, str | None, str]] = {}
_ANTHROPIC = ("anthropic", "2026-10-18", "platform.claude.com/docs/en/about-claude/pricing")
_OPENAI_SRC = "developers.openai.com/api/docs/pricing"
# 2026-10-18'de resmî sayfada aynı fiyatla okunan OpenAI satırları; gpt-5-codex sayfada artık yok (doğrulanamadı)
_OPENAI_VERIFIED = {"gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini", "o3", "o4-mini"}
for _k in ESTIMATED_PRICES:
    if _k.startswith("claude"):
        META[_k] = _ANTHROPIC
    else:
        META[_k] = ("openai", "2026-10-18" if _k in _OPENAI_VERIFIED else None, _OPENAI_SRC)
# takma adlar ("opus" vb.) eski Claude Code adlarıdır; resmî sayfada bu adla satır yok
for _k in ("opus", "sonnet", "haiku"):
    META[_k] = ("anthropic", None, "takma ad — eski nesil fiyatı")

# Motor tablosunda olmayan sağlayıcılar: ön ek → (giriş, çıkış, sağlayıcı, doğrulama günü | None, kaynak)
# Hepsi 2026-10-18'de resmî fiyat sayfasından okundu (standart katman; toplu/önbellek indirimi yok). Uzun bağlam
# (>200K/272K) katmanları burada yok: öngörü kısa istem varsayar, aşan istem için tahmin düşük kalabilir.
_V = "2026-10-18"
_G = "ai.google.dev/gemini-api/docs/pricing"
_X = "docs.x.ai/docs/models"
_Q = "console.groq.com/docs/models"
_D = "api-docs.deepseek.com/quick_start/pricing"
EXTRA: dict[str, tuple[float, float, str, str | None, str]] = {
    # OpenAI — motor tablosu "gpt-5" ön ekiyle daha yeni sürümleri eski fiyattan sayardı; doğru satırlar burada
    "gpt-5.6-sol": (4.0, 20.0, "openai", _V, _OPENAI_SRC),
    "gpt-5.6-terra": (2.0, 12.0, "openai", _V, _OPENAI_SRC),
    "gpt-5.6-luna": (0.20, 1.20, "openai", _V, _OPENAI_SRC),
    "gpt-5.5-pro": (30.0, 180.0, "openai", _V, _OPENAI_SRC),
    "gpt-5.5": (5.0, 30.0, "openai", _V, _OPENAI_SRC),
    "gpt-5.4-pro": (30.0, 180.0, "openai", _V, _OPENAI_SRC),
    "gpt-5.4-mini": (0.75, 4.50, "openai", _V, _OPENAI_SRC),
    "gpt-5.4-nano": (0.20, 1.25, "openai", _V, _OPENAI_SRC),
    "gpt-5.4": (2.50, 15.0, "openai", _V, _OPENAI_SRC),
    "gpt-5.3-codex": (1.75, 14.0, "openai", _V, _OPENAI_SRC),
    "gpt-5.2-pro": (21.0, 168.0, "openai", _V, _OPENAI_SRC),
    "gpt-5.2": (1.75, 14.0, "openai", _V, _OPENAI_SRC),
    "gpt-5.1": (1.25, 10.0, "openai", _V, _OPENAI_SRC),
    "gpt-5-pro": (15.0, 120.0, "openai", _V, _OPENAI_SRC),
    # Google Gemini (200K altı istem). 3.8/3.6 Flash: 2026-12-31'e kadar indirimli fiyat, sonra 1.50/7.50
    "gemini-3.1-pro": (2.0, 12.0, "google", _V, _G),
    "gemini-2.5-pro": (1.25, 10.0, "google", _V, _G),
    "gemini-3.8-flash": (0.75, 3.75, "google", _V, _G + " (2026-12-31'e kadar)"),
    "gemini-3.6-flash": (0.75, 3.75, "google", _V, _G + " (2026-12-31'e kadar)"),
    "gemini-3-flash": (0.50, 3.0, "google", _V, _G),
    "gemini-2.5-flash": (0.30, 2.50, "google", _V, _G),
    "gemini-3.5-flash-lite": (0.30, 2.50, "google", _V, _G),
    "gemini-3.1-flash-lite": (0.25, 1.50, "google", _V, _G),
    "gemini-2.5-flash-lite": (0.10, 0.40, "google", _V, _G),
    # Mistral: sayfada yalnızca "Mistral Large" fiyatı var (sürüm belirtilmemiş); diğerleri doğrulanamadı → satır yok
    "mistral-large": (0.50, 1.50, "mistral", _V, "mistral.ai/pricing (sürüm belirtilmemiş)"),
    # DeepSeek: önbelleksiz giriş, yoğun saat fiyatı (temkinli; yoğun olmayan saatte yarısı)
    "deepseek-v4-pro": (1.32, 3.96, "deepseek", _V, _D),
    "deepseek-v4.1-flash": (0.30, 1.20, "deepseek", _V, _D),
    # Groq
    "openai/gpt-oss-120b": (0.15, 0.60, "groq", _V, _Q),
    "openai/gpt-oss-20b": (0.075, 0.30, "groq", _V, _Q),
    "qwen/qwen3.8-27b": (0.80, 4.0, "groq", _V, _Q),
    # xAI (200K altı istem)
    "grok-4.7": (2.0, 6.0, "xai", _V, _X),
    "grok-4.6": (2.0, 6.0, "xai", _V, _X),
    "grok-4.5": (2.0, 6.0, "xai", _V, _X),
    "grok-4.3": (1.25, 2.50, "xai", _V, _X),
    "grok-4.20": (1.25, 2.50, "xai", _V, _X),
    "grok-build-0.1": (1.0, 2.0, "xai", _V, _X),
}


# ---------------------------------------------------------------- önbellek fiyat çarpanları (giriş fiyatına göre)
# ön ek → (okuma, yazma 5 dk, yazma 1 sa, doğrulama günü, kaynak). `None` satır = doğrulanmadı → indirim/ek ücret
# VARSAYILMAZ (önbellek token'ları normal giriş fiyatıyla sayılır). Tabloda hiç eşleşmeyen sağlayıcı (Google, xAI,
# Groq, DeepSeek, Mistral…) da doğrulanmadı sayılır. En uzun ön ek kazanır.
# Anthropic: 2026-10-20 resmî belge — yazma 5 dk 1.25×, 1 sa 2×; okuma varsayılan 0.1×, Fable 5.1 / Mythos 5.1 0.025×
# ($0.25 / $10), Opus 5.5 0.05× ($0.20 / $4). Sonnet 5.5 okuma $0.20 / $2 giriş = 0.1× (varsayılan; önceki 0.05×
# yanlıştı). Haiku 5.5 için ayrı okuma fiyatı belgede yok → "claude" varsayılanı 0.1× (belgedeki "~0.1× elsewhere"; ayrıca
# doğrulanmadı). OpenAI: 2026-10-20 fiyat sayfası "Cached input" / "Input" oranı; önbelleğe yazma
# sütunu yalnız gpt-5.6 satırlarında (1.25×), diğerlerinde ek ücret yok. "-pro" ve gpt-5-codex satırlarında önbellekli
# fiyat yok → doğrulanmadı.
_CV = "2026-10-20"
_CACHE_SRC = "platform.claude.com/docs/en/build-with-claude/prompt-caching"
CACHE_MULT: dict[str, tuple[float, float, float, str, str] | None] = {
    "claude": (0.1, 1.25, 2.0, _CV, _CACHE_SRC),
    "claude-fable-5-1": (0.025, 1.25, 2.0, _CV, _CACHE_SRC),
    "claude-mythos-5-1": (0.025, 1.25, 2.0, _CV, _CACHE_SRC),
    "claude-opus-5-5": (0.05, 1.25, 2.0, _CV, _CACHE_SRC),
    "claude-sonnet-5-5": (0.1, 1.25, 2.0, _CV, _CACHE_SRC),   # $0.20 okuma / $2 giriş
    "gpt-5": (0.1, 1.0, 1.0, _CV, _OPENAI_SRC),
    "gpt-5.6": (0.1, 1.25, 1.25, _CV, _OPENAI_SRC),
    "gpt-4.1": (0.25, 1.0, 1.0, _CV, _OPENAI_SRC),
    "o3": (0.25, 1.0, 1.0, _CV, _OPENAI_SRC),
    "o4-mini": (0.25, 1.0, 1.0, _CV, _OPENAI_SRC),
    "gpt-5-pro": None, "gpt-5.2-pro": None, "gpt-5.4-pro": None, "gpt-5.5-pro": None, "gpt-5-codex": None,
    "opus": None, "sonnet": None, "haiku": None,   # eski takma adlar
}


def cache_multipliers(model: str | None) -> dict[str, Any] | None:
    """Modelin önbellek çarpanları {read, write_5m, write_1h, verified, source}; doğrulanmadıysa None."""
    name = str(model or "").strip().lower()
    if "::" in name:
        name = name.split("::", 1)[1]
    best = max((k for k in CACHE_MULT if name and name.startswith(k)), key=len, default=None)
    row = CACHE_MULT.get(best) if best else None
    if row is None:
        return None
    r, w5, w1, ver, src = row
    return {"read": r, "write_5m": w5, "write_1h": w1, "verified": ver, "source": src}


def _nonneg(v: Any) -> float:
    """Sonlu, > 0 sayı; değilse (negatif, NaN, inf, bool, metin) 0."""
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v > 0 else 0.0


def cache_tokens(tokens: dict[str, Any] | None) -> dict[str, float]:
    """Kullanım sözlüğünden önbellek token'ları {read, write, write_1h} (yoksa 0). `input` bunları İÇERİR.
    zaten bölünmüş sözlük ({read, write, write_1h}) de aynı sınırdan geçer."""
    t = tokens or {}
    if any(k in t for k in ("read", "write", "write_1h")):
        return {"read": _nonneg(t.get("read")), "write": _nonneg(t.get("write")), "write_1h": _nonneg(t.get("write_1h"))}
    return {"read": _nonneg(t.get("cache_read_tokens")), "write": _nonneg(t.get("cache_write_tokens")),
            "write_1h": _nonneg(t.get("cache_write_1h_tokens"))}


def input_units(tokens_in: float, price_in: float, model: str | None, cache: dict[str, Any] | None) -> float:
    """Giriş maliyeti × 1M ($/1M fiyatla çarpılmış token). `tokens_in` önbellek okuma/yazma dahil toplam girdidir.
    Çarpan doğrulanmadıysa ya da önbellek token'ı yoksa düz fiyat (indirim varsayılmaz)."""
    tin = _nonneg(tokens_in)
    mult = cache_multipliers(model) if cache else None
    if not mult:
        return tin * price_in
    cache = cache_tokens(cache)  # negatif/NaN önbellek alanı negatif maliyet üretemez
    read = min(cache["read"], tin)
    write = min(cache["write"], tin - read)
    w1 = min(cache["write_1h"], write)
    fresh = tin - read - write
    return price_in * (fresh + read * mult["read"] + (write - w1) * mult["write_5m"] + w1 * mult["write_1h"])


def _overrides(settings: Any, extra: dict[str, Any] | None = None) -> dict[str, tuple[float, float]]:
    raw = None
    try:
        raw = settings.get("limits.pricing", None) if settings is not None else None
    except Exception:  # noqa: BLE001 - ayar okunamazsa geçersiz kılma yok
        raw = None
    merged = {**(raw if isinstance(raw, dict) else {}), **(extra or {})}
    out: dict[str, tuple[float, float]] = {}
    for k, v in merged.items():
        try:
            if isinstance(v, dict):
                pair = (float(v.get("input", 0)), float(v.get("output", 0)))
            elif isinstance(v, (list, tuple)) and len(v) == 2:
                pair = (float(v[0]), float(v[1]))
            else:
                continue
        except (TypeError, ValueError):
            continue
        if pair[0] >= 0 and pair[1] >= 0:
            out[str(k).strip().lower()] = pair
    return out


def price_table(settings: Any = None, overrides: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Tüm satırlar: {model, provider, input, output, verified, source, override}. Kullanıcı satırı `override: True`
    ile tablodaki değerin yerini alır (yoksa yeni satır olarak eklenir). Kaynaklar: ayar `limits.pricing` ve
    öngörü defterindeki kullanıcı fiyatları (`overrides`; ikisi çakışırsa defter kazanır)."""
    rows: dict[str, dict[str, Any]] = {}
    for prefix, (pin, pout) in ESTIMATED_PRICES.items():
        prov, ver, src = META.get(prefix, ("?", None, ""))
        rows[prefix] = {"model": prefix, "provider": prov, "input": pin, "output": pout, "verified": ver,
                        "source": src, "override": False}
    for prefix, (pin, pout, prov, ver, src) in EXTRA.items():
        rows[prefix] = {"model": prefix, "provider": prov, "input": pin, "output": pout, "verified": ver,
                        "source": src, "override": False}
    for prefix, (pin, pout) in _overrides(settings, overrides).items():
        base = rows.get(prefix, {"model": prefix, "provider": "user", "verified": None, "source": "user"})
        rows[prefix] = {**base, "input": pin, "output": pout, "override": True,
                        "table": {"input": base.get("input"), "output": base.get("output")} if "input" in base else None}
    return sorted(rows.values(), key=lambda r: (r["provider"], r["model"]))


def lookup(model: str | None, settings: Any = None, table: list[dict[str, Any]] | None = None) -> dict[str, Any] | None:
    """Modelin satırı (en uzun ön ek); bilinmiyorsa None. `model` "uç nokta::model" biçiminde olabilir."""
    name = str(model or "").strip().lower()
    if "::" in name:
        name = name.split("::", 1)[1]
    if not name:
        return None
    best: dict[str, Any] | None = None
    for row in table if table is not None else price_table(settings):
        if name.startswith(row["model"]) and (best is None or len(row["model"]) > len(best["model"])):
            best = row
    return best


def cost(row: dict[str, Any] | None, tokens_in: float, tokens_out: float, model: str | None = None,
         cache: dict[str, Any] | None = None) -> float | None:
    """Satır fiyatıyla $. motorla aynı uzun bağlam katmanı (`workflow.pricing.LONG_CONTEXT_PRICES`; giriş eşiği
    aşılınca, kullanıcı fiyatı yoksa) uygulanır; böylece öngörü ve bütçe durması aynı rakamı verir. `cache`
    ({read, write, write_1h}; `cache_tokens`) verilirse doğrulanmış önbellek çarpanları uygulanır (motorla aynı)."""
    if row is None:
        return None
    pin, pout = float(row["input"]), float(row["output"])
    if not row.get("override"):
        from studio.workflow.pricing import LONG_CONTEXT_PRICES  # noqa: PLC0415 - döngüsel içe aktarmadan kaçın
        name = str(model or row.get("model") or "").strip().lower()
        if "::" in name:
            name = name.split("::", 1)[1]
        for prefix, (threshold, (lin, lout)) in LONG_CONTEXT_PRICES.items():
            if name.startswith(prefix) and float(tokens_in) > threshold:
                pin, pout = lin, lout
                break
    return round((input_units(float(tokens_in), pin, model or row.get("model"), cache)
                  + float(tokens_out) * pout) / 1_000_000, 6)
