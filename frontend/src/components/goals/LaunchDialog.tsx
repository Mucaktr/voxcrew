// Ekip S10 — "Başlat": hedef için devretme koşusu (S6). Kök ajan, işe alım izni (onayımla/otomatik) ve bütçe seçenekleri.
import { ArrowRight, CheckCircle2, Info, Play, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { byName, rankLabel } from "../../lib/agents";
import { GoalApiError, goalsApi, LAUNCH_DEFAULTS, type Goal, type LaunchOptions } from "../../lib/goals";
import { useT } from "../../lib/i18n";
import { goalsMsg as m } from "../../locales/goals";
import { Button, Field, Modal, Segmented, Toggle } from "../ui";
import type { OwnerLookup } from "./GoalBadges";

export function LaunchDialog({ goal, onClose, onLaunched, lookup }:
  { goal: Goal | null; onClose: () => void; onLaunched?: (runId: string) => void; lookup: OwnerLookup }) {
  const t = useT(m);
  const [root, setRoot] = useState("");
  const [opts, setOpts] = useState<LaunchOptions>(LAUNCH_DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!goal) return;
    setRoot(goal.default_root ?? "");
    setOpts(LAUNCH_DEFAULTS);
    setError(null);
    setRunId(null);
  }, [goal]);

  const agents = useMemo(() => lookup.agents.filter((a) => !a.hidden).sort(byName), [lookup.agents]);
  const rootAgent = lookup.agent(root);
  const reports = useMemo(() => agents.filter((a) => a.reports_to === root).length, [agents, root]);
  const set = <K extends keyof LaunchOptions>(k: K, v: LaunchOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  const launch = async () => {
    if (!goal || !root) return;
    setBusy(true);
    setError(null);
    try {
      const res = await goalsApi.launch(goal.id, {
        root_agent: root, options: { ...opts, hire_budget: opts.allow_hiring ? opts.hire_budget : 0 } });
      setRunId(res.run_id);
      onLaunched?.(res.run_id);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e), status: e instanceof GoalApiError ? e.status : 0 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!goal} onClose={onClose} width={600} title={runId ? t("run_started") : t("launch_goal")}
      footer={runId ? (
        <>
          <Button variant="ghost" onClick={onClose}>{t("close")}</Button>
          <Link to={`/gorevler/${encodeURIComponent(runId)}`} className="btn btn-primary" onClick={onClose}>
            {t("watch_run")}<ArrowRight size={16} aria-hidden="true" />
          </Link>
        </>
      ) : (
        <>
          <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
          <Button variant="primary" icon={<Play size={16} />} disabled={busy || !root} onClick={launch}>
            {busy ? t("launching") : t("launch_delegation")}
          </Button>
        </>
      )}>
      {goal && runId && (
        <div className="flex flex-col items-center text-center gap-2 py-4" role="status">
          <CheckCircle2 size={36} className="text-ok" aria-hidden="true" />
          <p className="font-display text-base font-semibold">{t("took_over", { name: lookup.agentName(root) })}</p>
          <p className="text-sm text-ink-2 max-w-sm">{t("took_over_text")}</p>
        </div>
      )}
      {goal && !runId && (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); launch(); }}>
          <p className="text-sm text-ink-2">
            <strong className="text-ink">{goal.title}</strong>{t("launch_intro_a")}
          </p>
          <Field label={t("root_agent")}
            hint={rootAgent
              ? `${rootAgent.title || rankLabel(rootAgent.rank) || t("agent_fallback")} · ${reports ? t("n_reports", { n: reports }) : t("no_reports")}`
              : goal.default_root ? undefined : t("no_default_root")}>
            <select className="select" value={root} onChange={(e) => setRoot(e.target.value)} aria-invalid={!root} autoFocus>
              <option value="">{t("pick_root")}</option>
              {agents.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.name}{a.title ? ` — ${a.title}` : ""}{a.slug === goal.default_root ? t("default_suffix") : ""}
                </option>
              ))}
            </select>
          </Field>

          <div className="panel-soft p-3 flex flex-col gap-3">
            <Toggle checked={opts.allow_hiring} onChange={(v) => set("allow_hiring", v)} aria-label={t("allow_hiring")}
              label={<span className="inline-flex items-center gap-1.5"><UserPlus size={15} aria-hidden="true" />{t("allow_hiring")}</span>}
              hint={t("allow_hiring_hint")} />
            {opts.allow_hiring && (
              <div className="flex flex-wrap gap-3 pl-14 max-sm:pl-0">
                <Field label={t("hiring_approval")}>
                  <Segmented value={opts.hiring_approval} onChange={(v) => set("hiring_approval", v)}
                    options={[{ value: "ask", label: t("approval_ask") }, { value: "auto", label: t("approval_auto") }]} />
                </Field>
                <Field label={t("hire_budget")}>
                  <Segmented value={String(opts.hire_budget)} onChange={(v) => set("hire_budget", Number(v))}
                    options={["1", "2", "3"].map((n) => ({ value: n, label: t("n_agents", { n: Number(n) }) }))} />
                </Field>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <Field label={t("depth")} hint={t("depth_hint")}>
              <Segmented value={String(opts.depth)} onChange={(v) => set("depth", Number(v))}
                options={["1", "2", "3"].map((n) => ({ value: n, label: t("n_levels", { n: Number(n) }) }))} />
            </Field>
            <Field label={t("max_subtasks")} className="basis-32">
              <select className="select" value={opts.max_subtasks} onChange={(e) => set("max_subtasks", Number(e.target.value))}>
                {[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
          </div>

          {opts.allow_hiring && opts.hiring_approval === "auto" && (
            <p className="text-xs text-warn font-semibold flex items-start gap-1.5">
              <Info size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
              {t("auto_warning", { n: opts.hire_budget })}
            </p>
          )}
          {error && (
            <p className="text-sm font-semibold text-bad" role="alert">
              {error.message}
              {error.status === 503 && <span className="block font-normal text-ink-2 mt-1">{t("engine_disabled")}</span>}
            </p>
          )}
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}
