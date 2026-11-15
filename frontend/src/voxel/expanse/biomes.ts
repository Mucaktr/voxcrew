/**
 * EXP-GEN (E1a) — çevre biyomları ve öğe tarifleri ( tablosu, kullanıcı kararı D1–D5 A).
 *
 * Biyom = sahne profili. Öğeler yalnız jenerik doğa/yerleşim parçalarıdır: ağaç, çalı, kaya, alçak ev, ahır, tarla, çit,
 * lamba direği, kum torbası, bayraksız direk, tezgâh silüeti, mantar, kristal, mercan… **Yazı, bayrak, logo, ibadet yapısı,
 * simge (landmark) üretilmez** (`EXP-IP-001`, `EXP-SACRED-001`); `flag` (dalgalanan kumaş) ve canlı gruplar (wave, bob, snow,
 * cloud, flame) hiç kullanılmaz (kuyruk yalnız durağan gruplara yazılır, plan §14.3 R2).
 *
 * Saf modül: React/three yok. Konumlar taban çerçevesinde dünya birimidir (grid.ts).
*/
import type { Group } from "../scenes";
import type { CityStyle, TreeKind } from "../city/style";
import { ISTANBUL_STYLE } from "../city/styles/istanbul";
import { KAPADOKYA_STYLE } from "../city/styles/kapadokya";
import { LONDRA_STYLE } from "../city/styles/londra";
import { NEW_CITIES, NEW_CITY_IDS } from "../cities/index";
import { NEW_CITY_PARTS } from "../cities/parts";
import { FULL_SCENE_BIOME, FULL_CITY_STYLES, FULL_SCENE_COAST, FULL_SCENE_WEIGHTS } from "../../full/biomes";

export type BiomeId = "suburb" | "countryside" | "meadow" | "forest" | "beach" | "sea" | "snowfield" | "craters" | "islets"
  | "reef" | "toyfield" | "neonfringe" | "mysticwoods";

/** Sahne → biyom (görev tanımı + plan §6.2). Kullanıcı dünyası `annex` sahnesinin biyomunu alır; `annex = null` → çayır. */
export const SCENE_BIOME: Record<string, BiomeId> = {
  office: "countryside", home: "countryside", school: "countryside", mall: "countryside", cafe: "countryside",
  park: "forest", camp: "forest",
  beach: "beach", sea: "sea", yacht: "sea",
  istanbul: "suburb", londra: "suburb", kapadokya: "suburb",
  snow: "snowfield", space: "craters",
  battlefield: "toyfield",
  ...FULL_SCENE_BIOME,
  ...Object.fromEntries(NEW_CITIES.map((m) => [m.catalog.id, m.biome?.id ?? "suburb"])),
};

/** Şehir dış mahallesi stilleri (biyom `suburb`, stil duyarlı). */
export const CITY_STYLES: Record<string, CityStyle> = {
  istanbul: ISTANBUL_STYLE, londra: LONDRA_STYLE, kapadokya: KAPADOKYA_STYLE,
  ...FULL_CITY_STYLES,
  ...Object.fromEntries(NEW_CITY_IDS.map((id) => [id, NEW_CITY_PARTS[id].style])),
};

/** Kıyı şeridi (taban satırı J cinsinden): J < sea deniz, J < sand kum. Sahne kenar sözleşmesinden (beach j 0–4 su;
 * <city> j 0–3 deniz, 4–6 kum —). `expanse_check` dikiş sürekliliğiyle doğrular.*/
export const SCENE_COAST: Record<string, { sea: number; sand: number }> = {
  beach: { sea: 5, sand: 5 },
  ...FULL_SCENE_COAST,
  ...Object.fromEntries(NEW_CITIES.flatMap((m) => (m.biome?.coast ? [[m.catalog.id, m.biome.coast] as const] : []))),
};

export interface Palette {
  ground: readonly [string, string];
  under: string;
  road: string;
  plank: string;
  water: string;
  sand: string;
  leaf: readonly [string, string];
  trunk: string;
  rock: readonly [string, string];
  walls: readonly string[];
  roof: string;
  door: string;
  window: string;
  lit: string;
  lampPost: string;
  lampGlow: string;
  accent: readonly string[];
  barrier: string;
  /** şehir ağaç türü (stil) */
  tree: TreeKind;
}

