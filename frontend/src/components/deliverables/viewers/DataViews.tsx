// DEPO-TESLIM — veri görüntüleyicileri: CSV/TSV tablosu ve JSON açılır ağacı. Yeni bağımlılık yok (elle ayrıştırma:
// lib/deliveryViewers.ts). Metin sunucudan MASKELİ gelir; hücreler yalnızca metin olarak yazılır (HTML / bağlantı yorumlanmaz).
// Erişilebilirlik: tablo kaydırılabilir bölge (tabIndex 0 + ad), JSON düğümleri gerçek düğme (Tab/Enter/Boşluk, aria-expanded).
import { ChevronRight } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Badge, Button } from "../../ui";
import { fmtNumber, useT } from "../../../lib/i18n";
import {
  CSV_MAX_COLS, CSV_MAX_ROWS, JSON_MAX_CHILDREN, JSON_MAX_DEPTH, csvDelimiter, jsonCount, jsonEntries, jsonScalar, jsonSize,
  jsonType, parseCsv, parseJsonSafe,
} from "../../../lib/deliveryViewers";
import { deliverablesMsg as m } from "../../../locales/deliverables";

// ---------------------------------------------------------------- CSV / TSV
export function CsvTable({ name, text, truncated }: { name: string; text: string; truncated?: boolean }) {
  const t = useT(m);
  const delim = useMemo(() => csvDelimiter(name, text), [name, text]);
  const res = useMemo(() => parseCsv(text, delim), [text, delim]);
  const cols = Math.max(res.header.length, ...res.rows.map((r) => r.length), 0);
  const delimName = delim === "\t" ? t("delim_tab") : delim === ";" ? t("delim_semicolon") : t("delim_comma");
  if (!res.header.length) return <p className="text-sm text-muted">{t("csv_empty")}</p>;
  return (
    <div className="flex flex-col gap-2 min-w-0" data-csv-table="">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge tone="info">{t("csv_summary", {
          rows: res.truncatedRows ? t("csv_rows_more", { n: fmtNumber(CSV_MAX_ROWS) }) : fmtNumber(res.total), cols: fmtNumber(cols) })}</Badge>
        <Badge>{t("csv_delim", { d: delimName })}</Badge>
      </div>
      {/* kaydırma yalnızca bu kutuda: sayfa 375 px'te yatay taşmaz; klavye ile odaklanıp ok tuşlarıyla kaydırılır */}
      <div role="region" aria-label={t("csv_region", { name })} tabIndex={0}
        className="overflow-auto max-h-[70vh] rounded-lg border-2 border-line bg-panel focus-visible:outline-2">
        <table className="min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-[1] bg-panel-2">
            <tr>
              <th scope="col" className="px-2 py-1.5 text-right font-semibold text-muted border-b-2 border-line w-10"><span className="sr-only">{t("csv_row")}</span></th>
              {Array.from({ length: cols }, (_v, i) => (
                <th key={i} scope="col" className="px-2 py-1.5 text-left font-semibold text-ink border-b-2 border-line whitespace-nowrap max-w-[24rem] truncate"
                  title={res.header[i] ?? ""}>{res.header[i] || `#${i + 1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {res.rows.map((row, r) => (
              <tr key={r} className={clsx(r % 2 === 1 && "bg-panel-2/60")}>
                <th scope="row" className="px-2 py-1 text-right font-normal text-muted num align-top border-b border-line-soft">{fmtNumber(r + 1)}</th>
                {Array.from({ length: cols }, (_v, i) => (
                  <td key={i} className="px-2 py-1 align-top border-b border-line-soft text-ink min-w-[6rem] max-w-[24rem] whitespace-pre-wrap break-words">{row[i] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!res.rows.length && <p className="text-xs text-muted">{t("csv_empty")}</p>}
      <div className="flex flex-col gap-0.5 text-xs text-muted">
        {res.truncatedRows && <p>{t("csv_rows_cut", { n: fmtNumber(CSV_MAX_ROWS) })}</p>}
        {res.truncatedCols && <p>{t("csv_cols_cut", { n: fmtNumber(CSV_MAX_COLS) })}</p>}
        {res.truncatedCells && <p>{t("csv_cells_cut")}</p>}
        {res.unterminated && <p className="text-warn">{t("csv_unterminated")}</p>}
        {truncated && <p>{t("truncated")}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- JSON ağacı
const TYPE_CLS: Record<string, string> = { string: "text-ok", number: "text-info", boolean: "text-accent", null: "text-muted italic" };

function JsonNode({ k, v, depth, openTo, last }: { k: string | null; v: unknown; depth: number; openTo: number; last?: boolean }) {
  const t = useT(m);
  const type = jsonType(v);
  const expandable = type === "object" || type === "array";
  const count = expandable ? jsonCount(v) : 0;
  const [open, setOpen] = useState(expandable && depth < openTo && count > 0);
  const [shown, setShown] = useState(JSON_MAX_CHILDREN);
  const key = k !== null ? <span className="text-ink-2 break-all">{k}<span className="text-muted">:&nbsp;</span></span> : null;
  if (!expandable) {
    return (
      <li className="flex flex-wrap items-baseline gap-x-0 min-w-0 py-0.5 pl-6">
        {key}<span className={clsx("break-all whitespace-pre-wrap", TYPE_CLS[type])}>{jsonScalar(v)}</span>{!last && <span className="sr-only">,</span>}
      </li>
    );
  }
  const summary = count === 0 ? (type === "array" ? t("json_empty_arr") : t("json_empty_obj"))
    : type === "array" ? t("json_arr_n", { n: fmtNumber(count) }) : t("json_obj_n", { n: fmtNumber(count) });
  const kids = open ? jsonEntries(v) : [];
  return (
    <li className="min-w-0">
      <button type="button" disabled={count === 0} aria-expanded={count > 0 ? open : undefined}
        onClick={() => setOpen((o) => !o)}
        className={clsx("inline-flex items-center gap-1 min-h-8 sm:min-h-6 max-w-full text-left rounded-md hover:bg-panel-2 focus-visible:outline-2",
          count === 0 && "cursor-default hover:bg-transparent")}>
        <ChevronRight size={14} aria-hidden className={clsx("shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-90", count === 0 && "opacity-30")} />
        {key}<span className="text-muted">{type === "array" ? "[" : "{"}<span className="font-sans px-1">{summary}</span>{type === "array" ? "]" : "}"}</span>
      </button>
      {open && depth >= JSON_MAX_DEPTH ? <p className="pl-6 text-xs text-muted">{t("json_deep")}</p> : open && (
        <ul className="ml-2.5 pl-3 border-l-2 border-line-soft">
          {kids.slice(0, shown).map(([ck, cv], i) => (
            <JsonNode key={ck} k={ck} v={cv} depth={depth + 1} openTo={openTo} last={i === kids.length - 1} />
          ))}
          {kids.length > shown && (
            <li className="pl-6 py-1">
              <Button size="sm" onClick={() => setShown((n) => n + JSON_MAX_CHILDREN * 2)}>{t("json_more", { n: fmtNumber(kids.length - shown) })}</Button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

export function JsonTree({ name, text, truncated, fallback }:
  { name: string; text: string; truncated?: boolean; fallback: ReactNode }) {
  const t = useT(m);
  const parsed = useMemo(() => (truncated ? ({ ok: false, error: t("truncated") } as const) : parseJsonSafe(text)), [text, truncated, t]);
  const size = useMemo(() => (parsed.ok ? jsonSize(parsed.value) : 0), [parsed]);
  const big = size >= 2000;
  const [openTo, setOpenTo] = useState(big ? 1 : 2);
  const [gen, setGen] = useState(0);  // "tümünü aç/kapat": düğümler yeni varsayılanla yeniden kurulur
  if (!parsed.ok) {
    return (
      <div className="flex flex-col gap-2 min-w-0">
        <p role="status" className="text-xs text-warn break-words">{t("json_invalid", { error: parsed.error })}</p>
        {fallback}
      </div>
    );
  }
  const expandAll = () => { setOpenTo(JSON_MAX_DEPTH + 1); setGen((g) => g + 1); };
  const collapseAll = () => { setOpenTo(0); setGen((g) => g + 1); };
  return (
    <div className="flex flex-col gap-2 min-w-0" data-json-tree="">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={expandAll} disabled={big}>{t("json_expand")}</Button>
        <Button size="sm" onClick={collapseAll}>{t("json_collapse")}</Button>
        {big && <span className="text-xs text-muted">{t("json_big")}</span>}
      </div>
      {/* tarayıcı sayının dosyadaki yazımını veremediyse (JSON.parse kaynak desteği yok) yuvarlama uyarısı*/}
      {parsed.unsafe > 0 && !parsed.exact && <p role="status" className="text-xs text-warn break-words">{t("json_unsafe_num")}</p>}
      <div className="panel-soft p-2 font-mono text-xs overflow-auto max-h-[70vh]" role="region" aria-label={t("json_tree_label", { name })} tabIndex={0}>
        <ul>
          <JsonNode key={gen} k={null} v={parsed.value} depth={0} openTo={openTo} last />
        </ul>
      </div>
    </div>
  );
}
