/**
 * şehir haritası kataloğu: hangi sahnenin hangi şehir haritası var ve şehir pasaportu kimlikleri.
 *
 * Tek kaynak: aşağıdaki `CITY_CATALOG` bloğu katı JSON'dur ve `backend/studio/walk/explore.py CITY_CATALOG` ile birebir aynı
 * olmalıdır (`backend/tests/test_city_map.py` bloğu işaretler arasından okuyup karşılaştırır; `scripts/expanse_check.mjs`
 * CITY-MAP-CAT-001 bloğun haritalardan türeyen özetle aynı olduğunu denetler). Kimlik biçimi:
 * `city:<şehir>:<semt>` semte ilk giriş (pasaport damgası)
 * `city:<şehir>:<semt>:lm:<landmark>` landmark ziyareti (yanına gelince; damga)
 * `city:<şehir>:<semt>:in:<landmark>` girilebilir landmarkın iç mekânı (damga)
 * `city:<şehir>:<semt>:vp:<n>` seyir noktası (damga)
 * `city:<şehir>:<semt>:gz:<n>` gizli köşe (damga; tasarım katmanı `hidden`)
 * `city:<şehir>:<semt>:an:<an>` zamanlı an (örn. Kız Kulesi'nden gün batımı; damga)
 * `city:<şehir>:stop:<durak>` ziyaret edilmiş durak (hızlı seyahat hedefi; damga değil)
 * ekleri (tasarım katmanından; isteğe bağlı): semt `gz` / `an`, şehir `unlock` (semt → önceki semt ya da ofis seviyesi) ve
 * `quests` (süresiz; `need` kimliklerinin tümü). Arka uç kilidi ve görev ilerlemesini aynı bloktan hesaplar.
 * `test: 1` olan şehir yalnız geliştirme derlemesinde kapısını gösterir; haritası üretim paketine girmez (
 * `import.meta.env.DEV` dalı derlemede sabitlenir, `testMap` ağaçtan atılır).
 *
 * Saf modül: React/three yok.
*/
import type { CityMapFile } from "./format";
import { SK0_TEST_MAP } from "./testMap";
import { ISTANBUL_MAP } from "./cities/istanbul";
import { LONDRA_MAP } from "./cities/londra";
import { KAPADOKYA_MAP } from "./cities/kapadokya";
import { designOf } from "./designs";
import type { CityQuest, DistrictUnlock } from "./design";
import { NEW_CITIES, NEW_CITY_IDS } from "../cities/index";
import { NEW_CITY_PARTS } from "../cities/parts";
import { orderCityCatalog, orderCityMaps } from "../../full/cityCatalog";

export interface CityCatalogDistrict {
  /** landmark → girilebilir (1) / değil (0) */
  landmarks: Record<string, number>;
  /** seyir noktası sayısı */
  vp: number;
  /** gizli köşe sayısı*/
  gz?: number;
  /** zamanlı anlar*/
  an?: string[];
}
export interface CityCatalogEntry {
  scene: string; test?: number; districts: Record<string, CityCatalogDistrict>; stops: string[];
  /** semt kilitleri (yoksa hepsi açık)*/
  unlock?: Record<string, DistrictUnlock>;
  /** süresiz semt görevleri*/
  quests?: CityQuest[];
}
export interface CityCatalog { version: number; cities: Record<string, CityCatalogEntry> }

