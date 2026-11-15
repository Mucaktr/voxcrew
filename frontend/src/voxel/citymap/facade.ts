/**
 * CORE-CITYMAP (kalite seferberliği 2026-10-28, kök neden N2) — semt binalarının cephe kütüphanesi.
 *
 * Eskiden her semt binası = duvar kutusu + çatı + ön yüzde tek alçak cam şerit (district.ts). Şimdi her bina şehrin stilinden
 * (`city/styles/<şehir>.ts`, `cities/<şehir>/style.ts` renkleri) ve şehre özgü bir **mimari tipten** (`Arch`) çizilir:
 * - kat başına pencere sırası: bütün yüzleri saran ince koyu bant (1 kutu / kat) + bantı pencerelere bölen **ayırıcı levhalar**
 * (binanın içinden geçen ince dikey kutu: ön ve arka yüzde aynı anda pencere arası ayak olur) → her görünen yüzde kat kat pencere;
 * - sokak katında kapılar (geçen levha: iki karşı yüzde birer kapı), dükkân camı ya da ev penceresi; sokak katındaki her şey
 * yüzden ≤ 0,04 taşar (taksi koridoru `citymap/taxi.ts` EDGE_EPS, avatar yürüyüşü), çıkıntılar yalnız ≥ 1,5 yükseklikte;
 * - tipe göre korniş/denizlik, balkon (sürekli demir balkon: Eixample her katta, Haussmann 2. ve son katta), cumba (İstanbul üst kat
 * çıkması), kanal evi basamaklı alınlıkları (<city>), mansart çatı ve çatı pencereleri (<city>), tuğla sıra ev bacaları ve sıvalı
 * zemin kat (Londra), tabela levhaları ve tente (<city>, <city>, <city>; yazısız), yangın merdiveni ve su deposu (<city>),
 * mazgallı çatı (Marakeş), kıvrık saçak (hanok), revaklı sokak katı (<city> dükkân evi).
 * Bütçe: parsel yakın yuvası (CITY_NEAR_BUDGET, CITY-MAP-BUDGET-001 düşen 0) — district.ts önce zorunlu blokları (zemin, landmark,
 * süs, ağaç, durak, lamba) yazar, kalan katı yuvayı binalara dağıtır: her bina ayrıntı 2'den başlar, sığmazsa en çok blok kullanan
 * bina bir kademe iner (2 → 1 → 0 → −1). Kademe 0 bile kat kat pencere bandı ve kapı taşır; −1 (eski gövde + çatı) yalnız landmarkı
 * bütçeyi dolduran parselde yedektir (cephe testi sayar ve sınırlar). Yalnız `solid` grup (+0 çizim çağrısı; cam ve
 * parıltı yuvaları landmark ve lambalara kalır). Yazı, logo, bayrak yok. Saf modül: React/three yok; aynı girdi → aynı çıktı.
*/
import type { Block } from "../scenes";
import type { CityStyle } from "../city/style";
import type { DistrictTheme } from "./format";
import { ISTANBUL_STYLE } from "../city/styles/istanbul";
import { KAPADOKYA_STYLE } from "../city/styles/kapadokya";
import { LONDRA_STYLE } from "../city/styles/londra";
import { DEFAULT_CITY } from "../city/style";
import { withFullFacade } from "../../full/facade";

/** Mimari tip (şehre özgü cephe dili). */
export type Arch = "eixample" | "canal" | "haussmann" | "terrace" | "ottoman" | "shopfront" | "walkup" | "colonial" | "cave" | "riad"
  | "shophouse" | "hanok" | "generic";

type Roof = "parapet" | "pitched" | "hipped" | "mansard" | "gables" | "curved" | "crenel" | "cornice";
interface ArchSpec {
  /** pencere aralığı (karo) ve pencere arası ayak genişliği */
  pitch: number; pil: number;
  /** pencere yüksekliği / kat */
  win: number;
  /** sokak katı: dükkân camı, ev penceresi, sıvalı zemin kat (Londra), revak (dükkân evi) */
  ground: "shop" | "house" | "stucco" | "arcade";
  roof: Roof;
  /** ayak rengi: duvar ya da söve (beyaz pencere çerçevesi) */
  frame: "wall" | "trim";
  balcony?: "all" | "noble";
  /** üst katlar çıkma (cumba / dükkân evi) */
  overhang?: number;
  sills?: boolean;
  signs?: boolean;
  awning?: boolean;
  chimneys?: boolean;
  fireEscape?: boolean;
  tank?: boolean;
}

