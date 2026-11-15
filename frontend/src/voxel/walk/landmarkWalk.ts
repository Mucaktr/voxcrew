/**
 * LANDMARK-WALK — simgenin yanında ve bahçesinde yürüme: GÖRÜNEN model ile ÇARPIŞMA aynı şeyi söyler (saf; React/three yok).
 *
 * Sorun (ürün sahibi 2026-10-30): simge ayak izi (şehirde `T_LANDMARK`, taban sahnede `footprint` engeli) bütünüyle katıydı; görünen model
 * (yakında yüksek çözünürlük `hi`, uzakta `mid`) ayak izinden küçük ya da seyrekse (harabe, kule ayakları, avlu, meydan) avatar
 * görünmez duvara çarpıyor, avlusu duvarsız görünen camiye/saraya giremiyordu; modelin ayak izi dışına taşan parçasının (kemer
 * ayağı, merdiven) içinden ise geçiyordu. Bu modül karo başına görünen geometriyi yoklar:
 *
 * - `probeTile`: karo ortasında durulacak zemin (`floor`: ortayı ±0,25 örten, tepesi ≤ `floorMax` olan en yüksek blok; yoksa
 * taban), yürüme bandında (zemin + `foot` … zemin + `LW_BAND`) ortanın ±`LW_PAD` çevresine giren görünür katı/cam/su var mı
 * (`free`), ortanın tam üstünde bandı kesen blok var mı (`center`: "görünen duvarın içinden geçme" ölçüsü) ve ortanın üstünde
 * `LW_CEIL`'den alçak bir tavan var mı (`covered`: iç mekân).
 * - `openLandmarkTiles`: ayak izinin boş (`free`) karolarından dışarıdaki yürünür karoya (ya da bahçe karosuna) basamakla
 * (|Δzemin| ≤ `LW_STEP`) bağlananlar yürünür olur. Kapalı cep (kapısız avlu, kule içi) katı kalır; kutsal simgede tavanlı karo
 * (iç mekân) açılmaz — yalnız dış görünüm + avlu (kutsal bölge kuralları ayak izine göre olduğundan değişmez).
 *
 * Kullananlar: `citymap/district.ts` (şehir planı: açılan karo `T_GROUNDS`, görünen parçanın üstündeki yürünür karo `T_WALL`),
 * `scenes.ts` (taban sahne: `landmarkWalkScene` engel kümesini düzeltir), denetim `scripts/landmark_walk_check.mjs`
 * (WALK-LANDMARK-RING-001, WALK-GARDEN-001, WALK-LANDMARK-VIS-001).
*/
import type { Block } from "../scenes";
import type { LandmarkCtx, LandmarkModel } from "../citymap/design";
import { hiresMapEntry, hiresSceneEntry } from "../hires/registry";
import { HIRES_ENABLED, isHiResGroup } from "../hires/types";
import { mapGates, sceneGates } from "./landmarkGates";
export { sceneGates } from "./landmarkGates";

/** Karo ortası çevresindeki pay (avatar gövdesi ≈ 0,27): bu pay içinde bant kesen blok karoyu doldurur. 0,35 — karo
 * kenarından 0,15 içeri giren katı blok karoyu doldurur (<city>_solid B9 `tilesUnder` ölçütüyle aynı; garden.ts 0,3).*/
export const LW_PAD = 0.35;
/** Yürüme bandının tepesi (zemine göre): bunun altına inen blok başa/gövdeye değer (garden.ts GARDEN_BAND ile aynı). */
export const LW_BAND = 1.7;
/** Basamak: komşu karolar arası en çok bu kadar zemin farkıyla yürünür (physics/height.ts STEP_H). */
export const LW_STEP = 0.35;
/** Şehir: bundan yüksek düz yüzey zemin sayılmaz (arena döşemesi, kaide, teras basamağı ≤ 1,2). */
export const LW_FLOOR_MAX_CITY = 1.2;
/** Taban sahne: fizik zemini (physics/height.ts FLOOR_MAX) — daha yüksek kütle beden çarpıştırıcısıdır. */
export const LW_FLOOR_MAX_SCENE = 0.3;
/** Bandın alt kenarı (zemine göre): şehirde 0,15 (bahçe bandı), taban sahnede 0,3 (fizik BODY_LOW). */
export const LW_FOOT_CITY = 0.15;
export const LW_FOOT_SCENE = 0.3;
/** Taban sahne bandının tepesi: fizik baş boşluğu (physics/height.ts HEADROOM = insan boyu 1 + 0,05) — daha yüksek kemer/saçak
 *  altından geçilir (şehirde bahçe bandı 1,7 korunur: tasarım katmanı kapıları ona göre). */
