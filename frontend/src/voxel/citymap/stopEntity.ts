/**
 * UXF-E — ulaşım durakları keşfedilebilir: durak paneli yalnız durağın TAM karosunda açılıyordu, duraklar Yakındakiler'de
 * yoktu, "F:" ipucu çıkmıyordu (denetim: tramvay yalnız "Hızlı seyahat" ile, vapur hiç denenemedi). Şimdi:
 * - Şehir haritasının her açık (kilitsiz) durağı Yakındakiler'de ("Yapılacak": `citystop:<şehir>:<durak>`, adı "Durak: …");
 * varışa en yakın `FAR_STOPS` yürünebilir durak yarıçaptan bağımsız listelenir ("Git": listeden seçince avatar yürür);
 * - F menzilinde durak ipucu çıkar; F (ya da seçip varınca) panel açılır;
 * - biniş paneli durağın karosuna ve 8 komşusuna (`STOP_TOLERANCE`) yaklaşınca açılır (CityRig `onTile`).
 * Saf çekirdek (`stopRows`, `nearestWalkableStops`, `stopWithin`) React/three/depo olmadan test edilir; `cityStopEntities` depoyu okur.
*/
import { cityX, cityZ } from "../transit/model";
import type { ProxEntity } from "../walk/controller";
import { useWalkStore, walkRuntime } from "../walk/walkStore";
import { walkCamera } from "../walk/cameraRule"; // HQA-FIX
import { districtPlan, walkableKind } from "./district";
import { stopBoard, stopTile, type CityMapFile, type CityTile } from "./format";
import { GATE_ARRIVE, gateBuilt } from "./shell";
import { onTrack } from "./trackBand";
import { arriveAt, isDistrictLocked, stopArrival, transition, useCity, visitCity } from "./store"; // stopArrival; ROUTE1: arriveAt, transition
import { stopId } from "./catalog";

export const CITY_STOP_PREFIX = "citystop:";
export const isCityStopId = (id: string) => id.startsWith(CITY_STOP_PREFIX);
/** `citystop:<şehir>:<durak>` → [şehir, durak]; değilse null. */
export function parseCityStopId(id: string): [string, string] | null {
  if (!isCityStopId(id)) return null;
  const rest = id.slice(CITY_STOP_PREFIX.length), k = rest.indexOf(":");
  return k > 0 && k < rest.length - 1 ? [rest.slice(0, k), rest.slice(k + 1)] : null;
}

/** Biniş paneli durağın bu Chebyshev uzaklığındaki karolardan açılır (0 = yalnız tam karo; eskiden 0). */
export const STOP_TOLERANCE = 1;
/** Girişe/avatara en yakın bu kadar yürünebilir durak yarıçap dışında da Yakındakiler'dedir. */
export const FAR_STOPS = 2;

export const stopWithin = (stop: CityTile, t: readonly [number, number], tol = STOP_TOLERANCE) =>
  Math.max(Math.abs(stop[0] - t[0]), Math.abs(stop[1] - t[1])) <= tol;

/** CABLEVP1: panelin açıldığı merkez — durağın biniş platformu (`CityStop.board`; teleferik uç durağı) varsa o, yoksa durak karosu.*/
export function stopCenter(map: CityMapFile, stop: CityTile): CityTile {
  const s = map.stops.find((x) => x.board && stopTile(map, x)?.join() === stop.join());
  return (s && stopBoard(map, s)) || stop;
}

const stopReachCache = new WeakMap<CityMapFile, Map<string, number>>();
/**
 * durağın panel erişimi — doğrulanmış varış karosu (`stopArrival`) tolerans halkasının dışındaysa (<city> sahil kulesi: halkanın
 * bütün karoları ayak/direkle dolu) panel o karoya dek (≤ 2) açılır; böylece panel HER ZAMAN doğrulanmış pozdan kurulabilir.
*/
export function stopReach(map: CityMapFile, stop: CityTile): number {
  let m = stopReachCache.get(map);
  if (!m) stopReachCache.set(map, (m = new Map()));
  const k = `${stop[0]},${stop[1]}`;
  let r = m.get(k);
  if (r === undefined) { const h = stopArrival(map, stop).tile, c = stopCenter(map, stop); r = Math.max(STOP_TOLERANCE, Math.abs(h[0] - c[0]), Math.abs(h[1] - c[1])); m.set(k, r); } // CABLEVP1: platformdan
  return r;
}

