/**
 * W3 (WALK-FUN) — Crowd.tsx'in yürüme modu eğlence yardımcıları: ayrılmış yuvaların yazımı (+0 çizim çağrısı), baş üstü keyif
 * rozeti ve "enerjik" masa parıltısı, mini oyun görselleri (olta takımı, balık, taşlar, top) ve mini oyun yer çözümü.
 */
import * as THREE from "three";
import { useRecognition } from "../../full/worldGifts";
import { key, tx, tz, type Built } from "../scenes";
import { handPos, inQuietZone, type FunCh } from "./brain";
import { burst, C, PALETTE, paletteIndex, type FxState } from "./fx";
import { CAST_MS, REEL_MS } from "./fishing";
import { FISH_SIZE, fishModel, shadowTint } from "./fishModels";
import { fishTier } from "./minigameLogic";
import { deskSpot, type GiftCh, type GiftPlanLike, type GiftWorld } from "./gifts";
import { moodVisual, NO_MOOD } from "./giftPlan";
import { mgActor, type MgResolved, type MgSpot, type MinigameKind } from "./minigames";
import { PROP_GLOW, PROP_SOLID, pbox, pseg, type PropPool } from "./propPool";
import { sites } from "./sites";
import { layerOffset, POP_MS, souvenirLayer } from "../../components/world/walk/progress/layer";
import type { SouvenirModel } from "../../components/world/walk/progress/logic";

// ------------------------------------------------------------------ yuva yazımı
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, "YXZ"), _v = new THREE.Vector3(), _s = new THREE.Vector3();

function writeSet(mesh: THREE.InstancedMesh, base: number, data: Float32Array, n: number, prev: number, cap: number): boolean {
  const mat = mesh.instanceMatrix.array as Float32Array;
  const col = mesh.instanceColor?.array as Float32Array | undefined;
  for (let i = 0; i < n && i < cap; i++) {
    const o = i * 10;
    _e.set(data[o + 7], data[o + 6], data[o + 8]); _q.setFromEuler(_e);
    _m.compose(_v.set(data[o], data[o + 1], data[o + 2]), _q, _s.set(data[o + 3], data[o + 4], data[o + 5]));
    mat.set(_m.elements, (base + i) * 16);
    if (col) { const c = PALETTE[data[o + 9]] ?? PALETTE[0]; const k = (base + i) * 3; col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b; }
  }
  for (let i = n; i < prev; i++) mat.fill(0, (base + i) * 16, (base + i) * 16 + 16);
  // renk yükleme işareti Crowd'da (yalnız [base, base+n) yuvaları; eskiden her karede tüm renk tamponu)
  return n > 0 || prev > 0;
}

/** Ayrılmış yuvaları yazar; değiştiyse true (çağıran `needsUpdate` işaretler). */
export function writePropPool(pp: PropPool, solid: THREE.InstancedMesh | undefined, glow: THREE.InstancedMesh | undefined, baseS: number, baseG: number): [boolean, boolean] {
  const a = solid && baseS >= 0 ? writeSet(solid, baseS, pp.solid, pp.ns, pp.prevS, PROP_SOLID) : false;
  const b = glow && baseG >= 0 ? writeSet(glow, baseG, pp.glow, pp.ng, pp.prevG, PROP_GLOW) : false;
  pp.prevS = pp.ns; pp.prevG = pp.ng; pp.ns = 0; pp.ng = 0;
  return [a, b];
}

// ------------------------------------------------------------------ keyif rozeti ve enerjik görsel
export interface MoodCh extends GiftCh { lod: "near" | "far" | "off"; dist: number }
const BADGE_DIST = 18;
const BADGE_MAX = 14;

/**
 * Yalnızca görsel: baş üstü elmas (1 keyifli: altın, 2 çok keyifli: altın + pembe), enerjikse yanında camgöbeği şimşek ve masada
 * küçük parıltı; yürüme hızı çarpanı (`walkScale`). Gerçek ruh hâli (çalışıyor, hata, onay) kazanır: `moodVisual` yalnızca boşta /
 * "✓ bitti" süsler; odak modunda ve yürüme modu dışında hiçbir şey yok. Hareket azaltmada rozet durağan, parıltı ve hız yok.
 */
