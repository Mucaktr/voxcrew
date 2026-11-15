/**
 * bilgi kartı tetiklerinin SAF kuralları. İçe aktarma yok:
 * `frontend/scripts/walk_info.test.mjs` doğrudan paketler.
 *
 * - Yaklaşma: sahnede simge bölgesine `APPROACH_SCENE` (3) karo, şehirde ayak izine `APPROACH_CITY` (4) karo (Chebyshev).
 * - Bakış: avatarın baktığı yönde (heading) `LOOK_RANGE` (25) karo içinde ilk ayak izi `LOOK_DWELL_MS` (1,2 sn) sabit kalırsa.
 * Kamera ışını yerine bakış yönü kullanılır (kamera WalkRig'in içindedir; üçüncü şahısta avatar yürüdüğü yöne bakar).
 * - Dokunma: tıkla-git hedefi simgenin ayak izindeyse ya da avatardan hedefe giden ışın (kamera yüksekliği `TAP_CAM_H`'den
 * zemine inen doğru) simgenin gövdesine çarpıyorsa tıkla-git yerine kart açılır.
 * - Çip yaklaşınca bir kez duyurulur (oturumda simge başına); bakış duyurmaz; `CHIP_SHRINK_MS` sonra küçülür.
*/

export type Tile = [number, number];
/** Karo dikdörtgeni (uçlar dahil). */
export interface Rect { i0: number; j0: number; i1: number; j1: number }

export const APPROACH_SCENE = 3;
export const APPROACH_CITY = 4;
export const LOOK_RANGE = 25;
export const LOOK_DWELL_MS = 1200;
/** Bakış çipi, bakış bittikten bu kadar sonra kalkar. */
export const LOOK_LINGER_MS = 2000;
export const CHIP_SHRINK_MS = 6000;
/** Dokunma ışını: kameranın zeminden yaklaşık yüksekliği (birim; üçüncü şahıs takip kamerası). */
export const TAP_CAM_H = 4;

/** Dünya → karo (sahne ve şehir aynı ızgara: `tx(i) = i − 11,5`, `tz(j) = j − 7,5`). */
export const tileOfX = (x: number) => Math.floor(x + 12);
export const tileOfZ = (z: number) => Math.floor(z + 8);
export const worldX = (i: number) => i - 11.5;
export const worldZ = (j: number) => j - 7.5;

/** Karonun dikdörtgene Chebyshev uzaklığı (içerideyse 0). */
export function rectDist(t: Tile, r: Rect): number {
  const di = t[0] < r.i0 ? r.i0 - t[0] : t[0] > r.i1 ? t[0] - r.i1 : 0;
  const dj = t[1] < r.j0 ? r.j0 - t[1] : t[1] > r.j1 ? t[1] - r.j1 : 0;
  return Math.max(di, dj);
}

/** Dünya noktasının dikdörtgene en yakın noktası (dünya birimi; Yakındakiler girdisinin konumu). */
export function nearestPoint(x: number, z: number, r: Rect): { x: number; z: number } {
  const x0 = worldX(r.i0) - 0.5, x1 = worldX(r.i1) + 0.5, z0 = worldZ(r.j0) - 0.5, z1 = worldZ(r.j1) + 0.5;
  return { x: Math.min(x1, Math.max(x0, x)), z: Math.min(z1, Math.max(z0, z)) };
}

/** `max` karo içindeki en yakın hedef (eşitlikte listedeki ilk); yoksa null. */
export function nearestWithin<T extends { rect: Rect }>(tile: Tile, list: readonly T[], max: number): T | null {
  let best: T | null = null, bd = Infinity;
  for (const it of list) {
    const d = rectDist(tile, it.rect);
    if (d <= max && d < bd) { bd = d; best = it; }
  }
  return best;
}

const inRect = (i: number, j: number, r: Rect) => i >= r.i0 && i <= r.i1 && j >= r.j0 && j <= r.j1;

/**
 * Bakış ışını: (x, z)'den `heading` yönünde (ileri = (sin h, cos h); controller `headingOf` ile aynı) `range` karo içinde ilk
 * değilen ayak izi. Avatarın kendi karosundaki (içinde durduğu) iz sayılmaz. Yoksa null.
 */
export function lookHit<T extends { rect: Rect }>(x: number, z: number, heading: number, list: readonly T[], range = LOOK_RANGE, step = 0.5): T | null {
  const sx = Math.sin(heading), sz = Math.cos(heading);
  const i0 = tileOfX(x), j0 = tileOfZ(z);
  for (let d = step; d <= range; d += step) {
    const i = tileOfX(x + sx * d), j = tileOfZ(z + sz * d);
    if (i === i0 && j === j0) continue;
    for (const it of list) if (inRect(i, j, it.rect) && !inRect(i0, j0, it.rect)) return it;
  }
  return null;
}

/** Bakış bekleme durumu: aynı hedef `LOOK_DWELL_MS` boyunca değilince `fire`. */
export interface Dwell { key: string | null; since: number; fired: boolean }
export const DWELL0: Dwell = { key: null, since: 0, fired: false };
export function dwellStep(s: Dwell, key: string | null, now: number, dwell = LOOK_DWELL_MS): { next: Dwell; fire: boolean } {
  if (key !== s.key) return { next: { key, since: now, fired: false }, fire: false };
  if (!key || s.fired || now - s.since < dwell) return { next: s, fire: false };
  return { next: { ...s, fired: true }, fire: true };
}

/**
 * Dokunma: avatardan tıkla-git hedefine (karo merkezi) giden yerdeki izdüşüm boyunca ilk geçilen ayak izi. Hedef karo izin
 * içindeyse hep isabet; değilse kamera ışınının o noktadaki yüksekliği (`camH`'den zemine doğrusal) simgenin boyundan
 * (`h`) alçaksa isabet (ışın gövdeye çarpar). Avatarın içinde durduğu iz atlanır. Yoksa null.
 */
export function tapHit<T extends { rect: Rect; h: number }>(from: { x: number; z: number }, to: Tile, list: readonly T[], camH = TAP_CAM_H): T | null {
  for (const it of list) if (inRect(to[0], to[1], it.rect)) return it;
  const tx = worldX(to[0]), tz = worldZ(to[1]);
  const L = Math.hypot(tx - from.x, tz - from.z);
  if (L < 1e-6) return null;
  const i0 = tileOfX(from.x), j0 = tileOfZ(from.z);
  const n = Math.ceil(L / 0.25);
  for (let k = 1; k < n; k++) {
    const f = k / n;
    const i = tileOfX(from.x + (tx - from.x) * f), j = tileOfZ(from.z + (tz - from.z) * f);
    for (const it of list) {
      if (!inRect(i, j, it.rect) || inRect(i0, j0, it.rect)) continue;
      if (camH * (1 - f) <= it.h) return it;
    }
  }
  return null;
}

/** Oturumda simge başına bir kez duyuru: ilk kez görülüyorsa true ve kaydeder. */
export function firstTime(seen: Set<string>, key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}
