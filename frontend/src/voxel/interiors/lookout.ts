/**
 * NONCITY-QA (ürün sahibi 2026-10-29: "seyir terasına çıkınca F'ye basınca dürbün hiçbir şey yapmıyor") — seyir noktası (dürbün) görüşü
 * ve görüş boşluğu denetimi (VIEW-VOID-001).
 *
 * Kök neden: `vp:` öğesi F'de yalnız keşif kaydı yapıyordu (`hitVp` → `discoverExplore`); kayıt zaten yürüyerek (komşu karo)
 * düşmüş olduğundan ikinci F sessizce hiçbir şey yapmıyordu ve dürbün hiçbir görüntü göstermiyordu. Manzara kipi (walk/
 * landmarkView.ts) iç mekânda hedef bulmuyordu (`viewTargets` iç mekânda boş).
 *
 * Bu modül (saf; React/three yok):
 * - `vpFacing(lv, tile)`: dürbünün dışa baktığı yön (ayak izinin en yakın kenarı; tarifler dürbünü kenara koyar).
 * - `viewCone(eye, dir, blocks)`: göz noktasından bakış konisinde (yaw ±30°, eğim −24°…0°) ışınlar → çarpma oranı, ufuk bandı
 * (eğim ≥ −6°) çarpma oranı ve çarpma noktaları. Katın kendi korkuluğu/dürbünü sayılmaz (göze `VIEW_MIN` birimden yakın).
 * - `lookoutTarget(lv, blocks)` / `lookoutAim`: dürbünün manzara hedefi (`LandmarkViewTarget`): F → manzara kipi dürbünün
 * baktığı yöndeki ANLAMLI orta uzaklık hedefine kadraj kurar (HORIZON; ürün sahibi: "dürbün en uzak tepelere zum yapıyor"): taban
 * şehrin simge yapısı, çevrenin simge silüeti (kubbe, köprü, kule), şehir bandının yüksek çekirdeği, olmazsa yakın yapı
 * kümesi ya da su; tepe/orman/dağ (scenePano `meta.hill`) hedef olmaz. Hedefin tabanı (`y0`) panoramanın zeminidir: manzara
 * kipi kutuyu katın altındaki gerçek bloklardan kurar (eskiden kat zemininin üstündeki boş kutuya, yani ufuktaki tepeye bakıyordu).
 * - `viewVoid(…)`: VIEW-VOID-001 — görüş konisi `VIEW_RANGE` içinde gökten başka bir şeye (zemin, çevre, ufuk bandı) yeterince
 * çarpmıyorsa bulgu.
*/
import { tx, tz, type Block, type Tile } from "../scenes";
import type { LandmarkViewTarget } from "../walk/landmarkView";
import type { InteriorLevel } from "./generate";
import { baseWorld } from "./placement";
import { horizonOf, surroundMeta } from "./scenePano";
import { isPanoRidge } from "./cityPano";
import { deckLandmarkRects, towerDeckOf, type TowerDeck } from "./towerDeck";

/** Göz yüksekliği (yürüme ölçeği; walk/scale.ts EYE_Y) — güvertede dürbünün dürbün gözü 0,76; avatar gözü 0,91. */
export const LOOK_EYE_Y = 0.91;
/** Işın uzunluğu (birim = karo): sis bunun ötesinde (güverte sisi taban sisi + 14…50). */
export const VIEW_RANGE = 80;
/** Bundan yakın çarpma sayılmaz (kendi korkuluk, dürbün, kenar saksısı). */
export const VIEW_MIN = 2;
export const VIEW_YAWS_DEG = [-30, -15, 0, 15, 30] as const;
export const VIEW_PITCH_DEG = [-24, -16, -10, -6, -3, 0] as const;
/** VIEW-VOID-001 eşikleri: bütün koninin en az %60'ı, ufuk bandının (eğim ≥ −6°) en az üçte biri bir şeye çarpar. */
export const VOID_MIN_HIT = 0.6;
export const VOID_MIN_HORIZON = 1 / 3;
const HORIZON_PITCH = -6;

