// PROC-FIX GPT Codex ajanının kullanıcı Codex kurulumundan yalıtımı ve web araması izni
// (backend/studio/connectors/codex_isolation.py; kaynaklar).
// REST: GET /api/codex-isolation/{slug} · POST /api/codex-isolation/{slug} {inherit_user_codex_config?, confirm?, web_search?}
// (yazma yalnız kullanıcı; MCP 403). Devralmayı açmak `confirm: "inherit"` ister: arayüz bunu yalnız onay penceresinden gönderir.
import { ApiError, bodyText } from "./api";
import { currentLocale } from "./i18n";

export interface CodexIsolation {
  agent: string;
  mode: "isolated" | "inherited";
  inherit_user_codex_config: boolean;
  web_search: boolean;
  default: "isolated";
  internal?: boolean;
  bound?: boolean;
  isolation: { flags: string[]; config: string[]; web: { off: string; on: string }; skills: string; prompt_note: boolean };
  verified_docs: string[];
  verified_cli: string[];
  source_only: string[];
  not_covered: string[];
  live_check?: { version: string; verified: string[]; not_verified: string[] };
  skills_found?: number | null;
  /** kullanıcı-yalnız "eksik yalıtımla çalıştır" izni (skill listesi komut satırına sığmazsa)*/
  partial_isolation?: boolean;
  /** yalnız SAYILAR (ad yok). state: complete | too_many (koşu reddedilir) | partial (izinle `enabled` açık)*/
  skills?: { found: number; found_exact: boolean; fit: number; disabled: number; enabled: number;
    state: "complete" | "too_many" | "partial"; launch: "direct" | "node" | "cmd" | null; budget: number } | null;
  docs: string;
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
      msg = bodyText(res.status, await res.json());
    } catch { /* gövde yok */ }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

const url = (slug: string) => `/api/codex-isolation/${encodeURIComponent(slug)}`;

export const codexIsolationApi = {
  get: (slug: string) => req<CodexIsolation>("GET", url(slug)),
  /** Açmak yalnız onay penceresinden (confirm: "inherit"); kapatmak onay istemez. */
  setInherit: (slug: string, inherit: boolean) =>
    req<CodexIsolation>("POST", url(slug), inherit ? { inherit_user_codex_config: true, confirm: "inherit" }
      : { inherit_user_codex_config: false }),
  setWeb: (slug: string, web: boolean) => req<CodexIsolation>("POST", url(slug), { web_search: web }),
  /** Açmak yalnız onay penceresinden (confirm: "partial"); MCP 403. */
  setPartial: (slug: string, on: boolean) =>
    req<CodexIsolation>("POST", url(slug), on ? { partial_isolation: true, confirm: "partial" } : { partial_isolation: false }),
};
