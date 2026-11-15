/**
 * giriş anı: doğma yönü.
 *
 * Avatar yürüme moduna girerken (sahne) ve şehir haritasına varınca **açık bir görüşe** bakmalı (Londra girişinde duvara
 * bakıyordu). Yön, yürüme ızgarasından belirlenimci olarak seçilir:
 * - 8 yön (45° adım; WalkRig kamera yaw'ı da 45°'ye oturur) için doğma karosundan **görüş ışını** atılır: göz bandını
 * kesen (zeminden tepesi ≥ `VIEW_BLOCK_H`, tabanı < `VIEW_UNDER_H`) ilk karoda ışın biter. Su, çim, alçak süs, ince direk
 * (lamba, ağaç gövdesi) ve yüksek tente açık sayılır.
 * - Puan: merkez ışın + iki yan ışının yarısı (±22,5°; meydan/geniş görüş), simge kadraj içindeyse ek puan (sahnenin
 * `landmark` bölgeleri ya da şehirde varışa yakın simgeler), arkada kamera payı (≤ 5 karo; < 2 karoda ceza: takip kamerası
 * duvarın içine düşmesin).
 * - Merkez ışını ≥ `VIEW_MIN_OPEN` olan yönler arasından en yüksek puan; eşitlikte bugünkü varsayılan (−z, yaw π) ve sonra
 * sabit sıra. Hiçbiri yoksa en uzun merkez ışın.
 *
 * Saf modül: React/three yok; sahne `Built`'i ve şehir haritası okunur, yazılmaz. Denetim: `frontend/scripts/wx14_entry.test.mjs`
 * (25 sahne + 7 şehir varışı). Yaw kuralı `controller.ts` `headingOf` ile aynı: ileri = (sin yaw, cos yaw) → (+i, +j).
*/
import { D, W, tx, tz, type Built, type SceneCore, type Tile } from "../scenes"; // tx, tz
import { components, coverGrid, fineWorld, navGrid, walkable } from "./controller";
import { PROP } from "../physics/world";
import { spawnFrame, SPAWN_FRAME_MAX } from "./spawnFrame";
import { steadyCam } from "./arrivalCam";
import { FOLLOW_DIST, LOOK_Y } from "./scale";
import { inLane, laneSegHits, moverLanes } from "./moverLanes"; // HQA-FIX

/** Kabul eşiği: bakış yönünde en az bu kadar açık karo.*/
export const VIEW_MIN_OPEN = 6;
/** Işın üst sınırı (karo): bundan uzun görüş aynı puanı alır. */
export const VIEW_RAY_CAP = 16;
/** Göz hizası: karo sütununun tepesi doğma zemininden bu kadar yüksekse görüşü kapatır (yürüme insanı 1,0). */
export const VIEW_BLOCK_H = 1.0;

/** 8 yön: k · 45°; yaw = k · π/4. (di, dj) = (round sin, round cos). */
export const VIEW_DIRS: readonly { yaw: number; di: number; dj: number }[] = Array.from({ length: 8 }, (_, k) => {
  const yaw = (k * Math.PI) / 4;
  return { yaw, di: Math.round(Math.sin(yaw)), dj: Math.round(Math.cos(yaw)) };
});
/** Bugünkü varsayılan bakış (−z): eşitlikte tercih edilir (davranış gereksiz yere değişmez). */
const DEFAULT_K = 4;
/** Arka (kamera) payının puana katkı üst sınırı (karo; takip mesafesi 4,6). */
const VIEW_BACK_CAP = 5;
/** Arkası (kamera tarafı) 2 karodan yakın kapalıysa ceza. */
const VIEW_BACK_PENALTY = 6;
/** Simge kadraj içindeyse ek puan (±30°; ±50° yarısı). */
export const VIEW_LANDMARK_BONUS = 8;

/** Görüş ızgarası: true açık, false kapalı, null ızgara dışı (ışın biter). */
export type SightFn = (i: number, j: number) => boolean | null;