export const LW_BAND_SCENE = 1.05;
/** Tavan: ortanın üstünde bandın üstünden başlayıp bundan alçakta biten örtü iç mekândır (kutsal simgede açılmaz). */
export const LW_CEIL = 3.2;
/** Zemin sayılan bloğun karo ortasını örtme payı (avatar üstünde durabilsin). */
const STAND = 0.25;

/** Görünür kütle sayılmayan gruplar (ışık, hareketli/ortam katmanları). */
const NON_SOLID = new Set(["glow", "smoke", "fire", "cloud", "flag", "leaf"]);
const isWater = (b: Block) => b.g === "water" || (b.g as string) === "wave";
const visible = (b: Block) => !NON_SOLID.has(b.g as string) && !b.r;

/** Blokları karo kovasına dağıtan uzamsal dizin (dünya XZ; birim karo). */
export class BlockIndex {
  private cells = new Map<string, Block[]>();
  constructor(blocks: readonly Block[]) {
    for (const b of blocks) {
      if (!visible(b)) continue;
      const x0 = Math.floor(b.p[0] - b.s[0] / 2 - LW_PAD - 0.5), x1 = Math.floor(b.p[0] + b.s[0] / 2 + LW_PAD + 0.5);
      const z0 = Math.floor(b.p[2] - b.s[2] / 2 - LW_PAD - 0.5), z1 = Math.floor(b.p[2] + b.s[2] / 2 + LW_PAD + 0.5);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) continue; // dev zemin levhası değil, sonsuz kutu: dizine alma
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const k = `${x},${z}`;
        let l = this.cells.get(k);
        if (!l) { l = []; this.cells.set(k, l); }
        l.push(b);
      }
    }
  }
  near(x: number, z: number): readonly Block[] { return this.cells.get(`${Math.floor(x)},${Math.floor(z)}`) ?? []; }
}

export interface TileProbe {
  /** karo ortasında durulacak yüzey (dünya y) */
  floor: number;
  /** yürüme bandında ortanın ±LW_PAD çevresi boş */
  free: boolean;
  /** bandı kesen görünür blok ortanın tam üstünde (içinden geçilir) */
  center: boolean;
  /** ortanın üstünde alçak tavan (iç mekân) */
  covered: boolean;
  /** ortanın altında zemin hizasında (taban − 0,05 … taban + floorMax) basılacak katı yüzey var (su, boşluk değil) */
  ground: boolean;
}

export interface ProbeOpts { base: number; foot: number; floorMax: number; band?: number }

/** Karo ortası (x, z) için görünen geometri yoklaması. */
export function probeTile(idx: BlockIndex, x: number, z: number, o: ProbeOpts): TileProbe {
  const list = idx.near(x, z);
  let floor = o.base, ground = false;
  for (const q of list) {
    if (isWater(q)) continue;
    const top = q.p[1] + q.s[1] / 2;
    if (top < o.base - 0.05 || top > o.base + o.floorMax + 1e-6 || q.p[1] - q.s[1] / 2 > top - 0.02) continue;
    if (Math.abs(x - q.p[0]) <= q.s[0] / 2 - STAND + 1e-6 && Math.abs(z - q.p[2]) <= q.s[2] / 2 - STAND + 1e-6) { ground = true; if (top > floor) floor = top; }
  }
  const lo = floor + o.foot, hi = floor + (o.band ?? LW_BAND);
  let free = true, center = false, covered = false;
  for (const q of list) {
    const dx = Math.abs(x - q.p[0]), dz = Math.abs(z - q.p[2]);
    if (dx >= q.s[0] / 2 + LW_PAD || dz >= q.s[2] / 2 + LW_PAD) continue;
    const b0 = q.p[1] - q.s[1] / 2, b1 = q.p[1] + q.s[1] / 2;
    // 1 mm tolerans: bant sınırına tam oturan kutu (ağ, lento) kayan nokta yüzünden iki yana düşmesin
    const cut = isWater(q) ? b1 > floor - 0.25 && b0 < hi - 1e-3 : b1 > lo + 1e-3 && b0 < hi - 1e-3;
    if (cut) {
      free = false;
      if (dx < q.s[0] / 2 && dz < q.s[2] / 2) center = true;
    } else if (!isWater(q) && b0 >= hi - 0.01 && b0 < floor + LW_CEIL && dx < q.s[0] / 2 && dz < q.s[2] / 2) covered = true;
  }
  return { floor, free, center, covered, ground };
}

