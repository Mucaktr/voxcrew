/**
 * S45 — dünya olguları: kural motorunun okuduğu, kurulmuş dünyadan türetilmiş TİPLİ görünüm (rehber §1.2 "beş grafik"):
 *  - semantik: izlenen nesneler (tür, karo, bölge, kat) + bölge türü/etiketi,
 *  - uzamsal: engel ızgarası, su ve güverte/zemin desteği (karo merkezi), kat döşemeleri,
 *  - ulaşım: MERKEZ'den yürünebilir erişim (4-komşu BFS — `findPath` ile aynı model),
 *  - eylem: istasyonlar / araç noktaları / uyku noktaları → affordance (rules/affordances.ts),
 *  - sosyal: talep (ekip + misafir), koltuk ataması (`seats`).
 * Köken (provenance, rehber §8.5): her bölge ve nesne hangi kural/şablonla üretildi — yalnızca hata ayıklama verisi,
 * dünya JSON'una yazılmaz.
 */
import { BAY, buildDistricts, planDistricts, type Demand, type DistrictPlan } from "../districts/core";
import { hasTheme, theme as districtTheme } from "../districts/themes";
import { hotelPlanKit } from "../districts/hotel"; // HOTEL-SYS
import { D, SCENES, baseBays, key, tx, tz, type Built, type ModuleCell, type Station, type Tile, type WorldSceneId } from "../scenes";
import { STOREY } from "../buildings";
import { ICE_COLORS } from "./catalog";
import { traceBuild, type TracedObject } from "./trace";

export type ScaleTier = "L1" | "L2" | "L3" | "L4";

export interface Provenance {
  /** bu bölgeyi ya da nesneyi gerektiren kural (rules/registry.ts) */
  rule: string;
  /** şablon: `scene:<id>` ya da `theme:<id>/<tür>[/<etiket>]` */
  template: string;
}

export interface ModuleFacts extends ModuleCell { index: number; provenance: Provenance }

export interface ObjectFacts extends TracedObject {
  /** içinde bulunduğu bölge dizini (-1: dünya dışı) */
  module: number;
  /** kat dizini: 0 zemin; döşeme/asansör gibi yapılarda üst yüzün katı */
  level: number;
  provenance: Provenance;
}

export interface Anchor { kind: "station" | "sleep" | "rest" | `spot:${string}`; index: number; tile: Tile; station?: Station }

export interface WorldFacts {
  scene: WorldSceneId;
  theme: string | null;
  demand: Demand;
  agents: number;
  plan: DistrictPlan | null;
  tier: ScaleTier;
  base: Built;
  built: Built;
  objects: ObjectFacts[];
  modules: ModuleFacts[];
  anchors: Anchor[];
  /** engelli karolar (1) */
  blocked: Uint8Array;
  /** MERKEZ'den yürünerek erişilen karolar (1) */
  reach: Uint8Array;
  /** su yüzeyi olan karolar (1) */
  water: Uint8Array;
  /** karo merkezinin altında yürünebilir yüzey (zemin küpü, güverte, iskele tahtası) var (1) */
  deck: Uint8Array;
  /** donmuş su (buz) zemini (1) — habitat denetiminde su gövdesi */
  ice: Uint8Array;
  /** dünya ufku su (açık deniz sahneleri: `ocean`) */
  ocean: boolean;
  idx: (i: number, j: number) => number;
  inside: (i: number, j: number) => boolean;
}

/** Talep → ajan sayısı. */
export const demandSize = (d: Demand) => d.teams.reduce((s, t) => s + t.n, 0) + d.guests;

/** Ölçek kademesi (rehber §5.4) ↔ bölge planlayıcısı: L1 tek sahne (büyüme yok) · L2 küme (tek ek hücre: 2 bölge) ·
 *  L3 yerleşim (≤ 6 ek hücre: sokak ızgarası + olanaklar) · L4 bölge (daha büyük: çok sayıda olanak, mahalle ölçeği). */
export function scaleTier(plan: DistrictPlan | null): ScaleTier {
  if (!plan) return "L1";
  const cells = plan.cells.length + plan.holes.length;
  return cells <= 1 ? "L2" : cells <= 6 ? "L3" : "L4";
}

/** Bölge türünün köken kuralı (planlayıcı neden bu bölgeyi açtı?). */
export function moduleProvenance(m: ModuleCell, scene: string, theme: string | null): Provenance {
  if (m.base || m.kind === "hq") return { rule: "SCENE-BASE-001", template: `scene:${scene}` };
  const t = `theme:${theme ?? scene}/${m.kind ?? "?"}${m.label ? `/${m.label}` : ""}`;
  switch (m.kind) {
    case "team": return { rule: "GROW-DEMAND-001", template: t };
    case "guest": return { rule: "GROW-DEMAND-001", template: t };
    case "amenity": return { rule: "GROW-INFRA-001", template: t };
    default: return { rule: "GROW-TOPO-001", template: t };
  }
}

/** Yerleşik sahnenin büyüme teması (scenes.ts `kitFor` ile aynı). */
function themeOf(id: WorldSceneId): string | null {
  const def = SCENES[id];
  if (def.annex === null) return null;
  const t = def.annex ?? def.id;
  return hasTheme(t) ? t : null;
}

/** Sahne + talep → izlenmiş kurulum ve olgular. Önbelleği (scenes.ts baseScenes/worldCache) atlar: taban ve bölgeler her
 *  çağrıda yeniden kurulur (iz için gerekli; sonuç `buildWorld` ile aynıdır — worlds.mjs/rules testleri denetler). */
