// Çok dillilik (TR/EN) — tek kaynak. Bağımlılıksız, tür güvenli.
//
// Kullanım (bileşen başına bir ad alanı dosyası, src/locales/<ad>.ts):
//   export const m = defineMessages({ title: "Görevler", count: "{n} görev" }, { title: "Tasks", count: "{n} tasks" });
//   const t = useT(m);  t("title");  t("count", { n: 3 })
// İngilizce sözlük TR ile aynı anahtarlara sahip olmak ZORUNDA (TypeScript denetler).
// Bileşen dışı (yardımcı, depo) metinler: tx(m, "anahtar").
// Dil değişince App kök içeriği yeniden bağlanır (key={locale}); bu yüzden tx() ile üretilen metinler de güncellenir.
// Çoğul: EN'de "{n} task" / "{n} tasks" ayrımı için tp(m, "anahtar", n) → "<anahtar>_one" | "<anahtar>_other".

import { useCallback } from "react";
import { create } from "zustand";
import { BRAND } from "./brand";
import { trLocative } from "./trSuffix";

export type Locale = "tr" | "en";
export type LangPref = "auto" | Locale;
export const LOCALES: { id: Locale; label: string; short: string }[] = [
  { id: "tr", label: "Türkçe", short: "TR" },
  { id: "en", label: "English", short: "EN" },
];

type Dict = Record<string, string>;
export interface Messages<T extends Dict> { tr: T; en: { [K in keyof T]: string } }

export function defineMessages<const T extends Dict>(tr: T, en: { [K in keyof T]: string }): Messages<T> {
  return { tr, en };
}

const PREF_KEY = "vc-lang";

export function detectLocale(pref: LangPref): Locale {
  if (pref === "tr" || pref === "en") return pref;
  const langs = typeof navigator !== "undefined" ? [...(navigator.languages ?? []), navigator.language] : [];
  return langs.some((l) => (l || "").toLowerCase().startsWith("tr")) ? "tr" : "en";
}

function readPref(): LangPref {
  try {
    const v = localStorage.getItem(PREF_KEY);
    if (v === "tr" || v === "en" || v === "auto") return v;
  } catch { /* gizli pencere vb. */ }
  return "auto";
}

interface LocaleState {
  pref: LangPref;
  locale: Locale;
  /** Kullanıcı seçimi: yerel olarak hemen uygulanır; sunucu ayarı (ui.language) çağıran tarafından kaydedilir. */
  setPref: (pref: LangPref) => void;
}

export const useLocale = create<LocaleState>((set) => {
  const pref = readPref();
  return {
    pref,
    locale: detectLocale(pref),
    setPref: (p) => {
      try { localStorage.setItem(PREF_KEY, p); } catch { /* yok say */ }
      set({ pref: p, locale: detectLocale(p) });
    },
  };
});

/** Şu anki dil (bileşen dışı kod için). */
export const currentLocale = (): Locale => useLocale.getState().locale;
/** Intl için BCP-47 etiketi. */
export const intlTag = (l: Locale = currentLocale()): string => (l === "tr" ? "tr-TR" : "en-US");

function fill(template: string, vars?: Record<string, string | number | null | undefined>): string {
  // S39 (denetim C-10): {brand} yer tutucusu verilmezse marka adı brand.ts'den gelir (AGENTS kural 8: ad metne kopyalanmaz)
  if (!vars) return template.includes("{brand}") ? template.split("{brand}").join(BRAND.name) : template;
  // W2b-INT: `{n}'de` gibi Türkçe sayı ekleri (de/da/te/ta, den/dan/ten/tan) sayının okunuşuna göre düzeltilir (16'da, 40'ta)
  return template.replace(/\{(\w+)\}('[dt][ea]n?(?![a-zçğıöşü]))?/g, (all, k: string, suf?: string) => {
    const v = k === "brand" && vars[k] == null ? BRAND.name : vars[k];
    if (v == null) return all;
    const num = typeof v === "number" ? v : suf && /^-?\d+$/.test(String(v)) ? Number(v) : null;
    const tail = suf ? (num !== null ? trLocative(num, suf.endsWith("n")) : suf) : "";
    return (typeof v === "number" ? v.toLocaleString(intlTag()) : String(v)) + tail;
  });
}

type Vars = Record<string, string | number | null | undefined>;

/** Bileşen dışı çeviri (şu anki dille). */
export function tx<T extends Dict>(m: Messages<T>, key: keyof T & string, vars?: Vars): string {
  const loc = currentLocale();
  return fill((m[loc] as Dict)[key] ?? m.tr[key] ?? key, vars);
}

/** Çoğul: `<key>_one` / `<key>_other` (yoksa `<key>`). Türkçede sayıdan sonra çoğul eki gelmez → hep `_other`. */
export function tp<T extends Dict>(m: Messages<T>, key: string, n: number, vars?: Vars): string {
  const loc = currentLocale();
  const dict = m[loc] as Dict;
  const form = loc === "en" && n === 1 ? `${key}_one` : `${key}_other`;
  const template = dict[form] ?? dict[key] ?? (m.tr as Dict)[form] ?? (m.tr as Dict)[key] ?? key;
  return fill(template, { n, ...vars });
}

/** Bileşen içi çeviri kancası: dil değişince bileşen yeniden çizilir. */
export function useT<T extends Dict>(m: Messages<T>) {
  const locale = useLocale((s) => s.locale);
  return useCallback(
    (key: keyof T & string, vars?: Vars): string => fill((m[locale] as Dict)[key] ?? m.tr[key] ?? key, vars),
    [locale, m],
  );
}

// ------------------------------------------------------------------ biçimlendirme (dil duyarlı)
export function fmtNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(intlTag(), opts);
}

/** Yüzde işareti dile göre: TR "%4", EN "4%". `p` 0–100 arası tam sayı ya da ondalık. */
export function fmtPercent(p: number, l: Locale = currentLocale()): string {
  return l === "tr" ? `%${p}` : `${p}%`;
}

export function fmtDate(value: string | number | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(intlTag(), opts);
}