export interface ViewChoice {
  /** seçilen yaw (k · π/4) — avatar yönü ve kamera yaw'ı */
  yaw: number;
  /** seçilen yönde merkez ışın (açık karo sayısı, en çok `VIEW_RAY_CAP`) */
  open: number;
  /** 8 yönün merkez ışınları (k sırasıyla) */
  rays: number[];
  /** simge kadraj içinde mi (seçilen yönde) */
  landmark: boolean;
  /** 8 yönün puanları (denetim/teşhis; eşiği geçmeyen yön de puanlanır) */
  scores: number[];
  /** ARRE: `fit` verildiyse simge merkezi kadrajın yarı açısı içinde kalacak biçimde döndürülmüş bakış (`yaw` ızgara yönü olarak kalır; kit yönü bununla eşleşir) */
  heading?: number;
  /** ARRE: simge ekranın hangi yanında (+1 sağ, −1 sol, 0 simge yok) — Hoş geldin kartı karşı yana yaslanır */
  side?: -1 | 0 | 1;
}

/** Merkez ışın: (di, dj) adımlarıyla açık karo sayısı. Çaprazda iki köşe karosu birden kapalıysa görüş sıkışır, biter. */
export function rayOpen(sight: SightFn, from: Tile, di: number, dj: number, cap = VIEW_RAY_CAP): number {
  let i = from[0], j = from[1], n = 0;
  while (n < cap) {
    if (di && dj && sight(i + di, j) === false && sight(i, j + dj) === false) break;
    i += di; j += dj;
    if (sight(i, j) !== true) break;
    n++;
  }
  return n;
}

/** Sürekli ışın (yan ışınlar, ±22,5°): yarım karo adımla örneklenir; dönüş karo cinsinden uzaklık. */
export function rayOpenAt(sight: SightFn, from: Tile, yaw: number, cap = VIEW_RAY_CAP): number {
  const sx = Math.sin(yaw), sz = Math.cos(yaw);
  for (let d = 0.5; d <= cap; d += 0.5) {
    const i = Math.floor(from[0] + 0.5 + sx * d), j = Math.floor(from[1] + 0.5 + sz * d);
    if (i === from[0] && j === from[1]) continue;
    if (sight(i, j) !== true) return Math.max(0, d - 0.5);
  }
  return cap;
}

/** ARRE: `fit` dönüşü ızgara yönünden en çok bu kadar (rad) sapar. 0,45 → 0,65 (~37°) — simgesi ızgara yönünden 34–45° yanda
 * olan şehirlerde (<city>, <city>, marakeş, <city>) dikeyde simge kenarda kalıyordu; yan ışınlar dönülen yönde ayrıca ölçülür.*/
export const FIT_ROT_MAX = 0.45;
/** simge merkezinden ön yüzüne pay (karo): kit simgesi en çok ~5 karo geniş*/
export const FIT_TARGET_DEPTH = 2.5;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Doğma yönü. `targets`: tercih edilen simge noktaları (karo koordinatı, merkez). Yön her zaman 8 yönden biridir.
 */
