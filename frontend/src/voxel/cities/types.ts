/**
 * şehir dizini sözleşmesi. Yeni bir şehir YALNIZ kendi klasörüne yazar:
 *
 * V/cities/<id>/
 * catalog.json CityCatalogJson — arka uç (`backend/studio/cities`) ve ön yüz AYNI dosyayı okur
 * manifest.ts `export const MANIFEST: CityManifest` — SAF veri (yalnız `import type` +./catalog.json,./locale,./rituals,
 *./costumes); sahne/kit/three içe aktarmaz (scenes.ts bunu en üst düzeyde okur, döngü olmasın)
 * scene.ts `export function buildScene: Built` (scenes/*.ts biçimi; 36 × 32 kompakt taban, `core` bütün taban)
 * style.ts `export const STYLE: CityStyle` (city/styles/*.ts biçimi; bölge teması ve dış mahalle paleti buradan)
 * map.ts `export const MAP: CityMapFile` ve `export const DESIGN: CityDesign` (citymap/cities/*.ts biçimi)
 * landmarks/*.ts esinli yapılar (city/landmarks/<şehir>/* biçimi; yalnız map.ts ve scene.ts içe aktarır)
 * rituals.ts `export const RITUALS: RitualDef[]` (fun/rituals/*.ts biçimi; `city` = <id>)
 * costumes.ts `export const COSTUMES: CityCostumeDraft[]` (isteğe bağlı; çekirdeği okur)
 * theme.ts `export function THEME: Theme` (isteğe bağlı, CITY-REDO; şehre özgü büyüme teması — yoksa `cityTheme(style)`)
 * locale.ts `export const LOCALE: CityLocale` — TR + EN tek dosya, ad alanı başına (world, city, walk, explore,
 * landmarkInfo, ritualBook, ritual)
 *
 * Şehir ekleme adımları (şehir ekibi; paylaşılan dosyaya DOKUNULMAZ):
 * 1. Klasörü yukarıdaki dosyalarla yaz ( iskelesi `new_city.mjs` hazır olunca onu kullan).
 * 2. `node scripts/cities.mjs --write` → `V/cities/index.ts` ve `V/cities/parts.ts` yeniden üretilir (elle düzenlenmez;
 * birleştirme çakışmasında da yeniden üret). `node scripts/cities.mjs` kayma ve şema denetimidir.
 * 3. `node scripts/worlds.mjs --write --only=<id>` → `V/worlds/<id>.json` (yalnız kendi dünyanı yaz).
 * 4. Kanıt (§4.4): typecheck/build/contrast, `cities.mjs`, `worlds.mjs`, `city_check`, `free_map_ip`, `costume_policy`,
 * `test_walk.py`, `test_worlds.py`, kendi `test_city_<id>.py` ve `city_<id>.test.mjs`.
 *
 * Ölçek (WALK-UX denetimi): simge yükseklikleri yürüme ölçek eğrisine uyar — r = gerçek yükseklik / 1,75 m;
 * H = r (r ≤ 6), H = 6 + 4,2 · ln(r / 6) (r > 6); tavan 24; bant ±%25; sahne sürümü = eğri × 0,6; şehir içinde gerçekte
 * belirgin uzun olan modelde de uzun. Tek kaynak `V/walk/scaleStandard.ts` (`landmarkTarget`, `LANDMARK_REFS`; denetim
 * `scripts/scale_check.mjs`). O dosya commit edilene kadar dizin onu çalışma anında İÇE AKTARMAZ; şehir gerçek yüksekliklerini
 * `MANIFEST.scale.landmarks` alanına yazar ( commit edilince `scale_check` bu alanı okuyacak — bağımlılık notu).
 *
 * Saf modül (yalnız tipler).
*/
import type { Kind } from "../ambient/kinds";
import type { CityCatalogEntry } from "../citymap/catalog";
import type { CityDesign } from "../citymap/design";
import type { CityMapFile } from "../citymap/format";
import type { LandmarkInfo } from "../citymap/landmarkInfo";
import type { TaxiStyle } from "../citymap/taxi";
import type { CityStyle } from "../city/style";
import type { BiomeId, FeatureKind } from "../expanse/biomes";
import type { RitualDef } from "../fun/rituals";
import type { PanoRecipe, PanoPalette } from "../interiors/cityPano";
import type { SceneExplore } from "../interiors/catalog";
import type { Anchor } from "../interiors/placement";
import type { PlaceClimate } from "../props/weather";
import type { Adjacency, SceneProfile } from "../rules/catalog";
import type { Built, SceneDef, WorldSceneId } from "../scenes";
import type { Theme } from "../districts/themes";

