// bellek ad alanları (projeler arası bellek izolasyonu) istemcisi.
// Ad alanı: "global" ya da "project:<anahtar>" (anahtar ^[a-z0-9][a-z0-9_-]{0,40}$). Sunucu çıplak anahtarı da kabul eder.
// REST: GET /api/memory/namespaces · GET /api/memory/recall?q=&agent=&project= · GET /api/graph?…&project= ·
// GET /api/agents/{slug}/memory?project= · POST /api/memory/facts/{id} {…, project?} ·
// POST /api/memory/facts/{id}/(verify|dispute|correct|promote) · GET /api/memory/facts/{id}/history ·
// POST /api/tasks {…, project?} · POST /api/workflows/{slug}/run {inputs, project?} · hedef gövdeleri {project?}.
import { useEffect, useState } from "react";
import { ApiError, bodyText } from "./api";
import { currentLocale, tx } from "./i18n";
import type { GraphEdge, GraphNode, GraphStats } from "./types";
import { memoryMsg } from "../locales/memory";

export const GLOBAL_NS = "global";
const PREFIX = "project:";
const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const LONG_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/; // grafta Project düğümü olan (izleyici) anahtarlar
const LAST_KEY = "vc-memory-project"; // oturum başına son seçilen proje (sessionStorage)

export interface MemoryNamespace {
  namespace: string;
  key: string | null;
  name: string | null;
  /** grafta Project düğümü var mı */
  project: boolean;
  episodes: number;
  facts: number;
}

export interface RecallItem {
  id: string; type: string; label: string; agent?: string; namespace?: string; score?: number; via?: string;
  // iddia alanları (yalnız Fact); confidence = model tahmini (sıralama ipucu, kesinlik değil)
  visibility?: FactVisibility; origin?: FactOrigin; epistemic_status?: FactStatus; trust?: FactTrust;
  lifecycle?: FactLifecycle; valid_from?: string | null; valid_to?: string | null; confidence?: number | null;
}

// bellek iddiası v1 (backend/studio/graph/assertion.py)
export type FactOrigin = "user_stated" | "agent_inferred" | "tool_observed" | "imported";
export type FactStatus = "asserted" | "inferred" | "verified" | "disputed";
export type FactTrust = "trusted" | "untrusted";
export type FactVisibility = "private" | "shared";
export type FactLifecycle = "active" | "superseded" | "invalid";

/** Fact düğümünün iddia görünümü: alanı olmayan eski bilgi sunucudaki göç varsayılanlarıyla okunur. */
export interface FactClaim {
  origin: FactOrigin; status: FactStatus; trust: FactTrust; visibility: FactVisibility; lifecycle: FactLifecycle;
  validFrom: string | null; validTo: string | null; recordedFrom: string | null; recordedTo: string | null;
  version: number; confidence: number | null;
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : dflt);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function factClaim(props: Record<string, unknown>): FactClaim {
  const origin = pick(props.origin, ["user_stated", "agent_inferred", "tool_observed", "imported"] as const,
    props.source ? "imported" : "agent_inferred");
  return {
    origin,
    status: pick(props.epistemic_status, ["asserted", "inferred", "verified", "disputed"] as const, "asserted"),
    trust: pick(props.trust, ["trusted", "untrusted"] as const, origin === "user_stated" ? "trusted" : "untrusted"),
    visibility: pick(props.visibility, ["private", "shared"] as const, "shared"),
    lifecycle: pick(props.lifecycle, ["active", "superseded", "invalid"] as const, props.invalid_at ? "invalid" : "active"),
    validFrom: str(props.valid_from), validTo: str(props.valid_to),
    recordedFrom: str(props.recorded_from) ?? str(props.valid_at) ?? str(props.created_at), recordedTo: str(props.recorded_to),
    version: typeof props.version === "number" ? props.version : 1,
    confidence: typeof props.confidence === "number" ? props.confidence : null,
  };
}

export interface FactHistoryItem {
  id: string; statement: string | null; rel: "SUPERSEDES" | "CORRECTS" | "CONTRADICTS" | "DERIVED_FROM" | null;
  dir: "in" | "out" | null; epistemic_status?: FactStatus; lifecycle?: FactLifecycle; visibility?: FactVisibility;
}

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

/** "project:acme" → "acme"; global/boş → null. */
export function keyOf(ns: string | null | undefined): string | null {
  return ns && ns.startsWith(PREFIX) ? ns.slice(PREFIX.length) : null;
}

/** Kullanıcı girdisi → kanonik ad alanı; boş → "global"; geçersiz → null. `known`: grafta Project düğümü olan anahtarlar. */
export function toNamespace(input: string, known?: ReadonlySet<string>): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw || raw === GLOBAL_NS) return GLOBAL_NS;
  const key = raw.startsWith(PREFIX) ? raw.slice(PREFIX.length) : raw;
  if (KEY_RE.test(key) || (LONG_KEY_RE.test(key) && known?.has(key))) return PREFIX + key;
  return null;
}

