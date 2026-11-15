/**
 * Londra şehir haritası: **Büyük park**.
 *
 * Geniş çimen ve ağaçlık, ortasında uzun göl (taş köprüyle iki yakası bağlı; kuğular, kiralık kürek tekneleri), göl kıyısında
 * ahşap kayıkhane, sekizgen müzik köşkü, çizgili şezlonglar. Doğu ucunda neoklasik saray cephesi (yalnız dış görünüm: orta
 * revak, kabartmasız alınlık, balkon) ve demir korkuluklu ön avlu. Arma, taç, bayrak, muhafız ve anıt heykeli YOK.
*/
import type { Block } from "../../../scenes";
import { oct, sink, type DecorCtx, type DistrictDesign, type LandmarkCtx, type LandmarkModel } from "../../../citymap/design";
import { at, deckchair, L, lamp } from "./kit";
import { walkBenchAt } from "../../kit";

// ------------------------------------------------------------------------------------------ saray (6 × 14, h 5,4; cephe doğuya)
function saray(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, d } = c, X = c.cx, Z = c.cz, P = L.portland, PD = L.portlandD, fx = x0 + c.w;
  b(X, 2.2, Z, 6, 4.4, d, P, "solid", 0.02);
  b(X, 4.55, Z, 6.1, 0.3, d + 0.1, PD);
  b(X, 4.85, Z, 5.4, 0.3, d - 0.8, "#7F8A94", "solid", 0.02);
  // orta revak (doğuya çıkıntılı): altı sütun, alınlık (kabartmasız), balkon
  b(fx + 0.25, 2.4, Z, 0.5, 4.8, 5, P, "solid", 0.02);
  for (let q = 0; q < 6; q++) b(fx + 0.6, 1.9, Z - 2.0 + q * 0.8, 0.26, 3.4, 0.26, "#F4F1EA");
  b(fx + 0.55, 3.75, Z, 0.5, 0.3, 4.8, PD);
  b(fx + 0.45, 4.95, Z, 0.5, 0.5, 4.2, P, "solid", 0.02);
  b(fx + 0.45, 5.25, Z, 0.4, 0.1, 2.6, PD);
  b(fx + 0.85, 2.9, Z, 0.3, 0.1, 1.8, PD);
  // uç pavyonlar ve doğu cephesi pencereleri (iki kat)
  for (const s of [-1, 1]) b(fx + 0.15, 2.3, Z + s * 6, 0.3, 4.6, 2, P, "solid", 0.02);
  for (let q = 0; q < 12; q++) {
    const z = c.z0 + 0.7 + q * 1.15;
    if (Math.abs(z - Z) < 2.6) continue;
    for (const y of [1.4, 3.0]) b(fx + 0.02, y, z, 0.04, 0.9, 0.4, L.winD, "solid", 0);
  }
  return out;
}

// ------------------------------------------------------------------------------------------ müzik köşkü (3 × 3, h 3,4)
function muzikKosku(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz, G = "#2E4A3A";
  oct(b, X, 0.3, Z, 2.8, 0.6, "#C9BFAE");
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; b(X + Math.cos(a) * 1.15, 1.5, Z + Math.sin(a) * 1.15, 0.12, 1.8, 0.12, G, "solid", 0); }
  b(X, 1.0, Z, 2.4, 0.08, 2.4, G, "solid", 0);
  oct(b, X, 2.5, Z, 3.0, 0.2, G);
  oct(b, X, 2.8, Z, 2.2, 0.4, "#C27A4E");
  oct(b, X, 3.15, Z, 1.0, 0.3, "#C27A4E");
  return out;
}

// ------------------------------------------------------------------------------------------ kayıkhane (4 × 2, h 2,6; göle bakar, güneye)
function kayikhane(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz, W = "#8B6A47";
  b(X, 0.9, Z + 0.2, 4, 1.8, 1.6, "#EDE3CF", "solid", 0.03);
  b(X, 2.0, Z, 4.3, 0.3, 2.2, "#3F6B4E", "solid", 0.02);
  b(X, 2.35, Z, 3.4, 0.4, 1.4, "#3F6B4E", "solid", 0.02);
  for (const dx of [-1.2, 0, 1.2]) b(X + dx, 1.0, c.z0 + 0.38, 0.7, 0.9, 0.04, L.winD, "solid", 0); // CITY-PASS-LON: cepheye yapışık (eskiden 0,4 önde havada)
  b(X, 0.05, c.z0 - 0.9, 3.6, 0.1, 1.2, W, "solid", 0.04);
  return out;
}

