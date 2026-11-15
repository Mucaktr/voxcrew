// DEPO-TESLIM — çıktı görüntüleyicilerinin saf mantığı (React / DOM yok; node testi: scripts/delivery_1bc.test.mjs).
// Biçim kayıt defteri (`viewerFor`), CSV ayrıştırıcı, JSON ağaç yardımcıları. Yeni bağımlılık yok: elle ayrıştırma.
// Metin her zaman sunucudan MASKELİ gelir (`GET /api/deliverables/{id}` → content.text); burada yalnız gösterim için işlenir.
// Hücre / satır / sütun sınırları tarayıcıyı korur; sınır aşımı kullanıcıya söylenir (sessiz kesme yok).

export type ViewerKind = "csv" | "json" | "pdf" | "audio" | "video" | "image" | "default";

export const CSV_MAX_ROWS = 500;
export const CSV_MAX_COLS = 50;
export const CELL_MAX_CHARS = 2000;
export const JSON_MAX_CHILDREN = 100;
export const JSON_MAX_DEPTH = 40;
/** Bu boyutun üstündeki ses/video/PDF otomatik yüklenmez (kullanıcı düğmeyle yükler). */
export const AUTO_LOAD_MAX_BYTES = 25 * 1024 * 1024;

const ext = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
};

/** Çıktının görüntüleyicisini seçer. `view` = sunucunun ikili önizleme ipucu (yalnız kasa kopyası varsa dolu). */
export function viewerFor(item: { name: string; source?: string }, content: { kind: string; view?: string | null }): ViewerKind {
  if (item.source && item.source !== "file") return "default";
  const e = ext(item.name);
  if (content.kind === "image") return "image";
  if (content.kind === "binary") {
    return content.view === "pdf" || content.view === "audio" || content.view === "video" ? content.view : "default";
  }
  if (content.kind === "code" || content.kind === "text") {
    if (e === ".csv" || e === ".tsv") return "csv";
    if (e === ".json") return "json";
  }
  return "default";
}

// ---------------------------------------------------------------- CSV
export type CsvDelimiter = "," | ";" | "\t";

/** .tsv → sekme; .csv → ilk satırda (tırnak dışı) en çok geçen ayırıcı (varsayılan virgül). */
export function csvDelimiter(name: string, text: string): CsvDelimiter {
  if (ext(name) === ".tsv") return "\t";
  const first = text.replace(/^﻿/, "").split(/\r\n|\n|\r/, 1)[0] ?? "";
  const count = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of first) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "," || ch === ";" || ch === "\t")) count[ch] += 1;
  }
  return count[";"] > count[","] && count[";"] >= count["\t"] ? ";" : count["\t"] > count[","] ? "\t" : ",";
}

export interface CsvResult {
  header: string[];
  rows: string[][];
  /** okunan toplam kayıt (başlık hariç; `maxRows` aşıldıktan sonra sayım durur) */
  total: number;
  truncatedRows: boolean;
  truncatedCols: boolean;
  /** hücre metni `CELL_MAX_CHARS`'a kısaltıldı mı */
  truncatedCells: boolean;
  /** kapanmamış tırnak: dosya bozuk ya da kesik */
  unterminated: boolean;
}

/** RFC 4180 ayrıştırıcı: tırnaklı alan, "" kaçışı, tırnak içinde satır sonu, CRLF/LF/CR, BOM. İlk satır başlıktır.
 *  Yalnız ilk `maxRows` kayıt ve ilk `maxCols` sütun tutulur; kalanı sayılır / işaretlenir. */
export function parseCsv(text: string, delim: CsvDelimiter, opts?: { maxRows?: number; maxCols?: number }): CsvResult {
  const maxRows = opts?.maxRows ?? CSV_MAX_ROWS;
  const maxCols = opts?.maxCols ?? CSV_MAX_COLS;
  const s = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let truncatedCols = false;
  let truncatedCells = false;
  let unterminated = false;
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  let any = false;  // geçerli kayıtta içerik (ya da ayırıcı) görüldü mü (boş satırı atlamak için)
  let total = 0;
  let stop = false;

  const pushCell = () => {
    if (row.length < maxCols) {
      if (cell.length > CELL_MAX_CHARS) { cell = cell.slice(0, CELL_MAX_CHARS) + "…"; truncatedCells = true; }
      row.push(cell);
    } else truncatedCols = true;
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    if (any || row.some((c) => c !== "")) {
      total += 1;
      if (records.length <= maxRows) records.push(row);  // başlık + maxRows kayıt
      else stop = true;                                    // fazlası yalnız "daha var" bilgisi
    }
    row = []; any = false;
  };

  for (let i = 0; i < s.length && !stop; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 1; } else inQ = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") { inQ = true; any = true; }
    else if (ch === delim) { pushCell(); any = true; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i += 1;
      pushRow();
    } else { cell += ch; any = true; }
  }
  if (inQ) unterminated = true;
  if (!stop && (any || cell !== "" || row.length)) pushRow();
  const header = records[0] ?? [];
  const rows = records.slice(1);
  return {
    header, rows, total: Math.max(0, total - (records.length ? 1 : 0)), truncatedRows: stop,
    truncatedCols, truncatedCells, unterminated,
  };
}

