/**
 * WALK-EXPLORE — keşif kataloğu (iç mekânlar, seyir noktaları, ilgi noktaları, gizli köşeler, keşif parçaları).
 *
 * Tek kaynak: aşağıdaki `EXPLORE_CATALOG` bloğu katı JSON'dur ve `backend/studio/walk/explore.py` `CATALOG` ile birebir aynı
 * olmalıdır (`backend/tests/test_walk_explore.py` bloğu işaretler arasından okuyup karşılaştırır). Kimlik biçimi:
 * `<sahne>:in:<yer>` iç mekâna giriş (kapıdan girince)
 * `<sahne>:vp:<yer>` seyir noktası (yerin seyir katında, dürbünün yanında)
 * `<sahne>:k:<yer>:<n>` keşif parçası (iç mekânda; hatıradan ayrı tür, 5'lik hatıra tavanına girmez)
 * `<sahne>:poi:<n>` ilgi noktası (dış dünyada; kısa, özgün, güvenli bilgi notu)
 * `<sahne>:gz:<n>` gizli köşe (dış dünyada işaretsiz; üstüne basınca)
 * `review: 1` olan yer (ibadet yeri iç mekânı) kültür incelemesi bitene dek girilemez;
 * kimliği katalogda durur ama sunucu 403 döner, istemci kapı çizmez.
 *
 * Saf modül: React/three yok.
*/

import { NEW_CITIES } from "../cities/index";
import { FULL_EXPLORE_ORDER, FULL_EXPLORE_SCENES } from "../../full/exploreCatalog";

export type SiteKind =
  | "tower" | "museum" | "skyscraper" | "lobby" | "castle" | "stadium" | "terrace" | "pier"
  | "office_upper" | "mall_upper" | "cafe_loft" | "sacred"
  /** COURTYARD-PORTAL: duvarlı simge avlusu (cami/saray/kale/tapınak; gerçek ölçekli açık hava sahnesi — interiors/courtyards.ts) */
  | "courtyard"
  /** HOTEL-SYS (E1): şehrin tek otelinin lobisi (ayrı iç sahne; keşif kimliği değil — placement.ts otomatik kapı) */
  | "hotel";

export interface SiteSpec {
  kind: SiteKind;
  /** seyir noktası var mı (1/0) */
  vp: number;
  /** keşif parçası sayısı */
  k: number;
  /** 1: kültür incelemesi bekliyor (girilemez) */
  review?: number;
}

export interface SceneExplore {
  sites: Record<string, SiteSpec>;
  /** ilgi noktası sayısı */
  poi: number;
  /** gizli köşe sayısı */
  gz: number;
}

export interface ExploreCatalog { version: number; scenes: Record<string, SceneExplore> }

/* EXPLORE-CATALOG-BEGIN */
export const EXPLORE_CATALOG: ExploreCatalog = {
  "version": 1,
  "scenes": {
    "office": {"sites": {"ust_kat": {"kind": "office_upper", "vp": 1, "k": 2}}, "poi": 0, "gz": 2},
    "park": {"sites": {}, "poi": 0, "gz": 2},
    "home": {"sites": {}, "poi": 0, "gz": 2},
    "beach": {"sites": {}, "poi": 0, "gz": 2},
    "cafe": {"sites": {"loft": {"kind": "cafe_loft", "vp": 1, "k": 1}}, "poi": 0, "gz": 2},
    "camp": {"sites": {}, "poi": 0, "gz": 2},
    "mall": {"sites": {"ust_kat": {"kind": "mall_upper", "vp": 1, "k": 2}}, "poi": 0, "gz": 2},
    "school": {"sites": {}, "poi": 0, "gz": 2},
    "battlefield": {"sites": {}, "poi": 0, "gz": 2},
    "sea": {"sites": {}, "poi": 0, "gz": 2},
    "yacht": {"sites": {}, "poi": 0, "gz": 2},
    "space": {"sites": {}, "poi": 0, "gz": 2},
    "snow": {"sites": {}, "poi": 0, "gz": 2},
    "istanbul": {"sites": {
      "galata": {"kind": "tower", "vp": 1, "k": 2},
      "teras": {"kind": "terrace", "vp": 1, "k": 1},
      "iskele": {"kind": "pier", "vp": 1, "k": 1},
      "ayasofya": {"kind": "sacred", "vp": 0, "k": 0, "review": 1},
      "sultanahmet": {"kind": "courtyard", "vp": 0, "k": 0}}, "poi": 3, "gz": 2},
    "kapadokya": {"sites": {
      "castle": {"kind": "castle", "vp": 1, "k": 2},
      "teras": {"kind": "terrace", "vp": 1, "k": 1}}, "poi": 3, "gz": 2},
    "londra": {"sites": {
      "clocktower": {"kind": "tower", "vp": 1, "k": 2},
      "keep": {"kind": "museum", "vp": 1, "k": 2},
      "teras": {"kind": "terrace", "vp": 1, "k": 1},
      "iskele": {"kind": "pier", "vp": 1, "k": 1}}, "poi": 3, "gz": 2}
  }
};
/* EXPLORE-CATALOG-END */
/** yeni şehirlerin sahne keşif girdileri kendi `catalog.json`'larından (arka uç `walk/explore.py CATALOG` aynı dosyaları
 * okur; eşlik: blok ∪ catalog.json'lar == arka uç, test_walk_explore.py).*/