/** HQA-FIX: kamerayı durağa bakan yöne çevir (WalkRig `clearAimYaw` kolu açık en yakın yaw'ı seçer).*/
export function aimAtStop(stop: CityTile, map?: CityMapFile, at?: CityTile): void {
  // harita verilirse kamera durağın DOĞRULANMIŞ varış yönüne (`stopArrival`; arrival_check bu karelerden geçer) oturur
  // yön yalnız varış karosunda (`at` verilmişse) tam uygulanır; halkanın başka karosunda kol turnikeye/cepheye çarpabilir → `clearAimYaw`
  if (map) { const h = stopArrival(map, stop); walkCamera.aim = h.heading; walkCamera.aimExact = !at || (at[0] === h.tile[0] && at[1] === h.tile[1]); return; }
  const av = walkRuntime.avatar, sx = cityX(stop[0]) - av.x, sz = cityZ(stop[1]) - av.z;
  walkCamera.aim = Math.hypot(sx, sz) > 0.3 ? Math.atan2(sx, sz) : av.heading;
}
/**
 * F ile durak paneli açılırken avatar + kamera durumu (saf; arrival_check `stop-panel` kapısı aynısını ölçer).
 * Kök neden: panel, avatar durağın 3×3 tolerans karolarından HERHANGİ birindeyken açılıyor, kamera o karodan durağa dönüyordu; durağın
 * arkasındaki/yanındaki karolar (turnike, direk, kapı kolu) kareyi doldurur ya da kamerayı avatarın başına indirirdi (<city>, <city>,
 * <city> panel kareleri); yalnız VARIŞ karesi ölçülüyordu. Şimdi: panel doğrulanmış varış karosundan (`stopArrival`) ve yönüyle kurulur;
 * avatar başka karodaysa o karoya (≤ 1 adım) yürür; varış karosu tolerans dışındaysa (<city> teleferik zirvesi) olduğu yerde kalır.
*/
export function panelPose(map: CityMapFile, stop: CityTile, at: CityTile): { tile: CityTile; aim: number; walk: boolean; hop: boolean; crossesRail: boolean } {
  // `stopReach` varış karosu uzaklığından küçük olamaz → "olduğu yerde kal" dalı ölüydü (ok/exact hep true); kaldırıldı
  const home = stopArrival(map, stop);
  // ROUTE1: 4 komşulu rota (controller planRoute) Manhattan ≥ 2'de ara karodan geçer; o karolarda takip kamerası duvara/kite bakıyordu
  // (311 rota anahtarı) → yürünmez, kararma altında sıçranır (`hop`). Tek karoluk düz adımda ara karo yok, yürünür.
  const steps = Math.abs(home.tile[0] - at[0]) + Math.abs(home.tile[1] - at[1]);
  // yürüyüş rayın/araç gövdesinin üstünden geçecekse (4 komşulu iki L rotası ya da Chebyshev adımları) avatar ASLA yürümez:
  // kararma altında sıçrar; kararma meşgulse boşalınca yeniden denenir (`openCityStop`)
  const [hx, hz] = home.tile;
  const track = (i: number, j: number) => (i !== hx || j !== hz) && (i !== at[0] || j !== at[1]) && onTrack(map, i, j);
  let crossesRail = false;
  for (let k = 0, cur: CityTile = at; k < 4 && (cur[0] !== hx || cur[1] !== hz); k++) { cur = [cur[0] + Math.sign(hx - cur[0]), cur[1] + Math.sign(hz - cur[1])]; if (track(cur[0], cur[1])) crossesRail = true; }
  for (let i = Math.min(at[0], hx); i <= Math.max(at[0], hx); i++) { if (track(i, at[1]) || track(i, hz)) crossesRail = true; }
  for (let j = Math.min(at[1], hz); j <= Math.max(at[1], hz); j++) { if (track(at[0], j) || track(hx, j)) crossesRail = true; }
  return { tile: home.tile, aim: home.heading, walk: steps > 0, hop: steps > 1, crossesRail: crossesRail && steps > 1 };
}

/**
 * avatar durağın tolerans karosuna girdi — tıkla-git VARIŞI mı (rota durakta bitiyor)? Başka yere giden rota durağın
 * yanından geçiyorsa ya da oyuncu WASD ile yürüyorsa (rota yok; kamera çevrilirse yürüme yönü de döner) kamera çevrilmez. Saf.
*/
export function stopArrivalAim(stop: CityTile, route: readonly (readonly [number, number])[] | null | undefined, reach = STOP_TOLERANCE): boolean {
  return !!route?.length && stopWithin(stop, route[route.length - 1], reach); // erişim 2 olan duraklar (teleferik zirvesi) da döner
}