export function drawMoods(list: MoodCh[], plans: GiftPlanLike[], built: Built, gw: GiftWorld, pp: PropPool, t: number, now: number, calm: boolean, walk: boolean, focus: boolean) {
  // W4 (WALK-GAME-UI): hatıralar aynı ayrılmış yuvalarda (Crowd bu işlevi her karede çağırır; ek çağrı yeri yok)
  drawSouvenirs(pp, built, t, calm, walk);
  const moods = useRecognition.getState().moods;
  let shown = 0;
  for (const ch of list) {
    const mv = walk ? moodVisual({ morale: moods[ch.slug] ?? 0, realMood: ch.wa.mood, pepUntil: gw.pep.get(ch.slug) ?? 0, now, walk, focus, calm }) : NO_MOOD;
    ch.walkScale = mv.walkScale;
    if (mv === NO_MOOD || ch.lod !== "near" || ch.dist > BADGE_DIST || shown >= BADGE_MAX || inQuietZone(ch.pos.x, ch.pos.z)) continue;
    shown++;
    const s = ch.scale;
    const bob = mv.animate ? Math.sin(t * 2.2 + ch.seed * 6) * 0.04 : 0;
    const y = ch.pos.y + 2.32 * s + bob;
    const spin = mv.animate ? t * 1.6 + ch.seed * 3 : 0.6;
    if (mv.badge >= 1) pbox(pp, true, ch.pos.x - (mv.badge === 2 ? 0.07 : 0), y, ch.pos.z, 0.1 * s, 0.1 * s, 0.03 * s, spin, 0, Math.PI / 4, C.gold);
    if (mv.badge === 2) pbox(pp, true, ch.pos.x + 0.08, y + 0.05, ch.pos.z, 0.075 * s, 0.075 * s, 0.03 * s, spin, 0, Math.PI / 4, C.pink);
    if (mv.energized) {
      // şimşek: iki eğik çubuk
      const ox = ch.pos.x + 0.18 * s, oz = ch.pos.z;
      pbox(pp, true, ox, y + 0.03, oz, 0.03 * s, 0.09 * s, 0.03 * s, spin, 0, 0.5, C.cyan);
      pbox(pp, true, ox + 0.02, y - 0.05, oz, 0.03 * s, 0.09 * s, 0.03 * s, spin, 0, 0.5, C.cyan);
      const plan = plans[ch.index];
      if (mv.animate && plan && !plan.shared) {
        const d = deskSpot(plan, built, 4);
        for (let i = 0; i < 2; i++) {
          const ph = (t * 1.3 + i * 0.5 + ch.seed) % 1;
          const k = Math.sin(Math.PI * ph);
          pbox(pp, true, d.x + Math.sin(i * 2.4 + ch.seed * 9) * 0.18, d.y + 0.12 + ph * 0.25, d.z + Math.cos(i * 2.4 + ch.seed * 9) * 0.18, 0.035 * k, 0.035 * k, 0.035 * k, t * 3, 0, 0.78, C.yellow);
        }
      }
    }
  }
}

// ------------------------------------------------------------------ mini oyun yer çözümü
export function resolveMinigame(kind: MinigameKind, spot: MgSpot, built: Built, oceanY: number | null, list: readonly (FunCh & { gift: unknown; feast: unknown })[]): MgResolved | null {
  if (inQuietZone(spot.x, spot.z)) return null; // kutsal/sakin bölge: mini oyun yok (A21)
  const s = sites(built, oceanY);
  if (kind === "fishing") {
    let best = null as (typeof s.fishing)[number] | null, bd = 2.2;
    for (const f of s.fishing) {
      if (f.feedOnly) continue;
      const d = Math.hypot(tx(f.tile[0]) - spot.x, tz(f.tile[1]) - spot.z);
      if (d < bd) { bd = d; best = f; }
    }
    return best ? { fish: best } : null;
  }
  let table = null as (typeof s.tables)[number] | null, bd = 2.6;
  for (const tb of s.tables) {
    if (kind === "board" ? !tb.board : !tb.game) continue;
    const d = Math.hypot(tb.x - spot.x, tb.z - spot.z);
    if (d < bd) { bd = d; table = tb; }
  }
  if (!table && kind === "board") {
    // panoda masa oyunu kancası yoksa (çoğu sahne): yakındaki herhangi bir boş masa
    for (const tb of s.tables) {
      // CORE-WALK (REAL-SEAT): sıradan masada yalnız iki ucunda gerçek oturak varsa oturarak oynanır (havada oturuş yok)
      if (tb.game || tb.ya === undefined || tb.yb === undefined) continue;
      const d = Math.hypot(tb.x - spot.x, tb.z - spot.z);
      if (d < bd) { bd = d; table = tb; }
    }
  }
  if (!table) return null;
  if (kind === "toss") return { table };
  // rakip: masaya en yakın boştaki ajan (≤ 30 birim; konuşmada, eğlencede, hediyede, yemekte değil)
  let opp: (typeof list)[number] | null = null, od = 30;
  for (const c of list) {
    const m = c.wa.mood;
    if ((m !== "idle" && m !== "done") || c.meet || c.gift || c.feast || c.lod === "off" || inQuietZone(c.pos.x, c.pos.z)) continue;
    const d = Math.hypot(c.pos.x - table.x, c.pos.z - table.z);
    if (d < od) { od = d; opp = c; }
  }
  if (!opp) return null;
  return { table, opponent: { slug: opp.slug, name: opp.wa.agent.name } };
}

