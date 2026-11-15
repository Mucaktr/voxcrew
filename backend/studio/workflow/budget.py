"""Bütçe tavanları ve canlı kullanım.

Üç düzey: ayar `limits.default_budget` → akış/koşu `budget:` → adım `budget:`. Alt düzey yalnızca verdiği alanları
ezer (None = üstten devral; 0 = sınırsız değil, gerçekten 0). `on_exceeded`: pause | stop | ask (varsayılan pause).
Kullanım: `tokens`, `cost_usd` (ölçülmüş ya da tahmini; `cost_basis` measured|estimated|local|subscription|unknown),
`minutes`, `steps`. abonelikle oturum açılmış Claude Code / Codex adımı `cost_basis: subscription`,
`billing: subscription` ve `cost_usd = 0` yazar: $ tavanı bu adımlara işlemez; jeton ve süre tavanları işler.
Yeniden oynatılan iş (devam/yeniden deneme öncesi deneme) ayrı tutulur: `replayed`.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any

METRICS = ("tokens", "cost_usd", "minutes", "steps")
ON_EXCEEDED = ("pause", "stop", "ask")
WARN_RATIO = 0.8


class BudgetError(ValueError):
    pass


def _num(v: Any, key: str) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        raise BudgetError(f"Bütçe alanı sayı olmalı: {key}")
    try:
        out = float(v)
    except (TypeError, ValueError):
        raise BudgetError(f"Bütçe alanı sayı olmalı: {key}") from None
    if not math.isfinite(out):  # "nan"/"inf" tavan değildir (sınırsız sayılıyordu)
        raise BudgetError(f"Bütçe alanı sayı olmalı: {key}")
    if out < 0:
        raise BudgetError(f"Bütçe alanı negatif olamaz: {key}")
    return out


@dataclass
class Budget:
    tokens: float | None = None
    cost_usd: float | None = None
    minutes: float | None = None
    steps: float | None = None
    on_exceeded: str = "pause"

    @classmethod
    def parse(cls, raw: Any, *, base: "Budget | None" = None) -> "Budget":
        """`raw` sözlüğünü doğrular ve `base` üzerine bindirir (yalnızca verilen alanlar)."""
        out = Budget(**asdict(base)) if base else Budget()
        if raw is None:
            return out
        if not isinstance(raw, dict):
            raise BudgetError("Bütçe bir sözlük olmalı")
        for k in METRICS:
            if k in raw:
                setattr(out, k, _num(raw.get(k), k))
        if raw.get("on_exceeded") is not None:
            v = str(raw["on_exceeded"])
            if v not in ON_EXCEEDED:
                raise BudgetError(f"Bütçe aşım davranışı pause, stop ya da ask olmalı: {v}")
            out.on_exceeded = v
        return out

    def empty(self) -> bool:
        return all(getattr(self, k) is None for k in METRICS)

    def to_dict(self) -> dict[str, Any]:
        return {k: getattr(self, k) for k in METRICS} | {"on_exceeded": self.on_exceeded}

    def at_least(self, other: "Budget") -> "Budget":
        """PROC-FIX metrik başına büyük olan (None = sınırsız, her sayıdan büyük). Kart onayı elle konan tavanı
        asla düşürmez: `onay = max(öneri, güncel tavan)`."""
        out = Budget(**asdict(self))
        for k in METRICS:
            a, b = getattr(self, k), getattr(other, k)
            setattr(out, k, None if a is None or b is None else max(float(a), float(b)))
        return out

    def raised(self, factor: float = 1.5) -> "Budget":
        """Aşılan tavanları `factor` ile yükseltilmiş kopya (ask → "+%50 ver")."""
        out = Budget(**asdict(self))
        for k in METRICS:
            v = getattr(out, k)
            if v is not None:
                setattr(out, k, round(v * factor, 6))
        return out


def nice_ceil(metric: str, value: float) -> float:
    """PROC-FIX (ve süreç testi): öneri tavanını okunur bir sayıya YUKARI yuvarlar. Jeton → 2 anlamlı basamak
    (2.147.988 → 2.200.000; en az 1.000'in katı), dolar → sent, dakika ve adım → tam sayı. Asla aşağı yuvarlamaz."""
    v = max(0.0, float(value))
    if metric == "tokens":
        if v <= 0:
            return 0.0
        step = max(1000.0, 10 ** (math.floor(math.log10(v)) - 1))
        return float(math.ceil(v / step) * step)
    if metric == "cost_usd":
        return math.ceil(round(v * 100, 6)) / 100
    return float(math.ceil(round(v, 6)))


def propose_cap(metric: str, used: float, need: float | None, *, floor: float | None = None) -> float:
    """PROC-FIX aşım kartının önerisi = `kullanılan + sıradaki işin tahmini` (tahmin yoksa çağıranın verdiği son
    denemenin gerçek maliyeti), okunur sayıya yukarı yuvarlanmış; düz "+%50" yok. `floor` (ör. rezervasyonun
    öngördüğü toplam) varsa öneri en az odur. Öneri her durumda kullanılanın üstündedir (kart döngüsü yok)."""
    target = float(used) + max(0.0, float(need or 0))
    if floor is not None:
        target = max(target, float(floor))
    out = nice_ceil(metric, target)
    if out <= float(used):
        out = nice_ceil(metric, float(used) * 1.01 + (1000 if metric == "tokens" else 0.01 if metric == "cost_usd" else 1))
    return out


@dataclass
class Usage:
    tokens: float = 0.0
    cost_usd: float | None = None     # None = bilinmiyor (hiçbir adım maliyet vermedi)
    minutes: float = 0.0
    steps: int = 0
    cost_basis: str = "unknown"       # measured | estimated | local | subscription | mixed | unknown
    replayed: dict[str, float] = field(default_factory=lambda: {"tokens": 0.0, "cost_usd": 0.0, "minutes": 0.0})
    # PROC-FIX: çatala ebeveynden kopyalanan (yeniden çalışmayan) adımların kullanımı — bu koşunun harcaması DEĞİL
    inherited: dict[str, float] = field(default_factory=lambda: {"tokens": 0.0, "cost_usd": 0.0, "minutes": 0.0})
    # kullanıcı durdurması (duraklat / ret / iptal) bir CLI beynini istek uçuştayken öldürdüğünde o turun
    # TAHMİNİ maliyeti (`replayed` içinde harcamaya, sınıra ve karta dahil; burada ayrıca işaretli). Kayıtlı toplam
    # gerçeğin altında kalmaz (yalnız tahmin hatası kadar sapabilir).
    estimated: dict[str, float] = field(default_factory=lambda: {"tokens": 0.0, "cost_usd": 0.0})

    def to_dict(self) -> dict[str, Any]:
        return {"tokens": int(self.tokens), "cost_usd": self.cost_usd, "minutes": round(self.minutes, 3),
                "steps": self.steps, "cost_basis": self.cost_basis,
                **({"estimated_unrecorded": {"tokens": int(self.estimated.get("tokens", 0)),
                                             "cost_usd": round(self.estimated.get("cost_usd", 0.0), 6)}}
                   if self.estimated and self.estimated.get("tokens") else {}),
                "replayed": {"tokens": int(self.replayed.get("tokens", 0)),
                             "cost_usd": round(self.replayed.get("cost_usd", 0.0), 6),
                             "minutes": round(self.replayed.get("minutes", 0.0), 3)},
                "inherited": {"tokens": int(self.inherited.get("tokens", 0)),
                              "cost_usd": round(self.inherited.get("cost_usd", 0.0), 6),
                              "minutes": round(self.inherited.get("minutes", 0.0), 3)},
                # gerçek harcama = güncel denemeler + atılan (yeniden oynatılan) denemeler; kopyalanan hariç
                "spent_tokens": int(self.tokens + self.replayed.get("tokens", 0)),
                # koşu tavanı, kart, çubuk ve "Bugünkü harcama" bu sayıyı kullanır
                "spent": {"tokens": int(self.tokens + self.replayed.get("tokens", 0)),
                          "cost_usd": (None if self.cost_usd is None and not self.replayed.get("cost_usd")
                                       else round(float(self.cost_usd or 0) + float(self.replayed.get("cost_usd", 0.0)), 6)),
                          "minutes": round(self.minutes + self.replayed.get("minutes", 0.0), 3)}}

    def value(self, metric: str) -> float | None:
        return getattr(self, metric, None)

    def spent_view(self) -> "Usage":
        """GERÇEK harcama (güncel denemeler + durdurulan/yeniden oynatılan denemeler). Koşu tavanı bununla
        denetlenir: onaylanan sınır harcananı içeren mutlak toplamdır, yeni denemeye sıfırdan uygulanmaz."""
        r = self.replayed or {}
        cost = None if self.cost_usd is None and not r.get("cost_usd") else float(self.cost_usd or 0) + float(r.get("cost_usd") or 0)
        return Usage(tokens=float(self.tokens) + float(r.get("tokens") or 0), cost_usd=cost,
                     minutes=float(self.minutes) + float(r.get("minutes") or 0), steps=self.steps,
                     cost_basis=self.cost_basis)


@dataclass
class StepUsage:
    """Tek adımın (son denemesinin) kullanımı."""
    tokens: float = 0.0
    cost_usd: float | None = None
    minutes: float = 0.0
    cost_basis: str = "unknown"

    def to_dict(self) -> dict[str, Any]:
        return {"tokens": int(self.tokens), "cost_usd": self.cost_usd, "minutes": round(self.minutes, 3),
                "cost_basis": self.cost_basis,
                "billing": "subscription" if self.cost_basis == "subscription" else None}

    def empty(self) -> bool:
        return not self.tokens and not self.cost_usd and not self.minutes

    def plus(self, prior: dict[str, float] | None) -> "StepUsage":
        """adımın GERÇEK harcaması = bu deneme + önceki denemeleri (`StepState.prior`)."""
        p = prior or {}
        cost = None if self.cost_usd is None and not p.get("cost_usd") else float(self.cost_usd or 0) + float(p.get("cost_usd") or 0)
        return StepUsage(tokens=float(self.tokens or 0) + float(p.get("tokens") or 0), cost_usd=cost,
                         minutes=float(self.minutes or 0) + float(p.get("minutes") or 0), cost_basis=self.cost_basis)


@dataclass
class Breach:
    scope: str      # run | step
    metric: str
    used: float
    limit: float
    exceeded: bool  # False = yalnızca %80 uyarısı

    def to_dict(self) -> dict[str, Any]:
        return {"scope": self.scope, "metric": self.metric, "used": round(self.used, 6), "limit": self.limit,
                "ratio": round(self.used / self.limit, 3) if self.limit else None}


def check(usage: Usage | StepUsage, budget: Budget, scope: str) -> list[Breach]:
    """Her metrik için aşım (used > limit) ya da uyarı (used ≥ %80 limit). Bilinmeyen maliyet (None) denetlenmez."""
    out: list[Breach] = []
    for metric in METRICS:
        limit = getattr(budget, metric, None)
        if limit is None:
            continue
        used = getattr(usage, metric, None)
        if used is None:
            continue
        used = float(used)
        if used > limit:
            out.append(Breach(scope, metric, used, limit, True))
        elif limit > 0 and used >= limit * WARN_RATIO:
            out.append(Breach(scope, metric, used, limit, False))
    return out


def clamp_to(budget: Budget, cap: Budget) -> tuple[Budget, dict[str, Any]]:
    """`budget` metriklerini `cap` ile sınırlar (min(istenen, tavan); istenen sınırsızsa tavan).
    Dönüş: (yeni bütçe, {metrik: {"requested", "cap"}} — yalnız gerçekten düşürülenler)."""
    out = Budget(**asdict(budget))
    changed: dict[str, Any] = {}
    for k in METRICS:
        limit = getattr(cap, k)
        if limit is None:
            continue
        cur = getattr(out, k)
        if cur is None or cur > limit:
            changed[k] = {"requested": cur, "cap": limit}
            setattr(out, k, limit)
    return out, changed


def settings_budget(settings: Any) -> Budget:
    """Ayarlardaki varsayılan bütçe (`limits.default_budget`); bozuksa sınırsız."""
    try:
        raw = settings.get("limits.default_budget", None) if settings is not None else None
        return Budget.parse(raw if isinstance(raw, dict) else None)
    except BudgetError:
        return Budget()


# ------------------------------------------------------------------ varsayılan adım jeton tavanı
DEFAULT_STEP_TOKENS = 2_000_000
STEP_DEFAULT_ACTION = "ask"   # AUDIT T-1: varsayılan tavan aşılınca kullanıcıya sorulur (gizli koşu durur)
# G4-REST: `limits.step_tokens: "auto"` (varsayılan) → adımın öngörüsü varsa tavan = öngörü (üst bant) × çarpan,
# taban ve tavanla sınırlı; öngörü yoksa düz 2 000 000. Kullanıcının verdiği sayı her zaman kazanır.
STEP_TOKENS_AUTO = "auto"
ESTIMATE_FACTOR = 3.0
ESTIMATE_FLOOR = 50_000
ESTIMATE_CEILING = DEFAULT_STEP_TOKENS


# PROC2-FIX P1: boş veri klasöründe (bu bilgisayarda geçmiş yok) adım tavanı düz 2 000 000 değil, BEYİN başına QA
# ölçümüne dayanan varsayılandır. Jeton tanımı her yerde AYNI: bağlayıcının bildirdiği `total` (giriş = önbellekten
# okunan + önbelleğe yazılan dahil; Claude `input` + önbellek, Codex `input_tokens` önbellek dahil, Hermes `total`
# önbellek dahil) + çıkış. Öngörü geçmişi (`estimate.history.Sample.tokens`), adım tavanı, bütçe kartı ve ölçümler
# (`usage.tokens`) bu sayıyı kullanır; ayrı bir "faturalanan jeton" yoktur. `typical` = ölçülmüş tipik adım (kartın
# beklenen maliyeti, geçmiş yokken), `cap` = varsayılan tavan.
# Kaynaklar (adım toplamı, önbellek dahil):
#   claude — Analist 256.699; Analist 657.456 (480.707
#              önbellek okuma). Tavan = liderin "ilk koşunun 2 katı" kuralı (2 × 256.699 ≈ 520.000): A2'deki sapma
#              (657.456) adım sürerken karta döner.
#   profile  — Hermes profil ayarı (bulut model): A Kaynak 317.778; A2 Kaynak 436.841 (Hermes toplamı, önbellek dahil).
#              Tavan 2 × 317.778 ≈ 640.000.
#   codex — yalıtılmış Codex: A2 Denetçi 32.497 ve 16.654 (A'daki yalıtımsız 804.381/deneme skill okumasıydı,
#              kapandı). Tavan 200.000 (A2 ölçümünün ≈ 6 katı; yalıtımsız koşuyu adım sürerken durdurur).
#   local    — yerel model (Ollama, Hermes › Ollama, yerel OpenAI uyumlu): A2 Yazar 14.730 / 18.002, Planlayıcı 4.386 /
#              4.446; A Yazar 14.012, Planlayıcı 4.187. Yalnız `typical` (kartın beklenen maliyeti): yerel adım 0 $ olduğu
#              için ayrı bir beyin tavanı yoktur (`cap` 0 = yok); adım süresi `step_timeout_min` ile sınırlıdır ve
#              varsayılan tavan düz 2 000 000 kalır.
#   api      — uzak OpenAI uyumlu / Claude API araç döngüsü: QA ölçümü YOK; aynı tür araç döngüsü olan Claude ölçümü.
#
# TEK tablo. Öngörü (`estimate.estimator`, geçmiş yokken), adım tavanı varsayılanı (`with_step_default`) ve
# kartın tipik rakamı (`Engine._budget_need`) bu satırları okur. `output` = tipik adımın çıkış payı (A2: Claude ≈ 12k,
# Hermes 4.282, Codex 1.824, yerel 2.734); geri kalanı giriştir (önbellek dahil). `minutes` = (medyan, p80) dakika,
# geçmiş yokken öngörünün süre varsayılanı.
# `enforcement` = tavan adım SÜRERKEN nerede uygulanır:
#   turn     — bağlayıcı her model turunun kullanımını akıtır; adım tur sınırında, sıradaki model turundan ÖNCE durur
#              (Claude Code CLI `--include-partial-messages`, Claude/OpenAI uyumlu API araç döngüleri).
#   step_end — kullanım yalnız adım bitince bilinir; tavan adım bittiğinde denetlenir, çıktı korunur ve karar sıradaki
#              adımdan önce sorulur (Codex `exec --json` güncel `turn.completed` biçimi, Hermes, Ollama).
BRAIN_TABLE: dict[str, dict[str, Any]] = {
    "claude": {"typical": 460_000, "cap": 520_000, "output": 12_000, "minutes": (2.0, 5.0), "enforcement": "turn",
               "overhead": 20_000},
    "profile": {"typical": 380_000, "cap": 640_000, "output": 4_300, "minutes": (2.5, 6.0), "enforcement": "step_end"},
    "codex": {"typical": 33_000, "cap": 200_000, "output": 1_800, "minutes": (2.0, 5.0), "enforcement": "step_end",
              "overhead": 10_000},
    "local": {"typical": 15_000, "cap": 0, "output": 2_700, "minutes": (1.5, 4.0), "enforcement": "step_end"},
    "api": {"typical": 460_000, "cap": 520_000, "output": 12_000, "minutes": (0.6, 1.8), "enforcement": "turn"},
}
BRAIN_ORDER = ("claude", "api", "codex", "profile", "local")
# Geriye uyum: önceki adı ve biçimi (typical, cap) aynı tablodan türetilir
BRAIN_STEP_DEFAULTS: dict[str, dict[str, int]] = {k: {"typical": int(v["typical"]), "cap": int(v["cap"])}
                                                  for k, v in BRAIN_TABLE.items()}
ENFORCEMENT = ("turn", "step_end")
# `overhead` = CLI beyninin her ilk isteğe kendisinin eklediği sabit pay (sistem istemi + araç tanımları), geçmiş
# yokken uçuştaki ilk isteğin tahmininde kullanılır (geçmişte ölçülen ilk tur girdisi önce gelir). Claude Code:
# ölçümü 15–25 bin (≈ 20.000); Codex (yalıtılmış): A2 Denetçi adımı toplamı 16.654 → ilk tur ≈ 10.000.


def enforcement_of(connector: str | None, connection: str | None = None) -> str:
    """bu rotada adım tavanı nerede uygulanır (`turn` | `step_end`). Bağlayıcıya göre: yalnız Claude Code CLI ve
    OpenAI uyumlu bağlayıcının (Anthropic dahil) araç döngüsü tur başına kullanım akıtır."""
    c = connector or connection
    if c in ("claude", "openai_compat"):
        return "turn"
    return "step_end"


def brains_view() -> list[dict[str, Any]]:
    """Arayüz ve API için tablo: `[{key, typical, cap, enforcement}]` (ayar ekranı ve iş akışı düzenleyicisi)."""
    return [{"key": k, "typical": int(BRAIN_TABLE[k]["typical"]), "cap": int(BRAIN_TABLE[k]["cap"]),
             "enforcement": str(BRAIN_TABLE[k]["enforcement"])} for k in BRAIN_ORDER]


def brain_key(connector: str | None, connection: str | None, *, local: bool = False) -> str | None:
    """Rota → `BRAIN_STEP_DEFAULTS` anahtarı. `local` = bağlantı bu bilgisayarda (motorun `_local_connection`ı)."""
    if local or connection == "ollama":
        return "local"
    if connection == "claude":
        return "claude"
    if connection == "codex":
        return "codex"
    if connection == "profile":
        return "profile"
    if connection == "openai_compat":
        return "api"
    return None


def brain_default(key: str | None, field_: str = "cap") -> int | None:
    """Beyin varsayılanı; tanımsız ya da 0 (yerel: ayrı tavan yok) → None."""
    row = BRAIN_TABLE.get(key or "")
    v = int(row.get(field_) or 0) if row else 0
    return v or None


def step_tokens_mode(settings: Any) -> tuple[str, float | None]:
    """`limits.step_tokens` → ("auto", 2M) | ("setting", değer) | ("off", None).

    "auto" (ya da eski kurulumların dosyaya yazılmış yerleşik varsayılanı 2 000 000) öngörü tabanlı varsayılanı açar.
    kullanıcının açıkça kaydettiği 2 000 000 (`limits.step_tokens_explicit` işaretli) sabit tavandır.
    None/boş/0 ya da bozuk değer → kapalı."""
    explicit = False
    try:
        raw = settings.get("limits.step_tokens", STEP_TOKENS_AUTO) if settings is not None else STEP_TOKENS_AUTO
        explicit = settings.get("limits.step_tokens_explicit", False) is True if settings is not None else False
    except Exception:  # noqa: BLE001 - ayar okunamazsa yerleşik varsayılan
        raw = STEP_TOKENS_AUTO
    if isinstance(raw, str) and raw.strip().lower() == STEP_TOKENS_AUTO:
        return STEP_TOKENS_AUTO, float(DEFAULT_STEP_TOKENS)
    try:
        v = _num(raw, "limits.step_tokens")
    except BudgetError:
        return "off", None
    if v is None or v <= 0:
        return "off", None
    if v == DEFAULT_STEP_TOKENS and not isinstance(raw, bool) and not explicit:
        return STEP_TOKENS_AUTO, v
    return "setting", v


def step_tokens_default(settings: Any) -> float | None:
    """`limits.step_tokens` düz değeri ("auto" → 2 000 000). None/boş/0'dan küçük ya da bozuk değer → kapalı (None)."""
    return step_tokens_mode(settings)[1]


# (lider kararı): "tek onay yeter" kullanıcı sınır koymadan da tutmalı. Koşu jeton sınırı olmadan başlayan koşu
# (ayar `limits.default_budget.tokens` yok, akış/gövde bütçesi yok) OTOMATİK koşu bütçesi alır: başlamadan önceki
# öngörü (üst düzey adım başına alt ağaç dahil p90 tahmin; sentezler dahil) × `AUTO_RUN_FACTOR`, `ask`. Otomatik adım
# tavanları bu sınırın altına alınır ( kuralı): taşmalar koşu düzeyinde tek, gruplanmış karta döner. Kullanıcının
# YAML'da / ayarda koyduğu adım tavanı yine adım kartı açar. Ayar `limits.auto_run_budget: false` kapatır; adım tavanı
# kipi "auto" değilse (kapalı ya da sabit sayı) uygulanmaz. Gizli sistem koşuları ve mühürlü koşular almaz.
AUTO_RUN_FACTOR = 1.25
AUTO_RUN_FAN_OUT = 5.0  # öngörü servisi yokken yönetici adımının alt ağacı (öngörünün FAN_OUT üst değeri)


def auto_run_budget_enabled(settings: Any) -> bool:
    """`limits.auto_run_budget` (varsayılan açık). Kapalıysa koşu sınırı yokken otomatik adım tavanları eskisi gibi
    adım kartı açar."""
    try:
        raw = settings.get("limits.auto_run_budget", True) if settings is not None else True
    except Exception:  # noqa: BLE001 - ayar okunamazsa varsayılan
        return True
    if isinstance(raw, str):
        return raw.strip().lower() not in ("false", "off", "0", "no", "")
    return raw is not False and raw is not None and raw != 0


def estimate_cap(tokens: float) -> int:
    """Öngörü tabanlı adım tavanı: üst bant × `ESTIMATE_FACTOR`, [`ESTIMATE_FLOOR`, `ESTIMATE_CEILING`] aralığında."""
    return int(min(ESTIMATE_CEILING, max(ESTIMATE_FLOOR, round(float(tokens) * ESTIMATE_FACTOR, -3))))


def _usable_estimate(estimate: Any) -> float | None:
    if not isinstance(estimate, dict) or not estimate.get("samples"):
        return None  # geçmiş örneği yoksa öngörü yerleşik varsayılandır: tavan için kullanılmaz
    try:
        v = float(estimate.get("tokens") or 0)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) and v > 0 else None


