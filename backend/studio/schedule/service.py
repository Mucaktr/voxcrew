"""Zamanlama servisi (Ekip S25 —): Schedule düğümleri, doğrulama, istem taraması, sonraki çalışma hesabı.

Zamanlamalar grafta `Schedule` düğümüdür; tetiklediği koşular `TRIGGERED (Schedule→Run)` kenarıyla bağlanır. Webhook
jetonu yalnızca SHA-256 özeti olarak saklanır (`spec.token_hash`); düz jeton oluşturma/yenileme yanıtında bir kez döner.

Saatler yerel duvar saatinde hesaplanır ve ISO-8601 (yerel ofsetli) saklanır. Yalnızca stüdyo çalışırken tetiklenir;
kapalıyken kaçan tetikler açılışta `policy.catch_up` (once | skip) ile ele alınır (bkz. runner.py).
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

from studio._edition import EDITION

from studio.changes import SECRET_KEY_RE
from studio.graph.store import now_iso
from studio.schedule import triggers as T
from studio.schedule.cron import CronError, CronExpr
from studio.workflow.budget import Budget, BudgetError

if TYPE_CHECKING:
    from studio.api import Studio

KINDS = ("cron", "interval", "once", "webhook", "file_watch", "heartbeat", "email_label", "meeting_end")
TIME_KINDS = frozenset({"cron", "interval", "once", "heartbeat"})
TARGET_TYPES = ("task", "workflow", "goal", "recipe")
APPROVALS = ("pause", "deny")          # gözetimsiz onay politikası; "approve" bilerek YOK
CONCURRENCY = ("skip_if_running", "queue")
CATCH_UP = ("once", "skip")
MIN_INTERVAL_S = 60
MAX_INTERVAL_S = 31 * 86400
HEARTBEAT_DEFAULT_S = 900
STUCK_DEFAULT_MIN = 60
MAX_TITLE = 120
MAX_PROMPT = 8000
MAX_INPUT = 4000
MAX_INPUTS = 30
RECENT_RUNS = 20

# ---------------------------------------------------------------- istem taraması
# Sır değerleri (scripts/scan_secrets.py ile aynı aileler) ve `ANAHTAR=değer` atamaları (ad: changes.SECRET_KEY_RE).
SECRET_VALUE_RES = [re.compile(p) for p in (
    r"\bsk-(?:ant-|proj-|svcacct-)?[A-Za-z0-9_\-]{20,}",
    r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b",
    r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})",
    r"\bxox[abprs]-[A-Za-z0-9-]{10,}",
    r"\bAIza[0-9A-Za-z_\-]{35}\b",
    r"\bhf_[A-Za-z0-9]{30,}\b",
    r"\b\d{8,10}:AA[A-Za-z0-9_\-]{33}\b",
    r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}",
    r"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY",
)]
ASSIGN_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_.\-]{1,40})\s*[:=]\s*[\"']?([^\s\"']{12,})")
INJECTION_RES = [re.compile(p, re.I) for p in (
    r"\bignore\s+(?:all\s+|any\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|earlier|system)\s+"
    r"(?:instructions?|prompts?|rules|messages?)",
    r"\bdisregard\s+(?:all\s+|any\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|earlier|system)\s+"
    r"(?:instructions?|prompts?|rules)",
    r"\b(?:reveal|print|show|leak|dump)\s+(?:me\s+)?(?:your\s+|the\s+)?(?:system|hidden)\s+prompt",
    r"\byou\s+are\s+now\s+(?:in\s+)?(?:developer\s+mode|dan\b|jailbroken|unrestricted)",
    r"önceki\s+(?:tüm\s+|bütün\s+)?(?:talimatlar|komutlar|kurallar)[ıi]?\s+(?:yok\s+say|unut|görmezden\s+gel|dikkate\s+alma)",
    r"sistem\s+istem(?:in)?i\s+(?:göster|yazdır|açıkla|sızdır)",
    r"<\|im_start\|>|<\|system\|>|\[/?INST\]|<<SYS>>",
)]


class ScheduleError(ValueError):
    """Doğrulama hatası (HTTP 400)."""


def scan_text(text: str) -> str | None:
    """Metinde sır ya da enjeksiyon kalıbı varsa türünü ("secret" | "injection") döner; değer asla döndürülmez."""
    if not text:
        return None
    if any(r.search(text) for r in SECRET_VALUE_RES):
        return "secret"
    for m in ASSIGN_RE.finditer(text):
        if SECRET_KEY_RE.search(m.group(1)) and not m.group(2).lower().startswith(("http", "{{")):
            return "secret"
    if any(r.search(text) for r in INJECTION_RES):
        return "injection"
    return None


def _check_text(text: str, field: str) -> None:
    found = scan_text(text)
    if found == "secret":
        raise ScheduleError(f"{field}: sır (anahtar/parola) gibi görünen bir değer var; zamanlamaya sır yazma")
    if found == "injection":
        raise ScheduleError(f"{field}: istem enjeksiyonu kalıbı içeriyor (önceki talimatları yok say vb.); kaydedilmedi")


# ---------------------------------------------------------------- zaman
def local_now() -> datetime:
    return datetime.now().astimezone()


def to_local(dt: datetime) -> datetime:
    """Saf (naive) değer yerel saat sayılır; tz'li değer yerel dilime çevrilir."""
    return dt.astimezone()


