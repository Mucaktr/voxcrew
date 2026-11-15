/**
 * CITYLIFE (ürün sahibi 2026-10-28) — **figüranlar**: şehir haritası semtlerinde (portaldan geçince gidilen yerler) ve büyüyen sahnenin
 * çevresinde dolaşan, ajan OLMAYAN insanlar. Kaldırımda/meydanda/parkta mantıklı noktalar arasında yürürler; vitrin önünde
 * dururlar, gerçek bank/kafe sandalyesine otururlar (havada oturma yok: `fun/seats.ts` oturak bulucusu), yemek tezgâhı önünde sıra
 * olurlar, simge önünde fotoğraf çekerler, durakta beklerler; araç şeridini yalnız dik keserek geçerler (boyunca yürümezler) ve
 * avatara yol verirler. Yoğunluk saate, havaya, semt türüne ve hareket azaltmaya göre değişir.
 *
 * Bu dosya saf çekirdektir (React/three/depo yok; test: scripts/citylife.test.mjs):
 * - `figTarget` yoğunluk (sert tavan `FIG_HARD_CAP`)
 * - `pedGrid` semtin yaya ızgarası: yürünür + şerit dışı; şerit ekseni (geçiş yalnız dik); parsel eşyası engeli
 * - `pedPath` 4-komşu BFS; şerit karosu yalnız şeride dik düz geçişle (≤ 4 karo) aşılır
 * - `planPois` vitrin, fotoğraf, durak noktaları (semt planından)
 * - `parcelPois` gerçek oturaklar ve eşya engelleri (parsel bloklarından)
 * - `figLook` belirlenimci görünüm (insan avatarı; şehrin yerel kostüm havuzundan pay; ad yok)
 * Çizim ve davranış döngüsü: `citylife/FiguransLayer.tsx`.
*/
import type { Avatar } from "../../lib/types";
import { BEARD_BY, HAIR_BY, OUTFIT_BY, type Presentation } from "../../lib/presentation";
import { ACCENT_COLORS, HAIR_COLORS, OUTFIT_COLORS, SKIN_TONES } from "../avatar";
import { localWearFor } from "../cosmetics/local/index";
import { isSeatSlab, seatHeading, topClear } from "../fun/seats";
import { lineRoute } from "../transit/model";
import type { Block } from "../scenes";
import { stopTile, type CityMapFile, type CityTile, type VehicleKind } from "../citymap/format";
import { T_BUILDING, T_PARK, T_PLAZA, T_RAIL, T_STREET, walkableKind } from "../citymap/district";
import { exitPose } from "../citymap/arrivalPoses";

// ------------------------------------------------------------------------------------------ ölçüler
/** Bir anda dolaşan figüran sert tavanı (semt + komşu parseller) ve yakın ayrıntı tavanı. */
export const FIG_HARD_CAP = 24;
export const FIG_NEAR_MAX = 18;
/** Yakın ayrıntı yarıçapı (dışında yalnız temel parçalar — uzak LOD) ve doğma/silinme yarıçapları (dünya birimi). */
export const FIG_NEAR_R = 22;
export const FIG_SPAWN_R = 22;
export const FIG_DESPAWN_R = 30;
/** Doğma noktası avatara en az bu kadar uzak (göz önünde belirmez; varışta ilk doluşta 4). */
export const FIG_SPAWN_MIN = 7;
/** Bir anda çizilen satıcı tavanı. */
export const VENDOR_MAX = 6;
/** Yürüme hızı (birim/sn; insan ölçeği) ve hareket azaltma çarpanı. */
export const FIG_SPEED = 1.05;
export const FIG_CALM_SPEED = 0.6;
/** Avatara yol verme: bu yakınlıkta yana çekilir, bundan yakına hiç girmez. */
export const YIELD_R = 1.2;
export const AVATAR_CLEAR = 0.55;
/** HQA-FIX: iki figüran arasında en az bu kadar (dünya birimi; insan omuz eni ~0,4) — sürü hâlinde iç içe yürümezler.*/
export const FIG_SEP = 0.42;

const THEME_K: Readonly<Record<string, number>> = { bazaar: 1.25, historic: 1.1, modern: 1.0, generic: 0.9, harbor: 0.9, garden: 0.8, hill: 0.75 };

export interface DensityCtx { hour: number; night: boolean; rain: boolean; theme: string; reduced: boolean; area: "district" | "outskirts" }
/** Hedef figüran sayısı: gündüz kalabalık, gece az (bir kısmı ışıklı kafelerde), yağmurda biraz az, hareket azaltmada yarı. */
export function figTarget(c: DensityCtx): number {
  const base = c.area === "outskirts" ? 6 : 24;
  const hourK = c.night ? 0.4 : c.hour < 7 ? 0.35 : c.hour < 10 ? 0.75 : c.hour < 20 ? 1 : 0.6;
  const k = hourK * (THEME_K[c.theme] ?? 0.9) * (c.rain ? 0.9 : 1); // yağmurda 0,75 → 0,9 (şemsiyeli figüran görülebilsin)
  // hareket azaltma tavandan SONRA yarıya iner (kalabalık semtte de yarı)
  const n = Math.min(FIG_HARD_CAP, base * k) * (c.reduced ? 0.5 : 1);
  return Math.max(c.area === "outskirts" ? 2 : 4, Math.min(FIG_HARD_CAP, Math.round(n)));
}

// ------------------------------------------------------------------------------------------ yaya ızgarası
/** Yerde giden araçlar (CityRig/district.ts GROUND_KINDS): rotası şerittir. */
export const LANE_KINDS: ReadonlySet<VehicleKind> = new Set<VehicleKind>(["tramvay", "funikuler", "metro", "otobus"]);
export const AX_X = 1, AX_Z = 2;

