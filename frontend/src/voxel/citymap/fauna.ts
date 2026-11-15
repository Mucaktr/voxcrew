/**
 * CITY-FAUNA (CEO 31 Ekim: "şehirlere has hayvanları da gösterebiliriz — İstanbul'da yunuslar, Mısır'da Nil timsahları…") —
 * şehir haritasında şehre özgü, gerçek ölçekli ortam hayvanları. Saf modül (React/three yok; Node testinde yüklenir).
 *
 *  - **Tür ve ölçek:** modeller metre cinsinden yazılır, `M` (1 birim ≈ 1,75 m; yürüme insanı 1,0) ile birime çevrilir — yunus
 *    ≈ 2 m, Nil timsahı ≈ 4,3 m, zebu ≈ 1,4 m, kedi ≈ 0,45 m. Şiddet, kan, saldırı yok: timsah yavaş süzülür ve kıyıda güneşlenir.
 *  - **Yaşam alanı maskesi** (`faunaTile`): her karo için bit kümesi — açık su (köprü/iskele altı değil, tekne rotasından ≥ 2 karo),
 *    derin su (8 komşusu da açık su: yunus), gölet (≤ `POND_MAX` karoluk su gövdesi: koi), kıyı (suya bitişik yürünür karo), zemin
 *    (sokak/meydan/park; durak, kapı, seyir, ray, simge alanı değil), park, hava. Engel: yürünür karoda zeminden yükselen katı
 *    blok (lamba direği, bank, çit) karoyu kapatır; kutsal simge tamponu ve yerde giden hat koridoru hayvansız. Her tür bir ya da
 *    iki sınıfa izinlidir (`Species.habitat`): su / kıyı / zemin / hava. Hareket parçası karo karo örneklenir — yol maskeden
 *    çıkmaz (duvara, iskeleye, tekneye, binaya girmez, yürünmez karoyu geçmez).
 *  - **Akış:** kadro (`faunaRoster`) yalnız semt planından (karo türü) belirlenimci kurulur; hayvan, parseli yüklü ve avatara
 *    `FAUNA_RADIUS` içindeyken etkinleşir (yuvası o anda maskeyle doğrulanır, geçersizse aynı parselde en yakın geçerli karoya
 *    taşınır, yoksa düşer). Karede en çok `FAUNA_MAX_ACTIVE` hayvan, `FAUNA_MAX_BOXES` kutu → tek örneklenmiş dizi, tek malzeme
 *    (+1 çizim çağrısı; hiç yoksa dizi gizli).
 *  - **Gece / hareket azaltma:** gündüz türleri (kuşlar, papağan, maymun…) gece yuvada (çizilmez); hareket azaltmada saat durur,
 *    yürüyenler durur, uçanlar ve yunus gizli.
 *
 * Bayrak, logo, yazı, simge yok. Denetim: `scripts/city_fauna.test.mjs`.
 */
import { CITY_PD, CITY_PW, districtAt, type CityMapFile, type CityTile } from "./format";
import { districtParcel, districtPlan, districtWater, T_DOOR, T_GROUNDS, T_PARK, T_PLAZA, T_RAIL, T_STOP, T_STREET, T_VIEW, T_WATER } from "./district";
import { sacredZonesOf } from "./shell";
import { lineRoute, VEHICLES } from "../transit/model";
import { withFullFauna } from "../../full/fauna";

/** 1 metre (birim; yürüme insanı 1,0 ≈ 1,75 m). */
export const M = 1 / 1.75;
export const FAUNA_MAX_ACTIVE = 16;
export const FAUNA_MAX_BOXES = 256;
/** Avatara en çok uzaklık (birim) — yakın + uzak halka içinde. */
export const FAUNA_RADIUS = 40;
/** Bundan küçük su gövdesi gölettir; liman olmayan semtin suyu da durgun sayılır (koi). */
export const POND_MAX = 60;
const ROUTE_GAP_WATER = 2, ROUTE_GAP_GROUND = 1, SACRED_GAP = 2;

// ------------------------------------------------------------------------------------------ yaşam alanı bitleri
export const H_WATER = 1, H_DEEP = 2, H_POND = 4, H_SHORE = 8, H_GROUND = 16, H_PARK = 32, H_AIR = 64;
/** Dört sınıf (sözleşme): su, kıyı, zemin, hava. */
export type HabitatClass = "water" | "shore" | "ground" | "air";
export const CLASS_BITS: Readonly<Record<HabitatClass, number>> = { water: H_WATER, shore: H_SHORE, ground: H_GROUND, air: H_AIR };

type V3 = [number, number, number];
export type PartRole = "legA" | "legB" | "tail" | "head" | "wingL" | "wingR";
/** Parça (metre): merkez, boyut, renk, rol (animasyon), dönme pivotu (yoksa rolün varsayılanı). */
export interface FPart { c: V3; s: V3; col: string; role?: PartRole; q?: V3 }
export type Motion = "walk" | "swim" | "dolphin" | "fly" | "amphi";
export interface Species {
  id: string;
  /** izinli sınıflar (sözleşme) ve ek daraltma: `deep` (derin su), `pond` (gölet), `park` (yalnız park zemini) */
  habitat: readonly HabitatClass[];
  refine?: "deep" | "pond" | "park";
  motion: Motion;
  /** hız (birim/sn), dolaşma yarıçapı (karo), gece görünür mü */
  speed: number; roam: number; night: boolean;
  /** avatardan kaçar mı (yaklaşınca uzaklaşır) */
  shy: boolean;
  /** suda gövde dibi su yüzeyine göre (birim; − batık) */
  sink?: number;
  parts: FPart[];
}

