/**
 * şehir haritası seyir noktasının BAKIŞ HEDEFİ. Seyir karosuna gelen oyuncu bu hedefe döner (walk/viewTurn.ts).
 *
 * Hedef: semtin (yoksa şehrin) en belirgin, görüntülenebilir simgesi — puan = yükseklik / (3 + karo uzaklığı), aynı semt ×2, seyir
 * karosunu içeren simge elenir. İç mekân dürbünüyle aynı hedef türü (`LandmarkViewTarget`, manzara kipinin simgeleri); iç mekânda
 * `lookoutTarget` kullanılır. Saf hesap; WeakMap önbellekli.
*/
import { cityViewTargets, rectDist, viewableTarget, type LandmarkViewTarget } from "../walk/landmarkView";
import { cityX, cityZ } from "../transit/model";
import { districtAt, type CityMapFile, type CityTile } from "./format";
import { gazeAngles, startViewTurn } from "../walk/viewTurn";
import { districtParcel, districtPlan, districtWater, T_TREE } from "./district";
import { CITY_PD, CITY_PW, GATE_D, GATE_W } from "./format";
import { walkFov, WALK_FOV_DEFAULT } from "../walk/scale";
import { landmarkModel } from "./designs"; // hedefin görünen modeli (telefon karesi ölçüsü)
import { landmarkVisual } from "../walk/landmarkWalk";
import { FULL_VP_FOCUS, FULL_VP_SKIP, FULL_VP_SUBJECT, FULL_VP_YAW_OFF } from "../../full/vpAim";

/** göz yüksekliği (zemin üstü; birinci şahıs göz noktası, interiors/lookout.ts LOOK_EYE_Y ile aynı) ve hedefin bakılan yüksekliği payı */
export const VP_EYE = 0.91;
export const VP_AIM_FRAC = 0.55;

/** bakış ışını açıklığı — göz ışınları (orta + yatay ±VIEW_FAN_YAW, dikey ±VIEW_FAN_PITCH) ilk VIEW_OPEN_N m'de zeminden yüksek
 * geniş bir katı bloğa çarpmaz (<city> saray seyir noktası: kadraj 1 m ötedeki hanok duvarına yapışıyordu).*/
export const VIEW_OPEN_N = 3;
export const VIEW_FAN_YAW = 0.22;
export const VIEW_FAN_PITCH = 0.14;
const VIEW_MIN_SIDE = 0.5;
const VIEW_POLE_H = 1.2;
type Solid = { p: readonly number[]; s: readonly number[]; c: string };

/** Işın (göz, yön) ilk `n` m içinde zeminden yüksek geniş bir katı bloğa çarpıyor mu: en yakın çarpışma ya da null (saf, slab testi). */
export function viewRayHit(eye: readonly number[], dir: readonly number[], blocks: readonly Solid[], ground: number, n = VIEW_OPEN_N, poles = false): { d: number; b: Solid } | null {
  let best: { d: number; b: Solid } | null = null;
  for (const b of blocks) {
    // (`poles`): ince ama boylu direk/ağaç gövdesi (lamba, teleferik direği) kadraj ortasında durur: görünür kalınlığı ≥ VIEW_MIN_SIDE sayılır (yalnız kadraj-ortası denetimi; ilk 3 m kuralında ince direk engel değil)
    const pole = poles && Math.max(b.s[0], b.s[2]) < VIEW_MIN_SIDE && b.s[1] >= VIEW_POLE_H;
    if (b.p[1] + b.s[1] / 2 < ground + 0.45 || (Math.max(b.s[0], b.s[2]) < VIEW_MIN_SIDE && !pole)) continue;
    let t0 = 0.25, t1 = n;
    for (let a = 0; a < 3 && t0 <= t1; a++) {
      const w = pole && a !== 1 ? Math.max(b.s[a], VIEW_MIN_SIDE) : b.s[a];
      const lo = b.p[a] - w / 2 - eye[a], hi = b.p[a] + w / 2 - eye[a];
      if (Math.abs(dir[a]) < 1e-9) { if (lo > 0 || hi < 0) t0 = Infinity; continue; }
      let ta = lo / dir[a], tb = hi / dir[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    }
    if (t0 <= t1 && (!best || t0 < best.d)) best = { d: t0, b };
  }
  return best;
}

/** Bakış (yaw, eğim) için yelpaze ışınlarından en yakın çarpışma (yoksa null). */
export function viewFanHit(eye: readonly number[], yaw: number, pitch: number, blocks: readonly Solid[], ground: number, n = VIEW_OPEN_N, poles = false): { d: number; b: Solid } | null {
  let best: { d: number; b: Solid } | null = null;
  for (const [dy, dp] of [[0, 0], [-VIEW_FAN_YAW, 0], [VIEW_FAN_YAW, 0], [0, -VIEW_FAN_PITCH], [0, VIEW_FAN_PITCH]] as const) {
    const y = yaw + dy, p = pitch + dp, cp = Math.cos(p);
    const h = viewRayHit(eye, [Math.sin(y) * cp, Math.sin(p), Math.cos(y) * cp], blocks, ground, n, poles);
    if (h && (!best || h.d < best.d)) best = h;
  }
  return best;
}

/** Seyir karosunun çevresindeki yakın katı bloklar (aynı semt, ±1 parsel; çizimle aynı belirlenimci parseller). */
export function solidsAround(map: CityMapFile, tile: CityTile): Solid[] {
  const dist = districtAt(map, tile[0], tile[1]);
  if (!dist) return [];
  const cx = Math.floor(tile[0] / CITY_PW), cz = Math.floor(tile[1] / CITY_PD), out: Solid[] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const pc = districtParcel(map, dist, cx + dx, cz + dz);
    if (pc) for (const b of pc.near.blocks) if (b.g === "solid") out.push(b);
  }
  return out;
}

const cache = new WeakMap<CityMapFile, LandmarkViewTarget[]>();
function targetsOf(map: CityMapFile): LandmarkViewTarget[] {
  let t = cache.get(map);
  if (!t) { t = cityViewTargets(map).filter(viewableTarget); cache.set(map, t); }
  return t;
}