export interface PedGrid {
  i0: number; j0: number; w: number; d: number;
  /** semt karo türü (district.ts) */
  kind: Uint8Array;
  /** 1: araç şeridi */
  lane: Uint8Array;
  /** şeridin ekseni (AX_X | AX_Z; ikisi birden: kavşak — geçilmez) */
  laneAx: Uint8Array;
  /** 1: eşya (bank, lamba, saksı, tezgâh) — yürünmez, oturak hedefi olabilir */
  obst: Uint8Array;
  /** zemin yüksekliği (yürünür yükselti) */
  top: Float32Array;
  /** raylı hatların dünya çoklu çizgileri (gövde bandı için `railClear`)*/
  rails?: [number, number][][];
  /** raylı hatların durak konumları (dünya x, z) — araç durakta beklerken/kalkarken yanında durulmaz (`stationBand`)*/
  stations?: [number, number][];
}

interface PlanLike { i0: number; j0: number; w: number; d: number; kind: Uint8Array; top: Float32Array; lift?: Float32Array }

/** Rota çoklu çizgisinin karoları ve her karonun gidiş ekseni. */
export function rasterAxis(route: readonly CityTile[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let k = 0; k + 1 < route.length; k++) {
    let [x0, y0] = route[k];
    const [x1, y1] = route[k + 1];
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    const ax = dx >= -dy ? AX_X : AX_Z;
    let err = dx + dy;
    for (;;) {
      out.push([x0, y0, ax]);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  return out;
}

/** Semtin yaya ızgarası (şeritler: ray karoları + yerde giden hat rotaları). */
export function pedGrid(map: Pick<CityMapFile, "lines" | "districts" | "stops">, plan: PlanLike): PedGrid {
  const n = plan.w * plan.d;
  const g: PedGrid = { i0: plan.i0, j0: plan.j0, w: plan.w, d: plan.d, kind: plan.kind, lane: new Uint8Array(n), laneAx: new Uint8Array(n), obst: new Uint8Array(n), top: new Float32Array(n) };
  // (ürün sahibi 2026-10-31 "NPC'ler havada yürüyor"): `plan.top` yürünür karonun ZATEN yükselti dahil zemin üst yüzü (district.ts adım 6:
  // top = y); `lift` ile toplamak rampa/merdivende zemini ikiye katlıyordu (0,85 → 1,70: figüran 0,85 havada)
  for (let k = 0; k < n; k++) g.top[k] = plan.top[k];
  // raylı şerit (metro/tramvay/füniküler rotası ve ray karosu) `lane = 2` — figüran ona HİÇ girmez (karşıdan karşıya geçiş
  // dahil; eskiden dik geçiş serbestti, tren geçerken figüran rayın üstünde duruyor/trenin içinden geçiyordu). Karayolu şeridi (`1`) geçilebilir.
  const mark = (I: number, J: number, ax: number, rail = false) => {
    const li = I - plan.i0, lj = J - plan.j0;
    if (li < 0 || lj < 0 || li >= plan.w || lj >= plan.d) return;
    const k = lj * plan.w + li;
    g.lane[k] = rail ? 2 : g.lane[k] === 2 ? 2 : 1; g.laneAx[k] |= ax;
  };
  g.rails = [];
  for (const l of map.lines) {
    if (!LANE_KINDS.has(l.kind)) continue;
    let route: CityTile[];
    try { route = lineRoute(map as CityMapFile, l); } catch { continue; }
    for (const [I, J, ax] of rasterAxis(route)) mark(I, J, ax, l.kind !== "otobus");
    if (l.kind !== "otobus") {
      g.rails.push(route.map(([I, J]) => [I - 11.5, J - 7.5] as [number, number]));
      for (const id of l.stops) { const sp = map.stops.find((x) => x.id === id), t = sp ? stopTile(map as CityMapFile, sp) : null; if (t) (g.stations ??= []).push([t[0] - 11.5, t[1] - 7.5]); }
    }
  }
  // ray karoları (rota dışında kalan ray süsü de şerittir): ekseni komşulardan
  for (let lj = 0; lj < plan.d; lj++) for (let li = 0; li < plan.w; li++) {
    if (plan.kind[lj * plan.w + li] !== T_RAIL) continue;
    const r = (a: number, b: number) => a >= 0 && b >= 0 && a < plan.w && b < plan.d && plan.kind[b * plan.w + a] === T_RAIL;
    const ax = (r(li - 1, lj) || r(li + 1, lj) ? AX_X : 0) | (r(li, lj - 1) || r(li, lj + 1) ? AX_Z : 0);
    mark(plan.i0 + li, plan.j0 + lj, ax || AX_X | AX_Z, true);
  }
  return g;
}

const inG = (g: PedGrid, li: number, lj: number) => li >= 0 && lj >= 0 && li < g.w && lj < g.d;
/** Figüranın durabileceği karo: yürünür, şerit değil, eşya değil. */
export const pedOk = (g: PedGrid, li: number, lj: number) => inG(g, li, lj) && walkableKind(g.kind[lj * g.w + li]) && !g.lane[lj * g.w + li] && !g.obst[lj * g.w + li];
/**
 * (<city> geçidi: iki yürüyen figüran iç içe): `o` ile aralığı `sep`ten küçük `f`nin yeni konumu. Önce eski kural (radyal, ayrılığın
 * yarısı kadar); itilen karo kapalıysa (dar geçit, kaya kenarı) iki dik yönde denenir; hiçbiri açık değilse null →
 * çağıran önceki konuma döner ve bekler (eskiden kapalı karoda itme sessizce atlanıyor, iki figüran üst üste yürüyordu). Saf.
*/
export function sepNudge(g: PedGrid, f: { x: number; z: number }, o: { x: number; z: number }, sep = FIG_SEP): [number, number] | null {
  const sx = f.x - o.x, sz = f.z - o.z, sd = Math.hypot(sx, sz);
  if (sd >= sep || sd < 1e-4) return [f.x, f.z];
  const ux = sx / sd, uz = sz / sd, push = (sep - sd) * 0.5;
  for (const [dx, dz] of [[ux, uz], [-uz, ux], [uz, -ux]] as const) { // geriye (o'ya doğru) itilmez: ayrılığı azaltırdı
    const nx = f.x + dx * push, nz = f.z + dz * push;
    if (pedOk(g, Math.floor(nx + 12) - g.i0, Math.floor(nz + 8) - g.j0)) return [nx, nz];
  }
  return null;
}

/** HQA-FIX: karo bir taşıt şeridinin (ray, tramvay/otobüs hattı) 8-komşusu mu. Yürüme ölçeğinde tramvay/otobüs gövdesi şerit
 * karosundan taşar (yarı en > 0,5); bekleyen figüran (durak, vitrin, fotoğraf) şeridin hemen yanında dururken gövdenin içinde kalıyordu.*/
export const laneNear = (g: PedGrid, li: number, lj: number) => {
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && inG(g, li + di, lj + dj) && g.lane[(lj + dj) * g.w + li + di]) return true;
  return false;
};
/** HQA-FIX: figüranın uzun süre durabileceği karo — yürünür, şerit/eşya değil ve şeridin yanında değil.*/
export const standOk = (g: PedGrid, li: number, lj: number) => pedOk(g, li, lj) && !laneNear(g, li, lj);

/**
 * figüranın raylı aracın gövdesine girmeyen en yakın konumu. Gövde yarı eni 0,65 (`vehicleBlocks` W 1,3) + figüran
 * yarıçapı 0,2 + pay = `RAIL_CLEAR`; ray karosunun komşusu karo merkezi rotadan 1,0 uzaktır ve doğma payı (± 0,15) + yanal pay (± 0,18)
 * figüranı gövdenin içine (0,67) sokuyordu (<city> tramvay gövdesinin içinden geçen, Londra'da rayın üstünde duran figüran).
 * Rota çizgisine (ve rota dışı ray karolarına) bu uzaklıktan yakınsa radyal dışarı itilir. Saf.
*/
export const RAIL_CLEAR = 0.9;
export function railClear(g: PedGrid, x: number, z: number): [number, number] {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const poly of g.rails ?? []) {
      for (let k = 0; k + 1 < poly.length; k++) {
        const [ax, az] = poly[k], [bx, bz] = poly[k + 1];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        const u = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
        const px = ax + dx * u, pz = az + dz * u, ex = x - px, ez = z - pz, d = Math.hypot(ex, ez);
        if (d >= RAIL_CLEAR) continue;
        if (d < 1e-6) { const l = Math.sqrt(l2) || 1; x = px - (dz / l) * RAIL_CLEAR; z = pz + (dx / l) * RAIL_CLEAR; } else { x = px + (ex / d) * RAIL_CLEAR; z = pz + (ez / d) * RAIL_CLEAR; }
        moved = true;
      }
    }
    // rota dışı ray karosu (süs): karo kutusu RAIL_CLEAR kadar genişletilmiş
    const li0 = Math.floor(x + 12) - g.i0, lj0 = Math.floor(z + 8) - g.j0;
    for (let lj = lj0 - 1; lj <= lj0 + 1; lj++) for (let li = li0 - 1; li <= li0 + 1; li++) {
      if (!inG(g, li, lj) || g.lane[lj * g.w + li] !== 2) continue;
      const ex = x - cxw(g.i0 + li), ez = z - czw(g.j0 + lj);
      if (Math.abs(ex) >= RAIL_CLEAR || Math.abs(ez) >= RAIL_CLEAR) continue;
      if (RAIL_CLEAR - Math.abs(ex) <= RAIL_CLEAR - Math.abs(ez)) x += (ex < 0 ? -1 : 1) * (RAIL_CLEAR - Math.abs(ex)); else z += (ez < 0 ? -1 : 1) * (RAIL_CLEAR - Math.abs(ez));
      moved = true;
    }
    if (!moved) break;
  }
  return [x, z];
}

