/**
 * ortak yapı parçaları: kanal evi sırası, dükkân-ev sırası, avlulu ev, kiremit çatılı salon, kademeli çatı, kule.
 * Saf; bir `Sink`'e yazar, tepe y'sini döndürür. Kat/kapı/pencere ölçüleri `core.ts STD` (scaleStandard); simge kule tepesi
 * `landmarkTop`. Cephe +z; sol-arka köşe (x0, z0) ya da merkez (x, z) dünya koordinatıdır. Yazı, tabela, logo, arma yok.
*/
import { cyc, landmarkTop, nClamp, STD, storeyH, type Height, type Sink } from "./core";
import { NEUTRAL } from "../tokens";

const DARK = "#3A2E26";

export interface GableRowOpts {
  x0: number; z0: number;
  /** ev sayısı (1–6) */
  n?: number;
  /** ev eni (0,8–2; varsayılan 1: dar kanal evi) */
  w?: number;
  /** derinlik (varsayılan 2) */
  d?: number;
  /** kat (2–5; varsayılan 4) */
  storeys?: number;
  storey?: number;
  walls?: readonly string[];
  trim?: string; window?: string; door?: string;
}
/**
 * `gableRow` — dar kanal evi sırası (<city>): her ev gövde + üç kademeli tepelik + vinç kirişi + kat başına pencere +
 * zemin kat kapısı + saçak çizgisi. Kat `storeyH` (1,6–2,0), kapı `STD.door`, pencere `STD.window` + `STD.sill`.
 * Kutu: n × (6 + kat) ≤ 66. Tepe: kat × H + 1,2 (tepelik).
*/
export function gableRow(b: Sink, o: GableRowOpts): number {
  const n = nClamp(o.n ?? 4, 1, 6), st = nClamp(o.storeys ?? 4, 2, 5), H = storeyH(o.storey);
  const w = Math.min(2, Math.max(0.8, o.w ?? 1)), d = o.d ?? 2, walls = o.walls ?? ["#8E4A3A", "#5E6B57", "#C9B79A", "#7A8C9C"];
  const trim = o.trim ?? "#F2EFE8", win = o.window ?? "#22303C", door = o.door ?? "#2E3A2E";
  const zc = o.z0 + d / 2, zf = o.z0 + d, h = st * H;
  let top = 0;
  for (let k = 0; k < n; k++) {
    const x = o.x0 + (k + 0.5) * w, wall = cyc(walls, k);
    b(x, h / 2, zc, w - 0.04, h, d, wall, "solid", 0.03);
    // tepelik (üç kademe, ön yüze yaslı) ve vinç kirişi
    let y = h;
    for (const [f, th] of [[0.8, 0.5], [0.55, 0.4], [0.3, 0.3]] as const) { b(x, y + th / 2, zf - 0.3, w * f, th, 0.6, wall, "solid", 0.03); y += th; }
    top = Math.max(top, y);
    b(x, y - 0.2, zf + 0.12, 0.08, 0.08, 0.3, DARK, "solid", 0);
    b(x, h, zf + 0.02, w, 0.1, 0.06, trim, "solid", 0.02);
    b(x, STD.door / 2, zf + 0.02, Math.min(STD.doorWidth, w * 0.6), STD.door, 0.05, door, "solid", 0.02);
    for (let f = 1; f < st; f++) b(x, f * H + STD.sill + STD.window / 2, zf + 0.02, w * 0.5, STD.window, 0.05, win, "solid", 0.02);
  }
  return top;
}

