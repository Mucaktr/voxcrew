/**
 * **İstanbul şehir haritası** (biçim v1.3 `city_map` + tasarım katmanı).
 *
 * "Turistik harita" ölçeği: landmarklar gerçek oranlarına yakın, mesafeler sıkıştırılmış. Yön: +z kuzey, +x doğu. Varış meydanı
 * (şehir karosu [0, 12) × [0, 16)) Eminönü benzeri vapur iskelesidir (ofis tabanındaki İstanbul kapısı = vapur iskelesi):
 *
 * ┌──────── Haliç [−96, 0] ─────────┐┌─ Beyoğlu [−36, 48] (Galata, Tünel, İstiklal, Taksim) ─┐┌ Boğaz–Avrupa [36, 48] ┐
 * │ tepe kahvesi · Balat · Haliç · ││ ││ Dolmabahçe · Ortaköy │
 * └────────────────────────────────┘└───────────────────────────────────────────────────────┘│ Boğaz K. · R. Hisarı │
 * ┌──────────── Tarihi Yarımada [−36, −48] ────────────┐ [iskele] (Boğaz) └───────────────────────┘
 * │ Kapalıçarşı · Yerebatan · Ayasofya · Sultanahmet · │ ┌ Üsküdar–Kadıköy [96, −48] ┐
 * │ Hipodrom · Topkapı · Mısır Çarşısı │ │ Kız Kulesi (ada) · Salacak │
 * └─────────────────────────────────────────────────────┘ └───────────────────────────┘
 *
 * Ulaşım: T1 tramvayı (Beyazıt → Sultanahmet → Eminönü → Galata Köprüsü → Karaköy → Kabataş), Tünel füniküleri, İstiklal nostaljik
 * tramvayı, vapurlar (Eminönü–Karaköy–Üsküdar, Eminönü–Kadıköy, Haliç: Kasımpaşa–Balat, Boğaz: Üsküdar–Beşiktaş–Ortaköy–Rumeli
 * Hisarı) ve kayık (Salacak → Kız Kulesi). Anadolu yakasına yalnız vapurla geçilir ("Vapurla iki kıtayı geç").
 *
 * Açılış (SK-K5): Tarihi Yarımada ücretsiz başlangıç semti; Haliç ve Beyoğlu Tarihi Yarımada'ya girince (ya da ofis seviyesi 3),
 * Boğaz Beyoğlu'na girince (ya da seviye 5), Üsküdar Tarihi Yarımada'ya girince (ya da seviye 3) açılır. Para yolu
 * yok. Görevler süresizdir (FOMO yok).
*/
import type { CityMapFile } from "../format";
import type { CityDesign } from "../design";
import { BEYOGLU_DESIGN, BEYOGLU_LANDMARKS } from "../../city/landmarks/istanbul/beyoglu";
import { BOGAZ_DESIGN, BOGAZ_LANDMARKS } from "../../city/landmarks/istanbul/bogaz";
import { HALIC_DESIGN, HALIC_LANDMARKS } from "../../city/landmarks/istanbul/halic";
import { TARIHI_DESIGN, TARIHI_LANDMARKS } from "../../city/landmarks/istanbul/tarihi";
import { USKUDAR_DESIGN, USKUDAR_LANDMARKS } from "../../city/landmarks/istanbul/uskudar";

