/**
 * şehir haritası canlı katmanı: binilmeyen hat araçları hatlarında dolaşır (vapur,
 * kayık, teleferik, monoray, balon), su üstünde martı ve meydanda güvercin sürüleri döner, balon alanında süzülen balonlar.
 *
 * - **Ayrı katman, kuyruk yok:** kapasite kuyruğunda (`TAIL_CAP`) yalnız ≈ 2 katı blok boş (VEHICLE-DETAIL: araç ve taksi bölgeleri büyüdü); bu katman kuyruğa YAZMAZ. CityRig bu modülün
 * kutularını tek örneklenmiş diziye yazar (tek malzeme, gölgesiz) → görünür bir şey varken **+1 çizim çağrısı**, yokken +0
 * (dizi gizlenir). Bütçe: karede ≤ `LIVE_MAX` hareketli (sürü ve balon dahil), ≤ `LIVE_MAX_BOXES` kutu, ≤ `LIVE_MAX_FLOCKS` sürü.
 * - **Yakın/uzak ayrıntı (VEHICLE-DETAIL):** avatara `LIVE_NEAR`'dan yakın araç şehir livreli yakın ayrıntı düzeyinde (kapı, fener,
 * direk, can salı…), uzaktaki ince ayrıntısız siluetle çizilir; ikisinin sınır kutusu aynı (çakışma ve faz araması siluetle).
 * - **Hat aracı = binilen aracın yolu:** her bacak `travelPlan` (CITY-MAP-TRANSIT-001'in ölçtüğü yolun kendisi); gövde
 * `bodyArc` aralığında, durakta durak karosundan bir karo içeride bekler (biniş karosu boş kalır); yön 90°'ye yuvarlanır (CityRig
 * `writeVehicle` ile aynı kutular, uzun halat teli hariç). Gidiş + dönüş; hat başına tek araç.
 * - **Ortak tur ve faz:** şehrin bütün canlı araçları aynı ana periyotta (`roster.period`) döner; her hattın fazı, daha önce
 * yerleşen araçlarla hiçbir anda kesişmeyecek biçimde belirlenimci aranır (bulunamazsa hat katmana alınmaz, `dropped`).
 * - **Binilen araçla çakışmaz:** yolculuk sürerken o hattın canlı aracı gizlenir; başka bir canlı araç binilen aracın kutusuna
 * (+ pay) değecekse o karede çizilmez. Avatarın gövde kutusuna değen araç da çizilmez.
 * - **Akışa uyar:** araç ya da sürü yalnız yüklü parselin (ya da varış meydanının) üstünde çizilir; semt dışı açık suda (boğaz,
 * koy: zemin hiç çizilmez) avatara `LIVE_OPEN_RADIUS` içinde. Sürünün yüksekliği ilk kez yüklü parsellerinin bloklarından
 * hesaplanır (en yüksek blok + pay) — yapıya ve avatarın başına değmez.
 * - **Gece / hareket azaltma:** gece sürüler tünekte (çizilmez), süzülen balon ve balon hattı yalnız gündüz; araçların camı ve
 * farı gece yanar (renk çarpanı, ayrı malzeme yok). Hareket azaltmada saat t = 0'da durur (araçlar çakışmasız pozlarında
 * park eder), sürüler çizilmez.
 *
 * Logo, yazı, livre yok. Saf modül: React/three yok; belirlenimci (aynı harita → aynı kadro, aynı t → aynı kutular).
 * Denetim: `scripts/city_check.mjs` CITY-MAP-LIVE-001, birim testleri `scripts/city_live.test.mjs`.
*/
import { packCache } from "../citypacks/cityOverlay";
import type { Block } from "../scenes";
import { bodyArc, cityX, cityZ, lineRoute, poseAtArc, rideArc, travelPlan, vehicleBlocks, vehicleHalfLength, VEHICLES, type RidePose, type TravelPlan, type VehicleOpts } from "../transit/model";
import { CITY_PD, CITY_PW, districtAt, inGate, type CityDistrict, type CityMapFile, type CityTile, type VehicleKind } from "./format";
import { districtParcel, districtPlan, T_PARK, T_PLAZA, T_STREET, T_WATER } from "./district";
import { sacredZonesOf } from "./shell";
import { NEW_CITIES } from "../cities/index";

// ------------------------------------------------------------------------------------------ bütçe ve ayarlar
/** Karede en çok çizilen hareketli (araç + sürü + süzülen balon). */
export const LIVE_MAX = 12;
/** Karede en çok kutu (tek örneklenmiş dizinin kapasitesi). */
export const LIVE_MAX_BOXES = 400;
/** Karede en çok sürü. */
export const LIVE_MAX_FLOCKS = 3;
/** Hareketli başına en çok kutu. VEHICLE-DETAIL: 40 → 48 (yakın ayrıntı düzeyindeki vapur 44 kutu; karede toplam yine ≤ `LIVE_MAX_BOXES`). */
export const LIVE_SHAPE_MAX = 48;
/** VEHICLE-DETAIL: avatara bu uzaklıktan (birim) yakın canlı araç yakın ayrıntı düzeyinde (kapı, fener, direk…), uzaktaki siluetle çizilir. */
export const LIVE_NEAR = 14;
/** Avatara en çok uzaklık (karo; sis sonu 96). */
export const LIVE_RADIUS = 64;
/** Semt dışı açık su/hava (zemin çizilmez) için avatara uzaklık (karo, Chebyshev). */
export const LIVE_OPEN_RADIUS = 36;
/** Canlı katmanda dolaşan hat türleri (yerde ve yer altında gidenler sokakta avatarla karışmasın diye yok). */
export const LIVE_LINE_KINDS: readonly VehicleKind[] = ["vapur", "kayik", "teleferik", "monoray", "balon"];
/** Ortam hızı (karo/sn; binilen yolculuk kısa sahne olduğu için daha hızlıdır). */
const AMBIENT_SPEED: Readonly<Partial<Record<VehicleKind, number>>> = { vapur: 2.4, kayik: 1.2, teleferik: 1.6, monoray: 4.5, balon: 0.9 };
const DWELL_END = 6, DWELL_MID = 3, LEG_MIN = 4, EASE = 1.3;
/** Durakta bekleyen gövde durak karosundan bu kadar içeride (biniş karosu boş). */
const DOCK_GAP = 1;
/** Faz arama: ana periyodun bu kadar eşit payı denenir; örnek adımı (sn) ve çakışma payı (birim). */
const PHASE_STEPS = 24, SEP_DT = 0.5, SEP_PAD = 0.35;
/** Binilen araç ve avatar çevresindeki pay (birim). */
export const RIDE_PAD = 0.5;
const AVATAR_HALF = 0.4, AVATAR_TOP = 2.0;

/** Sürü: kuş sayısı, kuş başına kutu, yükseklik tabanı ve blokların üstündeki pay (ayakta duran avatarın başının üstü). */
export const FLOCK_BIRDS = 5;
const BIRD_BOXES = 3;
const BIRD_CLEAR = 2.2, BIRD_Y_MAX = 10;
const SPECIES = {
  gull: { body: "#F4F4F0", wing: "#B9C2CA", base: 4.5, period: 22 },
  pigeon: { body: "#8C93A0", wing: "#5F6672", base: 3.4, period: 14 },
} as const;
export type BirdSpecies = keyof typeof SPECIES;
const MAX_GULL_FLOCKS = 4, MAX_PIGEON_FLOCKS = 2;
/** Sürü merkezi her hat rotasından en az (yarıçap + bu) karo uzakta (araçlar ve binilen araçla dikeyde karşılaşmaz). */
const ROUTE_GAP = 3;
const SACRED_GAP = 3;

/** Süzülen balonlar (şehir başına tablo; ve sonrası genişletir). Yerel: semt kimliği, balon sayısı, yarıçap.*/
export const LIVE_DRIFT: Readonly<Record<string, { district: string; n: number; r: number }>> = {
  kapadokya: { district: "balon", n: 2, r: 7 },
  ...Object.fromEntries(NEW_CITIES.flatMap((m) => (m.drift ? [[m.catalog.id, m.drift] as const] : []))),
};
const DRIFT_SCALE = 1.5, DRIFT_PERIOD = 140, DRIFT_Y_MIN = 9, DRIFT_CLEAR = 2.5;
/** Süzülen balon (props/movers.ts `balloon` biçimiyle aynı oran; yerel, taban y = 0). */
const DRIFT_PARTS: readonly (readonly [number, number, number, number, number, number, number])[] = [
  // [x, y, z, w, h, d, renk dizini: 0 zarf, 1 şerit, 2 sepet, 3 halat, 4 alev]
  [0, 2.7, 0, 1.6, 1.4, 1.6, 0], [0, 2.7, 0, 1.9, 1.0, 1.9, 0], [0, 3.55, 0, 1.1, 0.4, 1.1, 0],
  [0, 1.95, 0, 1.0, 0.3, 1.0, 1], [0, 2.7, 0, 1.92, 0.3, 0.3, 1], [0, 2.7, 0, 0.3, 0.3, 1.92, 1],
  [0, 1.25, 0, 0.6, 0.45, 0.6, 2], [0.25, 1.62, 0.25, 0.04, 0.5, 0.04, 3], [-0.25, 1.62, -0.25, 0.04, 0.5, 0.04, 3],
  [0, 1.62, 0, 0.14, 0.14, 0.14, 4],
];
const DRIFT_COLORS: readonly (readonly string[])[] = [
  ["#E5584E", "#F2B33D", "#8B5A2B", "#5B4A3A", "#FDBA74"],
  ["#2F6D8C", "#F2C14E", "#8B5A2B", "#5B4A3A", "#FDBA74"],
  ["#7A9B58", "#F4EFE6", "#8B5A2B", "#5B4A3A", "#FDBA74"],
];

