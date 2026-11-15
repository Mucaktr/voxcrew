// zip paketi istemcisi (yalnız arayüz; POST olduğundan tarayıcı Origin + oturum çerezi gönderir).
// Saf yardımcılar `zipFormat.ts`'de. Önizleme (`dry_run`) zip üretmez; indirme sunucuda kasa baytlarından üretilir.
import { ApiError, bodyText, lockedText } from "./api";
import { currentLocale } from "./i18n";
import { dispositionName, zipRequest, type ZipPlan, type ZipTarget } from "./zipFormat";

async function post(target: ZipTarget, unmasked: boolean, dryRun: boolean): Promise<Response> {
  const { url, body } = zipRequest(target, { unmasked, dryRun });
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Lang": currentLocale() },
    body: JSON.stringify(body) });
}

/** Onay penceresi için önizleme: sayı, boyut, atlananlar (zip üretilmez). */
export async function zipPlan(target: ZipTarget, unmasked = false): Promise<ZipPlan> {
  const res = await post(target, unmasked, true);
  let json: unknown = null;
  try { json = await res.json(); } catch { /* gövde yok */ }
  if (res.ok) return json as ZipPlan;
  // 422 (eklenecek dosya yok) atlananları da taşır: pencere nedenleri gösterebilsin
  if (res.status === 422 && json && typeof json === "object" && Array.isArray((json as { skipped?: unknown }).skipped)) {
    const j = json as { skipped: ZipPlan["skipped"]; merged?: number };
    return { ok: true, dry_run: true, name: "", count: 0, bytes: 0, unmasked, masked_text: 0, skipped: j.skipped, merged: j.merged ?? 0 };
  }
  throw new ApiError(res.status, bodyText(res.status, json));
}

/** Zip'i indirir (tarayıcı indirmesi). Dönüş: hata iletisi ya da null. */
export async function downloadZip(target: ZipTarget, unmasked = false): Promise<string | null> {
  try {
    const res = await post(target, unmasked, false);
    if (!res.ok) {
      let json: unknown = null;
      try { json = await res.json(); } catch { /* gövde yok */ }
      return lockedText(res.status, json, "download") ?? bodyText(res.status, json);
    }
    const blob = await res.blob();
    const link = document.createElement("a");
    const href = URL.createObjectURL(blob);
    link.href = href;
    link.download = dispositionName(res.headers.get("content-disposition"), "ciktilar.zip");
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