/* CITY-CATALOG-BEGIN */
export const CITY_CATALOG: CityCatalog = {
  "version": 2,
  "cities": {
    "sk0_test": {"scene": "office", "test": 1,
      "districts": {
        "deneme": {"landmarks": {"kule": 1, "anit": 0}, "vp": 1},
        "ek": {"landmarks": {}, "vp": 0}},
      "stops": ["durak_a", "durak_b"]},
    "istanbul": {"scene": "istanbul",
      "districts": {
        "tarihi_yarimada": {"landmarks": {"ayasofya": 1, "sultanahmet": 1, "topkapi": 1, "yerebatan": 1, "hipodrom": 0, "kapalicarsi": 1, "misir_carsisi": 0, "suleymaniye": 1}, "vp": 1, "gz": 2},
        "halic": {"landmarks": {"galata_koprusu": 1, "balat": 0}, "vp": 1, "gz": 2},
        "beyoglu": {"landmarks": {"galata_kulesi": 1, "karakoy_rihtim": 0, "tunel": 0, "istiklal": 0, "taksim": 0}, "vp": 1, "gz": 2},
        "bogaz": {"landmarks": {"dolmabahce_saat": 0, "dolmabahce": 0, "ortakoy": 0, "bogaz_koprusu": 0, "rumeli_hisari": 1}, "vp": 2, "gz": 2},
        "uskudar": {"landmarks": {"kiz_kulesi": 1, "uskudar_iskele": 0, "haydarpasa": 0, "kadikoy_carsi": 0}, "vp": 2, "gz": 2, "an": ["gun_batimi"]}},
      "stops": ["beyazit", "sultanahmet", "eminonu", "eminonu_iskele", "karakoy", "karakoy_tunel", "tunel", "taksim", "karakoy_iskele",
        "kasimpasa_iskele", "balat_iskele", "kabatas", "besiktas_iskele", "ortakoy_iskele", "rumeli_iskele", "uskudar_iskele",
        "kadikoy_iskele", "salacak", "kiz_kulesi_iskele"],
      "unlock": {
        "halic": {"after": "tarihi_yarimada", "level": 3},
        "beyoglu": {"after": "tarihi_yarimada", "level": 3},
        "bogaz": {"after": "beyoglu", "level": 5},
        "uskudar": {"after": "tarihi_yarimada", "level": 3}},
      "quests": [
        {"id": "gizli_cesmeler", "district": "tarihi_yarimada", "need": ["city:istanbul:tarihi_yarimada:gz:1", "city:istanbul:tarihi_yarimada:gz:2"]},
        {"id": "yer_alti_saray", "district": "tarihi_yarimada", "need": ["city:istanbul:tarihi_yarimada:in:yerebatan", "city:istanbul:tarihi_yarimada:in:topkapi"]},
        {"id": "kopru_alti", "district": "halic", "need": ["city:istanbul:halic:in:galata_koprusu", "city:istanbul:halic:lm:balat"]},
        {"id": "istiklal_turu", "district": "beyoglu", "need": ["city:istanbul:stop:tunel", "city:istanbul:stop:taksim"]},
        {"id": "hisar_surlari", "district": "bogaz", "need": ["city:istanbul:bogaz:in:rumeli_hisari", "city:istanbul:bogaz:lm:bogaz_koprusu"]},
        {"id": "iki_kita", "district": "uskudar", "need": ["city:istanbul:tarihi_yarimada", "city:istanbul:uskudar"]},
        {"id": "gun_batimi", "district": "uskudar", "need": ["city:istanbul:uskudar:an:gun_batimi"]}]},
    "londra": {"scene": "londra",
      "districts": {
        "westminster": {"landmarks": {"saat_kulesi": 1, "parlamento": 0, "cark": 0}, "vp": 1, "gz": 2, "an": ["gun_batimi"]},
        "kale": {"landmarks": {"kule_koprusu": 0, "kale": 1}, "vp": 1, "gz": 2},
        "carsi": {"landmarks": {"kapali_carsi": 1, "galeri": 0, "meydan_cesmesi": 0}, "vp": 1, "gz": 2},
        "park": {"landmarks": {"saray": 0, "muzik_kosku": 0, "kayikhane": 0}, "vp": 1, "gz": 2},
        "sehir": {"landmarks": {"kubbeli_katedral": 0, "anit_sutun": 0, "borsa": 0}, "vp": 1, "gz": 2}},
      "stops": ["westminster_ist", "westminster_otobus", "westminster_iskele", "kale_iskele", "tower_hill", "covent", "trafalgar", "bank", "sehir_otobus", "park_kosesi"],
      "unlock": {
        "kale": {"after": "westminster", "level": 3},
        "carsi": {"after": "westminster", "level": 3},
        "park": {"after": "carsi", "level": 4},
        "sehir": {"after": "kale", "level": 5}},
      "quests": [
        {"id": "saat_mekanizmasi", "district": "westminster", "need": ["city:londra:westminster:in:saat_kulesi", "city:londra:westminster:lm:parlamento"]},
        {"id": "gun_batimi", "district": "westminster", "need": ["city:londra:westminster:an:gun_batimi"]},
        {"id": "nehir_turu", "district": "kale", "need": ["city:londra:stop:westminster_iskele", "city:londra:stop:kale_iskele"]},
        {"id": "kale_ve_kopru", "district": "kale", "need": ["city:londra:kale:in:kale", "city:londra:kale:lm:kule_koprusu", "city:londra:kale:vp:1"]},
        {"id": "carsi_turu", "district": "carsi", "need": ["city:londra:carsi:in:kapali_carsi", "city:londra:carsi:lm:galeri"]},
        {"id": "park_gizli", "district": "park", "need": ["city:londra:park:gz:1", "city:londra:park:gz:2"]},
        {"id": "iki_katli", "district": "park", "need": ["city:londra:stop:park_kosesi", "city:londra:stop:sehir_otobus"]}]},
    "kapadokya": {"scene": "kapadokya",
      "districts": {
        "goreme": {"landmarks": {"peri_bacalari": 0, "magara_otel": 0, "kaya_kiliseleri": 0, "hali_atolyesi": 0}, "vp": 1, "gz": 2},
        "vadiler": {"landmarks": {"pasabag": 0, "ask_vadisi": 0, "guvercinlik": 0}, "vp": 1, "gz": 2, "an": ["gun_batimi"]},
        "uchisar": {"landmarks": {"uchisar_kalesi": 1, "magara_evleri": 0}, "vp": 1, "gz": 2},
        "balon": {"landmarks": {"kalkis_alani": 0, "sabah_kahvesi": 0}, "vp": 1, "gz": 2},
        "avanos": {"landmarks": {"comlek_atolyesi": 1, "comlekci_sokagi": 0, "asma_kopru": 0}, "vp": 1, "gz": 2},
        "yeralti": {"landmarks": {"yeralti_sehri": 1, "havalandirma": 0, "koy_cesmesi": 0}, "vp": 1, "gz": 2}},
      "stops": ["goreme_otogar", "goreme_kasaba", "balon_alani", "vadi_inis", "uchisar", "avanos", "derinkuyu"],
      "unlock": {
        "vadiler": {"after": "goreme", "level": 3},
        "balon": {"after": "goreme", "level": 3},
        "avanos": {"after": "goreme", "level": 4},
        "uchisar": {"after": "vadiler", "level": 4},
        "yeralti": {"after": "uchisar", "level": 5}},
      "quests": [
        {"id": "kaya_kiliseleri", "district": "goreme", "need": ["city:kapadokya:goreme:lm:kaya_kiliseleri", "city:kapadokya:goreme:lm:peri_bacalari"]},
        {"id": "vadi_patikasi", "district": "vadiler", "need": ["city:kapadokya:vadiler:gz:1", "city:kapadokya:vadiler:gz:2"]},
        {"id": "balon_turu", "district": "balon", "need": ["city:kapadokya:stop:balon_alani", "city:kapadokya:stop:vadi_inis"]},
        {"id": "kale_zirvesi", "district": "uchisar", "need": ["city:kapadokya:uchisar:in:uchisar_kalesi", "city:kapadokya:uchisar:vp:1"]},
        {"id": "comlek_atolyesi", "district": "avanos", "need": ["city:kapadokya:avanos:in:comlek_atolyesi", "city:kapadokya:avanos:lm:asma_kopru"]},
        {"id": "yeralti_kesfi", "district": "yeralti", "need": ["city:kapadokya:yeralti:in:yeralti_sehri", "city:kapadokya:yeralti:lm:havalandirma"]},
        {"id": "gun_batimi", "district": "vadiler", "need": ["city:kapadokya:vadiler:an:gun_batimi"]}]}
  }
};
/* CITY-CATALOG-END */
/** yeni şehirlerin pasaport girdileri kendi `catalog.json`'larından (blok yalnız korunan şehirleri tutar; kaldırılanlar tam sürümde src/full/cityCatalog.ts FULL-CITY-CATALOG bloğunda; arka uç aynı dosyaları okur:
 * `backend/studio/cities`). Eşlik: blok ∪ (varsa full bloğu) ∪ catalog.json'lar == arka uç `CITY_CATALOG` (test_city_map.py).*/
