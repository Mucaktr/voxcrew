/**
 * ajan ayak işi yarıçapları (Manhattan, karo) taban sahnenin boyuyla ölçeklenir.
 *
 * Değerler 24×16 taban için ayarlanmıştı (uyku 30, araç noktası 18, kahve 24). Şehir tabanları 36×32'dir: aynı sabitlerle
 * <city>'da ilk istasyonların yatak sırasına uzaklığı 34–45 karo, Kapadokya/<city>'te araç noktaları erişim dışında kalıyordu.
 * Çarpan = (taban w + d) / (24 + 16), en az 1 → 24×16 sahnelerde davranış aynı, 36×32 şehirlerde ×1,7.
 * Büyümüş dünyada da yalnız taban modülünün boyu sayılır (bölgeler kendi yataklarını ve noktalarını taşır).
 * Kural: `SLEEP-REACH-001` / `SPOT-REACH-001` (scripts/logic_fix_d.test.mjs).
*/
import { D, W, type Built } from "./scenes";

export const SLEEP_DIST_BASE = 30;
export const SPOT_DIST_BASE = 18;
export const COFFEE_DIST_BASE = 24;
/** S38: bölgeli dünyada (koltuklu) kahve noktası en az bu kadar uzakta aranır */
export const COFFEE_DIST_SEATED = 40;

/** Taban modülünün boyu (modül yoksa dünyanın boyu). */
export function baseSize(built: Pick<Built, "width" | "depth" | "modules">): { w: number; d: number } {
  const m = built.modules?.find((x) => x.base);
  return m ? { w: m.w, d: m.d } : { w: built.width, d: built.depth };
}

/** Yarıçap çarpanı: (w + d) / (24 + 16), en az 1. */
export function reachFactor(built: Pick<Built, "width" | "depth" | "modules">): number {
  const { w, d } = baseSize(built);
  return Math.max(1, (w + d) / (W + D));
}

/** GROWTH (2026-10-28): otel bölgeli büyümüş dünyada (şehirler, districts/hotel.ts) yatak yalnız otellerdedir; ajan en yakın boş
 *  otel yatağına yürür → yarıçap dünyanın tamamı (w + d ≥ her Manhattan uzaklığı). Otelsiz dünyada eskisi gibi. */
export const sleepReach = (built: Pick<Built, "width" | "depth" | "modules"> & { spots?: Built["spots"] }) =>
  built.modules?.some((m) => m.label === "dist_hotel") || built.spots?.sleep?.some((s) => s.bed === "hotel") // HOTEL-SYS: tek otel geçidi
    ? built.width + built.depth : Math.round(SLEEP_DIST_BASE * reachFactor(built));
export const spotReach = (built: Pick<Built, "width" | "depth" | "modules">) => Math.round(SPOT_DIST_BASE * reachFactor(built));
export function coffeeReach(built: Pick<Built, "width" | "depth" | "modules" | "seats">): number {
  const r = Math.round(COFFEE_DIST_BASE * reachFactor(built));
  return built.seats ? Math.max(COFFEE_DIST_SEATED, r) : r;
}
