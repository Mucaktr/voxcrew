/**
 * LANDMARK-HIRES (I2, HIRES-KAP) — Kapadokya simgelerinin yüksek çözünürlük kurucuları (
 *). Yalnız `hires/kit.ts`, `hires/types.ts` ve `citymap/design.ts` içe aktarılır.
 *
 * - `uchisar_kalesi`: TEK aşınmış kaya dorugu (Uçhisar'ı andırır). Kademe yok: 40 ince (≈ 0,5) yatay dilim; geniş moloz/köy
 * eteğinden dike yakın kaya "kale" gövdesine geçen, gürültülü, batıya kayan ve kuzeye yaslanan tek profil; gövdeyle kaynaşan
 * yedi yan kabarık (doğu omuzu, batı mahmuzu, ön ve arka payandalar) düzensiz siluet verir. Dilim izini kesen dik uçurum yüzleri,
 * sütun sütun kesintisiz dikey erozyon kaburgaları ve olukları, yüzlerce bal peteği oyuk (pencere, kapı, beyaz çerçeveli
 * güvercinlik, birkaçı gece yanar), ön yüzleri çökmüş açık odalar (koyu iç, iç niş, döşeme sekisi). Güney yüzünün doğu yarısında
 * kayaya oyulmuş ZİKZAK MERDİVEN (doğudan başlayan ilk kol + altı kol; sahanlıklar, dış korkuluk duvarı, sahanlık fenerleri)
 * zirvedeki döşemeli, üç yanı korkuluklu seyir düzlüğüne çıkar; düzlüğün ardında zirve topuzu. Tabanda kemerli tünel girişi
 * (söve, kemer taşları, ahşap kapı, aplikler), moloz eteği ve kaya blokları, eteğe yaslı iki taş köy evi, iki küçük peri bacası.
 * Bayrak (gerçekte var) IP/siyasi simge kuralıyla yok; yazı yok.
 * - `peri_bacalari`: altı peri bacası — ince dilimli, hafif eğik, karın veren konik tüf gövde; açık erozyon bandı ve pembe damar,
 * dikey oluklar, ince boyun ve katmanlı, hafif kaykık bazalt şapka (mantar). Üçünde oyma odalar (kemerli kapı, ahşap kanat,
 * beyaz söve, kat pencereleri, biri gece yanar), en büyüğünde konsollu ahşap balkon ve kayaya oyulmuş basamaklar; üst
 * kısımlarda güvercinlik oyukları; aralarda iki yavru baca ve kaya blokları; ortadaki yürünür patika açık.
 * - `kaya_kiliseleri`: yalnız mimari (haç, ikon, fresk, figür, yazı yok). Pembe tüf kayalık, solda 7 katlı oyma manastır kütlesi
 * (kat silmeleri, kemerli pencere/kapı, ön yüzü çökmüş odalar, tünel ağızları), ortada kayaya oyulmuş iki katlı kilise cephesi:
 * iki at nalı kemerli kapı (kademeli kemer halkası, söve), aralarında kör kemer, kaideli ve başlıklı dört plastır, dişli
 * silme, üst katta beş sütunceli kör kemer dizisi, kademeli alınlık ve yuvarlak pencere (kayıtsız: haç biçimi oluşmaz),
 * alınlığın üstünde güvercinlik sırası; sağda oluklu oyma koni şapel ve üst kattaki
 * kapısına metal ziyaretçi merdiveni (rıhtlı basamak, dikme, ara lama, küpeşte); önde taş döşemeli avlu, giriş fenerleri.
 * - `kalkis_alani`: orta model (ortak balon kiti) korunur; yerde şişmiş balonun zarfı 18 dilimli armut profil, dönüşümlü renkli
 * dilimler (gore) ve dikey koyu yük şeritleri, paraşüt valfi ve taç halkası; alt dilimler brülörle içten aydınlanır (şafak
 * öncesi "gece parlaması"; durağan düz renk ışık); soğuk şişirme zarfında yük şeritleri; alanda kazıklı yer ipleri ve kalkış
 * işaret çizgileri. Zarflarda şirket adı, logo, bayrak yok.
*/
import type { HiResMapEntry, HiResSceneEntry, HiResBuild } from "../../../hires/types";
import { HIRES_MIN_EDGE } from "../../../hires/types";
import { disc, discEdge } from "../../../hires/kit";
import { sink, type LandmarkCtx, type Sink } from "../../../citymap/design";

type Block = ReturnType<HiResBuild>[number];
type G = Block["g"];

// palet (city/styles/kapadokya.ts KAP ile aynı tonlar; kurucu yalnız izinli modülleri içe aktarır)
const TUFF = "#E6CCA6", HONEY = "#DDB894", ROSE = "#D9A18C", CREAM = "#E9D3B0", CAP = "#6E5A4C", CAPD = "#5B4A40";
const HOLE = "#5A4436", HOLE_D = "#3E2E24", C1 = "#E4C8A0", C2 = "#D9B78F", C3 = "#EBD5B4", CH = "#DDAE95", CH2 = "#CF9C84";
const TRIM = "#F2E6D0", BAND = "#F0DFC2", METAL = "#4A4F55", GULLY = "#C9A47C", DOOR = "#6B4228", WOOD = "#6B4A2E";
const LIT = "#FFC978", LAMP = "#FFD08A", PAVE = "#D8C3A6", PAVE2 = "#C8AE90";

/** Belirlenimci 0–1 gürültü. */
const hh = (a: number, b: number) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
/** İki onaltılık rengin karışımı. */
function mix(a: string, b: string, t: number): string {
  const p = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  const q = [0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * Math.max(0, Math.min(1, t))));
  return "#" + q.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}
/** Kenarları en az `HIRES_MIN_EDGE` olan yazıcı. */
function safe(b: Sink): Sink {
  const e = (v: number) => Math.max(HIRES_MIN_EDGE, v);
  return (x, y, z, w, h, d, c, g = "solid", j = 0.02) => b(x, y, z, e(w), e(h), e(d), c, g, j);
}

// ============================================================================================ kaya kütlesi (dilimli)
/** Süperelips dilim (kutu genişlik/derinlik oranları; genişlik azalırken derinlik artar → yuvarlak köşeli kaya kesiti). */
const SW4 = [0.97, 0.86, 0.7, 0.45], SD4 = [0.44, 0.71, 0.87, 0.97];
const SW3 = [0.95, 0.78, 0.45], SD3 = [0.5, 0.8, 0.97];
const SW2 = [0.93, 0.62], SD2 = [0.64, 0.95];
interface Sl { y0: number; y1: number; cx: number; cz: number; rx: number; rz: number; c: string }
interface Mass { sl: Sl[]; sw: number[]; sd: number[]; y0: number; sh: number; rib: number; hole: number }
type Face = "-z" | "+z" | "-x" | "+x";
const dirOf = (f: Face) => (f[0] === "-" ? -1 : 1);
const isZ = (f: Face) => f[1] === "z";

function drawMass(b: Sink, m: Mass, j = 0.02) {
  for (const s of m.sl) {
    const y = (s.y0 + s.y1) / 2, h = s.y1 - s.y0 + 0.02;
    m.sw.forEach((fw, i) => b(s.cx, y, s.cz, 2 * s.rx * fw, h, 2 * s.rz * m.sd[i], s.c, "solid", j));
  }
}
const sliceAt = (m: Mass, y: number): Sl | null => {
  const n = Math.floor((y - m.y0) / m.sh);
  return n >= 0 && n < m.sl.length ? m.sl[n] : null;
};
/** Dilimin `f` yüzünün düzlemi (yüz boyunca `u` dünya konumunda, `half` yarı genişlikli bir öğe için); yoksa null. */
function plane(m: Mass, s: Sl, f: Face, u: number, half: number): number | null {
  const dir = dirOf(f);
  if (isZ(f)) {
    const du = Math.abs(u - s.cx) + half;
    for (let i = m.sw.length - 1; i >= 0; i--) if (m.sw[i] * s.rx >= du) return s.cz + dir * m.sd[i] * s.rz;
  } else {
    const du = Math.abs(u - s.cz) + half;
    for (let i = 0; i < m.sw.length; i++) if (m.sd[i] * s.rz >= du) return s.cx + dir * m.sw[i] * s.rx;
  }
  return null;
}
/** Nokta kütlenin içinde mi (dilim kutularından biri). */
function inside(m: Mass, x: number, y: number, z: number): boolean {
  const s = sliceAt(m, y);
  if (!s) return false;
  return m.sw.some((fw, i) => Math.abs(x - s.cx) <= fw * s.rx && Math.abs(z - s.cz) <= m.sd[i] * s.rz);
}
/** Yüze yapışık kutu: `f` yüzünde, yüz düzlemleri [pa, pb] arasında (en öndeki düzlemden `out` öne çıkar, en geridekine gömülür). */
function onFace(b: Sink, f: Face, u: number, y: number, pFront: number, pBack: number, w: number, h: number, c: string, out = 0.03, g: G = "solid") {
  const dir = dirOf(f), a = pFront + dir * out, e = pBack - dir * 0.03, mid = (a + e) / 2, t = Math.max(0.04, Math.abs(a - e));
  if (isZ(f)) b(u, y, mid, w, h, t, c, g, 0); else b(mid, y, u, t, h, w, c, g, 0);
}
/** [y0, y1] aralığını kaplayan dilimlerin yüz düzlemleri: en ön ve en geri (yoksa null). */
function span(m: Mass, f: Face, u: number, y0: number, y1: number, half: number): [number, number] | null {
  const dir = dirOf(f);
  let front = -Infinity * dir, back = Infinity * dir;
  for (let y = y0 + 0.01; y <= y1 + 1e-6; y += Math.min(m.sh, Math.max(0.02, y1 - y0 - 0.02))) {
    const s = sliceAt(m, Math.min(y, y1 - 0.01));
    if (!s) return null;
    const p = plane(m, s, f, u, half);
    if (p === null) return null;
    front = dir > 0 ? Math.max(front, p) : Math.min(front, p);
    back = dir > 0 ? Math.min(back, p) : Math.max(back, p);
    if (y1 - y0 < 0.03) break;
  }
  return [front, back];
}

