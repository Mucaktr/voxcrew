/**
 * Faz 7a (S30) — prefab kayıt defteri: dünya biçiminin (voxcrew-world.json, bkz. worldFormat.ts) semantik katmanı.
 * Her prefab türü `scenes.ts` `Builder` yardımcılarıyla belirlenimci olarak pişer (bake) — yeni bir render yolu yok;
 * 11 yerleşik sahne aynı yardımcılarla kayıt edilip (worldRecord.ts) JSON'a çevrilir ve birebir aynı blokları üretir.
 *
 * Kurallar: prefab'lar karo çapalıdır (i, j); yalnızca atmosfer (cloud/flowers/snowfall) ve ızgara dışı dekor (`free`)
 * çapasızdır. Engellenen karolar `footprint` ile hesaplanır — backend `studio/worlds/validate.py` aynı tabloyu kullanır.
 */
import { Builder, D, rng, tx, tz, W, type Dir, type Group, type Tile } from "./scenes";
import { rotateSpinPart, spinFromPart, type SpinPart } from "./spin";

export const GROUPS: readonly Group[] = ["solid", "glow", "water", "glass", "cloud", "flame", "wave", "bob", "flag", "snow", "spin"];
/** dönüş tanımı taşımayan alanlarda (cube, ufuk) kullanılabilen gruplar (`spin` yalnız decor parçasında, tanımıyla).*/
export const STATIC_GROUPS: readonly Group[] = GROUPS.filter((g) => g !== "spin");
/** Ajanın bakış yönü (scenes.ts): +z kameraya doğru. */
export const FACE = { up: 0, down: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 } as const;

/** Dekor parçası: [dx, y, dz, w, h, d, renk, grup?, titreşim?, dönüş?] — dx/dz çapa karonun merkezine göre. `dönüş`
 * yalnız grup `spin` iken ve zorunlu (`SpinPart`: o/k çapaya göre görece).*/
export type Part = [number, number, number, number, number, number, string, Group?, number?, SpinPart?];
export type Axis = "x" | "z";
export type TerminalGlow = "+z" | "+x" | "-x";

interface At { i: number; j: number }
export type Prefab =
  | (At & { t: "cube"; y: number; h?: number; c: string; g?: Group; jit?: number; solid?: boolean })
  | (At & { t: "decor"; parts: Part[]; cells?: Tile[]; free?: boolean })
  | (At & { t: "block" })
  | (At & { t: "desk"; w: number; top: string; legs: string; bare?: boolean })
  | (At & { t: "plant" | "pine" | "palm" | "snowyPine" | "snowman" | "campfire" })
  | (At & { t: "tree"; h: number })
  | (At & { t: "lantern"; glow: string; post: string })
  | (At & { t: "terminal"; glow: TerminalGlow })
  | (At & { t: "flag"; c: string; h: number; emblem?: string })
  | (At & { t: "wall"; len: number; h: number; axis: Axis; c?: string; colors?: string[][]; win?: [number, number][] })
  | (At & { t: "sandbags"; len: number; axis: Axis; layers: number })
  | (At & { t: "sea"; c: string; top: number; blocking: boolean })
  | (At & { t: "crate"; c: string; s: number })
  | (At & { t: "table"; top: string })
  | (At & { t: "bookshelf"; c: string })
  | (At & { t: "sofa"; c: string; back: string })
  | (At & { t: "lamp"; glow: string; desk?: boolean; dx?: number; dz?: number })
  // S33 canlı dekor
  | (At & { t: "monitor"; face: Dir; dx?: number; dz?: number; y?: number })
  | (At & { t: "chair"; face: Dir; c?: string })
  | (At & { t: "server_rack"; face: Dir })
  | (At & { t: "coffee_machine"; face?: Dir; counter?: boolean })
  | (At & { t: "scoreboard"; w: number })
  | (At & { t: "rock"; c: string })
  | { t: "cloud"; x: number; y: number; z: number; seed: number }
  | { t: "flowers"; n: number; seed: number; mask: string }
  | { t: "snowfall"; n: number; seed: number };

