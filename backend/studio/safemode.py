"""Güvenli mod ön ayarı ve yerel 18+ beyanı (TRUST).

Güvenli mod bir KİLİT değildir, bir ÖN AYARDIR: var olan ayar anahtarlarına temkinli değerler yazar. Her anahtar sonra
da görünür ve tek tek değiştirilebilir. Açarken önceki değerler saklanır; "Kapat" yalnızca hâlâ ön ayarın yazdığı
değerde duran anahtarları eski hâline döndürür (kullanıcının sonradan kendi değiştirdiği anahtar korunur).

| Uç | Gövde | Yanıt |
|---|---|---|
| `GET /api/safe-mode` | — | `{enabled, since, source, items, notes, age}` (açmadan önceki önizleme `items[].changed`) |
| `POST /api/safe-mode/enable` | `{}` | durum + `changed` (yazılan madde kimlikleri) |
| `POST /api/safe-mode/disable` | `{}` | durum + `restored`, `kept` |
| `PUT /api/safe-mode/items/{id}` | `{value: bool}` | durum (yalnız evet/hayır maddeleri) |
| `POST /api/safe-mode/age` | `{adult: bool}` | durum; `adult: false` güvenli modu açar (kimseyi dışarıda bırakmaz) |

Yazma uçlarının hepsi kullanıcıya aittir: `USER_ONLY_RE` (`safe-mode/`) sunum katmanında arayüz jetonu ister; rota
ayrıca MCP başlığını ve arayüz varlığını denetler. `safe_mode` ve `trust.age_ok` genel `PUT /api/settings` ile
yazılamaz; izin listesinde olmadıkları için MCP zaten yazamaz.

Beyan yalnız yerelde (`settings.json`) saklanır: hiçbir yere gönderilmez, kimlik istenmez.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Callable

from fastapi import APIRouter, Body, HTTPException, Request

if TYPE_CHECKING:
    from studio.api import Studio

USER_ONLY = "Güvenli mod ve yaş beyanı yalnızca uygulama arayüzünden, kullanıcı tarafından değiştirilebilir"
SAFE_BUDGET_USD = 2.0
SAFE_BUDGET_MIN = 60.0
# karar 13: günlük toplam tavan (bugünkü tüm koşular; dolar API anahtarlı beyinlerden, jeton her beyinden)
SAFE_DAILY_USD = 2.0
SAFE_DAILY_TOKENS = 2_000_000.0
SHELL_TOOL = "Bash"  # Claude Code kabuk aracı: tools.deny → --disallowedTools (Codex/Hermes araç başına uygulamaz)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _min_cap(cur: Any, cap: float) -> float:
    try:
        v = float(cur)
    except (TypeError, ValueError):
        return cap
    return min(v, cap) if v > 0 else cap


def _safe_budget(cur: Any) -> dict[str, Any]:
    b = dict(cur) if isinstance(cur, dict) else {}
    on = b.get("on_exceeded")
    return {"tokens": b.get("tokens"), "cost_usd": _min_cap(b.get("cost_usd"), SAFE_BUDGET_USD),
            "minutes": _min_cap(b.get("minutes"), SAFE_BUDGET_MIN), "on_exceeded": "stop" if on == "stop" else "ask"}


def _safe_daily(cur: Any) -> dict[str, Any]:
    b = dict(cur) if isinstance(cur, dict) else {}
    return {"cost_usd": _min_cap(b.get("cost_usd"), SAFE_DAILY_USD), "tokens": _min_cap(b.get("tokens"), SAFE_DAILY_TOKENS)}


def _with_shell_denied(cur: Any) -> list[str]:
    items = [str(x) for x in cur] if isinstance(cur, list) else []
    return items if SHELL_TOOL in items else [*items, SHELL_TOOL]


def run_cap(settings: Any) -> dict[str, Any] | None:
    """güvenli mod açıkken koşu bütçesi tavanı (`limits.default_budget` ön ayar değeri: en çok
    $2 / 60 dk). Kapalıysa None. Akış YAML'ı, gövde bütçesi ya da başka bir yol bu tavanı aşamaz; yalnız düşürebilir."""
    try:
        raw = settings.get("safe_mode", None) if settings is not None else None
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(raw, dict) or not raw.get("enabled"):
        return None
    try:
        cur = settings.get("limits.default_budget", None)
    except Exception:  # noqa: BLE001
        cur = None
    return _safe_budget(cur)


@dataclass(frozen=True)
class Item:
    id: str
    key: str                              # nokta ayrımlı ayar yolu (config.DEFAULTS içinde tanımlı)
    group: str                            # models | agents | approvals | delivery | privacy | budget
    safe: Callable[[Any], Any]            # mevcut değer → güvenli değer

    def target(self, current: Any) -> Any:
        return self.safe(copy.deepcopy(current))


