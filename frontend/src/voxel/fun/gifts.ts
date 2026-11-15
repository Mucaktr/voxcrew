/**
 * W3 (WALK-FUN) — hediye, ekip yemeği ve tepki koreografisi.
 *
 * Sözleşme (WALK-UX çağırır; React dışı, her yerden güvenle çağrılabilir):
 * - `playGift(slug, kind)`: avatar (yürüme modunda ve yakındaysa) ya da kurye (kutu masaya iner) eşyayı uzatır; ajan tüketir /
 * sevinir / masasına koyar. Bitki ve kupa masada kalır (kayıtlardan salt okunur: `useRecognition` `today.plants/trophies`).
 * - `playMeal(slugs)`: ekip yemeği; boştaki üyeler ortak masa ya da ortak bir noktada toplanıp ≈ 20 sn yer.
 * - `playReaction(slug, "wave" | "clap" | "highfive")`: boştaysa tam tepki; çalışıyorsa yalnızca başını kaldırıp ≤ 1 sn el sallar.
 * - `playSelf("coffee")`: avatar kendine kahve alır (yudum; ücretsiz, kozmetik).
 * Ayrıca SSE `recognition.given` / `recognition.team_lunch` olayları da kuyruğa düşer: ajan kartından verilen hediye de dünyada
 * oynar. Aynı ajan + tür 8 sn içinde bir kez oynar (çağrı + olay).
 *
 * Çizim: kalabalığın var olan `solid`/`glow` dizilerindeki ayrılmış yuvalar (`propPool.ts`) → +0 çizim çağrısı. Kozmetiktir:
 * hiçbir iş durumunu, koşuyu, tokenı, model seçimini ya da kuyruğu etkilemez; gerçek ruh hâli her zaman kazanır.
*/
import { useRecognition } from "../../full/worldGifts";
import { registerEventHandler } from "../../lib/store";
import type { StudioEvent } from "../../lib/types";
import { D, key, tileOf, tx, tz, W, type Built, type Station, type Tile } from "../scenes";
import { walkRuntime } from "../walk/walkStore";
import { handPos, inQuietZone, type FunCh } from "./brain";
import { C } from "./fx";
import {
  Dedupe, deferredUse, giftAt, giftSteps, isCaffeine, isKeepsake, normalizeGiftKind, PEP_MS, reactionPlan,
  type GiftKind, type GiftMotion, type GiftStep, type ReactionKind,
} from "./giftPlan";
import { drawItem, pbox, solidLeft, type ItemModel, type PropPool } from "./propPool";
import { sites } from "./sites";

export type { GiftKind, ReactionKind } from "./giftPlan";
export { GIFT_KINDS, normalizeGiftKind } from "./giftPlan";

// ------------------------------------------------------------------ kuyruk (sözleşme)
export type GiftRequest =
  | { type: "gift"; slug: string; kind: GiftKind; at: number }
  | { type: "meal"; slugs: string[]; at: number }
  | { type: "reaction"; slug: string; kind: ReactionKind; at: number };

/** Bekleyen istekler (Crowd tüketir). Dünya bağlı değilken en çok 16 tutulur, 30 sn'den eskisi atılır. */
export const giftQueue: GiftRequest[] = [];
const MAX_QUEUE = 16;
const nowS = () => Date.now() / 1000;
const dedupe = new Dedupe(8);

function push(r: GiftRequest) {
  const t = nowS();
  while (giftQueue.length && (giftQueue.length >= MAX_QUEUE || t - giftQueue[0].at > 30)) giftQueue.shift();
  giftQueue.push(r);
}

/** Hediye animasyonu ister. Dönen değer: oynatılacak mı (aynı ajan + tür 8 sn içinde ikinci kez gelirse false). */
export function playGift(slug: string, kind: GiftKind | string): boolean {
  if (!slug) return false;
  const k = normalizeGiftKind(kind);
  if (!dedupe.accept(`g:${slug}:${k}`, nowS())) return false;
  push({ type: "gift", slug, kind: k, at: nowS() });
  return true;
}