/** Rakibin masaya yürüyeceği karo (masanın B yanı) talep anahtarı. */
export const mgClaimKey = () => (mgActor.table ? key(...mgActor.table.b) : null);

// ------------------------------------------------------------------ WORLD-FIX: olta görselleri (atış yayı, şamandıra, çekiş, balık)
const _fq = new THREE.Quaternion(), _bq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _bendQ = new THREE.Quaternion();
const _fe = new THREE.Euler(0, 0, 0, "YXZ"), _re = new THREE.Euler(0, 0, 0, "YXZ"), _oe = new THREE.Euler(0, 0, 0, "YXZ");
const _fv = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const colCache = new Map<string, number>();
function fishCol(hex: string, shadow: boolean): number {
  const key = shadow ? `s${hex}` : hex;
  let c = colCache.get(key);
  if (c === undefined) { c = paletteIndex(shadow ? shadowTint(hex) : hex); colCache.set(key, c); }
  return c;
}

/**
 * Tür modelini (`fishModels.ts`) ayrılmış yuvalara yazar (+0 çizim çağrısı). (x, y, z) gövde ortası; yön yaw/pitch/roll ("YXZ");
 * `size` dünya boyu; `bend` gövde kıvrımı (rad; + sola): kuyruk sapı ve kuyruk bir yana, baş öbür yana döner (yüzme/çırpınma).
 * `shadow`: su altı silueti (göz, desen, parıltı yok; renk derin suya karışık). `glint`: pul parıltısı (parıltı yuvası).
 */
export function drawFishModel(pp: PropPool, species: string, x: number, y: number, z: number, yaw: number, pitch: number, roll: number,
  size: number, bend: number, opts: { shadow?: boolean; glint?: boolean } = {}) {
  _fq.setFromEuler(_fe.set(pitch, yaw, roll, "YXZ"));
  for (const b of fishModel(species)) {
    if (b.glint && (opts.shadow || !opts.glint)) continue;
    if (opts.shadow && (b.part === "eye" || b.part === "mark")) continue;
    _fv.set(b.p[0], b.p[1], b.p[2]);
    _bq.identity();
    if (bend) {
      const rear = b.part === "rear" || b.part === "tail" || (b.part !== "front" && b.part !== "eye" && b.p[2] < -0.22);
      const front = b.part === "front" || b.part === "eye" || b.p[2] > 0.22;
      const ang = rear ? -bend * (b.part === "tail" ? 1.6 : 1) : front ? bend * 0.45 : 0;
      if (ang) {
        const pz = rear ? -0.17 : 0.13;
        _bendQ.setFromAxisAngle(UP, ang);
        _fv.z -= pz; _fv.applyQuaternion(_bendQ); _fv.z += pz;
        _bq.copy(_bendQ);
      }
    }
    if (b.r) _bq.multiply(_rq.setFromEuler(_re.set(b.r[0], b.r[1], b.r[2], "YXZ")));
    _fv.multiplyScalar(size).applyQuaternion(_fq);
    _bq.premultiply(_fq);
    _oe.setFromQuaternion(_bq, "YXZ");
    pbox(pp, !!b.glint, x + _fv.x, y + _fv.y, z + _fv.z, b.s[0] * size, b.s[1] * size, b.s[2] * size, _oe.y, _oe.x, _oe.z, fishCol(b.c, !!opts.shadow));
  }
}

