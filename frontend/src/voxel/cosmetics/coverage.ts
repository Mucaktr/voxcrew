/**
 * COS-B — "her yerde çizili" kapsamı: kayıt defterindeki her (parça, yüzey) çiftinin çizicisini GERÇEKTEN çalıştırır.
 * Çıktı COS-A sözleşmesidir (backend/studio/cosmetics/coverage.py, `schema: 1`); `frontend/scripts/cosmetic_coverage.mjs`
 * bunu JSON'a yazar. Saf modül: three/React/DOM yok.
 *
 * Denetimler:
 * - avatar / me: `characterParts` (Crowd ve Character'in ortak listesi) kıyafetle en az 6 kutu fazla üretir; saydamlık yalnız
 *   Crowd toplu gruplarındaki değerlerde (yeni çizim çağrısı yok); "Ben" yaka kartı korunur.
 * - desk: kutular masa üstünde (y ≥ 0) ve masa ayak izinde (|x| ≤ 14, |z| ≤ 8 px); ≥ 6 kutu.
 * - world: tema renkleri #RRGGBB; ≥ 6 kutu; kutular dünya fonunda (|x| ≥ 34 ya da z ≤ −24 px; ofis zeminini kapatmaz).
 * - celebration: hareketli kareler değişir; statik hâl (calm) boş değildir ve zamandan bağımsızdır.
 * - collection: TR ve EN adı vardır (Koleksiyon listesinde çizilir).
 * - her yüzeyin kayıtlı bir çizicisi vardır; `live` çizicinin canlı uygulamada da çalıştığını bildirir.
 */
import { DEFAULT_AVATAR } from "../avatar";
import { characterParts } from "../parts";
import { cosmeticsMsg, itemKey } from "../../locales/cosmetics";
import { COSMETIC_SETS, rendererFor, type CosmeticItem, type CosmeticSet, type SceneBox, type Surface } from "./registry";

export const COVERAGE_SCHEMA = 1;
const CROWD_OPACITY = new Set([0.32, 0.45, 0.82, 0.95]);
const HEX = /^#[0-9A-Fa-f]{6}$/;

export interface SurfaceResult { drawn: boolean; live: boolean; renderer: string | null; contexts: string[]; boxes: number; reason?: string }
export interface ItemResult { surfaces: Partial<Record<Surface, SurfaceResult>>; reduced_motion_static?: boolean; slot: string }
export interface SetResult {
  items: Record<string, ItemResult>; ip_risk: number; culture_risk: number; coverage: number; complete: boolean;
  missing: string[]; preview_375?: { checked: boolean; overflow: boolean; measured_at?: string; note?: string };
}
export interface CoverageFile { schema: number; generated_at: string; generator: string; sets: Record<string, SetResult>; totals: { surfaces: number; drawn: number; coverage: number } }

const BASE = { ...DEFAULT_AVATAR, hat: "none", glasses: "none" } as const;
const boxCount = (a: typeof BASE & { wear?: string }, badge: boolean) =>
  characterParts({ ...a }, null, badge).filter((p) => p.kind === "box" && !p.carry && !p.device);

function checkOutfit(item: CosmeticItem, badge: boolean): { boxes: number; reason?: string } {
  const plain = boxCount(BASE, badge), worn = boxCount({ ...BASE, wear: item.id }, badge);
  const added = worn.length - plain.length;
  if (added < 6) return { boxes: added, reason: "parça listesine kıyafet eklenmiyor" };
  const bad = worn.find((p) => p.kind === "box" && p.o !== undefined && !CROWD_OPACITY.has(p.o));
  if (bad) return { boxes: added, reason: `Crowd grubunda olmayan saydamlık ${bad.kind === "box" ? bad.o : ""}` };
  if (badge && !worn.some((p) => p.kind === "box" && p.c === "#FFB547")) return { boxes: added, reason: "Ben yaka kartı kayboldu" };
  return { boxes: added };
}
const finite = (b: SceneBox) => [...b.p, ...b.s].every(Number.isFinite) && b.s.every((v) => v > 0) && HEX.test(b.c);

