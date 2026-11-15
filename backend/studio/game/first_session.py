"""İlk oturum akışı ( "A1" ve kontrol listesi).

Hedef: Free kullanıcı ≤ 10 dakikada ilk kabul edilen teslime ulaşır. Sıra:

    yaş beyanı → bağlantı → İkili ofis → ilk görev/tarif → ajanlar çalışır → teslim parşömeni → kabul → ödül

Ödül (`ilk_mesai` + ilk görev yuvası) ilk kabul edilen teslimle gelir (karar 4): başarım bildirimi ve "ödül" adımı
aynı kullanıcı kararıyla tamamlanır.

Bu modül yeni bir durum makinesi kurmaz: her adım var olan GERÇEK veriden okunur (ayar `trust.age_ok`, kurulu
beyinler, ekip düğümleri, Run, Acceptance, `game_achievements`, `game_quests`). Yazdığı tek şey `game_meta`
anahtarlarıdır (`loop:fs_*`: başlangıç anı ve seçilen ofis). Hiçbir tanıtım, paket sayfası ya da hesap sorusu yoktur.

`first_office` İkili ofis şablonunu kurar ve Free'nin iki koltuğunu bu ofisle doldurur: şablon ajanları yedekte
doğduysa, HİÇ kullanılmamış başlangıç ajanlarıyla ücretsiz değişim yapılır (seats.activate; hiçbir şey silinmez,
yedekteki ajan her an geri alınır). Kullanılmış ya da çalışan bir ajana dokunulmaz.
"""

from __future__ import annotations

import time
from datetime import datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from studio.api import Studio

STEPS = ("age", "connection", "office", "task", "working", "delivered", "accepted", "reward")
IKILI_PREFIX = "ikili-"
TARGET_MIN = 10
SKIP_ORIGINS = ("review:", "eval:", "system:")  # gizli sistem koşuları (denetçi) sayılmaz
M_STARTED = "loop:fs_started"
M_OFFICE = "loop:fs_office"


