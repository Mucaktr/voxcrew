/**
 * STUCK-FIX (WALK-STUCK-001; H2) — yürüme modu güvenlik ağı. Saf modül: React,
 * zustand ve DOM yok (node testi `scripts/walk_stuck.test.mjs` aynı işlevleri çağırır; çalışma zamanı yapıştırıcısı `safeRescue.ts`).
 *
 * Sorun: avatar merdivenden/kenardan düşünce ayak izi yüksek bir sütuna (basamak kolonu) gömülü kalıyordu; denetleyici yalnız bütün
 * çakışmayı tek alt adımda temizleyen hareketi kabul ettiği için avatar yalnız dönebiliyordu. Düzeltme üç katmanlı (oyun standardı):
 * 1. `controller.moveWithCollision`: gömülüyken çakışmayı kesin azaltan hareket kabul edilir (çıkış yönünde yürünür).
 * 2. `safeTick`: gömülü avatar kendiliğinden en kısa yoldan dışarı itilir (`depenetrate`, ≤ 3 birim/sn); son güvenli karo
 * (yerde, çakışmasız, yürünebilir zemin, tetik karosu değil) izlenir; ~0,5 sn gömülü kalırsa, ~0,6 sn hareket girdisine karşın hiç
 * yer değiştirmez ve hiçbir yöne gidemezse, ya da katın zemininin altına düşerse son güvenli karoya (yoksa kat girişine) kurtarılır.
 * 3. "Takıldım" (U ya da HUD düğmesi): her zaman son güvenli karoya (yoksa kat girişine) ışınlar.
 * Ayrıca `snapStairArrival`: merdiven geçişinde (stairSwap) varış, merdiven hattının ortasına çekilir — basamağın kenarında açık
 * zeminin üstüne düşülmez (boşluğun ağzına odadan yandan girilse de).
*/
import { moveWithCollision, nearestWalkable, overlaps, AVATAR_RADIUS, DEADZONE, heightCtx, tileAt, walkable, type AvatarState, type ExtraBlock, type FootCtx, type MoveInput, type NavGrid } from "./controller";
import { createVState } from "../physics/height";
import { tx, tz, type Tile } from "../scenes";

/** gömülü kalma süresi (sn) → kurtarma */
export const EMBED_S = 0.5;
/** hareket girdisine karşın yer değiştirmeme süresi (sn) → hiçbir yöne gidemiyorsa kurtarma */
export const STALL_S = 0.6;
/** kendiliğinden dışarı itilme hızı (birim/sn) ve arama erimi */
export const PUSH_SPEED = 3;
const PUSH_MAX = 0.62;
/** zeminin bu kadar altına düşen avatar kurtarılır */
export const FALL_MARGIN = 0.5;
/** kurtarmadan sonra yeni kurtarma beklemesi (kararma + oturma payı) */
const COOL_S = 0.8;

export interface SafeSpot { x: number; z: number; y: number; key: string }
export type RescueReason = "embed" | "stall" | "fall" | "manual";
export interface RescueTarget { reason: RescueReason; x: number; z: number; y: number; from: "safe" | "entry" | "near" }

export interface SafeState {
  safe: SafeSpot | null;
  embedT: number;
  stallT: number;
  cool: number;
  /** "Takıldım" istendi (bir sonraki adımda işlenir) */
  request: boolean;
  /** sayaçlar (test, geliştirme kancası) */
  rescues: number;
  pushes: number;
}
export const createSafeState = (): SafeState => ({ safe: null, embedT: 0, stallT: 0, cool: 0, request: false, rescues: 0, pushes: 0 });

export interface SafeTickInput {
  nav: NavGrid;
  a: AvatarState;
  dt: number;
  input: MoveInput;
  radius?: number;
  extra?: ExtraBlock;
  /** kat/dünya anahtarı (iç katlar aynı ızgara boyutunda; başka katın güvenli karosu kullanılmaz) */
  key: string;
  /** güvenli sayılmayan karolar (merdiven tetiği, boşluk ağzı, kapı/portal) */
  avoid?: (i: number, j: number) => boolean;
  /** kat girişi (iç kat: merdiven sahanlığı/ayağı ya da kapı varışı; dış dünya: doğma karosu) */
  entry?: () => Tile | null;
  /** false → kendiliğinden itme ve otomatik kurtarma yok (oturma, binme); kayıt ve "Takıldım" sürer */
  auto?: boolean;
}

const footOf = (nav: NavGrid, y: number): FootCtx | null => { const ctx = heightCtx(nav); return ctx ? { ctx, footY: y } : null; };

