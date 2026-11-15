/**
 * ulaşım iskeleti: hat ve araç modeli ( "Ulaşım").
 *
 * - Araç türleri: vapur, tramvay, füniküler, kayık, metro, teleferik (+ otobüs, monoray, balon). Her türün seyir hızı (karo/sn),
 * yolculuk süresi sınırları, sürüş yüksekliği (su üstü, ray, kablo) ve renkleri vardır. Logo, yazı, bayrak yok.
 * RIDE-UX (F2): süre artık 3…9 sn'ye sıkıştırılmaz (otobüs 52 birim/sn ≈ 330 km/sa gidiyordu); hız, ivme ve viraj sınırlı
 * gerçekçi hareket `RIDE_MOTION` + `rideTimeline` (bacak ≤ `MAX_RIDE_SEC`; uzun yolculukta "Durağa atla").
 * - Hat: durak sırası + rota (şehir karosu çoklu çizgi; verilmezse duraklar arası dik köşeli çizgi). Biniş durağından iniş
 * durağına rota parçası `legPath` ile çıkar (iki yönde de).
 * - `travelPlan`: dünya koordinatlı yol, toplam uzunluk ve süre; `poseAt(plan, t)` belirlenimci konum/yön/yükseklik (yolculuk
 * sahnesi). CITY-POLISH: hattın tasarımda sürüş yüksekliği profili varsa (`CityDesign.rides`, rota köşesi başına) araç onu
 * izler (teleferik halatı doruklara girmez); yoksa sabit `rideY`.
 * Hareket azaltmada yolculuk sahnesi yoktur: doğrudan varış (ride.ts).
 * - `vehicleBlocks`: aracın voxel kutuları (yerel; ≤ 32 katı + 12 cam + 8 parıltı; VEHICLE-DETAIL: şehir livresi/biçimi ve
 * yakın/uzak ayrıntı düzeyi) — kapasite kuyruğunun araç bölgesine yazılır (+0 çizim çağrısı; CityRig).
 *
 * Saf modül: React/three yok.
*/
import type { Block } from "../scenes";
import { stopTile, type CityLine, type CityMapFile, type CityTile, type VehicleKind } from "../citymap/format";
import { designOf } from "../citymap/designs";
import { dezfightBlocks } from "../zfight";
import { RIDE_SPEED_FACTOR as F } from "./speedFactor";
import { FULL_LIVERIES } from "../../full/transitModel";

export interface VehicleSpec {
  kind: VehicleKind;
  /** seyir hızı, karo / sn (RIDE-UX: `RIDE_MOTION.cruise` ile aynı) */
  speed: number;
  /** RIDE-UX: bacak süresinin sınırları (sn; `travelPlan.seconds` = gerçekçi hareketin süresi, biniş beklemesi hariç) */
  minSec: number;
  maxSec: number;
  /** sürüş yüksekliği (avatar ayak y'si) */
  rideY: number;
  /** gövde / şerit / pencere renkleri */
  body: string;
  trim: string;
  glass: string;
}

export const VEHICLES: Readonly<Record<VehicleKind, VehicleSpec>> = {
  vapur: { kind: "vapur", speed: 4 * F, minSec: 1, maxSec: 77, rideY: 0.35, body: "#F4F1EA", trim: "#1F3A5F", glass: "#9CC9E8" },
  tramvay: { kind: "tramvay", speed: 3.6 * F, minSec: 1, maxSec: 77, rideY: 0.12, body: "#C8372D", trim: "#F2E6C9", glass: "#BFE3F2" },
  funikuler: { kind: "funikuler", speed: 2.4 * F, minSec: 1, maxSec: 77, rideY: 0.12, body: "#2F6F4F", trim: "#E8E2C8", glass: "#C4E6F0" },
  kayik: { kind: "kayik", speed: 2 * F, minSec: 1, maxSec: 77, rideY: 0.2, body: "#8B5A2B", trim: "#E9D8A6", glass: "#E9D8A6" },
  metro: { kind: "metro", speed: 6 * F, minSec: 1, maxSec: 77, rideY: 0.12, body: "#B8BEC6", trim: "#2563EB", glass: "#A9D4F5" },
  teleferik: { kind: "teleferik", speed: 2.6 * F, minSec: 1, maxSec: 77, rideY: 2.6, body: "#E2B714", trim: "#3F3F46", glass: "#BEE3F8" },
  // (Londra): iki katlı otobüs — genel kırmızı gövde, işletme işareti/yazı yok; ray ayırmaz, sokak üstünde gider
  otobus: { kind: "otobus", speed: 4.6 * F, minSec: 1, maxSec: 77, rideY: 0.12, body: "#B8322A", trim: "#F2E6C9", glass: "#BFD9E6" },
  // (<city>): monoray — yükseltilmiş kiriş üstünde (ray karosu ayırmaz); genel beyaz gövde, hat rengi/logo yok
  monoray: { kind: "monoray", speed: 5.5 * F, minSec: 1, maxSec: 77, rideY: 2.45, body: "#EEF1F4", trim: "#3E6E8C", glass: "#A9D4F5" },
  // (Kapadokya): sıcak hava balonu — yavaş süzülüş, yüksek seyir (sepet zemini); şerit desenli zarf, şirket adı/logo yok
  balon: { kind: "balon", speed: 1.5 * F, minSec: 1, maxSec: 77, rideY: 6.4, body: "#D9573B", trim: "#8B5A2B", glass: "#F2C14E" },
};

type RailKind = "tramvay" | "funikuler" | "metro";
/**
 * raylı vagonun yerden tepe yüksekliği (× insan; standart 1,8–2,2). <city> m1 rayının üstündeki bulvar kafesi
 * tenteleri (city/landmarks/<city>/zafer.ts) ile y 1,90–1,98'e çıktı; metro da 1,88.
*/
const RAIL_TOP: Readonly<Record<RailKind, number>> = { tramvay: 1.88, funikuler: 1.88, metro: 1.88 };

/** Şehir karosu → dünya (scenes.ts tx/tz: x = I − 11,5, z = J − 7,5). */
export const cityX = (I: number) => I - 11.5;
export const cityZ = (J: number) => J - 7.5;

/** Hattın rotası (şehir karosu). Verilmezse duraklar arası dik köşeli çizgi (önce x, sonra z). */
export function lineRoute(map: CityMapFile, line: CityLine): CityTile[] {
  if (line.route && line.route.length >= 2) return line.route;
  const pts: CityTile[] = [];
  for (const id of line.stops) {
    const s = map.stops.find((x) => x.id === id);
    const t = s ? stopTile(map, s) : null;
    if (!t) continue;
    const last = pts[pts.length - 1];
    if (last && last[0] !== t[0] && last[1] !== t[1]) pts.push([t[0], last[1]]);
    pts.push(t);
  }
  return pts;
}

