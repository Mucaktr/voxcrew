/**
 * S42 — çok katlı yapı yardımcıları: kat döşemesi, cam korkuluk, merdiven, yürüyen merdiven, asansör kuyusu, gece yanan
 * pencereler ve N katlı bina kabuğu. AVM (çok katlı atriyum + otopark), okul (iki katlı blok) kullanır; diğer sahneler
 * (ofis kulesi, çok güverteli yat) aynı yardımcıları çağırabilir.
 *
 * YÜRÜNEBİLİRLİK KARARI (a): üst katlar YALNIZCA GÖRSELDİR. Ajanlar zemin katta kalır; yol bulma 2B ızgara (`findPath`)
 * olarak doğru ve hızlı kalır. Üst katlar amaçlı görünür: korkuluklu asma kat/galeri, aydınlık vitrinler, yanan pencereler.
 * Merdiven, yürüyen merdiven ve asansör ayak izlerini ENGELLER (ajan üstlerinden yürümez). Üst kat döşemeleri hiçbir karoyu
 * engellemez; altlarından yürünür. Çok katlı yürünebilirlik (b: kat dizinli istasyonlar + merdiven "geçitleri") için
 * tasarım: "Çok katlı yürünebilirlik (b)".
 *
 * Kamera notu: kamera önden ~38° yukarıdan bakar. Bir döşeme, altındaki ajanı yalnızca ajanın ÜSTÜNDEYSE kapatır; bu yüzden
 * yüksek yapılar arkaya (küçük j), alçak olanlar öne konur ve galeri derinliği ≤ 2 karo tutulur.
 *
 * Kayıt notu (worldRecord.ts): bunlar Builder yöntemi değil serbest fonksiyonlardır; içlerindeki box/cube/block çağrıları
 * üst düzey çağrı olarak kaydedilir (dünya JSON'u değişiklik gerektirmeden eşdeğer kalır). Gece pencere işaretleri
 * (`window` canlı dekoru) yalnızca kurucuda vardır; JSON'dan pişen dünyada pencereler gündüz camı olarak kalır.
 *
 * Döngüsel içe aktarma: yalnızca fonksiyon bildirimleri dışa aktarılır, scenes.ts değerleri gövdelerde kullanılır.
*/
import { noteObject } from "./rules/hooks";
import { DIR_ANGLE, tx, tz, type Builder, type Dir } from "./scenes";

/** Varsayılan kat yüksekliği (dünya birimi). */
export const STOREY = 3;

/** Gece yanan pencere işareti (props/Props.tsx `window`): merkez, yüz yönü, genişlik × yükseklik, renk. */
export function litWindow(b: Builder, x: number, y: number, z: number, face: Dir, w: number, h: number, c = "#FFD98A"): void {
  b.props.push({ k: "window", p: [x, y, z], r: DIR_ANGLE[face], s: [w, h], c });
}

/** Kat döşemesi: (i0, j0) sol-arka karo, w × d karo, üst yüzü y. Görseldir, engellemez. `lip`: ön kenar (+z) kaplama
 *  rengi; `glowLip`: ön kenarın altında ışık şeridi (gece de okunur). */
export function slab(b: Builder, i0: number, j0: number, w: number, d: number, y: number, c: string,
  o: { t?: number; lip?: string; glowLip?: string } = {}): void {
  const t = o.t ?? 0.25;
  noteObject(b, "floor_slab", [i0, j0], { w, d, y }); // S45: kat ontolojisi (rules/levels)
  const x = (tx(i0) + tx(i0 + w - 1)) / 2, z = (tz(j0) + tz(j0 + d - 1)) / 2;
  b.box(x, y - t / 2, z, w, t, d, c, "solid", 0.02);
  if (o.lip) b.box(x, y - t / 2, z + d / 2 + 0.02, w + 0.02, t + 0.06, 0.06, o.lip);
  if (o.glowLip) b.box(x, y - t - 0.03, z + d / 2 - 0.1, w - 0.1, 0.04, 0.08, o.glowLip, "glow");
}

