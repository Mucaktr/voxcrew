/**
 * **Kapadokya şehir haritası** (biçim v1.3 `city_map` + tasarım katmanı). İstanbul
 * modeliyle aynı: landmarklar gerçek oranlarına yakın, mesafeler "turistik harita" ölçeğinde. Yön: +z kuzey, +x doğu. Varış
 * meydanı (şehir karosu [0, 12) × [0, 16)) Göreme otogar meydanıdır (ofis tabanındaki Kapadokya kapısı):
 *
 * ┌ Avanos [0, 48] (kızıl nehir, çömlekçiler; minibüs) ┐
 * ┌ Vadiler [−48, −16] (peri bacaları, patikalar, seyir sırtı) ┐[meydan]┌ Göreme [12, −16] (kasaba, mağara oteli, kaya kiliseleri) ┐
 * ┌ Uçhisar [−48, −80] (kaya kalesi; zirve) ┐ ┌ Balon alanı [12, −96] ┐ ┌ Yer altı şehri [72, −80] (minibüs) ┐
 * │ vadi kenarı, │
 * │ güney minibüs yolu │
 *
 * Ulaşım: balon (kalkış alanı → vadilere iniş; yüksekten seyir), minibüs (Göreme → Avanos; Göreme → Uçhisar → yer altı şehri),
 * yürüyüş patikaları (Göreme ↔ Vadiler ↔ Uçhisar, Göreme ↔ balon alanı). Avanos ve yer altı şehrine yalnız minibüsle.
 *
 * Açılış (SK-K5): Göreme ücretsiz başlangıç semti; Vadiler ve balon alanı Göreme'ye girince (ya da ofis seviyesi 3), Avanos Göreme'ye
 * girince (ya da seviye 4), Uçhisar Vadiler'e girince (ya da seviye 4), yer altı şehri Uçhisar'a girince (ya da seviye 5) açılır.
 * Para yolu yok. Görevler süresizdir (FOMO yok).
*/
import type { CityMapFile } from "../format";
import type { CityDesign } from "../design";
import { AVANOS_DESIGN, AVANOS_LANDMARKS } from "../../city/landmarks/kapadokya/avanos";
import { BALON_DESIGN, BALON_LANDMARKS } from "../../city/landmarks/kapadokya/balon";
import { GOREME_DESIGN, GOREME_LANDMARKS } from "../../city/landmarks/kapadokya/goreme";
import { UCHISAR_DESIGN, UCHISAR_LANDMARKS } from "../../city/landmarks/kapadokya/uchisar";
import { VADILER_DESIGN, VADILER_LANDMARKS } from "../../city/landmarks/kapadokya/vadiler";
import { YERALTI_DESIGN, YERALTI_LANDMARKS } from "../../city/landmarks/kapadokya/yeralti";

