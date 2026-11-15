/**
 * E2 (PLOT-FE) — parsel halkası yerleşimi, parsel durumu ve keşif bit kümesi (7.3, §12
 * `PLOT-RING-001`). Saf veri; React/three yok (`expanse_check.mjs` Node'da paketler).
 *
 * - **Konum saklanmaz (§7.2).** Sunucu yalnız yuva sırasını (`slot`, 0…11) bilir. `plotRing(def, built)` yuvaları yapılı dünya
 * kutusunun hemen dışındaki ilk parsel halkasına, ufuk bandı/simge/hareketli yolu dışında, önden başlayarak yerleştirir
 * (`context.ts plotSlots`). Ajan sayısı değişip kutu büyüyünce yuvalar içerikleriyle birlikte dışa kayar; `planDistricts`
 * çıktısına dokunulmaz.
 * - Yerleşim her zaman **taban keşif yarıçapıyla** (`RADIUS_MIN`) kurulan bağlamdan alınır: seviyeyle büyüyen yarıçap (D2 A) yuva
 * sırasını değiştirmez (mini harita, "Parselime git" ve çizim aynı yeri görür).
 * - Sahiplenilmiş parsel, çevre akışında yabani parselin yerine `generateParcel(…, { color })` ile çizilir: düzleştirilmiş zemin,
 * çit, mola bankı, yazısız renk rozeti — aynı kuyruk yuvası (+0 çizim çağrısı), aynı çarpışma ızgarası.
 * - Depo (`plotStore.ts`): lib/expanse.ts doldurur, Outskirts ve MiniMap okur.
 * - Keşif kümesi taban çerçevesinde (cx, cz) ∈ [−32, 32)² → 64 × 64 bit (512 bayt; sunucuyla aynı). Yalnız mini harita; ödül yok.
*/
import type { Built } from "../scenes";
import { buildWorld } from "../scenes";
import { expanseContext, plotSlots, RADIUS_MIN, type ExpanseContext, type ExpanseSceneDef, type PlotSlot } from "./context";
import type { PlotDecor } from "./generate";
import { generateParcel } from "./generate";
import { PD, pkey, PW } from "./grid";

/** Rozet renkleri (yazısız; sunucu `expanse/service.py PLOT_COLORS` ile aynı sıra). */
export const PLOT_COLORS = ["#E5484D", "#F59E0B", "#22C55E", "#06B6D4", "#3B82F6", "#8B5CF6", "#EC4899", "#F5F5F4"] as const;
export type PlotColor = (typeof PLOT_COLORS)[number];

export const EXPLORED_SPAN = 64;
export const EXPLORED_OFFSET = 32;
export const EXPLORED_BYTES = (EXPLORED_SPAN * EXPLORED_SPAN) / 8;

/** Sunucudaki parsel (konumsuz). */
export interface PlotInfo {
  id: string;
  slot: number;
  color: string;
  name: string;
  /** yönetici/test modu deneme parseli */
  trial: boolean;
  edits: number;
  prefabs: number;
}

/** Yerleştirilmiş parsel: yuva + taban çerçevesinde (cx, cz) + dünya karosu dikdörtgeni. */
export interface PlacedPlot extends PlotInfo {
  cx: number;
  cz: number;
  /** dünya ızgarası karo dikdörtgeni (i1/j1 hariç) */
  tiles: { i0: number; j0: number; i1: number; j1: number };
  /** yuva bu dünyada yok (ör. dünya küçülünce halkada yer kalmadı): parsel saklı, görünmez */
  unplaced?: boolean;
}

export interface PlotRing {
  ctx: ExpanseContext;
  slots: PlotSlot[];
}

const ringCache = new WeakMap<Built, Map<string, PlotRing>>();

/**
 * Yuva halkası (`PLOT-RING-001`): taban yarıçaplı bağlam + `plotSlots`. Aynı `built` + sahne için önbellekli (yürüme girişinde
 * birkaç ms; dünya değişince yeniden).
 */
