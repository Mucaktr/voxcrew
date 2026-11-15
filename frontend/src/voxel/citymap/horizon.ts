/**
 * TOUR-VIEW (§8 F1) — şehrin **silüet ve ufuk katmanı** (saf; React/three yok → tour_check doğrudan yükler).
 *
 *  - **Parsel silüetleri:** her semt parselinin uzak LOD'u (`districtParcel(…).far`, parıltı hariç) — akış halkasının yazdığı uzak
 *    bloklarla birebir aynı; böylece silüet ↔ uzak halka geçişi görünmez, uzak halka ↔ yakın ayrıntı titreşimli çapraz geçer.
 *    Her landmark ve semt her pozdan bir silüet olarak görünür (LANDMARK-SILHOUETTE-001). Üretim pahalı ilk parsellerde
 *    (semt planı) olduğundan katman kareye bütçeli doldurulur (`HorizonLayer.tsx`); burada yalnız sıra ve dönüşüm var.
 *  - **Doğal sınır** (`cityBoundary`): şehir kutusunun dışında kenar başına katmanlar — kıyı şeridi + uzak kent silüeti, yeşil
 *    tepeler, sırt, dağ, Kapadokya mesaları ve volkan, adalar ya da açık deniz. Kıyı şehirlerinde kara bantları alçak bir şerit
 *    üstünde (deniz düzleminde yüzmez); denizsiz şehirde ufka kadar arazi önlüğü (gökyüzü renkli boş düzlem görünmez).
 *    Yürünmez (çarpışma yok; semt dışına zaten yürünmez). Belirlenimci (harita kimliği tohumu).
 */
import type { Block } from "../scenes";
import { hash32, prng } from "../expanse/seed";
import { cityX, cityZ, lineRoute } from "../transit/model";
import { CITY_PD, CITY_PW, GATE_D, GATE_W, type CityMapFile } from "./format";
import { districtParcel } from "./district";
import { cityParcels } from "./source";
import { drawnBlocks } from "../zfight";
import { facadeBlocks, facadeStyle, roofTone } from "./facade";
import { withFullHorizon } from "../../full/horizon";

/** Silüet parselinin anahtarı (stream.ts `pkey` ile aynı biçim). */
export const hzKey = (cx: number, cz: number) => `${cx},${cz}`;

/** Parselin silüet blokları (uzak LOD; parıltı dışarıda — gece lambası uzak halkada kalır). */
export function parcelSilhouette(map: CityMapFile, cx: number, cz: number): Block[] {
  const d = map.districts.find((x) => {
    const [i0, j0, w, dd] = x.bounds, I = cx * CITY_PW, J = cz * CITY_PD;
    return I >= i0 && J >= j0 && I + CITY_PW <= i0 + w && J + CITY_PD <= j0 + dd;
  });
  if (!d) return [];
  const p = districtParcel(map, d, cx, cz);
  // silüet akışın uzak yazımıyla aynı çözülmüş blokları çizer (`drawnBlocks`, liste başına önbellekli; parıltı sonra
  // ayrılır) — ufukta da renk titreşimi yok ve silüet ↔ uzak yazım değişimi görünmez kalır (POP-IN-001)
  return p ? drawnBlocks(p.far.blocks).filter((b) => b.g !== "glow") : [];
}

/** Bütün parseller (silüet sırası: bir noktaya yakından uzağa; yakın halka zaten akışta üretileceği için sıra yalnız ilk görünüm). */
export function silhouetteOrder(map: CityMapFile, x: number, z: number): { key: string; cx: number; cz: number }[] {
  const out = cityParcels(map).map((p) => ({ key: hzKey(p.cx, p.cz), cx: p.cx, cz: p.cz, d: Math.hypot(cityX(p.cx * CITY_PW + CITY_PW / 2) - x, cityZ(p.cz * CITY_PD + CITY_PD / 2) - z) }));
  out.sort((a, b) => b.d - a.d || a.cz - b.cz || a.cx - b.cx); // uzaktan yakına: yakındakileri akış zaten çizer
  return out.map(({ key, cx, cz }) => ({ key, cx, cz }));
}

