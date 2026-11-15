/**
 * CORE-CITYMAP (kalite seferberliği 2026-10-28, kök neden N5) — asılı hatların (teleferik) ortak halat + direk + istasyon çizimi.
 *
 * Eskiden halat yalnız <city>'da (elle yazılmış `wire`) ve <city>'ta (yassı levhalar) vardı; <city>, <city> ve <city> teleferiği havada
 * süzülüyordu. Şimdi her asılı hat (`HANGING`) kendi yolculuk yolundan (transit/model.ts `travelPlan`: kabinin izlediği yol ve sürüş
 * yüksekliği profili `CityDesign.rides`) türetilir:
 * - **halat:** kabin tabanının `ROPE_Y` üstünde, yol boyunca kesintisiz kademeli ince parçalar (dikey adım ≤ 0,1; köşegen yolda kısa
 * parçalar). Kabin (araç modeli) halata makara arabasıyla tutunur;
 * - **direkler:** iki uç istasyon desteği ve arada en çok `MAX_SPAN` aralıkla direk (CITY-PASS-BCN: direk karosu yürünebilirse
 * yürünebilir kalır, direk ince çizilir — halat altındaki yol kesilmez). Direk eksen hizalı yana kaydırılır: kabin kutusu
 * (yön 90°'ye yuvarlanır, ±0,7) ile Chebyshev açıklığı ≥ `MAST_CLEAR`, halata ≤ `MAST_REACH` (kol direkten halatın üstüne uzanır).
 * Yol boyunca bütün noktalara açıklık sayısal doğrulanır (köşe yakınında direk yay boyunca kaydırılır). Direk tabanı zeminde (y 0;
 * yamaçta yükselti sütununun içinden çıkar); direk karosunun türü değişmez (yürünebilir karoda ince direk; district.ts);
 * - **istasyonlar:** her uçta halatın iki yanında dikme, halatın üstünde kiriş ve makara (bullwheel) gövdesi. Uçlar hattın 3 × 3
 * yanaşma halkasında (city_check CITY-MAP-TRANSIT-001 yanaşma).
 * Bloklar dünya koordinatında; district.ts semtin parsellerine konumlarına göre dağıtır (yalnız durağan `solid` grup, +0 çizim
 * çağrısı). Saf modül: React/three yok; aynı harita → aynı çıktı.
*/
import type { Block } from "../scenes";
import { travelPlan } from "../transit/model";
import type { CityLine, CityMapFile, VehicleKind } from "./format";

/** Asılı hatlar (halatlı). */
export const HANGING: ReadonlySet<VehicleKind> = new Set<VehicleKind>(["teleferik"]);
/** Halat: kabin tabanının (sürüş yüksekliği) üstünde (transit/model.ts teleferik askısı aynı yükseklikte). */
export const ROPE_Y = 2.2;
/** İki destek arası en büyük açıklık (birim; gerçekçilik kapısı CABLE_SPAN 12). */
export const MAX_SPAN = 11;
/** Direk merkezinin kabin yoluna Chebyshev uzaklığı: kabin yarı genişliği 0,7 + direk yarısı 0,15 + açıklık 0,2 ≤ uzaklık ≤ halata erişim. */
// 0,84 → 1,05 (kabin ile direk arası 0,12 → ≥ 0,2 boşluk: kabin direğe "giriyor" görünmez; scripts/ceo_eye_cable.mjs GAP)
export const MAST_CLEAR = 1.05;
export const MAST_REACH = 1.25;
const MAST_W = 0.3;
const STEEL = "#5B6068", STEEL_D = "#3F444B", ROPE = "#2B2F33", CONCRETE = "#B8B2A6", HOUSE = "#8F8B84";

export interface CableSupport {
  /** "station": uç istasyon dikmesi; "mast": ara direk */
  kind: "station" | "mast";
  /** direk merkezi (dünya) ve halat noktası */
  x: number; z: number; rx: number; rz: number;
  /** halat yüksekliği (direk hizasında) */
  ry: number;
}
export interface Cableway { line: string; rope: Block[]; supports: CableSupport[]; length: number }

type P3 = [number, number, number];
const cache = new Map<string, Cableway[]>();
/** Önbelleği boşalt (denetim). */
export function clearCablewayCache() { cache.clear(); }