def with_step_default(lim: Budget, settings: Any, *, raw: Any = None, defaults_raw: Any = None,
                      estimate: dict[str, Any] | None = None,
                      source: dict[str, Any] | None = None, brain: str | None = None) -> tuple[Budget, bool]:
    """Adım bütçesine varsayılan jeton tavanını ekler (adım ya da akış `defaults.budget` jeton vermediyse). Davranış
    açıkça verilmediyse `ask`. Dönüş: (bütçe, varsayılan uygulandı mı). Rezervasyon ve `_check_budget` bu
    tavanı başka bir adım tavanı gibi uygular; ayrı bir kapı yoktur.

    G4-REST: `estimate` = adımın öngörüsü `{"tokens": üst bant, "samples": n, …}`. Ayar "auto" iken ve geçmiş örneği
    varsa tavan `estimate_cap(tokens)`. `source` verilirse etkin tavanın kaynağı yazılır:
    step | workflow | setting | estimate | brain | default | off.

    PROC2-FIX P1: geçmiş yokken (`estimate` örneksiz) ve `brain` (rota anahtarı, `brain_key`) biliniyorsa tavan
    `BRAIN_STEP_DEFAULTS[brain].cap` (QA ölçümü); bilinmeyen beyinde düz 2 000 000 kalır."""
    def note(**kw: Any) -> None:
        if source is not None:
            source.clear()
            source.update(kw)

    if lim.tokens is not None:
        own = isinstance(raw, dict) and raw.get("tokens") not in (None, "")
        note(source="step" if own else "workflow", tokens=lim.tokens)
        return lim, False
    mode, cap = step_tokens_mode(settings)
    if cap is None:
        note(source="off", tokens=None)
        return lim, False
    est = _usable_estimate(estimate) if mode == STEP_TOKENS_AUTO else None
    if est is not None:
        cap = float(estimate_cap(est))
        note(source="estimate", tokens=cap, estimate=int(est), factor=ESTIMATE_FACTOR, floor=ESTIMATE_FLOOR,
             ceiling=ESTIMATE_CEILING, samples=int((estimate or {}).get("samples") or 0),
             level=(estimate or {}).get("level"))
    elif mode == STEP_TOKENS_AUTO and brain_default(brain) is not None:
        cap = float(brain_default(brain) or cap)
        note(source="brain", tokens=cap, brain=brain, typical=brain_default(brain, "typical"))
    else:
        note(source="setting" if mode == "setting" else "default", tokens=cap)
    out = Budget(**asdict(lim))
    out.tokens = cap
    explicit = any(isinstance(r, dict) and r.get("on_exceeded") is not None for r in (raw, defaults_raw))
    if not explicit:
        out.on_exceeded = STEP_DEFAULT_ACTION
    return out, True
