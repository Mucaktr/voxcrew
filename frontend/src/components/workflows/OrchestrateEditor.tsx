// Ekip S24 — `orchestrate` adımının ayarları: plan onayı (ask | auto), yeniden plan hakkı (0–2),
// izleme aralığı (sn). Devretme ayarları (derinlik, alt görev, işe alım) iş akışı sayfasındaki devretme düzenleyicisiyle verilir.
import { ListChecks } from "lucide-react";
import { Field, Segmented } from "../ui";
import { useT } from "../../lib/i18n";
import type { WorkflowStep } from "../../lib/types";
import { messagesMsg as m } from "../../locales/messages";

export type OrchestrateStep = WorkflowStep & { plan_approval?: "ask" | "auto"; max_replans?: number; monitor_every_s?: number };
export const ORCHESTRATE_DEFAULTS = { plan_approval: "ask" as const, max_replans: 1, monitor_every_s: 30 };

export function OrchestrateEditor({ step, onChange }: { step: WorkflowStep; onChange: (fn: (s: WorkflowStep) => void) => void }) {
  const t = useT(m);
  const s = step as OrchestrateStep;
  const set = (fn: (f: OrchestrateStep) => void) => onChange((x) => fn(x as OrchestrateStep));
  const monitor = s.monitor_every_s ?? ORCHESTRATE_DEFAULTS.monitor_every_s;
  return (
    <div className="flex flex-col gap-3 panel-soft p-3" role="group" aria-label={t("orch_title")}>
      <span className="panel-title flex items-center gap-1.5"><ListChecks size={15} aria-hidden />{t("orch_title")}</span>
      <Field label={t("orch_plan_approval")} hint={t("orch_plan_hint")}>
        <Segmented value={s.plan_approval ?? ORCHESTRATE_DEFAULTS.plan_approval}
          onChange={(v) => set((f) => { f.plan_approval = v; })}
          options={[{ value: "ask", label: t("orch_plan_ask") }, { value: "auto", label: t("orch_plan_auto") }]} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label={t("orch_max_replans")} hint={t("orch_max_replans_hint")}>
          <select className="select" aria-label={t("orch_max_replans")} value={s.max_replans ?? ORCHESTRATE_DEFAULTS.max_replans}
            onChange={(e) => set((f) => { f.max_replans = Number(e.target.value); })}>
            {[0, 1, 2].map((n) => <option key={n} value={n}>{t("orch_n_replans", { n })}</option>)}
          </select>
        </Field>
        <Field label={t("orch_monitor")} hint={t("orch_monitor_hint")}>
          <input className="input" type="number" min={1} max={3600} step={1} aria-label={t("orch_monitor")} value={monitor}
            onChange={(e) => {
              const n = Number(e.target.value);
              set((f) => { f.monitor_every_s = Number.isFinite(n) && n > 0 ? Math.min(3600, Math.max(1, n)) : undefined; });
            }} />
        </Field>
      </div>
      <p className="text-xs text-ink-2">{t("orch_note")}</p>
    </div>
  );
}
