/**
 * Dünya yapıcı (Faz 7a, S30) — API istemcisi, kullanıcı dünyası kaydı (World.tsx'in çizebilmesi için), malzeme/prop
 * paleti ve editör deposu (geri al/yinele, araç, seçim, güvenli otomatik taslak).
 *
 * Yerleşik 11 dünya `voxel/worlds/*.json` olarak tembel yüklenir (yalnızca editörde); kullanıcı dünyaları sunucuda
 * (`/api/worlds`, `<veri dizini>/worlds/`). Taslak her değişiklikten sonra tarayıcıda saklanır ama sunucudaki dosyayı
 * asla kendiliğinden ezmez: kaydetme her zaman açık eylemdir ve doğrulamadan geçer.
 */
import { create } from "zustand";
import { currentLocale } from "./i18n";
import { worldSceneDef, type Issue, type WorldFile } from "../voxel/worldFormat";
import { cellsOf, FACE, movePrefab, rotatePrefab, ATMOSPHERE, type GridSize, type Prefab } from "../voxel/prefabs";
import { CITY_PALETTE } from "../voxel/citypacks/palette";
import { D, registerScene, SCENE_ORDER, W, type Light, type Station, type Tile, type ToolKind, type WorldSceneId } from "../voxel/scenes";

// ------------------------------------------------------------------------------------------ API
export interface WorldSummary {
  id: string; name: string; description: string; updated: string | null; created: string | null;
  basedOn: { id: string; sha256: string } | null; sha256: string | null; swatch: [string, string] | null;
  annex: string | null; prefabs: number; stations: number;
  /** Karar 10: `basedOn` yoksa içerikçe eşleştiği yerleşik sahne (sunucu parmak izi); yoksa null. */
  match?: string | null;
}

/** Sunucu doğrulama hatası: ileti + karolu sorunlar (422). */
export class WorldApiError extends Error {
  status: number;
  issues: (Issue & { message?: string })[];
  constructor(status: number, message: string, issues: (Issue & { message?: string })[] = []) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let issues: WorldApiError["issues"] = [];
    try {
      const j = await res.json();
      if (typeof j.detail === "string") message = j.detail;
      else if (j.detail && typeof j.detail === "object") { message = String(j.detail.message ?? message); issues = j.detail.issues ?? []; }
    } catch { /* gövde yok */ }
    throw new WorldApiError(res.status, message, issues);
  }
  return res.json() as Promise<T>;
}

export const worldsApi = {
  list: () => call<{ worlds: WorldSummary[]; limits: Record<string, number> }>("GET", "/api/worlds"),
  get: (id: string) => call<WorldFile>("GET", `/api/worlds/${encodeURIComponent(id)}`),
  create: (doc: WorldFile) => call<WorldFile>("POST", "/api/worlds", doc),
  save: (id: string, doc: WorldFile) => call<WorldFile>("PUT", `/api/worlds/${encodeURIComponent(id)}`, doc),
  duplicate: (id: string) => call<WorldFile>("POST", `/api/worlds/${encodeURIComponent(id)}/duplicate`, {}),
  remove: (id: string) => call<{ ok: boolean }>("DELETE", `/api/worlds/${encodeURIComponent(id)}`),
  importDoc: (doc: unknown) => call<WorldFile>("POST", "/api/worlds/import", doc),
  exportUrl: (id: string) => `/api/worlds/${encodeURIComponent(id)}/export`,
};

export const isUserWorldId = (id: string | null | undefined): id is string => !!id && /^w_[a-z0-9]{6,32}$/.test(id);
export const isBuiltinId = (id: string | null | undefined): id is WorldSceneId => !!id && (SCENE_ORDER as string[]).includes(id);

// ------------------------------------------------------------------------------------------ yerleşik dünyalar
const BUILTIN = import.meta.glob<WorldFile>("../voxel/worlds/*.json", { import: "default" });

/** Yerleşik dünyanın JSON'u (tembel parça; derin kopya döner, düzenlenebilir). */
export async function loadBuiltin(id: WorldSceneId): Promise<WorldFile> {
  const load = BUILTIN[`../voxel/worlds/${id}.json`];
  if (!load) throw new Error(`unknown builtin: ${id}`);
  return structuredClone(await load());
}

/** "Kopyasını düzenle": yerleşik dünyadan kullanıcı kopyası (sunucuya henüz gönderilmemiş). */
export function copyOfBuiltin(src: WorldFile, name: string): WorldFile {
  const w = structuredClone(src);
  w.meta = {
    ...w.meta, name: name.slice(0, 80), author: { name: "", id: null }, license: "All-Rights-Reserved", tags: [],
    basedOn: { id: `scene:${src.id}`, sha256: src.meta.sha256 ?? "" },
  };
  delete w.meta.sha256;
  return w;
}