/** Rota çoklu çizgisinde karoya en yakın noktanın yay uzunluğu (karo). */
function arcOf(route: readonly CityTile[], t: CityTile): number {
  let best = Infinity, arc = 0, at = 0;
  for (let k = 0; k + 1 < route.length; k++) {
    const a = route[k], b = route[k + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const u = len ? Math.max(0, Math.min(1, ((t[0] - a[0]) * dx + (t[1] - a[1]) * dz) / (len * len))) : 0;
    const px = a[0] + dx * u, pz = a[1] + dz * u, d = Math.hypot(t[0] - px, t[1] - pz);
    if (d < best - 1e-9) { best = d; at = arc + len * u; }
    arc += len;
  }
  return at;
}

/** Rotanın [s0, s1] yay aralığı (s0 > s1 ise ters yön) — şehir karosu noktaları. */
function slice(route: readonly CityTile[], s0: number, s1: number): [number, number][] {
  const fwd = s0 <= s1, lo = Math.min(s0, s1), hi = Math.max(s0, s1);
  const out: [number, number][] = [];
  let arc = 0;
  const at = (s: number): [number, number] => {
    let acc = 0;
    for (let k = 0; k + 1 < route.length; k++) {
      const a = route[k], b = route[k + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (s <= acc + len || k + 2 === route.length) { const u = len ? Math.max(0, Math.min(1, (s - acc) / len)) : 0; return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; }
      acc += len;
    }
    return [route[0][0], route[0][1]];
  };
  out.push(at(lo));
  for (let k = 0; k + 1 < route.length; k++) {
    const a = route[k], b = route[k + 1];
    arc += Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (arc > lo + 1e-6 && arc < hi - 1e-6) out.push([b[0], b[1]]);
  }
  out.push(at(hi));
  return fwd ? out : out.reverse();
}

export interface TravelPlan {
  line: string;
  kind: VehicleKind;
  from: string;
  to: string;
  /** dünya koordinatı [x, z] noktaları (biniş → iniş) */
  path: [number, number][];
  /** toplam uzunluk (birim) */
  length: number;
  /** yolculuk süresi (sn) */
  seconds: number;
  /** iniş karosu (şehir karosu) */
  arrive: CityTile;
  /** aracın sabit sürüş yüksekliği (VEHICLES; araç blokları bu yüksekliğe göre) */
  rideY: number;
  /** CITY-POLISH: `path` noktası başına sürüş yüksekliği (profil yoksa hepsi `rideY`) */
  ys: number[];
}

/** Hattın rota köşesi başına sürüş yüksekliği profili (tasarım `rides`; uzunluk rotayla uyuşmazsa null). */
export function rideProfile(map: CityMapFile, line: CityLine): number[] | null {
  const ys = designOf(map.id)?.rides?.[line.id];
  return ys && ys.length === lineRoute(map, line).length ? ys : null;
}

/** Rota üstünde yay uzunluğu `s`'deki profil yüksekliği (köşeler arası doğrusal). */
function profileAt(route: readonly CityTile[], ys: readonly number[], s: number): number {
  let acc = 0;
  for (let k = 0; k + 1 < route.length; k++) {
    const len = Math.hypot(route[k + 1][0] - route[k][0], route[k + 1][1] - route[k][1]);
    if (s <= acc + len || k + 2 === route.length) { const u = len ? Math.max(0, Math.min(1, (s - acc) / len)) : 0; return ys[k] + (ys[k + 1] - ys[k]) * u; }
    acc += len;
  }
  return ys[0];
}

/** Hat üstünde biniş → iniş planı (iki durak da hatta değilse null). */
export function travelPlan(map: CityMapFile, lineId: string, from: string, to: string): TravelPlan | null {
  const line = map.lines.find((l) => l.id === lineId);
  if (!line || from === to || !line.stops.includes(from) || !line.stops.includes(to)) return null;
  const sa = map.stops.find((s) => s.id === from), sb = map.stops.find((s) => s.id === to);
  const ta = sa ? stopTile(map, sa) : null, tb = sb ? stopTile(map, sb) : null;
  if (!ta || !tb) return null;
  const route = lineRoute(map, line);
  const pts = slice(route, arcOf(route, ta), arcOf(route, tb));
  const prof = rideProfile(map, line);
  const ys = pts.map((p) => +(prof ? profileAt(route, prof, arcOf(route, [p[0], p[1]])) : VEHICLES[line.kind].rideY).toFixed(3));
  // durak karolarının kendisi uçlara (rota durağın yanından geçse de araç durakta durur)
  pts[0] = [ta[0], ta[1]];
  pts[pts.length - 1] = [tb[0], tb[1]];
  const path = pts.map(([I, J]) => [cityX(I), cityZ(J)] as [number, number]);
  let length = 0;
  for (let k = 0; k + 1 < path.length; k++) length += Math.hypot(path[k + 1][0] - path[k][0], path[k + 1][1] - path[k][1]);
  const v = VEHICLES[line.kind];
  // RIDE-UX: süre gerçekçi hareketin süresi (hız/ivme/viraj sınırlı zaman çizelgesi; eskiden 3…9 sn'ye sıkıştırılıyordu)
  const tl = buildTimeline(path, line.kind);
  const plan: TravelPlan = { line: line.id, kind: line.kind, from, to, path, length, seconds: +tl.T.toFixed(3), arrive: tb, rideY: v.rideY, ys };
  timelines.set(plan, tl);
  return plan;
}

export interface RidePose { x: number; z: number; heading: number; y: number }
type PosePlan = Pick<TravelPlan, "path"> & { ys?: readonly number[]; rideY?: number };

/** Yol üstünde yay uzunluğu `s`'deki konum, yön ve sürüş yüksekliği (`ys` yoksa `rideY`, o da yoksa 0). */
export function poseAtArc(plan: PosePlan, s: number): RidePose {
  const p = plan.path, ys = plan.ys, y0 = plan.rideY ?? 0;
  for (let i = 0; i + 1 < p.length; i++) {
    const dx = p[i + 1][0] - p[i][0], dz = p[i + 1][1] - p[i][1], len = Math.hypot(dx, dz);
    if (s <= len || i + 2 === p.length) {
      const u = len ? Math.max(0, Math.min(1, s / len)) : 0;
      return { x: p[i][0] + dx * u, z: p[i][1] + dz * u, heading: Math.atan2(dx, dz), y: ys ? ys[i] + (ys[i + 1] - ys[i]) * u : y0 };
    }
    s -= len;
  }
  const last = p[p.length - 1];
  return { x: last[0], z: last[1], heading: 0, y: ys ? ys[ys.length - 1] : y0 };
}

/** Yolculuk sahnesinde t ∈ [0, 1] anında yol üstündeki yay uzunluğu (yumuşak başlama/durma). */
export function rideArc(plan: Pick<TravelPlan, "length">, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
  return e * plan.length;
}

/** Yolculuk sahnesinde t ∈ [0, 1] anındaki konum, yön ve yükseklik (avatar). */
export function poseAt(plan: PosePlan & Pick<TravelPlan, "length">, t: number): RidePose {
  return poseAtArc(plan, rideArc(plan, t));
}

// ------------------------------------------------------------------------------------------ RIDE-UX: gerçekçi yolculuk hareketi
/**
 * RIDE-UX (kalite seferberliği §8 F2; ürün sahibi 2026-10-29: "binince çok aşırı hızlı ve kamera deli gibi dönüyor"). Taşıt sınıfı
 * başına hareket profili. Birim: yürüme insanı 1,0 ≈ 1,75 m → 1 birim/sn ≈ 6,3 km/sa, 1 birim/sn² ≈ 1,75 m/sn².
 *
 * | tür | seyir u/sn (km/sa) | bant üstü | ivme u/sn² (m/sn²) | yön hızı °/sn | pencere u |
 * | vapur | 4,0 (25) | 5,0 | 0,30 (0,53) | 24 | 6 |
 * | kayık | 2,0 (13) | 2,6 | 0,35 (0,61) | 26 | 3 |
 * | tramvay | 3,6 (23) | 4,6 | 0,55 (0,96) | 26 | 3 |
 * | füniküler | 2,4 (15) | 3,0 | 0,40 (0,70) | 23 | 3 |
 * | metro | 6,0 (38) | 7,5 | 0,65 (1,14) | 26 | 4 |
 * | monoray | 5,5 (35) | 7,0 | 0,60 (1,05) | 23 | 4 |
 * | otobüs | 4,6 (29) | 5,8 | 0,75 (1,31) | 29 | 3 |
 * | teleferik | 2,6 (16) | 3,4 | 0,30 (0,53) | 20 | 4 |
 * | balon | 1,5 (9,5) | 2,0 | 0,12 (0,21) | 9 | 8 |
 *
 * - Hız: seyir hızı; durakta 0'dan kalkış/duruş `accel` ile (hız² yay boyunca yumuşatılır → ivme sıçramaz, ışınlanma yok).
 * - Viraj: köşeli rota teğeti `win` boyunda iki kez kutu süzgeciyle yuvarlanır (dönüş köşeden önce başlar = ileri bakış);
 * binenin yön hızı `turn`'ü aşmasın diye araç virajda yavaşlar (v ≤ turn / eğrilik). Konum yine rotanın kendisidir (çarpışma
 * denetimi CITY-MAP-TRANSIT-001 aynı yolu ölçer).
 * - Süre tavanı `MAX_RIDE_SEC` (biniş beklemesi hariç). Seyirle aşan bacakta seyir hızı en çok `cruiseMax`'a (hız bandının
 * üstü) çıkar; o da yetmezse süre tavanı aşılır ve `scripts/ride_ux.test.mjs` hattı adıyla düşürür (veri değişikliği gerekir).
 * Uzun yolculukta hızlandırma yerine HUD'da "Durağa atla" (kararma altında iniş).
*/
export interface RideMotion { cruise: number; cruiseMax: number; accel: number; turn: number; win: number }
const DEG = Math.PI / 180;
const RIDE_MOTION_BASE: Readonly<Record<VehicleKind, RideMotion>> = {
  vapur: { cruise: 4.0, cruiseMax: 6.0, accel: 0.4, turn: 30 * DEG, win: 10 },
  kayik: { cruise: 2.0, cruiseMax: 2.6, accel: 0.35, turn: 30 * DEG, win: 4 },
  tramvay: { cruise: 3.6, cruiseMax: 4.6, accel: 0.55, turn: 30 * DEG, win: 4 },
  funikuler: { cruise: 2.4, cruiseMax: 3.0, accel: 0.4, turn: 23 * DEG, win: 3 },
  metro: { cruise: 6.0, cruiseMax: 7.5, accel: 0.65, turn: 30 * DEG, win: 5 },
  monoray: { cruise: 5.5, cruiseMax: 7.0, accel: 0.6, turn: 23 * DEG, win: 4 },
  otobus: { cruise: 4.6, cruiseMax: 6.5, accel: 0.75, turn: 32 * DEG, win: 4 },
  teleferik: { cruise: 2.6, cruiseMax: 3.4, accel: 0.3, turn: 20 * DEG, win: 4 },
  balon: { cruise: 1.5, cruiseMax: 2.0, accel: 0.12, turn: 9 * DEG, win: 8 },
};
/** hız katı F; yalnız seyir hızı ölçeklenir; ivme/dönüş hızı aynı (ivme de ölçeklenince kalkış/duruş uzar, kamera durak duvarında 1/F kat uzun kalır: ride_frame RIDE-CAM-001).*/
export const RIDE_MOTION: Readonly<Record<VehicleKind, RideMotion>> = Object.fromEntries(
  Object.entries(RIDE_MOTION_BASE).map(([k, v]) => [k, { cruise: v.cruise * F, cruiseMax: v.cruiseMax * F, accel: v.accel, turn: v.turn, win: v.win }]),
) as Record<VehicleKind, RideMotion>;
/** Bacak süresi tavanı (sn; biniş beklemesi hariç). */
/** (karar): hız 0,7 katı → en uzun vapur bacağı 76,3 sn (tavan 76'da yakınsamıyordu); tavan 75 → 77 (süre üst sınırı, tek izinli gevşetme).*/
export const MAX_RIDE_SEC = 77;
/**
 * raylı yolculuk SUNULAN (hedef seçicide listelenen) yolculuğun süre bandı (sn; biniş beklemesi hariç). Eskiden kural
 * yalnız ARDIŞIK durak bacağını (8…22) ölçüyordu; Westminster → Eski şehir gibi iki bacaklı seçenek 32,6 sn'ydi ve yalnız
 * `MAX_RIDE_SEC` (75) sınırına bakılıyordu. Raylı hatta iki bacak (≥ 48 karo, ivme 0,65) bantta fiziksel olarak sığmaz: uzak hedefler
 * sunulmaz (`stopLines`), oraya ardışık binişle ya da hızlı seyahatle gidilir.
*/
export const RAIL_KINDS: ReadonlySet<string> = new Set(["metro", "tramvay", "funikuler"]);
/** (karar): hız 0,7 katı → en uzun hat 22 → 26,4 sn (<city> sahil_metro 55 karo); üst sınır 26,5 (alt sınır 8 değişmedi; tek izinli gevşetme).*/
export const RAIL_RIDE_BAND = { min: 8, max: 26.5 } as const;
const offeredCache = new WeakMap<CityMapFile, Map<string, boolean>>();
/** Hat türü raylıysa `from → to` yolculuğunun TOPLAM süresi (travelPlan.seconds) banda sığıyor mu; raylı olmayan türde hep doğru. */
export function rideOffered(map: CityMapFile, line: CityLine, from: string, to: string): boolean {
  if (!RAIL_KINDS.has(line.kind)) return true;
  let c = offeredCache.get(map);
  if (!c) { c = new Map(); offeredCache.set(map, c); }
  const k = `${line.id}|${from}|${to}`;
  let v = c.get(k);
  if (v === undefined) { const p = travelPlan(map, line.id, from, to); v = !!p && p.seconds <= RAIL_RIDE_BAND.max + 1e-9; c.set(k, v); }
  return v;
}

/** Binişte araç kalkmadan önceki bekleme (sn; kapılar kapanır — tanıtım çekimi bu sırada başlar). */
export const BOARD_DWELL = 1.2;
/** Zaman çizelgesi örnek adımı (birim). */
const RIDE_DS = 0.1;

/** Yolculuğun zaman çizelgesi: yay örnekleri (adım `ds`) başına varış anı `t`, yumuşatılmış yön `h` (sarılmamış) ve hız `v`. */
export interface RideTimeline { ds: number; n: number; t: Float64Array; h: Float64Array; v: Float64Array; T: number; cruise: number }
const timelines = new WeakMap<object, RideTimeline>();

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Merkezli kutu süzgeci (yarı genişlik `r` örnek; uçlarda kenar değeri sürer). */
function boxFilter(a: Float64Array, r: number): Float64Array {
  const n = a.length, out = new Float64Array(n);
  if (r < 1) { out.set(a); return out; }
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
  for (let i = 0; i < n; i++) {
    const lo = i - r, hi = i + r;
    let sum = pre[Math.min(n, hi + 1)] - pre[Math.max(0, lo)];
    if (lo < 0) sum += -lo * a[0];
    if (hi > n - 1) sum += (hi - n + 1) * a[n - 1];
    out[i] = sum / (2 * r + 1);
  }
  return out;
}

/** Yol (dünya [x, z]) ve tür için zaman çizelgesi (bkz. `RIDE_MOTION`). */
export function buildTimeline(path: readonly (readonly [number, number])[], kind: VehicleKind): RideTimeline {
  const M = RIDE_MOTION[kind];
  const cum = [0], hd: number[] = [];
  for (let k = 0; k + 1 < path.length; k++) {
    const dx = path[k + 1][0] - path[k][0], dz = path[k + 1][1] - path[k][1];
    cum.push(cum[k] + Math.hypot(dx, dz));
    hd.push(Math.atan2(dx, dz));
  }
  // sıfır boylu parça: yönü bir sonraki (yoksa bir önceki) gerçek parçanın yönü
  for (let k = hd.length - 2; k >= 0; k--) if (cum[k + 1] - cum[k] < 1e-9) hd[k] = hd[k + 1];
  for (let k = 1; k < hd.length; k++) if (cum[k + 1] - cum[k] < 1e-9) hd[k] = hd[k - 1];
  const L = cum[cum.length - 1];
  const n = Math.max(2, Math.ceil(L / RIDE_DS) + 1), ds = L > 1e-9 ? L / (n - 1) : 0;
  const raw = new Float64Array(n);
  for (let i = 0, k = 0; i < n; i++) {
    const s = i * ds;
    while (k + 1 < hd.length && s > cum[k + 1] + 1e-9) k++;
    raw[i] = hd.length ? hd[k] : 0;
  }
  // sarılmamış yön → iki kez kutu süzgeci (toplam destek `win`): yön sürekli, en çok eğim ≈ 2θ / win
  const un = new Float64Array(n);
  un[0] = raw[0];
  // tam geri dönüşte (±180°) dönüş yönü bir önceki dönüşün tersi: iskeleye girip çıkan çatal (sağ + geri + sağ) net 0 döner,
  // 360° fırıldak yok (yön her iki gidişte simetrik)
  for (let i = 1, last = -1; i < n; i++) {
    let d = wrapPi(raw[i] - raw[i - 1]);
    if (Math.abs(d) > Math.PI - 1e-6) d = -last * Math.PI;
    if (Math.abs(d) > 1e-9) last = Math.sign(d);
    un[i] = un[i - 1] + d;
  }
  const r = ds > 0 ? Math.max(1, Math.round(M.win / 4 / ds)) : 0;
  const h = boxFilter(boxFilter(un, r), r);
  const kap = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    kap[i] = b > a && ds > 0 ? Math.abs(h[b] - h[a]) / ((b - a) * ds) : 0;
  }
  // hız² profili: viraj sınırı, uçlarda 0; ileri/geri geçişte ivme sınırı; yumuşatma min(u, ortalama u) ivmeyi aşmaz
  const solve = (vc: number): { v: Float64Array; t: Float64Array; T: number } => {
    const u = new Float64Array(n);
    for (let i = 0; i < n; i++) { const lim = kap[i] > 1e-9 ? Math.min(vc, M.turn / kap[i]) : vc; u[i] = lim * lim; }
    u[0] = 0; u[n - 1] = 0;
    const du = 2 * M.accel * ds;
    for (let i = 1; i < n; i++) u[i] = Math.min(u[i], u[i - 1] + du);
    for (let i = n - 2; i >= 0; i--) u[i] = Math.min(u[i], u[i + 1] + du);
    const rs = ds > 0 ? Math.max(1, Math.round(Math.min(L / 8, (M.cruise * M.cruise) / (2 * M.accel) / 4) / ds)) : 0;
    const avg = boxFilter(u, rs);
    const v = new Float64Array(n), t = new Float64Array(n);
    for (let i = 0; i < n; i++) v[i] = Math.sqrt(Math.max(0, Math.min(u[i], avg[i])));
    v[0] = 0; v[n - 1] = 0;
    for (let i = 1; i < n; i++) t[i] = t[i - 1] + (2 * ds) / Math.max(1e-4, v[i - 1] + v[i]);
    return { v, t, T: t[n - 1] };
  };
  let cruise = M.cruise, sol = solve(cruise);
  for (let it = 0; it < 4 && sol.T > MAX_RIDE_SEC && cruise < M.cruiseMax - 1e-9; it++) {
    cruise = Math.min(M.cruiseMax, cruise * (sol.T / MAX_RIDE_SEC) * 1.03);
    sol = solve(cruise);
  }
  return { ds, n, t: sol.t, h, v: sol.v, T: sol.T, cruise };
}

/** Planın zaman çizelgesi (travelPlan önbelleği; başka yoldan kurulan plan için bir kez kurulur). */
export function rideTimeline(plan: Pick<TravelPlan, "path" | "kind">): RideTimeline {
  let tl = timelines.get(plan);
  if (!tl) { tl = buildTimeline(plan.path, plan.kind); timelines.set(plan, tl); }
  return tl;
}

export interface RideState extends RidePose { s: number; v: number }
/** Kalkıştan `tau` sn sonraki poz: konum rota üstünde, yön yumuşatılmış teğet (virajdan önce döner), `s` yay, `v` hız. */
export function rideStateAt(plan: PosePlan & Pick<TravelPlan, "path" | "kind">, tau: number, tl: RideTimeline = rideTimeline(plan)): RideState {
  const { t, h, v, n, ds } = tl;
  let i = 0, f = 0;
  if (tau >= tl.T) { i = n - 2; f = 1; }
  else if (tau > 0) {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid] <= tau) lo = mid; else hi = mid; }
    i = lo; f = t[hi] > t[lo] ? (tau - t[lo]) / (t[hi] - t[lo]) : 0;
  }
  i = Math.max(0, Math.min(n - 2, i));
  const s = (i + f) * ds, p = poseAtArc(plan, s);
  return { x: p.x, z: p.z, y: p.y, heading: wrapPi(h[i] + (h[i + 1] - h[i]) * f), s, v: v[i] + (v[i + 1] - v[i]) * f };
}

