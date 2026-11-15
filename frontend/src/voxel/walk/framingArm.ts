/**
 * ACTIVITY-CAM / HQA-FIX — kadraj seçiminin yaylı kol ölçüsü: pivot → kamera açık boyu (pivot itmesi + küre
 * süpürmesi; `camera/rig.ts followArm` ile aynı yarıçap/zemin payı) ve duvar kıskacı / çatı örtüsü (`cover.ts resolveFollowCam`):
 * kamera göze/omuza düşerse aday geçersiz (0). Eskiden `WalkRig.tsx` içinde satır içiydi; HQA-FIX ile saf modül oldu ki olta ve
 * ritüel kadrajları düğüm testinde GERÇEK kol boyuyla taransın (<city>'da bakış noktası korkuluğun
 * arkasına inince kol sıfıra çöküyor, kamera korkuluğun içine bakıyordu).
*/
import type { Built } from "../scenes";
import { cameraSource } from "../camera/world";
import { nudgePivot, probeRadius, solveArm } from "../camera/collide";
import { coverGrid } from "./controller";
import { resolveFollowCam, WALK_NEAR, type FollowCam } from "./cover";

export type ArmLen = (pivot: { x: number; y: number; z: number }, cam: { x: number; y: number; z: number }) => number;

/** Kadraj adayının yaylı kol açık boyu (birim; 0 → kamera göze/omuza düşer). `fov` derece, `aspect` en/boy. */
export function framingArmOf(built: Built, fov: number, aspect: number, ground: number, footY: number, px: number, pz: number, whiskers = true): ArmLen {
  const scratch: FollowCam = { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, mode: "orbit", dist: 0 };
  return (pv, cm) => {
    const src = cameraSource(built), r = probeRadius(WALK_NEAR, fov, aspect || 1), ft = Math.min(ground, footY) + 0.2 /* FLOOR_PAD */, np: [number, number, number] = [pv.x, pv.y, pv.z];
    nudgePivot(src, [pv.x, pv.y, pv.z], r, ft, np);
    // HQA-FIX: WalkRig kolu gibi bıyıklarla (`solveArm` whiskers) — yan duvar/tezgâh kolu kısaltır; eskiden yalnız orta ışın
    // ölçülüyor, iki yanı kapalı dar yaw "açık" sayılıp seçiliyor, gerçek kamera başa yapışıyordu (Şanghay dönüşü: 4,6 → 2,6)
    const L = solveArm(src, np, [cm.x, cm.y, cm.z], { radius: r, floorTop: ft, whiskers }).soft; // whiskers=false: etkinlik kamerasının gerçek kolu (WalkRig `whiskers: !calm && !s.act`)
    const ddx = pv.x - cm.x, ddy = cm.y - pv.y, ddz = pv.z - cm.z, d3 = Math.hypot(ddx, ddy, ddz) || 1;
    const fc2 = resolveFollowCam(coverGrid(built), { x: px, z: pz }, pv, cm, { yaw: Math.atan2(ddx, ddz), pitch: -Math.asin(Math.max(-1, Math.min(1, ddy / d3))), dist: d3, footY, camScale: 1, blocks: built.blocks }, scratch);
    return fc2.mode !== "orbit" ? 0 : Math.min(L, Math.hypot(fc2.x - pv.x, fc2.y - pv.y, fc2.z - pv.z));
  };
}

/** HQA-FIX: varış kamerası için kolun en az bu oranı açık olmalı (yoksa kamera başa/saça düşer).*/
export const AIM_CLEAR_FRAC = 0.7;
/**
 * HQA-FIX — varış kamerasının yaw'ı: istenen `aim` (durak/iniş/hızlı seyahat yönü) arkasında kol açıksa o; değilse
 * ona en yakın (π/8 adımlı) kolu açık yaw; hiçbiri açık değilse kolu en uzun olan. Kök neden: varışta kamera istenen yaw'a oturuyor,
 * arkadaki durak saçağı/turnike/vagon duvarı kolu sıfıra çökertiyor, kare avatarın saçıyla doluyordu.
*/
export function clearAimYaw(arm: ArmLen, pv: { x: number; y: number; z: number }, aim: number, dist: number, elev: number, frac = AIM_CLEAR_FRAC): number {
  let best = aim, bestL = -1;
  for (let k = 0; k <= 8; k++) for (const sgn of k === 0 || k === 8 ? [1] : [1, -1]) {
    const y = aim + sgn * k * (Math.PI / 8);
    const cam = { x: pv.x - Math.sin(y) * Math.cos(elev) * dist, y: pv.y + Math.sin(elev) * dist, z: pv.z - Math.cos(y) * Math.cos(elev) * dist };
    const L = arm(pv, cam);
    if (L >= dist * frac) return y;
    if (L > bestL + 1e-6) { bestL = L; best = y; }
  }
  return best;
}
