/**
 * CORE-WALK (kalite seferberliği, REAL-SEAT) — **gerçek oturak** çekirdeği: blok listesinden oturak bulma, oturuş yönü ve
 * istasyon oturak yüksekliği. Saf modül: React/three/depo yok (test: scripts/ritual_seat.test.mjs, seat_ground.test.mjs).
 *
 *  - Oturak türleri: bank/tabure/sandalye oturağı (ince katı levha, üstü 0,2–0,6) ve yer minderi (`cushion`: ince katı levha,
 *    üstü 0,03–0,16; `sit_ground`). Sırt tahtası, ayak, masa, zemin levhası ve parıltı plakası oturak sayılmaz.
 *  - Oturuş yönü: oturağın kısa ekseninde sırt tahtası varsa sırttan öteye; yoksa en yakın masa/tezgâha; o da yoksa null.
 *  - İstasyon oturağı (`resolveStationSeats`, Builder.done çağırır): oturan istasyonun (`sit_chair`/`sit_bench`/`lounge`) `y`'si
 *    verilmemişse karonun altındaki gerçek oturağın üst yüzü yazılır — ajan kalçası oturağa değer (batmaz, havada kalmaz).
 */
import type { Block, Station } from "../scenes";

export type SeatKind = "seat" | "cushion";
export interface RitualSeat { x: number; z: number; y: number }
export interface SeatSpot extends RitualSeat {
  kind: SeatKind;
  /** oturan avatarın bakışı (rad; `AvatarState.heading`: 0 → +z, π/2 → +x); null → bilinmiyor (çağıran karar verir) */
  heading: number | null;
  /** noktanın aranan yere uzaklığı (sıralama) */
  d: number;
}

/** Bank/tabure/sandalye oturağı: katı, yatay iki ölçüsü ≥ 0,3, kalınlığı ≤ 0,12, üstü 0,2–0,6 (sırt tahtası ince, ayak dar). */
export const isSeatSlab = (q: Block) => q.g === "solid" && q.s[0] >= 0.3 && q.s[2] >= 0.3 && q.s[1] <= 0.12 && q.p[1] + q.s[1] / 2 >= 0.2 && q.p[1] + q.s[1] / 2 <= 0.6;
/** Yer minderi / hasır: katı, 0,35–1,0 kare, kalınlık 0,03–0,12, üstü 0,03–0,16 (zemin kaplaması büyük, çizgi ince → elenir). */
export const isCushion = (q: Block) => q.g === "solid" && q.s[0] >= 0.35 && q.s[2] >= 0.35 && q.s[0] <= 1.0 && q.s[2] <= 1.0
  && q.s[1] >= 0.03 && q.s[1] <= 0.12 && q.p[1] + q.s[1] / 2 >= 0.03 && q.p[1] + q.s[1] / 2 <= 0.16;
/** Oturak araması için tutulan bloklar: oturaklar + yönü belirleyen alçak eşya (sırt, masa, tezgâh). */
export const isFurniture = (q: Block) => q.g === "solid" && q.p[1] + q.s[1] / 2 <= 1.3 && q.s[0] <= 2.4 && q.s[2] <= 2.4 && q.p[1] - q.s[1] / 2 >= -0.05;

const clamp = (v: number, c: number, h: number) => Math.max(c - Math.max(0, h - 0.2), Math.min(c + Math.max(0, h - 0.2), v));
/** Levhanın (x, z) noktasına en yakın oturuş noktası: uzun eksende noktaya en yakın (uçlardan 0,2 içeride), kısa eksende orta. */
function seatPoint(q: Block, x: number, z: number): { x: number; z: number } {
  const hx = q.s[0] / 2, hz = q.s[2] / 2;
  return hx >= hz ? { x: clamp(x, q.p[0], hx), z: q.p[2] } : { x: q.p[0], z: clamp(z, q.p[2], hz) };
}
const rectDist = (q: Block, x: number, z: number) =>
  Math.hypot(Math.max(0, Math.abs(x - q.p[0]) - q.s[0] / 2), Math.max(0, Math.abs(z - q.p[2]) - q.s[2] / 2));

/**
 * (x, z) noktasının `pad` yakınındaki bank oturağı: en yakın (eşitse en alçak) oturak. Dönüş: oturuş noktası (uzun eksende
 * noktaya en yakın, kısa eksende oturağın ortası) ve oturak üst yüzü. Yoksa null.
 */
export function ritualSeatAt(blocks: readonly Block[], x: number, z: number, pad = 0.3): RitualSeat | null {
  let best: RitualSeat | null = null, bd = Infinity;
  for (const q of blocks) {
    if (!isSeatSlab(q)) continue;
    const d = rectDist(q, x, z);
    if (d > pad) continue;
    const y = q.p[1] + q.s[1] / 2;
    if (d > bd + 1e-6 || (Math.abs(d - bd) <= 1e-6 && best && y >= best.y)) continue;
    best = { ...seatPoint(q, x, z), y };
    bd = d;
  }
  return best;
}

