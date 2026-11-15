/**
 * STUCK-FIX — WALK-STUCK-001 denetimi (başsız; scripts/walk_stuck.test.mjs ve scripts/walk_check.mjs kullanır). Saf: React/DOM yok.
 *
 * Çalışma zamanı döngüsünün aynısı: `stepAvatar` (climb) → `safeTick` (güvenlik ağı) → karo değişiminde merdiven bağı (InteriorRig:
 * `StairLink` → öteki kat, `snapStairArrival`, y = bağın y'si). Kurallar:
 *  - her iç mekân planında (açık yerler + şehir landmarkları) her merdiven hattı yukarı ve aşağı yürünür; hedef kata/karoya varılır,
 *    sonunda gömülü değil, hareket edebilir, kurtarma gerekmez;
 *  - boşluğun ağzına odadan yandan girilince alt katta basamağın üstüne varılır, gömülü/kilitli değil;
 *  - her basamaktan ve her sahnenin yükseltilmiş tırmanılabilir yüzeylerinden 8 yönde kenardan düşüş asla gömülü/kilitli bitmez.
 */
import { CITY_MAPS } from "../citymap/catalog";
import { openSites, EXPLORE_CATALOG } from "../interiors/catalog";
import { cityInteriorPlan, interiorPlan, stairFixturePlan, type InteriorLevel, type InteriorPlan, type StairLink } from "../interiors/generate";
import { arrivalFor } from "../interiors/sceneModel";
import { JUMP_APEX, STEP_H, standY } from "../physics/height";
import { buildWorld, SCENE_ORDER, tx, tz, type Built, type Tile } from "../scenes";
import { createAvatar, heightCtx, navGrid, stepAvatar, tileAt, walkable, type AvatarState, type MoveInput, type NavGrid } from "./controller";
import { canMove, createSafeState, EMBED_S, isEmbedded, placeAvatar, safeTick, snapStairArrival, type RescueTarget, type SafeState } from "./safeSpot";
import { WALK_AVATAR_RADIUS } from "./scale";

export const STUCK_DT = 1 / 60;
/** çalışma zamanı yarıçapı (WalkRig: max(WALK_AVATAR_RADIUS, 0,28 · humanScale), humanScale = 1) ve yürüme ölçeği yarıçapı */
export const STUCK_RADII: readonly number[] = [...new Set([Math.max(WALK_AVATAR_RADIUS, 0.28), WALK_AVATAR_RADIUS])];
const IDLE: MoveInput = { x: 0, y: 0 };
const FWD: MoveInput = { x: 0, y: 1 };
const kk = (t: Tile) => `${t[0]},${t[1]}`;

type PlanLike = { levels: readonly Pick<InteriorLevel, "key" | "built" | "stairs" | "portals">[] };

/** Bütün iç mekân planları: sahnelerin açık yerleri + şehir haritası landmarkları + şehirdeki Galata (seeThrough). */
export function stuckPlans(): [string, InteriorPlan][] {
  const out: [string, InteriorPlan][] = [];
  for (const scene of Object.keys(EXPLORE_CATALOG.scenes)) {
    for (const [site] of openSites(scene)) { const p = interiorPlan(scene, site); if (p) out.push([`${scene}:${site}`, p]); }
  }
  for (const map of Object.values(CITY_MAPS)) for (const d of map.districts) for (const lm of d.landmarks ?? []) {
    if (!lm.interior || !lm.door) continue;
    const p = cityInteriorPlan(map.id, `city_${map.id}__${d.id}__${lm.id}`, lm.interior, { tile: lm.door, out: [lm.door[0], lm.door[1] + 1], dir: [0, -1] }, lm.h);
    if (p) out.push([`city:${map.id}/${lm.id}`, p]);
  }
  out.push(["city:istanbul:galata_kulesi", cityInteriorPlan("istanbul", "galata_kulesi", "tower", { tile: [5, 5], out: [5, 6], dir: [0, 1] })]);
  // kule/teraslar asansörlü — merdiven fiziği aynı tariflerin merdivenli fikstürleriyle de sınanır
  for (const scene of Object.keys(EXPLORE_CATALOG.scenes)) for (const [site] of openSites(scene)) {
    const p = stairFixturePlan(scene, site);
    if (p && p.levels.some((lv) => lv.stairs.length)) out.push([`${scene}:${site}:merdiven`, p]);
  }
  return out;
}

