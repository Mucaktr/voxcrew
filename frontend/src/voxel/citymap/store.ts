/**
 * şehir kipi durumu (zustand; seyrek) ve geçişler.
 *
 * - `enterCity`: ofis tabanındaki "Şehre çık" kapısından (yalnız yürüme modunda, iç mekân dışında). Ofisteki dönüş pozu (kapının
 * içeri komşusu, taban göreli) `cityRuntime.office`'e yazılır. Kararma (iç mekân örtüsü; hareket azaltmada anlık) → World.tsx
 * şehir tabanını (varış meydanı) çizer → CityRig varışı uygular ve yakın halkayı aynı karede doldurur.
 * - `exitCity` ("Ofise dön", her zaman bir tık; iç mekândan ve yolculuktan da): şehir biter, avatar kapının önüne döner
 * (InteriorRig `requestArrival`, `rel`). Yürüme modu kapanırsa şehir de anında biter (konum kaydı ofis kapısını yazar).
 * varış yönü açık görüşe (`arrivalView.ts`); şehre ilk girişte "Hoş geldin" kartı (`components/welcome`).
 * - Ajanlar ofiste kalır (D5 A): World.tsx şehirde ajan çizmez; ajan durumları ve koşular değişmez.
 * - Ulaşım: `boardLine` (durakta; hareket azaltmada doğrudan varış, değilse yolculuk sahnesi `transit/ride.ts`),
 * `fastTravel` (yalnız ziyaret edilmiş duraklar; kararmayla ışınlama).
 * - Pasaport: `visitCity` iyimser kayıt (sunucu sırası korunur: istekler zincirlenir, böylece semt damgası landmarktan önce
 * yazılır); yanıt tostu ve ekran okuyucu duyurusu. Görüntüleme kipi (yönetici/yaratıcı) kaydetmez.
*/
import { create } from "zustand";
import { tx } from "../../lib/i18n";
import { pushWalkToast } from "../../lib/walk";
import { city as CM } from "../../locales/city";
import { announceWalk } from "../../components/world/walk/announce";
import { reducedMotion } from "../motion";
import { sceneDef, type Built, type SceneDef } from "../scenes";
import { cancelFade, requestArrival, transition as fadeSwap, useInterior } from "../interiors/store";
import { interiorRuntime } from "../interiors/runtime";
import { useWalkStore, walkRuntime } from "../walk/walkStore";
import { useLightMode, type LightMode } from "../props/daynight";
import { cityX, cityZ, linesAt, rideOffered, riderSeat, travelPlan, VEHICLES, vehicleLook } from "../transit/model";
import { cancelRide, rideRuntime, skipRide, startRide } from "../transit/ride"; // RIDE-UX: skipRide
import { cityApi, CityApiError } from "./api";
import { CITY_CATALOG, cityIds, interiorStampId, parseCityId, stopId, viewpointId } from "./catalog";
import { districtAt, stopBoard, stopTile, type CityMapFile, type CityTile } from "./format";
import { onTrack } from "./trackBand";
import { cityRuntime } from "./runtime";
import { cityDef, GATE_ARRIVE, gateBuilt } from "./shell";
import { cityArrivalView, citySight, nearLandmarks } from "./arrivalView";
import { landmarkExit } from "./doorExit";
import { chooseView, rayOpen } from "../walk/spawnView"; // ARRIVAL-QA: durak varışında açık görüş
import { districtPlan, walkableKind } from "./district"; // ARRIVAL-QA: durak varış karosu
import { stopPose } from "./arrivalPoses"; // ölçülmüş durak varış pozu
import { cameraSource } from "../camera/world"; // HQA-FIX
import { sweepArm } from "../camera/collide"; // HQA-FIX
import { FOLLOW_DIST, LOOK_DEFAULT, LOOK_Y } from "../walk/scale"; // HQA-FIX
import { showWelcome } from "../../components/welcome/welcomeStore";

export interface CityView { scene: string; city: string; map: CityMapFile; built: Built; def: SceneDef }
/** Bekleyen avatar yerleşimi (CityRig uygular; WalkRig/InteriorRig etkilerinden sonra). */
export interface CityArrival { x: number; z: number; heading: number; token: number; /** ARRIVAL-QA: kamera da bu yöne oturur (kararma altındaki ışınlanma) */ aim?: boolean; /** doğrulanmış durak varışı — WalkRig `clearAimYaw` yaw'ı döndürmez (kare arrival_check'in ölçtüğü kare)*/ exact?: boolean }
export interface CityRideHud { line: string; kind: string; to: string }

