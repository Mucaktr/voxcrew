/**
 * Londra şehir stili, ortak dekor ve simge yapılar (RB-LON; "Kullanıcı kararı — 2026-10-18").
 * Kırmızı-kahve tuğla teraslı evler (beyaz pencere çerçeveleri, renkli kapılar, baca yığınları), arduvaz gri çatılar, koyu
 * yeşil pub cephesi ve asma çiçek sepetleri, döküm siyah sokak eşyası, gri-yeşil nehir.
 *
 * Simgeler (sahnenin ortasında, ızgarada; ilk bakışta "andıran" stilize voxel yorum, birebir kopya değil):
 * - `clockTower`: altın kumtaşı kare Gotik saat kulesi, dört yüzde büyük soyut kadran (rakam/yazı yok), çan katı, sivri
 * arduvaz külah. Gece kadranlar sabit, yumuşak parlar (`window` işareti; desen/animasyon yok).
 * - `parliament`: nehir boyunca uzun Gotik kumtaşı yapı: payanda + sivri pinakl sırası, köşk kuleleri, orta fener kulesi,
 * bir uçta büyük kare kule (bayrak direği ve bayrak YOK). Saray/meclis arması, yazı yok.
 * - `towerBridge`: iki Gotik taş kule (köşe kuleleri, piramit külah), üstte iki yaya geçidi, mavi-beyaz asma zincirli yan
 * açıklıklar; güverte yürünebilir, otobüs kule kemerinin altından geçer.
 * - `obsWheel`: genel klasik gözlem çarkı — iki paralel beyaz jant, jantlar arasında sarkan açık kabinler, iki yanda
 * simetrik A ayak; `spin` grubunda yavaş döner (kabinler dik), binilir (transit/wheel.ts). Marka/renk düzeni, ad ve gece
 * ışık gösterisi yok.
 * - `infoKiosk`: özgün sokak bilgi köşkü (koyu yeşil ince gövde, tek cam harita panosu, düz saçak); kabin, kubbe, taç, yazı YOK
 * (FREE-MAP-IP: korunan kırmızı kabin biçimi kullanılmaz).
 * Logo, tabela yazısı, bayrak, kraliyet arması, ulaşım yuvarlak simgesi, gerçek kişi yok. Tabelalar
 * `pixelIcon` piktogramıdır (bardak, yatak, kitap). İbadet yapısı (kilise / manastır silüeti) bu sahnede YOK.
 * Taban sahne `scenes/londra.ts`, büyüme teması `districts/londra.ts` bu dosyayı kullanır.
 * Döngüsel içe aktarma: scenes.ts'ten yalnız fonksiyon gövdelerinde kullanılan değerler + tipler (kit.ts gibi).
*/
import { pixelIcon } from "../../buildings";
import { key, tx, tz, type Builder, type Spin } from "../../scenes";
import { cabinAngle, CABIN_D, CABIN_DROP, CABIN_H, CABIN_W, wheelSpan, type WheelSpec } from "../../transit/wheel";
import { rowHouse, type HouseOpts } from "../kit";
import type { CityStyle } from "../style";

export const LONDRA_STYLE: CityStyle = {
  id: "londra",
  ground: {
    street: ["#5A5E66", "#53575F"],
    sidewalk: ["#B9B6AE", "#AEABA3"],
    plaza: ["#C9BFAE", "#BFB5A3"],
    grass: ["#5FA046", "#579641"],
    quay: ["#A39E94", "#979288"],
    under: "#5E5348",
  },
  water: "#557D86",
  facade: "row",
  walls: ["#A9543E", "#B8664A", "#9C4A36", "#C9A877"],
  trim: "#F2EEE4",
  roof: "tile",
  roofColor: "#58626D",
  window: "#3E5266",
  windowLit: "#FFD98A",
  door: "#1F3A5F",
  tree: "plane",
  lamp: { post: "#22282E", glow: "#FFDDA0" },
  awnings: ["#2E5E4E", "#8C2F39", "#1F3A5F", "#C9962E"],
  far: ["#8E9AA8", "#99A4B1", "#848F9D"],
};

/** Kapı, yorgan, kitap ve şemsiye renkleri (özgün palet). */
export const LONDRA_DOORS = ["#1F3A5F", "#8C2F39", "#2E5E4E", "#C9962E", "#3B3B3B"] as const;
export const LONDRA_QUILTS = ["#8C2F39", "#1F3A5F", "#C9962E", "#2E5E4E", "#E8DFC8"] as const;
export const LONDRA_BOOKS = ["#8C2F39", "#1F3A5F", "#C9962E", "#2E5E4E", "#6B4E8C"] as const;
export const LONDRA_BRELLAS = [["#1F3A5F", "#F2EEE4"], ["#2E5E4E", "#F2EEE4"], ["#8C2F39", "#F2EEE4"]] as const;

const IRON = "#22282E", PUB_GREEN = "#2E4A3A", OAK = "#7A5534", BRICK_DARK = "#7E3E2E", POT = "#C27A4E", SLATE = "#4C5560";
const BED_ICON = ["#....", "#.##.", "#####", "#...#"];
const MUG_ICON = ["#####.", "#####.", "######", "#####.", "#####."];
const BOOK_ICON = [".#.#.", "##.##", "##.##", "##.##", "#####"];

/** Baca yığını + çömlekler (görsel; çatıda). */
export function chimney(b: Builder, x: number, y: number, z: number, pots = 3): void {
  b.box(x, y + 0.35, z, 0.22 * pots + 0.16, 0.7, 0.36, BRICK_DARK, "solid", 0.04);
  b.box(x, y + 0.72, z, 0.22 * pots + 0.22, 0.06, 0.42, "#D8D2C4");
  for (let k = 0; k < pots; k++) b.box(x - (pots - 1) * 0.11 + k * 0.22, y + 0.84, z, 0.12, 0.18, 0.12, POT);
}

/** Teraslı ev sırası: `rowHouse` (tuğla cephe, beyaz çerçeveli pencereler, arduvaz beşik çatı) + her 2 karoda bir baca
 *  yığını + renkli kapılar ve kapı üstü yelpaze pencere. */
export function terraceRow(b: Builder, s: CityStyle, i0: number, j0: number, w: number, d: number, o: HouseOpts): void {
  rowHouse(b, s, i0, j0, w, d, o);
  const H = 1.6, top = o.floors * H, front = tz(j0 + d - 1) + 0.5, z = (tz(j0) + tz(j0 + d - 1)) / 2;
  // CITY-PASS-LON (REAL-FACADE): arka ve yan yüzlerde de her katta sürgülü pencere + beyaz söve (Londra teraslı evleri arka
  // bahçeye ve ara sokağa da pencereli bakar); ön yüz rowHouse'tan
  const back = tz(j0) - 0.5, left = tx(i0) - 0.5, right = tx(i0 + w - 1) + 0.5;
  for (let f = 0; f < o.floors; f++) {
    const wy = f * H + H * 0.55, wh = H * 0.5;
    for (let k = 0; k < w; k++) {
      b.box(tx(i0 + k), wy, back - 0.02, 0.44, wh, 0.05, s.window);
      b.box(tx(i0 + k), wy - wh / 2 - 0.04, back - 0.04, 0.52, 0.06, 0.08, s.trim);
    }
    for (let q = 0; q < d; q++) for (const [sx, xx] of [[-1, left], [1, right]] as const) {
      b.box(xx + sx * 0.02, wy, tz(j0 + q), 0.05, wh, 0.44, s.window);
      b.box(xx + sx * 0.04, wy - wh / 2 - 0.04, tz(j0 + q), 0.08, 0.06, 0.52, s.trim);
    }
  }
  for (let k = 0; k < w; k += 2) chimney(b, tx(i0 + k) + (w - k > 1 ? 0.5 : 0), top + 0.6, z - 0.15, 2 + ((i0 + k) % 2));
  // kapı rengi ve yelpaze pencere (rowHouse kapısının önüne ince kat)
  const dk = o.door ?? Math.floor(w / 2);
  if (!o.shop) {
    b.box(tx(i0 + dk), 0.6, front + 0.05, 0.46, 1.1, 0.02, LONDRA_DOORS[(i0 + j0) % LONDRA_DOORS.length]);
    b.box(tx(i0 + dk), 1.28, front + 0.05, 0.42, 0.16, 0.02, "#FFE7B0");
    b.box(tx(i0 + dk), 0.06, front + 0.2, 0.7, 0.12, 0.3, "#D8D2C4");
  }
}

/** Pub cephesi süsleri: koyu yeşil ahşap kaplama + altın şerit, asma çiçek sepetleri, yazısız piktogram tabela (bardak).
 *  `rowHouse` sonrası çağrılır; (i0…i0+w−1) ön yüz. */
export function pubFront(b: Builder, i0: number, w: number, j: number): void {
  const x = (tx(i0) + tx(i0 + w - 1)) / 2, front = tz(j) + 0.5;
  b.box(x, 0.65, front + 0.04, w + 0.04, 1.3, 0.06, PUB_GREEN, "solid", 0.02);
  b.box(x, 1.36, front + 0.06, w + 0.08, 0.16, 0.1, "#C9A44C");
  for (let k = 0; k < w; k++) {
    const wx = tx(i0 + k);
    if (k === Math.floor(w / 2)) { b.box(wx, 0.6, front + 0.09, 0.5, 1.15, 0.03, "#4A2E1E"); continue; }
    b.box(wx, 0.75, front + 0.08, 0.7, 0.7, 0.03, "#E8B76A", "glass");
    b.props.push({ k: "window", p: [wx, 0.75, front + 0.1], r: 0, s: [0.66, 0.66], c: "#FFC86B" });
  }
  for (const k of [0, w - 1]) {
    const bx = tx(i0 + k) + (k ? 0.35 : -0.35);
    b.box(bx, 2.15, front + 0.25, 0.04, 0.3, 0.04, IRON);
    b.box(bx, 1.92, front + 0.25, 0.42, 0.24, 0.42, "#6B4A2E", "solid", 0.05);
    for (const [dx, c] of [[-0.14, "#E5484D"], [0.02, "#F2EEE4"], [0.16, "#A78BFA"]] as const) b.box(bx + dx, 1.84, front + 0.38, 0.14, 0.14, 0.14, c);
    b.box(bx, 1.78, front + 0.25, 0.46, 0.12, 0.46, "#3E8E3E", "solid", 0.12);
  }
  // asma tabela (yazısız): demir kol + tahta pano + bardak piktogramı
  const sx = tx(i0) - 0.1;
  b.box(sx + 0.3, 2.5, front + 0.3, 0.6, 0.05, 0.05, IRON);
  b.box(sx + 0.5, 2.15, front + 0.3, 0.06, 0.6, 0.5, "#6B4A2E", "solid", 0.02);
  pixelIcon(b, MUG_ICON, sx + 0.54, 2.15, front + 0.3, "#E8C07A", 0.07);
}

/** Pub bahçe masası (engeller): kalın meşe tabla, çapraz ayaklar, iki yanında bağlı bank (istasyon karoları j−1 / j+1,
 *  masaya bakar, dizüstü). Bankların yerinde canlı dekor sandalyesi çizilmez (`chair` işareti). */
