/**
 * SP-W0 — şehir stili: bir şehir sahnesinin bütün kit çağrılarına giden palet ve
 * biçim seçimleri. Şehir dosyası (Dalga 1+) yalnız bir `CityStyle` + simge yapı çağrıları + taban yerleşim içerir.
 * Renkler özgündür; kulüp renk kombinasyonu, bayrak ya da ulaşım livresi kullanılmaz.
*/
export type FacadeKind = "row" | "haussmann" | "ottoman";
export type RoofKind = "zinc" | "tile" | "flat" | "curved";
export type TreeKind = "plane" | "cherry" | "birch" | "palm" | "cypress" | "judas";

export interface CityStyle {
  /** kimlik (locale ya da hata ayıklama için; arayüzde gösterilmez) */
  id: string;
  ground: {
    street: [string, string];
    sidewalk: [string, string];
    plaza: [string, string];
    grass: [string, string];
    quay: [string, string];
    under: string;
  };
  water: string;
  facade: FacadeKind;
  /** cephe renkleri (sıra ile dönüşümlü) */
  walls: readonly string[];
  trim: string;
  roof: RoofKind;
  roofColor: string;
  window: string;
  /** gece yanan pencere (glow) */
  windowLit: string;
  door: string;
  tree: TreeKind;
  lamp: { post: string; glow: string };
  awnings: readonly string[];
  /** skyline arka plan tonu (uzak, sisle karışır) */
  far: readonly string[];
}

/** Nötr Avrupa/Akdeniz şehri: kit örnekleri ve demo için. Şehir dosyaları kendi stilini yazar. */
export const DEFAULT_CITY: CityStyle = {
  id: "generic",
  ground: {
    street: ["#5B6170", "#555B69"],
    sidewalk: ["#C9C2B6", "#BFB8AB"],
    plaza: ["#D8CBB0", "#CFC1A4"],
    grass: ["#6DBE45", "#64B33F"],
    quay: ["#A89F92", "#9D9487"],
    under: "#6B5E4E",
  },
  water: "#2F86B8",
  facade: "row",
  walls: ["#E8D9C0", "#D9B99B", "#C9D6DF", "#E6C7B8"],
  trim: "#F4EFE6",
  roof: "tile",
  roofColor: "#B5543C",
  window: "#4A6378",
  windowLit: "#FFD98A",
  door: "#5B3A1F",
  tree: "plane",
  lamp: { post: "#2F3640", glow: "#FFE2A0" },
  awnings: ["#C8553D", "#3F7D6E", "#D9A441", "#4A6FA5"],
  far: ["#9FB3C4", "#A9BCCB", "#93A8BA"],
};

/** Dama deseni seçici: (i, j) karosu için iki tonlu yüzey rengi. */
export const pick2 = (c: readonly [string, string], i: number, j: number) => ((i * 3 + j * 5) % 7 ? c[0] : c[1]);
