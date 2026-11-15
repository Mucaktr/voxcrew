// Ekip S12: tam profilin yan sütunu — kariyer kartı (S5 lib/game.ts), organizasyondaki yer ve son görevler.
import { ListChecks, Network, Pencil, Send, Sparkles, Trophy } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { agentRuns, orgOf, rankConflict, rankLabel } from "../../lib/agents";
import { timeAgo } from "../../lib/format";
import { useGameAgent, useGameEnabled } from "../../lib/game";
import { fmtNumber, fmtPercent, useT } from "../../lib/i18n";
import type { TeamInfo } from "../../lib/office";
import type { Agent, Run } from "../../lib/types";
import { agentsMsg as m } from "../../locales/agents";
import { Note } from "../hermes/common";
import { PixelFace } from "../PixelFace";
import { Button, Panel, StatusPill } from "../ui";
import { RankBadge, TeamChip } from "./common";

const linkCls = "text-sm text-link font-semibold hover:underline underline-offset-2";

// ---------------------------------------------------------------------- kariyer
export function CareerCard({ agent }: { agent: Agent }) {
  const t = useT(m);
  const enabled = useGameEnabled();
  const game = useGameAgent(agent.slug);
  const pct = game ? Math.round(Math.max(0, Math.min(1, game.progress)) * 100) : 0;
  return (
    <Panel title={t("career")} icon={<Trophy size={16} />}
      actions={<Link to="/basarilar" className={linkCls}>{t("achievements")}</Link>}>
      {!enabled ? (
        <p className="text-sm text-muted leading-relaxed">{t("career_off")}</p>
      ) : !game ? (
        <p className="text-sm text-muted leading-relaxed">{t("career_empty", { name: agent.name })}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="grid place-items-center h-14 w-14 shrink-0 rounded-xl border-2 border-line bg-gold text-[var(--on-gold)] shadow-[0_3px_0_var(--shadow)]">
              <span className="flex flex-col items-center leading-none">
                <span className="text-xs font-semibold">{t("level_short")}</span>
                <span className="t-h3 num">{game.level}</span>
              </span>
            </span>
            <div className="min-w-0">
              <div className="t-h4 truncate flex items-center gap-1.5"><Sparkles size={15} className="text-warn shrink-0" aria-hidden />{game.title}</div>
              {game.rank && <div className="text-xs text-muted">{rankLabel(game.rank) || game.rank}</div>}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-muted num">
              <span>{t("xp", { n: fmtNumber(game.xp) })}</span>
              <span>{t("xp_next", { n: fmtNumber(game.xpToNext) })}</span>
            </div>
            <div className="h-2.5 rounded-full bg-panel-3 overflow-hidden border border-line-soft" role="meter"
              aria-label={t("level_progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={fmtPercent(pct)}>
              <div className="h-full bg-grass transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------- organizasyon
export function PersonLink({ agent, fallback }: { agent?: Agent | null; fallback?: string }) {
  if (!agent) return <span className="text-sm text-ink-2 font-mono break-all">{fallback ?? "—"}</span>;
  return (
    <Link to={`/ajanlar/${encodeURIComponent(agent.slug)}`}
      className="inline-flex items-center gap-2 min-w-0 max-w-full rounded-lg hover:underline underline-offset-2 text-sm font-semibold">
      <PixelFace avatar={agent.avatar} size={26} ring={agent.color} />
      <span className="truncate">{agent.name}</span>
      {rankLabel(agent.rank) && <span className="text-xs text-muted font-medium truncate">· {rankLabel(agent.rank)}</span>}
    </Link>
  );
}

export function OrgCard({ agent, agents, teams, runList, onEdit }:
  { agent: Agent; agents: Agent[]; teams: TeamInfo[]; runList: Run[]; onEdit: () => void }) {
  const t = useT(m);
  const { manager, reports } = useMemo(() => orgOf(agents, agent.slug), [agents, agent.slug]);
  const team = agent.team ? teams.find((x) => x.slug === agent.team) ?? null : null;
  const hirer = agent.hired_by ? agents.find((a) => a.slug === agent.hired_by) ?? null : null;
  const hireRun = agent.hired_in_run ? runList.find((r) => r.id === agent.hired_in_run) ?? null : null;
  const leads = team?.lead === agent.slug;
  return (
    <Panel title={t("org_card")} icon={<Network size={16} />}
      actions={<Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={onEdit} aria-label={t("org_edit")}>{t("edit")}</Button>}>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2.5 items-center text-sm">
        <dt className="text-muted font-medium">{t("rank")}</dt>
        <dd className="min-w-0">{rankLabel(agent.rank) ? <RankBadge rank={agent.rank} /> : <span className="text-ink-2">{t("rank_none")}</span>}</dd>
        <dt className="text-muted font-medium">{t("team")}</dt>
        <dd className="min-w-0 flex flex-wrap items-center gap-1.5">
          {team ? <Link to={`/ofis#ekip-${team.slug}`} className="max-w-full hover:underline underline-offset-2"><TeamChip team={team} /></Link> : <TeamChip team={null} />}
          {leads && <span className="chip tone-ok">{t("team_lead")}</span>}
        </dd>
        <dt className="text-muted font-medium">{t("manager")}</dt>
        <dd className="min-w-0">{agent.reports_to ? <PersonLink agent={manager} fallback={agent.reports_to} /> : <span className="text-ink-2">{t("manager_you")}</span>}</dd>
        {agent.hired_by && (
          <>
            <dt className="text-muted font-medium">{t("hired_by")}</dt>
            <dd className="min-w-0 flex flex-col gap-1">
              <PersonLink agent={hirer} fallback={agent.hired_by} />
              {agent.hired_in_run && (
                <Link to={`/gorevler/${encodeURIComponent(agent.hired_in_run)}`} className="text-xs text-link font-semibold hover:underline underline-offset-2 truncate">
                  {t("hire_run", { title: hireRun?.title ?? `#${agent.hired_in_run.slice(0, 8)}` })}
                </Link>
              )}
            </dd>
          </>
        )}
      </dl>
      {manager && rankConflict(agent.rank, manager.rank) && (
        <Note tone="warn" className="mt-3">{t("org_conflict", { name: manager.name })}</Note>
      )}
      <h3 className="panel-title mt-4 mb-2">{t("reports")} <span className="num text-muted font-medium">({reports.length})</span></h3>
      {reports.length === 0 ? (
        <p className="text-sm text-muted">{t("reports_none")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
          {reports.map((r) => <li key={r.slug} className="min-w-0"><PersonLink agent={r} /></li>)}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------- son görevler
export function RecentRunsCard({ agent, runList, onAll, onTask }:
  { agent: Agent; runList: Run[]; onAll: () => void; onTask: () => void }) {
  const t = useT(m);
  const runs = useMemo(() => agentRuns(runList, agent.slug).slice(0, 5), [runList, agent.slug]);
  return (
    <Panel title={t("recent_runs")} icon={<ListChecks size={16} />}
      actions={runs.length > 0 ? <Button size="sm" variant="ghost" onClick={onAll}>{t("all")}</Button> : undefined}>
      {runs.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted">{t("recent_empty", { name: agent.name })}</p>
          {!agent.hidden && <Button size="sm" icon={<Send size={14} />} onClick={onTask}>{t("first_task")}</Button>}
        </div>
      ) : <RunRows runs={runs} />}
    </Panel>
  );
}

export function RunRows({ runs, slug }: { runs: Run[]; slug?: string }) {
  const t = useT(m);
  return (
    <ul className="flex flex-col gap-1.5">
      {runs.map((r) => {
        const mine = slug ? r.steps.filter((s) => s.agent === slug).length : 0;
        return (
          <li key={r.id}>
            <Link to={`/gorevler/${encodeURIComponent(r.id)}`} className="flex items-center gap-2 panel-soft px-3 py-2 hover:border-ink-2 transition-colors min-w-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{r.title}</span>
                <span className="block text-xs text-muted num truncate">
                  {timeAgo(r.started_at)}
                  {r.kind === "workflow" ? t("run_workflow") : r.kind === "delegation" ? t("run_delegation") : ""}
                  {slug && mine > 0 && r.steps.length > 1 ? t("run_steps_mine", { mine, total: r.steps.length }) : ""}
                </span>
              </span>
              <StatusPill status={r.status} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
