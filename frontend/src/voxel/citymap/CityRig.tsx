/**
 * şehir haritası düzeneği (Canvas içinde; hiçbir şey çizmez, +0 çizim çağrısı). World.tsx şehir kipinde WalkRig ve
 * InteriorRig'den SONRA bağlar (varış, taban kayması ve iç mekân çıkışı etkilerinden sonra uygulanır).
 *
 * - **Semt akışı:** `cityStream` (E1b yuva çekirdeği, CITY_LAYOUT) avatarın çevresindeki parselleri (yakın 3 × 3, uzak 5 × 5)
 * varış meydanının kapasite kuyruğuna yazar (`expanse/tail.ts`). Uzak semtler bırakılır; ofis tabanı çizilmez.
 * - **Çarpışma:** yakın parseller `physics/world.ts` çevre ızgarasına, ızgara `navGrid(meydan).outer`'a (controller sınırı,
 * tıkla-git, yükseklik). İç mekândayken (`paused`) akış durur ama ızgara bağlı kalır: çıkışta varış karosu çözülebilir.
 * - **Varış:** `useCity.arrival` (giriş, ışınlama, hızlı seyahat, hareket azaltmada doğrudan iniş) — avatar karoya, yakın halka
 * aynı karede dolar.
 * - **Kamera** (`walk/cameraRule.ts`): sokakta üçüncü şahıs + otomatik kesit (`street`); seyir noktasında birinci şahıs (`deck`).
 * - **Tetikleyiciler** (karo değişince): semt (damga + duyuru), landmark yakınlığı (≤ 2 karo; damga), girilebilir landmark kapısı
 * (iç mekân sahne modeli `cityInteriorPlan`), durak (kayıt + HUD), seyir noktası, meydandaki "Ofise dön" kapısı.
 * - **Yolculuk:** aracın blokları kuyruğun araç bölgesine (`layoutEnd` → `+ VEHICLE_SLOT`) her kare yazılır (+0 çizim).
 * - **WORLD-PANO ortam taksileri** (<city>, <city>; `taxi.ts`): araç bölgesinden sonraki `TAXI_SLOT` aralığına en yakın
 * `TAXI_MAX` taksi yazılır (+0 çizim); semt döngüsü kare başına en çok bir semt hesaplanır; hareket azaltmada saat durur.
 * - ** canlı katman** (`live.ts`): binilmeyen hat araçları (vapur, kayık, teleferik, monoray, balon), martı/güvercin sürüleri
 * ve süzülen balonlar kuyruğa YAZILMAZ; tek örneklenmiş dizide çizilir (görünür bir şey varken +1 çizim çağrısı, yokken dizi gizli;
 * gölgesiz). Yüklü parsel kümesine uyar; binilen hattın aracı ve binilen araca/avatara değen hareketli o karede çizilmez; iç
 * mekânda gizli; hareket azaltmada saat durur, sürü yok; gece sürüler ve balonlar gizli, cam ve far yanar.
 * - **** kilitli semte yürüyerek girilmez (son açık karoya geri + tost); gizli köşe karosu (damga); seyir noktasında zamanlı
 * an (Kız Kulesi'nden gün batımı: akşam saatleri ya da kullanıcının seçtiği gece ışığı — süresiz, FOMO yok).
 * - Geliştirme kancası `window.__voxcrewCity` (yalnız DEV): durum, ışınla, bin, çık — ekran görüntüsü ve canlı denetim.
 *
 * `CityDoorWatcher`: ofis tabanında (şehir dışı) "Şehre çık" kapısının yakınlığı (HUD) ve kapıya basınca giriş; kapı karosunda
 * ışınlanma halkası (`PortalRing`). CityRig "Ofise dön" kapısına geri dönüş halkasını çizer (CORE-WALK).
*/
import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { outerGrid, setOuterParcels, type OuterGrid } from "../physics/world";
import { tx, tz, type Block, type Built, type Tile } from "../scenes";
import { CITY_LAYOUT, layoutEnd, slotOffsetIn, TAIL_GROUPS, tailEndIn, type SlotWrite, type TailGroup } from "../expanse/stream";
import { releaseTail, setTailEnd, tailVersion, writeTail } from "../expanse/tail";
import { pkey } from "../expanse/grid";
import { cityInteriorPlan } from "../interiors/generate";
import { enterPlan, useInterior } from "../interiors/store";
import { interiorRuntime } from "../interiors/runtime";
import { DECK_RULE, setWalkCameraRule, STREET_RULE, walkCamera } from "../walk/cameraRule";
import { baseOffset, clearOfGates, createAvatar, navGrid, PORTAL_CLEAR, routeClosed, unstick } from "../walk/controller";
import { useWalkStore, walkRuntime, type WalkView } from "../walk/walkStore";
import { deckFadeLeave, deckViewStep } from "./deckView";
import { rideRuntime } from "../transit/ride";
import { vehicleAt } from "../transit/rideCam";
import { reducedMotion } from "../motion";
import { TAXI_SLOT, TAXI_STYLES, taxiClock, taxiFrame, taxiLoops } from "./taxi";
import { liveCapacity, liveClock, liveFrame, liveRoster, type LiveDraw, type LiveRole } from "./live";
import { ritualFx } from "../fun/ritualRuntime";
import { districtId, hiddenId, landmarkId, momentId, stopId } from "./catalog";
import { designOf } from "./designs";
import { CITY_PD, CITY_PW, districtAt, type CityMapFile } from "./format";
import { districtPlan } from "./district";
import { officeDoor } from "./door";
import { landmarkExit } from "./doorExit"; // ARRIVAL-QA
import { arrivalHidesRing, citySight, RING_HOLD_D } from "./arrivalView"; // ARRIVAL-QA;
import { bindCityDoor, cityGateRuntime, clearPortalIntent, doorIntended, goPortal, portalArmed, portalIntent } from "./doorEntity";
import { cityTriggerTiles } from "../walk/routeAvoid"; // PORTAL-INTENT-001
import { aimAtStop, stopArrivalAim, stopCenter, stopReach, stopWithin, takePanelArrival } from "./stopEntity"; // aimAtStop, stopArrivalAim
import { GATE_ARRIVE, GATE_RETURN } from "./shell";
import { PortalRing } from "./PortalRing";
import { aimAtViewpoint, vpReaim } from "./vpAim";
import { AIM_TURN_KEY, cancelViewTurn } from "../walk/viewTurn"; // durak yön dönüşünü kesmez
import { CityFauna } from "./CityFauna"; // CITY-FAUNA
import { useLightMode } from "../props/daynight";
import { CITY_ARRIVAL_BUDGET, cityStream, loadedDistricts, rideGenBudget, VEHICLE_SLOT, type CityStream } from "./source";
import { arriveAt, boardLine, cityDoor, citySiteId, districtName, enterCity, exitCity, fastTravel, isDistrictLocked, lockedNotice, setLightMode, sunsetNow, useCity, visitCity, visitViewpoint, type CityView } from "./store";
import { announceWalk } from "../../components/world/walk/announce";
import { cityLifeRuntime } from "../citylife/runtime";
// TOUR-VIEW: silüet/ufuk katmanı, öne kayan akış halkası (pop-in yok; F1)
import { HorizonLayer, tourRuntime } from "./HorizonLayer";
import { HiResCityLayer } from "../hires/HiResLayer"; // LANDMARK-HIRES
import { landmarkView, useLandmarkView } from "../walk/landmarkView";
import { cityX, cityZ } from "../transit/model";
import { leadPoint, stepLeadState } from "./viewDistance";
import { prewarmCity } from "./prewarm";
import { arrivalHold } from "../gateState"; // PORTAL-ARRIVAL-COMPLETE-001



