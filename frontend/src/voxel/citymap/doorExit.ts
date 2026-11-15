/**
 * ARRIVAL-QA (ürün sahibi 2026-10-29 "portallardan geçince … kamera açıları kusursuz") — şehir haritası landmark kapısından çıkış pozu.
 *
 * Eskiden avatar kapının hemen dışına (1 karo) bırakılıyordu: takip kamerası arkadaki cepheye çarpıp kaldırma yedeğine düşüyor,
 * kare tepeden avatarın başına bakıyordu (Kapalıçarşı). Çıkış karosu kapıdan simgenin uzağına doğru en çok 4 karo (aradakiler de yürünebilir
 * ve başka bir tetik — landmark kapısı, durak, seyir noktası — değil), olmazsa 1 karo; yön simgeden uzağa, o yön 3 karodan kısa açıksa
 * (köprü korkuluğu, karşı cephe) ±90° içindeki en açık yön. Saf modül.
*/
import type { CityTile } from "./format";
import { walkableKind, type DistrictOut } from "./district";
import { rayOpen, VIEW_DIRS, type SightFn } from "../walk/spawnView";
import { exitPose } from "./arrivalPoses";

export interface LandmarkExit { dir: [number, number]; out: CityTile; heading: number;
  /** takip kamerasının yaw'ı: avatarın yönünden ±45° (açık yana) — kamera tam arkada kapının geçit perdesine düşmez */
  aim: number }

/** Kapıdan dışarı yön (simge ayak izinin merkezinden kapıya) — CityRig'in kapı tetiğiyle aynı kural. */
export function landmarkDoorDir(plan: Pick<DistrictOut, "i0" | "j0">, door: CityTile, lm: { i0: number; j0: number; w: number; d: number }): [number, number] {
  const cx = plan.i0 + lm.i0 + (lm.w - 1) / 2, cz = plan.j0 + lm.j0 + (lm.d - 1) / 2;
  const dx = door[0] - cx, dz = door[1] - cz;
  return Math.abs(dx) > Math.abs(dz) ? [Math.sign(dx), 0] : [0, Math.sign(dz) || 1];
}

export function landmarkExit(plan: Pick<DistrictOut, "i0" | "j0" | "w" | "d" | "kind" | "doors" | "stops" | "viewpoints"> & { mapId?: string }, door: CityTile,
  lm: { i0: number; j0: number; w: number; d: number }, sight: SightFn | null = null): LandmarkExit {
  const dir = landmarkDoorDir(plan, door, lm);
  // ölçülmüş çıkış pozu (cephe/köprü gövdesi takip kamerasını kaplıyordu; arrivalPoses.ts)
  const fixed = plan.mapId ? exitPose(plan.mapId, door) : null;
  // FIXPACK-D: ölçülmüş poz karosu yürünür değilse (plan değişti) kullanılmaz — avatar katı karoya bırakılmaz, ölçüsüz kurala düşer
  const walkT = (t: CityTile) => { const li = t[0] - plan.i0, lj = t[1] - plan.j0; return li >= 0 && lj >= 0 && li < plan.w && lj < plan.d && walkableKind(plan.kind[lj * plan.w + li]); };
  if (fixed && walkT(fixed.out)) return { dir, ...fixed };
  const trig = new Set<string>([...plan.doors.map((x) => `${x.tile[0]},${x.tile[1]}`), ...plan.stops.map((x) => `${x.tile[0]},${x.tile[1]}`),
    ...plan.viewpoints.map((t) => `${t[0]},${t[1]}`)]);
  const ok = (t: CityTile) => {
    const li = t[0] - plan.i0, lj = t[1] - plan.j0;
    return li >= 0 && lj >= 0 && li < plan.w && lj < plan.d && walkableKind(plan.kind[lj * plan.w + li]) && !trig.has(`${t[0]},${t[1]}`);
  };
  const at = (k: number): CityTile => [door[0] + k * dir[0], door[1] + k * dir[1]];
  let n = 1;
  while (n < EXIT_MAX && ok(at(n)) && ok(at(n + 1))) n++;
  const out = at(n), away = Math.atan2(dir[0], dir[1]);
  // bakış: simgeden uzağa en az 3 karo açık değilse (köprü korkuluğu, karşı cephe) ±90° içindeki en açık yön
  let heading = away;
  if (sight && rayOpen(sight, out, dir[0], dir[1]) < 3) {
    // bakış: simgeden uzağa en az 3 karo açık değilse (köprü korkuluğu, karşı cephe) ±90° içindeki en açık yön
    let bestRay = -1;
    for (const d of VIEW_DIRS) {
      if (Math.abs(Math.atan2(Math.sin(d.yaw - away), Math.cos(d.yaw - away))) > Math.PI / 2 + 1e-6) continue;
      const r = rayOpen(sight, out, d.di, d.dj);
      if (r > bestRay) { bestRay = r; heading = d.yaw; }
    }
  }
  // kamera yaw'ı: ±45° — kamera tarafı (yaw + π) daha açık olan yan; görüş ızgarası yoksa +45°
  const side = (s: number) => { const y = heading + s * Math.PI / 4 + Math.PI; return sight ? rayOpen(sight, out, Math.round(Math.sin(y)), Math.round(Math.cos(y))) : 0; };
  const aim = heading + (side(-1) > side(1) ? -1 : 1) * Math.PI / 4;
  return { dir, out, heading, aim };
}
/** Çıkış en çok bu kadar karo dışarı: takip kamerası avatarın ~2,9 birim arkasında — 3 karoda kamera kapının geçit perdesinin
 *  içinde kalıyordu (Londra saat kulesi), 4 karoda perde kameranın arkasında. */
export const EXIT_MAX = 4;
