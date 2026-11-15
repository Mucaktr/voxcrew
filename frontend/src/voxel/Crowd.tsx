/**
 * Kalabalık çizici (S13): bütün karakterler malzeme sınıfı başına tek InstancedMesh ile çizilir (gövde parçaları,
 * parlak parçalar, saydam parçalar, dokulu yüz/gövde dörtgenleri → ~7 çizim çağrısı, ajan sayısından bağımsız).
 * Hareket (yol bulma, dolaşma, teslim), animasyon (kemik matrisleri → örnek matrisleri), göz kırpma, LOD
 * (uzakta yalnızca temel parçalar; ekran dışında güncelleme yok) ve seçim/üstüne gelme (görünmez tek hit-box
 * InstancedMesh) burada tek bir useFrame döngüsünde yürür. Yakın/odaktaki ajanların HUD'u World.tsx'te drei Html ile,
 * diğerlerinin hafif ad etiketi 2B tuvalde (LabelLayer) çizilir.
 * S33 (canlı dünya): başıboş dolaşma yok — ajan çalışırken masasında sandalyede oturur, web/okuma için kitaplığa/pencereye,
 * kabuk için terminale/sunucu dolabına gider ve döner; boşta masasında oturur, ara sıra kahveye/kanepeye gidip döner.
 * Gerçek bir teslim/mesaj olayında iki ajan buluşma noktasına yürüyüp karşılıklı konuşur (balon: olayın kısa özeti).
 * Etiketler ad + etkinlik fiili + bağlayıcı simgesi taşır; +XP baloncukları aynı tuvalde çizilir.
 * PHYS: yürüyüş paylaşılan fizik katmanıyla (voxel/physics/*): her karakter bir daire beden; 30 Hz sabit adım (çizimde ara
 * değer), ivme/yavaşlama, yerel kaçınma, kuyruk, eşya/duvar çarpıştırıcıları ve sert örtüşmezlik. Oturan/çalışan/uyuyan
 * duran beden; yürüme modu avatarı kinematik beden (ajanlar yol verir). Takılan yeniden plan yapar, olmazsa yedek hedefe geçer.
 */
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { isGameVisible, prefersReducedMotion, useGame } from "../lib/game";
import { tx as msg } from "../lib/i18n";
import type { Handoff, Mood } from "../lib/types";
import { world as M } from "../locales/world";
import { connKind, worldCaption, xpPops, type ConnKind, type Talk } from "../components/world/activity";
import { useFunMoments } from "../components/world/viewSettings";
import { TextureAtlas, type UvRect } from "./atlas";
import { normalizeAvatar } from "./avatar";
import type { Motion } from "./Character";
import type { WorldLive } from "./live";
import { reducedMotion } from "./motion";
import { bumpFx, bumpMotion, createFunWorld, doBump, dropFunChar, endFun, forceFun, funPhase, handPos, stepFun, type Bump, type Fun, type FunEnv, type FunKind } from "./fun/brain";
import { isPortalSpot, MEET_WALK_SPEED, nearestSleepSpot, portalClaim, restMode, sleepPool, WALK_DT_MAX, WALK_SPEED } from "./fun/sleep";
import { AGENT_R, AVATAR_R, createBody, KINEMATIC, OFF, STATIC, WALK, type Body } from "./physics/bodies";
import { addBody, advance, createPhysics, placeFree, removeBody, replan, type Physics } from "./physics/solver";
import { staticPush, staticWorld, tileIndex } from "./physics/world";
import { deskTarget, queueDetour, QUEUE_MIN, QUEUE_SPAN } from "./physics/queue";
import { sites } from "./fun/sites";
import { box as fxBox, burst as fxBurst, makeFxMesh, stepFx, type FxState } from "./fun/fx";
import { createGiftWorld, ensureDesk, giftMotion, meGesture, playGift, playMeal, playReaction, playSelf, stepGifts, type Feast, type GiftAct, type GiftCh, type GiftEnv, type GiftReact } from "./fun/gifts";
import type { GiftKind } from "./fun/giftPlan";
import { drawHeld, drawItem, createPropPool, PROP_GLOW, PROP_SOLID, tossBits } from "./fun/propPool";
import { DC, DM, flushMarks, put16, resetShadow } from "./instanceDirty";
import { orderFromVendor, ritualFeel, ritualFx, ritualRuntimeOpts } from "./fun/ritualRuntime";
import { drawWaypoint } from "./walk/waypoint";
import { biteLeft, feelStage, savorMs, savorPose, sipArms, sipTiltAt, stageFace, type ExprStage } from "./fun/activityFace";
import { MEAL_CHANCE, MEAL_JOY, MEAL_STAY, mealCap, mealSpots, type MealSpot } from "./fun/agentMeals";
import { mgActor, mgBridge, startMinigame, stopMinigame } from "./fun/minigames";
import { CAST_MS } from "./fun/fishing";
import { drawMinigame, drawMoods, resolveMinigame, writePropPool } from "./fun/walkFun";
import { ensureMoods } from "../full/worldGifts";
import { useLabelMode, type LabelMode } from "./props/daynight";
import { BONE_PARENT, BONE_PIVOT, BONES, characterParts, lerpPose, LYING, newPose, poseTargets, type Bone, type HeldDevice, type Part, type Pose, type PoseOpts, type Seat } from "./parts";
import { MOOD_FACE, type Face } from "./pixels";
import { findPath, key, nearestStation, tileOf, toolKind, tx, tz, type Built, type Station, type Tile, type ToolKind } from "./scenes";
import type { HoverHandler, WorldAgent } from "./World";
import type { MeLook } from "./walk/me";
import { useWalkStore, walkRuntime } from "./walk/walkStore";
import { emoteMotion } from "./walk/emotes";
import { LOOK_Y, seatLift } from "./walk/scale";
import { coverGrid } from "./walk/controller";
import { labelOccluded } from "./walk/labelOcclusion";
import { sleepReach, spotReach } from "./reach";

/** Ajanın yerleşim planı (World.tsx): masası, uyuma yeri, doğduğu karo; S33: istasyon paylaşılıyorsa (`shared`) boşta
 *  duracağı karo (`idle`), en yakın kahve makinesi önü ve kanepe/dinlenme karoları (mola). */
export interface AgentPlan {
  station: Station; rest: Tile; spawn: Tile; wander: Tile[];
  shared: boolean; idle: Tile; coffee: Station | null; lounge: Station[]; sofaTiles: Set<string>;
}

export interface CrowdProps {
  agents: WorldAgent[];
  plan: AgentPlan[];
  built: Built;
  handoffs: Handoff[];
  /** S33: gerçek mesaj/teslim olaylarından konuşmalar (activity.ts `useWorldTalk`) */
  talks: Talk[];
  live: WorldLive;
  /** ekip filtresi: diğer ekiplerin karakterleri soluk çizilir */
  focusTeam?: string | null;
  selected: string | null;
  hovered: string | null;
  onSelect: (slug: string) => void;
  onHover?: HoverHandler;
  /** HUD alacak ajanlar değişince (≈ 4 Hz) */
  onFocusSet: (slugs: string[]) => void;
  labelCanvas: RefObject<HTMLCanvasElement | null>;
  /** HUD gösterilen ajanlar (etiket çizilmez) */
  hudSlugs: Set<string>;
  /** S38: bölge/ekip tabelaları — en düşük öncelikli etiketler (ajan etiketleriyle çakışırsa, uzaktaysa çizilmez) */
  signs?: WorldSign[];
  /** S48: sahne kiti (eğlence seçimi: olta, kartopu, frizbi…) ve ufuk denizinin yüksekliği (kenardan olta) */
  kit?: string;
  oceanY?: number | null;
  /** W2-INT: sahnede yağmur yağıyor (şemsiye anı) */
  rain?: boolean;
  /** W2 (WALK-INT, D1 A): yürüme modunun "Ben" avatarı — aynı örnek dizilerinde bir örnek daha (+0 çizim çağrısı). Konum, bakış ve
   *  hız her karede `walkRuntime`'dan okunur; görünür yalnızca `walkRuntime.live && visible` iken. Ajan değildir: hit-box, HUD,
   *  `live.positions`, `live.count` ve bench sayılarına girmez. `name` boşsa çağıran yerel "Ben" adını verir. */
  me?: MeLook | null;
}

/** Yürüme modunda ajan adları yalnızca avatarın bu yarıçapında (birim) çizilir (§8 "Etiketler"). */
const WALK_LABEL_R = 8;
/** "Ben" etiketi yalnızca kamera avatara bu kadar yakınken (birim; takip kamerası ≈ 3–10). */
const ME_LABEL_DIST = 16;

/** S38 — dünyadaki tabela etiketi: ekip adı (`text`) ya da bölge adı (`label`: locales/world.ts anahtarı), dünya konumu. */
export interface WorldSign { x: number; y: number; z: number; text?: string; label?: string; color: string; kind: "team" | "place"; team?: string }

const TOOL_MOTION: Record<ToolKind, Motion> = { web: "think", read: "read", shell: "type", plan: "talk", write: "sitType" };
/** kare başına en çok bu kadar yol hesabı (geri kalanı bir sonraki kareye kalır) */
const PLAN_BUDGET = 10;
/** karakter ekranda bu piksel yüksekliğinin altındaysa "uzak" (yalnızca temel parçalar) */
const FAR_PX = 14;
/** hafif ad etiketi için en küçük karakter yüksekliği (px) */
const LABEL_PX = 26;
const MAX_REST_DIST = 12;

type BatchId = "solid" | "glow" | "a32" | "a45" | "a82" | "a95" | "tex";
const BATCH_IDS: BatchId[] = ["solid", "glow", "a32", "a45", "a82", "a95", "tex"];

function batchOf(p: Part): BatchId {
  if (p.kind === "quad") return "tex";
  if (p.glow) return "glow";
  if (p.o !== undefined) return `a${Math.round(p.o * 100)}` as BatchId;
  return "solid";
}

interface PartSet { parts: Part[]; locals: THREE.Matrix4[]; batch: BatchId[] }
const partCache = new Map<string, PartSet>();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
function partSet(sig: string, wa: WorldAgent, badge = false): PartSet {
  let ps = partCache.get(sig);
  if (ps) return ps;
  const parts = characterParts(normalizeAvatar(wa.agent.avatar), wa.external?.accessory ?? null, badge);
  const locals = parts.map((p) => {
    const m = new THREE.Matrix4();
    if (p.kind === "box") {
      _q.setFromEuler(p.r ? _e.set(p.r[0], p.r[1], p.r[2]) : _e.set(0, 0, 0));
      m.compose(_v.set(p.p[0], p.p[1], p.p[2]), _q, _s.set(p.s[0], p.s[1], p.s[2]));
    } else {
      m.compose(_v.set(p.p[0], p.p[1], p.p[2]), _q.identity(), _s.set(p.w, p.h, 1));
    }
    return m;
  });
  ps = { parts, locals, batch: parts.map(batchOf) };
  if (partCache.size > 600) partCache.clear();
  partCache.set(sig, ps);
  return ps;
}

type Lod = "near" | "far" | "off";

interface Ch extends GiftCh {
  slug: string;
  wa: WorldAgent;
  index: number;
  sig: string;
  set: PartSet;
  scale: number;
  /** parça → örnek yuvası (toplu dizide) */
  slots: Int32Array;
  pos: THREE.Vector3;
  facing: number;
  path: Tile[];
  goal: Tile | null;
  waitUntil: number;
  lastMood: string;
  doneUntil: number;
  toolKind: ToolKind | null;
  toolUntil: number;
  lastTool: string | null;
  replanAt: number;
  claim: string | null;
  needPlan: boolean;
  motion: Motion;
  pose: Pose;
  target: Pose;
  blinkNext: number;
  blinkUntil: number;
  face: Face | null;
  uvGen: number;
  lod: Lod;
  dist: number;
  /** karakterin ekrandaki yüksekliği (px) */
  px: number;
  /** ekran koordinatı (−1..1) */
  sx: number;
  sy: number;
  carry: Handoff | null;
  dim: boolean;
  /** S33: mola (kahve/kanepe); ACTIVITY-FEEL (B3): şehir mekânında yeme-içme (`meal`; bitince `joy` sevinci) */
  errand: { kind: "coffee" | "lounge" | "meal"; spot: Station; phase: "go" | "stay" | "joy"; until: number; meal?: MealSpot } | null;
  nextErrand: number;
  meet: Meet | null;
  /** etiket önbelleği: etkinlik fiili ve hazır bit eşlem yalnızca girdileri değişince yeniden hesaplanır */
  capWa: WorldAgent | null;
  capFlags: number;
  bmp: HTMLCanvasElement | null;
  bmpDim: boolean;
  /** şu anki aracın türü (regex her karede değil, araç değişince) */
  curKind: ToolKind | null;
  /** onay beklemeye başladığı an (en uzun bekleyen önce tam HUD alır) */
  waitSince: number;
  caption: string;
  conn: ConnKind | null;
  hidden: boolean;
  /** HOTEL-SYS (E1): otel geçidinden "görünmeyen odalara" girdi (çizilmez, bedeni fizikte yok); uyanınca kapıda belirir */
  inside?: boolean;
  /** S43: uyku yeri (uyku karosu ya da yedek dinlenme karosu; talep edilmiş) ve yeniden deneme anı */
  bed: Bed | null;
  bedRetry: number;
  /** S43: oturak türü, kucaktaki/eldeki cihaz ve hedef yükseklik (bank/şezlong/yatak üstü) */
  seat: Seat;
  device: HeldDevice | null;
  yGoal: number;
  /** S43: boşta kaldığı an ve uyuklamaya başlayacağı süre (ajana göre rastgele); uyuklama ritmi tohumu */
  idleSince: number;
  dozeAfter: number;
  seed: number;
  /** S48: eğlenceli hareket, sonraki deneme anı, çarpışma, zafer dansı bitişi, son görülen ruh hâli (eğlence beyni) */
  fun: Fun | null;
  nextFun: number;
  bump: Bump | null;
  victoryUntil: number;
  fmood: string;
  /** W3 (WALK-FUN): hediye gösterisi, tepki, ekip yemeği, masada bekleyen tüketimler, yürüme hız çarpanı (kozmetik) */
  gift: GiftAct | null;
  react: GiftReact | null;
  feast: Feast | null;
  deskQ: GiftKind[];
  walkScale: number;
  /** PHYS: fizik bedeni, art arda takılma sayısı ve yedek bekleme (bu ana dek plan yok, yerinde durur) */
  body: Body;
  stuckN: number;
  holdUntil: number;
  /** PHYS: kuyruk zaman aşımında nazik kaçış (yakındaki boş karo; süre dolunca gerçek hedef yeniden denenir) ve
   * bir süre kaçınılan hedef karosu (araç/mola noktası seçiminde atlanır)*/
  detour?: { tile: Tile; until: number; of: string } | null;
  avoid?: Map<string, number> | null;
  /** PHYS (yalnız geliştirme kancası `__voxcrewCrowd.goto`): ölçüm/ekran görüntüsü için zorunlu hedef */
  force?: { tile: Tile; until: number } | null;
}

interface Batch {
  id: BatchId;
  mesh: THREE.InstancedMesh;
  cap: number;
  dirty: boolean;
  /** yuva başına değişim işareti (DM matris, DC renk); `all`/`colAll` tam yükleme (yeniden kurulum, renk değişimi).*/
  marks: Uint8Array;
  all: boolean;
  colAll: boolean;
  uv?: THREE.InstancedBufferAttribute;
}

function makeMaterial(id: BatchId, atlas: TextureAtlas): THREE.Material {
  switch (id) {
    case "glow": return new THREE.MeshBasicMaterial({ toneMapped: false });
    case "a32": return new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.32, depthWrite: false });
    case "a45": return new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.45, depthWrite: false });
    case "a82": return new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.82 });
    case "a95": return new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.95 });
    case "tex": {
      // atlas: örnek başına UV kaydırma/ölçek (aUv = [u0, v0, su, sv])
      const m = new THREE.MeshBasicMaterial({ map: atlas.texture, transparent: true, alphaTest: 0.02, toneMapped: false });
      m.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nattribute vec4 aUv;")
          .replace("#include <uv_vertex>", "#include <uv_vertex>\n\tvMapUv = aUv.xy + uv * aUv.zw;");
      };
      m.customProgramCacheKey = () => "vc-atlas-uv";
      return m;
    }
    default: return new THREE.MeshLambertMaterial();
  }
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const WHITE = new THREE.Color("#FFFFFF");
const HIT_SPHERE = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 1e4);

export const CROWD_ORDER: Readonly<Record<BatchId, number>> = { solid: 0, glow: 0, tex: 1, a95: 2, a82: 2, a45: 3, a32: 3 };
/** Toplu örnek dizisi: kapasite yetmeyince daha büyük bir InstancedMesh kurulur. */
function makeBatch(id: BatchId, cap: number, atlas: TextureAtlas): Batch {
  const geo = id === "tex" ? new THREE.PlaneGeometry(1, 1) : unitBox;
  const mesh = new THREE.InstancedMesh(geo, makeMaterial(id, atlas), cap);
  mesh.frustumCulled = false;
  mesh.castShadow = id === "solid";
  mesh.receiveShadow = id === "solid" || id === "a82" || id === "a95";
  mesh.name = `crowd:${id}`;
  // WORLD-FIX: saydam geçişte sabit sıra (nesne merkezine göre sıralama kameranın açısıyla dönüyordu): önce yüz atlası, sonra
  // gözlük/vizör (0,82–0,95), sonra hayalet/kask kabarcığı (0,32–0,45); sahne camı en son (Blocks, derinlik yazmaz). Böylece
  // gözlüğün arkasındaki yüz ve camın arkasındaki karakter hiçbir açıda kaybolmaz.
  mesh.renderOrder = CROWD_ORDER[id];
  // renk tamponunu baştan oluştur (setColorAt ilk çağrıda yaratır; biz doğrudan diziye yazacağız)
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
  // boş yuvalar sıfır matris (görünmez): three birim matrisle başlatır → kullanılmayan yuva orijinde kutu olurdu
  mesh.instanceMatrix.array.fill(0);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const batch: Batch = { id, mesh, cap, dirty: true, marks: new Uint8Array(cap), all: true, colAll: true };
  if (id === "tex") {
    batch.uv = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    batch.uv.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aUv", batch.uv);
    mesh.renderOrder = 1;
  }
  return batch;
}

