"""İz (trace) toplama — Ekip S26.

Salt okunur: koşu ayrıntısı (`Engine.get_run`: graf + kalıcı `run_events`) ve bu modülün kendi küçük defterinden
(`trace.sqlite`) span ağacı kurar. Motor dosyasına dokunulmaz; motorun kalıcı yazmadığı iki bilgi olay veri yolundan
dinlenip burada saklanır:

- `step.prompt` — istem hattı raporu (booster/skill aşamaları, kazanılan karakter → tahmini token);
- `trace.first_output` — denemenin ilk çıktısı (ilk `step.delta`/`step.thought`/`step.tool`): başlangıçtan ilk çıktıya
  geçen süre.

Motorun kalıcı `step.dispatched` olayı (kaynak kilidi alındı) denemeyi ikiye böler (O-10): `queue_wait_ms` (başlangıç →
gönderim: kaynak kuyruğu + istem hazırlığı) ve `provider_ms` (gönderim → bitiş; deneme içindeki araç onayı beklemesi
hariç), `provider_first_output_ms` (gönderim → ilk çıktı). Her aralık bir kez sayılır (O-11): onay kartı beklemesi
`ready_wait_ms`e girmez, yeniden deneme geri çekilmesi `backoff_ms` olarak ayrı etiketlenir. İçerik alanları ve hata
metinleri `studio.changes.redact_text` ile maskelenir (O-13); `content=False` iken hata metni hiç tutulmaz.

Span şekli: `{id, parent, name, kind, step, attempt, start_ms, end_ms, duration_ms, status, open, attrs, events}`.
`kind` Langfuse türleriyle hizalı: span · agent · tool · retriever · guardrail (onay) · generation. Zamanlar koşu
başlangıcına göre milisaniyedir; mutlak zaman `t0` (epoch sn) + ofset. Aynı adımın denemeleri kardeş span'lerdir;
devretme alt adımları üst adımın denemesi altında iç içe durur; onay bekleme süresi ayrı span'dir.
"""

from __future__ import annotations

import hashlib
import json
import math
import sqlite3
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from studio.tokens import CHARS_PER_TOKEN
from studio.changes import redact_text

BOOST_PREFIX = "boost:"
OUTPUT_EVENTS = ("step.delta", "step.thought", "step.tool", "step.tool_approval")
RUN_MARKERS = ("run.paused", "run.resumed", "run.forked", "budget.warning", "budget.exceeded", "budget.overrun", "budget.updated",
               "connection.degraded", "handoff",
               # Faz 6 dalga 3 (S24): orkestratör plan / yeniden plan turları ve insan kapısı
               "orchestrate.plan", "orchestrate.replan", "orchestrate.gate")
MAX_TEXT = 2000  # span özniteliklerinde metin kırpma


def _epoch(iso: Any) -> float | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.timestamp()


def _ms(seconds: float) -> int:
    return int(round(seconds * 1000))


# `redact_text` desenlerinin (Bearer, sk-/pk-/rk-, *key/token/secret/password= atamaları) olmazsa olmaz parçaları:
# hiçbiri yoksa düzenli ifadeler hiç çalıştırılmaz (10.000 olaylı izde maliyet).
_SECRET_HINTS = ("bearer", "sk-", "pk-", "rk-", "key", "token", "secret", "passw")


def scrub(text: str) -> str:
    """Sır maskeleme (O-13) — ucuz alt dize ön denetimiyle `studio.changes.redact_text`."""
    low = text.lower()
    if not any(h in low for h in _SECRET_HINTS):
        from studio.tools.mcp_client import mask_secrets  # noqa: PLC0415 - MCP'ye aktarılan ortam değerleri (karar 1)
        return mask_secrets(text)
    return redact_text(text)


def _clip(v: Any, n: int = MAX_TEXT) -> Any:
    """Metni sır maskeleyip kırpar (O-13: iz yolundaki her içerik / hata alanı bundan geçer)."""
    if isinstance(v, str):
        v = scrub(v)
        if len(v) > n:
            return v[:n] + "…"
    return v


def est_tok(chars: int) -> int:
    """Booster defteriyle aynı kaba tahmin (TR oranı); arayüzde "≈" ile gösterilir."""
    return int(math.ceil(chars / CHARS_PER_TOKEN["tr"])) if chars > 0 else 0


def trace_id(run_id: str) -> str:
    """OTLP uyumlu 32 hex iz kimliği (koşu kimliğinden kararlı)."""
    return hashlib.sha256(f"trace:{run_id}".encode()).hexdigest()[:32]


