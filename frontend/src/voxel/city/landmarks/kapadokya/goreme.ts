/**
 * Kapadokya şehir haritası: **Göreme** (ücretsiz başlangıç semti) landmarkları ve semt tasarımı.
 *
 * Kasaba meydanı (otogar; ofis tabanındaki Kapadokya kapısı buraya açılır), ana caddenin iki yanında oyma kaya evleri, kasabanın
 * ortasında peri bacası kümesi, kuzeyde küçük mağara oteli (HOTEL-SYS: şehrin tek oteli), güneydoğuda kaya kiliseleri (açık hava müzesini andırır; yalnız dış
 * oyma cephe, `sacred`: iç mekân kapalı, haç/ikon/fresk yok), batıda kilim atölyesi. Yazı, tabela, marka yok.
 *
 * CITY-PASS-KAP (kalite seferberliği; kaynaklar): peri bacaları yedi kademeli erozyon bantlı
 * koniler + iki katlı bazalt şapka, oyma oda kapıları (ahşap kanat, beyaz söve), birinde ahşap balkon ve kayaya oyulmuş basamak;
 * mağara oteli tek katlı küçük tüf cephe (HOTEL-SYS E1; eski üç teraslı otel simgelerden büyüktü); kaya kiliseleri geride kaya kütlesi ve koniler, solda çok katlı manastır kütlesi, önde at nalı kemerli
 * kapılar, kör kemerler, plastırlar, kademeli alınlık ve üst kattaki kapıya metal ziyaretçi merdiveni; kilim atölyesi askıya asılı
 * kilimler, katlanmış kilim yığınları, dokuma tezgâhı ve direkli saçak (her parça bağlı).
*/
import type { Block } from "../../../scenes";
import { sink, type DecorCtx, type DistrictDesign, type LandmarkCtx, type LandmarkModel, type Sink } from "../../../citymap/design";
import { at, boxFar, CAP, chimney, cone, hangLantern, HOLE, holeZ, KAP } from "./kit";
import { genFar } from "./farLod.gen";

const WOODC = "#6B4A2E", DOOR = "#6B4228", LIT = "#FFC978";

/**
 * Oyma peri bacası (kit `chimney` + yüzü −z oyma kapı ve pencereler). `rooms` 0: yalnız kaya, 1: kapı, 2+: kapı + kat pencereleri
 * (ahşap kanat, beyaz söve; `lit` true olanlar gece yanar). Kademe yüzleri kit chimney oranlarıyla (1, 0,82, 0,68 …).
 */
function carvedChimney(b: Sink, x: number, z: number, h: number, w: number, tone: string, y0: number, rooms: number, lit = false) {
  chimney(b, x, z, h, w, tone, CAP, y0);
  if (rooms < 1) return;
  const zf0 = z - w / 2 - 0.01;
  holeZ(b, x - w * 0.12, y0 + 0.55, zf0, 0.42, 1.0, KAP.trim);
  b(x - w * 0.12, y0 + 0.5, zf0 - 0.04, 0.34, 0.9, 0.03, DOOR, "solid", 0);
  if (rooms < 2) return;
  const T = [[1, 0.24], [0.82, 0.18], [0.68, 0.17], [0.56, 0.15]] as const;
  let y = y0;
  T.forEach(([f, hf], k) => {
    const yy = y + (h * hf) / 2;
    y += h * hf;
    if (k === 0 || k > rooms) return;
    const zf = z - (w * f) / 2 - 0.01;
    holeZ(b, x + (k % 2 ? 0.14 : -0.12) * w, yy, zf, 0.26, 0.34, KAP.trim);
    if (lit && k === 1) b(x + 0.14 * w, yy, zf - 0.04, 0.22, 0.28, 0.02, LIT, "glow", 0);
  });
}

