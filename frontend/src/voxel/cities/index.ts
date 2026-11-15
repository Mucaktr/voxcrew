// kararlı yüz: yeni şehir manifestleri. Liste `src/full/cityIndex.ts` içinde üretilir (`node scripts/cities.mjs --write`);
// EDITION1: free dışa aktarımda o dosya silinir ve `src/full/cityIndex/index.ts` (şehirsiz eş) çözülür.
import { mergeCityLocales } from "./locales";
import { NEW_CITIES } from "../../full/cityIndex";

export { NEW_CITIES, NEW_CITY_IDS, type NewCityId } from "../../full/cityIndex";
// şehir metinleri paylaşılan sözlüklere bir kez (var olan anahtar ezilmez; V/cities/locales.ts)
mergeCityLocales(NEW_CITIES);
