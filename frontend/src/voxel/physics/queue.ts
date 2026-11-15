/**
 * PHYS (FIX-PHYS) — kuyruk zaman aşımı yardımcıları. Saf; Crowd.tsx ve testler kullanır.
 *
 * Çözücü (solver.ts) kuyrukta bekleyen bedenin `waitT` süresini sayar ve `queueLimit`e ulaşınca `queueOut` işaretler.
 * Çağıran (Crowd) işareti görünce: mola/uyku yerinde başka boş yer, araç noktasında başka nokta ya da masası; hiçbiri
 * yoksa hedefin yakınında nazik bir kaçış karosuna (`queueDetour`) yürür, birkaç saniye bekler ve yeniden dener.
 * Paylaşılan istasyonlu (harici oturum, koltuğu olmayan misafir) karakter dolu masayı hiç hedeflemez (`deskTarget`).
*/
import { findPath, type Tile } from "../scenes";
import { OFF, WALK, type Body } from "./bodies";
import { neighbors, type Physics } from "./solver";
import { centerX, centerZ, tileX, tileZ } from "./world";

/** Crowd'un beden başına rastgele kuyruk sınırı: QUEUE_MIN + [0, 1) × QUEUE_SPAN sn (8–15 sn) */
export const QUEUE_MIN = 8;
export const QUEUE_SPAN = 7;
export { QUEUE_LIMIT } from "./bodies";

/**
 * Masada çalışma/onay bekleme hedefi: kendi istasyonu; istasyon paylaşılıyorsa (sahibi orada oturur) kendi boşta karosu.
 * Kök neden: paylaşılan istasyonu hedefleyen harici oturumlar dolu masanın önünde sonsuza dek kuyruktaydı.
*/
export function deskTarget(p: { shared: boolean; idle: Tile; station: { tile: Tile } }): Tile {
  return p.shared ? p.idle : p.station.tile;
}

const NEAR: Body[] = [];

/**
 * Nazik kaçış karosu: dolu `goal`un 2–`maxR` karo (Chebyshev) yakınında, yol bulmada açık, kimsenin hedefi olmayan
 * (istasyon, oturak, araç/uyku noktası, dinlenme), üstünde ya da çok yakınında beden durmayan, `avoid` dışı ve bedenden
 * yolu olan karo; bedene en yakın olan önce. Halka 1 (hedefin dibi) kuyruğun kendisi olduğu için atlanır. Bulunamazsa null.
 */
export function queueDetour(ph: Physics, b: Body, goal: Tile, avoid?: (k: number) => boolean, maxR = 4): Tile | null {
  const { sw } = ph;
  const cand: { t: Tile; d: number }[] = [];
  const bi = tileX(b.x), bj = tileZ(b.z);
  for (let ring = 2; ring <= maxR; ring++) {
    for (let a = -ring; a <= ring; a++) for (let c = -ring; c <= ring; c++) {
      if (Math.max(Math.abs(a), Math.abs(c)) !== ring) continue;
      const i = goal[0] + a, j = goal[1] + c;
      if (i < 0 || j < 0 || i >= sw.width || j >= sw.depth || (i === bi && j === bj)) continue;
      const k = j * sw.width + i;
      if (sw.closed[k] || sw.targets.has(k) || avoid?.(k)) continue;
      const x = centerX(i), z = centerZ(j);
      const n = neighbors(ph, x, z, 0.9, NEAR);
      let free = true;
      for (let q = 0; q < n; q++) {
        const o = NEAR[q];
        if (o === b || o.mode === OFF) continue;
        // duran ya da kuyruktaki beden karoda/yakınında; yürüyenin hedefi bu karo
        if (Math.hypot(o.x - x, o.z - z) < o.r + b.r + 0.05) { free = false; break; }
        if (o.mode === WALK && o.goal === k) { free = false; break; }
      }
      if (free) cand.push({ t: [i, j], d: Math.hypot(x - b.x, z - b.z) + ring * 0.25 });
    }
    if (cand.length >= 3) break;
  }
  cand.sort((p, q) => p.d - q.d);
  for (let n = 0; n < cand.length && n < 4; n++) {
    if (findPath([bi, bj], cand[n].t, sw.nav)) return cand[n].t;
  }
  return null;
}
