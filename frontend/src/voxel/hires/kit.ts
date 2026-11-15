/**
 * LANDMARK-HIRES — yüksek çözünürlük çizim ilkelleri. Saf modül: React/three yok.
 *
 * Bütün ilkeller eksene hizalı kutu yazar (`Sink`, citymap/design.ts; dünya koordinatı, y merkez). Yuvarlak biçimler `k` kutulu
 * "basamaklı daire" ile (k = 3 → 12 köşeli siluet; `oct` = 3 kutunun daha kaba hâli). Ayrıntı ½ ve ¼ birimde: pencere kemeri ve
 * kafesi, mukarnas (konsol) basamakları, şerefe korkuluğu, kasnak pencere halkası, kaburgalı kubbe, ince sivri külah, revak kemeri.
 * Yazı, logo, bayrak, dinî simge yok (kubbe ve minarede alem yok; tepe yalnız düz kurşun uç).
*/
import type { Block } from "../scenes";
import type { Sink } from "../citymap/design";
import { HIRES_GRID } from "./types";

type G = Block["g"];

/** ⅛ ızgaraya yuvarlama (ince ızgara; ½ ve ¼ birim ayrıntı hizalı kalır). */
export const snap = (v: number, step = HIRES_GRID) => Math.round(v / step) * step;

/** Çember üstünde `n` nokta: (x, z, açı). `phase` 0,5 → noktalar eksenlerin arasında. */
export function around(n: number, r: number, phase = 0.5): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let q = 0; q < n; q++) { const a = ((q + phase) / n) * Math.PI * 2; out.push([Math.cos(a) * r, Math.sin(a) * r, a]); }
  return out;
}

/** Basamaklı daire (silindir dilimi): `k` kutu, yarıçap r, yükseklik h, y merkez. */
export function disc(b: Sink, x: number, y: number, z: number, r: number, h: number, c: string, k = 3, g: G = "solid", j = 0.02) {
  for (let i = 0; i < k; i++) {
    const t = ((i + 0.5) / k) * (Math.PI / 2), w = 2 * r * Math.cos(t), d = 2 * r * Math.sin(t);
    b(x, y, z, w, h, d, c, g, j);
  }
}

/** `disc(r, k)` birleşiminin `a` açısındaki dış sınır yarıçapı (basamak çentiği dahil): kaburga, payanda ve konsol yüzeye
 *  bu yarıçapta oturur (çentikte havada kalmaz). */
export function discEdge(r: number, k: number, a: number): number {
  const ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
  let best = 0;
  for (let i = 0; i < k; i++) {
    const t = ((i + 0.5) / k) * (Math.PI / 2), hx = r * Math.cos(t), hz = r * Math.sin(t);
    best = Math.max(best, Math.min(ca > 1e-9 ? hx / ca : Infinity, sa > 1e-9 ? hz / sa : Infinity));
  }
  return best;
}

/** Yarım daire dilimi: düz kenar (x, z)'de, (dx, dz) yönünde açılır. */
export function halfDisc(b: Sink, x: number, y: number, z: number, r: number, h: number, dx: number, dz: number, c: string, k = 3, g: G = "solid", j = 0.02) {
  for (let i = 0; i < k; i++) {
    const t = ((i + 0.5) / k) * (Math.PI / 2), across = 2 * r * Math.cos(t), along = r * Math.sin(t);
    const cx = x + dx * along / 2, cz = z + dz * along / 2;
    if (dx) b(cx, y, cz, along, h, across, c, g, j); else b(cx, y, cz, across, h, along, c, g, j);
  }
}