const boxFar = (color: string) => (c: LandmarkCtx): Block[] => [{ p: [c.cx, c.h / 2, c.cz], s: [c.w, c.h, c.d], c: color, g: "solid", j: 0 }];

export const PARK_LANDMARKS: Record<string, LandmarkModel> = {
  saray: { near: saray, far: boxFar(L.portland), ip_risk: 1, culture_risk: 0,
    note: "Genel neoklasik saray cephesi (ofis tabanındaki saray cephesiyle aynı yaklaşım; birebir kopya değil): Portland taşı, altı sütunlu orta revak, kabartmasız alınlık, balkon; yalnız dış görünüm. Kraliyet arması, taç, bayrak, muhafız ve anıt heykeli yok." },
  muzik_kosku: { near: muzikKosku, far: boxFar("#2E4A3A"), ip_risk: 0, culture_risk: 0,
    note: "Sekizgen müzik köşkü: taş kaide, yeşil döküm direkler, bakır renkli çatı; müzisyen figürü yok." },
  kayikhane: { near: kayikhane, far: boxFar("#EDE3CF"), ip_risk: 0, culture_risk: 0,
    note: "Göl kıyısında ahşap kayıkhane ve iskele, kiralık kürek tekneleri; işletme adı ve fiyat tabelası yok." },
};

// ------------------------------------------------------------------------------------------ semt süsleri
function parkDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out), p = at(c);
  // göl köprüsü korkulukları, göldeki kürek tekneleri ve kuğular
  for (const s of [0.06, 1.94]) b(c.ox + 30 + s, 0.35, c.oz + 21, 0.12, 0.7, 8, "#C9BFAE", "solid", 0.03);
  for (const [li, lj, col] of [[16, 20, "#2E4A7A"], [36, 22, "#8C2F39"], [12, 22, "#2E6B4F"]] as const) {
    b(p.x(li), -0.12, p.z(lj), 0.7, 0.24, 1.5, col, "solid", 0.02);
    b(p.x(li), 0.02, p.z(lj), 0.5, 0.06, 1.2, "#C9A066", "solid", 0);
  }
  for (const [li, lj] of [[20, 19], [26, 21], [34, 19]] as const) { b(p.x(li), -0.1, p.z(lj), 0.3, 0.2, 0.5, "#F5F5F4", "solid", 0); b(p.x(li), 0.12, p.z(lj) + 0.22, 0.08, 0.3, 0.08, "#F5F5F4", "solid", 0); }
  // şezlonglar (göl kıyısı), fenerler (yollar boyunca)
  for (const [li, lj, col] of [[14, 16, "#2E6B4F"], [16, 16, "#F2EEE4"], [36, 25, "#2E6B4F"], [38, 25, "#F2EEE4"]] as const) deckchair(b, p.x(li), p.z(lj), col);
  for (let li = 6; li <= 54; li += 8) lamp(b, p.x(li), p.z(12) - 0.4);
  // ön avlu: demir korkuluk (kapı aralıklı) ve yaldız tepeli kapı direkleri, yuvarlak havuz
  for (const [a, e] of [[24, 30], [34, 42]] as const) b(c.ox + 54.5, 0.6, c.oz + (a + e) / 2, 0.08, 1.2, e - a, "#1F2226", "solid", 0);
  for (const z of [30, 34]) { b(c.ox + 54.5, 0.9, c.oz + z, 0.3, 1.8, 0.3, "#1F2226", "solid", 0); b(c.ox + 54.5, 1.9, c.oz + z, 0.2, 0.2, 0.2, L.gold, "solid", 0); }
  b(p.x(57), 0.2, p.z(32), 2.2, 0.4, 2.2, "#C9BFAE", "solid", 0.02); b(p.x(57), 0.42, p.z(32), 1.9, 0.06, 1.9, "#5E9DB8", "water", 0);
  // gizli köşeler: ağaç dibinde sincap ve fındık; kuzeydoğu çitinde kuş yemliği
  b(p.x(3) + 0.3, 0.12, p.z(45), 0.16, 0.24, 0.3, "#9C6B3E", "solid", 0); b(p.x(3) + 0.3, 0.3, p.z(45) - 0.18, 0.1, 0.2, 0.1, "#9C6B3E", "solid", 0);
  b(p.x(56) + 0.38, 0.6, p.z(46), 0.06, 1.2, 0.06, "#6B4A2E", "solid", 0); b(p.x(56) + 0.38, 1.25, p.z(46), 0.4, 0.1, 0.4, "#C9A27C");
  return out;
}

