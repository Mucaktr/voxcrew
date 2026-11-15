/**
 * CORE-WALK (kalite seferberliği, REAL-SEAT / REAL-SUPPORT) — **yere basan oturak** yardımcıları: tabure, şezlong ve sandalye
 * ayakları. Oturak blokları (ince levha) havada kalmaz: her oturağın altında zeminden oturağın alt yüzüne değen bir ayak (ya da
 * kızak) vardır. Masa oyunu tabureleri, şezlonglar ve toplantı sandalyeleri bu yardımcılarla kurulur (bütün şehirler ve bölgeler
 * aynı kalıbı kullanır). Test: scripts/seat_ground.test.mjs.
 *
 * `Box` imzası `Builder.box` ve `citymap/design.ts Sink` ile aynıdır (ikisi de verilebilir). Saf modül: React/three yok.
 */
import type { Block } from "../scenes";

export type Box = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, g?: Block["g"], j?: number) => void;

/** Ayak rengi (koyu demir; oturağın renginden bağımsız okunur). */
export const LEG = "#3A3F47";

/**
 * Yuvarlak/kare tabure: üst yüzü `top` olan `size` × `size` oturak + zeminden (`y0`) oturağın altına orta ayak ve küçük taban
 * diski. Oturak kalınlığı `t`.
 */
export function stool(box: Box, x: number, z: number, top: number, size: number, c: string, leg = LEG, y0 = 0, t = 0.05): void {
  box(x, top - t / 2, z, size, t, size, c, "solid", 0.02);
  const h = top - t - y0;
  if (h > 0.005) box(x, y0 + h / 2, z, 0.07, h, 0.07, leg, "solid", 0);
  box(x, y0 + 0.015, z, size * 0.7, 0.03, size * 0.7, leg, "solid", 0);
}

/**
 * Dört ayak: alt yüzü `bottom` olan w × d levhanın köşelerinden zemine (`y0`). Şezlong, sandalye ve minderli bank gövdesi için.
 */
export function legs4(box: Box, x: number, z: number, w: number, d: number, bottom: number, leg = LEG, y0 = 0, t = 0.05): void {
  const h = bottom - y0;
  if (!(h > 0.005)) return;
  const ax = Math.max(0, w / 2 - t / 2 - 0.02), az = Math.max(0, d / 2 - t / 2 - 0.02);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(x + sx * ax, y0 + h / 2, z + sz * az, t, h, t, leg, "solid", 0);
}

/**
 * İki kızak (yan panel): alt yüzü `bottom` olan levhanın iki yanında zemine inen ince paneller (`axis` boyunca uzanır). Dört ayaktan
 * ucuz (2 blok); sandalye ve şezlong için.
 */
export function sleds(box: Box, x: number, z: number, w: number, d: number, bottom: number, axis: "x" | "z", leg = LEG, y0 = 0, t = 0.05): void {
  const h = bottom - y0;
  if (!(h > 0.005)) return;
  if (axis === "z") for (const s of [-1, 1]) box(x + s * (w / 2 - t / 2 - 0.02), y0 + h / 2, z, t, h, d * 0.86, leg, "solid", 0);
  else for (const s of [-1, 1]) box(x, y0 + h / 2, z + s * (d / 2 - t / 2 - 0.02), w * 0.86, h, t, leg, "solid", 0);
}