export function chooseView(sight: SightFn, from: Tile, targets: readonly (readonly [number, number])[] = [],
  fit?: { half: number; prefer?: readonly [number, number] }): ViewChoice {
  const rays = VIEW_DIRS.map((d) => rayOpen(sight, from, d.di, d.dj));
  const tgt = targets.map((t) => ({ yaw: Math.atan2(t[0] - from[0], t[1] - from[1]), dist: Math.hypot(t[0] - from[0], t[1] - from[1]) }))
    .filter((t) => t.dist >= 2);
  let best = -1, bestScore = -Infinity, bestLm = false;
  const score = (k: number): { s: number; lm: boolean } => {
    const yaw = VIEW_DIRS[k].yaw;
    const side = rayOpenAt(sight, from, yaw - Math.PI / 8) + rayOpenAt(sight, from, yaw + Math.PI / 8);
    // kamera payı: takip kamerası avatarın ~4,6 karo arkasında; arkası açıksa kesit/kıskaç gerekmez
    const back = Math.min(rays[(k + 4) % 8], VIEW_BACK_CAP);
    // simge kadrajda: ±30° içinde tam, ±50° içinde yarım puan (uzaktaki simge küçük görünür ama ufku taşır)
    let bonus = 0;
    for (const t of tgt) {
      const off = Math.abs(wrap(t.yaw - yaw));
      bonus = Math.max(bonus, off <= Math.PI / 6 ? VIEW_LANDMARK_BONUS : off <= (50 * Math.PI) / 180 ? VIEW_LANDMARK_BONUS / 2 : 0);
    }
    // arkası 2 karodan yakın duvar: kamera duvarın içine/kesitine düşer (Londra: meclis duvarı arkada) → ceza
    return { s: rays[k] + side / 2 + bonus + back - (back < 2 ? VIEW_BACK_PENALTY : 0), lm: bonus > 0 };
  };
  const order = [DEFAULT_K, ...VIEW_DIRS.map((_, k) => k).filter((k) => k !== DEFAULT_K)];
  const all = VIEW_DIRS.map((_, k) => score(k));
  for (const k of order) {
    if (rays[k] < VIEW_MIN_OPEN) continue;
    const { s, lm } = all[k];
    if (s > bestScore + 1e-9) { best = k; bestScore = s; bestLm = lm; }
  }
  if (best < 0) {
    // hiçbir yön eşiği geçmiyor: en uzun merkez ışın (eşitlikte varsayılan sıra)
    for (const k of order) if (best < 0 || rays[k] > rays[best]) best = k;
    bestLm = all[best].lm;
  }
  const yaw = VIEW_DIRS[best].yaw;
  const out: ViewChoice = { yaw, open: rays[best], rays, landmark: bestLm, scores: all.map((x) => Math.round(x.s * 10) / 10) };
  if (fit) {
    // ARRE: 8 yöne yuvarlanan yaw simgeyi ±30° içinde "tam puanla" bırakır; dikey ekranda yatay yarı açı ≈ 20° → simge kadraj kenarında.
    // Simge merkezi (varsa `prefer`, yoksa en yakın açılı hedef) `fit.half` içine girecek kadar döner (fitVpYaw örüntüsü); gerekmiyorsa heading = yaw.
    const pf = fit.prefer && Math.hypot(fit.prefer[0] - from[0], fit.prefer[1] - from[1]) >= 2 ? fit.prefer : null;
    const offOf = (t: { yaw: number }) => wrap(t.yaw - yaw);
    const pfT = pf ? { yaw: Math.atan2(pf[0] - from[0], pf[1] - from[1]), dist: Math.hypot(pf[0] - from[0], pf[1] - from[1]) } : null;
    // odak (kit simgesi) ±50° içindeyse her zaman o; değilse ±30° içindeki en yakın hedef
    const pick = pfT && Math.abs(offOf(pfT)) <= (50 * Math.PI) / 180 ? pfT : [...tgt].sort((a, b) => Math.abs(offOf(a)) - Math.abs(offOf(b))).find((t) => Math.abs(offOf(t)) <= Math.PI / 6);
    const o = pick ? offOf(pick) : 0;
    out.heading = yaw;
    out.side = 0;
    if (pick && Math.abs(o) > fit.half && rays[best] >= 6) { // ışın < 6 ise bakış zaten simgeye bağlı (arrival_check): dönmez
      // dönüş yeni yönde açık görüşü bozmasın (duvara/dar boşluğa bakmasın): hedef ofseti half, sonra biraz daha dışarı/içeri denenir
      const need = Math.min(rays[best], 7);
      // merkez ışın simgeye dönünce simgenin KENDİSİNE çarpar (kit simgesi ~6,7 karoda, ön yüzü ~4,5) — hedefin önüne kadar açık yeter
      const needC = Math.min(need, Math.max(2, pick.dist - FIT_TARGET_DEPTH));
      for (const f of [1.25, 1, 0.7, 0.4]) {
        const want = pick.yaw - Math.sign(o) * fit.half * f, dev = wrap(want - yaw);
        if (Math.abs(dev) > FIT_ROT_MAX) continue; // tam sığmıyorsa kısmi dönüş yok: simge yine kenarda kalır, ama yön/engel ölçüleri bozulmaz
        const h = wrap(yaw + dev); // dönüş en çok FIT_ROT_MAX: aynı sekizlik dilimde kalır (merkez/yan ışın ölçüleri geçerli)
        // simge tarafındaki yan ışın da simgeye çarpar (kapadokya peri bacaları 5 karoda): o yanda da hedefin önüne kadar açık yeter
        const needL = o < 0 ? Math.min(need - 2, needC) : need - 2, needR = o > 0 ? Math.min(need - 2, needC) : need - 2;
        if (rayOpenAt(sight, from, h) >= needC && rayOpenAt(sight, from, h - 0.3) >= needL && rayOpenAt(sight, from, h + 0.3) >= needR) { out.heading = h; break; }
      }
    }
    // ekran sağı = (−cos h, sin h) (xz); hedef yönü (sin t, cos t) → nokta çarpımı sin(h − t)
    if (pick) out.side = Math.sin(out.heading - pick.yaw) >= 0 ? 1 : -1;
  }
  return out;
}

