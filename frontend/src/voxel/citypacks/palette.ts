/**
 * CITY-PACKS — dünya yapıcı paleti: `builder` yüzeyli paketlerin öğeleri `decor` prefab'ı olarak yerleşir (dünya biçimi
 * değişmez; sunucu `worlds/validate.py` parçaları zaten doğrular: ≤ 400 parça, ≤ 256 hücre, bilinen gruplar). Var olan
 * yerleştirme her zaman çizilir; yalnız YENİ yerleştirme paket sahipliğine bağlıdır (builder_materials kuralı).
 * Saf modül; lib/builder.ts `PALETTE` sonuna ekler.
 */
import type { Prefab } from "../prefabs";
import { CITY_PACKS, type PackItem } from "./catalog";
import { footprintCells } from "./kit";

export const CITY_PALETTE_CAT = "citypack" as const;
/** Palet kimliği: `cp_<paket>__<öğe>` (palet kimliği biçimi alt çizgi; ayırıcı çift alt çizgi). */
export const paletteId = (it: Pick<PackItem, "pack" | "id">) => `cp_${it.pack.replace(/-/g, "_")}__${it.id.replace(/-/g, "_")}`;

export function decorOf(it: PackItem, i: number, j: number): Prefab {
  const parts = it.boxes().map(([dx, y, dz, w, h, d, c, g]) => [dx, y, dz, w, h, d, c, g] as [number, number, number, number, number, number, string, typeof g]);
  // katı öğe bütün ayak izini engeller; yürünür öğe (kaldırım, ışık zinciri) yalnız çapa karosunu tutar: seçilip silinebilsin
  return { t: "decor", i, j, parts, cells: it.solid ? footprintCells(it.w, it.d) : [[0, 0]] };
}

export interface CityPaletteEntry {
  id: string; cat: typeof CITY_PALETTE_CAT; kind: "prefab"; color: string; pack: string; item: PackItem;
  make: (i: number, j: number) => Prefab;
}

/** Öğenin palet çip rengi: en büyük hacimli katı kutunun rengi. */
function chipColor(it: PackItem): string {
  let best = "#9CA3AF", vol = -1;
  for (const b of it.boxes()) { const v = b[3] * b[4] * b[5]; if (v > vol) { vol = v; best = b[6]; } }
  return best;
}

export const CITY_PALETTE: readonly CityPaletteEntry[] = CITY_PACKS.filter((p) => p.surfaces.includes("builder"))
  .flatMap((p) => p.list.map((it) => ({ id: paletteId(it), cat: CITY_PALETTE_CAT, kind: "prefab" as const, color: chipColor(it), pack: p.id, item: it,
    make: (i: number, j: number) => decorOf(it, i, j) })));
export const CITY_PALETTE_BY_ID: ReadonlyMap<string, CityPaletteEntry> = new Map(CITY_PALETTE.map((e) => [e.id, e]));