/**
 * Oturağın oturuş yönü: kısa ekseninin bir yanında oturak üstünden yükselen sırt tahtası varsa öbür yana; yoksa 1,1 birim içindeki
 * en yakın masa/tezgâh üstüne (üstü oturaktan 0,15–0,75 yüksek, ince değil) doğru; yoksa null.
 */
export function seatHeading(blocks: readonly Block[], q: Block, at: { x: number; z: number }): number | null {
  const top = q.p[1] + q.s[1] / 2, alongX = q.s[0] >= q.s[2];
  // sırt: oturağın uzun ekseni boyunca uzanan (ya da aynı aralıkta) dikey, oturak üstünden başlayan blok, kısa eksende kenarda
  for (const r of blocks) {
    if (r === q || r.g !== "solid") continue;
    const bot = r.p[1] - r.s[1] / 2, rt = r.p[1] + r.s[1] / 2;
    if (rt < top + 0.06 || bot > top + 0.35 || bot < top - 0.14) continue;
    if (alongX) {
      if (Math.abs(r.p[0] - at.x) > r.s[0] / 2 + 0.25) continue;
      const off = r.p[2] - q.p[2];
      if (Math.abs(off) < 0.1 || Math.abs(off) > q.s[2] / 2 + 0.2 || r.s[2] > 0.16) continue;
      return off > 0 ? Math.PI : 0;
    }
    if (Math.abs(r.p[2] - at.z) > r.s[2] / 2 + 0.25) continue;
    const off = r.p[0] - q.p[0];
    if (Math.abs(off) < 0.1 || Math.abs(off) > q.s[0] / 2 + 0.2 || r.s[0] > 0.16) continue;
    return off > 0 ? -Math.PI / 2 : Math.PI / 2;
  }
  // masa / tezgâh: oturaktan yüksek, yatay yüzeyli, yakın
  let best: number | null = null, bd = 1.1;
  for (const r of blocks) {
    if (r === q || r.g !== "solid") continue;
    const rt = r.p[1] + r.s[1] / 2;
    if (rt < top + 0.15 || rt > top + 0.75 || r.s[0] < 0.3 || r.s[2] < 0.3) continue;
    const d = rectDist(r, at.x, at.z);
    if (d >= bd || d < 0.02) continue;
    const cx = Math.max(r.p[0] - r.s[0] / 2, Math.min(r.p[0] + r.s[0] / 2, at.x)), cz = Math.max(r.p[2] - r.s[2] / 2, Math.min(r.p[2] + r.s[2] / 2, at.z));
    bd = d; best = Math.atan2(cx - at.x, cz - at.z);
  }
  return best;
}

/** Levhanın üstü boş mu: üstüne oturan eşya (tezgâh malı, masa üstü bardak/külah, tabla) yoksa oturaktır. */
export function topClear(blocks: readonly Block[], q: Block): boolean {
  const top = q.p[1] + q.s[1] / 2;
  for (const r of blocks) {
    if (r === q || r.g === "glow") continue;
    const bot = r.p[1] - r.s[1] / 2;
    if (bot < top - 0.012 || bot > top + 0.06) continue;
    if (Math.abs(r.p[0] - q.p[0]) < q.s[0] / 2 - 0.02 && Math.abs(r.p[2] - q.p[2]) < q.s[2] / 2 - 0.02) return false;
  }
  return true;
}

/**
 * Yer oturağının (minder/hasır) üstü boş mu: ayak izinin üstünde, minder üstünden 1,0 birime kadar uzanan katı/cam blok yok
 * (masa direği, tabla, şemsiye ayağı). Kafe masasının taban diski ya da direğin geçtiği levha minder sayılmaz (kalça direğe
 * gömülürdü). CORE-WALK düzeltmesi (gerçekçilik kapısı REAL-SEAT-001: <city> rihtim_piknik, <city> cay_evi, <city> kimbap_piknik).
*/
export function groundHeadroom(blocks: readonly Block[], q: Block): boolean {
  const top = q.p[1] + q.s[1] / 2;
  for (const r of blocks) {
    if (r === q || (r.g !== "solid" && r.g !== "glass")) continue;
    const bot = r.p[1] - r.s[1] / 2, rt = r.p[1] + r.s[1] / 2;
    if (rt <= top + 0.02 || bot >= top + 1.0) continue;
    if (Math.abs(r.p[0] - q.p[0]) < (r.s[0] + q.s[0]) / 2 - 0.01 && Math.abs(r.p[2] - q.p[2]) < (r.s[2] + q.s[2]) / 2 - 0.01) return false;
  }
  return true;
}

/**
 * `radius` içindeki oturaklar (yakından uzağa). `pose`: `sit_bench` → bank/tabure/sandalye oturakları; `sit_ground` → yer
 * minderleri. Uzun bankta oturuş noktası `near` noktasına en yakın yer (yoksa aranan merkez).
 */
