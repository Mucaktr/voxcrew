/**
 * S43 — ortam canlılığı: sahneye uygun hayvanlar ve küçük canlı ayrıntılar (park: kuş, güvercin, kedi, sincap, ördek,
 * balık; sahil/deniz/yat: martı, yunus, balık gölgesi, yengeç; kamp/kar: tavşan, geyik, gece baykuş ve ateş böceği;
 * ofis/ev/okul/AVM/kafe: kedi, robot süpürge, pencere pervazında güvercin, akvaryum balığı; uzay: uydu, mekik, istasyon
 * robotu). Gündüz/gece (S33): geceleri kuşlar tüner (uçmaz, başı gömük), sincap ve güvercin çekilir, baykuş/ateş böceği çıkar.
 *
 * PHYS: yürüyen hayvanlar katı eşya karolarına girmez (habitat) ve karakter bedenlerinin (ajan + avatar, yarıçap 0,24) içine
 * adım atmaz; bir karakter üstüne yürürse hayvan dışarı itilir (karakter itilmez). Uçan kuş, yüzen, tüneyen muaf.
 * Ucuz: bütün hayvanlar tek örneklenmiş kutu dizisinde (+ parlayan parçalar için ikinci dizi) → en çok 2 çizim çağrısı,
 * gölge yok. Sayı dünya boyutuyla büyür ama tavanlıdır (MAX_ANIMALS). Hayvanlar karo ızgarasında yürür (duvar/engel
 * karosuna girmez), ajana yaklaşınca kaçar/havalanır, hiçbir karoyu engellemez (yol bulmaya katılmaz); istasyon, araç,
 * dinlenme ve uyku karolarında uyumaz. Tıklayınca küçük ad etiketi ("Kedi" / "Cat"). Hareket azaltmada durağan (tünemiş,
 * oturan); yunus, ateş böceği ve mekik gizli. Ayar: Dünya araçları → "Ortam canlılığı" (settings.ts).
 *
 * S48 — dokununca tepki: kedi miyavlar/mırlar (kalpler), ikinci dokunuşta yuvarlanır, üçüncüde sıkılıp uzaklaşır; köpek
 * kuyruk sallayıp havlar; kuş/martı ürküp havalanır; güvercin pır pır kaçar; ördek vaklayıp uzaklaşır; sincap ağaca fırlar;
 * tavşan kaçar; geyik başını kaldırıp sıçrar; baykuş göz kırpıp öter; ateş böcekleri dağılıp toplanır; balık kaçar; yunus
 * bir kez daha zıplar; yengeç yan yan kaçar; robot süpürge bipleyip döner. Durağan öğeler (tek görünmez hedef dizisi):
 * ağaç hışırdar (yaprak düşer, tepesindeki kuş havalanır), çiçekten taç yaprakları uçuşur, lamba yanar/söner, kahve
 * makinesi buhar üfler, gölet/fıskiye şıpırdar (ördek ve balık kaçar), akvaryumda balıklar cama gelir. Ses yalnızca genel
 * ses ayarı açıksa (sfx/sfx.ts); kısa etiket + kibar canlı bölge duyurusu (fun/announce.ts). Hareket azaltmada yalnızca
 * ses, etiket ve lamba (hareket/parçacık yok).
 */
import { Html } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { tx as msg } from "../../lib/i18n";
import { world as M } from "../../locales/world";
import type { WorldLive } from "../live";
import { say, useSaid } from "../fun/announce";
import { ambientNearby, avatarPokes, type AmbientEntity } from "../fun/avatarActs";
import { inQuietZone } from "../fun/brain";
import { box, burst, C, minuteOfDay, starShowerLevel, stepStarShower, type FxState, type SkyShow } from "../fun/fx";
import { reducedMotion, useReducedMotion } from "../motion";
import { playSfx, type Sfx } from "../sfx/sfx";
import { rng, tx, tz, W, D, worldBounds, type Built, type Tile } from "../scenes";
import { FULL_AMBIENT_DAY, FULL_AMBIENT_NIGHT, FULL_SKY_SHOWS } from "../../full/ambient";
import { habitat, type Habitat, type Spot, type Water } from "./habitat";
import { AMBIENT_WALK_FIXED, ambientWalkScale, KIND_KEY, kindParts, type APart, type Kind } from "./kinds";
import { biomeOf, biomeSpecies } from "../fun/minigameLogic";
import { animalCue, hotCue, hotYields, lureCue, noteTouch, PICK_ANIMAL, PICK_HOT, touchPlan } from "./touch";
import { lampSwitch } from "./lampSwitch";
import { fearAt, hopDuration, hopLift, hopTarget, paddleTarget, setFear } from "./fear";
import { hotspots } from "./hotspots";
import { useAmbientLife } from "./settings";
import { walkRuntime } from "../walk/walkStore";
import { ritualFx, type RitualLureFx } from "../fun/ritualRuntime";
import { NEW_CITIES } from "../cities/index";
import { flushDiff, resetShadow } from "../instanceDirty";

type Profile = Partial<Record<Kind, number>>;
/** Sahne → tür başına temel sayı (24×16 taban sahne için). Gece eklenenler ayrı. */
const DAY: Record<string, Profile> = {
  office: { cat: 1, vacuum: 1, pigeon: 2, fish: 4 },
  home: { cat: 1, vacuum: 1, pigeon: 1, fish: 3 },
  cafe: { cat: 1, pigeon: 1, fish: 3 },
  mall: { vacuum: 2, pigeon: 2, fish: 5 },
  school: { vacuum: 1, pigeon: 2, fish: 4, cat: 1 },
  space: { satellite: 3, shuttle: 1, robot: 2 },
  park: { bird: 7, pigeon: 4, cat: 2, squirrel: 2, duck: 4, fish: 4, dog: 1 },
  beach: { gull: 6, dolphin: 2, fish: 4, crab: 3, dog: 1 },
  sea: { gull: 6, dolphin: 3, fish: 5, crab: 1 },
  yacht: { gull: 5, dolphin: 3, fish: 3 },
  camp: { bird: 3, rabbit: 3, deer: 2, squirrel: 1, duck: 2, fish: 3, dog: 1 },
  snow: { bird: 3, rabbit: 3, deer: 2 },
  battlefield: { bird: 7, rabbit: 2, pigeon: 2 },
  // SP-W1 pilot şehirler
  istanbul: { cat: 4, gull: 6, pigeon: 3, bird: 2, fish: 5 },
  londra: { pigeon: 4, squirrel: 2, duck: 4, bird: 3, fish: 4 },
  // WORLD-FIX: Seine (nehir biyomu: sazan, alabalık, turna, yılan balığı, yayın)
  kapadokya: { bird: 7 },
  ...FULL_AMBIENT_DAY,
  ...Object.fromEntries(NEW_CITIES.map((m) => [m.catalog.id, m.ambient.day])),
};
const NIGHT: Record<string, Profile> = {
  park: { owl: 1, firefly: 10 },
  camp: { owl: 2, firefly: 16 },
  snow: { owl: 1 },
  battlefield: { owl: 1, firefly: 6 },
  londra: { owl: 1 },
  ...FULL_AMBIENT_NIGHT,
  ...Object.fromEntries(NEW_CITIES.flatMap((m) => (m.ambient.night ? [[m.catalog.id, m.ambient.night] as const] : []))),
};
const INDOOR = new Set(["office", "home", "cafe", "mall", "school", "space"]);
/** Gece görünmeyenler (yuvasına çekilir). Kuşlar ve martılar tüner (görünür, durağan). */
const DAY_ONLY = new Set<Kind>(["squirrel", "pigeon"]);
const MAX_ANIMALS = 72;
/** WATER-ALL: bundan küçük su cebi ördek/balık barındırmaz (güverte arası birkaç karo). */
export const MIN_POND = 4;
/** WORLD-FIX: balık sıçrayışı süresi (sn) ve akvaryum türleri (tatlı/tropik süs balıkları) */
const LEAP_S = 0.85;
const AQUARIUM: readonly string[] = ["palyaco", "japon", "cerrah", "koi"];

type Mode = "walk" | "fly" | "water" | "tree" | "perch" | "ledge" | "jump" | "orbit" | "drift" | "line" | "aquarium";

interface Animal {
  kind: Kind; mode: Mode; parts: APart[]; slots: Int32Array; v: number;
  x: number; y: number; z: number; yaw: number; pitch: number; roll: number; sc: number; squash: number;
  head: number; headYaw: number; wing: number; tail: number; swing: number; legsOff: boolean; blink: boolean; hidden: boolean; drawnHidden: boolean;
  st: string; until: number; gx: number; gy: number; gz: number; speed: number;
  home: Spot; homeR: number; water: Water | null; perch: Spot | null; t0: number;
  /** S48 tepki: tür, başlangıç/bitiş, ardışık dokunuş sayısı, hız artışı (bitiş, çarpan), kavis uçlarıyla yan sapma, yunus tekrar,
   *  efekt zamanı ve tepkiden sonra yapılacak ("flee": geyik bakıp kaçar) */
  rx: Rx | null; rxT: number; rxUntil: number; taps: number; tapAt: number; boost: number; boostK: number;
  ax: number; ay: number; az: number; bx: number; by: number; bz: number; lx: number; lz: number; again: number; emitAt: number; then: "" | "flee";
  /** WORLD-FIX: balığın bir sonraki sudan sıçrayışı (sahne saati, sn) */
  leapAt: number;
  /** ritüel çekmesi (null: kendi davranışı)*/
  lu: Lured | null;
  /** FEAR: güvercin kaçış atlayışı (yay): başlangıç/bitiş sahne saati ve uçlar */
  hop?: { t0: number; dur: number; sx: number; sz: number; ex: number; ez: number } | null;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const HUGE = new THREE.Sphere(new THREE.Vector3(), 1e4);
const _m = new THREE.Matrix4(), _b = new THREE.Matrix4(), _p = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, "YXZ"), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const ONE = new THREE.Vector3(1, 1, 1), I = new THREE.Quaternion();
const TAIL_Y = new Set<Kind>(["cat", "fish", "dog"]);

/** yürüme ölçeğinde hayvanın çizim çarpanı (`ws` = ambientWalkScale(humanScale)); uzay canlıları, yunus ve akvaryum
 * balığı (tank chibi eşya ölçeğinde) hariç. Yalnız çizim, ad etiketi ve tıklama kutusu; konum ve davranış aynı.*/
const walkK = (a: Pick<Animal, "kind" | "mode">, ws: number) => (ws === 1 || a.mode === "aquarium" || AMBIENT_WALK_FIXED.has(a.kind) ? 1 : ws);

function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export interface AmbientProps {
  built: Built;
  /** sahne kimliği (yerleşik) ya da kullanıcı dünyasının teması (annex); bilinmiyorsa yaşam alanından türetilir */
  kit: string;
  night: boolean;
  live: WorldLive;
  /** ufka uzanan deniz (deniz/yat sahneleri): yunus ve martılar ızgaranın dışında da dolaşır */
  ocean?: { y: number } | null;
  /** WATER-ALL: yalnız durağan dokunma hedefleri (hayvan ve gök gösterisi yok): iç mekân, şehir görünümü */
  hotOnly?: boolean;
}

/** Ayar kapalıysa hayvan çizilmez (çizim çağrısı yok). S48: durağan öğe tepkileri (ağaç, çiçek, lamba…) ayardan bağımsızdır. */
export function Ambient(props: AmbientProps) {
  const on = useAmbientLife((s) => s.on);
  const api = useRef<LifeApi>({ poke: () => undefined });
  return (
    <>
      {on && !props.hotOnly && <AmbientLife {...props} api={api} />}
      {!props.hotOnly && <SkyShowDriver {...props} />}
      <Interactables built={props.built} live={props.live} api={api} />
      <ReactionTag />
    </>
  );
}

function profileFor(kit: string, h: Habitat, night: boolean): Profile {
  let base: Profile | undefined = DAY[kit];
  if (!base) {
    // kullanıcı dünyası / bilinmeyen tema: yaşam alanından
    base = {};
    if (h.trees.length) { base.bird = 4; base.squirrel = 1; }
    if (h.ponds.length) { base.duck = 2; base.fish = 2; }
    if (h.seas.length) { base.gull = 3; base.dolphin = 1; }
    if (h.sand.length) base.crab = 1;
    if (h.ground.length > 40) base.cat = 1;
  }
  const out: Profile = { ...base };
  if (night) {
    for (const k of DAY_ONLY) if (!INDOOR.has(kit)) delete out[k];
    Object.assign(out, NIGHT[kit] ?? (h.trees.length && !INDOOR.has(kit) && !DAY[kit] ? { owl: 1 } : {}));
  }
  return out;
}

/** gök gösterisi sürücüsü ("Yıldız sağanağı", fun/fx.ts): kendi simgesi dünyada varken (bölge etiketi ve boyu eşleşir;
 * büyümüş dünyada taban kaydırması bölgenin karosundan okunur), yalnız gece ve hareket azaltma kapalıyken; zamanlama yerel saatten
 * saniyede bir okunur. Parçacıklar ortak fx havuzunda (en çok +1 çizim çağrısı, yalnız gösteri sürerken). Ortam canlıları kapalı
 * olsa da çalışır.*/
const SKY_SHOWS = FULL_SKY_SHOWS;
function SkyShowDriver({ built, kit, night, live }: AmbientProps) {
  const show = useMemo<SkyShow | null>(() => {
    for (const s of SKY_SHOWS) {
      const t = s.show;
      if (s.kit !== kit) continue;
      const z = built.zones?.find((q) => q.kind === "landmark" && q.tag === t.tag && q.w === t.w && q.d === t.d);
      if (z) return { x: t.x + (z.i0 - t.i0), z: t.z + (z.j0 - t.j0), h0: t.h0, h1: t.h1, y0: t.y0, y1: t.y1 };
    }
    return null;
  }, [built, kit]);
  const st = useRef({ acc: 0, level: 0, next: 0, force: 0, t: 0 });
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // geliştirme: gösteriyi beklemeden başlat (canlı denetim) ve durumu oku
    const w = window as unknown as { __voxcrewSkyShow?: unknown };
    w.__voxcrewSkyShow = {
      start: (sec = 30) => { st.current.force = st.current.t + sec; return !!show; },
      state: () => ({ show: !!show, night, level: st.current.t < st.current.force ? 1 : st.current.level, drawn: live.fx.drawn, calm: live.fx.calm,
        alive: live.fx.ps.filter((p) => p.on).length }),
    };
    return () => { delete w.__voxcrewSkyShow; };
  }, [show, night, live]);
  useFrame((state, rawDt) => {
    const s = st.current, t = state.clock.elapsedTime;
    s.t = t;
    if (!show || !night || reducedMotion()) { s.acc = 0; return; }
    if (t >= s.next) { s.next = t + 1; s.level = starShowerLevel(minuteOfDay(new Date())); }
    s.acc = stepStarShower(live.fx, show, t < s.force ? 1 : s.level, Math.min(rawDt, 0.05), s.acc);
  });
  return null;
}

