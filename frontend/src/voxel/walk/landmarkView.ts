/**
 * "Manzara" kipi: yürüme modunda kamera bir simge yapıyı tepesi ve tabanı kadrajda kalacak biçimde çerçeveler.
 *
 * Akış (WalkRig uygular; bu dosya saf hesap + küçük durum):
 * - Tetik: `L` (WalkRig'in pencere dinleyicisi) ya da `startLandmarkView(hedef)` (bilgi kartının "Manzara" düğmesi).
 * - Hedef sırası: verilen hedef → açık bilgi kartı (`landmarkViewSources.card`) → bakılan simge (kamera yaw'ı doğrultusunda,
 * `VIEW_LOOK_RANGE` karo) → en yakın simge (`VIEW_NEAR_RANGE` karo, Chebyshev). Sahnede simge bölgeleri (`zone.kind ===
 * "landmark"`), şehir haritasında semt planlarının landmark ayak izleri. İç mekânda hedef yok.
 * - Çerçeve: simgenin dünya kutusu (ayak izindeki gerçek bloklardan; yoksa plan yüksekliği). Bakış noktası kutunun merkezi;
 * kamera yaw + yükseliş (`VIEW_ELEVS`) ile kutunun 8 köşesi görüş açısının `VIEW_MARGIN` payına sığana dek uzaklaşır
 * (`fitDist`, ikiye bölme; belgedeki "tepe / tan(FOV/2) × 1,2"nin genel hâli; en/boy oranı ve dar ekran dahil).
 * - Örtücü kaçınma: 16 yaw × 2 yükseliş adayı; her aday kesit planının aynı yoklamalarıyla (`viewProbes`: simgenin kameraya bakan
 * yüzünün hemen dışındaki taban, tepe ve iki yan nokta → kamera) puanlanır. Kesilemeyen zemin/arazi bloğu (merkezi `minY`
 * altında) doğruyu kesiyorsa aday elenir; kesilebilir örtücü sayısı + avatarın arkasından bakma tercihi puanı belirler.
 * - Kesit (çalışırken): `viewCutPlan` — sokak kesitiyle aynı birimler (`writeCutPlan`): yoklama → kamera doğrularını kesen
 * bloklar bütün olarak açılır, kamera kabarcığı; simgenin kendi blokları hiçbir doğruda değildir (yoklamalar kutunun dışında).
 * - Hareket: yavaş sağa-sola yörünge (±`VIEW_SWING`, `VIEW_PERIOD` sn), uzaklık salınımın bütün yaw'larında sığar. Hareket
 * azaltmada sabit çerçeve, geçişler kesme. Avatar yerinde kalır; hareket girdisi, zıplama, tıkla-git, fotoğraf, görünüm
 * değişimi, Esc ya da `L` kipten çıkarır; kamera takip pozuna yumuşak döner.
 *
 * Denetim: `frontend/scripts/landmark_view.test.mjs` (128 şehir simgesi + sahne simgeleri; tepe ve taban kadrajda, tam örtülme
 * yok, simgenin kendi blokları kesilmiyor).
*/
import { create } from "zustand";
import { tx, tz, type Built } from "../scenes";
import { gateMapOf } from "../citymap/shell";
import { districtParcel, districtPlan } from "../citymap/district";
import { parcelDistrict } from "../citymap/source";
import { designOf } from "../citymap/designs";
import { cityX, cityZ } from "../transit/model";
import { CITY_PD, CITY_PW, type CityMapFile } from "../citymap/format";
import { isInteriorBuilt } from "../interiors/store";
import { CAM_BUBBLE, OPEN_MIN_Y, segmentHitsBox, type CutPlan } from "./cover";
import { pointBlocked, sweepArm, type BoxSource } from "../camera/collide";
import { useWalkStore } from "./walkStore";

type V3 = [number, number, number];

// ------------------------------------------------------------------------------------------ sabitler
/** bakılan simge: kamera yaw'ı doğrultusunda en çok bu kadar karo; en yakın simge: Chebyshev bu kadar karo */
export const VIEW_LOOK_RANGE = 25;
export const VIEW_NEAR_RANGE = 12;
/** bir simge ayak izinin en büyük alanı (karo²); semt kartı gibi geniş hedefler manzara değil */
export const VIEW_MAX_AREA = 400;
/** köşelerin görüş açısı payı (1 = kenara değer); dikey ve yatay */
export const VIEW_MARGIN_V = 0.82;
export const VIEW_MARGIN_H = 0.86;
/** kamera yükselişleri (rad; bakış noktasından) */
export const VIEW_ELEVS = [0.22, 0.42] as const;
export const VIEW_YAWS = 16;
/** yörünge salınımı (rad) ve periyodu (sn); giriş kayması (ms) */
export const VIEW_SWING = 0.3;
export const VIEW_PERIOD = 30;
export const VIEW_ENTER_MS = 900;
/** kamera uzaklığı sınırları (birim) */
export const VIEW_DIST_MIN = 4;
export const VIEW_DIST_MAX = 90;
/** yoklamaların simge kutusundan dışarı payı (birim) */
const PROBE_PAD = 0.3;

// ------------------------------------------------------------------------------------------ hedefler
/** Karo dikdörtgeni (uçlar dahil; dünya ızgarası). */
export interface ViewRect { i0: number; j0: number; i1: number; j1: number }
/** Manzara hedefi. Bilgi kartının `InfoTarget`'ı yapısal olarak uyar (`key`, `rect`, `h`). */
export interface LandmarkViewTarget { key: string; rect: ViewRect; h?: number;
  /** HORIZON: hedefin zemini (dürbün hedefi katın altındaki panoramada; yoksa 0): kutu ve kesit eşiği bu yükseklikten */
  y0?: number }