/** Cam korkuluk + tutamak. axis "x": z = `at` çizgisinde x `from`→`to`; "z": x = `at`, z `from`→`to` (dünya koordinatı). */
export function railing(b: Builder, axis: "x" | "z", at: number, from: number, to: number, y: number,
  glass = "#CFEFFF", cap = "#1F2937"): void {
  const len = Math.abs(to - from), mid = (from + to) / 2;
  if (axis === "x") {
    b.box(mid, y + 0.45, at, len, 0.86, 0.05, glass, "glass");
    b.box(mid, y + 0.92, at, len + 0.04, 0.07, 0.1, cap);
  } else {
    b.box(at, y + 0.45, mid, 0.05, 0.86, len, glass, "glass");
    b.box(at, y + 0.92, mid, 0.1, 0.07, len + 0.04, cap);
  }
}

/** Taşıyıcı sütun: (i, j) karosunda, tabandan `h` yüksekliğe. `block`: karoyu engelle (varsayılan evet). */
export function column(b: Builder, i: number, j: number, h: number, c = "#E2E8F0", block = true, s = 0.42): void {
  b.box(tx(i), h / 2, tz(j), s, h, s, c, "solid", 0.02);
  if (block) b.block(i, j);
}

/** Düz merdiven: jBottom (önde, zemin) → jTop (arkada, `rise` yüksekliğinde); `w` karo genişliğinde (i'den sağa). Karo başına
 *  iki basamak; yanlarda korkuluk. Ayak izini engeller. */
export function stairs(b: Builder, i: number, jTop: number, jBottom: number, rise: number, c = "#CBD5E1", w = 1,
  rail = "#475569"): void {
  noteObject(b, "stairs", [i, jTop], { w, d: jBottom - jTop + 1, y: rise });
  const n = jBottom - jTop + 1, steps = n * 2;
  const x = tx(i) + (w - 1) / 2;
  for (let k = 0; k < steps; k++) {
    const h = (rise * (k + 1)) / steps;
    const z = tz(jBottom) + 0.25 - k * 0.5;
    b.box(x, h / 2, z, w - 0.04, h, 0.5, c, "solid", 0.02);
    b.box(x, h + 0.01, z + 0.22, w - 0.06, 0.03, 0.06, "#94A3B8");
  }
  for (const side of [-1, 1]) {
    const rx = x + side * (w / 2 - 0.04);
    // eğimli tutamak: basamaklandırılmış kısa parçalar (döndürülmüş kutu yok) + iki uçta dikme
    for (let k = 0; k < steps; k++) {
      const z = tz(jBottom) + 0.25 - k * 0.5;
      b.box(rx, (rise * (k + 1)) / steps + 0.9, z, 0.06, 0.06, 0.5, rail);
      // REAL-SUPPORT: tutamak parçası her basamaktan yükselen balüstrata oturur (eskiden basamaklı parçalar birbirine/basamağa değmiyordu)
      const hk = (rise * (k + 1)) / steps;
      b.box(rx, (hk + 0.02 + hk + 0.87) / 2, z, 0.04, 0.85, 0.04, rail);
    }
    b.box(rx, 0.45, tz(jBottom) + 0.4, 0.06, 0.9, 0.06, rail);
    b.box(rx, rise + 0.45, tz(jTop) - 0.4, 0.06, 0.9, 0.06, rail);
  }
  for (let j = jTop; j <= jBottom; j++) for (let k = 0; k < w; k++) b.block(i + k, j);
}

/** Araç rampası: jBottom (önde, zemin) → jTop (arkada, `rise`), `w` karo genişliğinde (i'den sağa). Karo başına 4 ince
 *  kademe (eğim yumuşak görünür), iki yanda bordür, ortada sarı ok çizgileri. Ayak izini engeller. */
export function ramp(b: Builder, i: number, jTop: number, jBottom: number, rise: number, w = 2, c = "#8B95A3", curb = "#C9CED6"): void {
  noteObject(b, "ramp", [i, jTop], { w, d: jBottom - jTop + 1, y: rise });
  const n = jBottom - jTop + 1, steps = n * 4;
  const x = tx(i) + (w - 1) / 2;
  for (let k = 0; k < steps; k++) {
    const h = (rise * (k + 1)) / steps;
    const z = tz(jBottom) + 0.5 - (k + 0.5) / 4;
    b.box(x, h / 2, z, w, h, 0.25, c, "solid", 0.01);
    for (const side of [-1, 1]) b.box(x + side * (w / 2 - 0.06), h + 0.12, z, 0.12, 0.24, 0.25, curb);
    if (k % 4 === 1) b.box(x, h + 0.01, z, 0.5, 0.02, 0.1, "#F2B33D");
  }
  for (let j = jTop; j <= jBottom; j++) for (let k = 0; k < w; k++) b.block(i + k, j);
}

