/**
 * WORLD-PANO — şehir landmarkı iç mekânlarının ucuz dış panoraması ("pencereden şehir").
 *
 * Şehir haritası iç mekânı ayrı bir sahnedir (sceneModel.ts): dış şehir çizilmez, pencereler eskiden koyu boşluğa bakardı. Bu
 * modül kat başına **yerine geçen bir halka** üretir: katın ayak izinin çevresinde, kamera kesitinin erişemeyeceği uzaklıkta
 * (`PANO_GAP`) dört yönde alçak voxel silüet bantları + zemin/su halkası. Kaynak, üst şehrin (harita) paleti, simge
 * silüetleri (city/skyline.ts `silhouette`; ufuk bandıyla aynı genel, isimsiz biçimler) ve dış dünyanın saatidir:
 *
 * - **Yön tarifi** (`PANO_RECIPES`): her landmark için dört yön (−z kuzey, +x doğu, +z güney, −x batı) şehir ya da su + karşı
 * kıyı. Galata: güney/doğu su, karşıda kubbeli yarımada ve köprü; Kız Kulesi: dört yanı su, karşı kıyılar; kafes kule
 * güvertesi: çinko çatılı alçak sıralar ve tepe. Tarifi olmayan landmark şehrin varsayılanını alır; yer altı (sarnıç, yer
 * altı şehri) panoramasızdır.
 * - **Yükseklik:** katın sokaktan yüksekliği (`elev`; kule katları landmark yüksekliğine oranlı, göz hizası açıklıklar için
 * sıkıştırılmış) kadar aşağıda — güverteden şehir aşağıda görünür. World.tsx zemin düzlemini aynı kadar indirir.
 * - **Saat:** gece bantlar gece göğüne doğru koyulaşır; kat zaten `glow` grubunu kullanıyorsa birkaç sıcak pencere yanar.
 * - **Bütçe:** bloklar yalnız katın ZATEN kullandığı gruplara katılır (`solid`; gece pencereleri yalnız `glow` varsa) →
 * **+0 çizim çağrısı** (örnek sayısı artar; `INTERIOR_PANO_BLOCKS` tavanı). `viewCheck.estimateFloorCalls` ve
 * `cityCheck` panoramalı/panoramasız grup sayısını karşılaştırır (fark 0 olmalı).
 * - **Kesit kamerası:** halka ayak izinin `PANO_GAP` (≥ en uzun takip mesafesi + pay) dışında başlar; hiçbir blok ayak izine
 * ya da kamera erişim kutusuna girmez (`cityCheck`), bu yüzden kesit/örtü ızgaraları ve kamera kuralı değişmez.
 * - **Hareket azaltma:** halka durağandır (animasyon yok).
 *
 * Yazı, logo, bayrak, dinî iç mekân yok; kubbe/minare yalnız uzak DIŞ silüet (kit kuralı…). Saf modül, belirlenimci.
*/
import { rng, tx, tz, type Block, type Builder, type Group } from "../scenes";
import { silhouette, type Silhouette } from "../city/skyline";
import type { CityStyle } from "../city/style";
import { PANO_NIGHT_SKY } from "./sceneModel";
import { NEW_CITIES } from "../cities/index";
import { fullCityPano } from "../../full/cityPano";

/** Ayak izinin kenarından halkaya boşluk: en uzun iç mekân takip mesafesi (salon 4,4) + kesit payı. */
export const PANO_GAP = 9;
/** Kat başına panorama blok tavanı (örnek sayısı; çizim çağrısı değil). */
export const INTERIOR_PANO_BLOCKS = 900;

