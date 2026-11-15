/**
 * ENTRY-DOOR-001 (ürün sahibi 2026-11-05 "kulenin kapı girişi yok, nasıl girecek belli değil; diğer yerlerde de bak"):
 * girilebilir her yapının GİRİŞ karosunun önünde, karodan yapının yüzüne bakınca okunur bir kapı vardır: ≥ 1 m genişlik × ≥ 1,8 m
 * yükseklikte, yüzün düzleminde bir açıklık (oyuk/kemer) ya da yüzden belirgin renkte kapı kanadı; önünde eşya/duvar parçası yok.
 *
 * `probeEntry` ölçer (denetim betiği scripts/entry_door_check.mjs ve çalışma zamanı AYNI işlevi kullanır); `entryDoorBlocks` ölçüm
 * başarısızsa yapının üslubuna uyan standart kapıyı (kemerli taş, düz lento, modern cam) yüzün üstüne kurar. Saf modül: React/three yok.
*/
import type { Block } from "../scenes";
import { FULL_ENTRY_DOOR_SLIM, FULL_MODERN_CITIES } from "../../full/entryDoor";

export type Dir2 = readonly [number, number];
const MASS = new Set(["solid", "glass", "glow"]);
/** Kapı penceresi: yanlara ±0,45 (0,9 m + söve payı ≈ 1 m), 0,55 – 1,75 yükseklikte (alt 0,5: basamak/eşik; kanat zeminden 1,8). */
const US = [-0.45, -0.35, -0.25, -0.15, -0.05, 0.05, 0.15, 0.25, 0.35, 0.45];
const YS = [0.55, 0.75, 0.95, 1.15, 1.35, 1.55, 1.75];
/** Duvar referansı: kapı penceresinin yanında (|u| 0,9 – 1,3). */
const WALL_U = [-1.5, -1.3, -1.1, -0.9, 0.9, 1.1, 1.3, 1.5], WALL_Y = [0.9, 1.2, 1.5, 1.8];
export const ENTRY_FACE_MAX = 3.0;
export const ENTRY_FILL_MIN = 0.75; // basamak/sütun payı: pencerenin en az 3/4 ü okunur
export const ENTRY_BLOCK_MAX = 0.15;
const CONTRAST_MIN = 0.15;
/** Yürüme yüksekliği: bundan alçakta kapının önündeki katı parça eşyadır; üstündeki saçak/tente değil. */
const BODY_Y = 1.35;
/** Kapı oyuğu en çok bu kadar derin (daha derin = yüzün önü boş, duvar uzakta: kapı değil). */
const RECESS_MAX = 1.2;
/** Bundan ince (derinlik) önde duran belirgin renkli parça kapı levhasıdır, eşya değil. */
const DECAL_D = 0.12;
/** Üstü bu kadar alçak katı parça (basamak, eşik, kaide) kapının önünde engel sayılmaz. */
const LOW_TOP = 1.0;

export interface EntryProbe {
  ok: boolean;
  why: string[];
  /** karo ortasından yapının yüzüne uzaklık (yoksa null) */
  wall: number | null;
  /** kapı penceresinin okunur örnek oranı */
  fill: number;
  /** önünü kapatan örnek sayısı */
  blocked: number;
  wallColor: string | null;
}

/** İki renk arası RGB uzaklığı (0–1): koyu yeşil kapı kahverengi duvarda da okunur (yalnız parlaklık farkı yetmez). */
const dist = (a: string, b: string): number => {
  const p = parseInt(a.slice(1, 7), 16), q = parseInt(b.slice(1, 7), 16);
  if (!Number.isFinite(p) || !Number.isFinite(q)) return 0;
  return Math.hypot(((p >> 16) & 255) - ((q >> 16) & 255), ((p >> 8) & 255) - ((q >> 8) & 255), (p & 255) - (q & 255)) / 441;
};
const lum = (c: string): number => {
  const n = parseInt(c.slice(1, 7), 16);
  if (!Number.isFinite(n)) return 0.5;
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};