export function pubTable(b: Builder, i: number, j: number): void {
  const x = tx(i), z = tz(j);
  b.box(x, 0.74, z, 0.9, 0.08, 0.72, OAK, "solid", 0.04);
  for (const dx of [-0.34, 0.34]) b.box(x + dx, 0.36, z, 0.1, 0.72, 0.5, "#5E3E24");
  b.box(x + 0.25, 0.86, z - 0.12, 0.12, 0.18, 0.12, "#E8B76A", "glass");
  b.box(x - 0.25, 0.86, z + 0.12, 0.12, 0.18, 0.12, "#E8B76A", "glass");
  b.laptop(x - 0.1, 0.78, z - 0.14, "-z");
  b.laptop(x + 0.1, 0.78, z + 0.14, "+z");
  b.block(i, j);
  for (const [dj, face] of [[-1, 0], [1, Math.PI]] as const) {
    const bz = tz(j + dj) + (dj < 0 ? 0.12 : -0.12);
    b.box(x, 0.43, bz, 0.9, 0.07, 0.34, OAK, "solid", 0.04);
    for (const dx of [-0.34, 0.34]) b.box(x + dx, 0.2, bz, 0.08, 0.4, 0.28, "#5E3E24");
    b.station(i, j + dj, face, "sit_chair", "laptop");
    b.props.push({ k: "chair", p: [x, 0, tz(j + dj)], r: face });
  }
}

/** Fıçı saksı (engeller): tahta fıçı + çiçek. */
export function barrelPlanter(b: Builder, i: number, j: number, flower = "#E5484D"): void {
  const x = tx(i), z = tz(j);
  b.box(x, 0.3, z, 0.66, 0.6, 0.66, "#7A5534", "solid", 0.04);
  for (const y of [0.14, 0.46]) b.box(x, y, z, 0.7, 0.05, 0.7, IRON);
  b.box(x, 0.68, z, 0.6, 0.2, 0.6, "#3E8E3E", "solid", 0.12);
  b.box(x + 0.12, 0.8, z + 0.1, 0.16, 0.12, 0.16, flower);
  b.block(i, j);
}

/** A tahta (yazısız tebeşir çizgileri; plan noktası önünde). */
export function aBoard(b: Builder, i: number, j: number): void {
  const x = tx(i), z = tz(j);
  b.box(x, 0.55, z, 0.68, 1.0, 0.1, "#26302B", "solid", 0.02);
  b.box(x, 0.55, z, 0.76, 1.08, 0.06, "#6B4A2E");
  for (const [dy, w] of [[0.8, 0.42], [0.64, 0.28], [0.48, 0.38], [0.32, 0.22]] as const) b.box(x - 0.03, dy, z + 0.06, w, 0.03, 0.01, "#E8E4DA");
  b.block(i, j);
}

/** Kitapçı vitrini (ön yüz süsü, `rowHouse` + shop sonrası): cumba vitrin, raf sıraları, kitap piktogramı. */
export function bookshopFront(b: Builder, i0: number, w: number, j: number): void {
  const x = (tx(i0) + tx(i0 + w - 1)) / 2, front = tz(j) + 0.5;
  b.box(x, 0.12, front + 0.2, w - 0.6, 0.24, 0.36, "#2E3A4A", "solid", 0.02);
  b.box(x, 0.72, front + 0.2, w - 0.7, 0.96, 0.3, "#BFE3F5", "glass");
  for (const y of [0.42, 0.72, 1.02]) LONDRA_BOOKS.forEach((c, k) => {
    for (let r = 0; r < Math.floor(w / 2); r++) b.box(x - w / 2 + 0.7 + r * 1.4 + k * 0.16, y, front + 0.12, 0.12, 0.22, 0.14, c);
  });
  b.box(x, 1.25, front + 0.22, w - 0.5, 0.1, 0.42, "#2E3A4A");
  pixelIcon(b, BOOK_ICON, x, 1.6, front + 0.08, "#F2EEE4", 0.08);
}

/** Okuma masası (kitapçı önü, engeller): küçük meşe masa, kitap yığını, dizüstü (kullanıcı `user` tarafında). */
export function readingDesk(b: Builder, i: number, j: number, user: "-z" | "+z"): void {
  const x = tx(i), z = tz(j);
  b.box(x, 0.72, z, 0.86, 0.07, 0.6, OAK, "solid", 0.03);
  for (const dx of [-0.36, 0.36]) for (const dz of [-0.24, 0.24]) b.box(x + dx, 0.36, z + dz, 0.06, 0.72, 0.06, "#5E3E24");
  LONDRA_BOOKS.slice(0, 3).forEach((c, k) => b.box(x + 0.3, 0.8 + k * 0.07, z + (user === "-z" ? 0.12 : -0.12), 0.24, 0.06, 0.18, c));
  b.box(x - 0.3, 0.86, z, 0.04, 0.24, 0.04, IRON);
  b.box(x - 0.3, 1.0, z, 0.18, 0.08, 0.14, "#2E5E4E");
  b.box(x - 0.3, 0.95, z, 0.12, 0.04, 0.1, "#FFE3A8", "glow");
  b.laptop(x - 0.02, 0.76, z + (user === "-z" ? -0.1 : 0.1), user);
  b.block(i, j);
}

/** Kitap arabası (okuma noktası önünde; engeller). */
export function bookTrolley(b: Builder, i: number, j: number): void {
  const x = tx(i), z = tz(j);
  b.box(x, 0.55, z, 0.86, 0.6, 0.5, "#2E3A4A", "solid", 0.03);
  LONDRA_BOOKS.forEach((c, k) => b.box(x - 0.32 + k * 0.16, 0.95, z, 0.12, 0.22, 0.36, c));
  for (const dx of [-0.34, 0.34]) b.box(x + dx, 0.12, z, 0.16, 0.16, 0.16, IRON);
  b.block(i, j);
}

/** B&B / teraslı ev odaları: `j` satırında i0…i1 açık önlü odalar, her birinde yatak + uyku noktası (baş −z, arka duvara).
 *  Tuğla arka duvar, ara bölmeler, beyaz kuşak, arduvaz çatı + çatı pencereleri (gece yanar), bacalar, yatak piktogramı. */
export function roomRow(b: Builder, s: CityStyle, i0: number, i1: number, j: number, quilts: readonly string[], k0 = 0, wall?: string, H = 1.6): void {
  const x = (tx(i0) + tx(i1)) / 2, w = i1 - i0 + 1, z = tz(j), wc = wall ?? s.walls[(i0 + j) % s.walls.length];
  b.box(x, H / 2, z - 0.46, w, H, 0.08, wc, "solid", 0.03);
  for (let i = i0; i <= i1 + 1; i++) b.box(tx(i) - 0.5, H / 2, z - 0.05, 0.08, H, 0.86, wc, "solid", 0.03);
  b.box(x, H + 0.06, z, w + 0.16, 0.12, 1.1, s.trim);
  // yalın çatı yalnız arka yarıda (kamera yatakları görür), önde ince saçak kuşağı
  b.box(x, H + 0.32, z - 0.3, w + 0.1, 0.4, 0.5, SLATE, "solid", 0.03);
  b.box(x, H + 0.6, z - 0.36, w - 0.3, 0.26, 0.34, s.roofColor, "solid", 0.03);
  for (let i = i0; i <= i1; i++) {
    const ix = tx(i);
    b.box(ix, H + 0.45, z - 0.02, 0.4, 0.4, 0.14, s.trim);
    b.box(ix, H + 0.45, z + 0.06, 0.26, 0.28, 0.03, s.window);
    b.props.push({ k: "window", p: [ix, H + 0.45, z + 0.09], r: 0, s: [0.24, 0.26], c: s.windowLit });
    b.bed(i, j, quilts[(k0 + i) % quilts.length], "#6B4A2E");
    b.sleep(i, j, Math.PI, "bed", 0.5);
  }
  for (const cx of [x - w / 2 + 0.7, x + w / 2 - 0.7]) chimney(b, cx, H + 0.5, z - 0.25, 2);
  pixelIcon(b, BED_ICON, x, H + 0.06, z + 0.56, IRON, 0.1);
}

/** Park şemsiyeli masası (engeller): küçük park şemsiyesi + yuvarlak masa + iki küçük sandalye (dekor). */
export function brollyTable(b: Builder, i: number, j: number, k: number): void {
  const [c1, c2] = LONDRA_BRELLAS[k % LONDRA_BRELLAS.length], x = tx(i), z = tz(j);
  // şirin park şemsiyesi (plaj şemsiyesinden küçük): direk, iki kademeli kubbe, uçta topuz; altında küçük yuvarlak masa
  b.box(x, 1.0, z, 0.07, 2.0, 0.07, "#E5E7EB");
  b.box(x, 1.9, z, 1.6, 0.12, 1.6, c1, "solid", 0.02);
  b.box(x, 2.02, z, 1.1, 0.12, 1.1, c2);
  b.box(x, 2.13, z, 0.6, 0.1, 0.6, c1);
  b.box(x, 2.24, z, 0.1, 0.12, 0.1, "#C9A44C");
  b.box(x, 0.42, z, 0.6, 0.05, 0.6, "#F2EEE4");
  b.box(x, 0.2, z, 0.08, 0.4, 0.08, IRON);
  b.box(x - 0.14, 0.52, z + 0.1, 0.1, 0.14, 0.1, "#F8FAFC");
  b.block(i, j);
  for (const dx of [-0.42, 0.42]) {
    b.box(tx(i) + dx, 0.22, tz(j), 0.24, 0.05, 0.24, "#2E5E4E");
    b.box(tx(i) + dx * 1.1, 0.38, tz(j), 0.04, 0.32, 0.24, "#2E5E4E");
    // CITY-PASS-LON: dört ince ayak (sandalye yere basar; eskiden oturak 0,2 havadaydı)
    for (const lx of [-0.09, 0.09]) for (const lz of [-0.09, 0.09]) b.box(tx(i) + dx + lx, 0.1, tz(j) + lz, 0.03, 0.2, 0.03, "#22282E");
  }
}

/** Park çalgı köşkü (3×3, i0…i0+2 × j0…j0+2; ayak izi engelli): taş kaide, ince döküm direkler, kademeli yeşil-beyaz
 *  çatı ve tepe süsü. Genel Viktorya tarzı park köşkü; belirli bir yapının birebiri değil. */
export function bandstand(b: Builder, i0: number, j0: number): void {
  const x = tx(i0 + 1), z = tz(j0 + 1);
  b.box(x, 0.2, z, 2.7, 0.4, 2.2, "#CFC6B6", "solid", 0.03);
  b.box(x, 0.2, z, 2.2, 0.4, 2.7, "#CFC6B6", "solid", 0.03);
  b.box(x, 0.42, z, 2.4, 0.04, 2.4, "#8B6A47");
  for (const [dx, dz] of [[-1.1, -0.5], [-1.1, 0.5], [1.1, -0.5], [1.1, 0.5], [-0.5, -1.1], [0.5, -1.1], [-0.5, 1.1], [0.5, 1.1]]) {
    b.box(x + dx, 1.4, z + dz, 0.08, 2.0, 0.08, "#2E5E4E");
  }
  for (const [w, d] of [[2.6, 0.08], [0.08, 2.6]]) for (const s of [-1, 1]) {
    b.box(x + (d > 1 ? s * 1.15 : 0), 0.7, z + (w > 1 ? s * 1.15 : 0), w > 1 ? 2.2 : 0.06, 0.06, d > 1 ? 2.2 : 0.06, "#F2EEE4");
  }
  [[3.0, 2.5, 0], [2.4, 2.1, 1], [1.6, 1.4, 2], [0.8, 0.7, 3]].forEach(([a, c, k]) => {
    b.box(x, 2.45 + k * 0.24, z, a, 0.26, c, k % 2 ? "#F2EEE4" : "#2E5E4E", "solid", 0.02);
    b.box(x, 2.45 + k * 0.24, z, c, 0.26, a, k % 2 ? "#F2EEE4" : "#2E5E4E", "solid", 0.02);
  });
  b.box(x, 3.5, z, 0.1, 0.4, 0.1, "#C9A44C");
  b.box(x, 3.72, z, 0.18, 0.12, 0.18, "#C9A44C");
  // nota sehpaları (kaide üstü)
  for (const dx of [-0.5, 0.5]) { b.box(x + dx, 0.75, z, 0.04, 0.6, 0.04, IRON); b.box(x + dx, 1.06, z, 0.34, 0.24, 0.03, "#F2EEE4"); }
  for (let i = i0; i < i0 + 3; i++) for (let j = j0; j < j0 + 3; j++) b.block(i, j);
}

