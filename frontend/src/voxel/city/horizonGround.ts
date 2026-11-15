/**
 * HORIZON (ürün sahibi 2026-10-30: "Ekranın en arkasında hiç bir yere oturmamış bir cami var… iyice saçmalamışın") — ufuk bandının
 * zemini ve kopuk ufuk denetimi.
 *
 * Kök neden: şehir tabanının ufuk silüeti (`Built.backdrop`; city/skyline.ts `skylineBand` ve şehirlerin kendi bantları) ızgaranın
 * 10–25 birim arkasında, y = 0'da DURUR ama altında hiçbir şey yoktur: genel bakış kamerasında çevre arazisi çizilmez
 * (expanse/Outskirts yalnız yürüme modunda) ve dünyanın altındaki düzlem gök rengindedir (World.tsx y −2,01). Bu yüzden bant gökte
 * asılı bir şerit, tek başına duran simge ise "hiçbir yere oturmamış" bir yapı gibi görünür (<city> kule şeridi, Londra, <city>,
 * <city> sırtı, <city>, <city> körfez köprüsü ve uzak kulesi…).
 *
 * Bu modül (saf; React/three yok):
 * - `horizonGround(built, palette)`: tabanın arka (ve gerekirse yan) kenarından ufuk yapılarının altına uzanan alçak arazi
 * (önlük): ızgaranın kenarıyla aynı düzlemde (üst y = 0, iki katman: renkli üst + taban toprağı, tabanın yan kesitiyle aynı),
 * kenarda tabanın kenar rengi, gerisi şehrin çim/meydan rengiyle karışık ve sis/gök rengine doğru açılan (hava perspektifi) iki
 * şerit. Yalnız ufukta zeminsiz duran yapıların ayak izi kadar (ve kenara dek) — mevcut zemin/su levhalarının altına girmez
 * (üst üste düzlem yok → z-fight yok). Üst yüzü tabanın 6 cm altında (`APRON_TOP`): yürüme modunda çevre parselleri önlüğün
 * üstünü örter; çevre bastırması önlüğü bant saymaz (expanse/context.ts) → yürüme modunda açık parseller aynı kalır.
 * Bloklar `solid` grubunda → +0 çizim çağrısı; ızgara bloklarına dokunmaz; ızgara dışında, yürünmez.
 * - `detachedBackdrop(built, oceanY)`: SCENE-BACKDROP-002 — her ufuk bloğu tabana (kenarına `GROUND_GAP` birimden yakın), sahne
 * okyanusuna ya da bunlara dayanan bir bloğa oturmalı. Dayanak zinciri: (a) zemin levhaları (üst ≤ 0,35) yan yana değerek;
 * (b) bir blok altındakine oturur ya da gömülür (ayak izleri örtüşür, alt yüzü dayanağın gövdesi içinde ya da en çok 0,3 üstünde).
 * Yan yana duran iki kule birbirini taşımaz (yalnız yüz teması). Kopuk kalan bloklar kümelere ayrılır (yükseklik, tabana uzaklık).
 * Küçük süs parçaları (en büyük ölçüsü < 0,6: kablo noktası, ikaz ışığı, ince direk) raporlanmaz ama taşıyıcı olabilir (kafes
 * kulenin köşe direği, hurma gövdesi).
*/
import { tx, tz, type Block, type Built } from "../scenes";

/** Tabanın kenarına bu kadar (birim) yakın duran zemin/yapı tabana bağlı sayılır (N). */
export const GROUND_GAP = 0.6;
/** Denetime giren en küçük parça (en büyük ölçü, birim). */
export const MIN_PART = 0.6;
/** Zemin levhası: üst yüzü bu yükseklikten alçak. */
export const GROUND_TOP = 0.35;
const XZ_TOL = 0.05;
/** yan eklenti hacim tavanı (birim³) */
const LIGHT = 1;
/** raporlanan küme: yüksekliği ya da hacmi bundan büyük (tek kablo noktası, yaprak raporlanmaz) */
export const REPORT_H = 1, REPORT_V = 0.5;
const vol = (b: Block) => b.s[0] * b.s[1] * b.s[2];
const Y_TOL = 0.3;

