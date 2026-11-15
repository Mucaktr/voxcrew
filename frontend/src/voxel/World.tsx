/**
 * Ajan dünyası: seçilen voxel sahne + ajan karakterleri. Her ajan gerçek durumuna göre davranır:
 *   boşta → masasında oturur, ara sıra kahve/kanepe molası (S33) · düşünüyor/çalışıyor → masasında sandalyede
 *   (yazıyor/düşünüyor) · araç kullanıyor → aracın istasyonuna yürür
 *   (web → pencere/teleskop, okuma → kitaplık, kabuk → terminal, plan → tahta) · onay → el sallar
 *   teslim → çıktıyı parşömenle sonraki ajana götürür · bitti → zıplar · hata → başını sallar · yok → uyur
 * Faz 5 (S13, 100+ ajan): karakterler Crowd.tsx'te InstancedMesh ile çizilir (malzeme sınıfı başına tek çizim),
 * uzakta LOD, ekran dışında güncelleme yok. HUD (drei Html) yalnızca yakın/seçili/çalışan/onay bekleyen ajanlarda;
 * diğerleri 2B tuvalde hafif ad etiketi alır. Dünya ajan sayısıyla modüller hâlinde büyür (scenes.ts); kamera
 * kaydırma/yakınlaştırma sınırları ölçeğe uyar; ekip bölgeleri örneklenmiş karolardır. Sabit portal (React 19) korunur.
 */
import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
  type ComponentRef, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type ReactNode, type RefObject,
} from "react";
import * as THREE from "three";
import { AgentHud } from "../components/world/AgentHud";
import { connKind, useWorldFx, useWorldTalk, worldCaption, type WorkInfo } from "../components/world/activity";
import { tx } from "../lib/i18n";
import { useGameAgent, useGameEnabled, useWorldBadges } from "../lib/game";
import { ensureCosmetics, useDressedAgents, useDressedMe, useLiveEquip } from "../lib/cosmetics";
import { ensureCityPacks } from "../lib/citypacks";
import { shortTitle } from "../lib/office";
import type { Avatar, Handoff, Mood } from "../lib/types";
import { world as M } from "../locales/world";
import { Ambient } from "./ambient/Ambient";
import { Blocks } from "./Blocks";
import { sunNormalBias } from "./zfight"; // RENDER-FIX: gölge sivilcesi (normal kayması gölge texeline göre)
import { SunFollow } from "./SunFollowLayer"; // şehirde gölge kutusu kamerayı izler (texel'e oturtulmuş)
import { Outskirts } from "./expanse/Outskirts";
import type { Accessory } from "./Character";
import { Crowd, type AgentPlan, type WorldSign } from "./Crowd";
import { CosmeticWorldLayer } from "./cosmetics/WorldLayer";
import { GiftShelfLayer } from "./cosmetics/GiftShelfLayer";
import { GoalFlag, LEVELUP_MS, LevelUpFx } from "./Effects";
import { WaterFx } from "./WaterFx";
import { createLive, type WorldLive } from "./live";
import { reducedMotion, useReducedMotion } from "./motion";
import { Props } from "./props/Props";
import { SceneFx } from "./props/SceneFx";
import { climateOf, seasonNow, setSeasonTint, useSceneNight, useWeatherFx } from "./props/weather";
import { canopyTint } from "./city/kit";
import { setQuietZone } from "./fun/brain";
import { isInSacredBuffer, zoneDistance } from "./city/sacred";
import { coffeeReach } from "./reach";
import { useScenePreview } from "../components/world/scenePreview";
import { walk as WM } from "../locales/walk";
import { baseOffset, tileAt } from "./walk/controller";
import { InteriorRig } from "./interiors/InteriorRig";
import { exploreMarkerBlocks } from "./interiors/placement";
import { useInterior } from "./interiors/store";
import { cityForScene } from "./citymap/catalog";
import { CityDoorWatcher, CityRig } from "./citymap/CityRig";
import { ProgramGate } from "./programGate";
import { flushDiff, resetShadow } from "./instanceDirty";
import { nightHemiArgs } from "./props/nightLight"; // UXF-G
import { groundPlaneY } from "./interiors/sceneModel"; // HQA-FIX5-B0
import { fillLight } from "./props/fillLight";
import { CityLife } from "./citylife/CityLife";
import { CityWaterTaps } from "./citymap/CityWaterTaps";
import { oceanGeometry, oceanMaterial } from "./citymap/farWater";
import { officeDoor, officeDoorBlocks } from "./citymap/door";
import { NIGHT_FOG_K } from "./citymap/viewDistance"; // TOUR-VIEW
import { hiresSceneSplit } from "./hires/items"; // LANDMARK-HIRES
import { HiResSceneLayer } from "./hires/HiResLayer"; // LANDMARK-HIRES
import { useCity } from "./citymap/store";
import { attachWalkKeyboard, IDLE_KEYSHORTCUTS, WALK_KEYSHORTCUTS } from "./walk/input";
import { useMeLook, type MeLook } from "./walk/me";
import { spawnPose, walkGates, WalkRig } from "./walk/WalkRig";
import { FrameLift } from "./walk/FrameLift";
import { useWalkEntities } from "../components/world/walk/entities";
import { WalkPanelAnchor } from "../components/world/walk/WalkPanelAnchor";
import { useWalkActive, useWalkStore } from "./walk/walkStore";
import { exhibitLayout, pickExhibit, type WorldExhibit } from "./worktrace/exhibits"; // arşiv sırası (+0 çizim çağrısı)
import { savedWalkPosition } from "../lib/walk";
import { ensureWorkZones, useWorkZones, useZoneRequests } from "../lib/workZones"; // WORK-ZONES (plan §5 C2): işe gidiş
import { assignZoneSeats, withOffices } from "./workzones/world";
import { zoneDraw } from "./workzones/venues"; // şehirde ekip alanı mekândır (renkli zemin/direkli pano yok)
import {
  assignSeats, buildWorld, D, freeTiles, key, sceneDef, toolKind, tx as tileX, tz, W, worldBounds, worldDemand,
  type Block, type Built, type SceneCore, type Light, type Station, type ToolKind, type WorldSceneId,
} from "./scenes";

/** Dünyada çizilen karakterin kimliği: stüdyo ajanı (`Agent` bu şekle uyar) ya da harici oturum. */
export interface WorldIdentity {
  slug: string;
  name: string;
  color: string;
  avatar?: Partial<Avatar> | null;
  title?: string | null;
  team?: string | null;
  /** S33: bağlayıcı simgesi için (stüdyo ajanının `route` alanı bu şekle uyar) */
  route?: { connection?: string | null; connector?: string | null } | null;
}

export interface WorldAgent {
  agent: WorldIdentity;
  mood: Mood;
  activity: string;
  tool?: string | null;
  /** HUD'un ikinci katmanı (aşama hattı, adım, süre…); çalışmıyorsa null */
  work?: WorkInfo | null;
  /** harici oturum: kaynak etiketi, aksesuar; alt ajan küçük çizilir */
  external?: { label: string; color: string; accessory: Accessory; small: boolean } | null;
}

/** Hedef çalışması sürerken bayrak dikilecek yer: ekip bölgesi (yoksa ajanın masası). */
export interface GoalMarker { key: string; team?: string | null; agent?: string | null; label: string }

export interface WorldHandle {
  resetCamera: () => void;
  /** kamerayı ajana odaklar (yumuşak geçiş) */
  focusAgent: (slug: string) => void;
  /** kamera hedefini dünya koordinatına taşır (mini harita tıklaması) */
  panTo: (x: number, z: number) => void;
  /** ekibin tabelalı bölgesine gider */
  focusTeam: (slug: string) => void;
  zoom: (factor: number) => void;
  /** W2: yürüme moduna gir (kayıtlı konum verilirse orası, yoksa doğma karosu); sahne önizlemesinde yok sayılır */
  walkEnter: (saved?: { x: number; z: number } | null) => void;
  /** W2: yürüme modundan çık; odak dünya kabına döner */
  walkExit: () => void;
  /** W2: yürüme modunda oraya yürü (dünya koordinatı; mini harita, Yakındakiler) */
  walkTo: (x: number, z: number) => void;
  /** W2: dünya kabına klavye odağı ver (yürüme tuşları kap odaktayken çalışır) */
  focusWorld: () => void;
}

/** Ofis ekibi (S3): masaların altındaki renkli bölge ve tabela için. */
export interface WorldTeam { slug: string; name: string; color: string; lead?: string | null; order?: number }

export type HoverHandler = (slug: string | null, at?: { x: number; y: number }) => void;

export interface PerfSample { ms: number; p95: number; calls: number; triangles: number; agents: number; crowdMs: number }

interface Props {
  scene: WorldSceneId;
  agents: WorldAgent[];
  selected: string | null;
  onSelect: (slug: string | null) => void;
  handoffs?: Handoff[];
  teams?: WorldTeam[];
  onTeamClick?: (slug: string) => void;
  /** imleç bir karakterin üstüne geldi/ayrıldı (istemci koordinatı) — bilgi kartı için */
  onHover?: HoverHandler;
  hovered?: string | null;
  goals?: GoalMarker[];
  /** ekip filtresi: diğer ekipler soluk */
  focusTeam?: string | null;
  /** canlı durum (mini harita, ajan bul); verilmezse içeride oluşturulur */
  live?: WorldLive;
  /** ölçüm modu: kare süresi ve çizim çağrısı örnekleri (≈ 4 Hz) */
  onPerf?: (s: PerfSample) => void;
  /** W2: yürüme modunda F / Enter / Boşluk (etkileşim ipucunun hedefi; W3'e dek ajan kartı / profil çekmecesi) */
  onInteract?: (id: string) => void;
  /** kabul edilen işlerin arşiv sırası (yalnız başlık; ofis tabanında, iç mekân/şehirde yok) ve tıklama*/
  exhibits?: WorldExhibit[];
  exhibitLabels?: { desk: string; forgotten: string };
  onExhibit?: (id: string) => void;
  /** UXF-D: kurulmuş dış dünya değişince (mini harita coğrafya katmanı)*/
  onBuilt?: (b: Built) => void;
}

const BUBBLE: Record<Mood, string> = {
  idle: "", thinking: "💭", working: "⌨️", waiting: "❓", done: "✨", error: "⚠️", offline: "💤",
};
const TOOL_ICON: Record<ToolKind, string> = { web: "🌐", read: "📚", shell: "🖥️", plan: "📋", write: "✍️" };

function FlickerLight({ l }: { l: Light }) {
  const ref = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (ref.current && l.flicker) {
      const t = clock.elapsedTime;
      ref.current.intensity = reducedMotion() ? l.intensity * 0.9 : l.intensity * (0.85 + Math.sin(t * 11) * 0.08 + Math.sin(t * 23.7) * 0.07);
    }
  });
  return <pointLight ref={ref} position={l.pos} color={l.color} intensity={l.intensity} distance={l.distance} decay={1.6} />;
}

