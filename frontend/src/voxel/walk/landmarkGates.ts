/**
 * LANDMARK-WALK — avlu/bahçe GİRİŞLERİ (saf veri + kesme; React/three yok).
 *
 * ürün sahibi 2026-10-30: "Cami, kale vb. landmarkların bahçelerine girilebilsin … Süleymaniye'nin bahçesine giremiyorum". Duvarla çevrili
 * avlu (kapalı cep) görünen modelde kapı olmadığı için yürünemezdi. Burada simge başına yerel KAPI karoları tanımlanır; o karoda
 * modelin (orta model, yakın kademe `hi`, taban sahne blokları) yürüme bandındaki parçası eksene hizalı kutu farkıyla oyulur:
 * karo ortası ± `GATE_HALF` kare, eşikten (`GATE_SILL` 0,12 — yürüme bandının altı) kapı tepesine (şehir `GATE_TOP_CITY` 1,95 — bahçe bandı
 * 1,7'nin üstü; taban sahne `GATE_TOP_SCENE` 1,3 — insan boyu 1 + pay) kadar. Kapının üstündeki kütle lento/kemer olarak kalır,
 * eşik (≤ 0,12) ve döşeme kalır. Aynı kesme bütün kademelere uygulanır: uzak/yakın, çarpışma ve görüntü aynı kapıyı görür.
 *
 * Karolar simge YEREL: şehirde ayak izinin sol-arka köşesi (0, 0) (`LandmarkModel.garden` ile aynı), taban sahnede simge bölgesinin
 * (`zones` → `landmark`, `tag`) köşesi. Ayak izi dışına taşan (−1, d) karo da olabilir (kapı önü).
 * Kutsal simgede kapı yalnız avluya açılır (iç mekân karosu tavanlı kalır; walk/landmarkWalk.ts tavanlı karoyu açmaz).
*/
import type { Block } from "../scenes";
import { FULL_MAP_GATES, FULL_SCENE_GATES } from "../../full/landmarkGates";

export const GATE_HALF = 0.45;
export const GATE_SILL = 0.12;
export const GATE_TOP_CITY = 1.95;
export const GATE_TOP_SCENE = 1.3;
/** Kesmeden kalan bundan ince parça atılır (hires/types.ts HIRES_MIN_EDGE ile aynı). */
const MIN_EDGE = 0.02;

/** Şehir haritası: `harita/simge` → yerel kapı karoları. */
export const MAP_GATES: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  // İstanbul: Süleymaniye avlusu — kuzey taç kapı (avlu ekseni; revak derinliği hires'ta 0,45: kapıdan avluya geçit)
  ...FULL_MAP_GATES,
  "istanbul/suleymaniye": [[4, 12]],
  // <city> kafes kule — iç mekân kapısı (21, 33) ayağın içinde; ayak dikmesi/kuşağı kapı karosunda gövdeye giriyordu (0,26)
  "istanbul/topkapi": [[13, 6], [9, 13]],
  // <city> stadyumu: oyuncu tüneli (doğu tribünü altından sahaya)
};
/** Taban sahne: `sahne:etiket` → bölge yerel kapı karoları. */
export const SCENE_GATES: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  ...FULL_SCENE_GATES,
};

export const mapGates = (mapId: string, lm: string) => MAP_GATES[`${mapId}/${lm}`] ?? null;
export const sceneGates = (scene: string, tag: string) => SCENE_GATES[`${scene}:${tag}`] ?? null;

