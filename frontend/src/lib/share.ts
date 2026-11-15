// Hafif ekip paylaşımı (dalga 3): şablon paketini dışa/içe aktarma (/api/share). Bulut ve hesap yok; dosya yereldir.
import { currentLocale } from "./i18n";
import type { OutputTemplate } from "./outputTemplates";

export type ShareKind = "job" | "agent" | "output";
export const MAX_BUNDLE_BYTES = 256 * 1024;

export interface Exportable {
  jobs: { id: string; name: string; example?: boolean }[];
  agents: { id: string; name: string; permissions: string }[];
  outputs: { id: string; name: string; source: "template" | "workflow" | "recipe" }[];
}
export interface ExportPreview {
  kind: ShareKind; id: string; name: string; fields: string[]; prompts: { field: string; text: string }[];
  agents: string[]; dropped: string[]; redacted: string[]; excluded: string[];
}
export interface ExportResult { bundle: unknown; preview: ExportPreview[]; bytes: number; filename: string }
export interface ImportPlan {
  key: string; kind: ShareKind; id: string; name: string; target_id: string; target_name: string;
  collision: boolean; blocked: string | null; warnings: string[]; prompts: { field: string; text: string }[];
  flags: { field: string; patterns: string[] }[]; choices: ("add" | "replace" | "skip")[];
  diff: { field: string; before: string; after: string }[];
  permissions?: { declared: string; applied: string };
  brain?: { requested: { connection?: string; model?: string }; applied: { connection: string; model: string }; note: string | null };
  baseline?: { manual_minutes: number; review_minutes: number } | null;
  steps?: number;
}
export interface ImportPreview { ok: boolean; exported_at?: string; items: ImportPlan[] }
export interface ImportResult {
  ok: boolean;
  results: { key: string; kind: ShareKind; name: string; status: "added" | "replaced" | "skipped" | "error";
             id?: string; read_only?: boolean; flagged?: boolean; reason?: string; error?: string }[];
}

export class ShareApiError extends Error {
  errors: string[];
  constructor(message: string, errors: string[] = []) {
    super(message);
    this.errors = errors;
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    let errors: string[] = [];
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
      else if (j.detail && typeof j.detail === "object") {
        msg = String(j.detail.message ?? msg);
        errors = Array.isArray(j.detail.errors) ? j.detail.errors.map(String) : [];
      }
    } catch { /* gövde yok */ }
    throw new ShareApiError(msg, errors);
  }
  return res.json() as Promise<T>;
}

export const shareApi = {
  exportable: () => req<Exportable>("GET", "/api/share/exportable"),
  export: (items: { kind: ShareKind; id: string }[]) => req<ExportResult>("POST", "/api/share/export", { items }),
  preview: (bundle: unknown) => req<ImportPreview>("POST", "/api/share/import/preview", bundle),
  apply: (bundle: unknown, choices: Record<string, string>) =>
    req<ImportResult>("POST", "/api/share/import", { bundle, choices, confirm: true }),
  makeWritable: (slug: string) => req<unknown>("PATCH", `/api/agents/${encodeURIComponent(slug)}`, { permissions: "write" }),
  // Karar 12: çıktı şablonları (uygula/sil yazma uçları USER_ONLY_RE içinde; MCP 403)
  outputs: () => req<{ items: OutputTemplate[] }>("GET", "/api/share/outputs"),
  applyOutput: (id: string, workflow: string) =>
    req<unknown>("POST", `/api/share/outputs/${encodeURIComponent(id)}/apply`, { workflow }),
  deleteOutput: (id: string) => req<{ ok: boolean }>("DELETE", `/api/share/outputs/${encodeURIComponent(id)}`),
};

/** Paketi tarayıcıda indirilecek dosyaya çevirir (sunucuya ikinci istek yok). */
export function downloadBundle(bundle: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(bundle, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
