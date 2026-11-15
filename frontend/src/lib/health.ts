// FAZB1 — Sistem sağlığı: /api/health/details istemcisi ve `health.alert` olayının bildirim akışına bağlanması.
import { bodyText } from "./api";
import { currentLocale, fmtNumber, tx } from "./i18n";
import { notify, registerEventHandler, useStudio } from "./store";
import { healthMsg } from "../locales/health";

export type InvariantId = "EVT-REG" | "CDC-LAG" | "CDC-ERR" | "WAL-SIZE" | "BUS-LOSS" | "DISK-FREE" | "ERR-RATE";
export interface Invariant { id: InvariantId; ok: boolean; value: unknown; limit?: number }
export interface CdcConsumerStatus {
  consumer: string; registered: boolean; last_seen_id: number | null; head: number | null; lag: number | null;
  processed: number; resyncs: number; errors: number; last_error: string | null; last_error_at: number | null;
  updated_at: number | null;
}
export interface HealthDetails {
  at: number;
  uptime_s: number;
  databases: { name: string; bytes: number; wal_bytes: number }[];
  total_bytes: number;
  disk_free_bytes: number | null;
  cdc: CdcConsumerStatus[];
  events: { bus_last_1h: number | null; bus_last_24h: number | null;
            graph_changes: { last_1h: number | null; last_24h: number | null };
            unregistered: Record<string, number> };
  errors: { last_1h: number; recent: { ts: number; logger: string; level: string; message: string }[] };
  runs: { live: number; by_status: Record<string, number>; awaiting_human: number; queued: number;
          slots: Record<string, { free: number; waiting: number }> };
  invariants: Invariant[];
  alerts: InvariantId[];
  /** FAZB2: settings.json + iş akışı YAML değişiklikleri (değer yok; yalnız anahtar yolu, aktör, zaman). */
  config_changes?: ConfigChange[];
}
export interface ConfigChange {
  id: number; ts: number; actor: string; file: string; op: "create" | "update" | "delete"; hash: string | null;
  keys: string[]; n_keys: number;
}

/** Aktör kimliği → okunur ad (`user`, `file`, `system`, `mcp:<istemci>`, `agent:<slug>`). */
export function configActor(actor: string): string {
  const [kind, ...rest] = actor.split(":");
  const name = rest.join(":");
  if (kind === "user") return tx(healthMsg, "config_actor_user");
  if (kind === "file") return tx(healthMsg, "config_actor_file");
  if (kind === "mcp") return tx(healthMsg, "config_actor_mcp", { name });
  if (kind === "agent") return tx(healthMsg, "config_actor_agent", { name });
  return tx(healthMsg, "config_actor_system");
}

export async function fetchHealth(): Promise<HealthDetails> {
  const res = await fetch("/api/health/details", { headers: { "X-Studio-Lang": currentLocale() } });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = bodyText(res.status, await res.json()); } catch { /* boş */ }
    throw new Error(msg);
  }
  return res.json() as Promise<HealthDetails>;
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${fmtNumber(v, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${u[i]}`;
}

/** Değişmezin değerini kısa metne çevirir (bayt, liste, sayı). */
export function invariantValue(inv: { id: string; value: unknown }): string {
  const v = inv.value;
  if (inv.id === "DISK-FREE") return fmtBytes(typeof v === "number" ? v : null);
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "number") return fmtNumber(v);
  return "";
}

export function invariantText(inv: { id: string; ok: boolean; value?: unknown }): string {
  const key = `inv_${inv.id.replace("-", "_")}${inv.ok ? "" : "_bad"}` as keyof typeof healthMsg.tr & string;
  return tx(healthMsg, key, { value: invariantValue({ id: inv.id, value: inv.value }) });
}

let wired = false;
/** Bir kez bağlanır (App kabuğu): `health.alert` → olay akışı + (sekme arka plandaysa) masaüstü bildirimi. */
export function wireHealthAlerts(): void {
  if (wired) return;
  wired = true;
  registerEventHandler("health.alert", (ev) => {
    const failing = ev.state === "failing";
    const line = invariantText({ id: String(ev.id), ok: !failing, value: ev.value });
    useStudio.setState((st) => ({
      feed: [{ id: -Math.round(ev.ts * 1000), ts: ev.ts * 1000, kind: failing ? "error" as const : "run" as const,
               text: `${tx(healthMsg, failing ? "alert_title" : "alert_resolved")} — ${line}` }, ...st.feed].slice(0, 80),
    }));
    if (failing) notify(tx(healthMsg, "alert_title"), `${line}. ${tx(healthMsg, "alert_open")}`);
  });
}
