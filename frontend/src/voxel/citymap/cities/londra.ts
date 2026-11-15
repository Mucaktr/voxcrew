/**
 * **Londra şehir haritası** (biçim v1.3 `city_map` + tasarım katmanı; Londra satırı, §6).
 *
 * "Turistik harita" ölçeği: landmarklar gerçek oranlarına yakın, mesafeler sıkıştırılmış. Yön: +z kuzey, +x doğu. Thames
 * doğu–batı akar (şehir karosu j 12–23). Varış meydanı (şehir karosu [0, 12) × [0, 16)) güney kıyısındaki iskeledir (ofis
 * tabanındaki Londra kapısı = nehir iskelesi); iki yanında Westminster ve kale semtlerinin güney kıyıları.
 *
 * ┌ Büyük park [−108, 32] ┐┌ Çarşı ve meydan [−48, 48] ┐┌ Eski şehir [0, 48] ┐
 * │ göl · köşk · saray ││ kapalı çarşı · galeri ││ kubbeli katedral │
 * └────────────────────────┘└───────────────────────────┘└────────────────────┘
 * ┌ Westminster [−48, −16] ─────────┐[iskele]┌ Kale [12, 0] ──────────────┐
 * │ saat kulesi · meclis · (Thames) ││ ││ kale burcu · kule köprüsü │
 * │ köprü · gözlem çarkı · meydan ││ ││ (Thames) │
 * └─────────────────────────────────┘ └────────────────────────────┘
 *
 * Ulaşım: metro (Westminster → Çarşı → Eski şehir → Kale; kuzey kenarlardan), iki katlı otobüs (park köşesi → Westminster →
 * çeşme meydanı → Eski şehir; sokak üstünde, ray ayırmaz) ve nehir teknesi (Westminster iskelesi ↔ kale iskelesi; köprü altından
 * geçmez). Yazılı durak tabelası, ulaşım yuvarlak simgesi yok.
 *
 * Açılış (SK-K5): Westminster ücretsiz başlangıç semti; kale ve çarşı Westminster'a girince (ya da ofis seviyesi 3), park çarşıya
 * girince (ya da seviye 4), eski şehir kaleye girince (ya da seviye 5) açılır. Para yolu yok; görevler süresizdir.
*/
import type { CityMapFile } from "../format";
import type { CityDesign } from "../design";
import { CARSI_DESIGN, CARSI_LANDMARKS } from "../../city/landmarks/londra/carsi";
import { KALE_DESIGN, KALE_LANDMARKS } from "../../city/landmarks/londra/kale";
import { PARK_DESIGN, PARK_LANDMARKS } from "../../city/landmarks/londra/park";
import { SEHIR_DESIGN, SEHIR_LANDMARKS } from "../../city/landmarks/londra/sehir";
import { WESTMINSTER_DESIGN, WESTMINSTER_LANDMARKS } from "../../city/landmarks/londra/westminster";

