/**
 * CAMERA — WalkRig'e en küçük kanca: yaylı kolu bir kamera pozuna uygular, kare sonunda güvenlik denetimi yapar ve çatı
 * kesitinin titreşim geçişini yürütür. React/three yok (düz {x, y, z} nesneleri; THREE.Vector3 de uyar).
 *
 * Kullanım (WalkRig, kare başı):
 *   followArm(rig, built, pivot, cam, look, { dt, calm, near, fov, aspect, footY, lift, whiskers })  // takip/yolculuk/fotoğraf
 *   …kayma (lerp)…
 *   armSafety(rig, camPos)       // gecikmeli konum katıya girmesin: pivot → kamera yeniden süpürülür, gerekirse aynı karede kısalır
 *   releaseArm(rig)              // kolun uygulanmadığı kip (birinci şahıs, göz yedeği, iç mekân oda/salon kesiti, manzara)
 */
import type { Built } from "../scenes";
import { ARM_EYE, createArm, nudgePivot, probeRadius, solveArm, stepArm, sweepArm, type ArmPose, type ArmState, type BoxSource } from "./collide";
import { cameraSource } from "./world";
import { createRoofFade, type RoofFade } from "./occlusion";
import { fitUnderCeiling, type CeilingFit } from "./ceiling";
import type { CutPlan } from "../walk/cover";

type P3 = { x: number; y: number; z: number };

export interface CamRig {
  arm: ArmState;
  pose: ArmPose;
  src: BoxSource | null;
  built: object | null;
  /** bu karede kolun uygulandığı pivot (güvenlik denetimi bunu kullanır) ve süpürme ölçüleri */
  pivot: [number, number, number];
  radius: number;
  floorTop: number;
  active: boolean;
  /** çatı kesiti titreşim geçişi (WalkRig `stepRoofFade`) */
  fade: RoofFade<NonNullable<CutPlan["roof"]>>;
  /** ölçüm: son karede kolu kısaltan engel var mı, güvenlik denetimi düzeltti mi */
  hit: boolean;
  safety: number;
}

export const createCamRig = (): CamRig => ({
  arm: createArm(), pose: { ux: 0, uy: 0, uz: 1, desired: 0, hard: 0, soft: 0, lifted: false, elev: 0 }, src: null, built: null,
  pivot: [0, 0, 0], radius: 0.32, floorTop: 0.2, active: false, fade: createRoofFade(), hit: false, safety: 0,
});

/** Yakın kadraj: kol bundan kısaysa bakış avatarın `CLOSE_AHEAD` önüne ve `CLOSE_RISE` yukarısına kayar (tam etki `ARM_EYE`'de). */
export const CLOSE_LEN = 2.4;
export const CLOSE_AHEAD = 1.6;
export const CLOSE_RISE = 0.35;
/** Zemin payı: pivot ayağının bu kadar üstüne kadar tepesi kalan bloklar (kaldırım, basamak, yol) çarpışmaya girmez. */
export const FLOOR_PAD = 0.2;

export interface ArmOpts {
  dt: number; calm: boolean;
  /** kamera optiği (küre yarıçapı yakın düzlem köşesinden) */
  near: number; fov: number; aspect: number;
  /** iç mekân + dikey telefon — sonda yarıçapı ARM_RADIUS tabanı olmadan (collide.ts probeRadius)*/
  tight?: boolean;
  /** avatar ayak yüksekliği (zemin eşiği) */
  footY: number;
  /** kaldırma yedeği (takip kamerası) ve bıyıklar */
  lift?: boolean; whiskers?: boolean;
  /** INTERIOR-CAM: kaldırma yükselişinin üst sınırı (rad; profil `elevMax`) */
  maxElev?: number;
}

/**
 * Kamerayı (`cam`, yerinde) pivot → kamera kolu boyunca açık boya çeker; bakış noktası (`look`) aynı ötelemeyle taşınır (yönelim
 * değişmez). Kaldırma yedeğinde kamera daha dik yükselişe geçer ve bakış avatara döner.
 */
/** Kolun dünya kaynağı (yürüme dünyası değişince yenilenir, kol yeni boya oturur). */
export function rigSource(rig: CamRig, built: Pick<Built, "blocks">): BoxSource {
  if (rig.built !== built) { rig.built = built; rig.src = cameraSource(built); rig.arm.len = NaN; }
  return rig.src!;
}

/**
 * INTERIOR-CAM: yörünge pozunu (`cam`, yerinde) avatarın tavanının altına sığdırır (camera/ceiling.ts). Açık havada dokunmaz.
 * Dönüş: tavan bilgisi ve etkin bakış eğimi (WalkRig bakış noktasını bununla kurar). `reach`: iç mekân katında yandaki tavan da.
 */
export function fitCeiling(rig: CamRig, built: Pick<Built, "blocks">, pivot: P3, cam: P3,
  o: { dist: number; pitch: number; near: number; fov: number; aspect: number; footY: number; reach?: number; tight?: boolean }): CeilingFit {
  const src = rigSource(rig, built);
  return fitUnderCeiling(src, pivot, cam, { dist: o.dist, pitch: o.pitch, radius: probeRadius(o.near, o.fov, o.aspect, o.tight), floorTop: o.footY + FLOOR_PAD,
    footY: o.footY, reach: o.reach });
}

