/**
 * W1a (WALK-CORE) — yürüme modu kamera düzeneği.
 *
 * - Girişte yörünge pozu saklanır, OrbitControls kapatılır, kamera 600 ms'de takip pozuna kayar (hareket azaltmada kesme).
 * - Üçüncü şahıs takip (mesafe ~6, yükseklik ~3,2, yumuşak gecikme); V ile birinci şahıs (göz 1,45, avatar örneği gizli).
 * - Q/E kamerayı 45° döndürür; +/− takip mesafesi; ızgara ışın yürütmeyle kamera çarpışması (en az 2,5).
 * - Avatar adımı (`controller.stepAvatar`), tıkla-git (`useWalkStore.target` → `planRoute`), ajanlar yumuşak engel.
 * - Kesit birimleri (`cover.ts` `cutawayUniforms`) yazılır; uygulayan W2 (`Blocks.tsx` `installCutaway`).
 * - Depoya seyrek senkron: poz (karo/8 yön değişince), yakındakiler (4 Hz, içerik değişince), kesit durumu.
 * - Çıkışta kamera saklanan yörünge pozuna döner, OrbitControls geri açılır.
 * - W5: birinci şahısta FOV genişler ve baş sallanır (yalnız hareket azaltma kapalıyken), yakın düzlem kısalır (duvar içi
 * görünmez), F bakış konisindeki hedefi seçer; üçüncü şahısta kamera duvar sütununun içine girmez (`wallClamp`).
 * Fotoğraf modu (P): avatar durur, kamera serbest (avatarın 10 birimi ve dünya sınırı içinde odak, eğim, mesafe);
 * iki parmak çevirme/kıstırma (`walkRuntime.yawDelta`/`zoomMul`); fotoğraf karesi `walkRuntime.capture` ile o karede alınır.
 *
 * - WALK-SCALE: girişte karakterler gerçek boya (`scale.ts` WALK_HUMAN_SCALE 0,72; 600 ms, hareket azaltmada kesme) ve
 * büyük taşıtlar yürüme boyuna geçer (`walkRuntime.humanScale`); kamera ölçekli göz/göğüs yüksekliği ve mesafesiyle çalışır.
 * Serbest bakış: yaw + eğim (−60°…+70°): fare sürükleme (sol/sağ tuş, eşik 5 px; sürükleme tıkla-git'i tetiklemez),
 * birinci şahısta tıkla → işaretçi kilidi (Esc bırakır, moddan çıkarmaz), Q/E 45°, R/C ve PageUp/PageDown eğim, iki parmak
 * sürükleme (gestures.ts). Yürüme yönü kamera yaw'ına göre; kamera çarpışması ve kesit eğimden bağımsız pivotla çalışır.
 *
 * - WALK-PHYS: avatar dikey fiziği (`stepAvatar({ climb: true, jump })`, physics/height.ts): basamak çıkışı/inişi, Boşluk ve
 * dokunmatik Zıpla düğmesiyle zıplama, tırmanılabilir engelin üstünde yürüme, kenardan düşme. Kamera yüksekliği izler:
 * üçüncü şahısta pivot yumuşak (oran 8/sn), birinci şahısta göz yüzeyi izler ve tavanın altında kalır. Hareket azaltmada kamera
 * zıplama yayını izlemez (yalnız üstünde durulan yüzey; sallanma yok), zıplama yine çalışır. Taşıtların yürüme uyumu
 * (walk/moverFit.ts) girişte bağlanır.
 *
 * - INTERIOR-VIEW: iç mekân katında alan kuralı (`cameraRule.ts`, interiors/sceneModel.ts); güverte birinci şahıs (InteriorRig
 * görünümü ayarlar; V değiştirir). Alan değişince kamera bu karede oturur.
 * - INTERIOR-CAM (2026-10-29): kesit/çatı kaldırma yok. Ortam başına kamera profili (camera/profiles.ts: sokak, meydan, iç oda
 * 64°/1,6, salon 68°/2,3, koridor-merdiven 62°/1,2, teras, taşıt; etkinlik actionCam'de) yumuşak geçişle; avatarın üstünde tavan
 * varsa kamera tavanın altında kalır (camera/ceiling.ts), duvarlara yaylı kolla çarpar.
 *
 * - kamera hiçbir zaman avatarın başına gömülmez: kısalma + kıskaç kamerayı pivota `CAM_MIN_DIST`'ten yakın
 * çekerse kaldırılmış ya da omuz üstü poz, o da sığmazsa o karede göz (`cover.ts` `resolveFollowCam`); kamera başa
 * `CAM_HIDE_DIST`'ten yakınsa (kayma ve fotoğraf modu dahil) avatar gizlenir (`walkRuntime.visible`; Crowd değişmedi).
 * - (K3): görüş açısı Hor+ — Görünüm'deki "Yürüme görüş açısı" ayarı (`useWalkFov`) + alan eki, yatay taban
 * yatay ekranda 60°, dikey ekranda 40° (`scale.ts` `walkFov`); birinci şahıs en az FP_FOV.
 * - "Manzara" kipi — `L` ya da `landmarkView.ts` `startLandmarkView` (bilgi kartı): avatar yerinde kalır, kamera
 * simgeyi tepesi ve tabanı kadrajda kalacak biçimde çerçeveler (yavaş sağa-sola yörünge; hareket azaltmada sabit), kesit simgenin
 * önündeki örtücüleri bütün açar. Esc, L ya da hareket girdisi takip kamerasına kayarak döndürür.
 *
 * Hiçbir şey çizmez (+0 çizim çağrısı); avatar örneğini WALK-CROWD `Crowd.tsx` `walkRuntime`'dan çizer.
 * World.tsx bu dosyayı W1'de bağlamaz: entegrasyon adımları.
 *
 * Kullanım (Canvas içinde, her zaman bağlı; mod kapalıyken yalnızca çıkış kaymasını bitirir):
 * <WalkRig built={built} controls={controls} live={live} core={sceneDef(id).core} />
 * DOM tarafı (Canvas dışında): `const walk = useWalkMode(built, worldId, core)` → `walk.enter`, `walk.exit`.
*/
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { reducedMotion } from "../motion";
import type { WorldLive } from "../live";
import { tx, tz, type Built, type SceneCore, type Tile } from "../scenes";
import {
  applyPathSteps, baseOffset, CEIL_GAP, clearOfGates, GATE_CLEAR, PORTAL_CLEAR, walkable, nearestWalkable, coverGrid, createAvatar, eyeUnderCeiling, heightCtx, navGrid, pickInteractTarget, pickLookTarget, planRoute, ProximityIndex, setRoute, spawnTile, stepAvatar, tileAt, unstick,
  type ExtraBlock, type NavGrid, type ProxEntity, type Vec2,
} from "./controller";
import { safeStep } from "./safeRescue"; // STUCK-FIX
import { AIM_TURN_KEY, AIM_TURN_MIN, angDiff, cancelViewTurn, startViewTurn, stepViewTurn, viewTurn } from "./viewTurn";
import { useInterior } from "../interiors/store"; // kararma perdesi
import { ceilingAt } from "../physics/height";
import { bindMoverWorld, moverFitOf, walkSampler } from "./moverFit";
import { samplePath } from "../props/movers";
import { CAM_HIDE_DIST, CAM_SHOW_DIST, computeCutaway, cutawayUniforms, type FollowCam, HEAD_CENTER_Y, headDistance, nearBlocks, orbitCutPlan, orbitGroup, resetCutaway,
  resolveFollowCam, roomShape, type RoomShape, shapeWith, walkCutPlan, WALK_NEAR, writeCutPlan, writeNearUniforms, writeStreetUniforms } from "./cover";
import { walkCamera } from "./cameraRule";
// CAMERA (2026-10-28): yaylı kol çarpışması, kare sonu güvenlik ağı, çatı kesiti titreşim geçişi (voxel/camera/*)
import { armSafety, createCamRig, followArm, releaseArm, FLOOR_PAD } from "../camera/rig";
import { airAllowed, airEase, applyAirFog, airPose, applyZoom, emitWalkZoom, stepAir, toggleAir, walkZoom, ZOOM_STEP } from "../camera/walkZoom"; // WALK-ZOOM
// INTERIOR-CAM (2026-10-29): ortam başına kamera profili (sokak, meydan, iç oda, salon, koridor/merdiven, teras, taşıt) ve tavan
// sıkıştırması — çatı/tavan hiçbir pozda kesilmez, kamera tavanın altında kalır (voxel/camera/profiles.ts, ceiling.ts)
import { CAMERA_PROFILES, createProfileBlend, inNarrowLane, LANE_ELEV_MAX, openness, profileOf, selectProfile, shoulderShift, stepProfileBlend, type CamSpace } from "../camera/profiles";
import { ceilingOver, elevCap, HEAD_CLEAR } from "../camera/ceiling";
import { entryYaw, fitCeiling, rigSource } from "../camera/rig";
import { ARM_EYE, armEyeIndoor, crowdEyeDist, eyeHyst, hideDistIndoor, pointBlocked, probeRadius, sweepArm } from "../camera/collide";
import { cameraSource } from "../camera/world"; // ACTIVITY-CAM: kadraj seçimi yaylı kolun gerçek açık boyunu sorar
import { cancelEmote } from "./emotes";
import { combineInput } from "./input";
import {
  approachScale, CAM_FLOOR, CHIBI_HEIGHT, clampLook, DRAG_SLOP, EYE_Y, FOLLOW_DIST, FOLLOW_MAX, FOLLOW_MIN, LOOK_DEFAULT, LOOK_Y, lookDir, MOUSE_PITCH, MOUSE_YAW,
  ORBIT_MIN, orbitPose, WALK_AVATAR_RADIUS, WALK_HUMAN_SCALE, walkFov, hFovOf, arrivalPitch,
} from "./scale";
import { useWalkFov } from "../../components/world/viewSettings";
import { useWalkStore, walkRuntime, type WalkPose } from "./walkStore";
import { sceneSpawnPose, sceneSpawnView, VIEW_DIRS, type SpawnRules } from "./spawnView";
import { mgActor } from "../fun/minigames";
import { ritualCam, ritualFeel, ritualFx, ritualRuntimeOpts, ritualState, seatOccupancy } from "../fun/ritualRuntime";
import { clearActionCam } from "./actionCam";
import { routeAheadYaw, routeCamYaw, routeFollowOn, stepRouteYaw } from "./routeCam";
import { activityCam, activityHolds, activityKindOf, activityRestore, pickActivityFraming, type FramingPick } from "./activityFraming";
import { clearAimYaw, framingArmOf } from "./framingArm"; // HQA-FIX
/** güverte (seyir galerisi, birinci şahıs) varsayılan eğimi — ufuk karenin üst üçte birinde, şehir ve su karenin çoğunda
 * (eskiden 0: ufuk ortada, şehir alt yarıda).*/
const DECK_PITCH = -0.2;
import { moverLanes } from "./moverLanes"; // HQA-FIX: kadraj taşıt şeritlerine kamera koymaz
import { LINGER_MS } from "../fun/activityFace";
import type { FishSpot } from "../fun/sites";
import { setWalkPresence } from "../../lib/walkPresence";
import { gateMapOf } from "../citymap/shell";
import { cityLiftTargets, landmarkLift, LIFT_CAM_MIN, openLift } from "./lmLift";
import { AGENT_CAM_H, AGENT_CAM_PAD, clearOfPeople, CROWD_BODY_R, CROWD_CAM_R, crowdVeil } from "./agentCam";
import { cityLifeRuntime } from "../citylife/runtime";
import { routeAvoid, walkGates } from "./routeAvoid"; // HQA-FIX
import { rideDt, rideRuntime, type ActiveRide } from "../transit/ride";
import { introBlendWall, RIDE_WALL_MAX, rideArmSourceOf, rideEndSourceOf, rideCamAdjust, rideSamples, stepRideElev, type RideAdj } from "../transit/rideCam"; // HQA-FIX
import { BOARD_DWELL } from "../transit/model"; // HQA-FIX
import { cityGateRuntime } from "../citymap/doorEntity"; // HQA-FIX
import { cityRuntime } from "../citymap/runtime";
import { officeDoor } from "../citymap/door";
import { rideCutPlan } from "./rideCut";
import { firstPersonOn } from "./rideCut";
import { camLerp } from "./camArc";
import { angleDiff, createRideYaw, establishPose, handCamLimit, resetRideYaw, startHandoff, stepHandoff, type CamHandoff, RIDE_ESTABLISH, rideCamPose, rideCamProfileId, rideLookHeading, rideSide, stepRideYaw, type RideCam } from "../transit/rideCam"; // RIDE-UX; establishPose
import { blockQuery, cityLandmarkBlocks, cityParcelQuery, cityPlanQuery, clearViewCam, landmarkView, landmarkViewSources, pickViewTarget, solveView, startLandmarkView, stopLandmarkView, swingDist, targetBox, toggleLandmarkView,
  useLandmarkView, viewableTarget, viewCam, viewCutPlan, viewMinY, viewTargets, VIEW_ENTER_MS, VIEW_PERIOD, VIEW_SWING, type BlockQuery, type LandmarkViewTarget,
  type ViewBox } from "./landmarkView";

// ------------------------------------------------------------------------------------------ yörünge kilidi
/** OrbitControls'un (drei / three-stdlib) bu düzeneğin kullandığı yüzeyi. */
export interface OrbitLike {
  enabled: boolean;
  target: THREE.Vector3;
  update: () => unknown;
}

export interface OrbitSnapshot { pos: THREE.Vector3; target: THREE.Vector3; enabled: boolean }

/** Yörünge pozunu saklar ve denetimleri kapatır (drei kapalı denetimde `update` çağırmaz → kamera serbest). */
export function lockOrbit(controls: OrbitLike | null, camera: THREE.Camera): OrbitSnapshot {
  const snap = { pos: camera.position.clone(), target: controls ? controls.target.clone() : new THREE.Vector3(0, 0.4, 0), enabled: controls?.enabled ?? true };
  if (controls) controls.enabled = false;
  return snap;
}

/** Saklanan pozu anında geri yükler ve denetimi açar (kaymalı dönüş WalkRig'de). */
export function restoreOrbit(controls: OrbitLike | null, camera: THREE.Camera, snap: OrbitSnapshot): void {
  camera.position.copy(snap.pos);
  if (controls) { controls.target.copy(snap.target); controls.enabled = snap.enabled; controls.update(); }
  else camera.lookAt(snap.target);
}

// ------------------------------------------------------------------------------------------ sabitler
// WALK-SCALE: takip ve göz ölçüleri yürüme boyunda (scale.ts); eski değerler 6 / 3,2 / 1,45 / 1,2 chibi boyuna göreydi
export { EYE_Y, FOLLOW_DIST, FOLLOW_MAX, FOLLOW_MIN, LOOK_Y };
export const TRANSITION_MS = 600;
const NEARBY_HZ = 4;
/** W5: birinci şahıs görüş açısı (hareket azaltmada taban açı korunur) ve yakın düzlem */
export const FP_FOV = 62;
export const FP_NEAR = 0.12;

/** UX-AUDIT: oda biçimi + avatar karosu (yalnız karo ya da kat değişince yeni nesne; kabuk birimleri kimliğe göre yüklenir) */
const shapeMemo: { base: RoomShape | null; nav: object | null; key: string; shape: RoomShape | null } = { base: null, nav: null, key: "", shape: null };
function roomShapeAt(room: RoomShape | null, nav: NavGrid, x: number, z: number): RoomShape | null {
  const [i, j] = tileAt(x, z);
  const key = `${i},${j}`;
  if (room !== shapeMemo.base || (!room && nav !== shapeMemo.nav) || key !== shapeMemo.key) {
    const base = room ?? roomShape(nav);
    shapeMemo.base = room; shapeMemo.nav = nav; shapeMemo.key = key;
    shapeMemo.shape = base ? shapeWith(base, x, z) : null;
  }
  return shapeMemo.shape;
}
/** W5: baş sallanması genliği (birim) ve adım frekansı çarpanı */
const BOB_AMP = 0.035;
/** W5: fotoğraf modu — odağın avatardan en çok uzaklığı, mesafe ve eğim sınırları, odak hızı (birim/sn) */
export const PHOTO_RADIUS = 10;
const PHOTO_DIST: [number, number] = [1.2, 14];
const PHOTO_PITCH: [number, number] = [0.04, 1.35];
const PHOTO_SPEED = 4;