interface Loc { a0: number; a1: number; u0: number; u1: number; y0: number; y1: number; c: string; door: boolean; g: string }
/** Blokları yerel eksene (a: bakış yönü, u: yan) çevirir; yalnız kapı bölgesindekiler. */
function localize(blocks: readonly Block[], cx: number, cz: number, dir: Dir2): Loc[] {
  const out: Loc[] = [];
  const dx = dir[0], dz = dir[1];
  for (const b of blocks) {
    if (!MASS.has(b.g)) continue;
    const px = b.p[0] - cx, pz = b.p[2] - cz;
    const a = px * dx + pz * dz;
    // u ekseni: dir=(0,±1) → u=±x ; dir=(±1,0) → u=∓z (entryDoorBlocks `box` ile aynı)
    const uu = dz !== 0 ? px * dz : -pz * dx;
    const ha = (dx !== 0 ? b.s[0] : b.s[2]) / 2, hu = (dx !== 0 ? b.s[2] : b.s[0]) / 2;
    if (a + ha < 0 || a - ha > ENTRY_FACE_MAX + 0.6 || uu + hu < -1.5 || uu - hu > 1.5) continue;
    out.push({ a0: a - ha, a1: a + ha, u0: uu - hu, u1: uu + hu, y0: b.p[1] - b.s[1] / 2, y1: b.p[1] + b.s[1] / 2, c: b.c, door: !!(b as { entryDoor?: boolean }).entryDoor, g: b.g });
  }
  return out;
}
/** İlk çarpışma (a uzaklığı, blok); yoksa [Infinity, null]. `y`: karo zemininden yükseklik (+ y0). */
function hit(loc: readonly Loc[], u: number, y: number, skipDoor = false): [number, Loc | null] {
  let best = Infinity, who: Loc | null = null;
  for (const l of loc) {
    if (skipDoor && (l.door || l.g !== "solid")) continue; // duvar ölçüsü: kapı/pencere/ışık değil, yalnız katı gövde
    if (u < l.u0 || u > l.u1 || y < l.y0 || y > l.y1) continue;
    const t = Math.max(0, l.a0);
    if (t < best) { best = t; who = l; }
  }
  return [best, who];
}

/**
 * Giriş kapısını ölçer. `blocks`: yapının GÖRÜNEN son blokları (yakın model + varsa kapı işaretleri); `cx,cz`: giriş karosu ortası;
 * `dir`: karodan yapıya yön (eksen); `y0`: karo zemini (yükselti).
 */
