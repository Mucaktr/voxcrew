/**
 * Faz 7a (S30) — yerleşik sahneleri `voxcrew-world.json`'a çeviren kaydedici. Yalnızca `frontend/scripts/worlds.mjs`
 * (üretim ve eşdeğerlik denetimi) kullanır; uygulama paketine girmez.
 *
 * Yöntem: `Builder` yöntemleri geçici olarak sarılır; sahnenin `build()` gövdesindeki ÜST DÜZEY çağrılar (yardımcı içi
 * çağrılar değil) sırasıyla kaydedilir. Yardımcılar (desk, tree, wall…) aynı adlı prefab'a, ham kutular tam karo ise
 * `cube` prefab'ına, değilse yakınlığa göre kümelenen `decor` prefab'larına dönüşür. Rastgelelik kullanan yardımcılar
 * (cloud, flowers, snowfall) çağrı anındaki üreteç durumunu `seed` olarak taşır; böylece sıra değişse de aynı blokları üretir.
 */
import { world as WM } from "../locales/world";
import type { Part, Prefab } from "./prefabs";
import { Builder, D, tx, tz, W, type Block, type Rng, type SceneDef } from "./scenes";
import { spinToPart } from "./spin";
import { KERB_DROPPED, KERB_MOVED } from "./city/kerbPoles";
import { bakeWorld, envOf, uses11, WORLD_FORMAT, WORLD_VERSION, WORLD_VERSION_11, type GlowMark, type WorldFile } from "./worldFormat";

const NAMES = [
  "box", "cube", "block", "ground", "station", "spot", "terminal", "laptop", "desk", "plant", "tree", "pine", "palm", "cloud",
  "flowers", "wall", "sideWall", "sea", "sandbags", "sandbagsZ", "flag", "crate", "lantern", "snowyPine", "snowfall",
  // S33 canlı dekor
  "monitor", "chair", "serverRack", "coffeeMachine", "scoreboard", "lamp", "deskLamp", "sofa",
] as const;
type Name = (typeof NAMES)[number];
type Fn = (...a: unknown[]) => unknown;

interface Op {
  name: Name;
  args: unknown[];
  /** üreteç durumu (çağrıdan önce) */
  rs: number;
  /** bu çağrının ürettiği bloklar */
  blocks: Block[];
  grid?: (string | null)[][];
  mask?: string;
  colors?: string[][];
}

/** Sabit üretim zamanı: aynı kaynak → aynı JSON (eşdeğerlik denetimi kayma yakalar). */
export const BUILTIN_STAMP = "2026-10-17T00:00:00Z";
const r4 = (n: number) => Math.round(n * 1e4) / 1e4 || 0;

function record(def: SceneDef): { ops: Op[]; built: ReturnType<SceneDef["build"]> } {
  const proto = Builder.prototype as unknown as Record<Name, Fn>;
  const saved = new Map<Name, Fn>();
  const ops: Op[] = [];
  let depth = 0;
  for (const name of NAMES) {
    const orig = proto[name];
    saved.set(name, orig);
    proto[name] = function (this: Builder, ...args: unknown[]) {
      if (depth > 0) return orig.apply(this, args);
      const op: Op = { name, args, rs: (this.rand as Rng).state, blocks: [] };
      if (name === "ground") {
        const top = args[0] as (i: number, j: number) => string | null;
        op.grid = Array.from({ length: this.d }, (_, j) => Array.from({ length: this.w }, (_, i) => top(i, j) ?? null));
      } else if (name === "flowers") {
        const ok = args[1] as (i: number, j: number) => boolean;
        let m = "";
        for (let j = 0; j < this.d; j++) for (let i = 0; i < this.w; i++) m += ok(i, j) ? "1" : "0";
        op.mask = m;
      } else if (name === "wall") {
        const [, from, to, h, color] = args as [number, number, number, number, (i: number, y: number) => string];
        op.colors = Array.from({ length: to - from + 1 }, (_, k) => Array.from({ length: h }, (_, y) => color(from + k, y)));
      }
      const before = this.blocks.length;
      depth++;
      try {
        return orig.apply(this, args);
      } finally {
        depth--;
        op.blocks = this.blocks.slice(before);
        ops.push(op);
      }
    };
  }
  try {
    return { ops, built: def.build() };
  } finally {
    for (const [name, fn] of saved) proto[name] = fn;
  }
}

const tileOfBlock = (b: Block): [number, number] => [Math.floor(b.p[0] + W / 2), Math.floor(b.p[2] + D / 2)];
/** CITY-BIG: kaydedilen taban ızgarasının boyutu (`recordScene` başında kurulan tabandan; varsayılan 24×16) */
let GW = W, GD = D;
const inGrid = (i: number, j: number) => i >= 0 && j >= 0 && i < GW && j < GD;
const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi - 1, v));