// ------------------------------------------------------------------------------------------ doğal sınır
export type Side = "n" | "e" | "s" | "w";
/** Kenar katmanı: kıyı/kent silüeti, tepeler, sırt, dağ, mesa (tüf), ada, açık (hiçbir şey). */
export type EdgeKind = "skyline" | "hills" | "ridge" | "mountains" | "mesa" | "islands" | "open";
export interface CityBoundary {
  /** kenar başına içten dışa katmanlar (+z kuzey, +x doğu) */
  n: EdgeKind[]; e: EdgeKind[]; s: EdgeKind[]; w: EdgeKind[];
  green: string[]; rock: string[]; town: string[];
  /** kara şeridi / önlük rengi */
  land: string;
  /** belirgin doğal zirveler (kenar, kenar boyunca 0…1, yükseklik, yarıçap, kar) — yalnız coğrafya, yapı/sembol yok */
  peaks?: { side: Side; at: number; h: number; r: number; snow?: boolean }[];
}
const G = ["#6E8F55", "#5F8248", "#7D9A5E", "#56763F"], R = ["#8F8577", "#7C7468", "#9A8E7C"], T = ["#B9B2A6", "#A7A39B", "#C9BFAE", "#9EA5AC", "#D2C6B2"];
export const BOUNDARY_DEFAULT_SEA: CityBoundary = { n: ["skyline", "hills"], e: ["islands"], s: ["open"], w: ["skyline", "hills"], green: G, rock: R, town: T, land: "#8E9A78" };
export const BOUNDARY_DEFAULT_LAND: CityBoundary = { n: ["hills", "ridge"], e: ["hills", "ridge"], s: ["hills", "ridge"], w: ["hills", "ridge"], green: G, rock: R, town: T, land: "#9AA27E" };
/**
 * Şehir başına doğal sınır (gerçek coğrafyadan sadeleştirilmiş; yazı, logo, bayrak, dinî simge yok):
 * - İstanbul: kuzeyde Boğaz'ın yeşil sırtları, doğuda Anadolu yakasının tepeleri, güneyde Marmara ve Adalar, batıda Trakya kenti.
 * - Londra: dört yanda alçak yeşil tepeler ve banliyö silüeti (Thames vadisi). <city>: Seine vadisini çevreleyen yeşil sırtlar.
 * - <city>: batıda uzak sıradağlar ve karlı volkan konisi, kuzey/doğuda kent, güneyde körfez. <city>: batıda karşı kıyı kenti,
 * doğuda alçak kent, güneyde açık liman. <city>: kuzey/batıda dik ormanlı tepeler (morro), doğu/güneyde Atlas Okyanusu ve adalar.
 * - Kapadokya: tüf mesaları ve sırtlar, doğuda karlı volkan (denizsiz; arazi önlüğü). <city>: kuzeybatıda Collserola sırtı,
 * güneydoğuda Akdeniz. <city>: alçak yeşil adalar, kuzeyde karşı kıyı.
*/
export const CITY_BOUNDARY: Readonly<Record<string, CityBoundary>> = withFullHorizon({
  istanbul: { n: ["skyline", "hills", "ridge"], e: ["hills", "ridge"], s: ["islands"], w: ["skyline", "hills"], green: G, rock: R, town: T, land: "#8C9873" },
  londra: { n: ["skyline", "hills"], e: ["skyline", "hills"], s: ["skyline", "hills"], w: ["skyline", "hills"], green: ["#6F8E58", "#62824C", "#7A9662"], rock: R, town: ["#A9A49C", "#9C978F", "#B7AE9F", "#8F9499"], land: "#7F8F6C" },
  kapadokya: { n: ["mesa", "ridge"], e: ["mesa", "ridge"], s: ["mesa", "ridge"], w: ["mesa", "ridge"], green: ["#9C9A6E", "#8E8B60"], rock: ["#D8C3A0", "#CDB28E", "#E2CFB2", "#C9A88A"], town: T, land: "#CDB896",
    peaks: [{ side: "e", at: 0.55, h: 44, r: 52, snow: true }] },
}, { G, R, T });
export const boundaryOf = (map: CityMapFile): CityBoundary => CITY_BOUNDARY[map.id] ?? (map.sea ? BOUNDARY_DEFAULT_SEA : BOUNDARY_DEFAULT_LAND);