/** Ördek göleti kenarı sazlıkları (engellemez; dekor). */
export function reeds(b: Builder, x: number, z: number, k: number): void {
  for (let r = 0; r < 3; r++) b.box(x + (r - 1) * 0.12, 0.25 + ((k + r) % 3) * 0.06, z + (r % 2) * 0.08, 0.05, 0.5 + ((k + r) % 3) * 0.12, 0.05, "#5E8C3E");
  const m = (k + 1) % 3; // püskül orta sapın tepesinde (CITY-PASS-LON: eskiden sapın 0,1 üstünde havadaydı)
  b.box(x, 0.5 + m * 0.12 + 0.06, z + 0.08, 0.07, 0.14, 0.07, "#6B4A2E");
}

/** Otobüs durağı sığınağı (1×1, engeller): cam arka/yan, siyah çerçeve, kanopi, yazısız sefer panosu (web noktası önünde).
 * Ulaşım yuvarlak simgesi, yazı ya da işletme rengi yok.*/
export function busShelter(b: Builder, i: number, j: number): void {
  const x = tx(i), z = tz(j) - 0.1; // CITY-PASS-LON: kaldırım kenarından geri (yürüme ölçeğindeki otobüs saçağa değmez)
  b.box(x, 1.0, z - 0.4, 0.96, 1.7, 0.04, "#BFE3F5", "glass");
  b.box(x - 0.46, 1.0, z, 0.04, 1.7, 0.8, "#BFE3F5", "glass");
  for (const [dx, dz] of [[-0.48, -0.42], [0.48, -0.42], [-0.48, 0.38], [0.48, 0.38]]) b.box(x + dx, 1.0, z + dz, 0.06, 2.0, 0.06, IRON);
  b.box(x, 2.04, z, 1.1, 0.08, 0.86, IRON);
  b.box(x + 0.05, 0.42, z - 0.25, 0.8, 0.06, 0.24, "#8B6A47");
  b.box(x + 0.4, 1.2, z - 0.36, 0.3, 0.5, 0.03, "#F4E7B0");
  for (let k = 0; k < 4; k++) b.box(x + 0.4, 1.38 - k * 0.11, z - 0.34, 0.22, 0.03, 0.01, "#4A4A50");
  b.block(i, j);
}

// ------------------------------------------------------------------ simge yapılar (ızgara katmanı; RB-LON)
const SAND = "#D2B271", SAND_D = "#B08F55", SAND_L = "#E4CC93", SPIRE = "#4F5B6B", GOLD = "#D4AF4C", DIAL = "#F3EDD8",
  INK = "#22262C", WIN_D = "#3B4656", STONE = "#D6CCB6", STONE_D = "#A99E88", STONE_L = "#E6DECB", BLUE = "#4D8CC4",
  WHITE = "#F2F4F6", ROAD = "#6B6F75", KIOSK = "#2F5D4E";
const FACES: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const FACE_R = [0, Math.PI, Math.PI / 2, -Math.PI / 2];

/** Yalnız kutu yazan çizim yüzeyi (Builder ya da ölçekli sarmalayıcı).*/
type BoxSink = Pick<Builder, "box">;
/** (K2 simge eğrisi): (X, Y0, Z) çevresinde bütün ayrıntısıyla orantılı ×k çizim (silüet korunur).*/
function scaledSink(b: Builder, X: number, Y0: number, Z: number, k: number): BoxSink {
  return { box: (x, y, z, w, h, d, c, g, j, r) => b.box(X + (x - X) * k, Y0 + (y - Y0) * k, Z + (z - Z) * k, w * k, h * k, d * k, c, g, j, r) };
}

/** Kare gövdenin `n` yüzüne (0 +z, 1 −z, 2 +x, 3 −x) ince levha: `u` yüz boyunca yatay kayma, `t` yüzden dışarı. */
function onFace(b: BoxSink, cx: number, cz: number, half: number, n: number, u: number, y: number, t: number, w: number, h: number,
  c: string, g: "solid" | "glass" = "solid"): void {
  const [nx, nz] = FACES[n], o = half + t + 0.02;
  if (nz) b.box(cx + u * nz, y, cz + nz * o, w, h, 0.04, c, g);
  else b.box(cx + nx * o, y, cz - u * nx, 0.04, h, w, c, g);
}

/** Kademeli kare külah (alttan üste daralan kutular). */
function spire(b: BoxSink, x: number, z: number, y0: number, steps: [number, number][], c: string, dz = 1): void {
  let y = y0;
  for (const [w, h] of steps) { b.box(x, y + h / 2, z, w, h, w * dz, c, "solid", 0.02); y += h; }
}

/** Saat kulesi (2×2 karo, sol-arka `i0, j0`): kaide, nervürlü kumtaşı gövde + dar Gotik pencereler, dört yüzde kadran,
 * kadran üstü üçgen alınlık, çan katı kemerleri, köşe pinaklleri, kademeli sivri külah + yaldızlı tepe. (K2 simge eğrisi,
 * sahne = eğri × 0,6): kule kaidenin üstünden (y 0,5) orantılı ×`CLOCK_K` (uç 11,5 → 8,4; hedef 96 m → 9,2 ±%25; meclis
 * kulesiyle aynı boy). Ayak izi engelli, `landmark` bölgesi `clocktower`.*/
const CLOCK_K = 0.715;
export function clockTower(b0: Builder, i0: number, j0: number): void {
  const x = (tx(i0) + tx(i0 + 1)) / 2, z = (tz(j0) + tz(j0 + 1)) / 2, CY = 7.05;
  b0.box(x, 0.25, z, 2.0, 0.5, 2.0, SAND_D, "solid", 0.03);
  const b = scaledSink(b0, x, 0.5, z, CLOCK_K), k = CLOCK_K, Y = (y: number) => 0.5 + (y - 0.5) * k;
  // CITY-PASS-LON: gövde inceldi (gerçek oran 12 m × 96 m ≈ 1 : 8; kadran katı gövdeden geniş), Dikey Gotik panel şeritleri
  b.box(x, 3.25, z, 1.55, 5.5, 1.55, SAND, "solid", 0.02);
  for (let n = 0; n < 4; n++) {
    for (const u of [-0.5, -0.17, 0.17, 0.5]) onFace(b, x, z, 0.775, n, u, 3.25, 0, 0.06, 5.5, SAND_L);
    for (const y of [1.6, 3.0, 4.4]) for (const u of [-0.33, 0, 0.33]) onFace(b, x, z, 0.775, n, u, y, 0.01, 0.12, 0.62, WIN_D);
    for (const y of [2.3, 3.7, 5.1]) onFace(b, x, z, 0.775, n, 0, y, 0.02, 1.4, 0.06, SAND_L); // kat kuşakları
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(x + sx * 0.79, 3.4, z + sz * 0.79, 0.2, 5.8, 0.2, SAND_L);
  b.box(x, 6.05, z, 1.95, 0.16, 1.95, SAND_L);
  // saat katı: dört yüzde soyut kadran (yaldız çerçeve, koyu lacivert döküm halka, opal beyaz yüz, 12 işaret, akrep/yelkovan;
  // rakam ve kadran altı yazı yok)
  b.box(x, CY, z, 2.0, 1.9, 2.0, SAND_L, "solid", 0.02);
  for (let n = 0; n < 4; n++) {
    onFace(b, x, z, 1.0, n, 0, CY, 0, 1.66, 1.66, GOLD);
    onFace(b, x, z, 1.0, n, 0, CY, 0.04, 1.44, 1.44, "#1E2A3A");
    onFace(b, x, z, 1.0, n, 0, CY, 0.08, 1.26, 1.26, DIAL);
    for (let q = 0; q < 12; q++) {
      const a = (q * Math.PI) / 6, big = q % 3 === 0;
      onFace(b, x, z, 1.0, n, Math.sin(a) * 0.5, CY + Math.cos(a) * 0.5, 0.12, big ? 0.08 : 0.06, big ? 0.16 : 0.06, INK);
    }
    onFace(b, x, z, 1.0, n, 0, CY + 0.18, 0.13, 0.05, 0.38, INK);
    onFace(b, x, z, 1.0, n, 0.13, CY, 0.13, 0.28, 0.05, INK);
    onFace(b, x, z, 1.0, n, 0, CY, 0.15, 0.09, 0.09, GOLD);
    for (const u of [-0.78, 0.78]) onFace(b, x, z, 1.0, n, u, CY - 0.78, 0.02, 0.18, 0.18, GOLD); // köşe yaldız kabartma (armasız)
    onFace(b, x, z, 1.0, n, 0, 8.12, 0, 1.2, 0.2, SAND_L);
    onFace(b, x, z, 1.0, n, 0, 8.3, 0, 0.64, 0.18, SAND_L);
    const [nx, nz] = FACES[n];
    b0.props.push({ k: "window", p: [x + nx * 1.2 * k, Y(CY), z + nz * 1.2 * k], r: FACE_R[n], s: [1.2 * k, 1.2 * k], c: "#FFF2C4" });
  }
  b.box(x, 8.05, z, 2.1, 0.12, 2.1, GOLD);
  // çan katı: koyu sivri kemer boşlukları + açık renk dikmeler, köşe pinaklleri
  b.box(x, 8.6, z, 1.6, 0.9, 1.6, "#3A3F47");
  for (let n = 0; n < 4; n++) for (const u of [-0.55, -0.18, 0.18, 0.55]) onFace(b, x, z, 0.8, n, u, 8.6, 0, 0.1, 0.9, SAND_L);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b.box(x + sx * 0.84, 8.75, z + sz * 0.84, 0.22, 1.3, 0.22, SAND_L);
    b.box(x + sx * 0.84, 9.55, z + sz * 0.84, 0.1, 0.32, 0.1, GOLD);
  }
  b.box(x, 9.1, z, 1.8, 0.12, 1.8, SAND_L);
  // demir sivri külah: kademeli, her kademede yaldız köşe süsleri (crocket); ikinci kademede fener pencereleri (oturum ışığı)
  const steps: [number, number][] = [[1.5, 0.36], [1.24, 0.36], [0.98, 0.34], [0.74, 0.32], [0.52, 0.3], [0.34, 0.3]];
  spire(b, x, z, 9.16, steps, SPIRE);
  let yy = 9.16;
  steps.forEach(([w, h], q) => {
    if (q < 5) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(x + sx * (w / 2), yy + h, z + sz * (w / 2), 0.07, 0.07, 0.07, GOLD);
    if (q === 1) for (let n = 0; n < 4; n++) onFace(b, x, z, w / 2, n, 0, yy + h / 2, 0, 0.18, 0.2, "#FFE7A8");
    yy += h;
  });
  b.box(x, 10.98, z, 0.4, 0.06, 0.4, GOLD);
  b.box(x, 11.15, z, 0.16, 0.3, 0.16, GOLD);
  b.box(x, 11.42, z, 0.06, 0.26, 0.06, GOLD);
  for (let i = i0; i < i0 + 2; i++) for (let j = j0; j < j0 + 2; j++) b0.block(i, j);
  b0.zones.push({ kind: "landmark", tag: "clocktower", i0, j0, w: 2, d: 2 });
}

