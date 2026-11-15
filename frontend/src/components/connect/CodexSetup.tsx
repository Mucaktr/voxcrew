// Ekip S11 — Codex kurulumu: `codex mcp add`, config.toml planı (önizle → onayla → yedekle), notify, AGENTS.md.
import { AlertTriangle, CheckCircle2, FileDiff } from "lucide-react";
import { useState } from "react";
import type { ChangeEntry } from "../../lib/changes";
import { clientsApi, type ClientsStatus, type CodexPlanResponse, type Snippets } from "../../lib/clients";
import { useT } from "../../lib/i18n";
import { connect as m } from "../../locales/connect";
import { ChangeReviewModal } from "../ChangeReviewModal";
import { Badge, Button, Spinner, Toggle } from "../ui";
import { CopyBlock } from "./CopyBlock";
import { Rich, SetupStep } from "./SetupStep";

const NOTIFY_TONE: Record<ClientsStatus["codex_config"]["notify"], string> = { none: "muted", ours: "ok", other: "warn" };

export function CodexSetup({ snippets, status, onApplied }:
  { snippets: Snippets; status: ClientsStatus | null; onApplied?: () => void }) {
  const t = useT(m);
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CodexPlanResponse | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [applied, setApplied] = useState<ChangeEntry | null>(null);
  const cx = snippets.codex;
  const cfg = status?.codex_config;

  const preparePlan = async () => {
    setBusy(true);
    setError(null);
    setApplied(null);
    try {
      const res = await clientsApi.codexPlan(notify);
      setResult(res);
      setReviewing(!res.plan.no_change);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const conflict = result?.notify.status === "conflict" ? result.notify : null;

  return (
    <div className="flex flex-col gap-6">
      {cfg && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <Badge title={cfg.path} className="max-w-full"><span className="font-mono truncate">{cfg.display}</span></Badge>
          {cfg.error ? <Badge tone="bad">{cfg.error}</Badge> : !cfg.exists ? <Badge>{t("cx_not_yet")}</Badge> : (
            <>
              <Badge tone={cfg.has_server ? "ok" : "muted"}>{cfg.has_server ? t("cx_server_added") : t("cx_server_missing")}</Badge>
              <Badge tone={NOTIFY_TONE[cfg.notify]}>{t(`notify_${cfg.notify}`)}</Badge>
            </>
          )}
        </div>
      )}

      <SetupStep n={1} title={t("cx_step1")} badge={<Badge tone="ok">{t("fastest")}</Badge>}
        hint={t("cx_step1_hint")}>
        <CopyBlock text={cx.add} label={t("cx_add_cmd")} />
        <p className="text-xs text-muted leading-relaxed">
          <Rich text={t("cx_timeout_note")} parts={{ setting: <span className="font-mono">tool_timeout_sec = 150</span> }} />
        </p>
      </SetupStep>

      <SetupStep n={2} title={t("cx_step2")}
        hint={t("cx_step2_hint")}>
        <Toggle checked={notify} onChange={setNotify} label={t("cx_notify_toggle")}
          hint={cfg?.notify === "other" ? t("cx_notify_conflict_hint") : t("cx_notify_hint")} />
        <div>
          <Button icon={busy ? <Spinner size={15} /> : <FileDiff size={15} />} disabled={busy} onClick={preparePlan}>
            {t("preview_plan")}
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        {conflict && (
          <div className="rounded-lg border-2 px-3 py-2 text-sm tone-warn flex flex-col gap-1.5" role="status">
            <span className="font-semibold flex items-center gap-1.5"><AlertTriangle size={15} aria-hidden="true" />{t("cx_conflict_title")}</span>
            <span>{t("cx_conflict_current")}</span>
            <code className="font-mono text-xs break-all">{JSON.stringify(conflict.existing)}</code>
            <span>{t("cx_conflict_text")}</span>
          </div>
        )}
        {result && (
          <div className="flex flex-col gap-1.5 text-sm">
            {result.plan.no_change && (
              <p className="text-ok flex items-center gap-1.5"><CheckCircle2 size={15} aria-hidden="true" />{t("cx_no_change")}</p>
            )}
            {applied && (
              <p className="text-ok flex items-center gap-1.5" role="status"><CheckCircle2 size={15} aria-hidden="true" />{t("cx_applied")}</p>
            )}
            {[...result.warnings, ...result.notes.filter((n) => !conflict || !n.includes("notify"))].map((n) => (
              <p key={n} className="text-ink-2">{n}</p>
            ))}
            {!result.plan.no_change && !applied && (
              <div><Button size="sm" variant="ghost" icon={<FileDiff size={14} />} onClick={() => setReviewing(true)}>{t("show_diff_again")}</Button></div>
            )}
          </div>
        )}
      </SetupStep>

      <SetupStep n={3} title={t("cx_step3")}
        hint={<Rich text={t("cx_step3_hint")} parts={{ file: <span className="font-mono">{cfg?.display ?? "~/.codex/config.toml"}</span> }} />}>
        <CopyBlock text={cx.toml} label={t("cx_toml_label")} multiline />
        <CopyBlock text={cx.notify} label={t("cx_notify_label")} />
      </SetupStep>

      <SetupStep n={4} title={t("cx_step4")}
        hint={t("cx_step4_hint")}>
        {cx.agents_md ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-2 font-semibold">{t("cx_agents_summary")}</summary>
            <CopyBlock className="mt-2" text={cx.agents_md} label={t("cx_agents_label")} multiline />
          </details>
        ) : <p className="text-sm text-muted">{t("cx_agents_missing")}</p>}
      </SetupStep>

      <SetupStep n={5} title={t("verify")}
        hint={<Rich text={t("cx_verify_hint")} parts={{ mcp: <span className="kbd">/mcp</span>, server: <span className="font-mono">voxcrew</span> }} />}>
        <CopyBlock text={cx.verify[0]} label={t("verify_cmd")} />
      </SetupStep>

      <ChangeReviewModal plan={reviewing ? result?.plan ?? null : null} title={t("cx_review_title")}
        onClose={() => setReviewing(false)}
        onApplied={(e) => { setApplied(e); onApplied?.(); }} />
    </div>
  );
}
