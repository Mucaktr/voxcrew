/**
 * CITY-PACKS — şehir paketleri kataloğu (ön yüz; saf modül)..
 *
 * Tek kaynak eşliği: aşağıdaki `CITYPACKS` bloğu katı JSON'dur ve `backend/studio/citypacks/catalog.py` ile aynı kimlikleri,
 * adları, ayak izlerini, risk puanlarını ve jeton fiyatlarını taşır (`backend/tests/test_citypacks.py` bloğu işaretler
 * arasından okuyup karşılaştırır). Para fiyatı burada YOKTUR: yalnız arka uçta "öneri" olarak durur ve satış kapalıdır.
 *
 * - Paket = set: tek öğe satılmaz. Öğe kimliği `<paket>-<öğe>`; mağaza kimliği `store:city-<paket>` / `store:city-<paket>-<öğe>`.
 * - `surfaces`: `builder` (dünya yapıcı paleti, `decor` prefab) ve/veya `city` (şehir haritası vitrini; anchors.ts).
 * - `esinli`: korunan bir yapının ADI ya da birebiri değil, o mimari türü andıran özgün tasarım (karar 2026-10-25);
 * `legal_review` true → satıştan önce avukat incelemesi.
 * - Paketler yalnız görünüştür: XP, jeton, pasaport damgası, hız, koltuk ya da yetki vermez ( İ2). Ücretli öğe
 * keşif damgası ve görev ÜRETMEZ (şehir landmark kataloğuna girmez).
*/
import type { Box } from "./kit";
import * as H from "./items/heritage";
import * as S from "./items/street";
import { FULL_PACKS, FULL_PACKS_AFTER, FULL_PACK_DRAW } from "../../full/citypacks";

export type PackKind = "landmark" | "furniture" | "material" | "decor";
export type PackSurface = "builder" | "city";

export interface PackItemMeta {
  id: string; tr: string; en: string; w: number; d: number;
  /** ayak izi karoları engelli mi (dünya yapıcı `cells`; şehirde katı süs karosu) */
  solid: boolean;
  ip_risk: number; culture_risk: number; esinli: boolean; legal_review: boolean;
}
export interface PackMeta {
  id: string; tr: string; en: string; kind: PackKind; city: string | null; surfaces: PackSurface[]; coin_price: number;
  items: PackItemMeta[];
}

