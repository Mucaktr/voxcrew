/**
 * UXF-D — şehir haritası yolculuğunun kamerası (vapur, tramvay, füniküler, teleferik ve öteki hatlar). React/three yok.
 *
 * Sorun (canlı): yolculukta takip kamerası binişten önceki yaw'da kalıyordu. Rota
 * kameraya doğru gidince kamera avatarın önünde, yüzüne bakıyordu; kamara/vagon avatarın ARKASINDA kaldığı için kesite girmiyor,
 * karenin üst yarısını kaplıyordu. Londra çarkındaki gibi kamera artık yolculuğun arkasında ve biraz yanında, rota boyunca bakar:
 * - yaw = araç yönü + `RIDE_SIDE` (sol-arka omuz); rota dönünce kamera da döner (Q/E kullanıcı payı korunur, WalkRig);
 * - yükseliş ve mesafe araç profilinden (`RIDE_DEFAULT`; balon zarfın altından): kamera tavan/baca üstünde kalır, gövde → kamera doğruları aracın
 * tavanını ve arka duvarını keser → sokak kesiti (cover.ts `walkCutPlan`) onları bütün blok olarak açar (kabin kesiti);
 * - bakış noktası göğsün `ahead` önü: avatar karede, rota ileride okunur.
 * RIDE-UX (F2, ürün sahibi 2026-10-29 "kamera deli gibi dönüyor"): yaw artık köşeli rota yönüne 10/sn ile yapışmıyor (90° köşe ≈ 900°/sn);
 * araç yönü zaman çizelgesinde yumuşatılır (`model.ts rideTimeline`), kamera `stepRideYaw` ile kritik sönümlü ve ≤ 40°/sn döner,
 * ufuk sabit (yuvarlanma yok: lookAt dünya yukarısı), tür başına çerçeve `RIDE_PROFILE` (pencere/güverte/arka-üst/kabin).
 * `vehicleAt`: aracın dünya blokları (CityRig `writeVehicle` ile aynı dönüşüm; tek kaynak). `rideFrame`: kare engel ölçüsü
 * (UXF-B `spawnFrame` yöntemi; yalnız araç blokları, kesitin attıkları sayılmaz) — `scripts/uxfd_ride_cam.test.mjs` denetler.
*/
import { RIDE_SPEED_FACTOR } from "./speedFactor";
import type { Block } from "../scenes";
import { planCuts, streetProbes } from "../walk/cover";
import { LOOK_Y, orbitPose, walkFov, WALK_FOV_DEFAULT } from "../walk/scale";
import { bodyArc, poseAtArc, rideStateAt, rideTimeline, vehicleBlocks, vehicleHalfLength, type RidePose, type TravelPlan, type VehicleOpts } from "./model";
import type { VehicleKind } from "../citymap/format";
import { CAMERA_PROFILES, profileOf, registerCameraProfile } from "../camera/profiles";
import { pointBlocked, sweepArm, type Box, type BoxSource } from "../camera/collide";

/** Açı farkı (−π, π]. */
export const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** Kameranın araç yönünden sapması (rad; + sol-arka omuz) — eski tek değer; RIDE-UX'te türün profilinde (`rideSide`). */
export const RIDE_SIDE = 0.55;
/**
 * RIDE-UX (F2) — taşıt türü başına sakin sinema kamerası. `view`: `window` raylı araçta pencere/oturak yanı (alçak, yandan, ileri
 * bakar), `deck` teknede güverte (alçak eğim, geniş), `chase` otobüste arka-üst takip, `cabin` teleferik/balonda kabin yanı
 * (alçak, dışarı bakar). `elev` yükseliş (rad), `dist` mesafe (birim), `ahead` bakış noktasının göğüs önündeki uzaklığı (rota
 * yönünde = ileri bakış), `side` araç yönünden sapma (rad; + sol), `vfov` dikey görüş açısı (ayar varsayılanında; INTERIOR-CAM
 * profil kaydı `vehicle:<tür>`).
 */
export type RideView = "window" | "deck" | "chase" | "cabin";
export interface RideProfile { elev: number; dist: number; ahead: number; side?: number; vfov?: number; view?: RideView }
export const RIDE_DEFAULT: RideProfile = { elev: 0.75, dist: 6.6, ahead: 2.4, side: RIDE_SIDE, vfov: 58, view: "chase" };
const WINDOW: RideProfile = { view: "window", elev: 0.24, dist: 6.6, ahead: 4.2, side: 1.1, vfov: 60 };
/** Balon: zarf avatarın üstünde (y + 2,1 … 6,2) — kamera zarfın altından, sepet hizasında yandan bakar. */
export const RIDE_PROFILE: Readonly<Record<VehicleKind, RideProfile>> = {
  tramvay: WINDOW, metro: WINDOW, funikuler: WINDOW, monoray: WINDOW,
  vapur: { view: "deck", elev: 0.37, dist: 5.4, ahead: 4.5, side: 0.45, vfov: 58 }, // 0,36 → 0,37 (hız 0,7: Istanbul/<city> vapur RIDE-CAM-001 ölçüsü sınırda)
  kayik: { view: "deck", elev: 0.42, dist: 3.8, ahead: 3.2, side: 0.55, vfov: 56 },
  otobus: { view: "chase", elev: 0.6, dist: 6.6, ahead: 3, side: 0.25, vfov: 55 },
  teleferik: { view: "cabin", elev: 0.22, dist: 5, ahead: 4.5, side: 0.85, vfov: 60 },
  balon: { view: "cabin", elev: 0.06, dist: 5.5, ahead: 3.5, side: 0.6, vfov: 60 },
};
/**
 * CORE-CITYMAP: takip mesafesi aracın boyuna göre büyür (uzun vapurda pruva ve kıç, iki katlı otobüste tavan çizgisi karede kalır;
 * kesit binenin üstündeki tavanı açar, aracın geri kalanı okunur). RIDE-UX: yalnız güverte ve arka-üst takipte (pencere/kabin yakın).
 */
export const rideProfile = (kind: VehicleKind): RideProfile => {
  const p = RIDE_PROFILE[kind] ?? RIDE_DEFAULT;
  if (p.view !== "deck" && p.view !== "chase") return p;
  const half = vehicleHalfLength(kind);
  return half > 2.2 ? { ...p, dist: Math.max(p.dist, 2 * half + 1.6) } : p;
};
/** Türün kamera sapması (rad). */
export const rideSide = (kind: VehicleKind) => rideProfile(kind).side ?? RIDE_SIDE;

// INTERIOR-CAM profil kaydı: "vehicle:<tür>" (görüş açısı; çerçeve bu modülde — `delegated: "rideCam"`)
const DEG = Math.PI / 180;
/** Türün kamera profili kimliği (camera/profiles.ts `selectProfile({ ride, rideProfile })`). */
export const rideCamProfileId = (kind: VehicleKind) => `vehicle:${kind}`;
for (const kind of Object.keys(RIDE_PROFILE) as VehicleKind[]) {
  const id = rideCamProfileId(kind);
  if (profileOf(id).id === id) continue; // HMR: zaten kayıtlı
  registerCameraProfile({ ...CAMERA_PROFILES.vehicle, id, vfov: RIDE_PROFILE[kind].vfov ?? CAMERA_PROFILES.vehicle.vfov });
}