// ---------------------------------------------------------------- JSON
/** `JSON.parse` güvenli tamsayı aralığı dışındaki sayıyı yuvarlar (12345678901234567890 → 12345678901234567000) ve
 * `1e400`'ü `Infinity` yapar. Böyle sayılar dosyadaki yazımıyla (`raw`) tutulup gösterilir.*/
export class JsonRawNumber {
  constructor(public raw: string) {}
}

const isUnsafeNumberToken = (tok: string): boolean => {
  const n = Number(tok);
  return !Number.isFinite(n) || (!/[.eE]/.test(tok) && !Number.isSafeInteger(n));
};

/** Metindeki (dizge dışı) güvenli olmayan sayı belirteci sayısı: sonlu olmayan ya da güvenli tamsayı dışı. Doğrusal tarama. */
export function countUnsafeNumbers(text: string): number {
  const re = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  let n = 0;
  for (let i = 0; i < text.length;) {
    const ch = text.charCodeAt(i);
    if (ch === 34) {  // " → dizge sonuna atla (\ kaçışı dikkate alınır)
      i += 1;
      while (i < text.length && text.charCodeAt(i) !== 34) i += text.charCodeAt(i) === 92 ? 2 : 1;
      i += 1;
    } else if (ch === 45 || (ch >= 48 && ch <= 57)) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m) { if (isUnsafeNumberToken(m[0])) n += 1; i += m[0].length; } else i += 1;
    } else i += 1;
  }
  return n;
}

/** `unsafe`: güvenli olmayan sayı sayısı; `exact`: hepsi dosyadaki yazımıyla tutuldu (tarayıcı `JSON.parse` kaynak metin
 *  desteği: reviver'ın 3. bağımsız değişkeni). `exact` yanlışsa arayüz yuvarlama uyarısı gösterir. */
export type JsonParse = { ok: true; value: unknown; unsafe: number; exact: boolean } | { ok: false; error: string };

export function parseJsonSafe(text: string): JsonParse {
  try {
    const src = text.replace(/^﻿/, "");
    const unsafe = countUnsafeNumbers(src);
    let kept = 0;
    const reviver = (_k: string, v: unknown, ctx?: { source?: string }): unknown => {
      if (typeof v === "number" && typeof ctx?.source === "string" && isUnsafeNumberToken(ctx.source)) {
        kept += 1;
        return new JsonRawNumber(ctx.source);
      }
      return v;
    };
    const value = JSON.parse(src, unsafe ? reviver : undefined) as unknown;
    return { ok: true, value, unsafe, exact: kept >= unsafe };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type JsonType = "object" | "array" | "string" | "number" | "boolean" | "null";
export const jsonType = (v: unknown): JsonType =>
  v instanceof JsonRawNumber ? "number" : v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? "object"
    : typeof v === "string" ? "string" : typeof v === "number" ? "number" : "boolean";

/** Açılabilir düğümün çocukları: [anahtar, değer]; dizilerde anahtar dizin. */
export function jsonEntries(v: unknown): [string, unknown][] {
  if (v instanceof JsonRawNumber) return [];
  if (Array.isArray(v)) return v.map((x, i) => [String(i), x]);
  if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>);
  return [];
}

/** Kapalı düğümün özeti: `{3}` / `[12]` (sayı); sayı sunumu arayüz katmanında yerelleştirilir. */
export const jsonCount = (v: unknown): number => jsonEntries(v).length;

/** Düz değerin gösterim metni (metin değerleri tırnaklı; uzun metin kısaltılır). */
export function jsonScalar(v: unknown): string {
  if (v instanceof JsonRawNumber) return v.raw.length > CELL_MAX_CHARS ? v.raw.slice(0, CELL_MAX_CHARS) + "…" : v.raw;
  if (typeof v === "string") return JSON.stringify(v.length > CELL_MAX_CHARS ? v.slice(0, CELL_MAX_CHARS) + "…" : v);
  return String(v);
}

/** Ağaçta toplam düğüm sayısı (üst sınırlı); çok büyük belgede varsayılan olarak yalnız ilk düzey açılır. */
export function jsonSize(v: unknown, cap = 5000, depth = 0): number {
  if (depth > JSON_MAX_DEPTH) return 1;
  let n = 1;
  for (const [, c] of jsonEntries(v)) {
    n += jsonSize(c, cap - n, depth + 1);
    if (n >= cap) return cap;
  }
  return n;
}
