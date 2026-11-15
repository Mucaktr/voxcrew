/**
 * NONCITY-QA (ürün sahibi 2026-10-29: "ofiste seyir terasına çıkınca … çıkılan yer sonsuzluğa bakıyor") — açık hava katlarının (ofis/AVM
 * çatı bahçesi, kafe balkonu; şehir sahnelerinde kule/kale/gökdelen güvertesi, teras, tribün) panoramasının çevresi.
 *
 * Kök neden: açık hava katı (generate.ts `panoramaBlocks`) yalnız TABAN dünyayı aşağıda gösteriyordu. Yürürken tabanın çevresini
 * çevre arazisi (expanse/Outskirts) doldurur; ama iç mekân ayrı bir sahnedir, Outskirts orada çizilmez → güverteden bakınca taban
 * dünyanın kenarından ötesi boş gök/sis ("sonsuzluk"). Şehir sahnelerinin tabanı ufuk bandını (`backdrop`) yalnız arkada (−z)
 * taşır; bütün dürbünler +z'ye bakar → şehir güvertelerinde de dürbün boşluğa bakıyordu (VIEW-VOID-001).
 *
 * Çözüm (yalnız iç mekân panoraması; dış dünya, çevre parselleri, E2 parsel yuvaları DEĞİŞMEZ):
 * 1. **Gerçek çevre:** tabanın çevre bağlamından (`expanseContext`, aynı tohum ve biyom) ilk halkaların parselleri — Outskirts'in
 * yürürken gösterdiğiyle aynı ağaç/ev/tarla/gölet. Şehir dışı 2 halka, şehir 1 halka (taban 36 × 32; ufuk yakında kalsın).
 * Su yönlerinde (Haliç/Boğaz, Seine, Thames, körfez, liman, Atlantik) halka parseli konmaz; su tabanın kenarından başlar.
 * 2. **Ufuk bandı:** yön başına (−z, +x, +z, −x) sahneye uygun uzak silüet — şehir dışı: dürbünün baktığı (+z) yönde şehir
 * silüeti, öteki yönlerde tepe/orman; şehir: o şehrin çatı/duvar paletiyle bina sıraları, su + karşı kıyı, isimsiz genel simge
 * silüetleri (city/skyline.ts: kubbe, asma köprü, saat kulesi, kademeli kule…) ve arkada tepe/dağ sırası (yüksek güverteden
 * ufuk boş kalmasın). Bayrak, yazı, logo yok.
 * 3. **Zemin:** taban ve halka parsellerinin dışı 4 × 4 karoluk hücrelere bölünür; satır boyunca aynı türde (zemin/su) hücreler tek
 * levha → üst üste binen levha yok (z-fight yok), boşluk yok.
 * 4. **Bütçe:** yalnız `solid` (ve tabanda zaten olan gruplar; çevre üreteci kendi kuralıyla) → +0 çizim çağrısı. Blok sayısı
 * `SURROUND_MAX_BLOCKS` tavanı altında (interaction_audit denetler).
 *
 * Saf modül (React/three yok), belirlenimci ve sahne başına önbellekli. Koordinat: TABAN çerçevesi (generate.ts panorama kayması
 * uygulanır).
*/
import { rng, sceneDef, tx, tz, type Block, type Builder, type Built } from "../scenes";
import { expanseContext, openParcels } from "../expanse/context";
import { generateParcel } from "../expanse/generate";
import { PD, PW } from "../expanse/grid";
import { NEW_CITY_IDS } from "../cities/index";
import { fullHorizons, FULL_CITY_SCENES } from "../../full/scenePano";
import { silhouette, type Silhouette } from "../city/skyline";
import type { CityStyle } from "../city/style";

/** Şehir sahneleri (taban 36 × 32, kendi ufuk bandı arkada; panorama çevresi tek halka + şehir ufku). */
export const CITY_SCENES: ReadonlySet<string> = new Set(["istanbul", "kapadokya", "londra", ...FULL_CITY_SCENES, ...NEW_CITY_IDS]);
export const isNonCityScene = (scene: string) => !CITY_SCENES.has(scene);

