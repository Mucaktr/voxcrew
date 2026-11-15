/**
 * Londra şehir haritası: **Kale ve kule köprüsü**.
 *
 * Kuzey yakada surlarla çevrili beyaz taş kale burcu (dört köşe kulesi, biri yuvarlağımsı; kurşun kubbecikler, mazgallı siper):
 * sur kapısından avluya, burç kapısından içeri → INTERIOR-VIEW müze tarifi (taş salonlar + çatı terası). Doğuda nehir içinde
 * iki Gotik kuleli açılır köprü: güverte yürünür (kulelerin ayakları arasından geçer), kulelerin üstünde iki yaya geçidi, iki
 * yanda kıyıya inen mavi-beyaz asma zincirler. Güvertenin ortası seyir noktası. Bayrak, arma, taç, yazı yok; kale muhafızları
 * (gerçek kişi/üniforma) konmadı, avluda yalnız kuzgunlar.
*/
import type { Block } from "../../../scenes";
import { sink, type DecorCtx, type DistrictDesign, type LandmarkCtx, type LandmarkGarden, type LandmarkModel, type Sink } from "../../../citymap/design";
import { at, L, lamp, tree } from "./kit";
import { placeVenue, venueSolidTiles } from "../../venues";
import { genFar } from "./farLod.gen";

const STONE = "#C9BFAE", STONE_L = "#DCD3C0", BLUE = "#5C8FB8", WHITE = "#EEF1F3";

// ------------------------------------------------------------------------------------------ kule köprüsü (ayak izi doğu ayağı 1 × 2)
/** CITY-PASS-LON ( "Açılır köprü"): ayak izi güney kulesinin doğu ayağıdır (li 23, lj 14–15);
 * güverte li 20–22, kuleler lj 14–15 ve 21–22 (açıklık eskisinin ≈ 3 katı: gerçekte orta açıklık ≈ kule boyu), ayaklar li 19
 * ve 23. Her kule: güverteyi açık bırakan iki taş ayak + sivri kemer, kemerin üstünde kareye yakın gövde, dört köşede sekizgen
 * kule ve sivri başlık, kademeli dik çatı ve yaldız tepe. Güverteden yüksekte iki mavi-beyaz kafes yaya geçidi (kulenin
 * ≈ %68'i), iki yanda kuleden kıyıdaki taş ayak kulelerine (li 19 / 23 × lj 11 ve 24) inen kesintisiz mavi-beyaz asma zincirler.*/
