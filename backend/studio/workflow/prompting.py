"""İstem hattı (prompt pipeline): ajana giden sistem istemi ve görev metni aşamalarla kurulur.

Motor (engine.py) varsayılan bölümleri hazırlar; kayıtlı aşamalar (stage) bunları değiştirir. Böylece dil (i18n),
skill bağlamı, token booster'ları ve ileride pazar yerinden gelen eklentiler motor dosyasına dokunmadan eklenir.

Akış (her ajan çağrısında):
1. `prepare(ctx)`  — bellek hatırlamadan ÖNCE: bütçe, model yönlendirme ipucu, dil vb.
2. motor bellek paketini (varsa) `memory` bölümü olarak ekler (`ctx.memory_budget` kullanılır)
3. `finalize(ctx)` — son işlem: skill bağlamı, sıkıştırma, kırpma, tekrar ayıklama…; ardından bölümler katmana
   göre sıralanır (`order_sections`: kararlı → koşu → değişken → görev; bilinmeyen anahtar değişkendir). Değişken
   içerik (takdir, gelen kutusu, zaman) sistem istemine YAZILMAZ: sistem istemi ajanın kararlı önekidir.
4. motor `ctx.render_system()` / `ctx.render_prompt()` ile `Invocation` kurar; `ctx.extra` bağlayıcıya gider.

Aşama sözleşmesi: `name`, `order` (küçük önce), isteğe bağlı `prepare(ctx)` / `finalize(ctx)` ve
`enabled(ctx) -> bool`. Bir aşama hata verirse hat onu atlar, `ctx.report`a hata yazar ve devam eder (fail-open):
istem kurulumu bir eklenti yüzünden asla kırılmaz. Aşamalar `report()` ile ne yaptıklarını bildirir; motor bunu
`step.prompt` olayıyla arayüze taşır (ör. "Booster: −1.240 token").
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from studio.connectors.base import Route

log = logging.getLogger("studio.prompting")

# Bölüm türleri (aşamaların neye dokunabileceğini anlaması için)
TASK, UPSTREAM, EXTRA, MEMORY, SKILLS, CONTEXT = "task", "upstream", "extra", "memory", "skills", "context"
RECOGNITION, INBOX = "recognition", "inbox"

# İstem düzeni (AUDIT 2026-10-19 C-1; §4.4 katmanlarının P1 alt kümesi): kararlıdan değişkene. Önek önbelleği
# (Anthropic/OpenAI/Ollama KV) yalnız istemin BAŞI adımlar arasında aynı kaldıkça isabet eder; bu yüzden kararlı
# bölümler başa, değişkenler sona, görev en sona gider.
LAYER_STABLE = 2     # ajan sürümüne bağlı: skill katalogu, sabit bağlam
LAYER_RUN = 3        # koşu içinde adıma göre: devir (önceki adım çıktıları)
LAYER_VOLATILE = 4   # her adımda değişir: bellek, takdir, gelen kutusu, yeniden deneme notu, zamanla değişen içerik
LAYER_TASK = 5       # görev her zaman en sonda
SECTION_LAYERS: dict[str, int] = {
    SKILLS: LAYER_STABLE, CONTEXT: LAYER_STABLE,
    UPSTREAM: LAYER_RUN,
    MEMORY: LAYER_VOLATILE, RECOGNITION: LAYER_VOLATILE, INBOX: LAYER_VOLATILE, EXTRA: LAYER_VOLATILE,
    TASK: LAYER_TASK,
}


@dataclass
class Section:
    key: str                    # TASK, UPSTREAM, MEMORY… ya da aşamanın kendi anahtarı
    body: str
    title: str | None = None    # "GÖREV" → "# GÖREV\n<body>"; None ise gövde olduğu gibi yazılır
    compressible: bool = False  # booster kısaltabilir/özetleyebilir mi (görev metni asla)
    meta: dict[str, Any] = field(default_factory=dict)
    layer: int | None = None    # None → SECTION_LAYERS; tabloda yoksa DEĞİŞKEN (kararlı katman açıkça istenmeli)

    def render(self) -> str:
        return f"# {self.title}\n{self.body}" if self.title else self.body


@dataclass
class PromptContext:
    kind: str                   # "step" | "synthesis" | "plan"
    run_id: str
    step_id: str
    agent: dict[str, Any]       # Agent düğümünün props'u (slug dahil)
    route: Route
    task: str                   # işlenmiş görev metni (şablon değişkenleri çözülmüş)
    settings: Any               # studio.config.Settings
    store: Any = None           # studio.graph.store.GraphStore
    lang: str = "tr"            # "tr" | "en" — ajan çıktısının dili (i18n aşaması belirler)
    system_lines: list[str] = field(default_factory=list)
    sections: list[Section] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)   # Invocation.extra (bağlayıcı seçenekleri)
    memory_budget: int | None = None                       # karakter; None → ayar (memory.budget_chars)
    route_hint: dict[str, Any] | None = None               # {"connection":…, "model":…} — prepare'de önerilir
    report: list[dict[str, Any]] = field(default_factory=list)
    origin: str | None = None   # koşu kökeni ("schedule:<id>" → zamanlanmış iş önbellek süresi)

    # ------------------------------------------------------------------ yardımcılar
    def section(self, key: str) -> Section | None:
        return next((s for s in self.sections if s.key == key), None)

    def add(self, section: Section, *, before: str | None = None) -> None:
        if before and (idx := next((i for i, s in enumerate(self.sections) if s.key == before), None)) is not None:
            self.sections.insert(idx, section)
        else:
            self.sections.append(section)

    def note(self, stage: str, **data: Any) -> None:
        """Aşamanın yaptığını kaydeder (arayüz ve istatistik için)."""
        self.report.append({"stage": stage, **data})

    def render_system(self) -> str:
        return "\n".join(line for line in self.system_lines if line is not None)

    def render_prompt(self) -> str:
        return "\n\n".join(s.render() for s in self.sections if s.body or s.title is None and s.body)

    def size(self) -> int:
        return len(self.render_system()) + len(self.render_prompt())


def layer_of(section: Section) -> int:
    """Bölümün katmanı. Bilinmeyen anahtar değişkendir (C-1: eskiden "statik" sayılıp öneke giriyordu)."""
    if section.layer is not None:
        return int(section.layer)
    return SECTION_LAYERS.get(section.key, LAYER_VOLATILE)


def order_sections(ctx: PromptContext) -> None:
    """Bölümleri katmana göre kararlı (stable sort) sıralar: kararlı → koşu → değişken → görev."""
    ctx.sections.sort(key=layer_of)


def stable_prefix(ctx: PromptContext) -> str:
    """Önbelleğe uygun önek: sistem istemi + kararlı katmandaki bölümler (aynı ajanın adımları arasında birebir
    aynı kalmalı; `tests/test_prompt_layout.py`)."""
    stable = [s.render() for s in ctx.sections if layer_of(s) <= LAYER_STABLE and s.body]
    return ctx.render_system() + "\n\n" + "\n\n".join(stable)


# ---------------------------------------------------------------- katmanlı bloklar ve önbellek ipuçları
# Bağlayıcıya giden kullanıcı istemi `render_prompt()` ile AYNI metindir; `prompt_layout` yalnız katman sınırlarını
# (karakter aralıkları) taşır. Anthropic bağlayıcısı bu aralıklarla kullanıcı mesajını içerik bloklarına böler ve
# kararlı katmanın sonuna (⟂1) ve koşu katmanının sonuna (⟂2) `cache_control` koyar. Diğer bağlayıcılar metni olduğu
# gibi gönderir (otomatik önek önbelleği yalnız önek kararlılığına bakar).
LAYOUT_KEY = "prompt_layout"
CACHE_TTLS = ("5m", "1h", "off")
SCHEDULE_ORIGIN = "schedule:"


def render_blocks(ctx: PromptContext) -> list[tuple[int, str]]:
    """Kullanıcı istemi blokları [(katman grubu, metin)]: kararlı (≤L2), koşu (L3), değişken + görev (L4–L5). Boş grup
    atlanır; blok metinleri "\\n\\n" ile birleşince `render_prompt()` ile bayt bayt aynıdır."""
    groups: dict[int, list[str]] = {}
    for s in ctx.sections:
        if not s.body:
            continue
        layer = layer_of(s)
        g = LAYER_STABLE if layer <= LAYER_STABLE else LAYER_RUN if layer == LAYER_RUN else LAYER_VOLATILE
        groups.setdefault(g, []).append(s.render())
    return [(g, "\n\n".join(groups[g])) for g in (LAYER_STABLE, LAYER_RUN, LAYER_VOLATILE) if g in groups]


def prefix_hash(ctx: PromptContext) -> str:
    """sha256(kararlı önek) — aynı ajanın adımları arasında aynı kalmalı (adım/koşu kimliği, zaman içermez)."""
    return hashlib.sha256(stable_prefix(ctx).encode("utf-8")).hexdigest()


def cache_ttl(settings: Any, origin: str | None = None) -> str:
    """Açık önbellek süresi (karar 4): `limits.cache_ttl` = 5m (varsayılan) | 1h | off. Zamanlanmış koşu
    (`origin` = "schedule:…") için `limits.cache_ttl_scheduled` verilmişse o kullanılır (ör. 1h)."""
    def norm(v: Any) -> str | None:
        v = str(v or "").strip().lower()
        return v if v in CACHE_TTLS else None
    try:
        base = norm(settings.get("limits.cache_ttl", "5m")) if settings is not None else None
        sched = norm(settings.get("limits.cache_ttl_scheduled", None)) if settings is not None else None
    except Exception:  # noqa: BLE001 - ayar okunamazsa varsayılan
        base = sched = None
    if sched and str(origin or "").startswith(SCHEDULE_ORIGIN):
        return sched
    return base or "5m"


def layout(ctx: PromptContext) -> dict[str, Any]:
    """`ctx.extra["prompt_layout"]`: {segments: [[başlangıç, bitiş, grup]…], prefix_hash, cache_ttl}. Aralıklar
    `render_prompt()` metnine göredir (bağlayıcı doğrular; uymazsa düz metin gönderir)."""
    segments: list[list[int]] = []
    pos = 0
    for i, (g, text) in enumerate(render_blocks(ctx)):
        if i:
            pos += 2   # "\n\n"
        segments.append([pos, pos + len(text), g])
        pos += len(text)
    return {"segments": segments, "prefix_hash": prefix_hash(ctx), "cache_ttl": cache_ttl(ctx.settings, ctx.origin)}


@runtime_checkable
class PromptStage(Protocol):
    name: str
    order: int


_STAGES: dict[str, Any] = {}


def register(stage: Any) -> Any:
    """Aşama kaydeder (aynı ad yeniden kaydedilirse eskisinin yerini alır). Dekoratör olarak da kullanılabilir."""
    if not getattr(stage, "name", None):
        raise ValueError("Aşamanın adı (name) olmalı")
    _STAGES[stage.name] = stage
    return stage


def unregister(name: str) -> None:
    _STAGES.pop(name, None)


def stages() -> list[Any]:
    return sorted(_STAGES.values(), key=lambda s: (getattr(s, "order", 100), s.name))


def _run(phase: str, ctx: PromptContext) -> None:
    for stage in stages():
        fn = getattr(stage, phase, None)
        if fn is None:
            continue
        try:
            enabled = getattr(stage, "enabled", None)
            if enabled is not None and not enabled(ctx):
                continue
            fn(ctx)
        except Exception as exc:  # noqa: BLE001 — eklenti hatası istemi kırmamalı (fail-open)
            log.warning("istem aşaması %s/%s hata verdi: %s", stage.name, phase, exc)
            ctx.note(stage.name, phase=phase, error=str(exc)[:300])


def prepare(ctx: PromptContext) -> PromptContext:
    _run("prepare", ctx)
    return ctx


def finalize(ctx: PromptContext) -> PromptContext:
    _run("finalize", ctx)
    order_sections(ctx)   # C-1: booster kapalı olsa da düzen aynı (görev en sonda, değişkenler öneki bozmaz)
    try:
        ctx.extra[LAYOUT_KEY] = layout(ctx)   # katman sınırları + prefix_hash + önbellek süresi
    except Exception as exc:  # noqa: BLE001 - düzen bilgisi yoksa bağlayıcı düz metin gönderir
        log.warning("istem düzeni hesaplanamadı: %s", exc)
    return ctx