export interface CityState {
  view: CityView | null;
  arrival: CityArrival | null;
  /** avatarın semti (HUD; gate'te null) */
  district: string | null;
  /** avatarın üstünde durduğu durak */
  stop: string | null;
  /** durak hatları paneli açık mı — durağa varınca (yolculuk, yürüyüş) kendiliğinden açılmaz, avatarı
   * örtmesin; tek satır durak çipi gösterilir. F / Yakındakiler'den durak (`openCityStop`) ya da çipe tıklama açar. Durak değişince kapanır.*/
  stopPanel: boolean;
  /** seyir noktasında (birinci şahıs) */
  deck: boolean;
  ride: CityRideHud | null;
  /** ofiste "Şehre çık" kapısına yakın (≤ 2 karo): HUD düğmesi */
  nearDoor: string | null;
  /** sunucu + iyimser kayıtlı kimlikler (damgalar ve duraklar) */
  found: ReadonlySet<string>;
  loaded: boolean;
  /** Hızlı seyahat paneli açık (HUD) */
  fast: boolean;
  /** pasaport paneli açık (HUD; semtler, kilitler, görevler)*/
  passport: boolean;
  /** üstünde durulan seyir noktasının semtteki sırası (1'den; yoksa null)*/
  deckVp: number | null;
  /** kilitli semtler (`<şehir>:<semt>`; sunucu durumu, kayıtla güncellenir)*/
  locked: ReadonlySet<string>;
  /** görev semti kilitliyken kaydedilmiş duraklar (kimlik → o anda kilitli görev semtleri; sunucu durumu)*/
  stale: Readonly<Record<string, readonly string[]>>;
  /** kataloğa sonradan eklenen, bulunmamış damgalar (sunucu `new_ids`; "N yeni damga eklendi" bildirimi)*/
  newIds: readonly string[];
}

const EMPTY: ReadonlySet<string> = new Set();
const EMPTY_LIST: readonly string[] = [];
export const useCity = create<CityState>(() => ({
  view: null, arrival: null, district: null, stop: null, stopPanel: false, deck: false, ride: null, nearDoor: null, found: EMPTY, loaded: false, fast: false,
  passport: false, locked: EMPTY, deckVp: null, stale: {}, newIds: EMPTY_LIST,
}));

/** gün batımı koşulu — kullanıcı "Gece" ışığını seçtiyse ya da otomatikte sahne gecesi / yerel akşam saatleri (17–21).*/
export function sunsetNow(def: Pick<SceneDef, "time">, now = new Date()): boolean {
  const mode = useLightMode.getState().mode;
  if (mode === "night") return true;
  if (mode === "day") return false;
  if (def.time === "night") return true;
  const h = now.getHours();
  return h >= 17 && h < 21;
}
/** Geliştirme kancası: ışık kipi (canlı denetim). */
export const setLightMode = (mode: LightMode) => useLightMode.getState().setMode(mode);

/** semt kilitli mi (sunucunun son bildirdiği durum; yüklenmeden önce açık sayılır, sunucu yine 423 ile korur).*/
export const isDistrictLocked = (city: string, d: string) => useCity.getState().locked.has(`${city}:${d}`);
/** kilidin açılma kuralı (HUD metni): önceki semt ve ofis seviyesi.*/
export const unlockRule = (city: string, d: string) => CITY_CATALOG.cities[city]?.unlock?.[d] ?? null;
function setLocked(city: string, list: readonly string[]) {
  const s = useCity.getState();
  const next = new Set([...s.locked].filter((k) => !k.startsWith(`${city}:`)));
  for (const d of list) next.add(`${city}:${d}`);
  if (next.size !== s.locked.size || [...next].some((k) => !s.locked.has(k))) useCity.setState({ locked: next });
}
let lockToastAt = 0;
/** Kilitli semt tostu ve duyurusu (en çok 4 sn'de bir). */
export function lockedNotice(city: string, d: string) {
  const now = Date.now();
  if (now - lockToastAt < 4000) return;
  lockToastAt = now;
  const u = unlockRule(city, d);
  const title = tx(CM, "locked_toast", { district: districtName(city, d), after: u ? districtName(city, u.after) : "", level: u?.level ?? 1 });
  pushWalkToast({ kind: "visa", title });
  announceWalk(title);
}

export const useCityActive = () => useCity((s) => s.view !== null);

let token = 0;

/** Kararma → `swap` → aydınlanma (iç mekân örtüsü paylaşılır; hareket azaltmada anlık). ROUTE1: durak paneli sıçraması da kullanır.
 *  REVFIX1: iç mekânla TEK kilit (`interiors/store.ts transition`, kuşak sahipli; swap hata atsa da açılır) — ikinci kopya kaldırıldı. */