/** Ekip yemeği (≈ 20 sn). En az bir üye gerekir. */
export function playMeal(slugs: readonly string[]): boolean {
  const list = [...new Set(slugs.filter(Boolean))].slice(0, 8);
  if (!list.length) return false;
  if (!dedupe.accept(`m:${[...list].sort().join(",")}`, nowS())) return false;
  push({ type: "meal", slugs: list, at: nowS() });
  return true;
}

/** Tepki (el salla, alkış, çak bir beşlik). Çalışan ajan yalnızca ≤ 1 sn el sallar. */
export function playReaction(slug: string, kind: ReactionKind): boolean {
  if (!slug) return false;
  push({ type: "reaction", slug, kind, at: nowS() });
  return true;
}

/** Avatar kendine kahve alır: yudum animasyonu (≈ 3,5 sn; hareket azaltmada durağan fincan). */
export function playSelf(kind: "coffee" = "coffee"): boolean {
  void kind;
  walkRuntime.sip = performance.now() + 3500;
  return true;
}

/** SSE: ajan kartından / çıktı sayfasından verilen hediye ve ekip yemeği dünyada da oynar. */
function onEvent(ev: StudioEvent) {
  const e = ev as StudioEvent & { agent?: unknown; kind?: unknown; item?: unknown; members?: unknown };
  if (ev.type === "recognition.given" && typeof e.agent === "string") playGift(e.agent, String(e.kind ?? e.item ?? "note"));
  else if (ev.type === "recognition.team_lunch" && Array.isArray(e.members)) playMeal(e.members.map(String));
}
const offEvents = registerEventHandler("recognition.", onEvent);
if (import.meta.hot) import.meta.hot.dispose(() => offEvents());

// ------------------------------------------------------------------ çalışma durumu (Crowd)
export interface GiftAct {
  kind: GiftKind; steps: GiftStep[]; t0: number; giver: "avatar" | "courier" | "desk"; busy: boolean;
  /** uçuşun başlangıcı (dünya) */
  sx: number; sy: number; sz: number;
  sparkled: boolean;
}
export interface Feast { spot: Tile | null; face: number; until: number; arrived: boolean }
export interface GiftReact { motion: GiftMotion; t0: number; until: number }

/** Crowd karakterinin hediye alanları (Crowd.tsx `Ch` taşır). */
export interface GiftCh extends FunCh {
  gift: GiftAct | null;
  react: GiftReact | null;
  feast: Feast | null;
  /** masada bekleyen tüketimler (çalışırken verildi; boşta kalınca kullanılır) */
  deskQ: GiftKind[];
  /** yürüme animasyonu hız çarpanı (enerjik: 1,12) */
  walkScale: number;
}

export interface GiftWorld {
  /** slug → enerjik bitişi (ms, Date.now) */
  pep: Map<string, number>;
  /** bu oturumda masaya konan bitki / kupa (kayıt yüklenene dek) */
  placed: Map<string, { plants: number; trophies: number }>;
  /** avatarın tepkisi (çak bir beşlik) ve uzatma kolu */
  meReact: GiftReact | null;
  meGiveUntil: number;
  meFace: number | null;
  /** masa süsü kayıt yüklemesi (slug → son istek, ms) */
  deskLoad: Map<string, number>;
  deskLoadAt: number;
  built: Built | null;
}
export function createGiftWorld(): GiftWorld {
  return { pep: new Map(), placed: new Map(), meReact: null, meGiveUntil: 0, meFace: null, deskLoad: new Map(), deskLoadAt: 0, built: null };
}

export interface GiftPlanLike { station: Station; shared: boolean; idle: Tile }
export interface GiftEnv {
  list: GiftCh[]; bySlug: Map<string, GiftCh>; plans: GiftPlanLike[]; built: Built; oceanY: number | null;
  t: number; now: number; calm: boolean; pp: PropPool; claims: Set<string>;
  /** avatar elinin konumu (yoksa null) */
  me: { x: number; z: number; hand: { x: number; y: number; z: number } } | null;
  walk: boolean; focus: boolean;
}

