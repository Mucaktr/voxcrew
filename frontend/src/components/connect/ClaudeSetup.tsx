// Ekip S11 — Claude Code kurulumu: eklenti, kullanıcı kapsamı, proje .mcp.json planı (önizle → onayla → yedekle).
import { CheckCircle2, FileDiff } from "lucide-react";
import { useId, useState } from "react";
import type { ChangeEntry } from "../../lib/changes";
import { clientsApi, type ClaudePlanResponse, type Snippets } from "../../lib/clients";
import { useT } from "../../lib/i18n";
import { connect as m } from "../../locales/connect";
import { ChangeReviewModal } from "../ChangeReviewModal";
import { Badge, Button, Spinner } from "../ui";
import { CopyBlock } from "./CopyBlock";
import { Rich, SetupStep } from "./SetupStep";

export function ClaudeSetup({ snippets, onApplied }: { snippets: Snippets; onApplied?: () => void }) {
  const t = useT(m);
  const inputId = useId();
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaudePlanResponse | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [applied, setApplied] = useState<ChangeEntry | null>(null);
  const cc = snippets.claude_code;

  const preparePlan = async () => {
    setBusy(true);
    setError(null);
    setApplied(null);
    try {
      const res = await clientsApi.claudePlan(dir);
      setResult(res);
      setReviewing(!res.plan.no_change);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SetupStep n={1} title={t("cl_step1")} badge={<Badge tone="ok">{t("recommended")}</Badge>}
        hint={<Rich text={t("cl_step1_hint")} parts={{ skill: <span className="font-mono">studio</span> }} />}>
        {cc.plugin_github && (
          <>
            <p className="text-sm text-ink-2">
              {t("cl_github_note")}
            </p>
            {cc.plugin_github.map((cmd, i) => <CopyBlock key={cmd} text={cmd} label={t("cl_github_cmd", { n: i + 1 })} />)}
            <p className="text-sm text-ink-2">{t("cl_local_note")}</p>
          </>
        )}
        {cc.plugin.map((cmd, i) => <CopyBlock key={cmd} text={cmd} label={t("cl_plugin_cmd", { n: i + 1 })} />)}
        {!snippets.exists.marketplace && (
          <p className="text-sm text-warn">{t("cl_no_marketplace")}</p>
        )}
      </SetupStep>

      <SetupStep n={2} title={t("cl_step2")}
        hint={t("cl_step2_hint")}>
        <CopyBlock text={cc.user} label={t("cl_user_cmd")} />
      </SetupStep>

      <SetupStep n={3} title={t("cl_step3")}
        hint={t("cl_step3_hint")}>
        <div className="flex flex-col sm:flex-row gap-2 min-w-0">
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <label htmlFor={inputId} className="label">{t("cl_dir_label")}</label>
            <input id={inputId} className="input font-mono" value={dir} onChange={(e) => setDir(e.target.value)}
              placeholder={snippets.shell === "powershell" ? t("cl_dir_ph_win") : t("cl_dir_ph_posix")}
              spellCheck={false} autoComplete="off"
              onKeyDown={(e) => { if (e.key === "Enter" && dir.trim() && !busy) void preparePlan(); }} />
          </div>
          <Button className="sm:self-end" icon={busy ? <Spinner size={15} /> : <FileDiff size={15} />}
            disabled={busy || !dir.trim()} onClick={preparePlan}>
            {t("preview_plan")}
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        {result && (
          <div className="flex flex-col gap-1.5 text-sm">
            {result.plan.no_change && (
              <p className="text-ok flex items-center gap-1.5"><CheckCircle2 size={15} aria-hidden="true" />{t("cl_no_change")}</p>
            )}
            {applied && (
              <p className="text-ok flex items-center gap-1.5" role="status"><CheckCircle2 size={15} aria-hidden="true" />{t("cl_applied")}</p>
            )}
            <ul className="list-disc pl-5 text-ink-2 flex flex-col gap-0.5">
              {result.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
            {!result.plan.no_change && !applied && (
              <div><Button size="sm" variant="ghost" icon={<FileDiff size={14} />} onClick={() => setReviewing(true)}>{t("show_diff_again")}</Button></div>
            )}
          </div>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-2 font-semibold">{t("cl_manual_summary")}</summary>
          <CopyBlock className="mt-2" text={cc.project_json} label={t("cl_manual_label")} multiline />
        </details>
      </SetupStep>

      <SetupStep n={4} title={t("verify")}
        hint={<Rich text={t("cl_verify_hint")} parts={{ mcp: <span className="kbd">/mcp</span>, server: <span className="font-mono">voxcrew</span> }} />}>
        <CopyBlock text={cc.verify[0]} label={t("verify_cmd")} />
      </SetupStep>

      <ChangeReviewModal plan={reviewing ? result?.plan ?? null : null} title={t("cl_review_title")}
        onClose={() => setReviewing(false)}
        onApplied={(e) => { setApplied(e); onApplied?.(); }} />
    </div>
  );
}
