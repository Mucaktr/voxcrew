/**
 * E3 (BUILD-UX) — parsel hacmi: doluluk, yerleştirme ve gövde kuralları ( BUILD-*).
 * Saf modül. Sunucu `backend/studio/expanse/build.py` aynı kodlarla aynı kuralları uygular (araziden bağımsız kısım); istemci ek
 * olarak gerçek arazi ızgarasıyla (çit, bank, rozet, deniz) kesin yürünebilirliği denetler.
 *
 * Kurallar (araziden bağımsız, iki tarafta aynı):
 * - BUILD-ZONE-001: hücre parsel hacminde (li < 12, y < 8, lj < 16); kenar halkası (çit / dikiş şeridi) inşa edilemez.
 * - BUILD-NAV-001: omurga (li 5–6, lj 7–8) gövde katmanında (y < 2) boş kalır → dört kenar geçidi ve "Parselime git" karosu açık;
 * gövde katmanında dolu karo ≤ 48 (parselin ≥ %50'si yürünebilir); kenar halkası (geçitler hariç) ve dolu karolar dışındaki her
 * karo omurgaya 4-komşu bağlı (cep yok, dünyaya bağlı).
 * - BUILD-BUDGET-001: ≤ 600 blok, ≤ 40 prefab, dünya ≤ 6000 blok, gövde ≤ 64 KB; blok kimliği katalogda; hücre tekil.
 * - Prefab sütunu özeldir: prefab karosunda hiçbir katta blok yok, prefab'lar çakışmaz.
 * Yalnız yerleştirmede (geçmişe bağlı olduğu için sunucu tam gövdede denetlemez): destek kuralı (y = 0 ya da bir bloğun yüzüne
 * bitişik) ve kilitli dekor (sunucu önceki gövdeyle karşılaştırarak denetler).
*/
import { footprint } from "../prefabs";
import {
  BLOCK_BY_ID, BLOCK_ID_RE, cellKey, isBorder, isBuildPrefab, isGate, isSpine, MAX_BODY_BYTES, MAX_EDITS, MAX_EDITS_TOTAL, MAX_GROUND,
  MAX_PREFABS, PLOT_D, PLOT_H, PLOT_N, PLOT_W, SPINE_CLEAR, tileKey, bodyBytes, type BuildItem, type Edit, type PlotBody, type PlotPrefab,
} from "./catalog";

/** Gövde katmanı: bu katlardaki blok karoyu engeller (gövde bandı 0,3–1,0 + baş; kapı 2 blok yüksek). */
export const BODY_LAYERS = SPINE_CLEAR;
/** Omurga merkezi (bağlantı denetiminin kökü). */
export const SPINE_ROOT = tileKey(5, 7);

export type BuildCode =
  | "bounds" | "height" | "border" | "spine" | "taken" | "prefab_column" | "prefab_overlap" | "block_id" | "prefab_type" | "rot"
  | "too_many_edits" | "too_many_prefabs" | "world_budget" | "ground_budget" | "walk_split" | "too_large"
  // yalnız istemci (arazi ve geçmiş bilgisi)
  | "support" | "terrain" | "walk_min" | "locked" | "empty" | "no_target" | "self";

export interface BuildProblem { code: BuildCode; cell?: [number, number, number] }

export interface Occupancy {
  /** hücre → edits dizini */
  cells: Map<number, number>;
  /** karo → prefab dizini (−1 boş) */
  prefab: Int16Array;
  /** karo gövde katmanında engelli mi (y < 2 blok ya da prefab) */
  ground: Uint8Array;
  groundCount: number;
}

/** Prefab'ın parsel yerel ayak izi (boşsa çapa karosu). */
export function prefabTiles(p: PlotPrefab): [number, number][] {
  const f = footprint(p);
  return (f.length ? f : [[p.i, p.j]]) as [number, number][];
}

