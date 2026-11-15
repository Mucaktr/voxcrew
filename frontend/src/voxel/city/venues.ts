/**
 * CORE-WALK (kalite seferberliği) — ritüel **mekânı yerleşim API'si** (`fun/venues.ts` türleri). Sahne `Builder.box` ya da semt
 * süsü `Sink` ile çalışır (aynı imza). Yerleşim 3 × 3 karodur, köken tezgâh karosunun ortası, `face` müşteri yönü:
 *
 *        sıra 0 (köken):  [kiosk/tezgâh × 3 karo]          → engelli (`solid`)
 *        sıra 1 (+face):  tabure · SİPARİŞ KAROSU · tabure  → yürünür; ritüel konumu sipariş karosudur
 *        sıra 2:          bank   ·   masa (engelli)  ·  bank → bank-masa takımı (kafe/krep: sandalyeler; çay bahçesi: tabureler)
 *
 * Piknik (`picnic`) tezgâhsızdır: sıra 1'de hasır örtü ve üç minder, sıra 2 boş. Bütün oturaklar yere basar (`city/furniture.ts`),
 * oturak üstleri ölçeğe göre: sahne (chibi) 0,465 · şehir haritası (insan ölçeği) 0,315 — ritüel oturuşu oturağa değer; masa ve
 * tezgâh üstü oturak aralığının (≤ 0,6) üstündedir ve üstünde eşya durur (oturak sanılmaz). Yazı, logo,
 * marka yok. Yalnız durağan gruplar (`solid/glass/glow`) → +0 çizim çağrısı. Saf modül: React/three yok.
 */
import type { VenueKind, VenueSeat } from "../fun/venues";
import { legs4, LEG, sleds, stool, type Box } from "./furniture";

export type VenueFace = "+z" | "-z" | "+x" | "-x";
export type VenueScale = "scene" | "walk";

export interface VenueSeatOut { x: number; z: number; /** oturak üstü */ y: number; kind: VenueSeat }
export interface VenueOut {
  kind: VenueKind;
  /** ritüel konumu (sipariş karosunun ortası; dünya) ve oradan tezgâha bakış (rad, `AvatarState.heading`) */
  anchor: { x: number; z: number; heading: number };
  seats: VenueSeatOut[];
  /** tezgâh üstü (yoksa null) */
  counter: { x: number; z: number; top: number } | null;
}

/** Ölçek boyları: oturak, masa, tezgâh üstü ve saçak. */
const H: Record<VenueScale, { seat: number; table: number; counter: number; roof: number }> = {
  scene: { seat: 0.465, table: 0.78, counter: 1.0, roof: 2.25 },
  walk: { seat: 0.315, table: 0.64, counter: 0.82, roof: 1.85 },
};

/** Tür başına renkler (tente iki şeridi, kiosk gövdesi, ahşap, vurgu). */
const PAL: Record<VenueKind, { a: string; b: string; body: string; wood: string; accent: string }> = {
  chip_shop: { a: "#1F4E8C", b: "#F2EEE4", body: "#2E5E4E", wood: "#8B5E3C", accent: "#E8B44A" },
  pub: { a: "#2E5E4E", b: "#C9A44C", body: "#2E3A2F", wood: "#6B4A2E", accent: "#E8B76A" },
  cafe: { a: "#B4463A", b: "#F4EFE6", body: "#4A3A33", wood: "#9C6B3F", accent: "#E9C46A" },
  crepe_stand: { a: "#E07A5F", b: "#FFF4E0", body: "#5B4636", wood: "#B07D48", accent: "#F2C14E" },
  food_stand: { a: "#C8553D", b: "#F2E3C6", body: "#3F4650", wood: "#8B5A2B", accent: "#F59E0B" },
  tea_garden: { a: "#B91C1C", b: "#F8FAFC", body: "#5D3A1A", wood: "#8B5A2B", accent: "#C2410C" },
  picnic: { a: "#C0392B", b: "#F8FAFC", body: "#7A5534", wood: "#B07D48", accent: "#F4D35E" },
};

const DIRS: Record<VenueFace, [number, number]> = { "+z": [0, 1], "-z": [0, -1], "+x": [1, 0], "-x": [-1, 0] };

/** Yerleşimin engelli karoları (köken karosuna göre [di, dj]): tezgâh sırası ve masa. Semt `solid` dikdörtgeni için de kullanılır. */
export function venueSolidTiles(kind: VenueKind, face: VenueFace): [number, number][] {
  const [fx, fz] = DIRS[face], rx = fz, rz = -fx;
  if (kind === "picnic") return [];
  const out: [number, number][] = [];
  for (const u of [-1, 0, 1]) out.push([rx * u, rz * u]);
  out.push([fx * 2, fz * 2]);
  return out;
}
/** Ritüel konumunun (sipariş karosu) köken karosuna göre farkı [di, dj]. */
export const venueAnchorTile = (face: VenueFace): [number, number] => [DIRS[face][0], DIRS[face][1]];