export const KAPADOKYA_MAP: CityMapFile = {
  id: "kapadokya",
  gate: { kind: "plaza" },
  districts: [
    {
      id: "goreme", seed: 1985, bounds: [12, -16, 48, 48], theme: "bazaar",
      landmarks: [
        { id: "peri_bacalari", shape: "tower", tile: [14, 28], w: 6, d: 6, h: 10.8 },
        { id: "magara_otel", shape: "hall", tile: [24, 36], w: 4, d: 3, h: 2.4 }, // HOTEL-SYS: tek otel, küçük (eski 12 × 6 × 8; köşe yerinde)
        { id: "kaya_kiliseleri", shape: "hall", tile: [36, 4], w: 9, d: 6, h: 7 },
        { id: "hali_atolyesi", shape: "hall", tile: [8, 10], w: 6, d: 4, h: 3 },
      ],
      entries: [[0, 23], [23, 0]],
      viewpoints: [[6, 35]], // CABLEVP1 (VP-NEAR-001): eskiden [7, 38] — kaya ve direk 4–5 m'den %35
    },
    {
      id: "vadiler", seed: 1907, bounds: [-48, -16, 48, 64], theme: "hill",
      landmarks: [
        { id: "pasabag", shape: "tower", tile: [8, 44], w: 5, d: 5, h: 11.6 },
        { id: "ask_vadisi", shape: "obelisk", tile: [30, 50], w: 4, d: 4, h: 12.6 },
        { id: "guvercinlik", shape: "hall", tile: [6, 10], w: 10, d: 3, h: 7 },
      ],
      entries: [[47, 23], [31, 0]],
      viewpoints: [[28, 22]],
    },
    {
      id: "uchisar", seed: 1071, bounds: [-48, -80, 48, 64], theme: "hill",
      landmarks: [
        { id: "uchisar_kalesi", shape: "tower", tile: [16, 22], w: 14, d: 12, h: 22, door: [23, 21], interior: "castle" },
        { id: "magara_evleri", shape: "hall", tile: [4, 40], w: 8, d: 4, h: 4.6 },
      ],
      entries: [[23, 63], [36, 10]],
      viewpoints: [[24, 50]],
    },
    {
      // güneye 16 karo büyüdü (vadi kenarı, kalkış alanı uzantısı); yerel karolar +16 → şehir karosunda yer değiştiren yok
      id: "balon", seed: 1783, bounds: [12, -96, 48, 80], theme: "garden",
      landmarks: [
        // CITY-PASS-KAP: h 6 → 12,6 (yerde şişmiş balonun zarf tepesi ≈ 12,4; CITY-MAP-LM-001 model tepesi ≤ h + 0,6)
        { id: "kalkis_alani", shape: "hall", tile: [10, 36], w: 14, d: 10, h: 12.6 },
        { id: "sabah_kahvesi", shape: "hall", tile: [30, 56], w: 4, d: 3, h: 2.8 },
      ],
      entries: [[23, 79], [18, 52]],
      viewpoints: [[40, 28]],
    },
    {
      id: "avanos", seed: 1250, bounds: [0, 48, 48, 48], theme: "bazaar",
      landmarks: [
        { id: "comlek_atolyesi", shape: "hall", tile: [6, 8], w: 8, d: 6, h: 4.8, door: [10, 14], interior: "lobby" },
        { id: "comlekci_sokagi", shape: "hall", tile: [28, 11], w: 12, d: 4, h: 3.2 },
        { id: "asma_kopru", shape: "tower", tile: [21, 21], w: 2, d: 2, h: 4.6 },
      ],
      entries: [[24, 6], [24, 40]],
      viewpoints: [[20, 30]],
    },
    {
      id: "yeralti", seed: 1963, bounds: [72, -80, 48, 48], theme: "historic",
      landmarks: [
        { id: "yeralti_sehri", shape: "hall", tile: [18, 20], w: 10, d: 6, h: 4, door: [22, 19], interior: "museum" },
        { id: "havalandirma", shape: "obelisk", tile: [34, 26], w: 2, d: 2, h: 2.2 },
        { id: "koy_cesmesi", shape: "obelisk", tile: [10, 30], w: 2, d: 2, h: 2.4 },
      ],
      entries: [[24, 6], [23, 30]],
      viewpoints: [[34, 36]],
    },
  ],
  stops: [
    { id: "goreme_otogar", district: "goreme", tile: [3, 20] },
    // vadi mekiğinin Göreme ucu (şehir 33,31): kasabanın kuzey sokağı; buradan vadiye düz yol (varış/durak paneli kareleri açık)
    { id: "goreme_kasaba", district: "goreme", tile: [21, 47] },
    { id: "balon_alani", district: "balon", tile: [18, 50] },
    { id: "vadi_inis", district: "vadiler", tile: [30, 40] },
    { id: "uchisar", district: "uchisar", tile: [36, 10] },
    { id: "avanos", district: "avanos", tile: [24, 4] },
    { id: "derinkuyu", district: "yeralti", tile: [24, 4] },
  ],
  lines: [
    // balon ve minibüs rotaları karo değiştirmez (ray yok): balon yüksekten süzülür, minibüs yol üstünde gider
    { id: "balon", kind: "balon", stops: ["balon_alani", "vadi_inis"], route: [[30, -46], [14, -24], [-4, 2], [-18, 24]] },
    // METRO2: vadi mekiği (Göreme ↔ kaya kiliseli vadi). otogardan (15,4) kalkınca meydan süsleri yüzünden kuzeye çıkıp ~100°
    // dönüyordu: 47,5 karo / 21,7 sn, kuş uçuşu yürüme 14,8 sn (yürümek hızlıydı). Kasaba durağından vadiye tek düz yol: 51,5 karo,
    // 18,6 sn (biniş dahil) < yürüme 19,8 sn (CITY-MAP-WORTH-001); dönüş yok → kamera dönmez
    { id: "vadi_mekigi", kind: "otobus", stops: ["goreme_kasaba", "vadi_inis"], route: [[33, 31], [-18, 24]] },
    { id: "minibus_avanos", kind: "otobus", stops: ["goreme_otogar", "avanos"], route: [[15, 4], [15, 36], [24, 36], [24, 52]] },
    { id: "minibus_guney", kind: "otobus", stops: ["goreme_otogar", "uchisar", "derinkuyu"],
      // CITY-POLISH: batıya lj 1 boyunca (Göreme ve Vadiler gizli köşeleri lj 2'de kalır; eskiden üstlerinden geçiyordu)
      route: [[15, 4], [15, -15], [-12, -15], [-12, -70], [-12, -86], [96, -86], [96, -76]] },
  ],
};

