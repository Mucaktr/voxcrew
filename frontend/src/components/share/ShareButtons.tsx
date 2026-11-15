// Dalga 3 — hafif ekip paylaşımı: "Dışa aktar / İçe aktar" düğmeleri ve pencereleri (Tarifler, İş akışları, Ajanlar).
// Dışa aktarma: seç → önizle (tam olarak ne gidiyor) → indir. İçe aktarma: dosya seç → önizleme (çakışma + fark, tam
// istemler, enjeksiyon işaretleri, salt okuma) → açık onay → sonuç (ajana sonradan yazma izni verilebilir).
import { AlertTriangle, Download, FileDown, FileUp, ShieldCheck } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useT } from "../../lib/i18n";
import {
  MAX_BUNDLE_BYTES, ShareApiError, downloadBundle, shareApi,
  type ExportResult, type Exportable, type ImportPlan, type ImportPreview, type ImportResult, type ShareKind,
} from "../../lib/share";
import { shareMsg } from "../../locales/share";
import { Badge, Button, Modal, Segmented, Spinner } from "../ui";

type Sel = Record<string, boolean>;
const keyOf = (kind: ShareKind, id: string) => `${kind}:${id}`;

function errText(e: unknown): { message: string; errors: string[] } {
  if (e instanceof ShareApiError) return { message: e.message, errors: e.errors };
  return { message: e instanceof Error ? e.message : String(e), errors: [] };
}

function ErrorBox({ err }: { err: { message: string; errors: string[] } | null }) {
  if (!err) return null;
  return (
    <div role="alert" className="text-sm text-bad font-semibold flex flex-col gap-1 break-words">
      <span>{err.message}</span>
      {err.errors.length > 0 && (
        <ul className="list-disc pl-5 font-normal">{err.errors.slice(0, 12).map((x) => <li key={x}>{x}</li>)}</ul>
      )}
    </div>
  );
}

function PromptBlock({ field, text }: { field: string; text: string }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-xs text-ink-2 font-semibold">{field}</span>
      <pre className="text-xs whitespace-pre-wrap break-words bg-panel-2 rounded-md p-2 max-h-56 overflow-y-auto">{text}</pre>
    </div>
  );
}

