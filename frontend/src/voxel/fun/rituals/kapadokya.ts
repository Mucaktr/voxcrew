// Kapadokya ritüelleri. Ödül yok: yalnız anı.
// Kaya kiliseleri kutsal bölgedir: sahnede açık hava müzesi (i 2–9 × j 4–6, 3 karo payıyla i ≤ 12, j ≤ 9) ve haritada
// `goreme/kaya_kiliseleri` çevresinde hiç girdi yok. At turu eklenmez. Atölyede satış baskısı yok; yalnız zanaat anı.
// CITY-PASS-KAP (kalite seferberliği): yeme-içme ritüelleri gerçek MEKÂNDA (`city/venues.ts placeVenue`; satıcı tezgâhın ardında,
// oturak gerçek): balon seyri çay bahçesinde (`tea_garden`), testi kebabı yöresel yemek tezgâhında (`food_stand`; oturulup yenir).
// Sahne karoları taban Kapadokya sahnesinde (`scenes/kapadokya.ts`): otel önü çay bahçesi (tezgâh 29–31 × 10, sipariş (30, 9)),
// kale köyü lokantası (tezgâh 13–15 × 8, sipariş (14, 9)), Avanos kıyısı tezgâhı (tezgâh 20–22 × 31, sipariş (21, 30)), halı
// avlusu (13–20, 13–22). Harita konumları mekânların sipariş karosu ve kilim atölyesinin önü (semt yerel karo).
import type { RitualDef } from "./index";

/** Bakış (rad; `AvatarState.heading`: 0 → +z, π → −z, π/2 → +x). */
const PZ = 0, NZ = Math.PI;

export const KAPADOKYA_RITUALS: RitualDef[] = [
  {
    // Çay bahçesinde tabureye oturulur, çay yudumlanır. eskiden `when: "day"` — gece satıcı tezgâhta dururken
    // Etkileşim pasif/etiketsizdi; artık her saat açık, balonlar yalnız gündüz uçtuğu için gece metni (`_night`) balon demez.
    id: "teras_balon", city: "kapadokya", locale: "teras_balon", venue: "tea_garden",
    at: {
      // mağara oteli önündeki çay bahçesi (tezgâh güneyde: müşteri balon alanına bakar)
      scene: [{ tile: [30, 9], face: PZ }],
      // balon alanında sabah kahvesi çadırının yanındaki çay bahçesi (sipariş (31, 53); tezgâh güneyde). Uçhisar seyir
      // noktasında da balon seyri çay bahçesi var (ritüelsiz; satıcılı mekân).
      map: [{ district: "balon", tile: [31, 53] }, { district: "uchisar", tile: [28, 48] } /* etkileşimsiz tezgâhın sipariş karosu*/],
    },
    act: { motion: "sip", sit: "sit_bench", held: "tea_glass", secs: 7 },
    react: { burst: "steam" },
  },
  {
    // testi kebabı: testi masada kırılır, kâseden yenir (yemek hareketi; `sip` + yiyecek → yemek, rituals/logic.ts)
    id: "testi_kebabi", city: "kapadokya", locale: "testi_kebabi", venue: "food_stand",
    at: {
      // kale köyü lokantası (çay ocağının yanı; tezgâh kuzeyde) · Avanos kıyısı tezgâhı (çömlek tezgâhlarının yanı; tezgâh güneyde)
      scene: [{ tile: [14, 9], face: NZ }, { tile: [21, 30], face: PZ }],
      // çömlekçi kasabasının ana caddesindeki tezgâh (sipariş (43, 14); tezgâh güneyde)
      map: [{ district: "avanos", tile: [43, 14] }],
    },
    act: { motion: "sip", sit: "sit_bench", held: "bowl", secs: 6 },
    react: { burst: "puff", sfx: "hiss" }, // testi kırılınca kil tozu (zeminde)
  },
  {
    id: "hali_dugum", city: "kapadokya", locale: "hali_dugum",
    at: {
      // halı tezgâhının (17,15) önü · zanaat tezgâhının (15,20) önü
      scene: [{ tile: [17, 16], face: NZ }, { tile: [15, 21], face: NZ }],
      // kilim atölyesinin önü (askıdaki kilimler ve dokuma tezgâhı; semt yerel karo, ayak izinin güneyi)
      map: [{ district: "goreme", tile: [11, 9] }],
    },
    act: { motion: "type", secs: 4 },
    react: { burst: "sparkle", sfx: "rustle" },
  },
];