/** INTERIOR-CAM: girişte denenen yaw kaymaları (rad; arkadan yana — kamera avatarın önüne geçmez, yürüme yönü korunur). */
export const ENTRY_YAWS = [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5] as const;
/**
 * INTERIOR-CAM: iç mekâna girişte kameranın duracağı yer — gerçek operatör gibi odanın içinde, kapı duvarına yaslanmadan. `yaw0`
 * (avatarın arkası) çevresinde `ENTRY_YAWS` denenir; en uzun açık kol seçilir (eşitlikte arkaya en yakını: %90 pay). Saf seçim.
 */
export function entryYaw(rig: CamRig, built: Pick<Built, "blocks">, pivot: P3, yaw0: number, dist: number, elev: number,
  o: { near: number; fov: number; aspect: number; footY: number }): number {
  const src = rigSource(rig, built), r = probeRadius(o.near, o.fov, o.aspect), floorTop = o.footY + FLOOR_PAD;
  const ce = Math.cos(elev), se = Math.sin(elev);
  let best = yaw0, bestLen = -1;
  for (const d of ENTRY_YAWS) {
    const y = yaw0 + d;
    const to: [number, number, number] = [pivot.x - Math.sin(y) * ce * dist, pivot.y + se * dist, pivot.z - Math.cos(y) * ce * dist];
    const len = sweepArm(src, [pivot.x, pivot.y, pivot.z], to, r, floorTop);
    if (len > bestLen * 1.1 + 1e-3) { bestLen = len; best = y; }
  }
  return best;
}

export function followArm(rig: CamRig, built: Pick<Built, "blocks">, pivot: P3, cam: P3, look: P3 | null, o: ArmOpts): void {
  rigSource(rig, built);
  rig.radius = probeRadius(o.near, o.fov, o.aspect, o.tight);
  rig.floorTop = o.footY + FLOOR_PAD;
  // duvara yaslı avatar: kol pivotu duvardan uzaklaşır (yakın düzlem duvara girmez); bakış ve avatar yerinde kalır
  nudgePivot(rig.src!, [pivot.x, pivot.y, pivot.z], rig.radius, rig.floorTop, rig.pivot);
  const p = solveArm(rig.src!, rig.pivot, [cam.x, cam.y, cam.z], { radius: rig.radius, floorTop: rig.floorTop, allowLift: o.lift, whiskers: o.whiskers, maxElev: o.maxElev }, rig.pose);
  const len = stepArm(rig.arm, p.desired, p.hard, o.dt, o.calm, p.soft);
  const nx = rig.pivot[0] + p.ux * len, ny = rig.pivot[1] + p.uy * len, nz = rig.pivot[2] + p.uz * len;
  if (look) {
    if (p.lifted) { look.x = pivot.x; look.y = pivot.y; look.z = pivot.z; }
    else { look.x += nx - cam.x; look.y += ny - cam.y; look.z += nz - cam.z; }
    // yakın kadraj (yalnız takip): kol kısaldıkça bakış avatarın önüne ve biraz yukarı kayar — dar sokakta ekranı baş değil,
    // önündeki yol doldurur (look-ahead; avatar karenin alt-ortasında kalır)
    const k = o.lift ? Math.min(1, Math.max(0, (CLOSE_LEN - len) / (CLOSE_LEN - ARM_EYE))) : 0;
    if (k > 0) {
      const hx = pivot.x - nx, hz = pivot.z - nz, hl = Math.hypot(hx, hz);
      if (hl > 1e-3) { look.x += (hx / hl) * CLOSE_AHEAD * k; look.z += (hz / hl) * CLOSE_AHEAD * k; }
      look.y += CLOSE_RISE * k;
    }
  }
  cam.x = nx; cam.y = ny; cam.z = nz;
  rig.hit = rig.arm.hit;
  rig.active = true;
}

/**
 * Kare sonu güvenlik ağı: yumuşatılmış (gecikmeli) kamera konumu pivot → kamera doğrusunda bir katıya değiyorsa aynı karede
 * açık boya çekilir. Dönüş: düzeltildi mi.
 */
export function armSafety(rig: CamRig, cam: P3): boolean {
  if (!rig.active || !rig.src) return false;
  const [px, py, pz] = rig.pivot;
  const dx = cam.x - px, dy = cam.y - py, dz = cam.z - pz, d = Math.hypot(dx, dy, dz);
  if (d < 1e-4) return false;
  const free = sweepArm(rig.src, rig.pivot, [cam.x, cam.y, cam.z], rig.radius, rig.floorTop);
  if (free >= d - 1e-3) return false;
  const k = free / d;
  cam.x = px + dx * k; cam.y = py + dy * k; cam.z = pz + dz * k;
  rig.arm.len = Math.min(rig.arm.len, free);
  rig.safety++;
  return true;
}

/** Kolun uygulanmadığı kip: bir sonraki takipte kol istenen boya oturur (eski kipten "uzama" kayması yok). */
export function releaseArm(rig: CamRig): void { rig.active = false; rig.arm.len = NaN; rig.hit = false; }