export type PanoSide = "city" | "shore" | "open" | "near" | "field";
/** Simge silüeti (dağıtıcı: her silüet türünün kendi alanları), `x` yerine bant boyunca oran `at`. */
type PanoItem = Silhouette extends infer S ? (S extends Silhouette ? Omit<S, "x"> & { at: number } : never) : never;
export interface SideSpec {
  /** city: yakın şehir bandı; shore: su + karşı kıyı; near: su + yakın alçak kıyı; open: yalnız su (ufuk); field: yalnız zemin + uzak sırt (stadyum sahası önünde bina yok)*/
  kind: PanoSide;
  /** simge silüetleri (x: bant boyunca −0,5…0,5 oranı) */
  items?: PanoItem[];
  /**
   * bulvar yıldızı — ayak izinin kenarından dışarı yayılan caddeler (`x0`: başlangıç yanal konumu, `slope`: dışarı
   * gidildikçe yanal eğim dx/dz). Cadde şeridi zeminde asfalt + orta çizgi olarak çizilir, bina sıraları caddeye girmez.
*/
  streets?: { x0: number; slope: number }[];
  /** bina yüksekliği çarpanı (<1: çatılar göz hizasının altında kalır, caddeler ve simge kuleleri görünür) */
  low?: number;
}
interface CityPalette { walls: string[]; roofs: string[]; ground: string; water: string; h: [number, number]; caps: boolean; hills?: string }
type Recipe = { sides: [SideSpec, SideSpec, SideSpec, SideSpec] } | { none: true };
/** şehir manifesti (V/cities/types.ts) bu iki tipi kullanır.*/
export type PanoPalette = CityPalette;
export type PanoRecipe = Recipe;

const CITY: SideSpec = { kind: "city" };
const full = fullCityPano(CITY);
const PALETTES: Record<string, CityPalette> = {
  istanbul: { walls: ["#E3D3B8", "#D9B99B", "#CDB28E", "#E9DCC4", "#C9C2B2", "#E6CBB0"], roofs: ["#9C4A3A", "#8F4636", "#7A3F31"], ground: "#9A8F80", water: "#3C86AE", h: [1.4, 3.8], caps: true },
  londra: { walls: ["#B9876A", "#A9745A", "#CFC3AE", "#9C8C7A", "#C8B9A0"], roofs: ["#55606B", "#6E5A4E"], ground: "#8C8780", water: "#55788C", h: [2, 4.4], caps: true },
  kapadokya: { walls: ["#E3C9A3", "#D9B48A", "#CDA57A", "#E8D2B0"], roofs: ["#B98A5E", "#A87B52"], ground: "#C9AE86", water: "#3E8DB5", h: [0.8, 2.2], caps: true, hills: "#D4B48C" },
  ...full.palettes,
  ...Object.fromEntries(NEW_CITIES.flatMap((m) => (m.pano ? [[m.catalog.id, m.pano.palette] as const] : []))),
};
const FALLBACK: CityPalette = { walls: ["#E7D9C2", "#D9B99B", "#C9D3D8"], roofs: ["#9C4A3A", "#55606B"], ground: "#8C8780", water: "#3E8DB5", h: [1.6, 4], caps: true };

/** Şehrin varsayılan yönleri (landmark tarifi yoksa). */
const CITY_DEFAULT: Record<string, Recipe> = {
  istanbul: { sides: [CITY, CITY, { kind: "city", items: [{ kind: "domes", at: 0.15, scale: 0.9, minarets: 2 }] }, CITY] },
  londra: { sides: [{ kind: "city", items: [{ kind: "clock", at: 0.2, scale: 1 }] }, CITY, CITY, CITY] },
  kapadokya: { sides: [{ kind: "city", items: [{ kind: "hill", at: 0, w: 22, h: 5 }] }, CITY, { kind: "city", items: [{ kind: "hill", at: 0.2, w: 18, h: 4 }] }, CITY] },
  ...full.defaults,
  ...Object.fromEntries(NEW_CITIES.flatMap((m) => (m.pano?.sides ? [[m.catalog.id, m.pano.sides] as const] : []))),
};

