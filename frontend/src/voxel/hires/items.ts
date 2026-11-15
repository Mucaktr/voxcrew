/**
 * LANDMARK-HIRES — kayıtlı simgelerin çizim öğeleri (şehir haritası ve taban sahne). Saf modül: React/three yok
 * (city_check LANDMARK-HIRES-001 ve realism_check doğrudan çağırır).
 */
import { tx, tz, type Block, type Built } from "../scenes";
import type { CityRect, LandmarkCtx } from "../citymap/design";
import { designOf } from "../citymap/designs";
import { districtPlan } from "../citymap/district";
import { CITY_PD, CITY_PW, type CityMapFile } from "../citymap/format";
import { cityX, cityZ } from "../transit/model";
import { hiresMapEntry, hiresSceneEntry } from "./registry";
import { HIRES_ENABLED, isHiResGroup, type HiResItem } from "./types";

export interface HiResMapItem extends HiResItem {
  map: string;
  landmark: string;
  district: string;
  ctx: LandmarkCtx;
  /** izinli bölge (dünya XZ dikdörtgenleri): ayak izi + kayıttaki ek bölge */
  zone: [number, number, number, number][];
  /** semt yerel köken (dünya) — karo dönüşümü: li = floor(x − ox) */
  origin: [number, number];
}

const mapCache = new WeakMap<CityMapFile, HiResMapItem[]>();
/** Haritadaki kayıtlı simgeler (semt sırası; önbellekli). `hi` tembel ve önbellekli. */
export function hiresMapItems(map: CityMapFile): HiResMapItem[] {
  const hit = mapCache.get(map);
  if (hit) return hit;
  const out: HiResMapItem[] = [];
  const design = designOf(map.id);
  if (design) for (const dist of map.districts) {
    const plan = districtPlan(map, dist);
    const ox = cityX(plan.i0) - 0.5, oz = cityZ(plan.j0) - 0.5;
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    for (const lm of plan.landmarks) {
      const entry = hiresMapEntry(map.id, lm.id), model = design.landmarks[lm.id];
      if (!entry || !model) continue;
      const ctx: LandmarkCtx = { x0: ox + lm.i0, z0: oz + lm.j0, w: lm.w, d: lm.d, h: lm.h, cx: ox + lm.i0 + lm.w / 2, cz: oz + lm.j0 + lm.d / 2 };
      const mid = model.near(ctx).filter((b) => isHiResGroup(b.g));
      // ev parseli: district.ts extrasOf `bucket(ctx.cx, ctx.cz)` ile aynı (uzak LOD orada)
      const I = clamp(Math.floor(ctx.cx + 12), plan.i0, plan.i0 + plan.w - 1), J = clamp(Math.floor(ctx.cz + 8), plan.j0, plan.j0 + plan.d - 1);
      const rects: CityRect[] = [[0, 0, lm.w, lm.d], ...(entry.zone ?? [])];
      const zone = rects.map(([a, b, w, d]): [number, number, number, number] => [ctx.x0 + a, ctx.z0 + b, ctx.x0 + a + w, ctx.z0 + b + d]);
      let hi: Block[] | null = null;
      out.push({
        key: `${map.id}/${lm.id}`, map: map.id, landmark: lm.id, district: dist.id, ctx, zone, origin: [ox, oz],
        rect: [ctx.x0, ctx.z0, ctx.x0 + lm.w, ctx.z0 + lm.d], home: [Math.floor(I / CITY_PW), Math.floor(J / CITY_PD)], mid,
        hi: () => (hi ??= entry.hi(ctx, mid).filter((b) => isHiResGroup(b.g)).map((b) => { b.fix = 1; return b; })), // simge (yan kesit açmaz)
      });
    }
  }
  mapCache.set(map, out);
  return out;
}

export interface HiResSceneItem extends HiResItem {
  scene: string;
  tag: string;
  ctx: LandmarkCtx;
  margin: number;
  /** orta model ufuk silüetinden (`backdrop`) geldi (ızgara dışı simge) */
  backdrop: boolean;
}
export interface HiResSceneSplit {
  /** Blocks'a kalan bloklar (simge bölgelerindeki orta model çıkarılmış) */
  rest: Block[];
  /** kalan ufuk silüeti (`Built.backdrop`; ufuktaki simge bölgesinin orta modeli çıkarılmış) */
  backdrop: Block[];
  items: HiResSceneItem[];
}

/** Sahne bloğu simge bölgesinin orta modeline mi ait: merkez XZ bölgede, taban zeminin üstünde, durağan grup. */
function inZone(b: Block, r: readonly [number, number, number, number]): boolean {
  return isHiResGroup(b.g) && !b.r && b.p[0] >= r[0] && b.p[0] <= r[2] && b.p[2] >= r[1] && b.p[2] <= r[3] && b.p[1] - b.s[1] / 2 >= -0.05;
}

const splitCache = new WeakMap<Built, Map<string, HiResSceneSplit | null>>();
/**
 * Taban sahne: kayıtlı simge bölgelerinin (`zones` → `kind: "landmark"`, `tag`) bloklarını (ızgarada `blocks`, ufukta
 * `backdrop`) ayırır. Kayıt yoksa null (Blocks
 * aynen). Büyümüş dünyada bölgeler bloklarla birlikte kaydığı için (districts/core.ts shiftBase) eşleşme korunur.
 */
export function hiresSceneSplit(scene: string, built: Built): HiResSceneSplit | null {
  if (!HIRES_ENABLED) return null;
  let per = splitCache.get(built);
  if (!per) { per = new Map(); splitCache.set(built, per); }
  if (per.has(scene)) return per.get(scene)!;
  const items: HiResSceneItem[] = [];
  const taken = new Set<Block>();
  for (const z of built.zones ?? []) {
    if (z.kind !== "landmark" || !z.tag) continue;
    const entry = hiresSceneEntry(scene, z.tag);
    if (!entry) continue;
    const x0 = tx(z.i0) - 0.5, z0 = tz(z.j0) - 0.5;
    const rect: [number, number, number, number] = [x0, z0, x0 + z.w, z0 + z.d];
    const mid = [...built.blocks, ...(built.backdrop ?? [])].filter((b) => !taken.has(b) && inZone(b, rect));
    if (!mid.length) continue;
    for (const b of mid) taken.add(b);
    const top = Math.max(...mid.map((b) => b.p[1] + b.s[1] / 2));
    const ctx: LandmarkCtx = { x0, z0, w: z.w, d: z.d, h: top, cx: x0 + z.w / 2, cz: z0 + z.d / 2 };
    let hi: Block[] | null = null;
    const back = new Set(built.backdrop ?? []);
    items.push({ key: `${scene}/${z.tag}`, scene, tag: z.tag, ctx, rect, mid, margin: entry.margin ?? 0.6, backdrop: mid.every((b) => back.has(b)),
      hi: () => (hi ??= entry.hi(ctx, mid).filter((b) => isHiResGroup(b.g))) });
  }
  const out = items.length ? { rest: built.blocks.filter((b) => !taken.has(b)), backdrop: (built.backdrop ?? []).filter((b) => !taken.has(b)), items } : null;
  per.set(scene, out);
  return out;
}

/** çıkış/varış pozu seçimi çizilen dünyayı ölçer — orta model yerine hi-res bloklar dahil (kapıdan çıkış ile arrival_check aynı dünya).*/
export function withHires(scene: string, built: Built): Built {
  const sp = hiresSceneSplit(scene, built);
  return sp ? { ...built, blocks: [...sp.rest, ...sp.items.filter((it) => !it.backdrop).flatMap((it) => it.hi())] } : built;
}
