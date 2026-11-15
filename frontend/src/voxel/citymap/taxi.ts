/**
 * WORLD-PANO — şehir haritasında ortam taksileri (genel gövde renkleri). Yalnız süs: binilmez, çarpışmaz,
 * ajan/avatar yolunu değiştirmez.
 *
 * - **Yalnız sokak koridoru:** taksi döngüleri semt planının `T_STREET` karolarından (yükseltisiz, zemin üstü 0) ve hiçbir
 * yakın bloğun (su hariç) taksi yüksekliğinin altına uzanmadığı karolardan kurulur (lamba direği, süs, landmark modeli, komşu
 * semtin taşan blokları dahil). Döngü, çevresinin tamamı sürülebilir olan dikdörtgendir (kenarlar ≥ 5 karo; büyük çevre
 * önce); semt başına en çok 2 çakışmasız döngü, döngü başına 2 taksi (ters faz).
 * - **Gerçek boy (lider kararı K8):** gövde 2 karo (2,1 × insan) uzun, 0,95 eninde, 0,81 yüksekliğinde (standart araba:
 * 0,8–0,95 × 2,0–2,6 × 0,9–1,1). Eskiden 0,98 × 0,62 × 0,72 "oyuncak" taksiydi.
 * - **Bina kesmez:** gövde karo genişliğinin içindedir; yön eksen hizalıdır. 2 karoluk gövde düz kenarda döngünün ardışık
 * karolarının içindedir. Köşede taksi, burnu köşe karosunun dış kenarına değince durur (`TAXI_HOLD`), yerinde 90°
 * döner — yeni yönde arkası köşe karosunun iç kenarında — ve sürer: gövde köşenin dışındaki karoya hiç taşmaz, döngüler
 * eskisiyle aynıdır (kesişen sokak yokken de). `scripts/city_check.mjs` CITY-MAP-TRANSIT-001
 * bunu bütün döngülerde 0,2 adımla ölçer (yakın bloklar + arazi yüksekliği; muaf yok).
 * - **Örneklenmiş, tavanlı:** avatarın çevresindeki (yüklü parsellerdeki) en yakın `TAXI_MAX` taksi, kapasite kuyruğunun
 * araç bölgesinden sonraki `TAXI_SLOT` aralığına yazılır (CityRig) → **+0 çizim çağrısı** (yeni mesh/malzeme yok).
 * - **Hareket azaltma:** saat ilerlemez (`taxiClock`), taksiler park etmiş gibi durur.
 *
 * Logo, yazı, şirket livresi yok: genel gövde rengi + tepe lambası. Saf modül (React/three yok), belirlenimci.
*/
import type { Block, Group } from "../scenes";
import { cityX, cityZ } from "../transit/model";
import { RIDE_SPEED_FACTOR } from "../transit/speedFactor";
import { dezfightBlocks } from "../zfight";
import { CITY_PD, CITY_PW, type CityDistrict, type CityMapFile, type CityTile } from "./format";
import { districtParcel, districtPlan, T_STREET } from "./district";
import { NEW_CITIES } from "../cities/index";
import { FULL_TAXI_STYLES } from "../../full/taxi";

export interface TaxiStyle { bodies: readonly string[]; cabin: string; sign: string; wheel: string }
/** Taksili şehirler. Renkler genel (işletme livresi değil). */
export const TAXI_STYLES: Readonly<Record<string, TaxiStyle>> = {
  ...FULL_TAXI_STYLES,
  ...Object.fromEntries(NEW_CITIES.flatMap((m) => (m.taxi ? [[m.catalog.id, m.taxi] as const] : []))), // (yeni araç türü yok, O12)
};
/** Aynı anda çizilen en çok taksi. */
export const TAXI_MAX = 6;
/** karo / sn */
export const TAXI_SPEED = 2.2 * RIDE_SPEED_FACTOR;
/** Taksi başına grup blokları: gövde + kabin + 2 tekerlek + tampon kuşağı (solid), tepe lambası + 2 far + 2 stop (glow). */
const PER_TAXI: Readonly<Record<"solid" | "water" | "glass" | "glow", number>> = { solid: 5, water: 0, glass: 0, glow: 5 };
/** Kapasite kuyruğunda taksi bölgesi (CityRig: `layoutEnd + VEHICLE_SLOT` sonrası; CITY-MAP-BUDGET-001 `TAIL_CAP` içinde). */
export const TAXI_SLOT: Readonly<Record<"solid" | "water" | "glass" | "glow", number>> = {
  solid: PER_TAXI.solid * TAXI_MAX, water: 0, glass: 0, glow: PER_TAXI.glow * TAXI_MAX,
};
/** Taksi yüksekliği (tepe lambası dahil) ve engel payı: bu yüksekliğin altına inen blok karoyu kapatır. */
export const TAXI_TOP = 0.86;
/** pay 0,12 → 0,08 (lamba 0,86'da; 0,94 altına inen blok karoyu kapatır — eski 0,72 + 0,12 = 0,84 ile aynı döngüler)*/
const CLEAR_TOP = TAXI_TOP + 0.08;
/** Yürünebilir zemin bloklarının üstü (sokak döşemesi 0, ray çizgisi 0,04) bunun altında kalır. */
const GROUND_EPS = 0.06;
/** Karo kenarına değen bloklar (bina gövdesi karonun kenarında biter) sayılmaz. */
const EDGE_EPS = 0.04;

