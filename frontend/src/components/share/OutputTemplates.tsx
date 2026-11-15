// Karar 12 — çıktı şablonları penceresi (İş akışları sayfası): içe aktarılan şablonları listeler, önizler; "İş akışına
// uygula" akış seçtirir, kalite bloğu farkını gösterir ve açık onaydan sonra yazar. Silme de onaylıdır. Yazma uçları
// yalnız kullanıcıdan (USER_ONLY_RE: share/outputs/); MCP istemcisi bu işlemleri yapamaz.
import { CheckCircle2, FileText, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useLocale, useT } from "../../lib/i18n";
import { parseRule, qualityDiff, type OutputTemplate, type QualityDiffRow } from "../../lib/outputTemplates";
import { ShareApiError, shareApi } from "../../lib/share";
import type { Workflow } from "../../lib/types";
import { outputTemplatesMsg as m } from "../../locales/outputTemplates";
import { Badge, Button, Empty, Modal, Spinner } from "../ui";

type WorkflowQ = Workflow & { quality?: unknown; example?: boolean };
type Stage = { kind: "view" } | { kind: "diff"; wf: WorkflowQ; rows: QualityDiffRow[] } | { kind: "delete" };

const errMsg = (e: unknown) => (e instanceof ShareApiError || e instanceof Error ? e.message : String(e));

/** `onApplied(slug, quality)`: sayfa açık taslağın kalite bloğunu güncellesin (eski taslak kaydedilince şablon ezilmesin). */
type Applied = (slug: string, quality: unknown) => void;

export function OutputTemplatesButton({ onApplied }: { onApplied?: Applied }) {
  const t = useT(m);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon={<FileText size={16} />} title={t("open_title")} onClick={() => setOpen(true)}>{t("open")}</Button>
      <OutputTemplatesDialog open={open} onClose={() => setOpen(false)} onApplied={onApplied} />
    </>
  );
}

