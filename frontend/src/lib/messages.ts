// Faz 6 — Ekip S24: ajanlar arası mesajlaşma istemcisi.
// REST: GET /api/messages?run=&agent=&unread=&kind=&limit= · GET /api/messages/{id} · POST /api/messages/{id}/read ·
// POST /api/agents/{slug}/inbox · GET /api/messages/unread · GET|PUT /api/messages/policy.
// Canlı: `message.sent {message}` ve `message.read {message_id, read_at}` olayları store.ts'ye dokunmadan
// `registerEventHandler("message.", …)` ile dinlenir.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, bodyText } from "./api";
import { currentLocale } from "./i18n";
import { registerEventHandler } from "./store";
import type { StudioEvent } from "./types";

// S50: `deliverable` — koşu bitince stüdyonun kullanıcıya teslim kalemi ("Görev tamamlandı: …")
export type MessageKind = "handoff" | "assign" | "ask" | "answer" | "note" | "system" | "deliverable";
export const MESSAGE_KINDS: MessageKind[] = ["deliverable", "assign", "answer", "handoff", "note", "ask", "system"];

/** Tam çıktı referansı (`type: output`) ya da mesajın taşıdığı dosya (`type: file`). */
/** S50: `type: deliverable` → Çıktılar kaydı (`id` = dlv_…, `kind`, `source`). */
export interface MessageRef { type: "output" | "file" | "deliverable" | string; run_id?: string; step_id?: string; ref?: string; chars?: number; id?: string; name?: string; kind?: string; source?: string }

/** Sunucunun döndürdüğü mesaj (`lib/types.ts` Message'ın genişletilmişi: artifacts nesne listesi, unread, ref). */
export interface InboxMessage {
  id: string; run_id?: string | null; step_id?: string | null; from_agent: string; to_agent: string; kind: MessageKind;
  subject: string; body: string; summary: string; artifacts: MessageRef[]; reply_to?: string | null;
  created_at: string; read_at?: string | null; unread: boolean; ref?: MessageRef | null;
}

export interface MessageQuery { run?: string; agent?: string; unread?: boolean; kind?: MessageKind | ""; limit?: number }
export interface MessagingPolicy { policy: "free" | "hierarchical" | "custom"; teams: Record<string, "free" | "hierarchical"> }

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = bodyText(res.status, null);
    try {
      const j = await res.json();
      msg = bodyText(res.status, j);
    } catch { /* gövde yok */ }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

function qs(q: MessageQuery): string {
  const p = new URLSearchParams();
  if (q.run) p.set("run", q.run);
  if (q.agent) p.set("agent", q.agent);
  if (q.unread) p.set("unread", "true");
  if (q.kind) p.set("kind", q.kind);
  p.set("limit", String(q.limit ?? 100));
  return p.toString();
}

export const messagesApi = {
  list: (q: MessageQuery) => req<{ messages: InboxMessage[]; count: number }>("GET", `/api/messages?${qs(q)}`),
  get: (id: string) => req<{ message: InboxMessage; thread: InboxMessage[] }>("GET", `/api/messages/${encodeURIComponent(id)}`),
  markRead: (id: string) => req<{ ok: boolean; message: InboxMessage }>("POST", `/api/messages/${encodeURIComponent(id)}/read`),
  sendToAgent: (slug: string, body: string, subject?: string, replyTo?: string) =>
    req<{ ok: boolean; message: InboxMessage }>("POST", `/api/agents/${encodeURIComponent(slug)}/inbox`,
      { body, ...(subject ? { subject } : {}), ...(replyTo ? { reply_to: replyTo } : {}) }),
  unread: () => req<{ counts: Record<string, number>; total: number }>("GET", "/api/messages/unread"),
  policy: () => req<MessagingPolicy>("GET", "/api/messages/policy"),
  setPolicy: (patch: Partial<MessagingPolicy>) => req<MessagingPolicy>("PUT", "/api/messages/policy", patch),
};

/** Olaydaki mesaj sorguya uyuyor mu (canlı ekleme için). */
export function matches(m: InboxMessage, q: MessageQuery): boolean {
  if (q.run && m.run_id !== q.run) return false;
  if (q.kind && m.kind !== q.kind) return false;
  if (q.agent) {
    if (q.unread) return m.to_agent === q.agent && m.unread;
    if (m.to_agent !== q.agent && m.from_agent !== q.agent) return false;
  }
  if (q.unread && !m.unread) return false;
  return true;
}

/** `message.*` olaylarına abone olur (bileşen ömrü boyunca). */
export function useMessageEvents(fn: (ev: StudioEvent) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => registerEventHandler("message.", (ev) => ref.current(ev)), []);
}

/** Sorguya göre mesaj listesi + canlı güncelleme (yeni mesaj başa eklenir, okundu işareti yerinde güncellenir). */
export function useMessages(q: MessageQuery): {
  messages: InboxMessage[]; loading: boolean; error: string | null; reload: () => void; patch: (m: InboxMessage) => void;
} {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const key = `${q.run ?? ""}|${q.agent ?? ""}|${q.unread ? 1 : 0}|${q.kind ?? ""}|${q.limit ?? 100}`;
  const qRef = useRef(q);
  qRef.current = q;
  const seq = useRef(0);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    messagesApi.list(qRef.current)
      .then((res) => { if (mine === seq.current) { setMessages(res.messages); setError(null); } })
      .catch((e: unknown) => { if (mine === seq.current) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, []);

  useEffect(() => { reload(); }, [key, reload]);

  const patch = useCallback((m: InboxMessage) => {
    setMessages((cur) => {
      const cq = qRef.current;
      const rest = cur.filter((x) => x.id !== m.id);
      if (!matches(m, cq)) return rest.length === cur.length ? cur : rest;
      const exists = rest.length !== cur.length;
      return exists ? cur.map((x) => (x.id === m.id ? m : x)) : [m, ...cur].slice(0, cq.limit ?? 100);
    });
  }, []);

  useMessageEvents((ev) => {
    if (ev.type === "message.sent" && ev.message && typeof ev.message === "object") {
      patch(ev.message as InboxMessage);
    } else if (ev.type === "message.read" && typeof ev.message_id === "string") {
      const id = ev.message_id;
      const readAt = typeof ev.read_at === "string" ? ev.read_at : new Date().toISOString();
      setMessages((cur) => {
        if (!cur.some((x) => x.id === id)) return cur;
        const next = cur.map((x) => (x.id === id ? { ...x, read_at: readAt, unread: false } : x));
        return qRef.current.unread ? next.filter((x) => x.unread) : next;
      });
    }
  });

  return { messages, loading, error, reload, patch };
}