/** Kutu farkı: `b` − kesme kutusu (x0..x1, y0..y1, z0..z1). Kesişmiyorsa [b]. */
function subtract(b: Block, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Block[] {
  const bx0 = b.p[0] - b.s[0] / 2, bx1 = b.p[0] + b.s[0] / 2, by0 = b.p[1] - b.s[1] / 2, by1 = b.p[1] + b.s[1] / 2;
  const bz0 = b.p[2] - b.s[2] / 2, bz1 = b.p[2] + b.s[2] / 2;
  if (bx1 <= x0 || bx0 >= x1 || by1 <= y0 || by0 >= y1 || bz1 <= z0 || bz0 >= z1) return [b];
  const out: Block[] = [];
  const piece = (a0: number, a1: number, c0: number, c1: number, e0: number, e1: number) => {
    if (a1 - a0 < MIN_EDGE || c1 - c0 < MIN_EDGE || e1 - e0 < MIN_EDGE) return;
    out.push({ ...b, p: [(a0 + a1) / 2, (c0 + c1) / 2, (e0 + e1) / 2], s: [a1 - a0, c1 - c0, e1 - e0] });
  };
  const mx0 = Math.max(bx0, x0), mx1 = Math.min(bx1, x1), mz0 = Math.max(bz0, z0), mz1 = Math.min(bz1, z1);
  piece(bx0, mx0, by0, by1, bz0, bz1);
  piece(mx1, bx1, by0, by1, bz0, bz1);
  piece(mx0, mx1, by0, by1, bz0, mz0);
  piece(mx0, mx1, by0, by1, mz1, bz1);
  piece(mx0, mx1, by0, Math.max(by0, y0), mz0, mz1);
  piece(mx0, mx1, Math.min(by1, y1), by1, mz0, mz1);
  return out;
}

/** COURTYARD-PORTAL: kapı oymasından kalan dilim eşiği (birim) ve dilim sayılan bölge (karo ortası ± `SLIVER_REACH`). */
export const SLIVER = 0.08;
const SLIVER_REACH = 0.6;
function sliver(r: Block, cx: number, cz: number, y0: number, y1: number): boolean {
  if (Math.min(r.s[0], r.s[2]) >= SLIVER) return false;
  // 1 mm tolerans: kesmenin üstünde/altında kalan lento ve eşik parçası (tam y0/y1'de başlar) kayan noktadan bağımsız kalır (worlds bake ≡ build)
  if (r.p[1] + r.s[1] / 2 <= y0 + 1e-3 || r.p[1] - r.s[1] / 2 >= y1 - 1e-3) return false;
  return Math.abs(r.p[0] - cx) - r.s[0] / 2 < SLIVER_REACH && Math.abs(r.p[2] - cz) - r.s[2] / 2 < SLIVER_REACH
    && Math.abs(r.p[0] - cx) + r.s[0] / 2 <= SLIVER_REACH + 0.5 && Math.abs(r.p[2] - cz) + r.s[2] / 2 <= SLIVER_REACH + 0.5;
}

/**
 * Kapı karolarını oy: `ox, oz` simge yerel (0, 0) karosunun dünya köşesi, `base` zemin (şehirde 0). Su ve dönen bloklar
 * değişmez. Yeni dizi döner (girdi değişmez).
 */
export function carveGates(blocks: readonly Block[], ox: number, oz: number, tiles: readonly (readonly [number, number])[] | null, top: number, base = 0): Block[] {
  if (!tiles?.length) return blocks as Block[];
  let cur = blocks as Block[];
  // komşu kapı karosuna doğru kesme karo kenarına (0,5) uzanır: art arda kapı karoları arasında 0,1'lik ince duvar dilimi kalmaz
  // (taban sahne fiziği kutu çarpıştırıcısıdır; dilim geçidi kapatırdı)
  const has = (a: number, b: number) => tiles.some(([ta, tb]) => ta === a && tb === b);
  for (const [a, b] of tiles) {
    const cx = ox + a + 0.5, cz = oz + b + 0.5;
    const x0 = cx - (has(a - 1, b) ? 0.5 : GATE_HALF), x1 = cx + (has(a + 1, b) ? 0.5 : GATE_HALF);
    const z0 = cz - (has(a, b - 1) ? 0.5 : GATE_HALF), z1 = cz + (has(a, b + 1) ? 0.5 : GATE_HALF);
    const next: Block[] = [];
    for (const q of cur) {
      if (q.g === "water" || q.r) { next.push(q); continue; }
      // COURTYARD-PORTAL (ürün sahibi 2026-10-31 "duvarın içinden geçerek giriyorsun"): karo kenarına oturan duvar kesmenin (± GATE_HALF)
      // dışında ince bir dilim bırakıyordu (Sultanahmet avlu duvarı 0,025): geçidin içinde kalan, yürüme bandını kesen ve
      // `SLIVER`dan ince parça atılır — kapı oyması tam açıklıktır, görünen bir panelin içinden geçilmez
      // ince levha (korkuluk, sur kaplaması < SLIVER) karo kenarına dek (± 0,5 + pay) kesilir: kenara oturan levha geçidi kapatmasın
      const e = SLIVER_REACH - 0.04, wide = (r: Block) => subtract(r, cx - e, cx + e, base + GATE_SILL, base + top, cz - e, cz + e);
      const isThin = (r: Block) => Math.min(r.s[0], r.s[2]) < SLIVER;
      const cut = isThin(q) ? wide(q) : subtract(q, x0, x1, base + GATE_SILL, base + top, z0, z1).flatMap((r) => (isThin(r) ? wide(r) : [r]));
      for (const r of cut) if (!sliver(r, cx, cz, base + GATE_SILL, base + top)) next.push(r);
    }
    cur = next;
  }
  return cur;
}