const boneM: Record<Bone, THREE.Matrix4> = Object.fromEntries(BONES.map((b) => [b, new THREE.Matrix4()])) as Record<Bone, THREE.Matrix4>;
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _c = new THREE.Color();
const _probe = new THREE.Vector3();
const PIVOT_V = Object.fromEntries(BONES.map((b) => [b, new THREE.Vector3(...BONE_PIVOT[b])])) as Record<Bone, THREE.Vector3>;
const ONE = new THREE.Vector3(1, 1, 1);
/** WALK-SCALE: karakter çizim ölçeği (walkRuntime.humanScale; kare başında okunur). Yalnız çizim, etiket ve tıklama kutusu;
 *  çözücü bedenleri (yarıçap) değişmez. Oturan karakter kalçası oturakta kalsın diye `seatLift` kadar kaldırılır. */
let HS = 1;
const _rp = new THREE.Vector3();
const SEATED: ReadonlySet<Motion> = new Set<Motion>(["sit", "sitType", "sitThink", "sitDoze", "slump", "lounge", "sleepLounge", "board", "spin"]);

const avatarSig = (wa: WorldAgent) => {
  const a = wa.agent.avatar ?? {};
  return `${Object.values(normalizeAvatar(a)).join("|")}|${wa.external?.accessory ?? ""}|${wa.external?.small ? "s" : "n"}`;
};

