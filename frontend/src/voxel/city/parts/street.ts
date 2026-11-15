/**
 * ortak sokak parçaları: pazar tezgâhı sırası, fener dizisi, meydan döşeme deseni. Saf; `Sink`'e yazar, tepe y'sini
 * döndürür. Mobilya ölçüsü bağlama göre `furniture` (scaleStandard; sahnede chibi 1,55, haritada gerçek): tezgâh üstü
 * `counter.top`, tente üstü `stall.awning` (altında insan durur). Fener altı ≥ zemin kat üst sınırı (2,2: başın üstünde).
 * Tente tek renk, saçağı da aynı renk (renkli tente + beyaz şerit bayrak dizisi oluşturabilir; `city_tokens.test.mjs`). Yazı/tabela/marka yok.
*/
import { cable } from "../../citymap/design";
import { cyc, furniture, nClamp, STD, type ScaleContext, type Sink } from "./core";
import { NEUTRAL } from "../tokens";

export interface StallRowOpts {
  x0: number; z: number;
  /** tezgâh (1–8) */
  n?: number;
  /** tezgâh eni (0,9–1,6) */
  w?: number;
  depth?: number;
  /** ölçek bağlamı: `scene` (sahne, chibi mobilya) ya da `city` (şehir haritası, gerçek ölçek) */
  ctx: ScaleContext;
  awnings?: readonly string[]; goods?: readonly string[];
  body?: string; top?: string; pole?: string; valance?: string;
}
/** `marketStallRow` — pazar tezgâhı sırası (x boyunca; müşteri +z): gövde, tezgâh üstü, iki mal, iki arka direk, tek renk
 *  tente ve aynı renk saçak (araya beyaz şerit girmez: bayrak dizisi riski). Kutu: n × 8 ≤ 64. Tepe = tente üstü. */
export function marketStallRow(b: Sink, o: StallRowOpts): number {
  const n = nClamp(o.n ?? 4, 1, 8), w = Math.min(1.6, Math.max(0.9, o.w ?? 1)), dep = o.depth ?? 0.7;
  const aw = furniture("stall", "awning", o.ctx), ct = furniture("counter", "top", o.ctx);
  const awnings = o.awnings ?? NEUTRAL.lantern, goods = o.goods ?? NEUTRAL.goods, pole = o.pole ?? "#5B4A3A";
  for (let k = 0; k < n; k++) {
    const x = o.x0 + (k + 0.5) * w;
    b(x, (ct - 0.04) / 2, o.z, w * 0.92, ct - 0.04, dep, o.body ?? "#8B6A47", "solid", 0.04);
    b(x, ct - 0.02, o.z, w * 0.98, 0.04, dep + 0.06, o.top ?? "#A47148", "solid", 0.02);
    for (const s of [-1, 1]) b(x + s * w * 0.22, ct + 0.06, o.z + s * 0.08, w * 0.3, 0.12, dep * 0.4, cyc(goods, k * 2 + (s > 0 ? 1 : 0)), "solid", 0.06);
    for (const s of [-1, 1]) b(x + s * (w / 2 - 0.05), aw / 2, o.z - dep / 2, 0.05, aw, 0.05, pole, "solid", 0);
    const a = cyc(awnings, k);
    b(x, aw - 0.03, o.z + 0.15, w, 0.06, dep + 0.4, a, "solid", 0.02);
    b(x, aw - 0.12, o.z + 0.15 + (dep + 0.4) / 2, w, 0.12, 0.03, o.valance ?? a, "solid", 0.02);
  }
  return aw;
}

