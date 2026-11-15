/**
 * UXF-B — giriş karesi engel ölçüsü: yürüme moduna girişte (ilk karelerde) takip kamerasının görüntüsünün ne kadarını
 * avatarın ÖNÜNDE duran bir blok (duvar, direk, lamba, tabela) kaplıyor?
 *
 * (`spawnView.ts`) avatarın BAKTIĞI yönün açık olmasını sağlar; denetim
 * İstanbul, Londra, <city> ve <city> girişinde kameranın yanındaki duvarın ya da avatarın tam arkasındaki lamba direğinin karenin
 * %30–45'ini kapladığını buldu: bakış açık ama kamera tarafı değil. Ölçü, WalkRig'in ilk karelerdeki pozuyla aynıdır:
 * - pivot göğüs (`LOOK_Y`, kamera tabanı girişte 0), yaw = doğma yönü, eğim `LOOK_DEFAULT`, mesafe `FOLLOW_DIST`, yörünge pozu
 * (`orbitPose`) ve duvar/engel çözümü (`cover.ts resolveFollowCam`) — kamera konumu ve bakış noktası buradan;
 * - görüş açısı `walkFov` (varsayılan ayar, 16:10), `FRAME_RAYS_X × FRAME_RAYS_Y` ışın;
 * - WalkRig'in kesitinin attığı bloklar (`walkCutPlan` + `planCuts`, aynı saf plan) görünmez → sayılmaz;
 * - ışının ilk çarptığı ayakta blok (tepesi zeminden `STAND_H` yukarıda; zemin, kaldırım, su sayılmaz) kameraya avatarın
 * `FRAME_BEYOND` ötesinden yakınsa o ışın "engelli"dir (yanındaki duvar avatarın ötesine uzanır). Oran = engelli / bütün ışın.
 * Saf modül: React/three yok (node testi `frontend/scripts/uxfb_spawn_frame.test.mjs` doğrudan yükler).
*/
import type { Block, Built, Tile } from "../scenes";
import { tx, tz } from "../scenes";
import { components, coverGrid } from "./controller";
import { planCuts, resolveFollowCam, walkCutPlan } from "./cover";
import { FOLLOW_DIST, LOOK_DEFAULT, LOOK_Y, CAM_FLOOR, orbitPose, walkFov, WALK_FOV_DEFAULT } from "./scale";