/** Panoramaya giren çevre halkası (şehir dışı: 1 yakın + 2 uzak ayrıntı; şehirde 1). Bağlam yarıçapı bir fazla (sınır çiti dışarıda). */
export const SURROUND_RINGS = 2;
export const CITY_SURROUND_RINGS = 1;
/** Ufuk bandının halkanın dış kenarından uzaklığı (karo) ve derinliği. */
export const HORIZON_GAP = 10;
export const HORIZON_DEPTH = 14;
/** Panorama çevresi blok tavanı (örnek sayısı; çizim çağrısı değil). */
export const SURROUND_MAX_BLOCKS = 4200;
/** Zemin hücresi (karo; PW = 12 ve PD = 16, taban 24/36 × 16/32 bölünür). */
const CELL = 4;

type LandKind = "city" | "hills" | "forest" | "dunes" | "peaks" | "rocks" | "none";
/** su yönleri: `shore` geniş su + karşı kıyı (Boğaz/Haliç, körfez), `river` dar su + karşı kıyı, `sea` ufka dek açık su */
type WaterKind = "shore" | "river" | "sea";
type SideKind = LandKind | WaterKind;
/** Simge silüeti (city/skyline.ts; `x` yerine bant boyunca oran `at` −0,5…0,5) ya da uzak dağ (`mount`: kademeli koni, karlı tepe). */
type Item = (Silhouette extends infer S ? (S extends Silhouette ? Omit<S, "x"> & { at: number } : never) : never)
  | { kind: "mount"; at: number; w: number; h: number; cap?: string };