function checkSurface(item: CosmeticItem, surface: Surface): { boxes: number; reason?: string } {
  switch (surface) {
    case "avatar": return item.slot === "outfit" ? checkOutfit(item, false) : { boxes: 0, reason: "yuva bu yüzeyi çizmez" };
    case "me": return item.slot === "outfit" ? checkOutfit(item, true) : { boxes: 0, reason: "yuva bu yüzeyi çizmez" };
    case "desk": {
      if (item.slot !== "desk") return { boxes: 0, reason: "yuva bu yüzeyi çizmez" };
      const b = item.boxes();
      if (b.length < 6 || !b.every(finite)) return { boxes: b.length, reason: "masa süsü boş ya da geçersiz" };
      const out = b.find((x) => x.p[1] - x.s[1] / 2 < -0.01 || Math.abs(x.p[0]) + x.s[0] / 2 > 14 || Math.abs(x.p[2]) + x.s[2] / 2 > 8);
      return out ? { boxes: b.length, reason: `masa ayak izi dışında: ${out.p.join(",")}` } : { boxes: b.length };
    }
    case "world": {
      if (item.slot !== "world") return { boxes: 0, reason: "yuva bu yüzeyi çizmez" };
      const t = item.theme;
      if (![t.sky, t.hemiSky, t.hemiGround, t.sun, t.wall, t.lamp, ...t.floor].every((c) => HEX.test(c))) return { boxes: 0, reason: "tema rengi geçersiz" };
      const b = t.boxes();
      if (b.length < 6 || !b.every(finite)) return { boxes: b.length, reason: "tema çevresi boş ya da geçersiz" };
      const inside = b.find((x) => Math.abs(x.p[0]) < 34 && x.p[2] > -24);
      return inside ? { boxes: b.length, reason: `tema kutusu ofis zemininde: ${inside.p.join(",")}` } : { boxes: b.length };
    }
    case "celebration": {
      if (item.slot !== "celebration") return { boxes: 0, reason: "yuva bu yüzeyi çizmez" };
      const a = item.frame(0.2, false), m = item.frame(0.6, false);
      if (!a.length || !m.length || !a.every(finite) || !m.every(finite)) return { boxes: a.length, reason: "kutlama karesi boş" };
      if (JSON.stringify(a) === JSON.stringify(m)) return { boxes: a.length, reason: "kutlama hareket etmiyor" };
      return { boxes: Math.max(a.length, m.length) };
    }
    case "collection": {
      const k = itemKey(item.id);
      const ok = !!(cosmeticsMsg.tr as Record<string, string>)[k] && !!(cosmeticsMsg.en as Record<string, string>)[k];
      return ok ? { boxes: 1 } : { boxes: 0, reason: "Koleksiyon adı (TR/EN) yok" };
    }
    default: return { boxes: 0, reason: "bu dalgada çizici yok" };
  }
}

/** Hareket azaltma statik hâli: boş değil, zamandan bağımsız. */
export function staticCelebration(item: CosmeticItem): boolean {
  if (item.slot !== "celebration") return false;
  const a = item.frame(0, true), b = item.frame(0.5, true), c = item.frame(0.95, true);
  return a.length > 0 && a.every(finite) && JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(b) === JSON.stringify(c);
}

export function setCoverage(set: CosmeticSet): SetResult {
  const items: Record<string, ItemResult> = {};
  const missing: string[] = [];
  let total = 0, drawn = 0;
  for (const item of set.items) {
    const row: ItemResult = { slot: item.slot, surfaces: {} };
    for (const s of item.surfaces) {
      const r = rendererFor(item.slot, s);
      const c = r ? checkSurface(item, s) : { boxes: 0, reason: "kayıtlı çizici yok" };
      const ok = !!r && !c.reason;
      row.surfaces[s] = { drawn: ok, live: ok && !!r?.live, renderer: r?.renderer ?? null, contexts: r?.contexts ?? [], boxes: c.boxes,
        ...(c.reason ? { reason: c.reason } : {}) };
      total++;
      if (ok && r?.live) drawn++; else missing.push(`${item.id}:${s}${c.reason ? ` (${c.reason})` : ""}`);
    }
    if (item.surfaces.includes("celebration")) {
      row.reduced_motion_static = staticCelebration(item);
      if (!row.reduced_motion_static) missing.push(`${item.id}:reduced_motion_static`);
    }
    items[`store:${item.id}`] = row;
  }
  if (set.ip_risk > 1 || set.culture_risk > 1) missing.push(`risk ip=${set.ip_risk} culture=${set.culture_risk}`);
  return { items, ip_risk: set.ip_risk, culture_risk: set.culture_risk, coverage: total ? drawn / total : 0, complete: missing.length === 0, missing };
}

export function computeCoverage(now = new Date()): CoverageFile {
  const sets: Record<string, SetResult> = {};
  let surfaces = 0, drawn = 0;
  for (const s of COSMETIC_SETS) {
    const r = setCoverage(s);
    sets[s.id] = r;
    for (const it of Object.values(r.items)) for (const v of Object.values(it.surfaces)) { surfaces++; if (v?.drawn && v.live) drawn++; }
  }
  return { schema: COVERAGE_SCHEMA, generated_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"), generator: "frontend/scripts/cosmetic_coverage.mjs",
    sets, totals: { surfaces, drawn, coverage: surfaces ? drawn / surfaces : 0 } };
}
