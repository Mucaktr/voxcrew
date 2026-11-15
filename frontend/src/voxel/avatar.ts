import { tx } from "../lib/i18n";
import type { Avatar, Beard, Cape, Emblem, Glasses, HairStyle, Hat, Mask, Outfit, Species } from "../lib/types";
import { heroesMsg as H } from "../locales/heroes";
import { world as M } from "../locales/world";
import { BEARD_BY, HAIR_BY, OUTFIT_BY, SKIRT_OUTFITS, type Presentation } from "../lib/presentation";

type Key = keyof typeof M.tr;
/** Seçenek listeleri: `label` dile duyarlı getter (locales/world.ts); AvatarEditor gibi okuyucular değişmeden iki dil alır. */
function opt<T extends string, X extends object>(prefix: string, id: T, extra: X = {} as X): { id: T; label: string } & X {
  return Object.defineProperty({ id, ...extra }, "label", { get: () => tx(M, `${prefix}_${id}` as Key), enumerable: true }) as { id: T; label: string } & X;
}

export const SPECIES: { id: Species; label: string; fur: string }[] = [
  opt("species", "human", { fur: "#E0AC69" }), opt("species", "cat", { fur: "#A39A92" }), opt("species", "dog", { fur: "#C68B59" }),
  opt("species", "fox", { fur: "#E8833A" }), opt("species", "bear", { fur: "#8D6E63" }), opt("species", "rabbit", { fur: "#F3F4F6" }),
  opt("species", "panda", { fur: "#F5F5F4" }), opt("species", "penguin", { fur: "#2B2D42" }),
];

export const SKIN_TONES = ["#FCE3CF", "#F5D0B5", "#E0AC69", "#C68642", "#8D5524", "#5C3A21"];
export const FUR_TONES = ["#E8833A", "#A39A92", "#C68B59", "#8D6E63", "#F3F4F6", "#2B2D42", "#F2C14E", "#5B4636", "#D6D3D1"];
export const HAIR_COLORS = ["#1F1A17", "#4A2F1D", "#8B5A2B", "#D4A55C", "#E8E1D3", "#B23A48", "#6C5CE7", "#2EC4B6"];
export const OUTFIT_COLORS = ["#2D6CDF", "#E85D75", "#334155", "#10B981", "#F59E0B", "#8E6CEF", "#F8FAFC", "#0EA5E9", "#EF4444", "#1F2937"];
export const ACCENT_COLORS = ["#FFD166", "#E11D48", "#22C55E", "#FFF1E6", "#38BDF8", "#F472B6", "#FB923C", "#111827"];

export const HAIR: { id: HairStyle; label: string }[] = (["short", "long", "bob", "curly", "bun", "ponytail", "spiky", "mohawk", "bald"] as HairStyle[])
  .map((id) => opt("hair", id));
export const BEARDS: { id: Beard; label: string }[] = (["none", "stubble", "full", "goatee", "mustache"] as Beard[]).map((id) => opt("beard", id));
export const OUTFITS: { id: Outfit; label: string }[] = (["tshirt", "shirt", "hoodie", "blazer", "sweater", "suit", "labcoat", "dress", "overalls", "hawaii"] as Outfit[])
  .map((id) => opt("outfit", id));
export const GLASSES: { id: Glasses; label: string }[] = (["none", "round", "square", "sun", "star"] as Glasses[]).map((id) => opt("glasses", id));
export const HATS: { id: Hat; label: string }[] = (["none", "cap", "beanie", "beret", "straw", "tophat", "headphones", "crown", "party"] as Hat[])
  .map((id) => opt("hat", id));

export const DEFAULT_AVATAR: Avatar = {
  species: "human", skin: "#E0AC69", hair: "short", hairColor: "#4A2F1D", beard: "none",
  outfit: "hoodie", outfitColor: "#2D6CDF", accent: "#FFD166", glasses: "none", hat: "none",
};

export function normalizeAvatar(a?: Partial<Avatar> | null): Avatar {
  return { ...DEFAULT_AVATAR, ...(a || {}) } as Avatar;
}

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

// ------------------------------------------------------------------ S34: insan karakterler birinci sınıf
/** Ücretsiz kıyafet/gözlük/şapka (game/catalog.py STARTER_COSMETICS + mağazada olmayan gömlek/ceket). Hazır görünümler
 *  ve "rastgele" yalnızca bunları kullanır; mağaza öğeleri satın alınarak açılır. */
export const FREE_OUTFITS: readonly Outfit[] = ["tshirt", "shirt", "hoodie", "blazer", "sweater", "overalls"];
export const FREE_GLASSES: readonly Glasses[] = ["none", "round", "square"];
export const FREE_HATS: readonly Hat[] = ["none", "cap", "beanie", "headphones"];
export const ANIMAL_SPECIES: readonly Species[] = ["cat", "dog", "fox", "bear", "rabbit", "panda", "penguin"];
export const isHuman = (a: Pick<Avatar, "species">) => a.species === "human";