/** Landmark tarifleri ("şehir:landmark"). Yönler: [kuzey −z, doğu +x, güney +z, batı −x]. */
export const PANO_RECIPES: Readonly<Record<string, Recipe>> = {
  // İstanbul — Galata: güneyde Haliç ağzı, karşıda kubbeli yarımada; doğuda Boğaz ve uzak köprü; kuzey/batı Beyoğlu çatıları
  "istanbul:galata_kulesi": { sides: [CITY,
    { kind: "shore", items: [{ kind: "bridge", at: 0.1, w: 16 }] },
    { kind: "shore", items: [{ kind: "domes", at: -0.18, scale: 1, minarets: 4 }, { kind: "domes", at: 0.22, scale: 0.8, minarets: 2 }] },
    CITY] },
  // Kız Kulesi: dört yanı su; kuzeyde köprü, doğuda yakın Üsküdar kıyısı. dürbün +z (güney) bakar; yarımada silüeti (kubbeler, minareler,
  // yuvarlak kule) dürbünün önünde olsun diye güneye alındı, batı açık su (eskiden güney açık, batı yarımada: dürbün önünde simge yok → yan
  // taramada en yakın Salacak binasına ve banklarına dönüyordu)
  "istanbul:kiz_kulesi": { sides: [
    { kind: "shore", items: [{ kind: "bridge", at: -0.1, w: 18 }, { kind: "round", at: 0.3, scale: 0.7 }] },
    { kind: "near" },
    { kind: "shore", items: [{ kind: "domes", at: -0.1, scale: 1, minarets: 4 }, { kind: "round", at: 0.3, scale: 0.8 }] },
    { kind: "open" }] },
  "istanbul:galata_koprusu": { sides: [
    { kind: "shore", items: [{ kind: "round", at: 0.1, scale: 0.9 }] },
    { kind: "open" },
    { kind: "shore", items: [{ kind: "domes", at: 0, scale: 0.9, minarets: 2 }] },
    CITY] },
  "istanbul:rumeli_hisari": { sides: [CITY, { kind: "shore", items: [{ kind: "bridge", at: -0.15, w: 20 }, { kind: "hill", at: 0.25, w: 14, h: 4, color: "#6E9F5B" }] }, CITY, { kind: "city", items: [{ kind: "hill", at: 0, w: 18, h: 5, color: "#6E9F5B" }] }] },
  "istanbul:topkapi": { sides: [{ kind: "shore", items: [{ kind: "round", at: 0.2, scale: 0.7 }] }, { kind: "shore" }, { kind: "city", items: [{ kind: "domes", at: 0.1, scale: 1, minarets: 4 }] }, CITY] },
  "istanbul:kapalicarsi": { sides: [CITY, { kind: "city", items: [{ kind: "domes", at: 0, scale: 0.9, minarets: 2 }] }, CITY, CITY] },
  "istanbul:yerebatan": { none: true },
  // Londra
  "londra:saat_kulesi": { sides: [CITY, { kind: "near" }, CITY, CITY] },
  "londra:kale": { sides: [CITY, CITY, { kind: "shore", items: [{ kind: "bridge", at: 0.15, w: 14 }] }, { kind: "city", items: [{ kind: "clock", at: 0, scale: 0.9 }] }] },
  "londra:kapali_carsi": { sides: [{ kind: "city", items: [{ kind: "clock", at: -0.2, scale: 0.9 }] }, CITY, CITY, CITY] },
  // Kapadokya — yer altı şehri panoramasız
  "kapadokya:yeralti_sehri": { none: true },
  "kapadokya:uchisar_kalesi": { sides: [{ kind: "city", items: [{ kind: "hill", at: -0.2, w: 16, h: 6 }, { kind: "hill", at: 0.3, w: 10, h: 4 }] }, { kind: "city", items: [{ kind: "hill", at: 0.1, w: 20, h: 5 }] }, CITY, { kind: "city", items: [{ kind: "hill", at: 0, w: 18, h: 6 }] }] },
  ...full.recipes,
  // yeni şehirlerin landmark tarifleri ("<şehir>:<landmark>")
  ...Object.fromEntries(NEW_CITIES.flatMap((m) => Object.entries(m.pano?.landmarks ?? {}).map(([lm, r]) => [`${m.catalog.id}:${lm}`, r] as const))),
};

