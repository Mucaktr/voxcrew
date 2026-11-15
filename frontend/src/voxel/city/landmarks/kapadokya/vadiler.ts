/**
 * Kapadokya şehir haritası: **Vadiler** (Güvercinlik ve Aşk vadilerini, Paşabağ'ı andıran) landmarkları ve tasarımı.
 *
 * Göreme'nin batısında, peri bacaları arasından kıvrılan yürüyüş patikaları; kayısı/üzüm bahçeleri; güvercinlik kaya yüzü;
 * çok şapkalı baca kümesi; ince uzun bacalar. Güneydoğuda sırta tırmanan oyma basamaklar (yürünür yükselti) gün batımı seyir
 * düzlüğüne çıkar (seyir noktası + an). Balonla iniş alanı ortada. Yazı, tabela, işletme adı yok.
*/
import type { Block } from "../../../scenes";
import { sink, type DecorCtx, type DistrictDesign, type LandmarkCtx, type LandmarkModel } from "../../../citymap/design";
import { at, boxFar, CAP, chimney, cone, holeZ, KAP, vineRow } from "./kit";

// ------------------------------------------------------------------------------------------ Paşabağ benzeri çok şapkalı küme (5 × 5)
function pasabag(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0 } = c;
  // ortak gövde (kalın tüf sütun) yukarıda üç boyuna ayrılır, her biri ayrı bazalt şapka taşır
  b(c.cx, 1.4, c.cz, 3.6, 2.8, 3.6, KAP.cream, "solid", 0.05);
  b(c.cx, 3.4, c.cz, 2.8, 1.2, 2.8, KAP.tuff, "solid", 0.05);
  chimney(b, x0 + 1.7, z0 + 1.8, 6.8, 1.5, KAP.tuff, CAP, 3.6);
  chimney(b, x0 + 3.3, z0 + 2.0, 5.4, 1.3, KAP.cream, CAP, 3.6);
  chimney(b, x0 + 2.5, z0 + 3.4, 4.6, 1.2, KAP.honey, CAP, 3.6);
  // ortak gövdeye oyulmuş inziva odası: kemerli kapı (ahşap kanat), üstte pencere ve gövdeye yaslı ahşap merdiven
  holeZ(b, c.cx, 1.0, z0 + 0.69, 0.5, 0.9, KAP.trim);
  b(c.cx, 0.95, z0 + 0.65, 0.4, 0.8, 0.03, "#6B4228", "solid", 0);
  holeZ(b, c.cx + 0.9, 2.2, z0 + 0.69, 0.3, 0.36, KAP.trim);
  for (const dx of [0.7, 1.1]) b(c.cx + dx, 1.0, z0 + 0.62, 0.05, 2.0, 0.05, "#6B4A2E", "solid", 0);
  for (let k = 0; k < 5; k++) b(c.cx + 0.9, 0.3 + k * 0.38, z0 + 0.62, 0.4, 0.04, 0.05, "#6B4A2E", "solid", 0);
  return out;
}

// ------------------------------------------------------------------------------------------ Aşk vadisi benzeri ince uzun bacalar (4 × 4)
function askVadisi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0 } = c;
  b(c.cx, 0.3, c.cz, c.w - 0.4, 0.6, c.d - 0.4, KAP.cream, "solid", 0.05);
  // gövdesi ince ve çok uzun sütunlar; tepede küçük koyu başlık
  for (const [dx, dz, h, w] of [[1.0, 1.1, 13.0, 0.9], [2.4, 0.9, 10.6, 0.8], [3.1, 2.6, 12.0, 0.85], [1.4, 3.0, 9.0, 0.75]] as const) {
    b(x0 + dx, h * 0.18, z0 + dz, w * 1.4, h * 0.36, w * 1.4, KAP.cream, "solid", 0.05);
    b(x0 + dx, h * 0.36 + h * 0.27, z0 + dz, w, h * 0.54, w, KAP.tuff, "solid", 0.05);
    b(x0 + dx, h * 0.5, z0 + dz, w * 1.04, h * 0.05, w * 1.04, KAP.band, "solid", 0.04); // erozyon bandı
    b(x0 + dx, h * 0.9 + 0.1, z0 + dz, w * 0.6, h * 0.08, w * 0.6, KAP.tuff, "solid", 0.05);
    b(x0 + dx, h * 0.94 + 0.25, z0 + dz, w * 0.9, 0.3, w * 0.9, CAP, "solid", 0.03);
  }
  return out;
}

