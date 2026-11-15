// canlı olay bağlantısı: kaçan olay telafisi (resync) bildirimi (TR + EN). EN anahtarları TR ile birebir; tsc denetler.
// store.ts → connectEvents: sunucu `resync_required` gönderince akışa (LiveFeed) tek satır düşer; ekran tam yenilenir.
import { defineMessages } from "../lib/i18n";

export const eventsMsg = defineMessages({
  resync_notice: "Canlı bağlantıda olay kaçırıldı; veriler yeniden yüklendi",
  resync_restart: "Sunucu yeniden başladı ya da olay geçmişi değişti; veriler yeniden yüklendi",
}, {
  resync_notice: "Live connection missed some events; data was reloaded",
  resync_restart: "The server restarted or the event history changed; data was reloaded",
});
