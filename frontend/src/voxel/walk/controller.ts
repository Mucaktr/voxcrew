/**
 * W1a (WALK-CORE) — yürüme modu denetleyicisi: saf, React'siz, belirlenimci işlevler.
 *
 * - girdi → hız (kameraya göre WASD/oklar/joystick, koşma)
 * - karo ızgarasına karşı çarpışma (`built.blocked` + ızgara sınırı), eksen ayrık kaydırma (köşede takılmaz), yarıçap 0,28
 * - ajanlar katı daire (PHYS: paylaşılan çözücünün `pushOutCircles` işlevi; avatar ajanın içinden geçemez, ajan burada
 * itilmez; ajanlar kalabalık çözücüsünde kinematik avatar bedeninden kendileri yana çekilir) ve ince eşya çarpıştırıcıları
 * (physics/world.ts: yürünebilir karodaki sandalye, bank, yatak, sandık; tıkla-git hedefi ve çıkılan karo muaf)
 * - tıkla-git: mevcut `findPath` (scenes.ts, yalnız okunur); ulaşılamayan hedefte en yakın ulaşılabilir karo
 * - örtü ızgarası (çatı altı karolar, kesit için) ve yükseklik haritası (duvar penceresi, kamera çarpışması)
 * - yakınlık indeksi (4 birimlik hücre; mesafe → tür → kimlik sırasıyla kararlı)
 * - doğma karosu, çıktı panosu (ya da eşdeğeri) noktası, hatıra yerleşim adayları (walk_check.mjs da kullanır)
 * - EXP (E1b): sınır "dünya ızgarası ∪ yüklü yakın çevre parselleri" (`NavGrid.outer`,
 * physics/world.ts çevre ızgarası); yüklenmemiş ya da ulaşılamaz parsel katıdır. Tıkla-git, hedef ya da avatar ızgara dışındayken
 * birleşik ızgarada (dünya + yakın parseller) küçük BFS ile çalışır; ızgara içi rota eskisiyle bayt bayt aynı.
 *
 * - WALK-PHYS: avatarın ayak yüksekliği (`y`), basamak, zıplama ve tırmanma (physics/height.ts). `stepAvatar({ climb: true })`
 * yüksekliğe duyarlı çarpışma kullanır: yürünebilir karo her zaman girilebilir (2B davranışı aynı), tırmanılabilir engele ayak
 * `top − STEP_H` yüksekliğine ulaşınca girilir (üstünde yürünür, kenardan düşülür); ajan ayrımı yerdeyken. `climb` verilmezse
 * davranış bayt bayt eskisi (ajan ve test yolu). Tıkla-git (`planRoute(…, { climb: true })`) avatar ya da hedef bir engelin
 * üstündeyse basamak sınırlı BFS ile rota çıkarır: zıplama gerektiren engelin üstünden yol geçmez.
 *
 * Koordinat: karo (i, j) dünya x ∈ [i − W/2, i − W/2 + 1), z ∈ [j − D/2, j − D/2 + 1); merkez `tx(i)`, `tz(j)`. Büyümüş dünyada
 * `tx/tz` değişmez, ızgara +i/+j yönünde uzar. Bu dosya hiçbir şey çizmez ve DOM'a dokunmaz; ölçüm hedefi ≤ 0,3 ms/kare.
*/
import { isInSacredBuffer } from "../city/sacred";
import { AGENT_R } from "../physics/bodies";
import { pushOutCircles } from "../physics/solver";
import { FREE, outerKind, outerTop, PROP, resolveStatic, skipProps, SOLID as SW_SOLID, staticWorld, tileIndex as swTile, type OuterGrid, type StaticWorld } from "../physics/world";
import { ceilingAt, createVState, heightField, propClimbable, standY, stepVertical, walkAreas, STEP_H, type HeightCtx, type OuterHeights } from "../physics/height";
import { D, findPath, rng, tx, tz, W, type Built, type SceneCore, type Tile } from "../scenes";

// ------------------------------------------------------------------------------------------ sabitler
export const AVATAR_RADIUS = 0.28;
/** ajan beden yarıçapı (avatar + ajan merkezleri arası en az AVATAR_RADIUS + AGENT_RADIUS; kalabalık çözücüsüyle aynı) */
export const AGENT_RADIUS = AGENT_R;
export const WALK_SPEED = 2.6;
export const RUN_SPEED = 4.4;
/** kafa yüksekliği: bunun üstünde tabanı olan blok "örtü" (çatı/tavan) sayılır (WALK-COVER-001: ≥ 2,2) */
export const HEAD_Y = 2.2;
/** örtü sayılan blokların taban üst sınırı (bulut, ufuk, gökyüzü süsü hariç) */
export const COVER_MAX_Y = 9;
/** etkileşim ipucu menzili (§5) ve yakındakiler listesi yarıçapı (§4.1 Tab) */
export const INTERACT_RANGE = 1.6;
export const NEARBY_RADIUS = 8;
/** tıkla-git ara noktasına varış eşiği */
const ARRIVE = 0.12;
const EPS = 1e-4;
const HW = W / 2, HD = D / 2;

export const tileIndexX = (x: number) => Math.floor(x + HW);
export const tileIndexZ = (z: number) => Math.floor(z + HD);
export const tileAt = (x: number, z: number): Tile => [tileIndexX(x), tileIndexZ(z)];

// ------------------------------------------------------------------------------------------ gezinme ızgarası
export interface NavGrid {
  width: number;
  depth: number;
  /** 1 = engelli (blocked); dizin j * width + i */
  blocked: Uint8Array;
  /** EXP (E1b): yürüme modunda yüklü yakın çevre parselleri (Outskirts.tsx yazar); yoksa ızgara dışı katı */
  outer?: OuterGrid | null;
}

type NavSource = Pick<Built, "width" | "depth" | "blocked">;
const navCache = new WeakMap<object, NavGrid>();
/** ızgara → kaynak dünya (ince eşya çarpıştırıcıları için; blokları olmayan kaynakta yok) */
const navSrc = new WeakMap<NavGrid, NavSource>();
const fineCache = new WeakMap<NavGrid, StaticWorld | null>();

/** Izgaranın ince statik dünyası (yalnız eşya: PROP/SEAT); kaynakta blok/istasyon yoksa null. */
export function fineWorld(nav: NavGrid): StaticWorld | null {
  let sw = fineCache.get(nav);
  if (sw !== undefined) return sw;
  const src = navSrc.get(nav) as Partial<Built> | undefined;
  sw = src && Array.isArray(src.blocks) && Array.isArray(src.stations) ? staticWorld(src as Built) : null;
  fineCache.set(nav, sw);
  return sw;
}

/** Dünya başına bir kez (WeakMap) kurulan engel ızgarası. */
export function navGrid(built: NavSource): NavGrid {
  let g = navCache.get(built);
  if (!g) {
    const blocked = new Uint8Array(built.width * built.depth);
    for (const k of built.blocked) {
      const c = k.indexOf(",");
      const i = Number(k.slice(0, c)), j = Number(k.slice(c + 1));
      if (i >= 0 && j >= 0 && i < built.width && j < built.depth) blocked[j * built.width + i] = 1;
    }
    g = { width: built.width, depth: built.depth, blocked };
    navCache.set(built, g);
    navSrc.set(g, built);
  }
  return g;
}

export const inside = (nav: NavGrid, i: number, j: number) => i >= 0 && j >= 0 && i < nav.width && j < nav.depth;
/** Yürünebilir karo: ızgara içinde ve engelsiz. */
export const walkable = (nav: NavGrid, i: number, j: number) => inside(nav, i, j) && nav.blocked[j * nav.width + i] === 0;

/** EXP: avatar bu karoda durabilir mi — ızgara içinde engelsiz, ya da ızgara dışında yüklü çevre parselinin yürünebilir karosu. */
export function passable(nav: NavGrid, i: number, j: number): boolean {
  if (inside(nav, i, j)) return nav.blocked[j * nav.width + i] === 0;
  return !!nav.outer && outerKind(nav.outer, i, j) === FREE;
}

/** Ek engel sorgusu (ör. oturan ajanın istasyon karosu, §3.4). true → karo bu kare için kapalı. */
export type ExtraBlock = ((i: number, j: number) => boolean) | null | undefined;

/** WALK-PHYS: yüksekliğe duyarlı çarpışma bağlamı (yalnız avatar): yükseklik alanı + ayak yüksekliği. */
export interface FootCtx { ctx: HeightCtx; footY: number }

function solid(nav: NavGrid, i: number, j: number, extra: ExtraBlock, foot?: FootCtx | null) {
  if (extra && extra(i, j)) return true;
  if (foot) return standY(foot.ctx, i, j, foot.footY) === -Infinity;
  return !passable(nav, i, j);
}

/** (x, z) merkezli, yarı kenarı r olan kare bir engelli karoya ya da ızgara dışına taşıyor mu. `foot` → yüksekliğe duyarlı. */
export function overlaps(nav: NavGrid, x: number, z: number, r = AVATAR_RADIUS, extra?: ExtraBlock, foot?: FootCtx | null): boolean {
  const i0 = tileIndexX(x - r), i1 = tileIndexX(x + r - EPS), j0 = tileIndexZ(z - r), j1 = tileIndexZ(z + r - EPS);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (solid(nav, i, j, extra, foot)) return true;
  return false;
}

/** STUCK-FIX (WALK-STUCK-001): (x, z) karesinin engelli karolarla kesişim alanı toplamı (0 → çakışma yok). `overlaps` ile aynı karo kuralı. */
export function overlapDepth(nav: NavGrid, x: number, z: number, r = AVATAR_RADIUS, extra?: ExtraBlock, foot?: FootCtx | null): number {
  const i0 = tileIndexX(x - r), i1 = tileIndexX(x + r - EPS), j0 = tileIndexZ(z - r), j1 = tileIndexZ(z + r - EPS);
  let a = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (!solid(nav, i, j, extra, foot)) continue;
    const ox = Math.min(x + r, i + 1 - HW) - Math.max(x - r, i - HW), oz = Math.min(z + r, j + 1 - HD) - Math.max(z - r, j - HD);
    if (ox > 0 && oz > 0) a += ox * oz;
  }
  return a;
}

// ------------------------------------------------------------------------------------------ WALK-PHYS: yükseklik bağlamı
const hctxCache = new WeakMap<NavGrid, HeightCtx | null>();
/** Izgaranın yükseklik bağlamı (yükseklik alanı + 2B engel + çevre parseli üst yüzleri); kaynakta blok yoksa null. */
export function heightCtx(nav: NavGrid): HeightCtx | null {
  let c = hctxCache.get(nav);
  if (c !== undefined) return c;
  const src = navSrc.get(nav) as Partial<Built> | undefined;
  if (!src || !Array.isArray(src.blocks) || !Array.isArray(src.stations)) { hctxCache.set(nav, null); return null; }
  const outer: OuterHeights = {
    kind: (i, j) => (nav.outer?.parcels.size ? outerKind(nav.outer, i, j) : -1),
    top: (i, j) => (nav.outer ? outerTop(nav.outer, i, j) : NaN),
  };
  c = { hf: heightField(src as Built), blocked: nav.blocked, outer };
  hctxCache.set(nav, c);
  return c;
}

