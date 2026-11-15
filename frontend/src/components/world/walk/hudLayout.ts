// UX-P2 — 375 px yürüme HUD'u: saf yardımcılar (içe aktarma yok; node --test doğrudan yükler).
//
// Dar bölümde (HUD kabı < @md, 28 rem) avatar 3B görünümün ortasındadır; üst bant (çubuk + görev satırı) ile alt bant
// (köşe, dokunmatik eylem kümesi, joystick) arasında kalan yer onundur. Bu yüzden dar bölümde:
//  - orta yuva (tostlar, kat başlığı, POI notu) üst bandın hemen altına yaslanır (her genişlikte) ve dar bölümde tek bildirim boyu;
//  - iç mekân çipi yalnız "Kat n/N" (ya da oda) yazar: Çık + çip + Dışarı + Ofise dön tek satıra sığar, üst bant bir satır kısalır;
//  - dokunmatik Etkileşim düğmesi kısa etiket gösterir ("Çıkış: dışarı" → "Dışarı"); tam ad aria-label ve title'da.
// Yuvalar (hudZones.tsx) değişmez; yalnız yerleşimleri ve yoğunlukları. `scripts/overlap_check.mjs` `avatar` ölçümü avatar kutusuna
// binen HUD öğesini sorun sayar.

/** "Önek: ad" biçimli hedef adından dar düğme etiketi: önek atılır, ilk harf büyür (TR: i → İ). Biçim yoksa ad aynen. */
export function shortTargetLabel(name: string, locale = "tr"): string {
  const at = name.indexOf(": ");
  if (at <= 0 || at + 2 >= name.length) return name;
  const rest = name.slice(at + 2).trim();
  return rest ? rest.charAt(0).toLocaleUpperCase(locale) + rest.slice(1) : name;
}