// ------------------------------------------------------------------------------------------ türler
/** Rol: gece parlayan far (`glow`), gece yanan pencere (`glass`), düz (`solid`). */
export type LiveRole = "solid" | "glass" | "glow";
/** Çizim alıcısı: dünya merkezi, boyut, y ekseni açısı (+x ileri; SceneFx ile aynı), renk, rol. */
export type LiveSink = (x: number, y: number, z: number, w: number, h: number, d: number, yaw: number, color: string, role: LiveRole) => void;

interface VehicleSeg { plan: TravelPlan; dur: number; dwell: boolean }
export interface LiveVehicle {
  kind: "vehicle"; id: string; line: string; vkind: VehicleKind; dayOnly: boolean;
  /** uzak ayrıntı düzeyi (siluet; çakışma ve faz araması bununla) · `near`: yakın ayrıntı düzeyi (aynı sınır kutusu) */
  local: Block[]; near: Block[];
  /** bu karede yakın ayrıntı düzeyinde mi (liveFrame avatar uzaklığından yazar; kutu sayısı `actorBoxes` buna göre) */
  lodNear: boolean;
  segs: VehicleSeg[]; cycle: number; phase: number;
}
export interface LiveFlock {
  kind: "flock"; id: string; species: BirdSpecies; district: string; c: [number, number]; r: number; dir: 1 | -1;
  /** yükseklik: ilk kez yüklü parsellerinden hesaplanır (null: henüz; NaN: uygun değil) */
  y: number | null;
  /** sürünün kare alanının parselleri (yükseklik için) */
  parcels: [number, number][];
}
export interface LiveDrift {
  kind: "drift"; id: string; district: string; c: [number, number]; r: number; n: number; y: number | null; parcels: [number, number][];
}
export type LiveActor = LiveVehicle | LiveFlock | LiveDrift;

export interface LiveRoster {
  map: string;
  /** ana periyot (sn): bütün araçların ortak turu */
  period: number;
  actors: LiveActor[];
  /** katmana alınamayan hatlar (çakışmasız faz yok) ve sürüler (yükseklik sınırı) */
  dropped: string[];
}

export interface LiveRide { line: string; kind: VehicleKind; x: number; z: number; y: number; heading: number }
export interface LiveCtx {
  /** saniye (hareket azaltmada `liveClock` durdurur) */
  t: number;
  /** avatar ayak konumu (dünya) */
  ax: number; az: number; ay?: number;
  /** avatarın yönü (rad; yem avatarın önüne düşer)*/
  ah?: number;
  night: boolean;
  reduced: boolean;
  /** parsel (cx, cz) yüklü mü (CityRig akışının yüklü kümesi) */
  loaded: (cx: number, cz: number) => boolean;
  /** sürmekte olan yolculuk (aracın gövde pozu) */
  ride?: LiveRide | null;
  /** ritüel çekmesi (`ritualFx.lure`; CityRig yalnız geçirir) ve şu an (performance.now ms; `until` ile aynı saat)*/
  lure?: LiveLure | null;
  now?: number;
}
/** şehir haritasında ritüel çekmesi: ritüel konumu (dünya), istenen türler ve bitiş (performance.now ms).*/
export interface LiveLure { x: number; z: number; kinds: readonly string[]; until: number }
export interface LiveDraw {
  actors: number; boxes: number; flocks: number;
  /** çizilen hareketlilerin kimlikleri (sıra: yakından uzağa) */
  ids: string[];
  /** bu karede gizlenen: binilen hat / binilen araca değen / avatara değen / akış dışı */
  hidden: { line: number; ride: number; avatar: number; stream: number };
  /** bu karede ritüele kayan sürü (yoksa yok)*/
  lured?: string;
  /** bu karede bir kuşu çağrılan martı sürüsü (yoksa yok)*/
  called?: string;
  /** bu karede yemlemeye inen yer güvercini sayısı (kutuları `boxes` içinde; yoksa yok)*/
  pecked?: number;
}

// ------------------------------------------------------------------------------------------ yardımcılar
/** Hareket azaltmada saat durur (t = 0: araçlar çakışmasız ortak pozda park eder). */
export const liveClock = (t: number, dt: number, reduced: boolean) => (reduced ? 0 : t + dt);

const mod = (a: number, n: number) => ((a % n) + n) % n;
const tileOf = (x: number, z: number): CityTile => [Math.floor(x + 12), Math.floor(z + 8)];

/** Canlı aracın yerel kutuları: binilen araçla aynı (vehicleBlocks; şehir livresi, ayrıntı düzeyi), uzun halat teli hariç (halat tasarımda çizili). */
export function liveVehicleLocal(kind: VehicleKind, opts: VehicleOpts = {}): Block[] {
  return vehicleBlocks(kind, opts).filter((b) => {
    const thin = (b.s[0] <= 0.07 ? 1 : 0) + (b.s[1] <= 0.07 ? 1 : 0) + (b.s[2] <= 0.07 ? 1 : 0);
    return !(thin >= 2 && Math.max(...b.s) > 1.5);
  });
}

/** Durak karosunda duran avatarın yatay yarı boyu + pay: durakta bekleyen gövde buna değmez (biniş karosu boş kalır). */
const STOP_CLEAR = AVATAR_HALF + 0.1;
const dockCache = new WeakMap<TravelPlan, [number, number]>();
/** Bacağın iki ucundaki bekleme yay uzunlukları: `bodyArc` aralığının içinde, en az `DOCK_GAP` içeride ve gövde (yön 90°'ye
 *  yuvarlanmış, çapraz rotada da) uç durak karosundaki avatar kutusuna değmeyecek kadar uzakta (0,25 adımla aranır). */
export function dockArcs(plan: TravelPlan): [number, number] {
  const hit = dockCache.get(plan);
  if (hit) return hit;
  const a = Math.max(0, vehicleHalfLength(plan.kind) - 0.5), L = plan.length, local = liveVehicleLocal(plan.kind);
  const clear = (s: number, end: readonly [number, number]) => {
    let ok = true;
    vehicleWorldBoxes(local, plan.kind, poseAtArc(plan, s), (x, _y, z, w, _h, d) => {
      if (Math.abs(x - end[0]) < w / 2 + STOP_CLEAR && Math.abs(z - end[1]) < d / 2 + STOP_CLEAR) ok = false;
    });
    return ok;
  };
  let lo = a + DOCK_GAP, hi = L - a - DOCK_GAP;
  while (lo <= L / 2 && !clear(lo, plan.path[0])) lo += 0.25;
  while (hi >= L / 2 && !clear(hi, plan.path[plan.path.length - 1])) hi -= 0.25;
  const out: [number, number] = lo > hi ? [bodyArc(plan, L / 2), bodyArc(plan, L / 2)] : [lo, hi];
  dockCache.set(plan, out);
  return out;
}

/** Gövde yay uzunluğu: `bodyArc` aralığının içinde, uçlarda `dockArcs` bekleme noktasında. */
export function liveArc(plan: TravelPlan, s: number): number {
  const [lo, hi] = dockArcs(plan);
  return Math.max(lo, Math.min(hi, s));
}

/** Aracın t (sn) anındaki gövde pozu (ana periyotta; faz dahil). */
export function vehiclePose(v: LiveVehicle, t: number, out: RidePose = { x: 0, z: 0, heading: 0, y: 0 }): RidePose {
  let u = mod(t + v.phase, v.cycle);
  for (let k = 0; k < v.segs.length; k++) {
    const sg = v.segs[k];
    if (u <= sg.dur || k === v.segs.length - 1) {
      const f = sg.dwell ? 1 : Math.max(0, Math.min(1, u / sg.dur));
      const p = poseAtArc(sg.plan, liveArc(sg.plan, rideArc(sg.plan, f)));
      out.x = p.x; out.z = p.z; out.heading = p.heading; out.y = p.y;
      return out;
    }
    u -= sg.dur;
  }
  return out;
}

/** Aracın dünya kutuları (CityRig `writeVehicle` ile aynı dönüşüm: yön 90°'ye yuvarlanır, kutular eksen hizalı). */
export function vehicleWorldBoxes(local: readonly Block[], kind: VehicleKind, pose: RidePose, emit: (x: number, y: number, z: number, w: number, h: number, d: number, b: Block) => void) {
  const side = Math.abs(Math.sin(pose.heading)) > 0.7, sz = Math.cos(pose.heading) >= 0 ? 1 : -1, sx = Math.sin(pose.heading) >= 0 ? 1 : -1;
  const dy = pose.y - VEHICLES[kind].rideY;
  for (const b of local) {
    const [lx, ly, lz] = b.p, [w, h, d] = b.s;
    if (side) emit(pose.x + lz * sx, ly + dy, pose.z + lx * sx, d, h, w, b);
    else emit(pose.x + lx * sz, ly + dy, pose.z + lz * sz, w, h, d, b);
  }
}