const C = (d: string, tail: string) => `city:kapadokya:${d}${tail}`;

export const KAPADOKYA_DESIGN: CityDesign = {
  districts: { goreme: GOREME_DESIGN, vadiler: VADILER_DESIGN, uchisar: UCHISAR_DESIGN, balon: BALON_DESIGN, avanos: AVANOS_DESIGN, yeralti: YERALTI_DESIGN },
  landmarks: { ...GOREME_LANDMARKS, ...VADILER_LANDMARKS, ...UCHISAR_LANDMARKS, ...BALON_LANDMARKS, ...AVANOS_LANDMARKS, ...YERALTI_LANDMARKS },
  // vadilerdeki seyir sırtı (vadiler vp 1): peri bacalarının üstüne gün batımı
  moments: { vadiler: [{ id: "gun_batimi", vp: 1, when: "sunset" }] },
  unlock: {
    vadiler: { after: "goreme", level: 3 },
    balon: { after: "goreme", level: 3 },
    avanos: { after: "goreme", level: 4 },
    uchisar: { after: "vadiler", level: 4 },
    yeralti: { after: "uchisar", level: 5 },
  },
  quests: [
    { id: "kaya_kiliseleri", district: "goreme", need: [C("goreme", ":lm:kaya_kiliseleri"), C("goreme", ":lm:peri_bacalari")] },
    { id: "vadi_patikasi", district: "vadiler", need: [C("vadiler", ":gz:1"), C("vadiler", ":gz:2")] },
    { id: "balon_turu", district: "balon", need: ["city:kapadokya:stop:balon_alani", "city:kapadokya:stop:vadi_inis"] },
    { id: "kale_zirvesi", district: "uchisar", need: [C("uchisar", ":in:uchisar_kalesi"), C("uchisar", ":vp:1")] },
    { id: "comlek_atolyesi", district: "avanos", need: [C("avanos", ":in:comlek_atolyesi"), C("avanos", ":lm:asma_kopru")] },
    { id: "yeralti_kesfi", district: "yeralti", need: [C("yeralti", ":in:yeralti_sehri"), C("yeralti", ":lm:havalandirma")] },
    { id: "gun_batimi", district: "vadiler", need: [C("vadiler", ":an:gun_batimi")] },
  ],
};
