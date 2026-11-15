// Kapadokya ritüel metinleri: `<locale>_label` (Yakındakiler fiili), `<locale>_done` (bitiş duyurusu),
// `<locale>_note` (anı kartı notu). TR + EN aynı anahtarlar. Ödül dili ve satış baskısı yok.
// CITY-PASS-KAP: balon seyri çay bahçesinde, testi kebabı tezgâhta oturularak yenir (mekân + yemek hareketi).
import { defineMessages } from "../lib/i18n";

export const ritualKapadokya = defineMessages({
  teras_balon_label: "Çay al, balonları izle",
  teras_balon_done: "Çayını yudumlarken balonlar süzülerek yükseldi.",
  teras_balon_label_night: "Çay al, yıldızları izle", // gece balon uçmaz
  teras_balon_done_night: "Çayını yudumlarken peribacalarının üstünde yıldızlar parladı.",
  teras_balon_note: "Çay bahçesinden balonlar.",
  testi_kebabi_label: "Testi kebabı ye",
  testi_kebabi_done: "Testi masada kırıldı, buğulu kebabı keyifle yedin.",
  testi_kebabi_note: "Kırık testiden sıcak bir sofra.",
  hali_dugum_label: "Bir düğüm at",
  hali_dugum_done: "Halıda artık senin de bir düğümün var.",
  hali_dugum_note: "Halıya bir düğüm.",
}, {
  teras_balon_label: "Get tea, watch the balloons",
  teras_balon_done: "Balloons drifted up as you sipped your tea.",
  teras_balon_label_night: "Get tea, watch the stars",
  teras_balon_done_night: "Stars shone over the fairy chimneys as you sipped your tea.",
  teras_balon_note: "Balloons from the tea garden.",
  testi_kebabi_label: "Eat a pottery kebab",
  testi_kebabi_done: "The pot was cracked at the table; you enjoyed the hot stew.",
  testi_kebabi_note: "A warm meal from a cracked clay pot.",
  hali_dugum_label: "Tie a knot",
  hali_dugum_done: "One of the knots in this carpet is yours now.",
  hali_dugum_note: "A knot in the carpet.",
});
