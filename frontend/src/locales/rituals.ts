// şehir ritüellerinin ortak arayüz metinleri. TR + EN aynı anahtarlar.
// Ritüele özgü fiil ve notlar şehir dosyalarında (locales/ritual<Şehir>.ts). Ritüeller ödül vermez; geri sayım ya da "kaçırma"
// dili yok.
import { defineMessages } from "../lib/i18n";

export const ritualsMsg = defineMessages({
  fallback_label: "Küçük bir an",
  fallback_done: "Güzel bir an.",
  closer: "Biraz daha yaklaş.",
  front: "Tezgâhın önüne geç; sipariş müşteri tarafından verilir.",
  cooldown: "Az önce yaptın; biraz sonra yeniden deneyebilirsin.",
  memory_added: "Anı defterine eklendi.",
  done_memory: "{text} Anı defterine eklendi.",
  not_saved_admin: "Test modu açık: bu an anı defterine yazılmadı.",
  not_saved_creative: "Bu şehir henüz senin değil: yaratıcı modda an anı defterine yazılmaz.",
}, {
  fallback_label: "A small moment",
  fallback_done: "A lovely moment.",
  closer: "Step a little closer.",
  front: "Step round to the front of the counter to order.",
  cooldown: "You just did this; try again in a moment.",
  memory_added: "Added to the memory book.",
  done_memory: "{text} Added to the memory book.",
  not_saved_admin: "Test mode is on: this moment was not saved to the memory book.",
  not_saved_creative: "This city is not yours yet: in creative mode moments are not saved to the memory book.",
});