export interface StopRow { id: string; stop: string; district: string; tile: CityTile }

/** Haritanın durakları (şehir karosu); semti kilitli olanlar `locked` ile elenir. */
export function stopRows(map: CityMapFile, locked: (district: string) => boolean = () => false): StopRow[] {
  const out: StopRow[] = [];
  for (const s of map.stops) {
    const tile = stopTile(map, s);
    if (!tile || locked(s.district)) continue;
    out.push({ id: `${CITY_STOP_PREFIX}${map.id}:${s.id}`, stop: s.id, district: s.district, tile });
  }
  return out;
}

const reachCache = new WeakMap<CityMapFile, Set<string>>();
const key = (i: number, j: number) => `${i},${j}`;
/** Varış meydanından YÜRÜYEREK bağlı karolar (ulaşım hattı sayılmaz): ada ve karşı kıyı durakları yürümeyle gösterilmez. */
function walkReach(map: CityMapFile): Set<string> {
  let seen = reachCache.get(map);
  if (seen) return seen;
  const walk = new Set<string>();
  const gate = gateBuilt(map);
  for (let j = 0; j < gate.depth; j++) for (let i = 0; i < gate.width; i++) if (!gate.blocked.has(key(i, j))) walk.add(key(i, j));
  for (const d of map.districts) {
    const p = districtPlan(map, d);
    for (let lj = 0; lj < p.d; lj++) for (let li = 0; li < p.w; li++) if (walkableKind(p.kind[lj * p.w + li])) walk.add(key(p.i0 + li, p.j0 + lj));
  }
  seen = new Set<string>([key(GATE_ARRIVE[0], GATE_ARRIVE[1])]);
  const q: CityTile[] = [GATE_ARRIVE];
  for (let h = 0; h < q.length; h++) {
    const [i, j] = q[h];
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = key(i + a, j + b);
      if (!seen.has(k) && walk.has(k)) { seen.add(k); q.push([i + a, j + b]); }
    }
  }
  reachCache.set(map, seen);
  return seen;
}

/** Avatara (x, z) en yakın `n` yürünebilir durak (kimlik kümesi). */
export function nearestWalkableStops(map: CityMapFile, rows: readonly StopRow[], x: number, z: number, n = FAR_STOPS): Set<string> {
  const reach = walkReach(map);
  const ok = rows.filter((r) => reach.has(key(r.tile[0], r.tile[1])))
    .map((r) => ({ id: r.id, d: Math.hypot(cityX(r.tile[0]) - x, cityZ(r.tile[1]) - z) }))
    .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
  return new Set(ok.slice(0, n).map((r) => r.id));
}

// ------------------------------------------------------------------------------------------ canlı varlıklar
interface Pool { map: CityMapFile; rows: StopRow[]; ents: ProxEntity[]; lockSig: string }
let pool: Pool | null = null;
const NONE: readonly ProxEntity[] = Object.freeze([]) as readonly ProxEntity[];

/** Yakındakiler girdileri (şehir haritası yokken boş). `far`: avatara en yakın yürünebilir `FAR_STOPS` durak. */
export function cityStopEntities(): readonly ProxEntity[] {
  const st = useCity.getState();
  const v = st.view;
  if (!v) { pool = null; return NONE; }
  const lockSig = [...st.locked].filter((k) => k.startsWith(`${v.city}:`)).sort().join("|");
  if (!pool || pool.map !== v.map || pool.lockSig !== lockSig) {
    const rows = stopRows(v.map, (d) => isDistrictLocked(v.city, d));
    pool = { map: v.map, rows, lockSig, ents: rows.map((r) => { const c = stopCenter(v.map, r.tile); return { id: r.id, kind: "prop", x: cityX(c[0]), z: cityZ(c[1]), far: false }; }) }; // CABLEVP1: F menzili biniş platformunda
  }
  if (!pool.ents.length) return NONE;
  const a = walkRuntime.avatar;
  const near = nearestWalkableStops(pool.map, pool.rows, a.x, a.z);
  for (const e of pool.ents) e.far = near.has(e.id);
  return pool.ents;
}