/**
 * ( a): durakta araç beklerken/kalkarken/gelirken gövdenin yanına (gövde yarı eni 0,65 + 0,9 boşluk) durulmaz. <city>
 * metrosunda figüranlar kalkan vagona omuz omuza duruyordu: `RAIL_CLEAR` yalnız gövdenin içine girmeyi (0,9) engelliyordu. Konum bir
 * rayın durağına `STATION_R` içinde ve rota çizgisine `STATION_BAND` (+ pay) yakınsa true. Yalnız DURMA noktaları (ilgi noktası, oturak,
 * rastgele hedef) süzülür; yürüyüş ağı ve yürüyen figüran aynı kalır. Saf.
*/
export const STATION_R = 6, STATION_BAND = 0.65 + 0.9;
export function stationBand(g: Pick<PedGrid, "rails" | "stations">, x: number, z: number, margin = 0): boolean {
  if (!g.stations?.some(([sx, sz]) => Math.hypot(x - sx, z - sz) <= STATION_R)) return false;
  for (const poly of g.rails ?? []) for (let k = 0; k + 1 < poly.length; k++) {
    const [ax, az] = poly[k], [bx, bz] = poly[k + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const u = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    if (Math.hypot(x - (ax + dx * u), z - (az + dz * u)) < STATION_BAND + margin) return true;
  }
  return false;
}

/** ( a): rastgele durma hedefi olabilecek karo — yürünür ve (durakta) araç gövdesinin yanında değil (karo merkezi + doğma/yanal pay 0,35).*/
export const targetOk = (g: PedGrid, li: number, lj: number) => pedOk(g, li, lj) && !stationBand(g, cxw(g.i0 + li), czw(g.j0 + lj), 0.35);

/** Konum gövde bandında mı.*/
export const onRail = (g: PedGrid, x: number, z: number) => { const [rx, rz] = railClear(g, x, z); return rx !== x || rz !== z; };
/**
 * ray bandındaki (x, z) figüranın gideceği yer — `railClear` itişi (rx, rz) yürünebilir karodaysa o; değilse önceki
 * konum (px, pz) bant dışında ve yürünebilirse o; ikisi de değilse null (çağıran figüranı siler). Eskiden itiş yürünemez karoya düşünce
 * figüran bantta kalıyordu.
*/
export function railStep(g: PedGrid, x: number, z: number, rx: number, rz: number, px: number, pz: number): [number, number] | null {
  const ok = (a: number, b: number) => pedOk(g, Math.floor(a + 12) - g.i0, Math.floor(b + 8) - g.j0);
  if (rx === x && rz === z) return [x, z];
  if (ok(rx, rz)) return [rx, rz];
  return (px !== x || pz !== z) && ok(px, pz) && !onRail(g, px, pz) ? [px, pz] : null;
}

const DIR4: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Şeridin en çok bu kadar karosu tek geçişte aşılır. */
export const CROSS_MAX = 4;

/**
 * Yaya rotası (semt yerel karosu): 4-komşu BFS. Şerit karosuna yalnız şeridin eksenine DİK adımla girilir ve aynı yönde düz devam
 * edilerek ≤ `CROSS_MAX` karoda karşı kaldırıma varılır (kavşak — iki eksen — geçilmez). Dönüş: başlangıç hariç karolar ya da null.
 */
export function pedPath(g: PedGrid, from: [number, number], to: [number, number], maxNodes = 2600): [number, number][] | null {
  if (!pedOk(g, from[0], from[1]) || !pedOk(g, to[0], to[1])) return null;
  const n = g.w * g.d, prev = new Int32Array(n).fill(-2), via = new Map<number, number[]>();
  const s = from[1] * g.w + from[0], e = to[1] * g.w + to[0];
  prev[s] = -1;
  const q = [s];
  for (let h = 0; h < q.length && h < maxNodes; h++) {
    const c = q[h];
    if (c === e) break;
    const ci = c % g.w, cj = (c / g.w) | 0;
    for (const [di, dj] of DIR4) {
      let ni = ci + di, nj = cj + dj;
      if (!inG(g, ni, nj)) continue;
      let k = nj * g.w + ni;
      const mid: number[] = [];
      if (g.lane[k] === 2) continue; // ray geçilmez
      if (g.lane[k]) {
        // dik geçiş: adım ekseni şeridin eksenine dik olmalı (x adımı → şerit z boyunca)
        const need = di !== 0 ? AX_Z : AX_X;
        let ok = false;
        for (let step = 0; step < CROSS_MAX && inG(g, ni, nj) && walkableKind(g.kind[nj * g.w + ni]); step++) {
          const kk = nj * g.w + ni;
          if (!g.lane[kk]) { ok = !g.obst[kk]; break; }
          if (g.lane[kk] === 2 || g.laneAx[kk] !== need) break;
          mid.push(kk); ni += di; nj += dj;
        }
        if (!ok || !inG(g, ni, nj)) continue;
        k = nj * g.w + ni;
      } else if (!pedOk(g, ni, nj)) continue;
      if (prev[k] !== -2) continue;
      prev[k] = c;
      if (mid.length) via.set(k, mid);
      q.push(k);
    }
  }
  if (prev[e] === -2) return null;
  const out: number[] = [];
  for (let c = e; c !== s; c = prev[c]) {
    out.push(c);
    const m = via.get(c);
    if (m) for (let x = m.length - 1; x >= 0; x--) out.push(m[x]);
  }
  out.reverse();
  return out.map((k) => [k % g.w, (k / g.w) | 0]);
}

/**
 * Rotanın şerit kullanımı (denetim): her şerit karosu için giriş adımı şeride dik mi. Boyunca yürünen (eksenine paralel adımla
 * girilen ya da çıkılan) şerit karosu sayısı döner — 0 olmalı.
 */
export function laneAlong(g: PedGrid, from: [number, number], path: readonly [number, number][]): number {
  let bad = 0, prev = from;
  for (const t of path) {
    const k = t[1] * g.w + t[0];
    if (g.lane[k]) {
      const ax = t[0] !== prev[0] ? AX_X : AX_Z;
      if (g.laneAx[k] & ax) bad++;
    }
    prev = t;
  }
  return bad;
}

// ------------------------------------------------------------------------------------------ ilgi noktaları
export type PoiKind = "window" | "seat" | "queue" | "photo" | "stop" | "wander";
export interface Poi {
  kind: PoiKind;
  /** durulan karo (semt yerel; pedOk) */
  li: number; lj: number;
  /** son nokta (dünya) ve bakış (rad; 0 → +z) */
  x: number; z: number;
  heading: number;
  /** oturak (yalnız "seat"): oturak üstü, tür */
  seat?: { y: number; kind: "bench" | "chair" };
  /** sıra/oturak kimliği (aynı yere iki figüran gitmez) */
  key: string;
}

const cxw = (I: number) => I - 11.5, czw = (J: number) => J - 7.5;
const headingTo = (dx: number, dz: number) => Math.atan2(dx, dz);

/** Semt planından vitrin (bina önü kaldırım), fotoğraf (simge önü meydan) ve durak bekleme noktaları. Belirlenimci, seyrek. */
/** landmark kapısından dışarı çıkış şeridi: kapı + dışarı bu kadar karo (doorExit.ts `EXIT_MAX` 4 + kamera payı), yanlarda ±1.*/
export const EXIT_LANE = 6;
/** Çıkış şeridi karoları ("i,j", dünya karo dizini): şerit üstündeki ilgi noktasında figüran durmaz (avatar çıkışta figüranın üstüne düşmez). */
export function exitLane(g: Pick<PedGrid, "i0" | "j0">, plan: { mapId?: string; landmarks: readonly { id: string; i0: number; j0: number; w: number; d: number }[]; doors?: readonly { landmark: string; tile: CityTile }[] }): Set<string> {
  const lane = new Set<string>();
  for (const dr of plan.doors ?? []) {
    // ölçülmüş çıkış pozu (arrivalPoses.ts) kapı ekseninde değilse: çıkış karosunun çevresi (±1)
    const fx = plan.mapId ? exitPose(plan.mapId, dr.tile) : null;
    if (fx) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) lane.add(`${fx.out[0] + a},${fx.out[1] + b}`);
    const lm = plan.landmarks.find((x) => x.id === dr.landmark);
    if (!lm) continue;
    const dx = dr.tile[0] - (g.i0 + lm.i0 + (lm.w - 1) / 2), dz = dr.tile[1] - (g.j0 + lm.j0 + (lm.d - 1) / 2);
    const di = Math.abs(dx) > Math.abs(dz) ? Math.sign(dx) : 0, dj = di ? 0 : Math.sign(dz) || 1;
    for (let n = 0; n <= EXIT_LANE; n++) for (let a = -1; a <= 1; a++) lane.add(`${dr.tile[0] + di * n + (dj ? a : 0)},${dr.tile[1] + dj * n + (di ? a : 0)}`);
  }
  return lane;
}
/**
 * durak varış kamerasının koridoru ("i,j", dünya karo dizini). Varış karosu ve 8 komşusu + kameranın tarafında
 * (yönün tersi) `STOP_CAM_LANE` karo, ±1 yan: bekleyen figüran avatarın dibinde ya da kamera ile avatar arasında durmaz (<city> metro,
 * Marakeş otobüs varışında figüran merceğin önündeydi; kol figüranın önünde kısalınca avatar ekranın %40'ı oluyordu).
*/
export const STOP_CAM_LANE = 6;
/** ARR-B: varış karesinin önündeki figüran yok kaması uzunluğu (karo). */
export const STOP_FRONT_LANE = 5;
/** arka kamanın derinliği (takip kolu, walk/scale FOLLOW_DIST), 16:9 kadrajının birim uzaklıktaki yarı genişliği, avatarın önüne taşma.*/
export const STOP_CAM_DIST = 4.6, STOP_CAM_HALF = 0.85, STOP_CAM_BEYOND = 1;
/** ARR-B: ön kama anahtarları `f` önekli ("fi,j"): planPois aday SAYIMINI bozmadan yalnız o noktayı eler (komşu noktalar kaymaz, ratchet'e yeni anahtar çıkmaz). */
export const FRONT_PREFIX = "f";
export function stopCamAvoid(arrivals: readonly { tile: CityTile; heading: number }[]): Set<string> {
  const out = new Set<string>();
  for (const a of arrivals) {
    for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) out.add(`${a.tile[0] + c},${a.tile[1] + b}`);
    const bx = -Math.sin(a.heading), bz = -Math.cos(a.heading), sx = -bz, sz = bx;
    for (let n = 1; n <= STOP_CAM_LANE; n++) for (let w = -1; w <= 1; w++) out.add(`${Math.round(a.tile[0] + bx * n + sx * w)},${Math.round(a.tile[1] + bz * n + sz * w)}`);
    // arka kama — ±1 şerit kamera ile avatar arasındaki kadrajın yanlarını (16:9 kare kameradan genişler) ve köşegen yönde yuvarlama
    // deliklerini kapsamıyordu (<city> asakusa, <city> saray_iskele, <city> meydan_metro: bekleyen figüran karenin %3–17'si). Kamera kolu
    // (`STOP_CAM_DIST`) ile avatarın `STOP_CAM_BEYOND` karo önü arasında, 16:9 yarı genişliği kadar (≤ 3 karo). Yalnız eler (`f`): şerit
    // anahtarları aynı kalır, başka figüran kaymaz.
    for (let dj = -STOP_CAM_LANE; dj <= STOP_CAM_LANE; dj++) for (let di = -STOP_CAM_LANE; di <= STOP_CAM_LANE; di++) {
      const back = di * bx + dj * bz, side = Math.abs(di * sx + dj * sz);
      if (back >= -STOP_CAM_BEYOND && side <= Math.min(3, (STOP_CAM_DIST - back) * STOP_CAM_HALF) + 0.3) out.add(`${FRONT_PREFIX}${a.tile[0] + di},${a.tile[1] + dj}`);
    }
    // ARR-B: ön kama — varış kamerası avatarın baktığı yöne (heading) bakar; varış karosunun önündeki `STOP_FRONT_LANE` karo, yana kadraj kadar
    const fx = -bx, fz = -bz;
    for (let dj = -STOP_FRONT_LANE; dj <= STOP_FRONT_LANE; dj++) for (let di = -STOP_FRONT_LANE; di <= STOP_FRONT_LANE; di++) {
      const along = di * fx + dj * fz, side = Math.abs(di * sx + dj * sz);
      if (along > 0 && along <= STOP_FRONT_LANE && side <= Math.min(3, Math.max(1, along * 0.8)) + 0.5) out.add(`${FRONT_PREFIX}${a.tile[0] + di},${a.tile[1] + dj}`);
    }
  }
  return out;
}
/**
 * GATEFIX2: seyir noktası (1. şahıs) bakış kaması ("i,j"): seyir karosu ve 8 komşusu + bakış yönünde `VP_VIEW_LANE` karo, yanlara kadraj kadar.
 * Durağan figüran seyir karesinin önünde durmaz (<city> Shibuya kavşak seyri: fotoğraf noktasındaki figüran karenin %18'i; VIEW-FRAME-001).
*/
export const VP_VIEW_LANE = 10;
export function vpViewAvoid(vps: readonly { tile: CityTile; yaw: number; front?: boolean }[]): Set<string> {
  const out = new Set<string>();
  for (const v of vps) {
    const pre = v.front ? FRONT_PREFIX : ""; // telefon bakışı yalnız eler (planPois sayımı kaymaz)
    for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) out.add(`${v.tile[0] + c},${v.tile[1] + b}`);
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), sx = fz, sz = -fx;
    // kama: 1. şahıs yatay yarı açısı ≈ 0,76 rad (62°, 16:10) — `n` karo ötede yan genişlik ≈ 0,8 n (≤ 5); karo merkezleri kamaya göre süzülür (yuvarlama deliği yok)
    for (let dj = -VP_VIEW_LANE; dj <= VP_VIEW_LANE; dj++) for (let di = -VP_VIEW_LANE; di <= VP_VIEW_LANE; di++) {
      const along = di * fx + dj * fz, side = Math.abs(di * sx + dj * sz);
      if (along > 0 && along <= VP_VIEW_LANE && side <= Math.min(5, Math.max(1, along * 0.8)) + 0.5) out.add(`${pre}${v.tile[0] + di},${v.tile[1] + dj}`);
    }
  }
  return out;
}
/**
 * ( d): etkin kamera konisi ("i,j" karo anahtarları; `f` öneki atılır). Oyuncu bir seyir karosunda ya da varış anındayken
 * YÜRÜYEN figüran bu karolara girmez (bekler, rotası silinmez; koni kalkınca devam eder), konideki figüran o sürece çizilmez. Durma
 * noktaları için olan kuralların (`vpViewAvoid`, `stopCamAvoid`) yürüyenleri kapsamayan tamamlayıcısı (<city> dikey seyir karesinden geçen yaya).
*/
export const coneOf = (keys: Iterable<string>): Set<string> => new Set([...keys].map((k) => (k.startsWith(FRONT_PREFIX) ? k.slice(FRONT_PREFIX.length) : k)));
export const coneKey = (x: number, z: number) => `${Math.floor(x + 12)},${Math.floor(z + 8)}`;
export const inCone = (cone: ReadonlySet<string> | null, x: number, z: number) => !!cone && cone.has(coneKey(x, z));
/** Yürüyen figüranın (x0,z0) → (x1,z1) adımı konide olmayan bir yerden koniye giriyorsa true (adım geri alınır, figüran bekler). */
export const coneBlocks = (cone: ReadonlySet<string> | null, x0: number, z0: number, x1: number, z1: number) => inCone(cone, x1, z1) && !inCone(cone, x0, z0);
/** Seyir karosu (telefon bakışı dahil) koni anahtarları. */
export const viewCone = (vps: Parameters<typeof vpViewAvoid>[0]) => coneOf(vpViewAvoid(vps));
/** Durak/çıkış varış kamerası konisi: avatarın varış karosu ve kamera kolunun yönü (heading = avatarın bakışı; kamera arkada). */
export const arrivalCone = (tile: CityTile, heading: number) => coneOf(stopCamAvoid([{ tile, heading }]));
/**
 * yolculukta (araç/kabin avatarı taşırken) figüran dünya uzayında durur; araç ya da kamera üstünden geçince vagona,
 * avatara, kameraya yapışıyordu (<city> mekik 0,56 m, <city> 0,28 m). Araç gövdesine (`half` yarı boy + pay) ve kameraya yakın figüran kalkar. Saf.
*/
export const RIDE_BODY_PAD = 0.9, RIDE_CAM_R = 1.6;
/** figüran kameranın `RIDE_CAM_R` yakınında olamaz (yolculuk, varış penceresi, doğma). Saf.*/
export const camBlocks = (x: number, z: number, cx: number, cz: number) => Math.hypot(x - cx, z - cz) < RIDE_CAM_R;
export const rideBlocks = (x: number, z: number, vx: number, vz: number, half: number, cx: number, cz: number) =>
  Math.hypot(x - vx, z - vz) < Math.max(AVATAR_CLEAR + 1.2, half + RIDE_BODY_PAD) || Math.hypot(x - cx, z - cz) < RIDE_CAM_R;

