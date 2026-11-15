// Ekip S50 — bağımlılıksız, hafif sözdizimi renklendirme (yorum, metin, sayı, anahtar sözcük). Amaç okunabilirlik;
// tam ayrıştırıcı değildir. Renkler tema belirteçlerinden (AA kontrastlı metin renkleri).
import { useMemo } from "react";

const KEYWORDS = new Set((
  "and as assert async await break case catch class const continue def default del delete do elif else enum export " +
  "extends false final finally for from func function go if impl import in interface is lambda let match mod module " +
  "new nil none null or pass private protected pub public raise return self static struct super switch this throw " +
  "true try type typeof use var void while with yield True False None SELECT FROM WHERE INSERT UPDATE DELETE JOIN " +
  "GROUP BY ORDER LIMIT AND OR NOT NULL CREATE TABLE INTO VALUES select from where insert update join group by order"
).split(" "));

// sıra önemli: yorum → metin → sayı → sözcük
const TOKEN = /(\/\/[^\n]*|#[^\n]*|--[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d[\d_.]*(?:e[+-]?\d+)?\b|\b[A-Za-z_][\w]*\b)/g;
const HASH_COMMENT = new Set(["python", "bash", "yaml", "toml", "ruby", "powershell", "r"]);
const DASH_COMMENT = new Set(["sql", "lua"]);

type Part = { text: string; cls?: string };

function tokenize(src: string, lang?: string | null): Part[] {
  const out: Part[] = [];
  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    const tok = m[0];
    const at = m.index ?? 0;
    let cls: string | undefined;
    if (tok.startsWith("//") || tok.startsWith("/*")) cls = lang && (HASH_COMMENT.has(lang) || lang === "csv") ? undefined : "text-muted italic";
    else if (tok.startsWith("#")) cls = lang && HASH_COMMENT.has(lang) ? "text-muted italic" : undefined;
    else if (tok.startsWith("--")) cls = lang && DASH_COMMENT.has(lang) ? "text-muted italic" : undefined;
    else if (/^["'`]/.test(tok)) cls = "text-ok";
    else if (/^\d/.test(tok)) cls = "text-info";
    else if (KEYWORDS.has(tok)) cls = "text-accent font-semibold";
    if (!cls) continue;
    if (at > last) out.push({ text: src.slice(last, at) });
    out.push({ text: tok, cls });
    last = at + tok.length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out;
}

export function CodeView({ text, lang, label }: { text: string; lang?: string | null; label?: string }) {
  // çok büyük dosyada renklendirme atlanır (tarayıcıyı yormasın)
  const parts = useMemo(() => (text.length > 200_000 ? [{ text }] : tokenize(text, lang)), [text, lang]);
  return (
    <pre className="font-mono text-xs whitespace-pre-wrap break-words panel-soft p-3 overflow-x-auto" aria-label={label}
      data-lang={lang ?? undefined}>
      <code>{parts.map((p, i) => (p.cls ? <span key={i} className={p.cls}>{p.text}</span> : p.text))}</code>
    </pre>
  );
}
