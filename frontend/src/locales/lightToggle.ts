// UXF-G: yürüme HUD'unda gündüz/gece kestirmesi (Görünüm → Işık ile aynı ayar; yalnız moddan çıkmadan erişim).
import { defineMessages } from "../lib/i18n";

export const lightToggleMsg = defineMessages({
  to_day: "Gündüz yap",
  to_night: "Gece yap",
  to_day_aria: "Işığı gündüz yap (şu an gece)",
  to_night_aria: "Işığı gece yap (şu an gündüz)",
}, {
  to_day: "Make it day",
  to_night: "Make it night",
  to_day_aria: "Switch the light to day (it is night now)",
  to_night_aria: "Switch the light to night (it is day now)",
});