/** Meclis binasını andıran nehir kıyısı Gotik yapı (CITY-PASS-LON; "Meclis"): `i0…i1` ×
 * `j0…j0+1`, cephe +z (nehre bakar). Güney (batı, i0) ucunda **büyük kare kule** (`i0…i0+2`; gerçekte 98,5 m, en yüksek kule):
 * tabanında yürünür sivri kemerli geçit (orta sütun `i0+1` açık; arka kenardan rıhtıma), dört köşede sekizgen kule ve
 * pinakl, piramit demir çatı (bayrak ve bayrak direği YOK). Uzun gövde (`i0+3…i1`): Dikey Gotik (Perpendicular) — sık payanda +
 * pinakl sırası, iki sıra sivri pencere ve dikey taş şeritler, korkuluklu saçak, dik arduvaz çatı ve çatı havalandırma
 * kuleleri (flèche), iki uçta öne çıkan köşk (pavyon) ve ortada **sekizgen merkez kulesi** (gerçekte 91 m, ince sivri külah).
 * Kumtaşı rengi (Anston kireçtaşı). Gece üst sıra pencerelerin bir kısmı sabit yanar. Arma, yazı, bayrak YOK. `landmark`
 * bölgesi `parliament` (kule dahil); kemer sütunu dışında ayak izi engelli.*/
export function parliament(b: Builder, i0: number, i1: number, j0: number): void {
  const z = tz(j0) + 0.5, front = z + 0.85;
  // ---- büyük kare kule (i0…i0+2): kemerli geçit, köşe kuleleri, piramit çatı
  const vx = tx(i0 + 1), VW = 2.5, VD = 1.9, VH = 7.0, AW = 0.98, AH = 2.3;
  b.box(vx, 0.12, z, VW + 0.1, 0.24, VD + 0.1, SAND_D, "solid", 0.02);
  for (const sx of [-1, 1]) b.box(vx + sx * (VW + AW) / 4, AH / 2, z, (VW - AW) / 2, AH, VD, SAND, "solid", 0.02);
  b.box(vx, AH + (VH - AH) / 2, z, VW, VH - AH, VD, SAND, "solid", 0.02);
  for (const [w, y] of [[AW - 0.24, AH - 0.12], [AW - 0.5, AH - 0.3]] as const) for (const sx of [-1, 1]) {
    b.box(vx + sx * (AW / 2 - (AW - w) / 4), y, z, (AW - w) / 2, 0.2, VD, SAND_L); // sivri kemer omuzları
  }
  b.box(vx, 0.02, z, AW - 0.06, 0.04, VD + 0.1, "#A99E88"); // geçit döşemesi
  for (const fz of [z + VD / 2 + 0.02, z - VD / 2 - 0.02]) {
    const sg = fz > z ? 1 : -1;
    b.box(vx, AH + 0.15, fz, AW + 0.3, 0.14, 0.06, SAND_L); // kemer alınlığı
    for (const u of [-0.95, -0.5, 0.5, 0.95]) b.box(vx + u, VH / 2 + 0.6, fz, 0.08, VH - 1.2, 0.05, SAND_L); // dikey şeritler
    for (const y of [3.3, 4.6, 5.9]) for (const u of [-0.72, -0.24, 0.24, 0.72]) {
      b.box(vx + u, y, fz, 0.2, 0.9, 0.04, WIN_D);
      if (sg > 0 && y > 5) b.props.push({ k: "window", p: [vx + u, y, fz + 0.03], r: 0, s: [0.18, 0.8], c: "#FFD98A" });
    }
    b.box(vx, 2.75, fz, 0.7, 0.32, 0.05, GOLD); // kemer üstü yaldız kuşak (armasız)
  }
  b.box(vx, VH + 0.08, z, VW + 0.12, 0.16, VD + 0.12, SAND_L);
  for (let k = 0; k < 9; k++) for (const fz of [z + VD / 2, z - VD / 2]) b.box(vx - 1.1 + k * 0.275, VH + 0.26, fz, 0.14, 0.2, 0.12, SAND_L); // mazgal
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const px = vx + sx * (VW / 2 - 0.05), pz = z + sz * (VD / 2 - 0.05);
    b.box(px, (VH + 0.9) / 2, pz, 0.44, VH + 0.9, 0.3, SAND_L, "solid", 0.02); // sekizgen kule (artı kesit)
    b.box(px, (VH + 0.9) / 2, pz, 0.3, VH + 0.9, 0.44, SAND_L, "solid", 0.02);
    spire(b, px, pz, VH + 0.9, [[0.36, 0.25], [0.24, 0.25], [0.12, 0.25]], SPIRE);
    b.box(px, VH + 1.75, pz, 0.05, 0.1, 0.05, GOLD);
  }
  spire(b, vx, z, VH + 0.16, [[2.0, 0.3], [1.6, 0.3], [1.2, 0.3], [0.8, 0.26], [0.42, 0.22]], SPIRE, VD / VW);
  b.box(vx, VH + 1.62, z, 0.14, 0.2, 0.14, GOLD);
  for (const sx of [-1, 1]) for (const j of [j0, j0 + 1]) b.block(i0 + 1 + sx, j);
  // ---- uzun gövde (i0+3…i1)
  const ba = tx(i0 + 3) - 0.5, xb = tx(i1) + 0.5, L = xb - ba, cx = (ba + xb) / 2, H = 2.4;
  b.box(cx, 0.15, z + 0.05, L, 0.3, 1.95, SAND_D, "solid", 0.02);
  b.box(cx, 0.3 + H / 2, z, L, H, 1.7, SAND, "solid", 0.02);
  b.box(cx, 1.42, front + 0.02, L, 0.08, 0.06, SAND_L); // kat bandı
  b.box(cx, H + 0.36, z, L + 0.04, 0.12, 1.76, SAND_L); // saçak
  for (let x = ba + 0.12; x < xb - 0.05; x += 0.25) b.box(x, H + 0.5, front - 0.02, 0.1, 0.16, 0.08, SAND_L); // korkuluk babaları
  b.box(cx, H + 0.86, z - 0.12, L - 0.1, 0.6, 1.2, "#5E6873", "solid", 0.02); // dik arduvaz çatı
  b.box(cx, H + 1.22, z - 0.12, L - 0.3, 0.2, 0.62, "#4E5864");
  b.box(cx, H + 1.36, z - 0.12, L - 0.4, 0.06, 0.06, GOLD); // mahya demiri
  const pav = [ba + 0.6, xb - 0.6];
  for (let k = 0; k < Math.round(L * 2); k++) {
    const x = ba + 0.25 + k * 0.5;
    if (pav.some((p) => Math.abs(p - x) < 0.6)) continue;
    b.box(x, 0.95, front + 0.01, 0.2, 0.68, 0.04, WIN_D);
    b.box(x, 2.0, front + 0.01, 0.2, 0.8, 0.04, WIN_D);
    b.box(x, 2.44, front + 0.02, 0.12, 0.06, 0.04, WIN_D); // sivri uç
    if (k % 3 === 1) b.props.push({ k: "window", p: [x, 2.0, front + 0.05], r: 0, s: [0.18, 0.72], c: "#FFD98A" });
    b.box(x + 0.25, 1.55, front + 0.04, 0.06, 2.1, 0.08, SAND_L); // dikey taş şerit (Perpendicular)
  }
  for (let x = ba + 1.0; x < xb - 0.9; x += 1.0) {
    b.box(x, 1.55, front + 0.08, 0.14, 2.5, 0.14, SAND_L); // payanda
    b.box(x, H + 0.72, front + 0.04, 0.1, 0.5, 0.1, SAND_L); // pinakl
    b.box(x, H + 1.02, front + 0.04, 0.05, 0.12, 0.05, GOLD);
  }
  for (const px of pav) {
    b.box(px, 0.3 + 1.7, z + 0.08, 1.1, 3.4, 1.9, SAND, "solid", 0.02);
    for (const y of [1.0, 2.0, 2.9]) b.box(px, y, front + 0.24, 0.42, 0.62, 0.04, WIN_D);
    b.props.push({ k: "window", p: [px, 2.9, front + 0.27], r: 0, s: [0.4, 0.58], c: "#FFD98A" });
    spire(b, px, z + 0.08, 3.7, [[1.0, 0.22], [0.72, 0.22], [0.44, 0.22], [0.2, 0.2]], SPIRE);
    for (const sx of [-1, 1]) {
      b.box(px + sx * 0.5, 3.4, front + 0.22, 0.14, 3.8, 0.14, SAND_L);
      b.box(px + sx * 0.5, 5.4, front + 0.22, 0.08, 0.3, 0.08, SPIRE);
      b.box(px + sx * 0.5, 5.6, front + 0.22, 0.04, 0.1, 0.04, GOLD);
    }
  }
  // çatı havalandırma kuleleri (flèche) — ince sivri
  for (const fx of [cx - L * 0.28, cx + L * 0.28]) {
    b.box(fx, H + 1.5, z - 0.12, 0.24, 0.3, 0.24, SAND_L);
    spire(b, fx, z - 0.12, H + 1.65, [[0.2, 0.3], [0.12, 0.3], [0.06, 0.3]], SPIRE);
  }
  // sekizgen merkez kulesi (gerçekte 91 m; saat kulesinden biraz kısa)
  const mz = z - 0.15;
  b.box(cx, H + 1.2, mz, 1.1, 1.2, 1.1, SAND_L, "solid", 0.02);
  for (const [w, d] of [[0.9, 0.62], [0.62, 0.9]] as const) b.box(cx, H + 2.4, mz, w, 1.6, d, SAND, "solid", 0.02);
  for (const n of [0, 1]) for (const u of [-0.16, 0.16]) b.box(cx + (n ? u : 0), H + 2.5, mz + (n ? 0.46 : 0) , n ? 0.1 : 0.04, 0.9, n ? 0.04 : 0.1, WIN_D);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(cx + sx * 0.36, H + 3.35, mz + sz * 0.36, 0.1, 0.4, 0.1, SAND_L);
  spire(b, cx, mz, H + 3.2, [[0.84, 0.36], [0.64, 0.5], [0.46, 0.5], [0.3, 0.5], [0.16, 0.5], [0.07, 0.4]], SPIRE);
  b.box(cx, H + 5.65, mz, 0.12, 0.16, 0.12, GOLD);
  for (let i = i0 + 3; i <= i1; i++) for (let j = j0; j < j0 + 2; j++) b.block(i, j);
  b.zones.push({ kind: "landmark", tag: "parliament", i0, j0, w: i1 - i0 + 1, d: 2 });
}