type Kind = "win" | "dove" | "lit" | "door" | "room";
/** Kaya oyuğu: pencere, güvercinlik (beyaz çerçeve), yanan pencere, kemerli kapı, ön yüzü çökmüş oda. */
function opening(b: Sink, m: Mass, f: Face, u: number, y: number, kind: Kind, w: number, h: number): boolean {
  const sp = span(m, f, u, y - h / 2 - (kind === "dove" ? 0.07 : 0), y + h / 2 + (kind === "door" || kind === "room" ? w * 0.3 : 0.07), w / 2 + 0.08);
  if (!sp) return false;
  const [pf, pb] = sp;
  if (kind === "dove") onFace(b, f, u, y, pf, pb, w + 0.13, h + 0.13, TRIM, 0.02);
  onFace(b, f, u, y, pf, pb, w, h, kind === "room" ? HOLE_D : HOLE, 0.03);
  if (kind === "lit") onFace(b, f, u, y, pf, pb, w - 0.08, h - 0.08, LIT, 0.045, "glow");
  if (kind === "door" || kind === "room") { // kemer omzu (kademeli yay)
    onFace(b, f, u, y + h / 2 + w * 0.09, pf, pb, w * 0.8, w * 0.18, kind === "room" ? HOLE_D : HOLE, 0.03);
    onFace(b, f, u, y + h / 2 + w * 0.22, pf, pb, w * 0.48, w * 0.1, kind === "room" ? HOLE_D : HOLE, 0.03);
  }
  if (kind === "room") { // iç kemerli niş (açık ton) ve döşeme sekisi
    onFace(b, f, u, y - h * 0.08, pf, pb, w * 0.42, h * 0.62, "#7A5E48", 0.045);
    onFace(b, f, u, y - h / 2 - 0.05, pf, pb, w + 0.1, 0.1, C3, 0.1);
  }
  return true;
}

// ============================================================================================ Uçhisar kalesi (14 × 12)
const YB = 0.55, YT = 20.9;

