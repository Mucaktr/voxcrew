// odak görünümü: Görünüm menüsü satırı ve yürüme HUD'undaki tam ekran düğmesi (TR + EN).
import { defineMessages } from "../lib/i18n";

export const walkFocus = defineMessages({
  focus_label: "Yürürken sayfa panellerini gizle",
  focus_hint: "Yürüme modunda sayfa başlığı, Ekip ve Canlı akış panelleri ile bantlar gizlenir; dünya ekranı doldurur. Çık ya da Esc normal görünüme döndürür.",
  focus_on: "Gizle",
  focus_off: "Göster",
  fs_enter: "Tam ekran",
  fs_exit: "Tam ekrandan çık",
  fs_enter_aria: "Tarayıcı tam ekranına geç",
  fs_exit_aria: "Tarayıcı tam ekranından çık",
}, {
  focus_label: "Hide page panels while walking",
  focus_hint: "In walk mode the page header, the Team and Live feed panels and banners are hidden; the world fills the screen. Exit or Esc returns to the normal view.",
  focus_on: "Hide",
  focus_off: "Show",
  fs_enter: "Fullscreen",
  fs_exit: "Exit fullscreen",
  fs_enter_aria: "Switch to browser fullscreen",
  fs_exit_aria: "Leave browser fullscreen",
});