// ------------------------------------------------------------------------------------------ çarpışma ve kaydırma
export interface Vec2 { x: number; z: number }
export interface MoveResult { x: number; z: number; hitX: boolean; hitZ: boolean }

/**
 * (dx, dz) kadar hareket; eksen ayrık çözüm (önce x, sonra z) duvar boyunca kaydırır. Büyük adımlar ≤ 0,2 birimlik alt
 * adımlara bölünür (karo atlama yok). Başlangıçta zaten çakışıyorsa (STUCK-FIX: düşüş/merdiven sonrası gömülü) yalnızca çakışmayı
 * KESİN AZALTAN alt adım uygulanır (çıkış yönünde yürünür; eskiden tek alt adımda bütün çakışmayı temizlemek gerekiyordu → kilit).
 */
export function moveWithCollision(nav: NavGrid, pos: Vec2, dx: number, dz: number, r = AVATAR_RADIUS, extra?: ExtraBlock, foot?: FootCtx | null): MoveResult {
  let x = pos.x, z = pos.z, hitX = false, hitZ = false;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.2));
  const sx = dx / steps, sz = dz / steps;
  const stuck = overlaps(nav, x, z, r, extra, foot);
  // STUCK-FIX: gömülüyken çakışma alanı (WALK-STUCK-001); azaltan alt adım kabul edilir
  let depth = stuck ? overlapDepth(nav, x, z, r, extra, foot) : 0;
  for (let s = 0; s < steps; s++) {
    if (sx !== 0 && !hitX) {
      const nx = x + sx;
      if (!overlaps(nav, nx, z, r, extra, foot)) x = nx;
      else if (stuck) { const d = overlapDepth(nav, nx, z, r, extra, foot); if (d < depth - 1e-9) { x = nx; depth = d; } else hitX = true; }
      else {
        hitX = true;
        const edge = sx > 0 ? tileIndexX(nx + r) - HW - r - EPS : tileIndexX(nx - r) + 1 - HW + r + EPS;
        if ((sx > 0 ? edge >= x : edge <= x) && !overlaps(nav, edge, z, r, extra, foot)) x = edge;
      }
    }
    if (sz !== 0 && !hitZ) {
      const nz = z + sz;
      if (!overlaps(nav, x, nz, r, extra, foot)) z = nz;
      else if (stuck) { const d = overlapDepth(nav, x, nz, r, extra, foot); if (d < depth - 1e-9) { z = nz; depth = d; } else hitZ = true; }
      else {
        hitZ = true;
        const edge = sz > 0 ? tileIndexZ(nz + r) - HD - r - EPS : tileIndexZ(nz - r) + 1 - HD + r + EPS;
        if ((sz > 0 ? edge >= z : edge <= z) && !overlaps(nav, x, edge, r, extra, foot)) z = edge;
      }
    }
  }
  return { x, z, hitX, hitZ };
}

/**
 * Ajanlar katı daire (PHYS, paylaşılan çözücü `pushOutCircles`): avatarı `others` dairelerinden (merkezler arası en az
 * `minDist`) dışarı iter; itme avatarı duvara sokarsa o eksen bırakılır. Ajanların konumu burada değişmez (kalabalık
 * çözücüsü kinematik avatardan onları kendisi uzaklaştırır). Sıra girdiyle aynı → belirlenimci.
 */
export function separate(nav: NavGrid, pos: Vec2, others: readonly Vec2[], minDist = AVATAR_RADIUS + AGENT_RADIUS, r = AVATAR_RADIUS): Vec2 {
  const p = { x: pos.x, z: pos.z };
  pushOutCircles(p, r, others, minDist - r, (x, z) => overlaps(nav, x, z, r));
  return p;
}

/** Avatar yürünemez bir yerdeyse (dünya değişti, ışınlama) en yakın yürünebilir karonun merkezine taşınır. */
export function unstick(nav: NavGrid, pos: Vec2, r = AVATAR_RADIUS): Vec2 {
  if (!overlaps(nav, pos.x, pos.z, r)) return { x: pos.x, z: pos.z };
  const t = nearestWalkable(nav, tileAt(pos.x, pos.z));
  return t ? { x: tx(t[0]), z: tz(t[1]) } : { x: pos.x, z: pos.z };
}

// ------------------------------------------------------------------------------------------ girdi → hız
/** Ham girdi: `x` sağ (+) / sol (−), `y` ileri (+) / geri (−); joystick için [-1, 1] analog. */
export interface MoveInput { x: number; y: number }

/** Kameranın baktığı yatay yön açısı (yaw): DIR_ANGLE ile aynı kural, ileri = (sin a, cos a). */
export function cameraYaw(camX: number, camZ: number, targetX: number, targetZ: number): number {
  return Math.atan2(targetX - camX, targetZ - camZ);
}

/** Joystick ölü bölgesi (oran) */
export const DEADZONE = 0.15;

/**
 * Girdi → dünya hızı (birim/sn). Kameraya göre: ileri = kameranın baktığı yön, sağ = ekranın sağı. Çapraz normalize edilir
 * (çapraz daha hızlı değil); analog büyüklük korunur (≤ 1). Ölü bölge altı → sıfır.
 */
export function inputToVelocity(input: MoveInput, camYaw: number, run = false): Vec2 {
  let { x, y } = input;
  const mag = Math.hypot(x, y);
  if (mag < DEADZONE) return { x: 0, z: 0 };
  if (mag > 1) { x /= mag; y /= mag; }
  const speed = run ? RUN_SPEED : WALK_SPEED;
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  // sağ vektör: ileri (fx, fz) için (−fz, fx)… three.js'te kamera +z'ye bakarken ekranın sağı −x'tir
  const rx = -fz, rz = fx;
  return { x: (fx * y + rx * x) * speed, z: (fz * y + rz * x) * speed };
}

/** Açıyı (−π, π] aralığına indirger. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/** `cur` açısını `target`'a en kısa yoldan en çok `maxDelta` kadar döndürür (`maxDelta` = Infinity → anında). */
export function turnToward(cur: number, target: number, maxDelta: number): number {
  const d = wrapAngle(target - cur);
  if (Math.abs(d) <= maxDelta) return wrapAngle(target);
  return wrapAngle(cur + Math.sign(d) * maxDelta);
}

/** Hız vektörünün bakış açısı (DIR_ANGLE kuralı: +z = 0, +x = π/2). */
export const headingOf = (vx: number, vz: number) => Math.atan2(vx, vz);

// ------------------------------------------------------------------------------------------ avatar adımı
export interface AvatarState {
  x: number;
  z: number;
  /** bakış açısı (rad, DIR_ANGLE kuralı) */
  heading: number;
  /** son karedeki yatay hız (birim/sn); Crowd yürüme animasyonu için */
  speed: number;
  /** tıkla-git yolu (karo dizisi) ve sıradaki ara nokta; null → serbest yürüyüş */
  route: Tile[] | null;
  routeIdx: number;
  /** PHYS: içinden çıkılan eşya karosu (oturduğu banktan kalkarken muaf; isteğe bağlı) */
  leave?: number;
  /** WALK-PHYS: ayak yüksekliği (dünya y), dikey hız, yerde mi, coyote ve zıplama tamponu (physics/height.ts VState) */
  y: number;
  vy: number;
  grounded: boolean;
  coyote: number;
  buffer: number;
  /** WALK-PHYS: üstünde durulan yüzey (son adım; kamera bunu izler) ve son dikey olay */
  ground: number;
  event: "jump" | "land" | null;
  /** HQA-FIX: tıkla-git takılma sayacı (sn) ve ara noktada yan kaçış (−1/0/+1; ara noktaya dik `ROUTE_SIDE`)*/
  rStall?: number;
  rSide?: number;
  /** HQA-FIX: takılma sayacının ölçtüğü ara nokta dizini ve ona en iyi yaklaşma */
  rIdx?: number;
  rBest?: number;
}

export function createAvatar(x: number, z: number, heading = Math.PI, y = 0): AvatarState {
  return { x, z, heading, speed: 0, route: null, routeIdx: 0, leave: -1, ...createVState(y), ground: y, event: null };
}

export interface StepOptions {
  dt: number;
  camYaw: number;
  input: MoveInput;
  run?: boolean;
  /** ajan konumları (yumuşak engel) */
  actors?: readonly Vec2[];
  /** oturan ajanların istasyonları gibi geçici kapalı karolar */
  extra?: ExtraBlock;
  /** dönüş hızı (rad/sn); hareket azaltmada Infinity (anında) */
  turnRate?: number;
  /** WALK-SCALE: avatar yarıçapı (yürüme ölçeğinde 0,2; yoksa AVATAR_RADIUS) */
  radius?: number;
  /** WALK-PHYS: yüksekliğe duyarlı yürüyüş (basamak, tırmanma, düşme); yoksa düz 2B (y = 0) */
  climb?: boolean;
  /** WALK-PHYS: bu adımda zıplama basıldı (tampona girer; yerde ya da coyote süresinde zıplar) */
  jump?: boolean;
}

/** WALK-PHYS: ajan ayrımı bu ayak yüksekliğinin altında (üstünde avatar ajanların üstündedir: bank, sandık). */
export const AGENT_SEP_MAX_Y = 0.45;

/** Kare süresi üst sınırı: düşük kare hızında da yürüme sürer (sleep.ts dersi), ama tek karede duvar atlanmaz (alt adımlar). */
export const STEP_DT_MAX = 0.25;

/**
 * Bir kare: elle girdi varsa tıkla-git yolunu iptal eder; yoksa yolu izler. Çarpışma, kaydırma, yumuşak engel ve dönüş.
 * `state`'i yerinde günceller (her karede nesne üretmez) ve döndürür.
 */
