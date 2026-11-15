// mini oyun ortak motoru: ortak günlük havuz ve vuruş işareti metinleri.
// TR + EN aynı anahtarlar. Oyun parası sözcüğü bu dosyada geçmez (scripts/terms_check.mjs: oyun dosyası listesinde değil);
// bakiye satırı locales/walk.ts `mg_fish_balance` ile kalır.
import { defineMessages } from "../lib/i18n";

export const minigameMsg = defineMessages({
  pool_today: "Bugünkü mini oyun havuzu: {used}/{max}",
  pool_hint: "Olta dahil bütün mini oyunlar aynı günlük havuzu paylaşır; yürüme ödülü ayrıdır.",
  pool_cap: "Bugünkü mini oyun havuzu doldu; yakalama kaydedildi, ödül yok.",
  cue_lost: "Balık bu sefer gelmedi: sunucudan vuruş işareti alınamadı. Ceza yok, yeniden atabilirsin.",
}, {
  pool_today: "Mini-game coins today: {used}/{max}",
  pool_hint: "All mini-games, fishing included, share one daily pool; walking rewards are separate.",
  pool_cap: "Today's mini-game coins are used up; the catch is saved, no coins.",
  cue_lost: "No bite this time: the server's bite signal didn't arrive. No penalty, cast again.",
});