export interface DomeOpts {
  /** yatay dilim sayısı (varsayılan 7) */
  steps?: number;
  /** dilim başına kutu (varsayılan 3) */
  k?: number;
  /** kaburga sayısı (0: yok) — kubbe yüzünde ince çıkıntı çizgileri (Ayasofya 40 kaburga) */
  ribs?: number;
  ribColor?: string;
  /** tepe: düz kurşun uç (alem değil) yüksekliği (0: yok) */
  tip?: number;
}
/** Kaburgalı kurşun kubbe: y taban, r yarıçap, h yükseklik (h < r basık). Kutu ≈ steps·k + ribs·(steps − 2) + 2. */
export function ribbedDome(b: Sink, x: number, y: number, z: number, r: number, h: number, c: string, o: DomeOpts = {}) {
  const steps = o.steps ?? 7, k = o.k ?? 3, hh = h / steps;
  for (let s = 0; s < steps; s++) {
    const t = (s + 0.5) / steps, rr = r * Math.sqrt(1 - t * t * 0.96);
    disc(b, x, y + s * hh + hh / 2, z, rr, hh + 0.02, c, s === steps - 1 ? 2 : k);
  }
  if (o.ribs) {
    const rc = o.ribColor ?? c, rw = Math.max(0.04, Math.min(0.12, r * 0.05));
    for (let s = 0; s < steps - 2; s++) {
      const t = (s + 0.5) / steps, rr = r * Math.sqrt(1 - t * t * 0.96);
      for (const [, , a] of around(o.ribs, 1, 0)) {
        const e = discEdge(rr, k, a) - rw * 0.25;
        b(x + Math.cos(a) * e, y + s * hh + hh / 2, z + Math.sin(a) * e, rw, hh + 0.03, rw, rc, "solid", 0.01);
      }
    }
  }
  b(x, y + h + 0.02, z, r * 0.16, 0.06, r * 0.16, c, "solid", 0.01); // tepe göbeği
  if (o.tip) b(x, y + h + 0.05 + o.tip / 2, z, 0.05, o.tip, 0.05, c, "solid", 0);
}

/** Yarım kubbe (çeyrek küre): düz kenar (x, z)'de, (dx, dz) yönünde açılır; kaburgalı isteğe bağlı. */
export function semiDome(b: Sink, x: number, y: number, z: number, r: number, h: number, dx: number, dz: number, c: string, o: DomeOpts = {}) {
  const steps = o.steps ?? 5, k = o.k ?? 3, hh = h / steps;
  for (let s = 0; s < steps; s++) {
    const t = (s + 0.5) / steps, rr = r * Math.sqrt(1 - t * t * 0.96);
    halfDisc(b, x, y + s * hh + hh / 2, z, rr, hh + 0.02, dx, dz, c, s === steps - 1 ? 2 : k);
  }
  if (o.ribs) {
    const rw = Math.max(0.04, Math.min(0.1, r * 0.05));
    for (let s = 0; s < steps - 1; s++) {
      const t = (s + 0.5) / steps, r0 = r * Math.sqrt(1 - t * t * 0.96);
      for (let q = 0; q < o.ribs; q++) {
        const a = ((q + 0.5) / o.ribs) * Math.PI - Math.PI / 2, rr = discEdge(r0, k, a) - rw * 0.25, along = Math.cos(a) * rr, across = Math.sin(a) * rr;
        b(x + dx * along + dz * across, y + s * hh + hh / 2, z + dz * along + dx * across, rw, hh + 0.03, rw, o.ribColor ?? c, "solid", 0.01);
      }
    }
  }
}

/**
 * Pencereli kasnak: koyu iç halka (`lit`, `glow`: gündüz koyu kehribar cam, gece içten ışık), `n` taş payanda, her pencerenin
 * üstünde kemer başlığı, altta denizlik ve üstte saçak (kubbe buna oturur). Kutu ≈ 3 + 2n + 6. Üst yüz y + h + 0,08.
 */
export function windowDrum(b: Sink, x: number, y: number, z: number, r: number, h: number, n: number, stone: string, lit = "#6B4423") {
  disc(b, x, y + h / 2, z, r - 0.05, h, lit, 3, "glow", 0);
  const pw = Math.max(0.07, ((Math.PI * 2 * r) / n) * 0.42), aw = Math.max(0.06, ((Math.PI * 2 * r) / n) * 0.6);
  for (const [px, pz] of around(n, r - pw * 0.45, 0)) b(x + px, y + h / 2, z + pz, pw, h + 0.02, pw, stone, "solid", 0.02);
  for (const [px, pz] of around(n, r - aw * 0.45, 0.5)) b(x + px, y + h * 0.9, z + pz, aw, h * 0.2, aw, stone, "solid", 0.02);
  disc(b, x, y + 0.03, z, r + 0.05, 0.06, stone, 3, "solid", 0.02);
  disc(b, x, y + h + 0.04, z, r + 0.08, 0.08, stone, 3, "solid", 0.02);
}