/** Evreye girişte bir kez çalan efektler (sıçrama, halka, kutlama) için son görülen evre anı. */
const fishFx = { at: -1, breach: -1, ripple: 0 };
const ROD_LEN = 1.27, ROD_REST = 0.588;

function bobber(pp: PropPool, x: number, y: number, z: number) {
  pbox(pp, false, x, y, z, 0.07, 0.05, 0.07, 0, 0, 0, C.paddle);
  pbox(pp, false, x, y + 0.045, z, 0.05, 0.04, 0.05, 0, 0, 0, C.white);
}
/** Gevşek misina: iki parçalı sarkma (`sag` birim). */
function slackLine(pp: PropPool, ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag: number) {
  const mx = (ax + bx) / 2, my = (ay + by) / 2 - sag, mz = (az + bz) / 2;
  pseg(pp, false, ax, ay, az, mx, my, mz, 0.008, C.line);
  pseg(pp, false, mx, my, mz, bx, by, bz, 0.008, C.line);
}

/**
 * Olta sahnesi (HUD `mgActor.fp` evresine göre): atışta olta geriye kalkıp öne savrulur ve şamandıra yay çizerek suya düşer
 * (sıçrama + halka); beklerken şamandıra hafifçe salınır; vuruşta dalar, halkalar yayılır, misina gerilir; çekişte olta bükülür
 * (gerilim titreşimi), balık su altından kıyıya gelir, sudan fırlar (sıçrama) ve elde çırpınır; yakalamada parıltı ve konfeti;
 * kaçışta şamandıra sekip misina gevşer, balığın gölgesi uzaklaşır. Hareket azaltmada durağan pozlar, efekt yok.
 */