/** ritüele kayan sürünün bu karedeki kayması (merkez dx/dz, yükseklik `y`) ve tek kuşun dalış payı (yalnız martı).*/
export interface FlockShift { dx: number; dz: number; y: number; dive: number;
  /** çağrılan kuş (0. kuş) bu yerde; `only` → sürünün yalnız bu kuşu çizilir (sürü akış dışındayken)*/
  call?: { x: number; y: number; z: number; yaw: number } | null; only?: boolean }

/** Kuşun t anındaki konumu ve yönü (sürü merkezi çevresinde). */
function birdAt(f: LiveFlock, i: number, t: number, y0: number, out: { x: number; y: number; z: number; yaw: number }, sh?: FlockShift | null) {
  const per = SPECIES[f.species].period;
  const th = f.dir * 2 * Math.PI * (t / per + i * 0.07);
  const ri = f.r + (((i * 37) % 3) - 1) * 0.5;
  out.x = f.c[0] + (sh ? sh.dx : 0) + ri * Math.cos(th);
  out.z = f.c[1] + (sh ? sh.dz : 0) + ri * Math.sin(th);
  out.y = y0 + 0.35 * Math.sin(t * 0.9 + i * 1.7) + (i % 2) * 0.3;
  // teğet yön (+x ileri; yaw = atan2(−dz, dx))
  const dx = -Math.sin(th) * f.dir, dz = Math.cos(th) * f.dir;
  out.yaw = Math.atan2(-dz, dx);
}

/** Sürünün kutuları: kuş başına gövde + iki kanat (kanatlar kanat çırpar gibi yukarı/aşağı). `sh`: ritüele kayma.*/
export function flockBoxes(f: LiveFlock, t: number, sink: LiveSink, sh?: FlockShift | null) {
  if (f.y === null || Number.isNaN(f.y)) return;
  const sp = SPECIES[f.species], o = { x: 0, y: 0, z: 0, yaw: 0 };
  for (let i = 0; i < FLOCK_BIRDS; i++) {
    if (sh?.only && i > 0) break;
    birdAt(f, i, t, sh ? sh.y : f.y, o, sh);
    if (sh && i === 0) o.y -= sh.dive;
    if (sh?.call && i === 0) { o.x = sh.call.x; o.y = sh.call.y; o.z = sh.call.z; o.yaw = sh.call.yaw; }
    const cs = Math.cos(o.yaw), sn = Math.sin(o.yaw), flap = 0.06 * Math.sin(t * 9 + i * 2.1);
    sink(o.x, o.y, o.z, 0.36, 0.1, 0.12, o.yaw, sp.body, "solid");
    // kanat: yerel z ±0,2 (yan) → dünya (yaw döndürmesi: yerel (lx, lz) → (cs·lx + sn·lz, −sn·lx + cs·lz))
    for (const side of [1, -1]) sink(o.x + sn * 0.2 * side, o.y + 0.03 + flap * side, o.z + cs * 0.2 * side, 0.14, 0.03, 0.28, o.yaw, sp.wing, "solid");
  }
}

/** Süzülen balonların kutuları (yön yok; yavaş daire + hafif iniş çıkış). */
export function driftBoxes(dr: LiveDrift, t: number, sink: LiveSink) {
  if (dr.y === null || Number.isNaN(dr.y)) return;
  for (let k = 0; k < dr.n; k++) {
    const th = 2 * Math.PI * (t / DRIFT_PERIOD + k / dr.n);
    const x = dr.c[0] + dr.r * Math.cos(th), z = dr.c[1] + dr.r * Math.sin(th);
    const y = dr.y + 0.3 * Math.sin(t * 0.35 + k * 2.4);
    const pal = DRIFT_COLORS[k % DRIFT_COLORS.length];
    for (const [px, py, pz, w, h, d, ci] of DRIFT_PARTS) {
      sink(x + px * DRIFT_SCALE, y + py * DRIFT_SCALE, z + pz * DRIFT_SCALE, w * DRIFT_SCALE, h * DRIFT_SCALE, d * DRIFT_SCALE, 0, pal[ci], ci === 4 ? "glow" : "solid");
    }
  }
}

/** Hareketlinin kutu sayısı. */
export function actorBoxes(a: LiveActor): number {
  return a.kind === "vehicle" ? (a.lodNear ? a.near : a.local).length : a.kind === "flock" ? FLOCK_BIRDS * BIRD_BOXES : a.n * DRIFT_PARTS.length;
}
/** Hareketlinin en çok kutusu (ayrıntı düzeyinden bağımsız; dizi kapasitesi için). */
export function actorMaxBoxes(a: LiveActor): number {
  return a.kind === "vehicle" ? Math.max(a.near.length, a.local.length) : actorBoxes(a);
}

/** Hareketlinin t anındaki bütün kutuları (dünya; yön `yaw`). */
export function actorEmit(a: LiveActor, t: number, sink: LiveSink, pose: RidePose = { x: 0, z: 0, heading: 0, y: 0 }, sh?: FlockShift | null) {
  if (a.kind === "vehicle") {
    vehiclePose(a, t, pose);
    vehicleWorldBoxes(a.lodNear ? a.near : a.local, a.vkind, pose, (x, y, z, w, h, d, b) => sink(x, y, z, w, h, d, 0, b.c, b.g === "glow" ? "glow" : b.g === "glass" ? "glass" : "solid"));
  } else if (a.kind === "flock") flockBoxes(a, t, sink, sh);
  else driftBoxes(a, t, sink);
}

// ------------------------------------------------------------------------------------------ kadro
/** Nokta (şehir karosu) ile çoklu çizgi arasındaki en kısa uzaklık. */
function distToRoute(p: [number, number], route: readonly CityTile[]): number {
  let best = Infinity;
  for (let k = 0; k + 1 < route.length; k++) {
    const a = route[k], b = route[k + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
    const u = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - dx * u, p[1] - a[1] - dz * u));
  }
  return best;
}

/** Semt içi Chebyshev uzaklık dönüşümü: `open` karodan en yakın kapalı karoya (semt dışı kapalı sayılır). */
function openDistance(w: number, d: number, open: (k: number) => boolean): Int16Array {
  const INF = 9999, out = new Int16Array(w * d);
  for (let k = 0; k < w * d; k++) out[k] = open(k) ? INF : 0;
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= d ? 0 : out[j * w + i]);
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    if (out[k]) out[k] = Math.min(out[k], at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + 1, at(i + 1, j - 1) + 1);
  }
  for (let j = d - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
    const k = j * w + i;
    if (out[k]) out[k] = Math.min(out[k], at(i + 1, j) + 1, at(i, j + 1) + 1, at(i + 1, j + 1) + 1, at(i - 1, j + 1) + 1);
  }
  return out;
}

/** Kare alanın (dünya merkezi, yarı kenar) kesiştiği parseller (yalnız semt içindekiler). */
function squareParcels(map: CityMapFile, x: number, z: number, half: number): [number, number][] {
  const out: [number, number][] = [];
  const I0 = Math.floor(x - half + 12), I1 = Math.floor(x + half + 12), J0 = Math.floor(z - half + 8), J1 = Math.floor(z + half + 8);
  for (let cz = Math.floor(J0 / CITY_PD); cz <= Math.floor(J1 / CITY_PD); cz++) for (let cx = Math.floor(I0 / CITY_PW); cx <= Math.floor(I1 / CITY_PW); cx++) {
    if (districtAt(map, cx * CITY_PW, cz * CITY_PD)) out.push([cx, cz]);
  }
  return out;
}

/** Kare alanın üstündeki en yüksek blok tepesi (su hariç; yakın ayrıntı) — sürü/balon yüksekliği için. */
export function squareTop(map: CityMapFile, x: number, z: number, half: number): number {
  let top = 0;
  for (const [cx, cz] of squareParcels(map, x, z, half)) {
    const dist = districtAt(map, cx * CITY_PW, cz * CITY_PD);
    const p = dist ? districtParcel(map, dist, cx, cz) : null;
    if (!p) continue;
    for (const b of p.near.blocks) {
      if (b.g === "water") continue;
      if (Math.abs(b.p[0] - x) > half + b.s[0] / 2 || Math.abs(b.p[2] - z) > half + b.s[2] / 2) continue;
      top = Math.max(top, b.p[1] + b.s[1] / 2);
    }
  }
  return top;
}
const FLOCK_HALF = (r: number) => r + 1.5;
/** Sürü çapası ararken en çok bu kadar aday yükseklikten elenir (kadro kurulumu ucuz kalsın). */
const FIT_TRIES = 60;

