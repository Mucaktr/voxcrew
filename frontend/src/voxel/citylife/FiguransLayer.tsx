/**
 * CITYLIFE — figüranların ve satıcıların davranışı ve çizimi (saf çekirdek: `figurans.ts`, `vendors.ts`).
 *
 *  - **Şehir haritası** (`mode="city"`): figüranlar CityRig'in yüklü parsellerinde (yakın halka) doğar; semtin yaya ızgarasında
 *    (`pedGrid`) ilgi noktaları arasında yürür, vitrine bakar, gerçek oturağa oturur, satıcı önünde sıra olur (sıranın başı sipariş
 *    verince satıcı uzatır), simgeyi fotoğraflar, durakta bekler. Avatara yaklaşınca yana çekilir ve hiç içinden geçmez; ara sıra el
 *    sallar (yazı/konuşma yok). Parsel bırakılınca ya da avatardan `FIG_DESPAWN_R` uzaklaşınca silinir.
 *  - **Sahne** (`mode="scene"`): yalnız mekân satıcıları (taban dünyadaki tezgâhlar; ajanların çalışma alanına figüran girmez).
 *  - **Çizim:** bütün figüranlar tek örneklenmiş kutu dizisi (Lambert, örnek rengi, gölgesiz) → görünürken +1 çizim çağrısı. Her
 *    figüranın sabit yuva aralığı vardır (renk yalnız doğarken yazılır); uzakta yalnız temel parçalar (LOD 0). Yüz dokusu yok: iki koyu
 *    göz kutusu.
 *  - **Hareket azaltma:** daha az ve daha yavaş figüran, el sallama ve servis kol hareketi yok (nesne tezgâhta durur).
 *  - Ajan değildir: Yakındakiler'e, ajan listelerine, arka uca hiçbir şey yazmaz.
 */
import { headTopOfParts, UMB_ARM, umbrellaBoxes } from "../umbrella";
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { normalizeAvatar } from "../avatar";
import { BONE_PIVOT, BONES, characterParts, lerpPose, newPose, poseTargets, type Bone, type BoxPart, type Pose, type Seat } from "../parts";
import { reducedMotion } from "../motion";
import { walkRuntime } from "../walk/walkStore";
import { DC, DM, flushMarks, marksOf, put16 } from "../instanceDirty";
import { seatLift } from "../walk/scale";
import { ritualFx, ritualVendor } from "../fun/ritualRuntime";
import { districtPlan } from "../citymap/district";
import { CITY_PD, CITY_PW, type CityMapFile, type CityDistrict, type CityTile } from "../citymap/format";
import { useCity } from "../citymap/store";
import { arrivalTiles, figAvoid, figGrid } from "./figGrid";
import { vpAvoidAims } from "../citymap/vpAim"; // GATEFIX2,
import { tx, tz, type Block, type Tile } from "../scenes";
import { cityLifeRuntime } from "./runtime";
import { rideRuntime } from "../transit/ride";
import { vehicleHalfLength } from "../transit/model";
import { CROWD_VEIL_R, laneDist, laneSpansY } from "../walk/agentCam";
import { activityCam } from "../walk/activityFraming";
import {
  APRON, AVATAR_CLEAR, FIG_CALM_SPEED, FIG_SEP, FIG_DESPAWN_R, FIG_HARD_CAP, FIG_NEAR_MAX, FIG_NEAR_R, FIG_SPAWN_MIN, FIG_SPAWN_R, FIG_SPEED,
  arrivalCone, camBlocks, coneBlocks, rideBlocks, exitLane, figLook, figTarget, inCone, nearArrival, parcelPois, onRail, pedOk, railClear, railStep, pedPath, planPois, queuePois, seatAvoided, sepNudge, stationBand, targetOk, viewCone, rng, UMBRELLA_COLORS, VENDOR_MAX, YIELD_R, type PedGrid, type Poi,
} from "./figurans";
import { serveAt, serveProgress, vendorNear, vendorArmAngle, vendorDrawY, vendorRuntime, vendorWorkPose, venueVendors, type VenueAnchor, type Vendor } from "./vendors";
import { RITUALS } from "../fun/rituals/index";
import { anchorsOf } from "../fun/rituals/logic";
import { VENUE_KINDS } from "../fun/venues";

/** Oturan figüranın kök yüksekliği (Crowd SEAT_OFF ile aynı: kalça oturak üstünde). */
export const FIG_SEAT_OFF = 0.32;
/** avatar bir karede bu kadar sıçradıysa (ışınlanma) çevresindeki bu yarıçapta figüran silinir.*/
const ARRIVE_JUMP = 3, ARRIVE_PURGE = 3;
/** ( b/d): küçük ışınlanma (hat inişi: araç → durak karosu, 1,5–3 birim) çevresindeki bu yarıçapta figüran silinir; varıştan sonra bu süre boyunca kamera konisi yürüyen figürana kapalı.*/
const ARRIVE_SMALL_JUMP = 1.5, ARRIVE_SMALL_PURGE = 1.6, ARRIVE_CONE_SEC = 12;
/** Figüran başına yuva (parça) tavanı. */
const SLOTS = 72;
const CAP = (FIG_HARD_CAP + VENDOR_MAX) * SLOTS;

