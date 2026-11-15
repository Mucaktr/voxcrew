// Ekip S10 — hedef rozetleri: durum, öncelik, son tarih, düzey/sahip.
import { Building2, CalendarClock, Flag, Loader2, Users } from "lucide-react";
import { useMemo } from "react";
import {
  dueInfo, GOAL_STATUS_META, LEVEL_META, PRIORITY_META, type Goal, type GoalPriority, type GoalStatus,
} from "../../lib/goals";
import { useT } from "../../lib/i18n";
import { teamColor, useOffice, type TeamInfo } from "../../lib/office";
import { useStudio } from "../../lib/store";
import type { Agent } from "../../lib/types";
import { goalsMsg as m } from "../../locales/goals";
import { PixelFace } from "../PixelFace";
import { Badge } from "../ui";

export function GoalStatusBadge({ status }: { status: GoalStatus }) {
  const meta = GOAL_STATUS_META[status] ?? { label: status, tone: "muted" };
  return (
    <Badge tone={meta.tone}>
      {status === "in_progress" && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
      {meta.label}
    </Badge>
  );
}

export function PriorityBadge({ priority, compact }: { priority: GoalPriority; compact?: boolean }) {
  const t = useT(m);
  const meta = PRIORITY_META[priority] ?? PRIORITY_META.medium;
  if (compact && priority === "medium") return null; // varsayılan öncelik ağaçta kalabalık yapmasın
  return <Badge tone={meta.tone} title={t("priority_title", { label: meta.label })}><Flag size={12} aria-hidden="true" /><span className="sr-only">{t("priority_sr")}</span>{meta.label}</Badge>;
}

export function DueBadge({ due, status }: { due: string | null; status: GoalStatus }) {
  const t = useT(m);
  const info = dueInfo(due, status);
  if (!info) return null;
  return (
    <Badge tone={info.tone} title={info.title}>
      <CalendarClock size={12} aria-hidden="true" />
      <span className="sr-only">{info.label === info.date ? t("due_sr") : t("due_sr_date", { date: info.date })}</span>{info.label}
    </Badge>
  );
}

/** Ekip ve ajan adlarını slug'dan çözmek için (seçiciler kararlı dizi döndürür, haritalar useMemo ile). */
export function useOwnerLookup() {
  const agents = useStudio((s) => s.agents);
  const teams = useOffice((s) => s.teams);
  return useMemo(() => {
    const agentMap = new Map<string, Agent>(agents.map((a) => [a.slug, a]));
    const teamMap = new Map<string, TeamInfo>(teams.map((x) => [x.slug, x]));
    return {
      agents, teams,
      agent: (slug?: string | null) => (slug ? agentMap.get(slug) ?? null : null),
      team: (slug?: string | null) => (slug ? teamMap.get(slug) ?? null : null),
      agentName: (slug?: string | null) => (slug ? agentMap.get(slug)?.name ?? slug : ""),
      teamName: (slug?: string | null) => (slug ? teamMap.get(slug)?.name ?? slug : ""),
      color: (slug?: string | null) => teamColor(slug, teams),
    };
  }, [agents, teams]);
}

export type OwnerLookup = ReturnType<typeof useOwnerLookup>;

/** Düzey + sahip: şirket simgesi, ekip renk noktası ya da ajanın piksel yüzü. */
export function OwnerChip({ goal, lookup }: { goal: Pick<Goal, "level" | "owner_team" | "owner_agent">; lookup: OwnerLookup }) {
  const t = useT(m);
  if (goal.level === "agent" && goal.owner_agent) {
    const a = lookup.agent(goal.owner_agent);
    return (
      <Badge title={t("agent_goal_title", { name: lookup.agentName(goal.owner_agent) })}>
        <PixelFace avatar={a?.avatar} size={18} />
        <span className="sr-only">{t("agent_goal_sr")}</span>
        <span className="truncate max-w-40">{lookup.agentName(goal.owner_agent)}</span>
      </Badge>
    );
  }
  if (goal.level === "team" || goal.owner_team) {
    const name = lookup.teamName(goal.owner_team);
    const level = LEVEL_META[goal.level].label;
    return (
      <Badge title={name ? t("level_goal_title_named", { level, name }) : t("level_goal_title", { level })}>
        {goal.owner_team
          ? <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: lookup.color(goal.owner_team) }} aria-hidden="true" />
          : <Users size={12} aria-hidden="true" />}
        <span className="sr-only">{t("level_goal_sr", { level })}</span>
        <span className="truncate max-w-40">{name || level}</span>
      </Badge>
    );
  }
  return <Badge title={t("company_goal")}><Building2 size={12} aria-hidden="true" />{t("company")}</Badge>;
}