/**
 * RIDE-UX: kamera yaw'ının sönümlü takibi. Hedef = araç yönü (zaman çizelgesinde yumuşatılmış) + türün sapması + kullanıcı payı.
 * Kritik sönümlü yay (`RIDE_YAW_SMOOTH` sn) + açısal hız tavanı (`RIDE_YAW_RATE`; hareket azaltmada `RIDE_YAW_RATE_CALM`, daha
 * yavaş). Kullanıcı Q/E ile çevirirse pay hedefe eklenir (yine tavanla döner); sürüklemede kamera doğrudan döner (kullanıcının
 * kendi hareketi). `RIDE_USER_HOLD` sn girdi yoksa pay `RIDE_USER_RETURN` zaman sabitiyle sıfıra döner (kamera yumuşakça geri gelir).
 */
export const RIDE_YAW_RATE = 40 * DEG;
export const RIDE_YAW_RATE_CALM = 20 * DEG;
export const RIDE_YAW_SMOOTH = 0.8;
export const RIDE_YAW_SMOOTH_CALM = 1.4;
export const RIDE_USER_HOLD = 2.5;
export const RIDE_USER_RETURN = 1.5;
/** WalkRig kamera konumu/bakış noktası yumuşatma hızı (1/sn; `1 − e^(−dt·k)`) — testler aynı boru hattını benzetir. */
export const RIDE_POS_LERP = 8;
export interface RideYaw {
  /** uygulanan yaw (= base + off; sarılmamış) */
  yaw: number;
  /** otomatik kısım (araç yönü + sapma takibi) ve hızı */
  base: number; baseVel: number;
  /** kullanıcı payının gösterilen kısmı ve hızı; `user` hedef pay */
  off: number; offVel: number; user: number;
  /** HQA-FIX: çarpışma ayarının yaw payı (`rideCamAdjust`); kullanıcı payı gibi yalnız kamerayı çevirir, aynı tavanla*/
  auto: number;
  /** son kullanıcı girdisinden beri geçen süre (sn) */
  idle: number;
}
export const createRideYaw = (yaw = 0): RideYaw => ({ yaw, base: yaw, baseVel: 0, off: 0, offVel: 0, user: 0, idle: 0, auto: 0 });
/** Bakış (ileri bakış) yönü: otomatik kısım − sapma → bakış da tavanlı ve sıçramasız döner (kullanıcı payı yalnız kamerayı çevirir). */
export const rideLookHeading = (c: RideYaw, side: number) => c.base - side;
/** Biniş: kamera hedefe oturur (kararma altında kesme). */
export function resetRideYaw(c: RideYaw, yaw: number): RideYaw {
  c.yaw = c.base = yaw; c.baseVel = 0; c.off = 0; c.offVel = 0; c.user = 0; c.idle = 0; c.auto = 0;
  return c;
}
/** Kritik sönümlü yay adımı (Game Programming Gems 4 "SmoothDamp"); hız tavanı `rate`, hedefi aşmaz. Dönüş [değer, hız]. */
function smoothDamp(cur: number, vel: number, tgt: number, st: number, rate: number, dt: number): [number, number] {
  const omega = 2 / st, x = omega * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const maxChange = rate * st;
  const change = Math.max(-maxChange, Math.min(maxChange, cur - tgt));
  const temp = (vel + omega * change) * dt;
  let v = (vel - omega * temp) * e;
  let out = cur - change + (change + temp) * e;
  if ((tgt - cur > 0) === (out > tgt)) { out = tgt; v = 0; }
  return [out, Math.max(-rate, Math.min(rate, v))];
}
/**
 * Bir kare: `target` otomatik hedef (araç yönü + sapma), `user` bu karedeki Q/E payı, `direct` bu karedeki sürükleme (anında).
 * Otomatik kısım ve gösterilen kullanıcı payı ayrı yaylarla izlenir; toplam dönüş hızı tavanı aşmaz (sürükleme hariç).
 * Dönüş: yeni yaw (sarılmamış; `c.yaw`).
 */
export function stepRideYaw(c: RideYaw, target: number, dt: number, calm: boolean, user = 0, direct = 0): number {
  if (direct) { c.off += direct; c.user += direct; }
  if (user) c.user += user;
  if (user || direct) { c.user = angleDiff(c.user, 0); c.idle = 0; }
  else c.idle += dt;
  if (c.idle > RIDE_USER_HOLD) { c.user *= Math.exp(-dt / RIDE_USER_RETURN); if (Math.abs(c.user) < 1e-3) c.user = 0; }
  // RIDE2: çarpışma ayarı paya karşı çekiyorsa pay o kadar kırpılır (açık yana; bir sonraki ölçüm payı kırpılmış yaw'dan başlar)
  if (c.user * c.auto < 0) { const k = Math.sign(c.user) * Math.min(Math.abs(c.user), Math.abs(c.auto)); c.user -= k; c.auto += k; }
  if (dt > 0) {
    const rate = calm ? RIDE_YAW_RATE_CALM : RIDE_YAW_RATE, st = calm ? RIDE_YAW_SMOOTH_CALM : RIDE_YAW_SMOOTH;
    const [b, bv] = smoothDamp(c.base, c.baseVel, c.base + angleDiff(target, c.base), st, rate, dt);
    const [o, ov] = smoothDamp(c.off, c.offVel, c.user + c.auto, st, rate, dt);
    let db = b - c.base, dof = o - c.off;
    const tot = Math.abs(db + dof), cap = rate * dt;
    if (tot > cap) { const k = cap / tot; db *= k; dof *= k; }
    c.base += db; c.off += dof; c.baseVel = bv; c.offVel = ov;
  }
  c.yaw = c.base + c.off;
  return c.yaw;
}
/**
 * CORE-CITYMAP: binişte kısa **tanıtım çekimi** — kamera aracın yanından, aracın tamamını gösteren genişlikte (`establishDist`),
 * sonra `RIDE_BLEND` saniyede takip pozuna yumuşakça geçer. Hareket azaltmada yolculuk sahnesi yok (doğrudan varış); WalkRig
 * yine de `calm`'da tanıtımı atlar (t = ∞).
 */
export const RIDE_ESTABLISH = 1.4;
/** RIDE-UX: 0,9 → 2,2 sn (geçişte açısal hız ≤ ~30°/sn; eskiden ~60°/sn). */
export const RIDE_BLEND = 2.2;
/** Tanıtım: yandan (yön + `ESTABLISH_SIDE`), alçak eğim; mesafe aracın boyunu kadraja alır. */
export const ESTABLISH_SIDE = 1.2;
export const establishDist = (kind: VehicleKind) => Math.max(7, 2.6 * vehicleHalfLength(kind) + 3);
/** Kabul eşiği: yolculuk karesinin en çok bu oranı aracın (kesilmemiş) bloklarıyla avatarın yakınında kaplı ( ile aynı).*/
export const RIDE_FRAME_MAX = 0.15;