export const ARCH_SPECS: Readonly<Record<Arch, ArchSpec>> = {
  // <city> Eixample: uzun Fransız pencereleri, her üst katta demir balkon, düz teras çatı (azotea) korkuluğu, dükkânlı zemin
  eixample: { pitch: 1.0, pil: 0.38, win: 0.62, ground: "shop", roof: "parapet", frame: "wall", balcony: "all", sills: true, awning: true },
  // <city> kanal evi: dar ev birimleri, büyük beyaz çerçeveli pencereler, basamaklı alınlık
  canal: { pitch: 0.75, pil: 0.2, win: 0.5, ground: "house", roof: "gables", frame: "trim" },
  // <city> Haussmann: krem taş, dükkânlı zemin, 2. ve son katta sürekli balkon, mansart çatı + çatı pencereleri
  haussmann: { pitch: 1.0, pil: 0.42, win: 0.58, ground: "shop", roof: "mansard", frame: "wall", balcony: "noble", sills: true },
  // Londra tuğla sıra ev: beyaz denizlik, sıvalı zemin kat, arduvaz beşik çatı ve baca sırası
  terrace: { pitch: 1.0, pil: 0.45, win: 0.55, ground: "stucco", roof: "pitched", frame: "wall", sills: true, chimneys: true },
  // İstanbul ahşap ev: üst kat çıkması (cumba), dar sık pencere, kiremit kırma çatı
  ottoman: { pitch: 0.8, pil: 0.28, win: 0.56, ground: "house", roof: "hipped", frame: "trim", overhang: 0.15 },
  // <city>/<city> dükkân sırası: dükkân camı, tente, dikey tabela levhaları (yazısız), düz çatı ve çatı odası
  shopfront: { pitch: 1.2, pil: 0.24, win: 0.5, ground: "shop", roof: "parapet", frame: "wall", signs: true, awning: true },
  // <city> tuğla apartman: dükkânlı zemin, yangın merdiveni, ağır korniş, su deposu
  walkup: { pitch: 0.9, pil: 0.34, win: 0.56, ground: "shop", roof: "cornice", frame: "wall", sills: true, fireEscape: true, tank: true },
  // <city> sömürge cephesi: beyaz söveli yüksek pencereler, birinci katta demir balkon, kiremit çatı
  colonial: { pitch: 1.2, pil: 0.36, win: 0.6, ground: "house", roof: "pitched", frame: "trim", balcony: "noble" },
  // Kapadokya/<city> taş ev: küçük seyrek pencereler, düz taş çatı
  cave: { pitch: 1.6, pil: 0.95, win: 0.36, ground: "house", roof: "parapet", frame: "wall" },
  // Marakeş/<city>/<city>/<city> avlu evi: seyrek küçük pencere, mazgallı düz çatı
  riad: { pitch: 2.0, pil: 1.45, win: 0.32, ground: "house", roof: "crenel", frame: "wall" },
  // <city>/<city>/Şanghay dükkân evi: revaklı sokak katı, üst kat çıkması, panjurlu pencere, kiremit çatı
  shophouse: { pitch: 0.9, pil: 0.34, win: 0.56, ground: "arcade", roof: "pitched", frame: "trim", overhang: 0.12 },
  // <city>/<city> geleneksel ev: alçak, kıvrık saçaklı koyu kiremit çatı
  hanok: { pitch: 1.3, pil: 0.5, win: 0.45, ground: "house", roof: "curved", frame: "trim" },
  generic: { pitch: 1.0, pil: 0.4, win: 0.5, ground: "house", roof: "parapet", frame: "wall", sills: true },
};

export interface FacadeStyle { arch: Arch; spec: ArchSpec; walls: readonly string[]; trim: string; window: string; door: string; roof: string; awnings: readonly string[]; iron: string }

/** Harita kimliği → şehir stili ve mimari tip (tema geçersiz kılması: geleneksel semtler). */
/** `walls`: semt cephesi paleti (stilin tabandaki duvar renkleri yerine; tek tonlu krem paletli şehirde komşular ayırt edilir).*/
export interface CityFacadeEntry { style: CityStyle; arch: Arch; themes?: Partial<Record<DistrictTheme, Arch>>; walls?: readonly string[] }
const CITY: Readonly<Record<string, CityFacadeEntry>> = withFullFacade({
  // Haussmann taşı tek krem değil — krem, gri taş, bal rengi, açık okr ve kum (taban sahnenin stili değişmez)
  londra: { style: LONDRA_STYLE, arch: "terrace" },
  istanbul: { style: ISTANBUL_STYLE, arch: "ottoman", themes: { modern: "generic" } },
  kapadokya: { style: KAPADOKYA_STYLE, arch: "cave" },
});

/** Şehir + semt teması → cephe stili (bilinmeyen harita: nötr stil, `generic`). */
export function facadeStyle(mapId: string, theme: DistrictTheme): FacadeStyle {
  const c = CITY[mapId];
  const st = c?.style ?? DEFAULT_CITY, arch = c?.themes?.[theme] ?? c?.arch ?? "generic";
  return { arch, spec: ARCH_SPECS[arch], walls: c?.walls ?? st.walls, trim: st.trim, window: st.window, door: st.door, roof: st.roofColor, awnings: st.awnings, iron: st.lamp.post };
}
/** Denetim: cephe tipi tanımlı haritalar. */
export const FACADE_CITIES: readonly string[] = Object.keys(CITY);

/** Cephe girdisi (district.ts `DistrictBuilding` ile uyumlu). */
export interface FacadeBuilding { i0: number; j0: number; w: number; d: number; h: number; wall: string; roof: string; rock?: boolean; /** cephe çeşidi (district.ts komşuya göre atar)*/ fv?: number }

