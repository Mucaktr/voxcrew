/**
 * E2 (PLOT-FE) — parsel deposu (zustand; seyrek): sunucudaki parseller, keşif yarıçapı, keşif bit kümesi, "Parselime git" isteği ve
 * mini harita katmanı. `lib/expanse.ts` doldurur; `Outskirts.tsx` (çizim, keşif, ışınlama) ve `MiniMap.tsx` okur. Seçiciler kararlı
 * referans döndürür.
 */
import { create } from "zustand";
import { RADIUS_MIN } from "./context";
import { EXPLORED_BYTES, exploredIndex, hasBit, type PlotInfo } from "./plots";

export interface PlotLayer {
  /** dünya karosu dikdörtgenleri: sahiplenilmiş parseller (renkli) ve keşfedilmiş parseller (soluk) */
  plots: { i0: number; j0: number; i1: number; j1: number; color: string; slot: number }[];
  explored: { i0: number; j0: number; i1: number; j1: number }[];
}

export interface PlotStore {
  /** verinin ait olduğu dünya (sahne kimliği ya da w_…) */
  world: string | null;
  plots: PlotInfo[];
  /** keşif yarıçapı (D2 A; sunucu ofis seviyesinden hesaplar) */
  radius: number;
  /** keşif bit kümesi (yerel birleşim; değişince yeni dizi) */
  explored: Uint8Array;
  /** sunucuya gönderilmemiş yeni keşif var */
  dirty: boolean;
  /** "Parselime git" isteği (yuva); Outskirts akış hazır olunca ışınlar ve temizler */
  goto: number | null;
  /** mini harita katmanı (Outskirts yerleşimi yayımlar; dünya karosu) */
  layer: PlotLayer | null;
  layerWorld: string | null;
  set: (patch: Partial<Omit<PlotStore, "set" | "markExplored">>) => void;
  /** yürürken girilen parseli işaretler (yeni ise true) */
  markExplored: (world: string, cx: number, cz: number) => boolean;
}

export const usePlotStore = create<PlotStore>((set, get) => ({
  world: null,
  plots: [],
  radius: RADIUS_MIN,
  explored: new Uint8Array(EXPLORED_BYTES),
  dirty: false,
  goto: null,
  layer: null,
  layerWorld: null,
  set: (patch) => set(patch),
  markExplored: (world, cx, cz) => {
    const st = get();
    if (st.world !== world) return false;
    const idx = exploredIndex(cx, cz);
    if (idx < 0 || hasBit(st.explored, idx)) return false;
    const next = st.explored.slice();
    next[idx >> 3] |= 1 << (idx & 7);
    set({ explored: next, dirty: true });
    return true;
  },
}));

const NO_PLOTS: PlotInfo[] = [];
/** Dünyanın parselleri (başka dünyanın verisi yüklüyse boş; kararlı referans). */
export const usePlotsFor = (world: string | null) => usePlotStore((s) => (world && s.world === world ? s.plots : NO_PLOTS));
export const usePlotRadius = (world: string | null) => usePlotStore((s) => (world && s.world === world ? s.radius : RADIUS_MIN));
export const usePlotLayer = (world: string | null) => usePlotStore((s) => (world && s.layerWorld === world ? s.layer : null));
