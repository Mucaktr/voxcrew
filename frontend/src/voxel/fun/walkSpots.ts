/**
 * UXF-B — yürüme modunda avatara sunulan olta yerleri (Yakındakiler ve F).
 *
 * `sites.fishing` her kıyı karosunu nokta yapar (ajanların olta işi, canlı envanter tabanı `live_inventory` bunu sayar ve
 * değişmez). Avatar için bu yoğunluk iki soruna yol açıyordu:
 * - Yakındakiler'de "Olta yeri ×13–×20", kıyıda her adımda menzilde bir olta yeri olduğu için "F: Olta yeri" ritüel,
 * hatıra ve bilgi noktalarının önüne geçiyordu.
 * - <city> hendeğinde şamandıra, teknenin gidip geldiği (hareket azaltmada park ettiği) şeridin üstüne düşüyordu;
 * olta tekneye/yola atılmış gibi görünüyordu (yürüme modunda tekne insan boyuna büyür ve hendeğin enini kaplar).
 * Kural (yalnız sunum; nokta listesi ve kimlikleri değişmez):
 * - Geçerli nokta: şamandıra karosu açık su (habitat `open`; ızgara dışı ufuk denizi ancak sahnede deniz varsa), şamandıra o
 * karonun su yüzünde, nokta suya bakar (yön = karodan şamandıraya), arada göz hizasını kesen yüksek blok yok (korkuluk, kaldırım
 * taşı, babası geçer) ve şamandıra su taşıtlarının (vapur, tekne, felucca) şeridinden gövde yarı eni + pay uzakta.
 * - Aralık: aynı su gövdesinde seçilen iki nokta arasında en az `WALK_FISH_SPACING` karo (şehir haritasıyla aynı:
 * `CITY_FISH_SPACING`); önce kancalı (tasarlanmış) noktalar, sonra tarama sırası. Her olta suyu gövdesi en az bir nokta alır
 * (geçerli nokta yoksa en az kusurlu olanı).
 * Saf modül (React/three yok); dünya başına bir kez (WeakMap, nokta dizisi kimliğiyle).
*/
import { habitat } from "../ambient/habitat";
import { D, tx, tz, W, type Built, type Mover } from "../scenes";
import type { FishSpot } from "./sites";
import { moverFits } from "../walk/moverFit";

/** Aynı su gövdesinde iki olta yeri arasında en az bu kadar karo (şehir haritası `CITY_FISH_SPACING` ile aynı). */
export const WALK_FISH_SPACING = 5;
/** Olta ile şamandıra arasındaki karoda bundan yüksek (zeminden) blok misinayı keser (duvar, ağaç gövdesi, tente). */
export const FISH_LINE_MAX_H = 1.1;
/** Su taşıtı şeridinden şamandıranın açıklığı: gövde yarı eni × ölçek + bu pay. */
export const FISH_LANE_PAD = 0.1;

/** Su taşıtları: yarı en ve yarı boy (yerel ölçü; `props/movers.ts SHAPES` gövde kutuları). */
const WATER_SHAPES: Partial<Record<Mover["shape"], { hw: number; hl: number }>> = {
  ferry: { hw: 0.62, hl: 2.0 }, boat: { hw: 0.4, hl: 1.1 }, felucca: { hw: 0.4, hl: 1.35 },
};

export type FishIssue = "dry" | "face" | "wall" | "lane";

interface Lane { ax: number; az: number; bx: number; bz: number; clear: number; /** yürüme boyunda yarı en + pay (dar kanal) */ wide: number }
/** Şeride dik su genişliği (karo) bundan azsa kanal dardır: taşıt yürüme boyunda kanalı doldurur, şamandıra onun eniyle ölçülür. */
export const NARROW_CHANNEL = 3;

