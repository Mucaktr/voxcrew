// CG-DELIVER — "Teslim et": hedef seçici (yalnızca kullanılabilir hedefler + hazır olma durumu) → ayrıntılar →
// birebir önizleme (içerik, hedef, komutlar / MCP çağrısı, kalite kapısı) → açık onay. Hiçbir şey onaysız gitmez;
// e-posta yalnızca taslaktır. Başarıda bağlantı, hatada ileti gösterilir.
import clsx from "clsx";
import {
  AlertTriangle, CheckCircle2, ClipboardCopy, Download, ExternalLink, FileText, FolderOutput, GitPullRequest,
  Github, Mail, MessageSquare, NotebookPen, RefreshCcw, Send, ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Field, Modal, Segmented, Spinner, Toggle } from "../ui";
import { copyText, downloadDeliverable, type ExportFormat } from "../../lib/deliverables";
import {
  DeliveryError, deliveryApi, type DeliverResult, type DeliveryPreview, type DeliveryTarget, type TargetId,
  type TargetsResponse,
} from "../../lib/delivery";
import { useLocale, useT } from "../../lib/i18n";
import { deliveryMsg as m } from "../../locales/delivery";

const ICON: Record<TargetId, ReactNode> = {
  folder: <FolderOutput size={16} aria-hidden />, email_draft: <Mail size={16} aria-hidden />,
  github_pr: <GitPullRequest size={16} aria-hidden />, github_issue: <Github size={16} aria-hidden />,
  notion: <NotebookPen size={16} aria-hidden />, gdocs: <FileText size={16} aria-hidden />,
  slack: <MessageSquare size={16} aria-hidden />, clipboard: <ClipboardCopy size={16} aria-hidden />,
  download: <Download size={16} aria-hidden />,
};

type Opts = Record<string, string | boolean>;

export interface DeliverItem { id: string; title: string; kind?: string; source?: string; name?: string; binary?: boolean }

