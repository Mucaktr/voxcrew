// S37 — model erişim politikası (arka uç: backend/studio/connections/policy.py tek yetkili; burası yalnızca arayüzde
// süzme ve önizleme için aynı kuralları uygular — rota yine sunucuda denetlenir, izinsiz rota ajan kartında hata olur).
import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { currentLocale } from "./i18n";
import { parseModelRef, type Endpoint } from "./connections";
import { bodyText } from "./api";

export type PolicyMode = "all" | "local_only" | "allowlist";
export interface ModelPolicy { mode: PolicyMode; allow: string[]; deny: string[]; require_consent_remote: boolean }
export interface Consent { key: string; ts: number; source: string }
export interface PreviewRow {
  connection: string; label: string; ref: string; allowed: boolean; remote: boolean; reason: string | null;
  consent_key: string | null; provider: string; host: string; message: string | null;
}
export interface PolicyView {
  policy: ModelPolicy; modes: PolicyMode[]; presets: Record<string, Partial<ModelPolicy>>; consent: Consent[]; preview: PreviewRow[];
}

const BASE = "/api/connections/models";

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

export const policyApi = {
  get: () => req<PolicyView>("GET", `${BASE}/policy`),
  save: (p: Partial<ModelPolicy>) => req<PolicyView>("PUT", `${BASE}/policy`, p),
  consent: (key: string) => req<PolicyView>("POST", `${BASE}/consent`, { key, confirm: true }),
  revoke: (key: string) => req<PolicyView>("POST", `${BASE}/consent/revoke`, { key }),
};

interface PolicyStore { view: PolicyView | null; loading: boolean; set: (v: PolicyView) => void; load: () => Promise<void> }
export const useModelPolicy = create<PolicyStore>((set, get) => ({
  view: null,
  loading: false,
  set: (view) => set({ view }),
  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try { set({ view: await policyApi.get() }); } catch { /* ağ hatası: süzme kapalı kalır (sunucu yine denetler) */ } finally { set({ loading: false }); }
  },
}));

/** Bileşenler için: politika görünümünü bir kez yükler ve döndürür. */
export function usePolicyView(): PolicyView | null {
  const view = useModelPolicy((s) => s.view);
  const load = useModelPolicy((s) => s.load);
  useEffect(() => { if (!view) void load(); }, [view, load]);
  return view;
}