/* CITYPACKS-BEGIN */
export const CITYPACKS: { version: number; packs: PackMeta[] } = {
  "version": 1,
  "packs": [
    {"id": "istanbul-heritage", "tr": "İstanbul Tarihî Yapılar", "en": "Istanbul Heritage", "kind": "landmark", "city": "istanbul", "surfaces": ["builder", "city"], "coin_price": 1600,
     "items": [
      {"id": "aqueduct", "tr": "Su kemeri", "en": "Roman aqueduct", "w": 10, "d": 2, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "fire-tower", "tr": "Yangın gözetleme kulesi", "en": "Fire-watch tower", "w": 3, "d": 3, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "honor-column", "tr": "Anıt sütun", "en": "Porphyry column", "w": 2, "d": 2, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "fortress-gate", "tr": "Hisar kapısı", "en": "Fortress gate", "w": 6, "d": 2, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false}]},
    {"id": "cappadocia-caravan", "tr": "Kapadokya Kervan Yolu", "en": "Cappadocia Caravan Road", "kind": "landmark", "city": "kapadokya", "surfaces": ["builder", "city"], "coin_price": 1200,
     "items": [
      {"id": "caravanserai", "tr": "Kervansaray", "en": "Caravanserai", "w": 8, "d": 6, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "rock-castle", "tr": "Kaya kalesi", "en": "Rock castle", "w": 4, "d": 4, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "hump-bridge", "tr": "Taş kemer köprü", "en": "Humpback stone bridge", "w": 6, "d": 2, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false}]},
    {"id": "london-victorian", "tr": "Londra Viktorya Dönemi", "en": "London Victorian Era", "kind": "landmark", "city": "londra", "surfaces": ["builder", "city"], "coin_price": 1200,
     "items": [
      {"id": "palm-house", "tr": "Cam palmiye serası", "en": "Glass palm house", "w": 8, "d": 4, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "domed-hall", "tr": "Kubbeli konser salonu", "en": "Domed concert hall", "w": 6, "d": 6, "solid": true, "ip_risk": 1, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "triumphal-arch", "tr": "Mermer zafer kemeri", "en": "Marble triumphal arch", "w": 4, "d": 2, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false}]},
    {"id": "street-furniture", "tr": "Şehir Mobilyası", "en": "Street Furniture", "kind": "furniture", "city": null, "surfaces": ["builder", "city"], "coin_price": 3200,
     "items": [
      {"id": "bench", "tr": "Park bankı", "en": "Park bench", "w": 2, "d": 1, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "street-lamp", "tr": "Sokak lambası", "en": "Street lamp", "w": 1, "d": 1, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "drinking-fountain", "tr": "İçme çeşmesi", "en": "Drinking fountain", "w": 1, "d": 1, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "news-kiosk", "tr": "Gazete büfesi", "en": "News kiosk", "w": 2, "d": 2, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "simit-cart", "tr": "Simit arabası", "en": "Simit cart", "w": 2, "d": 1, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "food-cart", "tr": "Sokak yemeği arabası", "en": "Street-food cart", "w": 2, "d": 1, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "tram-stop", "tr": "Tramvay durağı", "en": "Tram stop", "w": 3, "d": 1, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "bus-shelter", "tr": "Otobüs durağı", "en": "Bus shelter", "w": 3, "d": 1, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "planter", "tr": "Saksı", "en": "Planter", "w": 1, "d": 1, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "bike-rack", "tr": "Bisiklet parkı", "en": "Bike rack", "w": 2, "d": 1, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "market-stall", "tr": "Pazar tezgâhı", "en": "Market stall", "w": 2, "d": 2, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false}]},
    {"id": "night-lights", "tr": "Gece Işıkları", "en": "Night Lights", "kind": "decor", "city": null, "surfaces": ["builder", "city"], "coin_price": 1200,
     "items": [
      {"id": "fairy-lights", "tr": "Işık zinciri", "en": "Fairy lights", "w": 4, "d": 1, "solid": false, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "lantern-post", "tr": "Çift fenerli direk", "en": "Twin lantern post", "w": 1, "d": 1, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "lit-fountain", "tr": "Işıklı çeşme", "en": "Lit fountain", "w": 2, "d": 2, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "path-lights", "tr": "Yol işaret ışıkları", "en": "Path lights", "w": 3, "d": 1, "solid": false, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false}]},
    {"id": "park-garden", "tr": "Park ve Bahçe", "en": "Park & Garden", "kind": "decor", "city": null, "surfaces": ["builder", "city"], "coin_price": 1600,
     "items": [
      {"id": "flower-bed", "tr": "Çiçek tarhı", "en": "Flower bed", "w": 2, "d": 2, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "gazebo", "tr": "Çardak", "en": "Gazebo", "w": 3, "d": 3, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "lily-pond", "tr": "Nilüferli havuz", "en": "Lily pond", "w": 3, "d": 2, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "topiary", "tr": "Budama heykel", "en": "Topiary", "w": 1, "d": 1, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "garden-arch", "tr": "Gül kemeri", "en": "Rose arch", "w": 2, "d": 1, "solid": false, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "bird-bath", "tr": "Kuş banyosu", "en": "Bird bath", "w": 1, "d": 1, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false}]},
    {"id": "festival", "tr": "Bayram ve Festival Süsleri", "en": "Festival Decorations", "kind": "decor", "city": null, "surfaces": ["builder"], "coin_price": 1600,
     "items": [
      {"id": "new-year-tree", "tr": "Yeni yıl çamı", "en": "New Year tree", "w": 2, "d": 2, "solid": true, "ip_risk": 0, "culture_risk": 1, "esinli": false, "legal_review": false},
      {"id": "lantern-string", "tr": "Kâğıt fener dizisi", "en": "Paper lantern string", "w": 4, "d": 1, "solid": false, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "harvest-pumpkins", "tr": "Hasat balkabakları", "en": "Harvest pumpkins", "w": 2, "d": 1, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "treat-stall", "tr": "İkram tezgâhı", "en": "Treat stall", "w": 2, "d": 2, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "light-arch", "tr": "Işıklı kemer kapı", "en": "Light arch", "w": 3, "d": 1, "solid": false, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false}]},
    {"id": "live-materials", "tr": "Canlı Malzemeler", "en": "Live Materials", "kind": "material", "city": null, "surfaces": ["builder"], "coin_price": 2400,
     "items": [
      {"id": "ripple-pool", "tr": "Dalgalı havuz", "en": "Ripple pool", "w": 3, "d": 3, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "lava-basin", "tr": "Lav havzası", "en": "Lava basin", "w": 2, "d": 2, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "snow-corner", "tr": "Kar yağan köşe", "en": "Snowfall corner", "w": 3, "d": 3, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "floating-lanterns", "tr": "Yüzen fenerler", "en": "Floating lanterns", "w": 3, "d": 3, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "festival-bunting", "tr": "Dalgalanan flamalar", "en": "Fluttering bunting", "w": 4, "d": 1, "solid": false, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "neon-frame", "tr": "Neon çerçeve", "en": "Neon frame", "w": 2, "d": 1, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false},
      {"id": "glass-pavilion", "tr": "Cam köşk", "en": "Glass pavilion", "w": 3, "d": 3, "solid": true, "ip_risk": 0, "culture_risk": 0, "esinli": false, "legal_review": false}]}
  ]
};
/* CITYPACKS-END */
/** Full edition: the removed-city packs (full/citypacks.ts) are inserted after FULL_PACKS_AFTER, keeping today's catalog order. */
if (FULL_PACKS.length) CITYPACKS.packs.splice(CITYPACKS.packs.findIndex((p) => p.id === FULL_PACKS_AFTER) + 1, 0, ...FULL_PACKS);

