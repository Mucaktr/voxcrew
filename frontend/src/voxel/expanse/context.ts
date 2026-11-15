/**
 * EXP-GEN (E1a) — çevre bağlamı: kurulmuş dünyadan (Built) bir kez türetilen, üretecin okuduğu salt veri.
 *
 *  - **Kutu** ve **köken**: yapılı dünya kutusu taban çerçevesinde (`modules[0]` = taban; halka düzeninde (di, dj) ötelenmiş).
 *  - **Kenar profili** (`EXP-SEAM-001`): kutunun dört kenarındaki her karonun zemin yüksekliği, rengi, su/boşluk ve
 *    yürünebilirliği. Dikiş şeridi bunu sürdürür (zemin yüksekliği, geçitten çıkan yol, su).
 *  - **Bastırma** (`EXP-BAND-001`): ufuk (`backdrop`) ayak izinin ve ızgara dışı `landmark` bölgelerinin değdiği parseller ile
 *    bunların dünya merkezinden dışa doğru "gölgesi" (ufuk bandı ufuk olarak kalır, arkasına yürünmez), yer hareketlilerinin
 *    (vapur, tramvay, tren, taksi, otobüs, tekne) yolları. Uçan ve su altında yüzen hareketliler araziyle çakışmaz.
 *  - **Gruplar** (+0 çizim çağrısı): çevre yalnız taban sahnede zaten bulunan malzeme gruplarına yazar; olmayan grup `solid`'e
 *    düşer (plan §14.3 R1). Taban verilmezse verilen dünyadan okunur (taban ⊂ büyümüş dünya).
 *  - **Parsel yuvaları** (E2, yalnız veri): ilk halkada, ufuk bandı dışında, önden başlayarak açı sırasıyla ≤ 12 yuva.
 *
 * Saf modül: React/three yok; aynı (sahne, dünya, tohum, yarıçap) → aynı bağlam.
 */
import { isHorizonApron } from "../city/horizonGround";
import type { Block, Built, Group, Mover, SceneDef } from "../scenes";
import { BIOMES, paletteFor, SCENE_BIOME, SCENE_COAST, type BiomeId, type Palette } from "./biomes";
import { boxCenter, boxParcels, intersectsBox, parcelCenter, PD, pkey, PW, ringOf, seamSide, type Side, type TileBox } from "./grid";
import { worldSeed } from "./seed";

/** Keşif yarıçapı (D2 A): seviyeyle 4 → 12 parsel; dünya kutusundan halka sayısı. */
export const RADIUS_MIN = 4;
export const RADIUS_MAX = 12;
export const MAX_PLOTS = 12;
/** 2026-10-19 ek arsa paketi: halkada en çok 16 yuva (sunucu `expanse/service.py MAX_PLOT_SLOTS`). İlk 12'nin sırası değişmez;
 *  ek yuvalar yalnız paket etkinken sahiplenilebilir (sunucu kararı). */
export const MAX_PLOT_SLOTS = 16;

export interface EdgeTile {
  /** zemin üst yüzü (dünya birimi; su karosunda su yüzü) */
  h: number;
  c: string;
  water: boolean;
  /** zemin yok (gökyüzü adası boşluğu) */
  void: boolean;
  /** yürünebilir (built.blocked dışı) */
  open: boolean;
}

export type SuppressReason = "band" | "landmark" | "mover";

export interface ExpanseContext {
  sceneId: string;
  biome: BiomeId;
  seed: number;
  /** keşif yarıçapı (halka) */
  radius: number;
  /** yapılı dünya kutusu (taban karosu; i1/j1 hariç) */
  box: TileBox;
  /** taban sahnenin kutusu (taban çerçevesi; dünya büyürken sabit — öğe yoğunluğu bu halkaya göre) */
  baseBox: TileBox;
  /** taban karosunun dünya ızgarasındaki ötelemesi (di, dj): dünya konumu = taban çerçevesi + köken */
  origin: [number, number];
  /** kutu kenarı → (kenar boyunca mutlak taban karosu I ya da J → kenar karosu) */
  edges: Record<Side, Map<number, EdgeTile>>;
  suppressed: Map<string, SuppressReason>;
  groups: ReadonlySet<Group>;
  /** okyanus düzlemi (deniz sahnesi): su karoları blok üretmez */
  ocean: { y: number } | null;
  /** su yüzü yüksekliği (kenar suyu medyanı; yoksa biyom varsayılanı) */
  waterTop: number;
  /** kara biyomunda zemin üstü; su/boşluk biyomunda adacık zemini */
  h0: number;
  coast: { sea: number; sand: number } | null;
  pal: Palette;
  /** taban çerçevesinde sacred ayak izi + tampon (denetim için) */
  sacred: TileBox[];
  /** taban çerçevesinde ufuk blok ayak izleri (denetim için; karo kutuları) */
  bandBoxes: TileBox[];
  /** dünyadan yürüyerek ulaşılabilen parseller (parsel çizgesi: kenar geçidi → dikiş parseli → sınır geçitleri). Ulaşılamayan
   *  parsel yalnız görseldir (yürünebilirliği 0; ör. yat sahnesinde kenarda geçit yok). */
  reach: Set<string>;
}