function uchisarHi(o: Sink, c: LandmarkCtx) {
  const b = safe(o);
  const { x0, z0 } = c, X = x0 + 7, Z = z0 + 6;
  // ---- ana gövde: 40 dilim, yumuşak gürültülü profil, kuzeye yaslanır; ton aşağıdan yukarı bal → krem, ince pembe damar
  const N = 40, SH = (YT - YB) / N;
  const core: Mass = { sl: [], sw: SW4, sd: SD4, y0: YB, sh: SH, rib: 1, hole: 1 };
  for (let n = 0; n < N; n++) {
    // profil: geniş moloz/köy eteği (alt %30 hızla daralır), üstte dike yakın kaya "kale" gövdesi, yuvarlak tepe; düşük
    // frekanslı gürültü siluete topak verir
    const t = (n + 0.5) / N, prof = t < 0.3 ? 1 - 0.32 * Math.pow(t / 0.3, 0.8) : 0.68 - 0.2 * Math.pow((t - 0.3) / 0.7, 1.5);
    let rx = 6.4 * prof + 0.34 * Math.sin(6.3 * t + 0.6) + 0.16 * Math.sin(15.1 * t);
    let rz = 5.0 * prof + 0.28 * Math.sin(4.7 * t + 2) + 0.1 * Math.sin(12.9 * t + 1);
    if (t > 0.92) { const q = (t - 0.92) / 0.08, f = Math.sqrt(1 - 0.3 * q * q); rx *= f; rz *= f; }
    let col = t < 0.3 ? mix(C2, C1, t / 0.3) : t < 0.75 ? mix(C1, C3, (t - 0.3) / 0.45) : C3;
    if (Math.abs(t - 0.37) < 0.013) col = mix(col, BAND, 0.7);
    if (Math.abs(t - 0.6) < 0.013 || Math.abs(t - 0.21) < 0.013) col = mix(col, ROSE, 0.45);
    core.sl.push({ y0: YB + n * SH, y1: YB + (n + 1) * SH, cx: X - 0.9 * Math.pow(t, 1.5) + 0.35 * Math.sin(3.3 * t) + 0.15 * Math.sin(9 * t), cz: Z + 0.45 + 2.3 * Math.pow(t, 1.6), rx, rz, c: col });
  }
  // ---- gövdeyle kaynaşan yan kabarıklar: [yerel x, yerel z, rx, rz, tepe, ton]
  const LOBES: [number, number, number, number, number, string][] = [
    [11.0, 6.0, 2.6, 3.3, 15.2, C2], [2.6, 6.6, 2.2, 3.2, 10.2, C1], [4.9, 9.8, 2.5, 1.8, 17.2, C2], [9.7, 10.1, 2.2, 1.65, 16.0, C1],
    [2.5, 3.7, 1.9, 1.85, 7.4, C2], [12.4, 9.6, 1.4, 2.0, 8.6, C1], [12.2, 3.7, 1.5, 1.4, 9.6, C1],
  ];
  const lobes: Mass[] = LOBES.map(([lx, lz, rx0, rz0, top, tone], q) => {
    const sh = SH, n = Math.round((top - YB) / sh), m: Mass = { sl: [], sw: SW2, sd: SD2, y0: YB, sh, rib: 0.5, hole: 0.5 };
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, cap = t > 0.68 ? Math.sqrt(Math.max(0.08, 1 - ((t - 0.68) / 0.32) ** 2 * 0.88)) : 1;
      const f = (1 - 0.3 * t) * cap + 0.04 * Math.sin(9 * t + q);
      m.sl.push({ y0: YB + k * sh, y1: YB + (k + 1) * sh, cx: x0 + lx + 0.15 * Math.sin(5 * t + q), cz: z0 + lz + 0.2 * t, rx: rx0 * f, rz: rz0 * f,
        c: Math.abs(t - 0.45) < 0.02 ? mix(tone, ROSE, 0.35) : mix(tone, C3, t * 0.45) });
    }
    return m;
  });
  const masses = [core, ...lobes];
  const elsewhere = (m: Mass, x: number, y: number, z: number) => masses.some((q) => q !== m && inside(q, x, y, z));

  // ---- moloz eteği: kapı önü şeridi açık (yerel z < 0,82, x 5,2–11 yürünür karolar)
  b(x0 + 7, YB / 2, z0 + 6.42, 14, YB, 11.16, C2, "solid", 0.06);
  b(x0 + 2.6, YB / 2, z0 + 0.42, 5.2, YB, 0.84, C2, "solid", 0.06);
  b(x0 + 12.5, YB / 2, z0 + 0.42, 3.0, YB, 0.84, C2, "solid", 0.06);
  b(x0 + 8.1, 0.03, z0 + 0.42, 5.8, 0.06, 0.84, CREAM, "solid", 0.04); // kapı önü taş döşeme (yürünür, bandın altında)
  for (let k = 0; k < 22; k++) { // etek blokları (kaya düşmesi)
    const a = (k / 22) * Math.PI * 2, r = 0.88 + 0.08 * hh(k, 3), s = 0.28 + 0.35 * hh(k, 5);
    let bx = x0 + 7 + Math.cos(a) * 6.55 * r, bz = z0 + 6.4 + Math.sin(a) * 5.3 * r;
    bx = Math.max(x0 + s / 2 + 0.05, Math.min(x0 + 14 - s / 2 - 0.05, bx)); bz = Math.max(z0 + 0.9 + s / 2, Math.min(z0 + 12 - s / 2 - 0.05, bz));
    b(bx, YB + s * 0.4, bz, s, s * 0.8, s * 0.9, hh(k, 7) > 0.5 ? C2 : GULLY, "solid", 0.05);
  }
  for (const m of masses) drawMass(b, m);

  // ---- zikzak merdiven (önce: diğer öğeler merdivenin önünden çekilir)
  const stairs: [number, number, number, number][] = []; // [x0, x1, y0, y1] dünya
  const coreAt = (y: number) => sliceAt(core, Math.min(YT - 0.01, Math.max(YB, y)))!;
  const step = (x: number, yTop: number, run: number, lamp = false) => {
    const s = coreAt(yTop - 0.05), p = plane(core, s, "-z", x, run / 2) ?? s.cz - s.rz * 0.44;
    const zf = Math.max(z0 + 0.84, p - 0.56), zb = p + 0.26, fill = Math.min(0.55, yTop - 0.02);
    b(x, yTop - fill / 2, (zf + zb) / 2, run + 0.02, fill, zb - zf, mix(s.c, CREAM, 0.25 + 0.15 * hh(x, yTop)), "solid", 0.02);
    if (lamp) {
      b(x, yTop + 0.35, zf + 0.06, 0.05, 0.7, 0.05, METAL, "solid", 0);
      b(x, yTop + 0.78, zf + 0.06, 0.13, 0.16, 0.13, LAMP, "glow", 0);
    }
    return zf;
  };
  const flight = (xs: number, dir: number, L: number, ya: number, yb: number, n: number) => {
    const run = L / n, rise = (yb - ya) / n;
    for (let k = 0; k < n; k++) {
      const x = xs + dir * (k + 0.5) * run, ty = ya + (k + 1) * rise, zf = step(x, ty, run);
      if (k % 2 === 0) { // dış korkuluk duvarı (iki basamakta bir)
        const ty2 = ya + (Math.min(n - 1, k + 1) + 1) * rise;
        b(x + dir * run * 0.5, (ty + ty2 + 0.34) / 2, zf + 0.05, run * 2, ty2 + 0.34 - ty, 0.1, mix(coreAt(ty).c, C2, 0.6), "solid", 0.02);
      }
    }
    stairs.push([Math.min(xs, xs + dir * L) - 0.3, Math.max(xs, xs + dir * L) + 0.3, ya - 0.6, yb + 0.6]);
  };
  const landing = (xa: number, xb: number, y: number) => {
    const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
    for (let x = lo; x < hi - 1e-6; x += 0.5) step(Math.min(x + 0.25, hi - 0.25), y, Math.min(0.5, hi - lo), x === lo);
    stairs.push([lo - 0.3, hi + 0.3, y - 0.6, y + 0.6]);
  };
  // ilk kol: doğudan, kapının sağında (kapı kemerinin üstünden geçmez); sonra altı kol çekirdeğin önünde zikzak
  const Y1 = 3.0;
  flight(x0 + 11.8, -1, 2.6, YB, Y1, 8);
  landing(x0 + 9.2, x0 + 8.5, Y1);
  let xEnd = x0 + 8.5, dir = -1, ya = Y1;
  for (let f = 0; f < 6; f++) {
    // kollar ön yüzün doğu yarısında (batı yarısı oyuklara, kaburgalara ve uçurum yüzlerine kalır)
    const yb = Y1 + ((YT - Y1) * (f + 1)) / 6, s = coreAt((ya + yb) / 2), L = 2.4, xm = Math.min(s.cx + 0.25 * s.rx, s.cx + 0.8 * coreAt(yb - 0.05).rx - L / 2);
    const xs = dir < 0 ? xm + L / 2 : xm - L / 2;
    if (Math.abs(xs - xEnd) > 0.05) landing(xEnd, xs, ya);
    flight(xs, dir, L, ya, yb, 9);
    xEnd = xs + dir * L; dir = -dir; ya = yb;
  }
  const inStair = (x: number, y: number) => stairs.some(([a, e, y0, y1]) => x >= a && x <= e && y >= y0 && y <= y1);

  // ---- zirve: döşemeli seyir düzlüğü, üç yanda korkuluk, fener, arkada zirve topuzu (bayrak yok)
  const top = core.sl[N - 1], dw = 2 * top.rx * 0.86, dd = 2 * top.rz * 0.71;
  b(top.cx, YT + 0.04, top.cz, dw, 0.08, dd, CREAM, "solid", 0.02);
  b(top.cx, YT + 0.5, top.cz + dd / 2 - 0.35, 1.7, 1.0, 0.9, C3, "solid", 0.05);
  b(top.cx + 0.1, YT + 1.06, top.cz + dd / 2 - 0.3, 1.0, 0.16, 0.6, C1, "solid", 0.05);
  for (const [sx, h2, w2] of [[-1, 0.7, 0.9], [1, 0.5, 0.8]] as const) b(top.cx + sx * (dw / 2 - w2 / 2 - 0.05), YT + h2 / 2, top.cz + dd / 2 - 0.4, w2, h2, 0.8, sx < 0 ? C3 : C1, "solid", 0.05); // zirve kayaları
  const px0 = top.cx - dw / 2 + 0.06, px1 = top.cx + dw / 2 - 0.06, pz0 = top.cz - dd / 2 + 0.06, pz1 = top.cz + dd / 2 - 0.5;
  for (let k = 0; k <= 6; k++) { const x = px0 + ((px1 - px0) * k) / 6; if (k !== 6) b(x, YT + 0.42, pz0, 0.06, 0.7, 0.06, METAL, "solid", 0); }
  b((px0 + px1 - 0.6) / 2, YT + 0.74, pz0, px1 - px0 - 0.6, 0.05, 0.06, METAL, "solid", 0);
  b((px0 + px1 - 0.6) / 2, YT + 0.44, pz0, px1 - px0 - 0.6, 0.04, 0.05, METAL, "solid", 0);
  for (const x of [px0, px1]) {
    for (let k = 1; k <= 3; k++) b(x, YT + 0.42, pz0 + ((pz1 - pz0) * k) / 3, 0.06, 0.7, 0.06, METAL, "solid", 0);
    b(x, YT + 0.74, (pz0 + pz1) / 2, 0.06, 0.05, pz1 - pz0, METAL, "solid", 0);
  }
  b(px0 + 0.3, YT + 0.42, pz1 - 0.2, 0.05, 0.76, 0.05, METAL, "solid", 0);
  b(px0 + 0.3, YT + 0.88, pz1 - 0.2, 0.15, 0.18, 0.15, LAMP, "glow", 0);

  // ---- tünel girişi (kapı karosu ekseni x0 + 7,5): kemer taşları, söve, ahşap kapı, aplikler, eşik
  const DX = x0 + 7.5, dh = 1.9, dsp = span(core, "-z", DX, YB, YB + dh + 0.45, 0.62)!;
  onFace(b, "-z", DX, YB + dh / 2, dsp[0], dsp[1], 1.24, dh, TRIM, 0.02);
  for (const [ww, yy] of [[1.24, 0.12], [1.0, 0.27], [0.62, 0.38]] as const) onFace(b, "-z", DX, YB + dh + yy - 0.06, dsp[0], dsp[1], ww, 0.16, TRIM, 0.02);
  onFace(b, "-z", DX, YB + (dh - 0.05) / 2, dsp[0], dsp[1], 1.0, dh - 0.05, HOLE_D, 0.03);
  for (const [ww, yy] of [[0.8, 0.08], [0.5, 0.2]] as const) onFace(b, "-z", DX, YB + dh - 0.05 + yy, dsp[0], dsp[1], ww, 0.13, HOLE_D, 0.03);
  onFace(b, "-z", DX, YB + 0.92, dsp[0], dsp[1], 0.86, 1.8, DOOR, 0.05);
  for (const dx of [-0.21, 0.21]) onFace(b, "-z", DX + dx, YB + 0.92, dsp[0], dsp[1], 0.04, 1.7, "#4E3020", 0.065);
  for (const s of [-1, 1]) { onFace(b, "-z", DX + s * 0.8, YB + 1.85, dsp[0], dsp[1], 0.06, 0.14, METAL, 0.08); onFace(b, "-z", DX + s * 0.8, YB + 2.0, dsp[0], dsp[1], 0.13, 0.17, LAMP, 0.12, "glow"); }
  b(DX, YB + 0.03, dsp[0] - 0.2, 1.3, 0.06, 0.4, CREAM, "solid", 0.02); // eşik
  const nearDoor = (x: number, y: number) => Math.abs(x - DX) < 1.05 && y < YB + dh + 0.8;

  let lit = 0;
  // ---- uçurum yüzleri: birkaç dilimi örten dik kaya yüzleri (aşınmış dik yamaç; halka izini keser), üstlerinde oyuklar
  const FACETS: [Face, number, number, number, number][] = [
    ["-x", 0.05, 2.0, 8.2, 2.4], ["-x", -0.35, 9.4, 14.2, 1.7], ["+x", 0.25, 3.2, 7.8, 2.0], ["-z", -0.62, 4.6, 9.6, 1.5],
    ["+z", 0.15, 1.2, 9.4, 2.6], ["+z", -0.5, 10.6, 15.4, 1.6], ["-z", -0.7, 11.0, 14.6, 1.2], ["+x", -0.3, 12.0, 16.4, 1.4],
  ];
  const facets: [Face, number, number, number, number][] = [];
  FACETS.forEach(([f, q, ya, yb, w], k) => {
    const s = coreAt((ya + yb) / 2), u = isZ(f) ? s.cx + q * s.rx : s.cz + q * s.rz, sp = span(core, f, u, ya, yb, w / 2);
    if (!sp) return;
    onFace(b, f, u, (ya + yb) / 2, sp[0], sp[1], w, yb - ya, mix(s.c, k % 2 ? C2 : BAND, 0.25), 0.02);
    facets.push([f, u, ya, yb, w]);
    for (let yy = ya + 0.55; yy < yb - 0.3; yy += 0.95) for (let uu = u - w / 2 + 0.32; uu < u + w / 2 - 0.25; uu += 0.62) {
      const r = hh(uu * 5.3 + k, yy * 2.1);
      if (r > 0.5) continue;
      const lit2 = r < 0.04 && lit < 30;
      if (lit2) lit++;
      if (r > 0.38) onFace(b, f, uu, yy, sp[0], sp[0], 0.32, 0.4, TRIM, 0.04); // güvercinlik çerçevesi
      onFace(b, f, uu, yy, sp[0], sp[0], 0.22, 0.3, HOLE, 0.05);
      if (lit2) onFace(b, f, uu, yy, sp[0], sp[0], 0.15, 0.22, LIT, 0.065, "glow");
    }
  });
  const inFacet = (f: Face, u: number, y: number) => facets.some(([g, fu, ya, yb, w]) => g === f && Math.abs(u - fu) < w / 2 + 0.25 && y > ya - 0.4 && y < yb + 0.4);

  // ---- dikey erozyon kaburgaları / olukları: sütun başına kesintisiz şerit (dilim çiftleri boyunca), uzunluğu ve başlangıcı
  // sütuna göre değişir → yatay dilim izini dikey aşınma dokusu bastırır
  masses.forEach((m, mi) => {
    for (const f of ["-z", "+z", "-x", "+x"] as Face[]) {
      const fr = isZ(f) ? [-0.84, -0.6, -0.36, -0.12, 0.14, 0.38, 0.62, 0.84] : [-0.74, -0.42, -0.1, 0.22, 0.54, 0.8];
      fr.forEach((q, k) => {
        const hs = hh(mi * 31 + k + (isZ(f) ? 0 : 7), dirOf(f) * 3 + (isZ(f) ? 1 : 2));
        if (hs > 0.3 + 0.4 * m.rib) return;
        const L = m.sl.length, s0 = 2 * Math.floor((hs * 0.35 * L) / 2), s1 = Math.min(L - 2, s0 + Math.round((0.35 + 0.5 * hh(k, mi + 5)) * L));
        const dark = (k + mi) % 3 === 0, rw = dark ? 0.12 : 0.2 + 0.08 * hh(k, mi);
        for (let n = s0; n + 1 <= s1 && n / L < 0.9; n += 2) {
          const s = m.sl[n], u = isZ(f) ? s.cx + q * s.rx : s.cz + q * s.rz;
          const y = (s.y0 + m.sl[n + 1].y1) / 2, h = m.sl[n + 1].y1 - s.y0;
          if (f === "-z" && (inStair(u, y) || nearDoor(u, y))) continue;
          if (mi === 0 && inFacet(f, u, y)) continue;
          const p = plane(m, s, f, u, 0.12);
          if (p === null) continue;
          const ox = isZ(f) ? u : p + dirOf(f) * 0.1, oz = isZ(f) ? p + dirOf(f) * 0.1 : u;
          if (elsewhere(m, ox, y, oz)) continue;
          onFace(b, f, u, y, p, p, rw, h, dark ? GULLY : mix(s.c, BAND, 0.3), dark ? 0.035 : 0.1);
        }
      });
    }
  });

  // ---- bal peteği oyuklar ve açık odalar
  masses.forEach((m, mi) => {
    for (let n = 1; n < m.sl.length - 1; n += 2) {
      const s = m.sl[n], y = (s.y0 + s.y1) / 2, t = n / m.sl.length;
      if (mi === 0 && t > 0.93) break;
      for (const f of ["-z", "-x", "+x", "+z"] as Face[]) {
        const R = isZ(f) ? s.rx * 0.93 : s.rz * 0.93, c0 = isZ(f) ? s.cx : s.cz, stepU = 0.82, off = (n % 4 === 1 ? 0 : 0.41);
        const dens = m.hole * (f === "+z" ? 0.26 : f === "-z" ? 0.52 : 0.42);
        for (let u = c0 - R + 0.35 + off; u <= c0 + R - 0.35; u += stepU) {
          const r = hh(mi * 17 + u * 3.1, n * 5 + dirOf(f) + (isZ(f) ? 0 : 11));
          if (r > dens) continue;
          if (f === "-z" && (inStair(u, y) || nearDoor(u, y))) continue;
          if (mi === 0 && inFacet(f, u, y)) continue;
          const p = plane(m, s, f, u, 0.2);
          if (p === null) continue;
          const ox = isZ(f) ? u : p + dirOf(f) * 0.08, oz = isZ(f) ? p + dirOf(f) * 0.08 : u;
          if (elsewhere(m, ox, y, oz)) continue;
          const r2 = hh(u * 7.7 + mi, n * 1.3 + (isZ(f) ? 2 : 4));
          let kind: Kind = "win";
          if (y < YB + 5 && r2 < 0.25) kind = "door";
          else if (y > 7 && r2 < 0.32) kind = "dove";
          else if (r2 > 0.9 && lit < 30 && f !== "+z") { kind = "lit"; lit++; }
          if (kind === "door") { if (!opening(b, m, f, u, y - 0.06, "door", 0.36, 0.32)) continue; }
          else if (kind === "dove") opening(b, m, f, u, y, "dove", 0.2, 0.28);
          else opening(b, m, f, u, y, kind, 0.28, 0.34);
        }
      }
    }
  });
  // ön yüzü çökmüş odalar (iki dilim boyu; koyu iç, iç niş, döşeme sekisi)
  for (const [f, fu, fy] of [["-z", -0.55, 7.2], ["-z", 0.62, 11.6], ["-x", 0.1, 9.4], ["+x", -0.3, 6.4], ["-z", -0.2, 15.6], ["+x", 0.35, 13.2]] as [Face, number, number][]) {
    const s = coreAt(fy), u = isZ(f) ? s.cx + fu * s.rx : s.cz + fu * s.rz;
    if (f === "-z" && inStair(u, fy)) continue;
    opening(b, core, f, u, fy, "room", 0.9, 0.62);
  }

  // ---- eteğe yaslı taş köy evleri (doğu önde, batı önde): düz dam + korkuluk, kemerli kapı, pencereler, baca
  const house = (hx: number, hz: number, w: number, d: number, h: number, wall: string) => {
    b(hx, YB * 0 + h / 2, hz, w, h, d, wall, "solid", 0.04);
    b(hx, h + 0.05, hz, w + 0.14, 0.1, d + 0.14, "#C9A27E", "solid", 0.02);
    for (const s of [-1, 1]) b(hx + s * (w / 2 + 0.02), h + 0.22, hz, 0.1, 0.25, d + 0.14, "#C9A27E", "solid", 0.02);
    b(hx, h + 0.22, hz - d / 2 - 0.02, w + 0.14, 0.25, 0.1, "#C9A27E", "solid", 0.02);
    const fz = hz - d / 2;
    b(hx - w * 0.22, 0.6, fz - 0.01, 0.6, 1.2, 0.04, TRIM, "solid", 0);
    b(hx - w * 0.22, 0.56, fz - 0.03, 0.48, 1.08, 0.03, DOOR, "solid", 0);
    b(hx - w * 0.22, 1.18, fz - 0.03, 0.3, 0.1, 0.03, DOOR, "solid", 0);
    for (const [wx, wy] of [[0.24, 0.9], [0.24, 1.8], [-0.22, 1.85]] as const) {
      b(hx + w * wx, wy, fz - 0.01, 0.46, 0.5, 0.04, TRIM, "solid", 0);
      b(hx + w * wx, wy, fz - 0.025, 0.34, 0.38, 0.03, "#4A3A30", "glass", 0);
    }
    b(hx + w * 0.24, 1.8, fz - 0.045, 0.26, 0.3, 0.02, LIT, "glow", 0);
    b(hx + w * 0.3, h + 0.45, hz + d * 0.2, 0.26, 0.7, 0.26, wall, "solid", 0.03); // baca
    b(hx + w * 0.3, h + 0.82, hz + d * 0.2, 0.34, 0.06, 0.34, "#C9A27E", "solid", 0);
  };
  house(x0 + 12.45, z0 + 1.5, 2.1, 2.7, 2.4, "#EAD7B8");
  house(x0 + 1.5, z0 + 1.35, 2.2, 2.4, 2.1, "#E3BFA0");
  // küçük peri bacaları (etekte)
  fairyChimney(b, x0 + 3.55, z0 + 1.45, YB, 3.4, 0.95, HONEY, 3, {});
  fairyChimney(b, x0 + 1.05, z0 + 11.2, YB, 2.8, 0.85, ROSE, 4, {});
}

