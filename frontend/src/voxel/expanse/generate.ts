/**
 * EXP-GEN (E1a) — saf, belirlenimci çevre parseli üreteci.
 *
 * `generateParcel(ctx, cx, cz)` → yakın ayrıntı (bloklar + çarpışma ızgarası + yürünebilirlik) ve uzak LOD (birleştirilmiş zemin
 * + uzun silüetler). Aynı bağlam + (cx, cz) → bayt bayt aynı çıktı (`EXP-DET-001`); üretim sırası önemsizdir.
 *
 * Boru hattı (12 × 16 karo):
 * 1. Taban arazi: biyom zemini (4 × 4 karoluk mutlak gürültü lekeleri: komşu parselle kenarda aynı), su ya da boşluk;
 * kıyı sahnesinde mutlak satıra bağlı deniz/kum şeridi (komşu parsel ve dünya kenarıyla kesintisiz).
 * 2. Adacıklar (su/boşluk biyomu; kenara değmez).
 * 3. Omurga: parsel merkezinden dört kenarın sabit geçitlerine (li 5–6, lj 7–8) 2 karo genişlikte yol; su/boşluk biyomunda
 * 1 karo iskele/köprü (li 5, lj 7).
 * Komşu parseller aynı geçitleri kullandığından parsel sınırında yürünebilirlik kesintisizdir.
 * 4. Dikiş şeridi (`EXP-SEAM-001`): kutuya bakan 2 karo dünya kenarını sürdürür — yürünebilir kenar → aynı yükseklikte
 * yürünebilir zemin (suda/boşlukta iskele), su → su (aynı yüz), duvar → düz yürünebilir zemin. Her kenar geçidinden
 * (yürünebilir kenar dizisi) omurgaya yol çekilir.
 * 5. Keşif sınırı (yarıçap halkası) dış kenarında 2 karoluk doğal engel.
 * 6. Gölet / buz lekesi (kenara ve ayrılmış karolara değmez).
 * 7. Öğeler: karıştırılmış aday karolar, gürültüyle yoğunluk, ağırlıklı tür, blok ve parıltı bütçesi.
 * 8. Bağlantı onarımı (`EXP-REACH-001`): ana bileşene bağlanmayan yürünebilir cep, en ucuz yoldan (öğe kaldır = 1, su/boşluğa
 * iskele = 2) bağlanır; yol yoksa cep kapatılır. Sonuç: parselin yürünebilir karoları tek bileşendir.
 * 9. Yayım: zemin/su/iskele açgözlü dikdörtgen birleştirme, öğe blokları, çarpışma (FREE/SOLID + karo başına AABB,
 * `physics/world.ts` biçimi), uzak LOD.
 *
 * Saf modül: React/three yok.
*/
import type { Block, Group } from "../scenes";
import { BIOMES, FEATURES, PLOT_WOOD, PLOT_WOOD_DARK, SCENE_WEIGHTS, type FeatureKind } from "./biomes";
import { parcelState, plotSlots, type ExpanseContext } from "./context";
import { bx, bz, lidx, PD, pkey, PN, PW, ringOf, seamSide, SIDE_VEC, SIDES, type Side } from "./grid";
import { fbm, valueNoise } from "./noise";
import { chunkSeed, hash32, mix32, prng } from "./seed";

export const T_GROUND = 0;
export const T_ROAD = 1;
export const T_WATER = 2;
export const T_PLANK = 3;
export const T_VOID = 4;
export const T_BARRIER = 5;
/** `physics/world.ts` ile aynı değerler */
export const FREE = 0;
export const SOLID = 1;
/** `EXP-BUDGET-001` */
export const NEAR_BUDGET = 90;
export const FAR_BUDGET = 30;
export const GLOW_BUDGET = 8;
/** gövde yüksekliği bandı (`physics/world.ts` BODY_LOW/HIGH) */
const BODY_LOW = 0.3, BODY_HIGH = 1.0;
/** kuyruğa yazılmayan canlı gruplar (plan §14.3 R2) ve bayrak kumaşı (EXP-IP-001) */
export const FORBIDDEN_GROUPS: ReadonlySet<Group> = new Set<Group>(["wave", "bob", "flag", "snow", "cloud", "flame"]);
/** omurga geçitleri (yerel): x kenarlarında lj 7–8, z kenarlarında li 5–6 */
export const GATE_I: readonly number[] = [5, 6];
export const GATE_J: readonly number[] = [7, 8];

export interface ParcelFeature { kind: FeatureKind; li: number; lj: number; w: number; d: number; top: number }

export interface ParcelNear {
  blocks: Block[];
  /** 1 = avatar durabilir (j·12 + i) */
  walk: Uint8Array;
  /** FREE / SOLID */
  solid: Uint8Array;
  /** karo başına AABB [minX, minZ, maxX, maxZ] (taban çerçevesi); FREE'de 0 */
  box: Float32Array;
}

/**
 * çevre arazisinde olta noktası (taban çerçevesi; dünya karosu = taban karosu + `ctx.origin`, dünya x/z = + köken).
 * Yürünür, düz (|üst yüz| ≤ `FISH_FLAT`) kıyı karosu; önünde (1 karo ya da alçak engelin ardında 2 karo) su ve ardında da su.
 * Şamandıra suyun gerçek yüzünde: çizilen su bloğunun üstü (okyanuslu sahnede su bloğu yok → okyanus düzlemi).
*/
export interface ParcelFish {
  li: number; lj: number;
  /** bakış (rad; atan2(dx, dz)) */
  face: number;
  /** şamandıra (taban çerçevesi dünya koordinatı) */
  bx: number; by: number; bz: number;
  /** gölet (göl türleri; `fishWater` "pond") */
  pond: boolean;
  /** parsel içi su gövdesi (4-komşu) */
  body: number;
}

