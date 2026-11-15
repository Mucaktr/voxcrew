/**
 * WALK-PHYS — 2,5B yükseklik alanı, tırmanma ve dikey fizik (yalnız avatar; ajanlar yerde kalır). Saf modül: React/three yok.
 *
 * Yatay çarpışma 2B daire çözücüsünde kalır (physics/world.ts, walk/controller.ts). Bu dosya onun üstüne bir "ayak yüksekliği"
 * ekler: avatarın `y`'si (ayak) ve dikey hızı; karo sütunlarının üst yüzü; basamak, zıplama ve düşme.
 *
 * Karo sütunu (`heightField`, dünya başına bir kez, WeakMap):
 *  - `floor`: yürünebilir karonun zemin yüksekliği (merkezi örten, üstü ≤ `FLOOR_MAX` blok ya da ≥ 6 karoluk güverte plakası; 0,06
 *    altı 0 sayılır). 2B'de yürünebilir karolar arasında geçiş HER ZAMAN serbesttir (eski davranış; rampa/güverte gerilemesi yok).
 *  - `top`: engelin üst yüzü — karo merkezini örten katı (solid) blokların gövde bandında (taban < 1) başlayan ilk açıklıksız
 *    yığınının tepesi. Bank oturağı 0,47, kum torbası 0,5, sandık 0,8, alçak duvar 1, masa 0,79…
 *  - `ceil`: o yüzeyin üstündeki ilk blok tabanı (tavan; kemer, saçak, raf, çatı) — W5 `ceilY` / örtü `roofY` ile aynı veri,
 *    ama her yüzey için. Zıplama tepe noktası `ceil − HUMAN_H`'ı aşmaz.
 *  - `climb`: 1 → üstünde durulabilir (tırmanılabilir) engel. Geometri: üst yüz `top` ≤ `CLIMB_TOP_MAX`; tepedeki blok opak
 *    (`solid`; cam/ışık/ekran değil) ve ayağa yetecek kadar geniş (karo içindeki izi ≥ `STAND_AREA`: fener başlığı, saksı
 *    yaprağı, direk değil); karo iç karesinde (merkez ± 0,25) gövde yüksekliğinde başka çıkıntı yok (düz üst); tepe ile
 *    tavan arası ≥ `HEADROOM`. Asla tırmanılamaz: su karosu, kutsal bölge (ayak izi + tamponu), istasyon/uyku/araç noktası ve
 *    onlara 4-komşu çalışma eşyası (masa, konsol, yatak), oyun masası kancası, ızgara dışı (çevre parseli kendi listesiyle).
 *    Hareket eden taşıtlar fiziksel değildir (yalnız çizim) → üstlerine çıkılmaz; ajanlar daire bedendir → üstlerine çıkılmaz.
 *    Böylece bank, alçak duvar, sandık, kum torbası, basamak, kaya, saksı kenarı, rampa/basamak blokları ve erişilebilen alçak
 *    çatılar (yığın zinciri: sandık → çatı) tırmanılır; ağaç, direk, lamba, yüksek duvar, bina engel kalır.
 *
 * Kurallar (avatar boyu `HUMAN_H` = 1, yürüme ölçeği; walk/scale.ts):
 *  - basamak `STEP_H` (0,35 · boy): kendiliğinden çıkılır; aşağı inerken `STEP_H`'a kadar yere yapışır (merdiven inişi).
 *  - zıplama: tepe `JUMP_APEX` (0,75 · boy) + havada basamak payı → `CLIMB_MAX` (1,1) yüksekliğe kadar kenara çıkılır.
 *    Kısa "coyote" süresi (kenardan düştükten sonra 0,1 sn zıplanabilir) ve girdi tamponu (yere değmeden 0,12 sn önce basılan
 *    zıplama inişte çalışır). Belirlenimci: aynı girdi dizisi → aynı yol (sabit adım çağıranın; `stepVertical` saf).
 *  - tünelleme yok: yatay hareket 0,2'lik alt adımlarla (controller), dikey konum her adımda bulunduğu yüzeye kıskaçlanır;
 *    dünya sınırı ve ızgara dışı her yükseklikte katıdır (çevre parseli yoksa).
 *
 * ## WALK-EXPLORE: ek yürünebilir alan kaydı (iç mekânlar)
 *
 *   const off = registerWalkArea("galata-ic", { w, d, solid }, { floor, ceil }, [i0, j0]);
 *   ...
 *   off(); // ya da unregisterWalkArea("galata-ic")
 *
 *  - `grid.solid` (Uint8Array, j·w + i): 1 = durulamaz/katı. `heights.floor`: karo başına zemin y'si (dünya; Float32Array ya da
 *    tek sayı), `heights.ceil` isteğe bağlı tavan y'si (Infinity = yok). `origin`: alanın sol-arka karosu (dünya ızgarası; ızgara
 *    dışında, ör. bir simgenin ayak izinin içinde ya da çevrede olabilir).
 *  - Alan karoları taban dünyayı EZER (yalnız avatar için: çarpışma, yüzey, tıkla-git). Taban ↔ alan geçişi basamak kuralına
 *    uyar (yükseliş ≤ `STEP_H`; iniş serbest). Sonra kaydedilen alan öncekinin üstündedir. Ajanlar ve dünya kuralları etkilenmez.
 *  - `walkAreaVersion.v` her kayıtta artar (önbellek anahtarı). Kayıt modül düzeyindedir; sahne/sayfa değişince çağıran siler.
 *  - Bir alanın yüksekliklerini okumak için: `areaAt(i, j)` → { area, k } ya da null.
 */