function AmbientLife({ built, kit, night, live, ocean = null, api }: AmbientProps & { api: MutableRefObject<LifeApi> }) {
  const solid = useRef<THREE.InstancedMesh>(null);
  const glow = useRef<THREE.InstancedMesh>(null);
  const calm = useReducedMotion();
  const h = useMemo(() => habitat(built), [built]);
  const { animals, nSolid, nGlow } = useMemo(() => spawn(built, h, kit, night, ocean), [built, h, kit, night, ocean]);
  const solidMat = useMemo(() => new THREE.MeshLambertMaterial(), []);
  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  useEffect(() => () => { solidMat.dispose(); glowMat.dispose(); }, [solidMat, glowMat]);
  const owner = useRef(new Int32Array(0));
  const occ = useRef<{ grid: Uint8Array; touched: number[] }>({ grid: new Uint8Array(0), touched: [] });
  const staticDone = useRef(false);
  const clock = useRef({ t: 0, cx: 0, cz: 0 });
  const lure = useRef<LureSync>(lureState());
  const wsDrawn = useRef(1);
  const camera = useThree((st) => st.camera), gl = useThree((st) => st.gl);
  // geliştirme: dünya → ekran (CSS px, sayfaya göre); ekran görüntüsü betikleri gerçek tıklama yapabilsin
  const toScreen = (x: number, y: number, z: number) => {
    const v = new THREE.Vector3(x, y, z).project(camera), r = gl.domElement.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  };

  // renkler ve yuva sahipliği (yalnızca hayvan kümesi değişince)
  useEffect(() => {
    const s = solid.current, g = glow.current;
    owner.current = new Int32Array(Math.max(1, nSolid)).fill(-1);
    animals.forEach((a, ai) => a.parts.forEach((p, i) => {
      const mesh = p.glow ? g : s;
      if (!mesh) return;
      mesh.setColorAt(a.slots[i], _c.set(p.c));
      if (!p.glow) owner.current[a.slots[i]] = ai;
    }));
    for (const mesh of [s, g]) if (mesh) {
      mesh.instanceMatrix.array.fill(0);
      mesh.instanceMatrix.needsUpdate = true;
      resetShadow(mesh.instanceMatrix); // sonraki flushDiff tam yükler (bu tam yüklemeyle aynı karede aralık kalmasın)
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.boundingSphere = HUGE;
    }
    staticDone.current = false;
  }, [animals, nSolid, nGlow]);
  useEffect(() => { staticDone.current = false; }, [calm]);

  useFrame((state, rawDt) => {
    const s = solid.current, g = glow.current;
    if (!s) return;
    const quiet = reducedMotion();
    const t0 = performance.now();
    const t = state.clock.elapsedTime, dt = Math.min(rawDt, 0.05);
    clock.current.t = t; clock.current.cx = state.camera.position.x; clock.current.cz = state.camera.position.z;
    // ritüel çekmesi (ritualFx.lure); değişince ya da süresi dolunca bırakılır ve durağan çizim yenilenir
    const L = lure.current, me0 = avatarPos();
    if (lureSync(animals, L, ritualFx.lure, t0, t, h, night, me0 ? { x: me0.x, z: me0.z, heading: me0.heading, scale: walkRuntime.humanScale } : null, quiet)) staticDone.current = false;
    if (L.cue) { playSfx(L.cue); L.cue = null; }
    // yürüme ölçeği insanla birlikte (600 ms geçiş; hareket azaltmada humanScale kesilir → durağan çizim bir kez yenilenir)
    const ws = ambientWalkScale(walkRuntime.humanScale);
    if (ws !== wsDrawn.current) { wsDrawn.current = ws; staticDone.current = false; }
    if (quiet) setFear(null);
    if (quiet && staticDone.current) return;
    if (!quiet) {
      // ajan doluluk ızgarası (kaçma için): yalnızca dokunulan hücreler temizlenir
      const o = occ.current, n = h.width * h.depth;
      if (o.grid.length !== n) { o.grid = new Uint8Array(n); o.touched = []; }
      for (const k of o.touched) o.grid[k] = 0;
      o.touched.length = 0;
      bodiesReset(h.width * h.depth);
      for (const p of live.positions.values()) {
        const i = Math.floor(p.x + W / 2), j = Math.floor(p.z + D / 2);
        if (i < 0 || j < 0 || i >= h.width || j >= h.depth) continue;
        const k = j * h.width + i;
        if (!o.grid[k]) { o.grid[k] = 1; o.touched.push(k); }
        bodiesAdd(k, p.x, p.z);
      }
      const me = avatarPos();
      setFear(me, walkRuntime.humanScale); // FEAR: avatarın yaklaşması hayvanları ürkütür (hareket azaltmada döngü bu bloğa girmez)
      if (me) { const i = Math.floor(me.x + W / 2), j = Math.floor(me.z + D / 2); if (i >= 0 && j >= 0 && i < h.width && j < h.depth) bodiesAdd(j * h.width + i, me.x, me.z); }
    }
    // HQA-FIX: çekilen hayvan gerçek zamanla yol alır — düşük kare hızında (5 fps, kare 0,2 sn) `dt` 0,05'e kısıldığı
    // için güvercin/martı ritüel süresi (3–4 sn) içinde hiç varamıyor, ritüel bitince geri dönüyordu (oyuncu hiç kuş görmüyordu);
    // kare süresi en çok 0,25 sn'ye kadar 0,05'lik alt adımlara bölünür (`lureSubsteps`)
    const lureN = lureSubsteps(rawDt);
    for (const a of animals) {
      if (quiet) { if (a.lu?.rel) lureDone(a, t); restPose(a, h); if (a.lu) lureRest(a); }
      else if (a.lu) { for (let k = 0; k < lureN && a.lu; k++) lureStep(a, L, t, dt, h); }
      else step(a, t, dt, h, occ.current.grid, night, ocean, live.fx);
      write(a, s, g, quiet ? 0 : t, ws);
    }
    // yalnız değişen hayvan yuvaları GPU'ya (dinlenen/uyuyan hayvanlar, gizliler ve hareket azaltma: yükleme yok)
    flushDiff(s.instanceMatrix, 16);
    if (g) flushDiff(g.instanceMatrix, 16);
    staticDone.current = quiet;
    walkBridge(t);
    live.ambientMs = live.ambientMs * 0.9 + (performance.now() - t0) * 0.1;
  });

  // S48: dokunma tepkisi (tıklama ya da durağan öğeden dürtme)
  const onReact = (ai: number) => {
    const a = animals[ai];
    if (!a || a.hidden) return;
    const { t, cx, cz } = clock.current;
    // sakin bölgede (ibadet yeri çevresi) yalnızca ad etiketi; hareket azaltmada hareket/parçacık yok, ses ve etiket var (touch.ts)
    const plan = touchPlan("animal", { quiet: inQuietZone(a.x, a.z), reduced: reducedMotion() });
    const sc = a.sc * walkK(a, ambientWalkScale(walkRuntime.humanScale)); // etiket çizilen boyun üstünde
    if (plan.nameOnly) {
      say(msg(M, KIND_KEY(a.kind)), a.x, a.y + 0.5 * sc, a.z);
      noteTouch({ target: "animal", kind: a.kind, msg: null, sfx: null, motion: false, quiet: true });
      return;
    }
    const r = react(a, animals, t, h, live.fx, cx, cz, !plan.motion);
    if (r[1] && plan.sound) playSfx(r[1]);
    say(msg(M, r[0]), a.x, a.y + 0.5 * sc + (a.kind === "deer" ? sc : 0.2), a.z);
    noteTouch({ target: "animal", kind: a.kind, msg: r[0], sfx: r[1], motion: plan.motion, quiet: false });
  };
  // W3 (WALK-FUN): avatarın dokunuşu (en yakın hayvan ≤ 1,8 birim) ve Yakındakiler için hayvan listesi (≈ 4 Hz)
  const pub = useRef({ at: 0, list: [] as AmbientEntity[] });
  const walkBridge = (t: number) => {
    const req = avatarPokes.req;
    if (req && !req.done) {
      let best = -1, bd = 1.8;
      animals.forEach((a, i) => { if (a.hidden) return; const d = Math.hypot(a.x - req.x, a.z - req.z); if (d < bd) { bd = d; best = i; } });
      if (best >= 0) { req.done = true; onReact(best); }
    }
    const P = pub.current;
    if (t - P.at < 0.25) return;
    P.at = t;
    // `type` = hayvan türü (hayvana bağlı ritüel `kedi_mama` bununla eşleşir; fun/rituals/logic.ts anchorsOf)
    if (P.list.length !== animals.length) P.list = animals.map((a, i) => ({ id: `animal:${i}`, kind: "animal", x: a.x, z: a.z, label: msg(M, KIND_KEY(a.kind)), type: a.kind }));
    animals.forEach((a, i) => { const e = P.list[i]; e.x = a.hidden ? 1e6 : a.x; e.z = a.hidden ? 1e6 : a.z; });
    ambientNearby.animals = P.list;
  };
  useEffect(() => () => { ambientNearby.animals = []; }, [animals]);
  // hareket azaltmada döngü erken döner: dokunuş ve liste yine işlensin
  useFrame((state) => { if (reducedMotion() && staticDone.current) walkBridge(state.clock.elapsedTime); });
  useEffect(() => {
    api.current.poke = (what, x, z) => {
      const { t, cx, cz } = clock.current;
      if (reducedMotion()) return;
      for (const a of animals) {
        if (a.hidden) continue;
        const d = Math.hypot(a.x - x, a.z - z);
        if (what === "tree" && d < 2.4 && ((a.mode === "fly" && a.st === "perch" && a.y > 0.6) || (a.kind === "squirrel" && a.st === "ground"))) react(a, animals, t, h, live.fx, cx, cz, false);
        else if (what === "water" && d < 2.6 && (a.kind === "duck" || (a.kind === "fish" && a.mode === "water"))) react(a, animals, t, h, live.fx, cx, cz, false);
        else if (what === "aquarium" && a.mode === "aquarium" && Math.hypot(a.home.x - x, a.home.z - z) < 0.6) glassRx(a, t, cx, cz);
      }
    };
    return () => { api.current.poke = () => undefined; };
  }, [animals, h, live, api]);

  // geliştirme: ölçüm/ekran görüntüsü betikleri için salt okunur inceleme kancası (üretim derlemesinde yok)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voxcrewAmbient?: unknown };
    w.__voxcrewAmbient = {
      list: () => animals.map((a, i) => ({ i, kind: a.kind, x: +a.x.toFixed(2), y: +a.y.toFixed(2), z: +a.z.toFixed(2), st: a.st, hidden: a.hidden, lu: a.lu ? a.lu.ph : null })),
      bounds: () => worldBounds(built),
      ms: () => live.ambientMs,
      pick: (i: number) => onReact(i),
      screen: (i: number) => toScreen(animals[i]?.x ?? 0, (animals[i]?.y ?? 0) + 0.15, animals[i]?.z ?? 0),
    };
    return () => { delete w.__voxcrewAmbient; };
  }); // her çizimde: onReact güncel kapanışı görsün (yalnızca DEV)

  const animalAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const ai = e.instanceId != null ? owner.current[e.instanceId] ?? -1 : -1;
    return ai >= 0 && !animals[ai]?.hidden ? ai : -1;
  };
  const click = (e: ThreeEvent<MouseEvent>) => {
    const ai = animalAt(e);
    if (ai < 0) return;
    e.stopPropagation();
    onReact(ai);
  };
  const over = (e: ThreeEvent<PointerEvent>) => { if (animalAt(e) >= 0) { e.stopPropagation(); document.body.style.cursor = "pointer"; } };
  const out = () => { document.body.style.cursor = ""; };

  return (
    <>
      <instancedMesh key={`as${nSolid}`} ref={solid} args={[unitBox, solidMat, Math.max(1, nSolid)]} frustumCulled={false} onClick={click}
        onPointerOver={over} onPointerOut={out} name={PICK_ANIMAL} />
      {nGlow > 0 && <instancedMesh key={`ag${nGlow}`} ref={glow} args={[unitBox, glowMat, nGlow]} frustumCulled={false} name="ambient:glow" />}
    </>
  );
}