export interface Rect { x0: number; x1: number; z0: number; z1: number }
export interface DetachedCluster { n: number; rect: Rect; y0: number; y1: number; gap: number; sample: string }

const top = (b: Block) => b.p[1] + b.s[1] / 2;
const bot = (b: Block) => b.p[1] - b.s[1] / 2;
const rectOf = (b: Block, pad = 0): Rect => ({ x0: b.p[0] - b.s[0] / 2 - pad, x1: b.p[0] + b.s[0] / 2 + pad, z0: b.p[2] - b.s[2] / 2 - pad, z1: b.p[2] + b.s[2] / 2 + pad });
const area = (r: Rect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.z1 - r.z0);
const overlap = (a: Rect, b: Rect) => area({ x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), z0: Math.max(a.z0, b.z0), z1: Math.min(a.z1, b.z1) });
/** İki dikdörtgen arası en kısa uzaklık (değiyor/örtüşüyorsa 0). */
export const rectGap = (a: Rect, b: Rect) => Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.z0 - b.z1, b.z0 - a.z1));

/** Dünya ızgarasının dünya dikdörtgeni (taban ya da büyümüş dünya). */
export const boardRect = (b: Pick<Built, "width" | "depth">): Rect => ({ x0: tx(0) - 0.5, x1: tx(b.width - 1) + 0.5, z0: tz(0) - 0.5, z1: tz(b.depth - 1) + 0.5 });

/** dayanak grafiğine giren parça (bulut/kar/salınan süs hariç; ince direkler de taşıyıcıdır) */
const solidPart = (b: Block) => b.g !== "cloud" && b.g !== "snow" && b.g !== "bob";
/** denetlenen (raporlanan) parça: katı (ışık huzmesi, kuzey ışığı şeridi, parlayan/cam süs havada durabilir) ve en büyük ölçüsü
 *  `MIN_PART`'tan büyük */
const counts = (b: Block) => b.g !== "glow" && b.g !== "glass" && Math.max(b.s[0], b.s[1], b.s[2]) >= MIN_PART;
const groundLike = (b: Block) => top(b) <= GROUND_TOP;

/** Ufuk bloklarının dayanak hesabı: `ok[k]` k. ufuk bloğu (denetime girenlerden) zemine bağlı mı. */
export function backdropSupport(built: Pick<Built, "backdrop" | "width" | "depth">, oceanY: number | null = null): { parts: Block[]; ok: boolean[] } {
  const parts = (built.backdrop ?? []).filter(solidPart);
  const R = boardRect(built);
  const ok = parts.map((b) => {
    if (oceanY !== null && bot(b) <= oceanY + Y_TOL) return true;
    return bot(b) <= 0.05 && top(b) > -2 && rectGap(rectOf(b), R) <= GROUND_GAP;
  });
  const rects = parts.map((b) => rectOf(b));
  const wide = parts.map((b) => rectOf(b, XZ_TOL));
  // kaba ızgara kovası (komşu arama)
  const CELL = 4, key = (i: number, j: number) => `${i},${j}`;
  const grid = new Map<string, number[]>();
  rects.forEach((r, k) => {
    for (let i = Math.floor(r.x0 / CELL); i <= Math.floor(r.x1 / CELL); i++) for (let j = Math.floor(r.z0 / CELL); j <= Math.floor(r.z1 / CELL); j++) {
      const l = grid.get(key(i, j)); if (l) l.push(k); else grid.set(key(i, j), [k]);
    }
  });
  const near = (k: number) => {
    const r = wide[k], out = new Set<number>();
    for (let i = Math.floor(r.x0 / CELL); i <= Math.floor(r.x1 / CELL); i++) for (let j = Math.floor(r.z0 / CELL); j <= Math.floor(r.z1 / CELL); j++)
      for (const n of grid.get(key(i, j)) ?? []) if (n !== k) out.add(n);
    return out;
  };
  /** `b` bloğu `a`'ya dayanır mı (a zaten bağlı). Zemin levhaları yan yana değerek; öteki bloklar üstüne oturarak (altındaki
   *  bağlı blokların ayak izi `b`'nin en az dörtte birini örter — birkaç dar levha birlikte de taşır — ya da `a` ince bir direk/ayak
   *  olarak bütünüyle `b`'nin altındadır: köprü ayağı, hurma gövdesi). */
  const cover = new Array(parts.length).fill(0);
  const rests = (a: number, b: number) => {
    const A = parts[a], B = parts[b];
    if (groundLike(A) && groundLike(B) && Math.abs(top(A) - top(B)) <= GROUND_TOP && rectGap(rects[a], rects[b]) <= XZ_TOL) return true;
    // katmanlı zemin: bağlı levhanın hemen altındaki levha (önlüğün toprak katmanı) da bağlıdır
    if (groundLike(A) && groundLike(B) && Math.abs(bot(A) - top(B)) <= 0.05 && overlap(rects[a], rects[b]) > 0) return true;
    const ov = overlap(wide[a], rects[b]);
    // hafif yan eklenti (yaprak, saçak, tabela, kablo parçası; ≤ 1 birim³) bağlı bloğa değiyorsa onunla birlikte durur
    if (vol(B) <= LIGHT && ov > 0 && bot(B) <= top(A) + XZ_TOL && top(B) >= bot(A) - XZ_TOL) return true;
    if (ov <= 0 || bot(B) < bot(A) - 0.05 || bot(B) > top(A) + Y_TOL) return false;
    cover[b] += ov;
    return cover[b] >= 0.25 * area(rects[b]) || ov >= 0.25 * area(rects[a]);
  };
  const queue = ok.flatMap((v, k) => (v ? [k] : []));
  while (queue.length) {
    const a = queue.pop()!;
    for (const b of near(a)) if (!ok[b] && rests(a, b)) { ok[b] = true; queue.push(b); }
  }
  return { parts, ok };
}