// ------------------------------------------------------------------------------------------ peri bacası kümesi (6 × 6)
function periBacalari(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0 } = c;
  // TOUR-VIEW (LANDMARK-GARDEN-001): bacalar kendi alçak tüf topuklarında, aralarında yürünür tüf patika (orta sıra ve kenarlar):
  // ziyaretçi bacaların arasından geçer. Farklı boy ve tonda bacalar; üçünde oyma oda (kapı, pencere)
  b(c.cx, 0.03, c.cz, c.w, 0.06, c.d, KAP.cream, "solid", 0.05);
  const set: [number, number, number, number, string, number, number, boolean][] = [
    [1.3, 1.35, 7.4, 1.5, KAP.tuff, 0.3, 2, true], [3.2, 1.25, 9.2, 1.7, KAP.honey, 0.3, 3, false], [5.0, 1.5, 6.2, 1.3, KAP.cream, 0.3, 0, false],
    [1.5, 4.75, 5.6, 1.3, KAP.honey, 0.3, 0, false], [3.5, 4.8, 8.0, 1.5, KAP.tuff, 0.4, 1, false], [5.2, 4.9, 5.0, 1.1, KAP.rose, 0.4, 0, false],
  ];
  for (const [dx, dz, , w, , y0] of set) b(x0 + dx, y0 / 2, z0 + dz, w + 0.25, y0, w + 0.25, KAP.tuff, "solid", 0.05); // topuk
  for (const [dx, dz, h, w, tone, y0, rooms, lit] of set) carvedChimney(b, x0 + dx, z0 + dz, h, w, tone, y0, rooms, lit);
  // en büyük bacada ahşap balkon (konsollara oturur)
  const by = 0.3 + 9.2 * 0.24, bx = x0 + 3.2, bz = z0 + 1.25 - 1.7 * 0.82 / 2;
  b(bx + 0.25, by + 0.05, bz - 0.25, 1.0, 0.08, 0.5, WOODC, "solid", 0.02);
  for (const dx of [-0.2, 0.7]) b(bx + dx, by - 0.12, bz - 0.06, 0.08, 0.28, 0.12, WOODC, "solid", 0);
  b(bx + 0.25, by + 0.32, bz - 0.48, 1.0, 0.05, 0.04, WOODC, "solid", 0);
  for (const dx of [-0.22, 0.25, 0.72]) b(bx + dx, by + 0.2, bz - 0.48, 0.04, 0.3, 0.04, WOODC, "solid", 0);
  return out;
}

// ------------------------------------------------------------------------------------------ mağara oteli (4 × 3; HOTEL-SYS)
/** HOTEL-SYS (E1): şehrin TEK otelinin haritadaki görünümü (taban sahnedeki küçük mağara oteliyle aynı otel — districts/hotel.ts
 *  `mapLandmark`). Eski 12 × 6, 8 yüksekliğinde teraslı otel kaldırıldı (simgelerden büyüktü): şimdi tek katlı küçük tüf cephe —
 *  yuvarlatılmış kaya kütlesi, kemerli ahşap kapı, iki kemerli pencere (gece yanar), kapı fenerleri, önde taş döşeme ve sardunya
 *  saksıları. Yükseklik 2,4 (HOTEL-SCALE-001 alt sınırı). İşletme adı ve tabela yok. Cephe −z (z0) yüzünde. */
function magaraOtel(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, w, d } = c, X = c.cx, zf = z0 + 0.6;
  // kaya kütlesi ve yuvarlatılmış tepe kademeleri (en üst 2,4)
  b(X, 1.05, zf + (d - 0.6) / 2, w, 2.1, d - 0.6, KAP.tuff, "solid", 0.05);
  b(X, 2.2, zf + (d - 0.6) / 2 + 0.1, w - 0.6, 0.2, d - 1.0, KAP.honey, "solid", 0.05);
  b(X, 2.34, zf + (d - 0.6) / 2 + 0.2, w - 1.6, 0.12, d - 1.6, KAP.cream, "solid", 0.05);
  // kemerli kapı (söve + kanat) ve iki yanında fener
  b(X, 1.0, zf - 0.02, 1.0, 2.0, 0.04, KAP.trim, "solid", 0);
  b(X, 2.02, zf - 0.02, 0.6, 0.1, 0.04, KAP.trim, "solid", 0);
  b(X, 0.95, zf - 0.05, 0.8, 1.9, 0.03, DOOR, "solid", 0);
  for (const s of [-1, 1]) hangLantern(b, X + s * 0.75, 1.75, zf - 0.08, 0.9);
  // kemerli pencereler (ahşap çerçeve, gece yanar)
  for (const s of [-1, 1]) {
    const x = X + s * (w / 2 - 0.6);
    b(x, 1.2, zf - 0.02, 0.6, 0.7, 0.04, DOOR, "solid", 0);
    b(x, 1.2, zf - 0.04, 0.46, 0.56, 0.03, "#4A3A30", "glass", 0);
    b(x, 1.2, zf - 0.06, 0.36, 0.42, 0.02, LIT, "glow", 0);
    b(x, 1.6, zf - 0.02, 0.4, 0.1, 0.04, KAP.trim, "solid", 0);
  }
  // önde taş döşeme ve saksılı sardunyalar
  b(X, 0.04, z0 + 0.3, w - 0.2, 0.08, 0.6, "#C8AE90", "solid", 0.03);
  for (const s of [-1, 1]) {
    const px = X + s * (w / 2 - 0.3);
    b(px, 0.27, z0 + 0.3, 0.4, 0.38, 0.36, "#B5603F", "solid", 0.03);
    b(px, 0.53, z0 + 0.3, 0.36, 0.16, 0.32, "#5E7E4A", "solid", 0.1);
    b(px, 0.64, z0 + 0.3, 0.12, 0.06, 0.12, "#E5484D", "solid", 0);
  }
  void x0;
  return out;
}
function otelFar(c: LandmarkCtx): Block[] {
  return [
    { p: [c.cx, 1.05, c.z0 + 0.6 + (c.d - 0.6) / 2], s: [c.w, 2.1, c.d - 0.6], c: KAP.tuff, g: "solid", j: 0 },
    { p: [c.cx, 2.25, c.z0 + 0.6 + (c.d - 0.6) / 2 + 0.1], s: [c.w - 0.6, 0.3, c.d - 1.0], c: KAP.honey, g: "solid", j: 0 },
  ];
}