/** İç mekân/dünya benzetimi (bkz. dosya başı). */
export class StuckSim {
  plan: PlanLike; R: number; st: SafeState = createSafeState(); rescues: RescueTarget[] = []; swaps = 0;
  li = 0; lv!: PlanLike["levels"][number]; nav!: NavGrid; avoid!: (i: number, j: number) => boolean;
  a: AvatarState; lastTile: Tile;
  constructor(plan: PlanLike, li: number, x: number, z: number, y = 0, R = STUCK_RADII[0]) {
    this.plan = plan; this.R = R;
    this.setLevel(li);
    this.a = createAvatar(x, z, 0, y);
    this.lastTile = tileAt(x, z);
  }
  setLevel(li: number) {
    this.li = li; this.lv = this.plan.levels[li]; this.nav = navGrid(this.lv.built);
    const av = new Set([...this.lv.stairs.map((s) => kk(s.tile)), ...this.lv.portals.map((p) => kk(p.tile))]);
    this.avoid = (i, j) => av.has(`${i},${j}`);
  }
  frame(yaw: number, input: MoveInput = FWD) {
    stepAvatar(this.nav, this.a, { dt: STUCK_DT, camYaw: yaw, input, climb: true, radius: this.R });
    const r = safeTick(this.st, { nav: this.nav, a: this.a, dt: STUCK_DT, input, radius: this.R, key: this.lv.key, avoid: this.avoid,
      entry: () => arrivalFor(this.plan.levels, this.li, this.li) });
    if (r) { this.rescues.push(r); placeAvatar(this.a, r); }
    const t = tileAt(this.a.x, this.a.z);
    if (kk(t) === kk(this.lastTile)) return;
    this.lastTile = t;
    const link = this.lv.stairs.find((s) => kk(s.tile) === kk(t));
    if (!link) return;
    const p = snapStairArrival(link, this.a.x, this.a.z);
    const h = this.a.heading;
    this.setLevel(link.to);
    this.a = createAvatar(p.x, p.z, h, link.y);
    this.lastTile = tileAt(p.x, p.z);
    this.swaps++;
  }
  idle(n: number) { for (let k = 0; k < n; k++) this.frame(0, IDLE); }
  /** karo merkezine yürü (kameraya göre ileri = hedef yönü); `untilLevel` katına geçince durur */
  go(t: Tile, max = 240, untilLevel = -1): boolean {
    for (let k = 0; k < max; k++) {
      if (untilLevel >= 0 && this.li === untilLevel) return true;
      const dx = tx(t[0]) - this.a.x, dz = tz(t[1]) - this.a.z;
      if (Math.hypot(dx, dz) < 0.06) return true;
      this.frame(Math.atan2(dx, dz));
    }
    return untilLevel >= 0 ? this.li === untilLevel : false;
  }
  embedded() { return isEmbedded(this.nav, this.a, this.R); }
  mobile() { return canMove(this.nav, this.a, this.R); }
}

export interface StairPair { id: string; plan: InteriorPlan; li: number; st: StairLink; back: StairLink | undefined }
/** Her yukarı bağ: plan, alt kat, bağ ve üst kattaki karşılık aşağı bağ. */
export function stairPairs(plans: readonly [string, InteriorPlan][]): StairPair[] {
  const out: StairPair[] = [];
  for (const [id, plan] of plans) plan.levels.forEach((lv, li) => {
    for (const st of lv.stairs) {
      if (st.dir !== "up") continue;
      const up = plan.levels[st.to];
      const back = up?.stairs.find((o) => o.dir === "down" && o.to === li && kk(o.tile) === kk(st.run[st.run.length - 2]));
      out.push({ id, plan, li, st, back });
    }
  });
  return out;
}

