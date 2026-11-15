/**
 * WALK-EXPLORE — iç mekân durumu (zustand; seyrek) ve geçişler.
 *
 * - `useInterior`: içerideyken sahne, yer, kat dizini, kat ve çizim verisi (`view`: panorama + keşif parçalarıyla `Built`, ışık ve
 * gökyüzü tanımı). World.tsx Scene bu `view.built`'i sahnenin `built`'i yerine kullanır (ayrı örnek; dış model değişmez).
 * - Geçişler (kapı, merdiven, çıkış): kararma (200 ms) → kat değişimi → avatar varış karosuna (InteriorRig) → kamera oturunca
 * aydınlanma. `prefers-reduced-motion` açıkken kararma ve bekleme yok (anlık kesme).
 * - `interiorRuntime.outside`: içerideyken konum kaydı (lib/walk.ts) avatarın iç koordinatını değil kapının dışını yazar
 * (taban göreli). Yürüme modundan içeride çıkılırsa dış konuma dönülmüş sayılır.
 * Saf durum: three/React bileşeni yok.
*/
import { create } from "zustand";
import { currentLocale, tx as tr } from "../../lib/i18n";
import { explore as XM } from "../../locales/explore";
import { reducedMotion } from "../motion";
import { sceneDef, tx, tz, type Block, type Built, type SceneDef, type Tile } from "../scenes";
import { useWalkStore, walkRuntime } from "../walk/walkStore";
import { snapStairArrival } from "../walk/safeSpot";
import { interiorPlan, itemBlocks, levelSupport, panoramaBlocks, type InteriorLevel, type InteriorPlan, type LiftStop, type Portal, type StairLink } from "./generate";
import { scenePlaces, shift } from "./placement";
import { rayOpen, sceneSight, VIEW_DIRS } from "../walk/spawnView"; // ARRIVAL-QA: varış/dönüş yönü
import { deckOwnBlocks, towerDeckBlocks, towerDeckOf } from "./towerDeck";
import { cityPanoBlocks, levelHasGlow } from "./cityPano";
import { interiorRuntime } from "./runtime";
import { liftArrivalHeading } from "./liftPick"; // LIFTFLOOR
import { cityRuntime } from "../citymap/runtime";
import { arrivalFor, interiorRecord, recordDef, type InteriorSceneRecord } from "./sceneModel";
import { afterGate } from "../gateState";

export { interiorRuntime, interiorSavePose } from "./runtime";

export const FADE_MS = 200;
/** kat değişiminden sonra kameranın yeni yere oturma payı (takip kamerası yumuşatması) */
export const SETTLE_MS = 420;

/** INTERIOR-VIEW: `record` katın sahne kaydı (ışık ön ayarı, kamera kuralı, ses, mini harita, bütçe; sceneModel.ts). */
export interface InteriorView { key: string; built: Built; def: SceneDef; level: InteriorLevel; record: InteriorSceneRecord }
export interface Arrival {
  x: number; z: number; heading: number; token: number;
  /** "Ofise dön": doğma karosu (InteriorRig dış dünyadan hesaplar) */ home?: boolean;
  /** INTERIOR-VIEW merdiven geçişi: ayak y'si, dünya kayması; avatar durumu ve kamera sürer (kararma, ışınlama, unstick yok) */
  stair?: { y: number; dy: number };
  /** x/z dış dünyanın taban göreli konumu (InteriorRig bugünkü taban kaymasını ekler; şehirden ofise dönüş)*/
  rel?: boolean;
  /** varış duyurusu yok (çağıran kendi duyurusunu yapar)*/
  quiet?: boolean;
  /** ARRIVAL-QA: kamera bu yaw'a oturur (şehir landmark çıkışı) */
  aim?: number;
  /** asansör varışı (kapının önünden odaya ilerletilirken çıkış kapısının önüne bırakılmaz)*/
  lift?: boolean;
}

