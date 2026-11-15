/**
 * bölge stil belirteçleri: yeni şehirlerin `CityStyle` paleti ve ortak parça
 * malzemeleri. Her şehir bir bölge tabanından türetir (`cityStyle("mediterranean", "<id>", {...küçük farklar })`), böylece
 * 12 şehir aynı okunurluk ve içerik kurallarını baştan taşır; şehre özgü ton yalnız `patch` ile gelir.
 *
 * Kurallar (`scripts/city_tokens.test.mjs` denetler):
 * - Okunurluk: pencere ve kapı her cephe renginden, gece penceresi gündüz penceresinden, sokak kaldırımdan, su rıhtımdan,
 * fener ışığı direkten ayrışır (kontrast oranı tabanları testte; mevcut 7 şehrin en zayıfından düşük değil).
 * - İçerik (costume_policy G-U / G-K / G-6..8 imzaları şehir stillerine de uygulanır, plan §4.3 "kulüp ve bayrak"): sıralı
 * renk listeleri (tente, cephe, fener, mal, ufuk) döngüyle yan yana dizildiğinde ulusal bayrak dizisi, kimlik bayrağı ya da
 * sıralı gökkuşağı oluşturmaz. Tentede iki renkli şerit ve beyaz ara bant yerine tek renk tente + aynı renk saçak kullanılır (parçalar).
 * - Marka/livre yok: ulaşım şirketi, kulüp ya da ülke rengi "imza" olarak seçilmez; renkler özgün ve doğal malzeme tonudur.
 * Saf modül (yalnız tipler ve sabitler).
*/
import type { CityRegion } from "../cities/types";
import type { CityStyle } from "./style";

/** Palet tabanları (O5 paket gruplarından ince; bir şehir tek tabandan türetir). */
export type TokenRegion =
  | "mediterranean" | "north_europe" | "se_asia" | "east_asia" | "maghreb" | "gulf" | "nile" | "oceania" | "latin_america";

/** Ortak parça malzemeleri (city/parts/*): taş, sıva, tuğla, ahşap, metal, kiremit, cam, kumaş ve sıralı süs listeleri. */
export interface Materials {
  stone: string;
  stoneDark: string;
  plaster: string;
  brick: string;
  wood: string;
  metal: string;
  tile: string;
  glass: string;
  /** tente ve gölgelik kumaşı (tek renk; şerit yok) */
  canvas: string;
  /** fener dizisi (karışık, yazısız) */
  lantern: readonly string[];
  /** pazar malları */
  goods: readonly string[];
  /** tekne gövdesi */
  hull: string;
  /** su (rıhtım, kanal) */
  water: string;
}

export interface RegionTokens {
  id: TokenRegion;
  /** rapor/belge adı (arayüze girmez) */
  label: string;
  /** bu tabanı varsayılan alan katalog bölgeleri */
  regions: readonly CityRegion[];
  style: Omit<CityStyle, "id">;
  mat: Materials;
}

const T = (t: RegionTokens) => t;

