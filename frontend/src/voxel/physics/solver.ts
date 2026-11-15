/**
 * PHYS — sabit adımlı çözücü (varsayılan 30 Hz, çizimde ara değer). Saf ve belirlenimci: rastgelelik yok, sıra beden ekleme
 * sırasıdır; aynı girdi → aynı çıktı.
 *
 * Adım: (1) uzamsal karma (karo ızgarası, bağlı liste), (2) yürüyenlere istenen hız (avoid.ts), (3) ivme sınırlı tümleme,
 * (4) `iterations` tur konum düzeltmesi: beden–beden (statik/kinematik sonsuz kütle; iki yürüyen yarı yarıya) ve beden–statik
 * dünya (izinli hedef ve çıkış karosu muaf), (5) SERT KURAL: düzeltmeden sonra hâlâ `eps`'ten fazla batan ve adım başındakinden
 * kötüleşen yürüyen beden adım başı konumuna geri alınır (çözüm her zaman geçerli kalır), (6) varış, kuyruk ve takılma sayaçları;
 * kuyrukta `queueLimit` sn bekleyen `queueOut` alır (çağıran başka hedef/nazik kaçış seçer: physics/queue.ts).
 */
import { AGENT_R, KINEMATIC, OFF, STATIC, WALK, type Body } from "./bodies";
import { desiredVelocity, goalIndex } from "./avoid";
import { findPath, type Tile } from "../scenes";
import { centerX, centerZ, staticPush, tileIndex, tileX, tileZ, type StaticWorld } from "./world";

export interface PhysicsOpts {
  /** sabit adım frekansı (Hz) */
  hz?: number;
  /** kare başına en çok adım (düşük kare hızında gerçek zaman ≈ maxSteps / hz sn'ye kadar) */
  maxSteps?: number;
  /** konum düzeltme turu */
  iterations?: number;
  /** izin verilen en büyük batma (birim) */
  eps?: number;
  /** ivme (birim/sn²) */
  accel?: number;
  /** takılma eşiği (sn) */
  stuckAfter?: number;
}

export interface Physics {
  sw: StaticWorld;
  bodies: Body[];
  h: number;
  acc: number;
  t: number;
  maxSteps: number;
  iterations: number;
  eps: number;
  accel: number;
  stuckAfter: number;
  /** karma: hücre başı (karo dizini) → ilk beden, beden → sonraki; dokunulan hücreler */
  head: Int32Array;
  next: Int32Array;
  touched: number[];
  /** ölçüm (timeouts: kuyruk zaman aşımı sayısı) */
  stats: { steps: number; reverts: number; maxPen: number; timeouts: number };
}

/** Beden–beden temas beyaz listesinde izin verilen en küçük merkez uzaklığı */
export const CONTACT_MIN = 0.3;

export function createPhysics(sw: StaticWorld, o: PhysicsOpts = {}): Physics {
  return {
    sw, bodies: [], h: 1 / (o.hz ?? 30), acc: 0, t: 0, maxSteps: o.maxSteps ?? 8, iterations: o.iterations ?? 3, eps: o.eps ?? 0.02,
    accel: o.accel ?? 10, stuckAfter: o.stuckAfter ?? 1.6,
    head: new Int32Array(sw.width * sw.depth).fill(-1), next: new Int32Array(64), touched: [], stats: { steps: 0, reverts: 0, maxPen: 0, timeouts: 0 },
  };
}

export function addBody(ph: Physics, b: Body): Body {
  ph.bodies.push(b);
  if (ph.next.length < ph.bodies.length) { const n = new Int32Array(ph.bodies.length * 2); n.set(ph.next); ph.next = n; }
  return b;
}

export function removeBody(ph: Physics, b: Body) {
  const i = ph.bodies.indexOf(b);
  if (i >= 0) ph.bodies.splice(i, 1);
}

/** Kare süresini tüketir; 0..1 ara değer katsayısı döner (çizim: önceki + (şimdiki − önceki) × α). */
export function advance(ph: Physics, dt: number): number {
  ph.acc += Math.max(0, dt);
  let n = 0;
  while (ph.acc >= ph.h && n < ph.maxSteps) { step(ph); ph.acc -= ph.h; n++; }
  if (n === ph.maxSteps && ph.acc >= ph.h) ph.acc = 0; // çok yavaş kare: geri kalanı bırak (sarmal ölüm yok)
  return Math.min(1, ph.acc / ph.h);
}

// ------------------------------------------------------------------------------------------ karma
function cellOf(ph: Physics, x: number, z: number): number {
  const { width, depth } = ph.sw;
  let i = tileX(x), j = tileZ(z);
  if (i < 0) i = 0; else if (i >= width) i = width - 1;
  if (j < 0) j = 0; else if (j >= depth) j = depth - 1;
  return j * width + i;
}