const BLOCKING = new Set(["waiting", "error", "offline"]);
const BENCH = typeof location !== "undefined" && new URLSearchParams(location.search).has("bench");
const FREE = (m: string) => m === "idle" || m === "done";
const AVATAR_REACH = 3.5;

// ------------------------------------------------------------------ masa yüksekliği (dünya başına bir kez)
const topCache = new WeakMap<Built, Float32Array>();
function deskTops(built: Built): Float32Array {
  let g = topCache.get(built);
  if (g) return g;
  const w = built.width, d = built.depth;
  g = new Float32Array(w * d).fill(-1);
  for (const b of built.blocks) {
    if (b.g !== "solid" && b.g !== "glass" && b.g !== "glow") continue;
    const top = b.p[1] + b.s[1] / 2;
    if (top < 0.45 || top > 1.25) continue;
    const x0 = Math.floor(b.p[0] - b.s[0] / 2 + W / 2 + 0.02), x1 = Math.floor(b.p[0] + b.s[0] / 2 + W / 2 - 0.02);
    const z0 = Math.floor(b.p[2] - b.s[2] / 2 + D / 2 + 0.02), z1 = Math.floor(b.p[2] + b.s[2] / 2 + D / 2 - 0.02);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 6) continue;
    for (let i = Math.max(0, x0); i <= Math.min(w - 1, x1); i++) for (let j = Math.max(0, z0); j <= Math.min(d - 1, z1); j++) {
      const k = j * w + i;
      if (top > g[k]) g[k] = top;
    }
  }
  topCache.set(built, g);
  return g;
}

const ANCHOR = { x: 0, y: 0, z: 0, yaw: 0 };
/** Masa üstünde `slot` sıradaki eşyanın yeri (masa yoksa istasyonun yanında zeminde). */
export function deskSpot(plan: GiftPlanLike, built: Built, slot: number, out = ANCHOR) {
  const st = plan.station, f = st.face;
  const fx = Math.sin(f), fz = Math.cos(f);
  const di = st.tile[0] + Math.round(fx), dj = st.tile[1] + Math.round(fz);
  const tops = deskTops(built);
  const top = di >= 0 && dj >= 0 && di < built.width && dj < built.depth ? tops[dj * built.width + di] : -1;
  // yan kaydırma: 0 → sağ, 1 → sol, 2 → daha sağ…
  const side = (slot % 2 === 0 ? 1 : -1) * (0.28 + Math.floor(slot / 2) * 0.16);
  const rx = Math.cos(f), rz = -Math.sin(f);
  if (top > 0) {
    out.x = tx(st.tile[0]) + fx * 0.62 + rx * side; out.z = tz(st.tile[1]) + fz * 0.62 + rz * side; out.y = top;
  } else {
    out.x = tx(st.tile[0]) + rx * (0.42 + Math.abs(side) * 0.4) * Math.sign(side) + fx * 0.1; out.z = tz(st.tile[1]) + rz * (0.42 + Math.abs(side) * 0.4) * Math.sign(side) + fz * 0.1; out.y = 0;
  }
  out.yaw = f;
  return out;
}

// ------------------------------------------------------------------ adım
const _h = { x: 0, y: 0, z: 0 };

