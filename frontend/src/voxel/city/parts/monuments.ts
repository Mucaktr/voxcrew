/**
 * ortak simge parçaları: kemerli revak, zafer kemeri, yıkık sütunlar, kubbe ve kubbeli yapı, kademeli piramit, rüzgâr
 * kulesi, kafes kule, sivri silüet, minare silüeti. Saf; bir `Sink`'e yazar, tepe y'sini döndürür.
 *
 * Simge tepesi TAM `landmarkTop(height)` (scaleStandard eğrisi; `{ realM, ctx }` ya da hazır `{ top }`). Geçit açıklığı kapı
 * aralığının üstündedir (insan geçer). Dinî yapılar yalnız DIŞ silüettir (alem, haç, yazı, heykel yok); sahne ızgarasında
 * çağıran kit `sacredZone` koyar, uzakta `builderSink(b, "backdrop")` önerilir (SACRED-*).
*/
import { landmarkTop, nClamp, STD, storeyH, type Height, type Sink } from "./core";
import { NEUTRAL } from "../tokens";

/** Sekizgen prizma (3 kutu; citymap/design.ts `oct` ile aynı biçim). y merkez. */
function oct(b: Sink, x: number, y: number, z: number, w: number, h: number, c: string) {
  b(x, y, z, w, h, w * 0.42, c, "solid", 0.03);
  b(x, y, z, w * 0.42, h, w, c, "solid", 0.03);
  b(x, y, z, w * 0.8, h, w * 0.8, c, "solid", 0.03);
}

export interface DomeCapOpts { x: number; y: number; z: number; r: number; h?: number; steps?: number; color?: string; finial?: string | null }
/** `domeCap` — kademeli sekizgen kubbe (kademe başına 3 kutu; 2–4 kademe) + isteğe bağlı küçük topuz (sembol değil, 0,3).
 *  Tepe TAM y + h (+ 0,3 topuz). Kutu: ≤ 13. */
export function domeCap(b: Sink, o: DomeCapOpts): number {
  const steps = nClamp(o.steps ?? 3, 2, 4), h = o.h ?? o.r * 0.9, hh = h / steps, c = o.color ?? "#8E9AA6";
  for (let k = 0; k < steps; k++) {
    const t = (k + 0.35) / steps;
    oct(b, o.x, o.y + k * hh + hh / 2, o.z, 2 * o.r * Math.sqrt(1 - t * t), hh, c);
  }
  if (!o.finial) return o.y + h;
  b(o.x, o.y + h + 0.15, o.z, 0.14, 0.3, 0.14, o.finial, "solid", 0);
  return o.y + h + 0.3;
}

export interface DomeHallOpts {
  x: number; z: number; w?: number; d?: number; height: Height;
  wall?: string; dome?: string; trim?: string; door?: string;
}
/** `domeHall` — kubbeli anıt/salon dış silüeti: gövde (≥ bir kat) + korniş + kapı + sekizgen kasnak + `domeCap` (topuzsuz).
 *  Tepe TAM `landmarkTop(height)`. Kutu: 3 + 3 + 9 = 15. Kutsal yapıysa çağıran `sacredZone` koyar. */
export function domeHall(b: Sink, o: DomeHallOpts): number {
  const top = landmarkTop(o.height), w = Math.min(16, Math.max(2, o.w ?? 6)), d = Math.min(16, Math.max(2, o.d ?? w)), { x, z } = o;
  const bh = Math.max(STD.storeyRange[0], top * 0.55), rest = top - bh, drum = rest * 0.2, dh = rest * 0.8;
  const r = Math.min(Math.min(w, d) * 0.42, Math.max(0.4, dh * 1.1)), wall = o.wall ?? NEUTRAL.plaster;
  b(x, bh / 2, z, w, bh, d, wall, "solid", 0.03);
  b(x, bh - 0.07, z, w + 0.12, 0.14, d + 0.12, o.trim ?? "#F6F0E4", "solid", 0.02);
  b(x, STD.door / 2, z + d / 2 + 0.02, STD.doorWidth * 1.3, STD.door, 0.05, o.door ?? "#5C4A3A", "solid", 0.02);
  oct(b, x, bh + drum / 2, z, 2 * r * 0.92, drum, wall);
  return domeCap(b, { x, y: bh + drum, z, r, h: dh, color: o.dome, finial: null });
}