export type ExpanseSceneDef = Pick<SceneDef, "id" | "swatch" | "ocean"> & { annex?: SceneDef["annex"] };

/** Yer hareketlileri (araziyle çakışır). Uçanlar ve su altındakiler (denizaltı, vatoz, balık sürüsü) hariç. */
const GROUND_MOVERS = new Set<Mover["shape"]>(["ferry", "tram", "bus", "boat", "felucca", "train", "taxi"]);

export function biomeOf(def: ExpanseSceneDef): BiomeId {
  const own = SCENE_BIOME[def.id];
  if (own) return own;
  if (def.annex === null) return "meadow";
  return (def.annex && SCENE_BIOME[def.annex]) || "meadow";
}

/** Kutu kenarındaki karoların zemin özeti: her blok bir kez taranır, yalnız kenar karoları kaydedilir. */
function edgeProfile(built: Built, origin: [number, number], swatch: string): Record<Side, Map<number, EdgeTile>> {
  const Wd = built.width, Dd = built.depth;
  const top = new Map<number, { h: number; c: string; g: Group }>();
  const note = (i: number, j: number, h: number, c: string, g: Group) => {
    const k = j * Wd + i, t = top.get(k);
    if (!t || h > t.h + 1e-6) top.set(k, { h, c, g });
  };
  for (const b of built.blocks) {
    const y1 = b.p[1] + b.s[1] / 2;
    if (y1 > 0.4 || y1 < -1.6 || b.s[0] < 0.9 || b.s[2] < 0.9) continue;
    const ia = Math.max(0, Math.ceil(b.p[0] + 11.5 - b.s[0] / 2 - 1e-6)), ib = Math.min(Wd - 1, Math.floor(b.p[0] + 11.5 + b.s[0] / 2 + 1e-6));
    const ja = Math.max(0, Math.ceil(b.p[2] + 7.5 - b.s[2] / 2 - 1e-6)), jb = Math.min(Dd - 1, Math.floor(b.p[2] + 7.5 + b.s[2] / 2 + 1e-6));
    if (ia > ib || ja > jb) continue;
    if (ja === 0 || jb === Dd - 1) for (let i = ia; i <= ib; i++) { if (ja === 0) note(i, 0, y1, b.c, b.g); if (jb === Dd - 1) note(i, Dd - 1, y1, b.c, b.g); }
    if (ia === 0 || ib === Wd - 1) for (let j = ja; j <= jb; j++) { if (ia === 0) note(0, j, y1, b.c, b.g); if (ib === Wd - 1) note(Wd - 1, j, y1, b.c, b.g); }
  }
  const tile = (i: number, j: number): EdgeTile => {
    const t = top.get(j * Wd + i), open = !built.blocked.has(`${i},${j}`);
    if (!t) return { h: 0, c: swatch, water: false, void: true, open };
    const water = !open && (t.g === "water" || t.g === "wave");
    return { h: +t.h.toFixed(3), c: t.c, water, void: false, open };
  };
  const [di, dj] = origin;
  const out: Record<Side, Map<number, EdgeTile>> = { back: new Map(), front: new Map(), left: new Map(), right: new Map() };
  for (let i = 0; i < Wd; i++) { out.back.set(i - di, tile(i, 0)); out.front.set(i - di, tile(i, Dd - 1)); }
  for (let j = 0; j < Dd; j++) { out.left.set(j - dj, tile(0, j)); out.right.set(j - dj, tile(Wd - 1, j)); }
  return out;
}