/** Seçili ajanın altındaki halka: konumu canlı durumdan izler. */
function SelectRing({ slug, color, live }: { slug: string; color: string; live: WorldLive }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current, p = live.positions.get(slug);
    if (!g || !p) return;
    g.position.set(p.x, 0.02, p.z);
    g.scale.setScalar(reducedMotion() ? 1 : 1 + Math.sin(clock.elapsedTime * 4) * 0.06);
  });
  return (
    <group ref={ref} position={[0, 0.02, 0]}>
      {[[0, 0.42, 0.9, 0.08], [0, -0.42, 0.9, 0.08], [0.42, 0, 0.08, 0.9], [-0.42, 0, 0.08, 0.9]].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 0, z]}>
          <boxGeometry args={[w, 0.03, d]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

const LEAD_GOLD = "#F2B33D";
/** S33 gece modu: gökyüzü/sis rengi; kapalı mekânlarda yıldız çizilmez; sandalye tarzı. */
const NIGHT_SKY = "#121829";
const INDOOR = new Set<string>(["office", "home", "cafe", "mall", "space"]);
const OFFICE_CHAIR = new Set<string>(["office", "space", "mall", "yacht"]);

const seatCache = new WeakMap<Built, Set<string>>();
/** Oturulabilir dinlenme karoları: arkadaki (+z) engelli karoda üst yüzü 0,38–0,66 birimde, en az 0,8 geniş bir oturak
 *  (kanepe, bank) varsa. Bloklardan türetilir; yerleşik ve kullanıcı dünyalarında aynı çalışır. */
function seatTiles(built: Built): Set<string> {
  let out = seatCache.get(built);
  if (out) return out;
  out = new Set<string>();
  const want = new Map<string, string>();
  for (const [i, j] of built.rest) if (built.blocked.has(key(i, j + 1))) want.set(key(i, j + 1), key(i, j));
  if (want.size) {
    for (const b of built.blocks) {
      const top = b.p[1] + b.s[1] / 2;
      if (top < 0.38 || top > 0.66 || b.s[0] < 0.8 || b.s[2] < 0.4) continue;
      // oturak birden çok karoya yayılabilir (kanepe 3, bank 2 karo)
      for (let x = b.p[0] - b.s[0] / 2 + 0.25; x < b.p[0] + b.s[0] / 2; x += 0.5) {
        const k = key(Math.floor(x + W / 2), Math.floor(b.p[2] + D / 2));
        const rest = want.get(k);
        if (rest) out.add(rest);
      }
    }
  }
  seatCache.set(built, out);
  return out;
}
const unit = new THREE.BoxGeometry(1, 1, 1);

interface Zone { id: string; station: Station; team: WorldTeam; lead: boolean; sign: boolean }

/** Ekip bölgesi karoları, tek seferde: dolgu (ekip rengi, saydam) + kenar çerçeveleri (ekip rengi / lider altın).
 *  Ekipte onay bekleyen biri varsa bölge nabız gibi atar (hareket azaltmada durağan, daha dolgun). */
const PULSE_WHITE = new THREE.Color("#FFFFFF");
function ZoneTiles({ zones, waitingTeams }: { zones: Zone[]; waitingTeams: Set<string> }) {
  const fill = useRef<THREE.InstancedMesh>(null);
  const rim = useRef<THREE.InstancedMesh>(null);
  const fillMat = useMemo(() => new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.38, depthWrite: false }), []);
  const rimMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  useEffect(() => () => { fillMat.dispose(); rimMat.dispose(); }, [fillMat, rimMat]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), c: new THREE.Color() }), []);
  const RIMS: [number, number, number, number][] = [[0, 0.46, 0.96, 0.06], [0, -0.46, 0.96, 0.06], [0.46, 0, 0.06, 0.96], [-0.46, 0, 0.06, 0.96]];
  const write = (z: Zone, i: number, k: number) => {
    const f = fill.current, r = rim.current;
    if (!f || !r) return;
    const x = tileX(z.station.tile[0]), zz = tz(z.station.tile[1]);
    const h = z.lead ? 0.09 : 0.025;
    const { m, p, q, s, c } = tmp;
    q.identity();
    m.compose(p.set(x, h / 2 + 0.004, zz), q, s.set(0.96, h, 0.96));
    f.setMatrixAt(i, m);
    c.set(z.team.color);
    if (k > 0) c.lerp(PULSE_WHITE, 0.35 * k); // her nabız karesinde Color kopyası yoktu
    f.setColorAt(i, c);
    const rs = 1 + 0.07 * k;
    RIMS.forEach(([dx, dz, w, d], j) => {
      m.compose(p.set(x + dx * rs, h + 0.012, zz + dz * rs), q, s.set(w * rs, 0.012, d * rs));
      r.setMatrixAt(i * 4 + j, m);
      r.setColorAt(i * 4 + j, c.set(z.lead ? LEAD_GOLD : z.team.color));
    });
  };
  const pulsing = useRef(new Set<number>());
  useEffect(() => {
    zones.forEach((z, i) => write(z, i, 0));
    const f = fill.current, r = rim.current;
    if (f) { f.count = zones.length; f.instanceMatrix.needsUpdate = true; if (f.instanceColor) f.instanceColor.needsUpdate = true; }
    if (r) { r.count = zones.length * 4; r.instanceMatrix.needsUpdate = true; if (r.instanceColor) r.instanceColor.needsUpdate = true; }
    // tam yükleme yapıldı → fark kopyaları sıfırlanır (sonraki nabız karesi tam yükler; aynı karede aralık kalmaz)
    for (const a of [f?.instanceMatrix, f?.instanceColor, r?.instanceMatrix, r?.instanceColor]) if (a) { a.clearUpdateRanges(); resetShadow(a); } // kalan aralık tam yüklemeyi kısmi yapardı
    pulsing.current.clear();
  }, [zones]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(({ clock }) => {
    const f = fill.current, r = rim.current;
    if (!f || !r) return;
    const calm = reducedMotion();
    const k = calm ? 0.6 : 0.5 + 0.5 * Math.sin(clock.elapsedTime * 5.5);
    let touched = false;
    zones.forEach((z, i) => {
      const on = waitingTeams.has(z.team.slug);
      if (on) { write(z, i, k); pulsing.current.add(i); touched = true; }
      else if (pulsing.current.has(i)) { write(z, i, 0); pulsing.current.delete(i); touched = true; }
    });
    if (touched) {
      // yalnız gerçekten değişen yuvalar GPU'ya (nabızda dolgu matrisi ve kenar rengi sabit: hiç yüklenmez; aradaki bekleyen
      // olmayan bölgeler de yüklenmez). [ilk, son] aralığı yerine fark tabanlı (instanceDirty.flushDiff)
      flushDiff(f.instanceMatrix, 16); if (f.instanceColor) flushDiff(f.instanceColor, 3);
      flushDiff(r.instanceMatrix, 16); if (r.instanceColor) flushDiff(r.instanceColor, 3);
    }
  });
  const cap = Math.max(1, zones.length);
  return (
    <>
      <instancedMesh key={`f${cap}`} ref={fill} args={[unit, fillMat, cap]} frustumCulled={false} receiveShadow />
      <instancedMesh key={`r${cap}`} ref={rim} args={[unit, rimMat, cap * 4]} frustumCulled={false} />
    </>
  );
}

/** (inceleme 2026-11-03): şehirde renkli zemin yok; onay bekleyen ekip yine dünyada okunur. Büyümüş dünyada mekân
 * tabelasının önünde altın parıltı (`venue`: tabela merkezi), taban dünyada ekibin ilk masasının zemininde ince altın halka (`ring`).
 * Ekip rengi değil; nabız `ZoneTiles` ile aynı ritim, hareket azaltmada durağan. Bekleyen yoksa hiçbir şey çizilmez.*/
const WAIT_GOLD = "#FBBF24";
function WaitCues({ venue, ring }: { venue: [number, number, number][]; ring: [number, number][] }) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: WAIT_GOLD, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock }) => { mat.opacity = reducedMotion() ? 0.5 : 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 5.5)); });
  if (!venue.length && !ring.length) return null;
  return (
    <>
      {venue.map(([x, y, z], i) => <mesh key={`v${i}`} position={[x, y, z]} material={mat}><planeGeometry args={[1.36, 0.78]} /></mesh>)}
      {ring.map(([x, z], i) => <mesh key={`r${i}`} position={[x, 0.03, z]} rotation={[-Math.PI / 2, 0, 0]} material={mat}><ringGeometry args={[0.4, 0.48, 24]} /></mesh>)}
    </>
  );
}

/** Html etiket ölçeği: varsayılan kamerada ad etiketi ~16 px, balon ~12 px görünsün. */
const LABEL_DISTANCE = 20;

/** Ekip tabelası: istasyonun arka köşesinde direk + renkli pano. Tıklayınca Ofis'te ekip kartı açılır. S38: ekip adı 2B etiket
 * tuvalinde düşük öncelikle çizilir (Crowd.tsx `drawLabels`); bölgeli dünyada tabela bloklara pişmiştir (`baked`). taban
 * (büyümemiş) dünyada da tabela parçaları `teamSignBlocks` ile sahne bloklarının malzeme gruplarına katılır; iki durumda da
 * burada yalnızca görünmez tıklama hedefi kalır (çizim çağrısı eklemez, ekip sayısından bağımsız).*/
function TeamSign({ pos, team, baked, onClick }:
  { pos: [number, number, number]; team: WorldTeam; baked: boolean; onClick?: (slug: string) => void }) {
  const [x, y, z] = pos;
  // W2: yürüme modunda tabela tıklaması zemine geçer (tıkla-git); Ofis'e gidilmez
  const click = (e: ThreeEvent<MouseEvent>) => { if (walking()) return; e.stopPropagation(); onClick?.(team.slug); };
  return (
    <group position={[x, 0, z]} onClick={click}
      onPointerOver={(e) => { e.stopPropagation(); if (onClick) document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { document.body.style.cursor = ""; }}>
      {baked
        ? <mesh position={[0, y - 0.6, 0]}><boxGeometry args={[2.4, 1.4, 1.2]} /><meshBasicMaterial visible={false} /></mesh>
        : <mesh position={[0, 0.8, 0]}><boxGeometry args={[0.7, 1.6, 0.3]} /><meshBasicMaterial visible={false} /></mesh>}
    </group>
  );
}

/** taban dünya ekip tabelasının parçaları blok olarak (eskiden ekip başına 3–4 ayrı mesh + gölge geçişi): direk ve
 * ekip renkli pano `solid` (gölge düşürür), beyaz şerit `solid` (pişmiş tabela gibi, `districts/parts.ts`), lider küpü
 * sahnede parlayan grup varsa `glow`, yoksa `solid` (yeni malzeme grubu açılmasın). Ölçüler eski meshlerle aynı.*/
function teamSignBlocks(x: number, z: number, color: string, lead: boolean, leadGroup: Block["g"]): Block[] {
  const out: Block[] = [
    { p: [x, 0.55, z], s: [0.07, 1.1, 0.07], c: "#6B4F3A", g: "solid", j: 0 },
    { p: [x, 1.12, z], s: [0.62, 0.32, 0.06], c: color, g: "solid", j: 0 },
    { p: [x, 1.12, z + 0.032], s: [0.5, 0.2, 0.01], c: "#FFFDF8", g: "solid", j: 0 },
  ];
  if (lead) out.push({ p: [x, 1.36, z], s: [0.14, 0.14, 0.14], c: LEAD_GOLD, g: leadGroup, j: 0 });
  return out;
}

/** HUD sadeleştirme eşiği: kameradan bu uzaklıktan ötede ayrıntı satırı ve XP çubuğu gizlenir. */
const HUD_FAR = 34;

interface HudProps {
  wa: WorldAgent;
  live: WorldLive;
  overlay: RefObject<HTMLDivElement | null>;
  selected: boolean;
  hovered: boolean;
  dense: boolean;
  receiverName?: string;
  /** slug → HUD kökü: HudDeclutter çakışma sınaması için okur */
  registry: Map<string, HTMLDivElement>;
}

type Rect = [number, number, number, number];
const overlaps = (a: Rect, list: Rect[], pad: number) =>
  list.some((b) => a[0] < b[2] + pad && a[2] > b[0] - pad && a[1] < b[3] + pad && a[3] > b[1] - pad);
/** Çakışmada HUD'lar arası istenen boşluk (px); daha ayrıntılı kademeye geri dönmek için daha fazlası (titreme olmasın). */
const CROWD_PAD = 4;
const CROWD_HYST = 12;
/** yalnızca ad kalmış HUD'un komşusundan kaçmak için en çok yatay kaydırma (px) */
const NUDGE_MAX = 48;

/** HUD'lar arası ekran uzayı çakışma sınaması (saniyede ~5 kez, React yeniden çizimi yok). Öncelik: seçili > üzerine
 *  gelinen > kameraya yakın. Öncekilerle çakışan HUD kademe kademe sadeleşir (`data-crowd`): 1 → unvan/fiil, ayrıntı satırı,
 *  XP ve kaynak etiketi gizlenir; 2 → iş paneli/balon da gizlenir, yalnızca ad (+ seviye) kalır; o da değiyorsa en çok
 *  NUDGE_MAX px yana kayar. Seçili ve üzerine gelinen
 *  ajan hiç sadeleşmez ve üst z katmanındadır. Ölçülen kutular `live.hudRects`e yazılır; tuval etiketleri bunlardan kaçar. */
function HudDeclutter({ registry, live, overlay, selected, hovered }:
  { registry: Map<string, HTMLDivElement>; live: WorldLive; overlay: RefObject<HTMLDivElement | null>; selected: string | null; hovered: string | null }) {
  const at = useRef(0);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (t - at.current < 0.2) return;
    at.current = t;
    live.hudRects.clear();
    const root = overlay.current;
    if (!root || !registry.size) return;
    const o = root.getBoundingClientRect();
    const cam = state.camera.position;
    const order = [...registry].map(([slug, el]) => {
      const p = live.positions.get(slug);
      return { slug, el, pri: slug === selected ? 0 : slug === hovered ? 1 : 2, d: p ? cam.distanceTo(p) : Infinity };
    }).sort((a, b) => a.pri - b.pri || a.d - b.d);
    const placed: Rect[] = [];
    for (const { slug, el, pri } of order) {
      if (!el.isConnected || el.dataset.lod === "off") continue;
      const prev = Number(el.dataset.crowd ?? 0);
      let level = 0, cur = prev;
      let r: Rect;
      if (el.style.translate) el.style.translate = "";
      for (;;) {
        // öznitelik yalnız düzey değişince yazılır — aynı değeri her etikette yeniden yazmak bir sonraki ölçümde zorunlu yerleşim
        // (layout thrash) tetikliyordu; durağan karede okumalar tek yerleşimi paylaşır
        if (level !== cur) { if (level) el.dataset.crowd = String(level); else delete el.dataset.crowd; cur = level; }
        const b = el.getBoundingClientRect();
        r = [b.left - o.left, b.top - o.top, b.right - o.left, b.bottom - o.top];
        if (pri < 2 || level === 2 || !overlaps(r, placed, level < prev ? CROWD_HYST : CROWD_PAD)) break;
        level++;
      }
      // yalnızca ad kaldıysa ve hâlâ değiyorsa: çakıştığı kutulardan uzağa, kısa yatay kaydırma (daha uzaksa olduğu gibi kalır)
      if (level === 2 && overlaps(r, placed, CROWD_PAD)) {
        const hit = placed.filter((p) => overlaps(r, [p], CROWD_PAD));
        const left = Math.min(...hit.map((p) => p[0])) - CROWD_PAD - r[2], right = Math.max(...hit.map((p) => p[2])) + CROWD_PAD - r[0];
        const dx = Math.abs(left) < right ? left : right;
        if (Math.abs(dx) <= NUDGE_MAX) {
          // drei Html kutuyu uzaklığa göre ölçekler: ekran pikselini öğenin kendi CSS pikseline çevir
          const k = el.offsetWidth ? (r[2] - r[0]) / el.offsetWidth : 1;
          el.style.translate = `${(dx / (k || 1)).toFixed(1)}px 0`;
          r = [r[0] + dx, r[1], r[2] + dx, r[3]];
        }
      }
      if (r[2] > r[0]) { placed.push(r); live.hudRects.set(slug, r); }
    }
  });
  return null;
}