/** Açılır köprüyü andıran köprü (CITY-PASS-LON; "Açılır köprü"): güverte `iW…iE` × `j0…j0+3`
 * (kuzey yaya yolu `j0`, iki şerit `j0+1…j0+2`, güney yaya yolu `j0+3`; karolar açılır), nehir içinde iki Gotik taş kule
 * (`iW`, `iE`): ayaklar `j0−1` / `j0+4` satırlarında taş iskelede, güverte kulenin sivri kemerli geçidinden (açıklık 3,3) geçer;
 * kemerin üstünde kareye yakın kule gövdesi, dört köşede sekizgen kuleler ve sivri başlıklar, ortada kademeli dik çatı + yaldız
 * tepe. İki kule arasında güverteden yüksekte iki mavi-beyaz kafes **yüksek yaya geçidi** (gerçekte nehirden 44 m; kulenin
 * ≈ %65'i), iki yanda kuleden kıyıdaki küçük taş ayak kulelerine (`iW−1`, `iE+1`; `j0−1` / `j0+4`) inen mavi-beyaz asma
 * zincirler. Kule tabanında asansör/merdiven kapısı (gerçekte yüksek geçide asansör ve merdiven). Açılır kanatların ortası
 * güvertede ince çizgiyle belli. Uç ≈ 8,2. `landmark` bölgesi `bascule`.*/
export function towerBridge(b: Builder, iW: number, iE: number, j0: number): void {
  const Z0 = tz(j0), Z3 = tz(j0 + 3), Zc = (Z0 + Z3) / 2, DZ = Z3 - Z0 + 1, xW = tx(iW), xE = tx(iE), mid = (xW + xE) / 2, len = xE - xW + 1;
  for (let i = iW; i <= iE; i++) for (let j = j0; j <= j0 + 3; j++) b.blocked.delete(key(i, j));
  // güverte: taşıyıcı mavi kiriş, şeritler (asfalt), yaya yolları (taş), orta çizgi, kanat derzi, dış korkuluk
  b.box(mid, -0.32, Zc, len, 0.36, DZ - 0.1, BLUE);
  b.box(mid, -0.06, (tz(j0 + 1) + tz(j0 + 2)) / 2, len, 0.12, 2, ROAD, "solid", 0.03);
  for (const fj of [j0, j0 + 3]) b.box(mid, -0.04, tz(fj), len, 0.16, 1, STONE_L, "solid", 0.02);
  b.box(mid, 0.025, Zc, len - 0.4, 0.01, 0.05, "#D8DCE0");
  b.box(mid, 0.03, Zc, 0.04, 0.012, 1.9, "#8A939E");
  for (const sz of [-1, 1]) {
    const ez = Zc + sz * (DZ / 2 - 0.04);
    b.box(mid, 0.3, ez, len, 0.06, 0.06, BLUE);
    for (let x = xW - 0.4; x <= xE + 0.4 + 1e-6; x += 0.4) b.box(x, 0.16, ez, 0.05, 0.28, 0.05, WHITE);
    b.box(mid, -0.18, Zc + sz * (DZ / 2 + 0.02), len, 0.24, 0.06, WHITE);
  }
  // kuleler
  for (const t of [xW, xE]) {
    b.box(t, -0.45, Zc, 1.9, 0.9, DZ + 2.6, STONE_D, "solid", 0.03); // taş iskele
    for (const sz of [-1, 1]) {
      const lz = Zc + sz * (DZ / 2 + 0.36);
      b.box(t, 1.65, lz, 1.6, 3.3, 0.72, STONE, "solid", 0.02); // kemer ayağı (kule tabanı)
      for (const sx of [-1, 1]) b.box(t + sx * 0.81, 1.7, lz, 0.04, 2.2, 0.4, WIN_D);
      // asansör/merdiven kapısı (yaya yolu tarafında) + üstünde aydınlık pencere
      b.box(t + 0.81, 0.55, lz - sz * 0.2, 0.04, 1.0, 0.36, "#3A2E26");
      b.props.push({ k: "window", p: [t + 0.83, 1.5, lz - sz * 0.2], r: Math.PI / 2, s: [0.3, 0.4], c: "#FFD98A" });
    }
    b.box(t, 3.6, Zc, 1.6, 0.6, DZ + 1.44, STONE, "solid", 0.02); // geçit kemeri üstü (açıklık 3,3: çift katlı otobüs yürüme ölçeğinde geçer)
    for (const sx of [-1, 1]) for (const [w, y] of [[DZ - 0.2, 3.36], [DZ - 1.2, 3.2], [DZ - 2.4, 3.08]] as const) {
      b.box(t + sx * 0.81, y, Zc, 0.05, 0.1, w, STONE_L); // sivri kemer hattı
    }
    // kare gövde (kemer üstünden yüksek geçit kotunun üstüne), pencereler, köşe kuleleri, kademeli dik çatı
    b.box(t, 5.15, Zc, 1.5, 2.5, 2.3, STONE, "solid", 0.02);
    for (const y of [4.35, 5.85]) {
      for (const u of [-0.3, 0.3]) {
        for (const sx of [-1, 1]) b.box(t + sx * 0.77, y, Zc + u, 0.04, 0.7, 0.18, WIN_D);
        for (const sz of [-1, 1]) b.box(t + u, y, Zc + sz * 1.17, 0.18, 0.7, 0.04, WIN_D);
      }
      b.props.push({ k: "window", p: [t, y, Zc + 1.2], r: 0, s: [0.6, 0.6], c: "#FFD98A" });
    }
    b.box(t, 6.45, Zc, 1.6, 0.12, 2.4, STONE_L);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const px = t + sx * 0.7, pz = Zc + sz * 1.1;
      b.box(px, 5.5, pz, 0.36, 3.2, 0.36, STONE_L, "solid", 0.02);
      b.box(px, 5.5, pz, 0.26, 3.2, 0.44, STONE_L, "solid", 0.02);
      spire(b, px, pz, 7.1, [[0.34, 0.2], [0.24, 0.2], [0.14, 0.2]], SPIRE);
      b.box(px, 7.78, pz, 0.05, 0.16, 0.05, GOLD);
    }
    spire(b, t, Zc, 6.51, [[1.3, 0.3], [1.02, 0.3], [0.74, 0.3], [0.46, 0.28], [0.22, 0.26]], SPIRE, 2.3 / 1.5);
    b.box(t, 8.04, Zc, 0.08, 0.36, 0.08, GOLD);
    for (const sz of [-1, 1]) b.block(Math.round(t - tx(0)), j0 + (sz < 0 ? -1 : 4));
  }
  // yüksek yaya geçitleri: iki kafes kiriş (mavi alt/üst başlık, beyaz çapraz dikmeler, açık cam taban)
  const wa = xW + 0.75, wb = xE - 0.75, wl = wb - wa, wm = (wa + wb) / 2;
  for (const sz of [-0.62, 0.62]) {
    const wz = Zc + sz;
    b.box(wm, 5.12, wz, wl, 0.14, 0.62, BLUE);
    b.box(wm, 5.2, wz, wl - 0.02, 0.02, 0.5, "#CFE6F2", "glass");
    b.box(wm, 5.76, wz, wl, 0.14, 0.62, BLUE);
    for (const fz of [wz - 0.31, wz + 0.31]) {
      const n = 8;
      for (let k = 0; k < n; k++) {
        const x0 = wa + (k + 0.5) * (wl / n);
        b.box(x0 - wl / (2 * n) + 0.02, 5.44, fz, 0.05, 0.5, 0.04, WHITE);
        b.box(x0, k % 2 ? 5.3 : 5.58, fz, wl / n, 0.05, 0.04, WHITE);
      }
    }
  }
  // yan açıklıklar: kuleden kıyıdaki taş ayak kulelerine inen mavi-beyaz asma zincirler
  for (const side of [-1, 1]) {
    const t = side < 0 ? xW : xE, ax = t + side * 0.75, ex = tx(side < 0 ? iW - 1 : iE + 1);
    for (const sz of [-1, 1]) {
      const z0 = Zc + sz * 1.0, z1 = Zc + sz * 2.5;
      // kesintisiz zincir: her halka bir sonrakine değer (kutu iki uç noktayı kapsar)
      const Y = (f: number) => 1.55 + 3.75 * Math.pow(1 - f, 1.6), N = 10;
      for (let k = 0; k < N; k++) {
        const f0 = k / N, f1 = (k + 1) / N, x0 = ax + (ex - ax) * f0, x1 = ax + (ex - ax) * f1, za = z0 + (z1 - z0) * f0, zb = z0 + (z1 - z0) * f1;
        b.box((x0 + x1) / 2, (Y(f0) + Y(f1)) / 2, (za + zb) / 2, Math.abs(x1 - x0) + 0.16, Math.abs(Y(f0) - Y(f1)) + 0.16, Math.abs(zb - za) + 0.16, k % 2 ? WHITE : BLUE);
      }
      const ej = j0 + (sz < 0 ? -1 : 4);
      b.box(ex, 0.75, z1, 0.6, 1.5, 0.6, STONE, "solid", 0.03);
      b.box(ex, 1.56, z1, 0.4, 0.16, 0.4, STONE_L);
      b.box(ex, 1.74, z1, 0.24, 0.2, 0.24, SPIRE);
      b.box(ex, 1.9, z1, 0.06, 0.12, 0.06, GOLD);
      b.block(side < 0 ? iW - 1 : iE + 1, ej);
    }
  }
  b.zones.push({ kind: "landmark", tag: "bascule", i0: iW, j0: j0 - 1, w: iE - iW + 1, d: 6 });
}

/** Gözlem çarkı ( + CITY-PASS-LON; gerçek konsol çarktan esinli — "Gözlem çarkı"):
 * - **Jant**: iki yüzde sürekli ince boru + aralarında kafes çubukları (gerçekte 64 düz kirişten üçgen kesitli kafes; burada
 * birbirine değen küpler, hiçbiri kopuk değil).
 * - **Tel kollar**: bisiklet tekerleği gibi göbeğin iki ucundaki diskten (ön ve arka yüz) janta gergin ince halatlar; yatay ve
 * dikey kollar tek parça, çaprazlar birbirine değen ince küp zinciri (REAL-SUPPORT: dönen gövdede kopuk parça yok).
 * - **Kabinler**: 16 cam kabin jantın **dışında**; kabinin uzun ekseni mil yönünde, kabin merkezinden döner (askı `k` = kabin
 * merkezi → hep dik), iki ucundaki bağlantı levhasıyla janta bağlı. Taban, tavan, cam yan yüzler, uçlarda alçak cam şerit
 * (dönen blok bütçesi: kabin başına 8 blok). Yumurta/oval kapsül biçimi YOK (köşeli cam kabin; IP: tek yandan A ayak + oval kapsül birlikte
 * kopyalanmaz —; harita modeli `cark` ile aynı yorum).
 * - **Göbek ve mil**: dönen göbek tamburu + iki uç disk; sabit mil karadaki **tek yanlı A çerçevenin** tepesinde (konsol).
 * - **A çerçeve**: karada (güneyde), çarkın arkasında 65° eğik iki ayak (gerçekteki gibi), ayaklar arası bağ kirişi, beton
 * kaideler; tepeden arkaya inen gergi halatları ve ankraj bloğu (gerçekte altı halat).
 * - **Biniş iskelesi**: en alttaki kabinin altında, nehre uzanan taş iskele (kabin tabanı iskelenin 0,04 üstünden geçer).
 * Marka, işletme renk düzeni, ad, yazı ve gece ışık gösterisi yok; dönen bloklar beyaz-gri. Dönen ≈ 470 blok (MAX_SPIN_BLOCKS
 * 600; büyümüş dünyada ekip fırıldakları ≈ 52), +1 çizim çağrısı. Ayak, kaide ve ankraj karoları burada engellenir; süpürme
 * zarfı (su karoları) çağıran tarafından. `landmark` bölgesi `wheel`.*/