def parse_iso(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return to_local(datetime.fromisoformat(value.strip().replace("Z", "+00:00")))
    except ValueError:
        return None


def iso(dt: datetime | None) -> str | None:
    return to_local(dt).isoformat(timespec="seconds") if dt else None


def cron_next(expr: str, after: datetime) -> datetime | None:
    """Cron'un `after`dan sonraki ilk çalışması — yerel duvar saatinde hesaplanır, yerel dilime bağlanır."""
    nxt = CronExpr.parse(expr).next_after(to_local(after).replace(tzinfo=None))
    return nxt.astimezone() if nxt else None


def next_run(kind: str, spec: dict[str, Any], now: datetime) -> datetime | None:
    if kind in ("interval", "heartbeat"):
        return to_local(now) + timedelta(seconds=int(spec.get("every_s") or HEARTBEAT_DEFAULT_S))
    if kind == "cron":
        return cron_next(str(spec.get("cron") or ""), now)
    if kind == "once":
        return parse_iso(spec.get("at"))
    if kind in T.MCP_KINDS:  # CG2: MCP tetikleyicisinde "sonraki çalışma" = sonraki yoklama (ilki hemen)
        return to_local(now)
    return None  # webhook / file_watch: olayla tetiklenir


def arm_state(now: datetime) -> dict[str, Any]:
    """CG2: MCP tetikleyicisinin taze durumu — ilk yoklama taban alır; `armed_at` öncesi biten toplantı tetiklemez."""
    return {"armed_at": iso(now), "primed": False, "seen": [], "fired": []}


def hash_token(token: str) -> str:
    return "sha256:" + hashlib.sha256(token.encode("utf-8")).hexdigest()


def _int(value: Any, field: str) -> int:
    if isinstance(value, bool):
        raise ScheduleError(f"{field} bir tam sayı olmalı")
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ScheduleError(f"{field} bir tam sayı olmalı") from None


# ---------------------------------------------------------------- servis
class ScheduleService:
    def __init__(self, studio: "Studio"):
        self.studio = studio
        self.live: dict[str, dict[str, Any]] = {}  # CG2: çalışan zamanlayıcının bellek içi denetim bilgisi (klasör)

    @property
    def store(self):  # noqa: ANN201 - GraphStore
        return self.studio.store

    # ------------------------------------------------------------ okuma
    def node(self, sid: str) -> dict[str, Any]:
        node = self.store.find("Schedule", str(sid or ""))
        if not node:
            raise KeyError(f"Zamanlama yok: {sid}")
        return node

    def nodes(self, *, enabled: bool | None = None) -> list[dict[str, Any]]:
        props = {"enabled": enabled} if enabled is not None else None
        return self.store.nodes("Schedule", limit=1000, order="created_at DESC", props=props)

    def recent_runs(self, node_ids: list[str], limit: int = RECENT_RUNS) -> dict[str, list[dict[str, Any]]]:
        out: dict[str, list[dict[str, Any]]] = {}
        live = self.studio.engine.runs
        for nid, items in self.store.neighbors_many(node_ids, ["TRIGGERED"], "out").items():
            runs = []
            for _e, nb, _d in items:
                p = nb["props"]
                lr = live.get(p.get("id"))
                runs.append({"id": p.get("id"), "title": p.get("title"), "kind": p.get("kind"),
                             "status": lr.status if lr else p.get("status"), "started_at": p.get("started_at"),
                             "finished_at": p.get("finished_at")})
            runs.sort(key=lambda r: r.get("started_at") or "", reverse=True)
            out[nid] = runs[:limit]
        return out

    def public(self, node: dict[str, Any], runs: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        p = dict(node["props"])
        spec = dict(p.get("spec") or {})
        token_set = bool(spec.pop("token_hash", None))  # trigger_state (görülen kimlikler) dışarı verilmez
        out = {"id": p["id"], "title": p.get("title") or p["id"], "kind": p.get("kind"), "spec": spec,
               "target": p.get("target") or None, "policy": p.get("policy") or {}, "enabled": bool(p.get("enabled")),
               "created_at": p.get("created_at"), "created_by": p.get("created_by"),
               "last_run_at": p.get("last_run_at"), "next_run_at": p.get("next_run_at"),
               "last_status": p.get("last_status"), "recent_runs": runs or []}
        if p.get("kind") in T.EVENT_KINDS - {"webhook"}:  # CG2: son tetik, son/sonraki denetim, son hata
            live = self.live.get(p["id"]) or {}
            nxt = p.get("next_run_at") if p.get("kind") in T.MCP_KINDS else live.get("next_check_at")
            out.update(last_fired_at=p.get("last_fired_at"),
                       last_check_at=live.get("last_check_at") or p.get("last_check_at"),
                       next_check_at=nxt if p.get("enabled") else None, last_error=p.get("last_error"),
                       waiting=int(live.get("waiting") or 0))  # sonraki denetimi bekleyen olaylar
            missed = (p.get("trigger_state") or {}).get("missed_offline")  # wave 3: "kapalıyken kaçırıldı: N"
            out["missed_offline"] = ({k: missed.get(k) for k in ("count", "policy", "at")}
                                     if isinstance(missed, dict) and missed.get("count") else None)
        if p.get("kind") == "webhook":
            out["token_set"] = token_set
            out["trigger_url"] = f"/api/triggers/{p['id']}"
        return out

    def list(self, runs_per: int = 5) -> list[dict[str, Any]]:
        nodes = self.nodes()
        recent = self.recent_runs([n["id"] for n in nodes], runs_per)
        return [self.public(n, recent.get(n["id"])) for n in nodes]

    def get(self, sid: str) -> dict[str, Any]:
        node = self.node(sid)
        return self.public(node, self.recent_runs([node["id"]]).get(node["id"]))

    # ------------------------------------------------------------ doğrulama
    def _defaults(self) -> dict[str, str]:
        s = self.studio.settings
        approvals = str(s.get("schedule.unattended_approvals", "pause") or "pause")
        catch_up = str(s.get("schedule.catch_up", "once") or "once")
        return {"approvals": approvals if approvals in APPROVALS else "pause",
                "catch_up": catch_up if catch_up in CATCH_UP else "once"}

    def _spec(self, kind: str, raw: Any, now: datetime, old: dict[str, Any] | None) -> dict[str, Any]:
        if raw is not None and not isinstance(raw, dict):
            raise ScheduleError("spec bir nesne olmalı")
        raw = raw or {}
        if kind == "cron":
            expr = " ".join(str(raw.get("cron") or "").split())
            try:
                CronExpr.parse(expr)
            except CronError as exc:
                raise ScheduleError(str(exc)) from None
            return {"cron": expr}
        if kind in ("interval", "heartbeat"):
            every = _int(raw.get("every_s", HEARTBEAT_DEFAULT_S if kind == "heartbeat" else None), "every_s")
            if every < MIN_INTERVAL_S or every > MAX_INTERVAL_S:
                raise ScheduleError(f"Aralık {MIN_INTERVAL_S} saniye ile 31 gün arasında olmalı")
            out: dict[str, Any] = {"every_s": every}
            if kind == "heartbeat":
                stuck = _int(raw.get("stuck_min", STUCK_DEFAULT_MIN), "stuck_min")
                if stuck < 1 or stuck > 7 * 24 * 60:
                    raise ScheduleError("Takılı koşu eşiği 1 dakika ile 7 gün arasında olmalı")
                out["stuck_min"] = stuck
            return out
        if kind == "once":
            at = parse_iso(raw.get("at"))
            if at is None:
                raise ScheduleError("Tek seferlik zamanlama için geçerli bir tarih-saat (at) gerekli")
            if at <= to_local(now) and parse_iso((old or {}).get("at")) != at:  # düzenlemede aynı (geçmiş) saat kalabilir
                raise ScheduleError("Tek seferlik zamanlamanın saati gelecekte olmalı")
            return {"at": iso(at)}
        if kind == "webhook":
            return {"token_hash": (old or {}).get("token_hash")} if (old or {}).get("token_hash") else {}
        if kind == "file_watch":
            try:  # CG2: göreli → çalışma klasörü içi; mutlak → kullanıcının klasörü (korunan kökler hariç)
                path, _target = T.resolve_watch_folder(raw.get("path"), self.studio)
            except T.TriggerError as exc:
                raise ScheduleError(str(exc)) from None
            pattern = str(raw.get("glob") or "*").strip() or "*"
            if ".." in Path(pattern).parts or Path(pattern).is_absolute() or len(pattern) > 200:
                raise ScheduleError("Dosya deseni (glob) klasörün dışına çıkamaz")
            out_fw: dict[str, Any] = {"path": path, "glob": pattern}
            if raw.get("debounce_s") not in (None, ""):
                deb = _int(raw.get("debounce_s"), "debounce_s")
                if deb < 0 or deb > T.MAX_DEBOUNCE_S:
                    raise ScheduleError(f"Bekleme (debounce) 0 ile {T.MAX_DEBOUNCE_S} saniye arasında olmalı")
                out_fw["debounce_s"] = deb
            return out_fw
        if kind in T.MCP_KINDS:
            return self._mcp_spec(kind, raw)
        raise ScheduleError(f"Bilinmeyen zamanlama türü: {kind}")

    def _mcp_spec(self, kind: str, raw: dict[str, Any]) -> dict[str, Any]:
        """CG2: e-posta etiketi / toplantı bitişi — kullanıcının etkin MCP sunucusu + yoklama aralığı."""
        server = str(raw.get("server") or "").strip()
        try:
            from studio.tools.api import bridge_for  # noqa: PLC0415
            ok = bool(server) and bridge_for(self.studio).server(server) is not None
        except Exception:  # noqa: BLE001
            ok = False
        if not ok:
            raise ScheduleError("MCP sunucusu yok ya da kapalı: Bağlantılar sayfasında posta/takvim sunucunu ekle")
        every = _int(raw.get("every_s", T.MCP_DEFAULT_EVERY_S), "every_s")
        if every < T.MCP_MIN_EVERY_S or every > T.MCP_MAX_EVERY_S:
            raise ScheduleError(f"Yoklama aralığı {T.MCP_MIN_EVERY_S} saniye ile 1 gün arasında olmalı")
        out: dict[str, Any] = {"server": server, "every_s": every}
        if kind == "email_label":
            label = " ".join(str(raw.get("label") or "").split())
            if not label or len(label) > 120:
                raise ScheduleError("E-posta etiketi gerekli (en fazla 120 karakter)")
            _check_text(label, "spec.label")
            out["label"] = label
            return out
        match = str(raw.get("match") or "keyword")
        if match not in ("keyword", "event"):
            raise ScheduleError("Toplantı eşleşmesi keyword ya da event olmalı")
        out["match"] = match
        if match == "keyword":
            kw = " ".join(str(raw.get("keyword") or "").split())
            if len(kw) < 2 or len(kw) > 80:
                raise ScheduleError("Anahtar kelime 2–80 karakter olmalı")
            _check_text(kw, "spec.keyword")
            out["keyword"] = kw
        else:
            eid = str(raw.get("event_id") or "").strip()
            if not eid or len(eid) > 300 or re.search(r"[\x00-\x1f]", eid):
                raise ScheduleError("Seçilen toplantının kimliği (event_id) gerekli")
            out["event_id"] = eid
            title = " ".join(str(raw.get("event_title") or "").split())[:200]
            if title:
                _check_text(title, "spec.event_title")
                out["event_title"] = title
        cal = " ".join(str(raw.get("calendar") or "").split())[:200]
        if cal:
            out["calendar"] = cal
        return out

    def _target(self, raw: Any, kind: str) -> dict[str, Any] | None:
        if raw in (None, {}) and kind == "heartbeat":
            return None  # heartbeat hedefsiz olabilir: yalnızca bildirim
        if not isinstance(raw, dict):
            raise ScheduleError("Hedef (target) gerekli: task, workflow, recipe ya da goal")
        ttype = str(raw.get("type") or "")
        if ttype not in TARGET_TYPES:
            raise ScheduleError("Hedef türü task, workflow, recipe ya da goal olmalı")
        if ttype == "task":
            agent = str(raw.get("agent") or "").strip()
            prompt = str(raw.get("prompt") or "").strip()
            if not self.studio.agents.node(agent):
                raise ScheduleError(f"Ajan yok: {agent}")
            if not prompt:
                raise ScheduleError("Görev metni boş")
            if len(prompt) > MAX_PROMPT:
                raise ScheduleError(f"Görev metni en fazla {MAX_PROMPT} karakter olabilir")
            _check_text(prompt, "target.prompt")
            return {"type": "task", "agent": agent, "prompt": prompt, **self._project(raw)}
        if ttype == "workflow":
            slug = str(raw.get("workflow") or "").strip()
            try:
                spec = self.studio.library.get(slug)
            except (KeyError, ValueError, OSError):
                raise ScheduleError(f"İş akışı yok: {slug}") from None
            inputs_raw = raw.get("inputs") or {}
            if not isinstance(inputs_raw, dict) or len(inputs_raw) > MAX_INPUTS:
                raise ScheduleError("Girdiler (inputs) bir nesne olmalı")
            inputs: dict[str, str] = {}
            for k, v in inputs_raw.items():
                text = "" if v is None else str(v)
                if len(text) > MAX_INPUT:
                    raise ScheduleError(f"Girdi en fazla {MAX_INPUT} karakter olabilir: {k}")
                _check_text(text, f"target.inputs.{k}")
                inputs[str(k)[:60]] = text
            trig = self._trigger_input(raw, kind, [i.name for i in spec.inputs])
            if kind != "webhook":
                missing = [i.label or i.name for i in spec.inputs
                           if i.required and i.name != trig and not str(inputs.get(i.name, i.default) or "").strip()]
                if missing:
                    raise ScheduleError("Eksik girdi: " + ", ".join(missing))
            return {"type": "workflow", "workflow": spec.slug, "inputs": inputs,
                    **({"trigger_input": trig} if trig else {}), **self._project(raw)}
        if ttype == "recipe":
            return self._recipe_target(raw, kind)
        goal_id = str(raw.get("goal_id") or "").strip()
        if not goal_id or not self.store.find("Goal", goal_id):
            raise ScheduleError(f"Hedef yok: {goal_id}")
        return {"type": "goal", "goal_id": goal_id}

    @staticmethod
    def _trigger_input(raw: dict[str, Any], kind: str, names: list[str], hint: str | None = None) -> str | None:
        """CG2: tetikleyici verisini (dosya yolu, ileti, toplantı) alacak girdi; yalnızca olay türlerinde. Verilmezse
        tarifin önerisi ya da bilinen bir ad (file_path, not, postalar…) seçilir."""
        if kind not in T.EVENT_KINDS:
            return None
        val = str(raw.get("trigger_input") or "").strip()
        if not val:
            if kind == "webhook":
                return None
            return hint if hint in names else T.guess_trigger_input(names)
        if val not in names:
            raise ScheduleError(f"Tetikleyici girdisi tanımlı değil: {val}")
        return val

    def _recipe_target(self, raw: dict[str, Any], kind: str) -> dict[str, Any]:
        """CG2: tarif hedefi (uçtan uca hazır iş). Ekip ve girdiler başlatırken tarif servisinde yeniden doğrulanır;
        zamanlanmış koşu ajan işe ALMAZ (koltuk kullanıcı kararı)."""
        if EDITION != "full":
            raise ScheduleError("Tarif hedefi bu sürümde yok")
        from studio.full.recipes import localized_inputs  # noqa: PLC0415
        from studio.full.recipes import recipe_service_for as service_for  # noqa: PLC0415
        rid = str(raw.get("recipe") or "").strip()
        try:
            recipe = service_for(self.studio).get(rid)
        except KeyError:
            raise ScheduleError(f"Tarif yok: {rid}") from None
        spec_inputs = localized_inputs(recipe, "tr")
        names = [i["name"] for i in spec_inputs]
        inputs_raw = raw.get("inputs") or {}
        if not isinstance(inputs_raw, dict) or len(inputs_raw) > MAX_INPUTS:
            raise ScheduleError("Girdiler (inputs) bir nesne olmalı")
        inputs: dict[str, str] = {}
        for k, v in inputs_raw.items():
            if k not in names:
                continue
            text = "" if v is None else str(v)
            if len(text) > MAX_INPUT:
                raise ScheduleError(f"Girdi en fazla {MAX_INPUT} karakter olabilir: {k}")
            _check_text(text, f"target.inputs.{k}")
            inputs[str(k)] = text
        trig = self._trigger_input(raw, kind, names, (recipe.get("schedule") or {}).get("trigger_input"))
        if kind != "webhook":
            missing = [i["label"] or i["name"] for i in spec_inputs
                       if i["required"] and i["name"] != trig and not str(inputs.get(i["name"]) or i["default"]).strip()]
            if missing:
                raise ScheduleError("Eksik girdi: " + ", ".join(missing))
        return {"type": "recipe", "recipe": rid, "inputs": inputs,
                **({"trigger_input": trig} if trig else {}), **self._project(raw)}

    @staticmethod
    def _project(raw: dict[str, Any]) -> dict[str, Any]:
        """görev/akış hedefinin bellek ad alanı (verilmezse alan yazılmaz → koşu `global`)."""
        from studio.graph import namespace as nsm
        try:
            ns = nsm.maybe(raw.get("project"))
            nsm.reject_reserved(ns)  # matrisin ayrılmış öneki
        except nsm.NamespaceError as exc:
            raise ScheduleError(str(exc)) from None
        return {"project": ns} if ns else {}

    def _policy(self, raw: Any, old: dict[str, Any] | None) -> dict[str, Any]:
        if raw is not None and not isinstance(raw, dict):
            raise ScheduleError("policy bir nesne olmalı")
        merged = {**self._defaults(), "concurrency": "skip_if_running", **(old or {}), **(raw or {})}
        approvals = str(merged.get("approvals") or "pause")
        if approvals == "ask":  # eski ad: gözetimsizde "sor" = duraklat
            approvals = "pause"
        if approvals not in APPROVALS:
            raise ScheduleError("Onay politikası yalnızca pause (duraklat) ya da deny (reddet) olabilir; "
                                "gözetimsiz koşu onayları kendiliğinden onaylayamaz")
        concurrency = str(merged.get("concurrency") or "skip_if_running")
        if concurrency not in CONCURRENCY:
            raise ScheduleError("Eşzamanlılık skip_if_running ya da queue olmalı")
        catch_up = str(merged.get("catch_up") or "once")
        if catch_up not in CATCH_UP:
            raise ScheduleError("Kaçan tetik politikası once ya da skip olmalı")
        out: dict[str, Any] = {"approvals": approvals, "concurrency": concurrency, "catch_up": catch_up}
        budget_raw = merged.get("budget")
        if budget_raw not in (None, {}):
            try:
                budget = Budget.parse(budget_raw)
            except BudgetError as exc:
                raise ScheduleError(str(exc)) from None
            if not budget.empty():
                out["budget"] = {k: v for k, v in budget.to_dict().items() if v is not None}
        return out

    def _title(self, raw: Any, kind: str, target: dict[str, Any] | None) -> str:
        title = " ".join(str(raw or "").split())
        if not title:
            what = ""
            if target:
                what = (target.get("workflow") or target.get("recipe") or target.get("goal_id")
                        or target.get("agent") or "")
            title = f"{kind}{' · ' + what if what else ''}"
        if len(title) > MAX_TITLE:
            raise ScheduleError(f"Başlık en fazla {MAX_TITLE} karakter olabilir")
        _check_text(title, "title")
        return title

    # ------------------------------------------------------------ yazma
    def create(self, data: dict[str, Any], *, created_by: str = "ui",
               now: datetime | None = None) -> tuple[dict[str, Any], str | None]:
        if not isinstance(data, dict):
            raise ScheduleError("Gövde bir nesne olmalı")
        now = to_local(now or local_now())
        kind = str(data.get("kind") or "")
        if kind not in KINDS:
            raise ScheduleError(f"Bilinmeyen zamanlama türü: {kind}")
        spec = self._spec(kind, data.get("spec"), now, None)
        target = self._target(data.get("target"), kind)
        policy = self._policy(data.get("policy"), None)
        token = None
        if kind == "webhook":
            token = secrets.token_urlsafe(32)
            spec["token_hash"] = hash_token(token)
        enabled = data.get("enabled", True) is not False
        if enabled:
            self._plan_gate()  # E6
        props: dict[str, Any] = {
            "id": f"sch_{uuid.uuid4().hex[:10]}", "title": self._title(data.get("title"), kind, target),
            "kind": kind, "spec": spec, "target": target, "policy": policy, "enabled": enabled,
            "created_at": now_iso(), "created_by": str(created_by or "ui")[:40],
            "next_run_at": iso(next_run(kind, spec, now)) if enabled else None}
        if kind in T.MCP_KINDS:
            props["trigger_state"] = arm_state(now)
        node = self.store.upsert_node("Schedule", props)
        return self.public(node), token

    def update(self, sid: str, data: dict[str, Any], *,
               now: datetime | None = None) -> tuple[dict[str, Any], str | None]:
        if not isinstance(data, dict):
            raise ScheduleError("Gövde bir nesne olmalı")
        node = self.node(sid)
        p = node["props"]
        now = to_local(now or local_now())
        kind = str(data.get("kind") or p.get("kind"))
        if kind not in KINDS:
            raise ScheduleError(f"Bilinmeyen zamanlama türü: {kind}")
        old_spec = dict(p.get("spec") or {}) if kind == p.get("kind") else {}
        spec_changed = "spec" in data or kind != p.get("kind")
        spec = self._spec(kind, data.get("spec") if "spec" in data else old_spec, now, old_spec) \
            if spec_changed else old_spec
        target = self._target(data["target"], kind) if "target" in data else \
            (self._target(p.get("target"), kind) if kind != p.get("kind") else p.get("target"))
        policy = self._policy(data.get("policy"), p.get("policy")) if "policy" in data else p.get("policy")
        token = None
        if kind == "webhook" and not spec.get("token_hash"):
            token = secrets.token_urlsafe(32)
            spec["token_hash"] = hash_token(token)
        enabled = bool(p.get("enabled")) if "enabled" not in data else data["enabled"] is not False
        if enabled and not p.get("enabled"):
            self._plan_gate()  # E6: duraklatılmış işi yeniden açmak da sayılır
        patch: dict[str, Any] = {"kind": kind, "spec": spec, "target": target, "policy": policy, "enabled": enabled}
        if "title" in data:
            patch["title"] = self._title(data.get("title"), kind, target)
        if not enabled:
            patch["next_run_at"] = None
        elif spec_changed or not p.get("enabled") or not p.get("next_run_at"):
            patch["next_run_at"] = iso(next_run(kind, spec, now))
        if kind in T.MCP_KINDS and enabled and (spec_changed or not p.get("enabled")):
            patch.update(trigger_state=arm_state(now), last_error=None)  # CG2: yeniden silahla (taban yeniden)
        self.store.patch_node(node["id"], patch)
        return self.get(sid), token

    def _plan_gate(self) -> None:
        """ E6: etkin zamanlama sayısı paket sınırındaysa 409 (fazlası duraklar, silinmez)."""
        from studio.entitlements import gate  # noqa: PLC0415

        if (ent := gate(self.studio)) is not None:
            ent.require("schedules")

    def delete(self, sid: str) -> None:
        node = self.node(sid)
        self.store.unlink("TRIGGERED", node["id"])
        self.store.delete_node(node["id"])

    def regenerate_token(self, sid: str) -> tuple[dict[str, Any], str]:
        node = self.node(sid)
        if node["props"].get("kind") != "webhook":
            raise ScheduleError("Erişim anahtarı yalnızca webhook zamanlamalarında vardır")
        token = secrets.token_urlsafe(32)
        spec = {**(node["props"].get("spec") or {}), "token_hash": hash_token(token)}
        self.store.patch_node(node["id"], {"spec": spec})
        return self.get(sid), token

    def check_token(self, node: dict[str, Any], token: str | None) -> bool:
        stored = str((node["props"].get("spec") or {}).get("token_hash") or "")
        given = hash_token(token or "") if token else "sha256:"
        return bool(stored) and hmac.compare_digest(stored.encode("utf-8"), given.encode("utf-8"))

    def mark(self, sid: str, patch: dict[str, Any]) -> dict[str, Any] | None:
        node = self.store.find("Schedule", sid)
        if not node:
            return None
        return self.store.patch_node(node["id"], patch)