export function stepAvatar(nav: NavGrid, state: AvatarState, o: StepOptions): AvatarState {
  const dt = Math.min(Math.max(o.dt, 0), STEP_DT_MAX);
  const R = o.radius ?? AVATAR_RADIUS;
  let v = inputToVelocity(o.input, o.camYaw, o.run);
  if (v.x !== 0 || v.z !== 0) { state.route = null; state.routeIdx = 0; }
  else if (state.route) v = routeVelocity(state, o.run ? RUN_SPEED : WALK_SPEED, dt);
  const x0 = state.x, z0 = state.z;
  const fine = fineWorld(nav);
  const hc = o.climb ? heightCtx(nav) : null;
  if (hc) { stepAvatar3(nav, state, o, hc, fine, v, dt, R, x0, z0); routeStall(state, v, x0, z0, dt); return state; } // HQA-FIX
  // içinde durduğu eşya karosu (bank, sandalye: oturuştan kalkış) çıkana dek muaf; tıkla-git hedefi muaf
  if (fine) {
    const k = swTile(fine, state.x, state.z);
    if (k >= 0 && fine.kind[k] !== FREE && (v.x === 0 && v.z === 0 || state.leave === k)) state.leave = k;
    else state.leave = -1;
  }
  if (v.x !== 0 || v.z !== 0) {
    const m = moveWithCollision(nav, state, v.x * dt, v.z * dt, R, o.extra);
    state.x = m.x; state.z = m.z;
    if (fine) {
      const goal = state.route?.length ? state.route[state.route.length - 1] : null;
      const p = { x: state.x, z: state.z };
      resolveStatic(fine, p, R, goal ? goal[1] * fine.width + goal[0] : -1, state.leave ?? -1, 3, true);
      if (!overlaps(nav, p.x, p.z, R, o.extra)) { state.x = p.x; state.z = p.z; }
    }
  }
  if (o.actors?.length) {
    const p = { x: state.x, z: state.z };
    pushOutCircles(p, R, o.actors, AGENT_RADIUS, (x, z) => overlaps(nav, x, z, R, o.extra));
    state.x = p.x; state.z = p.z;
  }
  const mx = state.x - x0, mz = state.z - z0;
  state.speed = dt > 0 ? Math.hypot(mx, mz) / dt : 0;
  if (v.x !== 0 || v.z !== 0) state.heading = turnToward(state.heading, headingOf(v.x, v.z), (o.turnRate ?? 12) * dt);
  routeStall(state, v, x0, z0, dt); // HQA-FIX
  return state;
}

/** HQA-FIX: bu kadar (sn) ilerlemeyen tıkla-git önce ara noktanın bir yanına, sonra öbür yanına kaçar, sonra ara
 * noktayı atlar; son ara noktada takılırsa yol biter (bekleyen "git ve aç" yakınlıkla açılır).*/
export const ROUTE_STALL_S = 0.35;
/** HQA-FIX: yan kaçış uzaklığı (birim; ara noktaya dik) — karonun ortasındaki tabure/bank kenarından geçer (avatar yarıçapı ≤ 0,28). */
export const ROUTE_SIDE = 0.32;
/**
 * HQA-FIX — tıkla-git takılma kurtarması. Kök neden: rota karo ortalarından geçer; hedef eşyalarla çevriliyse
 * ince ızgarada yol yoktur ve rota kaba ızgaraya düşer, ortasında tabure/sandalye olan karodan geçer (<city> "Ayakta espresso": pizza
 * tezgâhının taburesi). Fizik avatarı taburede durdurur; eskiden hız sıfırda kalıyor, rota hiç bitmiyor ve "git ve dokun" bekleyişi
 * asılı kalıyordu. Elle girdi yokken ilerleme ölçülür; takılınca yan kaçış, öbür yan, sonra ara noktayı atla.
*/
function routeStall(state: AvatarState, v: Vec2, x0: number, z0: number, dt: number): void {
  if (!state.route) { state.rStall = 0; state.rSide = 0; return; }
  if (dt <= 0 || (v.x === 0 && v.z === 0)) return;
  // ilerleme = sıradaki ara noktaya (karo ortası) yaklaşma; yan yana kayıp duran (tabureye sürtünen) avatar ilerlemiş sayılmaz
  const wp = state.route[state.routeIdx];
  if (!wp) return;
  const cur = Math.hypot(tx(wp[0]) - state.x, tz(wp[1]) - state.z);
  if (state.rIdx !== state.routeIdx) { state.rIdx = state.routeIdx; state.rStall = 0; state.rBest = cur; return; }
  // en iyi yaklaşma 5 cm'den çok iyileşmedikçe sayaç işler (kenarda titreyen avatar da takılmış sayılır)
  if (cur < (state.rBest ?? Infinity) - 0.05) { state.rBest = cur; state.rStall = 0; return; }
  void x0; void z0;
  state.rStall = (state.rStall ?? 0) + dt;
  if (state.rStall < ROUTE_STALL_S) return;
  state.rStall = 0;
  const side = state.rSide ?? 0;
  if (side === 0) state.rSide = 1;
  else if (side > 0) state.rSide = -1;
  else {
    state.rSide = 0;
    state.routeIdx++;
    if (state.routeIdx >= state.route.length) { state.route = null; state.routeIdx = 0; }
  }
}

const _foot: FootCtx = { ctx: null as unknown as HeightCtx, footY: 0 };
const _skip = { hf: null as ReturnType<typeof heightField> | null, footY: 0 };
const skipFn = (k: number) => !!_skip.hf && propClimbable(_skip.hf, k, _skip.footY);

/**
 * WALK-PHYS — yüksekliğe duyarlı avatar adımı: yatay hareket ayak yüksekliğine göre (tırmanılabilir engel `top ≤ y + STEP_H`
 * olunca girilir), eşya kutuları üstüne çıkılabiliyorsa yok sayılır, sonra dikey adım (yüzey, tavan, zıplama). Belirlenimci.
 */
function stepAvatar3(nav: NavGrid, state: AvatarState, o: StepOptions, hc: HeightCtx, fine: StaticWorld | null, v: Vec2, dt: number, R: number, x0: number, z0: number): AvatarState {
  _foot.ctx = hc; _foot.footY = state.y;
  if (fine) {
    const k = swTile(fine, state.x, state.z);
    if (k >= 0 && fine.kind[k] !== FREE && (v.x === 0 && v.z === 0 || state.leave === k)) state.leave = k;
    else state.leave = -1;
  }
  if (v.x !== 0 || v.z !== 0) {
    const m = moveWithCollision(nav, state, v.x * dt, v.z * dt, R, o.extra, _foot);
    state.x = m.x; state.z = m.z;
    if (fine) {
      const goal = state.route?.length ? state.route[state.route.length - 1] : null;
      const p = { x: state.x, z: state.z };
      _skip.hf = hc.hf; _skip.footY = state.y; skipProps.fn = skipFn;
      try { resolveStatic(fine, p, R, goal ? goal[1] * fine.width + goal[0] : -1, state.leave ?? -1, 3, true); } finally { skipProps.fn = null; }
      if (!overlaps(nav, p.x, p.z, R, o.extra, _foot)) { state.x = p.x; state.z = p.z; }
    }
  }
  if (o.actors?.length && state.y < AGENT_SEP_MAX_Y) {
    const p = { x: state.x, z: state.z };
    pushOutCircles(p, R, o.actors, AGENT_RADIUS, (x, z) => overlaps(nav, x, z, R, o.extra, _foot));
    state.x = p.x; state.z = p.z;
  }
  // dikey: ayağın altındaki yüzey ve tavan
  const ground = surfaceUnder(hc, fine, state.x, state.z, state.y);
  const [ti, tj] = tileAt(state.x, state.z);
  const ceiling = ceilingAt(hc, ti, tj, ground);
  state.event = stepVertical(state, ground, ceiling, dt, !!o.jump);
  state.ground = ground;
  const mx = state.x - x0, mz = state.z - z0;
  state.speed = dt > 0 ? Math.hypot(mx, mz) / dt : 0;
  if (v.x !== 0 || v.z !== 0) state.heading = turnToward(state.heading, headingOf(v.x, v.z), (o.turnRate ?? 12) * dt);
  return state;
}

/**
 * WALK-PHYS — (x, z) noktasında ayağın altındaki yüzey (ayak `footY`): karo girilebiliyorsa onun yüzeyi; yürünebilir karodaki
 * tırmanılabilir eşyanın (bank, sandık) kutusunun üstündeyse eşyanın üst yüzü. Girilemeyen karoda (itilme) zemin.
 */
export function surfaceUnder(hc: HeightCtx, fine: StaticWorld | null, x: number, z: number, footY: number): number {
  const [i, j] = tileAt(x, z);
  const s = standY(hc, i, j, footY);
  const { hf } = hc;
  const inGrid = i >= 0 && j >= 0 && i < hf.width && j < hf.depth;
  if (s === -Infinity) return inGrid ? hf.floor[j * hf.width + i] : 0;
  if (fine && inGrid && !hc.blocked[j * hf.width + i]) {
    const k = j * hf.width + i;
    if (fine.kind[k] !== FREE && fine.kind[k] !== SW_SOLID && propClimbable(hf, k, footY)) {
      const b = fine.box;
      if (x >= b[k * 4] && x <= b[k * 4 + 2] && z >= b[k * 4 + 1] && z <= b[k * 4 + 3]) return Math.max(s, hf.top[k]);
    }
  }
  return s;
}

/** Yol izleme hızı: sıradaki karo merkezine yönelir; varınca bir sonrakine geçer; yol bitince null. */
function routeVelocity(state: AvatarState, speed: number, dt: number): Vec2 {
  const route = state.route!;
  while (state.routeIdx < route.length) {
    const [i, j] = route[state.routeIdx];
    let dx = tx(i) - state.x, dz = tz(j) - state.z;
    // HQA-FIX: takılınca ara noktanın yanına kaçılır (`routeStall`): hedef nokta ara noktaya dik ROUTE_SIDE kayar
    const side = state.rSide ?? 0;
    if (side) { const L = Math.hypot(dx, dz) || 1, px = (-dz / L) * ROUTE_SIDE * side, pz = (dx / L) * ROUTE_SIDE * side; dx += px; dz += pz; }
    const d = Math.hypot(dx, dz);
    if (d <= ARRIVE) { state.routeIdx++; state.rSide = 0; continue; }
    // son ara noktada aşmayı önle
    const s = Math.min(speed, d / Math.max(dt, 1e-3));
    return { x: (dx / d) * s, z: (dz / d) * s };
  }
  state.route = null; state.routeIdx = 0;
  return { x: 0, z: 0 };
}

// ------------------------------------------------------------------------------------------ erişilebilirlik (flood) ve tıkla-git
const reachCache = new WeakMap<object, { labels: Int32Array; main: number }>();

/** Karoların bağlı bileşen etiketleri (4-komşu; −1 engelli) ve "ana" bileşen: en çok istasyonu içeren (eşitlikte en küçük etiket). */
export function components(built: Pick<Built, "width" | "depth" | "blocked" | "stations">): { labels: Int32Array; main: number } {
  let c = reachCache.get(built);
  if (c) return c;
  const nav = navGrid(built);
  const n = nav.width * nav.depth;
  const labels = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let next = 0;
  for (let s = 0; s < n; s++) {
    if (labels[s] !== -1 || nav.blocked[s]) continue;
    let h = 0, t = 0;
    queue[t++] = s; labels[s] = next;
    while (h < t) {
      const cur = queue[h++];
      const ci = cur % nav.width, cj = (cur - ci) / nav.width;
      for (let d = 0; d < 4; d++) {
        const ni = ci + (d === 0 ? 1 : d === 1 ? -1 : 0), nj = cj + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (!inside(nav, ni, nj)) continue;
        const nk = nj * nav.width + ni;
        if (labels[nk] !== -1 || nav.blocked[nk]) continue;
        labels[nk] = next; queue[t++] = nk;
      }
    }
    next++;
  }
  const count = new Map<number, number>();
  for (const st of built.stations) {
    const [i, j] = st.tile;
    if (!inside(nav, i, j)) continue;
    const l = labels[j * nav.width + i];
    if (l >= 0) count.set(l, (count.get(l) ?? 0) + 1);
  }
  let main = 0, best = -1;
  for (const [l, k] of count) if (k > best || (k === best && l < main)) { best = k; main = l; }
  c = { labels, main };
  reachCache.set(built, c);
  return c;
}