/** Simgenin dünya kutusu. */
export interface ViewBox { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }
/** Kutu sorgusu: dünya dikdörtgenine değebilecek bloklar (fazlası olabilir). */
export type BlockQuery = (x0: number, z0: number, x1: number, z1: number) => Iterable<{ p: V3 | readonly number[]; s: V3 | readonly number[]; g?: string }>;
type BoxLike = { p: readonly number[]; s: readonly number[]; g?: string };

const area = (r: ViewRect) => (r.i1 - r.i0 + 1) * (r.j1 - r.j0 + 1);
export const viewableTarget = (t: LandmarkViewTarget | null | undefined): t is LandmarkViewTarget =>
  !!t && t.rect.i1 >= t.rect.i0 && t.rect.j1 >= t.rect.j0 && area(t.rect) <= VIEW_MAX_AREA && (t.h === undefined || t.h > 0);

const targetCache = new WeakMap<object, LandmarkViewTarget[]>();
/** Dünyanın manzara hedefleri: sahnede simge bölgeleri, şehir haritasında semt planlarındaki landmark ayak izleri. */
export function viewTargets(built: Built, scene = "scene"): LandmarkViewTarget[] {
  const hit = targetCache.get(built);
  if (hit) return hit;
  let out: LandmarkViewTarget[] = [];
  if (!isInteriorBuilt(built)) {
    const map = gateMapOf(built);
    out = map ? cityViewTargets(map) : sceneViewTargets(built, scene);
  }
  targetCache.set(built, out);
  return out;
}

export function sceneViewTargets(built: Pick<Built, "zones">, scene = "scene"): LandmarkViewTarget[] {
  return (built.zones ?? []).filter((z) => z.kind === "landmark" && z.tag && z.w > 0 && z.d > 0)
    .map((z) => ({ key: `${scene}:${z.tag}`, rect: { i0: z.i0, j0: z.j0, i1: z.i0 + z.w - 1, j1: z.j0 + z.d - 1 } }));
}

export function cityViewTargets(map: CityMapFile): LandmarkViewTarget[] {
  const out: LandmarkViewTarget[] = [];
  for (const d of map.districts) {
    const plan = districtPlan(map, d);
    for (const lm of plan.landmarks) {
      const I0 = plan.i0 + lm.i0, J0 = plan.j0 + lm.j0;
      out.push({ key: `${map.id}:${d.id}:${lm.id}`, rect: { i0: I0, j0: J0, i1: I0 + lm.w - 1, j1: J0 + lm.d - 1 }, h: lm.h });
    }
  }
  return out;
}

/** Karonun dikdörtgene Chebyshev uzaklığı (içerideyse 0). */
export function rectDist(i: number, j: number, r: ViewRect): number {
  const di = i < r.i0 ? r.i0 - i : i > r.i1 ? i - r.i1 : 0;
  const dj = j < r.j0 ? r.j0 - j : j > r.j1 ? j - r.j1 : 0;
  return Math.max(di, dj);
}

/**
 * Hedef seçimi (kart hedefi WalkRig'de önce gelir): bakılan simge — avatardan kamera yaw'ı (ileri = (sin, cos)) doğrultusundaki
 * ışının `VIEW_LOOK_RANGE` içinde ilk kestiği ayak izi —, yoksa Chebyshev `VIEW_NEAR_RANGE` içindeki en yakın simge.
 */
export function pickViewTarget(list: readonly LandmarkViewTarget[], avatar: { x: number; z: number }, yaw: number): LandmarkViewTarget | null {
  const dx = Math.sin(yaw), dz = Math.cos(yaw);
  let look: LandmarkViewTarget | null = null, lookT = Infinity;
  let near: LandmarkViewTarget | null = null, nearD = Infinity;
  const ai = Math.floor(avatar.x + 12), aj = Math.floor(avatar.z + 8);
  for (const t of list) {
    if (!viewableTarget(t)) continue;
    const x0 = tx(t.rect.i0) - 0.5, x1 = tx(t.rect.i1) + 0.5, z0 = tz(t.rect.j0) - 0.5, z1 = tz(t.rect.j1) + 0.5;
    const hit = raySlab(avatar.x, avatar.z, dx, dz, x0, z0, x1, z1);
    if (hit !== null && hit <= VIEW_LOOK_RANGE && hit < lookT) { lookT = hit; look = t; }
    const d = rectDist(ai, aj, t.rect);
    if (d <= VIEW_NEAR_RANGE && d < nearD) { nearD = d; near = t; }
  }
  return look ?? near;
}

/** 2B ışın (köken, yön) ile dikdörtgenin ilk kesişim parametresi (köken içerideyse 0); yoksa null. */
function raySlab(ox: number, oz: number, dx: number, dz: number, x0: number, z0: number, x1: number, z1: number): number | null {
  let t0 = 0, t1 = Infinity;
  for (const [o, d, lo, hi] of [[ox, dx, x0, x1], [oz, dz, z0, z1]] as const) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return null; continue; }
    const a = (lo - o) / d, b = (hi - o) / d;
    t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1 ? t0 : null;
}

