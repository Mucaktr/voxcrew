/**
 * ACTIVITY-FEEL (B3) — ajanların şehir mekânlarında yeme-içme molası (ürün sahibi: "Diğer agentlar da arada buralarda yeme-içme yapsın").
 *
 * - Yer: şehrin oturmalı yeme-içme ritüellerinin (çay bahçesi, balık-ekmek tezgâhı, balık-patates dükkânı, krep, tapas…) sahne
 * konumu çevresindeki **gerçek oturaklar** (`fun/seats.ts seatsNear`; mekânlıda mekânın kendi 3 × 3 yerleşimi). Oturak karosu
 * yürünür ve karo ortası oturak levhasının üstünde olmalı (ajan karo ortasında oturur; kalça oturakta kalır).
 * - Ne zaman: yalnız boşta (iş yokken) ajanın var olan mola seçiminde, düşük olasılıkla (`MEAL_CHANCE`); aynı anda en çok
 * `mealCap(n)` ajan (ofis/iş boşalmaz). Hareket azaltmada mola gezintisi zaten yok (Crowd kuralı).
 * - Ne yapar: mekâna yürür, oturur, ritüelin eşyasını elde tutup yer/içer (`sitEat`), bitince kalkıp kısa sevinç (`cheer`), masasına
 * döner. Sipariş anı satıcı dikişine iletilir (`ritualRuntime.orderFromVendor`; CITYLIFE satıcıyı bağlar).
 * Saf modül (three/React/depo yok); dünya başına bir kez (WeakMap). Test: scripts/feel_eat.test.mjs.
*/
import { RITUALS, type HeldItem, type RitualDef } from "./rituals";
import { isEatAct } from "./rituals/logic";
import { isFurniture, seatsNear } from "./seats";
import { tileOf, tx, tz, type Block, type Built, type Station, type Tile } from "../scenes";

/** Mekânlı ritüelin oturak yarıçapı (`ritualRuntime.RITUAL_VENUE_RADIUS`) ve mekânsız oturmalı ritüelinki (`RITUAL_SEAT_RADIUS`). */
const VENUE_R = 2.2, SEAT_R = 3.6;
/** Boşta molada yemek seçme olasılığı (kahve/kanepe yerine). */
export const MEAL_CHANCE = 0.3;
/** Aynı anda yemekteki ajan tavanı: ajanların %15'i, en az 1, en çok 3. */
export const MEAL_CAP_MAX = 3;
export const mealCap = (n: number): number => (n <= 0 ? 0 : Math.min(MEAL_CAP_MAX, Math.max(1, Math.floor(n * 0.15))));
/** Mekânda kalma (sn) ve sevinç (sn). */
export const MEAL_STAY: readonly [number, number] = [9, 14];
export const MEAL_JOY = 1.4;

export interface MealSpot {
  /** ajanın oturacağı karo (yürünür), bakış (oturuştan tezgâha/masaya) ve oturak üstü */
  station: Station;
  /** elde tutulan (ritüelin eşyası) ve yemek mi (değilse içecek) */
  held: HeldItem;
  eat: boolean;
  /** yer minderi (sit_ground) */
  ground: boolean;
  city: string;
  ritual: string;
  /** mekânın sipariş noktası (dünya) */
  anchor: { x: number; z: number };
}

const cache = new WeakMap<Built, Map<string, MealSpot[]>>();

/** Taban sahnenin büyümüş dünyadaki kayması (modules[0] taban). */
const baseOff = (b: Pick<Built, "modules">): Tile => { const m = b.modules?.[0]; return m && m.base ? [m.i0, m.j0] : [0, 0]; };

/** Ritüel ajan yemeğine uygun mu: oturmalı, elde eşya, yeme ya da yudum. */
export const mealRitual = (d: RitualDef): boolean => !!d.act.sit && !!d.act.held && (isEatAct(d) || d.act.motion === "sip") && !!d.at.scene?.length;

/**
 * Dünyanın (`world`: sahne kimliği = şehir) ajan yemek yerleri. Karolar büyümüş dünyada (taban kayması eklenir). Aynı karo bir kez.
 */
export function mealSpots(built: Built, world: string, defs: readonly RitualDef[] = RITUALS): MealSpot[] {
  let per = cache.get(built);
  if (!per) cache.set(built, (per = new Map()));
  const key = defs === RITUALS ? world : `${world}#custom`;
  const hit = per.get(key);
  if (hit) return hit;
  const out: MealSpot[] = [];
  const list = defs.filter((d) => d.city === world && mealRitual(d));
  if (list.length) {
    const [oi, oj] = baseOff(built);
    let furn: Block[] | null = null;
    const seen = new Set<string>();
    for (const d of list) for (const a of d.at.scene ?? []) {
      const ax = tx(a.tile[0] + oi), az = tz(a.tile[1] + oj);
      furn ??= built.blocks.filter(isFurniture);
      const near = furn.filter((q) => Math.abs(q.p[0] - ax) < 5 && Math.abs(q.p[2] - az) < 5);
      for (const s of seatsNear(near, ax, az, d.venue ? VENUE_R : SEAT_R, d.act.sit!)) {
        const t = tileOf(s.x, s.z), k = `${t[0]},${t[1]}`;
        if (seen.has(k) || built.blocked.has(k)) continue;
        // ajan karo ortasında oturur: karo ortası oturak levhasının üstünde olmalı (kalça oturakta; kenarda havada kalmaz)
        const cx = tx(t[0]), cz = tz(t[1]);
        if (!near.some((q) => Math.abs(q.p[1] + q.s[1] / 2 - s.y) < 2e-3 && Math.abs(cx - q.p[0]) <= q.s[0] / 2 - 0.04 && Math.abs(cz - q.p[2]) <= q.s[2] / 2 - 0.04)) continue;
        seen.add(k);
        const face = s.heading ?? Math.atan2(ax - s.x, az - s.z);
        out.push({
          station: { tile: t, face, pose: d.act.sit === "sit_ground" ? "sit_ground" : "sit_bench", y: s.y },
          held: d.act.held!, eat: isEatAct(d), ground: d.act.sit === "sit_ground", city: d.city, ritual: d.id, anchor: { x: ax, z: az },
        });
      }
    }
  }
  per.set(key, out);
  return out;
}