export const REGION_TOKENS: Readonly<Record<TokenRegion, RegionTokens>> = {
  mediterranean: T({
    id: "mediterranean", label: "Akdeniz", regions: ["europe"],
    style: {
      ground: { street: ["#5E6370", "#575C69"], sidewalk: ["#D3C8B4", "#C9BEA9"], plaza: ["#DCCBAA", "#D2C09D"],
        grass: ["#7DAF4A", "#73A443"], quay: ["#B0A48F", "#A59984"], under: "#6E5F4C" },
      water: "#2F86B8", facade: "row", walls: ["#EAD7B5", "#D9A77F", "#E6C9A0", "#CFB59A"], trim: "#F6F0E4",
      roof: "tile", roofColor: "#B5573E", window: "#3F5A70", windowLit: "#FFD98A", door: "#5B3A1F", tree: "plane",
      lamp: { post: "#2F3640", glow: "#FFE2A0" }, awnings: ["#3F7D6E", "#C47A35", "#4A6FA5", "#9C4F3E"],
      far: ["#A7B6C2", "#B3C0CB", "#99AAB8"],
    },
    mat: { stone: "#D8C8A8", stoneDark: "#B39F7E", plaster: "#EAD7B5", brick: "#B8664A", wood: "#7A5232", metal: "#3A3F47",
      tile: "#B5573E", glass: "#A8D8F0", canvas: "#3F7D6E", lantern: ["#E0A43A", "#D7653F", "#E8C77A", "#7FA36A"],
      goods: ["#E07B39", "#D9B44A", "#8DB255", "#B5443A"], hull: "#2F5C7A", water: "#2F86B8" },
  }),
  north_europe: T({
    id: "north_europe", label: "Kuzey Avrupa", regions: ["europe"],
    style: {
      ground: { street: ["#555A63", "#4F545D"], sidewalk: ["#BDB7AC", "#B3ADA2"], plaza: ["#C9BBA4", "#BFB19A"],
        grass: ["#6FA650", "#669B49"], quay: ["#9C968B", "#918B80"], under: "#5C5348" },
      water: "#4E7C8C", facade: "row", walls: ["#8E4A3A", "#5E6B57", "#C9B79A", "#7A8C9C"], trim: "#F2EFE8",
      roof: "tile", roofColor: "#4F4A47", window: "#22303C", windowLit: "#FFDCA0", door: "#2E3A2E", tree: "birch",
      lamp: { post: "#25292E", glow: "#FFE2A8" }, awnings: ["#2F5D4E", "#8C5A2B", "#5A6E8C", "#7A3F3A"],
      far: ["#9AA6B1", "#A6B1BB", "#8F9CA8"],
    },
    mat: { stone: "#B9B2A4", stoneDark: "#8F887B", plaster: "#E4DED2", brick: "#8E4A3A", wood: "#5E4330", metal: "#25292E",
      tile: "#4F4A47", glass: "#B5D3E0", canvas: "#2F5D4E", lantern: ["#E8C77A", "#D98C4A", "#C9D4A0", "#E3A86B"],
      goods: ["#D9643A", "#E0B84A", "#7FA34E", "#C99A6B"], hull: "#3A4A55", water: "#4E7C8C" },
  }),
  se_asia: T({
    id: "se_asia", label: "Güneydoğu Asya", regions: ["asia"],
    style: {
      ground: { street: ["#55595F", "#4F5359"], sidewalk: ["#CFC6B4", "#C5BCA9"], plaza: ["#D9CBAE", "#CFC1A3"],
        grass: ["#5FAE4A", "#57A243"], quay: ["#A89D88", "#9D927D"], under: "#5E5140" },
      water: "#3F7A6A", facade: "row", walls: ["#E6D2A8", "#9FC2B0", "#E3B79A", "#B7C7D9"], trim: "#F7F2E6",
      roof: "tile", roofColor: "#A4513A", window: "#2F4A44", windowLit: "#FFD27A", door: "#5A3622", tree: "plane",
      lamp: { post: "#2E3238", glow: "#FFDDA0" }, awnings: ["#2F6E5E", "#C98A2E", "#3E6A8F", "#9A4A32"],
      far: ["#A2B4B0", "#AFC0BC", "#97AAA6"],
    },
    mat: { stone: "#CBBFA6", stoneDark: "#A39679", plaster: "#E6D2A8", brick: "#A85A3C", wood: "#6E4A2C", metal: "#33383E",
      tile: "#A4513A", glass: "#A8D8E8", canvas: "#2F6E5E", lantern: ["#E0A43A", "#D7653F", "#E8D08A", "#8FB46A"],
      goods: ["#E8A23A", "#D95F3A", "#9BC24E", "#F2D35A"], hull: "#7A4A2A", water: "#3F7A6A" },
  }),
  east_asia: T({
    id: "east_asia", label: "Doğu Asya", regions: ["asia"],
    style: {
      ground: { street: ["#4E535C", "#494E57"], sidewalk: ["#C6C3BC", "#BCB9B2"], plaza: ["#D6CBB8", "#CCC1AD"],
        grass: ["#7DB85B", "#74AE53"], quay: ["#A9A59B", "#9E9A90"], under: "#5A5148" },
      water: "#3F7F96", facade: "row", walls: ["#ECE7DD", "#C9CED3", "#DCC3A6", "#BCCBCB"], trim: "#F3F0EA",
      roof: "curved", roofColor: "#4A5560", window: "#3F5568", windowLit: "#FFE2A6", door: "#3A2E26", tree: "cherry",
      lamp: { post: "#2E3238", glow: "#FFE8B8" }, awnings: ["#2F5C7A", "#C98A3A", "#3E7D5A", "#8A4A3E"],
      far: ["#A9B5C4", "#B5C0CD", "#9EABBB"],
    },
    mat: { stone: "#C9C2B2", stoneDark: "#9E978A", plaster: "#ECE7DD", brick: "#8C5A44", wood: "#6A4A34", metal: "#2E3238",
      tile: "#4A5560", glass: "#B8D8E6", canvas: "#2F5C7A", lantern: ["#E0A43A", "#E8D6A8", "#D7653F", "#E8C77A"],
      goods: ["#E08A3A", "#D9C24A", "#8DB255", "#C76A5A"], hull: "#6A4A34", water: "#3F7F96" },
  }),
  maghreb: T({
    id: "maghreb", label: "Mağrip", regions: ["africa"],
    style: {
      ground: { street: ["#6A5E52", "#62574B"], sidewalk: ["#D9B994", "#CFAE88"], plaza: ["#E0C29C", "#D6B790"],
        grass: ["#7FA34A", "#759843"], quay: ["#B39A7C", "#A88F71"], under: "#6E5440" },
      water: "#2E7A96", facade: "row", walls: ["#D98C64", "#E3B48A", "#C9785A", "#E8D2B0"], trim: "#F4E9D6",
      roof: "flat", roofColor: "#B8805C", window: "#2E4A5C", windowLit: "#FFD27A", door: "#3E5A7A", tree: "judas",
      lamp: { post: "#3A2E26", glow: "#FFD898" }, awnings: ["#3E6A8F", "#C98A2E", "#5E7F4A", "#A4513A"],
      far: ["#C9B49A", "#D3BFA6", "#BFA98E"],
    },
    mat: { stone: "#D9B994", stoneDark: "#B08A66", plaster: "#E3B48A", brick: "#B8664A", wood: "#6E4A2C", metal: "#3A2E26",
      tile: "#3F7D6E", glass: "#A8D0E0", canvas: "#C98A2E", lantern: ["#E0A43A", "#C9785A", "#E8C77A", "#6E9A7A"],
      goods: ["#D9643A", "#E8B84A", "#B5443A", "#8DA24E"], hull: "#3E6A8F", water: "#2E7A96" },
  }),
  gulf: T({
    id: "gulf", label: "Körfez", regions: ["middle_east"],
    style: {
      ground: { street: ["#5A5F68", "#545961"], sidewalk: ["#DCCDB4", "#D2C3A9"], plaza: ["#E4D4B8", "#DACAAD"],
        grass: ["#86AF52", "#7CA44B"], quay: ["#B6A88F", "#AB9D84"], under: "#76654E" },
      water: "#2E8FA3", facade: "row", walls: ["#E8DCC4", "#D9C3A0", "#C9B79A", "#B9C7CC"], trim: "#F7F2E8",
      roof: "flat", roofColor: "#C9B48E", window: "#2E4A5C", windowLit: "#FFDA90", door: "#5A3E26", tree: "plane",
      lamp: { post: "#3A3F47", glow: "#FFE4A8" }, awnings: ["#3E6A8F", "#B87A3A", "#4E7F6A", "#8F5A44"],
      far: ["#B9C3CC", "#C4CDD5", "#AEB9C3"],
    },
    mat: { stone: "#D9C8A6", stoneDark: "#B39E7A", plaster: "#E8DCC4", brick: "#B88A5E", wood: "#6E4A2C", metal: "#3A3F47",
      tile: "#C9B48E", glass: "#9FC9DA", canvas: "#3E6A8F", lantern: ["#E0A43A", "#E8D6A8", "#C9785A", "#E3B86B"],
      goods: ["#D98C3A", "#C9B04A", "#A4513A", "#8DA24E"], hull: "#8A6A44", water: "#2E8FA3" },
  }),
  nile: T({
    id: "nile", label: "Nil", regions: ["africa", "middle_east"],
    style: {
      ground: { street: ["#62594E", "#5A5247"], sidewalk: ["#D6C3A0", "#CCB995"], plaza: ["#DEC9A2", "#D4BF97"],
        grass: ["#7FA64A", "#769B43"], quay: ["#B09E80", "#A59375"], under: "#6E5A42" },
      water: "#3E7F96", facade: "row", walls: ["#DCC39A", "#CDAE84", "#E6D3B0", "#BFA585"], trim: "#F2E8D6",
      roof: "flat", roofColor: "#B49A72", window: "#2E4352", windowLit: "#FFD488", door: "#4A3626", tree: "plane",
      lamp: { post: "#3A3228", glow: "#FFDCA0" }, awnings: ["#3E6A8F", "#C98A2E", "#5E7F4A", "#8F5A44"],
      far: ["#C6B79C", "#D0C2A8", "#BBAC91"],
    },
    mat: { stone: "#D6C3A0", stoneDark: "#AD9670", plaster: "#E6D3B0", brick: "#A8744E", wood: "#5E4330", metal: "#3A3228",
      tile: "#B49A72", glass: "#A0C8D8", canvas: "#3E6A8F", lantern: ["#E0A43A", "#7FA0B8", "#E8C77A", "#C9785A"],
      goods: ["#D98C3A", "#E8C24A", "#8DA24E", "#B5603A"], hull: "#E6D8BE", water: "#3E7F96" },
  }),
  oceania: T({
    id: "oceania", label: "Okyanusya", regions: ["oceania"],
    style: {
      ground: { street: ["#585D66", "#52575F"], sidewalk: ["#CFCAC0", "#C5C0B6"], plaza: ["#D9CFBC", "#CFC5B1"],
        grass: ["#78B04E", "#6FA547"], quay: ["#A8A196", "#9D968B"], under: "#62584C" },
      water: "#2E86B0", facade: "row", walls: ["#E9E4D8", "#C8A88A", "#B9CAD3", "#D8C49E"], trim: "#F7F5EF",
      roof: "tile", roofColor: "#8A5A44", window: "#33505F", windowLit: "#FFDC98", door: "#3E4A3A", tree: "plane",
      lamp: { post: "#30353C", glow: "#FFE6B0" }, awnings: ["#2F6E8A", "#C98A3A", "#4E7F5A", "#8F4E44"],
      far: ["#A6B8C6", "#B2C3D0", "#9BAEBC"],
    },
    mat: { stone: "#CFC6B4", stoneDark: "#A39A88", plaster: "#E9E4D8", brick: "#A4583E", wood: "#7A5638", metal: "#30353C",
      tile: "#8A5A44", glass: "#B0D8EA", canvas: "#2F6E8A", lantern: ["#E8C77A", "#E0A43A", "#9FC2B0", "#D98C6A"],
      goods: ["#E89A3A", "#D9C24A", "#8DB255", "#C76A5A"], hull: "#F2EFE8", water: "#2E86B0" },
  }),
  latin_america: T({
    id: "latin_america", label: "Latin Amerika", regions: ["americas"],
    style: {
      ground: { street: ["#5B5E66", "#55585F"], sidewalk: ["#D0C3AC", "#C6B9A1"], plaza: ["#D9C7A6", "#CFBD9B"],
        grass: ["#6DB04A", "#64A543"], quay: ["#A89C88", "#9D917D"], under: "#665640" },
      water: "#24789A", facade: "row", walls: ["#E3A76A", "#7FB3A8", "#E6C35C", "#C98AA0"], trim: "#F6F1E6",
      roof: "tile", roofColor: "#A8553A", window: "#2F4552", windowLit: "#FFD27A", door: "#4A3020", tree: "judas",
      lamp: { post: "#2E3238", glow: "#FFDDA0" }, awnings: ["#2F6E8A", "#C98A2E", "#7A4A8A", "#4E8A5A"],
      far: ["#A9B6BE", "#B5C1C8", "#9EABB4"],
    },
    mat: { stone: "#CDBB9C", stoneDark: "#A3906F", plaster: "#E6C35C", brick: "#A85A3C", wood: "#6E4A2C", metal: "#2E3238",
      tile: "#A8553A", glass: "#A8D8E8", canvas: "#2F6E8A", lantern: ["#E0A43A", "#7FB3A8", "#E8C77A", "#C98AA0"],
      goods: ["#E8A23A", "#D95F3A", "#9BC24E", "#E6C35C"], hull: "#2F6E8A", water: "#24789A" },
  }),
};

