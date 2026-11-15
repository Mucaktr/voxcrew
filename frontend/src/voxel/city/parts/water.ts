/**
 * ortak su kenarı parçaları: iskele kayığı, kanal teknesi, köprü açıklığı, kanal/rıhtım kenarı. Saf; `Sink`'e yazar,
 * tepe y'sini döndürür. Kayık boyu ve su üstü yüksekliği scaleStandard `boat` aralığında (boy 2,5–4; su üstü ≤ 1); korkuluk
 * bel hizası (`STD.rail`). Livre, yazı, şirket rengi yok. Tekne yönü `axis` (x: boy x boyunca).
*/
import { clampTo, nClamp, STD, turn, type Sink } from "./core";
import { NEUTRAL } from "../tokens";

export interface BoatOpts {
  x: number; z: number;
  /** boy (boat aralığına sıkıştırılır) */
  length?: number;
  axis?: "x" | "z";
  /** su yüzü (varsayılan −0,2: kit `waterBody` üstü) */
  y?: number;
  hull?: string; trim?: string; inner?: string;
}
/** `pierBoat` — iskeleye bağlı küçük kayık: omurga, gövde, iç (koyu), oturak. Su üstü 0,45; boy `STD.boatLength`. Kutu: 4. */
export function pierBoat(b: Sink, o: BoatOpts): number {
  const L = clampTo(o.length ?? 3, STD.boatLength), W = L * 0.36, y = o.y ?? -0.2, { x, z } = o;
  const q = turn(b, x, z, o.axis === "z" ? 1 : 0), hull = o.hull ?? NEUTRAL.hull;
  q(x, y + 0.05, z, L * 0.8, 0.3, W * 0.7, hull, "solid", 0.03);
  q(x, y + 0.3, z, L, 0.2, W, hull, "solid", 0.03);
  q(x, y + 0.405, z, L - 0.2, 0.01, W - 0.16, o.inner ?? "#4A3A2A", "solid", 0);
  q(x, y + 0.42, z, 0.3, 0.06, W * 0.9, o.trim ?? "#E8DCC4", "solid", 0.02);
  return y + 0.45;
}

/** `canalBoat` — alçak kanal teknesi, camlı kabin (köprü altından geçer): gövde, baş bloğu, cam kabin, düz kabin çatısı.
 *  Su üstü 0,77 ≤ 1; boy `STD.boatLength`. Kutu: 4. */
export function canalBoat(b: Sink, o: BoatOpts): number {
  const L = clampTo(o.length ?? 4, STD.boatLength), W = L * 0.3, y = o.y ?? -0.2, { x, z } = o;
  const q = turn(b, x, z, o.axis === "z" ? 1 : 0), hull = o.hull ?? NEUTRAL.hull;
  q(x, y + 0.12, z, L, 0.34, W, hull, "solid", 0.03);
  q(x + L * 0.42, y + 0.33, z, L * 0.16, 0.08, W * 0.8, o.trim ?? "#E8DCC4", "solid", 0.02);
  q(x - L * 0.05, y + 0.5, z, L * 0.6, 0.42, W * 0.85, NEUTRAL.glass, "glass", 0);
  q(x - L * 0.05, y + 0.74, z, L * 0.62, 0.06, W * 0.9, o.inner ?? "#3A4A55", "solid", 0.02);
  return y + 0.77;
}

export interface BridgeSpanOpts {
  x0: number; x1: number; z: number;
  /** güverte eni (1–4) */
  width?: number;
  /** güverte üstü y (0,2–1,5) */
  deck?: number;
  /** kemer altı en düşük y (varsayılan −0,6: su içi) */
  base?: number;
  color?: string; rail?: string;
}
/** `bridgeSpan` — kemerli taş köprü açıklığı (x boyunca; z için `turn`): güverte, iki kademeli kemer altı, iki ayak, iki
 *  korkuluk (üstü güverte + `STD.rail`). Güvertenin yürünürlüğü çağıranın planıdır. Kutu: 7. */
export function bridgeSpan(b: Sink, o: BridgeSpanOpts): number {
  const L = Math.abs(o.x1 - o.x0), cx = (o.x0 + o.x1) / 2, wd = Math.min(4, Math.max(1, o.width ?? 2)), dk = Math.min(1.5, Math.max(0.2, o.deck ?? 0.5));
  const base = Math.min(dk - 0.3, o.base ?? -0.6), c = o.color ?? NEUTRAL.stone, rail = o.rail ?? NEUTRAL.stoneDark;
  b(cx, dk - 0.1, o.z, L, 0.2, wd, c, "solid", 0.03);
  b(cx, dk - 0.3, o.z, L * 0.7, 0.2, wd, c, "solid", 0.03);
  b(cx, dk - 0.45, o.z, L * 0.4, 0.1, wd, c, "solid", 0.03);
  for (const s of [-1, 1]) b(cx + s * (L / 2 - 0.3), (base + dk - 0.2) / 2, o.z, 0.6, dk - 0.2 - base, wd, c, "solid", 0.03);
  for (const s of [-1, 1]) b(cx, dk + STD.rail / 2, o.z + s * (wd / 2 - 0.06), L, STD.rail, 0.12, rail, "solid", 0.02);
  return dk + STD.rail;
}

export interface CanalEdgeOpts {
  x0: number; x1: number; z: number;
  /** su hangi yanda */
  side: "+z" | "-z";
  /** rıhtım üstü y (varsayılan 0) */
  y?: number;
  /** baba aralığı (0: yok; ≥ 1,5) */
  bollards?: number;
  stone?: string; coping?: string; metal?: string;
}
/** `canalEdge` — kanal/rıhtım kenarı (x boyunca): su tarafında taş duvar yüzü, kapak taşı, aralıklı babalar (≤ 20; diz hizası
 *  0,36). Babalar kenara yaslı: rıhtım karosu yürünür kalır. Kutu: ≤ 22. */
export function canalEdge(b: Sink, o: CanalEdgeOpts): number {
  const L = Math.abs(o.x1 - o.x0), cx = (o.x0 + o.x1) / 2, y = o.y ?? 0, s = o.side === "+z" ? 1 : -1;
  b(cx, y - 0.45, o.z + s * 0.1, L, 0.9, 0.2, o.stone ?? NEUTRAL.stoneDark, "solid", 0.04);
  b(cx, y + 0.03, o.z, L, 0.06, 0.32, o.coping ?? NEUTRAL.stone, "solid", 0.02);
  const sp = o.bollards ?? 0;
  if (sp >= 1.5) {
    const n = nClamp(Math.floor(L / sp), 1, 20);
    for (let k = 0; k < n; k++) b(o.x0 + (k + 0.5) * (L / n), y + 0.18, o.z + s * 0.06, 0.16, 0.36, 0.16, o.metal ?? NEUTRAL.metal, "solid", 0);
    return y + 0.36;
  }
  return y + 0.06;
}