// ---------------------------------------------------------------- dışa aktarma
function ExportDialog({ open, onClose, kinds }: { open: boolean; onClose: () => void; kinds: ShareKind[] }) {
  const t = useT(shareMsg);
  const [list, setList] = useState<Exportable | null>(null);
  const [sel, setSel] = useState<Sel>({});
  const [result, setResult] = useState<ExportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ message: string; errors: string[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null); setErr(null); setSel({});
    shareApi.exportable().then(setList).catch((e: unknown) => setErr(errText(e)));
  }, [open]);

  const groups: { kind: ShareKind; label: string; items: { id: string; name: string; tag?: string }[] }[] = list ? [
    { kind: "job" as ShareKind, label: t("kind_job"), items: list.jobs.map((j) => ({ id: j.id, name: j.name, tag: j.example ? t("example") : undefined })) },
    { kind: "agent" as ShareKind, label: t("kind_agent"), items: list.agents.map((a) => ({ id: a.id, name: a.name })) },
    { kind: "output" as ShareKind, label: t("kind_output"), items: list.outputs.map((o) => ({
      id: o.id, name: o.name, tag: o.source === "workflow" ? t("source_workflow") : o.source === "recipe" ? t("source_recipe") : t("source_template") })) },
  ].filter((g) => kinds.includes(g.kind)) : [];
  const chosen = Object.entries(sel).filter(([, v]) => v).map(([k]) => {
    const i = k.indexOf(":");
    return { kind: k.slice(0, i) as ShareKind, id: k.slice(i + 1) };
  });

  const preview = async () => {
    setBusy(true); setErr(null);
    try { setResult(await shareApi.export(chosen)); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  const footer = result ? (
    <>
      <Button onClick={() => setResult(null)}>{t("back")}</Button>
      <Button variant="primary" icon={<Download size={16} />} onClick={() => downloadBundle(result.bundle, result.filename)}>{t("download")}</Button>
    </>
  ) : (
    <>
      <Button onClick={onClose}>{t("cancel")}</Button>
      <Button variant="primary" disabled={!chosen.length || busy} onClick={preview}>{busy ? <Spinner /> : null}{t("preview_btn")}</Button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={t("export_title")} width={720} footer={footer}>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-ink-2 flex gap-2"><ShieldCheck size={16} className="shrink-0 mt-0.5" aria-hidden />{t("intro_export")}</p>
        <ErrorBox err={err} />
        {!list && !err && <Spinner />}
        {!result && groups.map((g) => (
          <fieldset key={g.kind} className="flex flex-col gap-1.5 min-w-0">
            <legend className="font-semibold mb-1">{g.label}</legend>
            {g.items.length === 0 && <p className="text-muted">{t("none")}</p>}
            {g.items.map((it) => {
              const k = keyOf(g.kind, it.id);
              return (
                <label key={k} className="flex items-center gap-2 min-w-0 cursor-pointer">
                  <input type="checkbox" aria-label={it.name} checked={!!sel[k]} onChange={(e) => setSel((s) => ({ ...s, [k]: e.target.checked }))} />
                  <span className="truncate">{it.name}</span>
                  {it.tag && <Badge>{it.tag}</Badge>}
                </label>
              );
            })}
          </fieldset>
        ))}
        {!result && chosen.length > 0 && <p className="text-ink-2">{t("selected", { n: chosen.length })}</p>}
        {result && (
          <div className="flex flex-col gap-3">
            <h3 className="font-semibold">{t("preview_head", { kb: Math.max(1, Math.round(result.bytes / 1024)) })}</h3>
            {result.preview.map((p) => (
              <section key={keyOf(p.kind, p.id)} className="panel p-3 flex flex-col gap-2 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone="info">{p.kind === "job" ? t("kind_job") : p.kind === "agent" ? t("kind_agent") : t("kind_output")}</Badge>
                  <strong className="break-words">{p.name}</strong>
                </div>
                <p className="text-xs text-ink-2">{t("fields", { list: p.fields.join(", ") })}</p>
                {p.agents.length > 0 && <p className="text-xs text-ink-2">{t("agents_ref", { list: p.agents.join(", ") })}</p>}
                {p.dropped.length > 0 && <p className="text-xs text-warn font-semibold">{t("dropped", { list: p.dropped.join(", ") })}</p>}
                {p.redacted.length > 0 && <p className="text-xs text-ink-2">{t("redacted", { n: p.redacted.length })}</p>}
                {p.prompts.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold">{t("prompts")} ({p.prompts.length})</summary>
                    <div className="flex flex-col gap-2 mt-2">{p.prompts.map((x, i) => <PromptBlock key={i} field={x.field} text={x.text} />)}</div>
                  </details>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- içe aktarma
function PlanCard({ plan, choice, onChoice }: { plan: ImportPlan; choice: string; onChoice: (v: string) => void }) {
  const t = useT(shareMsg);
  const label = (c: string) => (c === "add" ? t("choice_add") : c === "replace" ? t("choice_replace") : t("choice_skip"));
  const brain = plan.brain;
  return (
    <section className="panel p-3 flex flex-col gap-2 min-w-0" aria-label={plan.name}>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge tone="info">{plan.kind === "job" ? t("kind_job") : plan.kind === "agent" ? t("kind_agent") : t("kind_output")}</Badge>
        <strong className="break-words min-w-0">{plan.name}</strong>
        {plan.steps != null && <Badge>{t("steps", { n: plan.steps })}</Badge>}
      </div>
      {plan.blocked && <p className="text-sm text-bad font-semibold break-words">{t("blocked", { reason: plan.blocked })}</p>}
      {!plan.blocked && plan.choices.length > 1 && (
        <Segmented value={choice} onChange={onChoice} options={plan.choices.map((c) => ({ value: c, label: label(c) }))} />
      )}
      {plan.collision && choice === "add" && <p className="text-xs text-ink-2">{t("collision", { name: plan.target_name })}</p>}
      {choice === "replace" && <p className="text-xs text-warn font-semibold" role="status">{t("replace_warn")}</p>}
      {plan.permissions && (
        <p className="text-xs flex items-center gap-1.5"><ShieldCheck size={14} aria-hidden />
          {t("read_only", { declared: plan.permissions.declared })}</p>
      )}
      {brain && (
        <p className="text-xs text-ink-2">{brain.note
          ? t("brain_fallback", { req: brain.requested.connection ?? "—", conn: brain.applied.connection })
          : t("brain", { conn: [brain.applied.connection, brain.applied.model].filter(Boolean).join(" · ") })}</p>
      )}
      {plan.baseline && <p className="text-xs text-ink-2">{t("baseline", { m: plan.baseline.manual_minutes, r: plan.baseline.review_minutes })}</p>}
      {plan.warnings.map((w) => <p key={w} className="text-xs text-warn font-semibold break-words">{w}</p>)}
      {plan.flags.length > 0 && (
        <p className="text-xs text-bad font-semibold flex gap-1.5 break-words" role="status">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden />
          {t("flagged", { list: plan.flags.map((f) => `${f.field} (${f.patterns.join(", ")})`).join("; ") })}
        </p>
      )}
      {plan.prompts.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold">{t("prompts")}</span>
          {plan.prompts.map((x, i) => <PromptBlock key={i} field={x.field} text={x.text} />)}
        </div>
      )}
      {plan.diff.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold">{t("diff", { n: plan.diff.length })}</summary>
          <ul className="flex flex-col gap-1.5 mt-2 text-xs">
            {plan.diff.map((d) => (
              <li key={d.field} className="flex flex-col min-w-0">
                <code className="font-semibold break-all">{d.field}</code>
                <span className="break-words"><span className="text-ink-2">{t("before")}:</span> {d.before || "—"}</span>
                <span className="break-words"><span className="text-ink-2">{t("after")}:</span> {d.after || "—"}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function ImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported?: () => void }) {
  const t = useT(shareMsg);
  const inputId = useId();
  const [bundle, setBundle] = useState<unknown>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [writable, setWritable] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ message: string; errors: string[] } | null>(null);

  useEffect(() => {
    if (open) { setBundle(null); setPreview(null); setChoices({}); setResult(null); setErr(null); setWritable({}); }
  }, [open]);

  const pick = async (file: File | undefined) => {
    setErr(null); setPreview(null); setResult(null);
    if (!file) return;
    if (file.size > MAX_BUNDLE_BYTES) { setErr({ message: t("too_big", { kb: Math.round(file.size / 1024) }), errors: [] }); return; }
    let data: unknown;
    try { data = JSON.parse(await file.text()); } catch { setErr({ message: t("bad_json"), errors: [] }); return; }
    setBusy(true);
    try {
      const p = await shareApi.preview(data);
      setBundle(data); setPreview(p);
      setChoices(Object.fromEntries(p.items.map((i) => [i.key, i.choices[0]])));
    } catch (e) {
      const x = errText(e);
      setErr({ message: x.errors.length ? t("rejected") : x.message, errors: x.errors });
    } finally { setBusy(false); }
  };

  const apply = async () => {
    setBusy(true); setErr(null);
    try { setResult(await shareApi.apply(bundle, choices)); onImported?.(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  const allow = async (slug: string) => {
    try { await shareApi.makeWritable(slug); setWritable((w) => ({ ...w, [slug]: true })); onImported?.(); }
    catch (e) { setErr(errText(e)); }
  };

  const canImport = !!preview && preview.items.some((i) => (choices[i.key] ?? "skip") !== "skip");
  const footer = result ? <Button variant="primary" onClick={onClose}>{t("close")}</Button> : (
    <>
      <Button onClick={onClose}>{t("cancel")}</Button>
      {preview && <Button variant="primary" disabled={!canImport || busy} onClick={apply}>{busy ? t("importing") : t("confirm_import")}</Button>}
    </>
  );
  const status = (s: string) => (s === "added" ? t("status_added") : s === "replaced" ? t("status_replaced") : s === "skipped" ? t("status_skipped") : t("status_error"));

  return (
    <Modal open={open} onClose={onClose} title={result ? t("done_title") : t("import_title")} width={760} footer={footer}>
      <div className="flex flex-col gap-4 text-sm">
        {!result && <p className="text-ink-2 flex gap-2"><ShieldCheck size={16} className="shrink-0 mt-0.5" aria-hidden />{t("intro_import")}</p>}
        {!result && (
          <div className="flex flex-col gap-1">
            <label htmlFor={inputId} className="font-semibold">{t("pick_file")}</label>
            <input id={inputId} type="file" accept="application/json,.json" className="text-sm max-w-full"
              onChange={(e) => void pick(e.target.files?.[0])} />
          </div>
        )}
        {busy && !preview && <Spinner />}
        <ErrorBox err={err} />
        {preview && !result && preview.items.map((p) => (
          <PlanCard key={p.key} plan={p} choice={choices[p.key] ?? p.choices[0]} onChoice={(v) => setChoices((c) => ({ ...c, [p.key]: v }))} />
        ))}
        {result && (
          <ul className="flex flex-col gap-2">
            {result.results.map((r) => (
              <li key={r.key} className="flex items-center gap-2 flex-wrap min-w-0">
                <Badge tone={r.status === "error" ? "bad" : r.status === "skipped" ? "muted" : "ok"}>{status(r.status)}</Badge>
                <span className="break-words min-w-0">{r.name}{r.id && r.id !== r.key.split(":")[1] ? ` → ${r.id}` : ""}</span>
                {r.error && <span className="text-bad text-xs break-words">{r.error}</span>}
                {r.reason && r.reason !== "user" && <span className="text-xs text-ink-2 break-words">{r.reason}</span>}
                {r.kind === "agent" && r.id && r.read_only && (
                  writable[r.id]
                    ? <Badge tone="ok">{t("writable_done")}</Badge>
                    : <Button size="sm" onClick={() => void allow(r.id!)}>{t("make_writable")}</Button>
                )}
              </li>
            ))}
            <li className="text-xs text-ink-2">{t("imported_note")}</li>
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** Sayfa başlığına konan iki düğme. `kinds`: dışa aktarma penceresinde gösterilecek türler. */
export function ShareButtons({ kinds, onImported }: { kinds: ShareKind[]; onImported?: () => void }) {
  const t = useT(shareMsg);
  const [mode, setMode] = useState<"export" | "import" | null>(null);
  return (
    <>
      <Button icon={<FileDown size={16} />} onClick={() => setMode("export")}>{t("export")}</Button>
      <Button icon={<FileUp size={16} />} onClick={() => setMode("import")}>{t("import")}</Button>
      <ExportDialog open={mode === "export"} onClose={() => setMode(null)} kinds={kinds} />
      <ImportDialog open={mode === "import"} onClose={() => setMode(null)} onImported={onImported} />
    </>
  );
}