// ------------------------------------------------------------------------------------------ blok sorguları
const indexes = new WeakMap<object, BlockQuery>();
/** Blok dizisinin ızgara kovalı sorgusu (dizi başına bir kez; dev plakalar ayrı listede). */
export function blockQuery(blocks: readonly BoxLike[], extra: readonly BoxLike[] = []): BlockQuery {
  const hit = indexes.get(blocks);
  if (hit && !extra.length) return hit;
  const all = extra.length ? [...blocks, ...extra] : blocks;
  const m = new Map<number, number[]>(), big: number[] = [];
  all.forEach((b, k) => {
    if (b.g === "cloud" || b.g === "snow") return;
    const x0 = Math.floor(b.p[0] - b.s[0] / 2), x1 = Math.floor(b.p[0] + b.s[0] / 2), z0 = Math.floor(b.p[2] - b.s[2] / 2), z1 = Math.floor(b.p[2] + b.s[2] / 2);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 64) { big.push(k); return; }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const key = (x + 4096) * 8192 + (z + 4096); const l = m.get(key); if (l) l.push(k); else m.set(key, [k]); }
  });
  const q: BlockQuery = (x0, z0, x1, z1) => {
    const seen = new Set<number>(big);
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++) for (let z = Math.floor(z0); z <= Math.floor(z1); z++)
      for (const k of m.get((x + 4096) * 8192 + (z + 4096)) ?? []) seen.add(k);
    return [...seen].map((k) => all[k] as BoxLike & { p: V3; s: V3 });
  };
  if (!extra.length) indexes.set(blocks, q);
  return q;
}

/**
 * Şehir haritası puanlama sorgusu (çalışırken): parsel blokları uzak semtlerde henüz üretilmemiş olabilir, bu yüzden aday puanı
 * semt planının bina ve simge kutularıyla (dünya birimi yükseklik) + varış meydanı bloklarıyla verilir. Kesit çalışırken gerçek
 * blokları gölgelendirici açar; denetim (`landmark_view.test.mjs`) seçilen pozu gerçek parsel bloklarıyla doğrular.
 */
const cityBoxes = new WeakMap<CityMapFile, BoxLike[]>();
export function cityPlanQuery(map: CityMapFile, gate: readonly BoxLike[] = []): BlockQuery {
  let boxes = cityBoxes.get(map);
  if (!boxes) {
    boxes = [];
    for (const d of map.districts) {
      const plan = districtPlan(map, d);
      const ground = (li: number, lj: number) => Math.max(0, plan.top[lj * plan.w + li] || 0, plan.lift[lj * plan.w + li] || 0);
      for (const b of [...plan.buildings, ...plan.landmarks]) {
        const g = ground(Math.min(plan.w - 1, Math.max(0, b.i0 - 1)), Math.min(plan.d - 1, Math.max(0, b.j0 - 1)));
        boxes.push({ p: [cityX(plan.i0 + b.i0) - 0.5 + b.w / 2, g + b.h / 2, cityZ(plan.j0 + b.j0) - 0.5 + b.d / 2], s: [b.w, b.h, b.d], g: "solid" });
      }
    }
    cityBoxes.set(map, boxes);
  }
  return blockQuery(boxes, gate);
}

/** Şehir simgesinin kendi blokları (kutu için; yalnız `rect`'in sol-arka köşesi bir planın landmark'ına denk gelirse).
 * Modelli simge ayak izinden büyük çizilebilir (kafes kule, köprüler): kutu modelin yakın bloklarından kurulur
 * (`LandmarkModel.near`, parsellere dağıtılanın aynısı). Modelsiz simgede null → ayak izindeki parsel blokları.*/
export function cityLandmarkBlocks(map: CityMapFile, rect: ViewRect): BoxLike[] | null {
  const design = designOf(map.id);
  for (const d of map.districts) {
    const [di0, dj0, dw, dd] = d.bounds;
    if (rect.i0 < di0 || rect.j0 < dj0 || rect.i0 >= di0 + dw || rect.j0 >= dj0 + dd) continue;
    const plan = districtPlan(map, d);
    const lm = plan.landmarks.find((x) => plan.i0 + x.i0 === rect.i0 && plan.j0 + x.j0 === rect.j0);
    const model = lm ? design?.landmarks[lm.id] : null;
    if (!lm || !model) return null;
    const ox = cityX(plan.i0) - 0.5, oz = cityZ(plan.j0) - 0.5;
    return model.near({ x0: ox + lm.i0, z0: oz + lm.j0, w: lm.w, d: lm.d, h: lm.h, cx: ox + lm.i0 + lm.w / 2, cz: oz + lm.j0 + lm.d / 2 });
  }
  return null;
}

/** Şehir simgesinin ayak izindeki parsel blokları (modelsiz simge kutusu için; 1–2 parsel, önbellekli üretim). */
export function cityParcelQuery(map: CityMapFile): BlockQuery {
  return (x0, z0, x1, z1) => {
    const out: BoxLike[] = [];
    const I0 = Math.floor(x0 + 12), I1 = Math.floor(x1 + 12), J0 = Math.floor(z0 + 8), J1 = Math.floor(z1 + 8);
    for (let cz = Math.floor(J0 / CITY_PD); cz <= Math.floor(J1 / CITY_PD); cz++) for (let cx = Math.floor(I0 / CITY_PW); cx <= Math.floor(I1 / CITY_PW); cx++) {
      const d = parcelDistrict(map, cx, cz);
      const p = d ? districtParcel(map, d, cx, cz) : null;
      if (p) for (const b of p.near.blocks) out.push(b);
    }
    return out;
  };
}

/**
 * Simgenin dünya kutusu: ayak izindeki (merkezi içinde) zemin üstü blokların kapsadığı kutu; ayak izinin dışına en çok 1 birim
 * taşma kabul edilir (saçak, kanat). `own` verilirse (şehirde modelin blokları) kutu yalnız onlardan, taşma sınırı olmadan.
 * Blok yoksa plan yüksekliği (`h`, yoksa 3).
 */
