/**
 * semt akışı: E1b yuva akışı çekirdeğinin (`expanse/stream.ts SlotStream`) şehir haritası kaynağı.
 *
 * - Şehir çerçevesi: varış meydanı (gate) taban modülüdür, köken (0, 0); şehir karosu = dünya karosu. Parsel = 12 × 16 karo
 * (E1b ile aynı ızgara), semt ≈ 48 × 48 karo = 4 × 3 parsel. Yalnız bir semtin içindeki parseller akışa açıktır.
 * - Semt ölçeği: parsel üretimi semt planını (`districtPlan`; semt başına bir kez, önbellek 16 semt) keser; avatar semt sınırına
 * yaklaşınca komşu semtin parselleri yakın/uzak halkaya girer, uzaklaşınca bırakılır (histerezis). Uzak semtler çizilmez.
 * - Yuva düzeni `CITY_LAYOUT` (12 yakın × 192 solid …; uzak halka 2) — kapasite kuyruğuna sığar: **+0 çizim çağrısı**.
 * - Bloklar zaten dünya çerçevesinde üretilir (köken 0): `toWorld` kopyalar.
 *
 * Saf modül: React/three yok (expanse_check CITY-MAP-STREAM-001 doğrudan sürer).
*/
import { CITY_LAYOUT, SlotStream, type ParcelSource, type StreamOptions, type TailGroup } from "../expanse/stream";
import { CITY_PD, CITY_PW, type CityDistrict, type CityMapFile } from "./format";
import { districtParcel, type CityParcel } from "./district";
import { withoutManaged } from "../hires/registry"; // LANDMARK-HIRES

/** Şehir akışı seçenekleri: yakın 1 (3 × 3), uzak 2 (5 × 5), histerezis 1; LRU 48 parsel (4 semt). */
export const CITY_STREAM: Readonly<StreamOptions> = { near: 1, far: 2, hold: 1, cache: 48, genPerUpdate: 1, writesPerUpdate: 6 };
/** PORTAL-ARRIVAL-COMPLETE-001: geçiş örtüsü altında (siyah) kare başına üretim/yazım — örtü görüş yarıçapı dolunca kalkar (gateState.arrivalHold). */
export const CITY_ARRIVAL_BUDGET: Readonly<{ gen: number; writes: number }> = { gen: 4, writes: 24 };

/**
 * yolculukta kare yavaşken (> `RIDE_SLOW_FRAME` sn) yeni parsel ÜRETİMİ ertelenir — tek parsel üretimi 30–150 ms
 * sürebilir ve zaten yavaş bir karenin üstüne binip multi-saniyelik takılmaya dönüşüyordu. Yakın halkada bekleyen parsel varsa
 * (`pendingNear`) ya da son üretimden `RIDE_GEN_STARVE` sn geçtiyse üretim yine yapılır (araç parselsiz yere girmez). Saf.
*/
export const RIDE_SLOW_FRAME = 0.05, RIDE_GEN_STARVE = 0.75;
export function rideGenBudget(riding: boolean, delta: number, sinceGen: number, pendingNear: number): { gen?: number } {
  return riding && delta > RIDE_SLOW_FRAME && pendingNear === 0 && sinceGen < RIDE_GEN_STARVE ? { gen: 0 } : {};
}

/** Parselin semti (parsel tümüyle semtin içinde; sınırlar ızgaraya hizalı). */
export function parcelDistrict(map: CityMapFile, cx: number, cz: number): CityDistrict | null {
  const I = cx * CITY_PW, J = cz * CITY_PD;
  for (const d of map.districts) {
    const [i0, j0, w, dd] = d.bounds;
    if (I >= i0 && J >= j0 && I + CITY_PW <= i0 + w && J + CITY_PD <= j0 + dd) return d;
  }
  return null;
}

/** Haritanın bütün parselleri (semt sırası, sonra cz, cx). */
export function cityParcels(map: CityMapFile): { cx: number; cz: number; district: string }[] {
  const out: { cx: number; cz: number; district: string }[] = [];
  for (const d of map.districts) {
    const [i0, j0, w, dd] = d.bounds;
    for (let cz = j0 / CITY_PD; cz < (j0 + dd) / CITY_PD; cz++) for (let cx = i0 / CITY_PW; cx < (i0 + w) / CITY_PW; cx++) out.push({ cx, cz, district: d.id });
  }
  return out;
}

export function citySource(map: CityMapFile): ParcelSource<CityParcel> {
  return {
    origin: [0, 0],
    open: (cx, cz) => parcelDistrict(map, cx, cz) !== null,
    generate: (cx, cz) => {
      const d = parcelDistrict(map, cx, cz);
      return d ? districtParcel(map, d, cx, cz) : null;
    },
    // LANDMARK-HIRES: yüksek çözünürlüklü simgenin orta modeli kuyruğa yazılmaz (HiResLayer çizer; `?hires=0` iken yazılır)
    toWorld: (blocks) => withoutManaged(blocks),
  };
}

export type CityStream = SlotStream<CityParcel>;

/** Araç bölgesi (kapasite kuyruğunda `layoutEnd(CITY_LAYOUT)`'tan sonra; `TAIL_CAP` içinde — CITY-MAP-BUDGET-001). VEHICLE-DETAIL:
 *  katı 24 → 32 (kuyruğun boş katı payından; düzen 3264 + araç 32 + taksi 30 = 3326 ≤ 3328), cam 8 → 12, parıltı 4 → 8. */
export const VEHICLE_SLOT: Readonly<Record<TailGroup, number>> = { solid: 32, water: 0, glass: 12, glow: 8 };

/** Şehir haritası akışı (semt ölçeği, CITY_LAYOUT). */
export function cityStream(map: CityMapFile, opts: StreamOptions = {}): CityStream {
  return new SlotStream(citySource(map), { ...CITY_STREAM, ...opts }, CITY_LAYOUT);
}

/** Yüklü semtler (yakın ya da uzak yuvada en az bir parseli olan), kimlik sırasıyla. */
export function loadedDistricts(s: CityStream): string[] {
  return [...new Set(s.loadedList().map((l) => l.p.district))].sort();
}