function rebuildHash(ph: Physics) {
  for (const c of ph.touched) ph.head[c] = -1;
  ph.touched.length = 0;
  const bs = ph.bodies;
  for (let k = 0; k < bs.length; k++) {
    const b = bs[k];
    b.ix = k;
    if (b.mode === OFF) continue;
    const c = cellOf(ph, b.x, b.z);
    if (ph.head[c] === -1) ph.touched.push(c);
    ph.next[k] = ph.head[c];
    ph.head[c] = k;
  }
}

const NEAR: Body[] = [];
/** (x, z) çevresindeki `rad` yarıçaplı karolardaki bedenler → NEAR (paylaşılan dizi); sayı döner. */
function gather(ph: Physics, x: number, z: number, rad: number): number {
  const { width, depth } = ph.sw;
  const i0 = Math.max(0, tileX(x - rad)), i1 = Math.min(width - 1, tileX(x + rad));
  const j0 = Math.max(0, tileZ(z - rad)), j1 = Math.min(depth - 1, tileZ(z + rad));
  let n = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    for (let k = ph.head[j * width + i]; k !== -1; k = ph.next[k]) NEAR[n++] = ph.bodies[k];
  }
  // ızgara dışındaki bedenler kenar hücresine düşer; (x, z) içerideyse onlar zaten kenar hücrelerinde
  return n;
}

/** Komşu sorgusu (dış kullanım: hayvanlar, testler). Karma son adımdan kalır. */
export function neighbors(ph: Physics, x: number, z: number, rad: number, out: Body[]): number {
  const n = gather(ph, x, z, rad);
  for (let k = 0; k < n; k++) out[k] = NEAR[k];
  out.length = n;
  return n;
}

// ------------------------------------------------------------------------------------------ batma
const minDist = (ph: Physics, a: Body, b: Body) => (ph.t < a.contactUntil && ph.t < b.contactUntil ? Math.min(CONTACT_MIN, a.r + b.r) : a.r + b.r);

/** Bedenin en büyük batması (statik dünya + diğer bedenler). */
export function penetration(ph: Physics, b: Body): number {
  let pen = b.mode === WALK ? staticPush(ph.sw, b.x, b.z, b.r, b.goal, b.leave).pen : 0;
  const n = gather(ph, b.x, b.z, b.r + 0.6);
  for (let k = 0; k < n; k++) {
    const o = NEAR[k];
    if (o === b || o.mode === OFF) continue;
    const p = minDist(ph, b, o) - Math.hypot(o.x - b.x, o.z - b.z);
    if (p > pen) pen = p;
  }
  return pen;
}

