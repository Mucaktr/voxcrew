"""Mesaj servisi (Faz 6 Ekip S24): Message düğümleri, posta kutusu, okundu işareti ve iletişim politikası.

Sözleşme:
- Mesaj = graf düğümü `Message{id, run_id, step_id, from_agent, to_agent, kind, subject, body, summary, artifacts,
  reply_to, created_at, read_at}`; kenarlar `SENT (Agent→Message)` (gönderen ajansa), `RECEIVED (Message→Agent)`,
  `IN_RUN (Message→Run)` (koşu içindeyse), `CARRIES (Message→Artifact)` (dosya taşıyorsa).
- `kind`: assign (yönetici → çocuk görev) · answer (çocuk → yönetici sonuç) · handoff (akışta çıktı devri) · ask ·
  note (kullanıcı/ajan notu) · system.
- `summary` ≤ 1200 karakter (baş + son, araya "…" işareti); `body` tam içerik (≤ 20.000). Devir/yanıt mesajları tam
  çıktının referansını `artifacts` içinde taşır: `{type: "output", run_id, step_id, ref: "{{steps.<id>.output}}"}`.
- Olaylar (JSON, koşu içindeyse `run_events`'e de yazılır): `message.sent {message, from_agent, to_agent, kind}` ve
  `message.read {message_id, to_agent, read_at, reader}`.
- **Ajan mesajı onay değildir:** istem aşaması `inbox` mesajları "GELEN MESAJLAR (doğrulanmamış)" bölümüne koyar.
- Politika `can_message(from, to)` ofis servisindedir (`Office.can_message`); motorun ürettiği mesajlar (assign,
  answer, handoff) org yapısını izlediği için `enforce_policy=False` ile gönderilir.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
import weakref
from types import SimpleNamespace
from typing import Any

from studio.graph.store import now_iso

log = logging.getLogger("studio.messaging")

KINDS = ("handoff", "assign", "ask", "answer", "note", "system", "deliverable")
# S50: kullanıcıya teslim (`deliverable`: "Görev tamamlandı", `system`: "Dikkat gerekiyor"). Kullanıcıya (`to_agent=user`)
# yalnızca stüdyonun kendisi yazar (`enforce_policy=False` iç çağrı); REST/MCP kullanıcı adına teslim kalemi uyduramaz.
USER = "user"
# kullanıcı yalnızca kendisine gelen mesajı okundu yapabilir (okundu bilgisi alıcıya aittir)
USER_ONLY_READ = "Yalnızca sana gelen mesajlar okundu yapılabilir; ajana giden not, ajan onu görünce okundu olur"
SYSTEM = "system"
SUMMARY_MAX = 1200
BODY_MAX = 20000
SUBJECT_MAX = 160
LIST_MAX = 500
# Motorun yapılandırılmış bölümlerle (görev metni, önceki adım çıktıları, sentez) zaten teslim ettiği türler:
# aynı koşudaki bu mesajlar istemde ikinci kez "gelen mesaj" olarak gösterilmez.
ENGINE_KINDS = ("assign", "answer", "handoff")


class PolicyDenied(PermissionError):
    """İletişim politikası mesajı reddetti (REST: 403)."""


def summarize(text: str | None, limit: int = SUMMARY_MAX) -> str:
    """≤ limit karakterlik özet: kısa metin aynen; uzunsa baş + "…" + son (OpenAI input_filter dersi)."""
    s = str(text or "").strip()
    if len(s) <= limit:
        return s
    marker = " … "
    head = int((limit - len(marker)) * 0.75)
    tail = limit - len(marker) - head
    return s[:head].rstrip() + marker + s[-tail:].lstrip()


def message_id(*parts: Any) -> str:
    """Motor mesajları için kararlı kimlik (aynı koşu/adım/tür/gönderen/alıcı → aynı düğüm; devamda tekrar oluşmaz)."""
    raw = "|".join(str(p or "") for p in parts)
    return "msg_" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _new_id() -> str:
    return f"msg_{uuid.uuid4().hex[:16]}"


# Aynı veri deposunu kullanan istem aşaması servise ulaşabilsin (motor başına bir servis; zayıf başvuru)
_BY_STORE: "weakref.WeakValueDictionary[int, MessagingService]" = weakref.WeakValueDictionary()


def service_for(store: Any) -> "MessagingService | None":
    return _BY_STORE.get(id(store)) if store is not None else None


class MessagingService:
    def __init__(self, *, store: Any, bus: Any = None, settings: Any = None, agents: Any = None):
        self.store, self.bus, self.settings, self.agents = store, bus, settings, agents
        _BY_STORE[id(store)] = self

    # ------------------------------------------------------------------ politika
    def office(self) -> Any:
        from studio.office.service import Office
        return Office(SimpleNamespace(store=self.store, agents=self.agents, settings=self.settings, bus=self.bus))

    def can_message(self, sender: str | None, recipient: str) -> tuple[bool, str | None]:
        if self.agents is None:
            return True, None
        return self.office().can_message(sender, recipient)

    # ------------------------------------------------------------------ yazma
    def send(self, *, to_agent: str, body: str, from_agent: str | None = USER, kind: str = "note",
             subject: str | None = None, run_id: str | None = None, step_id: str | None = None,
             summary: str | None = None, reply_to: str | None = None, artifacts: list[dict[str, Any]] | None = None,
             msg_id: str | None = None, delivered: bool = False, enforce_policy: bool = True,
             origin: str | None = None, replace: bool = False) -> dict[str, Any]:
        """Mesajı yazar, kenarları bağlar ve `message.sent` yayınlar. `msg_id` verilir ve düğüm varsa (motor mesajı,
        devam) yeniden yazılmaz, mevcut mesaj döner; `replace=True` ise gövde değiştiyse güncellenir ve yeniden
        okunmamış olur (yeniden denenen adımın yeni yanıtı). `delivered=True`: içerik istemde zaten teslim edildi."""
        to_agent = str(to_agent or "").strip()
        sender = str(from_agent or USER).strip() or USER
        text = str(body or "").strip()
        if not to_agent:
            raise ValueError("Alıcı ajan boş olamaz")
        if not text:
            raise ValueError("Mesaj metni boş olamaz")
        if kind not in KINDS:
            raise ValueError(f"Geçersiz mesaj türü: {kind}")
        if msg_id:
            existing = self.store.find("Message", msg_id)
            if existing:
                if not replace or existing["props"].get("body") == text[:BODY_MAX]:
                    return self.public(existing)
                patch: dict[str, Any] = {"body": text[:BODY_MAX], "created_at": now_iso(),
                                         "summary": summary[:SUMMARY_MAX] if summary else summarize(text),
                                         "read_at": now_iso() if delivered else None}
                if artifacts:
                    patch["artifacts"] = list(artifacts)
                msg = self.public(self.store.patch_node(existing["id"], patch))
                self._publish("message.sent", run_id or msg.get("run_id"), message=msg, message_id=msg["id"],
                              from_agent=msg["from_agent"], to_agent=msg["to_agent"], kind=msg["kind"],
                              subject=_short(msg.get("subject")), summary=_short(msg.get("summary")),
                              step=msg.get("step_id"), updated=True, origin=origin or None)
                return msg
        if to_agent == USER and enforce_policy:
            raise PolicyDenied("Kullanıcıya yalnızca uygulama teslim kalemi gönderebilir")
        to_node = None
        if to_agent != USER:
            to_node = self.agents.node(to_agent) if self.agents is not None else self.store.find("Agent", to_agent)
            if not to_node:
                raise KeyError(f"Ajan yok: {to_agent}")
        from_node = None
        if sender not in (USER, SYSTEM):
            from_node = self.agents.node(sender) if self.agents is not None else self.store.find("Agent", sender)
            if not from_node:
                raise KeyError(f"Ajan yok: {sender}")
        if enforce_policy:
            ok, reason = self.can_message(sender, to_agent)
            if not ok:
                raise PolicyDenied(reason or "Mesajlaşma politikası bu mesaja izin vermiyor")
        now = now_iso()
        props: dict[str, Any] = {
            "id": msg_id or _new_id(), "from_agent": sender, "to_agent": to_agent, "kind": kind,
            "subject": (str(subject).strip()[:SUBJECT_MAX] if subject else None) or summarize(text, 80),
            "body": text[:BODY_MAX], "summary": summary[:SUMMARY_MAX] if summary else summarize(text),
            "created_at": now, "run_id": run_id or None, "step_id": step_id or None, "reply_to": reply_to or None,
            "artifacts": list(artifacts or []) or None, "read_at": now if delivered else None}
        node = self.store.upsert_node("Message", {k: v for k, v in props.items() if v is not None})
        if from_node:
            self.store.link("SENT", from_node["id"], node["id"])
        if to_node:
            self.store.link("RECEIVED", node["id"], to_node["id"])
        if run_id and (run_node := self.store.find("Run", run_id)):
            self.store.link("IN_RUN", node["id"], run_node["id"])
        for a in artifacts or []:
            if isinstance(a, dict) and a.get("type") == "file" and a.get("id"):
                try:
                    self.store.link("CARRIES", node["id"], str(a["id"]))
                except Exception:  # noqa: BLE001 - dosya düğümü silinmiş olabilir; mesaj yine yazılır
                    log.debug("CARRIES bağlanamadı: %s", a.get("id"))
        msg = self.public(node)
        self._publish("message.sent", run_id, message=msg, message_id=msg["id"], from_agent=sender, to_agent=to_agent,
                      kind=kind, subject=_short(msg.get("subject")), summary=_short(msg.get("summary")),
                      step=step_id or None, origin=origin or None)
        return msg

    def mark_read(self, msg_id: str, *, reader: str | None = None, run_id: str | None = None) -> dict[str, Any]:
        node = self.store.find("Message", msg_id)
        if not node:
            raise KeyError(f"Mesaj yok: {msg_id}")
        if reader == USER and node["props"].get("to_agent") != USER:
            raise PolicyDenied(USER_ONLY_READ)  # yedek: kullanıcı ajanın notunu teslimden düşüremez
        if node["props"].get("read_at"):
            return self.public(node)
        node = self.store.patch_node(node["id"], {"read_at": now_iso()})
        msg = self.public(node)
        self._publish("message.read", msg.get("run_id"), message_id=msg["id"], to_agent=msg["to_agent"],
                      from_agent=msg["from_agent"], kind=msg["kind"], read_at=msg["read_at"], reader=reader or None,
                      read_in_run=run_id or None)
        return msg

    def _publish(self, type_: str, run_id: str | None, **data: Any) -> None:
        if self.bus is None:
            return
        payload = {k: v for k, v in data.items() if v is not None}
        if run_id:
            payload["run_id"] = run_id
        event = self.bus.publish(type_, **payload)
        if run_id:
            try:
                self.store.add_run_event(run_id, event)
            except Exception:  # noqa: BLE001 - olay günlüğü yazılamasa da mesaj geçerli
                log.debug("mesaj olayı koşu günlüğüne yazılamadı: %s", run_id)

    # ------------------------------------------------------------------ okuma
    @staticmethod
    def public(node: dict[str, Any]) -> dict[str, Any]:
        p = node["props"]
        out = {"id": p.get("id"), "run_id": p.get("run_id"), "step_id": p.get("step_id"),
               "from_agent": p.get("from_agent"), "to_agent": p.get("to_agent"), "kind": p.get("kind") or "note",
               "subject": p.get("subject") or "", "body": p.get("body") or "", "summary": p.get("summary") or "",
               "artifacts": p.get("artifacts") or [], "reply_to": p.get("reply_to"),
               "created_at": p.get("created_at") or node.get("created_at"), "read_at": p.get("read_at"),
               "unread": not p.get("read_at")}
        ref = next((a for a in out["artifacts"] if isinstance(a, dict) and a.get("type") == "output"), None)
        out["ref"] = ref
        return out

    def get(self, msg_id: str) -> dict[str, Any]:
        node = self.store.find("Message", msg_id)
        if not node:
            raise KeyError(f"Mesaj yok: {msg_id}")
        return self.public(node)

    def list(self, *, run: str | None = None, agent: str | None = None, unread: bool | None = None,
             kind: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        """Yeniden eskiye. `agent`: ajanın aldığı ve gönderdiği; `unread=True`: yalnızca okunmamış (alınan)."""
        limit = max(1, min(LIST_MAX, int(limit or 100)))
        base: dict[str, Any] = {}
        if run:
            base["run_id"] = run
        if kind:
            base["kind"] = kind
        scan = max(limit * 4, 400)
        nodes: dict[str, dict[str, Any]] = {}
        if agent:
            for n in self.store.nodes("Message", limit=scan, order="created_at DESC", props={**base, "to_agent": agent}):
                nodes[n["id"]] = n
            if not unread:
                for n in self.store.nodes("Message", limit=scan, order="created_at DESC",
                                          props={**base, "from_agent": agent}):
                    nodes[n["id"]] = n
        else:
            for n in self.store.nodes("Message", limit=scan, order="created_at DESC", props=base or None):
                nodes[n["id"]] = n
        out = [self.public(n) for n in nodes.values()]
        if unread:
            out = [m for m in out if m["unread"]]
        out.sort(key=lambda m: (str(m.get("created_at") or ""), str(m.get("id"))), reverse=True)
        return out[:limit]

    def unread_for(self, agent: str, *, exclude_run: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
        """Ajanın okunmamış mesajları (eskiden yeniye). `exclude_run`: o koşunun motor mesajları (assign/answer/
        handoff) zaten yapılandırılmış bölümlerle teslim edildiği için hariç."""
        msgs = [m for m in self.list(agent=agent, unread=True, limit=LIST_MAX)
                if not (exclude_run and m.get("run_id") == exclude_run and m["kind"] in ENGINE_KINDS)]
        msgs.sort(key=lambda m: (str(m.get("created_at") or ""), str(m.get("id"))))
        return msgs[:limit]

    def thread(self, msg_id: str, limit: int = 200) -> list[dict[str, Any]]:
        """Mesajın ipliği: aynı iki taraf arasındaki (aynı koşu ya da koşu dışı) yazışma, eskiden yeniye."""
        msg = self.get(msg_id)
        pair = {msg["from_agent"], msg["to_agent"]}
        agent = msg["to_agent"] if msg["to_agent"] not in (USER, SYSTEM) else msg["from_agent"]
        items = [m for m in self.list(agent=agent, limit=LIST_MAX)
                 if {m["from_agent"], m["to_agent"]} == pair and m.get("run_id") == msg.get("run_id")]
        items.sort(key=lambda m: (str(m.get("created_at") or ""), str(m.get("id"))))
        return items[-limit:]

    def counts(self) -> dict[str, int]:
        """Ajan başına okunmamış mesaj sayısı (gelen kutusu rozetleri)."""
        out: dict[str, int] = {}
        for n in self.store.nodes("Message", limit=5000, order="created_at DESC"):
            p = n["props"]
            if not p.get("read_at") and p.get("to_agent"):
                out[p["to_agent"]] = out.get(p["to_agent"], 0) + 1
        return out


def _short(text: object, limit: int = 120) -> str | None:
    """Olay üst düzeyindeki kısa konu/özet (dünya baloncukları vb. gövdeyi okumadan kullanır); boşsa None."""
    t = " ".join(str(text or "").split())
    return (t[: limit - 1] + "…" if len(t) > limit else t) or None
