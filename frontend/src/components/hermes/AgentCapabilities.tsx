// Ekip S14 (önceki sahibi S1): Ajan çekmecesindeki "Yetenekler" sekmesi.
// Hermes ajanı: profil skill'leri (-s), araç setleri (-t), akıl yürütme, taşıma + profil dışı skill'ler (istem bağlamı).
// Diğer beyinler: birleşik kütüphaneden skill atama (AgentSkills) — skill gövdeleri istem aşamasıyla verilir.
// "Kimlik" sekmesindeki salt okunur SOUL.md alıntısı da buradadır.
import clsx from "clsx";
import { AlertTriangle, BookOpen, Brain, ExternalLink, Feather, Route as RouteIcon, Search, ShieldAlert, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { categoryLabel as hermesCategoryLabel, effectiveTransport, fold, hermesApi, REASONING_ORDER, TOOLSET_TR, tokensLabel, type SkillInfo, type ToolsetInfo } from "../../lib/hermes";
import { useLocale, useT } from "../../lib/i18n";
import { useSkills, wireSkillsEvents } from "../../lib/skills";
import { useStudio } from "../../lib/store";
import type { Agent } from "../../lib/types";
import { skillsMsg as m } from "../../locales/skills";
import { AgentSkills } from "../skills/AgentSkills";
import { HowBadge, SourceBadge } from "../skills/common";
import { Badge, Field, Segmented } from "../ui";
import { ErrorBox, LoadingBlock, Note, useLoad } from "./common";

/** Önyüklenen skill'ler için önerilen bağlam bütçesi (token). Aşılınca uyarı verilir. */
const SKILL_BUDGET = 12000;

type Patch = (p: Partial<Agent>) => unknown;

/** Kategori etiketi: lib/hermes sözlüğü (S19'dan beri dil duyarlı); dil değişince yeniden çizilsin diye locale'e abone. */
function useCategoryLabel() {
  useLocale((s) => s.locale);
  return (c: string | null | undefined): string => hermesCategoryLabel(c);
}

export function AgentCapabilities({ agent, onPatch }: { agent: Agent; onPatch: Patch }) {
  const viaHermes = agent.runtime === "hermes";
  if (!viaHermes) {
    return (
      <div className="flex flex-col gap-4">
        <AgentSkills slug={agent.slug} />
      </div>
    );
  }
  return <HermesCapabilities agent={agent} onPatch={onPatch} />;
}

function HermesCapabilities({ agent, onPatch }: { agent: Agent; onPatch: Patch }) {
  const t = useT(m);
  const profile = agent.hermes_profile || "default";
  const { data, error, loading, reload } = useLoad(
    () => Promise.all([hermesApi.skills(profile), hermesApi.toolsets(profile)]), [profile]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <LoadingBlock label={t("cap_reading")} />;
  if (!data) return null;
  const [skills, toolsets] = data;
  return (
    <div className="flex flex-col gap-6">
      <SkillPicker agent={agent} skills={skills} toolsets={toolsets} onPatch={onPatch} />
      <ToolsetPicker agent={agent} toolsets={toolsets} onPatch={onPatch} />
      <ReasoningPicker agent={agent} onPatch={onPatch} />
      <TransportPicker agent={agent} onPatch={onPatch} />
    </div>
  );
}

// ---------------------------------------------------------------------- skill'ler (Hermes profili)
function SkillPicker({ agent, skills, toolsets, onPatch }: { agent: Agent; skills: SkillInfo[]; toolsets: ToolsetInfo[]; onPatch: Patch }) {
  const t = useT(m);
  const categoryLabel = useCategoryLabel();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const assigned = agent.skills ?? [];
  // profil dışı atamalar (VoxCrew / Claude): birleşik kütüphaneden çözülür, istem bağlamıyla gider
  const libItems = useSkills((s) => s.items);
  const libLoaded = useSkills((s) => s.loaded);
  useEffect(() => { wireSkillsEvents(); if (!libLoaded) void useSkills.getState().refresh(); }, [libLoaded]);
  const libByKey = useMemo(() => new Map(libItems.filter((e) => e.source !== "hermes").map((e) => [e.key, e])), [libItems]);
  const byKey = useMemo(() => {
    const mm = new Map<string, SkillInfo>();
    skills.forEach((s) => { mm.set(s.load_name, s); if (!mm.has(s.name)) mm.set(s.name, s); if (!mm.has(s.rel_path)) mm.set(s.rel_path, s); });
    return mm;
  }, [skills]);
  const selected = assigned.map((k) => ({ key: k, skill: byKey.get(k), other: byKey.get(k) ? undefined : libByKey.get(k) }));
  const usedTokens = selected.reduce((sum, x) => sum + (x.skill?.loadable ? x.skill.tokens : 0), 0);
  const pct = Math.min(100, (usedTokens / SKILL_BUDGET) * 100);
  const isOn = (s: SkillInfo) => assigned.some((k) => k === s.load_name || k === s.name || k === s.rel_path);
  const toggle = (s: SkillInfo) => {
    const next = isOn(s) ? assigned.filter((k) => k !== s.load_name && k !== s.name && k !== s.rel_path) : [...assigned, s.load_name];
    onPatch({ skills: next });
  };
  const needle = fold(query.trim());
  const list = skills.filter((s) => (showAll || s.listed) &&
    (!needle || fold(`${s.name} ${s.description} ${s.category ?? ""} ${categoryLabel(s.category)} ${s.tags.join(" ")}`).includes(needle)));
  const skillsToolset = (agent.toolsets?.length ? agent.toolsets.includes("skills") : toolsets.find((x) => x.name === "skills")?.default) ?? false;
  const others = selected.filter((x) => x.other);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="cap-skills">
      <div className="flex items-center gap-2">
        <BookOpen size={16} className="text-accent" aria-hidden />
        <h3 id="cap-skills" className="panel-title flex-1">{t("cap_skills")}</h3>
        <Link to={`/hermes/skiller?profil=${encodeURIComponent(profileOf(agent))}`} className="text-xs text-link font-semibold hover:underline underline-offset-2"
          onClick={() => useStudio.getState().selectAgent(null)}>{t("cap_open_library")}</Link>
      </div>
      <p className="text-xs text-muted leading-relaxed">
        <b className="text-ink-2">{t("cap_preload")}</b>{t("cap_preload_text", { flag: "-s" })}
        {" "}<b className="text-ink-2">{t("cap_access")}</b>{t("cap_access_text")}
        {" "}{skillsToolset ? <span className="text-ok font-semibold">{t("on")}</span> : <span className="font-semibold">{t("off")}</span>}.
      </p>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{t("cap_budget")}</span>
          <span className={clsx("tabular-nums font-semibold", usedTokens > SKILL_BUDGET ? "text-bad" : "text-ink-2")}>
            {tokensLabel(usedTokens)} / {tokensLabel(SKILL_BUDGET)}
          </span>
        </div>
        <div className="h-2 rounded-full bg-panel-3 overflow-hidden" role="meter" aria-label={t("cap_budget_aria")}
          aria-valuemin={0} aria-valuemax={SKILL_BUDGET} aria-valuenow={usedTokens}>
          <div className={clsx("h-full transition-all", usedTokens > SKILL_BUDGET ? "bg-red" : pct > 60 ? "bg-gold" : "bg-grass")} style={{ width: `${pct}%` }} />
        </div>
        {usedTokens > SKILL_BUDGET && <span className="text-xs text-bad">{t("cap_budget_over")}</span>}
      </div>

      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("cap_preloaded")}>
          {selected.map(({ key, skill, other }) => {
            const missing = !other && (!skill || !skill.loadable);
            return (
              <li key={key}>
                <span className={clsx("chip !pr-1", missing ? "tone-bad" : other ? "tone-info" : "tone-ok")}
                  title={other ? other.description : missing ? (skill?.reason ?? t("cap_missing_title")) : skill?.description}>
                  {missing && <AlertTriangle size={12} aria-hidden />}
                  <span className="font-mono">{key}</span>
                  {missing && <span>{t("cap_missing")}</span>}
                  {other && <HowBadge how="prompt" />}
                  <button type="button" className="rounded-full p-0.5 hover:bg-panel" aria-label={t("cap_remove", { key })}
                    onClick={() => onPatch({ skills: assigned.filter((k) => k !== key) })}><X size={12} /></button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {others.length > 0 && (
        <Note tone="info"><b>{t("cap_other_sources")}</b> · {t("cap_other_sources_hint")}{" "}
          {others.map((x) => x.other && <SourceBadge key={x.key} source={x.other.source} className="ml-1" />)}
        </Note>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[10rem]">
          <span className="sr-only">{t("search_label")}</span>
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
          <input className="input !pl-8 !py-1.5 text-sm" type="search" placeholder={t("cap_search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
          <input type="checkbox" className="accent-[var(--grass)]" aria-label={t("cap_show_hidden")} checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          {t("cap_show_hidden")}
        </label>
      </div>
      <ul className="flex flex-col gap-1 max-h-[42vh] overflow-y-auto pr-1" aria-label={t("cap_profile_skills")}>
        {list.length === 0 && <li className="text-sm text-muted py-3 text-center">{t("cap_no_match")}</li>}
        {list.map((s) => {
          const on = isOn(s);
          return (
            <li key={`${s.load_name}:${s.rel_path}`}>
              <button type="button" role="switch" aria-checked={on} aria-label={s.name} disabled={!s.loadable && !on} onClick={() => toggle(s)}
                title={s.reason ?? s.description}
                className={clsx("w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left border-2 transition-colors",
                  on ? "border-line bg-panel" : "border-transparent hover:bg-panel-2", !s.loadable && "opacity-55 cursor-not-allowed")}>
                <span className={clsx("relative h-5 w-9 shrink-0 rounded-md border-2 border-line transition-colors", on ? "bg-grass" : "bg-panel-3")} aria-hidden>
                  <span className={clsx("absolute top-0.5 h-3 w-3 rounded-[3px] border-2 border-line bg-panel transition-all", on ? "left-[18px]" : "left-0.5")} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-sm font-semibold truncate">{s.name}</span>
                    <span className="text-xs text-muted truncate">{categoryLabel(s.category)}</span>
                  </span>
                  <span className="block text-xs text-ink-2 truncate">{s.reason ? t("cap_unusable", { reason: s.reason }) : s.description}</span>
                </span>
                <span className="text-xs text-muted num shrink-0">{tokensLabel(s.tokens)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const profileOf = (a: Agent) => a.hermes_profile || "default";

// ---------------------------------------------------------------------- araç setleri
function ToolsetPicker({ agent, toolsets, onPatch }: { agent: Agent; toolsets: ToolsetInfo[]; onPatch: Patch }) {
  const t = useT(m);
  const locale = useLocale((s) => s.locale);
  const custom = (agent.toolsets?.length ?? 0) > 0;
  const chosen = agent.toolsets ?? [];
  const selectable = toolsets.filter((x) => !x.config_only && x.cli_allowed);
  const defaults = toolsets.filter((x) => x.default).map((x) => x.name);
  const riskyChosen = chosen.filter((n) => toolsets.find((x) => x.name === n)?.risky);
  const toggle = (name: string) => {
    const next = chosen.includes(name) ? chosen.filter((x) => x !== name) : [...chosen, name];
    onPatch({ toolsets: next });
  };
  const describe = (x: ToolsetInfo) => (locale === "tr" ? TOOLSET_TR[x.name] ?? x.label : x.label || x.description);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="cap-tools">
      <div className="flex items-center gap-2">
        <Wrench size={16} className="text-info" aria-hidden />
        <h3 id="cap-tools" className="panel-title flex-1">{t("cap_toolsets")}</h3>
      </div>
      <Segmented value={custom ? "custom" : "default"} className="self-start flex-wrap"
        onChange={(v) => onPatch({ toolsets: v === "custom" ? (defaults.length ? defaults : ["file"]) : [] })}
        options={[{ value: "default", label: t("cap_ts_default") }, { value: "custom", label: t("cap_ts_custom") }]} />
      {!custom ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted">{t("cap_ts_default_text")}</p>
          <div className="flex flex-wrap gap-1.5">
            {defaults.length ? defaults.map((n) => <Badge key={n} tone="ok">{n}</Badge>) : <span className="text-sm text-muted">{t("cap_ts_none")}</span>}
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted">{t("cap_ts_custom_text", { flag: `-t ${chosen.join(",") || "…"}` })}</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {selectable.map((x) => {
              const on = chosen.includes(x.name);
              const blocked = x.profile_disabled && !on;
              return (
                <li key={x.name}>
                  <label className={clsx("flex items-start gap-2 rounded-lg border-2 px-2.5 py-2 text-sm cursor-pointer",
                    on ? "border-line bg-panel" : "border-line-soft bg-panel-2", blocked && "opacity-55 cursor-not-allowed")}
                    title={blocked ? t("cap_ts_blocked_title") : x.description}>
                    <input type="checkbox" className="h-4 w-4 mt-0.5 accent-[var(--grass)]" aria-label={x.name} checked={on} disabled={blocked} onChange={() => toggle(x.name)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-semibold">{x.name}</span>
                        {x.risky && <Badge tone="warn"><ShieldAlert size={12} aria-hidden />{t("cap_risky")}</Badge>}
                        {x.default && <Badge>{t("cap_default")}</Badge>}
                      </span>
                      <span className="block text-xs text-muted leading-snug">{blocked ? t("cap_ts_blocked") : describe(x)}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {riskyChosen.length > 0 && (
            <Note tone="warn" icon={<ShieldAlert size={15} />}>{t("cap_risky_note", { names: riskyChosen.join(", ") })}</Note>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------- akıl yürütme
function ReasoningPicker({ agent, onPatch }: { agent: Agent; onPatch: Patch }) {
  const t = useT(m);
  const value = agent.reasoning ?? "";
  const label = (r: string) => t(`reason_${r}` as "reason_none");
  return (
    <section aria-labelledby="cap-reason">
      <Field label={<span id="cap-reason" className="flex items-center gap-1.5"><Brain size={15} className="text-warn" aria-hidden />{t("cap_reasoning")}</span>}
        hint={t("cap_reasoning_hint")}>
        <Segmented value={value} className="flex-wrap" onChange={(v) => onPatch({ reasoning: v || null })}
          options={[{ value: "", label: t("cap_reasoning_default") }, ...REASONING_ORDER.map((r) => ({ value: r, label: label(r), title: r }))]} />
      </Field>
    </section>
  );
}

// ---------------------------------------------------------------------- taşıma
function TransportPicker({ agent, onPatch }: { agent: Agent; onPatch: Patch }) {
  const t = useT(m);
  const value = agent.transport ?? "auto";
  const hasCaps = (agent.skills?.length ?? 0) > 0 || (agent.toolsets?.length ?? 0) > 0;
  const eff = effectiveTransport(agent.transport, hasCaps);
  return (
    <section aria-labelledby="cap-transport" className="flex flex-col gap-2">
      <Field label={<span id="cap-transport" className="flex items-center gap-1.5"><RouteIcon size={15} className="text-ok" aria-hidden />{t("cap_transport")}</span>}>
        <Segmented value={value} className="flex-wrap" onChange={(v) => onPatch({ transport: v })} options={[
          { value: "auto", label: t("cap_t_auto") }, { value: "cli", label: t("cap_t_cli") }, { value: "api", label: t("cap_t_api") },
        ]} />
      </Field>
      <Note tone="muted">
        {t("cap_transport_note")}
        {" "}{eff === "cli" && value === "auto" && t("cap_transport_auto_cli")}
        {eff === "auto" && ` ${t("cap_transport_auto")}`}
        {value === "api" && hasCaps && <span className="text-bad"> {t("cap_transport_api_warn")}</span>}
      </Note>
    </section>
  );
}

// ---------------------------------------------------------------------- Kimlik sekmesi: SOUL.md alıntısı
export function SoulExcerpt({ agent }: { agent: Agent }) {
  const t = useT(m);
  const profile = agent.hermes_profile || "default";
  const enabled = agent.runtime === "hermes";
  const { data, error, loading, reload } = useLoad(
    () => (enabled ? hermesApi.soul(profile) : Promise.resolve(null)), [profile, enabled]);
  if (!enabled) return null;
  const text = data?.content.trim() ?? "";
  const others = (data?.agents ?? []).filter((a) => a.slug !== agent.slug);
  return (
    <section className="panel-soft p-3 flex flex-col gap-2" aria-labelledby="soul-excerpt">
      <div className="flex items-center gap-2">
        <Feather size={15} className="text-accent" aria-hidden />
        <h3 id="soul-excerpt" className="font-display text-sm font-semibold flex-1 min-w-0 break-words">
          {t("soul_title")} ({t("soul_profile")} <span className="font-mono">{profile}</span>)
        </h3>
      </div>
      <p className="text-xs text-muted">{t("soul_text")}</p>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <LoadingBlock /> : data && (
        text ? (
          <p className="text-sm whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-y-auto bg-panel rounded-lg border-2 border-line-soft p-2.5">
            {text.length > 1200 ? `${text.slice(0, 1200)}…` : text}
          </p>
        ) : <p className="text-sm text-muted">{t("soul_empty")}</p>
      )}
      {others.length > 0 && <p className="text-xs text-muted">{t("soul_shared", { names: others.map((a) => a.name).join(", ") })}</p>}
      <Link to={`/hermes/profiller?profil=${encodeURIComponent(profile)}&duzenle=soul`} onClick={() => useStudio.getState().selectAgent(null)}
        className="text-sm text-link font-semibold inline-flex items-center gap-1 self-start hover:underline underline-offset-2">
        {t("soul_edit")} <ExternalLink size={13} aria-hidden />
      </Link>
    </section>
  );
}