import { isInSacredBuffer } from "../city/sacred";
import { D, W, type Block, type Built, type Tile } from "../scenes";

// ------------------------------------------------------------------------------------------ sabitler (yürüme ölçeği)
/** yürüme ölçeğinde insan boyu (baş tepesi; walk/scale.ts WALK_HUMAN_H ile aynı) */
export const HUMAN_H = 1.0;
/** kendiliğinden çıkılan basamak (boyun ~%35'i) */
export const STEP_H = 0.35 * HUMAN_H;
/** zıplamada ayakların yükselişi (tepe) */
export const JUMP_APEX = 0.75 * HUMAN_H;
/** zıplayarak çıkılabilen en yüksek kenar: tepe + havada basamak payı */
export const CLIMB_MAX = JUMP_APEX + STEP_H;
/** tırmanılabilir sayılan üst yüzün mutlak üst sınırı (yığın zinciriyle alçak çatı; daha yükseği engel kalır) */
export const CLIMB_TOP_MAX = 2.6;
/** yer çekimi (birim/sn²) ve zıplama hızı (tepe JUMP_APEX) */
export const GRAVITY = 22;
export const JUMP_V = Math.sqrt(2 * GRAVITY * JUMP_APEX);
/** kenardan düştükten sonra zıplanabilen süre ve erken basılan zıplamanın saklandığı süre (sn) */
export const COYOTE_S = 0.1;
export const JUMP_BUFFER_S = 0.12;
/** tırmanılan üst yüzün üstünde gereken boşluk */
export const HEADROOM = HUMAN_H + 0.05;
/** yürünebilir karoda zemin sayılan blokların üst sınırı (bordür, kilim, alçak güverte) */
export const FLOOR_MAX = 0.3;
/** tavan sayılan blok tabanının zemine göre en alçak yüksekliği (walk/controller.ts CEIL_MIN, W5)*/
export const CEIL_MIN = 0.95;
/** gövde bandının tavanı (physics/world.ts BODY_HIGH): engel yığını bunun altında başlar */
const BODY_HIGH = 1.0;
/** bundan alçak üst yüzler zemin plakasıdır (0) */
const GROUND_EPS = 0.06;
/** üst yüzde durmak için tepedeki bloğun karo içindeki en küçük izi (birim²) */
export const STAND_AREA = 0.3;
/** üst yüzün düzlüğü için iç kare yarı kenarı ve tolerans */
const INNER = 0.25;
const FLAT_TOL = 0.12;
/** yığında bu kadar boşluk bitişik sayılır */
const GAP = 0.03;
const STAND_GROUPS = new Set(["solid", "glass", "glow"]);
const WET_GROUPS = new Set(["water", "wave"]);
const HW = W / 2, HD = D / 2;

