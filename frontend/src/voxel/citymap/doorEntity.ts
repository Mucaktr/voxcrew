/**
 * UXF-B — "Şehre çık" kapısı keşfedilebilir: Yakındakiler'de "Yapılacak" (`citydoor:<şehir>`; F ya da listeden
 * seçince avatar kapıya yürür, kapıya basınca şehir haritası açılır), mini haritada simge ve Hoş geldin kartının seyir noktası
 * satırında "Git". Önceden düğme yalnız kapıya ≤ 2 karo yaklaşınca görünüyordu (denetim: 20 dk'lık aramada bulunamadı).
 *
 * Kapının karosu `door.ts officeDoor` (dünya büyüyünce kayar); `CityDoorWatcher` (CityRig.tsx) sahne bağlıyken kaynağı yazar.
 * Saf modül: React/three yok; 4 Hz çağrıda aynı dizi ve nesne yeniden kullanılır.
*/
import { tx, tz, type Tile } from "../scenes";
import type { ProxEntity } from "../walk/controller";
import { useWalkStore } from "../walk/walkStore";
import { interiorRuntime, useInterior } from "../interiors/store";

export const CITY_DOOR_PREFIX = "citydoor:";
export const isCityDoorId = (id: string) => id.startsWith(CITY_DOOR_PREFIX);

/** Bağlı kapının kaynağı: sahne, şehir haritası kimliği ve kapı karosu (dünya ızgarası) — her çağrıda güncel dünyadan. */
export interface CityDoorSource { scene: () => string; city: () => string; tile: () => Tile | null }
export const cityDoorRuntime: { src: CityDoorSource | null } = { src: null };

export function bindCityDoor(src: CityDoorSource): () => void {
  cityDoorRuntime.src = src;
  return () => { if (cityDoorRuntime.src === src) cityDoorRuntime.src = null; };
}

/** Yürünen sahnede kapı karosu (bağlı değilse, başka sahnede ya da iç mekândaysa null). */
export function cityDoorTile(): Tile | null {
  const src = cityDoorRuntime.src;
  if (!src || interiorRuntime.inside) return null;
  if (useWalkStore.getState().world !== src.scene()) return null;
  return src.tile();
}

/** `far`: yarıçap dışında da Yakındakiler'de (girişten ~14 karo uzakta olabilir; "N adım" yürüme yolu). */
const ent: ProxEntity = { id: "", kind: "prop", x: 0, z: 0, far: true };
const one: ProxEntity[] = [ent];
const none: readonly ProxEntity[] = Object.freeze([]) as readonly ProxEntity[];

/** Yakındakiler girdisi (`citydoor:<şehir>`); kapı yoksa boş. */
export function cityDoorEntities(): readonly ProxEntity[] {
  const t = cityDoorTile();
  if (!t) return none;
  ent.id = CITY_DOOR_PREFIX + cityDoorRuntime.src!.city(); ent.x = tx(t[0]); ent.z = tz(t[1]);
  return one;
}

// ------------------------------------------------------------------ CORE-WALK: şehir haritasındaki geri dönüş geçidi
export const CITY_GATE_PREFIX = "citygate:";
export const isCityGateId = (id: string) => id.startsWith(CITY_GATE_PREFIX);
/** Şehir haritasında "Ofise dön" geçidinin kaynağı (CityRig bağlar): şehir kimliği ve geçit karosu; bağlı değilse null. */
export const cityGateRuntime: { src: { city: () => string; tile: Tile } | null } = { src: null };
const gate: ProxEntity = { id: "", kind: "prop", x: 0, z: 0, far: true };
const gateOne: ProxEntity[] = [gate];
/** Yakındakiler girdisi (`citygate:<şehir>`; şehir haritasında, iç mekân dışında). */
export function cityGateEntities(): readonly ProxEntity[] {
  const src = cityGateRuntime.src;
  if (!src || interiorRuntime.inside) return none;
  gate.id = CITY_GATE_PREFIX + src.city(); gate.x = tx(src.tile[0]); gate.z = tz(src.tile[1]);
  return gateOne;
}
/** Avatarı geri dönüş geçidine yürüt (halkaya basınca CityRig ofise döndürür). Geçit yoksa false. */
export function goCityGate(): boolean {
  const src = cityGateRuntime.src;
  if (!src || interiorRuntime.inside) return false;
  goPortal(src.tile, `city:${src.city()}`);
  return true;
}

/** Avatarı kapıya yürüt (kapıya basınca giriş `CityDoorWatcher`'da). Kapı yoksa false. */
export function goCityDoor(): boolean {
  const t = cityDoorTile();
  if (!t) return false;
  useWalkStore.getState().setTarget(t);
  return true;
}

/** PORTAL-INTENT-001: F / Yakındakiler ile seçilen geçit, avatar zaten karosundayken (rota boş kalır, karo değişmez) — karo tetiği
 *  bu niyetle bir kez daha koşar (CityRig) ve `doorIntended` niyeti tüketir. Niyet anahtarlı (`city:<id>`; başka şehrin aynı karosu
 *  tutmaz), `PORTAL_INTENT_MS` içinde bayatlar, geçiş örtüsü sürerken kurulmaz; CityRig karodan ayrılınca ve durunca siler. */
export const PORTAL_INTENT_MS = 300;
export const portalIntent: { tile: Tile | null; key: string; at: number } = { tile: null, key: "", at: 0 };
export const clearPortalIntent = () => { portalIntent.tile = null; portalIntent.key = ""; };
export const portalArmed = (t: Tile, key: string, now = performance.now()) =>
  !!portalIntent.tile && !!key && portalIntent.key === key && portalIntent.tile[0] === t[0] && portalIntent.tile[1] === t[1] && now - portalIntent.at <= PORTAL_INTENT_MS;

/** F ile geçide git: uzaktaysa tıkla-git (rota geçitte biter → girilir), karosundaysa niyet kaydı. Geçiş sürerken hiçbir şey. */
export function goPortal(t: Tile, key: string): void {
  if (useInterior.getState().busy) return;
  const at = useWalkStore.getState().pose?.tile;
  if (at && at[0] === t[0] && at[1] === t[1]) { portalIntent.tile = [t[0], t[1]]; portalIntent.key = key; portalIntent.at = performance.now(); }
  else useWalkStore.getState().setTarget(t);
}

/**
 * UXF-E · PORTAL-INTENT-001 (ürün sahibi 2026-11-02 "yürürken birden portaldan geçiyorum"): avatar geçit karosunda — girilir mi?
 * Yalnız AÇIK niyetle: rotanın sonu geçitse (karoya tıkla / F uzaktan) ya da F karonun üstünde basıldıysa (`portalIntent`). Elle
 * yürüyüş (rota yok) ve başka hedefe giden rota geçidi tetiklemez — kapılar ve asansör gibi F ile (ürün sahibi: girişler etkileşimli).
*/
export function doorIntended(door: Tile, route: readonly Tile[] | null | undefined, key = ""): boolean {
  if (route && route.length) {
    const goal = route[route.length - 1];
    return goal[0] === door[0] && goal[1] === door[1];
  }
  if (!portalArmed(door, key)) return false;
  clearPortalIntent();
  return true;
}