export type FeatureKind = "tree" | "pine" | "snowpine" | "palm" | "cypress" | "bush" | "rock" | "house" | "barn" | "field"
  | "hedge" | "lamp" | "rockcone" | "crater" | "antenna" | "coral" | "kelp" | "sandbag" | "post" | "crate" | "stall"
  | "mushroom" | "bigshroom" | "crystal" | "lounger" | "parasol" | "snowhill"
  /** E2 sahiplenilmiş parsel donatısı (yalnız `generateParcel(…, plot)`; yabani biyom ağırlıklarında yok) */
  | "fence" | "bench" | "badge";

/** Bütün izinli öğe türleri (EXP-IP-001 beyaz listesi; `expanse_check` denetler). */
export const FEATURE_KINDS: readonly FeatureKind[] = ["tree", "pine", "snowpine", "palm", "cypress", "bush", "rock", "house", "barn",
  "field", "hedge", "lamp", "rockcone", "crater", "antenna", "coral", "kelp", "sandbag", "post", "crate", "stall", "mushroom",
  "bigshroom", "crystal", "lounger", "parasol", "snowhill", "fence", "bench", "badge"];

/** E2 parsel donatısı renkleri (ahşap; rozet rengi kullanıcının paletinden gelir, yazı yok — EXP-IP-001). */
export const PLOT_WOOD = "#8D6E4F";
export const PLOT_WOOD_DARK = "#6B4F3A";

export type Terrain = "ground" | "water" | "void";

export interface BiomeDef {
  id: BiomeId;
  /** varsayılan karo: kara, su (adacıklı deniz) ya da boşluk (yüzen adacıklar) */
  base: Terrain;
  /** öğe ağırlıkları; `near` yalnız ilk iki halkada geçerli çarpan (yoğun banliyö), `far` 3. halkadan sonra */
  features: readonly { kind: FeatureKind; w: number; near?: number; far?: number }[];
  /** aday karo başına yerleşim olasılığı (gürültüyle çarpılır) */
  density: number;
  /** iç gölet olasılığı (kenara değmeyen su; yalnız kara biyomu) */
  pond: number;
  /** kara lekesi (adacık) sayısı aralığı (su/boşluk biyomu) */
  islets?: readonly [number, number];
  /** yürünür buz/taş lekesi (kar ovası) olasılığı */
  patch?: number;
  /** keşif sınırı engeli (yarıçap halkasının dış kenarı) yüksekliği; 0 → engel bloğu yok (su/boşluk) */
  barrierH: number;
  /** omurga (yol/iskele) kıyı denizinin üstünden geçer mi */
  spineOverSea: boolean;
}

