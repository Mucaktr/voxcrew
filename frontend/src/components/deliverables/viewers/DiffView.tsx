// DEPO-TESLIM — iki çıktı sürümünün karşılaştırması. Sunucu `GET /api/deliverables/{id}/diff?against=` farkı
// hesaplar (`left` her zaman eski sürüm; metin MASKELİ). Kipler: text (satır farkı), image (iki sürüm yan yana, `/raw`),
// bundle (dosya listesi), binary (boyut + özet), unavailable. Erişilebilirlik: fark gerçek bir tablo (sütun başlıkları
// ekran okuyucuya, ekler/silmeler yalnız renkle değil `+`/`−` ve gizli metinle), kaydırma yalnız tablo kutusunda (375 px'te
// sayfa yatay taşmaz), satırlar `break-words`.
import { ArrowLeft, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Badge, Button, Spinner } from "../../ui";
import {
  deliverablesApi, type DeliverableDiff, type DeliverableVersion, type DiffRow, type DiffSide,
} from "../../../lib/deliverables";
import { fmtDate, fmtNumber, useT } from "../../../lib/i18n";
import { deliverablesMsg as m } from "../../../locales/deliverables";

/** Varsayılan karşılaştırma hedefi: görüntülenenden hemen önceki sürüm; yoksa hemen sonraki. */
export function defaultAgainst(versions: DeliverableVersion[], id: string): string | null {
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  const at = sorted.findIndex((v) => v.id === id);
  if (at < 0) return sorted[0]?.id ?? null;
  return (sorted[at - 1] ?? sorted[at + 1])?.id ?? null;
}

const sizeText = (n?: number | null) => (n == null ? "—" : `${fmtNumber(n)} B`);