export function obsWheel(b: Builder, spec: WheelSpec): void {
  const cx = tx(spec.ci), cz = tz(spec.cj) + spec.dz, hub = spec.hub, R = spec.R;
  const RR = R - 0.85, RIM_Z = 0.74, SPOKE_Z = 0.6, CLAMP_Z = 0.68;
  const rigid: Spin = { a: "z", o: [cx, hub, cz], w: spec.w };
  const sp = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, r: Spin = rigid) => b.box(x, y, z, w, h, d, c, "spin", 0, r);
  // jant: iki yüzde değen küplerden ince boru (küp ≥ aralık) + her dördüncü küpte iki boruyu bağlayan çapraz kafes çubuğu
  // (gerçekte üçgen kesitli kafes kiriş)
  const nSeg = Math.round((2 * Math.PI * RR) / 0.2), seg = (2 * Math.PI * RR) / nSeg + 0.01;
  for (let k = 0; k < nSeg; k++) {
    const a = (k / nSeg) * Math.PI * 2, x = cx + RR * Math.cos(a), y = hub + RR * Math.sin(a);
    for (const sz of [-CLAMP_Z, CLAMP_Z]) sp(x, y, cz + sz, seg, seg, 0.12, WHITE);
    if (k % 4 === 0) sp(x, y, cz, 0.1, 0.1, 2 * RIM_Z, "#D5DAE0");
  }
  // göbek: tambur + iki uç disk (tel kollar disklerden çıkar)
  sp(cx, hub, cz, 0.6, 0.6, 1.3, "#8A939E");
  for (const sz of [-1, 1]) sp(cx, hub, cz + sz * (SPOKE_Z + 0.06), 0.9, 0.9, 0.1, "#C3CAD2");
  // tel kollar: ön ve arka yüzde 8'er; yatay/dikey tek parça, çaprazlar değen ince küp zinciri
  const r1 = RR - 0.07;
  for (const sz of [-SPOKE_Z, SPOKE_Z]) {
    sp(cx, hub, cz + sz, 2 * r1, 0.07, 0.07, "#C3CAD2");
    sp(cx, hub, cz + sz, 0.07, 2 * r1, 0.07, "#C3CAD2");
    for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
      const step = 0.105 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      for (let r = 0.42; r <= r1 + 1e-6; r += step) sp(cx + r * Math.cos(a), hub + r * Math.sin(a), cz + sz, 0.07, 0.07, 0.07, "#C3CAD2");
    }
  }
  // kabinler: merkezden dik kalır; iki uçta janta bağlı levha (dönen gövde), kabinin içinde avatar tabanda (CABIN_DROP)
  const hw = CABIN_W / 2, hd = CABIN_D / 2, hh = CABIN_H / 2, RC = RR + 0.4, GLASS = "#C9DDE8";
  for (let c = 0; c < spec.n; c++) {
    const a = cabinAngle(spec, c), ax = cx + R * Math.cos(a), ay = hub + R * Math.sin(a);
    for (const sz of [-CLAMP_Z, CLAMP_Z]) sp(cx + RC * Math.cos(a), hub + RC * Math.sin(a), cz + sz, 0.5, 0.5, 0.12, "#D5DAE0");
    const cab: Spin = { ...rigid, k: [ax, ay, cz] };
    const floor = ay - CABIN_DROP;
    sp(ax, floor - 0.04, cz, CABIN_W, 0.08, CABIN_D, "#8A939E", cab);
    sp(ax, ay + hh - 0.04, cz, CABIN_W + 0.04, 0.08, CABIN_D + 0.04, "#EEF1F3", cab);
    for (const sx of [-1, 1]) sp(ax + sx * (hw - 0.02), ay, cz, 0.04, CABIN_H - 0.16, CABIN_D, GLASS, cab);
    for (const pz of [-hd + 0.015, hd - 0.015]) sp(ax, floor + 0.17, cz + pz, CABIN_W - 0.1, 0.34, 0.03, GLASS, cab);
  }
  // sabit: mil (göbekten A çerçeve tepesine), A çerçeve (karada, tek yanda), bağ kirişi, kaideler, gergi halatları ve ankraj
  // A çerçeve gerçekteki gibi ≈ 65° eğik: ayaklar karada beşinci satırda (çark bahçesinin içi), tepe rıhtımın üstünde; mil
  // göbekten tepeye uzanır (gerçekte uzun konsol mil)
  const footZ = tz(spec.cj + 5), apexZ = footZ - hub / Math.tan((65 * Math.PI) / 180), FX = 1.6, LEG = "#DCE1E6";
  b.box(cx, hub, (cz - 0.9 + apexZ + 0.2) / 2, 0.3, 0.3, apexZ + 0.2 - (cz - 0.9), "#B8C0C8");
  b.box(cx, hub, cz - 0.95, 0.42, 0.42, 0.1, "#8A939E");
  b.box(cx, hub, apexZ, 0.7, 0.5, 0.5, LEG, "solid", 0.02);
  const nLeg = 24;
  for (const sx of [-1, 1]) {
    for (let q = 0; q <= nLeg; q++) {
      const f = q / nLeg; // 0 tepe → 1 ayak
      b.box(cx + sx * (0.18 + (FX - 0.18) * f), hub - 0.15 + (0.25 - hub + 0.15) * f, apexZ + (footZ - apexZ) * f, 0.24, 0.3, 0.24, LEG);
    }
    b.box(cx + sx * FX, 0.15, footZ, 0.62, 0.3, 0.62, "#A39E94", "solid", 0.03);
    b.block(spec.ci + sx * 2, spec.cj + 5);
  }
  const fT = 0.55, yT = hub - 0.15 + (0.25 - hub + 0.15) * fT, xT = 0.18 + (FX - 0.18) * fT; // bağ kirişi
  b.box(cx, yT, apexZ + (footZ - apexZ) * fT, 2 * xT, 0.16, 0.16, LEG);
  // gergi halatları: tepeden arkadaki ankraja (üç çift; ince, birbirine değen kutular)
  const anZ = tz(spec.cj + 6) + 0.1;
  b.box(cx, 0.2, anZ, 1.0, 0.4, 0.7, "#8E8A80", "solid", 0.03);
  for (const dx of [-0.3, 0, 0.3]) {
    const n = 26;
    for (let q = 0; q < n; q++) {
      const f = (q + 0.5) / n;
      b.box(cx + dx * f, hub + (0.4 - hub) * f, apexZ + (anZ - apexZ) * f, 0.05, 0.23, 0.14, "#9AA3AD");
    }
  }
  for (const [di, dj] of [[0, 5], [0, 6], [-1, 4], [1, 4]] as const) b.block(spec.ci + di, spec.cj + dj); // ankraj + alçak ayak karoları
  // biniş iskelesi: en alttaki kabinin altında nehre uzanan taş iskele (üst 0,38), kazıklar, kenar şeridi (baba yok: alttan geçen
  // kabinlerin süpürme alanı)
  const pz0 = tz(spec.cj) - 0.45, pz1 = tz(spec.cj) + 0.5;
  b.box(cx, 0.33, (pz0 + pz1) / 2, 2.8, 0.1, pz1 - pz0, STONE_D, "solid", 0.02);
  b.box(cx, 0.385, pz0 + 0.04, 2.8, 0.03, 0.08, "#E6DECB");
  for (const dx of [-1.2, 0, 1.2]) b.box(cx + dx, -0.2, pz0 + 0.12, 0.2, 1.0, 0.2, "#6E6A62");
  const [i0, i1] = wheelSpan(spec);
  b.zones.push({ kind: "landmark", tag: "wheel", i0, j0: spec.cj, w: i1 - i0 + 1, d: 6 }); // çark + A çerçeve + ankraj
}

/** FREE-MAP-IP — özgün sokak bilgi köşkü (1×1, engeller): taş kaide, ince koyu yeşil gövde, ön ve arka yüzde tek parça cam harita
 *  panosu (çıtasız), düz ince saçak ve küçük yön levhası kutusu (yazısız). Kırmızı kabin, kubbe, taç, arma ve yazı YOK. Gece
 *  panoda sabit, yumuşak ışık. */
export function infoKiosk(b: Builder, i: number, j: number): void {
  const x = tx(i), z = tz(j);
  b.box(x, 0.06, z, 0.7, 0.12, 0.6, "#8A8F96");
  b.box(x, 0.95, z, 0.5, 1.7, 0.4, KIOSK, "solid", 0.02);
  for (const n of [0, 2]) onFace(b, x, z, 0.2, n, 0, 1.1, 0, 0.42, 0.7, "#DCE8EE");
  b.box(x, 1.84, z, 0.78, 0.08, 0.62, KIOSK);
  b.box(x + 0.32, 1.55, z, 0.14, 0.22, 0.06, "#C9A35A");
  b.props.push({ k: "window", p: [x, 1.1, z + 0.23], r: 0, s: [0.4, 0.66], c: "#FFE9B0" });
  b.block(i, j);
}

// ------------------------------------------------------------------ BIG-LON: büyük taban simgeleri (36 × 32)
const PORT = "#E4DFD3", PORT_D = "#C8C0AE", PORT_L = "#F1EDE4", LEAD = "#6A737D", BRONZE = "#4A4036", RAIL = "#1E2226",
  FOUNT = "#6FA7B8";

/** Sarayı andıran neoklasik cephe (`i0…i1` × `j0…j0+1`; cephe +z): açık Portland taşı, rustik zemin kat, pilastrlı üç kat
 *  pencere, korniş + korkuluk + vazolar, ortada altı sütunlu çıkıntılı portik ve boş alınlık, iki uçta hafif çıkıntılı köşk.
 *  Bayrak, bayrak direği, arma, yazı YOK. Gece ışığı yok. Ayak izi engelli, `landmark` bölgesi `palace`. */
