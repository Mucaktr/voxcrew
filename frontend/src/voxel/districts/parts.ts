/**
 * S38 — bölge (district) parçaları: büyüyen dünyanın ekip alanları ve paylaşılan olanakları bu küçük kurucularla çizilir.
 * Hepsi var olan blok gruplarını (solid / glass / glow / water / flag) kullanır: yeni malzeme ya da çizim çağrısı yok.
 * Duvar, çit ve çitler tek uzun kutu olarak çizilir (karo başına küp değil) — üçgen bütçesi için.
 *
 * Döngüsel içe aktarma notu: scenes.ts → districts → scenes.ts. Bu dosya yalnızca `function` bildirimleri dışa aktarır ve
 * içe aktarılan değerleri (Builder, tx, tz…) yalnızca fonksiyon gövdelerinde kullanır (değerlendirme sırası önemsiz).
 */
import { DIR_VEC, tx, tz, type Builder, type Dir, type Group } from "../scenes";
import { sleds } from "../city/furniture";

export const UP = 0, DOWN = Math.PI, RIGHT = Math.PI / 2, LEFT = -Math.PI / 2;

/** Bir sıradaki boşluklar (kapılar) hariç ardışık parçalar: [başlangıç, bitiş] (dahil). */
function runs(from: number, to: number, gaps: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let k = from; k <= to + 1; k++) {
    const open = k <= to && !gaps.includes(k);
    if (open && s < 0) s = k;
    if (!open && s >= 0) { out.push([s, k - 1]); s = -1; }
  }
  return out;
}

/** Dikme konumları (karo sınırları, kesirli karo dizini): parçanın iki ucu ve her `every` karoda bir. */
function postsAt(a: number, c: number, every: number): number[] {
  const out: number[] = [];
  for (let k = a; k <= c; k += every) out.push(k - 0.5);
  out.push(c + 0.5);
  return out;
}

export interface Fence {
  /** gövde rengi */ c: string;
  /** yükseklik */ h: number;
  /** kalınlık */ t?: number;
  g?: Group;
  /** üst kapak rengi (ör. ahşap korkuluk, çit başlığı) */ cap?: string;
  /** dikme rengi ve aralığı (karo) */ post?: string; every?: number;
  /** karoyu engelle (varsayılan evet) */ block?: boolean;
  /** karo kenarına kaydır: -0.5…0.5 (z ya da x yönünde) */ off?: number;
}

/** x boyunca (j sabit) çit/duvar/cam bölme; `gaps` karolarında kapı bırakır. */
export function fenceX(b: Builder, j: number, i0: number, i1: number, gaps: readonly number[], f: Fence): void {
  const t = f.t ?? 0.16, g = f.g ?? "solid", z = tz(j) + (f.off ?? 0);
  for (const [a, c] of runs(i0, i1, gaps)) {
    const x = (tx(a) + tx(c)) / 2, w = c - a + 1;
    b.box(x, f.h / 2, z, w, f.h, t, f.c, g, g === "solid" ? 0.03 : 0);
    if (f.cap) b.box(x, f.h + 0.04, z, w + 0.02, 0.08, t + 0.08, f.cap, "solid", 0.02);
    if (f.post) for (const px of postsAt(a, c, f.every ?? 2)) b.box(tx(px), f.h / 2 + 0.05, z, 0.12, f.h + 0.1, t + 0.06, f.post);
    if (f.block !== false) for (let i = a; i <= c; i++) b.block(i, j);
  }
}

/** z boyunca (i sabit) çit/duvar/cam bölme. */
export function fenceZ(b: Builder, i: number, j0: number, j1: number, gaps: readonly number[], f: Fence): void {
  const t = f.t ?? 0.16, g = f.g ?? "solid", x = tx(i) + (f.off ?? 0);
  for (const [a, c] of runs(j0, j1, gaps)) {
    const z = (tz(a) + tz(c)) / 2, d = c - a + 1;
    b.box(x, f.h / 2, z, t, f.h, d, f.c, g, g === "solid" ? 0.03 : 0);
    if (f.cap) b.box(x, f.h + 0.04, z, t + 0.08, 0.08, d + 0.02, f.cap, "solid", 0.02);
    if (f.post) for (const pz of postsAt(a, c, f.every ?? 2)) b.box(x, f.h / 2 + 0.05, tz(pz), t + 0.06, f.h + 0.1, 0.12, f.post);
    if (f.block !== false) for (let j = a; j <= c; j++) b.block(i, j);
  }
}