interface SideSpec {
  kind: SideKind;
  /** karşı kıyı ya da şehir bandının arkasında tepe/dağ sırası (yüksek güvertede ufuk dolsun) */
  back?: "hills" | "peaks" | "rocks";
  items?: Item[];
}
export interface HorizonSpec {
  /** yön başına: [kuzey −z, doğu +x, güney +z, batı −x] */
  sides: [SideSpec, SideSpec, SideSpec, SideSpec];
  ground: string;
  hill: [string, string];
  walls: string[];
  glass: string;
  roofs?: string[];
  water?: string;
  /** şehir silüeti yükseklikleri: ön sıra [en az, en çok], arka sıra merkez kuleleri [en az, en çok] */
  low?: [number, number];
  tall?: [number, number];
  /** arka tepe sırası yüksekliği [en az, en çok] */
  backH?: [number, number];
}
export const S = (kind: SideKind, extra: Omit<SideSpec, "kind"> = {}): SideSpec => ({ kind, ...extra });
export const COUNTRY: Omit<HorizonSpec, "sides"> = { ground: "#7FA65A", hill: ["#6E9550", "#5F8546"], walls: ["#C9CED4", "#B8C0C8", "#DDE1E5", "#A9B1BA", "#E4DED2", "#9AA3AD"], glass: "#5A7A94" };
/** Sahne → ufuk tarifi. Dürbünler +z'ye bakar (generate.ts tarifleri `vpDir: 1`). */
const HORIZONS: Record<string, HorizonSpec> = {
  // ---- şehir dışı: +z yönünde şehir silüeti
  office: { ...COUNTRY, sides: [S("hills"), S("forest"), S("city"), S("hills")] },
  mall: { ...COUNTRY, sides: [S("forest"), S("hills"), S("city"), S("city")] },
  cafe: { ...COUNTRY, sides: [S("hills"), S("city"), S("city"), S("forest")], walls: ["#D9B99B", "#C9A27C", "#E6CBB0", "#B98E6E", "#E9DCC4"], glass: "#6B5A4A" },
  home: { ...COUNTRY, sides: [S("hills"), S("forest"), S("city"), S("hills")] },
  school: { ...COUNTRY, sides: [S("forest"), S("hills"), S("city"), S("hills")] },
  park: { ...COUNTRY, sides: [S("forest"), S("forest"), S("city"), S("forest")] },
  camp: { ...COUNTRY, ground: "#355E2E", hill: ["#2E4F2A", "#253F22"], sides: [S("peaks"), S("forest"), S("forest"), S("forest")] },
  battlefield: { ...COUNTRY, ground: "#7FA23A", sides: [S("hills"), S("hills"), S("hills"), S("hills")] },
  snow: { ...COUNTRY, ground: "#E8EEF5", hill: ["#DCE6F0", "#C9D6E3"], sides: [S("peaks"), S("peaks"), S("forest"), S("peaks")] },
  beach: { ...COUNTRY, ground: "#EBD9A8", hill: ["#D9C48E", "#CBB47C"], sides: [S("none"), S("dunes"), S("dunes"), S("dunes")] },
  // ---- şehir (taban iskelesi +z kenarında: su güneyde). Paletler cityPano.ts PALETTES ile aynı aile.
  // İstanbul — Galata'dan güneyde Haliç ve karşıda kubbeli tarihî yarımada, doğuda Boğaz, asma köprü ve Anadolu yakası tepeleri;
  // kuzey/batı Beyoğlu çatıları ve tepeler
  istanbul: {
    ground: "#9A8F80", hill: ["#8E9C78", "#7F8C6C"], walls: ["#E3D3B8", "#D9B99B", "#CDB28E", "#E9DCC4", "#C9C2B2", "#E6CBB0"],
    roofs: ["#9C4A3A", "#8F4636", "#7A3F31"], glass: "#6B6258", water: "#3C86AE", low: [2.2, 4.2], tall: [3.5, 6.5], backH: [6, 9],
    sides: [S("city", { back: "hills" }),
      S("shore", { back: "hills", items: [{ kind: "bridge", at: -0.05, w: 26 }] }),
      S("shore", { back: "hills", items: [{ kind: "domes", at: -0.2, scale: 1.25, minarets: 4 }, { kind: "domes", at: 0.18, scale: 1.05, minarets: 2 }, { kind: "round", at: 0.38, scale: 0.8 }] }),
      S("city", { back: "hills" })],
  },
  // Kapadokya — su yok: peribacaları ve tüf sırtları, alçak kasaba
  kapadokya: {
    ground: "#C9AE86", hill: ["#D4B48C", "#C29E74"], walls: ["#E3C9A3", "#D9B48A", "#CDA57A", "#E8D2B0"], roofs: ["#B98A5E", "#A87B52"],
    glass: "#7A5E44", low: [1.4, 2.6], tall: [2, 3.4], backH: [7, 11],
    sides: [S("rocks", { back: "rocks" }), S("city", { back: "rocks" }), S("rocks", { back: "rocks", items: [{ kind: "hill", at: 0.15, w: 22, h: 6, color: "#D4B48C" }] }), S("city", { back: "rocks" })],
  },
  // Londra — güneyde nehir ve köprü, karşıda tuğla sıralar, doğuda finans kuleleri
  londra: {
    ground: "#8C8780", hill: ["#7F9470", "#718662"], walls: ["#B9876A", "#A9745A", "#CFC3AE", "#9C8C7A", "#C8B9A0"], roofs: ["#55606B", "#6E5A4E"],
    glass: "#5A6B7C", water: "#55788C", low: [2.6, 4.6], tall: [5, 10], backH: [6, 8],
    sides: [S("city", { back: "hills" }), S("city", { back: "hills" }), S("river", { back: "hills", items: [{ kind: "bridge", at: -0.15, w: 18 }, { kind: "round", at: 0.3, scale: 0.8 }] }), S("city", { back: "hills" })],
  },
  ...fullHorizons(S, COUNTRY),
};
const WATER_W: Record<WaterKind, number> = { shore: 28, river: 20, sea: 0 };
/** iki rengin karışımı (t: 0 → a, 1 → b) */
const mixHex = (a: string, b: string, t: number) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0").toUpperCase()}`;
};
const isWater = (k: SideKind): k is WaterKind => k === "shore" || k === "river" || k === "sea";

const cache = new Map<string, Block[]>();
/** Denetim (önbellek boşaltma). */
export function clearSurroundCache() { cache.clear(); metaCache.clear(); }