/**
 * COURTYARD-PORTAL — iki komşu karo ortası arasındaki ADIM görünen bir duvarı kesiyor mu (ürün sahibi 2026-10-31: "duvarın içinden geçerek
 * giriyorsun"). `probeTile` karo ORTASINI yoklar; karo kenarına oturan ince duvar (avlu duvarı, korkuluk, kapı oyması sonrası kalan
 * dilim) iki yanın ortasına da uzak kalır ve iki karo da yürünür görünür. Burada adım doğrusunun orta kısmı (orta ± `WALL_MID`;
 * doğruyu her iki yandan avatar yarı genişliği `WALL_HALF` kadar örten) yürüme bandında (yüksek zemin + `foot` … alçak zemin + `band`) görünür bir katı
 * blokla kesişirse adım duvardan geçer. Su ve ışık/hareketli gruplar duvar sayılmaz.
*/
export const WALL_MID = 0.35;
export const WALL_HALF = 0.12;
export function wallBetween(idx: BlockIndex, x1: number, z1: number, f1: number, x2: number, z2: number, f2: number, foot: number, band = LW_BAND): boolean {
  const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2, alongX = Math.abs(x2 - x1) > Math.abs(z2 - z1);
  const lo = Math.max(f1, f2) + foot, hi = Math.min(f1, f2) + band;
  const seen = new Set<Block>();
  for (const [px, pz] of [[x1, z1], [x2, z2]] as const) for (const q of idx.near(px, pz)) {
    if (seen.has(q) || isWater(q)) continue;
    seen.add(q);
    const b0 = q.p[1] - q.s[1] / 2, b1 = q.p[1] + q.s[1] / 2;
    if (!(b1 > lo + 1e-3 && b0 < hi - 1e-3)) continue;
    const [ax, ah, cx, ch] = alongX ? [q.p[0], q.s[0] / 2, q.p[2], q.s[2] / 2] : [q.p[2], q.s[2] / 2, q.p[0], q.s[0] / 2];
    const am = alongX ? mx : mz, cm = alongX ? mz : mx;
    // duvar adım doğrusunu avatar yarı genişliği kadar her iki yandan örter (sütun kenarı ya da doğrunun yanındaki dikme duvar değil)
    if (ax + ah > am - WALL_MID && ax - ah < am + WALL_MID && cx - ch <= cm - WALL_HALF && cx + ch >= cm + WALL_HALF) return true;
  }
  return false;
}

/** Ayak izinin karo yoklamaları (landmark yerel a, b; satır öncelikli `b · w + a`). */
export function probeFootprint(idx: BlockIndex, ctx: Pick<LandmarkCtx, "x0" | "z0" | "w" | "d">, o: ProbeOpts): TileProbe[] {
  const out: TileProbe[] = [];
  for (let b = 0; b < ctx.d; b++) for (let a = 0; a < ctx.w; a++) out.push(probeTile(idx, ctx.x0 + a + 0.5, ctx.z0 + b + 0.5, o));
  return out;
}

export interface OpenTile { a: number; b: number; floor: number }

