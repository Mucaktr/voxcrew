// Ekip S50 — Çıktılar istemcisi: koşuların teslim ettiği raporlar/dosyalar.
// REST: GET /api/deliverables?q=&agent=&team=&project=&goal=&kind=&source=&run=&since=&pinned=&unread=&limit=&offset= ·
// GET /api/deliverables/{id} · PATCH /api/deliverables/{id} {pinned?, read?} · POST /api/deliverables/read-all ·
// GET /api/deliverables/unread · GET /api/deliverables/{id}/download?format=md|txt|docx|original · …/raw (görsel/PDF).
// Canlı: `deliverable.ready {run_id, status, title, items, primary, message_id}` ve `deliverable.updated`.
import { create } from "zustand";
import { ApiError, lockedText, bodyText } from "./api";
import { currentLocale } from "./i18n";
import { registerEventHandler } from "./store";

export type DeliverableKind = "report" | "text" | "code" | "data" | "image" | "other" | "document" | "presentation"
  | "sheet" | "media" | "archive" | "app";
export const DELIVERABLE_KINDS: DeliverableKind[] = ["report", "text", "code", "data", "image", "document", "presentation",
  "sheet", "media", "archive", "app", "other"];
export type DeliverableSource = "output" | "file" | "bundle";

export interface Deliverable {
  id: string; run_id: string; step_id?: string | null; agent?: string | null; team?: string | null;
  title: string; run_title?: string | null; source: DeliverableSource; kind: DeliverableKind; name: string;
  path?: string | null; size?: number | null; summary?: string | null; project?: string | null; goal?: string | null;
  origin?: string | null; created_at: string; pinned: boolean; read_at?: string | null; unread: boolean;
  backfilled?: boolean;
  quality?: import("./quality").QualityBadgeData | null; // CG-QUALITY rozet özeti
  recipe?: string | null; // FOLLOWUP: tarif koşusundan geldiyse tarif kimliği (Run.workflow = recipe-<id>)
  // DELIV-P0: biçim, kasa (sha256 + salt okunur kopya), sürüm, ikili orijinal, uygulama paketi
  format?: string | null; mime?: string | null; sha256?: string | null; version?: number;
  vault_status?: "stored" | "too_large" | "quota" | "missing" | "off" | "forgotten" | null;
  entry?: string | null; files?: number | null; binary?: boolean;
}

export interface DeliverableVersion {
  id: string; version: number; created_at?: string | null; size?: number | null; sha256?: string | null;
  run_id?: string | null; current: boolean;
}

/** DEPO-TESLIM: `GET /api/deliverables/{id}/diff?against=` — `left` her zaman eski sürümdür.*/
export interface DiffSide {
  id: string; version: number; created_at?: string | null; size?: number | null; sha256?: string | null; name?: string | null;
  title?: string | null; kind?: string | null; run_id?: string | null; vault_status?: string | null;
}
export interface DiffRow { t: "=" | "+" | "-" | "…"; a?: number | null; b?: number | null; x?: string; n?: number }
export interface DeliverableDiff {
  left: DiffSide; right: DiffSide; mode: "text" | "image" | "bundle" | "binary" | "unavailable";
  identical: boolean | null;
  // text
  rows?: DiffRow[]; added?: number; removed?: number; truncated?: boolean; lines_truncated?: boolean; rows_truncated?: boolean;
  lang?: string | null;
  // bundle
  files?: { added: string[]; removed: string[]; changed: string[]; same: number; truncated: boolean };
  // unavailable
  unavailable?: ("left" | "right")[]; forgotten?: ("left" | "right")[];
  /** `not_vaulted` = en az bir sürümün kasa kopyası yok (çok büyük / kasa dolu): fark verilmez*/
  reason?: "not_vaulted";
  /** ilk satır sınırı aşıldı ve baştaki satırlar aynı: kuyruk karşılaştırılmadı ("aynı" denmez)*/
  tail_unchecked?: boolean;
}