CITY_CATALOG.cities = orderCityCatalog(CITY_CATALOG.cities); // full: removed cities in their original order (src/full)
for (const m of NEW_CITIES) CITY_CATALOG.cities[m.catalog.id] = m.catalog.city;

/** Şehir haritaları (kimlik → biçim v1.3 `city_map`).+ şehirler kendi dosyalarından buraya eklenir.*/
export const CITY_MAPS: Readonly<Record<string, CityMapFile>> = orderCityMaps({ ...(import.meta.env?.DEV ? { [SK0_TEST_MAP.id]: SK0_TEST_MAP } : {}), [ISTANBUL_MAP.id]: ISTANBUL_MAP, [LONDRA_MAP.id]: LONDRA_MAP, [KAPADOKYA_MAP.id]: KAPADOKYA_MAP,
  ...Object.fromEntries(NEW_CITY_IDS.map((id) => [id, NEW_CITY_PARTS[id].map])) });

/** Haritadan katalog özeti (CITY-MAP-CAT-001: blokla aynı olmalı). */
export function catalogOf(map: CityMapFile, scene: string, test: boolean): CityCatalogEntry {
  const design = designOf(map.id);
  const districts: Record<string, CityCatalogDistrict> = {};
  for (const d of map.districts) {
    const gz = design?.districts[d.id]?.hidden?.length ?? 0, an = (design?.moments?.[d.id] ?? []).map((x) => x.id);
    districts[d.id] = { landmarks: Object.fromEntries(d.landmarks.map((l) => [l.id, l.interior ? 1 : 0])), vp: d.viewpoints?.length ?? 0,
      ...(gz ? { gz } : {}), ...(an.length ? { an: [...an] } : {}) };
  }
  return { scene, ...(test ? { test: 1 } : {}), districts, stops: map.stops.map((s) => s.id),
    ...(design?.unlock ? { unlock: design.unlock } : {}), ...(design?.quests ? { quests: design.quests } : {}) };
}