// ============================================================================================ peri bacası (ince dilimli)
interface ChimOpts { rooms?: number; lit?: boolean; dove?: boolean; balcony?: boolean; ribs?: number }
/** Peri bacası: konik tüf gövde (dilim ≈ 0,42), açık bant + pembe damar, oluklar, ince boyun, katmanlı kaykık bazalt şapka.
 *  `rooms` ön (−z) yüzde oyma oda kapısı + kat pencereleri. Uç ≈ y0 + h + 0,52w. Dönüş: gövde dilimleri (merkez, yarıçap). */
function fairyChimney(b: Sink, x: number, z: number, y0: number, h: number, w: number, tone: string, seed: number, o: ChimOpts) {
  const N = Math.max(8, Math.min(24, Math.round(h / 0.42))), sh = h / N;
  const lx = (hh(seed, 1) - 0.5) * 0.28 * w, lz = (hh(seed, 2) - 0.5) * 0.22 * w;
  const body: [number, number, number, number][] = []; // [cx, cz, r, yMid]
  for (let n = 0; n < N; n++) {
    const t = (n + 0.5) / N, r = 0.5 * w * (1 - 0.62 * Math.pow(t, 0.85) + 0.06 * Math.sin(Math.PI * t));
    let col = mix(tone, CREAM, t * 0.25);
    if (Math.abs(t - 0.33) < 0.5 / N + 0.01) col = BAND;
    else if (Math.abs(t - 0.58) < 0.5 / N) col = mix(tone, ROSE, 0.55);
    else if (t > 0.88) col = mix(tone, "#CDB08C", 0.35);
    const cx = x + lx * t, cz = z + lz * t, yy = y0 + n * sh + sh / 2;
    disc(b, cx, yy, cz, r, sh + 0.02, col, 3, "solid", 0.035);
    body.push([cx, cz, r, yy]);
  }
  // oluklar (üç dilimde bir, ön yüz hariç)
  const ribs = o.ribs ?? 5;
  for (let n = 0; n + 2 < N * 0.8; n += 3) {
    const [cx, cz, r, yy] = body[n];
    for (let q = 0; q < ribs; q++) {
      const a = -Math.PI / 2 + ((q + 0.5) / ribs) * Math.PI * 2 * 0.86 + Math.PI * 0.07;
      if (hh(seed * 7 + q, n) > 0.75) continue;
      const e = discEdge(r, 3, a) - 0.02, rw = Math.max(0.06, 0.09 * w);
      b(cx + Math.cos(a) * e, yy + sh, cz + Math.sin(a) * e, rw, sh * 3, rw, q % 2 ? GULLY : mix(tone, BAND, 0.4), "solid", 0.01);
    }
  }
  // boyun ve şapka
  const [nx, nz] = body[N - 1], ytop = y0 + h, cdx = (hh(seed, 4) - 0.5) * 0.1 * w, cdz = (hh(seed, 5) - 0.5) * 0.1 * w;
  disc(b, nx, ytop + 0.07 * w, nz, 0.15 * w, 0.14 * w + 0.02, mix(tone, "#CDB08C", 0.4), 2, "solid", 0.02);
  disc(b, nx + cdx * 0.5, ytop + 0.19 * w, nz + cdz * 0.5, 0.38 * w, 0.1 * w + 0.02, CAPD, 3, "solid", 0.04);
  disc(b, nx + cdx, ytop + 0.3 * w, nz + cdz, 0.33 * w, 0.12 * w + 0.02, CAP, 3, "solid", 0.04);
  disc(b, nx + cdx * 1.2, ytop + 0.41 * w, nz + cdz * 1.2, 0.23 * w, 0.1 * w + 0.02, CAP, 2, "solid", 0.03);
  b(nx + cdx * 1.3, ytop + 0.49 * w, nz + cdz * 1.3, 0.24 * w, 0.06 * w, 0.24 * w, CAPD, "solid", 0.02);
  // oyma odalar: ön (−z) yüz
  const front = (n: number, half: number) => { const [cx, cz, r] = body[n]; return { cx, z: cz - discEdge(r, 3, -Math.PI / 2), zb: cz - Math.max(0.01, r * Math.sin(Math.PI / 4) - 0.02), half, r }; };
  if (o.rooms) {
    const d0 = front(1, 0.24), dh = Math.min(1.1, sh * 2.6), dy = y0 + dh / 2;
    const zf = d0.z, zb = d0.zb + 0.04;
    b(d0.cx - 0.08 * w, dy, (zf - 0.02 + zb) / 2, 0.58, dh + 0.12, zb - zf + 0.02, TRIM, "solid", 0);
    b(d0.cx - 0.08 * w, dy + dh / 2 + 0.1, (zf - 0.02 + zb) / 2, 0.36, 0.12, zb - zf + 0.02, TRIM, "solid", 0);
    b(d0.cx - 0.08 * w, dy - 0.02, (zf - 0.04 + zb) / 2, 0.44, dh - 0.04, zb - zf + 0.04, HOLE, "solid", 0);
    b(d0.cx - 0.08 * w, dy - 0.05, (zf - 0.06 + zb) / 2, 0.36, dh - 0.12, zb - zf + 0.06, DOOR, "solid", 0);
    // kat pencereleri (n: dilim indeksleri)
    const rows = [Math.round(N * 0.32), Math.round(N * 0.5), Math.round(N * 0.66)].slice(0, Math.max(0, o.rooms - 1));
    rows.forEach((n, k) => {
      const q = front(n, 0.16), yy = body[n][3], xx = q.cx + (k % 2 ? 0.12 : -0.1) * w;
      b(xx, yy, (q.z - 0.02 + q.zb) / 2, 0.36, Math.min(0.42, sh * 1.0), q.zb - q.z + 0.02, TRIM, "solid", 0);
      b(xx, yy, (q.z - 0.035 + q.zb) / 2, 0.26, Math.min(0.32, sh * 0.8), q.zb - q.z + 0.035, HOLE, "solid", 0);
      if (o.lit && k === 0) b(xx, yy, (q.z - 0.05 + q.zb) / 2, 0.2, Math.min(0.24, sh * 0.6), q.zb - q.z + 0.05, LIT, "glow", 0);
    });
  }
  if (o.dove) for (const [fn, a] of [[0.72, 0.6], [0.76, -0.6], [0.7, Math.PI + 0.3]] as const) {
    const n = Math.min(N - 1, Math.round(N * fn)), [cx, cz, r, yy] = body[n], e = discEdge(r, 3, a);
    b(cx + Math.cos(a) * e, yy, cz + Math.sin(a) * e, 0.2, 0.24, 0.2, TRIM, "solid", 0);
    b(cx + Math.cos(a) * (e + 0.03), yy, cz + Math.sin(a) * (e + 0.03), 0.14, 0.16, 0.14, HOLE, "solid", 0);
  }
  return body;
}

