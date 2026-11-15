/**
 * CORE-WALK (kalite seferberliği) — ritüel **mekânları** (venue): ritüelin yapıldığı yere uygun mekân türü ve oturak türleri.
 * Saf veri: three/React/depo yok. Ritüel verisi `RitualDef.venue` ile türü söyler (ör. Londra `balik_patates` → `chip_shop`);
 * mekânın kendisi sahne/semt dosyasında `city/venues.ts placeVenue` ile kurulur (tezgâh, masa, bank, tabure, minder). Çalışma
 * zamanı (`fun/ritualRuntime.ts`) oturmalı ritüelde ritüel konumunun `RITUAL_SEAT_RADIUS` içindeki gerçek oturağa yürür ve oturur.
 * Denetim: scripts/ritual_venue.test.mjs (her `venue` ritüelinin her konumunda tezgâh ve yeterli oturak).
 *
 * Şehir ekipleri için: yeni mekân türü eklemek bu tabloya bir satır + `city/venues.ts` içinde bir yerleşim demektir; var olan
 * türler bütün şehirlerde kullanılabilir (İstanbul çay bahçesi → `tea_garden`, <city> krep → `crepe_stand`, <city> piknik → `picnic`).
*/

export const VENUE_KINDS_LIST = ["chip_shop", "pub", "cafe", "crepe_stand", "food_stand", "tea_garden", "picnic"] as const;
export type VenueKind = (typeof VENUE_KINDS_LIST)[number];
/** Oturak türü: bank (sırtsız pub bankı dahil), tabure, sandalye, yer minderi. */
export type VenueSeat = "bench" | "stool" | "chair" | "cushion";

export interface VenueKindDef {
  /** mekânda bulunan oturak türleri (yerleşim sırası) */
  seats: readonly VenueSeat[];
  /** servis tezgâhı (kiosk) var mı */
  counter: boolean;
  /** ritüelin oturuş türü (`RitualSit`): bank/tabure/sandalye → sit_bench; minder → sit_ground */
  pose: "sit_bench" | "sit_ground";
  /** en az oturak sayısı (denetim) */
  minSeats: number;
  /** kısa açıklama (belge; arayüzde gösterilmez) */
  note: string;
}

export const VENUE_KINDS: Readonly<Record<VenueKind, VenueKindDef>> = {
  chip_shop: { seats: ["stool", "bench"], counter: true, pose: "sit_bench", minSeats: 4, note: "balık-patates dükkânı: kızartma tezgâhı, tezgâh önünde tabureler, dışarıda pub bankı ve masa" },
  pub: { seats: ["stool", "bench"], counter: true, pose: "sit_bench", minSeats: 4, note: "pub: bar tezgâhı, tabureler, dışarıda bank-masa takımı" },
  cafe: { seats: ["stool", "chair"], counter: true, pose: "sit_bench", minSeats: 4, note: "kafe: tezgâh, tabureler, masa ve sandalyeler" },
  crepe_stand: { seats: ["stool", "chair"], counter: true, pose: "sit_bench", minSeats: 4, note: "krep standı: ocak tezgâhı, tabureler, küçük masa" },
  food_stand: { seats: ["stool", "bench"], counter: true, pose: "sit_bench", minSeats: 4, note: "sokak yemeği standı: tezgâh, tabureler, bank-masa" },
  tea_garden: { seats: ["stool"], counter: true, pose: "sit_bench", minSeats: 4, note: "çay bahçesi: semaver tezgâhı, alçak masa ve tabureler" },
  picnic: { seats: ["cushion"], counter: false, pose: "sit_ground", minSeats: 3, note: "piknik: hasır örtü ve minderler (yere oturulur)" },
};

export const isVenueKind = (s: unknown): s is VenueKind => typeof s === "string" && (VENUE_KINDS_LIST as readonly string[]).includes(s);