export type PrefabType = Prefab["t"];
export const PREFAB_TYPES: readonly PrefabType[] = [
  "cube", "decor", "block", "desk", "plant", "pine", "palm", "snowyPine", "snowman", "campfire", "tree", "lantern", "terminal",
  "flag", "wall", "sandbags", "sea", "crate", "table", "bookshelf", "sofa", "lamp", "rock", "cloud", "flowers", "snowfall",
  "monitor", "chair", "server_rack", "coffee_machine", "scoreboard",
];
/** Atmosfer: ızgarada seçilmez, yan listede yönetilir. */
export const ATMOSPHERE: ReadonlySet<PrefabType> = new Set(["cloud", "flowers", "snowfall"]);

const BOOK = ["#EF4444", "#3B82F6", "#F59E0B", "#10B981"];

/** Prefab'ı kurucuya pişirir (sıra önemlidir: çiçekler o ana kadar engellenen karolara konmaz). */
export function bakePrefab(b: Builder, p: Prefab): void {
  switch (p.t) {
    case "cube":
      b.cube(p.i, p.j, p.y, p.c, p.h ?? 1, p.g ?? "solid", p.jit ?? 0.04);
      if (p.solid) b.block(p.i, p.j);
      return;
    case "decor": {
      const x0 = tx(p.i), z0 = tz(p.j);
      for (const [dx, y, dz, w, h, d, c, g, jit, sp] of p.parts) b.box(x0 + dx, y, z0 + dz, w, h, d, c, g ?? "solid", jit ?? 0, sp ? spinFromPart(sp, x0, z0) : undefined);
      for (const [di, dj] of p.cells ?? []) b.block(p.i + di, p.j + dj);
      return;
    }
    case "block": b.block(p.i, p.j); return;
    case "desk": b.desk(p.i, p.j, p.w, p.top, p.legs, !!p.bare); return;
    case "plant": b.plant(p.i, p.j); return;
    case "pine": b.pine(p.i, p.j); return;
    case "palm": b.palm(p.i, p.j); return;
    case "snowyPine": b.snowyPine(p.i, p.j); return;
    case "tree": b.tree(p.i, p.j, p.h); return;
    case "lantern": b.lantern(p.i, p.j, p.glow, p.post); return;
    case "terminal": b.terminal(p.i, p.j, p.glow); return;
    case "flag": b.flag(p.i, p.j, p.c, p.h, p.emblem); return;
    case "wall": {
      for (let k = 0; k < p.len; k++) {
        const [i, j] = p.axis === "x" ? [p.i + k, p.j] : [p.i, p.j + k];
        for (let y = 0; y < p.h; y++) {
          const win = (p.win ?? []).some(([a, c]) => k >= a && k <= c) && y >= 1 && y <= 2;
          if (win) b.cube(i, j, y, "#A8D8F0", 1, "glass");
          else b.cube(i, j, y, p.colors?.[k]?.[y] ?? p.c ?? "#E2DACB", 1, "solid", 0.03);
        }
        b.block(i, j);
      }
      return;
    }
    case "sandbags":
      if (p.axis === "x") b.sandbags(p.i, p.i + p.len - 1, p.j, p.layers);
      else b.sandbagsZ(p.i, p.j, p.j + p.len - 1, p.layers);
      return;
    case "sea": b.sea(p.i, p.j, p.c, p.top, p.blocking); return;
    case "crate": b.crate(tx(p.i), 0, tz(p.j), p.s, p.c); b.block(p.i, p.j); return;
    case "table": {
      const x = tx(p.i), z = tz(p.j);
      b.box(x, 0.35, z, 0.15, 0.7, 0.15, "#3F3F46");
      b.box(x, 0.74, z, 0.95, 0.08, 0.95, p.top, "solid", 0.03);
      b.laptop(x, 0.78, z, "-z");
      b.box(x + 0.32, 0.86, z + 0.2, 0.14, 0.16, 0.14, "#FFFFFF");
      b.block(p.i, p.j);
      return;
    }
    case "bookshelf": {
      const x = tx(p.i), z = tz(p.j);
      b.box(x, 1.1, z, 1, 2.2, 0.8, p.c, "solid", 0.04);
      for (const y of [0.5, 1.2, 1.9]) for (let k = 0; k < 4; k++) b.box(x - 0.33 + k * 0.22, y, z + 0.42, 0.16, 0.45, 0.05, BOOK[(k + p.i) % 4]);
      b.block(p.i, p.j);
      return;
    }
    case "sofa": b.sofa(p.i, p.j, p.c, p.back); return;
    case "lamp":
      if (p.desk) b.deskLamp(p.i, p.j, p.glow, p.dx ?? 0.25, p.dz ?? -0.25);
      else b.lamp(p.i, p.j, p.glow);
      return;
    case "monitor": b.monitor(p.i, p.j, p.face, p.dx ?? 0, p.dz ?? 0, p.y ?? 0.79); return;
    case "chair": b.chair(p.i, p.j, p.face, p.c); return;
    case "server_rack": b.serverRack(p.i, p.j, p.face); return;
    case "coffee_machine": b.coffeeMachine(p.i, p.j, p.face ?? "+z", !!p.counter); return;
    case "scoreboard": b.scoreboard(p.i, p.j, p.w); return;
    case "campfire": {
      const x = tx(p.i), z = tz(p.j);
      for (let a = 0; a < 8; a++) b.box(x + Math.cos(a * 0.785) * 0.5, 0.1, z + Math.sin(a * 0.785) * 0.5, 0.22, 0.2, 0.22, "#78716C");
      b.box(x, 0.36, z, 0.42, 0.42, 0.42, "#FF7A1A", "flame");
      b.box(x, 0.68, z, 0.24, 0.3, 0.24, "#FFD34D", "flame");
      b.block(p.i, p.j);
      return;
    }
    case "rock":
      b.box(tx(p.i), 0.25, tz(p.j), 0.8, 0.5, 0.7, p.c, "solid", 0.08);
      b.box(tx(p.i) + 0.1, 0.6, tz(p.j) - 0.05, 0.5, 0.3, 0.45, p.c, "solid", 0.1);
      b.block(p.i, p.j);
      return;
    case "snowman": {
      const x = tx(p.i), z = tz(p.j);
      b.box(x, 0.35, z, 0.7, 0.7, 0.7, "#F8FAFC"); b.box(x, 0.95, z, 0.52, 0.52, 0.52, "#F8FAFC");
      b.box(x, 1.42, z, 0.4, 0.4, 0.4, "#F8FAFC"); b.box(x, 1.42, z + 0.26, 0.08, 0.08, 0.22, "#F97316");
      b.box(x, 1.2, z, 0.58, 0.1, 0.58, "#D9453B"); b.box(x, 1.72, z, 0.42, 0.06, 0.42, "#1F2937");
      b.box(x, 1.92, z, 0.28, 0.34, 0.28, "#1F2937");
      b.block(p.i, p.j);
      return;
    }
    case "cloud": b.rand = rng(p.seed); b.cloud(p.x, p.y, p.z); return;
    case "flowers": b.rand = rng(p.seed); b.flowers(p.n, (i, j) => p.mask[j * b.w + i] === "1"); return;
    case "snowfall": b.rand = rng(p.seed); b.snowfall(p.n); return;
  }
}