/**
 * Taksinin yerel kutuları (ileri +z; boy 2,1 ≈ 2 karo, en 0,95 < 1 karo, kabin tepesi 0,81, lamba 0,86). VEHICLE-DETAIL:
 * gövde 2,04'e kısalır, önünde ve arkasında koyu tampon kuşağı (2,1; yanda sürtünme şeridi) görünür; iki far ve iki stop lambası
 * (gece yanar). Sınır kutusu aynı (köşe bekleme ölçüsü `TAXI_HOLD` değişmez).
*/
/** RENDER-FIX (REAL-ZFIGHT-001): çizilen taksi — tekerlek/gövde/kuşak yan yüzleri aynı düzlemdeydi (renk titreşimi); `zfight.ts` çözümü. */
export const taxiLocal = (style: TaxiStyle, body: number): Block[] => dezfightBlocks(taxiLocalRaw(style, body));
export function taxiLocalRaw(style: TaxiStyle, body: number): Block[] {
  const c = style.bodies[body % style.bodies.length];
  const b = (x: number, y: number, z: number, w: number, h: number, d: number, col: string, g: Group = "solid"): Block => ({ p: [x, y, z], s: [w, h, d], c: col, g, j: 0 });
  return [
    b(0, 0.31, 0, 0.95, 0.34, 2.04, c),
    b(0, 0.645, -0.12, 0.82, 0.33, 1.05, style.cabin),
    b(0, 0.13, 0.66, 0.95, 0.26, 0.38, style.wheel),
    b(0, 0.13, -0.66, 0.95, 0.26, 0.38, style.wheel),
    b(0, 0.22, 0, 0.93, 0.08, 2.1, "#2B2F33"),
    b(0, 0.835, -0.12, 0.24, 0.05, 0.12, style.sign, "glow"),
    b(-0.32, 0.38, 1.025, 0.16, 0.07, 0.03, "#FFE7A3", "glow"), b(0.32, 0.38, 1.025, 0.16, 0.07, 0.03, "#FFE7A3", "glow"),
    b(-0.34, 0.38, -1.025, 0.12, 0.08, 0.03, "#F87171", "glow"), b(0.34, 0.38, -1.025, 0.12, 0.08, 0.03, "#F87171", "glow"),
  ];
}

/** Yerel → dünya (yön eksen hizalı: dx, dz ∈ {−1, 0, 1}). */
export function taxiWorld(local: readonly Block[], x: number, z: number, dx: number, dz: number): Block[] {
  return local.map((b) => {
    const [lx, ly, lz] = b.p, [w, h, d] = b.s;
    // ileri (lz) → (dx, dz); yan (lx) → (dz, −dx)
    const p: [number, number, number] = [x + lz * dx + lx * dz, ly, z + lz * dz - lx * dx];
    const s: [number, number, number] = dx !== 0 ? [d, h, w] : [w, h, d];
    return { ...b, p, s };
  });
}

export interface TaxiLoop { district: string; tiles: CityTile[]; dir: 1 | -1 }
export interface TaxiPose { x: number; z: number; dx: number; dz: number; tile: CityTile }

/** köşede bekleme payı (karo) = yarı boy − yarım karo: gövde köşe karosunun dışına taşmasın diye merkez köşeye bu kadar
 * yaklaşır, sonra yerinde döner (dönüş öncesi ve sonrası bu yay boyunca bekler: kavşakta duraklayan taksi).*/
