"""R-13: kullanılabilir beyni olmayan koşu BAŞLAMADAN engellenir.

Eskiden beyinsiz bir koşu açılır, ilk adımda "Başarısız · altyapı" ile düşerdi ve öngörü yine "Ücretsiz (yerel)" derdi.
Artık tek başlatma kapısı (`Engine._launch`: API, MCP, zamanlama, tetikleyici, tarif, hedef) adımların ajanlarının
beynini `AgentRegistry.available_brains()` ile (ve bağlantı yoklamasının "hazır" dediği beyinlerle) denetler;
hiçbiri yoksa 409 `NoBrainError` döner (ileti Bağlantılar sayfasına yönlendirir). Hermes isteğe bağlıdır: yalnız
Hermes çalışma zamanındaki ajan Hermes ister. Enjekte edilmiş (gerçek olmayan) bağlayıcı kullanılabilir sayılır.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any, Iterable

from fastapi import HTTPException

from studio.agents import NO_BRAIN, RouteError

LINK = "/baglantilar"
MESSAGE = ("Çalıştırılamaz: {} için kullanılabilir beyin yok. Bağlantılar sayfasından (/baglantilar) bir beyin bağla "
           "(Ollama, Codex, Claude Code ya da bir API) ya da ajana hazır bir beyin seç; sonra yeniden başlat.")
# RouteError iletilerinden "beyin yok" anlamına gelenler (politika reddi gibi başka rota hataları çalışma anına kalır)
_NO_BRAIN_ROUTE = (NO_BRAIN, "Ollama'da kurulu model yok", "API bağlantısı bulunamadı",
                   "OpenAI uyumlu sunucu ayarlanmadı")
_KEYS = ("ollama", "codex", "claude", "openai_compat", "hermes")
REFRESH_TIMEOUT_S = 4.0


class NoBrainError(HTTPException):
    """Beyinsiz koşu → 409; `detail` = {code: no_brain, message, link, steps: [{step, agent, connection, reason}]}."""

    def __init__(self, problems: list[dict[str, Any]]):
        names = list(dict.fromkeys(str(p.get("name") or p.get("agent") or p.get("step")) for p in problems))
        shown = ", ".join(names[:5]) + (" …" if len(names) > 5 else "")
        super().__init__(409, {"code": "no_brain", "message": MESSAGE.format(shown), "link": LINK,
                               "steps": [{k: p.get(k) for k in ("step", "agent", "connection", "reason")}
                                         for p in problems]})
        self.problems = problems

    def __str__(self) -> str:  # sözlük dökümü değil, düz ileti (eval / kabul / kapı yolları str(exc) kullanır)
        return str(self.detail["message"])


def _real(connector: Any) -> bool:
    """Yerleşik bağlayıcı mı? Testlerin/gömenlerin enjekte ettiği bağlayıcı kendi kullanılabilirliğini bilir."""
    return type(connector).__module__.startswith("studio.connectors")


def usable(engine: Any) -> set[str]:
    """Şu an kullanılabilir bağlantılar: kurulu (`available_brains`) ∪ yoklamanın hazır dediği."""
    out: set[str] = set()
    probe = getattr(getattr(engine, "agents", None), "available_brains", None)
    if callable(probe):
        try:
            b = probe() or {}
        except Exception:  # noqa: BLE001 - yoklama düşerse engelleme (eski davranış)
            return set(_KEYS)
        out |= {k for k in _KEYS if b.get(k)}
    ready = getattr(engine, "brains_ready", None)
    if callable(ready):
        try:
            out |= {str(k) for k in ready() or ()}
        except Exception:  # noqa: BLE001
            pass
    return out


def _ollama_has(agents: Any, model: str | None) -> bool:
    """Rotanın Ollama modeli son model listesinde mi (yerel, uzak sunucu ya da onaylı bulut; `:latest` farkı yok sayılır)."""
    if not model:
        return False
    names = {str(m.get("name") or "") for m in getattr(agents, "ollama_models", None) or []}
    want = str(model)
    return want in names or f"{want}:latest" in names or want.removesuffix(":latest") in names


def _judge(engine: Any, node: Any, conn: str | None, model: str | None, base: dict[str, Any],
           have: list[set[str] | None]) -> dict[str, Any] | None:
    """Tek ajan (düğüm ya da kurulacak ajanın özellikleri) için rota düzeyinde denetim; sorun yoksa None."""
    agents = engine.agents
    try:
        r = agents.route(node, conn or None, model or None)
    except RouteError as exc:
        if str(exc).startswith(_NO_BRAIN_ROUTE):
            return {**base, "connection": None, "reason": "no_brain"}
        return None  # politika vb.: çalışma anında bildirilir
    connector = engine.connectors.get(r.connector)
    if connector is not None and not _real(connector):
        return None
    if r.connector == "openai_compat":
        return None  # rota, açık kimlikli uç noktayı zaten çözdü (`get_endpoint`); varsayılana bakılmaz
    if r.connector == "ollama" and _ollama_has(agents, r.model):
        return None  # rotanın kendi modeli listede (onaylı bulut modeli dahil)
    if have[0] is None:
        have[0] = usable(engine)
    if r.connector not in have[0]:
        return {**base, "connection": r.connector, "reason": "unavailable"}
    return None


def problems(engine: Any, steps: Iterable[Any] = (), entries: Iterable[tuple[str, dict[str, Any]]] = ()) -> list[dict[str, Any]]:
    """Adımların (ajan adımları) ve henüz oluşturulmamış ajanların (`entries`: (ad, özellikler); tarifin işe alacakları)
    beyin sorunları; boşsa koşu başlayabilir. Denetim ROTA düzeyindedir: Ollama'da rotanın modeli listede olmalı (ya da
    yerelde model kurulu olmalı); API bağlantısı rotanın açık kimliğiyle çözülmüştür."""
    from studio.workflow.spec import AGENTIC_TYPES  # noqa: PLC0415

    agents = getattr(engine, "agents", None)
    if agents is None or not callable(getattr(agents, "route", None)):
        return []
    have: list[set[str] | None] = [None]
    out: list[dict[str, Any]] = []
    for s in steps:
        if getattr(s, "type", None) not in AGENTIC_TYPES:
            continue
        slug = getattr(s, "agent", None)
        if not slug and getattr(s, "role", None):
            slug = engine.resolve_role(s.role)  # rol sahibi adım başlarken yeniden çözülür; kapı bugünküne bakar
        node = agents.node(slug) if slug else None
        if not node:
            continue  # ajan yok: kendi hata yolu
        base = {"step": s.id, "agent": slug, "name": node["props"].get("name") or slug}
        hit = _judge(engine, node, getattr(s, "connection", None), getattr(s, "model", None), base, have)
        if hit:
            out.append(hit)
    for name, props in entries:
        hit = _judge(engine, dict(props), None, None, {"step": None, "agent": None, "name": name}, have)
        if hit:
            out.append(hit)
    return out


def check(engine: Any, steps: Iterable[Any]) -> None:
    """Eşzamanlı yedek denetim (`Engine._launch`, çatal): yenileme yok."""
    found = problems(engine, steps)
    if found:
        raise NoBrainError(found)


async def acheck(engine: Any, steps: Iterable[Any] = (), origin: Any = None, *,
                 entries: Iterable[tuple[str, dict[str, Any]]] = ()) -> None:
    """düğüm yazılmadan ÖNCE denetim. Sorun görünürse engellemeden önce bir kez ucuz yenileme yapılır
    (Ollama stüdyodan sonra açıldıysa model listesi bayattır) ve yeniden denetlenir. Gizli sistem koşusu muaf."""
    from studio.workflow.system_calls import is_system_origin  # noqa: PLC0415

    if is_system_origin(origin):
        return
    steps, entries = list(steps), list(entries)
    found = problems(engine, steps, entries)
    if not found:
        return
    refresh = getattr(engine, "refresh_brains", None)
    if callable(refresh):
        try:
            await asyncio.wait_for(refresh(), REFRESH_TIMEOUT_S)
        except Exception:  # noqa: BLE001 - yenileme başarısız / zaman aşımı: eldeki bilgiyle karar verilir
            pass
        found = problems(engine, steps, entries)
    if found:
        raise NoBrainError(found)


def root_step(agent: str, step_type: str = "delegate") -> Any:
    """Devretme / orkestrasyon kökü için denetim adımı (kök ajanın kendi beyni)."""
    return SimpleNamespace(id="hedef", type=step_type, agent=agent, role=None, connection=None, model=None)
