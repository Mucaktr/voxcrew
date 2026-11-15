/**
 * WALK-SCALE — "yürünebilir görünen ama yürünemeyen" karo denetimi (WALK-PASS-001; scripts/walk_check.mjs çağırır).
 *
 * Bir karo **yürünebilir görünür** ise:
 * - zemin yüzeyi: karonun ≥ %60'ını örten, tepesi −0,25…0,16 arasında, su/dalga olmayan en yüksek blok (zemin küpü, köprü
 * güvertesi, iskele tahtası, rıhtım, yol/kaldırım, meydan) ve bu yüzeyin üstünde su yok;
 * - yüzeyin üstünde gövde bandında (yüzey + 0,05 … 1,6) katı blokların kapladığı alan < %40 ve karo merkezi (r 0,2) boş.
 * Kenara yaslı korkuluk, bordür, baba, ince lamba direği yürünebilir görünümü bozmaz; masa, tezgâh, duvar, ağaç gövdesi bozar.
 *
 * Böyle bir karo (dekoratif işaretli değilse) şunlardan biriyse sorundur:
 * - `blocked`: kaba ızgarada engelli (`built.blocked`);
 * - `body`: avatar (yarıçap `r`, `stepAvatar` ile aynı ince çarpıştırıcılar) karonun içinde duramıyor (ör. iki yanı
 * korkuluklu tek karoluk güverte, geçidin ortasındaki eşya);
 * - `island`: avatar duruyor ama doğma karosundan yürüyerek (4 komşu, duranabilir karolar) ulaşılamıyor; bileşen
 * `POCKET_MAX` karodan küçükse `pocket` (uyarı, kapıyı düşürmez: oturak sırası, saksı ya da cam duvar arkasında kör köşe).
 * Yol bulmada kapalı ama avatarın yürüyebildiği karo (kenarda korkuluk, köşede saksı) sorun sayılmaz: tıkla-git en yakın açık
 * karoya gider, klavyeyle geçilir.
 * - `sweep` ( SPIN-SWEEP): dönen (`spin`) bir bloğun süpürme zarfı karonun yüzeyi üstündeki gövde bandına giriyor ama karo
 * kaba ızgarada engelli değil. Dönen bloklar çarpıştırıcı üretmez (mover gibi, physics/world.ts); avatarın kanat/kabin
 * içinden geçmemesi için süpürülen gövde bandı karoları yazar tarafından engellenir (binme ileride `transit` ile).
 * Dönen bloğun zarfı "yürünebilir görünüm"de engel sayılır (zarf altındaki karo yürünebilir görünmez).
 * Dekoratif: `landmark` bölgeleri (ufuktaki simge silüetin ayak izi) ve `DECORATIVE` listesi (sahne başına, gerekçeli).
 *
 * Saf modül (React/three yok); aynı `built` → aynı sonuç.
*/
import { resolveStatic, staticWorld, FREE, SOLID, type StaticWorld } from "../physics/world";
import { D, W, type Block, type Built, type Tile } from "../scenes";
import { spinEnvelope } from "../spin";
import { FULL_DECORATIVE, FULL_DECORATIVE_BLOCKED } from "../../full/passability";

const HW = W / 2, HD = D / 2;
const WATERY = new Set(["water", "wave"]);
const SOLIDISH = new Set(["solid", "glass", "glow"]);
/** çarpışmayan ama karoyu "dolu" gösteren gruplar (salınan yosun/bitki, ateş): merkezdeyse ya da uzunsa karo yürünebilir görünmez */
const VISUAL = new Set(["bob", "flame"]);
/** yüzey tepesi aralığı (zemin küpü 0; güverte −0,03…0,05; rıhtım 0,12) */
export const SURFACE_MIN = -0.25;
export const SURFACE_MAX = 0.16;
/** yüzeyin örtmesi gereken en az alan oranı */
const SURFACE_COVER = 0.6;
/** gövde bandı üst sınırı (yüzeyin üstünde) ve izin verilen engel alanı oranı */
const BODY_TOP = 1.6;
const OBSTRUCT_MAX = 0.4;
/** merkez diski (bu yarıçapta engel varsa karo yürünebilir görünmez) */
const CENTER_R = 0.2;
/** bu boydan uzun katı parça (lamba direği, sütun, ağaç gövdesi, file direği) karoyu "döşeli" sayar */
const POST_H = 1.2;

