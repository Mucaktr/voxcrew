// Londra ritüelleri. Ödül yok: yalnız anı.
// Ana meydanda güvercin besleme yok (D5): meydan güvercinleri yalnız havalanır. Ördeklere ekmek değil bezelye.
// `ordek_bezelye` sahnede ördeklerin yaşadığı su gövdesinin yürünür kıyısındadır (olta noktası değil); FEED_ONLY
// besleme noktası olta anlamı için kalır ve olta listesine girmez (`entities.ts` feedOnly'yi atlar). Çizim +0
// (yeni nesne yok), Londra gecesi 22/22 korunur. Harita bağlantıları durak karoları; göl kayıkhanesi kapısız landmark.
import type { RitualDef } from "./index";

/** Bakış (rad; `AvatarState.heading`: 0 → +z, π → −z, π/2 → +x). */
const PZ = 0;

export const LONDRA_RITUALS: RitualDef[] = [
  {
    id: "ordek_bezelye", city: "londra", locale: "ordek_bezelye",
    at: {
      // (lider kararı): ördeklerin yaşadığı su gövdesinin kuzey kıyısı, iki gölet kancasının (8,6 · 24,6) önü; gölete +z
      // bakar. Olta noktası değil; FEED_ONLY noktası olta anlamı için kalır (ördek ritüeli ona bağlı değil).
      scene: [{ tile: [9, 3], face: PZ }, { tile: [24, 3], face: PZ }],
      // parktaki gölün kayıkhanesi
      map: [{ district: "park", landmark: "kayikhane" }],
    },
    act: { motion: "toss", held: "peas", secs: 4 },
    react: { lure: { kinds: ["duck"], n: 3, mode: "swim" }, burst: "ripple", sfx: "quack" },
  },
  {
    id: "ikindi_cayi", city: "londra", locale: "ikindi_cayi",
    // CITY-PASS-LON (kalite seferberliği): pazar tezgâhı/kafe masası yerine gerçek bir **çay salonu** (`cafe` mekânı, city/venues.ts):
    // tezgâhtan çay alınır, tezgâh önündeki tabureye ya da masadaki sandalyeye oturulur; masada üç katlı servis tabağı ve
    // çaydanlık (city/styles/londra.ts teaRoomDecor). Konum = sipariş karosu (tezgâha bakar).
    // Sahne: kapalı pazarın güneyinde çay salonu (tezgâh 15–17 × 19, sipariş (16, 18), masa (16, 17)).
    // Harita: çarşı meydanında çay salonu (tezgâh li 27–29 lj 11, sipariş (28, 12)).
    venue: "cafe",
    at: {
      scene: [{ tile: [16, 18], face: PZ }],
      map: [{ district: "carsi", tile: [28, 12] }],
    },
    act: { motion: "sip", sit: "sit_bench", held: "tea", secs: 6 },
    react: { burst: "steam", sfx: "chime" },
  },
  {
    id: "balik_patates", city: "londra", locale: "balik_patates",
    // CORE-WALK (kalite seferberliği): rıhtım bankı değil, balık-patates dükkânı (`chip_shop`, city/venues.ts) — tezgâhtan alınır,
    // tezgâh önündeki tabureye ya da dışarıdaki pub bankına oturulur. Konum = dükkânın sipariş karosu (tezgâha bakar).
    // Sahne: sütunlu meydanın güney ucu (tezgâh 16–18 × 30). Harita: Westminster iskelesinin doğusunda kıyı yolu
    // (tezgâh li 39–41, lj 25) ve kale iskelesinin güneyinde (tezgâh li 7–9, lj 28).
    venue: "chip_shop",
    at: {
      scene: [{ tile: [17, 29], face: PZ }],
      map: [{ district: "westminster", tile: [40, 24] }, { district: "kale", tile: [8, 27] }],
    },
    act: { motion: "sip", sit: "sit_bench", held: "paper_cone", secs: 5 },
  },
];