/** Zemin altı: bölge başına tek kutu (karo başına ikinci küp yerine). */
export function slab(b: Builder, i0: number, j0: number, w: number, d: number, c: string): void {
  b.box((tx(i0) + tx(i0 + w - 1)) / 2, -1.5, (tz(j0) + tz(j0 + d - 1)) / 2, w, 1, d, c, "solid", 0.04);
}

/** Yere serili ince halı/örtü (engellemez). */
export function rug(b: Builder, i0: number, j0: number, w: number, d: number, c: string, y = 0.012): void {
  b.box((tx(i0) + tx(i0 + w - 1)) / 2, y, (tz(j0) + tz(j0 + d - 1)) / 2, w - 0.12, 0.024, d - 0.12, c, "solid", 0.02);
}

/** Duvara asılı tabela: (i, j) duvar karosunun ön (+z) yüzünde; ekip rengi çerçeve + beyaz levha + "yazı" çubukları. */
export function wallSign(b: Builder, i: number, j: number, color: string, y = 2.25, w = 2.2): void {
  const x = tx(i), z = tz(j) + 0.5;
  b.box(x, y, z + 0.04, w, 0.62, 0.08, color, "solid", 0.02);
  b.box(x, y, z + 0.09, w - 0.24, 0.42, 0.03, "#FFFDF8");
  b.box(x - w / 2 + 0.36, y, z + 0.11, 0.24, 0.24, 0.02, color);
  b.box(x + 0.12, y + 0.06, z + 0.11, w - 1.0, 0.07, 0.02, "#3F3A52");
  b.box(x + 0.02, y - 0.08, z + 0.11, w - 1.2, 0.06, 0.02, "#9A94AE");
}

/** Ayaklı tabela (açık hava): iki direk + pano; pano ön yüzü +z. Karoyu engeller. */
export function postSign(b: Builder, i: number, j: number, color: string, wood = "#7A4E2A"): void {
  const x = tx(i), z = tz(j);
  for (const dx of [-0.42, 0.42]) b.box(x + dx, 0.75, z, 0.1, 1.5, 0.1, wood);
  b.box(x, 1.32, z, 1.2, 0.56, 0.1, color, "solid", 0.02);
  b.box(x, 1.32, z + 0.06, 1.0, 0.36, 0.02, "#FFFDF8");
  b.box(x + 0.08, 1.36, z + 0.075, 0.6, 0.07, 0.01, "#3F3A52");
  b.box(x - 0.36, 1.32, z + 0.075, 0.16, 0.16, 0.01, color);
  b.block(i, j);
}

/** Duvar beyaz tahtası (plan noktası): (i, j) duvar karosunun ön yüzü, `w` karo. */
export function whiteboard(b: Builder, i: number, j: number, w = 2): void {
  const x = tx(i) + (w - 1) / 2, z = tz(j) + 0.55;
  b.box(x, 1.75, z, w * 0.9, 1.05, 0.06, "#F8FAFC");
  b.box(x, 1.2, z + 0.06, w * 0.86, 0.05, 0.1, "#94A3B8");
  [["#3B82F6", 0.55, 2.0], ["#EF4444", 0.4, 1.8], ["#10B981", 0.65, 1.6]].forEach(([c, ww, y]) =>
    b.box(x - w * 0.18 + (ww as number) / 3, y as number, z + 0.04, (ww as number) * w * 0.5, 0.07, 0.02, c as string));
}

/** Kitaplık (okuma noktası): karoyu engeller; raf önü `face` yönüne bakar. */
export function bookshelf(b: Builder, i: number, j: number, wood = "#7B5236", h = 2.2, face: Dir = "+z",
  books: readonly string[] = ["#EF4444", "#3B82F6", "#F59E0B", "#10B981"]): void {
  const [fx, fz] = DIR_VEC[face];
  const alongX = fz !== 0;
  b.box(tx(i), h / 2, tz(j), alongX ? 1 : 0.8, h, alongX ? 0.8 : 1, wood, "solid", 0.04);
  const shelves = h > 1.6 ? [0.5, 1.2, 1.9] : [0.35, 0.85];
  for (const y of shelves) for (let k = 0; k < 4; k++) {
    const o = -0.33 + k * 0.22;
    b.box(tx(i) + (alongX ? o : fx * 0.42), y, tz(j) + (alongX ? fz * 0.42 : o), alongX ? 0.16 : 0.05, 0.4, alongX ? 0.05 : 0.16,
      books[(k + i + j + Math.round(y * 3)) % books.length]);
  }
  b.block(i, j);
}