// ------------------------------------------------------------------------------------------ sahne
/** Görüşü kapatmayan ince direk: xz izdüşümünün uzun kenarı bundan kısaysa (sokak lambası, ağaç gövdesi, tabela direği). */
export const VIEW_THIN = 0.5;
/** Bu yükseklikten (zeminden) yukarıda başlayan blok göz bandının üstündedir (tente, kemer, ağaç tacı altı açık). */
export const VIEW_UNDER_H = 1.2;
const VIEW_GROUPS = new Set(["solid", "glass", "glow"]);
const sightCache = new WeakMap<object, Map<number, Uint8Array>>();

/**
 * Sahne görüş ızgarası: karo merkezi bloğun xz izdüşümündeyse (örtü ızgarasıyla aynı kural) ve blok göz bandını kesiyorsa
 * (zeminden tepesi ≥ `VIEW_BLOCK_H`, tabanı < `VIEW_UNDER_H`) karo kapalıdır. İnce direkler (`VIEW_THIN`) görüşü kapatmaz.
 * Zemin: doğma karosunun zemin yüksekliği (örtü ızgarası). Izgara (sahne, zemin) başına önbellekli.
 */
export function sceneSight(built: Pick<Built, "width" | "depth" | "blocks">, from: Tile): SightFn {
  const cover = coverGrid(built);
  const { width, depth } = built;
  const inGrid = (i: number, j: number) => i >= 0 && j >= 0 && i < width && j < depth;
  const g0 = inGrid(from[0], from[1]) ? cover.height[from[1] * cover.width + from[0]] : 0;
  let per = sightCache.get(built);
  if (!per) { per = new Map(); sightCache.set(built, per); }
  let closed = per.get(g0);
  if (!closed) {
    closed = new Uint8Array(width * depth);
    const hw = W / 2, hd = D / 2;
    for (const b of built.blocks) {
      if (!VIEW_GROUPS.has(b.g) || Math.max(b.s[0], b.s[2]) < VIEW_THIN) continue;
      const bottom = b.p[1] - b.s[1] / 2 - g0, top = b.p[1] + b.s[1] / 2 - g0;
      if (top < VIEW_BLOCK_H || bottom >= VIEW_UNDER_H) continue;
      const i0 = Math.max(0, Math.ceil(b.p[0] - b.s[0] / 2 + hw - 0.5 - 1e-6)), i1 = Math.min(width - 1, Math.floor(b.p[0] + b.s[0] / 2 + hw - 0.5 + 1e-6));
      const j0 = Math.max(0, Math.ceil(b.p[2] - b.s[2] / 2 + hd - 0.5 - 1e-6)), j1 = Math.min(depth - 1, Math.floor(b.p[2] + b.s[2] / 2 + hd - 0.5 + 1e-6));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) closed[j * width + i] = 1;
    }
    per.set(g0, closed);
  }
  const c = closed;
  return (i, j) => (inGrid(i, j) ? c[j * width + i] === 0 : null);
}

