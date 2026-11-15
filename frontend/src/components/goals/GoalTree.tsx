// Ekip S10 — hedef ağacı: kökler düzeye göre gruplanır (şirket → ekip → ajan), alt hedefler girintili.
// S20: düğüm başına daraltma yanında grup daraltma ve "tümünü daralt / genişlet"; çok hedefli ağaçlar derin
// dallar kapalı açılır (yalnızca görünen satırlar çizilir).
import clsx from "clsx";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, ListChecks, Loader2, Play, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LEVEL_META, LEVELS, walkGoals, type Goal, type GoalLevel } from "../../lib/goals";
import { useT } from "../../lib/i18n";
import { goalsMsg as m } from "../../locales/goals";
import { Badge, Button, SectionTitle } from "../ui";
import { DueBadge, GoalStatusBadge, OwnerChip, PriorityBadge, type OwnerLookup } from "./GoalBadges";
import { ProgressRing } from "./ProgressRing";

interface TreeActions {
  onLaunch: (g: Goal) => void;
  onAddChild: (g: Goal) => void;
}
/** Bu sayıdan çok hedefte dallar başlangıçta kapalı gelir. */
const AUTO_COLLAPSE_AT = 40;

/** Daraltma durumu: `defaultOpen` + istisna kümesi (tümünü daralt/genişlet tek adımda). */
interface Fold { defaultOpen: boolean; except: Set<string> }
const isOpen = (f: Fold, id: string) => (f.except.has(id) ? !f.defaultOpen : f.defaultOpen);

export function GoalTree({ goals, lookup, grouped = true, ...actions }:
  { goals: Goal[]; lookup: OwnerLookup; grouped?: boolean } & TreeActions) {
  const t = useT(m);
  const total = useMemo(() => { let n = 0; walkGoals(goals, () => { n++; }); return n; }, [goals]);
  const [fold, setFold] = useState<Fold>(() => ({ defaultOpen: total <= AUTO_COLLAPSE_AT, except: new Set() }));
  const [groupsClosed, setGroupsClosed] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((id: string) => setFold((f) => {
    const except = new Set(f.except);
    if (except.has(id)) except.delete(id); else except.add(id);
    return { ...f, except };
  }), []);
  const setAll = (open: boolean) => { setFold({ defaultOpen: open, except: new Set() }); if (open) setGroupsClosed(new Set()); };
  const hasBranches = useMemo(() => { let b = false; walkGoals(goals, (g) => { if (g.children?.length) b = true; }); return b; }, [goals]);

  const toolbar = hasBranches && (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="ghost" icon={<ChevronsDownUp size={14} />} onClick={() => setAll(false)}>{t("collapse_all")}</Button>
      <Button size="sm" variant="ghost" icon={<ChevronsUpDown size={14} />} onClick={() => setAll(true)}>{t("expand_all")}</Button>
    </div>
  );

  if (!grouped) {
    return (
      <div className="flex flex-col gap-2">
        {toolbar}
        <GoalList goals={goals} depth={0} lookup={lookup} fold={fold} toggle={toggle} {...actions} />
      </div>
    );
  }
  const groups = LEVELS.map((level) => ({ level, items: goals.filter((g) => g.level === level) })).filter((g) => g.items.length);
  return (
    <div className="flex flex-col gap-5">
      {toolbar}
      {groups.map(({ level, items }) => {
        const open = !groupsClosed.has(level);
        const groupLabel = LEVEL_META[level as GoalLevel].group;
        return (
          <section key={level} aria-labelledby={`hedef-grup-${level}`} className="flex flex-col gap-2.5">
            <SectionTitle as="h2" size="sm" className="px-0.5"
              icon={<button type="button" className="btn btn-sm btn-ghost btn-icon -ml-1" aria-expanded={open}
                aria-label={open ? t("hide_group", { group: groupLabel }) : t("show_group", { group: groupLabel })}
                onClick={() => setGroupsClosed((s) => { const n = new Set(s); if (n.has(level)) n.delete(level); else n.add(level); return n; })}>
                <ChevronRight size={16} className={clsx("transition-transform", open && "rotate-90")} aria-hidden="true" />
              </button>}
              actions={<Badge>{items.length}</Badge>}>
              <span id={`hedef-grup-${level}`}>{groupLabel}</span>
            </SectionTitle>
            {open && <GoalList goals={items} depth={0} lookup={lookup} fold={fold} toggle={toggle} {...actions} />}
          </section>
        );
      })}
    </div>
  );
}