export interface InteriorState {
  scene: string | null;
  site: string | null;
  index: number;
  plan: InteriorPlan | null;
  view: InteriorView | null;
  /** kararma örtüsü (0 açık, 1 karanlık) */
  fade: 0 | 1;
  /** geçişin görünümü — "lift": asansör kapıları kapanır/açılır (hareket azaltmada yalnız saydamlık); null: iris*/
  fx?: "lift" | null;
  /** ( "metrodaki gibi bir efekt"): kapılar kapalıyken kabin yolculuğu — çıkış/hedef kat, süre (ms; ExploreHud `LiftDoors` gösterir)*/
  liftRide?: { from: number; to: number; ms: number } | null;
  /** bekleyen avatar yerleşimi (InteriorRig uygular) */
  arrival: Arrival | null;
  /** toplanmış keşif parçaları (çizimden düşer) */
  taken: ReadonlySet<string>;
  /** geçiş sürüyor (yeni geçiş başlamaz) */
  busy: boolean;
  /** INTERIOR-VIEW: dış dünya gece mi (pencere ışığı; InteriorRig `useSceneNight` ile yazar) */
  outsideNight: boolean;
}

const EMPTY: ReadonlySet<string> = new Set();
export const useInterior = create<InteriorState>(() => ({
  scene: null, site: null, index: 0, plan: null, view: null, fade: 0, arrival: null, taken: EMPTY, busy: false, outsideNight: false,
}));

let token = 0;
const viewCache = new Map<string, InteriorView>();

/** Kat + alınmış parçalar → çizim verisi (panorama ve parçalar bloklara katılır; +0 çizim çağrısı). */
export function levelView(level: InteriorLevel, taken: ReadonlySet<string>, night = useInterior.getState().outsideNight): InteriorView {
  const tk = level.spots.filter((s) => s.kind === "k" && taken.has(s.id)).map((s) => s.id).join(",");
  const key = `${level.key}|${tk}|${currentLocale()}|${night ? "n" : "d"}`;
  const hit = viewCache.get(key);
  if (hit) return hit;
  const items = itemBlocks(level, taken);
  // TOWER-GROUND-001: şehir iç mekânının açık hava katı (çan katı, güverte) da sokağa kadar kendi gövdesinin üstünde (önbellek dizisi değişmez)
  // şehir landmarkının yüksek açık hava katı gerçek simgenin ve gerçek şehrin (hi-res) üstünde — gri gövde ve silüet halkası yok
  const deck = towerDeckBlocks(level);
  // taban sahne kulesi de gerçek güvertede — orta LOD taban dünyası panoraması çizilmez
  const pano = deck.length ? [] : panoramaBlocks(level);
  // WORLD-PANO: şehir landmarkı katının silüet halkası (yalnız katın zaten kullandığı gruplar → +0 çizim çağrısı)
  const ring = cityPanoBlocks(level.cityPano, night, levelHasGlow(level));
  const city = deck.length ? deck : ring.length && !level.pano ? [...ring, ...levelSupport(level)] : ring;
  // tarifin kendi sahte manzarası (döşemenin altındaki su levhası ve uzak silüet kutuları, ör. ada kulesi `seaView`) gerçek şehirle çakışmasın
  // kat yüksekliğinin üstündeki kendi çatısı/kulübe tavanı da çizilmez — orayı simgenin kendi üst kısmı çizer (towerDeck.ts)
  const td = deck.length ? towerDeckOf(level) : null;
  const own = td ? deckOwnBlocks(level, td) : level.built.blocks; // aynı süzgeç towerDeck taşıyıcı denetiminde
  const blocks: Block[] = pano.length || items.length || city.length ? [...own, ...items, ...pano, ...city] : own;
  // mini harita oda adları (ModuleCell.label; MiniMap çeviri anahtarı bulamazsa metni olduğu gibi yazar)
  const modules = level.built.modules.map((m) => (m.label ? { ...m, label: tr(XM, m.label as "room_lobby") } : m));
  const built: Built = { ...level.built, blocks, modules };
  interiorBuilts.add(built);
  const base = sceneDef(level.scene);
  const record = interiorRecord(level, base, night);
  const view = { key, built, def: recordDef(record, base), level, record };
  if (viewCache.size > 24) viewCache.clear();
  viewCache.set(key, view);
  return view;
}

/** İç mekân çizim dünyaları (Yakındakiler'de pano/kahve gibi dış dünya nesneleri aranmaz). */
const interiorBuilts = new WeakSet<object>();
export const isInteriorBuilt = (b: object) => interiorBuilts.has(b);

