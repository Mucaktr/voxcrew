// UX-P2 — Claude yalıtım kartının "limits" metnini listeye çeviren saf yardımcı (içe aktarma yok; node --test yükler).
//
// Metin (locales/claudeIsolation.ts `limits`, TR ve EN) tek kaynaktır ve paylaşılan testler onu olduğu gibi sabitler
// (test_iso_wording.py, test_qa17_fixes.py). Kart onu "Ayrıntılar" içinde iki liste olarak gösterir:
//   1. cümle  "<doğrulananlar başlığı>: madde; madde; …."   → doğrulananlar
//   2. cümle  "<doğrulanmayanlar başlığı>: madde; …."       → doğrulanmayanlar
//   kalan cümleler                                          → sınırlar (paragraf)
// Hiçbir iddia düşmez: `joinLimits(splitLimits(x))` metni aynen geri kurar (node testi). Biçim tutmazsa null → kart metni
// olduğu gibi tek paragraf gösterir.

export interface LimitsParts {
  verifiedTitle: string;
  verified: string[];
  unverifiedTitle: string;
  unverified: string[];
  /** listelerden sonra kalan cümleler (üst klasör taraması, sürümler, ayrıntı notu) */
  rest: string[];
}

/** Cümlelere böl: nokta (ya da ")." ) + boşluk + büyük harf. "v2.1.277", "AGENTS.md'yi" bölünmez. */
export function sentences(text: string): string[] {
  return text.trim().split(/(?<=\.)\s+(?=\p{Lu})/u);
}

/** Parantez dışındaki "; " ayırıcılarından böler. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0 && s[k + 1] === " ") { out.push(s.slice(start, k)); start = k + 2; }
  }
  out.push(s.slice(start));
  return out;
}

function listSentence(s: string): { title: string; items: string[] } | null {
  const at = s.indexOf(": ");
  if (at <= 0 || !s.endsWith(".")) return null;
  const items = splitTop(s.slice(at + 2, -1)).map((x) => x.trim());
  return items.length && items.every(Boolean) ? { title: s.slice(0, at), items } : null;
}

export function splitLimits(text: string): LimitsParts | null {
  const ss = sentences(text);
  if (ss.length < 2) return null;
  const v = listSentence(ss[0]), u = listSentence(ss[1]);
  if (!v || !u) return null;
  return { verifiedTitle: v.title, verified: v.items, unverifiedTitle: u.title, unverified: u.items, rest: ss.slice(2) };
}

/** Ters işlem (test): parçalardan özgün metni kurar. */
export function joinLimits(p: LimitsParts): string {
  return [`${p.verifiedTitle}: ${p.verified.join("; ")}.`, `${p.unverifiedTitle}: ${p.unverified.join("; ")}.`, ...p.rest].join(" ");
}