export const TOKEN_REGIONS = Object.keys(REGION_TOKENS) as TokenRegion[];

/** Katalog bölgesi → varsayılan palet tabanı (iskele `--tokens` verilmezse). */
export const DEFAULT_TOKENS: Readonly<Record<CityRegion, TokenRegion>> = {
  europe: "mediterranean", asia: "east_asia", middle_east: "gulf", africa: "maghreb", americas: "latin_america", oceania: "oceania",
};

/** Bölge tabanından şehir stili (`patch` yalnız şehre özgü küçük farklar; dizi alanları bütün olarak değişir). */
export function cityStyle(region: TokenRegion, id: string, patch: Partial<Omit<CityStyle, "id">> = {}): CityStyle {
  const base = REGION_TOKENS[region].style;
  return {
    ...base, ...patch, id,
    ground: { ...base.ground, ...(patch.ground ?? {}) },
    lamp: { ...base.lamp, ...(patch.lamp ?? {}) },
  };
}

/** Bölge tabanından parça malzemeleri. */
export function materials(region: TokenRegion, patch: Partial<Materials> = {}): Materials {
  return { ...REGION_TOKENS[region].mat, ...patch };
}

/** Parçaların varsayılan (nötr) malzemesi: çağıran renk vermezse. */
export const NEUTRAL: Materials = REGION_TOKENS.mediterranean.mat;