/** Ajan üstü gösterge: konumu canlı durumdan izleyen çapa + drei Html (sabit portal). Yalnızca odak kümesindeki ajanlarda. */
const Hud = memo(function Hud({ wa, live, overlay, selected, hovered, dense, receiverName, registry }: HudProps) {
  const { agent, mood, activity, tool, work, external } = wa;
  const group = useRef<THREE.Group>(null);
  const hud = useRef<HTMLDivElement>(null);
  const say = useRef<HTMLDivElement>(null);
  const st = useRef({ lodAt: 0, lod: "near", probe: new THREE.Vector3() });
  const scale = external?.small ? 0.62 : 1;
  const gameOn = useGameEnabled();
  const badges = useWorldBadges();
  const gameData = useGameAgent(external ? null : agent.slug);
  const game = gameOn && badges ? gameData : null;
  const levelAt = useWorldFx((s) => s.levelUps[agent.slug] ?? 0);
  const celebrate = gameOn && levelAt > 0 && Date.now() - levelAt < LEVELUP_MS;
  const carry = live.carry.get(agent.slug) ?? null;
  useEffect(() => () => { registry.delete(agent.slug); live.hudRects.delete(agent.slug); }, [agent.slug, registry, live]);

  useFrame((state) => {
    const g = group.current, p = live.positions.get(agent.slug);
    if (!g || !p) return;
    g.position.set(p.x, 0, p.z);
    const el = hud.current, s = st.current, t = state.clock.elapsedTime;
    // drei Html içeriği ayrı kökte sonradan bağlanır: öğe hazır olunca çakışma sınamasına kaydol
    if (el && registry.get(agent.slug) !== el) registry.set(agent.slug, el);
    if (el && t - s.lodAt > 0.25) {
      s.lodAt = t;
      const v = s.probe.set(p.x, 1.9 * scale, p.z);
      const dist = state.camera.position.distanceTo(v);
      v.project(state.camera);
      const next = Math.abs(v.x) > 1.15 || Math.abs(v.y) > 1.25 || v.z > 1 ? "off" : dist > HUD_FAR ? "far" : "near";
      if (next !== s.lod || el.dataset.lod !== next) { s.lod = next; el.dataset.lod = next; }
    }
    // S33: konuşma balonu (gerçek olayın kısa özeti) — React yeniden çizimi olmadan
    const sb = say.current;
    if (sb) {
      const text = live.talking.get(agent.slug) ?? "";
      if (sb.textContent !== text) sb.textContent = text;
      const on = text ? "on" : "off";
      if (sb.dataset.talk !== on) sb.dataset.talk = on;
      const meet = !live.meeting.has(agent.slug) ? "off" : text ? "on" : "listen";
      if (el && el.dataset.meet !== meet) el.dataset.meet = meet;
    }
  });

  const kind = toolKind(tool);
  const busy = mood === "working" || mood === "thinking" || mood === "waiting";
  const bubble = carry && !busy ? "📜" : kind && mood === "working" ? TOOL_ICON[kind] : BUBBLE[mood];
  const text = carry && bubble === "📜" ? tx(M, "bubble_deliver", { name: receiverName ?? carry.to }) :
    mood === "done" ? tx(M, "bubble_done") : mood === "offline" ? tx(M, "bubble_sleep") : mood === "waiting" ? tx(M, "bubble_waiting") :
    activity || (mood === "thinking" ? tx(M, "bubble_thinking") : mood === "working" ? tx(M, "bubble_working") : "");
  const showWork = work && !(carry && !busy) ? work : null;
  const title = external ? agent.title : agent.title ? shortTitle(agent.title) : null;

  return (
    <group ref={group}>
      {/* Sabit portal: Html hedefi sonradan değişirse React 19'da içerik silinebiliyor. */}
      {/* odaktaki (seçili / üzerine gelinen) HUD ayrı ve üst z bandında: uzakta olsa da diğer HUD'ların üstünde kalır */}
      <Html position={[0, external?.small ? 1.3 : 1.95, 0]} center distanceFactor={LABEL_DISTANCE} zIndexRange={hovered || selected ? [60, 50] : [40, 0]}
        style={{ pointerEvents: "none" }} portal={overlay as MutableRefObject<HTMLElement>}>
        <AgentHud hudRef={hud} sayRef={say} name={agent.name} title={title} color={agent.color} mood={mood}
          caption={worldCaption(mood, tool, activity)} conn={connKind(agent.route, external?.label)}
          bubble={bubble} bubbleText={text} work={showWork} game={game} source={external ? { label: external.label, color: external.color } : null}
          levelUp={celebrate} focus={hovered || selected} dense={dense} />
      </Html>
    </group>
  );
});

/** Seviye atlama efektleri: son 2,6 sn içinde seviye atlayan ajanlarda, konum canlı durumdan. */
function LevelUps({ live }: { live: WorldLive }) {
  const levelUps = useWorldFx((s) => s.levelUps);
  const gameOn = useGameEnabled();
  const [, tick] = useState(0);
  const active = useMemo(() => Object.entries(levelUps).filter(([, ts]) => Date.now() - ts < LEVELUP_MS), [levelUps]);
  useEffect(() => {
    if (!active.length) return;
    const id = window.setTimeout(() => tick((x) => x + 1), LEVELUP_MS + 50);
    return () => window.clearTimeout(id);
  }, [active]);
  if (!gameOn) return null;
  return <>{active.map(([slug, ts]) => <Follower key={`${slug}:${ts}`} slug={slug} live={live}><LevelUpFx start={ts} /></Follower>)}</>;
}

function Follower({ slug, live, children }: { slug: string; live: WorldLive; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => { const p = live.positions.get(slug); if (ref.current && p) ref.current.position.set(p.x, 0, p.z); });
  return <group ref={ref}>{children}</group>;
}

// ------------------------------------------------------------------ kamera
const CAM_DIR = new THREE.Vector3(0, 12.5, 16.2).normalize();
const probeCam = new THREE.PerspectiveCamera();
const probe = new THREE.Vector3();

interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }
const center = (b: Bounds, lift = 0) => new THREE.Vector3((b.minX + b.maxX) / 2, 0.4 + lift, (b.minZ + b.maxZ) / 2 + 0.8);

/** Dünya ekrana sığacak kamera uzaklığı. Taban sahnede (24×16) eski davranış aynen; büyümüş dünyada bütün köşeler
 *  (zemin ve arka duvarın tepesi) ekranın %90'ına sığana dek uzaklaşır. */
function fitDistance(fov: number, aspect: number, b: Bounds, isBase: boolean): number {
  const wide = THREE.MathUtils.clamp(12.6 / (Math.tan(THREE.MathUtils.degToRad(fov / 2)) * aspect), 14, 27);
  // CITY-BIG: büyük şehir tabanı (ör. 36×32) da taban sayılır ama 24×16 kalıbı ona yetmez → bütün köşeleri sığdıran arama
  const std = b.maxX - b.minX === W && b.maxZ - b.minZ === D;
  if (isBase && std) return wide;
  const target = center(b);
  probeCam.fov = fov; probeCam.aspect = aspect; probeCam.updateProjectionMatrix();
  const pts: [number, number, number][] = [
    [b.minX, 0, b.maxZ], [b.maxX, 0, b.maxZ], [b.minX, 3, b.minZ], [b.maxX, 3, b.minZ], [b.minX, 0, b.minZ], [b.maxX, 0, b.minZ],
  ];
  // CITY-BIG: büyük tabanda ön kenarın zemin kalınlığı (y −1) da alt kenardan pay bırakarak (−0,84) sığar: alttaki HUD (ekip kartı,
  // ölçüm çipi) ön şeridi örtmesin; kaldırma araması bu ön sınırı korur (fitView `front0`)
  const big = isBase && !std;
  if (big) pts.push([b.minX, -1, b.maxZ], [b.maxX, -1, b.maxZ]);
  const fits = (d: number) => {
    probeCam.position.copy(target).addScaledVector(CAM_DIR, d);
    probeCam.lookAt(target);
    probeCam.updateMatrixWorld();
    return pts.every(([x, y, z]) => { probe.set(x, y, z).project(probeCam); return Math.abs(probe.x) <= 0.92 && probe.y <= 0.9 && probe.y >= (big ? -0.84 : -0.9); });
  };
  let d = wide;
  while (d < 220 && !fits(d)) d += 0.5;
  return d;
}

/** W2b-INT — ufuk (backdrop) bandı olan taban şehir sahnesinin kadraj noktaları: ızgaranın ARKASINDAKİ (z < arka kenar) ve yatayda
 *  ızgara genişliğinde (|x| ≤ 14) duran ufuk bloklarının tepe ortası; 1 birimlik x × 2 birimlik z hücresinde en yüksek olan.
 *  Yan/ön dekor (ör. Mercan Üssü yosunları) sayılmaz. Ufku olmayan sahnede boş → kamera eskisi gibi. */
interface SkyTop { x: number; y: number; z: number }
function skylineTops(built: Pick<Built, "backdrop" | "width">): SkyTop[] {
  // CITY-BIG: yatay pencere tabanın genişliğine göre (24 genişlikte |x| ≤ 14, eskisiyle aynı; 36 genişlikte x 6 ± 20)
  const halfW = built.width / 2, midX = tileX(0) - 0.5 + halfW;
  const cells = new Map<string, SkyTop>();
  for (const pt of built.backdrop ?? []) {
    const x = pt.p[0], z = pt.p[2], y = pt.p[1] + pt.s[1] / 2;
    if (Math.abs(x - midX) > halfW + 2 || z > tz(0) - 1 || y < 1) continue;
    const k = `${Math.round(x)},${Math.round(z / 2)}`;
    const cur = cells.get(k);
    if (!cur || y > cur.y) cells.set(k, { x, y, z });
  }
  return [...cells.values()];
}