/** Kabul eşiği: giriş karesinin en çok bu oranı avatarın önündeki bloklarla kaplı (regresyon listesi C2: ≤ %15). */
export const SPAWN_FRAME_MAX = 0.15;
export const FRAME_RAYS_X = 32;
export const FRAME_RAYS_Y = 20;
/** Ölçü en/boy oranı (1440 × 900 masaüstü). */
export const FRAME_ASPECT = 16 / 10;
/** Bu yükseklikten (kamera tabanı üstü) alçak blok zemin/kaldırım sayılır, engel değildir. */
const STAND_H = 0.35;
/** Avatarın kendisi engel sayılmaz (göğüs uzaklığından bu kadar önce biten çarpışma engeldir)... */
const AVATAR_PAD = 0.45;
/** ...ve avatarın bu kadar ötesine dek kareyi dolduran yüzey de (yanındaki duvar avatarın ötesine uzanır: İstanbul sağ duvar). */
export const FRAME_BEYOND = 2;
/**
 * UXF-E (<city>): avatarın hemen arkasında (kamera için: avatarın üstünde) ince dikey bir direk/lamba karenin %1-3'ünü
 * kaplar ama avatarın tam üstünden çıkar gibi okunur (`uxs2-r-34-<city>-spawn.jpg`). Bakış çizgisinin `CENTER_HALF` yarı genişlikli
 * koridorunda, avatarın `CENTER_NEAR`..`CENTER_FAR` karo ötesinde, `CENTER_TOP` üzerine uzanan ince (`CENTER_THIN`) her ayakta blok
 * `CENTER_PENALTY` (eşiğin üstünde) ceza alır: aday yön/karo elenir.
*/
export const CENTER_HALF = 0.5;
export const CENTER_NEAR = 0.4;
export const CENTER_FAR = 6;
export const CENTER_TOP = 1.2;
export const CENTER_PENALTY = 0.2;
const CENTER_THIN = 0.5;
/** Direk sayılması için tabanı en çok bu kadar yukarıda (üstte asılı kiriş/tente direk değildir). */
const CENTER_BASE = 0.6;
/**
 * ARRIVAL-QA ( I3): giriş/varış karesinde avatarın tam önü (karenin ortası, avatarın `CENTER_VIEW_FAR` birim
 * ötesine dek) en çok `CENTER_VIEW_MAX` kapalı; kamera ile avatarın omuz çizgisi (+`COLUMN_BEYOND`) arasında karenin orta %70'inde
 * (`COLUMN_U`) ince dikey direk/gövde (`COLUMN_THIN`, tepesi ≥ `COLUMN_TOP`) yok. İkisi de `CENTER_PENALTY` alır (aday elenir).
*/
export const CENTER_VIEW_FAR = 5;
export const CENTER_VIEW_MAX = 0.35;
export const COLUMN_THIN = 0.7;
export const COLUMN_TOP = 1.6;
export const COLUMN_BEYOND = 0.5;
export const COLUMN_U = 0.7;
/** ARRIVAL-QA: üst üste dizilmiş ince kutular (palmiye gövdesi parça parça) tek dikey sütun sayılır (xz merkezi ±0,125). */
function columnsOf(boxes: readonly Box[]): Box[] {
  const m = new Map<string, Box>();
  for (const b of boxes) {
    if (Math.max(b.hi[0] - b.lo[0], b.hi[2] - b.lo[2]) >= COLUMN_THIN) continue;
    const k = `${Math.round((b.lo[0] + b.hi[0]) * 4)},${Math.round((b.lo[2] + b.hi[2]) * 4)}`;
    const c = m.get(k);
    if (!c) { m.set(k, { lo: [...b.lo] as V3, hi: [...b.hi] as V3 }); continue; }
    for (let q = 0; q < 3; q++) { c.lo[q] = Math.min(c.lo[q], b.lo[q]); c.hi[q] = Math.max(c.hi[q], b.hi[q]); }
  }
  return [...m.values()];
}
/** Görüntüye girmeyen gruplar (parçacık, su yüzeyi). */
const SKIP = new Set(["water", "wave", "cloud", "snow", "flame", "flag"]);

type V3 = [number, number, number];
interface Box { lo: V3; hi: V3 }

const near = new WeakMap<object, { key: string; boxes: Box[] }>();
/** Avatar çevresindeki (`r` birim) ayakta bloklar — poz başına yeniden süzülmez (karo anahtarı). */
function standing(built: Pick<Built, "blocks">, x: number, z: number, r: number): Box[] {
  const key = `${Math.round(x * 2)},${Math.round(z * 2)},${r}`;
  const hit = near.get(built);
  if (hit && hit.key === key) return hit.boxes;
  const boxes: Box[] = [];
  for (const b of built.blocks) {
    if (b.g && SKIP.has(b.g)) continue;
    const hx = b.s[0] / 2, hy = b.s[1] / 2, hz = b.s[2] / 2;
    if (b.p[1] + hy < STAND_H) continue;
    if (Math.abs(b.p[0] - x) > r + hx || Math.abs(b.p[2] - z) > r + hz) continue;
    boxes.push({ lo: [b.p[0] - hx, b.p[1] - hy, b.p[2] - hz], hi: [b.p[0] + hx, b.p[1] + hy, b.p[2] + hz] });
  }
  near.set(built, { key, boxes });
  return boxes;
}

/** `standing` ile aynı süzgeç, önbelleksiz (az sayıda ek blok). */
function standingOf(blocks: readonly Block[], x: number, z: number, r: number): Box[] {
  const out: Box[] = [];
  for (const b of blocks) {
    if (b.g && SKIP.has(b.g)) continue;
    const hx = b.s[0] / 2, hy = b.s[1] / 2, hz = b.s[2] / 2;
    if (b.p[1] + hy < STAND_H || Math.abs(b.p[0] - x) > r + hx || Math.abs(b.p[2] - z) > r + hz) continue;
    out.push({ lo: [b.p[0] - hx, b.p[1] - hy, b.p[2] - hz], hi: [b.p[0] + hx, b.p[1] + hy, b.p[2] + hz] });
  }
  return out;
}