export function palace(b: Builder, i0: number, i1: number, j0: number): void {
  const xa = tx(i0) - 0.5, xb = tx(i1) + 0.5, L = xb - xa, cx = (xa + xb) / 2, z = tz(j0) + 0.5, H = 3.3, fz = z + 0.85;
  b.box(cx, 0.15, z, L, 0.3, 2.0, PORT_D, "solid", 0.02);
  b.box(cx, 0.15 + H / 2, z - 0.05, L - 0.1, H, 1.8, PORT, "solid", 0.02);
  for (const y of [0.55, 0.95]) b.box(cx, y, fz + 0.01, L - 0.1, 0.05, 0.04, PORT_D);
  b.box(cx, 1.32, fz + 0.03, L - 0.06, 0.1, 0.08, PORT_L);
  const n = Math.round(L);
  for (let k = 0; k < n; k++) {
    const x = xa + k + 0.5;
    if (Math.abs(x - cx) < 1.4) continue; // portik
    b.box(x, 0.85, fz + 0.01, 0.34, 0.5, 0.04, WIN_D);
    b.box(x, 1.95, fz + 0.01, 0.34, 0.72, 0.04, WIN_D);
    b.box(x, 2.4, fz + 0.03, 0.46, 0.07, 0.07, PORT_L);
    b.box(x, 2.92, fz + 0.01, 0.3, 0.38, 0.04, WIN_D);
    if (k > 0) b.box(xa + k, 2.3, fz + 0.04, 0.1, 1.95, 0.08, PORT_L);
  }
  // uç köşkler (hafif çıkıntı + küçük alınlık)
  for (const ex of [xa + 0.6, xb - 0.6]) {
    b.box(ex, 0.15 + (H + 0.2) / 2, z + 0.05, 1.2, H + 0.2, 1.8, PORT_L, "solid", 0.02);
    b.box(ex, 1.95, fz + 0.12, 0.34, 0.72, 0.04, WIN_D);
    b.box(ex, 0.85, fz + 0.12, 0.34, 0.5, 0.04, WIN_D);
    spire(b, ex, fz - 0.2, H + 0.35, [[1.1, 0.12], [0.7, 0.12], [0.3, 0.12]], PORT_L, 0.3);
  }
  // korniş, korkuluk (üst/alt kuşak + babalar), vazolar, alçak kurşun çatı
  b.box(cx, H + 0.22, z - 0.03, L + 0.06, 0.14, 1.92, PORT_L);
  b.box(cx, H + 0.3, z - 0.15, L - 0.4, 0.3, 1.3, "#8E979F", "solid", 0.02);
  b.box(cx, H + 0.34, fz - 0.02, L - 0.1, 0.06, 0.1, PORT);
  b.box(cx, H + 0.6, fz - 0.02, L - 0.1, 0.07, 0.12, PORT_L);
  for (let x = xa + 0.25; x < xb - 0.2; x += 0.5) b.box(x, H + 0.47, fz - 0.02, 0.07, 0.2, 0.07, PORT_D);
  for (let k = 1; k < n; k += 2) b.box(xa + k, H + 0.75, fz - 0.02, 0.12, 0.2, 0.12, PORT_L);
  // portik: kaide, altı sütun, saçaklık, kademeli alınlık (boş; arma yok), orta kapı
  b.box(cx, 0.7, fz + 0.06, 2.9, 1.1, 0.2, PORT_L, "solid", 0.02);
  b.box(cx, 0.6, fz + 0.18, 0.5, 0.9, 0.04, "#3A3530");
  for (let k = 0; k < 6; k++) {
    const x = cx - 1.25 + k * 0.5;
    b.box(x, 2.25, fz + 0.12, 0.16, 1.8, 0.16, PORT_L);
    b.box(x, 3.18, fz + 0.12, 0.24, 0.08, 0.24, PORT_L);
  }
  b.box(cx, 3.3, fz + 0.1, 3.0, 0.18, 0.3, PORT_L);
  spire(b, cx, fz + 0.06, 3.4, [[3.0, 0.14], [2.3, 0.14], [1.6, 0.14], [0.9, 0.14], [0.3, 0.12]], PORT_L, 0.12);
  for (let i = i0; i <= i1; i++) for (let j = j0; j < j0 + 2; j++) b.block(i, j);
  b.zones.push({ kind: "landmark", tag: "palace", i0, j0, w: i1 - i0 + 1, d: 2 });
}

/** Saray önü demir parmaklık (`j` satırında `i0…i1`, `gate` sütunları açık kapı): siyah çubuklar, yaldız uçlar, taş babalar.
 *  Kapı dışındaki karolar engelli. */
export function palaceRail(b: Builder, i0: number, i1: number, j: number, gate: [number, number]): void {
  const z = tz(j) - 0.3;
  const run = (a: number, c: number) => {
    const xa = tx(a) - 0.5, xc = tx(c) + 0.5, mx = (xa + xc) / 2, L = xc - xa;
    b.box(mx, 0.16, z, L, 0.32, 0.22, PORT_D, "solid", 0.02);
    for (const y of [0.5, 1.05]) b.box(mx, y, z, L, 0.05, 0.05, RAIL);
    for (let x = xa + 0.12; x < xc; x += 0.25) {
      b.box(x, 0.78, z, 0.04, 0.6, 0.04, RAIL);
      b.box(x, 1.14, z, 0.06, 0.1, 0.06, GOLD);
    }
    for (let i = a; i <= c; i++) b.block(i, j);
  };
  if (gate[0] > i0) run(i0, gate[0] - 1);
  if (gate[1] < i1) run(gate[1] + 1, i1);
  for (const gx of [tx(gate[0]) - 0.5, tx(gate[1]) + 0.5]) {
    b.box(gx, 0.8, z, 0.36, 1.6, 0.36, PORT_L, "solid", 0.02);
    b.box(gx, 1.72, z, 0.24, 0.24, 0.24, GOLD);
  }
}

/** Anıt döner kavşağı adası (3×3, merkez `i, j`; engelli): sekizgen havuz, beyaz mermer basamaklar, kaide, yüksek kaide
 *  gövdesi ve tepede soyut yaldız kanatlı figür (kimliksiz; yazı, arma yok), kaide yanlarında bronz gruplar. `landmark`
 *  bölgesi `memorial`. */
export function memorial(b: Builder, i: number, j: number): void {
  const x = tx(i), z = tz(j);
  b.box(x, 0.18, z, 2.9, 0.36, 2.2, PORT_D, "solid", 0.02);
  b.box(x, 0.18, z, 2.2, 0.36, 2.9, PORT_D, "solid", 0.02);
  b.box(x, 0.33, z, 2.6, 0.06, 1.9, FOUNT, "water");
  b.box(x, 0.33, z, 1.9, 0.06, 2.6, FOUNT, "water");
  b.box(x, 0.55, z, 1.5, 0.4, 1.5, PORT_L, "solid", 0.02);
  b.box(x, 0.85, z, 1.2, 0.3, 1.2, PORT_L, "solid", 0.02);
  b.box(x, 1.45, z, 0.9, 1.0, 0.9, PORT, "solid", 0.02);
  for (const [dx, dz] of [[0, 0.5], [0, -0.5], [0.5, 0], [-0.5, 0]]) {
    b.box(x + dx, 1.25, z + dz, 0.3 + Math.abs(dz) * 0.2, 0.55, 0.3 + Math.abs(dx) * 0.2, BRONZE, "solid", 0.06);
  }
  b.box(x, 2.2, z, 0.62, 0.5, 0.62, PORT_L);
  b.box(x, 2.9, z, 0.42, 0.9, 0.42, PORT);
  b.box(x, 3.4, z, 0.54, 0.1, 0.54, PORT_L);
  b.box(x, 3.7, z, 0.22, 0.5, 0.2, GOLD);
  b.box(x, 4.02, z, 0.14, 0.14, 0.14, GOLD);
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) b.box(x + sx * (0.16 + k * 0.1), 3.75 + k * 0.1, z - 0.04, 0.1, 0.22, 0.06, GOLD);
  for (let a = i - 1; a <= i + 1; a++) for (let c = j - 1; c <= j + 1; c++) b.block(a, c);
  b.zones.push({ kind: "landmark", tag: "memorial", i0: i - 1, j0: j - 1, w: 3, d: 3 });
}

/** Meydan çeşmesi (2×2, sol-arka `i0, j0`; engelli): sekizgen taş havuz, su, iki kademeli orta kâse, ince fıskiye. */
export function squareFountain(b: Builder, i0: number, j0: number): void {
  const x = (tx(i0) + tx(i0 + 1)) / 2, z = (tz(j0) + tz(j0 + 1)) / 2;
  b.box(x, 0.2, z, 1.9, 0.4, 1.3, PORT_D, "solid", 0.02);
  b.box(x, 0.2, z, 1.3, 0.4, 1.9, PORT_D, "solid", 0.02);
  b.box(x, 0.43, z, 1.7, 0.06, 1.1, FOUNT, "water"); // su kaide üstünün (0,4) üstünde (eskiden 0,39: gömülü)
  b.box(x, 0.43, z, 1.1, 0.06, 1.7, FOUNT, "water");
  b.box(x, 0.65, z, 0.24, 0.6, 0.24, PORT);
  b.box(x, 0.98, z, 0.8, 0.1, 0.8, PORT_L);
  b.box(x, 1.03, z, 0.66, 0.04, 0.66, FOUNT, "water");
  b.box(x, 1.25, z, 0.14, 0.4, 0.14, PORT);
  b.box(x, 1.47, z, 0.42, 0.08, 0.42, PORT_L);
  b.box(x, 1.75, z, 0.06, 0.5, 0.06, "#D8EEF5", "water");
  for (let i = i0; i < i0 + 2; i++) for (let j = j0; j < j0 + 2; j++) b.block(i, j);
}

/** Yatan bronz aslan (dekor; `dir` +1 → +z'ye, −1 → −z'ye bakar): gövde, yele, baş, ön patiler, kuyruk. */
function lion(b: BoxSink, x: number, y: number, z: number, dir: number): void {
  b.box(x, y + 0.14, z - dir * 0.08, 0.3, 0.26, 0.6, BRONZE, "solid", 0.04);
  b.box(x, y + 0.3, z + dir * 0.18, 0.36, 0.34, 0.24, "#3C342C", "solid", 0.04);
  b.box(x, y + 0.3, z + dir * 0.32, 0.2, 0.2, 0.12, BRONZE);
  for (const sx of [-0.09, 0.09]) b.box(x + sx, y + 0.05, z + dir * 0.36, 0.09, 0.1, 0.26, BRONZE);
  b.box(x, y + 0.08, z - dir * 0.44, 0.06, 0.06, 0.2, BRONZE);
}

/** Meydan sütunu (2×2, sol-arka `i0, j0`; engelli): basamaklı kaide, kare kaide gövdesi, dört köşede yatan bronz aslan, uzun
 * yivli sütun, bronz başlık ve sade tepe süsü (heykel/kişi, yazı, kabartma yok). (K2 simge eğrisi): taban levhasının
 * üstü (y 0,24) aslanlarıyla birlikte orantılı ×`COLUMN_K` (uç 9,2 → 6,9; hedef 52 m → 7,6 ±%25; şehir içi sıra: saat
 * kulesinden ve açılır köprüden kısa). `landmark` bölgesi `column`.*/
const COLUMN_K = 0.75;
export function squareColumn(b0: Builder, i0: number, j0: number): void {
  const x = (tx(i0) + tx(i0 + 1)) / 2, z = (tz(j0) + tz(j0 + 1)) / 2;
  b0.box(x, 0.12, z, 2.0, 0.24, 2.0, PORT_D, "solid", 0.02);
  const b = scaledSink(b0, x, 0.24, z, COLUMN_K);
  b.box(x, 0.3, z, 1.8, 0.16, 1.8, PORT_D, "solid", 0.02);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box(x + sx * 0.6, 0.45, z + sz * 0.6, 0.5, 0.14, 0.7, PORT, "solid", 0.02);
    lion(b, x + sx * 0.6, 0.52, z + sz * 0.6, sz);
  }
  b.box(x, 1.05, z, 0.8, 1.3, 0.8, PORT, "solid", 0.02);
  b.box(x, 1.75, z, 0.94, 0.12, 0.94, PORT_L);
  b.box(x, 1.88, z, 0.6, 0.14, 0.6, PORT_L);
  b.box(x, 5.1, z, 0.42, 6.3, 0.42, PORT_L, "solid", 0.02);
  for (const [dx, dz] of [[0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22]]) b.box(x + dx, 5.1, z + dz, dx ? 0.04 : 0.2, 6.2, dz ? 0.04 : 0.2, PORT);
  b.box(x, 8.3, z, 0.6, 0.18, 0.6, BRONZE);
  b.box(x, 8.48, z, 0.7, 0.18, 0.7, BRONZE);
  b.box(x, 8.66, z, 0.4, 0.18, 0.4, PORT_L);
  b.box(x, 8.9, z, 0.18, 0.3, 0.18, BRONZE);
  b.box(x, 9.12, z, 0.1, 0.14, 0.1, BRONZE);
  for (let i = i0; i < i0 + 2; i++) for (let j = j0; j < j0 + 2; j++) b0.block(i, j);
  b0.zones.push({ kind: "landmark", tag: "column", i0, j0, w: 2, d: 2 });
}

/** Meydanın arkasındaki galeri cephesi (`i0…i1` × `j0…j0+1`; cephe +z): alçak açık taş yapı, düz pencere sırası, ortada
 *  sütunlu portik + alınlık, üstünde küçük kubbe, iki yanda biber kulesi. Yazı yok. Ön basamak dekor. */
