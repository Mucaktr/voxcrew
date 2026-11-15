"""Maliyet ve süre öngörüsü (CG-COST) — saf hesap; stüdyoya bağlanma `service.py`de.

Yöntem (adım başına):
- **Süre**: bu bilgisayarın geçmişinde aynı (bağlantı, model, adım türü) → (bağlantı, model) → (bağlantı) için medyan
  ve p80 dakika; ≥3 örnekli ilk düzey kullanılır. Örnek yoksa bağlantı varsayılanı.
- **Jeton**: aynı örneklerden giriş/çıkış medyan ve p80; istem geçmiş medyanından uzunsa fark girişe eklenir.
- **Para**: yerel (Ollama, yerel OpenAI uyumlu sunucu) $0; abonelikle oturum açılmış Claude Code / Codex hiçbir zaman
  dolar göstermez ("aboneliğine dahil" + kullanım sınırı uyarısı); API anahtarlı uçlar yerel fiyat tablosundan
  (`prices.py`) aralık; fiyatı bilinmeyen model "unknown" (bilinmiyor ≠ 0).
- **Dürüst aralık**: güven = örnek sayısı (≥10 yüksek, ≥3 orta, aksi düşük); düşük güvende aralık genişletilir.
- İş akışında süre bağımlılık zincirinin en uzun yolu, jeton/para tüm adımların toplamıdır. Onay adımı süreye
  eklenmez (bekleme kullanıcıya bağlı). delegate/orchestrate alt görev açar: ×2–5 çarpan, güven en çok "düşük".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .history import History, percentile
from .prices import cost, lookup, price_table

CHARS_PER_TOKEN = 4.0
# geçmiş yokken jeton ve süre varsayılanı TEK tablodan (`workflow.budget.BRAIN_TABLE`): adım tavanı
# varsayılanı ve bütçe kartının tipik rakamı da aynı satırları okur. Öngörü bandı: alt = tipik × 0,6, üst = beyin tavanı
# (yerelde ayrı tavan yok → tipik × 2). Böylece öngörünün üst bandı adımın varsayılan tavanıdır; önerilen koşu bütçesi
# (üst × 1,5) adım tavanlarının toplamını sığdırır.
FALLBACK = (2.0, 5.0, 8000, 1500)   # tabloda olmayan bağlantı (medyan dk, p80 dk, giriş, çıkış)
NO_HISTORY_LOW = 0.6
NO_HISTORY_HIGH = 2.0               # tavanı olmayan beyinde üst bant = tipik × 2


def step_brain(connection: str | None, billing: str | None = None) -> str | None:
    """Öngörü adımının `BRAIN_TABLE` anahtarı (motorun `budget.brain_key`i ile aynı kural; yerel uç nokta → local)."""
    from studio.workflow.budget import brain_key  # noqa: PLC0415
    return brain_key(connection, connection, local=billing == "free_local")


def no_history_tokens(brain: str | None, prompt_tokens: float = 0.0) -> dict[str, float] | None:
    """Geçmiş yokken adımın jeton bandı (tablodan): {typical, low, high, in_low, in_high, out_low, out_high}."""
    from studio.workflow.budget import BRAIN_TABLE  # noqa: PLC0415
    row = BRAIN_TABLE.get(brain or "")
    if not row:
        return None
    typical = float(row["typical"]) + max(0.0, float(prompt_tokens))
    out = min(float(row.get("output") or 0), typical)
    high = max(float(row.get("cap") or 0), 0.0) or typical * NO_HISTORY_HIGH
    high = max(high, typical)
    out_high = min(out * NO_HISTORY_HIGH, high)
    return {"typical": typical, "low": typical * NO_HISTORY_LOW, "high": high,
            "in_low": (typical - out) * NO_HISTORY_LOW, "out_low": out * NO_HISTORY_LOW,
            "in_high": high - out_high, "out_high": out_high, "minutes": tuple(row.get("minutes") or FALLBACK[:2])}
FAN_OUT = (2.0, 5.0)  # delegate / orchestrate alt görev çarpanı (alt, üst)
LOW_WIDEN = {"high": 1.0, "medium": 0.85, "low": 0.6}
HIGH_WIDEN = {"high": 1.0, "medium": 1.25, "low": 2.0}
CONF_ORDER = {"low": 0, "medium": 1, "high": 2}
BUDGET_FACTOR = 1.5
SUBSCRIPTION_MODELS = {"claude": "claude-sonnet-5-5", "codex": "gpt-5"}  # API anahtarlı CLI'da model verilmemişse


@dataclass
class StepPlan:
    id: str
    type: str = "agent"
    connection: str = ""
    model: str | None = None
    prompt_chars: int = 0
    depends_on: list[str] = field(default_factory=list)
    billing: str | None = None   # free_local | subscription | api | unknown (verilmezse bağlamdan)
    label: str | None = None
    workflow: str | None = None  # geçmiş önce adımın kendi kimliğiyle (iş akışı + adım; ajan) eşleşir
    agent: str | None = None


@dataclass
class Context:
    """Faturalama kararı için ortam: bağlantı durumları (oturum ipucu), yerel uç noktalar, hazır beyinler."""
    settings: Any = None
    session_hints: dict[str, str | None] = field(default_factory=dict)   # claude/codex → file|api_key|keychain|none
    default_models: dict[str, str | None] = field(default_factory=dict)
    remote_ollama: set[str] = field(default_factory=set)                 # bulut (uzak) Ollama modelleri
    local_endpoint: Any = None                                           # callable(model_ref) -> bool | None
    ready: list[str] = field(default_factory=list)
    local_models: list[str] = field(default_factory=list)


def billing_of(step: StepPlan, ctx: Context) -> str:
    if step.billing:
        return step.billing
    c = step.connection
    if c == "ollama":
        return "subscription" if (step.model or "") in ctx.remote_ollama else "free_local"
    if c == "openai_compat":
        verdict = ctx.local_endpoint(step.model) if callable(ctx.local_endpoint) else None
        return "free_local" if verdict else "api"
    if c in ("claude", "codex"):
        return "api" if ctx.session_hints.get(c) == "api_key" else "subscription"
    return "unknown"


def _r(x: float, nd: int = 2) -> float:
    return round(float(x), nd)


def _step(step: StepPlan, hist: History, ctx: Context, table: list[dict[str, Any]]) -> dict[str, Any]:
    if step.type == "approval":
        return {"id": step.id, "type": step.type, "connection": None, "model": None, "billing": "none",
                "minutes": {"low": 0.0, "high": 0.0, "median": 0.0, "p80": 0.0}, "tokens": {"low": 0, "high": 0},
                "usd": {"low": 0.0, "high": 0.0}, "samples": 0, "level": "none", "confidence": "high", "waits": True}
    if step.billing == "no_brain":  # R-13: kullanılabilir beyin yok → çalıştırılamaz; süre/jeton/para uydurulmaz
        return {"id": step.id, "type": step.type, "connection": step.connection or None, "model": step.model,
                "label": step.label, "billing": "no_brain", "brain": None,
                "minutes": {"low": 0.0, "high": 0.0, "median": 0.0, "p80": 0.0},
                "tokens": {"low": 0, "high": 0, "input": {"low": 0, "high": 0}, "output": {"low": 0, "high": 0}},
                "usd": None, "price": None, "priced_model": None, "samples": 0, "level": "none", "confidence": "low"}
    xs, level = hist.match(step.connection, step.model, step.type, workflow=step.workflow, step=step.id,
                           agent=step.agent)
    n = len(xs)
    billing = billing_of(step, ctx)
    brain = step_brain(step.connection, billing)
    ptoks = step.prompt_chars / CHARS_PER_TOKEN
    nh = no_history_tokens(brain, ptoks)
    if nh:  # (medyan dk, p80 dk, giriş, çıkış) — tablodan; giriş isteme göre aşağıda büyür
        out0 = nh["out_low"] / NO_HISTORY_LOW
        d: tuple[float, float, float, float] = (float(nh["minutes"][0]), float(nh["minutes"][1]),
                                                nh["typical"] - ptoks - out0, out0)
    else:
        d = FALLBACK
    if n:
        med = percentile([s.minutes for s in xs], 0.5) or d[0]
        p80 = percentile([s.minutes for s in xs], 0.8) or d[1]
        in_med = percentile([s.tokens_in for s in xs], 0.5) or 0.0
        in_p80 = percentile([s.tokens_in for s in xs], 0.8) or 0.0
        out_med = percentile([s.tokens_out for s in xs], 0.5) or 0.0
        out_p80 = percentile([s.tokens_out for s in xs], 0.8) or 0.0
        hist_prompt = (percentile([s.prompt_chars for s in xs], 0.5) or 0.0) / CHARS_PER_TOKEN
        extra = max(0.0, ptoks - hist_prompt)
        in_med, in_p80 = in_med + extra, in_p80 + extra
        if not in_med and not out_med:  # geçmişte jeton yazılmamış (bazı bağlayıcılar) → varsayılan
            in_med, in_p80, out_med, out_p80 = d[2] + ptoks, (d[2] + ptoks) * 2, d[3], d[3] * 2
    else:
        med, p80 = d[0], d[1]
        in_med, in_p80 = d[2] + ptoks, (d[2] + ptoks) * 2
        out_med, out_p80 = d[3], d[3] * 2
    conf = "high" if n >= 10 and level in ("step", "agent", "model_type", "model") else "medium" if n >= 3 else "low"
    lo_f, hi_f = LOW_WIDEN[conf], HIGH_WIDEN[conf]
    fan = FAN_OUT if step.type in ("delegate", "orchestrate") else (1.0, 1.0)
    if fan != (1.0, 1.0):
        conf = "low"
    m_low, m_high = med * lo_f * fan[0], max(p80, med * 1.2) * hi_f * fan[1]
    tin_low, tin_high = in_med * lo_f * fan[0], max(in_p80, in_med * 1.2) * hi_f * fan[1]
    tout_low, tout_high = out_med * lo_f * fan[0], max(out_p80, out_med * 1.2) * hi_f * fan[1]
    if not n and nh:  # geçmiş yok → bant tablodan (üst = beyin tavanı; kartın tipik rakamı bandın içinde)
        tin_low, tout_low = nh["in_low"] * fan[0], nh["out_low"] * fan[0]
        tin_high, tout_high = nh["in_high"] * fan[1], nh["out_high"] * fan[1]
    usd: dict[str, float] | None = None
    price = None
    model_for_price = step.model
    if billing == "free_local":
        usd = {"low": 0.0, "high": 0.0}
    elif billing == "api":
        if not model_for_price and step.connection in SUBSCRIPTION_MODELS:
            model_for_price = ctx.default_models.get(step.connection) or SUBSCRIPTION_MODELS[step.connection]
        price = lookup(model_for_price, table=table)
        if price is not None:
            usd = {"low": cost(price, tin_low, tout_low, model_for_price) or 0.0,
                   "high": cost(price, tin_high, tout_high, model_for_price) or 0.0}
        else:
            billing = "unknown"
    return {"id": step.id, "type": step.type, "connection": step.connection, "model": step.model,
            "label": step.label, "billing": billing, "brain": brain,
            "minutes": {"low": _r(m_low), "high": _r(m_high), "median": _r(med), "p80": _r(p80)},
            "tokens": {"low": int(tin_low + tout_low), "high": int(tin_high + tout_high),
                       "input": {"low": int(tin_low), "high": int(tin_high)},
                       "output": {"low": int(tout_low), "high": int(tout_high)}},
            "usd": usd, "price": ({"model": price["model"], "input": price["input"], "output": price["output"],
                                    "verified": price["verified"], "override": price["override"]} if price else None),
            "priced_model": model_for_price if billing == "api" else None,
            "samples": n, "level": level, "confidence": conf}


def _critical(steps: list[StepPlan], per: dict[str, dict[str, Any]], key: str) -> float:
    """Bağımlılık zincirinin en uzun yolu (paralel dallar beklemez)."""
    memo: dict[str, float] = {}
    by_id = {s.id: s for s in steps}

    def longest(sid: str, seen: frozenset[str]) -> float:
        if sid in memo:
            return memo[sid]
        s = by_id.get(sid)
        if s is None or sid in seen:
            return 0.0
        before = max((longest(d, seen | {sid}) for d in s.depends_on), default=0.0)
        memo[sid] = before + float(per[sid]["minutes"][key])
        return memo[sid]

    return max((longest(s.id, frozenset()) for s in steps), default=0.0)


def money_kind(kinds: set[str]) -> str:
    if "no_brain" in kinds:  # R-13: hiçbir şey çalışmayacaksa "ücretsiz" denmez
        return "no_brain"
    if "api" in kinds:
        return "api"
    if "unknown" in kinds:
        return "unknown"
    if "subscription" in kinds:
        return "subscription"
    return "free_local"


def compute(steps: list[StepPlan], *, history: History | None = None, ctx: Context | None = None,
            table: list[dict[str, Any]] | None = None, cheaper: bool = True) -> dict[str, Any]:
    """Saf öngörü: adım planları → sözlük (bkz. `Estimate`)."""
    hist = history or History(samples=[])
    ctx = ctx or Context()
    table = table if table is not None else price_table(ctx.settings)
    per = {s.id: _step(s, hist, ctx, table) for s in steps}
    work = [p for p in per.values() if p["billing"] != "none"]
    kinds = {p["billing"] for p in work}
    kind = money_kind(kinds) if work else "free_local"
    usd = None
    if kind == "api":
        priced = [p["usd"] for p in work if p["usd"] is not None]
        usd = {"low": _r(sum(u["low"] for u in priced), 4), "high": _r(sum(u["high"] for u in priced), 4)}
    minutes = {"low": _r(_critical(steps, per, "low")), "high": _r(_critical(steps, per, "high"))}
    tokens = {"low": sum(p["tokens"]["low"] for p in work), "high": sum(p["tokens"]["high"] for p in work)}
    conf = min((p["confidence"] for p in work), key=lambda c: CONF_ORDER[c], default="low")
    samples = min((p["samples"] for p in work), default=0)
    notes: list[str] = []
    if "no_brain" in kinds:
        notes.append("no_brain")
    if "free_local" in kinds and "no_brain" not in kinds:
        notes.append("hardware_time")
    if "subscription" in kinds:
        notes.append("subscription_limits")
    if kind == "api" and ("unknown" in kinds or "subscription" in kinds):
        notes.append("partial_price")
    if kind == "unknown":
        notes.append("price_unknown")
    if any(p.get("waits") for p in per.values()):
        notes.append("approval_wait_excluded")
    if any(p["type"] in ("delegate", "orchestrate") for p in work):
        notes.append("fan_out")
    out: dict[str, Any] = {
        "minutes": minutes, "tokens": tokens,
        "money": {"kind": kind, "usd": usd, "kinds": sorted(kinds)},
        "confidence": conf, "samples": samples, "notes": notes,
        "steps": list(per.values()),
        "budget_prefill": {"tokens": int(round(tokens["high"] * BUDGET_FACTOR, -2)) or None,
                           "cost_usd": (_r(max(usd["high"] * BUDGET_FACTOR, 0.01), 2) if usd else None),
                           "on_exceeded": "ask", "factor": BUDGET_FACTOR},
        "cheaper": None,
    }
    if cheaper and kind in ("api", "subscription", "unknown"):
        out["cheaper"] = _cheaper(steps, hist, ctx, table, out)
    return out


AUTO_RUN_Q = 0.9  # alt ağaç geçmişinin p90'ı


def subtree_history(samples: list[Any], workflow: str | None, step_id: str, q: float = AUTO_RUN_Q) -> tuple[float, int]:
    """üst düzey adımın ALT AĞACIYLA (iç içe çocuklar, plan turları, sentez) birlikte geçmiş koşulardaki toplam
    jetonu: aynı iş akışında adımın kendisinin bittiği koşular; koşu başına toplam, `q` yüzdeliği. (değer, koşu sayısı);
    geçmiş yoksa (0, 0)."""
    if not workflow or not step_id:
        return 0.0, 0
    per_run: dict[str, float] = {}
    tops: set[str] = set()
    pre = step_id + "."
    for x in samples:
        if getattr(x, "workflow", "") != workflow or not getattr(x, "run_id", ""):
            continue
        sid = str(getattr(x, "step_id", "") or "")
        if sid == step_id:
            tops.add(x.run_id)
        if sid == step_id or sid.startswith(pre):
            per_run[x.run_id] = per_run.get(x.run_id, 0.0) + float(x.tokens)
    vals = [v for r, v in per_run.items() if r in tops and v > 0]
    if not vals:
        return 0.0, 0
    return float(percentile(vals, q) or 0.0), len(vals)


def auto_run_steps(steps: list[StepPlan], est: dict[str, Any], samples: list[Any],
                   workflow: str | None) -> dict[str, dict[str, Any]]:
    """otomatik koşu bütçesinin adım başına öngörüsü {adım: {tokens, basis, runs}}. Önce adımın alt ağaç
    geçmişi (`history`: aynı iş akışı, p90), yoksa öngörünün üst bandı (`estimate`: bağlantı/model geçmişi ya da geçmiş
    yokken beyin tablosu; yönetici adımında alt görev çarpanı dahil). Onay adımları sayılmaz."""
    per = {str(p.get("id")): p for p in est.get("steps") or [] if isinstance(p, dict)}
    out: dict[str, dict[str, Any]] = {}
    for s in steps:
        if s.type == "approval":
            continue
        v, n = subtree_history(samples, workflow, s.id)
        if v > 0:
            out[s.id] = {"tokens": int(round(v)), "basis": "history", "runs": n}
            continue
        high = int(((per.get(s.id) or {}).get("tokens") or {}).get("high") or 0)
        if high > 0:
            out[s.id] = {"tokens": high, "basis": "estimate", "runs": 0}
    return out


def _cheaper(steps: list[StepPlan], hist: History, ctx: Context, table: list[dict[str, Any]],
             cur: dict[str, Any]) -> dict[str, Any] | None:
    """Ucuz seçenek: hazır yerel model (ücretsiz) ya da API yerine abonelikli beyin (dolar ödemeden)."""
    def alt(conn: str, model: str | None, billing: str) -> dict[str, Any]:
        swapped = [StepPlan(s.id, s.type, conn if s.type != "approval" else s.connection,
                            model if s.type != "approval" else s.model, s.prompt_chars, list(s.depends_on),
                            billing if s.type != "approval" else None, s.label) for s in steps]
        return compute(swapped, history=hist, ctx=ctx, table=table, cheaper=False)

    def ratio(a: dict[str, Any]) -> float | None:
        # süre verisi yoksa (0 ya da eksik) karşılaştırma yok → None (arayüz hız cümlesi kurmaz; "~∞×" olmaz)
        try:
            base = (float(cur["minutes"]["low"]) + float(cur["minutes"]["high"])) / 2
            alt_ = (float(a["minutes"]["low"]) + float(a["minutes"]["high"])) / 2
        except (KeyError, TypeError, ValueError):
            return None
        if base <= 0 or alt_ <= 0:
            return None
        r = round(alt_ / base, 1)
        return r if r > 0 else None

    if "ollama" in ctx.ready and ctx.local_models and set(cur["money"]["kinds"]) != {"free_local"}:
        model = ctx.local_models[0]
        a = alt("ollama", model, "free_local")
        return {"brain": "ollama", "model": model, "kind": "free_local", "speed_ratio": ratio(a),
                "minutes": a["minutes"], "confidence": a["confidence"]}
    if cur["money"]["kind"] == "api":
        for conn in ("claude", "codex"):
            if conn in ctx.ready and ctx.session_hints.get(conn) not in ("api_key", "none", None):
                a = alt(conn, None, "subscription")
                return {"brain": conn, "model": None, "kind": "subscription", "speed_ratio": ratio(a),
                        "minutes": a["minutes"], "confidence": a["confidence"]}
    return None


# ---------------------------------------------------------------- çağrı başına en çok (rezervasyon)
RESERVE_Q = 0.9  # rezervasyon yüzdeliği: p90


def per_call_max(hist: History, connection: str, model: str | None, type_: str = "agent", *,
                 billing: str = "unknown", price: Any = None, workflow: str | None = None, step: str | None = None,
                 agent: str | None = None) -> dict[str, Any]:
    """tek bir model turu için ayrılacak en çok kullanım = bu bilgisayarın geçmişinde p90 jeton / süre;
    para = p90 giriş/çıkış jetonu × fiyat (`price(tin, tout) -> $ | None`).

    - Yerel (`local`/`free_local`) ve abonelikli (`subscription`) beyinde para 0'dır; yalnız jeton ve süre ayrılır.
    - Geçmiş örneği yoksa tahmin YOKTUR (`basis: "none"`): uydurma varsayılan ayrılmaz (yanlış engelleme riski);
      jeton/süre/para `None` döner, çağıran yalnız "tavanda yer kaldı mı" denetler ve aşımda `ask` kartı açar.
    - Fiyatı bilinmeyen API modelinde para `None`dur (bilinmiyor ≠ 0): yalnız jeton ve süre ayrılır."""
    xs, level = hist.match(connection, model, type_, workflow=workflow, step=step, agent=agent)
    free = billing in ("local", "free_local", "subscription")
    if not xs:
        return {"tokens": None, "tokens_in": None, "tokens_out": None, "minutes": None,
                "cost_usd": 0.0 if free else None, "billing": billing, "samples": 0, "level": level, "basis": "none"}
    tin = percentile([s.tokens_in for s in xs], RESERVE_Q) or 0.0
    tout = percentile([s.tokens_out for s in xs], RESERVE_Q) or 0.0
    tok = percentile([s.tokens for s in xs], RESERVE_Q) or 0.0
    minutes = percentile([s.minutes for s in xs], RESERVE_Q) or 0.0
    usd: float | None
    if free:
        usd = 0.0
    else:
        try:
            usd = price(tin, tout) if callable(price) else None
        except Exception:  # noqa: BLE001 - fiyat okunamazsa para bilinmiyor (yalnız jeton/süre)
            usd = None
    return {"tokens": round(max(tok, tin + tout), 3), "tokens_in": round(tin, 3), "tokens_out": round(tout, 3),
            "minutes": round(minutes, 4), "cost_usd": None if usd is None else round(float(usd), 6),
            "billing": billing, "samples": len(xs), "level": level, "basis": "history"}
