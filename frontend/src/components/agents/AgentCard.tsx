// Ekip S12: /ajanlar ızgarasındaki ajan kartı. Kartın tamamı profile gider (uzatılmış bağlantı);
// "Görev ver" düğmesi bağlantının üstünde ayrı bir odak hedefidir (iç içe etkileşimli öğe yok).
import clsx from "clsx";
import { BookOpen, Send } from "lucide-react";
import { Link } from "react-router-dom";
import { useT } from "../../lib/i18n";
import type { TeamInfo } from "../../lib/office";
import type { Agent, Mood } from "../../lib/types";
import { agentsMsg as m } from "../../locales/agents";
import { AgentLevelChip } from "../game/AgentLevelChip";
import { WeeklyPickBadge } from "../game/album/WeeklyPickBadge";
import { MoodIndicator, ThankButton } from "../../full/ui";
import { PixelFace } from "../PixelFace";
import { Button } from "../ui";
import { BrainBadge, HiddenBadge, HiredBadge, RankBadge, StatusBadge, TeamChip } from "./common";

export function AgentCard({ agent, mood, avail, activity, team, onTask }: {
  agent: Agent; mood: Mood; avail: { ok: boolean; reason?: string }; activity?: string; team?: TeamInfo | null;
  onTask: () => void;
}) {
  const t = useT(m);
  const skills = agent.skills?.length ?? 0;
  const busy = mood === "thinking" || mood === "working" || mood === "waiting";
  return (
    <article className={clsx("panel relative flex flex-col gap-3 p-4 min-w-0 transition-transform hover:-translate-y-0.5",
      agent.hidden && "border-dashed")}>
      <div className="flex items-start gap-3 min-w-0">
        <PixelFace avatar={agent.avatar} mood={mood} size={64} ring={agent.color} className={clsx(agent.hidden && "opacity-60")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <h2 className="panel-title truncate">
              <Link to={`/ajanlar/${encodeURIComponent(agent.slug)}`}
                className="rounded-sm after:absolute after:inset-0 after:rounded-xl">
                {agent.name}
              </Link>
            </h2>
            <AgentLevelChip slug={agent.slug} />
          </div>
          <p className="text-sm text-ink-2 truncate" title={agent.title || agent.role || undefined}>
            {agent.title || agent.role || t("no_title")}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <RankBadge rank={agent.rank} />
            <StatusBadge mood={mood} />
            <HiredBadge agent={agent} />
            <WeeklyPickBadge slug={agent.slug} />
            <HiddenBadge agent={agent} />
            <MoodIndicator slug={agent.slug} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 min-w-0">
        <TeamChip team={team} />
        <BrainBadge agent={agent} />
        {skills > 0 && (
          <span className="chip" title={(agent.skills ?? []).join(", ")}><BookOpen size={12} aria-hidden />{t("skills_n", { n: skills })}</span>
        )}
      </div>

      {!avail.ok ? (
        <p className="text-xs font-semibold text-bad line-clamp-2">{avail.reason}</p>
      ) : busy && activity ? (
        <p className="text-xs text-ink-2 truncate" title={activity}>{activity}</p>
      ) : null}

      <div className="mt-auto flex items-center gap-2 pt-1">
        <Button size="sm" icon={<Send size={14} />} className="relative z-10" onClick={onTask} disabled={agent.hidden}
          aria-label={t("give_task_to", { name: agent.name })} title={agent.hidden ? t("hidden_no_task") : undefined}>
          {t("give_task")}
        </Button>
        <ThankButton agent={agent} size="sm" variant="ghost" compact className="relative z-10" />
        <span aria-hidden className="ml-auto text-xs font-semibold text-link">{t("open_profile")}</span>
      </div>
    </article>
  );
}