/** HORIZON — dürbün kadrajı için çevrenin anlamlı odakları (TABAN çerçevesi): simge silüetleri (`item`), şehir bandının yüksek
 *  çekirdeği (`skyline`), su şeridi (`water`). */
export interface SurroundFocus { kind: "item" | "skyline" | "water"; x0: number; x1: number; z0: number; z1: number; y1: number }
/** Çevrenin tepe/orman/dağ renkleri (dürbün bunlara kadraj kurmaz) ve odakları; `sceneSurround` ile birlikte hesaplanır. */
export interface SurroundMeta { hill: Set<string>; focus: SurroundFocus[] }
const metaCache = new Map<string, SurroundMeta>();
/** Sahnenin çevre bilgisi (`sceneSurround` daha önce çağrılmadıysa null). */
export const surroundMeta = (scene: string): SurroundMeta | null => metaCache.get(scene) ?? null;

/** Sahnenin ufuk tarifi (yoksa null: deniz/uzay/gökyüzü adası/resif — taban kendi okyanus/boşluğunu taşır). */
export const horizonOf = (scene: string): HorizonSpec | null => HORIZONS[scene] ?? null;

/**
 * Sahnenin panorama çevresi (TABAN çerçevesi bloklar): çevre arazisinin ilk halkaları + zemin/su + ufuk bandı. Bilinmeyen sahnede
 * ya da çevre üreteci kuramazsa yalnız ufuk (o da yoksa boş). `base`: taban dünya (placement.ts `baseWorld`).
 */
export function sceneSurround(scene: string, base: Built | null): Block[] {
  if (!base) return [];
  const hit = cache.get(scene);
  if (hit) return hit;
  const out: Block[] = [];
  const meta: SurroundMeta = { hill: new Set(), focus: [] };
  metaCache.set(scene, meta);
  const spec = horizonOf(scene);
  const rings = isNonCityScene(scene) ? SURROUND_RINGS : CITY_SURROUND_RINGS;
  const water = spec ? spec.sides.map((s) => isWater(s.kind)) : [false, false, false, false];
  // taban kutusu (karo) ve halka kutusu (parsel hizası)
  let box = { i0: 0, j0: 0, i1: base.width, j1: base.depth };
  const covered: { i0: number; j0: number; i1: number; j1: number }[] = [];
  let ringOut = { i0: box.i0 - rings * PW, j0: box.j0 - rings * PD, i1: box.i1 + rings * PW, j1: box.j1 + rings * PD };
  let groundColor = spec?.ground ?? null;
  let waterTop = -0.08;
  try {
    const def = sceneDef(scene);
    const ctx = expanseContext(def, base, { radius: rings + 1, base });
    groundColor ??= ctx.pal.ground[0];
    if (Number.isFinite(ctx.waterTop)) waterTop = Math.min(-0.02, ctx.waterTop);
    const [oi, oj] = ctx.origin;
    box = { i0: ctx.box.i0 + oi, j0: ctx.box.j0 + oj, i1: ctx.box.i1 + oi, j1: ctx.box.j1 + oj };
    const c0 = Math.floor(ctx.box.i0 / PW) - rings, c1 = Math.ceil(ctx.box.i1 / PW) + rings;
    const r0 = Math.floor(ctx.box.j0 / PD) - rings, r1 = Math.ceil(ctx.box.j1 / PD) + rings;
    ringOut = { i0: c0 * PW + oi, i1: c1 * PW + oi, j0: r0 * PD + oj, j1: r1 * PD + oj };
    for (const p of openParcels(ctx, rings)) {
      const rect = { i0: p.cx * PW + oi, i1: p.cx * PW + PW + oi, j0: p.cz * PD + oj, j1: p.cz * PD + PD + oj };
      // su yönündeki parsel (tabanın o kenarının ötesinde) konmaz: su kenardan başlar
      if ((water[0] && rect.j1 <= box.j0) || (water[1] && rect.i0 >= box.i1) || (water[2] && rect.j0 >= box.j1) || (water[3] && rect.i1 <= box.i0)) continue;
      const par = generateParcel(ctx, p.cx, p.cz, p.ring <= 1 ? "both" : "far");
      if (!par) continue;
      covered.push(rect);
      const list = p.ring <= 1 ? par.near?.blocks ?? par.far.blocks : par.far.blocks;
      for (const b of list) out.push({ p: [b.p[0], b.p[1], b.p[2]], s: [b.s[0], b.s[1], b.s[2]], c: b.c, g: b.g, j: b.j });
    }
  } catch {
    /* çevre bağlamı kurulamadı (deneme dünyası): yalnız zemin + ufuk bandı */
  }
  if (spec) {
    // yön başına: halkanın (ya da su yönünde tabanın) kenarından bandın çizgisine uzaklık ve zeminin dış ucu (karo)
    const ringD = [box.j0 - ringOut.j0, ringOut.i1 - box.i1, ringOut.j1 - box.j1, box.i0 - ringOut.i0];
    const sides = spec.sides.map((s, k) => {
      const wet = isWater(s.kind);
      const ww = s.kind === "sea" ? 64 : wet ? WATER_W[s.kind as WaterKind] : 0;
      const start = wet ? 0 : ringD[k];
      const line = wet ? ww + HORIZON_DEPTH / 2 : start + HORIZON_GAP + HORIZON_DEPTH / 2;
      const ext = (s.kind === "sea" ? ww : line + HORIZON_DEPTH / 2) + (s.back ? 14 : 4);
      return { ...s, wet, ww, line, ext };
    });
    groundRaster(out, box, covered, sides, groundColor ?? spec.ground, spec.water ?? "#3E8DB5", waterTop);
    horizon(out, spec, box, sides, scene, meta);
  }
  if (out.length > SURROUND_MAX_BLOCKS) out.length = SURROUND_MAX_BLOCKS;
  cache.set(scene, out);
  return out;
}