/** Sahnenin simgeleri: `landmark` bölgelerinin merkezleri (karo); yoksa çekirdek merkezi (çekirdek bütün taban değilse). */
export function sceneLandmarks(built: Pick<Built, "zones" | "modules">, core: SceneCore | null = null): [number, number][] {
  const zones = (built.zones ?? []).filter((z) => z.kind === "landmark");
  if (zones.length) return zones.map((z) => [z.i0 + (z.w - 1) / 2, z.j0 + (z.d - 1) / 2]);
  if (!core) return [];
  const m = built.modules?.find((x) => x.base);
  const bw = m?.w ?? 24, bd = m?.d ?? 16, oi = m?.base ? m.i0 : 0, oj = m?.base ? m.j0 : 0;
  if (core.w >= bw - 2 && core.d >= bd - 2) return [];
  return [[oi + core.i0 + (core.w - 1) / 2, oj + core.j0 + (core.d - 1) / 2]];
}

/** Sahne girişinin bakış yaw'ı (WalkRig `spawnPose` için). */
export function sceneSpawnView(built: Pick<Built, "width" | "depth" | "blocks" | "zones" | "modules">, tile: Tile, core: SceneCore | null = null): ViewChoice {
  return chooseView(sceneSight(built, tile), tile, sceneLandmarks(built, core));
}

/** Doğma karosundan en çok bu kadar (Chebyshev) kaydırılır — yalnız hiçbir yön eşiği geçmiyorsa. */
export const SPAWN_NUDGE_MAX = 5; // ARRIVAL-QA: 3 → 5 — yalnız 3 karo içinde açık kare yoksa daha uzağa bakılır

export interface SpawnView extends ViewChoice {
  tile: Tile;
  /** karo eşik için kaydırıldı mı */
  nudged: boolean;
  /** UXF-B: giriş karesinin avatar önündeki bloklarla kaplı oranı (`spawnFrame.ts`); ölçülmediyse yok*/
  frame?: number;
}

/**
 * UXF-B: bir karoda kamera tarafı da açık yön — önce seçtiği yön, sonra eşiği geçen (≥ `VIEW_MIN_OPEN`) öteki
 * yönler (arkası en az 2 karo açık: kamera duvara gömülmez) puan sırasıyla; giriş karesi engeli `SPAWN_FRAME_MAX`'ı geçmeyen ilk yön. Yoksa null (`best`: en az engelli aday).
*/
interface FrameBest { v: SpawnView | null; seen: { v: SpawnView; quick: number }[] }

/**
 * (UX-SWEEP-4 <city> koyu pano / Londra sütunu): kare ölçüsü (`spawnFrame`) eşiği geçen ama canlıda kötü görünen
 * iki durum. (1) Kamera kısa kolda — arkadaki şemsiye/tente takip kamerasını avatarın 2 birim arkasına çekiyor; o zaman avatarın
 * önündeki her şey kocaman (<city>: 2,6 birim öndeki 2,25 boyunda koyu pano karenin solunu kaplıyor). (2) Avatarın hemen önünde,
 * yanında uzun bir gövde (Londra: 1 adım önde 6,9 boyunda sütun). Seçim önce ikisinden de temiz pozu arar; bulunmazsa eski kural.
*/
export const SPAWN_ARM_MIN = 0.8;
/** Kameranın avatarın tam arkasından en çok bu kadar (rad) sapması. */
export const SPAWN_BEHIND_MAX = (35 * Math.PI) / 180;
/** Ön koridor: avatarın `SPAWN_NEAR_AHEAD` birim önüne dek, iki yana `SPAWN_NEAR_SIDE`; tepesi `SPAWN_NEAR_TOP` üstündeki kalın blok. */
export const SPAWN_NEAR_AHEAD = 3;
export const SPAWN_NEAR_SIDE = 1.6;
export const SPAWN_NEAR_TOP = 1.8;
const SPAWN_NEAR_THICK = 0.25;
/**
 * Kamera kolu takip boyunun en az `SPAWN_ARM_MIN`'i mi (göğüsten kameraya). Ölçü WalkRig'in sabit durum kamerası (`arrivalCam.ts
 * steadyCam`: ortam profili + yaylı kol küre süpürmesi) — kare ölçüsünün örtü ızgarası şemsiye/tente kanadını görmüyordu.
 */