/**
 * Ayak izinde açılacak karolar: `free` (kutsalda tavansız) ve dışarıdaki yürünür bir karodan (`outside(a, b)` → o karonun yüzeyi;
 * yürünmezse NaN; a, b ayak izi dışında olabilir) ya da önceden yürünür iç karodan (`inner(a, b)` → yüzey ya da NaN; bahçe)
 * basamakla ulaşılanlar (4 komşu, |Δzemin| ≤ LW_STEP).
 */
export function openLandmarkTiles(probes: readonly TileProbe[], w: number, d: number, sacred: boolean,
  outside: (a: number, b: number) => number, inner: (a: number, b: number) => number, gate?: (a: number, b: number) => boolean): OpenTile[] {
  // kapı karosu (walk/landmarkGates.ts) lentonun altındadır: kutsal simgede de açılır (iç mekân değil, avlu geçidi)
  const ok = (a: number, b: number) => {
    const p = probes[b * w + a];
    return p.free && !(sacred && p.covered && !gate?.(a, b)) && Number.isNaN(inner(a, b));
  };
  const seen = new Uint8Array(w * d), q: number[] = [];
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  for (let b = 0; b < d; b++) for (let a = 0; a < w; a++) {
    if (!ok(a, b)) continue;
    const f = probes[b * w + a].floor;
    for (const [da, db] of N4) {
      const na = a + da, nb = b + db, inside = na >= 0 && nb >= 0 && na < w && nb < d;
      const t = inside ? inner(na, nb) : outside(na, nb);
      if (!Number.isNaN(t) && Math.abs(t - f) <= LW_STEP + 1e-6) { seen[b * w + a] = 1; q.push(b * w + a); break; }
    }
  }
  for (let h = 0; h < q.length; h++) {
    const k = q[h], a = k % w, b = (k - a) / w, f = probes[k].floor;
    for (const [da, db] of N4) {
      const na = a + da, nb = b + db;
      if (na < 0 || nb < 0 || na >= w || nb >= d) continue;
      const n = nb * w + na;
      if (seen[n] || !ok(na, nb) || Math.abs(probes[n].floor - f) > LW_STEP + 1e-6) continue;
      seen[n] = 1; q.push(n);
    }
  }
  return q.sort((x, y) => x - y).map((k) => ({ a: k % w, b: (k - (k % w)) / w, floor: probes[k].floor }));
}

// ------------------------------------------------------------------------------------------ şehir haritası
/** Şehir simgesinin kapı karosu mu (walk/landmarkGates.ts; landmark yerel). */
export const isMapGate = (mapId: string, lm: string, a: number, b: number): boolean => !!mapGates(mapId, lm)?.some(([ga, gb]) => ga === a && gb === b);
/**
 * Simgenin YAKINDA görünen modeli: yüksek çözünürlük kurucusu kayıtlıysa (ve `?hires=0` değilse) `hi`, değilse orta model.
 * Önbellekli (aynı ctx → aynı dizi): plan, bahçe ve denetim aynı geometriyi görür.
 */
const visCache = new Map<string, Block[]>();
export function landmarkVisual(mapId: string, lmId: string, model: LandmarkModel, ctx: LandmarkCtx, mid: readonly Block[] = model.near(ctx)): Block[] {
  const key = `${mapId}/${lmId}/${ctx.x0},${ctx.z0},${ctx.w},${ctx.d},${ctx.h}`;
  const hit = visCache.get(key);
  if (hit) return hit;
  const e = HIRES_ENABLED ? hiresMapEntry(mapId, lmId) : null;
  const out = e ? e.hi(ctx, mid.filter((b) => isHiResGroup(b.g))).filter((b) => isHiResGroup(b.g)) : mid.slice();
  if (visCache.size > 256) visCache.delete(visCache.keys().next().value as string);
  visCache.set(key, out);
  return out;
}

// ------------------------------------------------------------------------------------------ taban sahne
interface SceneZoneLike { kind: string; i0: number; j0: number; w: number; d: number; tag?: string }
interface SceneLike {
  blocks: Block[]; blocked: Set<string>; width: number; depth: number; zones?: SceneZoneLike[];
  stations: { tile: [number, number] }[]; rest: [number, number][];
  spots: Partial<Record<string, { tile: [number, number] }[]>>;
  ambient?: { kind: string; tile: [number, number] }[];
}