function drawFishing(pp: PropPool, me: FunCh, a: typeof mgActor, f: NonNullable<typeof mgActor.fish>, t: number, nowMs: number, calm: boolean, fx: FxState | null) {
  const h = handPos(me, true, _h);
  const fwx = Math.sin(me.facing), fwz = Math.cos(me.facing);
  const phase = a.fp, u = Math.max(0, nowMs - a.fpAt);
  const enter = fishFx.at !== a.fpAt;
  if (enter) fishFx.at = a.fpAt;
  // ---- olta açısı: atış savruluşu, gerilimde bükülme, çekişte kalkık
  let phi = ROD_REST, release = 1;
  if (phase === "casting" && !calm) {
    const k = Math.min(1, u / CAST_MS);
    phi = k < 0.35 ? ROD_REST + (1.95 - ROD_REST) * (k / 0.35) : k < 0.6 ? 1.95 + (0.42 - 1.95) * ((k - 0.35) / 0.25) : 0.42 + (ROD_REST - 0.42) * ((k - 0.6) / 0.4);
    release = k < 0.4 ? 0 : (k - 0.4) / 0.6;
  }
  const ten = a.tension;
  if (phase === "reeling") phi += 0.5;
  else if (phase === "caught") phi += 0.12;
  phi -= ten * 0.4 + (phase === "reeling" && !calm ? Math.sin(u * 0.035) * 0.07 : 0);
  const tipX = h.x + fwx * ROD_LEN * Math.cos(phi), tipY = h.y + ROD_LEN * Math.sin(phi), tipZ = h.z + fwz * ROD_LEN * Math.cos(phi);
  const sag = ten * 0.14;
  const mx = h.x + (tipX - h.x) * 0.55, my = h.y + (tipY - h.y) * 0.55 + sag * 0.4, mz = h.z + (tipZ - h.z) * 0.55;
  pseg(pp, false, h.x, h.y, h.z, mx, my, mz, 0.034, C.rod);
  pseg(pp, false, mx, my, mz, tipX, tipY, tipZ, 0.024, C.rod);
  pbox(pp, false, h.x + fwx * 0.1, h.y - 0.05, h.z + fwz * 0.1, 0.07, 0.07, 0.05, me.facing, 0, 0, C.dark); // makara
  const wy = f.by;
  // kıyıdan suya yön (balığın kaçışı / gelişi)
  let ox = f.bx - h.x, oz = f.bz - h.z;
  const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
  const shoreX = h.x + ox * 0.55, shoreZ = h.z + oz * 0.55;
  const species = a.species;
  const size = FISH_SIZE[species ?? ""] ?? 0.3;

  switch (phase) {
    case "ready": case "lost": {
      const sw = calm ? 0 : Math.sin(t * 1.6) * 0.03;
      const bx = tipX + fwx * sw, by = tipY - 0.36, bz = tipZ + fwz * sw;
      pseg(pp, false, tipX, tipY, tipZ, bx, by + 0.05, bz, 0.008, C.line);
      bobber(pp, bx, by, bz);
      return;
    }
    case "casting": {
      if (release <= 0) {
        pseg(pp, false, tipX, tipY, tipZ, tipX, tipY - 0.3, tipZ, 0.008, C.line);
        bobber(pp, tipX, tipY - 0.35, tipZ);
        return;
      }
      const s = Math.min(1, release);
      const bx = tipX + (f.bx - tipX) * s, bz = tipZ + (f.bz - tipZ) * s;
      const by = tipY + (wy + 0.03 - tipY) * s + Math.sin(Math.PI * s) * 0.9;
      slackLine(pp, tipX, tipY, tipZ, bx, by + 0.04, bz, 0.08 * s);
      bobber(pp, bx, by, bz);
      return;
    }
    case "waiting": {
      if (enter && fx && !calm) { burst(fx, "splash", f.bx, wy + 0.04, f.bz, 0.6); burst(fx, "ripple", f.bx, wy + 0.02, f.bz); fishFx.ripple = nowMs + 2600; }
      if (fx && !calm && nowMs > fishFx.ripple) { burst(fx, "ripple", f.bx, wy + 0.02, f.bz, 0.6); fishFx.ripple = nowMs + 2400 + Math.sin(nowMs) * 600; }
      const by = wy + 0.03 + (calm ? 0 : Math.sin(t * 2.4) * 0.012);
      slackLine(pp, tipX, tipY, tipZ, f.bx, by + 0.04, f.bz, 0.16);
      bobber(pp, f.bx, by, f.bz);
      return;
    }
    case "bite": {
      if (enter && fx && !calm) { burst(fx, "ripple", f.bx, wy + 0.02, f.bz); burst(fx, "splash", f.bx, wy + 0.04, f.bz, 0.4); }
      const by = wy - (calm ? 0.04 : 0.02 + Math.abs(Math.sin(t * 22)) * 0.05);
      pseg(pp, false, tipX, tipY, tipZ, f.bx, by + 0.04, f.bz, 0.009, C.line);
      bobber(pp, f.bx, by, f.bz);
      // halkalar (hareket azaltmada tek durağan halka)
      const rings = calm ? 1 : 3;
      for (let i = 0; i < rings; i++) {
        const ang = calm ? i : t * 3 + i * 2.1, r = calm ? 0.16 : 0.12 + ((t * 0.8 + i * 0.33) % 1) * 0.15;
        pbox(pp, true, f.bx + Math.cos(ang) * r, wy + 0.01, f.bz + Math.sin(ang) * r, 0.03, 0.01, 0.03, 0, 0, 0, C.water);
      }
      return;
    }
    case "reeling": {
      const k = calm ? 1 : Math.min(1, u / REEL_MS);
      const travelYaw = Math.atan2(shoreX - f.bx, shoreZ - f.bz);
      let x: number, y: number, z: number, pitch = 0, bend: number, shadow = true;
      if (k < 0.55) {
        // su altında kıyıya doğru (siluet), hızlı kıvrım
        const s = (k / 0.55) * 0.6;
        x = f.bx + (shoreX - f.bx) * s; z = f.bz + (shoreZ - f.bz) * s; y = wy - 0.12;
        bend = calm ? 0 : Math.sin(t * 20) * 0.35;
      } else {
        // sudan fırlar ve olta ucuna yükselir (tür rengi)
        const s2 = (k - 0.55) / 0.45;
        const sx = f.bx + (shoreX - f.bx) * 0.6, sz = f.bz + (shoreZ - f.bz) * 0.6;
        if (fishFx.breach !== a.fpAt && fx && !calm) { fishFx.breach = a.fpAt; burst(fx, "splash", sx, wy + 0.05, sz, 1.1); burst(fx, "ripple", sx, wy + 0.02, sz); }
        x = sx + (tipX - sx) * s2; z = sz + (tipZ - sz) * s2;
        y = wy + (tipY - 0.32 - size * 0.5 - wy) * s2 + Math.sin(Math.PI * s2) * 0.55;
        pitch = -0.9 * (1 - s2) - 0.6 * s2;
        bend = calm ? 0 : Math.sin(t * 22) * 0.5;
        shadow = !species;
      }
      const mouthX = x + Math.sin(travelYaw) * size * 0.45, mouthZ = z + Math.cos(travelYaw) * size * 0.45;
      pseg(pp, false, tipX, tipY, tipZ, mouthX, y, mouthZ, 0.009, C.line);
      const bk = 0.25;
      bobber(pp, mouthX + (tipX - mouthX) * bk, y + (tipY - y) * bk, mouthZ + (tipZ - mouthZ) * bk);
      drawFishModel(pp, species ?? "hamsi", x, y, z, travelYaw, pitch, 0, size, bend, { shadow });
      return;
    }
    case "caught": {
      // balık elin önünde, göğüs hizasında gösterilir (her kamera açısından görünür); misina olta ucundan ağzına
      const hx = h.x + fwx * (0.42 + size * 0.2), hy = h.y + 0.12 + size * 0.45, hz = h.z + fwz * (0.42 + size * 0.2);
      if (enter && fx && !calm) {
        const tier = species ? fishTier(species) : "common";
        burst(fx, tier === "rare" || tier === "legendary" ? "confetti" : "sparkle", hx, hy + 0.2, hz, tier === "legendary" ? 1.6 : 1);
        if (tier !== "junk") burst(fx, "stars", hx, hy + 0.3, hz, 0.7);
      }
      pseg(pp, false, tipX, tipY, tipZ, hx, hy + size * 0.5, hz, 0.009, C.line);
      const flop = calm ? 0 : Math.sin(u * 0.014) * 0.65 * Math.exp(-u / 1400) + Math.sin(t * 3.1) * 0.08;
      const spin = calm ? me.facing + Math.PI / 2 : me.facing + Math.PI / 2 + Math.sin(t * 0.8) * 0.5;
      const glint = calm || Math.sin(t * 6.5) > 0.55;
      drawFishModel(pp, species ?? "hamsi", hx, hy, hz, spin, -Math.PI / 2 + 0.12, 0, size, flop, { glint });
      return;
    }
    case "early": case "late": {
      if (enter && fx && !calm) { burst(fx, "splash", f.bx, wy + 0.05, f.bz, 0.9); burst(fx, "ripple", f.bx, wy + 0.02, f.bz); }
      const pop = calm ? 0 : Math.max(0, Math.sin(u * 0.012)) * 0.12 * Math.exp(-u / 450);
      const by = wy + 0.03 + pop;
      slackLine(pp, tipX, tipY, tipZ, f.bx, by + 0.04, f.bz, 0.32);
      bobber(pp, f.bx, by, f.bz);
      // kaçan balığın gölgesi: sudan uzağa, küçülerek (yalnız hareket açıkken)
      if (!calm && u < 900) {
        const s = u / 900;
        const x = f.bx + ox * s * 1.8, z = f.bz + oz * s * 1.8;
        drawFishModel(pp, "hamsi", x, wy - 0.12 - s * 0.1, z, Math.atan2(ox, oz), 0, 0, 0.3 * (1 - s * 0.5), Math.sin(t * 26) * 0.5, { shadow: true });
      }
      return;
    }
  }
}