/** Sürü ve balon çapaları: hat rotalarından ve kutsal bölgelerden uzak, açık alanın ortası. */
function anchors(map: CityMapFile): LiveActor[] {
  const routes = map.lines.map((l) => lineRoute(map, l));
  const sacred = sacredZonesOf(map) ?? [];
  const nearSacred = (I: number, J: number) => sacred.some((z) => I >= z.i0 - SACRED_GAP - (z.buffer ?? 0) && I < z.i0 + z.w + SACRED_GAP + (z.buffer ?? 0)
    && J >= z.j0 - SACRED_GAP - (z.buffer ?? 0) && J < z.j0 + z.d + SACRED_GAP + (z.buffer ?? 0));
  const farFromRoutes = (I: number, J: number, gap: number) => routes.every((r) => distToRoute([I, J], r) >= gap);
  const out: LiveActor[] = [];
  let gulls = 0, pigeons = 0;
  const pick = (dist: CityDistrict, open: (kind: number) => boolean, rMax: number, rMin: number,
    fits?: (c: [number, number], r: number) => boolean): { c: [number, number]; r: number } | null => {
    const plan = districtPlan(map, dist);
    const dt = openDistance(plan.w, plan.d, (k) => open(plan.kind[k]));
    const cand: number[] = [];
    for (let k = 0; k < dt.length; k++) if (dt[k] - 1.5 >= rMin) cand.push(k);
    cand.sort((a, b) => dt[b] - dt[a] || a - b);
    for (const k of cand) {
      const li = k % plan.w, lj = Math.floor(k / plan.w), I = plan.i0 + li, J = plan.j0 + lj;
      const r = Math.min(rMax, dt[k] - 1.5);
      if (nearSacred(I, J) || !farFromRoutes(I, J, r + ROUTE_GAP)) continue;
      const c: [number, number] = [cityX(I), cityZ(J)];
      // sürü yüksekliği sınırı aşacaksa (uzun yapının üstü; `resolveHeight` NaN → hiç çizilmez) sonraki açık alan
      if (fits && !fits(c, r)) { if (++tried >= FIT_TRIES) return null; continue; }
      return { c, r };
    }
    return null;
  };
  let tried = 0;
  /** sürü çapası çizilebilir yükseklikte mi (`resolveHeight` ile aynı kural: blok tepesi + pay ≤ `BIRD_Y_MAX`) */
  const flockFits = (c: [number, number], r: number) => squareTop(map, c[0], c[1], FLOCK_HALF(r)) + BIRD_CLEAR <= BIRD_Y_MAX;
  for (const dist of map.districts) {
    const plan = districtPlan(map, dist);
    let water = 0;
    for (const k of plan.kind) if (k === T_WATER) water++;
    let species: BirdSpecies | null = null;
    if (water >= 150 && gulls < MAX_GULL_FLOCKS) species = "gull";
    else if (!water && (dist.theme === "historic" || dist.theme === "bazaar" || dist.theme === "garden") && pigeons < MAX_PIGEON_FLOCKS) species = "pigeon";
    if (!species) continue;
    tried = 0;
    const a = species === "gull" ? pick(dist, (k) => k === T_WATER, 4, 2, flockFits) : pick(dist, (k) => k === T_PLAZA || k === T_STREET || k === T_PARK, 3, 1.5, flockFits);
    if (!a) continue;
    if (species === "gull") gulls++; else pigeons++;
    out.push({ kind: "flock", id: `flock:${dist.id}`, species, district: dist.id, c: a.c, r: a.r, dir: out.length % 2 ? -1 : 1, y: null,
      parcels: squareParcels(map, a.c[0], a.c[1], FLOCK_HALF(a.r)) });
  }
  const dd = LIVE_DRIFT[map.id];
  const dist = dd ? map.districts.find((d) => d.id === dd.district) : undefined;
  if (dd && dist) {
    const a = pick(dist, (k) => k === T_PLAZA || k === T_PARK || k === T_STREET, dd.r, 2);
    // açık alan küçükse semt merkezine (yükseklik yine bloklardan); rota uzaklığı denetimi yine geçerli
    const c: [number, number] = a ? a.c : [cityX(dist.bounds[0] + dist.bounds[2] / 2), cityZ(dist.bounds[1] + dist.bounds[3] / 2)];
    const ok = a || farFromRoutes(Math.floor(c[0] + 12), Math.floor(c[1] + 8), dd.r + ROUTE_GAP + 2);
    if (ok) out.push({ kind: "drift", id: `drift:${dist.id}`, district: dist.id, c, r: dd.r, n: dd.n, y: null,
      parcels: squareParcels(map, c[0], c[1], dd.r + 2) });
  }
  return out;
}

/** Sürü/balon yüksekliğini çöz (parselleri yüklüyse; sonuç kalıcı). Dönüş: çizilebilir mi. */
export function resolveHeight(map: CityMapFile, a: LiveFlock | LiveDrift, loaded: (cx: number, cz: number) => boolean): boolean {
  if (a.y !== null) return !Number.isNaN(a.y);
  if (!a.parcels.every(([cx, cz]) => loaded(cx, cz))) return false;
  if (a.kind === "flock") {
    const top = squareTop(map, a.c[0], a.c[1], FLOCK_HALF(a.r));
    const y = Math.max(SPECIES[a.species].base, top + BIRD_CLEAR);
    a.y = y <= BIRD_Y_MAX ? +y.toFixed(3) : NaN;
  } else {
    const top = squareTop(map, a.c[0], a.c[1], a.r + 2);
    a.y = +Math.max(DRIFT_Y_MIN, top + DRIFT_CLEAR).toFixed(3);
  }
  return !Number.isNaN(a.y);
}

/** Hat aracının bacakları: gidiş + dönüş (`travelPlan`), duraklarda bekleme. */
function vehicleSegs(map: CityMapFile, lineId: string, stops: readonly string[], kind: VehicleKind): VehicleSeg[] | null {
  const segs: VehicleSeg[] = [];
  const speed = AMBIENT_SPEED[kind] ?? 2;
  const order = [...stops, ...stops.slice(0, -1).reverse()];
  for (let k = 0; k + 1 < order.length; k++) {
    const plan = travelPlan(map, lineId, order[k], order[k + 1]);
    if (!plan) return null;
    segs.push({ plan, dur: +Math.max(LEG_MIN, (plan.length / speed) * EASE).toFixed(3), dwell: false });
    const end = k + 2 === order.length || order[k + 1] === stops[stops.length - 1];
    segs.push({ plan, dur: end ? DWELL_END : DWELL_MID, dwell: true });
  }
  return segs;
}

/** İki aracın t anında (pay ile) kesişip kesişmediği — yalnız merkezler yakınsa kutu kutu. */
function vehiclesMeet(a: LiveVehicle, b: LiveVehicle, t: number, pa: RidePose, pb: RidePose): boolean {
  vehiclePose(a, t, pa); vehiclePose(b, t, pb);
  if (Math.hypot(pa.x - pb.x, pa.z - pb.z) > 7) return false;
  const boxes: number[][] = [];
  vehicleWorldBoxes(a.local, a.vkind, pa, (x, y, z, w, h, d) => boxes.push([x, y, z, w, h, d]));
  let hit = false;
  vehicleWorldBoxes(b.local, b.vkind, pb, (x, y, z, w, h, d) => {
    if (hit) return;
    for (const q of boxes) if (Math.abs(q[0] - x) < (q[3] + w) / 2 + SEP_PAD && Math.abs(q[1] - y) < (q[4] + h) / 2 + SEP_PAD && Math.abs(q[2] - z) < (q[5] + d) / 2 + SEP_PAD) { hit = true; return; }
  });
  return hit;
}

const rosterCache = packCache(() => new WeakMap<CityMapFile, LiveRoster>());
/** Denetim için: haritanın kadrosunu önbellekten düşür (yükseklikler yeniden çözülür). */
export function clearLiveCache(map: CityMapFile) { rosterCache().delete(map); }

/** Şehrin canlı kadrosu (önbellekli; aynı harita nesnesi → aynı kadro). */
export function liveRoster(map: CityMapFile): LiveRoster {
  const hit = rosterCache().get(map);
  if (hit) return hit;
  const dropped: string[] = [];
  const vehicles: LiveVehicle[] = [];
  for (const l of map.lines) {
    if (!LIVE_LINE_KINDS.includes(l.kind)) continue;
    const segs = vehicleSegs(map, l.id, l.stops, l.kind);
    if (!segs) { dropped.push(`line:${l.id}`); continue; }
    const local = liveVehicleLocal(l.kind, { city: map.id, line: l.id, lod: "far" }), near = liveVehicleLocal(l.kind, { city: map.id, line: l.id });
    if (near.length > LIVE_SHAPE_MAX || local.length > LIVE_SHAPE_MAX) { dropped.push(`line:${l.id}`); continue; }
    vehicles.push({ kind: "vehicle", id: `line:${l.id}`, line: l.id, vkind: l.kind, dayOnly: l.kind === "balon", local, near, lodNear: false, segs,
      cycle: segs.reduce((s, x) => s + x.dur, 0), phase: 0 });
  }
  // ana periyot: en uzun tur (10 sn'ye yuvarlanır); kısa turlar periyoda tam sayı kez sığar, artan süre uç duraklarda bekleme
  const period = Math.max(60, Math.ceil(Math.max(0, ...vehicles.map((v) => v.cycle)) / 10) * 10);
  for (const v of vehicles) {
    const reps = Math.max(1, Math.floor(period / v.cycle));
    const extra = period / reps - v.cycle;
    const ends = v.segs.filter((s, k) => s.dwell && (k === v.segs.length - 1 || s.dur === DWELL_END));
    for (const s of ends) s.dur += extra / ends.length;
    v.cycle = period / reps;
  }
  // faz: önce yerleşenlerle hiçbir anda kesişmeyen ilk pay
  const placed: LiveVehicle[] = [];
  const pa: RidePose = { x: 0, z: 0, heading: 0, y: 0 }, pb: RidePose = { x: 0, z: 0, heading: 0, y: 0 };
  for (const v of vehicles) {
    let ok = false;
    for (let q = 0; q < PHASE_STEPS && !ok; q++) {
      v.phase = +((q * v.cycle) / PHASE_STEPS).toFixed(3);
      ok = true;
      for (const o of placed) {
        for (let t = 0; t < period && ok; t += SEP_DT) if (vehiclesMeet(v, o, t, pa, pb)) ok = false;
        if (!ok) break;
      }
    }
    if (ok) placed.push(v); else dropped.push(v.id);
  }
  const roster: LiveRoster = { map: map.id, period, actors: [...placed, ...anchors(map)], dropped };
  rosterCache().set(map, roster);
  return roster;
}