/** ( b): varış karosuna (şehir karosu) bu kadar yakın oturak/durma noktası olmaz (karo merkezi uzaklığı; 3 × 3 engel yürümeyi keser, bank 1 karoda kalabiliyordu).*/
export const ARRIVAL_STAND_R = 1.5;
export const nearArrival = (tiles: readonly CityTile[], x: number, z: number, r = ARRIVAL_STAND_R) => tiles.some((t) => Math.hypot(x - (t[0] - 11.5), z - (t[1] - 7.5)) < r);
/** HQA-FIX-C: oturak (parselPois) karosu `stopCamAvoid`/`vpViewAvoid` kümesinde mi (şerit "i,j" ya da ön kama `f` + "i,j")? Oturan figüran varış karesinin önüne oturmaz. */
export const seatAvoided = (avoid: ReadonlySet<string>, I: number, J: number) => avoid.has(`${I},${J}`) || avoid.has(`${FRONT_PREFIX}${I},${J}`);
export function planPois(g: PedGrid, plan: { mapId?: string; landmarks: readonly { id: string; i0: number; j0: number; w: number; d: number }[]; stops: readonly { id: string; tile: CityTile }[]; doors?: readonly { landmark: string; tile: CityTile }[];
  buildings?: readonly { i0: number; j0: number; w: number; d: number; rock?: boolean }[] }, camAvoid: ReadonlySet<string> = new Set()): Poi[] {
  const out: Poi[] = [];
  const lane = exitLane(g, plan);
  const front = new Set<string>();
  for (const k of camAvoid) (k.startsWith(FRONT_PREFIX) ? front : lane).add(k.startsWith(FRONT_PREFIX) ? k.slice(1) : k); // durak varış kamerası koridoru da çıkış şeridi gibi boş kalır
  const inLane = (li: number, lj: number) => lane.has(`${g.i0 + li},${g.j0 + lj}`);
  const kindAt = (li: number, lj: number) => (inG(g, li, lj) ? g.kind[lj * g.w + li] : -1);
  // vitrin: sokak/meydan karosu, 4-komşusu bina; her 5. aday (seyrek). kaya kütlesi (`rock`, <city> geçidi) vitrin değil
  const rocks = (plan.buildings ?? []).filter((b) => b.rock);
  const rockAt = (li: number, lj: number) => rocks.some((b) => li >= b.i0 && lj >= b.j0 && li < b.i0 + b.w && lj < b.j0 + b.d);
  let k = 0;
  for (let lj = 0; lj < g.d; lj++) for (let li = 0; li < g.w; li++) {
    const t = kindAt(li, lj);
    if ((t !== T_STREET && t !== T_PLAZA) || !standOk(g, li, lj) || inLane(li, lj)) continue; // HQA-FIX: şerit yanında değil
    for (const [di, dj] of DIR4) {
      if (kindAt(li + di, lj + dj) !== T_BUILDING || rockAt(li + di, lj + dj)) continue;
      if (k++ % 5 === 0 && !front.has(`${g.i0 + li},${g.j0 + lj}`)) out.push({ kind: "window", li, lj, x: cxw(g.i0 + li) + di * 0.22, z: czw(g.j0 + lj) + dj * 0.22, heading: headingTo(di, dj), key: `w${li},${lj}` });
      break;
    }
  }
  // fotoğraf: simge ayak izine 2–4 karo uzak meydan/park karosu, simgenin merkezine bakar; simge başına ≤ 3
  for (const lm of plan.landmarks) {
    const mx = lm.i0 + (lm.w - 1) / 2, mz = lm.j0 + (lm.d - 1) / 2;
    let n = 0;
    for (let lj = lm.j0 - 4; lj < lm.j0 + lm.d + 4 && n < 3; lj++) for (let li = lm.i0 - 4; li < lm.i0 + lm.w + 4 && n < 3; li++) {
      const t = kindAt(li, lj);
      if ((t !== T_PLAZA && t !== T_PARK && t !== T_STREET) || !standOk(g, li, lj) || inLane(li, lj)) continue; // HQA-FIX
      const dx = Math.max(lm.i0 - li, 0, li - (lm.i0 + lm.w - 1)), dz = Math.max(lm.j0 - lj, 0, lj - (lm.j0 + lm.d - 1));
      const dd = Math.max(dx, dz);
      if (dd < 2 || dd > 4 || (li + lj * 3) % 4 !== 0) continue;
      if (!front.has(`${g.i0 + li},${g.j0 + lj}`)) out.push({ kind: "photo", li, lj, x: cxw(g.i0 + li), z: czw(g.j0 + lj), heading: headingTo(mx - li, mz - lj), key: `p${lm.id}${n}` });
      n++;
    }
  }
  // durak: durak karosunun şerit dışı komşuları (≤ 3), durağa bakar
  for (const s of plan.stops) {
    const sl = s.tile[0] - g.i0, sj = s.tile[1] - g.j0;
    if (!inG(g, sl, sj)) continue;
    let n = 0;
    for (const [di, dj] of [[1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]] as const) {
      const li = sl + di, lj = sj + dj;
      if (n >= 3 || !standOk(g, li, lj) || inLane(li, lj)) continue; // HQA-FIX: durakta bekleyen figüran tramvay gövdesine girmez
      if (!front.has(`${g.i0 + li},${g.j0 + lj}`)) out.push({ kind: "stop", li, lj, x: cxw(g.i0 + li) - di * 0.15, z: czw(g.j0 + lj) - dj * 0.15, heading: headingTo(-di, -dj), key: `s${s.id}${n}` });
      n++;
    }
  }
  return out.map(clearPoi(g)).filter((p) => !stationBand(g, p.x, p.z)); // durulan nokta araç gövdesinin içinde değil; durakta gövdeye bitişik de değil (süzgeç SONRA: aday sayacı kaymaz)
}