// ------------------------------------------------------------------------------------------ modeller (metre)
const legs = (x: number, z: number, h: number, w: number, col: string): FPart[] => [
  { c: [-x, h / 2, z], s: [w, h, w], col, role: "legA" }, { c: [x, h / 2, z], s: [w, h, w], col, role: "legB" },
  { c: [-x, h / 2, -z], s: [w, h, w], col, role: "legB" }, { c: [x, h / 2, -z], s: [w, h, w], col, role: "legA" },
];
/** Küçük yürüyen kuş (güvercin, karga, saksağan, martı): boy (m) ve renkler. */
function walkerBird(L: number, body: string, head: string, wing: string, bill: string, leg: string, belly?: string): FPart[] {
  const k = L / 0.32;
  const p: FPart[] = [
    { c: [0, 0.13 * k, 0], s: [0.1 * k, 0.1 * k, 0.2 * k], col: body },
    { c: [0, 0.2 * k, 0.11 * k], s: [0.08 * k, 0.08 * k, 0.08 * k], col: head, role: "head", q: [0, 0.16 * k, 0.08 * k] },
    { c: [0, 0.195 * k, 0.175 * k], s: [0.025 * k, 0.025 * k, 0.05 * k], col: bill, role: "head", q: [0, 0.16 * k, 0.08 * k] },
    { c: [-0.0575 * k, 0.14 * k, -0.02 * k], s: [0.015 * k, 0.07 * k, 0.17 * k], col: wing, role: "wingL", q: [-0.05 * k, 0.17 * k, 0] },
    { c: [0.0575 * k, 0.14 * k, -0.02 * k], s: [0.015 * k, 0.07 * k, 0.17 * k], col: wing, role: "wingR", q: [0.05 * k, 0.17 * k, 0] },
    { c: [0, 0.145 * k, -0.15 * k], s: [0.06 * k, 0.02 * k, 0.12 * k], col: wing, role: "tail", q: [0, 0.145 * k, -0.09 * k] },
    { c: [-0.025 * k, 0.04 * k, 0.01 * k], s: [0.015 * k, 0.08 * k, 0.015 * k], col: leg, role: "legA" },
    { c: [0.025 * k, 0.04 * k, 0.01 * k], s: [0.015 * k, 0.08 * k, 0.015 * k], col: leg, role: "legB" },
  ];
  if (belly) p.push({ c: [0, 0.1 * k, 0.03 * k], s: [0.08 * k, 0.05 * k, 0.12 * k], col: belly });
  return p;
}
/** Uçan papağan (gövde merkezi y = 0; kanatlar iç kenardan çırpar). */
function parrotParts(L: number, body: string, wing: string, band: string): FPart[] {
  const k = L / 0.85;
  return [
    { c: [0, 0, 0], s: [0.14 * k, 0.14 * k, 0.3 * k], col: body },
    { c: [0, 0.06 * k, 0.2 * k], s: [0.12 * k, 0.12 * k, 0.12 * k], col: body, role: "head", q: [0, 0.03 * k, 0.15 * k] },
    { c: [0, 0.03 * k, 0.285 * k], s: [0.05 * k, 0.07 * k, 0.05 * k], col: "#E8E0D0", role: "head", q: [0, 0.03 * k, 0.15 * k] },
    { c: [-0.27 * k, 0.01 * k, 0], s: [0.4 * k, 0.03 * k, 0.22 * k], col: wing, role: "wingL", q: [-0.07 * k, 0.01 * k, 0] },
    { c: [0.27 * k, 0.01 * k, 0], s: [0.4 * k, 0.03 * k, 0.22 * k], col: wing, role: "wingR", q: [0.07 * k, 0.01 * k, 0] },
    { c: [-0.26 * k, 0.012 * k, 0.07 * k], s: [0.34 * k, 0.036 * k, 0.05 * k], col: band, role: "wingL", q: [-0.07 * k, 0.01 * k, 0] },
    { c: [0.26 * k, 0.012 * k, 0.07 * k], s: [0.34 * k, 0.036 * k, 0.05 * k], col: band, role: "wingR", q: [0.07 * k, 0.01 * k, 0] },
    { c: [0, -0.01 * k, -0.38 * k], s: [0.06 * k, 0.03 * k, 0.46 * k], col: body, role: "tail", q: [0, 0, -0.15 * k] },
  ];
}