const later = (ms: number, fn: () => void) => { if (ms <= 0) fn(); else window.setTimeout(fn, ms); };

function arriveAt(t: Tile, heading = Math.PI): Arrival {
  return { x: tx(t[0]), z: tz(t[1]), heading, token: ++token };
}

// ------------------------------------------------------------------------------------------ ARRIVAL-QA: varış ve dönüş yönleri
/** Bakış ışını (karo; 8 yönden en yakını). */
const rayAt = (sight: ReturnType<typeof sceneSight>, t: Tile, yaw: number) => rayOpen(sight, t, Math.round(Math.sin(yaw)), Math.round(Math.cos(yaw)));
/** En uzun görüşlü yön (eşitlikte `prefer`e en yakın). */
function openestYaw(sight: ReturnType<typeof sceneSight>, t: Tile, prefer: number): number {
  let best = prefer, bestRay = -1, bestOff = Infinity;
  for (const d of VIEW_DIRS) {
    const r = rayOpen(sight, t, d.di, d.dj), off = Math.abs(Math.atan2(Math.sin(d.yaw - prefer), Math.cos(d.yaw - prefer)));
    if (r > bestRay || (r === bestRay && off < bestOff)) { best = d.yaw; bestRay = r; bestOff = off; }
  }
  return best;
}
/** İç mekâna girişte avatar çıkış kapısına sırtını döner (portaldan varış karosuna); eskiden hep π — iskelede kapıya bakıyordu. */
export function exitHeading(p: Pick<Portal, "tile" | "arrive">): number {
  const dx = p.arrive[0] - p.tile[0], dz = p.arrive[1] - p.tile[1];
  // çapraz varış (otel lobisi: kapının yanından 2 karo içeri) baskın eksene bakar — odaya, yan duvara değil
  const ax = Math.abs(dx) > Math.abs(dz) ? Math.sign(dx) : 0, az = ax ? 0 : Math.sign(dz);
  return dx || dz ? Math.atan2(ax, az) : Math.PI;
}
/** Kat varışı (asansör/kat seçici): tercih (yukarı π, aşağı 0) en az 2 karo açıksa o; değilse en açık yön (duvara bakmaz). */
export function levelHeading(lv: Pick<InteriorLevel, "built">, t: Tile, up: boolean): number {
  const prefer = up ? Math.PI : 0;
  const sight = sceneSight(lv.built, t);
  return rayAt(sight, t, prefer) >= 2 ? prefer : openestYaw(sight, t, prefer);
}