/** Avatarın bu kadar ötesine dek kareyi dolduran araç yüzeyi de engeldir (kamera önden bakınca arkadaki kamara: UXF-B `FRAME_BEYOND`). */
export const RIDE_BEYOND = 2;

type V3 = [number, number, number];
export interface RideCam { x: number; y: number; z: number; lx: number; ly: number; lz: number }


/** avatarın yatay görüş yarı açısının (`hHalfDeg`) içinde, kenardan en az `RIDE_EDGE_DEG` uzak kalması için ileri bakış payı.*/
export const RIDE_EDGE_DEG = 9;
/**
 * dikey telefonda yatay görüş dar (60° dikey, 0,56 en/boy → ±18°); pencere profili (yan 1,1 rad, ileri 4,2) bakışı
 * avatarın ~24° önüne koyuyordu → "Ben" etiketi ve avatar sol kenarda yarım (<city>, Londra, <city>). Bakış noktası rotada kalır, yalnız
 * ileri payı avatar kadraj içinde kalana dek kısalır (ikiye bölme; geniş ekranda değişmez).
*/
export function rideAheadFit(cx: number, cz: number, ax: number, az: number, heading: number, ahead: number, hHalfDeg: number): number {
  const lim = Math.max(2, hHalfDeg - RIDE_EDGE_DEG) * Math.PI / 180;
  const ang = (d: number) => Math.abs(angleDiff(Math.atan2(ax + Math.sin(heading) * d - cx, az + Math.cos(heading) * d - cz), Math.atan2(ax - cx, az - cz)));
  if (ang(ahead) <= lim) return ahead;
  let lo = 0, hi = ahead;
  for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (ang(m) <= lim) lo = m; else hi = m; }
  return lo;
}

/**
 * Yolculuk kamerası: avatar (x, z), ayak y'si, aracın yönü ve kameranın yaw'ı (varsayılan yön + `RIDE_SIDE`; WalkRig Q/E payını
 * ekler). Yükseliş ve mesafe aracın profilinden (kullanıcının takip eğimi/mesafesi yolculuktan sonra aynen döner).
 */
export function rideCamPose(kind: VehicleKind, ax: number, az: number, footY: number, heading: number, yaw = heading + rideSide(kind),
  out: RideCam = { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0 }, t = Infinity, estSide: 1 | -1 = 1, elev?: number, hHalfDeg?: number): RideCam {
  const pr = rideProfile(kind);
  const pivot = { x: ax, y: footY + LOOK_Y, z: az };
  const p = orbitPose(pivot, yaw, -(elev ?? pr.elev), pr.dist); // HQA-FIX: `elev` çarpışma ayarı (rideCamAdjust)
  out.x = p.x; out.y = p.y; out.z = p.z;
  const ahead = hHalfDeg == null ? pr.ahead : rideAheadFit(p.x, p.z, ax, az, heading, pr.ahead, hHalfDeg);
  out.lx = ax + Math.sin(heading) * ahead; out.ly = pivot.y; out.lz = az + Math.cos(heading) * ahead;
  if (t < RIDE_ESTABLISH + RIDE_BLEND) {
    // tanıtım çekimi: yandan, aracın ortasına bakar; sonra takip pozuna yumuşak geçiş (smoothstep)
    const e = establishPose(kind, ax, az, footY, heading, estSide);
    const u = Math.max(0, Math.min(1, (t - RIDE_ESTABLISH) / RIDE_BLEND)), k = u * u * (3 - 2 * u);
    // (RIDE-SPIN-001): düz doğru (kiriş) avatarın dibinden geçip kerterizi 170°/sn savuruyordu; avatar çevresinde yay (yaw en kısa yoldan, yarıçap/yükseliş doğrusal)
    const a = sph(e.x - pivot.x, e.y - pivot.y, e.z - pivot.z), b = sph(out.x - pivot.x, out.y - pivot.y, out.z - pivot.z);
    const yw = a.yaw + angleDiff(b.yaw, a.yaw) * k, rr = a.r + (b.r - a.r) * k, el = a.el + (b.el - a.el) * k, cc = Math.cos(el) * rr;
    out.x = pivot.x + Math.sin(yw) * cc; out.y = pivot.y + Math.sin(el) * rr; out.z = pivot.z + Math.cos(yw) * cc;
    out.lx = ax + (out.lx - ax) * k; out.ly = footY + 0.9 + (out.ly - footY - 0.9) * k; out.lz = az + (out.lz - az) * k;
  }
  return out;
}

/**
 * Tanıtım çekiminin kamera noktası (yandan, alçak eğim). `side` −1 öbür yan — WalkRig binişte iki yanın yaylı kol
 * açıklığını ölçer; iskele binası/saçağı tarafındaki yan seçilmez, iki yan da kapalıysa tanıtım atlanır (kamera kamaraya düşmez).
*/
export function establishPose(kind: VehicleKind, ax: number, az: number, footY: number, heading: number, side: 1 | -1 = 1) {
  return orbitPose({ x: ax, y: footY + 0.9, z: az }, heading + side * ESTABLISH_SIDE, -0.3, establishDist(kind));
}

/** Aracın dünya blokları (yön 90°'ye yuvarlanır: kutular eksen hizalı) — CityRig kapasite kuyruğuna bunu yazar. VEHICLE-DETAIL:
 *  `opts` şehir/hat livresi (yakın ayrıntı düzeyi; binilen araç hep yakında). */
export function vehicleAt(kind: VehicleKind, body: RidePose, rideY: number, opts: VehicleOpts = {}, out?: Block[]): Block[] {
  const side = Math.abs(Math.sin(body.heading)) > 0.7, sz = Math.cos(body.heading) >= 0 ? 1 : -1, sx = Math.sin(body.heading) >= 0 ? 1 : -1;
  const dy = body.y - rideY;
  const local = vehicleBlocks(kind, opts);
  if (!out) return local.map((b) => {
    const [lx, ly0, lz] = b.p, [w, h, d] = b.s, ly = ly0 + dy;
    const p: V3 = side ? [body.x + lz * sx, ly, body.z + lx * sx] : [body.x + lx * sz, ly, body.z + lz * sz];
    return { ...b, p, s: side ? [d, h, w] : [w, h, d] };
  });
  // kare başına çağıranlar (CityRig kuyruk yazımı, yolculuk kamerası örnekleri) kalıcı tampona yerinde yazar —
  // değerler yukarıdaki kopyayla aynı; tampon öğeleri kendi p/s dizilerini taşır (kare başına nesne/dizi yok)
  out.length = local.length;
  for (let i = 0; i < local.length; i++) {
    const b = local[i];
    let o = out[i];
    if (!o) { o = { ...b, p: [0, 0, 0], s: [0, 0, 0] }; out[i] = o; } else { o.c = b.c; o.g = b.g; o.j = b.j; } // araç kutuları yalnız p, s, c, g, j (model.ts box)
    const [lx, ly0, lz] = b.p, [w, h, d] = b.s, ly = ly0 + dy;
    if (side) { o.p[0] = body.x + lz * sx; o.p[1] = ly; o.p[2] = body.z + lx * sx; o.s[0] = d; o.s[1] = h; o.s[2] = w; }
    else { o.p[0] = body.x + lx * sz; o.p[1] = ly; o.p[2] = body.z + lz * sz; o.s[0] = w; o.s[1] = h; o.s[2] = d; }
  }
  return out;
}