// ------------------------------------------------------------------ yerleştirme
export function spawn(built: Built, h: Habitat, kit: string, night: boolean, ocean: { y: number } | null) {
  const r = rng(hashStr(`${kit}:${built.width}x${built.depth}`));
  const pickOf = <T,>(xs: readonly T[]): T | undefined => (xs.length ? xs[Math.floor(r() * xs.length)] : undefined);
  const prof = profileFor(kit, h, night);
  const f = Math.min(2.4, Math.max(1, Math.sqrt((built.width * built.depth) / (W * D))));
  const animals: Animal[] = [];
  let nSolid = 0, nGlow = 0;
  const snow = kit === "snow";
  const cx = tx(0) + (built.width - 1) / 2, cz = tz(0) + (built.depth - 1) / 2;
  const half = Math.hypot(built.width, built.depth) / 2;
  const tileSpot = (t: Tile): Spot => ({ x: tx(t[0]), y: 0, z: tz(t[1]) });
  const quietTile = (list: Tile[]) => {
    for (let k = 0; k < 8; k++) { const t = pickOf(list); if (t && !h.busy.has(`${t[0]},${t[1]}`)) return t; }
    return pickOf(list);
  };

  const add = (kind: Kind, mode: Mode, home: Spot, extra: Partial<Animal> = {}, species?: string) => {
    if (animals.length >= MAX_ANIMALS) return;
    const v = r();
    const parts = kindParts(kind, v, { snow, shadow: mode !== "aquarium", species });
    const slots = new Int32Array(parts.length);
    parts.forEach((p, i) => { slots[i] = p.glow ? nGlow++ : nSolid++; });
    animals.push({
      kind, mode, parts, slots, v, x: home.x, y: home.y, z: home.z, yaw: r() * Math.PI * 2, pitch: 0, roll: 0, sc: 1, squash: 1,
      head: 0, headYaw: 0, wing: 0, tail: 0, swing: 0, legsOff: false, blink: true, hidden: false, drawnHidden: false,
      st: "rest", until: r() * 3, gx: home.x, gy: home.y, gz: home.z, speed: 0.5, home, homeR: 3, water: null, perch: null, t0: r() * 100,
      rx: null, rxT: 0, rxUntil: 0, taps: 0, tapAt: -99, boost: 0, boostK: 1, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, lx: 0, lz: 0, again: 0, emitAt: 0, then: "",
      leapAt: Infinity, lu: null,
      ...extra,
    });
  };

  const indoor = INDOOR.has(kit);
  const perchesAll: Spot[] = [...h.trees, ...h.perches];
  // WATER-ALL: ufacık su cepleri (< MIN_POND karo) ördek/balık barındırmaz; her gerçek gölete (kancalı ya da kancasız: büyüme bölgesi
  // havuzu, kanal…) en az bir ördek ve bir balık düşer (profildeki sayıyı aşmadan; büyük göletler önce) → hiçbir su "boş" kalmaz.
  const pondsOk = h.ponds.filter((w) => w.tiles.length >= MIN_POND).sort((a, b) => b.tiles.length - a.tiles.length);
  const waterOk = [...h.ponds, ...h.seas].filter((w) => w.tiles.length >= MIN_POND);
  const ensured: Partial<Record<Kind, number>> = {};
  const quotas: Partial<Record<Kind, number>> = {};
  if (!indoor) {
    const fishList = biomeSpecies(biomeOf(kit, true));
    for (const k of ["duck", "fish"] as const) {
      const quota = Math.round((prof[k] ?? 0) * f);
      quotas[k] = quota;
      for (const w of pondsOk) {
        if ((ensured[k] ?? 0) >= quota) break;
        const t = pickOf(w.tiles);
        if (!t) continue;
        if (k === "duck") add(k, "water", { x: tx(t[0]), y: w.y - 0.05, z: tz(t[1]) }, { water: w, speed: 0.35 });
        else add(k, "water", { x: tx(t[0]), y: w.y - 0.09, z: tz(t[1]) }, { water: w, speed: 0.3, leapAt: 6 + r() * 14 }, fishList[(ensured[k] ?? 0) % fishList.length]);
        ensured[k] = (ensured[k] ?? 0) + 1;
      }
    }
  }
  for (const [k, base] of Object.entries(prof) as [Kind, number][]) {
    const n = Math.max(0, Math.round(base * (k === "satellite" || k === "shuttle" ? 1 : f)) - (ensured[k] ?? 0));
    for (let c = 0; c < n; c++) {
      switch (k) {
        case "bird": case "gull": {
          const perch = pickOf(k === "gull" ? h.perches.concat(h.sand.map(tileSpot)) : perchesAll) ?? pickOf(h.ground.map(tileSpot));
          if (!perch && !ocean) break;
          const home = perch ?? { x: cx, y: 0, z: cz };
          add(k, "fly", { ...home }, { perch: perch ?? null, st: night || r() < 0.5 ? "perch" : "fly", until: 2 + r() * 8, speed: k === "gull" ? 2.4 : 2.8 });
          break;
        }
        case "pigeon": {
          if (indoor) {
            const w = h.windows[c % Math.max(1, h.windows.length)];
            if (!w) break;
            const ox = Math.sin(w.face) * 0.62, oz = Math.cos(w.face) * 0.62;
            add(k, "ledge", { x: w.x + ox + (r() - 0.5) * 0.5, y: w.y, z: w.z + oz }, { yaw: w.face + Math.PI / 2 * (r() < 0.5 ? 1 : -1) });
          } else {
            const t = pickOf(h.grass.length ? h.grass : h.ground);
            if (t) add(k, "walk", tileSpot(t), { speed: 0.45, homeR: 3 });
          }
          break;
        }
        case "cat": case "rabbit": case "vacuum": case "robot": case "dog": case "penguin": {
          const t = quietTile(k === "rabbit" ? h.grass : h.ground);
          if (t) add(k, "walk", tileSpot(t), { speed: k === "cat" ? 0.55 : k === "dog" ? 0.75 : k === "rabbit" ? 1.3 : k === "robot" ? 0.5 : k === "penguin" ? 0.32 : 0.42,
            homeR: k === "vacuum" ? 7 : k === "cat" || k === "dog" ? 6 : k === "penguin" ? 4 : 3 });
          break;
        }
        case "deer": {
          const t = quietTile(h.edge.length ? h.edge : h.ground);
          if (t) add(k, "walk", tileSpot(t), { speed: 0.4, homeR: 3 });
          break;
        }
        case "crab": {
          const t = pickOf(h.sand.length ? h.sand : kit === "beach" || kit === "sea" ? h.ground : []);
          if (t) add(k, "walk", tileSpot(t), { speed: 0.5, homeR: 2 });
          break;
        }
        case "squirrel": {
          const tree = pickOf(h.trees);
          if (tree) add(k, "tree", { ...tree, y: 0 }, { perch: tree, st: "ground", until: 1 + r() * 4 });
          break;
        }
        case "owl": {
          const tree = pickOf(h.trees);
          if (tree) add(k, "perch", { ...tree });
          break;
        }
        case "duck": {
          const w = pickOf(pondsOk.length ? pondsOk : h.ponds);
          const t = w && pickOf(w.tiles);
          if (w && t) add(k, "water", { x: tx(t[0]), y: w.y - 0.05, z: tz(t[1]) }, { water: w, speed: 0.35 });
          break;
        }
        case "fish": {
          // WORLD-FIX: tür biyomdan (gölet → göl; açık su → sahnenin biyomu), sırayla: aynı suda birkaç tür
          if (indoor) {
            const aq = h.aquariums[c % Math.max(1, h.aquariums.length)];
            if (aq) add(k, "aquarium", { ...aq }, { speed: 0.25, sc: 0.6 }, AQUARIUM[c % AQUARIUM.length]);
          } else {
            const w = pickOf(waterOk.length ? waterOk : [...h.ponds, ...h.seas]);
            const t = w && pickOf(w.tiles);
            const list = biomeSpecies(biomeOf(kit, h.ponds.includes(w as Water)));
            if (w && t) add(k, "water", { x: tx(t[0]), y: w.y - 0.09, z: tz(t[1]) }, { water: w, speed: 0.3, leapAt: 6 + r() * 14 }, list[c % list.length]);
          }
          break;
        }
        case "dolphin": {
          const w = pickOf(h.seas);
          if (!w && !ocean) break;
          add(k, "jump", { x: cx, y: (w?.y ?? ocean?.y ?? 0), z: cz }, { water: w ?? null, st: "under", until: 2 + r() * 8, hidden: true });
          break;
        }
        case "firefly": {
          const t = pickOf(h.grass.length ? h.grass : h.ground);
          if (t) add(k, "drift", { ...tileSpot(t), y: 0.6 });
          break;
        }
        case "satellite": {
          const ang = r() * Math.PI * 2;
          add(k, "orbit", { x: cx, y: 8 + r() * 5, z: cz }, { homeR: half + 4 + r() * 8, gx: ang, speed: (0.025 + r() * 0.03) * (r() < 0.5 ? 1 : -1) });
          break;
        }
        case "shuttle": add(k, "line", { x: cx, y: 13 + r() * 3, z: cz - built.depth * 0.3 }, { homeR: half + 20, speed: 2.6 }); break;
      }
    }
  }
  return { animals, nSolid, nGlow, ensured, quotas };
}

// ------------------------------------------------------------------ davranış
const rand = Math.random;
const walkable = (h: Habitat, x: number, z: number) => {
  const i = Math.floor(x + W / 2), j = Math.floor(z + D / 2);
  return i >= 0 && j >= 0 && i < h.width && j < h.depth && h.walk[j * h.width + i] === 1;
};
// ------------------------------------------------------------------ PHYS: karakter bedenleri (kare başı karma)
const ANIMAL_R = 0.14;
const CHAR_R = 0.24;
const B = { head: new Int32Array(0), next: new Int32Array(64), xs: new Float32Array(64), zs: new Float32Array(64), n: 0, touched: [] as number[] };
function bodiesReset(cells: number) {
  if (B.head.length !== cells) { B.head = new Int32Array(cells).fill(-1); B.touched.length = 0; }
  for (const c of B.touched) B.head[c] = -1;
  B.touched.length = 0; B.n = 0;
}
function bodiesAdd(cell: number, x: number, z: number) {
  if (B.n >= B.xs.length) {
    const g = (a: Float32Array) => { const b = new Float32Array(a.length * 2); b.set(a); return b; };
    B.xs = g(B.xs); B.zs = g(B.zs); const nx = new Int32Array(B.next.length * 2); nx.set(B.next); B.next = nx;
  }
  const k = B.n++;
  B.xs[k] = x; B.zs[k] = z;
  if (B.head[cell] === -1) B.touched.push(cell);
  B.next[k] = B.head[cell]; B.head[cell] = k;
}
/** (x, z) bir karakter bedenine (ANIMAL_R + CHAR_R) batıyor mu */
function bodyHit(h: Habitat, x: number, z: number): boolean {
  if (!B.n) return false;
  const ci = Math.floor(x + W / 2), cj = Math.floor(z + D / 2), md = ANIMAL_R + CHAR_R;
  for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
    if (i < 0 || j < 0 || i >= h.width || j >= h.depth) continue;
    for (let k = B.head[j * h.width + i]; k !== -1; k = B.next[k]) if (Math.hypot(B.xs[k] - x, B.zs[k] - z) < md) return true;
  }
  return false;
}
function pushOut(h: Habitat, x: number, z: number): { x: number; z: number } {
  const ci = Math.floor(x + W / 2), cj = Math.floor(z + D / 2), md = ANIMAL_R + CHAR_R + 0.01;
  for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
    if (i < 0 || j < 0 || i >= h.width || j >= h.depth) continue;
    for (let k = B.head[j * h.width + i]; k !== -1; k = B.next[k]) {
      const dx = x - B.xs[k], dz = z - B.zs[k], d = Math.hypot(dx, dz);
      if (d >= md) continue;
      const ux = d > 1e-6 ? dx / d : 1, uz = d > 1e-6 ? dz / d : 0;
      x = B.xs[k] + ux * md; z = B.zs[k] + uz * md;
    }
  }
  return { x, z };
}
const avatarPos = () => (walkRuntime.live && walkRuntime.visible ? walkRuntime.avatar : null);

const wetAt = (h: Habitat, x: number, z: number) => {
  const i = Math.floor(x + W / 2), j = Math.floor(z + D / 2);
  return i >= 0 && j >= 0 && i < h.width && j < h.depth && h.wet[j * h.width + i] === 1;
};
function agentNear(h: Habitat, occ: Uint8Array, x: number, z: number): [number, number] | null {
  const me = fearAt(x, z); // FEAR: yürüyen avatar da korkutucudur (ajan ızgarasında yok)
  if (me) return me;
  if (!occ.length) return null;
  const ci = Math.floor(x + W / 2), cj = Math.floor(z + D / 2);
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const i = ci + di, j = cj + dj;
    if (i < 0 || j < 0 || i >= h.width || j >= h.depth || !occ[j * h.width + i]) continue;
    const ax = tx(i), az = tz(j);
    if (Math.hypot(ax - x, az - z) < 1.25) return [ax, az];
  }
  return null;
}
function turn(a: Animal, want: number, dt: number, k = 6) {
  let d = want - a.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  a.yaw += d * Math.min(1, dt * k);
}
/** Ev çevresinde rastgele yürünebilir bir hedef (en çok 8 deneme). */
function pickGround(a: Animal, h: Habitat, cond?: (x: number, z: number) => boolean): boolean {
  for (let k = 0; k < 8; k++) {
    const x = a.home.x + (rand() * 2 - 1) * a.homeR, z = a.home.z + (rand() * 2 - 1) * a.homeR;
    const sx = Math.floor(x + W / 2) - W / 2 + 0.5, sz = Math.floor(z + D / 2) - D / 2 + 0.5;
    const gx = sx + (rand() - 0.5) * 0.6, gz = sz + (rand() - 0.5) * 0.6;
    if (walkable(h, gx, gz) && (!cond || cond(gx, gz))) { a.gx = gx; a.gz = gz; return true; }
  }
  return false;
}

/** Hareket azaltma: dinlenme duruşu (tünemiş, oturan, yüzen); yunus, ateş böceği, mekik gizli. */
function restPose(a: Animal, h: Habitat) {
  a.wing = 0; a.swing = 0; a.tail = 0; a.pitch = 0; a.roll = 0; a.head = 0; a.headYaw = 0; a.squash = 1; a.legsOff = false; a.blink = true;
  a.hidden = a.mode === "jump" || a.mode === "drift" || a.mode === "line";
  if (a.mode === "fly" || a.mode === "perch") {
    const p = a.perch ?? a.home;
    a.x = p.x; a.y = p.y; a.z = p.z;
  } else if (a.mode === "tree") { a.x = a.home.x + 0.5; a.y = 0; a.z = a.home.z; }
  else if (a.mode === "orbit") { a.x = a.home.x + Math.cos(a.gx) * a.homeR; a.z = a.home.z + Math.sin(a.gx) * a.homeR; a.y = a.home.y; }
  else if (a.kind === "cat") { a.squash = 0.62; a.legsOff = true; a.head = 0.45; }
  // WORLD-FIX: sıçrayış ortasında hareket azaltma açılırsa balık suya döner (havada asılı kalmaz)
  if (a.kind === "fish" && a.water) { a.y = a.water.y - 0.09; if (a.st === "leap") a.st = "rest"; }
  void h;
}

// ------------------------------------------------------------------ hayvan çekme (ritüel)
// `ritualFx.lure` (fun/ritualRuntime.ts) okunur; istenen türden en yakın ≤ n hayvan (≤ LURE_R) geçici `lured` durumuna geçer:
//  catch (martı/kuş): avatarın önüne süzülür, atılan parçayı havada kapar (parça yayının ucunda)
//  peck (güvercin; kedi mama kabında): yere iner/yürür, gagalar ya da yer
//  swim (ördek, balık): yeme en yakın su karolarına yüzer; ördek dalar, balık yüzeye çıkar
//  curious (kedi, sincap, ördek): yaklaşır, durur, eski yerine döner
// Süre (`until`) dolunca, istek değişince ya da avatar yürüyünce (çalışma zamanı isteği siler) bırakılır: güvercin var olan `flee`
// ile havalanır, kuş uçuşa, kedi/ördek/balık eski yerine, sincap ağacına döner. Hareket azaltmada yönlendirme yok: hayvanlar
// konumun yanına anında dinlenme pozunda konur, bitince eski yerlerine. Yeni hayvan, örnek ya da çizim çağrısı yok.
/** çekme menzilleri (birim): uçarak gelenler (martı/kuş `catch`, güvercin `peck`) uzaktan da gelir; yürüyenler (kedi,
 * sincap) yakından; yüzenler yalnız aynı bağlantılı su gövdesinden.*/
const LURE_FLY_R = 24, LURE_WALK_R = 10, LURE_SWIM_R = 24;
/** Uzaktan uçarak gelen (martı, kuş, güvercin) yolu bu sürede biter (sn; kısa ritüellerde de varsın), en çok bu hızla. */
const FLY_SECS = 2.4, FLY_MAX = 10;
/** Ritüel konumundan su gövdesine en çok uzaklık (rıhtım/kıyı karosu → suyun ilk karosu). */
const LURE_BANK = 3;
/** HQA-FIX: çekme adımının alt adım sayısı — kare süresi (sn, en çok 0,25) / 0,05; yavaş karede de gerçek zamanlı yol.*/
export const lureSubsteps = (rawDt: number): number => Math.max(1, Math.min(5, Math.ceil(Math.min(Math.max(rawDt, 0), 0.25) / 0.05 - 1e-6)));
/** Merak eden hayvanın bekleme süresi (sn), sonra döner. */
const LURE_PAUSE = 2.2;
type LureMode = RitualLureFx["mode"];
interface Lured {
  mode: LureMode; k: number; ph: "go" | "hold" | "back"; still: boolean;
  /** hedef ve bakılan nokta (yem, kap ya da avatar) */
  tx: number; ty: number; tz: number; fx: number; fz: number;
  /** çekilmeden önceki yer (dönüş ve hareket azaltmada geri koyma) */
  ox: number; oy: number; oz: number;
  /** evre başlangıcı (sahne saati, sn); `rel`: istek bitti, yalnız dönüş yürüyor */
  at: number; rel: boolean;
  /** güvercin: uçarak gelir/döner (`sx/sz` uçuşun başı, `sd` uzunluğu)*/
  fly: boolean; sx: number; sz: number; sd: number;
  /** yüzen için hedef su gövdesi (`Habitat.bodies` dizini; −1 yok) ve gövde içi yol (karo ortaları x,z; ilk nokta sıradaki) */
  body: number; path: number[] | null;
}
/** Kare başı eşitleme durumu: geçerli istek, varış sesi çalındı mı, çalınacak ses, çekilen sayı. */
interface LureSync { src: RitualLureFx | null; cued: boolean; cue: Sfx | null; picked: number }
const lureState = (): LureSync => ({ src: null, cued: false, cue: null, picked: 0 });
interface LureAvatar { x: number; z: number; heading: number; scale: number }

/** Türün çekilebildiği kip (pervaz güvercini, akvaryum balığı, baykuş ve uzay canlıları çekilmez). */
function lurable(a: Animal): boolean {
  switch (a.kind) {
    case "gull": case "bird": return a.mode === "fly";
    case "pigeon": case "cat": return a.mode === "walk";
    case "duck": case "fish": return a.mode === "water" && !!a.water;
    case "squirrel": return a.mode === "tree";
    default: return false;
  }
}