/** Bölge (O5 paket gruplaması ve rapor). */
export type CityRegion = "europe" | "asia" | "middle_east" | "africa" | "americas" | "oceania";
/** Boy sınıfı (§2): S kompakt (3 semt), M (4–5 semt). */
export type CitySize = "S" | "M";

/** Mağaza öğesi (game/catalog.py `ShopItem("scene:<id>")`; kazanım pasaport damgası ya da jeton). Paket kimliği var olan
 *  `SCENE_PACKS` paketlerinden biri olmalı (yoksa yükleme reddedilir). */
export interface CityShopJson {
  pack: string;
  price: number;
  rarity: "common" | "rare" | "epic" | "legendary";
  earn: "stamp";
  label_tr: string; label_en: string;
  description_tr: string; description_en: string;
}

/** `catalog.json` — iki tarafın ortak kaydı. Alanlar arka uçta `backend/studio/cities/__init__.py` ile doğrulanır. */
export interface CityCatalogJson {
  /** klasör adıyla aynı; `^[a-z][a-z0-9_]{1,23}$` */
  id: string;
  /** sahne sırası (`SCENE_ORDER` sonuna bu sırayla eklenir; eşitlikte kimlik) */
  order: number;
  region: CityRegion;
  size: CitySize;
  /** sahne IP / kültür riski (≥ 2 yayınlanmaz) */
  ip: { ip_risk: 0 | 1; culture_risk: 0 | 1 };
  shop: CityShopJson;
  /** taban sahnenin `landmark` bölge etiketleri (walk/catalog.py LANDMARKS; simge vizesi) */
  scene_landmarks: string[];
  /** sahne keşif girdisi (walk/explore.py CATALOG.scenes; interiors/catalog.ts EXPLORE_CATALOG) */
  explore: SceneExplore;
  /** şehir haritası pasaport girdisi (walk/explore.py CITY_CATALOG.cities; harita ve tasarımdan türeyen özetle AYNI olmalı:
   *  CITY-MAP-CAT-001) */
  city: CityCatalogEntry;
  /** ritüel kimlikleri (walk/rituals.py CATALOG; rituals.ts tanımlarıyla aynı sıra) ve şehir unvanı (TITLES) */
  rituals: string[];
  ritual_title: string;
  /** olta açık su biyomu (fun/minigameLogic.ts SCENE_BIOME = walk/fishing.py SCENE_BIOME); yoksa "sea". Nehir/göl şehri
   * kendi biyomunu yazar*/
  fish_biome?: "sea" | "lake" | "river" | "reef" | "arctic";
  /** bu şehrin esin kaynağı gerçek adları ve markaları (küçük harf). Ürün dosyalarında GEÇEMEZ (free_map_ip); gerçek adlar
   *  yalnız docs/ ve bu alanda durur. */
  ip_blocklist: string[];
}

/** Sahne ortamı: SceneDef alanları; katman/paket/risk catalog.json'dan gelir (tek kaynak). */
export type CityEnv = Omit<SceneDef, "id" | "label" | "hint" | "build" | "tier" | "pack" | "ip_risk" | "culture_risk" | "annex">;

/** Ad alanı başına ek locale anahtarları (var olan anahtar ezilmez). `ritual`: ritüel metinleri (`<locale>_label|_done|_note`). */
export type CityLocaleNs = "world" | "city" | "walk" | "explore" | "landmarkInfo" | "ritualBook" | "ritual";
export type CityLocale = Partial<Record<CityLocaleNs, { tr: Record<string, string>; en: Record<string, string> }>>;

/** Yerel kostüm taslağı ( `LocalCostume` çekirdeği tamamlar; satılmaz, mağazaya girmez).*/
export interface CityCostumeDraft {
  id: string;
  kind: "gunluk" | "festival" | "is";
  weight: number;
  ip_risk: 0 | 1; culture_risk: 0 | 1;
  culture_note: string;
  review?: { by: "lider" | "kultur" | "ceo"; date: string };
}