for (const m of NEW_CITIES) EXPLORE_CATALOG.scenes[m.catalog.id] = m.catalog.explore;
/** Full edition: the removed-city/premium-scene entries (full/exploreCatalog.ts) are merged back in today's scene order. */
if (FULL_EXPLORE_ORDER.length) {
  const all = { ...EXPLORE_CATALOG.scenes, ...FULL_EXPLORE_SCENES };
  EXPLORE_CATALOG.scenes = Object.fromEntries([...FULL_EXPLORE_ORDER.filter((k) => k in all), ...Object.keys(all).filter((k) => !FULL_EXPLORE_ORDER.includes(k))].map((k) => [k, all[k]]));
}

/** HOTEL-SYS (E1): otel kapısının yer kimliği (districts/hotel.ts `HOTEL_SITE` ile aynı) ve tanımı — keşif kataloğunda değil,
 *  `exploreIds`'e girmez (ilerleme sayısı değişmez); placement.ts sahnenin `hotel` bölgesinden kapıyı kendisi koyar. */
export const HOTEL_SITE = "otel";
export const HOTEL_SITE_SPEC: SiteSpec = { kind: "hotel", vp: 0, k: 0 };

/** Yer tanımı: ibadet yeri iç mekânları (review) girilemez. */
export const isOpenSite = (s: SiteSpec | undefined) => !!s && !s.review;
export const sceneExplore = (scene: string | null | undefined): SceneExplore | null =>
  (scene ? EXPLORE_CATALOG.scenes[scene] : undefined) ?? null;

export const enterId = (scene: string, site: string) => `${scene}:in:${site}`;
export const vpId = (scene: string, site: string) => `${scene}:vp:${site}`;
export const kesifId = (scene: string, site: string, n: number) => `${scene}:k:${site}:${n}`;
export const poiId = (scene: string, n: number) => `${scene}:poi:${n}`;
export const hiddenId = (scene: string, n: number) => `${scene}:gz:${n}`;

export type ExploreKind = "in" | "vp" | "k" | "poi" | "gz";
export interface ParsedExplore { scene: string; kind: ExploreKind; site?: string; n?: number }
export function parseExploreId(id: string): ParsedExplore | null {
  const m = /^([a-z0-9_]+):(in|vp|k|poi|gz):([a-z0-9_]+)(?::([0-9]+))?$/.exec(id);
  if (!m) return null;
  const [, scene, kind, a, b] = m;
  if (kind === "k") return b ? { scene, kind, site: a, n: Number(b) } : null;
  if (kind === "in" || kind === "vp") return b ? null : { scene, kind, site: a };
  return b || !/^[0-9]+$/.test(a) ? null : { scene, kind: kind as ExploreKind, n: Number(a) };
}

/** Sahnenin bütün (girilebilir) keşif kimlikleri; sıra belirlenimci. */
export function exploreIds(scene: string): string[] {
  const s = sceneExplore(scene);
  if (!s) return [];
  const out: string[] = [];
  for (const [site, spec] of Object.entries(s.sites)) {
    if (!isOpenSite(spec)) continue;
    out.push(enterId(scene, site));
    if (spec.vp) out.push(vpId(scene, site));
    for (let n = 1; n <= spec.k; n++) out.push(kesifId(scene, site, n));
  }
  for (let n = 1; n <= s.poi; n++) out.push(poiId(scene, n));
  for (let n = 1; n <= s.gz; n++) out.push(hiddenId(scene, n));
  return out;
}

/** Yer → kimlik; açık (incelemede olmayan) yerler. */
export function openSites(scene: string): [string, SiteSpec][] {
  const s = sceneExplore(scene);
  return s ? Object.entries(s.sites).filter(([, v]) => isOpenSite(v)) : [];
}