/** Ritüel konumunun su gövdesi: `LURE_BANK` içindeki en yakın ıslak karonun bağlantılı gövdesi (yoksa −1). */
function bodyNear(h: Habitat, x: number, z: number): number {
  const ci = Math.floor(x + W / 2), cj = Math.floor(z + D / 2), R = LURE_BANK;
  let best = -1, bd = Infinity;
  for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
    if (i < 0 || j < 0 || i >= h.width || j >= h.depth) continue;
    const b = h.bodyOf[j * h.width + i];
    if (b < 0) continue;
    const d = Math.hypot(tx(i) - x, tz(j) - z);
    if (d <= R && d < bd) { bd = d; best = b; }
  }
  return best;
}
const bodyAt = (h: Habitat, x: number, z: number) => {
  const i = Math.floor(x + W / 2), j = Math.floor(z + D / 2);
  return i >= 0 && j >= 0 && i < h.width && j < h.depth ? h.bodyOf[j * h.width + i] : -1;
};
/** aynı su gövdesinde karodan karoya yol (4 komşu, BFS); karo ortaları, son nokta tam hedef. Ulaşılamazsa null.*/
function waterPath(h: Habitat, x0: number, z0: number, x1: number, z1: number): number[] | null {
  const w = h.width, n = w * h.depth;
  const ti = (x: number) => Math.floor(x + W / 2), tj = (z: number) => Math.floor(z + D / 2);
  const s = tj(z0) * w + ti(x0), g = tj(z1) * w + ti(x1);
  if (s < 0 || g < 0 || s >= n || g >= n || h.bodyOf[s] < 0 || h.bodyOf[s] !== h.bodyOf[g]) return null;
  const prev = new Int32Array(n).fill(-1);
  prev[s] = s;
  const q = [s];
  for (let k = 0; k < q.length && prev[g] < 0; k++) {
    const c = q[k], ci = c % w, cj = (c - ci) / w;
    for (const [a, b] of [[ci + 1, cj], [ci - 1, cj], [ci, cj + 1], [ci, cj - 1]]) {
      if (a < 0 || b < 0 || a >= w || b >= h.depth) continue;
      const nk = b * w + a;
      if (prev[nk] >= 0 || h.bodyOf[nk] !== h.bodyOf[s]) continue;
      prev[nk] = c; q.push(nk);
    }
  }
  if (prev[g] < 0) return null;
  const tiles: number[] = [];
  for (let c = g; c !== s; c = prev[c]) tiles.push(c);
  const out: number[] = [];
  for (let k = tiles.length - 1; k >= 1; k--) { const c = tiles[k], ci = c % w; out.push(tx(ci), tz((c - ci) / w)); }
  out.push(x1, z1);
  return out;
}

/** Yolun uzunluğu (başlangıç noktasından). */
function pathLen(x: number, z: number, p: readonly number[]): number {
  let L = 0;
  for (let k = 0; k + 1 < p.length; k += 2) { L += Math.hypot(p[k] - x, p[k + 1] - z); x = p[k]; z = p[k + 1]; }
  return L;
}

/** Türün bu kipte gelebileceği en büyük uzaklık. */
function lureRange(a: Animal, mode: LureMode): number {
  if (a.kind === "duck" || a.kind === "fish") return LURE_SWIM_R;
  if (a.kind === "gull" || a.kind === "bird") return LURE_FLY_R;
  if (a.kind === "pigeon") return mode === "peck" ? LURE_FLY_R : LURE_WALK_R;
  return LURE_WALK_R;
}

/** İstenen türden en yakın ≤ n hayvan (tür/kip menzili; yüzen yalnız konumun su gövdesinden; gizli, gece `DAY_ONLY` ve uygun
 *  kipte olmayan hariç). `h` verilmezse yüzenlerde gövde denetimi yapılmaz (yalnız menzil). */
function lurePick(animals: readonly Animal[], L: Pick<RitualLureFx, "x" | "z" | "kinds" | "n"> & { mode?: LureMode }, night: boolean, h?: Habitat): number[] {
  const c: { i: number; d: number }[] = [];
  const mode = L.mode ?? "catch";
  let spotBody: number | null = null;
  animals.forEach((a, i) => {
    if (a.hidden || !(L.kinds as readonly string[]).includes(a.kind) || (night && DAY_ONLY.has(a.kind)) || !lurable(a)) return;
    const d = Math.hypot(a.x - L.x, a.z - L.z);
    if (d > lureRange(a, mode)) return;
    if (h && (a.kind === "duck" || a.kind === "fish")) {
      if (spotBody === null) spotBody = bodyNear(h, L.x, L.z);
      if (spotBody < 0 || bodyAt(h, a.x, a.z) !== spotBody) return;
    }
    c.push({ i, d });
  });
  c.sort((p, q) => p.d - q.d || p.i - q.i);
  return c.slice(0, Math.max(0, Math.min(6, L.n))).map((p) => p.i);
}

/** Yemin düştüğü nokta: avatar konuma yakınsa önüne (atış/serpme mesafesi), değilse ritüel konumu. */
function lureFocus(L: Pick<RitualLureFx, "x" | "z">, av: LureAvatar | null, mode: LureMode): [number, number] {
  if (!av || Math.hypot(av.x - L.x, av.z - L.z) > 3) return [L.x, L.z];
  const d = (mode === "catch" ? 1.6 : mode === "swim" ? 1.4 : 0.9) * av.scale;
  return [av.x + Math.sin(av.heading) * d, av.z + Math.cos(av.heading) * d];
}
/** Odak çevresinde yürünebilir, karakter bedenine değmeyen nokta (yön `th`, yarıçap `r`; yan açılar da denenir). */
function ringSpot(h: Habitat, fx: number, fz: number, th: number, r: number): [number, number] | null {
  for (let q = 0; q < 10; q++) {
    const g = th + (q % 2 ? 1 : -1) * Math.ceil(q / 2) * 0.55, rr = r * (1 + 0.3 * Math.floor(q / 5));
    const x = fx + Math.sin(g) * rr, z = fz + Math.cos(g) * rr;
    if (walkable(h, x, z) && !bodyHit(h, x, z)) return [x, z];
  }
  return null;
}
/** Suyun odağa k'ıncı en yakın karosu (`minD` altındakiler atlanır). */
function waterSpot(w: Water, fx: number, fz: number, k: number, minD: number): [number, number] | null {
  const best: { x: number; z: number; d: number }[] = [];
  for (const s of w.tiles) {
    const x = tx(s[0]), z = tz(s[1]), d = Math.hypot(x - fx, z - fz);
    if (d < minD || (best.length > k && d >= best[best.length - 1].d)) continue;
    let i = best.length;
    while (i > 0 && best[i - 1].d > d) i--;
    best.splice(i, 0, { x, z, d });
    if (best.length > k + 1) best.pop();
  }
  const p = best[Math.min(k, best.length - 1)];
  return p ? [p.x, p.z] : null;
}

/** Bir hayvanı çekmeye başlatır: hedef, bakış ve dönüş yeri; hareket azaltmada hedefe anında konur. */
function lureBegin(a: Animal, L: RitualLureFx, k: number, n: number, t: number, h: Habitat, av: LureAvatar | null, still: boolean) {
  const [fx, fz] = lureFocus(L, av, L.mode);
  const u: Lured = { mode: L.mode, k, ph: "go", still, tx: a.x, ty: a.y, tz: a.z, fx, fz, ox: a.x, oy: a.y, oz: a.z, at: t, rel: false,
    fly: false, sx: a.x, sz: a.z, sd: 0, body: -1, path: null };
  a.rx = null; a.boost = 0; a.then = "";
  const spread = k - (n - 1) / 2;
  // yürümede küçülen hayvanların yan yana/halka aralıkları da küçülür (genel bakışta ws = 1, aynı)
  const ws = ambientWalkScale(av?.scale ?? 1);
  // avatar → odak yönü: hayvanlar odağın öbür yanında durup avatara/yeme bakar
  const base = av ? Math.atan2(fx - av.x, fz - av.z) : Math.atan2(a.x - fx, a.z - fz);
  switch (a.kind) {
    case "gull": case "bird": {
      if (still) {
        const g = ringSpot(h, fx, fz, base + spread * 0.9, 0.7);
        if (g) { u.tx = g[0]; u.ty = 0; u.tz = g[1]; }
        else { const p = a.perch ?? a.home; u.tx = p.x; u.ty = p.y; u.tz = p.z; }
      } else {
        // havada kapma noktası: atış yayının ucu (avatarın önü, el yüksekliğinin biraz üstü)
        const sc = av?.scale ?? 1, side = av ? av.heading + Math.PI / 2 : 0;
        u.tx = fx + Math.sin(side) * 0.6 * ws * k; u.tz = fz + Math.cos(side) * 0.6 * ws * k; u.ty = 1.25 * sc + 0.05 + 0.4 * ws * k;
        // kapma noktası duvarın/binanın içindeyse avatarın çevresinde açık (yürünür ya da su) bir yön
        const open = (x: number, z: number) => walkable(h, x, z) || wetAt(h, x, z);
        if (av && !open(u.tx, u.tz)) {
          for (let q = 1; q < 12; q++) {
            const g = av.heading + (q % 2 ? 1 : -1) * Math.ceil(q / 2) * 0.5, r = 1.6 * sc;
            const x = av.x + Math.sin(g) * r, z = av.z + Math.cos(g) * r;
            if (open(x, z)) { u.tx = x; u.tz = z; break; }
          }
        }
      }
      if (av) { u.fx = av.x; u.fz = av.z; }
      u.sd = Math.hypot(u.tx - a.x, u.ty - a.y, u.tz - a.z);
      break;
    }
    case "pigeon": {
      const g = ringSpot(h, fx, fz, base + spread * 0.75, (0.55 + 0.15 * (k % 2)) * ws);
      if (g) { u.tx = g[0]; u.tz = g[1]; }
      u.ty = 0;
      // uzaktan uçarak gelir, yere iner, gagalar
      if (!still && Math.hypot(u.tx - a.x, u.tz - a.z) > 2) { u.fly = true; u.sx = a.x; u.sz = a.z; u.sd = Math.hypot(u.tx - a.x, u.tz - a.z); }
      break;
    }
    case "cat": {
      // kaba/yeme kendi yanından yaklaşır (kabın 0,35 berisinde durur; yürümede kedi boyuyla 0,35 × ws, burnu kapta)
      const dx = a.x - fx, dz = a.z - fz, d = Math.hypot(dx, dz) || 1;
      const x = fx + (dx / d) * 0.35 * ws, z = fz + (dz / d) * 0.35 * ws;
      const g: [number, number] | null = walkable(h, x, z) && !bodyHit(h, x, z) ? [x, z] : ringSpot(h, fx, fz, Math.atan2(dx, dz), 0.45 * ws);
      if (g) { u.tx = g[0]; u.tz = g[1]; }
      u.ty = 0;
      break;
    }
    case "squirrel": {
      // merakla yaklaşır ama avatara değmez: odaktan 1 birim ağaç yanında durur; dönüş ağacın dibine
      const tr = a.perch ?? a.home, side = (a.v - 0.5) * 2 * Math.PI;
      const g = ringSpot(h, fx, fz, Math.atan2(tr.x - fx, tr.z - fz), 1.0);
      if (g) { u.tx = g[0]; u.tz = g[1]; } else { u.tx = tr.x + Math.sin(side) * 0.55; u.tz = tr.z + Math.cos(side) * 0.55; }
      u.ty = 0;
      if (!still) { u.ox = tr.x + Math.sin(side) * 0.55; u.oy = 0; u.oz = tr.z + Math.cos(side) * 0.55; }
      break;
    }
    case "duck": case "fish": {
      const w = a.water;
      if (!w) break;
      // hedef karo konumun bağlantılı su gövdesinden (hayvanın kendi gölet bölgesi değil)
      u.body = bodyNear(h, L.x, L.z);
      const bd = u.body >= 0 ? h.bodies[u.body] : null;
      const g = waterSpot(bd ? { ...w, tiles: bd.tiles } : w, fx, fz, k, L.mode === "curious" ? 1.0 : 0);
      if (g) { u.tx = g[0] + spread * 0.12; u.tz = g[1] - spread * 0.12; if (!wetAt(h, u.tx, u.tz)) { u.tx = g[0]; u.tz = g[1]; } }
      u.sd = Math.hypot(u.tx - a.x, u.tz - a.z);
      if (!still) { u.path = waterPath(h, a.x, a.z, u.tx, u.tz); if (u.path) u.sd = pathLen(a.x, a.z, u.path); }
      const wy = bd ? bd.y : w.y;
      u.ty = a.kind === "fish" ? (still ? wy - 0.09 : wy - 0.03) : wy - 0.05;
      u.oy = a.kind === "fish" ? w.y - 0.09 : w.y - 0.05;
      if (a.st === "leap") { a.st = "rest"; a.pitch = 0; }
      break;
    }
  }
  a.lu = u;
  if (still) { u.ph = "hold"; lureRest(a); }
}

/** Hareket azaltma (ya da durağan istek): hedefte dinlenme pozu, animasyonsuz. */
function lureRest(a: Animal) {
  const u = a.lu;
  if (!u) return;
  a.x = u.tx; a.y = u.ty; a.z = u.tz; a.hidden = false;
  if (Math.hypot(u.fx - a.x, u.fz - a.z) > 0.05) a.yaw = Math.atan2(u.fx - a.x, u.fz - a.z);
  a.wing = 0; a.swing = 0; a.pitch = 0; a.roll = 0; a.headYaw = 0; a.tail = 0; a.legsOff = false; a.blink = true;
  a.head = a.kind === "pigeon" || (a.kind === "cat" && u.mode === "peck") ? 0.6 : 0;
  a.squash = a.kind === "cat" ? 0.9 : 1;
}

/** Bırakma: istek bitti/değişti ya da avatar yürüdü. */
function lureRelease(a: Animal, t: number, h: Habitat) {
  const u = a.lu;
  if (!u) return;
  if (u.still) { a.x = u.ox; a.y = u.oy; a.z = u.oz; a.lu = null; return; }
  a.head = 0; a.headYaw = 0; a.pitch = 0; a.roll = 0; a.squash = 1; a.legsOff = false;
  switch (a.kind) {
    case "pigeon":
      // uzaktan gelen güvercin uçarak yerine döner; yakındaki var olan kaçışla (kanat çırparak yemden uzağa)
      if (Math.hypot(u.ox - a.x, u.oz - a.z) > 4) { u.rel = true; u.ph = "back"; u.at = t; u.fly = true; u.sx = a.x; u.sz = a.z; u.sd = Math.hypot(u.ox - a.x, u.oz - a.z); break; }
      a.lu = null; a.y = 0;
      if (awayFrom(a, h, u.fx, u.fz, 2.6)) a.st = "flee"; else { a.st = "rest"; a.until = t + 1; }
      break;
    case "gull": case "bird":
      a.lu = null; a.st = "fly"; a.until = t + 6 + rand() * 6;
      a.gx = a.x + (rand() - 0.5) * 4; a.gz = a.z + (rand() - 0.5) * 4; a.gy = Math.max(a.y, 0.3) + 2 + rand() * 1.5;
      a.speed = (a.kind === "gull" ? 0.45 : 0.75) * (rand() < 0.5 ? 1 : -1);
      break;
    case "squirrel":
      // ağacına koşarak döner, sonra kendi döngüsü
      u.rel = true; u.ph = "back"; u.at = t;
      break;
    case "cat":
      a.lu = null; a.y = 0; a.gx = u.ox; a.gz = u.oz;
      if (walkable(h, a.gx, a.gz)) a.st = "go"; else { a.st = "rest"; a.until = t + 1; }
      break;
    default: {
      // ördek ve balık eski yerine yüzer; uzaksa gövde içi yoldan (karaya takılmaz)
      const path = Math.hypot(u.ox - a.x, u.oz - a.z) > 3 ? waterPath(h, a.x, a.z, u.ox, u.oz) : null;
      if (path) { u.rel = true; u.ph = "back"; u.at = t; u.path = path; u.sd = pathLen(a.x, a.z, path); break; }
      a.lu = null; a.gx = u.ox; a.gz = u.oz; a.st = "go"; a.leapAt = t + 8 + rand() * 10;
      break;
    }
  }
}