def _const(value: Any) -> Callable[[Any], Any]:
    return lambda _cur: value


# Sıra = arayüzdeki sıra. Etiketler arayüz kataloğunda (frontend/src/locales/safety.ts, madde kimliğiyle).
PRESET: tuple[Item, ...] = (
    Item("models_local_only", "models.policy.mode", "models", _const("local_only")),
    Item("models_consent", "models.policy.require_consent_remote", "models", _const(True)),
    Item("agents_read_only", "limits.new_agents_read_only", "agents", _const(True)),
    Item("no_shell", "tools.deny", "agents", _with_shell_denied),
    Item("approve_every_tool", "tools.require_approval_all", "approvals", _const(True)),
    # her ajan adımı model çağrısından önce onay ister (`approval: before`; gizli sistem koşuları hariç)
    Item("approve_every_step", "runs.approve_every_step", "approvals", _const(True)),
    Item("no_hiring", "goals.allow_hiring", "approvals", _const(False)),
    Item("schedule_pause", "schedule.unattended_approvals", "approvals", _const("pause")),
    Item("mcp_no_decisions", "clients.mcp.allow_decisions", "approvals", _const(False)),
    Item("quality_on", "quality.enabled", "delivery", _const(True)),
    Item("external_gate_block", "quality.gate_external", "delivery", _const("block")),
    Item("transcripts_claude", "external.claude_code.transcripts_enabled", "privacy", _const(False)),
    Item("transcripts_codex", "external.codex.transcripts_enabled", "privacy", _const(False)),
    Item("prompts_claude", "external.claude_code.store_prompts", "privacy", _const(False)),
    Item("prompts_codex", "external.codex.store_prompts", "privacy", _const(False)),
    Item("otlp_no_prompts", "observability.send_prompts", "privacy", _const(False)),
    Item("injection_block", "guard.injection", "privacy", _const("block")),
    Item("run_budget", "limits.default_budget", "budget", _safe_budget),
    Item("daily_budget", "limits.daily_budget", "budget", _safe_daily),  # karar 13: koşu tavanı korunur, gün de sınırlı
)
BY_ID = {i.id: i for i in PRESET}
# Ayar değiştirmeyen, zaten her zaman geçerli olan korumalar (önizlemede dürüstçe "zaten böyle" diye gösterilir)
# $ tavanı API anahtarlı / ücretli API beyinleri içindir; abonelik koşuları jeton ve dakikayla sınırlanır.
# "her araç onaylı" açıkken e-posta / toplantı tetikleyicileri MCP aracı çağırmaz (gözetimsiz onay yok).
NOTES = ("delivery_always_asks", "tool_approval_scope", "codex_hermes_not_enforced", "budget_subscription",
         "triggers_paused_by_approvals", "daily_cap_scope", "not_a_lock")