export interface WalkRigProps {
  built: Built;
  controls: RefObject<OrbitLike | null>;
  /** ajan konumları: yumuşak engel ve yakındakiler (Crowd yazar) */
  live?: WorldLive;
  /** simge çekirdeği (doğma karosu) */
  core?: SceneCore | null;
  /** ajan dışı yakınlık öğeleri (hayvanlar, nesneler, pano, hatıralar); 4 Hz çağrılır, aynı dizi döndürebilir */
  entities?: () => readonly ProxEntity[];
  /** geçici kapalı karolar (oturan ajanın istasyonu, §3.4) */
  occupied?: ExtraBlock;
  /** ajan kimlikleri yakındakilere girsin mi (varsayılan true) */
  agentsNearby?: boolean;
}

interface Glide { fromP: THREE.Vector3; fromL: THREE.Vector3; t0: number; dur: number; exit: boolean }
/** açık manzara kipi — hedef kutusu, çerçeve (yaw, yükseliş, uzaklık), kullanıcı dönüşü/yakınlığı, giriş kayması*/
interface LandmarkShot {
  key: string; box: ViewBox; yaw: number; yawTarget: number; elev: number; dist: number; zoom: number; minY: number;
  t0: number; fov: number; aspect: number; view: string; ruleKey: string; enter: Glide | null;
}

/** manzara sorguları — simge kutusu (sahnede gerçek bloklar, şehirde ayak izinin parsel blokları) ve aday puanı (sahnede
 * gerçek bloklar, şehirde semt planı kutuları + meydan; uzak parseller henüz üretilmemiş olabilir)*/
function viewBox(built: Built, t: LandmarkViewTarget): { box: ViewBox; score: BlockQuery } {
  const map = gateMapOf(built);
  if (map) return { box: targetBox(t, cityParcelQuery(map), undefined, cityLandmarkBlocks(map, t.rect)), score: cityPlanQuery(map, built.blocks) };
  const q = blockQuery(built.blocks, built.backdrop ?? []);
  return { box: targetBox(t, q), score: q };
}

const ease = (k: number) => 1 - Math.pow(1 - k, 3);
/** ACTIVITY-FEEL (B7/B8): eylem kamerasının kadraj sorgusu — sahne blokları, şehir haritasında yakın parsel blokları da. */
function actionQuery(built: Built): BlockQuery {
  const base = blockQuery(built.blocks), map = gateMapOf(built);
  if (!map) return base;
  const city = cityParcelQuery(map);
  return (x0, z0, x1, z1) => [...base(x0, z0, x1, z1), ...city(x0, z0, x1, z1)];
}
/**
 * ACTIVITY-CAM: kadraj seçiminin yaylı kol ölçüsü — pivot → kamera açık boyu (pivot itmesi + küre süpürmesi; camera/rig.ts followArm ile
 * aynı yarıçap/zemin payı) ve duvar kıskacı / çatı örtüsü (cover.ts resolveFollowCam): kamera göze/omuza düşerse aday geçersiz (0).
 * ritüel ve olta kadrajı aynı ölçüyü kullanır (eskiden ritüel bloğunda satır içi kapanış).
 * HQA-FIX: ölçü saf modülde (`framingArm.ts`) — düğüm testi olta/ritüel kadrajını gerçek kol boyuyla tarar.
*/
function framingArm(built: Built, pc: THREE.PerspectiveCamera, ground: number, footY: number, px: number, pz: number) {
  return framingArmOf(built, pc.fov, pc.aspect || 1, ground, footY, px, pz);
}
/**
 * binişteki tanıtım çekiminin yanı — iki yan için pivot → kamera yaylı kol açıklığı ölçülür (iskele binası, saçak);
 * kolu en az %85 açık yan (önce sağ), yoksa 0 (tanıtım atlanır, kamera doğrudan arkadan-yandan takipte).
*/
function rideIntroSide(built: Built, kind: Parameters<typeof establishPose>[0], x: number, z: number, footY: number, heading: number, pc: THREE.PerspectiveCamera, yaw = heading + rideSide(kind), elev?: number): 0 | 1 | -1 {
  const src = cameraSource(built), r = probeRadius(WALK_NEAR, pc.fov, pc.aspect || 1), ft = footY + 0.2;
  const pv: [number, number, number] = [x, footY + LOOK_Y, z];
  for (const side of [1, -1] as const) {
    const e = establishPose(kind, x, z, footY, heading, side);
    const want = Math.hypot(e.x - pv[0], e.y - pv[1], e.z - pv[2]);
    // geçiş yolu duvar dibinden geçmemeli (transit/rideCam.ts `introBlendWall`)
    if (sweepArm(src, pv, [e.x, e.y, e.z], r, ft) >= want * 0.85 && introBlendWall(kind, src, x, z, footY, heading, yaw, side, pc.aspect || 1, elev) <= RIDE_WALL_MAX) return side;
  }
  return 0;
}
/** takip pozu kapalıyken tanıtım çekiminde en çok bu kadar (sn, binişten) beklenir.*/
const RIDE_HOLD_MAX = 12;
/** yolculuğun takip pozu (tanıtımsız) yaylı kolunun en az %70'i açık mı.*/
function rideFollowOpen(built: Built, kind: Parameters<typeof establishPose>[0], x: number, z: number, footY: number, heading: number, yaw: number, pc: THREE.PerspectiveCamera): boolean {
  const c = rideCamPose(kind, x, z, footY, heading, yaw);
  const pv: [number, number, number] = [x, footY + LOOK_Y, z];
  const want = Math.hypot(c.x - pv[0], c.y - pv[1], c.z - pv[2]);
  return sweepArm(cameraSource(built), pv, [c.x, c.y, c.z], probeRadius(WALK_NEAR, pc.fov, pc.aspect || 1), footY + 0.2) >= want * 0.7;
}
/** HQA-FIX: yolculuk kamerasının çarpışma ayarı (şimdi + rotada ileri anlar; transit/rideCam.ts `rideCamAdjust`).*/
function rideAdjustNow(built: Built, ride: ActiveRide, x: number, z: number, footY: number, lookH: number, yaw: number, user: number, pc: THREE.PerspectiveCamera, prev: RideAdj | null): RideAdj {
  const samples = rideSamples(ride.plan, ride.t - BOARD_DWELL, { ax: x, az: z, footY, lookH, yaw }, ride.body, { city: cityGateRuntime.src?.city(), line: ride.plan.line }, user);
  return rideCamAdjust(ride.plan.kind, cameraSource(built), samples, { radius: probeRadius(WALK_NEAR, pc.fov, pc.aspect || 1), floorTop: footY + FLOOR_PAD, aspect: pc.aspect || 1 }, prev);
}
/** Etkinlik kadrajının yatay yarı açısı (rad): tuvalin gerçek görüş açısından, kenar payıyla. */
const framingHalf = (pc: THREE.PerspectiveCamera) => Math.min(0.9, (hFovOf(pc.fov, pc.aspect || 1) * Math.PI) / 360 - 0.08);