export function spawnArmLong(built: Built, x: number, z: number, yaw: number): boolean {
  const sc = steadyCam(built)(x, z, yaw);
  if (!sc) return false;
  // kamera avatarın arkasında kalmalı (omuz üstü/yan yedeğe düşen kamera avatarı yandan gösterir: kare "temiz" ama giriş yönü kaybolur)
  const bx = sc.cam[0] - x, bz = sc.cam[2] - z, bl = Math.hypot(bx, bz);
  if (bl < 1e-3 || (-bx * Math.sin(yaw) - bz * Math.cos(yaw)) / bl < Math.cos(SPAWN_BEHIND_MAX)) return false;
  return Math.hypot(bx, sc.cam[1] - LOOK_Y, bz) >= FOLLOW_DIST * SPAWN_ARM_MIN;
}
/** Avatarın önündeki koridorda uzun, kalın bir blok (direk/sütun/pano gövdesi) var mı. */
export function spawnNearTall(built: Pick<Built, "blocks">, x: number, z: number, yaw: number): boolean {
  const fx = Math.sin(yaw), fz = Math.cos(yaw), R = SPAWN_NEAR_AHEAD + SPAWN_NEAR_SIDE;
  for (const b of built.blocks) {
    if (b.g !== undefined && b.g !== "solid" && b.g !== "glass") continue;
    if (b.p[1] + b.s[1] / 2 < SPAWN_NEAR_TOP || b.p[1] - b.s[1] / 2 > 0.6 || Math.max(b.s[0], b.s[2]) < SPAWN_NEAR_THICK) continue;
    const dx = b.p[0] - x, dz = b.p[2] - z;
    if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
    const along = dx * fx + dz * fz, side = Math.abs(-dx * fz + dz * fx);
    const half = (Math.abs(fz) * b.s[0] + Math.abs(fx) * b.s[2]) / 2;
    if (along > 0.2 && along < SPAWN_NEAR_AHEAD && side - half < SPAWN_NEAR_SIDE) return true;
  }
  return false;
}
/** sıkı geçişte (`clean`) eşik + uzun kol + ön koridor temiz.*/
function cleanPose(built: Built, tile: Tile, yaw: number): boolean {
  const x = tx(tile[0]), z = tz(tile[1]);
  return !spawnNearTall(built, x, z, yaw) && spawnArmLong(built, x, z, yaw);
}

/**
 * HQA-FIX — doğma kamerası (sabit durum takip kamerası, `steadyCam`) bir taşıt şeridinin hacminde mi ya da avatara bakışı
 * şeritten mi geçiyor. <city>: doğma yönü kameranın arkasını kanala koyuyordu; vapur geçince kare koyu kırmızı gövdeyle doluyordu
 * (kamera vapurun içinde). Statik kare ölçüsü (`spawnFrame`) taşıtları görmez.
*/
export function spawnLaneBlocked(built: Built, tile: Tile, yaw: number): boolean {
  const lanes = moverLanes(built);
  if (!lanes.length) return false;
  const x = tx(tile[0]), z = tz(tile[1]);
  const c = steadyCam(built)(x, z, yaw);
  const cam = c ? { x: c.cam[0], y: c.cam[1], z: c.cam[2] } : { x: x - Math.sin(yaw) * FOLLOW_DIST, y: 1.6, z: z - Math.cos(yaw) * FOLLOW_DIST };
  return !!inLane(lanes, cam, 0.35) || laneSegHits(lanes, cam, { x, y: LOOK_Y + 0.4, z }) > 0;
}

function framedAt(built: Built, tile: Tile, v: ViewChoice, nudged: boolean, best: FrameBest, clean = false): SpawnView | null {
  const k0 = VIEW_DIRS.findIndex((d) => Math.abs(d.yaw - v.yaw) < 1e-9);
  const ks = VIEW_DIRS.map((_, k) => k).filter((k) => k !== k0 && v.rays[k] >= VIEW_MIN_OPEN && v.rays[(k + 4) % 8] >= 2).sort((a, b) => v.scores[b] - v.scores[a] || a - b);
  for (const k of [k0, ...ks]) {
    const yaw = VIEW_DIRS[k].yaw;
    if (!yawOk(tile, yaw)) continue;
    // önce karo ortasında kaba tarama (ucuz), eşiği geçerse kaymalı tam ölçü (en kötüsü)
    const quick = spawnFrame(built, tile, yaw, { jitter: false, coarse: true, strict: true }).frac; // ARRIVAL-QA: strict
    const out: SpawnView = { ...v, yaw, open: v.rays[k], landmark: k === k0 ? v.landmark : false, tile, nudged, frame: quick };
    if (quick <= SPAWN_FRAME_MAX) {
      const fr = spawnFrame(built, tile, yaw, { strict: true });
      out.frame = fr.frac;
      if (out.frame <= SPAWN_FRAME_MAX && (!clean || cleanPose(built, tile, yaw)) && !spawnLaneBlocked(built, tile, yaw)) return out; // HQA-FIX
    }
    best.seen.push({ v: out, quick });
  }
  return null;
}