export interface CityPano {
  city: string;
  landmark: string;
  /** katın sokaktan yüksekliği (halka bu kadar aşağıda) */
  elev: number;
  /** ayak izi merkezi ve yarı genişlikleri (dünya; kat ızgarası) */
  cx: number; cz: number; hx: number; hz: number;
  /** halkanın iç kenarı: ayak izi + PANO_GAP */
  gap: number;
}

/** `city_<şehir>__<semt>__<landmark>` → (şehir, landmark). */
export function parseCitySite(site: string): { city: string; landmark: string } | null {
  const m = /^city_([a-z0-9_]+?)__([a-z0-9_]+)__([a-z0-9_]+)$/.exec(site);
  return m ? { city: m[1], landmark: m[3] } : null;
}

export function panoRecipe(city: string, landmark: string): Recipe {
  return PANO_RECIPES[`${city}:${landmark}`] ?? CITY_DEFAULT[city] ?? { sides: [CITY, CITY, CITY, CITY] };
}

/**
 * Katın panorama tanımı (yoksa null: tarif `none`, şehir bilinmiyor). `h`: landmark yüksekliği (şehir haritası); kule katları
 * ona oranlı yükselir, yoksa kat başına ~1,8.
 */
export function cityPanoFor(site: string, index: number, count: number, w: number, d: number, h?: number): CityPano | null {
  const id = parseCitySite(site);
  if (!id) return null;
  const rec = panoRecipe(id.city, id.landmark);
  if ("none" in rec) return null;
  const raw = h && h >= 8 && count > 1 ? (index / (count - 1)) * Math.max(0, h * 0.85 - 2) : index * 1.8;
  // görsel sıkıştırma: pencere ve güverte açıklıkları göz hizasındadır (~±25°); gerçek yükseklikte şehir açıklığın altında
  // kalırdı → halka yükseldikçe daha az iner (Galata tepesi 15 → 5,5), çatılar ve karşı kıyı ufukta görünür
  const elev = +Math.min(raw, 2.5 + raw * 0.2).toFixed(2);
  return { city: id.city, landmark: id.landmark, elev, cx: (tx(0) + tx(w - 1)) / 2, cz: (tz(0) + tz(d - 1)) / 2, hx: w / 2, hz: d / 2, gap: PANO_GAP };
}

const mixHex = (a: string, b: string, t: number) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
};

/** Halkanın dış yarıçapı (ayak izi kenarından): zemin/su bu kadar uzanır, ötesi sisle göğe karışır.
 * 24 → 40 — yüksek güvertenin (Galata tepesi, iniş ~5,5) ufuk bandı ışınları (−6°) eskiden zeminin ötesinde boşluğa düşüyordu.*/