function startAct(ch: GiftCh, kind: GiftKind, env: GiftEnv, gw: GiftWorld, plan: GiftPlanLike | undefined, fromDesk: boolean) {
  const mood = ch.wa.mood;
  const busy = !FREE(mood);
  const me = env.me;
  const near = !!me && env.walk && Math.hypot(me.x - ch.pos.x, me.z - ch.pos.z) < AVATAR_REACH;
  const giver = fromDesk ? "desk" : near ? "avatar" : "courier";
  let steps = giftSteps(kind, { busy, giver: giver === "avatar" ? "avatar" : "courier" });
  if (busy && BLOCKING.has(mood)) steps = steps.filter((s) => s.phase !== "glance"); // onay/hata: bakma bile yok
  if (fromDesk) steps = [{ ...steps[0], dur: 0.5 }, ...steps.slice(1)];
  let sx = ch.pos.x, sy = ch.pos.y + 3.2, sz = ch.pos.z;
  if (giver === "avatar" && me) { sx = me.hand.x; sy = me.hand.y; sz = me.hand.z; gw.meGiveUntil = env.t + steps[0].dur + 0.2; gw.meFace = Math.atan2(ch.pos.x - me.x, ch.pos.z - me.z); }
  else if (plan && (busy || fromDesk)) { const a = deskSpot(plan, env.built, 0); sx = a.x; sz = a.z; sy = fromDesk ? a.y : a.y + 3.2; }
  ch.gift = { kind, steps, t0: env.t, giver, busy, sx, sy, sz, sparkled: false };
  if (isCaffeine(kind) && !busy) gw.pep.set(ch.slug, env.now + PEP_MS);
}

function finishAct(ch: GiftCh, gw: GiftWorld) {
  const a = ch.gift;
  if (!a) return;
  ch.gift = null;
  if (deferredUse(a.kind, a.busy)) { if (ch.deskQ.length < 3) ch.deskQ.push(a.kind); }
  else if (isKeepsake(a.kind)) {
    const p = gw.placed.get(ch.slug) ?? { plants: 0, trophies: 0 };
    if (a.kind === "plant") p.plants = Math.min(2, p.plants + 1); else p.trophies = Math.min(3, p.trophies + 1);
    gw.placed.set(ch.slug, p);
  }
}

/** Masadaki kalıcı süsler: kayıt (salt okunur) ile bu oturumda konanların büyüğü; tavan bitki 2, kupa 3. */
export function deskCounts(slug: string, gw: GiftWorld): { plants: number; trophies: number } {
  const srv = useRecognition.getState().byAgent[slug]?.today;
  const loc = gw.placed.get(slug);
  return { plants: Math.min(2, Math.max(srv?.plants ?? 0, loc?.plants ?? 0)), trophies: Math.min(3, Math.max(srv?.trophies ?? 0, loc?.trophies ?? 0)) };
}

/** Yemek: boştaki üyeler masa (ya da ortak nokta) çevresinde toplanır; çalışanların tepsisi masalarına bırakılır. */
function startFeast(slugs: string[], env: GiftEnv) {
  const members = slugs.map((s) => env.bySlug.get(s)).filter((c): c is GiftCh => !!c);
  if (!members.length) return;
  const free = members.filter((c) => FREE(c.wa.mood) && !c.meet && !inQuietZone(c.pos.x, c.pos.z));
  for (const c of members) if (!free.includes(c) && c.deskQ.length < 3 && !BLOCKING.has(c.wa.mood)) c.deskQ.push("meal");
  if (!free.length) return;
  let cx = 0, cz = 0;
  for (const c of free) { cx += c.pos.x; cz += c.pos.z; }
  cx /= free.length; cz /= free.length;
  const ct = tileOf(cx, cz);
  // en yakın oyun/piknik masası (≤ 14 karo), yoksa merkez karo
  const tables = sites(env.built, env.oceanY).tables;
  let best: { x: number; z: number } | null = null, bd = 14;
  for (const tb of tables) {
    if (tb.game) continue;
    const d = Math.abs(Math.floor(tb.x + W / 2) - ct[0]) + Math.abs(Math.floor(tb.z + D / 2) - ct[1]);
    if (d < bd) { bd = d; best = { x: tb.x, z: tb.z }; }
  }
  const c0 = best ? tileOf(best.x, best.z) : ct;
  const ring: Tile[] = [];
  for (let r = 1; r <= 3 && ring.length < free.length; r++) {
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = c0[0] + di, j = c0[1] + dj;
      if (i < 0 || j < 0 || i >= env.built.width || j >= env.built.depth) continue;
      const k = key(i, j);
      if (env.built.blocked.has(k) || env.claims.has(k) || ring.some((t) => t[0] === i && t[1] === j)) continue;
      ring.push([i, j]);
    }
  }
  const mx = tx(c0[0]), mz = tz(c0[1]);
  free.forEach((c, n) => {
    const spot = ring[n] ?? null;
    const face = spot ? Math.atan2(mx - tx(spot[0]), mz - tz(spot[1])) : c.facing;
    c.feast = { spot, face, until: env.t + 45, arrived: false };
  });
}