// ------------------------------------------------------------------------------------------ ritüel çekmesi
/** Ritüel konumu sürünün `r + LURE_REACH` karosu içindeyse o sürü konuma kayar.*/
export const LURE_REACH = 4;
/** En çok merkez kayması (karo) ve yükseklik değişimi (birim). */
export const LURE_SHIFT_MAX = 3;
export const LURE_DROP_MAX = 2;
/** Giriş/çıkış yumuşatması (ms) ve avatar başının üstünde bırakılan pay (birim). */
const LURE_RAMP_MS = 1200, DIVE_ROOM = 0.9;
/** Kuşun en alt noktası sürü yüksekliğinin bu kadar altında (salınım 0,35 + kutu/kanat payı). */
const BIRD_DIP = 0.45;
/** Yer/su araçlarının tepesinden kuşa en az pay (birim). */
const VEHICLE_CLEAR = 0.4;
interface ShiftPlan { dx: number; dz: number; yLow: number; diveMin: number }
const lureSeen = new WeakMap<LiveLure, number>();
const shiftCache = new WeakMap<LiveLure, Map<string, ShiftPlan | null>>();
interface Place { routes: { route: CityTile[]; kind: VehicleKind; top: number; high: boolean }[]; sacred: NonNullable<ReturnType<typeof sacredZonesOf>> }
const placeCache = new WeakMap<CityMapFile, Place>();
function placeOf(map: CityMapFile): Place {
  let p = placeCache.get(map);
  if (!p) {
    p = {
      routes: map.lines.map((l) => {
        // yükseltilmiş hatlar (teleferik, monoray, balon): sürü rotadan yatayda uzak kalır; yer/su araçları: tepesinin üstünde
        const high = VEHICLES[l.kind].rideY >= 1;
        const top = high ? Infinity : Math.max(0, ...vehicleBlocks(l.kind, { city: map.id, line: l.id }).map((b) => b.p[1] + b.s[1] / 2));
        return { route: lineRoute(map, l), kind: l.kind, top, high };
      }),
      sacred: sacredZonesOf(map) ?? [],
    };
    placeCache.set(map, p);
  }
  return p;
}
/** Kayan sürü merkezi (karo) için gereken en düşük yükseklik; yer yasaksa (kutsal tampon, yükseltilmiş hat) Infinity. */
function placeFloor(map: CityMapFile, x: number, z: number, r: number): number {
  const I = Math.floor(x + 12), J = Math.floor(z + 8), { routes, sacred } = placeOf(map);
  if (sacred.some((q) => I >= q.i0 - SACRED_GAP - (q.buffer ?? 0) && I < q.i0 + q.w + SACRED_GAP + (q.buffer ?? 0)
    && J >= q.j0 - SACRED_GAP - (q.buffer ?? 0) && J < q.j0 + q.d + SACRED_GAP + (q.buffer ?? 0))) return Infinity;
  let floor = 0;
  for (const q of routes) {
    if (distToRoute([I, J], q.route) >= r + ROUTE_GAP) continue;
    if (q.high) return Infinity;
    floor = Math.max(floor, q.top + VEHICLE_CLEAR + BIRD_DIP);
  }
  return floor;
}

/**
 * Sürünün ritüele kayma planı (önbellekli; parseller yüklü değilse undefined → sonraki karede yeniden denenir). Kurallar:
 * merkez en çok `LURE_SHIFT_MAX` karo konuma doğru, yükseklik en çok `LURE_DROP_MAX` aşağı; kayma yolu boyunca kutsal tampon ve
 * yükseltilmiş hat yok, yer/su araçlarının tepesinin üstünde; `resolveHeight` kuralı (yol üstündeki blokların tepesi +
 * `BIRD_CLEAR`) korunur ve sürü başlangıç yüksekliğinin üstüne çıkmaz (sıçrama yok). Uymazsa kayma kısalır; hiç uymazsa null.
 */
export function flockLureShift(map: CityMapFile, f: LiveFlock, lure: LiveLure, loaded: (cx: number, cz: number) => boolean): ShiftPlan | null | undefined {
  if (!lure.kinds.includes(f.species) || f.y === null || Number.isNaN(f.y)) return null;
  let per = shiftCache.get(lure);
  const hit = per?.get(f.id);
  if (hit !== undefined) return hit;
  const ux = lure.x - f.c[0], uz = lure.z - f.c[1], dist = Math.hypot(ux, uz);
  let out: ShiftPlan | null = null;
  if (dist <= f.r + LURE_REACH) {
    const y0 = f.y;
    for (let s = Math.min(LURE_SHIFT_MAX, dist); s >= 0.5 && !out; s -= 0.5) {
      const dx = dist ? (ux / dist) * s : 0, dz = dist ? (uz / dist) * s : 0;
      const mx = f.c[0] + dx / 2, mz = f.c[1] + dz / 2, half = FLOCK_HALF(f.r) + Math.max(Math.abs(dx), Math.abs(dz)) / 2;
      const parcels = squareParcels(map, mx, mz, half);
      if (!parcels.every(([cx, cz]) => loaded(cx, cz))) return undefined;
      const blocks = squareTop(map, mx, mz, half) + BIRD_CLEAR;
      let veh = 0;
      for (let q = 0; q <= 1.0001 && Number.isFinite(veh); q += 0.25) veh = Math.max(veh, placeFloor(map, f.c[0] + dx * q, f.c[1] + dz * q, f.r));
      const floor = Math.max(blocks, veh);
      if (!(floor <= y0)) continue;
      out = { dx, dz, yLow: Math.max(y0 - LURE_DROP_MAX, floor), diveMin: Math.max(blocks - BIRD_CLEAR + 1.2, veh) };
    }
  }
  if (!per) shiftCache.set(lure, (per = new Map()));
  per.set(f.id, out);
  return out;
}

/** Çekme zarfı 0–1: isteğin ilk görüldüğü andan yumuşak giriş, `until`'e doğru yumuşak çıkış. */
export function lureEnvelope(lure: LiveLure, now: number): number {
  let t0 = lureSeen.get(lure);
  if (t0 === undefined) lureSeen.set(lure, (t0 = now));
  const k = Math.max(0, Math.min(1, (now - t0) / LURE_RAMP_MS, (lure.until - now) / LURE_RAMP_MS));
  return k * k * (3 - 2 * k);
}

/** Canlı denetim ve testler için son karenin çekme durumu (kopya değil; okuyun, yazmayın). */
export const liveLureInfo: { id: string | null; k: number; dx: number; dz: number; y: number; dive: number } = { id: null, k: 0, dx: 0, dz: 0, y: 0, dive: 0 };

/** Bu karede sürünün kayması (yoksa null). Avatarın başına değmez; dalış yalnız martı sürüsünde tek kuşta. */
function frameShift(map: CityMapFile, f: LiveFlock, ctx: LiveCtx, out: FlockShift): FlockShift | null {
  const lure = ctx.lure;
  if (!lure || ctx.reduced || ctx.night || f.y === null || Number.isNaN(f.y)) return null;
  // martıda sürü kayması yerine tek kuş çağrısı (`planGullCall`)
  if (f.species === "gull") return null;
  const now = ctx.now ?? 0;
  if (now >= lure.until) return null;
  const plan = flockLureShift(map, f, lure, ctx.loaded);
  if (!plan) return null;
  const k = lureEnvelope(lure, now);
  if (k <= 0) return null;
  const yHead = (ctx.ay ?? 0) + AVATAR_TOP + BIRD_DIP + 0.1;
  out.dx = plan.dx * k; out.dz = plan.dz * k;
  // sürü avatarın başının üstünde, dalan kuşa da yer kalacak kadar yüksekte kalır
  out.y = Math.max(f.y - (f.y - plan.yLow) * k, Math.min(f.y, yHead + DIVE_ROOM));
  // martı dalışı yerine tek kuş çağrısı (planGullCall); güvercin sürüsü dalmaz
  out.dive = 0;
  return out;
}

// ------------------------------------------------------------------------------------------ martı çağrısı
/** Martı ritüeli en yakın martı sürüsünden (merkezi ≤ `CALL_REACH` karo) TEK kuşu çağırır: kuş tırmanır, güvenli yükseklikte
 * uçar, kapma noktasına dikine iner, parçayı kapar, yine dikine çıkıp sürüsüne döner. Aynı kuş (sürünün 0. kuşu), yeni hareketli
 * yok; bütçe ve çarpışma denetimleri aynen. Diğer türler haritada yalnız metin ve sestir ( sürü kayması güvercinde kalır).*/