/**
 * (ürün sahibi 2026-11-05 "aynı çizgili cephe çoğu binada"): şehrin mimari tipi (`ArchSpec`) hâlâ tek; her bina ona bir ÇEŞİT uygular
 * (ayak kalınlığı = pencere genişliği ritmi, pencere boyu, ayak/söve rengi, sokak katı, kat silmesi). Pencere aralığı (`pitch`) çeşitle değişmez:
 * pencere sayısı = blok sayısı; parsel blok sayıları değişince akış sırası kayar (POP-IN-001, <city>). Çeşitler tipin çarpanıdır: şehrin karakteri
 * (Londra tuğla sıra ev, İstanbul cumbalı ev…) korunur, yalnız ritim ve renk değişir. Komşu binalar farklı çeşit alır (district.ts).
*/
export interface FacadeVariant {
  pitch: number; pil: number; win: number;
  /** ayak/söve rengi: "" = tipin kendi kuralı */
  frame: "" | "wall" | "trim" | "dark" | "light";
  ground?: "shop" | "stucco" | "house";
  /** kat silmesi: 0 yok, 1 yalnız zemin üstü, 2 her kat */
  course: 0 | 1 | 2;
}
export const FACADE_VARIANTS: readonly FacadeVariant[] = [
  { pitch: 1, pil: 1, win: 1, frame: "", course: 0 },
  { pitch: 1, pil: 1, win: 1, frame: "light", course: 0 },
  { pitch: 1, pil: 0.85, win: 0.92, frame: "dark", course: 1 },
  { pitch: 1, pil: 0.75, win: 0.95, frame: "trim", course: 2 },
  { pitch: 1, pil: 1, win: 0.85, frame: "trim", ground: "shop", course: 1 },
  { pitch: 1, pil: 1, win: 0.9, frame: "wall", ground: "stucco", course: 2 },
];
/** Çeşit değişmeyen tipler (kaya/avlu/geleneksel alçak ev: zemin katı ve ritmi tipin kendi dili). */
const FIXED_GROUND: ReadonlySet<Arch> = new Set(["cave", "riad", "hanok", "shophouse", "eixample", "canal"]);
const variantOf = (bd: FacadeBuilding): FacadeVariant => FACADE_VARIANTS[(bd.fv ?? h32(bd.i0 * 131 + bd.j0 * 17, 7)) % FACADE_VARIANTS.length];
function specOf(st: FacadeStyle, v: FacadeVariant): ArchSpec {
  const sp = st.spec, pitch = sp.pitch * v.pitch;
  return { ...sp, pitch, pil: v.pil === 1 ? sp.pil : Math.min(sp.pil * v.pil, pitch * 0.62), win: sp.win * Math.min(1, v.win), ground: v.ground && !FIXED_GROUND.has(st.arch) ? v.ground : sp.ground };
}
/** Cephe tarifi (ritim + renk türü; duvar rengi ve yükseklik hariç): komşu binaların aynı cepheyi tekrar edip etmediğini ölçer. */
export function facadeRecipe(bd: FacadeBuilding, st: FacadeStyle): string {
  if (bd.rock) return "rock";
  const v = variantOf(bd), sp = specOf(st, v);
  return [st.arch, sp.pitch.toFixed(2), sp.pil.toFixed(2), sp.win.toFixed(2), sp.ground, v.frame || sp.frame, v.course].join("|");
}
/** Komşu binalara farklı çeşit atar (açgözlü boyama; belirlenimci). `near`: iki bina arası en çok bu kadar karo boşlukta komşudur. */
export function assignFacadeVariants(list: readonly (FacadeBuilding & { fv?: number })[], near = 3): void {
  const gap = (a: FacadeBuilding, b: FacadeBuilding) => Math.max(0, Math.max(a.i0 - (b.i0 + b.w), b.i0 - (a.i0 + a.w)), Math.max(a.j0 - (b.j0 + b.d), b.j0 - (a.j0 + a.d)));
  list.forEach((bd, k) => {
    if (bd.rock) return;
    const cnt = new Array(FACADE_VARIANTS.length).fill(0);
    for (let q = 0; q < k; q++) if (!list[q].rock && gap(bd, list[q]) <= near) cnt[list[q].fv ?? 0]++;
    const start = h32(bd.i0 * 131 + bd.j0 * 17, 7) % FACADE_VARIANTS.length;
    let best = start;
    for (let o = 1; o < FACADE_VARIANTS.length; o++) { const c = (start + o) % FACADE_VARIANTS.length; if (cnt[c] < cnt[best]) best = c; }
    bd.fv = best;
  });
}
/** 2: tam, 1: sade, 0: gövde + çatı + kat bantları + kapı, −1: yalnız gövde + çatı (bütçe yedeği; denetim sayar). */
export type FacadeTier = -1 | 0 | 1 | 2;

/** Kat düzeni: kat sayısı, sokak katı yüksekliği, üst kat yüksekliği (yürüme ölçeği: kat 1,6–2,0, zemin ≤ 2,2). */
export function storeys(h: number): { n: number; g0: number; S: number } {
  let n = Math.max(1, Math.round(h / 1.8));
  while (n > 1 && h / n < 1.55) n--;
  if (n === 1) return { n, g0: h, S: 0 };
  const g0 = Math.min(2.1, Math.max(1.6, h / n + 0.1));
  return { n, g0, S: (h - g0) / (n - 1) };
}