/** Landmark bilgi kartı girdisi (citymap/landmarkInfo.ts `lm()` / `dist()` alanları; semt kartında `landmark` yok ve
 *  `kind: "district"`, `inspired: "public"`). */
export type CityInfoSpec = Omit<LandmarkInfo, "key" | "city" | "rituals"> & { rituals?: string[] };

export interface CityManifest {
  /** catalog.json içeriği (manifest `import catalog from "./catalog.json"` ile verir) */
  catalog: CityCatalogJson;
  env: CityEnv;
  /** mevsim ve hava anları (props/weather.ts PLACE_CLIMATE) */
  climate: PlaceClimate;
  /** taban dünya biçimi ve büyüme (rules/catalog.ts SCENE_PROFILES + ADJ) */
  profile: Omit<SceneProfile, "id">;
  adjacency?: readonly (readonly [WorldSceneId, Adjacency])[];
  /** ortam hayvanları (ambient/Ambient.tsx DAY/NIGHT; şehir başına ≤ 72) */
  ambient: { day: Partial<Record<Kind, number>>; night?: Partial<Record<Kind, number>> };
  /** dış mahalle biyomu (varsayılan `suburb`) ve özellik ağırlıkları (expanse/biomes.ts) */
  biome?: { id?: BiomeId; weights?: Partial<Record<FeatureKind, number>>; coast?: { sea: number; sand: number } };
  /** iç mekân silüet halkası (interiors/cityPano.ts): palet, varsayılan yönler, landmark tarifleri */
  pano?: { palette: PanoPalette; sides?: PanoRecipe; landmarks?: Readonly<Record<string, PanoRecipe>> };
  /** sahne keşif çapaları ve POI simgeleri (interiors/placement.ts ANCHORS / POI_NEAR) */
  placement?: { anchors?: Readonly<Record<string, Anchor>>; poi?: readonly string[] };
  /** şehir haritası canlı katmanı: süzülen balonlar (citymap/live.ts LIVE_DRIFT) */
  drift?: { district: string; n: number; r: number };
  /** şehir taksisi rengi (citymap/taxi.ts TAXI_STYLES; yeni araç türü yok, O12) */
  taxi?: TaxiStyle;
  /** küçük ağaç tacı vurgusu (city/kit.ts CANOPY_ACCENT) */
  canopy?: { spring?: string; autumn?: readonly [string, string] };
  /** olanak/avluda masa tenisi yerine sessiz masa oyunu (districts/core.ts BOARD_THEMES; varsayılan true) */
  board?: boolean;
  /** CITY-WORK-001 kapsamı (rules/registry.ts CITY_SCENES; varsayılan true) */
  cityWork?: boolean;
  /** bilgi kartları: ilk dalga sırası ve girdiler (citymap/landmarkInfo.ts) */
  info?: { firstWave: readonly string[]; entries: readonly CityInfoSpec[] };
  /** ölçek eğrisi girdileri ( `scaleStandard.ts` LANDMARK-SCALE-001; bkz. dosya başı). `exempt` (SCALE-FIX): yazılı gerekçeli muaf —
   * simge eğri bandına değil gerçek orana (ör. yüz eğimi) göre boyutlanır; ölçülür ve yazılır, ihlal sayılmaz, şehir içi sıraya girmez.*/
  scale?: { landmarks: Readonly<Record<string, { realM: number; source: string; exempt?: string }>> };
  rituals: readonly RitualDef[];
  costumes?: readonly CityCostumeDraft[];
  locale: CityLocale;
}

/** Ağır parçalar (kurucu, stil, harita): `parts.ts` üzerinden; yalnız ilgili kayıtlar tembel okur. */
export interface CityParts {
  build: () => Built;
  style: CityStyle;
  map: CityMapFile;
  design: CityDesign;
  /** CITY-REDO: isteğe bağlı şehre özgü büyüme teması (`<id>/theme.ts` `THEME`); yoksa `cityTheme(style)` (districts/themes.ts) */
  theme?: () => Theme;
}
