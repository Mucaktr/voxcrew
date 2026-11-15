/**
 * LANDMARK-HIRES — kayıt: hangi simgenin yüksek çözünürlük kurucusu var, ve "çizimi bu katmana geçen" orta model blokları.
 * Saf modül (React/three yok); `citymap/district.ts` (işaretleme) ve `citymap/source.ts` (akış yazımında süzme) okur.
 *
 * Akış: `district.ts extrasOf` kayıtlı simgenin bugünkü yakın modelini (`mid`) parsellere her zamanki gibi dağıtır (bütçe,
 * çarpışma, kamera, ölçek ve gerçekçilik denetimleri aynen görür) ama blokları `markHiResManaged` ile işaretler; `source.ts`
 * akış yazımında işaretli blokları kuyruğa yazmaz. Simgeyi `HiResLayer` çizer: ev parseli yakın halkadayken uzakta `mid`,
 * yakında `hi`. Uzak LOD ve TOUR-VIEW silüeti değişmez.
 */
import type { Block } from "../scenes";
import { HIRES_MAP, HIRES_SCENE } from "./catalog";
import { HIRES_ENABLED, type HiResMapEntry, type HiResSceneEntry } from "./types";
import { carveGates, GATE_TOP_CITY, GATE_TOP_SCENE, mapGates, sceneGates } from "../walk/landmarkGates"; // LANDMARK-WALK

const mapIndex = new Map<string, HiResMapEntry>();
// LANDMARK-WALK: avlu/bahçe girişi tanımlı simgenin hi modeli de aynı kapı karolarında oyulur (walk/landmarkGates.ts)
for (const e of HIRES_MAP) {
  const g = mapGates(e.map, e.landmark);
  mapIndex.set(`${e.map}/${e.landmark}`, g ? { ...e, hi: (c, mid) => carveGates(e.hi(c, mid), c.x0, c.z0, g, GATE_TOP_CITY) } : e);
}
const sceneIndex = new Map<string, HiResSceneEntry>();
for (const e of HIRES_SCENE) {
  const g = sceneGates(e.scene, e.tag);
  sceneIndex.set(`${e.scene}/${e.tag}`, g ? { ...e, hi: (c, mid) => carveGates(e.hi(c, mid), c.x0, c.z0, g, GATE_TOP_SCENE) } : e);
}

/** Şehir haritası simgesinin yüksek çözünürlük kaydı (yoksa null). */
export function hiresMapEntry(map: string, landmark: string): HiResMapEntry | null {
  return mapIndex.get(`${map}/${landmark}`) ?? null;
}
/** Taban sahne simge bölgesinin kaydı (yoksa null). */
export function hiresSceneEntry(scene: string, tag: string): HiResSceneEntry | null {
  return sceneIndex.get(`${scene}/${tag}`) ?? null;
}
/** Kayıtlı bütün girdiler (denetim ve rehber). */
export const hiresEntries = (): { map: readonly HiResMapEntry[]; scene: readonly HiResSceneEntry[] } => ({ map: HIRES_MAP, scene: HIRES_SCENE });
export const hiresSceneIds = (): Set<string> => new Set(HIRES_SCENE.map((e) => e.scene));

// ------------------------------------------------------------------------------------------ çizimi katmana geçen bloklar
const managed = new WeakSet<Block>();
/** Bu bloklar veri katmanında kalır ama akış kuyruğuna yazılmaz (HiResLayer çizer). */
export function markHiResManaged(blocks: readonly Block[]): void {
  for (const b of blocks) managed.add(b);
}
export const isHiResManaged = (b: Block): boolean => managed.has(b);
/** Akış yazımı: yönetilen blokları çıkarır (yoksa kopya). `?hires=0` iken süzmez (bugünkü davranış). */
export function withoutManaged(blocks: readonly Block[]): Block[] {
  if (!HIRES_ENABLED) return blocks.slice();
  const out: Block[] = [];
  for (const b of blocks) if (!managed.has(b)) out.push(b);
  return out;
}
