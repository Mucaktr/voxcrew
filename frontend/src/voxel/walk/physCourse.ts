/**
 * WALK-PHYS — basamak/zıplama/tırmanma deneme parkuru ve belirlenimci benzetim (walk_check JUMP/node testleri).
 * Saf: yalnız `Builder` ve denetleyici işlevleri; çizim yok. Parkur (24 × 16, zemin y = 0; avatar z = 8 boyunca +x yürür):
 * - i 3–4: 0,25'lik basamak plakası (yürünebilir karo; zemin 0,25 → kendiliğinden çıkılır)
 * - i 6: park bankı (oturak 0,47; yürünebilir karoda eşya → yalnız zıplayarak)
 * - i 10: alçak duvar (0,8; engelli karo → zıplayarak üstüne)
 * - i 14: yüksek duvar (2,2; engelli → hiçbir zıplamayla geçilmez)
 * - i 18 sandık (0,8) → i 19 alçak çatı (1,6): yığın zinciri (sandıktan zıplayınca çatıya)
 * - i 21–22: 0,3'lük kürsü (engelli karo, basamakla çıkılır → tıkla-git üstüne rota bulur)
 * - (3, 12): kemer (tabanı 1,3) — zıplama tepesi tavanın altında kalır
*/
import { Builder, tx, tz, type Built } from "../scenes";
import { createAvatar, navGrid, planRoute, setRoute, stepAvatar, type AvatarState } from "./controller";
import { WALK_AVATAR_RADIUS } from "./scale";

export const COURSE_Z = 8;
export const COURSE = { step: [3, 4], bench: 6, lowWall: 10, tallWall: 14, crate: 18, roof: 19, dais: [21, 22], arch: [3, 12] } as const;

export function physCourse(): Built {
  const b = new Builder(7);
  b.ground(() => "#8FBF6A", "#6B4F3A", 0);
  // basamak plakası (iki karo, z 7–9)
  for (const i of COURSE.step) for (let j = 7; j <= 9; j++) b.box(tx(i), 0.125, tz(j), 1, 0.25, 1, "#B9B2A6", "solid", 0);
  // park bankı (z 7–9, üç karo; sırt +z kenarında)
  for (let j = 7; j <= 9; j++) b.parkBench(COURSE.bench, j, 1, "+z");
  // alçak duvar (z 4–12) ve yüksek duvar (z 2–14)
  for (let j = 4; j <= 12; j++) { b.cube(COURSE.lowWall, j, 0, "#A8A29E", 0.8, "solid", 0); b.block(COURSE.lowWall, j); }
  for (let j = 2; j <= 14; j++) { b.cube(COURSE.tallWall, j, 0, "#78716C", 2.2, "solid", 0); b.block(COURSE.tallWall, j); }
  // sandık → alçak çatı
  for (let j = 7; j <= 9; j++) {
    b.crate(tx(COURSE.crate), 0, tz(j), 0.9); b.block(COURSE.crate, j);
    b.cube(COURSE.roof, j, 0, "#C2410C", 1.6, "solid", 0); b.block(COURSE.roof, j);
  }
  // kürsü (basamak yüksekliğinde engel)
  for (const i of COURSE.dais) for (let j = 7; j <= 9; j++) { b.cube(i, j, 0, "#D6D3D1", 0.3, "solid", 0); b.block(i, j); }
  // kemer: (3, 12) üstünde taban 1,3 olan levha, iki yanında ayaklar
  b.box(tx(COURSE.arch[0]), 1.4, tz(COURSE.arch[1]), 1, 0.2, 1, "#9CA3AF", "solid", 0);
  for (const di of [-1, 1]) { b.cube(COURSE.arch[0] + di, COURSE.arch[1], 0, "#9CA3AF", 1.5, "solid", 0); b.block(COURSE.arch[0] + di, COURSE.arch[1]); }
  b.rest.push([1, 1]);
  return b.done();
}

export interface SimFrame { x: number; z: number; y: number; grounded: boolean }
export interface SimScript {
  /** başlangıç (dünya x, z) */
  from: [number, number];
  frames: number;
  /** ileri girdi (0–1) ve kamera yaw'ı (ileri = (sin, cos)); varsayılan +x */
  forward?: number;
  yaw?: number;
  run?: boolean;
  /** bu karelerde zıpla */
  jumps?: readonly number[];
  /** bu kareden sonra girdi bırakılır (durur) */
  stopAt?: number;
  dt?: number;
  /** tıkla-git hedefi (karo); verilirse girdi yok */
  target?: [number, number];
  /** başlangıç ayak yüksekliği (engelin üstünden başlarken) */
  y?: number;
}

/** Belirlenimci benzetim: sabit adım (varsayılan 1/60), yürüme ölçeği yarıçapı, `climb: true`. Kare başına iz döner. */
export function simulate(built: Built, sc: SimScript): { trace: SimFrame[]; avatar: AvatarState } {
  const nav = navGrid(built);
  const a = createAvatar(sc.from[0], sc.from[1], Math.PI / 2, sc.y ?? 0);
  const dt = sc.dt ?? 1 / 60, yaw = sc.yaw ?? Math.PI / 2, fwd = sc.forward ?? 1;
  const jumps = new Set(sc.jumps ?? []);
  if (sc.target) setRoute(a, planRoute(built, a, sc.target, { climb: true }));
  const trace: SimFrame[] = [];
  for (let f = 0; f < sc.frames; f++) {
    const go = !sc.target && (sc.stopAt === undefined || f < sc.stopAt);
    stepAvatar(nav, a, { dt, camYaw: yaw, input: { x: 0, y: go ? fwd : 0 }, run: sc.run, climb: true, jump: jumps.has(f), radius: WALK_AVATAR_RADIUS });
    trace.push({ x: a.x, z: a.z, y: a.y, grounded: a.grounded });
  }
  return { trace, avatar: a };
}

/** Parkurdaki bir karonun dünya x merkezi (z = COURSE_Z). */
export const courseX = (i: number) => tx(i);
export const courseZ = () => tz(COURSE_Z);