// ------------------------------------------------------------------------------------------ parça kümeleri
type Tag = "umbrella" | "camera" | "item" | "apron" | "step" | null;
interface FigPart { bone: Bone; local: THREE.Matrix4; color: THREE.Color; lod: 0 | 1; tag: Tag }
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const boxLocal = (p: readonly number[], s: readonly number[], r?: readonly number[]) => {
  _q.setFromEuler(r ? _e.set(r[0], r[1], r[2]) : _e.set(0, 0, 0));
  return new THREE.Matrix4().compose(_v.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
};
const lookCache = new Map<string, FigPart[]>();
/** Görünüm → parça listesi (kutular; dokulu dörtgenler yerine göz kutuları; ek: şemsiye, fotoğraf makinesi, servis nesnesi, önlük). */
/** `stepVox` (VENDOR-VIS): satıcının ayağı altındaki basamak kutusunun yüksekliği (voxel; 0 → yok). */
function partsFor(key: string, look: ReturnType<typeof figLook>["avatar"], umbrella: string, vendor: boolean, itemColor: string, stepVox = 0): FigPart[] {
  const ck = `${key}|${umbrella}|${vendor ? 1 : 0}|${itemColor}|${stepVox}`;
  const hit = lookCache.get(ck);
  if (hit) return hit;
  const out: FigPart[] = [];
  const cparts = characterParts(normalizeAvatar(look));
  for (const p of cparts) {
    if (p.kind !== "box") continue;
    const b = p as BoxPart;
    if (b.carry || b.device || (b.o !== undefined && b.o < 0.5)) continue;
    out.push({ bone: b.bone, local: boxLocal(b.p, b.s, b.r), color: new THREE.Color(b.c), lod: b.lod, tag: null });
  }
  // gözler (kafa önü z = 5)
  for (const x of [-2.1, 2.1]) out.push({ bone: "head", local: boxLocal([x, 5.4, 5.05], [1.3, 1.5, 0.2]), color: new THREE.Color("#1F1A17"), lod: 1, tag: null });
  // şemsiye (CEOGOZU): sap başın sağında dikey, el sapı tutar (UMB_ARM); kubbe şapka/kulak dahil başın üstünde — baş/şapka ile kesişmez
  for (const u of umbrellaBoxes(headTopOfParts(cparts))) {
    const c = u.k === "handle" ? new THREE.Color("#2B2B2B") : u.k === "dome" ? new THREE.Color(umbrella) : new THREE.Color(umbrella).multiplyScalar(0.85);
    out.push({ bone: "body", local: boxLocal(u.p, u.s), color: c, lod: u.k === "dome" ? 0 : 1, tag: "umbrella" });
  }
  // fotoğraf makinesi (iki elin arasında, göz hizasında; gövdeye bağlı)
  out.push({ bone: "body", local: boxLocal([0, 17.5, 6.5], [4.2, 2.6, 1.8]), color: new THREE.Color("#1F2937"), lod: 1, tag: "camera" });
  if (vendor) {
    out.push({ bone: "body", local: boxLocal([0, 8.2, 2.7], [6.6, 7.2, 0.4]), color: new THREE.Color(APRON), lod: 0, tag: "apron" });
    // uzatılan kâse/bardak (sağ elin ucunda)
    out.push({ bone: "armR", local: boxLocal([0, -7.6, 0.4], [3.2, 2.2, 3.2]), color: new THREE.Color(itemColor), lod: 1, tag: "item" });
    // VENDOR-VIS: yükseltilmiş satıcının altında ahşap basamak (el yapımı/açık tezgâhta havada durmasın; kapalı tezgâhta tezgâh gizler)
    if (stepVox > 0) out.push({ bone: "root", local: boxLocal([0, -stepVox / 2, 0], [11, stepVox, 9]), color: new THREE.Color("#6B4F3A"), lod: 0, tag: "step" });
  }
  if (lookCache.size > 400) lookCache.clear();
  lookCache.set(ck, out);
  return out;
}

// ------------------------------------------------------------------------------------------ durum
type FigState = "walk" | "glide" | "act" | "seat";
interface Fig {
  id: number;
  parts: FigPart[];
  slot: number;
  x: number; z: number; y: number;
  heading: number;
  /** semt (şehir) ızgarası */
  dist: string;
  grid: PedGrid;
  path: [number, number][];
  pi: number;
  state: FigState;
  poi: Poi | null;
  until: number;
  /** yanal şerit payı (tek sıra yürümesinler) */
  lat: number;
  speed: number;
  pose: Pose;
  target: Pose;
  clock: number;
  umbrella: boolean;
  /** el sallama bitişi (sn) ve soğuma */
  wave: number;
  waveCool: number;
  /** yol verme: bekleme bitişi */
  hold: number;
  /** çizim: yakın mı (LOD), görünür mü */
  near: boolean;
  served: boolean;
  colored: boolean;
}
interface VendorDraw { v: Vendor; parts: FigPart[]; pose: Pose; target: Pose; slot: number; colored: boolean; clock: number; step: number; seed: number; key: string; look: ReturnType<typeof figLook>["avatar"] }

interface DistLife { d: CityDistrict; grid: PedGrid; plan: ReturnType<typeof districtPlan>; pois: Poi[]; seats: Poi[]; parcels: Set<string>; blocks: Block[]; lane: Set<string>; avoid: Set<string>; arrivals: CityTile[]; vpCones: Map<string, Set<string>> }

const boneM: Record<Bone, THREE.Matrix4> = Object.fromEntries(BONES.map((b) => [b, new THREE.Matrix4()])) as Record<Bone, THREE.Matrix4>;
const PIVOT_V = Object.fromEntries(BONES.map((b) => [b, new THREE.Vector3(...BONE_PIVOT[b])])) as Record<Bone, THREE.Vector3>;
const ONE = new THREE.Vector3(1, 1, 1);
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _rp = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const POSE_OPTS: { seat?: Seat; seed?: number } = { seat: "bench", seed: 0 };

/** Kemik matrisleri (Crowd `writeChar` ile aynı zincir). */
function bones(x: number, y: number, z: number, facing: number, k: number, p: Pose) {
  _q.setFromEuler(_e.set(0, facing, 0));
  _m.compose(_rp.set(x, y, z), _q, _s.set(k, k, k));
  _q.setFromEuler(_e.set(p.rx, 0, 0));
  _m2.compose(_v.set(0, p.ry, p.fz), _q, ONE);
  boneM.root.multiplyMatrices(_m, _m2);
  _m2.compose(_v.set(0, p.by, 0), _q.identity(), ONE);
  boneM.body.multiplyMatrices(boneM.root, _m2);
  _q.setFromEuler(_e.set(p.hx, p.hy, p.hz)); _m2.compose(PIVOT_V.head, _q, ONE); boneM.head.multiplyMatrices(boneM.body, _m2);
  _q.setFromEuler(_e.set(p.la, 0, p.laz)); _m2.compose(PIVOT_V.armL, _q, ONE); boneM.armL.multiplyMatrices(boneM.body, _m2);
  _q.setFromEuler(_e.set(p.ra, 0, p.raz)); _m2.compose(PIVOT_V.armR, _q, ONE); boneM.armR.multiplyMatrices(boneM.body, _m2);
  _q.setFromEuler(_e.set(p.ll, 0, 0)); _m2.compose(PIVOT_V.legL, _q, ONE); boneM.legL.multiplyMatrices(boneM.root, _m2);
  _q.setFromEuler(_e.set(p.rl, 0, 0)); _m2.compose(PIVOT_V.legR, _q, ONE); boneM.legR.multiplyMatrices(boneM.root, _m2);
}

function writeFig(mesh: THREE.InstancedMesh, slot: number, parts: FigPart[], near: boolean, show: (t: Tag) => boolean, color: boolean) {
  const arr = mesh.instanceMatrix.array as Float32Array;
  const col = mesh.instanceColor!.array as Float32Array;
  const dm = marksOf(mesh, CAP); // yalnız değişen yuvalar GPU'ya
  const base = slot * SLOTS;
  for (let i = 0; i < SLOTS; i++) {
    const k = base + i;
    const p = parts[i];
    if (!p || (!near && p.lod !== 0) || (p.tag && !show(p.tag))) { if (put16(arr, k * 16, ZERO.elements)) dm[k] |= DM; continue; }
    _m.multiplyMatrices(boneM[p.bone], p.local);
    if (put16(arr, k * 16, _m.elements)) dm[k] |= DM;
    if (color) { p.color.toArray(col, k * 3); dm[k] |= DC; }
  }
}
/** göz kamerasında bu yarıçaptaki figüran gizlenir (m; 1. şahıs yakın düzlemi + baş payı).*/
export const FIG_EYE_HIDE = 1.3;
/** durak paneli açıkken takip kamerasına bu kadar (m) yakın figüran çizilmez (<city>: yakın figüran karenin %20'sini dolduruyordu).*/
export const FIG_PANEL_CAM_HIDE = 3.2;
/** etkinlik kadrajında (tezgâh/ritüel; kol 1,6–2,5 m) kameraya bu kadar (m) yakın figüran çizilmez — yarım ekranı kaplıyordu.*/
export const FIG_ACT_CAM_HIDE = 1.5;
function hideSlot(mesh: THREE.InstancedMesh, slot: number) {
  const arr = mesh.instanceMatrix.array as Float32Array, dm = marksOf(mesh, CAP);
  for (let i = 0; i < SLOTS; i++) { const k = slot * SLOTS + i; if (put16(arr, k * 16, ZERO.elements)) dm[k] |= DM; }
}

/** QATOOL (yalnız geliştirme kancası): şemsiye kutuları ile baş kemiği kutuları canlı pozda kesişiyor mu. Her kutu çiftinde
 *  7×7×7 örnek nokta iki yönde öbür kutunun yerel birim küpüne taşınır (dönük kutu da doğru; ince sap kaçmaz). */
function umbrellaHeadHits(figs: readonly Fig[], k: number, drop = 0): { checked: number; hits: { id: number; x: number; z: number }[] } {
  // `drop` (voxel): denetçinin kör olmadığını göstermek için şemsiyeyi aşağı kaydırır (betikte negatif kontrol; çizime etkisi yok)
  const inv = new THREE.Matrix4(), p = new THREE.Vector3(), N = 7, E = 0.5 - 1e-3, D = new THREE.Matrix4().makeTranslation(0, -drop, 0);
  const inside = (A: THREE.Matrix4, B: THREE.Matrix4) => {
    inv.copy(B).invert();
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) for (let c = 0; c < N; c++) {
      p.set(a / (N - 1) - 0.5, b / (N - 1) - 0.5, c / (N - 1) - 0.5).applyMatrix4(A).applyMatrix4(inv);
      if (Math.abs(p.x) < E && Math.abs(p.y) < E && Math.abs(p.z) < E) return true;
    }
    return false;
  };
  let checked = 0;
  const hits: { id: number; x: number; z: number }[] = [];
  for (const f of figs) {
    if (!f.umbrella || f.state === "seat") continue; // çizim kuralı: oturan figürde şemsiye yok
    checked++;
    bones(f.x, f.y, f.z, f.heading, k, f.pose);
    const U = f.parts.filter((q) => q.tag === "umbrella").map((q) => new THREE.Matrix4().multiplyMatrices(boneM[q.bone], D).multiply(q.local));
    const H = f.parts.filter((q) => q.bone === "head" && !q.tag).map((q) => new THREE.Matrix4().multiplyMatrices(boneM.head, q.local));
    if (U.some((u) => H.some((h) => inside(u, h) || inside(h, u)))) hits.push({ id: f.id, x: +f.x.toFixed(2), z: +f.z.toFixed(2) });
  }
  return { checked, hits };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const turn = (cur: number, want: number, dt: number) => cur + wrap(want - cur) * Math.min(1, dt * 6);
const cx = (I: number) => I - 11.5, cz = (J: number) => J - 7.5;
const ITEM: Record<string, string> = { tea_garden: "#C2410C", pub: "#E8B76A", chip_shop: "#E8B44A", cafe: "#F4EFE6", crepe_stand: "#F2D49B", food_stand: "#F59E0B" };

export interface FiguransProps {
  mode: "city" | "scene";
  /** şehir kipi: harita ve yerel kostüm şehri */
  map?: CityMapFile | null;
  /** yerel kostüm havuzu (sahne kimliği) */
  costumeScene: string | null;
  /** sahne kipi: taban dünyanın blokları (satıcılar) ve taban kayması (ritüel konumları) */
  blocks?: readonly Block[] | null;
  offset?: Tile;
  night: boolean;
  rain: () => boolean;
  paused: boolean;
}

/** Tezgâhlı mekânın ritüel konumları (el yapımı tezgâhın satıcısı için): sahne (taban kayması ile) ya da harita. */
function ritualAnchors(city: string | null, map: CityMapFile | null, offset: Tile): VenueAnchor[] {
  const out: VenueAnchor[] = [];
  for (const def of RITUALS) {
    // HQA-FIX: mekânsız "al" ritüeli (simit arabası…) — konumun `cart` yönünde arabanın ardında satıcı
    const counter = !!def.venue && VENUE_KINDS[def.venue].counter;
    const carts = (def.at.scene ?? []).some((s) => s.cart !== undefined) || (def.at.map ?? []).some((s) => s.cart !== undefined);
    if (!counter && !carts) continue;
    const kind = def.venue ?? "food_stand";
    const push = (a: { x: number; z: number; face: number | null; cart?: number; n: number }) => {
      if (counter) out.push({ x: a.x, z: a.z, face: a.face, kind, id: `${def.id}${a.n}` });
      else if (a.cart !== undefined) out.push({ x: a.x, z: a.z, face: a.cart, kind, id: `${def.id}${a.n}` });
    };
    if (map) {
      if (def.city !== map.id || !def.at.map?.length) continue;
      for (const a of anchorsOf(def, { kind: "map", map, toWorld: (I, J) => [cx(I), cz(J)] })) push(a);
    } else {
      if (def.city !== city || !def.at.scene?.length) continue;
      for (const a of anchorsOf(def, { kind: "scene", toWorld: (i, j) => [tx(i + offset[0]), tz(j + offset[1])] })) push(a);
    }
  }
  return out;
}

export function Figurans({ mode, map = null, costumeScene, blocks = null, offset = [0, 0], night, rain, paused }: FiguransProps) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const mat = useMemo(() => new THREE.MeshLambertMaterial(), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
    (m.instanceMatrix.array as Float32Array).fill(0);
    m.count = CAP; m.visible = false;
  }, []);
  const props = useRef({ mode, map, costumeScene, blocks, offset, night, rain, paused });
  props.current = { mode, map, costumeScene, blocks, offset, night, rain, paused };
  const st = useRef({
    figs: [] as Fig[], free: Array.from({ length: FIG_HARD_CAP }, (_, k) => FIG_HARD_CAP - 1 - k), nextId: 1, dists: new Map<string, DistLife>(),
    vendors: [] as VendorDraw[], vendorSig: "", allVendors: null as Vendor[] | null, vendorAt: 0, spawnAt: 0, trimAt: 0, t: 0, first: true, taken: new Set<string>(), ritual: null as string | null,
    avatarStill: 0, lastAx: 0, lastAz: 0, servedAt: "", full: true, rideWas: false, camX: 1e9, camZ: 1e9, arriveUntil: 0, coneAt: 0, cone: null as Set<string> | null,
  });

  // harita/sahne değişince her şey sıfırlanır
  useEffect(() => {
    const s = st.current;
    s.figs = []; s.free = Array.from({ length: FIG_HARD_CAP }, (_, k) => FIG_HARD_CAP - 1 - k); s.dists.clear(); s.vendors = []; s.vendorSig = ""; s.allVendors = null; s.first = true; s.taken.clear();
    const m = mesh.current;
    if (m) { (m.instanceMatrix.array as Float32Array).fill(0); m.instanceMatrix.needsUpdate = true; m.visible = false; s.full = true; }
    return () => { vendorRuntime.list = []; };
  }, [mode, map, blocks]);

  /** Şehir: semtin yaşam kaydı (ızgara + plan noktaları; parseller geldikçe oturak/engel/satıcı). */
  const distLife = (d: CityDistrict): DistLife => {
    const s = st.current, m = props.current.map!;
    let L = s.dists.get(d.id);
    if (!L) {
      const plan = districtPlan(m, d);
      const grid = figGrid(m, plan); // varış/çıkış karosu çevresi figüransız
      const avoid = figAvoid(m, d, plan); // GATEFIX2, durak varış kamerası + seyir bakışı; + kapı çıkışı kamera kolu
      L = { d, grid, plan, pois: planPois(grid, plan, avoid), seats: [], parcels: new Set(), blocks: [], lane: exitLane(grid, plan), avoid, arrivals: arrivalTiles(m, plan), vpCones: new Map() };
      s.dists.set(d.id, L);
    }
    return L;
  };
  const districtOf = (I: number, J: number): CityDistrict | null => {
    const m = props.current.map;
    if (!m) return null;
    return m.districts.find((q) => I >= q.bounds[0] && J >= q.bounds[1] && I < q.bounds[0] + q.bounds[2] && J < q.bounds[1] + q.bounds[3]) ?? null;
  };
  /** Yüklü parselleri işler (kare başına ≤ 1): engel, oturak; satıcılar semt bloklarından yeniden. */
  const ingest = (ax: number, az: number): boolean => {
    const s = st.current, stream = cityLifeRuntime.stream, m = props.current.map;
    if (!stream || !m) return false;
    const I = Math.floor(ax + 12), J = Math.floor(az + 8), pcx = Math.floor(I / CITY_PW), pcz = Math.floor(J / CITY_PD);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const key = `${pcx + dx},${pcz + dz}`;
      const p = stream.parcel(key) as { district?: string; near?: { blocks: Block[] } | null } | null;
      if (!p || !p.near || !p.district) continue;
      const d = m.districts.find((q) => q.id === p.district);
      if (!d) continue;
      const L = distLife(d);
      if (L.parcels.has(key)) continue;
      L.parcels.add(key);
      const { obst, seats } = parcelPois(L.grid, p.near.blocks), lane = L.lane, av = L.avoid;
      for (const k of obst) L.grid.obst[k] = 1;
      L.seats.push(...seats.filter((q) => pedOk(L.grid, q.li, q.lj) && !onRail(L.grid, q.x, q.z) && !lane.has(`${L.grid.i0 + q.li},${L.grid.j0 + q.lj}`) && !seatAvoided(av, L.grid.i0 + q.li, L.grid.j0 + q.lj) && !stationBand(L.grid, q.x, q.z) && !nearArrival(L.arrivals, q.x, q.z))); // çıkış şeridinde oturak yok; HQA-FIX-C: varış ön kaması / kamera koridoru / seyir koridorunda da yok
      for (const b of p.near.blocks) L.blocks.push(b);
      s.allVendors = null; // satıcılar yeniden bulunur
      return true;
    }
    return false;
  };
  /** Satıcılar (şehir: işlenmiş semt blokları; sahne: taban bloklar) — en yakın VENDOR_MAX çizilir. */
  const syncVendors = (ax: number, az: number) => {
    const s = st.current, P = props.current;
    const fresh = !s.allVendors;
    if (!s.allVendors) {
      const all: Vendor[] = [];
      if (P.mode === "scene") { if (P.blocks) all.push(...venueVendors(P.blocks, ritualAnchors(P.costumeScene, null, P.offset), "scene")); }
      else {
        const anchors = ritualAnchors(null, P.map, [0, 0]);
        for (const L of s.dists.values()) {
          const b = L.plan;
          const mine = anchors.filter((a) => { const I = Math.floor(a.x + 12), J = Math.floor(a.z + 8); return I >= b.i0 && J >= b.j0 && I < b.i0 + b.w && J < b.j0 + b.d; });
          all.push(...venueVendors(L.blocks, mine, `city:${L.d.id}`));
        }
      }
      s.allVendors = all;
    }
    const all = s.allVendors;
    vendorRuntime.list = all;
    // kuyruk noktaları (şehir): satıcı önü sıra
    if (P.mode === "city" && fresh) for (const L of s.dists.values()) {
      L.pois = L.pois.filter((q) => q.kind !== "queue");
      for (const v of all) if (v.id.startsWith(`city:${L.d.id}:`)) L.pois.push(...queuePois(L.grid, v.anchor, v.heading + Math.PI, v.id));
    }
    const near = [...all].sort((a, b) => Math.hypot(a.x - ax, a.z - az) - Math.hypot(b.x - ax, b.z - az)).slice(0, VENDOR_MAX)
      .filter((v) => Math.hypot(v.x - ax, v.z - az) <= FIG_DESPAWN_R + 10);
    const sig = near.map((v) => v.id).join(";");
    if (sig === s.vendorSig) return;
    s.vendorSig = sig;
    s.vendors = near.map((v, k) => {
      const prev = s.vendors.find((x) => x.v.id === v.id);
      const seed = 9000 + Math.abs(Math.round(v.x * 31 + v.z * 17)) * 7;
      const look = figLook(seed, P.costumeScene);
      const key = `v${seed}:${P.costumeScene}`;
      const parts = partsFor(key, look.avatar, UMBRELLA_COLORS[0], true, ITEM[v.kind] ?? "#F4EFE6");
      return { v, parts, pose: prev?.pose ?? newPose(), target: newPose(), slot: FIG_HARD_CAP + k, colored: false, clock: prev?.clock ?? k * 3.1, step: 0, seed: (seed % 97) / 97 * 6.28, key, look: look.avatar };
    });
  };

  /** Bir figüranın yeni hedefi: ilgi noktası (boş) ya da rastgele açık karo; rota bulunamazsa null. */
  const chooseTarget = (f: Fig, L: DistLife, r: () => number): boolean => {
    const s = st.current, nightNow = props.current.night;
    const fromLi = Math.floor(f.x + 12) - L.grid.i0, fromLj = Math.floor(f.z + 8) - L.grid.j0;
    if (!pedOk(L.grid, fromLi, fromLj)) return false;
    for (let tries = 0; tries < 6; tries++) {
      let poi: Poi | null = null;
      const u = r();
      const pool = u < 0.3 ? L.seats : L.pois;
      // gece: ışıklı kafe/tezgâh yanındaki oturaklar öncelikli; vitrin ve fotoğraf seyrek
      const av = walkRuntime.avatar;
      const cand = pool.filter((q) => !s.taken.has(q.key) && Math.hypot(q.x - av.x, q.z - av.z) > 1.4 /* avatarın durduğu noktaya figüran gitmez*/ && Math.abs(q.li - fromLi) + Math.abs(q.lj - fromLj) <= 26
        && (!nightNow || q.kind === "seat" || q.kind === "queue" || q.kind === "stop" || r() < 0.3));
      if (cand.length && u < 0.82) poi = cand[Math.floor(r() * cand.length)];
      let to: [number, number];
      if (poi) to = [poi.li, poi.lj];
      else {
        const li = fromLi + Math.round((r() - 0.5) * 24), lj = fromLj + Math.round((r() - 0.5) * 24);
        if (!targetOk(L.grid, li, lj)) continue; // ( a): rastgele durma hedefi durakta gövde yanında değil
        to = [li, lj];
      }
      if (to[0] === fromLi && to[1] === fromLj) continue;
      const path = pedPath(L.grid, [fromLi, fromLj], to, 2600);
      if (!path || !path.length) continue;
      if (f.poi) s.taken.delete(f.poi.key);
      f.poi = poi; if (poi) s.taken.add(poi.key);
      f.path = path; f.pi = 0; f.state = "walk";
      return true;
    }
    return false;
  };

  const spawn = (ax: number, az: number, now: number, outside = false): boolean => {
    const s = st.current, P = props.current;
    if (!s.free.length) return false;
    const id = s.nextId++;
    const r = rng(id * 7919 + Math.floor(now));
    // avatar bir semtin dışındaysa (varış meydanı) doğma halkası daralır: figüranlar varış karesinin görüş mesafesinde belirir
    const minD = s.first || outside ? 4 : FIG_SPAWN_MIN, maxD = outside ? 16 : FIG_SPAWN_R;
    for (let tries = 0; tries < (outside ? 24 : 10); tries++) {
      const ang = r() * Math.PI * 2, rad = minD + r() * (maxD - minD);
      const x = ax + Math.sin(ang) * rad, z = az + Math.cos(ang) * rad;
      if (camBlocks(x, z, s.camX, s.camZ)) continue; // kameranın dibinde doğmaz (yolculukta sonraki karede silinip yeniden doğuyordu)
      const I = Math.floor(x + 12), J = Math.floor(z + 8);
      const d = districtOf(I, J);
      if (!d) continue;
      const L = s.dists.get(d.id);
      if (!L || !L.parcels.has(`${Math.floor(I / CITY_PW)},${Math.floor(J / CITY_PD)}`)) continue;
      const li = I - L.grid.i0, lj = J - L.grid.j0;
      if (!pedOk(L.grid, li, lj)) continue;
      const look = figLook(id, P.costumeScene);
      const umb = UMBRELLA_COLORS[id % UMBRELLA_COLORS.length];
      const f: Fig = {
        id, parts: partsFor(`f${id}:${P.costumeScene}`, look.avatar, umb, false, ""), slot: s.free.pop()!, x: cx(I) + (r() - 0.5) * 0.3, z: cz(J) + (r() - 0.5) * 0.3,
        y: L.grid.top[lj * L.grid.w + li], heading: r() * Math.PI * 2, dist: d.id, grid: L.grid, path: [], pi: 0, state: "act", poi: null, until: 0,
        lat: (r() - 0.5) * 0.36, speed: (0.85 + r() * 0.3), pose: newPose(), target: newPose(), clock: r() * 10, umbrella: r() < 0.85, wave: 0, waveCool: 0,
        hold: 0, near: true, served: false, colored: false,
      };
      if (!chooseTarget(f, L, r)) { s.free.push(f.slot); continue; }
      s.figs.push(f);
      return true;
    }
    return false;
  };
  const remove = (f: Fig) => {
    const s = st.current;
    if (f.poi) s.taken.delete(f.poi.key);
    s.figs = s.figs.filter((x) => x !== f);
    s.free.push(f.slot);
    const m = mesh.current;
    if (m) hideSlot(m, f.slot);
  };

  useFrame((state, dt0) => {
    const m = mesh.current;
    const P = props.current, s = st.current;
    if (!m || !m.instanceColor) return;
    // yürüme kapalıysa gizle (avatar görünürlüğü değil: göz yedeği/1. şahısta `visible` false → `people` boşalıp kol uzuyor,
    // sonraki karede yeniden kısalıyordu; kamera ve figüranlar 2 karede bir sıçrıyordu). `people` temizliği unmount'ta.
    if (P.paused || !walkRuntime.live && P.mode === "city") { if (m.visible) m.visible = false; return; }
    const t0 = performance.now();
    const dt = Math.min(dt0, 0.1), calm = reducedMotion();
    s.t += dt;
    const av = walkRuntime.avatar, ax = av.x, az = av.z, panelOpen = useCity.getState().stopPanel;
    const HS = walkRuntime.humanScale, k = HS / 16;
    const now = performance.now();
    // ---- avatar sipariş veriyor mu: sipariş karosunda ~0,6 sn durdu ya da mekânda ritüel başladı → satıcı uzatır
    const moved = Math.hypot(ax - s.lastAx, az - s.lastAz) > 0.02;
    // ışınlanma (durak inişi, iç mekân çıkışı, hızlı seyahat) — avatarın yeni karosunun çevresindeki figüran kaybolur
    // (yürüyüş ızgarası varış karosunu zaten boş tutar; bu, varış anında orada olan figüranı temizler)
    const jump = Math.hypot(ax - s.lastAx, az - s.lastAz);
    if (jump > ARRIVE_SMALL_JUMP) {
      const pr = jump > ARRIVE_JUMP ? ARRIVE_PURGE : ARRIVE_SMALL_PURGE;
      for (const f of [...s.figs]) if (Math.hypot(f.x - ax, f.z - az) < pr) remove(f);
      s.arriveUntil = s.t + ARRIVE_CONE_SEC; s.coneAt = 0;
    }
    // yolculuk boyunca araç gövdesi/kamera çevresi figüransız; yolculuk bitince (iniş küçük sıçrama sayılmaz) varış konisi açılır
    const ride = rideRuntime.ride, riding = !!(ride || walkRuntime.ride);
    if (riding) {
      const bx = ride ? ride.body.x : ax, bz = ride ? ride.body.z : az, half = ride ? vehicleHalfLength(ride.plan.kind) : 0;
      for (const f of [...s.figs]) if (rideBlocks(f.x, f.z, ax, az, half, state.camera.position.x, state.camera.position.z) || rideBlocks(f.x, f.z, bx, bz, half, ax, az)) remove(f);
    } else if (s.rideWas) {
      for (const f of [...s.figs]) if (Math.hypot(f.x - ax, f.z - az) < ARRIVE_SMALL_PURGE) remove(f);
      s.arriveUntil = s.t + ARRIVE_CONE_SEC; s.coneAt = 0;
    }
    s.rideWas = riding;
    // varış penceresinde (kayık dahil) ve yolculukta kamera dibindeki figüran kalkar; kamera devri figüranın üstünden geçebilir
    s.camX = state.camera.position.x; s.camZ = state.camera.position.z;
    if (riding || s.t < s.arriveUntil) for (const f of [...s.figs]) if (camBlocks(f.x, f.z, s.camX, s.camZ)) remove(f);
    s.lastAx = ax; s.lastAz = az;
    s.avatarStill = moved ? 0 : s.avatarStill + dt;
    if (ritualFx.active && ritualFx.active !== s.ritual) serveAt(ax, az, now, 3.2);
    s.ritual = ritualFx.active;
    if (s.avatarStill > 0.6) {
      const v = vendorRuntime.list.find((q) => Math.hypot(q.anchor.x - ax, q.anchor.z - az) < 0.6);
      if (v && s.servedAt !== v.id) { s.servedAt = v.id; serveAt(v.anchor.x, v.anchor.z, now, 0.7); }
    } else if (moved) s.servedAt = "";

    let target = 0;
    if (P.mode === "city" && P.map) {
      ingest(ax, az);
      if (!s.allVendors || s.t >= s.vendorAt) { s.vendorAt = s.t + 1; syncVendors(ax, az); }
      const here = districtOf(Math.floor(ax + 12), Math.floor(az + 8));
      const theme = here ? s.dists.get(here.id)?.plan.theme ?? "generic" : "generic";
      target = figTarget({ hour: new Date().getHours(), night: P.night, rain: P.rain(), theme, reduced: calm, area: "district" });
      // doğma (varışta hızlı doluş, sonra 0,4 sn'de bir), fazlası (gece/hareket azaltma) en uzaktan silinir
      if (s.figs.length < target && s.t >= s.spawnAt) { if (spawn(ax, az, now, !here)) s.spawnAt = s.t + (s.first ? 0 : 0.4); else s.spawnAt = s.t + 0.5; }
      if (s.figs.length >= target) s.first = false;
      if (s.figs.length > target && s.t >= s.trimAt) {
        s.trimAt = s.t + 2;
        const far = [...s.figs].sort((a, b) => Math.hypot(b.x - ax, b.z - az) - Math.hypot(a.x - ax, a.z - az))[0];
        if (far && far.state !== "seat") remove(far);
      }
    } else if (P.mode === "scene") {
      if (!s.allVendors || s.t >= s.vendorAt) { s.vendorAt = s.t + 1; syncVendors(ax, az); }
    }

    // ( d): oyuncu seyir karosunda ya da varış anında — kamera konisi (yürüyen figüran girmez, konideki çizilmez)
    if (s.t >= s.coneAt) {
      s.coneAt = s.t + 0.5;
      let cone: Set<string> | null = null;
      const here = P.mode === "city" && P.map ? districtOf(Math.floor(ax + 12), Math.floor(az + 8)) : null, L = here ? s.dists.get(here.id) : undefined;
      if (L) {
        const I = Math.floor(ax + 12), J = Math.floor(az + 8);
        for (const t of L.plan.viewpoints) {
          if (t[0] !== I || t[1] !== J) continue;
          const key = `${t[0]},${t[1]}`;
          let vc = L.vpCones.get(key);
          if (!vc) { vc = viewCone(vpAvoidAims(P.map!, t, L.plan.lift[(t[1] - L.plan.j0) * L.plan.w + t[0] - L.plan.i0] ?? 0)); L.vpCones.set(key, vc); }
          cone = new Set([...(cone ?? []), ...vc]);
        }
        if (s.t < s.arriveUntil) {
          const cdx = state.camera.position.x - ax, cdz = state.camera.position.z - az;
          const heading = Math.hypot(cdx, cdz) > 1.5 ? Math.atan2(-cdx, -cdz) : av.heading;
          cone = new Set([...(cone ?? []), ...arrivalCone([Math.floor(ax + 12), Math.floor(az + 8)], heading)]);
        }
      }
      s.cone = cone;
    }
    const cone = s.cone;
    const rain = P.rain();
    let near = 0, seated = 0;
    const order = [...s.figs].sort((a, b) => Math.hypot(a.x - ax, a.z - az) - Math.hypot(b.x - ax, b.z - az));
    for (const f of order) {
      const dA = Math.hypot(f.x - ax, f.z - az);
      // silinme: çok uzak ya da parseli bırakıldı
      const I = Math.floor(f.x + 12), J = Math.floor(f.z + 8);
      const L = s.dists.get(f.dist);
      const stream = cityLifeRuntime.stream;
      if (dA > FIG_DESPAWN_R || !L || (stream && !stream.parcel(`${Math.floor(I / CITY_PW)},${Math.floor(J / CITY_PD)}`))) { remove(f); continue; }
      f.clock += dt;
      const px0 = f.x, pz0 = f.z; // ray bandından itiş yürünemez karoya düşerse önceki konum
      const r = rng(f.id * 131 + Math.floor(s.t * 3));
      const spd = (calm ? FIG_CALM_SPEED : FIG_SPEED) * f.speed;
      let motion: "walk" | "idle" | "sit" | "wave" = "idle";
      // ---- avatara yol verme: önünde avatar varsa bekler; yanındaysa yana çekilir; hiç içinden geçmez
      if (f.state === "walk" || f.state === "glide") {
        const nxt = f.path[f.pi];
        const tx0 = nxt ? cx(nxt[0] + L.grid.i0) : f.x, tz0 = nxt ? cz(nxt[1] + L.grid.j0) : f.z;
        const hx = tx0 - f.x, hz = tz0 - f.z, hl = Math.hypot(hx, hz) || 1;
        const ahead = ((ax - f.x) * hx + (az - f.z) * hz) / hl;
        if (dA < YIELD_R && ahead > 0 && ahead < YIELD_R) f.hold = Math.max(f.hold, 0.6);
      }
      if (f.hold > 0) { f.hold -= dt; motion = "idle"; }
      else if (f.state === "walk") {
        const nxt = f.path[f.pi];
        if (!nxt) {
          // varış: ilgi noktasına süzül (oturak/vitrin/sıra), yoksa kısa dur
          f.state = f.poi ? "glide" : "act";
          f.until = s.t + 1 + r() * 3;
        } else {
          const last = f.pi === f.path.length - 1;
          // yanal pay: yürüme yönüne dik (son karoda yok)
          const tx0 = cx(nxt[0] + L.grid.i0), tz0 = cz(nxt[1] + L.grid.j0);
          const dx = tx0 - f.x, dz = tz0 - f.z, dl = Math.hypot(dx, dz);
          const ox = last ? 0 : (dz / (dl || 1)) * f.lat, oz = last ? 0 : (-dx / (dl || 1)) * f.lat;
          const gx = tx0 + ox - f.x, gz = tz0 + oz - f.z, gl = Math.hypot(gx, gz);
          if (gl < 0.12 || dl < 0.35) { f.pi++; }
          else {
            const step = Math.min(gl, spd * dt);
            f.x += (gx / gl) * step; f.z += (gz / gl) * step;
            f.heading = turn(f.heading, Math.atan2(gx, gz), dt);
            const li = Math.floor(f.x + 12) - L.grid.i0, lj = Math.floor(f.z + 8) - L.grid.j0;
            const want = L.grid.top[Math.max(0, Math.min(L.grid.d - 1, lj)) * L.grid.w + Math.max(0, Math.min(L.grid.w - 1, li))];
            f.y += (want - f.y) * Math.min(1, dt * 10);
          }
          motion = "walk";
        }
      } else if (f.state === "glide") {
        const p = f.poi!;
        const gx = p.x - f.x, gz = p.z - f.z, gl = Math.hypot(gx, gz);
        if (gl < 0.04) {
          f.x = p.x; f.z = p.z;
          if (p.seat) { f.state = "seat"; f.until = s.t + 10 + r() * (P.night ? 30 : 16); }
          else { f.state = "act"; f.until = s.t + (p.kind === "queue" ? 5 + r() * 6 : p.kind === "stop" ? 7 + r() * 9 : p.kind === "photo" ? 3 + r() * 3 : 3 + r() * 4); }
          f.served = false;
        } else {
          const step = Math.min(gl, spd * 0.7 * dt);
          f.x += (gx / gl) * step; f.z += (gz / gl) * step;
          f.heading = turn(f.heading, gl > 0.3 ? Math.atan2(gx, gz) : p.heading, dt);
          motion = "walk";
        }
      } else {
        // etkinlik (dur, otur, sıra, fotoğraf, bekle) → süre bitince yeni hedef
        if (f.poi) f.heading = turn(f.heading, f.poi.heading, dt);
        if (f.state === "seat") motion = "sit";
        if (f.poi?.kind === "queue" && !f.served && f.poi.key.endsWith("0")) { f.served = true; serveAt(f.x, f.z, now, 1.2); }
        if (s.t >= f.until) {
          if (f.state === "seat" && f.poi) {
            // oturaktan kalkış: durulan karoya geri
            f.x = cx(f.poi.li + L.grid.i0); f.z = cz(f.poi.lj + L.grid.j0);
          }
          f.state = "act";
          if (!chooseTarget(f, L, r)) f.until = s.t + 2;
        }
      }
      // ( d): yürüyen/süzülen figüran etkin kamera konisine girmez — adım geri alınır, figüran bekler (rota ve hedef durur, silinmez)
      if (cone && (f.state === "walk" || f.state === "glide") && coneBlocks(cone, px0, pz0, f.x, f.z)) { f.x = px0; f.z = pz0; f.hold = Math.max(f.hold, 0.3); motion = "idle"; }
      // yürüyen/süzülen figüran raylı aracın gövde bandına girmez (doğma/yanal pay komşu karoda gövdenin içine sokuyordu)
      if (f.state !== "seat" && L.grid.rails?.length) {
        const [rx, rz] = railClear(L.grid, f.x, f.z);
        // itiş yeri yürünemezse figüran bantta KALIYORDU (Şanghay metro önü) — önceki (bant dışı) konuma döner, o da bantta ise silinir
        if (rx !== f.x || rz !== f.z) {
          const to = railStep(L.grid, f.x, f.z, rx, rz, px0, pz0);
          if (!to) { remove(f); continue; }
          f.x = to[0]; f.z = to[1];
        }
      }
      // avatar oturan figüranın üstüne düştüyse (kapı çıkışı, ışınlanma) figüran kalkar — oturak bölümü dışarı itmez
      if (f.state === "seat" && Math.hypot(f.x - ax, f.z - az) < AVATAR_CLEAR) f.until = s.t;
      // avatara hiç girmez: AVATAR_CLEAR içindeyse dışarı itilir (oturan hariç; itilen yer açık karoysa)
      if (f.state !== "seat") {
        const ddx = f.x - ax, ddz = f.z - az, dd = Math.hypot(ddx, ddz);
        if (dd < AVATAR_CLEAR && dd > 1e-4) {
          let moved = false;
          // HQA-FIX: itilen yer kapalıysa (kaldırım kenarı, duvar) yanlara ve arkaya da denenir — eskiden figüran avatarın içinde kalıyordu
          const ux = ddx / dd, uz = ddz / dd;
          for (const [rx, rz] of [[ux, uz], [-uz, ux], [uz, -ux], [-ux, -uz]] as const) {
            const nx = ax + rx * AVATAR_CLEAR, nz = az + rz * AVATAR_CLEAR;
            if (pedOk(L.grid, Math.floor(nx + 12) - L.grid.i0, Math.floor(nz + 8) - L.grid.j0)) { f.x = nx; f.z = nz; f.hold = Math.max(f.hold, 0.4); moved = true; break; }
          }
          if (!moved) { remove(f); continue; } // itecek açık yer yoksa figüran avatarın içinde kalmaz, kaybolur
        }
        // HQA-FIX: figüranlar üst üste binmez — aynı şeritte birbirine yapışık sürü yerine aralarında FIG_SEP kalır
        for (const g of s.figs) {
          if (g === f || g.state === "seat") continue;
          const sd = Math.hypot(f.x - g.x, f.z - g.z);
          if (sd >= FIG_SEP || sd < 1e-4) continue;
          const to = sepNudge(L.grid, f, g); // itme kapalıysa dik/geri; hiçbiri açık değilse adım geri alınır, figüran bekler
          if (to) { f.x = to[0]; f.z = to[1]; } else if (f.id > g.id && Math.hypot(px0 - g.x, pz0 - g.z) > sd) { f.x = px0; f.z = pz0; f.hold = Math.max(f.hold, 0.3); motion = "idle"; }
        }
      }
      // selam: avatar 2 birim içinde geçerken ara sıra el sallar (yazı yok; hareket azaltmada yok)
      f.waveCool -= dt;
      if (!calm && dA < 2.2 && f.waveCool <= 0 && f.state !== "seat") { f.waveCool = 25 + r() * 20; if (r() < 0.35) f.wave = s.t + 1.4; }
      if (f.wave > s.t && motion !== "walk") motion = "wave";
      // poz
      POSE_OPTS.seat = f.poi?.seat?.kind === "chair" ? "chair" : "bench"; POSE_OPTS.seed = (f.id % 97) / 97;
      poseTargets(motion === "sit" ? "sit" : motion, f.clock * (motion === "walk" ? (calm ? 0.7 : 1) : 1), calm, f.target, POSE_OPTS);
      const photo = f.state === "act" && f.poi?.kind === "photo";
      if (photo) { f.target.la = -1.45; f.target.ra = -1.45; f.target.laz = 0.35; f.target.raz = -0.35; f.target.hx = -0.05; }
      const umb = f.umbrella && rain && f.state !== "seat";
      if (umb && !photo) { f.target.ra = UMB_ARM.ra; f.target.raz = UMB_ARM.raz; }
      lerpPose(f.pose, f.target, Math.min(1, dt * 10));
      f.near = dA <= FIG_NEAR_R && near < FIG_NEAR_MAX;
      if (f.near) near++;
      if (f.state === "seat") seated++;
      const seatTop = f.state === "seat" && f.poi?.seat ? f.poi.seat.y : null;
      const y = seatTop !== null ? seatTop - FIG_SEAT_OFF + seatLift(true, HS) : f.y;
      // göz kamerasında (1. şahıs / göz yedeği) merceğe FIG_EYE_HIDE'den yakın figüran çizilmez (yüz ekranı kaplıyordu)
      if (inCone(cone, f.x, f.z)) { hideSlot(m, f.slot); continue; } // ( d): konideki figüran (önceden orada duran/bekleyen) koni sürerken çizilmez
      if (!walkRuntime.visible && Math.hypot(f.x - av.x, f.z - av.z) < FIG_EYE_HIDE) { hideSlot(m, f.slot); continue; }
      if (panelOpen && Math.hypot(f.x - state.camera.position.x, f.z - state.camera.position.z) < FIG_PANEL_CAM_HIDE) { hideSlot(m, f.slot); continue; }
      if (activityCam.kind && Math.hypot(f.x - state.camera.position.x, f.z - state.camera.position.z) < FIG_ACT_CAM_HIDE) { hideSlot(m, f.slot); continue; }
      // kamera figüran yüzünden kısalmadı (WalkRig `crowdVeil`) — kamera ile avatar arasındaki figüran çizilmez
      if (riding && laneDist(f.x, f.z, state.camera.position.x, state.camera.position.z, ax, az) < CROWD_VEIL_R) { hideSlot(m, f.slot); continue; } // yolculukta kamera → avatar koridoru boş
      if (cityLifeRuntime.veil && laneDist(f.x, f.z, state.camera.position.x, state.camera.position.z, ax, az) < CROWD_VEIL_R && laneSpansY(f.y, state.camera.position.y, walkRuntime.drawY)) { hideSlot(m, f.slot); continue; }
      bones(f.x, y, f.z, f.heading, k, f.pose);
      writeFig(m, f.slot, f.parts, f.near, (tag) => (tag === "umbrella" ? umb : tag === "camera" ? photo : false), !f.colored);
      f.colored = true;
    }
    // takip kamerası figüranların bedenine girmez (WalkRig `clearOfPeople`; statik blok kaynağı kişileri bilmez)
    const pp = cityLifeRuntime.people;
    pp.length = s.figs.length;
    for (let q = 0; q < s.figs.length; q++) { const f = s.figs[q]; const o = pp[q] ?? (pp[q] = { x: 0, y: 0, z: 0 }); o.x = f.x; o.y = f.y; o.z = f.z; }
    // ---- satıcılar: tezgâh arkasında durur, müşteriye bakar; servis ederken sağ kol uzanır, elde kâse/bardak
    for (const vd of s.vendors) {
      const v = vd.v;
      vd.clock += dt;
      const u = serveProgress(v.id, now);
      poseTargets("idle", vd.clock, calm, vd.target, POSE_OPTS);
      vendorWorkPose(vd.target, vd.clock, calm, vd.seed, vendorArmAngle(v, HS)); // VENDOR-VIS: kollar tezgâhta, silme/yoğurma, ara sıra bakış + el uzatma
      const serving = u >= 0;
      // VENDOR-VIS: el değiştirme — servis sırasında kâse/bardak elden müşterinin sipariş karosuna doğru kayar (u 0,25 … 0,85)
      const itemP = vd.parts.find((q) => q.tag === "item");
      if (itemP) {
        let ext = 0;
        if (serving && !calm) { const f = Math.min(1, Math.max(0, (u - 0.25) / 0.6)); ext = f * f * (3 - 2 * f) * Math.max(0, (Math.hypot(v.anchor.x - v.x, v.anchor.z - v.z) - 0.5 * HS) / k); }
        itemP.local = boxLocal([0, -7.6 - ext, 0.4], [3.2, 2.2, 3.2]);
      }
      if (serving && !calm) { const e = Math.sin(Math.PI * Math.min(1, u * 1.15)); vd.target.ra = vd.target.ra * (1 - e) - 1.45 * e; vd.target.raz = -0.1 * e; vd.target.hx = 0.18 * e; vd.target.rx = 0.16 * e; /* öne eğilip uzatır */ }
      lerpPose(vd.pose, vd.target, Math.min(1, dt * 10));
      // VENDOR-VIS: tezgâh üstü gövde ortasına gelecek yükseklik (çizim ölçeğine göre; omuz/baş tezgâhın üstünde); basamak 2 voxel adımla
      const vy = vendorDrawY(v, HS), stepNow = vy - v.y > 0.01 ? Math.ceil((vy - v.y) / k / 2) * 2 + 1 : 0;
      if (stepNow !== vd.step) {
        vd.step = stepNow; vd.colored = false;
        vd.parts = partsFor(vd.key, vd.look, UMBRELLA_COLORS[0], true, ITEM[v.kind] ?? "#F4EFE6", stepNow);
      }
      bones(v.x, vy, v.z, v.heading, k, vd.pose);
      const dV = Math.hypot(v.x - ax, v.z - az);
      writeFig(m, vd.slot, vd.parts, dV <= FIG_NEAR_R, (tag) => tag === "apron" || tag === "step" || (tag === "item" && serving), !vd.colored);
      vd.colored = true;
    }
    for (let k2 = s.vendors.length; k2 < VENDOR_MAX; k2++) hideSlot(m, FIG_HARD_CAP + k2);
    { const dm = marksOf(m, CAP); flushMarks(m.instanceMatrix, 16, dm, DM, s.full); flushMarks(m.instanceColor, 3, dm, DC, s.full); dm.fill(0); s.full = false; } // değişen yuva aralıkları
    m.visible = s.figs.length + s.vendors.length > 0;
    const S = cityLifeRuntime.stats;
    S.figs = s.figs.length; S.near = near; S.seated = seated; S.vendors = s.vendors.length; S.target = target;
    S.instances = s.figs.reduce((n, f) => n + f.parts.filter((p) => f.near || p.lod === 0).length, 0) + s.vendors.reduce((n, v) => n + v.parts.length, 0);
    S.ms = S.ms * 0.9 + (performance.now() - t0) * 0.1;
  });

  // VENDOR-VIS: ACTIVITY-FEEL satıcı dikişi — ritüel/ajan yemeğinde sipariş anı yakındaki satıcıya el uzattırır (eskiden hiçbir şey bağlı değildi)
  useEffect(() => {
    ritualVendor.at = (x, z) => { const v = vendorNear(x, z, 3.2); return v ? { x: v.x, z: v.z } : null; };
    ritualVendor.onOrder = (o) => { serveAt(o.x, o.z, performance.now(), 3.2); };
    return () => { ritualVendor.at = null; ritualVendor.onOrder = null; };
  }, []);

  useEffect(() => () => { cityLifeRuntime.people.length = 0; }, []); // iç mekânda hayalet figüran kolu kısaltmaz

  // geliştirme kancası (ekran görüntüsü ve canlı denetim)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voxcrewFigurans?: unknown };
    w.__voxcrewFigurans = {
      stats: () => ({ ...cityLifeRuntime.stats }),
      list: () => st.current.figs.map((f) => ({ id: f.id, x: +f.x.toFixed(2), z: +f.z.toFixed(2), y: +f.y.toFixed(3), state: f.state, poi: f.poi?.kind ?? null,
        seat: f.state === "seat" ? f.poi?.seat ?? null : null, near: f.near, dist: f.dist })),
      vendors: () => vendorRuntime.list.map((v) => ({ ...v })),
      serve: (x: number, z: number) => serveAt(x, z),
      // QATOOL (scripts/live_verify.mjs): şemsiye ve avlu çıkış şeridi canlı denetimi
      /** bütün figüranlara şemsiye verir, avatarın 4–16 birim çevresinde en çok `n` figüran daha doğurur; doğan sayı */
      umbrellas: (n = 6) => {
        const s = st.current, a = walkRuntime.avatar;
        for (const f of s.figs) f.umbrella = true;
        let k = 0;
        for (let t = 0; t < n * 4 && k < n; t++) if (spawn(a.x, a.z, performance.now() + t, true)) { s.figs[s.figs.length - 1].umbrella = true; k++; }
        return k;
      },
      /** şemsiye (sap/kubbe/tepe) ↔ baş kemiği kutuları, o anki canlı pozla; yağmur yoksa şemsiye çizilmez → denetlenen 0 */
      rain: () => props.current.rain(),
      umbrellaHits: (drop = 0) => (props.current.rain() ? umbrellaHeadHits(st.current.figs, walkRuntime.humanScale / 16, drop) : { checked: 0, hits: [] }),
      /** avlu/landmark çıkış şeridindeki (`exitLane`) figüranlar ve şerit karoları ("i,j") */
      lane: () => {
        const s = st.current, figs = [], tiles = new Set<string>();
        for (const L of s.dists.values()) for (const k of L.lane) tiles.add(k);
        for (const f of s.figs) if (tiles.has(`${Math.floor(f.x + 12)},${Math.floor(f.z + 8)}`)) figs.push({ id: f.id, x: +f.x.toFixed(2), z: +f.z.toFixed(2), state: f.state, poi: f.poi?.kind ?? null });
        return { figs, tiles: [...tiles] };
      },
    };
    return () => { delete w.__voxcrewFigurans; };
  }, []);

  return <instancedMesh ref={mesh} args={[geo, mat, CAP]} frustumCulled={false} castShadow={false} receiveShadow={false} visible={false} name="figurans" />;
}