/** Yukarı ve aşağı tırmanış. */
export function checkStairClimbs(pairs: readonly StairPair[], radii = STUCK_RADII): { problems: string[]; climbs: number } {
  const bad: string[] = [];
  let climbs = 0;
  for (const R of radii) for (const { id, plan, li, st, back } of pairs) {
    const tag = `WALK-STUCK-001 ${id}#${li} r${R.toFixed(2)}`;
    const s = new StuckSim(plan, li, tx(st.stand[0]), tz(st.stand[1]), 0, R);
    s.idle(5);
    for (const t of st.run) if (!s.go(t, 240, st.to)) break;
    if (s.li !== st.to) bad.push(`${tag}: yukarı çıkılamadı (kat ${s.li}, ${s.a.x.toFixed(2)},${s.a.z.toFixed(2)} y ${s.a.y.toFixed(2)})`);
    else {
      s.go(st.run[st.run.length - 1]); s.idle(30);
      if (s.embedded() || !s.mobile()) bad.push(`${tag}: yukarı çıkışta gömülü/kilitli`);
      if (s.rescues.length) bad.push(`${tag}: yukarı çıkışta gereksiz kurtarma (${s.rescues.map((r) => r.reason)})`);
    }
    if (!back) { bad.push(`${tag}: üst katta karşılık aşağı bağ yok`); continue; }
    const d = new StuckSim(plan, st.to, tx(back.stand[0]), tz(back.stand[1]), 0, R);
    d.idle(5);
    d.go(back.tile, 240, li);
    if (d.li !== li) { bad.push(`${tag}: aşağı inilemedi (kat ${d.li})`); continue; }
    for (let k = st.run.length - 3; k >= 0; k--) d.go(st.run[k]);
    d.go(st.stand); d.idle(30);
    const end = tileAt(d.a.x, d.a.z);
    if (kk(end) !== kk(st.stand) || Math.abs(d.a.y) > 0.05) bad.push(`${tag}: aşağı inişte ayağa varılmadı (${kk(end)} y ${d.a.y.toFixed(2)})`);
    if (d.embedded() || !d.mobile()) bad.push(`${tag}: aşağı inişte gömülü/kilitli`);
    if (d.rescues.length) bad.push(`${tag}: aşağı inişte gereksiz kurtarma (${d.rescues.map((r) => r.reason)})`);
    climbs += 2;
  }
  return { problems: bad, climbs };
}

/** Boşluğun ağzına odadan yandan giriş → alt katta basamağın üstü. */
export function checkSideEntries(pairs: readonly StairPair[], radii = STUCK_RADII): { problems: string[]; cases: number } {
  const bad: string[] = [];
  let n = 0;
  for (const R of radii) for (const { id, plan, li, st, back } of pairs) {
    if (!back) continue;
    const nav = navGrid(plan.levels[st.to].built);
    const run = new Set(st.run.map(kk));
    const [mi, mj] = back.tile;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = mi + di, nj = mj + dj;
      if (run.has(`${ni},${nj}`) || !walkable(nav, ni, nj)) continue;
      const s = new StuckSim(plan, st.to, tx(ni), tz(nj), 0, R);
      s.idle(3);
      s.go(back.tile, 120, li);
      n++;
      const tag = `WALK-STUCK-001 ${id}#${st.to}→${li} yandan (${ni},${nj}) r${R.toFixed(2)}`;
      if (s.li !== li) { bad.push(`${tag}: geçiş olmadı`); continue; }
      const top = heightCtx(s.nav)!.hf.top[mj * plan.levels[li].built.width + mi];
      if (kk(tileAt(s.a.x, s.a.z)) !== kk(back.tile) || Math.abs(s.a.y - top) > 0.05) bad.push(`${tag}: basamağın üstüne varılmadı (y ${s.a.y.toFixed(2)})`);
      if (s.embedded()) bad.push(`${tag}: varışta gömülü`);
      s.idle(30);
      if (s.embedded() || !s.mobile()) bad.push(`${tag}: gömülü/kilitli`);
    }
  }
  return { problems: bad, cases: n };
}

export interface FallStats { cases: number; rescued: number }
/** Ortak düşüş taraması: 8 yön × adım süreleri, sonra bırak (EMBED_S + 0,25 sn); sonuç gömülü/kilitli olmamalı. */
export function fallSweep(make: () => StuckSim | null, tag: string, bad: string[], stats: FallStats, Ns: readonly number[] = [4, 10, 18]) {
  for (let h = 0; h < 8; h++) for (const N of Ns) {
    const s = make();
    if (!s) return;
    const yaw = (h * Math.PI) / 4;
    for (let k = 0; k < N; k++) s.frame(yaw);
    s.idle(Math.ceil((EMBED_S + 0.25) / STUCK_DT));
    stats.cases++;
    if (s.rescues.length) stats.rescued++;
    if (!Number.isFinite(s.a.x + s.a.z + s.a.y)) { bad.push(`${tag} h${h} N${N}: geçersiz konum`); continue; }
    if (s.embedded()) bad.push(`${tag} h${h} N${N}: gömülü bitti @${s.a.x.toFixed(2)},${s.a.z.toFixed(2)} y ${s.a.y.toFixed(2)}`);
    else if (!s.mobile()) bad.push(`${tag} h${h} N${N}: kilitli (hiçbir yöne gidemiyor)`);
  }
}