/** Yürüyen merdiven (2 karo): jBottom (önde, zemin) → jTop (arkada, `rise`). Metal gövde, basamaklar, cam korkuluk,
 *  siyah bant tutamak, alt ve üstte tarak plakası; altta yön oku (yukarı yeşil, aşağı kehribar). Ayak izini engeller. */
export function escalator(b: Builder, i: number, jTop: number, jBottom: number, rise: number, dir: "up" | "down" = "up"): void {
  noteObject(b, "escalator", [i, jTop], { w: 2, d: jBottom - jTop + 1, y: rise });
  const n = jBottom - jTop + 1, steps = n * 3;
  const x = tx(i) + 0.5;
  for (let k = 0; k < steps; k++) {
    const h = (rise * (k + 1)) / steps;
    const z = tz(jBottom) + 0.5 - (k + 0.5) / 3;
    b.box(x, h / 2, z, 1.5, h, 1 / 3, "#A3AAB5", "solid", 0.02);
    b.box(x, h + 0.015, z, 1.3, 0.03, 0.3, "#4B5563");
    b.box(x, h + 0.035, z + 0.14, 1.3, 0.02, 0.04, "#FACC15");
  }
  // yan gövde (metal etek) + cam korkuluk + tutamak (basamaklı)
  for (const side of [-1, 1]) {
    const sx = x + side * 0.82;
    for (let k = 0; k < n * 2; k++) {
      const z = tz(jBottom) + 0.25 - k * 0.5;
      const h = (rise * (k + 1)) / (n * 2);
      b.box(sx, h / 2 + 0.05, z, 0.14, h + 0.1, 0.5, "#CBD5E1", "solid", 0.02);
      b.box(sx, h + 0.55, z, 0.05, 0.9, 0.5, "#CFEFFF", "glass");
      b.box(sx, h + 1.02, z, 0.11, 0.07, 0.5, "#111827");
    }
  }
  // tarak plakaları
  b.box(x, 0.02, tz(jBottom) + 0.62, 1.7, 0.04, 0.3, "#9CA3AF");
  b.box(x, rise + 0.02, tz(jTop) - 0.62, 1.7, 0.04, 0.3, "#9CA3AF");
  // yön oku (yere yakın, alt uçta)
  const arrow = dir === "up" ? "#22C55E" : "#F59E0B";
  b.box(x, 0.27, tz(jBottom) + 0.66, 0.05, 0.54, 0.05, "#4B5563"); // REAL-SUPPORT: yön levhası tarak plakasından yükselen dikmede
  b.box(x, 0.72, tz(jBottom) + 0.66, 0.5, 0.36, 0.05, "#111827");
  b.box(x, 0.72 + (dir === "up" ? 0.06 : -0.06), tz(jBottom) + 0.69, 0.1, 0.18, 0.02, arrow, "glow");
  b.box(x, 0.72 + (dir === "up" ? 0.1 : -0.1), tz(jBottom) + 0.69, 0.26, 0.06, 0.02, arrow, "glow");
  for (let j = jTop; j <= jBottom; j++) { b.block(i, j); b.block(i + 1, j); }
}

/** Cam asansör kuyusu: (i, j) karosu, `floors` kat × `h`. Köşe dikmeleri, kat kirişleri, `cabAt` katında kabin, her katta
 *  kat göstergesi (parlak) ve çağrı düğmesi, tepede makine dairesi. Karoyu engeller. Kapı yüzü `face`. */