function OutputTemplatesDialog({ open, onClose, onApplied }: { open: boolean; onClose: () => void; onApplied?: Applied }) {
  const t = useT(m);
  const lang = useLocale((s) => s.locale);
  const [items, setItems] = useState<OutputTemplate[] | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowQ[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [wfSlug, setWfSlug] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "view" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pickId = useId();
  const listId = useId();

  const load = async () => {
    const [outs, wfs] = await Promise.all([shareApi.outputs(), api.workflows()]);
    setItems(outs.items);
    setWorkflows((wfs as WorkflowQ[]).filter((w) => !w.error));
    setSel((cur) => (cur && outs.items.some((o) => o.id === cur) ? cur : outs.items[0]?.id ?? null));
  };

  useEffect(() => {
    if (!open) return;
    setItems(null); setErr(null); setNote(null); setStage({ kind: "view" }); setWfSlug("");
    load().catch((e: unknown) => { setErr(errMsg(e)); setItems([]); });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (stage.kind !== "view") stageRef.current?.focus(); }, [stage]);

  const tpl = items?.find((o) => o.id === sel) ?? null;
  const tplName = tpl ? tpl.name || tpl.id : "";

  const ruleText = (r: string): string => {
    const { key, n } = parseRule(r);
    const k = `rule_${key}` as keyof typeof m.tr;
    return k in m.tr ? t(k, n ? { n } : undefined) : r;
  };
  const cellText = (row: QualityDiffRow, vals: string[]) =>
    vals.length ? (row.field === "rules" ? vals.map(ruleText) : vals).join(row.field === "required_sections" ? " → " : ", ") : t("none");

  const startApply = () => {
    const wf = workflows.find((w) => w.slug === wfSlug);
    if (!wf || !tpl) return;
    setErr(null); setNote(null);
    setStage({ kind: "diff", wf, rows: qualityDiff(wf.quality, tpl, lang) });
  };

  const doApply = async () => {
    if (stage.kind !== "diff" || !tpl) return;
    setBusy(true); setErr(null);
    try {
      const saved = await shareApi.applyOutput(tpl.id, stage.wf.slug) as { quality?: unknown } | null;
      setNote(t("applied", { tpl: tplName, wf: stage.wf.name || stage.wf.slug }));
      setStage({ kind: "view" });
      onApplied?.(stage.wf.slug, saved?.quality);
      await load();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  const doDelete = async () => {
    if (!tpl) return;
    setBusy(true); setErr(null);
    try {
      await shareApi.deleteOutput(tpl.id);
      setNote(t("deleted"));
      setStage({ kind: "view" });
      setSel(null);
      await load();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("title")} width={760}>
      <div className="flex flex-col gap-3 text-sm min-w-0">
        <p className="text-ink-2 leading-relaxed">{t("intro")}</p>
        {note && <p role="status" className="text-ok font-semibold flex items-center gap-1.5"><CheckCircle2 size={15} aria-hidden />{note}</p>}
        {err && <p role="alert" className="text-bad font-semibold break-words">{err}</p>}
        {!items ? <Spinner /> : items.length === 0 ? <Empty icon={<FileText size={26} />} title={t("empty")} /> : (
          <div className="grid gap-3 grid-cols-[minmax(0,1fr)] md:grid-cols-[220px_minmax(0,1fr)]">
            <div role="group" aria-labelledby={listId} className="flex flex-col gap-2 min-w-0">
              <span id={listId} className="label">{t("list_label")}</span>
              {items.map((o) => (
                <button key={o.id} type="button" aria-pressed={o.id === sel} disabled={busy}
                  onClick={() => { setSel(o.id); setStage({ kind: "view" }); setNote(null); setErr(null); }}
                  className="card-select p-2.5 flex flex-col gap-1 text-left min-w-0">
                  <span className="font-semibold truncate">{o.name || o.id}</span>
                  <span className="flex flex-wrap gap-1">
                    <Badge tone="muted">{(o.format || "md").toUpperCase()}</Badge>
                    <Badge tone="muted">{t("sections_n", { n: String(o.sections?.length ?? 0) })}</Badge>
                    {o.imported && <Badge tone="info">{t("imported")}</Badge>}
                  </span>
                </button>
              ))}
            </div>

            {tpl && (
              <section aria-label={t("preview")} className="flex flex-col gap-3 min-w-0">
                <div className="panel p-3 flex flex-col gap-2 min-w-0">
                  <h3 className="font-display font-semibold text-base break-words">{tplName}</h3>
                  {tpl.description && <p className="text-ink-2 break-words">{tpl.description}</p>}
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
                    <dt className="text-muted">{t("format")}</dt>
                    <dd>{(tpl.format || "md").toUpperCase()}</dd>
                    <dt className="text-muted">{t("sections")}</dt>
                    <dd><ol className="list-decimal pl-5 flex flex-col">{(tpl.sections ?? []).map((s, i) => <li key={`${i}-${s}`} className="break-words">{s}</li>)}</ol></dd>
                    <dt className="text-muted">{t("rules")}</dt>
                    <dd className="flex flex-wrap gap-1.5">
                      {(tpl.rules ?? []).length ? (tpl.rules ?? []).map((r) => <Badge key={r} tone="muted">{ruleText(r)}</Badge>)
                        : <span className="text-muted">{t("no_rules")}</span>}
                    </dd>
                  </dl>
                </div>

                {stage.kind === "view" && (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex flex-col gap-1.5 min-w-0 flex-1 basis-48">
                      <label htmlFor={pickId} className="label">{t("workflow")}</label>
                      <select id={pickId} className="select" value={wfSlug} disabled={busy} onChange={(e) => setWfSlug(e.target.value)}>
                        <option value="">{t("pick_workflow")}</option>
                        {workflows.map((w) => <option key={w.slug} value={w.slug}>{w.name || w.slug}</option>)}
                      </select>
                    </div>
                    <Button variant="primary" disabled={!wfSlug || busy} onClick={startApply}>{t("apply")}</Button>
                    <Button variant="ghost" icon={<Trash2 size={15} />} disabled={busy}
                      onClick={() => { setNote(null); setErr(null); setStage({ kind: "delete" }); }}>{t("delete")}</Button>
                  </div>
                )}

                {stage.kind === "diff" && (
                  <div ref={stageRef} tabIndex={-1} role="group" aria-labelledby={`${pickId}-d`}
                    className="panel p-3 flex flex-col gap-2 min-w-0 focus:outline-none">
                    <h4 id={`${pickId}-d`} className="font-semibold break-words">{t("diff_title", { wf: stage.wf.name || stage.wf.slug })}</h4>
                    <p className="text-ink-2">{t("diff_note")}</p>
                    <ul className="flex flex-col gap-2">
                      {stage.rows.map((row) => (
                        <li key={row.field} className="flex flex-col gap-1 border-t-2 border-line-soft pt-2 min-w-0">
                          <span className="font-semibold flex items-center gap-2 flex-wrap">
                            {t(`field_${row.field}` as "field_rules")}
                            {!row.changed && <Badge tone="muted">{t("unchanged")}</Badge>}
                          </span>
                          {row.changed ? (
                            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                              <dt className="text-muted">{t("before")}</dt>
                              <dd className="break-words"><del className="text-ink-2">{cellText(row, row.before)}</del></dd>
                              <dt className="text-muted">{t("after")}</dt>
                              <dd className="break-words"><ins className="no-underline font-semibold">{cellText(row, row.after)}</ins></dd>
                            </dl>
                          ) : <span className="text-ink-2 break-words">{cellText(row, row.after)}</span>}
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap justify-end gap-2 pt-1">
                      <Button variant="ghost" disabled={busy} onClick={() => setStage({ kind: "view" })}>{t("cancel")}</Button>
                      <Button variant="primary" disabled={busy} onClick={() => void doApply()}
                        icon={busy ? <Spinner size={14} /> : undefined}>{busy ? t("working") : t("confirm_apply")}</Button>
                    </div>
                  </div>
                )}

                {stage.kind === "delete" && (
                  <div ref={stageRef} tabIndex={-1} role="alertdialog" aria-labelledby={`${pickId}-x`}
                    className="panel p-3 flex flex-col gap-2 min-w-0 focus:outline-none">
                    <p id={`${pickId}-x`} className="font-semibold break-words">{t("delete_q", { tpl: tplName })}</p>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button variant="ghost" disabled={busy} onClick={() => setStage({ kind: "view" })}>{t("cancel")}</Button>
                      <Button variant="danger" disabled={busy} onClick={() => void doDelete()}
                        icon={busy ? <Spinner size={14} /> : <Trash2 size={15} />}>{busy ? t("working") : t("confirm_delete")}</Button>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
