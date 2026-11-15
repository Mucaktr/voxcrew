/**
 * Londra şehir haritası ortak kiti: palet (altın kumtaşı Gotik, kırmızı-kahve tuğla, Portland taşı, arduvaz, döküm siyah
 * sokak eşyası, gri-yeşil Thames) ve küçük süs yapıcıları (çınar, fener, sokak bilgi köşkü, şezlong). Ofis tabanı
 * `city/styles/londra.ts` paletiyle aynı aile; taç, arma, ulaşım yuvarlak simgesi, yazı, bayrak yok. Saf modül.
*/
import type { DecorCtx, Sink } from "../../../citymap/design";

export const L = {
  sand: "#D9C08A", sandD: "#BFA26B", sandL: "#E8D6A8", spire: "#5B6670", gold: "#C9A23A", ink: "#2F2A25", dial: "#F3E9C6",
  winD: "#3E4652", portland: "#E4DED0", portlandD: "#C9C1AE", brick: "#A9543E", slate: "#58626D", iron: "#22282E",
  stone: "#C9BFAE", stoneD: "#A39E94", white: "#F2F2EE", blue: "#5C8FB8", trunk: "#6B4A2E", leaf: "#4F7F3A", leaf2: "#5E8F44",
  lamp: "#FFDDA0", kiosk: "#2F5D4E", water: "#557D86", grass: "#6FA650",
} as const;

export const at = (c: DecorCtx) => ({ x: (li: number) => c.ox + li + 0.5, z: (lj: number) => c.oz + lj + 0.5 });

/** Çınar (3 kutu). */
export function tree(b: Sink, x: number, z: number, s = 1) {
  b(x, 0.7 * s, z, 0.28 * s, 1.4 * s, 0.28 * s, L.trunk, "solid", 0.05);
  b(x, 1.85 * s, z, 1.5 * s, 1.0 * s, 1.5 * s, L.leaf, "solid", 0.1);
  b(x - 0.12 * s, 2.5 * s, z + 0.1 * s, 0.95 * s, 0.55 * s, 0.95 * s, L.leaf2, "solid", 0.1);
}

/** Döküm siyah fener (2 kutu). varsayılan direk 2,3 → tepe 2,48 (lamba 2,2–3,0 × yürüme insanı).*/
export function lamp(b: Sink, x: number, z: number, h = 2.3) {
  b(x, h / 2, z, 0.08, h, 0.08, L.iron, "solid", 0);
  b(x, h + 0.08, z, 0.22, 0.2, 0.22, L.lamp, "glow", 0);
}

/** FREE-MAP-IP — özgün sokak bilgi köşkü (3 kutu): ince koyu yeşil direk-gövde, önde tek cam harita panosu, düz ince saçak.
 *  Kırmızı kabin, kubbe/taç, çıtalı cam ızgara ve yazı yok (korunan kabin biçiminin kopyası değil). */
export function infoKiosk(b: Sink, x: number, z: number) {
  b(x, 0.85, z, 0.46, 1.7, 0.36, L.kiosk, "solid", 0.02);
  b(x, 1.05, z + 0.19, 0.38, 0.62, 0.03, "#DCE8EE", "solid", 0);
  b(x, 1.76, z, 0.7, 0.08, 0.56, L.kiosk, "solid", 0.02);
}

/** Çizgili şezlong (5 kutu): ahşap çerçeve ayakları yere basar (CITY-PASS-LON: havada şezlong yok), bez oturak ve sırt. */
export function deckchair(b: Sink, x: number, z: number, c: string) {
  for (const s of [-0.24, 0.24]) {
    b(x + s, 0.11, z + 0.18, 0.04, 0.22, 0.04, L.trunk, "solid", 0); // ön ayak
    b(x + s, 0.36, z - 0.24, 0.04, 0.72, 0.04, L.trunk, "solid", 0); // arka ayak + sırt kolu
  }
  b(x, 0.22, z, 0.5, 0.06, 0.6, c, "solid", 0.02);
  b(x, 0.45, z - 0.28, 0.5, 0.5, 0.06, c, "solid", 0.02);
}