export const CALL_REACH = 60;
/** Uçuş hızı (karo/sn; uzun yolda en çok ≈ 2,2 sn'de varır), dikine hız (birim/sn), kapma ve dikine evre süreleri (ms). */
const CALL_SPEED = 16, CALL_CLIMB = 5, CALL_HOVER_MS = 900;
/** Kapma noktası: ritüel konumundan sürüye doğru bu kadar (avatar kutusuna değmez) ve avatarın ayağından bu kadar yukarıda. */
const CALL_AHEAD = 1.6, CALL_Y = 1.3;
/** Yol örnekleme adımı (karo) ve yükseltilmiş hatta en az yatay uzaklık (karo). */
const CALL_STEP = 1.5, CALL_HIGH_GAP = 2;
interface CallPlan {
  lure: LiveLure; flock: LiveFlock; fy: number; t0: number;
  sx: number; sz: number; cx: number; cy: number; cz: number; cruise: number;
  /** evre sınırları (t0'dan ms): tırmanış, uçuş, iniş, kapma, çıkış; dönüş uçuşu ve son iniş dinamik */
  tClimb: number; tOut: number; tDown: number; tHover: number; tUp: number; tBack: number; tLand: number;
}
let call: CallPlan | null = null;
const callTried = new WeakMap<LiveLure, true>();
/** Testler: süren çağrıyı bırakır. */
export function resetLiveCall(): void { call = null; liveCall.id = null; liveCall.phase = ""; }
/** Denetim ve testler: süren çağrı (yoksa null). */
export const liveCall: { id: string | null; phase: string; x: number; y: number; z: number } = { id: null, phase: "", x: 0, y: 0, z: 0 };

/** Sürünün yüksekliği (çözülmemişse aynı kuralla hesaplanır; kadro önbelleğine yazılmaz). */
function flockY(map: CityMapFile, f: LiveFlock): number {
  if (f.y !== null) return f.y;
  const y = Math.max(SPECIES[f.species].base, squareTop(map, f.c[0], f.c[1], FLOCK_HALF(f.r)) + BIRD_CLEAR);
  return y <= BIRD_Y_MAX ? y : NaN;
}

/** Çağrı planı: en yakın martı sürüsü (≤ CALL_REACH), güvenli seyir yüksekliği (yol boyunca blok tepesi + pay; yükseltilmiş hatta
 *  yaklaşmaz), kapma sütunu açık. Uymazsa null. */
export function planGullCall(map: CityMapFile, roster: LiveRoster, lure: LiveLure, now: number, t: number, av?: { x: number; z: number; y?: number }): CallPlan | null {
  const ay = av?.y ?? 0;
  if (!lure.kinds.includes("gull")) return null;
  let f: LiveFlock | null = null, fd = Infinity;
  for (const a of roster.actors) {
    if (a.kind !== "flock" || a.species !== "gull") continue;
    const d = Math.hypot(a.c[0] - lure.x, a.c[1] - lure.z);
    if (d <= CALL_REACH && d < fd) { fd = d; f = a; }
  }
  if (!f) return null;
  const fy = flockY(map, f);
  if (!Number.isFinite(fy)) return null;
  const o = { x: 0, y: 0, z: 0, yaw: 0 };
  birdAt(f, 0, t, fy, o);
  // kapma noktası: avatardan (konuma yakınsa; değilse konumdan) sürüye doğru CALL_AHEAD (rıhtımda suyun üstü)
  const bx = av && Math.hypot(av.x - lure.x, av.z - lure.z) <= 3 ? av.x : lure.x, bz = av && Math.hypot(av.x - lure.x, av.z - lure.z) <= 3 ? av.z : lure.z;
  const ux = f.c[0] - bx, uz = f.c[1] - bz, ud = Math.hypot(ux, uz) || 1;
  const cx = bx + (ux / ud) * CALL_AHEAD, cz = bz + (uz / ud) * CALL_AHEAD;
  const colTop = squareTop(map, cx, cz, 0.6);
  const cy = Math.max(ay + CALL_Y, colTop + 0.6);
  // seyir: yol boyunca (iki uç dahil) blok tepesi + BIRD_CLEAR, sürü yüksekliğinden aşağı değil
  const { routes } = placeOf(map);
  const len = Math.hypot(cx - o.x, cz - o.z), n = Math.max(1, Math.ceil(len / CALL_STEP));
  let top = 0;
  for (let k = 0; k <= n; k++) {
    const x = o.x + ((cx - o.x) * k) / n, z = o.z + ((cz - o.z) * k) / n;
    top = Math.max(top, squareTop(map, x, z, 0.8));
    const I = Math.floor(x + 12), J = Math.floor(z + 8);
    if (routes.some((q) => q.high && distToRoute([I, J], q.route) < CALL_HIGH_GAP)) return null;
  }
  const cruise = Math.max(fy, top + BIRD_CLEAR, cy + 0.5);
  if (cruise > BIRD_Y_MAX + 4) return null;
  const v = Math.max(CALL_SPEED, len / 2.2);
  const tClimb = ((cruise - fy) / CALL_CLIMB) * 1000, tOut = tClimb + (len / v) * 1000;
  const tDown = tOut + ((cruise - cy) / CALL_CLIMB) * 1000, tHover = tDown + CALL_HOVER_MS, tUp = tHover + ((cruise - cy) / CALL_CLIMB) * 1000;
  const tBack = tUp + (len / v) * 1000, tLand = tBack + tClimb;
  return { lure, flock: f, fy, t0: now, sx: o.x, sz: o.z, cx, cy, cz, cruise, tClimb, tOut, tDown, tHover, tUp, tBack, tLand };
}

/** Çağrılan kuşun bu karedeki yeri (yoksa null; dönüş bitince çağrı silinir). Dönüşte hedef kuşun güncel halka yeri. */
function callPose(c: CallPlan, now: number, t: number, out: { x: number; y: number; z: number; yaw: number }): string | null {
  const e = now - c.t0;
  if (e < 0) return null; // saat geri gitti (yeni oturum/test): çağrı biter
  const home = { x: 0, y: 0, z: 0, yaw: 0 };
  birdAt(c.flock, 0, t, c.fy, home);
  const lerp = (a: number, b: number, u: number) => a + (b - a) * Math.max(0, Math.min(1, u));
  const face = (dx: number, dz: number) => { if (Math.hypot(dx, dz) > 1e-6) out.yaw = Math.atan2(-dz, dx); };
  if (e < c.tClimb) { out.x = c.sx; out.z = c.sz; out.y = lerp(c.fy, c.cruise, e / c.tClimb); out.yaw = home.yaw; return "climb"; }
  if (e < c.tOut) { const u = (e - c.tClimb) / (c.tOut - c.tClimb); out.x = lerp(c.sx, c.cx, u); out.z = lerp(c.sz, c.cz, u); out.y = c.cruise; face(c.cx - c.sx, c.cz - c.sz); return "out"; }
  if (e < c.tDown) { out.x = c.cx; out.z = c.cz; out.y = lerp(c.cruise, c.cy, (e - c.tOut) / (c.tDown - c.tOut)); return "down"; }
  if (e < c.tHover) { out.x = c.cx; out.z = c.cz; out.y = c.cy + 0.05 * Math.sin(e / 90); return "catch"; }
  if (e < c.tUp) { out.x = c.cx; out.z = c.cz; out.y = lerp(c.cy, c.cruise, (e - c.tHover) / (c.tUp - c.tHover)); return "up"; }
  if (e < c.tBack) { const u = (e - c.tUp) / (c.tBack - c.tUp); out.x = lerp(c.cx, home.x, u); out.z = lerp(c.cz, home.z, u); out.y = c.cruise; face(home.x - c.cx, home.z - c.cz); return "back"; }
  if (e < c.tLand) { out.x = home.x; out.z = home.z; out.y = lerp(c.cruise, home.y, (e - c.tBack) / Math.max(1, c.tLand - c.tBack)); out.yaw = home.yaw; return "land"; }
  return null;
}

// ------------------------------------------------------------------------------------------ kare
/** Hareketlinin akış konumu (araç gövdesi, sürü/balon merkezi) — görünürlük ve uzaklık için. */
function actorCenter(a: LiveActor, t: number, pose: RidePose): [number, number] {
  if (a.kind === "vehicle") { vehiclePose(a, t, pose); return [pose.x, pose.z]; }
  return a.c;
}

/** Konum akışta çizilebilir mi: varış meydanı, yüklü parsel ya da (semt dışı açık alan) avatara yakın. */
export function streamVisible(map: CityMapFile, x: number, z: number, ax: number, az: number, loaded: (cx: number, cz: number) => boolean): boolean {
  const [I, J] = tileOf(x, z);
  if (inGate(I, J)) return true;
  if (districtAt(map, I, J)) return loaded(Math.floor(I / CITY_PW), Math.floor(J / CITY_PD));
  return Math.max(Math.abs(x - ax), Math.abs(z - az)) <= LIVE_OPEN_RADIUS;
}