const h32 = (a: number, b: number) => { let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35); x ^= x >>> 15; return (Math.imul(x, 0x27d4eb2f) ^ (x >>> 13)) >>> 0; };
const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1, 7), 16), c = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, "0").toUpperCase()}`;
};

/** bina başına çatı tonu (aynı malzeme, eskime/ışık farkı) — `u` ∈ [0, 1) tohumdan. Komşu çatılar ayırt edilir (FACADE-VARIETY-002).*/
export const ROOF_TONES: readonly number[] = [1, 0.82, 1.15];
export const roofTone = (base: string, u: number): string => shade(base, ROOF_TONES[Math.min(ROOF_TONES.length - 1, Math.floor(u * ROOF_TONES.length))]);

/** Pencere camı: stilin pencere rengi gökyüzü yansımasıyla açılır (çok koyu stil renkleri kara boşluk gibi okunuyordu). */
const glassCache = new Map<string, string>();
export function glassOf(hex: string): string {
  let g = glassCache.get(hex);
  if (!g) {
    const a = parseInt(hex.slice(1, 7), 16), b = 0x9fb8c8, t = 0.3;
    let [r, gg, bb] = [16, 8, 0].map((s) => ((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
    // cam okunur kalır: koyu (bağıl parlaklık < 0,32) ya da mavimsi; sıcak tonlu stil pencereleri (<city>, <city>) koyulaşır
    const lum = () => (0.2126 * r + 0.7152 * gg + 0.0722 * bb) / 255, blue = () => bb > r + 24 && bb >= gg - 6;
    for (let k = 0; k < 12 && !(lum() < 0.3 || blue()); k++) { r *= 0.9; gg *= 0.9; bb *= 0.9; }
    g = `#${((Math.round(r) << 16) | (Math.round(gg) << 8) | Math.round(bb)).toString(16).padStart(6, "0").toUpperCase()}`;
    glassCache.set(hex, g);
  }
  return g;
}

/**
 * kaya kütlesi (kanyon duvarı, `rock`) — pencere, kapı, korniş yok: ayak izinde yatay tortul kaya bantları
 * (kalınlık 0,9–1,6, sırayla 0 / 0,12 / 0,06 içe çekik, üç ton) ve koyu kaya başlık. Bantlar ayak izinden taşmaz (çarpışma karosu aynı).
*/
function rockBlocks(bd: FacadeBuilding, cx: number, cz: number): Block[] {
  const out: Block[] = [], W = bd.w, D = bd.d, H = bd.h;
  const seed = h32(bd.i0 * 37 + bd.j0, Math.round(H * 100));
  const tones = [bd.wall, shade(bd.wall, 0.9), shade(bd.wall, 1.07)], inset = [0, 0.12, 0.06];
  // dolu kaya çekirdeği (bantların en derin içe çekikliğinden geride; kamera/çarpışma kaynağı tek kütleyi görür, bantlar arası yarık yok)
  out.push({ p: [cx, H / 2, cz], s: [W - 0.36, H, D - 0.36], c: shade(bd.wall, 0.85), g: "solid", j: 0.05 });
  let y = 0;
  for (let k = 0; y < H - 0.05; k++) {
    const t = Math.min(H - y, 0.9 + ((seed >>> (k % 24)) & 7) * 0.1), e = k === 0 ? 0 : inset[k % 3];
    out.push({ p: [cx, y + t / 2, cz], s: [W - 2 * e, t, D - 2 * e], c: tones[(k + seed) % 3], g: "solid", j: 0.05 });
    y += t;
  }
  out.push({ p: [cx, H + 0.1, cz], s: [W - 0.2, 0.2, D - 0.2], c: bd.roof, g: "solid", j: 0.05 });
  return out;
}