export function elevator(b: Builder, i: number, j: number, floors: number, h = STOREY, o: { face?: Dir; cabAt?: number; frame?: string } = {}): void {
  noteObject(b, "elevator", [i, j], { w: 1, d: 1, floors, y: floors * h });
  const face = o.face ?? "+z", frame = o.frame ?? "#475569", cabAt = o.cabAt ?? 1;
  const x = tx(i), z = tz(j), top = floors * h + 0.4;
  b.box(x, top / 2, z, 0.9, top, 0.9, "#CFEFFF", "glass");
  for (const dx of [-0.46, 0.46]) for (const dz of [-0.46, 0.46]) b.box(x + dx, top / 2, z + dz, 0.08, top, 0.08, frame);
  for (let f = 0; f <= floors; f++) b.box(x, Math.min(top, f * h + 0.02), z, 0.98, 0.08, 0.98, frame);
  b.box(x, top + 0.3, z, 1, 0.6, 1, "#94A3B8", "solid", 0.02);
  // kabin
  const cy = cabAt * h;
  b.box(x, cy + 1.1, z, 0.74, 2.1, 0.74, "#E5E7EB", "solid", 0.02);
  const fz = face === "+z" ? 0.38 : face === "-z" ? -0.38 : 0, fx = face === "+x" ? 0.38 : face === "-x" ? -0.38 : 0;
  const along = fz !== 0;
  b.box(x + fx, cy + 1.05, z + fz, along ? 0.6 : 0.02, 1.9, along ? 0.02 : 0.6, "#CFEFFF", "glass");
  b.box(x, cy + 2.25, z, 0.5, 0.06, 0.5, "#FFF3C4", "glow");
  // her katta gösterge + çağrı düğmesi (kapı yüzünde)
  for (let f = 0; f < floors; f++) {
    const y = f * h;
    const gx = x + fx * 1.27, gz = z + fz * 1.27;
    b.box(gx, y + 2.35, gz, along ? 0.36 : 0.03, 0.16, along ? 0.03 : 0.36, "#111827");
    b.box(gx + fx * 0.03, y + 2.35, gz + fz * 0.03, along ? 0.24 : 0.02, 0.08, along ? 0.02 : 0.24, f === cabAt ? "#34D399" : "#F59E0B", "glow");
  }
  b.block(i, j);
}

export interface WinOpts {
  /** pencere genişliği (karo payı), varsayılan 0.78 */
  w?: number;
  /** her kaç karoda bir */
  every?: number;
  frame?: string;
  glass?: string;
  /** gece ışık rengi; null → yanmaz */
  lit?: string | null;
  /** yüz yönü; x ekseninde "+z" (varsayılan) ya da "-z", z ekseninde "+x" ya da "-x" */
  face?: Dir;
}

/** Pencere şeridi: axis "x" → j sırasındaki duvarın `face` yüzünde, i `from`…`to`; axis "z" → i sütunundaki duvarın yüzünde,
 *  j `from`…`to`. y0 alt kenar, h yükseklik. Cam + çerçeve + gece ışığı işareti. Engellemez (duvar zaten engeller). */
export function windows(b: Builder, axis: "x" | "z", line: number, from: number, to: number, y0: number, h: number, o: WinOpts = {}): void {
  const w = o.w ?? 0.78, every = o.every ?? 1, frame = o.frame ?? "#F8FAFC", glass = o.glass ?? "#A8D8F0";
  const face: Dir = o.face ?? (axis === "x" ? "+z" : "+x");
  const sgn = face[0] === "-" ? -1 : 1;
  const lit = o.lit === undefined ? "#FFD98A" : o.lit;
  for (let k = from; k <= to; k += every) {
    const y = y0 + h / 2;
    if (axis === "x") {
      const x = tx(k), z = tz(line) + sgn * 0.5;
      b.box(x, y, z + sgn * 0.01, w, h, 0.06, glass, "glass");
      b.box(x, y0 - 0.04, z + sgn * 0.04, w + 0.12, 0.08, 0.12, frame);
      b.box(x, y0 + h + 0.04, z + sgn * 0.03, w + 0.12, 0.08, 0.1, frame);
      b.box(x, y, z + sgn * 0.04, 0.05, h, 0.06, frame);
      if (lit) litWindow(b, x, y, z + sgn * 0.045, face, w - 0.04, h - 0.04, lit);
    } else {
      const z = tz(k), x = tx(line) + sgn * 0.5;
      b.box(x + sgn * 0.01, y, z, 0.06, h, w, glass, "glass");
      b.box(x + sgn * 0.04, y0 - 0.04, z, 0.12, 0.08, w + 0.12, frame);
      b.box(x + sgn * 0.03, y0 + h + 0.04, z, 0.1, 0.08, w + 0.12, frame);
      b.box(x + sgn * 0.04, y, z, 0.06, h, 0.05, frame);
      if (lit) litWindow(b, x + sgn * 0.045, y, z, face, w - 0.04, h - 0.04, lit);
    }
  }
}