// ------------------------------------------------------------------------------------------ adım
export function step(ph: Physics) {
  const { sw, h, bodies } = ph;
  ph.t += h;
  ph.stats.steps++;
  for (const b of bodies) {
    b.px = b.x; b.pz = b.z; b.sx = b.x; b.sz = b.z; b.arrived = false;
    if (b.mode === WALK && b.path?.length) b.goal = goalIndex(sw, b);
    if (b.mode !== WALK) { b.vx = 0; b.vz = 0; b.queued = false; b.waitT = 0; b.queueOut = false; b.stuckT = 0; }
  }
  rebuildHash(ph);
  // adım başı batma (geri alma ölçütü) ve istenen hız
  const arrive: Body[] = ARRIVE;
  arrive.length = 0;
  for (const b of bodies) {
    if (b.mode !== WALK) continue;
    b.pen0 = penetration(ph, b);
    const n = gather(ph, b.x, b.z, b.lite ? 0.8 : 1.6);
    if (desiredVelocity(b, NEAR, n, ph.t)) arrive.push(b);
  }
  // tümleme (ivme sınırı)
  const dvMax = ph.accel * h;
  for (const b of bodies) {
    if (b.mode !== WALK) continue;
    let ax = b.dvx - b.vx, az = b.dvz - b.vz;
    const a = Math.hypot(ax, az);
    if (a > dvMax) { ax *= dvMax / a; az *= dvMax / a; }
    b.vx += ax; b.vz += az;
    b.x += b.vx * h; b.z += b.vz * h;
    if (b.leave >= 0 && tileIndex(sw, b.x, b.z) !== b.leave && staticPush(sw, b.x, b.z, b.r, b.goal, -1).pen <= 1e-4) b.leave = -1;
  }
  // varış: merkeze otur (çakışma yaratmıyorsa)
  for (const b of arrive) {
    const g = b.path![0];
    const ox = b.x, oz = b.z;
    b.x = centerX(g[0]); b.z = centerZ(g[1]);
    if (penetration(ph, b) > ph.eps) { b.x = ox; b.z = oz; continue; }
    b.path!.shift(); b.vx = 0; b.vz = 0; b.arrived = true;
  }
  // konum düzeltme
  for (let it = 0; it < ph.iterations; it++) {
    for (let ai = 0; ai < bodies.length; ai++) {
      const a = bodies[ai];
      if (a.mode !== WALK) continue;
      const n = gather(ph, a.x, a.z, a.r + 0.6);
      for (let k = 0; k < n; k++) {
        const o = NEAR[k];
        if (o === a || o.mode === OFF) continue;
        // yürüyen–yürüyen çifti bir kez (dizin sırası), duran/kinematik her zaman
        if (o.mode === WALK && o.ix < ai) continue;
        const md = minDist(ph, a, o);
        let dx = a.x - o.x, dz = a.z - o.z;
        let d = Math.hypot(dx, dz);
        if (d >= md) continue;
        if (d < 1e-6) { dx = a.id < o.id ? 1 : -1; dz = 0; d = 1; } // tam üst üste: kimliğe göre sabit yön
        const corr = (md - Math.hypot(a.x - o.x, a.z - o.z)) + 1e-4;
        const ux = dx / d, uz = dz / d;
        if (o.mode === WALK) { a.x += ux * corr * 0.5; a.z += uz * corr * 0.5; o.x -= ux * corr * 0.5; o.z -= uz * corr * 0.5; }
        else { a.x += ux * corr; a.z += uz * corr; }
      }
      // statik dünya (iki itme)
      for (let s = 0; s < 2; s++) {
        const p = staticPush(sw, a.x, a.z, a.r, a.goal, a.leave);
        if (p.pen <= 1e-5) break;
        a.x += p.x * 1.001; a.z += p.z * 1.001;
      }
    }
  }
  // sert kural: kötüleşen batma → geri al (geri alınan komşuyu da etkileyebilir; birkaç tur)
  let maxPen = 0;
  for (let pass = 0; pass < 4; pass++) {
    let any = false;
    rebuildHash(ph);
    for (const b of bodies) {
      if (b.mode !== WALK) continue;
      const pen = penetration(ph, b);
      if (pen > ph.eps && pen > b.pen0 + 1e-4 && (b.x !== b.sx || b.z !== b.sz)) {
        b.x = b.sx; b.z = b.sz; b.vx = 0; b.vz = 0; any = true; ph.stats.reverts++;
      }
    }
    if (!any) break;
  }
  // hız = gerçek yer değiştirme (itmeler dahil), kuyruk ve takılma
  for (const b of bodies) {
    if (b.mode !== WALK) continue;
    const mx = (b.x - b.sx) / h, mz = (b.z - b.sz) / h;
    const sp = Math.hypot(mx, mz);
    if (sp < Math.hypot(b.vx, b.vz)) { b.vx = mx; b.vz = mz; }
    if (b.queued) {
      // kuyruk: takılma sayılmaz (önünde duran var), ama sınırsız da beklenmez → zaman aşımı (çağıran yeniden seçer)
      b.waitT += h; b.stuckT = 0;
      if (b.waitT >= b.queueLimit && !b.queueOut) { b.queueOut = true; ph.stats.timeouts++; }
    }
    else if (b.path?.length && sp < 0.25 * b.speed) { b.stuckT += h; if (b.stuckT >= ph.stuckAfter) b.stuck = true; }
    else b.stuckT = Math.max(0, b.stuckT - 2 * h);
    // ilerleme bekçisi: ara noktaya 2 × stuckAfter sn boyunca 0,1'den fazla yaklaşamayan (salınan) beden de takılmıştır
    if (b.queued || !b.path?.length) { b.wp = null; b.progT = 0; }
    else {
      const w = b.path[0];
      const d = Math.hypot(centerX(w[0]) - b.x, centerZ(w[1]) - b.z);
      if (w !== b.wp || d < b.progD - 0.1) { b.wp = w; b.progD = d; b.progT = 0; }
      else if ((b.progT += h) >= ph.stuckAfter * 2) { b.stuck = true; b.progT = 0; b.progD = d; }
    }
    if (!b.path?.length) { b.vx = 0; b.vz = 0; }
    const pen = penetration(ph, b);
    if (pen > maxPen) maxPen = pen;
  }
  ph.stats.maxPen = maxPen;
}
const ARRIVE: Body[] = [];

/** Bütün bedenler arasında (statik dünya dahil, yürüyenler için) en büyük batma — testler ve ölçüm. */
export function maxOverlap(ph: Physics): number {
  rebuildHash(ph);
  let m = 0;
  for (const b of ph.bodies) {
    if (b.mode === OFF) continue;
    const p = penetration(ph, b);
    if (p > m) m = p;
  }
  return m;
}

/**
 * Doğma/sahne değişimi yerleştirmesi (izinli ışınlanma): (x, z) statik dünyaya ya da bir bedene batıyorsa çevresinde
 * (karo merkezleri ve yarım karo kaydırmaları, artan halkalar) ilk boş konum. Hiç yoksa olduğu yer.
 */