function partOf(b: Block, ai: number, aj: number): Part {
  const part: Part = [r4(b.p[0] - tx(ai)), r4(b.p[1]), r4(b.p[2] - tz(aj)), r4(b.s[0]), r4(b.s[1]), r4(b.s[2]), b.c];
  if (b.g !== "solid" || b.j || b.r) part.push(b.g);
  if (b.j || b.r) part.push(r4(b.j));
  // dönen blok tanımı (pivot/askı çapaya göre görece; prefab döndürülünce birlikte döner)
  if (b.r && b.g === "spin") part.push(spinToPart(b.r, tx(ai), tz(aj), r4));
  return part;
}

/** Sahneyi dünya dosyasına çevirir (meta.sha256 hariç; onu betik ekler). */
export function recordScene(def: SceneDef): WorldFile {
  const { ops, built } = record(def);
  GW = built.width; GD = built.depth;
  let ground: (string | null)[][] | null = null;
  let under: string | null = null;
  let groundJit = 0.06;
  const prefabs: Prefab[] = [];
  let cluster: (Prefab & { t: "decor" }) | null = null;
  let lastCube: (Prefab & { t: "cube" }) | null = null;

  const close = () => { cluster = null; };
  const rawBlock = (b: Block) => {
    const [ti, tj] = tileOfBlock(b);
    const free = !inGrid(ti, tj);
    const fullTile = !free && !b.r && b.s[0] === 1 && b.s[2] === 1 && Math.abs(b.p[0] - tx(ti)) < 1e-9 && Math.abs(b.p[2] - tz(tj)) < 1e-9;
    if (fullTile) {
      close();
      const cube: Prefab & { t: "cube" } = { t: "cube", i: ti, j: tj, y: r4(b.p[1] - b.s[1] / 2), c: b.c };
      if (b.s[1] !== 1) cube.h = r4(b.s[1]);
      if (b.g !== "solid") cube.g = b.g;
      if (b.j !== 0.04) cube.jit = r4(b.j);
      prefabs.push(cube);
      lastCube = cube;
      return;
    }
    lastCube = null;
    const c = cluster as (Prefab & { t: "decor" }) | null;
    const fits = c && !!c.free === free && (free || (Math.abs(ti - c.i) <= 2 && Math.abs(tj - c.j) <= 2));
    if (c && fits) { c.parts.push(partOf(b, c.i, c.j)); return; }
    const ai = clamp(ti, GW), aj = clamp(tj, GD);
    const next: Prefab & { t: "decor" } = { t: "decor", i: ai, j: aj, parts: [partOf(b, ai, aj)] };
    if (free) next.free = true;
    prefabs.push(next);
    cluster = next;
  };

  ops.forEach((op, idx) => {
    const a = op.args as never[];
    // kerbScene yardımcının bir bloğunu kaydırdı/çizmedi → yardımcı prefab değil, son konumdaki ham bloklar (bake aynı)
    if (op.blocks.some((b) => KERB_MOVED.has(b) || KERB_DROPPED.has(b))) {
      for (const b of op.blocks) if (!KERB_DROPPED.has(b)) { lastCube = null; rawBlockInCluster(b); }
      return;
    }
    switch (op.name) {
      case "station": case "spot": return; // navigasyon Built'ten okunur
      case "ground":
        if (idx !== 0) throw new Error(`${def.id}: ground ilk çağrı olmalı`);
        ground = op.grid!; under = a[1]; groundJit = a[2] ?? 0.06;
        return;
      case "box": case "cube": case "laptop": case "crate":
        if (op.blocks.length === 1 && op.name !== "laptop" && op.name !== "crate") { rawBlock(op.blocks[0]); return; }
        lastCube = null;
        for (const b of op.blocks) { lastCube = null; rawBlockInCluster(b); }
        return;
      case "block": {
        const [i, j] = a as unknown as [number, number];
        const lc = lastCube as (Prefab & { t: "cube" }) | null;
        if (lc && lc.i === i && lc.j === j && !lc.solid) { lc.solid = true; lastCube = null; return; }
        lastCube = null;
        const c = cluster as (Prefab & { t: "decor" }) | null;
        if (c && !c.free && Math.abs(i - c.i) <= 2 && Math.abs(j - c.j) <= 2) { (c.cells ??= []).push([i - c.i, j - c.j]); return; }
        close();
        prefabs.push({ t: "block", i, j });
        return;
      }
      default:
        close();
        lastCube = null;
        prefabs.push(helper(op));
    }
  });

  /** Çok bloklu ham yardımcı (laptop/crate): blokları tam karo olsa bile dekor kümesine girer. */
  function rawBlockInCluster(b: Block) {
    const [ti, tj] = tileOfBlock(b);
    const free = !inGrid(ti, tj);
    const c = cluster as (Prefab & { t: "decor" }) | null;
    if (c && !!c.free === free && (free || (Math.abs(ti - c.i) <= 2 && Math.abs(tj - c.j) <= 2))) { c.parts.push(partOf(b, c.i, c.j)); return; }
    const ai = clamp(ti, GW), aj = clamp(tj, GD);
    const next: Prefab & { t: "decor" } = { t: "decor", i: ai, j: aj, parts: [partOf(b, ai, aj)] };
    if (free) next.free = true;
    prefabs.push(next);
    cluster = next;
  }

  const labels = WM.tr as Record<string, string>;
  // v1.1 (SP-W1): ufuk silüeti, hareketli set parçaları ve bölgeler Built'ten okunur (Builder dizileri; ızgara bloğu değil)
  const layers: WorldFile["layers"] = { ground, under, groundJit, prefabs, lights: built.lights.map((l) => ({ ...l })) };
  if (built.backdrop?.length) layers.backdrop = built.backdrop.map((b) => {
    const pt: Part = [r4(b.p[0]), r4(b.p[1]), r4(b.p[2]), r4(b.s[0]), r4(b.s[1]), r4(b.s[2]), b.c];
    if (b.g !== "solid" || b.j) pt.push(b.g);
    if (b.j) pt.push(r4(b.j));
    return pt;
  });
  if (built.movers?.length) layers.movers = built.movers.map((m) => ({ ...m, path: m.path.map((q) => [r4(q[0]), r4(q[1]), r4(q[2])] as [number, number, number]) }));
  const file: WorldFile = {
    format: WORLD_FORMAT,
    version: WORLD_VERSION,
    id: def.id,
    meta: {
      name: labels[`scene_${def.id}`] ?? def.id,
      description: labels[`scene_${def.id}_hint`] ?? "",
      author: { name: "builtin", id: null },
      license: "LicenseRef-PolyForm-Shield-1.0.0",
      created: BUILTIN_STAMP,
      updated: BUILTIN_STAMP,
      tags: ["builtin"],
      ip_risk: 0,
      basedOn: null,
    },
    grid: { w: built.width, d: built.depth, annex: def.id, ...(def.core ? { core: [def.core.i0, def.core.j0, def.core.w, def.core.d] as [number, number, number, number] } : {}) },
    env: envOf(def),
    layers,
    nav: navOf(built),
    zones: (built.zones ?? []).map((z) => ({ ...z })),
    elements: [],
    baked: null,
  };
  // v1.1: yardımcı içinde engeli kaldırılan karolar (köprü) — pişirilmiş engellerle farkı `nav.open` taşır
  const baked = bakeWorld(file).blocked;
  const open = [...baked].filter((k) => !built.blocked.has(k)).map((k) => k.split(",").map(Number) as [number, number]);
  if (open.length) file.nav.open = open;
  // sahne kurulumu sonrası engellenen karo (kerbScene'in taşıdığı direk/ağaç karosu) — `block` prefab'ı
  for (const k of built.blocked) if (!baked.has(k)) { const [i, j] = k.split(",").map(Number); file.layers.prefabs.push({ t: "block", i, j }); }
  // v1.1 (W2-INT): prefab'tan türemeyen gece parıltı işaretleri (şehir kiti pencere/lamba) — pişirilmiş dünyada eksik kalanlar
  const sig = (m: { k: string; p: number[]; r: number; s?: number[]; c?: string }) =>
    [m.k, ...m.p.map(r4), r4(m.r), r4(m.s?.[0] ?? 0), r4(m.s?.[1] ?? 0), m.c ?? ""].join("|");
  const have = new Map<string, number>();
  for (const m of bakeWorld(file).props ?? []) have.set(sig(m), (have.get(sig(m)) ?? 0) + 1);
  const glows: GlowMark[] = [];
  for (const m of built.props ?? []) {
    if (m.k !== "window" && m.k !== "lamp") continue;
    const n = have.get(sig(m)) ?? 0;
    if (n > 0) { have.set(sig(m), n - 1); continue; }
    glows.push([m.k, r4(m.p[0]), r4(m.p[1]), r4(m.p[2]), r4(m.r), r4(m.s?.[0] ?? 0), r4(m.s?.[1] ?? 0), m.c ?? "#FFE9A8"]);
  }
  if (glows.length) file.layers.glows = glows;
  if (uses11(file)) file.version = WORLD_VERSION_11;
  return file;
}