const B = (d: BiomeDef) => d;
export const BIOMES: Record<BiomeId, BiomeDef> = {
  suburb: B({ id: "suburb", base: "ground", density: 0.42, pond: 0.12, barrierH: 1.5, spineOverSea: false,
    features: [{ kind: "house", w: 5, near: 1.4, far: 0.35 }, { kind: "tree", w: 4 }, { kind: "hedge", w: 1.2 }, { kind: "bush", w: 1.5 },
      { kind: "lamp", w: 0.9 }, { kind: "field", w: 0.4, near: 0.2, far: 2.5 }, { kind: "rockcone", w: 0 }] }),
  countryside: B({ id: "countryside", base: "ground", density: 0.34, pond: 0.35, barrierH: 1.6, spineOverSea: false,
    features: [{ kind: "field", w: 3 }, { kind: "tree", w: 4 }, { kind: "bush", w: 2 }, { kind: "hedge", w: 1.4 }, { kind: "barn", w: 1.1 },
      { kind: "house", w: 1.6, near: 1.3, far: 0.3 }, { kind: "rock", w: 0.6 }] }),
  meadow: B({ id: "meadow", base: "ground", density: 0.26, pond: 0.3, barrierH: 1.6, spineOverSea: false,
    features: [{ kind: "tree", w: 4 }, { kind: "bush", w: 3 }, { kind: "rock", w: 1 }, { kind: "field", w: 1 }] }),
  forest: B({ id: "forest", base: "ground", density: 0.55, pond: 0.4, barrierH: 2.6, spineOverSea: false,
    features: [{ kind: "tree", w: 5 }, { kind: "pine", w: 4 }, { kind: "bush", w: 2.5 }, { kind: "rock", w: 1.2 }] }),
  beach: B({ id: "beach", base: "ground", density: 0.24, pond: 0, barrierH: 1.2, spineOverSea: false,
    features: [{ kind: "palm", w: 4 }, { kind: "lounger", w: 1.6, near: 1.5, far: 0.4 }, { kind: "parasol", w: 1.4, near: 1.5, far: 0.4 },
      { kind: "bush", w: 1.5 }, { kind: "rock", w: 1 }] }),
  sea: B({ id: "sea", base: "water", density: 0.5, pond: 0, islets: [1, 3], barrierH: 0, spineOverSea: true,
    features: [{ kind: "palm", w: 3 }, { kind: "rock", w: 2.5 }, { kind: "bush", w: 1.5 }] }),
  snowfield: B({ id: "snowfield", base: "ground", density: 0.4, pond: 0, patch: 0.45, barrierH: 1.6, spineOverSea: false,
    features: [{ kind: "snowpine", w: 5 }, { kind: "snowhill", w: 1.6 }, { kind: "rock", w: 1.2 }, { kind: "bush", w: 0.6 }] }),
  craters: B({ id: "craters", base: "ground", density: 0.28, pond: 0, barrierH: 1.5, spineOverSea: false,
    features: [{ kind: "crater", w: 2.5 }, { kind: "rock", w: 3 }, { kind: "antenna", w: 0.8 }] }),
  islets: B({ id: "islets", base: "void", density: 0.45, pond: 0, islets: [2, 3], barrierH: 0, spineOverSea: true,
    features: [{ kind: "tree", w: 3 }, { kind: "bush", w: 2.5 }, { kind: "rock", w: 1.5 }] }),
  reef: B({ id: "reef", base: "ground", density: 0.42, pond: 0, barrierH: 1.6, spineOverSea: false,
    features: [{ kind: "coral", w: 4 }, { kind: "kelp", w: 3 }, { kind: "rock", w: 2 }, { kind: "crystal", w: 0.35 }] }),
  toyfield: B({ id: "toyfield", base: "ground", density: 0.3, pond: 0.15, barrierH: 0.9, spineOverSea: false,
    features: [{ kind: "sandbag", w: 2 }, { kind: "post", w: 0.8 }, { kind: "crate", w: 1.6 }, { kind: "tree", w: 2.5 }, { kind: "bush", w: 2 },
      { kind: "rock", w: 0.8 }] }),
  neonfringe: B({ id: "neonfringe", base: "ground", density: 0.32, pond: 0.15, barrierH: 2, spineOverSea: false,
    features: [{ kind: "stall", w: 2.2 }, { kind: "crate", w: 2.5 }, { kind: "lamp", w: 1 }, { kind: "bush", w: 0.6 }] }),
  mysticwoods: B({ id: "mysticwoods", base: "ground", density: 0.5, pond: 0.3, barrierH: 2.6, spineOverSea: false,
    features: [{ kind: "tree", w: 4 }, { kind: "mushroom", w: 2.5 }, { kind: "bigshroom", w: 1 }, { kind: "crystal", w: 0.8 },
      { kind: "rock", w: 1.2 }, { kind: "bush", w: 1.5 }] }),
};

const LEAF: Record<TreeKind, readonly [string, string]> = {
  plane: ["#4E8F3A", "#5DA243"], cherry: ["#F4A6C0", "#EE8FB0"], birch: ["#8DBF4A", "#9FCB5A"], palm: ["#3E9B4F", "#4FAE5C"],
  cypress: ["#2F6B3A", "#356F3E"], judas: ["#C76BA8", "#B95E9C"],
};

const BASE: Palette = {
  ground: ["#7CB342", "#73A93D"], under: "#6B5E4E", road: "#B59A6E", plank: "#A9794E", water: "#3A8FC4", sand: "#E6D3A3",
  leaf: ["#4E8F3A", "#5DA243"], trunk: "#6B4A2F", rock: ["#8A8F98", "#7B818B"],
  walls: ["#EADBC4", "#D9C2A5", "#C9D6DF", "#E6C7B8"], roof: "#A5523E", door: "#5B3A1F", window: "#4A6378", lit: "#FFD98A",
  lampPost: "#2F3640", lampGlow: "#FFE2A0", accent: ["#D9B85C", "#8BC34A", "#C8553D", "#4A6FA5"], barrier: "#3E6B2E", tree: "plane",
};