/** Şehir kutusu (dünya birimi): semtler + varış meydanı. */
export function cityBox(map: CityMapFile): { x0: number; z0: number; x1: number; z1: number } {
  let i0 = 0, j0 = 0, i1 = GATE_W, j1 = GATE_D;
  for (const d of map.districts) { i0 = Math.min(i0, d.bounds[0]); j0 = Math.min(j0, d.bounds[1]); i1 = Math.max(i1, d.bounds[0] + d.bounds[2]); j1 = Math.max(j1, d.bounds[1] + d.bounds[3]); }
  return { x0: cityX(i0) - 0.5, z0: cityZ(j0) - 0.5, x1: cityX(i1) - 0.5, z1: cityZ(j1) - 0.5 };
}

/** Katman bandı: kutudan uzaklık (birim) ve adım. */
const BAND: Record<Exclude<EdgeKind, "open">, { off: number; depth: number; step: number }> = {
  skyline: { off: 16, depth: 16, step: 8 },
  hills: { off: 36, depth: 24, step: 15 },
  mesa: { off: 30, depth: 40, step: 20 },
  ridge: { off: 66, depth: 30, step: 26 },
  mountains: { off: 96, depth: 50, step: 34 },
  islands: { off: 40, depth: 90, step: 34 },
};
/** Kara şeridi gereken katmanlar (kıyı şehrinde denizde yüzmesin diye). */
const LANDED: ReadonlySet<EdgeKind> = new Set(["skyline", "hills", "ridge", "mountains", "mesa"]);
const SEA_Y = -0.42;
/** kara önlüğünün (düz arazi levhası) ÜST yüzü. Süs suyu (semt tasarımı, üst yüz -0,22) önlüğün altında kalıp "kuru" görünüyordu
 * (<city> Dere yolu); önlük suyun tabanının (-0,42) altında durur. Silüet katmanları da bu seviyeden yükselir.*/
export const LAND_TOP = -0.52;

/**
 * Doğal sınır blokları (dünya). `map.sea` kıyı şehri: kara bantları kendi şeridi üstünde; değilse tek büyük arazi önlüğü.
 * Her blok yalnız durağan katı (`solid`); silüet katmanının aynı örneklenmiş dizisinde çizilir.
 */
