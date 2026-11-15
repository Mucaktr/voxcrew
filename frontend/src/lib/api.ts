import { currentLocale, tx } from "./i18n";
import { sealedMsg } from "../locales/sealed";
import { errorMessage, isUnreachableStatus } from "./errorText";
import { reportServerUp } from "./serverHealth";
import { stripDerived } from "./presentation";
import type {
  Agent, ConnectionInfo, GraphEdge, GraphNode, GraphStats, OllamaModel, OntologyDef, Run, Settings, Workflow,
  WorkflowWarning,
} from "./types";

export class ApiError extends Error {
  status: number;
  /** sunucunun yapılandırılmış hata gövdesi (`detail`); ileti her zaman okunur metindir, JSON değil.*/
  detail: unknown;
  constructor(status: number, message: string, detail: unknown = null) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// G1-B: koşu açan isteklerde gönderim anahtarı. Aynı içerik kısa süre içinde (çift tıklama, ağ tekrarı)
// yeniden gönderilirse aynı anahtar gider; sunucu ilk koşuyu döner (`replayed: true`), ikinci koşu açılmaz.
const IDEM_WINDOW_MS = 10_000;
const recentIdem = new Map<string, { key: string; at: number }>();

function newIdemKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return `ui-${c.randomUUID()}`;
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** `scope` (uç) + gövde için gönderim anahtarı: aynı istek 10 sn içinde aynı anahtarı alır. */
export function idempotencyKey(scope: string, body: unknown): string {
  const now = Date.now();
  for (const [sig, v] of recentIdem) if (now - v.at > IDEM_WINDOW_MS) recentIdem.delete(sig);
  const sig = `${scope}|${JSON.stringify(body ?? null)}`;
  const hit = recentIdem.get(sig);
  if (hit) return hit.key;
  const key = newIdemKey();
  recentIdem.set(sig, { key, at: now });
  return key;
}

export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** ayrık değerlendirme sürerken gelen 423 (`code: "sealed"`) → anlaşılır TR/EN ileti; değilse null.*/
export function lockedText(status: number, body: unknown, kind: "download" | "change" = "change"): string | null {
  if (status !== 423) return null;
  const code = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
  if (code !== undefined && code !== "sealed") return null;
  return tx(sealedMsg, kind === "download" ? "locked_download" : "locked_change");
}

/** hata gövdesi → okunur ileti (423 mühür → kendi metni; `detail.message`; bilinen `code`; asla ham JSON).*/
export function bodyText(status: number, body: unknown): string {
  return lockedText(status, body) ?? errorMessage(status, body, currentLocale());
}

/** Gövdeden `detail` (nesne ya da dizgi; yoksa gövdenin kendisi). */
export function bodyDetail(body: unknown): unknown {
  return body && typeof body === "object" && "detail" in (body as object) ? (body as { detail: unknown }).detail : body;
}

/** Ağ hatası (sunucu kapalı, bağlantı koptu) tarayıcıda ham "Failed to fetch" TypeError'ı olarak gelir; okunur ApiError(0) olur. */
export async function fetchApi(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    reportServerUp(false);
    throw new ApiError(0, errorMessage(0, null, currentLocale()));
  }
  if (isUnreachableStatus(res.status)) reportServerUp(false); else reportServerUp(true);
  return res;
}