export interface ParcelOut {
  cx: number; cz: number; ring: number; seed: number;
  biome: ExpanseContext["biome"];
  /** kutuya bakan kenar (dikiş şeridi) */
  seam: Side | null;
  /** keşif sınırı engeli olan dış kenarlar */
  outer: Side[];
  /** E2 parsel yuvası (yalnız veri) */
  plotSlot: number | null;
  /** dünyadan yürüyerek ulaşılabilir (değilse `near.walk` tümüyle 0) */
  reachable: boolean;
  /** arazi türü (T_*) ve üst yüz yüksekliği */
  terrain: Uint8Array;
  height: Float64Array;
  features: ParcelFeature[];
  near: ParcelNear | null;
  far: { blocks: Block[] };
  stats: { removed: number; planked: number; sealed: number; glow: number };
  /** olta noktaları (yalnız yakın ayrıntıyla; yürünemeyen parselde boş)*/
  fish: ParcelFish[];
}

/** ızgara dışı okyanus bundan aşağıdaysa (Gökyüzü Adası bulut düzlemi y −7) olta yok (fun/sites.ts OCEAN_MIN_Y ile aynı).*/
export const FISH_OCEAN_MIN_Y = -2;
/** olta karosunun üst yüzü |y| ≤ bu (avatar mini oyunda y = 0 zeminde durur; Crowd.tsx).*/
export const FISH_FLAT = 0.12;
/** parsel başına en çok olta noktası ve aynı gövdede iki nokta arası en az (Chebyshev, karo).*/
export const FISH_PER_PARCEL = 6;
export const FISH_SPACING = 4;
/** kutsal bölge kutusunun (tamponu dahil) çevresinde ek pay (karo).*/
const FISH_SACRED_PAD = 3;
const fishBySolid = new WeakMap<Uint8Array, ParcelFish[]>();
/**
 * yüklü yakın parselin olta noktaları — çevre ızgarası (`physics/world.ts OuterParcel.kind`) parselin `near.solid`
 * dizisini aynen taşır; Yakındakiler (components/world/walk/entities.ts) yalnız yüklü parsellerin noktalarını buradan okur.
 * İnşalı parselde (E3: yeni çarpışma dizisi) null.
*/
export const parcelFishOf = (solid: Uint8Array): readonly ParcelFish[] | null => fishBySolid.get(solid) ?? null;

const OPP: Record<Side, Side> = { back: "front", front: "back", left: "right", right: "left" };

/** Satır öncelikli açgözlü dikdörtgen birleştirme: aynı anahtarlı (≥ 0) karolar → [li, lj, w, d, anahtar]. */
function mergeRects(keys: Int32Array): [number, number, number, number, number][] {
  const used = new Uint8Array(PN), out: [number, number, number, number, number][] = [];
  for (let lj = 0; lj < PD; lj++) for (let li = 0; li < PW; li++) {
    const k0 = lj * PW + li, key = keys[k0];
    if (used[k0] || key < 0) continue;
    let w = 1;
    while (li + w < PW && !used[k0 + w] && keys[k0 + w] === key) w++;
    let d = 1;
    grow: while (lj + d < PD) {
      const row = (lj + d) * PW + li;
      for (let q = 0; q < w; q++) if (used[row + q] || keys[row + q] !== key) break grow;
      d++;
    }
    for (let a = 0; a < d; a++) used.fill(1, (lj + a) * PW + li, (lj + a) * PW + li + w);
    out.push([li, lj, w, d, key]);
  }
  return out;
}

interface Placed extends ParcelFeature { seed: number; removed: boolean; blocks: Block[]; axis?: "x" | "z" }

/**
 * E2 sahiplenilmiş parsel (plan §7.1): yabani arazi yerine düzleştirilmiş zemin (dikiş şeridi, omurga geçitleri, kıyı denizi ve
 * keşif sınırı korunur), dış kenarlarda geçitleri açık bırakan çit, mola bankı ve yazısız renk rozeti. Aynı yuva bütçesi ve
 * çarpışma biçimi (+0 çizim çağrısı); yabani üretimle aynı tohum (karar sırası farklı ama belirlenimci).
 */
export interface PlotDecor {
  /** rozet rengi (sabit palet, `plots.ts PLOT_COLORS`) */
  color: string;
}