export interface TowerOpts {
  i0: number; j0: number; w: number; d: number;
  floors: number;
  /** kat yüksekliği */
  h?: number;
  wall: string;
  /** kat çizgisi / parapet rengi */
  trim: string;
  glass?: string;
  /** gece ışık rengi (null: yanmaz) */
  lit?: string | null;
  /** zemin katta ön yüzde pencere yerine giriş kapısı (yerel i) */
  door?: number;
  /** çatı süsü: su deposu / klima / anten */
  roof?: "plant" | "tank" | "none";
}

/** N katlı kapalı bina kabuğu (ofis kulesi, okul bloğu, otopark merdiven kulesi…): duvar gövdesi, her katta ön ve yan
 *  pencere şeritleri (gece yanar), kat çizgileri, parapet ve çatı ekipmanı. Ayak izini engeller. */
export function tower(b: Builder, o: TowerOpts): void {
  const h = o.h ?? STOREY, H = o.floors * h;
  const { i0, j0, w, d } = o;
  noteObject(b, "tower", [i0, j0], { w, d, floors: o.floors, y: H, enclosed: true });
  const x = (tx(i0) + tx(i0 + w - 1)) / 2, z = (tz(j0) + tz(j0 + d - 1)) / 2;
  b.box(x, H / 2, z, w, H, d, o.wall, "solid", 0.03);
  for (let f = 1; f <= o.floors; f++) b.box(x, f * h - 0.06, z, w + 0.06, 0.12, d + 0.06, o.trim);
  b.box(x, H + 0.25, z, w + 0.1, 0.5, d + 0.1, o.trim, "solid", 0.02);
  const win: WinOpts = { glass: o.glass, lit: o.lit, frame: o.trim };
  for (let f = 0; f < o.floors; f++) {
    const y0 = f * h + 0.8, wh = h - 1.4;
    if (o.door !== undefined && f === 0) {
      const di = i0 + o.door;
      windows(b, "x", j0 + d - 1, i0, di - 1, y0, wh, win);
      windows(b, "x", j0 + d - 1, di + 1, i0 + w - 1, y0, wh, win);
      b.box(tx(di), 1.05, tz(j0 + d - 1) + 0.51, 0.8, 2.1, 0.04, "#334155");
      b.box(tx(di), 1.05, tz(j0 + d - 1) + 0.53, 0.6, 1.9, 0.02, o.glass ?? "#A8D8F0", "glass");
    } else windows(b, "x", j0 + d - 1, i0, i0 + w - 1, y0, wh, win);
    if (d >= 2) {
      windows(b, "z", i0, j0, j0 + d - 1, y0, wh, { ...win, face: "-x", every: 2 });
      windows(b, "z", i0 + w - 1, j0, j0 + d - 1, y0, wh, { ...win, face: "+x", every: 2 });
    }
  }
  if (o.roof === "tank") {
    b.box(x + w / 4, H + 1.0, z, 0.9, 1.0, 0.9, "#94A3B8", "solid", 0.03);
    for (const dx of [-0.35, 0.35]) b.box(x + w / 4 + dx, H + 0.5, z, 0.08, 0.5, 0.08, "#475569");
  } else if (o.roof !== "none") {
    b.box(x - w / 4, H + 0.75, z, Math.min(1.6, w / 2), 0.5, Math.min(1.2, d), "#CBD5E1", "solid", 0.02);
    b.box(x - w / 4, H + 1.02, z, 0.5, 0.06, 0.5, "#64748B");
  }
  for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + d; j++) b.block(i, j);
}

/** Otopark katı: (i0, j0) w × d, üst yüzü y; kenarda alçak beton parapet, park çizgileri (x boyunca 1 karo aralıkla),
 *  sarı yön oku. Engellemez (zemin katın engellerini çağıran koyar). */