type V3 = [number, number, number];
export interface ConeHit { yaw: number; pitch: number; t: number; p: V3 }
export interface ConeResult { rays: number; hits: number; hRays: number; hHits: number; ratio: number; horizon: number; points: ConeHit[] }

/** Dürbünün dışa baktığı yön (dx, dz): karonun ayak izinin en yakın kenarı (eşitlikte +z, tariflerin varsayılanı). */
export function vpFacing(lv: Pick<InteriorLevel, "built"> & { kind?: string }, tile: Tile): [number, number] {
  if (lv.kind === "courtyard") return [0, -1]; // COURTYARD-PORTAL: avluda bakış harim cephesine (−z), ızgara kenarına değil
  const w = lv.built.width, d = lv.built.depth, [i, j] = tile;
  const cand: [number, [number, number]][] = [[d - 1 - j, [0, 1]], [j, [0, -1]], [w - 1 - i, [1, 0]], [i, [-1, 0]]];
  cand.sort((a, b) => a[0] - b[0]);
  return cand[0][1];
}

/** Bloğun çarpışılabilir olup olmadığı (bulut, kar, su altı ışık huzmesi görüşü kesmez; su yüzü keser). */
const opaque = (b: Block) => b.g !== "cloud" && b.g !== "snow";

/** Işın–AABB kesişimi (giriş parametresi; yoksa Infinity). */
function rayBox(o: V3, d: V3, b: Block, tMax: number): number {
  let t0 = 0, t1 = tMax;
  for (let k = 0; k < 3; k++) {
    const lo = b.p[k] - b.s[k] / 2, hi = b.p[k] + b.s[k] / 2;
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo || o[k] > hi) return Infinity; continue; }
    let a = (lo - o[k]) / d[k], c = (hi - o[k]) / d[k];
    if (a > c) { const s = a; a = c; c = s; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/**
 * Bakış konisi: `eye` noktasından `dir` (yatay birim) çevresinde ışınlar. `blocks`: katın çizilen bütün blokları (kat + panorama +
 * çevre + şehir halkası); `seaY`: katın okyanus düzlemi (sceneModel `envFor`: iskelede `pano.sea`, okyanuslu sahnede taban − iniş). Göze `VIEW_MIN`'den yakın çarpmalar (kendi korkuluk) atlanır: ışın onların ötesinden sürer.
 */
export function viewCone(eye: V3, dir: [number, number], blocks: readonly Block[], range = VIEW_RANGE, seaY: number | null = null): ConeResult {
  const yaw0 = Math.atan2(dir[0], dir[1]);
  // koninin 2B kutusu: ön yarı düzlem + yanlar (ön eleme)
  const reach = range + 2;
  const cand: Block[] = [];
  for (const b of blocks) {
    if (!opaque(b)) continue;
    const rx = b.p[0] - eye[0], rz = b.p[2] - eye[2], ext = Math.max(b.s[0], b.s[2]) / 2 + 1;
    if (rx * dir[0] + rz * dir[1] < -ext) continue;
    if (Math.hypot(rx, rz) - ext > reach) continue;
    cand.push(b);
  }
  const points: ConeHit[] = [];
  let rays = 0, hits = 0, hRays = 0, hHits = 0;
  for (const yd of VIEW_YAWS_DEG) for (const pd of VIEW_PITCH_DEG) {
    const yaw = yaw0 + (yd * Math.PI) / 180, pitch = (pd * Math.PI) / 180;
    const c = Math.cos(pitch);
    const d: V3 = [Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c];
    let best = Infinity;
    // okyanus düzlemi (iskele/kıyı sahnesi; blok değil, World.tsx düzlemi): aşağı bakan ışın yüzeye çarpar
    if (seaY !== null && d[1] < -1e-6) { const t = (seaY - eye[1]) / d[1]; if (t >= VIEW_MIN && t < range) best = t; }
    for (const b of cand) {
      const t = rayBox(eye, d, b, range);
      if (t < VIEW_MIN || t >= best) continue;
      best = t;
    }
    rays++;
    const horizon = pd >= HORIZON_PITCH;
    if (horizon) hRays++;
    if (best < range) {
      hits++; if (horizon) hHits++;
      points.push({ yaw: yd, pitch: pd, t: best, p: [eye[0] + d[0] * best, eye[1] + d[1] * best, eye[2] + d[2] * best] });
    }
  }
  return { rays, hits, hRays, hHits, ratio: rays ? hits / rays : 0, horizon: hRays ? hHits / hRays : 0, points };
}

/** Katın okyanus düzlemi (sceneModel.ts `envFor` ile aynı): iskelede `pano.sea`, okyanuslu taban sahnede taban y − iniş; yoksa null. */
export function levelSeaY(lv: Pick<InteriorLevel, "pano" | "outdoor">, baseOcean: { y: number } | null | undefined): number | null {
  if (!lv.outdoor) return null;
  // gerçek şehir güvertesinde deniz şehrin deniz yüzünde (envFor ile aynı; oyun `def.ocean.y` kullanır)
  const td = "site" in lv ? towerDeckOf(lv as InteriorLevel) : null;
  if (td) return td.seaY;
  if (lv.pano?.sea != null) return lv.pano.sea;
  return baseOcean ? baseOcean.y - (lv.pano?.drop ?? 0) : null;
}

/** Seyir noktasının göz noktası (dürbün karosunun merkezi, avatar göz yüksekliği; kat zemini y = 0). */
export const vpEye = (tile: Tile): V3 => [tx(tile[0]), LOOK_EYE_Y, tz(tile[1])];

/** VIEW-VOID-001 kararı: koni yeterince doluysa null, boşsa açıklama. */
export function viewVoid(c: ConeResult): string | null {
  if (c.ratio >= VOID_MIN_HIT && c.horizon >= VOID_MIN_HORIZON) return null;
  return `görüş konisinin %${Math.round(c.ratio * 100)}'i (ufuk bandı %${Math.round(c.horizon * 100)}) ${VIEW_RANGE} karo içinde bir şeye çarpıyor `
    + `(gerekli %${Math.round(VOID_MIN_HIT * 100)} / %${Math.round(VOID_MIN_HORIZON * 100)}) — sonsuzluğa bakıyor`;
}

// ------------------------------------------------------------------------------------------ dürbün hedefi (HORIZON)
/** Dürbün ışın yelpazesi: yaw ±30° (6° adım), eğim −40°…+2° (2° adım; yüksek güverteden yakındaki simge de görünsün). */
const AIM_YAWS = Array.from({ length: 11 }, (_, k) => -30 + k * 6);
const AIM_PITCHES = Array.from({ length: 22 }, (_, k) => -40 + k * 2);
/** Hedef uzaklık bandı (karo): yakın korkuluk/komşu çatı ve sisin içindeki uzak sırt dışarıda. */
export const AIM_MIN = 5;
export const AIM_MAX = 72;
/** güverte gerçek kule yüksekliğine çıkınca (Londra ~62, <city> ~70 birim) −40° ışını bile 72 karoda yere inmiyordu
 * (dürbün hedefsiz): menzil, gözün sokaktan yüksekliğinin 1,9 katından kısa olmaz (−40° ışını 1,56 katında iner).*/
export const aimRange = (groundY: number) => Math.max(AIM_MAX, Math.ceil(1.9 * (LOOK_EYE_Y - groundY)));
/** Hedef türü ağırlıkları: taban simgesi > çevre simge silüeti > şehir bandı çekirdeği > yapı kümesi > su > zemin. */
const AIM_W = { landmark: 3, item: 2, skyline: 0.7, structure: 1, water: 0.2, ground: 0.1 } as const;
export type AimKind = keyof typeof AIM_W | "hill";
/** Tek bloğun çarpma payı bunu aşan yapı/simge grubu "düz duvar" sayılır.*/
export const AIM_FLAT = 0.5;
/** su/zemin hedefi yerine seçilen simge/yapı grubunun puanı en az bu pay (binoc_frame_check DURBUN-KADRAJ-001).*/
export const AIM_SEA_KEEP = 0.2;
/** dürbünün göstermesi gereken hedef türleri ve önde yoksa taranan öteki yönler (derece).*/
const AIM_SUBJECT: ReadonlySet<AimKind> = new Set<AimKind>(["landmark", "item", "skyline"]);
export const AIM_TURNS = [60, -60, 120, -120, 180] as const;
/** dürbün hedefinin çarpma ortası gözden en az bu kadar uzak (birim; uzakta aday yoksa yakın kalır).*/
export const AIM_NEAR = 6; // 8'de Sultanahmet avlusu kamerası revağın içine düşüyordu
export interface AimHit { yaw: number; pitch: number; t: number; p: V3; b: Block | null; kind: AimKind; group: string }
export interface LookoutAim { target: LandmarkViewTarget; kind: AimKind; center: V3; hits: number }

interface Rect3 { x0: number; x1: number; z0: number; z1: number; key: string; kind: "landmark" | "item" | "skyline" | "water" }
const inR = (r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;

/** Katın çerçevesinde odak dikdörtgenleri: taban simge bölgeleri (katın kendi yapısı hariç) + çevre odakları (scenePano). */
function focusRects(lv: Pick<InteriorLevel, "built" | "scene" | "pano">, td: TowerDeck | null = null): Rect3[] {
  const out: Rect3[] = [];
  // gerçek şehir güvertesinde çevre şehrin simgeleri (eskiden odak yoktu: Galata dürbünü düz bir küp yapıya bakıyordu)
  // yalnız Kız Kulesi'nde iskele binası dürbün hedefi olmaz (öteki şehirlerde iskele gerçek hedef: Londra terası)
  if (td) return deckLandmarkRects(td).filter((r) => td.landmark !== "kiz_kulesi" || !/_iskele$/.test(r.key)).map(({ h: _h, ...r }) => ({ ...r, key: `lm:${r.key}`, kind: "landmark" as const }));
  const pano = lv.pano;
  if (!pano) return out;
  const { dx, dz } = pano;
  const w = lv.built.width, d = lv.built.depth;
  const lcx = (tx(0) + tx(w - 1)) / 2, lcz = (tz(0) + tz(d - 1)) / 2;
  const base = baseWorld(lv.scene);
  for (const z of base?.zones ?? []) {
    if (z.kind !== "landmark" || z.w <= 0 || z.d <= 0) continue;
    const r = { x0: tx(z.i0) - 0.5 + dx, x1: tx(z.i0 + z.w - 1) + 0.5 + dx, z0: tz(z.j0) - 0.5 + dz, z1: tz(z.j0 + z.d - 1) + 0.5 + dz };
    if (inR(r, lcx, lcz, 1)) continue; // katın kendi yapısı (kule, kale)
    out.push({ ...r, key: `lm:${z.tag ?? `${z.i0},${z.j0}`}`, kind: "landmark" });
  }
  surroundMeta(lv.scene)?.focus.forEach((f, k) => {
    if (f.kind === "water") return; // su ayrıca (blok türünden) sayılır
    out.push({ x0: f.x0 + dx, x1: f.x1 + dx, z0: f.z0 + dz, z1: f.z1 + dz, key: `${f.kind}:${k}`, kind: f.kind });
  });
  return out;
}

/** Bloğun türü (odak dışında): tepe rengi → tepe; su → su; geniş alçak levha → zemin; yoksa yapı. */
function blockKind(b: Block, hill: ReadonlySet<string> | null, water: string | null): AimKind {
  if (hill?.has(b.c) || isPanoRidge(b.c)) return "hill"; // şehir iç mekânı halkasının uzak sırtı da tepe
  if (b.g === "water" || b.g === "wave" || (water && b.c === water)) return "water";
  if (b.s[1] <= 0.35 || (b.s[1] <= 0.5 && Math.max(b.s[0], b.s[2]) >= 3)) return "ground"; // döşeme, yol, levha
  return "structure";
}

const aimCache = new WeakMap<readonly Block[], Map<string, LookoutAim | null>>();
/**
 * Dürbün hedefi: göz noktasından dürbünün yönünde ışın yelpazesi (`AIM_YAWS` × `AIM_PITCHES`). Her çarpma bir gruba yazılır
 * (taban simge bölgesi, çevre odağı, 4 × 4 karoluk yapı hücresi, su, zemin); tepe çarpmaları sayılmaz. Grup puanı = Σ tür ağırlığı ×
 * uzaklık ağırlığı (orta uzaklık 10–48 karo tam, yakın/uzak azalır) × yön ağırlığı (merkeze yakın) × yükseklik payı. En yüksek puanlı
 * grubun dikdörtgeni hedef olur (simgede simgenin ayak izi; hücrede çarpmaların kutusu ±1). `y0`: hedefin zemini (panorama inişi).
 * `center`: grubun çarpma noktalarının ortası — dürbünün merkez ışını oraya gider (interaction_audit denetler).
*/
export function lookoutAim(lv: Pick<InteriorLevel, "built" | "scene" | "site" | "pano" | "cityPano">, tile: Tile, blocks: readonly Block[], seaY: number | null = null,
  debug?: (groups: { key: string; kind: AimKind; score: number; n: number; top: number; blocks: number; sizes: string[] }[]) => void): LookoutAim | null {
  let m = aimCache.get(blocks);
  if (!m) { m = new Map(); aimCache.set(blocks, m); }
  const ck = `${tile[0]},${tile[1]}`;
  if (m.has(ck) && !debug) return m.get(ck)!;
  const dir = vpFacing(lv, tile), eye = vpEye(tile);
  const td = "key" in lv ? towerDeckOf(lv as InteriorLevel) : null; // gerçek şehir güvertesinde sokak gerçek inişte
  const groundY = td ? td.groundY : lv.pano ? -lv.pano.drop : lv.cityPano ? -lv.cityPano.elev : 0;
  const meta = surroundMeta(lv.scene);
  const water = horizonOf(lv.scene)?.water ?? null;
  const focus = focusRects(lv, td);
  // aday bloklar: ön yarı düzlem ve menzil (koni eleme)
  const AMAX = aimRange(groundY);
  type Group = { score: number; kind: AimKind; pts: V3[]; rect: { x0: number; x1: number; z0: number; z1: number } | null; bs: Map<Block | null, number> };
  // yelpaze taraması bir yön için (yaw0); dürbünün önünde simge yoksa öteki yönler de taranır (AIM_TURNS)
  const sweep = (yaw0: number) => {
    const fx = Math.sin(yaw0), fz = Math.cos(yaw0), cand: Block[] = [];
    for (const b of blocks) {
      if (!opaque(b)) continue;
      const rx = b.p[0] - eye[0], rz = b.p[2] - eye[2], ext = Math.max(b.s[0], b.s[2]) / 2 + 1;
      if (rx * fx + rz * fz < -ext || Math.hypot(rx, rz) - ext > AMAX + 2) continue;
      cand.push(b);
    }
    const groups = new Map<string, Group>();
    let n = 0;
    for (const yd of AIM_YAWS) for (const pd of AIM_PITCHES) {
      const yaw = yaw0 + (yd * Math.PI) / 180, pitch = (pd * Math.PI) / 180, c = Math.cos(pitch);
      const d: V3 = [Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c];
      let best = AMAX, hit: Block | null = null, sea = false;
      if (seaY !== null && d[1] < -1e-6) { const t = (seaY - eye[1]) / d[1]; if (t >= VIEW_MIN && t < best) { best = t; sea = true; } }
      for (const b of cand) {
        const t = rayBox(eye, d, b, best);
        if (t < VIEW_MIN || t >= best) continue;
        best = t; hit = b; sea = false;
      }
      if ((!hit && !sea) || best < AIM_MIN) continue;
      const p: V3 = [eye[0] + d[0] * best, eye[1] + d[1] * best, eye[2] + d[2] * best];
      let kind: AimKind = sea ? "water" : blockKind(hit!, meta?.hill ?? null, water);
      if (kind === "hill") continue;
      let key: string, rect: Rect3 | null = null;
      const f = kind === "structure" || (kind === "water" && !td) ? focus.find((r) => inR(r, p[0], p[2], 0.3)) : undefined; // güvertede simge ayak izine düşen deniz çarpması simge sayılmaz (merkez ışını denize)
      if (f) { kind = f.kind === "landmark" ? "landmark" : f.kind === "item" ? "item" : f.kind === "skyline" ? "skyline" : kind; key = f.key; rect = f; }
      else key = kind === "structure" ? `cell:${Math.floor(p[0] / 6)},${Math.floor(p[2] / 6)}` : kind;
      // orta uzaklık (10–40 karo) tam ağırlık; yakın korkuluk/komşu çatı ve sisteki uzak bant azalır
      const wd = best < 10 ? 0.45 + best * 0.055 : best <= 40 ? 1 : Math.max(0.3, 1 - (best - 40) / 45);
      const wy = 1 - Math.abs(yd) / 50;
      const wh = kind === "water" || kind === "ground" ? 1 : Math.min(1.6, 0.6 + Math.max(0, p[1] - groundY) / 4);
      const g = groups.get(key) ?? { score: 0, kind, pts: [] as V3[], rect, bs: new Map<Block | null, number>() };
      g.score += AIM_W[kind as keyof typeof AIM_W] * wd * wy * wh;
      g.pts.push(p);
      const hb = sea ? null : hit;
      g.bs.set(hb, (g.bs.get(hb) ?? 0) + 1);
      groups.set(key, g);
      n++;
    }
    // düz duvar kadrajı yok — simge grubunun çarpmalarının çoğu TEK iri gövde kutusuna düşüyorsa (panoramada simgenin
    // ayrıntısız gövdesi; ör. Londra saat kulesinden saray bloğu: 3 blok, %61'i tek kutu) dürbün boş bir duvara bakar → simge
    // ağırlığı yapı düzeyine iner (× 0,25). İnce/uzun parçalar (köprü tabliyesi, kule gövdesi) ve yapı hücreleri etkilenmez.
    for (const g of groups.values()) {
      if ((g.kind !== "landmark" && g.kind !== "item" && g.kind !== "structure") || g.pts.length < 6) continue; // yapı hücresi de (Galata: tek düz cephe kadrajın %58'i)
      let top: Block | null = null, c = 0;
      for (const [b, k] of g.bs) if (k > c) { c = k; top = b; }
      if (top && c / g.pts.length > AIM_FLAT && top.s[1] >= 2 && Math.max(top.s[0], top.s[2]) >= 3) g.score *= 0.25;
    }
    return { groups, n };
  };
  const yawF = Math.atan2(dir[0], dir[1]);
  let { groups, n } = sweep(yawF);
  // dürbün gözün dibindeki yapıyı göstermez (Ayasofya avlusu: 5 birim ötedeki şadırvan ve basamak) — çarpma
  // ortası AIM_NEAR'dan yakın grup, uzakta aday varken seçilmez
  const far = (g: Group) => Math.hypot(g.pts.reduce((a, q) => a + q[0], 0) / g.pts.length - eye[0], g.pts.reduce((a, q) => a + q[2], 0) / g.pts.length - eye[2]) >= AIM_NEAR;
  const anyFar = (gs: Map<string, Group>) => [...gs.values()].some(far);
  let pick: Group | null = null;
  const farOnly = anyFar(groups);
  for (const g of groups.values()) if ((!farOnly || far(g)) && (!pick || g.score > pick.score)) pick = g;
  // dürbün boş denize/zemine bakmaz — simge/yapı/silüet grubu suyun puanının en az AIM_SEA_KEEP'i ise o (Kız Kulesi: kadrajın %66'sı deniz)
  if (pick && (pick.kind === "water" || pick.kind === "ground")) {
    let alt: Group | null = null;
    for (const g of groups.values()) if (g.kind !== "water" && g.kind !== "ground" && (!farOnly || far(g)) && (!alt || g.score > alt.score)) alt = g;
    if (alt && alt.score >= pick.score * AIM_SEA_KEEP) pick = alt;
  }
  // (ürün sahibi "dürbün simgeyi göstermeli"): önde simge/silüet yoksa (Galata: düz bir küp yapı hücresi) dürbün öteki yönlerdeki
  // simgeye döner (manzara kipi kamerası hedefin çevresinde döner; dürbünün yüzü yalnız tarama başlangıcı)
  if (!pick || !AIM_SUBJECT.has(pick.kind)) {
    let alt: { g: Group; groups: typeof groups; n: number } | null = null;
    for (const turn of AIM_TURNS) {
      const s = sweep(yawF + (turn * Math.PI) / 180);
      for (const g of s.groups.values()) if (AIM_SUBJECT.has(g.kind) && far(g) && (!alt || g.score > alt.g.score)) alt = { g, ...s };
    }
    if (alt) ({ g: pick, groups, n } = alt);
  }
  // çok yüksek güvertede (Uçhisar zirvesi, sokaktan ~70) ışınlar kendi kaya gövdesine ya da menzil dışına düşer — hedef yoksa
  // şehrin en öne çıkan simgesi (yükseklik² / uzaklık), ışınsız: ayak izi ortası
  if (!pick && td) {
    let best: { r: ReturnType<typeof deckLandmarkRects>[number]; s: number } | null = null;
    for (const r of deckLandmarkRects(td)) {
      const s = (r.h * r.h) / (3 + Math.hypot((r.x0 + r.x1) / 2 - eye[0], (r.z0 + r.z1) / 2 - eye[2]));
      if (!best || s > best.s) best = { r, s };
    }
    if (best) {
      const { r } = best, on = blocks.filter((b) => opaque(b) && inR(r, b.p[0], b.p[2]) && b.p[1] + b.s[1] / 2 > groundY + 0.5).map((b) => [b.p[0], b.p[1], b.p[2]] as V3);
      pick = { score: best.s, kind: "landmark", rect: r, bs: new Map(), pts: on.length ? on : [[(r.x0 + r.x1) / 2, groundY + r.h / 2, (r.z0 + r.z1) / 2]] }; // simgenin blok merkezleri (dürbün merkez ışını gövdeye)
    }
  }
  debug?.([...groups].map(([key, g]) => ({ key, kind: g.kind, score: +g.score.toFixed(2), n: g.pts.length, top: +(Math.max(...g.bs.values()) / g.pts.length).toFixed(2), blocks: g.bs.size,
    sizes: [...g.bs].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b, k]) => `${k}:${b ? b.s.map((v) => +v.toFixed(1)).join("x") : "sea"}`) })).sort((a, b) => b.score - a.score));
  let out: LookoutAim | null = null;
  if (pick) {
    const P = pick.pts;
    const cx = P.reduce((a, q) => a + q[0], 0) / P.length, cz = P.reduce((a, q) => a + q[2], 0) / P.length, cy = P.reduce((a, q) => a + q[1], 0) / P.length;
    // su/zemin: kadraj dürbünle çarpmalar arasındaki orta noktaya. şehir silüeti artık bandın kendisine (çarpılan
    // yapıların kutusu) — orta noktada kadrajın yarısı boş zemin oluyordu (iskele/teras dürbünleri: zemin %54, içerik %15–24)
    const wide = pick.kind === "water" || pick.kind === "ground";
    const mx = eye[0] + (cx - eye[0]) * 0.6, mz = eye[2] + (cz - eye[2]) * 0.6;
    let r = wide ? { x0: mx - 9, x1: mx + 9, z0: mz - 9, z1: mz + 9 }
      : pick.rect && pick.kind !== "skyline" ? { x0: pick.rect.x0, x1: pick.rect.x1, z0: pick.rect.z0, z1: pick.rect.z1 }
      : { x0: Math.min(...P.map((q) => q[0])) - 1, x1: Math.max(...P.map((q) => q[0])) + 1, z0: Math.min(...P.map((q) => q[2])) - 1, z1: Math.max(...P.map((q) => q[2])) + 1 };
    // en az 6 × 4 karo, en çok 18 × 18 (manzara kipi ayak izi tavanı 400 karo²)
    const fit = (lo: number, hi: number, c: number, min: number, max: number) => {
      let a = lo, b = hi;
      if (b - a < min) { a = c - min / 2; b = c + min / 2; }
      if (b - a > max) { a = c - max / 2; b = c + max / 2; }
      return [a, b];
    };
    // yapı grubunun baskın iri gövdesi (Süleymaniye avlusu: harim cephesi 33 × 13,7) kutuya bütünüyle girer — dürbün
    // cephenin alt dilimine değil yapının bütününe kadraj kurar (cephe kadrajın yarısını kaplamaz)
    if (pick.kind === "structure") {
      let top: Block | null = null, c = 0;
      for (const [b, k] of pick.bs) if (b && k > c) { c = k; top = b; }
      if (top && top.s[1] >= 2 && Math.max(top.s[0], top.s[2]) >= 3 && top.s[1] <= 2 * Math.max(top.s[0], top.s[2])) { // ince uzun gövde (minare) değil
        r.x0 = Math.min(r.x0, top.p[0] - top.s[0] / 2); r.x1 = Math.max(r.x1, top.p[0] + top.s[0] / 2);
        r.z0 = Math.min(r.z0, top.p[2] - top.s[2] / 2); r.z1 = Math.max(r.z1, top.p[2] + top.s[2] / 2);
      }
    }
    const across0 = dir[0] === 0;
    [r.x0, r.x1] = fit(r.x0, r.x1, wide ? mx : cx, across0 ? 6 : 4, 18);
    [r.z0, r.z1] = fit(r.z0, r.z1, wide ? mz : cz, across0 ? 4 : 6, 18);
    const rect = { i0: Math.floor(r.x0 + 12), i1: Math.floor(r.x1 + 12 - 1e-6), j0: Math.floor(r.z0 + 8), j1: Math.floor(r.z1 + 8 - 1e-6) };
    // ölçekli gerçek şehirde hedef kutusu çarpılan yapıların tepesine kadar (bakış noktası bina gövdesinin içinde kalmaz)
    const h = td ? +(Math.max(...P.map((q) => q[1])) - groundY + 1).toFixed(2) : undefined;
    const inside = (q: V3): V3 => { const d = [q[0] - eye[0], q[1] - eye[1], q[2] - eye[2]], L = Math.hypot(d[0], d[1], d[2]) || 1; return [q[0] + (d[0] / L) * 0.3, q[1] + (d[1] / L) * 0.3, q[2] + (d[2] / L) * 0.3]; };
    out = { target: { key: `${lv.scene}:vp:${lv.site}`, rect, y0: +groundY.toFixed(3), ...(h ? { h } : {}) }, kind: pick.kind, center: inside(P.reduce((a, q) => (Math.hypot(q[0] - cx, q[1] - cy, q[2] - cz) < Math.hypot(a[0] - cx, a[1] - cy, a[2] - cz) ? q : a), P[0])), hits: n }; // çarpma ortasına en yakın GERÇEK çarpma noktası, 0,3 içeride (dağınık simge çarpmalarının ortası boşlukta kalabiliyordu:)
  }
  m.set(ck, out);
  return out;
}

/** Dürbünün manzara hedefi (`lookoutAim`; yoksa null: boşluk). F → manzara kipi (WalkRig). */
export function lookoutTarget(lv: Pick<InteriorLevel, "built" | "scene" | "site" | "pano" | "cityPano">, tile: Tile, blocks: readonly Block[], seaY: number | null = null): LandmarkViewTarget | null {
  return lookoutAim(lv, tile, blocks, seaY)?.target ?? null;
}