const look = (skin: string, hair: HairStyle, hairColor: string, beard: Beard, outfit: Outfit, outfitColor: string, accent: string,
  glasses: Glasses = "none", hat: Hat = "none"): Avatar => ({ species: "human", skin, hair, hairColor, beard, outfit, outfitColor, accent, glasses, hat });

/** Hazır insan görünümleri: farklı ten, saç, sakal, gözlük ve kıyafetler (cinsiyetten bağımsız çeşitlilik; ücretsiz). */
export const HUMAN_LOOKS: readonly Avatar[] = [
  look("#C68642", "short", "#1F1A17", "stubble", "hoodie", "#2D6CDF", "#38BDF8", "square"),
  look("#F5D0B5", "bob", "#B45309", "none", "blazer", "#334155", "#FFD166", "round"),
  look("#8D5524", "curly", "#1F1A17", "none", "shirt", "#F8FAFC", "#0EA5E9"),
  look("#E0AC69", "ponytail", "#4A2F1D", "none", "sweater", "#10B981", "#FFF1E6", "none", "headphones"),
  look("#5C3A21", "bald", "#E8E1D3", "full", "blazer", "#8E6CEF", "#FFF1E6", "round"),
  look("#FCE3CF", "long", "#D4A55C", "none", "tshirt", "#E85D75", "#FFD166", "round"),
  look("#C68642", "bun", "#1F1A17", "none", "shirt", "#0EA5E9", "#F8FAFC", "none", "none"),
  look("#F5D0B5", "spiky", "#8B5A2B", "goatee", "overalls", "#334155", "#FB923C", "none", "beanie"),
];

/** GIFTS-GENDER: her hazır görünümün sunumu (backend `agents.py` PRESET_PRESENTATION ile aynı sıra); `n` herkese uyar. */
export const HUMAN_LOOK_PRESENTATION: readonly Presentation[] = ["m", "f", "n", "f", "m", "f", "n", "m"];
/** Sunuma uyan hazır görünümler (nötr: hepsi). */
export const looksFor = (p: Presentation): Avatar[] => HUMAN_LOOKS.filter((_, i) => p === "n" || HUMAN_LOOK_PRESENTATION[i] === p || HUMAN_LOOK_PRESENTATION[i] === "n");
/** Kadın kesimi etek giyer mi (insan + sunum f + etek giyen kıyafet; elbise zaten eteklidir)? */
export const hasSkirt = (a: Pick<Avatar, "species" | "presentation" | "outfit">) =>
  a.presentation === "f" && (!a.species || a.species === "human") && SKIRT_OUTFITS.has(a.outfit);

/** Yerel kostümün kadın kesimi (`local-<şehir>-<parça>-f`; cosmetics/local/index.ts). */
export const isFemVariant = (wear: string | undefined) => !!wear && wear.startsWith("local-") && wear.endsWith("-f");
/** Etek rengi: ceket koyu lacivert, gömlek gri, diğerleri kıyafet renginin koyusu. */
export const skirtColor = (a: Pick<Avatar, "outfit" | "outfitColor">) =>
  a.outfit === "blazer" ? "#2B3445" : a.outfit === "shirt" ? "#4B5563" : shade(a.outfitColor, -0.3);

/** Rastgele insan; `p` (m/f/n) saç, sakal ve kıyafet havuzunu belirler: erkek → sakal serbest, kadın → sakalsız + etek kesimi. */
export function randomHuman(p: Presentation = "n"): Avatar {
  return {
    species: "human",
    skin: pick(SKIN_TONES),
    hair: pick(HAIR_BY[p]),
    hairColor: pick(HAIR_COLORS.slice(0, 5)),
    beard: pick(BEARD_BY[p]),
    outfit: pick(OUTFIT_BY[p]),
    outfitColor: pick(OUTFIT_COLORS),
    accent: pick(ACCENT_COLORS),
    glasses: Math.random() < 0.4 ? pick(FREE_GLASSES.slice(1)) : "none",
    hat: Math.random() < 0.2 ? pick(FREE_HATS.slice(1)) : "none",
  };
}

export function randomAnimal(): Avatar {
  const sp = SPECIES.find((s) => s.id === pick(ANIMAL_SPECIES))!;
  return {
    species: sp.id, skin: Math.random() < 0.6 ? sp.fur : pick(FUR_TONES), hair: "none", hairColor: pick(HAIR_COLORS), beard: "none",
    outfit: pick(FREE_OUTFITS), outfitColor: pick(OUTFIT_COLORS), accent: pick(ACCENT_COLORS),
    glasses: Math.random() < 0.35 ? pick(FREE_GLASSES.slice(1)) : "none",
    hat: Math.random() < 0.45 ? pick(FREE_HATS.slice(1)) : "none",
  };
}