const PANO_OUTER = PANO_GAP + 40;
/**
 * (ürün sahibi 2026-10-31 "seyir terasından hiç bir yer görünmüyor"; VIEW-RING-001): halkanın dış kenarında, sisin içinde uzak sırt —
 * her yönde (açık denizde alçak uzak kıyı) güvertenin göz hizasını aşan puslu tepe sırası. Eskiden kuzey/güney dışındaki yönlerde
 * ve su yakalarında ufuk bandı boştu (Galata şehir yolunun doğusu, Kız Kulesi, kafes kule zirvesi, kale). Renk `RIDGE_COLORS`'a
 * yazılır: dürbün (lookout.ts) sırta kadraj kurmaz (tepe sayılır).
*/
const RIDGE_HAZE = "#A9BCCB";
export const RIDGE_COLORS = new Set<string>();
export const isPanoRidge = (c: string) => RIDGE_COLORS.has(c);
/**
 * sahne panoramalı yüksek güvertenin (kule, kale, gökdelen açık katı) uzak sırt halkası — merkezi (cx, cz), yarıçap `r` kare
 * halka, taban `baseY` (panorama zemini), tepeler göz hizası `eyeY` üstünde. Dürbün kadraj kurmaz (`RIDGE_COLORS`).
*/
export function ridgeRing(out: Block[], cx: number, cz: number, r: number, baseY: number, eyeY: number, ground: string, seed: number) {
  const rr = rng(seed);
  const c = mixHex(ground, RIDGE_HAZE, 0.5);
  RIDGE_COLORS.add(c);
  const side = (len: number, at: (x: number) => [number, number], along: "x" | "z") => {
    for (let x = -len / 2; x < len / 2 - 0.5;) {
      const w = Math.min(5 + rr() * 4, len / 2 - x), h = eyeY - baseY + 0.6 + rr() * 2.2;
      const [px, pz] = at(x + w / 2);
      out.push({ p: [px, baseY + h / 2, pz], s: along === "x" ? [w, h, 3] : [3, h, w], c, g: "solid", j: 0.03 });
      x += w;
    }
  };
  side(2 * r + 3, (x) => [cx + x, cz - r], "x");
  side(2 * r + 3, (x) => [cx - x, cz + r], "x");
  side(2 * r - 3.2, (z) => [cx + r, cz + z], "z");
  side(2 * r - 3.2, (z) => [cx - r, cz - z], "z");
}

/**
 * Bir yön (yerel çerçeve: bant x boyunca, ön yüz +z kata bakar, bant çizgisi z = 0, ayak izi kenarı z = gap; taban y = 0) →
 * bloklar. `len`: bina bandının boyu, `groundLen`: zemin şeridinin boyu (köşeler kuzey/güney şeridinde; çakışma yok).
 */
