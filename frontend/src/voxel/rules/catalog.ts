/**
 * S45 — sahne kataloğu (rehber §4, §7.3): 13 yerleşik sahnenin arketip profili ve sahneler arası komşuluk politikası.
 * Kurallar (rules/registry.ts) bu profillere göre kapsamlanır; yeni sahne eklemek = buraya profil + registry'ye kurallar
 * ( "Yeni sahne ekleme"). Görüntü adları locales/world.ts'tedir; iş mantığı yalnız kimliklere bağlıdır.
*/
import type { BedKind, Pose, WorldSceneId } from "../scenes";
import { NEW_CITIES } from "../cities/index";
import { cityRecord } from "../cities/hooks";
import { FULL_ADJ, FULL_SCENE_PROFILES } from "../../full/rulesCatalog";

export type SceneClass = "built" | "urban" | "natural" | "vehicle" | "habitat" | "mixed";
export type WaterTopology = "none" | "pond" | "shore" | "open_sea";

export interface SceneProfile {
  id: WorldSceneId;
  /** rehber kimliği (scene.<ad>) */
  archetype: string;
  parents: SceneClass[];
  /** kapalı mekân (açık ateş vb. kurallar) */
  indoor: boolean;
  water: WaterTopology;
  /** asgari işlevsel zonlar (belgesel; denetim: istasyon/uyku/araç noktaları ve bölge türleri) */
  zones: string[];
  /** bu sahnede dizüstü işine tercih edilen duruşlar (rehber §6.4 scene_preferences) */
  laptopPoses: Pose[];
  /** uygun uyku yüzeyleri */
  beds: BedKind[];
  /** büyüme kademelerinin bu sahnedeki anlamı (rehber §5.4) */
  growth: { L2: string; L3: string; L4: string };
  /** görsel kat sayısı üst sınırı (karar a: üst katlar görsel; ajanlar zemin katta) */
  maxLevels: number;
}

const ALL_BEDS: BedKind[] = ["bed", "bunk", "hammock", "lounger", "cot", "tent", "mat", "sofa"];

