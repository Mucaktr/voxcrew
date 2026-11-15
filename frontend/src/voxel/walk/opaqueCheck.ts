/**
 * WORLD-FIX — CAMERA-OPAQUE-001 / OUTDOOR-OPAQUE-001: kamera açısı taraması (saf; three yok → walk_check ve node testi yükler).
 *
 * Kural: kesit YALNIZ kamerayla avatar arasındaki gerçek örtücüdür, her zaman bütün bloktur; bakılan model (avatarın arkası) hiç
 * kesilmez; katı blok yarım/saydam görünmez (gölgelendiricide parça başına kesit yok — `patchFragment` tek `discard`). Tarama,
 * WalkRig'in kullandığı aynı saf planla (`walkCutPlan`, `planCuts`) her sahnede örneklenmiş karolardan 8 yön × 3 eğim × 3 mesafe
 * (yakınlaştırma uçları dahil) üçüncü şahıs pozu ve yürüme dışı yörünge pozları kurar:
 *  - focus: atılan blok avatarın arkasında (görüş derinliği avatar + pay ötesinde) değil, çatı terimi hariç;
 *  - coverage: göğüs → kamera doğrusunu kesen (zemin üstü) her blok atılıyor; kamera bir bloğun içindeyse o blok atılıyor;
 *  - near: yakın düzlemden (`WALK_NEAR`) yakın kalan atılmamış blok yok;
 *  - orbit: yörünge kamerası bir bloğun içindeyse o blok atılıyor; atılan her blok kameranın yakın bölgesinde.
 * Karşılaştırma (eski kural, düzeltmeden önce): ekran dairesinin örtücü olmayan bloklara dokunması (`legacyWin`), çatı kesitinin
 * çatı dışı/çatıyı delip geçen bloğu yarım kesmesi (`legacyRoof`), 0,5 yakın düzlemde kesilen blok (`legacyNear`), yörüngede
 * kameranın blok içinde/yakın düzlemde kaldığı poz (`legacyOrbit`).
 */
import { coverGrid, navGrid, tileAt, walkable } from "./controller";
import { computeCutaway, NEAR_ZONE, nearBlocks, nearCuts, OPEN_MIN_Y, orbitCutPlan, planCuts, sideCuts, resolveFollowCam, roofCuts, segmentHitsBox, streetCuts, walkCutPlan,
  WALK_NEAR, WIN_RADIUS_PX } from "./cover";
import { CAM_FLOOR, FOLLOW_DIST, FOLLOW_MAX, FOLLOW_MIN, LOOK_DEFAULT, LOOK_MIN, LOOK_Y, orbitPose } from "./scale";
import { tx, tz, type Block, type Built } from "../scenes";
import { posedBlocks, SPIN_CHECK_ANGLES } from "../spin";
import { blockSource } from "../camera/world";
import { fitUnderCeiling, HEAD_CLEAR } from "../camera/ceiling";
import { collidable, probeRadius } from "../camera/collide";

type V3 = [number, number, number];
export interface OpaqueRow {
  scene: string; poses: number; occluded: number; roofPoses: number; cut: number; violations: number;
  /** INTERIOR-CAM: tavan sıkıştırmasının indirdiği poz ve avatarın tavanını/çatısını kesen poz (0 olmalı) */
  ceilClamped?: number; roofCut?: number;
  legacyWin: number; legacyRoof: number; legacyNear: number; nearResidual: number;
  orbitPoses: number; orbitNearPoses: number; orbitCut: number; legacyOrbit: number;
  /** dönen blok varsa denenen canlı poz sayısı (yoksa 0)*/
  spinPoses?: number;
}