/** Işın–kutu kesişimi (yavaş slab): giriş uzaklığı ya da Infinity. Işın kutunun içinde başlıyorsa 0. */
function hitBox(o: V3, d: V3, b: Box): number {
  let t0 = 0, t1 = Infinity;
  for (let q = 0; q < 3; q++) {
    if (Math.abs(d[q]) < 1e-9) { if (o[q] < b.lo[q] || o[q] > b.hi[q]) return Infinity; continue; }
    const inv = 1 / d[q];
    let a = (b.lo[q] - o[q]) * inv, c = (b.hi[q] - o[q]) * inv;
    if (a > c) { const s = a; a = c; c = s; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

export interface FrameResult {
  /** engelli ışın oranı (0–1) */
  frac: number;
  /** ARRIVAL-QA: orta pencerenin avatarın `CENTER_VIEW_FAR` önüne dek kapalı oranı ve omuz çizgisine dek orta %70'te dikey direk */
  center?: number;
  column?: boolean;
  /** kamera konumu ve takip kipi (`resolveFollowCam`) */
  cam: V3;
  mode: string;
}

/** `extra`: dünyanın bloklarında olmayan çizim blokları (UXF-D: "Şehre çık" kapısının kemeri, `citymap/door.ts`). */
export interface FrameOpts { fovSet?: number; aspect?: number; jitter?: boolean; coarse?: boolean; extra?: readonly Block[];
  /** ARRIVAL-QA: orta pencere ve kamera–avatar arası direk cezası (yürüme girişi seçimi; ölçü alanları her zaman dolar)*/
  strict?: boolean;
  /** sabit durum kamerası (`arrivalCam.ts steadyCam`: ortam profili + yaylı kol); null = göz yedeği (kare kapalı sayılır)*/
  camAt?: (x: number, z: number, yaw: number) => { cam: V3; fov: number } | null;
  /** yalnız orta pencere cezası (dönüş/çıkış: avatarın önü açık; direk kuralı yalnız giriş ve şehir varışında)*/
  strictCenter?: boolean }

/** Avatar girişte çarpışma ile karo ortasından biraz itilebilir (İstanbul: duvar 0,22 birim itti, lamba kesitten çıktı): ölçü
 *  karo ortasında ve bu kadar kaydırılmış dört konumda alınır, en kötüsü geçerlidir. */
export const FRAME_JITTER = 0.25;
/** sabit durum kamerasıyla ölçüde ayakta blok yarıçapı (varış denetimiyle aynı).*/
const STEADY_R = 9;
/** Bundan ince blok (lamba, direk) kesit planı onu atsa da sayılır: avatarın küçük bir kayması onu kesitten çıkarır. */
const THIN = 0.3;

/**
 * Giriş pozunun kare engeli. `pose`: avatar karosu ve yaw (WalkRig `spawnPose`). `fovSet`: kullanıcı ayarı (varsayılan 55).
 */
/** avatar gövdesinin örnek noktaları (ayak, diz, göğüs) ve kapanma payı — kameradan bu noktaya giden doğruyu
 * noktadan `AVATAR_OCC_PAD` önce kesen ayakta blok avatarı örter (İstanbul tabanı: kamera ile avatar arasında bank, bacaklar yok).*/
export const AVATAR_OCC_YS = [0.15, 0.3, 0.45, 0.6, LOOK_Y] as const;
export const AVATAR_OCC_PAD = 0.35;
/** ajan istasyonları (bank/sandalye + oturan ya da duran ajan) blok değildir (Crowd/Props çizer) — kare ölçüsünde gövde kutusu.*/
export function stationBoxes(stations: readonly { tile: Tile }[]): { lo: V3; hi: V3 }[] {
  return stations.map((s) => ({ lo: [tx(s.tile[0]) - 0.45, 0, tz(s.tile[1]) - 0.45] as V3, hi: [tx(s.tile[0]) + 0.45, 1.0, tz(s.tile[1]) + 0.45] as V3 }));
}
/** Örnek noktaların en az ikisi örtülüyse avatar "kapalı" (saf; arrival_check aynı işlevi kullanır). */
export function avatarHidden(boxes: readonly { lo: V3; hi: V3 }[], cam: readonly number[], ax: number, az: number): boolean {
  let n = 0;
  for (const y of AVATAR_OCC_YS) {
    const d: V3 = [ax - cam[0], y - cam[1], az - cam[2]], L = Math.hypot(d[0], d[1], d[2]) || 1;
    d[0] /= L; d[1] /= L; d[2] /= L;
    let t = Infinity;
    for (const b of boxes) { const h = hitBox(cam as V3, d, b); if (h < t) t = h; }
    if (t < L - AVATAR_OCC_PAD) n++;
  }
  return n >= 2;
}

export function spawnFrame(built: Built, tile: Tile, yaw: number, opts: FrameOpts = {}): FrameResult {
  const x0 = tx(tile[0]), z0 = tz(tile[1]);
  let worst: FrameResult | null = null;
  // sabit durum kamerası karo başına çözülür (kayma kamerayı taşımaz) — ölçü karo ortasında, tek konumda
  const offs = opts.jitter === false || opts.camAt ? [[0, 0]] : [[0, 0], [FRAME_JITTER, 0], [-FRAME_JITTER, 0], [0, FRAME_JITTER], [0, -FRAME_JITTER]];
  for (const [dx, dz] of offs) {
    const r = frameAt(built, x0 + dx, z0 + dz, yaw, opts);
    if (!worst || r.frac > worst.frac) worst = r;
  }
  return worst!;
}

function frameAt(built: Built, ax: number, az: number, yaw: number, opts: FrameOpts): FrameResult {
  const cover = coverGrid(built);
  const pivot = { x: ax, y: LOOK_Y, z: az };
  const raw = orbitPose(pivot, yaw, LOOK_DEFAULT, FOLLOW_DIST);
  if (raw.y < CAM_FLOOR) raw.y = CAM_FLOOR;
  const fc = resolveFollowCam(cover, { x: ax, z: az }, pivot, raw, { yaw, pitch: LOOK_DEFAULT, dist: FOLLOW_DIST, footY: 0, blocks: built.blocks });
  // sabit durum kamerası verildiyse o (bakış noktası göğüs); göz yedeği kapalı kare
  const steady = opts.camAt ? opts.camAt(ax, az, yaw) : undefined;
  if (steady === null) return { frac: 1, cam: [ax, LOOK_Y, az], mode: "eye" };
  if (steady) { fc.x = steady.cam[0]; fc.y = steady.cam[1]; fc.z = steady.cam[2]; fc.lx = ax; fc.ly = LOOK_Y; fc.lz = az; fc.mode = "orbit"; }
  const cam: V3 = [fc.x, fc.y, fc.z];
  if (fc.mode === "eye") return { frac: 0, cam, mode: fc.mode };
  const chest: V3 = [ax, LOOK_Y, az];
  // WalkRig'in kesiti (aynı saf plan: `walkCutPlan` + CPU ikizi `planCuts`): atılan blok görünmez, sayılmaz. İnce direk (lamba)
  // çoğu zaman atılmaz — denetimdeki "avatarın arkasındaki lamba direği" budur.
  const plan = walkCutPlan({ cover, avatar: { x: ax, z: az, foot: 0 }, chest, cam, first: false, rule: null, shape: null });
  const R = steady ? STEADY_R : FOLLOW_DIST + 1.5; // profil kamerası takip mesafesinden uzakta olabilir
  const all = opts.extra?.length ? [...standing(built, ax, az, R), ...standingOf(opts.extra, ax, az, R)] : standing(built, ax, az, R);
  const boxes = all.filter((b) => Math.max(b.hi[0] - b.lo[0], b.hi[2] - b.lo[2]) < THIN
    || !planCuts(plan, { p: [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2], s: [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]] }));
  // UXF-E: bakış çizgisindeki ince dikey direk (avatarın "arkasında" okunur)
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const onLine = boxes.some((b) => {
    if (b.hi[1] < CENTER_TOP || b.lo[1] > CENTER_BASE || Math.max(b.hi[0] - b.lo[0], b.hi[2] - b.lo[2]) >= CENTER_THIN) return false;
    const dx = (b.lo[0] + b.hi[0]) / 2 - ax, dz = (b.lo[2] + b.hi[2]) / 2 - az;
    const along = dx * fx + dz * fz, side = -dx * fz + dz * fx;
    const hw = (Math.abs(fz) * (b.hi[0] - b.lo[0]) + Math.abs(fx) * (b.hi[2] - b.lo[2])) / 2;
    return along > CENTER_NEAR && along < CENTER_FAR && Math.abs(side) < CENTER_HALF + hw;
  });
  // kamera tabanı: ileri (bakış noktası), sağ, yukarı
  const f: V3 = [fc.lx - cam[0], fc.ly - cam[1], fc.lz - cam[2]];
  const fl = Math.hypot(f[0], f[1], f[2]) || 1;
  f[0] /= fl; f[1] /= fl; f[2] /= fl;
  const rl = Math.hypot(f[2], f[0]) || 1;
  const right: V3 = [-f[2] / rl, 0, f[0] / rl];
  const up: V3 = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
  const aspect = opts.aspect ?? FRAME_ASPECT;
  const vfov = (walkFov(steady ? steady.fov : opts.fovSet ?? WALK_FOV_DEFAULT, aspect) * Math.PI) / 180; // profilin açısı
  const th = Math.tan(vfov / 2), tw = th * aspect;
  const chestD = Math.hypot(chest[0] - cam[0], chest[1] - cam[1], chest[2] - cam[2]);
  const reach = chestD + FRAME_BEYOND;
  let blocked = 0;
  // ARRIVAL-QA: orta pencere (avatarın üstü ve iki yanı) avatarın hemen önündeki tabela/direk/gövdeyle kapalı mı; kamera ile
  // avatarın omuz çizgisi arasında, karenin orta %70'inde dikey direk/ağaç gövdesi var mı (<city> tabela direği, <city> palmiye)
  let cN = 0, cHit = 0;
  const column = columnsOf(boxes).some((b) => {
    if (b.hi[1] < COLUMN_TOP || b.lo[1] > CENTER_BASE || Math.max(b.hi[0] - b.lo[0], b.hi[2] - b.lo[2]) >= COLUMN_THIN) return false;
    const dx = (b.lo[0] + b.hi[0]) / 2 - cam[0], dz = (b.lo[2] + b.hi[2]) / 2 - cam[2];
    const fh = Math.hypot(fc.lx - cam[0], fc.lz - cam[2]) || 1, ux = (fc.lx - cam[0]) / fh, uz = (fc.lz - cam[2]) / fh;
    const along = dx * ux + dz * uz, side = dx * uz - dz * ux;
    return along > 0.3 && along < Math.hypot(ax - cam[0], az - cam[2]) + COLUMN_BEYOND && Math.abs(side / along) < COLUMN_U * tw;
  });
  // kaba tarama (aday eleme): yarı çözünürlük
  const NX = opts.coarse ? FRAME_RAYS_X / 2 : FRAME_RAYS_X, NY = opts.coarse ? FRAME_RAYS_Y / 2 : FRAME_RAYS_Y;
  for (let yi = 0; yi < NY; yi++) for (let xi = 0; xi < NX; xi++) {
    const sx = ((xi + 0.5) / NX * 2 - 1) * tw, sy = (1 - (yi + 0.5) / NY * 2) * th;
    const inCenter = Math.abs(sx) < 0.2 * tw && sy > -0.2 * th && sy < 0.6 * th; // ARRIVAL-QA
    const d: V3 = [f[0] + right[0] * sx + up[0] * sy, f[1] + right[1] * sx + up[1] * sy, f[2] + right[2] * sx + up[2] * sy];
    const dl = Math.hypot(d[0], d[1], d[2]);
    d[0] /= dl; d[1] /= dl; d[2] /= dl;
    let t = Infinity;
    for (const b of boxes) { const h = hitBox(cam, d, b); if (h < t) t = h; }
    // kameraya yakın (avatarın en çok `FRAME_BEYOND` ötesine dek) ayakta yüzey engeldir; avatarın kendisi (göğüs ± pay) değil
    if (t < reach && Math.abs(t - chestD) > AVATAR_PAD * (Math.abs(sx) < 0.12 && Math.abs(sy) < 0.25 ? 1 : 0)) blocked++;
    if (inCenter) { cN++; if (t > chestD - 0.2 && t < chestD + CENTER_VIEW_FAR) cHit++; } // ARRIVAL-QA
  }
  const center = cN ? cHit / cN : 0; // ARRIVAL-QA
  const hidden = avatarHidden([...boxes, ...stationBoxes(built.stations)], cam, ax, az); // istasyon (bank + oturan ajan) da
  const arrival = (opts.strict === true && (column || hidden || center > CENTER_VIEW_MAX)) || (opts.strictCenter === true && center > CENTER_VIEW_MAX); // ARRIVAL-QA;
  // sabit durum kamerasıyla bakış çizgisindeki ince direk yerine orta pencere ölçüsü (strictCenter) geçerli
  return { frac: Math.max(blocked / (NX * NY), (onLine && !opts.camAt) || arrival ? CENTER_PENALTY : 0), cam, mode: fc.mode, center, column };
}

/**
 * UXF-D — şehir haritasından ofise dönüş karesi. Avatar kapının içeri komşusuna, yüzü ofise dönük bırakılır; kamera eskiden
 * şehirdeki yaw'da kalıyor, çoğu zaman kapı kemerine/kenara yaslanıp ilk karelerde ekranı kaplıyordu. Burada giriş karesi gibi
 * (`SPAWN_FRAME_MAX`) ölçülür: önce bu karoda `prefer` (ofise bakış) ve ona en yakın 45°'lik yönler; hiçbiri eşiği
 * geçmezse en çok `RETURN_NUDGE` karo içindeki, aynı yürüme bileşenindeki en yakın karolar (kapının önü dar/kalabalık
 * sahneler: <city>, <city>). Eşiği geçen ilk poz, yoksa en az engellisi. `extra`: kapının çizim blokları (kemer, iskele)
 * — dünyanın bloklarında yoklar ama kareye girerler.
*/
export const RETURN_NUDGE = 3;
/** kadrajı temiz poz yakında yoksa en çok bu kadar karo (sabit durum kamerasıyla).*/
export const RETURN_FAR = 7;
/** kamera bir kaçınılan karonun (kapı/tetik) merkezine yatayda 1,1'den yakın mı (geçit perdesi kareyi kaplar).*/
function camNearAvoid(s: { cam: V3 } | null, avoid: (i: number, j: number) => boolean): boolean {
  if (!s) return false;
  const c = s.cam;
  const ci = Math.floor(c[0] + 12), cj = Math.floor(c[2] + 8);
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++)
    if (avoid(ci + di, cj + dj) && Math.hypot(tx(ci + di) - c[0], tz(cj + dj) - c[2]) < 1.1) return true;
  return false;
}
export function framedReturn(built: Built, tile: Tile, prefer: number, extra: readonly Block[] = [],
  avoid: (i: number, j: number) => boolean = () => false /* ARRIVAL-QA: kapı/tetik karoları (dönüş kapıya bırakmaz) */,
  view: ((t: Tile, yaw: number) => boolean) | null = null /* ARRIVAL-QA: bakış açık mı (duvara bakan aday elenir; hiçbiri geçmezse yok sayılır) */,
  turns = 5 /* ARRIVAL-QA: önce yalnız kapıya sırtı dönük yönler (tercih ±90°); eşiği geçen yoksa 8 yön (eski davranış)*/,
  fo: Pick<FrameOpts, "camAt" | "strictCenter"> & { nudge?: number } = {} /* kareyi sabit durum kamerasıyla ölç (arrivalCam.ts)*/,
  stepRule = true /* FIXPACK-D: ilk adım şartı; hiçbir aday kalmazsa önce yalnız bu şart düşer (ray açıklığı `view` kalır), sonra view=null */): { tile: Tile; yaw: number; frame: number } {
  const yaws = Array.from({ length: turns }, (_, k) => prefer + (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 4)));
  // CITYFIX1 (EXIT-STEP-001): bakılan yönde ilk adım engelli karoya çıkmaz (ileri tuşu boşa kalmasın); hiçbir aday geçmezse `view` yok sayılır
  const view0 = view;
  if (view && stepRule) { const v0 = view; view = (t, yaw) => v0(t, yaw) && !built.blocked.has(`${t[0] + Math.round(Math.sin(yaw))},${t[1] + Math.round(Math.cos(yaw))}`); }
  const { labels } = components(built);
  const W = built.width, home = labels[tile[1] * W + tile[0]];
  const tiles: Tile[] = avoid(tile[0], tile[1]) ? [] : [tile];
  const ring: { t: Tile; d: number }[] = [];
  const R = fo.nudge ?? RETURN_NUDGE;
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
    const i = tile[0] + di, j = tile[1] + dj;
    if ((!di && !dj) || i < 0 || j < 0 || i >= W || j >= built.depth) continue;
    if (built.blocked.has(`${i},${j}`) || labels[j * W + i] !== home || home < 0 || avoid(i, j)) continue;
    ring.push({ t: [i, j], d: di * di + dj * dj });
  }
  ring.sort((a, b) => a.d - b.d || a.t[1] - b.t[1] || a.t[0] - b.t[0]);
  for (const r of ring) tiles.push(r.t);
  if (!tiles.length) tiles.push(tile); // ARRIVAL-QA: hepsi kaçınılan karoysa eski davranış
  let best: { tile: Tile; yaw: number; frame: number } | null = null;
  let bestQuick: { tile: Tile; yaw: number; quick: number } | null = null;
  // kapı karosu (çıkış karosunun tercih yönünün tersi); komşu karoda tercih ±90° yine kapıya dönük olabilir
  // (kapının yanındaki karodan çapraz) — ilk geçişlerde her aday karodan kapıya dönük yön elenir
  const doorT: Tile = [tile[0] - Math.round(Math.sin(prefer)), tile[1] - Math.round(Math.cos(prefer))];
  const lim = fo.camAt ? SPAWN_FRAME_MAX - 0.02 : SPAWN_FRAME_MAX; // ölçü payı (denetimin ışın ızgarası ve yakın yarıçapı biraz farklı)
  for (const t of tiles) for (const yaw of yaws) {
    if (view && !view(t, yaw)) continue; // ARRIVAL-QA
    if (fo.camAt && camNearAvoid(fo.camAt(tx(t[0]), tz(t[1]), yaw), avoid)) continue; // kamera kapının geçit perdesinde
    if (turns < 8 && (t[0] !== doorT[0] || t[1] !== doorT[1]) && Math.abs(Math.atan2(Math.sin(yaw - Math.atan2(t[0] - doorT[0], t[1] - doorT[1])), Math.cos(yaw - Math.atan2(t[0] - doorT[0], t[1] - doorT[1])))) > Math.PI / 2 + 1e-6) continue;
    const quick = spawnFrame(built, t, yaw, { jitter: false, coarse: true, extra, ...fo }).frac;
    if (!bestQuick || quick < bestQuick.quick - 1e-9) bestQuick = { tile: t, yaw, quick };
    if (quick > lim + (fo.camAt ? 0.05 : 0) && (best || t !== tile)) continue; // kaba ölçü payı (yarım çözünürlük ±0,03)
    const frame = spawnFrame(built, t, yaw, { extra, ...fo }).frac;
    if (!best || frame < best.frame - 1e-9) best = { tile: t, yaw, frame };
    if (frame <= lim) return { tile: t, yaw, frame };
  }
  // ARRIVAL-QA: hiçbir yön açık değil. FIXPACK-D: önce yalnız adım şartı düşer (view/ray açıklığı ≥ 3 kalır), o da boşsa view=null
  if (view && !bestQuick) return framedReturn(built, tile, prefer, extra, avoid, stepRule ? view0 : null, turns, fo, false);
  // kapının önü dar (iki yanı yüksek duvar: Marakeş geçidi) — kapıya sırtı dönük temiz kadraj `RETURN_FAR` karoya dek aranır
  // (yine aynı yürüme bileşeni; kapıya dönük 8 yön yedeğinden önce)
  if (turns < 8 && fo.camAt && R < RETURN_FAR) {
    const far = framedReturn(built, tile, prefer, extra, avoid, view0, turns, { ...fo, nudge: RETURN_FAR }, stepRule);
    if (far.frame <= lim) return far;
  }
  if (turns < 8) { // ARRIVAL-QA: kapıya sırtı dönük kadrajı temiz poz yok → 8 yönle (kapı kemeri ±90° dışında kalabilir)
    const all = framedReturn(built, tile, prefer, extra, avoid, view0, 8, fo, stepRule);
    if (all.frame <= lim || !best || all.frame < best.frame) return all;
  }
  // hiçbir poz eşiği geçmedi: kaba ölçüde en iyisi de tam ölçülür, en az engelli seçilir
  if (bestQuick) {
    const frame = spawnFrame(built, bestQuick.tile, bestQuick.yaw, { extra, ...fo }).frac;
    if (!best || frame < best.frame) best = { tile: bestQuick.tile, yaw: bestQuick.yaw, frame };
  }
  return best!;
}
