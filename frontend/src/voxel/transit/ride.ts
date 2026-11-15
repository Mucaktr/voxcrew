/**
 * yolculuk sahnesi (biniş → yolculuk → iniş). React dışı.
 *
 * - `startRide(plan, done)`: avatar araçla rota üstünde ilerler (`walkRuntime.ride`: WalkRig adım ve çarpışma yerine çağırır;
 * girdi yok sayılır). RIDE-UX (F2): hareket gerçekçi zaman çizelgesinden (`rideStateAt`: seyir hızı, yumuşak kalkış/duruş,
 * virajda yavaşlama, yumuşatılmış yön) — eskiden süre 3…9 sn'ye sıkıştırılıyordu (otobüs ≈ 330 km/sa). Önce `BOARD_DWELL` sn
 * durakta bekler (kapı kapanır), bitince avatar iniş durağının karosunda, `done` çağrılır.
 * - `skipRide`: "Durağa atla" — bir sonraki karede yolculuk biter (çağıran kararma altında çağırır: `citymap/store.ts`).
 * - Hareket azaltmada yolculuk sahnesi yoktur: çağıran doğrudan varışa keser (`citymap/store.ts boardLine`).
 * - `rideRuntime.ride`: CityRig aracın bloklarını bu pozdan kapasite kuyruğunun araç bölgesine yazar (+0 çizim çağrısı).
*/
import { walkRuntime } from "../walk/walkStore";
import { BOARD_DWELL, bodyArc, cityX, cityZ, poseAtArc, riderAt, rideStateAt, rideTimeline, type RidePose, type TravelPlan } from "./model";

/** Avatar pozu (x, z, yön, `y`) ve aracın gövde pozu `body` (CITY-POLISH: gövde durak karosunun dışına taşmaz — `bodyArc`;
 *  sürüş yüksekliği profili varsa yol boyunca değişir, araç blokları `body.y − plan.rideY` kayar). RIDE-UX: `t` binişten beri
 *  geçen süre (sn), `v` hız (birim/sn), `left` kalan süre (sn), `skip` "Durağa atla" istendi. */
export interface ActiveRide { plan: TravelPlan; t: number; x: number; z: number; heading: number; y: number; body: RidePose; v: number; left: number; skip: boolean }

/**
 * yolculuk saati kare süresini en çok `RIDE_DT_MAX` sn ilerletir (yürüme/fizik 0,25 sn tavanında kalır).
 * Eskiden yolculuk da 0,25 sn'ye kırpılıyordu: 4–5 sn'lik tek takılma yolculuktan 0,25 sn götürüyor, yavaş makinede (≈ 3 kare/sn)
 * 18 sn'lik yolculuk 63 sn sürüyordu. Konum zaman çizelgesinden analitik hesaplanır (ışınlanma değil, atlama): büyük adım güvenli.
*/
export const RIDE_DT_MAX = 1;
export const rideDt = (delta: number): number => Math.min(delta, RIDE_DT_MAX);

export const rideRuntime: { ride: ActiveRide | null } = { ride: null };

/** inişte binen son `RIDE_STEP_OFF` sn'de yerinden (riderSeat) yolun ucuna iner (kararmasız varışta sıçrama yok).*/
export const RIDE_STEP_OFF = 0.8;

/** `seat`: binenin araçtaki yeri (`riderSeat`; boşsa gövde ortası). Binişte kararma altında doğrudan yerine oturur. */
export function startRide(plan: TravelPlan, done: () => void, seat: readonly [number, number, number] = [0, 0, 0]): void {
  cancelRide();
  const tl = rideTimeline(plan);
  const p0 = rideStateAt(plan, 0, tl);
  const ride: ActiveRide = { plan, t: 0, x: p0.x, z: p0.z, heading: p0.heading, y: p0.y, body: poseAtArc(plan, bodyArc(plan, 0)), v: 0,
    left: BOARD_DWELL + tl.T, skip: false };
  rideRuntime.ride = ride;
  walkRuntime.ride = (a, dt) => {
    ride.t += dt;
    const tau = ride.t - BOARD_DWELL, end = ride.skip || tau >= tl.T;
    const p = rideStateAt(plan, end ? tl.T : tau, tl);
    ride.x = p.x; ride.z = p.z; ride.heading = p.heading; ride.y = p.y; ride.v = p.v; ride.left = Math.max(0, tl.T - tau);
    ride.body = poseAtArc(plan, bodyArc(plan, p.s));
    // (RIDE-HEAD-001): avatar yolu değil gövdedeki yerini izler (duvar/köşk içinde kalmaz); son anda yolun ucuna iner
    const at = riderAt(ride.body, seat), k = end ? 0 : Math.min(1, Math.max(0, (tl.T - tau) / RIDE_STEP_OFF));
    a.x = p.x + (at.x - p.x) * k; a.z = p.z + (at.z - p.z) * k; a.heading = p.heading; a.speed = 0; a.route = null;
    a.y = p.y + (at.y - p.y) * k; a.ground = a.y; a.vy = 0; a.grounded = true;
    if (end) {
      a.x = cityX(plan.arrive[0]); a.z = cityZ(plan.arrive[1]);
      walkRuntime.ride = null;
      rideRuntime.ride = null;
      done();
    }
  };
}

/** RIDE-UX: "Durağa atla" — yolculuk bir sonraki karede iniş durağında biter (yolculuk yoksa false). */
export function skipRide(): boolean {
  const r = rideRuntime.ride;
  if (!r) return false;
  r.skip = true;
  return true;
}

export function cancelRide(): void {
  rideRuntime.ride = null;
  walkRuntime.ride = null;
}