export function probeEntry(blocks: readonly Block[], cx: number, cz: number, dir: Dir2, y0 = 0, trace?: (u: number, y: number, t: number, c: string, v: string) => void): EntryProbe {
  const loc = localize(blocks, cx, cz, dir);
  // duvar referansı: standart kapı HARİÇ bütün örneklerin (yan sütunlar + pencere) ilk-yüzey alt çeyreği — podyum/kaide dahil,
  // tek tük direk/süs yüzü saymaz; kapı eklenince ölçü değişmez
  const wallHits: [number, Loc][] = [];
  for (const u of WALL_U) for (const y of WALL_Y) { const [t, l] = hit(loc, u, y + y0, true); if (l && t <= ENTRY_FACE_MAX + 0.5) wallHits.push([t, l]); }
  // pencere (kapı karosunun hemen önü) gövde yüksekliğinde (y ≥ 0,85) ölçülür, ince kapı levhaları (≤ DECAL_D) sayılmaz: dar kulenin yan
  // sütunları arkadaki komşu yapıya gider; kule yüzü pencerede nearer ise duvar odur (medyan: tek direk saymaz). Oyuk kapıda pencere
  // yandan derindir → yan duvar kazanır (min).
  const win: [number, Loc][] = [];
  for (const u of US) for (const y of YS) { if (y < 0.85) continue; const [t, l] = hit(loc, u, y + y0, true); if (l && l.a1 - l.a0 > DECAL_D && t <= ENTRY_FACE_MAX + 0.5) win.push([t, l]); }
  win.sort((p, q) => p[0] - q[0]);
  const winMed: [number, Loc] | null = win.length >= 6 ? win[Math.floor((win.length - 1) / 2)] : null;
  if (wallHits.length < 3) {
    for (const y of [2.2, 2.6, 3.0]) { const [t, l] = hit(loc, 0, y + y0, true); if (l && t <= ENTRY_FACE_MAX + 0.5) wallHits.push([t, l]); }
  }
  const why: string[] = [];
  if (!wallHits.length) {
    // yüzsüz giriş (serbest duran geçit/kapı çerçevesi): pencere açık ya da kanatlı, iki yanında dikme (|u| 0,55–0,85) var
    const jamb = (sgn: number) => YS.filter((y) => y >= 0.35 && [0.55, 0.65, 0.75, 0.85].some((u) => hit(loc, sgn * u, y + y0)[0] <= 1.2)).length;
    if (jamb(-1) >= 4 && jamb(1) >= 4) return { ok: true, why: [], wall: null, fill: 1, blocked: 0, wallColor: null };
    return { ok: false, why: ["karonun önünde yapı yüzü ya da kapı çerçevesi yok (kapı havaya/boşluğa açılıyor)"], wall: null, fill: 0, blocked: 0, wallColor: null };
  }
  wallHits.sort((p, q) => p[0] - q[0]);
  let [wall, wl] = wallHits.length >= 3 ? wallHits[Math.floor((wallHits.length - 1) / 4)] : (winMed ?? wallHits[0]);
  if (winMed && winMed[0] < wall) [wall, wl] = winMed;
  if (wall > ENTRY_FACE_MAX) why.push(`yapı yüzü kapı karosundan ${wall.toFixed(1)} birim uzakta (> ${ENTRY_FACE_MAX})`);
  const wallC = wl.c;
  let good = 0, blocked = 0;
  const colGood: number[] = [];
  for (const u of US) { const g0 = good;
  for (const y of YS) {
    const [t, l] = hit(loc, u, y + y0);
    if (!l) { trace?.(u, y, t, "-", "HOLE"); continue; } // duvarda arkası boş delik: kapı değil
    if (t >= wall + 0.2) { if (t <= wall + RECESS_MAX) { good++; trace?.(u, y, t, l.c, "recess"); } else trace?.(u, y, t, l.c, "FAR"); continue; } // oyuk / kemer açıklığı (sınırlı derinlikte)
    if (t < wall - 0.3) {
      if (l.a1 - l.a0 <= DECAL_D && dist(l.c, wallC) >= CONTRAST_MIN) { good++; trace?.(u, y, t, l.c, "decal"); continue; } // modelin kendi ince kapı levhası
      if (l.y1 <= LOW_TOP + y0) { good++; trace?.(u, y, t, l.c, "step"); } // basamak/eşik/alçak podyum: yol, engel değil
      else if (y <= BODY_Y) { blocked++; trace?.(u, y, t, l.c, "BLOCK"); } else { good++; trace?.(u, y, t, l.c, "overhang"); }
      continue;
    } // önünde eşya (baş üstü saçak/tente kapıyı kapatmaz)
    if (l.g === "glow" || dist(l.c, wallC) >= CONTRAST_MIN) { good++; trace?.(u, y, t, l.c, "leaf"); } else if (l.y1 <= LOW_TOP + y0) { good++; trace?.(u, y, t, l.c, "step"); } else trace?.(u, y, t, l.c, "FLAT"); // ışıklı geçit yüzeyi her zaman kapıdır; kanat yüzden belirgin renkte
  }
  colGood.push(good - g0); }
  const n = US.length * YS.length, fill = good / n;
  // genişlik: ±0,5 pencerenin en az 9/10 sütunu okunur (0,8 m'lik dar kapı 8/10 → kalır)
  const wide = colGood.filter((c) => c >= 0.7 * YS.length).length;
  if (wide < US.length - 1) why.push(`kapı 0,9 m'den dar (okunur sütun ${wide}/${US.length})`);
  else if (fill < ENTRY_FILL_MIN) why.push(`kapı penceresi (1 × 1,8) okunmuyor: ${(fill * 100).toFixed(0)}% < ${ENTRY_FILL_MIN * 100}%`);
  if (blocked / n > ENTRY_BLOCK_MAX) why.push(`kapının önünde eşya/duvar parçası (${blocked} örnek)`);
  return { ok: why.length === 0, why, wall, fill, blocked, wallColor: wl.c };
}