/** Haritanın asılı hatları (önbellekli). */
export function cableways(map: CityMapFile): Cableway[] {
  const key = `${map.id}:${map.lines.map((l) => `${l.id}/${l.kind}/${l.stops.join(",")}`).join(";")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out: Cableway[] = [];
  for (const l of map.lines) if (HANGING.has(l.kind)) { const c = cablewayOf(map, l); if (c) out.push(c); }
  cache.set(key, out);
  return out;
}

/** Hattın halat yolu: kabinin bütün hat boyunca izlediği yol (ilk → son durak) ve halat yüksekliği. */
export function ropePath(map: CityMapFile, l: CityLine): P3[] | null {
  const plan = travelPlan(map, l.id, l.stops[0], l.stops[l.stops.length - 1]);
  if (!plan) return null;
  return plan.path.map(([x, z], k) => [x, plan.ys[k] + ROPE_Y, z] as P3);
}

function cablewayOf(map: CityMapFile, l: CityLine): Cableway | null {
  const path = ropePath(map, l);
  if (!path || path.length < 2) return null;
  const rope: Block[] = [];
  const seg: { a: P3; b: P3; len: number; s0: number }[] = [];
  let L = 0;
  for (let k = 0; k + 1 < path.length; k++) {
    const a = path[k], b = path[k + 1], len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    seg.push({ a, b, len, s0: L });
    L += len;
    // kademeli parçalar: dikey adım ≤ 0,1; eksene hizalı yolda ≤ 2,5 boy, köşegen yolda ≤ 0,4 (geniş levha olmasın)
    const diag = Math.min(Math.abs(b[0] - a[0]), Math.abs(b[2] - a[2])) > 0.05 * len;
    const n = Math.max(1, Math.ceil(len / (diag ? 0.4 : 2.5)), Math.ceil(Math.abs(b[1] - a[1]) / 0.1));
    for (let q = 0; q < n; q++) {
      const u0 = q / n, u1 = (q + 1) / n;
      const p0 = a.map((v, i) => v + (b[i] - v) * u0), p1 = a.map((v, i) => v + (b[i] - v) * u1);
      rope.push({ p: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2],
        s: [Math.abs(p1[0] - p0[0]) + 0.05, Math.abs(p1[1] - p0[1]) + 0.05, Math.abs(p1[2] - p0[2]) + 0.05], c: ROPE, g: "solid", j: 0 });
    }
  }
  // yol üstünde yay uzunluğu → nokta ve yön
  const at = (s: number) => {
    const t = seg.find((q) => s <= q.s0 + q.len + 1e-9) ?? seg[seg.length - 1];
    const u = t.len ? Math.max(0, Math.min(1, (s - t.s0) / t.len)) : 0;
    return { p: t.a.map((v, i) => v + (t.b[i] - v) * u) as P3, ux: (t.b[0] - t.a[0]) / (t.len || 1), uz: (t.b[2] - t.a[2]) / (t.len || 1) };
  };
  // kabin yolunun yoğun örneği (Chebyshev açıklık doğrulaması)
  const samples: [number, number][] = [];
  for (let s = 0; s <= L + 1e-9; s += 0.05) { const q = at(Math.min(s, L)).p; samples.push([q[0], q[2]]); }
  const cheb = (x: number, z: number) => samples.reduce((m, [px, pz]) => Math.min(m, Math.max(Math.abs(x - px), Math.abs(z - pz))), Infinity);
  /** yay `s` çevresinde (± kaydırma) eksen hizalı yana kaydırılmış geçerli direk yeri */
  const place = (s: number, kind: CableSupport["kind"], lo: number, hi: number, side?: 1 | -1): CableSupport | null => {
    for (const ds of [0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1, -1, 1.5, -1.5, 2, -2]) {
      const sa = Math.max(lo, Math.min(hi, s + ds)), { p, ux, uz } = at(sa);
      // yan eksen: yola en dik eksen; kaydırma = istenen Chebyshev × (|ux| + |uz|) / |yan bileşen|
      const alongZ = Math.abs(uz) >= Math.abs(ux);
      const perp = alongZ ? Math.abs(uz) : Math.abs(ux);
      const d = ((MAST_CLEAR + MAST_REACH) / 2) * (Math.abs(ux) + Math.abs(uz)) / Math.max(0.3, perp);
      for (const sg of side ? [side] : ([1, -1] as const)) {
        const x = alongZ ? p[0] + sg * d : p[0], z = alongZ ? p[2] : p[2] + sg * d;
        const c = cheb(x, z);
        if (c >= MAST_CLEAR && c <= MAST_REACH) return { kind, x, z, rx: p[0], rz: p[2], ry: p[1] };
      }
    }
    return null;
  };
  const supports: CableSupport[] = [];
  const e = Math.min(0.6, L / 4);
  for (const [s, lo, hi] of [[e, 0.1, 1.4], [L - e, L - 1.4, L - 0.1]] as const) for (const sg of [1, -1] as const) {
    const st = place(s, "station", lo, hi, sg);
    if (st) supports.push(st);
  }
  const n = Math.max(1, Math.ceil((L - 2 * e) / MAX_SPAN));
  for (let k = 1; k < n; k++) {
    const s = e + ((L - 2 * e) * k) / n, m = place(s, "mast", s - 2.5, s + 2.5);
    if (m) supports.push(m);
  }
  return { line: l.id, rope, supports, length: L };
}

/** Desteğin blokları; `ground` direk karosunun zemin üstü (yükselti sütunu dahil; su: −0,25). Direk tabanı y ≤ 0 (gövde zeminden).
 *  `narrow` (CITY-PASS-BCN): direk yürünebilir karoda (yol, meydan, rampa) — karo katılaşmaz; temel zemine gömülü ince plaka, gövde
 *  ince (yanından avatar geçer; walk fiziği ince çarpıştırıcı). */
export function supportBlocks(s: CableSupport, ground: number, narrow = false): Block[] {
  const out: Block[] = [];
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, j = 0) => out.push({ p: [x, y, z], s: [w, h, d], c, g: "solid", j });
  const top = s.ry + 0.42, base = Math.min(0, ground), g0 = Math.max(0, ground);
  const ax = Math.abs(s.x - s.rx) > Math.abs(s.z - s.rz); // kol x boyunca mı
  // temel (zemin üstünde), alt gövde (kalın), üst gövde (ince), kol (direkten halatın üstüne), makara pabucu
  if (narrow) box(s.x, g0 + 0.02, s.z, 0.4, 0.04, 0.4, CONCRETE, 0.02);
  else box(s.x, g0 + 0.12, s.z, 0.62, 0.24, 0.62, CONCRETE, 0.03);
  // tek parça gövde zeminden kolun üstüne (taşıyıcı); alt yarıda kalın kılıf (kafes ayağı görünümü; dar direkte yok)
  const mid = base + (top - base) * 0.5, col = s.kind === "station" ? STEEL_D : STEEL, mw = narrow ? 0.2 : MAST_W - 0.06;
  box(s.x, (base + top) / 2, s.z, mw, top - base, mw, col, 0.02);
  if (!narrow) box(s.x, (g0 + mid) / 2, s.z, MAST_W, mid - g0, MAST_W, col, 0.02);
  const armL = Math.abs(ax ? s.x - s.rx : s.z - s.rz) + 0.3;
  box(ax ? (s.x + s.rx) / 2 : s.x, s.ry + 0.34, ax ? s.z : (s.z + s.rz) / 2, ax ? armL : 0.16, 0.14, ax ? 0.16 : armL, STEEL_D, 0);
  // kaldırıma alınan direkte kol ucu halattan yana kayar → kısa çapraz kol makaraya bağlar
  const off = ax ? s.rz - s.z : s.rx - s.x;
  if (Math.abs(off) > 0.02) box(ax ? s.rx : (s.x + s.rx) / 2, s.ry + 0.34, ax ? (s.z + s.rz) / 2 : s.rz, ax ? 0.16 : Math.abs(off) + 0.16, 0.14, ax ? Math.abs(off) + 0.16 : 0.16, STEEL_D, 0);
  // makara pabucu: halatın üstüne oturur, kola değer (halat kümesi desteğe bağlı)
  box(s.rx, s.ry + 0.15, s.rz, 0.22, 0.26, 0.22, STEEL_D, 0);
  return out;
}

/** Uç istasyonun makara gövdesi (halatın ucunda, üstte; iki dikmenin arasına oturur). */
export function stationHouse(rx: number, ry: number, rz: number): Block[] {
  return [
    { p: [rx, ry + 0.66, rz], s: [1.5, 0.5, 1.5], c: HOUSE, g: "solid", j: 0.02 },
    { p: [rx, ry + 0.96, rz], s: [1.7, 0.1, 1.7], c: STEEL_D, g: "solid", j: 0 },
  ];
}