export function WalkRig({ built, controls, live, core = null, entities, occupied, agentsNearby = true }: WalkRigProps) {
  const { camera, gl, clock } = useThree();
  const st = useRef({
    wasActive: false,
    snap: null as OrbitSnapshot | null,
    glide: null as Glide | null,
    hand: null as CamHandoff | null, // biniş/iniş kamera devri (rideCam.ts startHandoff)
    handRel: null as { x: number; y: number; z: number } | null, handSafe: new THREE.Vector3(), // devirde kameranın pivota göre konumu (hız sınırlı)
    yaw: Math.PI,
    yawTarget: Math.PI,
    dist: FOLLOW_DIST,
    look: new THREE.Vector3(),
    camPos: new THREE.Vector3(),
    tmpP: new THREE.Vector3(),
    crowdFrom: new THREE.Vector3(),
    tmpL: new THREE.Vector3(),
    proj: new THREE.Vector3(),
    nearbyAt: 0,
    index: new ProximityIndex(),
    actors: [] as Vec2[],
    entityList: [] as ProxEntity[],
    cutKey: "",
    // W5: kamera optiği (girişte saklanır, çıkışta geri), baş sallanması fazı, fotoğraf kamerası
    baseFov: 0,
    baseNear: 0,
    bob: 0,
    photo: false,
    pf: { x: 0, z: 0, yaw: 0, pitch: 0.4, dist: FOLLOW_DIST },
    // WALK-SCALE: serbest bakış eğimi (+ yukarı), yörünge pivotu, bakış yönü
    pitch: LOOK_DEFAULT,
    lift: 0, // duran avatarın önündeki yüksek simge için ek kamera eğimi (lmLift.ts)
    pivot: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    // WALK-PHYS: kameranın izlediği taban yüksekliği (yumuşatılmış)
    camY: 0,
    // INTERIOR-VIEW: uygulanan alan kuralının anahtarı ("" dış dünya); değişince kamera yeni alana oturur (`settle`)
    ruleKey: "",
    settle: false,
    // INTERIOR-CAM: ortam profili — karışmış mesafe/açı, uygulanan ve bekleyen profil (sıçramasın diye 0,35 sn kararlılık), ortam ölçümü
    prof: createProfileBlend(),
    profSnap: true,
    profWant: "street" as CamSpace,
    profSince: 0,
    profKey: "",
    profEnv: { runX: 9, runZ: 9, open: 1, ceiling: Infinity },
    entryAim: false,
    // WALK-ZOOM: kuş bakışı payı (hedef, yumuşatılmış) ve kuş bakışı kamera noktası
    air: 0, airK: 0, airP: new THREE.Vector3(),
    // WORLD-FIX: yörünge yakın bölgesi kesiti açık mı (yürüme kapalıyken)
    orbitCut: false,
    // takip kamerası çözümü (kare başı yeniden kullanılır), göz yedeğinde mi, avatar yakın kamera yüzünden gizli mi
    follow: { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, mode: "orbit", dist: 0 } as FollowCam,
    near: false,
    hideNear: false,
    // manzara kipi (null: kapalı)
    shot: null as LandmarkShot | null,
    // UXF-B: kadrajı kurulmuş olta noktası
    fishSpot: null as FishSpot | null,
    // ACTIVITY-FEEL (B8): kadrajı kurulmuş ritüel isteği (`ritualCam.key`)
    ritualKey: 0,
    // ACTIVITY-CAM: etkinlik kadrajı (önden 3/4, göz hizası) ve etkinlikten önceki kamera (bitince geri döner)
    act: null as { pick: FramingPick; x: number; z: number; footY: number; saved: { yaw: number; pitch: number; dist: number }; end: number; /** olta kadrajı*/ fish?: boolean;
      /** kesmeden sonra kolun çözülmüş boya oturacağı kare sayısı (ilk karenin kısa hedefinden yavaş uzamasın)*/ snap?: number } | null,
    // UXF-D: şehir yolculuğunda izlenen araç yönü (null: yolculuk yok) ve kamera çözümü
    rideHeading: null as number | null,
    rideCam: { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0 } as RideCam,
    rideYaw: createRideYaw(), // RIDE-UX: yolculuk kamerasının sönümlü yaw durumu
    rideEst: 1 as 0 | 1 | -1, // tanıtım çekiminin yanı (0: tanıtım yok)
    rideT: 0, rideProbeAt: 0, rideBlocked: false, // tanıtım → takip geçişinin etkin saati; takip pozu kapalı mı
    rideAdj: null as RideAdj | null, rideElev: 0, rideAdjAt: 0, // HQA-FIX: çarpışma ayarı hedefi, uygulanan yükseliş, son ölçüm
    // otomatik rota izlemesi — son kullanıcı çevirmesi, izleme açık mı, örtü ölçüsü zamanı ve istenen yaw
    userYawAt: -Infinity, routeOn: false, routeProbeAt: 0, routeWant: 0,
    // CAMERA: yaylı kol durumu (camera/rig.ts)
    arm: createCamRig(),
  });
  const { scene } = useThree();

  // tıkla-git: depo hedefi değişince yol planla
  useEffect(() => useWalkStore.subscribe((s, prev) => {
    if (s.target === prev.target) return;
    const a = walkRuntime.avatar;
    // UXF-E · HQA-FIX: tıkla-git rotası hiçbir tetik karosundan (kapı, geçit, portal, merdiven) geçmez (hedefse geçer)
    setRoute(a, s.target ? planRoute(built, a, s.target, { climb: true, avoid: routeAvoid(s.world, built) }) : null);
  }), [built]);

  // WALK-PHYS: taşıtların yürüme uyumu (örnek başına gerçek boy) bu dünyaya bağlanır; ilk girişte hesaplanır (≤ ~30 ms)
  const fitBound = useRef<Built | null>(null);

  // dünya değişince (büyüme): taban kaydıysa avatar da aynı kadar kayar — sahne ayağının altından kaymaz; sonra
  // yürünemez yerde kaldıysa düzelt. Taban kayması konum kaydı için `walkRuntime.baseOffset`'e yazılır (taban göreli kayıt).
  const lastOffset = useRef<Tile | null>(null);
  useEffect(() => {
    const off = baseOffset(built);
    const prev = lastOffset.current ?? off;
    lastOffset.current = off;
    walkRuntime.baseOffset = off;
    if (!useWalkStore.getState().active) return;
    const a = walkRuntime.avatar;
    a.x += off[0] - prev[0]; a.z += off[1] - prev[1];
    const p = unstick(navGrid(built), a);
    a.x = p.x; a.z = p.z; a.route = null;
  }, [built]);

  // CORE-WALK (REAL-SEAT): ritüel oturağı seçilirken ajanın oturduğu/durduğu oturak dolu sayılır
  useEffect(() => {
    if (!live) return;
    const at = (x: number, z: number) => { for (const p of live.positions.values()) if (Math.hypot(p.x - x, p.z - z) < 0.4) return true; return false; };
    seatOccupancy.at = at;
    return () => { if (seatOccupancy.at === at) seatOccupancy.at = null; };
  }, [live]);

  // sökülürken kamera ve denetim geri
  useEffect(() => () => {
    const s = st.current;
    if (s.snap) restoreOrbit(controls.current, camera, s.snap);
    s.snap = null;
    restoreOptics(camera as THREE.PerspectiveCamera, s);
    walkRuntime.live = false; walkRuntime.visible = false; walkRuntime.humanScale = 1;
    resetCutaway(cutawayUniforms);
    s.shot = null; endShot();
  }, [camera, controls]);

  // hafif "yürüyor" işareti (oyun katmanı kutlamaları ve tanıtım bildirimlerini yürüme bitene dek bekletir)
  useEffect(() => {
    setWalkPresence(useWalkStore.getState().active);
    const un = useWalkStore.subscribe((s, p) => { if (s.active !== p.active) setWalkPresence(s.active); });
    return () => { un(); setWalkPresence(false); };
  }, []);

  // L manzara kipini açar/kapatır, Esc kipten çıkar (yürüme modundan değil). Pencere yakalama evresi: input.ts'in dünya kabı
  // dinleyicisinden önce; yalnız dünya kabı odaktayken (L için bilgi kartının içi de). Yazı alanı, değiştirici tuş ve tekrar yok.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const isL = e.code === "KeyL" || (!e.code && (e.key === "l" || e.key === "L"));
      const isEsc = e.key === "Escape" || e.code === "Escape";
      if (!isL && !isEsc) return;
      const ws = useWalkStore.getState();
      if (!ws.active || ws.photo) return;
      const app = gl.domElement.closest("[role=\"application\"]");
      const t = e.target as HTMLElement | null;
      const onWorld = !!app && t === app;
      const inCard = !!t?.closest?.("[data-walk-info]");
      if (isEsc) {
        // dünya kabı ya da HUD'daki "Manzara · Dön" düğmesi odaktayken (yürüme modundan çıkmasın)
        if (!(onWorld || t?.closest?.("[data-walk-view-back]")) || !(landmarkView.active || landmarkView.request)) return;
        e.preventDefault(); e.stopImmediatePropagation();
        stopLandmarkView();
        return;
      }
      if (!onWorld && !inCard) return;
      e.preventDefault(); e.stopImmediatePropagation();
      toggleLandmarkView();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [gl]);

  // WALK-SCALE: fare ile serbest bakış (sürükleme; birinci şahısta işaretçi kilidi). Dokunma gestures.ts'te.
  useEffect(() => {
    const el = gl.domElement;
    let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
    const locked = () => document.pointerLockElement === el;
    const swallowClick = () => {
      const stop = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };
      window.addEventListener("click", stop, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 400);
    };
    const usable = () => { const st = useWalkStore.getState(); return st.active && !st.photo && !st.editor; };
    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch" || !usable() || locked()) return;
      if (e.button !== 0 && e.button !== 2) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    };
    const move = (e: PointerEvent) => {
      if (locked()) {
        if (!usable()) return;
        walkRuntime.yawDelta -= e.movementX * MOUSE_YAW;
        walkRuntime.lookDelta -= e.movementY * MOUSE_PITCH;
        return;
      }
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < DRAG_SLOP) return;
        drag.moved = true;
        try { el.setPointerCapture(e.pointerId); } catch { /* yoksay */ }
      }
      walkRuntime.yawDelta -= dx * MOUSE_YAW;
      walkRuntime.lookDelta -= dy * MOUSE_PITCH;
      drag.x = e.clientX; drag.y = e.clientY;
    };
    const up = (e: PointerEvent) => {
      if (locked()) { swallowClick(); return; } // kilitliyken tıklama eski imleç konumuna "oraya git" demesin
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved;
      drag = null;
      try { el.releasePointerCapture(e.pointerId); } catch { /* yoksay */ }
      if (moved) { swallowClick(); return; }
      // birinci şahısta tıklama: işaretçi kilidi (fare bakışı; Esc bırakır). Tıkla-git yerine geçer.
      const st = useWalkStore.getState();
      if (e.button === 0 && st.view === "first" && usable() && typeof el.requestPointerLock === "function") {
        swallowClick();
        try { const r = el.requestPointerLock() as unknown as Promise<void> | undefined; r?.catch?.(() => {}); } catch { /* izin yok */ }
      }
    };
    const menu = (e: Event) => { if (useWalkStore.getState().active) e.preventDefault(); };
    const lockChange = () => { if (!locked()) walkRuntime.lockReleasedAt = performance.now(); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("contextmenu", menu);
    document.addEventListener("pointerlockchange", lockChange);
    // mod kapanınca, fotoğraf moduna ya da üçüncü şahsa geçince kilit bırakılır
    const unsub = useWalkStore.subscribe((st) => { if (locked() && (!st.active || st.photo || st.view !== "first" || st.editor)) document.exitPointerLock(); });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("contextmenu", menu);
      document.removeEventListener("pointerlockchange", lockChange);
      unsub();
      if (locked()) document.exitPointerLock();
    };
  }, [gl]);

  useFrame((_state, delta) => {
    const s = st.current;
    const store = useWalkStore.getState();
    const calm = reducedMotion();
    const now = performance.now();
    const veilWas = cityLifeRuntime.veil; cityLifeRuntime.veil = false; // figüran perdesi yalnız takip kolu bu karede isterse; önceki kare histerezis için
    const ctl = controls.current;
    // WALK-SCALE: karakter/taşıt ölçeği (giriş ve çıkışta 600 ms; hareket azaltmada kesme)
    walkRuntime.humanScale = approachScale(walkRuntime.humanScale, store.active ? WALK_HUMAN_SCALE : 1, Math.min(delta, 0.1), calm);

    // ---- giriş / çıkış geçişleri
    if (store.active && !s.wasActive) {
      s.wasActive = true;
      s.snap = lockOrbit(ctl, camera);
      const p = store.pose ?? spawnPose(built, core);
      const a = walkRuntime.avatar;
      Object.assign(a, createAvatar(p.x, p.z, p.heading));
      const fix = unstick(navGrid(built), a);
      a.x = fix.x; a.z = fix.z;
      // WALK-PHYS: ayak yüksekliği ilk adımda zemine oturur (stepVertical yerdeyken yüzeye çıkar); kamera tabanı sıfırdan
      s.camY = 0; walkRuntime.drawY = 0; walkRuntime.jump = 0;
      // kamera avatarın arkasında, mevcut bakış yönüne en yakın 45° adımda başlar
      // kamera doğma pozunun bakış yönünde (avatarın arkasında) başlar — sahnede `sceneSpawnPose` açık görüşlü yönü seçer
      // HQA-FIX: arkası kapalıysa (kayıtlı konum dar sokakta, tezgâh/duvar dibinde) kolu açık en yakın yaw — kamera başa yapışmaz
      s.yaw = s.yawTarget = clearAimYaw(framingArm(built, camera as THREE.PerspectiveCamera, a.ground, 0, a.x, a.z), { x: a.x, y: LOOK_Y, z: a.z }, p.heading, FOLLOW_DIST, Math.max(ORBIT_MIN, -LOOK_DEFAULT));
      s.dist = FOLLOW_DIST; s.air = 0; s.airK = 0; // WALK-ZOOM
      s.pitch = LOOK_DEFAULT; walkRuntime.lookDelta = 0;
      s.glide = calm ? null : { fromP: camera.position.clone(), fromL: (ctl?.target ?? s.look).clone(), t0: now, dur: TRANSITION_MS, exit: false };
      s.cutKey = ""; s.ruleKey = "";
      s.act = null; activityCam.kind = null; activityCam.pick = null; // ACTIVITY-CAM
      const pc = camera as THREE.PerspectiveCamera;
      s.baseFov = pc.fov; s.baseNear = pc.near; s.bob = 0; s.photo = false;
      walkRuntime.yawDelta = 0; walkRuntime.pitchDelta = 0; walkRuntime.zoomMul = 1;
      walkRuntime.live = true;
      walkRuntime.moods = live?.moods ?? null;
    } else if (!store.active && s.wasActive) {
      s.wasActive = false;
      walkRuntime.live = false; walkRuntime.visible = false;
      s.air = 0; s.airK = 0; walkZoom.k = 0; walkZoom.extra = 0; applyAirFog(scene.fog as { near: number; far: number } | null, 0, 0); // WALK-ZOOM: sis tabana
      resetCutaway(cutawayUniforms);
      restoreOptics(camera as THREE.PerspectiveCamera, s);
      cancelEmote(); s.photo = false;
      s.shot = null; endShot();
      if (s.snap) {
        if (calm) { restoreOrbit(ctl, camera, s.snap); s.snap = null; s.glide = null; }
        else s.glide = { fromP: camera.position.clone(), fromL: s.look.clone(), t0: now, dur: TRANSITION_MS, exit: true };
      }
    }

    // çıkış kayması: kamera yörünge pozuna döner, sonunda denetim açılır
    if (!store.active) {
      const g = s.glide;
      if (g?.exit && s.snap) {
        const k = Math.min(1, (now - g.t0) / g.dur), e = ease(k);
        camera.position.lerpVectors(g.fromP, s.snap.pos, e);
        s.tmpL.lerpVectors(g.fromL, s.snap.target, e);
        camera.lookAt(s.tmpL);
        if (k >= 1) { restoreOrbit(ctl, camera, s.snap); s.snap = null; s.glide = null; }
      } else orbitNearCut(built, camera, s);
      return;
    }

    if (fitBound.current !== built) { fitBound.current = built; bindMoverWorld(built); }

    // ---- manzara kipi (avatar yerinde; kamera simgeyi çerçeveler). Çıkışta takip kamerasına kayarak döner.
    if (landmarkView.request || s.shot) {
      const pc0 = camera as THREE.PerspectiveCamera;
      const fov0 = walkFov(useWalkFov.getState().fov, pc0.aspect || 1), aspect0 = pc0.aspect || 1;
      const req = landmarkView.request;
      landmarkView.request = null;
      if (req && !store.photo && !walkRuntime.ride) {
        const a0 = walkRuntime.avatar;
        let t: LandmarkViewTarget | null = req.target;
        if (!t) { const c = landmarkViewSources.card?.() ?? null; t = viewableTarget(c) ? c : pickViewTarget(viewTargets(built, useWalkStore.getState().world ?? "scene"), a0, s.yaw); }
        if (t) {
          const q = viewBox(built, t), box = q.box, minY = viewMinY(box, a0.ground, t.y0); // HORIZON: dürbün hedefinin zemini
          const sol = solveView(box, { vfov: fov0, aspect: aspect0, avatar: a0, query: q.score, minY, swing: calm ? 0 : VIEW_SWING });
          s.shot = { key: t.key, box, yaw: sol.yaw, yawTarget: sol.yaw, elev: sol.elev, dist: sol.dist, zoom: 1, minY, t0: now, fov: fov0, aspect: aspect0,
            view: store.view, ruleKey: rule0Key(), enter: calm ? null : { fromP: camera.position.clone(), fromL: s.look.clone(), t0: now, dur: VIEW_ENTER_MS, exit: false } };
          // tıkla-git / seyir noktası yürüyüşü kipte durur (yeni bir hedef kipten çıkarır)
          setRoute(a0, null); a0.speed = 0;
          shotGoal = store.target ? [store.target[0], store.target[1]] : null; shotGoalAt = now; // HQA-FIX
          if (store.target) store.setTarget(null);
          walkRuntime.yawDelta = 0; walkRuntime.yawSteps = 0; walkRuntime.zoomSteps = 0; walkRuntime.zoomMul = 1; walkRuntime.lookDelta = 0;
          landmarkView.active = true;
          useLandmarkView.setState({ active: true, key: t.key, rect: { ...t.rect } });
        } else if (!s.shot) useLandmarkView.setState({ missAt: now });
      }
      const shot = s.shot;
      if (shot) {
        const mv = combineInput(walkRuntime.input, walkRuntime.joy);
        // şehir haritası uzak hedefi yeniden planlarken (CityRig `goal`) kipten önce kesilen aynı hedefi yeniden yazar: yok sayılır
        let tg = useWalkStore.getState().target;
        // HQA-FIX: yalnız kipin ilk SHOT_GOAL_ECHO_MS'deki yankı yok sayılır; sonra aynı hedef yeni bir istektir ("git ve aç"
        // yeniden yürümesi): kip kapanır, avatar yürür — eskiden aynı hedef her seferinde silinip avatar kipte sonsuza dek bekliyordu
        if (tg && shotGoal && tg[0] === shotGoal[0] && tg[1] === shotGoal[1] && now - shotGoalAt < SHOT_GOAL_ECHO_MS) { useWalkStore.getState().setTarget(null); setRoute(walkRuntime.avatar, null); tg = null; }
        const leave = landmarkView.stop || store.photo || !!tg || !!walkRuntime.ride || walkRuntime.jump > 0 || Math.hypot(mv.x, mv.y) > 0.05
          || store.view !== shot.view || rule0Key() !== shot.ruleKey;
        if (leave) {
          s.shot = null; endShot();
          // takip kamerasına dönüş: bu konumdan kayma (hareket azaltmada kesme); yaw avatarın arkasına
          if (calm) s.settle = true;
          else s.glide = { fromP: camera.position.clone(), fromL: s.look.clone(), t0: now, dur: TRANSITION_MS, exit: false };
        } else {
          const dt0 = Math.min(delta, 0.25);
          // Q/E ve sürükleme simgenin çevresinde döndürür; +/− ve kıstırma yakınlaştırır; eğim girdisi yok sayılır
          if (walkRuntime.yawSteps) { shot.yawTarget += walkRuntime.yawSteps * (Math.PI / 4); walkRuntime.yawSteps = 0; }
          if (walkRuntime.yawDelta) { shot.yawTarget += walkRuntime.yawDelta; shot.yaw += walkRuntime.yawDelta; walkRuntime.yawDelta = 0; }
          if (walkRuntime.zoomSteps) { shot.zoom *= Math.pow(1.15, walkRuntime.zoomSteps); walkRuntime.zoomSteps = 0; }
          if (walkRuntime.zoomMul !== 1) { shot.zoom *= walkRuntime.zoomMul; walkRuntime.zoomMul = 1; }
          shot.zoom = THREE.MathUtils.clamp(shot.zoom, 0.75, 2);
          walkRuntime.lookDelta = 0; walkRuntime.pitchDelta = 0;
          shot.yaw = calm ? shot.yawTarget : shot.yaw + (shot.yawTarget - shot.yaw) * (1 - Math.exp(-dt0 * 4));
          // görüş açısı ya da tuval oranı değişince uzaklık yeniden sığdırılır
          if (Math.abs(fov0 - shot.fov) > 0.05 || Math.abs(aspect0 - shot.aspect) > 0.01) {
            shot.fov = fov0; shot.aspect = aspect0; shot.dist = swingDist(shot.box, shot.yawTarget, shot.elev, fov0, aspect0, calm ? 0 : VIEW_SWING);
          }
          if (Math.abs(pc0.fov - fov0) > 0.05 || pc0.near !== WALK_NEAR) { pc0.fov = fov0; pc0.near = WALK_NEAR; pc0.updateProjectionMatrix(); }
          // yavaş sağa-sola yörünge (ilk 2 sn yumuşak başlar); hareket azaltmada sabit çerçeve
          const tt = (now - shot.t0) / 1000;
          const sway = calm ? 0 : VIEW_SWING * Math.sin((2 * Math.PI * tt) / VIEW_PERIOD) * Math.min(1, tt / 2);
          const cam = viewCam(shot.box, shot.yaw + sway, shot.elev, shot.dist * shot.zoom);
          s.tmpP.set(cam[0], Math.max(cam[1], shot.box.y0 + 0.5), cam[2]);
          s.tmpL.set((shot.box.x0 + shot.box.x1) / 2, (shot.box.y0 + shot.box.y1) / 2, (shot.box.z0 + shot.box.z1) / 2);
          const g = shot.enter;
          if (g) {
            const k = Math.min(1, (now - g.t0) / g.dur), e = ease(k);
            s.camPos.lerpVectors(g.fromP, s.tmpP, e); s.look.lerpVectors(g.fromL, s.tmpL, e);
            if (k >= 1) shot.enter = null;
          } else { s.camPos.copy(s.tmpP); s.look.copy(s.tmpL); }
          // LOOKOUT-CAM-001: kamera (yakın düzlem küresi) yörüngenin ve giriş kaymasının hiçbir anında bir katının içinde durmaz
          const cv = clearViewCam([s.camPos.x, s.camPos.y, s.camPos.z], [s.look.x, s.look.y, s.look.z], cameraSource(built), probeRadius(WALK_NEAR, fov0, aspect0), shot.minY);
          s.camPos.set(cv[0], cv[1], cv[2]);
          camera.position.copy(s.camPos);
          camera.lookAt(s.look);
          // kesit: simgenin kameraya bakan yüzünden kameraya giden doğruları kesen bloklar bütün açılır (sokak kesiti birimleri)
          writeCutPlan(cutawayUniforms, viewCutPlan(shot.box, [s.camPos.x, s.camPos.y, s.camPos.z], shot.minY));
          const a1 = walkRuntime.avatar;
          a1.speed = 0;
          const headY = walkRuntime.drawY + HEAD_CENTER_Y * (walkRuntime.humanScale / WALK_HUMAN_SCALE);
          walkRuntime.visible = headDistance(s.camPos, a1, headY) >= CAM_SHOW_DIST;
          walkRuntime.photoFocus.ok = false;
          if (live) { live.camTarget.x = s.look.x; live.camTarget.z = s.look.z; }
          s.cutKey = "";
          return;
        }
      }
    }

    // ---- girdi tüketimi (Q/E, +/−; W5: fotoğraf kamerası, iki parmak)
    const photo = store.photo;
    const pf = s.pf;
    if (photo && !s.photo) {
      // fotoğraf moduna giriş: odak avatar, açı ve mesafe o anki takip kamerasından
      const a0 = walkRuntime.avatar;
      // etkinlik (yeme/içme) kadrajı sürerken s.yaw/s.dist/s.pitch kadrajın değerleri (<city> çay evi: 1,76 m) — foto kamerası etkinlikten ÖNCEKİ takip kamerasından başlar
      const ra = s.act && !s.act.fish && Math.abs(s.dist - s.act.pick.dist) < 1e-3 ? s.act.saved : null;
      pf.x = a0.x; pf.z = a0.z; pf.yaw = ra ? ra.yaw : s.yaw; pf.dist = store.view === "first" ? FOLLOW_DIST : ra ? ra.dist : s.dist;
      pf.pitch = THREE.MathUtils.clamp(ra ? -ra.pitch : -s.pitch, PHOTO_PITCH[0], PHOTO_PITCH[1]);
      // giriş yaw'ında kol tezgâh/duvara çöküyorsa (<city> tezgâhı: ekran düz duvar) kolu açık en yakın yaw'a döner
      pf.yaw = clearAimYaw(framingArm(built, camera as THREE.PerspectiveCamera, a0.ground, s.camY, a0.x, a0.z), { x: a0.x, y: LOOK_Y + s.camY, z: a0.z }, pf.yaw, pf.dist, pf.pitch);
      setRoute(a0, null);
    }
    if (!photo && s.photo) { s.yaw = s.yawTarget; }
    s.photo = photo;
    if (photo) {
      if (walkRuntime.yawSteps) { pf.yaw += walkRuntime.yawSteps * (Math.PI / 8); walkRuntime.yawSteps = 0; }
      if (walkRuntime.zoomSteps) { pf.dist *= Math.pow(1.15, walkRuntime.zoomSteps); walkRuntime.zoomSteps = 0; }
      pf.yaw += walkRuntime.yawDelta; walkRuntime.yawDelta = 0;
      pf.pitch += walkRuntime.pitchDelta; walkRuntime.pitchDelta = 0;
      pf.dist *= walkRuntime.zoomMul; walkRuntime.zoomMul = 1;
      pf.dist = THREE.MathUtils.clamp(pf.dist, PHOTO_DIST[0], PHOTO_DIST[1]);
      pf.pitch = THREE.MathUtils.clamp(pf.pitch, PHOTO_PITCH[0], PHOTO_PITCH[1]);
    } else {
      // WALK-ZOOM: tekerlek, +/−, kıstırma tek eksende: takip mesafesi, profil sınırının ötesinde (açık havada) kuş bakışı; Z / düğme aç-kapa
      const airOk = store.view !== "first" && !s.act && !rideRuntime.ride && !walkRuntime.ride && airAllowed(s.prof.id, !!walkCamera.rule && (walkCamera.rule.space === "room" || walkCamera.rule.space === "hall"));
      if (walkZoom.toggle) { walkZoom.toggle = false; const z = toggleAir(s.air, s.prof.distMax, s.prof.dist, airOk); s.dist = z.dist; s.air = z.air; }
      if (walkRuntime.zoomSteps || walkRuntime.zoomMul !== 1) {
        const z = applyZoom(s.dist, s.air, walkRuntime.zoomSteps * Math.log(ZOOM_STEP) + Math.log(walkRuntime.zoomMul), s.prof.distMin, s.prof.distMax, airOk);
        s.dist = z.dist; s.air = z.air; walkRuntime.zoomSteps = 0; walkRuntime.zoomMul = 1;
      }
      if (!airOk) s.air = 0;
      if (walkZoom.allowed !== airOk || walkZoom.on !== s.air > 0.5) { walkZoom.allowed = airOk; walkZoom.on = s.air > 0.5; emitWalkZoom(); }
      if (walkRuntime.yawSteps) {
        s.yawTarget += walkRuntime.yawSteps * (Math.PI / 4);
        if (walkRuntime.yawSnap || calm) s.yaw = s.yawTarget;
        walkRuntime.yawSteps = 0;
        s.userYawAt = now; // kullanıcı çevirdi → otomatik rota izlemesi bir süre durur
      }
      // W5: iki parmak çevirme (sürekli; parmağı izler, gecikme yok) ve kıstırma
      if (walkRuntime.yawDelta) { s.yawTarget += walkRuntime.yawDelta; s.yaw = s.yawTarget; walkRuntime.yawDelta = 0; s.userYawAt = now; }
      if (walkRuntime.zoomMul !== 1) { s.dist = THREE.MathUtils.clamp(s.dist * walkRuntime.zoomMul, s.prof.distMin, s.prof.distMax); walkRuntime.zoomMul = 1; } // INTERIOR-CAM: profil sınırları
      walkRuntime.pitchDelta = 0;
      // WALK-SCALE: serbest bakış eğimi (anında; girdi zaten ayrık, hareket azaltmada da yumuşatma yok)
      if (walkRuntime.lookDelta) { s.pitch = clampLook(s.pitch + walkRuntime.lookDelta); walkRuntime.lookDelta = 0; }
    }
    if (photo) walkRuntime.lookDelta = 0;
    if (walkRuntime.zoomSteps) {
      s.dist = THREE.MathUtils.clamp(s.dist * Math.pow(1.15, walkRuntime.zoomSteps), s.prof.distMin, s.prof.distMax); // INTERIOR-CAM: profil sınırları
      walkRuntime.zoomSteps = 0;
    }
    // INTERIOR-VIEW: alan kuralı değişti (iç mekân katı / dış dünya) → takip mesafesi ve yön yeni alana; kamera bu karede oturur
    // (kayma yok: geçiş kararma altında, hareket azaltmada kararmasız anlık kesme)
    const rule = walkCamera.rule;
    // merdiven geçişi: dünya düşeyde kaydı (yeni kat y = eski + dy) → kamera, bakış ve çizim yüksekliği aynı kadar kayar (görünmez)
    const carry = walkCamera.carry;
    if (walkCamera.shift) {
      const dy = walkCamera.shift;
      walkCamera.shift = 0;
      s.camY += dy; s.camPos.y += dy; s.look.y += dy; walkRuntime.drawY += dy;
    }
    walkCamera.carry = false;
    if ((rule?.key ?? "") !== s.ruleKey) {
      s.ruleKey = rule?.key ?? "";
      s.dist = rule ? rule.dist : FOLLOW_DIST; s.air = 0; s.airK = 0; // WALK-ZOOM: yeni alanda takip kamerası
      s.profSnap = !carry; s.profKey = ""; // INTERIOR-CAM: yeni alanın profili bu karede oturur (kararma altında)
      s.entryAim = !carry && !!rule && (rule.space === "room" || rule.space === "hall"); // INTERIOR-CAM: girişte açık kol yönü
      if (!carry) {
        // şehir sokağına varışta kamera avatarın bakış yönünde (varış yönü `arrivalView.ts`)
        if (rule?.space === "street") { s.yaw = s.yawTarget = walkRuntime.avatar.heading; s.pitch = LOOK_DEFAULT; }
        else if (rule?.space === "court") { s.yaw = s.yawTarget = walkRuntime.avatar.heading; s.pitch = CAMERA_PROFILES.courtyard.pitch; } // COURTYARD-PORTAL: avatarın arkasından cepheye
        else if (rule && rule.space !== "deck") { s.yaw = s.yawTarget = Math.PI; s.pitch = CAMERA_PROFILES[rule.space === "hall" ? "hall" : "interior"].pitch; }
        else if (rule) { s.yaw = s.yawTarget = walkRuntime.avatar.heading; s.pitch = DECK_PITCH; }
        else { s.yaw = s.yawTarget = walkRuntime.avatar.heading; s.pitch = LOOK_DEFAULT; } // ARRIVAL-QA: iç mekândan dışarı — kamera avatarın arkasına (kapıya/cepheye bakmaz)
        s.settle = !s.glide;
      }
      s.cutKey = "";
    }
    // seyir karosuna varış — karakter/kamera bakış hedefine yumuşak döner (hareket azaltmada anında); fareyle çevirme
    // (kullanıcı) döndürmeyi bırakır (walk/viewTurn.ts)
    if (viewTurn.on) {
      const vf = store.view === "first";
      // durak yön dönüşü (AIM_TURN_KEY) fotoğrafa girince kalan yaw'a oturur (yarıda kalmaz); oyuncu yürürse dönüş biter (girdiyle kavga etmez)
      const aimTurn = viewTurn.key === AIM_TURN_KEY;
      if (aimTurn && photo) { s.yaw = s.yawTarget = s.yaw + angDiff(viewTurn.yaw, s.yaw); cancelViewTurn(); }
      else if (s.userYawAt > viewTurn.t0 || photo || (aimTurn && Math.hypot(walkRuntime.input.x + walkRuntime.joy.x, walkRuntime.input.y + walkRuntime.joy.y) > 0.1)) cancelViewTurn();
      else {
        // birinci şahıs: yaw + eğim; üçüncü şahıs: yalnız yaw (karakter hedefe döner, kamera arkasından; eğim yörünge yüksekliği)
        const v = stepViewTurn({ yaw: s.yaw, pitch: s.pitch }, { yaw: viewTurn.yaw, pitch: vf ? viewTurn.pitch : s.pitch }, Math.min(delta, 0.25), calm);
        s.yaw = s.yawTarget = s.yaw + angDiff(v.yaw, s.yaw); s.pitch = v.pitch;
        if (!vf && !aimTurn) walkRuntime.avatar.heading = s.yaw; // durak yön dönüşü yalnız kamerayı çevirir (eski anlık kesme gibi)
        if (v.done) cancelViewTurn();
      }
    }
    // UXF-D: şehirden ofise dönüş karesi (InteriorRig `framedYaw`): kamera seçilen yöne, varsayılan eğim ve mesafeyle oturur
    if (walkCamera.aim !== null) {
      // HQA-FIX: istenen yönün arkasında kol kapalıysa (durak saçağı, turnike, vagon) en yakın açık yaw
      const a2 = walkRuntime.avatar, pc2 = camera as THREE.PerspectiveCamera;
      // güvertede birinci şahısta kol yok — istenen yön (asansörden çıkış: dışarı) aynen kalır; eskiden arkadaki galeri duvarı
      // "kol kapalı" sayılıp bakış halka boyunca/içeri çevriliyordu
      const deckFirst = rule?.space === "deck" && useWalkStore.getState().view === "first";
      const aim = deckFirst || walkCamera.aimExact ? walkCamera.aim : clearAimYaw(framingArm(built, pc2, a2.ground, s.camY, a2.x, a2.z), { x: a2.x, y: LOOK_Y + s.camY, z: a2.z }, walkCamera.aim, FOLLOW_DIST, Math.max(ORBIT_MIN, -LOOK_DEFAULT));
      // perdesiz istek (F ile durak paneli, panelsiz durak varışı) tek karede 65–180° çevirmez — yumuşak döner (
      // `viewTurn`, ~0,5 sn); kararma altında (hızlı seyahat, kapı) ya da hareket azaltmada eskisi gibi anında oturur
      const veiled = calm || deckFirst || useInterior.getState().fade === 1 || Math.abs(angDiff(aim, s.yaw)) < AIM_TURN_MIN;
      if (veiled) s.yaw = s.yawTarget = aim; else { s.userYawAt = now; startViewTurn(s.yaw + angDiff(aim, s.yaw), LOOK_DEFAULT, AIM_TURN_KEY); }
      walkCamera.aim = null; walkCamera.aimExact = false; if (!viewTurn.on) s.userYawAt = now; // ARR-A: istenen yön oturdu — rota izleme varıştan sonra yaw'ı geri çevirip kolu avatarın başına indiriyordu (<city>); `ROUTE_USER_HOLD` sn izleme durur
      s.pitch = deckFirst ? DECK_PITCH : rule?.space === "court" ? CAMERA_PROFILES.courtyard.pitch : arrivalPitch(rule?.space, pc2.aspect); s.dist = FOLLOW_DIST; s.glide = null; s.cutKey = "";
      // iniş devri sürerken ya da perdesiz istekte (F paneli) eğim/mesafe tek karede oturmaz — devir; kararma altında kesme
      if (!calm && (s.hand || !veiled || walkCamera.aimHand)) s.hand = startHandoff(s.camPos, s.look, s.pivot); else s.settle = true;
      s.handRel = s.hand ? { x: s.camPos.x - s.pivot.x, y: s.camPos.y - s.pivot.y, z: s.camPos.z - s.pivot.z } : null; // devir ilk karesinden hız sınırlı (handRel null → armSafety o karede başa 0,2 m'ye çökertiyordu: <city> tekne biniş)
      walkCamera.aimHand = false; // durak paneli çapraz sıçrayışı kararma altında da devirle döner (scripts/ride_handoff.mjs STOP-HANDOFF)
      // COURTYARD-PORTAL: avluda cepheye hafif yukarı; INTEGG3: dikey ekranda güverte şehre
    }
    // ACTIVITY-CAM: etkinlik bitti (ritüel bitişi ya da iptal) — yeme/içme bitişinde mutlu yüz için `LINGER_MS` kadraj kalır, sonra
    // (ya da avatar yürüyünce hemen) kamera etkinlikten önceki yaw/eğim/mesafesine döner; kullanıcı arada çevirdiyse o eksen kalır.
    // Olta/mini oyun başlarsa geri dönüş yok (kendi kadrajı). Hareket azaltmada anlık.
    // olta kadrajı olta sürdükçe kalır; olta bırakılınca aynı geri dönüş (bekleme yok)
    if (s.act && !ritualFx.active && !(s.act.fish && mgActor.kind === "fishing" && !photo)) {
      const rnow = ritualRuntimeOpts.now(); // ritüel saati (ritualFeel.doneAt ile aynı)
      if (!s.act.end) s.act.end = s.act.fish ? rnow : ritualFeel.doneAt ? ritualFeel.doneAt + LINGER_MS : rnow;
      const walking = walkRuntime.avatar.speed > 0.15 || !!walkRuntime.ride;
      if ((mgActor.kind && !s.act.fish) || photo) { s.act = null; activityCam.kind = null; }
      else if (!activityHolds({ walking, seated: !s.act.fish && !!walkRuntime.sit, now: rnow, end: s.act.end })) { // oturdukça kadraj kalır
        Object.assign(s, activityRestore(s, s.act.pick, s.act.saved)); // kesme son yaw'a iner (ara yaw tek kare göz yedeği)
        s.act = null; activityCam.kind = null; activityCam.restoring = true;
        s.settle = true; // etkinlik kamerası → takip: kesme. Gecikmeli konum yeni pivottan süpürülünce tezgâha/oturağa değip başa 0,5 m'ye çöküyordu
      }
    }
    // UXF-B: olta başlayınca avatar olta karosuna oturur ve kamera suya bakar (<city>'da kamera sudan karaya bakıyordu).
    // (ürün sahibi "45° sağ ya da sol yan açı, arkadan değil"): eski B7 kuralı (`actionCam.ts`, yaw = bakış ± 45° → kamera
    // arkadan ±45°, kafa dibinde) yerine etkinlik kadrajı: kamera karakterin ÖNÜNDEN 45° yanda (sağ ya da sol; duvara gömülmeyen),
    // yüz + olta + şamandıra kadrajda (`activityFraming.ts` `fish`). Olta bitince önceki kameraya döner. Hareket azaltmada anlık.
    const fishing = mgActor.kind === "fishing" ? mgActor.fish : null;
    if (fishing !== s.fishSpot) {
      s.fishSpot = fishing;
      if (fishing && !photo) {
        const a1 = walkRuntime.avatar;
        a1.x = tx(fishing.tile[0]); a1.z = tz(fishing.tile[1]); setRoute(a1, null); a1.heading = fishing.face;
        const pc0 = camera as THREE.PerspectiveCamera;
        const pick = pickActivityFraming(actionQuery(built), { x: a1.x, z: a1.z, footY: s.camY, heading: fishing.face, kind: "fish",
          targets: [{ x: fishing.bx, z: fishing.bz, y: fishing.by }], halfFov: framingHalf(pc0), vHalfFov: Math.max(0.2, (pc0.fov * Math.PI) / 360 - 0.06),
          lanes: moverLanes(built) /* HQA-FIX*/, armLen: framingArm(built, pc0, a1.ground, s.camY, a1.x, a1.z) });
        const saved = s.act ? s.act.saved : { yaw: s.yawTarget, pitch: s.pitch, dist: s.dist };
        s.act = { pick, x: a1.x, z: a1.z, footY: s.camY, saved, end: 0, fish: true };
        s.yawTarget = s.yaw + angleDiff(pick.yaw, s.yaw); s.pitch = pick.pitch; s.dist = pick.dist;
        if (calm) s.yaw = s.yawTarget;
        activityCam.key++; activityCam.kind = "fish"; activityCam.pick = pick; activityCam.restoring = false;
        clearActionCam();
      } else if (!fishing) clearActionCam();
    }
    // ACTIVITY-FEEL (B8): şehir ritüeli başlayınca (oturuş/konum) kamera eylemi yandan 45° gösterir — ritüel konumu (tezgâh,
    // masa) ve avatar kadrajda. Yeni istek `ritualCam.key` ile; ritüel bitince takip kamerası olduğu yerde kalır.
    if (ritualCam.key !== s.ritualKey) {
      s.ritualKey = ritualCam.key;
      if (!photo && ritualFx.active) {
        // ACTIVITY-CAM: yandan 45° (B8) yerine etkinlik kadrajı — karakterin önünden 3/4, göz hizası, 1,6–2,5 birim; üst beden,
        // eller, elde nesne, tezgâh ve satıcı kadrajda; duvara gömülen yan seçilmez, arkadan asla (`activityFraming.ts`).
        const a1 = walkRuntime.avatar, sit = walkRuntime.sit;
        const px = sit ? sit.x : a1.x, pz = sit ? sit.z : a1.z;
        const kind = ritualCam.def ? activityKindOf(ritualCam.def, ritualCam.sit) : "play";
        const targets = [...ritualCam.targets, ...(ritualCam.vendor ? [ritualCam.vendor] : [])].filter((t) => Math.hypot(t.x - px, t.z - pz) > 0.45);
        const pc0 = camera as THREE.PerspectiveCamera;
        const actors: { x: number; z: number }[] = [];
        if (live) for (const p of live.positions.values()) if (Math.hypot(p.x - px, p.z - pz) < 3) actors.push({ x: p.x, z: p.z });
        // yaylı kolun gerçek açık boyu + duvar kıskacı / çatı örtüsü (çatılı yerde — tapas barı — göze/omuza düşen aday geçersiz)
        const pick = pickActivityFraming(actionQuery(built), { x: px, z: pz, footY: s.camY, heading: ritualCam.heading, seatY: ritualCam.seatY, targets, kind, halfFov: framingHalf(pc0), actors,
          vHalfFov: Math.max(0.2, (pc0.fov * Math.PI) / 360 - 0.06), // HQA-FIX: yem noktası dikey kadrajda
          lanes: moverLanes(built) /* HQA-FIX*/, armLen: framingArm(built, pc0, a1.ground, s.camY, px, pz) });
        const saved = s.act ? s.act.saved : { yaw: s.yawTarget, pitch: s.pitch, dist: s.dist };
        s.act = { pick, x: px, z: pz, footY: s.camY, saved, end: 0, snap: 3 };
        s.yawTarget = s.yaw + angleDiff(pick.yaw, s.yaw); s.pitch = pick.pitch; s.dist = pick.dist;
        // kadraja kesme — 1,6–3 birimlik kolla karakterin çevresinde dönerken kamera oturak/tezgâh/başa çarpıp
        // yüze yapışıyordu (telefonda ekranın yarısı baş); simge eğimi ( `s.lift`) sıfırlanır (kadrajı tenteye kaldırıp kolu
        // 0,1 m'ye çökertiyordu) ve kol ilk karelerde çözülmüş boyuna oturur (`snap`; yavaş uzama yok)
        s.yaw = s.yawTarget; s.lift = 0;
        activityCam.key++; activityCam.kind = kind; activityCam.pick = pick; activityCam.restoring = false;
      }
    }
    // UXF-D: şehir haritası yolculuğu (vapur, tramvay, füniküler, teleferik…): kamera aracın arkasına ve biraz yanına geçer ve
    // rota dönünce onunla döner (Q/E payı korunur). Eskiden binişteki yaw kalıyordu: rota kameraya doğru gidince kamera avatarın
    // yüzüne bakıyor, arkadaki kamara karenin üstünü kaplıyordu. Çark yolculuğu (`walkRuntime.ride`, rideRuntime değil) değişmez.
    const cityRide = photo ? null : rideRuntime.ride;
    const dt = Math.min(delta, 0.25);
    // RIDE-UX (F2): yaw köşeli rota yönüne 10/sn ile yapışmaz (90° köşe ≈ 900°/sn dönüyordu) — yumuşatılmış araç yönü + türün
    // sapması, kritik sönümlü ve ≤ 40°/sn (hareket azaltmada 20°/sn); Q/E payı tavanla, sürükleme anında; boşta pay geri döner.
    // Biniş kararma altında başlar (store.ts boardLine): ilk karede kamera oturur (kesme).
    if (cityRide) {
      const side = rideSide(cityRide.plan.kind);
      if (s.rideHeading === null) {
        resetRideYaw(s.rideYaw, s.yaw + angleDiff(cityRide.heading + side, s.yaw));
        // kamera tek karede oturmaz (94–180° / 6–11 birim) — son kameradan tanıtım çekimine RIDE_HANDOFF sn'de döner
        s.hand = calm ? null : startHandoff(s.camPos, s.look, s.pivot); s.settle = !s.hand;
        // binişte yaylı kol yürüyüşün kısa boyundan yavaşça uzamaz (3 sn "kamara içi, kafa dolu" kesme) — sıfırlanır;
        // tanıtım çekimi kolu açık yandan (iskele binası/saçağı tarafı değil), iki yan kapalıysa tanıtım yok
        releaseArm(s.arm);
        s.rideT = 0; s.rideProbeAt = 0; s.rideBlocked = false;
        s.handRel = s.hand ? { x: s.camPos.x - s.pivot.x, y: s.camPos.y - s.pivot.y, z: s.camPos.z - s.pivot.z } : null; // devir ilk karesinden hız sınırlı (handRel null → armSafety o karede başa 0,2 m'ye çökertiyordu: <city> tekne biniş)
        // HQA-FIX: binişte (kararma altında) kamera çarpışma ayarına oturur — dar koridorda pencere pozu cepheye/tenteye çarpmaz
        s.rideAdj = rideAdjustNow(built, cityRide, walkRuntime.avatar.x, walkRuntime.avatar.z, s.camY, cityRide.heading, s.rideYaw.yaw, 0, camera as THREE.PerspectiveCamera, null);
        s.rideYaw.auto = s.rideYaw.off = s.rideAdj.dyaw; s.rideYaw.yaw = s.rideYaw.base + s.rideYaw.off; s.rideElev = s.rideAdj.elev; s.rideAdjAt = now;
        // tanıtım yanı, ayarlanmış takip pozuna (yaw/yükseliş) geçiş yoluyla birlikte seçilir
        s.rideEst = rideIntroSide(built, cityRide.plan.kind, walkRuntime.avatar.x, walkRuntime.avatar.z, s.camY, cityRide.heading, camera as THREE.PerspectiveCamera, s.rideYaw.yaw, s.rideElev);
      }
      else {
        // HQA-FIX: 4 Hz yeniden ölçülür; yaw payı denetleyicide (toplam tavan), yükseliş yumuşak
        if (now - s.rideAdjAt > 250) {
          s.rideAdjAt = now;
          s.rideAdj = rideAdjustNow(built, cityRide, walkRuntime.avatar.x, walkRuntime.avatar.z, s.camY, rideLookHeading(s.rideYaw, side), s.rideYaw.base + s.rideYaw.user, s.rideYaw.user, camera as THREE.PerspectiveCamera, s.rideAdj);
          s.rideYaw.auto = s.rideAdj.dyaw;
        }
        if (s.rideAdj) s.rideElev = stepRideElev(s.rideElev, s.rideAdj.elev, dt, calm);
        stepRideYaw(s.rideYaw, cityRide.heading + side, dt, calm, (s.yawTarget - s.rideYaw.yaw) - (s.yaw - s.rideYaw.yaw), s.yaw - s.rideYaw.yaw);
      }
      s.yaw = s.yawTarget = s.rideYaw.yaw;
      s.rideHeading = cityRide.heading;
    } else {
      if (s.rideHeading !== null && !photo) {
        // yolculuk bitti — kamera taşıt profilinden (yükseliş, kısa/uzun kol, yaylı kolun yolculuktaki boyu)
        // yürüme varsayılanına bu karede oturur: avatarın arkası (iniş yönü), varsayılan eğim ve mesafe, kol sıfırdan; arkası kapalıysa
        // en açık yan (`entryYaw`). Eskiden yolculuk eğimi/kolu kalıyor, kamera inişte kafanın içinden ya da tepeden bakıyordu.
        s.yaw = s.yawTarget = walkRuntime.avatar.heading; s.pitch = LOOK_DEFAULT; s.dist = FOLLOW_DIST;
        s.profSnap = true; s.entryAim = true; s.glide = null;
        s.hand = calm ? null : startHandoff(s.camPos, s.look, s.pivot); s.settle = !s.hand; // inişte 52–90° kesme yerine devir
        s.handRel = s.hand ? { x: s.camPos.x - s.pivot.x, y: s.camPos.y - s.pivot.y, z: s.camPos.z - s.pivot.z } : null; // devir ilk karesinden hız sınırlı (handRel null → armSafety o karede başa 0,2 m'ye çökertiyordu: <city> tekne biniş)
        releaseArm(s.arm);
        s.arm.built = null; s.rideAdj = null; // HQA-FIX: kol yeniden yürüme dünyasının tam kaynağına bağlanır
      }
      s.rideHeading = null;
    }
    // otomatik yürüyüşte (rota) takip kamerası avatarın arkasına döner, gidilen yöne bakar; arkası duvarsa
    // omuz üstü en açık sapma (yaylı kol ölçüsü, 4 Hz) — kamera avatarın önünde ya da duvarın arkasında kalmaz (walk/routeCam.ts)
    {
      const a0 = walkRuntime.avatar;
      // ritüelin oturağa/tezgâh önüne kısa yürüyüşünde kamera dönmez — tezgâh yanında avatarın arkasına dönen kol
      // tezgâha/tenteye çarpıp başa yapışıyordu (telefonda ekranın yarısı siyah saç, 1,19 m); ritüel başında kadraja kesilir
      const follow = routeFollowOn({ route: !!a0.route && a0.routeIdx < a0.route.length, first: store.view === "first", photo, activity: !!s.act || !!mgActor.kind || !!ritualState()?.approach,
        ride: !!cityRide || !!walkRuntime.ride, shot: !!s.shot, sinceUserYaw: (now - s.userYawAt) / 1000 });
      if (follow) {
        if (!s.routeOn || now - s.routeProbeAt > 250) {
          s.routeProbeAt = now;
          const pc0 = camera as THREE.PerspectiveCamera;
          const src = cameraSource(built), r = probeRadius(WALK_NEAR, pc0.fov, pc0.aspect || 1), ft = Math.min(a0.ground, s.camY) + 0.2;
          const pv: [number, number, number] = [a0.x, LOOK_Y + s.camY, a0.z], elev = Math.max(ORBIT_MIN, -s.pitch);
          s.routeWant = routeCamYaw(routeAheadYaw(a0), s.dist, (y) => sweepArm(src, pv,
            [pv[0] - Math.sin(y) * Math.cos(elev) * s.dist, pv[1] + Math.sin(elev) * s.dist, pv[2] - Math.cos(y) * Math.cos(elev) * s.dist], r, ft));
        }
        s.yawTarget = stepRouteYaw(s.yawTarget, s.routeWant, dt, calm);
      }
      s.routeOn = follow;
    }
    if (!cityRide) s.yaw = calm ? s.yawTarget : s.yaw + (s.yawTarget - s.yaw) * (1 - Math.exp(-dt * 10));

    // ---- avatar adımı (fotoğraf modunda avatar durur; girdi odağı taşır)
    const a = walkRuntime.avatar;
    const nav = navGrid(built);
    const first = firstPersonOn(store.view, photo, !!(cityRide || walkRuntime.ride)); // teleferik kabini/dönme dolap da (walkRuntime.ride) // yolculukta 1. şahıs kamera gövdede kalıyordu
    const input = combineInput(walkRuntime.input, walkRuntime.joy);
    if (photo) {
      const sy = Math.sin(pf.yaw), cy = Math.cos(pf.yaw);
      const step = PHOTO_SPEED * dt * (walkRuntime.run ? 2 : 1);
      // ileri (sin, cos), sağ (−cos, sin): inputToVelocity ile aynı eksenler
      let fx = pf.x + (sy * input.y - cy * input.x) * step;
      let fz = pf.z + (cy * input.y + sy * input.x) * step;
      // odak avatarın PHOTO_RADIUS çevresinde ve dünya ızgarasının içinde kalır (yürüme sınırı)
      const dx = fx - a.x, dz = fz - a.z, d = Math.hypot(dx, dz);
      if (d > PHOTO_RADIUS) { fx = a.x + (dx / d) * PHOTO_RADIUS; fz = a.z + (dz / d) * PHOTO_RADIUS; }
      // EXP: çevrede (yakın parseller yüklü) dünya ızgarası sınırı uygulanmaz; avatar çevresi (PHOTO_RADIUS) yeter
      if (!nav.outer?.parcels.size) {
        fx = THREE.MathUtils.clamp(fx, tx(0) - 0.5, tx(built.width - 1) + 0.5);
        fz = THREE.MathUtils.clamp(fz, tz(0) - 0.5, tz(built.depth - 1) + 0.5);
      }
      pf.x = fx; pf.z = fz;
      walkRuntime.photoFocus.x = fx; walkRuntime.photoFocus.z = fz; walkRuntime.photoFocus.ok = true;
      a.speed = 0;
    } else if (walkRuntime.ride) {
      // (transit): yolculuk sahnesi — avatar araçla birlikte rota üstünde (adım, çarpışma ve girdi yok)
      walkRuntime.photoFocus.ok = false;
      walkRuntime.jump = 0;
      walkRuntime.ride(a, rideDt(delta), clock.elapsedTime); // takılma yolculuğu uzatmaz // sahne saati (dönen blokların Blocks.tsx saati) — çark kabini izlenir
    } else {
      walkRuntime.photoFocus.ok = false;
      s.actors.length = 0;
      if (live) for (const p of live.positions.values()) if (Math.abs(p.x - a.x) < 2 && Math.abs(p.z - a.z) < 2) s.actors.push(p);
      // WALK-PHYS: dikey fizik (basamak, zıplama, tırmanma); bekleyen zıplama basışları bu adımda tüketilir
      const jump = walkRuntime.jump > 0;
      walkRuntime.jump = 0;
      stepAvatar(nav, a, { dt, camYaw: s.yaw, input, run: walkRuntime.run, actors: s.actors, extra: occupied, turnRate: calm ? Infinity : 12,
        radius: Math.max(WALK_AVATAR_RADIUS, 0.28 * walkRuntime.humanScale), climb: true, jump });
      if (first) a.heading = s.yaw;
      if (!a.route && store.target) store.setTarget(null);
      // STUCK-FIX (WALK-STUCK-001): güvenlik ağı — gömülüyse dışarı it, son güvenli karo; kilit/düşüş/"Takıldım" → kurtar (safeRescue.ts)
      safeStep(nav, built, a, { dt, input, radius: Math.max(WALK_AVATAR_RADIUS, 0.28 * walkRuntime.humanScale), extra: occupied });
    }
    // W5: yürümeye başlayınca emote biter (oturuş Crowd'da kendiliğinden biter)
    if (a.speed > 0.15 && walkRuntime.emote) { cancelEmote(); store.setEmote(null); }
    else if (!walkRuntime.emote && store.emote) store.setEmote(null);
    if (photo) walkRuntime.jump = 0;
    // WALK-PHYS: çizim yüksekliği — havada fizik y'si; yerde basamak çıkışı ~50 ms'de yumuşar (hareket azaltmada anında)
    if (!a.grounded || calm) walkRuntime.drawY = a.y;
    else walkRuntime.drawY += (a.y - walkRuntime.drawY) * (1 - Math.exp(-dt * 20));
    // kamera tabanı: hareket azaltmada zıplama yayı izlenmez (üstünde durulan yüzey), değilse çizim yüksekliği; yumuşak
    const baseY = calm ? Math.min(a.ground, a.y) : walkRuntime.drawY;
    s.camY = Math.abs(baseY - s.camY) < 1e-3 ? baseY : s.camY + (baseY - s.camY) * (1 - Math.exp(-dt * 8));

    // ---- INTERIOR-CAM: ortam profili (camera/profiles.ts). Ortam karo/alan değişince ölçülür (açıklık, avatarın tavanı); seçilen
    // profil 0,35 sn kararlı kalınca uygulanır (saçak altından geçerken sokak ↔ iç mekân gidip gelmez); mesafe ve açı profilin zaman
    // sabitiyle yumuşak geçer, kullanıcı yakınlaştırması oranıyla korunur; etkinlik kadrajında (ACTIVITY-CAM) mesafe ona aittir.
    // Kapı/kat geçişinde (kararma altında) ve hareket azaltmada anında.
    const indoorRule = !!rule && (rule.space === "room" || rule.space === "hall");
    {
      const [pi, pj] = tileAt(a.x, a.z);
      const pkey = `${pi},${pj},${rule?.key ?? ""}`;
      if (pkey !== s.profKey) {
        s.profKey = pkey;
        const o = openness((i, j) => walkable(nav, i, j), pi, pj);
        const over = ceilingOver(rigSource(s.arm, built), a.x, a.z, a.ground + LOOK_Y + HEAD_CLEAR, indoorRule ? 0.45 : 0);
        s.profEnv = { ...o, ceiling: over - a.ground };
      }
      const want = selectProfile({ space: rule?.space ?? null, ride: !!(rideRuntime.ride || walkRuntime.ride), rideProfile: rideRuntime.ride ? rideCamProfileId(rideRuntime.ride.plan.kind) : null /* RIDE-UX */, activity: !!(s.act || mgActor.kind === "fishing"),
        ...s.profEnv, stair: indoorRule && a.ground > 0.08 });
      if (want !== s.profWant) { s.profWant = want; s.profSince = now; }
      const settle = s.profSnap || calm || want === "vehicle" || want === "activity" || now - s.profSince >= 350;
      const id = settle ? want : s.prof.id;
      const before = s.prof.dist;
      stepProfileBlend(s.prof, id, dt, calm, s.profSnap);
      if (s.profSnap) { s.profSnap = false; if (!s.act && rule) s.dist = s.prof.dist; }
      else if (!s.act && before > 1e-3 && Math.abs(s.prof.dist - before) > 1e-6)
        s.dist = THREE.MathUtils.clamp(s.dist * (s.prof.dist / before), s.prof.distMin, s.prof.distMax);
    }

    // ---- kamera
    const cover = coverGrid(built);
    const pc = camera as THREE.PerspectiveCamera;
    // birinci şahıs gözü: alçak tavanın altında (W5), üstünde durulan yüzeyi izler (WALK-PHYS); göz yedeği de kullanır
    const eyeY = (by: number) => {
      if (s.camY < 0.05) return eyeUnderCeiling(cover, a.x, a.z, EYE_Y + by + s.camY);
      const hc = heightCtx(nav), [ti, tj] = tileAt(a.x, a.z);
      const ceil = hc ? ceilingAt(hc, ti, tj, a.ground) : Infinity;
      return Math.max(s.camY + 0.45, Math.min(s.camY + EYE_Y + by, ceil - CEIL_GAP));
    };
    // INTERIOR-VIEW: oda/salon kesitinde kamera duvar yüzünden kısalmaz ve duvara kıstırılmaz: arada kalan duvar saydamlaşır
    // CAMERA: şehir sokağı (`street`) artık oda kesiti sayılmaz — kamera binaya girmez, yaylı kol kısaltır (camera/collide.ts)
    const roomCut = !!rule?.cutaway && !first && rule.space !== "street";
    // CAMERA: yaylı kol (küre süpürmesi) — takip, yolculuk ve fotoğraf kamerası katıya girmez; oda/salon kesitinde (dollhouse) yok
    const armOpts = { dt, calm, near: WALK_NEAR, fov: pc.fov, aspect: pc.aspect || 1, footY: Math.min(a.ground, s.camY) };
    let cut: ReturnType<typeof computeCutaway>;
    let near = false;
    if (photo) {
      const cp = Math.cos(pf.pitch);
      s.tmpL.set(pf.x, LOOK_Y + s.camY, pf.z);
      s.tmpP.set(pf.x - Math.sin(pf.yaw) * cp * pf.dist, Math.max(0.35, LOOK_Y + s.camY + Math.sin(pf.pitch) * pf.dist), pf.z - Math.cos(pf.yaw) * cp * pf.dist);
      if (roomCut) releaseArm(s.arm);
      else { s.pivot.copy(s.tmpL); followArm(s.arm, built, s.pivot, s.tmpP, s.tmpL, armOpts); }
      cut = computeCutaway(cover, a, s.tmpP, { chestY: LOOK_Y + s.camY, footY: a.ground });
    } else if (first) {
      // baş sallanması yalnız yürürken ve hareket azaltma kapalıyken (§3.2, §4.3)
      let by = 0, bx = 0;
      if (!calm && a.speed > 0.2) {
        s.bob = (s.bob + dt * (1.6 + a.speed * 0.55)) % 1000;
        by = Math.abs(Math.sin(s.bob * Math.PI)) * BOB_AMP * 2 - BOB_AMP;
        bx = Math.sin(s.bob * Math.PI) * BOB_AMP * 0.5;
      }
      const cyw = Math.cos(s.yaw), syw = Math.sin(s.yaw);
      s.tmpP.set(a.x + cyw * bx, eyeY(by), a.z - syw * bx);
      lookDir(s.yaw, s.pitch, s.dir);
      s.tmpL.set(s.tmpP.x + s.dir.x, s.tmpP.y + s.dir.y + by * 0.5, s.tmpP.z + s.dir.z);
      cut = computeCutaway(cover, a, { x: a.x, y: EYE_Y + s.camY, z: a.z }, { chestY: LOOK_Y + s.camY, footY: a.ground });
      releaseArm(s.arm);
    } else if (cityRide && s.rideHeading !== null) {
      // UXF-D: yolculuk kadrajı (transit/rideCam.ts): arkadan-yandan, araç profilinin yükseliş/mesafesi, bakış rotanın önünde;
      // gövde → kamera doğrularını kesen tavan ve arka duvar sokak kesitiyle bütün blok açılır
      // CORE-CITYMAP: binişte kısa tanıtım çekimi (araç yandan, bütün boyuyla), sonra takip; hareket azaltmada tanıtım yok
      // tanıtım açık yandan ya da hiç; takip pozunun kolu iskele yapısına (saçak, iskele binası) takılıyorsa
      // tanıtımdan takibe geçiş bekler (kamera kısa kolla kamaranın içine, başın dibine düşmez) — en çok `RIDE_HOLD_MAX` sn
      const lookH = rideLookHeading(s.rideYaw, rideSide(cityRide.plan.kind)) /* RIDE-UX */;
      if (!calm && s.rideEst) {
        if (now - s.rideProbeAt > 250) { s.rideProbeAt = now; s.rideBlocked = !rideFollowOpen(built, cityRide.plan.kind, a.x, a.z, s.camY, lookH, s.yaw, pc); }
        if (!(s.rideBlocked && s.rideT >= RIDE_ESTABLISH && cityRide.t < RIDE_HOLD_MAX)) s.rideT += dt;
      }
      const rc = rideCamPose(cityRide.plan.kind, a.x, a.z, s.camY, lookH, s.yaw, s.rideCam, calm || !s.rideEst ? Infinity : s.rideT, s.rideEst || 1, s.rideAdj ? s.rideElev : undefined,
        hFovOf(pc.fov, pc.aspect) / 2 /* dar yatay görüşte avatar kadrajda*/);
      s.tmpP.set(rc.x, rc.y, rc.z); s.tmpL.set(rc.lx, rc.ly, rc.lz);
      s.pivot.set(a.x, LOOK_Y + s.camY, a.z);
      // HQA-FIX: yolculuk kolu araç tavanı üstündeki ince levhalardan (tente, saçak) geçer — sokak kesiti onları açar;
      // kamera levhanın içinde kalırsa tam kaynakla geri çekilir
      const camSrc = cameraSource(built);
      s.arm.built = built; s.arm.src = rideArmSourceOf(camSrc, s.camY);
      followArm(s.arm, built, s.pivot, s.tmpP, s.tmpL, armOpts);
      if (pointBlocked(rideEndSourceOf(camSrc), [s.tmpP.x, s.tmpP.y, s.tmpP.z], s.arm.radius * 0.5, s.arm.floorTop)) { s.arm.src = rideEndSourceOf(camSrc); armSafety(s.arm, s.tmpP); } // ufak donatı kolu kısaltmaz
      cut = computeCutaway(cover, a, s.tmpP, { chestY: LOOK_Y + s.camY, footY: a.ground });
    } else {
      // WALK-SCALE: göğüs pivotu çevresinde yaw/eğim yörüngesi (yukarı bakışta kamera alçakta kalır, yukarı döner)
      // ACTIVITY-CAM: etkinlik kadrajında pivot oturak/karakterin gözü ile elleri arası (oturan karakter avatar noktasından kayık)
      if (s.act) s.pivot.set(s.act.pick.px, s.act.pick.pivotY + (s.camY - s.act.footY), s.act.pick.pz); // olta bakış noktası önde (karakter + şamandıra)
      else s.pivot.set(a.x, LOOK_Y + s.camY, a.z);
      // INTERIOR-CAM: iç mekâna girişte kamera kapı duvarına yaslanmaz — avatarın arkasıyla yanı arasında en açık yön (kararma altında)
      if (s.entryAim && !s.act) {
        s.entryAim = false;
        s.yaw = s.yawTarget = entryYaw(s.arm, built, s.pivot, s.yaw, s.dist, Math.max(ORBIT_MIN, -s.pitch),
          { near: WALK_NEAR, fov: pc.fov, aspect: pc.aspect || 1, footY: Math.min(a.ground, s.camY) });
      }
      // şehir sokağında dururken önündeki yüksek simgenin tepesi (kubbe) kadrajda kalsın — ek eğim yumuşakça gelir/gider
      const lcm = gateMapOf(built);
      let liftWant = lcm && rule?.space === "street" && !s.act && !viewTurn.on && !landmarkView.active && a.speed < 0.15
        ? landmarkLift(cityLiftTargets(lcm), a.x, a.z, s.yaw, s.pitch, s.pivot.y, s.dist, THREE.MathUtils.degToRad(pc.fov) / 2) : 0;
      if (liftWant > 0) { // kaldırma kamerayı yere indirip kolu tezgâh masasına çökertmesin (walk/lmLift.ts openLift)
        const lsrc = cameraSource(built), lr = probeRadius(WALK_NEAR, pc.fov, pc.aspect || 1), lft = Math.min(a.ground, s.camY) + 0.2;
        liftWant = openLift(liftWant, (l) => { orbitPose(s.pivot, s.yaw, s.pitch + l, s.dist, s.tmpL); if (s.tmpL.y < s.camY + LIFT_CAM_MIN) return 0; // kamera yere yatmaz
          return sweepArm(lsrc, [s.pivot.x, s.pivot.y, s.pivot.z], [s.tmpL.x, s.tmpL.y, s.tmpL.z], lr, lft); });
      }
      s.lift += (liftWant - s.lift) * (calm ? 1 : 1 - Math.exp(-dt * 2.5));
      if (liftWant === 0 && s.lift < 1e-3) s.lift = 0;
      const pe = s.pitch + s.lift;
      orbitPose(s.pivot, s.yaw, pe, s.dist, s.tmpP);
      if (s.tmpP.y < s.camY + CAM_FLOOR) s.tmpP.y = s.camY + CAM_FLOOR;
      // INTERIOR-CAM: iç mekân profilinde omuz üstü yanal kayma (baş kadrajın ortasını kapatmaz; etkinlik kadrajı hariç)
      if (!s.act) shoulderShift(s.tmpP, s.yaw, s.prof.shoulder);
      // INTERIOR-CAM: avatarın üstünde tavan varsa kamera tavanın altına iner (yükselmez; bakış avatara döner) — çatı kesilmez
      const cf = fitCeiling(s.arm, built, s.pivot, s.tmpP, { dist: s.dist, pitch: pe, near: WALK_NEAR, fov: pc.fov, aspect: pc.aspect || 1,
        footY: Math.min(a.ground, s.camY), reach: indoorRule ? 0.45 : 0, tight: indoorRule });
      cut = computeCutaway(cover, a, s.tmpP, { chestY: LOOK_Y + s.camY, footY: a.ground });
      // ACTIVITY-CAM: etkinlik kadrajı bloklara karşı seçildi (göz hizası, masanın üstünden): alçak engel (masa, tezgâh) kamerayı
      // kısaltıp tepeye kaldırmasın — duvar kıskacı ve yaylı kol yine çalışır
      if (s.act) cut = { ...cut, camScale: 1 };
      if (s.act?.snap) { s.act.snap--; releaseArm(s.arm); s.settle = true; } // kesme — konum yumuşatması kamerayı avatarın içinden geçirmez
      // W5 + kısa engelde kısalma, duvar kıskacı; kamera başa yaklaşacaksa kaldırılmış / omuz üstü poz, o da sığmazsa göz
      // (cover.ts `resolveFollowCam`; opaqueCheck.ts aynı işlevle tarar)
      const fc = resolveFollowCam(cover, s.act ?? a /* ACTIVITY-CAM: duvar kıskacı oturaktan (avatar noktası kayık) */, s.pivot, s.tmpP, { yaw: s.yaw, pitch: cf.pitch, dist: s.dist, footY: s.camY, roomCut, camScale: cut.camScale, blocks: built.blocks,
        maxY: Math.min(cf.maxY, s.pivot.y + Math.sin(profileOf(s.prof.id).elevMax) * s.dist), eyeDist: indoorRule ? armEyeIndoor(hFovOf(pc.fov, pc.aspect || 1) * Math.PI / 180) : undefined /* telefonda yatay görüşle*/ }, s.follow);
      near = fc.mode === "eye";
      if (!near) {
        s.tmpP.set(fc.x, fc.y, fc.z); s.tmpL.set(fc.lx, fc.ly, fc.lz);
        if (roomCut) releaseArm(s.arm);
        else {
          followArm(s.arm, built, s.pivot, s.tmpP, s.tmpL, { ...armOpts, tight: indoorRule, lift: fc.mode === "orbit" && !s.act /* ACTIVITY-CAM: kadraj göz hizasında; engelde tepeye kalkmaz */ && profileOf(s.prof.id).lift, whiskers: !calm && !s.act /* ACTIVITY-CAM: kadraj bloklara karşı seçildi */, maxElev: Math.min(elevCap(cf, s.pivot.y, s.dist, profileOf(s.prof.id).elevMax), (inNarrowLane(s.profEnv.runX, s.profEnv.runZ) || (cityRuntime.active && s.prof.id === "street")) && !indoorRule && !s.act ? LANE_ELEV_MAX : Infinity) /* şehir sokağında cephe dibinde de tepeye kalkmaz*/ });
          // CAMERA: kol göğse çok yakın kaldıysa (köşeye sıkışmış avatar) göz yedeği — baş ekranı kaplamaz
          near = (indoorRule ? s.tmpP.distanceTo(s.pivot) : s.arm.arm.len) < ((indoorRule ? armEyeIndoor(hFovOf(pc.fov, pc.aspect || 1) * Math.PI / 180) : ARM_EYE) + (s.near ? eyeHyst(hFovOf(pc.fov, pc.aspect || 1) * Math.PI / 180) : 0)); // telefonda histerezis 0: iç mekânda eşik ARM_EYE_INDOOR // histerezis: sınırda kare kare gidip gelmesin
        }
      }
      if (near) {
        s.tmpP.set(a.x, eyeY(0), a.z);
        lookDir(s.yaw, s.pitch, s.dir);
        s.tmpL.copy(s.tmpP).add(s.dir);
        releaseArm(s.arm);
      }
      // kamera başka bir kişinin (ajan) bedenine girmez — kol kişinin silindirinin önünde kısalır (statik blok kaynağı kişileri bilmez)
      // şehir figüranları da (citylife/runtime.ts `people`) — kamera yanındaki figüranın yüzüne/bedenine girmez
      else if (!s.act) {
        const ag = live ? clearOfPeople(s.tmpP, s.pivot, live.positions.values()) : false;
        s.crowdFrom.copy(s.tmpP);
        const cr = clearOfPeople(s.tmpP, s.pivot, cityLifeRuntime.people, CROWD_CAM_R, AGENT_CAM_H, AGENT_CAM_PAD, CROWD_BODY_R);
        // figüran kolu yakın plana/göz yedeğine çökertmez — kamera statik kolda kalır, koridordaki figüran çizilmez
        cityLifeRuntime.veil = cr && crowdVeil(s.crowdFrom, s.tmpP, s.pivot, veilWas);
        if (cityLifeRuntime.veil) s.tmpP.copy(s.crowdFrom);
        if ((ag || (cr && !cityLifeRuntime.veil)) && s.tmpP.distanceTo(s.pivot) < crowdEyeDist(indoorRule, hFovOf(pc.fov, pc.aspect || 1) * Math.PI / 180)) { // telefonda iç mekân eşiği
          near = true; // kişi avatarın hemen arkasında: göz yedeği, baş kadrajı kaplamaz
          s.tmpP.set(a.x, eyeY(0), a.z);
          lookDir(s.yaw, s.pitch, s.dir);
          s.tmpL.copy(s.tmpP).add(s.dir);
          releaseArm(s.arm);
        }
      }
      // etkinlik kadrajı (tezgâh/ritüel, olta) sabittir — kamera ile avatar arasından geçen figüran çizilmez (NY kafe F'de ekranın %80'i)
      else cityLifeRuntime.veil = true;
      // WALK-ZOOM: kuş bakışı — takip pozundan avatarın arkası-üstüne kayar, bakış avatara; ara pozda bir yapının içindeyse dikey çıkar.
      // Kol bırakılır (armSafety kuş bakışını yapı köşesinde aşağı çekmesin); arada kalan örtücüyü sokak kesiti açar.
      s.airK = stepAir(s.airK, s.act ? 0 : s.air, dt, calm);
      if (s.airK > 0 && !s.act) {
        const e = airEase(s.airK), src = rigSource(s.arm, built), floor = Math.min(a.ground, s.camY) + FLOOR_PAD;
        airPose(s.pivot, s.yaw, s.airP);
        s.tmpP.lerp(s.airP, e); s.tmpL.lerp(s.pivot, e);
        for (let k = 0; k < 64 && pointBlocked(src, [s.tmpP.x, s.tmpP.y, s.tmpP.z], 0.3, floor); k++) s.tmpP.y += 1;
        releaseArm(s.arm);
        near = false;
      }
    }
    // WALK-ZOOM: sis ve denetim için kameranın avatar zemininden yüksekliği ve takip kolunun ötesindeki ek boy
    walkZoom.k = s.airK; walkZoom.camH = Math.max(0, s.tmpP.y - s.camY); walkZoom.extra = s.airK > 0 && !photo && !first && !cityRide ? Math.max(0, s.tmpP.distanceTo(s.pivot) - s.dist) : 0;
    // göz yedeğine girişte/çıkışta kamera kayarak başın içinden geçmesin: o karede oturur (kesme). Göz yedeğinde kesit
    // üçüncü şahıs kuralıyla kurulur (yüze değen cam/levha yakın bölgede bütün açılır; CAMERA-OPAQUE yakın düzlem kalıntısı 0)
    if (near !== s.near) { s.near = near; if (!s.glide) s.settle = true; }
    // optik: Hor+ — dikey açı ayar + alan eki (`fovAdd`), tuvalin en/boy oranına göre yatay taban (scale.ts `walkFov`).
    // Birinci şahısta en az FP_FOV (hareket azaltmada üçüncü şahısla aynı: görünüm geçişinde açı değişmez). Geçiş yumuşak.
    const fovSet = useWalkFov.getState().fov, aspect = pc.aspect || 1;
    // INTERIOR-CAM: alan eki ortam profilinden (iç oda 64°, salon 68°, koridor 62°… ayar varsayılanında); şehir sokağı kuralının eki korunur
    const thirdFov = walkFov(fovSet, aspect, !first && !photo ? s.prof.vfov - CAMERA_PROFILES.street.vfov + (rule?.space === "street" ? rule.fovAdd : 0) : 0);
    const wantFov = first && !calm ? Math.max(FP_FOV, walkFov(fovSet, aspect)) : thirdFov;
    // WORLD-FIX: üçüncü şahısta da kısa yakın düzlem (0,5'te kameraya yakın modeller kesilip içi/saydam görünüyordu)
    const wantNear = first || near ? FP_NEAR : Math.min(WALK_NEAR, s.baseNear || pc.near);
    let optic = false;
    if (Math.abs(pc.fov - wantFov) > 0.05) { pc.fov = calm || Math.abs(pc.fov - wantFov) < 0.3 ? wantFov : pc.fov + (wantFov - pc.fov) * (1 - Math.exp(-dt * 9)); optic = true; }
    if (pc.near !== wantNear) { pc.near = wantNear; optic = true; }
    if (optic) pc.updateProjectionMatrix();
    const g = s.glide;
    if (s.hand && (calm || first || photo || (g && !g.exit))) s.hand = null;
    if (g && !g.exit) {
      const k = Math.min(1, (now - g.t0) / g.dur), e = ease(k);
      s.camPos.lerpVectors(g.fromP, s.tmpP, e);
      s.look.lerpVectors(g.fromL, s.tmpL, e);
      if (k >= 1) s.glide = null;
    } else if (s.hand) {
      if (!stepHandoff(s.hand, s.pivot, s.tmpP, s.tmpL, dt)) s.hand = null;
      s.camPos.copy(s.tmpP); s.look.copy(s.tmpL); s.settle = false;
    } else if (calm || first || photo || s.settle) {
      s.camPos.copy(s.tmpP); s.look.copy(s.tmpL);
      s.settle = false;
    } else {
      const f = 1 - Math.exp(-dt * 8);
      camLerp(s.camPos, s.tmpP, s.pivot, f); s.look.lerp(s.tmpL, f); // yan değişiminde kesme, avatarın içinden süzülmez (walk/camArc.ts)
    }
    // CAMERA: gecikmeli (yumuşatılmış) konum da katıya girmez — pivot → kamera yeniden süpürülür (giriş kayması hariç)
    if (!(g && !g.exit)) {
      // devir sürerken kamera (kol dahil) kare başına sınırlı oynar (tek karede 3 birim sıçrama yok); hedef hep kolla güvenli poz (rideCam.ts handCamLimit)
      // yolculuk boyunca da aynı hız sınırı — gecikmeli kamera aracın yanındaki bir bloğun köşesini sıyırınca kol tek karede 3–5 birim kısalıyordu (<city>/<city> metro)
      const rideLimit = !!cityRide && !calm;
      if (s.hand || s.handRel || rideLimit) { armSafety(s.arm, s.camPos); const want = s.handSafe.copy(s.camPos).sub(s.pivot);
        s.handRel = handCamLimit(s.pivot, s.camPos, s.handRel, dt);
        if (!s.hand && !rideLimit && Math.hypot(s.handRel.x - want.x, s.handRel.y - want.y, s.handRel.z - want.z) < 1e-3) s.handRel = null; } // devir bitince yakınsayınca bırakılır
      else armSafety(s.arm, s.camPos);
    }
    camera.position.copy(s.camPos);
    camera.lookAt(s.look);
    // güvenlik ağı: kamera (kayma, fotoğraf odağı, göz yedeği dahil) başa CAM_HIDE_DIST'ten yakınsa avatar o karede çizilmez —
    // baş ekranı hiçbir durumda kaplamaz. Histerezis: CAM_SHOW_DIST'te geri gelir. Birinci şahısta zaten gizli.
    const headY = walkRuntime.drawY + HEAD_CENTER_Y * (walkRuntime.humanScale / WALK_HUMAN_SCALE);
    const hd = headDistance(s.camPos, a, headY);
    const hideD = s.hideNear ? CAM_SHOW_DIST : CAM_HIDE_DIST;
    s.hideNear = !first && (near || hd < (indoorRule ? hideDistIndoor(hFovOf(pc.fov, pc.aspect || 1) * Math.PI / 180, hideD) : hideD)); // telefonda iç mekânda yalnız baş küresine girince
    walkRuntime.visible = !first && !s.hideNear;
    if (live) { live.camTarget.x = s.look.x; live.camTarget.z = s.look.z; }
    applyAirFog(scene.fog as { near: number; far: number } | null, walkZoom.camH, walkZoom.extra); // WALK-ZOOM: kuş bakışında sis kamerayla ileri

    // ---- kesit (WORLD-FIX, tek kural): yalnız kamerayla avatar arasındaki gerçek örtücü, bütün blok — gövde yoklaması her üçüncü
    // şahıs alanında; çatı yalnız avatarın çatı bileşeninde; kabuk yalnız iç mekân oda/salonunda; birinci şahısta hiçbiri (cover.ts)
    const roomRule = !!rule?.cutaway && rule.space !== "street" && !first;
    const shape = roomRule ? roomShapeAt(rule!.room ?? null, nav, a.x, a.z) : null;
    // şehir yolculuğunda gövde yoklaması / LOS titreşimi yok (walk/rideCut.ts) — binilen araçta noktalı daire açılmaz
    const plan = rideCutPlan(walkCutPlan({ cover, avatar: { x: a.x, z: a.z, foot: a.ground }, chest: [a.x, LOOK_Y + s.camY, a.z], cam: [s.camPos.x, s.camPos.y, s.camPos.z],
      first, rule, shape }), !!cityRide);
    // INTERIOR-CAM: çatı/üst kat kesiti emekli (plan.roof hep null) — çatı titreşim yoğunluğu sıfır
    s.arm.fade.k = 0; s.arm.fade.last = null;
    cutawayUniforms.uCutFade.value = 0;
    writeCutPlan(cutawayUniforms, plan, shape, a);
    s.cutKey = cut.tileKey + cut.roof;

    // ---- depo senkronu (seyrek)
    store.syncPose({ x: a.x, z: a.z, heading: a.heading, tile: tileAt(a.x, a.z) });
    store.syncCover({ indoor: cut.roof, occluded: cut.window });
    if (now - s.nearbyAt > 1000 / NEARBY_HZ) {
      s.nearbyAt = now;
      const list = s.entityList;
      list.length = 0;
      if (live && agentsNearby) for (const [id, p] of live.positions) list.push({ id, kind: "agent", x: p.x, z: p.z });
      if (entities) for (const e of entities()) list.push(e);
      // W5: "N adım" yürünecek yol (BFS), öklid değil; ulaşılamayan hedef işaretlenir
      const items = applyPathSteps(nav, s.index.rebuild(list).query(a.x, a.z, a.heading), a.x, a.z);
      // W5: birinci şahısta F yalnızca bakılan hedefi seçer (bakış konisi); üçüncü şahısta en yakın + bakışa yakın
      // çark/teleferik yolculuğunda F yalnız "in" girdisini seçer (eskiden geçtiği simgenin kartını açıp yolculuk boyunca ekranı kapatıyordu)
      const pool = walkRuntime.ride ? items.filter((it) => it.id.startsWith("hot:cablecar") || it.id.startsWith("hot:wheel")) : items;
      const focus = first ? pickLookTarget(pool, a.x, a.z, s.yaw) : pickInteractTarget(pool, a.x, a.z, a.heading);
      store.syncNearby(items, focus?.id ?? null);
    }

    // ---- W5: fotoğraf karesi — preserveDrawingBuffer olmadan: bu karede sahne bir kez çizilir ve tuval hemen kopyalanır
    const cap = walkRuntime.capture;
    if (cap) {
      walkRuntime.capture = null;
      try { gl.render(scene, camera); cap(gl.domElement); } catch { /* bağlam kaybı: kare alınmaz */ }
    }
  });

  // geliştirme kancası (§10.3): ekran görüntüsü betikleri için; üretim derlemesinde yok
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voxcrewWalk?: unknown };
    w.__voxcrewWalk = {
      teleport: (i: number, j: number) => { const a = walkRuntime.avatar; a.x = tx(i); a.z = tz(j); a.route = null; a.y = 0; a.vy = 0; a.grounded = true; },
      /** WALK-PHYS: zıpla (Boşluk ile aynı); dünya noktasına koy (x, z; ayak ilk adımda yüzeye oturur) */
      jump: () => { walkRuntime.jump++; },
      /** WALK-PHYS: girdi sür (x sağ, y ileri; kamera yaw'ına göre) `ms` boyunca — canlı denetim betikleri için */
      drive: (x: number, y: number, ms: number) => {
        walkRuntime.input.x = x; walkRuntime.input.y = y;
        window.setTimeout(() => { walkRuntime.input.x = 0; walkRuntime.input.y = 0; }, ms);
      },
      /** WALK-PHYS: avatarın çevresindeki tırmanılabilir karolar (üst yüz, dünya merkezi), yakından uzağa */
      climbSpots: (r = 10) => {
        const hc = heightCtx(navGrid(built)), a = walkRuntime.avatar, out: { i: number; j: number; x: number; z: number; top: number; d: number }[] = [];
        if (!hc) return out;
        const { hf } = hc;
        for (let k = 0; k < hf.climb.length; k++) {
          if (!hf.climb[k]) continue;
          const i = k % hf.width, j = (k - i) / hf.width, x = tx(i), z = tz(j), d = Math.hypot(x - a.x, z - a.z);
          if (d <= r) out.push({ i, j, x, z, top: hf.top[k], d });
        }
        return out.sort((p, q) => p.d - q.d).slice(0, 30);
      },
      /** WALK-PHYS: noktaya en yakın yürünebilir karonun merkezi (canlı denetimde avatarı taşıtın yanına koymak için) */
      nearestStand: (x: number, z: number) => { const t = nearestWalkable(navGrid(built), tileAt(x, z)); return t ? { x: tx(t[0]), z: tz(t[1]), tile: t } : null; },
      /** WALK-PHYS: taşıtların şu anki konumu ve yürüme uyumu (SceneFx ile aynı saat ve yol) — canlı denetim için */
      movers: () => (built.movers ?? []).map((m) => {
        const fit = moverFitOf(m), o = { x: 0, y: 0, z: 0, yaw: 0 };
        (fit && fit.mover !== m ? walkSampler(fit) : samplePath(m)).at(reducedMotion() ? 0 : clock.elapsedTime, o);
        return { shape: m.shape, ...o, fx: fit?.fx ?? 1, fy: fit?.fy ?? 1, ratio: fit?.ratio ?? null };
      }),
      place: (x: number, z: number, heading?: number) => { const a = walkRuntime.avatar; a.x = x; a.z = z; a.route = null; a.y = 0; a.vy = 0; a.grounded = true; if (heading !== undefined) a.heading = heading; },
      face: (angle: number) => { walkRuntime.avatar.heading = angle; },
      walkTo: (i: number, j: number) => useWalkStore.getState().setTarget([i, j]),
      state: () => ({ ...useWalkStore.getState(), avatar: { ...walkRuntime.avatar } }),
      /** canlı kadraj ölçümü (sahne + kamera; scripts/live_frame_probe.mjs ışın atar)*/
      three: () => ({ scene, camera }),
      /** WALK-SCALE: bakış (yaw, eğim), ölçek ve takip mesafesi — ekran görüntüsü betikleri ve canlı denetim için */
      look: (yaw?: number, pitch?: number, dist?: number) => {
        const s = st.current;
        if (yaw !== undefined) { s.yaw = s.yawTarget = yaw; }
        if (pitch !== undefined) s.pitch = clampLook(pitch);
        if (dist !== undefined) s.dist = THREE.MathUtils.clamp(dist, FOLLOW_MIN, FOLLOW_MAX);
        return { yaw: s.yaw, pitch: s.pitch, dist: s.dist, humanScale: walkRuntime.humanScale };
      },
      /** W5: kamera (FOV, yakın düzlem, konum) ve oynayan emote — birinci şahıs / jest / hareket azaltma denetimleri için */
      camera: () => { const c = camera as THREE.PerspectiveCamera; const s = st.current;
        // takip kamerası kipi (orbit/lift/shoulder/eye), avatar yakın kamera yüzünden gizli mi, en/boy
        return { fov: c.fov, near: c.near, x: c.position.x, y: c.position.y, z: c.position.z, aspect: c.aspect, mode: s.follow.mode, hidden: s.hideNear,
          // INTERIOR-CAM: uygulanan ortam profili, karışmış mesafe/açı ve ortam ölçümü (canlı denetim)
          profile: s.prof.id, profDist: s.prof.dist, profFov: s.prof.vfov, dist: s.dist, env: s.profEnv, air: s.air, airK: s.airK /* WALK-ZOOM */ }; },
      /** UX-P2: avatar gövdesinin ekrandaki kutusu (CSS px, görünüm penceresine göre): ayaktan başın tepesine, kameraya
       * dik omuz + kol payıyla (yürüme ölçeğinde ±0,27). 375 px HUD denetimi (scripts/overlap_check.mjs `avatar`): HUD öğeleri bu
       * kutuya binmemeli. Yürüme kapalıyken, birinci şahısta ve fotoğraf modunda null.*/
      avatarBox: () => {
        const ws = useWalkStore.getState();
        if (!ws.active || ws.view === "first" || ws.photo) return null;
        const a = walkRuntime.avatar, hs = walkRuntime.humanScale, half = 0.27 * hs / WALK_HUMAN_SCALE;
        const foot = walkRuntime.drawY, head = foot + CHIBI_HEIGHT * hs, r = gl.domElement.getBoundingClientRect();
        camera.updateMatrixWorld();
        // kameranın yatay sağ ekseni (görüntü düzleminde genişlik)
        const cx = camera.matrixWorld.elements[0], cz = camera.matrixWorld.elements[2], cl = Math.hypot(cx, cz) || 1;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const p = new THREE.Vector3();
        for (const k of [-half, half]) for (const y of [foot, head]) {
          p.set(a.x + (cx / cl) * k, y, a.z + (cz / cl) * k).project(camera);
          const sx = r.left + ((p.x + 1) / 2) * r.width, sy = r.top + ((1 - p.y) / 2) * r.height;
          x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
        }
        const l = walkRuntime.meLabel; // "Ben" etiketi (canvas → görünüm penceresi px)
        return { x0, y0, x1, y1, label: l ? { x0: r.left + l[0], y0: r.top + l[1], x1: r.left + l[2], y1: r.top + l[3] } : null, canvas: { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom } };
      },
      emote: () => (walkRuntime.emote ? { ...walkRuntime.emote } : null),
      /** manzara hedefleri, kipi başlat (anahtar ya da otomatik) / durdur, açık çerçeve — canlı denetim ve ekran görüntüsü için*/
      viewTargets: () => viewTargets(built, useWalkStore.getState().world ?? "scene").map((t) => ({ key: t.key, rect: { ...t.rect }, h: t.h ?? null })),
      view: (key?: string | null) => {
        if (key === null) { stopLandmarkView(); return true; }
        const t = key ? viewTargets(built, useWalkStore.getState().world ?? "scene").find((x) => x.key === key) ?? null : null;
        if (key && !t) return false;
        return startLandmarkView(t);
      },
      shot: () => { const v = st.current.shot; return v ? { key: v.key, box: { ...v.box }, yaw: v.yaw, elev: v.elev, dist: v.dist, zoom: v.zoom } : null; },
      /** W5: panel aç (alt sayfa / joystick ekran görüntüsü için): "talk:<slug>" ya da "ent:<id>" */
      panel: (id: string | null) => useWalkStore.getState().setPanel(id),
      /** W2: kesit birimlerinin anlık değeri ve karşılaştırma görüntüsü için çatı kesitini geçici kapatma (karo değişince geri gelir) */
      cut: () => ({ roof: [...cutawayUniforms.uCutRoof.value], params: [...cutawayUniforms.uCutParams.value], win: [...cutawayUniforms.uCutWin.value], depth: cutawayUniforms.uCutWinDepth.value,
        minY: cutawayUniforms.uCutWinY.value, shellBB: [...cutawayUniforms.uCutShellBB.value], shellOn: [...cutawayUniforms.uCutShellOn.value], shellY: cutawayUniforms.uCutShellY.value,
        street: [...cutawayUniforms.uCutStreet.value], streetY: cutawayUniforms.uCutStreetY.value, probes: [...cutawayUniforms.uCutProbe.value],
        rule: walkCamera.rule ? { ...walkCamera.rule } : null, dist: st.current.dist }),
      cutOff: () => { cutawayUniforms.uCutRoof.value[3] = 0; cutawayUniforms.uCutWin.value[3] = 0; cutawayUniforms.uCutShellOn.value.fill(0); cutawayUniforms.uCutStreet.value[3] = 0; },
      /** W2: örtülü (çatı altı) yürünebilir karolar — kesit ekran görüntüsü betikleri için */
      covered: () => {
        const c = coverGrid(built), nav = navGrid(built), out: [number, number][] = [];
        for (let j = 0; j < c.depth; j++) for (let i = 0; i < c.width; i++)
          if (c.roofY[j * c.width + i] !== Infinity && nav.blocked[j * nav.width + i] === 0) out.push([i, j]);
        return out;
      },
      /** INTERIOR-CAM: dünya modülleri (otel, çalışma salonu… canlı iç mekân kamera denetimi için) */
      modules: () => (built.modules ?? []).map((m) => ({ label: m.label ?? null, kind: m.kind ?? null, i0: m.i0, j0: m.j0, w: m.w, d: m.d })),
    };
    return () => { delete w.__voxcrewWalk; };
  }, [built, camera, clock]);

  return null;
}

