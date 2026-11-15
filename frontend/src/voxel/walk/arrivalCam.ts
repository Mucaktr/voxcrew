/**
 * (ürün sahibi 2026-10-29 "şehir portallarından geçince … kamera açıları … her şey kusursuz olsun") — varış karesinin kamerası.
 *
 * Dönüş ve çıkış pozu seçimi (`spawnFrame.ts framedReturn`) kareyi eskiden yalnız takip mesafesindeki yörünge pozuyla
 * (`orbitPose` + `resolveFollowCam`) ölçüyordu; WalkRig ise varıştan sonra ortam profilini (sokak/meydan/koridor: mesafe, görüş açısı,
 * omuz kayması), tavan sığdırmayı ve yaylı kolu (`followArm`) uygular. İki kamera aynı karede bambaşka yerde durur: seçim temiz
 * kadrajı "kapalı" sayıp kapıya dönük yedek yöne düşüyor, kapalı kadrajı "temiz" sayıp seçiyordu (otel çıkışları, varış denetimi
 * `scripts/arrival_check.mjs` / ARRIVAL-CAM-001). Burada aynı sabit durum çözümü (`interiors/viewCheck.ts
 * solveInteriorPose`, denetimin ölçüsü) seçime kamera olarak verilir (`FrameOpts.camAt`).
 *
 * Saf modül: React/three yok. Dünya başına kaynak/örtü/gezinme ızgarası önbellekli; karo × yaw başına çözüm önbellekli.
*/
import type { Block, Built } from "../scenes";
import { blockSource } from "../camera/world";
import { coverGrid, navGrid } from "./controller";
import { LOOK_DEFAULT } from "./scale";
import { solveInteriorPose } from "../interiors/viewCheck";

type V3 = [number, number, number];
/** kamera konumu ve profilin dikey görüş açısı (ayar değeri, `walkFov` girdisi); göz yedeğinde null */
export type CamAt = (x: number, z: number, yaw: number) => { cam: V3; fov: number } | null;

const cache = new WeakMap<object, Map<string, CamAt>>();

/**
 * Dış dünyanın sabit durum takip kamerası: karo (x, z'nin karosu) ve yaw için kamera konumu; kamera göz yedeğine düşüyorsa
 * (avatar gizli) null. `extra`: dünyanın bloklarında olmayan çizim blokları (şehir geçidinin kemeri).
 */
export function steadyCam(built: Built, extra: readonly Block[] = []): CamAt {
  let m = cache.get(built);
  if (!m) { m = new Map(); cache.set(built, m); }
  const key = extra.length ? extra.map((b) => `${b.p.join(",")}|${b.s.join(",")}`).join(";") : "";
  const hit = m.get(key);
  if (hit) return hit;
  const blocks = extra.length ? [...built.blocks, ...extra] : built.blocks;
  const src = blockSource(blocks), cover = coverGrid(extra.length ? { width: built.width, depth: built.depth, blocks } : built), nav = navGrid(built);
  const poses = new Map<string, { cam: V3; fov: number } | null>();
  const fn: CamAt = (x, z, yaw) => {
    const i = Math.floor(x + 12), j = Math.floor(z + 8);
    const k = `${i},${j},${yaw.toFixed(4)}`;
    if (!poses.has(k)) {
      const r = solveInteriorPose(src, cover, nav, blocks as Block[], i, j, yaw, LOOK_DEFAULT, null);
      poses.set(k, r.eye ? null : { cam: r.cam, fov: r.fov });
    }
    return poses.get(k)!;
  };
  m.set(key, fn);
  return fn;
}