/** ilgi noktasının durulan yeri `railClear` ile gövde bandı dışına alınır (glide hedefi yerinde tutulur: her kare itilen figüran hiç varmaz).*/
const clearPoi = (g: PedGrid) => (p: Poi): Poi => { const [x, z] = railClear(g, p.x, p.z); return x === p.x && z === p.z ? p : { ...p, x, z }; };

/** Eşya sayılan blok: katı, zeminden başlayan, alçak ve küçük ayak izli (bank, sandalye, masa, tezgâh, lamba direği, saksı). */
const furnitureBlock = (b: Block, ground: number) => b.g === "solid" && b.p[1] - b.s[1] / 2 <= ground + 0.5 && b.p[1] + b.s[1] / 2 >= ground + 0.14
  && b.s[1] >= 0.05 && Math.max(b.s[0], b.s[2]) <= 3.2 && Math.min(b.s[0], b.s[2]) <= 1.2;

/**
 * Parsel bloklarından: eşya engeli karoları (semt yerel dizin) ve gerçek oturaklar (oturak levhası, üstü boş; sırt/masa yönü yoksa
 * en yakın açık karoya bakar). Oturuş noktası levhanın ortasıdır (uzun bankta iki nokta). Figüran oturağın önündeki açık karoya yürür
 * ve oturak noktasına süzülür.
 */
