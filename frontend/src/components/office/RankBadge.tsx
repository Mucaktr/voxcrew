// Ekip S6 — rütbe rozeti (Genel Müdür … Stajyer) ve "işe alındı" rozeti.
import { Award, Crown, UserPlus } from "lucide-react";
import { useT } from "../../lib/i18n";
import { officeMsg as m } from "../../locales/office";
import { Badge } from "../ui";
import { RANK_LABELS, RANK_SHORT, isRank, rankIndex, rankTone } from "./hierarchy";

export function RankBadge({ rank, short, className }: { rank?: string | null; short?: boolean; className?: string }) {
  const t = useT(m);
  if (!isRank(rank)) return null;
  const top = rankIndex(rank) <= 1;
  return (
    <Badge tone={rankTone(rank)} className={className} title={t("rank_title", { rank: RANK_LABELS[rank] })}>
      {top ? <Crown size={12} aria-hidden /> : <Award size={12} aria-hidden />}
      <span>{short ? RANK_SHORT[rank] : RANK_LABELS[rank]}</span>
    </Badge>
  );
}

export function HiredBadge({ by, className }: { by?: string | null; className?: string }) {
  const t = useT(m);
  if (!by) return null;
  return (
    <Badge tone="info" className={className} title={t("hired_title", { by })}>
      <UserPlus size={12} aria-hidden /><span>{t("hired")}</span>
    </Badge>
  );
}