def _patch(key: str, value: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    cur = out
    parts = key.split(".")
    for p in parts[:-1]:
        cur[p] = {}
        cur = cur[p]
    cur[parts[-1]] = value
    return out


def _merge(dst: dict[str, Any], src: dict[str, Any]) -> None:
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            _merge(dst[k], v)
        else:
            dst[k] = v


class SafeMode:
    def __init__(self, studio: "Studio"):
        self.studio = studio

    @property
    def settings(self) -> Any:
        return self.studio.settings

    def _state(self) -> dict[str, Any]:
        raw = self.settings.get("safe_mode", None)
        return raw if isinstance(raw, dict) else {}

    def age(self) -> dict[str, Any] | None:
        raw = self.settings.get("trust.age_ok", None)
        if not isinstance(raw, dict) or not isinstance(raw.get("adult"), bool):
            return None
        return {"adult": raw["adult"], "at": raw.get("at")}

    def status(self) -> dict[str, Any]:
        st = self._state()
        applied = st.get("applied") if isinstance(st.get("applied"), dict) else {}
        items = []
        for it in PRESET:
            cur = self.settings.get(it.key, None)
            safe = it.target(cur)
            items.append({"id": it.id, "key": it.key, "group": it.group, "current": cur, "safe": safe,
                          "changed": cur != safe, "kind": "bool" if isinstance(safe, bool) else "value",
                          "applied": it.id in applied})
        return {"enabled": bool(st.get("enabled")), "since": st.get("since"), "source": st.get("source"),
                "items": items, "pending": sum(1 for i in items if i["changed"]), "notes": list(NOTES),
                "age": self.age()}

    def _publish(self, enabled: bool) -> None:
        try:
            self.studio.bus.publish("safe_mode.changed", enabled=enabled)
        except Exception:  # noqa: BLE001 - olay yayını yalnız kolaylık
            pass

    def enable(self, source: str = "user") -> dict[str, Any]:
        st = self._state()
        if st.get("enabled"):
            return {**self.status(), "changed": []}
        patch: dict[str, Any] = {}
        previous: dict[str, Any] = {}
        applied: dict[str, Any] = {}
        for it in PRESET:
            cur = self.settings.get(it.key, None)
            safe = it.target(cur)
            if cur == safe:
                continue
            previous[it.id], applied[it.id] = copy.deepcopy(cur), safe
            _merge(patch, _patch(it.key, safe))
        _merge(patch, {"safe_mode": {"enabled": True, "since": _now(), "source": source,
                                     "previous": previous, "applied": applied}})
        self.settings.update(patch)
        self._after_write(patch)
        self._publish(True)
        return {**self.status(), "changed": list(applied)}

    def disable(self) -> dict[str, Any]:
        st = self._state()
        if not st.get("enabled"):
            return {**self.status(), "restored": [], "kept": []}
        previous = st.get("previous") if isinstance(st.get("previous"), dict) else {}
        applied = st.get("applied") if isinstance(st.get("applied"), dict) else {}
        patch: dict[str, Any] = {}
        restored: list[str] = []
        kept: list[str] = []
        for item_id, value in applied.items():
            it = BY_ID.get(item_id)
            if it is None or item_id not in previous:
                continue
            if self.settings.get(it.key, None) == value:  # sonradan elle değişmediyse geri al
                _merge(patch, _patch(it.key, copy.deepcopy(previous[item_id])))
                restored.append(item_id)
            else:
                kept.append(item_id)
        _merge(patch, {"safe_mode": {"enabled": False, "since": None, "source": None, "previous": None,
                                     "applied": None}})
        self.settings.update(patch)
        self._after_write(patch)
        self._publish(False)
        return {**self.status(), "restored": restored, "kept": kept}

    def set_item(self, item_id: str, value: Any) -> dict[str, Any]:
        it = BY_ID.get(item_id)
        if it is None:
            raise HTTPException(404, f"Bilinmeyen güvenli mod maddesi: {item_id}")
        if not isinstance(it.target(None), bool):
            raise HTTPException(400, "Bu madde buradan değil, kendi ayar panelinden değiştirilir")
        if not isinstance(value, bool):
            raise HTTPException(400, "value true ya da false olmalı")
        patch = _patch(it.key, value)
        self.settings.update(patch)
        self._after_write(patch)
        return self.status()

    def record_age(self, adult: Any) -> dict[str, Any]:
        if not isinstance(adult, bool):
            raise HTTPException(400, "adult true ya da false olmalı")
        self.settings.update({"trust": {"age_ok": {"adult": adult, "at": _now()}}})
        if not adult and not self._state().get("enabled"):
            return self.enable(source="age")
        return self.status()

    def _after_write(self, patch: dict[str, Any]) -> None:
        if "tools" in patch:  # araç sayfası ve köprü güncel politikayı görsün
            try:
                servers = [s.get("id") for s in (self.settings.get("tools.mcp_servers", []) or []) if isinstance(s, dict)]
                self.studio.bus.publish("tools.changed", servers=servers)
            except Exception:  # noqa: BLE001
                pass


def get_service(studio: "Studio") -> SafeMode:
    svc = getattr(studio, "_safe_mode", None)
    if svc is None:
        svc = SafeMode(studio)
        studio._safe_mode = svc  # type: ignore[attr-defined]
    return svc


def _user_only(request: Request) -> None:
    from studio.clients.tracker import mcp_client
    from studio.presence import ui_present
    if mcp_client(request) is not None or not ui_present(request):
        raise HTTPException(403, USER_ONLY)


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/safe-mode", tags=["safe-mode"])

    @r.get("")
    def status() -> dict[str, Any]:
        return get_service(studio).status()

    @r.post("/enable")
    async def enable(request: Request) -> dict[str, Any]:
        _user_only(request)
        return get_service(studio).enable()

    @r.post("/disable")
    async def disable(request: Request) -> dict[str, Any]:
        _user_only(request)
        return get_service(studio).disable()

    @r.put("/items/{item_id}")
    async def set_item(item_id: str, request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        _user_only(request)
        return get_service(studio).set_item(item_id, data.get("value"))

    @r.post("/age")
    async def age(request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        _user_only(request)
        return get_service(studio).record_age(data.get("adult"))

    return r