/** Berjer: oturak `back` tarafının tersine bakar (sırtlık +z'de: oturan −z'ye, kameraya sırtı dönük). Karoyu engeller;
 *  önündeki (j-1) karo dinlenme noktasıdır (World.tsx oturak yüksekliğinden tanır). */
export function armchair(b: Builder, i: number, j: number, c: string, back: string): void {
  b.box(tx(i), 0.27, tz(j), 0.95, 0.54, 0.9, c, "solid", 0.04);
  b.box(tx(i), 0.78, tz(j) + 0.36, 0.95, 0.6, 0.2, back, "solid", 0.04);
  for (const dx of [-0.43, 0.43]) b.box(tx(i) + dx, 0.6, tz(j), 0.1, 0.25, 0.85, back);
  b.block(i, j);
  b.rest.push([i, j - 1]);
}

/** İki karoluk bank (sırtlık +z'de); önündeki iki karo dinlenme noktası. */
export function bench(b: Builder, i: number, j: number, seat = "#B07D48", leg = "#6B7280"): void {
  const x = tx(i) + 0.5, z = tz(j);
  for (const dx of [-0.8, 0.8]) b.box(x + dx, 0.2, z, 0.16, 0.4, 0.5, leg);
  b.box(x, 0.44, z, 2, 0.1, 0.55, seat, "solid", 0.03);
  b.box(x, 0.74, z + 0.26, 2, 0.5, 0.08, seat, "solid", 0.03); // REAL-SUPPORT: sırtlık oturağın üstünden başlar (eskiden 0,09 havada)
  b.block(i, j); b.block(i + 1, j);
  b.rest.push([i, j - 1], [i + 1, j - 1]);
}

/** Kanepe (3 karo) + dinlenme noktaları. */
export function couch(b: Builder, i: number, j: number, c: string, back: string): void {
  b.sofa(i, j, c, back);
  b.rest.push([i, j - 1], [i + 1, j - 1], [i + 2, j - 1]);
}

/** Küçük yuvarlak kafe masası (tek karo, engeller) + iki tabure. */
export function cafeTable(b: Builder, i: number, j: number, top: string, stool: string, leg = "#3F3F46"): void {
  const x = tx(i), z = tz(j);
  b.box(x, 0.36, z, 0.12, 0.72, 0.12, leg);
  b.box(x, 0.74, z, 0.85, 0.06, 0.85, top, "solid", 0.03);
  b.box(x + 0.2, 0.82, z - 0.1, 0.12, 0.12, 0.12, "#F8FAFC");
  for (const dx of [-0.62, 0.62]) { b.box(x + dx, 0.22, z, 0.3, 0.44, 0.3, stool, "solid", 0.04); }
  b.block(i, j);
}

/** Uzun tezgâh (x boyunca i0…i1, j): gövde + tezgâh üstü; engeller. */
export function counter(b: Builder, i0: number, i1: number, j: number, body: string, top: string): void {
  const x = (tx(i0) + tx(i1)) / 2, w = i1 - i0 + 1;
  b.box(x, 0.45, tz(j), w, 0.9, 0.8, body, "solid", 0.03);
  b.box(x, 0.93, tz(j), w + 0.04, 0.06, 0.88, top, "solid", 0.02);
  for (let i = i0; i <= i1; i++) b.block(i, j);
}

/** Buzdolabı / dolap (tek karo, uzun). */
export function fridge(b: Builder, i: number, j: number, c = "#E7E5E4"): void {
  b.box(tx(i), 1.05, tz(j), 0.9, 2.1, 0.8, c, "solid", 0.02);
  b.box(tx(i) - 0.32, 1.3, tz(j) + 0.41, 0.05, 0.5, 0.03, "#94A3B8");
  b.block(i, j);
}