/** `a` ve `b` karoları aynı bağlı bileşende mi (ikisi de yürünebilir). */
export function connected(built: Pick<Built, "width" | "depth" | "blocked" | "stations">, a: Tile, b: Tile): boolean {
  const nav = navGrid(built);
  if (!walkable(nav, a[0], a[1]) || !walkable(nav, b[0], b[1])) return false;
  const { labels } = components(built);
  return labels[a[1] * nav.width + a[0]] === labels[b[1] * nav.width + b[0]];
}

/**
 * `from` karosundan erişilebilen ve `target`'a (öklid, eşitlikte j sonra i) en yakın karo. Kendi BFS'i (findPath'in tampon
 * dizilerini paylaşmaz). Hedef zaten erişilebilirse kendisi.
 */
export function nearestReachable(nav: NavGrid, from: Tile, target: Tile): Tile | null {
  if (!walkable(nav, from[0], from[1])) return null;
  const n = nav.width * nav.depth;
  const seen = new Uint8Array(n), queue = new Int32Array(n);
  let h = 0, t = 0;
  const s = from[1] * nav.width + from[0];
  queue[t++] = s; seen[s] = 1;
  let best = s, bd = Infinity;
  while (h < t) {
    const cur = queue[h++];
    const ci = cur % nav.width, cj = (cur - ci) / nav.width;
    const d = (ci - target[0]) ** 2 + (cj - target[1]) ** 2;
    if (d < bd || (d === bd && cur < best)) { bd = d; best = cur; if (d === 0) break; }
    for (let k = 0; k < 4; k++) {
      const ni = ci + (k === 0 ? 1 : k === 1 ? -1 : 0), nj = cj + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (!walkable(nav, ni, nj)) continue;
      const nk = nj * nav.width + ni;
      if (seen[nk]) continue;
      seen[nk] = 1; queue[t++] = nk;
    }
  }
  return [best % nav.width, Math.floor(best / nav.width)];
}

/** `t`'ye en yakın yürünebilir karo (halka taraması; Chebyshev yarıçapı artarak, eşitlikte öklid → j → i). */
export function nearestWalkable(nav: NavGrid, t: Tile, maxR = 64, accept?: (i: number, j: number) => boolean): Tile | null {
  for (let r = 0; r <= maxR; r++) {
    let best: Tile | null = null, bd = Infinity;
    for (let j = t[1] - r; j <= t[1] + r; j++) for (let i = t[0] - r; i <= t[0] + r; i++) {
      if (Math.max(Math.abs(i - t[0]), Math.abs(j - t[1])) !== r) continue;
      if (!walkable(nav, i, j) || (accept && !accept(i, j))) continue;
      const d = (i - t[0]) ** 2 + (j - t[1]) ** 2;
      if (d < bd) { bd = d; best = [i, j]; }
    }
    if (best) return best;
  }
  return null;
}

export interface Route { goal: Tile; path: Tile[]; exact: boolean }

/**
 * Tıkla-git: avatar karosundan `target`'a yol (mevcut `findPath`, BFS). Hedef engelliyse ya da ulaşılamıyorsa en yakın
 * ulaşılabilir karoya gider (`exact: false`). Hiç hareket yoksa (zaten oradaysa) boş yol. Ulaşılabilir karo yoksa null.
 */
export function planRoute(built: Pick<Built, "width" | "depth" | "blocked">, from: Vec2 & { y?: number }, target: Tile, opts: { climb?: boolean; avoid?: readonly Tile[] } = {}): Route | null {
  const r0 = planRouteIn(built, from, target, !!opts.climb, null);
  // UXF-E · HQA-FIX: rota `avoid` karolarından (kapı, geçit, portal, merdiven tetiği) geçiyorsa ve hedef o karo
  // değilse, karolar kapalıyken yeniden planlanır — üç planlayıcıda da (düz, basamaklı, çevre). Dolambaç boyu sınırsız: kapı karosu
  // yalnız kapı tek geçitse (kapalıyken aynı hedefe varılamıyorsa) rotada kalır; orada tetik `doorIntended` ile susar.
  if (!r0 || !opts.avoid?.length) return r0;
  const eq = (a: Tile, b: Tile) => a[0] === b[0] && a[1] === b[1];
  const start = tileAt(from.x, from.z), mid = r0.path.slice(0, -1); // avatar karosu (rota başı bir komşu olabilir)
  const bad = opts.avoid.filter((a) => !eq(a, target) && !eq(a, r0.goal) && !eq(a, start) && mid.some((t) => eq(t, a)));
  if (!bad.length) return r0;
  const r1 = planRouteIn(built, from, target, !!opts.climb, new Set(bad.map((a) => `${a[0]},${a[1]}`)));
  return r1 && eq(r1.goal, r0.goal) ? r1 : r0;
}

/** `planRoute` gövdesi; `shut`: geçici kapalı karolar ("i,j"; HQA-FIX).*/
function planRouteIn(built: Pick<Built, "width" | "depth" | "blocked">, from: Vec2 & { y?: number }, target: Tile, climb: boolean, shut: ReadonlySet<string> | null): Route | null {
  const nav = navGrid(built);
  let start = tileAt(from.x, from.z);
  // WALK-PHYS: avatar ya da hedef bir engelin/alanın üstündeyse basamak sınırlı BFS
  if (climb) {
    const hc = heightCtx(nav);
    if (hc && needsClimbRoute(nav, hc, start, target, from.y ?? 0)) return planRouteClimb(nav, hc, start, target, from.y ?? 0, shut);
  }
  // EXP: çevrede (avatar ya da hedef ızgara dışında) birleşik ızgarada rota
  if (nav.outer?.parcels.size && (!inside(nav, start[0], start[1]) || !inside(nav, target[0], target[1]))) return planRouteOuter(nav, start, target, shut);
  if (!walkable(nav, start[0], start[1])) {
    const s = nearestWalkable(nav, start, 2);
    if (!s) return null;
    start = s;
  }
  const goal = nearestReachable(nav, start, target);
  if (!goal) return null;
  const exact = goal[0] === target[0] && goal[1] === target[1];
  if (goal[0] === start[0] && goal[1] === start[1]) return { goal, path: [goal], exact };
  // PHYS: önce ince ızgara (eşyaların etrafından), olmazsa kaba ızgara
  const fine = fineWorld(nav);
  const close = (src: { width: number; depth: number; blocked: Set<string> }) => (shut ? { width: src.width, depth: src.depth, blocked: new Set([...src.blocked, ...shut]) } : src);
  const path = (fine ? findPath(start, goal, close(fine.nav)) : null) ?? findPath(start, goal, close(built as { width: number; depth: number; blocked: Set<string> }));
  if (!path) return null;
  return { goal, path, exact };
}

/** şehir haritasında tıkla-git rotasının giremeyeceği çevre karoları (kilitli semt; CityRig bağlar, söker). Kilitli
 * semte yürüyerek girilmez (CityRig `onTile` avatarı son açık karoya geri koyar): rota oradan geçerse avatar sınırda geri konuyor, yeniden
 * yürüyüş aynı rotayı kuruyor ve "ulaşılamadı" deniyordu (İstanbul ilk girişte Eminönü: Haliç'ten kısa yol).*/
export const routeClosed: { fn: ((i: number, j: number) => boolean) | null } = { fn: null };

/**
 * EXP (E1b) — tıkla-git birleşimi: dünya ızgarası ∪ yüklü yakın çevre parselleri penceresinde BFS (≤ ~110 × 110 karo). Izgara
 * içinde ince ızgara (eşyalar kapalı) kullanılır, böylece rota eşyaların etrafından geçer; hedef ulaşılamazsa en yakın
 * ulaşılabilir karo (`exact: false`). Komşu sırası ve eşitlik kuralı `nearestReachable` ile aynı (belirlenimci).
 */
function planRouteOuter(nav: NavGrid, start: Tile, target: Tile, shut: ReadonlySet<string> | null = null): Route | null {
  const og = nav.outer!;
  let i0 = 0, j0 = 0, i1 = nav.width, j1 = nav.depth;
  for (const p of og.parcels.values()) {
    const a = p.cx * og.pw + og.oi, b = p.cz * og.pd + og.oj;
    i0 = Math.min(i0, a); j0 = Math.min(j0, b); i1 = Math.max(i1, a + og.pw); j1 = Math.max(j1, b + og.pd);
  }
  const w = i1 - i0, d = j1 - j0, n = w * d;
  const fine = fineWorld(nav);
  const open = (i: number, j: number) => {
    if (i < i0 || j < j0 || i >= i1 || j >= j1 || !passable(nav, i, j) || shut?.has(`${i},${j}`)) return false;
    if (routeClosed.fn && !inside(nav, i, j) && routeClosed.fn(i, j)) return false;
    return !fine || !inside(nav, i, j) || !fine.closed[j * nav.width + i] || (i === target[0] && j === target[1]);
  };
  if (!open(start[0], start[1])) {
    let best: Tile | null = null, bd = Infinity;
    for (let j = start[1] - 2; j <= start[1] + 2; j++) for (let i = start[0] - 2; i <= start[0] + 2; i++) {
      if (!open(i, j)) continue;
      const dd = (i - start[0]) ** 2 + (j - start[1]) ** 2;
      if (dd < bd) { bd = dd; best = [i, j]; }
    }
    if (!best) return null;
    start = best;
  }
  const prev = new Int32Array(n).fill(-2), queue = new Int32Array(n);
  const s = (start[1] - j0) * w + (start[0] - i0);
  let h = 0, t = 0, best = s, bd = Infinity;
  queue[t++] = s; prev[s] = -1;
  while (h < t) {
    const cur = queue[h++];
    const ci = (cur % w) + i0, cj = Math.floor(cur / w) + j0;
    const dd = (ci - target[0]) ** 2 + (cj - target[1]) ** 2;
    if (dd < bd || (dd === bd && cur < best)) { bd = dd; best = cur; if (dd === 0) break; }
    for (let k = 0; k < 4; k++) {
      const ni = ci + (k === 0 ? 1 : k === 1 ? -1 : 0), nj = cj + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (!open(ni, nj)) continue;
      const nk = (nj - j0) * w + (ni - i0);
      if (prev[nk] !== -2) continue;
      prev[nk] = cur; queue[t++] = nk;
    }
  }
  const goal: Tile = [(best % w) + i0, Math.floor(best / w) + j0];
  const path: Tile[] = [];
  for (let k = best; k >= 0; k = prev[k]) path.push([(k % w) + i0, Math.floor(k / w) + j0]);
  path.reverse();
  return { goal, path, exact: goal[0] === target[0] && goal[1] === target[1] };
}