export type DoorStyle = "arch" | "flat" | "modern";
const shade = (c: string, k: number): string => {
  const n = parseInt(c.slice(1, 7), 16);
  if (!Number.isFinite(n)) return c;
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${[f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

/**
 * Standart giriş kapısı blokları (yüzün önünde; en çok 0,3 çıkıntı): `style` arch = kemerli taş çerçeve, flat = düz lento + ahşap kanat,
 * modern = koyu cam kanat + ince metal çerçeve + saçak. Üstte, geçit kapılarındaki ışık çerçevesiyle aynı sıcak şerit (etkileşim).
 */
export function entryDoorBlocks(probe: Pick<EntryProbe, "wall" | "wallColor">, cx: number, cz: number, dir: Dir2, style: DoorStyle, y0 = 0): Block[] {
  if (probe.wall === null) return [];
  const out: Block[] = [];
  const dx = dir[0], dz = dir[1], tf = probe.wall;
  const wl = lum(probe.wallColor ?? "#C9BBA5");
  // (a: yüzden dışa doğru negatif; u: yan) → dünya kutusu
  const box = (a0: number, a1: number, u: number, w: number, y: number, h: number, c: string, g: Block["g"] = "solid") => {
    const ac = (a0 + a1) / 2, ad = a1 - a0;
    const x = cx + dx * ac + (dz !== 0 ? u * dz : 0), z = cz + dz * ac + (dx !== 0 ? -u * dx : 0);
    out.push({ p: [x, y0 + y + h / 2, z], s: dx !== 0 ? [ad, h, w] : [w, h, ad], c, g, j: 0, fix: 1, entryDoor: true } as Block);
  };
  const frame = style === "modern" ? "#C4C9CF" : wl > 0.5 ? shade(probe.wallColor ?? "#C9BBA5", 0.72) : shade(probe.wallColor ?? "#8A8A8A", 1.45);
  // kanat: duvardan en çok ayrışan (koyu ya da açık) üslup rengi
  const [dark, light] = style === "modern" ? ["#27384A", "#BFD6E6"] : ["#3A2418", "#C9A15A"];
  const wc = probe.wallColor ?? "#C9BBA5";
  const leaf = dist(dark, wc) >= dist(light, wc) ? dark : light;
  // kanat çıkıntısı 0,18 (gömülü kısım duvarın içinde); ama karo ortasındaki gövde (yarıçap 0,28; WALK-BODY-001) kapıya girmesin: ön yüz ≥ 0,31
  const A0 = Math.max(tf - 0.18, 0.31), A1 = Math.max(tf + 0.2, A0 + 0.12);
  // blok bütçesi dar (CITY-MAP-BUDGET-001: parsel yuvası dolu olabilir): kapı 2 katı blok (modern: 3) — kanat (ön) + arkasında çerçeve
  // kütlesi (kanadın çevresinde 0,2 + üstte 0,2–0,5 görünür söve/kemer alınlığı); modern: söveye ek saçak
  const fh = style === "arch" ? 2.35 : 2.05, fw = 1.4; // yan karoda gövde payı: 1,0 − 0,7 ≥ 0,28
  box(A0, A1, 0, 1.1, 0, 1.8, leaf);
  // duvar karoya ≤ 0,65 yakınsa (çıkışta avatar duvarın dibinde, kamera sövenin yanından geçer: ARRIVAL-CAM-001) söve çizilmez, yalnız kanat
  if (tf > 0.65) box(Math.max(tf - 0.09, A0 + 0.04), A1, 0, fw, 0, fh, frame); // söve kanattan 0,09 geride
  if (style === "modern") box(A0 - 0.3, A0 + 0.1, 0, 1.9, 1.8, 0.08, shade(frame, 0.8)); // saçak
  // etkileşim dili (ışık perdesi, paspas, sıcak karo plakası) mevcut sistemin: DoorFxLayer `curtain` + district.ts kapı plakası — kapı yalnız yüzü kurar
  return out;
}

/** Üslup: yapı türü + şehir. */
const MODERN = new Set<string>(FULL_MODERN_CITIES);
export function entryStyle(city: string, kind: string): DoorStyle {
  if (MODERN.has(city) && (kind === "tower" || kind === "lobby" || kind === "terrace" || kind === "stadium")) return "modern";
  if (kind === "lobby") return "flat";
  return "arch";
}

/** Kapısı başka ekibin elindeki simgeler (anahtar `<şehir>/<landmark>`; gerekçe zorunlu): standart kapı eklenmez, denetim yine bulgu verir. */
export const ENTRY_DOOR_OWNED: Readonly<Record<string, string>> = {
};

/** Kapı karosundan yapı ayak izine yön (karo adımı; eşitlikte ön/yan sırası). `fp`: ayak izi [i0, j0, w, d] (kapıyla aynı koordinat). */
export function doorDir(door: readonly [number, number], fp: readonly [number, number, number, number]): Dir2 {
  const ci = Math.max(fp[0], Math.min(fp[0] + fp[2] - 1, door[0])), cj = Math.max(fp[1], Math.min(fp[1] + fp[3] - 1, door[1]));
  const di = ci - door[0], dj = cj - door[1];
  if (Math.abs(dj) >= Math.abs(di) && dj !== 0) return [0, Math.sign(dj)];
  if (di !== 0) return [Math.sign(di), 0];
  return [0, -1];
}

/** Yüzsüz giriş (açık ön avlu/meydan): karo kenarında serbest duran kapı — iki dikme + lento (+ kemerde kilit taşı) + sıcak ışık şeridi. */
export function entryGateBlocks(cx: number, cz: number, dir: Dir2, style: DoorStyle, y0 = 0): Block[] {
  const out: Block[] = [];
  const dx = dir[0], dz = dir[1];
  const box = (a: number, ad: number, u: number, w: number, y: number, h: number, c: string, g: Block["g"] = "solid") => {
    const x = cx + dx * a + (dz !== 0 ? u * dz : 0), z = cz + dz * a + (dx !== 0 ? -u * dx : 0);
    out.push({ p: [x, y0 + y + h / 2, z], s: dx !== 0 ? [ad, h, w] : [w, h, ad], c, g, j: 0, fix: 1, entryDoor: true } as Block);
  };
  const stone = style === "modern" ? "#C4C9CF" : "#CBBFA6";
  for (const sgn of [-1, 1]) box(0.44, 0.26, sgn * 0.66, 0.24, 0, 2.2, stone);
  box(0.44, 0.26, 0, 1.56, 2.2, 0.2, stone);
  if (style === "arch") box(0.44, 0.3, 0, 0.36, 2.4, 0.16, shade(stone, 1.1));
  box(0.3, 0.06, 0, 0.9, 2.2, 0.06, "#FDE68A", "glow");
  return out;
}

/** Parsel yakın-blok yuvası (192 katı) dolu olan simgeler: kapı yalnız kanat (tek blok), söve yok (CITY-MAP-BUDGET-001; anahtar `<şehir>/<landmark>`). */
export const ENTRY_DOOR_SLIM: ReadonlySet<string> = new Set<string>(FULL_ENTRY_DOOR_SLIM);
