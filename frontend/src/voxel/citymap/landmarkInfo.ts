/**
 * simge ve semt **bilgi kartı** verisi (arayüzü kurar).
 *
 * Saf veri modülü: React/three yok, yan etki yok. Kart başına yalnız tür, esin düzeyi, ölçek notu, metin kaynağı ve seyir
 * noktası tutulur. Şunlar **kopyalanmaz**, var olan tek kaynaktan türetilir:
 * - ad: `locales/city.ts` (`lm_<şehir>_<simge>`, `d_<şehir>_<semt>`);
 * - pasaport damgası: `catalog.ts` kimlikleri (`landmarkId`, `districtId`);
 * - kutsal alan: tasarım katmanındaki `LandmarkModel.sacred`;
 * - yakındaki ritüeller: `fun/rituals` harita bağlantıları (`at.map`, semt ve simge eşleşmesi) + kartın isteğe bağlı listesi;
 * - kısa metin: kartın `poi` alanı varsa var olan sahne bilgi notu (`locales/explore.ts` `poi_<sahne>_<n>`), yoksa
 * `locales/landmarkInfo.ts` `lmi_*_text`.
 *
 * Esin düzeyi (lider kararı K5): `public` ip_risk 0 ve gerçek ad kullanılabilir; `generic` ip_risk 1, yalnız genel ad ve
 * tipoloji (gerçek ad hiçbir dilde ve alanda yok); `original` bu harita için tasarlanmış özgün yapı (gerçek olgu yazılmaz).
 * Olguların kaynakları içindedir; arayüzde kaynak gösterilmez.
 * Denetim: `frontend/scripts/landmark_info.test.mjs`.
*/
import { CITY_MAPS, districtId, landmarkId, viewpointId } from "./catalog";
import { landmarkModel } from "./designs";
import type { CityTile } from "./format";
import { RITUALS_BY_CITY, type RitualCity, type RitualId } from "../fun/rituals";
import { NEW_CITIES } from "../cities/index";
import { cityRecord } from "../cities/hooks";
import { withFullFirstWave, fullLandmarkInfo } from "../../full/landmarkInfo";

export type InfoCity = RitualCity;
export type InfoKind =
  | "tower" | "sacred" | "bridge" | "palace" | "market" | "monument" | "natural" | "castle" | "building" | "wheel"
  | "venue" | "street" | "district" | "original";
export const INFO_KINDS: readonly InfoKind[] = [
  "tower", "sacred", "bridge", "palace", "market", "monument", "natural", "castle", "building", "wheel", "venue", "street",
  "district", "original",
];
/** public: ip_risk 0 (gerçek yapı/yer) · generic: ip_risk 1 (genel ad) · original: bu harita için özgün tasarım */
export type InfoInspired = "public" | "generic" | "original";

/** Kısa metin ve küçük bilgi üst sınırları (karakter; §4.3). */
export const INFO_TEXT_MAX = 220;
export const INFO_FACT_MAX = 140;
/** Kartta en çok gösterilecek ritüel sayısı (§4.3 "≤ 3"). */
export const INFO_RITUALS_MAX = 3;

/** Var olan sahne bilgi notu (`explore.ts` `poi_<scene>_<n>`): kartın kısa metni olarak yeniden kullanılır. */
export interface PoiRef { scene: string; n: number }

export interface LandmarkInfo {
  /** "istanbul/galata_kulesi" (simge) · "istanbul/@beyoglu" (semt) */
  key: string;
  city: InfoCity;
  district: string;
  /** harita simge kimliği; yoksa semt kartı */
  landmark?: string;
  /** sahnedeki karşılık: "<sahne>:<etiket>" (sahne `landmark` bölgesi) */
  sceneTags?: string[];
  kind: InfoKind;
  inspired: InfoInspired;
  /** yalnız `public` simge: gerçek yükseklik (m, yaklaşık); ölçek notu */
  realHeightM?: number;
  /** kısa metin bu sahne notundan gelir (ayrı `_text` anahtarı yok) */
  poi?: PoiRef;
  /** `lmi_…_fact` anahtarı var mı (doğrulanmamış bilgi yazılmaz) */
  hasFact: boolean;
  /** en iyi görünüm: kartın semtindeki seyir noktası sırası (1'den; `vp:<n>`). Görünüm kipi.*/
  viewpoint?: number;
  /** harita bağlantısı olmayan ama bu kartta önerilecek ritüeller (aynı şehir) */
  rituals?: RitualId[];
}