/** WALK-PHYS: rota basamak kuralına ihtiyaç duyuyor mu (başlangıç ya da hedef 2B yürünebilir değil ama durulabilir; ek alan). */
function needsClimbRoute(nav: NavGrid, hc: HeightCtx, start: Tile, target: Tile, y: number): boolean {
  if (walkAreas().length) return true;
  if (!walkable(nav, start[0], start[1]) && inside(nav, start[0], start[1]) && standY(hc, start[0], start[1], y) !== -Infinity) return true;
  return inside(nav, target[0], target[1]) && !walkable(nav, target[0], target[1]) && hc.hf.climb[target[1] * nav.width + target[0]] === 1;
}

/**
 * WALK-PHYS — basamak sınırlı tıkla-git: karo karo BFS; komşuya geçiş yalnız `standY(komşu, bu yüzey) ≠ −∞` iken (yürünebilir
 * karo her zaman, tırmanılabilir engel/eşya üst yüzü ≤ yüzey + STEP_H, ek alan zemini aynı kural). Zıplama gerektiren engel
 * rotaya girmez; hedef ulaşılamazsa en yakın ulaşılabilir karo (`exact: false`). Pencere: dünya ızgarası ∪ kayıtlı alanlar.
 * Komşu sırası ve eşitlik kuralı `nearestReachable` ile aynı (belirlenimci).
 */
export function planRouteClimb(nav: NavGrid, hc: HeightCtx, start: Tile, target: Tile, y = 0, shut: ReadonlySet<string> | null = null): Route | null {
  let i0 = 0, j0 = 0, i1 = nav.width, j1 = nav.depth;
  for (const a of walkAreas()) { i0 = Math.min(i0, a.i0); j0 = Math.min(j0, a.j0); i1 = Math.max(i1, a.i0 + a.w); j1 = Math.max(j1, a.j0 + a.d); }
  const w = i1 - i0, d = j1 - j0, n = w * d;
  const fine = fineWorld(nav);
  const surf = new Float32Array(n);
  const enter = (i: number, j: number, from: number): number => {
    if (i < i0 || j < j0 || i >= i1 || j >= j1 || shut?.has(`${i},${j}`)) return -Infinity;
    const s0 = standY(hc, i, j, from);
    if (s0 === -Infinity || !fine || !inside(nav, i, j)) return s0;
    const k = j * nav.width + i;
    if (hc.blocked[k] || !fine.closed[k]) return s0;
    if (propClimbable(hc.hf, k, from)) return Math.max(s0, hc.hf.top[k]);
    return i === target[0] && j === target[1] ? s0 : -Infinity;
  };
  const sk = (start[1] - j0) * w + (start[0] - i0);
  if (start[0] < i0 || start[1] < j0 || start[0] >= i1 || start[1] >= j1) return null;
  const prev = new Int32Array(n).fill(-2), queue = new Int32Array(n);
  let h = 0, t = 0, best = sk, bd = Infinity;
  queue[t++] = sk; prev[sk] = -1; surf[sk] = y;
  while (h < t) {
    const cur = queue[h++];
    const ci = (cur % w) + i0, cj = Math.floor(cur / w) + j0;
    const dd = (ci - target[0]) ** 2 + (cj - target[1]) ** 2;
    if (dd < bd || (dd === bd && cur < best)) { bd = dd; best = cur; if (dd === 0) break; }
    for (let k = 0; k < 4; k++) {
      const ni = ci + (k === 0 ? 1 : k === 1 ? -1 : 0), nj = cj + (k === 2 ? 1 : k === 3 ? -1 : 0);
      const nk = (nj - j0) * w + (ni - i0);
      if (ni < i0 || nj < j0 || ni >= i1 || nj >= j1 || prev[nk] !== -2) continue;
      const sy = enter(ni, nj, surf[cur]);
      if (sy === -Infinity) continue;
      prev[nk] = cur; surf[nk] = sy; queue[t++] = nk;
    }
  }
  const goal: Tile = [(best % w) + i0, Math.floor(best / w) + j0];
  const path: Tile[] = [];
  for (let k = best; k >= 0; k = prev[k]) path.push([(k % w) + i0, Math.floor(k / w) + j0]);
  path.reverse();
  return { goal, path, exact: goal[0] === target[0] && goal[1] === target[1] };
}

/** Basamak eşiği (dışa aktarım: testler, HUD ipucu) */
export { STEP_H };

/** Avatara yolu yükler (bir sonraki `stepAvatar` izlemeye başlar). */
export function setRoute(state: AvatarState, route: Route | null): AvatarState {
  state.route = route ? route.path.slice() : null;
  state.routeIdx = 0;
  state.rStall = 0; state.rSide = 0; // HQA-FIX
  return state;
}

// ------------------------------------------------------------------------------------------ örtü ızgarası ve yükseklik haritası
export interface CoverGrid {
  width: number;
  depth: number;
  /** karo başına kafa yüksekliğinin üstündeki en alçak örtü bloğunun tabanı (yoksa +Infinity) */
  roofY: Float32Array;
  /** karo başına zemin katı bloklarının (taban < HEAD_Y) en yüksek tepesi; 0 = açık zemin */
  height: Float32Array;
  /** örtülü karo sayısı (ölçüm/denetim) */
  covered: number;
  /** W5: karo başına gövde bandının üstündeki (taban ≥ `CEIL_MIN_Y`) en alçak blok tabanı; yoksa +Infinity.
   * Birinci şahıs gözü bunun altında tutulur (alçak kemer, tabela, raf: göz bloğun içinde kalmaz).*/
  ceilY?: Float32Array;
}

/** W5: bu tabanın altındaki bloklar gövde bandındadır (çarpışma onları kapatır); üstündekiler "tavan" sayılır.*/
export const CEIL_MIN_Y = 0.95;
/** Göz ile tavan arasında bırakılan pay (yakın düzlem 0,12 ile duvarın içi görünmesin). */
export const CEIL_GAP = 0.06;
/** Birinci şahıs göz yüksekliği: istenen `eye`, karonun tavanının `CEIL_GAP` altında kırpılır (en az 0,45). */
export function eyeUnderCeiling(cover: CoverGrid, x: number, z: number, eye: number): number {
  if (!cover.ceilY) return eye;
  const [i, j] = tileAt(x, z);
  if (i < 0 || j < 0 || i >= cover.width || j >= cover.depth) return eye;
  const c = cover.ceilY[j * cover.width + i];
  return c === Infinity ? eye : Math.max(0.45, Math.min(eye, c - CEIL_GAP));
}

const COVER_GROUPS = new Set(["solid", "glass", "glow"]);
const coverCache = new WeakMap<object, CoverGrid>();

/**
 * Bloklardan bir kez (WeakMap) hesaplanır (§3.5): karo merkezi bloğun xz izdüşümü içindeyse o karoya yazılır. Yalnızca
 * sahne ızgara blokları (`blocks`); ufuk (`backdrop`), bulut ve fx hariç. Kesit (`cover.ts`) ve kamera çarpışması okur.
 */
export function coverGrid(built: Pick<Built, "width" | "depth" | "blocks">): CoverGrid {
  let c = coverCache.get(built);
  if (c) return c;
  const { width, depth } = built;
  const roofY = new Float32Array(width * depth).fill(Infinity);
  const height = new Float32Array(width * depth);
  const ceilY = new Float32Array(width * depth).fill(Infinity);
  for (const b of built.blocks) {
    if (!COVER_GROUPS.has(b.g)) continue;
    const bottom = b.p[1] - b.s[1] / 2, top = b.p[1] + b.s[1] / 2;
    // INTERIOR-CAM: iç mekân tavanı (kat yüksekliği 1,6 < HEAD_Y) duvar bandı değil örtüdür — karolar engel sayılmaz, kamera altında kalır
    const isRoof = b.ceil === 1 || (bottom >= HEAD_Y && bottom <= COVER_MAX_Y);
    const isWall = !isRoof && bottom < HEAD_Y;
    const isCeil = bottom >= CEIL_MIN_Y && bottom < HEAD_Y;
    if (!isRoof && !isWall) continue;
    // karo merkezleri bloğun içinde: tx(i) ∈ [x0, x1] → i ∈ [ceil(x0 + HW − 0,5), floor(x1 + HW − 0,5)]
    const i0 = Math.max(0, Math.ceil(b.p[0] - b.s[0] / 2 + HW - 0.5 - 1e-6)), i1 = Math.min(width - 1, Math.floor(b.p[0] + b.s[0] / 2 + HW - 0.5 + 1e-6));
    const j0 = Math.max(0, Math.ceil(b.p[2] - b.s[2] / 2 + HD - 0.5 - 1e-6)), j1 = Math.min(depth - 1, Math.floor(b.p[2] + b.s[2] / 2 + HD - 0.5 + 1e-6));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * width + i;
      if (isRoof) { if (bottom < roofY[k]) roofY[k] = bottom; }
      else if (top > height[k]) height[k] = top;
      if (isCeil && bottom < ceilY[k]) ceilY[k] = bottom;
    }
  }
  let covered = 0;
  for (let k = 0; k < roofY.length; k++) if (roofY[k] !== Infinity) covered++;
  c = { width, depth, roofY, height, covered, ceilY };
  coverCache.set(built, c);
  return c;
}

/** Karonun çatı tabanı (örtüsüzse Infinity; ızgara dışı Infinity). */
export function roofAt(cover: CoverGrid, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= cover.width || j >= cover.depth) return Infinity;
  return cover.roofY[j * cover.width + i];
}

export function heightAt(cover: CoverGrid, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= cover.width || j >= cover.depth) return 0;
  return cover.height[j * cover.width + i];
}

/**
 * Izgarada ışın yürütme (three.js raycast değil, §3.5.5): `from` (avatar göğsü) → `to` (kamera) doğrusu üzerindeki ilk engelin
 * `from`'a uzaklığı oranı (0–1); engel yoksa 1. Engel: zemin katı bloğu doğrunun o noktadaki yüksekliğinden yüksekse ya da
 * çatı tabanı doğrunun altında kalıyorsa.
 */
export function occlusion(cover: CoverGrid, from: [number, number, number], to: [number, number, number], step = 0.25): number {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(len / step));
  const ft = tileAt(from[0], from[2]);
  for (let s = 1; s <= n; s++) {
    const t = s / n;
    const x = from[0] + dx * t, y = from[1] + dy * t, z = from[2] + dz * t;
    const i = tileIndexX(x), j = tileIndexZ(z);
    if (i === ft[0] && j === ft[1]) continue;
    if (heightAt(cover, i, j) > y || roofAt(cover, i, j) < y) return Math.max(0, (s - 1) / n);
  }
  return 1;
}

// ------------------------------------------------------------------------------------------ yakınlık indeksi
export type ProxKind = "agent" | "animal" | "prop" | "board" | "landmark" | "souvenir";
/** eşit mesafede sıra: ajan önce (ana etkileşim), sonra pano, nesne, hayvan, simge, hatıra */
export const KIND_RANK: Record<ProxKind, number> = { agent: 0, board: 1, prop: 2, animal: 3, landmark: 4, souvenir: 5 };