/** Sıfırdan dünya: çimen zemin, bir masa + istasyon, dinlenme ve beş araç noktası (hemen geçerli). */
export function blankWorld(name: string): WorldFile {
  const ground = Array.from({ length: D }, (_, j) => Array.from({ length: W }, (_, i) => ((i * 7 + j * 3) % 5 ? "#6DBE45" : "#62B03E")));
  return {
    format: "voxcrew-world", version: 1, id: "w_newworld", baked: null, zones: [], elements: [],
    meta: { name: name.slice(0, 80), description: "", author: { name: "", id: null }, license: "All-Rights-Reserved",
      created: new Date().toISOString(), updated: new Date().toISOString(), tags: [], ip_risk: 0, basedOn: null },
    grid: { w: W, d: D, annex: "park" },
    env: { swatch: ["#6DBE45", "#8ED1FC"], sky: "#8ED1FC", fog: [32, 70], hemi: ["#DFF3FF", "#6DBE45", 1.15],
      sun: { color: "#FFF6D8", intensity: 2, pos: [10, 16, 8] }, night: false, ocean: null, weather: null },
    layers: {
      ground, under: "#8B5A2B", groundJit: 0.09, lights: [],
      prefabs: [
        { t: "desk", i: 10, j: 8, w: 2, top: "#A0522D", legs: "#7A3E1D" },
        { t: "tree", i: 3, j: 3, h: 3 },
        { t: "plant", i: 20, j: 12 },
      ],
    },
    nav: {
      stations: [{ tile: [10, 7], face: FACE.up }],
      rest: [[14, 12]],
      spots: { web: [{ tile: [6, 4], face: FACE.down }], read: [{ tile: [16, 4], face: FACE.down }], plan: [{ tile: [12, 4], face: FACE.down }],
        shell: [{ tile: [18, 8], face: FACE.down }], write: [{ tile: [8, 10], face: FACE.up }] },
    },
  };
}

// ------------------------------------------------------------------------------------------ çalışma anı kaydı
interface WorldsState {
  list: WorldSummary[];
  loaded: boolean;
  /** kayıtlı (çizilebilir) dünya sürümü: World yeniden kurulsun diye artar */
  version: number;
  refresh: () => Promise<void>;
}