export interface RevealPlan {
  deliverable_id: string; name: string; location: "workdir" | "vault"; platform: "windows" | "macos" | "linux";
  plan_hash: string;
}
export interface DeliverableContent {
  kind: "markdown" | "text" | "code" | "image" | "binary" | "app" | "missing";
  text?: string | null; lang?: string | null; truncated?: boolean; raw?: boolean;
  /** DEPO-TESLIM: sunucunun ikili önizleme ipucu (kasa kopyası varsa) ve satır içi boyut sınırı (bayt)*/
  view?: "pdf" | "audio" | "video" | null; view_max?: number;
  entry?: string | null; files?: { path: string; size?: number | null; role?: string }[];  // kind: app (paket)
}

export interface DeliverableQuery {
  q?: string; agent?: string; team?: string; project?: string; goal?: string; kind?: DeliverableKind | "";
  source?: DeliverableSource | ""; run?: string; since?: string; pinned?: boolean; unread?: boolean;
  limit?: number; offset?: number; recipe?: string;
}

export interface DeliverableList {
  items: Deliverable[]; total: number; unread: number;
  facets: { agent: Record<string, number>; team: Record<string, number>; project: Record<string, number>;
    goal: Record<string, number>; kind: Record<string, number>; recipe?: Record<string, number> };
  goals: Record<string, string>;
  recipes?: Record<string, { tr: string; en: string }>;
}

export type ExportFormat = "md" | "txt" | "docx" | "original";

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

function qs(q: DeliverableQuery): string {
  const p = new URLSearchParams();
  for (const k of ["q", "agent", "team", "project", "goal", "kind", "source", "run", "since", "recipe"] as const) {
    const v = q[k];
    if (v) p.set(k, String(v));
  }
  if (q.pinned) p.set("pinned", "true");
  if (q.unread) p.set("unread", "true");
  p.set("limit", String(q.limit ?? 100));
  if (q.offset) p.set("offset", String(q.offset));
  return p.toString();
}

const enc = encodeURIComponent;

export const deliverablesApi = {
  list: (q: DeliverableQuery) => req<DeliverableList>("GET", `/api/deliverables?${qs(q)}`),
  get: (id: string) => req<{ item: Deliverable; content: DeliverableContent; abs_path?: string | null }>("GET", `/api/deliverables/${enc(id)}`),
  update: (id: string, patch: { pinned?: boolean; read?: boolean }) =>
    req<{ ok: boolean; item: Deliverable }>("PATCH", `/api/deliverables/${enc(id)}`, patch),
  readAll: () => req<{ ok: boolean; count: number }>("POST", "/api/deliverables/read-all"),
  unread: () => req<{ count: number }>("GET", "/api/deliverables/unread"),
  downloadUrl: (id: string, format: ExportFormat) => `/api/deliverables/${enc(id)}/download?format=${format}`,
  rawUrl: (id: string) => `/api/deliverables/${enc(id)}/raw`,
  /** D4: uygulama önizleme oturumu (kullanıcı-yalnız POST); `url` = sandbox'lı iframe `src` (yolda tahmin edilemez belirteç).
   * `scripts` varsayılan false (betiksiz); true yalnız kullanıcının açık, oturum başına onayıyla.*/
  siteSession: (id: string, scripts = false) => req<{ url: string; entry: string; scripts: boolean }>("POST", `/api/deliverables/${enc(id)}/site-session`, { scripts }),
  versions: (id: string) => req<{ items: DeliverableVersion[] }>("GET", `/api/deliverables/${enc(id)}/versions`),
  /** DEPO-TESLIM: iki sürümün farkı (metin MASKELİ; görsel taraflar `rawUrl` ile yan yana).*/
  diff: (id: string, against: string) => req<DeliverableDiff>("GET", `/api/deliverables/${enc(id)}/diff?against=${enc(against)}`),
  /** D3: plan (hiçbir şey açılmaz) → onay (aynı plan_hash). Yol sunucuda çözülür; arayüz yol vermez. */
  revealPlan: (id: string) => req<{ plan: RevealPlan; needs_confirm: boolean }>("POST", `/api/deliverables/${enc(id)}/reveal`, {}),
  revealConfirm: (id: string, planHash: string) =>
    req<{ ok: boolean; revealed: boolean; location: string }>("POST", `/api/deliverables/${enc(id)}/reveal`, { confirm: true, plan_hash: planHash }),
};