/** SCENE-BACKDROP-002: zemine bağlanmayan ufuk blokları, kümeler hâlinde (büyükten küçüğe). */
export function detachedBackdrop(built: Pick<Built, "backdrop" | "width" | "depth">, oceanY: number | null = null): DetachedCluster[] {
  const { parts, ok } = backdropSupport(built, oceanY);
  const loose = parts.flatMap((b, k) => (ok[k] || !counts(b) ? [] : [b]));
  if (!loose.length) return [];
  const R = boardRect(built);
  const seen = new Array(loose.length).fill(false);
  const out: DetachedCluster[] = [];
  for (let s = 0; s < loose.length; s++) {
    if (seen[s]) continue;
    seen[s] = true;
    const stack = [s], members: Block[] = [];
    while (stack.length) {
      const k = stack.pop()!;
      members.push(loose[k]);
      const r = rectOf(loose[k], 0.3);
      for (let n = 0; n < loose.length; n++) if (!seen[n] && rectGap(r, rectOf(loose[n])) <= 0) { seen[n] = true; stack.push(n); }
    }
    const rect = members.reduce((a, b) => { const r = rectOf(b); return { x0: Math.min(a.x0, r.x0), x1: Math.max(a.x1, r.x1), z0: Math.min(a.z0, r.z0), z1: Math.max(a.z1, r.z1) }; },
      { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
    const y0 = Math.min(...members.map(bot)), y1 = Math.max(...members.map(top));
    const b0 = members.reduce((a, b) => (top(b) - bot(b) > top(a) - bot(a) ? b : a));
    if (y1 - y0 < REPORT_H && members.reduce((a, b) => a + vol(b), 0) < REPORT_V) continue;
    out.push({ n: members.length, rect, y0, y1, gap: rectGap(rect, R), sample: `${b0.c} @ ${b0.p.map((v) => v.toFixed(1)).join(",")}` });
  }
  return out.sort((a, b) => b.n - a.n);
}

// ------------------------------------------------------------------------------------------ önlük (ufuk zemini)
export interface HorizonPalette {
  /** şehrin çim (ya da meydan) rengi; arazi bunun ve tabanın kenar renginin karışımıdır */
  land: string;
  /** taban toprağı (ızgaranın alt katmanıyla aynı aile) */
  under: string;
  /** gök/sis rengi (uzak şerit ona doğru açılır) */
  sky: string;
}

const hex = (c: string) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
const mix = (a: string, b: string, t: number) => `#${hex(a).map((v, k) => Math.round(v + (hex(b)[k] - v) * t).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
/** Önlüğün kenar şeridi (tabanın renginin sürdüğü) ve iki uzak şeridin derinliği (birim). */
export const EDGE_STRIP = 2;
const NEAR_STRIP = 8;
/** Önlüğün üst yüzü: tabanın (y 0) 6 cm altında. Yürüme modunda çevre parselinin zemini (üst y 0) önlüğün üstünü örter (aynı
 *  düzlem yok → z-fight yok); genel bakışta bu basamak bir pikselin altındadır. Bu yükseklik önlüğün imzasıdır: çevre arazisi
 *  bastırması (expanse/context.ts) önlüğü bant saymaz → yürüme modunda açık parseller değişmez. */
export const APRON_TOP = -0.06;
const APRON_MID = -1.06;
/** dünya biçimi parça ölçüsü tavanı (worldFormat.ts `isBackdropPart` ≤ 40) */
const MAX_SPAN = 40;
/** önlük bloklarının renk kırıntısı (imzanın parçası) */
const APRON_J = 0.02;
/** Önlük bloğu mu: üst yüzü `APRON_TOP` (renkli katman, kalınlık 1) ya da `APRON_MID` (toprak katmanı, kalınlık 0,94), alt yüzü ≥ −2,
 *  kırıntı 0,02. Sahnelerin kendi ufuk blokları bu imzaya uymaz (worlds.mjs ile denetlendi: 0 eşleşme). */
export const isHorizonApron = (b: { p: readonly number[]; s: readonly number[]; j?: number }) => {
  const t = b.p[1] + b.s[1] / 2, d = b.p[1] - b.s[1] / 2;
  return (Math.abs(t - APRON_TOP) < 1e-4 || Math.abs(t - APRON_MID) < 1e-4) && b.s[1] >= 0.9 && b.s[1] <= 1.0001 && d >= -2.0001
    && Math.abs((b.j ?? 0) - APRON_J) < 1e-6;
};

/** Tabanın bir kenar şeridindeki baskın zemin rengi (üst yüzü y = 0 olan zemin küpleri, örtüşme uzunluğuyla tartılı). */
function edgeColor(blocks: readonly Block[], strip: Rect, fallback: string): string {
  const w = new Map<string, number>();
  for (const b of blocks) {
    if (Math.abs(top(b)) > 0.06 || bot(b) > -0.5) continue;
    const ov = overlap(rectOf(b), strip);
    if (ov > 0) w.set(b.c, (w.get(b.c) ?? 0) + ov);
  }
  let best = fallback, bw = 0;
  for (const [c, v] of w) if (v > bw) { bw = v; best = c; }
  return best;
}

/**
 * Ufuk önlüğü (yeni `backdrop` blokları; taban değişmez). Zeminsiz duran ufuk yapılarının (alt yüzü ≤ 0,35) ayak izi 1 birim payla
 * hücrelere (1 × 1) dökülür; arkadakiler (z < arka kenar) tabanın arka kenarına, yandakiler yan kenarına dek dikdörtgen olarak
 * doldurulur. Dolu hücreler satır satır birleştirilir; her dikdörtgen iki blok (üst katman y −1…0 renkli, alt katman y −2…−1 toprak).
 */
export function horizonGround(built: Pick<Built, "backdrop" | "blocks" | "width" | "depth">, pal: HorizonPalette, oceanY: number | null = null): Block[] {
  const bd = built.backdrop ?? [];
  if (!bd.length) return [];
  const R = boardRect(built);
  const { parts, ok } = backdropSupport(built, oceanY);
  const seeds = parts.filter((b, k) => !ok[k] && bot(b) <= GROUND_TOP);
  if (!seeds.length) return [];
  // hücre (1 birim; ızgara kenarları tam sayı) — anahtar "x,z" sol-arka köşe
  type Zone = "back" | "left" | "right" | "front";
  const zoneOf = (x: number, z: number): Zone => (z < R.z0 ? "back" : x < R.x0 ? "left" : x >= R.x1 ? "right" : "front");
  const need: Record<Zone, { x0: number; x1: number; z0: number; z1: number } | null> = { back: null, left: null, right: null, front: null };
  for (const b of seeds) {
    const r = rectOf(b, 1);
    for (let x = Math.floor(r.x0); x < Math.ceil(r.x1); x++) for (let z = Math.floor(r.z0); z < Math.ceil(r.z1); z++) {
      if (x >= R.x0 && x < R.x1 && z >= R.z0 && z < R.z1) continue;
      const zn = zoneOf(x + 0.5, z + 0.5), cur = need[zn];
      need[zn] = cur ? { x0: Math.min(cur.x0, x), x1: Math.max(cur.x1, x + 1), z0: Math.min(cur.z0, z), z1: Math.max(cur.z1, z + 1) } : { x0: x, x1: x + 1, z0: z, z1: z + 1 };
    }
  }
  // bölge → kenara dek dikdörtgen (renk o bölgenin kenarına uzaklıktan)
  const fill: (Rect & { zone: Zone })[] = [];
  if (need.back) fill.push({ zone: "back", x0: need.back.x0, x1: need.back.x1, z0: need.back.z0, z1: R.z0 });
  if (need.left) fill.push({ zone: "left", x0: need.left.x0, x1: R.x0, z0: Math.max(need.left.z0, R.z0), z1: Math.min(need.left.z1, R.z1) });
  if (need.right) fill.push({ zone: "right", x0: R.x1, x1: need.right.x1, z0: Math.max(need.right.z0, R.z0), z1: Math.min(need.right.z1, R.z1) });
  if (need.front) fill.push({ zone: "front", x0: Math.max(need.front.x0, R.x0), x1: Math.min(need.front.x1, R.x1), z0: R.z1, z1: need.front.z1 });
  // mevcut zemin/su levhalarının (ve gömülü arazinin) altına girilmez
  const ground = bd.filter((b) => groundLike(b) && top(b) > -1.5).map((b) => rectOf(b));
  const blocked = (x: number, z: number) => {
    const cx = x + 0.5, cz = z + 0.5;
    if (cx > R.x0 && cx < R.x1 && cz > R.z0 && cz < R.z1) return true;
    return ground.some((g) => cx > g.x0 && cx < g.x1 && cz > g.z0 && cz < g.z1);
  };
  // renkler: kenar şeridi tabanın kenar rengi, gerisi araziyle karışık ve göğe açılan
  const edges = {
    back: edgeColor(built.blocks, { x0: R.x0, x1: R.x1, z0: R.z0, z1: R.z0 + 1 }, pal.land),
    left: edgeColor(built.blocks, { x0: R.x0, x1: R.x0 + 1, z0: R.z0, z1: R.z1 }, pal.land),
    right: edgeColor(built.blocks, { x0: R.x1 - 1, x1: R.x1, z0: R.z0, z1: R.z1 }, pal.land),
    front: edgeColor(built.blocks, { x0: R.x0, x1: R.x1, z0: R.z1 - 1, z1: R.z1 }, pal.land),
  };
  const colorAt = (zone: Zone, x: number, z: number) => {
    const cx = x + 0.5, cz = z + 0.5;
    const dist = zone === "back" ? R.z0 - cz : zone === "left" ? R.x0 - cx : zone === "right" ? cx - R.x1 : cz - R.z1;
    const edge = edges[zone];
    if (dist < EDGE_STRIP) return edge;
    const land = mix(edge, pal.land, 0.35);
    return mix(land, pal.sky, dist < EDGE_STRIP + NEAR_STRIP ? 0.12 : 0.26);
  };
  // hücre → renk; satır koşuları → dikey birleştirme
  const cells = new Map<string, string>();
  for (const f of fill) for (let x = f.x0; x < f.x1; x++) for (let z = f.z0; z < f.z1; z++) {
    if (!blocked(x, z) && !cells.has(`${x},${z}`)) cells.set(`${x},${z}`, colorAt(f.zone, x, z));
  }
  if (!cells.size) return [];
  const rects = mergeCells(cells);
  const out: Block[] = [];
  for (const r of rects) out.push(slab(r, APRON_MID, APRON_TOP, r.c, R));
  // alt katman (toprak) renkten bağımsız birleşir → daha az blok
  const soil = new Map<string, string>();
  for (const k of cells.keys()) soil.set(k, pal.under);
  for (const r of mergeCells(soil)) out.push(slab(r, -2, APRON_MID, pal.under, R));
  return out;
}

/** Önlük levhası. Tabanın kenarına değen yüz kenardan `EDGE_INSET` içeri çekilir: büyüyen dünyada (districts/core.ts) "tabanın
 *  arkasında" sayılır ve bantla birlikte kayar (arka kenar z'si tam kenarda olan blok yan dekor gibi esnetilirdi). */
const EDGE_INSET = 0.01;
const slab = (r: Rect, y0: number, y1: number, c: string, R: Rect): Block => {
  const x0 = r.x0 === R.x1 ? r.x0 + EDGE_INSET : r.x0, x1 = r.x1 === R.x0 ? r.x1 - EDGE_INSET : r.x1;
  const z0 = r.z0 === R.z1 ? r.z0 + EDGE_INSET : r.z0, z1 = r.z1 === R.z0 ? r.z1 - EDGE_INSET : r.z1;
  return { p: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], s: [x1 - x0, y1 - y0, z1 - z0], c, g: "solid", j: APRON_J };
};

/** Hücreleri (anahtar "x,z", 1 × 1) aynı renkli satır koşularına, sonra aynı koşulu ardışık satırları dikdörtgenlere birleştirir. */
function mergeCells(cells: Map<string, string>): (Rect & { c: string })[] {
  const rows = new Map<number, { x: number; c: string }[]>();
  for (const [k, c] of cells) {
    const [x, z] = k.split(",").map(Number);
    (rows.get(z) ?? rows.set(z, []).get(z)!).push({ x, c });
  }
  const zs = [...rows.keys()].sort((a, b) => a - b);
  type Run = { x0: number; x1: number; c: string };
  const runsOf = (z: number): Run[] => {
    const l = rows.get(z)!.sort((a, b) => a.x - b.x), out: Run[] = [];
    for (const q of l) {
      const last = out[out.length - 1];
      // parça tavanı: koşu dünya x'inin MAX_SPAN katlarında bölünür (satırlar aynı yerden bölünür → dikey birleşme bozulmaz)
      if (last && last.x1 === q.x && last.c === q.c && q.x % MAX_SPAN !== 0) last.x1 = q.x + 1; else out.push({ x0: q.x, x1: q.x + 1, c: q.c });
    }
    return out;
  };
  const open = new Map<string, Rect & { c: string }>();
  const out: (Rect & { c: string })[] = [];
  let prevZ: number | null = null;
  for (const z of zs) {
    const runs = runsOf(z), next = new Map<string, Rect & { c: string }>();
    for (const r of runs) {
      const k = `${r.x0},${r.x1},${r.c}`, o = open.get(k);
      if (o && prevZ === z - 1 && z % MAX_SPAN !== 0) { o.z1 = z + 1; next.set(k, o); open.delete(k); } else next.set(k, { x0: r.x0, x1: r.x1, z0: z, z1: z + 1, c: r.c });
    }
    for (const o of open.values()) out.push(o);
    open.clear();
    for (const [k, v] of next) open.set(k, v);
    prevZ = z;
  }
  for (const o of open.values()) out.push(o);
  return out;
}

/** Sahne kurucusunu ufuk önlüğüyle sarar (şehir sahneleri; scenes.ts). Bandı olmayan sahnede değişiklik yok. */
export function withHorizonGround(build: () => Built, pal: () => HorizonPalette, oceanY: number | null = null): () => Built {
  return () => {
    const b = build();
    if (!b.backdrop?.length) return b;
    const add = horizonGround(b, pal(), oceanY);
    return add.length ? { ...b, backdrop: [...b.backdrop, ...add] } : b;
  };
}