const laneCache = new WeakMap<object, Lane[]>();
function lanesOf(built: Pick<Built, "movers" | "blocks" | "backdrop">): Lane[] {
  const hit = laneCache.get(built);
  if (hit) return hit;
  const out: Lane[] = [];
  // yürüme modunda taşıtlar insan boyuna büyür (`walk/moverFit.ts`: <city> hendek teknesi ~3,7 kat): şeridin ucu o boyla uzar
  // (tekne şeridin ucunun ötesine taşar); en, gövdenin sahne ölçeğindeki yarı enidir (geniş suda kıyı noktaları korunur)
  const fits = (built.movers ?? []).some((m) => WATER_SHAPES[m.shape]) ? moverFits(built) : null;
  for (const m0 of built.movers ?? []) {
    const sh = WATER_SHAPES[m0.shape];
    if (!sh || m0.path.length < 1) continue;
    const fit = fits?.get(m0) ?? null, m = fit?.mover ?? m0;
    const sc = m0.scale ?? 1, clear = sh.hw * sc + FISH_LANE_PAD, ext = sh.hl * sc * Math.max(1, fit?.fx ?? 1);
    const wide = sh.hw * sc * Math.max(1, fit?.fz ?? 1) + FISH_LANE_PAD;
    const pts = m.path.map((p) => [p[0], p[2]] as [number, number]);
    if (pts.length === 1) { out.push({ ax: pts[0][0], az: pts[0][1], bx: pts[0][0], bz: pts[0][1], clear: clear + ext, wide: wide + ext }); continue; }
    pts.forEach((p, k) => {
      if (k === 0) return;
      const [ax, az] = pts[k - 1], [bx, bz] = p;
      const l = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / l, uz = (bz - az) / l;
      // uçlarda gövde yarı boyu kadar taşar (iskelede bekleyen tekne şeridin ucunun ötesine uzanır)
      const ea = k === 1 ? ext : 0, eb = k === pts.length - 1 ? ext : 0;
      out.push({ ax: ax - ux * ea, az: az - uz * ea, bx: bx + ux * eb, bz: bz + uz * eb, clear, wide });
    });
    if (m.mode === "loop" && pts.length > 2) {
      const [ax, az] = pts[pts.length - 1], [bx, bz] = pts[0];
      out.push({ ax, az, bx, bz, clear, wide });
    }
  }
  laneCache.set(built, out);
  return out;
}

function segDist(px: number, pz: number, l: Lane): number {
  const vx = l.bx - l.ax, vz = l.bz - l.az, l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - l.ax) * vx + (pz - l.az) * vz) / l2)) : 0;
  return Math.hypot(px - (l.ax + vx * t), pz - (l.az + vz * t));
}

/** Şamandıra karosundan şeride dik yönde ardışık su karosu sayısı (iki yana). */
function channelWidth(h: { waterY: Float32Array }, w: number, d: number, bi: number, bj: number, l: Lane): number {
  const lx = l.bx - l.ax, lz = l.bz - l.az;
  // dik eksen: şerit x boyuncaysa z, z boyuncaysa x (çapraz şeritte baskın eksene dik)
  const [di, dj] = Math.abs(lx) >= Math.abs(lz) ? [0, 1] : [1, 0];
  let n = 1;
  for (const s of [1, -1]) for (let r = 1; r <= NARROW_CHANNEL + 1; r++) {
    const i = bi + di * r * s, j = bj + dj * r * s;
    if (i < 0 || j < 0 || i >= w || j >= d || h.waterY[j * w + i] <= -9) break;
    n++;
  }
  return n;
}