export function transition(swap: () => void): boolean { return fadeSwap(swap); }

// ------------------------------------------------------------------------------------------ adlar
/** Öğe adı; anahtar eksikse ham kimlik değil, türün genel adı (CORE-WALK: arayüzde slug yok; geliştirmede uyarı). */
const name = (key: string, _id: string) => {
  const v = tx(CM, key as "door");
  if (v !== key) return v;
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  if (env?.DEV) console.warn(`[label] eksik ad: ${key}`);
  return tx(CM, `fb_${key.slice(0, key.indexOf("_"))}` as "fb_city");
};
export const cityName = (city: string) => name(`city_${city}`, city);
export const districtName = (city: string, d: string) => name(`d_${city}_${d}`, d);
export const landmarkName = (city: string, lm: string) => name(`lm_${city}_${lm}`, lm);
export const stopName = (city: string, s: string) => name(`st_${city}_${s}`, s);
// Mekik hatları otobüs kipinde çizilir ama "Otobüs" diye anılmaz
const SHUTTLE_LINES: ReadonlySet<string> = new Set(["kanyon", "pazar", "vadi_mekigi"]);
export const vehicleName = (kind: string, line?: string) => name(line && SHUTTLE_LINES.has(line) ? "v_mekik" : `v_${kind}`, kind);
export const momentName = (city: string, an: string) => name(`an_${city}_${an}`, an);
export const questName = (city: string, q: string) => name(`q_${city}_${q}`, q);

// iç mekân adı ve damgası (InteriorRig / keşif adları; `city_<şehir>__<semt>__<landmark>`)
export const citySiteId = (city: string, d: string, lm: string) => `city_${city}__${d}__${lm}`;
function parseSite(site: string): { city: string; district: string; lm: string } | null {
  const m = /^city_([a-z0-9_]+?)__([a-z0-9_]+?)__([a-z0-9_]+)$/.exec(site);
  return m ? { city: m[1], district: m[2], lm: m[3] } : null;
}
cityRuntime.siteLabel = (site) => { const p = parseSite(site); return p ? landmarkName(p.city, p.lm) : null; };
cityRuntime.onInteriorLevel = (lv) => {
  const p = parseSite(lv.site);
  if (!p) return;
  if (lv.index === 0) visitCity(p.city, interiorStampId(p.city, p.district, p.lm));
};

// ------------------------------------------------------------------------------------------ giriş / çıkış
/**
 * Ofisteki kapıdan şehre çık. `office`: dönüş pozu (taban göreli; kapının içeri komşusu). Dönüş: geçiş başladı mı.
 */
export function enterCity(scene: string, map: CityMapFile, office: { x: number; z: number; heading: number }): boolean {
  const ws = useWalkStore.getState();
  if (!ws.active || interiorRuntime.inside || useCity.getState().view) return false;
  return transition(() => {
    cityRuntime.active = true;
    cityRuntime.office = office;
    cityRuntime.exit = exitCity;
    useWalkStore.getState().setTarget(null);
    const base = sceneDef(scene);
    useCity.setState({
      view: { scene, city: map.id, map, built: gateBuilt(map), def: cityDef(base, map) },
      // varışta açık görüşe (varışa yakın simgeye) bak — 8 yönlü görüş ışını, harita başına önbellekli
      arrival: { x: cityX(GATE_ARRIVE[0]), z: cityZ(GATE_ARRIVE[1]), heading: cityArrivalView(map).heading ?? cityArrivalView(map).yaw, token: ++token },
      district: null, stop: null, deck: false, ride: null, nearDoor: null,
    });
    announceWalk(tx(CM, "enter_ann", { city: cityName(map.id) }));
    // şehre ilk girişte "Hoş geldin" kartı (şehir başına bir kez; ayarla kapanır)
    showWelcome(map.id, "map");
    // kilitler ofis seviyesine de bağlı: her girişte sunucudan tazelenir
    void loadCity();
  });
}

/** "Ofise dön": şehir (ve varsa iç mekân, yolculuk) biter; avatar ofiste kapının önüne. */
export function exitCity(): boolean {
  if (!useCity.getState().view) return false;
  // geçiş sürüyorsa (iç mekân kararması) yine de bitir: kararma bekletilmez
  if (useInterior.getState().busy) cancelFade(); // REVFIX1: süren kararmanın swap'ı/aydınlanması iptal (eskiden yalnız kilit açılıyor, ikisi üst üste ışınlıyordu)
  return transition(() => {
    cancelRide();
    const o = cityRuntime.office;
    useWalkStore.getState().setTarget(null);
    useCity.setState({ view: null, arrival: null, district: null, stop: null, deck: false, ride: null, fast: false, passport: false });
    // InteriorRig varışı (WalkRig taban kaymasından sonra): ofiste kapının önü, taban göreli
    requestArrival(o ? { x: o.x, z: o.z, heading: o.heading, rel: true, quiet: true } : { x: 0, z: 0, heading: Math.PI, home: true, quiet: true });
    cityRuntime.active = false;
    cityRuntime.exit = null;
    announceWalk(tx(CM, "leave_ann"));
  });
}