function band(out: Block[], spec: SideSpec, pal: CityPalette, len: number, groundLen: number, gap: number, seed: number, ridge: { len: number; eye: number }) {
  const r = rng(seed);
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, g: Group = "solid", j = 0.04) =>
    out.push({ p: [x, y, z], s: [w, h, d], c, g, j });
  const water = spec.kind !== "city" && spec.kind !== "field";
  // bina sıralarının çizgisi: şehirde halka çizgisi, yakın kıyıda 2, karşı kıyıda 9 birim öte
  const z0 = spec.kind === "city" ? 0 : spec.kind === "near" ? -2 : -9;
  // zemin/su şeridi: ayak izinin 0,5 dışından dış yarıçapa; suda kıyı çizgisine kadar su, ötesi kara (açık denizde hep su)
  const zFront = gap - 0.5, zBack = gap - PANO_OUTER;
  const shore = spec.kind === "open" ? zBack : water ? z0 + 1.6 : zFront;
  if (shore < zFront) box(0, -0.17, (zFront + shore) / 2, groundLen, 0.3, zFront - shore, pal.water, "solid", 0.02);
  if (shore > zBack) box(0, -0.17, (shore + zBack) / 2, groundLen, 0.3, shore - zBack, pal.ground, "solid", 0.02);
  // uzak sırt (her yön; açık denizde alçak uzak kıyı) — tepeleri güvertenin göz hizasının üstünde
  {
    const rr = rng(seed ^ 0x5bd1);
    const c = mixHex(pal.hills ?? pal.ground, RIDGE_HAZE, 0.5);
    const zr = zBack + 1.8, open = spec.kind === "open";
    for (let x = -ridge.len / 2; x < ridge.len / 2 - 0.5;) {
      const w = Math.min(5 + rr() * 4, ridge.len / 2 - x);
      const h = ridge.eye + (open ? 0.25 + rr() * 0.5 : 0.6 + rr() * 2.2);
      box(x + w / 2, h / 2, zr, w, h, 3, c, "solid", 0.03);
      x += w;
    }
  }
  if (spec.kind === "open" || spec.kind === "field") return;
  // caddeler (zemin şeridi; ayak izinin dışından başlar, 4 birimlik asfalt parçalar + orta çizgi)
  const streetHalf = 2.3;
  const streetX = (st: { x0: number; slope: number }, t: number) => st.x0 + st.slope * t;
  for (const st of spec.streets ?? []) {
    for (let t = 1; t < PANO_OUTER - 8; t += 4) {
      const tc = t + 2, x = streetX(st, tc), z = gap - 0.5 - tc, wd = 2 * streetHalf + Math.abs(st.slope) * 4;
      // üst yüz 0,0005 (≤ 0,001): kamera erişim kutusunda blok sayılmaz (cityCheck); orta çizgi erişim kutusunun dışında (tc ≥ 9)
      box(x, -0.0145, z, wd, 0.03, 4.1, "#6E6F74", "solid", 0.01);
      if (tc >= 9 && ((t - 1) / 4) % 2 === 0) box(x, 0.012, z, 0.22, 0.02, 1.8, "#D8D2C0", "solid", 0);
    }
  }
  const L = len;
  // bina sıraları: şehirde 2 sıra (yakın), kıyıda karşı yakada 2 alçak sıra; yakın kıyıda tek alçak sıra
  const rows = spec.kind === "near" ? 1 : 2;
  const [h0, h1] = pal.h;
  const shrink = spec.kind === "city" ? 1 : 0.75;
  for (let row = 0; row < rows; row++) {
    for (let x = -L / 2; x < L / 2;) {
      const w = 1.4 + r() * 2.2;
      const h = (h0 + r() * (h1 - h0)) * shrink * (spec.low ?? 1) + row * 1.2 * (spec.low ?? 1);
      const c = pal.walls[Math.floor(r() * pal.walls.length)];
      const z = z0 - row * 3.4 - r() * 0.8;
      const xc = x + w / 2, tb = gap - z;
      const onStreet = !!spec.streets?.some((st) => Math.abs(xc - streetX(st, tb)) < w / 2 + streetHalf + 0.3 + Math.abs(st.slope) * 1.2);
      const cap = pal.caps && r() < 0.7, capC = cap ? pal.roofs[Math.floor(r() * pal.roofs.length)] : "";
      const win = r() < 0.55 && h > 1.6, winY = win ? Math.min(h - 0.5, 1.1 + r() * (h - 1.6)) : 0;
      if (!onStreet) {
        box(xc, h / 2, z, w, h, 2.4, c, "solid", 0.05);
        if (cap) box(xc, h + 0.18, z, w + 0.12, 0.36, 2.5, capC, "solid", 0.03);
        // pencere bandı (gece yanan pencere adayı): bayrak `win` → glow'a çevrilebilir
        if (win) out.push({ p: [xc, winY, z + 1.22], s: [w * 0.6, 0.3, 0.04], c: "#5A6B7C", g: "solid", j: 0, win: 1 } as Block);
      }
      x += w + 0.3 + r() * 0.7;
    }
  }
  // simge silüetleri (city/skyline.ts; yerel x = oran × bant boyu)
  if (spec.items?.length) {
    const fake = { backdrop: [] as Block[], zones: [] as unknown[] } as unknown as Builder;
    const style = { far: pal.walls, roofColor: pal.roofs[0] } as unknown as CityStyle;
    for (const it of spec.items) {
      const { at, ...rest } = it;
      silhouette(fake, style, { ...rest, x: at * len } as Silhouette, z0 - 1.5);
    }
    out.push(...(fake as unknown as { backdrop: Block[] }).backdrop);
  }
}

const panoCache = new Map<string, Block[]>();

/**
 * Panorama blokları (dünya; katın çerçevesi). `night`: gece renkleri; `glow`: kat `glow` grubunu zaten kullanıyor (gece pencereleri
 * yanar, +0 çizim çağrısı). Önbellekli.
 */