/** Taban sahne simge bölgesinin orta modeli (hires/items.ts `inZone` ile aynı ölçüt). */
const inRect = (b: Block, r: readonly [number, number, number, number]) =>
  isHiResGroup(b.g) && !b.r && b.p[0] >= r[0] && b.p[0] <= r[2] && b.p[2] >= r[1] && b.p[2] <= r[3] && b.p[1] - b.s[1] / 2 >= -0.05;

export interface SceneLandmarkVisual { tag: string; zone: SceneZoneLike; ctx: LandmarkCtx; vis: Block[]; hires: boolean; sacred: boolean }

/** Taban sahnenin simge bölgeleri ve yakında görünen modelleri (hi kayıtlıysa hi, değilse bölgedeki bloklar). */
export function sceneLandmarkVisuals(sceneId: string, built: Pick<SceneLike, "blocks" | "zones">, tx: (i: number) => number, tz: (j: number) => number): SceneLandmarkVisual[] {
  const out: SceneLandmarkVisual[] = [];
  const sacredZones = (built.zones ?? []).filter((z) => z.kind === "sacred");
  for (const z of built.zones ?? []) {
    if (z.kind !== "landmark" || !z.tag) continue;
    const x0 = tx(z.i0) - 0.5, z0 = tz(z.j0) - 0.5;
    const rect: [number, number, number, number] = [x0, z0, x0 + z.w, z0 + z.d];
    const mid = built.blocks.filter((b) => inRect(b, rect));
    if (!mid.length) continue;
    const top = Math.max(...mid.map((b) => b.p[1] + b.s[1] / 2));
    const ctx: LandmarkCtx = { x0, z0, w: z.w, d: z.d, h: top, cx: x0 + z.w / 2, cz: z0 + z.d / 2 };
    const e = HIRES_ENABLED ? hiresSceneEntry(sceneId, z.tag) : null;
    const vis = e ? e.hi(ctx, mid).filter((b) => isHiResGroup(b.g)) : mid;
    const sacred = sacredZones.some((s) => s.i0 < z.i0 + z.w && z.i0 < s.i0 + s.w && s.j0 < z.j0 + z.d && z.j0 < s.j0 + s.d);
    out.push({ tag: z.tag, zone: z, ctx, vis, hires: !!e, sacred });
  }
  return out;
}

export interface SceneWalkFix { opened: string[]; walled: string[] }

/** Fizik beden bandı (physics/world.ts BODY_LOW … BODY_HIGH): bu bantta karo ortasını örten sahne bloğu beden çarpıştırıcısıdır. */
const BODY: readonly [number, number] = [0.3, 1.0];
/** Sahnenin kendi blokları (orta model dahil) karo ortasında beden çarpıştırıcısı kuruyor mu (görünen duvar zaten katı). */
export function colliderAt(idx: BlockIndex, x: number, z: number): boolean {
  for (const q of idx.near(x, z)) {
    if (isWater(q)) continue;
    if (Math.abs(x - q.p[0]) >= q.s[0] / 2 || Math.abs(z - q.p[2]) >= q.s[2] / 2) continue;
    if (q.p[1] + q.s[1] / 2 > BODY[0] && q.p[1] - q.s[1] / 2 < BODY[1]) return true;
  }
  return false;
}

/** Taban sahne: simge bölgesinin bu kadar karo çevresindeki engelli-boş karolar da açılabilir (bitişik avlu, kaide çevresi). */
export const SCENE_REACH = 6;

/** Taban sahne yoklama seçenekleri (zemin 0; fizik zemini ≤ 0,3; bant 0,3 … 1,05). */
export const SCENE_PROBE: ProbeOpts = { base: 0, foot: LW_FOOT_SCENE, floorMax: LW_FLOOR_MAX_SCENE, band: LW_BAND_SCENE };