export function parcelPois(g: PedGrid, blocks: readonly Block[]): { obst: number[]; seats: Poi[] } {
  const obst = new Set<number>();
  const groundAt = (li: number, lj: number) => (inG(g, li, lj) ? g.top[lj * g.w + li] : 0);
  for (const b of blocks) {
    const li = Math.floor(b.p[0] + 12) - g.i0, lj = Math.floor(b.p[2] + 8) - g.j0;
    if (!inG(g, li, lj) || !walkableKind(g.kind[lj * g.w + li])) continue;
    if (!furnitureBlock(b, groundAt(li, lj))) continue;
    // bloğun kapladığı karolar
    const x0 = Math.floor(b.p[0] - b.s[0] / 2 + 12 + 0.08), x1 = Math.floor(b.p[0] + b.s[0] / 2 + 12 - 0.08);
    const z0 = Math.floor(b.p[2] - b.s[2] / 2 + 8 + 0.08), z1 = Math.floor(b.p[2] + b.s[2] / 2 + 8 - 0.08);
    for (let J = z0; J <= z1; J++) for (let I = x0; I <= x1; I++) {
      const a = I - g.i0, c = J - g.j0;
      if (inG(g, a, c) && walkableKind(g.kind[c * g.w + a])) obst.add(c * g.w + a);
    }
  }
  const seats: Poi[] = [];
  for (const q of blocks) {
    if (!isSeatSlab(q) || !topClear(blocks, q)) continue;
    const long = Math.max(q.s[0], q.s[2]) >= 1.2;
    const along = q.s[0] >= q.s[2];
    const pts = long ? [-0.3, 0.3].map((o) => (along ? { x: q.p[0] + o, z: q.p[2] } : { x: q.p[0], z: q.p[2] + o })) : [{ x: q.p[0], z: q.p[2] }];
    for (const p of pts) {
      const I = Math.floor(p.x + 12), J = Math.floor(p.z + 8), li = I - g.i0, lj = J - g.j0;
      if (!inG(g, li, lj)) continue;
      let h = seatHeading(blocks, q, p);
      // durulacak açık karo: bakış yönündeki komşu önce, sonra diğerleri
      const order = h === null ? DIR4 : ([[Math.round(Math.sin(h)), Math.round(Math.cos(h))], ...DIR4] as [number, number][]);
      let stand: [number, number] | null = null;
      for (const [di, dj] of order) if (pedOk(g, li + di, lj + dj)) { stand = [li + di, lj + dj]; break; }
      if (!stand) continue;
      if (h === null) h = headingTo(stand[0] - li, stand[1] - lj);
      const chair = Math.max(q.s[0], q.s[2]) < 0.6;
      seats.push({ kind: "seat", li: stand[0], lj: stand[1], x: p.x, z: p.z, heading: h, seat: { y: q.p[1] + q.s[1] / 2, kind: chair ? "chair" : "bench" }, key: `b${p.x.toFixed(2)},${p.z.toFixed(2)}` });
    }
  }
  return { obst: [...obst], seats };
}