/** Tüm türlerden rastgele (eski davranış; mağaza öğeleri de çıkabilir — çağıran kilitleri temizler). */
export function randomAvatar(): Avatar {
  const sp = pick(SPECIES);
  const human = sp.id === "human";
  return {
    species: sp.id,
    skin: human ? pick(SKIN_TONES) : Math.random() < 0.6 ? sp.fur : pick(FUR_TONES),
    hair: human ? pick(HAIR).id : "none",
    hairColor: pick(HAIR_COLORS),
    beard: human && Math.random() < 0.35 ? pick(BEARDS.slice(1)).id : "none",
    outfit: pick(OUTFITS).id,
    outfitColor: pick(OUTFIT_COLORS),
    accent: pick(ACCENT_COLORS),
    glasses: Math.random() < 0.4 ? pick(GLASSES.slice(1)).id : "none",
    hat: Math.random() < 0.55 ? pick(HATS.slice(1)).id : "none",
  };
}

/** Rengi koyulaştır/açıklaştır (-1..1). */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c: number) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  r = f(r); g = f(g); b = f(b);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function pantsColor(a: Avatar): string {
  if (hasSkirt(a) && (!a.wear || isFemVariant(a.wear))) return a.skin; // etek: çıplak bacak (elbise ile aynı)
  switch (a.outfit) {
    case "suit": return shade(a.outfitColor, -0.25);
    case "blazer": return "#2B3445";
    case "shirt": return "#4B5563";
    case "overalls": return a.outfitColor;
    case "labcoat": return "#4B5563";
    case "dress": return a.skin;
    default: return "#3D5A80";
  }
}

export function shortSleeves(a: Avatar) {
  return a.outfit === "tshirt" || a.outfit === "hawaii";
}

// ------------------------------------------------------------------ S44: kahraman donanımı (ücretsiz, kilitsiz)
/** Pelerin, maske, göğüs amblemi, bot/eldiven, parıltı ve süzülme. Mağazada değildir (game/catalog.py SHOP dışında →
 *  her zaman açık); kahraman paketleri (backend/studio/heroes) bu değerleri kullanır. Amblemler özgün soyut glifler. */
function heroOpt<T extends string>(prefix: string, id: T): { id: T; label: string } {
  return Object.defineProperty({ id }, "label", { get: () => tx(H, `${prefix}_${id}` as keyof typeof H.tr), enumerable: true }) as { id: T; label: string };
}
export const HERO_CAPES: { id: Cape; label: string }[] = (["none", "short", "long"] as Cape[]).map((id) => heroOpt("cape", id));
export const HERO_MASKS: { id: Mask; label: string }[] = (["none", "domino", "visor", "cowl"] as Mask[]).map((id) => heroOpt("mask", id));
export const HERO_EMBLEMS: { id: Emblem; label: string }[] = (["none", "ring", "check", "spark", "wave", "bubble", "book", "lock", "chevron", "gear", "arrows"] as Emblem[])
  .map((id) => heroOpt("emblem", id));
export const CAPE_COLORS = ["#0F766E", "#4338CA", "#B45309", "#0369A1", "#7E22CE", "#991B1B", "#C2410C", "#BE185D", "#1F2937", "#15803D"];
export const AURA_COLORS = ["#2DD4BF", "#818CF8", "#FBBF24", "#38BDF8", "#C084FC", "#F87171", "#FB923C", "#F472B6", "#34D399", "#FACC15"];

/** 5×5 amblem glifleri ("X" = dolu). Göğüste voxel, 2B ikonda piksel olarak çizilir. */
export const EMBLEM_GLYPHS: Record<Exclude<Emblem, "none">, string[]> = {
  ring: [".XXX.", "X...X", "X.X.X", "X...X", ".XXX."],
  check: ["....X", "...X.", "X.X..", ".X...", "....."],
  spark: ["..X..", "..X..", "XX.XX", "..X..", "..X.."],
  wave: [".X...", "X.X.X", "...X.", ".X...", "X.X.X"],
  bubble: ["XXXXX", "X...X", "X...X", "XXXXX", ".X..."],
  book: ["XX.XX", "X.X.X", "X.X.X", "X.X.X", "XX.XX"],
  lock: [".XXX.", "X...X", "XXXXX", "XX.XX", "XXXXX"],
  chevron: ["..X..", ".X.X.", "X...X", "..X..", ".X.X."],
  gear: ["X.X.X", ".XXX.", "XX.XX", ".XXX.", "X.X.X"],
  arrows: [".X...", "XXXXX", ".....", "XXXXX", "...X."],
};
export const hasAura = (a: Pick<Avatar, "aura">) => !!a.aura && a.aura !== "none";
