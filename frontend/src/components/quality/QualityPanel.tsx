// CG-QUALITY — kalite raporu: rozet + açılır bulgu listesi (konumlu), denetimler, AI denetçi notu ve kullanıcı
// kararları: yine de kabul et, revizyon iste (bulgularla düzenle-devam et), yanlış alarm işaretle, denetçiye incelet.
// Yazma uçları sunucuda kullanıcı-yalnızdır. Kişisel veri yalnızca işaretlenir; maskeleme iddiası yok.
import clsx from "clsx";
import { Bot, Check, CircleSlash, FilePenLine, RefreshCcw, ShieldCheck, Undo2 } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Spinner } from "../ui";
import { formatMinutes, formatMoney } from "../../full/more";
import { onDeliverableEvent } from "../../lib/deliverables";
import { currentLocale, useT } from "../../lib/i18n";
import {
  findingText, fmtScore, openCount, qualityApi, sortFindings, wouldBlock,
  type GateMode, type QualityFinding, type QualityReport, type ReviewerPlan,
} from "../../lib/quality";
import { qualityMsg as m } from "../../locales/quality";
import { QualityBadge } from "./QualityBadge";

const KNOWN_CHECKS = ["sections", "format", "placeholders", "length", "unsourced", "links", "pii", "owner_date", "safety",
  "check_command"] as const;
const SEV_TONE = { error: "bad", warn: "warn", info: "muted" } as const;

type Mode = null | "accept" | "revise";