/** Bir satıcının sipariş karosundan sıra noktaları: sipariş karosu + arkasında açık karolar (≤ 2). */
export function queuePois(g: PedGrid, anchor: { x: number; z: number }, heading: number, id: string): Poi[] {
  const out: Poi[] = [];
  const I = Math.floor(anchor.x + 12), J = Math.floor(anchor.z + 8);
  const li = I - g.i0, lj = J - g.j0;
  // geri yön (tezgâhtan uzağa) = bakışın tersi
  const bx = -Math.round(Math.sin(heading)), bz = -Math.round(Math.cos(heading));
  const cands: [number, number][] = [[li, lj], [li + bx * 2, lj + bz * 2], [li + bx * 2 + bz, lj + bz * 2 - bx], [li + bx * 3, lj + bz * 3]];
  for (const [a, b] of cands) {
    if (out.length >= 3 || !pedOk(g, a, b)) continue;
    out.push({ kind: "queue", li: a, lj: b, x: cxw(g.i0 + a), z: czw(g.j0 + b), heading, key: `q${id}${out.length}` });
  }
  return out.map(clearPoi(g));
}

// ------------------------------------------------------------------------------------------ görünüm
/** Belirlenimci tohumlu sayı üreteci (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length) % xs.length];

/** Şemsiye renkleri: tek renk, düz (bant/desen/simge yok — kostüm politikası). */
export const UMBRELLA_COLORS = ["#1F2937", "#334155", "#7F1D1D", "#1E3A8A", "#14532D", "#57534E"];
/** Satıcı önlüğü (tek renk). */
export const APRON = "#F4EFE6";

