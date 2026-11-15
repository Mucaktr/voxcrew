// Ekip S25 — zamanlayıcı: türler, /api/schedules istemcisi, canlı depo ve "schedule." olay bağlantısı.
// Yalnızca stüdyo çalışırken tetiklenir; gözetimsiz onay politikası yalnızca pause | deny (approve yok).
import { create } from "zustand";
import { scheduleMsg } from "../locales/schedule";
import { currentLocale, fmtDate, tx } from "./i18n";
import { notify, registerEventHandler } from "./store";
import { bodyText } from "./api";

// ---------------------------------------------------------------- türler
export type ScheduleKind = "cron" | "interval" | "once" | "webhook" | "file_watch" | "heartbeat" | "email_label" | "meeting_end";
export const SCHEDULE_KINDS: ScheduleKind[] = ["cron", "interval", "once", "webhook", "file_watch", "heartbeat", "email_label", "meeting_end"];
/** CG2: olayla tetiklenen türler (son tetik / sonraki denetim / hata gösterilir) */
export const TRIGGER_KINDS: ScheduleKind[] = ["file_watch", "email_label", "meeting_end"];

export type ScheduleTarget =
  | { type: "task"; agent: string; prompt: string }
  | { type: "workflow"; workflow: string; inputs?: Record<string, string>; trigger_input?: string }
  | { type: "recipe"; recipe: string; inputs?: Record<string, string>; trigger_input?: string }
  | { type: "goal"; goal_id: string };

export type ApprovalPolicy = "pause" | "deny";
export type ConcurrencyPolicy = "skip_if_running" | "queue";
export type CatchUpPolicy = "once" | "skip";

export interface ScheduleBudget { tokens?: number; cost_usd?: number; minutes?: number; steps?: number; on_exceeded?: string }

export interface SchedulePolicy {
  approvals: ApprovalPolicy;
  concurrency: ConcurrencyPolicy;
  catch_up: CatchUpPolicy;
  budget?: ScheduleBudget;
}

export interface ScheduleSpec {
  cron?: string;
  every_s?: number;
  at?: string;
  path?: string;
  glob?: string;
  stuck_min?: number;
  /** CG2 klasör: dosya bu kadar saniye değişmeden kalınca tetikler */
  debounce_s?: number;
  /** CG2 e-posta / toplantı: kullanıcının MCP sunucusu */
  server?: string;
  label?: string;
  match?: "keyword" | "event";
  keyword?: string;
  event_id?: string;
  event_title?: string;
  calendar?: string;
}