/**
 * Seyir karosu (şehir karosu) için bakış hedefi; haritada hiç görüntülenebilir simge yoksa null. Puan sırasındaki ilk hedef,
 * bakış ışını yelpazesi ilk VIEW_OPEN_N m'de açık olan hedeftir (en yüksek puanlı hedef duvara bakıyorsa sıradaki); hiçbiri açık değilse
 * en yüksek puanlı (veri denetimi `ceo_eye_walk.mjs` bunu yakalar: seyir noktası taşınmalı). `ground`: karonun zemini.
*/
export function cityVpTarget(map: CityMapFile, tile: CityTile, ground = 0): LandmarkViewTarget | null {
  const d = districtAt(map, tile[0], tile[1])?.id ?? null;
  const ranked: { t: LandmarkViewTarget; score: number }[] = [];
  for (const t of targetsOf(map)) {
    const rd = rectDist(tile[0], tile[1], t.rect);
    if (rd === 0) continue;
    ranked.push({ t, score: ((t.h ?? 4) / (3 + rd)) * (t.key.split(":")[1] === d ? 2 : 1) });
  }
  ranked.sort((a, b) => b.score - a.score || (a.t.key < b.t.key ? -1 : 1));
  if (!ranked.length) return null;
  const solids = solidsAround(map, tile), eye = [cityX(tile[0]), ground + VP_EYE, cityZ(tile[1])];
  for (const { t } of ranked) {
    const g = gazeAngles({ x: eye[0], y: eye[1], z: eye[2] }, targetPoint(t));
    if (!viewFanHit(eye, g.yaw, g.pitch, solids, ground)) return t;
  }
  return ranked[0].t;
}

/**
 * dürbünün (F, manzara kipi) hedefi — semtin SİMGESİ. `pickVpAim` birinci şahıs varış dönüşü içindir (kadraja sığan,
 * ilk 3 m'si açık hedef) ve dürbünde Taç yerine ay bahçesine, katedral yerine belediyeye, iğne kule yerine iskele tentesine bakıyordu;
 * dürbün kamerası hedefin çevresinde döndüğü için sığma şartı yok. Öne çıkma = yükseklik × açısal boy ≈ h² / (3 + karo uzaklığı), aynı semt
 * ×2, gözden tepeye doğru yakın katıya çarpıyorsa ×0,5; seyir karosunu içeren simge elenir. Varış dönüşünün hedefi (`pickVpAim`; VP_FOCUS,
 * su konusu dahil) en öne çıkanın en az yarısı kadar öne çıkıyorsa o kalır (dönüş ve dürbün aynı simgeyi gösterir). Saf hesap.
*/
export const VP_LOOK_KEEP = 0.5;
export function vpLookTarget(map: CityMapFile, tile: CityTile, ground = 0): LandmarkViewTarget | null {
  const turn = pickVpAim(map, tile, ground)?.target ?? null;
  if (turn && VP_FOCUS[`${map.id}:${tile[0]},${tile[1]}`] === turn.key) return turn;
  const d = districtAt(map, tile[0], tile[1])?.id ?? null;
  const all = solidsAround(map, tile), eye = [cityX(tile[0]), ground + VP_EYE, cityZ(tile[1])];
  let best: { t: LandmarkViewTarget; score: number } | null = null, turnScore = 0;
  const skip = VP_SKIP[`${map.id}:${tile[0]},${tile[1]}`];
  for (const t of targetsOf(map)) {
    if (skip?.includes(t.key)) continue;
    const rd = rectDist(tile[0], tile[1], t.rect);
    if (rd === 0) continue;
    const h = t.h ?? 4, c = targetPoint(t), dir = [c.x - eye[0], (t.y0 ?? 0) + h * 0.9 - eye[1], c.z - eye[2]], L = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const x0 = cityX(t.rect.i0) - 0.5, x1 = cityX(t.rect.i1) + 0.5, z0 = cityZ(t.rect.j0) - 0.5, z1 = cityZ(t.rect.j1) + 0.5;
    const blocked = viewRayHit(eye, dir.map((v) => v / L), all.filter((b) => !(b.p[0] >= x0 && b.p[0] <= x1 && b.p[2] >= z0 && b.p[2] <= z1)), ground, Math.max(1, L - 1.5));
    const score = ((h * h) / (3 + rd)) * (t.key.split(":")[1] === d ? 2 : 1) * (blocked ? 0.5 : 1);
    if (t.key === turn?.key) turnScore = score;
    if (!best || score > best.score || (score === best.score && t.key < best.t.key)) best = { t, score };
  }
  return turn && best && turnScore >= best.score * VP_LOOK_KEEP ? turn : best?.t ?? turn;
}

/** Hedefin merkezi (dünya x, y, z): yüksekliğin `VP_AIM_FRAC` payı (tepe ile taban kadrajda). */
export function targetPoint(t: LandmarkViewTarget): { x: number; y: number; z: number } {
  return { x: (cityX(t.rect.i0) + cityX(t.rect.i1)) / 2, y: (t.y0 ?? 0) + (t.h ?? 4) * VP_AIM_FRAC, z: (cityZ(t.rect.j0) + cityZ(t.rect.j1)) / 2 };
}

/** bilgi kartından "Git" ile seyir karosuna yürünürken kartın simgesi (varışta öncelikli bakış hedefi); yalnız o karo için geçerli.*/
export const vpPrefer: { tile: string | null; key: string | null } = { tile: null, key: null };

/** bakış çözümü. Hedef puanı çarpanları: görünürlük (göz → tepe ışını katıya çarpmaz), kadraja sığma (açısal boyut), kartın simgesi.*/
export const VP_FIT_H = 1.15; // yatay açısal yayılım üst sınırı (rad ≈ 66°; yatay görüş ≈ 80°)
export const VP_FIT_V = 0.62; // dikey (zeminden tepeye) üst sınır (rad ≈ 35°; dikey görüş ≈ 55°)
export const VP_CLUTTER_N = 6; // bakış ışınlarının açık kalması gereken mesafe (m = 6 karo; ağaç/direk/duvar kadraj ortasında durmasın; hedefin kendi blokları hariç)
export const VP_YAW_TRY = [0, 0.08, -0.08, 0.16, -0.16, 0.24, -0.24, 0.32, -0.32, 0.4, -0.4, 0.48, -0.48] as const; // ince adım, hedefin ±0,5 rad'ı içinde
export const VP_YAW_MAX = 0.5;
/** seyir karosunun anlatmak istediği simge (veri; puan ×4, ötekiler yakınsa aynı kadrajda kalır): Gize seyir noktası aslan gövdeli yapıtı gösterir.*/
export const VP_FOCUS: Readonly<Record<string, string>> = { ...FULL_VP_FOCUS };
/** simgenin seyir KONUSU (veri) — kimliği suyla olan simge (kordon, iskele, rıhtım, köprü, kayıkhane, fener…) seyir karesinde
 * suyla birlikte görünmeli (VIEW-FRAME-001 `waterMin`); yalnız palmiye ve fener görünen kordon "nehir" demez.*/