/** Biyom paleti: sahne kimliği ve (şehirde) `CityStyle`. `swatch` sahnenin [zemin, vurgu] örneği. */
export function paletteFor(biome: BiomeId, sceneId: string, swatch: readonly [string, string]): Palette {
  const s = CITY_STYLES[sceneId];
  switch (biome) {
    case "suburb": {
      if (!s) return BASE;
      const dusty = sceneId === "kapadokya";
      return {
        ...BASE, ground: dusty ? s.ground.plaza : s.ground.grass, under: s.ground.under, road: s.ground.street[0], water: s.water,
        leaf: LEAF[s.tree], walls: s.walls, roof: s.roofColor, door: s.door, window: s.window, lit: s.windowLit,
        lampPost: s.lamp.post, lampGlow: s.lamp.glow, accent: s.awnings, barrier: dusty ? "#B98E6E" : "#4A6B3A", tree: s.tree,
        rock: dusty ? ["#D9B48A", "#C9A27A"] : BASE.rock, sand: s.ground.sidewalk[0],
      };
    }
    case "countryside": case "meadow":
      return BASE;
    case "forest": {
      const dark = sceneId === "camp";
      return { ...BASE, ground: dark ? ["#355E2E", "#30552A"] : ["#62A93F", "#5A9C3A"], leaf: dark ? ["#2C5A2C", "#336633"] : ["#3F8A3A", "#4E9B43"],
        road: dark ? "#6B5B45" : "#A8875C", barrier: dark ? "#1F3A22" : "#2F5530" };
    }
    case "beach":
      return { ...BASE, ground: ["#EBD9A8", "#E5D29E"], road: "#C49A6C", plank: "#B88A5C", water: "#1E8FD0", leaf: ["#3E9B4F", "#4FAE5C"],
        accent: ["#EF4444", "#3B82F6", "#10B981", "#F97316"], barrier: "#D9C690", tree: "palm" };
    case "sea":
      return { ...BASE, ground: ["#EBD9A8", "#E3CF9B"], road: "#B88A5C", plank: "#B88A5C", water: swatch[1], leaf: ["#3E9B4F", "#4FAE5C"],
        rock: ["#8C8577", "#7D7668"], barrier: swatch[1], tree: "palm" };
    case "snowfield":
      return { ...BASE, ground: ["#F4F7FB", "#E9EEF5"], under: "#B9C6D3", road: "#D5DCE5", leaf: ["#2F5D45", "#386B50"],
        rock: ["#8C99A8", "#7D8A99"], sand: "#BFE3F2", barrier: "#E3EAF2", lampGlow: "#FFE7B0" };
    case "craters":
      return { ...BASE, ground: ["#4A4F63", "#434859"], under: "#2A2F40", road: "#5B6176", rock: ["#6B7088", "#5D6278"],
        accent: ["#5EEAD4", "#94A3B8"], lampGlow: "#5EEAD4", barrier: "#3A3F52" };
    case "islets":
      return { ...BASE, ground: ["#7CC96B", "#74BF63"], under: "#8A6A4A", road: "#B08458", plank: "#B08458", leaf: ["#5FB35A", "#E9A3B8"],
        rock: ["#A79C8E", "#978C7E"] };
    case "reef":
      return { ...BASE, ground: ["#D8C9A0", "#CDBE94"], under: "#B3A47C", road: "#E6DAB5", leaf: ["#3F7D4E", "#4F8A5A"],
        rock: ["#6F7480", "#7E8490"], accent: ["#FF7A6B", "#FFB84D", "#C77DFF", "#4FD1C5", "#F472B6"], lampGlow: "#7DF9FF", barrier: "#5E6470" };
    case "toyfield":
      return { ...BASE, ground: ["#7FA23A", "#78993A"], road: "#CDB287", accent: ["#D97B4A", "#4A7FD9", "#E0B84A", "#6FB06A"], barrier: "#C9B07E" };
    case "neonfringe":
      return { ...BASE, ground: ["#2A2D3A", "#262935"], under: "#15171F", road: "#34384A", water: "#2B3A5C", leaf: ["#2F5D50", "#356B5C"],
        walls: ["#3A3F55", "#433A55", "#2F4552"], roof: "#22252F", lampPost: "#3A3F55", lampGlow: "#FF4FD8",
        accent: ["#FF4FD8", "#4FE3FF", "#FFD24F"], barrier: "#1E2130", rock: ["#4A4F63", "#3F4456"] };
    case "mysticwoods":
      return { ...BASE, ground: ["#3E5A3A", "#37503A"], under: "#2A3328", road: "#6B5B45", leaf: ["#2F5D50", "#3A6B58"],
        rock: ["#6E6A7E", "#5F5B6F"], accent: ["#B54A6A", "#7E57C2", "#D98B3A"], lampGlow: "#9AE6E0", barrier: "#24392F", trunk: "#4A3A30" };
  }
}