export interface ScheduleRun {
  id: string;
  title?: string | null;
  kind?: string | null;
  status?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface Schedule {
  id: string;
  title: string;
  kind: ScheduleKind;
  spec: ScheduleSpec;
  target: ScheduleTarget | null;
  policy: SchedulePolicy;
  enabled: boolean;
  created_at?: string | null;
  created_by?: string | null;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_status?: string | null;
  recent_runs: ScheduleRun[];
  /** CG2 tetikleyiciler: son tetik, son ve sonraki denetim, son hata */
  last_fired_at?: string | null;
  last_check_at?: string | null;
  next_check_at?: string | null;
  last_error?: string | null;
  /** sonraki denetimi bekleyen olay sayısı*/
  waiting?: number;
  /** Dalga 3: stüdyo kapalıyken olan olaylar (son açılış) — "kapalıyken kaçırıldı: N" */
  missed_offline?: { count: number; policy: "once" | "skip"; at: string } | null;
  /** yalnızca webhook */
  token_set?: boolean;
  trigger_url?: string;
}

export interface ScheduleInput {
  title?: string;
  kind?: ScheduleKind;
  spec?: ScheduleSpec;
  target?: ScheduleTarget | null;
  policy?: Partial<SchedulePolicy>;
  enabled?: boolean;
}

/** Oluşturma/jeton yenileme yanıtı: webhook jetonu yalnızca burada, bir kez döner. */
export type ScheduleWithToken = Schedule & { token?: string };

export interface ScheduleListResponse { schedules: Schedule[]; enabled: boolean; tick_s: number; running: boolean }
/** CG2: e-posta/takvim tetikleyicisine uygun MCP sunucusu (önbellekten; süreç başlatılmaz) */
export interface TriggerSource { id: string; name: string; service: "email" | "calendar"; tool: string | null; ready: boolean; reason: string | null }
export interface TriggerSources { sources: TriggerSource[]; folder_debounce_s: number; mcp_every_s: { min: number; default: number } }
export interface CalendarEvent { id: string; title: string; start: string | null; end: string }

export interface RunNowResult { ok: boolean; schedule_id: string; run_id?: string; queued?: number; skipped?: string; error?: string }

// ---------------------------------------------------------------- istemci
export class ScheduleApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
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
    throw new ScheduleApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

const enc = encodeURIComponent;

export const scheduleApi = {
  list: () => req<ScheduleListResponse>("GET", "/api/schedules"),
  get: (id: string) => req<Schedule>("GET", `/api/schedules/${enc(id)}`),
  create: (data: ScheduleInput) => req<ScheduleWithToken>("POST", "/api/schedules", data),
  update: (id: string, data: ScheduleInput) => req<ScheduleWithToken>("PATCH", `/api/schedules/${enc(id)}`, data),
  remove: (id: string) => req<{ ok: boolean; id: string }>("DELETE", `/api/schedules/${enc(id)}`),
  runNow: (id: string) => req<RunNowResult>("POST", `/api/schedules/${enc(id)}/run`),
  regenerateToken: (id: string) => req<ScheduleWithToken>("POST", `/api/schedules/${enc(id)}/token`),
  // CG2: tetikleyici kaynakları ve toplantı seçimi (salt okuma; etkinlik listesi yalnız arayüzden)
  sources: () => req<TriggerSources>("GET", "/api/schedules/sources"),
  events: (server: string) => req<{ tool: string; events: CalendarEvent[] }>("POST", `/api/schedules/sources/${enc(server)}/events`),
  // genel `schedule.enabled` anahtarı korunan ayar yolundan yazılır (yalnız arayüz; MCP yazamaz)
  setSchedulerEnabled: (on: boolean) => req<unknown>("PUT", "/api/settings", { schedule: { enabled: on } }),
};

// ---------------------------------------------------------------- canlı depo
interface ScheduleState {
  items: Schedule[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  enabled: boolean;
  tickS: number;
  running: boolean;
  refresh: () => Promise<void>;
  upsert: (s: Schedule) => void;
  drop: (id: string) => void;
}

export const useSchedules = create<ScheduleState>((set) => ({
  items: [],
  loaded: false,
  loading: false,
  error: null,
  enabled: true,
  tickS: 30,
  running: false,
  refresh: async () => {
    set({ loading: true });
    try {
      const res = await scheduleApi.list();
      set({ items: res.schedules, enabled: res.enabled, tickS: res.tick_s, running: res.running, loaded: true, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loaded: true });
    } finally {
      set({ loading: false });
    }
  },
  upsert: (s) => set((st) => {
    const i = st.items.findIndex((x) => x.id === s.id);
    if (i < 0) return { items: [s, ...st.items] };
    const items = st.items.slice();
    items[i] = s;
    return { items };
  }),
  drop: (id) => set((st) => ({ items: st.items.filter((x) => x.id !== id) })),
}));

// Olaylar: schedule.changed → depo; schedule.paused_run / schedule.heartbeat → masaüstü bildirimi (mevcut notify)
const offScheduleEvents = registerEventHandler("schedule.", (ev) => {
  const st = useSchedules.getState();
  switch (ev.type) {
    case "schedule.changed": {
      const sched = ev.schedule as Schedule | undefined;
      if (ev.deleted) st.drop(String(ev.schedule_id));
      else if (sched && st.loaded) st.upsert(sched);
      break;
    }
    case "schedule.paused_run":
      notify(tx(scheduleMsg, "notify_paused"), tx(scheduleMsg, "notify_paused_body", { title: String(ev.title ?? ev.schedule_id ?? "") }));
      break;
    case "schedule.heartbeat":
      notify(tx(scheduleMsg, "notify_heartbeat"), tx(scheduleMsg, "notify_heartbeat_body", {
        approvals: Number(ev.approvals ?? 0), stuck: Number(ev.stuck ?? 0), files: Number(ev.new_files ?? 0) }));
      break;
    default:
      break;
  }
});
if (import.meta.hot) import.meta.hot.dispose(() => offScheduleEvents());

// ---------------------------------------------------------------- yardımcılar
export const DEFAULT_POLICY: SchedulePolicy = { approvals: "pause", concurrency: "skip_if_running", catch_up: "once" };

export const CRON_EXAMPLES: { expr: string; key: "cron_ex_15m" | "cron_ex_daily" | "cron_ex_weekdays" | "cron_ex_friday" | "cron_ex_monthly" }[] = [
  { expr: "*/15 * * * *", key: "cron_ex_15m" },
  { expr: "0 8 * * *", key: "cron_ex_daily" },
  { expr: "0 9 * * 1-5", key: "cron_ex_weekdays" },
  { expr: "0 18 * * 5", key: "cron_ex_friday" },
  { expr: "0 7 1 * *", key: "cron_ex_monthly" },
];

/** İstemci tarafı hızlı denetim (asıl doğrulama sunucuda): 5 boşlukla ayrılmış alan ve izinli karakterler. */
export function cronLooksValid(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => /^[\w*,/-]+$/.test(p));
}

/** Saniyeyi en büyük tam birime çevirir: {value, unit}. */
export function splitInterval(seconds: number): { value: number; unit: "m" | "h" | "d" } {
  if (seconds % 86400 === 0) return { value: seconds / 86400, unit: "d" };
  if (seconds % 3600 === 0) return { value: seconds / 3600, unit: "h" };
  return { value: Math.max(1, Math.round(seconds / 60)), unit: "m" };
}

export const UNIT_SECONDS = { m: 60, h: 3600, d: 86400 } as const;

export function intervalLabel(seconds: number): string {
  const { value, unit } = splitInterval(seconds);
  return tx(scheduleMsg, unit === "d" ? "every_n_days" : unit === "h" ? "every_n_hours" : "every_n_minutes", { n: value });
}

/** Zamanlamanın ne zaman çalıştığına dair kısa özet (liste satırı). */
export function whenLabel(s: Schedule): string {
  switch (s.kind) {
    case "cron": {
      const ex = CRON_EXAMPLES.find((e) => e.expr === s.spec.cron);
      return ex ? tx(scheduleMsg, ex.key) : tx(scheduleMsg, "when_cron", { expr: s.spec.cron ?? "" });
    }
    case "interval":
      return intervalLabel(s.spec.every_s ?? 60);
    case "once":
      return s.spec.at ? tx(scheduleMsg, "when_once", { at: fmtDate(s.spec.at, { dateStyle: "medium", timeStyle: "short" }) }) : "—";
    case "webhook":
      return tx(scheduleMsg, "when_webhook");
    case "file_watch":
      return tx(scheduleMsg, "when_file_watch", { path: s.spec.path ?? ".", glob: s.spec.glob ?? "*" });
    case "heartbeat":
      return tx(scheduleMsg, "when_heartbeat", { every: intervalLabel(s.spec.every_s ?? 900) });
    case "email_label":
      return tx(scheduleMsg, "when_email_label", { label: s.spec.label ?? "" });
    case "meeting_end":
      return s.spec.match === "event"
        ? tx(scheduleMsg, "when_meeting_event", { title: s.spec.event_title || s.spec.event_id || "" })
        : tx(scheduleMsg, "when_meeting_keyword", { keyword: s.spec.keyword ?? "" });
    default:
      return "";
  }
}

/** Örnek curl komutu (webhook). Jeton yalnızca oluşturma/yenilemede görünür; yoksa yer tutucu. */
export function curlExample(id: string, token?: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin.replace("localhost", "127.0.0.1") : "http://127.0.0.1:7420";
  return `curl -X POST ${origin}/api/triggers/${id} \\\n  -H "X-Trigger-Token: ${token ?? "<TOKEN>"}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"inputs": {}}'`;
}

/** Son durum için ton (StatusPill dışındaki durumlar dahil). */
export const LAST_STATUS_TONE: Record<string, string> = {
  running: "info", done: "ok", failed: "bad", cancelled: "muted", paused: "warn", skipped: "muted", queued: "info",
  error: "bad", missed: "muted", quiet: "muted", notified: "info", interrupted: "muted", missed_budget: "warn",
};
