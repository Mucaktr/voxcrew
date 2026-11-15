// ayrık değerlendirme (mühür) sürerken 423 yanıtı için anlaşılır ileti (TR + EN; ham JSON gösterilmez).
import { defineMessages } from "../lib/i18n";

export const sealedMsg = defineMessages({
  locked_download: "Değerlendirme sürüyor; bu indirme ve dışa aktarma değerlendirme bitince açılır.",
  locked_change: "Değerlendirme sürüyor; bu kayıt değerlendirme bitince değiştirilebilir.",
}, {
  locked_download: "An evaluation is running; this download and export open again when it finishes.",
  locked_change: "An evaluation is running; this record can be changed when it finishes.",
});