// ------------------------------------------------------------------ mini oyun görselleri
const _h = { x: 0, y: 0, z: 0 };
/** Avatar: oltanın ucu, misina, şamandıra, yakalanan balık; masa taşları; atış topu ve hedef. */
export function drawMinigame(pp: PropPool, me: FunCh | null, t: number, calm: boolean, fx: FxState | null = null) {
  const a = mgActor;
  if (!a.kind || !me) return;
  const nowMs = performance.now();
  if (a.kind === "fishing" && a.fish) {
    drawFishing(pp, me, a, a.fish, t, nowMs, calm, fx);
    return;
  }
  const tb = a.table;
  if (!tb) return;
  if (a.kind === "board") {
    // 3×3 tahta masanın üstünde; oyuncu taşı beyaz, rakip koyu
    const y = tb.y + 0.012;
    const yaw = tb.faceA;
    const cx = Math.cos(yaw), sz = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
    pbox(pp, false, tb.x, y, tb.z, 0.62, 0.02, 0.62, yaw, 0, 0, C.brown);
    for (let i = 0; i < 9; i++) {
      const r = Math.floor(i / 3) - 1, c = (i % 3) - 1;
      const ox = c * 0.19 * cx + r * 0.19 * fx, oz = c * 0.19 * sz + r * 0.19 * fz;
      const v = a.board[i];
      if (v) pbox(pp, false, tb.x + ox, y + 0.035, tb.z + oz, 0.12, 0.05, 0.12, yaw, 0, 0, v === 1 ? C.white : C.dark);
      else pbox(pp, false, tb.x + ox, y + 0.012, tb.z + oz, 0.15, 0.006, 0.15, yaw, 0, 0, C.cream);
    }
    return;
  }
  // atış: hedef (küçük sarı top) ve bırakılan top yayı
  const ax = tx(tb.a[0]), az = tz(tb.a[1]);
  const dx = tb.x - ax, dz = tb.z - az, L = Math.hypot(dx, dz) || 1;
  const ux = dx / L, uz = dz / L;
  const hoop = tb.game === "hoop";
  const tyGround = hoop ? tb.y : 0.06;
  pbox(pp, true, tb.x, tyGround, tb.z, 0.09, 0.09, 0.09, 0, 0, 0, C.yellow);
  if (a.throwAt > 0) {
    const u = Math.min(1, (nowMs - a.throwAt) / 900);
    const k = calm ? 1 : u;
    const land = L * (a.power / Math.max(0.05, a.target));
    const h = handPos(me, true, _h);
    const ex = ax + ux * land, ez = az + uz * land, ey = hoop ? tb.y : 0.08;
    const x = h.x + (ex - h.x) * k, z = h.z + (ez - h.z) * k;
    const y = h.y + (ey - h.y) * k + Math.sin(Math.PI * k) * (hoop ? 1.4 : 0.8);
    pbox(pp, false, x, y, z, 0.12, 0.12, 0.12, t * 4, 0, 0, hoop ? C.orange : C.grey);
  } else {
    const h = handPos(me, true, _h);
    pbox(pp, false, h.x, h.y - 0.04, h.z, 0.12, 0.12, 0.12, 0, 0, 0, hoop ? C.orange : C.grey);
  }
}