/** Avatar ayak yüksekliğinde engelli bir karoya gömülü mü (yüksekliğe duyarlı; yükseklik verisi yoksa 2B). */
export function isEmbedded(nav: NavGrid, a: Pick<AvatarState, "x" | "z" | "y">, r = AVATAR_RADIUS, extra?: ExtraBlock): boolean {
  return overlaps(nav, a.x, a.z, r, extra, footOf(nav, a.y));
}

/** Katın en alçak zemini (düşme sınırı). */
const floorMinCache = new WeakMap<NavGrid, number>();
export function floorMin(nav: NavGrid): number {
  let v = floorMinCache.get(nav);
  if (v !== undefined) return v;
  const hc = heightCtx(nav);
  v = 0;
  if (hc) for (let k = 0; k < hc.hf.floor.length; k++) if (!hc.blocked[k] && hc.hf.floor[k] < v) v = hc.hf.floor[k];
  floorMinCache.set(nav, v);
  return v;
}

/** Karonun zemini (yürünebilir karo; yoksa NaN). */
function floorAt(nav: NavGrid, i: number, j: number): number {
  if (!walkable(nav, i, j)) return NaN;
  const hc = heightCtx(nav);
  return hc ? hc.hf.floor[j * nav.width + i] : 0;
}

/**
 * Güvenli karo: yürünebilir (2B engelsiz), merkezinde avatar ayak izi bütünüyle engelsiz karolarda, tetik karosu değil.
 * Dönüş: karonun zemin y'si ya da NaN.
 */
export function safeTileY(nav: NavGrid, i: number, j: number, r = AVATAR_RADIUS, avoid?: (i: number, j: number) => boolean): number {
  const f = floorAt(nav, i, j);
  if (Number.isNaN(f) || avoid?.(i, j)) return NaN;
  if (overlaps(nav, tx(i), tz(j), r)) return NaN;
  return f;
}

/** Herhangi bir yöne (8 yön, 0,08 birim) gidilebiliyor mu. */
export function canMove(nav: NavGrid, a: Pick<AvatarState, "x" | "z" | "y">, r = AVATAR_RADIUS, extra?: ExtraBlock): boolean {
  const foot = footOf(nav, a.y);
  for (let d = 0; d < 8; d++) {
    const ang = (d * Math.PI) / 4;
    const m = moveWithCollision(nav, a, Math.sin(ang) * 0.08, Math.cos(ang) * 0.08, r, extra, foot);
    if (Math.hypot(m.x - a.x, m.z - a.z) > 0.01) return true;
  }
  return false;
}

/**
 * Gömülü avatarı en kısa yoldan dışarı iter (16 yön × 0,02 adım, en çok PUSH_MAX). Bir karede en çok `maxStep` kadar ilerler.
 * Dönüş: çıkış bulundu mu (avatar `a` yerinde güncellenir).
 */
export function depenetrate(nav: NavGrid, a: Pick<AvatarState, "x" | "z" | "y">, r = AVATAR_RADIUS, extra?: ExtraBlock, maxStep = Infinity): boolean {
  const foot = footOf(nav, a.y);
  for (let d = 0.02; d <= PUSH_MAX + 1e-9; d += 0.02) {
    for (let k = 0; k < 16; k++) {
      const ang = (k * Math.PI) / 8;
      const ux = Math.sin(ang), uz = Math.cos(ang);
      if (overlaps(nav, a.x + ux * d, a.z + uz * d, r, extra, foot)) continue;
      const s = Math.min(d, maxStep);
      a.x += ux * s; a.z += uz * s;
      return true;
    }
  }
  return false;
}

/** Avatarı hedefe koyar: dikey durum sıfırlanır (yerde, hız yok), yol temizlenir, bakış korunur. */
export function placeAvatar(a: AvatarState, t: { x: number; z: number; y: number }) {
  a.x = t.x; a.z = t.z;
  Object.assign(a, createVState(t.y));
  a.ground = t.y; a.speed = 0; a.route = null; a.routeIdx = 0; a.leave = -1; a.event = null;
}