export const SCENE_PROFILES: Record<WorldSceneId, SceneProfile> = {
  office: { id: "office", archetype: "scene.office", parents: ["built", "urban"], indoor: true, water: "none",
    zones: ["entry", "circulation", "workstations", "meeting", "rest"], laptopPoses: ["sit_chair"], beds: ["bunk", "bed", "cot", "sofa", "mat"],
    growth: { L2: "ekip katı", L3: "ofis katları + mutfak/toplantı", L4: "ofis kampüsü" }, maxLevels: 1 },
  park: { id: "park", archetype: "scene.park", parents: ["natural", "urban"], indoor: false, water: "pond",
    zones: ["grass", "path", "shade", "seating"], laptopPoses: ["sit_bench", "sit_ground", "lounge"], beds: ["hammock", "mat"],
    growth: { L2: "semt parkı", L3: "gölet + oyun alanı + bahçe", L4: "park ağı" }, maxLevels: 1 },
  home: { id: "home", archetype: "scene.home", parents: ["built"], indoor: true, water: "none",
    zones: ["entry", "living", "sleeping", "circulation"], laptopPoses: ["sit_chair", "lounge"], beds: ["bed", "mat", "sofa"],
    growth: { L2: "ev + oda kanadı", L3: "sokak (ev + bahçe + atölye)", L4: "mahalle" }, maxLevels: 1 },
  beach: { id: "beach", archetype: "scene.beach", parents: ["natural"], indoor: false, water: "shore",
    zones: ["dry_sand", "shoreline", "water", "seating"], laptopPoses: ["lounge", "stand"], beds: ["lounger", "mat", "bed", "sofa"],
    growth: { L2: "plaj + şezlong sıraları", L3: "plaj kulübü + iskele", L4: "kıyı bandı" }, maxLevels: 1 },
  cafe: { id: "cafe", archetype: "scene.cafe", parents: ["built", "urban"], indoor: true, water: "none",
    zones: ["entry", "ordering", "seating", "circulation"], laptopPoses: ["sit_chair", "stand"], beds: ["sofa", "mat"],
    growth: { L2: "kafe salonu", L3: "teras + kavurma atölyesi", L4: "sosyal merkez" }, maxLevels: 1 },
  camp: { id: "camp", archetype: "scene.camp", parents: ["natural"], indoor: false, water: "pond",
    zones: ["tent_area", "path", "fire_ring", "nature_buffer"], laptopPoses: ["sit_bench", "sit_chair", "sit_ground"], beds: ["tent", "mat", "hammock", "cot"],
    growth: { L2: "kamp noktası", L3: "çadır köyü + göl", L4: "tesisli kamp" }, maxLevels: 1 },
  mall: { id: "mall", archetype: "scene.mall", parents: ["built", "urban"], indoor: true, water: "none",
    zones: ["entry", "concourse", "shop_units", "food_court", "exit"], laptopPoses: ["sit_chair", "stand"], beds: ["cot", "lounger", "bed", "mat", "sofa"],
    growth: { L2: "mağaza kanadı", L3: "galeri katı + yemek katı", L4: "ticaret kompleksi + otopark" }, maxLevels: 3 },
  school: { id: "school", archetype: "scene.school", parents: ["built"], indoor: true, water: "none",
    zones: ["entry", "classroom", "circulation", "staff"], laptopPoses: ["sit_chair"], beds: ["cot", "sofa", "mat", "bunk"],
    growth: { L2: "derslik kanadı", L3: "okul + spor/konferans", L4: "yerleşke" }, maxLevels: 2 },
  battlefield: { id: "battlefield", archetype: "scene.battlefield", parents: ["natural"], indoor: false, water: "none",
    zones: ["mission_area", "cover", "safe_spawn", "route"], laptopPoses: ["sit_chair"], beds: ["cot", "tent", "mat"],
    growth: { L2: "ekip karargâhı", L3: "ikmal + yemekhane", L4: "görev haritası" }, maxLevels: 1 },
  sea: { id: "sea", archetype: "scene.open_sea", parents: ["natural"], indoor: false, water: "open_sea",
    zones: ["surface", "islands", "piers", "nav_corridor"], laptopPoses: ["sit_ground", "sit_bench", "lounge", "sit_chair"], beds: ALL_BEDS,
    growth: { L2: "iskele + tekneler", L3: "balıkçı limanı", L4: "takımada / deniz rotası" }, maxLevels: 1 },
  yacht: { id: "yacht", archetype: "scene.yacht", parents: ["vehicle"], indoor: false, water: "open_sea",
    zones: ["deck", "cockpit", "cabin", "access"], laptopPoses: ["sit_chair", "lounge", "stand"], beds: ["bed", "lounger", "mat", "sofa"],
    growth: { L2: "marina iskelesi", L3: "marina (bağlı yatlar)", L4: "marina + kıyı bağlantısı" }, maxLevels: 2 },
  space: { id: "space", archetype: "scene.space_base", parents: ["habitat"], indoor: true, water: "none",
    zones: ["habitat", "energy", "airlock", "lab"], laptopPoses: ["sit_chair"], beds: ["bunk", "bed", "cot"],
    growth: { L2: "modül", L3: "habitat ağı + sera", L4: "üs kompleksi" }, maxLevels: 1 },
  snow: { id: "snow", archetype: "scene.snow_village", parents: ["built", "natural"], indoor: false, water: "pond",
    zones: ["houses", "cleared_path", "square", "heat_supply"], laptopPoses: ["sit_bench", "stand", "sit_chair"], beds: ["cot", "bunk", "bed", "sofa", "mat"],
    growth: { L2: "kulübe kümesi", L3: "köy yolu + meydan", L4: "servisli köy" }, maxLevels: 1 },
  // SP-W1 pilot şehirler: dizüstü işi şehre özgü yerlerde (kafe/çay bahçesi
  // sit_chair, bank sit_bench, rıhtım sit_ground, tezgâh stand) — CITY-WORK-001; üst katlar görsel (ajanlar zemin katta)
  istanbul: { id: "istanbul", archetype: "scene.istanbul", parents: ["built", "urban"], indoor: false, water: "shore",
    zones: ["quay", "street", "tea_garden", "market", "water"], laptopPoses: ["sit_chair", "sit_bench", "sit_ground", "stand"], beds: ["bunk", "sofa", "mat", "bed"],
    growth: { L2: "rıhtımda kafe terası pod'u", L3: "kemerli çarşı + çay bahçesi + çınar parkı + rıhtım", L4: "iskele çevresinde mahalle blokları" }, maxLevels: 3 },
  // SP-W2a: Londra — pub terası (sit_chair), park bankı (sit_bench), rıhtım (sit_ground), pazar tezgâhı (stand)
  londra: { id: "londra", archetype: "scene.londra", parents: ["built", "urban"], indoor: false, water: "pond",
    zones: ["street", "pub_terrace", "park", "market", "embankment", "river"], laptopPoses: ["sit_chair", "sit_bench", "sit_ground", "stand"], beds: ["bed", "mat"],
    growth: { L2: "kafe terası adası + B&B sırası", L3: "kapalı pazar + nehir rıhtımı + park", L4: "Londra semtleri: kitapçı sokağı, meydan" }, maxLevels: 1 },
  // SP-W2a: Kapadokya — mağara kafesi terası (sit_chair), vadi bankı (sit_bench), çömlek/halı tezgâhı (stand); su yok
  kapadokya: { id: "kapadokya", archetype: "scene.kapadokya", parents: ["natural", "built"], indoor: false, water: "none",
    zones: ["valley_path", "cave_hotel", "pottery", "vineyard", "cafe_terrace", "launch_field"], laptopPoses: ["sit_chair", "sit_bench", "stand"], beds: ["bed", "sofa", "mat"],
    growth: { L2: "mağara kafesi terası pod'u", L3: "bağ yolu + çömlek atölyesi + mağara otel kanadı + balon kalkış alanı", L4: "köy meydanları ve vadi patikaları" }, maxLevels: 1 },
  ...FULL_SCENE_PROFILES,
  // yeni dünya şehirleri (V/cities/<id>/manifest.ts `profile`)
  ...cityRecord((m): SceneProfile => ({ id: m.catalog.id as WorldSceneId, ...m.profile })),
};

