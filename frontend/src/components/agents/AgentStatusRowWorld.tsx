// DASH-MVP Dünya yan sütunundaki ajan satırı (eski WorldPage TeamRow, görsel olarak değişmedi). Ortak sözleşme ve
// Pano görünümü: AgentStatusRow.tsx.
import clsx from "clsx";
import { ExternalLink, Send } from "lucide-react";
import { memo } from "react";
import { Link } from "react-router-dom";
import { PixelFace } from "../PixelFace";
import { Badge, Button, CONN_ICON } from "../ui";
import { AgentLevelChip } from "../game/AgentLevelChip";
import { PhasePipeline } from "../world/PhasePipeline";
import { fmtElapsed } from "../world/activity";
import { useT } from "../../lib/i18n";
import { MOOD_LABEL } from "../../lib/format";
import { shortTitle } from "../../lib/office";
import { world as M } from "../../locales/world";
import { MOOD_TONE, sameRowProps, type AgentStatusRowProps } from "./AgentStatusRow";

export const WorldAgentStatusRow = memo(function WorldAgentStatusRow({ a, mood, avOk, avReason, activity, teamName, teamColor, work, selected, onPick, onTask }: AgentStatusRowProps) {
  const t = useT(M);
  return (
    <li className={clsx("rounded-xl p-2 border-2 transition-colors",
      selected ? "border-line bg-panel-2" : a.hidden ? "border-dashed border-line-soft hover:bg-panel-2" : "border-transparent hover:bg-panel-2")}>
      <div className="flex items-center gap-2.5">
        <button type="button" className="flex items-center gap-2.5 min-w-0 flex-1 text-left rounded-lg focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          onClick={() => onPick(a.slug)} aria-label={t("page_agent_aria", { name: a.name, mood: MOOD_LABEL[mood] })}>
          <PixelFace avatar={a.avatar} mood={mood} size={44} ring={a.color} className={clsx(a.hidden && "opacity-60")} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 min-w-0">
              {teamName && <span className="h-2.5 w-2.5 rounded-[3px] border border-line shrink-0" style={{ background: teamColor }} title={t("page_team_title", { team: teamName })} />}
              <span className="font-semibold text-sm truncate">{a.name}</span>
              <AgentLevelChip slug={a.slug} size={20} />
              {/* S39: 360 px'lik sağ sütunda (xl) unvan adı kesiyordu ("Fı…"); orada unvan üzerine gelince kartında */}
              {a.title && <span className="text-xs text-ink-2 truncate hidden sm:inline xl:hidden">· {shortTitle(a.title)}</span>}
              <Badge tone={MOOD_TONE(mood)} className="!px-1.5">{MOOD_LABEL[mood]}</Badge>
            </span>
            <span className="text-xs text-muted truncate flex items-center gap-1">
              {a.route && CONN_ICON[a.route.connection]}
              {avOk ? (activity && mood !== "idle" ? activity : a.route?.label) : avReason}
            </span>
          </span>
        </button>
        {work?.runId && (
          <Link to={`/gorevler/${work.runId}`} className="btn btn-sm btn-icon" aria-label={t("page_open_task_aria", { name: a.name })} title={t("page_open_task")}>
            <ExternalLink size={14} aria-hidden="true" />
          </Link>
        )}
        <Button size="sm" icon={<Send size={14} />} aria-label={t("page_task_for", { name: a.name })} onClick={() => onTask(a.slug)} />
      </div>
      {work && (
        <div className="mt-1.5 pl-[54px] flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          <PhasePipeline states={work.states} tool={work.tool} />
          <span className="text-xs text-ink-2 truncate min-w-0 flex-1">
            {work.label}{work.step ? ` · ${t("page_step", { a: work.step, b: work.steps })}` : ""}
          </span>
          {work.since && !work.finished && (
            <span className="text-xs text-muted num" data-since={work.since}>{fmtElapsed(Date.now() - work.since)}</span>
          )}
          {work.awaiting && <Badge tone="warn" className="!px-1.5">{t("page_awaiting")}</Badge>}
        </div>
      )}
    </li>
  );
}, sameRowProps);