const PITCHES = [LOOK_DEFAULT, LOOK_MIN, 0.35];
const DISTS = [FOLLOW_MIN, FOLLOW_DIST, FOLLOW_MAX];
const YAWS = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k * Math.PI) / 4);
const FOCUS_PAD = 0.35;
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const half = (b: Block): V3 => [b.s[0] / 2, b.s[1] / 2, b.s[2] / 2];
const inside = (p: readonly number[], b: Block) => Math.abs(p[0] - b.p[0]) <= b.s[0] / 2 && Math.abs(p[1] - b.p[1]) <= b.s[1] / 2 && Math.abs(p[2] - b.p[2]) <= b.s[2] / 2;
function boxDist(p: readonly number[], b: Block): number {
  let d2 = 0;
  for (let q = 0; q < 3; q++) { const e = Math.max(0, Math.abs(p[q] - b.p[q]) - b.s[q] / 2); d2 += e * e; }
  return Math.sqrt(d2);
}

/** Izgara kovaları (karo → blok dizinleri); dev plakalar (zemin/su) ayrı listede. */
function buckets(blocks: readonly Block[]) {
  const m = new Map<number, number[]>(), big: number[] = [];
  blocks.forEach((b, k) => {
    if (b.g === "cloud" || b.g === "snow") return;
    const x0 = Math.floor(b.p[0] - b.s[0] / 2), x1 = Math.floor(b.p[0] + b.s[0] / 2), z0 = Math.floor(b.p[2] - b.s[2] / 2), z1 = Math.floor(b.p[2] + b.s[2] / 2);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 64) { big.push(k); return; }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const key = (x + 4096) * 8192 + (z + 4096); const l = m.get(key); if (l) l.push(k); else m.set(key, [k]); }
  });
  return { m, big };
}
function query(ix: ReturnType<typeof buckets>, a: readonly number[], b: readonly number[], pad: number): number[] {
  const out = new Set<number>(ix.big);
  const x0 = Math.floor(Math.min(a[0], b[0]) - pad), x1 = Math.floor(Math.max(a[0], b[0]) + pad);
  const z0 = Math.floor(Math.min(a[2], b[2]) - pad), z1 = Math.floor(Math.max(a[2], b[2]) + pad);
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (const k of ix.m.get((x + 4096) * 8192 + (z + 4096)) ?? []) out.add(k);
  return [...out];
}