let panelArrival: { stop: string; tile: CityTile } | null = null;
/** ARR-A: panel yürüyüşü varış karosuna ulaştı mı (CityRig onTile)? Evet → tam yön bir kez uygulanır; durak değişince bekleyen varış düşer. */
export function takePanelArrival(stop: string | undefined, t: CityTile, route?: readonly (readonly [number, number])[] | null): boolean {
  const p = panelArrival;
  if (!p) return false;
  // yürüyüş kesildi (WASD / yeni hedef: rota yok ya da başka yerde biter) ya da durak değişti → bekleyen varış düşer (oyuncu açısı ezilmez)
  const end = route?.length ? route[route.length - 1] : null;
  if (stop !== p.stop || !end || end[0] !== p.tile[0] || end[1] !== p.tile[1]) { panelArrival = null; return false; }
  if (t[0] !== p.tile[0] || t[1] !== p.tile[1]) return false;
  panelArrival = null;
  return true;
}
/** Panel kapandı (Esc / ✕): bekleyen varış yönü düşer. */
export function clearPanelArrival(): void { panelArrival = null; }

/** Yakındakiler satırı/F: avatar durağın tolerans karosundaysa paneli açar ve damga kaydeder; değilse durağın karosuna yürür. */
export function openCityStop(id: string): boolean { return openCityStopAt(id, 0); }
function openCityStopAt(id: string, attempt: number): boolean {
  const p = parseCityStopId(id);
  const v = useCity.getState().view;
  if (!p || !v || p[0] !== v.city) return false;
  const row = stopRows(v.map).find((r) => r.stop === p[1]);
  if (!row) return false;
  const pose = useWalkStore.getState().pose;
  if (pose && stopWithin(stopCenter(v.map, row.tile), pose.tile, stopReach(v.map, row.tile))) {
    // HQA-FIX: durak paneli açılınca kamera durağa bakan, kolu açık bir yaw'a oturur (WalkRig `clearAimYaw`); eskiden
    // yürüyüşün son yaw'ında kalıyor, saçak/turnike kolu çökertiyor, kare avatarın saçıyla doluyordu
    const pp = panelPose(v.map, row.tile, pose.tile);
    // ROUTE1: ara karolu yürüyüş yerine kararma altında varış karosu + tam yön (hızlı seyahatle aynı kesme; hareket azaltmada anlık).
    // Kararma meşgulse (başka geçiş) eski yürüyüşe düşer.
    if (pp.hop) {
      // sıçrayışta kamera varış yönüne kararma altında oturmaz (kararma kalkınca 73–163° dönmüş görünüyordu) — devirle döner
      if (transition(() => { arriveAt(pp.tile, pp.aim); walkCamera.aim = pp.aim; walkCamera.aimExact = true; walkCamera.aimHand = true; })) {
        panelArrival = null;
        useWalkStore.getState().setTarget(null);
        useCity.setState({ stop: row.stop, stopPanel: true });
        visitCity(v.city, stopId(v.city, row.stop));
        return true;
      }
      // kararma meşgul ve yürüyüş rayı çaprazlayacak — avatar rayda yürümez; kararma boşalınca yeniden dene (≤ 25 × 200 ms)
      if (pp.crossesRail) {
        if (attempt < 25) setTimeout(() => { if (useCity.getState().view === v) openCityStopAt(id, attempt + 1); }, 200);
        return true;
      }
    }
    // ARR-A: avatar yürüyecekse yön önceden SET EDİLMEZ (rota karolarında kamera yanlış duruyordu: 794/813 bulgu); rota izleme kamerası (routeCam)
    // arkadan sürer, tam yaw varış karosunda `takePanelArrival` → CityRig onTile → aimAtStop ile uygulanır. Yürüme yoksa (zaten varış karosu) şimdi uygulanır.
    panelArrival = pp.walk ? { stop: row.stop, tile: pp.tile } : null;
    if (!pp.walk) { walkCamera.aim = pp.aim; walkCamera.aimExact = true; }
    // HQA-FIX: panel açıldı — "git ve aç" yürüyüşü durağın turnike karosuna dek sürmez (kol turnike direklerine çarpıp başa düşüyordu)
    // yalnız doğrulanmış varış karosuna (≤ 1 adım) yürünür
    useWalkStore.getState().setTarget(pp.walk ? pp.tile : null);
    useCity.setState({ stop: row.stop, stopPanel: true }); // istenen açılış (F / liste)
    visitCity(v.city, stopId(v.city, row.stop));
    return true;
  }
  // durağın kendi karosu (saçak/çatı altı, tabela direği) yerine panelin açıldığı en açık komşu karoya yürünür —
  // kamera durak çatısının altına girmez (`stopArrival`: ölçülmüş poz ya da bakış ışını + açıklık)
  const near = stopArrival(v.map, row.tile).tile;
  useWalkStore.getState().setTarget(stopWithin(stopCenter(v.map, row.tile), near, stopReach(v.map, row.tile)) ? near : row.tile);
  return true;
}
