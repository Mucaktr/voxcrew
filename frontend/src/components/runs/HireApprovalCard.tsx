// İşe alım onay kartı (S6): yönetici, ekibine yeni bir ajan almak istiyor. Koşular sayfası (RunsPage StepCard) ve yürüme
// modunun Konuş paneli (TalkPanel "Onay bekliyor"; FIX-UX D3 A) AYNI kartı kullanır: rol, persona, rütbe, yerleşim
// ve yönetici gösterilmeden işe alım onaylanmaz. Karar ucu ve MCP kuralları değişmez (`api.decide`).
import clsx from "clsx";
import { CheckCircle2, UserPlus, XCircle } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { STATUS } from "../../lib/format";
import { useT } from "../../lib/i18n";
import type { Agent, Run, StepRun } from "../../lib/types";
import { runsMsg as m } from "../../locales/runs";
import type { DynStep, HireInfo } from "../office/hierarchy";
import { RankBadge } from "../office/RankBadge";
import { Button } from "../ui";
import { ResumeFirst, runSuspended } from "./RunControls";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Adım bir işe alım onayı mı (kart için gereken `hire` bilgisi var mı). */
export function hireOf(step: StepRun): HireInfo | null {
  const ds = step as DynStep;
  return ds.kind === "hire" && ds.hire ? ds.hire : null;
}

export function HireApprovalCard({ run, step, hire, manager }: { run: Run; step: StepRun; hire: HireInfo; manager?: Agent }) {
  const t = useT(m);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const waiting = step.status === "awaiting_approval";
  const decide = async (approved: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.decide(run.id, step.id, approved, note);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);  // QA-m8: başarıdan sonra da kilit açılır
    }
  };
  const who = manager?.name ?? hire.by_name;
  return (
    <section className={clsx("rounded-xl border-2 p-3 sm:p-4 flex flex-col gap-3", waiting ? "tone-info" : "border-line-soft")}
      aria-live="polite" data-hire-card="">
      <header className="flex flex-wrap items-center gap-2">
        <UserPlus size={18} className="shrink-0" />
        <h4 className="font-display font-semibold text-sm flex-1 min-w-[12rem]">{t("hire_wants", { name: who, title: hire.title })}</h4>
        <RankBadge rank={hire.rank} />
      </header>
      <dl className="grid gap-1.5 text-sm text-ink">
        {hire.subtask && <div><dt className="label inline">{t("hire_subtask")}</dt><dd className="inline">{hire.subtask}</dd></div>}
        {hire.role && <div><dt className="label inline">{t("hire_role")}</dt><dd className="inline">{hire.role}</dd></div>}
        {hire.persona && <div><dt className="label inline">{t("hire_persona")}</dt><dd className="inline">{hire.persona}</dd></div>}
        <div><dt className="label inline">{t("hire_placement")}</dt>
          <dd className="inline">{t("hire_reports_to", { name: who })}{hire.team ? t("hire_in_team", { team: hire.team_name ?? hire.team }) : ""}{t("hire_brain_note")}</dd></div>
        {!!hire.skills_hint?.length && (
          <div className="flex flex-wrap items-center gap-1"><dt className="label">{t("hire_skills")}</dt>
            {hire.skills_hint.map((k) => <dd key={k} className="chip">{k}</dd>)}</div>
        )}
      </dl>
      {waiting && runSuspended(run) ? <ResumeFirst run={run} /> : waiting ? (
        <div className="flex flex-col sm:flex-row gap-2">
          <input className="input" aria-label={t("note_optional")} placeholder={t("note_optional")} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="primary" disabled={busy} icon={<CheckCircle2 size={16} />} onClick={() => decide(true)}>{t("hire")}</Button>
          <Button variant="danger" disabled={busy} icon={<XCircle size={16} />} onClick={() => decide(false)}>{t("reject")}</Button>
        </div>
      ) : (
        <p className="text-sm text-muted">
          {step.status === "done" ? t("hire_approved") : step.status === "rejected" ? t("hire_rejected") : t("status_prefix", { status: STATUS[step.status]?.label ?? step.status })}
        </p>
      )}
      {error && <p className="text-sm font-semibold text-bad" role="alert">{error}</p>}
    </section>
  );
}
