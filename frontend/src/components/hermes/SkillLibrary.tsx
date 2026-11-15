// Ekip S14 (önceki sahibi S1): Hermes sayfasındaki skill sekmesi — profil seçici, kategori rayı, arama,
// kaynak/durum filtresi, kartlar; "VoxCrew'a kopyala" ve birleşik kütüphaneye (/skiller) bağlantı.
import clsx from "clsx";
import { BookOpen, Coins, Copy, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { categoryLabel as hermesCategoryLabel, fold, hermesApi, tokensLabel, type HermesProfile, type SkillInfo, type SkillSource } from "../../lib/hermes";
import { tp, useLocale, useT } from "../../lib/i18n";
import { skillsApi, useSkills } from "../../lib/skills";
import { skillsMsg as m } from "../../locales/skills";
import { Badge, Button, Empty, Spinner, Toggle } from "../ui";
import { ErrorBox, LoadingBlock, ProfileSelect, SkillStateBadges, useLoad } from "./common";
import { SkillDrawer } from "./SkillDetail";

type StateFilter = "all" | "usable" | "unavailable";
const SOURCE_KEY: Record<SkillSource, "src_bundled" | "src_hub" | "src_agent" | "src_local" | "src_external"> = {
  bundled: "src_bundled", hub: "src_hub", agent: "src_agent", local: "src_local", external: "src_external",
};

/** Kategori etiketi: lib/hermes sözlüğü (S19'dan beri dil duyarlı); dil değişince yeniden çizilsin diye locale'e abone. */
function useCategoryLabel() {
  useLocale((s) => s.locale);
  return (c: string | null | undefined): string => hermesCategoryLabel(c);
}

export function SkillLibrary({ profiles, profile, onProfile }: { profiles: HermesProfile[]; profile: string; onProfile: (p: string) => void }) {
  const t = useT(m);
  const categoryLabel = useCategoryLabel();
  const { data, error, loading, reload } = useLoad(() => hermesApi.skills(profile), [profile]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [source, setSource] = useState<SkillSource | "all">("all");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [showHidden, setShowHidden] = useState(false);
  const [open, setOpen] = useState<SkillInfo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const skills = data ?? [];
  const visible = useMemo(() => skills.filter((s) => showHidden || s.listed), [skills, showHidden]);
  const categories = useMemo(() => {
    const mm = new Map<string, number>();
    visible.forEach((s) => mm.set(s.category ?? "", (mm.get(s.category ?? "") ?? 0) + 1));
    return [...mm.entries()].sort((a, b) => categoryLabel(a[0]).localeCompare(categoryLabel(b[0])));
  }, [visible, categoryLabel]);
  const sources = useMemo(() => [...new Set(visible.map((s) => s.source))], [visible]);
  const hiddenCount = skills.filter((s) => !s.listed).length;

  const filtered = useMemo(() => {
    const needle = fold(query.trim());
    return visible.filter((s) =>
      (category === null || (s.category ?? "") === category) &&
      (source === "all" || s.source === source) &&
      (stateFilter === "all" || (stateFilter === "usable" ? s.loadable : !s.loadable)) &&
      (!needle || fold(`${s.name} ${s.description} ${s.category ?? ""} ${categoryLabel(s.category)} ${s.tags.join(" ")}`).includes(needle)));
  }, [visible, query, category, source, stateFilter, categoryLabel]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <ProfileSelect profiles={profiles} value={profile} onChange={(p) => { onProfile(p); setCategory(null); }} />
        <label className="relative flex-1 min-w-[12rem]">
          <span className="sr-only">{t("search_label")}</span>
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
          <input className="input !pl-9" type="search" placeholder={t("search_placeholder")} value={query}
            onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select className="select !w-auto" value={source} onChange={(e) => setSource(e.target.value as SkillSource | "all")} aria-label={t("lib_source_filter")}>
          <option value="all">{t("lib_all_sources")}</option>
          {sources.map((s) => <option key={s} value={s}>{t(SOURCE_KEY[s])}</option>)}
        </select>
        <select className="select !w-auto" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as StateFilter)} aria-label={t("lib_state_filter")}>
          <option value="all">{t("lib_all_states")}</option>
          <option value="usable">{t("lib_usable")}</option>
          <option value="unavailable">{t("lib_unavailable")}</option>
        </select>
        <Link to="/skiller" className="text-sm text-link font-semibold hover:underline underline-offset-2">{t("lib_all_sources_link")}</Link>
        {hiddenCount > 0 && (
          <div className="ml-auto">
            <Toggle checked={showHidden} onChange={setShowHidden} label={t("lib_show_hidden", { n: hiddenCount })} hint={t("lib_hidden_hint")} />
          </div>
        )}
      </div>
      {msg && <p className="text-sm text-ok font-medium" role="status">{msg}</p>}

      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <LoadingBlock label={t("lib_reading")} /> : data && (
        <div className="grid grid-cols-1 lg:grid-cols-[13rem_1fr] gap-4 items-start">
          {/* kategori rayı: mobilde yatay kaydırılan çipler, masaüstünde dikey liste */}
          <nav aria-label={t("lib_categories")} className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0 lg:sticky lg:top-4">
            <CategoryButton active={category === null} onClick={() => setCategory(null)} label={t("lib_all")} count={visible.length} />
            {categories.map(([c, n]) => (
              <CategoryButton key={c || "_"} active={category === c} onClick={() => setCategory(c)} label={categoryLabel(c || null)} count={n} />
            ))}
          </nav>
          <div className="min-w-0 flex flex-col gap-3">
            <p className="text-sm text-muted" aria-live="polite">
              {t("lib_count", { n: filtered.length, active: skills.filter((s) => s.listed).length, total: skills.length })}
            </p>
            {filtered.length === 0 ? (
              <Empty icon={<BookOpen size={28} />} title={t("lib_empty_title")} text={t("lib_empty_text")} />
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3">
                {filtered.map((s) => (
                  <li key={`${s.load_name}:${s.rel_path}`}>
                    <SkillCard skill={s} onOpen={() => setOpen(s)} categoryLabel={categoryLabel} onCopied={(text) => setMsg(text)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <SkillDrawer skill={open} profile={profile} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}

function CategoryButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={clsx("shrink-0 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-left transition-colors whitespace-nowrap",
        active ? "bg-ink text-panel font-semibold" : "text-ink-2 hover:bg-panel-2")}>
      <span className="flex-1 truncate">{label}</span>
      <span className={clsx("text-xs tabular-nums", active ? "opacity-80" : "text-muted")}>{count}</span>
    </button>
  );
}

function SkillCard({ skill, onOpen, categoryLabel, onCopied }:
  { skill: SkillInfo; onOpen: () => void; categoryLabel: (c: string | null | undefined) => string; onCopied: (msg: string) => void }) {
  const t = useT(m);
  const users = skill.agents ?? [];
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    setBusy(true);
    try {
      const e = await skillsApi.copy(`hermes:${skill.load_name}`);
      useSkills.getState().upsert(e);
      onCopied(t("lib_copied", { name: e.name }));
    } catch (err) {
      onCopied(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={clsx("card-select w-full h-full p-3.5 flex flex-col gap-2 relative", !skill.loadable && "opacity-70")}>
      <button type="button" onClick={onOpen} className="flex flex-col gap-2 text-left flex-1 min-w-0 pr-8" aria-label={t("card_open", { name: skill.name })}>
        <span className="flex items-start gap-2 w-full">
          <span className="font-mono text-sm font-semibold break-all flex-1 min-w-0">{skill.name}</span>
          <Badge tone="info" className="shrink-0">{categoryLabel(skill.category)}</Badge>
        </span>
        <span className="text-sm text-ink-2 leading-snug line-clamp-3">{skill.description || t("lib_no_desc")}</span>
        <span className="flex flex-wrap gap-1.5 mt-auto pt-1">
          <Badge>{t(SOURCE_KEY[skill.source])}</Badge>
          <SkillStateBadges skill={skill} compact />
        </span>
        <span className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1" title={t("lib_tokens_title")}><Coins size={13} aria-hidden />{tokensLabel(skill.tokens)}</span>
          {users.length > 0 && (
            <span className="flex items-center gap-1" title={users.map((u) => u.name).join(", ")}>
              <Users size={13} aria-hidden />{tp(m, "agents_count", users.length)}
            </span>
          )}
        </span>
      </button>
      <Button size="sm" variant="ghost" className="absolute top-2 right-2" icon={busy ? <Spinner size={14} /> : <Copy size={14} />}
        aria-label={t("lib_copy")} title={t("lib_copy_title")} disabled={busy} onClick={() => void copy()} />
    </div>
  );
}