export function Crowd({ agents, plan, built, handoffs, talks, live, focusTeam = null, selected, hovered, onSelect, onHover, onFocusSet, labelCanvas, hudSlugs,
  signs = NO_SIGNS, kit = "", oceanY = null, rain = false, me = null }: CrowdProps) {
  const group = useRef<THREE.Group>(null);
  const hit = useRef<THREE.InstancedMesh>(null);
  const atlas = useMemo(() => new TextureAtlas(), []);
  useEffect(() => () => atlas.dispose(), [atlas]);
  const batches = useRef(new Map<BatchId, Batch>());
  const chars = useRef(new Map<string, Ch>());
  const order = useRef<Ch[]>([]);
  const claims = useMemo(() => new Set<string>(), [built]); // eslint-disable-line react-hooks/exhaustive-deps
  const { size } = useThree();
  const focusAt = useRef(0);
  const lastFocus = useRef("");
  const labelCache = useRef(new Map<string, HTMLCanvasElement>());
  const meets = useRef(new Map<string, Meet>());
  const meCh = useRef<Ch | null>(null);
  const meWa = useMemo<WorldAgent | null>(() => (me ? { agent: { slug: ME_SLUG, name: me.name, color: me.color, avatar: me.avatar }, mood: "idle", activity: "" } : null), [me]);
  const seenTalks = useRef(new Map<string, number>());
  const props = useRef({ agents, plan, built, talks, focusTeam, selected, hovered, onSelect, onHover, onFocusSet, hudSlugs, signs, kit, oceanY, rain });
  props.current = { agents, plan, built, talks, focusTeam, selected, hovered, onSelect, onHover, onFocusSet, hudSlugs, signs, kit, oceanY, rain };
  // S48: eğlence beyni (dünya başına) ve efekt dizisi (+1 çizim çağrısı; boşken gizli)
  const fw = useMemo(createFunWorld, []);
  const fxMesh = useMemo(makeFxMesh, []);
  useEffect(() => () => { fxMesh.geometry.dispose(); (fxMesh.material as THREE.Material).dispose(); fxMesh.dispose(); }, [fxMesh]);
  const funEnv = useRef<FunEnv | null>(null);
  // W3 (WALK-FUN): hediye/tepki/yemek durumu, kalabalık dizilerinde ayrılmış eşya yuvaları (+0 çağrı) ve yuva tabanları
  const gw = useMemo(createGiftWorld, []);
  const pp = useMemo(createPropPool, []);
  const propBase = useRef({ solid: -1, glow: -1 });
  const giftEnv = useRef<GiftEnv | null>(null);
  // PHYS: dünya başına fizik (statik çarpıştırıcılar + bedenler); sahne değişince yeniden kurulur (bedenler yeniden yerleşir)
  const phys = useRef<Physics>(null as unknown as Physics);
  phys.current ??= createPhysics(staticWorld(built));
  const meBody = useRef<Body>(createBody(-1, 0, 0, AVATAR_R, OFF));
  void handoffs; // S33: teslimler konuşma olaylarıyla (talks) gelir

  // ------------------------------------------------------------ kurulum / yeniden kurulum (ajan kümesi ya da görünüm değişince)
  const buildSig = agents.map((a) => `${a.agent.slug}:${avatarSig(a)}`).join("|") + `#${built.width}x${built.depth}` + (meWa ? `#me:${meWa.agent.name}:${avatarSig(meWa)}` : "");
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    const map = chars.current;
    const seen = new Set<string>();
    const list: Ch[] = [];
    agents.forEach((wa, index) => {
      const slug = wa.agent.slug;
      seen.add(slug);
      const sig = avatarSig(wa);
      let ch = map.get(slug);
      const p = plan[index];
      if (!ch) {
        ch = {
          slug, wa, index, sig, set: partSet(sig, wa), scale: wa.external?.small ? 0.62 : 1, slots: new Int32Array(0),
          pos: new THREE.Vector3(tx(p.spawn[0]), 0, tz(p.spawn[1])), facing: 0, path: [], goal: null, waitUntil: 0, lastMood: "",
          doneUntil: 0, toolKind: null, toolUntil: 0, lastTool: null, replanAt: 0, claim: null, needPlan: false, motion: "idle",
          pose: newPose(), target: newPose(), blinkNext: 2 + Math.random() * 3, blinkUntil: 0, face: null, uvGen: -1,
          lod: "off", dist: 0, px: 0, sx: 0, sy: 0, carry: null, dim: false, hidden: false,
          errand: null, nextErrand: 20 + Math.random() * 60, meet: null,
          bed: null, bedRetry: 0, seat: "chair", device: null, yGoal: 0, idleSince: 0, dozeAfter: DOZE_MIN + Math.random() * DOZE_SPAN, seed: (index * 0.6180339) % 1,
          fun: null, nextFun: 15 + Math.random() * 70, bump: null, victoryUntil: 0, fmood: wa.mood, gift: null, react: null, feast: null, deskQ: [], walkScale: 1, capWa: null, capFlags: -1, bmp: null, bmpDim: false, curKind: null, waitSince: 0, caption: "", conn: connKind(wa.agent.route, wa.external?.label),
          body: NO_BODY, stuckN: 0, holdUntil: 0,
        };
        ch.body = spawnBody(phys.current, ch, p.spawn);
        map.set(slug, ch);
        live.positions.set(slug, ch.pos);
      } else {
        ch.wa = wa; ch.index = index; ch.conn = connKind(wa.agent.route, wa.external?.label);
        if (ch.sig !== sig) { ch.sig = sig; ch.set = partSet(sig, wa); ch.scale = wa.external?.small ? 0.62 : 1; ch.face = null; }
      }
      list.push(ch);
    });
    for (const slug of [...map.keys()]) if (!seen.has(slug)) {
      const ch = map.get(slug)!;
      if (ch.claim) claims.delete(ch.claim);
      if (ch.bed) claims.delete(ch.bed.key);
      if (ch.meet) ch.meet.phase = "done";
      dropFunChar(fw, ch, claims);
      removeBody(phys.current, ch.body);
      map.delete(slug);
      live.positions.delete(slug); live.moods.delete(slug); live.teamOf.delete(slug); live.carry.delete(slug); live.near.delete(slug);
      live.talking.delete(slug); live.meeting.delete(slug);
    }
    order.current = list;
    // yuva tahsisi (toplu dizi başına sıralı)
    const need: Record<BatchId, number> = { solid: 0, glow: 0, a32: 0, a45: 0, a82: 0, a95: 0, tex: 0 };
    for (const ch of list) for (const b of ch.set.batch) need[b]++;
    // W2: "Ben" avatarı listenin sonunda kendi yuvalarını alır (aynı toplu diziler; çağrı sayısı değişmez)
    const mc = meWa ? (meCh.current = makeMeCh(meWa, meCh.current)) : (meCh.current = null);
    if (mc) for (const b of mc.set.batch) need[b]++;
    // W3: hediye eşyaları, masa süsleri, keyif rozeti ve mini oyun takımı için sabit yuvalar (aynı diziler; +0 çağrı)
    need.solid += PROP_SOLID; need.glow += PROP_GLOW;
    for (const id of BATCH_IDS) {
      let batch = batches.current.get(id);
      if (!batch || batch.cap < need[id]) {
        if (batch) { g.remove(batch.mesh); batch.mesh.dispose(); if (id === "tex") batch.mesh.geometry.dispose(); }
        batch = makeBatch(id, Math.max(32, Math.ceil(need[id] * 1.25) + 32), atlas);
        g.add(batch.mesh);
        batches.current.set(id, batch);
      } else {
        batch.mesh.instanceMatrix.array.fill(0);
        if (batch.uv) batch.uv.array.fill(0);
      }
      batch.mesh.count = batch.cap;
      batch.dirty = true; batch.all = true;
      if (batch.uv) batch.uv.needsUpdate = true;
    }
    const cursor: Record<BatchId, number> = { solid: 0, glow: 0, a32: 0, a45: 0, a82: 0, a95: 0, tex: 0 };
    for (const ch of list) {
      ch.slots = new Int32Array(ch.set.parts.length);
      ch.set.batch.forEach((b, i) => { ch.slots[i] = cursor[b]++; });
      ch.lod = "off"; ch.face = null; ch.uvGen = -1;
      live.teamOf.set(ch.slug, ch.wa.agent.team ?? null);
    }
    if (mc) {
      mc.slots = new Int32Array(mc.set.parts.length);
      mc.set.batch.forEach((b, i) => { mc.slots[i] = cursor[b]++; });
      mc.lod = "off"; mc.face = null; mc.uvGen = -1;
      applyColors([mc], batches.current, null, null, null);
    }
    propBase.current = { solid: cursor.solid, glow: cursor.glow };
    pp.prevS = PROP_SOLID; pp.prevG = PROP_GLOW; // yeni dizide eski içerik yok; ilk karede hepsi sıfırlanır
    live.count = list.length;
    live.version++;
    applyColors(list, batches.current, props.current.focusTeam, props.current.hovered, props.current.selected);
    const hb = hit.current;
    if (hb) { hb.count = list.length; hb.instanceMatrix.array.fill(0); hb.instanceMatrix.needsUpdate = true; }
  }, [buildSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // geliştirme: ekran görüntüsü/ölçüm betikleri için salt okunur inceleme kancası (S43; üretim derlemesinde yok)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voxcrewCrowd?: unknown };
    w.__voxcrewCrowd = {
      list: () => order.current.map((ch) => ({ slug: ch.slug, name: ch.wa.agent.name, mood: ch.wa.mood, motion: ch.motion, seat: ch.seat, device: ch.device,
        bed: ch.bed?.kind ?? null, fun: ch.fun ? `${ch.fun.kind}:${ch.fun.phase}` : null, bump: !!ch.bump, idle: +ch.idleSince.toFixed(1), dozeAfter: +ch.dozeAfter.toFixed(1), nextErrand: +ch.nextErrand.toFixed(1), x: +ch.pos.x.toFixed(2), y: +ch.pos.y.toFixed(2), z: +ch.pos.z.toFixed(2), walking: ch.path.length > 0, queued: ch.body.queued, held: ch.holdUntil > 0, stuckN: ch.stuckN,
        // PHYS (FIX-PHYS): beden yarıçapı/kipi, beyaz liste teması, kesintisiz kuyruk süresi ve sınırı, kaçışta mı
        r: +ch.body.r.toFixed(3), mode: ch.body.mode, contact: phys.current.t < ch.body.contactUntil, wait: ch.body.queued ? +ch.body.waitT.toFixed(2) : 0, qlim: +ch.body.queueLimit.toFixed(2), detour: !!ch.detour,
        goal: ch.goal, next: ch.path[0] ?? null, pl: ch.path.length, stuckT: +ch.body.stuckT.toFixed(2) })),
      // PHYS: çözücü sayaçları (adım, geri alma, en büyük batma) ve bedenlerin kip dağılımı
      goto: (slugs: string[], i: number, j: number, secs = 60) => {
        const until = performance.now() / 1000 + secs; let n = 0;
        // i < 0: ilk ajanın kahve noktası
        if (i < 0) { const c0 = chars.current.get(slugs[0]); const cf = c0 ? props.current.plan[c0.index]?.coffee : null; if (!cf) return 0; [i, j] = cf.tile; }
        for (const sl of slugs) { const ch = chars.current.get(sl); if (ch) { ch.force = { tile: [i, j], until }; ch.path = []; ch.goal = null; n++; } }
        return [n, i, j];
      },
      /** ACTIVITY-FEEL (B3): yemek molası — dünyanın yemek yerleri ve boştaki ajanı en yakın yere gönderme (canlı denetim) */
      meals: () => mealEnv.spots.map((m) => ({ tile: m.station.tile, ritual: m.ritual, held: m.held, eat: m.eat })),
      meal: (slug: string) => {
        const ch = chars.current.get(slug);
        const meal = ch ? pickMeal(ch, new Set()) : null;
        if (!ch || !meal) return null;
        ch.errand = { kind: "meal", spot: meal.station, phase: "go", until: 0, meal }; ch.path = []; ch.goal = null;
        return { tile: meal.station.tile, ritual: meal.ritual };
      },
      /** PHYS: ince yol ızgarası (1 = kapalı), satır satır — koridor arama betikleri için */
      grid: () => { const sw = phys.current.sw; return { width: sw.width, depth: sw.depth, closed: Array.from(sw.closed) }; },
      /** FIX-PHYS: karo türü (0 boş, 1 katı, 2 eşya, 3 oturak) ve çarpıştırıcı kutusu — takılma teşhisi */
      tile: (i: number, j: number) => { const sw = phys.current.sw, k = j * sw.width + i; return { kind: sw.kind[k], closed: sw.closed[k], box: Array.from(sw.box.slice(k * 4, k * 4 + 4)).map((v) => +v.toFixed(3)) }; },
      phys: () => { const ph = phys.current; const m = [0, 0, 0, 0]; for (const b of ph.bodies) m[b.mode]++; return { steps: ph.stats.steps, reverts: ph.stats.reverts, maxPen: +ph.stats.maxPen.toFixed(4), static: m[0], walk: m[1], kinematic: m[2], queued: ph.bodies.filter((b) => b.queued).length, props: ph.sw.props, seats: ph.sw.seats, repaired: ph.sw.repaired, shrunk: ph.sw.shrunk,
        // FIX-PHYS: kuyruk zaman aşımı sayısı, şu an sınırını (+ bir kare payı) aşmış kuyruktaki beden, en uzun kuyruk
        timeouts: ph.stats.timeouts, overdue: ph.bodies.filter((b) => b.queued && b.waitT > b.queueLimit + 0.25).length, maxWait: +Math.max(0, ...ph.bodies.map((b) => (b.queued ? b.waitT : 0))).toFixed(2) }; },
    };
    const w2 = window as unknown as { __voxcrewFun?: unknown };
    w2.__voxcrewFun = {
      start: (kind: FunKind, a: string, b?: string) => {
        const env = funEnv.current, ca = chars.current.get(a), cb = b ? chars.current.get(b) ?? null : null;
        return !!env && !!ca && forceFun(fw, env, kind, ca, cb);
      },
      sites: () => { const s = sites(props.current.built, props.current.oceanY); return { fishing: s.fishing.length, tables: s.tables.length, firstFish: s.fishing[0], firstTable: s.tables[0] }; },
      active: () => [...fw.funs].map((f) => ({ kind: f.kind, phase: f.phase, a: f.a.slug, b: f.b?.slug ?? null, spotA: f.spotA, spotB: f.spotB })),
      count: () => live.funCount,
      bump: (a: string, b: string) => {
        const env = funEnv.current, ca = chars.current.get(a), cb = chars.current.get(b);
        if (!env || !ca || !cb) return false;
        doBump(fw, env, ca, cb);
        return true;
      },
      bumps: () => ({ n: fw.bumps, last: fw.lastBump, walkers: fw.walkers, minGap: fw.minGap }),
      // W3 (WALK-FUN): hediye/tepki/yemek durumu ve mini oyun (salt inceleme + sözleşme çağrıları)
      gifts: () => order.current.filter((ch) => ch.gift || ch.react || ch.feast || ch.deskQ.length).map((ch) => ({ slug: ch.slug, gift: ch.gift ? `${ch.gift.kind}:${ch.gift.giver}:${ch.gift.busy ? "busy" : "idle"}` : null,
        react: ch.react?.motion ?? null, feast: ch.feast ? { spot: ch.feast.spot, arrived: ch.feast.arrived } : null, deskQ: [...ch.deskQ], motion: ch.motion, walkScale: ch.walkScale })),
      pep: () => Object.fromEntries(gw.pep),
      props: () => ({ solid: pp.prevS, glow: pp.prevG, base: propBase.current }),
      play: { gift: playGift, meal: playMeal, react: playReaction, self: playSelf, minigame: startMinigame },
      mg: () => ({ kind: mgActor.kind, agent: mgActor.agent, bite: mgActor.bite, turn: mgActor.turn, board: mgActor.board.join(""), table: mgActor.table, fish: mgActor.fish }),
    };
    return () => { delete w.__voxcrewCrowd; delete w2.__voxcrewFun; };
  }, []);

  // W3 (WALK-FUN): mini oyun yer çözümü (olta noktası, masa, rakip ajan); dünya sökülünce oyun kapanır
  useEffect(() => {
    mgBridge.resolve = (kind, spot) => resolveMinigame(kind, spot, props.current.built, props.current.oceanY, order.current);
    return () => { mgBridge.resolve = null; stopMinigame(); };
  }, []);

  // ekip filtresi / seçim değişince renkler
  useEffect(() => { applyColors(order.current, batches.current, focusTeam, hovered, selected); }, [focusTeam, hovered, selected]);

  // kaldırılınca toplu dizileri boşalt
  useEffect(() => () => {
    for (const b of batches.current.values()) { b.mesh.dispose(); if (b.id === "tex") b.mesh.geometry.dispose(); b.mesh.material instanceof THREE.Material && b.mesh.material.dispose(); }
    batches.current.clear();
  }, []);

  const hitCap = Math.max(16, Math.ceil(agents.length * 1.25) + 8);

  // ------------------------------------------------------------ kare döngüsü
  useFrame((state, rawDt) => {
    const P = props.current;
    const t0 = performance.now();
    const t = state.clock.elapsedTime;
    const dt = Math.min(rawDt, 0.05);
    HS = walkRuntime.humanScale;
    // (SP-QA-05): yürüyüş daha geniş sınırla ilerler; düşük kare hızında ağır çekime dönmez (fun/sleep.ts)
    const wdt = Math.min(rawDt, WALK_DT_MAX);
    const calm = reducedMotion();
    const cam = state.camera as THREE.PerspectiveCamera;
    const list = order.current;
    const bm = batches.current;
    const now = Date.now();
    let budget = PLAN_BUDGET;
    const pxPerUnit = size.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
    // 0) PHYS: sahne değiştiyse fizik dünyası yeniden (bedenler yerleşir; izinli ışınlanma), avatar bedeni, sabit adımlar
    let ph = phys.current;
    const sw = staticWorld(P.built);
    if (ph.sw !== sw) {
      ph = phys.current = createPhysics(sw);
      meBody.current.mode = OFF; // avatar bedeni aşağıda yeni dünyaya eklenir
      for (const ch of list) {
        const pl = P.plan[ch.index];
        const inside = staticPush(sw, ch.pos.x, ch.pos.z, ch.body.r).pen > 0.05;
        const at = inside && pl ? { x: tx(pl.spawn[0]), z: tz(pl.spawn[1]) } : ch.pos;
        const q = placeFree(ph, at.x, at.z, ch.body.r);
        ch.body.x = ch.body.px = ch.pos.x = q.x; ch.body.z = ch.body.pz = ch.pos.z = q.z;
        ch.body.mode = STATIC; ch.body.path = null; ch.path = []; ch.goal = null; ch.inside = false; // HOTEL-SYS: yeni dünyada kapıdan yeniden
        addBody(ph, ch.body);
      }
    }
    {
      const mb = meBody.current;
      if (walkRuntime.live && walkRuntime.visible) {
        const a = walkRuntime.avatar;
        if (mb.mode === OFF) { addBody(ph, mb); mb.mode = KINEMATIC; }
        mb.px = mb.x; mb.pz = mb.z;
        mb.vx = Math.sin(a.heading) * a.speed; mb.vz = Math.cos(a.heading) * a.speed;
        mb.x = a.x; mb.z = a.z;
      } else if (mb.mode !== OFF) { mb.mode = OFF; removeBody(ph, mb); }
    }
    const alpha = advance(ph, wdt);
    for (const ch of list) {
      const b = ch.body;
      ch.pos.x = b.px + (b.x - b.px) * alpha;
      ch.pos.z = b.pz + (b.z - b.pz) * alpha;
    }
    // 1) konuşmalar: yalnızca gerçek olaylardan (teslim/mesaj); iki ajan buluşur, karşılıklı konuşur, sonra döner
    stepMeets(P.talks, chars.current, meets.current, seenTalks.current, P.built, claims, live, t, now);
    // S48: eğlenceli hareketler + şakşak (ruh hâli geçişleri, yeni eğlence, çarpışma, eldeki nesneler ve efektler)
    const env = funEnv.current ??= { list, plans: P.plan, built: P.built, kit: P.kit, oceanY: P.oceanY, claims, t, dt, fx: live.fx, level: "on", calm, camX: 0, camZ: 0 };
    env.list = list; env.plans = P.plan; env.built = P.built; env.kit = P.kit; env.oceanY = P.oceanY; env.claims = claims; env.t = t; env.dt = dt;
    env.fx = live.fx; env.level = useFunMoments.getState().level; env.calm = calm; env.camX = cam.position.x; env.camZ = cam.position.z; env.rain = P.rain; env.clock = state.clock.elapsedTime;
    live.fx.calm = calm;
    live.funCount = stepFun(fw, env);
    // ACTIVITY-FEEL (B3): şehir mekânında yemek molası — dünyanın yemek yerleri ve aynı anki tavan (iş boşalmasın)
    mealEnv.spots = P.kit ? mealSpots(P.built, P.kit) : NO_MEALS;
    mealEnv.cap = mealCap(list.length);
    mealEnv.now = 0;
    for (const c of list) if (c.errand?.kind === "meal") mealEnv.now++;

    for (const ch of list) {
      // güncel durum (ruh hâli/araç): kurulum etkisi yalnızca küme değişince çalışır, veri her karede eşitlenir
      const fresh = P.agents[ch.index];
      if (fresh && fresh !== ch.wa && fresh.agent.slug === ch.slug) ch.wa = fresh;
      const { mood, tool } = ch.wa;
      const p = P.plan[ch.index];
      if (!p) continue;
      // 2) hareket
      budget = stepChar(ch, p, P.built, t, dt, ph, calm, budget, claims);
      live.moods.set(ch.slug, mood);
      // 3) LOD: ekran konumu ve piksel yüksekliği
      _probe.set(ch.pos.x, 0.8 * ch.scale * HS, ch.pos.z);
      ch.dist = cam.position.distanceTo(_probe);
      _probe.project(cam);
      ch.sx = _probe.x; ch.sy = _probe.y;
      const heightPx = (1.6 * ch.scale * HS * pxPerUnit) / Math.max(0.1, ch.dist);
      ch.px = heightPx;
      const nextLod: Lod = ch.inside || Math.abs(_probe.x) > 1.15 || Math.abs(_probe.y) > 1.3 || _probe.z > 1 ? "off" : heightPx < FAR_PX ? "far" : "near";
      if (nextLod !== ch.lod) {
        if (nextLod === "off") zeroChar(ch, bm);
        else if (nextLod === "far" && ch.lod === "near") zeroDetail(ch, bm);
        ch.lod = nextLod;
        if (nextLod === "near") live.near.add(ch.slug); else live.near.delete(ch.slug);
      }
      if (ch.lod === "off") { void tool; continue; }
      // 4) animasyon
      POSE_OPTS.seat = ch.seat; POSE_OPTS.seed = ch.seed; POSE_OPTS.phase = ch.fun ? funPhase(ch, t) : 0; // S43: kare başına nesne üretmeden
      // W3: mini oyun rakibi (sırası gelince taş sürer) ve çak bir beşlik tepkisinin evresi
      if (mgActor.agent === ch.slug) POSE_OPTS.phase = mgActor.turn === 2 ? 0.25 : 0.75;
      else if (ch.react && ch.motion === "highfive") POSE_OPTS.phase = Math.min(0.99, (t - ch.react.t0) / Math.max(0.1, ch.react.until - ch.react.t0));
      if (ch.bump) bumpFx(ch, t, live.fx);
      poseTargets(ch.motion, t + ch.index * 1.7, calm, ch.target, POSE_OPTS);
      // ACTIVITY-CAM: mekânda içen ajan bardağı ağza kaldırıp eğer (yemekte ısırık kolu aynen)
      if (ch.errand?.kind === "meal" && ch.errand.phase === "stay" && ch.errand.meal && !ch.errand.meal.eat && ch.motion === "sitEat") sipArms(ch.target, t + ch.index * 1.7, calm, ch.seed);
      // W3: çalışan ajan yalnızca başını kaldırıp ≤ 1 sn el sallar (oturuşu ve işi bozulmaz; hareket azaltmada el kalkık durur)
      if (glancing(ch, t)) { ch.target.hx = -0.22; ch.target.raz = 2.3 + (calm ? 0 : Math.sin(t * 9) * 0.3); ch.target.ra = Math.min(ch.target.ra, -0.2); }
      lerpPose(ch.pose, ch.target, Math.min(1, dt * 10));
      writeChar(ch, bm);
      // 5) yüz / göz kırpma
      const base = MOOD_FACE[mood];
      let face: Face = base;
      // ACTIVITY-FEEL (B3): yemek molası bitti — mutlu yüz. ACTIVITY-CAM: yerken çiğneme, içerken yudum, sonda ^ ^ keyif yüzü
      if (ch.errand?.kind === "meal" && ch.errand.phase === "joy") face = stageFace("happy", t, calm);
      else if (ch.errand?.kind === "meal" && ch.errand.phase === "stay" && ch.errand.meal && ch.motion === "sitEat") face = stageFace(ch.errand.meal.eat ? "eat" : "sip", t + ch.index * 1.7, calm, ch.seed);
      // S43: uyuyan ve uyuklayanın gözleri kapalı
      if (EYES_SHUT.has(ch.motion)) face = ch.motion === "doze" || ch.motion === "sitDoze" ? "blink" : "sleep";
      const canBlink = base === "smile" || base === "focus" || base === "curious" || base === "think";
      if (canBlink && ch.lod === "near" && face === base) {
        const tt = t + ch.index * 0.37;
        if (tt > ch.blinkNext) { ch.blinkUntil = tt + 0.13; ch.blinkNext = tt + 2.2 + Math.random() * 3.5; }
        if (ch.blinkUntil && tt < ch.blinkUntil) face = "blink"; else ch.blinkUntil = 0;
      }
      if (face !== ch.face || ch.uvGen !== atlas.generation) writeFaces(ch, face, bm, atlas);
    }
    stepMe(meCh.current, bm, atlas, t, dt, calm, cam, gw);
    // W3 (WALK-FUN): hediye koreografisi, ekip yemeği, masa süsleri, keyif rozeti, mini oyun takımı → ayrılmış yuvalar (+0 çağrı)
    {
      const walk = walkRuntime.live;
      const focus = !!useGame.getState().profile?.focus;
      const mc = meCh.current;
      const meOn = walk && !!mc && mc.lod !== "off";
      const ge = giftEnv.current ??= { list, bySlug: chars.current, plans: P.plan, built: P.built, oceanY: P.oceanY, t, now, calm, pp, claims, me: null, walk, focus };
      ge.list = list; ge.bySlug = chars.current; ge.plans = P.plan; ge.built = P.built; ge.oceanY = P.oceanY; ge.t = t; ge.now = now; ge.calm = calm; ge.claims = claims; ge.walk = walk; ge.focus = focus;
      ge.me = meOn && mc ? { x: walkRuntime.avatar.x, z: walkRuntime.avatar.z, hand: handOf(mc) } : null;
      stepGifts(gw, ge);
      // gösteri, yemek ya da mini oyun başlayınca süren eğlence biter (talepler bırakılır)
      for (const c of list) if (c.fun && (c.feast || (c.gift && !c.gift.busy) || mgActor.agent === c.slug)) endFun(fw, c.fun, t, claims, env.level);
      drawMoods(list, P.plan, P.built, gw, pp, t, now, calm, walk, focus);
      // ACTIVITY-FEEL (B3): mekânda yiyen ajanın elinde ritüelin eşyası (yakın LOD; sevinçte eşya bitmiş)
      for (const c of list) {
        const e = c.errand;
        if (e?.kind !== "meal" || e.phase !== "stay" || !e.meal || c.lod !== "near" || c.motion !== "sitEat") continue;
        const h = handOf(c); drawHeld(pp, e.meal.held, h.x, h.y, h.z, c.facing, e.meal.eat ? 0 : -sipTiltAt(t + c.index * 1.7, calm, c.seed));
      }
      if (meOn && mc) {
        drawMinigame(pp, mc, t, calm, live.fx);
        // elde fincan (kendine kahve)
        if (performance.now() < walkRuntime.sip) { const h = handOf(mc); drawItem(pp, "cup", h.x, h.y - 0.03, h.z, mc.facing); }
        // şehir ritüelinde elde nesne (ritualFx.held; fincan yolu önceliklidir) ve atma ritüelinde uçan parça (fx kutusu)
        else if (ritualFx.held) { const h = handOf(mc); drawHeld(pp, ritualFx.held, h.x, h.y, h.z, mc.facing, meAct.tilt, meAct.amount); }
        ritualToss(live.fx, mc, calm);
        // ACTIVITY-FEEL (B6): şehir rehberinin yol işareti (hedef sütunu + yol noktaları)
        if (walk) drawWaypoint(pp, P.built, useWalkStore.getState().world, t, calm);
        if (walk) {
          ensureMoods();
          for (const c of list) if (c.lod === "near" && Math.hypot(c.pos.x - walkRuntime.avatar.x, c.pos.z - walkRuntime.avatar.z) < 6) ensureDesk(gw, c.slug, now);
        }
      } else if (mgActor.kind && !walk) stopMinigame();
      ritualBurstFx(live.fx, meOn ? mc : null);
      if (meOn && mc) activityHeart(live.fx, mc);
      // yalnız ayrılmış prop yuvaları (yazım öncesi sayılar; writePropPool sıfırlar) işaretlenir
      const nS = Math.min(PROP_SOLID, pp.ns), mS = Math.min(PROP_SOLID, Math.max(pp.ns, pp.prevS)), nG = Math.min(PROP_GLOW, pp.ng), mG = Math.min(PROP_GLOW, Math.max(pp.ng, pp.prevG));
      const [ds, dg] = writePropPool(pp, bm.get("solid")?.mesh, bm.get("glow")?.mesh, propBase.current.solid, propBase.current.glow);
      if (ds) markProps(bm.get("solid")!, propBase.current.solid, mS, nS);
      if (dg) markProps(bm.get("glow")!, propBase.current.glow, mG, nG);
    }
    atlas.flush();
    // kapasitenin tamamı yerine yalnız değişen yuva aralıkları GPU'ya (işaret yoksa yükleme yok)
    for (const b of bm.values()) {
      if (!b.dirty && !b.colAll) continue;
      if (b.dirty) flushMarks(b.mesh.instanceMatrix, 16, b.marks, DM, b.all);
      const ic = b.mesh.instanceColor;
      if (ic) { if (b.colAll) { ic.clearUpdateRanges(); ic.needsUpdate = true; resetShadow(ic); } else flushMarks(ic, 3, b.marks, DC, false); }
      b.marks.fill(0); b.dirty = false; b.all = false; b.colAll = false;
    }
    stepFx(live.fx, fxMesh, dt);

    // 6) hit-box: örnekler hareket ettiği için sınır küresi sabit ve çok büyük (three her kareyi yeniden hesaplamaz)
    const hb = hit.current;
    if (hb) {
      if (hb.boundingSphere !== HIT_SPHERE) hb.boundingSphere = HIT_SPHERE;
      hb.count = list.length;
      list.forEach((ch, i) => {
        if (ch.lod === "off") { hb.instanceMatrix.array.fill(0, i * 16, i * 16 + 16); return; }
        const hs = ch.scale * HS;
        _m.compose(_v.set(ch.pos.x, 0.85 * hs, ch.pos.z), _q.identity(), _s.set(0.9 * hs, 1.7 * hs, 0.9 * hs));
        hb.instanceMatrix.array.set(_m.elements, i * 16);
      });
      hb.instanceMatrix.needsUpdate = true;
    }

    // 7) kamera bilgisi (mini harita)
    live.camPos.x = cam.position.x; live.camPos.y = cam.position.y; live.camPos.z = cam.position.z;

    // 8) HUD odak kümesi (4 Hz)
    if (t - focusAt.current > 0.25) {
      focusAt.current = t;
      const slugs = focusSet(list, P.selected, P.hovered, useLabelMode.getState().mode);
      const sig = slugs.join("|");
      if (sig !== lastFocus.current) { lastFocus.current = sig; P.onFocusSet(slugs); }
    }

    // 9) hafif ad etiketleri (HUD'u olmayan yakın karakterler)
    // UXF-D: yürürken duvarın/çatının ardındaki ajanın etiketi ve rozeti çizilmez (örtü ızgarasında ucuz ışın)
    let hide: ((ch: Ch) => boolean) | null = null;
    if (walkRuntime.live) {
      const cover = coverGrid(P.built), av = walkRuntime.avatar, cp = cam.position;
      const avDist = Math.hypot(av.x - cp.x, walkRuntime.drawY + LOOK_Y - cp.y, av.z - cp.z);
      const roofs = !useWalkStore.getState().cover.indoor; // çatı altında çatı kesiti açık: çatı engel değil
      // karakter başına kare başına bir kez (aday ve rozet geçişleri aynı sonucu iki kez ışın izliyordu)
      HIDE_MEMO.clear();
      hide = (ch) => {
        let v = HIDE_MEMO.get(ch);
        if (v === undefined) { v = labelOccluded(cover, cp, avDist, ch.pos.x, ch.pos.y + 1.15 * ch.scale * HS, ch.pos.z, roofs); HIDE_MEMO.set(ch, v); } // etiket çapası (head())
        return v;
      };
    }
    drawLabels(labelCanvas.current, list, P.hudSlugs, size.width, size.height, cam.fov, labelCache.current, P.focusTeam, live, chars.current,
      useLabelMode.getState().mode, P.signs, cam, hide);
    drawMeLabel(labelCanvas.current, meCh.current, size.width, size.height, cam, labelCache.current);
    // ölçüm: kalabalık döngüsünün CPU süresi (hareket + animasyon + etiketler); PerfProbe okur
    live.crowdMs = live.crowdMs * 0.9 + (performance.now() - t0) * 0.1;
  });

  // ------------------------------------------------------------ seçim / üstüne gelme (görünmez hit-box)
  const chAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId != null ? order.current[e.instanceId] : undefined);
  const over = (e: ThreeEvent<PointerEvent>) => {
    const ch = chAt(e);
    if (!ch || ch.lod === "off") return;
    e.stopPropagation();
    document.body.style.cursor = "pointer";
    if (e.pointerType !== "touch") props.current.onHover?.(ch.slug, { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
  };
  const out = (e: ThreeEvent<PointerEvent>) => {
    document.body.style.cursor = "";
    if (e.pointerType !== "touch") props.current.onHover?.(null);
  };
  const click = (e: ThreeEvent<MouseEvent>) => {
    const ch = chAt(e);
    if (!ch || ch.lod === "off") return;
    e.stopPropagation();
    props.current.onSelect(ch.slug);
  };

  return (
    <>
      <group ref={group} />
      <primitive object={fxMesh} />
      <instancedMesh key={hitCap} ref={hit} args={[unitBox, undefined, hitCap]} visible={false} name="crowd:hit"
        onClick={click} onPointerOver={over} onPointerOut={out} onPointerMove={over}>
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </instancedMesh>
    </>
  );
}

// ------------------------------------------------------------------ W2: "Ben" avatarı (walkRuntime ile sürülür)
const ME_SLUG = "__me";
/** W3: avatarın elindeki parşömen (parts.ts `carry` parçaları yalnızca `ch.carry` doluyken görünür) */
const ME_CARRY: Handoff = { id: 0, from: ME_SLUG, to: "", ts: 0 } as Handoff;
let meSitAt: { ref: object; x: number; z: number } | null = null;
const _hand = { x: 0, y: 0, z: 0 };
const handOf = (ch: Ch) => { const h = handPos(ch, true); _hand.x = h.x; _hand.y = h.y; _hand.z = h.z; return _hand; };
/** W3: çalışan ajanın ≤ 1 sn bakıp el sallaması (hediye masaya bırakılırken ya da tepki) */
function glancing(ch: Ch, t: number): boolean {
  const m = ch.wa.mood;
  if (m !== "working" && m !== "thinking") return false;
  return giftMotion(ch, t, null)?.motion === "glance";
}

// ------------------------------------------------------------------ şehir ritüeli (ritualFx; React dışı, yalnız okunur)
/** Atma döngüsü (ms): geri kalkış → bırakış → dinlenme; olta atışıyla aynı evre eşlemesi. */
const RIT_TOSS_MS = 1600;
let ritKey: string | null = null, ritMo: string | null = null, ritAt = 0, ritBurstSeq = 0;
/** Ritüel hareketinin döngü içi konumu 0–1 (hareket ya da ritüel değişince sıfırdan). */
function ritualK(now: number): number {
  if (ritualFx.active !== ritKey || ritualFx.motion !== ritMo) { ritKey = ritualFx.active; ritMo = ritualFx.motion; ritAt = now; }
  return ((now - ritAt) % RIT_TOSS_MS) / RIT_TOSS_MS;
}
/** Duruş evresi: `toss` olta atışının eşlemesi (geri kalkış 0,8–1 → bırakış 0–0,18); diğerleri zamanla oynar (evre 0). */
const ritualPhase = (k: number) => (ritualFx.motion !== "toss" ? 0 : k < 0.35 ? 0.8 + (k / 0.35) * 0.2 : Math.min(0.18, ((k - 0.35) / 0.65) * 0.18));
const _ritPose = newPose();
/** ACTIVITY-FEEL (B3): oynatılan ritüel hareketi — yeme anında `sip` yerine yemek (ısırık döngüsü). */
const ritualMotionNow = (): Motion | null => (ritualFx.motion === "sip" && ritualFeel.eat ? "eat" : ritualFx.motion);
/** Oturarak hareket (yudum, el sallama, okuma…): aynı hareketin ayakta duruşundan yalnız kollar ve baş alınır (bacaklar oturuşta
 *  kalır; sol kol yalnız iki elli okuma/yazmada). Durağan tutuş (hareket azaltma ya da yerleşme evresi): sağ kol önde. */
function ritualArms(ch: Ch, t: number, calm: boolean) {
  const o = ch.target, m = ritualMotionNow();
  if (ch.motion === "sit" && m) {
    const p = poseTargets(m, t, calm, _ritPose, POSE_OPTS);
    o.ra = p.ra; o.raz = p.raz; o.hx = p.hx; o.hy = p.hy; o.hz = p.hz;
    if (m === "read" || m === "type") { o.la = p.la; o.laz = p.laz; }
  } else if ((ch.motion === "sit" || ch.motion === "idle") && !m && ritualFx.held) { o.ra = -1.0; o.raz = 0.12; }
}
/** Atma ritüelinde elden öne uçan küçük parça(lar): `updateFeed` yayı (fx anlık kutusu; hareket azaltmada ve kahve yudumunda yok).
 *  Elde nesne yoksa avuçtan tane yem. */
function ritualToss(fx: FxState, mc: Ch, calm: boolean) {
  if (calm || ritualFx.motion !== "toss" || performance.now() < walkRuntime.sip) return;
  const b = tossBits(ritualFx.held);
  const k = ritualK(performance.now());
  if (!b || k < 0.35 || k > 0.8) return;
  const v = (k - 0.35) / 0.45, h = handOf(mc);
  const fx0 = Math.sin(mc.facing), fz0 = Math.cos(mc.facing), d = 1.6 * HS;
  const ex = mc.pos.x + fx0 * d, ez = mc.pos.z + fz0 * d, ey = ritualFx.lure?.mode === "catch" ? h.y + 0.3 : mc.pos.y + 0.05;
  for (let i = 0; i < b.n; i++) {
    const u = Math.min(1, v * (1 + i * 0.12)), o = (i - (b.n - 1) / 2) * 0.12;
    fxBox(fx, h.x + (ex + fz0 * o - h.x) * u, h.y + (ey - h.y) * u + Math.sin(Math.PI * u) * 0.5, h.z + (ez - fx0 * o - h.z) * u,
      b.size, b.size * 0.8, b.size, i + k * 6, 0, 0, b.col);
  }
}
/** Ritüel patlaması `seq` ile bir kez fx havuzuna (hareket azaltmada `burst` zaten boş); elde içecek varsa buhar elden çıkar. */
function ritualBurstFx(fx: FxState, mc: Ch | null) {
  const b = ritualFx.burst;
  if (!b || b.seq === ritBurstSeq) return;
  ritBurstSeq = b.seq;
  if (b.kind === "steam" && mc && ritualFx.held) { const h = handOf(mc); fxBurst(fx, "steam", h.x, h.y + 0.25, h.z); }
  else fxBurst(fx, b.kind, b.x, b.y, b.z);
}

/** ACTIVITY-CAM: avatarın elindeki nesnenin eğimi/kalan payı (stepMe yazar, çizim okur) ve içecek keyfinde bir kez kalp. */
const meAct = { tilt: 0, amount: 1, heart: false, heartT0: -1 };
function activityHeart(fx: FxState, mc: Ch) {
  if (!meAct.heart) return;
  meAct.heart = false;
  fxBurst(fx, "hearts", mc.pos.x, mc.pos.y + 1.6 * HS, mc.pos.z);
}

/** Avatar karakter kaydı: ajanlarınkiyle aynı biçim (writeChar / writeFaces / applyColors); hareket walkRuntime'dan. */
function makeMeCh(wa: WorldAgent, prev: Ch | null): Ch {
  // W5: yaka kartı (parts.ts `badge`) yalnızca avatarda; parça önbelleği ajanlarınkiyle karışmasın diye ayrı imza
  const sig = `${avatarSig(wa)}|me`;
  if (prev && prev.sig === sig) { prev.wa = wa; return prev; }
  return {
    slug: ME_SLUG, wa, index: -1, sig, set: partSet(sig, wa, true), scale: 1, slots: new Int32Array(0),
    pos: new THREE.Vector3(), facing: 0, path: [], goal: null, waitUntil: 0, lastMood: "", doneUntil: 0, toolKind: null, toolUntil: 0,
    lastTool: null, replanAt: 0, claim: null, needPlan: false, motion: "idle", pose: newPose(), target: newPose(), blinkNext: 3, blinkUntil: 0,
    face: null, uvGen: -1, lod: "off", dist: 0, px: 0, sx: 0, sy: 0, carry: null, dim: false, hidden: false, errand: null, nextErrand: 0, meet: null,
    bed: null, bedRetry: 0, seat: "chair", device: null, yGoal: 0, idleSince: 0, dozeAfter: 1e9, seed: 0, fun: null, nextFun: 1e9, bump: null,
    victoryUntil: 0, fmood: "idle", gift: null, react: null, feast: null, deskQ: [], walkScale: 1, capWa: null, capFlags: -1, bmp: null, bmpDim: false, curKind: null, waitSince: 0, caption: "", conn: null,
    body: NO_BODY, stuckN: 0, holdUntil: 0,
  } as Ch;
}

/** Kare başı: walkRuntime açık ve görünürken avatar örneğini yazar; değilse (çıkış, birinci şahıs) örnekleri sıfırlar. Yürüme
 *  salınımı adım hızına bağlı fazla; hareket azaltmada duruş pozu (salınım yok). */
function stepMe(ch: Ch | null, bm: Map<BatchId, Batch>, atlas: TextureAtlas, t: number, dt: number, calm: boolean, cam: THREE.PerspectiveCamera, gw: ReturnType<typeof createGiftWorld>) {
  if (!ch) return;
  if (!(walkRuntime.live && walkRuntime.visible)) {
    if (ch.lod !== "off") { zeroChar(ch, bm); ch.lod = "off"; }
    return;
  }
  const a = walkRuntime.avatar;
  ch.pos.set(a.x, 0, a.z);
  ch.facing = a.heading;
  const moving = a.speed > 0.15;
  ch.motion = moving && !calm ? "walk" : "idle";
  // adım fazı hızla ilerler (koşarken daha sık); durunca faz sabit
  if (moving) ch.yGoal = (ch.yGoal + dt * Math.max(0.6, a.speed / 2.6)) % 1000;
  // W3 (WALK-FUN): taşınan parşömen, oturma, kendine kahve, mini oyun duruşu, hediye uzatma / çak bir beşlik
  ch.carry = walkRuntime.carry ? ME_CARRY : null;
  ch.seat = "chair";
  let phase = 0, y = 0;
  const sit = walkRuntime.sit;
  if (sit) {
    // kalkış: avatar oturma anındaki yerinden 0,3 birimden fazla uzaklaşınca (yürüme girdisi) oturuş biter
    if (!meSitAt || meSitAt.ref !== sit) meSitAt = { ref: sit, x: a.x, z: a.z };
    if (Math.hypot(a.x - meSitAt.x, a.z - meSitAt.z) > 0.3) { walkRuntime.sit = null; meSitAt = null; }
    else {
      ch.pos.set(sit.x, 0, sit.z); ch.facing = sit.heading;
      ch.seat = sit.pose === "sit_bench" ? "bench" : sit.pose === "sit_ground" ? "ground" : "lounge";
      ch.motion = "sit";
      y = ch.seat === "ground" ? (sit.y ?? GROUND_Y) - SEAT_OFF : ch.seat === "lounge" ? (sit.y ?? 0.35) - SEAT_OFF : sit.y !== undefined ? Math.max(0, sit.y - SEAT_OFF) : 0;
    }
  } else meSitAt = null;
  const mg = mgActor;
  if (mg.kind && !moving && !walkRuntime.sit) {
    if (mg.kind === "fishing" && mg.fish) {
      ch.pos.set(tx(mg.fish.tile[0]), 0, tz(mg.fish.tile[1])); ch.facing = mg.fish.face;
      // WORLD-FIX: atışta olta savruluşu (atma pozu: geri kalkış → öne bırakış), çekişte ve yakalamada çekiş pozu
      ch.motion = mg.meMotion === "reel" ? "reel" : mg.meMotion === "cast" && !calm ? "toss" : "fish";
      if (ch.motion === "toss") { const k = Math.min(1, (performance.now() - mg.fpAt) / CAST_MS); phase = k < 0.35 ? 0.8 + (k / 0.35) * 0.2 : Math.min(0.18, ((k - 0.35) / 0.65) * 0.18); }
    }
    else if (mg.table) {
      ch.pos.set(tx(mg.table.a[0]), 0, tz(mg.table.a[1])); ch.facing = mg.table.faceA;
      if (mg.kind === "board") { ch.motion = "board"; y = (mg.table.ya ?? BOARD_STOOL_Y) - SEAT_OFF; phase = mg.turn === 1 ? 0.25 : 0.75; }
      else { ch.motion = mg.meMotion === "toss" || mg.meMotion === "bowl" ? (mg.table.game === "hoop" || mg.table.game === "volley" ? "toss" : "bowl") : "idle"; phase = mg.throwAt ? Math.min(0.99, (performance.now() - mg.throwAt) / 900) * 0.5 : 0; }
    }
  } else if (!moving && !walkRuntime.sit && performance.now() < walkRuntime.sip) ch.motion = "sip";
  // şehir ritüeli hareketi (ritualFx.motion; var olan duruşlar). Kahve yudumu ve mini oyun öncelikli; hareket azaltmada
  // motion null → durağan tutuş (aşağıda `ritualArms`).
  const rit = !moving && !mg.kind && ritualFx.active !== null && !(performance.now() < walkRuntime.sip);
  if (rit && !walkRuntime.sit && ritualFx.motion) { ch.motion = ritualMotionNow()!; phase = ritualPhase(ritualK(performance.now())); }
  const g = meGesture(gw, t);
  if (g && !moving && !walkRuntime.sit && !mg.kind) { ch.motion = g.motion; phase = g.phase; if (g.face !== null) ch.facing = g.face; }
  // W5: emote (el salla, dans, sevinç, gül, düşün; oturma yukarıdaki oturuş yolunda). Hareket azaltmada durağan duruş (zaman donar)
  let happy = false, frozen = false;
  const em = !moving && !mg.kind && !g ? emoteMotion(performance.now()) : null;
  if (em && !walkRuntime.sit) { ch.motion = em.motion; happy = em.happy; frozen = calm; phase = Math.min(0.99, (em.elapsed % 1.2) / 1.2); }
  // WALK-PHYS: ayak yüksekliği (basamak, zıplama, tırmanılan engelin üstü); oturuş ve mini oyun kendi yüksekliğini verir
  ch.pos.y = y + (walkRuntime.sit || (mg.kind && !moving) ? 0 : walkRuntime.drawY);
  ch.dist = cam.position.distanceTo(_probe.set(a.x, 0.8 + walkRuntime.drawY, a.z)); // etiket avatarın gerçek yüksekliğinde (teleferik kabininde yerde kalıyordu)
  _probe.project(cam);
  ch.sx = _probe.x; ch.sy = _probe.y;
  ch.lod = "near";
  POSE_OPTS.seat = ch.seat; POSE_OPTS.seed = 0; POSE_OPTS.phase = phase;
  poseTargets(ch.motion, moving ? ch.yGoal : frozen ? 0.35 : t, calm, ch.target, POSE_OPTS);
  if (rit) ritualArms(ch, t, calm);
  // ACTIVITY-CAM: etkinlik ifadesi ve görünür keyif — içerken bardak ağza kalkıp eğilir, sonda omuz/baş "ohh" ve kalp; yerken
  // yiyecek ısırıkla küçülür; yüz: çiğneme / yudum / ^ ^ (bitişten sonra da kısa süre, yürümedikçe)
  const nowMs = ritualRuntimeOpts.now(); // ritüel saati (ritualFeel.t0/doneAt ile aynı)
  const stage: ExprStage = em || g || mg.kind ? "none" : feelStage(ritualFeel, rit, nowMs, moving);
  meAct.tilt = 0; meAct.amount = 1;
  if (rit && ritualFeel.drink && stage === "sip") meAct.tilt = -sipArms(ch.target, t, calm);
  else if (rit && ritualFeel.drink && stage === "happy") {
    const k = (nowMs - ritualFeel.t0 - (ritualFeel.totalMs - savorMs(ritualFeel.totalMs - ritualFeel.settleMs))) / 1000;
    savorPose(ch.target, Math.max(0, k), calm);
    if (meAct.heartT0 !== ritualFeel.t0) { meAct.heartT0 = ritualFeel.t0; meAct.heart = !calm; }
  }
  if (rit && ritualFeel.eat) meAct.amount = biteLeft((nowMs - ritualFeel.t0 - ritualFeel.settleMs) / Math.max(1, ritualFeel.totalMs - ritualFeel.settleMs));
  lerpPose(ch.pose, ch.target, calm && (em || rit) ? 1 : Math.min(1, dt * 12));
  writeChar(ch, bm);
  const face = happy ? MOOD_FACE.done : stage !== "none" ? stageFace(stage, t, calm) : ritualFeel.joy ? MOOD_FACE.done : MOOD_FACE.idle;
  if (face !== ch.face || ch.uvGen !== atlas.generation) writeFaces(ch, face, bm, atlas);
}

/** "Ben" ad etiketi: avatarın başının üstünde, yalnızca kamera yakınken; ayırt edici turuncu çerçeve. */
function drawMeLabel(canvas: HTMLCanvasElement | null, ch: Ch | null, w: number, h: number, cam: THREE.PerspectiveCamera, cache: Map<string, HTMLCanvasElement>) {
  walkRuntime.meLabel = null;
  if (!canvas || !ch || ch.lod === "off" || ch.dist > ME_LABEL_DIST || Math.abs(ch.sx) > 1.1 || Math.abs(ch.sy) > 1.1) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const k = 20 / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
  const img = labelBitmap(cache, ch.wa.agent.name, ch.wa.agent.color, "idle", false, "", null);
  const sc = Math.min(1.2, Math.max(0.7, k / Math.max(1, ch.dist)));
  const bw = (img.width / dpr) * sc, bh = (img.height / dpr) * sc;
  // baş üstü noktası doğrudan izdüşürülür (yakın, yukarıdan bakan takip kamerasında piksel ölçeği yaklaşımı sapar)
  _probe.set(ch.pos.x, ch.pos.y + 2.1 * HS, ch.pos.z).project(cam); // avatarın gerçek Y'si (tepe, teleferik kabini)
  if (_probe.z > 1) return;
  const x = ((_probe.x + 1) / 2) * w, y = (1 - (_probe.y + 1) / 2) * h - 4;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.drawImage(img, x - bw / 2, y - bh, bw, bh);
  walkRuntime.meLabel = [x - bw / 2, y - bh, x + bw / 2, y];
}

// ------------------------------------------------------------------ örnek yazımı
const ZERO16 = new Float32Array(16);
/** yuvayı sıfırla (değiştiyse işaretle).*/
function markZero(b: Batch, slot: number) {
  if (put16(b.mesh.instanceMatrix.array as Float32Array, slot * 16, ZERO16)) { b.marks[slot] |= DM; b.dirty = true; }
}
/** ayrılmış prop yuvaları: matris [base, base+m), renk [base, base+n) işaretli.*/
function markProps(b: Batch, base: number, m: number, n: number) {
  for (let i = 0; i < m; i++) b.marks[base + i] |= DM;
  for (let i = 0; i < n; i++) b.marks[base + i] |= DC;
  b.dirty = true;
}

function zeroChar(ch: Ch, bm: Map<BatchId, Batch>) {
  ch.set.batch.forEach((b, i) => {
    const batch = bm.get(b);
    if (!batch) return;
    markZero(batch, ch.slots[i]);
  });
}

function zeroDetail(ch: Ch, bm: Map<BatchId, Batch>) {
  ch.set.parts.forEach((p, i) => {
    if (p.lod === 0) return;
    const batch = bm.get(ch.set.batch[i]);
    if (!batch) return;
    markZero(batch, ch.slots[i]);
  });
}

/** Kemik matrisleri → parça örnek matrisleri. */
function writeChar(ch: Ch, bm: Map<BatchId, Batch>) {
  const p = ch.pose;
  const k = (ch.scale * HS) / 16;
  ch.hs = HS; ch.lift = seatLift(HS < 1 && SEATED.has(ch.motion), HS);
  // karakter: T(pos) R_y(facing) S(k) · kök: T(0,ry,0) R_x(rx)
  _q.setFromEuler(_e.set(0, ch.facing, 0));
  _m.compose(_rp.set(ch.pos.x, ch.pos.y + ch.lift, ch.pos.z), _q, _s.set(k, k, k));
  _q.setFromEuler(_e.set(p.rx, 0, 0));
  _m2.compose(_v.set(0, p.ry, p.fz), _q, ONE);
  boneM.root.multiplyMatrices(_m, _m2);
  // gövde: T(0,by,0)
  _m2.compose(_v.set(0, p.by, 0), _q.identity(), ONE);
  boneM.body.multiplyMatrices(boneM.root, _m2);
  // kafa: T(pivot) R(hx,hy,hz)
  _q.setFromEuler(_e.set(p.hx, p.hy, p.hz));
  _m2.compose(PIVOT_V.head, _q, ONE);
  boneM.head.multiplyMatrices(boneM.body, _m2);
  _q.setFromEuler(_e.set(p.la, 0, p.laz));
  _m2.compose(PIVOT_V.armL, _q, ONE);
  boneM.armL.multiplyMatrices(boneM.body, _m2);
  _q.setFromEuler(_e.set(p.ra, 0, p.raz));
  _m2.compose(PIVOT_V.armR, _q, ONE);
  boneM.armR.multiplyMatrices(boneM.body, _m2);
  _q.setFromEuler(_e.set(p.ll, 0, 0));
  _m2.compose(PIVOT_V.legL, _q, ONE);
  boneM.legL.multiplyMatrices(boneM.root, _m2);
  _q.setFromEuler(_e.set(p.rl, 0, 0));
  _m2.compose(PIVOT_V.legR, _q, ONE);
  boneM.legR.multiplyMatrices(boneM.root, _m2);
  void BONE_PARENT;

  const far = ch.lod === "far";
  const { parts, locals, batch } = ch.set;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (far && part.lod !== 0) continue;
    const b = bm.get(batch[i]);
    if (!b) continue;
    if (part.kind === "box" && ((part.carry && !ch.carry) || (part.device && part.device !== ch.device))) { markZero(b, ch.slots[i]); continue; }
    _m.multiplyMatrices(boneM[part.bone], locals[i]);
    if (part.kind === "box" && part.carry) {
      // parşömen elde hafifçe sallanır
      _m.elements[13] += Math.sin(performance.now() / 110) * 0.02 * (reducedMotion() ? 0 : 1);
    }
    if (put16(b.mesh.instanceMatrix.array as Float32Array, ch.slots[i] * 16, _m.elements)) { b.marks[ch.slots[i]] |= DM; b.dirty = true; }
  }
}