// ------------------------------------------------------------------------------------------ kuzey bahçe (yeni, lj 48–63)
/** Uzun süs göleti (semt yerel) ve kuzeyindeki fıskiyeli teras. */
const LONG: [number, number, number, number] = [14, 52, 26, 4];

function northGardenDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out), p = at(c);
  const ST = "#B8B2A6";
  // göletin taş kenarı (kuzey ve güney uzun kenar)
  const [g0, h0, gw, gd] = LONG;
  for (const z of [c.oz + h0 - 0.06, c.oz + h0 + gd + 0.06]) b(c.ox + g0 + gw / 2, 0.15, z, gw, 0.3, 0.12, ST, "solid", 0.02);
  // fıskiyeli teras: dört taş havuz, ortasında fıskiye
  for (let k = 0; k < 4; k++) {
    const x = p.x(g0 + 3 + k * 6.5), z = p.z(h0 + gd + 3);
    b(x, 0.2, z, 2.2, 0.4, 2.2, ST, "solid", 0.02);
    b(x, 0.42, z, 1.9, 0.06, 1.9, "#5E9DB8", "water", 0);
    b(x, 0.85, z, 0.12, 0.9, 0.12, "#DCEBF4", "solid", 0);
  }
  // çiçek tarhları, banklar ve fenerler (göletin güney yolu)
  const BEDS = ["#C8553D", "#E6A0B5", "#F2C14E", "#9C7BC4"];
  for (let k = 0; k < 6; k++) b(p.x(6 + k * 9), 0.2, p.z(h0 - 2), 2.4, 0.4, 1.0, BEDS[k % BEDS.length], "solid", 0.08);
  for (let li = 10; li <= 46; li += 9) { walkBenchAt(b, p.x(li), p.z(h0 - 1), "+z", 1.4, "#2E4A3A", L.iron); lamp(b, p.x(li + 2), p.z(h0 - 1)); }
  // göletin batı ucunda küçük sütunlu taş köşk (düz çatı)
  const kx = p.x(g0 - 4), kz = p.z(h0 + 2);
  for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]] as const) b(kx + dx, 1.1, kz + dz, 0.22, 2.2, 0.22, "#E8E2D6", "solid", 0.02);
  b(kx, 2.3, kz, 2.4, 0.2, 2.4, "#CFC7B8", "solid", 0.02);
  return out;
}

/**
 * Büyük park (60 × 64; şehir karosu [−108, 32]). kuzey bahçe (yeni, lj 48–63): uzun süs göleti li 14–39 × lj 52–55, kuzeyinde
 * fıskiyeli teras (dört havuz), çiçek tarhları, banklar, batı ucunda sütunlu köşk. Yalnız süs: yeni landmark/kimlik yok. Göl li 10–39 × lj 18–23 (taş köprü li 30–31), kayıkhane [22, 24], müzik köşkü
 * [44, 6], saray [46, 26] (6 × 14, cephe doğuya), ön avlu li 53–59. Otobüs durağı (park köşesi) [58, 4].
*/
export const PARK_DESIGN: DistrictDesign = {
  water: [[10, 18, 30, 6], LONG],
  plaza: [[2, 12, 56, 2], [30, 14, 2, 11], [53, 24, 7, 18],
    // fıskiyeli teras ve köşk meydanı
    [LONG[0] - 2, LONG[1] + LONG[3] + 1, LONG[2] + 4, 5], [LONG[0] - 6, LONG[1] - 1, 4, 6]],
  park: [[2, 2, 56, 10], [2, 14, 56, 4], [2, 18, 8, 6], [40, 18, 18, 6], [2, 24, 40, 22], [42, 24, 11, 22],
    // kuzey bahçe: göletin çevresinde çimen (gölet dikdörtgeni boş kalır; park suyu ezer)
    [2, 48, 56, 4], [2, 52, 12, 4], [40, 52, 18, 4], [2, 56, 56, 6]],
  hidden: [[3, 45], [56, 46]],
  decor: (c) => [...parkDecor(c), ...northGardenDecor(c)],
};