/** Kararma → `swap` → (kamera oturunca) aydınlanma. Hareket azaltmada anlık. STUCK-FIX: "Takıldım" kurtarması da kullanır (walk/safeRescue.ts). */
// REVFIX1: kararma kilidi tek sahipli — iç mekân ve şehir geçişleri (citymap/store.ts) bu tek `transition`ı kullanır. Her kararmanın kuşağı
// (`fadeGen`) vardır: iptal edilen (cancelFade: "Ofise dön", yürüme modu kapandı) kararmanın bekleyen swap'ı ve aydınlanması çalışmaz.
// Eskiden zorla `busy: false` + yeni kararma → eskinin aydınlanması yenisinin swap'ından önce ekranı açıyor, ikinci ışınlama görünüyordu.
let fadeGen = 0;
export function transition(swap: () => void, fx: "lift" | null = null, hold = 0): boolean {
  const st = useInterior.getState();
  if (st.busy) return false;
  const gen = ++fadeGen, live = () => gen === fadeGen;
  // (ürün sahibi 2026-10-31 "metro gibi geçiş"): asansör kapıları kapanır (LIFT_MS), kat değişir, kapılar açılır; hareket azaltmada
  // anlık kesme değil yumuşak kararma (yalnız saydamlık, aynı süre)
  const lift = fx === "lift", instant = reducedMotion() && !lift;
  useInterior.setState({ busy: true, fade: instant || lift ? 0 : 1, fx });
  if (lift) later(30, () => { if (live()) useInterior.setState({ fade: 1 }); }); // kanatlar açık takılır, sonraki karede kapanmaya başlar
  later(instant ? 0 : lift ? LIFT_MS + 30 : FADE_MS, () => {
    if (!live()) return;
    try { swap(); } finally { // REVFIX1: swap hata atsa da kilit açılır (eskiden busy kalıcı true kalıyordu: F, kapı, durak kilitli)
      // kabin yolculuğu (`hold`) kapılar kapalıyken sürer; kamera bu sürede yeni kata oturur (dönüş/duvar geçişi görünmez)
      later(instant ? 0 : hold > SETTLE_MS ? hold : SETTLE_MS, () => afterGate(() => { // programlar hazır olunca aydınlan
        if (!live()) return;
        useInterior.setState({ fade: 0, busy: false, ...(lift ? {} : { fx: null }) });
        if (lift) later(LIFT_MS, () => { if (!useInterior.getState().busy) useInterior.setState({ fx: null, liftRide: null }); }); // kapılar açılırken görünüm sürer
      }));
    }
  });
  return true;
}
/** REVFIX1: süren kararmayı iptal et — bekleyen swap ve aydınlanması artık çalışmaz, kilit hemen açılır. */
export function cancelFade() {
  fadeGen++;
  useInterior.setState({ busy: false, fade: 0, liftRide: null });
}
/** REVFIX1: kararma sürüyor mu (F / Yakındakiler eylemleri o sırada başlamaz). */
export const fadeBusy = () => useInterior.getState().busy;
/** asansör kapılarının kapanma süresi (ms; ExploreHud `LiftDoors` aynı süreyle kayar).*/
export const LIFT_MS = 520;
/** kabin yolculuğu süresi (ms) — kat başına artar, üst sınırlı (metro yolculuk bandı gibi kısa; kat göstergesi bu sürede sayar).*/
export const LIFT_RIDE_BASE_MS = 700;
export const LIFT_RIDE_FLOOR_MS = 260;
export const LIFT_RIDE_MAX_MS = 1700;
export const liftRideMs = (from: number, to: number) => Math.min(LIFT_RIDE_MAX_MS, LIFT_RIDE_BASE_MS + LIFT_RIDE_FLOOR_MS * Math.abs(to - from));

/** Dış dünyadaki kapıdan içeri gir (kapı karosu tetikler ya da F). */
export function enterSite(scene: string, site: string): boolean {
  if (useInterior.getState().busy || interiorRuntime.inside) return false;
  const plan = interiorPlan(scene, site);
  const door = plan?.door;
  if (!plan || !door || !door.open) return false;
  const off = walkRuntime.baseOffset;
  const out = shift(door.out, off);
  // ARRIVAL-QA: kapıdan uzağa; InteriorRig dönüşte `framedReturn` ile ±90° içinde açık ve kadrajı temiz yönü seçer (kapıya dönmez)
  const away = Math.atan2(door.out[0] - door.tile[0], door.out[1] - door.tile[1]);
  interiorRuntime.outside = { x: tx(out[0]), z: tz(out[1]), heading: away, bx: tx(out[0]) - off[0], bz: tz(out[1]) - off[1] };
  interiorRuntime.inside = true;
  transition(() => {
    const lv = plan.levels[0];
    const exit = lv.portals.find((p) => p.to === "out");
    useWalkStore.getState().setTarget(null);
    useInterior.setState((s) => ({ scene, site, index: 0, plan, view: levelView(lv, s.taken), arrival: arriveAt(exit?.arrive ?? [1, 1], exit ? exitHeading(exit) : Math.PI) }));
  });
  return true;
}

/**
 * hazır bir iç mekân planına gir (şehir haritası landmarkı; `cityInteriorPlan`). `outside`: çıkışta dönülen dış poz
 * (şehir dünyası koordinatı). Kararma ve hareket azaltma `enterSite` ile aynı.
*/
export function enterPlan(scene: string, plan: InteriorPlan, outside: { x: number; z: number; heading: number; aim?: number }): boolean {
  if (useInterior.getState().busy || interiorRuntime.inside) return false;
  interiorRuntime.outside = { ...outside, bx: outside.x, bz: outside.z };
  interiorRuntime.inside = true;
  transition(() => {
    const lv = plan.levels[0];
    const exit = lv.portals.find((p) => p.to === "out");
    useWalkStore.getState().setTarget(null);
    useInterior.setState((s) => ({ scene, site: plan.site, index: 0, plan, view: levelView(lv, s.taken), arrival: arriveAt(exit?.arrive ?? [1, 1], exit ? exitHeading(exit) : Math.PI) }));
  });
  return true;
}

