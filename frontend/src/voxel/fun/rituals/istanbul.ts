// İstanbul ritüelleri. Ödül yok: yalnız anı.
// Sahne karoları taban İstanbul sahnesindedir (`scenes/istanbul.ts`): Boğaz i 23–27, batı rıhtımı i 22, doğu rıhtımı i 28,
// güney rıhtımı j 30–31; camilerin kutsal payı (3 karo) j ≤ 13'e kadar uzanır. Harita bağlantıları yalnız durak (iskele)
// karolarıdır: kapısı olan landmark iç mekâna açtığı, kapısız landmarkın ortası yapının içinde kaldığı için kullanılmaz.
// Karoların yürünür, ulaşılır ve sessiz bölge dışında olduğu `scripts/rituals_istanbul.test.mjs` ile kanıtlanır.
// CITY-PASS-IST (kalite seferberliği): oturmalı ritüeller gerçek mekânda (CORE-WALK `fun/venues.ts` + `city/venues.ts`): çay →
// çay bahçesi (semaver tezgâhı, alçak tabureler ve masa), balık-ekmek → rıhtımdaki ızgara teknesinin yanındaki tezgâh (tabure +
// masa). Konum = mekânın sipariş karosu (tezgâha bakar); harita konumu semt yerel karo (`tile`, iskele durağının yanı). Simit
// iskele başındaki simit arabasından alınır (sahne ve haritada konumun yakınında araba).
import type { RitualDef } from "./index";

/** Bakış (rad; `AvatarState.heading`: 0 → +z, π → −z, π/2 → +x). */
const PZ = 0, NZ = Math.PI, PX = Math.PI / 2, NX = -Math.PI / 2;

export const ISTANBUL_RITUALS: RitualDef[] = [
  {
    // ürün sahibinin örneği (D4): küçük parça, tek atış, ödülsüz; gerçek hayat notu yalnız anı kartında
    id: "simit_marti", city: "istanbul", locale: "simit_marti",
    at: {
      // güney rıhtımı Boğaz'a bakar (vapur şeritleri önde) · doğu rıhtımı, köprü ayağındaki martı tüneğinin altında ·
      // ACTIVITY-FEEL (B5): her konum bir simit arabasının yanında (simit arabadan alınır): güney (26, 31), doğu (29, 22) ve
      // Sultanahmet meydanındaki satıcılı araba (12, 19) — eskiden meydandaki arabadan simit alınamıyordu
      // HQA-FIX: `cart` — arabanın yönü; satıcı figüranı arabanın ardında (eskiden iki rıhtım arabası satıcısızdı)
      scene: [{ tile: [25, 31], face: NZ, cart: PX }, { tile: [29, 23], face: NX, cart: NZ }, { tile: [13, 19], face: PX, cart: NX }],
      // ACTIVITY-FEEL (B5): iskele başındaki simit arabalarının önü (Eminönü araba (48, 41) → (48, 42); Üsküdar araba (16, 68) →
      // (16, 67)); eskiden durak karosuna bağlıydı ve arabadan 2,2–3,6 karo uzaktaydı
      map: [{ district: "tarihi_yarimada", tile: [48, 42], cart: NZ }, { district: "uskudar", tile: [16, 67], cart: PZ }],
    },
    act: { motion: "toss", held: "simit", secs: 3 },
    react: { lure: { kinds: ["gull"], n: 1, mode: "catch" }, sfx: "squawk" },
  },
  {
    id: "cay_bogaz", city: "istanbul", locale: "cay_bogaz", venue: "tea_garden",
    at: {
      // Mısır çarşısı benzeri salonun önündeki çay bahçesi (tezgâh 16–18 × 25) · doğu kıyısında Boğaz'a bakan çay bahçesi
      // (tezgâh 31 × 24–26, masa kıyıda 29, 25; asma köprü ankrajından (29, 18) ≥ 2 boş karo uzakta, yine Boğaz kıyısında)
      scene: [{ tile: [17, 26], face: NZ }, { tile: [30, 25], face: PX }],
      // Salacak sahili, Kız Kulesi karşısı (tezgâh li 18, lj 55–57; durak salacak (14, 56)) · Rumeli Hisarı iskelesinin yanı
      // (tezgâh li 25, lj 79–81; durak rumeli_iskele (29, 80))
      map: [{ district: "uskudar", tile: [17, 56] }, { district: "bogaz", tile: [26, 80] }],
    },
    act: { motion: "sip", sit: "sit_bench", held: "tea_glass", secs: 6 },
    react: { burst: "steam", sfx: "hiss" },
  },
  {
    // tane yem (ekmek değil); cami avlusunun dışında: hipodrom meydanı ve çarşı meydanı. Güvercinler gece tünekte → gündüz.
    id: "guvercin_yem", city: "istanbul", locale: "guvercin_yem", when: "day",
    at: {
      scene: [{ tile: [9, 16], face: PZ }, { tile: [15, 17], face: PZ }],
      map: [{ district: "tarihi_yarimada", tile: [32, 45] }],
    },
    act: { motion: "toss", held: "paper_cone", secs: 4 },
    react: { lure: { kinds: ["pigeon"], n: 4, mode: "peck" }, sfx: "coo" },
  },
  {
    // iskelede balık ekmek: rıhtıma bağlı ızgara teknesinden, rıhtımdaki tezgâhta; yakındaki martı yalnız bakar (çekme yok)
    id: "balik_ekmek", city: "istanbul", locale: "balik_ekmek", venue: "food_stand",
    at: {
      // vapur iskelesinin yanında batı rıhtımı: suda (i 23) ızgara teknesi ve satış tahtası, rıhtımda tabureler, geride masa
      scene: [{ tile: [22, 28], face: PX }],
      // Eminönü rıhtımı (tezgâh li 54–56, lj 43; durak eminonu_iskele (50, 43)) · Karaköy rıhtımı (tezgâh li 39–41, lj 0; durak
      // karakoy_iskele (44, 0))
      map: [{ district: "tarihi_yarimada", tile: [55, 42] }, { district: "beyoglu", tile: [40, 1] }],
    },
    act: { motion: "sip", sit: "sit_bench", held: "sandwich", secs: 5 },
    react: { sfx: "squawk" },
  },
  {
    // hayvana bağlı (§2.2 notu): bir yere değil, yakındaki ortam kedisine bağlanır. Şehir haritasında kedi yok → harita
    // bağlantısı yok; sahnede girdi yalnız kedi avatarın 2,5 birim yakınındayken görünür ( `type` alanını yayımlar).
    id: "kedi_mama", city: "istanbul", locale: "kedi_mama",
    at: { animal: "cat" },
    act: { motion: "toss", held: "bowl", secs: 4 },
    react: { lure: { kinds: ["cat"], n: 1, mode: "peck" }, sfx: "purr" },
  },
];