export function targetBox(t: LandmarkViewTarget, query: BlockQuery | null, minY = (t.y0 ?? 0) + OPEN_MIN_Y, own: readonly BoxLike[] | null = null): ViewBox {
  const fx0 = tx(t.rect.i0) - 0.5, fx1 = tx(t.rect.i1) + 0.5, fz0 = tz(t.rect.j0) - 0.5, fz1 = tz(t.rect.j1) + 0.5;
  const box: ViewBox = { x0: fx0, x1: fx1, z0: fz0, z1: fz1, y0: Infinity, y1: -Infinity };
  const fpArea = (fx1 - fx0) * (fz1 - fz0);
  if (own) {
    for (const b of own) {
      if (b.g === "water" || b.g === "cloud" || b.g === "snow" || b.p[1] <= minY) continue;
      box.x0 = Math.min(box.x0, b.p[0] - b.s[0] / 2); box.x1 = Math.max(box.x1, b.p[0] + b.s[0] / 2);
      box.z0 = Math.min(box.z0, b.p[2] - b.s[2] / 2); box.z1 = Math.max(box.z1, b.p[2] + b.s[2] / 2);
      box.y0 = Math.min(box.y0, b.p[1] - b.s[1] / 2); box.y1 = Math.max(box.y1, b.p[1] + b.s[1] / 2);
    }
  } else if (query) for (const b of query(fx0, fz0, fx1, fz1)) {
    if (b.g === "water" || b.g === "cloud" || b.g === "snow") continue;
    const [cx, cy, cz] = b.p, [sx, sy, sz] = b.s;
    if (cx < fx0 || cx > fx1 || cz < fz0 || cz > fz1 || cy <= minY) continue;
    if (sx * sz > fpArea * 2) continue; // zemin plakası / arazi levhası
    box.x0 = Math.min(box.x0, Math.max(fx0 - 1, cx - sx / 2)); box.x1 = Math.max(box.x1, Math.min(fx1 + 1, cx + sx / 2));
    box.z0 = Math.min(box.z0, Math.max(fz0 - 1, cz - sz / 2)); box.z1 = Math.max(box.z1, Math.min(fz1 + 1, cz + sz / 2));
    box.y0 = Math.min(box.y0, cy - sy / 2); box.y1 = Math.max(box.y1, cy + sy / 2);
  }
  const g = t.y0 ?? 0;
  if (!Number.isFinite(box.y1)) { box.y0 = g; box.y1 = g + (t.h && t.h > 0 ? t.h : 3); }
  box.y0 = Math.max(g - 0.5, Math.min(box.y0, box.y1 - 0.5));
  return box;
}

// ------------------------------------------------------------------------------------------ çerçeve geometrisi
const RAD = Math.PI / 180;
export const boxCenter = (b: ViewBox): V3 => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2];
export const boxCorners = (b: ViewBox): V3[] => {
  const out: V3[] = [];
  for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) out.push([x, y, z]);
  return out;
};

/** Kamera konumu: bakış noktasının (kutu merkezi) yaw yönünün tersinde, `elev` yükselişle, `dist` uzakta (ileri = (sin, cos)). */
export function viewCam(b: ViewBox, yaw: number, elev: number, dist: number, out: V3 = [0, 0, 0]): V3 {
  const [cx, cy, cz] = boxCenter(b), ce = Math.cos(elev);
  out[0] = cx - Math.sin(yaw) * ce * dist; out[1] = cy + Math.sin(elev) * dist; out[2] = cz - Math.cos(yaw) * ce * dist;
  return out;
}

/**
 * Noktanın görüş uzayı (lookAt, yukarı +y): [sağ, yukarı, derinlik]. three.js `camera.lookAt` ile aynı eksenler.
 */
export function viewSpace(cam: readonly number[], look: readonly number[], p: readonly number[]): V3 {
  let fx = look[0] - cam[0], fy = look[1] - cam[1], fz = look[2] - cam[2];
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  // sağ = ileri × yukarı
  let rx = -fz, rz = fx;
  const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  // yukarı = sağ × ileri
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const vx = p[0] - cam[0], vy = p[1] - cam[1], vz = p[2] - cam[2];
  return [vx * rx + vz * rz, vx * ux + vy * uy + vz * uz, vx * fx + vy * fy + vz * fz];
}

/** Kutunun 8 köşesi görüş açısının payına sığıyor mu (dikey `vfov` derece, en/boy `aspect`). */
export function boxInFrame(b: ViewBox, cam: readonly number[], look: readonly number[], vfov: number, aspect: number, mv = VIEW_MARGIN_V, mh = VIEW_MARGIN_H): boolean {
  const tv = Math.tan((vfov * RAD) / 2), th = tv * aspect;
  for (const c of boxCorners(b)) {
    const [x, y, z] = viewSpace(cam, look, c);
    if (z < 0.2 || Math.abs(y) > tv * mv * z || Math.abs(x) > th * mh * z) return false;
  }
  return true;
}