/**
 * Figüranın görünümü (tohum + şehir sahnesi): insan; sunum m/f/n; ad yok. Şehrin yerel kostümü varsa ~%35'i ondan bir parça giyer
 * (`localWearFor`: politika denetimli havuz — siyasi/ideolojik simge, onur/gökkuşağı simgesi yok). Mağaza öğesi kullanılmaz.
 */
export function figLook(seed: number, scene: string | null): { avatar: Avatar; presentation: Presentation } {
  const r = rng(seed * 2654435761);
  const u = r();
  const p: Presentation = u < 0.46 ? "m" : u < 0.92 ? "f" : "n";
  const avatar: Avatar = {
    species: "human", skin: pick(r, SKIN_TONES), hair: pick(r, HAIR_BY[p]), hairColor: pick(r, HAIR_COLORS.slice(0, 5)),
    beard: r() < 0.5 ? pick(r, BEARD_BY[p]) : "none", outfit: pick(r, OUTFIT_BY[p].filter((o) => o !== "labcoat" && o !== "suit")),
    outfitColor: pick(r, OUTFIT_COLORS), accent: pick(r, ACCENT_COLORS), glasses: r() < 0.25 ? (r() < 0.5 ? "round" : "square") : "none",
    hat: r() < 0.15 ? pick(r, ["cap", "beanie"] as const) : "none", presentation: p,
  } as Avatar;
  if (scene && r() < 0.35) {
    const wear = localWearFor(`fig-${seed}`, scene, p);
    if (wear) avatar.wear = wear;
  }
  return { avatar, presentation: p };
}