/** Telefon kabini: arka + yan cam, açık ön (+z); içindeki karo web noktası (ajan arka duvara, −z'ye bakar). */
export function booth(b: Builder, i: number, j: number, frame = "#334155"): void {
  const x = tx(i), z = tz(j);
  b.box(x, 1.1, z - 0.46, 0.96, 2.2, 0.06, "#CFEFFF", "glass");
  for (const dx of [-0.46, 0.46]) b.box(x + dx, 1.1, z, 0.06, 2.2, 0.96, "#CFEFFF", "glass");
  b.box(x, 2.24, z, 1.0, 0.08, 1.0, frame);
  b.box(x, 1.2, z - 0.4, 0.4, 0.28, 0.04, "#1F2937");
  b.box(x, 1.2, z - 0.37, 0.32, 0.2, 0.02, "#7DD3FC", "glow");
  b.spot("web", i, j, DOWN);
}

/** Toplantı odası: (i0, j0)–(i1, j1) dikdörtgeninin kenarlarında cam duvar (ön duvarda `door` karosunda kapı), ortada uzun
 *  masa, iki yanında sandalyeler; arka duvarda beyaz tahta (plan noktaları). `back`: arka kenar zaten duvarsa cam çizilmez. */
export function meetingRoom(b: Builder, i0: number, j0: number, i1: number, j1: number, door: number,
  o: { table: string; chair: string; frame?: string; back?: boolean; floor?: string }): void {
  const glass: Fence = { c: "#CFEFFF", h: 2.1, t: 0.08, g: "glass" };
  const frame = o.frame ?? "#475569";
  if (o.back !== false) fenceX(b, j0, i0, i1, [], glass);
  fenceX(b, j1, i0, i1, [door], glass);
  fenceZ(b, i0, j0 + (o.back !== false ? 1 : 0), j1 - 1, [], glass);
  fenceZ(b, i1, j0 + (o.back !== false ? 1 : 0), j1 - 1, [], glass);
  // çerçeve (üst kiriş): ön ve yanlar
  b.box((tx(i0) + tx(i1)) / 2, 2.18, tz(j1), i1 - i0 + 1, 0.08, 0.14, frame);
  for (const i of [i0, i1]) b.box(tx(i), 2.18, (tz(j0) + tz(j1)) / 2, 0.14, 0.08, j1 - j0 + 1, frame);
  if (o.floor) rug(b, i0 + 1, j0 + 1, i1 - i0 - 1, j1 - j0 - 1, o.floor);
  // masa: odanın ortasında, x boyunca
  const ti0 = i0 + 2, ti1 = i1 - 2, tj = Math.floor((j0 + j1) / 2) + (o.back === false ? 0 : 0);
  if (ti1 >= ti0) {
    const x = (tx(ti0) + tx(ti1)) / 2, w = ti1 - ti0 + 1;
    b.box(x, 0.72, tz(tj), w, 0.08, 0.9, o.table, "solid", 0.03);
    for (const dx of [-w / 2 + 0.15, w / 2 - 0.15]) b.box(x + dx, 0.35, tz(tj), 0.1, 0.7, 0.6, "#4B5563");
    for (let i = ti0; i <= ti1; i++) {
      b.block(i, tj);
      for (const dz of [-0.62, 0.62]) {
        b.box(tx(i), 0.27, tz(tj) + dz, 0.48, 0.07, 0.42, o.chair, "solid", 0.03);
        sleds(b.box.bind(b), tx(i), tz(tj) + dz, 0.48, 0.42, 0.235, "x"); // CORE-WALK: sandalye yere basar
        b.box(tx(i), 0.5, tz(tj) + dz * 1.32, 0.48, 0.4, 0.06, o.chair, "solid", 0.03);
      }
      if ((i - ti0) % 2 === 0) b.box(tx(i), 0.8, tz(tj), 0.3, 0.06, 0.2, "#CBD5E1");
    }
  }
  // beyaz tahta: odanın arka iç yüzünde, tahta önündeki karolar plan noktası
  const wb = Math.floor((i0 + i1) / 2);
  // REAL-SUPPORT: arka cam bölmeye yaslanır (eskiden 0,35 önünde havada); `back:false`te duvarın kendi ön yüzü (z + 0,42)
  const zb = tz(j0) + (o.back !== false ? 0.07 : 0.42);
  b.box(tx(wb) + 0.5, 1.55, zb, 1.8, 0.9, 0.05, "#F8FAFC");
  b.box(tx(wb) + 0.1, 1.7, zb + 0.04, 0.7, 0.06, 0.02, "#3B82F6");
  b.box(tx(wb) + 0.7, 1.5, zb + 0.04, 0.6, 0.06, 0.02, "#10B981");
  b.spot("plan", wb, j0 + 1, DOWN); b.spot("plan", wb + 1, j0 + 1, DOWN);
}