/** Blok ayak izinin kapsadığı taban karoları (taban çerçevesi). */
function footprint(b: Block, origin: [number, number]): TileBox {
  const [di, dj] = origin;
  return {
    i0: Math.floor(b.p[0] - b.s[0] / 2 + 12) - di, i1: Math.ceil(b.p[0] + b.s[0] / 2 + 12) - di,
    j0: Math.floor(b.p[2] - b.s[2] / 2 + 8) - dj, j1: Math.ceil(b.p[2] + b.s[2] / 2 + 8) - dj,
  };
}

function parcelsOf(t: TileBox): [number, number][] {
  const out: [number, number][] = [];
  for (let cx = Math.floor(t.i0 / PW); cx <= Math.floor((t.i1 - 1) / PW); cx++)
    for (let cz = Math.floor(t.j0 / PD); cz <= Math.floor((t.j1 - 1) / PD); cz++) out.push([cx, cz]);
  return out;
}

function suppression(built: Built, box: TileBox, origin: [number, number], radius: number) {
  const out = new Map<string, SuppressReason>();
  const sources = new Map<string, SuppressReason>();
  const bandBoxes: TileBox[] = [];
  for (const b of built.backdrop ?? []) {
    if (isHorizonApron(b)) continue; // HORIZON: ufuk önlüğü (tabanın 6 cm altında zemin) bant değil; çevre parseli üstünü örter
    const fp = footprint(b, origin);
    bandBoxes.push(fp);
    for (const [cx, cz] of parcelsOf(fp)) if (!intersectsBox(box, cx, cz)) sources.set(pkey(cx, cz), "band");
  }
  const W0 = built.width, D0 = built.depth, [di, dj] = origin;
  for (const z of built.zones ?? []) {
    if (z.kind !== "landmark") continue;
    if (z.i0 >= 0 && z.j0 >= 0 && z.i0 + z.w <= W0 && z.j0 + z.d <= D0) continue; // ızgara içi simge: kutunun içinde
    const fp = { i0: z.i0 - di, j0: z.j0 - dj, i1: z.i0 + z.w - di, j1: z.j0 + z.d - dj };
    bandBoxes.push(fp);
    for (const [cx, cz] of parcelsOf(fp)) if (!intersectsBox(box, cx, cz)) sources.set(pkey(cx, cz), "landmark");
  }
  // gölge: kaynağın dünya merkezinden dışa doğru konisi (ufuk bandının arkası üretilmez)
  const [mx, mz] = boxCenter(box);
  const src = [...sources.keys()].map((k) => { const [cx, cz] = k.split(",").map(Number); const [x, z] = parcelCenter(cx, cz); return { k, vx: x - mx, vz: z - mz }; });
  const p = boxParcels(box), R = radius + 1;
  for (let cx = p.c0 - R; cx < p.c1 + R; cx++) for (let cz = p.r0 - R; cz < p.r1 + R; cz++) {
    const k = pkey(cx, cz);
    if (intersectsBox(box, cx, cz)) continue;
    const s = sources.get(k);
    if (s) { out.set(k, s); continue; }
    const [x, z] = parcelCenter(cx, cz), vx = x - mx, vz = z - mz, d = Math.hypot(vx, vz);
    for (const q of src) {
      const dq = Math.hypot(q.vx, q.vz);
      if (d < dq + 1 || dq < 1e-6) continue;
      const cos = (vx * q.vx + vz * q.vz) / (d * dq);
      if (cos >= Math.cos(Math.atan2(7, dq))) { out.set(k, sources.get(q.k)!); break; }
    }
  }
  // yer hareketlileri: yol üstündeki parseller (gölgesiz)
  for (const mv of built.movers ?? []) {
    if (!GROUND_MOVERS.has(mv.shape) || mv.path.length === 0) continue;
    const pts = mv.mode === "pingpong" ? mv.path : [...mv.path, mv.path[0]];
    for (let s = 0; s + 1 < pts.length || (pts.length === 1 && s === 0); s++) {
      const a = pts[s], b = pts[Math.min(s + 1, pts.length - 1)];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.5));
      for (let k = 0; k <= n; k++) {
        const x = a[0] + ((b[0] - a[0]) * k) / n, z = a[2] + ((b[2] - a[2]) * k) / n;
        const I = Math.floor(x + 12) - di, J = Math.floor(z + 8) - dj;
        const cx = Math.floor(I / PW), cz = Math.floor(J / PD);
        if (!intersectsBox(box, cx, cz) && !out.has(pkey(cx, cz))) out.set(pkey(cx, cz), "mover");
      }
    }
  }
  return { out, bandBoxes };
}