/** W5: girişte saklanan görüş açısı ve yakın düzlemi geri yükler (birinci şahıs çıkışı, mod çıkışı, söküm). */
/** WORLD-FIX: yörünge kamerası (yürüme kapalı) bir bloğun içine ya da yakın düzleminin önüne girerse yalnız o bloklar bütün olarak
 *  açılır; yakında blok yoksa birim kapalı (gölgelendirici erken çıkar). */
const _of = new THREE.Vector3(), _or = new THREE.Vector3(), _ou = new THREE.Vector3();
function orbitNearCut(built: Built, camera: THREE.Camera, s: { orbitCut?: boolean }) {
  const c = camera.position;
  const near = nearBlocks(built.blocks, [c.x, c.y, c.z]);
  if (!near.length) {
    if (s.orbitCut) { writeStreetUniforms(cutawayUniforms, null); writeNearUniforms(cutawayUniforms, null); s.orbitCut = false; }
    return;
  }
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  _or.set(e[0], e[1], e[2]).normalize(); _ou.set(e[4], e[5], e[6]).normalize(); _of.set(-e[8], -e[9], -e[10]).normalize();
  const plan = orbitCutPlan([c.x, c.y, c.z], [_of.x, _of.y, _of.z], [_or.x, _or.y, _or.z], [_ou.x, _ou.y, _ou.z]);
  writeStreetUniforms(cutawayUniforms, plan.probes, plan.cam, plan.minY);
  writeNearUniforms(cutawayUniforms, plan.near, plan.minY, orbitGroup(built.blocks, [c.x, c.y, c.z], plan.minY)); // PANO-SKELETON-001
  s.orbitCut = true;
}