export type PassKind = "blocked" | "body" | "island" | "pocket" | "sweep";
/** süpürme zarfının gövde bandı (yüzey üstü; avatar boyu + pay)*/
export const SWEEP_BAND: readonly [number, number] = [0.05, 2.0];
/** bundan küçük kopuk bileşen "kör köşe" uyarısıdır (sorun sayılmaz, raporlanır) */
export const POCKET_MAX = 6;
export interface PassIssue { i: number; j: number; kind: PassKind }
export interface PassReport {
  /** yürünebilir görünen karo sayısı (dekoratif hariç) */
  looking: number;
  issues: PassIssue[];
  /** dekoratif sayılan yürünebilir görünümlü karolar */
  decorative: number;
}
/** Kapıyı düşüren sorunlar (cep uyarısı hariç). */
export const failing = (r: PassReport) => r.issues.filter((s) => s.kind !== "pocket");

/** Sahne başına bilerek yürünmez bırakılan, yürünebilir görünen alanlar: [i0, j0, i1, j1, gerekçe] (taban sahne karosu).
 * Her girdi WALK-SCALE denetiminde tek tek bakıldı; görsel ipucu eksik olanlar'de açık iş.*/
export const DECORATIVE: Record<string, [number, number, number, number, string][]> = {
  ...FULL_DECORATIVE,
  beach: [[21, 13, 21, 14, "gölgelik altında iki karoya taşan soğutucu kutu"]],
  mall: [[0, 0, 5, 7, "çok katlı otopark zemin katı (araç alanı, giriş bariyerli)"]],
  battlefield: [[1, 14, 8, 14, "siper hattı (düz tahta döşeme; çukur görseli yok — açık iş)"]],
  space: [[2, 2, 4, 4, "fırlatma rampası güvenlik alanı"]],
  snow: [[17, 10, 21, 13, "buzlu gölet (ince buz)"]],
};
/** Dış alanı bilerek yürünmez sahneler: yürünebilir görünen engelli karo sorun sayılmaz (yalnız `blocked`; diğerleri denetlenir). */
export const DECORATIVE_BLOCKED: Record<string, string> = {
  ...FULL_DECORATIVE_BLOCKED,
};

interface Rect { a: number; b: number; c: number; d: number }

/** Karo başına yüzey tepesi ve görünür engel; 1 = yürünebilir görünür. */
export function walkableLooking(built: Pick<Built, "width" | "depth" | "blocks">): Uint8Array {
  return lookGrid(built).out;
}