export interface LanternOpts {
  x0: number; x1: number; z: number;
  /** askı uçlarının yüksekliği (en az: fener altı 2,2 + fener + sarkma) */
  y?: number;
  /** fener (2–10) */
  n?: number;
  /** sarkma (0–0,6) */
  sag?: number;
  colors?: readonly string[];
  /** gece yanar mı (`glow`; parsel ışık bütçesi 12 → n ≤ 10) */
  glow?: boolean;
  wire?: string;
}
/** `lanternString` — iki direk arası fener dizisi (<city>, <city>, Hanoi; karışık renk, yazısız): 3 parçalı sarkık tel + fener
 * başına gövde ve kapak. Fener altı ≥ `STD.groundMax` (2,2). Kutu: 3 + 2n ≤ 23.*/
export function lanternString(b: Sink, o: LanternOpts): number {
  const n = nClamp(o.n ?? 6, 2, 10), sag = Math.min(0.6, Math.max(0, o.sag ?? 0.3)), body = 0.3, cap = 0.04;
  const y = Math.max(o.y ?? 2.9, STD.groundMax + body + cap + 0.22 + sag), wire = o.wire ?? "#2E3238";
  const colors = o.colors ?? NEUTRAL.lantern;
  cable(b, o.x0, y, o.x1, y, sag, 3, o.z, wire, 0.04);
  for (const x of [o.x0, o.x1]) b(x, (y + 0.02) / 2, o.z, 0.1, y + 0.02, 0.1, "#5A4636", "solid", 0); // CEOGOZU: iki ucunda direk (fener dizisi havada asılı kalmaz)
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n, x = o.x0 + (o.x1 - o.x0) * u, wy = y - sag * 4 * u * (1 - u);
    b(x, wy - 0.02 - cap / 2, o.z, 0.12, cap, 0.12, wire, "solid", 0); // CEOGOZU: başlık telin altına değer (3 parçalı tel sarkmasında 2 fener havada kalıyordu)
    b(x, wy - 0.02 - cap - body / 2, o.z, 0.22, body, 0.22, cyc(colors, k), o.glow === false ? "solid" : "glow", 0);
  }
  return y + 0.02;
}

export interface PavingOpts {
  x0: number; z0: number;
  /** alan (1–16 × 1–16) */
  w: number; d: number;
  pattern?: "check" | "ring" | "border";
  color?: string;
  y?: number;
}
/** `plazaPaving` — meydan döşeme kakması (zemin üstünde 0,02 ince levha; yürünür): dama (2 × 2 karelik), iç içe halka ya da
 *  kenar bandı. Zemini çağıran boyar (`paintCity`). Kutu: dama ≤ 32, halka ≤ 16, kenar 4. */
export function plazaPaving(b: Sink, o: PavingOpts): number {
  const w = Math.min(16, Math.max(1, o.w)), d = Math.min(16, Math.max(1, o.d)), c = o.color ?? NEUTRAL.stoneDark, y = (o.y ?? 0) + 0.011;
  const strip = (x: number, z: number, sw: number, sd: number) => b(x, y, z, sw, 0.02, sd, c, "solid", 0.02);
  const ring = (k: number) => {
    const iw = w - 2 * k, id = d - 2 * k;
    if (iw < 1 || id < 1) return;
    strip(o.x0 + w / 2, o.z0 + k + 0.15, iw, 0.3);
    strip(o.x0 + w / 2, o.z0 + d - k - 0.15, iw, 0.3);
    strip(o.x0 + k + 0.15, o.z0 + d / 2, 0.3, id - 0.6);
    strip(o.x0 + w - k - 0.15, o.z0 + d / 2, 0.3, id - 0.6);
  };
  const p = o.pattern ?? "check";
  if (p === "border") ring(0);
  else if (p === "ring") for (let k = 0; k < Math.min(4, Math.floor(Math.min(w, d) / 4) + 1); k++) ring(k * 2);
  else for (let i = 0; i < w; i += 2) for (let j = 0; j < d; j += 2) if (((i + j) / 2) % 2 === 0) strip(o.x0 + i + Math.min(2, w - i) / 2, o.z0 + j + Math.min(2, d - j) / 2, Math.min(2, w - i), Math.min(2, d - j));
  return y + 0.01;
}