const halfCache = new Map<VehicleKind, number>();
/** Aracın gövde yarı boyu (yerel +z; ince halat/tel hariç: iki ölçüsü ≤ 0,07). */
export function vehicleHalfLength(kind: VehicleKind): number {
  let h = halfCache.get(kind);
  if (h === undefined) {
    h = 0;
    for (const b of vehicleBlocks(kind)) {
      if ((b.s[0] <= 0.07 ? 1 : 0) + (b.s[1] <= 0.07 ? 1 : 0) + (b.s[2] <= 0.07 ? 1 : 0) >= 2) continue;
      h = Math.max(h, Math.abs(b.p[2]) + b.s[2] / 2);
    }
    halfCache.set(kind, h);
  }
  return h;
}

/**
 * CITY-POLISH: araç gövdesinin yay uzunluğu — gövde biniş/iniş durak karosunun dışına (yolun gerisine/ilerisine) taşmaz:
 * merkez [a, L − a] aralığında (a = yarı boy − 0,5). Avatar yolun kendisini izler (durakta aracın arka/ön bölmesine biner, iner);
 * araç tampon gibi durur, arkasındaki yapıya (landmark, istinat duvarı) girmez.
 */
export function bodyArc(plan: Pick<TravelPlan, "length" | "kind">, s: number): number {
  const a = Math.max(0, vehicleHalfLength(plan.kind) - 0.5);
  return plan.length <= 2 * a ? plan.length / 2 : Math.max(a, Math.min(plan.length - a, s));
}