/** Yürünebilir görünüm ızgarası ve karo başına yüzey tepesi (SPIN-SWEEP de kullanır). */
function lookGrid(built: Pick<Built, "width" | "depth" | "blocks">): { out: Uint8Array; surf: Float32Array } {
  const { width, depth } = built;
  const n = width * depth;
  const surf = new Float32Array(n).fill(-Infinity);
  const surfWet = new Uint8Array(n);
  const wetTop = new Float32Array(n).fill(-Infinity);
  const tiles = (bl: Block, f: (k: number, r: Rect, area: number) => void) => {
    const minX = bl.p[0] - bl.s[0] / 2, maxX = bl.p[0] + bl.s[0] / 2, minZ = bl.p[2] - bl.s[2] / 2, maxZ = bl.p[2] + bl.s[2] / 2;
    const i0 = Math.max(0, Math.floor(minX + HW + 1e-4)), i1 = Math.min(width - 1, Math.floor(maxX + HW - 1e-4));
    const j0 = Math.max(0, Math.floor(minZ + HD + 1e-4)), j1 = Math.min(depth - 1, Math.floor(maxZ + HD - 1e-4));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x0 = i - HW, z0 = j - HD;
      const r = { a: Math.max(minX, x0), b: Math.max(minZ, z0), c: Math.min(maxX, x0 + 1), d: Math.min(maxZ, z0 + 1) };
      const area = Math.max(0, r.c - r.a) * Math.max(0, r.d - r.b);
      if (area > 0) f(j * width + i, r, area);
    }
  };
  // 1) yüzey: en yüksek geniş blok (tepe aralıkta)
  for (const bl of built.blocks) {
    const top = bl.p[1] + bl.s[1] / 2;
    if (top < SURFACE_MIN || top > SURFACE_MAX) continue;
    const wet = WATERY.has(bl.g);
    if (!wet && !SOLIDISH.has(bl.g)) continue;
    tiles(bl, (k, _r, area) => {
      if (wet) { if (top > wetTop[k]) wetTop[k] = top; }
      if (area < SURFACE_COVER) return;
      if (top > surf[k]) { surf[k] = top; surfWet[k] = wet ? 1 : 0; }
    });
  }
  // 2) gövde bandındaki engel
  const obst = new Float32Array(n);
  const center = new Uint8Array(n);
  for (const b0 of built.blocks) {
    const vis = VISUAL.has(b0.g);
    // dönen blok süpürme zarfıyla engel sayılır
    let bl = b0;
    if (b0.g === "spin" && b0.r) {
      const [lo, hi] = spinEnvelope(b0);
      bl = { ...b0, p: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], s: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
    } else if (!SOLIDISH.has(b0.g) && !vis) continue;
    const y0 = bl.p[1] - bl.s[1] / 2, y1 = bl.p[1] + bl.s[1] / 2;
    tiles(bl, (k, r, area) => {
      const s = surf[k];
      if (s === -Infinity || y1 <= s + 0.05 || y0 >= s + BODY_TOP) return;
      if (!vis) obst[k] += area;
      if (y1 - s >= POST_H) center[k] = 1; // direk, kule ayağı, duvar: karo bilerek kapalı olabilir (yürünebilir görünmez)
      const i = k % width, j = (k - i) / width;
      const cx = i - HW + 0.5, cz = j - HD + 0.5;
      const qx = Math.max(r.a, Math.min(cx, r.c)), qz = Math.max(r.b, Math.min(cz, r.d));
      if (Math.hypot(qx - cx, qz - cz) < CENTER_R) center[k] = 1;
    });
  }
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (surf[k] === -Infinity || surfWet[k]) continue;
    if (wetTop[k] > surf[k] + 0.01) continue; // yüzeyin üstünde su (sığ kıyı, havuz)
    if (center[k] || obst[k] >= OBSTRUCT_MAX) continue;
    out[k] = 1;
  }
  return { out, surf };
}

/** SPIN-SWEEP: dönen blok zarfının gövde bandına girdiği, kaba ızgarada engelsiz yüzeyli karolar.*/
export function sweepIssues(built: Pick<Built, "width" | "depth" | "blocks" | "blocked">, surf = lookGrid(built).surf): PassIssue[] {
  const { width, depth } = built;
  const seen = new Set<number>();
  const out: PassIssue[] = [];
  for (const b of built.blocks) {
    if (b.g !== "spin" || !b.r) continue;
    const [lo, hi] = spinEnvelope(b);
    const i0 = Math.max(0, Math.floor(lo[0] + HW + 1e-4)), i1 = Math.min(width - 1, Math.floor(hi[0] + HW - 1e-4));
    const j0 = Math.max(0, Math.floor(lo[2] + HD + 1e-4)), j1 = Math.min(depth - 1, Math.floor(hi[2] + HD - 1e-4));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * width + i, s = surf[k];
      if (seen.has(k) || s === -Infinity || hi[1] <= s + SWEEP_BAND[0] || lo[1] >= s + SWEEP_BAND[1] || built.blocked.has(`${i},${j}`)) continue;
      seen.add(k);
      out.push({ i, j, kind: "sweep" });
    }
  }
  return out;
}