export const ISTANBUL_MAP: CityMapFile = {
  id: "istanbul",
  gate: { kind: "pier" },
  sea: true,
  districts: [
    {
      id: "tarihi_yarimada", seed: 1453, bounds: [-36, -48, 72, 48], theme: "historic",
      landmarks: [
        // güney bahçe girişi avlu portalı (şadırvanlı bahçe ayrı, gerçek ölçekli sahne; interiors/courtyards.ts)
        { id: "ayasofya", shape: "dome", tile: [33, 28], w: 14, d: 10, h: 12, door: [40, 38], interior: "courtyard" },
        // COURTYARD-PORTAL: batı avlusunun taç kapısının önü avlu portalı (avlu ayrı, gerçek ölçekli sahne; interiors/courtyards.ts)
        { id: "sultanahmet", shape: "dome", tile: [38, 4], w: 10, d: 12, h: 13.5, door: [31, 9], interior: "courtyard" },
        { id: "topkapi", shape: "hall", tile: [52, 22], w: 14, d: 14, h: 10, door: [51, 27], interior: "museum" },
        { id: "yerebatan", shape: "hall", tile: [26, 30], w: 3, d: 3, h: 2.9, door: [27, 29], interior: "museum" },
        { id: "hipodrom", shape: "obelisk", tile: [23, 11], w: 2, d: 2, h: 9 },
        { id: "kapalicarsi", shape: "hall", tile: [3, 20], w: 16, d: 12, h: 4.5, door: [19, 25], interior: "lobby" },
        { id: "misir_carsisi", shape: "hall", tile: [20, 38], w: 12, d: 6, h: 4 },
        // LANDMARK-HIRES: Süleymaniye (Haliç'e bakan tepe; Kapalıçarşı'nın kuzeyi, Mısır Çarşısı'nın batısı) — kuzeyde avlu
        // COURTYARD-PORTAL: kuzey taç kapının önü avlu portalı
        { id: "suleymaniye", shape: "dome", tile: [9, 33], w: 9, d: 13, h: 14.3, door: [13, 46], interior: "courtyard" },
      ],
      entries: [[42, 46], [20, 34]],
      viewpoints: [[61, 42]], // eskiden [64, 40] — 6 m önde 2,2 m korkuluk karenin %19'unu kapatıyordu (VIEW-FRAME-001 par)
    },
    {
      // batıya 24 karo büyüdü (yukarı Haliç); yerel karolar +24 → şehir karosunda hiçbir şey yer değiştirmedi
      id: "halic", seed: 1502, bounds: [-96, 0, 96, 48], theme: "harbor",
      landmarks: [
        { id: "galata_koprusu", shape: "hall", tile: [85, 8], w: 2, d: 3, h: 2.5, door: [85, 7], interior: "lobby" },
        { id: "balat", shape: "hall", tile: [30, 3], w: 14, d: 3, h: 5 },
      ],
      entries: [[92, 2], [92, 44]],
      viewpoints: [[90, 24]],
    },
    {
      id: "beyoglu", seed: 1348, bounds: [-36, 48, 72, 48], theme: "hill",
      landmarks: [
        { id: "galata_kulesi", shape: "tower", tile: [34, 14], w: 5, d: 5, h: 15, door: [36, 13], interior: "tower" },
        { id: "karakoy_rihtim", shape: "hall", tile: [48, 2], w: 8, d: 3, h: 4.4 },
        { id: "tunel", shape: "hall", tile: [20, 18], w: 5, d: 4, h: 4 },
        { id: "istiklal", shape: "hall", tile: [30, 30], w: 5, d: 6, h: 8 },
        { id: "taksim", shape: "dome", tile: [36, 42], w: 3, d: 3, h: 3.6 },
      ],
      entries: [[32, 2], [26, 30]],
      viewpoints: [[62, 1]],
    },
    {
      id: "bogaz", seed: 1973, bounds: [36, 48, 48, 96], theme: "garden",
      landmarks: [
        { id: "dolmabahce_saat", shape: "tower", tile: [20, 2], w: 2, d: 2, h: 10.5 },
        { id: "dolmabahce", shape: "hall", tile: [16, 8], w: 8, d: 16, h: 8.2 },
        { id: "ortakoy", shape: "dome", tile: [24, 48], w: 4, d: 4, h: 7.6 },
        { id: "bogaz_koprusu", shape: "tower", tile: [20, 55], w: 3, d: 3, h: 20 },
        { id: "rumeli_hisari", shape: "tower", tile: [6, 72], w: 16, d: 14, h: 11.5, door: [13, 71], interior: "castle" },
      ],
      entries: [[2, 6], [10, 60]],
      viewpoints: [[28, 67], [29, 90]], // FIXPACK-B: dikey karede 1. seyir Rumeli Hisarı (eski [29, 66] köprü ile Boğaz aynı karede değildi), 2. köprü + Boğaz (eski [26, 91] su %2)
    },
    {
      id: "uskudar", seed: 1960, bounds: [96, -48, 48, 96], theme: "bazaar",
      landmarks: [
        { id: "kiz_kulesi", shape: "tower", tile: [4, 53], w: 3, d: 4, h: 9.5, door: [5, 57], interior: "tower" },
        { id: "uskudar_iskele", shape: "hall", tile: [16, 62], w: 5, d: 4, h: 4.2 },
        { id: "haydarpasa", shape: "hall", tile: [16, 34], w: 12, d: 5, h: 9.5 },
        { id: "kadikoy_carsi", shape: "hall", tile: [22, 14], w: 10, d: 8, h: 3.2 },
      ],
      entries: [[20, 60], [6, 59]],
      viewpoints: [[7, 58], [17, 46]],
    },
  ],
  stops: [
    { id: "beyazit", district: "tarihi_yarimada", tile: [21, 23] },
    { id: "sultanahmet", district: "tarihi_yarimada", tile: [31, 18] }, // avlu köşe minaresinin kaidesi 1. şahısta gözün 0,6 m önündeydi (FX-VIEW-002 %100); 1 karo kuzeybatı ([32,17] → [31,18]; [32,18] yeni rota karosu bulgusu açıyordu)
    { id: "eminonu", district: "tarihi_yarimada", tile: [32, 47] },
    { id: "eminonu_iskele", district: "tarihi_yarimada", tile: [50, 43] },
    { id: "karakoy", district: "beyoglu", tile: [32, 6] },
    { id: "karakoy_tunel", district: "beyoglu", tile: [26, 2] },
    { id: "tunel", district: "beyoglu", tile: [26, 16] },
    { id: "taksim", district: "beyoglu", tile: [26, 46] },
    { id: "karakoy_iskele", district: "beyoglu", tile: [44, 0] },
    { id: "kasimpasa_iskele", district: "halic", tile: [64, 36] },
    { id: "balat_iskele", district: "halic", tile: [44, 11] },
    { id: "kabatas", district: "bogaz", tile: [6, 6] },
    { id: "besiktas_iskele", district: "bogaz", tile: [29, 28] },
    { id: "ortakoy_iskele", district: "bogaz", tile: [29, 44] },
    { id: "rumeli_iskele", district: "bogaz", tile: [29, 80] },
    { id: "uskudar_iskele", district: "uskudar", tile: [14, 66] },
    { id: "kadikoy_iskele", district: "uskudar", tile: [14, 24] },
    { id: "salacak", district: "uskudar", tile: [14, 56] },
    { id: "kiz_kulesi_iskele", district: "uskudar", tile: [8, 52] },
  ],
  lines: [
    // şehir karosu rotaları; tramvay/füniküler rayları semtlerde ray karosu olur, vapur/kayık rotaları suyu değiştirmez
    // METRO1: ardışık duraklar ≥ 30 karo (tramvay; eski 11 / 22 karoluk anlamsız bacaklar kalktı): Beyazıt (−15, −25) → Eminönü (−4, −1; tek köşeli, 35 karo)
    // → Karaköy (−4, 54; Haliç geçişi, köşe durakta) → Kabataş. Sultanahmet durağı Beyazıt'a 11 karo yakın: hatta binilmez, yaya durağı (kısa yolculuk yok)
    { id: "t1", kind: "tramvay", stops: ["beyazit", "eminonu", "karakoy", "kabatas"], route: [[-15, -25], [-4, -25], [-4, 54], [42, 54]] },
    // füniküler yokuş çıkar (kısa kalabilir); nostaljik tramvay Tünel (−10, 64) → Taksim (−10, 94): 30 karo, düz
    { id: "tunel", kind: "funikuler", stops: ["karakoy_tunel", "tunel"], route: [[-10, 50], [-10, 64]] },
    { id: "nostalji", kind: "tramvay", stops: ["tunel", "taksim"], route: [[-10, 64], [-10, 94]] },
    { id: "vapur_uskudar", kind: "vapur", stops: ["eminonu_iskele", "karakoy_iskele", "uskudar_iskele"],
      route: [[14, -5], [14, 30], [8, 30], [8, 48], [8, 30], [100, 30], [100, 18], [110, 18]] },
    { id: "vapur_kadikoy", kind: "vapur", stops: ["eminonu_iskele", "kadikoy_iskele"], route: [[14, -5], [14, 14], [90, 14], [90, -24], [110, -24]] }, // WATER-CLEAR: ilk dönüş kıyıdan ≥ yarım gemi boyu (3,6) uzakta (eskiden (14, 6) kıyıya 1,1 giriyordu)
    { id: "vapur_halic", kind: "vapur", stops: ["kasimpasa_iskele", "balat_iskele"], route: [[-32, 36], [-32, 28], [-52, 20], [-52, 11]] },
    { id: "vapur_bogaz", kind: "vapur", stops: ["uskudar_iskele", "besiktas_iskele", "ortakoy_iskele", "rumeli_iskele"],
      route: [[110, 18], [102, 18], [102, 60], [72, 76], [65, 76], [72, 76], [72, 92], [65, 92], [72, 92], [72, 128], [65, 128]] },
    // CITY-POLISH: kayık adanın doğusundaki kayanın (yerel li 10) doğusundan dolaşır (eskiden kayanın içinden geçiyordu)
    { id: "kayik", kind: "kayik", stops: ["salacak", "kiz_kulesi_iskele"], route: [[110, 8], [108, 8], [108, 4], [104, 4]] },
  ],
};