function periHi(o: Sink, c: LandmarkCtx) {
  const b = safe(o), { x0, z0 } = c;
  b(c.cx, 0.03, c.cz, c.w, 0.06, c.d, CREAM, "solid", 0.05);
  // patika kenar taşları (ortadaki yürünür sıra lj 3 açık; taşlar zeminde, bandın altında)
  for (let k = 0; k < 9; k++) for (const zz of [2.98, 4.02]) b(x0 + 0.35 + k * 0.66, 0.07, z0 + zz, 0.5, 0.06, 0.12, PAVE2, "solid", 0.03);
  const set: [number, number, number, number, string, number, ChimOpts][] = [
    [1.3, 1.35, 7.4, 1.5, TUFF, 0.3, { rooms: 2, lit: true, dove: true }], [3.2, 1.25, 9.2, 1.7, HONEY, 0.3, { rooms: 3, dove: true }],
    [5.0, 1.5, 6.2, 1.3, CREAM, 0.3, { dove: true }], [1.5, 4.75, 5.6, 1.3, HONEY, 0.3, {}],
    [3.5, 4.8, 8.0, 1.5, TUFF, 0.4, { rooms: 1, dove: true }], [5.2, 4.9, 5.0, 1.1, ROSE, 0.4, {}],
  ];
  set.forEach(([dx, dz, , w, tone, y0]) => { // topuk: alçak tüf tümseği (iki kat yuvarlak)
    disc(b, x0 + dx, y0 * 0.35, z0 + dz, (w + 0.25) / 2, y0 * 0.7, mix(tone, C2, 0.5), 3, "solid", 0.05);
    disc(b, x0 + dx, y0 * 0.85, z0 + dz, (w + 0.08) / 2, y0 * 0.3 + 0.02, tone, 3, "solid", 0.05);
  });
  set.forEach(([dx, dz, h, w, tone, y0, op], q) => fairyChimney(b, x0 + dx, z0 + dz, y0, h, w, tone, 11 + q * 5, op));
  // en büyük bacada konsollu ahşap balkon (ikinci kat penceresinin önünde) ve kayaya oyulmuş basamaklar
  {
    const bx = x0 + 3.2, w = 1.7, N = Math.round(9.2 / 0.42), sh = 9.2 / N, n = Math.round(N * 0.32);
    const t = (n + 0.5) / N, r = 0.5 * w * (1 - 0.62 * Math.pow(t, 0.85) + 0.06 * Math.sin(Math.PI * t));
    const lx = (hh(16, 1) - 0.5) * 0.28 * w, lz = (hh(16, 2) - 0.5) * 0.22 * w, cx = bx + lx * t, cz = z0 + 1.25 + lz * t;
    const fz = cz - discEdge(r, 3, -Math.PI / 2) + 0.03, by = 0.3 + n * sh - 0.2;
    b(cx + 0.25, by, fz - 0.27, 1.1, 0.08, 0.56, WOOD, "solid", 0.02);
    for (const ddx of [-0.2, 0.7]) { b(cx + ddx, by - 0.2, fz - 0.12, 0.08, 0.32, 0.26, WOOD, "solid", 0); b(cx + ddx, by - 0.4, fz - 0.03, 0.08, 0.12, 0.08, WOOD, "solid", 0); }
    b(cx + 0.25, by + 0.36, fz - 0.53, 1.1, 0.05, 0.05, WOOD, "solid", 0);
    for (const ddx of [-0.27, 0.07, 0.42, 0.77]) b(cx + ddx, by + 0.2, fz - 0.53, 0.05, 0.3, 0.05, WOOD, "solid", 0);
    for (const ddz of [-0.27, 0]) b(cx + 0.78, by + 0.2, fz + ddz - 0.13, 0.05, 0.3, 0.05, WOOD, "solid", 0);
    b(cx + 0.78, by + 0.36, fz - 0.27, 0.05, 0.05, 0.56, WOOD, "solid", 0);
    // kayaya oyulmuş iki basamak: zeminden topuk üstündeki kapı eşiğine (topuğa yaslı)
    const dx0 = bx - 0.08 * w + lx * (0.5 / N);
    b(dx0, 0.075, z0 + 0.1, 0.6, 0.15, 0.2, PAVE2, "solid", 0.02);
    b(dx0, 0.15, z0 + 0.27, 0.6, 0.3, 0.16, PAVE2, "solid", 0.02);
  }
  // yavru bacalar (aralarda) ve kaya blokları
  fairyChimney(b, x0 + 0.45, z0 + 2.45, 0.06, 1.6, 0.55, TUFF, 91, { ribs: 3 });
  fairyChimney(b, x0 + 5.55, z0 + 5.6, 0.06, 1.9, 0.6, HONEY, 93, { ribs: 3 });
  for (const [bx, bz, s] of [[2.3, 2.5, 0.34], [4.3, 2.55, 0.28], [0.5, 5.6, 0.36], [2.55, 5.65, 0.3], [4.35, 5.7, 0.26]] as const)
    b(x0 + bx, 0.06 + s * 0.4, z0 + bz, s, s * 0.8, s * 0.9, GULLY, "solid", 0.05);
}

