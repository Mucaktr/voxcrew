/**
 * WALK-PHYS — yürüme modunda taşıtların örnek başına "gerçek boy" çarpanı ve yol açıklığı. Saf.
 *
 * Her taşıt örneği için (sahnenin kendi `scale`'i farklı: <city> teknesi 0,26, İstanbul vapuru 0,7):
 * - `fy`: hedef ölçü (`scale.ts WALK_MOVER_TARGET`, insan boyu `WALK_HUMAN_H`'a oran) tam tutsun diye dikey çarpan.
 * - `fx` (boy) ve `fz` (en): en büyük değerler, genel bakış ölçeğinde hiç değmediği bir bloğa YENİ değme yaratmayan (yol
 * boyunca 72 örnek; yönlü kutu × sahne blokları; zemin plakaları, tel/çubuk (iki ölçüsü ≤ 0,07) ve küçük süs (hacim < 0,01)
 * hariç). Genel bakışta zaten içinden geçtiği yapı (alçak köprü) tasarımdır, yeni sayılmaz. Rıhtıma, binaya, sundurmaya
 * taşmaz.
 * - izotrop sınır : taşıt yalnız yukarı uzamaz. `fy / fx ≤ ISO_MAX` (1,3) ve
 * `fz ≤ fx ≤ fy`. Dar yolda önce en daralır (en ≥ `WIDTH_MIN` × fy; sokağa sığan şey çoğunlukla endir), boy yine izotrop
 * sınırda kalır; o da sığmazsa yükseklik ve boy birlikte iner (eski kural boyu tutup yalnız yüksekliği koruyordu: Londra
 * otobüsü fy 1,97 / fx 1,11 "kule").
 * - `path`: gidip-gelen ya da açık yolda uçlar büyüyen boyun yarısı kadar kısaltılır (iskeleye/garaja burun aynı yerde durur).
 * - Çift denetimi: iki taşıtın büyümüş gövdeleri (genel bakışta değmezken) değerse önce hedef oranında payı çok olan küçülür
 * (izotrop sınır korunarak); ikisi de aralık alt sınırına indiyse ikisi birlikte.
 * Sonuçlar `built` başına önbellekte (WeakMap); WalkRig yürüme moduna girerken `bindMoverWorld(built)` çağırır, SceneFx kare
 * başına `moverFitOf(m)` okur (yoksa çarpan 1). walk_check WALK-SCALE-002 aynı işlevi kullanır.
*/
import { SHAPES, samplePath, type PathSampler } from "../props/movers";
import type { Block, Built, Mover } from "../scenes";
import { shapeDim, WALK_HUMAN_H, WALK_MOVER_TARGET } from "./scale";

export interface MoverFit {
  /** boy (yerel x), yükseklik, en (yerel z) çarpanları — sahne ölçeğinin üstüne */
  fx: number;
  fy: number;
  fz: number;
  /** istenen yükseklik çarpanı (fy < want → dikey açıklık yetmedi) */
  want: number;
  /** yürüme modu yolu (uçları kısaltılmış; değişmediyse özgün yol) */
  mover: Mover;
  /** yürüme ölçeğinde insan boyuna oranlar: hedef ölçü, boy, yükseklik (yerden tepe) */
  ratio: number;
  lengthRatio: number;
  /** genel bakışta değmediği halde büyümüş hâlde blokla kesişen örnek sayısı (0 olmalı) */
  newHits: number;
  /** yürüme yolunun köşeleri pahlandı mı; uçan taşıtın yürüme yolu kaydırması [x, y, z] (çift değmesi; y yalnız havada)*/
  round: boolean;
  shift: readonly [number, number, number];
}