/**
 * Bir binanın cephe blokları (dünya koordinatı; `ox`, `oz` semt yerel (0, 0) karosunun sol-arka köşesi). `tier` 2: tam ayrıntı,
 * 1: sade (denizlik/köşe ayağı/çatı süsü yok, pencere aralığı iki kat), 0: gövde + çatı + kat bantları + kapı. Gövde ayak izini
 * doldurur (çarpışma karo kutusu aynı); çıkıntılar (balkon ≥ 1,6 yükseklikte, tente ≥ 1,5) yürüyüş başının üstünde.
 * `far` (uzak LOD: uzak halka + silüet, kuş bakışı; 0 = yakın): 2 → kademe 0 + seyrek pencere ayakları (ritim) + tipin çatısı
 * (mansart/alınlık da), kapı/süs/balkon/sokak katı camı yok; 1 → tek cam kuşak + uzun eksen ayakları + çatı (yoğun parsel yedeği). Kaya
 * kütlesi: gövde + başlık.
*/
export function facadeBlocks(bd: FacadeBuilding, st: FacadeStyle, ox: number, oz: number, tier: FacadeTier, far: 0 | 1 | 2 = 0): Block[] {
  const out: Block[] = [];
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, j = 0) => out.push({ p: [x, y, z], s: [w, h, d], c, g: "solid", j });
  const vr = variantOf(bd), sp = specOf(st, vr), W = bd.w, D = bd.d, H = bd.h;
  const cx = ox + bd.i0 + W / 2, cz = oz + bd.j0 + D / 2;
  if (bd.rock && far) { box(cx, H / 2, cz, W, H, D, bd.wall, 0.05); box(cx, H + 0.1, cz, W - 0.2, 0.2, D - 0.2, bd.roof, 0.05); return out; }
  if (bd.rock) return rockBlocks(bd, cx, cz);
  if (tier < 0) {
    // bütçe yedeği (yoğun landmark parselinde): eski gövde + çatı
    box(cx, H / 2, cz, W, H, D, bd.wall, 0.05);
    box(cx, H + 0.1, cz, W + 0.15, 0.2, D + 0.15, bd.roof, 0.04);
    // uzak yedek (yoğun semt) gövde + çatı + tek pencere bandı — kuş bakışında çıplak kutu değil
    if (far) box(cx, H * 0.58, cz, W + 0.04, Math.min(1.2, H * 0.3), D + 0.04, glassOf(st.window));
    return out;
  }
  const seed = h32(bd.i0 * 31 + bd.j0, Math.round(H * 100));
  const { n, g0, S } = storeys(H);
  const ov = sp.overhang && n >= 2 ? sp.overhang : 0;
  const UW = W + 2 * ov, UD = D + 2 * ov;
  const alongX = W >= D;
  const fk = vr.frame || sp.frame;
  const frame = fk === "trim" ? st.trim : fk === "dark" ? shade(bd.wall, 0.72) : fk === "light" ? shade(bd.wall, 1.14) : shade(bd.wall, 0.94);
  const winC = glassOf(st.window);

  // ---- gövde (kanal evleri: dar ev birimleri, her biri kendi renginde)
  const long = alongX ? W : D, short = alongX ? D : W;
  const units = sp.roof === "gables" && tier > 0 ? Math.max(1, Math.round(long / 1.5)) : 1;
  if (units > 1) {
    const uw = long / units;
    for (let k = 0; k < units; k++) {
      const c = k === 0 ? bd.wall : st.walls[(seed + k) % st.walls.length], u = -long / 2 + (k + 0.5) * uw;
      box(alongX ? cx + u : cx, H / 2, alongX ? cz : cz + u, alongX ? uw : W, H, alongX ? D : uw, c, 0.04);
    }
  } else box(cx, H / 2, cz, W, H, D, bd.wall, 0.05);
  if (ov) {
    box(cx, g0 + (H - g0) / 2, cz, UW, H - g0, UD, bd.wall, 0.04);
    if (tier > 0) box(cx, g0 + 0.05, cz, UW + 0.04, 0.1, UD + 0.04, st.trim, 0.02);
  }

  // ---- sokak katı
  if (sp.ground === "stucco" && tier > 0) box(cx, g0 / 2, cz, W + 0.03, g0, D + 0.03, st.trim, 0.02);
  // sokak katı camı ≤ 1,25 yüksek (pencere/vitrin ölçüsü; kapı 1,3 ayrı)
  const gBot = sp.ground === "shop" ? 0.22 : sp.ground === "arcade" ? 0.12 : 0.55;
  const gTop = Math.min(gBot + 1.25, sp.ground === "shop" ? g0 - 0.45 : sp.ground === "arcade" ? g0 - 0.2 : Math.min(g0 - 0.3, 0.55 + g0 * 0.42));
  if (!far || n === 1) box(cx, (gBot + gTop) / 2, cz, W + 0.04, gTop - gBot, D + 0.04, sp.ground === "arcade" ? "#4A4339" : winC);
  // dükkân: camın üstünde söve renginde tabela kuşağı (yazısız)
  if (sp.ground === "shop" && tier > 0) box(cx, gTop + 0.12, cz, W + 0.05, 0.16, D + 0.05, st.trim, 0.02);
  // ---- üst katlar: kat başına pencere bandı
  const bands: [number, number][] = [];
  for (let k = 1; k < n; k++) {
    // pencere ≤ 1,2 yüksek (yüksek katta da kat başına ayrı pencere okunur)
    const y0 = g0 + (k - 1) * S, wh = Math.min(1.2, S * sp.win), yb = y0 + (S - wh) * 0.55;
    bands.push([yb, yb + wh]);
    if (far !== 1) box(cx, yb + wh / 2, cz, UW + 0.04, wh, UD + 0.04, winC);
  }
  // uzak yedek (yoğun semt): bütün üst katlar tek cam kuşak, ritmi uzun eksen ayakları verir
  if (far === 1 && bands.length) box(cx, (bands[0][0] + bands[bands.length - 1][1]) / 2, cz, UW + 0.04, bands[bands.length - 1][1] - bands[0][0], UD + 0.04, winC);
  // ---- pencere arası ayaklar (binayı boydan geçen levha: iki karşı yüzde birden)
  const pitch = tier === 2 || (far === 2 && sp.pitch >= 1.5) ? sp.pitch : sp.pitch * 2; // uzak: seyrek pencereli tip (avlu/kaya evi) kendi aralığında
  const top = bands.length ? bands[bands.length - 1][1] : gTop;
  const bot = ov ? bands[0]?.[0] ?? gTop : gBot;
  // kanal evleri: uzun eksende birim başına iki pencere; birim sınırında koyu tuğla parti duvarı, ortada beyaz kayıt
  const unitBays = units > 1 ? units * 2 : 0;
  const bayX = alongX && unitBays ? unitBays : Math.max(1, Math.round(UW / pitch));
  const bayZ = !alongX && unitBays ? unitBays : Math.max(1, Math.round(UD / pitch));
  const party = (k: number, along: boolean) => unitBays > 0 && along && k % 2 === 0;
  if ((tier > 0 || far) && top > bot) {
    const hh = top - bot + 0.02, yy = (top + bot) / 2;
    for (let k = 1; k < (far === 1 && !alongX ? 1 : bayX); k++) {
      const pw = party(k, alongX);
      box(cx - UW / 2 + (k * UW) / bayX, yy, cz, pw ? 0.34 : sp.pil, hh, UD + 0.07, pw ? shade(bd.wall, 0.82) : frame, 0.02);
    }
    for (let k = 1; k < (far === 1 && alongX ? 1 : bayZ); k++) {
      const pw = party(k, !alongX);
      box(cx, yy, cz - UD / 2 + (k * UD) / bayZ, UW + 0.07, hh, pw ? 0.34 : sp.pil, pw ? shade(bd.wall, 0.82) : frame, 0.02);
    }
    // revaklı sokak katı (dükkân evi): sokak katında da yüz hizasında sütunlar
    // çıkmalı evlerde sokak katı: yüz hizasında ayaklar (dükkân evi revakı: söve renginde sütun; cumbalı ev: pencere arası)
    if (ov && tier > 0) {
      const arc = sp.ground === "arcade", gh = arc ? g0 : gTop - gBot + 0.02, gy = arc ? g0 / 2 : (gTop + gBot) / 2;
      for (let k = 1; k < bayX; k += tier === 2 ? 1 : 2) if (arc ? k % 2 : true) box(cx - UW / 2 + (k * UW) / bayX, gy, cz, arc ? 0.26 : sp.pil, gh, D + 0.07, arc ? st.trim : frame, 0.02);
    }
    const qp = st.spec.pil;
    if (tier === 2) for (const sx of [-1, 1]) for (const sz of [-1, 1])
      box(cx + sx * (UW / 2 - qp / 2 + 0.035), yy, cz + sz * (UD / 2 - qp / 2 + 0.035), qp, hh, qp, frame, 0.02); // köşe ayağı: tipin kendi kalınlığı (FX-VIEW-002: turnike görüşünde ince direk)
  }
  // ---- kat silmeleri (yüzden 0,05 taşan ince şerit; ayak levhalarıyla aynı düzlemde değil: +0,1)
  if (vr.course && tier > 0 && n >= 2) for (let k = 1; k < n; k++) if (vr.course === 2 || k === 1) box(cx, g0 + (k - 1) * S, cz, UW + 0.1, 0.08, UD + 0.1, st.trim, 0.02);
  // ---- kapılar (sokak katı; geçen levha → iki karşı yüzde birer kapı; kapı 0,62 × 1,3 — scaleStandard "door")
  const doorAt = (L: number) => { const nb = Math.max(1, Math.round(L / sp.pitch)); return -L / 2 + (Math.floor(nb / 2) + 0.5) * (L / nb); };
  if (W >= 1 && !far) box(cx + doorAt(W), 0.65, cz, 0.62, 1.3, D + 0.076, st.door, 0.02);
  if (D >= 3 && !far) box(cx, 0.65, cz + doorAt(D), W + 0.076, 1.3, 0.62, st.door, 0.02);
  // ---- denizlik
  if (tier === 2 && sp.sills) for (const [yb] of bands) box(cx, yb - 0.035, cz, UW + 0.14, 0.07, UD + 0.14, st.trim, 0.02);
  // ---- balkonlar (sürekli demir korkuluk + döşeme)
  if (sp.balcony && bands.length && !far) {
    bands.forEach(([yb], k) => {
      const on = sp.balcony === "all" ? (tier > 0 || k === 0) : k === 0 || (k === bands.length - 1 && tier === 2);
      if (!on) return;
      if (tier === 2) box(cx, yb - 0.04, cz, UW + 0.5, 0.08, UD + 0.5, st.trim, 0.02);
      box(cx, yb + 0.13, cz, UW + 0.44, 0.26, UD + 0.44, st.iron, 0);
    });
  }
  // ---- yangın merdiveni (<city>; ön yüz)
  if (sp.fireEscape && tier > 0 && bands.length) {
    const fw = Math.min(2.2, UW * 0.5), fx = cx + UW * 0.2;
    if (alongX) { for (const [yb] of bands) box(fx, yb + 0.1, cz + UD / 2 + 0.26, fw, 0.32, 0.5, st.iron, 0); }
    else for (const [yb] of bands) box(cx + UW / 2 + 0.26, yb + 0.1, cz + UD * 0.2, 0.5, 0.32, fw, st.iron, 0);
  }
  // ---- tente ve tabela levhaları (yazısız)
  if (sp.awning && tier > 0 && g0 >= 1.75) {
    const c = st.awnings[seed % st.awnings.length];
    box(cx, g0 - 0.27, cz, alongX ? W * 0.82 : W + 0.7, 0.1, alongX ? D + 0.7 : D * 0.82, c, 0.02);
  }
  if (sp.signs && tier > 0 && n >= 2) {
    const c = st.awnings[(seed >>> 3) % st.awnings.length], c2 = st.awnings[(seed >>> 5) % st.awnings.length];
    const sh = Math.min(2.4, H - g0 - 0.3);
    if (alongX) box(cx + W / 2 - 0.4, g0 + 0.15 + sh / 2, cz + UD / 2 + 0.33, 0.1, sh, 0.56, c, 0.02);
    else box(cx + UW / 2 + 0.33, g0 + 0.15 + sh / 2, cz + D / 2 - 0.4, 0.56, sh, 0.1, c, 0.02);
    if (tier === 2) {
      if (alongX) box(cx, g0 - 0.16, cz, W * 0.7, 0.3, D + 0.12, c2, 0.02);
      else box(cx, g0 - 0.16, cz, W + 0.12, 0.3, D * 0.7, c2, 0.02);
    }
  }

  // ---- çatı
  const roofC = bd.roof;
  switch (tier === 0 && !far && (sp.roof === "gables" || sp.roof === "mansard") ? "parapet" : sp.roof) {
    case "parapet": {
      box(cx, H + 0.15, cz, UW + 0.12, 0.3, UD + 0.12, st.trim, 0.02);
      if (tier > 0) box(cx, H + 0.31, cz, Math.max(0.2, UW - 0.24), 0.02, Math.max(0.2, UD - 0.24), roofC, 0.03);
      if (tier === 2 && W * D >= 10) box(cx - UW * 0.2, H + 0.65, cz - UD * 0.15, Math.min(1.4, UW * 0.3), 0.7, Math.min(1.2, UD * 0.4), shade(bd.wall, 0.85), 0.03);
      break;
    }
    case "cornice": {
      box(cx, H + 0.13, cz, UW + 0.36, 0.26, UD + 0.36, st.trim, 0.02);
      if (tier === 2 && sp.tank && W * D >= 8) {
        const tx0 = cx + UW * 0.22, tz0 = cz - UD * 0.1, y = H + 0.26;
        box(tx0, y + 0.25, tz0, 0.5, 0.5, 0.5, "#4A4E55", 0);
        box(tx0, y + 0.95, tz0, 0.9, 0.9, 0.5, "#8A6A4A", 0.04); box(tx0, y + 0.95, tz0, 0.5, 0.9, 0.9, "#8A6A4A", 0.04);
        box(tx0, y + 1.52, tz0, 0.6, 0.24, 0.6, "#4A4E55", 0);
      }
      break;
    }
    case "pitched": case "hipped": {
      box(cx, H + 0.06, cz, UW + 0.3, 0.12, UD + 0.3, roofC, 0.03);
      const layers = tier === 0 ? 1 : 3;
      for (let k = 1; k <= layers; k++) {
        const f = 1 - k * 0.27, hip = sp.roof === "hipped";
        const lw = alongX ? (hip ? (UW + 0.2) * (1 - k * 0.12) : UW + 0.2) : (UW + 0.2) * f;
        const ld = alongX ? (UD + 0.2) * f : (hip ? (UD + 0.2) * (1 - k * 0.12) : UD + 0.2);
        box(cx, H + 0.12 + (k - 0.5) * 0.3, cz, lw, 0.3, ld, shade(roofC, 1 - k * 0.04), 0.03);
      }
      if (sp.chimneys && tier > 0) {
        const nC = Math.min(3, Math.max(1, Math.floor(long / 2.4)));
        for (let k = 0; k < nC; k++) {
          // (ürün sahibi "çatılarda havada kahverengi kutular"): baca sırttan yalnız 0,18 çıkıyordu (çatıya yatmış yassı kutu +
          // kiremit kapak); şimdi sırtın 0,6 üstüne çıkan ince yığma baca (0,4 × 0,5), kapak üstünde
          const u = -long / 2 + ((k + 0.5) * long) / nC, cy = H + 0.95;
          box(alongX ? cx + u : cx, cy, alongX ? cz : cz + u, alongX ? 0.4 : 0.5, 1.3, alongX ? 0.5 : 0.4, shade(bd.wall, 0.8), 0.04);
          if (tier === 2) box(alongX ? cx + u : cx, cy + 0.72, alongX ? cz : cz + u, alongX ? 0.3 : 0.4, 0.14, alongX ? 0.4 : 0.3, "#B5653F", 0.03);
        }
      }
      break;
    }
    case "mansard": {
      box(cx, H + 0.07, cz, UW + 0.2, 0.14, UD + 0.2, st.trim, 0.02);
      box(cx, H + 0.6, cz, UW - 0.1, 0.92, UD - 0.1, roofC, 0.03);
      box(cx, H + 1.18, cz, Math.max(0.3, UW - 0.8), 0.24, Math.max(0.3, UD - 0.8), shade(roofC, 0.85), 0.03);
      if (tier === 2) {
        const nd = Math.min(4, Math.max(1, Math.floor(UW / 1.6)));
        for (let k = 0; k < nd; k++) {
          const x = cx - UW / 2 + ((k + 0.5) * UW) / nd;
          if (alongX) box(x, H + 0.55, cz, 0.44, 0.5, UD + 0.04, st.trim, 0.02);
          else box(cx, H + 0.55, cz - UD / 2 + ((k + 0.5) * UD) / nd, UW + 0.04, 0.5, 0.44, st.trim, 0.02);
        }
        box(cx + UW * 0.3, H + 1.5, cz, 0.5, 0.5, 0.32, shade(bd.wall, 0.8), 0.03);
      }
      break;
    }
    case "gables": {
      // kanal evi: her birimde sokağa bakan basamaklı alınlık (ön ve arka yüzde; sırt kısa eksende)
      box(cx, H + 0.05, cz, UW + 0.08, 0.1, UD + 0.08, st.trim, 0.02);
      const uw = long / units;
      for (let k = 0; k < units; k++) {
        const u = -long / 2 + (k + 0.5) * uw, c = k === 0 ? bd.wall : st.walls[(seed + k) % st.walls.length];
        const steps = tier === 2 ? [[0.86, 0.5], [0.58, 0.42], [0.3, 0.34]] : [[0.8, 0.5], [0.4, 0.45]];
        let y = H + 0.1;
        for (const [f, hh] of steps) {
          box(alongX ? cx + u : cx, y + hh / 2, alongX ? cz : cz + u, alongX ? uw * f : short, hh, alongX ? short : uw * f, c, 0.03);
          y += hh;
        }
        if (tier === 2) box(alongX ? cx + u : cx, y + 0.04, alongX ? cz : cz + u, alongX ? uw * 0.34 : short + 0.04, 0.08, alongX ? short + 0.04 : uw * 0.34, st.trim, 0.02);
      }
      break;
    }
    case "curved": {
      // saçak duvardan 0,35 + köşe uçları 0,45 taşıyordu ("binadan büyük şapka") → 0,25 / 0,29 (ROOF-OVERHANG-001 ≤ 0,3)
      box(cx, H + 0.1, cz, UW + 0.5, 0.12, UD + 0.5, roofC, 0.03);
      box(cx, H + 0.3, cz, UW + 0.2, 0.3, UD + 0.2, shade(roofC, 0.92), 0.03);
      if (tier > 0) box(cx, H + 0.55, cz, alongX ? UW * 0.9 : 0.3, 0.2, alongX ? 0.3 : UD * 0.9, shade(roofC, 0.75), 0.02);
      if (tier === 2) for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(cx + sx * (UW / 2 + 0.14), H + 0.22, cz + sz * (UD / 2 + 0.14), 0.3, 0.1, 0.3, shade(roofC, 0.75), 0);
      break;
    }
    case "crenel": {
      box(cx, H + 0.15, cz, UW + 0.1, 0.3, UD + 0.1, shade(bd.wall, 0.95), 0.03);
      if (tier > 0) {
        const mx = Math.min(5, Math.floor(UW / 0.8)), mz = Math.min(4, Math.floor(UD / 0.8));
        for (let k = 0; k < mx; k++) box(cx - UW / 2 + ((k + 0.5) * UW) / mx, H + 0.45, cz, 0.3, 0.3, UD + 0.1, shade(bd.wall, 0.95), 0.03);
        if (tier === 2) for (let k = 0; k < mz; k++) box(cx, H + 0.45, cz - UD / 2 + ((k + 0.5) * UD) / mz, UW + 0.1, 0.3, 0.3, shade(bd.wall, 0.95), 0.03);
      }
      break;
    }
  }
  return out;
}

/** Bütçe dağıtımı: binaların kademesi (2 → −1), toplam katı blok `room`'a sığana dek en çok blok kullanan bina iner. */
export function fitFacades(list: readonly FacadeBuilding[], st: FacadeStyle, ox: number, oz: number, room: number): { blocks: Block[][]; tiers: FacadeTier[] } {
  const tiers: FacadeTier[] = list.map(() => 2);
  const blocks = list.map((b) => facadeBlocks(b, st, ox, oz, 2));
  let total = blocks.reduce((s, b) => s + b.length, 0);
  while (total > room) {
    let pick = -1;
    for (let k = 0; k < list.length; k++) if (tiers[k] > 0 && (pick < 0 || blocks[k].length > blocks[pick].length)) pick = k;
    if (pick < 0) for (let k = 0; k < list.length; k++) if (tiers[k] === 0 && (pick < 0 || blocks[k].length > blocks[pick].length)) pick = k;
    if (pick < 0) break;
    tiers[pick] = (tiers[pick] - 1) as FacadeTier;
    const nb = facadeBlocks(list[pick], st, ox, oz, tiers[pick]);
    total += nb.length - blocks[pick].length;
    blocks[pick] = nb;
  }
  return { blocks, tiers };
}
