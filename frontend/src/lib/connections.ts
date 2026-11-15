// S29 — tek bağlantı durumu modeli: türler, /api/connections istemcisi ve yardımcılar.
// Store'daki `connections` dizisi sunucudan bu şekille gelir; eski ConnectionInfo alanları korunur, bu tür onu genişletir.
import { useMemo } from "react";
import { create } from "zustand";
import { api, bodyText } from "./api";
import { currentLocale, fmtNumber, useLocale } from "./i18n";
import { useStudio } from "./store";
import type { ConnectionInfo } from "./types";

export type ProviderKind = "hermes" | "ollama" | "codex" | "claude" | "openai_compat" | "gemini";
export type Ready = "ok" | "needs_action" | "unavailable" | "checking" | "soon";

export interface Fix {
  kind: "button" | "command" | "link";
  label: string;
  action?: string;
  args?: Record<string, unknown>;
  command?: string;
  url?: string;
  /** SETUP: arayüzde açılacak kurulum rehberi (codex | claude | hermes | ollama); yoksa `url` açılır */
  guide?: string;
}

export interface Problem {
  code: string;
  severity: "block" | "warn" | "info";
  message: string;
  params: Record<string, unknown>;
  fix: Fix | null;
}

export interface ModelsReady {
  count: number;
  names?: string[];
  tools?: string[];
  hermes_ready?: string[];
  loaded?: string[];
  total?: number;
}

export interface GatewayBrief {
  state: string; port: number; url: string; can_start: boolean; start_blocker: string | null; key_present: boolean;
}

export interface HermesCandidate {
  path: string; source: string; sources: string[]; exists: boolean; looks_like_home: boolean;
  runner: string | null; version: string | null; profiles: string[]; recommended: boolean;
}

/** Hermes profilinin model özeti (yalnız config.yaml `model` bölümü; anahtar/adres yok). */
export interface HermesProfileModel { profile: string; provider: string; model: string; local: boolean; cloud: boolean }

/** POST /hermes/home {preview:true}: yazmadan önizleme — yalnızca stüdyo ayarı değişir, Hermes klasörüne yazılmaz. */
export interface HermesHomePreview {
  setting: "hermes_home"; from: string; to: string; changed: boolean; writes: "studio_settings"; touches_folder: false;
  looks_like_home: boolean; runner: string | null; version: string | null; profiles: string[];
}

export interface ConnectionState extends Omit<ConnectionInfo, "kind"> {
  kind: ProviderKind;
  optional?: boolean;
  state_version: number;
  checking: boolean;
  installed: boolean | null;
  install_path: string | null;
  runner_running: boolean | null;
  service_reachable: boolean | null;
  session_valid: boolean | null;
  models_ready: ModelsReady | null;
  fit_for_task: string;
  last_check: number | null;
  timeout: boolean;
  problems: Problem[];
  ready: Ready;
  extra: Record<string, unknown> & {
    home?: string; home_ok?: boolean; profiles?: string[]; candidates?: HermesCandidate[]; better_candidate?: string | null;
    profile_models?: HermesProfileModel[]; test_profile?: string;
    url?: string; env_url?: string | null; url_mismatch?: boolean; managed?: boolean; exe_found?: boolean;
    session_hint?: string | null; logged_in?: boolean | null; login_cmd?: string;
    config?: { enabled: boolean; base_url: string; label: string; model: string; api_key_masked: string | null; has_key: boolean; local: boolean; id?: string | null };
    discovered?: { label: string; base_url: string }[];
    endpoints?: Endpoint[];
    default_endpoint?: string | null;
    coming_soon?: boolean;
  };
  gateway?: GatewayBrief;
}

/** Store tipi için: ConnectionInfo'ya eklenen alanlar (kind hariç). */
export type ConnectionExtras = Omit<ConnectionState, keyof ConnectionInfo | "kind">;

export interface Summary { brains_ready: string[]; any_brain: boolean; checking: boolean; version: number; default_brain?: string | null }
/** POST /recheck: ucuz yeniden tarama sonucu (yalnız hazır olmayan sağlayıcılar kontrol edilir). */
export interface RecheckResult { checked: string[]; changed: string[]; full: boolean; throttled: boolean; states: ConnectionState[]; summary: Summary }

export interface Hardware {
  platform: string; cpu_count: number | null; ram_gb: number | null; ram_bytes: number | null; vram_gb: number | null;
  gpus: { name: string; vram_bytes: number; vendor: string }[]; unified_memory: boolean; gpu_known: boolean; note: string | null;
}

