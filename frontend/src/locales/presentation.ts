// GIFTS-GENDER — görünüm biçimi (giyim tarzı) metinleri, AvatarEditor (TR + EN; anahtarlar birebir aynı).
import { defineMessages } from "../lib/i18n";

export const presentationMsg = defineMessages({
  pres_label: "Giyim tarzı",
  pres_hint: "Otomatik: ajanın adına göre erkek ya da kadın giyimi. Açık seçim adı geçersiz kılar.",
  pres_auto: "Otomatik",
  pres_m: "Erkek",
  pres_f: "Kadın",
  pres_n: "Nötr",
  pres_auto_now: "Otomatik ({pres})",
}, {
  pres_label: "Clothing style",
  pres_hint: "Automatic: men's or women's clothes based on the agent's name. An explicit choice overrides the name.",
  pres_auto: "Automatic",
  pres_m: "Masculine",
  pres_f: "Feminine",
  pres_n: "Neutral",
  pres_auto_now: "Automatic ({pres})",
});