export interface ProxEntity { id: string; kind: ProxKind; x: number; z: number; /** UXF-B: yarıçap dışında da listelenir (şehir kapısı)*/ far?: boolean }
export type Bearing = "front" | "right" | "back" | "left";
export interface NearbyItem {
  id: string;
  kind: ProxKind;
  /** öklid mesafe (birim) */
  dist: number;
  /** yaklaşık adım (karo) sayısı: ekran okuyucu metni "3 adım" */
  steps: number;
  /** avatarın bakışına göre yön sözcüğü anahtarı (locales W3) */
  bearing: Bearing;
  /** W5: yürüyerek ulaşılabilir mi (adım alanı varsa); yoksa tanımsız*/
  reach?: boolean;
  x: number;
  z: number;
}

/** Avatarın bakışına (heading) göre hedefin yönü: ±45° ön, 45–135° sağ/sol, gerisi arka. */
export function bearingOf(heading: number, dx: number, dz: number): Bearing {
  const rel = wrapAngle(Math.atan2(dx, dz) - heading);
  const a = Math.abs(rel);
  if (a <= Math.PI / 4) return "front";
  if (a >= (3 * Math.PI) / 4) return "back";
  // DIR_ANGLE: heading 0 (+z) iken +x (π/2) karakterin solundadır (three.js sağ el; karakter +z'ye bakar, sağı −x)
  return rel > 0 ? "left" : "right";
}

/**
 * : Yakındakiler öncelik kancası — küçük katman önce; null ise
 * yalnız mesafe (eski davranış, testler). `components/world/walk/entities.ts` kurar (`selectLogic.nearbyTier`). `query` sınırı
 * önce önceliği korur (ritüel ve bilgi noktası önemsiz kopyalara yer kaybetmez; liste yine mesafe sırasında döner). Kanca varken
 * ham sınır 24'tür: HUD aynı adlı süsleri tek satıra katladığı için görünen satır sayısı kısa kalır, "Su" yine tek grup olarak
 * görünür (öncelikliler doldurunca dışarıda kalmaz). F hedefi
 * (`pickInteractTarget`, `pickLookTarget`) menzildekilerden önce en küçük katmanı seçer, katman içinde eski puan geçerlidir.
*/
export const nearbyPolicy: { rank: ((id: string, kind: ProxKind, dist?: number) => number) | null; limit: number; /** sabit hedef (durak, kapı, asansör, seyir noktası) mı*/ fixed?: ((id: string) => boolean) | null; /** sabit hedefin F menzili (varsayılandan büyükse)*/ reach?: ((id: string) => number) | null } = { rank: null, limit: 24, fixed: null, reach: null };
/**
 * sabit hedef önceliği. Kök neden: F hedefi katman + (mesafe + bakış) puanıyla seçiliyordu; durak ve ritüel/satıcı aynı katmanda (0),
 * durak varış karosunda 1,0–1,41 birim, yanındaki satıcı ritüeli 1,0 → satıcı kazanıyor, durak paneli açılmıyordu (Eminönü iskelesi: simit satıcısı).
 * Kapı/asansör (katman 1–2) ise her yakın ritüelin altında kalıyordu. Şimdi menzildeki sabit hedef, oyuncu ona `FIXED_STAND` içindeyse (durak/kapı/asansör varış karosu 1,0–1,41) ya da ona
 * bakıyorsa (≤ `FIXED_CLAIM_OFF`) sahiplenir. Yakındaysa (`FIXED_STAND`) bakış ne olursa olsun kazanır; uzaktaysa sabit olmayan hedef
 * ancak çok daha net bakılıyorsa (`FIXED_YIELD`) öne geçer — yani figürana/satıcıya yalnız durak/kapının yanında DEĞİLKEN dönüp bakarak ulaşılır.
*/
export const FIXED_STAND = 1.5;
export const FIXED_CLAIM_OFF = 0.9;
export const FIXED_YIELD = 0.25;
/** sabit olmayan hedefin (ritüel karosu) üstünde duran oyuncu için F onu seçer; sabit hedef (durak) ancak daha yakınsa sahiplenir.*/
export const STAND_ON = 0.7;
/** ritüel konumu durağa en çok bu kadar uzaksa (RITUAL-STOP-TILE-001: durak–ritüel aralığı 2) ritüel karosundaki F ritüeli seçer; daha uzak duraklar (varış karosu 2,83) sırasında kalır.*/
export const RITUAL_GAP_MAX = 2.2;
/** Yakındakiler ham sınırı: öncelik kancası varken (HUD aynı adlı süsleri tek satıra katlar) `nearbyPolicy.limit`, yoksa 12. */
const nearbyLimit = () => (nearbyPolicy.rank ? nearbyPolicy.limit : 12);

const byNear = (a: NearbyItem, b: NearbyItem) =>
  a.dist - b.dist || KIND_RANK[a.kind] - KIND_RANK[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Hücre ızgaralı (4 birim) yakınlık indeksi (§9): `rebuild` seyrek (konumlar değişince), `query` her karede O(yakın). */
export class ProximityIndex {
  private cells = new Map<number, ProxEntity[]>();
  /** UXF-B: yarıçaptan bağımsız girdiler (`far`) */
  private far: ProxEntity[] = [];
  private readonly cell: number;
  constructor(cell = 4) { this.cell = cell; }
  private keyOf(cx: number, cz: number) { return (cx + 4096) * 8192 + (cz + 4096); }
  rebuild(list: readonly ProxEntity[]): this {
    this.cells.clear();
    this.far.length = 0;
    for (const e of list) {
      if (e.far) { this.far.push(e); continue; }
      const k = this.keyOf(Math.floor(e.x / this.cell), Math.floor(e.z / this.cell));
      const arr = this.cells.get(k);
      if (arr) arr.push(e); else this.cells.set(k, [e]);
    }
    return this;
  }
  /** `radius` içindekiler, mesafe → tür → kimlik sırasıyla (kararlı); `limit` en çok kaç öğe. */
  query(x: number, z: number, heading: number, radius = NEARBY_RADIUS, limit = nearbyLimit()): NearbyItem[] {
    const out: NearbyItem[] = [];
    const c0x = Math.floor((x - radius) / this.cell), c1x = Math.floor((x + radius) / this.cell);
    const c0z = Math.floor((z - radius) / this.cell), c1z = Math.floor((z + radius) / this.cell);
    const r2 = radius * radius;
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const arr = this.cells.get(this.keyOf(cx, cz));
      if (!arr) continue;
      for (const e of arr) {
        const dx = e.x - x, dz = e.z - z, d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        const dist = Math.sqrt(d2);
        out.push({ id: e.id, kind: e.kind, dist, steps: Math.max(1, Math.round(dist)), bearing: bearingOf(heading, dx, dz), x: e.x, z: e.z });
      }
    }
    // UXF-B: uzak girdi (şehir kapısı) her zaman listede; mesafe sırasında yerini alır
    for (const e of this.far) {
      const dx = e.x - x, dz = e.z - z, dist = Math.hypot(dx, dz);
      out.push({ id: e.id, kind: e.kind, dist, steps: Math.max(1, Math.round(dist)), bearing: bearingOf(heading, dx, dz), x: e.x, z: e.z });
    }
    out.sort(byNear);
    if (out.length > limit) {
      const rank = nearbyPolicy.rank;
      if (rank) {
        // en iyi `limit` öğe (katman, sonra mesafe sırası) kalır; dönen liste mesafe sırasını korur
        const order = out.map((it, k) => ({ k, r: rank(it.id, it.kind) })).sort((a, b) => a.r - b.r || a.k - b.k);
        const keep = new Uint8Array(out.length);
        for (let n = 0; n < limit; n++) keep[order[n].k] = 1;
        let w = 0;
        for (let k = 0; k < out.length; k++) if (keep[k]) out[w++] = out[k];
      }
      out.length = limit;
    }
    return out;
  }
}

/** W5: yol adımı alanının üst sınırı (karo); daha uzaktaki hedef "uzak" sayılır.*/
export const STEP_FIELD_MAX = 96;
let fieldBuf: { n: number; dist: Int16Array; queue: Int32Array } | null = null;

/**
 * W5: avatarın karosundan ızgara üzerinde 4 komşulu BFS adım alanı (en çok `max` adım). Yakındakiler'deki "N adım"
 * öklid değil, yürünecek yoldur: okul 2 değil 24, duvarın ya da suyun öbür yanındaki hedef "ulaşılamaz". Avatar ızgara
 * dışındaysa (çevre) ya da karosu engelliyse null (öklid yedeği). 4 Hz çağrılır; ara bellek yeniden kullanılır.
*/
export function stepField(nav: NavGrid, x: number, z: number, max = STEP_FIELD_MAX): Int16Array | null {
  const [si, sj] = tileAt(x, z);
  if (!walkable(nav, si, sj)) return null;
  const n = nav.width * nav.depth;
  if (!fieldBuf || fieldBuf.n !== n) fieldBuf = { n, dist: new Int16Array(n), queue: new Int32Array(n) };
  const { dist, queue } = fieldBuf;
  dist.fill(-1);
  let h = 0, t = 0;
  const s = sj * nav.width + si;
  dist[s] = 0; queue[t++] = s;
  while (h < t) {
    const cur = queue[h++];
    const d = dist[cur];
    if (d >= max) continue;
    const ci = cur % nav.width, cj = (cur - ci) / nav.width;
    for (let k = 0; k < 4; k++) {
      const ni = ci + (k === 0 ? 1 : k === 1 ? -1 : 0), nj = cj + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (!walkable(nav, ni, nj)) continue;
      const nk = nj * nav.width + ni;
      if (dist[nk] >= 0) continue;
      dist[nk] = d + 1; queue[t++] = nk;
    }
  }
  return dist;
}

/** Hedefe yürüme adımı: karosu yürünebilirse alan değeri, değilse (ajan masada, nesne engelli karoda) en yakın komşu + 1.
 *  Ulaşılamazsa −1. */
export function stepsTo(nav: NavGrid, field: Int16Array, x: number, z: number): number {
  const [i, j] = tileAt(x, z);
  if (inside(nav, i, j) && field[j * nav.width + i] >= 0) return field[j * nav.width + i];
  let best = -1;
  for (let k = 0; k < 8; k++) {
    const ni = i + [1, -1, 0, 0, 1, 1, -1, -1][k], nj = j + [0, 0, 1, -1, 1, -1, 1, -1][k];
    if (!inside(nav, ni, nj)) continue;
    const d = field[nj * nav.width + ni];
    if (d >= 0 && (best < 0 || d + 1 < best)) best = d + 1;
  }
  return best;
}