export interface ContextOption { num_ctx: number; label: string; est_gb: number; fits: boolean; hermes_ready: boolean }
export interface ContextPlan { options: ContextOption[]; recommended: number | null; budget_gb: number | null; known: boolean; note: string | null }

export interface CatalogItem {
  name: string; family: string; vendor: string; params_b: number; size_gb: number; tools: boolean; context_max: number;
  license: string; tier: number; good_for: string; fits: boolean; recommended: boolean; installed: boolean; approx: boolean;
  /** S37: Mistral AI modelleri ayrı, öne çıkan bölümde */
  featured?: boolean;
  context: ContextPlan;
}
export interface InstalledModel {
  name: string; parameter_size: string | null; num_ctx: number | null; context_max: number | null; hermes_ready: boolean | null;
  tools: boolean | null; context: ContextPlan;
}
export interface Recommendation { tier: number | null; hardware: Hardware; source: string; items: CatalogItem[]; hint: string; installed: InstalledModel[] }

export interface Job {
  id: string; kind: "pull" | "create"; model: string; status: "running" | "done" | "failed" | "cancelled";
  progress: number; completed: number; total: number; message: string; error: string | null; started: number; finished: number | null;
  source?: string; num_ctx?: number;
  /** Ollama bulut modeli (istem bu bilgisayardan çıkar; `ollama signin` gerekir)*/
  cloud?: boolean;
}

// ------------------------------------------------------------------ S37: adlandırılmış model API bağlantıları
export type EndpointApi = "openai" | "anthropic";
export interface Endpoint {
  id: string; label: string; preset: string | null; api: EndpointApi; base_url: string; model: string; models: string[];
  enabled: boolean; local: boolean; has_key: boolean; /** anahtar dosyası bozuk (has_key bu yüzden false)*/ secrets_corrupt?: boolean; secrets_path?: string | null; api_key_masked: string | null; is_default: boolean;
  key_required: boolean; key_url: string | null; host: string;
  /** araç çağrısı — null = ön ayar varsayılanı; tools_mode: yes | try | no (sunucunun hesapladığı)*/
  tools: boolean | null; tools_mode: "yes" | "try" | "no";
  ready?: Ready; problems?: Problem[]; models_live?: string[] | null;
  last_use?: { ok: boolean; error: string | null; ts: number } | null;
}
export interface Preset {
  id: string; label: string; group: "local" | "cloud"; group_label: string; api: EndpointApi; base_url: string;
  key: "required" | "optional" | "none"; supported: boolean; tools?: "yes" | "try" | "no"; local: boolean; note: string | null; docs: string;
  key_url?: string; verified: string; suggested_models?: string[];
}
export interface EndpointSave {
  preset?: string; label?: string; base_url?: string; api?: EndpointApi; model?: string; api_key?: string | null;
  make_default?: boolean; enabled?: boolean; tools?: boolean | null;
}

/** Ajan/görev `model` alanı: "<uç nokta>::<model>" (arka uç: connections/endpoints.py model_ref). */
export const REF_SEP = "::";
export function modelRef(endpoint: string | null | undefined, model: string | null | undefined): string {
  return endpoint ? `${endpoint}${REF_SEP}${model ?? ""}` : model ?? "";
}
export function parseModelRef(value: string | null | undefined): { endpoint: string | null; model: string } {
  const v = value ?? "";
  const i = v.indexOf(REF_SEP);
  if (i > 0 && /^[a-z0-9][a-z0-9-]{0,31}$/.test(v.slice(0, i))) return { endpoint: v.slice(0, i), model: v.slice(i + REF_SEP.length) };
  return { endpoint: null, model: v };
}
/** Uç noktanın seçilebilir modelleri: canlı /models listesi, yoksa kayıtlı liste; varsayılan model başta. */
export function endpointModels(ep: Endpoint | undefined): string[] {
  if (!ep) return [];
  const list = ep.models_live?.length ? ep.models_live : ep.models;
  return [...new Set([ep.model, ...list].filter(Boolean))];
}
export function endpointsOf(c: ConnectionState | undefined): Endpoint[] {
  return (c?.extra.endpoints ?? []).filter((e) => e.enabled);
}
/** Ollama bulut modeli mi (`gpt-oss:120b-cloud`, `gemma4:cloud`)? İstem bu bilgisayardan çıkar. */
export function isCloudModel(name: string): boolean {
  const n = name.trim().toLowerCase();
  const last = n.split("/").pop() ?? "";
  const tag = last.includes(":") ? last.slice(last.lastIndexOf(":") + 1) : "";
  return n.endsWith("-cloud") || tag === "cloud" || tag.endsWith("-cloud");
}
/** Ollama model adı ön denetimi (arka uç `validate_model_name` ile aynı kalıp; son söz sunucuda). */
export const OLLAMA_NAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{1,63})+\/)?(?:[a-z0-9][a-z0-9._-]{0,63}\/){0,2}[a-z0-9][a-z0-9._-]{0,79}(?::[a-z0-9][a-z0-9._-]{0,63})?$/i;

