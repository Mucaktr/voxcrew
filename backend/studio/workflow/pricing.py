"""Tahmini model fiyatları: model → $/1M jeton (giriş, çıkış).

Yalnızca **tahmin** içindir ("estimated" etiketiyle gösterilir); kaynağı belirsiz model için `None` döner ve maliyet
gösterilmez. Ollama (yerel) maliyeti 0'dır; bütçe birimi orada süre/jetondur. Bağlayıcının kendisi ölçülmüş maliyet
verirse (Claude Code `total_cost_usd`) o değer "measured" olarak kullanılır, tablo devreye girmez.
Tablo el ile güncellenir. Tek fiyat kaynağı `studio.costing.prices`tır (doğrulanmış satırlar + kullanıcı fiyatları);
`ESTIMATED_PRICES` yalnızca orada olmayan modeller için yedek tablodur (doğrulanmamış diye işaretlenir).
"""

from __future__ import annotations

import math
from typing import Any

# ad ön eki (küçük harf) → (giriş $/1M, çıkış $/1M). Ön ek eşleşmesi: "gpt-5-codex" → "gpt-5".
ESTIMATED_PRICES: dict[str, tuple[float, float]] = {
    # OpenAI (Codex CLI)
    "gpt-5-codex": (1.25, 10.0),
    "gpt-5-mini": (0.25, 2.0),
    "gpt-5-nano": (0.05, 0.40),
    "gpt-5": (1.25, 10.0),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1": (2.00, 8.00),
    "o4-mini": (1.10, 4.40),
    "o3": (2.00, 8.00),
    # Anthropic (Claude Code; genelde ölçülmüş maliyet gelir, tablo yedek). Kaynak: claude.com/pricing, 2026-10-17
    # okundu (resmî sayfa; "Latest" ve "Legacy" tabloları). Uzun bağlam katmanı: LONG_CONTEXT_PRICES.
    "claude-fable-5-1": (10.0, 50.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-fable-5": (10.0, 50.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-opus-4-8": (5.0, 25.0),
    "claude-opus-4-7": (5.0, 25.0),
    "claude-opus-4-6": (5.0, 25.0),
    "claude-opus-4-5": (5.0, 25.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-sonnet-4-5": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-opus-4": (15.0, 75.0),
    "claude-sonnet-4": (3.0, 15.0),
    "claude-haiku-4": (1.0, 5.0),
    "claude-3-5-haiku": (0.80, 4.0),
    "opus": (15.0, 75.0),
    "sonnet": (3.0, 15.0),
    "haiku": (1.0, 5.0),
}

# Uzun bağlam katmanı: ön ek → (giriş jeton eşiği, (giriş $/1M, çıkış $/1M)). Resmî fiyat istek (prompt) başına
# eşiğe bakar; motor adım toplamını bilir, bu yüzden çok turlu adımda eşik toplamla aşılabilir → temkinli (fazla) tahmin.
LONG_CONTEXT_PRICES: dict[str, tuple[int, tuple[float, float]]] = {
    "claude-haiku-5-5": (100_000, (0.50, 2.50)),
}

LOCAL_CONNECTIONS = frozenset({"ollama"})


def price_overrides(settings: Any) -> dict[str, Any]:
    """Kullanıcı fiyatları: ayar `limits.pricing` + öngörü defteri (`estimate.sqlite`, arayüzden düzenlenir; defter
    kazanır). Motor bunu verir; böylece bütçe çubuğu ve bütçe durması öngörüyle aynı rakamı kullanır (tek kaynak)."""
    out: dict[str, Any] = {}
    try:
        raw = settings.get("limits.pricing", None) if settings is not None else None
    except Exception:  # noqa: BLE001
        raw = None
    if isinstance(raw, dict):
        out.update(raw)
    out.update(_REGISTERED.get(id(settings), {}))
    return out


# ayar nesnesi (stüdyo) → öngörü defterindeki kullanıcı fiyatları; öngörü servisi (full sürüm) günceller
_REGISTERED: dict[int, dict[str, Any]] = {}


def register_overrides(settings: Any, overrides: dict[str, Any] | None) -> None:
    if overrides:
        _REGISTERED[id(settings)] = dict(overrides)
    else:
        _REGISTERED.pop(id(settings), None)


def price_for(model: str | None, overrides: dict[str, Any] | None = None) -> tuple[float, float] | None:
    """Modelin (giriş, çıkış) $/1M fiyatı; bilinmiyorsa None. TEK KAYNAK: `studio.costing.prices` (doğrulanmış tablo +
    `EXTRA` satırları + kullanıcı fiyatları; en uzun ön ek kazanır). Doğrulanmış tabloda olmayan modeller bu dosyadaki
    eski tablodan gelir ve orada `verified: None` (doğrulanmamış) diye işaretlidir."""
    row = price_row(model, overrides)
    return (float(row["input"]), float(row["output"])) if row else None


def price_row(model: str | None, overrides: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """Fiyat satırı {model, provider, input, output, verified, source, override}; bilinmiyorsa None."""
    name = str(model or "").strip().lower()
    if not name:
        return None
    from studio.costing.prices import lookup, price_table  # döngüsel içe aktarmadan kaçın (o modül bunu içe aktarır)
    return lookup(name, table=price_table(None, overrides))


def is_local_endpoint(url: Any) -> bool:
    """URL'nin ana makinesi bu bilgisayar mı (localhost, *.localhost, 127.0.0.0/8, ::1)? LM Studio / llama.cpp / yerel
    vLLM gibi OpenAI uyumlu sunucular için maliyet "local" sayılır."""
    import ipaddress
    from urllib.parse import urlsplit

    raw = str(url or "").strip()
    if not raw:
        return False
    try:
        host = (urlsplit(raw if "://" in raw else f"http://{raw}").hostname or "").lower()
    except ValueError:
        return False
    if not host:
        return False
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def estimate_cost(model: str | None, tokens_in: Any, tokens_out: Any, *, connection: str | None = None,
                  overrides: dict[str, Any] | None = None, cache: dict[str, Any] | None = None) -> float | None:
    """Tahmini maliyet ($). Yerel bağlantıda 0.0; fiyat bilinmiyorsa None (bilinmiyor ≠ 0).
    `cache` = kullanım sözlüğü (`cache_read_tokens`, `cache_write_tokens`, `cache_write_1h_tokens`) ya da
    `prices.cache_tokens` çıktısı; `tokens_in` bunları içerir. Doğrulanmış çarpan yoksa indirim varsayılmaz."""
    if connection in LOCAL_CONNECTIONS:
        return 0.0
    pair = price_for(model, overrides)
    if pair is None:
        return None
    try:
        tin = float(tokens_in or 0)
        tout = float(tokens_out or 0)
    except (TypeError, ValueError):
        return None
    # negatif/NaN/inf token sayısı negatif ya da tanımsız maliyet üretemez
    tin = tin if math.isfinite(tin) and tin > 0 else 0.0
    tout = tout if math.isfinite(tout) and tout > 0 else 0.0
    name = str(model or "").strip().lower()
    for prefix, (threshold, long_pair) in LONG_CONTEXT_PRICES.items():
        if name.startswith(prefix) and tin > threshold and not _overridden(name, overrides):
            pair = long_pair
            break
    from studio.costing.prices import cache_tokens, input_units  # noqa: PLC0415 - döngüsel içe aktarmadan kaçın
    split = None
    if cache:
        split = cache_tokens(cache)  # bölünmüş sözlük de sınırdan geçer
    return round((input_units(tin, pair[0], name, split) + tout * pair[1]) / 1_000_000, 6)


def cache_hit_ratio(tokens: dict[str, Any] | None) -> float | None:
    """Adımın önbellek isabeti = cache_read / input (`input` önbellek okuma + yazma dahil toplam girdi). Sağlayıcı
    önbellek alanı bildirmediyse None ("ölçülmedi"; 0 uydurulmaz)."""
    t = tokens or {}
    if "cache_read_tokens" not in t and "cache_write_tokens" not in t:
        return None
    try:
        inp = float(t.get("input") or 0)
        read = float(t.get("cache_read_tokens") or 0)
    except (TypeError, ValueError):
        return None
    if inp <= 0:
        return None
    return round(min(1.0, max(0.0, read / inp)), 4)


def _overridden(name: str, overrides: dict[str, Any] | None) -> bool:
    """Kullanıcı bu model için `limits.pricing` verdiyse uzun bağlam katmanı uygulanmaz (kullanıcı değeri kazanır)."""
    return any(name.startswith(str(k).lower()) for k in (overrides or {}))