export function cityBoundary(map: CityMapFile): Block[] {
  const B = boundaryOf(map), box = cityBox(map), out: Block[] = [];
  const r = prng(hash32(`horizon:${map.id}`));
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length) % a.length];
  const add = (x: number, y: number, z: number, w: number, h: number, d: number, c: string) => out.push({ p: [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)], s: [+w.toFixed(2), +h.toFixed(2), +d.toFixed(2)], c, g: "solid", j: 0 });
  const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2;
  const base = map.sea ? SEA_Y : LAND_TOP;
  if (!map.sea) add(cx, LAND_TOP - 0.15, cz, box.x1 - box.x0 + 1400, 0.3, box.z1 - box.z0 + 1400, B.land);
  /** kenar boyunca (u: 0…1) ve dışa (o: birim) → dünya; teğet ve normal */
  const frame = (side: Side) => {
    const len = side === "n" || side === "s" ? box.x1 - box.x0 : box.z1 - box.z0;
    const at = (u: number, o: number): [number, number] => {
      const t = -o + u * (len + 2 * o); // köşeleri de kapla
      if (side === "n") return [box.x0 + t, box.z1 + o];
      if (side === "s") return [box.x0 + t, box.z0 - o];
      if (side === "e") return [box.x1 + o, box.z0 + t];
      return [box.x0 - o, box.z0 + t];
    };
    return { len, at, alongX: side === "n" || side === "s" };
  };
  for (const side of ["n", "e", "s", "w"] as Side[]) {
    const f = frame(side);
    for (const kind of B[side]) {
      if (kind === "open") continue;
      const band = BAND[kind];
      // kıyı şehrinde kara katmanının şeridi (bandın tamamı; köşeler örtüşür)
      if (map.sea && LANDED.has(kind)) {
        const o = band.off + band.depth / 2, [sx, sz] = f.at(0.5, o), span = f.len + 2 * (band.off + band.depth) + 8;
        add(sx, base + 0.2, sz, f.alongX ? span : band.depth + 6, 0.5, f.alongX ? band.depth + 6 : span, B.land);
      }
      const n = Math.max(2, Math.ceil((f.len + 2 * band.off) / band.step));
      for (let k = 0; k <= n; k++) {
        const u = (k + (r() - 0.5) * 0.6) / n, o = band.off + r() * band.depth;
        const [x, z] = f.at(Math.min(1, Math.max(0, u)), o);
        const y0 = map.sea && LANDED.has(kind) ? base + 0.45 : kind === "islands" ? SEA_Y : LAND_TOP;
        feature(kind, x, z, y0, f.alongX);
      }
    }
  }
  for (const p of B.peaks ?? []) {
    const f = frame(p.side), [x, z] = f.at(p.at, BAND.mountains.off + 30 + p.r * 0.6);
    if (map.sea) add(x, base + 0.2, z, p.r * 2.6, 0.5, p.r * 2.6, B.land);
    cone(x, z, map.sea ? base + 0.45 : LAND_TOP, p.r, p.h, pick(B.rock), p.snow ? "#F2F4F6" : null);
  }
  return out;

  function cone(x: number, z: number, y0: number, rad: number, h: number, c: string, snow: string | null) {
    const tiers = 6;
    for (let t = 0; t < tiers; t++) {
      const f = 1 - t / tiers, hh = h / tiers, top = t >= tiers - 2 && snow;
      add(x, y0 + hh * (t + 0.5), z, rad * 2 * f, hh + 0.05, rad * 2 * f * 0.92, top ? snow! : c);
    }
  }
  function feature(kind: EdgeKind, x: number, z: number, y0: number, alongX: boolean) {
    switch (kind) {
      case "skyline": {
        const n = 2 + Math.floor(r() * 3);
        for (let q = 0; q < n; q++) {
          const w = 2 + r() * 4, d = 2 + r() * 4, h = 2.5 + r() * r() * 13;
          add(x + (r() - 0.5) * 7, y0 + h / 2, z + (r() - 0.5) * 7, w, h, d, pick(B.town));
        }
        break;
      }
      case "hills": {
        const rad = 7 + r() * 8, h = 4 + r() * 9, c = pick(B.green);
        add(x, y0 + h * 0.22, z, rad * 2, h * 0.44, rad * 1.8, c);
        add(x + (r() - 0.5) * 3, y0 + h * 0.6, z + (r() - 0.5) * 3, rad * 1.35, h * 0.36, rad * 1.2, c);
        add(x + (r() - 0.5) * 3, y0 + h * 0.88, z + (r() - 0.5) * 3, rad * 0.7, h * 0.24, rad * 0.65, pick(B.green));
        break;
      }
      case "ridge": {
        const len = 26 + r() * 22, h = 9 + r() * 14, c = pick(B.rock), g = pick(B.green);
        const w = alongX ? len : 14 + r() * 8, d = alongX ? 14 + r() * 8 : len;
        add(x, y0 + h * 0.3, z, w, h * 0.6, d, g);
        add(x + (r() - 0.5) * 6, y0 + h * 0.75, z + (r() - 0.5) * 6, w * 0.62, h * 0.32, d * 0.62, c);
        add(x + (r() - 0.5) * 6, y0 + h * 0.96, z + (r() - 0.5) * 6, w * 0.3, h * 0.12, d * 0.3, c);
        break;
      }
      case "mountains": cone(x, z, y0, 16 + r() * 14, 22 + r() * 22, pick(B.rock), null); break;
      case "mesa": {
        // tüf mesası: geniş gövde, açık/koyu tabaka bandı, düz başlık; yanında 1–2 peri bacası konisi
        const w = 10 + r() * 18, d = 8 + r() * 14, h = 6 + r() * 12, c = pick(B.rock);
        add(x, y0 + h * 0.4, z, w, h * 0.8, d, c);
        add(x, y0 + h * 0.83, z, w * 0.92, h * 0.06, d * 0.92, "#B9906E");
        add(x, y0 + h * 0.93, z, w * 0.86, h * 0.14, d * 0.86, pick(B.rock));
        for (let q = 0; q < 1 + Math.floor(r() * 2); q++) {
          const px = x + (r() - 0.5) * (w + 10), pz = z + (r() - 0.5) * (d + 10), ph = 4 + r() * 5;
          add(px, y0 + ph * 0.35, pz, 2.4, ph * 0.7, 2.4, pick(B.rock));
          add(px, y0 + ph * 0.8, pz, 1.5, ph * 0.3, 1.5, pick(B.rock));
          add(px, y0 + ph + 0.2, pz, 1.9, 0.5, 1.9, "#8C7A66");
        }
        break;
      }
      case "islands": {
        if (r() < 0.45) break;
        const rad = 4 + r() * 9, h = 2 + r() * 7, c = pick(B.green);
        add(x, y0 + h * 0.3, z, rad * 2, h * 0.6 + 0.4, rad * 1.6, c);
        add(x + (r() - 0.5) * 2, y0 + h * 0.75, z + (r() - 0.5) * 2, rad, h * 0.4, rad * 0.9, pick(B.green));
        break;
      }
      default: break;
    }
  }
}