/** Blok yazıcısı: generate.ts sağlar (grup eşlemesi + parıltı sayacı). y = alt yüz (taban). */
export interface Emit {
  box(x: number, y0: number, z: number, w: number, h: number, d: number, c: string, g?: Group, j?: number): void;
}

export interface FeatureDef {
  /** ayak izi (karo; x × z) */
  w: number;
  d: number;
  /** en çok blok (bütçe) */
  cost: number;
  /** parıltı bloğu sayısı */
  glow: number;
  /** üst yükseklik (zeminden; LOD ve yasak içerik denetimi) */
  top: number;
  /** x, z: ayak izi merkezi; y: zemin üstü; r: parsel rng; p: palet */
  draw(e: Emit, x: number, y: number, z: number, r: () => number, p: Palette): void;
}

const pick = <T,>(xs: readonly T[], r: () => number) => xs[Math.floor(r() * xs.length) % xs.length];

function treeOf(e: Emit, x: number, y: number, z: number, r: () => number, p: Palette, kind: TreeKind) {
  if (kind === "palm") return palm(e, x, y, z, r, p);
  if (kind === "cypress") { e.box(x, y, z, 0.22, 0.5, 0.22, p.trunk); e.box(x, y + 0.4, z, 0.55, 2.1 + r() * 0.4, 0.55, p.leaf[0], "solid", 0.05); return; }
  const leaf = kind === "plane" || kind === "birch" ? p.leaf : LEAF[kind];
  const h = 0.9 + r() * 0.4;
  e.box(x, y, z, 0.26, h + 0.2, 0.26, kind === "birch" ? "#E8E4DA" : p.trunk);
  e.box(x, y + h, z, 1.1, 0.9, 1.1, leaf[0], "solid", 0.06);
  e.box(x + (r() - 0.5) * 0.2, y + h + 0.9, z + (r() - 0.5) * 0.2, 0.7, 0.45, 0.7, leaf[1], "solid", 0.06);
}
function palm(e: Emit, x: number, y: number, z: number, r: () => number, p: Palette) {
  const lean = (r() - 0.5) * 0.3;
  e.box(x, y, z, 0.22, 1.2, 0.22, "#8D6E4F");
  e.box(x + lean, y + 1.2, z, 0.2, 1.0, 0.2, "#7D5F42");
  e.box(x + lean * 1.5, y + 2.15, z, 1.8, 0.12, 0.42, p.leaf[0], "solid", 0.05);
  e.box(x + lean * 1.5, y + 2.2, z, 0.42, 0.12, 1.8, p.leaf[1], "solid", 0.05);
}
function pine(e: Emit, x: number, y: number, z: number, r: () => number, p: Palette, snow: boolean) {
  const s = 0.9 + r() * 0.25;
  e.box(x, y, z, 0.24, 0.6, 0.24, p.trunk);
  e.box(x, y + 0.5, z, 1.1 * s, 0.7, 1.1 * s, p.leaf[0], "solid", 0.05);
  e.box(x, y + 1.1, z, 0.8 * s, 0.7, 0.8 * s, p.leaf[1], "solid", 0.05);
  e.box(x, y + 1.7, z, 0.45 * s, 0.6, 0.45 * s, p.leaf[0], "solid", 0.05);
  if (snow) e.box(x, y + 2.3, z, 0.3 * s, 0.18, 0.3 * s, "#F8FAFC");
}