/**
 * Mekânı kurar: `box` (Builder.box ya da Sink), köken karosunun dünya ortası (ox, oz), müşteri yönü `face`, ölçek. Dönüş: oturaklar,
 * tezgâh ve ritüel konumu. Engelli karoları çağıran işaretler (`venueSolidTiles`).
 */
export function placeVenue(box: Box, kind: VenueKind, ox: number, oz: number, face: VenueFace, scale: VenueScale = "scene"): VenueOut {
  const [fx, fz] = DIRS[face], rx = fz, rz = -fx;
  const h = H[scale], p = PAL[kind];
  const W = (u: number, v: number): [number, number] => [ox + rx * u + fx * v, oz + rz * u + fz * v];
  /** yerel kutu: u (sağ), v (müşteriye doğru) ölçüleri dünyaya çevrilir */
  const B = (u: number, y: number, v: number, wu: number, hh: number, wv: number, c: string, g: "solid" | "glass" | "glow" = "solid", j = 0.02) => {
    const [x, z] = W(u, v);
    box(x, y, z, Math.abs(rx) * wu + Math.abs(fx) * wv, hh, Math.abs(rz) * wu + Math.abs(fz) * wv, c, g, j);
  };
  const local: Box = (x, y, z, w, hh, d, c, g, j) => {
    // furniture yardımcıları için: (x, z) yerel (u, v); w/d yerel ölçü
    B(x, y, z, w, hh, d, c, (g ?? "solid") as "solid", j ?? 0.02);
  };
  const seats: VenueSeatOut[] = [];
  const seatAt = (u: number, v: number, kindS: VenueSeat, y: number) => { const [x, z] = W(u, v); seats.push({ x, z, y, kind: kindS }); };
  const heading = Math.atan2(-fx, -fz);
  const [axn, azn] = W(0, 1);

  if (kind === "picnic") {
    // hasır örtü (zemin üstü ince) + üç minder + alçak tepsi ve sepet
    B(0, 0.02, 1, 2.6, 0.04, 0.9, p.a, "solid", 0.02);
    for (const u of [-0.9, 0.9]) B(u, 0.045, 1, 0.5, 0.01, 0.86, p.b, "solid", 0);
    for (const u of [-0.9, 0, 0.9]) { B(u, 0.075, 1.12, 0.42, 0.07, 0.42, p.accent, "solid", 0.04); seatAt(u, 1.12, "cushion", 0.11); }
    B(0, 0.07, 0.75, 0.5, 0.06, 0.3, p.wood, "solid", 0.02);
    B(1.2, 0.17, 0.5, 0.4, 0.3, 0.3, p.body, "solid", 0.04);
    return { kind, anchor: { x: axn, z: azn, heading }, seats, counter: null };
  }

  // ---- sıra 0: kiosk (arka duvar, yan direkler, tezgâh gövdesi ve üstü, saçak + çizgili tente)
  const C = h.counter, R = h.roof;
  // arka duvar tente açığıyla (`p.b`, her türde açık krem/altın) boyanır — koyu gövde renginde 2,9 × R'lik dikdörtgen,
  // güneşe sırtı dönükken simsiyah "anlamsız kiosk" okunuyordu (<city>, <city>, <city> doğma kareleri). Ek kutu yok: semt blok
  // bütçesi (CITY-MAP-BUDGET-001) dolu; menü panosu (koyu) açık duvarda okunur kalır
  B(0, R / 2, -0.42, 2.9, R, 0.12, p.b, "solid", 0.02); // arka duvar
  for (const u of [-1.42, 1.42]) B(u, R / 2, -0.05, 0.12, R, 0.8, p.body, "solid", 0.02); // yan direkler
  B(0, (C - 0.06) / 2, 0.18, 2.72, C - 0.06, 0.42, p.body, "solid", 0.03); // tezgâh gövdesi
  B(0, C - 0.03, 0.2, 2.84, 0.06, 0.5, p.wood, "solid", 0.02); // tezgâh üstü
  B(0, C * 0.5, 0.4, 2.6, 0.06, 0.02, p.accent, "solid", 0); // gövde şeridi
  B(0, R + 0.05, -0.02, 3.0, 0.1, 0.96, p.body, "solid", 0.02); // çatı
  for (let k = 0; k < 6; k++) B(-1.25 + k * 0.5, R - 0.12, 0.62, 0.5, 0.08, 0.5, k % 2 ? p.b : p.a, "solid", 0.02); // tente
  B(0, R - 0.42, -0.34, 1.4, 0.5, 0.04, "#26302B", "solid", 0.02); // menü panosu (yazısız)
  for (const [u, c] of [[-0.45, p.accent], [-0.15, p.b], [0.15, p.a], [0.45, p.accent]] as const) B(u, R - 0.42, -0.31, 0.16, 0.16, 0.02, c, "solid", 0);
  // tür eşyası (tezgâh üstü, arka tarafta)
  if (kind === "chip_shop") {
    B(-0.7, C + 0.14, -0.1, 0.7, 0.28, 0.4, "#A9B4BE", "solid", 0.02); // kızartma teknesi
    B(-0.7, C + 0.29, -0.1, 0.56, 0.02, 0.28, "#F2A93B", "glow", 0); // sıcak yağ
    for (const u of [0.2, 0.42, 0.64]) { B(u, C + 0.09, 0.25, 0.14, 0.18, 0.14, p.b, "solid", 0); B(u, C + 0.2, 0.25, 0.12, 0.05, 0.12, "#E8B44A", "solid", 0.05); } // kâğıt külahlar
    B(1.0, C + 0.08, 0.1, 0.12, 0.16, 0.12, "#7A9A3A", "glass", 0); // sirke şişesi
  } else if (kind === "crepe_stand") {
    for (const u of [-0.6, 0]) { B(u, C + 0.06, 0, 0.5, 0.08, 0.5, "#3A3F47"); B(u, C + 0.11, 0, 0.42, 0.01, 0.42, "#F2D49B", "solid", 0); }
    B(0.7, C + 0.12, 0.1, 0.16, 0.24, 0.16, "#5B3A29", "solid", 0.02);
  } else if (kind === "tea_garden") {
    B(-0.6, C + 0.22, -0.05, 0.34, 0.44, 0.34, "#C9A44C", "solid", 0.04); // semaver
    B(-0.6, C + 0.5, -0.05, 0.2, 0.12, 0.2, "#C9A44C", "solid", 0.04);
    for (const u of [0.1, 0.3, 0.5]) B(u, C + 0.06, 0.2, 0.08, 0.12, 0.08, "#C2410C", "glass", 0);
  } else {
    B(-0.6, C + 0.16, -0.05, 0.4, 0.32, 0.32, "#3A3F47", "solid", 0.02); // makine/ocak
    for (const u of [0.2, 0.45]) B(u, C + 0.07, 0.22, 0.12, 0.14, 0.12, p.b, "solid", 0);
  }
  // ---- sıra 1: tezgâh önünde iki tabure (tezgâha 0,1 yanaşık; yönü tezgâh)
  for (const u of [-1, 1]) { stool(local, u, 0.82, h.seat, 0.36, p.wood); seatAt(u, 0.82, "stool", h.seat); }
  // ---- sıra 2: masa (engelli) + iki yanda oturak
  const T = h.table;
  B(0, T - 0.03, 2, 0.8, 0.06, 0.9, p.wood, "solid", 0.03);
  B(0, (T - 0.06) / 2, 2, 0.1, T - 0.06, 0.1, LEG, "solid", 0);
  B(0, 0.015, 2, 0.5, 0.03, 0.5, LEG, "solid", 0);
  if (kind === "tea_garden") {
    for (const u of [-1, 1]) { stool(local, u * 0.88, 2, h.seat, 0.36, p.wood); seatAt(u * 0.88, 2, "stool", h.seat); }
  } else if (kind === "cafe" || kind === "crepe_stand") {
    for (const u of [-1, 1]) {
      // sandalye: oturak + sırt (masanın ters yanında) + dört ayak
      B(u * 0.86, h.seat - 0.03, 2, 0.4, 0.06, 0.42, p.wood, "solid", 0.02);
      legs4(local, u * 0.86, 2, 0.4, 0.42, h.seat - 0.06, LEG);
      B(u * 1.08, h.seat + 0.22, 2, 0.05, 0.44, 0.42, p.wood, "solid", 0.02);
      seatAt(u * 0.86, 2, "chair", h.seat);
    }
  } else {
    // sırtsız pub bankı (uzun ekseni masaya paralel), iki kızak
    for (const u of [-1, 1]) {
      B(u * 0.82, h.seat - 0.035, 2, 0.34, 0.07, 0.9, p.wood, "solid", 0.03);
      sleds(local, u * 0.82, 2, 0.34, 0.9, h.seat - 0.07, "z", LEG);
      seatAt(u * 0.82, 2, "bench", h.seat);
    }
    // masada kâğıt külah ve bardak (chip_shop/pub)
    B(-0.15, T + 0.05, 1.9, 0.14, 0.1, 0.14, kind === "chip_shop" ? p.b : "#E8B76A", kind === "pub" ? "glass" : "solid", 0);
  }
  const [cx, cz] = W(0, 0.2);
  return { kind, anchor: { x: axn, z: azn, heading }, seats, counter: { x: cx, z: cz, top: C } };
}