export function QualityPanel({ deliverableId, defaultOpen = false, compact = false }:
  { deliverableId: string; defaultOpen?: boolean; compact?: boolean }) {
  const t = useT(m);
  const lang = currentLocale();
  const listId = useId();
  const [report, setReport] = useState<QualityReport | null>(null);
  const [gate, setGate] = useState<{ internal: GateMode; external: GateMode } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<ReviewerPlan | null>(null);
  const [revision, setRevision] = useState<string | null>(null);

  const load = useCallback(() => {
    qualityApi.get(deliverableId)
      .then((r) => { setReport(r.report); setGate(r.gate); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, [deliverableId]);

  useEffect(() => { setLoaded(false); setReport(null); setMode(null); setRevision(null); load(); }, [load]);
  useEffect(() => onDeliverableEvent((ev) => {
    if (ev.type === "deliverable.quality" && ev.id === deliverableId) load();
  }), [deliverableId, load]);
  useEffect(() => {
    if (!open || plan || !report) return;
    qualityApi.reviewerPlan(deliverableId).then(setPlan).catch(() => undefined);
  }, [open, plan, report, deliverableId]);

  const act = async (fn: () => Promise<{ report?: QualityReport } | unknown>) => {
    setBusy(true);
    try {
      const res = await fn() as { report?: QualityReport };
      if (res && res.report) setReport({ ...res.report, gate: res.report.gate ?? report?.gate });
      setError(null);
      return true;
    } catch (e) {
      setError(t("error", { error: e instanceof Error ? e.message : String(e) }));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return compact ? null : <div className="flex items-center gap-2 text-sm text-muted"><Spinner size={14} />{t("loading")}</div>;
  if (!report) {
    if (compact) return null;
    return error ? <p className="text-sm text-bad" role="alert">{t("load_error", { error })}</p>
      : <p className="text-sm text-muted">{t("none")}</p>;
  }

  const findings = sortFindings(report.findings);
  const open_ = openCount(report);
  const blocked = gate ? wouldBlock(report, gate.external) : false;
  const reviewer = report.reviewer;
  const checkLabel = (id: string) => (KNOWN_CHECKS as readonly string[]).includes(id)
    ? t(`check_${id}` as "check_sections") : `${t("check_other")}: ${id.replace(/^rule:/, "")}`;
  const statusText = report.accepted_anyway ? t("accepted") : t(`status_${report.status}` as "status_passed");
  const money = plan?.estimate?.money ? formatMoney(plan.estimate.money as Parameters<typeof formatMoney>[0], lang) : null;
  const minutes = plan?.estimate?.minutes ? formatMinutes(plan.estimate.minutes, lang) : null;
  const hasPii = report.findings.some((f) => f.code === "pii" && !f.false_positive);

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <QualityBadge quality={report.badge ?? { score: report.score, status: report.status,
          accepted_anyway: report.accepted_anyway, reviewer: reviewer?.status ?? null }}
          expanded={open} onToggle={() => setOpen((v) => !v)} controls={listId} />
        {!compact && <span className="text-xs text-muted">{statusText}</span>}
      </div>

      {open && (
        <div id={listId} className="panel-soft p-3 flex flex-col gap-3 min-w-0" aria-label={t("title")}>
          <div className="flex flex-col gap-1">
            <p className={clsx("text-sm font-semibold", report.status === "failed" && !report.accepted_anyway ? "text-bad" : "")}>{statusText}</p>
            {report.accepted_anyway && report.accept_reason && <p className="text-xs text-muted break-words">{t("accepted_reason", { reason: report.accept_reason })}</p>}
            {gate && !report.accepted_anyway && report.status !== "passed" && (
              <p className="text-xs text-muted">{blocked ? t("gate_block") : t("gate_warn")}</p>
            )}
          </div>

          <section className="flex flex-col gap-1.5" aria-label={t("findings")}>
            <h3 className="text-xs font-semibold text-muted">{t("findings")} · {t("findings_count", { n: open_ })}</h3>
            {!findings.length ? <p className="text-sm text-muted">{t("no_findings")}</p> : (
              <ul className="flex flex-col gap-1.5">
                {findings.map((f) => <FindingRow key={f.id} f={f} busy={busy}
                  onToggle={() => { void act(() => qualityApi.falsePositive(deliverableId, f.id, !f.false_positive)); }} />)}
              </ul>
            )}
            {hasPii && <p className="text-xs text-muted">{t("pii_note")}</p>}
          </section>

          {reviewer && (
            <section className="flex flex-col gap-1" aria-label={t("reviewer")}>
              <h3 className="text-xs font-semibold text-muted flex items-center gap-1"><Bot size={13} aria-hidden />{t("reviewer")}</h3>
              {reviewer.status === "running" && <p className="text-sm flex items-center gap-2"><Spinner size={13} />{t("reviewer_running")}</p>}
              {reviewer.status === "error" && <p className="text-sm text-bad break-words">{t("reviewer_error", { error: reviewer.error ?? "" })}</p>}
              {reviewer.status === "done" && (
                <>
                  <p className="text-sm num">{t("reviewer_score", { score: fmtScore(reviewer.score, lang) })}{reviewer.label ? ` · ${reviewer.label}` : ""}</p>
                  {reviewer.notes && <p className="text-sm break-words whitespace-pre-line">{reviewer.notes}</p>}
                </>
              )}
            </section>
          )}

          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-semibold text-muted">{t("checks")}</summary>
            <ul className="mt-1.5 flex flex-col gap-1">
              {report.checks.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 min-w-0">
                  <Badge tone={c.status === "passed" ? "ok" : c.status === "failed" ? "bad" : "muted"}>{t(`check_${c.status}` as "check_passed")}</Badge>
                  <span className="font-medium">{checkLabel(c.id)}</span>
                  {c.detail && <span className="text-xs text-muted break-words min-w-0">{c.detail}</span>}
                </li>
              ))}
            </ul>
          </details>

          {plan && (
            <p className="text-xs text-muted break-words">
              {t("reviewer_brain", { label: plan.label })}
              {" · "}
              {plan.local ? t("reviewer_local") : money ? t("reviewer_cost", { money, minutes: minutes ?? "–" }) : ""}
            </p>
          )}

          {(revision || report.revision_run_id) && (
            <p className="text-sm flex flex-wrap items-center gap-2" role="status">
              {revision ? t("revise_started") : t("revision_exists")}
              <Link className="underline font-semibold" to={`/gorevler/${encodeURIComponent(revision ?? report.revision_run_id ?? "")}`}>{t("revise_open")}</Link>
            </p>
          )}

          {mode && (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold" htmlFor={`${listId}-text`}>{mode === "accept" ? t("accept_reason") : t("revise_note")}</label>
              <textarea id={`${listId}-text`} className="input min-h-[4rem] w-full" value={text} maxLength={1000}
                onChange={(e) => setText(e.target.value)} />
              {mode === "revise" && <p className="text-xs text-muted">{t("revise_hint", { n: open_ })}</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" disabled={busy} icon={mode === "accept" ? <Check size={14} /> : <FilePenLine size={14} />}
                  onClick={() => {
                    if (mode === "accept") {
                      void act(() => qualityApi.accept(deliverableId, text.trim())).then((ok) => { if (ok) setMode(null); });
                    } else {
                      setBusy(true);
                      qualityApi.revise(deliverableId, text.trim())
                        .then((r) => { setRevision(r.run_id); setMode(null); load(); })
                        .catch((e: unknown) => setError(t("error", { error: e instanceof Error ? e.message : String(e) })))
                        .finally(() => setBusy(false));
                    }
                  }}>{mode === "accept" ? t("accept_confirm") : t("revise_confirm")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setMode(null)}>{t("cancel")}</Button>
              </div>
            </div>
          )}

          {!mode && (
            <div className="flex flex-wrap gap-2">
              {report.status !== "passed" && !report.accepted_anyway && (
                <Button size="sm" icon={<ShieldCheck size={14} />} disabled={busy} onClick={() => { setText(""); setMode("accept"); }}>{t("accept")}</Button>
              )}
              {report.accepted_anyway && (
                <Button size="sm" icon={<Undo2 size={14} />} disabled={busy} onClick={() => { void act(() => qualityApi.revoke(deliverableId)); }}>{t("revoke")}</Button>
              )}
              {open_ > 0 && (
                <Button size="sm" icon={<FilePenLine size={14} />} disabled={busy} onClick={() => { setText(""); setMode("revise"); }}>{t("revise")}</Button>
              )}
              <Button size="sm" variant="ghost" icon={<Bot size={14} />} disabled={busy || reviewer?.status === "running"}
                onClick={() => { void act(() => qualityApi.assess(deliverableId, { reviewer: true })); }}>
                {reviewer?.status === "done" ? t("reviewer_rerun") : t("reviewer_run")}
              </Button>
              <Button size="sm" variant="ghost" icon={<RefreshCcw size={14} />} disabled={busy}
                onClick={() => { void act(() => qualityApi.assess(deliverableId)); }}>{t("reassess")}</Button>
              {!!report.spec?.check && (
                <Button size="sm" variant="ghost" disabled={busy}
                  onClick={() => { void act(() => qualityApi.assess(deliverableId, { run_check: true })); }}>{t("run_check")}</Button>
              )}
            </div>
          )}
          {error && <p className="text-sm font-semibold text-bad" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

function FindingRow({ f, busy, onToggle }: { f: QualityFinding; busy: boolean; onToggle: () => void }) {
  const t = useT(m);
  const line = f.location?.line;
  const excerpt = f.location?.excerpt;
  return (
    <li className={clsx("flex flex-col gap-0.5 min-w-0 border-l-2 pl-2", f.false_positive ? "border-line-soft opacity-70" : f.severity === "error" ? "border-bad" : f.severity === "warn" ? "border-warn" : "border-line-soft")}>
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        <Badge tone={f.false_positive ? "muted" : SEV_TONE[f.severity]}>{t(`sev_${f.severity}` as "sev_error")}</Badge>
        {line ? <span className="text-xs text-muted num">{t("line", { n: line })}</span> : null}
        {f.source === "reviewer" && <span className="text-xs text-muted">{t("from_reviewer")}</span>}
        {f.false_positive && <span className="text-xs text-muted">{t("marked_fp")}</span>}
        <Button size="sm" variant="ghost" className="ml-auto" disabled={busy}
          icon={f.false_positive ? <Undo2 size={13} /> : <CircleSlash size={13} />}
          aria-label={f.false_positive ? t("false_positive_undo") : t("false_positive_label")}
          onClick={onToggle}>{f.false_positive ? t("false_positive_undo") : t("false_positive")}</Button>
      </div>
      <span className={clsx("text-sm break-words", f.false_positive && "line-through")}>{findingText(f, currentLocale())}</span>
      {excerpt && <q className="text-xs text-muted break-words">{excerpt}</q>}
    </li>
  );
}