export function parkingDeck(b: Builder, i0: number, j0: number, w: number, d: number, y: number,
  o: { c?: string; parapet?: string; lines?: string; rows?: number[] } = {}): void {
  const c = o.c ?? "#8B95A3", par = o.parapet ?? "#C9CED6", line = o.lines ?? "#F8FAFC";
  slab(b, i0, j0, w, d, y, c, { t: 0.3 });
  const x = (tx(i0) + tx(i0 + w - 1)) / 2, z = (tz(j0) + tz(j0 + d - 1)) / 2;
  b.box(x, y + 0.3, tz(j0 + d - 1) + 0.45, w, 0.6, 0.1, par, "solid", 0.03);
  b.box(tx(i0) - 0.45, y + 0.3, z, 0.1, 0.6, d, par, "solid", 0.03);
  b.box(x, y + 0.08, tz(j0 + d - 1) + 0.38, w, 0.04, 0.05, "#F2B33D");
  for (const lj of o.rows ?? []) for (let i = i0; i <= i0 + w; i++) b.box(tx(i) - 0.5, y + 0.01, tz(j0 + lj) + 0.5, 0.05, 0.02, 1.9, line);
}

/** Genel otomobil (2 karo; burnu `nose` yönünde: z ekseninde j–j+1, x ekseninde i–i+1), tabanı y. `taxi`: tavan lambası.
 *  Engellemez — zemin katta çağıran engeller. */
export function car(b: Builder, i: number, j: number, c: string, y = 0, nose: Dir = "+z", taxi = false): void {
  noteObject(b, "car", [i, j], { y });
  const ax = nose[1] === "x", s = nose[0] === "-" ? -1 : 1;
  const x = tx(i) + (ax ? 0.5 : 0), z = tz(j) + (ax ? 0 : 0.5);
  // (u: boyuna, v: enine) → dünya
  const put = (u: number, yy: number, v: number, lu: number, h: number, lv: number, col: string, g: "solid" | "glow" = "solid", jit = 0) =>
    b.box(ax ? x + u : x + v, yy, ax ? z + v : z + u, ax ? lu : lv, h, ax ? lv : lu, col, g, jit);
  put(0, y + 0.42, 0, 1.8, 0.5, 0.95, c, "solid", 0.03);
  put(-s * 0.1, y + 0.86, 0, 1.0, 0.4, 0.85, "#1E3A5F");
  put(-s * 0.1, y + 1.08, 0, 0.95, 0.05, 0.8, c);
  for (const dv of [-0.48, 0.48]) for (const du of [-0.6, 0.6]) put(du, y + 0.18, dv, 0.34, 0.34, 0.12, "#111827");
  for (const dv of [-0.3, 0.3]) put(s * 0.91, y + 0.5, dv, 0.02, 0.1, 0.2, "#FEF3C7", "glow");
  for (const dv of [-0.3, 0.3]) put(-s * 0.91, y + 0.5, dv, 0.02, 0.1, 0.2, "#DC2626");
  if (taxi) { put(-s * 0.1, y + 1.19, 0, 0.3, 0.16, 0.5, "#FDE68A", "glow"); put(0, y + 0.45, 0, 1.2, 0.08, 0.97, "#111827"); }
}

/** Piksel tabela simgesi ('#' = piksel): (x, y) merkez, ön yüz konumu. `axis` "x": +z'ye bakan levhada (sütunlar x boyunca),
 *  "z": ±x'e bakan levhada (sütunlar z boyunca). `px` piksel boyu. Yazı yok (dile bağlı değil). */
export function pixelIcon(b: Builder, rows: readonly string[], x: number, y: number, z: number, c: string, px = 0.14,
  g: "solid" | "glow" = "solid", axis: "x" | "z" = "x"): void {
  const n = rows.length, m = rows[0]?.length ?? 0;
  rows.forEach((row, r) => [...row].forEach((ch, k) => {
    if (ch !== "#") return;
    const u = (k - (m - 1) / 2) * px, v = y + ((n - 1) / 2 - r) * px;
    if (axis === "x") b.box(x + u, v, z, px, px, 0.03, c, g);
    else b.box(x, v, z + u, 0.03, px, px, c, g);
  }));
}