export interface ArchArcadeOpts {
  x0: number; z0: number;
  /** göz (1–12) */
  n?: number;
  /** göz aralığı (0,8–2) */
  bay?: number;
  depth?: number;
  storey?: number;
  /** revak üstü kat (0–2) */
  above?: number;
  color?: string; trim?: string;
}
/**
 * `archArcade` — kemerli revak / sütun dizisi (<city>, Marakeş, <city>, <city>): n + 1 ayak, göz başına iki kemer omzu,
 * saçak kuşağı, isteğe bağlı üst kat. Ayak yüksekliği bir kat (`storeyH`); omuz altı serbest yükseklik ≥ kapı üst sınırı
 * (1,4: insan geçer). Kutu: 3n + 3 ≤ 39. Tepe döner.
*/
export function archArcade(b: Sink, o: ArchArcadeOpts): number {
  const n = nClamp(o.n ?? 4, 1, 12), bay = Math.min(2, Math.max(0.8, o.bay ?? 1)), dep = o.depth ?? 0.6, H = storeyH(o.storey);
  const haunch = Math.min(0.25, H - STD.doorRange[1]), c = o.color ?? NEUTRAL.stone, zc = o.z0 + dep / 2, L = n * bay;
  for (let k = 0; k <= n; k++) b(o.x0 + k * bay, H / 2, zc, 0.22, H, dep, c, "solid", 0.03);
  for (let k = 0; k < n; k++) {
    const xc = o.x0 + (k + 0.5) * bay;
    for (const s of [-1, 1]) b(xc + s * (bay / 2 - 0.23), H - haunch / 2, zc, 0.24, haunch, dep, c, "solid", 0.03);
  }
  b(o.x0 + L / 2, H + 0.2, zc, L + 0.22, 0.4, dep + 0.06, o.trim ?? "#F6F0E4", "solid", 0.02);
  const up = nClamp(o.above ?? 0, 0, 2);
  if (!up) return H + 0.4;
  const uh = up * storeyH(o.storey);
  b(o.x0 + L / 2, H + 0.4 + uh / 2, zc - dep * 0.25, L + 0.22, uh, dep * 1.5, c, "solid", 0.03);
  return H + 0.4 + uh;
}

export interface ArchGateOpts { x: number; z: number; w?: number; d?: number; height: Height; color?: string; accent?: string }
/** `archGate` — tek açıklıklı anıtsal kemer (zafer kemeri, şehir kapısı; kabartma/yazı yok): iki ayak, kemer omuzları, attika,
 *  korniş. Açıklık ≥ 1,7 (omuz altı ≥ kapı üst sınırı). Tepe TAM `landmarkTop(height)`. Kutu: 6. */
export function archGate(b: Sink, o: ArchGateOpts): number {
  const top = landmarkTop(o.height), w = Math.min(10, Math.max(2.5, o.w ?? 4)), d = o.d ?? 1.2, { x, z } = o, c = o.color ?? NEUTRAL.stone;
  const ow = Math.min(w - 1.2, Math.max(STD.doorWidth * 2, w * 0.4)), oh = Math.min(top - 0.5, Math.max(STD.doorRange[1] + 0.3, top * 0.6));
  const pw = (w - ow) / 2;
  for (const s of [-1, 1]) {
    b(x + s * (ow / 2 + pw / 2), oh / 2, z, pw, oh, d, c, "solid", 0.03);
    b(x + s * (ow / 2 - 0.15), oh - 0.15, z, 0.3, 0.3, d, c, "solid", 0.03);
  }
  b(x, oh + (top - oh) / 2, z, w, top - oh, d, c, "solid", 0.03);
  b(x, oh + (top - oh) * 0.3, z, w + 0.1, 0.12, d + 0.1, o.accent ?? "#F6F0E4", "solid", 0.02);
  return top;
}

export interface RuinColumnsOpts {
  x0: number; z: number;
  /** sütun (1–8) */
  n?: number;
  /** aralık (0,9–2) */
  spacing?: number;
  height: Height;
  /** kırık sütun dizinleri → kalan oran (ör. { 3: 0.45 }); varsayılan son sütun 0,45 (n ≥ 3) */
  broken?: Readonly<Record<number, number>>;
  /** baştan kaç sütunun üstünde arşitrav (0 ya da 2–n; varsayılan min(n, 3)) */
  span?: number;
  color?: string; accent?: string;
}
/** `ruinColumns` — antik sütun dizisi kalıntısı (<city>, <city>): kaide + gövde + başlık; seçilen sütunlar kırık, baştakiler
 * arşitravlı. Tepe TAM `landmarkTop(height)` (arşitrav ya da en uzun başlık). Kutu: ≤ 3n + 1 = 25.*/