function writeFaces(ch: Ch, face: Face, bm: Map<BatchId, Batch>, atlas: TextureAtlas) {
  const batch = bm.get("tex");
  if (!batch?.uv) return;
  const a = normalizeAvatar(ch.wa.agent.avatar);
  ch.face = face; ch.uvGen = atlas.generation;
  ch.set.parts.forEach((p, i) => {
    if (p.kind !== "quad") return;
    const rect: UvRect = p.quad === "face" ? atlas.face(a, face) : p.quad === "snout" ? atlas.snout(face) : atlas.body(a);
    batch.uv!.array.set(rect, ch.slots[i] * 4);
  });
  batch.uv.needsUpdate = true;
}

function applyColors(list: Ch[], bm: Map<BatchId, Batch>, focusTeam: string | null, hovered: string | null, selected: string | null) {
  for (const ch of list) {
    const dim = !!focusTeam && (ch.wa.agent.team ?? null) !== focusTeam && ch.slug !== hovered && ch.slug !== selected;
    ch.dim = dim;
    const f = dim ? 0.42 : 1;
    ch.set.parts.forEach((p, i) => {
      const batch = bm.get(ch.set.batch[i]);
      if (!batch?.mesh.instanceColor) return;
      if (p.kind === "quad") _c.copy(WHITE); else _c.set(p.c);
      if (dim) { const g = (_c.r + _c.g + _c.b) / 3; _c.lerp(_c.clone().setRGB(g, g, g), 0.5).multiplyScalar(f); }
      batch.mesh.instanceColor.array.set([_c.r, _c.g, _c.b], ch.slots[i] * 3);
      batch.mesh.instanceColor.needsUpdate = true; batch.colAll = true; // renk değişimi tam yükleme
    });
  }
}