// ------------------------------------------------------------------------------------------ kaya kiliseleri (9 × 6; yalnız dış)
/** At nalı kemer (yüz −z; düzlem zf): gövde + kademeli yay; `frame` söve. */
function archZ(b: Sink, x: number, y0: number, zf: number, w: number, h: number, c: string, frame?: string) {
  const r = w / 2;
  if (frame) {
    b(x, y0 + (h - r) / 2, zf + 0.005, w + 0.14, h - r, 0.03, frame, "solid", 0);
    for (const [ww, yy] of [[w + 0.14, 0], [w * 0.84 + 0.12, 0.33], [w * 0.5 + 0.1, 0.66]] as const) b(x, y0 + h - r + yy * r + r * 0.17, zf + 0.005, ww, r * 0.34 + 0.06, 0.03, frame, "solid", 0);
  }
  b(x, y0 + (h - r) / 2, zf - 0.01, w, h - r, 0.035, c, "solid", 0);
  for (const [ww, yy] of [[w, 0], [w * 0.84, 0.33], [w * 0.5, 0.66]] as const) b(x, y0 + h - r + yy * r + r * 0.17, zf - 0.01, ww, r * 0.34, 0.035, c, "solid", 0);
}
function kayaKiliseleri(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, w, d } = c, X = c.cx;
  // arkada pembe tüf kayalık ve iki oyma koni; solda çok katlı manastır kütlesi; önde oyma cephe. Haç, ikon, fresk, yazı YOK.
  b(X, 2.6, z0 + d - 1.5, w, 5.2, 3.0, KAP.church, "solid", 0.06);
  b(X + 1, 5.6, z0 + d - 1.6, w - 3, 0.8, 2.4, KAP.church2, "solid", 0.06);
  cone(b, x0 + w - 1.4, z0 + 2.2, 5.6, 2.0, KAP.church2, 2);
  // manastır kütlesi (6 kat; ön ve batı yüzünde kat kat pencere/kapı, kat silmeleri)
  const mx = x0 + 1.2, mz = z0 + d - 2.4, MH = 6.8;
  b(mx, MH / 2, mz, 2.2, MH, 2.6, KAP.church, "solid", 0.05);
  b(mx + 0.1, MH + 0.3, mz + 0.2, 1.6, 0.6, 1.8, KAP.church, "solid", 0.05);
  for (let f = 0; f < 6; f++) {
    const yy = 0.6 + f * 1.05;
    b(mx, yy + 0.42, mz - 1.31, 2.2, 0.06, 0.04, KAP.church2, "solid", 0);
    archZ(b, mx + (f % 2 ? 0.45 : -0.35), yy - 0.05, mz - 1.3, 0.3, 0.42, HOLE);
    if (f % 2 === 0) archZ(b, mx + 0.5, yy, mz - 1.3, 0.22, 0.32, HOLE);
    b(mx - 1.11, yy + 0.1, mz + (f % 2 ? 0.5 : -0.4), 0.04, 0.32, 0.26, HOLE, "solid", 0);
  }
  // oyma cephe (ön yüz zf; kayaya yapışık)
  const zr = z0 + d - 3.0, zf = zr - 0.3; // kaya yüzü ve öne taşan oyma cephe yüzü
  b(X + 0.4, 2.0, zr - 0.15, 4.8, 4.0, 0.3, KAP.church2, "solid", 0.03);
  for (let k = 0; k < 3; k++) b(X + 0.4, 4.14 + k * 0.28, zr - 0.15, 4.4 - k * 1.3, 0.28, 0.3, KAP.church, "solid", 0.03); // alınlık
  b(X + 0.4, 3.0, zf - 0.03, 4.8, 0.1, 0.06, KAP.trim, "solid", 0); // silme
  for (const s of [-2.3, -0.75, 0.75, 2.3]) {
    b(X + 0.4 + s, 1.4, zf - 0.03, 0.16, 2.6, 0.06, KAP.trim, "solid", 0); // plastır
    b(X + 0.4 + s, 2.72, zf - 0.04, 0.26, 0.12, 0.08, KAP.trim, "solid", 0); // başlık
  }
  for (const s of [-1.5, 1.5]) archZ(b, X + 0.4 + s, 0, zf, 0.7, 1.9, HOLE, KAP.church); // at nalı kemerli kapılar
  archZ(b, X + 0.4, 1.0, zf, 0.5, 1.3, KAP.church); // kör kemer
  for (const s of [-1.5, 0, 1.5]) b(X + 0.4 + s, 3.55, zf - 0.02, 0.24, 0.36, 0.04, HOLE, "solid", 0);
  // üst kattaki kiliseye metal ziyaretçi merdiveni (sağ konide; rıhtlı basamaklar, korkuluk, sahanlık)
  const sx = x0 + w - 2.3, mzf = z0 + 2.2 - 1.0, run = 0.32, rise = 5.6 * 0.34 / 6, n = 6;
  for (let k = 0; k < n; k++) {
    const x = sx + (k + 0.5) * run, ty = (k + 1) * rise;
    b(x, ty - 0.03, mzf - 0.3, run, 0.06, 0.6, KAP.metal, "solid", 0);
    b(x - run / 2 + 0.02, ty - rise / 2 - 0.01, mzf - 0.3, 0.04, rise + 0.05, 0.6, KAP.metal, "solid", 0);
    b(x, ty + 0.4, mzf - 0.58, 0.04, 0.8, 0.04, KAP.metal, "solid", 0);
    b(x, ty + 0.78, mzf - 0.58, run + 0.02, 0.04, 0.04, KAP.metal, "solid", 0);
  }
  archZ(b, x0 + w - 1.1, n * rise, z0 + 2.2 - 2.0 * 0.78 / 2, 0.4, 0.9, HOLE, KAP.church); // kademe üstündeki kilise kapısı
  // avlu: basamaklı patika ve alçak taş sınır
  b(X, 0.12, z0 + 0.6, w - 1, 0.24, 0.5, "#C8AE90", "solid", 0.04);
  return out;
}

