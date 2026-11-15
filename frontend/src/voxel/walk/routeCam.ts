/**
 * (UX-SWEEP-4) — otomatik yürüyüşte (Yakındakiler / bilgi kartı "git", tıkla-git, ritüelden sonra uzak
 * hedef) takip kamerası avatarın ARKASINA döner ve gidilen yöne bakar.
 *
 * Sorun: takip kamerasının yaw'ı yalnız kullanıcı girdisiyle (Q/E, sürükleme) değişiyordu. Klavyeyle yürürken yön kameraya göre
 * olduğundan sorun yoktu; ama rota avatarı kameraya doğru götürünce kullanıcı 16–19 adım boyunca avatarın yüzünü görüyor, gidilen
 * yeri görmüyordu (<city>, <city>, <city>); <city>'da yandaki kamera bina duvarının arkasına düştü.
 *
 * - Bakılacak yön (`routeAheadYaw`): avatardan rota üstünde `ROUTE_LOOK_AHEAD` birim ilerideki noktaya (köşede yumuşak; tek
 * karoluk sapmalar kamerayı sallamaz).
 * - Örtü çözümü (`routeCamYaw`): o yönün arkası ve ±`ROUTE_COVER_YAWS` sapmaları için yaylı kol açıklığı ölçülür (WalkRig:
 * `camera/collide.ts sweepArm`); kolu en az `ROUTE_OPEN` oranında açık ilk aday, yoksa en açığı — kamera duvarın arkasında kalmaz.
 * - Dönüş (`stepRouteYaw`): üstel yumuşatma (`ROUTE_CAM_K`/sn) + açısal hız tavanı (`ROUTE_CAM_RATE`; hareket azaltmada
 * `ROUTE_CAM_RATE_CALM`): rota başlayınca kamera ≤ 1 sn içinde avatarın arkasında; 90° köşede ani savrulma yok.
 * - Kullanıcı kamerayı çevirirse (Q/E, sürükleme) `ROUTE_USER_HOLD` sn izleme durur; kullanıcının açısı korunur.
 * Saf modül (three/React/depo yok). Test: scripts/uxfix4_route.test.mjs.
*/
import { tx, tz, type Tile } from "../scenes";

const DEG = Math.PI / 180;
export const ROUTE_LOOK_AHEAD = 2.5;
export const ROUTE_CAM_K = 5;
export const ROUTE_CAM_RATE = 260 * DEG;
export const ROUTE_CAM_RATE_CALM = 150 * DEG;
export const ROUTE_USER_HOLD = 2.5;
/** Örtü çözümünde denenen sapmalar (rad; arkadan omuz üstüne — kamera avatarın önüne geçmez). */
export const ROUTE_COVER_YAWS: readonly number[] = [0, 0.35, -0.35, 0.7, -0.7];
/** Kol bu oranda açıksa aday kabul (yoksa en açık aday). */
export const ROUTE_OPEN = 0.85;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface RouteAvatar { x: number; z: number; heading: number; route: readonly Tile[] | null; routeIdx: number }

/** Rota üstünde avatardan `ahead` birim ilerideki noktaya yön (yaw; 0 → +z). Rota yoksa ya da çok kısaysa avatarın bakışı. */
export function routeAheadYaw(a: RouteAvatar, ahead = ROUTE_LOOK_AHEAD, toX: (i: number) => number = tx, toZ: (j: number) => number = tz): number {
  const r = a.route;
  if (!r || a.routeIdx >= r.length) return a.heading;
  let px = a.x, pz = a.z, left = ahead;
  let tgtX = px, tgtZ = pz;
  for (let k = a.routeIdx; k < r.length && left > 0; k++) {
    const nx = toX(r[k][0]), nz = toZ(r[k][1]);
    const d = Math.hypot(nx - px, nz - pz);
    if (d >= left) { tgtX = px + ((nx - px) / d) * left; tgtZ = pz + ((nz - pz) / d) * left; left = 0; break; }
    left -= d; px = nx; pz = nz; tgtX = nx; tgtZ = nz;
  }
  const dx = tgtX - a.x, dz = tgtZ - a.z;
  return Math.hypot(dx, dz) < 0.3 ? a.heading : Math.atan2(dx, dz);
}

/**
 * Örtü çözümü: `want` (avatarın arkasındaki kamera, gidilen yöne bakar) çevresinde `ROUTE_COVER_YAWS`; `armLen(yaw)` o yaw'daki
 * yaylı kolun açık boyu, `dist` istenen boy. Kolu `ROUTE_OPEN` oranında açık ilk aday; yoksa en uzun kollu (eşitlikte arkaya yakın).
 */
export function routeCamYaw(want: number, dist: number, armLen: (yaw: number) => number): number {
  let best = want, bestLen = -1;
  for (const d of ROUTE_COVER_YAWS) {
    const y = want + d, len = armLen(y);
    if (len >= dist * ROUTE_OPEN) return y;
    if (len > bestLen + 1e-3) { bestLen = len; best = y; }
  }
  return best;
}

/** Bir kare: kamera yaw'ı (`cur`, sarılmamış) hedefe üstel yumuşatma + hız tavanıyla döner. Dönüş: yeni yaw (sarılmamış). */
export function stepRouteYaw(cur: number, target: number, dt: number, calm = false): number {
  if (dt <= 0) return cur;
  const diff = wrap(target - cur);
  const step = diff * (1 - Math.exp(-dt * ROUTE_CAM_K));
  const cap = (calm ? ROUTE_CAM_RATE_CALM : ROUTE_CAM_RATE) * dt;
  return cur + Math.max(-cap, Math.min(cap, step));
}

/** İzleme etkin mi: rota var, birinci şahıs/fotoğraf/etkinlik/yolculuk/manzara yok ve kullanıcı son `ROUTE_USER_HOLD` sn çevirmedi. */
export function routeFollowOn(c: { route: boolean; first: boolean; photo: boolean; activity: boolean; ride: boolean; shot: boolean; sinceUserYaw: number }): boolean {
  return c.route && !c.first && !c.photo && !c.activity && !c.ride && !c.shot && c.sinceUserYaw >= ROUTE_USER_HOLD;
}
