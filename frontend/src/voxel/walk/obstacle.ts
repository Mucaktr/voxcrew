/**
 * CITYFIX1 — "yürünmez cisim" ölçütü (tezgâh/kiosk + gövde/sütun). Çizilen ama çarpışması olmayan alçak katı (basamak payıyla açılan
 * tezgâh, süs bloğu) içinden geçilmesin: ayak izinin karo içine 0,2 birimden fazla taştığı yürünür karo engellenir (merkez karosu her zaman). Saf modül.
 * - tezgâh: katı, yerden yükselen (alt < 0,5), üstü 0,7–1,6, ayak izi iki yönde ≥ 0,35 ve en çok 8 (<city> B9 ölçütü; daha geniş alçak
 * levha teras/platformdur, basamakla çıkılır);
 * - gövde/sütun: katı, yerden (alt < 0,3), üstü > 1,6, ayak izi iki yönde ≥ 0,3 ve en çok 1,6 (hurma gövdesi, direk, kolon).
 * Denetim: scripts/cityfix1.test.mjs (aynı ölçütün bağımsız kopyası).
*/
import type { Block } from "../scenes";

export const isObstacle = (b: Block): boolean => {
  if (b.g !== "solid") return false;
  const bot = b.p[1] - b.s[1] / 2, top = b.p[1] + b.s[1] / 2, lo = Math.min(b.s[0], b.s[2]), hi = Math.max(b.s[0], b.s[2]);
  if (bot < 0.5 && top >= 0.7 && top <= 1.6 && lo >= 0.35 && hi <= 8) return true;
  return bot < 0.3 && top > 1.6 && lo >= 0.3 && hi <= 1.6;
};

/** Bloğun karolara taşma derinliği: karo (i, j) = [ox + i, ox + i + 1); derinlik = iki eksendeki örtüşmenin küçüğü (avatar yarıçapı ≈ 0,28). */
export const INTRUDE = 0.2, INTRUDE_HARD = 0.4;
export function obstacleTiles(b: Block, ox: number, oz: number, thr = INTRUDE): [number, number, number][] {
  const out: [number, number, number][] = [];
  const bx0 = b.p[0] - b.s[0] / 2, bx1 = b.p[0] + b.s[0] / 2, bz0 = b.p[2] - b.s[2] / 2, bz1 = b.p[2] + b.s[2] / 2;
  const ci = Math.floor(b.p[0] - ox), cj = Math.floor(b.p[2] - oz);
  for (let i = Math.floor(bx0 - ox); i <= Math.floor(bx1 - ox - 1e-6); i++)
    for (let j = Math.floor(bz0 - oz); j <= Math.floor(bz1 - oz - 1e-6); j++) {
      const depth = Math.min(Math.min(bx1, ox + i + 1) - Math.max(bx0, ox + i), Math.min(bz1, oz + j + 1) - Math.max(bz0, oz + j));
      if ((i === ci && j === cj) || depth > thr) out.push([i, j, depth]);
    }
  return out;
}