export const SPECIES: Readonly<Record<string, Species>> = {
  // İstanbul Boğazı: tırtak/yunus (≈ 2 m) — derin açık suda yüzeye çıkış yayı
  dolphin: { id: "dolphin", habitat: ["water"], refine: "deep", motion: "dolphin", speed: 1.6, roam: 10, night: false, shy: false, parts: [
    { c: [0, 0, 0], s: [0.45, 0.42, 1.5], col: "#5E7287" },
    { c: [0, -0.15, 0.05], s: [0.36, 0.14, 1.2], col: "#D3DCE4" },
    { c: [0, -0.06, 0.9], s: [0.16, 0.13, 0.32], col: "#5E7287", role: "head", q: [0, 0, 0.7] },
    { c: [0, 0.33, -0.1], s: [0.07, 0.26, 0.3], col: "#46586B" },
    { c: [-0.3, -0.13, 0.3], s: [0.2, 0.05, 0.16], col: "#46586B" },
    { c: [0.3, -0.13, 0.3], s: [0.2, 0.05, 0.16], col: "#46586B" },
    { c: [0, 0, -0.95], s: [0.18, 0.18, 0.42], col: "#5E7287", role: "tail", q: [0, 0, -0.75] },
    { c: [0, 0, -1.25], s: [0.66, 0.06, 0.22], col: "#46586B", role: "tail", q: [0, 0, -0.75] },
  ] },
  // sokak kedisi (≈ 0,45 m gövde)
  cat: { id: "cat", habitat: ["ground", "shore"], motion: "walk", speed: 0.5, roam: 5, night: true, shy: true, parts: [
    { c: [0, 0.2, 0], s: [0.16, 0.14, 0.4], col: "#C9853F" },
    { c: [0, 0.29, 0.25], s: [0.14, 0.13, 0.13], col: "#C9853F", role: "head", q: [0, 0.25, 0.18] },
    { c: [-0.045, 0.375, 0.26], s: [0.04, 0.05, 0.03], col: "#9C6230", role: "head", q: [0, 0.25, 0.18] },
    { c: [0.045, 0.375, 0.26], s: [0.04, 0.05, 0.03], col: "#9C6230", role: "head", q: [0, 0.25, 0.18] },
    { c: [0, 0.34, -0.22], s: [0.04, 0.22, 0.04], col: "#9C6230", role: "tail", q: [0, 0.24, -0.2] },
    ...legs(0.05, 0.14, 0.13, 0.045, "#C9853F"),
  ] },
  // martı (kıyıda yürür; sürüler zaten canlı katmanda uçar)
  gull: { id: "gull", habitat: ["shore", "ground"], motion: "walk", speed: 0.4, roam: 4, night: false, shy: true,
    parts: walkerBird(0.55, "#F4F4F0", "#FFFFFF", "#AEB7BF", "#F2C14E", "#E8B04A") },
  // Nil timsahı (≈ 4,3 m): suda yavaş süzülür, kıyıya çıkıp güneşlenir
  crocodile: { id: "crocodile", habitat: ["water", "shore"], motion: "amphi", speed: 0.22, roam: 6, night: true, shy: false, sink: -0.14, parts: [
    { c: [0, 0.18, 0], s: [0.7, 0.3, 1.8], col: "#55603F" },
    { c: [0, 0.05, 0], s: [0.6, 0.06, 1.6], col: "#B8B07A" },
    { c: [0, 0.14, 1.25], s: [0.42, 0.2, 0.72], col: "#4D5838", role: "head", q: [0, 0.16, 0.9] },
    { c: [-0.13, 0.28, 1.0], s: [0.1, 0.08, 0.1], col: "#3E4730", role: "head", q: [0, 0.16, 0.9] },
    { c: [0.13, 0.28, 1.0], s: [0.1, 0.08, 0.1], col: "#3E4730", role: "head", q: [0, 0.16, 0.9] },
    { c: [0, 0.15, -1.45], s: [0.4, 0.24, 1.1], col: "#55603F", role: "tail", q: [0, 0.15, -0.9] },
    { c: [0, 0.13, -2.2], s: [0.2, 0.18, 0.5], col: "#4D5838", role: "tail", q: [0, 0.15, -0.9] },
    ...legs(0.42, 0.6, 0.14, 0.17, "#4D5838"),
  ] },
  // kutsal aynak (ibis; ≈ 0,7 m): kıyıda yürür, gagasıyla yoklar
  ibis: { id: "ibis", habitat: ["shore"], motion: "walk", speed: 0.3, roam: 4, night: false, shy: true, parts: [
    { c: [0, 0.42, 0], s: [0.16, 0.17, 0.32], col: "#F5F3EE" },
    { c: [0, 0.58, 0.15], s: [0.05, 0.2, 0.05], col: "#1F1F22", role: "head", q: [0, 0.48, 0.13] },
    { c: [0, 0.69, 0.19], s: [0.06, 0.06, 0.08], col: "#1F1F22", role: "head", q: [0, 0.48, 0.13] },
    { c: [0, 0.65, 0.3], s: [0.025, 0.025, 0.16], col: "#2A2A2E", role: "head", q: [0, 0.48, 0.13] },
    { c: [0, 0.43, -0.2], s: [0.12, 0.08, 0.1], col: "#2A2A2E", role: "tail", q: [0, 0.43, -0.15] },
    { c: [-0.04, 0.17, 0], s: [0.025, 0.34, 0.025], col: "#2A2A2E", role: "legA" },
    { c: [0.04, 0.17, 0], s: [0.025, 0.34, 0.025], col: "#2A2A2E", role: "legB" },
  ] },
  // su varanı (≈ 1,8 m): kanal kıyısında yürür, suya girip yüzer
  monitor: { id: "monitor", habitat: ["shore", "water"], motion: "amphi", speed: 0.35, roam: 5, night: false, shy: true, sink: -0.05, parts: [
    { c: [0, 0.12, 0], s: [0.28, 0.14, 0.7], col: "#3F4434" },
    { c: [0, 0.195, 0.08], s: [0.18, 0.012, 0.36], col: "#A89A4E" },
    { c: [0, 0.12, 0.47], s: [0.15, 0.1, 0.24], col: "#3F4434", role: "head", q: [0, 0.12, 0.35] },
    { c: [0, 0.09, -0.62], s: [0.14, 0.09, 0.56], col: "#3F4434", role: "tail", q: [0, 0.1, -0.35] },
    { c: [0, 0.07, -1.08], s: [0.07, 0.06, 0.4], col: "#363A2C", role: "tail", q: [0, 0.1, -0.35] },
    ...legs(0.2, 0.22, 0.1, 0.09, "#363A2C"),
  ] },
  // kuğu (≈ 1,4 m): suda süzülür
  swan: { id: "swan", habitat: ["water"], motion: "swim", speed: 0.25, roam: 6, night: true, shy: true, sink: -0.04, parts: [
    { c: [0, 0.1, 0], s: [0.42, 0.28, 0.75], col: "#F7F7F2" },
    { c: [-0.17, 0.27, -0.06], s: [0.07, 0.11, 0.48], col: "#ECECE4", role: "wingL", q: [-0.14, 0.24, 0] },
    { c: [0.17, 0.27, -0.06], s: [0.07, 0.11, 0.48], col: "#ECECE4", role: "wingR", q: [0.14, 0.24, 0] },
    { c: [0, 0.2, -0.42], s: [0.18, 0.1, 0.12], col: "#F7F7F2" },
    { c: [0, 0.42, 0.3], s: [0.08, 0.42, 0.08], col: "#F7F7F2", role: "head", q: [0, 0.24, 0.3] },
    { c: [0, 0.64, 0.36], s: [0.085, 0.085, 0.14], col: "#F7F7F2", role: "head", q: [0, 0.24, 0.3] },
    { c: [0, 0.625, 0.47], s: [0.045, 0.045, 0.09], col: "#E8792B", role: "head", q: [0, 0.24, 0.3] },
  ] },
  // yeşilbaş ördek (≈ 0,6 m)
  duck: { id: "duck", habitat: ["water"], motion: "swim", speed: 0.3, roam: 5, night: true, shy: true, sink: -0.03, parts: [
    { c: [0, 0.07, 0], s: [0.24, 0.16, 0.42], col: "#8E7A62" },
    { c: [0, 0.23, 0.18], s: [0.12, 0.12, 0.12], col: "#2E6B3F", role: "head", q: [0, 0.16, 0.16] },
    { c: [0, 0.21, 0.27], s: [0.06, 0.03, 0.08], col: "#E9B23A", role: "head", q: [0, 0.16, 0.16] },
    { c: [0, 0.13, -0.24], s: [0.12, 0.06, 0.08], col: "#3B342C", role: "tail", q: [0, 0.13, -0.2] },
    { c: [-0.125, 0.1, -0.03], s: [0.01, 0.06, 0.18], col: "#3E5FA8" },
    { c: [0.125, 0.1, -0.03], s: [0.01, 0.06, 0.18], col: "#3E5FA8" },
  ] },
  // Ara papağanı (≈ 0,85 m, kuyruk dahil): parkların üstünde çiftler hâlinde uçar
  parrot: { id: "parrot", habitat: ["air"], refine: "park", motion: "fly", speed: 2.2, roam: 6, night: false, shy: false, parts: parrotParts(0.85, "#D7332B", "#2F64C8", "#F2C230") },
  // keşiş muhabbet kuşu (≈ 0,3 m; <city> parkları)
  parakeet: { id: "parakeet", habitat: ["air"], refine: "park", motion: "fly", speed: 2.4, roam: 5, night: false, shy: false, parts: parrotParts(0.32, "#6DBB4A", "#4A9A3A", "#B8D86A") },
  // marmoset (≈ 0,2 m gövde + 0,3 m kuyruk): park zemininde seker
  marmoset: { id: "marmoset", habitat: ["ground"], refine: "park", motion: "walk", speed: 0.7, roam: 4, night: false, shy: true, parts: [
    { c: [0, 0.1, 0], s: [0.09, 0.09, 0.17], col: "#8A8378" },
    { c: [0, 0.155, 0.1], s: [0.08, 0.08, 0.07], col: "#5A5048", role: "head", q: [0, 0.13, 0.08] },
    { c: [-0.05, 0.175, 0.09], s: [0.03, 0.045, 0.02], col: "#F2EFE8", role: "head", q: [0, 0.13, 0.08] },
    { c: [0.05, 0.175, 0.09], s: [0.03, 0.045, 0.02], col: "#F2EFE8", role: "head", q: [0, 0.13, 0.08] },
    { c: [0, 0.12, -0.22], s: [0.03, 0.03, 0.28], col: "#6B645A", role: "tail", q: [0, 0.12, -0.08] },
    ...legs(0.03, 0.05, 0.06, 0.025, "#5A5048"),
  ] },
  // zebu ineği (≈ 1,4 m omuz): sokakta çok yavaş, kimseden kaçmaz
  cow: { id: "cow", habitat: ["ground"], motion: "walk", speed: 0.15, roam: 4, night: true, shy: false, parts: [
    { c: [0, 0.95, 0], s: [0.55, 0.6, 1.5], col: "#EAE3D5" },
    { c: [0, 1.33, 0.45], s: [0.3, 0.2, 0.3], col: "#DDD4C2" },
    { c: [0, 1.05, 0.95], s: [0.3, 0.32, 0.45], col: "#E2DACA", role: "head", q: [0, 1.15, 0.72] },
    { c: [-0.12, 1.28, 0.9], s: [0.05, 0.14, 0.05], col: "#8C7A62", role: "head", q: [0, 1.15, 0.72] },
    { c: [0.12, 1.28, 0.9], s: [0.05, 0.14, 0.05], col: "#8C7A62", role: "head", q: [0, 1.15, 0.72] },
    { c: [0, 0.93, 1.19], s: [0.2, 0.14, 0.04], col: "#5B4A3E", role: "head", q: [0, 1.15, 0.72] },
    { c: [0, 0.78, -0.78], s: [0.06, 0.6, 0.06], col: "#B8AE9C", role: "tail", q: [0, 1.08, -0.76] },
    ...legs(0.18, 0.55, 0.66, 0.13, "#D9D0BE"),
  ] },
  // rhesus makak (≈ 0,5 m)
  macaque: { id: "macaque", habitat: ["ground"], motion: "walk", speed: 0.55, roam: 4, night: false, shy: true, parts: [
    { c: [0, 0.25, 0], s: [0.22, 0.24, 0.3], col: "#A88B6A" },
    { c: [0, 0.45, 0.12], s: [0.16, 0.15, 0.14], col: "#A88B6A", role: "head", q: [0, 0.38, 0.1] },
    { c: [0, 0.44, 0.195], s: [0.1, 0.09, 0.01], col: "#D9A08A", role: "head", q: [0, 0.38, 0.1] },
    { c: [0, 0.22, -0.25], s: [0.04, 0.04, 0.2], col: "#8E7556", role: "tail", q: [0, 0.22, -0.15] },
    ...legs(0.08, 0.1, 0.16, 0.07, "#8E7556"),
  ] },
  // tek hörgüçlü deve (≈ 2,1 m)
  camel: { id: "camel", habitat: ["ground"], motion: "walk", speed: 0.3, roam: 5, night: true, shy: false, parts: [
    { c: [0, 1.45, 0], s: [0.6, 0.55, 1.6], col: "#C9A26B" },
    { c: [0, 1.88, -0.05], s: [0.4, 0.32, 0.6], col: "#BE9660" },
    { c: [0, 1.72, 0.9], s: [0.22, 0.55, 0.24], col: "#C9A26B", role: "head", q: [0, 1.5, 0.82] },
    { c: [0, 2.04, 1.15], s: [0.25, 0.22, 0.5], col: "#C29B64", role: "head", q: [0, 1.5, 0.82] },
    { c: [0, 1.3, -0.82], s: [0.06, 0.45, 0.06], col: "#8E6E44", role: "tail", q: [0, 1.5, -0.81] },
    ...legs(0.2, 0.58, 1.18, 0.13, "#B8915A"),
  ] },
  // saksağan (≈ 0,45 m, uzun kuyruk)
  magpie: { id: "magpie", habitat: ["ground"], motion: "walk", speed: 0.45, roam: 5, night: false, shy: true,
    parts: walkerBird(0.42, "#1F2430", "#1F2430", "#2F5E9E", "#1F1F22", "#2A2A2E", "#F4F4F0") },
  // koi (≈ 0,6 m): bahçe göletinde
  koi: { id: "koi", habitat: ["water"], refine: "pond", motion: "swim", speed: 0.25, roam: 3, night: true, shy: true, sink: -0.13, parts: [
    { c: [0, 0, 0], s: [0.13, 0.12, 0.42], col: "#F07A2A" },
    { c: [0, 0.064, 0.06], s: [0.08, 0.01, 0.16], col: "#F6F1E8" },
    { c: [0, 0, 0.25], s: [0.11, 0.1, 0.1], col: "#F6F1E8", role: "head", q: [0, 0, 0.2] },
    { c: [0, 0, -0.29], s: [0.02, 0.13, 0.14], col: "#F07A2A", role: "tail", q: [0, 0, -0.21] },
  ] },
  // karga (≈ 0,55 m)
  crow: { id: "crow", habitat: ["ground"], motion: "walk", speed: 0.5, roam: 5, night: false, shy: true,
    parts: walkerBird(0.52, "#18191C", "#18191C", "#24262B", "#2A2B30", "#2A2B30") },
  // güvercin (≈ 0,32 m)
  pigeon: { id: "pigeon", habitat: ["ground"], motion: "walk", speed: 0.4, roam: 4, night: false, shy: true,
    parts: walkerBird(0.32, "#9AA0AA", "#5E7F75", "#7C838E", "#3F3F46", "#C9534F") },
};