/** Saksı kutusu (alçak, kenar süsü): engeller. */
export function planter(b: Builder, i: number, j: number, box = "#9CA3AF", green = "#2F855A"): void {
  b.box(tx(i), 0.22, tz(j), 0.9, 0.44, 0.9, box, "solid", 0.03);
  b.box(tx(i), 0.55, tz(j), 0.8, 0.3, 0.8, green, "solid", 0.12);
  b.block(i, j);
}

/** Çiçek tarhı (engellemez, yerde): `w`×`d` karo; renkler sırayla. */
export function flowerBed(b: Builder, i0: number, j0: number, w: number, d: number, colors: readonly string[], soil = "#6B4226"): void {
  for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + d; j++) {
    b.box(tx(i), 0.06, tz(j), 0.9, 0.12, 0.9, soil, "solid", 0.05);
    for (const [dx, dz] of [[-0.22, -0.2], [0.2, 0.18]]) {
      b.box(tx(i) + dx, 0.2, tz(j) + dz, 0.06, 0.18, 0.06, "#2F855A");
      b.box(tx(i) + dx, 0.32, tz(j) + dz, 0.2, 0.12, 0.2, colors[(i * 3 + j + (dx > 0 ? 1 : 0)) % colors.length]);
    }
    b.block(i, j);
  }
}

/** Şemsiyeli masa: direk + iki kat şemsiye; masa karosunu engeller. */
export function parasolTable(b: Builder, i: number, j: number, c: string, stripe = "#FFFFFF", top = "#F8FAFC"): void {
  const x = tx(i), z = tz(j);
  b.box(x, 0.36, z, 0.12, 0.72, 0.12, "#6B7280");
  b.box(x, 0.74, z, 0.95, 0.06, 0.95, top, "solid", 0.02);
  for (const dx of [-0.7, 0.7]) b.box(x + dx, 0.23, z, 0.32, 0.46, 0.32, c, "solid", 0.03);
  b.box(x, 1.55, z, 0.06, 1.5, 0.06, "#E5E7EB");
  b.box(x, 2.3, z, 1.9, 0.12, 1.9, c, "solid", 0.02);
  b.box(x, 2.42, z, 1.2, 0.12, 1.2, stripe);
  b.block(i, j);
}

/** Kahve noktası: kahve makinesi (S33 canlı dekor: mola yeri) + yanında fincan rafı. Ön karo `face` yönünde. */
export function coffeePoint(b: Builder, i: number, j: number, face: Dir = "+z"): void {
  b.coffeeMachine(i, j, face);
}

/** S41 — serpiştirilmiş küçük dekor (çiçek, taş, mantar, deniz kabuğu…): bölgenin boş karolarına belirlenimci olarak
 *  `n` adet; engellemez. `pick(k)` her öğeyi çizer: (x, z, k). Koridor/kapı karolarını kapatmaz (yürünebilir kalır). */
export function scatter(b: Builder, i0: number, j0: number, n: number, seed: number, draw: (x: number, z: number, k: number) => void,
  skip?: (li: number, lj: number) => boolean): void {
  for (let k = 0, placed = 0; k < n * 4 && placed < n; k++) {
    const li = 1 + ((k * 7 + seed * 3) % 11), lj = 1 + ((k * 5 + seed * 11 + Math.floor(k / 11)) % 15);
    if (skip?.(li, lj) || b.blocked.has(`${i0 + li},${j0 + lj}`)) continue;
    const ox = (((k * 37 + seed) % 7) - 3) * 0.1, oz = (((k * 53 + seed) % 7) - 3) * 0.1;
    draw(tx(i0 + li) + ox, tz(j0 + lj) + oz, placed++);
  }
}

