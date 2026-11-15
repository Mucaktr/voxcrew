// Ekip S10 (Hedefler) — hedef ağacı (şirket → ekip → ajan), toplu ekleme, başlatma ve /hedefler/:id ayrıntısı.
// Canlı güncelleme: lib/goals.ts `goal.` olaylarına abonedir (registerEventHandler).
import { AlertTriangle, ListPlus, Plus, RefreshCw, Sparkles, Target } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { BulkAddDialog } from "../components/goals/BulkAddDialog";
import { useOwnerLookup } from "../components/goals/GoalBadges";
import { GoalDetail } from "../components/goals/GoalDetail";
import { GoalFormDialog } from "../components/goals/GoalFormDialog";
import { GoalTree } from "../components/goals/GoalTree";
import { LaunchDialog } from "../components/goals/LaunchDialog";
import { Badge, Button, Empty, PageHeader, Panel, Segmented, Spinner } from "../components/ui";
import { filterTree, isOverdue, LEVEL_META, LEVELS, useGoals, walkGoals, type Goal, type GoalLevel } from "../lib/goals";
import { useT } from "../lib/i18n";
import { useOffice } from "../lib/office";
import { goalsMsg as m } from "../locales/goals";

type FormState = { goal: Goal | null; parent: Goal | null } | null;

export default function GoalsPage() {
  const t = useT(m);
  const { id } = useParams();
  const goals = useGoals((s) => s.goals);
  const loaded = useGoals((s) => s.loaded);
  const loadError = useGoals((s) => s.error);
  const refresh = useGoals((s) => s.refresh);
  const refreshOffice = useOffice((s) => s.refresh);
  const lookup = useOwnerLookup();

  const [level, setLevel] = useState<GoalLevel | "all">("all");
  const [owner, setOwner] = useState("");
  const [bulk, setBulk] = useState<{ parent: string | null; sample: boolean } | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [launching, setLaunching] = useState<Goal | null>(null);

  useEffect(() => { void refresh(); void refreshOffice(); }, [refresh, refreshOffice]);

  const stats = useMemo(() => {
    let total = 0, running = 0, done = 0, late = 0;
    walkGoals(goals, (g) => {
      total++;
      if (g.status === "in_progress") running++;
      if (g.status === "done") done++;
      if (isOverdue(g)) late++;
    });
    return { total, running, done, late };
  }, [goals]);
  const visible = useMemo(() => filterTree(goals, level, owner), [goals, level, owner]);
  const owners = useMemo(() => {
    const teams = new Set<string>(), agents = new Set<string>();
    walkGoals(goals, (g) => {
      if (g.owner_team) teams.add(g.owner_team);
      if (g.owner_agent) agents.add(g.owner_agent);
    });
    return { teams: [...teams].sort(), agents: [...agents].sort() };
  }, [goals]);

  const openChild = useCallback((g: Goal) => setForm({ goal: null, parent: g }), []);
  const openEdit = useCallback((g: Goal) => setForm({ goal: g, parent: null }), []);
  const changed = useCallback(() => { void refresh(); }, [refresh]);

  const dialogs = (
    <>
      <BulkAddDialog open={!!bulk} onClose={() => setBulk(null)} onDone={changed} goals={goals} lookup={lookup}
        initialParent={bulk?.parent} initialSample={bulk?.sample} />
      <GoalFormDialog open={!!form} onClose={() => setForm(null)} onSaved={changed} goal={form?.goal} parent={form?.parent}
        goals={goals} lookup={lookup} />
      <LaunchDialog goal={launching} onClose={() => setLaunching(null)} onLaunched={changed} lookup={lookup} />
    </>
  );

  if (id) {
    return (
      <div className="p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
        <GoalDetail id={id} lookup={lookup} onLaunch={setLaunching} onEdit={openEdit} onAddChild={openChild} />
        {dialogs}
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
      <PageHeader title={t("page_title")} subtitle={t("page_subtitle")}
        meta={stats.total > 0 && <>
          <Badge tone="info"><Target size={12} aria-hidden="true" />{t("n_goals", { n: stats.total })}</Badge>
          {stats.running > 0 && <Badge tone="info">{t("n_running", { n: stats.running })}</Badge>}
          <Badge tone="ok">{t("n_done", { n: stats.done })}</Badge>
          {stats.late > 0 && <Badge tone="bad">{t("n_late", { n: stats.late })}</Badge>}
        </>}
        actions={<>
          <Button icon={<RefreshCw size={15} />} onClick={changed} aria-label={t("refresh")} title={t("refresh")} />
          <Button icon={<Plus size={16} />} onClick={() => setForm({ goal: null, parent: null })}>{t("new_goal")}</Button>
          <Button variant="primary" icon={<ListPlus size={16} />} onClick={() => setBulk({ parent: null, sample: false })}>{t("bulk_add")}</Button>
        </>} />

      {loadError && (
        <p className="panel-soft p-3 text-sm font-semibold text-bad flex items-start gap-2" role="alert">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />{t("load_error", { error: loadError })}
        </p>
      )}

      {!loaded && !goals.length ? (
        <div className="p-10 grid place-items-center"><Spinner size={24} /></div>
      ) : !goals.length ? (
        <Panel>
          <Empty icon={<Target size={30} />} title={t("empty_title")} text={t("empty_text")}
            action={<div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" icon={<ListPlus size={16} />} onClick={() => setBulk({ parent: null, sample: false })}>{t("bulk_add")}</Button>
              <Button icon={<Sparkles size={16} />} onClick={() => setBulk({ parent: null, sample: true })}>{t("start_sample")}</Button>
            </div>} />
        </Panel>
      ) : (
        <Panel>
          <div className="flex flex-wrap items-center gap-2 pt-4 pb-4">
            <Segmented value={level} onChange={setLevel}
              options={[{ value: "all", label: t("all") }, ...LEVELS.map((l) => ({ value: l, label: LEVEL_META[l].label }))]} />
            <label className="flex items-center gap-2 min-w-0 w-full sm:w-auto">
              <span className="text-sm text-ink-2 shrink-0">{t("owner")}</span>
              <select className="select min-w-0 flex-1 sm:flex-none sm:!w-auto sm:max-w-64" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">{t("everyone")}</option>
                {owners.teams.length > 0 && (
                  <optgroup label={t("teams")}>
                    {owners.teams.map((x) => <option key={x} value={x}>{lookup.teamName(x)}</option>)}
                  </optgroup>
                )}
                {owners.agents.length > 0 && (
                  <optgroup label={t("agents")}>
                    {owners.agents.map((a) => <option key={a} value={a}>{lookup.agentName(a)}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
          </div>
          {visible.length ? (
            <GoalTree goals={visible} lookup={lookup} onLaunch={setLaunching} onAddChild={openChild} />
          ) : (
            <Empty title={t("filter_empty")} text={t("filter_empty_text")}
              action={<Button size="sm" onClick={() => { setLevel("all"); setOwner(""); }}>{t("clear_filter")}</Button>} />
          )}
        </Panel>
      )}
      {dialogs}
    </div>
  );
}