/** Binilen aracın dünya kutusu (AABB; pay dahil). */
export function rideBox(ride: LiveRide): [number, number, number, number, number, number] {
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] as [number, number, number, number, number, number];
  vehicleWorldBoxes(vehicleBlocks(ride.kind), ride.kind, { x: ride.x, z: ride.z, y: ride.y, heading: ride.heading }, (x, y, z, w, h, d) => {
    box[0] = Math.min(box[0], x - w / 2); box[1] = Math.min(box[1], y - h / 2); box[2] = Math.min(box[2], z - d / 2);
    box[3] = Math.max(box[3], x + w / 2); box[4] = Math.max(box[4], y + h / 2); box[5] = Math.max(box[5], z + d / 2);
  });
  return [box[0] - RIDE_PAD, box[1] - RIDE_PAD, box[2] - RIDE_PAD, box[3] + RIDE_PAD, box[4] + RIDE_PAD, box[5] + RIDE_PAD];
}

interface Scratch { n: number; f: Float32Array; c: string[]; r: LiveRole[]; cand: { a: LiveActor; d: number }[]; pose: RidePose; shift: FlockShift;
  callSh: FlockShift; callPos: { x: number; y: number; z: number; yaw: number } }
// FEAR — avatar bir sürünün altına/yanına gelince sürü ürker: merkez avatardan uzağa kayar, yükselir ve süre sonunda yerine döner.
// Yalnız gündüz ve hareket azaltma kapalıyken (sürüler zaten o zaman çizilir); kutu sayısı değişmez (bütçe aynı).
export const STARTLE_S = 3, STARTLE_COOL = 8, STARTLE_PAD = 2.5, STARTLE_PUSH = 3.5, STARTLE_LIFT = 1.8;
const startledAt = new Map<string, number>();
const startleSh: FlockShift = { dx: 0, dz: 0, y: 0, dive: 0 };
/** Bu karenin ürkme kayması (yoksa null); durum sürü kimliğine bağlı, `t` geriye giderse (yeni giriş) sıfırlanır. */
export function flockStartle(f: LiveFlock, t: number, ax: number, az: number, out: FlockShift = startleSh): FlockShift | null {
  if (f.y === null || Number.isNaN(f.y)) return null;
  let t0 = startledAt.get(f.id);
  if (t0 !== undefined && t < t0) { startledAt.delete(f.id); t0 = undefined; }
  const dx = f.c[0] - ax, dz = f.c[1] - az, d = Math.hypot(dx, dz);
  if ((t0 === undefined || t - t0 > STARTLE_S + STARTLE_COOL) && d < f.r + STARTLE_PAD) { t0 = t; startledAt.set(f.id, t); }
  if (t0 === undefined || t - t0 >= STARTLE_S) return null;
  const k = Math.sin(Math.PI * ((t - t0) / STARTLE_S)), ux = d > 1e-3 ? dx / d : 1, uz = d > 1e-3 ? dz / d : 0;
  out.dx = ux * STARTLE_PUSH * k; out.dz = uz * STARTLE_PUSH * k; out.y = f.y + STARTLE_LIFT * k; out.dive = 0; out.call = null; out.only = false;
  return out;
}
/** Sınama/yeni şehir girişi: ürkme durumunu sıfırla. */
export const flockStartleReset = () => startledAt.clear();

const scratch: Scratch = { n: 0, f: new Float32Array(LIVE_SHAPE_MAX * 2 * 7), c: [], r: [], cand: [], pose: { x: 0, z: 0, heading: 0, y: 0 }, shift: { dx: 0, dz: 0, y: 0, dive: 0 },
  callSh: { dx: 0, dz: 0, y: 0, dive: 0 }, callPos: { x: 0, y: 0, z: 0, yaw: 0 } };
const collect: LiveSink = (x, y, z, w, h, d, yaw, color, role) => {
  const s = scratch, o = s.n * 7;
  if (o + 7 > s.f.length) return;
  s.f[o] = x; s.f[o + 1] = y; s.f[o + 2] = z; s.f[o + 3] = w; s.f[o + 4] = h; s.f[o + 5] = d; s.f[o + 6] = yaw;
  s.c[s.n] = color; s.r[s.n] = role; s.n++;
};
/** Toplanan kutuların (yön dahil, muhafazakâr) AABB'si bir kutuyla kesişiyor mu. */
function scratchHits(b: readonly number[]): boolean {
  const s = scratch;
  for (let k = 0; k < s.n; k++) {
    const o = k * 7, cs = Math.abs(Math.cos(s.f[o + 6])), sn = Math.abs(Math.sin(s.f[o + 6]));
    const hx = (cs * s.f[o + 3] + sn * s.f[o + 5]) / 2, hz = (sn * s.f[o + 3] + cs * s.f[o + 5]) / 2, hy = s.f[o + 4] / 2;
    if (s.f[o] + hx > b[0] && s.f[o] - hx < b[3] && s.f[o + 1] + hy > b[1] && s.f[o + 1] - hy < b[4] && s.f[o + 2] + hz > b[2] && s.f[o + 2] - hz < b[5]) return true;
  }
  return false;
}

// ------------------------------------------------------------------------------------------ yemleme güvercinleri
// Şehir haritasında güvercinler yalnız havada dönen sürüydü (kayma ≤ 3 karo, ≥ 2,45 yükseklikte): yem atılan yerde hiç güvercin görünmüyordu.
// Güvercin çekmesinde (`lure.kinds` pigeon) avatarın önüne PECK_BIRDS yer güvercini uçarak iner, yemi gagalar (baş iner/kalkar, hafif sekme),
// istek bitince (süre doldu ya da avatar yürüdü) havalanıp uzaklaşır. Önce çizilir (bütçenin başı), kutu payı `liveCapacity`'de.
// Gece ve hareket azaltmada iniş/kalkış yok (gece hiç; hareket azaltmada yerde durağan).
export const PECK_BIRDS = 4;
const PECK_BOXES = 3, PECK_IN_MS = 1300, PECK_OUT_MS = 1100, PECK_AHEAD = 0.6, PECK_R = 0.45, PECK_FROM = 5, PECK_HIGH = 3.5;
interface Peck { lure: LiveLure; t0: number; end: number | null; fx: number; fz: number; y: number; h: number }
let peck: Peck | null = null;
/** Denetim/test: son karenin yemleme durumu. */
export const livePeck: { n: number; phase: string; y: number; x: number; z: number } = { n: 0, phase: "", y: 0, x: 0, z: 0 };
export function resetLivePeck(): void { peck = null; livePeck.n = 0; livePeck.phase = ""; }
/** Bu karenin yemleme güvercinleri `sink`'e (döner: çizilen güvercin). */
function peckFrame(ctx: LiveCtx, t: number, sink: LiveSink): number {
  const lure = ctx.lure, now = ctx.now ?? 0;
  if (ctx.night) { peck = null; return 0; }
  if (peck && now < peck.t0) peck = null; // saat geri gitti (yeni oturum/test)
  if (lure && lure.kinds.includes("pigeon") && now < lure.until && (!peck || peck.lure !== lure)) {
    // yem avatarın önüne düşer (ritüel kamerasının hedefi: av + yön × 0,9 × insan ölçeği); avatar konumdan uzaksa konumun kendisi
    const h = ctx.ah ?? 0, near = Math.hypot(ctx.ax - lure.x, ctx.az - lure.z) <= 3, bx = near ? ctx.ax : lure.x, bz = near ? ctx.az : lure.z;
    peck = { lure, t0: now, end: null, fx: bx + Math.sin(h) * PECK_AHEAD, fz: bz + Math.cos(h) * PECK_AHEAD, y: ctx.ay ?? 0, h };
  }
  if (!peck) return 0;
  if (peck.end === null && (ctx.lure !== peck.lure || now >= peck.lure.until)) peck.end = Math.min(now, peck.lure.until);
  const out = peck.end === null ? 0 : (now - peck.end) / PECK_OUT_MS;
  if (out >= 1) { peck = null; livePeck.n = 0; livePeck.phase = ""; return 0; }
  const u = ctx.reduced ? 1 : Math.min(1, (now - peck.t0) / PECK_IN_MS), ease = u * u * (3 - 2 * u);
  const sp = SPECIES.pigeon;
  livePeck.phase = peck.end !== null ? "away" : u < 1 ? "land" : "peck";
  for (let i = 0; i < PECK_BIRDS; i++) {
    const a = peck.h + (i - (PECK_BIRDS - 1) / 2) * 0.8, r = PECK_R + 0.12 * (i % 2);
    const gx = peck.fx + Math.sin(a) * r, gz = peck.fz + Math.cos(a) * r;
    const ox = Math.sin(a), oz = Math.cos(a); // yemden dışarı (uçarak gelinen / kaçılan yön)
    let x = gx, z = gz, y = peck.y + 0.08, air = 0;
    if (peck.end !== null && !ctx.reduced) { air = out; x += ox * PECK_FROM * out; z += oz * PECK_FROM * out; y += PECK_HIGH * out * out + 0.6 * out; }
    else if (u < 1) { air = 1 - ease; x += ox * PECK_FROM * air; z += oz * PECK_FROM * air; y += PECK_HIGH * air; }
    else if (!ctx.reduced) { x += 0.05 * Math.sin(t * 1.3 + i * 2); z += 0.05 * Math.cos(t * 1.1 + i); }
    // yüz: yere inerken/gagalarken yeme, kaçarken dışarı (yaw = atan2(−dz, dx), +x ileri)
    const fdx = air > 0 && out > 0 ? ox : peck.fx - x, fdz = air > 0 && out > 0 ? oz : peck.fz - z;
    const yaw = Math.atan2(-fdz, fdx), cs = Math.cos(yaw), sn = Math.sin(yaw);
    const bob = air > 0 || ctx.reduced ? 0 : Math.max(0, Math.sin(t * 7 + i * 1.3)) * 0.07; // gagalama
    sink(x, y, z, 0.26, 0.13, 0.13, yaw, sp.body, "solid");
    sink(x + cs * 0.15, y + 0.1 - bob, z - sn * 0.15, 0.09, 0.09, 0.09, yaw, sp.wing, "solid");
    const flap = air > 0 ? 0.08 * Math.sin(t * 18 + i) : 0;
    sink(x - cs * 0.02, y + 0.07 + flap, z + sn * 0.02, 0.18, 0.03, air > 0 ? 0.5 : 0.15, yaw, sp.wing, "solid");
    if (i === 0) { livePeck.x = x; livePeck.y = y; livePeck.z = z; }
  }
  livePeck.n = PECK_BIRDS;
  return PECK_BIRDS;
}