export const VP_SUBJECT: Readonly<Record<string, "water">> = Object.fromEntries([
  "londra:park:kayikhane", "istanbul:uskudar:kiz_kulesi", "istanbul:bogaz:bogaz_koprusu", "kapadokya:avanos:asma_kopru", ...FULL_VP_SUBJECT,
].map((k) => [k, "water" as const]));
/** bu seyir karosunda DÜRBÜN hedefi olmayacak simgeler (veri). <city> tepe istasyonu kulübesi 4 m'de en yüksek puanı alıp dürbünü
 * kendine çeviriyordu; seyir konusu deniz ve kıyıdır.*/
export const VP_SKIP: Readonly<Record<string, readonly string[]>> = { ...FULL_VP_SKIP };
/** seyir bakışının hedeften yatay sapması (rad, + = sağa; veri). Hedef kadrajda kalır ama göz hizası ona değil manzaraya bakar:
 * <city> tepesinde 4 m'deki istasyon kulübesi kadrajın tam ortasındaydı.*/
export const VP_YAW_OFF: Readonly<Record<string, number>> = { ...FULL_VP_YAW_OFF };
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** şehir karosu açık su mu (semtte çizilen açık su — köprü/ada altı değil; kıyı şehrinde semt ve varış meydanı dışı deniz).*/
export function vpWaterTile(map: CityMapFile, I: number, J: number): boolean {
  const d = districtAt(map, I, J);
  if (!d) return !!map.sea && !(I >= 0 && J >= 0 && I < GATE_W && J < GATE_D);
  const plan = districtPlan(map, d);
  return districtWater(map, d).open[(J - plan.j0) * plan.w + (I - plan.i0)] === 1;
}
/** Bakışın (yaw, eğim) 1. şahıs karesinde (62°, 16:10; 12 × 8 ışın) zemine suyun üstünde inen ışın payı (engel sayılmaz; kaba ölçü). */
export function vpWaterShare(map: CityMapFile, eye: readonly number[], yaw: number, pitch: number, fov = 62, aspect = 1.6): number {
  const th = Math.tan((fov * Math.PI) / 360), tw = th * aspect, cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = [Math.sin(yaw) * cp, sp, Math.cos(yaw) * cp], r = [Math.cos(yaw), 0, -Math.sin(yaw)], u = [-Math.sin(yaw) * sp, cp, -Math.cos(yaw) * sp];
  let n = 0;
  for (let yi = 0; yi < 8; yi++) for (let xi = 0; xi < 12; xi++) {
    const sx = ((xi + 0.5) / 12 * 2 - 1) * tw, sy = (1 - (yi + 0.5) / 8 * 2) * th;
    const dy = f[1] + u[1] * sy;
    if (dy > -1e-3) continue;
    const t = eye[1] / -dy;
    if (t > 160) continue;
    const x = eye[0] + (f[0] + r[0] * sx + u[0] * sy) * t, z = eye[2] + (f[2] + r[2] * sx + u[2] * sy) * t;
    if (vpWaterTile(map, Math.floor(x + 12), Math.floor(z + 8))) n++; // cityX(I) = I − 11,5
  }
  return n / 96;
}
/** Su konulu simgede denenen eğimler (yukarı bakan kare suyu alt kenarın altına itiyordu). */
export const VP_WATER_PITCHES = [0.12, 0.04] as const;

export interface VpAim { yaw: number; pitch: number; target: LandmarkViewTarget; second: LandmarkViewTarget | null; clear: boolean; visible: boolean }

/** seyir bakışı önbelleği (harita → karo/zemin/tercih → sonuç). Hesap saf ve semt başına 10–40 ms; figüran semt kaydı (bütün seyir
 * noktaları) ve seyir karosuna varış (CityRig) aynı sonucu yeniden hesaplıyordu. Dönen nesne paylaşılır — çağıran değiştirmez.*/