const SAMPLES = 72;
const FLOOR_Y = 0.08;
const VISIBLE = new Set(["solid", "glass", "glow"]);
const BIG_CELLS = 400;
/** yükseklik çarpanı boy çarpanının en çok bu katı (taşıt kule gibi uzamasın): fy / fx ≤ ISO_MAX*/
export const ISO_MAX = 1.3;
/** boy çarpanı yükseklik çarpanının en az bu katı (= 1 / ISO_MAX) */
export const ASPECT_MIN = 1 / ISO_MAX;
/** en çarpanı yükseklik çarpanının en az bu katı (dar sokakta en daralabilir ama kâğıt gibi incelmez) */
export const WIDTH_MIN = 0.55;
/** çift değmesinde yolu kayarak ayrılabilen uçan taşıtlar; adım sayısı, en çok yükselme ve yatay itme (birim); LIFT_FLOOR altındaki yol noktası (kalkış sahası) yükselmez*/
const FLYERS: ReadonlySet<string> = new Set(["balloon", "airship"]);
const SHIFT_STEPS = 8, LIFT_MAX = 4, PUSH_MAX = 2, LIFT_FLOOR = 2;
/** çarpışmada yok sayılan ince/küçük bloklar: iki ölçüsü ≤ WIRE (tel, katener, korkuluk çubuğu) ya da hacmi < TINY (tabela ışığı) */
const WIRE = 0.07, TINY = 0.01;
const minor = (b: Block) => b.s[0] * b.s[1] * b.s[2] < TINY || (b.s[0] <= WIRE ? 1 : 0) + (b.s[1] <= WIRE ? 1 : 0) + (b.s[2] <= WIRE ? 1 : 0) >= 2;

interface BlockIndex { cells: Map<number, number[]>; big: number[]; blocks: Block[] }
const ckey = (x: number, z: number) => (x + 4096) * 8192 + (z + 4096);

function indexBlocks(list: readonly Block[]): BlockIndex {
  const blocks = list.filter((b) => VISIBLE.has(b.g) && b.p[1] + b.s[1] / 2 > FLOOR_Y && !minor(b));
  const cells = new Map<number, number[]>(), big: number[] = [];
  blocks.forEach((b, k) => {
    const x0 = Math.floor(b.p[0] - b.s[0] / 2), x1 = Math.floor(b.p[0] + b.s[0] / 2), z0 = Math.floor(b.p[2] - b.s[2] / 2), z1 = Math.floor(b.p[2] + b.s[2] / 2);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > BIG_CELLS) { big.push(k); return; }
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const key = ckey(x, z), arr = cells.get(key);
      if (arr) arr.push(k); else cells.set(key, [k]);
    }
  });
  return { cells, big, blocks };
}

interface Box { L: number; W: number; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
const boxCache = new Map<string, Box>();
function shapeBox(shape: string): Box {
  let b = boxCache.get(shape);
  if (b) return b;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of SHAPES[shape as keyof typeof SHAPES] ?? []) {
    x0 = Math.min(x0, p[0] - p[3] / 2); x1 = Math.max(x1, p[0] + p[3] / 2);
    y0 = Math.min(y0, p[1] - p[4] / 2); y1 = Math.max(y1, p[1] + p[4] / 2);
    z0 = Math.min(z0, p[2] - p[5] / 2); z1 = Math.max(z1, p[2] + p[5] / 2);
  }
  b = { L: x1 - x0, W: z1 - z0, x0, x1, y0, y1, z0, z1 };
  boxCache.set(shape, b);
  return b;
}

/** Yönlü taşıt kutusu (dünya): merkez, yarı boy/en, yön, y aralığı. */
interface Obb { cx: number; cz: number; hx: number; hz: number; cs: number; sn: number; ya: number; yb: number }
const _o = { x: 0, y: 0, z: 0, yaw: 0 };
function obbAt(sp: PathSampler, t: number, bx: Box, sx: number, sy: number, sz: number, out: Obb): Obb {
  sp.at(t, _o);
  const cs = Math.cos(_o.yaw), sn = Math.sin(_o.yaw);
  const lx = ((bx.x0 + bx.x1) / 2) * sx, lz = ((bx.z0 + bx.z1) / 2) * sz;
  out.cx = _o.x + cs * lx + sn * lz; out.cz = _o.z - sn * lx + cs * lz;
  out.hx = (bx.L / 2) * sx; out.hz = (bx.W / 2) * sz; out.cs = cs; out.sn = sn;
  out.ya = Math.max(FLOOR_Y, _o.y + bx.y0 * sy); out.yb = _o.y + bx.y1 * sy;
  return out;
}