/**
 * (RIDE-HEAD-001): binenin araçtaki yeri (yerel x, döşemeden ayak yüksekliği, z; +z ileri). Eskiden avatar yolu izlerdi:
 * binişte/inişte gövde `bodyArc` ile kenetlenince avatar aracın ön/arka bölmesinde duvarın, köşkün içinde kalıyordu (klasik vapur
 * baş −0,53, kayık −0,68); yolda da klasik vapurun alt salonu kamerayı örtüyor, kesit tavanı bütün açınca baş "çatıdan dışarı" okunuyordu.
 * Şimdi binen gövdeye bağlı yerde durur: varsayılan gövde ortası (kapalı vagon/salon tavanı başın üstünde), klasik vapurda açık üst
 * güverte (köşkün önü; üstü açık gökyüzü, kamera örtücüsüz görür).
*/
export function riderSeat(kind: VehicleKind, form?: string): readonly [number, number, number] {
  if (kind === "vapur" && (form ?? DEFAULT_FORM.vapur) === "classic") return CLASSIC_DECK_SEAT;
  // gövde ortasında döşemenin üstü (vagon/otobüs döşemesi rideY + 0,1: ayak döşemeye gömülmez)
  const key = `${kind}:${form ?? ""}`, hit = seatCache.get(key);
  if (hit) return hit;
  const ry = VEHICLES[kind].rideY, look = { ...vehicleLook(kind), ...(form ? { form } : {}) };
  let floor = 0;
  for (const b of buildVehicle(kind, look, "near")) {
    if (b.g === "glow" || Math.abs(b.p[0]) > b.s[0] / 2 || Math.abs(b.p[2]) > b.s[2] / 2) continue;
    const t = b.p[1] + b.s[1] / 2 - ry;
    if (t > floor && t <= 0.15) floor = t;
  }
  const seat = [0, +floor.toFixed(3), 0] as const;
  seatCache.set(key, seat);
  return seat;
}
const seatCache = new Map<string, readonly [number, number, number]>();
const CLASSIC_DECK_SEAT = [0, 1.25, 0.7] as const;
/** Gövde pozundan binenin dünya noktası (araç blokları gibi yön 90°'ye yuvarlanır: `vehicleWorldBoxes`). */
export function riderAt(body: RidePose, seat: readonly [number, number, number]): { x: number; y: number; z: number } {
  const side = Math.abs(Math.sin(body.heading)) > 0.7, sz = Math.cos(body.heading) >= 0 ? 1 : -1, sx = Math.sin(body.heading) >= 0 ? 1 : -1;
  const [lx, ly, lz] = seat;
  return side ? { x: body.x + lz * sx, y: body.y + ly, z: body.z + lx * sx } : { x: body.x + lx * sz, y: body.y + ly, z: body.z + lz * sz };
}