export interface ContextOptions {
  /** kullanıcı dünyası tohumu (`expanse.seed`); yoksa yerleşik sahne tohumu */
  seed?: number;
  /** keşif yarıçapı (halka; 2…12, varsayılan 4) */
  radius?: number;
  /** taban sahne (malzeme grupları için; yoksa `built`) */
  base?: Built;
}

/** Kurulmuş dünyadan çevre bağlamı. */
export function expanseContext(def: ExpanseSceneDef, built: Built, opts: ContextOptions = {}): ExpanseContext {
  const biome = biomeOf(def);
  const radius = Math.max(1, Math.min(RADIUS_MAX, Math.round(opts.radius ?? RADIUS_MIN)));
  const m0 = built.modules.find((m) => m.base) ?? built.modules[0] ?? { i0: 0, j0: 0, w: built.width, d: built.depth };
  const origin: [number, number] = [m0.i0, m0.j0];
  const box: TileBox = { i0: -origin[0], j0: -origin[1], i1: built.width - origin[0], j1: built.depth - origin[1] };
  const edges = edgeProfile(built, origin, def.swatch[0]);
  const { out: suppressed, bandBoxes } = suppression(built, box, origin, radius);
  const groups = new Set<Group>();
  const src = opts.base ?? built;
  for (const b of src.blocks) groups.add(b.g);
  for (const b of src.backdrop ?? []) groups.add(b.g);
  const ocean = def.ocean ? { y: def.ocean.y } : null;
  // su yüzü tabandan okunur (büyüme kararlılığı: dış parseller dünya büyürken değişmez)
  const baseEdges = opts.base && opts.base !== built ? edgeProfile(opts.base, [0, 0], def.swatch[0]) : edges;
  const wh: number[] = [];
  for (const s of Object.values(baseEdges)) for (const e of s.values()) if (e.water) wh.push(e.h);
  wh.sort((a, b) => a - b);
  const waterTop = wh.length ? wh[Math.floor(wh.length / 2)] : ocean ? +(ocean.y + 0.12).toFixed(3) : -0.2;
  const base = BIOMES[biome].base;
  const h0 = base === "water" ? +(waterTop + 0.2).toFixed(3) : 0;
  const sacred: TileBox[] = [];
  for (const z of built.zones ?? []) if (z.kind === "sacred") {
    const m = z.buffer ?? 1;
    sacred.push({ i0: z.i0 - m - origin[0], j0: z.j0 - m - origin[1], i1: z.i0 + z.w + m - origin[0], j1: z.j0 + z.d + m - origin[1] });
  }
  const ctx: ExpanseContext = {
    sceneId: def.id, biome, seed: (opts.seed ?? worldSeed(def.id)) >>> 0, radius, box, baseBox: { i0: 0, j0: 0, i1: m0.w, j1: m0.d }, origin, edges, suppressed, groups, ocean,
    waterTop, h0, coast: SCENE_COAST[def.id] ?? null, pal: paletteFor(biome, def.id, def.swatch), sacred, bandBoxes, reach: new Set(),
  };
  ctx.reach = reachable(ctx);
  return ctx;
}

/** Parsel çizgesinde dünyadan ulaşılabilirlik. Tohum: kutuya bakan kenarında en az bir yürünebilir dünya kenar karosu olan
 *  dikiş parseli. Komşuluk: iki parsel de üretiliyor ve ortak sınırdaki omurga geçidi kıyı denizinde değil (generate.ts omurgası). */
function reachable(ctx: ExpanseContext): Set<string> {
  const open = new Set(openParcels(ctx).map((p) => pkey(p.cx, p.cz)));
  const spineOverSea = BIOMES[ctx.biome].spineOverSea, sea = ctx.coast?.sea ?? -Infinity;
  const queue: [number, number][] = [], seen = new Set<string>();
  for (const k of open) {
    const [cx, cz] = k.split(",").map(Number), side = seamSide(ctx.box, cx, cz);
    if (!side) continue;
    const edge = ctx.edges[({ back: "front", front: "back", left: "right", right: "left" } as const)[side]];
    const along = side === "front" || side === "back";
    let ok = false;
    for (let p = 0; p < (along ? PW : PD) && !ok; p++) { const e = edge.get(along ? cx * PW + p : cz * PD + p); if (e?.open) ok = true; }
    if (ok) { seen.add(k); queue.push([cx, cz]); }
  }
  for (let h = 0; h < queue.length; h++) {
    const [cx, cz] = queue[h];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const k = pkey(cx + dx, cz + dz);
      if (seen.has(k) || !open.has(k)) continue;
      // x komşusu: geçit satırları J = 16·cz + 7, 8; z komşusu: sınırın iki yanındaki satırlar
      const rowJ = dx ? cz * PD + 7 : Math.max(cz, cz + dz) * PD - 1;
      if (!spineOverSea && rowJ < sea) continue;
      seen.add(k); queue.push([cx + dx, cz + dz]);
    }
  }
  return seen;
}