export interface MinaretOpts {
  /** gövde çapı */
  shaft: number;
  /** gövde taşı ve külah kurşunu */
  c: string;
  cap: string;
  /** şerefe korkuluğu rengi (varsayılan açık taş) */
  rail?: string;
  /** yivli gövde (Sultanahmet): şerefe aralarında 8 ince dikey yiv */
  fluted?: boolean;
  /** külah yüksekliği (varsayılan gövde × 0,16) — ince sivri kurşun külah */
  capH?: number;
  /** şerefe yükseklikleri (y0'dan, h oranı); varsayılan şerefe sayısına göre */
  at?: number[];
  /** kaide ölçeği (varsayılan 1,6 × gövde) */
  base?: number;
  /** şerefe korkuluk dikmesi (varsayılan 8) ve yiv sayısı (fluted iken, varsayılan 8) — bütçe ayarı */
  posts?: number;
  flutes?: number;
}
/**
 * Kalem minare (alem yok): kare kaide + geçiş, çokgen gövde (isteğe bağlı yivli), `n` şerefe — üç kademe mukarnas konsolu,
 * taşkın balkon, 8 dikmeli korkuluk ve küpeşte — şerefe üstü incelen gövde, 8 kademeli ince sivri kurşun külah ve düz uç.
 * `h` gövde boyu (y0'dan son şerefe üstü gövde sonuna kadar); tepe ≈ y0 + h + capH + 0,15. Kutu ≈ 10 + n·27 + (fluted ? 8·(n+1) : 0) + 18.
 */