// ------------------------------------------------------------------ W4 (WALK-GAME-UI): hatıralar (§6.3, §9: +0 çağrı)
/** Hatıra modeli; (x, y, z) modelin ortası, `yaw` dönüş, `s` ölçek. 2–4 kutu (biri parıltı yuvasında). */
function drawSouvenirModel(pp: PropPool, m: SouvenirModel, x: number, y: number, z: number, yaw: number, s: number) {
  switch (m) {
    case "lantern": // fener: koyu çerçeve, sıcak ışıklı gövde, kulp
      pbox(pp, false, x, y - 0.1 * s, z, 0.16 * s, 0.035 * s, 0.16 * s, yaw, 0, 0, C.dark);
      pbox(pp, true, x, y, z, 0.12 * s, 0.16 * s, 0.12 * s, yaw, 0, 0, C.yellow);
      pbox(pp, false, x, y + 0.1 * s, z, 0.15 * s, 0.035 * s, 0.15 * s, yaw, 0, 0, C.dark);
      pbox(pp, false, x, y + 0.15 * s, z, 0.07 * s, 0.05 * s, 0.02 * s, yaw, 0, 0, C.dark);
      break;
    case "shell": // deniz kabuğu: pembe yelpaze + krem iç
      pbox(pp, false, x, y, z, 0.2 * s, 0.07 * s, 0.15 * s, yaw, 0, 0, C.pink);
      pbox(pp, false, x, y + 0.035 * s, z - 0.02 * s, 0.13 * s, 0.05 * s, 0.1 * s, yaw, 0.2, 0, C.cream);
      pbox(pp, true, x, y + 0.08 * s, z, 0.03 * s, 0.03 * s, 0.03 * s, yaw, 0, Math.PI / 4, C.white);
      break;
    case "ticket": // eski bilet: kâğıt + kırmızı şerit, hafif eğik
      pbox(pp, false, x, y, z, 0.24 * s, 0.13 * s, 0.015 * s, yaw, 0, 0.12, C.paper);
      pbox(pp, false, x - 0.07 * s, y, z, 0.03 * s, 0.13 * s, 0.02 * s, yaw, 0, 0.12, C.red);
      pbox(pp, true, x + 0.04 * s, y + 0.02 * s, z, 0.05 * s, 0.03 * s, 0.022 * s, yaw, 0, 0.12, C.gold);
      break;
    case "postcard": // kartpostal: beyaz kenar, gökyüzü ve yeşil şerit
      pbox(pp, false, x, y, z, 0.22 * s, 0.16 * s, 0.015 * s, yaw, 0, 0, C.white);
      pbox(pp, false, x, y + 0.02 * s, z, 0.18 * s, 0.08 * s, 0.02 * s, yaw, 0, 0, C.sky);
      pbox(pp, false, x, y - 0.045 * s, z, 0.18 * s, 0.03 * s, 0.02 * s, yaw, 0, 0, C.green);
      break;
    case "bell": // çan: altın gövde, tepe ve koyu dil
      pbox(pp, false, x, y, z, 0.15 * s, 0.13 * s, 0.15 * s, yaw, 0, 0, C.gold);
      pbox(pp, false, x, y + 0.09 * s, z, 0.08 * s, 0.06 * s, 0.08 * s, yaw, 0, 0, C.gold);
      pbox(pp, false, x, y - 0.08 * s, z, 0.04 * s, 0.04 * s, 0.04 * s, yaw, 0, 0, C.dark);
      pbox(pp, true, x + 0.05 * s, y + 0.05 * s, z + 0.08 * s, 0.025 * s, 0.025 * s, 0.025 * s, 0, 0, Math.PI / 4, C.yellow);
      break;
  }
}