/** Bir sahnenin (taban dünya) kamera opaklık taraması. `stride`: karo örnekleme adımı. */
export function checkCameraOpaque(scene: string, built: Built, opts: { stride?: number; maxTiles?: number; orbit?: boolean; posed?: boolean } = {}): { problems: string[]; row: OpaqueRow } {
  // dönen (`spin`) bloklar canlı konumlarında denenir — her poz, gölgelendiricinin gördüğü döndürülmüş kutu sarmalayanıyla
  if (!opts.posed && built.blocks.some((b) => b.g === "spin" && b.r)) {
    let acc: { problems: string[]; row: OpaqueRow } | null = null;
    for (const ang of SPIN_CHECK_ANGLES) {
      const r = checkCameraOpaque(scene, { ...built, blocks: posedBlocks(built.blocks, ang) }, { ...opts, posed: true });
      if (!acc) acc = r;
      else {
        for (const k of Object.keys(r.row) as (keyof OpaqueRow)[]) if (typeof r.row[k] === "number") (acc.row[k] as number) += r.row[k] as number;
        acc.problems.push(...r.problems.slice(0, Math.max(0, 4 - acc.problems.length)));
      }
    }
    acc!.row.spinPoses = SPIN_CHECK_ANGLES.length;
    return acc!;
  }
  const problems: string[] = [];
  const row: OpaqueRow = { scene, poses: 0, occluded: 0, roofPoses: 0, cut: 0, violations: 0, ceilClamped: 0, roofCut: 0, legacyWin: 0, legacyRoof: 0, legacyNear: 0, nearResidual: 0,
    orbitPoses: 0, orbitNearPoses: 0, orbitCut: 0, legacyOrbit: 0 };
  const flag = (msg: string) => { row.violations++; if (problems.length < 4) problems.push(`${scene} ${msg}`); };
  const nav = navGrid(built), cover = coverGrid(built);
  const blocks = built.blocks;
  const ix = buckets(blocks);
  const src = blockSource(blocks);
  const radius = probeRadius(WALK_NEAR, 59, 1.6);
  const stride = opts.stride ?? 3, maxTiles = opts.maxTiles ?? 48;
  const tiles: [number, number][] = [];
  for (let j = 1; j < built.depth; j += stride) for (let i = (j % (2 * stride)) ? 1 : 2; i < built.width; i += stride) if (walkable(nav, i, j)) tiles.push([i, j]);
  // örtülü (çatı altı) karolar her zaman örneklenir: çatı terimi
  for (let j = 0; j < built.depth; j += 2) for (let i = 0; i < built.width; i += 2)
    if (walkable(nav, i, j) && cover.roofY[j * cover.width + i] !== Infinity) tiles.push([i, j]);
  const pick = tiles.length > maxTiles ? tiles.filter((_, k) => k % Math.ceil(tiles.length / maxTiles) === 0) : tiles;
  const kpx = 320 / Math.tan((38 * Math.PI) / 360); // 640 px yüksek tuval, 38° görüş açısı (eski ekran dairesi karşılaştırması)
  for (const [i, j] of pick) {
    const ax = tx(i), az = tz(j);
    const chest: V3 = [ax, LOOK_Y, az];
    for (const yaw of YAWS) for (const pitch of PITCHES) for (const dist of DISTS) {
      // WalkRig ile aynı kamera: yörünge → zemin payı → kısa engelde kısalma → duvar kıskacı → yakın kamera çözümü
      // (kaldırılmış / omuz üstü poz ya da göz; `resolveFollowCam`). Göz yedeğinde de üçüncü şahıs kesiti (yakın bölge + gövde).
      const P = orbitPose({ x: ax, y: LOOK_Y, z: az }, yaw, pitch, dist, { x: 0, y: 0, z: 0 });
      if (P.y < CAM_FLOOR) P.y = CAM_FLOOR;
      // INTERIOR-CAM: WalkRig ile aynı — avatarın üstünde tavan/çatı varsa kamera onun altına iner (çatı kesilmez)
      const cf = fitUnderCeiling(src, { x: ax, y: LOOK_Y, z: az }, P, { dist, pitch, radius, floorTop: 0.2, footY: 0 });
      if (cf.clamped) row.ceilClamped!++;
      const fc = resolveFollowCam(cover, { x: ax, z: az }, { x: ax, y: LOOK_Y, z: az }, P, { yaw, pitch: cf.pitch, dist, footY: 0, blocks, maxY: cf.maxY });
      const cam: V3 = [fc.x, fc.y, fc.z];
      row.poses++;
      const plan = walkCutPlan({ cover, avatar: { x: ax, z: az, foot: 0 }, chest, cam, first: false, rule: null, look: [fc.lx, fc.ly, fc.lz] });
      if (plan.roof) row.roofPoses++;
      const f = norm([fc.lx - fc.x, fc.ly - fc.y, fc.lz - fc.z]);
      const depth = (p: readonly number[]) => dot(sub(p, cam), f);
      const avDepth = depth(chest);
      const old = computeCutaway(cover, { x: ax, z: az }, { x: cam[0], y: cam[1], z: cam[2] }, { chestY: LOOK_Y, footY: 0 });
      let occ = false;
      const cand = new Set(query(ix, chest, cam, 1.6));
      if (plan.roof) for (const kk of query(ix, [plan.roof.rect[0], 0, plan.roof.rect[1]], [plan.roof.rect[2], 0, plan.roof.rect[3]], 0.5)) cand.add(kk);
      for (const kk of cand) {
        const b = blocks[kk];
        if (b.g === "cloud" || b.g === "snow") continue;
        const h = half(b);
        const cut = planCuts(plan, b);
        const onLine = segmentHitsBox(chest, cam, b.p, h);
        const roofCut = !!plan.roof && roofCuts(plan.roof.rect, plan.roof.cutY, b, { x: plan.roof.cx, z: plan.roof.cz });
        // gerçek örtücü: gövde → kamera doğrularını kesen ya da kameraya (yakın düzleme) değen blok
        const real = (plan.probes ? streetCuts(b, plan.probes, plan.cam, plan.minY) : false) || (!!plan.near && nearCuts(b, plan.near.at, plan.near.r, plan.minY))
          // yan kesit yalnız donatıyı (direk, taç) açar — duvar/cephe `sideProp` değil
          || (!!plan.side && !!plan.los && sideCuts(b, plan.cam, plan.los.at, plan.minY, plan.side, plan.fwd));
        if (cut) row.cut++;
        // INTERIOR-CEILING-001 (dış dünya): avatarın tepesindeki tavan/çatı bloğu hiçbir pozda atılmaz
        // (tavan = camera/ceiling.ts tanımı: çarpışmaya giren blok; ince kiriş, tel, lamba başı tavan değil — kabarcık onları açabilir)
        if (cut && b.p[1] - h[1] >= LOOK_Y + HEAD_CLEAR && Math.abs(ax - b.p[0]) <= h[0] && Math.abs(az - b.p[2]) <= h[2] && collidable(b, 0.2)) {
          row.roofCut!++;
          flag(`INTERIOR-CEILING-001: avatarın çatısı/tavanı kesitte atılıyor (${b.g} ${b.p.map((v) => v.toFixed(2)).join(",")} @${i},${j} yön ${yaw.toFixed(2)})`);
        }
        if (onLine && b.p[1] > plan.minY) occ = true;
        // gerçek örtücü dışında kesit yok (çatı terimi avatarın çatısında)
        if (cut && !real && !roofCut) flag(`CAMERA-OPAQUE-001: örtücü olmayan blok atılıyor (${b.g} ${b.p.map((v) => v.toFixed(2)).join(",")} @${i},${j})`);
        // bakılan model: avatarın arkasındaki blok hiç atılmaz
        const nearDepth = depth(b.p) - Math.abs(f[0]) * h[0] - Math.abs(f[1]) * h[1] - Math.abs(f[2]) * h[2];
        if (cut && !roofCut && nearDepth > avDepth + FOCUS_PAD) flag(`CAMERA-OPAQUE-001: avatarın arkasındaki blok atılıyor (${b.g} ${b.p.map((v) => v.toFixed(2)).join(",")} @${i},${j} yön ${yaw.toFixed(2)})`);
        // kapsam: göğüs → kamera doğrusunu kesen zemin üstü blok ve kamerayı içine alan blok atılıyor
        if (onLine && b.p[1] > plan.minY && !cut) flag(`OUTDOOR-OPAQUE-001: örtücü açılmadı (${b.g} ${b.p.map((v) => v.toFixed(2)).join(",")} @${i},${j})`);
        if (inside(cam, b) && b.p[1] > plan.minY && !cut) flag(`OUTDOOR-OPAQUE-001: kamera bloğun içinde, blok açılmadı (@${i},${j})`);
        // yakın düzlem
        const bd = boxDist(cam, b);
        if (bd < WALK_NEAR && !cut && b.p[1] > plan.minY) row.nearResidual++;
        if (bd < 0.5 && !onLine && b.p[1] > OPEN_MIN_Y) row.legacyNear++;
        // eski ekran dairesi: örtücü olmayan blok, avatarın önünde ve dairede
        if (old.window && !real && b.p[1] + h[1] > 0) {
          const dz = depth(b.p);
          if (dz > 0.05 && nearDepth < avDepth - 0.4) {
            const rel = sub(b.p, chest);
            // ekran uzayı (yaklaşık): görüş eksenine dik bileşen / derinlik
            const lat = Math.hypot(rel[0] - f[0] * dot(rel, f), rel[1] - f[1] * dot(rel, f), rel[2] - f[2] * dot(rel, f));
            if ((lat / dz) * kpx < WIN_RADIUS_PX + (Math.hypot(h[0], h[1], h[2]) / dz) * kpx) row.legacyWin++;
          }
        }
      }
      if (old.roof) {
        for (const kk of query(ix, [ax - 7, 0, az - 7], [ax + 7, 0, az + 7], 0)) {
          const b = blocks[kk];
          const top = b.p[1] + b.s[1] / 2, bot = b.p[1] - b.s[1] / 2;
          if (top <= old.cutY || Math.hypot(b.p[0] - ax, b.p[2] - az) - Math.hypot(b.s[0], b.s[2]) / 2 > old.radius) continue;
          const [bi, bj] = tileAt(b.p[0], b.p[2]);
          const roofTile = bi >= 0 && bj >= 0 && bi < cover.width && bj < cover.depth && cover.roofY[bj * cover.width + bi] !== Infinity;
          if (bot < old.cutY || !roofTile) row.legacyRoof++;
        }
      }
      if (occ) row.occluded++;
    }
  }
  if (opts.orbit !== false) checkOrbit(built, row, flag);
  return { problems, row };
}

