/**
 * W3 (WALK-FUN) — mini oyunların SAF kuralları: olta, üç taş (tic-tac-toe), atış.
 * Yerel ve deterministik: aynı tohum + aynı girdi → aynı sonuç. Model çağrısı, token, jeton, XP yok; ödül kozmetik kart.
*/
import { NEW_CITIES } from "../cities/index";
import { FULL_SCENE_BIOME } from "../../full/minigameLogic";

/** mulberry32: küçük, deterministik sözde rastgele üreteç (0 ≤ x < 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Metinden tohum (spot kimliği + tur sayısı). */
export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ------------------------------------------------------------------ saf mantık arayüzü
/**
 * Her mini oyunun saf mantık modülü bu arayüzü uygular (React ve three yok; `scripts/*.test.mjs` esbuild ile doğrudan yükler):
 * olay → yeni durum + etkiler. HUD olayları üretir (basış, kare `tick`, sunucu yanıtı, işaret `cue`, odak kaybı) ve etkileri
 * uygular (ağ isteği, duyuru). Kurallar: aynı girdi → aynı çıktı, durum değişmediyse aynı nesne; zaman yalnız olaydaki `now`
 * (performance.now); jeton istemcide hesaplanmaz (sonuç sunucudan); işaret anı sunucudan zaman damgasız `cue` olayıyla gelir;
 * hareket azaltma `calm` ile (animasyon 0 ms, geniş pencere); tek tuşla oynanabilir, art arda basma zorunluluğu yok.
 * Örnek: olta `voxel/fun/fishing.ts` (`initialFish`, `fishStep`). Kayıt: `voxel/fun/minigames.ts MINIGAMES`.
 */
export interface MinigameLogic<S = unknown, E extends { type: string } = { type: string }, F extends string = string> {
  initial(calm: boolean, now: number): S;
  step(state: S, event: E): { state: S; effects: F[] };
}

// ------------------------------------------------------------------ kartlar
export type Rarity = "common" | "rare";
/** WORLD-FIX: olta jetonu kademesi (sunucu backend/studio/walk/fishing.py SPECIES_TIER ile aynı; test_walk_fishing denetler) */
export type FishTier = "junk" | "common" | "uncommon" | "rare" | "legendary";
export interface CardDef { id: string; rarity: Rarity; /** olta kademesi (balık) */ tier?: FishTier; /** fx paleti rengi (balık) */ col?: number }
export const FISH: readonly CardDef[] = [
  { id: "hamsi", rarity: "common", tier: "common", col: 9 },
  { id: "istavrit", rarity: "common", tier: "common", col: 5 },
  { id: "cupra", rarity: "common", tier: "uncommon", col: 4 },
  { id: "sazan", rarity: "common", tier: "common", col: 23 },
  { id: "levrek", rarity: "common", tier: "uncommon", col: 9 },
  { id: "alabalik", rarity: "common", tier: "uncommon", col: 1 },
  { id: "palamut", rarity: "rare", tier: "rare", col: 6 },
  { id: "lufer", rarity: "rare", tier: "rare", col: 6 },
  { id: "japon", rarity: "rare", tier: "rare", col: 12 },
  { id: "cizme", rarity: "common", tier: "junk", col: 10 },
  { id: "palyaco", rarity: "common", tier: "common", col: 12 },
  { id: "morina", rarity: "common", tier: "common", col: 9 },
  { id: "cerrah", rarity: "common", tier: "uncommon", col: 6 },
  { id: "somon", rarity: "common", tier: "uncommon", col: 1 },
  { id: "turna", rarity: "rare", tier: "rare", col: 7 },
  { id: "papagan", rarity: "rare", tier: "rare", col: 17 },
  { id: "yilan_baligi", rarity: "rare", tier: "rare", col: 10 },
  { id: "koi", rarity: "rare", tier: "rare", col: 12 },
  { id: "kalkan", rarity: "rare", tier: "rare", col: 23 },
  { id: "orkinos", rarity: "rare", tier: "legendary", col: 6 },
  { id: "yayin", rarity: "rare", tier: "legendary", col: 10 },
];
export const FISH_BY_ID: Readonly<Record<string, CardDef>> = Object.fromEntries(FISH.map((f) => [f.id, f]));
export const fishTier = (id: string): FishTier => FISH_BY_ID[id]?.tier ?? "common";