export const useWorlds = create<WorldsState>((set) => ({
  list: [],
  loaded: false,
  version: 0,
  refresh: async () => {
    try {
      const { worlds } = await worldsApi.list();
      set({ list: worlds, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));

/** Bu yerleşik dünyadan türetilmiş kullanıcı sürümleri. */
export function copiesOf(list: WorldSummary[], id: WorldSceneId): WorldSummary[] {
  return list.filter((w) => w.basedOn?.id === `scene:${id}`);
}

/** kullanıcı dünyasının `meta.basedOn` zincirinin vardığı yerleşik sahne (kopyanın kopyası da); zincir
 * `basedOn` olmadan biterse sunucunun içerik eşleşmesi (`match`, karar 10); yoksa null.
 * Sahne kilidi sunucuda da denetlenir (kilitli sahnenin kopyası etkin yapılamaz ve çoğaltılamaz).*/
export function builtinRootOf(list: WorldSummary[], w: WorldSummary): WorldSceneId | null {
  const seen = new Set<string>();
  let cur: WorldSummary | undefined = w;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const bid: string | undefined = cur.basedOn?.id;
    if (!bid) return (cur.match as WorldSceneId | null | undefined) ?? null;
    if (bid.startsWith("scene:")) return bid.slice(6) as WorldSceneId;
    cur = list.find((x) => x.id === bid);
  }
  return null;
}

/** "Senin sürümün": etkin sahne bu dünyanın bir kopyasıysa o (QA O-28), değilse en son düzenlenen kopya; yoksa null. */
export function latestCopyOf(list: WorldSummary[], id: WorldSceneId, activeScene?: string | null): WorldSummary | null {
  const mine = copiesOf(list, id);
  const active = activeScene ? mine.find((w) => w.id === activeScene) : undefined;
  if (active) return active;
  const stamp = (w: WorldSummary) => String(w.updated ?? w.created ?? "");
  return mine.sort((a, b) => stamp(b).localeCompare(stamp(a)))[0] ?? null;
}

/** "Düzenle": yerleşik dünyanın kullanıcı sürümünü açar (varsa en son düzenleneni), yoksa bir kez kopyalar.
 *  `fresh` true ise var olan sürüm yok sayılıp orijinalden yeni kopya açılır. Kullanıcı dünyası kimliği döner. */
export async function editableWorldFor(id: WorldSceneId, copyName: (n: number) => string, fresh = false,
  activeScene?: string | null): Promise<string> {
  await useWorlds.getState().refresh();
  const list = useWorlds.getState().list;
  const existing = fresh ? null : latestCopyOf(list, id, activeScene);
  if (existing) return existing.id;
  // ayırt edici ad: ilk kopya "Ofis (kopya)", sonrakiler "Ofis (kopya 2)", "… 3" (QA O-28)
  const created = await worldsApi.create(copyOfBuiltin(await loadBuiltin(id), copyName(copiesOf(list, id).length + 1)));
  await useWorlds.getState().refresh();
  return created.id;
}

/** Dünyayı sahne olarak kaydeder (World.tsx, ScenePicker); yerleşik sahne kimliği yok sayılır. */
export function registerWorld(w: WorldFile): void {
  registerScene(worldSceneDef(w));
  useWorlds.setState((s) => ({ version: s.version + 1 }));
}

const loading = new Map<string, Promise<void>>();
/** Etkin sahne bir kullanıcı dünyasıysa sunucudan yükleyip kaydeder (bir kez; hata sessiz — ofise düşer). */
export function ensureWorld(id: string | null | undefined): Promise<void> {
  if (!isUserWorldId(id)) return Promise.resolve();
  let p = loading.get(id);
  if (!p) {
    p = worldsApi.get(id).then(registerWorld).catch(() => { loading.delete(id); });
    loading.set(id, p);
  }
  return p;
}

// ------------------------------------------------------------------------------------------ palet
export type PaletteCat = "floor" | "structure" | "furniture" | "nature" | "light" | "nav" | "decor" | "atmosphere" | "citypack";
/** CITY-PACKS: `citypack` şehir paketi öğeleri (voxel/citypacks/palette.ts; yeni yerleştirme sahipliğe bağlı, Palette.tsx). */
export const PALETTE_CATS: PaletteCat[] = ["floor", "structure", "furniture", "nature", "light", "nav", "decor", "atmosphere", "citypack"];

export type PaletteKind = "floor" | "void" | "water" | "pond" | "prefab" | "station" | "rest" | "spot" | "light";
export interface PaletteItem {
  id: string;
  cat: PaletteCat;
  kind: PaletteKind;
  /** önizleme rengi */
  color: string;
  /** zemin rengi / prefab üretici */
  floor?: string;
  /** `g`: dünyanın ızgara boyutu (çiçek maskesi `grid.w × grid.d`; yoksa 24×16 taban) —*/
  make?: (i: number, j: number, g?: GridSize) => Prefab;
  spot?: ToolKind;
  /** CITY-PACKS: öğenin şehir paketi kimliği (kilit ve ad şehir paketi kataloğundan) */
  pack?: string;
}

const cube = (c: string, extra: Partial<Prefab & { t: "cube" }> = {}) => (i: number, j: number): Prefab =>
  ({ t: "cube", i, j, y: 0, c, solid: true, ...extra });
const floor = (id: string, color: string): PaletteItem => ({ id, cat: "floor", kind: "floor", color, floor: color });

export const PALETTE: PaletteItem[] = [
  floor("floor_wood", "#B88758"), floor("floor_parquet", "#C99A6B"), floor("floor_grass", "#6DBE45"), floor("floor_sand", "#EBD9A8"),
  floor("floor_stone", "#9CA3AF"), floor("floor_tile", "#F1E3D3"), floor("floor_dark", "#3B2F2F"), floor("floor_carpet", "#8C9BB0"),
  floor("floor_rug", "#7C6CF0"), floor("floor_path", "#C9A36B"), floor("floor_dirt", "#6B4F35"), floor("floor_snow", "#F4F7FB"),
  floor("floor_ice", "#BFE6F5"), floor("floor_metal", "#4A5066"), floor("floor_deck", "#C08A57"),
  { id: "floor_sea", cat: "floor", kind: "water", color: "#1E8FD0", make: (i, j) => ({ t: "sea", i, j, c: "#1E8FD0", top: -0.2, blocking: true }) },
  { id: "floor_pond", cat: "floor", kind: "pond", color: "#3B9DDB",
    make: (i, j) => ({ t: "cube", i, j, y: -1, h: 0.8, c: "#3B9DDB", g: "water", jit: 0, solid: true }) },
  { id: "floor_void", cat: "floor", kind: "void", color: "#0B1026" },

  { id: "wall", cat: "structure", kind: "prefab", color: "#E2DACB", make: (i, j) => ({ t: "wall", i, j, len: 4, h: 3, axis: "x", c: "#E2DACB" }) },
  { id: "wall_window", cat: "structure", kind: "prefab", color: "#A8D8F0",
    make: (i, j) => ({ t: "wall", i, j, len: 5, h: 4, axis: "x", c: "#ECE6DA", win: [[1, 3]] }) },
  { id: "block_stone", cat: "structure", kind: "prefab", color: "#9CA3AF", make: cube("#9CA3AF") },
  { id: "block_brick", cat: "structure", kind: "prefab", color: "#B5543C", make: cube("#B5543C", { jit: 0.06 }) },
  { id: "block_wood", cat: "structure", kind: "prefab", color: "#7B5236", make: cube("#7B5236") },
  { id: "block_metal", cat: "structure", kind: "prefab", color: "#64748B", make: cube("#64748B", { jit: 0.02 }) },
  { id: "block_glass", cat: "structure", kind: "prefab", color: "#A8D8F0", make: cube("#A8D8F0", { g: "glass" }) },
  { id: "block_glow", cat: "structure", kind: "prefab", color: "#FDE68A", make: cube("#FDE68A", { g: "glow", jit: 0 }) },
  { id: "block_hedge", cat: "structure", kind: "prefab", color: "#2F7D32", make: cube("#2F7D32", { jit: 0.15 }) },
  { id: "sandbags", cat: "structure", kind: "prefab", color: "#CDB287", make: (i, j) => ({ t: "sandbags", i, j, len: 3, axis: "x", layers: 2 }) },
  { id: "barrier", cat: "structure", kind: "prefab", color: "#64748B", make: (i, j) => ({ t: "block", i, j }) },

  { id: "desk", cat: "furniture", kind: "prefab", color: "#E7D7C1", make: (i, j) => ({ t: "desk", i, j, w: 2, top: "#E7D7C1", legs: "#6B7280" }) },
  { id: "table", cat: "furniture", kind: "prefab", color: "#8B5E3C", make: (i, j) => ({ t: "table", i, j, top: "#8B5E3C" }) },
  { id: "bookshelf", cat: "furniture", kind: "prefab", color: "#7B5236", make: (i, j) => ({ t: "bookshelf", i, j, c: "#7B5236" }) },
  { id: "sofa", cat: "furniture", kind: "prefab", color: "#5B7DB1", make: (i, j) => ({ t: "sofa", i, j, c: "#5B7DB1", back: "#4A6A9C" }) },
  { id: "terminal", cat: "furniture", kind: "prefab", color: "#34D399", make: (i, j) => ({ t: "terminal", i, j, glow: "+z" }) },
  { id: "crate", cat: "furniture", kind: "prefab", color: "#9A7442", make: (i, j) => ({ t: "crate", i, j, c: "#9A7442", s: 0.8 }) },
  // S33 canlı dekor: monitör (masa karosuna), sandalye (istasyon karosuna), sunucu dolabı, kahve makinesi, duvar panosu
  { id: "monitor", cat: "furniture", kind: "prefab", color: "#1F2937", make: (i, j) => ({ t: "monitor", i, j, face: "-z" }) },
  { id: "chair", cat: "furniture", kind: "prefab", color: "#2B2F3A", make: (i, j) => ({ t: "chair", i, j, face: "+z" }) },
  { id: "server_rack", cat: "furniture", kind: "prefab", color: "#1E222B", make: (i, j) => ({ t: "server_rack", i, j, face: "+z" }) },
  { id: "coffee_machine", cat: "furniture", kind: "prefab", color: "#94A3B8", make: (i, j) => ({ t: "coffee_machine", i, j, face: "+z" }) },
  { id: "scoreboard", cat: "decor", kind: "prefab", color: "#111827", make: (i, j) => ({ t: "scoreboard", i, j, w: 2 }) },

  { id: "plant", cat: "nature", kind: "prefab", color: "#2F855A", make: (i, j) => ({ t: "plant", i, j }) },
  { id: "tree", cat: "nature", kind: "prefab", color: "#3E8E3E", make: (i, j) => ({ t: "tree", i, j, h: 3 }) },
  { id: "pine", cat: "nature", kind: "prefab", color: "#1F5130", make: (i, j) => ({ t: "pine", i, j }) },
  { id: "palm", cat: "nature", kind: "prefab", color: "#38B25A", make: (i, j) => ({ t: "palm", i, j }) },
  { id: "snowyPine", cat: "nature", kind: "prefab", color: "#F8FAFC", make: (i, j) => ({ t: "snowyPine", i, j }) },
  { id: "rock", cat: "nature", kind: "prefab", color: "#78716C", make: (i, j) => ({ t: "rock", i, j, c: "#78716C" }) },
  { id: "flowers", cat: "nature", kind: "prefab", color: "#F472B6", make: (i, j, g) => ({ t: "flowers", n: 12, seed: (i * 131 + j * 17) | 1, mask: areaMask(i, j, 1, g) }) },

  { id: "lantern", cat: "light", kind: "prefab", color: "#FFD27A", make: (i, j) => ({ t: "lantern", i, j, glow: "#FFD27A", post: "#374151" }) },
  { id: "lamp", cat: "light", kind: "prefab", color: "#FDE68A", make: (i, j) => ({ t: "lamp", i, j, glow: "#FDE68A" }) },
  { id: "desk_lamp", cat: "light", kind: "prefab", color: "#FDE68A", make: (i, j) => ({ t: "lamp", i, j, glow: "#FDE68A", desk: true, dx: 0.25, dz: -0.25 }) },
  { id: "campfire", cat: "light", kind: "prefab", color: "#FF7A1A", make: (i, j) => ({ t: "campfire", i, j }) },
  { id: "light", cat: "light", kind: "light", color: "#FFE8C2" },

  { id: "station", cat: "nav", kind: "station", color: "#3B82F6" },
  { id: "rest", cat: "nav", kind: "rest", color: "#A78BFA" },
  { id: "spot_web", cat: "nav", kind: "spot", spot: "web", color: "#0EA5E9" },
  { id: "spot_read", cat: "nav", kind: "spot", spot: "read", color: "#F59E0B" },
  { id: "spot_plan", cat: "nav", kind: "spot", spot: "plan", color: "#10B981" },
  { id: "spot_shell", cat: "nav", kind: "spot", spot: "shell", color: "#64748B" },
  { id: "spot_write", cat: "nav", kind: "spot", spot: "write", color: "#EC4899" },

  { id: "flag", cat: "decor", kind: "prefab", color: "#E5584E", make: (i, j) => ({ t: "flag", i, j, c: "#E5584E", h: 3, emblem: "#FFFFFF" }) },
  { id: "snowman", cat: "decor", kind: "prefab", color: "#F8FAFC", make: (i, j) => ({ t: "snowman", i, j }) },

  { id: "cloud", cat: "atmosphere", kind: "prefab", color: "#FFFFFF", make: (i, j) => ({ t: "cloud", x: i - 12, y: 8.5, z: j - 14, seed: (i * 97 + j * 13) | 1 }) },
  { id: "snowfall", cat: "atmosphere", kind: "prefab", color: "#E2E8F0", make: (i, j) => ({ t: "snowfall", n: 150, seed: (i * 53 + j * 7) | 1 }) },
];
// CITY-PACKS: şehir paketi öğeleri `decor` prefab olarak (dünya biçimi değişmez)
PALETTE.push(...CITY_PALETTE.map((e): PaletteItem => ({ id: e.id, cat: e.cat, kind: e.kind, color: e.color, pack: e.pack, make: e.make })));
export const PALETTE_BY_ID = new Map(PALETTE.map((p) => [p.id, p]));

/** (i, j) çevresinde r yarıçaplı kare maske (çiçek tarhı); maske dünyanın ızgarası kadar (`grid.w × grid.d`).*/
export function areaMask(ci: number, cj: number, r: number, g: GridSize = { w: W, d: D }): string {
  let m = "";
  for (let j = 0; j < g.d; j++) for (let i = 0; i < g.w; i++) m += Math.abs(i - ci) <= r && Math.abs(j - cj) <= r ? "1" : "0";
  return m;
}

// ------------------------------------------------------------------------------------------ düzenleme işlemleri (saf)
const inGrid = (w: WorldFile, i: number, j: number) => i >= 0 && j >= 0 && i < w.grid.w && j < w.grid.d;
const sameTile = (a: Tile, b: Tile) => a[0] === b[0] && a[1] === b[1];

/** Prefab'ın kendiliğinden getirdiği navigasyon (masa → istasyon, kanepe → dinlenme, terminal → kabuk noktası…). */
export function attachedNav(p: Prefab): { stations: Station[]; rest: Tile[]; spots: [ToolKind, Station][] } {
  const out = { stations: [] as Station[], rest: [] as Tile[], spots: [] as [ToolKind, Station][] };
  switch (p.t) {
    case "desk": case "table": out.stations.push({ tile: [p.i, p.j - 1], face: FACE.up }); break;
    case "sofa": for (let k = 0; k < 3; k++) out.rest.push([p.i + k, p.j - 1]); break;
    case "bookshelf": out.spots.push(["read", { tile: [p.i, p.j + 1], face: FACE.down }]); break;
    case "server_rack": {
      const [di, dj] = { "+z": [0, 1], "-z": [0, -1], "+x": [1, 0], "-x": [-1, 0] }[p.face];
      const face = { "+z": FACE.down, "-z": FACE.up, "+x": FACE.left, "-x": FACE.right }[p.face];
      out.spots.push(["shell", { tile: [p.i + di, p.j + dj], face }]);
      break;
    }
    case "terminal": {
      const [di, dj, face] = p.glow === "+z" ? [0, 1, FACE.down] : p.glow === "+x" ? [1, 0, FACE.left] : [-1, 0, FACE.right];
      out.spots.push(["shell", { tile: [p.i + di, p.j + dj], face }]);
      break;
    }
    default: break;
  }
  return out;
}

/** Karodaki en üstteki (listede en son) seçilebilir prefab'ın sırası. */
export function prefabAt(w: WorldFile, i: number, j: number): number | null {
  const list = w.layers.prefabs;
  for (let k = list.length - 1; k >= 0; k--) if (cellsOf(list[k]).some((c) => c[0] === i && c[1] === j)) return k;
  return null;
}

export type NavHit = { kind: "station" | "rest" | "light" } | { kind: "spot"; spot: ToolKind };
/** Karodaki navigasyon işareti. */
export function navAt(w: WorldFile, i: number, j: number): NavHit | null {
  if (w.nav.stations.some((s) => sameTile(s.tile, [i, j]))) return { kind: "station" };
  if (w.nav.rest.some((t) => sameTile(t, [i, j]))) return { kind: "rest" };
  for (const k of ["web", "read", "plan", "shell", "write"] as ToolKind[]) if (w.nav.spots[k]?.some((s) => sameTile(s.tile, [i, j]))) return { kind: "spot", spot: k };
  if (w.layers.lights.some((l) => lightTile(l)[0] === i && lightTile(l)[1] === j)) return { kind: "light" };
  return null;
}

export const lightTile = (l: Light): Tile => [Math.floor(l.pos[0] + W / 2), Math.floor(l.pos[2] + D / 2)];

function withNav(w: WorldFile, nav: ReturnType<typeof attachedNav>, add: boolean): WorldFile {
  const free = (t: Tile) => inGrid(w, t[0], t[1]);
  const stations = add
    ? [...w.nav.stations, ...nav.stations.filter((s) => free(s.tile) && !w.nav.stations.some((x) => sameTile(x.tile, s.tile)))]
    : w.nav.stations.filter((s) => !nav.stations.some((x) => sameTile(x.tile, s.tile)));
  const rest = add
    ? [...w.nav.rest, ...nav.rest.filter((t) => free(t) && !w.nav.rest.some((x) => sameTile(x, t)))]
    : w.nav.rest.filter((t) => !nav.rest.some((x) => sameTile(x, t)));
  const spots = { ...w.nav.spots };
  for (const [k, s] of nav.spots) {
    const list = spots[k] ?? [];
    spots[k] = add ? (free(s.tile) && !list.some((x) => sameTile(x.tile, s.tile)) ? [...list, s] : list) : list.filter((x) => !sameTile(x.tile, s.tile));
  }
  return { ...w, nav: { stations, rest, spots } };
}

/** Palet öğesini (i, j) karosuna uygular. Değişiklik yoksa aynı nesne döner. */
export function applyItem(w: WorldFile, item: PaletteItem, i: number, j: number): WorldFile {
  if (!inGrid(w, i, j)) return w;
  const setGround = (c: string | null): WorldFile => {
    const ground = w.layers.ground ?? Array.from({ length: w.grid.d }, () => Array.from({ length: w.grid.w }, () => null as string | null));
    if (ground[j][i] === c && w.layers.ground) return w;
    const next = ground.map((row, jj) => (jj === j ? row.map((v, ii) => (ii === i ? c : v)) : row));
    // zemin boyası karodaki zemin düzeyindeki küpleri (yat güvertesi) ve suyu kaldırır
    const prefabs = w.layers.prefabs.filter((p) => !((p.t === "sea" || (p.t === "cube" && p.y + (p.h ?? 1) <= 0)) && p.i === i && p.j === j));
    return { ...w, layers: { ...w.layers, ground: next, prefabs } };
  };
  switch (item.kind) {
    case "floor": return setGround(item.floor!);
    case "void": return setGround(null);
    case "water": case "pond": {
      const cleared = setGround(null);
      return { ...cleared, layers: { ...cleared.layers, prefabs: [...cleared.layers.prefabs, item.make!(i, j, w.grid)] } };
    }
    case "prefab": {
      let p = item.make!(i, j, w.grid);
      if (p.t === "cube" && p.y >= 0) {
        // üst üste koy: karodaki en yüksek küpün üstüne
        const top = Math.max(0, ...w.layers.prefabs.filter((q) => q.t === "cube" && q.i === i && q.j === j && q.y >= 0)
          .map((q) => (q as { y: number; h?: number }).y + ((q as { h?: number }).h ?? 1)));
        if (top >= 8) return w;
        p = { ...p, y: top };
      }
      if (p.t === "snowfall" && w.layers.prefabs.some((q) => q.t === "snowfall")) return w;
      // CITY-PACKS: çok karolu süs ayak izi ızgaraya sığmalı
      if (p.t === "decor" && !p.free && cellsOf(p).some(([a, b]) => !inGrid(w, a, b))) return w;
      const next = { ...w, layers: { ...w.layers, prefabs: [...w.layers.prefabs, p] } };
      return withNav(next, attachedNav(p), true);
    }
    case "station":
      if (w.nav.stations.some((s) => sameTile(s.tile, [i, j]))) return w;
      return { ...w, nav: { ...w.nav, stations: [...w.nav.stations, { tile: [i, j], face: FACE.up }] } };
    case "rest":
      if (w.nav.rest.some((t) => sameTile(t, [i, j]))) return w;
      return { ...w, nav: { ...w.nav, rest: [...w.nav.rest, [i, j]] } };
    case "spot": {
      const list = w.nav.spots[item.spot!] ?? [];
      if (list.some((s) => sameTile(s.tile, [i, j]))) return w;
      return { ...w, nav: { ...w.nav, spots: { ...w.nav.spots, [item.spot!]: [...list, { tile: [i, j], face: FACE.down }] } } };
    }
    case "light":
      if (w.layers.lights.some((l) => sameTile(lightTile(l), [i, j]))) return w;
      return { ...w, layers: { ...w.layers, lights: [...w.layers.lights, { pos: [i - W / 2 + 0.5, 2.6, j - D / 2 + 0.5], color: "#FFE8C2", intensity: 5, distance: 9 }] } };
  }
}

/** Silgi: önce navigasyon işareti, sonra en üstteki prefab (ve getirdiği navigasyon), en son zemin. */
export function eraseAt(w: WorldFile, i: number, j: number): WorldFile {
  const nav = navAt(w, i, j);
  if (nav) {
    const t: Tile = [i, j];
    if (nav.kind === "station") return { ...w, nav: { ...w.nav, stations: w.nav.stations.filter((s) => !sameTile(s.tile, t)) } };
    if (nav.kind === "rest") return { ...w, nav: { ...w.nav, rest: w.nav.rest.filter((x) => !sameTile(x, t)) } };
    if (nav.kind === "light") return { ...w, layers: { ...w.layers, lights: w.layers.lights.filter((l) => !sameTile(lightTile(l), t)) } };
    if (nav.kind !== "spot") return w;
    return { ...w, nav: { ...w.nav, spots: { ...w.nav.spots, [nav.spot]: (w.nav.spots[nav.spot] ?? []).filter((s) => !sameTile(s.tile, t)) } } };
  }
  const idx = prefabAt(w, i, j);
  if (idx != null) return removePrefab(w, idx);
  if (w.layers.ground?.[j]?.[i]) return applyItem(w, PALETTE_BY_ID.get("floor_void")!, i, j);
  return w;
}

export function removePrefab(w: WorldFile, idx: number): WorldFile {
  const p = w.layers.prefabs[idx];
  if (!p) return w;
  const next = { ...w, layers: { ...w.layers, prefabs: w.layers.prefabs.filter((_, k) => k !== idx) } };
  return withNav(next, attachedNav(p), false);
}

/** Prefab'ı taşır; getirdiği navigasyon (masanın istasyonu…) onunla gider. Izgara dışına çıkıyorsa değişmez. */
export function movePrefabAt(w: WorldFile, idx: number, di: number, dj: number): WorldFile {
  const p = w.layers.prefabs[idx];
  if (!p || (!di && !dj)) return w;
  const moved = movePrefab(p, di, dj, w.grid);
  if (!ATMOSPHERE.has(moved.t) && !(moved.t === "decor" && moved.free) && cellsOf(moved).some(([a, b]) => !inGrid(w, a, b))) return w;
  const prefabs = w.layers.prefabs.map((q, k) => (k === idx ? moved : q));
  const nav = attachedNav(p);
  const shift = (t: Tile): Tile => [t[0] + di, t[1] + dj];
  const hit = (t: Tile) => nav.stations.some((s) => sameTile(s.tile, t)) || nav.rest.some((x) => sameTile(x, t));
  const spots = { ...w.nav.spots };
  for (const [k, s] of nav.spots) spots[k] = (spots[k] ?? []).map((x) => (sameTile(x.tile, s.tile) ? { ...x, tile: shift(x.tile) } : x));
  return {
    ...w,
    layers: { ...w.layers, prefabs },
    nav: {
      stations: w.nav.stations.map((s) => (hit(s.tile) ? { ...s, tile: shift(s.tile) } : s)),
      rest: w.nav.rest.map((t) => (hit(t) ? shift(t) : t)),
      spots,
    },
  };
}

export function rotatePrefabAt(w: WorldFile, idx: number): WorldFile {
  const p = w.layers.prefabs[idx];
  if (!p) return w;
  const r = rotatePrefab(p);
  if (r === p) return w;
  if (!ATMOSPHERE.has(r.t) && cellsOf(r).some(([a, b]) => !inGrid(w, a, b))) return w;
  const before = attachedNav(p), after = attachedNav(r);
  const next = withNav(withNav({ ...w, layers: { ...w.layers, prefabs: w.layers.prefabs.map((q, k) => (k === idx ? r : q)) } }, before, false), after, true);
  return next;
}

/** İstasyonun bakış yönünü 90° döndürür. */
export function rotateStationAt(w: WorldFile, i: number, j: number): WorldFile {
  const order = [FACE.up, FACE.left, FACE.down, FACE.right];
  return {
    ...w,
    nav: {
      ...w.nav,
      stations: w.nav.stations.map((s) => {
        if (!sameTile(s.tile, [i, j])) return s;
        const k = order.findIndex((f) => Math.abs(Math.atan2(Math.sin(f - s.face), Math.cos(f - s.face))) < 1e-3);
        return { ...s, face: order[(Math.max(0, k) + 1) % 4] };
      }),
    },
  };
}

export function updatePrefab(w: WorldFile, idx: number, patch: Partial<Record<string, unknown>>): WorldFile {
  return { ...w, layers: { ...w.layers, prefabs: w.layers.prefabs.map((q, k) => (k === idx ? ({ ...q, ...patch } as Prefab) : q)) } };
}

// ------------------------------------------------------------------------------------------ editör deposu
export type Tool = "select" | "draw" | "erase";
const HISTORY = 100;
const DRAFT_KEY = (id: string) => `vc-world-draft:${id}`;

interface EditorState {
  world: WorldFile | null;
  /** son kaydedilen hâlin JSON'u (kirli mi?) */
  saved: string;
  past: WorldFile[];
  future: WorldFile[];
  /** birleştirilen sürükleme vuruşu (aynı anahtar → tek geri alma adımı) */
  stroke: string | null;
  tool: Tool;
  item: string;
  selected: number | null;
  cursor: Tile;
  focusTile: Tile | null;
  load: (w: WorldFile, savedJson?: string) => void;
  apply: (fn: (w: WorldFile) => WorldFile, stroke?: string | null) => void;
  endStroke: () => void;
  undo: () => void;
  redo: () => void;
  markSaved: (w: WorldFile) => void;
  set: (p: Partial<Pick<EditorState, "tool" | "item" | "selected" | "cursor" | "focusTile">>) => void;
}

export const useEditor = create<EditorState>((set, get) => ({
  world: null, saved: "", past: [], future: [], stroke: null, tool: "draw", item: "floor_grass", selected: null, cursor: [12, 8], focusTile: null,
  load: (w, savedJson) => set({ world: w, saved: savedJson ?? JSON.stringify(w), past: [], future: [], stroke: null, selected: null, focusTile: null }),
  apply: (fn, stroke = null) => {
    const { world, past, stroke: cur } = get();
    if (!world) return;
    const next = fn(world);
    if (next === world) return;
    const merge = stroke != null && stroke === cur;
    set({ world: next, past: merge ? past : [...past, world].slice(-HISTORY), future: [], stroke });
  },
  endStroke: () => set({ stroke: null }),
  undo: () => {
    const { world, past, future } = get();
    if (!world || !past.length) return;
    set({ world: past[past.length - 1], past: past.slice(0, -1), future: [world, ...future], stroke: null, selected: null });
  },
  redo: () => {
    const { world, past, future } = get();
    if (!world || !future.length) return;
    set({ world: future[0], past: [...past, world], future: future.slice(1), stroke: null, selected: null });
  },
  markSaved: (w) => {
    set({ world: w, saved: JSON.stringify(w) });
    try { localStorage.removeItem(DRAFT_KEY(w.id)); } catch { /* yok say */ }
  },
  set: (p) => set(p),
}));

/** Güvenli otomatik taslak: yalnızca tarayıcıda (sunucudaki dosya kaydetmeden değişmez). */
export function writeDraft(w: WorldFile): void {
  try { localStorage.setItem(DRAFT_KEY(w.id), JSON.stringify({ at: Date.now(), world: w })); } catch { /* kota / gizli pencere */ }
}

export function readDraft(id: string): { at: number; world: WorldFile } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(id));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && v.world && v.world.id === id ? v : null;
  } catch {
    return null;
  }
}

export function dropDraft(id: string): void {
  try { localStorage.removeItem(DRAFT_KEY(id)); } catch { /* yok say */ }
}