/** Şehir başına tür ve sayı (bütün şehir; en çok `FAUNA_MAX_ACTIVE` aynı anda). Gerçek, şehre özgü, tehditsiz seçim. */
export const CITY_FAUNA: Readonly<Record<string, readonly (readonly [string, number])[]>> = withFullFauna({
  istanbul: [["dolphin", 5], ["cat", 10], ["gull", 6]],
  londra: [["swan", 5], ["pigeon", 8]],
  kapadokya: [["pigeon", 8]],
});

export const speciesMask = (sp: Species): number => sp.habitat.reduce((m, c) => m | CLASS_BITS[c], 0);
/** Türün kesin izinli bitleri (sınıf + daraltma): hareket ve yuva bu maskeyle denetlenir. */
export function speciesOk(sp: Species, bits: number): boolean {
  const water = sp.habitat.includes("water") && (bits & H_WATER) !== 0
    && (sp.refine !== "deep" || (bits & H_DEEP) !== 0) && (sp.refine !== "pond" || (bits & H_POND) !== 0);
  const shore = sp.habitat.includes("shore") && (bits & H_SHORE) !== 0;
  const ground = sp.habitat.includes("ground") && (bits & H_GROUND) !== 0 && (sp.refine !== "park" || (bits & H_PARK) !== 0);
  const air = sp.habitat.includes("air") && (bits & H_AIR) !== 0 && (sp.refine !== "park" || (bits & H_PARK) !== 0);
  return water || shore || ground || air;
}

