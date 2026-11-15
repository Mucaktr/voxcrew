import { common } from "../locales/common";
import { cx } from "../locales/connections";
import { tx } from "./i18n";
import type { Mood } from "./types";

export function timeAgo(iso?: string | number | null): string {
  if (!iso) return "";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return tx(common, "just_now");
  if (s < 3600) return tx(common, "min_ago", { n: Math.round(s / 60) });
  if (s < 86400) return tx(common, "hour_ago", { n: Math.round(s / 3600) });
  return tx(common, "day_ago", { n: Math.round(s / 86400) });
}

export function duration(ms?: number | null): string {
  if (ms == null) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return tx(common, "sec", { n: s });
  return tx(common, "min_sec", { m: Math.floor(s / 60), s: s % 60 });
}

export function between(a?: string | null, b?: string | null): number | null {
  if (!a) return null;
  const end = b ? Date.parse(b) : Date.now();
  return end - Date.parse(a);
}

export function bytes(n?: number): string {
  if (!n) return "";
  return n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;
}

const STATUS_TONES: Record<string, string> = {
  pending: "muted", running: "info", awaiting_approval: "warn", awaiting_tool_approval: "warn", done: "ok",
  failed: "bad", rejected: "bad", skipped: "muted", cancelled: "muted", interrupted: "muted", paused: "warn",
};
/** Durum etiketi ve tonu; etiket şu anki dilde (getter). */
export const STATUS: Record<string, { label: string; tone: string }> = Object.fromEntries(
  Object.entries(STATUS_TONES).map(([k, tone]) => [k, {
    tone, get label() { return tx(common, `status_${k}` as keyof typeof common.tr); },
  }]),
);

const MOODS: Mood[] = ["idle", "thinking", "working", "waiting", "done", "error", "offline"];
export const MOOD_LABEL = Object.defineProperties({} as Record<Mood, string>, Object.fromEntries(
  MOODS.map((k) => [k, { enumerable: true, get: () => tx(common, `mood_${k}` as keyof typeof common.tr) }]),
)) as Record<Mood, string>;

export function moodOf(state?: string, available = true): Mood {
  if (!available) return "offline";
  if (state === "thinking" || state === "working" || state === "done" || state === "error" || state === "waiting") return state;
  return "idle";
}

export const CONNECTION_META: Record<string, { label: string; short: string; color: string; desc: string }> = {
  ollama: { label: "Ollama", short: "Ollama", color: "#4F9E30", get desc() { return tx(common, "conn_ollama"); } },
  codex: { label: "GPT Codex", short: "Codex", color: "#3E8ED0", get desc() { return tx(common, "conn_codex"); } },
  claude: { label: "Claude Code", short: "Claude", color: "#C8663F", get desc() { return tx(common, "conn_claude"); } },
  // S37: adlandırılmış model API bağlantısı (Mistral, Claude API, LM Studio…); rota etiketi uç nokta adını gösterir
  openai_compat: {
    get label() { return tx(cx, "conn_api_label"); }, get short() { return tx(cx, "conn_api_short"); },
    color: "#2A9D8F", get desc() { return tx(cx, "conn_api_desc"); },
  },
  profile: {
    get label() { return tx(common, "conn_profile_label"); }, get short() { return tx(common, "conn_profile_short"); },
    color: "#8E6CEF", get desc() { return tx(common, "conn_profile"); },
  },
};

export function sameModel(a?: string | null, b?: string | null) {
  const n = (x?: string | null) => (x || "").replace(/:latest$/, "");
  return !!a && !!b && n(a) === n(b);
}