// ------------------------------------------------------------------------------------------ yükseklik alanı
export interface HeightField {
  width: number;
  depth: number;
  /** yürünebilir karonun zemin yüksekliği */
  floor: Float32Array;
  /** engel üst yüzü (yoksa NaN) */
  top: Float32Array;
  /** `climb` ise üst yüzün, değilse zeminin üstündeki ilk blok tabanı (Infinity = açık) */
  ceil: Float32Array;
  /** zeminin üstündeki tavan (yürünebilir karoda zıplama sınırı) */
  floorCeil: Float32Array;
  /** 1 = üstünde durulabilir engel */
  climb: Uint8Array;
  /** 1 = su karosu (merkezde su/dalga bloğu) */
  water: Uint8Array;
  /** sayaçlar (walk_check, belge) */
  climbable: number;
}

type HeightSource = Pick<Built, "width" | "depth" | "blocks" | "blocked" | "stations" | "spots" | "zones" | "modules" | "ambient">;
const cache = new WeakMap<object, HeightField>();

/** Karo merkezi bloğun xz izdüşümünde mi (örtü ızgarası kuralı); iç kare kesişimi ayrı. */
function tileSpan(min: number, max: number, half: number, n: number, pad: number): [number, number] {
  // merkez c = i − half + 0,5; [c − pad, c + pad] ∩ [min, max] ≠ ∅ → i ∈ (min + half − 0,5 − pad, max + half − 0,5 + pad)
  const a = Math.max(0, Math.ceil(min + half - 0.5 - pad - 1e-6));
  const b = Math.min(n - 1, Math.floor(max + half - 0.5 + pad + 1e-6));
  return [a, b];
}

/** Bir karonun sütunu: merkezdeki ve iç karedeki katı aralıklar. */
/** merkez: [taban, tepe, tür (0 cam/ışık, 1 katı, 2 güverte plakası), karo içi iz alanı]; iç kare: [taban, tepe] */
interface Col { center: number[]; inner: number[]; wet: boolean }