/** ACTIVITY-FEEL (B3): kare başı yemek molası bağlamı (dünyanın yemek yerleri, tavan, şu an yemekte olan). */
const NO_MEALS: MealSpot[] = [];
const mealEnv: { spots: MealSpot[]; cap: number; now: number } = { spots: NO_MEALS, cap: 0, now: 0 };
/** Ajana en yakın boş yemek yeri (talep edilmemiş). */
function pickMeal(ch: Ch, claims: Set<string>): MealSpot | null {
  let best: MealSpot | null = null, bd = Infinity;
  for (const m of mealEnv.spots) {
    if (claims.has(key(...m.station.tile))) continue;
    const d = Math.hypot(tx(m.station.tile[0]) - ch.pos.x, tz(m.station.tile[1]) - ch.pos.z);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

const _meXZ = { x: 0, z: 0 };
const meXZ = () => (walkRuntime.live ? ((_meXZ.x = walkRuntime.avatar.x), (_meXZ.z = walkRuntime.avatar.z), _meXZ) : null);

// ------------------------------------------------------------------ hareket (S33: amaçlı davranış)
/**
 * Öncelik: uyku (çevrimdışı) → konuşma (gerçek mesaj/teslim olayı) → hata → "✓ bitti" sevinci → onay bekleme (masada
 * ayakta el sallar) → araç noktası (web/okuma → kitaplık/pencere, kabuk → terminal/sunucu dolabı, plan → tahta) →
 * çalışıyor/düşünüyor (masasında sandalyede) → boşta (masasında oturur; ara sıra kahveye/kanepeye gidip döner).
 * Başıboş dolaşma yoktur. Hareket azaltmada mola gezintisi yok; işlevsel yürüyüşler kalır.
 */
function stepChar(ch: Ch, p: AgentPlan, built: Built, t: number, dt: number, ph: Physics, calm: boolean, budget: number, claims: Set<string>): number {
  const body = ch.body;
  const { mood, tool } = ch.wa;
  const cur = tileOf(ch.pos.x, ch.pos.z);
  const at = (tile: Tile) => cur[0] === tile[0] && cur[1] === tile[1] && Math.hypot(ch.pos.x - tx(tile[0]), ch.pos.z - tz(tile[1])) < 0.08;
  const release = () => { if (ch.claim) { claims.delete(ch.claim); ch.claim = null; } };
  const endErrand = () => { if (ch.errand) ch.idleSince = t; ch.errand = null; release(); };

  if (ch.lastMood !== mood) {
    ch.path = []; ch.goal = null;
    if (mood !== "idle" && mood !== "done") endErrand();
    if (mood === "done") ch.doneUntil = t + 2.6;
    if (mood === "waiting") ch.waitSince = t;
    if (mood === "idle") ch.nextErrand = Math.max(ch.nextErrand, t + 25 + Math.random() * 40);
    // S43: boşta kalma sayacı (uyuklama bundan sonra başlar); uyanınca uyku yeri bırakılır, uyurken tek seferde seçilir
    if (mood === "idle" || mood === "done") { ch.idleSince = t + (mood === "done" ? 2.6 : 0); ch.dozeAfter = DOZE_MIN + Math.random() * DOZE_SPAN; }
    if (mood !== "offline" && ch.inside && ch.bed) leaveHotel(ch, ph, ch.bed.spot.tile); // HOTEL-SYS: uyandı → otel kapısında belirir
    if (mood !== "offline" && ch.bed) { claims.delete(ch.bed.key); ch.bed = null; }
    if (mood === "offline") ch.bedRetry = 0;
    ch.holdUntil = 0; ch.stuckN = 0; ch.detour = null;
    ch.lastMood = mood;
  }
  if ((tool ?? null) !== ch.lastTool) {
    ch.lastTool = tool ?? null;
    const kind = toolKind(tool);
    ch.curKind = kind;
    if (kind) { ch.toolKind = kind; ch.toolUntil = t + 6; }
  }
  const busy = mood === "working" || mood === "thinking" || mood === "waiting";
  // aracın noktası: en yakın; çok uzaksa masada çalışır. Araç sürdükçe (ya da 6 sn) orada kalır.
  let toolSpot: Station | null = null;
  const toolOn = mood === "working" && !!tool ? ch.curKind : t < ch.toolUntil ? ch.toolKind : null;
  if ((mood === "working" || mood === "thinking") && toolOn && toolOn !== "write") {
    const list = built.spots[toolOn] ?? (toolOn === "shell" ? built.spots.plan : undefined);
    toolSpot = nearestStation(p.station.tile, list, spotReach(built));
    // PHYS: kuyruğunda zaman aşımına uğranan nokta bir süre atlanır → sıradaki en yakın nokta, yoksa masası
    if (toolSpot && avoids(ch, t, key(...toolSpot.tile))) {
      toolSpot = nearestStation(p.station.tile, list?.filter((s) => !avoids(ch, t, key(...s.tile))), spotReach(built));
    }
  }

  let target: Tile | null = null;
  let arrive: Motion = "idle";
  let face: number | null = null;
  let inPlace: Motion | null = null;
  const meet = ch.meet;
  // S43: varışta uygulanacak oturak, cihaz ve yükseklik
  let seat: Seat = "chair";
  let device: HeldDevice | null = null;
  let yGoal = 0;
  const own = seatOf(p.station);
  let gm: ReturnType<typeof giftMotion> = null;

  if (restMode(mood) === "bed") {
    // S43 uyku: en yakın boş uyku yerine (yatakhane: ranza, şilte, hamak, şezlong…) yürür ve orada yatar; hiçbiri boş değilse
    // en yakın dinlenme karosunda çökük oturur; o da yoksa kendi istasyonunda uyuyakalır. Asla yürüme yolunda yatmaz.
    // yedek yerdeyken (dinlenme karosu) aralıklarla yeniden yatak arar; boşalan yatağa geçer.
    endErrand();
    if ((!ch.bed || ch.bed.kind === "rest") && t >= ch.bedRetry) {
      ch.bedRetry = t + 8 + Math.random() * 4;
      if (!ch.bed) ch.bed = claimBed(p, built, claims);
      else {
        const up = claimBed(p, built, claims, true, (k) => avoids(ch, t, k));
        if (up) { claims.delete(ch.bed.key); ch.bed = up; ch.path = []; ch.goal = null; }
      }
    }
    const bed = ch.bed;
    if (bed && bed.portal) {
      // HOTEL-SYS (E1): otel kapısına yürür; varınca geçitten "görünmeyen odalara" girer (gizlenir, kapı boşalır)
      if (ch.inside) { ch.path = []; ch.goal = null; liftTo(ch, dt); return budget; }
      const [bi, bj] = bed.spot.tile;
      if (!ch.path.length && Math.hypot(ch.pos.x - tx(bi), ch.pos.z - tz(bj)) < 0.35) { enterHotel(ch, ph); liftTo(ch, dt); return budget; }
      target = bed.spot.tile; face = bed.spot.face; arrive = "idle";
    } else if (bed && bed.kind === "bed") {
      const lounge = sx(bed.spot).pose === "lounge";
      target = bed.spot.tile; face = bed.spot.face + Math.PI; arrive = lounge ? "sleepLounge" : "sleep";
      yGoal = lounge ? (sx(bed.spot).y ?? 0.35) - SEAT_OFF : sx(bed.spot).y ?? 0.3;
    } else if (bed) {
      const sofa = p.sofaTiles.has(bed.key);
      target = bed.spot.tile; face = sofa ? Math.PI : p.station.face; arrive = "slump"; seat = sofa ? "sofa" : "ground";
      yGoal = sofa ? 0 : GROUND_Y - SEAT_OFF;
    } else if (!p.shared && own !== "stand") {
      target = p.station.tile; face = p.station.face; arrive = "slump"; seat = own; yGoal = seatY(own, p.station);
    } else {
      target = p.shared ? p.idle : p.station.tile; face = p.station.face; arrive = "doze";
    }
  } else if (meet && meet.phase !== "done") {
    // konuşma: buluşma noktasına yürü, karşılıklı dur; konuşan jest yapar, dinleyen başını sallar
    endErrand();
    const mine = meet.a === ch ? meet.spotA : meet.spotB;
    const other = meet.a === ch ? meet.b : meet.a;
    if (meet.phase === "talk") {
      ch.path = []; ch.goal = null;
      inPlace = meet.a === ch ? "talk" : "listen";
      face = Math.atan2(other.pos.x - ch.pos.x, other.pos.z - ch.pos.z);
    } else {
      target = mine; arrive = "idle";
      face = Math.atan2(other.pos.x - ch.pos.x, other.pos.z - ch.pos.z);
    }
  } else if (mood === "error") {
    inPlace = "shake";
  } else if (mood === "done" && t < Math.max(ch.doneUntil, ch.victoryUntil)) {
    // S48: ekipçe bitirince zafer dansı (yoksa tek kol havada sevinç)
    inPlace = t < ch.victoryUntil ? "victory" : "cheer";
  } else if (mood === "waiting") {
    // onay bekliyor: masasının başında ayakta, el sallar ("seni bekliyor"); paylaşılan istasyonda kendi boşta karosunda
    target = deskTarget(p); face = p.station.face; arrive = "wave";
  } else if ((mood === "idle" || mood === "done") && (gm = giftMotion(ch, t, meXZ())) && gm.motion !== "glance") {
    // W3: hediye gösterisi ya da tepki (boşta): yerinde; eğlence ve mola biter
    endErrand();
    inPlace = gm.motion === "idle" ? "idle" : gm.motion === "wave" ? "wave" : gm.motion;
    face = gm.face;
  } else if (toolSpot) {
    target = toolSpot.tile; face = toolSpot.face; arrive = TOOL_MOTION[toolOn ?? "write"];
  } else if (busy) {
    // PHYS: paylaşılan istasyonlu (harici oturum, koltuğu olmayan misafir) dolu masayı değil kendi boşta karosunu
    // hedefler, orada ayakta çalışır — eskiden sahibinin oturduğu masanın önünde sonsuza dek kuyruktaydı
    target = deskTarget(p); face = p.station.face;
    // S43: istasyonun duruşuna göre — ayakta (konsol/tablet), bankta/zeminde/şezlongda kucakta dizüstü, sandalyede masada
    const dev = sx(p.station).device;
    if (p.shared) arrive = mood === "working" ? "type" : "think";
    else if (own === "stand") arrive = mood === "working" ? (dev === "tablet" ? "tablet" : "type") : "think";
    else {
      arrive = mood === "working" ? "sitType" : "sitThink"; seat = own; yGoal = seatY(own, p.station);
      if (own !== "chair" && (dev === "laptop" || dev === "tablet" || dev === undefined)) device = "laptop";
    }
    if (arrive === "tablet") device = "tablet";
  } else {
    // boşta: masasında oturur; ara sıra amaçlı bir mola (kahve → belki kanepe → masaya dönüş)
    // S43: uyuklamaya başlayan en az DOZE_HOLD sn uyuklar (mola onu hemen kaldırmaz)
    const dozeFor = t - ch.idleSince - ch.dozeAfter;
    if (!ch.errand && !ch.fun && !calm && !p.shared && t > ch.nextErrand && (dozeFor < 0 || dozeFor > DOZE_HOLD)) {
      ch.nextErrand = t + 55 + Math.random() * 95;
      const pick = (list: Station[]) => list.find((s) => !claims.has(key(...s.tile)));
      // ACTIVITY-FEEL (B3): ara sıra şehrin bir mekânında yeme-içme (tavan: aynı anda en çok `mealCap` ajan)
      const meal = mealEnv.now < mealEnv.cap && mealEnv.spots.length && Math.random() < MEAL_CHANCE ? pickMeal(ch, claims) : null;
      const coffee = p.coffee && !claims.has(key(...p.coffee.tile)) ? p.coffee : null;
      const lounge = pick(p.lounge);
      const first = coffee ?? lounge;
      if (meal) {
        ch.errand = { kind: "meal", spot: meal.station, phase: "go", until: 0, meal };
        release(); ch.claim = key(...meal.station.tile); claims.add(ch.claim);
        mealEnv.now++;
      } else if (first) {
        ch.errand = { kind: first === coffee ? "coffee" : "lounge", spot: first, phase: "go", until: 0 };
        release(); ch.claim = key(...first.tile); claims.add(ch.claim);
      }
    }
    const e = ch.errand;
    if (e) {
      if (e.kind === "meal" && e.phase === "stay" && t > e.until) { e.phase = "joy"; e.until = t + MEAL_JOY; }
      else if (e.kind === "meal" && e.phase === "joy" && t > e.until) endErrand();
      else if (e.phase === "stay" && t > e.until) {
        const next = e.kind === "coffee" && Math.random() < 0.55 ? p.lounge.find((s) => !claims.has(key(...s.tile))) : undefined;
        if (next) { release(); ch.claim = key(...next.tile); claims.add(ch.claim); ch.errand = { kind: "lounge", spot: next, phase: "go", until: 0 }; }
        else endErrand();
      }
    }
    const e2 = ch.errand;
    const fun = ch.fun;
    const feast = ch.feast;
    if (mgActor.agent === ch.slug && mgActor.table) {
      // W3: mini oyun rakibi — masanın B yanında taburede oturur, sırası gelince taş sürer (yerel; model çağrısı yok)
      endErrand();
      target = mgActor.table.b; face = mgActor.table.faceB; arrive = "board"; seat = "chair"; yGoal = (mgActor.table.yb ?? BOARD_STOOL_Y) - SEAT_OFF;
    } else if (feast) {
      // W3: ekip yemeği — ortak masa çevresinde toplanır, tepsiden yer (≈ 20 sn)
      endErrand();
      if (feast.spot) { target = feast.spot; face = feast.face; } else { target = p.shared ? p.idle : p.station.tile; face = p.station.face; }
      arrive = "sip";
    } else if (fun && !e2) {
      // S48: eğlenceli hareket — yerine yürür; ikisi de varınca oynar (sandalyede dönme kendi oturağında)
      const mine = fun.a === ch;
      target = mine ? fun.spotA : fun.spotB ?? fun.spotA;
      face = mine ? fun.faceA : fun.faceB;
      arrive = fun.phase === "play" ? (mine ? fun.motA : fun.motB) : "idle";
      // W2-INT: masa oyunu — alçak taburede oturarak (oyun masalarının yanında ~0,4 tabure)
      if (fun.kind === "board") { seat = "chair"; yGoal = ((mine ? fun.table?.ya : fun.table?.yb) ?? BOARD_STOOL_Y) - SEAT_OFF; if (fun.phase !== "play") arrive = "idle"; }
      if (fun.kind === "spin") {
        seat = own === "stand" ? "chair" : own; yGoal = seatY(own, p.station);
        if (fun.phase === "play") face = fun.faceA + Math.min(1, (t - fun.t0) / 2.2) ** 0.8 * Math.PI * 4;
        else arrive = "sit";
      }
    } else if (e2 && e2.kind === "meal") {
      // ACTIVITY-FEEL (B3): mekânın gerçek oturağında yer/içer; bitince oturduğu yerde kalkıp sevinir
      target = e2.spot.tile; face = e2.spot.face;
      if (e2.phase === "joy") { arrive = "cheer"; }
      else { arrive = "sitEat"; seat = e2.meal?.ground ? "ground" : "bench"; yGoal = seatY(seat, e2.spot); }
    } else if (e2) {
      target = e2.spot.tile; face = e2.spot.face;
      arrive = e2.kind === "coffee" ? "sip" : p.sofaTiles.has(key(...e2.spot.tile)) ? "lounge" : "sip";
    } else {
      // S43: bir süre boşta kalan (girdi bekleyen) ajan olduğu yerde uyuklar: masasında oturarak, ayaktaysa ayakta
      const dozing = dozeFor > 0;
      if (p.shared) {
        target = p.idle; face = p.station.face; arrive = dozing ? "doze" : "idle";
      } else {
        target = p.station.tile; face = p.station.face;
        if (own === "stand") arrive = dozing ? "doze" : "idle";
        else { arrive = dozing ? "sitDoze" : "sit"; seat = own; yGoal = seatY(own, p.station); }
      }
    }
  }

  // PHYS geliştirme kancası: zorunlu hedef (kuyruk/koridor ekran görüntüleri); süre dolunca normal davranış
  if (ch.force) {
    if (performance.now() / 1000 > ch.force.until) { ch.force = null; ch.path = []; ch.goal = null; }
    else { target = ch.force.tile; arrive = "sip"; face = null; inPlace = null; seat = "chair"; device = null; yGoal = 0; ch.bump = null; }
  }
  // S48 şakşak: çarpışan yürüyen yerinde sendeler/düşer, yolu korunur; sonra devam eder (onay beklerken yok)
  if (ch.bump && !inPlace && mood !== "waiting" && mood !== "offline" && !meet) {
    // PHYS: şakşak senaryolu temastır — iki beden beyaz listede (birbirine CONTACT_MIN'e kadar yaklaşabilir), yerinde durur
    body.contactUntil = Math.max(body.contactUntil, ph.t + (ch.bump.until - t)); // çözücü saatine çevrilir
    toStatic(body);
    ch.motion = bumpMotion(ch.bump, t); ch.device = null; ch.yGoal = 0;
    liftTo(ch, dt);
    return budget;
  }
  if (inPlace) {
    toStatic(body);
    ch.motion = inPlace; ch.device = null; ch.yGoal = 0;
    if (face !== null) turnTo(ch, face, dt);
    liftTo(ch, dt);
    return budget;
  }
  // PHYS: kuyruk zaman aşımı (çözücü, beden başına 8–15 sn) → başka mola/uyku/araç yeri ya da yakında nazik kaçış
  if (body.queueOut) {
    body.queueOut = false; body.waitT = 0;
    body.queueLimit = QUEUE_MIN + Math.random() * QUEUE_SPAN;
    if (target && !ch.force && onQueueTimeout(ch, p, built, t, ph, claims, target, !!toolSpot && target === toolSpot.tile)) {
      // hedef değişti (yeni mola/uyku yeri, sıradaki araç noktası): bir kare durur, sonraki karede yeni hedefe planlar
      toStatic(body);
      liftTo(ch, dt);
      return budget;
    }
  }
  if (ch.detour) {
    // kaçış karosunda hedefe dönük bekler; süre dolunca (ya da hedef değişince) gerçek hedef yeniden denenir
    if (!target || t >= ch.detour.until || ch.detour.of !== key(...target)) ch.detour = null;
    else {
      face = Math.atan2(tx(target[0]) - tx(ch.detour.tile[0]), tz(target[1]) - tz(ch.detour.tile[1]));
      target = ch.detour.tile; arrive = "idle"; seat = "chair"; device = null; yGoal = 0;
    }
  }
  if (target && t < ch.holdUntil) {
    // PHYS yedek: yol bulunamadı/takıldı → bir süre yerinde bekler (sonra yeniden dener)
    toStatic(body); ch.path = [];
    ch.motion = "idle"; ch.device = null; ch.yGoal = 0;
    liftTo(ch, dt);
    return budget;
  }
  if (target) {
    const newGoal = !ch.goal || ch.goal[0] !== target[0] || ch.goal[1] !== target[1] || (!ch.path.length && !at(target));
    if (newGoal) ch.stuckN = 0;
    if (newGoal || ch.needPlan) {
      ch.goal = target;
      if (budget > 0) {
        budget--;
        ch.needPlan = false;
        // PHYS: ince ızgara (eşyaların etrafından; hedef karo her zaman girilebilir), olmazsa kaba ızgara
        ch.path = at(target) ? [] : findPath(cur, target, ph.sw.nav) ?? findPath(cur, target, built) ?? [];
        if (!ch.path.length && !at(target)) ch.path = [target]; // ulaşılamıyorsa doğrudan dener (çarpıştırıcılar durdurur → takılma)
      } else {
        ch.needPlan = true; // bu kare bütçe doldu; bir sonraki karede planla
      }
    }
    // PHYS: takıldıysa yeniden plan (duran bedenlerin karoları kapalı); üst üste takılırsa yedek hedef
    if (body.stuck && ch.path.length) {
      body.stuck = false; body.stuckT = 0;
      if (budget > 0) {
        budget--;
        ch.stuckN++;
        const np = ch.stuckN <= 2 ? replan(ph, body, target) : null;
        if (np && np.length) ch.path = np;
        else budget = fallback(ch, p, built, t, claims, budget);
      }
    }
    if (ch.path.length) {
      // yürüyüş fizik adımında (30 Hz, ivme sınırlı); burada yalnızca bedene yol, hız ve izinli hedef verilir
      // W3: "enerjik" (kahve/çay sonrası, boşta) biraz daha hızlı yürür — yalnızca görsel; hareket azaltmada 1
      toWalk(ph, body, ch.path, meet ? MEET_WALK_SPEED : WALK_SPEED * ch.walkScale, target);
      body.lite = ch.lod === "off";
      const sp = Math.hypot(body.vx, body.vz);
      if (body.queued && body.waitT > 0.6) {
        // kuyrukta: hedefe dönük bekler (ayakta yapılabilen varış hareketi, yoksa boşta)
        ch.motion = STANDING.has(arrive) ? arrive : "idle"; ch.device = null; ch.yGoal = 0;
        turnTo(ch, Math.atan2(tx(target[0]) - ch.pos.x, tz(target[1]) - ch.pos.z), dt);
      } else {
        if (sp > 0.15) turnTo(ch, Math.atan2(body.vx, body.vz), dt);
        else if (ch.path.length) turnTo(ch, Math.atan2(tx(ch.path[0][0]) - ch.pos.x, tz(ch.path[0][1]) - ch.pos.z), dt);
        ch.motion = sp > 0.12 || !body.queued ? "walk" : "idle"; ch.device = null; ch.yGoal = 0;
      }
    } else if (!ch.needPlan) {
      toStatic(body);
      ch.stuckN = 0;
      ch.motion = arrive; ch.seat = seat; ch.device = device; ch.yGoal = yGoal;
      if (face !== null) turnTo(ch, face, dt);
      const e = ch.errand;
      if (e && e.phase === "go" && mood !== "offline" && !meet) {
        e.phase = "stay";
        e.until = t + (e.kind === "coffee" ? 5 + Math.random() * 3 : e.kind === "meal" ? MEAL_STAY[0] + Math.random() * (MEAL_STAY[1] - MEAL_STAY[0]) : 12 + Math.random() * 12);
        // ACTIVITY-FEEL (B3): mekânda sipariş anı (satıcı dikişi)
        if (e.kind === "meal" && e.meal) orderFromVendor({ by: ch.slug, city: e.meal.city, ritual: e.meal.ritual, item: e.meal.held, x: e.meal.anchor.x, z: e.meal.anchor.z });
      }
    } else toStatic(body);
  } else {
    toStatic(body);
    ch.motion = "idle"; ch.device = null; ch.yGoal = 0;
  }
  liftTo(ch, dt);
  return budget;
}

// ------------------------------------------------------------------ PHYS: beden yardımcıları
/** yer tutucu (makeMeCh; avatarın bedeni ayrı tutulur) */
const NO_BODY: Body = createBody(-2, 0, 0, AGENT_R, OFF);
/** kuyrukta ayakta oynatılabilen varış hareketleri */
const STANDING: ReadonlySet<Motion> = new Set<Motion>(["idle", "wave", "type", "think", "tablet", "read", "talk", "sip", "doze"]);

/** Yeni karakterin bedeni: doğma karosunda; orası doluysa (paylaşılan boşta karosu) en yakın boş yer (izinli ışınlanma). */
function spawnBody(ph: Physics, ch: Ch, spawn: Tile): Body {
  const r = Math.max(0.15, AGENT_R * ch.scale);
  const k = tileIndex(ph.sw, tx(spawn[0]), tz(spawn[1]));
  const q = placeFree(ph, ch.pos.x, ch.pos.z, r, k);
  ch.pos.x = q.x; ch.pos.z = q.z;
  const b = createBody(ph.bodies.length + 1 + Math.floor(ch.seed * 1e6), q.x, q.z, r, STATIC);
  b.goal = k;
  b.queueLimit = QUEUE_MIN + Math.random() * QUEUE_SPAN; // beden başına 8–15 sn (hep birlikte vazgeçmesinler)
  return addBody(ph, b);
}

/** Bir süre kaçınılan hedef karosu (kuyruk zaman aşımı ya da takılma sonrası), süresi dolmadıysa */
const avoids = (ch: Ch, t: number, k: string) => { const u = ch.avoid?.get(k); return u !== undefined && t < u; };
/** Hedefi bir süre kaçınılanlara ekler (en çok 4; süresi dolanlar atılır) — iki dolu nokta arasında gidip gelinmez */
function avoidFor(ch: Ch, k: string, t: number, secs: number) {
  const m = ch.avoid ??= new Map();
  for (const [a, u] of m) if (u <= t) m.delete(a);
  if (m.size >= 4) m.delete(m.keys().next().value!);
  m.set(k, t + secs);
}

/** Duran beden (oturan, çalışan, uyuyan, yerinde hareket eden): yürüyenler etrafından dolaşır. */
function toStatic(b: Body) {
  if (b.mode === WALK) { b.vx = 0; b.vz = 0; }
  if (b.mode !== KINEMATIC && b.mode !== OFF) b.mode = STATIC;
  b.path = null; b.queued = false; b.waitT = 0; b.queueOut = false; b.stuck = false; b.stuckT = 0;
}

/**
 * kuyruk zaman aşımı: `target`ın kuyruğunda sınırını dolduran karakter için yeni seçim. Mola yeri dolu → başka boş
 * mola yeri ya da mola biter; uyku yeri dolu → başka boş yatak; araç noktası dolu → nokta bir süre atlanır (sıradaki nokta ya
 * da masası); diğerleri (masası, boşta karosu, buluşma/eğlence yeri) → hedefin 2–4 karo yakınında boş bir karoya nazik kaçış,
 * 3–7 sn sonra yeniden dener; o da yoksa 2–4 sn yerinde (duran beden, kuyrukta değil) bekler. Dönüş: hedef değişti mi.
*/
function onQueueTimeout(ch: Ch, p: AgentPlan, built: Built, t: number, ph: Physics, claims: Set<string>, target: Tile, tool: boolean): boolean {
  const tk = key(...target);
  ch.path = []; ch.goal = null; ch.needPlan = false;
  const e = ch.errand;
  if (e && key(...e.spot.tile) === tk) {
    if (ch.claim) { claims.delete(ch.claim); ch.claim = null; }
    avoidFor(ch, tk, t, 25 + Math.random() * 10);
    const alt = p.lounge.find((s) => key(...s.tile) !== tk && !claims.has(key(...s.tile)) && !avoids(ch, t, key(...s.tile)));
    if (alt) { ch.claim = key(...alt.tile); claims.add(ch.claim); ch.errand = { kind: "lounge", spot: alt, phase: "go", until: 0 }; }
    else { ch.errand = null; ch.idleSince = t; }
    return true;
  }
  if (ch.bed && ch.bed.key === tk) {
    avoidFor(ch, tk, t, 30 + Math.random() * 15);
    const up = claimBed(p, built, claims, true, (k) => avoids(ch, t, k));
    if (up && up.key !== ch.bed.key) { claims.delete(ch.bed.key); ch.bed = up; return true; }
  }
  avoidFor(ch, tk, t, 25 + Math.random() * 10);
  if (tool) return true;
  const w = ph.sw.width;
  const d = queueDetour(ph, ch.body, target, (k) => claims.has(key(k % w, (k - (k % w)) / w)));
  if (d) ch.detour = { tile: d, until: t + 3 + Math.random() * 4, of: tk };
  else ch.holdUntil = t + 2 + Math.random() * 2;
  return false;
}

/** Yürüyen beden: yol (paylaşılan dizi), hız; duranken kalkıyorsa bulunduğu karo (sandalye/yatak) çıkana dek muaf. */
function toWalk(ph: Physics, b: Body, path: Tile[], speed: number, target: Tile) {
  if (b.mode !== WALK) {
    b.leave = tileIndex(ph.sw, b.x, b.z);
    b.mode = WALK; b.stuckT = 0; b.stuck = false;
  }
  b.path = path; b.speed = speed;
  b.goal = target[1] * ph.sw.width + target[0];
}

/**
 * Takılma yedeği: mola → başka boş dinlenme yeri ya da molayı bitir; uyku → başka yatak (sonraki denemede); diğerleri →
 * birkaç saniye yerinde bekle, sonra yeniden dene. Bütçe döner.
 */
function fallback(ch: Ch, p: AgentPlan, built: Built, t: number, claims: Set<string>, budget: number): number {
  ch.path = []; ch.goal = null; ch.stuckN = 0;
  const e = ch.errand;
  if (e) {
    if (ch.claim) { claims.delete(ch.claim); ch.claim = null; }
    const alt = p.lounge.find((s) => s !== e.spot && !claims.has(key(...s.tile)));
    if (alt && e.kind === "coffee") { ch.claim = key(...alt.tile); claims.add(ch.claim); ch.errand = { kind: "lounge", spot: alt, phase: "go", until: 0 }; }
    else { ch.errand = null; ch.idleSince = t; }
    return budget;
  }
  if (ch.bed && ch.wa.mood === "offline") {
    avoidFor(ch, ch.bed.key, t, 30 + Math.random() * 15);
    const up = claimBed(p, built, claims, true, (k) => avoids(ch, t, k));
    if (up && up.key !== ch.bed.key) { claims.delete(ch.bed.key); ch.bed = up; return budget; }
  }
  ch.holdUntil = t + 4 + ch.seed * 3;
  return budget;
}

/** S43: yatağa/banka/şezlonga yumuşakça yükselir (yürürken zemine iner). */
function liftTo(ch: Ch, dt: number) {
  const d = ch.yGoal - ch.pos.y;
  if (Math.abs(d) < 1e-3) { ch.pos.y = ch.yGoal; return; }
  ch.pos.y += d * Math.min(1, dt * 6);
}

// ------------------------------------------------------------------ S43: uyku yerleri ve istasyon duruşu
/** S41 sözleşmesi: istasyonun isteğe bağlı duruş/cihaz/yükseklik alanları; uyku yerinde yatak türü.*/
type StationX = Station & { pose?: string; device?: string; y?: number; bed?: string };
const sx = (s: Station) => s as StationX;
/** Uyku yeri: S41'in `built.spots.sleep` karosu ("bed") ya da yedek dinlenme karosu ("rest"); `key` talep anahtarı. */
interface Bed { spot: Station; key: string; kind: "bed" | "rest"; /** HOTEL-SYS: otel kapısı geçidi (sanal kapasite) */ portal?: boolean }
/** HOTEL-SYS (E1): geçit talep sayacı (her ajan aynı kapıyı kendi anahtarıyla kullanır) */
let PORTAL_SEQ = 0;
/** Geçide girer: çizim kapanır (LOD off), beden fizikten çekilir → kapı karosu ötekilere açık kalır. */
function enterHotel(ch: Ch, ph: Physics) {
  ch.inside = true; ch.path = []; ch.goal = null;
  if (ch.body.mode !== OFF) { removeBody(ph, ch.body); ch.body.mode = OFF; }
}
/** Uyandı: kapı karosunun yakınındaki boş yere bedeni geri koyar ve görünür olur. */
function leaveHotel(ch: Ch, ph: Physics, door: Tile) {
  ch.inside = false;
  const q = placeFree(ph, tx(door[0]), tz(door[1]), ch.body.r);
  ch.body.x = ch.body.px = ch.pos.x = q.x; ch.body.z = ch.body.pz = ch.pos.z = q.z;
  if (ch.body.mode === OFF) { ch.body.mode = STATIC; ch.body.path = null; addBody(ph, ch.body); }
}
/** oturan ajanın kalçası/oturağı kök yüksekliğinin bu kadar üstünde (dünya birimi; sandalye ≈ 0,32) */
const SEAT_OFF = 0.32;
/** W2-INT: masa oyunu taburesinin oturak yüksekliği (tavla/dama masaları) */
const BOARD_STOOL_Y = 0.4;
const GROUND_Y = 0.05;
/** boşta kaldıktan sonra uyuklamaya başlama süresi (sn): DOZE_MIN + [0, DOZE_SPAN) */
const DOZE_MIN = 20;
const DOZE_SPAN = 30;
const DOZE_HOLD = 45;
const EYES_SHUT: ReadonlySet<Motion> = new Set<Motion>(["sleep", "sleepLounge", "slump", "doze", "sitDoze"]);

function seatOf(s: Station): Seat | "stand" {
  switch (sx(s).pose) {
    case "sit_bench": return "bench";
    case "sit_ground": return "ground";
    case "lounge": return "lounge";
    case "stand": return "stand";
    default: return "chair";
  }
}

/** İstasyonda oturan ajanın kök yüksekliği: istasyonun `y`'si (oturak üstü) varsa ona, yoksa oturağın varsayılanına göre. */
function seatY(seat: Seat | "stand", s: Station): number {
  const y = sx(s).y;
  if (seat === "stand") return 0;
  if (seat === "ground") return (y ?? GROUND_Y) - SEAT_OFF;
  if (seat === "lounge") return (y ?? 0.35) - SEAT_OFF;
  return y !== undefined ? Math.max(-0.4, Math.min(2, y - SEAT_OFF)) : 0;
}

const NO_SPOTS: Station[] = [];
const POSE_OPTS: PoseOpts = { seat: "chair", seed: 0 };
function sleepSpots(built: Built): Station[] {
  return (built.spots as Partial<Record<string, Station[]>>).sleep ?? NO_SPOTS;
}

/** En yakın boş uyku yeri (otel varsa otel yatağı) → en yakın boş dinlenme karosu (MAX_REST_DIST) → null (istasyonunda uyuyakalır). `bedOnly`: yalnız yatak. */
function claimBed(p: AgentPlan, built: Built, claims: Set<string>, bedOnly = false, skip: ((k: string) => boolean) | null = null): Bed | null {
  const [si, sj] = p.station.tile;
  // GROWTH: oteli olan dünyada yalnız otel içi yataklar (açık yatak sırası seçilmez); otelsizde bütün uyku yerleri (fun/sleep.ts sleepPool)
  const spots = sleepPool(sleepSpots(built), built.modules);
  // skip: az önce vazgeçilen (ulaşılamayan/dolu) yataklar — bırakılınca hemen yeniden seçilip gidip gelinmesin (FIX-PHYS)
  const i = nearestSleepSpot(p.station.tile, spots, (k) => claims.has(k) || built.blocked.has(k) || !!skip?.(k), sleepReach(built));
  if (i >= 0 && isPortalSpot(spots[i])) { const bk = portalClaim(spots[i].tile, String(++PORTAL_SEQ)); claims.add(bk); return { spot: spots[i], key: bk, kind: "bed", portal: true }; }
  if (i >= 0) { const bk = key(...spots[i].tile); claims.add(bk); return { spot: spots[i], key: bk, kind: "bed" }; }
  if (bedOnly) return null;
  const rk = key(...p.rest);
  const rd = Math.abs(p.rest[0] - si) + Math.abs(p.rest[1] - sj);
  if (rd > 0 && rd <= MAX_REST_DIST && !claims.has(rk) && !built.blocked.has(rk)) {
    claims.add(rk);
    return { spot: { tile: p.rest, face: p.station.face }, key: rk, kind: "rest" };
  }
  return null;
}

function turnTo(ch: Ch, want: number, dt: number) {
  let diff = want - ch.facing;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  ch.facing += diff * Math.min(1, dt * 8);
}

// ------------------------------------------------------------------ konuşmalar (yalnızca gerçek olaylardan)
interface Meet { key: string; a: Ch; b: Ch; text: string; spotA: Tile; spotB: Tile; born: number; talkUntil: number; phase: "walk" | "talk" | "done" }
const MEET_MAX = 8;
const MEET_WALK = 14;
const MEET_TALK = 5.5;
const MEET_RECENT = 12_000;

/** Buluşma noktası: iki ajanın ortasına en yakın yürünebilir karo + yanındaki karo (karşılıklı dururlar). */
function meetSpots(a: Ch, b: Ch, built: Built, claims: Set<string>): [Tile, Tile] {
  const ta = tileOf(a.pos.x, a.pos.z), tb = tileOf(b.pos.x, b.pos.z);
  if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < 2.6) return [ta, tb];
  const free = (i: number, j: number) => i >= 0 && j >= 0 && i < built.width && j < built.depth && !built.blocked.has(key(i, j)) && !claims.has(key(i, j));
  const mi = Math.round((ta[0] + tb[0]) / 2), mj = Math.round((ta[1] + tb[1]) / 2);
  for (let r = 0; r <= 5; r++) {
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = mi + di, j = mj + dj;
      if (!free(i, j)) continue;
      // iki karo arayla karşılıklı (etiketler üst üste binmesin); olmazsa yan yana
      const dirs = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as Tile[])
        .sort((u, v) => Math.hypot(i + u[0] - tb[0], j + u[1] - tb[1]) - Math.hypot(i + v[0] - tb[0], j + v[1] - tb[1]));
      const far = dirs.find(([x, z]) => free(i + x, j + z) && free(i + 2 * x, j + 2 * z));
      if (far) return [[i, j], [i + 2 * far[0], j + 2 * far[1]]];
      const near = dirs.find(([x, z]) => free(i + x, j + z));
      if (!near) continue;
      return [[i, j], [i + near[0], j + near[1]]];
    }
  }
  return [ta, tb];
}