export function inspectWorld(scene: WorldSceneId, demand: Demand): WorldFacts {
  const def = SCENES[scene];
  const t0 = traceBuild(() => def.build());
  const base = t0.result;
  const bays = baseBays(def, base);
  const theme = bays ? themeOf(scene) : null;
  const plan = theme && bays ? planDistricts(base.stations.length, demand, hotelPlanKit(districtTheme(theme), base), !!def.core, bays) : null;
  const t1 = plan && theme ? traceBuild(() => buildDistricts(base, theme, plan)) : null;
  const built = t1?.result ?? base;
  // RING-INT: halka düzeninde taban nesneleri de tabanla birlikte ötelenir (buildDistricts → shiftBase)
  const [di, dj] = plan?.core ? [plan.core[0] * BAY, plan.core[1] * D] : [0, 0];
  const baseObjects = di || dj ? t0.objects.map((o) => ({ ...o, tile: [o.tile[0] + di, o.tile[1] + dj] as Tile })) : t0.objects;
  return deriveFacts(scene, theme, demand, plan, base, built, [...baseObjects, ...(t1?.objects ?? [])], !!def.ocean);
}

/** Olguları kurulmuş dünyadan türetir (kırmızı takım testleri de elle bozulmuş `built` ile bunu çağırır). */
export function deriveFacts(scene: WorldSceneId, theme: string | null, demand: Demand, plan: DistrictPlan | null, base: Built,
  built: Built, traced: TracedObject[], ocean: boolean): WorldFacts {
  const { width, depth } = built;
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < width && j < depth;
  const idx = (i: number, j: number) => j * width + i;
  const blocked = new Uint8Array(width * depth);
  for (const k of built.blocked) {
    const [i, j] = k.split(",").map(Number);
    if (inside(i, j)) blocked[idx(i, j)] = 1;
  }
  // su ve yürünebilir yüzey: karo merkezini örten bloklar (yüzey bandı: üst yüz −0,35…+0,75)
  const water = new Uint8Array(width * depth), deck = new Uint8Array(width * depth), ice = new Uint8Array(width * depth);
  const i0 = tx(0), j0 = tz(0);
  for (const b of built.blocks) {
    const top = b.p[1] + b.s[1] / 2;
    const isWater = b.g === "water";
    if (!isWater && (b.g !== "solid" || top < -0.35 || top > 0.75)) continue;
    if (isWater && top > 0.35) continue;
    const xa = b.p[0] - b.s[0] / 2 - 1e-6, xb = b.p[0] + b.s[0] / 2 + 1e-6, za = b.p[2] - b.s[2] / 2 - 1e-6, zb = b.p[2] + b.s[2] / 2 + 1e-6;
    for (let i = Math.max(0, Math.ceil(xa - i0)); i <= Math.min(width - 1, Math.floor(xb - i0)); i++) {
      for (let j = Math.max(0, Math.ceil(za - j0)); j <= Math.min(depth - 1, Math.floor(zb - j0)); j++) {
        // destek: tahta/zemin karo merkezini örtmeli ve karonun en az %25'i kadar geniş olmalı (ince süs çubukları değil)
        if (isWater) water[idx(i, j)] = 1;
        else if (b.s[0] * b.s[2] >= 0.25) { deck[idx(i, j)] = 1; if (Math.abs(top) < 0.05 && ICE_COLORS.includes(b.c)) ice[idx(i, j)] = 1; }
      }
    }
  }
  const modules: ModuleFacts[] = built.modules.map((m, index) => ({ ...m, index, provenance: moduleProvenance(m, scene, theme) }));
  const moduleOf = (t: Tile) => modules.findIndex((m) => t[0] >= m.i0 && t[0] < m.i0 + m.w && t[1] >= m.j0 && t[1] < m.j0 + m.d);
  const objects: ObjectFacts[] = traced.map((o) => {
    const module = moduleOf(o.tile);
    const y = o.info?.y ?? 0;
    const level = o.type === "car" || o.type === "floor_slab" ? Math.round(y / STOREY) : 0;
    const prov = module >= 0 ? modules[module].provenance : { rule: "?", template: "?" };
    return { ...o, module, level, provenance: { rule: prov.rule, template: `${prov.template}#${o.via}` } };
  });
  const anchors: Anchor[] = [];
  built.stations.forEach((s, k) => anchors.push({ kind: "station", index: k, tile: s.tile, station: s }));
  for (const [kind, list] of Object.entries(built.spots)) list?.forEach((s, k) => anchors.push({ kind: kind === "sleep" ? "sleep" : `spot:${kind}`, index: k, tile: s.tile, station: s }));
  built.rest.forEach((t, k) => anchors.push({ kind: "rest", index: k, tile: t }));
  // erişim: MERKEZ'in ilk istasyonundan (validateWorld ile aynı başlangıç)
  const reach = new Uint8Array(width * depth);
  const start = built.stations[0]?.tile;
  if (start && inside(start[0], start[1])) {
    const q = new Int32Array(width * depth);
    let h = 0, t = 0;
    q[t++] = idx(start[0], start[1]); reach[q[0]] = 1;
    while (h < t) {
      const c = q[h++], ci = c % width, cj = (c - ci) / width;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di, nj = cj + dj;
        if (!inside(ni, nj)) continue;
        const n = idx(ni, nj);
        if (reach[n] || blocked[n]) continue;
        reach[n] = 1; q[t++] = n;
      }
    }
  }
  return { scene, theme, demand, agents: demandSize(demand), plan, tier: scaleTier(plan), base, built, objects, modules, anchors,
    blocked, reach, water, deck, ice, ocean, idx, inside };
}

/** Karo anahtarı yardımcısı (raporlar için). */
export const tileKey = (t: Tile) => key(t[0], t[1]);
