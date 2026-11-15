/**
 * (<city>, 9 kubbeli katedral) — şehir sokağında DURAN avatarın önündeki yüksek simgenin tepesi kadrajda kalsın.
 *
 * Takip kamerası varsayılan eğimde (−0,3: aşağı bakış) simgenin tepesini ~10 karo yakında keser (kubbeler kadrajın üstünden taşıyordu).
 * Avatar durunca, bakış konisindeki (±`LIFT_CONE`) ve `LIFT_MIN`…`LIFT_MAX` birim yakınındaki en yüksek simge için kameranın eğimine
 * `lift` (≥ 0, ≤ `LIFT_CAP`) eklenir: simgenin tepesi görüş alanının üst kenarının `LIFT_MARGIN` rad altına gelene dek. Yürürken 0.
 * Saf modül (React/three yok); WalkRig yumuşatır ve yalnızca üçüncü şahıs yörüngesinde kullanır. Denetim: scripts/.test.mjs.
*/
import { arrivalKitBuild } from "../citymap/arrivalKit"; // varış kitinin simgesi de kaldırma hedefi
import { GATE_D, GATE_W, type CityMapFile } from "../citymap/format";
import { GATE_ARRIVE, GATE_RETURN } from "../citymap/shell";
import { cityX, cityZ } from "../transit/model";
import { cityViewTargets, viewableTarget } from "./landmarkView";
import { ORBIT_MIN } from "./scale";

/** Bakış konisi (yarım açı, rad), en yakın/en uzak simge uzaklığı (birim; avatardan kutuya) ve ek eğimin üst sınırı (rad). */
export const LIFT_CONE = 0.9; // 0,75 → 0,9 (Kapadokya/<city> kit simgesi görüş koni kenarında, 0,79 rad)
export const LIFT_MIN = 2; // 3 → 2 (yakın kit simgesi 2,5 karoda)
export const LIFT_MAX = 16;
export const LIFT_CAP = 0.5;
/** Tepe, üst kenardan en az bu kadar (rad) aşağıda kalır. */
export const LIFT_MARGIN = 0.07;
/**
 * üst HUD bandı (düğme sırası + ipucu şeridi canlı DOM'da 1280 × 800'de y ≤ 104–186 px ≈ %13–23; 1920 × 1080'de ≤ 8 %) —
 * simgenin tepesi kadrajın üst kenarına değil HUD'un altına sığdırılır: görüş yarı açısının tanjantı `1 − 2·LIFT_HUD_TOP` ile küçülür.
*/
export const LIFT_HUD_TOP = 0.15;
const hudHalf = (halfV: number) => Math.atan(Math.tan(halfV) * (1 - 2 * LIFT_HUD_TOP));

export interface LiftTarget { x0: number; x1: number; z0: number; z1: number; top: number }

/** Kamera eğimi `pitch` iken (yörünge: `elev = max(ORBIT_MIN, −pitch)`) simgenin tepesinin üst kenara göre payı (rad; ≥ LIFT_MARGIN: kadrajda). */
export function topRoom(pitch: number, pivotY: number, dist: number, d: number, top: number, halfV: number): number {
  const e = Math.max(ORBIT_MIN, -pitch), camY = pivotY + Math.sin(e) * dist, back = Math.cos(e) * dist;
  const alpha = Math.atan2(top - camY, d + back);
  return pitch + halfV - alpha;
}

/** Ek eğim (rad). `pivotY`: kamera pivotu (göğüs, dünya y), `dist`: takip mesafesi, `halfV`: dikey görüş yarı açısı (rad). */
export function landmarkLift(targets: readonly LiftTarget[], ax: number, az: number, yaw: number, pitch: number, pivotY: number, dist: number, halfV0: number): number {
  const halfV = hudHalf(halfV0);
  let lift = 0;
  for (const t of targets) {
    // avatardan kutuya yatay uzaklık ve kutunun merkezine bakış sapması
    const dx = Math.max(t.x0 - ax, 0, ax - t.x1), dz = Math.max(t.z0 - az, 0, az - t.z1), d = Math.hypot(dx, dz);
    if (d < LIFT_MIN || d > LIFT_MAX) continue;
    const bx = (t.x0 + t.x1) / 2 - ax, bz = (t.z0 + t.z1) / 2 - az;
    let off = Math.atan2(bx, bz) - yaw;
    off = Math.atan2(Math.sin(off), Math.cos(off));
    if (Math.abs(off) > LIFT_CONE) continue;
    if (topRoom(pitch, pivotY, dist, d, t.top, halfV) >= LIFT_MARGIN) continue;
    let p = pitch;
    while (p < pitch + LIFT_CAP && topRoom(p, pivotY, dist, d, t.top, halfV) < LIFT_MARGIN) p += 0.02;
    lift = Math.max(lift, Math.min(LIFT_CAP, p - pitch));
  }
  return lift;
}