/**
 * Görünür hatıralar (yalnızca yürüme modunda): yerden biraz yukarıda süzülür ve yavaş döner; hareket azaltmada durağan.
 * Toplanınca (pop) 0,7 sn içinde yükselip küçülür, çevresinde parıltılar. Kutsal tampon dışı yerleşim `souvenirSpots`ta.
 */
export function drawSouvenirs(pp: PropPool, built: Built, t: number, calm: boolean, walk: boolean) {
  const L = souvenirLayer;
  if (!walk || !L.scene) { if (L.pops.length) L.pops.length = 0; return; }
  const [oi, oj] = layerOffset(built);
  for (let k = 0; k < L.items.length; k++) {
    const it = L.items[k];
    const x = tx(it.bi + oi), z = tz(it.bj + oj);
    const bob = calm ? 0 : Math.sin(t * 2 + k * 1.7) * 0.05;
    const yaw = calm ? 0.5 + k : t * 0.9 + k * 1.3;
    drawSouvenirModel(pp, it.model, x, 0.5 + bob, z, yaw, 2);
  }
  if (!L.pops.length) return;
  const nowMs = performance.now();
  for (let k = L.pops.length - 1; k >= 0; k--) {
    const p = L.pops[k];
    const u = (nowMs - p.t0) / POP_MS;
    if (u >= 1 || calm) { L.pops.splice(k, 1); continue; }
    const s = 2 * (1 - u * 0.85);
    drawSouvenirModel(pp, p.model, p.x, 0.5 + u * 1.3, p.z, t * 6, s);
    for (let i = 0; i < 4; i++) {
      const ang = i * (Math.PI / 2) + u * 4, r = 0.25 + u * 0.5;
      const ks = 0.06 * (1 - u);
      pbox(pp, true, p.x + Math.cos(ang) * r, 0.5 + u * 1.1, p.z + Math.sin(ang) * r, ks, ks, ks, ang, 0, Math.PI / 4, i % 2 ? C.gold : C.yellow);
    }
  }
}