async function req<T>(method: string, url: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetchApi(url, {
    method,
    // X-Studio-Lang: sunucu hata iletilerini ve ajan istemlerini bu dilde üretir (Faz 5 i18n)
    headers: {
      "X-Studio-Lang": currentLocale(),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(extraHeaders ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail: unknown = null;
    let msg: string;
    try {
      const j = await res.json();
      detail = bodyDetail(j);
      msg = bodyText(res.status, j);
    } catch { msg = bodyText(res.status, null); /* gövde yok ya da JSON değil: ham "500 Internal Server Error" yok*/ }
    throw new ApiError(res.status, msg, detail);
  }
  return res.json() as Promise<T>;
}

export interface Overview {
  agents: Agent[];
  stats: GraphStats;
  runs: { running: number; done_today: number; failed_today: number; recent: Run[] };
  connections: ConnectionInfo[];
  scene: string;
}

export const api = {
  overview: () => req<Overview>("GET", "/api/overview"),
  agents: () => req<Agent[]>("GET", "/api/agents"),
  createAgent: (data: Partial<Agent>) => req<Agent>("POST", "/api/agents", data),
  // GIFTS-GENDER: adan türetilen görünüm alanları (presentationAuto) kaydedilmez; yalnız açık seçim yazılır
  updateAgent: (slug: string, data: Partial<Agent>) =>
    req<Agent>("PATCH", `/api/agents/${slug}`, data.avatar ? { ...data, avatar: stripDerived(data.avatar) } : data),
  deleteAgent: (slug: string) => req<{ ok: boolean }>("DELETE", `/api/agents/${slug}`),
  syncAgents: () => req<{ added: number; updated: number }>("POST", "/api/agents/sync"),
  agentMemory: (slug: string) => req<{ episodes: GraphNode[]; facts: GraphNode[] }>("GET", `/api/agents/${slug}/memory`),

  connections: (force = false) => req<ConnectionInfo[]>("GET", `/api/connections${force ? "?force=true" : ""}`),
  models: () => req<OllamaModel[]>("GET", "/api/ollama/models"),
  testConnection: (kind: string, model?: string) =>
    req<{ ok: boolean; text: string; error: string | null; ms: number; model?: string }>(
      "POST", `/api/connections/${kind}/test`, model ? { model } : {}),

  createTask: (data: { agent: string; prompt: string; title?: string; connection?: string; model?: string; memory?: boolean; remember?: boolean }) =>
    req<{ run_id: string; replayed?: boolean }>("POST", "/api/tasks", data,
      { [IDEMPOTENCY_HEADER]: idempotencyKey("tasks", data) }),
  runs: (limit = 60) => req<Run[]>("GET", `/api/runs?limit=${limit}`),
  run: (id: string) => req<Run>("GET", `/api/runs/${id}`),
  cancelRun: (id: string) => req<{ ok: boolean }>("POST", `/api/runs/${id}/cancel`),
  decide: (id: string, step: string, approved: boolean, note = "") =>
    req<{ ok: boolean }>("POST", `/api/runs/${id}/steps/${step}/decision`, { approved, note }),

  workflows: () => req<Workflow[]>("GET", "/api/workflows"),
  saveWorkflow: (wf: Workflow) => req<Workflow>("PUT", `/api/workflows/${wf.slug}`, wf),
  deleteWorkflow: (slug: string) => req<{ ok: boolean }>("DELETE", `/api/workflows/${slug}`),
  // sunucu zayıf yazar uyarısı da döner (boyutu adda olmayan yerel model: Ollama ayrıntısı ya da "küçük olabilir")
  validateWorkflow: (wf: Workflow) => req<{ ok: boolean; errors: string[]; warnings?: WorkflowWarning[] }>("POST", "/api/workflows/validate", wf),
  // FOLLOWUP: bütçe tavanı koşuyla birlikte (kullanıcı-yalnız; MCP 403) — sonradan PATCH yarışı yok
  // PROC-FIX P2: beklenen çıktı ve süre sınırı (ikisi de kullanıcı-yalnız; MCP 403)
  runWorkflow: (slug: string, inputs: Record<string, string>, budget?: Record<string, unknown>,
                opts?: { expected_output?: string; deadline_min?: number }) => {
    const body = { inputs, ...(budget ? { budget } : {}),
      ...(opts?.expected_output ? { expected_output: opts.expected_output } : {}),
      ...(opts?.deadline_min ? { deadline_min: opts.deadline_min } : {}) };
    return req<{ run_id: string; replayed?: boolean }>("POST", `/api/workflows/${slug}/run`, body,
      { [IDEMPOTENCY_HEADER]: idempotencyKey(`workflow:${slug}`, body) });
  },

  ontology: () => req<OntologyDef>("GET", "/api/ontology"),
  graph: (types: string[] = [], limit = 600) =>
    req<{ nodes: GraphNode[]; edges: GraphEdge[]; stats: GraphStats }>(
      "GET", `/api/graph?limit=${limit}${types.length ? `&types=${types.join(",")}` : ""}`),
  node: (id: string) => req<{ node: GraphNode & { updated_at?: string }; neighbors: { edge: GraphEdge; dir: "in" | "out"; node: GraphNode }[] }>(
    "GET", `/api/graph/node/${id}`),
  recall: (q: string, agent?: string) =>
    req<{ text: string; items: { id: string; type: string; label: string; agent?: string; via?: string; score: number }[] }>(
      "GET", `/api/memory/recall?q=${encodeURIComponent(q)}${agent ? `&agent=${agent}` : ""}`),

  factState: (id: string, patch: { pinned?: boolean; invalid?: boolean; reason?: string }) =>
    req<GraphNode>("POST", `/api/memory/facts/${id}`, patch),
  file: (path: string) =>
    req<{ name: string; size: number; kind: "markdown" | "text" | "binary"; text: string | null; truncated: boolean }>(
      "GET", `/api/files?path=${encodeURIComponent(path)}`),
  settings: () => req<Settings>("GET", "/api/settings"),
  saveSettings: (patch: Partial<Settings>) => req<Settings>("PUT", "/api/settings", patch),
};
