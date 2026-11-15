// CITYLIFE — geçit (F) istemleri: her giriş hedefini söyler ("İçeri gir — Galata Kulesi"). TR + EN aynı anahtarlar.
import { defineMessages } from "../lib/i18n";

export const citylife = defineMessages({
  f_enter: "İçeri gir — {name}",
  f_enter_court: "Avluya gir — {name}", // iç mekânı yalnız avlu olan simge
  lm_door_court: "{name} · avlu girişi",
  f_exit: "Dışarı çık — {name}",
  f_up: "Yukarı çık — {n}. kat",
  f_down: "Aşağı in — {n}. kat",
  f_down_ground: "Aşağı in — zemin kat",
  f_stop: "Turnikeden geç — {stop}",
  lm_door: "{name} · giriş",
  // asansör durağı ("F: Asansörle çık — Seyir galerisi")
  f_lift_up: "Asansörle çık — {room}",
  f_lift_down: "Asansörle in — {room}",
}, {
  f_enter: "Go inside — {name}",
  f_enter_court: "Enter the courtyard — {name}",
  lm_door_court: "{name} · courtyard entrance",
  f_exit: "Go outside — {name}",
  f_up: "Go up — floor {n}",
  f_down: "Go down — floor {n}",
  f_down_ground: "Go down — ground floor",
  f_stop: "Through the gate — {stop}",
  lm_door: "{name} · entrance",
  f_lift_up: "Take the lift up — {room}",
  f_lift_down: "Take the lift down — {room}",
});