/** kip başlarken kesilen yürüme hedefi (şehirde CityRig aynı hedefi yeniden yazabilir; kipten çıkarmaz)*/
let shotGoal: [number, number] | null = null;
/** HQA-FIX: kip başında kesilen hedefin yankı penceresi (CityRig uzak hedef yeniden planı hemen gelir).*/
let shotGoalAt = 0;
const SHOT_GOAL_ECHO_MS = 1500;

/** manzara kipi durumu kapanır (arayüz deposu yalnız değişince yazılır).*/
function endShot(): void {
  landmarkView.active = false; landmarkView.stop = false; landmarkView.request = null;
  if (useLandmarkView.getState().active) useLandmarkView.setState({ active: false, key: null, rect: null });
}
const rule0Key = () => walkCamera.rule?.key ?? "";

function restoreOptics(cam: THREE.PerspectiveCamera, s: { baseFov: number; baseNear: number }) {
  if (!s.baseFov) return;
  if (cam.fov !== s.baseFov || cam.near !== s.baseNear) { cam.fov = s.baseFov; cam.near = s.baseNear; cam.updateProjectionMatrix(); }
  s.baseFov = 0; s.baseNear = 0;
}

/** Giriş pozu: kayıtlı konum ya da doğma karosu; avatar ve kamera açık görüşlü yöne bakar ( `spawnView.ts` `sceneSpawnPose`).*/
export function spawnPose(built: Built, core: SceneCore | null = null, saved: { x: number; z: number } | null = null, gates: readonly Tile[] = []): WalkPose {
  const sp = spawnTile(built, { core, saved });
  const t: Tile = sp?.tile ?? [Math.floor(built.width / 2), Math.floor(built.depth / 2)];
  // açık görüşlü bakış yönü (gerekirse eşik için yakın karoya kaydırma; kayıtlı konum kaydırılmaz)
  // kadraj araması baştan geçit kurallarıyla (karo geçitten ≥ GATE_CLEAR, şehir geçidi halkasından ≥ PORTAL_CLEAR;
  // yön geçide sırt dönük) — aşağıdaki kaydırma/çevirme yalnız güvenlik ağı
  const ring = officeDoor(built)?.tile;
  const hasRing = !!ring && gates.some((g) => g[0] === ring[0] && g[1] === ring[1]);
  const rules: SpawnRules | null = gates.length ? {
    tile: (i, j) => gates.every((g) => Math.max(Math.abs(i - g[0]), Math.abs(j - g[1])) >= GATE_CLEAR) && (!hasRing || Math.max(Math.abs(i - ring![0]), Math.abs(j - ring![1])) >= PORTAL_CLEAR)
      && !built.stations.some((s) => s.tile[0] === i && s.tile[1] === j) // ajan istasyonunun ve boşta durma noktasının
      && !built.rest.some((t) => t[0] === i && t[1] === j), // içinde doğulmaz (İstanbul: avatar Yazılımcı ajanının içinde doğuyordu)
    yaw: (tt, y) => awayFilter(tt, gates)?.(y) ?? true,
  } : null;
  let v = sceneSpawnPose(built, t, core, !!saved, rules);
  // HQA-FIX: geçitten ≥ GATE_CLEAR karo uzakta doğulur ve geçide sırt dönülür (ilk F oyuncuyu şehre atmaz)
  let c = clearOfGates(built, v.tile, gates);
  // şehir geçidinin ışık halkası ilk karede avatarın dibinde olmasın (geçide sırt dönük + kamera kolundan uzak)
  if (hasRing) c = clearOfGates(built, clearOfGates(built, c, [ring!], PORTAL_CLEAR), gates);
  if (c !== v.tile) v = sceneSpawnPose(built, c, core, true, rules);
  return { x: tx(v.tile[0]), z: tz(v.tile[1]), heading: faceAwayFromGates(built, v.tile, v.yaw, gates, core), tile: v.tile };
}