const SLOP = 0.05;
function hitsBlock(o: Obb, b: Block): boolean {
  const qy0 = b.p[1] - b.s[1] / 2, qy1 = b.p[1] + b.s[1] / 2;
  if (qy1 <= o.ya + SLOP || qy0 >= o.yb - SLOP) return false;
  const qx = b.p[0], qz = b.p[2], qhx = b.s[0] / 2, qhz = b.s[2] / 2;
  const ex = Math.abs(o.cs) * o.hx + Math.abs(o.sn) * o.hz, ez = Math.abs(o.sn) * o.hx + Math.abs(o.cs) * o.hz;
  if (Math.abs(qx - o.cx) >= ex + qhx - SLOP || Math.abs(qz - o.cz) >= ez + qhz - SLOP) return false;
  // ayırıcı eksen: taşıtın kendi eksenleri (kutunun eksenleri yukarıda)
  const d1 = Math.abs((qx - o.cx) * o.cs - (qz - o.cz) * o.sn), r1 = qhx * Math.abs(o.cs) + qhz * Math.abs(o.sn);
  if (d1 >= o.hx + r1 - SLOP) return false;
  const d2 = Math.abs((qx - o.cx) * o.sn + (qz - o.cz) * o.cs), r2 = qhx * Math.abs(o.sn) + qhz * Math.abs(o.cs);
  return d2 < o.hz + r2 - SLOP;
}

/** Kutunun değdiği bloklar: `skip` kümesindekiler sayılmaz; `out` verilirse hepsi eklenir. Dönüş: sayılan ilk blok var mı. */
function anyHit(ix: BlockIndex, o: Obb, seen: Set<number>, skip: ReadonlySet<number> | null, out?: Set<number>): boolean {
  const ex = Math.abs(o.cs) * o.hx + Math.abs(o.sn) * o.hz, ez = Math.abs(o.sn) * o.hx + Math.abs(o.cs) * o.hz;
  let hit = false;
  const test = (k: number) => {
    if (skip?.has(k) || !hitsBlock(o, ix.blocks[k])) return false;
    if (out) { out.add(k); hit = true; return false; }
    return true;
  };
  for (const k of ix.big) if (test(k)) return true;
  seen.clear();
  for (let z = Math.floor(o.cz - ez); z <= Math.floor(o.cz + ez); z++) for (let x = Math.floor(o.cx - ex); x <= Math.floor(o.cx + ex); x++) {
    const arr = ix.cells.get(ckey(x, z));
    if (!arr) continue;
    for (const k of arr) { if (seen.has(k)) continue; seen.add(k); if (test(k)) return true; }
  }
  return hit;
}

/** Gidip-gelen / açık yolda uçları `trim` kadar içe çeker (yol en az 0,5 kalır). */
export function trimPath(m: Mover, trim: number): Mover {
  const loop = (m.mode ?? "loop") === "loop" && m.path.length > 2;
  if (loop || trim <= 1e-3 || m.path.length < 2) return m;
  const p = m.path.map((q) => [q[0], q[1], q[2]] as [number, number, number]);
  const cut = (a: number, b: number) => {
    const dx = p[b][0] - p[a][0], dy = p[b][1] - p[a][1], dz = p[b][2] - p[a][2], len = Math.hypot(dx, dy, dz);
    const t = Math.min(trim, Math.max(0, len / 2 - 0.25)) / (len || 1);
    p[a] = [p[a][0] + dx * t, p[a][1] + dy * t, p[a][2] + dz * t];
  };
  cut(0, 1);
  cut(p.length - 1, p.length - 2);
  return { ...m, path: p };
}

/**
 * Yürüme çarpanları: `fx` boy, `fy` yükseklik, `fz` en. `round`: yolun köşeleri büyüme payı kadar pahlanır (uzayan gövde
 * köşede dış yapıya taşmasın; yalnız düz yolda sığmayan taşıtta denenir). `shift`: uçan taşıtın yürüme yolu bu kadar kayar
 * (çift değmesinde küçülmek yerine; yalnız balon/zeplin; y yalnız havadaki noktalara).
*/
type Shift = readonly [number, number, number];
const NO_SHIFT: Shift = [0, 0, 0];
interface Dims { fx: number; fy: number; fz: number; round?: boolean; shift?: Shift }
const BISECT = 7;