export const TAXI_HOLD = 0.55;

/** Döngüde yay uzunluğu `s` (karo) noktasındaki poz (döngü kapalı; ardışık karolar komşu). Köşe karosunun `TAXI_HOLD` yakınında
 *  merkez köşeden o kadar uzakta bekler (gelen yönde önce, giden yönde sonra). */
export function taxiPose(loop: TaxiLoop, s: number, out?: TaxiPose): TaxiPose {
  const n = loop.tiles.length;
  const u = ((s % n) + n) % n;
  const k = Math.floor(u);
  let f = u - k;
  const a = loop.tiles[k], b = loop.tiles[(k + 1) % n];
  const dx = Math.sign(b[0] - a[0]), dz = Math.sign(b[1] - a[1]);
  const turnAt = (t: number) => { const p = loop.tiles[(t - 1 + n) % n], q = loop.tiles[t], r = loop.tiles[(t + 1) % n]; return q[0] - p[0] !== r[0] - q[0] || q[1] - p[1] !== r[1] - q[1]; };
  if (turnAt(k)) f = Math.max(f, TAXI_HOLD);
  if (turnAt((k + 1) % n)) f = Math.min(f, 1 - TAXI_HOLD);
  const x = cityX(a[0] + (b[0] - a[0]) * f), z = cityZ(a[1] + (b[1] - a[1]) * f);
  if (!out) return { x, z, dx, dz, tile: a };
  out.x = x; out.z = z; out.dx = dx; out.dz = dz; out.tile = a;
  return out;
}

/** Hareket azaltmada saat durur (taksiler park eder). */
export const taxiClock = (t: number, dt: number, reduced: boolean) => (reduced ? t : t + dt);

/** Yolu kapatan karolar (semt yerel dizini): yakın bloklar (bu semtin ve sınırına 2 karo yakın komşuların). */
function blockedTiles(map: CityMapFile, dist: CityDistrict): Uint8Array {
  const [i0, j0, w, d] = dist.bounds;
  const out = new Uint8Array(w * d);
  for (const other of map.districts) {
    const [a0, b0, aw, bd] = other.bounds;
    if (a0 > i0 + w + 2 || a0 + aw < i0 - 2 || b0 > j0 + d + 2 || b0 + bd < j0 - 2) continue;
    for (let cz = b0 / CITY_PD; cz < (b0 + bd) / CITY_PD; cz++) for (let cx = a0 / CITY_PW; cx < (a0 + aw) / CITY_PW; cx++) {
      const p = districtParcel(map, other, cx, cz);
      if (!p) continue;
      for (const b of p.near.blocks) {
        if (b.g === "water") continue;
        const top = b.p[1] + b.s[1] / 2, bot = b.p[1] - b.s[1] / 2;
        if (top <= GROUND_EPS || bot >= CLEAR_TOP) continue;
        // dünya → şehir karosu (karo I: x ∈ [I − 12, I − 11])
        const x0 = b.p[0] - b.s[0] / 2 + 12 + EDGE_EPS, x1 = b.p[0] + b.s[0] / 2 + 12 - EDGE_EPS;
        const z0 = b.p[2] - b.s[2] / 2 + 8 + EDGE_EPS, z1 = b.p[2] + b.s[2] / 2 + 8 - EDGE_EPS;
        for (let J = Math.floor(z0); J <= Math.floor(z1); J++) for (let I = Math.floor(x0); I <= Math.floor(x1); I++) {
          const li = I - i0, lj = J - j0;
          if (li >= 0 && lj >= 0 && li < w && lj < d) out[lj * w + li] = 1;
        }
      }
    }
  }
  return out;
}

const loopCache = new Map<string, TaxiLoop[]>();
let loopByDist = new WeakMap<CityDistrict, TaxiLoop[]>();
/** Denetim için önbelleği boşaltır. */
export function clearTaxiCache() { loopCache.clear(); loopByDist = new WeakMap(); }