const aimCache = new WeakMap<CityMapFile, Map<string, VpAim | null>>();
/** Seyir karosunun bakışı: en iyi hedef (+ yakın ikincisi aynı kadrajda), kadraj ortasında engel yok. Saf hesap (önbellekli). */
export function pickVpAim(map: CityMapFile, tile: CityTile, ground = 0, preferKey: string | null = null, aspect?: number): VpAim | null {
  let m = aimCache.get(map);
  if (!m) { m = new Map(); aimCache.set(map, m); }
  const phone = aspect !== undefined && vpPhone(aspect) && !preferKey ? aspect : undefined; // kartın simgesi ("Git") istenirse o kalır
  // (…492): masaüstü karesi de sığma ölçüsünden geçer (tek 16:10 ölçüsü: bütün masaüstü en/boyları aynı hedef); kartın simgesi kalır
  const k = `${tile[0]},${tile[1]},${ground},${preferKey},${phone?.toFixed(3) ?? ""}`;
  let a = m.get(k);
  if (a === undefined) { a = computeVpAim(map, tile, ground, preferKey, phone); m.set(k, a); }
  return a;
}
function computeVpAim(map: CityMapFile, tile: CityTile, ground: number, preferKey: string | null, phone?: number): VpAim | null {
  const d = districtAt(map, tile[0], tile[1])?.id ?? null;
  preferKey ??= VP_FOCUS[`${map.id}:${tile[0]},${tile[1]}`] ?? null;
  const eye = [cityX(tile[0]), ground + VP_EYE, cityZ(tile[1])];
  const all = solidsAround(map, tile);
  const rows: { t: LandmarkViewTarget; score: number; yaw: number; pitch: number; blocked: boolean; near3?: boolean }[] = [];
  for (const t of targetsOf(map)) {
    const rd = rectDist(tile[0], tile[1], t.rect);
    if (rd === 0) continue;
    const x0 = cityX(t.rect.i0) - 0.5, x1 = cityX(t.rect.i1) + 0.5, z0 = cityZ(t.rect.j0) - 0.5, z1 = cityZ(t.rect.j1) + 0.5;
    const own = (b: Solid) => b.p[0] >= x0 && b.p[0] <= x1 && b.p[2] >= z0 && b.p[2] <= z1;
    const solids = all.filter((b) => !own(b));
    const c = targetPoint(t), top = { x: c.x, y: (t.y0 ?? 0) + (t.h ?? 4) * 0.9, z: c.z };
    const g = gazeAngles({ x: eye[0], y: eye[1], z: eye[2] }, c);
    const gt = gazeAngles({ x: eye[0], y: eye[1], z: eye[2] }, top);
    const dist = Math.hypot(top.x - eye[0], top.z - eye[2]);
    const dir = [top.x - eye[0], top.y - eye[1], top.z - eye[2]], L = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const blocked = viewRayHit(eye, dir.map((v) => v / L), solids, ground, Math.max(1, L - 1.5));
    const span = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([x, z]) => Math.abs(angDiff(Math.atan2(x - eye[0], z - eye[2]), g.yaw)));
    const fitH = Math.max(...span) * 2 <= VP_FIT_H, fitV = Math.atan2((t.h ?? 4) + (t.y0 ?? 0) - eye[1], Math.max(0.5, dist - Math.hypot(x1 - x0, z1 - z0) / 2)) <= VP_FIT_V;
    let score = ((t.h ?? 4) / (3 + rd)) * (t.key.split(":")[1] === d ? 2 : 1);
    const near3 = !!viewFanHit(eye, g.yaw, g.pitch, all, ground); /* ilk 3 m açık*/
    score *= (blocked ? 0.25 : 1) * (fitH && fitV ? 1 : 0.4) * (preferKey && t.key === preferKey && !blocked ? 4 : 1);
    rows.push({ t, score, yaw: g.yaw, pitch: gt.pitch * 0.5 + g.pitch * 0.5, blocked: !!blocked, near3 });
  }
  if (!rows.length) return null;
  if (rows.some((r) => !r.near3)) for (let k = rows.length - 1; k >= 0; k--) if (rows[k].near3) rows.splice(k, 1); // ilk 3 m'si kapalı hedefler yalnız hiçbiri açık değilse
  rows.sort((a, b) => b.score - a.score || (a.t.key < b.t.key ? -1 : 1));
  // önce en iyi hedef; kadraj ortası (ilk VP_CLUTTER_N m, hedefin kendi blokları hariç) kapalıysa sıradaki görünür hedefler denenir
  let fallback: VpAim | null = null, ok: VpAim | null = null, fit: VpAim | null = null;
  for (const first of rows.slice(0, 5)) {
    if (fallback && first.blocked) continue;
    const r = solve(first);
    fallback ??= r;
    if (!r.clear || !r.visible) continue;
    if (preferKey) return r; // kartın simgesi
    if (phone !== undefined) { // telefonda kareye sığan
      const f = vpFits(map, r, tile, ground, phone);
      // yakın kütle sınırını aşan ilk sığan hedef yerine yalnız AYNI semtin kütlesi sınırda simgesi (başka semtin uzak simgesine dönmez)
      if (f.ok && (f.mass <= VP_MASS_MAX ? !fit || (r.target.key.split(":")[1] === d && !VP_SUBJECT[r.target.key]) : false)) return r;
      if (f.ok) fit ??= r;
      ok ??= r;
      continue;
    }
    // (…492): masaüstünde ilk açık hedef yakın kütle sınırını aşıyorsa (pergola çatısı, kafe cephesi, sur duvarı kadrajı
    // dolduruyor) AYNI semtin kareye sığan öteki simgesi; yoksa eski seçim (kalan durum seyir karosu yeriyle çözülür: VP-MASS-001)
    if (!ok) { ok = r; if (vpFits(map, r, tile, ground, VP_DESK_ASPECT).mass <= VP_MASS_MAX) return r; continue; }
    if (r.target.key.split(":")[1] === d && !VP_SUBJECT[r.target.key] && vpFits(map, r, tile, ground, VP_DESK_ASPECT).ok) return r; // su konulu simge kendi ölçüsüyle (VIEW-FRAME waterMin)
  }
  return fit ?? ok ?? fallback; // hiçbir hedef sığmazsa eski seçim

  function solve(first: (typeof rows)[number]): VpAim {
    const sec = rows.find((r) => r !== first && r.score >= first.score * 0.5 && Math.abs(angDiff(r.yaw, first.yaw)) <= 0.8) ?? null;
    let yaw = first.yaw, pitch = first.pitch;
    if (sec) { yaw = first.yaw + angDiff(sec.yaw, first.yaw) / 2; pitch = (first.pitch + sec.pitch) / 2; }
    pitch = Math.max(-0.05, Math.min(0.35, pitch));
    const off = VP_YAW_OFF[`${map.id}:${tile[0]},${tile[1]}`] ?? 0; // veri sapması
    yaw += off;
    // kadraj ortasında ağaç/duvar yok: bakışı küçük adımlarla kaydır (öncelikli hedef kadrajda kalır); yalnız bakılan hedeflerin blokları hariç
    const owned = [first.t, sec?.t].filter((t): t is LandmarkViewTarget => !!t);
    const stand = all.filter((b) => !owned.some((t) => {
      const x0 = cityX(t.rect.i0) - 0.5, x1 = cityX(t.rect.i1) + 0.5, z0 = cityZ(t.rect.j0) - 0.5, z1 = cityZ(t.rect.j1) + 0.5;
      return b.p[0] >= x0 && b.p[0] <= x1 && b.p[2] >= z0 && b.p[2] <= z1;
    }));
    // seyir konusu su — hedef kadrajda kalırken (±VP_YAW_MAX) suyu en çok gösteren bakış (ilk 3 m kuralı bozulmaz)
    if (VP_SUBJECT[first.t.key] === "water") {
      let w = { yaw, pitch, s: vpWaterShare(map, eye, yaw, pitch) };
      for (const p of [pitch, ...VP_WATER_PITCHES.filter((q) => q < pitch)]) for (const o of VP_YAW_TRY) {
        const y = first.yaw + o;
        if (viewFanHit(eye, y, p, all, ground) || viewFanHit(eye, y, p, stand, ground, VP_CLUTTER_N, true)) continue; // kadraj ortası da açık
        const ws = vpWaterShare(map, eye, y, p);
        if (ws > w.s + 0.02) w = { yaw: y, pitch: p, s: ws };
      }
      if (w.yaw !== yaw || w.pitch !== pitch) return { yaw: w.yaw, pitch: w.pitch, target: first.t, second: sec?.t ?? null, clear: true, visible: !first.blocked };
    }
    let best = { yaw, d: -1 }, clear = false;
    for (const y of [...VP_YAW_TRY.map((o) => yaw + o), first.yaw + off, first.yaw + off + 0.12, first.yaw + off - 0.12]) {
      if (Math.abs(angDiff(y, first.yaw + off)) > VP_YAW_MAX) continue;
      if (viewFanHit(eye, y, pitch, all, ground)) continue; // ilk 3 m kuralı bozulmaz
      const h = viewFanHit(eye, y, pitch, stand, ground, VP_CLUTTER_N, true);
      if (!h) { best = { yaw: y, d: Infinity }; clear = true; break; }
      if (h.d > best.d) best = { yaw: y, d: h.d };
    }
    return { yaw: best.yaw, pitch, target: first.t, second: sec?.t ?? null, clear, visible: !first.blocked };
  }
}

