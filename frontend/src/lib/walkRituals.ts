/**
 * anı defteri istemcisi ve deposu (sözleşme: "Anı defteri").
 *
 * - `ritualApi`: `GET /api/walk/rituals` (defter) ve `POST /api/walk/ritual` (ilk yapılış). Yazma kullanıcı-yalnızdır;
 * `X-Studio-UI` jetonunu `lib/presence.ts` ekler. Yanıtlar toleranslı süzülür.
 * - `installRitualMemory`: `onRitualDone` kancasına bağlanır; sunucu anıyı İLK kez yazdıysa `true` döner ve çalışma
 * zamanı duyuruya "Anı defterine eklendi" ekler. Ritüel ödül vermez: bu modül oyun parası, XP ya da SP okumaz/yazmaz.
 * - `lib/walk.ts` değişmez (yalnız tost yardımcısı kullanılır).
*/
import { create } from "zustand";
import { onRitualDone, ritualText, type RitualDoneEvent } from "../voxel/fun/ritualRuntime";
import { RITUALS } from "../voxel/fun/rituals";
import { pushWalkToast, pushWalkToastNote } from "./walk"; // pushWalkToastNote
import { bodyText } from "./api";
import { currentLocale, tx } from "./i18n";
import { ritualsMsg } from "../locales/rituals";

export type RitualScope = "scene" | "map";
export interface RitualDoneRow { id: string; scope: RitualScope; day: string }
export interface RitualCityBook { found: number; total: number; done: readonly RitualDoneRow[]; title: string | null }
export interface RitualBookView { cities: Readonly<Record<string, RitualCityBook>>; found: number; total: number; titles: readonly string[] }
export interface RitualRecordResult { recorded: boolean; already: boolean; titleNew: string | null; reason: string | null }
/** kayıt yapılmayan görüntüleme kipleri (sunucu `_gate`): test/yönetici modu her sahnede, yaratıcı mod kilitli sahnede
 * ritüeli oynatır ama anı defterine YAZMAZ (tasarım gereği; `test_walk_rituals.py`). İstemci bunu sessiz geçmez.*/
export type RitualViewOnly = "admin" | "creative";
export function viewOnlyOf(r: Pick<RitualRecordResult, "recorded" | "reason"> & { admin?: boolean }): RitualViewOnly | null {
  if (r.recorded) return null;
  if (r.admin === true || r.reason === "admin") return "admin";
  return r.reason === "creative" ? "creative" : null;
}

export class RitualApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = bodyText(res.status, await res.json()); } catch { /* gövde yok */ }
    throw new RitualApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Sunucu defterinin süzülmüş hâli (bilinmeyen alanlar yok sayılır). */
export function normalizeBook(raw: unknown): RitualBookView {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const src = (r.cities && typeof r.cities === "object" ? r.cities : {}) as Record<string, unknown>;
  const cities: Record<string, RitualCityBook> = {};
  for (const [c, v] of Object.entries(src)) {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const done = Array.isArray(o.done) ? o.done.flatMap((d): RitualDoneRow[] => {
      const x = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
      const id = str(x.id);
      return id ? [{ id, scope: x.scope === "map" ? "map" : "scene", day: str(x.day) ?? "" }] : [];
    }) : [];
    cities[c] = { found: num(o.found), total: num(o.total), done, title: str(o.title) };
  }
  return { cities, found: num(r.found), total: num(r.total), titles: Array.isArray(r.titles) ? r.titles.filter((t): t is string => typeof t === "string") : [] };
}

export const ritualApi = {
  book: async (): Promise<RitualBookView> => normalizeBook(await req<unknown>("GET", "/api/walk/rituals")),
  record: async (e: Pick<RitualDoneEvent, "memoryId" | "world" | "scope" | "at">): Promise<RitualRecordResult> => {
    const r = await req<Record<string, unknown>>("POST", "/api/walk/ritual", {
      id: e.memoryId, world: e.world, scope: e.scope, client_request_id: `rt-${e.memoryId}-${e.at}`,
    });
    // yönetici yanıtı `reason` taşımayabilir (eski sunucu): `admin: true` da görüntüleme kipidir
    const reason = str(r.reason) ?? (r.admin === true && r.recorded !== true ? "admin" : null);
    return { recorded: r.recorded === true, already: r.already === true, titleNew: str(r.title_new), reason };
  },
};