/** Dünya başına bir kez (WeakMap) — bkz. dosya başı. */
export function heightField(built: HeightSource): HeightField {
  let hf = cache.get(built);
  if (hf) return hf;
  const { width, depth } = built;
  const n = width * depth;
  const cols: (Col | undefined)[] = new Array(n);
  const col = (k: number) => (cols[k] ??= { center: [], inner: [], wet: false });
  for (const b of built.blocks) {
    const stand = STAND_GROUPS.has(b.g), wet = WET_GROUPS.has(b.g);
    if (!stand && !wet) continue;
    const y0 = b.p[1] - b.s[1] / 2, y1 = b.p[1] + b.s[1] / 2;
    if (stand && y1 <= GROUND_EPS) continue;
    const minX = b.p[0] - b.s[0] / 2, maxX = b.p[0] + b.s[0] / 2, minZ = b.p[2] - b.s[2] / 2, maxZ = b.p[2] + b.s[2] / 2;
    const plate = (maxX - minX) * (maxZ - minZ) > 36;
    const [i0, i1] = tileSpan(minX, maxX, HW, width, stand ? INNER : 0);
    const [j0, j1] = tileSpan(minZ, maxZ, HD, depth, stand ? INNER : 0);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = i - HW + 0.5, cz = j - HD + 0.5;
      const atCenter = cx >= minX - 1e-6 && cx <= maxX + 1e-6 && cz >= minZ - 1e-6 && cz <= maxZ + 1e-6;
      const c = col(j * width + i);
      if (wet) { if (atCenter) c.wet = true; continue; }
      if (atCenter) {
        const area = (Math.min(maxX, cx + 0.5) - Math.max(minX, cx - 0.5)) * (Math.min(maxZ, cz + 0.5) - Math.max(minZ, cz - 0.5));
        c.center.push(y0, y1, plate ? 2 : b.g === "solid" ? 1 : 0, area);
      }
      // iç kare: kenardaki ince süs (bank sırtı, direk) değil, ayağın basacağı alan
      c.inner.push(y0, y1);
    }
  }
  const floor = new Float32Array(n), top = new Float32Array(n).fill(NaN), ceil = new Float32Array(n).fill(Infinity);
  const floorCeil = new Float32Array(n).fill(Infinity), climb = new Uint8Array(n), water = new Uint8Array(n);
  const deny = denyTiles(built);
  // engelli karoda (kürsü, alçak duvar) zemin plakası yoktur: engel yığını yerden ölçülür
  const blockedTile = new Uint8Array(n);
  for (const key of built.blocked) {
    const c = key.indexOf(",");
    const i = Number(key.slice(0, c)), j = Number(key.slice(c + 1));
    if (i >= 0 && j >= 0 && i < width && j < depth) blockedTile[j * width + i] = 1;
  }
  const off = baseOff(built);
  let climbable = 0;
  const spans: number[] = [];
  for (let k = 0; k < n; k++) {
    const c = cols[k];
    if (!c) continue;
    if (c.wet) water[k] = 1;
    // zemin: merkezi örten alçak blok ya da güverte plakası
    let f = 0;
    for (let q = 0; q < c.center.length; q += 4) {
      const b0 = c.center[q], t = c.center[q + 1], kind = c.center[q + 2];
      if (b0 < FLOOR_MAX && (t <= FLOOR_MAX || (kind === 2 && t < BODY_HIGH)) && t > f) f = t;
    }
    if (f < GROUND_EPS) f = 0;
    floor[k] = f;
    // merkez yığınları (taban sırasına göre birleştir)
    spans.length = 0;
    const order: number[] = [];
    for (let q = 0; q < c.center.length; q += 4) order.push(q);
    order.sort((a, b) => c.center[a] - c.center[b] || c.center[a + 1] - c.center[b + 1]);
    // yığın: [taban, tepe, tepe opak ve geniş mi (1/0)]
    for (const q of order) {
      const b0 = c.center[q], t = c.center[q + 1], solid = c.center[q + 2] >= 1 && c.center[q + 3] >= STAND_AREA ? 1 : 0;
      const last = spans.length - 3;
      if (last >= 0 && b0 <= spans[last + 1] + GAP) {
        if (t > spans[last + 1] + 1e-4) { spans[last + 1] = t; spans[last + 2] = solid; }
        else if (t >= spans[last + 1] - 0.03 && solid) spans[last + 2] = 1; // aynı tepede geniş blok da var
      } else spans.push(b0, t, solid);
    }
    // zeminin tavanı: zeminin `CEIL_MIN` üstünde başlayan ilk yığın (W5 ceilY ile aynı eşik; daha alçak olanlar gövde bandında,
    // yatay çarpışmanın işi: bank oturağının altı tavan değildir)
    for (let q = 0; q < spans.length; q += 3) if (spans[q] >= f + CEIL_MIN) { floorCeil[k] = spans[q]; break; }
    // engel: gövde bandında başlayan, zeminin (engelli karoda yerin) üstüne çıkan ilk yığın
    const base = blockedTile[k] ? GROUND_EPS : f + 0.02;
    let s = -1;
    for (let q = 0; q < spans.length; q += 3) if (spans[q] < BODY_HIGH && spans[q + 1] > base) { s = q; break; }
    if (s < 0) continue;
    const T = spans[s + 1];
    top[k] = T;
    const above = s + 3 < spans.length ? spans[s + 3] : Infinity;
    ceil[k] = above;
    if (water[k] || deny.has(k) || spans[s + 2] !== 1 || T > CLIMB_TOP_MAX || above - T < HEADROOM) continue;
    // düz üst: iç karede gövde yüksekliğinde (T + tolerans … T + boy) çıkıntı yok
    let flat = true;
    for (let q = 0; q < c.inner.length; q += 2) {
      const b0 = c.inner[q], t = c.inner[q + 1];
      if (t > T + FLAT_TOL && b0 < T + HEADROOM) { flat = false; break; }
    }
    if (!flat) continue;
    const i = k % width, j = (k - i) / width;
    if (isInSacredBuffer([i - off[0], j - off[1]], built, 1)) continue;
    climb[k] = 1; climbable++;
  }
  hf = { width, depth, floor, top, ceil, floorCeil, climb, water, climbable };
  cache.set(built, hf);
  return hf;
}

