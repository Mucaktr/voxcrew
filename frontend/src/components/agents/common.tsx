// Ekip S12: ajan listesi ve tam profilin paylaştığı küçük rozetler.
import { AlertTriangle, EyeOff, Feather, Medal, UserPlus } from "lucide-react";
import { rankLabel, rankTone } from "../../lib/agents";
import { CONNECTION_META, MOOD_LABEL } from "../../lib/format";
import { useT } from "../../lib/i18n";
import type { TeamInfo } from "../../lib/office";
import type { Agent, Mood } from "../../lib/types";
import { agentsMsg as m } from "../../locales/agents";
import { Badge, CONN_ICON } from "../ui";

export function moodTone(mood: Mood): string {
  if (mood === "idle" || mood === "done") return "ok";
  if (mood === "error" || mood === "offline") return "bad";
  if (mood === "waiting") return "warn";
  return "info";
}

export function StatusBadge({ mood }: { mood: Mood }) {
  return <Badge tone={moodTone(mood)}>{MOOD_LABEL[mood]}</Badge>;
}

export function RankBadge({ rank }: { rank?: string | null }) {
  const t = useT(m);
  const label = rankLabel(rank);
  if (!label) return null;
  return <Badge tone={rankTone(rank)} title={t("badge_rank")}><Medal size={12} aria-hidden />{label}</Badge>;
}

export function HiredBadge({ agent }: { agent: Agent }) {
  const t = useT(m);
  if (!agent.hired_by) return null;
  return <Badge tone="info" title={t("badge_hired_title")}><UserPlus size={12} aria-hidden />{t("badge_hired")}</Badge>;
}

export function HiddenBadge({ agent }: { agent: Agent }) {
  const t = useT(m);
  if (!agent.hidden) return null;
  return <Badge title={t("badge_hidden_title")}><EyeOff size={12} aria-hidden />{t("badge_hidden")}</Badge>;
}

/** Ekip rengi + adı; ekipsizse "Lobi". */
export function TeamChip({ team }: { team?: TeamInfo | null }) {
  const t = useT(m);
  return (
    <span className="chip max-w-full" title={team ? t("team_title", { name: team.name }) : t("team_none_title")}>
      <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] border border-line shrink-0"
        style={{ background: team?.color ?? "transparent" }} />
      <span className="truncate">{team?.name ?? t("lobby")}</span>
    </span>
  );
}

/** Beyin ve rota özeti: Hermes profili, bağlantı simgesi, model; rota hatası kırmızı. */
export function BrainBadge({ agent }: { agent: Agent }) {
  const t = useT(m);
  // hazır beyin bulunamadan doğan ajan — "rota hatası" değil, yapılacak iş: beyin seç
  if (agent.needs_brain) {
    return <Badge tone="warn" title={t("no_brain_hint")}><AlertTriangle size={12} aria-hidden />{t("pick_brain")}</Badge>;
  }
  if (agent.route_error) {
    return <Badge tone="bad" title={agent.route_error}><AlertTriangle size={12} aria-hidden />{t("route_error")}</Badge>;
  }
  const conn = agent.route?.connection ?? agent.connection;
  const meta = CONNECTION_META[conn];
  const viaHermes = agent.runtime === "hermes";
  const model = agent.route?.model || agent.model;
  return (
    <span className="chip max-w-full" title={agent.route?.label ?? meta?.label}>
      {viaHermes && <Feather size={12} aria-hidden className="text-accent" />}
      {CONN_ICON[conn] && <span aria-hidden className="flex [&>svg]:h-3 [&>svg]:w-3">{CONN_ICON[conn]}</span>}
      <span className="truncate">
        {viaHermes ? `Hermes · ${agent.hermes_profile ?? "default"}` : meta?.short ?? conn}
        {viaHermes && conn !== "profile" ? ` · ${meta?.short ?? conn}` : ""}
        {!viaHermes && model ? ` · ${model}` : ""}
      </span>
    </span>
  );
}