// ------------------------------------------------------------------------------------------ kilim atölyesi (6 × 4)
function kilim(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, w, d } = c, X = c.cx, Z = c.cz;
  // kesme taş dükkân (yüzü −z): kemerli kapı, pencere, direkli saçak (duvara ve direklere bağlı)
  b(X, 1.3, Z + 0.4, w, 2.6, d - 0.8, "#E3BFA0", "solid", 0.05);
  b(X, 2.7, Z + 0.4, w + 0.2, 0.2, d - 0.6, "#C9A27E", "solid", 0.03);
  const fz = Z + 0.4 - (d - 0.8) / 2;
  archZ(b, X + 1.4, 0, fz, 0.8, 1.7, DOOR, KAP.trim);
  b(X - 1.6, 1.5, fz - 0.02, 0.7, 0.6, 0.04, "#4A3A30", "glass", 0);
  b(X, 2.05, z0 + 0.55, w, 0.08, 1.0, WOODC, "solid", 0.02); // saçak
  for (const dx of [-w / 2 + 0.1, w / 2 - 0.1]) b(X + dx, 1.0, z0 + 0.1, 0.08, 2.0, 0.08, WOODC, "solid", 0);
  b(X, 1.96, z0 + 0.1, w, 0.1, 0.1, WOODC, "solid", 0); // askı kirişi (direklere oturur)
  // askıda kilimler (kirişe yapışık; geometrik renk kuşakları, soyut)
  const K = [["#B9574A", "#F2E6D0", "#2F4A6E"], ["#3F7D6E", "#D9A441", "#B9574A"], ["#7A5C99", "#F2E6D0", "#D9A441"]];
  K.forEach((cols, q) => {
    const x = x0 + 1.0 + q * 2.0;
    b(x, 1.32, z0 + 0.1, 1.3, 1.2, 0.03, cols[0], "solid", 0);
    b(x, 1.32, z0 + 0.08, 1.0, 0.36, 0.02, cols[1], "solid", 0);
    b(x, 1.32, z0 + 0.07, 0.4, 0.18, 0.02, cols[2], "solid", 0);
    for (const dx of [-0.5, -0.17, 0.17, 0.5]) b(x + dx, 0.68, z0 + 0.1, 0.05, 0.1, 0.02, cols[0], "solid", 0); // püskül
  });
  // katlanmış kilim yığınları (alçak sekide) ve dokuma tezgâhı (saçak altında)
  b(x0 + w - 0.8, 0.2, z0 + 0.75, 1.0, 0.4, 0.6, "#8B6A47", "solid", 0.03);
  for (let k = 0; k < 5; k++) b(x0 + w - 0.8, 0.44 + k * 0.08, z0 + 0.75, 0.82, 0.08, 0.5, ["#B9574A", "#3F7D6E", "#D9A441", "#2F4A6E", "#F2E6D0"][k], "solid", 0);
  const lz = z0 + 0.55;
  for (const dx of [-0.5, 0.5]) b(x0 + 1.6 + dx, 0.85, lz, 0.08, 1.7, 0.1, WOODC, "solid", 0);
  b(x0 + 1.6, 1.65, lz, 1.1, 0.08, 0.12, WOODC, "solid", 0);
  b(x0 + 1.6, 0.3, lz, 1.1, 0.08, 0.12, WOODC, "solid", 0);
  b(x0 + 1.6, 0.98, lz, 0.9, 1.25, 0.03, "#F2E6D0", "solid", 0);
  b(x0 + 1.6, 0.7, lz - 0.02, 0.9, 0.6, 0.02, "#B9574A", "solid", 0);
  return out;
}