export function seatsNear(blocks: readonly Block[], x: number, z: number, radius: number, pose: "sit_bench" | "sit_ground",
  near: { x: number; z: number } = { x, z }): SeatSpot[] {
  const out: SeatSpot[] = [];
  const ok = pose === "sit_ground" ? isCushion : isSeatSlab;
  for (const q of blocks) {
    if (!ok(q)) continue;
    if (rectDist(q, x, z) > radius) continue;
    if (!topClear(blocks, q)) continue;
    if (pose === "sit_ground" && !groundHeadroom(blocks, q)) continue;
    const p = seatPoint(q, near.x, near.z);
    if (Math.hypot(p.x - x, p.z - z) > radius + 0.2) continue;
    out.push({ ...p, y: q.p[1] + q.s[1] / 2, kind: pose === "sit_ground" ? "cushion" : "seat", heading: seatHeading(blocks, q, p), d: Math.hypot(p.x - near.x, p.z - near.z) });
  }
  return out.sort((a, b) => a.d - b.d);
}

// ------------------------------------------------------------------ istasyon oturağı
const SITTING: ReadonlySet<string> = new Set(["sit_chair", "sit_bench", "lounge"]);
/** İstasyon noktasının altındaki oturak üst yüzü (üstü 0,2–0,7; yatay 0,25–1,6; nokta ayak izinin 0,12 yakınında); yoksa null. */
export function stationSeatTop(blocks: readonly Block[], x: number, z: number): number | null {
  let top: number | null = null;
  for (const q of blocks) {
    if (q.g !== "solid") continue;
    const t = q.p[1] + q.s[1] / 2;
    if (t < 0.2 || t > 0.7 || q.s[0] < 0.25 || q.s[2] < 0.25 || q.s[0] > 1.6 || q.s[2] > 1.6) continue;
    if (Math.abs(q.p[0] - x) > q.s[0] / 2 + 0.12 || Math.abs(q.p[2] - z) > q.s[2] / 2 + 0.12) continue;
    if (top === null || t > top) top = t;
  }
  return top;
}
/**
 * Oturan istasyonların (`y` verilmemiş) altındaki gerçek oturağı yazar (yerinde). Oturak bloğu yoksa `y` boş kalır (Props.tsx o
 * istasyona sandalyeyi kendisi çizer: oturak 0,31). `toX/toZ`: karo → dünya.
 */
export function resolveStationSeats(blocks: readonly Block[], stations: Station[], toX: (i: number) => number, toZ: (j: number) => number): void {
  let pool: Block[] | null = null;
  for (const s of stations) {
    if (s.y !== undefined || !SITTING.has(s.pose ?? "sit_chair")) continue;
    pool ??= blocks.filter((q) => q.g === "solid" && q.p[1] + q.s[1] / 2 <= 0.7 && q.p[1] + q.s[1] / 2 >= 0.2);
    const t = stationSeatTop(pool, toX(s.tile[0]), toZ(s.tile[1]));
    if (t !== null) s.y = Math.round(t * 1000) / 1000;
  }
}

/**
 * Props.tsx'in çalışma anı sandalyeleri (istasyonun kendi oturağı yok: `sit_chair`, `y` boş, yakında "chair" işareti yok) blok
 * değildir; oturak araması için aynı ölçüde sanal oturak + sırt blokları (oturak üstü 0,31; sırt istasyon bakışının arkasında).
 */
export function propChairBlocks(b: { stations: readonly Station[]; props?: readonly { k: string; p: readonly number[] }[] },
  toX: (i: number) => number, toZ: (j: number) => number): Block[] {
  const out: Block[] = [];
  const marks = (b.props ?? []).filter((q) => q.k === "chair");
  for (const s of b.stations) {
    if ((s.pose && s.pose !== "sit_chair") || s.y !== undefined) continue;
    const x = toX(s.tile[0]), z = toZ(s.tile[1]);
    if (marks.some((c) => Math.hypot(c.p[0] - x, c.p[2] - z) < 0.45)) continue;
    const sn = Math.sin(s.face), cs = Math.cos(s.face), side = Math.abs(sn) > Math.abs(cs);
    out.push({ p: [x + sn * 0.08, 0.27, z + cs * 0.08], s: side ? [0.52, 0.08, 0.56] : [0.56, 0.08, 0.52], c: "#8B5E3C", g: "solid", j: 0 });
    out.push({ p: [x + sn * 0.06, 0.15, z + cs * 0.06], s: [0.07, 0.22, 0.07], c: "#4B5563", g: "solid", j: 0 }); // ayak
    out.push({ p: [x, 0.0125, z], s: [0.5, 0.025, 0.5], c: "#6B4F3A", g: "solid", j: 0 }); // taban (ince: minder sayılmaz)
    out.push({ p: [x - sn * 0.2, 0.56, z - cs * 0.2], s: side ? [0.08, 0.5, 0.54] : [0.54, 0.5, 0.08], c: "#8B5E3C", g: "solid", j: 0 });
  }
  return out;
}