export { walkGates }; // HQA-FIX (routeAvoid.ts'e taşındı)

/** en yakın (≤ 8,5 karo) geçide bakmayan yönler (faceAwayFromGates ile aynı ölçü: geçide doğru bileşen ≤ 0); geçit yoksa null.*/
function awayFilter(tile: Tile, gates: readonly Tile[]): ((yaw: number) => boolean) | null {
  let g: Tile | null = null, gd = 8.5;
  for (const q of gates) { const d = Math.hypot(q[0] - tile[0], q[1] - tile[1]); if (d < gd) { gd = d; g = q; } }
  if (!g || gd === 0) return null;
  return (y) => (Math.sin(y) * (g![0] - tile[0]) + Math.cos(y) * (g![1] - tile[1])) / gd <= 0.3;
}

/** HQA-FIX: yakın (≤ 8 karo) geçide bakan yön yerine, geçide bakmayan en açık 8 yönden biri.*/
export function faceAwayFromGates(built: Built, tile: Tile, yaw: number, gates: readonly Tile[], core: SceneCore | null = null): number {
  let g: Tile | null = null, gd = 8.5;
  for (const q of gates) { const d = Math.hypot(q[0] - tile[0], q[1] - tile[1]); if (d < gd) { gd = d; g = q; } }
  if (!g || gd === 0) return yaw;
  const toward = (y: number) => (Math.sin(y) * (g![0] - tile[0]) + Math.cos(y) * (g![1] - tile[1])) / gd;
  if (toward(yaw) <= 0.3) return yaw;
  const rays = sceneSpawnView(built, tile, core).rays;
  let best = -1;
  for (let k = 0; k < VIEW_DIRS.length; k++) if (toward(VIEW_DIRS[k].yaw) <= 0 && (best < 0 || rays[k] > rays[best])) best = k;
  return best < 0 ? yaw : VIEW_DIRS[best].yaw;
}