// ------------------------------------------------------------------------------------------ şehir dokusu dolgusu
/** Dolgu ızgarası (karo): hücre başına bir ada (sokak 2 karo), şehir kutusunun dışına taşma payı, yürünür alandan / hat rotasından boşluk. */
export const FILL_CELL = 8, FILL_OUT = 16, FILL_GAP = 2, FILL_ROUTE = 3;
/** Dolgu yalnız varış meydanının çevresinde (merkezden karo; kuş bakışının meydandan gördüğü alan) — silüet katmanı ağırlaşmaz. */
export const FILL_R = 44;
const FILL_STOREY = 1.6;
const fillCache = new WeakMap<CityMapFile, Block[]>();
/**
 * (hqa21 kuş bakışı: "Şanghay/<city> meydanı boş zeytin yeşili düzlüğün kenarında"): kara şehrinde (denizsiz) varış meydanı şehir
 * kutusunun kenarında; kutunun semtsiz köşeleri ve kutunun hemen dışı yalnız arazi önlüğüydü. Meydanın FILL_R çevresinde bu bantta şehrin uzak LOD dokusu çizilir:
 * FILL_CELL karelik sokak ızgarasında her adaya bir bina (`facadeBlocks` uzak kademe 1: kat bandı + ayak + şehrin çatısı; en yakın semtin
 * teması) ve ada döşemesi (arazi önlüğünden sokak seviyesine). Semt ve meydan (FILL_GAP karo pay), hat rotaları (FILL_ROUTE) ve doğal
 * sınır bantları (FILL_OUT içinde kalır) dışında; yürünmez, çarpışma yok, silüet katmanının aynı dizisinde (+0 çizim çağrısı).
 * Denetim: CITY-EDGE-001 (scripts/aerial_lod_check.mjs).
*/
export function cityFiller(map: CityMapFile): Block[] {
  const hit = fillCache.get(map);
  if (hit) return hit;
  const out: Block[] = [];
  fillCache.set(map, out);
  if (map.sea) return out;
  const rects: [number, number, number, number][] = [[0, 0, GATE_W, GATE_D], ...map.districts.map((d) => d.bounds as [number, number, number, number])];
  let i0 = 0, j0 = 0, i1 = GATE_W, j1 = GATE_D;
  for (const [a, b, w, d] of rects) { i0 = Math.min(i0, a); j0 = Math.min(j0, b); i1 = Math.max(i1, a + w); j1 = Math.max(j1, b + d); }
  const route: [number, number][] = map.lines.flatMap((l) => {
    const r = lineRoute(map, l), pts: [number, number][] = [];
    for (let k = 0; k + 1 < r.length; k++) { const n = Math.max(1, Math.ceil(Math.hypot(r[k + 1][0] - r[k][0], r[k + 1][1] - r[k][1]))); for (let q = 0; q <= n; q++) pts.push([r[k][0] + ((r[k + 1][0] - r[k][0]) * q) / n, r[k][1] + ((r[k + 1][1] - r[k][1]) * q) / n]); }
    return pts;
  });
  const clear = (a: number, b: number, w: number, d: number) =>
    !rects.some(([x, z, rw, rd]) => a < x + rw + FILL_GAP && x - FILL_GAP < a + w && b < z + rd + FILL_GAP && z - FILL_GAP < b + d)
    && !route.some(([x, z]) => x > a - FILL_ROUTE && x < a + w + FILL_ROUTE && z > b - FILL_ROUTE && z < b + d + FILL_ROUTE);
  const near = (a: number, b: number) => map.districts.reduce((best, d) => {
    const dd = Math.hypot(a - (d.bounds[0] + d.bounds[2] / 2), b - (d.bounds[1] + d.bounds[3] / 2));
    return dd < best.d ? { d: dd, t: d.theme } : best;
  }, { d: Infinity, t: map.districts[0]?.theme ?? "historic" }).t;
  const ox = cityX(0) - 0.5, oz = cityZ(0) - 0.5;
  const C = FILL_CELL;
  for (let b = Math.floor((j0 - FILL_OUT) / C) * C; b < j1 + FILL_OUT; b += C) for (let a = Math.floor((i0 - FILL_OUT) / C) * C; a < i1 + FILL_OUT; a += C) {
    if (Math.hypot(a + C / 2 - GATE_W / 2, b + C / 2 - GATE_D / 2) > FILL_R || !clear(a, b, C, C)) continue;
    const st = facadeStyle(map.id, near(a + C / 2, b + C / 2));
    const hs = hash32(`fill:${map.id}:${a}:${b}`), r = prng(hs);
    // ada döşemesi: arazi önlüğünden sokak seviyesine (sokak payı kenarda arazi rengi kalır)
    out.push({ p: [ox + a + C / 2, (LAND_TOP + 0.01) / 2, oz + b + C / 2], s: [C - 1, 0.01 - LAND_TOP, C - 1], c: "#A9A397", g: "solid", j: 0.03 });
    const w = 3 + Math.floor(r() * 3), d = 3 + Math.floor(r() * 3), n = 1 + Math.floor(r() * 3);
    const bd = { i0: a + 1 + Math.floor(r() * (C - 2 - w)), j0: b + 1 + Math.floor(r() * (C - 2 - d)), w, d, h: +(n * FILL_STOREY + 0.4).toFixed(2),
      wall: st.walls[Math.floor(r() * st.walls.length)], roof: roofTone(st.roof, r()) };
    for (const q of facadeBlocks(bd, st, ox, oz, 0, 1)) out.push(q);
  }
  return out;
}

/** Denetim: sınır kutusu blokları şehir kutusunun dışında mı (yürünür alana girmez) — ihlal sayısı. */
export function boundaryIntrusions(map: CityMapFile, blocks: readonly Block[]): number {
  const box = cityBox(map);
  let bad = 0;
  for (const b of blocks) {
    if (b.s[0] > 400) continue; // arazi önlüğü (zemin altı, yürünmez)
    const x0 = b.p[0] - b.s[0] / 2, x1 = b.p[0] + b.s[0] / 2, z0 = b.p[2] - b.s[2] / 2, z1 = b.p[2] + b.s[2] / 2;
    if (x1 > box.x0 && x0 < box.x1 && z1 > box.z0 && z0 < box.z1 && b.p[1] + b.s[1] / 2 > 0.05) bad++;
  }
  return bad;
}
