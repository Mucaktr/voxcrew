/**
 * (SP-QA-05) — uyku ve yürüyüşün saf yardımcıları (Crowd.tsx kullanır; integrations/mcp/test/crowd-sleep.test.mjs sınar).
 *
 * uyuyan/çevrimdışı ajan en yakın boş uyku yerine (`built.spots.sleep`: yatak, ranza, hamak…)
 * yürür ve orada yatar; yalnızca boşta/bitti durumundaki ajan masasında uyuklar (başı sallanır). Kök neden: yürüyüş kare
 * süresi 0,05 sn'ye kırpılıyordu; kare hızı 20'nin altına düşünce (kalabalık sahne, yazılım çizimi, zayıf GPU) yürüyüş ağır
 * çekime dönüyor, duvar saatiyle işleyen sayaçlar (uyuklama, 45 sn) ise sürüyordu. Örn. 4,5 fps'te ajan 2,1 yerine ~0,47
 * birim/sn yürür; yatağı talep eder ama 45 sn sonra hâlâ masasının yakınındadır ve talep edilen yatak boş görünür.
 * Bu dosya bağımlılıksızdır (yalnız tür içe aktarımı) ki node testinden esbuild ile yüklenebilsin.
*/
import type { Tile } from "../scenes";

/** Ruh hâline göre dinlenme biçimi: `bed` yatağa git ve yat · `desk` masada uyuklayabilir · `none` uyumaz. */
export type RestMode = "bed" | "desk" | "none";

export function restMode(mood: string): RestMode {
  if (mood === "offline") return "bed"; // "Uyuyor" / "Asleep": ulaşılamayan beyin
  if (mood === "idle" || mood === "done") return "desk"; // girdi bekleyen: bir süre sonra masasında uyuklar
  return "none"; // çalışıyor, düşünüyor, onay bekliyor (ayakta el sallar), hata
}

/** Yürüyüş için kare süresi üst sınırı (sn). Animasyon 0,05'te kalır; yürüyüş 4 fps'e kadar gerçek zamanlıdır. */
export const WALK_DT_MAX = 0.25;
/** yürüme hızı (birim/sn); buluşmaya giderken biraz daha hızlı */
export const WALK_SPEED = 2.1;
export const MEET_WALK_SPEED = 2.6;
/** yol noktasına bu kadar yaklaşınca nokta tamam sayılır */
const REACH = 0.04;

/**
 * Kare hızından bağımsız yol izleme: `dist` kadar mesafeyi yol noktaları boyunca harcar (köşede kare kaybetmez, hedefi aşmaz).
 * `pos` ve `path` yerinde güncellenir. Dönüş: son hareketin yönü `[dx, dz]` (hiç hareket yoksa null).
 */
export function walkAlong(pos: { x: number; z: number }, path: Tile[], dist: number,
  toX: (i: number) => number, toZ: (j: number) => number): [number, number] | null {
  let left = Math.max(0, dist);
  let dir: [number, number] | null = null;
  while (path.length) {
    const [ni, nj] = path[0];
    const dx = toX(ni) - pos.x, dz = toZ(nj) - pos.z;
    const d = Math.hypot(dx, dz);
    if (d < REACH) { path.shift(); continue; }
    if (left <= 0) break;
    const step = Math.min(d, left);
    pos.x += (dx / d) * step;
    pos.z += (dz / d) * step;
    left -= step;
    dir = [dx, dz];
    if (step < d) break; // bu karenin mesafesi bitti
  }
  return dir;
}

/** Talep anahtarı (scenes.ts `key` ile aynı biçim). */
export const tileKey = (i: number, j: number) => `${i},${j}`;

/**
 * İstasyona en yakın (Manhattan) boş ve engelsiz uyku yerinin indeksi; `maxDist`'ten uzaksa ya da yoksa -1.
 * `taken(key)`: başkası talep etmiş ya da karo engelli.
 */
export function nearestSleepSpot(station: Tile, spots: readonly { tile: Tile }[], taken: (key: string) => boolean, maxDist: number): number {
  let best = -1, bd = Infinity;
  spots.forEach((s, i) => {
    if (taken(tileKey(s.tile[0], s.tile[1]))) return;
    const d = Math.abs(s.tile[0] - station[0]) + Math.abs(s.tile[1] - station[1]);
    if (d < bd) { bd = d; best = i; }
  });
  return best >= 0 && bd <= maxDist ? best : -1;
}

/** Otel bölgesinin ad anahtarı (districts/hotel.ts `HOTEL_LABEL`, reach.ts `sleepReach` ile aynı; bu dosya bağımlılıksız kalsın diye yinelenir). */
export const HOTEL_MODULE_LABEL = "dist_hotel";
interface Cell { i0: number; j0: number; w: number; d: number; label?: string }
const POOLS = new WeakMap<object, { mods: object; pool: readonly unknown[] }>();
const PORTAL_KEY = {};
/** HOTEL-SYS (E1): otel kapısı geçidi (`bed: "hotel"`): kapıya yürünür, ajan geçitten "görünmeyen odalara" girer (gizlenir);
 *  sınırsız kapasite — her ajan kendi talep anahtarıyla (`portalClaim`) aynı kapıyı kullanır. */
export const isPortalSpot = (s: { bed?: string }) => s.bed === "hotel";
/** Geçit talep anahtarı (karo anahtarından ayrı: aynı kapıyı herkes kullanır). */
export const portalClaim = (tile: Tile, who: string) => `${tile[0]},${tile[1]}#${who}`;

/**
 * GROWTH (SLEEP-HOTEL-001) — ajanın yatak ararken bakacağı uyku yerleri. Dünyada otel bölgesi varsa YALNIZ otelin içindeki
 * yataklar (taban sahnede ya da büyümede kalmış açık yatak sırası seçilmez: oteli olan şehirde uyku otelde); otel yoksa eskisi gibi
 * bütün uyku yerleri. Dönüş dizisi `spots`'un alt kümesidir (aynı nesneler); otel varken önbelleğe alınır (`spots` kimliğiyle).
*/
export function sleepPool<T extends { tile: Tile; bed?: string }>(spots: readonly T[], modules: readonly Cell[] | undefined): readonly T[] {
  if (!spots.length) return spots;
  // HOTEL-SYS (E1): otel kapısı geçidi varsa YALNIZ geçit (görünür yatak yok; kapasite sanal — isPortalSpot)
  const hitP = POOLS.get(spots);
  if (hitP && hitP.mods === PORTAL_KEY) return hitP.pool as readonly T[];
  const portals = spots.filter(isPortalSpot);
  if (portals.length) { POOLS.set(spots, { mods: PORTAL_KEY, pool: portals }); return portals; }
  if (!modules) return spots;
  const hotels = modules.filter((m) => m.label === HOTEL_MODULE_LABEL);
  if (!hotels.length) return spots;
  const hit = POOLS.get(spots);
  if (hit && hit.mods === modules) return hit.pool as readonly T[];
  const pool = spots.filter((s) => hotels.some((h) => s.tile[0] >= h.i0 && s.tile[0] < h.i0 + h.w && s.tile[1] >= h.j0 && s.tile[1] < h.j0 + h.d));
  POOLS.set(spots, { mods: modules, pool });
  return pool;
}