/** Kutunun bu yaw/yükselişte sığdığı en kısa uzaklık (ikiye bölme; `VIEW_DIST_MAX`'ta sığmıyorsa o değer). */
export function fitDist(b: ViewBox, yaw: number, elev: number, vfov: number, aspect: number): number {
  const look = boxCenter(b), cam: V3 = [0, 0, 0];
  const fits = (d: number) => boxInFrame(b, viewCam(b, yaw, elev, d, cam), look, vfov, aspect);
  const half = Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2;
  let lo = Math.max(VIEW_DIST_MIN, half + 1.5), hi = VIEW_DIST_MAX;
  if (fits(lo)) return lo;
  if (!fits(hi)) return hi;
  for (let k = 0; k < 28; k++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
  return hi;
}

/** Salınımın bütün yaw'larında (uçlar ve orta) sığan uzaklık. */
export function swingDist(b: ViewBox, yaw: number, elev: number, vfov: number, aspect: number, swing = VIEW_SWING): number {
  let d = 0;
  for (const k of swing ? [-1, -0.5, 0, 0.5, 1] : [0]) d = Math.max(d, fitDist(b, yaw + k * swing, elev, vfov, aspect));
  return d;
}

/**
 * Kesit yoklamaları: simge kutusunun kameraya bakan yüzünün hemen dışındaki 4 nokta (taban, tepe, iki yan; yatayda kutu
 * merkezinden kameraya doğru ışının kutudan çıktığı yer + pay). Yoklamalar kutunun dışında → simgenin kendi bloğu doğruda değil.
 */
export function viewProbes(b: ViewBox, cam: readonly number[]): V3[] {
  const [cx, , cz] = boxCenter(b);
  let dx = cam[0] - cx, dz = cam[2] - cz;
  const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  const vx = -dz, vz = dx;
  const hw = Math.abs(vx) * (b.x1 - b.x0) / 2 + Math.abs(vz) * (b.z1 - b.z0) / 2;
  const exit = (ox: number, oz: number): [number, number] => {
    let t = Infinity;
    if (Math.abs(dx) > 1e-9) t = Math.min(t, ((dx > 0 ? b.x1 : b.x0) - ox) / dx);
    if (Math.abs(dz) > 1e-9) t = Math.min(t, ((dz > 0 ? b.z1 : b.z0) - oz) / dz);
    t = Math.max(0, Number.isFinite(t) ? t : 0) + PROBE_PAD;
    return [ox + dx * t, oz + dz * t];
  };
  const [bx, bz] = exit(cx, cz);
  const mid = (b.y0 + b.y1) / 2, lat = hw * 0.75;
  const [lx, lz] = exit(cx + vx * lat, cz + vz * lat), [rx, rz] = exit(cx - vx * lat, cz - vz * lat);
  const out: V3[] = [[bx, b.y0 + 0.35, bz], [bx, b.y1 - 0.1, bz], [lx, mid, lz], [rx, mid, rz]];
  // eğik bakışta yan yüzden çıkan doğru kutunun köşesini yeniden kesebilir: başlangıç, doğrunun kutudan son çıktığı yerin ötesine
  for (const p of out) {
    const t1 = segBoxExit(p, cam, b);
    if (t1 === null) continue;
    const len = Math.hypot(cam[0] - p[0], cam[1] - p[1], cam[2] - p[2]) || 1, t = Math.min(1, t1 + PROBE_PAD / len);
    p[0] += (cam[0] - p[0]) * t; p[1] += (cam[1] - p[1]) * t; p[2] += (cam[2] - p[2]) * t;
  }
  return out;
}

/** a → c doğru parçası kutuyu kesiyorsa kesişimin bittiği parametre (0…1), yoksa null. */
function segBoxExit(a: readonly number[], c: readonly number[], b: ViewBox): number | null {
  const lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1];
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const d = c[k] - a[k];
    if (Math.abs(d) < 1e-9) { if (a[k] <= lo[k] || a[k] >= hi[k]) return null; continue; }
    const u = (lo[k] - a[k]) / d, v = (hi[k] - a[k]) / d;
    t0 = Math.max(t0, Math.min(u, v)); t1 = Math.min(t1, Math.max(u, v));
  }
  return t0 < t1 ? t1 : null;
}

/** Manzara kesit planı (sokak kesitiyle aynı birimler; çatı/kabuk yok). */
export function viewCutPlan(b: ViewBox, cam: V3, minY: number): CutPlan {
  return { roof: null, shell: null, probes: viewProbes(b, cam), cam, minY, near: { at: cam, r: CAM_BUBBLE } };
}

/**
 * LOOKOUT-CAM-001 (ürün sahibi 2026-10-31 "dürbünde kamera dönünce karşı kıyı binalarının içinden geçiyor, bina parçaları kadraja giriyor"):
 * manzara kamerası hiçbir yönde bir katının içinde durmaz — yakın düzlem küresi (`r`, collide.ts `probeRadius`) bir bloğa değiyorsa ya da
 * hedefe bakışın ilk `VIEW_CLEAR_NEAR` birimi bir yapıdan geçiyorsa kamera aynı yerde yükselir (çatıların üstü); yetmezse bakış doğrusu
 * boyunca hedefe doğru ilk boş noktaya çekilir. Kesit (örtücü açma) değişmez.
 * `cam` yerinde değişir ve döner. Saf (her poz bağımsız); ölçüm ve `clearViewCam`'in yaw kovası çözümü bunu çağırır.
*/
export function clearViewCamAt(cam: V3, look: readonly number[], src: BoxSource, r: number, floorTop: number): V3 {
  const d0 = Math.hypot(cam[0] - look[0], cam[1] - look[1], cam[2] - look[2]);
  const clear = (p: V3) => viewClear(p, look, src, r, floorTop);
  if (clear(cam)) return cam;
  const p: V3 = [cam[0], cam[1], cam[2]];
  // önce aynı yerde yüksel (çatıların üstünden bakış; çerçeve hedefte kalır), sonra hedefe doğru çekil
  for (let dy = 0.25; dy <= Math.max(12, d0 * 1.5); dy += 0.25) { p[1] = cam[1] + dy; if (clear(p)) { cam[1] = p[1]; return cam; } }
  for (const ok of [clear, (q: V3) => !pointBlocked(src, q, r, floorTop)]) for (let k = 1; k < 64; k++) {
    const t = 1 - k / 64;
    p[0] = look[0] + (cam[0] - look[0]) * t; p[1] = look[1] + (cam[1] - look[1]) * t; p[2] = look[2] + (cam[2] - look[2]) * t;
    if (ok(p)) { cam[0] = p[0]; cam[1] = p[1]; cam[2] = p[2]; return cam; }
  }
  return cam;
}
const armTo: V3 = [0, 0, 0];
/** Kamera yakın düzlem küresi boşta ve hedefe bakışın ilk `VIEW_CLEAR_NEAR` birimi (en çok yarısı) yapısız (kesitin açtığı yakın bina
 *  parçaları kadraja girmesin). */
