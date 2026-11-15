// CG-DELIVER — Çıktı teslimi istemcisi. Akış: hedefler → önizleme (birebir içerik + hedef) → kullanıcı onayı → teslim.
// REST: GET /api/delivery/targets?deliverable=&check= · POST /api/delivery/preview · POST /api/delivery/deliver ·
// PUT /api/delivery/settings · GET /api/deliverables/{id}/deliveries. POST/PUT yalnızca kullanıcı arayüzünden
// (sayfa jetonu `lib/presence.ts` ile her istekte eklenir; MCP 403).
// Canlı: `delivery.done {deliverable_id, target, ok, label, link, ref}`.
import { currentLocale } from "./i18n";
import { registerEventHandler } from "./store";
import { bodyText } from "./api";

export type TargetId = "folder" | "email_draft" | "github_pr" | "github_issue" | "notion" | "gdocs" | "slack"
  | "clipboard" | "download";

export interface McpServerChoice { id: string; name: string; ready: boolean; reason?: string | null }

export interface DeliveryTarget {
  id: TargetId; label: { tr: string; en: string }; external: boolean;
  available: boolean; ready: boolean | null; reason?: string | null; hint?: string;
  connect_hint?: string | null; modes?: string[]; mcp_servers?: McpServerChoice[];
}

export interface DeliverySettings { redact_pii: boolean; last_folder?: string | null; last_repo?: string | null }

export interface TargetsResponse {
  targets: DeliveryTarget[];
  suggested: { target: TargetId; options: Record<string, unknown>; label?: { tr: string; en: string } }[];
  settings: DeliverySettings;
}

export interface QualityDecision {
  action: "pass" | "warn" | "block"; reasons: string[]; score?: number | null; status?: string | null;
  summary?: string | null; error?: boolean;
}

export interface DeliveryCommand { cwd?: string; argv?: string[]; display: string; stdin?: string; write?: string; note?: string }

export interface DeliveryPayload {
  summary: string; content?: string | null; path?: string; exists?: boolean; overwrite?: boolean; format?: string;
  binary?: boolean; size?: number; warnings?: string[]; to?: string[]; cc?: string[]; subject?: string;
  mailto?: string; attachments?: string[]; sends?: boolean; title?: string; branch?: string; file?: string;
  diff?: string[]; commands?: DeliveryCommand[]; server?: string; server_name?: string; tool?: string;
  arguments?: Record<string, unknown>; filename?: string;
}

export interface DeliveryPreview {
  deliverable_id: string; target: TargetId; label: { tr: string; en: string }; external: boolean;
  options: Record<string, unknown>; payload: DeliveryPayload; preview_hash: string;
  quality: QualityDecision | null; pii_redacted: boolean;
}

export interface DeliveryRecord {
  id: string; deliverable_id: string; target: TargetId; preview_hash: string; approved_at: string;
  delivered_at: string; ok: boolean; result?: string; error?: string; link?: string | null; ref?: string | null;
  path?: string | null; label?: string; override_reason?: string | null;
}

export interface DeliverResult {
  ok: boolean; record: DeliveryRecord; client_action?: "copy" | "download" | "open"; content?: string;
  format?: string; link?: string;
}

export class DeliveryError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = bodyText(res.status, null);
    let code: string | undefined;
    try {
      const j = await res.json();
      msg = bodyText(res.status, j);
      code = typeof j.code === "string" ? j.code : undefined;
    } catch { /* gövde yok */ }
    throw new DeliveryError(res.status, msg, code);
  }
  return res.json() as Promise<T>;
}

const enc = encodeURIComponent;

export const deliveryApi = {
  targets: (deliverableId?: string, check = false) =>
    req<TargetsResponse>("GET", `/api/delivery/targets?${deliverableId ? `deliverable=${enc(deliverableId)}&` : ""}check=${check}`),
  preview: (deliverableId: string, target: TargetId, options: Record<string, unknown>) =>
    req<DeliveryPreview>("POST", "/api/delivery/preview", { deliverable_id: deliverableId, target, options }),
  deliver: (p: DeliveryPreview, overrideReason?: string) =>
    req<DeliverResult>("POST", "/api/delivery/deliver", {
      deliverable_id: p.deliverable_id, target: p.target, options: p.options, preview_hash: p.preview_hash,
      approved: true, ...(overrideReason ? { override_reason: overrideReason } : {}),
    }),
  settings: (patch: { redact_pii: boolean }) => req<DeliverySettings>("PUT", "/api/delivery/settings", patch),
  records: (deliverableId: string) =>
    req<{ items: DeliveryRecord[] }>("GET", `/api/deliverables/${enc(deliverableId)}/deliveries`),
};

/** Canlı teslim olayı (rozetler kendini tazeler). */
export function onDeliveryEvent(fn: (ev: { type: string; deliverable_id?: string } & Record<string, unknown>) => void): () => void {
  return registerEventHandler("delivery.", (ev) => fn(ev as { type: string; deliverable_id?: string } & Record<string, unknown>));
}