/** Durağın hatları (kimlik sırasıyla). */
export function linesAt(map: CityMapFile, stop: string): CityLine[] {
  return map.lines.filter((l) => l.stops.includes(stop)).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * VEHICLE-DETAIL (kalite seferberliği D2) — şehre özgü livre ve gövde biçimi. Anahtar `şehir` ya da `şehir:hat`; yalnız renk ve
 * biçim (yazı, logo, bayrak, işletme amblemi yok). Kaynaklar (açılan sayfalar, 2026-10-28): Londra iki katlı kırmızı otobüs, üç
 * kapı / iki merdiven (en.wikipedia.org/wiki/New_Routemaster); İstanbul vapuru beyaz-siyah-sarı (…/wiki/Şehir_Hatları); <city> Ginza
 * hattı limon sarısı, yanda 3 çift kapı (…/wiki/<city>_Metro_1000_series); Roosevelt Adası teleferiği kırmızı kabin
 * (…/wiki/Roosevelt_Island_Tramway); Santa Teresa tramvayı açık yanlı, tavan troley direkli (…/wiki/Santa_Teresa_Tram); Chao
 * Phraya ekspres teknesi uzun alçak gövde, tente/çatı (…/wiki/Chao_Phraya_Express_Boat); felucca tek direk, lateen yelken
 * (…/wiki/Felucca); abra ahşap koy kayığı (…/wiki/Abra_(boat)).
 *
 * - `form`: otobüs `double` (Londra) · `single` (şehir otobüsü) · `midi` (kasaba midibüsü); vapur `classic` (iki katlı,
 * bacalı) · `saloon` (camlı tek salonlu nehir teknesi); kayık `launch` (motorlu) · `row` (kürekli) · `wupeng` (kara tenteli)
 * · `abra` (orta sıralı) · `felucca` (direkli, sarılı yelken). Biçim gövdenin varsayılan sınır kutusunun İÇİNDE kalır (durak,
 * köprü ve yanaşma ölçüleri `vehicleHalfLength(kind)` ile aynı); felucca direği ince (iki ölçüsü ≤ 0,07) tel sayılır.
*/
export interface VehicleLook { body: string; trim: string; glass: string; door: string; dark: string; hull: string; funnel: string; form: string }
type LookPatch = Partial<VehicleLook>;
export const LIVERIES: Readonly<Record<string, Partial<Record<VehicleKind, LookPatch>>>> = {
  istanbul: { vapur: { funnel: "#E3B341", hull: "#23272E" }, tramvay: { body: "#ECEEF0", trim: "#B8322A", door: "#3A3F45" },
    kayik: { form: "launch", body: "#8B5A2B", trim: "#E9D8A6" } },
  "istanbul:nostalji": { tramvay: { body: "#B8322A", trim: "#F2E6C9", door: "#7A1F1A" } },
  ...FULL_LIVERIES,
  londra: { vapur: { form: "saloon", body: "#E6E9ED", trim: "#1E3D59", hull: "#1E2A36", funnel: "#1E3D59" },
    metro: { body: "#EDEEF0", trim: "#1F3E8C", door: "#C8372D" } },
  kapadokya: { otobus: { form: "midi", body: "#F3F1EC", trim: "#2F6DA8", door: "#2B2F33" } },
};
const DEFAULT_FORM: Readonly<Partial<Record<VehicleKind, string>>> = { otobus: "double", vapur: "classic", kayik: "row" };

/** Aracın görünüşü: varsayılan renkler (VEHICLES) ← şehir livresi ← `şehir:hat` livresi. */
export function vehicleLook(kind: VehicleKind, city?: string, line?: string): VehicleLook {
  const v = VEHICLES[kind];
  const base: VehicleLook = { body: v.body, trim: v.trim, glass: v.glass, door: v.trim, dark: "#2B2F33", hull: v.trim, funnel: v.trim, form: DEFAULT_FORM[kind] ?? "std" };
  return { ...base, ...(city ? LIVERIES[city]?.[kind] : undefined), ...(city && line ? LIVERIES[`${city}:${line}`]?.[kind] : undefined) };
}

/** Yakın (`near`: bütün ayrıntı) ya da uzak (`far`: ince ayrıntısız siluet; canlı katmanın uzak araçları). */
export type VehicleLod = "near" | "far";
export interface VehicleOpts { city?: string; line?: string; lod?: VehicleLod }

const blockCache = new Map<string, Block[]>();
/**
 * Aracın voxel kutuları (yerel: araç merkezi, +z ileri; paylaşılan önbellek dizisi — değiştirme). VEHICLE-DETAIL: ≤ 32 katı +
 * ≤ 12 cam + ≤ 8 parıltı (`citymap/source.ts VEHICLE_SLOT`). Yeni ayrıntı (kapı, tampon, ayna, far/stop, hedef tabelası, boji,
 * pruva, korkuluk, direk, can salı…) gövdenin eski sınır kutusunun içinde, binenin hacmine (|x|, |z| < 0,2; ayak + 0,12 … + 1)
 * girmez ve gövdeye değer (tek parça).
 */
export function vehicleBlocks(kind: VehicleKind, opts: VehicleOpts = {}): Block[] {
  const lod = opts.lod ?? "near";
  const key = `${kind}|${opts.city ?? ""}|${opts.line ?? ""}|${lod}`;
  let hit = blockCache.get(key);
  if (!hit) { hit = dezfightBlocks(buildVehicle(kind, vehicleLook(kind, opts.city, opts.line), lod)); blockCache.set(key, hit); } // RENDER-FIX
  return hit;
}
/** RENDER-FIX: yazıldığı gibi kutular (z-fighting çözümü öncesi; yalnız `scripts/zfight_check.mjs` ham sayımı için, önbelleksiz). */
export const vehicleBlocksRaw = (kind: VehicleKind, opts: VehicleOpts = {}): Block[] => buildVehicle(kind, vehicleLook(kind, opts.city, opts.line), opts.lod ?? "near");

const HEAD = "#FFE7A3", TAIL = "#F87171", BOARD = "#FFB547", PORT = "#EF4444", STARBOARD = "#22C55E", WHITE = "#FFF6E0";

function buildVehicle(kind: VehicleKind, look: VehicleLook, lod: VehicleLod): Block[] {
  const v = { ...VEHICLES[kind], body: look.body, trim: look.trim, glass: look.glass };
  const out: Block[] = [];
  const far = lod === "far";
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, g: Block["g"] = "solid") => out.push({ p: [x, y, z], s: [w, h, d], c, g, j: 0 });
  /** ince ayrıntı: uzak ayrıntı düzeyinde çizilmez */
  const fine = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, g: Block["g"] = "solid") => { if (!far) box(x, y, z, w, h, d, c, g); };
  const ry = v.rideY;
  switch (kind) {
    case "tramvay": case "funikuler": case "metro": {
      // vagon boyu 4,2 (standart ≥ 4); yerden 1,88 × insan (1,8–2,2), iç (döşeme → tavan altı) 1,54 (RAIL_TOP).
      const L = 4.2, Z = L / 2, W = 1.3, X = W / 2 - 0.03, T = RAIL_TOP[kind as RailKind] - ry, wallH = T - 0.22;
      const wy = 0.1 + wallH / 2, gy = 0.1 + wallH * 0.66;
      box(0, ry + 0.05, 0, W, 0.1, L - 0.1, "#3A3A3A");
      box(-X, ry + wy, 0, 0.06, wallH, L - 0.1, v.body); box(X, ry + wy, 0, 0.06, wallH, L - 0.1, v.body);
      box(0, ry + wy, Z - 0.07, W, wallH, 0.06, v.body); box(0, ry + wy, -(Z - 0.07), W, wallH, 0.06, v.body);
      box(0, ry + T - 0.06, 0, W + 0.1, 0.12, L, v.trim);
      box(-(X + 0.02), ry + gy, 0, 0.03, 0.5, L - 0.7, v.glass, "glass"); box(X + 0.02, ry + gy, 0, 0.03, 0.5, L - 0.7, v.glass, "glass");
      box(0, ry + gy, Z - 0.04, W - 0.4, 0.45, 0.03, v.glass, "glass");
      box(0, ry + 0.45, Z - 0.04, W - 0.3, 0.12, 0.03, v.trim);
      // VEHICLE-DETAIL: iki yanda boji yan kasnağı (tekerlek; döşeme altına inmez — taban açıklığı ve peron kenarı aynı), yanda iki
      // çift kapı (kapı penceresiyle), livre şeridi, ön/arka tampon, iki far + iki stop, ön/arka hedef tabelası (yazısız ışıklı
      // bant), arka cam
      for (const sx of [-1, 1]) {
        for (const z of [-1.5, 1.5]) box(sx * 0.665, ry + 0.12, z, 0.03, 0.2, 0.6, "#1F1F1F");
        fine(sx * 0.66, ry + 0.78, 0, 0.02, 0.1, L - 0.3, v.trim);
        for (const z of [-0.85, 0.85]) {
          box(sx * 0.675, ry + 0.78, z, 0.02, 1.36, 0.56, look.door);
          fine(sx * 0.69, ry + 1.12, z, 0.01, 0.6, 0.4, v.glass, "glass");
        }
      }
      fine(0, ry + gy, -(Z - 0.04), W - 0.5, 0.4, 0.03, v.glass, "glass");
      for (const sz of [-1, 1]) {
        fine(0, ry + 0.22, sz * (Z - 0.02), 0.9, 0.1, 0.04, look.dark);
        box(-0.4, ry + 0.3, sz * (Z - 0.03), 0.14, 0.08, 0.03, sz > 0 ? HEAD : TAIL, "glow"); box(0.4, ry + 0.3, sz * (Z - 0.03), 0.14, 0.08, 0.03, sz > 0 ? HEAD : TAIL, "glow");
        fine(0, ry + 1.67, sz * (Z - 0.03), 0.6, 0.1, 0.03, BOARD, "glow");
      }
      if (kind === "tramvay") {
        box(0, ry + T + 0.2, 0, 0.06, 0.4, 0.06, "#3A3A3A"); box(0, ry + T + 0.4, 0, 0.6, 0.04, 0.06, "#3A3A3A");
        // iki dikiz aynası (çatı donanımı yok: tavan çizgisi 1,88 — tente/köprü altı payı korunur)
        for (const sx of [-1, 1]) fine(sx * 0.68, ry + 1.25, Z - 0.25, 0.03, 0.14, 0.06, look.dark);
      }
      break;
    }
    case "vapur": {
      // vapur boy 7,2 × insan (standart ≥ 7, otobüsün 1,5 katı), baca tepesi 2,57 (2,5–4). VEHICLE-DETAIL: sivri pruva (gövde
      // üç kademede daralır), su hattı altı koyu boya, pruvada ve kıçta babalar, köşk direği + seyir fenerleri (iskele kırmızı,
      // sancak yeşil, direk ve kıç beyaz), üst güvertede can salı kapsülleri. Livre `form`: classic (iki katlı salon + baca) ya da
      // saloon (camlı tek salon, tavanda cam şerit, önde köşk). Sınır kutusu eskisiyle aynı.
      const L = 7.2, B = 2.0;
      box(0, ry - 0.1, -0.4, B, 0.2, L - 0.8, v.body); box(0, ry - 0.3, -0.4, B, 0.2, L - 0.8, look.hull);
      box(0, ry - 0.1, 3.05, B * 0.72, 0.2, 0.5, v.body); box(0, ry - 0.3, 3.05, B * 0.72, 0.2, 0.5, look.hull);
      box(0, ry - 0.2, 3.45, B * 0.36, 0.4, 0.3, look.hull);
      // pruva korkuluğu (kademeli gövdeyi izler) ve kıç korkuluğu — alçak parapet, güverteye oturur
      for (const sx of [-1, 1]) { box(sx * 0.95, ry + 0.21, 2.35, 0.04, 0.42, 0.9, v.trim); box(sx * 0.68, ry + 0.21, 3.05, 0.04, 0.42, 0.5, v.trim); }
      box(0, ry + 0.21, 3.3, 1.4, 0.42, 0.04, v.trim);
      for (const sx of [-1, 1]) fine(sx * 0.3, ry + 0.07, 3.15, 0.1, 0.14, 0.1, look.dark);
      box(0, ry + 0.1, L / 2 - 0.1, 0.1, 0.08, 0.06, HEAD, "glow");
      if (look.form === "saloon") {
        // camlı salon (z −2,6 … 2,0): alçak yan/uç duvar, geniş cam bant, köşe ve ara dikmeler, kenar çerçeveli cam tavan; salonun
        // önünde tavana oturan köşk (ön + yan cam), kıç açık güverte korkuluğu
        const X = 0.78, z0 = -2.6, z1 = 2.0, zc = (z0 + z1) / 2, Ls = z1 - z0, top = ry + 1.08;
        for (const sx of [-1, 1]) {
          box(sx * X, ry + 0.175, zc, 0.06, 0.35, Ls, v.body);
          box(sx * (X + 0.01), ry + 0.7, zc, 0.04, 0.7, Ls - 0.1, v.glass, "glass");
          box(sx * (X - 0.08), top + 0.02, zc, 0.2, 0.08, Ls, v.trim);
          for (const z of [z0 + 0.03, z1 - 0.03]) box(sx * X, ry + 0.7, z, 0.06, 0.72, 0.06, v.body);
          for (const z of [zc - 0.8, zc + 0.8]) fine(sx * X, ry + 0.7, z, 0.06, 0.7, 0.05, v.body);
        }
        for (const z of [z0, z1]) { box(0, ry + 0.175, z, 2 * X, 0.35, 0.06, v.body); box(0, ry + 0.7, z, 2 * X - 0.12, 0.7, 0.04, v.glass, "glass"); }
        box(0, top + 0.02, zc, 2 * X - 0.36, 0.06, Ls - 0.2, v.glass, "glass");
        box(0, top + 0.3, 1.55, 0.9, 0.48, 0.6, v.body);
        box(0, top + 0.36, 1.86, 0.8, 0.22, 0.03, v.glass, "glass");
        for (const sx of [-1, 1]) box(sx * 0.465, top + 0.36, 1.55, 0.03, 0.22, 0.45, v.glass, "glass");
        for (const sx of [-1, 1]) box(sx * 0.95, ry + 0.21, -3.05, 0.04, 0.42, 0.9, v.trim);
        box(0, ry + 0.21, -3.48, 1.94, 0.42, 0.04, v.trim);
        fine(0, top + 0.76, 1.55, 0.05, 0.44, 0.05, look.dark);
        fine(0, top + 1.0, 1.55, 0.06, 0.06, 0.06, WHITE, "glow");
        fine(0.48, top + 0.36, 1.4, 0.03, 0.08, 0.1, PORT, "glow"); fine(-0.48, top + 0.36, 1.4, 0.03, 0.08, 0.1, STARBOARD, "glow");
        fine(0, ry + 0.1, -3.5, 0.1, 0.08, 0.04, WHITE, "glow");
        break;
      }
      // CORE-CITYMAP: içi boş alt salon (binen salonun ortasında; yan duvarlarda cam bant, ön/arka duvar), üstü açık güverte
      // (korkuluk), köprü üstü kaptan köşkü ve baca; pruva ve kıç açık güverte korkuluklu. Sürüş kamerasından kabin + cam okunur.
      const X = B * 0.36, Zc = -0.5, Lc = L * 0.5, top = ry + 1.15;
      for (const sx of [-1, 1]) {
        box(sx * X, ry + 0.235, Zc, 0.06, 0.47, Lc, v.body); box(sx * X, ry + 1.02, Zc, 0.06, 0.26, Lc, v.body);
        box(sx * X, ry + 0.68, Zc, 0.04, 0.42, Lc - 0.1, v.glass, "glass");
      }
      for (const sz of [-1, 1]) {
        box(0, ry + 0.235, Zc + sz * Lc / 2, B * 0.72, 0.47, 0.06, v.body); box(0, ry + 1.02, Zc + sz * Lc / 2, B * 0.72, 0.26, 0.06, v.body);
        box(0, ry + 0.68, Zc + sz * Lc / 2, B * 0.72 - 0.1, 0.42, 0.04, v.glass, "glass");
      }
      box(0, top + 0.05, Zc, B * 0.78, 0.1, Lc + 0.2, v.trim);
      // CORE-CITYMAP (REAL-SUPPORT): korkuluklar güverteye oturan alçak parapet (havada çubuk değil)
      box(-(B * 0.39 - 0.02), top + 0.25, Zc, 0.04, 0.3, Lc, v.trim); box(B * 0.39 - 0.02, top + 0.25, Zc, 0.04, 0.3, Lc, v.trim);
      box(0, top + 0.25, Zc - Lc / 2 + 0.05, B * 0.76, 0.3, 0.04, v.trim);
      box(0, top + 0.37, -0.8 + Lc * 0.3 / 2 - 0.1, B * 0.56, 0.45, 0.6, v.body);
      box(0, top + 0.42, -0.8 + Lc * 0.3 / 2 + 0.21, B * 0.5, 0.22, 0.03, v.glass, "glass");
      box(-(B * 0.28 + 0.03), top + 0.42, -0.36, 0.03, 0.22, 0.5, v.glass, "glass"); box(B * 0.28 + 0.03, top + 0.42, -0.36, 0.03, 0.22, 0.5, v.glass, "glass");
      box(0, top + 0.605, -1.6, 0.42, 1.01, 0.42, look.funnel); box(0, top + 1.0, -1.6, 0.46, 0.14, 0.46, "#2B2F33");
      for (const sx of [-1, 1]) box(sx * (B / 2 - 0.05), ry + 0.21, -(L / 2 - 0.8), 0.04, 0.42, 1.4, v.trim);
      // köşk direği (ince; baca tepesini aşmaz) + direk feneri, köşk yanlarında seyir fenerleri, kıç feneri, can salı kapsülleri
      fine(0, top + 0.82, -0.36, 0.05, 0.45, 0.05, look.dark);
      fine(0, top + 1.07, -0.36, 0.06, 0.06, 0.06, WHITE, "glow");
      fine(B * 0.28 + 0.05, top + 0.42, -0.62, 0.03, 0.08, 0.1, PORT, "glow"); fine(-(B * 0.28 + 0.05), top + 0.42, -0.62, 0.03, 0.08, 0.1, STARBOARD, "glow");
      fine(0, ry + 0.1, -(L / 2 - 0.08), 0.1, 0.08, 0.04, WHITE, "glow");
      for (const sx of [-1, 1]) fine(sx * 0.5, top + 0.22, -2.0, 0.28, 0.24, 0.5, "#F2F2F2");
      break;
    }
    case "kayik": {
      // kayık boy 3,0 (2,5–4), tepe ≤ 1. VEHICLE-DETAIL: sivri pruva (iki kademe) + pruva bodoslaması, iki yanda küpeşte
      // (bordo + üst kapak), kıç aynalığı, iki oturak (binenin önünde ve arkasında). `form`: row (yatırılmış iki kürek), launch
      // (kıçta motor kapağı + kıç feneri), wupeng (önde ve arkada alçak kara tente, kıçta tek boyna küreği), abra (orta boyuna
      // sıra + motor kapağı), felucca (ince direk, sarılı yelken ve seren — ince tel: köprü/ölçek tavanı korunur).
      const L = 3.0, B = 1.0, zm = -0.25, Lm = 2.5;
      box(0, ry - 0.2, zm, B, 0.4, Lm, v.body);
      box(0, ry - 0.2, 1.175, 0.7, 0.4, 0.35, v.body); box(0, ry - 0.2, 1.425, 0.36, 0.4, 0.15, v.body);
      box(0, ry - 0.33, zm, B * 0.8, 0.12, Lm * 0.9, look.hull);
      box(0, ry + 0.05, 0, 0.1, 0.06, L * 0.6, v.trim);
      for (const sx of [-1, 1]) {
        box(sx * (B / 2 - 0.04), ry + 0.12, zm, 0.08, 0.24, Lm, v.body);
        box(sx * 0.31, ry + 0.12, 1.175, 0.08, 0.24, 0.35, v.body);
        fine(sx * (B / 2 - 0.04), ry + 0.26, zm, 0.08, 0.04, Lm, v.trim);
      }
      box(0, ry + 0.2, 1.42, 0.1, 0.4, 0.12, v.trim);
      fine(0, ry + 0.12, -(L / 2 - 0.04), B - 0.08, 0.24, 0.08, v.body);
      for (const z of [-0.8, 0.7]) box(0, ry + 0.15, z, B - 0.1, 0.05, 0.22, v.trim);
      if (look.form === "row") {
        for (const sx of [-1, 1]) fine(sx * 0.3, ry + 0.2, -0.1, 0.05, 0.04, 2.2, "#C9A36B");
      } else if (look.form === "launch") {
        box(0, ry + 0.16, -1.12, 0.46, 0.32, 0.5, look.dark);
        fine(0, ry + 0.36, -1.12, 0.3, 0.08, 0.3, v.trim);
      } else if (look.form === "wupeng") {
        // kara tente (yay kesitli: üst kapak + iki yan), binenin önünde ve arkasında; kıçta tek boyna küreği
        for (const z of [0.85, -0.85]) {
          box(0, ry + 0.55, z, 0.7, 0.08, 0.5, v.trim);
          for (const sx of [-1, 1]) box(sx * 0.38, ry + 0.38, z, 0.06, 0.32, 0.5, v.trim);
        }
        fine(0.2, ry + 0.2, -1.2, 0.05, 0.05, 0.56, "#C9A36B");
      } else if (look.form === "abra") {
        for (const z of [0.72, -0.78]) { box(0, ry + 0.24, z, 0.32, 0.06, 0.6, v.trim); box(0, ry + 0.12, z, 0.12, 0.18, 0.5, v.body); }
        box(0, ry + 0.16, -1.25, 0.4, 0.3, 0.3, look.dark);
      } else if (look.form === "felucca") {
        // (canlı katman 1,5'ten uzun ince teli halat sayıp atar: direk 1,45, seren 1,4)
        box(0, ry + 0.825, 0.62, 0.06, 1.45, 0.06, "#6B4A2E");
        fine(0, ry + 1.35, 0.45, 0.05, 0.05, 1.4, "#6B4A2E");
        fine(0, ry + 1.29, 0.45, 0.06, 0.07, 1.3, "#F4F1EA");
      }
      fine(0, ry + 0.43, 1.42, 0.06, 0.06, 0.06, WHITE, "glow");
      break;
    }
    case "otobus": {
      if (look.form === "single" || look.form === "midi") {
        // VEHICLE-DETAIL: tek katlı şehir otobüsü / midibüs (Londra dışı hatlar): alt yan duvar + pencere bandı (açık: binen dışarıyı
        // görür) + üst şerit, pencere dikmeleri, geniş ön cam + ışıklı hedef tabelası, arka cam, sağ yanda iki cam kapı (sağdan
        // trafik), tavanda klima kutusu, tampon, ayna, far/stop, livre şeridi. Gövde çift katlının sınır kutusunda (D, X aynı).
        const midi = look.form === "midi", D = 0.5, L = midi ? 4.5 : 4.8, H = L / 2, X = 0.62, Ht = midi ? 1.5 : 1.7, top = ry + Ht;
        const F = D + H, R = D - H, b0 = ry + 0.7, b1 = top - 0.24, bY = (b0 + b1) / 2, bH = b1 - b0;
        box(0, ry + 0.05, D, 1.3, 0.1, L, "#2A2A2A");
        for (const sx of [-1, 1]) {
          box(sx * X, ry + 0.4, D, 0.06, 0.6, L, v.body);
          box(sx * X, top - 0.13, D, 0.06, 0.22, L, v.body);
          box(sx * (X + 0.005), bY, D, 0.03, bH, L - 0.2, v.glass, "glass");
          for (const z of midi ? [-0.6, 0.6] : [-1.2, 0, 1.2]) box(sx * X, bY, D + z, 0.07, bH, 0.07, v.body);
          box(sx * X, bY, F - 0.04, 0.07, bH, 0.08, v.body);
          fine(sx * (X + 0.04), ry + 0.6, D - 0.2, 0.02, 0.08, L - 1.4, v.trim);
          fine(sx * (X + 0.03), top - 0.32, F - 0.08, 0.06, 0.2, 0.05, look.dark);
        }
        box(0, ry + 0.4, F - 0.03, 1.3, 0.6, 0.06, v.body); box(0, top - 0.13, F - 0.03, 1.3, 0.22, 0.06, v.body);
        box(0, bY + 0.02, F - 0.02, 1.16, bH + 0.04, 0.03, v.glass, "glass");
        box(0, ry + Ht / 2 + 0.05, R + 0.03, 1.3, Ht - 0.1, 0.06, v.body);
        box(0, bY + 0.05, R - 0.005, 0.9, 0.4, 0.02, v.glass, "glass");
        box(0, top - 0.03, D, 1.3, 0.06, L, v.body);
        fine(0, top + 0.05, D - 0.3, 0.9, 0.1, midi ? 1.0 : 1.4, "#D4D8DC");
        for (const z of [-(H - 0.8), H - 0.8]) for (const x of [-0.6, 0.6]) box(x, ry + 0.05, D + z, 0.16, 0.4, 0.4, "#1F1F1F");
        fine(0, ry + 0.12, F + 0.01, 1.28, 0.12, 0.04, look.dark); fine(0, ry + 0.12, R - 0.01, 1.28, 0.12, 0.04, look.dark);
        for (const z of midi ? [F - 0.45] : [F - 0.45, D - 0.3]) box(-(X + 0.035), ry + 0.62, z, 0.02, 1.0, 0.5, v.glass, "glass");
        box(-0.42, ry + 0.35, F + 0.02, 0.18, 0.1, 0.03, HEAD, "glow"); box(0.42, ry + 0.35, F + 0.02, 0.18, 0.1, 0.03, HEAD, "glow");
        box(-0.5, ry + 0.35, R - 0.02, 0.12, 0.14, 0.03, TAIL, "glow"); box(0.5, ry + 0.35, R - 0.02, 0.12, 0.14, 0.03, TAIL, "glow");
        fine(0, top - 0.13, F + 0.01, 0.9, 0.1, 0.02, BOARD, "glow");
        break;
      }
      // iki katlı otobüs: şasi, alt ve üst kat gövdesi, iki kat cam bandı, ön/arka cam, tavan, tekerlekler, farlar (yazı/logo yok).
      // boy 4,8 × insan, yükseklik 2,36 (standart 4,5–6 / 2,3–2,6; boy/yükseklik 2,03 ≥ 1,8). Gövde yol noktasının 0,5
      // önünde (D): gerçek taşıt gibi arka akstan döner — köşede 90° dönüşte arka taşma 1,9'da kalır (Londra köşe lambası).
      const D = 0.5, L = 4.8, H = L / 2, X = 0.62, F = D + H, R = D - H;
      // CORE-CITYMAP: kabuk gövde — binen alt katın ortasında, boşta (döşeme + iki yan + ön/arka duvar); kat arası döşeme (söve
      // rengi kuşak), üst kat duvarları ve tavanı; iki yanda iki kat pencere bandı, ön/üst ön cam, arka açık sahanlık direği.
      box(0, ry + 0.05, D, 1.3, 0.1, L, "#2A2A2A");
      box(-X, ry + 0.6, D, 0.06, 1.0, L, v.body); box(X, ry + 0.6, D, 0.06, 1.0, L, v.body);
      box(0, ry + 0.6, F - 0.03, 1.3, 1.0, 0.06, v.body); box(0, ry + 0.45, R + 0.03, 1.3, 0.7, 0.06, v.body);
      box(0, ry + 1.18, D, 1.32, 0.12, L + 0.02, v.trim);
      box(-X, ry + 1.7, D, 0.06, 0.92, L - 0.1, v.body); box(X, ry + 1.7, D, 0.06, 0.92, L - 0.1, v.body);
      box(0, ry + 1.7, F - 0.08, 1.3, 0.92, 0.06, v.body); box(0, ry + 1.7, R + 0.08, 1.3, 0.92, 0.06, v.body);
      box(0, ry + 2.2, D, 1.3, 0.08, L - 0.1, "#9E2A23");
      box(-(X + 0.03), ry + 0.82, D + 0.1, 0.03, 0.4, L - 0.9, v.glass, "glass"); box(X + 0.03, ry + 0.82, D + 0.1, 0.03, 0.4, L - 0.9, v.glass, "glass");
      box(-(X + 0.03), ry + 1.78, D, 0.03, 0.42, L - 0.6, v.glass, "glass"); box(X + 0.03, ry + 1.78, D, 0.03, 0.42, L - 0.6, v.glass, "glass");
      box(0, ry + 0.85, F + 0.01, 1.0, 0.5, 0.03, v.glass, "glass"); box(0, ry + 1.78, F - 0.04, 1.0, 0.42, 0.03, v.glass, "glass");
      box(-0.5, ry + 0.55, R + 0.12, 0.05, 0.9, 0.05, "#C9CED4");
      for (const z of [-(H - 0.8), H - 0.8]) for (const x of [-0.6, 0.6]) box(x, ry + 0.05, D + z, 0.16, 0.4, 0.4, "#1F1F1F");
      box(-0.4, ry + 0.35, F + 0.02, 0.16, 0.1, 0.03, HEAD, "glow"); box(0.4, ry + 0.35, F + 0.02, 0.16, 0.1, 0.03, HEAD, "glow");
      // VEHICLE-DETAIL: iki stop lambası, ön tampon + ızgara, arka tampon, iki dikiz aynası, pencere dikmeleri (bant pencerelere
      // bölünür), sol yanda (soldan trafik: kaldırım yanı) ön ve orta cam kapı, üst kat arka camı, ön/arka ışıklı hedef tabelası
      box(-0.5, ry + 0.35, R - 0.02, 0.12, 0.14, 0.03, TAIL, "glow"); box(0.5, ry + 0.35, R - 0.02, 0.12, 0.14, 0.03, TAIL, "glow");
      fine(0, ry + 0.12, F + 0.01, 1.28, 0.12, 0.04, look.dark); fine(0, ry + 0.3, F + 0.01, 0.42, 0.16, 0.03, "#2B2F33");
      fine(0, ry + 0.12, R - 0.01, 1.28, 0.12, 0.04, look.dark);
      for (const sx of [-1, 1]) {
        fine(sx * (X + 0.03), ry + 1.0, F - 0.08, 0.06, 0.16, 0.05, look.dark);
        for (const z of [-0.55, 0.75]) fine(sx * (X + 0.05), ry + 0.82, D + z, 0.02, 0.44, 0.06, v.body);
        for (const z of [-0.7, 0.7]) fine(sx * (X + 0.05), ry + 1.78, D + z, 0.02, 0.46, 0.06, v.body);
      }
      for (const z of [F - 0.45, D - 0.2]) box(X + 0.045, ry + 0.6, z, 0.02, 0.9, 0.45, v.glass, "glass");
      box(0, ry + 1.78, R + 0.04, 1.0, 0.42, 0.03, v.glass, "glass");
      fine(0, ry + 1.18, F + 0.02, 0.8, 0.1, 0.03, BOARD, "glow"); fine(0, ry + 1.18, R - 0.02, 0.5, 0.1, 0.03, BOARD, "glow");
      break;
    }
    case "monoray": {
      // kiriş üstünde oturan gövde: alt etek (kirişi sarar), gövde, cam bant, yuvarlatılmış burun kademeleri, farlar
      // etek altından tavana 1,92 × insan, boy 4,4 (standart 1,8–2,2 × ≥ 4)
      box(0, ry - 0.18, 0, 0.9, 0.36, 3.9, v.trim);
      // CORE-CITYMAP: kabuk gövde (döşeme, iki yan, iki uç duvarı, tavan) — binen içi boş vagonda
      box(0, ry + 0.05, 0, 1.3, 0.1, 3.8, v.body);
      box(-0.62, ry + 0.75, 0, 0.06, 1.4, 3.8, v.body); box(0.62, ry + 0.75, 0, 0.06, 1.4, 3.8, v.body);
      box(0, ry + 0.75, 1.87, 1.3, 1.4, 0.06, v.body); box(0, ry + 0.75, -1.87, 1.3, 1.4, 0.06, v.body);
      box(0, ry + 1.47, 0, 1.3, 0.06, 3.8, v.body);
      box(0, ry + 1.52, 0, 1.2, 0.08, 3.7, "#C9CED4");
      box(0, ry + 0.65, 2.05, 1.1, 1.1, 0.3, v.body); box(0, ry + 0.9, 2.22, 0.9, 0.45, 0.04, v.glass, "glass");
      box(0, ry + 0.65, -2.05, 1.1, 1.1, 0.3, v.body);
      // VEHICLE-DETAIL: yanda iki kapı (kapı penceresiyle) ve kapılarla bölünen cam bant, livre şeridi, arka cam, iki far + iki
      // stop, ön/arka ışıklı hedef tabelası
      for (const sx of [-1, 1]) {
        for (const [z, d] of [[-1.375, 0.45], [0, 1.3], [1.375, 0.45]] as const) box(sx * 0.66, ry + 1.0, z, 0.03, 0.5, d, v.glass, "glass");
        for (const z of [-0.9, 0.9]) { box(sx * 0.655, ry + 0.75, z, 0.03, 1.3, 0.5, look.door); fine(sx * 0.672, ry + 1.0, z, 0.006, 0.45, 0.32, v.glass, "glass"); }
        fine(sx * 0.655, ry + 0.6, 0, 0.02, 0.1, 3.7, v.trim);
      }
      fine(0, ry + 0.9, -2.215, 0.8, 0.4, 0.04, v.glass, "glass");
      for (const sz of [-1, 1]) {
        box(-0.35, ry + 0.3, sz * 2.22, 0.18, 0.08, 0.03, sz > 0 ? HEAD : TAIL, "glow"); box(0.35, ry + 0.3, sz * 2.22, 0.18, 0.08, 0.03, sz > 0 ? HEAD : TAIL, "glow");
        fine(0, ry + 1.17, sz * 2.21, 0.6, 0.08, 0.03, BOARD, "glow");
      }
      break;
    }
    case "balon": {
      // hasır sepet (zemin + dört kenar), dört halat, brülör alevi; zarf: altta dar boğaz, yukarı genişleyip tepede daralan
      // sekizgen kademeler (kademe başına 2 kutu), şerit renkleri sırayla (yazı/logo yok)
      const y = ry;
      box(0, y - 0.05, 0, 1.1, 0.1, 1.1, v.trim);
      box(-0.53, y + 0.3, 0, 0.06, 0.6, 1.1, v.trim); box(0.53, y + 0.3, 0, 0.06, 0.6, 1.1, v.trim);
      box(0, y + 0.3, -0.53, 1.1, 0.6, 0.06, v.trim); box(0, y + 0.3, 0.53, 1.1, 0.6, 0.06, v.trim);
      // CORE-CITYMAP (REAL-SUPPORT): halatlar sepet kenarından zarfın ikinci kademesine; brülör zarfın ağzına asılı
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(sx * 0.49, y + 1.675, sz * 0.49, 0.04, 2.15, 0.04, "#4A3A2E");
      box(0, y + 2.0, 0, 0.3, 0.3, 0.3, "#3A3A3A");
      box(0, y + 2.1, 0, 0.16, 0.18, 0.16, "#FDBA74", "glow");
      const STRIPES = [v.body, v.glass, "#2F6D8C", v.body, v.glass, "#2F6D8C"];
      const R = [0.7, 1.4, 1.9, 1.95, 1.6, 1.0];
      R.forEach((r, k) => {
        const yy = y + 2.45 + k * 0.62, c = STRIPES[k];
        box(0, yy, 0, 2 * r, 0.64, 2 * r * 0.42, c); box(0, yy, 0, 2 * r * 0.42, 0.64, 2 * r, c);
      });
      box(0, y + 2.45 + 6 * 0.62 - 0.2, 0, 0.9, 0.22, 0.9, v.body);
      // VEHICLE-DETAIL: deri kaplı sepet ağzı (dört kenar), iki köşede yakıt tüpü, pilot alevi
      for (const s of [-1, 1]) { fine(s * 0.53, y + 0.62, 0, 0.1, 0.06, 1.14, "#5B3A22"); fine(0, y + 0.62, s * 0.53, 1.14, 0.06, 0.1, "#5B3A22"); }
      for (const sx of [-1, 1]) fine(sx * 0.36, y + 0.25, -0.36, 0.18, 0.4, 0.18, "#C9CED4");
      fine(0, y + 1.88, 0, 0.06, 0.06, 0.06, "#7DD3FC", "glow");
      break;
    }
    case "teleferik": {
      // içi boş kabin — döşeme, tavan, dört alt duvar, dört köşe dikmesi, dört yanda cam bant. Dış 1,51 × insan, iç
      // (döşeme üstü → tavan altı) 1,31 (standart dış 1,5–2,2, iç ≥ 1,3). Halat yüksekliği aynı (rideY + 2,2; tasarım halatı);
      // tavan ve askı halat bölgesinde (rideY + 1 üstü). <city> halatının kademeli kutuları dik kesimde kabinin ≈ 1,4'üne iner:
      // dikme ve cam 1,36'da biter.
      const W = 1.4, H = W / 2, y = ry, T = 1.51, R = T - 0.05;
      // CORE-CITYMAP: halat artık hattın kendisinde (citymap/cableway.ts; her asılı hatta kesintisiz halat + direk + istasyon);
      // kabin ona askı ve makara arabasıyla tutunur (halat arabanın içinden geçer)
      box(0, y + (R + 2.2) / 2, 0, 0.08, 2.2 - R, 0.08, "#3F3F46");
      // makara arabası ince (iki ölçüsü ≤ 0,12: ölçek denetiminde askı sayılır, kabin boyu 1,51 kalır)
      box(0, y + 2.22, 0, 0.1, 0.12, 0.56, "#3F3F46"); box(0, y + 2.32, 0, 0.12, 0.08, 0.3, "#2B2F33");
      box(0, y, 0, W, 0.1, W, v.trim);
      box(0, R - 0.05 + y, 0, W, 0.1, W, v.body);
      box(-(H - 0.03), y + 0.3, 0, 0.06, 0.5, W, v.body); box(H - 0.03, y + 0.3, 0, 0.06, 0.5, W, v.body);
      box(0, y + 0.3, H - 0.03, W - 0.12, 0.5, 0.06, v.body); box(0, y + 0.3, -(H - 0.03), W - 0.12, 0.5, 0.06, v.body);
      const gy = (0.55 + R - 0.1) / 2, gh = R - 0.1 - 0.55;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(sx * (H - 0.06), y + gy, sz * (H - 0.06), 0.12, gh, 0.12, v.body);
      box(-(H - 0.02), y + gy, 0, 0.03, gh, W - 0.24, v.glass, "glass"); box(H - 0.02, y + gy, 0, 0.03, gh, W - 0.24, v.glass, "glass");
      box(0, y + gy, H - 0.02, W - 0.24, gh, 0.03, v.glass, "glass"); box(0, y + gy, -(H - 0.02), W - 0.24, gh, 0.03, v.glass, "glass");
      box(0, y + R - 0.18, 0, 0.12, 0.06, 0.12, "#FFE7A3", "glow");
      // VEHICLE-DETAIL: iki yanda sürgülü kapı kanatlarının dikmeleri (cam düzleminde); tavan kapağı yok (<city> halat kademeleri
      // dik kesimde kabin tavanına iner)
      for (const sx of [-1, 1]) for (const z of [-0.3, 0.3]) fine(sx * (H - 0.005), y + gy, z, 0.01, gh, 0.04, look.dark);
      break;
    }
  }
  return out;
}