/** Dekoratif karo maskesi: landmark bölgeleri + `DECORATIVE[scene]` (büyümüş dünyada taban koordinatı aynı kalır). */
export function decorativeMask(built: Pick<Built, "width" | "depth" | "zones">, scene?: string): Uint8Array {
  const { width, depth } = built;
  const m = new Uint8Array(width * depth);
  const mark = (i0: number, j0: number, i1: number, j1: number) => {
    for (let j = Math.max(0, j0); j <= Math.min(depth - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(width - 1, i1); i++) m[j * width + i] = 1;
  };
  for (const z of built.zones ?? []) if (z.kind === "landmark") mark(z.i0, z.j0, z.i0 + z.w - 1, z.j0 + z.d - 1);
  for (const [i0, j0, i1, j1] of (scene && DECORATIVE[scene]) || []) mark(i0, j0, i1, j1);
  return m;
}

/** Avatar (yarıçap r) karo `k`'nin içinde durabiliyor mu: kaba engel yok ve merkezden statik dünyaya itilince karoda kalıyor. */
export function standable(sw: StaticWorld, k: number, r = 0.28): boolean {
  if (sw.kind[k] === SOLID) return false;
  if (sw.kind[k] === FREE) return true;
  const i = k % sw.width, j = (k - i) / sw.width;
  const p = { x: i - HW + 0.5, z: j - HD + 0.5 };
  const pen = resolveStatic(sw, p, r, -1, -1, 6);
  return pen <= 1e-3 && Math.floor(p.x + HW) === i && Math.floor(p.z + HD) === j;
}

/**
 * WALK-PASS-001: yürünebilir görünen her karo kaba ızgarada açık, avatar yarıçapı `r` içinde durabilir ve doğma karosundan
 * yürüyerek ulaşılabilir. `spawn` yoksa en büyük duranabilir bileşen ana sayılır.
 */
export function passability(built: Built, opts: { scene?: string; spawn?: Tile | null; r?: number; sw?: StaticWorld } = {}): PassReport {
  const { width, depth } = built;
  const n = width * depth;
  const { out: look, surf } = lookGrid(built);
  const deco = decorativeMask(built, opts.scene);
  const sw = opts.sw ?? staticWorld(built);
  const r = opts.r ?? 0.28;
  const stand = new Uint8Array(n);
  for (let k = 0; k < n; k++) stand[k] = standable(sw, k, r) ? 1 : 0;
  // duranabilir karoların 4-komşu bileşenleri
  const lab = new Int32Array(n).fill(-1);
  const size: number[] = [];
  const q = new Int32Array(n);
  for (let s0 = 0; s0 < n; s0++) {
    if (!stand[s0] || lab[s0] >= 0) continue;
    const id = size.length;
    let h = 0, t = 0;
    q[t++] = s0; lab[s0] = id;
    while (h < t) {
      const cur = q[h++];
      const ci = cur % width, cj = (cur - ci) / width;
      for (const [di, dj] of NB) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= width || nj >= depth) continue;
        const nk = nj * width + ni;
        if (stand[nk] && lab[nk] < 0) { lab[nk] = id; q[t++] = nk; }
      }
    }
    size.push(t);
  }
  let main = -1;
  if (opts.spawn) {
    const [si, sj] = opts.spawn;
    if (si >= 0 && sj >= 0 && si < width && sj < depth) main = lab[sj * width + si];
  }
  if (main < 0) size.forEach((c, id) => { if (main < 0 || c > size[main]) main = id; });
  const issues: PassIssue[] = [];
  let looking = 0, decorative = 0;
  for (let k = 0; k < n; k++) {
    if (!look[k]) continue;
    if (deco[k]) { decorative++; continue; }
    looking++;
    const i = k % width, j = (k - i) / width;
    if (built.blocked.has(`${i},${j}`)) { if (!(opts.scene && DECORATIVE_BLOCKED[opts.scene])) issues.push({ i, j, kind: "blocked" }); else decorative++; }
    else if (!stand[k]) issues.push({ i, j, kind: "body" });
    else if (main >= 0 && lab[k] !== main) issues.push({ i, j, kind: size[lab[k]] <= POCKET_MAX ? "pocket" : "island" });
  }
  issues.push(...sweepIssues(built, surf));
  return { looking, issues, decorative };
}
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Sorunları dikdörtgen olmayan kısa bir metne özetler: tür → karo listesi (en çok `max` karo). */
export function summarizeIssues(issues: readonly PassIssue[], max = 8): string {
  const by = new Map<PassKind, string[]>();
  for (const s of issues) { const l = by.get(s.kind) ?? []; l.push(`${s.i},${s.j}`); by.set(s.kind, l); }
  return [...by].map(([k, l]) => `${k} ${l.length}: ${l.slice(0, max).join(" ")}${l.length > max ? " …" : ""}`).join(" · ");
}