export function placeFree(ph: Physics, x: number, z: number, r = AGENT_R, allow = -1): { x: number; z: number } {
  rebuildHash(ph);
  const free = (px: number, pz: number) => {
    if (staticPush(ph.sw, px, pz, r, allow, -1).pen > 1e-4) return false;
    const n = gather(ph, px, pz, r + 0.6);
    for (let k = 0; k < n; k++) { const o = NEAR[k]; if (o.mode !== OFF && Math.hypot(o.x - px, o.z - pz) < o.r + r) return false; }
    return true;
  };
  if (free(x, z)) return { x, z };
  for (let ring = 1; ring <= 12; ring++) {
    const step = 0.5;
    for (let a = -ring; a <= ring; a++) for (let c = -ring; c <= ring; c++) {
      if (Math.max(Math.abs(a), Math.abs(c)) !== ring) continue;
      const px = x + a * step, pz = z + c * step;
      if (free(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}

/**
 * Avatar için sert daire çözümü (controller.stepAvatar): `pos` bedenini `others` dairelerinden (yarıçap `or`) dışarı iter;
 * duvar kontrolü çağıranın `wall(x, z)` geri çağrısıyla (itme duvara sokuyorsa o eksen bırakılır). Ajanlar hiç itilmez.
 * Dönüş: kalan en büyük batma.
 */
export function pushOutCircles(pos: { x: number; z: number }, r: number, others: readonly { x: number; z: number }[], or = AGENT_R,
  wall?: (x: number, z: number) => boolean, iters = 4): number {
  let worst = 0;
  for (let it = 0; it < iters; it++) {
    worst = 0;
    for (const o of others) {
      const md = r + or;
      let dx = pos.x - o.x, dz = pos.z - o.z;
      let d = Math.hypot(dx, dz);
      if (d >= md) continue;
      if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
      const corr = md - Math.hypot(pos.x - o.x, pos.z - o.z) + 1e-4;
      const nx = pos.x + (dx / d) * corr, nz = pos.z + (dz / d) * corr;
      if (!wall || !wall(nx, nz)) { pos.x = nx; pos.z = nz; }
      else if (!wall(nx, pos.z)) pos.x = nx;
      else if (!wall(pos.x, nz)) pos.z = nz;
      else worst = Math.max(worst, corr);
    }
    if (worst === 0) {
      let left = 0;
      for (const o of others) left = Math.max(left, r + or - Math.hypot(pos.x - o.x, pos.z - o.z));
      return Math.max(0, left);
    }
  }
  return worst;
}

/**
 * Takılınca yeniden plan için yol ızgarası: statik ızgara + duran bedenlerin (oturan, bekleyen, avatar) karoları kapalı.
 * `self`in kendi karosu ve hedefi açık kalır. Her çağrıda yeni küme (seyrek: yalnız takılan beden için).
 */
export function dynamicNav(ph: Physics, self: Body, goal: number): { width: number; depth: number; blocked: Set<string> } {
  const { sw } = ph;
  const blocked = new Set(sw.nav.blocked);
  for (const o of ph.bodies) {
    if (o === self || o.mode === OFF || (o.mode === WALK && !o.queued)) continue;
    const k = tileIndex(sw, o.x, o.z);
    if (k < 0 || k === goal) continue;
    blocked.add(`${k % sw.width},${Math.floor(k / sw.width)}`);
  }
  return { width: sw.width, depth: sw.depth, blocked };
}

/**
 * Takılan beden için yeni yol: başlangıç karosu, bedenin bulunduğu karo (orada duran biri varsa ona en yakın açık komşu);
 * duran bedenlerin karoları kapalı. Bulunamazsa null (çağıran yedek hedefe geçer).
 */
export function replan(ph: Physics, b: Body, goal: Tile): Tile[] | null {
  const { sw } = ph;
  const gk = goal[1] * sw.width + goal[0];
  const nav = dynamicNav(ph, b, gk);
  let fi = tileX(b.x), fj = tileZ(b.z);
  if (nav.blocked.has(`${fi},${fj}`)) {
    let best: Tile | null = null, bd = Infinity;
    for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = fi + a, j = fj + c;
      if (i < 0 || j < 0 || i >= sw.width || j >= sw.depth || nav.blocked.has(`${i},${j}`)) continue;
      const d = Math.hypot(centerX(i) - b.x, centerZ(j) - b.z);
      if (d < bd) { bd = d; best = [i, j]; }
    }
    if (best) { fi = best[0]; fj = best[1]; }
  }
  const p = findPath([fi, fj], goal, nav);
  if (!p) return null;
  if (fi !== tileX(b.x) || fj !== tileZ(b.z)) p.unshift([fi, fj]);
  return p;
}

export { STATIC, WALK, KINEMATIC, OFF };