// ------------------------------------------------------------------------------------------ DOM tarafı kancası
export interface WalkModeApi {
  active: boolean;
  /** Y / "Yürü": kayıtlı konum (dünya başına, W4) verilirse orası, yoksa doğma karosu */
  enter: (saved?: { x: number; z: number } | null) => void;
  exit: () => void;
  /** Yakındakiler / mini harita: oraya yürü */
  walkTo: (tile: Tile) => void;
}

/**
 * WorldPage / World (Canvas dışı) için küçük kanca: giriş, çıkış, hedefe yürü. Sahne önizlemesinde (`disabled`) giriş yok
 * (§3.2). Sayfa değişince (söküm) mod kapanır.
 */
export function useWalkMode(built: Built, world: string, core: SceneCore | null = null, disabled = false): WalkModeApi {
  const active = useWalkStore((s) => s.active);
  const enter = useCallback((saved?: { x: number; z: number } | null) => {
    if (disabled) return;
    useWalkStore.getState().enter(world, spawnPose(built, core, saved ?? null, walkGates(world, built))); // HQA-FIX
  }, [built, world, core, disabled]);
  const exit = useCallback(() => { useWalkStore.getState().exit(); }, []);
  const walkTo = useCallback((tile: Tile) => { useWalkStore.getState().setTarget(tile); }, []);
  useEffect(() => () => { if (useWalkStore.getState().active) useWalkStore.getState().exit(); }, []);
  useEffect(() => { if (disabled && useWalkStore.getState().active) useWalkStore.getState().exit(); }, [disabled]);
  return { active, enter, exit, walkTo };
}