/** RING-INT — simge çekirdeği (`SceneDef.core`) olan sahnede çekirdek dikdörtgeninin içindeki YÜKSEK ızgara bloklarının (tepe
 *  ≥ 2,5) tepe ortası; 1×1 karo hücresinde en yüksek olan. Taban kadrajı bunları ufuk tepeleriyle birlikte sığdırır (kahraman
 *  kuleler kırpılmaz); büyümüş dünyada da çekirdek ortada kalırken simge tepeleri kadraja girene dek kamera geri çekilir.
 *  Çekirdeksiz sahnede boş → kamera değişmez. */
function coreTops(built: Pick<Built, "blocks" | "modules">, core: SceneCore | undefined): SkyTop[] {
  if (!core) return [];
  const m0 = built.modules.find((m) => m.base) ?? built.modules[0];
  const i0 = (m0?.i0 ?? 0) + core.i0, j0 = (m0?.j0 ?? 0) + core.j0;
  const x0 = tileX(i0) - 0.5, x1 = tileX(i0 + core.w - 1) + 0.5, z0 = tz(j0) - 0.5, z1 = tz(j0 + core.d - 1) + 0.5;
  const cells = new Map<string, SkyTop>();
  for (const pt of built.blocks) {
    const x = pt.p[0], z = pt.p[2], y = pt.p[1] + pt.s[1] / 2;
    if (y < 2.5 || x < x0 || x > x1 || z < z0 || z > z1) continue;
    const k = `${Math.floor(x)},${Math.floor(z)}`;
    const cur = cells.get(k);
    if (!cur || y > cur.y) cells.set(k, { x, y, z });
  }
  return [...cells.values()];
}

/** W2b-INT — taban sahne kadrajı (uzaklık + hedefin yükselmesi). Ufuk bandı yoksa `fitDistance` aynen (öteki sahnelerin
 *  yakınlığı değişmez). Varsa ufkun (simge kuleler, dağ, köprü) tepesi kadraja girene dek hedef en çok 4 birim yükselir
 *  (kamera yukarı eğilir) ve gerekirse geri çekilir (en çok ×1,3); ızgaranın ön kenarı bugünkünden fazla kesilmez. Sığmazsa
 *  ufkun en az kesildiği kadraj seçilir. Arama: kaldırma 0–4 (0,25 adım), uzaklık 0,25 adım; ekranda yatayda görünen
 *  noktalar sayılır. */
function fitView(fov: number, aspect: number, b: Bounds, isBase: boolean, tops: SkyTop[], ring = false): { d: number; lift: number } {
  const d0 = fitDistance(fov, aspect, b, isBase);
  if (!tops.length) return { d: d0, lift: 0 };
  probeCam.fov = fov; probeCam.aspect = aspect; probeCam.updateProjectionMatrix();
  const worstAt = (tgt: THREE.Vector3, d: number) => {
    probeCam.position.copy(tgt).addScaledVector(CAM_DIR, d);
    probeCam.lookAt(tgt);
    probeCam.updateMatrixWorld();
    let worst = -Infinity;
    for (const p of tops) {
      probe.set(p.x, p.y, p.z).project(probeCam);
      if (Math.abs(probe.x) <= 0.95 && probe.y > worst) worst = probe.y;
    }
    return worst;
  };
  if (!isBase) {
    // RING-INT: büyümüş çekirdekli dünya — hedef dünya (= çekirdek) merkezinde kalır; simge tepeleri sığana dek geri çekil (≤ ×1,3)
    if (!ring) return { d: d0, lift: 0 };
    let d = d0;
    while (d < d0 * 1.3 && worstAt(center(b), d) > 0.9) d += 0.5;
    return { d, lift: 0 };
  }
  const frontZ = b.maxZ, midX = (b.minX + b.maxX) / 2;
  const aim = (tgt: THREE.Vector3, d: number) => {
    probeCam.position.copy(tgt).addScaledVector(CAM_DIR, d);
    probeCam.lookAt(tgt);
    probeCam.updateMatrixWorld();
  };
  aim(center(b), d0);
  // CITY-BIG: büyük tabanda ön kenarın zemin kalınlığı da (y −1) kesilmez — kaldırma ön şeridi `fitDistance`'ın bıraktığı paydan aşağı itmez
  const bigBase = b.maxX - b.minX !== W || b.maxZ - b.minZ !== D, frontY = bigBase ? -1 : 0;
  const front0 = bigBase ? probe.set(midX, frontY, frontZ).project(probeCam).y : Math.min(-0.9, probe.set(midX, 0, frontZ).project(probeCam).y);
  let best: { d: number; lift: number } | null = null, fallback = { d: d0, lift: 0, worst: Infinity };
  // RING-INT: ızgara ortasındaki kahraman simgeler (çekirdekli şehir) için arama aralığı genişler (kaldırma ≤ 6, ×1,5)
  const dMax = d0 * (ring ? 1.5 : 1.3), liftMax = ring ? 6 : 4;
  for (let lift = 0; lift <= liftMax; lift += 0.25) {
    const tgt = center(b, lift);
    for (let d = d0; d <= (best ? best.d - 0.01 : dMax); d += 0.25) {
      aim(tgt, d);
      if (probe.set(midX, frontY, frontZ).project(probeCam).y < front0 - 1e-6) continue;
      let worst = -Infinity;
      for (const p of tops) {
        probe.set(p.x, p.y, p.z).project(probeCam);
        if (Math.abs(probe.x) <= 0.95 && probe.y > worst) worst = probe.y;
      }
      if (worst <= 0.9) { best = { d, lift }; break; }
      if (worst < fallback.worst - 1e-3) fallback = { d, lift, worst };
    }
  }
  return best ?? { d: fallback.d, lift: fallback.lift };
}

const backDistance = (d: number, b: Bounds) => center(b).addScaledVector(CAM_DIR, d).distanceTo(new THREE.Vector3((b.minX + b.maxX) / 2, 1, b.minZ));

interface CamApi { reset: () => void; focus: (x: number, z: number, dist?: number) => void; zoom: (f: number) => void }