export function plotRing(def: ExpanseSceneDef, built: Built, base?: Built): PlotRing {
  let byScene = ringCache.get(built);
  if (!byScene) { byScene = new Map(); ringCache.set(built, byScene); }
  const hit = byScene.get(def.id);
  if (hit) return hit;
  const ctx = expanseContext(def, built, { radius: RADIUS_MIN, base: base ?? buildWorld(def.id, 1) });
  const out = { ctx, slots: plotSlots(ctx) };
  byScene.set(def.id, out);
  return out;
}

/** Parselleri halkaya yerleştirir (dünya karosu dikdörtgeniyle); yuvası olmayan `unplaced`. */
export function placePlots(ring: PlotRing, plots: readonly PlotInfo[]): PlacedPlot[] {
  const [di, dj] = ring.ctx.origin;
  return plots.map((p) => {
    const s = ring.slots[p.slot];
    if (!s) return { ...p, cx: 0, cz: 0, tiles: { i0: 0, j0: 0, i1: 0, j1: 0 }, unplaced: true };
    const i0 = s.cx * PW + di, j0 = s.cz * PD + dj;
    return { ...p, cx: s.cx, cz: s.cz, tiles: { i0, j0, i1: i0 + PW, j1: j0 + PD } };
  });
}

/** Akış için: parsel anahtarı (taban çerçevesi) → donatı. */
export function plotDecorMap(placed: readonly PlacedPlot[]): Map<string, PlotDecor> {
  const out = new Map<string, PlotDecor>();
  for (const p of placed) if (!p.unplaced) out.set(pkey(p.cx, p.cz), { color: p.color });
  return out;
}

/**
 * "Parselime git": sahiplenilmiş parselin (verilen bağlamda üretilen) yürünebilir karolarından merkeze en yakını; dünya karosu.
 * Parsel üretilemezse (bastırıldı) null.
 */
export function plotEntry(ctx: ExpanseContext, p: Pick<PlacedPlot, "cx" | "cz" | "color">): [number, number] | null {
  const out = generateParcel(ctx, p.cx, p.cz, "both", { color: p.color });
  if (!out?.near) return null;
  let best = -1, bd = Infinity;
  for (let k = 0; k < out.near.walk.length; k++) {
    if (!out.near.walk[k]) continue;
    const d = ((k % PW) - 5.5) ** 2 + (Math.floor(k / PW) - 7.5) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  if (best < 0) return null;
  return [p.cx * PW + (best % PW) + ctx.origin[0], p.cz * PD + Math.floor(best / PW) + ctx.origin[1]];
}

// ------------------------------------------------------------------ keşif bit kümesi
/** (cx, cz) → bit dizini; aralık dışı −1. */
export function exploredIndex(cx: number, cz: number): number {
  const x = cx + EXPLORED_OFFSET, z = cz + EXPLORED_OFFSET;
  return x < 0 || z < 0 || x >= EXPLORED_SPAN || z >= EXPLORED_SPAN ? -1 : z * EXPLORED_SPAN + x;
}

export function decodeBits(b64: string | null | undefined): Uint8Array {
  const out = new Uint8Array(EXPLORED_BYTES);
  if (!b64) return out;
  try {
    const bin = atob(b64);
    for (let k = 0; k < Math.min(bin.length, EXPLORED_BYTES); k++) out[k] = bin.charCodeAt(k);
  } catch { /* bozuk: boş */ }
  return out;
}

export function encodeBits(bits: Uint8Array): string {
  let s = "";
  for (let k = 0; k < bits.length; k++) s += String.fromCharCode(bits[k]);
  return btoa(s);
}

export const hasBit = (bits: Uint8Array, idx: number) => idx >= 0 && (bits[idx >> 3] & (1 << (idx & 7))) !== 0;

/** Keşfedilen parseller (taban çerçevesi). */
export function exploredParcels(bits: Uint8Array): [number, number][] {
  const out: [number, number][] = [];
  for (let idx = 0; idx < EXPLORED_SPAN * EXPLORED_SPAN; idx++) {
    if (hasBit(bits, idx)) out.push([(idx % EXPLORED_SPAN) - EXPLORED_OFFSET, Math.floor(idx / EXPLORED_SPAN) - EXPLORED_OFFSET]);
  }
  return out;
}