export function DeliverDialog({ open, onClose, item, defaultTarget }:
  { open: boolean; onClose: () => void; item: DeliverItem; defaultTarget?: { target: TargetId; options?: Record<string, unknown> } }) {
  const t = useT(m);
  const locale = useLocale((s) => s.locale);
  const [data, setData] = useState<TargetsResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [target, setTarget] = useState<TargetId | null>(null);
  const [opts, setOpts] = useState<Opts>({});
  const [preview, setPreview] = useState<DeliveryPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anyway, setAnyway] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<DeliverResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const textual = !item.kind || ["report", "text", "code", "data"].includes(item.kind);

  const load = useCallback((check: boolean) => {
    setChecking(check);
    deliveryApi.targets(item.id, check)
      .then((r) => {
        setData(r);
        setTarget((cur) => cur ?? (defaultTarget?.target || r.suggested[0]?.target || null));
        const sug = defaultTarget ?? r.suggested[0];
        if (sug?.options) setOpts((o) => ({ ...Object.fromEntries(Object.entries(sug.options ?? {}).map(([k, v]) => [k, typeof v === "boolean" ? v : String(v ?? "")])), ...o }));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setChecking(false));
  }, [item.id, defaultTarget]);

  useEffect(() => {
    if (!open) return;
    setData(null); setPreview(null); setDone(null); setError(null); setNote(null); setAnyway(false); setReason("");
    load(false);
  }, [open, load]);

  const targets = data?.targets ?? [];
  const usable = targets.filter((x) => x.available && (textual || ["folder", "download"].includes(x.id)));
  const unavailable = targets.filter((x) => !x.available);
  const current = targets.find((x) => x.id === target) ?? null;
  const set = (k: string, v: string | boolean) => { setOpts((o) => ({ ...o, [k]: v })); setPreview(null); };

  // hedef değişince son kullanılan klasör/depo önerilir (yalnızca boşsa)
  useEffect(() => {
    if (!data || !target) return;
    setOpts((o) => {
      const next = { ...o };
      if ((target === "folder" || target === "email_draft") && !next.folder && data.settings.last_folder) next.folder = data.settings.last_folder;
      if (target.startsWith("github_") && !next.repo && data.settings.last_repo) next.repo = data.settings.last_repo;
      if (target === "email_draft" && !next.mode) next.mode = "eml";
      return next;
    });
  }, [target, data]);

  const runPreview = async () => {
    if (!target) return;
    setBusy(true); setError(null); setNote(null); setAnyway(false); setReason("");
    try { setPreview(await deliveryApi.preview(item.id, target, opts)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const approve = async () => {
    if (!preview) return;
    setBusy(true); setError(null);
    try {
      const r = await deliveryApi.deliver(preview, anyway ? reason.trim() : undefined);
      if (r.client_action === "copy" && r.content != null) setNote((await copyText(r.content)) ? t("copied") : null);
      if (r.client_action === "download") downloadDeliverable(item.id, (r.format ?? "md") as ExportFormat, { binary: item.binary });
      if (r.client_action === "open" && r.link?.startsWith("mailto:")) { window.location.href = r.link; setNote(t("mailto_opened")); }
      setDone(r);
    } catch (e) {
      if (e instanceof DeliveryError && e.code === "stale_preview") {
        setError(t("stale"));
        try { setPreview(await deliveryApi.preview(item.id, preview.target, opts)); } catch { setPreview(null); }
      } else {
        setError(t("failed", { error: e instanceof Error ? e.message : String(e) }));
      }
    } finally { setBusy(false); }
  };

  const togglePii = async (v: boolean) => {
    try {
      const s = await deliveryApi.settings({ redact_pii: v });
      setData((d) => (d ? { ...d, settings: s } : d));
      setPreview(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const blocked = preview?.quality?.action === "block";
  const canApprove = !!preview && !busy && (!blocked || (anyway && reason.trim().length >= 3))
    && !(preview.payload.exists && preview.payload.warnings?.length && !preview.options.overwrite && !["github_pr"].includes(preview.target))
    && !(preview.target === "github_pr" && preview.payload.exists && !preview.options.overwrite);

  const footer = done ? <Button onClick={onClose}>{t("close")}</Button> : preview ? (
    <>
      <Button onClick={() => setPreview(null)} disabled={busy}>{t("back")}</Button>
      <Button variant="primary" icon={busy ? <Spinner /> : <Send size={15} />} disabled={!canApprove} onClick={() => { void approve(); }}>
        {busy ? t("delivering") : t("approve")}
      </Button>
    </>
  ) : (
    <>
      <Button onClick={onClose}>{t("close")}</Button>
      <Button variant="primary" icon={busy ? <Spinner /> : undefined} disabled={!target || busy || current?.ready === false}
        onClick={() => { void runPreview(); }}>{busy ? t("previewing") : t("preview")}</Button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={t("dialog_title", { title: item.title })} width={720} footer={footer}>
      <div className="flex flex-col gap-4 min-w-0">
        {error && <p role="alert" className="chip tone-bad !whitespace-normal break-words"><AlertTriangle size={14} aria-hidden />{error}</p>}
        {done ? <DoneView r={done} note={note} t={t} /> : preview ? (
          <PreviewView p={preview} t={t} locale={locale} anyway={anyway} setAnyway={setAnyway} reason={reason} setReason={setReason} />
        ) : !data ? (
          <p className="text-sm text-muted flex items-center gap-2"><Spinner />{t("loading")}</p>
        ) : (
          <>
            <section className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h3 className="font-display font-semibold text-sm flex-1">{t("step_target")}</h3>
                <Button size="sm" variant="ghost" icon={checking ? <Spinner /> : <RefreshCcw size={14} />} disabled={checking}
                  onClick={() => load(true)}>{t("check_again")}</Button>
              </div>
              <div role="radiogroup" aria-label={t("targets_label")} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {usable.map((x) => (
                  <TargetOption key={x.id} x={x} selected={target === x.id} locale={locale} t={t}
                    suggested={data.suggested.some((s) => s.target === x.id)}
                    onSelect={() => { setTarget(x.id); setPreview(null); setError(null); }} />
                ))}
              </div>
              {unavailable.length > 0 && (
                <ul className="flex flex-col gap-1 text-xs text-muted" aria-label={t("not_ready")}>
                  {unavailable.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center gap-1.5">
                      {ICON[x.id]}<span className="font-semibold">{x.label[locale]}</span>
                      <span>· {x.reason}</span>
                      {x.connect_hint && <Link to={x.connect_hint} className="underline font-semibold" onClick={onClose}>{t("connect_mcp")}</Link>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {current && (
              <section className="flex flex-col gap-3">
                <h3 className="font-display font-semibold text-sm">{t("step_options")}</h3>
                <OptionsForm x={current} opts={opts} set={set} t={t} textual={textual} />
                {textual && current.id !== "download" && (
                  <Toggle checked={!!data.settings.redact_pii} onChange={(v) => { void togglePii(v); }}
                    label={t("pii_toggle")} hint={t("pii_toggle_hint")} />
                )}
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

type T = ReturnType<typeof useT<typeof m.tr>>;

function TargetOption({ x, selected, onSelect, locale, t, suggested }:
  { x: DeliveryTarget; selected: boolean; onSelect: () => void; locale: "tr" | "en"; t: T; suggested: boolean }) {
  const state = x.ready === true ? <Badge tone="ok">{t("ready")}</Badge> : x.ready === false ? <Badge tone="warn">{t("not_ready")}</Badge>
    : <Badge>{t("unchecked")}</Badge>;
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect}
      className={clsx("panel-soft text-left p-2.5 rounded-lg border-2 flex flex-col gap-1 min-w-0 min-h-11 focus-visible:outline-2",
        selected ? "!border-ink" : "border-transparent hover:border-line")}>
      <span className="flex items-center gap-2 min-w-0">
        {ICON[x.id]}<span className="font-semibold text-sm flex-1 min-w-0 truncate">{x.label[locale]}</span>{state}
      </span>
      <span className="flex flex-wrap gap-1 text-xs">
        <Badge tone={x.external ? "info" : "muted"}>{x.external ? t("external") : t("local")}</Badge>
        {suggested && <Badge tone="ok">{t("suggested")}</Badge>}
      </span>
      {x.reason && x.ready !== true && <span className="text-xs text-muted break-words">{x.reason}</span>}
    </button>
  );
}

function TextField({ label, hint, value, onChange, mono, placeholder, type = "text" }:
  { label: string; hint?: string; value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string; type?: string }) {
  return (
    <Field label={label} hint={hint}>
      <input className={clsx("input", mono && "font-mono")} type={type} value={value} placeholder={placeholder}
        autoComplete="off" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function SelectField({ label, value, onChange, options }:
  { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Field label={label}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

function OptionsForm({ x, opts, set, t, textual }:
  { x: DeliveryTarget; opts: Opts; set: (k: string, v: string | boolean) => void; t: T; textual: boolean }) {
  const s = (k: string) => (typeof opts[k] === "string" ? (opts[k] as string) : "");
  const fmtOptions = textual ? [{ value: "md", label: ".md" }, { value: "txt", label: ".txt" }, { value: "docx", label: "Word (.docx)" }]
    : [{ value: "original", label: t("fmt_original") }];
  const overwrite = (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" aria-label={t("overwrite")} checked={opts.overwrite === true} onChange={(e) => set("overwrite", e.target.checked)} />{t("overwrite")}
    </label>
  );
  const servers = x.mcp_servers ?? [];
  const serverPick = servers.length > 0 && (
    <SelectField label={t("server")} value={s("server") || servers[0].id} onChange={(v) => set("server", v)}
      options={servers.map((sv) => ({ value: sv.id, label: `${sv.name}${sv.ready ? "" : ` (${t("not_ready")})`}` }))} />
  );
  switch (x.id) {
    case "folder":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><TextField label={t("folder")} hint={t("folder_hint")} value={s("folder")} mono onChange={(v) => set("folder", v)} /></div>
          <SelectField label={t("format")} value={s("format") || fmtOptions[0].value} onChange={(v) => set("format", v)} options={fmtOptions} />
          <TextField label={t("filename")} hint={t("filename_hint")} value={s("filename")} mono onChange={(v) => set("filename", v)} />
          <div className="sm:col-span-2">{overwrite}</div>
        </div>
      );
    case "email_draft": {
      const mode = s("mode") || "eml";
      const mcpReady = servers.some((sv) => sv.ready);
      return (
        <div className="flex flex-col gap-3">
          <Field label={t("mode")}>
            <Segmented value={mode} onChange={(v) => set("mode", v)} className="flex-wrap"
              options={[{ value: "eml", label: t("mode_eml") }, { value: "mailto", label: t("mode_mailto") },
                { value: "mcp", label: t("mode_mcp"), disabled: !mcpReady, title: mcpReady ? undefined : t("connect_mcp_hint") }]} />
          </Field>
          <p className="chip tone-info !whitespace-normal"><ShieldCheck size={14} aria-hidden />{t("never_sends")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField label={t("to")} hint={t("addresses_hint")} value={s("to")} type="email" onChange={(v) => set("to", v)} />
            <TextField label={t("cc")} value={s("cc")} type="email" onChange={(v) => set("cc", v)} />
            <div className="sm:col-span-2"><TextField label={t("subject")} value={s("subject")} onChange={(v) => set("subject", v)} /></div>
            {mode === "eml" && <>
              <div className="sm:col-span-2"><TextField label={t("folder")} hint={t("folder_hint")} value={s("folder")} mono onChange={(v) => set("folder", v)} /></div>
              <SelectField label={t("attach")} value={s("attach") || "none"} onChange={(v) => set("attach", v)}
                options={[{ value: "none", label: t("attach_none") }, { value: "md", label: ".md" }, { value: "docx", label: "Word (.docx)" }]} />
              <div className="self-end">{overwrite}</div>
            </>}
            {mode === "mcp" && <div className="sm:col-span-2">{serverPick}</div>}
          </div>
        </div>
      );
    }
    case "github_pr":
    case "github_issue":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><TextField label={t("repo")} hint={t("repo_hint")} value={s("repo")} mono onChange={(v) => set("repo", v)} /></div>
          <div className="sm:col-span-2"><TextField label={t("title")} value={s("title")} onChange={(v) => set("title", v)} /></div>
          {x.id === "github_pr" && <>
            <TextField label={t("branch")} value={s("branch")} mono onChange={(v) => set("branch", v)} />
            <TextField label={t("path_in_repo")} value={s("path")} mono placeholder="docs/…" onChange={(v) => set("path", v)} />
            <TextField label={t("base")} value={s("base")} mono onChange={(v) => set("base", v)} />
            <div className="self-end">{overwrite}</div>
          </>}
        </div>
      );
    case "notion":
    case "gdocs":
    case "slack":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {serverPick}
          <TextField label={t("title")} value={s("title")} onChange={(v) => set("title", v)} />
          {x.id === "slack" ? <TextField label={t("channel")} value={s("channel")} mono onChange={(v) => set("channel", v)} />
            : <TextField label={t("parent")} value={s("parent")} mono onChange={(v) => set("parent", v)} />}
        </div>
      );
    case "download":
      return <SelectField label={t("format")} value={s("format") || fmtOptions[0].value} onChange={(v) => set("format", v)}
        options={textual ? fmtOptions : [{ value: "original", label: t("fmt_original") }]} />;
    default:
      return null;
  }
}

function PreviewView({ p, t, locale, anyway, setAnyway, reason, setReason }:
  { p: DeliveryPreview; t: T; locale: "tr" | "en"; anyway: boolean; setAnyway: (v: boolean) => void; reason: string; setReason: (v: string) => void }) {
  const pl = p.payload;
  const reasonId = useId();
  const content = useMemo(() => pl.content ?? "", [pl.content]);
  return (
    <section className="flex flex-col gap-3 min-w-0" aria-label={t("step_preview")}>
      <h3 className="font-display font-semibold text-sm">{t("preview_title")}</h3>
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm min-w-0">
        <dt className="text-muted">{t("target_line")}</dt>
        <dd className="min-w-0 break-words font-semibold">{p.label[locale]}{p.external && <Badge tone="info" className="ml-2">{t("external")}</Badge>}</dd>
        <dt className="sr-only">—</dt>
        <dd className="col-span-2 min-w-0 break-words">{pl.summary}</dd>
        {pl.to && pl.to.length > 0 && <><dt className="text-muted">{t("to")}</dt><dd className="break-all">{pl.to.join(", ")}</dd></>}
        {pl.cc && pl.cc.length > 0 && <><dt className="text-muted">{t("cc")}</dt><dd className="break-all">{pl.cc.join(", ")}</dd></>}
        {pl.subject && <><dt className="text-muted">{t("subject")}</dt><dd className="break-words">{pl.subject}</dd></>}
        {pl.path && <><dt className="text-muted">{t("folder")}</dt><dd className="font-mono text-xs break-all">{pl.path}</dd></>}
      </dl>
      {(pl.warnings ?? []).map((w) => <p key={w} role="status" className="chip tone-warn !whitespace-normal"><AlertTriangle size={14} aria-hidden />{w}</p>)}
      {pl.sends === false && <p className="chip tone-info !whitespace-normal"><ShieldCheck size={14} aria-hidden />{t("never_sends")}</p>}
      {p.quality && <QualityBox q={p.quality} t={t} />}
      {p.quality?.action === "block" && (
        <div className="panel-soft p-3 flex flex-col gap-2 border-2 !border-bad">
          <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
            <input type="checkbox" aria-label={t("deliver_anyway")} checked={anyway} onChange={(e) => setAnyway(e.target.checked)} />{t("deliver_anyway")}
          </label>
          {anyway && (
            <div className="flex flex-col gap-1">
              <label htmlFor={reasonId} className="label">{t("deliver_anyway_reason")}</label>
              <textarea id={reasonId} className="input min-h-16" value={reason} maxLength={500} aria-describedby={`${reasonId}-h`}
                onChange={(e) => setReason(e.target.value)} />
              <span id={`${reasonId}-h`} className="text-xs text-muted">{t("deliver_anyway_hint")}</span>
            </div>
          )}
        </div>
      )}
      {pl.commands && pl.commands.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="label">{t("commands")}</h4>
          <ol className="panel-soft p-2 rounded-lg font-mono text-xs flex flex-col gap-1 list-decimal pl-6 break-all">
            {pl.commands.map((c, i) => <li key={i}>{c.display}{c.stdin ? `  < ${c.stdin}` : ""}{c.note ? `  (${c.note})` : ""}</li>)}
          </ol>
          <span className="text-xs text-muted">{t("commands_hint")}</span>
        </div>
      )}
      {pl.tool && (
        <div className="flex flex-col gap-1">
          <h4 className="label">{t("mcp_call")}</h4>
          <pre className="panel-soft p-2 rounded-lg font-mono text-xs whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
            {`${pl.server_name ?? pl.server} › ${pl.tool}\n${JSON.stringify({ ...pl.arguments, ...(typeof pl.arguments?.body === "string" ? { body: "…" } : {}), ...(typeof pl.arguments?.text === "string" ? { text: "…" } : {}), ...(typeof pl.arguments?.content === "string" ? { content: "…" } : {}) }, null, 2)}`}
          </pre>
        </div>
      )}
      {pl.diff && pl.diff.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="label">{t("diff")}</h4>
          <pre className="panel-soft p-2 rounded-lg font-mono text-xs whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{pl.diff.join("\n")}</pre>
        </div>
      )}
      {content && (
        <div className="flex flex-col gap-1">
          <h4 className="label">{t("content")}</h4>
          <pre tabIndex={0} className="panel-soft p-2 rounded-lg font-mono text-xs whitespace-pre-wrap break-words max-h-64 overflow-y-auto">{content}</pre>
        </div>
      )}
      <p className="text-xs text-muted">{p.pii_redacted ? t("pii_on") : t("secrets_masked")}</p>
    </section>
  );
}

function QualityBox({ q, t }: { q: NonNullable<DeliveryPreview["quality"]>; t: T }) {
  const tone = q.action === "pass" ? "ok" : q.action === "warn" ? "warn" : "bad";
  const label = q.action === "pass" ? t("quality_pass") : q.action === "warn" ? t("quality_warn") : t("quality_block");
  return (
    <div className="flex flex-col gap-1" aria-label={t("quality")}>
      <p className={`chip tone-${tone} !whitespace-normal`}>
        {q.action === "pass" ? <CheckCircle2 size={14} aria-hidden /> : <AlertTriangle size={14} aria-hidden />}
        {label}{q.score != null ? ` · ${t("quality_score", { score: q.score })}` : ""}
      </p>
      {q.error
        ? <p className="text-xs" role="status">{q.action === "block" ? t("quality_gate_error_block") : t("quality_gate_error")}</p>
        : q.reasons.length > 0 && <ul className="text-xs list-disc pl-5">{q.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
    </div>
  );
}

function DoneView({ r, note, t }: { r: DeliverResult; note: string | null; t: T }) {
  const link = r.record.link && !r.record.link.startsWith("mailto:") ? r.record.link : null;
  return (
    <div role="status" className="flex flex-col gap-2 items-start">
      <p className="chip tone-ok !whitespace-normal"><CheckCircle2 size={14} aria-hidden />{t("success")}: {r.record.label ?? r.record.target}</p>
      {r.record.result && <p className="text-sm break-words">{r.record.result}</p>}
      {note && <p className="text-sm">{note}</p>}
      {link && <a href={link} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-primary"><ExternalLink size={14} aria-hidden />{t("open_link")}</a>}
    </div>
  );
}