export interface ShophouseRowOpts {
  x0: number; z0: number;
  /** birim (1–8) */
  n?: number;
  /** birim eni (1,5–3; varsayılan 2) */
  w?: number;
  d?: number;
  /** kat (2–3) */
  storeys?: number;
  storey?: number;
  /** zemin kat revak (beş ayaklık yol) derinliği (0,6–1,2) */
  arcade?: number;
  walls?: readonly string[];
  shutter?: string; pillar?: string; roof?: string; shop?: string;
}
/**
 * `shophouseRow` — dükkân-ev sırası (<city>, Hanoi): zemin katta geri çekilmiş dükkân + üstte öne taşan katlar (altı
 * yürünür revak; serbest yükseklik = kat ≥ kapı), kat başına iki pancurlu pencere, kiremit saçak, birim arası sütun.
 * Tabela/yazı yok. Kutu: n × (3 + 2·kat) + 1 ≤ 73. Tepe: kat × H + 0,3.
*/
export function shophouseRow(b: Sink, o: ShophouseRowOpts): number {
  const n = nClamp(o.n ?? 4, 1, 8), st = nClamp(o.storeys ?? 2, 2, 3), H = storeyH(o.storey);
  const w = Math.min(3, Math.max(1.5, o.w ?? 2)), d = o.d ?? 3, arc = Math.min(1.2, Math.max(0.6, o.arcade ?? 0.9));
  const walls = o.walls ?? ["#E6D2A8", "#9FC2B0", "#E3B79A", "#B7C7D9"], shutter = o.shutter ?? "#3E6A5A";
  const pillar = o.pillar ?? "#F7F2E6", roof = o.roof ?? NEUTRAL.tile, shop = o.shop ?? "#5A3622";
  const zf = o.z0 + d, top = st * H;
  for (let k = 0; k < n; k++) {
    const x = o.x0 + (k + 0.5) * w, wall = cyc(walls, k);
    b(x, (H + top) / 2, o.z0 + d / 2, w - 0.02, top - H, d, wall, "solid", 0.03);
    b(x, H / 2, o.z0 + (d - arc) / 2, w - 0.02, H, d - arc, wall, "solid", 0.03);
    b(x, STD.door / 2, zf - arc + 0.02, w * 0.6, STD.door, 0.04, shop, "solid", 0.02);
    for (let f = 1; f < st; f++) for (const s of [-1, 1]) b(x + s * w * 0.22, f * H + STD.sill + STD.window / 2, zf + 0.02, w * 0.3, STD.window, 0.05, shutter, "solid", 0.02);
    b(x, top + 0.15, o.z0 + d / 2 + 0.1, w + 0.02, 0.3, d + 0.3, roof, "solid", 0.04);
    b(o.x0 + k * w + 0.1, H / 2, zf - 0.12, 0.2, H, 0.2, pillar, "solid", 0.02);
  }
  b(o.x0 + n * w - 0.1, H / 2, zf - 0.12, 0.2, H, 0.2, pillar, "solid", 0.02);
  return top + 0.3;
}

export interface RiadCourtOpts {
  x: number; z: number;
  /** dış ölçü (5–10) */
  w?: number; d?: number;
  /** kat (1–3; varsayılan 2) */
  storeys?: number;
  storey?: number;
  /** kanat derinliği (1–2) */
  wing?: number;
  wall?: string; trim?: string; tile?: string; door?: string; water?: string; leaf?: string;
}
/**
 * `riadCourt` — iç avlulu ev (Marakeş): dört kanat (ön kanatta kapı boşluğu, kapı `STD.door`), parapet, avlu köşelerinde
 * revak direkleri, desenli avlu zemini, ortada çeşme (su grubu), iki narenciye ağacı. Avlu yürünür kalır: çağıran yalnız
 * kanat karolarını engeller. Kutu: 22. Tepe: kat × H + 0,3 (parapet).
 */