// ------------------------------------------------------------------------------------------ karo maskesi
interface Place { gnd: Set<string>; wat: Set<string>; high: Set<string>; sacred: NonNullable<ReturnType<typeof sacredZonesOf>> }
const placeCache = new WeakMap<CityMapFile, Place>();
function placeOf(map: CityMapFile): Place {
  let p = placeCache.get(map);
  if (p) return p;
  p = { gnd: new Set(), wat: new Set(), high: new Set(), sacred: sacredZonesOf(map) ?? [] };
  for (const l of map.lines) {
    const route = lineRoute(map, l), high = VEHICLES[l.kind].rideY >= 1;
    const gap = high ? 2 : Math.max(ROUTE_GAP_WATER, ROUTE_GAP_GROUND);
    for (let k = 0; k + 1 < route.length; k++) {
      const [x0, y0] = route[k], [x1, y1] = route[k + 1], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
      for (let s = 0; s <= n; s++) {
        const I = Math.round(x0 + ((x1 - x0) * s) / n), J = Math.round(y0 + ((y1 - y0) * s) / n);
        for (let a = -gap; a <= gap; a++) for (let b = -gap; b <= gap; b++) {
          const key = `${I + a},${J + b}`, d = Math.max(Math.abs(a), Math.abs(b));
          if (high) p.high.add(key);
          else { if (d <= ROUTE_GAP_WATER) p.wat.add(key); if (d <= ROUTE_GAP_GROUND) p.gnd.add(key); }
        }
      }
    }
  }
  placeCache.set(map, p);
  return p;
}
const inSacred = (pl: Place, I: number, J: number) => pl.sacred.some((q) => I >= q.i0 - SACRED_GAP - (q.buffer ?? 0) && I < q.i0 + q.w + SACRED_GAP + (q.buffer ?? 0)
  && J >= q.j0 - SACRED_GAP - (q.buffer ?? 0) && J < q.j0 + q.d + SACRED_GAP + (q.buffer ?? 0));

/** Semt su gövdeleri: karo (semt yerel) → gövde karo sayısı (T_WATER 4-komşu). */
const bodyCache = new WeakMap<object, Int32Array>();
function bodySize(plan: ReturnType<typeof districtPlan>): Int32Array {
  let out = bodyCache.get(plan);
  if (out) return out;
  const { w, d, kind } = plan, n = w * d;
  out = new Int32Array(n);
  const seen = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (kind[s] !== T_WATER || seen[s]) continue;
    const q = [s], comp: number[] = [];
    seen[s] = 1;
    while (q.length) {
      const c = q.pop()!; comp.push(c);
      const li = c % w, lj = (c - li) / w;
      for (const [a, b] of [[li + 1, lj], [li - 1, lj], [li, lj + 1], [li, lj - 1]]) {
        if (a < 0 || b < 0 || a >= w || b >= d) continue;
        const k = b * w + a;
        if (kind[k] === T_WATER && !seen[k]) { seen[k] = 1; q.push(k); }
      }
    }
    for (const c of comp) out[c] = comp.length;
  }
  bodyCache.set(plan, out);
  return out;
}

/** Bir karonun yaşam alanı: bitler, zemin üstü (yürünür) ve su yüzü (birim; yoksa NaN). */
export interface FaunaTile { bits: number; top: number; water: number }
const NO_TILE: FaunaTile = Object.freeze({ bits: 0, top: NaN, water: NaN });
const parcelMasks = new WeakMap<CityMapFile, Map<string, FaunaTile[]>>();
const FLOOR_PAD = 0.06, OBSTACLE_H = 1.6;