/** Yürüme modu kapandı / sahne değişti: şehir anında biter (kararma yok). Konum kaydı bu karede ofis kapısını yazar. */
export function resetCity() {
  if (!useCity.getState().view && !cityRuntime.active) return;
  cancelRide();
  queueMicrotask(() => {
    cityRuntime.active = false;
    cityRuntime.office = null;
    cityRuntime.exit = null;
    useCity.setState({ view: null, arrival: null, district: null, stop: null, deck: false, ride: null, fast: false, passport: false });
  });
}

/** Şehir karosuna ışınla (CityRig yakın halkayı aynı karede doldurur). yön verilmezse ve karo bir landmark kapısının
 * yaklaşma karosuysa avatar kapıya döner, kamera arkasından kapıya bakar (eskiden hep π: kule ayağı/bina köşesi kadrajı kaplıyordu).*/
export function arriveAt(t: CityTile, heading?: number, aim = false, exact = false) {
  const map = heading === undefined ? useCity.getState().view?.map : undefined;
  const dh = map ? doorApproachHeading(map, t) : null;
  if (dh != null) { heading = dh; aim = true; }
  useCity.setState({ arrival: { x: cityX(t[0]), z: cityZ(t[1]), heading: heading ?? Math.PI, token: ++token, ...(aim ? { aim: true } : {}), ...(exact ? { exact: true } : {}) } });
}

/** `t` girilebilir bir landmark kapısının yaklaşma karosuysa (kapı + çıkış yönü; CityRig `doors` ile aynı) kapıya bakan yön, değilse null.*/
export function doorApproachHeading(map: CityMapFile, t: CityTile): number | null {
  const d = districtAt(map, t[0], t[1]);
  if (!d) return null;
  const plan = districtPlan(map, d);
  for (const dr of plan.doors) {
    if (Math.abs(dr.tile[0] - t[0]) + Math.abs(dr.tile[1] - t[1]) !== 1) continue;
    const lm = plan.landmarks.find((x) => x.id === dr.landmark);
    let sight = sightCache.get(map);
    if (!sight) { sight = citySight(map); sightCache.set(map, sight); }
    const ex = lm ? landmarkExit(plan, dr.tile, lm, sight) : null;
    if (ex && dr.tile[0] + ex.dir[0] === t[0] && dr.tile[1] + ex.dir[1] === t[1]) return Math.atan2(dr.tile[0] - t[0], dr.tile[1] - t[1]);
  }
  return null;
}

/**
 * ARRIVAL-QA — durak varış karosu: durak karosu (saçak/turnike altında, dar) ya da biniş panelinin hâlâ açıldığı 8 komşusundan
 * (STOP_TOLERANCE 1) en açık olanı: bakış ışını + 5 × 5 yürünebilir karo (kamera dar geçit profiline düşmez). Yön `arrivalHeading`.
 */