/** Rozet/seçici etiketi: global → "Genel" / "Global", proje → anahtar. */
export function nsLabel(ns: string | null | undefined): string {
  return keyOf(ns) ?? tx(memoryMsg, "ns_global");
}

export function getLastProject(): string {
  try { return sessionStorage.getItem(LAST_KEY) ?? ""; } catch { return ""; }
}

export function setLastProject(key: string): void {
  try {
    if (key) sessionStorage.setItem(LAST_KEY, key);
    else sessionStorage.removeItem(LAST_KEY);
  } catch { /* gizli pencere vb. */ }
}

const q = (params: Record<string, string | number | undefined | null>) =>
  Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

export const memoryApi = {
  namespaces: () => req<{ isolation: boolean; namespaces: MemoryNamespace[] }>("GET", "/api/memory/namespaces"),
  /** project verilmezse tüm graf (yönetici gezgini); verilirse bellek düğümleri yalnızca o ad alanından. */
  graph: (types: string[], limit = 400, project?: string | null) =>
    req<{ nodes: GraphNode[]; edges: GraphEdge[]; stats: GraphStats }>(
      "GET", `/api/graph?${q({ types: types.join(","), limit, project: project || undefined })}`),
  recall: (text: string, agent?: string, project?: string | null) =>
    req<{ text: string; items: RecallItem[]; namespace: string }>(
      "GET", `/api/memory/recall?${q({ q: text, agent, project: project || undefined })}`),
  agentMemory: (slug: string, project?: string | null) =>
    req<{ namespace: string; isolation: boolean; episodes: GraphNode[]; facts: GraphNode[] }>(
      "GET", `/api/agents/${encodeURIComponent(slug)}/memory?${q({ project: project || undefined })}`),
  factState: (id: string, patch: { pinned?: boolean; invalid?: boolean; reason?: string }, project?: string | null) =>
    req<GraphNode>("POST", `/api/memory/facts/${encodeURIComponent(id)}`, { ...patch, ...(project ? { project } : {}) }),
  // iddia işlemleri (yalnız kullanıcı; MCP 403). expectedVersion bayatsa 409 (eşzamanlı değişiklik).
  verifyFact: (id: string, expectedVersion?: number, project?: string | null) =>
    req<GraphNode>("POST", `/api/memory/facts/${encodeURIComponent(id)}/verify`,
      { expected_version: expectedVersion, ...(project ? { project } : {}) }),
  disputeFact: (id: string, reason: string, expectedVersion?: number, project?: string | null) =>
    req<{ fact: GraphNode; counter: GraphNode | null }>("POST", `/api/memory/facts/${encodeURIComponent(id)}/dispute`,
      { reason, expected_version: expectedVersion, ...(project ? { project } : {}) }),
  correctFact: (id: string, statement: string, expectedVersion?: number, project?: string | null) =>
    req<{ old: GraphNode; new: GraphNode | null }>("POST", `/api/memory/facts/${encodeURIComponent(id)}/correct`,
      { statement, expected_version: expectedVersion, ...(project ? { project } : {}) }),
  promoteFact: (id: string, project?: string | null) =>
    req<GraphNode>("POST", `/api/memory/facts/${encodeURIComponent(id)}/promote`, project ? { project } : {}),
  factHistory: (id: string) =>
    req<{ id: string; items: FactHistoryItem[] }>("GET", `/api/memory/facts/${encodeURIComponent(id)}/history`),
  createTask: (data: { agent: string; prompt: string; title?: string; connection?: string; model?: string;
    memory?: boolean; remember?: boolean; project?: string; origin?: "ui";
    // beklenen çıktı → kabul ölçütü (kullanıcı-yalnız; MCP 403)
    expected_output?: string;
    // WORK-ZONES: çalışma bölgesi (`<sahne>:<ofis>`; kullanıcı-yalnız; MCP 403)
    work_zone?: string;
    // CG-COST: başlangıç bütçe tavanı (kullanıcı-yalnız; MCP 403)
    budget?: { tokens?: number; cost_usd?: number; on_exceeded?: "ask" | "pause" | "stop" } }) =>
    req<{ run_id: string }>("POST", "/api/tasks", data),
  runWorkflow: (slug: string, inputs: Record<string, string>, project?: string | null) =>
    req<{ run_id: string }>("POST", `/api/workflows/${encodeURIComponent(slug)}/run`,
      { inputs, ...(project ? { project } : {}) }),
};

const EMPTY: MemoryNamespace[] = [];

/** Bilinen ad alanları (seçiciler için). `enabled` false iken istek atılmaz. Hata → boş liste. */
export function useNamespaces(enabled = true, refreshKey: unknown = 0): { list: MemoryNamespace[]; isolation: boolean } {
  const [state, setState] = useState<{ list: MemoryNamespace[]; isolation: boolean }>({ list: EMPTY, isolation: true });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    memoryApi.namespaces()
      .then((r) => { if (live) setState({ list: r.namespaces, isolation: r.isolation }); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [enabled, refreshKey]);
  return state;
}