/** Prefab'ın engellediği karolar (yol bulma). Backend `validate.py` `footprint` ile aynı. */
export function footprint(p: Prefab): Tile[] {
  switch (p.t) {
    case "cube": return p.solid ? [[p.i, p.j]] : [];
    case "sea": return p.blocking ? [[p.i, p.j]] : [];
    case "decor": return (p.cells ?? []).map(([di, dj]) => [p.i + di, p.j + dj] as Tile);
    case "desk": return Array.from({ length: p.w }, (_, k) => [p.i + k, p.j] as Tile);
    case "sofa": return [0, 1, 2].map((k) => [p.i + k, p.j] as Tile);
    case "monitor": case "chair": case "scoreboard": return [];
    case "coffee_machine": return p.counter ? [] : [[p.i, p.j]];
    case "lamp": return p.desk ? [] : [[p.i, p.j]];
    case "wall": case "sandbags":
      return Array.from({ length: p.len }, (_, k) => (p.axis === "x" ? [p.i + k, p.j] : [p.i, p.j + k]) as Tile);
    case "cloud": case "flowers": case "snowfall": return [];
    default: return [[p.i, p.j]];
  }
}

/** Editörde prefab'ın kapladığı (seçilebilir) karolar: engel yoksa çapa karosu. Atmosfer ve ızgara dışı dekor: boş. */
export function cellsOf(p: Prefab): Tile[] {
  if (p.t === "cloud" || p.t === "flowers" || p.t === "snowfall" || (p.t === "decor" && p.free)) return [];
  const f = footprint(p);
  return f.length ? f : [[p.i, p.j]];
}