export function stopArrival(map: CityMapFile, t: CityTile, prefer: number | null = null): { tile: CityTile; heading: number } {
  // CABLEVP1: biniş platformlu durakta (teleferik uç durağı) varış ve panel platformda — kabin durağı (halat ucu) uç istasyon dikmesinin dibinde
  const bs = map.stops.find((s) => s.board && stopTile(map, s)?.join() === t.join()), board = bs ? stopBoard(map, bs) : null;
  const t0 = t;
  if (board) t = board;
  const walk = (i: number, j: number) => {
    const d = districtAt(map, i, j);
    if (!d) return false;
    const p = districtPlan(map, d), li = i - p.i0, lj = j - p.j0;
    return li >= 0 && lj >= 0 && li < p.w && lj < p.d && walkableKind(p.kind[lj * p.w + li]);
  };
  const fixed = stopPose(map.id, t0); // CABLEVP1: tablo anahtarı durak karosu (platformlu durakta poz platformun çevresinden seçilir) // kuralın pozu kamera karesinden geçmeyen durak (iskele saçağı, istasyon)
  // HQA-FIX: ölçülmüş poz durak örtüsünün (tabela levhası, saçak) altındaysa kullanılmaz — INTERIOR-CAM tavan kuralı
  // (ölçümden sonra geldi) kamerayı örtünün altına, başın dibine indiriyordu
  // ölçülmüş poz ray bandındaysa (avatar rayın üstünde) kullanılmaz
  if (fixed && walk(fixed.tile[0], fixed.tile[1]) && !onTrack(map, fixed.tile[0], fixed.tile[1]) && stopCamClear(map, fixed.tile).up >= 0.9) return fixed; // HQA-FIX-C: katı karoya poz verilmez
  let sight = sightCache.get(map);
  if (!sight) { sight = citySight(map); sightCache.set(map, sight); }
  if (board && walk(t[0], t[1])) return { tile: t, heading: arrivalHeading(map, t, prefer) }; // CABLEVP1: platform karosu seçilmiş açık yer (FX-VIEW-002 temiz); panel tek adımda
  let best = { tile: t, heading: arrivalHeading(map, t, prefer) }, bestScore = -Infinity;
  // HQA-FIX: tolerans halkasının hepsi örtü altındaysa (<city> teleferik zirvesi) bir halka dışarı bakılır (inişte panel gerekmez)
  for (let R = 1; R <= 2 && bestScore < -15; R++) for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
    if (R === 2 && Math.max(Math.abs(di), Math.abs(dj)) < 2) continue;
    const c: CityTile = [t[0] + di, t[1] + dj];
    if ((di || dj) && !walk(c[0], c[1])) continue;
    const h = arrivalHeading(map, c, prefer);
    let room = 0;
    for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) if (walk(c[0] + a, c[1] + b)) room++;
    const score = Math.min(rayOpen(sight, c, Math.round(Math.sin(h)), Math.round(Math.cos(h))), 10) + room * 0.4 - (di || dj ? 0 : 1)
      - stopCamPenalty(map, c) - (onTrack(map, c[0], c[1]) ? 1000 : 0); // HQA-FIX; ray bandı karosu varış olmaz (R=2'ye genişler)
    if (score > bestScore + 1e-9) { bestScore = score; best = { tile: c, heading: h }; }
  }
  return best;
}
/**
 * HQA-FIX — varış karosunun kamera cezası. Durak karosunun üstünde tabela/saçak/turnike tepesi var (taramada 20 şehirde
 * varış durak karosundaydı, başın 0,7 üstünde blok): kamera tavan kuralıyla (`fitCeiling`) başın dibine iniyor, Q/E çevirmek kurtarmıyor,
 * ancak yürüyüp karodan çıkınca düzeliyordu. Üstü kapalı karo (göğüsten yukarı kol `CAM_UP` boyunun %90'ından kısa) −20; hiçbir
 * yönde (8 yaw) takip kolu %70 açık değilse −10. Kaynak: şehrin kamera çarpışma dünyası (durak, semt parselleri).
*/
export const CAM_UP = 3;
export function stopCamClear(map: CityMapFile, c: CityTile): { up: number; arm: number } {
  const src = cameraSource(gateBuilt(map)), x = cityX(c[0]), z = cityZ(c[1]);
  // ayak: semt karosunun yürüme yüzeyi (tepe, sur, köprü üstü durak)
  const d = districtAt(map, c[0], c[1]), p = d ? districtPlan(map, d) : null, k = p ? (c[1] - p.j0) * p.w + (c[0] - p.i0) : -1;
  const foot = p && k >= 0 && k < p.top.length ? Math.max(0, p.top[k]) : 0, cy = foot + LOOK_Y, ft = foot + 0.2;
  const pv: [number, number, number] = [x, cy, z];
  const up = sweepArm(src, pv, [x, cy + CAM_UP, z], 0.32, ft) / CAM_UP;
  const ce = Math.cos(-LOOK_DEFAULT), se = Math.sin(-LOOK_DEFAULT);
  let arm = 0;
  for (let k = 0; k < 8 && arm < 0.7; k++) {
    const y = (k * Math.PI) / 4;
    arm = Math.max(arm, sweepArm(src, pv, [x - Math.sin(y) * ce * FOLLOW_DIST, cy + se * FOLLOW_DIST, z - Math.cos(y) * ce * FOLLOW_DIST], 0.32, ft) / FOLLOW_DIST);
  }
  return { up, arm };
}
function stopCamPenalty(map: CityMapFile, c: CityTile): number {
  const r = stopCamClear(map, c);
  return (r.up < 0.9 ? 20 : 0) + (r.arm < 0.7 ? 10 : 0);
}
/** ARRIVAL-QA: inişte aracın yönünde en az 3 karo açık mı (değilse avatar suya/duvara bakar; kararma altında düzeltilir). */
export function rideViewOpen(map: CityMapFile, t: CityTile, h: number): boolean {
  let sight = sightCache.get(map);
  if (!sight) { sight = citySight(map); sightCache.set(map, sight); }
  return rayOpen(sight, t, Math.round(Math.sin(h)), Math.round(Math.cos(h))) >= 3;
}
/** ARRIVAL-QA: yolculuğun son parçasının yönü (iniş anında aracın yönü). */
export const rideEndHeading = (plan: { path: readonly (readonly [number, number])[] }): number => {
  const n = plan.path.length;
  return n > 1 ? Math.atan2(plan.path[n - 1][0] - plan.path[n - 2][0], plan.path[n - 1][1] - plan.path[n - 2][1]) : Math.PI;
};
/**
 * ARRIVAL-QA — durak varışının yönü (hızlı seyahat, iniş): `prefer` (aracın geliş yönü) en az 6 karo açıksa o; değilse görüş
 * seçimi (8 yön, yakın simge ±30° kadrajda ek puan). Eskiden hızlı seyahat hep π'ye, iniş aracın yönüne bakıyordu (iskelede suya
 * ya da durak saçağının arka duvarına). Saf; harita başına görüş ızgarası `citySight` önbelleklidir.
*/
const sightCache = new WeakMap<CityMapFile, ReturnType<typeof citySight>>();
export function arrivalHeading(map: CityMapFile, t: CityTile, prefer: number | null = null): number {
  let sight = sightCache.get(map);
  if (!sight) { sight = citySight(map); sightCache.set(map, sight); }
  // aracın yönü haritanın kenarından dışarı (açık denize) çıkıyorsa kullanılmaz — nostaljik tramvayın Taksim sonu kuzey kıyıda denize bakıyordu (meydan arkada)
  const ahead = (h: number) => { const di = Math.round(Math.sin(h)), dj = Math.round(Math.cos(h)); for (let k = 1; k <= 6; k++) if (!districtAt(map, t[0] + di * k, t[1] + dj * k)) return false; return true; };
  if (prefer !== null && rayOpen(sight, t, Math.round(Math.sin(prefer)), Math.round(Math.cos(prefer))) >= 6 && ahead(prefer)) return prefer;
  return chooseView(sight, t, nearLandmarks(map, t)).yaw;
}