/**
 * Karenin canlı kutuları: avatara yakın, akışta görünen hareketliler (yakından uzağa; bütçe `LIVE_MAX` / `LIVE_MAX_BOXES` /
 * `LIVE_MAX_FLOCKS`) `sink`'e yazılır. Binilen hat, binilen araca ya da avatara değen hareketli bu karede çizilmez.
 */
export function liveFrame(map: CityMapFile, roster: LiveRoster, ctx: LiveCtx, sink: LiveSink): LiveDraw {
  const draw: LiveDraw = { actors: 0, boxes: 0, flocks: 0, ids: [], hidden: { line: 0, ride: 0, avatar: 0, stream: 0 } };
  const s = scratch, t = ctx.reduced ? 0 : ctx.t;
  const pecked = peckFrame(ctx, ctx.t, sink); // bütçenin başı
  if (pecked) { draw.pecked = pecked; draw.boxes += pecked * PECK_BOXES; }
  const cand = s.cand;
  cand.length = 0;
  for (const a of roster.actors) {
    if (a.kind === "flock" && (ctx.night || ctx.reduced)) continue;
    if ((a.kind === "drift" || (a.kind === "vehicle" && a.dayOnly)) && ctx.night) continue;
    if (a.kind === "vehicle" && ctx.ride && ctx.ride.line === a.line) { draw.hidden.line++; continue; }
    const [x, z] = actorCenter(a, t, s.pose);
    const dist = Math.hypot(x - ctx.ax, z - ctx.az);
    if (dist > LIVE_RADIUS) continue;
    if (!streamVisible(map, x, z, ctx.ax, ctx.az, ctx.loaded)) { draw.hidden.stream++; continue; }
    if (a.kind !== "vehicle" && !resolveHeight(map, a, ctx.loaded)) { draw.hidden.stream++; continue; }
    cand.push({ a, d: dist });
  }
  cand.sort((p, q) => p.d - q.d || (p.a.id < q.a.id ? -1 : 1));
  const rb = ctx.ride ? rideBox(ctx.ride) : null;
  const ay = ctx.ay ?? 0;
  const avatar = [ctx.ax - AVATAR_HALF, ay - 0.1, ctx.az - AVATAR_HALF, ctx.ax + AVATAR_HALF, ay + AVATAR_TOP, ctx.az + AVATAR_HALF];
  // ritüele en yakın uygun tek sürü kayar (yeni hareketli yok; bütçe ve çarpışma denetimleri aynen)
  let luredId: string | null = null, sh: FlockShift | null = null;
  if (ctx.lure && !ctx.reduced && !ctx.night) {
    let bd = Infinity;
    for (const { a } of cand) {
      if (a.kind !== "flock") continue;
      const d = Math.hypot(a.c[0] - ctx.lure.x, a.c[1] - ctx.lure.z);
      if (d < bd && frameShift(map, a, ctx, s.shift)) { bd = d; luredId = a.id; }
    }
    if (luredId) sh = frameShift(map, cand.find((q) => q.a.id === luredId)!.a as LiveFlock, ctx, s.shift);
  }
  // martı çağrısı (istek başına bir kez planlanır; dönüş bitene dek, istek bitse de sürer)
  const now = ctx.now ?? 0;
  if (ctx.lure && !ctx.reduced && !ctx.night && now < ctx.lure.until && !callTried.has(ctx.lure)) {
    callTried.set(ctx.lure, true);
    const p = planGullCall(map, roster, ctx.lure, now, t, { x: ctx.ax, z: ctx.az, y: ctx.ay });
    if (p) call = p;
  }
  let callSh: FlockShift | null = null;
  if (call && (ctx.reduced || ctx.night || !roster.actors.includes(call.flock))) call = null;
  if (call) {
    const ph = callPose(call, now, t, s.callPos);
    if (!ph) call = null;
    else {
      callSh = s.callSh; callSh.dx = 0; callSh.dz = 0; callSh.y = call.fy; callSh.dive = 0; callSh.call = s.callPos; callSh.only = false;
      liveCall.id = call.flock.id; liveCall.phase = ph; liveCall.x = s.callPos.x; liveCall.y = s.callPos.y; liveCall.z = s.callPos.z;
    }
  }
  if (!call) { liveCall.id = null; liveCall.phase = ""; }
  liveLureInfo.id = sh ? luredId : null; liveLureInfo.k = 0; liveLureInfo.dx = sh?.dx ?? 0; liveLureInfo.dz = sh?.dz ?? 0;
  liveLureInfo.y = sh?.y ?? 0; liveLureInfo.dive = sh?.dive ?? 0;
  if (sh && ctx.lure) liveLureInfo.k = lureEnvelope(ctx.lure, ctx.now ?? 0);
  for (const { a, d } of cand) {
    if (draw.actors >= LIVE_MAX) break;
    if (a.kind === "flock" && draw.flocks >= LIVE_MAX_FLOCKS) continue;
    if (a.kind === "vehicle") a.lodNear = d < LIVE_NEAR;
    const nb = actorBoxes(a);
    if (draw.boxes + nb > LIVE_MAX_BOXES) continue;
    s.n = 0;
    const ssh = a.kind === "flock" && !ctx.reduced && !ctx.night && !(callSh && call && a === call.flock) && !(sh && a.id === luredId) ? flockStartle(a, t, ctx.ax, ctx.az) : null;
    actorEmit(a, t, collect, s.pose, callSh && call && a === call.flock ? callSh : sh && a.id === luredId ? sh : ssh);
    if (rb && scratchHits(rb)) { draw.hidden.ride++; continue; }
    if (!ctx.ride && scratchHits(avatar)) { draw.hidden.avatar++; continue; }
    for (let k = 0; k < s.n; k++) { const o = k * 7; sink(s.f[o], s.f[o + 1], s.f[o + 2], s.f[o + 3], s.f[o + 4], s.f[o + 5], s.f[o + 6], s.c[k], s.r[k]); }
    draw.boxes += s.n; draw.actors++; if (a.kind === "flock") draw.flocks++;
    draw.ids.push(a.id);
    if (sh && a.id === luredId) draw.lured = a.id;
    if (callSh && call && a === call.flock) draw.called = a.id;
  }
  // çağrılan kuşun sürüsü bu karede çizilmediyse (akış dışı/uzak) yalnız o kuş, aynı sürü hareketlisi olarak çizilir
  if (callSh && call && !draw.called && !draw.ids.includes(call.flock.id) && draw.actors < LIVE_MAX && draw.flocks < LIVE_MAX_FLOCKS && draw.boxes + BIRD_BOXES <= LIVE_MAX_BOXES) {
    s.n = 0;
    callSh.only = true;
    flockBoxes({ ...call.flock, y: call.fy }, t, collect, callSh);
    callSh.only = false;
    if (!(rb && scratchHits(rb)) && !(!ctx.ride && scratchHits(avatar))) {
      for (let k = 0; k < s.n; k++) { const o = k * 7; sink(s.f[o], s.f[o + 1], s.f[o + 2], s.f[o + 3], s.f[o + 4], s.f[o + 5], s.f[o + 6], s.c[k], s.r[k]); }
      draw.boxes += s.n; draw.actors++; draw.flocks++; draw.ids.push(call.flock.id); draw.called = call.flock.id;
    }
  }
  return draw;
}

/** Kadronun bir karedeki en çok kutusu (dizi kapasitesi): en büyük `LIVE_MAX` hareketlinin toplamı (+ yemleme güvercinleri), `LIVE_MAX_BOXES` ile sınırlı. */
export function liveCapacity(roster: LiveRoster): number {
  const sizes = roster.actors.map(actorMaxBoxes).sort((a, b) => b - a).slice(0, LIVE_MAX);
  return Math.min(LIVE_MAX_BOXES, sizes.reduce((s, n) => s + n, 0) + PECK_BIRDS * PECK_BOXES);
}