/** Kamerayı ekran oranına ve dünya sınırlarına göre yerleştirir; kaydırma hedefini sınırlar içinde tutar; yumuşak odaklanma. */
function CameraRig({ controls, api, bounds, isBase, live, top, ring = false }:
  { controls: RefObject<ComponentRef<typeof OrbitControls> | null>; api: MutableRefObject<CamApi>; bounds: Bounds; isBase: boolean; live: WorldLive;
    /** W2b-INT: ufuk bandının tepe noktaları (taban kadrajı ona göre eğilir/geri çekilir) */ top: SkyTop[];
    /** RING-INT: simge çekirdekli sahne (kadraj arama aralığı geniş; büyümüş dünyada simge tepeleri de sığar) */ ring?: boolean }) {
  const { camera, size } = useThree();
  const liftRef = useRef(0);
  const anim = useRef<{ fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3; t0: number; dur: number } | null>(null);
  const fitRef = useRef(0);
  const start = (toT: THREE.Vector3, toP: THREE.Vector3) => {
    if (reducedMotion()) {
      camera.position.copy(toP);
      const c = controls.current; if (c) { c.target.copy(toT); c.update(); }
      return;
    }
    const c = controls.current;
    anim.current = { fromT: (c ? c.target : toT).clone(), toT, fromP: camera.position.clone(), toP, t0: performance.now(), dur: 650 };
  };
  api.current = {
    reset: () => {
      const cam = camera as THREE.PerspectiveCamera;
      const { d, lift } = fitView(cam.fov, size.width / size.height, bounds, isBase, top, ring);
      fitRef.current = d; liftRef.current = lift;
      const target = center(bounds, lift);
      const c = controls.current;
      if (c) c.maxDistance = Math.max(32, d + 10);
      start(target, target.clone().addScaledVector(CAM_DIR, d));
    },
    focus: (x, z, dist) => {
      const c = controls.current;
      const cur = c ? c.target : center(bounds);
      const dir = camera.position.clone().sub(cur);
      const len = dir.length() || 16;
      const d = dist ?? Math.min(len, 18);
      dir.normalize();
      const toT = new THREE.Vector3(x, 0.4, z);
      start(toT, toT.clone().addScaledVector(dir, Math.max(c?.minDistance ?? 7, d)));
    },
    zoom: (f) => {
      const c = controls.current;
      const cur = c ? c.target : center(bounds);
      const dir = camera.position.clone().sub(cur);
      const len = THREE.MathUtils.clamp(dir.length() * f, c?.minDistance ?? 7, c?.maxDistance ?? 60);
      camera.position.copy(cur).addScaledVector(dir.normalize(), len);
      c?.update();
    },
  };
  useEffect(() => {
    // ilk yerleşim: geçişsiz
    const cam = camera as THREE.PerspectiveCamera;
    const { d, lift } = fitView(cam.fov, size.width / size.height, bounds, isBase, top, ring);
    liftRef.current = lift;
    // ölçüm/inceleme (PERF.md SP-W2b): taban uzaklığı, seçilen uzaklık ve hedef yükselmesi
    (window as unknown as { __voxcrewCamFit?: unknown }).__voxcrewCamFit = { d0: +fitDistance(cam.fov, size.width / size.height, bounds, isBase).toFixed(2), d: +d.toFixed(2), lift, tops: top.length };
    const target = center(bounds, lift);
    cam.position.copy(target).addScaledVector(CAM_DIR, d);
    const c = controls.current;
    if (c) { c.maxDistance = Math.max(32, d + 10); c.target.copy(target); c.update(); }
    anim.current = null;
  }, [size.width, size.height, bounds, isBase, top, ring]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(() => {
    // W2: yürüme modunda kamerayı WalkRig yazar; yörünge kaydırma sınırı ve odak kayması beklemede
    if (useWalkStore.getState().active) { anim.current = null; return; }
    const c = controls.current;
    const a = anim.current;
    if (a) {
      const k = Math.min(1, (performance.now() - a.t0) / a.dur);
      const e = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(a.fromP, a.toP, e);
      if (c) { c.target.lerpVectors(a.fromT, a.toT, e); c.update(); }
      if (k >= 1) anim.current = null;
    } else if (c) {
      // kaydırma sınırı: hedef dünyanın içinde kalır (W2b-INT: simge ufkunda hedef yüksekliği 0,4 … 0,4 + kaldırma)
      const t = c.target;
      const nx = THREE.MathUtils.clamp(t.x, bounds.minX, bounds.maxX), nz = THREE.MathUtils.clamp(t.z, bounds.minZ, bounds.maxZ);
      const ny = THREE.MathUtils.clamp(t.y, 0.4, 0.4 + liftRef.current);
      if (nx !== t.x || nz !== t.z || t.y !== ny) {
        camera.position.add(new THREE.Vector3(nx - t.x, ny - t.y, nz - t.z));
        t.set(nx, ny, nz);
      }
    }
    if (c) { live.camTarget.x = c.target.x; live.camTarget.z = c.target.z; }
  });
  return null;
}

/** Ölçüm: kare süresi (ortalama, p95) ve renderer.info çizim çağrıları; ≈ 4 Hz raporlanır. */
function PerfProbe({ onPerf, agents, live }: { onPerf: (s: PerfSample) => void; agents: number; live: WorldLive }) {
  const { gl } = useThree();
  const st = useRef({ last: 0, samples: [] as number[], acc: 0, n: 0, at: 0 });
  useFrame(() => {
    const now = performance.now(), s = st.current;
    if (s.last) {
      const ms = now - s.last;
      // gizli sekme / duraklama kareleri (> 250 ms) ölçüme katılmaz
      if (ms < 250) { s.samples.push(ms); s.acc += ms; s.n++; if (s.samples.length > 240) s.samples.shift(); }
    }
    s.last = now;
    if (now - s.at > 250 && s.n > 0) {
      s.at = now;
      const sorted = [...s.samples].sort((a, b) => a - b);
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
      onPerf({ ms: s.acc / s.n, p95, calls: gl.info.render.calls, triangles: gl.info.render.triangles, agents, crowdMs: live.crowdMs });
      s.acc = 0; s.n = 0;
    }
  });
  return null;
}

const NO_GOALS: GoalMarker[] = [];
const NO_EXHIBITS: WorldExhibit[] = [];
const EXHIBIT_LABELS = { desk: "", forgotten: "" };
const NO_SLUGS: string[] = [];
const NO_AGENTS: never[] = [];
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _ground = new THREE.Vector3();
/** W2: yürüme modunda kamera uçları (odak, yakınlaştır, sıfırla) çalışmaz — kamerayı WalkRig yazar. */
const walking = () => useWalkStore.getState().active;

function Scene({ scene, agents: agentsAll, selected, onSelect, overlay, labels, live, camApi, handoffs = [], teams = [], onTeamClick, onHover, hovered = null,
  goals = NO_GOALS, focusTeam = null, onPerf, onZones, controls, builtRef, me, exhibits = NO_EXHIBITS, exhibitLabels = EXHIBIT_LABELS, onExhibit, onBuilt }:
  Props & { overlay: RefObject<HTMLDivElement | null>; labels: RefObject<HTMLCanvasElement | null>; live: WorldLive; camApi: MutableRefObject<CamApi>;
    onZones: (z: Zone[]) => void; controls: RefObject<ComponentRef<typeof OrbitControls> | null>;
    /** W2: kurulmuş dünya (yürüme girişi doğma karosunu buradan hesaplar) */ builtRef: MutableRefObject<{ built: Built; core: SceneCore | null } | null>;
    /** W2: "Ben" avatarının görünümü (Crowd örneği) */ me: MeLook }) {
  const baseDef = sceneDef(scene);
  // WALK-EXPLORE: iç mekân örneği (kapıdan girilen AYRI küçük voxel uzayı; voxel/interiors) — içerideyken dış dünyanın yerine
  // çizilir ve yürünür; dış model, kurulum ve perf değişmez. İçeride ajan çizilmez (masalarında kalırlar), ortam/çevre kapalı.
  const inner = useInterior((s) => (s.view && s.view.level.scene === scene ? s.view : null));
  // şehir haritası (ofis tabanından AYRI yürüme dünyası) — şehirdeyken varış meydanı ve semt
  // akışı ofisin yerine çizilir; ajanlar ofiste kalır (D5 A), ofis tabanı ve kuralları değişmez. İç mekân şehrin de üstündedir.
  const cityView = useCity((s) => (s.view && s.view.scene === scene ? s.view : null));
  const cityMap = useMemo(() => cityForScene(scene), [scene]);
  const def = inner ? inner.def : cityView ? cityView.def : baseDef;
  // COS-B: sahip olunan ve seçili mağaza kıyafetleri (bayrak kapalıyken/seçim yokken aynı dizi → +0 yeniden kurulum)
  const cosLive = useLiveEquip();
  useEffect(() => { void ensureCosmetics(); }, []);
  // CITY-PACKS: sahip olunan şehir paketleri şehir haritası vitrinine (citypacks/cityOverlay; bir sonraki şehre girişte)
  useEffect(() => { void ensureCityPacks(); }, []);
  const agents = useDressedAgents(inner || cityView ? (NO_AGENTS as typeof agentsAll) : agentsAll, cosLive, scene);
  const meLook = useDressedMe(me, cosLive, scene);
  // ajan sayısı istasyonları aşınca dünya modüllerle büyür: herkesin kendi masası olur (scenes.ts → buildWorld)
  // `def` bağımlılığı: dünya yapıcıda kaydedilen kullanıcı dünyası (registerScene) yeni tanımla yeniden pişer
  // S38: ekip dağılımı (talep) → temalı bölgeler; aynı plan aynı Built nesnesini döndürür (önbellek), alt hesaplar yeniden koşmaz
  const agentSigAll = agentsAll.map((a) => `${a.agent.slug}:${a.agent.team ?? ""}`).join("|");
  const agentSig = inner || cityView ? "" : agentSigAll;
  const teamSig = teams.map((t) => `${t.slug}:${t.name}:${t.color}:${t.lead ?? ""}`).join("|");
  // WORK-ZONES: görevi bir şehir ofisinde süren ajanlar ve kurulacak ofis binaları (yoksa talep ve dünya birebir eskisi)
  useEffect(() => { ensureWorkZones(); }, []);
  const zoneReq = useZoneRequests(scene);
  const demand = useMemo(() => withOffices(worldDemand(agentsAll.map((a) => ({ team: a.agent.team })), teams), scene, zoneReq.zones), [agentSigAll, teamSig, zoneReq.sig]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (scene && zoneReq.zones.length) useWorkZones.getState().keep(scene, zoneReq.zones); }, [scene, zoneReq.sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const worldBuilt = useMemo(() => buildWorld(scene, agentsAll.length, demand), [scene, agentsAll.length, baseDef, demand]); // eslint-disable-line react-hooks/exhaustive-deps
  builtRef.current = { built: worldBuilt, core: baseDef.core ?? null };
  useEffect(() => { onBuilt?.(worldBuilt); }, [worldBuilt, onBuilt]);
  const built = inner ? inner.built : cityView ? cityView.built : worldBuilt;
  // CITY-BIG: çekirdekli şehrin büyük tabanı (ör. 36×32, tek modül) da taban kadrajını kullanır
  const isBase = (built.width === W && built.depth === D) || (!!def.core && built.modules.length === 1);
  const bounds = useMemo(() => worldBounds(built), [built]);
  const { size, camera } = useThree();
  // W2b-INT: ufuk kadrajı yalnız şehir sahnelerinde ve simge (landmark) bölgesi olan sahnelerde; premium sahnelerin ufku
  // (orman, resif kayaları) ortam dekorudur → onların ve ufuksuz sahnelerin kadrajı değişmez
  const skyFrame = isBase && (def.tier === "city" || !!built.zones?.some((z) => z.kind === "landmark"));
  // RING-INT: çekirdekli sahnede ızgaradaki kahraman simgelerin tepeleri de (taban ve büyümüş dünya); çekirdeksizde değişmez
  const ring = !!def.core;
  const skyTop = useMemo(() => [...(skyFrame ? skylineTops(built) : []), ...coreTops(built, def.core)], [built, skyFrame, def.core]);
  const fogShift = useMemo(() => {
    const baseB = worldBounds({ width: W, depth: D });
    if (isBase && built.width === W && built.depth === D) {
      // W2b-INT: simge ufku için geri çekilen taban kadrajında sis de o kadar ötelenir
      if (!skyTop.length) return 0;
      const fov = (camera as THREE.PerspectiveCamera).fov, aspect = size.width / Math.max(1, size.height);
      return Math.max(0, fitView(fov, aspect, bounds, true, skyTop, ring).d - fitDistance(fov, aspect, bounds, true));
    }
    // büyümüş dünya ya da CITY-BIG büyük taban: arka kenara uzaklık 24×16 taban kadrajına göre ne kadar arttıysa sis o kadar ötelenir
    const fov = (camera as THREE.PerspectiveCamera).fov, aspect = size.width / Math.max(1, size.height);
    return Math.max(0, backDistance(fitView(fov, aspect, bounds, isBase, skyTop, ring).d, bounds) - backDistance(fitDistance(fov, aspect, baseB, true), baseB));
  }, [isBase, bounds, size.width, size.height, camera, skyTop, ring, built]);
  const talks = useWorldTalk((s) => s.talks);
  // SP-W0: sahne saati (`def.time`; Görünüm → Işık seçimi üstündür)
  const night = useSceneNight(def);
  const weatherOn = useWeatherFx((s) => s.on);
  // (C1/A5/C2): mevsim ve hava anı yer kimliği (şehir sahnesi ya da şehir haritası; iç mekânda yok). Taç eşlemi Blocks'tan
  // önce yazılır (render sırasında, aynı yer için bir kez): Blocks/kuyruk örnek rengini `tintHex` ile alır, +0 çizim çağrısı.
  const seasonPlace = inner ? null : cityView ? cityView.city : (def.annex ?? def.id);
  useMemo(() => setSeasonTint(canopyTint(seasonPlace, seasonNow(seasonPlace), climateOf(seasonPlace))), [seasonPlace]);
  const nightLit = night && !def.night;
  const fill = useMemo(() => fillLight(def.sun.pos, def.sun.intensity, nightLit || !!def.night), [def, nightLit]);
  const dense = agents.length > 16;
  const [hudSlugs, setHudSlugs] = useState<string[]>([]);
  // W2: yürüme modunda drei Html HUD'ları kapalı (yakın takip kamerasında uzaklık ölçeği devleşir); yakındaki ajanlar 2B
  // tuvalde ad etiketi alır (Crowd: avatarın 8 birim çevresi)
  const walkOn = useWalkActive();
  // W3 (WALK-UX): Yakındakiler'e giren dünya nesneleri (pano, kahve, oturma, olta, masa); kararlı işlev
  const walkEntities = useWalkEntities(built, def.ocean?.y ?? null, def.core ?? null);
  const hudSet = useMemo(() => new Set(walkOn ? [] : hudSlugs), [hudSlugs, walkOn]);
  const hudReg = useMemo(() => new Map<string, HTMLDivElement>(), [scene]); // eslint-disable-line react-hooks/exhaustive-deps
  const onFocusSet = useCallback((slugs: string[]) => setHudSlugs(slugs), []);

  // Ekip bölgeleri: aynı ekibin ajanları ardışık (komşu) istasyonlara oturur; lider ekibin ilk masasını alır. S38: büyümüş dünyada
  // her ekip kendi bölgesindeki koltuklara, ekipsizler ve harici oturumlar MERKEZ'e / ortak çalışmaya oturur (assignSeats).
  const slots = useMemo(() => assignSeats(built, agents.map((a) => ({ slug: a.agent.slug, team: a.agent.team, guest: !!a.external })),
    teams.map((t) => t.slug), new Set(teams.map((t) => t.lead).filter(Boolean) as string[])),
  [built, agentSig, teamSig]); // eslint-disable-line react-hooks/exhaustive-deps
  // WORK-ZONES: bölgede çalışan ajana o ofisin boş masası (iş sürdükçe; bitince kendi masasına döner). Bölge bu dünyada yoksa,
  // doluysa ya da yürüyerek ulaşılamıyorsa taban ofiste kalır (durum: ajan paneli, görev kartı, dünya çipi).
  const zoneSeats = useMemo(() => (inner || cityView ? null : assignZoneSeats(built, zoneReq.requests, (slug) => {
    const k = slots.get(slug);
    return k === undefined || !built.stations.length ? null : built.stations[k % built.stations.length].tile;
  })), [built, slots, zoneReq.sig, inner, cityView]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (zoneSeats) useWorkZones.getState().setSeats(zoneSeats.state); }, [zoneSeats]);
  const plan = useMemo<AgentPlan[]>(() => {
    const stations = built.stations;
    const reserved = new Set(stations.map((s) => key(...s.tile)));
    Object.values(built.spots).forEach((list) => list?.forEach((s) => reserved.add(key(...s.tile))));
    // SP-W0: sacred bölgede (tampon dahil) ajan geçebilir ama boşta durmaz
    const wander = built.zones?.length ? freeTiles(built, reserved).filter((t) => !isInSacredBuffer(t, built, "anchor")) : freeTiles(built, reserved);
    // S33 mola yerleri: kahve makinesi önü (yürünebilirse) ve dinlenme karoları; arkasında (+z) oturak yüksekliğinde
    // kanepe/bank olan dinlenme karosunda ajan oturur (−z'ye bakarak) — her sahnede ve kullanıcı dünyasında çalışır
    const marks = built.props ?? [];
    const coffees = marks.filter((m) => m.k === "coffee" && m.tile && !built.blocked.has(key(...m.tile)));
    const sofaTiles = seatTiles(built);
    const restSpots: Station[] = built.rest.map((r) => ({ tile: r, face: sofaTiles.has(key(...r)) ? Math.PI : 0 }));
    // karo → yakın serbest karolar (ızgara kovası): 180 ajanda 3456 karolu dünyada bile hızlı
    const bucket = new Map<string, [number, number][]>();
    for (const tl of wander) { const k = `${tl[0] >> 2},${tl[1] >> 2}`; (bucket.get(k) ?? bucket.set(k, []).get(k)!).push(tl); }
    return agents.map((wa, i) => {
      const zs = zoneSeats?.seats.get(wa.agent.slug); // WORK-ZONES: ofis binasındaki masa
      const station = zs !== undefined ? stations[zs] : stations[(slots.get(wa.agent.slug) ?? i) % stations.length];
      const [si, sj] = station.tile;
      let rest = station.tile, rd = Infinity;
      for (const r of built.rest) { const d = Math.abs(r[0] - si) + Math.abs(r[1] - sj); if (d < rd) { rd = d; rest = r; } }
      // boşta ajan kendi masasının çevresinde dolaşır: herkes ortada toplanıp üst üste binmez
      const near: [number, number][] = [];
      for (let bi = (si >> 2) - 1; bi <= (si >> 2) + 1; bi++) for (let bj = (sj >> 2) - 1; bj <= (sj >> 2) + 1; bj++)
        for (const tl of bucket.get(`${bi},${bj}`) ?? []) if (Math.abs(tl[0] - si) + Math.abs(tl[1] - sj) <= 3) near.push(tl);
      const pool = near.length >= 4 ? near : wander;
      // S33: kendi masası olan ajan masasında başlar ve boşta orada oturur; istasyon paylaşılıyorsa yakında bir karoda durur
      const shared = zs === undefined && (slots.get(wa.agent.slug) ?? i) >= stations.length;
      const idle = pool[(i * 37 + 11) % pool.length] ?? station.tile;
      const spawn = shared ? idle : station.tile;
      // S38: bölgeli dünyada en yakın olanağın kahve noktası (bölge 12 karo) biraz daha uzakta olabilir
      let coffee: Station | null = null, cd = coffeeReach(built); // taban boyuyla ölçekli
      for (const c of coffees) {
        const d = Math.abs(c.tile![0] - si) + Math.abs(c.tile![1] - sj);
        if (d < cd) { cd = d; coffee = { tile: c.tile!, face: Math.atan2(c.p[0] - tileX(c.tile![0]), c.p[2] - tz(c.tile![1])) }; }
      }
      const lounge = restSpots.filter((r) => Math.abs(r.tile[0] - si) + Math.abs(r.tile[1] - sj) <= 18)
        .sort((a, b) => Math.abs(a.tile[0] - si) + Math.abs(a.tile[1] - sj) - Math.abs(b.tile[0] - si) - Math.abs(b.tile[1] - sj)).slice(0, 4);
      return { station, rest, spawn, wander: pool, shared, idle, coffee, lounge, sofaTiles };
    });
  }, [built, agentSig, slots, zoneSeats]); // eslint-disable-line react-hooks/exhaustive-deps
  // GIFTS-GENDER: hediye rafı yalnızca kendi masası olan ajanlar için
  const shelfItems = useMemo(() => agents.flatMap((wa, i) => (plan[i] && !plan[i].shared && !wa.external ? [{ slug: wa.agent.slug, plan: plan[i] }] : [])), [agents, plan]);
  const zones = useMemo<Zone[]>(() => {
    const byTeam = new Map(teams.map((t) => [t.slug, t]));
    const signed = new Set<string>();
    return agents
      .map((wa) => ({ wa, slot: slots.get(wa.agent.slug) ?? 0 }))
      .filter(({ slot }) => slot < built.stations.length) // paylaşılan istasyona ikinci bölge çizilmez
      .sort((a, b) => a.slot - b.slot)
      .flatMap(({ wa, slot }) => {
        const team = wa.agent.team ? byTeam.get(wa.agent.team) : undefined;
        if (!team) return [];
        const sign = !signed.has(team.slug);
        signed.add(team.slug);
        return [{ id: `${team.slug}:${slot}`, station: built.stations[slot], team, lead: team.lead === wa.agent.slug, sign }];
      });
  }, [built, agentSig, teamSig, slots]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    live.bounds = bounds; live.modules = built.modules;
    live.zones = zones.map((z) => ({ i: z.station.tile[0], j: z.station.tile[1], color: z.team.color, team: z.team.slug, lead: z.lead }));
    live.version++;
    onZones(zones);
  }, [bounds, built, zones, live, onZones]);
  const waitingTeams = useMemo(() => new Set(agents.filter((a) => a.mood === "waiting" && a.agent.team).map((a) => a.agent.team as string)),
    [agents]);
  // S38 tabelalar: bölgeli dünyada her ekibin ilk bölgesi (pişmiş tabela) + olanak/avlu/MERKEZ adları; taban dünyada ekip
  // tabelaları (ilk masa). Adlar 2B etiket tuvalinde en düşük öncelikle, uzakta gizli (Crowd.tsx).
  const signs = useMemo<WorldSign[]>(() => {
    const out: WorldSign[] = [];
    const byTeam = new Map(teams.map((t) => [t.slug, t]));
    if (built.seats) {
      const seen = new Set<string>();
      for (const m of built.modules) {
        if (!m.sign) continue;
        const [x, y, z] = m.sign;
        if (m.kind === "team") {
          const t = m.team ? byTeam.get(m.team) : undefined;
          if (!t || seen.has(t.slug)) continue;
          seen.add(t.slug);
          out.push({ x, y, z, text: t.name, color: t.color, kind: "team", team: t.slug });
        } else if (m.label) out.push({ x, y, z, label: m.label, color: m.kind === "guest" ? "#94A3B8" : "#E5E7EB", kind: "place" });
      }
    } else {
      for (const zn of zones) if (zn.sign) {
        out.push({ x: tileX(zn.station.tile[0]) - 0.4, y: 1.5, z: tz(zn.station.tile[1]) - 0.4, text: zn.team.name, color: zn.team.color, kind: "team", team: zn.team.slug });
      }
    }
    return out;
  }, [built, zones, teamSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // arşiv sırası (kabul edilen işler + tarif masası) — yalnız dış ofis görünümünde; bloklar `solid`a katılır (+0 çizim
  // çağrısı), başlıklar 2B etiket tuvalinde yer tabelası, tıklama zemin ışınıyla (çizimsiz kutu testi)
  const exKey = exhibits.map((e) => `${e.id}|${e.title ?? ""}|${e.kind}`).join(";");
  const exLayout = useMemo(() => (inner || cityView ? exhibitLayout(built, [], exhibitLabels) : exhibitLayout(built, exhibits, exhibitLabels)),
    [built, exKey, inner, cityView, exhibitLabels.desk, exhibitLabels.forgotten]); // eslint-disable-line react-hooks/exhaustive-deps
  const crowdSigns = useMemo(() => (exLayout.signs.length ? [...signs, ...exLayout.signs] : signs), [signs, exLayout]);
  const exHits = useRef(exLayout.hits);
  exHits.current = exLayout.hits;
  const onExhibitRef = useRef(onExhibit);
  onExhibitRef.current = onExhibit;

  // hedef bayrakları: ekibin tabelalı bölgesinde (yoksa ajanın masasında) tek bayrak
  const flags = useMemo(() => {
    const out: { key: string; pos: [number, number, number]; label: string }[] = [];
    const used = new Set<string>();
    for (const g of goals) {
      let st: Station | undefined;
      if (g.team) st = zones.find((z) => z.sign && z.team.slug === g.team)?.station;
      if (!st && g.agent) {
        const i = agents.findIndex((a) => a.agent.slug === g.agent);
        if (i >= 0) st = plan[i]?.station;
      }
      if (!st || used.has(key(...st.tile))) continue;
      used.add(key(...st.tile));
      out.push({ key: g.key, pos: [tileX(st.tile[0]) + 0.42, 0, tz(st.tile[1]) - 0.42], label: g.label });
    }
    return out;
  }, [goals, zones, plan, agentSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // (yalnız geliştirme): canlı betik ekip alanlarını, otelleri, renkli zemin/bayrak sayısını ve masadaki ajanları okur
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voxcrewWZ?: () => unknown };
    const at = (m: Built["modules"][number]) => ({ x: tileX(m.i0 + m.w / 2), z: tz(m.j0 + m.d / 2) });
    w.__voxcrewWZ = () => ({
      teams: built.modules.filter((m) => m.kind === "team").map((m) => ({ team: m.team, venue: m.venue ?? null, ...at(m), fz: tz(m.j0 + 2), i0: m.i0, j0: m.j0 })),
      hotels: built.modules.filter((m) => /hotel|otel/i.test(m.label ?? "")).map((m) => ({ label: m.label, ...at(m) })),
      origin: [tileX(0), tz(0)], pads: zoneDraw(scene, !!built.seats).pads ? zones.length : 0, flags: built.blocks.filter((q) => q.g === "flag").length, goals: flags.length,
      working: agents.filter((a) => a.mood === "working" || a.mood === "thinking").length,
      atDesk: agents.filter((a, i) => {
        const p = plan[i], v = live.positions.get(a.agent.slug);
        return !!p && !!v && Math.hypot(v.x - tileX(p.station.tile[0]), v.z - tz(p.station.tile[1])) < 1.2;
      }).length,
    });
    return () => { delete w.__voxcrewWZ; };
  }, [built, zones, flags, agents, plan, live, scene]);
  const bySlug = useMemo(() => new Map(agents.map((a) => [a.agent.slug, a])), [agents]);
  // S33: istasyon → oradaki ajanın durumu (ekranlar ve gece ışık havuzları için); panodaki aktif sayısı
  const stationMood = useMemo(() => {
    const out: (Mood | null)[] = new Array(built.stations.length).fill(null);
    agents.forEach((wa, i) => {
      const slot = (slots.get(wa.agent.slug) ?? i);
      if (slot >= built.stations.length) return;
      out[slot] = wa.mood;
    });
    return out;
  }, [agents, slots, built]);
  const active = useMemo(() => agents.filter((a) => a.mood === "working" || a.mood === "thinking" || a.mood === "waiting").length, [agents]);
  const sky = nightLit ? NIGHT_SKY : def.sky;
  const selectedAgent = selected ? bySlug.get(selected) : undefined;
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const half = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2 + 6;
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  // W2: zemin tıklaması yürüme modunda tıkla-git (ışının y = 0 düzlemini kestiği karo; zemin düzlemi −2'de olsa da doğru karo)
  const onGround = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (exHits.current.length && onExhibitRef.current) {  // arşiv öğesi / tarif masası (kutu testi)
      const o = e.ray.origin, d = e.ray.direction;
      const id = pickExhibit(exHits.current, [o.x, o.y, o.z], [d.x, d.y, d.z]);
      if (id) { e.stopPropagation(); onExhibitRef.current(id); return; }
    }
    if (!useWalkStore.getState().active) { onSelect(null); return; }
    e.stopPropagation();
    const hit = e.ray.intersectPlane(GROUND_PLANE, _ground);
    if (hit) useWalkStore.getState().setTarget(tileAt(hit.x, hit.z));
  }, [onSelect]);
  // yıldız kabuğu taban dünyanın çevresinde (yarıçap 70 + half); şehir yürüyüşünde ve iç mekânda kamera kabuğun
  // içinde/yanında kalıyor, yıldızlar binaların önünde ve yerde kar gibi görünüyordu — orada çizilmez
  const showStars = (!!def.night || (nightLit && !INDOOR.has(scene))) && !cityView && !inner;
  const starField = useMemo(() => (showStars ? { radius: 70 + half, depth: 30, count: scene === "space" ? 2600 : 1800 } : null), [showStars, half, scene]);
  // taban dünyada ekip tabelaları da bloklara katılır; anahtar yalnız tabela değişince değişir (ajan durumu değil)
  // şehirde taban dünyada da direkli renkli pano yok (ekip adı 2B etikette kalır)
  const zd = zoneDraw(scene, !!built.seats);
  // bekleyen ekibin dünya işareti — büyümüş dünyada mekân tabelası (m.sign = tabelanın 0,64 üstü, cephe yüzü), tabanda ekibin ilk masası
  const waitVenue = useMemo(() => (zd.waitCue === "venue" ? signs.filter((s) => s.kind === "team" && s.team && waitingTeams.has(s.team))
    .map((s): [number, number, number] => [s.x, s.y - 0.64, s.z + 0.03]) : []), [zd.waitCue, signs, waitingTeams]);
  const waitRing = useMemo(() => (zd.waitCue === "ring" ? zones.filter((z) => z.sign && waitingTeams.has(z.team.slug))
    .map((z): [number, number] => [tileX(z.station.tile[0]), tz(z.station.tile[1])]) : []), [zd.waitCue, zones, waitingTeams]);
  const signKey = !zd.signBlocks ? "" : zones.filter((z) => z.sign).map((z) => [z.station.tile[0], z.station.tile[1], z.lead ? 1 : 0, z.team.color].join("\t")).join("\n");
  // LANDMARK-HIRES: taban sahnede yüksek çözünürlüklü simge bölgelerinin blokları Blocks'tan ayrılır (HiResSceneLayer çizer)
  const hiSplit = useMemo(() => (!inner && !cityView ? hiresSceneSplit(scene, built) : null), [built, inner, cityView, scene]);
  // SP-W0: ufuk silüeti mevcut malzeme gruplarına katılır (+0 çizim çağrısı)
  const allBlocks = useMemo(() => {
    const extra: Block[] = [];
    if (signKey) {
      const leadGroup: Block["g"] = built.blocks.some((b) => b.g === "glow") ? "glow" : "solid";
      for (const part of signKey.split("\n")) {
        const [i, j, lead, color] = part.split("\t");
        extra.push(...teamSignBlocks(tileX(Number(i)) - 0.4, tz(Number(j)) - 0.4, color, lead === "1", leadGroup));
      }
    }
    // WALK-EXPLORE: kapı ve bilgi noktası işaretleri (yalnız dış dünyada; `solid` grubuna katılır, +0 çizim çağrısı)
    if (!inner && !cityView) extra.push(...exploreMarkerBlocks(scene, baseOffset(built)));
    // ofis tabanının kenarında "Şehre çık" kapısı (yalnız çizim, `solid`; +0 çizim çağrısı)
    if (!inner && !cityView && cityMap) { const door = officeDoor(built); if (door) extra.push(...officeDoorBlocks(door, cityMap.gate.kind)); }
    if (exLayout.blocks.length) extra.push(...exLayout.blocks); // arşiv sırası (`solid`; +0 çizim çağrısı)
    const base = hiSplit?.rest ?? built.blocks; // LANDMARK-HIRES
    const back = hiSplit?.backdrop ?? built.backdrop ?? []; // LANDMARK-HIRES
    if (!back.length && !extra.length) return base;
    return [...base, ...back, ...extra];
  }, [built, signKey, inner, scene, cityView, cityMap, exLayout, hiSplit]);
  // SP-W0: sacred bölgede (3 karo payıyla) S48 eğlence yeri, şaka, şakşak ve ambient şakalar başlamaz
  useEffect(() => {
    // W5: `quiet` bölgeler de (ayak izi + kendi tamponu) emote, mini oyun ve şakayı kapatır (plan §3.4)
    const quiet = built.zones?.filter((z) => z.kind === "quiet") ?? [];
    setQuietZone(built.zones?.length
      ? (t) => isInSacredBuffer(t, built) || quiet.some((z) => zoneDistance(t, z) <= (z.buffer ?? 0)) : null);
    return () => setQuietZone(null);
  }, [built]);

  return (
    <>
      <color attach="background" args={[sky]} />
      {/* TOUR-VIEW: şehir haritasında sis akışa bağlı (cityDef → viewDistance.cityFog; kadraj ötelemesi yok), gece biraz yakın */}
      <fog attach="fog" args={cityView && !inner ? [sky, def.fog[0] * (nightLit ? NIGHT_FOG_K : 1), def.fog[1] * (nightLit ? NIGHT_FOG_K : 1)] : [sky, def.fog[0] + fogShift, def.fog[1] + fogShift]} />
      {/* UXF-G: gece hemisfer ışığı tabanı (voxel/props/nightLight.ts)*/}
      {nightLit
        ? <hemisphereLight key="hemi-night" args={nightHemiArgs(def.hemi[2], INDOOR.has(scene) || !!inner)} />
        : <hemisphereLight key="hemi-day" args={[def.hemi[0], def.hemi[1], def.hemi[2]]} />}
      <directionalLight ref={sunRef} /**/ key={`sun:${built.width}x${built.depth}`} position={[cx + def.sun.pos[0], def.sun.pos[1], cz + def.sun.pos[2]]}
        intensity={nightLit ? def.sun.intensity * 0.14 : def.sun.intensity} color={nightLit ? "#9DB4FF" : def.sun.color} castShadow target={sunTarget}
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={sunNormalBias(half)}
        shadow-camera-left={-half} shadow-camera-right={half} shadow-camera-top={half} shadow-camera-bottom={-half}
        shadow-camera-near={1} shadow-camera-far={60 + half * 2} />
      {/* güneşe sırtı dönük yüzler ve alt yüzler için gölgesiz dolgu ışığı (props/fillLight.ts)*/}
      <primitive object={sunTarget} position={[cx, 0, cz]}>
        {fill && <directionalLight key={`fill:${scene}`} position={fill.pos} intensity={fill.intensity} color={def.hemi[0]} target={sunTarget} />}
      </primitive>
      {cityView && !inner && <SunFollow light={sunRef} target={sunTarget} sun={def.sun.pos} focus={live.camTarget} />}{/* RENDER-2 */}
      {built.lights.map((l, i) => <FlickerLight key={`${scene}:${i}`} l={l} />)}
      {/* EXP (E1b): durağan grupların kapasite kuyruğu — çevre arazisi yalnız yürüme modunda buraya yazılır (+0 çizim çağrısı) */}
      {/* WaterFx Blocks'tan ÖNCE — render sırasında dönemi artırıp kaynakları siler; sonra gelen Blocks taban
          sahnenin çeşme/şelalelerini yeni dönemde kaydeder (eskiden tersiydi: taban sahne kaynakları anında siliniyordu)*/}
      <WaterFx key={`waterfx:${scene}:${inner?.level.key ?? cityView?.city ?? ""}:${built.width}x${built.depth}`} />{/* CEOGOZU: çeşme/şelale damlaları (+1 çizim çağrısı) */}
      <Blocks key={`${scene}:${inner?.level.key ?? cityView?.city ?? ""}:${built.width}x${built.depth}`} blocks={allBlocks} tail={!inner} />
      {hiSplit && <HiResSceneLayer key={`hires:${scene}:${built.width}x${built.depth}`} items={hiSplit.items} />}
      {def.ocean ? (
        <OceanPlane color={def.ocean.color} position={[cx, def.ocean.y, cz]} size={400 + half * 4} onClick={onGround} />
      ) : (
        <mesh rotation-x={-Math.PI / 2} position={[cx, groundPlaneY(inner?.level), cz]} onClick={onGround} receiveShadow>
          <planeGeometry args={[400 + half * 4, 400 + half * 4]} />
          <meshLambertMaterial color={def.sky} />
        </mesh>
      )}
      {zd.pads && <ZoneTiles zones={zones} waitingTeams={waitingTeams} />}{/* WORKZONES-1: şehirde ekip renkli zemin yok */}
      {!zd.pads && <WaitCues venue={waitVenue} ring={waitRing} />}{/* WORKZONES-1: şehirde bekleyen ekip tabelada/ilk masada atar */}
      {built.seats
        ? signs.filter((s) => s.kind === "team").map((s) => {
          const team = teams.find((t) => t.slug === s.team);
          return team ? <TeamSign key={`${scene}:sign:${s.team}`} pos={[s.x, s.y, s.z]} team={team} baked onClick={onTeamClick} /> : null;
        })
        : !zd.signTarget ? null /* taban şehirde pano çizilmiyor → görünmez tıklama hedefi de yok*/
        : zones.filter((z) => z.sign).map((z) => (
          <TeamSign key={`${scene}:${z.id}`} pos={[tileX(z.station.tile[0]) - 0.4, 0, tz(z.station.tile[1]) - 0.4]} team={z.team}
            baked={false} onClick={onTeamClick} />
        ))}
      {flags.map((f) => <GoalFlag key={`${scene}:${f.key}`} position={f.pos} label={f.label} overlay={overlay} distanceFactor={LABEL_DISTANCE} />)}
      {/* SP-W1: yıldızlar gece parıltısı katmanında (havuz + pencere + yıldız tek çizim çağrısı; eskiden drei Stars ayrıydı) */}
      <Props built={built} stationMood={stationMood} night={night || !!def.night} chair={OFFICE_CHAIR.has(scene) ? "office" : "wood"} active={active}
        stars={starField} />
      {/* S43: ortam canlıları (kuş, kedi, martı, yunus…; ayar: Dünya araçları → Ortam) */}
      {/* WATER-ALL: iç mekân ve şehir görünümünde ortam hayvanı yok ama durağan öğeler (su, lamba, akvaryum, ağaç…) dokununca tepki verir */}
      <Ambient built={built} kit={def.annex ?? def.id} night={night || !!def.night} live={live} ocean={def.ocean ?? null} hotOnly={!!inner || !!cityView} />
      {/* SP-W0: hareketli set parçaları + hava durumu (tek örneklenmiş dizi; yoksa çizilmez) */}
      {!inner && <SceneFx movers={built.movers} weather={weatherOn ? def.weather : undefined} night={night || !!def.night} nightOnly={def.weatherNightOnly}
        place={seasonPlace} fx={live.fx} ambient={built.ambient} />}
      {/* COS-B: sahip olunan masa süsü, dünya teması ve kutlama (seçim yoksa hiçbir şey bağlanmaz, +0 çizim çağrısı) */}
      {!inner && !cityView && <CosmeticWorldLayer built={built} live={cosLive} cx={cx} cz={cz} half={half} />}
      {!inner && !cityView && <GiftShelfLayer built={built} items={shelfItems} />}
      <Crowd agents={agents} plan={plan} built={built} handoffs={handoffs} talks={talks} live={live} focusTeam={focusTeam} selected={selected} hovered={hovered}
        onSelect={onSelect} onHover={onHover} onFocusSet={onFocusSet} labelCanvas={labels} hudSlugs={hudSet} signs={crowdSigns}
        kit={def.annex ?? def.id} oceanY={def.ocean?.y ?? null} rain={weatherOn && !!def.weather?.includes("rain")} me={meLook} />
      {(walkOn ? NO_SLUGS : hudSlugs).map((slug) => {
        const wa = bySlug.get(slug);
        if (!wa) return null;
        const carry = live.carry.get(slug);
        return (
          <Hud key={`${scene}:${slug}`} wa={wa} live={live} overlay={overlay} selected={selected === slug} hovered={hovered === slug} dense={dense} registry={hudReg}
            receiverName={carry ? bySlug.get(carry.to)?.agent.name : undefined} />
        );
      })}
      <HudDeclutter registry={hudReg} live={live} overlay={overlay} selected={selected} hovered={hovered} />
      {selectedAgent && !selectedAgent.external && <SelectRing slug={selectedAgent.agent.slug} color={selectedAgent.agent.color} live={live} />}
      <LevelUps live={live} />
      <CameraRig controls={controls} api={camApi} bounds={bounds} isBase={isBase} live={live} top={skyTop} ring={ring} />
      {/* EXP (E1b): çevre akışı + çarpışma ızgarası (yalnız yürüme modu; WalkRig'den ÖNCE: dünya büyüyünce avatarın yakın halkası
          WalkRig'in kaydırma/unstick etkisinden önce dolar; +0 çizim) */}
      {!inner && !cityView && <Outskirts built={built} def={def} core={def.core ?? null} live={live} />}
      {/* W2: yürüme modu kamera düzeneği (her zaman bağlı; mod kapalıyken çıkış kaymasını bitirir, başka iş yapmaz; +0 çizim) */}
      <WalkRig built={built} controls={controls} live={live} core={def.core ?? null} entities={walkEntities} />
      {/* WALK-EXPLORE: iç mekân varışı ve kapı/portal/keşif tetikleyicileri (WalkRig'den SONRA: taban kayması etkisinden sonra yerleştirir; +0 çizim) */}
      <InteriorRig scene={scene} built={built} exterior={worldBuilt} core={baseDef.core ?? null} />
      {/* şehir haritası semt akışı, çarpışma, kamera kuralı ve tetikleyiciler (WalkRig ve InteriorRig'den SONRA; +0 çizim). canlı
          katman (binilmeyen hat araçları, sürüler, balonlar; görünür bir şey varken +1 çizim, gece/gündüz ışığıyla)*/}
      {cityView && <CityRig view={cityView} paused={!!inner} night={night || !!def.night} />}
      {/* CORE-CITYMAP (REAL-WATER-001): şehir haritasında semt suyuna ve denize dokunma (sıçrama + halka) */}
      {cityView && !inner && <CityWaterTaps map={cityView.map} live={live} />}
      {!cityView && !inner && cityMap && <CityDoorWatcher scene={scene} built={worldBuilt} map={cityMap} />}
      {/* CITYLIFE: her girişte geçit efekti (iç mekân, çıkış, merdiven/asansör, durak, seyir) + şehir figüranları ve mekân satıcıları (+≤2 çizim) */}
      <CityLife scene={scene} worldBuilt={worldBuilt} level={inner?.level ?? null} cityView={cityView} night={night || !!def.night} rainy={weatherOn && !!def.weather?.includes("rain")} place={seasonPlace} />
      {/* şehir / iç mekân değişince yeni programlar arka planda derlenir; hazır olana dek çizim atlanır (portal takılması)*/}
      <ProgramGate token={`${cityView?.city ?? ""}|${inner?.level.key ?? ""}`} />
      {/* alt sayfa (durak paneli) avatarı örtecekse izdüşüm yukarı kayar (kamera ve rigler değişmez; +0 çizim)*/}
      <FrameLift />
      {/* W3: Konuş panelinin ajanın yanına yerleşmesi için ekran konumu (+0 çizim) */}
      <WalkPanelAnchor live={live} />
      {onPerf && <PerfProbe onPerf={onPerf} agents={agents.length} live={live} />}
    </>
  );
}

