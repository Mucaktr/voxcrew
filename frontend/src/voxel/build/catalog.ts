/**
 * E3 (BUILD-UX) — yapı modu kataloğu ve parsel gövdesi şeması ( "Parsel gövdesi").
 * Saf modül (React/three yok); sunucu eşi `backend/studio/expanse/build.py` (aynı kimlikler, gruplar ve sınırlar —
 * `tests/test_expanse_build.py` iki tarafı karşılaştırır).
 *
 * - **Blok kimliği** dünya yapıcı paletinin biçimidir (`lib/builder.ts PALETTE`: `block_stone`, `block_glass`, `block_glow` …).
 * İlk 7 kimlik dünya yapıcıdakiyle aynı renk ve grupta; kalan 25 aynı biçimde sabit renktir (≈ 32 renk, serbest renk yok —
 * plan §4.2 "Kurallar"). Nadir bloklar (`elem:block.*`) E4'e ayrıldı: sunucu şimdilik reddeder.
 * - **Gruplar** yalnız mevcut durağan gruplar (`solid | glass | glow`; yeni grup = yeni çizim çağrısı). Sahnede olmayan grup
 * çizimde `solid`'e düşer (üreteçle aynı kural, plan R1).
 * - **Prefab** beyaz listesi sunucudaki `PREFAB_TYPES` ile aynı; palet kimliği dünya yapıcı kimliğidir (`make` oradan).
 * İstasyon, uyku ve araç prefab'ı yok (D5 A: parsel ajan alanı değil).
 * - **Kilitler** ( / S35): `game.catalog.DECOR` seviyeleri — burada `block_glow` ve `lantern` (palet kimliği = dekor kimliği).
*/
import type { Group } from "../scenes";
import type { Prefab } from "../prefabs";

/** Parsel yerel hacmi: li < 12, lj < 16, y < 8 (plan §8 "≤ 8 kat"). */
export const PLOT_W = 12;
export const PLOT_D = 16;
export const PLOT_H = 8;
export const PLOT_N = PLOT_W * PLOT_D;
/** Bütçeler (BUILD-BUDGET-001): parsel başına ≤ 600 blok + 40 prefab, dünya başına ≤ 6000 blok; gövde ≤ 64 KB. */
export const MAX_EDITS = 600;
export const MAX_PREFABS = 40;
export const MAX_EDITS_TOTAL = 6000;
export const MAX_BODY_BYTES = 64 * 1024;
/** BUILD-NAV-001: zemindeki (y = 0) dolu karo tavanı. Parselin en az %50'si yürünebilir kalır: 192 − çit/bank/rozet payı (≤ 48)
 *  − 48 ≥ 96, araziyi bilmeyen sunucuda da garanti. */
export const MAX_GROUND = 48;
/** Omurga (plan §6.2 adım 3): li 5–6 sütunu ve lj 7–8 satırı — dört kenar geçidini birleştirir, "Parselime git" karosu buradadır.
 *  Bu karolarda y < 2 blok yok (üstünden kemer serbest). */
export const SPINE_I: readonly number[] = [5, 6];
export const SPINE_J: readonly number[] = [7, 8];
export const SPINE_CLEAR = 2;
/** Geri al/yinele yığını (plan §8). */
export const MAX_HISTORY = 200;

export type BuildGroup = Extract<Group, "solid" | "glass" | "glow">;

export interface BlockDef {
  /** dünya yapıcı palet biçimi: `block_<ad>` */
  id: string;
  color: string;
  group: BuildGroup;
  /** renk titreşimi (dünya yapıcı `cube` ile aynı) */
  jit: number;
}

const B = (id: string, color: string, group: BuildGroup = "solid", jit = 0.04): BlockDef => ({ id, color, group, jit });

/** 32 sabit blok. İlk yedisi `lib/builder.ts PALETTE` ile birebir (kimlik, renk, grup, titreşim). */
export const BUILD_BLOCKS: readonly BlockDef[] = [
  B("block_stone", "#9CA3AF"), B("block_brick", "#B5543C", "solid", 0.06), B("block_wood", "#7B5236"),
  B("block_metal", "#64748B", "solid", 0.02), B("block_glass", "#A8D8F0", "glass"), B("block_glow", "#FDE68A", "glow", 0),
  B("block_hedge", "#2F7D32", "solid", 0.15),
  B("block_white", "#F1F5F9"), B("block_cream", "#F1E3D3"), B("block_sand", "#EBD9A8"), B("block_terracotta", "#C8643B", "solid", 0.05),
  B("block_plank", "#C08A57", "solid", 0.05), B("block_oak", "#B88758"), B("block_darkwood", "#4A3222"), B("block_charcoal", "#374151"),
  B("block_black", "#1F2937"), B("block_slate", "#4A5066"), B("block_marble", "#E5E7EB", "solid", 0.02), B("block_cobble", "#78716C", "solid", 0.08),
  B("block_moss", "#4D7C0F", "solid", 0.08), B("block_leaf", "#6DBE45", "solid", 0.1), B("block_teal", "#0F766E"), B("block_sky", "#7DD3FC"),
  B("block_blue", "#2563EB"), B("block_navy", "#1E3A8A"), B("block_lilac", "#A78BFA"), B("block_purple", "#7C3AED"), B("block_pink", "#F472B6"),
  B("block_red", "#DC2626"), B("block_orange", "#F97316"), B("block_yellow", "#FACC15"), B("block_clay", "#A16207", "solid", 0.06),
];
const M = (id: string, color: string, group: BuildGroup = "solid", jit = 0.04): BlockDef => ({ id, color, group, jit });