/** Tarayıcı indirmesi (ek dosya başlığıyla sunucudan; maskeli). önce istenir; hata (ör. değerlendirme
 * sürerken 423) ham JSON indirmesi yerine okunur iletiyle döner. Dönüş: hata iletisi ya da null.*/
export async function downloadDeliverable(id: string, format: ExportFormat, opts?: { binary?: boolean }): Promise<string | null> {
  try {
    // D1: ikili orijinal (pptx/xlsx/docx/zip/mp4…) maskelenemez → yalnızca arayüzden, POST ile (jeton + çerez + Origin)
    const unmasked = format === "original" && !!opts?.binary;
    const res = unmasked
      ? await fetch(`/api/deliverables/${encodeURIComponent(id)}/original`, { method: "POST", headers: { "X-Studio-Lang": currentLocale() } })
      : await fetch(deliverablesApi.downloadUrl(id, format), { headers: { "X-Studio-Lang": currentLocale() } });
    if (!res.ok) {
      let body: unknown = null;
      try { body = await res.json(); } catch { /* gövde yok */ }
      const detail = body && typeof body === "object" ? (body as { detail?: unknown }).detail : undefined;
      return lockedText(res.status, body, "download") ?? (typeof detail === "string" ? detail : `${res.status}`);
    }
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") ?? "";
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
    const name = star ? decodeURIComponent(star) : /filename="([^"]+)"/.exec(cd)?.[1] ?? `${id}.${format === "original" ? "bin" : format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** DEPO-TESLIM: PDF / ses / video baytları (kullanıcı-yalnız POST; kasa kopyası, maskelenmemiş ikili). Tarayıcı
 * `<audio src>` / `<iframe src>` istekleri sayfa jetonunu taşıyamadığından bayt `blob:` URL'sine çevrilir (çağıran
 * `URL.revokeObjectURL` ile bırakır). Tür MIME tablosundan sunucuda belirlenir; burada tam eşleşmeyle doğrulanıp yeniden türlenir.*/
/** sunucudan beklenmeyen tür geldi (415); ileti arayüzde yerelleştirilir (ham MIME gösterilmez).*/
export class ViewTypeError extends ApiError {
  constructor(public mime: string) { super(415, mime || "?"); }
}

/** kabul edilen önizleme türleri TAM eşleşmeyle (`startsWith` değil); sunucudaki `formats.VIEW_MIME` ile aynı küme.*/
const VIEW_TYPES: Record<"pdf" | "audio" | "video", readonly string[]> = {
  pdf: ["application/pdf"],
  audio: ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/flac"],
  video: ["video/mp4", "video/webm"],
};

export async function fetchViewBlob(id: string, view: "pdf" | "audio" | "video"): Promise<Blob> {
  const res = await fetch(`/api/deliverables/${enc(id)}/view`, { method: "POST", headers: { "X-Studio-Lang": currentLocale() } });
  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* gövde yok */ }
    const detail = body && typeof body === "object" ? (body as { detail?: unknown }).detail : undefined;
    throw new ApiError(res.status, lockedText(res.status, body, "download") ?? (typeof detail === "string" ? detail : `${res.status}`));
  }
  const blob = await res.blob();
  const ok = VIEW_TYPES[view].find((x) => x === blob.type);
  if (!ok) throw new ViewTypeError(blob.type);
  return new Blob([blob], { type: ok });  // tür yerelde, doğrulanmış sabitle yeniden yazılır
}