// ============================================================================================ kaya kiliseleri (9 × 6)
/** At nalı kemer (−z yüzünde; düzlem zf): kademeli kemer halkası (`ring`), koyu açıklık, çember yayından taşan at nalı omuzlar. */
function horseshoeZ(b: Sink, x: number, y0: number, zf: number, w: number, h: number, c: string, ring?: string, depth = 0.04) {
  const r = w / 2, body = h - r;
  if (ring) {
    b(x, y0 + body / 2, zf + 0.005, w + 0.16, body, 0.03, ring, "solid", 0);
    for (let k = 0; k < 5; k++) { const a = ((k + 0.5) / 5) * (Math.PI / 2) * 1.08, ww = 2 * (r + 0.08) * Math.cos(a) + 0.06; b(x, y0 + body + (r + 0.08) * Math.sin(a) * 0.9, zf + 0.005, ww, (r + 0.08) * 0.24, 0.03, ring, "solid", 0); }
  }
  b(x, y0 + body / 2, zf - depth / 2 + 0.01, w, body, depth, c, "solid", 0);
  // at nalı: yayın alt kısmı açıklıktan biraz geniş (omuz), sonra daralır
  b(x, y0 + body + r * 0.08, zf - depth / 2 + 0.01, w + 0.06, r * 0.16, depth, c, "solid", 0);
  for (let k = 0; k < 4; k++) { const a = ((k + 0.5) / 4) * (Math.PI / 2), ww = 2 * r * Math.cos(a); b(x, y0 + body + r * Math.sin(a) * 0.92, zf - depth / 2 + 0.01, Math.max(0.04, ww), r * 0.26, depth, c, "solid", 0); }
}
function kiliseHi(o: Sink, c: LandmarkCtx) {
  const b = safe(o), { x0, z0, w } = c, X = c.cx;
  // ---- arka kayalık: ince dilimli, düzensiz tepe (üç kabarık), pembe tüf; arkada ve yanlarda oluklar
  const RK: Mass = { sl: [], sw: SW3, sd: SD3, y0: 0, sh: 0.45, rib: 0.6, hole: 0.3 };
  for (let n = 0; n < 13; n++) {
    const t = (n + 0.5) / 13;
    RK.sl.push({ y0: n * 0.45, y1: (n + 1) * 0.45, cx: X + 0.15 * Math.sin(3 * t), cz: z0 + 4.45 + 0.1 * t, rx: 4.3 * (1 - 0.08 * t) / 0.95, rz: 1.4 * (1 - 0.25 * t * t) / 0.97,
      c: Math.abs(t - 0.4) < 0.04 ? mix(CH, BAND, 0.5) : mix(CH, CH2, 0.5 + 0.5 * Math.sin(t * 9)) });
  }
  drawMass(b, RK);
  for (const [dx, rr, hh2, tone] of [[-2.6, 1.2, 1.0, CH], [0.6, 1.3, 0.8, CH2], [3.0, 1.0, 0.6, CH]] as const) // tepe kabarıkları
    for (let k = 0; k < 3; k++) disc(b, X + dx, 5.85 + k * hh2 / 3, z0 + 4.5, rr * (1 - k * 0.28), hh2 / 3 + 0.02, tone, 3, "solid", 0.05);
  // kayalık oluk ve oyukları (arka ve yanlar; ön yüz cepheye ayrılmış)
  for (let n = 0; n < 12; n += 2) for (const f of ["+z", "-x", "+x"] as Face[]) {
    const s = RK.sl[n], fr = isZ(f) ? [-0.85, -0.5, -0.1, 0.35, 0.75] : [-0.5, 0.3];
    fr.forEach((q, k) => {
      if (hh(k + 3, n + dirOf(f)) > 0.6) return;
      const u = isZ(f) ? s.cx + q * s.rx : s.cz + q * s.rz, p = plane(RK, s, f, u, 0.12);
      if (p !== null) onFace(b, f, u, (s.y0 + RK.sl[n + 1].y1) / 2, p, p, 0.14, 0.9, k % 2 ? GULLY : mix(CH, BAND, 0.4), 0.06);
    });
    if (n % 4 === 0) { const u = isZ(f) ? s.cx + (hh(n, 9) - 0.5) * s.rx : s.cz; if (!(f === "-x" && n < 12)) opening(b, RK, f, u, s.y0 + 0.7, "win", 0.3, 0.38); }
  }
  // ---- manastır kütlesi (solda; 7 kat): yuvarlak köşeli kaya kule, kat silmeleri, kemerli pencere/kapı, çökmüş odalar
  const MK: Mass = { sl: [], sw: SW4, sd: SD4, y0: 0, sh: 0.5, rib: 0.4, hole: 0.4 };
  for (let n = 0; n < 14; n++) {
    const t = (n + 0.5) / 14, cap = t > 0.85 ? Math.sqrt(1 - ((t - 0.85) / 0.15) ** 2 * 0.7) : 1;
    MK.sl.push({ y0: n * 0.5, y1: n * 0.5 + 0.5, cx: x0 + 1.22 + 0.05 * t, cz: z0 + 3.6 + 0.12 * t, rx: 1.12 * (1 - 0.1 * t) * cap / 0.97, rz: 1.3 * (1 - 0.1 * t) * cap / 0.97,
      c: mix(CH, CH2, 0.3 + 0.25 * Math.sin(t * 5.5)) });
  }
  drawMass(b, MK);
  b(x0 + 1.25, 7.2, z0 + 3.75, 1.2, 0.4, 1.4, CH2, "solid", 0.05); // tepe (mid tepesi ≈ 7,4)
  for (let f = 0; f < 7; f++) {
    const yy = 0.55 + f * 0.95, s = sliceAt(MK, yy + 0.3)!, s2 = sliceAt(MK, yy)!;
    const pf = plane(MK, s2, "-z", s.cx, 0.6)!;
    if (f > 0) b(s.cx, yy - 0.18, pf - 0.02, 2 * s.rx * 0.45 + 0.02, 0.07, 0.08, CH2, "solid", 0); // kat silmesi (ön düz yüzde)
    const kinds: Kind[] = f === 0 ? ["door", "win"] : f === 3 ? ["room", "win"] : f === 5 ? ["win", "room"] : ["win", "dove"];
    kinds.forEach((k, i) => {
      const u = s.cx + (i ? 0.38 : -0.32);
      if (k === "door") opening(b, MK, "-z", u, yy + 0.05, "door", 0.4, 0.56);
      else if (k === "room") opening(b, MK, "-z", u, yy + 0.2, "room", 0.46, 0.34);
      else if (k === "dove") opening(b, MK, "-z", u, yy + 0.22, "win", 0.18, 0.24);
      else opening(b, MK, "-z", u, yy + 0.2, "door", 0.24, 0.22);
    });
    if (f < 6) { // batı yüzünde oyuk ve tünel ağzı
      opening(b, MK, "-x", s.cz + (f % 2 ? 0.45 : -0.3), yy + 0.25, f % 3 === 1 ? "door" : "win", 0.26, 0.26);
      opening(b, MK, "+x", s.cz + 0.55, yy + 0.25, "win", 0.22, 0.26);
    }
  }
  // ---- kilise cephesi (kayaya oyulmuş, kayalık ön yüzünden 0,3 taşar)
  const fx = X + 0.4, zr = RK.sl[0].cz - RK.sl[0].rz * SD3[2], zf = zr - 0.3;
  b(fx, 2.0, (zf + zr + 0.1) / 2, 4.8, 4.0, zr + 0.1 - zf, CH2, "solid", 0.03);
  for (let k = 0; k < 4; k++) b(fx, 4.07 + k * 0.22, (zf + zr + 0.1) / 2 + 0.02, 4.7 - k * 1.25, 0.24, zr + 0.06 - zf, k % 2 ? CH : CH2, "solid", 0.03); // kademeli alınlık
  b(fx, 4.0, zf - 0.03, 5.0, 0.12, 0.08, TRIM, "solid", 0); // üst silme
  for (let k = 0; k < 16; k++) b(fx - 2.4 + k * 0.32, 3.9, zf - 0.03, 0.12, 0.08, 0.06, TRIM, "solid", 0); // dişler
  b(fx, 2.55, zf - 0.03, 4.9, 0.1, 0.07, TRIM, "solid", 0); // ara silme
  b(fx, 0.08, zf - 0.05, 5.0, 0.16, 0.12, TRIM, "solid", 0); // taban silmesi
  for (const s of [-2.25, -0.8, 0.8, 2.25]) { // plastırlar: kaide, gövde, başlık, impost
    b(fx + s, 0.25, zf - 0.06, 0.32, 0.22, 0.12, TRIM, "solid", 0);
    b(fx + s, 1.36, zf - 0.04, 0.2, 2.02, 0.08, TRIM, "solid", 0);
    b(fx + s, 2.4, zf - 0.06, 0.32, 0.14, 0.12, TRIM, "solid", 0);
  }
  for (const s of [-1.52, 1.52]) horseshoeZ(b, fx + s, 0.16, zf, 0.78, 2.0, HOLE_D, CH, 0.05); // at nalı kapılar
  horseshoeZ(b, fx, 0.7, zf, 0.56, 1.5, mix(CH2, HOLE, 0.35), TRIM, 0.04); // kör kemer
  for (let k = 0; k < 5; k++) { // üst kat: beş sütunceli kör kemer dizisi
    const ax = fx - 1.9 + k * 0.95;
    horseshoeZ(b, ax, 2.7, zf, 0.5, 1.0, mix(CH2, HOLE, 0.3), undefined, 0.035);
    b(ax - 0.475, 3.18, zf - 0.03, 0.08, 0.95, 0.06, TRIM, "solid", 0);
  }
  b(fx + 2.375, 3.18, zf - 0.03, 0.08, 0.95, 0.06, TRIM, "solid", 0);
  // alınlıkta yuvarlak pencere: kademeli daire biçimli açık renk çerçeve halkası ve koyu açıklık (kayıt/kafes YOK — haç
  // biçimi oluşmasın)
  for (const [ww, hh2] of [[0.62, 0.28], [0.48, 0.5], [0.28, 0.62]] as const) b(fx, 4.55, zf + 0.025, ww, hh2, 0.03, TRIM, "solid", 0);
  for (const [ww, hh2] of [[0.44, 0.2], [0.34, 0.36], [0.2, 0.44]] as const) b(fx, 4.55, zf, ww, hh2, 0.04, HOLE, "solid", 0);
  // kayalığın ön yüzünde, alınlığın üstünde güvercinlik sırası (beyaz çerçeveli küçük oyuklar)
  for (let k = 0; k < 9; k++) {
    const u = X - 3.6 + k * 0.9;
    if (Math.abs(u - fx) < 0.6) continue;
    if (k % 3 !== 1) opening(b, RK, "-z", u, 5.15 + (k % 2) * 0.12, "dove", 0.18, 0.24); else opening(b, RK, "-z", u, 5.2, "win", 0.24, 0.3);
  }
  // ---- sağda oyma koni şapel (ince dilimli koni) + kemerli kapı ve pencereler
  const kx = x0 + w - 1.4, kz = z0 + 2.2, KH = 5.6;
  const cone: [number, number, number][] = [];
  for (let n = 0; n < 14; n++) {
    const t = (n + 0.5) / 14, r = 1.0 * (1 - 0.72 * Math.pow(t, 1.1));
    disc(b, kx + 0.06 * t, (n + 0.5) * KH / 14, kz + 0.05 * t, r, KH / 14 + 0.02, Math.abs(t - 0.45) < 0.04 ? BAND : mix(CH2, CH, t), 3, "solid", 0.04);
    cone.push([kx + 0.06 * t, kz + 0.05 * t, r]);
  }
  const cfz = (n: number) => cone[n][1] - discEdge(cone[n][2], 3, -Math.PI / 2);
  for (let n = 0; n + 2 < 11; n += 3) for (let q = 0; q < 5; q++) { // koni olukları (ön yüz hariç)
    const a = ((q + 0.5) / 5) * Math.PI * 1.6 - Math.PI * 0.25, [ccx, ccz, r] = cone[n], e = discEdge(r, 3, a) - 0.02;
    b(ccx + Math.cos(a) * e, (n + 1.5) * KH / 14, ccz + Math.sin(a) * e, 0.1, KH / 14 * 3, 0.1, q % 2 ? GULLY : mix(CH, BAND, 0.4), "solid", 0.01);
  }
  horseshoeZ(b, kx, 0.0, cfz(0) + 0.02, 0.44, 1.0, HOLE_D, CH, 0.06);
  for (const n of [6, 9]) { b(cone[n][0] + (n === 6 ? -0.15 : 0.12), (n + 0.5) * KH / 14, cfz(n), 0.18, 0.24, 0.06, HOLE, "solid", 0); }
  // üst kattaki kapı (koni sağında, 6. basamağın üstünde) ve metal ziyaretçi merdiveni
  const run = 0.32, rise = (KH * 0.34) / 6, sx = x0 + w - 2.3, mzf = kz - 1.0;
  const dn = Math.round(14 * 0.36), dz = cfz(dn);
  horseshoeZ(b, x0 + w - 1.1, 6 * rise, dz + 0.02, 0.4, 0.9, HOLE_D, CH, 0.05);
  for (let k = 0; k < 6; k++) {
    const x = sx + (k + 0.5) * run, ty = (k + 1) * rise;
    b(x, ty - 0.03, mzf - 0.3, run, 0.06, 0.6, METAL, "solid", 0); // basamak
    b(x - run / 2 + 0.02, ty - rise / 2 - 0.01, mzf - 0.3, 0.04, rise + 0.05, 0.6, METAL, "solid", 0); // rıht
    b(x, ty + 0.4, mzf - 0.58, 0.04, 0.8, 0.04, METAL, "solid", 0); // dikme
    b(x, ty + 0.78, mzf - 0.58, run + 0.02, 0.04, 0.04, METAL, "solid", 0); // küpeşte
    b(x, ty + 0.4, mzf - 0.58, run + 0.02, 0.03, 0.03, METAL, "solid", 0); // ara lama
  }
  b(sx + 6 * run + 0.15, 6 * rise - 0.03, mzf - 0.3, 0.3, 0.06, 0.6, METAL, "solid", 0); // sahanlık
  b(sx + 6 * run + 0.15, 6 * rise + 0.4, mzf - 0.58, 0.3, 0.03, 0.03, METAL, "solid", 0);
  // ---- avlu: taş döşeme, alçak taş sınır, giriş fenerleri (kutsal yapıya başka ışık yok)
  b(X, 0.04, z0 + 1.2, w - 0.4, 0.08, 1.6, PAVE, "solid", 0.04);
  for (let k = 0; k < 10; k++) b(x0 + 0.6 + k * 0.85, 0.09, z0 + 1.2 + (k % 2 ? 0.35 : -0.35), 0.7, 0.03, 0.7, PAVE2, "solid", 0.03);
  b(X, 0.15, z0 + 0.3, w - 1.0, 0.3, 0.24, PAVE2, "solid", 0.04);
  for (const s of [-1, 1]) {
    const lx = X + s * (w / 2 - 0.5);
    b(lx, 0.6, z0 + 0.3, 0.07, 0.9, 0.07, METAL, "solid", 0);
    b(lx, 1.12, z0 + 0.3, 0.16, 0.18, 0.16, LAMP, "glow", 0);
  }
}