/** İç köşeleri (döngüde hepsi) `c` kadar pahlar: köşe noktası, gelen ve giden kenarda `c` uzaklıktaki iki noktayla değişir. */
export function roundCorners(m: Mover, c: number): Mover {
  const loop = (m.mode ?? "loop") === "loop" && m.path.length > 2;
  const p = m.path, n = p.length;
  if (c <= 1e-3 || n < 3) return m;
  const out: [number, number, number][] = [];
  const along = (a: readonly number[], b: readonly number[], d: number): [number, number, number] => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
    return [a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len, a[2] + ((b[2] - a[2]) * d) / len];
  };
  for (let k = 0; k < n; k++) {
    const q = p[k];
    if (!loop && (k === 0 || k === n - 1)) { out.push([q[0], q[1], q[2]]); continue; }
    const a = p[(k - 1 + n) % n], b = p[(k + 1) % n];
    const ax = q[0] - a[0], az = q[2] - a[2], bx = b[0] - q[0], bz = b[2] - q[2];
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    const turn = la && lb ? Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz)) : 0;
    const d = Math.min(c, la / 2 - 0.05, lb / 2 - 0.05);
    if (turn < 0.35 || d <= 1e-3) { out.push([q[0], q[1], q[2]]); continue; }
    out.push(along(q, a, d), along(q, b, d));
  }
  return { ...m, path: out };
}

/** Yürüme yolu: uçlar büyüme payı (+ `extraTrim`) kadar kısalır; `round` ise köşeler pahlanır; `shift` kadar kayar. */
function walkMover(m: Mover, d: Dims, extraTrim = 0): Mover {
  const grow = ((d.fx - 1) * shapeBox(m.shape).L * (m.scale ?? 1)) / 2;
  let w = trimPath(m, grow + extraTrim);
  if (d.round) w = roundCorners(w, grow);
  const [sx, sy, sz] = d.shift ?? NO_SHIFT;
  // yükselme: kalkış/iniş noktası (yerde, y < LIFT_FLOOR) yerinde kalır, yalnız havadaki rota yükselir
  if (sx || sy || sz) w = { ...w, path: w.path.map((q) => [q[0] + sx, q[1] < LIFT_FLOOR ? q[1] : q[1] + sy, q[2] + sz] as [number, number, number]) };
  return w;
}

/** Yürüme yolunda yeni değilen örnek sayısı. */
function newHitsFor(ix: BlockIndex, m: Mover, base: ReadonlySet<number>, d: Dims, extraTrim = 0, out?: Set<number>): number {
  const bx = shapeBox(m.shape), sc = m.scale ?? 1;
  const sp = samplePath(walkMover(m, d, extraTrim));
  const o: Obb = { cx: 0, cz: 0, hx: 0, hz: 0, cs: 1, sn: 0, ya: 0, yb: 0 }, seen = new Set<number>();
  let n = 0;
  for (let s = 0; s < SAMPLES; s++) {
    if (anyHit(ix, obbAt(sp, (s / SAMPLES) * Math.max(1, m.period), bx, sc * d.fx, sc * d.fy, sc * d.fz, o), seen, base, out)) n++;
  }
  return n;
}

/** Genel bakış ölçeğinde yol boyunca değilen bloklar (bunlara değmek "yeni" sayılmaz: sahnenin tasarımı). */
function baseHits(ix: BlockIndex, m: Mover): Set<number> {
  const bx = shapeBox(m.shape), sc = m.scale ?? 1, sp = samplePath(m);
  const o: Obb = { cx: 0, cz: 0, hx: 0, hz: 0, cs: 1, sn: 0, ya: 0, yb: 0 }, seen = new Set<number>();
  const out = new Set<number>();
  for (let s = 0; s < SAMPLES * 2; s++) anyHit(ix, obbAt(sp, (s / (SAMPLES * 2)) * Math.max(1, m.period), bx, sc, sc, sc, o), seen, null, out);
  return out;
}

/** Hedef yükseklik çarpanı (örnek ölçeğiyle); hedefi olmayan şekil null. */
export function targetFactor(m: Mover): number | null {
  const t = WALK_MOVER_TARGET[m.shape];
  if (!t) return null;
  const dim = shapeDim(SHAPES[m.shape] ?? [], t.dim);
  return dim > 0 ? (t.ratio * WALK_HUMAN_H) / (dim * (m.scale ?? 1)) : null;
}