type SideOut = SideSpec & { wet: boolean; ww: number; line: number; ext: number };
type TileRect = { i0: number; j0: number; i1: number; j1: number };

/**
 * Zemin ve su: tabanın ve halka parsellerinin dışı, yön başına `ext` karoya dek CELL × CELL hücre; su yönünde kenardan `ww` karo su
 * (açık denizde hepsi). Satır boyunca aynı türden hücreler tek levha (üst üste binme yok → z-fight yok). Zemin üstü y = 0, su üstü
 * `waterTop`.
 */
function groundRaster(out: Block[], box: TileRect, covered: TileRect[], sides: SideOut[], ground: string, waterColor: string, waterTop: number) {
  const snap = (v: number, up: boolean) => (up ? Math.ceil(v / CELL) : Math.floor(v / CELL)) * CELL;
  const I0 = snap(box.i0 - sides[3].ext, false), I1 = snap(box.i1 + sides[1].ext, true);
  const J0 = snap(box.j0 - sides[0].ext, false), J1 = snap(box.j1 + sides[2].ext, true);
  const inside = (r: TileRect, i: number, j: number) => i >= r.i0 && i + CELL <= r.i1 && j >= r.j0 && j + CELL <= r.j1;
  // hücre türü: 0 yok (taban/parsel/sınır dışı), 1 zemin, 2 su
  const kind = (i: number, j: number): number => {
    if (inside(box, i, j) || covered.some((r) => inside(r, i, j))) return 0;
    const ci = i + CELL / 2, cj = j + CELL / 2;
    // yön başına tabanın kenarından dışa uzaklık (içerideyse ≤ 0)
    const d = [box.j0 - cj, ci - box.i1, cj - box.j1, box.i0 - ci];
    for (let k = 0; k < 4; k++) if (d[k] > sides[k].ext) return 0;
    for (let k = 0; k < 4; k++) if (sides[k].wet && d[k] > 0 && d[k] <= sides[k].ww) return 2;
    return 1;
  };
  for (let j = J0; j < J1; j += CELL) {
    let run = 0, start = I0;
    const flush = (end: number) => {
      if (run) {
        const x0 = tx(start) - 0.5, x1 = tx(end) - 0.5, z0 = tz(j) - 0.5;
        const top = run === 2 ? waterTop : 0;
        out.push({ p: [+((x0 + x1) / 2).toFixed(3), +(top - 0.15).toFixed(3), +(z0 + CELL / 2).toFixed(3)], s: [x1 - x0, 0.3, CELL], c: run === 2 ? waterColor : ground, g: "solid", j: 0.02 });
      }
    };
    for (let i = I0; i <= I1; i += CELL) {
      const k = i < I1 ? kind(i, j) : -1;
      if (k !== run) { flush(i); run = k; start = i; }
    }
  }
}