function stepMeets(talks: Talk[], chars: Map<string, Ch>, meets: Map<string, Meet>, seen: Map<string, number>, built: Built,
  claims: Set<string>, live: WorldLive, t: number, now: number) {
  for (const talk of talks) {
    if (seen.has(talk.key)) continue;
    seen.set(talk.key, now);
    if (now - talk.ts > MEET_RECENT || meets.size >= MEET_MAX) continue;
    const a = chars.get(talk.from), b = chars.get(talk.to);
    if (!a || !b || a === b || a.meet || b.meet || a.wa.mood === "offline" || b.wa.mood === "offline") continue;
    const [spotA, spotB] = meetSpots(a, b, built, claims);
    const m: Meet = { key: talk.key, a, b, text: talk.text, spotA, spotB, born: t, talkUntil: 0, phase: "walk" };
    a.meet = m; b.meet = m; a.path = []; b.path = []; a.goal = null; b.goal = null;
    a.carry = { id: 0, from: a.slug, to: b.slug, ts: now };
    live.carry.set(a.slug, a.carry);
    meets.set(talk.key, m);
  }
  if (seen.size > 300) for (const [k, ts] of seen) if (now - ts > 60_000) seen.delete(k);
  for (const m of meets.values()) {
    const arrived = (c: Ch, tile: Tile) => !c.path.length && Math.hypot(c.pos.x - tx(tile[0]), c.pos.z - tz(tile[1])) < 0.12;
    if (m.phase === "walk") {
      const close = Math.hypot(m.a.pos.x - m.b.pos.x, m.a.pos.z - m.b.pos.z);
      if ((arrived(m.a, m.spotA) && arrived(m.b, m.spotB)) || (t - m.born > MEET_WALK && close < 3.2)) {
        m.phase = "talk"; m.talkUntil = t + MEET_TALK;
        m.a.carry = null; live.carry.delete(m.a.slug);
        live.talking.set(m.a.slug, m.text);
        live.meeting.add(m.a.slug); live.meeting.add(m.b.slug);
      } else if (t - m.born > MEET_WALK + 4) {
        m.phase = "done";
      }
    } else if (m.phase === "talk" && t > m.talkUntil) {
      m.phase = "done";
    }
    if (m.phase === "done") {
      live.talking.delete(m.a.slug);
      live.meeting.delete(m.a.slug); live.meeting.delete(m.b.slug);
      if (m.a.carry) { m.a.carry = null; live.carry.delete(m.a.slug); }
      if (m.a.meet === m) m.a.meet = null;
      if (m.b.meet === m) m.b.meet = null;
      m.a.path = []; m.a.goal = null; m.b.path = []; m.b.goal = null;
      meets.delete(m.key);
    }
  }
}