export const FEATURES: Record<FeatureKind, FeatureDef> = {
  tree: { w: 1, d: 1, cost: 4, glow: 0, top: 3, draw: (e, x, y, z, r, p) => treeOf(e, x, y, z, r, p, p.tree) },
  pine: { w: 1, d: 1, cost: 4, glow: 0, top: 2.4, draw: (e, x, y, z, r, p) => pine(e, x, y, z, r, p, false) },
  snowpine: { w: 1, d: 1, cost: 5, glow: 0, top: 2.6, draw: (e, x, y, z, r, p) => pine(e, x, y, z, r, p, true) },
  palm: { w: 1, d: 1, cost: 4, glow: 0, top: 2.4, draw: palm },
  cypress: { w: 1, d: 1, cost: 2, glow: 0, top: 3, draw: (e, x, y, z, r, p) => treeOf(e, x, y, z, r, p, "cypress") },
  bush: { w: 1, d: 1, cost: 1, glow: 0, top: 0.6,
    draw: (e, x, y, z, r, p) => e.box(x + (r() - 0.5) * 0.2, y, z + (r() - 0.5) * 0.2, 0.75, 0.5 + r() * 0.1, 0.75, p.leaf[1], "solid", 0.08) },
  rock: { w: 1, d: 1, cost: 2, glow: 0, top: 0.8, draw: (e, x, y, z, r, p) => {
    e.box(x, y, z, 0.8, 0.4 + r() * 0.2, 0.7, p.rock[0], "solid", 0.06);
    e.box(x + 0.15, y + 0.4, z - 0.1, 0.45, 0.25, 0.4, p.rock[1], "solid", 0.06);
  } },
  house: { w: 2, d: 2, cost: 6, glow: 1, top: 3.2, draw: (e, x, y, z, r, p) => {
    const hb = 1.5 + Math.floor(r() * 2) * 0.7, wall = pick(p.walls, r);
    e.box(x, y, z, 1.7, hb, 1.6, wall, "solid", 0.03);
    e.box(x, y + hb, z, 1.9, 0.22, 1.8, p.roof, "solid", 0.03);
    e.box(x, y + hb + 0.22, z, 1.3, 0.3, 0.9, p.roof, "solid", 0.03);
    e.box(x - 0.35, y, z + 0.81, 0.45, 0.9, 0.04, p.door);
    e.box(x + 0.4, y + 0.6, z + 0.81, 0.4, 0.35, 0.04, p.window);
    e.box(x + 0.4, y + hb - 0.6, z + 0.81, 0.4, 0.3, 0.04, p.lit, "glow");
  } },
  barn: { w: 2, d: 2, cost: 4, glow: 0, top: 2.6, draw: (e, x, y, z, r, _p) => {
    const red = r() < 0.5 ? "#A84A3A" : "#9A5B3A";
    e.box(x, y, z, 1.7, 1.6, 1.7, red, "solid", 0.03);
    e.box(x, y + 1.6, z, 1.85, 0.4, 1.85, "#5D4037", "solid", 0.03);
    e.box(x, y + 2.0, z, 1.1, 0.35, 1.85, "#5D4037", "solid", 0.03);
    e.box(x, y, z + 0.86, 0.8, 1.1, 0.04, "#F2E6D0");
  } },
  field: { w: 3, d: 3, cost: 3, glow: 0, top: 0.35, draw: (e, x, y, z, r, p) => {
    const crop = pick(p.accent.slice(0, 2), r);
    e.box(x, y, z, 2.8, 0.12, 2.8, "#8D6E4F", "solid", 0.04);
    e.box(x - 0.7, y + 0.12, z, 0.6, 0.22, 2.6, crop, "solid", 0.06);
    e.box(x + 0.7, y + 0.12, z, 0.6, 0.22, 2.6, crop, "solid", 0.06);
  } },
  hedge: { w: 3, d: 1, cost: 1, glow: 0, top: 0.9, draw: (e, x, y, z, _r, p) => e.box(x, y, z, 2.8, 0.85, 0.6, p.leaf[0], "solid", 0.06) },
  lamp: { w: 1, d: 1, cost: 2, glow: 1, top: 1.9, draw: (e, x, y, z, _r, p) => {
    e.box(x, y, z, 0.1, 1.7, 0.1, p.lampPost);
    e.box(x, y + 1.7, z, 0.28, 0.18, 0.28, p.lampGlow, "glow");
  } },
  rockcone: { w: 1, d: 1, cost: 4, glow: 0, top: 3.1, draw: (e, x, y, z, r, p) => {
    const s = 0.85 + r() * 0.3;
    e.box(x, y, z, 0.95 * s, 1.0, 0.95 * s, p.rock[0], "solid", 0.05);
    e.box(x, y + 1.0, z, 0.7 * s, 0.9, 0.7 * s, p.rock[1], "solid", 0.05);
    e.box(x, y + 1.9, z, 0.4 * s, 0.7, 0.4 * s, p.rock[0], "solid", 0.05);
    e.box(x, y + 2.6, z, 0.75 * s, 0.25, 0.75 * s, "#5A4A40", "solid", 0.04);
  } },
  crater: { w: 3, d: 3, cost: 5, glow: 0, top: 0.4, draw: (e, x, y, z, _r, p) => {
    e.box(x, y - 0.02, z, 2.2, 0.06, 2.2, p.under);
    e.box(x, y, z - 1.25, 2.9, 0.35, 0.45, p.rock[0], "solid", 0.05);
    e.box(x, y, z + 1.25, 2.9, 0.35, 0.45, p.rock[1], "solid", 0.05);
    e.box(x - 1.25, y, z, 0.45, 0.3, 2.0, p.rock[1], "solid", 0.05);
    e.box(x + 1.25, y, z, 0.45, 0.3, 2.0, p.rock[0], "solid", 0.05);
  } },
  antenna: { w: 1, d: 1, cost: 4, glow: 1, top: 2.1, draw: (e, x, y, z, _r, p) => {
    e.box(x, y, z, 0.5, 0.25, 0.5, p.rock[1]);
    e.box(x, y + 0.25, z, 0.08, 1.6, 0.08, "#CBD5E1");
    e.box(x, y + 1.35, z + 0.1, 0.7, 0.08, 0.5, "#E2E8F0");
    e.box(x, y + 1.85, z, 0.12, 0.12, 0.12, p.lampGlow, "glow");
  } },
  coral: { w: 1, d: 1, cost: 3, glow: 0, top: 1.3, draw: (e, x, y, z, r, p) => {
    e.box(x - 0.15, y, z, 0.35, 0.8 + r() * 0.4, 0.35, pick(p.accent, r), "solid", 0.06);
    e.box(x + 0.2, y, z + 0.15, 0.3, 0.5 + r() * 0.3, 0.3, pick(p.accent, r), "solid", 0.06);
    e.box(x, y, z - 0.2, 0.55, 0.25, 0.4, pick(p.accent, r), "solid", 0.06);
  } },
  kelp: { w: 1, d: 1, cost: 2, glow: 0, top: 2.4, draw: (e, x, y, z, r, p) => {
    e.box(x - 0.12, y, z, 0.16, 1.6 + r() * 0.6, 0.16, p.leaf[0], "solid", 0.06);
    e.box(x + 0.14, y, z + 0.1, 0.14, 1.1 + r() * 0.5, 0.14, p.leaf[1], "solid", 0.06);
  } },
  sandbag: { w: 3, d: 1, cost: 2, glow: 0, top: 0.8, draw: (e, x, y, z, _r, p) => {
    e.box(x, y, z, 2.8, 0.5, 0.6, p.barrier, "solid", 0.06);
    e.box(x, y + 0.5, z, 2.4, 0.25, 0.5, "#BFA470", "solid", 0.06);
  } },
  post: { w: 1, d: 1, cost: 1, glow: 0, top: 2, draw: (e, x, y, z, _r, p) => e.box(x, y, z, 0.12, 2, 0.12, p.trunk) },
  crate: { w: 1, d: 1, cost: 1, glow: 0, top: 0.8, draw: (e, x, y, z, r, p) => {
    const s = 0.55 + r() * 0.25;
    e.box(x, y, z, s, s, s, pick(p.accent, r), "solid", 0.04);
  } },
  stall: { w: 2, d: 1, cost: 5, glow: 1, top: 2.1, draw: (e, x, y, z, r, p) => {
    e.box(x, y, z, 1.8, 0.9, 0.8, pick(p.walls, r), "solid", 0.04);
    e.box(x - 0.85, y, z + 0.4, 0.08, 1.9, 0.08, p.lampPost);
    e.box(x + 0.85, y, z + 0.4, 0.08, 1.9, 0.08, p.lampPost);
    e.box(x, y + 1.9, z + 0.1, 2.0, 0.1, 1.0, pick(p.accent, r), "solid", 0.03);
    e.box(x, y + 0.9, z + 0.42, 1.6, 0.08, 0.04, pick(p.accent, r), "glow");
  } },
  mushroom: { w: 1, d: 1, cost: 2, glow: 0, top: 1.4, draw: (e, x, y, z, r, p) => {
    const h = 0.6 + r() * 0.5;
    e.box(x, y, z, 0.26, h, 0.26, "#E9E2D0");
    e.box(x, y + h, z, 0.9, 0.3, 0.9, pick(p.accent, r), "solid", 0.05);
  } },
  bigshroom: { w: 2, d: 2, cost: 3, glow: 0, top: 2.9, draw: (e, x, y, z, r, p) => {
    e.box(x, y, z, 0.55, 2.0, 0.55, "#E9E2D0");
    e.box(x, y + 2.0, z, 1.9, 0.45, 1.9, pick(p.accent, r), "solid", 0.04);
    e.box(x, y + 2.45, z, 1.2, 0.3, 1.2, pick(p.accent, r), "solid", 0.04);
  } },
  crystal: { w: 1, d: 1, cost: 2, glow: 2, top: 1.3, draw: (e, x, y, z, r, p) => {
    e.box(x, y, z, 0.3, 0.9 + r() * 0.4, 0.3, p.lampGlow, "glow");
    e.box(x + 0.2, y, z + 0.15, 0.18, 0.55, 0.18, p.lampGlow, "glow");
  } },
  lounger: { w: 1, d: 1, cost: 2, glow: 0, top: 0.6, draw: (e, x, y, z, r, p) => {
    const c = pick(p.accent, r);
    e.box(x, y, z + 0.05, 0.5, 0.25, 0.9, "#F8FAFC");
    e.box(x, y + 0.25, z - 0.35, 0.5, 0.3, 0.12, c);
  } },
  parasol: { w: 1, d: 1, cost: 2, glow: 0, top: 2, draw: (e, x, y, z, r, p) => {
    e.box(x, y, z, 0.07, 1.8, 0.07, "#E5E7EB");
    e.box(x, y + 1.8, z, 1.4, 0.12, 1.4, pick(p.accent, r), "solid", 0.03);
  } },
  snowhill: { w: 2, d: 2, cost: 2, glow: 0, top: 1, draw: (e, x, y, z, _r, p) => {
    e.box(x, y, z, 1.9, 0.55, 1.9, p.ground[0], "solid", 0.03);
    e.box(x, y + 0.55, z, 1.2, 0.4, 1.2, p.ground[1], "solid", 0.03);
  } },
  // E2 parsel donatısı: çit parçası (generate.ts koşu boyunca uzatır), mola bankı, yazısız renk rozeti (direk + küp)
  fence: { w: 1, d: 1, cost: 2, glow: 0, top: 0.85, draw: (e, x, y, z) => {
    e.box(x, y, z, 0.96, 0.75, 0.12, PLOT_WOOD, "solid", 0.04);
    e.box(x, y + 0.75, z, 1, 0.1, 0.2, PLOT_WOOD_DARK);
  } },
  bench: { w: 2, d: 1, cost: 4, glow: 0, top: 0.93, draw: (e, x, y, z) => {
    e.box(x - 0.65, y, z, 0.12, 0.38, 0.4, PLOT_WOOD_DARK);
    e.box(x + 0.65, y, z, 0.12, 0.38, 0.4, PLOT_WOOD_DARK);
    e.box(x, y + 0.38, z, 1.6, 0.1, 0.5, PLOT_WOOD, "solid", 0.04);
    e.box(x, y + 0.48, z - 0.21, 1.6, 0.45, 0.08, PLOT_WOOD, "solid", 0.04);
  } },
  badge: { w: 1, d: 1, cost: 2, glow: 0, top: 1.85, draw: (e, x, y, z, _r, p) => {
    e.box(x, y, z, 0.14, 1.3, 0.14, PLOT_WOOD_DARK);
    e.box(x, y + 1.3, z, 0.55, 0.55, 0.55, p.accent[0]);
  } },
};