interface Run {
  stream: CityStream | null;
  /** son parsel üretiminden bu yana (sn)*/
  sinceGen: number;
  grid: OuterGrid | null;
  nearV: number;
  tailV: number;
  /** araç bölgesi yazılı mı */
  veh: boolean;
  ms: number;
  dropped: number;
  tile: string;
  district: string | null | undefined;
  /** seyir noktasına girerken saklanan görünüm (çıkınca geri) */
  deckView: WalkView | null;
  applied: number;
  /** son karede yolculuk sürüyordu (iniş karesinde tetikleyiciler yeniden değerlendirilir) */
  riding: boolean;
  /** tıkla-git uzun hedefi (yakın halkanın dışında): rota halka kenarında biterse yeni halkada yeniden planlanır */
  goal: Tile | null;
  goalV: number;
  replans: number;
  /** son açık (kilitsiz) karo — kilitli semte adım atınca geri dönülür*/
  lastOk: Tile | null;
  /** seyir noktasında an denetimi (semt, seyir sırası) ve son denetim zamanı*/
  vp: { district: string; n: number } | null;
  vpAt: number;
  /** WORLD-PANO taksileri: saat (sn), bölge kullanımda mı, son yazım imzası, döngüsü hesaplanmış semtler, yüklü parsel kümesi */
  taxiT: number;
  taxi: boolean;
  taxiSig: number;
  taxiReady: Set<string>;
  loaded: Set<string> | null;
  taxiCount: number;
  /** canlı katman: saat (sn; hareket azaltmada 0) ve son karenin özeti*/
  liveT: number;
  live: LiveDraw | null;
  /** TOUR-VIEW: avatarın önceki konumu ve yumuşatılmış hızı (öne kayan akış halkası) */
  px: number; pz: number; vx: number; vz: number;
}


const cityTile = (x: number, z: number): Tile => [Math.floor(x + 12), Math.floor(z + 8)];

/** canlı katman: birim kutu, renk önbelleği (kare başına dizge ayrıştırma yok), gece çarpanları.*/
const LIVE_UNIT = new THREE.BoxGeometry(1, 1, 1);
const liveColors = new Map<string, THREE.Color>();
const liveColor = (c: string) => { let x = liveColors.get(c); if (!x) { x = new THREE.Color(c); liveColors.set(c, x); } return x; };
const LIVE_LIT = new THREE.Color("#FFD98A");
const liveTint = (c: string, role: LiveRole, night: boolean, out: THREE.Color) => {
  if (role === "glow") return out.copy(liveColor(c)).multiplyScalar(night ? 3 : 1.3);
  if (role === "glass" && night) return out.copy(LIVE_LIT).multiplyScalar(2.2);
  return out.copy(liveColor(c));
};
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
/** araç bölgesi yazımının kalıcı tamponları (writeVehicle her kare; tek CityRig örneği).*/
const VEH_BUF: Block[] = [];
const VEH_LISTS: Record<TailGroup, Block[]> = { solid: [], water: [], glass: [], glow: [] };

