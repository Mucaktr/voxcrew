// AGENT-DELETE (karar 31 Ekim): reddedilen ajan silmeleri için bildirim mantığı (saf; AgentDeleteNotice kullanır)
// ve "Ajanlar silebilsin" onayında gösterilmesi ZORUNLU risk maddeleri. Sunucu: presence.py `clients.delete_refused`.

/** Onay penceresindeki risk maddeleri — sıra = gösterim sırası; hepsi gösterilmeden izin açılmaz. */
export const RISK_KEYS = ["risk_loss", "risk_misread", "risk_injection", "risk_cascade", "risk_recovery", "risk_scope",
  "risk_off"] as const;

/** Ayarın sayfadaki yeri (sunucu `settings_page` ile aynı). */
export const AGENT_DELETE_ANCHOR = "ajan-silme";
export const AGENT_DELETE_PAGE = `/baglan#${AGENT_DELETE_ANCHOR}`;

/** Tekrar oynatılan eski olaylar bildirim üretmez (sn). */
export const FRESH_S = 90;
/** Açık bildirim bu süre içinde gelen yeni retleri toplar; her yeni ret süreyi uzatır (ms). */
export const NOTICE_MS = 12000;

export interface RefusedEvent { type?: string; ts?: number; client?: unknown; kind?: unknown; resource?: unknown; item?: unknown }
export interface DeleteNotice { key: number; count: number; agents: string[]; items: string[]; until: number }

/** Olay → (ajan, öğe) ya da null (başka olay, eksik alan ya da bayat olay). */
export function parseRefusal(ev: RefusedEvent, nowS: number): { agent: string; item: string } | null {
  if (ev.type !== "clients.delete_refused") return null;
  if (typeof ev.ts === "number" && nowS - ev.ts > FRESH_S) return null;
  const agent = typeof ev.client === "string" && ev.client ? ev.client : "local";
  const res = typeof ev.resource === "string" ? ev.resource : "";
  const item = typeof ev.item === "string" && ev.item ? `${res}/${ev.item}` : res;
  return { agent, item: item || "?" };
}

/** Birleştirme: açık bildirim varsa sayaç artar ve öğe eklenir (kipli pencere / yığın yok); yoksa yeni bildirim. */
export function coalesce(prev: DeleteNotice | null, r: { agent: string; item: string }, nowMs: number): DeleteNotice {
  if (prev && nowMs < prev.until) {
    return { key: prev.key, count: prev.count + 1, until: nowMs + NOTICE_MS,
             agents: prev.agents.includes(r.agent) ? prev.agents : [...prev.agents, r.agent],
             items: prev.items.includes(r.item) ? prev.items : [...prev.items, r.item] };
  }
  return { key: nowMs, count: 1, agents: [r.agent], items: [r.item], until: nowMs + NOTICE_MS };
}

/** Görünen ajan adı: istemci adı ya da "yerel süreç". */
export function agentLabel(agent: string, localLabel: string): string {
  if (agent === "local") return localLabel;
  if (agent === "claude-code") return "Claude Code";
  if (agent === "codex") return "Codex";
  return agent;
}