export function ruinColumns(b: Sink, o: RuinColumnsOpts): number {
  const top = landmarkTop(o.height), n = nClamp(o.n ?? 4, 1, 8), sp = Math.min(2, Math.max(0.9, o.spacing ?? 1.2)), c = o.color ?? "#D8C8A8";
  const span = n >= 2 ? nClamp(o.span ?? Math.min(n, 3), 0, n) : 0, archH = span >= 2 ? Math.min(0.6, top * 0.08) : 0, colTop = top - archH;
  const broken = o.broken ?? (n >= 3 ? { [n - 1]: 0.45 } : {});
  for (let k = 0; k < n; k++) {
    const x = o.x0 + k * sp, f = k < span ? 1 : (broken[k] ?? 1), ct = Math.max(0.6, colTop * f);
    b(x, 0.15, o.z, 0.62, 0.3, 0.62, c, "solid", 0.03);
    b(x, (0.3 + ct - (f === 1 ? 0.3 : 0)) / 2, o.z, 0.4, ct - 0.3 - (f === 1 ? 0.3 : 0), 0.4, c, "solid", 0.04);
    if (f === 1) b(x, ct - 0.15, o.z, 0.58, 0.3, 0.58, o.accent ?? c, "solid", 0.03);
  }
  if (span >= 2) b(o.x0 + ((span - 1) * sp) / 2, colTop + archH / 2, o.z, (span - 1) * sp + 0.6, archH, 0.6, o.accent ?? c, "solid", 0.03);
  return top;
}

export interface PyramidOpts { x: number; z: number; w?: number; height: Height; steps?: number; color?: string; cap?: string }
/** `pyramidStylized` — kademeli, stilize piramit (<city>; gerçek oran/iç geçit yok): kademe başına bir kutu, en üstte açık
 * renkli başlık. Tepe TAM `landmarkTop(height)`. Kutu: 3–8.*/
export function pyramidStylized(b: Sink, o: PyramidOpts): number {
  const top = landmarkTop(o.height), w = Math.min(16, Math.max(3, o.w ?? 8)), n = nClamp(o.steps ?? 5, 3, 8), sh = top / n;
  for (let k = 0; k < n; k++) {
    const f = 1 - k / n;
    b(o.x, k * sh + sh / 2, o.z, w * f, sh, w * f, k === n - 1 ? (o.cap ?? "#E8D9B0") : (o.color ?? "#D6C3A0"), "solid", 0.05);
  }
  return top;
}

export interface WindTowerOpts { x: number; z: number; w?: number; height: Height; y?: number; wall?: string; trim?: string; vent?: string }
/** `windTower` — rüzgâr kulesi / bacgir (<city>, Marakeş): kare gövde (çatıdan `y`'de başlayabilir), dört yüzde açık havalandırma
 * (çapraz koyu iç + köşe dikmeleri), düz başlık. Tepe TAM `landmarkTop(height)` (yerden). Kutu: 8.*/