// ------------------------------------------------------------------------------------------ ulaşım
/** Durakta bin: `lineId` hattıyla `to` durağına. Hareket azaltmada (`calm`; varsayılan kullanıcı tercihi) doğrudan varış. */
export function boardLine(lineId: string, to: string, calm = reducedMotion()): boolean {
  const s = useCity.getState();
  const v = s.view;
  if (!v || !s.stop || s.ride || useInterior.getState().busy) return false;
  const plan = travelPlan(v.map, lineId, s.stop, to);
  if (!plan) return false;
  // kilitli semte binilmez (hızlı seyahat zaten yalnız ziyaret edilmiş duraklara)
  const dest = v.map.stops.find((x) => x.id === to)?.district;
  if (dest && isDistrictLocked(v.city, dest)) { lockedNotice(v.city, dest); return false; }
  const vehicle = vehicleName(plan.kind, lineId), toName = stopName(v.city, to);
  const arrive = (ridden = false) => {
    useCity.setState({ ride: null });
    // ARRIVAL-QA: inişte avatar suya/duvara bakıyorsa (iskele, terminal) kararma altında açık görüşe döner (kamera da)
    if (ridden) {
      const h = rideEndHeading(plan);
      // ölçülmüş durak pozu varsa araç yönü açık olsa da ona geçilir (kamera saçak/istasyon gövdesine yaslanmaz)
      // HQA-FIX: her inişte varış karosu `stopArrival` (üstü kapalı durak karosunda kalınmaz) ve kamera aim alır
      // (`clearAimYaw`); eskiden araç yönü açıksa avatar durak karosunda, tabelanın altında kalıyor, kamera başın içine iniyordu
      const want = stopArrival(v.map, plan.arrive, h);
      const moved = want.tile[0] !== plan.arrive[0] || want.tile[1] !== plan.arrive[1];
      // HQA-FIX: "Durağa atla" kendi kararmasının içinde biter — o kararma sürerken `transition` reddeder; eskiden varış hiç
      // uygulanmıyor, avatar iskele saçağının altında, kamera aim'siz başta kalıyordu (Londra vapuru: ölçülmüş pozlu duraklar)
      const land = () => arriveAt(want.tile, want.heading, true, true);
      if (!(moved || stopPose(v.map.id, plan.arrive) || !rideViewOpen(v.map, plan.arrive, h)) || !transition(land)) land();
    }
    visitCity(v.city, stopId(v.city, to));
    announceWalk(tx(CM, "arrive_ann", { stop: toName }));
  };
  useWalkStore.getState().setTarget(null);
  if (calm) {
    // hareket azaltma: yolculuk sahnesi yok — doğrudan varış
    // ARRIVAL-QA: aracın yönü açıksa o, değilse açık görüş; kamera da oturur
    const sa = stopArrival(v.map, plan.arrive, rideEndHeading(plan));
    arriveAt(sa.tile, sa.heading, true, true);
    arrive();
    return true;
  }
  const ride = { line: lineId, kind: plan.kind, to };
  useCity.setState({ ride });
  announceWalk(tx(CM, "ride_ann", { vehicle, to: toName }));
  // RIDE-UX: biniş kapı/portal kararmasıyla (kamera yürüyüş pozundan aracın tanıtım çekimine savrulmaz, kararma altında oturur);
  // kararma sürerken şehirden çıkılırsa ya da yolculuk iptal olursa başlamaz
  const seat = riderSeat(plan.kind, vehicleLook(plan.kind, v.city, lineId).form);
  const go = () => { if (useCity.getState().ride === ride && useCity.getState().view === v) startRide(plan, () => arrive(true), seat); };
  if (!transition(go)) go();
  return true;
}