const lm = (city: InfoCity, district: string, landmark: string, rest: Omit<LandmarkInfo, "key" | "city" | "district" | "landmark">): LandmarkInfo =>
  ({ key: `${city}/${landmark}`, city, district, landmark, ...rest });
const dist = (city: InfoCity, district: string, rest: Omit<LandmarkInfo, "key" | "city" | "district" | "landmark" | "kind" | "inspired">): LandmarkInfo =>
  ({ key: `${city}/@${district}`, city, district, kind: "district", inspired: "public", ...rest });

/** İlk dalga: şehir başına 5 baş simge (harita kimliği). */
export const FIRST_WAVE: Readonly<Record<InfoCity, readonly string[]>> = withFullFirstWave({
  istanbul: ["ayasofya", "sultanahmet", "galata_kulesi", "kiz_kulesi", "bogaz_koprusu"],
  londra: ["saat_kulesi", "parlamento", "cark", "kule_koprusu", "kale"],
  kapadokya: ["peri_bacalari", "uchisar_kalesi", "kaya_kiliseleri", "kalkis_alani", "yeralti_sehri"],
  ...cityRecord((m): readonly string[] => m.info?.firstWave ?? []),
}) as Record<InfoCity, readonly string[]>;

/* LANDMARK-INFO-BEGIN */
const FULL_INFO = fullLandmarkInfo(lm, dist);
export const LANDMARK_INFO: readonly LandmarkInfo[] = [
  // ---- İstanbul
  lm("istanbul", "tarihi_yarimada", "ayasofya", { sceneTags: ["istanbul:ayasofya"], kind: "sacred", inspired: "public", realHeightM: 55, hasFact: true, viewpoint: 1 }),
  lm("istanbul", "tarihi_yarimada", "sultanahmet", { sceneTags: ["istanbul:sultanahmet"], kind: "sacred", inspired: "public", realHeightM: 64, hasFact: true, viewpoint: 1 }),
  lm("istanbul", "tarihi_yarimada", "suleymaniye", { kind: "sacred", inspired: "public", realHeightM: 76, hasFact: true, viewpoint: 1 }), // LANDMARK-HIRES
  lm("istanbul", "beyoglu", "galata_kulesi", { sceneTags: ["istanbul:galata"], kind: "tower", inspired: "public", realHeightM: 67, poi: { scene: "istanbul", n: 2 }, hasFact: true, viewpoint: 1 }),
  lm("istanbul", "tarihi_yarimada", "yerebatan", { kind: "building", inspired: "public", hasFact: true }), // sarnıçtaki sergi karosunun kartı
  lm("istanbul", "uskudar", "kiz_kulesi", { sceneTags: ["istanbul:maiden_tower"], kind: "tower", inspired: "public", hasFact: true, viewpoint: 1 }),
  lm("istanbul", "bogaz", "bogaz_koprusu", { sceneTags: ["istanbul:bosphorus_bridge"], kind: "bridge", inspired: "public", realHeightM: 165, hasFact: true, viewpoint: 1 }),
  dist("istanbul", "tarihi_yarimada", { poi: { scene: "istanbul", n: 3 }, hasFact: false, viewpoint: 1 }),
  dist("istanbul", "halic", { hasFact: false, viewpoint: 1 }),
  dist("istanbul", "beyoglu", { hasFact: false, viewpoint: 1, rituals: ["kedi_mama"] }),
  dist("istanbul", "bogaz", { poi: { scene: "istanbul", n: 1 }, hasFact: false, viewpoint: 1 }),
  dist("istanbul", "uskudar", { hasFact: false, viewpoint: 1, rituals: ["kedi_mama"] }),
  ...FULL_INFO[0],
  // ---- Londra
  lm("londra", "westminster", "saat_kulesi", { sceneTags: ["londra:clocktower"], kind: "tower", inspired: "public", realHeightM: 96, poi: { scene: "londra", n: 1 }, hasFact: true, viewpoint: 1 }),
  lm("londra", "westminster", "parlamento", { sceneTags: ["londra:parliament"], kind: "palace", inspired: "public", hasFact: true, viewpoint: 1 }),
  lm("londra", "westminster", "cark", { sceneTags: ["londra:wheel"], kind: "wheel", inspired: "generic", hasFact: false, viewpoint: 1 }),
  lm("londra", "kale", "kule_koprusu", { sceneTags: ["londra:bascule"], kind: "bridge", inspired: "public", realHeightM: 65, poi: { scene: "londra", n: 2 }, hasFact: true, viewpoint: 1 }),
  lm("londra", "kale", "kale", { sceneTags: ["londra:keep"], kind: "castle", inspired: "public", realHeightM: 27, poi: { scene: "londra", n: 3 }, hasFact: true, viewpoint: 1 }),
  dist("londra", "westminster", { hasFact: false, viewpoint: 1 }),
  dist("londra", "kale", { hasFact: false, viewpoint: 1 }),
  dist("londra", "carsi", { hasFact: false, viewpoint: 1 }),
  dist("londra", "park", { hasFact: false, viewpoint: 1 }),
  dist("londra", "sehir", { hasFact: false, viewpoint: 1 }),
  ...FULL_INFO[1],
  // ---- Kapadokya
  lm("kapadokya", "goreme", "peri_bacalari", { sceneTags: ["kapadokya:fairy_chimneys"], kind: "natural", inspired: "public", poi: { scene: "kapadokya", n: 1 }, hasFact: true, viewpoint: 1 }),
  lm("kapadokya", "uchisar", "uchisar_kalesi", { sceneTags: ["kapadokya:castle"], kind: "castle", inspired: "public", poi: { scene: "kapadokya", n: 2 }, hasFact: true, viewpoint: 1 }),
  lm("kapadokya", "goreme", "kaya_kiliseleri", { sceneTags: ["kapadokya:open_air_museum"], kind: "sacred", inspired: "public", hasFact: false, viewpoint: 1 }),
  lm("kapadokya", "balon", "kalkis_alani", { sceneTags: ["kapadokya:balloon_field"], kind: "venue", inspired: "public", poi: { scene: "kapadokya", n: 3 }, hasFact: false, viewpoint: 1 }),
  lm("kapadokya", "yeralti", "yeralti_sehri", { kind: "monument", inspired: "public", hasFact: true, viewpoint: 1 }),
  dist("kapadokya", "goreme", { hasFact: false, viewpoint: 1 }),
  dist("kapadokya", "vadiler", { hasFact: false, viewpoint: 1 }),
  dist("kapadokya", "uchisar", { hasFact: false, viewpoint: 1 }),
  dist("kapadokya", "balon", { hasFact: false, viewpoint: 1 }),
  dist("kapadokya", "avanos", { hasFact: false, viewpoint: 1 }),
  dist("kapadokya", "yeralti", { hasFact: false, viewpoint: 1 }),
  ...FULL_INFO[2],
  // yeni şehirlerin kartları (manifest `info.entries`)
  ...NEW_CITIES.flatMap((m) => (m.info?.entries ?? []).map((e): LandmarkInfo => ({ ...e, key: e.landmark ? `${m.catalog.id}/${e.landmark}` : `${m.catalog.id}/@${e.district}`,
    city: m.catalog.id as InfoCity, rituals: e.rituals as RitualId[] | undefined }))),
];
/* LANDMARK-INFO-END */