/** 2026-10-19 yapı malzemeleri paketi (sunucu `expanse/build.py PACK_BLOCKS`): 8 ek sabit renk. Yalnız YENİ yerleştirme pakete
 *  bağlıdır; var olan blok her zaman çizilir. Temel 32 renk her pakette ücretsiz. */
export const PACK_BLOCKS: readonly BlockDef[] = [
  M("block_copper", "#B87333"), M("block_mint", "#6EE7B7"), M("block_rose", "#FDA4AF"), M("block_gold", "#D4A017"),
  M("block_ice", "#CFFAFE", "glass"), M("block_lavender", "#C4B5FD"), M("block_ochre", "#CC7722"), M("block_jade", "#00A86B"),
];
export const PACK_BUILDER = "builder_materials";
/** Çizim ve ad için bütün bloklar (temel + paket). */
export const ALL_BLOCKS: readonly BlockDef[] = [...BUILD_BLOCKS, ...PACK_BLOCKS];
export const PACK_BLOCK_IDS: ReadonlySet<string> = new Set(PACK_BLOCKS.map((b) => b.id));
export const BLOCK_BY_ID: ReadonlyMap<string, BlockDef> = new Map(ALL_BLOCKS.map((b) => [b.id, b]));
/** Kimlik biçimi (sunucu `BLOCK_ID_RE` ile aynı). */
export const BLOCK_ID_RE = /^block_[a-z0-9]{1,24}$/;

/** Parselde izinli prefab türleri (sunucu `expanse/service.py PREFAB_TYPES`) — palet kimliği dünya yapıcı kimliğidir. */
export const BUILD_PREFABS = ["plant", "tree", "pine", "palm", "snowyPine", "rock", "crate", "table", "sofa", "lantern", "sandbags"] as const;
export type BuildPrefabType = (typeof BUILD_PREFABS)[number];
export const isBuildPrefab = (t: string): t is BuildPrefabType => (BUILD_PREFABS as readonly string[]).includes(t);

/** Kilitli dekor (S35 `game.catalog.DECOR`; palet kimliği = dekor kimliği). Var olan eşya kilitlenmez; yalnız yeni yerleştirme. */
export const DECOR_IDS: ReadonlySet<string> = new Set(["block_glow", "lantern"]);

/** `[li, y, lj, blok, dönüş]` — parsel yerel, dönüş 0…3 (çeyrek tur; küp için yalnız saklanır). */
export type Edit = [number, number, number, string, number];
/** Parsel yerel prefab (dünya yapıcı `Prefab`'ının i/j'si parsel karosu). */
export type PlotPrefab = Prefab & { i: number; j: number };

export interface PlotBody {
  edits: Edit[];
  prefabs: PlotPrefab[];
}
export const EMPTY_BODY: PlotBody = Object.freeze({ edits: [], prefabs: [] }) as PlotBody;

/** Hücre anahtarı (y · 192 + lj · 12 + li). */
export const cellKey = (li: number, y: number, lj: number) => y * PLOT_N + lj * PLOT_W + li;
export const tileKey = (li: number, lj: number) => lj * PLOT_W + li;
export const isBorder = (li: number, lj: number) => li === 0 || lj === 0 || li === PLOT_W - 1 || lj === PLOT_D - 1;
export const isSpine = (li: number, lj: number) => SPINE_I.includes(li) || SPINE_J.includes(lj);
/** Kenar geçidi (omurganın dış uçları): kenar halkasında olup yürünebilir sayılan karolar. */
export const isGate = (li: number, lj: number) => isBorder(li, lj) && isSpine(li, lj);

/** Palet öğesi: blok ya da prefab (dünya yapıcı kimliği). */
export type BuildItem = { kind: "block"; id: string; def: BlockDef } | { kind: "prefab"; id: BuildPrefabType };
export const itemOf = (id: string): BuildItem | null => {
  const b = BLOCK_BY_ID.get(id);
  if (b) return { kind: "block", id, def: b };
  return isBuildPrefab(id) ? { kind: "prefab", id } : null;
};

/** Sahne zemin rengine (swatch) yakınlığa göre blok sırası (plan §8: "palet sahne swatch'ına göre sıralanır"). Kararlı. */
export function blocksForSwatch(swatch: string | null | undefined): BlockDef[] {
  const rgb = (h: string) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  if (!swatch || !/^#[0-9a-fA-F]{6}$/.test(swatch)) return [...BUILD_BLOCKS];
  const s = rgb(swatch);
  const d = (b: BlockDef) => { const c = rgb(b.color); return (c[0] - s[0]) ** 2 + (c[1] - s[1]) ** 2 + (c[2] - s[2]) ** 2; };
  return BUILD_BLOCKS.map((b, k) => ({ b, k, d: d(b) })).sort((a, b) => a.d - b.d || a.k - b.k).map((x) => x.b);
}

/** Palet sırası (1–9 kısayolları): sahneye göre bloklar, sonra eşyalar; yapı malzemeleri paketi etkinse paket renkleri en sonda
 *  (temel paletin sırası ve kısayolları değişmez). */
export function paletteOrder(swatch: string | null, withPack = false): string[] {
  return [...blocksForSwatch(swatch).map((b) => b.id), ...BUILD_PREFABS, ...(withPack ? PACK_BLOCKS.map((b) => b.id) : [])];
}

/** Gövdenin kanonik JSON'u (sunucu `json.dumps(separators=(",", ":"))` ile aynı bayt sayısı ölçüsü için). */
export function bodyBytes(body: PlotBody): number {
  return new TextEncoder().encode(JSON.stringify({ edits: body.edits, prefabs: body.prefabs })).length;
}