export function occupancy(body: PlotBody): Occupancy {
  const cells = new Map<number, number>();
  const prefab = new Int16Array(PLOT_N).fill(-1), ground = new Uint8Array(PLOT_N);
  body.edits.forEach((e, k) => {
    cells.set(cellKey(e[0], e[1], e[2]), k);
    if (e[1] < BODY_LAYERS && inPlot(e[0], e[2])) ground[tileKey(e[0], e[2])] = 1;
  });
  body.prefabs.forEach((p, k) => {
    for (const [li, lj] of prefabTiles(p)) if (inPlot(li, lj)) { prefab[tileKey(li, lj)] = k; ground[tileKey(li, lj)] = 1; }
  });
  let groundCount = 0;
  for (let t = 0; t < PLOT_N; t++) groundCount += ground[t];
  return { cells, prefab, ground, groundCount };
}

const inPlot = (li: number, lj: number) => Number.isInteger(li) && Number.isInteger(lj) && li >= 0 && lj >= 0 && li < PLOT_W && lj < PLOT_D;

/** Mantıksal yürünebilirlik (araziden bağımsız): kenar halkası (geçitler hariç) ve gövde katmanında dolu karolar engelli. */
export function logicalWalk(ground: Uint8Array): Uint8Array {
  const w = new Uint8Array(PLOT_N);
  for (let lj = 0; lj < PLOT_D; lj++) for (let li = 0; li < PLOT_W; li++) {
    const t = tileKey(li, lj);
    w[t] = (isBorder(li, lj) && !isGate(li, lj)) || ground[t] ? 0 : 1;
  }
  return w;
}

/** Yürünebilir karoların hepsi `root`'tan 4-komşu ulaşılabilir mi? (root yürünemezse false) */
export function connected(walk: Uint8Array, root: number): boolean {
  if (!walk[root]) return false;
  const seen = new Uint8Array(PLOT_N);
  const stack = [root];
  seen[root] = 1;
  let n = 1;
  while (stack.length) {
    const u = stack.pop()!, li = u % PLOT_W, lj = (u / PLOT_W) | 0;
    const nb = [li > 0 ? u - 1 : -1, li < PLOT_W - 1 ? u + 1 : -1, lj > 0 ? u - PLOT_W : -1, lj < PLOT_D - 1 ? u + PLOT_W : -1];
    for (const v of nb) if (v >= 0 && walk[v] && !seen[v]) { seen[v] = 1; n++; stack.push(v); }
  }
  let total = 0;
  for (let t = 0; t < PLOT_N; t++) total += walk[t];
  return n === total;
}

/** Tam gövde denetimi (sunucuyla aynı kurallar; `others` = dünyadaki öteki parsellerin blok toplamı). İlk sorunlar döner. */
export function validateBody(body: PlotBody, others = 0): BuildProblem[] {
  const out: BuildProblem[] = [];
  if (body.edits.length > MAX_EDITS) out.push({ code: "too_many_edits" });
  if (body.prefabs.length > MAX_PREFABS) out.push({ code: "too_many_prefabs" });
  if (others + body.edits.length > MAX_EDITS_TOTAL) out.push({ code: "world_budget" });
  const seen = new Set<number>();
  const prefabTile = new Int16Array(PLOT_N).fill(-1);
  body.prefabs.forEach((p, k) => {
    if (!isBuildPrefab(p.t)) { out.push({ code: "prefab_type" }); return; }
    for (const [li, lj] of prefabTiles(p)) {
      if (!inPlot(li, lj)) { out.push({ code: "bounds", cell: [li, 0, lj] }); continue; }
      if (isBorder(li, lj)) out.push({ code: "border", cell: [li, 0, lj] });
      else if (isSpine(li, lj)) out.push({ code: "spine", cell: [li, 0, lj] });
      if (prefabTile[tileKey(li, lj)] >= 0) out.push({ code: "prefab_overlap", cell: [li, 0, lj] });
      prefabTile[tileKey(li, lj)] = k;
    }
  });
  for (const e of body.edits) {
    const [li, y, lj, id, rot] = e;
    const cell: [number, number, number] = [li, y, lj];
    if (!inPlot(li, lj) || !Number.isInteger(y) || y < 0) { out.push({ code: "bounds", cell }); continue; }
    if (y >= PLOT_H) { out.push({ code: "height", cell }); continue; }
    if (typeof id !== "string" || !BLOCK_ID_RE.test(id) || !BLOCK_BY_ID.has(id)) out.push({ code: "block_id", cell });
    if (!Number.isInteger(rot) || rot < 0 || rot > 3) out.push({ code: "rot", cell });
    if (isBorder(li, lj)) out.push({ code: "border", cell });
    else if (isSpine(li, lj) && y < BODY_LAYERS) out.push({ code: "spine", cell });
    const k = cellKey(li, y, lj);
    if (seen.has(k)) out.push({ code: "taken", cell });
    seen.add(k);
    if (prefabTile[tileKey(li, lj)] >= 0) out.push({ code: "prefab_column", cell });
  }
  if (out.length) return out;
  const occ = occupancy(body);
  if (occ.groundCount > MAX_GROUND) out.push({ code: "ground_budget" });
  if (!connected(logicalWalk(occ.ground), SPINE_ROOT)) out.push({ code: "walk_split" });
  if (bodyBytes(body) > MAX_BODY_BYTES) out.push({ code: "too_large" });
  return out;
}