/**
 * yükseklik `fy` sabitken izotrop sınırda (fx ≥ fy / ISO_MAX, fz ≤ fx ≤ fy) yeni değme yaratmayan en büyük boy ve en;
 * sınırın kendisi de sığmıyorsa null (yükseklik inmeli). Sıra: önce boy = en birlikte büyür; boy alt sınırda bile değiyorsa
 * en daralır (≥ WIDTH_MIN × fy); sonra boy, bulunan enle tavana dek uzar.
*/
function fitAt(ix: BlockIndex, m: Mover, base: ReadonlySet<number>, fy: number, round: boolean): Dims | null {
  const clear = (fx: number, fz: number) => newHitsFor(ix, m, base, { fx, fy, fz, round }) === 0;
  if (clear(fy, fy)) return { fx: fy, fy, fz: fy, round };
  const lo = Math.max(1, fy * ASPECT_MIN);
  let fz: number;
  if (clear(lo, lo)) {
    let a = lo, b = fy;
    for (let it = 0; it < BISECT; it++) { const mid = (a + b) / 2; if (clear(mid, mid)) a = mid; else b = mid; }
    fz = a;
  } else {
    const zlo = Math.min(lo, Math.max(1, fy * WIDTH_MIN));
    if (!clear(lo, zlo)) return null;
    let a = zlo, b = lo;
    for (let it = 0; it < BISECT; it++) { const mid = (a + b) / 2; if (clear(lo, mid)) a = mid; else b = mid; }
    fz = a;
  }
  let p = Math.max(lo, fz), q = fy;
  for (let it = 0; it < BISECT; it++) { const mid = (p + q) / 2; if (clear(mid, fz)) p = mid; else q = mid; }
  return { fx: p, fy, fz: Math.min(fz, p), round };
}

