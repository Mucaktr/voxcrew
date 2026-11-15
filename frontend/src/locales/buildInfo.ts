// STALE-DIST — eski arayüz derlemesi bandı metinleri (TR + EN; anahtarlar birebir, tsc denetler).
import { defineMessages } from "../lib/i18n";

export const buildInfoMsg = defineMessages({
  text: "Arayüz derlemesi kaynak koddan eski — yeni özellikler görünmeyebilir.",
  how: "Yeniden derlemek için:",
  behind_one: "Derlemeden bu yana arayüzde {n} commit var.",
  behind_other: "Derlemeden bu yana arayüzde {n} commit var.",
  dismiss: "Uyarıyı kapat",
}, {
  text: "The interface build is older than the source code — new features may not appear.",
  how: "To rebuild:",
  behind_one: "{n} interface commit since this build.",
  behind_other: "{n} interface commits since this build.",
  dismiss: "Dismiss warning",
});