/** Kare başı: kuyruğu tüketir, koreografileri ilerletir, eşyaları, masa süslerini ve tepsileri çizer. Döner: süren gösteri sayısı. */
export function stepGifts(gw: GiftWorld, env: GiftEnv): number {
  const { t, pp } = env;
  if (gw.built !== env.built) {
    gw.built = env.built;
    for (const c of env.list) { c.gift = null; c.feast = null; c.react = null; }
  }
  // 1) kuyruk
  while (giftQueue.length) {
    const r = giftQueue.shift()!;
    if (r.type === "meal") { startFeast(r.slugs, env); continue; }
    const ch = env.bySlug.get(r.slug);
    if (!ch) continue;
    const plan = env.plans[ch.index];
    if (r.type === "gift") {
      // kutsal/sakin bölge: animasyon yok (kayıt yine yazıldı); kalıcı süs yine masada görünür
      if (inQuietZone(ch.pos.x, ch.pos.z)) { if (isKeepsake(r.kind)) { const a: GiftAct = { kind: r.kind, steps: [], t0: t, giver: "courier", busy: false, sx: 0, sy: 0, sz: 0, sparkled: true }; ch.gift = a; finishAct(ch, gw); } continue; }
      if (ch.gift) finishAct(ch, gw);
      startAct(ch, r.kind, env, gw, plan, false);
    } else {
      const rp = reactionPlan(r.kind, ch.wa.mood);
      if (!rp || inQuietZone(ch.pos.x, ch.pos.z)) continue;
      ch.react = { motion: rp.motion, t0: t, until: t + rp.dur };
      const me = env.me;
      if (rp.motion === "highfive" && me && env.walk && Math.hypot(me.x - ch.pos.x, me.z - ch.pos.z) < AVATAR_REACH) {
        gw.meReact = { motion: "highfive", t0: t, until: t + rp.dur };
        gw.meFace = Math.atan2(ch.pos.x - me.x, ch.pos.z - me.z);
      }
    }
  }
  if (gw.meReact && t > gw.meReact.until) gw.meReact = null;

  // 2) karakterler
  let active = 0;
  for (const ch of env.list) {
    const mood = ch.wa.mood;
    if (ch.react && t > ch.react.until) ch.react = null;
    if (ch.react && ch.react.motion !== "glance" && !FREE(mood)) ch.react = null; // iş geldi: tepki biter
    if (ch.feast && (t > ch.feast.until || !FREE(mood))) ch.feast = null;
    const plan = env.plans[ch.index];
    // masada bekleyen tüketim: boşta kalınca kullan
    if (!ch.gift && ch.deskQ.length && FREE(mood) && !ch.meet && !ch.feast && ch.lod !== "off") startAct(ch, ch.deskQ.shift()!, env, gw, plan, true);
    const a = ch.gift;
    if (a) {
      // iş geldi (boşta başlayan gösteri): tüketim masaya kalır, gösteri biter
      if (!a.busy && !FREE(mood)) { const used = (giftAt(a.steps, t - a.t0)?.step.phase ?? "react") === "react"; a.busy = !used && !isKeepsake(a.kind); finishAct(ch, gw); }
      else {
        const at = giftAt(a.steps, t - a.t0);
        if (!at) finishAct(ch, gw);
        else { active++; if (ch.lod !== "off") drawAct(ch, a, at.step, at.u, env, gw, plan); }
      }
    }
    if (ch.feast) {
      active++;
      const f = ch.feast;
      if (!f.arrived && !ch.path.length && f.spot && Math.hypot(ch.pos.x - tx(f.spot[0]), ch.pos.z - tz(f.spot[1])) < 0.25) { f.arrived = true; f.until = Math.min(f.until, t + 20); }
      if (!f.spot && !f.arrived) { f.arrived = true; f.until = Math.min(f.until, t + 20); }
      if (f.arrived && ch.lod !== "off") { const h = handPos(ch, true, _h); drawItem(pp, "meal", h.x, h.y - 0.05, h.z, ch.facing, ch.scale); }
    }
  }
  // 3) masa süsleri ve bekleyen tüketimler (yakın karakterler; elde tutulanlardan sonra, kalan yuvalara)
  for (const ch of env.list) {
    if (ch.lod !== "near" || solidLeft(pp) < 4) continue;
    const plan = env.plans[ch.index];
    if (!plan || plan.shared) continue;
    const dc = deskCounts(ch.slug, gw);
    let slot = 0;
    for (let i = 0; i < dc.plants; i++) { const s = deskSpot(plan, env.built, slot++); drawItem(pp, "plant", s.x, s.y, s.z, s.yaw, 0.9); }
    for (let i = 0; i < dc.trophies; i++) { const s = deskSpot(plan, env.built, slot++); drawItem(pp, "trophy", s.x, s.y, s.z, s.yaw, 0.9); }
    for (const k of ch.deskQ) { if (solidLeft(pp) < 4) break; const s = deskSpot(plan, env.built, slot++); drawItem(pp, itemOf(k), s.x, s.y, s.z, s.yaw); }
  }
  return active;
}