// ------------------------------------------------------------------ depo
interface RitualBookState { book: RitualBookView | null; loading: boolean; error: string | null }
export const useRitualBook = create<RitualBookState>(() => ({ book: null, loading: false, error: null }));

let inflight: Promise<void> | null = null;
/** Defteri (yeniden) yükler; aynı anda tek istek. */
export function loadRitualBook(): Promise<void> {
  if (inflight) return inflight;
  useRitualBook.setState({ loading: true, error: null });
  inflight = ritualApi.book()
    .then((book) => useRitualBook.setState({ book, loading: false, error: null }))
    .catch((e: unknown) => useRitualBook.setState({ loading: false, error: e instanceof Error ? e.message : String(e) }))
    .finally(() => { inflight = null; });
  return inflight;
}

/** Defterde bu anı zaten var mı (yüklüyse; yoksa bilinmez → false). */
export function inBook(book: RitualBookView | null, memoryId: string): boolean {
  const [, city, id] = memoryId.split(":");
  return !!book?.cities[city]?.done.some((d) => d.id === id);
}

/** Yeni unvan bildirimi (kanca dışında: `RitualBook` tost yardımcısını bağlar). */
export const ritualMemoryHooks: { onTitle: ((titleId: string) => void) | null } = { onTitle: null };

/**
 * Ritüel bitişi → anı kaydı. Dönüş `true` yalnız sunucu anıyı ilk kez yazdıysa (çalışma zamanı duyuruya "Anı defterine eklendi"
 * ekler). Defterde zaten olan, yönetici/yaratıcı görüntülemesi ve ağ hatası `false`: ritüel yine oynanmıştır.
 */
export async function recordRitual(e: RitualDoneEvent): Promise<boolean> {
  if (inBook(useRitualBook.getState().book, e.memoryId)) return false;
  try {
    const r = await ritualApi.record(e);
    const view = viewOnlyOf(r);
    if (view) { viewOnlyToast(view); return false; }
    if (!r.recorded || r.already) return false;
    if (r.titleNew) ritualMemoryHooks.onTitle?.(r.titleNew);
    void loadRitualBook();
    return true;
  } catch {
    return false;
  }
}

let unsubscribe: (() => void) | null = null;
/** `onRitualDone` aboneliği (bir kez; modül ömrü boyunca). Fotoğraf modunda HUD sökülse de anı yazılır. */
export function installRitualMemory(): void {
  if (unsubscribe) return;
  unsubscribe = onRitualDone((e) => { ritualToast(e); return recordRitual(e); });
}

/**
 * UXF-B: ritüel bitince görünür onay — dünyadaki kısa etiket ekran dışında kalabiliyordu ("Güvercinlere yem ver" F ile
 * kaydediliyor ama HUD'da hiçbir şey görünmüyordu). Yürüme tostu (4 sn, ekran okuyucu tost bölgesinden) ritüelin bitiş metnini söyler.
*/
/** test/yaratıcı modda ritüel oynandı ama kaydedilmedi → nedeni söyle (yoksa "yeni şehirde ritüel kaydolmuyor" sanılıyor).*/
function viewOnlyToast(view: RitualViewOnly): void {
  // ritüel bitiş tostunun ikinci satırı (ayrı tost üst üste biniyordu)
  try { pushWalkToastNote({ kind: "info", title: tx(ritualsMsg, view === "admin" ? "not_saved_admin" : "not_saved_creative") }); } catch { /* tost yoksa sessiz */ }
}

function ritualToast(e: RitualDoneEvent): void {
  const def = RITUALS.find((d) => d.id === e.id && d.city === e.city);
  if (!def) return;
  try { pushWalkToast({ kind: "info", title: ritualText(def, "done") }); } catch { /* tost yoksa sessiz */ }
}