/** Hedef yükseklikte sığmıyorsa yükseklik (ve onunla boy) iner: [1, want] ikili arama. */
function fitDown(ix: BlockIndex, m: Mover, base: ReadonlySet<number>, want: number, round: boolean): Dims {
  const top = fitAt(ix, m, base, want, round);
  if (top) return top;
  // sığma sınaması (fitAt null değil ⇔ en dar izotrop gövde sığar): ikili aramada tek sınama, sonra bir kez tam uyum
  const fits = (fy: number) => {
    const fx = Math.max(1, fy * ASPECT_MIN), fz = Math.min(fx, Math.max(1, fy * WIDTH_MIN));
    return newHitsFor(ix, m, base, { fx, fy, fz, round }) === 0;
  };
  let lo = 1, hi = want;
  for (let it = 0; it < BISECT; it++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  return fitAt(ix, m, base, lo, round) ?? { fx: 1, fy: 1, fz: 1 };
}

function fitOne(ix: BlockIndex, m: Mover): MoverFit | null {
  const want = targetFactor(m);
  if (want === null) return null;
  const base = baseHits(ix, m);
  // küçülen (hedef < sahne ölçeği) taşıt yeni değme yaratmaz
  if (want <= 1) return finish(ix, m, base, { fx: want, fy: want, fz: want }, want);
  let d = fitDown(ix, m, base, want, false);
  // düz yolda tam boya ulaşmayan, köşeli yolu olan taşıt: köşe pahıyla yeniden dene, daha büyüğünü al
  if (m.path.length > 2 && (d.fy < want - 1e-6 || d.fx < d.fy - 1e-6)) {
    const r = fitDown(ix, m, base, want, true);
    if (r.fy > d.fy + 1e-6 || (Math.abs(r.fy - d.fy) <= 1e-6 && r.fx > d.fx + 1e-6)) d = r;
  }
  return finish(ix, m, base, d, want);
}

function finish(ix: BlockIndex, m: Mover, base: ReadonlySet<number>, d: Dims, want: number): MoverFit {
  const t = WALK_MOVER_TARGET[m.shape]!, bx = shapeBox(m.shape), sc = m.scale ?? 1;
  const dim = shapeDim(SHAPES[m.shape] ?? [], t.dim);
  const { fx, fy, fz } = d;
  const dimF = t.dim === "length" ? fx : t.dim === "width" ? fz : fy;
  return {
    fx, fy, fz, want, mover: walkMover(m, d), round: !!d.round, shift: d.shift ?? NO_SHIFT,
    ratio: (dim * sc * dimF) / WALK_HUMAN_H, lengthRatio: (bx.L * sc * fx) / WALK_HUMAN_H,
    newHits: newHitsFor(ix, m, base, d),
  };
}

/** İki taşıtın büyümüş gövdeleri (genel bakışta değmeyen anlarda) değiyor mu: değen örnek sayısı. */
export function pairOverlap(a: Mover, fa: MoverFit, b: Mover, fb: MoverFit, samples = 240): number {
  const ba = shapeBox(a.shape), bb = shapeBox(b.shape), sa = a.scale ?? 1, sb = b.scale ?? 1;
  // ön süzgeç: yürüme yollarının (gövde yarıçapıyla şişirilmiş) sınır kutuları kesişmiyorsa hiçbir anda değmezler
  const ra = reach(fa.mover, ba, sa, fa), rb = reach(fb.mover, bb, sb, fb);
  if (ra[0] > rb[1] || rb[0] > ra[1] || ra[2] > rb[3] || rb[2] > ra[3] || ra[4] > rb[5] || rb[4] > ra[5]) return 0;
  const pa = samplePath(a), pb = samplePath(b), wa = samplePath(fa.mover), wb = samplePath(fb.mover);
  const horizon = 2 * Math.max(a.period, b.period, 1);
  const o1: Obb = { cx: 0, cz: 0, hx: 0, hz: 0, cs: 1, sn: 0, ya: 0, yb: 0 }, o2 = { ...o1 };
  let n = 0;
  for (let s = 0; s < samples; s++) {
    const t = (s / samples) * horizon;
    const before = obbOverlap(obbAt(pa, t, ba, sa, sa, sa, o1), obbAt(pb, t, bb, sb, sb, sb, o2));
    if (before) continue;
    if (obbOverlap(obbAt(wa, t, ba, sa * fa.fx, sa * fa.fy, sa * fa.fz, o1), obbAt(wb, t, bb, sb * fb.fx, sb * fb.fy, sb * fb.fz, o2))) n++;
  }
  return n;
}

/** Yolun gövdeyle şişirilmiş sınır kutusu [x0, x1, z0, z1, y0, y1] (yatayda gövde köşegeni yarıçapı; yükseklik kutusu). */
function reach(w: Mover, bx: Box, sc: number, f: Pick<MoverFit, "fx" | "fy" | "fz">): [number, number, number, number, number, number] {
  const r = 0.5 * Math.hypot(Math.max(Math.abs(bx.x0), Math.abs(bx.x1)) * 2 * sc * f.fx, Math.max(Math.abs(bx.z0), Math.abs(bx.z1)) * 2 * sc * f.fz);
  const out: [number, number, number, number, number, number] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (const q of w.path) {
    out[0] = Math.min(out[0], q[0] - r); out[1] = Math.max(out[1], q[0] + r);
    out[2] = Math.min(out[2], q[2] - r); out[3] = Math.max(out[3], q[2] + r);
    out[4] = Math.min(out[4], q[1] + Math.min(0, bx.y0 * sc * f.fy)); out[5] = Math.max(out[5], q[1] + bx.y1 * sc * f.fy);
  }
  return out;
}

function obbOverlap(a: Obb, b: Obb): boolean {
  if (a.yb <= b.ya || b.yb <= a.ya) return false;
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  // taşıt eksenleri: (cs, −sn) boy, (sn, cs) en
  for (const [ux, uz] of [[a.cs, -a.sn], [a.sn, a.cs], [b.cs, -b.sn], [b.sn, b.cs]]) {
    const ra = a.hx * Math.abs(a.cs * ux - a.sn * uz) + a.hz * Math.abs(a.sn * ux + a.cs * uz);
    const rb = b.hx * Math.abs(b.cs * ux - b.sn * uz) + b.hz * Math.abs(b.sn * ux + b.cs * uz);
    if (Math.abs(dx * ux + dz * uz) >= ra + rb - SLOP) return false;
  }
  return true;
}

const lengthDim = (m: Mover) => { const d = WALK_MOVER_TARGET[m.shape]?.dim; return d === "length" || d === "width"; };
const fitCache = new WeakMap<object, Map<Mover, MoverFit>>();
let current: Map<Mover, MoverFit> | null = null;

/** Dünyadaki bütün taşıtların yürüme uyumu (built başına bir kez). */
export function moverFits(built: Pick<Built, "blocks" | "backdrop" | "movers">): Map<Mover, MoverFit> {
  let fits = fitCache.get(built);
  if (fits) return fits;
  fits = new Map();
  const movers = built.movers ?? [];
  if (movers.some((m) => WALK_MOVER_TARGET[m.shape])) {
    const ix = indexBlocks([...built.blocks, ...(built.backdrop ?? [])]);
    const bases = new Map<Mover, Set<number>>();
    for (const m of movers) {
      const f = fitOne(ix, m);
      if (f) fits.set(m, f);
    }
    // çift denetimi: büyümüş gövdeler (genel bakışta değmeyen anlarda) değiyorsa küçülür
    // (bir çiftin küçülmesi başka bir çifti etkileyebilir: değme kalmayana dek en çok 4 tur)
    for (let pass = 0, dirty = true; pass < 4 && dirty; pass++) {
    dirty = false;
    for (let a = 0; a < movers.length; a++) for (let b = a + 1; b < movers.length; b++) {
      const ma = movers[a], mb = movers[b];
      let fa = fits.get(ma), fb = fits.get(mb);
      if (!fa || !fb || pairOverlap(ma, fa, mb, fb) === 0) continue;
      dirty = true;
      const refit = (m: Mover, f: MoverFit, d: Dims) => {
        let base = bases.get(m);
        if (!base) { base = baseHits(ix, m); bases.set(m, base); }
        const fx = Math.min(d.fx, d.fy);
        return finish(ix, m, base, { fx, fy: d.fy, fz: Math.min(d.fz, fx), round: f.round, shift: d.shift ?? f.shift }, f.want);
      };
      // uçan iki taşıt (balon, zeplin): küçülmeden önce birinin yürüme yolu kayar — havadaki rotası yükselir (≤ LIFT_MAX) ya da
      // yatayda sekiz yönden birine itilir (≤ PUSH_MAX). En küçük kayma seçilir; kayan taşıt yeni blok değmesi yaratmaz ve
      // dünyadaki hiçbir taşıta değmez (yalnız bu çifte bakılsa üçlü kümede biri ötekine itilip döner).
      if (FLYERS.has(ma.shape) && FLYERS.has(mb.shape)) {
        const clearAll = (mu: Mover, t: MoverFit) => movers.every((o) => { const fo = fits.get(o); return o === mu || !fo || pairOverlap(mu, t, o, fo) === 0; });
        const DIRS: Shift[] = [[0, 1, 0], ...Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4), 0, Math.sin((i * Math.PI) / 4)] as Shift)];
        let found: [Mover, MoverFit] | null = null;
        for (let k = 1; k <= SHIFT_STEPS && !found; k++) {
          for (const mu of [ma, mb]) {
            const f0 = fits.get(mu)!;
            for (const dir of DIRS) {
              const step = dir[1] ? (k * LIFT_MAX) / SHIFT_STEPS : (k * PUSH_MAX) / SHIFT_STEPS;
              const d: Dims = { fx: f0.fx, fy: f0.fy, fz: f0.fz, round: f0.round, shift: [f0.shift[0] + dir[0] * step, f0.shift[1] + dir[1] * step, f0.shift[2] + dir[2] * step] };
              // ucuzdan pahalıya: önce bu çift, sonra bütün taşıtlar, en son blok değmesi
              const cand: MoverFit = { ...f0, shift: d.shift!, mover: walkMover(mu, d) };
              if (pairOverlap(ma, mu === ma ? cand : fa, mb, mu === mb ? cand : fb) > 0 || !clearAll(mu, cand)) continue;
              const t = refit(mu, f0, d);
              if (!t.newHits) { found = [mu, t]; break; }
            }
            if (found) break;
          }
        }
        if (found) {
          fits.set(found[0], found[1]);
          continue;
        }
      }
      // önce hedef ölçüsü boy/en olanların (zeplin, uçak, dron) yüksekliği sahne ölçeğine döner: oranları değişmez
      if (pairOverlap(ma, fa, mb, fb) > 0) {
        if (lengthDim(ma) && fa.fy > fa.fx) { fa = refit(ma, fa, { fx: fa.fx, fy: Math.max(1, fa.fx), fz: fa.fz }); fits.set(ma, fa); }
        if (lengthDim(mb) && fb.fy > fb.fx) { fb = refit(mb, fb, { fx: fb.fx, fy: Math.max(1, fb.fx), fz: fb.fz }); fits.set(mb, fb); }
      }
      // sonra küçülme (en çok 16 adım, ×0,7): boy/en küçülür, yükseklik yalnız izotrop sınır (fy ≤ ISO_MAX × fx) gerektirince
      // iner; boy/en 1'e indiyse yükseklik de. Hedef aralığında payı (oran / alt sınır) belirgin büyük olan önce küçülür,
      // böylece ikisi birden alt sınırın altına itilmez; paylar yakınsa ikisi birlikte.
      const step = (f: MoverFit): Dims => {
        const fx = Math.max(1, 1 + (f.fx - 1) * 0.7), fz = Math.max(1, 1 + (f.fz - 1) * 0.7);
        const fy = f.fx - 1 < 1e-3 ? Math.max(1, 1 + (f.fy - 1) * 0.7) : Math.max(1, Math.min(f.fy, fx * ISO_MAX));
        return { fx, fy, fz };
      };
      const room = (m: Mover, f: MoverFit) => f.ratio / (WALK_MOVER_TARGET[m.shape]?.min || 1);
      for (let it = 0; it < 16 && pairOverlap(ma, fa, mb, fb) > 0; it++) {
        const ra = room(ma, fa), rb = room(mb, fb);
        const sa = ra >= rb / 1.05 || (fb.fx - 1 < 1e-3 && fb.fy - 1 < 1e-3), sb = rb >= ra / 1.05 || (fa.fx - 1 < 1e-3 && fa.fy - 1 < 1e-3);
        if (sa) { fa = refit(ma, fa, step(fa)); fits.set(ma, fa); }
        if (sb) { fb = refit(mb, fb, step(fb)); fits.set(mb, fb); }
      }
    }
    }
  }
  fitCache.set(built, fits);
  return fits;
}