// WORLD-FIX: biyomlar (sunucu fishing.py BIOMES / SCENE_BIOME ile aynı; scripts/fishing.test.mjs karşılaştırır). Kademe olasılığı
// her biyomda aynıdır (TIER_WEIGHTS) — biyom yalnız türü seçer, beklenen jetonu değiştirmez.
export type FishBiome = "sea" | "lake" | "river" | "reef" | "arctic";
export const FISH_TIERS: readonly FishTier[] = ["junk", "common", "uncommon", "rare", "legendary"];
export const TIER_WEIGHTS: Readonly<Record<FishTier, number>> = { junk: 3, common: 55, uncommon: 27, rare: 12, legendary: 3 };
export const TIER_COINS: Readonly<Record<FishTier, number>> = { junk: 0, common: 2, uncommon: 3, rare: 6, legendary: 12 };
export const FISH_BIOMES: Readonly<Record<FishBiome, Readonly<Record<Exclude<FishTier, "junk">, readonly string[]>>>> = {
  sea: { common: ["hamsi", "istavrit"], uncommon: ["cupra", "levrek"], rare: ["palamut", "lufer", "kalkan"], legendary: ["orkinos"] },
  lake: { common: ["sazan"], uncommon: ["alabalik"], rare: ["japon", "turna", "koi"], legendary: ["yayin"] },
  river: { common: ["sazan"], uncommon: ["alabalik"], rare: ["turna", "yilan_baligi"], legendary: ["yayin"] },
  reef: { common: ["palyaco"], uncommon: ["cerrah"], rare: ["papagan"], legendary: ["orkinos"] },
  arctic: { common: ["morina"], uncommon: ["somon"], rare: ["kalkan"], legendary: ["orkinos"] },
};
/** yeni şehirler (dizin) catalog.json `fish_biome` alanından, varsayılan "sea" (sunucu fishing.py CITY_FISH_BIOME aynı).*/
export const CITY_FISH_BIOME: Readonly<Record<string, FishBiome>> = Object.fromEntries(
  NEW_CITIES.map((m) => [m.catalog.id, m.catalog.fish_biome ?? "sea"]),
);
export const SCENE_BIOME: Readonly<Record<string, FishBiome>> = {
  beach: "sea", sea: "sea", yacht: "sea", istanbul: "sea", snow: "arctic",
  londra: "river",
  park: "lake", camp: "lake", home: "lake", kapadokya: "lake", office: "lake",
  cafe: "lake", mall: "lake", school: "lake", battlefield: "lake", space: "lake",
  ...FULL_SCENE_BIOME,
  ...CITY_FISH_BIOME,
};
/** tatlı su göleti olmayan sahne biyomları — mercan üssünün ay havuzu resife, buz deliği kutup denizine açılır.*/
const NO_LAKE: ReadonlySet<FishBiome> = new Set<FishBiome>(["reef", "arctic"]);
/**
 * Gölet kıyısı `lake` (resif/kutup sahnesinde değil); açık su (nehir, kanal, boğaz, deniz) sahnenin biyomu (bilinmeyen/kullanıcı
 * dünyası `sea`). Sunucu `fishing.py biome_of(world, fishWater(world, pond))` ile aynı sonucu verir (fishing_water.test.mjs).
 */
export const biomeOf = (world: string | null | undefined, pond: boolean): FishBiome => {
  const open = SCENE_BIOME[world ?? ""] ?? "sea";
  return pond && !NO_LAKE.has(open) ? "lake" : open;
};
/** sunucuya giden su türü (`/api/walk/fish/cast` `water`): göl türü yalnız gerçekten `lake` biyomunda "pond".*/
export const fishWater = (world: string | null | undefined, pond: boolean): "pond" | "open" => (pond && biomeOf(world, pond) === "lake" ? "pond" : "open");
/** Tür seçimi (yerel/çevrimdışı tur ve ortam balıkları): kademe → biyomun o kademedeki türü. */
export function pickFish(biome: FishBiome, rand: () => number): string {
  const total = FISH_TIERS.reduce((s, t) => s + TIER_WEIGHTS[t], 0);
  let roll = rand() * total;
  let tier: FishTier = "legendary";
  for (const t of FISH_TIERS) { roll -= TIER_WEIGHTS[t]; if (roll < 0) { tier = t; break; } }
  if (tier === "junk") return "cizme";
  const list = FISH_BIOMES[biome][tier];
  return list[Math.floor(rand() * list.length) % list.length];
}
/** Biyomda yaşayan bütün türler (ortam balıkları; çöp hariç). */
export const biomeSpecies = (biome: FishBiome): string[] => [...new Set(Object.values(FISH_BIOMES[biome]).flat())];
export const OTHER_CARDS: readonly CardDef[] = [
  { id: "board", rarity: "common" },
  { id: "toss", rarity: "rare" },
];
export const ALL_CARDS: readonly string[] = [...FISH.map((f) => `fish:${f.id}`), ...OTHER_CARDS.map((c) => c.id)];

/** Koleksiyon (kart → adet). Saf: yeni nesne döner. */
export type Collection = Readonly<Record<string, number>>;
export function addCard(c: Collection, id: string): { next: Collection; isNew: boolean } {
  const n = c[id] ?? 0;
  return { next: { ...c, [id]: Math.min(999, n + 1) }, isNew: n === 0 };
}
export const collectionSize = (c: Collection) => ALL_CARDS.filter((id) => (c[id] ?? 0) > 0).length;