/** Hiçbir aday eşiği geçmediyse: seçimi ve kaba ölçüde en iyi beş aday tam ölçülür, en az engelli seçilir.*/
function leastFramed(built: Built, best: FrameBest): SpawnView | null {
  // kendi seçimi (ilk aday) her zaman karşılaştırılır: düzeltme hiçbir sahnede girişi kötüleştirmez
  const first = best.seen[0];
  const rest = best.seen.filter((c) => c !== first && c.v.open >= VIEW_MIN_OPEN).sort((a, b) => a.quick - b.quick).slice(0, 5);
  const top = (first ? [first, ...rest] : rest).filter((c) => yawOk(c.v.tile, c.v.yaw));
  let pick: SpawnView | null = null;
  for (const c of top) {
    const frame = spawnFrame(built, c.v.tile, c.v.yaw, { strict: true }).frac + (spawnLaneBlocked(built, c.v.tile, c.v.yaw) ? 1 : 0); // HQA-FIX
    if (!pick || frame < pick.frame! - 1e-9) pick = { ...c.v, frame };
  }
  return pick;
}

/**
 * Sahne doğma pozu: önce verilen karoda yön seçilir; hiçbir yön `VIEW_MIN_OPEN`'a ulaşmıyorsa (köşedeki dinlenme noktası) en
 * çok `SPAWN_NUDGE_MAX` karo içindeki, ana bileşende, istasyon ve süs eşyası dışı en yakın karoya kaydırılır (eşitlikte daha
 * açık görüş). `keep`: kayıtlı konum — kaydırılmaz, yalnız yön seçilir.
 */
export function sceneSpawnPose(built: Built, tile: Tile, core: SceneCore | null = null, keep = false, rules: SpawnRules | null = null): SpawnView {
  // `rules` — izinli karo (geçitten uzak) ve yön (geçide sırt dönük). Eskiden WalkRig karoyu/yönü bu aramadan
  // SONRA kareye bakmadan değiştiriyordu (en yakın uzak karo, en açık ışın): giriş karesi tente/direk/duvar ya da portal kaplı kalıyordu;
  // artık aynı kadraj araması yalnız izinli karo ve yönlerde yapılır
  if (rules) {
    // kurallı arama yalnız eşiği geçen pozu döndürür; bulamazsa kuralsız eski arama (WalkRig sonra kaydırır/çevirir)
    spawnRules = rules;
    try {
      const v = spawnPoseSearch(built, tile, core, keep, true) ?? spawnPoseSearch(built, tile, core, keep, false, false);
      if (v) return v;
      // eşiği geçen yok: kurallı en az engelli poz (geçit kuralı kadrajdan önce gelir)
      return spawnPoseSearch(built, tile, core, keep, false)!;
    } finally { spawnRules = null; }
  }
  // önce kamera kolu uzun ve ön koridoru temiz poz (aynı arama), yoksa eski kural
  return spawnPoseSearch(built, tile, core, keep, true) ?? spawnPoseSearch(built, tile, core, keep, false)!;
}
/** doğma aramasının izinli karo ve yönleri (WalkRig `spawnPose`: geçit kuralları).*/
export interface SpawnRules { tile?: (i: number, j: number) => boolean; yaw?: (tile: Tile, yaw: number) => boolean }
let spawnRules: SpawnRules | null = null;
const tileOk = (i: number, j: number) => !spawnRules?.tile || spawnRules.tile(i, j);
const yawOk = (tile: Tile, yaw: number) => !spawnRules?.yaw || spawnRules.yaw(tile, yaw);


