// Ekip S5 — Kariyer: ofis seviyesi, yönetici (sen) kartı, ajan kariyer kartları, "Neden XP?" defteri, son kazanımlar.
import clsx from "clsx";
import { Building2, Crown, History, Info, Sparkles, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { timeAgo } from "../../lib/format";
import { intlTag, useT } from "../../lib/i18n";
import { game as m, spotlight as S } from "../../locales/game";
import { gameApi, useGame, type GameAgentDetail, type GameProfile, type LevelView, type ProfileAgent } from "../../lib/game";
import { feedText } from "./feedText"; // UXF-A: ham kimlik yerine ad
import { useStudio } from "../../lib/store";
import { PixelFace } from "../PixelFace";
import { Badge, Button, Empty, Panel, Spinner } from "../ui";
import { TeamContribution } from "./TeamContribution";
import { UnlockPath } from "./UnlockPath"; // açılım yolu (kilit değil, rehber)
import { CoinAmount, GameDialog, GameIcon, LevelBadge, RarityChip, XpBar } from "./parts";
import { useGameData } from "./useGameData";

const RULES = ["step_done", "first_try", "recovery", "gate_share", "clean_tools", "efficient", "handoff_used", "run_success",
  "team_share", "achievement", "goal_owner", "quest", "ext_session"] as const;
type T = ReturnType<typeof useT<typeof m.tr>>;
const ruleLabel = (t: T, rule: string) => (RULES as readonly string[]).includes(rule) ? t(`rule_${rule as typeof RULES[number]}`) : rule;

export function CareerView({ profile }: { profile: GameProfile }) {
  const t = useT(m);
  const agents = useStudio((s) => s.agents);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => {
    const visible = new Set(agents.filter((a) => !a.hidden).map((a) => a.slug));
    const tag = intlTag();
    const q = filter.trim().toLocaleLowerCase(tag);
    return profile.agents
      .filter((a) => visible.has(a.slug) || a.xp > 0)
      .filter((a) => !q || a.name.toLocaleLowerCase(tag).includes(q))
      .sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name, tag));
  }, [profile.agents, agents, filter]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-4 min-w-0">
        <div className="grid gap-3 md:grid-cols-2">
          <OfficeCard profile={profile} />
          <ManagerCard view={profile.manager} />
        </div>
        <UnlockPath />
        <section aria-labelledby="kariyer-ajanlar" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[12rem]">
              <h2 id="kariyer-ajanlar" className="section-title">{t("career_agents_title")}</h2>
              <p className="text-xs text-muted mt-0.5">{t("career_agents_hint")}</p>
            </div>
            <label className="w-full sm:w-56">
              <span className="sr-only">{t("search_agent")}</span>
              <input className="input" placeholder={t("search_agent_ph")} value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
          </div>
          {list.length ? (
            <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {list.map((a) => <li key={a.slug} className="min-w-0"><CareerCard slug={a.slug} onOpen={() => setOpen(a.slug)} /></li>)}
            </ul>
          ) : (
            <Panel><Empty icon={<UserRound size={26} />} title={t("no_agents_title")} text={t("no_agents_text")} /></Panel>
          )}
          {profile.external.length > 0 && (
            <Panel title={t("external_title")} icon={<Sparkles size={16} />}>
              <p className="text-xs text-muted mb-2">{t("external_hint")}</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {profile.external.map((x) => (
                  <li key={x.id} className="panel-soft p-3 flex items-center gap-3 min-w-0">
                    <LevelBadge level={x.level} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{x.id === "codex" ? "Codex" : x.id === "claude-code" ? "Claude Code" : x.id}</p>
                      <XpBar into={x.into} need={x.need} xp={x.xp} max={x.max} compact label={t("xp_of", { name: x.id })} />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </section>
      </div>
      <div className="flex flex-col gap-4 min-w-0">
        <TeamContribution />
        <FeedPanel />
      </div>
      {open && <AgentGameDialog slug={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function OfficeCard({ profile }: { profile: GameProfile }) {
  const t = useT(m);
  const ts = useT(S);
  const o = profile.office;
  // S35: sıradaki ücretsiz kilit — sahne/kozmetik ya da dünya yapıcı dekoru (hangisi daha yakınsa)
  const next = useMemo(() => [...profile.locked, ...(profile.decor ?? []).filter((d) => !d.unlocked)]
    .filter((l) => l.unlock_level > o.level).sort((a, b) => a.unlock_level - b.unlock_level)[0],
    [profile.locked, profile.decor, o.level]);
  return (
    <Panel title={t("office")} icon={<Building2 size={16} />} actions={<Badge tone="ok">{t("lv", { n: o.level })}</Badge>}>
      <div className="flex flex-col gap-3">
        <XpBar into={o.into} need={o.need} xp={o.xp} max={o.max} label={t("office_xp")} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-ink-2">{t("office_wallet")} <CoinAmount value={profile.coins} /></span>
          <span className="text-ink-2 num">{t("total_xp", { n: o.xp })}</span>
        </div>
        {next ? (
          <p className="text-xs text-muted flex items-start gap-1.5"><Info size={14} className="shrink-0 mt-px" aria-hidden />
            {t("next_unlock_pre", { level: next.unlock_level })} <strong className="text-ink-2 font-semibold">{next.label}</strong> {"price" in next ? t("next_unlock_post") : ts("next_decor_post")}</p>
        ) : <p className="text-xs text-muted">{t("no_locks")}</p>}
      </div>
    </Panel>
  );
}

function ManagerCard({ view }: { view: LevelView }) {
  const t = useT(m);
  return (
    <Panel title={t("manager_title")} icon={<Crown size={16} />} actions={<Badge tone="info">{view.title}</Badge>}>
      <div className="flex items-center gap-3">
        <LevelBadge level={view.level} size="lg" title={view.title} />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-ink-2 mb-1.5">{t("manager_hint")}</p>
          <XpBar into={view.into} need={view.need} xp={view.xp} max={view.max} label={t("manager_xp")} />
        </div>
      </div>
    </Panel>
  );
}

/** Ajan kariyer kartı (S12 ajan profili de içe aktarabilir): `<CareerCard slug="…" />`. */
export function CareerCard({ slug, onOpen, className }: { slug: string; onOpen?: () => void; className?: string }) {
  const t = useT(m);
  const g = useGame((s) => s.profile?.agents.find((a) => a.slug === slug) ?? null);
  const agent = useStudio((s) => s.agents.find((a) => a.slug === slug));
  if (!g) return null;
  const position = [agent?.title, g.rank_label].filter(Boolean).join(" · ");
  return (
    <article className={clsx("panel p-3.5 flex flex-col gap-3 h-full", className)} aria-label={t("career_card_aria", { name: g.name })}>
      <div className="flex items-start gap-3 min-w-0">
        <PixelFace avatar={agent?.avatar} size={46} ring={agent?.color} />
        <div className="flex-1 min-w-0">
          <h3 className="t-h4 truncate">{g.name}</h3>
          <p className="text-xs text-muted truncate">{position || t("no_position")}</p>
          <p className="text-xs text-ink-2 font-semibold mt-0.5">{t("seniority", { title: g.title })} <span className="text-muted font-medium">({t("lv", { n: g.level })})</span></p>
        </div>
        <LevelBadge level={g.level} title={g.title} />
      </div>
      <XpBar into={g.into} need={g.need} xp={g.xp} max={g.max} label={t("xp_of", { name: g.name })} />
      <TodayLine today={g.today} />
      {onOpen && (
        <Button size="sm" icon={<History size={14} />} onClick={onOpen} className="self-start mt-auto">{t("why_xp")}</Button>
      )}
    </article>
  );
}

function TodayLine({ today }: { today: ProfileAgent["today"] }) {
  const t = useT(m);
  const over = today.raw > today.full_until;
  return (
    <p className="text-xs text-muted num">
      {t("today")} <strong className="text-ink-2 font-semibold">{t("today_xp", { n: today.xp })}</strong>
      {over ? t("today_over", { n: today.full_until }) : t("today_full", { n: today.full_until })}
    </p>
  );
}

function AgentGameDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const t = useT(m);
  const { data, error, loading, reload } = useGameData<GameAgentDetail>(() => gameApi.agent(slug), [slug]);
  const [mode, setMode] = useState<"all" | "bonus" | "zero">("all");
  const rows = (data?.ledger ?? []).filter((r) => mode === "all" || (mode === "zero" ? r.amount === 0 : r.amount > 0 && r.rule !== "step_done"));
  return (
    <GameDialog open onClose={onClose} width={620} title={data ? t("growth_of", { name: data.name }) : t("growth")}>
      {loading && !data ? <div className="grid place-items-center py-10"><Spinner size={22} /></div>
        : error ? <p className="text-sm text-bad" role="alert">{error}</p>
        : data && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <LevelBadge level={data.level} size="lg" title={data.title} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{t("detail_line", { level: data.level, title: data.title })}{data.rank_label ? t("detail_position", { label: data.rank_label }) : ""}</p>
                <XpBar into={data.into} need={data.need} xp={data.xp} max={data.max} label={t("xp_of", { name: data.name })} />
              </div>
            </div>
            {data.promotion && (
              <div className="panel-soft p-3 flex flex-col gap-2">
                <p className="text-sm"><strong className="font-semibold">{t("promo_title")}</strong> {t("promo_text", { name: data.name, level: data.level, seniority: data.promotion.seniority, current: data.promotion.current_label })}</p>
                <div className="flex flex-wrap gap-2">
                  <Link to="/ofis" className="btn btn-sm">{t("open_org")}</Link>
                  <Button size="sm" variant="ghost" onClick={() => { void gameApi.dismissPromotion(slug).then(reload); }}>{t("not_now")}</Button>
                </div>
              </div>
            )}
            <section aria-labelledby="neden-xp" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 id="neden-xp" className="panel-title flex-1">{t("why_xp")}</h3>
                <div className="seg" role="group" aria-label={t("ledger_filter")}>
                  {([["all", "filter_all"], ["bonus", "filter_bonus"], ["zero", "filter_zero"]] as const).map(([v, l]) => (
                    <button key={v} type="button" aria-pressed={mode === v} onClick={() => setMode(v)}>{t(l)}</button>
                  ))}
                </div>
              </div>
              {rows.length ? (
                <ul className="flex flex-col divide-y-2 divide-line-soft border-2 border-line-soft rounded-xl">
                  {rows.map((r, i) => (
                    <li key={`${r.ts}-${i}`} className="flex items-center gap-2 px-3 py-2 min-w-0">
                      <span className={clsx("chip shrink-0", r.amount > 0 ? "tone-ok" : "tone-muted")}>{r.amount > 0 ? `+${r.amount}` : "0"}</span>
                      <span className="flex-1 min-w-0 text-sm truncate" title={r.explain}>{r.explain}</span>
                      <span className="text-xs text-muted shrink-0 hidden sm:inline">{ruleLabel(t, r.rule)}</span>
                      <span className="text-xs text-muted shrink-0">{timeAgo(r.ts * 1000)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">{t("no_rows")}</p>}
            </section>
            {data.achievements.length > 0 && (
              <section aria-labelledby="ajan-vitrin" className="flex flex-col gap-2">
                <h3 id="ajan-vitrin" className="panel-title">{t("their_achievements")}</h3>
                <ul className="flex flex-wrap gap-2">
                  {data.achievements.map((a) => (
                    <li key={`${a.id}-${a.tier}`} className="panel-soft px-2.5 py-1.5 flex items-center gap-2">
                      <GameIcon name={a.icon} size={15} className="text-ink-2" />
                      <span className="text-sm font-semibold">{a.name}</span>
                      <RarityChip rarity={a.rarity} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
    </GameDialog>
  );
}

function FeedPanel() {
  const t = useT(m);
  const { data } = useGameData(() => gameApi.feed(25), []);
  return (
    <Panel title={t("recent_title")} icon={<History size={16} />} className="self-start w-full" bodyClass="!px-0">
      {data && data.length ? (
        <ul className="flex flex-col">
          {data.map((f) => (
            <li key={f.id} className="flex items-start gap-2.5 px-4 py-2 border-t-2 border-line-soft first:border-t-0 min-w-0">
              <span className="mt-0.5 text-ink-2 shrink-0" aria-hidden>
                <GameIcon name={f.kind === "levelup" ? "star" : f.kind === "achievement" ? "trophy" : f.kind === "quest" ? "scroll-text"
                  : f.kind === "unlock" ? "lock-open" : f.kind === "treat" ? "party-popper" : "sparkles"} size={15} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-5 break-words">{feedText(f, t)}</p>
                <p className="text-xs text-muted">{timeAgo(f.ts * 1000)}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="px-4 text-sm text-muted">{t("recent_empty")}</p>}
    </Panel>
  );
}