function parcelMask(map: CityMapFile, cx: number, cz: number): FaunaTile[] | null {
  let cache = parcelMasks.get(map);
  if (!cache) { cache = new Map(); parcelMasks.set(map, cache); }
  const key = `${cx},${cz}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const I0 = cx * CITY_PW, J0 = cz * CITY_PD;
  const dist = districtAt(map, I0, J0);
  const parcel = dist ? districtParcel(map, dist, cx, cz) : null;
  if (!dist || !parcel) return null;
  const plan = districtPlan(map, dist), wat = districtWater(map, dist), size = bodySize(plan), pl = placeOf(map);
  const N = CITY_PW * CITY_PD;
  // engel: yürünür karoda zeminden yükselen katı blok (lamba direği, bank, çit, korkuluk) — karo hayvana kapalı
  const blockedTile = new Uint8Array(N);
  const kindAt = (I: number, J: number) => {
    const li = I - plan.i0, lj = J - plan.j0;
    return li < 0 || lj < 0 || li >= plan.w || lj >= plan.d ? -1 : plan.kind[lj * plan.w + li];
  };
  const topAt = (I: number, J: number) => plan.top[(J - plan.j0) * plan.w + (I - plan.i0)];
  for (const b of parcel.near.blocks) {
    if (b.g === "water") continue;
    const bot = b.p[1] - b.s[1] / 2, tp = b.p[1] + b.s[1] / 2;
    const a0 = Math.floor(b.p[0] - b.s[0] / 2 + 12 + 0.05), a1 = Math.floor(b.p[0] + b.s[0] / 2 + 12 - 0.05);
    const c0 = Math.floor(b.p[2] - b.s[2] / 2 + 8 + 0.05), c1 = Math.floor(b.p[2] + b.s[2] / 2 + 8 - 0.05);
    for (let J = Math.max(c0, J0); J <= Math.min(c1, J0 + CITY_PD - 1); J++) for (let I = Math.max(a0, I0); I <= Math.min(a1, I0 + CITY_PW - 1); I++) {
      const k = (J - J0) * CITY_PW + (I - I0);
      const kd = kindAt(I, J);
      if (kd < 0 || kd >= 10) continue;
      const floor = topAt(I, J);
      if (tp > floor + FLOOR_PAD && bot < floor + OBSTACLE_H) blockedTile[k] = 1;
    }
  }
  const waterAt = (I: number, J: number): boolean => {
    const li = I - plan.i0, lj = J - plan.j0;
    if (li < 0 || lj < 0 || li >= plan.w || lj >= plan.d) return false;
    const k = lj * plan.w + li;
    return plan.kind[k] === T_WATER && wat.open[k] === 1 && wat.y[k] > -9;
  };
  const out: FaunaTile[] = new Array(N);
  for (let b = 0; b < CITY_PD; b++) for (let a = 0; a < CITY_PW; a++) {
    const I = I0 + a, J = J0 + b, k = b * CITY_PW + a, kd = kindAt(I, J), li = I - plan.i0, lj = J - plan.j0, pk = lj * plan.w + li;
    const key2 = `${I},${J}`, sacred = inSacred(pl, I, J);
    let bits = 0, top = NaN, water = NaN;
    if (waterAt(I, J) && !pl.wat.has(key2)) {
      bits |= H_WATER; water = wat.y[pk];
      let deep = true;
      for (let u = -1; u <= 1 && deep; u++) for (let v = -1; v <= 1; v++) if (!waterAt(I + u, J + v) || pl.wat.has(`${I + u},${J + v}`)) { deep = false; break; }
      if (deep) bits |= H_DEEP;
      // durgun su: gölet ya da liman olmayan semtin kanalı/hendeği/nehri (koi)
      if (size[pk] <= POND_MAX || plan.theme !== "harbor") bits |= H_POND;
    }
    const groundKind = kd === T_STREET || kd === T_PLAZA || kd === T_PARK;
    const walkable = kd >= 0 && kd < 10 && kd !== T_RAIL && kd !== T_STOP && kd !== T_DOOR && kd !== T_VIEW && kd !== T_GROUNDS;
    if (walkable && !blockedTile[k] && !sacred && !pl.gnd.has(key2)) {
      top = topAt(I, J);
      if (waterAt(I + 1, J) || waterAt(I - 1, J) || waterAt(I, J + 1) || waterAt(I, J - 1)) bits |= H_SHORE;
      if (groundKind) bits |= H_GROUND;
      if (kd === T_PARK) bits |= H_PARK;
    }
    // hava: kutsal tampon ve yükseltilmiş hat (teleferik, monoray, balon) yakını değil; park/su üstü (yükseklik etkinleşmede)
    if (!sacred && !pl.high.has(key2) && (kd === T_PARK || kd === T_WATER)) bits |= H_AIR | (kd === T_PARK ? H_PARK : 0);
    out[k] = { bits, top, water };
  }
  cache.set(key, out);
  return out;
}

/** Şehir karosunun yaşam alanı (parsel maskesi; semt dışı/üretilemeyen karo boş). */
export function faunaTile(map: CityMapFile, I: number, J: number): FaunaTile {
  const cx = Math.floor(I / CITY_PW), cz = Math.floor(J / CITY_PD);
  const m = parcelMask(map, cx, cz);
  return m ? m[(J - cz * CITY_PD) * CITY_PW + (I - cx * CITY_PW)] : NO_TILE;
}
/** Dünya → şehir karosu (cityX(I) = I − 11,5 karo ortası). */
export const tileOfX = (x: number) => Math.floor(x + 12);
export const tileOfZ = (z: number) => Math.floor(z + 8);

/** Hava türünün uçuş yüksekliği: yuva çevresindeki (r + 2 karo) blokların en yükseği + pay; çok yüksekse NaN (uçmaz). */
export function airHeight(map: CityMapFile, I: number, J: number, r: number): number {
  let top = 0;
  const R = Math.ceil(r) + 2;
  const seen = new Set<string>();
  for (let a = -R; a <= R; a += CITY_PW) for (let b = -R; b <= R; b += CITY_PD) seen.add(`${Math.floor((I + a) / CITY_PW)},${Math.floor((J + b) / CITY_PD)}`);
  for (const a of [-R, R]) for (const b of [-R, R]) seen.add(`${Math.floor((I + a) / CITY_PW)},${Math.floor((J + b) / CITY_PD)}`);
  for (const key of seen) {
    const [cx, cz] = key.split(",").map(Number);
    const dist = districtAt(map, cx * CITY_PW, cz * CITY_PD), p = dist ? districtParcel(map, dist, cx, cz) : null;
    if (!p) continue;
    for (const b of p.near.blocks) {
      const bi = b.p[0] + 12, bj = b.p[2] + 8;
      if (Math.abs(bi - I) > R + b.s[0] / 2 || Math.abs(bj - J) > R + b.s[2] / 2) continue;
      top = Math.max(top, b.p[1] + b.s[1] / 2);
    }
  }
  const y = Math.max(3.2, top + 2.2);
  return y <= 12 ? y : NaN;
}

// ------------------------------------------------------------------------------------------ kadro
export interface FaunaAnimal {
  id: string; sp: Species; district: string;
  home: CityTile;
  /** etkinleşmede doğrulanan yuva (null: henüz; false: geçerli karo yok → düşer) */
  ok: boolean | null;
  x: number; y: number; z: number; yaw: number; pitch: number;
  /** hedef (dünya), bekleme bitişi, faz, hız çarpanı, uçuş yüksekliği, yunus döngüsü */
  tx: number; tz: number; wait: number; phase: number; boost: number; fy: number; cyc: number;
  moving: boolean; hidden: boolean;
  rng: () => number;
}
export interface FaunaRoster { map: string; animals: FaunaAnimal[] }

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Tür için semt planından aday karo mu (kaba; kesin denetim etkinleşmede maskeyle). */
function roughOk(sp: Species, kd: number): boolean {
  const water = kd === T_WATER, gnd = kd === T_STREET || kd === T_PLAZA || kd === T_PARK;
  if (sp.motion === "fly") return kd === T_PARK;
  if (sp.refine === "park") return kd === T_PARK;
  if (sp.habitat.includes("water") && sp.habitat.length === 1) return water;
  if (sp.habitat.includes("water") && sp.habitat.includes("shore")) return water;
  if (sp.habitat.includes("shore") && !sp.habitat.includes("ground")) return gnd; // kıyı: etkinleşmede suya bitişik karoya taşınır
  return gnd;
}

/** Şehrin hayvan kadrosu (belirlenimci; yalnız semt planı). */
const rosterCache = new WeakMap<CityMapFile, FaunaRoster>();
export function faunaRoster(map: CityMapFile): FaunaRoster {
  const hit = rosterCache.get(map);
  if (hit) return hit;
  const animals: FaunaAnimal[] = [];
  for (const [sid, n] of CITY_FAUNA[map.id] ?? []) {
    const sp = SPECIES[sid];
    if (!sp) continue;
    const r = mulberry(hash(`${map.id}:${sid}`));
    // adaylar: bütün semtlerin uygun karoları (seyrek örnek), birbirinden ≥ 6 karo
    const cand: [CityTile, string][] = [];
    for (const d of map.districts) {
      const plan = districtPlan(map, d);
      if (sp.refine === "pond" && plan.theme === "harbor") continue; // durgun su: liman semti değil
      for (let lj = 1; lj < plan.d - 1; lj += 2) for (let li = 1; li < plan.w - 1; li += 2) if (roughOk(sp, plan.kind[lj * plan.w + li])) cand.push([[plan.i0 + li, plan.j0 + lj], d.id]);
    }
    const homes: [CityTile, string][] = [];
    for (let tries = 0; homes.length < n && tries < n * 40 && cand.length; tries++) {
      const c = cand[Math.floor(r() * cand.length)];
      if (homes.some(([h]) => Math.max(Math.abs(h[0] - c[0][0]), Math.abs(h[1] - c[0][1])) < 6)) continue;
      homes.push(c);
    }
    homes.forEach(([home, district], i) => {
      const ar = mulberry(hash(`${map.id}:${sid}:${i}`));
      animals.push({ id: `${sid}:${i}`, sp, district, home, ok: null, x: home[0] - 11.5, y: 0, z: home[1] - 7.5, yaw: ar() * Math.PI * 2, pitch: 0,
        tx: home[0] - 11.5, tz: home[1] - 7.5, wait: ar() * 3, phase: ar() * 10, boost: 1, fy: NaN, cyc: ar() * 6, moving: false, hidden: false, rng: ar });
    });
  }
  const out = { map: map.id, animals };
  rosterCache.set(map, out);
  return out;
}

/** Yuvayı maskeyle doğrular; geçersizse aynı parselde (ve komşu karolarda) en yakın geçerli karoya taşır. */
function settle(map: CityMapFile, a: FaunaAnimal): boolean {
  const [I0, J0] = a.home;
  for (let r = 0; r <= 8; r++) for (let u = -r; u <= r; u++) for (let v = -r; v <= r; v++) {
    if (Math.max(Math.abs(u), Math.abs(v)) !== r) continue;
    const t = faunaTile(map, I0 + u, J0 + v);
    if (!speciesOk(a.sp, t.bits)) continue;
    // amfibi ve yüzenler suda başlar (kıyıya kendisi çıkar)
    if ((a.sp.motion === "amphi" || a.sp.motion === "swim" || a.sp.motion === "dolphin") && !(t.bits & H_WATER)) continue;
    a.home = [I0 + u, J0 + v];
    a.x = a.tx = I0 + u - 11.5; a.z = a.tz = J0 + v - 7.5;
    if (a.sp.motion === "fly") {
      // uçuş çemberi kutsal tampona ve yükseltilmiş hat yakınına girmez
      const pl = placeOf(map), rr = Math.max(2, a.sp.roam * 0.6);
      let clear = true;
      for (let s = 0; s < 16 && clear; s++) {
        const I = Math.floor(I0 + u + 0.5 + Math.cos((s / 16) * Math.PI * 2) * rr), J = Math.floor(J0 + v + 0.5 + Math.sin((s / 16) * Math.PI * 2) * rr);
        if (pl.high.has(`${I},${J}`) || inSacred(pl, I, J)) clear = false;
      }
      if (!clear) continue;
      a.fy = airHeight(map, I0 + u, J0 + v, rr); if (!Number.isFinite(a.fy)) continue;
    }
    a.y = heightAt(map, a, a.x, a.z);
    return true;
  }
  return false;
}

/** Noktada türün durduğu yükseklik: suda yüzey + batma, karada zemin üstü, havada uçuş yüksekliği. */
export function heightAt(map: CityMapFile, a: Pick<FaunaAnimal, "sp" | "fy">, x: number, z: number): number {
  if (a.sp.motion === "fly") return a.fy;
  const t = faunaTile(map, tileOfX(x), tileOfZ(z));
  if ((t.bits & H_WATER) && a.sp.habitat.includes("water")) return t.water + (a.sp.sink ?? 0);
  return Number.isFinite(t.top) ? t.top : 0;
}

/** (x0, z0) → (x1, z1) parçası türün maskesinde mi (0,25 birim adımla; her karo izinli). */
export function pathOk(map: CityMapFile, sp: Species, x0: number, z0: number, x1: number, z1: number): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.25));
  for (let s = 0; s <= n; s++) {
    const x = x0 + ((x1 - x0) * s) / n, z = z0 + ((z1 - z0) * s) / n;
    if (!speciesOk(sp, faunaTile(map, tileOfX(x), tileOfZ(z)).bits)) return false;
  }
  return true;
}

// ------------------------------------------------------------------------------------------ davranış ve çizim
export interface FaunaCtx {
  dt: number; t: number; ax: number; az: number; night: boolean; reduced: boolean;
  loaded: (cx: number, cz: number) => boolean;
}
/** Çizim alıcısı: kutu merkezi (dünya), boyut, YXZ açıları, renk. */
export type FaunaSink = (x: number, y: number, z: number, w: number, h: number, d: number, yaw: number, pitch: number, roll: number, col: string) => void;
export interface FaunaFrame { active: number; boxes: number; ids: string[] }

const visibleNow = (a: FaunaAnimal, ctx: FaunaCtx) => (ctx.night ? a.sp.night : true) && !(ctx.reduced && (a.sp.motion === "fly" || a.sp.motion === "dolphin"));

function pickTarget(map: CityMapFile, a: FaunaAnimal, ctx: FaunaCtx, flee: boolean): void {
  const R = a.sp.roam, hx = a.home[0] - 11.5, hz = a.home[1] - 7.5;
  for (let k = 0; k < 8; k++) {
    let tx: number, tz: number;
    if (flee) { const ang = Math.atan2(a.x - ctx.ax, a.z - ctx.az) + (a.rng() - 0.5); tx = a.x + Math.sin(ang) * 2.5; tz = a.z + Math.cos(ang) * 2.5; }
    else { tx = hx + (a.rng() * 2 - 1) * R; tz = hz + (a.rng() * 2 - 1) * R; }
    tx = Math.round(tx + 11.5) - 11.5 + (a.rng() - 0.5) * 0.5; tz = Math.round(tz + 7.5) - 7.5 + (a.rng() - 0.5) * 0.5;
    if (Math.hypot(tx - hx, tz - hz) > R + 1.5) continue;
    if (!pathOk(map, a.sp, a.x, a.z, tx, tz)) continue;
    a.tx = tx; a.tz = tz; a.moving = true; a.boost = flee ? 2.2 : 1;
    return;
  }
  a.moving = false; a.wait = 1 + a.rng() * 2;
}

function stepAnimal(map: CityMapFile, a: FaunaAnimal, ctx: FaunaCtx): void {
  const dt = ctx.reduced ? 0 : Math.min(ctx.dt, 0.1);
  a.phase += dt;
  if (a.sp.motion === "fly") {
    // çember: yuva çevresinde yarıçap roam·0,6, hafif dalgalı yükseklik
    const hx = a.home[0] - 11.5, hz = a.home[1] - 7.5, rr = Math.max(2, a.sp.roam * 0.6), w = a.sp.speed / rr;
    const ang = a.cyc + a.phase * w;
    a.x = hx + Math.cos(ang) * rr; a.z = hz + Math.sin(ang) * rr; a.y = a.fy + Math.sin(a.phase * 0.7) * 0.4;
    a.yaw = Math.atan2(-Math.sin(ang), Math.cos(ang)); a.pitch = 0; a.moving = true;
    return;
  }
  if (a.sp.motion === "dolphin") {
    // su altında yüzer (gizli), 1,4 sn'lik yayla yüzeye çıkıp dalar; yol derin su maskesinde
    a.cyc -= dt;
    const surf = faunaTile(map, tileOfX(a.x), tileOfZ(a.z)).water;
    if (a.cyc <= 0) { a.cyc = 5 + a.rng() * 7; a.wait = 1.4; }
    if (!a.moving || Math.hypot(a.tx - a.x, a.tz - a.z) < 0.3) pickTarget(map, a, ctx, false);
    moveToward(map, a, dt);
    if (a.wait > 0 && a.wait <= 1.4) {
      a.wait -= dt;
      const u = 1 - Math.max(0, a.wait) / 1.4; // 0 → 1
      a.y = surf - 0.25 + Math.sin(u * Math.PI) * 0.55;
      a.pitch = -Math.cos(u * Math.PI) * 0.6; // burun önce yukarı (çıkış), sonra aşağı (dalış)
      a.hidden = false;
      if (a.wait <= 0) a.wait = 0;
    } else { a.y = surf - 0.9; a.pitch = 0; a.hidden = true; }
    return;
  }
  // yürüyen / yüzen / amfibi
  const near = Math.hypot(a.x - ctx.ax, a.z - ctx.az);
  if (a.sp.shy && near < 1.6 && dt > 0 && a.boost < 2) pickTarget(map, a, ctx, true);
  if (!a.moving) {
    a.wait -= dt;
    if (a.wait <= 0 && dt > 0) pickTarget(map, a, ctx, false);
  } else moveToward(map, a, dt);
  const want = heightAt(map, a, a.x, a.z);
  // kıyıya çıkarken gövde zeminin içinden geçmez (yukarı anında), suya inerken yumuşak
  a.y = want >= a.y || Math.abs(want - a.y) < 0.02 || dt === 0 ? want : a.y + (want - a.y) * Math.min(1, dt * 4);
}

function moveToward(map: CityMapFile, a: FaunaAnimal, dt: number): void {
  const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
  if (d < 0.05) { a.moving = false; a.boost = 1; a.wait = 1.5 + a.rng() * 4; return; }
  const want = Math.atan2(dx, dz);
  let dy = want - a.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  a.yaw += dy * Math.min(1, dt * 5);
  const st = Math.min(d, a.sp.speed * a.boost * dt);
  const nx = a.x + (dx / d) * st, nz = a.z + (dz / d) * st;
  // karo karo: adım maskede değilse dur (hedef seçimi zaten denetler; güvenlik ağı)
  if (!speciesOk(a.sp, faunaTile(map, tileOfX(nx), tileOfZ(nz)).bits)) { a.moving = false; a.wait = 0.5; return; }
  a.x = nx; a.z = nz;
}

const _p: V3 = [0, 0, 0], _lp: V3 = [0, 0, 0];
/** Yerel nokta → dünya (YXZ: önce eğim x, sonra yön y). */
function toWorld(a: FaunaAnimal, l: V3, out: V3): V3 {
  const cp = Math.cos(a.pitch), sp = Math.sin(a.pitch), cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
  const y1 = l[1] * cp - l[2] * sp, z1 = l[1] * sp + l[2] * cp;
  out[0] = a.x + l[0] * cy + z1 * sy; out[1] = a.y + y1; out[2] = a.z - l[0] * sy + z1 * cy;
  return out;
}

/** Parçaların kutuları (animasyonlu). Dönüş: kutu sayısı. */
export function emitAnimal(a: FaunaAnimal, t: number, reduced: boolean, sink: FaunaSink): number {
  const walkPh = a.moving && !reduced ? Math.sin(a.phase * (a.sp.speed * a.boost * 9 + 4)) : 0;
  void t;
  const flap = a.sp.motion === "fly" && !reduced ? Math.sin(a.phase * 11) * 0.6 : 0;
  let n = 0;
  const lp = _lp; // modül tamponu (hayvan başına kare başına dizi yok)
  for (const p of a.sp.parts) {
    let px = 0, py = 0, pr = 0;
    const r = p.role;
    if (r === "legA" || r === "legB") px = (r === "legA" ? 1 : -1) * walkPh * 0.45;
    else if (r === "tail") py = reduced ? 0 : Math.sin(a.phase * (a.sp.motion === "dolphin" ? 6 : 2.2)) * (a.sp.motion === "dolphin" ? 0 : 0.25);
    else if (r === "head") px = reduced || a.moving ? 0 : Math.max(0, Math.sin(a.phase * 0.9)) * 0.35;
    else if (r === "wingL") pr = flap;
    else if (r === "wingR") pr = -flap;
    // dönme pivotu: verilmişse o, bacakta kalça (üst uç), değilse merkez
    // pivot skaler (bacak başına kare başına dizi yok); değerler eskisiyle aynı
    const leg = !p.q && (r === "legA" || r === "legB");
    const qx = p.q ? p.q[0] : p.c[0], qy = p.q ? p.q[1] : leg ? p.c[1] + p.s[1] / 2 : p.c[1], qz = p.q ? p.q[2] : p.c[2];
    let cx = p.c[0] - qx, cy = p.c[1] - qy, cz = p.c[2] - qz;
    if (px) { const c = Math.cos(px), s = Math.sin(px), y2 = cy * c - cz * s, z2 = cy * s + cz * c; cy = y2; cz = z2; }
    if (py) { const c = Math.cos(py), s = Math.sin(py), x2 = cx * c + cz * s, z2 = -cx * s + cz * c; cx = x2; cz = z2; }
    if (pr) { const c = Math.cos(pr), s = Math.sin(pr), x2 = cx * c - cy * s, y2 = cx * s + cy * c; cx = x2; cy = y2; }
    lp[0] = (qx + cx) * M; lp[1] = (qy + cy) * M; lp[2] = (qz + cz) * M;
    toWorld(a, lp, _p);
    sink(_p[0], _p[1], _p[2], p.s[0] * M, p.s[1] * M, p.s[2] * M, a.yaw + py, a.pitch + px, pr, p.col);
    n++;
  }
  return n;
}

const PICK: [number, FaunaAnimal][] = [], PICK_POOL: [number, FaunaAnimal][] = [];
const byD = (p: [number, FaunaAnimal], q: [number, FaunaAnimal]) => p[0] - q[0];
/**
 * Bir kare: yüklü parseldeki ve avatara `FAUNA_RADIUS` içindeki hayvanlar (en yakın `FAUNA_MAX_ACTIVE`) adım atar ve çizilir.
 * Etkinleşmede yuva doğrulanır. Dönüş: ölçüm.
 */
export function faunaFrame(map: CityMapFile, roster: FaunaRoster, ctx: FaunaCtx, sink: FaunaSink): FaunaFrame {
  const pick = PICK; // kalıcı aday dizisi + çift havuzu (kare başına dizi yok)
  pick.length = 0;
  for (const a of roster.animals) {
    if (a.ok === false || !visibleNow(a, ctx)) continue;
    const d = Math.hypot(a.home[0] - 11.5 - ctx.ax, a.home[1] - 7.5 - ctx.az);
    if (d > FAUNA_RADIUS) continue;
    if (!ctx.loaded(Math.floor(a.home[0] / CITY_PW), Math.floor(a.home[1] / CITY_PD))) continue;
    const e = PICK_POOL[pick.length] ??= [0, a];
    e[0] = d; e[1] = a;
    pick.push(e);
  }
  pick.sort(byD);
  let boxes = 0, active = 0;
  const ids: string[] = [];
  for (const [, a] of pick) {
    if (active >= FAUNA_MAX_ACTIVE || boxes + a.sp.parts.length > FAUNA_MAX_BOXES) break;
    if (a.ok === null) a.ok = settle(map, a);
    if (!a.ok) continue;
    stepAnimal(map, a, ctx);
    active++; ids.push(a.id);
    if (a.hidden || !ctx.loaded(Math.floor(tileOfX(a.x) / CITY_PW), Math.floor(tileOfZ(a.z) / CITY_PD))) continue;
    boxes += emitAnimal(a, ctx.t, ctx.reduced, sink);
  }
  return { active, boxes, ids };
}