/** Depodan gelen bozuk veriyi süzer (yalnızca bilinen kartlar, pozitif tam sayı). */
export function sanitizeCollection(raw: unknown): Collection {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const id of ALL_CARDS) {
    const v = (raw as Record<string, unknown>)[id];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[id] = Math.min(999, Math.floor(v));
  }
  return out;
}

// ------------------------------------------------------------------ olta
export interface FishRound {
  /** atıştan "Çek!" ipucuna (ms; atış yayı dahil) */
  biteMs: number;
  /** ipucu GÖRÜNDÜKTEN sonra çekme penceresi (ms) */
  windowMs: number;
  /** yakalanırsa kart */
  fish: CardDef;
}
/** Sunucu fishing.py ile aynı: vuruş 2,2–5,2 sn, pencere 1,4 sn (hareket azaltmada 3,2 sn). */
export const FISH_BITE_MS: readonly [number, number] = [2200, 5200];
export const FISH_WINDOW_MS = 1400;
export const FISH_ASSIST_WINDOW_MS = 3200;

/** Yerel (çevrimdışı) tur: sunucu yokken oyun oynanır ama jeton yoktur. */
export function fishRound(seed: number, biome: FishBiome = "sea", assist = false): FishRound {
  const r = rng(seed);
  const biteMs = Math.round(FISH_BITE_MS[0] + r() * (FISH_BITE_MS[1] - FISH_BITE_MS[0]));
  const fish = FISH_BY_ID[pickFish(biome, r)] ?? FISH[0];
  return { biteMs, windowMs: assist ? FISH_ASSIST_WINDOW_MS : FISH_WINDOW_MS, fish };
}

export type FishResult = "early" | "caught" | "late";

// ------------------------------------------------------------------ üç taş (tic-tac-toe)
/** 0 boş · 1 oyuncu · 2 ajan; dizin r*3+c */
export type Cell = 0 | 1 | 2;
export type Board = readonly Cell[];
export const EMPTY_BOARD: Board = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0]) as Board;
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

export function legalMoves(b: Board): number[] {
  if (winner(b)) return [];
  const out: number[] = [];
  for (let i = 0; i < 9; i++) if (b[i] === 0) out.push(i);
  return out;
}
/** 1 / 2 kazanan, 3 berabere (dolu), 0 sürüyor */
export function winner(b: Board): 0 | 1 | 2 | 3 {
  for (const [a, c, d] of LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a] as 1 | 2;
  return b.every((x) => x !== 0) ? 3 : 0;
}
export function place(b: Board, i: number, who: 1 | 2): Board {
  if (!Number.isInteger(i) || i < 0 || i > 8 || b[i] !== 0 || winner(b)) throw new Error("illegal move");
  const n = b.slice() as Cell[];
  n[i] = who;
  return n;
}
/**
 * Ajan hamlesi: yerel ve rastgele (model yok). Kazanan hamle varsa çoğunlukla onu, oyuncunun kazanacağı kareyi bazen kapatır;
 * aksi rastgele boş kare. Her zaman yasal; oyun bittiyse −1.
 */
export function agentMove(b: Board, rand: () => number): number {
  const legal = legalMoves(b);
  if (!legal.length) return -1;
  const finds = (who: 1 | 2) => legal.find((i) => { const n = b.slice() as Cell[]; n[i] = who; return winner(n) === who; });
  const win = finds(2);
  if (win !== undefined && rand() < 0.8) return win;
  const block = finds(1);
  if (block !== undefined && rand() < 0.55) return block;
  return legal[Math.floor(rand() * legal.length) % legal.length];
}
export const BOARD_SECONDS = 60;

// ------------------------------------------------------------------ atış (tut-bırak güç çubuğu)
export const POWER_PERIOD_MS = 1600;
/** Basılı tutma süresine göre güç (0–1, üçgen dalga: dolar, boşalır). Hareket azaltmada 8 adımlı (yumuşak kayma yok). */
export function powerAt(heldMs: number, calm = false): number {
  const u = ((Math.max(0, heldMs) % POWER_PERIOD_MS) / POWER_PERIOD_MS) * 2;
  const p = u <= 1 ? u : 2 - u;
  return calm ? Math.round(p * 8) / 8 : p;
}
/** Hedef güç (tohumdan; 0,55–0,85). */
export function tossTarget(seed: number): number {
  return 0.55 + rng(seed)() * 0.3;
}
export type TossResult = { points: number; grade: "hit" | "near" | "miss" };
/** Puan (0–10): hedefe ±0,04 tam isabet (10), ±0,25 içinde yakın, ötesi ıska. */
export function tossScore(power: number, target: number): TossResult {
  const d = Math.abs(power - target);
  if (d <= 0.04) return { points: 10, grade: "hit" };
  if (d < 0.25) return { points: Math.max(1, Math.round(9 * (1 - d / 0.25))), grade: "near" };
  return { points: 0, grade: "miss" };
}