function baseOff(built: Pick<Built, "modules">): Tile {
  const m = built.modules?.[0];
  return m && m.base ? [m.i0, m.j0] : [0, 0];
}

/** Asla tırmanılmayan karolar: çapa/hedef karoları ve onlara 4-komşu çalışma eşyası, oyun masası kancaları. */
function denyTiles(built: Pick<Built, "width" | "depth" | "stations" | "spots" | "ambient">): Set<number> {
  const out = new Set<number>();
  const { width, depth } = built;
  const add = (i: number, j: number) => { if (i >= 0 && j >= 0 && i < width && j < depth) out.add(j * width + i); };
  const anchor = (t: Tile) => { add(t[0], t[1]); add(t[0] + 1, t[1]); add(t[0] - 1, t[1]); add(t[0], t[1] + 1); add(t[0], t[1] - 1); };
  for (const s of built.stations) anchor(s.tile);
  for (const list of Object.values(built.spots ?? {})) for (const s of list ?? []) anchor(s.tile);
  for (const h of built.ambient ?? []) if (h.kind === "play" || h.kind === "fish") add(h.tile[0], h.tile[1]);
  return out;
}

// ------------------------------------------------------------------------------------------ ek yürünebilir alanlar (WALK-EXPLORE)
export interface WalkArea {
  id: string;
  i0: number;
  j0: number;
  w: number;
  d: number;
  /** 1 = katı (j·w + i) */
  solid: Uint8Array;
  /** zemin y'si (dünya) */
  floor: Float32Array;
  /** tavan y'si (Infinity = yok) */
  ceil: Float32Array;
}

const areas = new Map<string, WalkArea>();
let areaList: WalkArea[] = [];
/** her kayıt/silmede artar (önbellek anahtarı) */
export const walkAreaVersion = { v: 0 };

/**
 * Ek yürünebilir alan kaydı (iç mekân, kat, gizli bahçe). Aynı kimlik yeniden kaydedilirse eskisinin yerine geçer.
 * Dönüş: kaydı silen işlev. Bkz. dosya başı.
 */
export function registerWalkArea(id: string, grid: { w: number; d: number; solid: Uint8Array },
  heights: { floor: Float32Array | number; ceil?: Float32Array | number }, origin: Tile): () => void {
  const n = grid.w * grid.d;
  if (grid.solid.length !== n) throw new Error(`registerWalkArea(${id}): solid ${grid.solid.length} ≠ ${n}`);
  const fill = (v: Float32Array | number | undefined, def: number) => {
    if (v instanceof Float32Array) { if (v.length !== n) throw new Error(`registerWalkArea(${id}): yükseklik boyu`); return v; }
    return new Float32Array(n).fill(v ?? def);
  };
  const a: WalkArea = { id, i0: origin[0], j0: origin[1], w: grid.w, d: grid.d, solid: grid.solid, floor: fill(heights.floor, 0), ceil: fill(heights.ceil, Infinity) };
  areas.delete(id);
  areas.set(id, a);
  areaList = [...areas.values()];
  walkAreaVersion.v++;
  return () => { if (areas.get(id) === a) unregisterWalkArea(id); };
}