/** Sahneye özgü ağırlık ekleri (biyom tablosunun üstüne): Kapadokya dış mahallesinde jenerik kaya konileri (simge değil;
 * kale kayası, kilise, Paşabağ gibi tanınır silüetler üretilmez), <city>'te servi yerine çınar zaten stilde.*/
export const SCENE_WEIGHTS: Record<string, Partial<Record<FeatureKind, number>>> = {
  kapadokya: { rockcone: 2.2, field: 1.2 },
  ...FULL_SCENE_WEIGHTS,
  ...Object.fromEntries(NEW_CITIES.flatMap((m) => (m.biome?.weights ? [[m.catalog.id, m.biome.weights] as const] : []))),
};

/** Keşif sınırı engeli rengi ve türü (yarıçap halkası dış kenarı; ince açıklama). */
export const BARRIER_NOTE: Record<BiomeId, string> = {
  suburb: "çit/bahçe duvarı", countryside: "çalı çiti", meadow: "çalı çiti", forest: "sık orman", beach: "kum tepesi", sea: "açık deniz",
  snowfield: "kar sırtı", craters: "krater duvarı", islets: "boşluk", reef: "kaya duvarı", toyfield: "kum torbası hattı",
  neonfringe: "arka sokak duvarı", mysticwoods: "sık koyu orman",
};