// ------------------------------------------------------------------ HUD odak kümesi (S33: sade etiket politikası)
/** Tam HUD (drei Html: ad · fiil · iş paneli) yalnızca: seçili, üzerine gelinen ("Minimal" modda değil) ve seni bekleyen
 *  ajanlar (en uzun bekleyen en çok NEEDS_MAX). Ekip odağı ve "Hepsi" modu tuvaldeki çakışmasız etiketlerle çözülür. */
const NEEDS_MAX = 3;
function needsYou(ch: Ch) { return ch.wa.mood === "waiting" || !!ch.wa.work?.awaiting; }

function focusSet(list: Ch[], selected: string | null, hovered: string | null, mode: LabelMode): string[] {
  const out: string[] = [];
  const waiting: Ch[] = [];
  for (const ch of list) {
    if (ch.lod === "off") continue;
    if (ch.slug === selected || (ch.slug === hovered && mode !== "minimal")) out.push(ch.slug);
    else if (needsYou(ch)) waiting.push(ch);
  }
  waiting.sort((a, b) => a.waitSince - b.waitSince || a.dist - b.dist);
  for (const ch of waiting.slice(0, NEEDS_MAX)) out.push(ch.slug);
  return out.sort();
}

// ------------------------------------------------------------------ hafif etiketler (2B tuval)
const LABEL_FONT = "500 16px 'Pixelify Sans Variable', 'Bricolage Grotesque Variable', system-ui, sans-serif";
const CAP_FONT = "500 14px 'Pixelify Sans Variable', 'Bricolage Grotesque Variable', system-ui, sans-serif";
const MOOD_DOT: Record<Mood, string> = { idle: "#7bd152", thinking: "#8cc0f0", working: "#8cc0f0", waiting: "#f2c46a", done: "#7bd152", error: "#ff9a90", offline: "#a39fb8" };

/** Bağlayıcı simgeleri (lucide yolları, ISC lisanslı; arayüzdeki CONN_ICON ile aynı biçim) — 24 birimlik kutu. */
const CONN_PATHS: Record<ConnKind, string[]> = {
  ollama: ["M12 20v2", "M12 2v2", "M17 20v2", "M17 2v2", "M2 12h2", "M2 17h2", "M2 7h2", "M20 12h2", "M20 17h2", "M20 7h2", "M7 20v2", "M7 2v2",
    "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M9 8h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"],
  codex: ["M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
    "M20 3v4", "M22 5h-4", "M4 17v2", "M5 18H3"],
  claude: ["M12 19h8", "m4 17 6-6-6-6"],
  profile: ["M20 7h-9", "M14 17H5", "M20 17a3 3 0 1 1-6 0a3 3 0 1 1 6 0z", "M10 7a3 3 0 1 1-6 0a3 3 0 1 1 6 0z"],
  openai: ["M12 22v-5", "M9 8V2", "M15 8V2", "M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"],
};
const CONN_COLOR: Record<ConnKind, string> = { claude: "#F0A07F", codex: "#8FC1EE", ollama: "#E2E8F0", profile: "#C4B5FD", openai: "#86EFAC" };
let connPath2d: Partial<Record<ConnKind, Path2D[]>> = {};

function drawConn(ctx: CanvasRenderingContext2D, kind: ConnKind, x: number, y: number, size: number) {
  const paths = connPath2d[kind] ??= CONN_PATHS[kind].map((d) => new Path2D(d));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = CONN_COLOR[kind];
  ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const p of paths) ctx.stroke(p);
  ctx.restore();
}

/** (etiket önbelleği): en son kullanılan LABEL_LRU tuval tutulur — eskiden 900'e varınca hepsi bir karede atılıp görünenler
 * aynı karede yeniden çiziliyordu (takılma + ~40 MB tuval). Map ekleme sırası = kullanım sırası (isabette sona taşınır).*/
const LABEL_LRU = 240;
function labelGet(cache: Map<string, HTMLCanvasElement>, k: string): HTMLCanvasElement | undefined {
  const c = cache.get(k);
  if (c) { cache.delete(k); cache.set(k, c); }
  return c;
}
function labelPut(cache: Map<string, HTMLCanvasElement>, k: string, c: HTMLCanvasElement): HTMLCanvasElement {
  cache.set(k, c);
  while (cache.size > LABEL_LRU) cache.delete(cache.keys().next().value!);
  return c;
}
/** drawLabels'ın ertelenen etiket çizimleri (ajan etiketleri rozet/tabela/uyku "z"sinin üstünde kalsın diye sonda çizilir).*/
const PILL_DRAWS: { bmp: HTMLCanvasElement; rect: Rect; bw: number; bh: number; bub: { img: HTMLCanvasElement; r: Rect } | null }[] = [];
/** etiket örtü sonucu (karakter başına kare başına bir kez).*/
const HIDE_MEMO = new Map<Ch, boolean>();

/** Ad + etkinlik etiketi: "● [simge] Ad · kod yazıyor". */
function labelBitmap(cache: Map<string, HTMLCanvasElement>, name: string, color: string, mood: Mood, dim: boolean, caption: string, conn: ConnKind | null): HTMLCanvasElement {
  const k = `${name}|${color}|${mood}|${dim ? 1 : 0}|${caption}|${conn ?? ""}`;
  const hit = labelGet(cache, k);
  if (hit) return hit;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = LABEL_FONT;
  const text = name.length > 18 ? `${name.slice(0, 17)}…` : name;
  const tw = Math.ceil(ctx.measureText(text).width);
  ctx.font = CAP_FONT;
  const cap = caption.length > 26 ? `${caption.slice(0, 25)}…` : caption;
  const cw = cap ? Math.ceil(ctx.measureText(cap).width) + 8 : 0;
  const iw = conn ? 16 : 0;
  const w = tw + 14 + 14 + iw + cw, h = 24;
  c.width = w * dpr; c.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.globalAlpha = dim ? 0.45 : 1;
  ctx.fillStyle = "rgba(20,18,30,0.86)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(1, 1, w - 2, h - 2, 6); ctx.fill(); ctx.stroke();
  ctx.fillStyle = MOOD_DOT[mood];
  ctx.beginPath(); ctx.arc(10, h / 2, 3.2, 0, Math.PI * 2); ctx.fill();
  if (conn) drawConn(ctx, conn, 18, h / 2 - 6, 12);
  ctx.fillStyle = "#fff";
  ctx.font = LABEL_FONT;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 19 + iw, h / 2 + 1);
  if (cap) {
    ctx.font = CAP_FONT;
    ctx.fillStyle = mood === "waiting" ? "#F2C46A" : "#C8C3D6";
    ctx.fillText(cap, 19 + iw + tw + 8, h / 2 + 1);
  }
  return labelPut(cache, k, c);
}

/** Konuşma balonu (beyaz, kuyruklu): yalnızca gerçek olayın kısa özeti. */
function bubbleBitmap(cache: Map<string, HTMLCanvasElement>, text: string): HTMLCanvasElement {
  const k = `say|${text}`;
  const hit = labelGet(cache, k);
  if (hit) return hit;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = "600 14px 'Inter Variable', system-ui, sans-serif";
  ctx.font = font;
  const tw = Math.ceil(ctx.measureText(text).width);
  const w = tw + 20, h = 34;
  c.width = w * dpr; c.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#FFFDF8"; ctx.strokeStyle = "#1E1B2E"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(1, 1, w - 2, 24, 8); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w / 2 - 6, 24); ctx.lineTo(w / 2, 32); ctx.lineTo(w / 2 + 6, 24); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(w / 2 - 6, 25); ctx.lineTo(w / 2, 32); ctx.lineTo(w / 2 + 6, 25); ctx.stroke();
  ctx.fillStyle = "#1E1B2E"; ctx.font = font; ctx.textBaseline = "middle";
  ctx.fillText(text, 10, 13);
  return labelPut(cache, k, c);
}