/** Yakındakiler erişim yarıçapı: "git ve aç" rota ucundan bu kadar uzaktaki hedefi açar (selectLogic `END_REACH_MAX` ile aynı). */
export const REACH_AROUND = 5.2;
/**
 * katı gövdeli hedefin (salon, seki, kule, köprü ayağı) adımı. Hedef karosu ve 8 komşusu yürünmez olsa da gövde
 * içinden (yürünmez karolar boyunca, `r` yarıçapında) ulaşılan yürünür kenar karosu varsa hedef ulaşılabilirdir: "git" o kenara
 * yürür ve açar. Yürünür ama alana bağlı olmayan karo (kapalı avlu, duvar ardı) ulaşılamaz kalır.
*/
export function stepsNear(nav: NavGrid, field: Int16Array, x: number, z: number, r = REACH_AROUND): number {
  const st = stepsTo(nav, field, x, z);
  if (st >= 0) return st;
  const [i0, j0] = tileAt(x, z);
  if (walkable(nav, i0, j0)) return -1;
  const seen = new Set<number>([j0 * 4096 + i0]), q: [number, number, number][] = [[i0, j0, 0]];
  let best = -1;
  for (let h = 0; h < q.length; h++) {
    const [ci, cj, d] = q[h];
    for (let k = 0; k < 4; k++) {
      const ni = ci + (k === 0 ? 1 : k === 1 ? -1 : 0), nj = cj + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if ((ni - i0) ** 2 + (nj - j0) ** 2 > r * r || seen.has(nj * 4096 + ni)) continue;
      seen.add(nj * 4096 + ni);
      if (walkable(nav, ni, nj)) { const f = field[nj * nav.width + ni]; if (f >= 0 && (best < 0 || f + d + 1 < best)) best = f + d + 1; }
      else q.push([ni, nj, d + 1]);
    }
  }
  return best;
}

/**
 * W5: Yakındakiler öğelerinin `steps`'ini yol uzunluğuyla değiştirir (yerinde); ulaşılamayan öğe `reach: false`
 * alır ve adımı öklid kalır. Alan yoksa (çevre) dokunmaz. Sıra mesafeye göre kalır (görüş yakınlığı).
*/
export function applyPathSteps(nav: NavGrid, items: NearbyItem[], x: number, z: number): NearbyItem[] {
  const field = items.length ? stepField(nav, x, z) : null;
  if (!field) return items;
  for (const it of items) {
    // UXF-E: ızgara dışındaki hedef (şehir haritasında semt durağı: varış meydanı ızgarasının dışındaki parsel) için yol
    // alanı yoktur: "ulaşılamaz" denmez, öklid adımı ve bilinmeyen erişim kalır (tıkla-git birleşik ızgarada planlar)
    if (!inside(nav, tileAt(it.x, it.z)[0], tileAt(it.x, it.z)[1])) continue;
    const st = stepsNear(nav, field, it.x, it.z);
    if (st >= 0) { it.steps = Math.max(1, st); it.reach = true; }
    else it.reach = false;
  }
  return items;
}

/** Tek seferlik sorgu (indeks kurmadan); test ve az öğeli durumlar için. */
export function nearby(list: readonly ProxEntity[], x: number, z: number, heading: number, radius = NEARBY_RADIUS, limit = nearbyLimit()): NearbyItem[] {
  return new ProximityIndex().rebuild(list).query(x, z, heading, radius, limit);
}

/**
 * Etkileşim hedefi (F): `range` içindekilerden en yakın ve bakışa en yakın olan (§5). Puan = mesafe + 0,6 × |açı farkı| / π;
 * eşitlikte `byNear` sırası. Arkadaki hedef de seçilebilir (yalnızca daha pahalı).
 */
export function pickInteractTarget(items: readonly NearbyItem[], x: number, z: number, heading: number, range = INTERACT_RANGE): NearbyItem | null {
  const rank = nearbyPolicy.rank, fixed = nearbyPolicy.fixed, reach = nearbyPolicy.reach;
  let best: NearbyItem | null = null, bs = Infinity, bt = Infinity, bo = 0;
  let fb: NearbyItem | null = null, fs = Infinity, ft = Infinity, fo = 0; // sahiplenen sabit hedef
  for (const it of items) {
    if (it.dist > range && !(reach && it.dist <= reach(it.id))) continue; // uzak varış karoları (<city> Hamamatsuchō 2,83)
    const off = Math.abs(wrapAngle(Math.atan2(it.x - x, it.z - z) - heading));
    const s = it.dist + (0.6 * off) / Math.PI;
    const tier = rank ? rank(it.id, it.kind, it.dist) : 0; // PORTAL-INTENT-001: geçit yalnız dibindeyken öne geçer
    if (fixed && (off <= FIXED_CLAIM_OFF || it.dist <= Math.max(FIXED_STAND, reach?.(it.id) ?? 0)) && fixed(it.id) && (tier < ft || (tier === ft && (s < fs - 1e-9 || (Math.abs(s - fs) <= 1e-9 && fb && byNear(it, fb) < 0))))) { ft = tier; fs = s; fb = it; fo = off; }
    // önce öncelik katmanı (ritüel, bilgi, simge önce; en yakın süs değil)
    if (tier > bt) continue;
    if (tier < bt || s < bs - 1e-9 || (Math.abs(s - bs) <= 1e-9 && best && byNear(it, best) < 0)) { bt = tier; bs = s; best = it; bo = off; }
  }
  return fb && best && !fixed!(best.id) && !(best.dist <= STAND_ON && fb.dist > FIXED_STAND && fb.dist <= RITUAL_GAP_MAX && best.id.startsWith("hot:rt:")) && (fb.dist <= FIXED_STAND || bo + FIXED_YIELD > fo) ? fb : best; // ritüel karosunda duran ritüeli seçer
}

/** W5: birinci şahısta etkileşim menzili ve bakış konisi (yarım açı, rad). */
export const LOOK_RANGE = 2.6;
export const LOOK_CONE = 0.62;

/**
 * W5 — birinci şahısta etkileşim hedefi: yalnızca **bakılan** yön (§4.1 "F: bakış yönündeki hedef"). `range` içinde ve bakış
 * konisinde (|açı farkı| ≤ `cone`) olanlardan açı farkı en küçük olan; açı eşitse yakın olan. Konide hedef yoksa null
 * (arkadaki ya da yandaki hedef F ile açılmaz; Yakındakiler listesi ve Tab her zaman çalışır).
 */
export function pickLookTarget(items: readonly NearbyItem[], x: number, z: number, heading: number, range = LOOK_RANGE, cone = LOOK_CONE): NearbyItem | null {
  const rank = nearbyPolicy.rank, fixed = nearbyPolicy.fixed, reach = nearbyPolicy.reach;
  let best: NearbyItem | null = null, bs = Infinity, bt = Infinity, bo = 0;
  let fb: NearbyItem | null = null, fs = Infinity, ft = Infinity, fo = 0; // sahiplenen sabit hedef
  for (const it of items) {
    if (it.dist > range && !(reach && it.dist <= reach(it.id))) continue; // uzak varış karoları (<city> Hamamatsuchō 2,83)
    const off = Math.abs(wrapAngle(Math.atan2(it.x - x, it.z - z) - heading));
    if (off > cone && it.dist > 0.35) continue;
    // konidekilerden önce öncelik katmanı
    const tier = rank ? rank(it.id, it.kind, it.dist) : 0; // PORTAL-INTENT-001: geçit yalnız dibindeyken öne geçer
    const s = off * 2 + it.dist * 0.25;
    if (fixed && (off <= FIXED_CLAIM_OFF || it.dist <= Math.max(FIXED_STAND, reach?.(it.id) ?? 0)) && fixed(it.id) && (tier < ft || (tier === ft && (s < fs - 1e-9 || (Math.abs(s - fs) <= 1e-9 && fb && byNear(it, fb) < 0))))) { ft = tier; fs = s; fb = it; fo = off; }
    if (tier > bt) continue;
    if (tier < bt || s < bs - 1e-9 || (Math.abs(s - bs) <= 1e-9 && best && byNear(it, best) < 0)) { bt = tier; bs = s; best = it; bo = off; }
  }
  return fb && best && !fixed!(best.id) && !(best.dist <= STAND_ON && fb.dist > FIXED_STAND && fb.dist <= RITUAL_GAP_MAX && best.id.startsWith("hot:rt:")) && (fb.dist <= FIXED_STAND || bo + FIXED_YIELD > fo) ? fb : best; // ritüel karosunda duran ritüeli seçer
}

/** İki yakınlık listesi aynı mı (kimlik, tür, adım, yön): store yalnızca değişince yeni dizi yazar. */
export function sameNearby(a: readonly NearbyItem[], b: readonly NearbyItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) {
    const p = a[k], q = b[k];
    if (p.id !== q.id || p.kind !== q.kind || p.steps !== q.steps || p.bearing !== q.bearing || p.reach !== q.reach) return false;
  }
  return true;
}

// ------------------------------------------------------------------------------------------ doğma, pano, hatıra
/** Taban sahnenin büyümüş dünyadaki kayması (halka büyümede taban ortaya kayar; `modules[0]` tabandır). */
export function baseOffset(built: Pick<Built, "modules">): Tile {
  const m = built.modules?.[0];
  return m && m.base ? [m.i0, m.j0] : [0, 0];
}

type SpawnSource = Pick<Built, "width" | "depth" | "blocked" | "stations" | "rest" | "modules">;

/** Ajanların çapa karoları (istasyon): avatar burada doğmaz, hatıra konmaz. */
function stationKeys(built: Pick<Built, "stations">): Set<string> {
  return new Set(built.stations.map((s) => `${s.tile[0]},${s.tile[1]}`));
}

export interface SpawnResult { tile: Tile; source: "saved" | "core" | "rest" | "center" }