/**
 * ilk kareler çizilene dek 3B alan bomboş beyazdı (5 sn'den uzun; HUD ve yan paneller dolu). Canvas'ın kendi
 * Suspense sınırı sahneyi tutarken bu kardeş bileşen de bağlanmaz; ilk `FIRST_FRAMES` kare çizilince "hazır" der.
*/
export const FIRST_FRAMES = 3;
/** Hazır sayımı: her kare çağrılır; `FIRST_FRAMES`. kareyi ilk görende true (sonra bir daha true dönmez). */
export function countFirstFrames(n: number): { n: number; ready: boolean } {
  const next = n + 1;
  return { n: next, ready: next === FIRST_FRAMES };
}
/** deniz düzlemi yakın suyla aynı akış şeritleri + ışık tabanı (citymap/farWater.ts) — uzak deniz "taş" gibi düz okunmaz.*/
function OceanPlane({ color, position, size, onClick }: { color: string; position: [number, number, number]; size: number; onClick: (e: ThreeEvent<MouseEvent>) => void }) {
  const geometry = useMemo(() => oceanGeometry(size), [size]);
  const material = useMemo(() => oceanMaterial(color), [color]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  return <mesh geometry={geometry} material={material} position={position} onClick={onClick} receiveShadow />;
}

function FirstFrame({ onReady }: { onReady: () => void }) {
  const n = useRef(0);
  useFrame(() => {
    if (n.current >= FIRST_FRAMES) return;
    const r = countFirstFrames(n.current);
    n.current = r.n;
    if (r.ready) onReady();
  });
  return null;
}
/** 3B alan yüklenirken iskelet ("sahne yükleniyor"); 60 sn sonra kendiliğinden kalkar (hata sahneyi örtmesin). */
export const SCENE_LOADING_GIVEUP_MS = 60_000;
function SceneLoading() {
  return (
    <div role="status" data-scene-loading=""
      className="pointer-events-none absolute inset-0 z-[5] grid place-items-center bg-panel-2">
      <div className="flex flex-col items-center gap-3 text-ink-2">
        <div aria-hidden="true" className="grid grid-cols-3 gap-1.5 motion-safe:animate-pulse">
          {Array.from({ length: 9 }, (_, i) => <span key={i} className="h-5 w-5 rounded-[4px] border-2 border-line-soft bg-panel-3" />)}
        </div>
        <p className="text-sm font-semibold">{tx(M, "scene_loading")}</p>
      </div>
    </div>
  );
}

export const World = forwardRef<WorldHandle, Props>(function World(props, ref) {
  const [sceneReady, setSceneReady] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSceneReady(true), SCENE_LOADING_GIVEUP_MS);
    return () => window.clearTimeout(id);
  }, []);
  // SP-W0: kilitli sahne önizlemesi (20 sn; sahne ayarı değişmez)
  const preview = useScenePreview((s) => s.id);
  const previewReduced = useReducedMotion();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const camApi = useRef<CamApi>({ reset: () => undefined, focus: () => undefined, zoom: () => undefined });
  // geliştirme: ekran görüntüsü betikleri kamerayı bir noktaya odaklayabilsin (S48; üretim derlemesinde yok)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voxcrewCam?: CamApi };
    w.__voxcrewCam = {
      reset: () => { if (!walking()) camApi.current.reset(); },
      focus: (x, z, d) => { if (!walking()) camApi.current.focus(x, z, d); },
      zoom: (f) => { if (!walking()) camApi.current.zoom(f); },
    };
    return () => { delete w.__voxcrewCam; };
  }, []);
  // W2: yürüme modu — kurulmuş dünya (doğma), "Ben" görünümü, durum
  const builtRef = useRef<{ built: Built; core: SceneCore | null } | null>(null);
  const meStore = useMeLook();
  const me = useMemo<MeLook>(() => ({ ...meStore, name: meStore.name || tx(WM, "me_default") }), [meStore]);
  const walkOn = useWalkActive();
  const sceneId = (preview ?? props.scene) as string;
  const walkEnter = useCallback((saved?: { x: number; z: number } | null) => {
    const b = builtRef.current;
    if (!b || useScenePreview.getState().id || useWalkStore.getState().active) return;
    // W4: Y tuşu da dünya başına kayıtlı konumdan devam eder (lib/walk.ts)
    useWalkStore.getState().enter(sceneId, spawnPose(b.built, b.core, saved ?? savedWalkPosition(sceneId), walkGates(sceneId, b.built))); // HQA-FIX
    wrap.current?.focus({ preventScroll: true });
  }, [sceneId]);
  const walkExit = useCallback(() => {
    if (useWalkStore.getState().active) useWalkStore.getState().exit();
    wrap.current?.focus({ preventScroll: true });
  }, []);
  // sahne önizlemesi başlarsa ya da sahne değişirse moddan çık; sayfa sökülünce de (konum W4'te kaydedilir)
  useEffect(() => { if (preview && useWalkStore.getState().active) useWalkStore.getState().exit(); }, [preview]);
  useEffect(() => () => { if (useWalkStore.getState().active) useWalkStore.getState().exit(); }, [sceneId]);
  const onInteractRef = useRef(props.onInteract);
  onInteractRef.current = props.onInteract;
  // klavye: Y girer; mod açıkken WASD/oklar, Shift, F, Q/E, V, +/−, Tab, Esc (input.ts). Yalnızca kap odaktayken.
  const tabIdx = useRef(-1);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    return attachWalkKeyboard(el, {
      onEnter: () => walkEnter(),
      onExit: () => el.focus({ preventScroll: true }),
      onInteract: () => { const id = useWalkStore.getState().focusId; if (id) onInteractRef.current?.(id); },
      onNextTarget: (d) => {
        const list = useWalkStore.getState().nearby;
        if (!list.length) return;
        tabIdx.current = (tabIdx.current + d + list.length) % list.length;
        const it = list[tabIdx.current];
        useWalkStore.getState().setTarget(tileAt(it.x, it.z));
      },
    });
  }, [walkEnter]);
  const ownLive = useMemo(createLive, []);
  const live = props.live ?? ownLive;
  const zonesRef = useRef<Zone[]>([]);
  const onZones = useCallback((z: Zone[]) => { zonesRef.current = z; }, []);
  useImperativeHandle(ref, () => ({
    resetCamera: () => { if (!walking()) camApi.current.reset(); },
    focusAgent: (slug) => { const p = live.positions.get(slug); if (p && !walking()) camApi.current.focus(p.x, p.z); },
    panTo: (x, z) => { if (!walking()) camApi.current.focus(x, z, undefined); },
    focusTeam: (slug) => {
      if (walking()) return;
      const z = zonesRef.current.find((zz) => zz.sign && zz.team.slug === slug) ?? zonesRef.current.find((zz) => zz.team.slug === slug);
      if (z) camApi.current.focus(tileX(z.station.tile[0]), tz(z.station.tile[1]), 16);
    },
    zoom: (f) => { if (!walking()) camApi.current.zoom(f); },
    walkEnter, walkExit,
    walkTo: (x, z) => { if (walking()) useWalkStore.getState().setTarget(tileAt(x, z)); },
    focusWorld: () => wrap.current?.focus({ preventScroll: true }),
  }), [live, walkEnter, walkExit]);
  // W2: yürüme modunda ajan tıklaması o ajana yürür (W3'e dek kart F ile açılır); kapalıyken seçim aynen
  const onSelectRef = useRef(props.onSelect);
  onSelectRef.current = props.onSelect;
  const onSceneSelect = useCallback((slug: string | null) => {
    if (walking()) {
      const p = slug ? live.positions.get(slug) : null;
      if (p) useWalkStore.getState().setTarget(tileAt(p.x, p.z));
      return;
    }
    onSelectRef.current(slug);
  }, [live]);

  // klavye: ok tuşları kaydırır (kameranın baktığı yöne göre), +/- yakınlaştırır, Home sıfırlar, Esc seçimi kaldırır
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (walking()) return; // yürüme tuşları attachWalkKeyboard'da
    const c = controls.current;
    const step = 2;
    const move = (dx: number, dz: number) => {
      if (!c) return;
      const dir = new THREE.Vector3().subVectors(c.target, c.object.position); dir.y = 0; dir.normalize();
      const right = new THREE.Vector3(dir.z, 0, -dir.x);
      const d = dir.multiplyScalar(dz * step).addScaledVector(right, dx * step);
      camApi.current.focus(c.target.x + d.x, c.target.z + d.z, c.object.position.distanceTo(c.target));
    };
    switch (e.key) {
      case "ArrowUp": move(0, 1); break;
      case "ArrowDown": move(0, -1); break;
      case "ArrowLeft": move(1, 0); break;
      case "ArrowRight": move(-1, 0); break;
      case "+": case "=": camApi.current.zoom(0.8); break;
      case "-": case "_": camApi.current.zoom(1.25); break;
      case "Home": camApi.current.reset(); break;
      case "Escape": props.onSelect(null); break;
      default: return;
    }
    e.preventDefault();
  };

  return (
    <div ref={wrap} className="relative h-full w-full outline-none focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-[color:var(--focus)]"
      tabIndex={0} role="application" aria-label={tx(M, "page_world_aria")}
      aria-keyshortcuts={walkOn ? WALK_KEYSHORTCUTS : `ArrowUp ArrowDown ArrowLeft ArrowRight + - Home Escape ${IDLE_KEYSHORTCUTS}`}
      onKeyDown={onKey}>
      <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 12.5, 17], fov: 38, near: 0.5, far: 400 }}
        gl={{ antialias: true }} onPointerMissed={() => { if (walking()) return; props.onSelect(null); props.onHover?.(null); }}>
        <Scene {...props} onSelect={onSceneSelect} scene={(preview ?? props.scene) as Props["scene"]} overlay={overlay} labels={labels} live={live} camApi={camApi} onZones={onZones}
          controls={controls} builtRef={builtRef} me={me} />
        <OrbitControls ref={controls} target={[0, 0.4, 0.8]} autoRotate={!!preview && !previewReduced} autoRotateSpeed={0.9} enablePan enableDamping dampingFactor={0.08} panSpeed={0.9}
          screenSpacePanning={false} minDistance={7} maxDistance={32} minPolarAngle={0.3} maxPolarAngle={1.28}
          mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
        <FirstFrame onReady={() => setSceneReady(true)} />
      </Canvas>
      {!sceneReady && <SceneLoading />}
      {/* hafif ad etiketleri (HUD'u olmayan yakın ajanlar): tek 2B tuval */}
      <canvas ref={labels} className="pointer-events-none absolute inset-0" aria-hidden="true" />
      {/* isolate: etiketlerin z-index'i (drei Html, 0–60) bu katmanın içinde kalır; bilgi kartı ve sahne seçici her zaman üstte */}
      <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden isolate" />
    </div>
  );
});