/** Dönüş bitti ya da yol kapandı: türün kendi döngüsüne geç. */
function lureDone(a: Animal, t: number) {
  a.lu = null; a.pitch = 0; a.roll = 0; a.squash = 1; a.legsOff = false; a.head = 0; a.headYaw = 0;
  if (a.kind === "squirrel") { a.y = 0; a.st = "ground"; a.until = t + 2 + rand() * 3; }
  else if (a.kind === "gull" || a.kind === "bird") { a.st = "fly"; a.until = t + 4; a.gx = a.x; a.gz = a.z; a.gy = Math.max(a.y, 2.5); }
  else { a.st = "rest"; a.until = t + 1.5 + rand() * 2; if (a.kind === "fish") a.leapAt = t + 8 + rand() * 10; }
}

/**
 * Kare başı eşitleme: istek değişti ya da süresi doldu mu (true → durağan çizim yenilenir). Eski çekilenler bırakılır, yenileri
 * seçilir. Hareket azaltmada (`quiet` ya da `still`) hayvanlar hemen yerine konur ve varış sesi bir kez çalar (`S.cue`).
 */
function lureSync(animals: readonly Animal[], S: LureSync, fx: RitualLureFx | null, now: number, t: number, h: Habitat, night: boolean,
  av: LureAvatar | null, quiet: boolean): boolean {
  const L = fx && now < fx.until ? fx : null;
  if (L === S.src) return false;
  for (const a of animals) if (a.lu && !a.lu.rel) lureRelease(a, t, h);
  S.src = L; S.cued = false; S.cue = null; S.picked = 0;
  if (L) {
    const still = L.still || quiet;
    const ids = lurePick(animals, L, night, h);
    ids.forEach((i, k) => lureBegin(animals[i], L, k, ids.length, t, h, av, still));
    S.picked = ids.length;
    if (still && ids.length) { S.cued = true; S.cue = lureCue(animals[ids[0]].kind); }
  }
  return true;
}

/** HQA-FIX: saf çekme çekirdeği — düğüm testi (`scripts/hqa_fix.test.mjs`) ritüel süresinde varışı düşük kare hızında da sınar. */
export const lureCore = { sync: (...a: Parameters<typeof lureSync>) => lureSync(...a), step: (...a: Parameters<typeof lureStep>) => lureStep(...a), state: () => lureState() };
/** Çekilen hayvanın karesi (hareket azaltma kapalı): git → bekle (kap/gagala/ye/dal/yüzeye çık/bak) → (merak) dön. */
function lureStep(a: Animal, S: LureSync, t: number, dt: number, h: Habitat) {
  const u = a.lu;
  if (!u) return;
  if (u.still) { lureRest(a); return; }
  const tt = t + a.t0, k = a.kind;
  const flyer = k === "gull" || k === "bird", wet = k === "duck" || k === "fish";
  if (u.ph === "go" || u.ph === "back") {
    // sincap gövdedeyse önce aşağı iner
    if (k === "squirrel" && a.y > 0.02) { a.y = Math.max(0, a.y - 2.2 * dt); a.pitch = Math.PI / 2; a.tail = Math.sin(tt * 10) * 0.3; return; }
    const back = u.ph === "back";
    let gx = back ? u.ox : u.tx, gz = back ? u.oz : u.tz;
    const gy = back ? u.oy : u.ty;
    // yüzen: gövde içi yolun sıradaki noktası (ara noktaya varınca bir sonrakine)
    if (wet && u.path && u.path.length >= 2) {
      gx = u.path[0]; gz = u.path[1];
      if (u.path.length > 2 && Math.hypot(gx - a.x, gz - a.z) < 0.08) { u.path.splice(0, 2); gx = u.path[0]; gz = u.path[1]; }
    }
    if (u.fly) {
      // güvercin uçuşu: yürünebilirlik aranmaz, kavisli yay (en çok 1,6 birim), inişte yer
      const dx = gx - a.x, dz = gz - a.z, d = Math.hypot(dx, dz);
      if (d < 0.06) {
        a.x = gx; a.z = gz; a.y = 0; a.wing = 0; a.pitch = 0;
        if (back) { lureDone(a, t); return; }
        u.ph = "hold"; u.at = t; u.fly = false;
        if (!S.cued) { S.cued = true; S.cue = lureCue(k); }
        return;
      }
      // uzaktan gelen ritüel süresi içinde varsın: yol ≈ 2,4 sn (2,6–10 birim/sn)
      const st = Math.min(d, Math.max(2.6, Math.min(FLY_MAX, u.sd / FLY_SECS)) * dt);
      a.x += (dx / d) * st; a.z += (dz / d) * st;
      const p = u.sd > 0 ? Math.max(0, Math.min(1, 1 - (d - st) / u.sd)) : 1;
      a.y = Math.sin(Math.PI * p) * Math.min(1.6, 0.25 * u.sd);
      turn(a, Math.atan2(dx, dz), dt, 8);
      a.wing = 0.6 + Math.sin(tt * 30) * 0.6; a.pitch = -0.2; a.head = 0; a.swing = 0; a.legsOff = false;
      return;
    }
    const dx = gx - a.x, dy = flyer || wet ? gy - a.y : 0, dz = gz - a.z, d = Math.hypot(dx, dz), d3 = Math.hypot(dx, dy, dz);
    if (d3 < 0.06) {
      a.x = gx; a.z = gz; if (flyer || wet) a.y = gy;
      if (back) { lureDone(a, t); return; }
      u.ph = "hold"; u.at = t;
      if (!S.cued) { S.cued = true; S.cue = lureCue(k); }
      return;
    }
    // yüzen uzaktan geliyorsa (aynı gövde) daha hızlı kürek çeker: yol ≈ 3,2 sn'de biter (en çok 4 birim/sn)
    const swimK = wet && u.sd > 3 ? Math.min(4, u.sd / 3.2) : 0;
    const flyK = flyer && u.sd > 0 ? Math.min(FLY_MAX, u.sd / FLY_SECS) : 0;
    const sp = k === "gull" ? Math.max(2.4, flyK) : k === "bird" ? Math.max(2.6, flyK) : k === "pigeon" ? (d > 2 ? 1.6 : 0.9) : k === "cat" ? 0.9 : k === "squirrel" ? 1.8 : k === "duck" ? Math.max(0.9, swimK) : Math.max(1.1, swimK);
    const s = Math.min(d3, sp * dt) / (d3 || 1);
    const nx = a.x + dx * s, nz = a.z + dz * s;
    // karada: yürünebilir yerden yürünemeze geçmez (ağaç gövdesi gibi yürünemez yerden çıkabilir; sincap ağaç dibi)
    if (!flyer && (wet ? !wetAt(h, nx, nz) && bodyAt(h, nx, nz) < 0 : (!walkable(h, nx, nz) && walkable(h, a.x, a.z)) || bodyHit(h, nx, nz))) {
      // yol kapalı: gidişte burada durur, dönüşte kendi döngüsüne geçer
      if (back) lureDone(a, t); else { u.ph = "hold"; u.at = t; u.tx = a.x; u.tz = a.z; }
      return;
    }
    a.x = nx; a.z = nz; a.y += dy * s;
    if (d > 0.02) turn(a, Math.atan2(dx, dz), dt, flyer ? 5 : 8);
    if (flyer) {
      a.roll *= 0.9; a.pitch = Math.max(-0.4, Math.min(0.4, d3 > 0 ? (-dy / d3) * 0.6 : 0)); a.head = 0; a.headYaw = 0;
      a.wing = d3 < 0.8 ? 0.6 + Math.sin(tt * 30) * 0.6 : k === "gull" ? 0.1 + Math.max(0, Math.sin(tt * 3)) * 0.25 : 0.2 + Math.sin(tt * 26) * 0.6;
    } else if (wet) {
      a.pitch = 0; a.tail = k === "duck" ? Math.sin(tt * 4) * 0.12 : Math.sin(tt * 9) * 0.45;
      if (k === "fish") { a.headYaw = -a.tail * 0.35; a.wing = Math.sin(tt * 6) * 0.35; }
    } else {
      a.pitch = 0; a.squash = 1; a.legsOff = false; a.headYaw = 0;
      a.swing = Math.sin(tt * 12) * 0.55;
      a.tail = k === "cat" ? Math.sin(tt * 3) * 0.3 : k === "squirrel" ? Math.sin(tt * 6) * 0.4 : 0;
      a.head = k === "pigeon" ? Math.sin(tt * 12) * 0.25 : 0;
      const hop = k === "pigeon" && d > 2;
      a.wing = hop ? 0.6 + Math.sin(tt * 30) * 0.6 : 0;
      a.y = hop ? 0.12 : k === "squirrel" ? Math.max(0, Math.sin(tt * 9)) * 0.1 : 0;
    }
    return;
  }
  // bekle: yeme ya da avatara bak
  if (Math.hypot(u.fx - a.x, u.fz - a.z) > 0.05) turn(a, Math.atan2(u.fx - a.x, u.fz - a.z), dt, 6);
  a.swing = 0; a.roll = 0;
  switch (k) {
    case "gull": case "bird":
      // havada asılı kalır, parçayı kapar (gaga aşağı, hızlı kanat)
      a.x = u.tx; a.z = u.tz; a.y = u.ty + Math.sin(tt * 3) * 0.05;
      a.wing = 0.55 + Math.sin(tt * 28) * 0.55; a.pitch = -0.25; a.head = 0.35; a.headYaw = 0;
      break;
    case "pigeon":
      a.y = 0; a.wing = 0; a.pitch = 0; a.headYaw = 0;
      a.head = Math.max(0, Math.sin(tt * 5 + u.k)) > 0.55 ? 0.8 : 0;
      break;
    case "cat":
      a.y = 0; a.pitch = 0; a.legsOff = false;
      if (u.mode === "peck") { a.squash = 0.95; a.head = 0.55 + Math.sin(tt * 6) * 0.08; a.headYaw = 0; a.tail = Math.sin(tt * 1.4) * 0.4; }
      else { a.squash = 0.9; a.head = -0.1; a.headYaw = Math.sin(tt * 0.8) * 0.3; a.tail = Math.sin(tt * 2) * 0.5; }
      break;
    case "squirrel":
      a.y = 0; a.pitch = -0.35; a.head = Math.sin(tt * 4) * 0.15; a.tail = Math.sin(tt * 3) * 0.3;
      break;
    case "duck":
      a.y = u.ty + Math.sin(tt * 1.6) * 0.012; a.tail = 0;
      if (u.mode === "swim" && ((tt + u.k * 0.8) % 2.6) < 0.9) { a.pitch = 1.1; a.head = 0; }
      else { a.pitch = 0; a.headYaw = Math.sin(tt * 0.9) * 0.4; }
      break;
    case "fish":
      // yüzeye çıkmış: burun yukarı, kuyruk çırpar
      a.y = u.ty + Math.sin(tt * 2) * 0.015; a.pitch = -0.35;
      a.tail = Math.sin(tt * 10) * 0.4; a.headYaw = -a.tail * 0.3; a.wing = Math.sin(tt * 5) * 0.3;
      break;
  }
  if (u.mode === "curious" && t - u.at > LURE_PAUSE) { u.ph = "back"; u.at = t; a.pitch = 0; }
}

export function step(a: Animal, t: number, dt: number, h: Habitat, occ: Uint8Array, night: boolean, ocean: { y: number } | null, fx: FxState) {
  const tt = t + a.t0;
  // S48: süren tepki (dokunuş) bu karenin duruşunu belirleyebilir
  if (a.rx) {
    if (t < a.rxUntil) { if (stepRx(a, t, dt, h, fx)) return; }
    else endRx(a, t, h);
  }
  switch (a.mode) {
    case "walk": walk(a, t, tt, dt, h, occ, night); break;
    case "fly": fly(a, t, tt, dt, h, occ, night, ocean); break;
    case "water": swim(a, t, tt, dt, h, fx); break;
    case "aquarium": {
      const r = 0.32, k = Math.min(1, dt * 4); // S48: camdan dönerken yumuşak
      a.x += (a.home.x + Math.sin(tt * 0.35) * r - a.x) * k; a.z += (a.home.z + Math.sin(tt * 0.5 + 1.3) * r * 0.6 - a.z) * k;
      a.y += (a.home.y + Math.sin(tt * 0.7) * 0.12 - a.y) * k;
      a.yaw = Math.atan2(Math.cos(tt * 0.35) * 0.35 * r, Math.cos(tt * 0.5 + 1.3) * 0.5 * r * 0.6);
      a.tail = Math.sin(tt * 9) * 0.5; a.headYaw = -a.tail * 0.3; a.wing = Math.sin(tt * 7) * 0.35;
      break;
    }
    case "tree": squirrel(a, t, tt, dt, h, night); break;
    case "perch": {
      // baykuş: tünemiş, başını ara ara çevirir (çabuk), göz kırpar
      const p = a.home;
      a.x = p.x; a.y = p.y; a.z = p.z;
      const seg = Math.floor(tt / 2.6);
      a.headYaw += ((Math.sin(seg * 7.3) * 1.4) - a.headYaw) * Math.min(1, dt * 9);
      a.blink = (tt % 5.3) > 0.18;
      break;
    }
    case "ledge":
      a.head = Math.max(0, Math.sin(tt * 2.1)) > 0.85 ? 0.7 : Math.sin(tt * 0.9) * 0.08;
      a.headYaw = Math.sin(Math.floor(tt / 3) * 5.1) * 0.6;
      a.tail = Math.sin(tt * 1.3) * 0.08;
      break;
    case "jump": dolphin(a, t, h, ocean, fx); break;
    case "orbit": {
      const ang = a.gx + t * a.speed;
      a.x = a.home.x + Math.cos(ang) * a.homeR; a.z = a.home.z + Math.sin(ang) * a.homeR; a.y = a.home.y + Math.sin(t * 0.2 + a.t0) * 0.4;
      a.yaw = -ang; a.roll = t * 0.15; a.blink = (tt % 1.6) < 0.25;
      break;
    }
    case "line": {
      const L = a.homeR * 2, u = ((t * a.speed + a.t0 * 10) % L) - a.homeR;
      a.x = a.home.x + u; a.z = a.home.z + Math.sin(u * 0.05) * 3; a.y = a.home.y; a.yaw = Math.PI / 2; a.blink = (tt % 1.2) < 0.3;
      break;
    }
    case "drift": {
      a.x = a.home.x + Math.sin(tt * 0.37) * 1.3 + Math.sin(tt * 0.91) * 0.3;
      a.z = a.home.z + Math.cos(tt * 0.29 + 1) * 1.3;
      a.y = 0.45 + Math.sin(tt * 0.53) * 0.35;
      a.blink = Math.sin(tt * 1.7) > -0.25;
      break;
    }
  }
  if (a.rx === "scatter") {
    // ateş böcekleri tıklanan noktadan dağılır ve yuvalarına geri toplanır
    const u = (t - a.rxT) / (a.rxUntil - a.rxT), d = 1.7 * Math.sin(Math.PI * u);
    const dx = a.home.x - a.ax, dz = a.home.z - a.az, n = Math.hypot(dx, dz) || 1;
    a.x += (dx / n) * d; a.z += (dz / n) * d; a.y += 0.5 * Math.sin(Math.PI * u); a.blink = (t * 9) % 1 < 0.6;
  } else if (a.rx === "beacon") a.blink = (t * 8) % 1 < 0.5;
}