export const GOREME_LANDMARKS: Record<string, LandmarkModel> = {
  peri_bacalari: { garden: { kind: "grounds", rects: [[0, 0, 6, 6]], gates: [], floor: "plaza" }, near: periBacalari, far: (c) => [{ p: [c.cx, 4, c.cz], s: [c.w - 1, 8, c.d - 1], c: KAP.tuff, g: "solid", j: 0 }, { p: [c.cx, 9.2, c.cz], s: [2, 0.5, 2], c: CAP, g: "solid", j: 0 }],
    ip_risk: 0, culture_risk: 0, note: "Peri bacası kümesi: doğal jeolojik oluşum; erozyon bantlı tüf koniler ve iki katlı bazalt şapkalar, oyma oda kapıları ve pencereler, ahşap balkon. Kasaba içindeki bacaları andırır." },
  magara_otel: { near: magaraOtel, far: otelFar, ip_risk: 0, culture_risk: 0,
    note: "HOTEL-SYS: şehrin tek otelinin haritadaki küçük tüf cephesi (tek kat, kemerli kapı ve pencereler, fenerler); işletme adı ve tabela yok." },
  kaya_kiliseleri: { near: kayaKiliseleri, far: genFar("kaya_kiliseleri"), ip_risk: 0, culture_risk: 1, sacred: true, // uzak LOD Blender'dan (farLod.gen.ts)
    note: "Kaya kiliseleri (açık hava müzesini andırır): yalnız oyma dış cephe (at nalı kemerler, plastırlar), çok katlı manastır kütlesi, ziyaretçi merdiveni; haç, ikon, fresk, yazı yok, iç mekân kapalı; kutsal bölge (emote/mini oyun yok)." },
  hali_atolyesi: { near: kilim, far: boxFar("#E3BFA0", 0.9), ip_risk: 0, culture_risk: 0,
    note: "Kilim atölyesi: saçak altında askıda geometrik renk kuşaklı kilimler (soyut; gerçek bir motif kopyası değil), katlanmış kilim yığınları, dokuma tezgâhı; marka yok." },
};