export function riadCourt(b: Sink, o: RiadCourtOpts): number {
  const w = Math.min(10, Math.max(5, o.w ?? 7)), d = Math.min(10, Math.max(5, o.d ?? 7)), st = nClamp(o.storeys ?? 2, 1, 3), H = storeyH(o.storey);
  const wing = Math.min(2, Math.max(1, o.wing ?? 1.5)), h = st * H, { x, z } = o;
  const wall = o.wall ?? "#E3B48A", trim = o.trim ?? "#F4E9D6", tile = o.tile ?? "#3F7D6E", water = o.water ?? "#3E8DA8";
  const gap = 1.0, zb = z - d / 2 + wing / 2, zf = z + d / 2 - wing / 2;
  b(x, h / 2, zb, w, h, wing, wall, "solid", 0.03);
  for (const s of [-1, 1]) b(x + s * (w / 2 - wing / 2), h / 2, z, wing, h, d - 2 * wing, wall, "solid", 0.03);
  const fw = (w - gap) / 2;
  for (const s of [-1, 1]) b(x + s * (gap / 2 + fw / 2), h / 2, zf, fw, h, wing, wall, "solid", 0.03);
  b(x, STD.door + (h - STD.door) / 2, zf, gap, h - STD.door, wing, wall, "solid", 0.03);
  b(x, STD.door / 2, z + d / 2 + 0.02, STD.doorWidth, STD.door, 0.05, o.door ?? "#3E5A7A", "solid", 0.02);
  // parapet (dört kenar)
  b(x, h + 0.15, z - d / 2 + 0.1, w, 0.3, 0.2, trim, "solid", 0.02);
  b(x, h + 0.15, z + d / 2 - 0.1, w, 0.3, 0.2, trim, "solid", 0.02);
  for (const s of [-1, 1]) b(x + s * (w / 2 - 0.1), h + 0.15, z, 0.2, 0.3, d - 0.4, trim, "solid", 0.02);
  // avlu: revak direkleri, zemin, çeşme, ağaçlar
  const cw = w - 2 * wing, cd = d - 2 * wing;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b(x + sx * (cw / 2 - 0.12), H / 2, z + sz * (cd / 2 - 0.12), 0.24, H, 0.24, trim, "solid", 0.02);
  b(x, 0.02, z, cw, 0.04, cd, tile, "solid", 0.02);
  b(x, 0.2, z, 0.9, 0.4, 0.9, trim, "solid", 0.02);
  b(x, 0.38, z, 0.7, 0.06, 0.7, water, "water", 0);
  for (const s of [-1, 1]) {
    const tx = x + s * cw * 0.28, tz = z - cd * 0.25;
    b(tx, 0.5, tz, 0.16, 1.0, 0.16, "#6E4A2C", "solid", 0.04);
    b(tx, 1.25, tz, 0.9, 0.7, 0.9, o.leaf ?? "#4E8A3A", "solid", 0.1);
  }
  return h + 0.3;
}

export interface PagodaRoofOpts {
  x: number; y: number; z: number; w: number; d: number;
  /** kademe (1–3) */
  tiers?: number;
  /** kademeler arası gövde yüksekliği (pagoda; varsayılan 0: üst üste saçak) */
  gap?: number;
  color?: string; ridge?: string; body?: string;
}
/**
 * `pagodaRoof` — kalkık köşeli kademeli çatı (Doğu/Güneydoğu Asya): kademe başına saçak levhası + üst eğim + dört kalkık köşe;
 * `gap` > 0 ise kademeler arası dar gövde (pagoda katı). Kraliyet ya da dinî süs yok. Kutu: kademe × 7 + 1 ≤ 22. Tepe döner.
 */
export function pagodaRoof(b: Sink, o: PagodaRoofOpts): number {
  const tiers = nClamp(o.tiers ?? 1, 1, 3), gap = Math.max(0, o.gap ?? 0), c = o.color ?? "#4A5560";
  let y = o.y, f = 1;
  for (let t = 0; t < tiers; t++) {
    f = 1 - 0.22 * t;
    const w = o.w * f, d = o.d * f;
    b(o.x, y + 0.12, o.z, w + 0.5, 0.24, d + 0.5, c, "solid", 0.03);
    b(o.x, y + 0.44, o.z, w - 0.1, 0.4, d * 0.6, c, "solid", 0.03);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b(o.x + sx * (w / 2 + 0.2), y + 0.3, o.z + sz * (d / 2 + 0.2), 0.25, 0.18, 0.25, c, "solid", 0.02);
    y += 0.64;
    if (t < tiers - 1 && gap > 0) { b(o.x, y + gap / 2, o.z, w * 0.62, gap, d * 0.62, o.body ?? "#B8423A", "solid", 0.03); y += gap; }
  }
  b(o.x, y + 0.08, o.z, o.w * f * 0.8, 0.16, 0.18, o.ridge ?? "#2E3238", "solid", 0.02);
  return y + 0.16;
}