// ============================================================================================ balon kalkış alanı (14 × 10)
const ENV_COLORS = new Set(["#D9573B", "#F2C14E", "#2F6D8C", "#3F7D6E", "#F2E6D0", "#B9574A"]);
/** Orta modeli korur; yerdeki şişmiş balonun zarfını ince dilimli armut profil + yük şeritleri + taç ve valfle değiştirir;
 *  soğuk şişirme zarfına yük şeritleri, alana kazıklı yer ipleri ve kalkış halkası ekler. */
function kalkisHi(c: LandmarkCtx, mid: readonly Block[]): Block[] {
  const ux = c.x0 + 11.0, uz = c.z0 + 5.2;
  // yerde şişmiş balon zarfı (+ ekvator kuşağı, tepe halkası): sepet ekseni üstünde, eteğin üstündeki renkli kutular
  const envMid = mid.filter((q) => Math.abs(q.p[0] - ux) < 3.2 && Math.abs(q.p[2] - uz) < 3.2 && q.p[1] > 2.4 && q.g === "solid"
    && (ENV_COLORS.has(q.c) || q.c === "#C9CED3"));
  const skirt = mid.filter((q) => Math.abs(q.p[0] - ux) < 1.5 && Math.abs(q.p[2] - uz) < 1.5 && q.c === "#2E2A28").sort((a, b2) => b2.p[1] - a.p[1])[0];
  const drop = new Set(envMid);
  const out: Block[] = mid.filter((q) => !drop.has(q)).map((q) => ({ ...q, p: [...q.p] as Block["p"], s: [...q.s] as Block["s"] }));
  const b = safe(sink(out));
  const y0 = skirt ? skirt.p[1] + skirt.s[1] / 2 : 3.0;
  const yTop = envMid.reduce((a, q) => Math.max(a, q.p[1] + q.s[1] / 2), y0 + 8);
  const C = ["#D9573B", "#F2C14E", "#2F6D8C"];
  // armut profil: 18 dilim; yarıçap ağızdan tepeye (en geniş ≈ %55'te), tepe kubbe
  const H = yTop - 0.2 - y0, NS = 18, sh = H / NS, prof = (t: number) => 2.86 * (t < 0.55 ? 0.42 + 0.58 * Math.sin((t / 0.55) * Math.PI / 2) : Math.sqrt(Math.max(0, 1 - ((t - 0.55) / 0.45) ** 2 * 0.86)));
  // dilimler (gore): 16 köşeli kesitin dört kutusu dönüşümlü renkte → çevrede renkli dilimler; iki dilimde bir kutu köşelerinde
  // dikey koyu yük şeridi (dilim dikişi, zarfa yapışık)
  const K = 4, GC = [C[0], C[1], C[0], C[2]];
  for (let n = 0; n < NS; n++) {
    const t = (n + 0.5) / NS, r = prof(t), y = y0 + n * sh + sh / 2;
    for (let i = 0; i < K; i++) {
      const a = ((i + 0.5) / K) * (Math.PI / 2), w = 2 * r * Math.cos(a), d = 2 * r * Math.sin(a);
      // şafak öncesi brülörle içten aydınlanan zarf ("gece parlaması"): alt dört dilimin iç kutuları durağan ışık (düz renk)
      const glowSl = n < 4 && (i === 1 || i === 2);
      b(ux, y, uz, w, sh + 0.02, d, n === 9 ? "#F2E6D0" : glowSl ? mix(GC[i], "#FFE2B0", 0.25) : GC[i], glowSl ? "glow" : "solid", glowSl ? 0 : 0.02);
      if (n % 2 === 0 && n + 1 < NS && i > 0 && i < K - 1) for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const)
        b(ux + sx * (w / 2 - 0.02), y + sh / 2, uz + sz * (d / 2 - 0.02), 0.05, sh * 2 + 0.02, 0.05, "#7A6A5A", "solid", 0);
    }
  }
  const yt = y0 + H;
  b(ux, yt + 0.06, uz, 0.9, 0.12, 0.9, "#F2E6D0", "solid", 0.02); // paraşüt valfi
  b(ux, yt + 0.15, uz, 0.42, 0.06, 0.42, "#C9CED3", "solid", 0); // taç halkası
  // soğuk şişirme zarfı: yük şeritleri (zarfın üstünde enine)
  const cx0 = c.x0 + 2.0, cz = c.z0 + 2.4;
  for (let k = 0; k < 6; k++) {
    const x = cx0 + 0.5 + k * 0.95, top = mid.filter((q) => Math.abs(q.p[0] - x) < 0.3 && Math.abs(q.p[2] - cz) < 0.2 && q.p[1] < 3).reduce((a, q) => Math.max(a, q.p[1] + q.s[1] / 2), 0);
    if (top > 0.3) b(x, top + 0.01, cz, 0.05, 0.03, 1.2, "#7A6A5A", "solid", 0);
  }
  // kazıklı yer ipleri (zeminde) ve kalkış halkası (zemin boyası)
  for (const [dx, dz] of [[-2.2, 0], [0, 2.4], [2.2, 0]] as const) {
    b(ux + dx / 2, 0.03, uz + dz / 2, Math.abs(dx) || 0.03, 0.03, Math.abs(dz) || 0.03, "#C8B48A", "solid", 0);
    b(ux + dx, 0.12, uz + dz, 0.07, 0.24, 0.07, "#5B4A3A", "solid", 0);
  }
  for (const [w, d, dz] of [[4.6, 0.12, -2.0], [4.6, 0.12, 2.0]] as const) b(ux, 0.012, uz + dz, w, 0.02, d, "#F2E6D0", "solid", 0);
  for (const dx of [-2.3, 2.3]) b(ux + dx, 0.012, uz, 0.12, 0.02, 4.1, "#F2E6D0", "solid", 0);
  return out;
}

// ============================================================================================ kayıtlar
const build = (f: (b: Sink, c: LandmarkCtx) => void): HiResBuild => (c) => { const out: Block[] = []; f(sink(out), c); return out; };

export const KAPADOKYA_HIRES_MAP: HiResMapEntry[] = [
  { map: "kapadokya", landmark: "uchisar_kalesi", hi: build(uchisarHi) },
  { map: "kapadokya", landmark: "peri_bacalari", hi: build(periHi) },
  { map: "kapadokya", landmark: "kaya_kiliseleri", hi: build(kiliseHi) },
  { map: "kapadokya", landmark: "kalkis_alani", hi: kalkisHi },
];

export const KAPADOKYA_HIRES_SCENE: HiResSceneEntry[] = [];