function kuleKoprusu(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const DX = c.x0 - 1.5, Zs = c.z0 + 1, Zn = c.z0 + 8, oz = c.z0 - 14;
  // güverte kenar kirişleri (su üstünde mavi), korkuluklar, açılır kanat derzi
  for (const s of [-1.55, 1.55]) {
    b(DX + s, -0.25, oz + 18, 0.2, 0.5, 13.6, BLUE, "solid", 0);
    b(DX + s * 0.97, 0.35, oz + 18, 0.08, 0.7, 13.6, WHITE, "solid", 0);
  }
  b(DX, 0.02, (Zs + Zn) / 2, 2.8, 0.03, 0.06, "#8A939E", "solid", 0);
  for (const Z of [Zs, Zn]) {
    // iki ayak (güverteyi açık bırakır) + sivri kemer; ayaklar üstünde kareye yakın gövde, pencereler
    for (const s of [-2, 2]) b(DX + s, 1.7, Z, 1.0, 3.4, 2.4, STONE, "solid", 0.02);
    b(DX, -0.5, Z, 5.4, 0.9, 3.0, "#8E8A80", "solid", 0.03);
    b(DX, 3.55, Z, 5.0, 0.4, 2.6, STONE_L, "solid", 0);
    for (const [w, y] of [[2.6, 3.25], [1.6, 3.05]] as const) for (const s of [-1, 1]) b(DX + s * (1.5 - (3 - w) / 4), y, Z, (3 - w) / 2, 0.2, 2.5, STONE_L, "solid", 0);
    b(DX, 6.0, Z, 4.6, 4.5, 2.6, STONE, "solid", 0.02);
    for (const fz of [Z - 1.32, Z + 1.32]) for (const u of [-1.2, -0.4, 0.4, 1.2]) for (const y of [4.8, 6.8]) b(DX + u, y, fz, 0.3, 1.1, 0.04, L.winD, "solid", 0);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const px = DX + sx * 2.35, pz = Z + sz * 1.2;
      b(px, 5.0, pz, 0.6, 10.0, 0.42, STONE_L, "solid", 0);
      b(px, 5.0, pz, 0.42, 10.0, 0.6, STONE_L, "solid", 0);
      b(px, 10.25, pz, 0.42, 0.5, 0.42, L.spire, "solid", 0.02);
      b(px, 10.7, pz, 0.24, 0.4, 0.24, L.spire, "solid", 0.02);
      b(px, 11.1, pz, 0.08, 0.4, 0.08, L.gold, "solid", 0);
    }
    b(DX, 8.35, Z, 5.2, 0.2, 2.8, STONE_L, "solid", 0);
    for (const [w, y] of [[4.2, 8.75], [3.2, 9.35], [2.2, 9.95], [1.2, 10.55], [0.5, 11.15]] as const) b(DX, y, Z, w, 0.6, w * 0.55, L.spire, "solid", 0.02);
    b(DX, 12.3, Z, 0.1, 1.7, 0.1, L.gold, "solid", 0);
  }
  // yüksek yaya geçitleri: mavi alt/üst başlık + beyaz kafes dikmeleri (iki yan yüzde)
  const wz = (Zs + Zn) / 2, wl = Zn - Zs - 2.6;
  for (const s of [-1.4, 1.4]) {
    b(DX + s, 9.2, wz, 0.5, 0.2, wl, BLUE, "solid", 0);
    b(DX + s, 8.5, wz, 0.5, 0.2, wl, BLUE, "solid", 0);
    for (let k = 0; k < 6; k++) b(DX + s * 1.1, 8.85, wz - wl / 2 + 0.35 + k * ((wl - 0.7) / 5), 0.04, 0.5, 0.08, WHITE, "solid", 0);
    b(DX + s * 1.1, 8.85, wz, 0.04, 0.06, wl, WHITE, "solid", 0);
  }
  // yan açıklıklar: kuleden kıyıdaki taş ayak kulelerine kesintisiz asma zincirler (birbirine değen halkalar)
  for (const [Z, dir, end] of [[Zs, -1, oz + 11.5], [Zn, 1, oz + 24.5]] as const) for (const s of [-1.9, 1.9]) {
    const z0 = Z + dir * 1.3, N = 10;
    for (let k = 0; k < N; k++) {
      const f = (k + 0.5) / N, z = z0 + (end - z0) * f, y = 1.7 + 6.2 * Math.pow(1 - f, 1.6);
      const y2 = 1.7 + 6.2 * Math.pow(1 - (k + 1) / N, 1.6), y1 = 1.7 + 6.2 * Math.pow(1 - k / N, 1.6);
      b(DX + s, y, z, 0.16, Math.abs(y1 - y2) + 0.16, Math.abs(end - z0) / N + 0.06, k % 2 ? WHITE : BLUE, "solid", 0);
    }
    b(DX + s, 0.9, end, 0.6, 1.8, 0.6, STONE, "solid", 0.02);
    b(DX + s, 1.95, end, 0.36, 0.3, 0.36, L.spire, "solid", 0.02);
  }
  return out;
}
const kopruFar = (c: LandmarkCtx): Block[] => [
  { p: [c.x0 - 1.5, 5.6, c.z0 + 1], s: [5, 11.2, 2.6], c: STONE, g: "solid", j: 0 },
  { p: [c.x0 - 1.5, 5.6, c.z0 + 8], s: [5, 11.2, 2.6], c: STONE, g: "solid", j: 0 },
  { p: [c.x0 - 1.5, 8.85, c.z0 + 4.5], s: [3.3, 0.9, 4.4], c: BLUE, g: "solid", j: 0 },
];

