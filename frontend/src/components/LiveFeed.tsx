import clsx from "clsx";
import { AlertTriangle, Brain, CheckCircle2, Hand, Play, Wrench, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { timeAgo } from "../lib/format";
import { useT } from "../lib/i18n";
import { feedText, useStudio, type FeedItem } from "../lib/store";
import { feedMsg } from "../locales/feed";
import { PixelFace } from "./PixelFace";
import { Empty } from "./ui";

const ICON: Record<FeedItem["kind"], ReactNode> = {
  start: <Play size={13} />, tool: <Wrench size={13} />, done: <CheckCircle2 size={13} />, error: <AlertTriangle size={13} />,
  memory: <Brain size={13} />, approval: <Hand size={13} />, run: <Zap size={13} />,
};
const TONE: Record<FeedItem["kind"], string> = {
  start: "text-info", tool: "text-ink-2", done: "text-ok", error: "text-bad", memory: "text-accent", approval: "text-warn", run: "text-teal",
};

export function LiveFeed({ limit = 14 }: { limit?: number }) {
  const t = useT(feedMsg);
  const feed = useStudio((s) => s.feed);
  const agents = useStudio((s) => s.agents);
  if (!feed.length)
    return <Empty title={t("empty_title")} text={t("empty_text")} />;
  return (
    <ol className="flex flex-col gap-1.5">
      {feed.slice(0, limit).map((f) => {
        const a = agents.find((x) => x.slug === f.agent);
        return (
          <li key={f.id} className="anim-rise">
            <Link to={f.run_id ? `/gorevler/${f.run_id}` : "#"}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-panel-2 transition-colors">
              {a ? <PixelFace avatar={a.avatar} size={26} /> : <span className={clsx("w-[26px] grid place-items-center", TONE[f.kind])}>{ICON[f.kind]}</span>}
              <span className={clsx("shrink-0", TONE[f.kind])}>{a && ICON[f.kind]}</span>
              <span className="text-dense flex-1 min-w-0 truncate">{feedText(f)}</span>
              <span className="text-xs text-muted shrink-0 num">{timeAgo(f.ts)}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
