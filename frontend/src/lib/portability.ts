// "Her şeyi dışa aktar" — tek yerel zip (/api/portability). İptal ya da düşürmede hiçbir şey silinmez;
// paket yalnız okur. İndirme kullanıcıya aittir (MCP 403); jetonu küresel fetch sarmalayıcısı (presence.ts) ekler.
import { lockedText } from "./api";
import { currentLocale } from "./i18n";

export type ExportReason = "cancel" | "downgrade" | "manual";

export interface PortabilityManifest {
  format: string;
  version: number;
  sections: string[];
  counts: Record<string, number>;
  excluded: string[];
  redaction: { secrets: boolean; local_paths: boolean; pii: boolean };
  limits: { file_bytes: number; total_bytes: number };
  deletes_nothing: boolean;
}

async function fail(res: Response): Promise<never> {
  let msg = `${res.status}`;
  try {
    const j = await res.json();
    if (typeof j.detail === "string") msg = j.detail;
    msg = lockedText(res.status, j, "download") ?? msg;  // mühür sürerken anlaşılır ileti
  } catch { /* gövde yok */ }
  throw new Error(msg);
}

export const portabilityApi = {
  async manifest(): Promise<PortabilityManifest> {
    const res = await fetch("/api/portability/manifest", { headers: { "X-Studio-Lang": currentLocale() } });
    if (!res.ok) return fail(res);
    return res.json();
  },
  /** Zip'i indirir; dönen değer bayt sayısıdır. */
  async download(reason: ExportReason = "manual"): Promise<number> {
    const res = await fetch("/api/portability/export", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Studio-Lang": currentLocale() },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) return fail(res);
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") ?? "";
    const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? "voxcrew-export.zip";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return blob.size;
  },
};