/** Donmuş su yüzeyi (karlı köy göleti, buz pateni): zemin küpü renkleri. Habitat denetiminde su gövdesi sayılır. */
export const ICE_COLORS: readonly string[] = ["#BFE6F5", "#B3DDF0"];

// ------------------------------------------------------------------ komşuluk politikası (rehber §7.3)
export type Adjacency = "strong" | "conditional" | "weak" | "incompatible";

/** Simetrik tablo; yazılmayan çiftler "conditional" (geçiş bölgesi / açık politika ile). */
const ADJ: [WorldSceneId, WorldSceneId, Adjacency][] = [
  ["home", "park", "strong"], ["home", "school", "strong"], ["home", "cafe", "strong"], ["home", "snow", "strong"],
  ["park", "cafe", "strong"], ["beach", "cafe", "strong"], ["beach", "sea", "strong"], ["beach", "park", "strong"],
  ["beach", "yacht", "conditional"], ["sea", "yacht", "strong"], ["mall", "cafe", "strong"], ["mall", "office", "strong"],
  ["school", "park", "strong"], ["office", "cafe", "strong"], ["camp", "park", "strong"], ["camp", "snow", "conditional"],
  ["space", "park", "weak"], ["space", "beach", "weak"], ["space", "snow", "weak"], ["space", "camp", "weak"],
  ["battlefield", "school", "incompatible"], ["battlefield", "home", "incompatible"], ["battlefield", "mall", "incompatible"],
  ["battlefield", "cafe", "incompatible"], ["snow", "beach", "incompatible"], ["snow", "sea", "weak"],
  ["sea", "mall", "weak"], ["sea", "office", "weak"], ["yacht", "snow", "incompatible"], ["space", "sea", "incompatible"],
  ["space", "yacht", "incompatible"],
  // SP-W1
  ["istanbul", "cafe", "strong"], ["istanbul", "park", "strong"], ["istanbul", "sea", "strong"], ["istanbul", "beach", "conditional"],
  ["istanbul", "battlefield", "incompatible"], ["istanbul", "space", "weak"],
  // SP-W2a
  ["londra", "cafe", "strong"], ["londra", "park", "strong"], ["londra", "battlefield", "incompatible"], ["londra", "space", "weak"],
  ["kapadokya", "park", "strong"], ["kapadokya", "camp", "strong"], ["kapadokya", "istanbul", "conditional"], ["kapadokya", "battlefield", "incompatible"],
  ["kapadokya", "space", "weak"], ["kapadokya", "sea", "weak"],
  // SP-W2b
  // SP-W3a
  ...NEW_CITIES.flatMap((m) => (m.adjacency ?? []).map(([b, a]) => [m.catalog.id as WorldSceneId, b, a] as [WorldSceneId, WorldSceneId, Adjacency])),
  ...FULL_ADJ,
];

export function adjacency(a: WorldSceneId, b: WorldSceneId): Adjacency {
  if (a === b) return "strong";
  for (const [x, y, v] of ADJ) if ((x === a && y === b) || (x === b && y === a)) return v;
  return "conditional";
}