// ------------------------------------------------------------------------------------------ kale burcu (9 × 9, h 8)
/** TOUR-VIEW (LANDMARK-GARDEN-001): burç ayak izinin (9 × 9) içinde kalenin dış avlusu — burç bu oranda daralır (xz; yükseklik aynı),
 *  çevresinde 1 karoluk yürünür taş sur içi (iç sur yolu, 32 karo; köşe kuleleri burca yaslanır). Giriş duvarsız açık kenardan. */
const KEEP_S = 0.78;
const KALE_GARDEN: LandmarkGarden = { kind: "bailey", rects: [[0, 0, 9, 1], [0, 8, 9, 1], [0, 1, 1, 7], [8, 1, 1, 7]], gates: [], floor: "plaza" };

function kale(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b0 = sink(out);
  const X = c.cx, Z = c.cz, H = 6.0, K = "#E4DCCB", KD = "#B5AA92";
  const b: Sink = (x, y, z, w, h, d, col, g, j) => b0(X + (x - X) * KEEP_S, y, Z + (z - Z) * KEEP_S, w * KEEP_S, h, d * KEEP_S, col, g, j);
  b0(X, 0.07, Z, 8.6, 0.14, 8.6, KD, "solid", 0.03); // alçak taş döşeme (yürüme bandının altında; sur yolu)
  b(X, H / 2, Z, 7.4, H, 7.4, K, "solid", 0.02);
  // güneydoğu köşesinde yarım daire şapel çıkıntısı (apsis; basamaklı yuvarlak) ve dar Norman pencereleri
  for (const [w, d, dz] of [[2.4, 0.7, -3.95], [1.8, 0.4, -4.45]] as const) b(X + 2.0, H * 0.42, Z + dz, w, H * 0.84, d, K, "solid", 0.02);
  for (const u of [1.5, 2.5]) b(X + u, 2.6, Z - 4.67, 0.22, 0.8, 0.04, L.winD, "solid", 0); // apsisin ön yüzü (-4,45 − 0,2 = -4,65) üstünde
  b(X, 2.0, Z - 3.72, 7.42, 0.08, 0.04, KD, "solid", 0);
  // güney cephesi: kapı merdiveni, iki kat kemerli pencere; diğer yüzlerde tek sıra
  b(X, 0.9, Z - 3.72, 0.9, 1.6, 0.04, "#3A3028", "solid", 0);
  b(X, 0.35, Z - 4.1, 1.4, 0.7, 0.8, KD, "solid", 0.02);
  for (const y of [3.1, 4.7]) for (const u of [-2.2, -1.1, 1.1, 2.2]) b(X + u, y, Z - 3.72, 0.32, 0.7, 0.04, L.winD, "solid", 0);
  for (const [nx, nz] of [[0, 1], [1, 0], [-1, 0]]) for (const u of [-1.6, 0, 1.6]) b(X + nx * 3.72 + (nz ? u : 0), 4.0, Z + nz * 3.72 + (nx ? u : 0), nz ? 0.32 : 0.04, 0.7, nx ? 0.32 : 0.04, L.winD, "solid", 0);
  // mazgallı siper (her yüzde üç dişli kat)
  for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) for (const u of [-1.6, 0, 1.6]) b(X + nx * 3.55 + (nz ? u : 0), H + 0.25, Z + nz * 3.55 + (nx ? u : 0), nz ? 0.7 : 0.3, 0.5, nx ? 0.7 : 0.3, K, "solid", 0.02);
  // köşe kuleleri (kuzeydoğu yuvarlağımsı), kurşun kubbecikler, yaldız rüzgârgülü çubukları
  for (const [sx, sz, round] of [[-1, -1, false], [1, -1, false], [-1, 1, false], [1, 1, true]] as const) {
    const px = X + sx * 3.4, pz = Z + sz * 3.4;
    b(px, (H + 1.2) / 2, pz, 1.3, H + 1.2, 1.3, K, "solid", 0.02);
    if (round) b(px, (H + 1.0) / 2, pz, 1.6, H + 1.0, 0.9, K, "solid", 0.02);
    // CITY-PASS-LON: soğan biçimli kurşun kubbecikler (boğaz → şişkin gövde → sivri uç) ve yaldız rüzgârgülü
    for (const [w, h, y] of [[1.0, 0.16, H + 1.28], [1.4, 0.26, H + 1.49], [1.2, 0.22, H + 1.73], [0.8, 0.18, H + 1.93], [0.44, 0.14, H + 2.09], [0.2, 0.14, H + 2.23]] as const) b(px, y, pz, w, h, w, "#7F8A94", "solid", 0.02);
    b(px, H + 2.44, pz, 0.06, 0.3, 0.06, L.gold, "solid", 0); // rüzgârgülü (tepe ≤ h + 0,6)
    b(px + 0.13, H + 2.52, pz, 0.22, 0.04, 0.03, L.gold, "solid", 0);
  }
  return out;
}