const lineTops = new WeakMap<Built, Float32Array>();
/** Karo ORTASINI örten (su ve parçacık dışı) blokların zeminden yüksekliği — misina bu karonun üstünden geçer. */
function lineTop(built: Built): Float32Array {
  let t = lineTops.get(built);
  if (t) return t;
  const w = built.width, d = built.depth;
  t = new Float32Array(w * d).fill(-9);
  for (const b of built.blocks) {
    if (b.g === "water" || b.g === "wave" || b.g === "cloud" || b.g === "flame" || b.g === "flag" || b.g === "snow") continue;
    const i0 = Math.max(0, Math.ceil(b.p[0] - b.s[0] / 2 + W / 2 - 0.5 - 1e-6)), i1 = Math.min(w - 1, Math.floor(b.p[0] + b.s[0] / 2 + W / 2 - 0.5 + 1e-6));
    const j0 = Math.max(0, Math.ceil(b.p[2] - b.s[2] / 2 + D / 2 - 0.5 - 1e-6)), j1 = Math.min(d - 1, Math.floor(b.p[2] + b.s[2] / 2 + D / 2 - 0.5 + 1e-6));
    if (i0 > i1 || j0 > j1 || (i1 - i0 + 1) * (j1 - j0 + 1) > 64) continue;
    // ince direk (babası, korkuluk dikmesi) misinayı kesmez; yalnız gövdeli blok
    if (Math.max(b.s[0], b.s[2]) < 0.3) continue;
    const top = b.p[1] + b.s[1] / 2, bottom = b.p[1] - b.s[1] / 2;
    // tente/saçak (göz hizasının üstünde başlayan) misinayı kesmez
    if (bottom > 1.6) continue;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (top > t[j * w + i]) t[j * w + i] = top;
  }
  lineTops.set(built, t);
  return t;
}

/**
 * Bir olta noktasının avatara sunulmasını engelleyen kusur (yoksa null). `oceanY`: sahnenin ufuk denizi (yoksa null).
 * Testler (`frontend/scripts/uxfb_fishing.test.mjs`) aynı işlevle 25 sahneyi ve yeni şehirleri tarar.
 */
export function fishSpotIssue(built: Built, spot: FishSpot, oceanY: number | null, /** HQA-FIX: eski (sahne ölçeği) şerit kuralı */ legacy = false): FishIssue | null {
  const h = habitat(built);
  const w = built.width, d = built.depth;
  const bi = Math.floor(spot.bx + W / 2), bj = Math.floor(spot.bz + D / 2);
  const inGrid = bi >= 0 && bj >= 0 && bi < w && bj < d;
  if (inGrid) {
    const k = bj * w + bi;
    if (!h.open[k] || Math.abs(h.waterY[k] - spot.by) > 1e-3) return "dry";
  } else if (oceanY === null || Math.abs(spot.by - oceanY) > 1e-3) return "dry";
  // yön: karodan şamandıraya
  const cx = tx(spot.tile[0]), cz = tz(spot.tile[1]);
  const want = Math.atan2(spot.bx - cx, spot.bz - cz);
  if (Math.abs(Math.atan2(Math.sin(want - spot.face), Math.cos(want - spot.face))) > 0.05) return "face";
  // misina: aradaki karolar (karo ile şamandıra karosu arası) göz hizasından alçak
  const top = lineTop(built);
  const di = Math.sign(Math.round(Math.sin(spot.face))), dj = Math.sign(Math.round(Math.cos(spot.face)));
  for (let r = 1; r < 3; r++) {
    const i = spot.tile[0] + di * r, j = spot.tile[1] + dj * r;
    if (i === bi && j === bj) break;
    if (i < 0 || j < 0 || i >= w || j >= d) break;
    if (top[j * w + i] > FISH_LINE_MAX_H) return "wall";
  }
  for (const l of lanesOf(built)) {
    const dist = segDist(spot.bx, spot.bz, l);
    // HQA-FIX: yürüme modunda taşıt insan boyuna büyür (`wide`: yürüme ölçeğinde yarı en + pay); şamandıra o gövdenin
    // geçtiği şeritteyse vapur şamandıranın ve misinanın üstünden geçer (İstanbul kanca 28,14: şamandıra gövde kenarından 0,03 içeride)
    if (dist < (legacy ? l.clear : Math.max(l.clear, l.wide))) return "lane";
    // dar kanal (<city> hendeği): yürüme boyundaki tekne kanalın enini kaplar → onun yarı eniyle
    if (dist < l.wide && inGrid && channelWidth(h, w, d, bi, bj, l) <= NARROW_CHANNEL) return "lane";
  }
  return null;
}

const picked = new WeakMap<readonly FishSpot[], Set<FishSpot>>();

