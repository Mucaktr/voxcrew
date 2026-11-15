// zip paketi: istek biçimi, neden → ileti anahtarı, boyut biçimi (saf; içe aktarma yok → node --test ile sınanır).
// Sunucu: `POST /api/deliverables/zip {run_id | ids[], unmasked?, dry_run?}` ve `POST /api/deliverables/{id}/zip`.

export type ZipTarget = { runId: string } | { ids: string[] } | { id: string };
export interface ZipSkipped { name: string; reason: string }
export interface ZipPlan {
  ok: boolean; dry_run: boolean; name: string; count: number; bytes: number; unmasked: boolean; masked_text: number;
  skipped: ZipSkipped[]; merged: number;
}

export const ZIP_REASONS = ["forgotten", "missing", "too_large", "quota", "not_vaulted", "corrupt", "not_found", "zip_size_cap",
  "zip_files_cap", "text_too_large", "unmaskable", "run_scan_cap"] as const;

/** İstek adresi ve gövdesi. `unmasked` yalnız açıkça `true` ise gider (varsayılan: metin maskeli). */
export function zipRequest(target: ZipTarget, opts: { unmasked?: boolean; dryRun?: boolean } = {}): { url: string; body: Record<string, unknown> } {
  const flags: Record<string, unknown> = {};
  if (opts.unmasked === true) flags.unmasked = true;
  if (opts.dryRun === true) flags.dry_run = true;
  if ("id" in target) return { url: `/api/deliverables/${encodeURIComponent(target.id)}/zip`, body: flags };
  if ("runId" in target) return { url: "/api/deliverables/zip", body: { run_id: target.runId, ...flags } };
  return { url: "/api/deliverables/zip", body: { ids: [...new Set(target.ids)].slice(0, 200), ...flags } };
}

/** Neden kodu → ileti anahtarı (bilinmeyen kod `zip_r_other`). */
export function zipReasonKey(reason: string): string {
  return (ZIP_REASONS as readonly string[]).includes(reason) ? `zip_r_${reason}` : "zip_r_other";
}

/** Atlananları nedene göre grupla (kararlı sıra: ZIP_REASONS, sonra bilinmeyenler). */
export function groupSkipped(skipped: ZipSkipped[]): { reason: string; names: string[] }[] {
  const by = new Map<string, string[]>();
  for (const s of skipped) by.set(s.reason, [...(by.get(s.reason) ?? []), s.name]);
  const known: string[] = [...ZIP_REASONS];
  const order = [...known.filter((r) => by.has(r)), ...[...by.keys()].filter((r) => !known.includes(r))];
  return order.map((reason) => ({ reason, names: by.get(reason) ?? [] }));
}

/** Boyut: 1.024 tabanı, tek ondalık (TR virgül, EN nokta). */
export function formatBytes(n: number, lang: "tr" | "en" = "tr"): string {
  const num = (v: number) => (Math.round(v * 10) / 10).toLocaleString(lang === "en" ? "en-US" : "tr-TR", { maximumFractionDigits: 1 });
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${num(n)} B`;
  if (n < 1024 * 1024) return `${num(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${num(n / 1024 / 1024)} MB`;
  return `${num(n / 1024 / 1024 / 1024)} GB`;
}

/** Onay penceresi özeti: eklenecek sayı/boyut, atlanan sayısı, boş paket mi, maskelenebilir metin var mı. */
export function zipSummary(plan: ZipPlan | null): { count: number; bytes: number; problems: number; empty: boolean; hasText: boolean } {
  if (!plan) return { count: 0, bytes: 0, problems: 0, empty: true, hasText: false };
  return { count: plan.count, bytes: plan.bytes, problems: plan.skipped.length, empty: plan.count < 1, hasText: plan.masked_text > 0 };
}

/** `Content-Disposition`'dan dosya adı (UTF-8 `filename*` önce); yoksa yedek ad. Yol ayraçları atılır. */
export function dispositionName(cd: string | null | undefined, fallback: string): string {
  const header = cd ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  let name = fallback;
  try { name = star ? decodeURIComponent(star) : /filename="([^"]+)"/.exec(header)?.[1] ?? fallback; } catch { name = fallback; }
  name = name.split(/[\\/]/).pop() ?? fallback;
  return name.trim() || fallback;
}