/**
 * iç mekân dışında bekleyen bir varış (InteriorRig, WalkRig'in taban kayması etkisinden SONRA uygular): şehirden ofise
 * dönüşte kapının önü (`rel`: taban göreli). İç mekân durumu hemen biter (kararma çağıranın).
*/
export function requestArrival(a: Omit<Arrival, "token">) {
  interiorRuntime.inside = false;
  interiorRuntime.outside = null;
  useInterior.setState({ scene: null, site: null, index: 0, plan: null, view: null, arrival: { ...a, token: ++token } }); // REVFIX1: kilidi çağıranın kararması açar (eskiden burada açılıyor, aydınlanma süresinde ikinci geçiş başlıyordu)
}

/** Kat değiştir (merdiven portalı). */
export function goLevel(to: number): boolean {
  const s = useInterior.getState();
  if (!s.plan || s.busy) return false;
  const from = s.index;
  const lv = s.plan.levels[to];
  if (!lv) return false;
  if (to === from) return false;
  transition(() => {
    // INTERIOR-VIEW: merdiven ve kat seçici (asansör) aynı varışı kullanır: komşu kat portalı, yoksa en yakın kat, yoksa çıkış
    const back = arrivalFor(s.plan!.levels, from, to);
    useWalkStore.getState().setTarget(null);
    useInterior.setState((st) => ({ index: to, view: levelView(lv, st.taken), arrival: arriveAt(back ?? [1, 1], back ? levelHeading(lv, back, to > from) : to > from ? Math.PI : 0) }));
  });
  return true;
}

/**
 * asansörle kat değişimi (F asansör kapısının önünde): kararma → hedef kattaki karşılık kapının önüne varış, kapıya sırtı
 * dönük (`LiftStop.heading`). Varış InteriorRig'in iç mekân varış kuralından geçer (kapının önünden odaya en çok birkaç karo).
*/
export function rideLift(stop: LiftStop): boolean {
  const s = useInterior.getState();
  if (!s.plan || s.busy) return false;
  const lv = s.plan.levels[stop.to];
  if (!lv || stop.to === s.index) return false;
  const ride = { from: s.index, to: stop.to, ms: liftRideMs(s.index, stop.to) };
  const ok = transition(() => {
    useWalkStore.getState().setTarget(null);
    useInterior.setState((st) => ({ index: stop.to, view: levelView(lv, st.taken), arrival: { ...arriveAt(stop.toTile, liftArrivalHeading(lv, stop)), lift: true } })); // LIFTFLOOR: seyir katında bakış manzaraya
  }, "lift", ride.ms);
  if (ok) useInterior.setState({ liftRide: ride });
  return ok;
}

/**
 * kat seçimi her yerden asansörle — bu katın `to` katına giden, avatara en yakın asansör durağıyla `rideLift`
 * (kapılar kapanır, kabin yolculuğu, hedef katın asansör kapısının önüne varış). Asansörsüz kat atlama (`goLevel`) arayüzde yok.
*/
export function liftTo(to: number): boolean {
  const lv = useInterior.getState().view?.level;
  if (!lv) return false;
  const a = walkRuntime.avatar, d = (l: LiftStop) => Math.hypot(tx(l.tile[0]) - a.x, tz(l.tile[1]) - a.z);
  const stop = lv.lifts.filter((l) => l.to === to).sort((x, y) => d(x) - d(y))[0];
  return !!stop && rideLift(stop);
}

/**
 * INTERIOR-VIEW — merdivenle kat değişimi: avatar alt katta son basamağa çıktı (ya da üst katta boşluğun ağzına adım attı).
 * Aynı x/z'de, y = bağın hedef yüksekliği; dünya `dy` kadar kayar (kamera ve çizim yüksekliği WalkRig'de aynı kayma ile sürer).
 * Kararma yok, `busy` yok (yürüyüş kesilmez); hareket azaltmada da aynı (zaten anlık).
 */
