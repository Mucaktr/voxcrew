/**
 * E3 (BUILD-UX) — kapasite kuyruğunda inşa düzeni (E1b `expanse/tail.ts`).
 *
 * Grup başına kuyruk: `[akış yuvaları: TAIL_CAP][hayalet: GHOST_SLOTS][inşa bölgesi: mesh kapasitesine kadar]`. Hepsi aynı
 * `InstancedMesh`'te: yeni mesh, malzeme ya da ışık yok → **+0 çizim çağrısı**. `mesh.count` akış ucu ile inşa ucunun büyüğüdür
 * (inşa yoksa ve hayalet kapalıysa bugünkü gibi yalnız akış). Kapasite `store.ts tailExtraFor` ile gövdelerden boyutlanır
 * (`Blocks.tsx`), bu yüzden inşa bölgesi taşmaz.
*/
import { TAIL_CAP, TAIL_GROUPS, type TailGroup } from "../expanse/stream";
import { GHOST_SLOTS } from "./store";

/** Hayalet yuvasının başlangıcı (akış yuvalarından hemen sonra). */
export const ghostOffset = (g: TailGroup) => TAIL_CAP[g];
/** İnşa bölgesinin başlangıcı. */
export const buildOffset = (g: TailGroup) => TAIL_CAP[g] + GHOST_SLOTS[g];

/** Çalışma durumu (Outskirts + BuildLayer ortak; React dışı). */
export const buildTail = {
  /** grup başına inşa bölgesinde kullanılan örnek */
  used: Object.fromEntries(TAIL_GROUPS.map((g) => [g, 0])) as Record<TailGroup, number>,
  /** hayalet çizili mi */
  ghost: false,
  /** yazılamayan inşa örneği (kapasite yetmedi; denetim 0 ister) */
  dropped: 0,
};

/** Grubun inşa/hayalet ucu (0: kullanılmıyor). */
export function buildEnd(g: TailGroup): number {
  if (buildTail.used[g] > 0) return buildOffset(g) + buildTail.used[g];
  return buildTail.ghost && GHOST_SLOTS[g] > 0 ? ghostOffset(g) + GHOST_SLOTS[g] : 0;
}