export const LONDRA_MAP: CityMapFile = {
  id: "londra",
  gate: { kind: "pier" },
  sea: true,
  districts: [
    {
      // güneye 16 karo büyüdü (çark meydanı); yerel karolar +16 → şehir karosunda yer değiştiren yok
      id: "westminster", seed: 1859, bounds: [-48, -16, 48, 64], theme: "historic",
      landmarks: [
        { id: "saat_kulesi", shape: "tower", tile: [10, 42], w: 3, d: 3, h: 14, door: [11, 45], interior: "tower" },
        { id: "parlamento", shape: "hall", tile: [15, 42], w: 16, d: 5, h: 14.3 }, // CITY-PASS-LON: kuzey rıhtımı iki karo (lj 40–41), saat kulesiyle arada iki karo
        { id: "cark", shape: "hall", tile: [26, 20], w: 14, d: 2, h: 16 },
      ],
      entries: [[47, 21], [24, 63], [0, 46], [0, 21]],
      viewpoints: [[8, 31]], // CABLEVP1 (VP-NEAR-001): eskiden [9, 34] — yakın donatı 6 m içinde %30
    },
    {
      id: "kale", seed: 1078, bounds: [12, 0, 48, 48], theme: "harbor",
      landmarks: [
        { id: "kule_koprusu", shape: "tower", tile: [23, 14], w: 1, d: 2, h: 13 }, // CITY-PASS-LON: kuleler lj 14–15 / 21–22
        { id: "kale", shape: "tower", tile: [28, 30], w: 9, d: 9, h: 8, door: [32, 29], interior: "museum" },
      ],
      entries: [[0, 5], [24, 47], [47, 30], [47, 5]],
      viewpoints: [[28, 2]], // [28, 6] köprü kulesine 8,7 m (tepe 54° — kadraj 51°; canlıda kule kesik) → [28, 2] 12,5 m (44°, kule tam). Eski not: eskiden [25, 10] köprü kulesinin 2 karo yanında (ayak 3–6 m'den kadrajın ~%30'u); burada köprü 8–11 m'de bütün, kale arkada
    },
    {
      id: "carsi", seed: 1830, bounds: [-48, 48, 48, 48], theme: "bazaar",
      landmarks: [
        { id: "kapali_carsi", shape: "hall", tile: [16, 18], w: 14, d: 8, h: 5, door: [22, 17], interior: "lobby" },
        { id: "galeri", shape: "hall", tile: [14, 38], w: 16, d: 5, h: 5.5 },
        { id: "meydan_cesmesi", shape: "hall", tile: [20, 32], w: 3, d: 2, h: 2.2 },
      ],
      entries: [[24, 0], [47, 24], [0, 24], [24, 47]],
      viewpoints: [[26, 36]],
    },
    {
      // kuzeye 16 karo büyüdü (uzun süs göleti, fıskiyeli teras); yerel karolar değişmedi
      id: "park", seed: 1637, bounds: [-108, 32, 60, 64], theme: "garden",
      landmarks: [
        { id: "saray", shape: "hall", tile: [46, 26], w: 6, d: 14, h: 5.4 },
        { id: "muzik_kosku", shape: "dome", tile: [44, 6], w: 3, d: 3, h: 3.4 },
        { id: "kayikhane", shape: "hall", tile: [22, 24], w: 4, d: 2, h: 2.6 },
      ],
      entries: [[59, 8], [59, 20], [59, 40], [30, 47]],
      viewpoints: [[25, 16]],
    },
    {
      id: "sehir", seed: 1666, bounds: [0, 48, 48, 48], theme: "modern",
      landmarks: [
        { id: "kubbeli_katedral", shape: "dome", tile: [7, 18], w: 16, d: 10, h: 15 }, // CITY-PASS-LON: doğusunda iki karoluk sokak
        { id: "anit_sutun", shape: "obelisk", tile: [34, 10], w: 2, d: 2, h: 11.5 },
        { id: "borsa", shape: "hall", tile: [32, 26], w: 8, d: 6, h: 5 },
      ],
      entries: [[24, 0], [36, 0], [0, 24], [24, 47]],
      viewpoints: [[19, 10]],
    },
  ],
  stops: [
    { id: "westminster_ist", district: "westminster", tile: [45, 59] },
    { id: "westminster_otobus", district: "westminster", tile: [36, 52] },
    { id: "westminster_iskele", district: "westminster", tile: [36, 26] },
    { id: "kale_iskele", district: "kale", tile: [10, 24] },
    { id: "tower_hill", district: "kale", tile: [35, 43] },
    { id: "covent", district: "carsi", tile: [45, 43] },
    { id: "trafalgar", district: "carsi", tile: [36, 30] },
    { id: "bank", district: "sehir", tile: [47, 43] },
    { id: "sehir_otobus", district: "sehir", tile: [24, 36] },
    { id: "park_kosesi", district: "park", tile: [58, 4] },
  ],
  lines: [
    // metro rayları semtlerde ray karosu olur; otobüs sokak üstünde (ray ayırmaz), nehir teknesi rotası suyu değiştirmez
    // METRO1: ardışık duraklar ≥ 48 karo, köşeler durakta: Westminster (−3, 43) → Covent (−3, 91) → Bank (47, 91) → Tower Hill (47, 43); 48 + 50 + 48 karo
    { id: "metro", kind: "metro", stops: ["westminster_ist", "covent", "bank", "tower_hill"], route: [[-3, 43], [-3, 91], [47, 91], [47, 43]] },
    { id: "otobus", kind: "otobus", stops: ["park_kosesi", "westminster_otobus", "trafalgar", "sehir_otobus"], route: [[-50, 36], [-12, 36], [-12, 84], [24, 84]] },
    { id: "tekne", kind: "vapur", stops: ["westminster_iskele", "kale_iskele"], route: [[-12, 10], [-12, 17], [22, 17], [22, 24]] },
  ],
};

const C = (d: string, tail: string) => `city:londra:${d}${tail}`;

export const LONDRA_DESIGN: CityDesign = {
  districts: { westminster: WESTMINSTER_DESIGN, kale: KALE_DESIGN, carsi: CARSI_DESIGN, park: PARK_DESIGN, sehir: SEHIR_DESIGN },
  landmarks: { ...WESTMINSTER_LANDMARKS, ...KALE_LANDMARKS, ...CARSI_LANDMARKS, ...PARK_LANDMARKS, ...SEHIR_LANDMARKS },
  // köprünün ortası (westminster vp 1): saat kulesine karşı gün batımı
  moments: { westminster: [{ id: "gun_batimi", vp: 1, when: "sunset" }] },
  unlock: {
    kale: { after: "westminster", level: 3 },
    carsi: { after: "westminster", level: 3 },
    park: { after: "carsi", level: 4 },
    sehir: { after: "kale", level: 5 },
  },
  quests: [
    { id: "saat_mekanizmasi", district: "westminster", need: [C("westminster", ":in:saat_kulesi"), C("westminster", ":lm:parlamento")] },
    { id: "gun_batimi", district: "westminster", need: [C("westminster", ":an:gun_batimi")] },
    { id: "nehir_turu", district: "kale", need: ["city:londra:stop:westminster_iskele", "city:londra:stop:kale_iskele"] },
    { id: "kale_ve_kopru", district: "kale", need: [C("kale", ":in:kale"), C("kale", ":lm:kule_koprusu"), C("kale", ":vp:1")] },
    { id: "carsi_turu", district: "carsi", need: [C("carsi", ":in:kapali_carsi"), C("carsi", ":lm:galeri")] },
    { id: "park_gizli", district: "park", need: [C("park", ":gz:1"), C("park", ":gz:2")] },
    { id: "iki_katli", district: "park", need: ["city:londra:stop:park_kosesi", "city:londra:stop:sehir_otobus"] },
  ],
};