/** Öğe çizicileri (`<paket>-<öğe>` → ayak izi uzayındaki kutular). */
const DRAW: Record<string, () => Box[]> = {
  "istanbul-heritage-aqueduct": H.aqueduct, "istanbul-heritage-fire-tower": H.fireTower, "istanbul-heritage-honor-column": H.honorColumn,
  "istanbul-heritage-fortress-gate": H.fortressGate,
  "cappadocia-caravan-caravanserai": H.caravanserai, "cappadocia-caravan-rock-castle": H.rockCastle, "cappadocia-caravan-hump-bridge": H.humpBridge,
  "london-victorian-palm-house": H.palmHouse, "london-victorian-domed-hall": H.domedHall, "london-victorian-triumphal-arch": H.triumphalArch,
  ...FULL_PACK_DRAW,
  "street-furniture-bench": S.bench, "street-furniture-street-lamp": S.streetLamp, "street-furniture-drinking-fountain": S.drinkingFountain,
  "street-furniture-news-kiosk": S.newsKiosk, "street-furniture-simit-cart": S.simitCart, "street-furniture-food-cart": S.foodCart,
  "street-furniture-tram-stop": S.tramStop, "street-furniture-bus-shelter": S.busShelter, "street-furniture-planter": S.planter,
  "street-furniture-bike-rack": S.bikeRack, "street-furniture-market-stall": S.marketStall,
  "night-lights-fairy-lights": S.fairyLights, "night-lights-lantern-post": S.lanternPost, "night-lights-lit-fountain": S.litFountain,
  "night-lights-path-lights": S.pathLights,
  "park-garden-flower-bed": S.flowerBed, "park-garden-gazebo": S.gazebo, "park-garden-lily-pond": S.lilyPond, "park-garden-topiary": S.topiary,
  "park-garden-garden-arch": S.gardenArch, "park-garden-bird-bath": S.birdBath,
  "festival-new-year-tree": S.newYearTree, "festival-lantern-string": S.lanternString, "festival-harvest-pumpkins": S.harvestPumpkins,
  "festival-treat-stall": S.treatStall, "festival-light-arch": S.lightArch,
  "live-materials-ripple-pool": S.ripplePool, "live-materials-lava-basin": S.lavaBasin, "live-materials-snow-corner": S.snowCorner,
  "live-materials-floating-lanterns": S.floatingLanterns, "live-materials-festival-bunting": S.festivalBunting,
  "live-materials-neon-frame": S.neonFrame, "live-materials-glass-pavilion": S.glassPavilion,
};

export interface PackItem extends PackItemMeta { key: string; pack: string; boxes: () => Box[] }
export interface CityPack extends PackMeta { list: PackItem[] }

const cache = new Map<string, Box[]>();
export const CITY_PACKS: readonly CityPack[] = CITYPACKS.packs.map((p) => ({
  ...p,
  list: p.items.map((it) => {
    const key = `${p.id}-${it.id}`;
    const draw = DRAW[key];
    return { ...it, key, pack: p.id, boxes: () => { let b = cache.get(key); if (!b) { b = draw ? draw() : []; cache.set(key, b); } return b; } };
  }),
}));
export const PACK_BY_ID: ReadonlyMap<string, CityPack> = new Map(CITY_PACKS.map((p) => [p.id, p]));
export const ITEM_BY_KEY: ReadonlyMap<string, PackItem> = new Map(CITY_PACKS.flatMap((p) => p.list.map((i) => [i.key, i] as const)));
/** Çizicisi olmayan öğe kimlikleri (denetim boş ister). */
export const MISSING_DRAWERS: readonly string[] = CITY_PACKS.flatMap((p) => p.list.filter((i) => !DRAW[i.key]).map((i) => i.key));

export const STORE_PREFIX = "store:city-";
export const packStoreId = (pack: string) => `${STORE_PREFIX}${pack}`;
export const itemStoreId = (key: string) => `${STORE_PREFIX}${key}`;
/** Dile göre ad. */
export const nameOf = (x: { tr: string; en: string }, lang: string) => (lang === "en" ? x.en : x.tr);