export interface TestResult { ok: boolean; text: string; error: string | null; ms: number; model?: string | null; profile?: string | null; state?: ConnectionState }
export interface LoginResult { ok: boolean; opened: boolean; command: string; shown: string; next: string; error?: string }

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = bodyText(res.status, null);
    try { const j = await res.json(); msg = bodyText(res.status, j); } catch { /* gövde yok */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const BASE = "/api/connections";

export const connectionsApi = {
  /** all=true: sihirbaz için tüm sağlayıcılar; false: eski arayüzün tanıdığı türler (store'daki liste). */
  list: (force = false, wait = 2.5, all = true) => req<ConnectionState[]>("GET", `${BASE}?force=${force}&wait=${wait}&all=${all}`),
  one: (kind: string, force = false) => req<ConnectionState>("GET", `${BASE}/${kind}?force=${force}`),
  summary: () => req<Summary>("GET", `${BASE}/summary`),
  rescan: (wait = 3) => req<ConnectionState[]>("POST", `${BASE}/rescan?wait=${wait}`),
  test: (kind: string, body: Record<string, unknown> = {}) => req<TestResult>("POST", `${BASE}/${kind}/test`, body),
  hardware: (force = false) => req<Hardware>("GET", `${BASE}/hardware?force=${force}`),
  recommend: () => req<Recommendation>("GET", `${BASE}/models/recommend`),
  pull: (model: string) => req<Job>("POST", `${BASE}/ollama/pull`, { model, confirm: true }),
  create: (from: string, num_ctx: number, name?: string) => req<Job>("POST", `${BASE}/ollama/create`, { from, num_ctx, name, confirm: true }),
  jobs: () => req<Job[]>("GET", `${BASE}/jobs`),
  job: (id: string) => req<Job>("GET", `${BASE}/jobs/${id}`),
  cancelJob: (id: string) => req<{ ok: boolean }>("POST", `${BASE}/jobs/${id}/cancel`),
  ollamaStart: () => req<{ runner: unknown; state: ConnectionState }>("POST", `${BASE}/ollama/start`, { confirm: true }),
  ollamaStop: () => req<{ runner: unknown; state: ConnectionState }>("POST", `${BASE}/ollama/stop`),
  hermesCandidates: () => req<{ candidates: HermesCandidate[]; current: string; wsl: { note: string } | null; env_locked: boolean }>("GET", `${BASE}/hermes/candidates`),
  previewHermesHome: (path: string) => req<{ preview: HermesHomePreview }>("POST", `${BASE}/hermes/home`, { path, preview: true }),
  setHermesHome: (path: string) => req<{ ok: boolean; hermes_home: string; state: ConnectionState }>("POST", `${BASE}/hermes/home`, { path, confirm: true }),
  login: (kind: string) => req<LoginResult>("POST", `${BASE}/${kind}/login`, { confirm: true }),
  /** SETUP: ucuz yeniden tarama — kurulum rehberi, pencereye dönüş ve periyodik kontrol */
  recheck: (wait = 1.5) => req<RecheckResult>("POST", `${BASE}/recheck?wait=${wait}`),
  /** SETUP: kullanıcının tıklamasıyla BOŞ bir terminal (komut almaz, çalıştırmaz) */
  openTerminal: (shell: "powershell" | "cmd" | "sh") =>
    req<{ ok: boolean; opened: boolean; shell: string; error?: string }>("POST", `${BASE}/terminal`, { shell, confirm: true }),
  saveOpenAICompat: (data: { base_url: string; label?: string; model?: string; api_key?: string | null }) =>
    req<{ config: Record<string, unknown>; state: ConnectionState }>("PUT", `${BASE}/openai_compat`, data),
  presets: () => req<Preset[]>("GET", `${BASE}/openai_compat/presets`),
  addEndpoint: (data: EndpointSave) => req<{ endpoint: Endpoint; state: ConnectionState }>("POST", `${BASE}/openai_compat/endpoints`, data),
  updateEndpoint: (id: string, data: EndpointSave) =>
    req<{ endpoint: Endpoint; state: ConnectionState }>("PUT", `${BASE}/openai_compat/endpoints/${encodeURIComponent(id)}`, data),
  deleteEndpoint: (id: string) => req<{ ok: boolean; state: ConnectionState }>("DELETE", `${BASE}/openai_compat/endpoints/${encodeURIComponent(id)}`),
  defaultEndpoint: (id: string) => req<{ ok: boolean; state: ConnectionState }>("POST", `${BASE}/openai_compat/endpoints/${encodeURIComponent(id)}/default`),
  endpointModels: (id: string) =>
    req<{ endpoint: string; models: string[]; live: boolean; error: string | null; session_valid: boolean | null }>("GET", `${BASE}/openai_compat/endpoints/${encodeURIComponent(id)}/models`),
};

// ------------------------------------------------------------------ store köprüsü
// Tek kaynak sunucudaki ConnectionService'tir. Ana store (`useStudio.connections`) eski arayüzün tanıdığı türleri tutar
// (kenar çubuğu, BrainPicker, onboarding — geriye uyum); bu küçük depo aynı yanıtın tamamını (yeni türler dahil) tutar.
// İkisi aynı yanıttan beslenir; birleşimde tür başına daha yüksek `state_version` kazanır (eski yanıt yeniyi ezmez).
export const LEGACY_KINDS: ProviderKind[] = ["hermes", "ollama", "codex", "claude"];

type LegacyState = ConnectionState & { kind: ConnectionInfo["kind"] };
export function legacyVisible(c: ConnectionState): c is LegacyState {
  return LEGACY_KINDS.includes(c.kind);
}

interface AllStore { all: ConnectionState[]; set: (items: ConnectionState[]) => void }
export const useAllConnections = create<AllStore>((set) => ({ all: [], set: (all) => set({ all }) }));

/** Bir yanıtı iki depoya da yazar (tek fetch, iki görünüm). */
export function publishStates(items: ConnectionState[]): void {
  useAllConnections.getState().set(items);
  useStudio.setState({ connections: items.filter(legacyVisible) });
}

/** Tek bir eylem yanıtındaki durumu (ör. klasör ayarı, Ollama başlatma) tam yenilemeyi beklemeden yayınlar. */
export function publishOne(state: ConnectionState): void {
  const all = useAllConnections.getState().all;
  const cur = all.find((c) => c.kind === state.kind);
  if (cur && (cur.state_version ?? 0) > (state.state_version ?? 0)) return;
  publishStates(all.some((c) => c.kind === state.kind) ? all.map((c) => (c.kind === state.kind ? state : c)) : [...all, state]);
}

function merge(all: ConnectionState[], legacy: ConnectionState[]): ConnectionState[] {
  if (!all.length) return legacy;
  const byKind = new Map(all.map((c) => [c.kind, c] as const));
  for (const c of legacy) {
    const cur = byKind.get(c.kind);
    if (!cur || (c.state_version ?? 0) > (cur.state_version ?? 0)) byKind.set(c.kind, c);
  }
  return [...byKind.values()];
}

// Sorun/düzeltme metinleri sunucuda istek diliyle üretilir: dil değişince durumları o dilde yeniden çek
// (aksi hâlde eski dildeki metinler yeni dildeki arayüzde kalır).
useLocale.subscribe((s, prev) => {
  if (s.locale !== prev.locale) void refreshConnections(false, 0).catch(() => undefined);
});

export function useConnectionStates(): ConnectionState[] {
  const all = useAllConnections((s) => s.all);
  const legacy = useStudio((s) => s.connections) as unknown as ConnectionState[];
  return useMemo(() => merge(all, legacy), [all, legacy]);
}

/** secrets.json bozuksa (bağlantıların hiçbir anahtarı okunamaz) yol; değilse null.*/
export function secretsCorruptPath(conns: ConnectionState[]): string | null {
  const ep = (connOf(conns, "openai_compat")?.extra.endpoints ?? []).find((e) => e.secrets_corrupt);
  return ep ? (ep.secrets_path ?? "") : null;
}

export function connOf(conns: ConnectionState[], kind: ProviderKind): ConnectionState | undefined {
  return conns.find((c) => c.kind === kind);
}

/** Yenile: store'daki listeyi zorla tazeler (eski/yeni bileşenler aynı kaynağı görür). */
export async function refreshConnections(force = true, wait = 2.5): Promise<void> {
  publishStates(await connectionsApi.list(force, wait, true));
  // modeller değişmiş olabilir (pull/create sonrası)
  await api.models().then((models) => useStudio.setState({ models })).catch(() => undefined);
}

// ------------------------------------------------------------------ SETUP: kurulumu yeniden başlatmadan fark et
// Kullanıcı stüdyo açıkken Codex/Claude/Hermes/Ollama kurarsa kart kendiliğinden yeşile dönsün. Ucuz: sunucu yalnız hazır
// OLMAYAN sağlayıcıların dosya/port kontrolünü yapar (süreç başlatmaz), kısa aralıktaki çağrıları kısar.
// Tetikler: pencereye dönüş (focus / görünür olma; en sık 15 sn'de bir) ve görünürken her RECHECK_EVERY_MS.
export const RECHECK_EVERY_MS = 3 * 60_000;
const RECHECK_FOCUS_GAP_MS = 15_000;
let lastRecheck = 0;
let recheckBusy = false;

/** Hazır olmayan bir beyin varsa ucuz yeniden tarama; değişiklik olursa iki depoyu ve model listesini tazeler. */
export async function recheckConnections(force = false): Promise<RecheckResult | null> {
  const all = useAllConnections.getState().all;
  if (!force && (recheckBusy || (all.length > 0 && all.every((c) => c.ready === "ok" || c.ready === "soon")))) return null;
  recheckBusy = true;
  lastRecheck = Date.now();
  try {
    const res = await connectionsApi.recheck(force ? 2 : 0.8);
    if (!res.throttled) publishStates(res.states);
    if (res.changed.includes("ollama")) await api.models().then((models) => useStudio.setState({ models })).catch(() => undefined);
    return res;
  } finally {
    recheckBusy = false;
  }
}

function onReturn(): void {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  if (Date.now() - lastRecheck < RECHECK_FOCUS_GAP_MS) return;
  void recheckConnections().catch(() => undefined);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("focus", onReturn);
  document.addEventListener("visibilitychange", onReturn);
  window.setInterval(() => { if (document.visibilityState === "visible") void recheckConnections().catch(() => undefined); }, RECHECK_EVERY_MS);
}

/** Beyin kartları: hermes/gemini hariç, kullanılabilir sağlayıcılar. */
export const BRAIN_KINDS: ProviderKind[] = ["ollama", "codex", "claude", "openai_compat"];

/** Kısa neden: "Ollama kapalı", "Oturum süresi dolmuş" vb. İlk engelleyen sorunun mesajı. */
export function notReadyReason(c: ConnectionState | undefined): { message: string; fix: Fix | null } | null {
  if (!c || c.ready === "ok") return null;
  const p = c.problems.find((q) => q.severity === "block") ?? c.problems[0];
  if (!p) return null;
  return { message: p.message, fix: p.fix };
}

/** Kontrol listesi satırları: kurulu / çalışıyor / oturum / model — sağlayıcıya göre anlamlı olanlar. */
export type CheckKey = "installed" | "running" | "session" | "models";
export function checklist(c: ConnectionState): { key: CheckKey; value: boolean | null }[] {
  const out: { key: CheckKey; value: boolean | null }[] = [{ key: "installed", value: c.installed }];
  if (c.kind === "ollama" || c.kind === "openai_compat") out.push({ key: "running", value: c.runner_running });
  // Hermes API sunucusu isteğe bağlıdır: yalnızca etkinleştirildiyse "çalışıyor" satırı gösterilir
  if (c.kind === "hermes" && c.installed && c.gateway?.key_present) out.push({ key: "running", value: c.service_reachable });
  if (c.kind === "codex" || c.kind === "claude") {
    const hint = c.extra.logged_in;
    out.push({ key: "session", value: c.session_valid ?? (hint === false ? false : null) });
  }
  if (c.kind === "openai_compat" && c.extra.config?.has_key) out.push({ key: "session", value: c.session_valid });
  if (c.kind === "ollama" || c.kind === "openai_compat") {
    out.push({ key: "models", value: c.models_ready ? c.models_ready.count > 0 : null });
  }
  return out;
}

export const PROVIDER_COLOR: Record<ProviderKind, string> = {
  hermes: "#7C5CE0", ollama: "#4F9E30", codex: "#3E8ED0", claude: "#C8663F", openai_compat: "#2A9D8F", gemini: "#4C8BF5",
};

export function fmtGb(n: number | null | undefined): string {
  return n == null ? "?" : `${fmtNumber(n, { maximumFractionDigits: 1 })} GB`;
}