class FirstSessionError(Exception):
    def __init__(self, status: int, message: str, detail: dict[str, Any] | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.detail = detail   # arayüzün göstereceği yapı (kod, yedeğe gidecekler)


def ts_of(value: Any) -> float | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.timestamp() if dt.tzinfo else dt.astimezone().timestamp()


def _game(studio: "Studio") -> Any:
    from studio.game.api import get_service  # noqa: PLC0415 - döngüsel içe aktarmadan kaçın

    return get_service(studio)


def _first(studio: "Studio", type_name: str, props: dict[str, Any] | None = None,
           skip_origin: bool = False) -> dict[str, Any] | None:
    for n in studio.store.nodes(type_name, limit=200, order="created_at ASC", props=props):
        if skip_origin and str(n["props"].get("origin") or "").startswith(SKIP_ORIGINS):
            continue
        return n
    return None


def _user_accepted(studio: "Studio") -> dict[str, Any] | None:
    """İlk KULLANICI kararıyla kabul edilen teslim. `ilk_mesai` (karar 4) da bu anda açılır; böylece "kabul" ve
    "ödül" adımları aynı olayla tamamlanır. `reviewer_kind` taşımayan eski kayıtlar kullanıcı kararı sayılır."""
    for n in studio.store.nodes("Acceptance", limit=500, order="created_at ASC", props={"status": "accepted"}):
        if n["props"].get("reviewer_kind") != "agent":
            return n
    return None


BRAIN_KINDS = (("ollama", "ollama"), ("codex", "codex"), ("claude", "claude"), ("openai_compat", "openai_compat"),
               ("hermes", "profile"))


def _policy_ok(studio: "Studio", connection: str) -> bool:
    from studio.connections.policy import allowed_brain  # noqa: PLC0415

    try:
        if connection == "openai_compat":
            from studio.connections import endpoints as E  # noqa: PLC0415
            eps = [e for e in E.endpoints_of(studio.settings) if e.get("enabled")]
            return any(allowed_brain(studio.settings, "openai_compat", E.model_ref(e["id"], e.get("model") or ""))
                       for e in eps)
        return allowed_brain(studio.settings, connection)
    except Exception:  # noqa: BLE001 - politika okunamazsa sunucu rotada yine denetler
        return True


def brain_status(studio: "Studio") -> dict[str, Any]:
    """bağlantı adımı yalnız model politikasının İZİN VERDİĞİ hazır bir beyinle tamamlanır (güvenli mod /
    local_only'de bu Ollama'dır). `hint: "local_model"`: bulut beyinleri politikayla kapalı ve izinli beyin yok."""
    try:
        b = studio.agents.available_brains()
    except Exception:  # noqa: BLE001 - yoklama hatası "bağlantı yok" sayılır
        b = {}
    allowed = [k for k, conn in BRAIN_KINDS if b.get(k) and _policy_ok(studio, conn)]
    hint = None
    if not allowed and not (_policy_ok(studio, "codex") or _policy_ok(studio, "claude")):
        hint = "local_model"
    return {"ok": bool(allowed), "allowed": allowed, "hint": hint}


def _brains(studio: "Studio") -> bool:
    return bool(brain_status(studio)["ok"])


def ikili_templates() -> list[dict[str, Any]]:
    from studio.office import catalog  # noqa: PLC0415

    return [catalog.summary(t) for t in catalog.load_templates() if t["id"].startswith(IKILI_PREFIX)]


def _office(studio: "Studio", chosen: str | None) -> tuple[bool, str | None, float | None]:
    """Ofis adımı: İkili ofis kuruldu, başlangıç ekibi bilinçli seçildi ya da herhangi bir şablon ekibi var.
    kullanıcının SON seçtiği İkili şablon (`loop:fs_office`) hâlâ kuruluysa kart onu sürer; ilk İkili ekip
    taraması yalnız geçerli bir seçim kaydı yoksa kullanılır."""
    teams = studio.store.nodes("Team", limit=500, order="created_at ASC")
    if chosen and str(chosen).startswith(IKILI_PREFIX):
        picked = next((n for n in teams if n["props"].get("template") == chosen), None)
        if picked:
            return True, str(chosen), ts_of(picked.get("created_at"))
    ikili = next((n for n in teams if str(n["props"].get("template") or "").startswith(IKILI_PREFIX)), None)
    if ikili:
        return True, str(ikili["props"]["template"]), ts_of(ikili.get("created_at"))
    if chosen:
        return True, chosen, None
    any_tpl = next((n for n in teams if n["props"].get("template")), None)
    if any_tpl:
        return True, str(any_tpl["props"]["template"]), ts_of(any_tpl.get("created_at"))
    return False, None, None


def bucket(minutes: float | None) -> str | None:
    """`first_deliverable_accepted` telemetri kovası; yalnız yerel gösterim, hiçbir yere gönderilmez."""
    if minutes is None:
        return None
    return "le10" if minutes <= 10 else "le60" if minutes <= 60 else "gt60"


def state(studio: "Studio", now: float | None = None) -> dict[str, Any]:
    now = now or time.time()
    g = _game(studio)
    started = g.db.meta(M_STARTED)
    if started is None:
        g.db.set_meta(M_STARTED, now)
        started = now
    started_at = float(started)
    chosen = g.db.meta(M_OFFICE)

    age = studio.settings.get("trust.age_ok", None)
    done: dict[str, tuple[bool, float | None]] = {}
    done["age"] = (isinstance(age, dict) and isinstance(age.get("adult"), bool), ts_of((age or {}).get("at"))
                   if isinstance(age, dict) else None)
    brains = brain_status(studio)
    done["connection"] = (bool(brains["ok"]), None)
    office_ok, office_id, office_at = _office(studio, chosen)
    done["office"] = (office_ok, office_at)
    run = _first(studio, "Run", skip_origin=True)
    done["task"] = (run is not None, ts_of(run["props"].get("started_at")) if run else None)
    worked = _first(studio, "Run", {"status": "done"}, skip_origin=True) \
        or _first(studio, "Run", {"status": "running"}, skip_origin=True)
    done["working"] = (worked is not None, ts_of(worked["props"].get("started_at")) if worked else None)
    acc = _first(studio, "Acceptance")
    done["delivered"] = (acc is not None, ts_of(acc.get("created_at")) if acc else None)
    accepted = _user_accepted(studio)  # Karar 4 / ajan hakemin kabulü bir kullanıcı kararı değildir
    accepted_at = ts_of(accepted["props"].get("decided_at")) if accepted else None
    done["accepted"] = (accepted is not None, accepted_at)

    pending = _first(studio, "Acceptance", {"status": "pending"})  # "Teslimi incele" doğrudan koşuya gider
    quests = int(g.db.scalar("SELECT COUNT(*) FROM game_quests"))
    if accepted is not None and quests == 0:  # ilk kabulden sonra görev panosu dolu açılır (ilk görev yuvası)
        try:
            g.ensure_quests(now, g.gather_facts())
            quests = int(g.db.scalar("SELECT COUNT(*) FROM game_quests"))
        except Exception:  # noqa: BLE001 - görev üretimi ilk oturum durumunu bozmasın
            pass
    ach = g.db.one("SELECT unlocked_at FROM game_achievements WHERE achievement_id='ilk_mesai' LIMIT 1")
    done["reward"] = (accepted is not None and ach is not None and quests > 0,
                      float(ach["unlocked_at"]) if ach else None)

    steps = [{"id": s, "done": bool(done[s][0]), "at": done[s][1]} for s in STEPS]
    current = next((s["id"] for s in steps if not s["done"]), None)
    minutes = round(max(0.0, accepted_at - started_at) / 60, 1) if accepted_at else None
    return {"steps": steps, "current": current, "complete": current is None, "started_at": started_at,
            "office": office_id, "accepted_at": accepted_at,
            "pending_run": pending["props"].get("run_id") if pending else None, "minutes_to_accept": minutes,
            "bucket": bucket(minutes), "target_min": TARGET_MIN,
            "within_target": None if minutes is None else minutes <= TARGET_MIN,
            "rewards": {"achievement": "ilk_mesai" if ach else None, "quest_slots": quests},
            "templates": [t["id"] for t in ikili_templates()],
            "connection_hint": brains["hint"] if not brains["ok"] else None}




def _agent_origin(studio: "Studio", slug: str, starters: list[str]) -> str:
    """Yedeğe alma güvenliği için ajanın kökeni: starter | duo (İkili şablon ekibi) | user (elle ya da başka şablon)."""
    if slug in starters:
        return "starter"
    node = studio.agents.node(slug)
    team = (node or {}).get("props", {}).get("team") if node else None
    if team:
        tn = studio.store.find("Team", str(team))
        if tn and str(tn["props"].get("template") or "").startswith(IKILI_PREFIX):
            return "duo"
    return "user"


def seat_plan(studio: "Studio", slugs: list[str]) -> dict[str, Any]:
    """İkili ofisin rollerini etkin tutmak için hangi ajanların yedeğe gideceği (salt okunur önizleme).
    Kendiliğinden yedeğe alınabilen yalnız HİÇ çalışmamış başlangıç ya da İkili ajanıdır; kullanıcının oluşturduğu ya
    da çalışmış bir ajan için arayüzde açık onay gerekir (`needs_confirm`). Çalışan ajana hiç dokunulmaz."""
    g = _game(studio)
    info = g.seat_info()
    if info is None:  # yönetici/test modu ya da motor yok: kadro değişmez
        return {"bench": [], "needs_confirm": False, "blocked": False, "shortfall": 0}
    st = g.roster_state()
    busy = set(st["busy"])
    used = set(st["last_used"]) | busy
    starters = list(studio.settings.get("onboarding.starter_agents") or [])
    active = [n["props"]["slug"] for n in st["nodes"] if not n["props"].get("benched")]
    need = len([s for s in slugs if s not in active])
    free = max(0, int(info.get("seats") or 0) - len(active))
    shortfall = max(0, need - free)
    cands = [s for s in active if s not in slugs and s not in busy]

    def info_of(s: str) -> dict[str, Any]:
        origin = _agent_origin(studio, s, starters)
        ran = s in used
        from studio.agents import starter_display

        props = (studio.agents.node(s) or {}).get("props", {})
        name = starter_display(props).get("name") or props.get("name") or s  # EN arayüzde dokunulmamış TR başlangıç adı
        return {"slug": s, "name": name, "origin": origin, "used": ran,
                "safe": not ran and origin in ("starter", "duo")}

    ranked = sorted((info_of(s) for s in cands), key=lambda x: (not x["safe"], x["origin"] != "starter", x["slug"]))
    out = ranked[:shortfall]
    return {"bench": out, "needs_confirm": any(not x["safe"] for x in out), "blocked": len(out) < shortfall,
            "shortfall": shortfall}


async def first_office(studio: "Studio", template_id: str, *, confirm: bool = False,
                       dry_run: bool = False) -> dict[str, Any]:
    """İkili ofisi kurar ve iki koltuğu onunla doldurur.

    model politikası bulut beyinlerini kapatmışken izinli (yerel) beyin yoksa kurulmaz (409 `local_model`);
    kurulursa roller yalnız politikanın izin verdiği beyinlerden seçilir (Office.availability).
    `dry_run` yedeğe gidecek ajanları listeler; kullanıcının oluşturduğu ya da çalışmış ajan ancak
    `confirm: true` ile yedeğe alınır. Onaysız bu durumda hiçbir şey kurulmaz (409 `needs_confirm`): ilk koşu
    `seat_inactive` ile karşılaşmaz."""
    from studio.office import catalog  # noqa: PLC0415
    from studio.office.service import Office  # noqa: PLC0415

    g = _game(studio)
    if template_id == "starter":  # başlangıç ekibiyle devam (bilinçli seçim; hiçbir şey kurulmaz)
        if not dry_run:
            g.db.set_meta(M_OFFICE, "starter")
        return {"template": "starter", "active": [], "bench": [], "swapped": [], "message": None}
    if not template_id.startswith(IKILI_PREFIX):
        raise FirstSessionError(400, "İlk oturumda yalnız İkili ofis şablonu kurulabilir")
    try:
        t = catalog.get_template(template_id)
    except KeyError as exc:
        raise FirstSessionError(404, "Şablon yok") from exc
    if brain_status(studio)["hint"] == "local_model":
        raise FirstSessionError(409, "Model politikası (güvenli mod) yalnız yerel modellere izin veriyor: önce Ollama "
                                     "ile yerel bir model kur, sonra İkili ofisi seç.",
                                {"code": "local_model", "bench": []})
    slugs = [k for k in catalog.install_order(t)]
    plan = seat_plan(studio, slugs)
    if dry_run:
        return {"template": template_id, "preview": True, "bench_plan": plan["bench"],
                "needs_confirm": plan["needs_confirm"], "blocked": plan["blocked"]}
    if plan["blocked"]:
        raise FirstSessionError(409, "Koltuk açılamadı: ajanlar şu an çalışıyor. Koşu bitince yeniden dene.",
                                {"code": "busy", "bench": plan["bench"]})
    if plan["needs_confirm"] and not confirm:
        raise FirstSessionError(409, "Bu ofis için listedeki ajanlar yedeğe alınacak; önce onaylaman gerekiyor.",
                                {"code": "needs_confirm", "bench": plan["bench"]})
    office = Office(studio)
    avail = await office.availability()
    result = office.instantiate(template_id, {"strategy": "balanced"}, avail)
    swapped: list[dict[str, str]] = []
    outs = [x["slug"] for x in plan["bench"]]
    if g.seat_info() is not None:  # paket sınırı var (yönetici/test modunda kadro değişmez)
        for slug in slugs:
            node = studio.agents.node(slug)
            if not node or not node["props"].get("benched"):
                continue
            while outs:
                out = outs.pop(0)
                if g.swap_seat(slug, out):
                    swapped.append({"in": slug, "out": out})
                    break
    g.db.set_meta(M_OFFICE, template_id)
    active_now, bench_now = [], []
    for slug in slugs:
        node = studio.agents.node(slug)
        if node:
            (bench_now if node["props"].get("benched") else active_now).append(slug)
    if swapped:
        studio.bus.publish("office.changed", template=template_id)
    return {"template": template_id, "active": active_now, "bench": bench_now, "swapped": swapped,
            "workflow": (result.get("workflow") or {}).get("slug"), "message": result.get("message"),
            "warnings": result.get("warnings") or []}
