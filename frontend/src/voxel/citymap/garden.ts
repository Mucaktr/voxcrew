/**
 * TOUR-VIEW (§8 F1, LANDMARK-GARDEN-001) — landmark bahçe/avlu karoları (saf; React/three yok).
 *
 * Bir landmarkın yürünür iç alanı tasarım katmanında (`LandmarkModel.garden`) tanımlanır; hangi karonun gerçekten yürünür
 * olduğu modelin kendi yakın bloklarından çıkar: aday dikdörtgendeki karonun ortası (±0,3) yürüme bandında (0,15…1,7) bir
 * katı/cam bloğa ya da yüzeyi zemine yakın bir su bloğuna (havuz, çeşme) değmiyorsa yürünür. Böylece model değişince gezi
 * alanı kendiliğinden uyar ve hiçbir yürünür karoda avatar bir duvarın, çeşmenin, ağacın içinden geçmez.
 */
import type { Block } from "../scenes";
import type { CityTile } from "./format";
import type { LandmarkCtx, LandmarkModel } from "./design";

export const GARDEN_BAND: readonly [number, number] = [0.15, 1.7];
/** karo ortası çevresindeki pay (avatar gövdesi ≈ 0,27) */
export const GARDEN_PAD = 0.3;

/** Karonun ortası (landmark yerel a, b) modelin bir bloğuyla dolu mu. */
export function gardenBlocked(blocks: readonly Block[], ctx: LandmarkCtx, a: number, b: number): boolean {
  const x = ctx.x0 + a + 0.5, z = ctx.z0 + b + 0.5;
  for (const q of blocks) {
    if (q.g === "glow") continue;
    if (Math.abs(x - q.p[0]) >= q.s[0] / 2 + GARDEN_PAD || Math.abs(z - q.p[2]) >= q.s[2] / 2 + GARDEN_PAD) continue;
    const lo = q.p[1] - q.s[1] / 2, hi = q.p[1] + q.s[1] / 2;
    if (q.g === "water" ? hi > -0.25 && lo < GARDEN_BAND[1] : hi > GARDEN_BAND[0] && lo < GARDEN_BAND[1]) return true;
  }
  return false;
}

export interface GardenTiles { walk: CityTile[]; gates: CityTile[]; badGates: CityTile[] }

/** Landmarkın yürünür bahçe karoları (landmark yerel): aday dikdörtgenlerin boş karoları + boş kapılar; dolu kapı `badGates`. */
export function gardenTiles(model: LandmarkModel, ctx: LandmarkCtx, blocks: readonly Block[] = model.near(ctx)): GardenTiles {
  const g = model.garden;
  const out: GardenTiles = { walk: [], gates: [], badGates: [] };
  if (!g) return out;
  const seen = new Set<string>();
  const inFoot = (a: number, b: number) => a >= 0 && b >= 0 && a < ctx.w && b < ctx.d;
  for (const [a0, b0, w, d] of g.rects) for (let b = b0; b < b0 + d; b++) for (let a = a0; a < a0 + w; a++) {
    const k = `${a},${b}`;
    if (seen.has(k) || !inFoot(a, b)) continue;
    seen.add(k);
    if (!gardenBlocked(blocks, ctx, a, b)) out.walk.push([a, b]);
  }
  for (const t of g.gates) {
    if (!inFoot(t[0], t[1])) { out.badGates.push(t); continue; }
    if (gardenBlocked(blocks, ctx, t[0], t[1])) out.badGates.push(t);
    else { out.gates.push(t); if (!seen.has(`${t[0]},${t[1]}`)) { seen.add(`${t[0]},${t[1]}`); out.walk.push(t); } }
  }
  // yalnız kapıdan ya da ayak izinin açık kenarından ulaşılan karolar (kapalı cepler landmark olarak katı kalır)
  const free = new Set(out.walk.map(([a, b]) => `${a},${b}`)), reach = new Set<string>(), q: CityTile[] = [];
  for (const t of out.walk) if (t[0] === 0 || t[1] === 0 || t[0] === ctx.w - 1 || t[1] === ctx.d - 1) { reach.add(`${t[0]},${t[1]}`); q.push(t); }
  for (let h = 0; h < q.length; h++) for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n: CityTile = [q[h][0] + da, q[h][1] + db], k = `${n[0]},${n[1]}`;
    if (free.has(k) && !reach.has(k)) { reach.add(k); q.push(n); }
  }
  out.walk = out.walk.filter(([a, b]) => reach.has(`${a},${b}`));
  return out;
}