/** RIDE-UX: "Durağa atla" — kararma altında yolculuk biter, avatar iniş durağında (hızlandırma yok; uzun yolculuğun kısayolu). */
export function skipRideToStop(): boolean {
  if (!useCity.getState().ride || !rideRuntime.ride) return false;
  return transition(() => { skipRide(); });
}

/** Ziyaret edilmiş duraklar (şehir sırası). */
export function visitedStops(map: CityMapFile, found: ReadonlySet<string>): string[] {
  return map.stops.filter((s) => found.has(stopId(map.id, s.id))).map((s) => s.id);
}

/** Hızlı seyahat: yalnız ziyaret edilmiş durağa (keşif teşvikini bozmamak için). */
export function fastTravel(stop: string): boolean {
  const s = useCity.getState();
  const v = s.view;
  if (!v || s.ride || !s.found.has(stopId(v.city, stop))) return false;
  const st = v.map.stops.find((x) => x.id === stop);
  // kilitli semte hızlı seyahat yok (sunucu aynı semtin damgasını 423 ile reddeder; hatla binişle aynı kural)
  if (st && isDistrictLocked(v.city, st.district)) { lockedNotice(v.city, st.district); return false; }
  const t = st ? stopTile(v.map, st) : null;
  if (!t) return false;
  return transition(() => {
    const sa = stopArrival(v.map, t); // ARRIVAL-QA: eskiden durak karosunda hep π; kamera eski yerin yaw'ında kalıyordu
    arriveAt(sa.tile, sa.heading, true, true);
    announceWalk(tx(CM, "fast_ann", { stop: stopName(v.city, stop) }));
  });
}

/**
 * Durağın hatları ve hedefleri (HUD). raylı hatta yalnız süre bandına (`RAIL_RIDE_BAND`) sığan yolculuklar sunulur.
 * o yönde sunulan hedeflerin HEPSİ kilitliyse (`isLocked`) o yöndeki ilk kilitsiz durak, bant dışı olsa da `far`
 * olarak sunulur; yoksa oyuncu kilitli semtlerin arasında mahsur kalırdı (Londra: tower_hill → yalnız kilitli komşu).
*/
export function stopLines(map: CityMapFile, stop: string, isLocked?: (stopId: string) => boolean) {
  return linesAt(map, stop).map((l) => {
    const to = l.stops.filter((x) => x !== stop && rideOffered(map, l, stop, x));
    const far: string[] = [];
    const at = l.stops.indexOf(stop);
    if (isLocked) {
      for (const dir of [-1, 1]) {
        const ahead: string[] = [];
        for (let k = at + dir; k >= 0 && k < l.stops.length; k += dir) ahead.push(l.stops[k]);
        if (ahead.some((x) => to.includes(x) && !isLocked(x))) continue;
        const x = ahead.find((y) => !isLocked(y) && !to.includes(y) && travelPlan(map, l.id, stop, y));
        if (x) far.push(x);
      }
    }
    const all = [...to, ...far].sort((a, b) => l.stops.indexOf(a) - l.stops.indexOf(b));
    return { line: l, vehicle: VEHICLES[l.kind], to: all, far };
  });
}