/** GATEFIX2: bakışı ekranın en/boyuna sığdır — pickVpAim hedefi ±VP_YAW_MAX kaydırabilir; dikey telefonda (375 × 812, yatay yarı açı
 *  ≈ 0,35 rad) bu hedefi kadraj dışına iter. Hedef merkezi, en dar açının (varsayılan ayar, Hor+ tabanı) yarısından VP_FIT_MARGIN içeride kalır. */
export const VP_FIT_MARGIN = 0.06;
export function fitVpYaw(aim: VpAim, tile: CityTile, aspect: number): number {
  const hh = Math.atan(Math.tan((walkFov(WALK_FOV_DEFAULT, aspect) * Math.PI) / 360) * aspect) - VP_FIT_MARGIN;
  const c = targetPoint(aim.target), ty = Math.atan2(c.x - cityX(tile[0]), c.z - cityZ(tile[1])), o = angDiff(aim.yaw, ty);
  return Math.abs(o) <= hh ? aim.yaw : ty + Math.sign(o) * hh;
}
/** FIXPACK-B: ekrana sığdırılmış bakış (yaw, eğim). Dikey ekranda su konulu seyirde fitVpYaw hedefi kadraja çekerken suyu
 * kadrajdan atıyordu (11 seyir noktası, su %0–3): hedef merkezi yatay yarı açının içinde kalan bakışlardan dikey karede suyu en çok
 * gösteren seçilir (ilk 3 m kuralı bozulmaz). Yatay ekranda ve su konusu olmayan seyirde fitVpYaw + pickVpAim eğimi.*/
export function fitVpAim(map: CityMapFile, aim: VpAim, tile: CityTile, ground: number, aspect: number): { yaw: number; pitch: number } {
  const yaw = fitVpYaw(aim, tile, aspect);
  if (aspect >= 1 || VP_SUBJECT[aim.target.key] !== "water") return vpUnfill(map, aim, tile, ground, aspect, { yaw, pitch: aim.pitch });
  const fov = walkFov(WALK_FOV_DEFAULT, aspect), hh = Math.atan(Math.tan((fov * Math.PI) / 360) * aspect) - VP_FIT_MARGIN;
  const c = targetPoint(aim.target), eye = [cityX(tile[0]), ground + VP_EYE, cityZ(tile[1])], ty = Math.atan2(c.x - eye[0], c.z - eye[2]);
  const all = solidsAround(map, tile);
  let best = { yaw, pitch: aim.pitch, s: vpWaterShare(map, eye, yaw, aim.pitch, fov, aspect) };
  for (const p of [aim.pitch, ...VP_WATER_PITCHES]) for (let k = -6; k <= 6; k++) {
    const y = ty + (hh * k) / 6;
    if (viewFanHit(eye, y, p, all, ground)) continue;
    const s = vpWaterShare(map, eye, y, p, fov, aspect);
    if (s > best.s + 0.02) best = { yaw: y, pitch: p, s };
  }
  return vpUnfill(map, aim, tile, ground, aspect, { yaw: best.yaw, pitch: best.pitch });
}
/** figüran seyir kaması girdisi (FiguransLayer = arrival_check figuranBlocks). Masaüstü bakışı bugünkü kamayı kurar (ilgi noktalarını
 * kaydırır); telefon bakışı (dikey 0,46 / yatay 2,16) masaüstünden ayrılıyorsa yalnız ELEYEN ön kama (`front`: komşu noktalar kaymaz,
 * başka ölçülen kareye figüran taşınmaz — düz anahtarlar rota karelerini kötüleştirdi).*/
export const VP_AVOID_PHONE = [0.46, 2.16] as const;
export function vpAvoidAims(map: CityMapFile, tile: CityTile, ground = 0): { tile: CityTile; yaw: number; front?: boolean }[] {
  const a = pickVpAim(map, tile, ground);
  if (!a) return [];
  const out: { tile: CityTile; yaw: number; front?: boolean }[] = [{ tile, yaw: fitVpAim(map, a, tile, ground, VP_DESK_ASPECT).yaw }]; // masaüstü bakışı da yakın kütle aramasından sonra
  for (const asp of VP_AVOID_PHONE) {
    const p = pickVpAim(map, tile, ground, null, asp);
    const yaw = p ? fitVpAim(map, p, tile, ground, asp).yaw : null;
    if (yaw !== null && Math.abs(angDiff(yaw, out[0].yaw)) > 1e-3) out.push({ tile, yaw, front: true });
  }
  return out;
}
/** FIXPACK-B: seyir karosuna varışta bakış yeniden kurulur mu. Önceki seyir karosundan doğrudan (ışınlama, hızlı yolculuk,
 * geri dönüş) gelen oyuncu da yeni karonun hedefine döner; eskiden yalnız seyir kipine GİRİŞTE kuruluyordu (B, A'nın yaw'ını miras alıp duvara bakıyordu).*/
export function vpReaim(prev: { district: string; n: number } | null, district: string, n: number): boolean {
  return !prev || prev.district !== district || prev.n !== n;
}
const screenAspect = () => (typeof window !== "undefined" && window.innerWidth > 0 && window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 1.6);

