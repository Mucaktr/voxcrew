// UXF-A — sayfa parçası yüklenemeyince kabuk içinde gösterilen hata kartı (TR + EN; anahtarlar birebir).
import { defineMessages } from "../lib/i18n";

export const routeErrorMsg = defineMessages({
  title: "Sayfa yüklenemedi",
  offline: "Sunucuya ya da ağa şu an ulaşılamıyor; bu sayfanın parçası indirilemedi. Bağlantı dönünce “Tekrar dene”ye bas — menü ve öteki sayfalar açık kalır.",
  stale: "Uygulama bu sekme açıkken yeniden derlenmiş; bu sayfanın eski parçası artık sunucuda yok. Sayfayı yenilemen yeterli — işlerin sunucuda korunur.",
  error: "Bu sayfada beklenmeyen bir hata oldu. Tekrar deneyebilir ya da sayfayı yenileyebilirsin; menü ve öteki sayfalar çalışmaya devam eder.",
  back_online: "Bağlantı geri geldi — sayfayı yeniden yükleyebilirsin.",
  still: "Yeniden denendi ({n}); hâlâ yüklenemedi.",
  retry: "Tekrar dene",
  reload: "Sayfayı yenile",
  details: "Teknik ayrıntı",
}, {
  title: "This page couldn't load",
  offline: "The server or the network can't be reached right now, so this page's code couldn't be downloaded. Press “Try again” once you're back online — the menu and other pages stay available.",
  stale: "The app was rebuilt while this tab was open, so the old code for this page is gone from the server. Reloading the page is enough — your work is kept on the server.",
  error: "Something unexpected went wrong on this page. You can try again or reload; the menu and other pages keep working.",
  back_online: "You're back online — you can load the page again.",
  still: "Tried again ({n}); still couldn't load.",
  retry: "Try again",
  reload: "Reload page",
  details: "Technical details",
});