// ------------------------------------------------------------------------------------------ semt tasarımı
function goremeDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out), p = at(c);
  // kasaba sokaklarındaki tek bacalar ve oyma konik evler (katı karolarda)
  for (const [li, lj, h, w] of [[11, 40, 6.4, 1.5], [44, 38, 7.2, 1.7], [44, 16, 5.6, 1.4], [1, 6, 5.0, 1.3]] as const) chimney(b, p.x(li), p.z(lj), h, w, KAP.tuff);
  for (const [li, lj] of [[8, 40], [46, 30]] as const) cone(b, p.x(li), p.z(lj), 4.6, 2.0, KAP.honey, 2);
  // ana cadde: çay bahçesi masaları (ayaklı), kilim sergisi, direkli tente (dört direğe oturur)
  for (const li of [26, 29, 32]) { b(p.x(li), 0.42, p.z(20), 0.7, 0.05, 0.7, "#8B6A47"); b(p.x(li), 0.2, p.z(20), 0.08, 0.4, 0.08, "#3F3A33"); b(p.x(li), 0.015, p.z(20), 0.4, 0.03, 0.4, "#3F3A33"); }
  const ax0 = p.x(29) - 3.75, ax1 = p.x(29) + 3.75;
  for (const x of [ax0, ax1]) for (const dz of [-0.75, 0.75]) b(x, 0.88, p.z(20) + dz, 0.08, 1.76, 0.08, "#4A3A2E");
  b(p.x(29), 1.8, p.z(20), 7.6, 0.08, 1.6, "#3F7D6E", "solid", 0.02);
  // gizli köşeler: eski şarap işliği oyuğu (kaya kenarında) ve kapı eşiğinde kedi minderi
  b(p.x(2) - 0.3, 0.3, p.z(2) + 0.1, 0.2, 0.6, 0.6, "#9C7E62"); b(p.x(2) - 0.15, 0.2, p.z(2) + 0.1, 0.1, 0.3, 0.5, HOLE);
  b(p.x(46), 0.03, p.z(46), 0.5, 0.06, 0.5, "#B9574A"); b(p.x(46), 0.16, p.z(46), 0.3, 0.2, 0.22, "#E8C9A0");
  return out;
}

/**
 * Göreme (48 × 48; şehir karosu [12, −16]). Ofisin varış meydanı batıda (li < 0): giriş (0, 23). Ana cadde lj 21–24 boyunca;
 * otogar durağı (3, 20); peri bacası kümesi [14, 28], mağara oteli [24, 36], kaya kiliseleri [36, 4], kilim atölyesi [8, 10].
 * Güney kenar (lj 0) balon alanına, batı kenar vadilere yürünür patikadır.
 */
export const GOREME_DESIGN: DistrictDesign = {
  pave: [[0, 21, 48, 3], [22, 0, 3, 21], [5, 24, 2, 24]],
  plaza: [[0, 16, 10, 5], [26, 14, 10, 6]],
  // CITY-POLISH: otogar yolundaki baca [1, 6] (minibüs li 3'ten geçer; eskiden [3, 6] yolun üstündeydi)
  solid: [[10, 39, 3, 3], [43, 37, 3, 3], [43, 15, 3, 3], [0, 5, 2, 3], [7, 39, 3, 3], [45, 29, 3, 3]],
  buildings: [
    { i0: 26, j0: 25, w: 5, d: 4, h: 2.4, wall: "#E8CFA8", roof: "#C9A27E" }, { i0: 32, j0: 25, w: 6, d: 4, h: 3.6, wall: "#E3BFA0", roof: "#C9A27E" },
    { i0: 39, j0: 25, w: 5, d: 4, h: 2.2, wall: "#EAD7B8", roof: "#BFA184" }, { i0: 12, j0: 14, w: 6, d: 4, h: 2.6, wall: "#D9B08E", roof: "#C9A27E" },
    { i0: 38, j0: 14, w: 6, d: 5, h: 3.0, wall: "#E9C9B4", roof: "#C9A27E" },
  ],
  hidden: [[2, 2], [46, 46]],
  decor: goremeDecor,
};