export function CityRig({ view, paused, night = false }: { view: CityView; paused: boolean; night?: boolean }) {
  const run = useRef<Run>({ stream: null, sinceGen: 0, grid: null, nearV: -1, tailV: -1, veh: false, ms: 0, dropped: 0, tile: "", district: undefined, deckView: null, applied: 0, riding: false, goal: null, goalV: -1, replans: 0,
    lastOk: null, vp: null, vpAt: 0, taxiT: 0, taxi: false, taxiSig: NaN, taxiReady: new Set(), loaded: null, taxiCount: 0, liveT: 0, live: null,
    px: NaN, pz: NaN, vx: 0, vz: 0 });
  const props = useRef({ view, paused, night });
  // CORE-WALK: "Ofise dön" geri dönüş geçidi Yakındakiler'de (doorEntity.cityGateEntities; F ile geçide yürünür)
  useEffect(() => {
    const src = { city: () => props.current.view.map.id, tile: GATE_RETURN };
    cityGateRuntime.src = src;
    return () => { if (cityGateRuntime.src === src) cityGateRuntime.src = null; };
  }, []);
  props.current = { view, paused, night };
  // canlı katmanın kadrosu (harita başına önbellekli) ve tek örneklenmiş dizisi (kapasite: kadronun bir karedeki en çok kutusu)
  const roster = useMemo(() => liveRoster(view.map), [view.map]);
  const liveCap = useMemo(() => liveCapacity(roster), [roster]);
  const liveMesh = useRef<THREE.InstancedMesh>(null);
  const liveMat = useMemo(() => new THREE.MeshLambertMaterial(), []);
  const tint = useMemo(() => new THREE.Color(), []);
  useEffect(() => () => liveMat.dispose(), [liveMat]);
  useLayoutEffect(() => {
    const mesh = liveMesh.current;
    if (!mesh || !liveCap) return;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(liveCap * 3), 3);
    mesh.count = 0; mesh.visible = false;
  }, [liveCap]);
  const arrival = useCity((s) => s.arrival);
  // varış bakışı dönüş halkasına dönük şehirde halka, avatar varış noktasından RING_HOLD_D yürüyene dek çizilmez
  const [ringHold, setRingHold] = useState<{ x: number; z: number } | null>(null);
  const ringHoldRef = useRef<{ x: number; z: number } | null>(null);

  /** TOUR-VIEW: yazım titreşimli belirir, bırakma titreşimli silinir (`fade`; sökümde anında). */
  const apply = (writes: readonly SlotWrite[], fade = true) => {
    const r = run.current;
    for (const w of writes) for (const g of TAIL_GROUPS) {
      const off = slotOffsetIn(CITY_LAYOUT, w.cls, w.slot, g), size = CITY_LAYOUT.size[w.cls][g];
      if (!w.groups && fade) releaseTail(g, off, size);
      else r.dropped += writeTail(g, off, size, w.groups ? w.groups[g] : [], fade);
    }
    if (writes.length) { if (fade) tourRuntime.fadeWrites += writes.length; else tourRuntime.hardWrites += writes.length; }
  };
  const ends = () => {
    const r = run.current, s = r.stream;
    const high = s ? s.high() : { near: 0, far: 0 };
    for (const g of TAIL_GROUPS) setTailEnd(g, Math.max(tailEndIn(CITY_LAYOUT, high, g), r.veh ? layoutEnd(CITY_LAYOUT, g) + VEHICLE_SLOT[g] : 0,
      r.taxi ? layoutEnd(CITY_LAYOUT, g) + VEHICLE_SLOT[g] + TAXI_SLOT[g] : 0));
  };
  const syncGrid = (force = false) => {
    const r = run.current;
    if (!r.stream || !r.grid || (!force && r.stream.nearVersion === r.nearV)) return;
    r.nearV = r.stream.nearVersion;
    setOuterParcels(r.grid, r.stream.nearParcels().map((p) => ({ cx: p.cx, cz: p.cz, solid: p.near.solid, box: p.near.box, top: p.near.top })));
  };
  /** Araç bölgesi: yolculuk sürüyorsa aracın blokları (yön 90°'ye yuvarlanır: kutular eksen hizalı), değilse boş. */
  const writeVehicle = () => {
    const r = run.current, ride = rideRuntime.ride;
    if (!ride && !r.veh) return;
    const lists = VEH_LISTS; // kalıcı diziler + yerinde araç tamponu (kare başına kopya yok)
    for (const g of TAIL_GROUPS) lists[g].length = 0;
    if (ride) {
      // CITY-POLISH: aracın gövde pozu (durak karosunun dışına taşmaz) ve sürüş yüksekliği profili (teleferik halatı izler)
      // UXF-D: dönüşüm `transit/rideCam.ts vehicleAt` (yolculuk kamerasının kare ölçüsüyle tek kaynak)
      // VEHICLE-DETAIL: şehir/hat livresi ve biçimi (Londra dışında tek katlı otobüs, şehre özgü tekne)
      for (const b of vehicleAt(ride.plan.kind, ride.body, ride.plan.rideY, { city: props.current.view.city, line: ride.plan.line }, VEH_BUF)) lists[b.g as TailGroup].push(b);
    }
    for (const g of TAIL_GROUPS) if (VEHICLE_SLOT[g] > 0) r.dropped += writeTail(g, layoutEnd(CITY_LAYOUT, g), VEHICLE_SLOT[g], lists[g]);
    const on = !!ride;
    if (on !== r.veh) { r.veh = on; ends(); }
  };
  /** WORLD-PANO: ortam taksileri (taksili şehirde) — kuyruğun taksi bölgesine; imza değişmezse (hareket azaltma) yazılmaz. */
  const writeTaxis = (dt: number) => {
    const r = run.current, map = props.current.view.map, s = r.stream;
    if (!s || !TAXI_STYLES[map.id]) return;
    r.taxiT = taxiClock(r.taxiT, Math.min(dt, 0.1), reducedMotion());
    if (!r.loaded) r.loaded = new Set(s.loadedList().map((l) => l.key));
    const loaded = r.loaded;
    let budget = 1;
    const ready = (d: { id: string }) => {
      if (r.taxiReady.has(d.id)) return true;
      if (budget <= 0) return false;
      budget--;
      taxiLoops(map, map.districts.find((x) => x.id === d.id)!);
      r.taxiReady.add(d.id);
      return true;
    };
    const a = walkRuntime.avatar;
    const f = taxiFrame(map, a.x, a.z, r.taxiT, (cx, cz) => loaded.has(pkey(cx, cz)), ready);
    const sig = f.sig; // sayısal imza (eski dize her kare kuruluyordu)
    r.taxiCount = f.count;
    if (sig === r.taxiSig) return;
    r.taxiSig = sig;
    for (const g of TAIL_GROUPS) if (TAXI_SLOT[g] > 0) r.dropped += writeTail(g, layoutEnd(CITY_LAYOUT, g) + VEHICLE_SLOT[g], TAXI_SLOT[g], f.lists[g]);
    if (!r.taxi) { r.taxi = true; ends(); }
  };
  /** canlı katmanın karesi — kutular doğrudan örnek dizisine (kare başına nesne üretilmez); boşsa dizi gizli (+0 çizim).*/
  const hideLive = () => { const mesh = liveMesh.current; if (mesh && mesh.visible) { mesh.visible = false; mesh.count = 0; } };
  const writeLive = (dt: number) => {
    const r = run.current, mesh = liveMesh.current, s = r.stream, { view: v, night: nt } = props.current;
    if (!mesh || !s || !liveCap || !mesh.instanceColor) { hideLive(); return; }
    const reduced = reducedMotion();
    r.liveT = liveClock(r.liveT, Math.min(dt, 0.1), reduced);
    if (!r.loaded) r.loaded = new Set(s.loadedList().map((l) => l.key));
    const loaded = r.loaded, ride = rideRuntime.ride, av = walkRuntime.avatar;
    const m = mesh.instanceMatrix.array as Float32Array, col = mesh.instanceColor.array as Float32Array;
    let k = 0;
    r.live = liveFrame(v.map, roster, {
      t: r.liveT, ax: av.x, az: av.z, ay: av.y, ah: av.heading, night: nt, reduced, loaded: (cx, cz) => loaded.has(pkey(cx, cz)),
      ride: ride ? { line: ride.plan.line, kind: ride.plan.kind, x: ride.body.x, z: ride.body.z, y: ride.body.y, heading: ride.body.heading } : null,
      lure: ritualFx.lure, now: performance.now(), // ritüel çekmesi (yakın sürü konuma kayar)
    }, (x, y, z, w, h, d, yaw, c, role) => {
      if (k >= liveCap) return;
      const e = k * 16, cs = Math.cos(yaw), sn = Math.sin(yaw);
      m[e] = cs * w; m[e + 1] = 0; m[e + 2] = -sn * w; m[e + 3] = 0;
      m[e + 4] = 0; m[e + 5] = h; m[e + 6] = 0; m[e + 7] = 0;
      m[e + 8] = sn * d; m[e + 9] = 0; m[e + 10] = cs * d; m[e + 11] = 0;
      m[e + 12] = x; m[e + 13] = y; m[e + 14] = z; m[e + 15] = 1;
      liveTint(c, role, nt, tint).toArray(col, k * 3);
      k++;
    });
    mesh.count = k;
    mesh.visible = k > 0;
    // yalnız kullanılan örnekler GPU'ya (kapasitenin tamamı her kare yükleniyordu)
    if (k) { mesh.instanceMatrix.addUpdateRange(0, k * 16); mesh.instanceColor.addUpdateRange(0, k * 3); mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
  };
  const teardown = () => {
    const r = run.current;
    const same = tailVersion() === r.tailV;
    if (r.stream && same) {
      apply(r.stream.clear(), false);
      if (r.veh) { r.veh = false; for (const g of TAIL_GROUPS) if (VEHICLE_SLOT[g] > 0) writeTail(g, layoutEnd(CITY_LAYOUT, g), VEHICLE_SLOT[g], []); }
      if (r.taxi) { r.taxi = false; for (const g of TAIL_GROUPS) if (TAXI_SLOT[g] > 0) writeTail(g, layoutEnd(CITY_LAYOUT, g) + VEHICLE_SLOT[g], TAXI_SLOT[g], []); }
      ends();
    }
    r.taxiSig = NaN; r.loaded = null;
    const nav = navGrid(props.current.view.built);
    if (nav.outer === r.grid) nav.outer = null;
    routeClosed.fn = null;
    if (cityLifeRuntime.stream === r.stream) cityLifeRuntime.stream = null; // CITYLIFE: figüranlar yüklü parselleri okur
    if (tourRuntime.stream === r.stream) { tourRuntime.stream = null; tourRuntime.lead = null; } // TOUR-VIEW
    arrivalHold.pending = () => 0;
    clearPortalIntent(); // PORTAL-INTENT-001: şehir biterken niyet kalmaz
    r.stream = null; r.grid = null; r.nearV = -1; r.tile = ""; r.district = undefined;
    if (walkCamera.rule?.key.startsWith("city:")) setWalkCameraRule(null);
    if (r.deckView) { const ws = useWalkStore.getState(); if (ws.active && ws.view !== r.deckView) ws.setView(r.deckView); r.deckView = null; }
  };
  const start = () => {
    const r = run.current, v = props.current.view;
    r.stream = cityStream(v.map);
    // PORTAL-ARRIVAL-COMPLETE-001: örtü, yakın halkada bütçe yüzünden bekleyen parsel yazılana dek kalkmaz (yuvası olmayan / uzak halka
    // beklemez; iç mekânda, duraklatılmışken ve hareket azaltmada 0 — anlık geçiş karartma uzatmaz)
    arrivalHold.pending = () => (r.stream && !props.current.paused && !interiorRuntime.inside && !reducedMotion() ? r.stream.pendingNear : 0);
    cityLifeRuntime.stream = r.stream;
    tourRuntime.stream = r.stream; // TOUR-VIEW: silüet katmanı yüklü parselleri gizler
    r.px = NaN; r.pz = NaN; r.vx = 0; r.vz = 0;
    r.grid = outerGrid(CITY_PW, CITY_PD, [0, 0]);
    navGrid(v.built).outer = r.grid;
    // tıkla-git rotası kilitli semte girmez (onTile oradan geri koyar)
    routeClosed.fn = (i, j) => { const m = props.current.view.map, d = districtAt(m, i, j); return !!d && isDistrictLocked(m.id, d.id); };
    r.nearV = -1;
    r.tailV = tailVersion();
  };

  // bağlanınca akış ve ızgara; sökülünce yuvalar boşalır, ızgara söker, kamera kuralı geri
  useEffect(() => {
    start();
    // tıkla-git hedefi: birleşik ızgara yalnız yakın halkayı bilir; uzak hedefe giden rota halka kenarında biterse (yeni parseller
    // yüklenince) aynı hedefe yeniden planlanır (en çok 24 kez; kullanıcı yeni hedef seçince sıfırlanır)
    const unsub = useWalkStore.subscribe((s, prev) => {
      if (s.target === prev.target || !s.target) return;
      if (interiorRuntime.inside) return; // iç mekân içi hedef (kat karosu) şehir hedefi sayılmaz; çıkışta o karoya yürütmesin
      // PORTAL-INTENT-001 (telefon): geçidin karosunda dururken kendi karosuna dokunmak = F (rota boş kalırdı, girilemezdi)
      const at = s.pose?.tile, tg = s.target, id = props.current.view.map.id;
      if (at && at[0] === tg[0] && at[1] === tg[1] && cityTriggerTiles(id).some((q) => q[0] === tg[0] && q[1] === tg[1])) { goPortal(tg, `city:${id}`); return; }
      const r = run.current, g = r.goal;
      if (!g || g[0] !== s.target[0] || g[1] !== s.target[1]) { r.goal = s.target; r.replans = 0; }
      r.goalV = r.stream?.nearVersion ?? -1;
    });
    return () => { unsub(); teardown(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // varış (giriş, ışınlama, hızlı seyahat): avatar karoya, yakın halka aynı karede
  useEffect(() => {
    const r = run.current, a = arrival;
    if (!a || paused || r.applied === a.token || !r.stream) return;
    r.applied = a.token;
    const av = walkRuntime.avatar;
    Object.assign(av, createAvatar(a.x, a.z, a.heading));
    apply(r.stream.update(a.x, a.z, { gen: 12, writes: 64 }));
    // yüklü parsel kümesi (taksi + canlı katman) varışta yeniden kurulur: halka bu etkide dolduğu için sonraki karelerde yazım olmayabilir
    r.loaded = null;
    ends();
    syncGrid(true);
    const fix = unstick(navGrid(props.current.view.built), av);
    av.x = fix.x; av.z = fix.z;
    if (a.aim) { walkCamera.aim = a.heading; walkCamera.aimExact = !!a.exact; } // doğrulanmış durak varışı yaw'ı korur; // ARRIVAL-QA: hızlı seyahat/iniş — kamera eski yerin yaw'ında kalmaz (kararma altında)
    const hold = a.x === cityX(GATE_ARRIVE[0]) && a.z === cityZ(GATE_ARRIVE[1]) && arrivalHidesRing(props.current.view.map) ? { x: a.x, z: a.z } : null;
    ringHoldRef.current = hold; setRingHold(hold);
    useWalkStore.getState().setTarget(null);
    r.goal = null; // uzak tıkla-git hedefi ışınlanmayla ölür (eskiden yakın halka değişince yeniden kuruluyor, avatar duraktan raya yürüyordu)
    r.tile = "";
  }, [arrival, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  /** seyir noktasındaki zamanlı anlar (koşul sağlanınca damga).*/
  const checkMoments = () => {
    const r = run.current, v = props.current.view;
    if (!r.vp) return;
    for (const m of designOf(v.map.id)?.moments?.[r.vp.district] ?? []) {
      if (m.vp !== r.vp.n) continue;
      if (m.when === "sunset" && sunsetNow(v.def)) visitCity(v.map.id, momentId(v.map.id, r.vp.district, m.id));
    }
  };

  /** Karo değişimi tetikleyicileri. */
  const onTile = (t: Tile) => {
    const { view: v } = props.current, map = v.map, st = useCity.getState();
    const riding = !!rideRuntime.ride;
    // semt
    const d = districtAt(map, t[0], t[1]);
    const did = d?.id ?? null;
    const locked = !!did && isDistrictLocked(map.id, did);
    // kilitli semte yürüyerek girilmez — son açık karoya geri (tıkla-git hedefi iptal), tost + duyuru
    if (locked && !riding) {
      lockedNotice(map.id, did!);
      useWalkStore.getState().setTarget(null);
      run.current.goal = null;
      const back = run.current.lastOk;
      if (back) arriveAt(back, walkRuntime.avatar.heading + Math.PI);
      return;
    }
    if (!riding) run.current.lastOk = t;
    if (did !== run.current.district) {
      run.current.district = did;
      useCity.setState({ district: did });
      if (did && !locked) { visitCity(map.id, districtId(map.id, did)); announceWalk(districtName(map.id, did)); }
    }
    if (riding) { if (st.stop) useCity.setState({ stop: null }); return; }
    // meydandaki "Ofise dön" kapısı
    if (!d && t[0] === GATE_RETURN[0] && t[1] === GATE_RETURN[1]) { if (doorIntended(GATE_RETURN, walkRuntime.avatar.route, `city:${map.id}`)) exitCity(); return; } // HQA-FIX
    if (!d) { run.current.vp = null; cancelViewTurn(AIM_TURN_KEY); if (st.deck || run.current.deckView) { const ws = useWalkStore.getState(), v = deckViewStep(run.current, false, st.deck, ws.view); if (ws.view !== v) ws.setView(v); } if (st.stop || st.deck) useCity.setState({ stop: null, deck: false, deckVp: null }); return; } // semt dışı karoda da seyir görünümü geri
    const plan = districtPlan(map, d);
    // durak
    // UXF-E: panel durağın tam karosunda değil, komşu karolardan da açılır (tam karo önceliklidir)
    const stopRow = plan.stops.find((s) => s.tile[0] === t[0] && s.tile[1] === t[1]) ?? plan.stops.find((s) => stopWithin(stopCenter(map, s.tile), t, stopReach(map, s.tile))); /* CABLEVP1: biniş platformundan */ // doğrulanmış varış karosuna dek erişim
    const stop = stopRow?.id ?? null;
    if (stopRow && takePanelArrival(stopRow.id, t, walkRuntime.avatar.route)) aimAtStop(stopRow.tile, map, t); // ARR-A: panel yürüyüşü varış karosunda — tam yön burada
    else if (!stopRow) takePanelArrival(undefined, t, walkRuntime.avatar.route);
    if (stop !== st.stop) {
      useCity.setState({ stop, stopPanel: false }); // yeni durakta hatlar paneli kapalı (çip)
      // panelsiz varışta da (tıkla-git, elle yürüyüş) kamera durağa bakan açık yaw'a döner; yanından geçen rota çevirmez
      if (stopRow && stopArrivalAim(stopCenter(map, stopRow.tile), walkRuntime.avatar.route, stopReach(map, stopRow.tile))) aimAtStop(stopRow.tile, map, t); // doğrulanmış varış yönü
    }
    if (stop) visitCity(map.id, stopId(map.id, stop));
    // seyir noktası (birinci şahıs)
    const vpIdx = plan.viewpoints.findIndex((p) => p[0] === t[0] && p[1] === t[1]);
    if ((vpIdx >= 0) !== st.deck || (vpIdx >= 0 && vpReaim(run.current.vp, d.id, vpIdx + 1))) { // FIXPACK-B: seyirden seyire doğrudan gelişte de yeniden bak
      const ws = useWalkStore.getState();
      const v = deckViewStep(run.current, vpIdx >= 0, st.deck, ws.view); if (ws.view !== v) ws.setView(v);
      if (vpIdx >= 0) { aimAtViewpoint(map, plan.viewpoints[vpIdx], plan.lift[(plan.viewpoints[vpIdx][1] - plan.j0) * plan.w + (plan.viewpoints[vpIdx][0] - plan.i0)] ?? 0); } // bakış hedefine yumuşak dön
      else cancelViewTurn(AIM_TURN_KEY);
      useCity.setState({ deck: vpIdx >= 0 });
    }
    if ((vpIdx >= 0 ? vpIdx + 1 : null) !== st.deckVp) {
      useCity.setState({ deckVp: vpIdx >= 0 ? vpIdx + 1 : null });
    }
    if (vpIdx >= 0) visitViewpoint(map.id, d.id, vpIdx + 1);
    run.current.vp = vpIdx >= 0 ? { district: d.id, n: vpIdx + 1 } : null;
    if (vpIdx >= 0) checkMoments();
    // gizli köşe (işaretsiz; üstüne basınca)
    const gz = plan.hidden.findIndex((h) => h[0] === t[0] && h[1] === t[1]);
    if (gz >= 0) visitCity(map.id, hiddenId(map.id, d.id, gz + 1));
    // landmark yakınlığı (ayak izine ≤ 2 karo) ve girilebilir landmark kapısı
    for (const lm of plan.landmarks) {
      const I0 = plan.i0 + lm.i0, J0 = plan.j0 + lm.j0;
      const dx = Math.max(I0 - t[0], 0, t[0] - (I0 + lm.w - 1)), dz = Math.max(J0 - t[1], 0, t[1] - (J0 + lm.d - 1));
      if (Math.max(dx, dz) <= 2) visitCity(map.id, landmarkId(map.id, d.id, lm.id));
    }
    const door = plan.doors.find((x) => x.tile[0] === t[0] && x.tile[1] === t[1]);
    if (door && !interiorRuntime.inside && !useInterior.getState().busy && doorIntended(door.tile, walkRuntime.avatar.route, `city:${map.id}`)) { // HQA-FIX
      const lm = plan.landmarks.find((x) => x.id === door.landmark)!;
      const spec = d.landmarks.find((x) => x.id === door.landmark);
      if (!spec?.interior) return;
      // dışarı yön: kapıdan landmark ayak izinin uzağına; ARRIVAL-QA: çıkış 2 karo dışarı (kamera cepheye yaslanmaz; doorExit.ts)
      const ex = landmarkExit(plan, door.tile, lm, citySight(map)), dir = ex.dir;
      const out: Tile = [door.tile[0] + dir[0], door.tile[1] + dir[1]];
      const site = citySiteId(map.id, d.id, lm.id);
      const iplan = cityInteriorPlan(v.scene, site, spec.interior, { tile: door.tile, out, dir: [-dir[0], -dir[1]] }, lm.h);
      run.current.goal = null; // girişte bekleyen uzak şehir hedefi bırakılır
      enterPlan(v.scene, iplan, { x: tx(ex.out[0]), z: tz(ex.out[1]), heading: ex.heading, aim: ex.aim });
    }
  };

  useFrame((_, dt) => {
    const r = run.current;
    if (!useWalkStore.getState().active || !r.stream || props.current.paused) { hideLive(); return; }
    const t0 = performance.now();
    const s = r.stream;
    if (tailVersion() !== r.tailV) { r.tailV = tailVersion(); r.veh = false; r.taxi = false; r.taxiSig = NaN; r.loaded = null; apply(s.rewriteAll()); ends(); }
    const a = walkRuntime.avatar;
    const rh = ringHoldRef.current; // ilk adımdan sonra halka görünür
    if (rh && Math.hypot(a.x - rh.x, a.z - rh.z) > RING_HOLD_D) { ringHoldRef.current = null; setRingHold(null); }
    // TOUR-VIEW: öne kayan halka — yumuşatılmış hız yönünde öndeki nokta (yürüyüş ≈ 12, koşu ≈ 17, taşıt ≤ 22 birim; durunca yok).
    // Işınlanma sıçraması (> 6 birim/kare) hız sayılmaz.
    stepLeadState(r, a.x, a.z, dt);
    const lead = leadPoint(a.x, a.z, r.vx, r.vz);
    tourRuntime.lead = lead;
    // PORTAL-ARRIVAL-COMPLETE-001: örtü altında (geçiş) akış hızlı dolar — örtü bütün parseller yazılınca kalkar (gateState.arrivalHold)
    // yolculukta yavaş karede parsel üretimi ertelenir (rideGenBudget); son üretimden bu yana süre `r.sinceGen`
    r.sinceGen += dt;
    const gen0 = s.stats.generated;
    // dürbün/manzara kipinde yakın halka hedefin çevresinde — uzak halkadaki simge düz LOD kutusu görünüyordu
    const lv = landmarkView.active ? useLandmarkView.getState().rect : null;
    const focus: [number, number] | null = lv ? [(cityX(lv.i0) + cityX(lv.i1)) / 2, (cityZ(lv.j0) + cityZ(lv.j1)) / 2] : null;
    const writes = s.update(a.x, a.z, { ...rideGenBudget(!!rideRuntime.ride, dt, r.sinceGen, s.pendingNear), ...(useInterior.getState().busy ? CITY_ARRIVAL_BUDGET : {}) }, lead, focus);
    if (s.stats.generated !== gen0) r.sinceGen = 0;
    if (writes.length) { apply(writes); ends(); r.loaded = null; }
    syncGrid();
    // uzak tıkla-git hedefi: rota bitti ama hedefe varılmadı ve yakın halka değişti → yeniden planla
    if (rideRuntime.ride) r.goal = null; // biniş de hedefi bırakır
    if (r.goal && !a.route && !rideRuntime.ride) {
      const at = cityTile(a.x, a.z);
      if (at[0] === r.goal[0] && at[1] === r.goal[1]) r.goal = null;
      else if (s.nearVersion !== r.goalV && r.replans < 24) { r.replans++; r.goalV = s.nearVersion; useWalkStore.getState().setTarget([r.goal[0], r.goal[1]]); }
    }
    writeVehicle();
    writeTaxis(dt);
    writeLive(dt);
    // kamera: sokak (kesit) ya da seyir noktası (birinci şahıs)
    const want = useCity.getState().deck ? DECK_RULE : STREET_RULE;
    if (walkCamera.rule?.key !== want.key) setWalkCameraRule(want);
    // iniş: yolculuk bitti → bulunulan karonun tetikleyicileri (durak) yeniden değerlendirilir
    const riding = !!rideRuntime.ride;
    if (r.riding && !riding) r.tile = "";
    r.riding = riding;
    const t = cityTile(a.x, a.z), key = `${t[0]},${t[1]}`;
    // PORTAL-INTENT-001: F geçidin karosundayken — karo değişmediği halde tetik bir kez koşar (niyet tüketilir ya da düşer)
    const armed = portalArmed(t, `city:${props.current.view.map.id}`);
    if (portalIntent.tile && !armed) clearPortalIntent(); // karodan ayrıldı, bayat ya da başka şehrin niyeti
    if ((key !== r.tile || armed) && !useInterior.getState().busy) { r.tile = key; onTile(t); if (armed) clearPortalIntent(); }
    // kararma (kapı, ışınlanma, durak sıçrayışı) seyir karosundan çıkıştır — görünüm kararma altında geri gelir. Eskiden
    // onTile kararma bitene dek ertelendiği için iç mekân girişi 1. şahsı "giriş görünümü" saklıyor, çıkışta avatar kayboluyordu (<city> aralıklı)
    else if (useInterior.getState().busy && deckFadeLeave(r, useCity.getState().deck)) { useCity.setState({ deck: false, deckVp: null }); r.vp = null; r.tile = ""; }
    // seyir noktasında beklerken ışık/saat değişirse an yeniden denetlenir (yarım saniyede bir)
    if (r.vp && !riding) { const now = performance.now(); if (now - r.vpAt > 500) { r.vpAt = now; checkMoments(); } }
    r.ms = r.ms * 0.95 + (performance.now() - t0) * 0.05;
  });

  // geliştirme kancası (canlı denetim ve ekran görüntüsü); üretim derlemesinde yok
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voxcrewCity?: unknown };
    w.__voxcrewCity = {
      state: () => {
        const r = run.current, s = r.stream, st = useCity.getState(), a = walkRuntime.avatar;
        return {
          active: !!s, paused: props.current.paused, city: props.current.view.city, tile: cityTile(a.x, a.z), district: st.district, stop: st.stop, deck: st.deck,
          ride: st.ride, center: s?.center ?? null, counts: s?.counts() ?? null, high: s?.high() ?? null, pending: s?.pending ?? 0,
          districts: s ? loadedDistricts(s) : [], stats: s ? { ...s.stats } : null, dropped: r.dropped, ms: +r.ms.toFixed(3), grid: r.grid?.parcels.size ?? 0,
          rule: walkCamera.rule?.key ?? null, view: useWalkStore.getState().view, found: [...st.found].sort(), inside: interiorRuntime.inside,
          taxi: { on: r.taxi, count: r.taxiCount, t: +r.taxiT.toFixed(2), ready: [...r.taxiReady].sort() },
          live: { visible: !!liveMesh.current?.visible, cap: liveCap, t: +r.liveT.toFixed(2), period: roster.period, roster: roster.actors.map((a) => a.id),
            dropped: roster.dropped, loaded: r.loaded ? [...r.loaded].sort() : null, actors: r.live?.actors ?? 0, boxes: r.live?.boxes ?? 0, flocks: r.live?.flocks ?? 0, ids: r.live?.ids ?? [], hidden: r.live?.hidden ?? null },
        };
      },
      /** şehir karosuna ışınla */
      go: (i: number, j: number) => arriveAt([i, j]),
      /** karonun semti kilitli mi (canlı denetim "ulaşılamaz"ı kilitle doğrular)*/
      lockedAt: (i: number, j: number) => { const d = districtAt(props.current.view.map, i, j); return !!d && isDistrictLocked(props.current.view.city, d.id); },
      /** semt yerel karoya ışınla */
      goLocal: (district: string, li: number, lj: number) => {
        const d = props.current.view.map.districts.find((x) => x.id === district);
        if (d) arriveAt([d.bounds[0] + li, d.bounds[1] + lj]);
        return !!d;
      },
      stops: () => props.current.view.map.stops.map((x) => x.id),
      /** tıkla-git (şehir karosu): avatar yürüyerek gider */
      walkTo: (i: number, j: number) => { useWalkStore.getState().setTarget([i, j]); return true; },
      /** semt yerel karoya tıkla-git */
      walkLocal: (district: string, li: number, lj: number) => {
        const d = props.current.view.map.districts.find((x) => x.id === district);
        if (d) useWalkStore.getState().setTarget([d.bounds[0] + li, d.bounds[1] + lj]);
        return !!d;
      },
      /** bin; `calm` true → hareket azaltma yolu (doğrudan varış) */
      board: (line: string, to: string, calm?: boolean) => boardLine(line, to, calm),
      fast: (stop: string) => fastTravel(stop),
      home: () => exitCity(),
      /** ışık kipi (gün batımı anı denetimi için; "auto" | "day" | "night")*/
      light: (mode: "auto" | "day" | "night") => { setLightMode(mode); return mode; },
      /** semtin gizli köşeleri (şehir karosu)*/
      hidden: (district: string) => {
        const d = props.current.view.map.districts.find((x) => x.id === district);
        return d ? districtPlan(props.current.view.map, d).hidden : [];
      },
      /** QATOOL (scripts/live_verify.mjs): girilebilir landmark kapıları — kapı karosu, dışarıdaki yaklaşma karosu, çıkış karosu, iç tür */
      doors: () => {
        const map = props.current.view.map;
        return map.districts.flatMap((d) => {
          const plan = districtPlan(map, d);
          return plan.doors.map((dr) => {
            const lm = plan.landmarks.find((x) => x.id === dr.landmark), ex = lm ? landmarkExit(plan, dr.tile, lm, citySight(map)) : null;
            return { district: d.id, landmark: dr.landmark, interior: d.landmarks.find((x) => x.id === dr.landmark)?.interior ?? null, tile: dr.tile,
              approach: ex ? [dr.tile[0] + ex.dir[0], dr.tile[1] + ex.dir[1]] : null, out: ex?.out ?? null };
          });
        });
      },
    };
    return () => { delete w.__voxcrewCity; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const faunaStream = useCallback(() => run.current.stream, []); // CITY-FAUNA
  // canlı katman dizisi (gölgesiz; mover gibi kamera kesitine girmez; boşken gizli → +0 çizim)
  // CORE-WALK: "Ofise dön" kapısında geri dönüş ışınlanma halkası (iç mekândayken gizli) + Yakındakiler girdisi
  // TOUR-VIEW: silüet + ufuk katmanı (+1 çizim çağrısı; iç mekânda gizli)
  const portal = <><PortalRing tile={GATE_RETURN} kind="home" night={night} visible={!paused && !ringHold} /><HorizonLayer map={view.map} visible={!paused} /><HiResCityLayer map={view.map} visible={!paused} />
    {/* CITY-FAUNA: şehre özgü hayvanlar (+1 çizim çağrısı; görünür hayvan yoksa gizli) */}
    <CityFauna map={view.map} night={night} paused={paused} stream={faunaStream} /></>; // LANDMARK-HIRES: simge katmanı (≤ 4 çizim)
  if (!liveCap) return portal;
  return <>{portal}<instancedMesh key={`live${liveCap}`} ref={liveMesh} args={[LIVE_UNIT, liveMat, liveCap]} frustumCulled={false} castShadow={false} receiveShadow={false} visible={false} /></>;
}

/**
 * Ofis tabanında "Şehre çık" kapısı: avatar kapıya ≤ 2 karo yaklaşınca HUD düğmesi (`useCity.nearDoor`), kapı karosuna basınca
 * giriş. Hiçbir şey çizmez (kapının işaret blokları World.tsx'te `solid` grubuna katılır).
 */
export function CityDoorWatcher({ scene, built, map }: { scene: string; built: Built; map: CityMapFile }) {
  const ref = useRef({ scene, built, map });
  ref.current = { scene, built, map };
  useEffect(() => prewarmCity(map), [map]); // şehir kurulumunun saf hesapları tabanda boşta (portal takılması)
  useEffect(() => {
    const go = () => {
      const { scene: sc, built: b, map: m } = ref.current;
      const door = officeDoor(b);
      if (!door) return;
      const off = baseOffset(b);
      // dönüş pozu: kapının içeri komşusu (taban göreli), içeri bakarak
      // HQA-FIX: kapıdan ≥ GATE_CLEAR karo içeride (1 karoda ilk F yeniden şehre atıyordu; kayıtlı konum da kapı dibinde kalıyordu)
      const out = clearOfGates(b, door.out, [door.tile], PORTAL_CLEAR); // halka dönüş karesinin önünde kalmasın
      enterCity(sc, m, { x: tx(out[0]) - off[0], z: tz(out[1]) - off[1], heading: Math.atan2(-door.dir[0], -door.dir[1]) });
    };
    cityDoor.go = go;
    // UXF-B: kapı Yakındakiler'de, mini haritada ve Hoş geldin kartında (doorEntity.ts)
    const unbind = bindCityDoor({ scene: () => ref.current.scene, city: () => ref.current.map.id, tile: () => officeDoor(ref.current.built)?.tile ?? null });
    let last = "";
    const unsub = useWalkStore.subscribe((s) => {
      if (!s.active || !s.pose || s.world !== ref.current.scene || interiorRuntime.inside) { if (useCity.getState().nearDoor) useCity.setState({ nearDoor: null }); return; }
      const t = s.pose.tile, k = `${t[0]},${t[1]}`;
      if (k === last) return;
      last = k;
      const door = officeDoor(ref.current.built);
      const near = door ? cheb(door.tile, t) <= 2 : false;
      const want = near ? ref.current.map.id : null;
      if (useCity.getState().nearDoor !== want) useCity.setState({ nearDoor: want });
      // UXF-E: kapıya yalnız elle basınca ya da kapı yürüme hedefiyse girilir; başka bir hedefe giden rota kapı karosundan
      // geçiyorsa harita açılmaz ("Balık ekmek ye" yolu şehir haritasına düşürüyordu)
      if (door && door.tile[0] === t[0] && door.tile[1] === t[1] && !useInterior.getState().busy && doorIntended(door.tile, walkRuntime.avatar.route)) go();
    });
    return () => { unsub(); unbind(); if (cityDoor.go === go) cityDoor.go = null; if (useCity.getState().nearDoor) useCity.setState({ nearDoor: null }); };
  }, []);
  // geliştirme: kapıya ışınla (canlı denetim)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voxcrewCityDoor?: unknown };
    w.__voxcrewCityDoor = {
      door: () => officeDoor(ref.current.built),
      enter: () => { cityDoor.go?.(); return !!cityDoor.go; },
      /** tıkla-git: avatar kapı karosuna yürür (kapıya basınca şehre çıkılır) */
      walk: () => { const door = officeDoor(ref.current.built); if (door) useWalkStore.getState().setTarget(door.tile); return door; },
      avatar: () => { const a = walkRuntime.avatar; return { x: a.x, z: a.z, tile: useWalkStore.getState().pose?.tile ?? null }; },
      /** avatarı kapının içeri komşusuna koy (yürüyerek kapıya basmak için) */
      near: () => {
        const door = officeDoor(ref.current.built);
        if (!door) return null;
        const a = walkRuntime.avatar;
        a.x = tx(door.out[0]); a.z = tz(door.out[1]); a.route = null;
        return door;
      },
    };
    return () => { delete w.__voxcrewCityDoor; };
  }, []);
  // CORE-WALK: kapı karosunun ortasında şehre geçit ışınlanma halkası
  const door = officeDoor(built);
  const night = useLightMode((st) => st.mode === "night");
  return door ? <PortalRing tile={door.tile} kind="city" night={night} /> : null;
}