// ------------------------------------------------------------------------------------------ arama
const BY_KEY = new Map<string, LandmarkInfo>(LANDMARK_INFO.map((c) => [c.key, c]));
const BY_SCENE_TAG = new Map<string, LandmarkInfo>();
for (const c of LANDMARK_INFO) for (const t of c.sceneTags ?? []) BY_SCENE_TAG.set(t, c);

export const infoByKey = (key: string): LandmarkInfo | null => BY_KEY.get(key) ?? null;
/** Harita simgesinin kartı (yoksa null: "ad + esin + ritüeller + damga" ile otomatik kart çizer).*/
export const infoForLandmark = (city: string, landmark: string): LandmarkInfo | null => BY_KEY.get(`${city}/${landmark}`) ?? null;
/** Semt kartı. */
export const infoForDistrict = (city: string, district: string): LandmarkInfo | null => BY_KEY.get(`${city}/@${district}`) ?? null;
/** Semtteki simge kartları (tablo sırası). */
export const infoInDistrict = (city: string, district: string): LandmarkInfo[] =>
  LANDMARK_INFO.filter((c) => c.city === city && c.district === district && c.landmark);
/** Sahne `landmark` bölgesinin kartı (`zone.tag`). */
export const infoForSceneZone = (scene: string, tag: string): LandmarkInfo | null => BY_SCENE_TAG.get(`${scene}:${tag}`) ?? null;