/** Görünen sahne: bütün bloklar, hi kayıtlı simge bölgelerinde orta model yerine hi. */
export function sceneVisualIndex(built: Pick<SceneLike, "blocks">, lv: readonly SceneLandmarkVisual[]): BlockIndex {
  const replaced = new Set<Block>();
  for (const v of lv) if (v.hires) {
    const rect: [number, number, number, number] = [v.ctx.x0, v.ctx.z0, v.ctx.x0 + v.ctx.w, v.ctx.z0 + v.ctx.d];
    for (const b of built.blocks) if (inRect(b, rect)) replaced.add(b);
  }
  return new BlockIndex([...built.blocks.filter((b) => !replaced.has(b)), ...lv.flatMap((v) => (v.hires ? v.vis : []))]);
}

/**
 * Taban sahne düzeltmesi (yerinde): simge bölgesi ve 1 karoluk halkasında engelli ama görünen sahnece boş (zemini olan, yürüme
 * bandı boş) ve ana bileşenden basamakla ulaşılan karolar açılır; bölgenin (± 2 karo) yürünür karolarından görünen modelin bandı
 * ortasından kestikleri — sahnenin kendi blokları orada zaten beden çarpıştırıcısı kurmuyorsa — engellenir (istasyon, araç/uyku
 * noktası, dinlenme karosu ve ana bileşeni bölen geçit karosu hariç). Görünen sahne: hi kayıtlı bölgelerde orta model yerine hi.
 */