/** FEAR: güvercin kısa bir yay çizerek uçar ve başka yere konar. */
function startHop(a: Animal, h: Habitat, f: [number, number], t: number): boolean {
  const to = hopTarget(a.x, a.z, f[0], f[1], (x, z) => walkable(h, x, z) && !bodyHit(h, x, z), rand);
  if (!to) return false;
  a.hop = { t0: t, dur: hopDuration(Math.hypot(to[0] - a.x, to[1] - a.z)), sx: a.x, sz: a.z, ex: to[0], ez: to[1] };
  a.st = "hop";
  return true;
}
function hopStep(a: Animal, t: number, tt: number, dt: number) {
  const p = a.hop;
  if (!p) { a.st = "rest"; a.until = t + 1; return; }
  const u = (t - p.t0) / p.dur;
  if (u >= 1) { a.x = p.ex; a.z = p.ez; a.y = 0; a.hop = null; a.st = "rest"; a.until = t + 2 + rand() * 4; a.wing = 0; a.pitch = 0; a.legsOff = false; return; }
  const k = u * u * (3 - 2 * u);
  a.x = p.sx + (p.ex - p.sx) * k; a.z = p.sz + (p.ez - p.sz) * k;
  a.y = hopLift(u);
  a.legsOff = true; a.swing = 0; a.head = 0;
  a.pitch = u < 0.5 ? -0.35 : 0.3; // burun yukarı, sonra inişe
  a.wing = 0.7 + Math.sin(tt * 34) * 0.7;
  turn(a, Math.atan2(p.ex - p.sx, p.ez - p.sz), dt, 12);
}

function walk(a: Animal, t: number, tt: number, dt: number, h: Habitat, occ: Uint8Array, night: boolean) {
  if (a.st === "hop") { hopStep(a, t, tt, dt); return; }
  a.y = 0; a.squash = 1; a.legsOff = false; a.pitch = 0;
  // PHYS: karakter üstüne yürüdüyse dışarı itil (yürünebilir yere)
  if (bodyHit(h, a.x, a.z)) {
    const q = pushOut(h, a.x, a.z);
    if (walkable(h, q.x, q.z)) { a.x = q.x; a.z = q.z; }
  }
  // köpek yalnız avatarın yanından çekilir (ajanlara kaçmaz)
  const threat = a.kind === "vacuum" || a.kind === "robot" ? null : a.kind === "dog" ? fearAt(a.x, a.z, 0.8) : agentNear(h, occ, a.x, a.z);
  const fleeing = a.st === "flee";
  if (threat && a.kind === "pigeon" && startHop(a, h, threat, t)) { hopStep(a, t, tt, dt); return; }
  if (threat && !fleeing) {
    // kaç: ajandan uzağa, yürünebilir bir noktaya (güvercin kanat çırpar)
    const dx = a.x - threat[0], dz = a.z - threat[1], d = Math.hypot(dx, dz) || 1;
    // NONCITY-QA (REAL-ANIMAL-001): tam ters yön duvar/köşeyse yana kaçar (±35°, ±70°, ±90°) — köşedeki kedi donup kalmaz
    flee: for (const ang of [0, 0.6, -0.6, 1.2, -1.2, 1.57, -1.57]) {
      const ca = Math.cos(ang), sa = Math.sin(ang), ux = (dx / d) * ca - (dz / d) * sa, uz = (dx / d) * sa + (dz / d) * ca;
      for (const k of [2.2, 1.5, 1]) {
        const gx = a.x + ux * k + (rand() - 0.5) * 0.6, gz = a.z + uz * k + (rand() - 0.5) * 0.6;
        if (walkable(h, gx, gz)) { a.gx = gx; a.gz = gz; a.st = "flee"; break flee; }
      }
    }
  }
  if (a.st === "rest" || a.st === "nap") {
    // dinlenme duruşu: kedi oturur/uyur, güvercin gagalar, geyik otlar, tavşan kulak oynatır
    a.swing = 0;
    if (a.kind === "cat") {
      if (a.st === "nap") { a.squash = 0.62; a.legsOff = true; a.head = 0.45; a.tail = Math.sin(tt * 0.6) * 0.15; }
      else { a.head = Math.sin(tt * 0.7) * 0.1; a.headYaw = Math.sin(tt * 0.4) * 0.5; a.tail = Math.sin(tt * 1.6) * 0.5; }
    } else if (a.kind === "pigeon" || a.kind === "rabbit" || a.kind === "deer") {
      const peck = a.kind === "deer" ? Math.sin(tt * 0.5) > -0.4 : Math.max(0, Math.sin(tt * (a.kind === "pigeon" ? 3.2 : 1.2))) > 0.7;
      a.head = peck ? (a.kind === "deer" ? 1.25 : 0.8) : 0; a.headYaw = peck ? 0 : Math.sin(tt * 0.8) * 0.4;
    } else if (a.kind === "crab") { a.swing = Math.sin(tt * 2) * 0.3; }
    else if (a.kind === "robot") { a.headYaw = Math.sin(tt * 0.9) * 0.8; }
    if (t > a.until) {
      if (pickGround(a, h)) a.st = "go"; else a.until = t + 1;
    }
    return;
  }
  // yürü (hedefe düz çizgi; sonraki nokta yürünebilir değilse dur ve yeni hedef seç)
  const dx = a.gx - a.x, dz = a.gz - a.z, d = Math.hypot(dx, dz);
  const sp = a.speed * (a.st === "flee" ? (a.kind === "dog" ? 1.8 : 2.6) : 1) * (a.kind === "rabbit" ? (Math.sin(tt * 9) > 0 ? 1.6 : 0.2) : 1) * (t < a.boost ? a.boostK : 1);
  if (d < 0.05) {
    a.st = "rest";
    const nap = a.kind === "cat" && !h.busy.has(`${Math.floor(a.x + W / 2)},${Math.floor(a.z + D / 2)}`) && rand() < (night ? 0.6 : 0.45);
    if (nap) a.st = "nap";
    a.until = t + (nap ? 18 + rand() * 30 : a.kind === "vacuum" ? 0.4 : a.kind === "deer" ? 4 + rand() * 6 : 1.5 + rand() * 4);
    return;
  }
  const stepLen = Math.min(d, sp * dt);
  const nx = a.x + (dx / d) * stepLen, nz = a.z + (dz / d) * stepLen;
  if (!walkable(h, nx, nz) || bodyHit(h, nx, nz)) { a.st = "rest"; a.until = t + 0.3; return; }
  a.x = nx; a.z = nz;
  if (a.kind === "crab") { turn(a, Math.atan2(dx, dz) - Math.PI / 2, dt, 4); }
  else turn(a, Math.atan2(dx, dz), dt, a.kind === "vacuum" ? 3 : 8);
  a.swing = Math.sin(tt * (a.kind === "deer" ? 6 : 12)) * (a.kind === "vacuum" ? 0 : 0.55);
  a.head = a.kind === "pigeon" ? Math.sin(tt * 12) * 0.25 : 0;
  a.headYaw = 0;
  a.tail = a.kind === "cat" ? Math.sin(tt * 3) * 0.3 : 0;
  if (a.kind === "rabbit") a.y = Math.max(0, Math.sin(tt * 9)) * 0.14;
  if (a.kind === "penguin") { a.roll = Math.sin(tt * 7) * 0.16; a.swing = 0; } // W3a-INT: paytak yürüyüş
  if (a.kind === "deer" && t < a.boost) a.y = Math.max(0, Math.sin(tt * 8)) * 0.32; // sıçrayarak kaçış
  if (a.kind === "crab" && t < a.boost) a.swing = Math.sin(tt * 26) * 0.6;
  if (a.kind === "pigeon" && a.st === "flee") { a.wing = 0.6 + Math.sin(tt * 30) * 0.6; a.y = 0.12; } else a.wing = 0;
  if (a.st === "flee" && d < 0.3) a.st = "go";
}

function fly(a: Animal, t: number, tt: number, dt: number, h: Habitat, occ: Uint8Array, night: boolean, ocean: { y: number } | null) {
  const gull = a.kind === "gull";
  if (a.st === "perch") {
    const p = a.perch ?? a.home;
    a.x = p.x; a.y = p.y; a.z = p.z; a.pitch = 0; a.roll = 0;
    a.wing = 0;
    if (night) { a.head = 0.5; a.headYaw = 0; return; } // tünemiş: baş gömük, durağan
    a.head = Math.max(0, Math.sin(tt * 2.4)) > 0.8 ? 0.7 : 0;
    a.headYaw = Math.sin(Math.floor(tt / 1.7) * 3.7) * 0.7;
    a.tail = Math.sin(tt * 3) * 0.1;
    const near = p.y < 0.3 ? agentNear(h, occ, a.x, a.z) : fearAt(a.x, a.z, 0.7); // ağaç/çatı tüneğinde yalnız avatar, altına gelince
    const scared = !!near;
    if (t > a.until || scared) {
      a.st = "fly"; a.until = t + (scared ? 3 + rand() * 2.5 : (gull ? 14 : 7) + rand() * 10); // ürken kuş kısa uçar, başka yere konar
      const away = near ? Math.atan2(a.x - near[0], a.z - near[1]) : rand() * Math.PI * 2, off = near ? 4 : 3;
      a.gx = a.x + (near ? Math.sin(away) * off : (rand() - 0.5) * 6); a.gz = a.z + (near ? Math.cos(away) * off : (rand() - 0.5) * 6); a.gy = (gull ? 3.5 : 2.6) + rand() * 2.5; // tur merkezi ve yüksekliği
      a.speed = (gull ? 0.45 : 0.75) * (rand() < 0.5 ? 1 : -1);
    }
    return;
  }
  if (a.st === "fly") {
    // merkez etrafında halka: kuş sık çırpar, martı süzülür (arada birkaç çırpış), dönüşe yatar
    const R = gull ? 3.4 : 2.2;
    const ang = tt * a.speed;
    const tx0 = a.gx + Math.cos(ang) * R, tz0 = a.gz + Math.sin(ang) * R, ty0 = a.gy + Math.sin(tt * 0.7) * 0.3;
    const dx = tx0 - a.x, dz = tz0 - a.z, dy = ty0 - a.y;
    const k = Math.min(1, dt * 1.6);
    a.x += dx * k; a.z += dz * k; a.y += dy * k;
    turn(a, Math.atan2(dx, dz), dt, 5);
    a.roll = -Math.sign(a.speed) * (gull ? 0.35 : 0.25);
    a.pitch = 0; a.head = 0; a.headYaw = 0;
    a.wing = gull ? ((tt % 5) < 0.9 ? 0.25 + Math.sin(tt * 14) * 0.5 : 0.08) : 0.2 + Math.sin(tt * 26) * 0.75;
    if (t > a.until || night) {
      // in: tünek seç (martı kumda/suda/çatıda, kuş ağaçta/çatıda)
      const cands: Spot[] = gull ? [...h.perches, ...h.sand.slice(0, 40).map((s) => ({ x: tx(s[0]), y: 0, z: tz(s[1]) }))] : [...h.trees, ...h.perches];
      if (gull && (h.seas.length || ocean)) {
        const w = h.seas[0];
        const s = w ? w.tiles[Math.floor(rand() * w.tiles.length)] : null;
        if (s) cands.push({ x: tx(s[0]), y: w.y - 0.02, z: tz(s[1]) });
      }
      // yakındaki tüneklerden biri (dünyanın öbür ucuna uçmaz)
      const near = cands.length > 6 ? cands.map((c) => ({ c, d: Math.hypot(c.x - a.x, c.z - a.z) + rand() * 3 })).sort((u, v) => u.d - v.d).slice(0, 6).map((u) => u.c) : cands;
      const p = near.length ? near[Math.floor(rand() * near.length)] : a.home;
      a.perch = { x: p.x + (rand() - 0.5) * 0.4, y: p.y, z: p.z + (rand() - 0.5) * 0.4 };
      a.st = "land";
    }
    return;
  }
  // land: tünek noktasına süzül
  const p = a.perch ?? a.home;
  const dx = p.x - a.x, dz = p.z - a.z, dy = p.y - a.y, d = Math.hypot(dx, dz, dy);
  if (d < 0.06) { a.st = "perch"; a.until = t + (gull ? 6 : 4) + rand() * 12; a.roll = 0; a.yaw += (rand() - 0.5) * 2; return; }
  const sp = (gull ? 2.2 : 2.6) * dt;
  const s = Math.min(1, sp / d);
  a.x += dx * s; a.y += dy * s; a.z += dz * s;
  if (Math.hypot(dx, dz) > 0.05) turn(a, Math.atan2(dx, dz), dt, 6);
  a.roll *= 0.9; a.pitch = d < 0.6 ? -0.3 : 0;
  a.wing = d < 0.8 ? 0.6 + Math.sin(tt * 30) * 0.6 : gull ? 0.1 : 0.2 + Math.sin(tt * 26) * 0.6;
}

function swim(a: Animal, t: number, tt: number, dt: number, h: Habitat, fx: FxState) {
  const w = a.water;
  if (!w) return;
  const duck = a.kind === "duck";
  // WORLD-FIX: balık ara ara sudan sıçrar (yay, burun yukarı → aşağı, giriş/çıkışta sıçrama + halka); hareket azaltmada çağrılmaz
  if (!duck && a.st === "leap") {
    const k = 1 - (a.until - t) / LEAP_S;
    if (k >= 1) { a.st = "rest"; a.until = t + 1; a.pitch = 0; a.leapAt = t + 10 + rand() * 18; burst(fx, "splash", a.x, w.y + 0.04, a.z, 0.7); burst(fx, "ripple", a.x, w.y + 0.02, a.z); return; }
    const nx = a.x + Math.sin(a.yaw) * 0.55 * dt / LEAP_S, nz = a.z + Math.cos(a.yaw) * 0.55 * dt / LEAP_S;
    if (wetAt(h, nx, nz)) { a.x = nx; a.z = nz; }
    a.y = w.y - 0.09 + Math.sin(Math.PI * k) * 0.42;
    a.pitch = -Math.cos(Math.PI * k) * 0.95;
    a.tail = Math.sin(tt * 26) * 0.6; a.headYaw = -a.tail * 0.3; a.wing = 0.5;
    return;
  }
  if (!duck && t > a.leapAt && Math.hypot(a.x - (a.home.x), a.z - a.home.z) < 40) {
    a.st = "leap"; a.until = t + LEAP_S;
    burst(fx, "splash", a.x, w.y + 0.04, a.z, 0.6);
    return;
  }
  a.y = w.y - (duck ? 0.05 : 0.09) + (duck ? Math.sin(tt * 1.6) * 0.012 : 0);
  // FEAR: avatar yaklaşınca suda hızla uzaklaşır
  if (t >= a.boost) {
    const f = fearAt(a.x, a.z, duck ? 1 : 0.85);
    const to = f && paddleTarget(a.x, a.z, f[0], f[1], w.tiles.map((q) => [tx(q[0]), tz(q[1])] as [number, number]), 5, rand);
    if (f && to) { a.gx = to[0]; a.gz = to[1]; a.st = "go"; a.boost = t + 1.8; a.boostK = 2.4; }
  }
  if (a.st === "rest") {
    a.tail = duck ? 0 : Math.sin(tt * 3) * 0.3;
    if (!duck) { a.headYaw = -a.tail * 0.35; a.wing = Math.sin(tt * 4) * 0.3; }
    // ördek dalar (kuyruk yukarı) ya da etrafa bakar
    if (duck && (tt % 9) < 1.4) { a.pitch = 1.1; a.head = 0; } else { a.pitch = 0; a.headYaw = Math.sin(tt * 0.5) * 0.5; }
    if (t > a.until) {
      const s = w.tiles[Math.floor(rand() * w.tiles.length)];
      a.gx = tx(s[0]) + (rand() - 0.5) * 0.6; a.gz = tz(s[1]) + (rand() - 0.5) * 0.6;
      if (Math.hypot(a.gx - a.x, a.gz - a.z) > (duck ? 4 : 5)) { a.until = t + 0.5; return; }
      a.st = "go";
    }
    return;
  }
  a.pitch = 0; a.headYaw = 0;
  const dx = a.gx - a.x, dz = a.gz - a.z, d = Math.hypot(dx, dz);
  if (d < 0.05) { a.st = "rest"; a.until = t + (duck ? 2 + rand() * 6 : 1 + rand() * 3); return; }
  const st = Math.min(d, a.speed * dt * (t < a.boost ? a.boostK : 1));
  const nx = a.x + (dx / d) * st, nz = a.z + (dz / d) * st;
  if (!wetAt(h, nx, nz)) { a.st = "rest"; a.until = t + 0.4; return; }
  a.x = nx; a.z = nz;
  turn(a, Math.atan2(dx, dz), dt, 3);
  a.tail = duck ? Math.sin(tt * 4) * 0.12 : Math.sin(tt * 8) * 0.45;
  // balık: gövde S kıvrımı (baş kuyruğa ters), göğüs yüzgeçleri çırpar
  if (!duck) { a.headYaw = -a.tail * 0.35; a.wing = Math.sin(tt * 6) * 0.35; }
}