function viewClear(p: V3, look: readonly number[], src: BoxSource, r: number, floorTop: number): boolean {
  if (pointBlocked(src, p, r, floorTop)) return false;
  const L = Math.hypot(look[0] - p[0], look[1] - p[1], look[2] - p[2]) || 1, near = Math.min(VIEW_CLEAR_NEAR, L * 0.5), k = near / L;
  armTo[0] = p[0] + (look[0] - p[0]) * k; armTo[1] = p[1] + (look[1] - p[1]) * k; armTo[2] = p[2] + (look[2] - p[2]) * k;
  return sweepArm(src, p, armTo, r, floorTop) >= near - 1e-3;
}

/** yaw kovası sayısı (360° / 72 = 5°); düzeltme komşu ± 2 kovanın en büyüğü (engel gelmeden yükselmeye başlar).*/
export const VIEW_LIFT_BUCKETS = 72;
const LIFT_WIN = 4, RISE_TAU = 0.12, FALL_TAU = 0.6, MAX_NEW_BUCKETS = 2;
/** büyük yükselmenin derece başına rampası (birim/°; eşiği 1,8'in altında).*/
export const LIFT_SLOPE = 1.2;
/** Kamera yaw'ının kendi kovası içinde komşu `b` yönündeki kenarına uzaklığı (°; 0…kova genişliği). */
function edgeDeg(hx: number, hz: number, b0: number, b: number): number {
  const N = VIEW_LIFT_BUCKETS, w = 360 / N, a = ((((Math.atan2(hz, hx) * 180) / Math.PI) % 360) + 360) % 360 - b0 * w;
  return ((b - b0 + N) % N) < N / 2 ? w - a : a;
}
/** Kareler arası durum. Bağlam (kaynak, hedef, yatay yarıçap, kamera y'si, küre, eşik) değişince kovalar silinir. */
const vc = { src: null as BoxSource | null, lx: NaN, ly: NaN, lz: NaN, R: NaN, y: NaN, r: NaN, f: NaN, at: -1, dy: 0, t: 1, yaw: 0,
  dyOf: new Float64Array(VIEW_LIFT_BUCKETS), tOf: new Float64Array(VIEW_LIFT_BUCKETS), known: new Uint8Array(VIEW_LIFT_BUCKETS) };
const c0: V3 = [0, 0, 0], q0: V3 = [0, 0, 0];
/** Ham çözüm `q`'nun kamera `c`'ye göre karşılığı: aynı yerde yükselme `dy` ya da hedefe doğru çekilme oranı `t`. */
function fixOf(q: readonly number[], c: readonly number[], look: readonly number[]): [number, number] {
  if (q[0] === c[0] && q[2] === c[2]) return [q[1] - c[1], 1];
  return [0, Math.hypot(q[0] - look[0], q[1] - look[1], q[2] - look[2]) / (Math.hypot(c[0] - look[0], c[1] - look[1], c[2] - look[2]) || 1)];
}
function applyFix(c: readonly number[], look: readonly number[], dy: number, t: number, out: V3): V3 {
  out[0] = look[0] + (c[0] - look[0]) * t; out[1] = look[1] + (c[1] + dy - look[1]) * t; out[2] = look[2] + (c[2] - look[2]) * t;
  return out;
}
const ease = (cur: number, tgt: number, tau: number, dt: number) => cur + (tgt - cur) * (1 - Math.exp(-dt / tau));