/**
 * telefonda (dikey ≈ 0,46–0,56, yatay ≈ 2,16) birinci şahıs karesi Hor+ ile dikeyde geniş (≈ 77°): yakın ve büyük hedef
 * (<city> kaya geçidi, <city> kubbe revakı, <city> pazar holü) 14 m içinde karenin üçte birini aşan düz duvar / çatı kirişi oluyordu (eğim 0,35).
 * Telefonda hedefin kutusu 14 m içinde karenin VP_FILL_MAX'ından fazlasını kaplıyorsa bakış yana (hedef kadraj kenarında, karenin geri kalanı
 * manzara) ve gerekirse ufka döner (`vpUnfill`, fitVpAim sonunda). Masaüstü (1 … VP_PHONE_WIDE) değişmez. Gate: ceo_eye_walk VIEW-FRAME-001 "dolduruyor" dikey/yatay telefonda da.
*/
export const VP_FILL_M = 14;
export const VP_FILL_MAX = 0.27; // ceo_eye_walk FRAME.fillMax 0,3 (oyun orta ayrıntı modeli ±1 parsel ölçer; küçük pay)
export const VP_FP_FOV = 62; // WalkRig FP_FOV (birinci şahıs açısı; Hor+ tabanıyla walkFov)
/** yatay telefon (812 × 375 ≈ 2,16) bu en/boydan geniş; 1 … VP_PHONE_WIDE masaüstü/tablet */
export const VP_PHONE_WIDE = 1.9;
export const vpPhone = (aspect: number) => aspect < 1 || aspect >= VP_PHONE_WIDE;
type FB = { p: readonly number[]; s: readonly number[]; g?: string };
const lmBlocks = new Map<string, FB[]>();
/** Hedef simgenin görünen (orta ayrıntı) model blokları — ceo_eye_walk frameBlocks ile aynı yerleşim; simge değilse kutusu. */
function vpTargetBlocks(map: CityMapFile, t: LandmarkViewTarget, vis = false): FB[] {
  let out = lmBlocks.get(`${map.id}|${t.key}|${vis}`);
  if (out) return out;
  const [, did, lid] = t.key.split(":"), dist = map.districts.find((d) => d.id === did), model = dist ? landmarkModel(map.id, lid) : null;
  const plan = dist ? districtPlan(map, dist) : null, lm = plan?.landmarks.find((l) => l.id === lid);
  if (plan && lm && model) {
    const ox = cityX(plan.i0) - 0.5 + lm.i0, oz = cityZ(plan.j0) - 0.5 + lm.j0;
    const ctx = { x0: ox, z0: oz, w: lm.w, d: lm.d, h: lm.h, cx: ox + lm.w / 2, cz: oz + lm.d / 2 };
    // bakılan hedef çizilen modeliyle (yüksek çözünürlük kayıtlıysa o; vp_near_check ile aynı) — orta model yakın simgeyi
    // küçük ölçüyordu (<city> dikey bahçe telefonda oyun %15, çizilen %31). Komşu simgeler orta modelle (ucuz).
    out = (vis ? landmarkVisual(map.id, lid, model, ctx) : model.near(ctx)).filter((b) => b.g !== "glow" && b.g !== "water");
  } else out = [{ p: [(cityX(t.rect.i0) + cityX(t.rect.i1)) / 2, (t.y0 ?? 0) + (t.h ?? 4) / 2, (cityZ(t.rect.j0) + cityZ(t.rect.j1)) / 2], s: [cityX(t.rect.i1) - cityX(t.rect.i0) + 1, t.h ?? 4, cityZ(t.rect.j1) - cityZ(t.rect.j0) + 1] }];
  lmBlocks.set(`${map.id}|${t.key}|${vis}`, out);
  return out;
}
function slab(eye: readonly number[], d: readonly number[], b: FB, tmax: number): number {
  let t0 = 0.12, t1 = tmax;
  for (let a = 0; a < 3 && t0 <= t1; a++) {
    const lo = b.p[a] - b.s[a] / 2 - eye[a], hi = b.p[a] + b.s[a] / 2 - eye[a];
    if (Math.abs(d[a]) < 1e-9) { if (lo > 0 || hi < 0) return Infinity; continue; }
    let ta = lo / d[a], tb = hi / d[a]; if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  return t0 <= t1 ? t0 : Infinity;
}
/** Birinci şahıs karesinin ölçüsü (ceo_eye_walk vpFrameStats'ın ikizi, 12 × 16 ışın): `fill` hedefin VP_FILL_M içinde kapladığı pay, `seen`
 *  hedefin görünen payı (önünde başka katı yok), `core` kadraj ortasının (orta üçte bir × orta yarı) VP_CORE_M içinde başka katıyla kapalı payı. */
export function vpFrame(eye: readonly number[], yaw: number, pitch: number, own: readonly FB[], others: readonly FB[], ground: number, aspect: number, extra: readonly FB[] = []): { fill: number; seen: number; core: number; mass: number } {
  const th = Math.tan((walkFov(VP_FP_FOV, aspect) * Math.PI) / 360), tw = th * aspect, cp = Math.cos(pitch);
  const f = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp], r = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const NX = 12, NY = 16;
  let fill = 0, seen = 0, core = 0, coreN = 0, mass = 0;
  for (let yi = 0; yi < NY; yi++) for (let xi = 0; xi < NX; xi++) {
    const sx = ((xi + 0.5) / NX * 2 - 1) * tw, sy = (1 - (yi + 0.5) / NY * 2) * th;
    const d = [f[0] + r[0] * sx + u[0] * sy, f[1] + r[1] * sx + u[1] * sy, f[2] + r[2] * sx + u[2] * sy], L = Math.hypot(d[0], d[1], d[2]);
    d[0] /= L; d[1] /= L; d[2] /= L;
    let tOwn = Infinity, tOth = Infinity;
    for (const b of own) { if (b.p[1] + b.s[1] / 2 < ground + 0.45) continue; const t = slab(eye, d, b, tOwn); if (t < tOwn) tOwn = t; }
    for (const b of others) { if (b.p[1] + b.s[1] / 2 < ground + 0.45) continue; const t = slab(eye, d, b, Math.min(tOth, tOwn)); if (t < tOth) tOth = t; }
    const inCore = Math.abs(xi + 0.5 - NX / 2) <= NX / 6 && Math.abs(yi + 0.5 - NY / 2) <= NY / 4;
    if (inCore) { coreN++; if (tOth < VP_CORE_M && tOth < tOwn) core++; }
    if (tOwn < tOth) { seen++; if (tOwn < VP_FILL_M) fill++; }
    // yakın kütle — göz hizasını aşan (tepesi ≥ zemin + VP_MASS_TOP) her katı, hedef dahil (ağaç tacı, öteki simgelerin görünen modeli de);
    // bank/saksı/korkuluk gibi göz altı donatı manzarayı kapatmaz, ışın üstünden geçer
    let tEx = VP_FILL_M;
    for (const L of [own, others, extra]) for (const b of L) { if (b.p[1] + b.s[1] / 2 < ground + VP_MASS_TOP) continue; const t = slab(eye, d, b, tEx); if (t < tEx) tEx = t; }
    if (tEx < VP_FILL_M && Math.abs(xi + 0.5 - NX / 2) <= NX / 3) mass++; // orta 2/3 sütun: sokak kanyonunun yan cepheleri manzarayı kapatmaz
  }
  return { fill: fill / (NX * NY), seen: seen / (NX * NY), core: core / Math.max(1, coreN), mass: mass / ((NX * 2) / 3 * NY) };
}
const VP_FILL_PITCHES = [0.24, 0.16, 0.08, 0] as const;
/** Telefonda seçilebilir hedef: sığdırılmış bakışta 14 m içinde ≤ VP_FILL_MAX ve kutusu karenin en az VP_SEEN_MIN'ini kaplar (görünür boyda). */
export const VP_SEEN_MIN = 0.04;
export function vpFits(map: CityMapFile, a: VpAim, tile: CityTile, ground: number, aspect: number): { ok: boolean; mass: number } {
  const eye = [cityX(tile[0]), ground + VP_EYE, cityZ(tile[1])], v = fitVpAim(map, a, tile, ground, aspect);
  const fr = vpFrame(eye, v.yaw, v.pitch, vpTargetBlocks(map, a.target, true), vpStand(map, tile, a.target), ground, aspect, vpMassExtra(map, tile, a.target));
  if (fr.fill > VP_FILL_MAX || (!vpPhone(aspect) && fr.mass > VP_MASS_MAX) || fr.seen < VP_SEEN_MIN || fr.core > VP_CORE_MAX) return { ok: false, mass: fr.mass }; // duvar gibi doldurur / görünmez / kadraj ortası kapalı
  const water = ![a.target.key, a.second?.key].some((k) => k && VP_SUBJECT[k] === "water") || vpWaterShare(map, eye, v.yaw, v.pitch, walkFov(VP_FP_FOV, aspect), aspect) >= 0.05; // su konusu kadrajda
  return { ok: water, mass: fr.mass };
}
export const VP_CORE_M = 8, VP_CORE_MAX = 0.2; // ceo_eye_walk FRAME.coreM 8 / coreMax 0,25
/** (…492): karenin VP_FILL_M içinde HERHANGİ bir katıyla (hedef dahil: pergola çatısı, kafe cephesi, sur duvarı) kaplı payı
 * (yakın kütle) en çok bu; vp_near_check VP-MASS-001 0,28 (oyun ±1 parsel ölçer; küçük pay). Masaüstü ölçüsü 16:10 karesinde.*/
