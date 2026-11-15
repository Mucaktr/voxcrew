// (karar 3) — Claude Code ajanının kullanıcı ~/.claude kurulumundan yalıtımı (backend/studio/connectors/claude_isolation.py).
// REST: GET /api/claude-isolation/{slug} · POST /api/claude-isolation/{slug} {inherit_user_claude_config, confirm?}
// (yazma yalnız kullanıcı; MCP 403). Açmak `confirm: "inherit"` ister: arayüz bunu yalnız onay penceresinden gönderir.
// Arayüz jetonunu lib/presence.ts ekler.
import { ApiError, bodyText } from "./api";
import { currentLocale } from "./i18n";

export type ClaudeConfigMode = "isolated" | "inherited";

export interface ClaudeIsolation {
  agent: string;
  mode: ClaudeConfigMode;
  inherit_user_claude_config: boolean;
  default: ClaudeConfigMode;
  /** `settings` = stüdyonun --settings dosyasının özeti (claudeMdExcludes globları, AGENTS.md ayarı)*/
  isolation: {
    flags: string[]; env: string[];
    /** `--disable-slash-commands`; `deny_tools` = Skill, Agent. boş eklenti kökü değişkeni.
     * `deny_tools_legacy` (Task) claude sürümü `agent_tool_since` öncesiyse ya da bilinmiyorsa eklenir*/
    args?: string[]; deny_tools?: string[]; plugin_root_env?: string;
    deny_tools_legacy?: string[]; agent_tool_since?: string;
    settings?: { claudeMdExcludes: string[]; instructionFiles: string; plugins: string[]; edit_deny?: string[] };
  };
  not_covered: string[];
  /** canlı doğrulamadan önce yalnız belgeye dayanan maddeler (geriye dönük uyumluluk); `live_verified` = hepsi
   * doğrulandı mı (hayır). ISO-WORDING: bugünkü durum `live_check`'te (gerçek claude sürümü, doğrulanan/doğrulanmayan)*/
  docs_only?: string[];
  live_verified?: boolean;
  live_check?: { version: string; verified: string[]; not_verified: string[] };
  /** stüdyonun iç ajanı (devralma açılamaz)*/
  internal?: boolean;
  /** --settings ile dışlanan, canlı doğrulanmamış yönerge dosyası adları (CLAUDE.local.md, AGENTS.md,.claude/rules)*/
  unverified?: string[];
  /** "excluded_not_live_tested" — dosyalar dışlanır; canlı claude ile denenmedi*/
  unverified_reason?: string;
  /** çalışma klasörü ve üst klasörlerinde bulunan bu türden dosya sayısı (yalnız varlık denetimi)*/
  ancestor_files?: number;
  /** kayıt durumu; `void` (stüdyonun son yazımı değil, ör. eski veritabanı yedeği) ya da `corrupt` iken herkes yalıtılmış*/
  record?: "absent" | "ok" | "void" | "corrupt";
  record_ignored?: boolean;
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
      const j = await res.json();
      msg = bodyText(res.status, j);
    } catch { /* gövde yok */ }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const claudeIsolationApi = {
  get: (slug: string) => req<ClaudeIsolation>("GET", `/api/claude-isolation/${encodeURIComponent(slug)}`),
  /** Açmak yalnız onay penceresinden (confirm: "inherit"); kapatmak onay istemez. */
  set: (slug: string, inherit: boolean) =>
    req<ClaudeIsolation>("POST", `/api/claude-isolation/${encodeURIComponent(slug)}`,
      inherit ? { inherit_user_claude_config: true, confirm: "inherit" } : { inherit_user_claude_config: false }),
};