function squirrel(a: Animal, t: number, tt: number, dt: number, h: Habitat, night: boolean) {
  const tree = a.perch ?? a.home;
  a.hidden = night;
  if (night) return;
  const top = Math.max(0.8, tree.y * 0.55);
  const side = (a.v - 0.5) * 2 * Math.PI;
  const trunkX = tree.x + Math.sin(side) * 0.24, trunkZ = tree.z + Math.cos(side) * 0.24;
  switch (a.st) {
    case "ground": {
      // gövdenin dibinde zıplar, kuyruğu oynar
      const r = 0.55 + Math.sin(tt * 0.4) * 0.25;
      const ang = side + Math.sin(tt * 0.6) * 0.9;
      const gx = tree.x + Math.sin(ang) * r, gz = tree.z + Math.cos(ang) * r;
      if (walkable(h, gx, gz) || !walkable(h, a.x, a.z)) { a.x = gx; a.z = gz; }
      a.y = Math.max(0, Math.sin(tt * 7)) * 0.08; a.pitch = 0;
      turn(a, ang + Math.PI / 2, dt, 6);
      a.tail = Math.sin(tt * 5) * 0.4; a.head = Math.max(0, Math.sin(tt * 1.3)) > 0.8 ? 0.6 : 0;
      if (t > a.until) { a.st = "up"; a.until = t + 8; }
      if (fearAt(a.x, a.z)) { a.st = "up"; a.until = t + 8; a.boost = t + 2; a.boostK = 2.6; } // avatar yaklaşınca gövdeye fırlar
      break;
    }
    case "up": case "down": {
      a.x = trunkX; a.z = trunkZ; a.yaw = side + Math.PI; a.pitch = a.st === "up" ? -Math.PI / 2 : Math.PI / 2;
      a.y += (a.st === "up" ? 1 : -1) * 1.1 * dt * (t < a.boost ? a.boostK : 1);
      a.tail = Math.sin(tt * 10) * 0.3;
      if (a.st === "up" && a.y >= top) { a.y = top; a.st = "top"; a.until = t + 3 + rand() * 6; }
      if (a.st === "down" && a.y <= 0) { a.y = 0; a.st = "ground"; a.until = t + 2 + rand() * 5; }
      break;
    }
    case "top":
      a.x = trunkX; a.z = trunkZ; a.y = top; a.pitch = -0.2; a.yaw = side; a.head = Math.sin(tt * 2) * 0.2; a.tail = Math.sin(tt * 3) * 0.3;
      if (t > a.until) a.st = "down";
      break;
  }
}

function dolphin(a: Animal, t: number, h: Habitat, ocean: { y: number } | null, fxs: FxState) {
  const JUMP = 1.5, LEN = 2.4;
  if (a.st === "under") {
    a.hidden = true;
    if (t > a.until && a.again === 2) {
      // S48: dokunulan yunus aynı yerde bir kez daha zıplar (sıçramayla)
      a.again = 0; a.t0 = t; a.st = "jump"; a.hidden = false;
      burst(fxs, "splash", a.gx - Math.sin(a.yaw) * 1.2, a.gy, a.gz - Math.cos(a.yaw) * 1.2);
      return;
    }
    if (t > a.until) {
      // atlama noktası: deniz karosu ya da ızgaranın dışındaki ufuk denizi (kıyıdan 2–9 birim)
      const w = a.water;
      if (w && w.tiles.length > 6) {
        const s = w.tiles[Math.floor(rand() * w.tiles.length)];
        a.gx = tx(s[0]); a.gz = tz(s[1]); a.gy = w.y;
      } else {
        const ang = rand() * Math.PI * 2;
        const hw = h.width / 2, hd = h.depth / 2;
        const cx = tx(0) + hw - 0.5, cz = tz(0) + hd - 0.5;
        const k = 1 / Math.max(Math.abs(Math.cos(ang)) / hw, Math.abs(Math.sin(ang)) / hd);
        const r = k + 2 + rand() * 7;
        a.gx = cx + Math.cos(ang) * r; a.gz = cz + Math.sin(ang) * r; a.gy = ocean?.y ?? 0;
      }
      // yön: atlayışın iki ucu da suda kalsın (kıyıya/kumsala atlamaz); bulunamazsa bu tur atlamaz
      a.yaw = rand() * Math.PI * 2;
      if (w && w.tiles.length > 6) {
        let ok = false;
        for (let k = 0; k < 8 && !ok; k++) {
          const y = rand() * Math.PI * 2, fx = Math.sin(y) * (LEN / 2 + 0.3), fz = Math.cos(y) * (LEN / 2 + 0.3);
          if (wetAt(h, a.gx + fx, a.gz + fz) && wetAt(h, a.gx - fx, a.gz - fz)) { a.yaw = y; ok = true; }
        }
        if (!ok) { a.until = t + 1; return; }
      }
      a.t0 = t; a.st = "jump"; a.hidden = false;
    }
    return;
  }
  const u = (t - a.t0) / JUMP;
  if (u >= 1) {
    a.st = "under"; a.hidden = true;
    if (a.again === 1) { a.again = 2; a.until = t + 0.35; burst(fxs, "splash", a.x, a.gy, a.z); } else a.until = t + 4 + rand() * 10;
    return;
  }
  const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
  const s = (u - 0.5) * LEN;
  a.x = a.gx + fx * s; a.z = a.gz + fz * s;
  a.y = a.gy - 0.35 + 1.25 * Math.sin(Math.PI * u);
  a.pitch = -Math.atan2(1.25 * Math.PI * Math.cos(Math.PI * u), LEN);
  a.tail = Math.sin((t - a.t0) * 14) * 0.25;
}

// ------------------------------------------------------------------ örnek yazımı
function write(a: Animal, s: THREE.InstancedMesh, g: THREE.InstancedMesh | null, t: number, ws = 1) {
  if (a.hidden) {
    if (a.drawnHidden) return;
    a.parts.forEach((p, i) => { const mesh = p.glow ? g : s; if (mesh) mesh.instanceMatrix.array.fill(0, a.slots[i] * 16, a.slots[i] * 16 + 16); });
    a.drawnHidden = true;
    return;
  }
  a.drawnHidden = false;
  _e.set(a.pitch, a.yaw, a.roll, "YXZ");
  _q.setFromEuler(_e);
  const sc = a.sc * walkK(a, ws);
  _b.compose(_v.set(a.x, a.y, a.z), _q, _s.set(sc, sc * a.squash, sc));
  const tailY = TAIL_Y.has(a.kind);
  void t;
  for (let i = 0; i < a.parts.length; i++) {
    const p = a.parts[i];
    const mesh = p.glow ? g : s;
    if (!mesh) continue;
    const off = a.slots[i] * 16;
    const role = p.role;
    if ((a.legsOff && (role === "legF" || role === "legB")) || (role === "blink" && !a.blink)) { mesh.instanceMatrix.array.fill(0, off, off + 16); continue; }
    switch (role) {
      case "head": _e.set(a.head, a.headYaw, 0, "YXZ"); break;
      case "wingL": _e.set(0, 0, -a.wing, "YXZ"); break;
      case "wingR": _e.set(0, 0, a.wing, "YXZ"); break;
      case "tail": _e.set(tailY ? 0 : a.tail, tailY ? a.tail : 0, 0, "YXZ"); break;
      case "legF": case "legB": {
        const sw = a.swing * (p.side ?? 1) * (role === "legF" ? 1 : -1);
        if (a.kind === "crab") _e.set(0, sw, 0, "YXZ"); else _e.set(sw, 0, 0, "YXZ");
        break;
      }
      default: _e.set(0, 0, 0, "YXZ");
    }
    _q.setFromEuler(_e);
    _p.compose(_v.set(p.p[0], p.p[1], p.p[2]), _q, ONE);
    _m.compose(p.o ? _v.set(p.o[0], p.o[1], p.o[2]) : _v.set(0, 0, 0), I, _s.set(p.s[0], p.s[1], p.s[2]));
    _p.multiply(_m);
    _m.multiplyMatrices(_b, _p);
    mesh.instanceMatrix.array.set(_m.elements, off);
  }
}

// ------------------------------------------------------------------ S48: dokunma tepkileri
type Rx = "purr" | "roll" | "hop" | "alert" | "glass" | "scatter" | "wag" | "blink" | "spin" | "startle" | "beacon";
type MsgKey = keyof typeof M.tr;
/** Durağan öğeden hayvanlara dürtme (ağaç → tepesindeki kuş/sincap, su → ördek/balık, akvaryum → balıklar cama). */
interface LifeApi { poke: (what: "tree" | "water" | "aquarium", x: number, z: number) => void }

/** Bir noktadan (çoğunlukla kameradan, yani kullanıcıdan) uzağa yürünebilir bir hedef. */
function awayFrom(a: Animal, h: Habitat, px: number, pz: number, d: number): boolean {
  let ang = Math.atan2(a.z - pz, a.x - px);
  if (!Number.isFinite(ang)) ang = rand() * Math.PI * 2;
  for (let k = 0; k < 12; k++) {
    const g = ang + (rand() - 0.5) * (0.5 + k * 0.35), r = d * (1 - k * 0.05);
    const gx = a.x + Math.cos(g) * r, gz = a.z + Math.sin(g) * r;
    if (walkable(h, gx, gz)) { a.gx = gx; a.gz = gz; return true; }
  }
  return false;
}

function rxStart(a: Animal, r: Rx, t: number, dur: number) { a.rx = r; a.rxT = t; a.rxUntil = t + dur; a.emitAt = 0; }

function glassRx(a: Animal, t: number, cx: number, cz: number) {
  // akvaryum balığı: kameraya bakan cama yüzer
  const dx = cx - a.home.x, dz = cz - a.home.z, n = Math.hypot(dx, dz) || 1;
  a.ax = a.home.x + (dx / n) * 0.3; a.az = a.home.z + (dz / n) * 0.22 + (rand() - 0.5) * 0.1;
  a.ay = a.home.y + (rand() - 0.5) * 0.18;
  rxStart(a, "glass", t, 3.6);
}

/** Dokunuşa türün tepkisi; [duyuru anahtarı, ses] döner (tablo: touch.ts `animalCue`). `quiet` (hareket azaltma): hareket kurulmaz,
 *  yalnızca ses ve duyuru. */
function react(a: Animal, all: Animal[], t: number, h: Habitat, fx: FxState, cx: number, cz: number, quiet: boolean): [MsgKey, Sfx | null] {
  const boost = (k: number, dur: number) => { a.boost = t + dur; a.boostK = k; };
  if (t - a.tapAt > 6) a.taps = 0;
  a.taps++; a.tapAt = t;
  const cue = animalCue(a.kind, a.taps, a.mode === "aquarium");
  switch (a.kind) {
    case "cat": {
      if (a.taps >= 3) {
        a.taps = 0;
        if (!quiet) { a.rx = null; a.roll = 0; a.y = 0; if (awayFrom(a, h, cx, cz, 4.5)) { a.st = "go"; boost(2.2, 5); } }
        break;
      }
      if (quiet) break;
      a.st = "rest"; a.until = t + 3.2;
      if (a.taps === 2) rxStart(a, "roll", t, 2.6);
      else rxStart(a, "purr", t, 2.4);
      break;
    }
    case "dog": {
      if (a.taps >= 3) {
        a.taps = 0;
        if (!quiet && awayFrom(a, h, cx, cz, 5)) { a.rx = null; a.st = "go"; boost(3.2, 4); }
        break;
      }
      if (!quiet) { a.st = "rest"; a.until = t + 2.4; rxStart(a, "wag", t, 2); }
      break;
    }
    case "bird": case "gull": {
      const gull = a.kind === "gull";
      if (!quiet) {
        if (a.st !== "fly") {
          a.st = "fly"; a.until = t + 7 + rand() * 6;
          a.gx = a.x + (rand() - 0.5) * 5; a.gz = a.z + (rand() - 0.5) * 5; a.gy = Math.max(a.y, 0.3) + 2.2 + rand() * 1.5;
          a.speed = (gull ? 0.5 : 0.85) * (rand() < 0.5 ? 1 : -1);
        } else a.speed = Math.sign(a.speed || 1) * Math.min(1.6, Math.abs(a.speed) * 1.5);
        rxStart(a, "startle", t, 0.45);
      }
      break;
    }
    case "pigeon": {
      if (!quiet) {
        a.ax = a.x; a.ay = a.y; a.az = a.z;
        if (a.mode === "ledge") {
          // pervazdan çıkıp bir tur atar, yerine döner
          a.bx = a.x; a.by = a.y; a.bz = a.z; a.lx = Math.sin(a.yaw + Math.PI / 2) * 1.4; a.lz = Math.cos(a.yaw + Math.PI / 2) * 1.4;
          rxStart(a, "hop", t, 2);
        } else {
          if (!awayFrom(a, h, cx, cz, 3.5)) { a.gx = a.x; a.gz = a.z; }
          a.bx = a.gx; a.by = 0; a.bz = a.gz; a.lx = 0; a.lz = 0;
          rxStart(a, "hop", t, 1.3);
        }
      }
      break;
    }
    case "duck": {
      const w = a.water;
      if (!quiet && w) {
        let best = -1, bd = 0;
        for (let k = 0; k < Math.min(24, w.tiles.length); k++) {
          const s = w.tiles[Math.floor(rand() * w.tiles.length)];
          const d = Math.hypot(tx(s[0]) - a.x, tz(s[1]) - a.z);
          if (d > bd && d < 5) { bd = d; best = w.tiles.indexOf(s); }
        }
        if (best >= 0) { a.gx = tx(w.tiles[best][0]); a.gz = tz(w.tiles[best][1]); a.st = "go"; boost(4, 2.5); }
        burst(fx, "ripple", a.x, a.y + 0.05, a.z);
      }
      break;
    }
    case "fish": {
      if (a.mode === "aquarium") {
        if (!quiet) for (const b of all) if (b.mode === "aquarium" && Math.hypot(b.home.x - a.home.x, b.home.z - a.home.z) < 0.6) glassRx(b, t, cx, cz);
        break;
      }
      const w = a.water;
      if (!quiet && w) {
        const s = w.tiles[Math.floor(rand() * w.tiles.length)];
        a.gx = tx(s[0]); a.gz = tz(s[1]); a.st = "go"; boost(5, 1.8);
        burst(fx, "ripple", a.x, a.y + 0.08, a.z);
      }
      break;
    }
    case "squirrel":
      if (!quiet) { if (a.st === "ground" || a.st === "down") a.st = "up"; a.until = t + 8; boost(3, 3); }
      break;
    case "rabbit":
      if (!quiet && awayFrom(a, h, cx, cz, 3.5)) { a.st = "go"; boost(2.4, 3); }
      break;
    case "penguin":
      if (!quiet && awayFrom(a, h, cx, cz, 2.5)) { a.st = "go"; boost(2, 1.8); }
      break;
    case "deer":
      if (!quiet) { a.st = "rest"; a.until = t + 2; a.ax = cx; a.az = cz; a.then = "flee"; rxStart(a, "alert", t, 0.9); }
      break;
    case "owl":
      if (!quiet) rxStart(a, "blink", t, 1.4);
      break;
    case "firefly":
      if (!quiet) for (const b of all) if (b.kind === "firefly" && Math.hypot(b.x - a.x, b.z - a.z) < 2.6) { b.ax = a.x; b.az = a.z; rxStart(b, "scatter", t, 3); }
      break;
    case "dolphin":
      if (!quiet && a.st === "jump") a.again = 1;
      break;
    case "crab": {
      if (!quiet) {
        const side = rand() < 0.5 ? 1 : -1;
        const gx = a.x + Math.sin(a.yaw + side * Math.PI / 2) * 1.6, gz = a.z + Math.cos(a.yaw + side * Math.PI / 2) * 1.6;
        if (walkable(h, gx, gz)) { a.gx = gx; a.gz = gz; a.st = "go"; boost(3, 2.5); }
      }
      break;
    }
    case "vacuum": {
      if (!quiet) {
        a.yaw += Math.PI;
        const fx0 = Math.sin(a.yaw), fz0 = Math.cos(a.yaw);
        if (pickGround(a, h, (x, z) => (x - a.x) * fx0 + (z - a.z) * fz0 > 0.5)) a.st = "go";
      }
      break;
    }
    case "robot":
      if (!quiet) rxStart(a, "spin", t, 1.2);
      break;
    case "satellite": case "shuttle":
      if (!quiet) rxStart(a, "beacon", t, 1.6);
      break;
  }
  return cue;
}