function GoalList({ goals, depth, ...rest }:
  { goals: Goal[]; depth: number; lookup: OwnerLookup; fold: Fold; toggle: (id: string) => void } & TreeActions) {
  return (
    <ul className={clsx("flex flex-col gap-2 min-w-0", depth > 0 && "mt-2 ml-2 sm:ml-5 pl-2 sm:pl-3 border-l-2 border-line-soft")}>
      {goals.map((g) => <GoalRow key={g.id} goal={g} depth={depth} {...rest} />)}
    </ul>
  );
}

function GoalRow({ goal, depth, lookup, fold, toggle, onLaunch, onAddChild }:
  { goal: Goal; depth: number; lookup: OwnerLookup; fold: Fold; toggle: (id: string) => void } & TreeActions) {
  const t = useT(m);
  const kids = goal.children ?? [];
  const open = isOpen(fold, goal.id);
  const krDone = goal.key_results.filter((k) => k.done).length;
  const running = (goal.runs ?? []).some((r) => r.status === "running" || r.status === "pending");
  const muted = goal.status === "cancelled";
  return (
    <li className="min-w-0">
      <div className={clsx("panel-soft flex items-start gap-2 sm:gap-3 p-2.5 sm:p-3 min-w-0", muted && "border-dashed")}>
        {kids.length ? (
          <Button variant="ghost" size="sm" className="shrink-0 -ml-1"
            icon={<ChevronRight size={16} className={clsx("transition-transform", open && "rotate-90")} aria-hidden="true" />}
            aria-expanded={open} aria-label={open ? t("hide_children", { title: goal.title }) : t("show_children", { title: goal.title })}
            onClick={() => toggle(goal.id)} />
        ) : <span className="w-7 shrink-0 hidden sm:block" aria-hidden="true" />}
        <ProgressRing value={goal.progress} status={goal.status} size={40}
          label={t("progress_label", { title: goal.title, pct: Math.round(goal.progress * 100) })} />
        <div className="flex-1 min-w-0">
          <Link to={`/hedefler/${encodeURIComponent(goal.id)}`}
            className={clsx("block text-sm font-semibold text-ink hover:underline underline-offset-2 break-words",
              (goal.status === "done" || muted) && "text-ink-2", muted && "line-through")}>
            {goal.title}
          </Link>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <OwnerChip goal={goal} lookup={lookup} />
            {goal.status !== "active" && <GoalStatusBadge status={goal.status} />}
            <PriorityBadge priority={goal.priority} compact />
            <DueBadge due={goal.due} status={goal.status} />
            {goal.key_results.length > 0 && (
              <Badge title={t("kr_done_title")}>
                <ListChecks size={12} aria-hidden="true" />{krDone}/{goal.key_results.length}
                <span className="sr-only">{t("kr_done_sr")}</span>
              </Badge>
            )}
            {!open && kids.length > 0 && <Badge tone="muted">+{kids.length}</Badge>}
            {running && <Badge tone="info"><Loader2 size={12} className="animate-spin" aria-hidden="true" />{t("run_running")}</Badge>}
            <span className="ml-auto flex items-center gap-1">
              <Button size="sm" icon={<Play size={14} aria-hidden="true" />} onClick={() => onLaunch(goal)}
                disabled={goal.status === "cancelled"} aria-label={t("launch_label", { title: goal.title })} title={t("launch_title")}>
                <span className="hidden sm:inline">{t("launch")}</span>
              </Button>
              <Button size="sm" variant="ghost" icon={<Plus size={15} aria-hidden="true" />} onClick={() => onAddChild(goal)}
                aria-label={t("add_child_label", { title: goal.title })} title={t("add_child")} />
            </span>
          </div>
        </div>
      </div>
      {open && kids.length > 0 && (
        <GoalList goals={kids} depth={depth + 1} lookup={lookup} fold={fold} toggle={toggle}
          onLaunch={onLaunch} onAddChild={onAddChild} />
      )}
    </li>
  );
}