/** Panoya kopyalama (güvenli bağlam yoksa gizli metin alanı yedeği). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* yedeğe düş */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Temiz yazdırma görünümü: belgenin HTML'i gizli bir iframe'de sade bir baskı stiliyle yazdırılır
 *  (tarayıcının "PDF olarak kaydet" hedefi; yeni bağımlılık yok). */
export function printDocument(title: string, html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  frame.srcdoc = `<!doctype html><html lang="${currentLocale()}"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 11pt/1.55 -apple-system, "Segoe UI", Inter, Roboto, Arial, sans-serif; color: #111; background: #fff; margin: 0; }
  h1.doc-title { font-size: 20pt; margin: 0 0 4mm; }
  .meta { color: #444; font-size: 9pt; margin-bottom: 6mm; border-bottom: 1px solid #bbb; padding-bottom: 3mm; }
  h1, h2, h3, h4 { line-height: 1.25; page-break-after: avoid; break-after: avoid; }
  .md-h1 { font-size: 17pt; } h2 { font-size: 14pt; } h3 { font-size: 12pt; }
  p, li { orphans: 3; widows: 3; }
  pre, code { font-family: Consolas, "JetBrains Mono", monospace; font-size: 9.5pt; }
  pre { white-space: pre-wrap; word-break: break-word; border: 1px solid #ccc; border-radius: 4px; padding: 3mm; background: #f6f6f6; break-inside: avoid; }
  table { border-collapse: collapse; width: 100%; break-inside: avoid; }
  th, td { border: 1px solid #bbb; padding: 1.5mm 2mm; text-align: left; vertical-align: top; }
  blockquote { border-left: 3px solid #999; margin: 0; padding-left: 4mm; color: #333; }
  img { max-width: 100%; }
  a { color: #111; text-decoration: underline; }
  [data-noprint] { display: none !important; }
</style></head><body>${html}</body></html>`;
  frame.onload = () => {
    const w = frame.contentWindow;
    if (!w) { frame.remove(); return; }
    const done = () => window.setTimeout(() => frame.remove(), 500);
    w.addEventListener("afterprint", done, { once: true });
    window.setTimeout(() => { w.focus(); w.print(); }, 60);
    window.setTimeout(() => { if (document.body.contains(frame)) frame.remove(); }, 120_000);
  };
  document.body.appendChild(frame);
}

// ---------------------------------------------------------------- okunmamış sayısı (yan menü rozeti)
interface UnreadState { count: number; set: (n: number) => void }
export const useDeliverableUnread = create<UnreadState>((set) => ({ count: 0, set: (count) => set({ count }) }));

let refreshTimer: number | undefined;
export function refreshDeliverableUnread(delay = 0): void {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    deliverablesApi.unread().then((r) => useDeliverableUnread.getState().set(r.count)).catch(() => undefined);
  }, delay);
}

/** Canlı teslim olayı (bileşenler kendi listelerini tazelemek için abone olur). */
export interface DeliverableReadyEvent {
  type: "deliverable.ready"; run_id: string; status: "done" | "failed"; title?: string; subject?: string;
  primary?: string; message_id?: string; items?: { id: string; title: string; kind: DeliverableKind; source: DeliverableSource }[];
}

export function onDeliverableEvent(fn: (ev: { type: string } & Record<string, unknown>) => void): () => void {
  return registerEventHandler("deliverable.", (ev) => fn(ev as { type: string } & Record<string, unknown>));
}

// rozet sayısı her olayda (ve yeniden bağlanınca) sunucudan tazelenir
const offs = [
  registerEventHandler("deliverable.", () => refreshDeliverableUnread(150)),
  registerEventHandler("resync.", () => refreshDeliverableUnread(300)),
];
if (import.meta.hot) import.meta.hot.dispose(() => offs.forEach((off) => off()));
