// W2b-INT — Türkçe sayı ekleri (bulunma 'de/'da/'te/'ta, ayrılma 'den/'dan/'ten/'tan). Ek, sayının okunuşundaki SON
// sözcüğe göre seçilir: ünlü uyumu (e/a) ve sert ünsüz benzeşmesi (ç, f, h, k, p, s, ş, t → t). Bağımlılıksız; i18n.ts
// `fill()` şablonlarda `{n}'de` gibi yazılmış ekleri sayıya göre düzeltir ("Ofis Sv 16'da", "40'ta", "100'de").

/** [ünlü, sert] — birler basamağı (1 bir … 9 dokuz). */
const ONES: Record<number, [string, boolean]> = {
  1: ["e", false], 2: ["e", false], 3: ["e", true], 4: ["e", true], 5: ["e", true],
  6: ["a", false], 7: ["e", false], 8: ["e", false], 9: ["a", false],
};
/** onlar basamağı (10 on … 90 doksan). */
const TENS: Record<number, [string, boolean]> = {
  1: ["a", false], 2: ["e", false], 3: ["a", false], 4: ["a", true], 5: ["e", false],
  6: ["a", true], 7: ["e", true], 8: ["e", false], 9: ["a", false],
};

/** Sayının okunuşundaki son sözcüğün ek bilgisi: [ünlü, sert ünsüzle mi bitiyor]. */
function lastWord(n: number): [string, boolean] {
  let v = Math.abs(Math.trunc(n));
  if (!Number.isFinite(v) || v === 0) return ["a", false]; // sıfır
  if (v % 10) return ONES[v % 10];
  if ((v / 10) % 10) return TENS[Math.floor(v / 10) % 10];
  if ((v / 100) % 10) return ["e", false]; // yüz
  v = Math.floor(v / 1000);
  if (v % 1000) return ["e", false]; // bin
  return ["a", false]; // milyon, milyar (ve üstü)
}

/** Bulunma eki: 1 → "'de", 3 → "'te", 6 → "'da", 40 → "'ta", 100 → "'de". `from` true → ayrılma ("'den", "'tan" …). */
export function trLocative(n: number, from = false): string {
  const [v, hard] = lastWord(n);
  return `'${hard ? "t" : "d"}${v}${from ? "n" : ""}`;
}
