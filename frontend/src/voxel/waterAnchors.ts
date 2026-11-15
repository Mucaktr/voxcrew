/**
 * CEOGOZU — akan/fışkıran su kaynakları (çeşme, şelale): çizime giden her blok listesinden (`drawnBlocks` kancası: taban sahne, şehir
 * parselleri, simge katmanı) su kutularının biçimine bakarak çıkarılır; `WaterFx` yakındakilere damla püskürtür. Saf (three/React yok).
 *  - jet   : ince dikey su sütunu (≤ 0,16 × ≤ 0,16, h ≥ 0,15) — çeşme ağzı; damlalar tepeden fışkırır.
 *  - fall  : ince ama geniş dikey su levhası (bir kenar ≤ 0,16, öteki ≥ 0,3, h ≥ 0,45) — şelale/kaskad; damlalar tabanda sıçrar.
 *  - basin : yerden yüksek küçük su yüzeyi (üst ≥ 0,2, ayak izi ≤ 6 × 6) — çeşme havuzu; yüzeyden küçük damlalar sıçrar.
 * `epoch`: sahne/şehir değişince `WaterFx` artırır; yalnız güncel dönemde kaydedilenler çizilir (eski sahnenin hayaletleri kalmaz).
 */
export interface WaterAnchor { kind: "jet" | "fall" | "basin"; x: number; y: number; z: number; /** fall/basin: genişlik */ w: number; /** fall: 0 = x boyunca, 1 = z boyunca */ axis: 0 | 1; /** jet: su sütununun boyu (m) — fışkırma yüksekliği buradan (`jetReach`) */ h: number; epoch: number }
/**
 * akış gücü tek kaynakta — WaterFx salım hızı/yüksekliği ve scripts/fountain_check.mjs ( c) AYNI sayıları kullanır.
 * `jetReach(h)`: sütun boyuna göre damlanın ağız üstünde çıkacağı en çok yükseklik (m); eskiden hep ≈ 0,16–0,41 m (büyük çeşmede damla seçilmiyordu).
 * `anchorFlow`: damla-metre/sn (salım hızı × yükseklik): jet RATE × reach, şelale RATE × genişlik × 0,3, havuz RATE × 0,1.
*/
export const JET_RATE = 26, BASIN_RATE = 7, FALL_RATE = 9;
export const jetReach = (h: number): number => Math.min(2.2, 0.25 + 1.2 * h);
export const anchorFlow = (a: Pick<WaterAnchor, "kind" | "w" | "h">): number =>
  a.kind === "jet" ? JET_RATE * jetReach(a.h) : a.kind === "fall" ? Math.min(30, FALL_RATE * Math.max(1, a.w)) * 0.3 : BASIN_RATE * 0.1;
interface WB { p: readonly number[]; s: readonly number[]; g: string }

let epoch = 0;
const byKey = new Map<string, WaterAnchor>();
const seen = new WeakMap<readonly unknown[], number>();
export const WATER_ANCHOR_CAP = 3000;
export const bumpWaterEpoch = (): number => { epoch++; byKey.clear(); return epoch; };
export const waterAnchorEpoch = (): number => epoch;
export const waterAnchors = (): IterableIterator<WaterAnchor> => byKey.values();

/** Tek su kutusunun kaynağı (saf; denetimde de kullanılır). */
export function anchorOf(b: WB): Omit<WaterAnchor, "epoch"> | null {
  if (b.g !== "water") return null;
  const [sx, sy, sz] = b.s, top = b.p[1] + sy / 2, lo = Math.min(sx, sz), hi = Math.max(sx, sz);
  if (lo <= 0.16 && hi <= 0.16 && sy >= 0.15) return { kind: "jet", x: b.p[0], y: top, z: b.p[2], w: 0, axis: 0, h: sy };
  if (sy >= 0.45 && lo <= 0.16 && hi >= 0.3) return { kind: "fall", x: b.p[0], y: b.p[1] - sy / 2, z: b.p[2], w: hi, axis: sx >= sz ? 0 : 1, h: sy };
  if (top >= 0.2 && sy <= 0.3 && sx <= 6 && sz <= 6 && sx >= 0.5 && sz >= 0.5) return { kind: "basin", x: b.p[0], y: top, z: b.p[2], w: Math.max(sx, sz), axis: 0, h: 0 };
  return null;
}

/** `drawnBlocks` kancası: liste güncel dönemde bir kez taranır (önbellek isabetinde de çağrılır; ucuz). */
export function registerWaterAnchors(blocks: readonly WB[]): void {
  if (seen.get(blocks) === epoch) return;
  seen.set(blocks, epoch);
  for (const b of blocks) {
    if (b.g !== "water") continue;
    const a = anchorOf(b);
    if (!a) continue;
    const key = `${a.kind}|${a.x.toFixed(2)}|${a.y.toFixed(2)}|${a.z.toFixed(2)}`;
    if (byKey.has(key) || byKey.size >= WATER_ANCHOR_CAP) continue;
    byKey.set(key, { ...a, epoch });
  }
}