export function gallery(b: Builder, i0: number, i1: number, j0: number): void {
  const xa = tx(i0) - 0.5, xb = tx(i1) + 0.5, L = xb - xa, cx = (xa + xb) / 2, z = tz(j0) + 0.5, H = 2.4, fz = z + 0.8;
  b.box(cx, H / 2, z - 0.1, L, H, 1.8, STONE_L, "solid", 0.02);
  b.box(cx, 0.9, fz + 0.01, L, 0.06, 0.04, STONE_D);
  b.box(cx, H + 0.08, z - 0.08, L + 0.06, 0.16, 1.88, STONE);
  for (let k = 0; k < Math.round(L); k++) {
    const x = xa + k + 0.5;
    if (Math.abs(x - cx) < 1.3) continue;
    b.box(x, 1.55, fz + 0.01, 0.3, 0.7, 0.04, WIN_D);
    b.box(x, 0.5, fz + 0.01, 0.3, 0.42, 0.04, WIN_D);
  }
  b.box(cx, 0.12, fz + 0.1, 3.2, 0.24, 0.2, STONE, "solid", 0.02);
  for (let k = 0; k < 6; k++) b.box(cx - 1.25 + k * 0.5, 1.3, fz + 0.1, 0.14, 2.1, 0.14, STONE_L);
  b.box(cx, 2.42, fz + 0.08, 2.9, 0.16, 0.3, STONE);
  spire(b, cx, fz + 0.04, 2.5, [[2.9, 0.12], [2.1, 0.12], [1.3, 0.12], [0.5, 0.12]], STONE_L, 0.12);
  b.box(cx, 2.75, z - 0.2, 1.1, 0.6, 1.1, STONE_L, "solid", 0.02);
  for (const [w, y] of [[1.0, 3.12], [0.8, 3.3], [0.56, 3.46], [0.3, 3.58]] as const) b.box(cx, y, z - 0.2, w, 0.18, w, LEAD, "solid", 0.02);
  b.box(cx, 3.78, z - 0.2, 0.08, 0.24, 0.08, GOLD);
  for (const ex of [xa + 0.7, xb - 0.7]) {
    b.box(ex, 2.75, z - 0.2, 0.5, 0.6, 0.5, STONE_L);
    b.box(ex, 3.15, z - 0.2, 0.36, 0.22, 0.36, LEAD);
    b.box(ex, 3.32, z - 0.2, 0.16, 0.14, 0.16, LEAD);
  }
  for (let i = i0; i <= i1; i++) for (let j = j0; j < j0 + 2; j++) b.block(i, j);
}

/** Taş kaleyi andıran kare kale burcu (`i0…i0+3` × `j0…j0+3`; engelli): kesme açık taş gövde, mazgallı siper, dört köşede
 *  yüksek kule (biri yuvarlağımsı) ve kurşun kubbecikler + yaldız rüzgârgülü çubuğu, kemerli pencereler, alçak sur duvarı ve
 *  kapı. Bayrak, arma, yazı yok. Uç ≈ 6,0. `landmark` bölgesi `keep`. */
export function stoneKeep(b: Builder, i0: number, j0: number): void {
  const x = (tx(i0) + tx(i0 + 3)) / 2, z = (tz(j0) + tz(j0 + 3)) / 2, H = 3.7, K = "#DCD3C0", KD = "#B5AA92";
  for (const sz of [-1, 1]) b.box(x, 0.55, z + sz * 1.85, 3.9, 1.1, 0.24, KD, "solid", 0.03);
  for (const sx of [-1, 1]) b.box(x + sx * 1.85, 0.55, z, 0.24, 1.1, 3.9, KD, "solid", 0.03);
  for (let k = -3; k <= 3; k += 2) {
    b.box(x + k * 0.5, 1.2, z + 1.85, 0.24, 0.2, 0.26, KD);
    b.box(x + k * 0.5, 1.2, z - 1.85, 0.24, 0.2, 0.26, KD);
  }
  b.box(x, 0.5, z + 1.98, 0.56, 0.9, 0.04, "#3A3028");
  b.box(x, H / 2, z - 0.05, 2.6, H, 2.4, K, "solid", 0.02);
  // güneydoğu köşesinde yarım daire şapel çıkıntısı (apsis; basamaklı yuvarlak), dar Norman pencereleri
  for (const [w, d, dz] of [[0.9, 0.3, 1.3], [0.66, 0.2, 1.52]] as const) b.box(x + 0.62, H * 0.42, z - 0.05 + dz, w, H * 0.84, d, K, "solid", 0.02);
  for (const u of [0.42, 0.82]) b.box(x + u, H * 0.5, z + 1.63, 0.1, 0.4, 0.04, WIN_D);
  b.box(x, 1.2, z + 1.16, 2.62, 0.06, 0.04, KD);
  for (const y of [1.9, 2.95]) for (const u of [-0.75, 0, 0.75]) {
    b.box(x + u, y, z + 1.16, 0.22, 0.42, 0.04, WIN_D);
    b.box(x + u, y + 0.24, z + 1.16, 0.12, 0.08, 0.04, WIN_D);
  }
  for (const u of [-0.42, 0.42]) b.box(x + u, H / 2, z + 1.17, 0.1, H, 0.06, KD);
  for (let k = 0; k < 5; k++) {
    const u = -1.1 + k * 0.55;
    b.box(x + u, H + 0.12, z + 1.12, 0.26, 0.24, 0.16, K);
    b.box(x + u, H + 0.12, z - 1.22, 0.26, 0.24, 0.16, K);
  }
  for (const [sx, sz, round] of [[-1, -1, false], [1, -1, true], [-1, 1, false], [1, 1, false]] as const) {
    const px = x + sx * 1.22, pz = z - 0.05 + sz * 1.12;
    b.box(px, (H + 0.9) / 2, pz, 0.62, H + 0.9, 0.62, K, "solid", 0.02);
    if (round) b.box(px, (H + 0.7) / 2, pz, 0.74, H + 0.7, 0.44, K, "solid", 0.02);
    b.box(px, H + 0.5, pz + 0.32, 0.12, 0.3, 0.02, WIN_D);
    // soğan kubbecik (kurşun): boğaz → şişkin gövde → sivri uç (gerçekte 1530'larda eklenen soğan biçimli başlıklar)
    for (const [w, h, y] of [[0.48, 0.1, H + 0.95], [0.7, 0.18, H + 1.09], [0.66, 0.14, H + 1.25], [0.5, 0.12, H + 1.38], [0.3, 0.1, H + 1.49], [0.14, 0.1, H + 1.59]] as const) {
      b.box(px, y, pz, w, h, w, LEAD, "solid", 0.02);
    }
    b.box(px, H + 1.72, pz, 0.04, 0.34, 0.04, GOLD);
    b.box(px + 0.06, H + 1.8, pz, 0.12, 0.04, 0.02, GOLD);
  }
  for (let i = i0; i < i0 + 4; i++) for (let j = j0; j < j0 + 4; j++) b.block(i, j);
  b.zones.push({ kind: "landmark", tag: "keep", i0, j0, w: 4, d: 4 });
}

// ------------------------------------------------------------------ CITY-PASS-LON: sokak eşyası ve çay salonu
/** Kırmızı silindir posta kutusu (1×1; engeller): kara kaide, artı kesitli silindir gövde, kubbe başlık, ön yüzde koyu mektup
 * ağzı ve toplama levhası. Kraliyet monogramı, taç, yazı YOK ( "Sokak eşyası"). Korunan
 * kırmızı kabin biçimi bilerek YOK (FREE-MAP-IP,; yerine `infoKiosk`).*/
export function pillarBox(b: Builder, i: number, j: number, face: 1 | -1 = 1): void {
  const x = tx(i), z = tz(j), RED = "#C4302B";
  b.box(x, 0.04, z, 0.42, 0.08, 0.42, "#22262C");
  b.box(x, 0.5, z, 0.36, 0.84, 0.26, RED, "solid", 0.02);
  b.box(x, 0.5, z, 0.26, 0.84, 0.36, RED, "solid", 0.02);
  b.box(x, 0.95, z, 0.38, 0.06, 0.38, RED);
  b.box(x, 1.02, z, 0.3, 0.08, 0.3, RED);
  b.box(x, 1.09, z, 0.18, 0.06, 0.18, RED);
  b.box(x, 0.78, z + face * 0.185, 0.2, 0.035, 0.02, "#1A1C20"); // mektup ağzı
  b.box(x, 0.58, z + face * 0.185, 0.14, 0.1, 0.02, "#F2EEE4"); // toplama levhası (yazısız)
  b.block(i, j);
}

/** Çay salonu süsü (`cafe` mekânının çevresi; ikindi çayı ritüeli): masada üç katlı servis tabağı (kurabiye, sandviç, çörek),
 *  çaydanlık ve iki fincan; tezgâh yanlarında asma çiçek sepetleri ve dantel perdeli küçük vitrin. `ox, oz` mekân kökeni
 *  (tezgâh karosunun ortası), `fz` müşteri yönü (+1 / −1, z boyunca). Yalnız durağan gruplar. */
export function teaRoomDecor(b: Builder, ox: number, oz: number, fz: 1 | -1): void {
  const tz2 = oz + fz * 2, T = 0.78; // masa üstü (city/venues.ts H.scene.table)
  b.box(ox + 0.1, T + 0.21, tz2, 0.04, 0.42, 0.04, "#C9A44C"); // servis tabağı mili
  for (const [w, y, c] of [[0.32, T + 0.04, "#F2EEE4"], [0.26, T + 0.18, "#F2EEE4"], [0.2, T + 0.32, "#F2EEE4"]] as const) {
    b.box(ox + 0.1, y, tz2, w, 0.02, w, c);
  }
  for (const [dx, y, c] of [[0.0, T + 0.07, "#E8B76A"], [0.18, T + 0.07, "#F5D0D6"], [0.05, T + 0.21, "#F4E3B5"], [0.15, T + 0.35, "#C76B5A"]] as const) {
    b.box(ox + dx, y, tz2 + 0.04, 0.06, 0.04, 0.06, c);
  }
  b.box(ox - 0.22, T + 0.07, tz2 - 0.1, 0.16, 0.14, 0.14, "#F2EEE4", "solid", 0.04); // çaydanlık
  b.box(ox - 0.31, T + 0.09, tz2 - 0.1, 0.06, 0.03, 0.03, "#F2EEE4");
  for (const dz of [-0.28, 0.28]) b.box(ox - 0.05, T + 0.04, tz2 + dz, 0.08, 0.06, 0.08, "#E8EEF4"); // fincanlar
  // tezgâh yanlarında asma çiçek sepetleri (yan direklerde; city/venues.ts yan direk u = ±1,42)
  for (const u of [-1.42, 1.42]) {
    b.box(ox + u, 1.95, oz + fz * 0.35, 0.36, 0.22, 0.36, "#6B4A2E", "solid", 0.05);
    for (const [dx, c] of [[-0.1, "#E5484D"], [0.06, "#F2EEE4"], [0.14, "#A78BFA"]] as const) b.box(ox + u + dx, 1.86, oz + fz * 0.47, 0.12, 0.12, 0.12, c);
    b.box(ox + u, 1.8, oz + fz * 0.35, 0.4, 0.1, 0.4, "#3E8E3E", "solid", 0.12);
    b.box(ox + u, 2.1, oz + fz * 0.35, 0.04, 0.12, 0.04, "#22282E");
  }
}
