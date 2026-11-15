/**
 * EXP-INT (E1b) — çevre HUD durumu (zustand; seyrek): avatar yapılı dünyanın dışında mı, hangi biyomda, "Ofise dön" eylemi.
 * `Outskirts.tsx` yalnız değer değişince yazar; `components/world/walk/ExpanseChip.tsx` okur. Seçiciler ilkel değer döndürür.
 */
import { create } from "zustand";
import type { BiomeId } from "./biomes";

export interface ExpanseHud {
  /** avatar yapılı dünya ızgarasının dışında (çevrede) */
  outside: boolean;
  biome: BiomeId | null;
  /** E2: avatar keşif sınırı (yarıçap halkası) parselinde — "Keşif sınırı" bildirimi */
  edge: boolean;
  /** "Ofise dön": doğma karosuna ışınlar (Outskirts kaydeder; yürüme kapalıyken null) */
  home: (() => void) | null;
  set: (patch: Partial<Omit<ExpanseHud, "set">>) => void;
}

export const useExpanseHud = create<ExpanseHud>((set) => ({
  outside: false,
  biome: null,
  edge: false,
  home: null,
  set: (patch) => set(patch),
}));

export const useExpanseOutside = () => useExpanseHud((s) => s.outside);
export const useExpanseBiome = () => useExpanseHud((s) => s.biome);
export const useExpanseHome = () => useExpanseHud((s) => s.home);
export const useExpanseEdge = () => useExpanseHud((s) => s.edge);