export function stairSwap(link: StairLink): boolean {
  const s = useInterior.getState();
  if (!s.plan || s.busy) return false;
  const lv = s.plan.levels[link.to];
  if (!lv) return false;
  const a = walkRuntime.avatar;
  // STUCK-FIX: varış merdiven hattının ortasına çekilir (yanlamasına kenarda açık zemine düşülmez; walk/safeSpot.ts)
  const p = snapStairArrival(link, a.x, a.z);
  useInterior.setState((st) => ({ index: link.to, view: levelView(lv, st.taken),
    arrival: { x: p.x, z: p.z, heading: a.heading, token: ++token, stair: { y: link.y, dy: link.dy } } }));
  return true;
}

/** Dışarı çık: kapının dışına (ya da `home` ile doğma karosuna — "Ofise dön"). */
export function leaveInterior(home = false): boolean {
  const s = useInterior.getState();
  if (!s.plan || s.busy) return false;
  // şehir haritasındaki landmarktan "Ofise dön" — şehir kipi de biter (citymap/store.ts)
  if (home && cityRuntime.active && cityRuntime.exit) { cityRuntime.exit(); return true; }
  const o = interiorRuntime.outside;
  transition(() => {
    interiorRuntime.inside = false;
    useWalkStore.getState().setTarget(null);
    const a: Arrival = o && !home ? { x: o.x, z: o.z, heading: o.heading, token: ++token, ...(o.aim !== undefined ? { aim: o.aim } : {}) } : { x: 0, z: 0, heading: Math.PI, token: ++token, home: true };
    useInterior.setState({ scene: null, site: null, index: 0, plan: null, view: null, arrival: a });
  });
  return true;
}

/** Yürüme modu kapandı ya da sahne değişti: iç mekân hemen biter (kararma yok). Konum kaydı bu karede dış pozu yazar. */
export function resetInterior() {
  if (!interiorRuntime.inside && !useInterior.getState().view) return;
  // abonelikler (lib/walk.ts konum kaydı) bu olayı aynı anda işler: dış poz bir mikro görev sonra silinir
  queueMicrotask(() => {
    interiorRuntime.inside = false;
    interiorRuntime.outside = null;
    useInterior.setState({ scene: null, site: null, index: 0, plan: null, view: null, arrival: null, fade: 0, busy: false });
  });
}

/** Keşif parçası alındı: çizimden düşer. */
export function markTaken(id: string) {
  const s = useInterior.getState();
  if (s.taken.has(id)) return;
  const taken = new Set([...s.taken, id]);
  useInterior.setState({ taken, view: s.view ? levelView(s.view.level, taken) : null });
}
/** Sunucudan gelen alınmış parçalar (yükleme). */
export function setTaken(ids: Iterable<string>) {
  const taken = new Set([...useInterior.getState().taken, ...ids]);
  if (taken.size === useInterior.getState().taken.size) return;
  const s = useInterior.getState();
  useInterior.setState({ taken, view: s.view ? levelView(s.view.level, taken) : null });
}

/** INTERIOR-VIEW: dış dünyanın gece/gündüz durumu değişti → pencere ışığı (aynı kat, yeni sahne kaydı; kararma yok). */
export function setOutsideNight(night: boolean) {
  const s = useInterior.getState();
  if (s.outsideNight === night) return;
  useInterior.setState({ outsideNight: night, view: s.view ? levelView(s.view.level, s.taken, night) : null });
}

/** Sahnenin açık kapıları (dünya ızgarasına kaydırılmış). */
export function doorsInWorld(scene: string, off: Tile) {
  return scenePlaces(scene).doors.filter((d) => d.open).map((d) => ({ door: d, tile: shift(d.tile, off) }));
}

// yürüme modu kapanınca iç mekân biter
if (typeof window !== "undefined") {
  useWalkStore.subscribe((s, prev) => { if (!s.active && prev.active) { if (useInterior.getState().busy) cancelFade(); resetInterior(); } }); // REVFIX1: bekleyen geçiş (şehre giriş vb.) mod kapandıktan sonra çalışmaz
}