/** Kurtarma hedefi: son güvenli karo (aynı kat, hâlâ güvenli) → kat girişi → en yakın güvenli karo. */
export function rescueTarget(st: SafeState, o: Pick<SafeTickInput, "nav" | "a" | "radius" | "key" | "avoid" | "entry">, reason: RescueReason): RescueTarget | null {
  const { nav } = o;
  const r = o.radius ?? AVATAR_RADIUS;
  const s = st.safe;
  if (s && s.key === o.key) {
    const [i, j] = tileAt(s.x, s.z);
    const y = safeTileY(nav, i, j, r, o.avoid);
    if (!Number.isNaN(y)) return { reason, x: tx(i), z: tz(j), y, from: "safe" };
  }
  const e = o.entry?.();
  if (e) {
    const y = safeTileY(nav, e[0], e[1], r, o.avoid);
    if (!Number.isNaN(y)) return { reason, x: tx(e[0]), z: tz(e[1]), y, from: "entry" };
  }
  const here = tileAt(o.a.x, o.a.z);
  const n = nearestWalkable(nav, here, 64, (i, j) => !Number.isNaN(safeTileY(nav, i, j, r, o.avoid)));
  if (n) return { reason, x: tx(n[0]), z: tz(n[1]), y: safeTileY(nav, n[0], n[1], r, o.avoid), from: "near" };
  return null;
}

/**
 * Kare başı (avatar adımından SONRA): kendiliğinden dışarı itme, son güvenli karonun kaydı ve kurtarma kararı. Kurtarma gerekiyorsa
 * hedefi döndürür (çağıran kararma altında `placeAvatar` ile uygular); yoksa null. Belirlenimci.
 */
export function safeTick(st: SafeState, o: SafeTickInput): RescueTarget | null {
  const { nav, a } = o;
  const dt = Math.max(0, o.dt);
  const r = o.radius ?? AVATAR_RADIUS;
  const auto = o.auto !== false;
  st.cool = Math.max(0, st.cool - dt);
  if (st.request) {
    st.request = false;
    const t = rescueTarget(st, o, "manual");
    if (t) { st.embedT = 0; st.stallT = 0; st.cool = COOL_S; st.rescues++; }
    return t;
  }
  // geçersiz durum ya da katın altına düşüş
  const lost = !Number.isFinite(a.x) || !Number.isFinite(a.z) || !Number.isFinite(a.y) || a.y < floorMin(nav) - FALL_MARGIN;
  let embedded = !lost && isEmbedded(nav, a, r, o.extra);
  if (embedded && auto) {
    if (depenetrate(nav, a, r, o.extra, PUSH_SPEED * dt)) st.pushes++;
    embedded = isEmbedded(nav, a, r, o.extra);
  }
  st.embedT = embedded ? st.embedT + dt : 0;
  const pushing = Math.hypot(o.input.x, o.input.y) >= DEADZONE;
  st.stallT = pushing && a.speed < 0.05 ? st.stallT + dt : 0;
  if (auto && st.cool <= 0) {
    let reason: RescueReason | null = lost ? "fall" : st.embedT >= EMBED_S ? "embed" : null;
    if (!reason && st.stallT >= STALL_S) {
      if (!canMove(nav, a, r, o.extra)) reason = "stall";
      st.stallT = 0;
    }
    if (reason) {
      const t = rescueTarget(st, o, reason);
      st.embedT = 0; st.stallT = 0; st.cool = COOL_S;
      if (t) { st.rescues++; return t; }
    }
  }
  // son güvenli karo: yerde, gömülü değil, karonun zemininde
  if (!lost && !embedded && a.grounded) {
    const [i, j] = tileAt(a.x, a.z);
    const y = safeTileY(nav, i, j, r, o.avoid);
    if (!Number.isNaN(y) && Math.abs(a.y - y) < 0.05) st.safe = { x: tx(i), z: tz(j), y, key: o.key };
  }
  return null;
}

/**
 * Merdiven geçişi varışı (interiors/store.ts `stairSwap`): tetik karosunda kalır, merdiven hattına dik eksende karonun ortasına
 * çekilir (yanlamasına kenarda açık zemine düşülmez); hat boyunca konum korunur (karonun içinde, ayak izi payıyla).
 */
export function snapStairArrival(link: { dir: "up" | "down"; tile: Tile; run: readonly Tile[] }, x: number, z: number, r = AVATAR_RADIUS): { x: number; z: number } {
  const [i, j] = link.tile;
  const k = link.run.findIndex((t) => t[0] === i && t[1] === j);
  const prev = link.run[k - 1] ?? link.run[k + 1];
  const cx = tx(i), cz = tz(j);
  if (k < 0 || !prev) return { x: cx, z: cz };
  const alongX = prev[0] !== i; // hat x boyunca mı ilerliyor
  const lim = Math.max(0, 0.5 - r - 0.02);
  const clamp = (v: number, c: number) => Math.min(c + lim, Math.max(c - lim, v));
  return alongX ? { x: clamp(x, cx), z: cz } : { x: cx, z: clamp(z, cz) };
}