/**
 * LOOKOUT-CAM-001 + (inceleme: "dürbünde 360° dönerken kamera metrelerce dikey sıçrıyor; kare başı 48 yükseliş +
 * 126 çekilme denemesi"): WalkRig'in kare başı çağrısı. Yükselme/çekilme yaw kovası başına BİR kez ham çözümle (`clearViewCamAt`)
 * bulunur ve bağlam değişene dek önbellekte kalır (karede en çok 2 yeni kova); uygulanan düzeltme komşu kovaların en büyüğüdür ve üstel
 * yaklaşımla yumuşar (yükselme/çekilme hızlı, iniş yavaş). Sonuç her karede `viewClear` ile denetlenir: değiyorsa kova hedefi, o da
 * değiyorsa ham çözüm — kural (kamera katı içinde değil, önü açık) gevşemez. Bağlam her karede değişiyorsa (giriş kayması, kıstırma)
 * davranış eskisiyle aynıdır. `dt` verilmezse saatten (sn).
*/
export function clearViewCam(cam: V3, look: readonly number[], src: BoxSource, r: number, floorTop: number, dt?: number): V3 {
  const hx = cam[0] - look[0], hz = cam[2] - look[2], R = Math.hypot(hx, hz);
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const step = Math.min(0.1, Math.max(0, dt ?? (vc.at < 0 ? 0 : (now - vc.at) / 1000)));
  vc.at = now;
  const same = vc.src === src && Math.abs(vc.lx - look[0]) < 1e-3 && Math.abs(vc.ly - look[1]) < 1e-3 && Math.abs(vc.lz - look[2]) < 1e-3 &&
    Math.abs(vc.R - R) < 1e-2 && Math.abs(vc.y - cam[1]) < 1e-2 && vc.r === r && vc.f === floorTop;
  c0[0] = cam[0]; c0[1] = cam[1]; c0[2] = cam[2];
  if (!same || R < 1e-3) {
    vc.src = src; vc.lx = look[0]; vc.ly = look[1]; vc.lz = look[2]; vc.R = R; vc.y = cam[1]; vc.r = r; vc.f = floorTop; vc.known.fill(0); vc.yaw = (Math.atan2(hz, hx) * 180) / Math.PI;
    [vc.dy, vc.t] = fixOf(clearViewCamAt(cam, look, src, r, floorTop), c0, look);
    return cam;
  }
  const yawDeg = (Math.atan2(hz, hx) * 180) / Math.PI, turn = Math.abs(((yawDeg - vc.yaw + 540) % 360) - 180);
  vc.yaw = yawDeg;
  const N = VIEW_LIFT_BUCKETS, b0 = Math.floor((((Math.atan2(hz, hx) / (2 * Math.PI)) * N) % N + N) % N);
  let tdy = 0, tt = 1, rdy = 0, fresh = 0;
  for (let o = 0; o <= 2 * LIFT_WIN; o++) {
    const b = (b0 + (o % 2 ? (o + 1) / 2 : -o / 2) + N) % N; // önce kendi kovası, sonra iki yana sırayla
    if (!vc.known[b]) {
      if (fresh >= MAX_NEW_BUCKETS) continue;
      fresh++;
      const ac = ((b + 0.5) / N) * 2 * Math.PI;
      q0[0] = look[0] + Math.cos(ac) * R; q0[1] = cam[1]; q0[2] = look[2] + Math.sin(ac) * R;
      const qc: V3 = [q0[0], q0[1], q0[2]];
      [vc.dyOf[b], vc.tOf[b]] = fixOf(clearViewCamAt(q0, look, src, r, floorTop), qc, look);
      vc.known[b] = 1;
    }
    // rampa — komşu kovanın yükselmesi kovanın yakın kenarına kadar tam, ötesinde derece başına LIFT_SLOPE düşer;
    // ince uzun direk (<city> iğnesi) gibi birkaç derecede 20 birimlik yükselme basamak değil eğim olarak gelir
    const off = o ? (Math.abs(((b - b0 + N + N / 2) % N) - N / 2) - 1) * (360 / N) + edgeDeg(hx, hz, b0, b) : 0;
    tdy = Math.max(tdy, vc.dyOf[b]); tt = Math.min(tt, vc.tOf[b]); if (o) rdy = Math.max(rdy, vc.dyOf[b] - LIFT_SLOPE * off);
  }
  // yükselme üstel yaklaşımla; rampa (rdy) önündeyse rampa izlenir (üstel gecikme büyük yükselmede kova girişinde ham çözüme sıçratırdı)
  // büyük yükselmede üstel adım da derece başına LIFT_SLOPE ile sınırlı (yaw adımı `turn`)
  const ndy = tdy > vc.dy ? Math.max(Math.min(ease(vc.dy, tdy, RISE_TAU, step), vc.dy + LIFT_SLOPE * turn), Math.min(rdy, tdy)) : ease(vc.dy, tdy, FALL_TAU, step), nt = ease(vc.t, tt, tt < vc.t ? RISE_TAU : FALL_TAU, step);
  // geçişte (hedefe varmadan) yalnız sert koşul: küre katıya değmez; bakışın önündeki yakın yapı payı geçişin birkaç karesinde gevşer
  // (yoksa yalnız yüksekte boş olan yerde kamera metrelerce sıçrar; ölçüm)
  const moving = Math.abs(ndy - tdy) > 0.05 || Math.abs(nt - tt) > 0.005;
  applyFix(c0, look, ndy, nt, q0);
  if (moving ? !pointBlocked(src, q0, r, floorTop) : viewClear(q0, look, src, r, floorTop)) { vc.dy = ndy; vc.t = nt; }
  else if (viewClear(applyFix(c0, look, tdy, tt, q0), look, src, r, floorTop)) { vc.dy = tdy; vc.t = tt; }
  else { q0[0] = c0[0]; q0[1] = c0[1]; q0[2] = c0[2]; [vc.dy, vc.t] = fixOf(clearViewCamAt(q0, look, src, r, floorTop), c0, look); }
  return applyFix(c0, look, vc.dy, vc.t, cam);
}
/** LOOKOUT-CAM-001: kameranın önünde boş kalması gereken bakış uzunluğu (birim). */
export const VIEW_CLEAR_NEAR = 6;

/** Kesit eşiği: simge tabanının ya da avatar ayağının (alçak olan) zemin payı üstü. */
export const viewMinY = (b: ViewBox, foot = 0, ground?: number) => ground !== undefined ? ground + OPEN_MIN_Y : OPEN_MIN_Y + Math.max(0, Math.min(b.y0, foot));

export interface ViewSolution { yaw: number; elev: number; dist: number; score: number; blocked: boolean }

/** Adayın puanı: kesilecek örtücü sayısı (+ hacim payı), kesilemeyen zemin/arazi örtücüsü varsa `blocked`. */
export function scoreView(b: ViewBox, cam: V3, query: BlockQuery | null, minY: number): { occ: number; blocked: boolean } {
  if (!query) return { occ: 0, blocked: false };
  const probes = viewProbes(b, cam);
  const xs = [cam[0], ...probes.map((p) => p[0])], zs = [cam[2], ...probes.map((p) => p[2])];
  let occ = 0, blocked = false;
  for (const k of query(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs))) {
    if (k.g === "water" || k.g === "cloud" || k.g === "snow") continue;
    const p = k.p as V3, h: V3 = [k.s[0] / 2, k.s[1] / 2, k.s[2] / 2];
    if (!probes.some((a) => segmentHitsBox(a, cam, p, h))) continue;
    if (p[1] <= minY) { if (p[1] + h[1] > minY + 0.25) blocked = true; continue; }
    occ += 1 + Math.min(4, (k.s[0] * k.s[1] * k.s[2]) / 8);
  }
  return { occ, blocked };
}