export interface PlaceContext {
  occ: Occupancy;
  body: PlotBody;
  /** dünyadaki öteki parsellerin blok toplamı */
  others: number;
  /** gerçek arazi yürünebilirliği (yerel, `generateParcel(…).near.walk`; inşasız sahiplenilmiş parsel) — yoksa yalnız mantıksal kural */
  terrain?: Uint8Array | null;
  /** "Parselime git" karosu (yerel dizin) — boş kalmalı */
  entry?: number | null;
  /** kilitli palet kimlikleri (S35) */
  locked?: ReadonlySet<string>;
}

/** Gövde katmanı değişikliğinden sonra yürünebilirlik (mantıksal + varsa gerçek arazi) korunuyor mu? */
function walkOk(ctx: PlaceContext, ground: Uint8Array, groundCount: number): BuildCode | null {
  if (groundCount > MAX_GROUND) return "ground_budget";
  if (!connected(logicalWalk(ground), SPINE_ROOT)) return "walk_split";
  if (ctx.terrain) {
    const w = new Uint8Array(PLOT_N);
    let n = 0;
    for (let t = 0; t < PLOT_N; t++) { w[t] = ctx.terrain[t] && !ground[t] ? 1 : 0; n += w[t]; }
    if (n < PLOT_N / 2) return "walk_min";
    const root = ctx.entry != null && w[ctx.entry] ? ctx.entry : SPINE_ROOT;
    if (!connected(w, root)) return "walk_split";
  }
  return null;
}