// ------------------------------------------------------------------ kural (policy.py ile aynı)
function globToRe(p: string): RegExp {
  const esc = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${esc}$`, "i");
}
export function matches(pattern: string, keys: string[], local: boolean): boolean {
  const p = pattern.trim();
  if (p.toLowerCase() === "local") return local;
  const re = globToRe(p);
  return keys.some((k) => re.test(k));
}

export function isCloudOllama(name: string): boolean {
  const n = name.trim().toLowerCase();
  const last = n.split("/").pop() ?? "";
  const tag = last.includes(":") ? last.slice(last.lastIndexOf(":") + 1) : "";
  return n.endsWith("-cloud") || tag === "cloud" || tag.endsWith("-cloud");
}

/** Uzak Ollama sunucusu onay anahtarı öneki (policy.py REMOTE_OLLAMA_PREFIX). */
export const REMOTE_OLLAMA_PREFIX = "ollama-remote:";
const CONSENT_KEY_MAX = 80;
const HOST_MAX = CONSENT_KEY_MAX - REMOTE_OLLAMA_PREFIX.length; // 66
const HOST_KEEP = 48;

/** FNV-1a 32 bit (UTF-8) — policy.py `_fnv1a32` ile aynı. */
export function fnv1a32(text: string): string {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** adres → normalleştirilmiş ana makine adı (şema, büyük/küçük harf, bağlantı noktası önemsiz). policy.py
 * `ollama_remote_host` ile aynı.*/
export function ollamaRemoteHost(urlOrHost: string): string {
  const raw = (urlOrHost ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `http://${raw}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/** uzak Ollama onay anahtarı (policy.py `remote_ollama_key`): uzun adlar deterministik kısaltılır.*/
export function remoteOllamaKey(urlOrHost: string): string {
  let h = ollamaRemoteHost(urlOrHost);
  if (h.length > HOST_MAX) h = `${h.slice(0, HOST_KEEP)}~${fnv1a32(h)}`;
  return `${REMOTE_OLLAMA_PREFIX}${h || "?"}`;
}

export interface BrainDecision { ref: string; allowed: boolean; remote: boolean; reason: string | null; consentKey: string | null; host: string; provider: string; needsConsent: boolean }

/** Bağlantı + model → karar. `endpoints`: openai_compat uç noktaları (yerel/uzak bilgisi için). */
export function decide(view: PolicyView | null, connection: string, model: string | null | undefined,
  opts: { endpoints?: Endpoint[]; ollamaRemote?: boolean; ollamaHost?: string; defaultEndpoint?: string | null } = {}): BrainDecision {
  let ref = "", remote = true, consentKey: string | null = null, host = "", provider = "";
  let keys: string[] = [];
  if (connection === "openai_compat") {
    const r = parseModelRef(model);
    const eid = r.endpoint ?? opts.defaultEndpoint ?? opts.endpoints?.find((e) => e.is_default)?.id ?? "?";
    const ep = opts.endpoints?.find((e) => e.id === eid);
    ref = `${eid}::${r.model || ep?.model || ""}`;
    remote = ep ? !ep.local : true;
    consentKey = remote ? `endpoint:${eid}` : null;
    host = ep?.host ?? ""; provider = ep?.label ?? eid;
    keys = [ref];
  } else if (connection === "ollama") {
    const m = model || "default";
    // FOLLOWUP: uzak Ollama sunucusu (ollamaHost) → sunucu başına onay `ollama-remote:<host>` (policy.py
    // remote_ollama_key ile aynı). bulut adlı model de önce o uzak sunucuya gider; "ollama:cloud" onayı
    // bir LAN/uzak sunucuyu kapsamaz. Gerçek bulut modelleri (yerel daemon üzerinden) "ollama:cloud" kalır.
    const remoteHost = ollamaRemoteHost(opts.ollamaHost ?? "");
    const cloud = remoteHost ? isCloudOllama(m) : (opts.ollamaRemote ?? isCloudOllama(m));
    ref = `ollama:${m}`;
    if (remoteHost) {
      remote = true; keys = [ref, `${ref}:cloud`];
      consentKey = remoteOllamaKey(remoteHost); host = remoteHost; provider = "Ollama (uzak sunucu)";
    } else {
      remote = cloud; keys = cloud ? [ref, `${ref}:cloud`] : [ref];
      consentKey = cloud ? "ollama:cloud" : null; host = cloud ? "ollama.com" : ""; provider = cloud ? "Ollama Cloud" : "Ollama";
    }
  } else if (connection === "codex" || connection === "claude") {
    ref = `${connection}:${model || "default"}`; keys = [ref]; provider = connection === "codex" ? "Codex" : "Claude Code";
  } else {
    ref = "hermes:default"; keys = [ref]; provider = "Hermes";
  }
  const base = { ref, remote, consentKey, host, provider };
  if (!view) return { ...base, allowed: true, reason: null, needsConsent: false };
  const p = view.policy;
  const local = !remote;
  let reason: string | null = null;
  if (p.deny.some((x) => matches(x, keys, local))) reason = "denied";
  else if (p.mode === "local_only" && !local) reason = "not_local";
  else if (p.mode === "allowlist" && !p.allow.some((x) => matches(x, keys, local))) reason = "not_allowed";
  const needsConsent = !reason && !!consentKey && p.require_consent_remote && !view.consent.some((c) => c.key === consentKey);
  return { ...base, allowed: !reason, reason, needsConsent };
}

/** Sağlayıcı (bağlantı türü) bütünüyle kapalı mı — ör. local_only'de Codex/Claude; hiçbir modeli izinli olmayan uç nokta. */
export function connectionAllowed(view: PolicyView | null, connection: string): boolean {
  return decide(view, connection, null).allowed || connection === "ollama" || connection === "openai_compat";
}

export function useRefreshPolicy() {
  const set = useModelPolicy((s) => s.set);
  return useCallback(async () => { set(await policyApi.get()); }, [set]);
}