/** S41: araç noktaları `spots`'ta, uyku noktaları ve canlı ortam kancaları ayrı alanlarda (eski okuyucular `spots`'ta yalnızca
 *  araç türü bekler). */
function navOf(built: ReturnType<SceneDef["build"]>): WorldFile["nav"] {
  const { sleep, ...tools } = built.spots;
  const nav: WorldFile["nav"] = { stations: built.stations, rest: built.rest, spots: tools };
  if (sleep?.length) nav.sleep = sleep;
  if (built.ambient?.length) nav.ambient = built.ambient;
  return nav;
}

function helper(op: Op): Prefab {
  const a = op.args as never[];
  switch (op.name) {
    case "desk": {
      const p: Prefab & { t: "desk" } = { t: "desk", i: a[0], j: a[1], w: a[2], top: a[3], legs: a[4] };
      if (a[5]) p.bare = true;
      return p;
    }
    case "monitor": {
      const p: Prefab & { t: "monitor" } = { t: "monitor", i: a[0], j: a[1], face: a[2] };
      if (a[3]) p.dx = a[3];
      if (a[4]) p.dz = a[4];
      if (a[5] !== undefined && a[5] !== 0.79) p.y = a[5];
      return p;
    }
    case "chair": {
      const p: Prefab & { t: "chair" } = { t: "chair", i: a[0], j: a[1], face: a[2] };
      if (a[3]) p.c = a[3];
      return p;
    }
    case "serverRack": return { t: "server_rack", i: a[0], j: a[1], face: a[2] };
    case "coffeeMachine": {
      const p: Prefab & { t: "coffee_machine" } = { t: "coffee_machine", i: a[0], j: a[1], face: a[2] ?? "+z" };
      if (a[3]) p.counter = true;
      return p;
    }
    case "scoreboard": return { t: "scoreboard", i: a[0], j: a[1], w: a[2] ?? 2 };
    case "lamp": return { t: "lamp", i: a[0], j: a[1], glow: a[2] ?? "#FDE68A" };
    case "deskLamp": return { t: "lamp", i: a[0], j: a[1], glow: a[2] ?? "#FDE68A", desk: true, dx: a[3] ?? 0.25, dz: a[4] ?? -0.25 };
    case "sofa": return { t: "sofa", i: a[0], j: a[1], c: a[2], back: a[3] };
    case "plant": case "pine": case "palm": case "snowyPine": return { t: op.name, i: a[0], j: a[1] };
    case "tree": return { t: "tree", i: a[0], j: a[1], h: a[2] ?? 3 };
    case "lantern": return { t: "lantern", i: a[0], j: a[1], glow: a[2] ?? "#FFD27A", post: a[3] ?? "#374151" };
    case "terminal": return { t: "terminal", i: a[0], j: a[1], glow: a[2] };
    case "flag": {
      const p: Prefab & { t: "flag" } = { t: "flag", i: a[0], j: a[1], c: a[2], h: a[3] ?? 3 };
      if (a[4]) p.emblem = a[4];
      return p;
    }
    case "wall": {
      const [j, from, to, h, , windows] = a as unknown as [number, number, number, number, unknown, [number, number][] | undefined];
      const colors = op.colors!;
      const flat = new Set(colors.flat());
      const p: Prefab & { t: "wall" } = { t: "wall", i: from, j, len: to - from + 1, h, axis: "x" };
      if (flat.size === 1) p.c = [...flat][0];
      else p.colors = colors;
      if (windows?.length) p.win = windows.map(([x, y]) => [x - from, y - from]);
      return p;
    }
    case "sideWall": return { t: "wall", i: a[0], j: a[1], len: (a[2] as number) - (a[1] as number) + 1, h: a[3], axis: "z", c: a[4] };
    case "sea": return { t: "sea", i: a[0], j: a[1], c: a[2], top: a[3] ?? -0.2, blocking: a[4] ?? true };
    case "sandbags": return { t: "sandbags", i: a[0], j: a[2], len: (a[1] as number) - (a[0] as number) + 1, axis: "x", layers: a[3] ?? 2 };
    case "sandbagsZ": return { t: "sandbags", i: a[0], j: a[1], len: (a[2] as number) - (a[1] as number) + 1, axis: "z", layers: a[3] ?? 2 };
    case "cloud": return { t: "cloud", x: a[0], y: a[1], z: a[2], seed: op.rs };
    case "flowers": return { t: "flowers", n: a[0], seed: op.rs, mask: op.mask! };
    case "snowfall": return { t: "snowfall", n: a[0], seed: op.rs };
    default: throw new Error(`kaydedilemeyen çağrı: ${op.name}`);
  }
}