export function landmarkWalkScene<T extends SceneLike>(sceneId: string, built: T, tx: (i: number) => number, tz: (j: number) => number): SceneWalkFix {
  const fix: SceneWalkFix = { opened: [], walled: [] };
  const lv = sceneLandmarkVisuals(sceneId, built, tx, tz);
  if (!lv.length) return fix;
  const idx = sceneVisualIndex(built, lv), own = new BlockIndex(built.blocks), o = SCENE_PROBE;
  const key = (i: number, j: number) => `${i},${j}`;
  const inGrid = (i: number, j: number) => i >= 0 && j >= 0 && i < built.width && j < built.depth;
  const keep = new Set<string>([...built.stations.map((s) => key(s.tile[0], s.tile[1])), ...built.rest.map((t) => key(t[0], t[1]))]);
  for (const l of Object.values(built.spots)) for (const s of l ?? []) keep.add(key(s.tile[0], s.tile[1]));
  // oyun masası kancası (rules GROW-ECO-001: masa karosu engelli, iki ucu yürünür) açılmaz; uçları katılaşmaz
  const play = new Set<string>();
  for (const h of built.ambient ?? []) if (h.kind === "play") {
    play.add(key(h.tile[0], h.tile[1]));
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) keep.add(key(h.tile[0] + a, h.tile[1] + b));
  }
  const probeAt = (i: number, j: number) => probeTile(idx, tx(i), tz(j), o);
  // ana bileşen (doğma karosu her zaman buradadır; walk/controller.ts spawnTile): açılış yalnız ona bağlanan karolardan başlar
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  const freeAt = (i: number, j: number) => inGrid(i, j) && !built.blocked.has(key(i, j));
  const mainSet = (): Set<string> => {
    const seen = new Set<string>();
    let best = new Set<string>();
    for (let j = 0; j < built.depth; j++) for (let i = 0; i < built.width; i++) {
      if (!freeAt(i, j) || seen.has(key(i, j))) continue;
      const comp = new Set<string>([key(i, j)]), q: [number, number][] = [[i, j]];
      seen.add(key(i, j));
      for (let h = 0; h < q.length; h++) for (const [a, b] of N4) {
        const x = q[h][0] + a, y = q[h][1] + b, k = key(x, y);
        if (freeAt(x, y) && !seen.has(k)) { seen.add(k); comp.add(k); q.push([x, y]); }
      }
      if (comp.size > best.size) best = comp;
    }
    return best;
  };
  let main = mainSet();
  // iki geçiş: bir bölgenin açtığı karo komşu bölgenin dar/cep karosunu ana bileşene bağlayabilir
  for (const v of [...lv, ...lv]) {
    // bölge + SCENE_REACH karoluk çevre (simgenin `footprint()` engeli çoğu zaman bölgeden geniştir: kaide, merdiven, bitişik avlu)
    const R = SCENE_REACH, i0 = v.zone.i0 - R, j0 = v.zone.j0 - R, w = v.zone.w + 2 * R, d = v.zone.d + 2 * R;
    const probes: TileProbe[] = [];
    for (let b = 0; b < d; b++) for (let a = 0; a < w; a++) {
      const i = i0 + a, j = j0 + b;
      const p = inGrid(i, j) ? probeAt(i, j) : { floor: 0, free: false, center: false, covered: false, ground: false };
      probes.push(inGrid(i, j) && built.blocked.has(key(i, j)) && p.ground && !play.has(key(i, j)) ? p : { ...p, free: false });
    }
    const surface = (i: number, j: number) => (freeAt(i, j) && main.has(key(i, j)) ? probeAt(i, j).floor : NaN);
    const g = sceneGates(sceneId, v.tag) ?? [];
    const open = openLandmarkTiles(probes, w, d, v.sacred, (a, b) => surface(i0 + a, j0 + b),
      (a, b) => (built.blocked.has(key(i0 + a, j0 + b)) ? NaN : surface(i0 + a, j0 + b)),
      (a, b) => g.some(([ga, gb]) => ga === a - R && gb === b - R));
    // simge bölgesi DIŞINDA (halka/çevre) tek karoluk dar aralık açılmaz (kapı karosu hariç): ana yürüyüş yolunda tek karoluk
    // koridor doğmasın (realism REAL-PATH-001); ayıklamadan sonra ana bileşene bağlanmayan açık karo geri kapanır
    const opened = new Set(open.map((t) => key(i0 + t.a, j0 + t.b)));
    const isGate = (i: number, j: number) => g.some(([ga, gb]) => ga === i - v.zone.i0 && gb === j - v.zone.j0);
    const pass = (i: number, j: number) => opened.has(key(i, j)) || freeAt(i, j);
    for (let changed = true; changed;) {
      changed = false;
      for (const k of [...opened]) {
        const [i, j] = k.split(",").map(Number);
        if (isGate(i, j) || (i >= v.zone.i0 && j >= v.zone.j0 && i < v.zone.i0 + v.zone.w && j < v.zone.j0 + v.zone.d)) continue;
        if ((!pass(i - 1, j) && !pass(i + 1, j)) || (!pass(i, j - 1) && !pass(i, j + 1))) { opened.delete(k); changed = true; }
      }
    }
    const conn = new Set<string>(), q: string[] = [];
    for (const k of opened) {
      const [i, j] = k.split(",").map(Number);
      if (N4.some(([a, b]) => main.has(key(i + a, j + b)))) { conn.add(k); q.push(k); }
    }
    for (let h = 0; h < q.length; h++) {
      const [i, j] = q[h].split(",").map(Number);
      for (const [a, b] of N4) { const n = key(i + a, j + b); if (opened.has(n) && !conn.has(n)) { conn.add(n); q.push(n); } }
    }
    for (const k of conn) { built.blocked.delete(k); fix.opened.push(k); main.add(k); }
  }
  main = mainSet();
  for (const v of lv) {
    const z = v.zone, vidx = new BlockIndex(v.vis);
    for (let j = z.j0 - 2; j < z.j0 + z.d + 2; j++) for (let i = z.i0 - 2; i < z.i0 + z.w + 2; i++) {
      const k = key(i, j);
      if (!inGrid(i, j) || built.blocked.has(k) || keep.has(k)) continue;
      if (!probeTile(vidx, tx(i), tz(j), o).center || colliderAt(own, tx(i), tz(j))) continue;
      // engel ana bileşeni bölmemeli (geçidin tek karosu): bölerse görünen parça geçit üstündedir — karo açık kalır, denetim raporlar
      built.blocked.add(k);
      const after = mainSet();
      if (main.has(k) && after.size < main.size - 1) { built.blocked.delete(k); continue; }
      main = main.has(k) ? after : main;
      fix.walled.push(k);
    }
  }
  return fix;
}