function hitBox(o: V3, d: V3, lo: V3, hi: V3): number {
  let t0 = 0, t1 = Infinity;
  for (let q = 0; q < 3; q++) {
    if (Math.abs(d[q]) < 1e-9) { if (o[q] < lo[q] || o[q] > hi[q]) return Infinity; continue; }
    let a = (lo[q] - o[q]) / d[q], c = (hi[q] - o[q]) / d[q];
    if (a > c) { const s = a; a = c; c = s; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

// yolculuk ölçüsünün (rideFrame / rideWall; ayar başına ~100 aday × 3 an) kutu ve ışın tamponları — eskiden aday başına
// filter + map dizileri, kutu başına iki V3 ve planCuts nesnesi, ışın başına V3 kuruluyordu. Değerler aynı (aynı sıra, aynı işlemler).
const _raw: Box[] = [];
const _lo: V3[] = [], _hi: V3[] = [];
const _dir: V3 = [0, 0, 0];
/** Sayılan kutuların (parıltı değil, tepesi ayağın 0,35 üstünde, sokak kesiti atmıyor) sınırlarını `_lo`/`_hi`ye yazar; dönüş: sayı. */
function keptBoxes(list: readonly { p: readonly number[]; s: readonly number[]; g?: string }[], footY: number, plan: object): number {
  let n = 0;
  for (const b of list) {
    if (!(b.g !== "glow" && b.p[1] + b.s[1] / 2 >= footY + 0.35 && !planCuts(plan as never, b as never))) continue;
    const lo = (_lo[n] ??= [0, 0, 0]), hi = (_hi[n] ??= [0, 0, 0]);
    lo[0] = b.p[0] - b.s[0] / 2; lo[1] = b.p[1] - b.s[1] / 2; lo[2] = b.p[2] - b.s[2] / 2;
    hi[0] = b.p[0] + b.s[0] / 2; hi[1] = b.p[1] + b.s[1] / 2; hi[2] = b.p[2] + b.s[2] / 2;
    n++;
  }
  return n;
}

/**
 * Yolculuk karesinin araç engeli (0–1): kamera `cam`, bakış `cam.l*`; WalkRig'in sokak kesiti (gövde yoklaması + kamera
 * kabarcığı; `planCuts`) attığı bloklar sayılmaz. Işının ilk çarptığı kalan araç bloğu kameraya göğsün `RIDE_BEYOND`
 * ötesinden yakınsa engelli — avatarı ya da önündeki rotayı örten kabin; döşeme sayılmaz. 32 × 20 ışın, 16:10.
 */
export function rideFrame(blocks: readonly Block[], ax: number, az: number, footY: number, cam: RideCam, aspect = 16 / 10, NX = 32, NY = 20): number {
  const c: V3 = [cam.x, cam.y, cam.z], chest: V3 = [ax, footY + LOOK_Y, az], minY = footY + 0.08;
  const plan = { roof: null, shell: null, probes: streetProbes(chest, c), cam: c, minY, near: { at: c, r: 0.3 } } as const;
  // döşeme/gövde altı (tepesi ayağın 0,35 üstünden alçak) zemindir, engel değil (spawnFrame `STAND_H`)
  const n = keptBoxes(blocks, footY, plan);
  const f: V3 = [cam.lx - c[0], cam.ly - c[1], cam.lz - c[2]];
  const fl = Math.hypot(...f) || 1; f[0] /= fl; f[1] /= fl; f[2] /= fl;
  const rl = Math.hypot(f[2], f[0]) || 1;
  const right: V3 = [-f[2] / rl, 0, f[0] / rl];
  const up: V3 = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
  const th = Math.tan((walkFov(WALK_FOV_DEFAULT, aspect) * Math.PI) / 360), tw = th * aspect;
  const chestD = Math.hypot(chest[0] - c[0], chest[1] - c[1], chest[2] - c[2]);
  let blocked = 0;
  for (let yi = 0; yi < NY; yi++) for (let xi = 0; xi < NX; xi++) {
    const sx = ((xi + 0.5) / NX * 2 - 1) * tw, sy = (1 - (yi + 0.5) / NY * 2) * th;
    const d = _dir; d[0] = f[0] + right[0] * sx + up[0] * sy; d[1] = f[1] + right[1] * sx + up[1] * sy; d[2] = f[2] + right[2] * sx + up[2] * sy;
    const dl = Math.hypot(d[0], d[1], d[2]); d[0] /= dl; d[1] /= dl; d[2] /= dl;
    let t = Infinity;
    for (let i = 0; i < n; i++) { const h = hitBox(c, d, _lo[i], _hi[i]); if (h < t) t = h; }
    if (t < chestD + RIDE_BEYOND) blocked++;
  }
  return blocked / (NX * NY);
}

// ------------------------------------------------------------------ yakın duvar payı
/** Kameraya bu kadar yakın (birim) sabit yüzey "yakın duvar" sayılır; kare payı `RIDE_WALL_MAX`'ı aşan aday kabul edilmez. */
export const RIDE_WALL_NEAR = 3;
/** Bu uzaklıktan (birim) yakın yüzey tam ağırlıklı; `RIDE_WALL_NEAR`'a doğru ağırlık 0'a iner. */
export const RIDE_WALL_FULL = 1.5;
export const RIDE_WALL_MAX = 0.08;
/**
 * Yolculuk karesinin yakın duvar payı (saf): kameradan `RIDE_WALL_NEAR` birimden yakın en yakın sabit yüzeyin kapladığı ışın oranı (≤ `RIDE_WALL_FULL` tam, ötesi doğrusal azalan ağırlık)
 * (16 × 10). Kol açık kalsa bile kameranın yanındaki bina duvarı kareyi doldurabilir (<city> Tiyatro hattı, tren ile bina arası);
 * `rideAdjScore.arm` bunu ölçmez. `src`: araç içermeyen sabit kaynak (ince üst levhalar `rideArmSourceOf` ile atlanır); WalkRig'in
 * sokak kesiti attığı bloklar (`planCuts`), zemin (tepesi ayağın 0,35 altı) ve parıltı bloğu sayılmaz (`rideFrame` ile aynı kural).
*/
export function rideWall(src: BoxSource, ax: number, az: number, footY: number, cam: RideCam, aspect = 16 / 10, nx = 16, ny = 10, fovDeg = walkFov(WALK_FOV_DEFAULT, aspect)): number {
  const c: V3 = [cam.x, cam.y, cam.z], R = RIDE_WALL_NEAR, chest: V3 = [ax, footY + LOOK_Y, az];
  const plan = { roof: null, shell: null, probes: streetProbes(chest, c), cam: c, minY: footY + 0.08, near: { at: c, r: 0.3 } } as const;
  _raw.length = 0;
  rideArmSourceOf(src, footY)(c[0] - R, c[2] - R, c[0] + R, c[2] + R, _raw);
  const n = keptBoxes(_raw, footY, plan);
  _raw.length = 0; // kaynak kutularını tutma
  if (!n) return 0;
  const f: V3 = [cam.lx - c[0], cam.ly - c[1], cam.lz - c[2]];
  const fl = Math.hypot(...f) || 1; f[0] /= fl; f[1] /= fl; f[2] /= fl;
  const rl = Math.hypot(f[2], f[0]) || 1;
  const right: V3 = [-f[2] / rl, 0, f[0] / rl];
  const up: V3 = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
  const th = Math.tan((fovDeg * Math.PI) / 360), tw = th * aspect; // GATEFIX2: ride_frame profilin gerçek açısını verir
  let near = 0;
  for (let yi = 0; yi < ny; yi++) for (let xi = 0; xi < nx; xi++) {
    const sx = ((xi + 0.5) / nx * 2 - 1) * tw, sy = (1 - (yi + 0.5) / ny * 2) * th;
    const d = _dir; d[0] = f[0] + right[0] * sx + up[0] * sy; d[1] = f[1] + right[1] * sx + up[1] * sy; d[2] = f[2] + right[2] * sx + up[2] * sy;
    const dl = Math.hypot(d[0], d[1], d[2]); d[0] /= dl; d[1] /= dl; d[2] /= dl;
    let t = Infinity;
    for (let i = 0; i < n; i++) { const h = hitBox(c, d, _lo[i], _hi[i]); if (h < t) t = h; }
    if (t < R) near += Math.min(1, (R - t) / (R - RIDE_WALL_FULL)); // yumuşak: sert 3 birim eşiği kare başına 0 ↔ 0,4 sıçratıyordu
  }
  return near / (nx * ny);
}

// ------------------------------------------------------------------ HQA-FIX: çarpışma bilen yolculuk kamerası
/**
 * Kök neden (canlı: <city> m1, yolculuğun ortasında kare duvarın içinde, sonra yarısı vagon yan yüzü): yolculuk pozu sabitti (türün
 * sapması/yükselişi). Sokak kanyonunda pencere kamerası (63° yandan, 6,6 birim) cepheye/saçağa çarpıyor, yaylı kol kısalıp kamerayı
 * vagonun yanına çekiyordu; araç kamera çarpışmasında yok, kare vagon duvarıyla doluyordu (taramada metro örneklerinin %23'ü).
 * Ayar: profil pozu kolu açık ve aracı örtmüyorsa (kol ≥ %70, `rideFrame` ≤ `RIDE_FRAME_MAX`) dokunulmaz; değilse tercih sırasıyla
 * (önce yükseliş, sonra arkaya doğru yaw) ilk uygun aday; hiçbiri değilse en iyi puanlı. WalkRig 4 Hz ölçer, `stepRideAdj` yumuşatır.
*/
export interface RideAdj { dyaw: number; elev: number }
/** Denenen yaw payları (rad; profil yaw'ına eklenir — − araç arkasına doğru; `null` = tam arka, −sapma) ve yükselişler (profilinkine
 *  ek olarak; 1,3 rad: dar koridorda — cephe, ağaç, saçak — aracın arkasından ve üstünden, tavanı kesitle açık). */
export const RIDE_ADJ_YAWS = [0, -0.35, 0.35, -0.7, null, 0.7, -1.05, 1.05] as const; // son üç aday yalnız dar koridorda (yakın duvar) denenir
export const RIDE_ADJ_ELEVS = [0.5, 0.7, 0.9] as const;
/** yolculuk kamerasının avatar üstündeki yükseliş tavanı (rad ≈ 52°). 1,1/1,3 rad dar kanyonda (NY, <city> metro)
 * kamerayı neredeyse dik yukarı taşıyor, araç görünmüyordu; adaylar önce alçak yükselişte bütün yaw'larla denenir.*/
export const RIDE_ELEV_MAX = 0.9;
/** Alçak yükseliş (köprü ya da iskele örtüsü altında: yukarı kalkan kol tabliyeye çarpar) — profilinkinden alçaksa denenir. */
export const RIDE_ADJ_LOW = 0.12;
/** Kabul: kolun en az bu oranı açık. */
export const RIDE_ARM_OK = 0.7;
/** Yumuşatma: yaw payı `RideYaw.auto` ile yaw denetleyicisinde (toplam tavan `RIDE_YAW_RATE`), yükseliş ≤ 1,6 rad/sn (tente/ağaç
 *  altına girmeden önce kalkar: metro 6 birim/sn). */
export const RIDE_ADJ_ELEV_RATE = 1.6;

/**
 * Araç tavanının üstündeki ince levhalar (tente, saçak, tabela, durak örtüsü: kalınlık ≤ `RIDE_THIN_SLAB`, tabanı ayağın
 * `RIDE_SLAB_MIN` üstünde) yolculuk kolunu kısaltmaz: sokak kesiti gövde → kamera doğrusunu kesen bloğu bütün açar (çatı gibi).
 * <city>'te tenteler metro tavanının (1,88) hemen üstünde (1,85–1,98); her yükselişte kol 0,6 birimde kesiliyordu. Kameranın
 * kendisi levhanın içinde kalamaz (`rideAdjScore` uç noktayı tam kaynakla dener). `foot`: ayak y'si (yerinde güncellenir).
*/
export const RIDE_THIN_SLAB = 0.3;
export const RIDE_SLAB_MIN = 1.5;
/** (RIDE-CAM-001 payı): yalnız araç tavanı hizasındaki levha (tente/saçak) geçilir; daha yüksek ince levha bina çatısı/korkuluğudur
 * (Marakeş otobüsü: kol 3,6–3,9'daki çatı levhasının içinden geçip kare duvarla doluyordu).*/
export const RIDE_SLAB_MAX = 2.6;
/** ince direk (iki yatay kenar ≤ RIDE_POLE_W: fener, tabela, kablo direği) yolculuk kolunu kısaltmaz — kolun yarı yolunda 1 karelik direk geçişi
 * kamerayı 2 birim kısaltıp yavaşça uzatıyordu (<city> suijo otobüsü dikey: 8,8 → 7,0). Kameranın kendisi direğin içinde kalamaz (tam kaynakla `pointBlocked`).*/
export const RIDE_POLE_W = 0.45;
export function rideArmSource(base: BoxSource, foot: { y: number }): BoxSource {
  return (x0, z0, x1, z1, out: Box[]) => {
    const n = out.length;
    base(x0, z0, x1, z1, out);
    let w = n;
    for (let i = n; i < out.length; i++) { const b = out[i]; if (!((b.s[1] <= RIDE_THIN_SLAB && b.p[1] - b.s[1] / 2 >= foot.y + RIDE_SLAB_MIN && b.p[1] + b.s[1] / 2 <= foot.y + RIDE_SLAB_MAX) || Math.max(b.s[0], b.s[2]) <= RIDE_POLE_W)) out[w++] = b; }
    out.length = w;
  };
}
const armSrc = new WeakMap<BoxSource, { src: BoxSource; foot: { y: number } }>();
/**
 * kameranın KENDİSİ için ride kaynağı = tam kaynak − ufak donatı (iki yatay kenar ≤ RIDE_POLE_W: fener plakası, direk, tabela).
 * Gecikmeli kamera böyle bir donatının içinden geçince tam kaynak kolu 3–5 birim tek karede kısaltıyordu (<city> m2: tavan lambası plakası 0,3 × 0,1 × 0,3).
 * Levha/duvar (geniş yüzey) tam kaynakta kalır.
*/
export function rideEndSource(base: BoxSource): BoxSource {
  return (x0, z0, x1, z1, out: Box[]) => {
    const n = out.length;
    base(x0, z0, x1, z1, out);
    let w = n;
    for (let i = n; i < out.length; i++) { const b = out[i]; if (Math.max(b.s[0], b.s[2]) > RIDE_POLE_W) out[w++] = b; }
    out.length = w;
  };
}
const endSrc = new WeakMap<BoxSource, BoxSource>();
export const rideEndSourceOf = (base: BoxSource): BoxSource => { let e = endSrc.get(base); if (!e) { e = rideEndSource(base); endSrc.set(base, e); } return e; };

/** `rideArmSource` önbelleği (taban kaynak başına bir sarmalayıcı; ayak y'si her çağrıda yazılır). */
export function rideArmSourceOf(base: BoxSource, footY: number): BoxSource {
  let e = armSrc.get(base);
  if (!e) { const foot = { y: footY }; e = { src: rideArmSource(base, foot), foot }; armSrc.set(base, e); }
  e.foot.y = footY;
  return e.src;
}

/** Aday pozun ölçüsü: kol oranı (durağan geometri; ince üst levhalar geçilir) ve aracın kareyi örtmesi (kol sonrası gerçek kamera). */
export function rideAdjScore(kind: VehicleKind, src: BoxSource, blocks: readonly Block[], ax: number, az: number, footY: number, lookH: number, yaw: number,
  adj: RideAdj, o: { radius: number; floorTop: number; aspect: number }): { arm: number; frame: number; wall: number } {
  const c = rideCamPose(kind, ax, az, footY, lookH, yaw + adj.dyaw, undefined, Infinity, 1, adj.elev);
  // `yaw`: payı çıkarılmış kamera yaw'ı (araç yönü + sapma + kullanıcı payı)
  const pv: [number, number, number] = [ax, footY + LOOK_Y, az];
  const want = Math.hypot(c.x - pv[0], c.y - pv[1], c.z - pv[2]) || 1;
  const hard = sweepArm(rideArmSourceOf(src, footY), pv, [c.x, c.y, c.z], o.radius, o.floorTop);
  let k = Math.min(1, hard / want);
  let nx = pv[0] + (c.x - pv[0]) * k, ny = pv[1] + (c.y - pv[1]) * k, nz = pv[2] + (c.z - pv[2]) * k;
  // kamera ince levhanın içinde kalırsa (geçilen levhada durdu) kol tam kaynakla kısalır
  const endS = rideEndSourceOf(src);
  if (pointBlocked(endS, [nx, ny, nz], o.radius * 0.5, o.floorTop)) {
    k = Math.min(k, sweepArm(endS, pv, [c.x, c.y, c.z], o.radius, o.floorTop) / want);
    nx = pv[0] + (c.x - pv[0]) * k; ny = pv[1] + (c.y - pv[1]) * k; nz = pv[2] + (c.z - pv[2]) * k;
  }
  const cam: RideCam = { x: nx, y: ny, z: nz, lx: c.lx + nx - c.x, ly: c.ly + ny - c.y, lz: c.lz + nz - c.z };
  return { arm: k, frame: rideFrame(blocks, ax, az, footY, cam, o.aspect, 16, 10), wall: rideWall(src, ax, az, footY, cam, o.aspect) }; // yakın duvar payı
}

/** yalnız kol oranı (`rideAdjScore`un kol kısmı; kare/duvar ölçülmez).*/
function rideArmRatio(kind: VehicleKind, src: BoxSource, q: RideSample, adj: RideAdj, o: { radius: number; floorTop: number }): number {
  const c = rideCamPose(kind, q.ax, q.az, q.footY, q.lookH, q.yaw + adj.dyaw, undefined, Infinity, 1, adj.elev);
  const pv: [number, number, number] = [q.ax, q.footY + LOOK_Y, q.az];
  const want = Math.hypot(c.x - pv[0], c.y - pv[1], c.z - pv[2]) || 1;
  return Math.min(1, sweepArm(rideArmSourceOf(src, q.footY), pv, [c.x, c.y, c.z], o.radius, o.floorTop) / want);
}

/** Ayarın değerlendirildiği bir an: avatar (x, z), ayak y'si, bakış yönü, payı çıkarılmış kamera yaw'ı ve aracın blokları. */
export interface RideSample { ax: number; az: number; footY: number; lookH: number; yaw: number; blocks: readonly Block[]; /** RIDE2: `yaw`daki kullanıcı payı */ user?: number;
  /** yalnız kol ölçülür (kare/duvar yok) — yoğun ileri anlar ucuz*/ armOnly?: boolean }

/**
 * Hedef ayar (saf). `samples[0]` şimdi, sonrakiler rotada ileri anlar (kamera dar koridora girmeden döner/kalkar). Tercih sırası:
 * bütün anlarda uygun ilk aday › yalnız şimdi uygun ilk aday › şimdinin en iyi puanlısı. Profil pozu her anda uygunsa {0, profil}.
 * `prev` (önceki hedef) bütün anlarda hâlâ uygunsa o kalır (gidip gelme yok).
 */
export function rideCamAdjust(kind: VehicleKind, src: BoxSource, samples: readonly RideSample[], o: { radius: number; floorTop: number; aspect: number },
  prev: RideAdj | null = null): RideAdj {
  const e0 = rideProfile(kind).elev, side = rideSide(kind), floorDy = o.floorTop - samples[0].footY;
  const okAt = (q: RideSample, adj: RideAdj) => {
    if (q.armOnly) return rideArmRatio(kind, src, q, adj, { ...o, floorTop: q.footY + floorDy }) >= RIDE_ARM_OK;
    const r = rideAdjScore(kind, src, q.blocks, q.ax, q.az, q.footY, q.lookH, q.yaw, adj, { ...o, floorTop: q.footY + floorDy });
    return r.arm >= RIDE_ARM_OK && r.frame <= RIDE_FRAME_MAX && r.wall <= RIDE_WALL_MAX;
  };
  const okAll = (adj: RideAdj) => samples.every((q) => okAt(q, adj));
  const profile = { dyaw: 0, elev: e0 }, tall = o.aspect < 1;
  // RIDE2: dikey ekranda uygun önceki hedef profilden önce gelir (profile dönüş kapalı sektörün içinden dönüyordu: <city> teleferik −1,7 → 0)
  if (tall && prev && okAll(prev)) return prev;
  if (okAll(profile)) return profile;
  if (prev && (prev.dyaw !== 0 || prev.elev !== e0) && okAll(prev)) return prev;
  // RIDE2: profil pozu (kullanıcı payıyla) uygun değilse pay `rideWall`ın ölçtüğü açık yana kırpılır — adaylar payı çıkarılmış yaw'dan
  // (pay 0 ile aynı arama; `stepRideYaw` payı kalıcı kısar). Eskiden adaylar payın üstüne ekleniyordu: pay duvar yanına döndürünce ±1,05 adayları da duvarda kalıyordu.
  const u = samples[0].user ?? 0;
  const cands = [e0, ...RIDE_ADJ_ELEVS.filter((e) => e > e0), ...(RIDE_ADJ_LOW < e0 ? [RIDE_ADJ_LOW] : [])].flatMap((elev) => [...RIDE_ADJ_YAWS, -2 * side].map((d) => ({ dy: d ?? -side, elev })));
  // RIDE2: dikey ekranda (yatay açı ~40°) önceki hedefe en yakın aday önce (|Δyaw| + |Δyükseliş|) — sabit sıra kamerayı 1–2 rad öteye, aradaki kapalı
  // sektörün (duvar) içinden döndürüyordu (<city> teleferik 0,35 → −0,85 → 0,7; <city> füniküler 0 → −2,2)
  if (prev && tall) { const p0 = prev.dyaw + u, c = (q: { dy: number; elev: number }) => Math.abs(q.dy - p0) + Math.abs(q.elev - prev.elev); cands.sort((a, b) => c(a) - c(b)); }
  let nowOk: RideAdj | null = null, best: RideAdj = profile, bestScore = -Infinity;
  const q0 = samples[0];
  // (RIDE-CAM-001 payı): son aday aynalı yan (−2 × sapma: kamera aracın ÖTEKİ yanında) — hat bir yanında binanın dibinden geçerken
  // yan kamera (6,6 birim, 63°) binanın içine düşüyor, hiçbir yükseliş/yaw adayı duvardan kurtulamıyordu (Şanghay m1)
  for (const { dy, elev } of cands) {
    const adj = { dyaw: dy - u, elev };
    const r = rideAdjScore(kind, src, q0.blocks, q0.ax, q0.az, q0.footY, q0.lookH, q0.yaw, adj, o);
    if (r.arm >= RIDE_ARM_OK && r.frame <= RIDE_FRAME_MAX && r.wall <= RIDE_WALL_MAX) {
      if (samples.slice(1).every((q) => okAt(q, adj))) return adj;
      nowOk ??= adj;
      continue;
    }
    const sc = Math.min(r.arm, RIDE_ARM_OK) - 2 * r.frame - 8 * r.wall - 0.02 * Math.abs(adj.dyaw + u);
    if (sc > bestScore) { bestScore = sc; best = adj; }
  }
  return nowOk ?? best;
}

/** Ayarın ileri bakış anları (sn, şimdiden sonra). */
// ileriye bakış SÜRE olarak yazılmıştı (araç hızına göre ayarlı); hız 0,7 katı olunca yol olarak %30 kısalıyordu (<city> suijo_bus RIDE-CAM-001) → süre / hız katı = aynı yol
export const RIDE_ADJ_AHEAD: readonly number[] = [0.8 / RIDE_SPEED_FACTOR, 1.6 / RIDE_SPEED_FACTOR];
/** kol-yalnız yoğun ileri anlar (sn). Yola yakın alçak bir eşya (0,8 × 0,4 direk/otomat) kolu ancak araç önünden geçerken
 * ~0,3 sn kesiyor (metro 4,4 birim/sn); 0,8 sn aralıklı anlar bu pencereyi atlıyor, kamera 1 karede 5 birim kısalıyordu (<city> ginza 5,1 birim).*/
export const RIDE_ARM_AHEAD: readonly number[] = [0.2, 0.4, 0.6, 1.0, 1.2, 1.4].map((d) => d / RIDE_SPEED_FACTOR);
/** RIDE2: kullanıcı payı varken ufuk payın geri dönüş süresi kadar uzar (|pay| + 1,1 rad ≈ 2,4 sn @ 40°/sn) — kırpma duvara varmadan başlar. */
export const RIDE_ADJ_AHEAD_USER: readonly number[] = [0.8, 1.6, 2.4, 3.2].map((d) => d / RIDE_SPEED_FACTOR); // aynı yol uzunluğu
const SAMPLE_BUF: Block[][] = [[], [], [], [], []];
/** Şimdiki an (`now`, gövde `body`) + rotada `RIDE_ADJ_AHEAD` ilerisi; `tau` binişten sonraki yolculuk saati, `user` kullanıcı yaw payı. */
export function rideSamples(plan: TravelPlan, tau: number, now: Omit<RideSample, "blocks">, body: RidePose, opts: VehicleOpts, user = 0): RideSample[] {
  // araç kutuları örnek başına kalıcı tampona (her kare çağrılır; dönüş aynı karede tüketilir — WalkRig rideAdjustNow)
  const out: RideSample[] = [{ ...now, user, blocks: vehicleAt(plan.kind, body, plan.rideY, opts, SAMPLE_BUF[0]) }];
  const tl = rideTimeline(plan), side = rideSide(plan.kind);
  // güverte (vapur/kayık) kamerası yalnız hız katı kadar uzar; raylı/arabalı takip kamerası ek %30 ( ölçüsü %12,5; Şanghay m1, Marakeş t1)
  const far = RIDE_PROFILE[plan.kind]?.view === "deck" ? 1 : 1.15;
  for (const d0 of user ? RIDE_ADJ_AHEAD_USER : RIDE_ADJ_AHEAD) {
    const d = user ? d0 : d0 * far;
    if (tau + d > tl.T) break;
    const st = rideStateAt(plan, Math.max(0, tau) + d, tl);
    out.push({ ax: st.x, az: st.z, footY: st.y, lookH: st.heading, yaw: st.heading + side + user, blocks: vehicleAt(plan.kind, poseAtArc(plan, bodyArc(plan, st.s)), plan.rideY, opts, SAMPLE_BUF[out.length]) });
  }
  for (const d of RIDE_ARM_AHEAD) {
    if (tau + d > tl.T) break;
    const st = rideStateAt(plan, Math.max(0, tau) + d, tl);
    out.push({ ax: st.x, az: st.z, footY: st.y, lookH: st.heading, yaw: st.heading + side + user, blocks: [], armOnly: true });
  }
  return out;
}

/** Yükselişin yumuşak izi (hareket azaltmada doğrudan); yaw payı `RideYaw.auto`ya yazılır (denetleyici yumuşatır). Dönüş: yükseliş. */
export function stepRideElev(cur: number, target: number, dt: number, calm: boolean): number {
  if (calm) return target;
  const m = RIDE_ADJ_ELEV_RATE * dt;
  return cur + Math.max(-m, Math.min(m, target - cur));
}

/**
 * biniş/iniş kamera devri. Eskiden binişte (yürüyüş → tanıtım çekimi) ve inişte (yolculuk → yürüyüş arkası) kamera
 * tek karede oturuyordu (`settle`): canlıda 94–180° dönüş + 6–11 birim sıçrama, inişte 52–90°. Devir, son gösterilen kamerayı avatarın
 * göğsüne göre (yaw, yükseliş, uzaklık) tutar ve `RIDE_HANDOFF` sn'de yeni hedef poza küresel olarak geçer (smoothstep) — kamera avatarın
 * çevresinde döner, içinden geçmez; bakış noktası göğse göre doğrusal. Avatar kararma altında yer değiştirirse kamera onunla taşınır.
*/
export const RIDE_HANDOFF = 1.8; // 180° devirde kare başına ≤ ~4° / 0,4 birim (60 Hz)
/** Geniş (≥ 1,2 rad) devirde yolun ortasındaki ek yükseliş (rad). */
export const RIDE_HANDOFF_LIFT = 0.4;
/** (RIDE-SPIN-001): devirde kameranın en hızlı dönüşü (rad/sn; ≈ 103°/sn). Büyük dönüşte süre uzar: 180° → 2,6 sn; daha yavaşı duvar payını bozuyor (ride_frame) (ürün sahibi: "kamera deli gibi dönüyor").*/
export const RIDE_HANDOFF_RATE = 1.8;
export interface CamHandoff { u?: number; t: number; r: number; yaw: number; el: number; lx: number; ly: number; lz: number; dy?: number }
type P3 = { x: number; y: number; z: number };
const sph = (dx: number, dy: number, dz: number) => { const h = Math.hypot(dx, dz); return { r: Math.hypot(h, dy), yaw: Math.atan2(dx, dz), el: Math.atan2(dy, h) }; };
/** Devri başlat: `cam`/`look` şimdi gösterilen kamera, `pivot` onun baktığı göğüs (önceki kare). */
export function startHandoff(cam: P3, look: P3, pivot: P3): CamHandoff {
  return { t: 0, ...sph(cam.x - pivot.x, cam.y - pivot.y, cam.z - pivot.z), lx: look.x - pivot.x, ly: look.y - pivot.y, lz: look.z - pivot.z };
}
/** Bir kare: `cam`/`look` hedef poz (girdi) → karışık poz (yerinde). Dönüş: devir sürüyor mu. */
export function stepHandoff(h: CamHandoff, pivot: P3, cam: P3, look: P3, dt: number): boolean {
  h.t += dt;
  const s = sph(cam.x - pivot.x, cam.y - pivot.y, cam.z - pivot.z);
  // geniş dönüşte kamera aracın/durağın gövdesinin içinden değil üstünden geçer (canlı <city>: binişte 0,9 sn'de kare vagon yan yüzüyle doluydu)
  // hedef yaw sürekli dönerken (viewTurn) tam 180°'de en kısa yön işaret değiştirip kamerayı tek karede 83° savuruyordu — açı açılır (unwrap)
  const raw = angleDiff(s.yaw, h.yaw), dy = h.dy === undefined ? raw : h.dy + angleDiff(raw, h.dy);
  // (RIDE-SPIN-001): ilerleme (u) hızı o anki dönüş açısına göre: smoothstep tepe hızı = 1,5 × açı / süre ≤ RIDE_HANDOFF_RATE (hedef dönerken de, F paneli)
  h.u = Math.min(1, (h.u ?? 0) + dt / Math.max(RIDE_HANDOFF, (1.5 * Math.abs(dy)) / RIDE_HANDOFF_RATE));
  const u = h.u, k = u * u * (3 - 2 * u), lift = RIDE_HANDOFF_LIFT * Math.sin(Math.PI * k) * Math.min(1, Math.abs(dy) / 1.2);
  h.dy = dy;
  const r = h.r + (s.r - h.r) * k, yaw = h.yaw + dy * k, el = Math.min(1.2, h.el + (s.el - h.el) * k + lift), c = Math.cos(el) * r;
  cam.x = pivot.x + Math.sin(yaw) * c; cam.y = pivot.y + Math.sin(el) * r; cam.z = pivot.z + Math.cos(yaw) * c;
  look.x = pivot.x + h.lx + (look.x - pivot.x - h.lx) * k; look.y = pivot.y + h.ly + (look.y - pivot.y - h.ly) * k; look.z = pivot.z + h.lz + (look.z - pivot.z - h.lz) * k;
  return u < 1;
}

/**
 * devir sürerken (ve bitince yakınsayana dek) kameranın pivota göre konumu kare başına sınırlı değişir. Canlı (<city> metro,
 * 375 × 812): devrin yükselttiği yol bir engele değince çarpışma kolu (armSafety) kamerayı tek karede 3,2 birim kısaltıyordu. `cam` girdi:
 * kolla güvenli poz; çıktı: önceki göreli konumdan en çok HAND_CAM_RATE·dt uzakta. Hedef hep kolla güvenli pozdur: kamera yakınsayınca
 * katının dışında DURUR; geçişte değdiği blok kamera kabarcığıyla (cover.ts nearCuts) bütün açılır. Dönüş: bu karenin göreli konumu.
*/
export const HAND_CAM_RATE = 9;
export function handCamLimit(pivot: P3, cam: P3, prev: P3 | null, dt: number): P3 {
  const want = { x: cam.x - pivot.x, y: cam.y - pivot.y, z: cam.z - pivot.z };
  if (!prev) return want;
  const dx = want.x - prev.x, dy = want.y - prev.y, dz = want.z - prev.z, d = Math.hypot(dx, dy, dz), step = HAND_CAM_RATE * dt;
  if (d <= step) return want;
  const k = step / d, rel = { x: prev.x + dx * k, y: prev.y + dy * k, z: prev.z + dz * k }, p = { x: pivot.x + rel.x, y: pivot.y + rel.y, z: pivot.z + rel.z };
  cam.x = p.x; cam.y = p.y; cam.z = p.z;
  return rel;
}

/**
 * tanıtım çekiminden takibe geçiş (RIDE_BLEND) yolundaki en kötü yakın duvar payı: kamera tanıtım noktası ile takip pozu arasında
 * kaya/bina duvarının dibinden geçerse (<city> kanyonu, Marakeş) kare duvarla dolar. Ara anlar (u = 0 … 0,75; u = 0 tanıtım noktasının kendisi) avatarın biniş yerinde ölçülür.
 * Saf; WalkRig `rideIntroSide` (yan seçimi) ve scripts/ride_frame.mjs kullanır.
*/
export function introBlendWall(kind: VehicleKind, src: BoxSource, ax: number, az: number, footY: number, heading: number, yaw: number, side: 1 | -1, aspect = 16 / 10, elev?: number): number {
  let worst = 0;
  const out: RideCam = { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0 };
  for (const u of [0, 0.25, 0.5, 0.75]) {
    rideCamPose(kind, ax, az, footY, heading, yaw, out, RIDE_ESTABLISH + RIDE_BLEND * u, side, elev);
    worst = Math.max(worst, rideWall(src, ax, az, footY, out, aspect));
  }
  return worst;
}
