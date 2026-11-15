// Ekip S10 — /hedefler/:id: ilerleme, anahtar sonuçlar (güncellenebilir), alt hedefler, bağlı koşular, düzenle/sil.
import clsx from "clsx";
import { ArrowLeft, Check, ChevronRight, GitBranch, ListChecks, Pencil, Play, Plus, Target, Trash2, Workflow } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatDate, goalsApi, LEVEL_META, useGoals, type Goal, type KeyResult } from "../../lib/goals";
import { timeAgo } from "../../lib/format";
import { fmtPercent, useT } from "../../lib/i18n";
import { goalsMsg as m } from "../../locales/goals";
import { Badge, Button, Empty, Modal, PageHeader, Panel, Spinner, StatusPill } from "../ui";
import { DueBadge, GoalStatusBadge, OwnerChip, PriorityBadge, type OwnerLookup } from "./GoalBadges";
import { GoalTree } from "./GoalTree";
import { ScheduleButton } from "../schedule/ScheduleButton";
import { ProgressBar, ProgressRing } from "./ProgressRing";

export function GoalDetail({ id, lookup, onLaunch, onEdit, onAddChild }:
  { id: string; lookup: OwnerLookup; onLaunch: (g: Goal) => void; onEdit: (g: Goal) => void; onAddChild: (g: Goal) => void }) {
  const t = useT(m);
  const version = useGoals((s) => s.version);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const g = await goalsApi.get(id);
      setGoal(g);
      setState("ready");
    } catch (e) {
      const status = (e as { status?: number }).status;
      setState(status === 404 ? "missing" : "error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => { setState("loading"); setGoal(null); }, [id]);
  useEffect(() => { void load(); }, [load, version]);

  if (state === "loading" && !goal) return <div className="p-10 grid place-items-center"><Spinner size={24} /></div>;
  if (state === "missing" || (state === "error" && !goal)) {
    return (
      <Panel>
        <Empty icon={<Target size={28} />} title={state === "missing" ? t("not_found") : t("load_failed")}
          text={state === "missing" ? t("not_found_text") : error ?? undefined}
          action={<Link to="/hedefler" className="btn"><ArrowLeft size={16} aria-hidden="true" />{t("back")}</Link>} />
      </Panel>
    );
  }
  if (!goal) return null;

  const kids = goal.children ?? [];
  const runs = goal.runs ?? [];

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label={t("path")} className="flex flex-wrap items-center gap-1 text-sm text-ink-2 min-w-0">
        <Link to="/hedefler" className="inline-flex items-center gap-1 hover:text-ink hover:underline underline-offset-2">
          <ArrowLeft size={15} aria-hidden="true" />{t("goals")}
        </Link>
        {(goal.ancestors ?? []).map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 min-w-0">
            <ChevronRight size={14} className="text-muted shrink-0" aria-hidden="true" />
            <Link to={`/hedefler/${encodeURIComponent(a.id)}`} className="truncate max-w-48 hover:text-ink hover:underline underline-offset-2">{a.title}</Link>
          </span>
        ))}
      </nav>

      <PageHeader eyebrow={t("eyebrow", { level: LEVEL_META[goal.level].label })} title={goal.title}
        subtitle={goal.description || undefined}
        meta={<>
          <OwnerChip goal={goal} lookup={lookup} />
          <GoalStatusBadge status={goal.status} />
          <PriorityBadge priority={goal.priority} />
          <DueBadge due={goal.due} status={goal.status} />
        </>}
        actions={<>
          <Button variant="primary" icon={<Play size={16} />} onClick={() => onLaunch(goal)} disabled={goal.status === "cancelled"}>{t("launch")}</Button>
          {goal.status !== "cancelled" && <ScheduleButton target={{ type: "goal", goal_id: goal.id }} title={goal.title} />}
          <Button icon={<Pencil size={15} />} onClick={() => onEdit(goal)}>{t("edit")}</Button>
          <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => setConfirmDelete(true)} aria-label={t("delete_goal")} title={t("delete_goal")} />
        </>} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="flex flex-col gap-4 min-w-0">
          <Panel title={t("key_results")} icon={<ListChecks size={16} />}
            actions={goal.key_results.length > 0 && <Badge>{goal.key_results.filter((k) => k.done).length}/{goal.key_results.length}</Badge>}>
            {goal.key_results.length ? (
              <ul className="flex flex-col gap-3">
                {goal.key_results.map((k) => <KrRow key={k.id} goal={goal} kr={k} onSaved={setGoal} />)}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                {t("no_kr_a")}{kids.length ? t("no_kr_children") : t("no_kr_manual")}{t("no_kr_b")}{" "}
                <button type="button" className="text-link underline underline-offset-2 font-semibold" onClick={() => onEdit(goal)}>{t("add_kr")}</button>
              </p>
            )}
          </Panel>

          <Panel title={t("children")} icon={<GitBranch size={16} />}
            actions={<Button size="sm" icon={<Plus size={14} />} onClick={() => onAddChild(goal)}>{t("child")}</Button>}>
            {kids.length ? (
              <GoalTree goals={kids} lookup={lookup} grouped={false} onLaunch={onLaunch} onAddChild={onAddChild} />
            ) : (
              <p className="text-sm text-muted">{t("no_children")}</p>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <Panel>
            <div className="flex items-center gap-4 pt-4">
              <ProgressRing value={goal.progress} status={goal.status} size={88} />
              <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 min-w-0">
                <dt className="text-muted">{t("created")}</dt><dd className="truncate">{formatDate(goal.created_at)}</dd>
                {goal.due && <><dt className="text-muted">{t("due")}</dt><dd className="truncate">{formatDate(goal.due)}</dd></>}
                {goal.completed_at && <><dt className="text-muted">{t("completed")}</dt><dd className="truncate">{formatDate(goal.completed_at)}</dd></>}
                <dt className="text-muted">{t("default_root")}</dt>
                <dd className="truncate">{goal.default_root ? lookup.agentName(goal.default_root) : <span className="text-muted">{t("none")}</span>}</dd>
              </dl>
            </div>
          </Panel>

          <Panel title={t("linked_runs")} icon={<Workflow size={16} />} actions={runs.length > 0 && <Badge>{runs.length}</Badge>}>
            {runs.length ? (
              <ul className="flex flex-col gap-2">
                {runs.map((r) => (
                  <li key={r.id}>
                    <Link to={`/gorevler/${encodeURIComponent(r.id)}`}
                      className="panel-soft flex items-center gap-2 p-2.5 hover:border-ink-2 transition-colors min-w-0">
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold truncate">{r.title || r.id}</span>
                        <span className="block text-xs text-muted truncate">
                          {r.root_agent ? `${lookup.agentName(r.root_agent)} · ` : ""}{timeAgo(r.started_at)}
                        </span>
                      </span>
                      <StatusPill status={r.status || "pending"} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t("no_runs")}</p>
            )}
          </Panel>
        </div>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} width={460} title={t("delete_q")}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>{t("cancel")}</Button>
          <Button variant="danger" icon={<Trash2 size={15} />} onClick={async () => {
            try {
              await goalsApi.remove(goal.id);
              setConfirmDelete(false);
              void useGoals.getState().refresh();
              navigate(goal.parent ? `/hedefler/${encodeURIComponent(goal.parent)}` : "/hedefler");
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}>{t("delete")}</Button>
        </>}>
        <p className="text-sm text-ink-2">
          <strong className="text-ink">{goal.title}</strong>{t("delete_text", { title: "" })}
          {kids.length > 0 && t("delete_children", { n: kids.length, where: goal.ancestors?.length ? t("to_parent") : t("as_root") })}
          {t("delete_runs_note")}
        </p>
        {error && <p className="text-sm font-semibold text-bad mt-2" role="alert">{error}</p>}
      </Modal>
    </div>
  );
}

function KrRow({ goal, kr, onSaved }: { goal: Goal; kr: KeyResult; onSaved: (g: Goal) => void }) {
  const t = useT(m);
  const [value, setValue] = useState(String(kr.current ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setValue(String(kr.current ?? 0)); }, [kr.current]);

  const save = async (patch: { current?: number; done?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await goalsApi.updateKr(goal.id, kr.id, patch));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const commit = () => {
    const n = Number(value.replace(",", "."));
    if (!Number.isFinite(n)) { setError(t("enter_number")); return; }
    if (n !== kr.current) void save({ current: n });
  };
  const target = kr.target != null ? (kr.unit === "%" ? fmtPercent(kr.target) : `${kr.target}${kr.unit ? ` ${kr.unit}` : ""}`) : null;

  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <span className={clsx("flex-1 min-w-0 text-sm font-semibold break-words", kr.done && "text-ink-2")}>{kr.title}</span>
        {target !== null ? (
          <label className="flex items-center gap-1.5 text-sm text-ink-2">
            <span className="sr-only">{t("kr_current", { title: kr.title })}</span>
            <input className="input !w-24 !py-1 tabular-nums" inputMode="decimal" value={value} disabled={busy}
              onChange={(e) => setValue(e.target.value)} onBlur={commit}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />
            <span className="whitespace-nowrap">/ {target}</span>
          </label>
        ) : null}
        <Button size="sm" variant={kr.done ? "primary" : "default"} icon={<Check size={14} aria-hidden="true" />} disabled={busy}
          aria-pressed={kr.done} onClick={() => save({ done: !kr.done })}>
          {kr.done ? t("kr_completed") : t("kr_complete")}
        </Button>
      </div>
      <ProgressBar value={kr.progress} done={kr.done} label={t("kr_progress", { title: kr.title })} />
      {error && <p className="text-xs font-semibold text-bad" role="alert">{error}</p>}
    </li>
  );
}