/** Parsel üret; kutunun içi, yarıçap dışı ya da bastırılmış parselde null. `lod: "far"` yakın blok ve çarpışmayı atlar. */
export function generateParcel(ctx: ExpanseContext, cx: number, cz: number, lod: "both" | "far" = "both", plot: PlotDecor | null = null): ParcelOut | null {
  if (parcelState(ctx, cx, cz) !== "open") return null;
  const biome = BIOMES[ctx.biome], pal = ctx.pal;
  const seed = chunkSeed(ctx.seed, cx, cz), r = prng(seed);
  const ring = ringOf(ctx.box, cx, cz);
  const I0 = cx * PW, J0 = cz * PD, h0 = ctx.h0;
  const ter = new Uint8Array(PN), hgt = new Float64Array(PN), col: string[] = new Array(PN).fill(pal.ground[0]);
  const wl = new Float64Array(PN), wet = new Uint8Array(PN), res = new Uint8Array(PN), sea = new Uint8Array(PN);
  const feat = new Int16Array(PN).fill(-1), sealed = new Uint8Array(PN);
  const grp = (g: Group): Group => (ctx.groups.has(g) && !FORBIDDEN_GROUPS.has(g) ? g : "solid");

  // 1. taban arazi
  const tseed = mix32(ctx.seed, 0x51ab);
  for (let lj = 0; lj < PD; lj++) for (let li = 0; li < PW; li++) {
    const k = lidx(li, lj), I = I0 + li, J = J0 + lj;
    const tone = valueNoise(tseed, Math.floor(I / 4), Math.floor(J / 4), 2.5) > 0.56 ? 1 : 0;
    col[k] = pal.ground[tone];
    if (biome.base === "water") { ter[k] = T_WATER; hgt[k] = wl[k] = ctx.waterTop; wet[k] = 1; }
    else if (biome.base === "void") { ter[k] = T_VOID; hgt[k] = h0; }
    else { ter[k] = T_GROUND; hgt[k] = h0; }
    if (ctx.coast) {
      if (J < ctx.coast.sea) { ter[k] = T_WATER; hgt[k] = wl[k] = ctx.waterTop; wet[k] = 1; sea[k] = 1; col[k] = pal.water; }
      else if (J < ctx.coast.sand) col[k] = pal.sand;
    }
  }
  const setLand = (k: number) => { ter[k] = T_GROUND; hgt[k] = h0; wet[k] = 0; };

  // 2. adacıklar (su/boşluk biyomu; sınırdan ≥ 1 karo içeride)
  const islets: [number, number, number, number][] = [];
  if (biome.islets) {
    const [a, b] = biome.islets, n = a + Math.floor(r() * (b - a + 1));
    for (let q = 0; q < n; q++) {
      const ci = 2 + r() * 7, cj = 2 + r() * 11, rx = 1.3 + r() * 1.4, rz = 1.5 + r() * 1.8;
      let i0 = PW, j0 = PD, i1 = -1, j1 = -1;
      for (let lj = 1; lj < PD - 1; lj++) for (let li = 1; li < PW - 1; li++) {
        if (((li - ci) / rx) ** 2 + ((lj - cj) / rz) ** 2 > 1) continue;
        setLand(lidx(li, lj));
        i0 = Math.min(i0, li); j0 = Math.min(j0, lj); i1 = Math.max(i1, li); j1 = Math.max(j1, lj);
      }
      if (i1 >= 0) islets.push([i0, j0, i1 - i0 + 1, j1 - j0 + 1]);
    }
  }

  const plankTop = (k: number) => (wet[k] ? wl[k] + 0.12 : h0);
  const pave = (k: number, spine: boolean) => {
    if (ter[k] === T_BARRIER) return false;
    if (sea[k] && !biome.spineOverSea) return false;
    if (ter[k] === T_GROUND || ter[k] === T_ROAD) { ter[k] = T_ROAD; col[k] = pal.road; }
    else { ter[k] = T_PLANK; hgt[k] = plankTop(k); }
    res[k] |= spine ? 3 : 1;
    return true;
  };

  // 3. omurga (kara biyomunda 2 karo yol; su/boşluk biyomunda 1 karo iskele/köprü: li 5, lj 7)
  const narrow = biome.base !== "ground";
  for (let lj = 0; lj < PD; lj++) for (const li of narrow ? GATE_I.slice(0, 1) : GATE_I) pave(lidx(li, lj), true);
  for (let li = 0; li < PW; li++) for (const lj of narrow ? GATE_J.slice(0, 1) : GATE_J) pave(lidx(li, lj), true);

  // 4. dikiş şeridi + kenar geçitlerinden yol
  const seam = seamSide(ctx.box, cx, cz);
  if (seam) {
    const edge = ctx.edges[OPP[seam]];
    const along = seam === "front" || seam === "back";
    const n = along ? PW : PD;
    const at = (p: number, depth: number) => {
      if (seam === "front") return lidx(p, PD - 1 - depth);
      if (seam === "back") return lidx(p, depth);
      if (seam === "right") return lidx(PW - 1 - depth, p);
      return lidx(depth, p);
    };
    const tally = new Map<string, number>();
    for (let p = 0; p < n; p++) { const e = edge.get(along ? I0 + p : J0 + p); if (e?.open && !e.water) tally.set(e.c, (tally.get(e.c) ?? 0) + 1); }
    const strip = [...tally.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? pal.ground[0];
    const runs: [number, number][] = [];
    for (let p = 0; p < n; p++) {
      const e = edge.get(along ? I0 + p : J0 + p);
      if (!e) continue;
      for (let depth = 0; depth < 2; depth++) {
        const k = at(p, depth);
        res[k] |= 1; sea[k] = 0;
        if (e.water) { ter[k] = T_WATER; hgt[k] = wl[k] = e.h; wet[k] = 1; col[k] = pal.water; continue; }
        if (biome.base === "ground" && !e.void) {
          ter[k] = T_GROUND; wet[k] = 0; col[k] = strip;
          hgt[k] = e.open && Math.abs(e.h) <= 0.4 ? (depth === 0 ? e.h : +((e.h + h0) / 2).toFixed(3)) : h0;
        } else if (e.open) { ter[k] = T_PLANK; hgt[k] = e.h; }
        else if (biome.base === "ground") { ter[k] = T_GROUND; wet[k] = 0; hgt[k] = h0; col[k] = strip; }
      }
      if (e.open && !e.water) { const last = runs.at(-1); if (last && last[0] + last[1] === p) last[1]++; else runs.push([p, 1]); }
    }
    runs.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    for (const [p0, len] of runs.slice(0, 3)) {
      const m = p0 + Math.floor((len - 1) / 2);
      for (const p of len >= 3 ? [m, m + 1] : [m]) {
        for (let depth = 2; depth < (along ? PD : PW); depth++) {
          const k = at(p, depth);
          if (res[k] & 2) break;
          if (!pave(k, false)) break;
        }
      }
    }
  }

  // 5. keşif sınırı engeli
  const outer: Side[] = [];
  for (const s of SIDES) {
    const [dx, dz] = SIDE_VEC[s];
    if (ringOf(ctx.box, cx + dx, cz + dz) <= ctx.radius) continue;
    outer.push(s);
    for (let depth = 0; depth < 2; depth++) for (let p = 0; p < (s === "back" || s === "front" ? PW : PD); p++) {
      const k = s === "back" ? lidx(p, depth) : s === "front" ? lidx(p, PD - 1 - depth) : s === "left" ? lidx(depth, p) : lidx(PW - 1 - depth, p);
      res[k] |= 1;
      if (sea[k]) continue; // kıyı denizi engelin kendisidir (dalgakıran yok)
      if (biome.barrierH > 0) { ter[k] = T_BARRIER; hgt[k] = h0; wet[k] = 0; col[k] = pal.ground[0]; }
      else if (biome.base === "void") ter[k] = T_VOID;
      else { ter[k] = T_WATER; hgt[k] = wl[k] = ctx.waterTop; wet[k] = 1; }
    }
  }

  // E2: sahiplenilmiş parsel düzleşir (ayrılmış karolar — dikiş, omurga, geçit yolu, sınır — ve kıyı denizi aynen kalır)
  if (plot) {
    for (let k = 0; k < PN; k++) if (!res[k] && !sea[k]) { setLand(k); col[k] = pal.ground[0]; }
    if (biome.base === "void") islets.push([0, 0, PW, PD]);
  }

  // 6. gölet / yürünür leke
  const blob = (fn: (k: number) => void) => {
    const q = Math.floor(r() * 4);
    const ci = (q & 1 ? 7 : 1) + r() * 3, cj = (q & 2 ? 9 : 1) + r() * 5, rx = 0.9 + r() * 1.3, rz = 1.1 + r() * 1.6;
    for (let lj = 1; lj < PD - 1; lj++) for (let li = 1; li < PW - 1; li++) {
      const k = lidx(li, lj);
      if (res[k] || ter[k] !== T_GROUND || ((li - ci) / rx) ** 2 + ((lj - cj) / rz) ** 2 > 1) continue;
      fn(k);
    }
  };
  const pondT = new Uint8Array(PN);
  if (!plot && biome.base === "ground" && biome.pond > 0 && r() < biome.pond) {
    blob((k) => { ter[k] = T_WATER; hgt[k] = wl[k] = +(h0 - 0.15).toFixed(3); wet[k] = 1; col[k] = pal.water; pondT[k] = 1; });
  }
  if (!plot && biome.patch && r() < biome.patch) blob((k) => { col[k] = pal.sand; });

  // arazi blok sayısı (öğe bütçesi için): sayısal anahtarlar (renk kimliği · 2^16 + yükseklik mm)
  const colorIds = new Map<string, number>(), colors: string[] = [];
  const cid = (c: string) => { let v = colorIds.get(c); if (v === undefined) { v = colors.length; colors.push(c); colorIds.set(c, v); } return v; };
  const hk = (h: number) => (Math.round(h * 1000) + 32768) & 0xffff;
  const hOf = (key: number) => ((key & 0xffff) - 32768) / 1000;
  const cOf = (key: number) => colors[key >>> 16];
  const keysOf = (fn: (k: number) => number) => { const a = new Int32Array(PN); for (let k = 0; k < PN; k++) a[k] = fn(k); return a; };
  const isLand = (k: number) => ter[k] === T_GROUND || ter[k] === T_ROAD || ter[k] === T_BARRIER;
  const groundKeys = () => keysOf((k) => (isLand(k) ? (cid(col[k]) << 16) | hk(hgt[k]) : -1));
  const waterKeys = () => keysOf((k) => (wet[k] ? hk(wl[k]) : -1));
  const plankKeys = () => keysOf((k) => (ter[k] === T_PLANK ? hk(hgt[k]) : -1));
  const barrierKeys = () => keysOf((k) => (ter[k] === T_BARRIER ? 0 : -1));
  const terrainCount = () => mergeRects(groundKeys()).length + (ctx.ocean ? 0 : 2 * mergeRects(waterKeys()).length) + mergeRects(plankKeys()).length
    + (biome.barrierH > 0 ? mergeRects(barrierKeys()).length : 0) + (biome.base === "void" ? islets.length * 2 : 0);

  // 7. öğeler
  // yoğunluk tabana göre halkayla değişir (dünya kutusuna göre değil): dünya büyürken dış parsel değişmez (X3)
  const baseRing = ringOf(ctx.baseBox, cx, cz);
  const weights = biome.features.map((f) => {
    const o = SCENE_WEIGHTS[ctx.sceneId]?.[f.kind];
    return { kind: f.kind, w: (o ?? f.w) * (baseRing <= 2 ? f.near ?? 1 : f.far ?? 1) };
  }).filter((f) => f.w > 0);
  const wsum = weights.reduce((s, f) => s + f.w, 0);
  const placed: Placed[] = [];
  let budget = NEAR_BUDGET - terrainCount() - 3, glow = 0;
  const order = Array.from({ length: PN }, (_, k) => k);
  for (let k = PN - 1; k > 0; k--) { const q = Math.floor(r() * (k + 1)); [order[k], order[q]] = [order[q], order[k]]; }
  const dseed = mix32(ctx.seed, 0xd3e5);
  if (plot) placePlot(); // E2: yabani öğe yok; çit + bank + rozet
  for (const k0 of order) {
    if (plot || budget <= 0) break;
    const roll = r(), pickRoll = r();
    if (ter[k0] !== T_GROUND || res[k0] || feat[k0] >= 0) continue;
    const li = k0 % PW, lj = Math.floor(k0 / PW);
    const dens = biome.density * (0.3 + 1.4 * fbm(dseed, I0 + li, J0 + lj, 9));
    if (roll > dens || wsum <= 0) continue;
    let t = pickRoll * wsum, kind = weights[0].kind;
    for (const f of weights) { t -= f.w; if (t <= 0) { kind = f.kind; break; } }
    const def = FEATURES[kind];
    if (def.cost > budget || glow + def.glow > GLOW_BUDGET || li + def.w > PW || lj + def.d > PD) continue;
    let ok = true;
    for (let a = 0; a < def.d && ok; a++) for (let q = 0; q < def.w && ok; q++) {
      const k = lidx(li + q, lj + a);
      if (ter[k] !== T_GROUND || res[k] || feat[k] >= 0) ok = false;
    }
    if (!ok) continue;
    const id = placed.length;
    for (let a = 0; a < def.d; a++) for (let q = 0; q < def.w; q++) feat[lidx(li + q, lj + a)] = id;
    placed.push({ kind, li, lj, w: def.w, d: def.d, top: def.top, seed: mix32(seed, li, lj, id), removed: false, blocks: [] });
    budget -= def.cost; glow += def.glow;
  }

  function placePlot() {
    const free = (k: number) => ter[k] === T_GROUND && !res[k] && feat[k] < 0;
    const put = (kind: FeatureKind, li: number, lj: number, w: number, d: number, axis?: "x" | "z") => {
      const id = placed.length;
      for (let a = 0; a < d; a++) for (let q = 0; q < w; q++) feat[lidx(li + q, lj + a)] = id;
      placed.push({ kind, li, lj, w, d, top: FEATURES[kind].top, seed: mix32(seed, li, lj, id), removed: false, blocks: [], axis });
    };
    // çit: dikiş kenarı ve keşif sınırı dışındaki kenarlarda, serbest karoların kesintisiz koşuları (geçitler ayrılmış: açık kalır)
    const fenced = SIDES.filter((sd) => sd !== seam && !outer.includes(sd));
    for (const sd of fenced) {
      const along = sd === "back" || sd === "front", n = along ? PW : PD;
      let run = -1;
      for (let p = 0; p <= n; p++) {
        const k = p < n ? (sd === "back" ? lidx(p, 0) : sd === "front" ? lidx(p, PD - 1) : sd === "left" ? lidx(0, p) : lidx(PW - 1, p)) : -1;
        if (k >= 0 && free(k)) { if (run < 0) run = p; continue; }
        if (run >= 0) {
          const len = p - run;
          if (along) put("fence", run, sd === "back" ? 0 : PD - 1, len, 1, "x");
          else put("fence", sd === "left" ? 0 : PW - 1, run, 1, len, "z");
          run = -1;
        }
      }
    }
    // mola bankı (2 × 1) ve rozet (1 × 1): belirlenimci aday sırası, ilk sığan
    const fits = (li: number, lj: number, w: number) => li >= 1 && lj >= 1 && li + w < PW && lj < PD - 1
      && Array.from({ length: w }, (_, q) => free(lidx(li + q, lj))).every(Boolean);
    const scan = (pref: [number, number][], w: number): [number, number] | null => {
      for (const [li, lj] of pref) if (fits(li, lj, w)) return [li, lj];
      for (let lj = 1; lj < PD - 1; lj++) for (let li = 1; li < PW - 1; li++) if (fits(li, lj, w)) return [li, lj];
      return null;
    };
    const b = scan([[2, 4], [8, 4], [2, 11], [8, 11], [2, 2], [8, 13]], 2);
    if (b) put("bench", b[0], b[1], 2, 1);
    // rozet dikiş girişinin yanında (dünyadan bakınca görünür); köşe parselinde kutu merkezine bakan köşede
    const ent: [number, number][] = seam === "front" ? [[3, PD - 3], [8, PD - 3]] : seam === "back" ? [[3, 2], [8, 2]]
      : seam === "left" ? [[2, 4], [2, 11]] : seam === "right" ? [[PW - 3, 4], [PW - 3, 11]] : [[2, 2], [PW - 3, 2], [2, PD - 3], [PW - 3, PD - 3]];
    const g0 = scan(ent, 1);
    if (g0) put("badge", g0[0], g0[1], 1, 1);
  }

  // 8. bağlantı onarımı
  const isWalk = (k: number) => (ter[k] === T_GROUND || ter[k] === T_ROAD || ter[k] === T_PLANK) && feat[k] < 0 && !sealed[k];
  // dünyadan ulaşılamayan parsel yalnız görseldir: yürünebilirlik 0 (çizim aynı)
  const reachable = ctx.reach.has(pkey(cx, cz));
  const removeFeature = (id: number) => {
    const f = placed[id];
    if (f.removed) return;
    f.removed = true;
    for (let a = 0; a < f.d; a++) for (let q = 0; q < f.w; q++) feat[lidx(f.li + q, f.lj + a)] = -1;
  };
  const stats = { removed: 0, planked: 0, sealed: 0, glow: 0 };
  const label = new Int32Array(PN);
  const nb = (k: number, out: number[]) => {
    out.length = 0;
    const li = k % PW, lj = (k / PW) | 0;
    if (li > 0) out.push(k - 1);
    if (li < PW - 1) out.push(k + 1);
    if (lj > 0) out.push(k - PW);
    if (lj < PD - 1) out.push(k + PW);
    return out;
  };
  const tmp: number[] = [];
  for (let guard = 0; guard < 64; guard++) {
    label.fill(-1);
    const comps: { tiles: number[]; res: number }[] = [];
    for (let k = 0; k < PN; k++) {
      if (label[k] >= 0 || !isWalk(k)) continue;
      const c = comps.length, tiles = [k];
      label[k] = c;
      let rs = 0;
      for (let h = 0; h < tiles.length; h++) {
        const u = tiles[h];
        if (res[u] & 2) rs += 2; else if (res[u]) rs++;
        for (const v of nb(u, tmp)) if (label[v] < 0 && isWalk(v)) { label[v] = c; tiles.push(v); }
      }
      comps.push({ tiles, res: rs });
    }
    if (comps.length <= 1) break;
    let main = 0;
    for (let c = 1; c < comps.length; c++) if (comps[c].res > comps[main].res || (comps[c].res === comps[main].res && comps[c].tiles.length > comps[main].tiles.length)) main = c;
    const other = main === 0 ? 1 : 0;
    // en ucuz yol (Dijkstra, maliyet 0/1/2): öğe kaldır = 1, su/boşluğa iskele = 2; engel ve kıyı denizi geçilmez
    const dist = new Float64Array(PN).fill(Infinity), prev = new Int32Array(PN).fill(-1);
    const step = (k: number) => {
      if (isWalk(k)) return 0;
      if (ter[k] === T_BARRIER || (sea[k] && !biome.spineOverSea)) return Infinity;
      if (feat[k] >= 0 && (ter[k] === T_GROUND || ter[k] === T_ROAD)) return 1;
      if (ter[k] === T_WATER || ter[k] === T_VOID) return 2;
      return Infinity;
    };
    const buckets: number[][] = [[], [], []];
    for (const k of comps[other].tiles) { dist[k] = 0; buckets[0].push(k); }
    let goal = -1;
    for (let d = 0; goal < 0; d++) {
      const bq = buckets[d % 3];
      if (!bq.length) { if (!buckets[(d + 1) % 3].length && !buckets[(d + 2) % 3].length) break; continue; }
      while (bq.length && goal < 0) {
        const u = bq.shift()!;
        if (dist[u] !== d) continue;
        if (label[u] === main) { goal = u; break; }
        for (const v of nb(u, tmp)) {
          const c = step(v);
          if (!Number.isFinite(c) || d + c >= dist[v]) continue;
          dist[v] = d + c; prev[v] = u; buckets[(d + c) % 3].push(v);
        }
      }
    }
    if (goal < 0) {
      for (const k of comps[other].tiles) sealed[k] = 1;
      stats.sealed += comps[other].tiles.length;
      continue;
    }
    for (let k = goal; k >= 0; k = prev[k]) {
      if (feat[k] >= 0) { removeFeature(feat[k]); stats.removed++; }
      if (ter[k] === T_WATER || ter[k] === T_VOID) { ter[k] = T_PLANK; hgt[k] = plankTop(k); stats.planked++; }
    }
  }

  // 9. yayım
  const terrain: Block[] = [];
  const box = (out: Block[], x: number, y0: number, z: number, w: number, h: number, d: number, c: string, g: Group = "solid", j = 0) => {
    out.push({ p: [+x.toFixed(3), +(y0 + h / 2).toFixed(3), +z.toFixed(3)], s: [+w.toFixed(3), +h.toFixed(3), +d.toFixed(3)], c, g: grp(g), j });
  };
  const rx = (li: number, w: number) => bx(I0 + li) + (w - 1) / 2;
  const rz = (lj: number, d: number) => bz(J0 + lj) + (d - 1) / 2;
  const wKeys = ctx.ocean ? null : waterKeys();
  for (const [li, lj, w, d, key] of mergeRects(groundKeys())) box(terrain, rx(li, w), hOf(key) - 1, rz(lj, d), w, 1, d, cOf(key), "solid", 0.04);
  // su (yarı saydam) + yatak: altı boş kalmasın (boşluk/gökyüzü görünmez)
  if (wKeys) for (const [li, lj, w, d, key] of mergeRects(wKeys)) {
    box(terrain, rx(li, w), hOf(key) - 0.8, rz(lj, d), w, 0.8, d, pal.water, "water");
    box(terrain, rx(li, w), hOf(key) - 1.3, rz(lj, d), w, 0.5, d, pal.under, "solid", 0.03);
  }
  for (const [li, lj, w, d, key] of mergeRects(plankKeys())) box(terrain, rx(li, w), hOf(key) - 0.14, rz(lj, d), w, 0.14, d, pal.plank, "solid", 0.05);
  const barrier: Block[] = [];
  if (biome.barrierH > 0) for (const [li, lj, w, d] of mergeRects(barrierKeys())) {
    box(barrier, rx(li, w), h0, rz(lj, d), w - 0.1, biome.barrierH, d - 0.1, pal.barrier, "solid", 0.02);
  }
  const under: Block[] = [];
  if (biome.base === "void") for (const [li, lj, w, d] of islets) {
    box(under, rx(li, w), h0 - 2.2, rz(lj, d), Math.max(0.8, w - 0.8), 1.2, Math.max(0.8, d - 0.8), pal.under, "solid", 0.05);
    box(under, rx(li, w), h0 - 3.2, rz(lj, d), Math.max(0.6, w - 2), 1.0, Math.max(0.6, d - 2), pal.rock[1], "solid", 0.05);
  }
  // öğeler (bütçeye sığmayan sondan atılır)
  let total = terrain.length + barrier.length + under.length;
  const emitFeature = (f: Placed) => {
    f.blocks = [];
    const fr = prng(f.seed), def = FEATURES[f.kind];
    const x = bx(I0 + f.li) + (f.w - 1) / 2, z = bz(J0 + f.lj) + (f.d - 1) / 2;
    const em = { box: (bx_: number, y0: number, bz_: number, w: number, h: number, d: number, c: string, g: Group = "solid", j = 0) => box(f.blocks, bx_, y0, bz_, w, h, d, c, g, j) };
    if (f.kind === "fence" && f.axis) {
      // E2: çit koşusu tek pano + tek korkuluk (koşu uzunluğunda; 2 blok)
      const L = Math.max(f.w, f.d), ax = f.axis === "x";
      em.box(x, h0, z, ax ? L - 0.04 : 0.12, 0.75, ax ? 0.12 : L - 0.04, PLOT_WOOD, "solid", 0.04);
      em.box(x, h0 + 0.75, z, ax ? L : 0.2, 0.1, ax ? 0.2 : L, PLOT_WOOD_DARK);
    } else if (f.kind === "badge" && plot) {
      em.box(x, h0, z, 0.14, 1.3, 0.14, PLOT_WOOD_DARK);
      em.box(x, h0 + 1.3, z, 0.55, 0.55, 0.55, plot.color);
    } else def.draw(em, x, h0, z, fr, pal);
    // EXP-COLLIDE-001 (E1b): gövde bandındaki (0,3–1,0) parça öğenin kendi karolarından komşu (yürünebilir) karoya taşmaz —
    // avatar karo sınırına kadar yaklaşabildiği için taşan yaprak/etek gövdeye girerdi. Bandın ≤ 0,15 altındaysa bant üstüne
    // kaldırılır (görünüm aynı), değilse ayak izine kırpılır.
    const fx0 = bx(I0 + f.li) - 0.5, fz0 = bz(J0 + f.lj) - 0.5, fx1 = fx0 + f.w, fz1 = fz0 + f.d;
    for (const b of f.blocks) {
      if (b.g !== "solid" && b.g !== "glass" && b.g !== "glow") continue;
      const y0 = b.p[1] - b.s[1] / 2, y1 = b.p[1] + b.s[1] / 2;
      if (y0 >= h0 + BODY_HIGH || y1 <= h0 + BODY_LOW) continue;
      const x0 = b.p[0] - b.s[0] / 2, x1 = b.p[0] + b.s[0] / 2, z0 = b.p[2] - b.s[2] / 2, z1 = b.p[2] + b.s[2] / 2;
      if (x0 >= fx0 - 1e-6 && x1 <= fx1 + 1e-6 && z0 >= fz0 - 1e-6 && z1 <= fz1 + 1e-6) continue;
      const lift = h0 + BODY_HIGH - y0;
      if (lift <= 0.15) { b.p[1] = +(b.p[1] + lift).toFixed(3); continue; }
      const a = Math.max(x0, fx0), c = Math.min(x1, fx1), e = Math.max(z0, fz0), g = Math.min(z1, fz1);
      b.p[0] = +((a + c) / 2).toFixed(3); b.s[0] = +(c - a).toFixed(3);
      b.p[2] = +((e + g) / 2).toFixed(3); b.s[2] = +(g - e).toFixed(3);
    }
  };
  for (const f of placed) {
    if (f.removed) continue;
    emitFeature(f);
    if (total + f.blocks.length > NEAR_BUDGET) { removeFeature(placed.indexOf(f)); stats.removed++; continue; }
    total += f.blocks.length;
    f.top = +Math.max(...f.blocks.map((b) => b.p[1] + b.s[1] / 2 - h0)).toFixed(3);
  }
  const live = placed.filter((f) => !f.removed);
  for (const f of live) for (const b of f.blocks) if (b.g === "glow") stats.glow++;

  let near: ParcelNear | null = null;
  if (lod === "both") {
    const blocks = [...terrain, ...barrier, ...under];
    for (const f of live) blocks.push(...f.blocks);
    const walk = new Uint8Array(PN), solid = new Uint8Array(PN), abox = new Float32Array(PN * 4);
    for (let k = 0; k < PN; k++) {
      if (reachable && isWalk(k)) { walk[k] = 1; continue; }
      solid[k] = SOLID;
      const li = k % PW, lj = (k / PW) | 0, x0 = bx(I0 + li) - 0.5, z0 = bz(J0 + lj) - 0.5;
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      if (feat[k] >= 0) for (const q of placed[feat[k]].blocks) {
        if (q.g !== "solid" && q.g !== "glass" && q.g !== "glow") continue;
        if (q.p[1] - q.s[1] / 2 >= h0 + BODY_HIGH || q.p[1] + q.s[1] / 2 <= h0 + BODY_LOW) continue;
        const qa = Math.max(x0, q.p[0] - q.s[0] / 2), qb = Math.max(z0, q.p[2] - q.s[2] / 2);
        const qc = Math.min(x0 + 1, q.p[0] + q.s[0] / 2), qd = Math.min(z0 + 1, q.p[2] + q.s[2] / 2);
        if (qc <= qa || qd <= qb) continue;
        a = Math.min(a, qa); b = Math.min(b, qb); c = Math.max(c, qc); d = Math.max(d, qd);
      }
      if (!Number.isFinite(a)) { a = x0; b = z0; c = x0 + 1; d = z0 + 1; }
      abox.set([a, b, c, d], k * 4);
    }
    near = { blocks, walk, solid, box: abox };
  }
  const fish = near ? parcelFish(ctx, I0, J0, near.walk, ter, wet, wl, hgt, pondT) : [];
  if (near) fishBySolid.set(near.solid, fish);

  // uzak LOD: tek renk zemin (+ kum), su yüzü, engel, adacık altı, uzun silüetler
  const far: Block[] = [];
  const sandId = cid(pal.sand), groundId = cid(pal.ground[0]);
  const landKeys = keysOf((k) => (isLand(k) ? (col[k] === pal.sand ? sandId : groundId) : -1));
  for (const [li, lj, w, d, key] of mergeRects(landKeys)) box(far, rx(li, w), h0 - 1, rz(lj, d), w, 1, d, colors[key]);
  if (wKeys) for (const [li, lj, w, d, key] of mergeRects(wKeys)) box(far, rx(li, w), hOf(key) - 0.4, rz(lj, d), w, 0.4, d, pal.water, "water");
  far.push(...barrier);
  for (let q = 0; q < under.length; q += 2) far.push(under[q]);
  const tall = live.filter((f) => f.top >= 1.2).sort((a, b) => b.top - a.top || a.li - b.li || a.lj - b.lj);
  for (const f of tall) {
    if (far.length >= FAR_BUDGET) break;
    let big = f.blocks[0];
    for (const q of f.blocks) if (q.s[0] * q.s[1] * q.s[2] > big.s[0] * big.s[1] * big.s[2]) big = q;
    far.push({ p: [big.p[0], +(h0 + f.top / 2).toFixed(3), big.p[2]], s: [big.s[0], f.top, big.s[2]], c: big.c, g: big.g === "glow" ? grp("glow") : "solid", j: 0 });
  }

  const slot = plotSlots(ctx).find((p) => p.cx === cx && p.cz === cz);
  return {
    cx, cz, ring, seed, biome: ctx.biome, seam, outer, plotSlot: slot ? slot.slot : null, reachable,
    terrain: ter, height: hgt,
    features: live.map(({ kind, li, lj, w, d, top }) => ({ kind, li, lj, w, d, top })),
    near, far: { blocks: far }, stats, fish,
  };
}

/** parselin olta noktaları (önce her su gövdesine bir, sonra `FISH_SPACING` aralıkla; en çok `FISH_PER_PARCEL`).*/
function parcelFish(ctx: ExpanseContext, I0: number, J0: number, walk: Uint8Array, ter: Uint8Array, wet: Uint8Array, wl: Float64Array,
  hgt: Float64Array, pondT: Uint8Array): ParcelFish[] {
  if (ctx.ocean && ctx.ocean.y < FISH_OCEAN_MIN_Y) return [];
  const water = (li: number, lj: number) => li >= 0 && lj >= 0 && li < PW && lj < PD && ter[lidx(li, lj)] === T_WATER && wet[lidx(li, lj)] === 1;
  // suyun görünen yüzü: okyanuslu sahnede su bloğu çizilmez (okyanus düzlemi), aksi su bloğunun üstü
  const surface = (k: number) => (ctx.ocean ? ctx.ocean.y : wl[k]);
  // parsel içi su gövdeleri
  const body = new Int16Array(PN).fill(-1), pondB: boolean[] = [];
  for (let s0 = 0; s0 < PN; s0++) {
    if (body[s0] >= 0 || !water(s0 % PW, (s0 / PW) | 0)) continue;
    const id = pondB.length, q = [s0];
    body[s0] = id;
    let pond = false;
    for (let p = 0; p < q.length; p++) {
      const c = q[p], li = c % PW, lj = (c / PW) | 0;
      if (pondT[c]) pond = true;
      for (const [a, b] of [[li + 1, lj], [li - 1, lj], [li, lj + 1], [li, lj - 1]]) {
        if (!water(a, b) || body[lidx(a, b)] >= 0 || Math.abs(wl[lidx(a, b)] - wl[c]) >= 0.3) continue;
        body[lidx(a, b)] = id; q.push(lidx(a, b));
      }
    }
    pondB.push(pond);
  }
  if (!pondB.length) return [];
  const quiet = (li: number, lj: number) => ctx.sacred.some((b) => I0 + li >= b.i0 - FISH_SACRED_PAD && I0 + li < b.i1 + FISH_SACRED_PAD
    && J0 + lj >= b.j0 - FISH_SACRED_PAD && J0 + lj < b.j1 + FISH_SACRED_PAD);
  const cands: ParcelFish[] = [];
  for (let lj = 0; lj < PD; lj++) for (let li = 0; li < PW; li++) {
    const k = lidx(li, lj);
    if (!walk[k] || Math.abs(hgt[k]) > FISH_FLAT || quiet(li, lj)) continue;
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      let reach = 0;
      for (const r of [1, 2]) {
        const ni = li + dx * r, nj = lj + dz * r;
        if (water(ni, nj)) { if (water(ni + dx, nj + dz)) reach = r; break; }
        if (r === 1 && (ni < 0 || nj < 0 || ni >= PW || nj >= PD || walk[lidx(ni, nj)])) break; // kara ya da parsel dışı
      }
      if (!reach) continue;
      const wk = lidx(li + dx * reach, lj + dz * reach), y = surface(wk);
      if (y > hgt[k] - 0.05) continue; // su ayak altında
      const off = reach + 0.35;
      cands.push({ li, lj, face: Math.atan2(dx, dz), bx: +(bx(I0 + li) + dx * off).toFixed(3), by: +y.toFixed(3), bz: +(bz(J0 + lj) + dz * off).toFixed(3),
        pond: pondB[body[wk]], body: body[wk] });
      break;
    }
  }
  const out: ParcelFish[] = [], served = new Set<number>(), taken = new Set<ParcelFish>();
  for (const c of cands) if (!served.has(c.body) && out.length < FISH_PER_PARCEL) { served.add(c.body); taken.add(c); out.push(c); }
  for (const c of cands) {
    if (out.length >= FISH_PER_PARCEL) break;
    if (!taken.has(c) && out.every((o) => o.body !== c.body || Math.max(Math.abs(o.li - c.li), Math.abs(o.lj - c.lj)) >= FISH_SPACING)) { taken.add(c); out.push(c); }
  }
  return out.sort((a, b) => a.lj - b.lj || a.li - b.li);
}

/** Parsel karması (EXP-DET-001): yakın + uzak bloklar ve yürünebilirlik (halka numarası hariç: büyümede kararlılık). */
export function parcelHash(p: ParcelOut): string {
  const parts: string[] = [`${p.cx},${p.cz},${p.seam ?? "-"},${p.outer.join("")}`];
  const add = (b: Block) => parts.push(`${b.p.join(",")}|${b.s.join(",")}|${b.c}|${b.g}|${b.j}`);
  for (const b of p.near?.blocks ?? []) add(b);
  parts.push("#");
  for (const b of p.far.blocks) add(b);
  if (p.near) parts.push(Array.from(p.near.walk).join(""));
  return hash32(parts.join(";")).toString(16).padStart(8, "0");
}