/** HQA-FIX: şamandıranın karo merkezinden en kısa uzaklığı (rıhtım kenarının hemen ötesi; ilk su karosunun içinde). */
export const BOBBER_MIN = 0.7;
/**
 * HQA-FIX ( izi; lider: "olta yerleri silinmesin, taşınsın") — eski (sahne ölçeği) kurala göre geçerli olup yürüme ölçeğindeki
 * vapur/tekne gövdesi şamandıranın üstünden
 * geçiyorsa nokta kaldırılmaz: şamandıra bakış yönünde kıyıya doğru 0,1'lik adımlarla `BOBBER_MIN`'e dek çekilir. Şamandıra açık suda
 * (aynı su yüzü) ve şeritten açık kalmalıdır. Uygunu yoksa nokta değişmez (sonra "şerit" kusurlu sayılır). Nokta nesnesi yerinde
 * güncellenir: Yakındakiler ve olta çözümü (`walkFun.resolveMinigame`) aynı `sites` nesnelerini kullanır.
*/
function pullFromLane(built: Built, s: FishSpot, oceanY: number | null): void {
  const cx = tx(s.tile[0]), cz = tz(s.tile[1]);
  const fx = Math.round(Math.sin(s.face)), fz = Math.round(Math.cos(s.face));
  const k0 = Math.hypot(s.bx - cx, s.bz - cz);
  const bx0 = s.bx, bz0 = s.bz;
  for (let k = Math.round((k0 - 0.1) * 10) / 10; k >= BOBBER_MIN - 1e-6; k = Math.round((k - 0.1) * 10) / 10) {
    s.bx = cx + fx * k; s.bz = cz + fz * k;
    if (!fishSpotIssue(built, s, oceanY)) return;
  }
  s.bx = bx0; s.bz = bz0;
}

/**
 * Avatara sunulan olta noktaları (`spots` içinden; besleme noktaları hariç). Aynı dizi için önbellekli.
 * Kancalı noktalar (`hooks` adet, dizinin başı) önce gelir; her su gövdesi en az bir nokta alır.
 */
export function walkFishSpots(built: Built, spots: readonly FishSpot[], oceanY: number | null): Set<FishSpot> {
  const hit = picked.get(spots);
  if (hit) return hit;
  const h = habitat(built);
  const w = built.width, d = built.depth;
  const bodyOf = (s: FishSpot) => {
    const bi = Math.floor(s.bx + W / 2), bj = Math.floor(s.bz + D / 2);
    return bi >= 0 && bj >= 0 && bi < w && bj < d ? h.bodyOf[bj * w + bi] : -1;
  };
  // HQA-FIX ( izi): şamandırası taşıt şeridindeki nokta silinmez, şamandıra kıyıya çekilir (`pullFromLane`)
  for (const s of spots) if (!s.feedOnly && fishSpotIssue(built, s, oceanY) === "lane" && !fishSpotIssue(built, s, oceanY, true)) pullFromLane(built, s, oceanY);
  const rows = spots.filter((s) => !s.feedOnly).map((s) => ({ s, body: bodyOf(s), issue: fishSpotIssue(built, s, oceanY) }));
  const out = new Set<FishSpot>();
  const chosen = new Map<number, FishSpot[]>();
  const far = (r: { s: FishSpot; body: number }) => (chosen.get(r.body) ?? []).every((c) =>
    Math.hypot(c.tile[0] - r.s.tile[0], c.tile[1] - r.s.tile[1]) >= WALK_FISH_SPACING);
  const take = (r: { s: FishSpot; body: number }) => { out.add(r.s); (chosen.get(r.body) ?? chosen.set(r.body, []).get(r.body)!).push(r.s); };
  for (const r of rows) if (!r.issue && far(r)) take(r);
  // geçerli noktası olmayan su gövdesi: en az kusurlu (şerit < misina < yön) nokta — olta suyu kaybolmaz
  const rank: Record<FishIssue, number> = { lane: 0, wall: 1, face: 2, dry: 3 };
  for (const r of rows) {
    if (chosen.has(r.body) || r.issue === "dry") continue;
    const alt = rows.filter((x) => x.body === r.body && x.issue !== "dry").sort((a, b) => rank[a.issue!] - rank[b.issue!])[0];
    if (alt) take(alt);
  }
  picked.set(spots, out);
  return out;
}