/** Semtin taksi döngüleri (önbellekli; taksisiz şehirde boş). */
export function taxiLoops(map: CityMapFile, dist: CityDistrict): TaxiLoop[] {
  if (!TAXI_STYLES[map.id]) return [];
  const wk = loopByDist.get(dist); // kare başına çağrılır — anahtar dizesi kurulmadan
  if (wk) return wk;
  const ck = `${map.id}:${dist.id}:${dist.seed}`;
  const hit = loopCache.get(ck);
  if (hit) { loopByDist.set(dist, hit); return hit; }
  const plan = districtPlan(map, dist);
  const { w, d } = plan;
  const blocked = blockedTiles(map, dist);
  const drive = (li: number, lj: number) => {
    if (li < 0 || lj < 0 || li >= w || lj >= d) return false;
    const k = lj * w + li;
    return plan.kind[k] === T_STREET && !(plan.lift[k] > 0.001) && !(Math.abs(plan.top[k]) > 0.001) && !blocked[k];
  };
  // önek toplamları: satır/sütun parçasının tümü sürülebilir mi (O(1)); aday çizgiler en az 6 sürülebilir karosu olanlar
  const rowSum = new Int32Array((w + 1) * d), colSum = new Int32Array((d + 1) * w);
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) rowSum[j * (w + 1) + i + 1] = rowSum[j * (w + 1) + i] + (drive(i, j) ? 1 : 0);
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) colSum[i * (d + 1) + j + 1] = colSum[i * (d + 1) + j] + (drive(i, j) ? 1 : 0);
  const rowOk = (j: number, a0: number, a1: number) => rowSum[j * (w + 1) + a1 + 1] - rowSum[j * (w + 1) + a0] === a1 - a0 + 1;
  const colOk = (i: number, b0: number, b1: number) => colSum[i * (d + 1) + b1 + 1] - colSum[i * (d + 1) + b0] === b1 - b0 + 1;
  const cols = Array.from({ length: w }, (_, i) => i).filter((i) => colSum[i * (d + 1) + d] >= 6);
  const rows = Array.from({ length: d }, (_, j) => j).filter((j) => rowSum[j * (w + 1) + w] >= 6);
  const cands: { a: number; b: number; c: number; e: number; per: number }[] = [];
  for (let x = 0; x < cols.length; x++) for (let y = x + 1; y < cols.length; y++) {
    const a = cols[x], b = cols[y];
    if (b - a < 5) continue;
    for (let p = 0; p < rows.length; p++) for (let q = p + 1; q < rows.length; q++) {
      const c = rows[p], e = rows[q];
      if (e - c < 5) continue;
      if (rowOk(c, a, b) && rowOk(e, a, b) && colOk(a, c, e) && colOk(b, c, e)) cands.push({ a, b, c, e, per: 2 * (b - a + e - c) });
    }
  }
  // büyük çevreden küçüğe; karo paylaşmayan en çok 2 döngü
  cands.sort((p, q) => q.per - p.per || p.a - q.a || p.c - q.c);
  const used = new Set<string>(), out: TaxiLoop[] = [];
  for (const r of cands) {
    if (out.length >= 2) break;
    const tiles: CityTile[] = [];
    for (let i = r.a; i < r.b; i++) tiles.push([i, r.c]);
    for (let j = r.c; j < r.e; j++) tiles.push([r.b, j]);
    for (let i = r.b; i > r.a; i--) tiles.push([i, r.e]);
    for (let j = r.e; j > r.c; j--) tiles.push([r.a, j]);
    if (tiles.some(([i, j]) => used.has(`${i},${j}`))) continue;
    for (const [i, j] of tiles) used.add(`${i},${j}`);
    const dir: 1 | -1 = out.length % 2 ? -1 : 1;
    const city = tiles.map(([i, j]) => [plan.i0 + i, plan.j0 + j] as CityTile);
    out.push({ district: dist.id, tiles: dir === 1 ? city : city.reverse(), dir });
  }
  if (loopCache.size > 32) loopCache.clear();
  loopCache.set(ck, out);
  loopByDist.set(dist, out);
  return out;
}

/** `sig`: çizilen taksi pozlarının sayısal özeti (değişmezse — hareket azaltma — kuyruk yeniden yazılmaz). */
export interface TaxiFrame { lists: Record<"solid" | "water" | "glass" | "glow", Block[]>; count: number; sig: number }