/** Yörünge (yürüme dışı) kamerası: kamera bir bloğa girerse yalnız yakın bölgedeki bloklar bütün olarak açılır. */
function checkOrbit(built: Built, row: OpaqueRow, flag: (m: string) => void) {
  const nav = navGrid(built);
  const targets: V3[] = [[tx(0) + (built.width - 1) / 2, 0.4, tz(0) + (built.depth - 1) / 2]];
  for (let j = 2; j < built.depth && targets.length < 10; j += Math.max(2, Math.floor(built.depth / 4)))
    for (let i = 2; i < built.width && targets.length < 10; i += Math.max(2, Math.floor(built.width / 4))) if (walkable(nav, i, j)) targets.push([tx(i), 0.4, tz(j)]);
  for (const t of targets) for (let a = 0; a < 8; a++) for (const polar of [0.3, 0.8, 1.28]) for (const dist of [7, 10, 14]) {
    const az = (a * Math.PI) / 4;
    const cam: V3 = [t[0] + Math.sin(polar) * Math.sin(az) * dist, t[1] + Math.cos(polar) * dist, t[2] + Math.sin(polar) * Math.cos(az) * dist];
    row.orbitPoses++;
    const near = nearBlocks(built.blocks, cam);
    const f = norm(sub(t, cam));
    const r = norm([f[1] * 0 - f[2] * 1, f[2] * 0 - f[0] * 0, f[0] * 1 - f[1] * 0]);
    const u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const legacy = near.some((k) => { const b = built.blocks[k]; return inside(cam, b) || (boxDist(cam, b) < 0.5 && dot(sub(b.p, cam), f) > -0.5); });
    if (legacy) row.legacyOrbit++;
    if (!near.length) continue;
    row.orbitNearPoses++;
    const plan = orbitCutPlan(cam, f, r, u);
    for (const k of near) {
      const b = built.blocks[k];
      const cut = streetCuts(b, plan.probes!, plan.cam, plan.minY) || nearCuts(b, plan.near!.at, plan.near!.r, plan.minY);
      if (cut) row.orbitCut++;
      if (inside(cam, b) && b.p[1] > OPEN_MIN_Y && !cut) flag(`CAMERA-OPAQUE-001 yörünge: kamera bloğun içinde, blok açılmadı (${b.p.map((v) => v.toFixed(2)).join(",")})`);
      if (cut && boxDist(cam, b) > NEAR_ZONE + 0.6) flag(`CAMERA-OPAQUE-001 yörünge: uzak blok açıldı (${b.p.map((v) => v.toFixed(2)).join(",")})`);
    }
  }
}