// ------------------------------------------------------------------------------------------ pasaport
let chain: Promise<unknown> = Promise.resolve();
const refused = new Set<string>();

/** Pasaport kaydı (iyimser, sıralı). Damga türünde tost + duyuru. Dönüş: istek başladı mı. */
export function visitCity(cityId: string, id: string): boolean {
  const s = useCity.getState();
  if (refused.has(id) || s.found.has(id) || !cityIds(cityId).includes(id)) return false;
  useCity.setState({ found: new Set([...s.found, id]) });
  const p = parseCityId(id);
  chain = chain.then(() => cityApi.visit(cityId, id).then((r) => {
    const viewOnly = r.admin || r.reason === "creative" || (!r.recorded && !r.already);
    if (viewOnly) refused.add(id);
    if (r.locked) setLocked(cityId, r.locked);
    if (r.lockedFor.length) useCity.setState((st) => ({ stale: { ...st.stale, [id]: r.lockedFor } }));
    for (const q of r.quests) {
      const t = tx(CM, "quest_done", { name: questName(cityId, q) });
      pushWalkToast({ kind: "visa", title: t });
      announceWalk(t);
    }
    if (!p || p.kind === "stop" || r.already) return;
    const nm = p.kind === "district" || p.kind === "vp" || p.kind === "gz" ? districtName(cityId, p.district!)
      : p.kind === "an" ? momentName(cityId, p.target!) : landmarkName(cityId, p.target!);
    const title = tx(CM, `stamp_${p.kind}` as "stamp_lm", { name: nm });
    pushWalkToast({ kind: "visa", title, text: viewOnly ? tx(CM, "stamp_view_only") : undefined });
    announceWalk(title);
  }).catch((e: unknown) => {
    const status = e instanceof CityApiError ? e.status : 0;
    // 409: zincir (semt damgası henüz yok) — yeniden denenebilir; 423: semt kilitli (açılınca yeniden); 429 geçici
    useCity.setState((st) => { const f = new Set(st.found); f.delete(id); return { found: f }; });
    if (status === 423 && p?.district) useCity.setState((st) => ({ locked: new Set([...st.locked, `${cityId}:${p.district}`]) }));
    if (status !== 409 && status !== 429 && status !== 423) refused.add(id);
  }));
  return true;
}

let inflight: Promise<void> | null = null;
export function loadCity(): Promise<void> {
  inflight = cityApi.state().then((v) => {
    const s = useCity.getState();
    const all = new Set(s.found);
    for (const c of Object.values(v.cities)) { for (const id of c.found) all.add(id); for (const id of c.stops) all.add(id); }
    const stale = Object.assign({}, ...Object.values(v.cities).map((c) => c.stale)) as Record<string, string[]>;
    const newIds = Object.values(v.cities).flatMap((c) => c.new_ids);
    useCity.setState({ loaded: true, found: all.size !== s.found.size ? all : s.found, stale, newIds: newIds.length ? newIds : EMPTY_LIST });
    for (const [id, c] of Object.entries(v.cities)) setLocked(id, c.locked);
  }).catch(() => { useCity.setState({ loaded: true }); }).finally(() => { inflight = null; });
  return inflight;
}
/** "yeni damga" bildirimini kapatır (sunucuda görülmüş sayılır; başarısızsa bir sonraki açılışta yeniden görünür).*/
export function ackNewStamps(city: string): void {
  useCity.setState((st) => ({ newIds: st.newIds.filter((id) => !id.startsWith(`city:${city}:`)) }));
  void cityApi.seen(city).catch(() => { /* bildirim yalnız bilgi; sonraki yüklemede tekrar */ });
}
export const ensureCity = () => inflight ?? (useCity.getState().loaded ? Promise.resolve() : loadCity());

/** Seyir noktası damgası (n: semtteki sıra, 1'den). */
export const visitViewpoint = (cityId: string, district: string, n: number) => visitCity(cityId, viewpointId(cityId, district, n));

// yürüme modu kapanınca şehir biter
if (typeof window !== "undefined") {
  useWalkStore.subscribe((s, prev) => { if (!s.active && prev.active) { resetCity(); if (useCity.getState().nearDoor) useCity.setState({ nearDoor: null }); } });
}

/** Denetim/geliştirme: avatarın şu anki şehir karosu. */
export function avatarCityTile(): CityTile {
  const a = walkRuntime.avatar;
  return [Math.floor(a.x + 12), Math.floor(a.z + 8)];
}

/** Ofisteki "Şehre çık" kapısının eylemi (CityDoorWatcher kaydeder; HUD düğmesi çağırır). */
export const cityDoor: { go: (() => void) | null } = { go: null };