const angDiff = (a: number, b: number) => { const d = Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI); return d; };

/**
 * En iyi çerçeve: 16 yaw × 2 yükseliş; uzaklık tavanına değen ve kesilemeyen örtücüsü olan aday ancak başka aday yoksa;
 * sonra puan: örtücü sayısı + yassı simgede yandan bakma cezası + avatarın arkasından bakma tercihi (kamera, avatar ve simge
 * aynı doğrultuda: avatar ön planda küçük) + yakınlık.
 */
export function solveView(b: ViewBox, o: { vfov: number; aspect: number; avatar?: { x: number; z: number } | null; query?: BlockQuery | null; minY?: number; swing?: number }): ViewSolution {
  const [cx, , cz] = boxCenter(b);
  const pref = o.avatar && Math.hypot(cx - o.avatar.x, cz - o.avatar.z) > 0.5 ? Math.atan2(cx - o.avatar.x, cz - o.avatar.z) : null;
  const minY = o.minY ?? viewMinY(b);
  const swing = o.swing ?? VIEW_SWING;
  const cam: V3 = [0, 0, 0];
  const ex = b.x1 - b.x0, ez = b.z1 - b.z0, diag = Math.hypot(ex, ez) || 1, flat = Math.max(ex, ez) > 1.5 * Math.min(ex, ez);
  // ince uzun simge (minare, kule: boy > 2 × ayak izi) alçak yükselişte kadrajın yarısı gök olur → yüksek bakış yeğlenir
  const tall = b.y1 - b.y0 > 2 * Math.max(ex, ez);
  let best: ViewSolution | null = null, bestRank = 9;
  for (let k = 0; k < VIEW_YAWS; k++) {
    const yaw = (pref ?? 0) + (k * 2 * Math.PI) / VIEW_YAWS;
    for (const elev of VIEW_ELEVS) {
      const dist = swingDist(b, yaw, elev, o.vfov, o.aspect, swing);
      viewCam(b, yaw, elev, dist, cam);
      let { occ, blocked } = scoreView(b, cam, o.query ?? null, minY);
      // salınım uçları da puana girer (örtücü yalnız bir uçta da kesilir; az olan yeğlenir)
      if (swing) for (const s of [-swing, swing]) {
        const r = scoreView(b, viewCam(b, yaw + s, elev, dist, cam), o.query ?? null, minY);
        occ += r.occ * 0.5; blocked = blocked || r.blocked;
      }
      // yassı simge (çark, kemer, köprü): geniş yüzü gören yaw yeğlenir (yandan bakışta görünen genişlik küçük)
      const face = flat ? 3 * (1 - (ex * Math.abs(Math.cos(yaw)) + ez * Math.abs(Math.sin(yaw))) / diag) : 0;
      const score = occ + face + (pref === null ? 0 : (2 * angDiff(yaw, pref)) / Math.PI) + dist * 0.01 + ((elev > VIEW_ELEVS[0]) !== tall ? 0.3 : 0);
      // önce sığan (uzaklık tavanına değmeyen), sonra kesilemeyen örtücüsü olmayan, sonra puan
      const rank = (dist >= VIEW_DIST_MAX - 1e-3 ? 2 : 0) + (blocked ? 1 : 0);
      if (!best || rank < bestRank || (rank === bestRank && score < best.score)) { best = { yaw, elev, dist, score, blocked }; bestRank = rank; }
    }
  }
  return best!;
}

// ------------------------------------------------------------------------------------------ durum ve API
/** WalkRig'in kare başı okuduğu istek/durum (React dışı). */
export const landmarkView: {
  /** bekleyen başlatma isteği (`target` null: otomatik seçim) */
  request: { target: LandmarkViewTarget | null } | null;
  /** çıkış isteği */
  stop: boolean;
  /** kip açık mı (WalkRig yazar) */
  active: boolean;
} = { request: null, stop: false, active: false };

/** Arayüz için seyrek durum: açık mı, hangi hedef; son başarısız deneme zamanı (hedef yok). */
export interface LandmarkViewState { active: boolean; key: string | null; rect: ViewRect | null; missAt: number }
export const useLandmarkView = create<LandmarkViewState>(() => ({ active: false, key: null, rect: null, missAt: 0 }));

/** Kart hedefi kaynağı (bilgi kartı katmanı bağlar): açık kartın hedefi, `L`'de önceliklidir. */
export const landmarkViewSources: { card: (() => LandmarkViewTarget | null) | null } = { card: null };

/**
 * Manzara kipini başlat. `target` verilirse o simge (bilgi kartı), verilmezse kart → bakılan → en yakın simge. Yürüme modu
 * kapalıysa, fotoğraf modundaysa ya da hedef manzaraya uygun değilse (semt kartı gibi geniş alan) `false`.
 */
export function startLandmarkView(target?: LandmarkViewTarget | null): boolean {
  const ws = useWalkStore.getState();
  if (!ws.active || ws.photo) return false;
  if (target && !viewableTarget(target)) return false;
  landmarkView.request = { target: target ?? null };
  landmarkView.stop = false;
  return true;
}

/** Manzara kipinden çık (takip kamerasına yumuşak dönüş). */
export function stopLandmarkView(): void {
  landmarkView.request = null;
  if (landmarkView.active) landmarkView.stop = true;
}

/** `L`: açıksa çık, kapalıysa otomatik hedefle başlat. */
export function toggleLandmarkView(): boolean {
  if (landmarkView.active || landmarkView.request) { stopLandmarkView(); return false; }
  return startLandmarkView(null);
}