export interface TiledRoofHallOpts {
  x: number; z: number;
  /** en (3–10), derinlik (2–6) */
  w?: number; d?: number;
  /** taş kaide yüksekliği (0,2–1,0) */
  platform?: number;
  storey?: number;
  tiers?: number;
  wall?: string; pillar?: string; roof?: string; ridge?: string; stone?: string; door?: string;
}
/**
 * `tiledRoofHall` — taş kaideli, ön sütunlu, kalkık kiremit çatılı salon (<city>; kraliyet süsü, ejder, yazı yok): kaide + ön
 * basamak + gövde + ön sütun dizisi (≤ 9) + kafes kapı + `pagodaRoof`. Kat `storeyH`, kapı `STD.door`.
 * Kutu: ≤ 4 + 9 + 22 = 35. Tepe döner.
*/
export function tiledRoofHall(b: Sink, o: TiledRoofHallOpts): number {
  const w = Math.min(10, Math.max(3, o.w ?? 6)), d = Math.min(6, Math.max(2, o.d ?? 3)), p = Math.min(1, Math.max(0.2, o.platform ?? 0.5));
  const H = storeyH(o.storey), { x, z } = o, stone = o.stone ?? "#C9C2B2";
  b(x, p / 2, z, w + 0.6, p, d + 0.6, stone, "solid", 0.03);
  b(x, p / 4, z + d / 2 + 0.45, 1.6, p / 2, 0.3, stone, "solid", 0.03);
  b(x, p + H / 2, z, w - 0.4, H, d - 0.4, o.wall ?? "#E8DCC4", "solid", 0.03);
  const cols = nClamp(Math.floor(w) + 1, 3, 9);
  for (let k = 0; k < cols; k++) b(x - w / 2 + 0.11 + (k * (w - 0.22)) / (cols - 1), p + H / 2, z + d / 2 - 0.11, 0.22, H, 0.22, o.pillar ?? "#9A3B30", "solid", 0.02);
  b(x, p + STD.door / 2, z + d / 2 - 0.19, 1.2, STD.door, 0.04, o.door ?? "#7A4A2C", "solid", 0.02);
  return pagodaRoof(b, { x, y: p + H, z, w: w + 0.4, d: d + 0.4, tiers: o.tiers ?? 1, color: o.roof, ridge: o.ridge });
}

export interface TowerOpts {
  x: number; z: number;
  /** en ve derinlik (1–6) */
  w?: number; d?: number;
  height: Height;
  cap?: "flat" | "pyramid" | "spire";
  wall?: string; trim?: string; roof?: string; window?: string; door?: string;
}
/**
 * `tower` — genel simge kule (saat/gözcü/çan kulesi; yüz, kadran yazısı, çan simgesi yok): gövde + kat bantları (≤ 4) +
 * bant başına dar pencere + kapı + korniş + üç kademeli başlık (düz/piramit/sivri). Tepe TAM `landmarkTop(height)`.
 * Kutu: ≤ 3 + 8 + 3 = 14.
 */
export function tower(b: Sink, o: TowerOpts): number {
  const top = landmarkTop(o.height), w = Math.min(6, Math.max(1, o.w ?? 2)), d = Math.min(6, Math.max(1, o.d ?? w)), { x, z } = o;
  const cap = o.cap ?? "pyramid", ch = cap === "flat" ? 0.3 : Math.min(cap === "spire" ? 3 : 2, top * (cap === "spire" ? 0.3 : 0.2));
  const h = top - ch, trim = o.trim ?? "#F6F0E4", wall = o.wall ?? NEUTRAL.stone;
  b(x, h / 2, z, w, h, d, wall, "solid", 0.03);
  b(x, STD.door / 2, z + d / 2 + 0.02, STD.doorWidth, STD.door, 0.05, o.door ?? DARK, "solid", 0.02);
  const bands = Math.min(4, Math.floor(h / (STD.storey * 2)));
  for (let k = 1; k <= bands; k++) {
    const y = (k * h) / (bands + 1);
    b(x, y, z, w + 0.08, 0.12, d + 0.08, trim, "solid", 0.02);
    b(x, y + 0.2 + STD.window / 2, z + d / 2 + 0.02, Math.min(0.4, w * 0.3), STD.window, 0.05, o.window ?? "#3F5A70", "solid", 0.02);
  }
  b(x, h - 0.1, z, w + 0.16, 0.2, d + 0.16, trim, "solid", 0.02);
  const fs = cap === "flat" ? [1.04] : cap === "spire" ? [0.7, 0.42, 0.16] : [0.9, 0.6, 0.3];
  const th = ch / fs.length;
  fs.forEach((f, k) => b(x, h + k * th + th / 2, z, w * f, th, d * f, o.roof ?? NEUTRAL.tile, "solid", 0.02));
  return top;
}