export function unregisterWalkArea(id: string): void {
  if (!areas.delete(id)) return;
  areaList = [...areas.values()];
  walkAreaVersion.v++;
}

/** Kayıtlı alanlar (salt okunur). */
export const walkAreas = (): readonly WalkArea[] => areaList;

const _hit = { area: null as WalkArea | null, k: -1 };
/** Dünya karosunu örten en son kaydedilmiş alan ve alan içi dizin; yoksa null. Dönen nesne paylaşılır. */
export function areaAt(i: number, j: number): { area: WalkArea; k: number } | null {
  for (let q = areaList.length - 1; q >= 0; q--) {
    const a = areaList[q];
    const li = i - a.i0, lj = j - a.j0;
    if (li < 0 || lj < 0 || li >= a.w || lj >= a.d) continue;
    _hit.area = a; _hit.k = lj * a.w + li;
    return _hit as { area: WalkArea; k: number };
  }
  return null;
}

// ------------------------------------------------------------------------------------------ sütun sorguları (avatar)
/** Çevre (outskirts) parseli yüksekliği: dünya karosu için zemin/üst (NaN → bilinmiyor) ve tür. Controller bağlar. */
export interface OuterHeights {
  /** −1 yüklü değil, 0 FREE, 1 SOLID */
  kind(i: number, j: number): number;
  /** FREE: zemin; SOLID: tırmanılabilirse üst yüz, değilse NaN */
  top(i: number, j: number): number;
}

/** Yükseklik bağlamı: yükseklik alanı + taban 2B engel ızgarası (yürünebilirlik) + çevre. */
export interface HeightCtx {
  hf: HeightField;
  /** 1 = 2B engelli (built.blocked) */
  blocked: Uint8Array;
  outer?: OuterHeights | null;
}

/**
 * (i, j) karosuna ayak yüksekliği `footY` ile girilebilirse durulacak yüzey; girilemezse −Infinity.
 * Yürünebilir karo: her zaman zemini (2B davranışı). Engel: tırmanılabilir ve `top ≤ footY + STEP_H` ise üst yüzü.
 * Alan karosu: katı değilse ve zemini `footY + STEP_H`'ı aşmıyorsa zemini.
 */
export function standY(hc: HeightCtx, i: number, j: number, footY: number): number {
  if (areaList.length) {
    const a = areaAt(i, j);
    if (a) {
      if (a.area.solid[a.k]) return -Infinity;
      const f = a.area.floor[a.k];
      return f <= footY + STEP_H + 1e-6 ? f : -Infinity;
    }
  }
  const { hf } = hc;
  if (i < 0 || j < 0 || i >= hf.width || j >= hf.depth) {
    const o = hc.outer;
    if (!o) return -Infinity;
    const kd = o.kind(i, j);
    if (kd < 0) return -Infinity;
    const t = o.top(i, j);
    if (kd === 0) return Number.isFinite(t) ? t : 0;
    return Number.isFinite(t) && t <= footY + STEP_H + 1e-6 ? t : -Infinity;
  }
  const k = j * hf.width + i;
  if (!hc.blocked[k]) return hf.floor[k];
  if (!hf.climb[k]) return -Infinity;
  const t = hf.top[k];
  return t <= footY + STEP_H + 1e-6 ? t : -Infinity;
}