/** Süren tepkinin duruşu; true ise bu kare türün normal davranışı çalışmaz. */
function stepRx(a: Animal, t: number, dt: number, h: Habitat, fx: FxState): boolean {
  const u = (t - a.rxT) / Math.max(0.01, a.rxUntil - a.rxT);
  switch (a.rx) {
    case "purr":
      // oturur, başını kaldırıp kuyruğunu sallar, kalpler yükselir
      a.y = 0; a.roll = 0; a.pitch = 0; a.squash = 0.9; a.legsOff = false; a.swing = 0;
      a.head = -0.25; a.headYaw = Math.sin(t * 1.5) * 0.2; a.tail = Math.sin(t * 2.2) * 0.5;
      if (t > a.emitAt) { a.emitAt = t + 0.5; burst(fx, "hearts", a.x, 0.45, a.z, 0.8); }
      return true;
    case "roll": {
      // sırtüstü yuvarlanır, patiler havada
      const k = Math.max(0, Math.min(1, u / 0.18, (1 - u) / 0.18));
      a.roll = Math.PI * k; a.y = 0.38 * k; a.pitch = 0; a.squash = 1; a.legsOff = false;
      a.swing = Math.sin(t * 9) * 0.5; a.tail = Math.sin(t * 4) * 0.4; a.head = 0; a.headYaw = Math.sin(t * 2) * 0.3;
      if (t > a.emitAt) { a.emitAt = t + 0.6; burst(fx, "hearts", a.x, 0.6, a.z, 0.8); }
      return true;
    }
    case "wag":
      a.tail = Math.sin(t * 28) * 0.8; a.y = Math.max(0, Math.sin(t * 9)) * 0.07; a.head = -0.2 + Math.sin(t * 9) * 0.08; a.headYaw = 0;
      a.swing = 0; a.squash = 1; a.legsOff = false; a.pitch = 0;
      if (t > a.emitAt) { a.emitAt = t + 0.7; burst(fx, "hearts", a.x, 0.55, a.z, 0.7); }
      return true;
    case "hop": {
      // kanat çırparak kavisli uçuş (güvercin)
      const v = Math.min(1, u);
      a.x = a.ax + (a.bx - a.ax) * v + a.lx * Math.sin(Math.PI * v);
      a.z = a.az + (a.bz - a.az) * v + a.lz * Math.sin(Math.PI * v);
      a.y = a.ay + (a.by - a.ay) * v + Math.sin(Math.PI * v) * (a.mode === "ledge" ? 0.8 : 1.3);
      const dx = (a.bx - a.ax) + a.lx * Math.PI * Math.cos(Math.PI * v), dz = (a.bz - a.az) + a.lz * Math.PI * Math.cos(Math.PI * v);
      if (Math.hypot(dx, dz) > 0.01) turn(a, Math.atan2(dx, dz), dt, 8);
      a.wing = 0.6 + Math.sin(t * 34) * 0.6; a.legsOff = false; a.head = 0; a.pitch = -0.2;
      return true;
    }
    case "alert":
      a.head = -0.55; a.headYaw = 0; a.swing = 0; a.y = 0;
      return true;
    case "glass": {
      const k = Math.min(1, dt * 3);
      a.x += (a.ax - a.x) * k; a.z += (a.az - a.z) * k; a.y += (a.ay + Math.sin(t * 2) * 0.03 - a.y) * k;
      turn(a, Math.atan2(a.ax - a.home.x, a.az - a.home.z), dt, 6);
      a.tail = Math.sin(t * 14) * 0.5;
      if (t > a.emitAt) { a.emitAt = t + 1.2; burst(fx, "bubbles", a.x, a.y, a.z); }
      return true;
    }
    case "blink":
      a.blink = ((t - a.rxT) % 0.45) > 0.18; a.headYaw = Math.sin(Math.PI * Math.min(1, u * 1.4)) * 2.4;
      return true;
    case "spin":
      a.headYaw = (t - a.rxT) * 12;
      return true;
    case "startle":
      a.y += 3.4 * dt; a.wing = 0.7 + Math.sin(t * 45) * 0.7; a.pitch = -0.4; a.roll = 0;
      return true;
  }
  void h;
  return false;
}

function endRx(a: Animal, t: number, h: Habitat) {
  const r = a.rx;
  a.rx = null;
  if (r === "roll" || r === "purr" || r === "wag") { a.roll = 0; a.y = 0; a.squash = 1; }
  if (r === "hop") { a.x = a.bx; a.z = a.bz; a.y = a.by; a.wing = 0; a.pitch = 0; a.st = "rest"; a.until = t + 1.5 + rand() * 2; }
  if (r === "blink" || r === "spin") a.headYaw = 0;
  if (a.then === "flee") {
    a.then = "";
    if (awayFrom(a, h, a.ax, a.az, 4.5)) { a.st = "go"; a.boost = t + 4; a.boostK = 3; }
  }
}

function Interactables({ built, live, api }: { built: Built; live: WorldLive; api: MutableRefObject<LifeApi> }) {
  const hot = useMemo(() => hotspots(built), [built]);
  const camera = useThree((st) => st.camera), gl = useThree((st) => st.gl);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const lampsOff = useRef(new Set<number>()); // işaretsiz lambalar; işaretliler lampSwitch'te (havuz/ışık ile ortak)
  const lampIdx = useMemo(() => hot.flatMap((h, i) => (h.kind === "lamp" ? [i] : [])), [hot]);
  const isOff = (i: number) => { const k = hot[i]?.lamp; return k ? lampSwitch.isOff(k) : lampsOff.current.has(i); };
  useEffect(() => {
    const m = mesh.current;
    lampsOff.current.clear();
    lampSwitch.clear();
    if (!m) return;
    hot.forEach((s, i) => { _m.compose(_v.set(s.x, s.y, s.z), I, _s.set(s.sx, s.sy, s.sz)); m.setMatrixAt(i, _m); });
    m.instanceMatrix.needsUpdate = true;
    m.boundingSphere = HUGE;
  }, [hot]);
  useEffect(() => () => lampSwitch.clear(), []); // sahneden çıkınca kapalı lamba kalmasın
  // geliştirme: ekran görüntüsü betikleri durağan hedefleri bulabilsin (üretim derlemesinde yok)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voxcrewHot?: unknown };
    w.__voxcrewHot = () => hot.map((h, i) => {
      const v = new THREE.Vector3(h.x, h.kind === "lamp" ? h.top - 0.3 : h.y, h.z).project(camera), r = gl.domElement.getBoundingClientRect();
      return { i, kind: h.kind, x: +h.x.toFixed(2), y: +h.y.toFixed(2), z: +h.z.toFixed(2), off: isOff(i),
        sx: Math.round(r.left + ((v.x + 1) / 2) * r.width), sy: Math.round(r.top + ((1 - v.y) / 2) * r.height) };
    });
    return () => { delete w.__voxcrewHot; };
  }, [hot]);
  // sönük lambalar: ampulün üstüne koyu kapak (efekt dizisinde; ek çizim çağrısı yok)
  useFrame(() => {
    for (const i of lampIdx) {
      if (!isOff(i)) continue;
      const b = hot[i]?.bulb;
      if (b) box(live.fx, b[0], b[1], b[2], b[3], b[4], b[5], 0, 0, 0, C.dark);
    }
  });
  // W3 (WALK-FUN): avatarın dokunuşu — hayvan bulunamadıysa en yakın durağan nesne (≤ 1,6 birim); Yakındakiler listesi
  useFrame(() => {
    const req = avatarPokes.req;
    if (!req) return;
    if (req.done || performance.now() - req.at > 1000) { avatarPokes.req = null; return; }
    if (performance.now() - req.at < 40) return; // önce hayvanlar (Ambient yaşam döngüsü) denesin
    let best = -1, bd = 1.6;
    hot.forEach((h, i) => { if (h.kind === "coffee" || h.big) return; const d = Math.hypot(h.x - req.x, h.z - req.z); if (d < bd) { bd = d; best = i; } });
    req.done = true;
    if (best >= 0) act(best, null);
  });
  useEffect(() => {
    ambientNearby.hot = hot.flatMap((h, i) => (h.kind === "coffee" || h.big ? [] : [{ id: `hot:${i}`, kind: "prop" as const, x: h.x, z: h.z, label: "", type: h.kind }]));
    return () => { ambientNearby.hot = []; };
  }, [hot]);
  if (!hot.length) return null;
  const click = (e: ThreeEvent<MouseEvent>) => {
    const i = e.instanceId ?? -1, s = hot[i];
    if (!s) return;
    // hayvan ya da ajan da bu ışında ise o kazanır (hedef kutuları bilerek cömert: çiçek, ağaç)
    if (hotYields(e.intersections.map((x) => x.object.name))) return;
    if (!s.big) e.stopPropagation(); // büyük suda olay sürer: yürüme modunda tıkla-git (kıyıya yürü) bozulmaz
    act(i, e.point);
  };
  function act(i: number, point: THREE.Vector3 | null) {
    const s = hot[i];
    if (!s) return;
    // sakin bölge: şaka yok; hareket azaltmada parçacık yok (fx.calm), ses ve etiket var (touch.ts)
    const plan = touchPlan("hot", { quiet: inQuietZone(s.x, s.z), reduced: reducedMotion() });
    if (!plan.react) { noteTouch({ target: "hot", kind: s.kind, msg: null, sfx: null, motion: false, quiet: true }); return; }
    const fx = live.fx;
    if (s.kind === "lamp") {
      const off = !isOff(i);
      if (s.lamp) lampSwitch.set(s.lamp, off);
      else if (off) lampsOff.current.add(i); else lampsOff.current.delete(i);
      const [key, cue] = hotCue("lamp", off);
      playSfx(cue);
      say(msg(M, key), s.x, s.top + 0.35, s.z);
      noteTouch({ target: "hot", kind: s.kind, msg: key, sfx: cue, motion: plan.motion, quiet: false });
      return;
    }
    const [key, cue] = hotCue(s.kind);
    if (s.kind === "tree") { burst(fx, "leaves", s.x, Math.max(1, s.top - 1), s.z); api.current.poke("tree", s.x - 0.2, s.z); }
    else if (s.kind === "flower") burst(fx, "petals", s.x, 0.35, s.z);
    else if (s.kind === "coffee") burst(fx, "steam", s.x, s.top, s.z);
    else if (s.kind === "water") { const p = point ?? { x: s.x, z: s.z }; burst(fx, "splash", p.x, s.top + 0.02, p.z); api.current.poke("water", p.x, p.z); }
    else if (s.kind === "aquarium") { burst(fx, "bubbles", s.x, 0.85, s.z); api.current.poke("aquarium", s.x, s.z); }
    playSfx(cue);
    say(msg(M, key), s.x, s.kind === "tree" ? Math.max(1.2, s.top * 0.55) : s.top + 0.35, s.z);
    noteTouch({ target: "hot", kind: s.kind, msg: key, sfx: cue, motion: plan.motion, quiet: false });
  }
  const over = (e: ThreeEvent<PointerEvent>) => {
    if (hotYields(e.intersections.map((x) => x.object.name))) return; // ajan/hayvan önce
    if (!hot[e.instanceId ?? -1]?.big) e.stopPropagation();
    document.body.style.cursor = "pointer";
  };
  const out = () => { document.body.style.cursor = ""; };
  return (
    <instancedMesh key={`hot${hot.length}`} ref={mesh} args={[unitBox, undefined, hot.length]} visible={false} frustumCulled={false}
      onClick={click} onPointerOver={over} onPointerOut={out} name={PICK_HOT}>
      <meshBasicMaterial colorWrite={false} depthWrite={false} />
    </instancedMesh>
  );
}

/** Tepki etiketi (görsel; ekran okuyucuya canlı bölge ayrıca duyurur): ≈ 2,6 sn sonra kaybolur. */
function ReactionTag() {
  const said = useSaid((s) => s.said);
  useEffect(() => {
    if (!said) return;
    const id = window.setTimeout(() => { if (useSaid.getState().said === said) useSaid.setState({ said: null }); }, 2600);
    return () => window.clearTimeout(id);
  }, [said]);
  if (!said) return null;
  return (
    <group position={[said.x, said.y, said.z]}>
      <Html center style={{ pointerEvents: "none" }} zIndexRange={[38, 0]}>
        <span aria-hidden="true" style={{ display: "inline-block", whiteSpace: "nowrap", padding: "2px 8px", borderRadius: 8,
          background: "rgba(20,18,30,0.88)", color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.35)",
          fontFamily: "'Pixelify Sans Variable', system-ui, sans-serif", fontSize: 14, lineHeight: "20px" }}>
          {said.text}
        </span>
      </Html>
    </group>
  );
}