/**
 * Doğma karosu (§3.2): kayıtlı konum (taban göreli x/z; `baseOffset` eklenir —) hâlâ yürünebilir ve ana bileşendeyse orası (değilse en yakın uygun karo); kayıt yoksa
 * çekirdekli sahnede simge çekirdeğinin önündeki meydan (çekirdeğin +z kenarı ortası); yoksa `rest[0]`; o da yoksa taban
 * merkezi. Aday her zaman ana bileşende, istasyon dışı en yakın yürünebilir karoya düzeltilir.
*/
export function spawnTile(built: SpawnSource, opts: { core?: SceneCore | null; saved?: Vec2 | null } = {}): SpawnResult | null {
  const nav = navGrid(built);
  const { labels, main } = components(built);
  const st = stationKeys(built);
  // W5: doğma karosu süs eşyası (ince çarpıştırıcı) olamaz (PHYS-REACH-001; şehir meydanında bank, saksı)
  const fine = fineWorld(nav);
  const ok = (i: number, j: number) => labels[j * nav.width + i] === main && !st.has(`${i},${j}`)
    && (!fine || fine.kind[j * fine.width + i] !== PROP);
  const [oi, oj] = baseOffset(built);
  // taban modülünün gerçek boyutu (şehir tabanları 36×32 olabilir; yoksa 24×16)
  const bm = built.modules?.find((m) => m.base);
  const bw = bm?.w ?? W, bd = bm?.d ?? D;
  let want: Tile, source: SpawnResult["source"];
  // kayıtlı konum taban göreli (lib/walk.ts `savePosition`): bugünkü taban kaymasıyla dünyaya taşınır
  if (opts.saved) { want = tileAt(opts.saved.x + oi, opts.saved.z + oj); source = "saved"; }
  else if (opts.core && opts.core.w >= bw - 2 && opts.core.d >= bd - 2) {
    // W5: şehirlerde çekirdek bütün tabandır ("önü" dünyanın son sırası olur, kamera dünyanın dışında kalırdı);
    // simge merkezde durduğundan doğma merkezin önündeki meydana (taban derinliğinin ~%68'i) en yakın yürünebilir karodur
    want = [oi + Math.floor(bw / 2), oj + Math.min(bd - 2, Math.floor(bd * 0.68))];
    source = "core";
  } else if (opts.core) {
    want = [oi + opts.core.i0 + Math.floor(opts.core.w / 2), oj + Math.min(opts.core.j0 + opts.core.d, bd - 1)];
    source = "core";
  } else if (built.rest.length) { want = built.rest[0]; source = "rest"; }
  else { want = [oi + Math.floor(bw / 2), oj + Math.floor(bd / 2)]; source = "center"; }
  let tile = nearestWalkable(nav, want, Math.max(nav.width, nav.depth), ok);
  // UXF-E: doğma karosu üstü kapalı geçit/köprü altındaysa (<city>: ilk duyuru "İçeri girdin.") en çok `SPAWN_OPEN_RADIUS`
  // karo içindeki en yakın açık (çatısız) karoya alınır; yoksa olduğu gibi kalır. Kayıtlı konum (`saved`) dokunulmaz.
  if (tile && source !== "saved" && Array.isArray((built as Partial<Built>).blocks)) {
    const cg = coverGrid(built as unknown as Pick<Built, "width" | "depth" | "blocks">);
    const roofed = (i: number, j: number) => Number.isFinite(cg.roofY[j * cg.width + i]);
    if (roofed(tile[0], tile[1])) {
      let best: Tile | null = null, bd = Infinity;
      for (let dj = -SPAWN_OPEN_RADIUS; dj <= SPAWN_OPEN_RADIUS; dj++) for (let di = -SPAWN_OPEN_RADIUS; di <= SPAWN_OPEN_RADIUS; di++) {
        const i = tile[0] + di, j = tile[1] + dj;
        if (!inside(nav, i, j) || !walkable(nav, i, j) || !ok(i, j) || roofed(i, j)) continue;
        const d = di * di + dj * dj;
        if (d < bd || (d === bd && best && (j < best[1] || (j === best[1] && i < best[0])))) { bd = d; best = [i, j]; }
      }
      if (best) tile = best;
    }
  }
  return tile ? { tile, source } : null;
}
/** HQA-FIX: doğma / kayıtlı konum / şehirden dönüş karosu geçitlerden (şehir kapısı, iç mekân kapısı) en az bu kadar karo uzakta.*/
export const GATE_CLEAR = 3;
/** şehir geçidi halkasından doğma/dönüş uzaklığı (Chebyshev) — sırtı dönük avatarın takip kamerası (4,6) halkayı
 * arkasında bırakır; 3 karoda halka kamera ile avatarın arasında, ilk karenin önündeydi (Londra, <city>, <city>…).*/
export const PORTAL_CLEAR = 6;
/**
 * HQA-FIX — kök neden: kayıtlı konum geçidin dibinde kalabiliyordu (geçide yürürken / geçitten geçerken kaydedilen konum;
 * şehirden dönüş kapının 1 karo içine bırakıyordu); sonraki girişte avatar geçidin yanında ya da çerçevesinin içinde doğuyor, ilk F
 * oyuncuyu şehre atıyordu (<city>, Londra, Şanghay). `tile` her geçide (Chebyshev) `min` karodan yakınsa ana bileşende, istasyon ve süs
 * eşyası dışı en yakın uzak karo; yoksa `tile`.
*/
export function clearOfGates(built: SpawnSource, tile: Tile, gates: readonly Tile[], min = GATE_CLEAR): Tile {
  const far = (i: number, j: number) => gates.every((g) => Math.max(Math.abs(i - g[0]), Math.abs(j - g[1])) >= min);
  if (!gates.length || far(tile[0], tile[1])) return tile;
  const nav = navGrid(built);
  const { labels, main } = components(built);
  const st = stationKeys(built);
  const fine = fineWorld(nav);
  const ok = (i: number, j: number) => far(i, j) && labels[j * nav.width + i] === main && !st.has(`${i},${j}`) && (!fine || fine.kind[j * fine.width + i] !== PROP);
  return nearestWalkable(nav, tile, min * 4, ok) ?? tile;
}
/** `spawnTile`: üstü kapalı doğma karosu için açık karo arama yarıçapı (karo). */
export const SPAWN_OPEN_RADIUS = 4;

export interface BoardSpot { tile: Tile; source: "board" | "coffee" | "rest" | "spawn"; at: [number, number] }

/**
 * Çıktı panosu ya da eşdeğeri (§5.2): taban sahnenin ilk duvar panosu (`board` işareti; önündeki karo), yoksa ilk kahve
 * makinesinin ön karosu, yoksa `rest[0]`, yoksa doğma karosu. `tile`: avatarın durup etkileşeceği, ana bileşende yürünebilir karo
 * (işarete ≤ 3 karo). Bulunamazsa null (walk_check hata sayar).
 */
export function boardSpot(built: SpawnSource & Pick<Built, "props">, core?: SceneCore | null): BoardSpot | null {
  const nav = navGrid(built);
  const { labels, main } = components(built);
  const st = stationKeys(built);
  const ok = (i: number, j: number) => labels[j * nav.width + i] === main && !st.has(`${i},${j}`);
  const near = (t: Tile) => nearestWalkable(nav, t, 3, ok);
  const props = built.props ?? [];
  const board = props.find((p) => p.k === "board");
  if (board) {
    // pano duvarın +z yüzünde (r = 0): işaretin hemen önündeki karo
    const t = near(tileAt(board.p[0], board.p[2] + 0.3));
    if (t) return { tile: t, source: "board", at: [board.p[0], board.p[2]] };
  }
  const coffee = props.find((p) => p.k === "coffee" && p.tile);
  if (coffee?.tile) {
    const t = near(coffee.tile);
    if (t) return { tile: t, source: "coffee", at: [coffee.p[0], coffee.p[2]] };
  }
  if (built.rest.length) {
    const t = near(built.rest[0]);
    if (t) return { tile: t, source: "rest", at: [tx(built.rest[0][0]), tz(built.rest[0][1])] };
  }
  const sp = spawnTile(built, { core });
  return sp ? { tile: sp.tile, source: "spawn", at: [tx(sp.tile[0]), tz(sp.tile[1])] } : null;
}

/** Sahne kimliğinden belirlenimci tohum (FNV-1a). */
export function sceneSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < id.length; k++) { h ^= id.charCodeAt(k); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Çapa ve kanca karoları: istasyon, araç/uyku noktaları, dinlenme, kahve ön karosu, ortam kancaları. Hatıra buralara konmaz. */
export function reservedTiles(built: Pick<Built, "stations" | "spots" | "rest" | "props" | "ambient">): Set<string> {
  const out = new Set<string>();
  const add = (t: Tile) => out.add(`${t[0]},${t[1]}`);
  for (const s of built.stations) add(s.tile);
  for (const l of Object.values(built.spots)) for (const s of l ?? []) add(s.tile);
  for (const t of built.rest) add(t);
  for (const p of built.props ?? []) if (p.tile) add(p.tile);
  for (const h of built.ambient ?? []) add(h.tile);
  return out;
}

export const SOUVENIRS_PER_SCENE = 5;

/**
 * Hatıra yerleşimi (§6.3): **taban sahne** üzerinde (dünya büyüyünce yerleri değişmez) `rng(sceneSeed(id))` ile karıştırılmış
 * adaylardan, birbirine ≥ 4 karo (Chebyshev; yetmezse 3, 2) uzak `n` karo. Aday: ana bileşende yürünebilir, çapa/kanca
 * değil, kenar şeridi değil, kutsal bölgenin eğlence payı (3 karo) dışında. Taban koordinatında döner; büyümüş dünyada
 * `shiftTiles(built, tiles)` ile kaydırılır.
 */
export function souvenirSpots(base: Built, sceneId: string, n = SOUVENIRS_PER_SCENE): Tile[] {
  const nav = navGrid(base);
  const { labels, main } = components(base);
  const reserved = reservedTiles(base);
  const cand: Tile[] = [];
  for (let j = 1; j < base.depth - 1; j++) for (let i = 1; i < base.width - 1; i++) {
    if (!walkable(nav, i, j) || labels[j * nav.width + i] !== main) continue;
    if (reserved.has(`${i},${j}`)) continue;
    if (isInSacredBuffer([i, j], base)) continue;
    cand.push([i, j]);
  }
  const r = rng(sceneSeed(sceneId));
  for (let k = cand.length - 1; k > 0; k--) {
    const m = Math.floor(r() * (k + 1));
    const t = cand[k]; cand[k] = cand[m]; cand[m] = t;
  }
  for (const gap of [4, 3, 2, 1]) {
    const out: Tile[] = [];
    for (const t of cand) {
      if (out.every((o) => Math.max(Math.abs(o[0] - t[0]), Math.abs(o[1] - t[1])) >= gap)) out.push(t);
      if (out.length === n) return unpropped(nav, cand, out);
    }
  }
  return unpropped(nav, cand, cand.slice(0, n));
}

/**
 * HQA-FIX — eşya (tezgâh, ağaç, tabure) karosuna düşen hatıra en yakın eşyasız adaya taşınır: kaba ızgarada
 * yürünebilir ama ince ızgarada kapalı karoya avatar giremiyor, "git ve al" ağacın/tezgâhın önünde kalıyordu (<city> çanı, <city> bileti,
 * <city>, <city>, okul, resif; 195 hatıradan 6'sı). Öteki hatıralar yerinde kalır (kimlikler ve albüm değişmez).
*/
function unpropped(nav: NavGrid, cand: readonly Tile[], out: Tile[]): Tile[] {
  const fine = fineWorld(nav);
  if (!fine) return out;
  const shut = (t: Tile) => fine.closed[t[1] * nav.width + t[0]] === 1;
  const res = out.slice();
  res.forEach((t, k) => {
    if (!shut(t)) return;
    let best: Tile | null = null, bd = Infinity;
    for (const c of cand) {
      if (shut(c) || res.some((o) => Math.max(Math.abs(o[0] - c[0]), Math.abs(o[1] - c[1])) < 2)) continue;
      const d = (c[0] - t[0]) ** 2 + (c[1] - t[1]) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    if (best) res[k] = best;
  });
  return res;
}

/** Taban koordinatındaki karoları büyümüş dünyaya kaydırır. */
export function shiftTiles(built: Pick<Built, "modules">, tiles: readonly Tile[]): Tile[] {
  const [oi, oj] = baseOffset(built);
  return tiles.map(([i, j]) => [i + oi, j + oj] as Tile);
}

export { isInSacredBuffer };