/** Karonun, `surface` yüzeyinde duran biri için tavanı (zıplama sınırı). */
export function ceilingAt(hc: HeightCtx, i: number, j: number, surface: number): number {
  if (areaList.length) { const a = areaAt(i, j); if (a) return a.area.ceil[a.k]; }
  const { hf } = hc;
  if (i < 0 || j < 0 || i >= hf.width || j >= hf.depth) return Infinity;
  const k = j * hf.width + i;
  if (hf.climb[k] && surface >= hf.top[k] - 1e-3) return hf.ceil[k];
  return hf.floorCeil[k];
}

/** Eşya (yürünebilir karodaki bank, sandık) üstünde durulabiliyor mu: tırmanılabilir ve üst yüzü ayağa basamak mesafesinde. */
export function propClimbable(hf: HeightField, k: number, footY: number): boolean {
  return hf.climb[k] === 1 && hf.top[k] <= footY + STEP_H + 1e-6;
}

// ------------------------------------------------------------------------------------------ dikey fizik
export interface VState {
  /** ayak yüksekliği (dünya y) */
  y: number;
  /** dikey hız (birim/sn, + yukarı) */
  vy: number;
  grounded: boolean;
  /** kenardan düştükten sonra kalan zıplama süresi */
  coyote: number;
  /** erken basılmış zıplamanın kalan süresi */
  buffer: number;
}

export const createVState = (y = 0): VState => ({ y, vy: 0, grounded: true, coyote: 0, buffer: 0 });

/**
 * Bir dikey adım. `ground`: ayağın altındaki yüzey (avatarın şu anki karosu), `ceiling`: o karonun tavanı, `jump`: bu adımda
 * zıplama basıldı mı. Dönüş: olay ("jump" | "land" | null). Belirlenimci ve saf (yalnız `v`'yi değiştirir).
 */
export function stepVertical(v: VState, ground: number, ceiling: number, dt: number, jump: boolean): "jump" | "land" | null {
  let ev: "jump" | "land" | null = null;
  if (jump) v.buffer = JUMP_BUFFER_S;
  if (v.grounded) {
    if (ground > v.y) v.y = ground; // basamak çıkışı
    else if (v.y - ground > 1e-4) {
      if (v.y - ground <= STEP_H) v.y = ground; // basamak inişi: yere yapış
      else { v.grounded = false; v.vy = 0; v.coyote = COYOTE_S; }
    }
  }
  if (v.buffer > 0 && (v.grounded || v.coyote > 0) && tryJump(v, ceiling)) ev = "jump";
  if (!v.grounded) {
    // sabit ivmede tam çözüm (kare hızından bağımsız tepe noktası)
    v.y += v.vy * dt - 0.5 * GRAVITY * dt * dt;
    v.vy -= GRAVITY * dt;
    if (v.vy > 0 && v.y + HUMAN_H > ceiling) { v.y = Math.max(ground, ceiling - HUMAN_H); v.vy = 0; }
    v.coyote = Math.max(0, v.coyote - dt);
    if (v.y <= ground) {
      v.y = ground; v.vy = 0; v.grounded = true;
      // tampondaki zıplama inişte hemen çalışır
      if (ev !== "jump") ev = v.buffer > 0 && tryJump(v, ceiling) ? "jump" : "land";
    }
  }
  v.buffer = Math.max(0, v.buffer - dt);
  return ev;
}

/** Zıplamayı başlatır (tavan boşluğu yetiyorsa); başlarsa true. */
function tryJump(v: VState, ceiling: number): boolean {
  const room = ceiling - HUMAN_H - v.y;
  const vy = room >= JUMP_APEX ? JUMP_V : room > 0.02 ? Math.sqrt(2 * GRAVITY * room) : 0;
  if (vy <= 0.5) return false;
  v.vy = vy; v.grounded = false; v.coyote = 0; v.buffer = 0;
  return true;
}