export type ParcelState = "inside" | "beyond" | SuppressReason | "open";

/** Parselin durumu: kutunun içinde (yapılı dünya kazanır), yarıçap dışında, bastırılmış ya da üretilir. */
export function parcelState(ctx: ExpanseContext, cx: number, cz: number): ParcelState {
  if (intersectsBox(ctx.box, cx, cz)) return "inside";
  if (ringOf(ctx.box, cx, cz) > ctx.radius) return "beyond";
  return ctx.suppressed.get(pkey(cx, cz)) ?? "open";
}

/** Yarıçap içindeki üretilecek parseller (halka, sonra cz, cx sırasıyla). */
export function openParcels(ctx: ExpanseContext, radius = ctx.radius): { cx: number; cz: number; ring: number }[] {
  const p = boxParcels(ctx.box), out: { cx: number; cz: number; ring: number }[] = [];
  for (let cz = p.r0 - radius; cz < p.r1 + radius; cz++) for (let cx = p.c0 - radius; cx < p.c1 + radius; cx++) {
    const ring = ringOf(ctx.box, cx, cz);
    if (ring < 1 || ring > Math.min(radius, ctx.radius) || ctx.suppressed.has(pkey(cx, cz))) continue;
    out.push({ cx, cz, ring });
  }
  return out.sort((a, b) => a.ring - b.ring || a.cz - b.cz || a.cx - b.cx);
}

export interface PlotSlot { slot: number; cx: number; cz: number; side: Side | null }

/**
 * E2 parsel yuvaları (plan §7.2; yalnız veri): dünya kutusunun hemen dışındaki ilk halkada, bastırılmamış ve dünyadan yürüyerek
 * ulaşılabilen parseller. Önce
 * kutuya kenar komşusu olanlar, sonra köşeler; her grupta dünya merkezinden bakışla ön yönden (+z) açı sırası, eşitlikte sağ (+x)
 * önce → ön-orta, sağ-ön, sol-ön, sağ, sol, arka… ≤ 12. Ajan sayısı değişince kutuyla birlikte kayar.
 */
const slotCache = new WeakMap<ExpanseContext, PlotSlot[]>();
export function plotSlots(ctx: ExpanseContext): PlotSlot[] {
  const hit = slotCache.get(ctx);
  if (hit) return hit;
  const [mx, mz] = boxCenter(ctx.box);
  const cand = openParcels(ctx, 1).filter(({ cx, cz }) => ctx.reach.has(pkey(cx, cz))).map(({ cx, cz }) => {
    const [x, z] = parcelCenter(cx, cz), a = Math.atan2(x - mx, z - mz);
    return { cx, cz, side: seamSide(ctx.box, cx, cz), a: +Math.abs(a).toFixed(6), right: a >= 0 ? 0 : 1 };
  });
  cand.sort((p, q) => (p.side ? 0 : 1) - (q.side ? 0 : 1) || p.a - q.a || p.right - q.right || p.cz - q.cz || p.cx - q.cx);
  const out = cand.slice(0, MAX_PLOT_SLOTS).map((c, slot) => ({ slot, cx: c.cx, cz: c.cz, side: c.side }));
  slotCache.set(ctx, out);
  return out;
}

/** Taban çerçevesi → dünya: blokları kökene öteler (E1b çizimi için yeni dizi). */
export function toWorld(blocks: readonly Block[], ctx: Pick<ExpanseContext, "origin">): Block[] {
  const [di, dj] = ctx.origin;
  if (!di && !dj) return blocks.slice();
  return blocks.map((b) => ({ ...b, p: [b.p[0] + di, b.p[1], b.p[2] + dj] }));
}