export const KALE_LANDMARKS: Record<string, LandmarkModel> = {
  kule_koprusu: { near: kuleKoprusu, far: kopruFar, ip_risk: 0, culture_risk: 0,
    note: "İki Gotik kuleli açılır köprü: kulelerin ayakları arasından geçen yürünür güverte, üst yaya geçitleri, mavi-beyaz asma zincirler; gerçek orana yakın kule/açıklık oranı. İşletme işareti, arma ve yazı yok." },
  kale: { near: kale, far: genFar("kale"), ip_risk: 0, culture_risk: 0, garden: KALE_GARDEN, // uzak LOD Blender'dan (farLod.gen.ts)
    note: "Beyaz taş kale burcu ve surlar: dört köşe kulesi, kurşun kubbecikler, mazgallı siper. Girilebilir: INTERIOR-VIEW taş müze tarifi (salonlar + çatı terası); taç mücevheri, muhafız üniforması, arma ve bayrak yok." },
};

// ------------------------------------------------------------------------------------------ semt süsleri
function kaleDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out), p = at(c);
  const ST = "#A39E94", WALL = "#CFC6B2";
  // rıhtım korkulukları (köprü ağzı açık)
  for (const [a, e] of [[0, 19], [24, 48]] as const) {
    b(c.ox + (a + e) / 2, 0.35, c.oz + 11.94, e - a, 0.7, 0.12, ST, "solid", 0.03);
    b(c.ox + (a + e) / 2, 0.35, c.oz + 24.06, e - a, 0.7, 0.12, ST, "solid", 0.03);
  }
  // sur duvarları (tasarım `solid` karolarının üstü) ve mazgallar; sur kapısı köşkleri
  const wall = (x: number, z: number, w: number, d: number) => b(c.ox + x, 1.0, c.oz + z, w, 2.0, d, WALL, "solid", 0.03);
  wall(27.5, 26.5, 7, 1); wall(37.5, 26.5, 7, 1); wall(32.5, 40.5, 17, 1); wall(24.5, 33.5, 1, 15); wall(40.5, 33.5, 1, 15);
  for (let k = 0; k < 8; k++) { b(c.ox + 25 + k * 2, 2.2, c.oz + 40.5, 0.6, 0.4, 1, WALL, "solid", 0); b(c.ox + 24.5, 2.2, c.oz + 27.5 + k * 1.7, 1, 0.4, 0.6, WALL, "solid", 0); b(c.ox + 40.5, 2.2, c.oz + 27.5 + k * 1.7, 1, 0.4, 0.6, WALL, "solid", 0); }
  for (const x of [30.5, 34.5]) { b(c.ox + x, 1.5, c.oz + 26.5, 1.2, 3.0, 1.4, WALL, "solid", 0.02); b(c.ox + x, 3.2, c.oz + 26.5, 1.3, 0.4, 1.5, "#7F8A94", "solid", 0.02); }
  // sur dışı kuru hendek (çim) ve avluda kuzgunlar
  b(c.ox + 32.5, 0.02, c.oz + 25.4, 18, 0.04, 0.9, L.grass, "solid", 0.05);
  for (const [li, lj] of [[29, 37], [35, 31]] as const) { b(p.x(li), 0.12, p.z(lj), 0.26, 0.16, 0.14, "#1F2226", "solid", 0); b(p.x(li) + 0.14, 0.2, p.z(lj), 0.1, 0.1, 0.1, "#1F2226", "solid", 0); }
  // kıyı fenerleri ve ağaçlar
  for (const li of [4, 14, 30, 42]) lamp(b, p.x(li), c.oz + 24.4);
  for (const li of [4, 30, 42]) lamp(b, p.x(li), c.oz + 11.6);
  for (const li of [6, 14, 44]) tree(b, p.x(li), p.z(30), 0.9);
  // gizli köşeler: arka sokakta eski çeşme; güney kıyı köşesinde halat yığını
  b(p.x(2), 0.5, p.z(44) - 0.55, 0.6, 1.0, 0.4, "#8E8A80", "solid", 0.02); b(p.x(2), 0.6, p.z(44) - 0.33, 0.1, 0.1, 0.1, "#5C8FB8", "solid", 0); // gizli köşe süsü karonun kenarında (avatar gövdesi süse girmez)
  b(p.x(46), 0.12, p.z(2), 0.6, 0.24, 0.6, "#C9A066", "solid", 0.06);
  // CORE-WALK: balık-patates dükkânı (ritüel `balik_patates`; eski rıhtım bankının yerine) — kale iskelesinin güneyinde,
  // tezgâh li 7–9 lj 28, sipariş karosu (8, 27), pub bankı + masa lj 26. Engelli karolar `solid`'de.
  placeVenue(b, "chip_shop", p.x(8), p.z(28), "-z", "walk");
  return out;
}