export const itemOf = (k: GiftKind): ItemModel => (k === "coffee" ? "coffee" : k);

const keepN = (ch: GiftCh, gw: GiftWorld) => { const d = deskCounts(ch.slug, gw); return d.plants + d.trophies; };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
function drawAct(ch: GiftCh, a: GiftAct, step: GiftStep, u: number, env: GiftEnv, gw: GiftWorld, plan: GiftPlanLike | undefined) {
  const { pp } = env;
  const model = itemOf(a.kind);
  const s = ch.scale;
  switch (step.item) {
    case "flying": {
      // kurye: kutu masaya / ajanın önüne iner; avatar: elden ele kısa yay
      let ex: number, ey: number, ez: number;
      if (a.busy && plan) { const d = deskSpot(plan, env.built, keepN(ch, gw) + ch.deskQ.length); ex = d.x; ey = d.y; ez = d.z; }
      else { const h = handPos(ch, true, _h); ex = h.x; ey = h.y - 0.05; ez = h.z; }
      const k = env.calm ? 1 : u * u * (3 - 2 * u);
      const arc = a.giver === "avatar" ? Math.sin(Math.PI * k) * 0.25 : 0;
      const x = lerp(a.sx, ex, k), y = lerp(a.sy, ey, k) + arc, z = lerp(a.sz, ez, k);
      if (a.giver === "courier") drawItem(pp, "parcel", x, y, z, ch.facing + (env.calm ? 0 : u * 3), 0.9 * s);
      else drawItem(pp, model, x, y, z, ch.facing, s);
      break;
    }
    case "hand": case "mouth": {
      const h = handPos(ch, true, _h);
      drawItem(pp, model, h.x, h.y - (step.item === "mouth" ? 0.02 : 0.06), h.z, ch.facing, s);
      // buhar (kahve/çay; yalnızca hareket serbestken, parlak yuvalarda)
      if (isCaffeine(a.kind) && !env.calm) for (let i = 0; i < 2; i++) {
        const v = ((env.t * 0.9 + i * 0.5) % 1);
        pbox(pp, true, h.x + Math.sin(env.t * 3 + i) * 0.02, h.y + 0.1 + v * 0.22, h.z, 0.03 * (1 - v), 0.03 * (1 - v), 0.03 * (1 - v), 0, 0, 0, C.steam);
      }
      break;
    }
    case "desk": {
      if (!plan) break;
      if (step.phase === "place") {
        // elden masaya
        const h = handPos(ch, true, _h);
        const d = deskSpot(plan, env.built, keepN(ch, gw));
        const k = env.calm ? 1 : u;
        drawItem(pp, model, lerp(h.x, d.x, k), lerp(h.y - 0.06, d.y, k), lerp(h.z, d.z, k), d.yaw, 0.9);
      } else if (step.phase === "glance") {
        const d = deskSpot(plan, env.built, keepN(ch, gw) + ch.deskQ.length);
        drawItem(pp, model, d.x, d.y, d.z, d.yaw);
      } else {
        const d = deskSpot(plan, env.built, keepN(ch, gw));
        drawItem(pp, model, d.x, d.y, d.z, d.yaw, 0.9);
        // kupa: kısa parıltı (parlak yuvalarda; hareket azaltmada yok)
        if (a.kind === "trophy" && !env.calm) for (let i = 0; i < 4; i++) {
          const ang = env.t * 4 + i * 1.57, r = 0.14 + 0.04 * Math.sin(env.t * 9 + i);
          pbox(pp, true, d.x + Math.cos(ang) * r, d.y + 0.2 + Math.sin(env.t * 5 + i) * 0.05, d.z + Math.sin(ang) * r, 0.025, 0.025, 0.025, ang, 0, 0.78, C.yellow);
        }
      }
      break;
    }
  }
}