def span_hex(run_id: str, span: str) -> str:
    """OTLP uyumlu 16 hex span kimliği (kararlı)."""
    return hashlib.sha256(f"{run_id}/{span}".encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------- defter (trace.sqlite)
_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
  run_id TEXT NOT NULL, seq INTEGER NOT NULL, ts REAL NOT NULL, type TEXT NOT NULL, step TEXT,
  attempt INTEGER, data TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS events_run ON events(run_id, ts);
CREATE UNIQUE INDEX IF NOT EXISTS events_key ON events(run_id, type, step, attempt, seq);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


class TraceLedger:
    """Motorun kalıcı yazmadığı iz olayları (istem raporu, ilk çıktı). Koşu başına küçük; ayrı dosya."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._conn:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.executescript(_SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def add(self, run_id: str, seq: int, ts: float, type_: str, step: str | None, attempt: int | None,
            data: dict[str, Any]) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR IGNORE INTO events(run_id, seq, ts, type, step, attempt, data) VALUES(?,?,?,?,?,?,?)",
                (run_id, int(seq or 0), float(ts), type_, step, attempt, json.dumps(data, ensure_ascii=False, default=str)))

    def for_run(self, run_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute("SELECT * FROM events WHERE run_id=? ORDER BY ts, seq", (run_id,)).fetchall()
        out = []
        for r in rows:
            try:
                data = json.loads(r["data"])
            except json.JSONDecodeError:
                data = {}
            out.append({**data, "seq": r["seq"], "ts": r["ts"], "type": r["type"], "run_id": run_id,
                        "step": r["step"], "attempt": r["attempt"], "_trace": True})
        return out

    def set_meta(self, key: str, value: Any) -> None:
        with self._lock, self._conn:
            self._conn.execute("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                               (key, json.dumps(value, ensure_ascii=False, default=str)))

    def meta(self, key: str, default: Any = None) -> Any:
        with self._lock:
            row = self._conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        if not row:
            return default
        try:
            return json.loads(row["value"])
        except json.JSONDecodeError:
            return default


class TraceRecorder:
    """Olay veri yolu tüketicisi: `step.prompt` ve denemenin ilk çıktısını deftere yazar. Bellek sınırlı: koşu bitince
    ya da duraklayınca o koşunun anahtarları düşer."""

    def __init__(self, ledger: TraceLedger):
        self.ledger = ledger
        self._attempt: dict[tuple[str, str], int] = {}
        self._first_seen: set[tuple[str, str, int]] = set()

    def handle(self, ev: dict[str, Any]) -> None:
        """Olayı işler ve gerekiyorsa deftere yazar (eşzamanlı; testler ve iş parçacığı içi kullanım)."""
        row = self.observe(ev)
        if row is not None:
            self.ledger.add(*row)

    def observe(self, ev: dict[str, Any]) -> tuple[Any, ...] | None:
        """Bellek içi durumu günceller; deftere yazılacak satırı döndürür (yazımı çağıran yapar — olay döngüsünü
        bloklamamak için `asyncio.to_thread`). Yazılacak bir şey yoksa None."""
        t = ev.get("type")
        run_id = str(ev.get("run_id") or "")
        if not run_id:
            return None
        step = ev.get("step") if isinstance(ev.get("step"), str) else None
        if t == "step.started" and step:
            att = ev.get("attempt")
            key = (run_id, step)
            self._attempt[key] = int(att) if isinstance(att, int) and att > 0 else self._attempt.get(key, 0) + 1
            return None
        if t == "step.prompt" and step:
            att = self._attempt.get((run_id, step))
            return (run_id, int(ev.get("seq") or 0), float(ev.get("ts") or time.time()), "step.prompt", step, att,
                    {"agent": ev.get("agent"), "report": ev.get("report") or [], "chars": ev.get("chars")})
        if t in OUTPUT_EVENTS and step:
            att = self._attempt.get((run_id, step))
            if att is None:
                return None
            mark = (run_id, step, att)
            if mark in self._first_seen:
                return None
            self._first_seen.add(mark)
            return (run_id, int(ev.get("seq") or 0), float(ev.get("ts") or time.time()), "trace.first_output",
                    step, att, {"via": t})
        if t in ("run.finished", "run.paused"):
            self.forget(run_id)
        return None

    def forget(self, run_id: str) -> None:
        for k in [k for k in self._attempt if k[0] == run_id]:
            self._attempt.pop(k, None)
        self._first_seen = {m for m in self._first_seen if m[0] != run_id}


# ---------------------------------------------------------------------------- toplama
def _prompt_attrs(ev: dict[str, Any]) -> dict[str, Any]:
    """`step.prompt` raporu → booster/skill özet öznitelikleri (tahmini token kazancı dahil)."""
    stages: list[dict[str, Any]] = []
    boosters: list[str] = []
    skills: list[str] = []
    saved_chars_total = 0
    for r in ev.get("report") or []:
        if not isinstance(r, dict):
            continue
        name = str(r.get("stage") or "")
        kind = "booster" if name.startswith(BOOST_PREFIX) else "skill" if name == "skills" else "other"
        saved = int(r.get("saved_chars") or 0) if isinstance(r.get("saved_chars"), (int, float)) else 0
        entry: dict[str, Any] = {"stage": name, "kind": kind}
        if kind == "booster":
            boosters.append(name[len(BOOST_PREFIX):])
            entry["saved_chars"] = saved
            entry["saved_tokens_est"] = est_tok(saved)
            if not r.get("error"):
                saved_chars_total += max(0, saved)
        if kind == "skill":
            inj = r.get("injected") if isinstance(r.get("injected"), list) else []
            skills.extend(str(x) for x in inj)
            entry["injected"] = [str(x) for x in inj][:20]
            for k in ("truncated", "omitted", "missing"):
                if isinstance(r.get(k), list) and r[k]:
                    entry[k] = [str(x) for x in r[k]][:20]
            if isinstance(r.get("chars"), (int, float)):
                entry["chars"] = int(r["chars"])
        for k, v in r.items():  # diğer küçük skaler alanlar (ör. model, budget, lang)
            if k in entry or k in ("stage", "saved_chars", "injected", "titles", "lines"):
                continue
            if isinstance(v, (int, float, bool)) or (isinstance(v, str) and len(v) <= 120):
                entry[k] = v
        stages.append(entry)
    return {"chars": int(ev.get("chars") or 0), "stages": stages, "boosters": boosters, "skills": skills,
            "saved_chars": saved_chars_total, "saved_tokens_est": est_tok(saved_chars_total)}


def build_trace(run: dict[str, Any], extra_events: list[dict[str, Any]] | None = None, *, now: float | None = None,
                content: bool = True) -> dict[str, Any]:
    """Koşu ayrıntısı (+ defter olayları) → span ağacı ve özet. `content=False` istem/araç/onay metinlerini çıkarır
    (dışa aktarmada `observability.send_prompts` kapalıyken)."""
    now = time.time() if now is None else now
    run_id = str(run.get("id"))
    steps_meta: dict[str, dict[str, Any]] = {str(s.get("id")): s for s in run.get("steps") or []}
    raw = list(run.get("events") or []) + list(extra_events or [])
    seen: set[tuple[Any, Any, Any, Any]] = set()
    events: list[dict[str, Any]] = []
    for e in raw:
        key = (e.get("type"), e.get("seq"), e.get("ts"), e.get("step") if isinstance(e.get("step"), str) else None)
        if key in seen:
            continue
        seen.add(key)
        events.append(e)
    events.sort(key=lambda e: (float(e.get("ts") or 0), int(e.get("seq") or 0)))

    t0 = next((float(e["ts"]) for e in events if e.get("type") == "run.started"), None)
    if t0 is None:
        t0 = _epoch(run.get("started_at")) or (float(events[0]["ts"]) if events else now)

    spans: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    open_attempt: dict[str, str] = {}
    last_attempt: dict[str, str] = {}
    attempt_n: dict[str, int] = {}
    approval_n: dict[str, int] = {}
    open_approval: dict[str, str] = {}
    open_tools: dict[str, list[str]] = {}
    open_tool_appr: dict[str, str] = {}
    step_end: dict[str, float] = {}
    last_ts: dict[str, float] = {}
    pending_retry: dict[str, dict[str, Any]] = {}
    effects: dict[str, dict[str, Any]] = {}
    markers: list[dict[str, Any]] = []
    first_out: dict[tuple[str, int], float] = {}
    dispatched: dict[str, float] = {}  # span id → kaynak kilidinin alındığı an (ilk `step.dispatched`)
    gates: dict[str, list[tuple[float, float]]] = {}  # adım → onay kartı aralıkları (kendisi ya da alt kartları)
    resume_floor = t0
    run_end: float | None = None
    run_status_final: str | None = None

    run_span = {"id": "run", "parent": None, "name": str(run.get("title") or run_id), "kind": "span", "step": None,
                "attempt": None, "start": t0, "end": None, "status": str(run.get("status") or ""), "open": False,
                "attrs": {"run_id": run_id, "kind": run.get("kind"), "workflow": run.get("workflow"),
                          "origin": run.get("origin"), "forked_from": run.get("forked_from"),
                          "attempts": run.get("attempts") or 0},
                "events": []}
    spans["run"] = run_span
    order.append("run")

    def add(span: dict[str, Any]) -> dict[str, Any]:
        spans[span["id"]] = span
        order.append(span["id"])
        return span

    def new_span(sid: str, parent: str, name: str, kind: str, start: float, *, step: str | None = None,
                 attempt: int | None = None, attrs: dict[str, Any] | None = None) -> dict[str, Any]:
        return add({"id": sid, "parent": parent, "name": name, "kind": kind, "step": step, "attempt": attempt,
                    "start": start, "end": None, "status": "running", "open": True, "attrs": attrs or {}, "events": []})

    def close(span: dict[str, Any] | None, end: float, status: str) -> None:
        if span is None or not span["open"]:
            return
        span["end"], span["status"], span["open"] = max(end, span["start"]), status, False
        if span["id"].startswith("a:") and span.get("step"):
            # onay kartı aralığı: kartın kendi adımına ve üst adımına (belirsiz etki / bütçe / on_fail kartı) yazılır
            owner = span["step"]
            for k in {owner, str(steps_meta.get(owner, {}).get("parent") or owner)}:
                gates.setdefault(k, []).append((span["start"], span["end"]))

    def step_parent(sid: str) -> str:
        p = steps_meta.get(sid, {}).get("parent")
        if p and p in steps_meta:
            return open_attempt.get(p) or last_attempt.get(p) or open_approval.get(p) or "run"
        return "run"

    def attempt_span(sid: str | None) -> dict[str, Any] | None:
        if not sid:
            return None
        sp = open_attempt.get(sid) or last_attempt.get(sid)
        return spans.get(sp) if sp else None

    def close_tools(sid: str, end: float, status: str) -> None:
        for tid in open_tools.pop(sid, []):
            close(spans.get(tid), end, status)

    def close_attempt(sid: str, end: float, status: str) -> None:
        sp = open_attempt.pop(sid, None)
        if sp:
            close_tools(sid, end, status)
            close(spans.get(sp), end, status)

    for e in events:
        t = str(e.get("type") or "")
        ts = float(e.get("ts") or t0)
        sid = e.get("step") if isinstance(e.get("step"), str) else None
        if sid and t not in ("step.retried", "step.started", "budget.updated"):
            last_ts[sid] = ts  # denemenin son "kendi" olayı (kesintide span burada kapanır)
        meta = steps_meta.get(sid or "", {})

        if t == "run.started":
            continue
        if t == "trace.first_output" and sid:
            att = e.get("attempt")
            if isinstance(att, int):
                first_out.setdefault((sid, att), ts)
            continue
        if t == "step.started" and sid:
            if sid in open_attempt:  # önceki deneme kapanmadan yenisi başladı → kesinti
                close_attempt(sid, last_ts.get(sid, ts), "interrupted")
            att = e.get("attempt") if isinstance(e.get("attempt"), int) and e.get("attempt") > 0 else attempt_n.get(sid, 0) + 1
            attempt_n[sid] = max(attempt_n.get(sid, 0), int(att))
            deps = [d for d in meta.get("depends_on") or [] if d in step_end]
            base = max([resume_floor, t0] + [step_end[d] for d in deps])
            prev = spans.get(last_attempt.get(sid, ""))
            prev_end = float(prev["end"]) if prev and prev.get("end") else None
            ready = max(base, prev_end) if prev_end is not None else base
            # O-11: bu denemeden önce biten onay kartları (aynı adım ya da alt kartı) "başlamadan önce bekleme" değildir
            my_gates = [(a, b) for a, b in gates.get(sid, []) if b <= ts]
            if my_gates:
                ready = max(ready, max(b for _a, b in my_gates))
            backoff_ms = None
            if prev is not None and prev_end is not None and prev["attrs"].get("will_retry"):
                # geri çekilme: önceki denemenin bitişi → hazır olma; aradaki onay kartı süresi düşülür
                gated = sum(max(0.0, min(b, ready) - max(a, prev_end)) for a, b in my_gates)
                backoff_ms = _ms(max(0.0, ready - prev_end - gated))
            route = e.get("route") if isinstance(e.get("route"), dict) else (meta.get("route") or {})
            attrs: dict[str, Any] = {
                "agent": e.get("agent") or meta.get("agent"), "type": meta.get("type"), "step_kind": meta.get("kind"),
                "connector": (route or {}).get("connector"), "connection": (route or {}).get("connection"),
                "model": (route or {}).get("model"), "route_label": (route or {}).get("label"),
                "ready_wait_ms": _ms(max(0.0, ts - ready)), "backoff_ms": backoff_ms}
            if e.get("resumed"):
                attrs["resumed"] = True
            if sid in pending_retry:
                attrs["retry"] = pending_retry.pop(sid)
            span = new_span(f"s:{sid}:{att}", step_parent(sid), str(meta.get("title") or sid), "agent", ts,
                            step=sid, attempt=int(att), attrs={k: v for k, v in attrs.items() if v is not None})
            open_attempt[sid] = last_attempt[sid] = span["id"]
            continue
        if t == "step.dispatched" and sid:
            sp = attempt_span(sid)
            if sp and sp["open"] and sp["id"] not in dispatched and ts >= sp["start"]:
                dispatched[sp["id"]] = ts
                sp["attrs"]["queue_wait_ms"] = _ms(ts - sp["start"])
                if isinstance(e.get("waited_ms"), (int, float)):
                    sp["attrs"]["lock_wait_ms"] = int(e["waited_ms"])
                if e.get("resource"):
                    sp["attrs"]["resource"] = str(e.get("resource"))
                if isinstance(e.get("tries"), int) and not isinstance(e.get("tries"), bool) and e["tries"] > 0:
                    # PROC2-FIX P3: model turu GÖNDEREN deneme sırası (bütçe geçidinde bekleyen başlangıç sayılmaz)
                    sp["attrs"]["try"] = int(e["tries"])
                sp["events"].append({"name": "dispatched", "ts": ts,
                                     "attrs": {k: v for k, v in {"resource": e.get("resource"), "purpose": e.get("purpose"),
                                                                 "waited_ms": e.get("waited_ms")}.items() if v is not None}})
            continue
        if t == "step.retried" and sid:
            pending_retry[sid] = {"attempt": e.get("attempt"), "reason": e.get("reason")}
            continue
        if t == "step.awaiting" and sid:
            k = approval_n.get(sid, 0) + 1
            approval_n[sid] = k
            if sid in open_approval:
                close(spans.get(open_approval.pop(sid)), ts, "interrupted")
            ask = e.get("ask") if isinstance(e.get("ask"), dict) else (meta.get("ask") or None)
            attrs = {"approval_kind": e.get("kind") or meta.get("kind") or "approval",
                     "ask_kind": (ask or {}).get("kind")}
            if content:
                attrs["message"] = _clip(e.get("message"))
            span = new_span(f"a:{sid}:{k}", step_parent(sid), str(meta.get("title") or sid), "guardrail", ts,
                            step=sid, attempt=k, attrs={kk: v for kk, v in attrs.items() if v is not None})
            open_approval[sid] = span["id"]
            continue
        if t == "step.decided" and sid:
            sp = spans.get(open_approval.get(sid, ""))
            if sp:
                sp["attrs"]["approved"] = bool(e.get("approved"))
                if content and e.get("note"):
                    sp["attrs"]["note"] = _clip(e.get("note"))
            continue
        if t == "step.recalled" and sid:
            parent = attempt_span(sid)
            items = e.get("items") if isinstance(e.get("items"), list) else []
            attrs = {"count": len(items)}
            if content:
                attrs["items"] = [_clip(str((i or {}).get("label") or ""), 160) for i in items[:12]]
            sp = new_span(f"r:{sid}:{len(order)}", parent["id"] if parent else "run", "memory.recall", "retriever", ts,
                          step=sid, attempt=parent.get("attempt") if parent else None, attrs=attrs)
            close(sp, ts, "done")
            continue
        if t == "step.prompt" and sid:
            parent = attempt_span(sid)
            sp = new_span(f"p:{sid}:{len(order)}", parent["id"] if parent else "run", "prompt", "span", ts, step=sid,
                          attempt=e.get("attempt") if isinstance(e.get("attempt"), int) else (parent or {}).get("attempt"),
                          attrs=_prompt_attrs(e))
            close(sp, ts, "done")
            continue
        if t == "step.tool" and sid:
            parent = attempt_span(sid)
            attrs = {"tool": e.get("name")}
            if e.get("id"):  # PROC-FIX P2: bağlayıcının çağrı kimliği (tool_use_id) — sonuç kimlikle eşleşir
                attrs["tool_use_id"] = str(e.get("id"))[:120]
            if content and e.get("input") is not None:
                attrs["input"] = _clip(str(e.get("input")))
            sp = new_span(f"t:{sid}:{len(order)}", parent["id"] if parent else "run", str(e.get("name") or "tool"),
                          "tool", ts, step=sid, attempt=(parent or {}).get("attempt"), attrs=attrs)
            open_tools.setdefault(sid, []).append(sp["id"])
            continue
        if t == "step.tool_result" and sid:
            stack = open_tools.get(sid, [])
            rid = str(e.get("id"))[:120] if e.get("id") else None
            # PROC-FIX P2: önce kimlikle; yoksa aynı adlı en ESKİ açık çağrı (paralel çağrılar sırayla sonuçlanır)
            by_id = [i for i in range(len(stack)) if rid and spans[stack[i]]["attrs"].get("tool_use_id") == rid]
            by_name = [i for i in range(len(stack)) if spans[stack[i]]["attrs"].get("tool") == e.get("name")
                       and not (rid and spans[stack[i]]["attrs"].get("tool_use_id"))]
            for i in (by_id or by_name)[:1]:
                sp = spans[stack[i]]
                if content and e.get("output") is not None:
                    sp["attrs"]["output"] = _clip(str(e.get("output")))
                art = e.get("artifact")
                if isinstance(art, dict):  # referanslı araç çıktısı (içerik değil, yalnız kimlik/boyut)
                    sp["attrs"]["artifact"] = art.get("ref") or art.get("id")
                    sp["attrs"]["artifact_size"] = art.get("size")
                    sp["attrs"]["artifact_inline"] = art.get("inline_chars")
                close(sp, ts, "done" if e.get("ok") is not False else "failed")
                stack.pop(i)
            continue
        if t == "step.tool_approval" and sid:
            parent = attempt_span(sid)
            attrs = {"tool": e.get("tool"), "approval_id": e.get("approval_id")}
            if content:
                attrs["command"] = _clip(str(e.get("command") or ""), 400)
            sp = new_span(f"ta:{sid}:{len(order)}", parent["id"] if parent else "run", "tool approval", "guardrail", ts,
                          step=sid, attempt=(parent or {}).get("attempt"), attrs={k: v for k, v in attrs.items() if v})
            open_tool_appr[str(e.get("approval_id"))] = sp["id"]
            continue
        if t == "step.tool_approval_resolved":
            sp = spans.get(open_tool_appr.pop(str(e.get("approval_id")), ""))
            if sp:
                sp["attrs"]["choice"] = e.get("choice")
                if e.get("timed_out"):
                    sp["attrs"]["timed_out"] = True
                close(sp, ts, "rejected" if e.get("choice") == "deny" else "done")
            continue
        if t == "step.error" and sid:
            sp = attempt_span(sid)
            if sp:
                cls = "transient" if e.get("transient") else "permanent"
                sp["attrs"]["error_class"] = "transient" if sp["attrs"].get("error_class") == "transient" or cls == "transient" else cls
                err_attrs: dict[str, Any] = {"class": cls}
                if content:  # O-13: içerik kapalıyken hata metni (sağlayıcı yanıtı, istem parçası) tutulmaz
                    err_attrs["message"] = _clip(str(e.get("message") or ""), 400)
                sp["events"].append({"name": "error", "ts": ts, "attrs": err_attrs})
            continue
        if t == "step.retry_scheduled" and sid:
            sp = attempt_span(sid)
            if sp:
                rs_attrs: dict[str, Any] = {"attempt": e.get("attempt"), "in_s": e.get("in_s")}
                if content:
                    rs_attrs["reason"] = _clip(str(e.get("reason") or ""), 300)
                sp["events"].append({"name": "retry_scheduled", "ts": ts, "attrs": rs_attrs})
                sp["attrs"]["will_retry"] = True
                close_attempt(sid, ts, "failed")
                step_end[sid] = ts
            continue
        if t == "step.effect" and sid:
            eff = e.get("effect") if isinstance(e.get("effect"), dict) else None
            if eff:
                eid = str(eff.get("id") or eff.get("idempotency_key"))
                cur = {"id": eid, "step": sid, "kind": eff.get("kind"), "status": eff.get("status"),
                       "idempotency_key": eff.get("idempotency_key"), "attempt": eff.get("attempt"),
                       "detail": _clip(str(eff.get("detail") or ""), 400) if content else None, "ts": ts,
                       "offset_ms": _ms(ts - t0), "reused": bool(e.get("reused")) or None}
                effects[eid] = {k: v for k, v in cur.items() if v is not None}
                sp = attempt_span(sid)
                if sp:
                    sp["events"].append({"name": "effect", "ts": ts, "attrs": {"kind": eff.get("kind"), "status": eff.get("status")}})
            continue
        if t == "step.artifacts" and sid:
            sp = attempt_span(sid)
            files = e.get("files") if isinstance(e.get("files"), list) else []
            if sp:
                sp["attrs"]["artifacts"] = [str((f or {}).get("name") or "") for f in files][:50]
            continue
        if t in ("step.round", "step.warning", "step.plan") and sid:
            sp = attempt_span(sid)
            if sp:
                data = {"round": e.get("round"), "target": e.get("target"), "kind": e.get("kind")} if t != "step.plan" \
                    else {"subtasks": len(e.get("plan") or [])}
                if t == "step.warning" and content:
                    data["message"] = _clip(str(e.get("message") or ""), 400)
                sp["events"].append({"name": t.split(".", 1)[1], "ts": ts, "attrs": {k: v for k, v in data.items() if v is not None}})
            continue
        if t == "memory.updated" and sid:
            parent = attempt_span(sid)
            res = e.get("result") if isinstance(e.get("result"), dict) else {}
            sp = new_span(f"m:{sid}:{len(order)}", parent["id"] if parent else "run", "memory.consolidate", "retriever",
                          ts, step=sid, attempt=(parent or {}).get("attempt"),
                          attrs={k: res.get(k) for k in ("concepts", "facts", "extractor", "skipped") if res.get(k) is not None})
            close(sp, ts, "done")
            continue
        if t == "step.finished" and sid:
            status = str(e.get("status") or "done")
            step_end[sid] = ts
            if sid in open_approval:
                close(spans.get(open_approval.pop(sid)), ts, status)
                continue
            sp = spans.get(open_attempt.get(sid, ""))
            if sp is None and status in ("cancelled", "skipped", "rejected", "failed") and sid not in last_attempt \
                    and sid not in approval_n:
                # hiç başlamadan kapanan adım: sıfır uzunlukta işaret (ağaçta görünsün)
                sp = new_span(f"s:{sid}:0", step_parent(sid), str(meta.get("title") or sid), "agent", ts, step=sid,
                              attempt=0, attrs={"never_started": True, "agent": meta.get("agent")})
                last_attempt[sid] = sp["id"]
                close(sp, ts, status)
                if e.get("error") and content:
                    sp["attrs"]["error"] = _clip(str(e.get("error")), 600)
                continue
            if sp is None:
                continue
            usage = e.get("usage") if isinstance(e.get("usage"), dict) else None
            tokens = e.get("tokens") if isinstance(e.get("tokens"), dict) else None
            if usage:
                sp["attrs"]["usage"] = usage
            if tokens:
                sp["attrs"]["tokens"] = tokens
            if e.get("model"):
                sp["attrs"]["model"] = e.get("model")
            if e.get("error"):
                if content:
                    sp["attrs"]["error"] = _clip(str(e.get("error")), 600)
                if status == "failed":
                    sp["attrs"].setdefault("error_class", "permanent")
            open_tools_ = open_tools.get(sid)
            if open_tools_:
                close_tools(sid, ts, "interrupted")
            open_attempt.pop(sid, None)
            close(sp, ts, status)
            continue
        if t == "run.paused":
            for s_ in list(open_attempt):
                close_attempt(s_, ts, "paused")
            for s_ in list(open_approval):
                close(spans.get(open_approval.pop(s_)), ts, "paused")
            markers.append({"type": t, "ts": ts, "data": {"reason": e.get("reason"), "status": e.get("status")}})
            continue
        if t == "run.resumed":
            for s_ in list(open_attempt):  # kesinti sonrası devam: açık kalan denemeler yarıda kaldı
                close_attempt(s_, last_ts.get(s_, ts), "interrupted")
            for s_ in list(open_approval):
                close(spans.get(open_approval.pop(s_)), last_ts.get(s_, ts), "interrupted")
            resume_floor = ts
            markers.append({"type": t, "ts": ts, "data": {"from_step": e.get("from_step"), "reason": e.get("reason"),
                                                          "attempts": e.get("attempts")}})
            continue
        if t == "run.finished":
            run_end, run_status_final = ts, str(e.get("status") or "")
            end_status = "cancelled" if run_status_final == "cancelled" else "interrupted"
            for s_ in list(open_attempt):
                close_attempt(s_, ts, end_status)
            for s_ in list(open_approval):
                close(spans.get(open_approval.pop(s_)), ts, end_status)
            continue
        if t == "budget.exceeded" and sid and sid in open_attempt:
            # bütçe aşımı adımı askıya alır (bitiş olayı yok): deneme burada kesilir
            sp = spans.get(open_attempt[sid])
            if sp:
                sp["attrs"]["budget_exceeded"] = str(e.get("metric") or "")
            close_attempt(sid, ts, "interrupted")
        if t in RUN_MARKERS:
            data = {k: v for k, v in e.items() if k not in ("seq", "ts", "type", "run_id", "_trace")}
            if t == "handoff":
                data = {"from": e.get("from"), "to": e.get("to"), "step": sid}
            markers.append({"type": t, "ts": ts, "data": data})
            continue

    # ---- kapanış: hâlâ açık span'ler
    status = str(run.get("status") or run_status_final or "")
    live = status in ("running", "paused") or (status == "interrupted" and bool(run.get("live")))
    last_event = max([float(e.get("ts") or t0) for e in events] or [t0])
    end_all = run_end or (now if live else last_event)
    for sid_ in order:
        sp = spans[sid_]
        if sp["id"] == "run" or not sp["open"]:
            continue
        if live:
            sp["end"] = max(now, sp["start"])  # canlı: şu ana kadar
        else:
            close(sp, last_ts.get(sp.get("step") or "", end_all), "interrupted")
    run_span["end"] = max(end_all, t0)
    run_span["open"] = live
    if status:
        run_span["status"] = status

    # ---- ilk çıktı: defter işareti yoksa kalıcı olaylardan (ilk araç / araç onayı) türet
    gated_kids: dict[str, list[dict[str, Any]]] = {}  # deneme → araç / onay alt span'leri (tek geçiş; karesel değil)
    for c in order:
        ch = spans[c]
        if ch["parent"] and ch["kind"] in ("tool", "guardrail"):
            gated_kids.setdefault(ch["parent"], []).append(ch)
    for sp in spans.values():
        if sp["kind"] != "agent" or not sp.get("attempt"):
            continue
        key = (sp["step"], sp["attempt"])
        first = first_out.get(key)
        kids_ = gated_kids.get(sp["id"], [])
        if first is None:
            first = min((k["start"] for k in kids_), default=None)
        if first is not None and first >= sp["start"]:
            sp["attrs"]["first_output_ms"] = _ms(first - sp["start"])
        disp = dispatched.get(sp["id"])
        if disp is not None:
            if first is not None and first >= disp:
                sp["attrs"]["provider_first_output_ms"] = _ms(first - disp)
            end = sp["end"] if sp["end"] is not None else disp
            # deneme içindeki araç onayı beklemesi sağlayıcı süresi değildir (onay bekleme olarak ayrıca sayılır)
            appr = sum(max(0.0, min(k["end"] or end, end) - max(k["start"], disp)) for k in kids_
                       if k["kind"] == "guardrail")
            sp["attrs"]["provider_ms"] = _ms(max(0.0, end - disp - appr))

    # ---- çıktı biçimi ve özet
    out_spans: list[dict[str, Any]] = []
    for sid_ in order:
        sp = spans[sid_]
        end = sp["end"] if sp["end"] is not None else sp["start"]
        out_spans.append({
            "id": sp["id"], "span_id": span_hex(run_id, sp["id"]), "parent": sp["parent"], "name": sp["name"],
            "kind": sp["kind"], "step": sp["step"], "attempt": sp["attempt"], "status": sp["status"], "open": sp["open"],
            "start": sp["start"], "end": end, "start_ms": _ms(sp["start"] - t0), "end_ms": _ms(end - t0),
            "duration_ms": _ms(max(0.0, end - sp["start"])), "attrs": sp["attrs"],
            "events": [{"name": ev_["name"], "offset_ms": _ms(ev_["ts"] - t0), "attrs": ev_["attrs"]}
                       for ev_ in sp["events"]]})
    for mk in markers:
        mk["offset_ms"] = _ms(mk["ts"] - t0)

    attempts_per_step: dict[str, int] = {}
    for sp in out_spans:
        if sp["kind"] == "agent" and sp["attempt"]:
            attempts_per_step[sp["step"]] = attempts_per_step.get(sp["step"], 0) + 1
    eff_status: dict[str, int] = {}
    for eff in effects.values():
        eff_status[str(eff.get("status"))] = eff_status.get(str(eff.get("status")), 0) + 1
    err_cls: dict[str, int] = {}
    for sp in out_spans:
        c = sp["attrs"].get("error_class")
        if c:
            err_cls[c] = err_cls.get(c, 0) + 1
    usage = run.get("usage") if isinstance(run.get("usage"), dict) else {}
    tokens = usage.get("tokens")
    if tokens is None:
        tokens = sum(int((s.get("tokens") or {}).get("total") or 0) for s in run.get("steps") or [])
    stats = {
        "duration_ms": _ms(max(0.0, run_span["end"] - t0)),
        "steps": len({sp["step"] for sp in out_spans if sp["step"]}),
        "attempts": sum(attempts_per_step.values()),
        "retries": sum(max(0, n - 1) for n in attempts_per_step.values()),
        "tool_calls": sum(1 for sp in out_spans if sp["kind"] == "tool"),
        "tool_errors": sum(1 for sp in out_spans if sp["kind"] == "tool" and sp["status"] == "failed"),
        "approval_wait_ms": sum(sp["duration_ms"] for sp in out_spans if sp["kind"] == "guardrail"),
        # O-10 / O-11: her aralık bir kez — hazır olma beklemesi, geri çekilme, kaynak kuyruğu, sağlayıcı
        "ready_wait_ms": sum(int(sp["attrs"].get("ready_wait_ms") or 0) for sp in out_spans if sp["kind"] == "agent"),
        "backoff_ms": sum(int(sp["attrs"].get("backoff_ms") or 0) for sp in out_spans if sp["kind"] == "agent"),
        "queue_wait_ms": sum(int(sp["attrs"].get("queue_wait_ms") or 0) for sp in out_spans if sp["kind"] == "agent"),
        "provider_ms": sum(int(sp["attrs"].get("provider_ms") or 0) for sp in out_spans if sp["kind"] == "agent"),
        # ölçüm kart, çubuk ve "Bugünkü harcama" ile AYNI sayıyı gösterir: gerçek harcama (güncel denemeler +
        # durdurulan/yeniden oynatılan denemeler); bunun yeniden oynatılan kısmı ayrıca `replayed_tokens`
        "tokens": int(tokens or 0) + int(((usage.get("replayed") or {}).get("tokens")) or 0),
        "replayed_tokens": int(((usage.get("replayed") or {}).get("tokens")) or 0),
        "cost_usd": ((usage.get("spent") or {}).get("cost_usd") if isinstance(usage.get("spent"), dict)
                     else usage.get("cost_usd")), "cost_basis": usage.get("cost_basis"),
        "saved_tokens_est": sum(int(sp["attrs"].get("saved_tokens_est") or 0) for sp in out_spans if sp["name"] == "prompt"),
        "effects": eff_status, "error_classes": err_cls, "events": len(events),
    }
    return {"run_id": run_id, "trace_id": trace_id(run_id), "status": status, "live": live, "t0": t0,
            "title": run.get("title"), "forked_from": run.get("forked_from"), "spans": out_spans, "markers": markers,
            "effects": sorted(effects.values(), key=lambda x: x.get("ts", 0)), "stats": stats,
            "content": content,
            # sürüm manifesti (içeriksiz) ve mutlak bitiş zamanı
            "manifest": run.get("manifest") if isinstance(run.get("manifest"), dict) else None,
            "deadline_at": run.get("deadline_at")}