export function windTower(b: Sink, o: WindTowerOpts): number {
  const top = landmarkTop(o.height), w = Math.min(2.4, Math.max(0.8, o.w ?? 1.2)), y0 = Math.max(0, o.y ?? 0), { x, z } = o;
  const cap = 0.2, vent = Math.min(1.6, (top - y0) * 0.3), y1 = top - cap - vent, wall = o.wall ?? "#E8DCC4", dark = o.vent ?? "#4A3E30";
  b(x, (y0 + y1) / 2, z, w, y1 - y0, w, wall, "solid", 0.03);
  b(x, y1 + vent / 2, z, w - 0.04, vent * 0.8, w * 0.25, dark, "solid", 0);
  b(x, y1 + vent / 2, z, w * 0.25, vent * 0.8, w - 0.04, dark, "solid", 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b(x + sx * (w / 2 - 0.08), y1 + vent / 2, z + sz * (w / 2 - 0.08), 0.16, vent, 0.16, wall, "solid", 0.02);
  b(x, top - cap / 2, z, w + 0.12, cap, w + 0.12, o.trim ?? "#F7F2E8", "solid", 0.02);
  return top;
}

export interface LatticeTowerOpts { x: number; z: number; w?: number; height: Height; tiers?: number; deck?: boolean; color?: string; deckColor?: string }
/** `latticeTower` — incelen kafes kule (<city>, <city> yayın kulesi; ışık gösterisi yok): kat başına dört ayak + dört kuşak,
 * isteğe bağlı seyir katı, anten. Tepe TAM `landmarkTop(height)`. Kutu: ≤ 6 × 8 + 2 = 50.*/
export function latticeTower(b: Sink, o: LatticeTowerOpts): number {
  const top = landmarkTop(o.height), w = Math.min(12, Math.max(2, o.w ?? 4)), tiers = nClamp(o.tiers ?? 4, 3, 6), { x, z } = o, c = o.color ?? "#6E7680";
  const mast = top * 0.12, lt = top - mast, th = lt / tiers, hw = (y: number) => (w / 2) * (1 - 0.8 * (y / lt));
  for (let k = 0; k < tiers; k++) {
    const ym = k * th + th / 2, a = hw(ym) - 0.09, yt = (k + 1) * th, r = hw(yt), leg = Math.max(0.1, 0.2 * (1 - k / tiers));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b(x + sx * a, ym, z + sz * a, leg, th, leg, c, "solid", 0.02);
    for (const s of [-1, 1]) {
      b(x, yt - 0.06, z + s * r, 2 * r, 0.12, 0.12, c, "solid", 0);
      b(x + s * r, yt - 0.06, z, 0.12, 0.12, 2 * r, c, "solid", 0);
    }
  }
  if (o.deck !== false) b(x, th + 0.1, z, 2 * hw(th) + 0.4, 0.2, 2 * hw(th) + 0.4, o.deckColor ?? "#C9C2B2", "solid", 0.02);
  b(x, lt + mast / 2, z, 0.14, mast, 0.14, c, "solid", 0);
  return top;
}

export interface SpireOpts { x: number; z: number; w?: number; height: Height; color?: string; accent?: string; roof?: string }
/** `spireSilhouette` — uzak sivri kule silüeti (çan kulesi, tapınak kulesi; `sacred`, uzak — <city>, <city>, Marakeş, <city>):
 * gövde + kuşak + kule odası + dört kademeli sivri. Sembol yok. Tepe TAM `landmarkTop(height)`. Kutu: 7.*/
export function spireSilhouette(b: Sink, o: SpireOpts): number {
  const top = landmarkTop(o.height), w = Math.min(6, Math.max(1, o.w ?? 2)), { x, z } = o, c = o.color ?? "#C9B79A";
  const h0 = top * 0.35, bh = top * 0.15, y1 = h0 + bh, sh = (top - y1) / 4;
  b(x, h0 / 2, z, w, h0, w, c, "solid", 0.03);
  b(x, h0, z, w + 0.1, 0.12, w + 0.1, o.accent ?? "#F6F0E4", "solid", 0.02);
  b(x, h0 + bh / 2, z, w * 0.7, bh, w * 0.7, c, "solid", 0.03);
  [0.5, 0.36, 0.24, 0.12].forEach((f, k) => b(x, y1 + k * sh + sh / 2, z, w * f, sh, w * f, o.roof ?? c, "solid", 0.02));
  return top;
}

export interface MinaretOpts { x: number; z: number; shaft?: number; height: Height; color?: string; cap?: string; trim?: string }
/** `minaretSilhouette` — ince kalem minare DIŞ silüeti (kaide, gövde, şerefe, üst gövde, iki kademeli külah; alem yok).
 *  Tepe TAM `landmarkTop(height)`. Kutu: 6. Çağıran `sacredZone` koyar. */
export function minaretSilhouette(b: Sink, o: MinaretOpts): number {
  const top = landmarkTop(o.height), s = Math.min(1.2, Math.max(0.3, o.shaft ?? 0.5)), { x, z } = o, c = o.color ?? "#E9E1D0";
  const capH = Math.min(1.4, top * 0.12), st = top - capH, base = Math.min(1.2, st * 0.2), bal = st * 0.72;
  b(x, base / 2, z, s * 1.6, base, s * 1.6, c, "solid", 0.03);
  b(x, (base + bal) / 2, z, s, bal - base, s, c, "solid", 0.03);
  b(x, bal, z, s * 1.9, 0.14, s * 1.9, o.trim ?? "#8E98A1", "solid", 0.02);
  b(x, (bal + st) / 2, z, s * 0.85, st - bal, s * 0.85, c, "solid", 0.03);
  b(x, st + capH * 0.25, z, s * 0.8, capH * 0.5, s * 0.8, o.cap ?? "#7D8B99", "solid", 0.02);
  b(x, st + capH * 0.75, z, s * 0.36, capH * 0.5, s * 0.36, o.cap ?? "#7D8B99", "solid", 0.02);
  return top;
}