/** Her basamaktan (son basamak hariç: kat geçişi) 8 yönde düşüş. */
export function checkStairFalls(pairs: readonly StairPair[], Ns: readonly number[] = [4, 10, 18]): { problems: string[]; stats: FallStats } {
  const bad: string[] = [], stats = { cases: 0, rescued: 0 };
  for (const { id, plan, li, st } of pairs) {
    const lv = plan.levels[li], hc = heightCtx(navGrid(lv.built))!;
    st.run.slice(0, -1).forEach((t, k) => {
      const top = hc.hf.top[t[1] * lv.built.width + t[0]];
      fallSweep(() => new StuckSim(plan, li, tx(t[0]), tz(t[1]), top), `WALK-STUCK-001 ${id}#${li} basamak ${k + 1}`, bad, stats, Ns);
    });
  }
  return { problems: bad, stats };
}

/**
 * Sahnelerin yükseltilmiş tırmanılabilir yüzeyleri: basamak zinciriyle ya da zıplayarak (yükseliş ≤ STEP_H, zıplamada + JUMP_APEX)
 * zeminden çıkılabilen, kenarından düşülebilen (top > STEP_H) karolar — rampa/basamak blokları, sandık, alçak duvar, alçak çatı.
 * Sahne başına en çok `perScene` yüzey (belirlenimci yayılım).
 */
export function checkSceneSurfaces(scenes: readonly string[] = SCENE_ORDER, perScene = 10, Ns: readonly number[] = [4, 12]): { problems: string[]; stats: FallStats & { surfaces: number } } {
  const bad: string[] = [], stats = { cases: 0, rescued: 0, surfaces: 0 };
  for (const id of scenes) {
    const built: Built = buildWorld(id, 0, { teams: [], guests: 1 });
    const nav = navGrid(built), hc = heightCtx(nav);
    if (!hc) continue;
    const { width: w, depth: d } = built;
    const seen = new Map<number, number>(), q: [number, number, number][] = [];
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) if (walkable(nav, i, j)) { const y = hc.hf.floor[j * w + i]; seen.set(j * w + i, y); q.push([i, j, y]); }
    while (q.length) {
      const [i, j, y] = q.pop()!;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= d || seen.has(nj * w + ni)) continue;
        const s = standY(hc, ni, nj, y + JUMP_APEX);
        if (s === -Infinity) continue;
        seen.set(nj * w + ni, s); q.push([ni, nj, s]);
      }
    }
    const high = [...seen].filter(([k, y]) => hc.blocked[k] && y > STEP_H + 0.05).map(([k, y]) => [k % w, Math.floor(k / w), y] as const);
    stats.surfaces += high.length;
    const pick = high.length <= perScene ? high : Array.from({ length: perScene }, (_, k) => high[Math.floor((k * high.length) / perScene)]);
    const plan: PlanLike = { levels: [{ key: `world:${id}`, built, stairs: [], portals: [] }] };
    for (const [i, j, y] of pick) fallSweep(() => new StuckSim(plan, 0, tx(i), tz(j), y), `WALK-STUCK-001 ${id} (${i},${j}) y${y.toFixed(2)}`, bad, stats, Ns);
  }
  return { problems: bad, stats };
}

/** walk_check.mjs için tek giriş: bütün WALK-STUCK-001 kuralları (yarıçap başına tırmanış; düşüş taraması çalışma zamanı yarıçapında). */
export function checkWalkStuck(opts: { scenes?: readonly string[] } = {}) {
  const plans = stuckPlans();
  const pairs = stairPairs(plans);
  const climbs = checkStairClimbs(pairs);
  const side = checkSideEntries(pairs);
  const falls = checkStairFalls(pairs);
  const surf = checkSceneSurfaces(opts.scenes ?? SCENE_ORDER);
  return {
    problems: [...climbs.problems, ...side.problems, ...falls.problems, ...surf.problems],
    stats: { plans: plans.length, stairs: pairs.length, climbs: climbs.climbs, side: side.cases, falls: falls.stats.cases, surfaces: surf.stats.surfaces,
      surfaceCases: surf.stats.cases, rescued: falls.stats.rescued + surf.stats.rescued },
  };
}