/** Tanı (walk_check, geliştirme): verilen çarpanlarla yeni değilen bloklar. */
export function probeFit(built: Pick<Built, "blocks" | "backdrop">, m: Mover, fh: number, fy: number, extraTrim = 0, fz = fh): Block[] {
  const ix = indexBlocks([...built.blocks, ...(built.backdrop ?? [])]);
  const out = new Set<number>();
  newHitsFor(ix, m, baseHits(ix, m), { fx: fh, fy, fz }, extraTrim, out);
  return [...out].map((k) => ix.blocks[k]);
}

/** WalkRig: yürüme modundaki dünyayı bağlar (SceneFx `moverFitOf` buradan okur). */
export function bindMoverWorld(built: Pick<Built, "blocks" | "backdrop" | "movers"> | null): void {
  current = built ? moverFits(built) : null;
}

/** bağlı dünyanın taşıtları ve uyumları (binilebilir teleferik kabini `transit/cableRide.ts` kabinin çizilen yolunu izler).*/
export const moverFitList = (): [Mover, MoverFit][] => (current ? [...current] : []);

/** Taşıtın yürüme uyumu (bağlı dünya yoksa ya da hedefi yoksa null). */
export const moverFitOf = (m: Mover): MoverFit | null => current?.get(m) ?? null;

const walkSamplers = new WeakMap<MoverFit, PathSampler>();
/** Yürüme yolunun örnekleyicisi (uyum başına bir kez). */
export function walkSampler(f: MoverFit): PathSampler {
  let s = walkSamplers.get(f);
  if (!s) { s = samplePath(f.mover); walkSamplers.set(f, s); }
  return s;
}
