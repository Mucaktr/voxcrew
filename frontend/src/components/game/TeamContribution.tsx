// Ekip katkısı (Kariyer) — kullanıcı kararı C-02, seçenek A: ajanlar SIRALANMAZ. Üstte ekip toplamı, altta ajanlar ada göre;
// her satırda kanıt (biten adım, ilk turda onay) ve XP. Yalnızca kullanıcının kendi ajanları, bu cihazda.
import { Users } from "lucide-react";
import { useState } from "react";
import { gameApi, type ContributionData } from "../../lib/game";
import { fmtNumber, useT } from "../../lib/i18n";
import { spotlight as S } from "../../locales/game";
import { Panel, Spinner } from "../ui";
import { LevelRing } from "./AgentLevelChip";
import { useGameData } from "./useGameData";

export function TeamContribution() {
  const t = useT(S);
  const [period, setPeriod] = useState<"week" | "all">("week");
  const { data, loading, error } = useGameData<ContributionData>(() => gameApi.contribution(period), [period]);
  const items = (data?.items ?? []).filter((i) => period === "all" || i.xp > 0 || i.steps > 0);
  const team = data?.team;
  return (
    <Panel title={t("lb_title")} icon={<Users size={16} />} className="self-start w-full">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">{t("lb_hint")}</p>
        <div className="seg self-start" role="group" aria-label={t("lb_period")}>
          {(["week", "all"] as const).map((p) => (
            <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>{t(p === "week" ? "lb_week" : "lb_all")}</button>
          ))}
        </div>
        {team && (
          <div className="panel-soft p-3 flex flex-wrap items-center gap-x-4 gap-y-1" aria-label={t("lb_team_aria")}>
            <span className="text-sm font-semibold text-ink">{t("lb_team")}</span>
            <span className="num text-sm text-ink">{fmtNumber(team.xp)} XP</span>
            <span className="text-xs text-muted">{t("lb_team_row", { steps: team.steps, first: team.first_try, agents: team.agents })}</span>
          </div>
        )}
        {loading && !data ? <div className="grid place-items-center py-6"><Spinner size={20} /></div>
          : error && !data ? <p className="text-sm text-bad" role="alert">{error}</p>
          : items.length ? (
            <ul className="flex flex-col gap-1" aria-label={t("lb_list")}>
              {items.map((i) => (
                <li key={i.slug} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 min-w-0">
                  <LevelRing level={i.level} size={24} label={t("badge_aria", { level: i.level, title: i.title })} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold truncate">{i.name}</span>
                    <span className="block text-xs text-muted truncate">{t("lb_row", { steps: i.steps, first: i.first_try })}</span>
                  </span>
                  <span className="num text-sm text-ink-2 shrink-0">{fmtNumber(i.xp)} XP</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">{t("lb_empty")}</p>}
      </div>
    </Panel>
  );
}
