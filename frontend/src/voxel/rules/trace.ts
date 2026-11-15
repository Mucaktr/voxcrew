/**
 * S45 — kurulum izi: bir dünya kurulurken hangi ontoloji nesnelerinin (masa, bank, şezlong, tekne, kat döşemesi…) nereye
 * konduğunu kaydeder. İki kaynak:
 *  1. `Builder` yöntemleri (desk, parkBench, sunLounger, bed…) — `worldRecord.ts` gibi prototip geçici olarak sarılır;
 *     yalnızca EN DIŞ çağrı kaydedilir (bir yardımcının kendi içinde çağırdığı yardımcılar uygulama ayrıntısıdır).
 *  2. Serbest yardımcılar (`buildings.ts`, `districts/*`): `rules/hooks.ts` `noteObject` kancası.
 * Yalnızca kural denetimi (frontend/scripts/rules.mjs) kullanır; uygulama paketine girmez.
 */
import { Builder, tileOf, type Tile } from "../scenes";
import { traceHooks, type NoteInfo, type NotedType } from "./hooks";

/** Builder yöntemi → ontoloji türü ( türleri). Listede olmayan yöntemler ilkeldir
 * (box, cube, block, ground, station, sleep, hook, spot, done) ya da dekor süsüdür (cloud, snowfall).*/
const BUILDER_TYPES: Record<string, string> = {
  terminal: "terminal", laptop: "laptop", closedLaptop: "laptop", groundLaptop: "laptop",
  desk: "desk", monitor: "monitor", chair: "office_chair", serverRack: "server_rack", deskLamp: "desk_lamp",
  coffeeMachine: "coffee_machine", scoreboard: "scoreboard", lamp: "floor_lamp", sofa: "sofa",
  plant: "plant", tree: "tree", pine: "tree", palm: "palm", snowyPine: "tree", flowers: "flowers",
  wall: "wall", sideWall: "wall", sea: "water", sandbags: "sandbags", sandbagsZ: "sandbags", flag: "flag", crate: "crate",
  lantern: "lantern", parkBench: "bench", blanket: "blanket", basket: "basket", sunLounger: "sun_lounger", umbrella: "umbrella",
  hammock: "hammock", cot: "cot", bed: "bed", napPod: "nap_pod", daybed: "daybed", mat: "mat", openTent: "tent",
  canopy: "canopy", campChair: "camp_chair", stool: "stool",
};
/** (x, y, z) dünya koordinatı alan yöntemler: karo = tileOf(x, z). */
const WORLD_XYZ = new Set(["laptop", "closedLaptop", "crate"]);

export interface TracedObject {
  type: string;
  tile: Tile;
  /** kaynak: Builder yöntemi adı ya da `note:<tür>` */
  via: string;
  info?: NoteInfo;
}

function tileFor(name: string, a: unknown[]): Tile | null {
  const n = (k: number) => (typeof a[k] === "number" ? (a[k] as number) : NaN);
  let t: Tile;
  if (WORLD_XYZ.has(name)) t = tileOf(n(0), n(2));
  else if (name === "wall") t = [n(1), n(0)];          // wall(j, from, to, …)
  else if (name === "sandbags") t = [n(0), n(2)];      // sandbags(i0, i1, j)
  else if (name === "canopy") t = [n(0), n(2)];        // canopy(i0, i1, j0, j1)
  else if (name === "flowers") return null;
  else t = [n(0), n(1)];
  return Number.isFinite(t[0]) && Number.isFinite(t[1]) ? [Math.round(t[0]), Math.round(t[1])] : null;
}

/** `fn` çalışırken kurulan her Builder'ın nesnelerini kaydeder. Yeniden girişli değildir (tek iş parçacığı, betik). */
export function traceBuild<T>(fn: () => T): { result: T; objects: TracedObject[] } {
  const proto = Builder.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const saved = new Map<string, (...a: unknown[]) => unknown>();
  const objects: TracedObject[] = [];
  let depth = 0;
  for (const name of Object.keys(BUILDER_TYPES)) {
    const orig = proto[name];
    if (typeof orig !== "function") continue;
    saved.set(name, orig);
    proto[name] = function (this: Builder, ...args: unknown[]) {
      if (depth === 0) {
        const tile = tileFor(name, args);
        if (tile) objects.push({ type: BUILDER_TYPES[name], tile, via: name });
      }
      depth++;
      try { return orig.apply(this, args); } finally { depth--; }
    };
  }
  const prev = traceHooks.sink;
  traceHooks.sink = {
    note(_b: object, type: NotedType, tile: [number, number], info?: NoteInfo) {
      objects.push({ type, tile: [tile[0], tile[1]], via: `note:${type}`, ...(info ? { info } : {}) });
    },
  };
  try {
    return { result: fn(), objects };
  } finally {
    traceHooks.sink = prev;
    for (const [name, f] of saved) proto[name] = f;
  }
}
