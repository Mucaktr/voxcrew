// Ekip S14. SÖZLEŞME — ajan profili (S20) ve çekmece içe aktarır; imzayı değiştirme.
// Ajanın skill'leri: atanmış liste (uygulanma yolu rozetiyle), ekle/çıkar (her beyin türü), beyin türüne göre
// "nasıl uygulanır" açıklaması ve istem bağlam bütçesi çubuğu.
import { BookOpen, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fmtNumber, useT } from "../../lib/i18n";
import { foldText, matchesSkill, skillsApi, useSkills, wireSkillsEvents, type AgentSkillView, type SkillEntry } from "../../lib/skills";
import { useStudio } from "../../lib/store";
import { skillsMsg as m } from "../../locales/skills";
import { Badge, Button } from "../ui";
import { BudgetMeter, ErrorRow, HowBadge, LoadingRow, Note, SourceBadge } from "./common";

/** Ajanın skill'leri: atanmış skill listesi, ekle/çıkar (her beyin türü için). */
export function AgentSkills({ slug }: { slug: string }) {
  const t = useT(m);
  const agent = useStudio((s) => s.agents.find((a) => a.slug === slug));
  const skillsKey = (agent?.skills ?? []).join("|");
  const runtime = agent?.runtime;
  const profile = agent?.hermes_profile;
  const items = useSkills((s) => s.items);
  const loaded = useSkills((s) => s.loaded);
  const refreshLib = useSkills((s) => s.refresh);
  const refreshAgents = useStudio((s) => s.refreshAgents);
  useEffect(() => { wireSkillsEvents(); if (!loaded) void refreshLib(); }, [loaded, refreshLib]);

  const [view, setView] = useState<AgentSkillView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const seq = useRef(0);
  const load = useCallback(() => {
    const id = ++seq.current;
    skillsApi.agent(slug).then((v) => { if (id === seq.current) { setView(v); setError(null); } })
      .catch((e) => { if (id === seq.current) setError(e instanceof Error ? e.message : String(e)); });
  }, [slug]);
  useEffect(() => { load(); }, [load, skillsKey, runtime, profile]);

  const assigned = useMemo(() => new Set((view?.items ?? []).map((i) => i.key)), [view]);
  const isHermes = runtime === "hermes";
  const needle = foldText(query.trim());
  const options = useMemo(() => items.filter((e) => e.loadable && !assigned.has(e.key) &&
    (!isHermes || (e.source === "hermes" && (e.profiles ?? []).includes(profile || "default"))) &&
    matchesSkill(e, needle)).slice(0, 40), [items, assigned, isHermes, profile, needle]);

  const change = async (ids: string[], mode: "add" | "remove", key: string) => {
    setBusy(key);
    setError(null);
    try {
      const r = await skillsApi.assign([slug], ids, mode);
      const fail = r.results.find((x) => !x.ok);
      if (fail) setError(fail.error ?? "");
      await refreshAgents();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!agent) return null;
  const budget = view?.budget;
  const promptItems = (view?.items ?? []).filter((i) => i.how === "prompt");
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`agent-skills-${slug}`}>
      <div className="flex items-center gap-2">
        <BookOpen size={16} className="text-accent" aria-hidden />
        <h3 id={`agent-skills-${slug}`} className="panel-title flex-1">{t("as_title")}</h3>
        <Link to="/skiller" className="text-xs text-link font-semibold hover:underline underline-offset-2"
          onClick={() => useStudio.getState().selectAgent(null)}>{t("as_open_library")}</Link>
      </div>
      <p className="text-xs text-muted leading-relaxed">
        {isHermes ? t("as_how_hermes") : t("as_how_prompt", { max: fmtNumber(budget?.max_chars ?? 6000) })}
      </p>
      {budget && !budget.inject && <Note tone="warn">{t("as_inject_off")}</Note>}
      {budget && (promptItems.length > 0 || !isHermes) && (
        <BudgetMeter value={budget.chars} max={budget.max_chars} label={t("as_budget")} />
      )}
      {error && <ErrorRow error={error} />}
      {!view && !error && <LoadingRow label={t("as_loading")} />}
      {view && (
        view.items.length === 0 ? <p className="text-sm text-muted">{t("as_empty")}</p> : (
          <ul className="flex flex-col gap-1" aria-label={t("as_assigned_list")}>
            {view.items.map((i) => (
              <li key={i.key} className="flex items-center gap-2 rounded-lg border-2 border-line-soft bg-panel-2 px-2.5 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-sm font-semibold break-all">{i.key}</span>
                    {i.entry && <SourceBadge source={i.entry.source} />}
                    <HowBadge how={i.how} truncated={i.truncated} omitted={i.how === "prompt" && !i.in_prompt && !!budget?.inject} />
                  </span>
                  {i.entry?.description && <span className="block text-xs text-ink-2 truncate">{i.entry.description}</span>}
                </span>
                <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={t("as_remove", { key: i.key })} disabled={busy === i.key}
                  onClick={() => void change([i.entry?.id ?? i.key], "remove", i.key)}><X size={14} /></button>
              </li>
            ))}
          </ul>
        )
      )}
      {!adding ? (
        <Button size="sm" icon={<Plus size={14} />} onClick={() => setAdding(true)} className="self-start">{t("as_add")}</Button>
      ) : (
        <div className="panel-soft p-2 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <label className="relative flex-1">
              <span className="sr-only">{t("as_pick_title")}</span>
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
              <input className="input !pl-8 !py-1.5 text-sm" type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("cap_search")} />
            </label>
            <Button size="sm" variant="ghost" icon={<X size={14} />} aria-label={t("close")} onClick={() => { setAdding(false); setQuery(""); }} />
          </div>
          {isHermes && <p className="text-xs text-muted">{t("as_hermes_only_profile", { profile: profile || "default" })}</p>}
          <ul className="flex flex-col gap-0.5 max-h-56 overflow-y-auto" role="listbox" aria-label={t("as_pick_title")}>
            {options.length === 0 && <li className="text-sm text-muted py-2 text-center">{t("as_no_match")}</li>}
            {options.map((e: SkillEntry) => (
              <li key={e.id}>
                <button type="button" role="option" aria-selected={false} disabled={busy === e.key}
                  className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-panel disabled:opacity-50"
                  onClick={() => void change([e.id], "add", e.key)} title={e.description}>
                  <span className="font-mono text-sm font-semibold truncate flex-1 min-w-0">{e.name}</span>
                  {e.key !== e.name && <Badge><span className="font-mono">{e.key}</span></Badge>}
                  <SourceBadge source={e.source} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