const dev = (): boolean => { try { return !!import.meta.env?.DEV; } catch { return false; } };

/** Sahnenin şehir haritası (yoksa null). Test şehri yalnız geliştirmede (üretimde bayrak yok, harita pakette yok).*/
export function cityForScene(scene: string | null | undefined): CityMapFile | null {
  if (!scene) return null;
  for (const [id, c] of Object.entries(CITY_CATALOG.cities)) {
    if (c.scene !== scene) continue;
    if (c.test && !dev()) continue;
    const map = CITY_MAPS[id];
    if (map) return map;
  }
  return null;
}

// ------------------------------------------------------------------------------------------ kimlikler
export const districtId = (city: string, d: string) => `city:${city}:${d}`;
export const landmarkId = (city: string, d: string, lm: string) => `city:${city}:${d}:lm:${lm}`;
export const interiorStampId = (city: string, d: string, lm: string) => `city:${city}:${d}:in:${lm}`;
// `vp:<n>` kimliği semtin `viewpoints` DİZİSİNİN sırasından gelir (n = indeks + 1). Dizi YALNIZ SONA EKLENİR: araya sokmak,
// silmek ya da sırayı değiştirmek oyuncunun kayıtlı damgasını başka bir seyir noktasına kaydırır. Kural
// `scripts/city_progress_ids.test.mjs` (fixtures/city-vp-snapshot.json) ile denetlenir; yeni nokta eklenince anlık görüntü yenilenir.
export const viewpointId = (city: string, d: string, n: number) => `city:${city}:${d}:vp:${n}`;
export const hiddenId = (city: string, d: string, n: number) => `city:${city}:${d}:gz:${n}`;
export const momentId = (city: string, d: string, an: string) => `city:${city}:${d}:an:${an}`;
export const stopId = (city: string, s: string) => `city:${city}:stop:${s}`;