/**
 * REAL-SEAT — TABAN sahnede dinlenme karosu ZEMİNDE olsun (`districts/city.ts` `settleRest` ile aynı fikir, ızgara sınırı olmadan):
 * ajan dinlenmede y = 0'da çöker (`Crowd.tsx` "slump"); bank/puf/minder/kütük üstündeki ya da engelli karodaki dinlenme noktası en
 * yakın temiz zemin karosuna (≤ `reach`) taşınır, yoksa düşer. Sahne kurucusu `done()` öncesi çağırır. Saf, belirlenimci.
 */
export function settleBaseRest(b: Builder, reach = 3): void {
  const FLOOR = new Set(["solid", "glass", "water", "spin"]);
  const clear = (px: number, pz: number, r: number): boolean => {
    for (const q of b.blocks) {
      if (!FLOOR.has(q.g)) continue;
      const top = q.p[1] + q.s[1] / 2;
      if (top <= 0.08 || top > 1.2 || q.p[1] - q.s[1] / 2 > 1.2) continue;
      if (Math.abs(px - q.p[0]) < q.s[0] / 2 + r && Math.abs(pz - q.p[2]) < q.s[2] / 2 + r) return false;
    }
    return true;
  };
  const key = (i: number, j: number) => `${i},${j}`;
  const used = new Set<string>([...b.stations.map((s) => key(...s.tile)), ...Object.values(b.spots).flatMap((l) => (l ?? []).map((s) => key(...s.tile))), ...b.rest.map((t) => key(...t))]);
  const out: [number, number][] = [];
  for (const [i, j] of b.rest) {
    if (!b.blocked.has(key(i, j)) && clear(tx(i), tz(j), 0.02)) { out.push([i, j]); continue; }
    let best: [number, number] | null = null, bc = Infinity;
    for (let di = -reach; di <= reach; di++) for (let dj = -reach; dj <= reach; dj++) {
      const ni = i + di, nj = j + dj, cost = Math.abs(di) + Math.abs(dj);
      if ((!di && !dj) || ni < 0 || nj < 0 || ni >= b.w || nj >= b.d || used.has(key(ni, nj)) || b.blocked.has(key(ni, nj)) || cost >= bc || !clear(tx(ni), tz(nj), 0.3)) continue;
      best = [ni, nj]; bc = cost;
    }
    if (best) { used.add(key(...best)); out.push(best); }
  }
  b.rest.length = 0;
  b.rest.push(...out);
}

/** S46 — yerel karo bir ajan çapası mı (istasyon, araç/uyku noktası, mola)? Serpiştirilmiş dekor bu karolara konmaz. */
export function anchorAt(b: Builder, i: number, j: number): boolean {
  const at = (t: readonly number[]) => t[0] === i && t[1] === j;
  return b.stations.some((s) => at(s.tile)) || b.rest.some(at) || Object.values(b.spots).some((l) => l?.some((s) => at(s.tile)))
    || b.props.some((p) => !!p.tile && at(p.tile));
}

/** S45 — akvaryum (iç mekân canlı ortamı, `AQUA-PREF-001`): dolap + cam tank (çakıl, su bitkisi, kapakta ışık şeridi) ve
 *  `aquarium` kancası — balıkları S43 canlı ortamı tankın içinde yüzdürür (yükseklik ≈ tank üstünün %55'i). Karoyu engeller. */
export function aquarium(b: Builder, i: number, j: number, cabinet = "#5B4636", glow = "#BAE6FD"): void {
  const x = tx(i), z = tz(j);
  b.box(x, 0.3, z, 0.86, 0.6, 0.7, cabinet, "solid", 0.03);
  b.box(x, 0.64, z, 0.8, 0.08, 0.64, "#C8B79A", "solid", 0.06);
  b.box(x, 1.02, z, 0.84, 0.76, 0.68, "#9EDCF5", "glass");
  b.box(x - 0.24, 0.84, z - 0.12, 0.08, 0.34, 0.08, "#2F855A", "solid", 0.1);
  b.box(x + 0.22, 0.8, z + 0.1, 0.08, 0.26, 0.08, "#38A169", "solid", 0.1);
  b.box(x, 1.43, z, 0.88, 0.06, 0.72, "#334155");
  b.box(x, 1.4, z + 0.37, 0.7, 0.03, 0.02, glow, "glow");
  b.block(i, j);
  b.hook("aquarium", i, j);
}
