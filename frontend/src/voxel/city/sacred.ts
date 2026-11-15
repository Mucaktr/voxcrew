/**
 * SP-W0 — sacred bölge sorguları. İbadet yerleri yalnız dış silüettir; çevresinde
 * istasyon, uyku, dinlenme, araç/kahve noktası (SACRED-ANCHOR-001), 3 karo içinde eğlence yeri (SACRED-FUN-001) ve
 * ambient şaka/konma kancası (SACRED-AMBIENT-001) olmaz. Dinî ses yok.
 *
 * Çalışma anı: World.tsx `setQuietZone((t) => isInSacredBuffer(t, built))` ile S48'in eğlence/ortam beynine bağlanır —
 * varsayılan pay `SACRED_FUN_MARGIN` (3 karo) olduğundan eğlence yeri, şaka, şakşak ve ambient şakalar bu alanda başlamaz.
 * Yalnız tip içe aktarır (döngüsel içe aktarma yok).
*/
import type { Built, SceneZone, Tile } from "../scenes";

/** Ayak izinin çevresindeki varsayılan tampon (karo): bu alanda çapa (istasyon/uyku/…) olmaz. */
export const SACRED_BUFFER = 1;
/** Ayak izinden bu kadar karo içinde eğlence yeri / şaka yok (SACRED-FUN-001). */
export const SACRED_FUN_MARGIN = 3;

type Zoned = Pick<Built, "zones"> | null | undefined;

/** Sahnedeki sacred bölgeler (yoksa boş dizi; her çağrıda yeni dizi üretmez). */
const NONE: SceneZone[] = [];
export function sacredZones(built: Zoned): SceneZone[] {
  const z = built?.zones;
  if (!z?.length) return NONE;
  return z.some((x) => x.kind !== "sacred") ? z.filter((x) => x.kind === "sacred") : z;
}

/** Karonun ayak izine Chebyshev uzaklığı (içerideyse 0). */
export function zoneDistance(t: Tile, z: SceneZone): number {
  const di = t[0] < z.i0 ? z.i0 - t[0] : t[0] >= z.i0 + z.w ? t[0] - (z.i0 + z.w - 1) : 0;
  const dj = t[1] < z.j0 ? z.j0 - t[1] : t[1] >= z.j0 + z.d ? t[1] - (z.j0 + z.d - 1) : 0;
  return Math.max(di, dj);
}

/**
 * Karo bir sacred bölgenin `margin` karo yakınında mı. Varsayılan `margin` = `SACRED_FUN_MARGIN` (3): S48 eğlence/ortam
 * beyni için doğrudan `setQuietZone((t) => isInSacredBuffer(t, built))`. Çapa kuralı (SACRED-ANCHOR-001) bölgenin kendi
 * `buffer` değerini kullanır: `isInSacredBuffer(t, built, "anchor")`.
 */
export function isInSacredBuffer(tile: Tile, built: Zoned, margin: number | "anchor" = SACRED_FUN_MARGIN): boolean {
  for (const z of sacredZones(built)) {
    const m = margin === "anchor" ? (z.buffer ?? SACRED_BUFFER) : Math.max(margin, z.buffer ?? SACRED_BUFFER);
    if (zoneDistance(tile, z) <= m) return true;
  }
  return false;
}

/** Bölge içinde mi (tampon dahil, `SACRED-AMBIENT-001`: kuş konmaz, kedi tırmanmaz). */
export const isInSacred = (tile: Tile, built: Zoned) => isInSacredBuffer(tile, built, "anchor");