export type CityKind = "district" | "lm" | "in" | "vp" | "gz" | "an" | "stop";
export interface ParsedCityId { city: string; kind: CityKind; district?: string; target?: string; n?: number }
const RE = /^city:([a-z][a-z0-9_]{0,23}):([a-z][a-z0-9_]{0,23})(?::(lm|in|vp|gz|an):([a-z0-9_]{1,24}))?$/;
const STOP_RE = /^city:([a-z][a-z0-9_]{0,23}):stop:([a-z][a-z0-9_]{0,23})$/;
export function parseCityId(id: string): ParsedCityId | null {
  const s = STOP_RE.exec(id);
  if (s) return { city: s[1], kind: "stop", target: s[2] };
  const m = RE.exec(id);
  if (!m || m[2] === "stop") return null;
  if (!m[3]) return { city: m[1], kind: "district", district: m[2] };
  if (m[3] === "vp" || m[3] === "gz") return /^[1-9][0-9]?$/.test(m[4]) ? { city: m[1], kind: m[3], district: m[2], n: Number(m[4]) } : null;
  return /^[a-z]/.test(m[4]) ? { city: m[1], kind: m[3] as "lm" | "in" | "an", district: m[2], target: m[4] } : null;
}

/** Şehrin bütün kimlikleri (damgalar + duraklar); sıra belirlenimci. */
export function cityIds(city: string): string[] {
  const c = CITY_CATALOG.cities[city];
  if (!c) return [];
  const out: string[] = [];
  for (const [d, spec] of Object.entries(c.districts)) {
    out.push(districtId(city, d));
    for (const [lm, inn] of Object.entries(spec.landmarks)) {
      out.push(landmarkId(city, d, lm));
      if (inn) out.push(interiorStampId(city, d, lm));
    }
    for (let n = 1; n <= spec.vp; n++) out.push(viewpointId(city, d, n));
    for (let n = 1; n <= (spec.gz ?? 0); n++) out.push(hiddenId(city, d, n));
    for (const an of spec.an ?? []) out.push(momentId(city, d, an));
  }
  for (const s of c.stops) out.push(stopId(city, s));
  return out;
}

// ------------------------------------------------------------------------------------------ kilit ve görevler (istemci görünümü)
/** Semt kilitli mi: kilit kuralı var, önceki semt damgası yok ve ofis seviyesi yetmiyor. Sunucu aynı kuralı uygular (423). */
export function districtLocked(city: string, d: string, found: ReadonlySet<string>, level: number): boolean {
  const u = CITY_CATALOG.cities[city]?.unlock?.[d];
  if (!u) return false;
  return !found.has(districtId(city, u.after)) && level < u.level;
}
/**
 * Şehrin görevleri ve ilerlemesi (pasaporttaki kimliklerden). Sunucu `city_quests` ile aynı kural:
 * - kilitli semtin görevi, `need` kimlikleri dolu olsa bile semt açılana kadar tamamlanmış sayılmaz,
 * - görev semti kilitliyken kaydedilen durak (`stale`: durak → o anda kilitli görev semtleri) görevi kilit açılınca
 * kendiliğinden tamamlamaz; kullanıcı o semte girince (semt damgası) tamamlanır.
 * `locked`: kilitli semt adları (bu şehrin; sunucunun son bildirdiği).
*/
export function questProgress(city: string, found: ReadonlySet<string>, locked: ReadonlySet<string> = new Set(),
  stale: Readonly<Record<string, readonly string[]>> = {}): { quest: CityQuest; got: number; done: boolean; locked: boolean }[] {
  return (CITY_CATALOG.cities[city]?.quests ?? []).map((q) => {
    const got = q.need.filter((id) => found.has(id)).length;
    const isLocked = locked.has(q.district);
    const early = q.need.some((id) => stale[id]?.includes(q.district));
    const entered = found.has(districtId(city, q.district));
    return { quest: q, got, done: got === q.need.length && !isLocked && (entered || !early), locked: isLocked };
  });
}