/** Küçük durum rozeti: ruh hâli rengi + araç simgesi (çalışırken) ya da işaret (✓, !, z). */
const DOT_BG: Record<Mood, string> = { idle: "#5FA046", thinking: "#3E7FC1", working: "#3E7FC1", waiting: "#C98A12", done: "#4E9A32", error: "#C2453A", offline: "#6E6A85" };
function dotBitmap(cache: Map<string, HTMLCanvasElement>, mood: Mood, kind: ToolKind | null, dim: boolean): HTMLCanvasElement {
  const k = `dot|${mood}|${kind ?? ""}|${dim ? 1 : 0}`;
  const hit = labelGet(cache, k);
  if (hit) return hit;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const big = mood !== "idle";
  const s = big ? 18 : 10;
  const c = document.createElement("canvas");
  c.width = s * dpr; c.height = s * dpr;
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  g.globalAlpha = dim ? 0.45 : 1;
  g.fillStyle = DOT_BG[mood]; g.strokeStyle = "#14121E"; g.lineWidth = 2;
  g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2); g.fill(); g.stroke();
  if (big) {
    g.strokeStyle = "#FFFFFF"; g.fillStyle = "#FFFFFF"; g.lineWidth = 1.6; g.lineCap = "round"; g.lineJoin = "round";
    const m = s / 2;
    g.beginPath();
    if (mood === "waiting" || mood === "error") { g.moveTo(m, 4.5); g.lineTo(m, 10); g.stroke(); g.beginPath(); g.arc(m, 13, 1.1, 0, Math.PI * 2); g.fill(); }
    else if (mood === "done") { g.moveTo(5, 9.5); g.lineTo(8, 12.5); g.lineTo(13, 6); g.stroke(); }
    else if (mood === "offline") { g.moveTo(6, 6); g.lineTo(12, 6); g.lineTo(6, 12); g.lineTo(12, 12); g.stroke(); }
    else if (kind === "web") { g.arc(m, m, 4.6, 0, Math.PI * 2); g.moveTo(m - 4.6, m); g.lineTo(m + 4.6, m); g.moveTo(m, m - 4.6); g.quadraticCurveTo(m + 3.2, m, m, m + 4.6); g.stroke(); }
    else if (kind === "read") { g.moveTo(m, 6); g.lineTo(m, 12.5); g.moveTo(m, 6); g.lineTo(4.5, 5.5); g.lineTo(4.5, 12); g.lineTo(m, 12.5); g.lineTo(13.5, 12); g.lineTo(13.5, 5.5); g.closePath(); g.stroke(); }
    else if (kind === "shell") { g.moveTo(5, 6.5); g.lineTo(8, 9); g.lineTo(5, 11.5); g.moveTo(9.5, 12); g.lineTo(13, 12); g.stroke(); }
    else if (kind === "plan") { for (const y of [6.5, 9, 11.5]) { g.moveTo(5, y); g.lineTo(13, y); } g.stroke(); }
    else if (kind === "write") { g.moveTo(5.5, 12.5); g.lineTo(12, 6); g.moveTo(5, 13); g.lineTo(7.5, 12.5); g.stroke(); }
    else { for (const x of [6, 9, 12]) { g.beginPath(); g.arc(x, m, 1.2, 0, Math.PI * 2); g.fill(); } } // düşünüyor: üç nokta
  }
  return labelPut(cache, k, c);
}

type Rect = [number, number, number, number];
const hits = (a: Rect, list: Rect[]) => list.some((b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]);
/** "Hepsi" modunda bile ekranda bu kadar çok ajan varsa boştakilerin adı çizilmez (yalnızca rozet). */
const DENSE = 12;
const PILL_MAX = 40;
/** ölçülen HUD kutusuna eklenen pay (px): kutu ~200 ms'de bir ölçülür, arada ajan yürüyebilir */
const HUD_PAD = 6;
const XP_MAX = 4;

interface Cand { ch: Ch; pri: number; bubble: boolean }

const NO_SIGNS: WorldSign[] = [];
/** S38 tabela etiketleri: ekip adı bu kamera uzaklığına dek, bölge adı daha yakına dek ("Minimal"de yalnız yakında). */
const SIGN_FAR = { team: 46, place: 34, minimal: 22 };
const SIGN_MAX = 18;
const _sv = new THREE.Vector3();

/** Tabela etiketi: koyu zemin, solda renk karesi (ekip rengi / bölge için gri), Pixelify yazı. */
function signBitmap(cache: Map<string, HTMLCanvasElement>, text: string, color: string, team: boolean): HTMLCanvasElement {
  const k = `sign|${text}|${color}|${team ? 1 : 0}`;
  const hit = labelGet(cache, k);
  if (hit) return hit;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = team ? LABEL_FONT : CAP_FONT;
  ctx.font = font;
  const t = text.length > 24 ? `${text.slice(0, 23)}…` : text;
  const tw = Math.ceil(ctx.measureText(t).width);
  const w = tw + 30, hh = team ? 24 : 20;
  c.width = w * dpr; c.height = hh * dpr;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = team ? "rgba(20,18,30,0.86)" : "rgba(20,18,30,0.72)";
  ctx.strokeStyle = team ? color : "rgba(255,255,255,0.35)";
  ctx.lineWidth = team ? 2 : 1;
  ctx.beginPath(); ctx.roundRect(1, 1, w - 2, hh - 2, team ? 4 : 10); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color;
  if (team) ctx.fillRect(8, hh / 2 - 4, 8, 8);
  else { ctx.beginPath(); ctx.arc(12, hh / 2, 3.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = team ? "#FFFFFF" : "#E6E2F0";
  ctx.font = font; ctx.textBaseline = "middle";
  ctx.fillText(t, 22, hh / 2 + 1);
  return labelPut(cache, k, c);
}

const Z_MAX = 24;
const Z_FONTS: string[] = Array.from({ length: 40 }, (_, px) => `600 ${px}px 'Pixelify Sans Variable', system-ui, sans-serif`);
const zFont = (px: number) => Z_FONTS[Math.max(6, Math.min(39, Math.round(px)))];
function drawSleepZ(ctx: CanvasRenderingContext2D, list: Ch[], hud: Set<string>, focusTeam: string | null, w: number, h: number, k: number, pxu: number) {
  const calm = reducedMotion() || prefersReducedMotion();
  const now = performance.now() / 1000;
  let n = 0;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(30,27,46,0.85)"; ctx.fillStyle = "#ECE8FF";
  for (const ch of list) {
    if (n >= Z_MAX) break;
    if (ch.lod !== "near" || ch.path.length || hud.has(ch.slug) || !(LYING.has(ch.motion) || ch.motion === "slump")) continue;
    if (focusTeam && ch.dim) continue;
    n++;
    const s = Math.min(1.3, Math.max(0.6, k / Math.max(1, ch.dist)));
    const x = ((ch.sx + 1) / 2) * w, y0 = (1 - (ch.sy + 1) / 2) * h - (0.35 * ch.scale * HS * pxu) / Math.max(1, ch.dist);
    if (calm) {
      ctx.globalAlpha = 0.9; ctx.font = zFont(13 * s);
      ctx.strokeText("z", x + 8 * s, y0 - 12 * s); ctx.fillText("z", x + 8 * s, y0 - 12 * s);
      continue;
    }
    for (let i = 0; i < 3; i++) {
      const u = ((now / 2.8 + i / 3 + ch.seed) % 1 + 1) % 1;
      ctx.globalAlpha = (u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85) * 0.95;
      ctx.font = zFont((10 + u * 9) * s);
      const xx = x + (6 + u * 14 + Math.sin(u * 6 + i * 2) * 3) * s, yy = y0 - (6 + u * 32) * s;
      const g = i === 2 ? "Z" : "z";
      ctx.strokeText(g, xx, yy); ctx.fillText(g, xx, yy);
    }
  }
  ctx.globalAlpha = 1; ctx.textAlign = "start";
}

function drawLabels(canvas: HTMLCanvasElement | null, list: Ch[], hud: Set<string>, w: number, h: number, fov: number,
  cache: Map<string, HTMLCanvasElement>, focusTeam: string | null, live: WorldLive, chars: Map<string, Ch>, mode: LabelMode,
  signs: WorldSign[] = NO_SIGNS, cam?: THREE.Camera, hide: ((ch: Ch) => boolean) | null = null) {
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = Math.round(w * dpr), chh = Math.round(h * dpr);
  if (canvas.width !== cw || canvas.height !== chh) { canvas.width = cw; canvas.height = chh; canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const k = 20 / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2))); // drei Html distanceFactor=20 ile aynı ölçek
  const pxu = h / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
  const head = (ch: Ch) => {
    const x = ((ch.sx + 1) / 2) * w;
    const y = (1 - (ch.sy + 1) / 2) * h - (1.15 * ch.scale * HS * pxu) / Math.max(1, ch.dist);
    return [x, y] as const;
  };
  // 1) yer ayırma: tam HUD'u olan (seçili / üzerine gelinen / seni bekleyen) ajanların ölçülen kutusu (World.tsx HudDeclutter,
  //    ~5/sn; aradaki yürümeye pay bırakılır), ölçülmemişse kaba dikdörtgen
  const placed: Rect[] = [];
  let visible = 0;
  for (const ch of list) {
    if (ch.lod === "off") continue;
    visible++;
    if (!hud.has(ch.slug)) continue;
    const m = live.hudRects.get(ch.slug);
    if (m) { placed.push([m[0] - HUD_PAD, m[1] - HUD_PAD, m[2] + HUD_PAD, m[3] + HUD_PAD]); continue; }
    const s = Math.min(1.6, k / Math.max(1, ch.dist));
    const [x, y] = head(ch);
    placed.push([x - 100 * s, y - 92 * s, x + 100 * s, y + 6]);
  }
  // 2) adaylar: önceliğe göre (konuşan > ekip odağı > Hepsi modunda çalışanlar (yakından uzağa) > boştakiler)
  const dense = visible > DENSE;
  const cands: Cand[] = [];
  for (const ch of list) {
    if (ch.lod !== "near" || hud.has(ch.slug)) continue;
    if (focusTeam && ch.dim) continue;
    if (hide?.(ch)) continue; // UXF-D: duvarın ardında
    const talking = !!ch.meet && ch.meet.phase === "talk" && live.talking.has(ch.slug);
    const busy = ch.wa.mood === "working" || ch.wa.mood === "thinking" || ch.wa.mood === "waiting";
    let pri = -1;
    if (talking) pri = 1;
    else if (focusTeam && (ch.wa.agent.team ?? null) === focusTeam && ch.px >= LABEL_PX) pri = 2;
    else if (mode === "all" && ch.px >= LABEL_PX && (busy || !dense)) pri = busy ? 3 : 4;
    // W2: yürüme modunda avatarın yakınındaki ajanların adı her etiket modunda çizilir (uzaktakiler rozet kalır)
    else if (walkRuntime.live && Math.hypot(ch.pos.x - walkRuntime.avatar.x, ch.pos.z - walkRuntime.avatar.z) <= WALK_LABEL_R) pri = 3;
    if (pri >= 0) cands.push({ ch, pri, bubble: talking });
  }
  cands.sort((a, b) => a.pri - b.pri || a.ch.dist - b.ch.dist);
  const pill = new Set<Ch>();
  let nDraw = 0; // ertelenen etiket çizimleri kalıcı kayıtlara (etiket başına kapanış yok)
  for (const c of cands) {
    if (pill.size >= PILL_MAX) break;
    const ch = c.ch;
    const scale = Math.min(1.6, k / Math.max(1, ch.dist));
    const talking = c.bubble;
    const flags = (talking ? 1 : 0) | (ch.errand || ch.fun ? 2 : 0) | (ch.errand?.kind === "meal" ? 4 : 0);
    if (ch.capWa !== ch.wa || ch.capFlags !== flags || ch.bmpDim !== ch.dim || !ch.bmp) {
      ch.capWa = ch.wa; ch.capFlags = flags; ch.bmpDim = ch.dim;
      ch.caption = worldCaption(ch.wa.mood, ch.wa.tool, ch.wa.activity, { talking, onBreak: !!ch.errand || !!ch.fun, meal: ch.errand?.kind === "meal" });
      ch.bmp = labelBitmap(cache, ch.wa.agent.name, ch.wa.agent.color, ch.wa.mood, ch.dim, ch.caption, ch.conn);
    }
    let bmp = ch.bmp;
    let bw = (bmp.width / dpr) * scale, bh = (bmp.height / dpr) * scale;
    const [x, y] = head(ch);
    let rect: Rect = [x - bw / 2, y - bh, x + bw / 2, y];
    // çakışırsa önce kısalt: etkinlik fiili düşer, yalnızca ad kalır ("seni bekliyor" ve konuşma balonu kısaltılmaz)
    if (ch.caption && !talking && ch.wa.mood !== "waiting" && hits(rect, placed)) {
      const short = labelBitmap(cache, ch.wa.agent.name, ch.wa.agent.color, ch.wa.mood, ch.dim, "", ch.conn);
      const sw = (short.width / dpr) * scale, sh = (short.height / dpr) * scale;
      const r2: Rect = [x - sw / 2, y - sh, x + sw / 2, y];
      if (!hits(r2, placed)) { bmp = short; bw = sw; bh = sh; rect = r2; }
    }
    let bub: { img: HTMLCanvasElement; r: Rect } | null = null;
    if (talking) {
      const img = bubbleBitmap(cache, live.talking.get(ch.slug) ?? "");
      const sw = (img.width / dpr) * scale, sh = (img.height / dpr) * scale;
      bub = { img, r: [x - sw / 2, y - bh - sh - 2, x + sw / 2, y - bh - 2] };
    }
    // çakışan düşük öncelikli etiket çizilmez (rozete düşer); balon da yer bulamazsa gizlenir
    if (hits(rect, placed) || (bub && hits(bub.r, placed))) continue;
    placed.push(rect);
    if (bub) placed.push(bub.r);
    pill.add(ch);
    const d = PILL_DRAWS[nDraw++] ??= { bmp, rect, bw: 0, bh: 0, bub: null };
    d.bmp = bmp; d.rect = rect; d.bw = bw; d.bh = bh; d.bub = bub;
  }
  // 3) rozetler: yakındaki (uzakta LOD: çizilmez; ekip rengi zemin karolarında kalır), etiketlerle çakışmayanlar
  const dots: Rect[] = [];
  for (const ch of list) {
    if (ch.lod !== "near" || hud.has(ch.slug) || pill.has(ch)) continue;
    if (focusTeam && ch.dim) continue;
    if (hide?.(ch)) continue; // UXF-D
    const img = dotBitmap(cache, ch.wa.mood, ch.wa.mood === "working" || ch.wa.mood === "thinking" ? ch.curKind : null, ch.dim);
    const s = Math.min(1.25, Math.max(0.7, k / Math.max(1, ch.dist)));
    const dw = (img.width / dpr) * s, dh = (img.height / dpr) * s;
    const [x, y] = head(ch);
    const r: Rect = [x - dw / 2, y - dh - 2, x + dw / 2, y - 2];
    if (hits(r, placed)) continue;
    ctx.drawImage(img, r[0], r[1], dw, dh);
    dots.push(r);
  }
  // 3b) S38 tabelalar (ekip / bölge adı): en düşük öncelik — ajan etiketi, HUD ya da rozetle çakışırsa, uzaktaysa çizilmez
  if (signs.length && cam && !focusTeam) {
    let n = 0;
    for (const s of signs) {
      if (n >= SIGN_MAX) break;
      const dist = cam.position.distanceTo(_sv.set(s.x, s.y, s.z));
      const far = mode === "minimal" ? SIGN_FAR.minimal : s.kind === "team" ? SIGN_FAR.team : SIGN_FAR.place;
      if (dist > far) continue;
      _sv.project(cam);
      if (_sv.z > 1 || Math.abs(_sv.x) > 1.05 || Math.abs(_sv.y) > 1.05) continue;
      const text = s.text ?? (s.label ? msg(M, s.label as keyof typeof M.tr) : "");
      if (!text) continue;
      const img = signBitmap(cache, text, s.color, s.kind === "team");
      const sc = Math.min(1.1, Math.max(0.7, k / Math.max(1, dist)));
      const bw = (img.width / dpr) * sc, bh = (img.height / dpr) * sc;
      const x = ((_sv.x + 1) / 2) * w, y = (1 - (_sv.y + 1) / 2) * h;
      const r: Rect = [x - bw / 2, y - bh, x + bw / 2, y];
      if (hits(r, placed) || hits(r, dots)) continue;
      placed.push(r);
      n++;
      ctx.globalAlpha = s.kind === "team" ? 0.95 : 0.85;
      ctx.drawImage(img, r[0], r[1], bw, bh);
      ctx.globalAlpha = 1;
    }
  }
  // 3c) S43: uyuyanların üstünde yükselip sönen "z z Z" (yakında, HUD'suz, en çok Z_MAX); hareket azaltmada tek, durağan "z"
  drawSleepZ(ctx, list, hud, focusTeam, w, h, k, pxu);
  for (let i = 0; i < nDraw; i++) {
    const { bmp, rect, bw, bh, bub } = PILL_DRAWS[i];
    ctx.drawImage(bmp, rect[0], rect[1], bw, bh);
    if (bub) ctx.drawImage(bub.img, bub.r[0], bub.r[1], bub.r[2] - bub.r[0], bub.r[3] - bub.r[1]);
    PILL_DRAWS[i].bub = null;
  }
  // 4) +XP baloncukları (oyun katmanı görünürken; aynı anda en çok XP_MAX, ajan başına birleştirilmiş;
  //    hareket azaltmada yükselmeden solar)
  if (xpPops.length) {
    const now = Date.now();
    const show = isGameVisible() && useGame.getState().profile?.celebrations !== false;
    const calm = reducedMotion() || prefersReducedMotion();
    let drawn = 0;
    for (let i = xpPops.length - 1; i >= 0; i--) {
      const pop = xpPops[i];
      const age = (now - pop.ts) / 1800;
      if (age >= 1) { xpPops.splice(i, 1); continue; }
      const ch = chars.get(pop.slug);
      if (!show || !ch || ch.lod !== "near" || drawn >= XP_MAX) continue;
      drawn++;
      const [x, y] = head(ch);
      const lift = ((0.35 + (calm ? 0 : age * 0.8)) * ch.scale * HS * pxu) / Math.max(1, ch.dist);
      ctx.globalAlpha = age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3;
      ctx.font = "600 16px 'Pixelify Sans Variable', system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 4; ctx.strokeStyle = "#1E1B2E";
      const label = msg(M, "xp_pop", { n: pop.amount });
      ctx.strokeText(label, x, y - 24 - lift);
      ctx.fillStyle = "#F2B33D";
      ctx.fillText(label, x, y - 24 - lift);
      ctx.globalAlpha = 1; ctx.textAlign = "start";
    }
  }
}