/** Dünya ızgarasının boyutu (`WorldFile.grid`; taban 24×16, şehir tabanları 36×32). */
export interface GridSize { w: number; d: number }

/** Prefab'ı karo cinsinden kaydırır (yeni nesne). Çiçek maskesi `g` ızgarası boyunca kaydırılır (yoksa 24×16).*/
export function movePrefab(p: Prefab, di: number, dj: number, g: GridSize = { w: W, d: D }): Prefab {
  switch (p.t) {
    case "cloud": return { ...p, x: p.x + di, z: p.z + dj };
    case "snowfall": return p;
    case "flowers": {
      let mask = "";
      for (let j = 0; j < g.d; j++) for (let i = 0; i < g.w; i++) {
        const si = i - di, sj = j - dj;
        mask += si >= 0 && sj >= 0 && si < g.w && sj < g.d ? p.mask[sj * g.w + si] ?? "0" : "0";
      }
      return { ...p, mask };
    }
    default: return { ...p, i: p.i + di, j: p.j + dj };
  }
}

const round = (n: number) => Math.round(n * 1e4) / 1e4 || 0;
/** Yukarıdan saat yönünde 90°: (dx, dz) → (−dz, dx), yani +z → −x → −z → +x → +z. */
const ROT_DIR: Record<Dir, Dir> = { "+z": "-x", "-x": "-z", "-z": "+x", "+x": "+z" };

/** Prefab'ı yukarıdan bakışta saat yönünde 90° döndürür (yönsüz prefab'lar aynı döner). */
export function rotatePrefab(p: Prefab): Prefab {
  switch (p.t) {
    case "decor":
      return {
        ...p,
        parts: p.parts.map(([dx, y, dz, w, h, d, c, g, jit, sp]) => {
          const out: Part = [round(-dz), y, round(dx), d, h, w, c];
          if (g !== undefined || jit !== undefined || sp) out.push(g ?? "solid");
          if (jit !== undefined || sp) out.push(jit ?? 0);
          if (sp) out.push(rotateSpinPart(sp, round));
          return out;
        }),
        cells: p.cells?.map(([di, dj]) => [-dj, di] as Tile),
      };
    case "wall": return { ...p, axis: p.axis === "x" ? "z" : "x" };
    case "sandbags": return { ...p, axis: p.axis === "x" ? "z" : "x" };
    case "terminal": return { ...p, glow: p.glow === "+z" ? "-x" : p.glow === "-x" ? "+x" : "+z" };
    case "monitor": return { ...p, face: ROT_DIR[p.face], dx: p.dz !== undefined ? round(-p.dz) : undefined, dz: p.dx };
    case "lamp": return p.desk ? { ...p, dx: round(-(p.dz ?? -0.25)), dz: p.dx ?? 0.25 } : p;
    case "chair": case "server_rack": return { ...p, face: ROT_DIR[p.face] };
    case "coffee_machine": return { ...p, face: ROT_DIR[p.face ?? "+z"] };
    default: return p;
  }
}

/** Pişince üretilecek blok sayısının üst sınırı (backend ile aynı tablo; editör kesin sayıyı bake'ten alır). */
export function blockBound(p: Prefab): number {
  switch (p.t) {
    case "cube": case "sea": return 1;
    case "decor": return p.parts.length;
    case "block": return 0;
    case "desk": return p.w > 1 ? 9 : 8;
    case "plant": return 3;
    case "tree": return p.h + 14;
    case "pine": return 5;
    case "palm": return 16;
    case "snowyPine": return 9;
    case "lantern": return 3;
    case "terminal": return 5;
    case "flag": return p.emblem ? 5 : 4;
    case "wall": return p.len * p.h;
    case "sandbags": return p.len * p.layers * 2;
    case "crate": case "sofa": case "lamp": case "rock": case "scoreboard": return 2;
    case "monitor": return 3;
    case "chair": return 5;
    case "server_rack": return 8;
    case "coffee_machine": return 5;
    case "table": return 6;
    case "bookshelf": return 13;
    case "campfire": return 10;
    case "snowman": return 7;
    case "cloud": return 4;
    case "flowers": return p.n * 2;
    case "snowfall": return p.n;
  }
}