export const VP_MASS_MAX = 0.2;
export const VP_MASS_TOP = 1.2;
export const VP_DESK_ASPECT = 1.6;

/** Hedefin kendi ayak izi dışındaki katılar (kadraj ortası / önünü kapatma ölçüsü). */
function vpStand(map: CityMapFile, tile: CityTile, t: LandmarkViewTarget): Solid[] {
  const x0 = cityX(t.rect.i0) - 0.5, x1 = cityX(t.rect.i1) + 0.5, z0 = cityZ(t.rect.j0) - 0.5, z1 = cityZ(t.rect.j1) + 0.5;
  return solidsAround(map, tile).filter((b) => !(b.p[0] >= x0 && b.p[0] <= x1 && b.p[2] >= z0 && b.p[2] <= z1));
}
/** yakın kütle ölçüsünün ek blokları — ±1 parselin `solid` dışı görünen blokları (ağaç tacı, tente, cam) ve 30 m içindeki ÖTEKİ
 * simgelerin görünen modeli (vp_near_check VP-MASS-001 ceo_eye_walk frameBlocks ile ölçer); hedefin ayak izi hariç.*/
const VP_MASS_SKIP = new Set(["solid", "water", "wave", "cloud", "snow", "flame", "flag", "glow"]);
const massCache = new WeakMap<CityMapFile, Map<string, FB[]>>();
function vpMassExtra(map: CityMapFile, tile: CityTile, t: LandmarkViewTarget): FB[] {
  let m = massCache.get(map);
  if (!m) { m = new Map(); massCache.set(map, m); }
  const k = `${tile[0]},${tile[1]}|${t.key}`;
  let out = m.get(k);
  if (out) return out;
  const x0 = cityX(t.rect.i0) - 0.5, x1 = cityX(t.rect.i1) + 0.5, z0 = cityZ(t.rect.j0) - 0.5, z1 = cityZ(t.rect.j1) + 0.5;
  const ex = cityX(tile[0]), ez = cityZ(tile[1]), outside = (b: FB) => !(b.p[0] >= x0 && b.p[0] <= x1 && b.p[2] >= z0 && b.p[2] <= z1);
  out = [];
  const own = districtAt(map, tile[0], tile[1]), cx = Math.floor(tile[0] / CITY_PW), cz = Math.floor(tile[1] / CITY_PD);
  for (const dist of map.districts) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { // komşu semtin parselleri de (semt sınırındaki seyir karosu)
    const pc = districtParcel(map, dist, cx + dx, cz + dz);
    if (pc) for (const b of pc.near.blocks) if ((dist !== own || b.g !== "solid") && (b.g === "solid" || !VP_MASS_SKIP.has(b.g ?? "")) && outside(b)) out.push(b);
  }
  for (const o of targetsOf(map)) {
    if (o.key === t.key) continue;
    const c = targetPoint(o);
    if (Math.hypot(c.x - ex, c.z - ez) - Math.hypot(cityX(o.rect.i1) - cityX(o.rect.i0), cityZ(o.rect.j1) - cityZ(o.rect.j0)) / 2 > VP_FILL_M + 4) continue;
    for (const b of vpTargetBlocks(map, o)) if (outside(b)) out.push(b);
  }
  m.set(k, out);
  return out;
}
/** Telefonda hedef kareyi dolduruyorsa: önce yana (hedef merkezi yatay yarı açının içinde, kadraj kenarına doğru; tepe kesilmez), sonra ufka
 * doğru eğim; ilk 3 m kuralı bozulmaz. En küçük değişiklik; hiçbiri sığmazsa en az dolduran.
 * her en/boyda (masaüstü dahil) kadraj ortası yakın kütleyle doluysa (VP_MASS_MAX; yakın büyük simge, pergola, sur)
 * aynı arama yakın kütleyi de indirir: hedef kadrajda kalır, bakış yana ve gerekirse yukarı (VP_MASS_PITCHES, simgenin tepesi/gök) döner.*/
export const VP_MASS_PITCHES = [0.3, 0.38, 0.45] as const;
/** yana dönüş adımları (yatay yarı açının dörtte biri; 0 = sığdırılmış bakış) */
const VP_UNFILL_STEPS = [0, 1, -1, 2, -2, 3, -3, 4, -4] as const;
/** bakış orta bandında (yatay ±%30, dikey ±%40; varsayılan açı) 14 m içinde plan ağacı tacı var mı — vp_near_check VP-NEAR-002 ağaç ölçüsünün
 * oyundaki ikizi: yakın kütleyi indiren arama ağacı kadraj ortasına getirmez.*/