export function hiMinaret(b: Sink, x: number, z: number, y0: number, h: number, n: number, o: MinaretOpts) {
  const s = o.shaft, r = s / 2, rail = o.rail ?? "#DCD5C6";
  const fs = o.at ?? (n === 1 ? [0.8] : n === 2 ? [0.64, 0.84] : [0.5, 0.67, 0.84]);
  const baseH = Math.min(1.3, h * 0.11), bw = s * (o.base ?? 1.6);
  b(x, y0 + baseH / 2, z, bw, baseH, bw, o.c, "solid", 0.03);                       // kare kaide
  b(x, y0 + baseH + 0.04, z, bw + 0.02, 0.08, bw + 0.02, o.c, "solid", 0.02);      // kaide silmesi
  disc(b, x, y0 + baseH + 0.18, z, r * 1.25, 0.2, o.c, 3);                          // pabuç (geçiş)
  let yy = y0 + baseH + 0.28;
  const tops = fs.map((f) => y0 + h * f);
  const seg = (a: number, e: number, rad: number) => {
    if (e - a <= 0.02) return;
    disc(b, x, (a + e) / 2, z, rad, e - a, o.c, 3);
    if (o.fluted) for (const [, , t] of around(o.flutes ?? 8, 1, 0)) {
      const fe = discEdge(rad, 3, t) - 0.008;
      b(x + Math.cos(t) * fe, (a + e) / 2, z + Math.sin(t) * fe, 0.035, e - a - 0.04, 0.035, o.c, "solid", 0.05);
    }
  };
  for (const ty of tops) {
    seg(yy, ty - 0.24, r);
    // mukarnas: üç kademe büyüyen konsol bileziği
    [1.12, 1.28, 1.44].forEach((m, q) => disc(b, x, ty - 0.21 + q * 0.07, z, r * m, 0.07, o.c, 3, "solid", 0.03));
    disc(b, x, ty + 0.0, z, r * 1.7, 0.06, rail, 3, "solid", 0.02);                // balkon döşemesi
    // korkuluk: dikmeler balkon kenarında (çentikte havada kalmaz; 4'ün katı, eksenlerde dikme var), küpeşte eksen dikmelerine oturur
    const np = Math.max(4, Math.round((o.posts ?? 8) / 4) * 4), e0 = discEdge(r * 1.7, 3, 0) - 0.02;
    for (const [, , a] of around(np, 1, 0)) {
      const e = discEdge(r * 1.7, 3, a) - 0.02;
      b(x + Math.cos(a) * e, ty + 0.15, z + Math.sin(a) * e, 0.03, 0.24, 0.03, rail, "solid", 0);
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {      // küpeşte (kare halka)
      if (dx) b(x + dx * e0, ty + 0.28, z, 0.03, 0.03, e0 * 1.1, rail, "solid", 0);
      else b(x, ty + 0.28, z + dz * e0, e0 * 1.1, 0.03, 0.03, rail, "solid", 0);
    }
    yy = ty + 0.03;
  }
  const top = y0 + h;
  seg(yy, top, r * 0.86);
  disc(b, x, top + 0.04, z, r * 1.0, 0.08, o.c, 2, "solid", 0.02);                  // külah eteği
  const capH = o.capH ?? h * 0.16, L = 8;
  for (let q = 0; q < L; q++) {
    const f = 1 - q / L, rr = Math.max(0.02, r * 0.98 * f);
    disc(b, x, top + 0.08 + (q + 0.5) * capH / L, z, rr, capH / L + 0.01, o.cap, rr < 0.08 ? 1 : 2, "solid", 0.02);
  }
  b(x, top + 0.08 + capH + 0.08, z, 0.03, 0.16, 0.03, o.cap, "solid", 0);            // düz uç (alem yok)
}

/** Konik külah (Galata): y taban, r taban yarıçapı, h yükseklik; `steps` dilim. Tepe y + h. */
export function cone(b: Sink, x: number, y: number, z: number, r: number, h: number, c: string, steps = 10, k = 3) {
  for (let q = 0; q < steps; q++) {
    const f = 1 - (q + 0.3) / steps, rr = Math.max(0.03, r * f);
    disc(b, x, y + (q + 0.5) * h / steps, z, rr, h / steps + 0.01, c, rr < 0.15 ? 1 : k, "solid", 0.02);
  }
}

/** Halka konsol / dişli dizisi: çember üstünde `n` kutu (yarıçap r, boy s × hh × s). `bodyK` verilirse r gövde diski (`disc(r,
 *  bodyK)`) sayılır ve her konsol o açıdaki gövde sınırına oturur (çentikte havada kalmaz). */
export function corbels(b: Sink, x: number, y: number, z: number, r: number, n: number, s: number, hh: number, c: string, phase = 0.5, g: G = "solid", bodyK = 0) {
  for (const [, , a] of around(n, 1, phase)) {
    const e = bodyK ? discEdge(r, bodyK, a) + s * 0.2 : r;
    b(x + Math.cos(a) * e, y, z + Math.sin(a) * e, s, hh, s, c, g, 0.02);
  }
}

/**
 * Duvar yüzüne pencere dizisi: `face` duvar düzlemi (x ya da z sabit), `out` dışa yön (±1), [a0, a1] boyunca `n` pencere.
 * Pencere = koyu açıklık + kemer başlığı (daha dar) + açık taş denizlik; `grille` true ise ortada ¼ birim kayıt (kafes) çubuğu.
 * Kutu n·(3 + grille).
 */
export function windows(b: Sink, axis: "x" | "z", face: number, out: 1 | -1, a0: number, a1: number, y: number, n: number,
  w: number, h: number, opening: string, stone: string, grille = false, g: G = "solid") {
  for (let q = 0; q < n; q++) {
    const a = a0 + ((q + 0.5) / n) * (a1 - a0), f = face; // duvar yüzüne değer (havada değil)
    const B = (u: number, yy: number, lu: number, hh: number, depth: number, c: string, gg: G = "solid") =>
      axis === "x" ? b(u, yy, f + out * depth / 2, lu, hh, depth, c, gg, 0) : b(f + out * depth / 2, yy, u, depth, hh, lu, c, gg, 0);
    B(a, y, w, h, 0.03, opening, g);
    B(a, y + h / 2 + w * 0.18, w * 0.62, w * 0.36, 0.03, opening, g);   // kemer başlığı
    B(a, y - h / 2 - 0.03, w + 0.08, 0.06, 0.06, stone);               // denizlik
    if (grille) B(a, y, 0.03, h, 0.05, stone);                         // kafes çubuğu
  }
}

/** Taş silme / bant: duvar kütlesinden 0,03 taşan ince kuşak (w × hh × d, y merkez). */
export function band(b: Sink, x: number, y: number, z: number, w: number, d: number, c: string, hh = 0.07) {
  b(x, y, z, w + 0.06, hh, d + 0.06, c, "solid", 0.01);
}

export interface ArcadeOpts {
  /** sütun rengi, kemer/saçak taşı, kubbecik kurşunu */
  col: string;
  stone: string;
  lead: string;
  /** revak derinliği (yürüme yönüne dik) */
  depth: number;
  /** her bölmede kubbecik (true) ya da düz kurşun çatı */
  domes?: boolean;
  /** iç (avlu) tarafın yönü ±1 — sütunlar bu tarafta, arka duvar öbür tarafta */
  inward: 1 | -1;
}
/**
 * Revak: [a0, a1] boyunca `n` bölme, sabit `cross` çizgisinde (duvar ekseni). Arka duvar, avlu yanında `n + 1` sütun (başlık +
 * kaide), bölme başına kemer alnı, üstte saçak ve bölme başına kaburgasız kubbecik (3 dilim). Kutu ≈ 3 + (n+1)·3 + n·(2 + 7).
 */
export function arcade(b: Sink, axis: "x" | "z", a0: number, a1: number, cross: number, y0: number, h: number, n: number, o: ArcadeOpts) {
  const len = a1 - a0, bay = len / n, dIn = o.inward * o.depth;
  const B = (u: number, v: number, yy: number, lu: number, hh: number, lv: number, c: string, j = 0.02) =>
    axis === "x" ? b(u, yy, v, lu, hh, lv, c, "solid", j) : b(v, yy, u, lv, hh, lu, c, "solid", j);
  const mid = (a0 + a1) / 2;
  B(mid, cross, y0 + h / 2, len, h, 0.3, o.stone, 0.03);                                  // arka duvar
  B(mid, cross + dIn / 2, y0 + h + 0.05, len + 0.1, 0.1, Math.abs(dIn) + 0.3, o.stone);  // saçak döşemesi
  B(mid, cross + dIn, y0 + h * 0.86, len, h * 0.28, 0.16, o.stone);                       // kemer kuşağı (alın)
  const colTop = y0 + h * 0.64;
  for (let q = 0; q <= n; q++) {
    const u = a0 + q * bay, v = cross + dIn;
    B(u, v, y0 + 0.06, 0.2, 0.12, 0.2, o.stone);                                          // sütun kaidesi
    B(u, v, (y0 + 0.12 + colTop) / 2, 0.1, colTop - y0 - 0.12, 0.1, o.col, 0.01);         // sütun
    B(u, v, colTop + 0.04, 0.18, 0.08, 0.18, o.stone);                                    // başlık
  }
  for (let q = 0; q < n; q++) {
    const u = a0 + (q + 0.5) * bay, v = cross + dIn;
    B(u, v, y0 + h * 0.68, bay * 0.5, h * 0.08, 0.17, o.stone);                          // kemer omzu (alına değer)
    if (o.domes !== false) {
      const r = Math.min(bay, Math.abs(dIn) + 0.3) * 0.42, vc = cross + dIn / 2;
      const cx = axis === "x" ? u : vc, cz = axis === "x" ? vc : u;
      b(cx, y0 + h + 0.15, cz, r * 1.6, 0.1, r * 1.6, o.stone, "solid", 0.02);            // kasnak
      ribbedDome(b, cx, y0 + h + 0.2, cz, r, r * 0.75, o.lead, { steps: 3, k: 2 });
    }
  }
}

/** Sekizgen şadırvan: taş kaide, sütunlar, saçak, kurşun kubbecik; ortada musluk taşı (su; `wg` "solid" verilirse katmanın su
 *  ağı hiç kurulmaz → bir çizim çağrısı az). Kutu ≈ 30. */
export function sadirvan(b: Sink, x: number, z: number, r: number, stone: string, lead: string, water = "#5FA8C8", wg: G = "water") {
  disc(b, x, 0.12, z, r, 0.24, stone, 3, "solid", 0.03);
  disc(b, x, 0.26, z, r * 0.62, 0.05, water, 2, wg, 0);
  disc(b, x, 0.45, z, r * 0.32, 0.5, stone, 2, "solid", 0.02);
  for (const [px, pz] of around(8, r * 0.92, 0.5)) b(x + px, 0.85, z + pz, 0.08, 1.2, 0.08, stone, "solid", 0.01);
  disc(b, x, 1.5, z, r * 1.18, 0.1, stone, 3, "solid", 0.02);          // geniş saçak
  disc(b, x, 1.42, z, r * 1.25, 0.05, lead, 3, "solid", 0.02);
  ribbedDome(b, x, 1.55, z, r * 0.8, r * 0.6, lead, { steps: 3, k: 2 });
}