export function cityPanoBlocks(p: CityPano | null | undefined, night: boolean, glow: boolean): Block[] {
  if (!p) return [];
  const ck = `${p.city}:${p.landmark}:${p.elev}:${p.cx},${p.cz},${p.hx},${p.hz}:${night ? 1 : 0}${glow ? 1 : 0}`;
  const hit = panoCache.get(ck);
  if (hit) return hit;
  const pal = PALETTES[p.city] ?? FALLBACK;
  const rec = panoRecipe(p.city, p.landmark);
  const out: Block[] = [];
  if (!("none" in rec)) {
    // yönler: kuzey (−z), doğu (+x), güney (+z), batı (−x); yerel bant +z'ye (kata) bakar
    // bina bantları köşede kesişmez (kuzey/güney ±(dE + 3), doğu/batı ±(dN − 3)); zemin köşeleri kuzey/güney şeridinde
    const dN = p.hz + p.gap, dE = p.hx + p.gap;
    type At = (x: number, y: number, z: number, s: [number, number, number]) => [[number, number, number], [number, number, number]];
    // uzak sırt kuzey/güneyde zemin şeridi boyunca (köşeler), doğu/batıda kuzey/güney sırtına değmeden
    const ridgeNS = 2 * (p.hx + PANO_OUTER), ridgeEW = 2 * (p.hz + PANO_OUTER) - 8;
    const sides: { len: number; ground: number; ridge: number; at: At }[] = [
      { len: 2 * dE + 6, ground: 2 * (p.hx + PANO_OUTER), ridge: ridgeNS, at: (x, y, z, s) => [[p.cx + x, y, p.cz - dN + z], s] },
      { len: 2 * dN - 6, ground: 2 * p.hz + 1, ridge: ridgeEW, at: (x, y, z, s) => [[p.cx + dE - z, y, p.cz + x], [s[2], s[1], s[0]]] },
      { len: 2 * dE + 6, ground: 2 * (p.hx + PANO_OUTER), ridge: ridgeNS, at: (x, y, z, s) => [[p.cx - x, y, p.cz + dN - z], s] },
      { len: 2 * dN - 6, ground: 2 * p.hz + 1, ridge: ridgeEW, at: (x, y, z, s) => [[p.cx - dE + z, y, p.cz - x], [s[2], s[1], s[0]]] },
    ];
    const ridgeDay = new Set([mixHex(pal.hills ?? pal.ground, RIDGE_HAZE, 0.5)]);
    const seed0 = [...`${p.city}:${p.landmark}`].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
    rec.sides.forEach((spec, k) => {
      const local: Block[] = [];
      band(local, spec, pal, sides[k].len, sides[k].ground, p.gap, seed0 + k * 977, { len: sides[k].ridge, eye: p.elev + 0.91 });
      for (const b of local) {
        const [pp, ss] = sides[k].at(b.p[0], b.p[1] - p.elev, b.p[2], b.s);
        const win = (b as Block & { win?: number }).win === 1;
        let c = b.c, g: Group = b.g;
        if (win) { c = night && glow ? "#FFD98A" : b.c; g = night && glow ? "glow" : "solid"; }
        else if (night) c = mixHex(c, PANO_NIGHT_SKY, 0.55);
        if (ridgeDay.has(b.c)) RIDGE_COLORS.add(c);
        out.push({ p: pp, s: ss, c, g, j: b.j });
      }
    });
  }
  if (panoCache.size > 64) panoCache.clear();
  panoCache.set(ck, out);
  return out;
}

/** Ayak izi + kamera erişim kutusu (dünya; kesit denetimi): panorama bloğu bu kutuya girmemeli. */
export function panoKeepOut(p: CityPano, reach: number): { x0: number; x1: number; z0: number; z1: number } {
  return { x0: p.cx - p.hx - reach, x1: p.cx + p.hx + reach, z0: p.cz - p.hz - reach, z1: p.cz + p.hz + reach };
}

/** Kat `glow` grubunu zaten kullanıyor mu (gece pencereleri ancak o zaman yanar; +0 çizim çağrısı). */
export function levelHasGlow(lv: { built: { blocks: readonly Block[] } }): boolean {
  return lv.built.blocks.some((b) => b.g === "glow");
}