/** Crowd: boştaki ajanın gösteri hareketi (yerinde) ve yüz yönü; yoksa null. Çalışan ajan için `glance` (oturduğu yerde). */
export function giftMotion(ch: GiftCh, t: number, me: { x: number; z: number } | null): { motion: GiftMotion; face: number | null } | null {
  const mood = ch.wa.mood;
  const face = me && ch.gift?.giver === "avatar" ? Math.atan2(me.x - ch.pos.x, me.z - ch.pos.z) : null;
  if (ch.gift && !ch.gift.busy && FREE(mood)) {
    const at = giftAt(ch.gift.steps, t - ch.gift.t0);
    if (at) return { motion: at.step.motion, face };
  }
  if (ch.gift && ch.gift.busy) {
    const at = giftAt(ch.gift.steps, t - ch.gift.t0);
    if (at && at.step.motion === "glance") return { motion: "glance", face: null };
  }
  if (ch.react && t <= ch.react.until) {
    const rf = me && (ch.react.motion === "highfive" || ch.react.motion === "wave") ? Math.atan2(me.x - ch.pos.x, me.z - ch.pos.z) : null;
    return { motion: ch.react.motion, face: rf };
  }
  return null;
}

/** "Ben" avatarına iz: el uzatma (hediye verirken) ve çak bir beşlik. */
export function meGesture(gw: GiftWorld, t: number): { motion: "give" | "highfive"; face: number | null; phase: number } | null {
  if (gw.meReact && t <= gw.meReact.until) return { motion: "highfive", face: gw.meFace, phase: (t - gw.meReact.t0) / Math.max(0.1, gw.meReact.until - gw.meReact.t0) };
  if (t <= gw.meGiveUntil) return { motion: "give", face: gw.meFace, phase: 0 };
  return null;
}

/** Keyif yüklemesi: yakındaki ajanların kayıtlarını (masa süsleri için) seyrek yükle — en çok 2 sn'de bir istek, ajan başına 5 dk'da bir. */
export function ensureDesk(gw: GiftWorld, slug: string, now: number) {
  if (now - gw.deskLoadAt < 2000 || BENCH) return; // ölçüm modu: sahte ajanların kaydı yok (404 gürültüsü olmasın)
  const last = gw.deskLoad.get(slug) ?? -1e12;
  if (now - last < 300_000) return;
  gw.deskLoad.set(slug, now); gw.deskLoadAt = now;
  void useRecognition.getState().load(slug);
}