/** Bir blok listesinden çevre parseli üst yüzleri (inşa blokları; `top` verilen kalıba yazar). Yığın: zeminden (h0) bitişik. */
export function stackTops(blocks: readonly Block[], i0: number, j0: number, w: number, d: number, h0: number, out: Float32Array): Float32Array {
  const stacks: number[][] = new Array(w * d);
  for (const b of blocks) {
    if (!STAND_GROUPS.has(b.g)) continue;
    const y0 = b.p[1] - b.s[1] / 2, y1 = b.p[1] + b.s[1] / 2;
    const minX = b.p[0] - b.s[0] / 2, maxX = b.p[0] + b.s[0] / 2, minZ = b.p[2] - b.s[2] / 2, maxZ = b.p[2] + b.s[2] / 2;
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
      const cx = i0 + i - HW + 0.5, cz = j0 + j - HD + 0.5;
      if (cx < minX || cx > maxX || cz < minZ || cz > maxZ) continue;
      (stacks[j * w + i] ??= []).push(y0, y1);
    }
  }
  for (let k = 0; k < w * d; k++) {
    const s = stacks[k];
    if (!s) continue;
    let t = h0, grew = true;
    while (grew) {
      grew = false;
      for (let q = 0; q < s.length; q += 2) if (s[q] <= t + GAP && s[q + 1] > t + 1e-6) { t = s[q + 1]; grew = true; }
    }
    if (t > h0) out[k] = t;
  }
  return out;
}

// ------------------------------------------------------------------------------------------ çevre (outskirts) parselleri
/** Çevrede üstüne çıkılabilen öğe türleri (expanse/biomes.ts FeatureKind): alçak kaya, sandık, kum torbası, bank, kar tümseği,
 *  şezlong. Ağaç, çit, direk, ev, tezgâh, mantar, kristal engel kalır. */
export const OUTER_CLIMB_KINDS: ReadonlySet<string> = new Set(["rock", "crate", "sandbag", "bench", "snowhill", "lounger"]);

/**
 * Çevre parselinin karo üst yüzleri (`OuterParcel.top`, dünya y): yürünebilir karoda arazi yüksekliği, tırmanılabilir öğede
 * öğenin tepesi, inşa edilmiş karoda zeminden bitişik blok yığınının tepesi; başka engelde NaN. `build`: sahiplenilmiş
 * parselin dünya çerçevesindeki inşa blokları (yoksa boş); `wi0/wj0`: parselin (0, 0) karosunun dünya karosu.
 */
export function outerParcelTops(p: { height: ArrayLike<number>; features: readonly { kind: string; li: number; lj: number; w: number; d: number; top: number }[] },
  solid: Uint8Array, pw: number, pd: number, h0: number, build: readonly Block[], wi0: number, wj0: number): Float32Array {
  const out = new Float32Array(pw * pd).fill(NaN);
  for (let k = 0; k < out.length; k++) if (!solid[k]) out[k] = p.height[k];
  for (const f of p.features) {
    if (!OUTER_CLIMB_KINDS.has(f.kind) || f.top <= 0 || f.top > CLIMB_TOP_MAX) continue;
    for (let j = f.lj; j < f.lj + f.d; j++) for (let i = f.li; i < f.li + f.w; i++) {
      if (i < 0 || j < 0 || i >= pw || j >= pd) continue;
      const k = j * pw + i;
      if (solid[k]) out[k] = h0 + f.top;
    }
  }
  if (build.length) {
    const tops = stackTops(build, wi0, wj0, pw, pd, h0, new Float32Array(pw * pd).fill(NaN));
    for (let k = 0; k < out.length; k++) {
      if (!solid[k]) continue;
      const t = tops[k];
      // inşa karosu: yığın tepesi (tavanı açık sayılır; üstüne blok konmuşsa o da yığına katılır) ya da engel
      out[k] = Number.isFinite(t) && t - h0 <= CLIMB_TOP_MAX ? t : NaN;
    }
  }
  return out;
}