/** `at` hücresine `item` konabilir mi? (prefab yalnız y = 0) */
export function checkPlace(ctx: PlaceContext, item: BuildItem, at: [number, number, number], rot = 0, prefab?: PlotPrefab): BuildCode | null {
  const [li, y, lj] = at;
  const { occ, body } = ctx;
  if (ctx.locked?.has(item.id)) return "locked";
  if (!inPlot(li, lj) || y < 0) return "bounds";
  if (y >= PLOT_H) return "height";
  if (item.kind === "block") {
    if (isBorder(li, lj)) return "border";
    if (isSpine(li, lj) && y < BODY_LAYERS) return "spine";
    if (occ.cells.has(cellKey(li, y, lj))) return "taken";
    if (occ.prefab[tileKey(li, lj)] >= 0) return "prefab_column";
    if (ctx.terrain && y < BODY_LAYERS && !ctx.terrain[tileKey(li, lj)]) return "terrain";
    if (body.edits.length >= MAX_EDITS) return "too_many_edits";
    if (ctx.others + body.edits.length + 1 > MAX_EDITS_TOTAL) return "world_budget";
    if (y > 0 && !supported(occ, li, y, lj)) return "support";
    if (!Number.isInteger(rot) || rot < 0 || rot > 3) return "rot";
    if (y < BODY_LAYERS && !occ.ground[tileKey(li, lj)]) {
      const g = occ.ground.slice();
      g[tileKey(li, lj)] = 1;
      if (ctx.entry != null && tileKey(li, lj) === ctx.entry) return "spine";
      return walkOk(ctx, g, occ.groundCount + 1);
    }
    return null;
  }
  if (y !== 0) return "support";
  if (body.prefabs.length >= MAX_PREFABS) return "too_many_prefabs";
  const p = prefab ?? null;
  if (!p) return "no_target";
  const tiles = prefabTiles(p);
  const g = occ.ground.slice();
  let add = 0;
  for (const [ti, tj] of tiles) {
    if (!inPlot(ti, tj)) return "bounds";
    if (isBorder(ti, tj)) return "border";
    if (isSpine(ti, tj)) return "spine";
    const t = tileKey(ti, tj);
    if (occ.prefab[t] >= 0) return "prefab_overlap";
    for (let yy = 0; yy < PLOT_H; yy++) if (occ.cells.has(cellKey(ti, yy, tj))) return "prefab_column";
    if (ctx.terrain && !ctx.terrain[t]) return "terrain";
    if (!g[t]) { g[t] = 1; add++; }
  }
  return walkOk(ctx, g, occ.groundCount + add);
}

/** Destek kuralı (plan §8): y = 0 ya da altı/yanları/üstünde blok var. */
export function supported(occ: Occupancy, li: number, y: number, lj: number): boolean {
  if (y === 0) return true;
  const n: [number, number, number][] = [[li, y - 1, lj], [li, y + 1, lj], [li - 1, y, lj], [li + 1, y, lj], [li, y, lj - 1], [li, y, lj + 1]];
  return n.some(([a, b, c]) => b >= 0 && b < PLOT_H && inPlot(a, c) && occ.cells.has(cellKey(a, b, c)));
}

// ------------------------------------------------------------------------------------------ saf düzenleme işlemleri
/** Blok ekle (yeni gövde). */
export function addBlock(body: PlotBody, at: [number, number, number], id: string, rot = 0): PlotBody {
  const e: Edit = [at[0], at[1], at[2], id, rot & 3];
  return { edits: [...body.edits, e], prefabs: body.prefabs };
}

/** Hücredeki bloğu kaldır; yoksa aynı gövde. */
export function removeBlock(body: PlotBody, at: [number, number, number]): PlotBody {
  const k = body.edits.findIndex((e) => e[0] === at[0] && e[1] === at[1] && e[2] === at[2]);
  if (k < 0) return body;
  return { edits: body.edits.filter((_, n) => n !== k), prefabs: body.prefabs };
}

export function addPrefab(body: PlotBody, p: PlotPrefab): PlotBody {
  return { edits: body.edits, prefabs: [...body.prefabs, p] };
}

export function removePrefab(body: PlotBody, index: number): PlotBody {
  if (index < 0 || index >= body.prefabs.length) return body;
  return { edits: body.edits, prefabs: body.prefabs.filter((_, n) => n !== index) };
}

/** Kilitli dekor yeni yerleştirildi mi (önceki gövdeyle; sunucu kuralının eşi).*/
export function addedLocked(prev: PlotBody, next: PlotBody, locked: ReadonlySet<string>): string | null {
  const count = (b: PlotBody) => {
    const m = new Map<string, number>();
    for (const e of b.edits) m.set(e[3], (m.get(e[3]) ?? 0) + 1);
    for (const p of b.prefabs) m.set(p.t, (m.get(p.t) ?? 0) + 1);
    return m;
  };
  const a = count(prev), b = count(next);
  for (const id of locked) if ((b.get(id) ?? 0) > (a.get(id) ?? 0)) return id;
  return null;
}