/** Ufuk: dört yönde silüet (bina sıraları / tepe / orman / dağ / peribacası), simgeler ve arka tepe sırası. Bloklar zemine oturur. */
function horizon(out: Block[], spec: HorizonSpec, box: TileRect, sides: SideOut[], scene: string, meta: SurroundMeta) {
  const r = rng(0x5ce7e + [...scene].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7));
  const sky = sceneDef(scene).sky;
  /** blok kümesinin taban çerçevesi kutusu → odak */
  const focusOf = (bs: Block[], kind: SurroundFocus["kind"]) => {
    if (!bs.length) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = 0;
    for (const b of bs) {
      x0 = Math.min(x0, b.p[0] - b.s[0] / 2); x1 = Math.max(x1, b.p[0] + b.s[0] / 2);
      z0 = Math.min(z0, b.p[2] - b.s[2] / 2); z1 = Math.max(z1, b.p[2] + b.s[2] / 2); y1 = Math.max(y1, b.p[1] + b.s[1] / 2);
    }
    meta.focus.push({ kind, x0, x1, z0, z1, y1 });
  };
  const box3 = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, j = 0.04) =>
    out.push({ p: [+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)], s: [+w.toFixed(3), +h.toFixed(3), +d.toFixed(3)], c, g: "solid", j });
  // taban kutusunun dünya kenarları
  const ex = { x0: tx(box.i0) - 0.5, x1: tx(box.i1) - 0.5, z0: tz(box.j0) - 0.5, z1: tz(box.j1) - 0.5 };
  const lines: { along: [number, number]; at: (u: number, v: number) => [number, number]; rot: boolean }[] = [
    { along: [ex.x0 - sides[3].line + 4, ex.x1 + sides[1].line - 4], at: (u, v) => [u, ex.z0 - sides[0].line - v], rot: false },
    { along: [ex.z0 - sides[0].line + HORIZON_DEPTH, ex.z1 + sides[2].line - HORIZON_DEPTH], at: (u, v) => [ex.x1 + sides[1].line + v, u], rot: true },
    { along: [ex.x0 - sides[3].line + 4, ex.x1 + sides[1].line - 4], at: (u, v) => [u, ex.z1 + sides[2].line + v], rot: false },
    { along: [ex.z0 - sides[0].line + HORIZON_DEPTH, ex.z1 + sides[2].line - HORIZON_DEPTH], at: (u, v) => [ex.x0 - sides[3].line - v, u], rot: true },
  ];
  const low = spec.low ?? [2.6, 6], tall = spec.tall ?? [4, 18], backH = spec.backH ?? [3, 5];
  sides.forEach((side, k) => {
    const L = lines[k];
    const put = (u: number, v: number, w: number, h: number, d: number, c: string, y0 = 0, j = 0.04) => {
      const [x, z] = L.at(u, v);
      if (L.rot) box3(x, y0 + h / 2, z, d, h, w, c, j); else box3(x, y0 + h / 2, z, w, h, d, c, j);
    };
    const [a0, a1] = L.along, span = a1 - a0, mid = (a0 + a1) / 2;
    // HORIZON (ürün sahibi: "tepeler kaba düz levhalar"): sırt iki kutu değil, kademeli tepe — 3–4 kademe (geniş etek → dar doruk, her
    // kademe biraz geride ve yana kaymış), tepeden tepeye değişen boy (arada alçak tepe), uzaklıkla gök rengine açılan ton (öndeki
    // sırt %14, arka sırt %32; üst kademeler biraz daha açık) ve eteğin ön omzunda seyrek ağaç noktaları. Renkler `meta.hill`e
    // yazılır: dürbün kadrajı tepeye kurulmaz (lookout.ts).
    const hillC = (c: string) => { meta.hill.add(c); return c; };
    const ridge = (kind: "hills" | "dunes" | "peaks" | "rocks", v0: number, hr: [number, number] | null, back = false) => {
      for (let u = a0; u < a1;) {
        const w = 8 + r() * 9;
        let h = hr ? hr[0] + r() * (hr[1] - hr[0]) : kind === "peaks" ? 5 + r() * 7 : kind === "dunes" ? 1 + r() * 1.6 : kind === "rocks" ? 3 + r() * 4 : 2 + r() * 3;
        if (r() < 0.3) h *= 0.6; // arada alçak tepe: sırt çizgisi dalgalı
        const base = spec.hill[Math.floor(r() * 2)];
        const fog = back ? 0.32 : 0.14;
        const tiers = kind === "dunes" ? 2 : 3 + (r() < 0.5 ? 1 : 0);
        const cu = u + w / 2, cv = v0 + r() * 3 - 1.5;
        let y = 0, tw0 = w, td0 = 8, th0 = 0;
        for (let k = 0; k < tiers; k++) {
          const f = 1 - k / tiers;
          const tw = w * (0.3 + 0.7 * f) * (0.9 + r() * 0.2), td = 8 * (0.4 + 0.6 * f);
          const th = h * (k === 0 ? 0.4 : 0.6 / (tiers - 1)) * (0.85 + r() * 0.3);
          if (k === 0) { tw0 = tw; td0 = td; th0 = th; }
          put(cu + (r() - 0.5) * w * 0.1 * k, cv + k * 0.5, tw, th, td, hillC(mixHex(base, sky, fog + k * 0.04)), y);
          y += th;
        }
        if (kind === "peaks" && !hr) put(cu, cv + tiers * 0.5, w * 0.18, h * 0.16, 1.6, hillC("#F4F7FB"), y);
        // eteğin ön omzunda (ikinci kademenin önünde, ilk kademenin üstünde) seyrek ağaç noktaları
        if (kind === "hills" && !back && r() < 0.65) {
          const n = 1 + Math.floor(r() * 3);
          for (let t = 0; t < n; t++) put(cu + (r() - 0.5) * tw0 * 0.7, cv - td0 / 2 + 0.7, 0.9, 0.9 + r() * 0.5, 0.9, hillC(mixHex(spec.hill[1], "#1F3A22", 0.35)), th0);
        }
        if (kind === "rocks") {
          // peribacası: daralan tüf gövde + koyu bazalt şapka (genel biçim)
          for (let n = 0; n < 3; n++) {
            const cx = u + w * (0.15 + r() * 0.7), cv2 = v0 - 5 - r() * 3, ch = 2 + r() * 2.6, cw = 0.9 + r() * 0.6;
            put(cx, cv2, cw, ch * 0.6, cw, spec.walls[Math.floor(r() * spec.walls.length)]);
            put(cx, cv2, cw * 0.65, ch * 0.4, cw * 0.65, spec.walls[0], ch * 0.6);
            put(cx, cv2, cw * 0.8, 0.3, cw * 0.8, "#6E5A48", ch);
          }
        }
        u += w * (0.7 + r() * 0.3);
      }
    };
    const forest = (v0: number) => {
      for (let u = a0; u < a1;) {
        const w = 2 + r() * 2.4, h = 2.6 + r() * 2.6, v = v0 + r() * 6 - 3;
        put(u + w / 2, v, 0.5, h * 0.35, 0.5, hillC("#6B4A2F"));
        put(u + w / 2, v, w, h * 0.65, w, hillC(spec.hill[Math.floor(r() * 2)]), h * 0.35);
        u += w * (0.6 + r() * 0.5);
      }
    };
    // şehir silüeti: önde alçak bloklar, arkada kuleler; kuleler bandın ortasında toplanır, uçlara doğru alçalır; pencere bantları
    // kameraya bakan yüzde (ön yüz −v); çatı başlığı (paletin çatı rengi) alçak bloklarda
    const city = (v0: number, shrink: number) => {
      for (let row = 0; row < 2; row++) {
        for (let u = a0; u < a1;) {
          const w = 2.4 + r() * 3.2, d = 3 + r() * 2;
          const core = Math.max(0, 1 - Math.abs((u - a0) / span - 0.5) * 2.2);
          const h = (row === 0 ? low[0] + r() * (low[1] - low[0]) : tall[0] + core * (tall[1] - tall[0]) * (0.6 + r() * 0.4) + r() * 1.5) * shrink;
          const v = v0 + row * 5 - 3 + r() * 1.2;
          const c = spec.walls[Math.floor(r() * spec.walls.length)];
          put(u + w / 2, v, w, h, d, c);
          if (spec.roofs && row === 0 && r() < 0.7) put(u + w / 2, v, w + 0.12, 0.36, d + 0.1, spec.roofs[Math.floor(r() * spec.roofs.length)], h);
          for (let y = 1.1; y < h - 0.6; y += 1.6) put(u + w / 2, v - d / 2 - 0.03, w * 0.82, 0.32, 0.06, spec.glass, y, 0);
          u += w + 0.5 + r() * 1.4;
        }
      }
    };
    const items = (v0: number) => {
      if (!side.items?.length) return;
      const fake = { backdrop: [] as Block[], zones: [] as unknown[] } as unknown as Builder;
      const style = { far: spec.walls, roofColor: (spec.roofs ?? spec.walls)[0] } as unknown as CityStyle;
      for (const it of side.items) {
        if (it.kind === "mount") {
          // uzak dağ: kademeli koni (5 kademe) + karlı tepe (isteğe bağlı)
          const x = mid + it.at * span;
          for (let n = 0; n < 5; n++) {
            const f = 1 - n * 0.19;
            put(x, v0 + 6, it.w * f, it.h / 5, it.w * f * 0.5, hillC(spec.hill[n % 2]), (it.h / 5) * n);
          }
          if (it.cap) put(x, v0 + 6, it.w * 0.24, it.h * 0.14, it.w * 0.12, hillC(it.cap), it.h * 0.86);
          continue;
        }
        const { at, ...rest } = it;
        silhouette(fake, style, { ...rest, x: 0 } as Silhouette, 0);
        const x = mid + at * span, n0 = out.length;
        for (const b of (fake as unknown as { backdrop: Block[] }).backdrop.splice(0)) put(x + b.p[0], v0 - 1 - b.p[2], b.s[0], b.s[1], b.s[2], b.c, b.p[1] - b.s[1] / 2, b.j);
        focusOf(out.slice(n0), "item");
      }
    };
    const v0 = 0;
    const n0 = out.length;
    switch (side.kind) {
      case "none": return;
      case "hills": case "dunes": case "peaks": case "rocks": ridge(side.kind, v0, null); break;
      case "forest": forest(v0); break;
      case "city": city(v0, 1); break;
      case "shore": case "river": city(v0, 0.85); break;
      case "sea": break;
    }
    // dürbünün odak adayları: şehir bandının yüksek çekirdeği (kuleler bandın ortasında toplanır) ve su şeridi
    if (side.kind === "city" || side.kind === "shore" || side.kind === "river")
      focusOf(out.slice(n0).filter((b) => Math.abs((L.rot ? b.p[2] : b.p[0]) - mid) <= span * 0.2), "skyline");
    if (side.wet && side.ww > 0) {
      const [wx, wz] = L.at(mid, -side.line + side.ww / 2), half = span * 0.2;
      meta.focus.push(L.rot ? { kind: "water", x0: wx - side.ww / 2, x1: wx + side.ww / 2, z0: wz - half, z1: wz + half, y1: 0 }
        : { kind: "water", x0: wx - half, x1: wx + half, z0: wz - side.ww / 2, z1: wz + side.ww / 2, y1: 0 });
    }
    items(v0);
    if (side.back) ridge(side.back, v0 + HORIZON_DEPTH / 2 + 6, backH, true);
  });
}