const C = (d: string, tail: string) => `city:istanbul:${d}${tail}`;

/**
 * / TOUR-VIEW — Kız Kulesi **uzak manzarası**. Kule (Üsküdar semti) varış iskelesinden ≈ 95 birim doğuda; eskiden akış halkası
 * (yakın 1, uzak 2 parsel) onu çizmediği için küçültülmüş bir kopyası (`maidenVista`) Haliç süslerine eklenmişti. Gezi görüş
 * katmanıyla (citymap/horizon.ts) şehrin bütün parsellerinin uzak LOD'u — Üsküdar'daki GERÇEK Kız Kulesi dahil — her pozdan silüet
 * olarak görünür (sis katkısı sınırlı); kopya gerçek silüetin yanında ikinci bir kule olurdu, bu yüzden emekli edildi.
 * Silüet kapsamı: scripts/tour_check.mjs LANDMARK-SILHOUETTE-001; manzara: scripts/maiden_tower.test.mjs.
*/

export const ISTANBUL_DESIGN: CityDesign = {
  districts: { tarihi_yarimada: TARIHI_DESIGN, halic: HALIC_DESIGN, beyoglu: BEYOGLU_DESIGN, bogaz: BOGAZ_DESIGN, uskudar: USKUDAR_DESIGN },
  landmarks: { ...TARIHI_LANDMARKS, ...HALIC_LANDMARKS, ...BEYOGLU_LANDMARKS, ...BOGAZ_LANDMARKS, ...USKUDAR_LANDMARKS },
  // Kız Kulesi adasındaki seyir noktası (uskudar vp 1) — "Kız Kulesi'nden gün batımını izle"
  moments: { uskudar: [{ id: "gun_batimi", vp: 1, when: "sunset" }] },
  unlock: {
    halic: { after: "tarihi_yarimada", level: 3 },
    beyoglu: { after: "tarihi_yarimada", level: 3 },
    bogaz: { after: "beyoglu", level: 5 },
    uskudar: { after: "tarihi_yarimada", level: 3 }, // Kız Kulesi ilk oturumda (lider kararı 5 → 3)
  },
  quests: [
    { id: "gizli_cesmeler", district: "tarihi_yarimada", need: [C("tarihi_yarimada", ":gz:1"), C("tarihi_yarimada", ":gz:2")] },
    { id: "yer_alti_saray", district: "tarihi_yarimada", need: [C("tarihi_yarimada", ":in:yerebatan"), C("tarihi_yarimada", ":in:topkapi")] },
    { id: "kopru_alti", district: "halic", need: [C("halic", ":in:galata_koprusu"), C("halic", ":lm:balat")] },
    { id: "istiklal_turu", district: "beyoglu", need: ["city:istanbul:stop:tunel", "city:istanbul:stop:taksim"] },
    { id: "hisar_surlari", district: "bogaz", need: [C("bogaz", ":in:rumeli_hisari"), C("bogaz", ":lm:bogaz_koprusu")] },
    { id: "iki_kita", district: "uskudar", need: [C("tarihi_yarimada", ""), C("uskudar", "")] },
    { id: "gun_batimi", district: "uskudar", need: [C("uskudar", ":an:gun_batimi")] },
  ],
};