/** kaldırma kolu bundan fazla kısaltmaz (m). Kaldırılmış eğimde kamera yere iner (Galata varışı: y 0,30) ve tezgâh masasına çarpıp başa 1,19 m'ye çöküyordu.*/
export const LIFT_ARM_LOSS = 0.25;
/** kaldırılmış kamera yerden bu kadar (m, ayak üstü) altına inmez — 0,3 m taban kıskacına yatan kamera kaldırım/basamak/korkuluk kenarlarını kadraja dolduruyordu (Yerebatan çıkışı %91, Kız Kulesi iskelesi). `openLift` bu yüksekliği korumayan kaldırmayı azaltır.*/
export const LIFT_CAM_MIN = 1.2;
export const LIFT_STEPS = [1, 0.7, 0.45, 0.25] as const;
/**
 * `want` kaldırma, kolun açık boyunu (`armAt(lift)`: pivot → kaldırılmış yörünge noktası süpürmesi) kaldırmasız boydan en çok `LIFT_ARM_LOSS` kısaltıyorsa
 * adım adım azaltılır; hiçbiri uymazsa 0. Saf; kare başına en çok 5 süpürme (yalnız duran avatar + kaldırma istenen simge).
*/
export function openLift(want: number, armAt: (lift: number) => number): number {
  if (!(want > 0)) return 0;
  const base = armAt(0);
  for (const k of LIFT_STEPS) if (armAt(want * k) >= base - LIFT_ARM_LOSS) return want * k;
  return 0;
}

const targetCache = new WeakMap<CityMapFile, LiftTarget[]>();
/** Şehir haritasının görüntülenebilir simgeleri dünya kutusu + tepe yüksekliğiyle (haritaya göre önbellekli). */
export function cityLiftTargets(map: CityMapFile): readonly LiftTarget[] {
  let out = targetCache.get(map);
  if (!out) {
    out = cityViewTargets(map).filter(viewableTarget).map((t) => ({ x0: cityX(t.rect.i0) - 0.5, x1: cityX(t.rect.i1) + 0.5, z0: cityZ(t.rect.j0) - 0.5, z1: cityZ(t.rect.j1) + 0.5, top: (t.y0 ?? 0) + (t.h ?? 4) }));
    const ak = arrivalLiftTarget(map);
    if (ak) out.push(ak);
    targetCache.set(map, out);
  }
  return out;
}

/** varış kitinin en yüksek simgesi (varış meydanı, dünya kutusu + tepe) — şehir haritası simgeleri listesinde yoktur.*/
export function arrivalLiftTarget(map: CityMapFile): LiftTarget | null {
  const kit = arrivalKitBuild(map.id, GATE_ARRIVE, GATE_RETURN, map.gate.kind === "pier" ? 12 : GATE_D, GATE_W);
  const top = (bs: { p: number[]; s: number[] }[]) => Math.max(...bs.map((b) => b.p[1] + b.s[1] / 2));
  let best: { blocks: { p: number[]; s: number[] }[] } | null = null;
  for (const it of kit?.items ?? []) if (it.icon && it.blocks.length && (!best || top(it.blocks) > top(best.blocks))) best = it;
  if (!best) return null;
  const b = best.blocks;
  return { x0: Math.min(...b.map((q) => q.p[0] - q.s[0] / 2)), x1: Math.max(...b.map((q) => q.p[0] + q.s[0] / 2)), z0: Math.min(...b.map((q) => q.p[2] - q.s[2] / 2)), z1: Math.max(...b.map((q) => q.p[2] + q.s[2] / 2)), top: top(b) };
}
