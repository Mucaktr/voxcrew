// Sezon yolu (/basarilar/sezon) ve kompakt sezon şeridi (görev panosu).
// Etik: para düğmesi yok (premium "pakete dahil" ya da "yakında"), geri sayım yok (yalnız
// dürüst bitiş TARİHİ), seri yok, ajan sıralaması yok. SP yalnız gerçek işten; kaynak tablosu açıkça gösterilir.
import clsx from "clsx";
import {
  Archive, ArrowRight, Award, Check, Coffee, Coins, Crown, Gift, Hourglass, Lock, MountainSnow, PartyPopper, Shirt,
  Signpost, Snowflake,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { fmtNumber, useT } from "../../lib/i18n";
import {
  seasonApi, seasonDate, type CollectionData, type SeasonData, type SeasonReward, type SeasonRewardKind,
} from "../../lib/season";
import { season as m } from "../../locales/game";
import { Badge, Empty, Panel, Spinner } from "../ui";
import { useGameData } from "./useGameData";

const KIND_ICON: Record<SeasonRewardKind, ReactNode> = {
  coins: <Coins size={15} aria-hidden />, badge: <Award size={15} aria-hidden />, desk: <Coffee size={15} aria-hidden />,
  outfit: <Shirt size={15} aria-hidden />, celebration: <PartyPopper size={15} aria-hidden />,
  sign: <Signpost size={15} aria-hidden />, scene: <MountainSnow size={15} aria-hidden />,
};
const KIND_KEY = {
  coins: "ss_kind_coins", badge: "ss_kind_badge", desk: "ss_kind_desk", outfit: "ss_kind_outfit",
  celebration: "ss_kind_celebration", sign: "ss_kind_sign", scene: "ss_kind_scene",
} as const;

function useSeason() {
  return useGameData<SeasonData>(() => seasonApi.season(), []);
}

function Meter({ value, max, label, className }: { value: number; max: number; label: string; className?: string }) {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}
      aria-valuetext={`${fmtNumber(Math.min(value, max))} / ${fmtNumber(max)}`}
      className={clsx("h-2.5 rounded-full border-2 border-line-soft bg-panel-3 overflow-hidden", className)}>
      <div className="h-full bg-grass" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ------------------------------------------------------------------ kompakt şerit
export function SeasonStrip() {
  const t = useT(m);
  const { data } = useSeason();
  if (!data || data.status === "upcoming") return null;
  const s = data.season;
  const total = data.tiers * data.tier_sp;
  return (
    <section aria-label={t("ss_strip_aria")} className="panel px-3.5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
      <span className="flex items-center gap-1.5 font-display font-semibold text-sm text-ink min-w-0">
        <Snowflake size={15} aria-hidden className="shrink-0 text-ink-2" />
        <span className="truncate">{t("ss_title", { n: s.number, name: s.name })}</span>
      </span>
      {data.status === "active" ? (
        <>
          <span className="text-xs text-ink-2 num">{t("ss_tier", { tier: data.tier ?? 0, tiers: data.tiers })} · {t("ss_sp", { sp: fmtNumber(data.sp ?? 0) })}</span>
          <Meter value={data.sp ?? 0} max={total} label={t("ss_progress_aria", { sp: data.sp ?? 0, total })} className="flex-1 min-w-[6rem]" />
          <span className="text-xs text-muted">{t("ss_ends", { date: seasonDate(s.ends_on) })}</span>
        </>
      ) : <span className="text-xs text-ink-2">{t("ss_status_ended")}</span>}
      <Link to="/basarilar/sezon" className="btn btn-sm btn-ghost"><ArrowRight size={14} aria-hidden />{t("ss_strip_link")}</Link>
    </section>
  );
}

// ------------------------------------------------------------------ sezon sekmesi
export function SeasonTrack() {
  const t = useT(m);
  const { data, error, loading } = useSeason();
  if (loading && !data) return <div className="grid place-items-center py-16"><Spinner size={24} /></div>;
  if (error && !data) return <p className="text-sm text-bad" role="alert">{error}</p>;
  if (!data) return null;
  const s = data.season;
  const total = data.tiers * data.tier_sp;
  const tier = data.tier ?? 0;
  const rows = (data.track ?? []).filter((r) => r.free || r.premium);

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="flex flex-col gap-3 pt-4">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
            <Snowflake size={22} aria-hidden className="text-ink-2 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h2 className="t-h3">{t("ss_title", { n: s.number, name: s.name })}</h2>
              <p className="text-sm text-ink-2">{s.theme}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {data.status === "active" && s.week && <Badge tone="info">{t("ss_week", { week: s.week, weeks: s.weeks })}</Badge>}
              {data.status === "ended" && <Badge>{t("ss_status_ended")}</Badge>}
              {data.status === "upcoming" && <Badge>{t("ss_status_upcoming", { date: seasonDate(s.starts_on) })}</Badge>}
            </div>
          </div>
          {/* Dürüst bitiş tarihi: geri sayım ya da "son şans" yok */}
          <p className="text-xs text-muted">{t("ss_dates", { start: seasonDate(s.starts_on), end: seasonDate(s.ends_on), weeks: s.weeks })}</p>
          {data.status !== "upcoming" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-display font-semibold text-ink num">{t("ss_tier", { tier, tiers: data.tiers })}</span>
                <span className="text-sm text-ink-2 num">{t("ss_sp", { sp: fmtNumber(data.sp ?? 0) })}</span>
                <span className="text-xs text-muted">
                  {tier >= data.tiers ? t("ss_done") : data.next_tier_sp != null && t("ss_next", { need: fmtNumber(data.next_tier_sp - (data.sp ?? 0)) })}
                </span>
              </div>
              <Meter value={data.sp ?? 0} max={total} label={t("ss_progress_aria", { sp: data.sp ?? 0, total })} />
              <p className="text-xs text-ink-2 num">{t("ss_weekly", { used: data.weekly.used, cap: data.weekly.cap })}</p>
            </div>
          )}
          <p className="text-sm text-ink-2 max-w-3xl">{t("ss_intro")}</p>
        </div>
      </Panel>

      {rows.length > 0 && (
        <section aria-label={t("ss_track_label")} className="panel overflow-hidden">
          <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)] sm:grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 sm:gap-x-3 px-3 sm:px-4 py-2.5 border-b-2 border-line-soft items-end">
            <span className="text-xs font-semibold text-muted">#</span>
            <h3 className="section-title !mb-0">{t("ss_free_track")}</h3>
            <div className="min-w-0 flex flex-col gap-1">
              <h3 className="section-title !mb-0 flex items-center gap-1"><Crown size={14} aria-hidden className="shrink-0" />{t("ss_premium_track")}</h3>
              <PremiumStatus data={data} />
            </div>
          </div>
          <ol className="divide-y-2 divide-line-soft">
            {rows.map((r) => (
              <li key={r.tier} className={clsx("grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)] sm:grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 sm:gap-x-3 px-3 sm:px-4 py-2.5 items-center",
                !r.reached && "bg-panel-2")}>
                <span className={clsx("chip num justify-center", r.reached ? "tone-ok" : "tone-muted")}>{r.tier}</span>
                <RewardCell reward={r.free} track={t("ss_free_track")} reached={r.reached} />
                <RewardCell reward={r.premium} track={t("ss_premium_track")} reached={r.reached}
                  preview={data.premium.view_only} premium />
              </li>
            ))}
          </ol>
          <p className="px-3 sm:px-4 py-2.5 text-xs text-muted border-t-2 border-line-soft">{t("ss_premium_note")}</p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("ss_sources_title")}>
          <ul className="flex flex-col gap-1.5">
            {data.sources.map((x) => (
              <li key={x.source} className="flex items-baseline gap-2 text-sm">
                <span className="flex-1 min-w-0 text-ink">{x.label}</span>
                <span className="num text-ink-2 shrink-0">{t("ss_source_row", { sp: x.sp })}</span>
                {x.daily_cap != null && <span className="text-xs text-muted shrink-0">{t("ss_daily_cap", { n: x.daily_cap })}</span>}
              </li>
            ))}
          </ul>
          {data.recent.length > 0 && (
            <>
              <h3 className="section-title mt-4">{t("ss_recent_title")}</h3>
              <ul className="flex flex-col gap-1 text-xs">
                {data.recent.map((x, i) => (
                  <li key={`${x.ts}-${i}`} className="flex gap-2">
                    <span className="flex-1 min-w-0 truncate text-ink-2">{x.label}</span>
                    <span className="num text-ink">+{x.amount} SP</span>
                    {x.amount < x.raw && <span className="text-muted">{t("ss_capped")}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title={t("ss_late_title")} icon={<Hourglass size={16} />}>
            <p className="text-xs text-ink-2 mb-2">{t("ss_late_note")}</p>
            {data.latecomer.length ? (
              <ul className="flex flex-col gap-2">
                {data.latecomer.map((x) => (
                  <li key={x.item} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="flex-1 min-w-0 truncate text-ink">{x.label}</span>
                      {x.status === "done" ? <span className="chip tone-ok"><Check size={12} aria-hidden />{t("ss_late_done")}</span>
                        : x.status === "pending" ? <span className="chip tone-muted">{t("ss_late_pending")}</span>
                        : <span className="text-xs num text-ink-2">{t("ss_late_row", { progress: x.progress, target: x.target })}</span>}
                    </div>
                    {x.status === "active" && <Meter value={x.progress} max={x.target} label={t("ss_late_aria", { label: x.label })} />}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">{t("ss_late_empty")}</p>}
          </Panel>
          <Panel title={t("ss_archive_title")} icon={<Archive size={16} />}>
            <p className="text-xs text-ink-2 mb-2">{t("ss_archive_note")}</p>
            {data.archive.length ? data.archive.map((a) => (
              <div key={a.season} className="flex flex-col gap-1.5 mb-2">
                <h3 className="text-sm font-semibold text-ink">{a.name}</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {a.items.map((it) => (
                    <li key={it.item} className={clsx("chip", it.owned ? "tone-ok" : "tone-muted")}>
                      {KIND_ICON[it.kind]}{it.label}{it.owned && <Check size={12} aria-label={t("ss_granted")} />}
                    </li>
                  ))}
                </ul>
              </div>
            )) : <Empty icon={<Archive size={22} />} title={t("ss_archive_empty")} />}
          </Panel>
        </div>
      </div>
      <CollectionPanel />
    </div>
  );
}

// kazanılan sezon öğeleri ve kutu masa süsleri adlarıyla görünür; dünyada henüz çizilmedikleri dürüstçe yazılır
function CollectionPanel() {
  const t = useT(m);
  const { data } = useGameData<CollectionData>(() => seasonApi.collection(), []);
  const items = data?.items ?? [];
  return (
    <Panel title={t("ss_collection_title")} icon={<Gift size={16} />}>
      <p className="text-xs text-ink-2 mb-2">{t("ss_collection_note")}</p>
      {items.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("ss_collection_title")}>
          {items.map((it) => (
            <li key={it.id} className="chip tone-ok max-w-full whitespace-normal">
              {KIND_ICON[it.kind as SeasonRewardKind] ?? <Coffee size={15} aria-hidden />}
              <span className="break-words">{it.label}</span>
              <span className="text-xs text-ink-2">· {it.origin === "surprise" ? t("ss_collection_box") : t("ss_collection_season")}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">{t("ss_collection_empty")}</p>}
    </Panel>
  );
}

function PremiumStatus({ data }: { data: SeasonData }) {
  const t = useT(m);
  // Para düğmesi YOK ( ödeme yok): yalnız durum etiketi
  if (data.premium.active) {
    return <span className="chip tone-ok w-fit max-w-full whitespace-normal !rounded-lg">{data.premium.view_only ? t("ss_premium_admin") : t("ss_premium_included")}</span>;
  }
  return <span className="chip tone-muted w-fit max-w-full whitespace-normal !rounded-lg">{t("ss_premium_soon")}</span>;
}

function RewardCell({ reward, track, reached, premium, preview }:
  { reward: SeasonReward | null; track: string; reached: boolean; premium?: boolean; preview?: boolean }) {
  const t = useT(m);
  if (!reward) return <span aria-hidden className="text-muted text-xs">—</span>;
  const got = reward.granted || reward.owned || (premium && preview && reached);
  const state = got ? t("ss_granted") : reached ? t("ss_reached") : t("ss_state_locked");
  return (
    <div className="flex items-center gap-2 min-w-0"
      aria-label={t("ss_reward_aria", { track, tier: reward.tier, label: reward.label, state })} role="group">
      <span className={clsx("hidden sm:grid place-items-center h-8 w-8 shrink-0 rounded-lg border-2",
        got ? "border-grass text-ink" : "border-line-soft text-ink-2", !got && !reached && "opacity-90")}>
        {KIND_ICON[reward.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink leading-5 break-words">{reward.label}</p>
        <p className="text-xs text-muted flex items-center gap-1">
          {got ? <Check size={11} aria-hidden /> : !reached ? <Lock size={11} aria-hidden /> : null}
          {t(KIND_KEY[reward.kind])}
        </p>
      </div>
    </div>
  );
}