/** taksinin yerel kutuları stil + gövde başına bir kez (`taxiLocal` z-fighting çözümü her kare yeniden koşuyordu).*/
const localCache = new WeakMap<TaxiStyle, Block[][]>();
function localOf(style: TaxiStyle, body: number): Block[] {
  let a = localCache.get(style);
  if (!a) { a = []; localCache.set(style, a); }
  return (a[body] ??= taxiLocal(style, body));
}
/** kare çıktısı yerinde yazılır (kalıcı diziler, blok ve aday havuzu) — çağıran aynı karede tüketir, saklamaz.*/
const FRAME: TaxiFrame = { lists: { solid: [], water: [], glass: [], glow: [] }, count: 0, sig: 0 };
const blockPool: Block[] = [];
interface Near { d2: number; pose: TaxiPose; body: number }
const nearPool: Near[] = [];
const nearList: Near[] = [];
const byDist = (a: Near, b: Near) => a.d2 - b.d2;

/**
 * O anki taksiler (dünya blokları): avatarın (ax, az) çevresindeki semtlerin döngülerinden, `loaded(cx, cz)` parseli yüklü olan en
 * yakın `TAXI_MAX` taksi. `ready(d)` false dönen semt (döngüsü henüz hesaplanmamış) atlanır. `t`: saniye (taxiClock).
 * dönüş paylaşılan kare nesnesidir (sonraki çağrı üzerine yazar); bloklar `taxiWorld` ile aynı değerler.
*/
export function taxiFrame(map: CityMapFile, ax: number, az: number, t: number, loaded: (cx: number, cz: number) => boolean,
  ready: (d: CityDistrict) => boolean = () => true): TaxiFrame {
  const lists = FRAME.lists;
  lists.solid.length = 0; lists.water.length = 0; lists.glass.length = 0; lists.glow.length = 0;
  FRAME.count = 0; FRAME.sig = 0;
  const style = TAXI_STYLES[map.id];
  if (!style) return FRAME;
  const I = ax + 12, J = az + 8;
  nearList.length = 0;
  for (const dist of map.districts) {
    const [i0, j0, w, d] = dist.bounds;
    if (I < i0 - 30 || I > i0 + w + 30 || J < j0 - 30 || J > j0 + d + 30 || !ready(dist)) continue;
    const loops = taxiLoops(map, dist);
    for (let li = 0; li < loops.length; li++) {
      const loop = loops[li], n = loop.tiles.length;
      for (let k = 0; k < 2; k++) {
        const e = nearPool[nearList.length] ??= { d2: 0, pose: { x: 0, z: 0, dx: 0, dz: 0, tile: loop.tiles[0] }, body: 0 };
        const pose = taxiPose(loop, t * TAXI_SPEED + (k * n) / 2 + li * 7, e.pose);
        const tI = Math.floor(pose.x + 12), tJ = Math.floor(pose.z + 8);
        if (!loaded(Math.floor(tI / CITY_PW), Math.floor(tJ / CITY_PD))) continue;
        const dx = pose.x - ax, dz = pose.z - az;
        if (Math.abs(dx) > 24 || Math.abs(dz) > 30) continue;
        e.d2 = dx * dx + dz * dz; e.body = li * 2 + k;
        nearList.push(e);
      }
    }
  }
  nearList.sort(byDist);
  const count = Math.min(TAXI_MAX, nearList.length);
  let used = 0, sig = count;
  for (let q = 0; q < count; q++) {
    const { pose: { x, z, dx, dz }, body } = nearList[q];
    sig = (sig * 31 + Math.round(x * 100)) | 0; sig = (sig * 31 + Math.round(z * 100)) | 0; sig = (sig * 31 + body) | 0;
    // taxiWorld ile aynı dönüşüm: ileri (lz) → (dx, dz); yan (lx) → (dz, −dx)
    for (const b of localOf(style, body)) {
      // taksi kutuları yalnız p, s, c, g, j taşır (taxiLocalRaw)
      const o = blockPool[used++] ??= { p: [0, 0, 0], s: [0, 0, 0], c: "", g: "solid", j: 0 };
      const [lx, ly, lz] = b.p, [bw, bh, bd] = b.s;
      o.c = b.c; o.g = b.g; o.j = b.j;
      o.p[0] = x + lz * dx + lx * dz; o.p[1] = ly; o.p[2] = z + lz * dz - lx * dx;
      if (dx !== 0) { o.s[0] = bd; o.s[1] = bh; o.s[2] = bw; } else { o.s[0] = bw; o.s[1] = bh; o.s[2] = bd; }
      lists[o.g as "solid" | "glow"].push(o);
    }
  }
  FRAME.count = count; FRAME.sig = sig;
  return FRAME;
}