/**
 * Kale ve kule köprüsü (48 × 48; şehir karosu [12, 0]). Güney yaka lj 0–11 (varış meydanının doğu kenarına bağlı), Thames
 * lj 12–23; köprü güvertesi li 20–22 (lj 11–24), kule ayakları li 19 ve 23 × lj 14–15 / 21–22 (doğu-güney ayağı landmark ayak
 * izi), zincir ayak kuleleri li 19 / 23 × lj 11 ve 24, güverte ortası seyir noktası [21, 18]. Kuzey yakada nehir iskelesi [10, 24], surlar li 24–40 × lj 26–40 (güney kapısı
 * li 31–33), burç [28, 30] (kapı [32, 29]); metro (li 28, kuzey kenar) durağı [28, 44].
 */
export const KALE_DESIGN: DistrictDesign = {
  water: [[0, 12, 48, 12]],
  pave: [[20, 11, 3, 14]],
  plaza: [[0, 10, 48, 2], [0, 24, 48, 1], [25, 27, 15, 13]],
  solid: [...venueSolidTiles("chip_shop", "-z").map(([di, dj]): [number, number, number, number] => [8 + di, 28 + dj, 1, 1]), [19, 14, 1, 2], [19, 21, 1, 2], [23, 21, 1, 2],
    [19, 11, 1, 1], [23, 11, 1, 1], [19, 24, 1, 1], [23, 24, 1, 1], // CITY-PASS-LON: kule ayakları ve zincir ayak kuleleri
    [24, 26, 7, 1], [34, 26, 7, 1], [24, 40, 17, 1], [24, 27, 1, 13], [40, 27, 1, 13]],
  hidden: [[2, 44], [46, 2]],
  decor: kaleDecor,
};