function vpTreeInBand(map: CityMapFile, tile: CityTile, ground: number, yaw: number, pitch: number, aspect: number): boolean {
  const d0 = districtAt(map, tile[0], tile[1]);
  if (!d0) return false;
  const plan = districtPlan(map, d0), eye = [cityX(tile[0]), ground + VP_EYE, cityZ(tile[1])];
  const th = Math.tan((walkFov(WALK_FOV_DEFAULT, aspect) * Math.PI) / 360), tw = th * aspect;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fwd = [sy * cp, sp, cy * cp], right = [cy, 0, -sy], up = [-sy * sp, cp, -cy * sp];
  for (let j = Math.max(plan.j0, tile[1] - 15); j <= Math.min(plan.j0 + plan.d - 1, tile[1] + 15); j++) for (let i = Math.max(plan.i0, tile[0] - 15); i <= Math.min(plan.i0 + plan.w - 1, tile[0] + 15); i++) {
    const k = (j - plan.j0) * plan.w + (i - plan.i0);
    if (plan.kind[k] !== T_TREE) continue;
    const d = [cityX(i) - eye[0], (plan.lift[k] ?? 0) + 2.05 - eye[1], cityZ(j) - eye[2]], z = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2];
    if (z < 0.5 || Math.hypot(d[0], d[1], d[2]) > 14) continue;
    const x = d[0] * right[0] + d[2] * right[2], hw = 0.5 / z, y0 = (d[0] * up[0] + d[1] * up[1] + d[2] * up[2] - 0.65) / z, y1 = y0 + 1.3 / z;
    if (Math.abs(x / z) - hw <= 0.3 * tw && y1 >= -0.4 * th && y0 <= 0.4 * th) return true;
  }
  return false;
}
const unfillCache = new WeakMap<CityMapFile, Map<string, { yaw: number; pitch: number }>>();
function vpUnfill(map: CityMapFile, aim: VpAim, tile: CityTile, ground: number, aspect: number, v: { yaw: number; pitch: number }): { yaw: number; pitch: number } {
  if (VP_SUBJECT[aim.target.key] === "water") return v; // su konusu (fitVpAim) değişmez
  if (!vpPhone(aspect) && aspect !== VP_DESK_ASPECT) { // masaüstü en/boyları tek 16:10 ölçüsü; bakış en/boya sığdırılır
    const d = vpUnfill(map, aim, tile, ground, VP_DESK_ASPECT, { yaw: fitVpYaw(aim, tile, VP_DESK_ASPECT), pitch: v.pitch });
    return { yaw: fitVpYaw({ ...aim, yaw: d.yaw }, tile, aspect), pitch: d.pitch };
  }
  let cm = unfillCache.get(map);
  if (!cm) { cm = new Map(); unfillCache.set(map, cm); }
  const ck = `${tile[0]},${tile[1]},${ground},${aspect.toFixed(3)},${aim.target.key},${v.yaw.toFixed(4)},${v.pitch.toFixed(4)}`;
  const hit = cm.get(ck);
  if (hit) return hit;
  const phone = vpPhone(aspect);
  const eye = [cityX(tile[0]), ground + VP_EYE, cityZ(tile[1])], own = vpTargetBlocks(map, aim.target, true), stand = vpStand(map, tile, aim.target), extra = vpMassExtra(map, tile, aim.target);
  // shortcut: yatay telefonda (≥ VP_PHONE_WIDE) yalnız doldurma — VP-MASS-001 16:10 ve dikeyi ölçer; geniş karede yakın kütle araması komşu semtin
  // figüran kamasına bakıyordu (<city> nehir → meydan). Komşu semt kaması figür katmanına girince yatayda da açılır.
  const wide = aspect >= VP_PHONE_WIDE;
  const over = (fr: { fill: number; mass: number }) => (phone ? Math.max(0, fr.fill - VP_FILL_MAX) : 0) + (wide ? 0 : Math.max(0, fr.mass - VP_MASS_MAX));
  const f0 = vpFrame(eye, v.yaw, v.pitch, own, stand, ground, aspect, extra);
  let out = v;
  if (over(f0) > 0) {
    const hh = Math.atan(Math.tan((walkFov(WALK_FOV_DEFAULT, aspect) * Math.PI) / 360) * aspect) - VP_FIT_MARGIN;
    const c = targetPoint(aim.target), ty = Math.atan2(c.x - eye[0], c.z - eye[2]), all = solidsAround(map, tile);
    let best = { ...v, o: over(f0) };
    const trees0 = vpTreeInBand(map, tile, ground, v.yaw, v.pitch, aspect);
    const pitches = [v.pitch, ...VP_FILL_PITCHES.filter((q) => q < v.pitch), ...VP_MASS_PITCHES.filter((q) => q > v.pitch)];
    search: for (const k of VP_UNFILL_STEPS) for (const p of pitches) {
      const y = k === 0 ? v.yaw : ty + (hh * k) / 4;
      if ((k === 0 && p === v.pitch) || viewFanHit(eye, y, p, all, ground)) continue; // ilk 3 m açık
      const fr = vpFrame(eye, y, p, own, stand, ground, aspect, extra);
      if (fr.core > VP_CORE_MAX || fr.seen < VP_SEEN_MIN) continue; // kadraj ortası açık, hedef görünür
      if (trees0 === false && vpTreeInBand(map, tile, ground, y, p, aspect)) continue; // ağaç kadraj ortasına girmez (VP-NEAR-002)
      const o = over(fr);
      if (o <= 0) { out = { yaw: y, pitch: p }; break search; }
      if (o < best.o) best = { yaw: y, pitch: p, o };
    }
    if (out === v) out = { yaw: best.yaw, pitch: best.pitch };
  }
  cm.set(ck, out);
  return out;
}
/** oyunun seyir karesi ölçüsü (son bakış ve kendi yakın kütle / doldurma ölçüsü; denetim ve test için).*/
export function vpAimFrame(map: CityMapFile, tile: CityTile, ground: number, aspect: number, at?: { yaw: number; pitch: number }): { yaw: number; pitch: number; key: string; fill: number; mass: number; core: number; seen: number } | null {
  const a = pickVpAim(map, tile, ground, null, aspect);
  if (!a) return null;
  const v = at ?? fitVpAim(map, a, tile, ground, aspect), eye = [cityX(tile[0]), ground + VP_EYE, cityZ(tile[1])];
  return { ...v, key: a.target.key, ...vpFrame(eye, v.yaw, v.pitch, vpTargetBlocks(map, a.target, true), vpStand(map, tile, a.target), ground, aspect, vpMassExtra(map, tile, a.target)) };
}
/** Seyir karosuna varış: hedefe dönüşü başlatır (WalkRig yumuşak uygular). Hedef yoksa false. `ground`: karonun zemini. */
export function aimAtViewpoint(map: CityMapFile, tile: CityTile, ground = 0, aspect = screenAspect()): LandmarkViewTarget | null {
  const k = `${map.id}:${tile[0]},${tile[1]}`;
  const prefer = vpPrefer.tile === k ? vpPrefer.key : null;
  if (vpPrefer.tile === k) { vpPrefer.tile = null; vpPrefer.key = null; }
  const a = pickVpAim(map, tile, ground, prefer, aspect); // telefonda kareye sığan hedef
  if (!a) return null;
  const v = fitVpAim(map, a, tile, ground, aspect);
  startViewTurn(v.yaw, v.pitch, k);
  return a.target;
}