// ------------------------------------------------------------------------------------------ türetilenler (kopya yok)
const base = (c: LandmarkInfo) => (c.landmark ? `lmi_${c.city}_${c.landmark}` : `lmi_${c.city}_d_${c.district}`);

/** Ad anahtarı (`locales/city.ts`). */
export const infoNameKey = (c: LandmarkInfo) => (c.landmark ? `lm_${c.city}_${c.landmark}` : `d_${c.city}_${c.district}`);
/** Kısa metin: hangi yerel dosyada, hangi anahtar. */
export const infoTextRef = (c: LandmarkInfo): { ns: "explore" | "landmarkInfo"; key: string } =>
  c.poi ? { ns: "explore", key: `poi_${c.poi.scene}_${c.poi.n}` } : { ns: "landmarkInfo", key: `${base(c)}_text` };
/** Küçük bilgi anahtarı (`locales/landmarkInfo.ts`; yoksa null). */
export const infoFactKey = (c: LandmarkInfo) => (c.hasFact ? `${base(c)}_fact` : null);
/** Kendi metin anahtarları (yalnız `locales/landmarkInfo.ts`). */
export const infoOwnKeys = (c: LandmarkInfo): string[] => [...(c.poi ? [] : [`${base(c)}_text`]), ...(c.hasFact ? [`${base(c)}_fact`] : [])];
export const infoKindKey = (c: LandmarkInfo) => `lmi_kind_${c.kind}`;
/** Esin satırı anahtarı (semt kartı ayrı satır). */
export const infoInspiredKey = (c: LandmarkInfo) => (c.landmark ? `lmi_inspired_${c.inspired}` : "lmi_inspired_district");
/** Ölçek notu yalnız gerçek yapıda. */
export const infoScaleM = (c: LandmarkInfo): number | null => (c.inspired === "public" && c.realHeightM ? c.realHeightM : null);

/** Pasaport damgası kimliği (sayı yok; durum `store.found`'dan okunur). */
export const infoStampId = (c: LandmarkInfo) => (c.landmark ? landmarkId(c.city, c.district, c.landmark) : districtId(c.city, c.district));
/** İbadet yeri: tasarım katmanından (kart "Sessiz alan" notu gösterir, ritüel önermez). */
export const infoSacred = (c: LandmarkInfo) => !!(c.landmark && landmarkModel(c.city, c.landmark)?.sacred);

/** En iyi görünüm: seyir noktası damga kimliği ve şehir karosu (veri; görünüm kipi).*/
export function infoViewpoint(c: LandmarkInfo): { id: string; tile: CityTile } | null {
  const d = CITY_MAPS[c.city]?.districts.find((x) => x.id === c.district);
  const n = c.viewpoint ?? 1;
  const vp = d?.viewpoints?.[n - 1];
  return d && vp ? { id: viewpointId(c.city, c.district, n), tile: [d.bounds[0] + vp[0], d.bounds[1] + vp[1]] } : null;
}

/**
 * Burada yapılacaklar: önce simgenin kendi bağlantısı, sonra aynı semtin harita bağlantıları, sonra kartın listesi
 * (en çok 3, tekrar yok). Kutsal alan kartı ritüel önermez.
 */
export function infoRituals(c: LandmarkInfo): RitualId[] {
  if (infoSacred(c)) return [];
  const defs = RITUALS_BY_CITY[c.city] ?? [];
  const own = defs.filter((r) => c.landmark && r.at.map?.some((a) => a.district === c.district && a.landmark === c.landmark));
  const near = defs.filter((r) => r.at.map?.some((a) => a.district === c.district));
  const out: RitualId[] = [];
  for (const id of [...own.map((r) => r.id), ...near.map((r) => r.id), ...(c.rituals ?? [])] as RitualId[]) {
    if (!out.includes(id)) out.push(id);
  }
  return out.slice(0, INFO_RITUALS_MAX);
}
