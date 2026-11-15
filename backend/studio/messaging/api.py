"""Mesajlaşma uç noktaları (Faz 6 Ekip S24) —.

| Uç | Gövde / sorgu | Yanıt |
|---|---|---|
| `GET /api/messages` | `?run=&agent=&unread=&kind=&limit=` | `{messages: [...], count}` (yeniden eskiye) |
| `GET /api/messages/unread` | — | `{counts: {ajan: n}, total}` (gelen kutusu rozetleri) |
| `GET /api/messages/policy` | — | `{policy, teams}` |
| `PUT /api/messages/policy` | `{policy?, teams?: {ekip: free\\|hierarchical\\|null}}` | `{policy, teams}` |
| `GET /api/messages/{id}` | — | `{message, thread: [...]}` |
| `POST /api/messages/{id}/read` | — | `{ok, message}` |
| `POST /api/messages` | `{from?, to, body, subject?, kind?, run_id?, reply_to?}` | `{ok, message}` · 403 politika |
| `POST /api/agents/{slug}/inbox` | `{body, subject?, kind?, reply_to?}` | `{ok, message}` (kullanıcı → ajan; ajan bir sonraki adımında okur) |

Kullanıcı (ve MCP istemcisi) her ajana yazabilir; ajan → ajan mesajı `messaging.policy`'ye tabidir (hiyerarşikte ekipler
arası mesaj liderler ya da raporlama zinciri üzerinden gitmeli, yoksa 403). Mesaj göndermek bir karar değildir: MCP'den
de yapılabilir (`clients.tracker` karar kapısına girmez).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, HTTPException, Request

from studio.messaging.service import KINDS, USER, USER_ONLY_READ, PolicyDenied

if TYPE_CHECKING:
    from studio.api import Studio

USER_KINDS = ("note", "ask", "answer")


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(tags=["messaging"])

    def svc() -> Any:
        s = getattr(getattr(studio, "engine", None), "messages", None)
        if s is None:
            raise HTTPException(503, "Mesajlaşma hazır değil")
        return s

    def office() -> Any:
        from studio.office.service import Office
        return Office(studio)

    def guard(fn: Any) -> Any:
        try:
            return fn()
        except PolicyDenied as exc:
            raise HTTPException(403, str(exc)) from exc
        except KeyError as exc:
            raise HTTPException(404, str(exc).strip("'")) from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    def origin(request: Request) -> str | None:
        from studio.api import run_origin
        return run_origin({}, request)

    async def body_of(request: Request) -> dict[str, Any]:
        try:
            data = await request.json()
        except ValueError:
            data = None
        if not isinstance(data, dict):
            raise HTTPException(400, "Gövde bir nesne olmalı")
        return data

    def text(data: dict[str, Any], key: str, limit: int | None = None) -> str | None:
        v = data.get(key)
        if v is None:
            return None
        if not isinstance(v, str):
            raise HTTPException(400, f"{key} metin olmalı")
        return v[:limit] if limit else v

    @r.get("/api/messages")
    def list_messages(run: str | None = None, agent: str | None = None, unread: bool | None = None,
                      kind: str | None = None, limit: int = 100) -> dict[str, Any]:
        if kind and kind not in KINDS:
            raise HTTPException(400, f"Geçersiz mesaj türü: {kind}")
        msgs = svc().list(run=run or None, agent=agent or None, unread=bool(unread), kind=kind or None, limit=limit)
        return {"messages": msgs, "count": len(msgs)}

    @r.get("/api/messages/unread")
    def unread_counts() -> dict[str, Any]:
        counts = svc().counts()
        return {"counts": counts, "total": sum(counts.values())}

    @r.get("/api/messages/policy")
    def get_policy() -> dict[str, Any]:
        return office().messaging_policy()

    @r.put("/api/messages/policy")
    async def put_policy(request: Request) -> dict[str, Any]:
        data = await body_of(request)
        teams = data.get("teams")
        return guard(lambda: office().set_messaging_policy(policy=data.get("policy"), teams=teams))

    @r.get("/api/messages/{msg_id}")
    def get_message(msg_id: str) -> dict[str, Any]:
        s = svc()
        return guard(lambda: {"message": s.get(msg_id), "thread": s.thread(msg_id)})

    @r.post("/api/messages/{msg_id}/read")
    async def mark_read(msg_id: str, request: Request) -> dict[str, Any]:
        s = svc()
        # S50: kullanıcıya gelen teslim/uyarı kalemlerini yalnızca kullanıcı okundu yapar (MCP bildirimi gizleyemez)
        from studio.presence import ui_present
        to_agent = guard(lambda: s.get(msg_id)).get("to_agent")
        if to_agent != USER:
            # ajana giden not, ajanın gelen kutusu aşamasında teslim edilince okundu olur; kullanıcı onu
            # okundu yaparsa not ajana hiç ulaşmaz
            raise HTTPException(403, USER_ONLY_READ)
        if not ui_present(request):
            raise HTTPException(403, "Bu işlem yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir")
        return guard(lambda: {"ok": True, "message": s.mark_read(msg_id, reader=USER)})

    @r.post("/api/messages")
    async def send(request: Request) -> dict[str, Any]:
        data = await body_of(request)
        s = svc()
        kind = text(data, "kind") or "note"
        if kind not in USER_KINDS:
            raise HTTPException(400, f"Geçersiz mesaj türü: {kind}")
        sender = (text(data, "from") or USER).strip() or USER
        if sender == "system":
            raise HTTPException(400, "Sistem mesajı bu uçtan gönderilemez")
        to = (text(data, "to") or "").strip()
        run_id = (text(data, "run_id") or "").strip() or None
        if run_id and not studio.store.find("Run", run_id):
            raise HTTPException(404, f"Çalıştırma yok: {run_id}")
        msg = guard(lambda: s.send(from_agent=sender, to_agent=to, body=text(data, "body") or "", kind=kind,
                                   subject=text(data, "subject", 160), run_id=run_id,
                                   reply_to=text(data, "reply_to", 80), origin=origin(request)))
        return {"ok": True, "message": msg}

    @r.post("/api/agents/{slug}/inbox")
    async def inbox(slug: str, request: Request) -> dict[str, Any]:
        data = await body_of(request)
        s = svc()
        kind = text(data, "kind") or "note"
        if kind not in USER_KINDS:
            raise HTTPException(400, f"Geçersiz mesaj türü: {kind}")
        msg = guard(lambda: s.send(from_agent=USER, to_agent=slug, body=text(data, "body") or "", kind=kind,
                                   subject=text(data, "subject", 160), reply_to=text(data, "reply_to", 80),
                                   origin=origin(request)))
        return {"ok": True, "message": msg}

    return r


async def start(studio: "Studio") -> None:
    """Açılışta: motor mesaj servisini ve `inbox` aşamasını zaten kurar (Engine.__init__); aşama yeniden kaydı zararsız."""
    from studio.messaging.stage import register_stage
    register_stage()


async def stop(studio: "Studio") -> None:
    """Kapanışta yapılacak iş yok (arka plan görevi yok)."""