// ------------------------------------------------------------------------------------------ güvercinlik kaya yüzü (10 × 3; yüz güneyde)
function guvercinlik(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, w, d } = c, X = c.cx;
  b(X, 2.8, c.cz + 0.3, w, 5.6, d - 0.6, KAP.honey, "solid", 0.06);
  b(X + 1, 6.1, c.cz + 0.5, w - 3, 1.0, d - 1.2, KAP.cream, "solid", 0.06);
  // sıra sıra küçük güvercin yuvası oyukları (yüze yapışık); beyaz badanalı kuşaklar ve çerçeveler (gübre için güvercinlik
  // geleneği), yuva önü taş sekiler, en altta kemerli kapı
  const zf = c.cz + 0.3 - (d - 0.6) / 2 - 0.01;
  for (let r = 0; r < 4; r++) {
    const y = 1.6 + r * 1.05;
    b(X, y - 0.3, zf - 0.01, w - 1.2, 0.08, 0.03, "#F2E6D0", "solid", 0); // badana kuşağı
    for (let q = 0; q < 8; q++) {
      const x = x0 + 0.9 + q * ((w - 1.8) / 7) + (r % 2) * 0.35;
      holeZ(b, x, y, zf, 0.2, 0.24, (q + r) % 2 === 0 ? "#F2E6D0" : undefined);
    }
  }
  holeZ(b, x0 + 1.2, 0.6, zf, 0.6, 1.1, KAP.trim);
  b(x0 + 1.2, 0.55, zf - 0.04, 0.48, 1.0, 0.03, "#6B4228", "solid", 0);
  return out;
}

export const VADILER_LANDMARKS: Record<string, LandmarkModel> = {
  pasabag: { near: pasabag, far: (c) => [{ p: [c.cx, 5, c.cz], s: [3.2, 10, 3.2], c: KAP.tuff, g: "solid", j: 0 }, { p: [c.cx, 10.6, c.cz], s: [2.6, 0.5, 2.6], c: CAP, g: "solid", j: 0 }],
    ip_risk: 0, culture_risk: 0, note: "Çok şapkalı peri bacası kümesi (Paşabağ'ı andırır): ortak gövdeden ayrılan üç baca ve bazalt şapkalar; doğal oluşum." },
  ask_vadisi: { near: askVadisi, far: boxFar(KAP.tuff), ip_risk: 0, culture_risk: 0,
    note: "İnce uzun bacalar (vadideki sütun biçimli bacaları andırır): doğal oluşum; vadi adı arayüzde genel 'uzun bacalar vadisi'." },
  guvercinlik: { near: guvercinlik, far: boxFar(KAP.honey, 0.9), ip_risk: 0, culture_risk: 0,
    note: "Güvercinlik: kaya yüzüne açılmış güvercin yuvaları ve beyaz boya çerçeveler (tarımsal gübre geleneği); figür yok." },
};

// ------------------------------------------------------------------------------------------ semt tasarımı
/** Seyir sırtı: oyma basamaklar li 36–38, lj 4–15 (0,3 → 3,0) ve düzlük li 33–41, lj 16–21 (3,25). */
const RIDGE_STEPS: [number, number, number, number] = [36, 4, 3, 12];
const RIDGE_TOP: [number, number, number, number] = [33, 16, 9, 6];
/** Peri bacası ormanı (katı karolar): patikaların arasında. */
// (STREET-BLOCKED-001): (40, 30) bacası parsel arası 2 karoluk sokağın ortasındaydı (1,6 tabanı iki şeridi de katılaştırıyordu) → (5, 30) çimen
const FOREST: [number, number][] = [[4, 26], [9, 30], [14, 24], [18, 32], [6, 36], [12, 38], [22, 26], [26, 34], [24, 42], [5, 30],
  [44, 40], [42, 52], [36, 58], [18, 56], [10, 60], [28, 60], [4, 52], [16, 8], [26, 10], [30, 4], [8, 18], [42, 8]];

function vadilerDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out), p = at(c);
  FOREST.forEach(([li, lj], k) => {
    const h = 4.2 + ((li * 7 + lj * 3) % 5) * 0.8, w = 1.2 + (k % 3) * 0.2;
    const tone = [KAP.tuff, KAP.cream, KAP.honey, KAP.rose][k % 4];
    if (k % 5 === 4) cone(b, p.x(li), p.z(lj), h * 0.8, w + 0.4, tone, 2);
    else chimney(b, p.x(li), p.z(lj), h, w, tone);
  });
  // seyir sırtı: kaya kütlesi (basamakların iki yanı ve düzlüğün altı katı karolar), basamak korkulukları ve sırt korkuluğu
  b(p.x(RIDGE_TOP[0]) + 4, 1.4, p.z(RIDGE_TOP[1]) + 2.5, 11, 2.8, 8, KAP.rose, "solid", 0.06);
  for (const li of [35, 39]) b(p.x(li), 1.7, p.z(4) + 5.5, 1, 3.4, 12, KAP.honey, "solid", 0.06);
  // basamak korkulukları: dikmeler basamak üstüne oturur (karo üstü y), küpeşte her karoda dikmelere bağlı
  for (let lj = 4; lj < 16; lj++) {
    const top = 0.3 + ((lj - 4) * 2.7) / 11;
    for (const s of [-1, 1]) {
      b(p.x(37) + s * 1.45, top + 0.3, p.z(lj), 0.06, 0.6, 0.06, "#6B4A2E", "solid", 0);
      b(p.x(37) + s * 1.45, top + 0.58, p.z(lj), 0.05, 0.05, 1.0, "#6B4A2E", "solid", 0);
    }
  }
  // sırt korkuluğu (düzlüğün kuzey kenarı): dikmeler düzlük üstünde, küpeşte dikmelere oturur
  for (let k = 0; k <= 6; k++) b(p.x(33) - 0.4 + k * 1.45, 3.25 + 0.3, p.z(21) + 0.45, 0.06, 0.6, 0.06, "#6B4A2E", "solid", 0);
  b(p.x(37), 3.25 + 0.58, p.z(21) + 0.45, 8.8, 0.05, 0.06, "#6B4A2E", "solid", 0);
  // bahçeler: asma sıraları ve kayısı ağaçları (alçak), kuru taş duvar
  for (let lj = 44; lj <= 50; lj += 2) vineRow(b, p.x(16) - 0.5, p.x(27) + 0.5, p.z(lj));
  b(p.x(21), 0.25, p.z(43), 12, 0.5, 0.4, "#B49678", "solid", 0.08);
  // gizli köşeler: kaya oyuğunda eski güvercin yemliği; patika dönemecinde taş yığını (kaya işareti)
  b(p.x(2), 0.3, p.z(60) + 0.35, 0.6, 0.6, 0.25, "#9C7E62"); b(p.x(2), 0.38, p.z(60) + 0.22, 0.3, 0.24, 0.02, "#5A4436");
  for (let k = 0; k < 3; k++) b(p.x(44) + 0.3, 0.12 + k * 0.18, p.z(2) + 0.3, 0.36 - k * 0.1, 0.18, 0.3 - k * 0.08, "#A8977C");
  return out;
}

/**
 * Vadiler (48 × 64; şehir karosu [−48, −16]). Varış meydanı doğuda: giriş (47, 23). Güney kenar (lj 0) Uçhisar'a yürünür patika.
 * Balon iniş durağı (30, 40); Paşabağ benzeri küme [8, 44], uzun bacalar [30, 50], güvercinlik [6, 10]; seyir sırtı (basamaklar
 * li 36–38, lj 4–15; düzlük li 33–41, lj 16–21, seyir noktası (37, 19) — gün batımı anı).
 */
export const VADILER_DESIGN: DistrictDesign = {
  pave: [[0, 22, 48, 3], [30, 0, 3, 22], [10, 0, 2, 22], [20, 25, 2, 39], [36, 4, 3, 12], [33, 16, 9, 6]],
  park: [[2, 28, 6, 4], [34, 44, 10, 6]],
  plaza: [[26, 36, 10, 8]],
  solid: [
    ...FOREST.map(([li, lj]) => [li, lj, 1, 1] as [number, number, number, number]),
    // basamakların iki yanı ve düzlüğün çevresi katı (yükseltiye yalnız basamaklardan çıkılır)
    [35, 4, 1, 11], [39, 4, 1, 11], [32, 15, 4, 1], [39, 15, 4, 1], [32, 16, 1, 6], [42, 16, 1, 6], [32, 22, 11, 1],
  ],
  terraces: [
    { rect: RIDGE_STEPS, y: 0.3, y1: 3.0, dir: "+j", colors: [KAP.cream, KAP.tuff] },
    { rect: RIDGE_TOP, y: 3.25, colors: [KAP.honey] },
  ],
  hidden: [[2, 60], [44, 2]],
  decor: vadilerDecor,
};