function spawnPoseSearch(built: Built, tile: Tile, core: SceneCore | null, keep: boolean, clean: boolean, least = true): SpawnView | null {
  const here = sceneSpawnView(built, tile, core);
  // UXF-B: açık bakışın yanında kamera tarafı da açık olmalı — önce bu karoda başka bir açık yön, sonra kaydırma
  const best: FrameBest = { v: null, seen: [] };
  if (keep) return framedAt(built, tile, here, false, best, clean) ?? (clean || !least ? null : leastFramed(built, best) ?? { ...here, tile, nudged: false });
  if (here.open >= VIEW_MIN_OPEN && tileOk(tile[0], tile[1])) {
    const ok = framedAt(built, tile, here, false, best, clean);
    if (ok) return ok;
  }
  const nav = navGrid(built);
  const { labels, main } = components(built);
  const fine = fineWorld(nav);
  const st = new Set(built.stations.map((s) => `${s.tile[0]},${s.tile[1]}`));
  const ok = (i: number, j: number) => walkable(nav, i, j) && labels[j * nav.width + i] === main && !st.has(`${i},${j}`)
    && (!fine || fine.kind[j * fine.width + i] !== PROP) && tileOk(i, j);
  for (let r = 1; r <= SPAWN_NUDGE_MAX; r++) {
    // halka: en yakın karo önce (eşitlikte daha açık görüş), her karoda kamera tarafı da açık yön aranır
    const ring: { t: Tile; v: ViewChoice; d: number }[] = [];
    for (let j = tile[1] - r; j <= tile[1] + r; j++) for (let i = tile[0] - r; i <= tile[0] + r; i++) {
      if (Math.max(Math.abs(i - tile[0]), Math.abs(j - tile[1])) !== r || !ok(i, j)) continue;
      const v = sceneSpawnView(built, [i, j], core);
      if (v.open < VIEW_MIN_OPEN) continue;
      ring.push({ t: [i, j], v, d: (i - tile[0]) ** 2 + (j - tile[1]) ** 2 });
    }
    ring.sort((a, b) => a.d - b.d || b.v.open - a.v.open || a.t[1] - b.t[1] || a.t[0] - b.t[0]);
    for (const c of ring) {
      const hit = framedAt(built, c.t, c.v, true, best, clean);
      if (hit) return hit;
    }
  }
  // ARRIVAL-QA: hiçbir aday eşiği geçmedi — arka payı (≥ 2 karo) şartı olmadan aynı halkalarda açık bakışlı (≥ 6) yönler
  // denenir (kamera yaylı kolu kısa arkada da kadrajı temiz tutabiliyor: <city>); en yakın karo önce
  for (let r = 0; r <= SPAWN_NUDGE_MAX; r++) {
    for (let j = tile[1] - r; j <= tile[1] + r; j++) for (let i = tile[0] - r; i <= tile[0] + r; i++) {
      if (Math.max(Math.abs(i - tile[0]), Math.abs(j - tile[1])) !== r || !ok(i, j)) continue;
      const v = sceneSpawnView(built, [i, j], core);
      for (let k = 0; k < VIEW_DIRS.length; k++) {
        if (v.rays[k] < VIEW_MIN_OPEN) continue;
        const yaw = VIEW_DIRS[k].yaw;
        if (!yawOk([i, j], yaw)) continue;
        if (spawnFrame(built, [i, j], yaw, { jitter: false, coarse: true, strict: true }).frac > SPAWN_FRAME_MAX) continue;
        const fr = spawnFrame(built, [i, j], yaw, { strict: true }), frame = fr.frac;
        if (frame <= SPAWN_FRAME_MAX && (!clean || cleanPose(built, [i, j], yaw))) return { ...v, yaw, open: v.rays[k], landmark: false, tile: [i, j], nudged: r > 0, frame };
      }
    }
  }
  // hiçbir aday eşiği geçmedi: en az engelli açık bakış (yoksa bugünkü seçim); sıkı geçişte null (eski kurala düşülür)
  if (clean || !least) return null;
  return leastFramed(built, best) ?? { ...here, tile, nudged: false };
}