function TextRows({ rows, a, b }: { rows: DiffRow[]; a: number; b: number }) {
  const t = useT(m);
  return (
    <div role="region" aria-label={t("diff_region", { a, b })} tabIndex={0}
      className="overflow-auto max-h-[70vh] rounded-lg border-2 border-line bg-panel focus-visible:outline-2" data-diff-text="">
      <table className="w-full border-collapse font-mono text-xs table-fixed">
        <caption className="sr-only">{t("diff_region", { a, b })}</caption>
        <colgroup><col className="w-9 sm:w-11" /><col className="w-9 sm:w-11" /><col className="w-6" /><col /></colgroup>
        <thead className="sr-only">
          <tr><th scope="col">{t("diff_old_line")}</th><th scope="col">{t("diff_new_line")}</th><th scope="col">{t("diff_change")}</th><th scope="col">{t("view_text")}</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => r.t === "…" ? (
            <tr key={i} className="bg-panel-2"><td colSpan={4} className="px-2 py-1 text-center font-sans text-muted">{t("diff_skip", { n: fmtNumber(r.n ?? 0) })}</td></tr>
          ) : (
            <tr key={i} className={clsx(r.t === "+" && "bg-ok-soft", r.t === "-" && "bg-bad-soft")}>
              <td className="px-1 text-right align-top text-muted num select-none">{r.a ?? ""}</td>
              <td className="px-1 text-right align-top text-muted num select-none">{r.b ?? ""}</td>
              <td className="text-center align-top font-semibold text-ink select-none">
                <span aria-hidden>{r.t === "+" ? "+" : r.t === "-" ? "−" : ""}</span>
                <span className="sr-only">{r.t === "+" ? t("diff_row_added") : r.t === "-" ? t("diff_row_removed") : t("diff_row_same")}</span>
              </td>
              <td className="px-1 align-top whitespace-pre-wrap break-words text-ink">{r.x ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FileList({ title, items, tone }: { title: string; items: string[]; tone: "ok" | "bad" | "warn" }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <h4 className="text-xs font-semibold text-ink-2">{title}</h4>
      <ul className="flex flex-col gap-0.5 text-xs font-mono break-all">
        {items.map((p) => <li key={p} className={clsx("rounded px-1.5 py-0.5", `tone-${tone}`)}>{p}</li>)}
      </ul>
    </div>
  );
}

function SideInfo({ side, label }: { side: DiffSide; label: string }) {
  const t = useT(m);
  return (
    <div className="flex flex-col gap-0.5 min-w-0 text-xs">
      <span className="font-semibold text-ink">{label}</span>
      <span className="text-muted">{side.created_at ? fmtDate(side.created_at, { dateStyle: "medium", timeStyle: "short" }) : ""}</span>
      <span className="num">{t("diff_size")}: {sizeText(side.size)}</span>
      <span className="font-mono break-all">{t("diff_sha")}: {side.sha256 ? side.sha256.slice(0, 16) : "—"}</span>
    </div>
  );
}

function DiffBody({ d, title }: { d: DeliverableDiff; title: string }) {
  const t = useT(m);
  const a = d.left.version, b = d.right.version;
  if (d.mode === "unavailable") {
    return (
      <div className="flex flex-col gap-1 text-sm" role="status">
        <p className="text-warn">{t(d.reason === "not_vaulted" ? "diff_not_vaulted" : "diff_unavailable")}</p>
        {!!d.forgotten?.length && <p className="text-muted">{t("diff_forgotten")}</p>}
      </div>
    );
  }
  if (d.mode === "image") {
    return (
      <div className="flex flex-col gap-3 min-w-0">
        <p className="text-sm" role="status">{d.identical ? t("diff_img_same") : t("diff_img_diff")}</p>
        <div className="grid gap-3 sm:grid-cols-2 min-w-0">
          {([[d.left, "diff_img_old"], [d.right, "diff_img_new"]] as const).map(([s, key]) => (
            <figure key={s.id} className="flex flex-col gap-1.5 min-w-0 m-0">
              <figcaption className="text-xs font-semibold text-ink-2">{t(key, { n: s.version })}</figcaption>
              <img src={deliverablesApi.rawUrl(s.id)} alt={t("diff_img_alt", { title, n: s.version })}
                className="max-w-full h-auto rounded-lg border-2 border-line bg-panel-2" loading="lazy" />
            </figure>
          ))}
        </div>
      </div>
    );
  }
  if (d.mode === "bundle" && d.files) {
    const f = d.files;
    const none = !f.added.length && !f.removed.length && !f.changed.length;
    return (
      <div className="flex flex-col gap-3 min-w-0">
        {none && <p className="text-sm" role="status">{t("diff_bundle_none")}</p>}
        <FileList title={t("diff_bundle_added", { n: fmtNumber(f.added.length) })} items={f.added} tone="ok" />
        <FileList title={t("diff_bundle_removed", { n: fmtNumber(f.removed.length) })} items={f.removed} tone="bad" />
        <FileList title={t("diff_bundle_changed", { n: fmtNumber(f.changed.length) })} items={f.changed} tone="warn" />
        <p className="text-xs text-muted">{t("diff_bundle_same", { n: fmtNumber(f.same) })}{f.truncated ? ` ${t("diff_bundle_cut")}` : ""}</p>
      </div>
    );
  }
  if (d.mode === "text") {
    const rows = d.rows ?? [];
    return (
      <div className="flex flex-col gap-2 min-w-0">
        {d.identical ? <p className="text-sm" role="status">{t("diff_identical")}</p>
          : d.tail_unchecked ? <p className="text-sm text-warn" role="status">{t("diff_tail_unknown", { n: fmtNumber(3000) })}</p> : (
          <>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <Badge tone="ok"><Plus size={12} aria-hidden />{t("diff_added_n", { n: fmtNumber(d.added ?? 0) })}</Badge>
              <Badge tone="bad"><Minus size={12} aria-hidden />{t("diff_removed_n", { n: fmtNumber(d.removed ?? 0) })}</Badge>
            </div>
            <TextRows rows={rows} a={a} b={b} />
          </>
        )}
        <div className="flex flex-col gap-0.5 text-xs text-muted">
          {d.lines_truncated && <p>{t("diff_lines_cut", { n: fmtNumber(3000) })}</p>}
          {d.rows_truncated && <p>{t("diff_rows_cut", { n: fmtNumber(4000) })}</p>}
          {d.truncated && <p>{t("diff_text_cut")}</p>}
          <p>{t("diff_masked")}</p>
        </div>
      </div>
    );
  }
  // binary
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <p className="text-sm" role="status">
        {d.identical === true ? t("diff_binary_same") : d.identical === false ? t("diff_binary_diff") : t("diff_binary_unknown")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 min-w-0">
        <SideInfo side={d.left} label={t("diff_img_old", { n: a })} />
        <SideInfo side={d.right} label={t("diff_img_new", { n: b })} />
      </div>
      <p className="text-xs text-muted">{t("diff_binary_note")}</p>
    </div>
  );
}

export function DiffView({ id, title, versions, initialAgainst, onClose }:
  { id: string; title: string; versions: DeliverableVersion[]; initialAgainst?: string | null; onClose: () => void }) {
  const t = useT(m);
  const others = useMemo(() => [...versions].filter((v) => v.id !== id).sort((x, y) => y.version - x.version), [versions, id]);
  const [against, setAgainst] = useState<string | null>(initialAgainst ?? defaultAgainst(versions, id));
  const [diff, setDiff] = useState<DeliverableDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!against) return;
    let alive = true;
    setDiff(null); setError(null);
    deliverablesApi.diff(id, against)
      .then((r) => { if (alive) setDiff(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [id, against]);

  const selId = `diff-against-${id}`;
  return (
    <section aria-label={t("compare_title")} className="flex flex-col gap-3 min-w-0" data-diff-view="">
      <div className="flex flex-wrap items-end gap-2">
        <Button size="sm" icon={<ArrowLeft size={14} />} onClick={onClose}>{t("compare_close")}</Button>
        <div className="flex flex-col gap-0.5 min-w-0">
          <label htmlFor={selId} className="text-xs font-semibold text-muted">{t("compare_with")}</label>
          <select id={selId} className="select !w-auto max-w-full" value={against ?? ""} onChange={(e) => setAgainst(e.target.value || null)}>
            {others.map((v) => (
              <option key={v.id} value={v.id}>
                {[t("version_n", { n: v.version }), v.current ? t("version_latest") : "",
                  v.created_at ? fmtDate(v.created_at, { dateStyle: "medium", timeStyle: "short" }) : ""].filter(Boolean).join(" · ")}
              </option>
            ))}
          </select>
        </div>
      </div>
      {diff && <h3 className="text-sm font-semibold break-words">{t("compare_head", { a: diff.left.version, b: diff.right.version })}</h3>}
      {!against && <p className="text-sm text-muted">{t("diff_bundle_none")}</p>}
      {against && !diff && !error && (
        <div role="status" className="flex items-center gap-2 text-sm text-muted py-6 justify-center"><Spinner size={18} />{t("compare_loading")}</div>
      )}
      {error && <p role="alert" className="text-sm text-bad break-words">{t("compare_error", { error })}</p>}
      {diff && <DiffBody d={diff} title={title} />}
    </section>
  );
}
