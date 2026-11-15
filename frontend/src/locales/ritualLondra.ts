// Londra ritüel metinleri: `<locale>_label` (Yakındakiler fiili), `<locale>_done` (bitiş duyurusu),
// `<locale>_note` (anı kartı notu; ördeklerde tek satırlık gerçek hayat notu). TR + EN aynı anahtarlar. Ödül dili yok.
import { defineMessages } from "../lib/i18n";

export const ritualLondra = defineMessages({
  ordek_bezelye_label: "Ördeklere bezelye at",
  ordek_bezelye_done: "Ördekler halkaya yüzüp bezelyeleri kaptı.",
  ordek_bezelye_note: "Ekmek değil bezelye: ördekler için daha iyi.",
  ikindi_cayi_label: "İkindi çayı iç",
  ikindi_cayi_done: "Fincanda çay, tabakta sıcak bir çörek.",
  ikindi_cayi_note: "İkindi çayı ve çörek.",
  balik_patates_label: "Balık-patates ye",
  balik_patates_done: "Kâğıtta sıcacık balık ve patates.",
  balik_patates_note: "Nehir kıyısında kâğıtta balık-patates.",
}, {
  ordek_bezelye_label: "Toss peas to the ducks",
  ordek_bezelye_done: "The ducks paddled over for the peas.",
  ordek_bezelye_note: "Peas, not bread: better for ducks.",
  ikindi_cayi_label: "Have afternoon tea",
  ikindi_cayi_done: "Tea in the cup, a warm scone on the plate.",
  ikindi_cayi_note: "Afternoon tea and a scone.",
  balik_patates_label: "Eat fish and chips",
  balik_patates_done: "Hot fish and chips, wrapped in paper.",
  balik_patates_note: "Fish and chips in paper by the river.",
});
