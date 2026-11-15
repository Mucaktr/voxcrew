// EDITION1 — free sürüm "Yakında" kartı: tam sürümdeki şehirler YALNIZ görünen adlarıyla (kod, veri, harita yok) ve ücretli
// paketlerin adları. Satış yok: fiyat, satın alma düğmesi ya da bağlantısı yazılmaz. Tam sürümde kart hiç çizilmez. Saf modül (node --test).
import { EDITION } from "../edition";
import type { Locale } from "./i18n";

export const IS_FREE_EDITION = (EDITION as string) === "free";

const NAMES: Record<Locale, readonly string[]> = {
  tr: ["Paris", "Tokyo", "New York", "Rio de Janeiro", "Roma", "Barselona", "Amsterdam", "Moskova", "Kahire", "Marakeş", "Petra",
    "Dubai", "Agra", "Bangkok", "Singapur", "Seul", "Pekin", "Şanghay"],
  en: ["Paris", "Tokyo", "New York", "Rio de Janeiro", "Rome", "Barcelona", "Amsterdam", "Moscow", "Cairo", "Marrakesh", "Petra",
    "Dubai", "Agra", "Bangkok", "Singapore", "Seoul", "Beijing", "Shanghai"],
};
const PLANS: readonly string[] = ["Plus", "Pro"];
const TEXT: Record<Locale, { title: string; cities: string; plans: string; note: string; aria: string }> = {
  tr: { title: "Yakında", cities: "Yeni şehirler", plans: "Büyük ekipler için paketler",
    note: "Hazır olduklarında burada haber vereceğiz.", aria: "Yakında gelecek şehirler ve paketler" },
  en: { title: "Coming soon", cities: "New cities", plans: "Plans for bigger teams",
    note: "We'll let you know here when they're ready.", aria: "Cities and plans coming soon" },
};

export type ComingSoonCard = { title: string; note: string; aria: string; groups: { label: string; names: readonly string[] }[] };

/** "Yakında" kartının içeriği (yeni şehirler + ücretli paket adları); tam sürümde null (kart çizilmez). */
export function fullEditionCard(locale: Locale, free = IS_FREE_EDITION): ComingSoonCard | null {
  if (!free) return null;
  const x = TEXT[locale];
  return { title: x.title, note: x.note, aria: x.aria, groups: [{ label: x.cities, names: NAMES[locale] }, { label: x.plans, names: PLANS }] };
}
