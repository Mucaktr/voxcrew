/**
 * locale birleştirici. Yeni şehirlerin `locale.ts` ad alanlarını (world, city, walk, explore, landmarkInfo, ritualBook)
 * paylaşılan sözlüklere ekler; locale dosyaları DEĞİŞMEZ (tek dosyalık locale testleri onları içe aktarımsız yükler).
 * Üretilmiş `index.ts` bunu `NEW_CITIES` kurulur kurulmaz bir kez çağırır; şehir kayıtlarının hepsi `index.ts`'i okuduğu için
 * şehir metni ilk okunmadan önce eklenmiş olur. Var olan anahtar ASLA ezilmez (yeni şehir eski metni değiştiremez). Şehir yokken
 * hiçbir şey yapmaz. Yalnız locale dosyalarını içe aktarır (sahne/kit yok; döngü olmaz).
*/
import { city } from "../../locales/city";
import { explore } from "../../locales/explore";
import { landmarkInfo } from "../../locales/landmarkInfo";
import { ritualBook } from "../../locales/ritualBook";
import { walk } from "../../locales/walk";
import { world } from "../../locales/world";
import type { CityLocale, CityLocaleNs } from "./types";

const TARGETS: Readonly<Record<Exclude<CityLocaleNs, "ritual">, { tr: object; en: object }>> = {
  world, city, walk, explore, landmarkInfo, ritualBook,
};

export function mergeCityLocales(cities: readonly { locale: CityLocale }[]): void {
  for (const c of cities) {
    for (const [ns, m] of Object.entries(TARGETS) as [keyof typeof TARGETS, { tr: object; en: object }][]) {
      const add = c.locale[ns];
      if (!add) continue;
      for (const lang of ["tr", "en"] as const) {
        const into = m[lang] as Record<string, string>;
        for (const [k, v] of Object.entries(add[lang])) if (!(k in into)) into[k] = v;
      }
    }
  }
}
