// Ekip S1: Skill ayrıntısı (sağ çekmece) — SKILL.md önizlemesi, dosyalar, kullanan ajanlar, "Ajana ata".
import clsx from "clsx";
import { BookOpen, Check, FileCode2, FileText, Info, UserPlus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { categoryLabel, hermesApi, SOURCE_LABELS, tokensLabel, type SkillInfo } from "../../lib/hermes";
import { fmtNumber, tp, useT } from "../../lib/i18n";
import { useStudio } from "../../lib/store";
import type { Agent } from "../../lib/types";
import { hermesMsg as m } from "../../locales/hermes";
import { Markdown } from "../Markdown";
import { Badge, Button, Drawer, Segmented } from "../ui";
import { AgentChips, ErrorBox, LoadingBlock, Note, Rich, SectionTitle, SkillStateBadges, useLoad } from "./common";

type View = "preview" | "raw" | "files" | "meta";

export function SkillDrawer({ skill, profile, onClose, onChanged }:
  { skill: SkillInfo | null; profile: string; onClose: () => void; onChanged: () => void }) {
  return (
    <Drawer open={!!skill} onClose={onClose} width={720} label={skill?.name}>
      {skill && <SkillPanel key={`${profile}:${skill.load_name}`} skill={skill} profile={profile} onClose={onClose} onChanged={onChanged} />}
    </Drawer>
  );
}

function SkillPanel({ skill, profile, onClose, onChanged }: { skill: SkillInfo; profile: string; onClose: () => void; onChanged: () => void }) {
  const t = useT(m);
  const { data, error, loading, reload } = useLoad(() => hermesApi.skill(skill.load_name, profile), [skill.load_name, profile]);
  const [view, setView] = useState<View>("preview");
  const selectAgent = useStudio((s) => s.selectAgent);
  const s = data ?? skill;

  return (
    <>
      <header className="flex items-start gap-3 px-5 pt-5 pb-3 border-b-2 border-line-soft">
        <span className="h-10 w-10 rounded-lg grid place-items-center bg-amethyst text-white border-2 border-line shrink-0">
          <BookOpen size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-mono text-lg font-semibold break-all">{s.name}</h2>
          <p className="text-sm text-ink-2 mt-0.5">{s.description || t("no_desc")}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Badge tone="info">{categoryLabel(s.category)}</Badge>
            <Badge>{SOURCE_LABELS[s.source]}</Badge>
            {s.trust && <Badge>{t("trust", { v: s.trust })}</Badge>}
            {s.version && <Badge>v{s.version}</Badge>}
            <Badge title={t("tokens_title")}>{tokensLabel(s.tokens)}</Badge>
            <SkillStateBadges skill={s} />
          </div>
        </div>
        <Button variant="ghost" size="sm" icon={<X size={18} />} onClick={onClose} aria-label={t("close")} />
      </header>

      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
        {skill.reason && <Note tone="warn" icon={<Info size={15} />}>{t("cant_assign", { reason: skill.reason })}</Note>}
        {!s.reason && s.missing_toolsets.length > 0 && (
          <Note tone="warn" icon={<Info size={15} />}>
            <Rich text={t("missing_ts")} parts={{ names: <b>{s.missing_toolsets.join(", ")}</b> }} />
          </Note>
        )}

        <AssignSection skill={s} profile={profile} onChanged={() => { reload(); onChanged(); }} onOpenAgent={(slug) => { onClose(); selectAgent(slug); }} />

        <section>
          <SectionTitle actions={
            <Segmented value={view} onChange={setView} options={[
              { value: "preview", label: t("view_preview") }, { value: "raw", label: t("view_raw") },
              { value: "files", label: data ? t("view_files_n", { n: data.files.length }) : t("view_files") }, { value: "meta", label: t("view_meta") },
            ]} />
          }>SKILL.md</SectionTitle>
          {loading && !data && <LoadingBlock />}
          {error && <ErrorBox error={error} onRetry={reload} />}
          {data && view === "preview" && (
            <div className="panel-soft p-4">
              <Markdown text={data.body || t("body_empty")} />
              {data.truncated && <p className="text-xs text-muted mt-2">{t("truncated")}</p>}
            </div>
          )}
          {data && view === "raw" && (
            <pre className="panel-soft p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words max-h-[60vh] overflow-auto">{data.content}</pre>
          )}
          {data && view === "files" && (
            data.files.length ? (
              <ul className="panel-soft p-2 flex flex-col gap-0.5 font-mono text-xs">
                <li className="flex items-center gap-2 px-2 py-1"><FileText size={13} className="text-accent" />SKILL.md</li>
                {data.files.map((f) => (
                  <li key={f} className="flex items-center gap-2 px-2 py-1 break-all"><FileCode2 size={13} className="text-muted shrink-0" />{f}</li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">{t("only_skill_md")}</p>
          )}
          {data && view === "meta" && <MetaTable skill={data} frontmatter={data.frontmatter} />}
        </section>
      </div>
    </>
  );
}

function MetaTable({ skill, frontmatter }: { skill: SkillInfo; frontmatter: Record<string, unknown> }) {
  const t = useT(m);
  const rows: [string, string][] = [
    [t("meta_load_name"), skill.load_name],
    [t("meta_rel_path"), skill.rel_path],
    [t("meta_file"), skill.path],
    [t("meta_author"), skill.author ?? "—"],
    [t("meta_license"), skill.license ?? "—"],
    [t("meta_platforms"), skill.platforms.join(", ") || t("meta_all")],
    [t("meta_tags"), skill.tags.join(", ") || "—"],
    [t("meta_related"), skill.related.join(", ") || "—"],
    [t("meta_req_ts"), skill.requires_toolsets.join(", ") || "—"],
    [t("meta_req_env"), skill.required_env.join(", ") || "—"],
    [t("meta_use_count"), fmtNumber(skill.use_count)],
    [t("meta_size"), tp(m, "chars_n", skill.size_chars)],
  ];
  return (
    <div className="flex flex-col gap-3">
      <dl className="panel-soft divide-y-2 divide-line-soft text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-1 sm:grid-cols-[11rem_1fr] gap-x-3 gap-y-0.5 px-3 py-2">
            <dt className="text-muted">{k}</dt>
            <dd className="font-mono text-xs break-all self-center">{v}</dd>
          </div>
        ))}
      </dl>
      <details className="panel-soft p-3 text-xs">
        <summary className="cursor-pointer text-sm font-semibold">{t("raw_frontmatter")}</summary>
        <pre className="font-mono mt-2 whitespace-pre-wrap break-words">{JSON.stringify(frontmatter, null, 2)}</pre>
      </details>
    </div>
  );
}

/** Kütüphaneden bir ya da birden çok ajana atama: yalnızca bu profili kullanan Hermes ajanları seçilebilir. */
function AssignSection({ skill, profile, onChanged, onOpenAgent }: { skill: SkillInfo; profile: string; onChanged: () => void; onOpenAgent: (slug: string) => void }) {
  const t = useT(m);
  const agents = useStudio((s) => s.agents);
  const upsert = useStudio((s) => s.upsertAgent);
  const keys = useMemo(() => new Set([skill.name, skill.load_name, skill.rel_path]), [skill]);
  const has = (a: Agent) => (a.skills ?? []).some((x) => keys.has(x));
  const eligible = agents.filter((a) => a.runtime === "hermes" && (a.hermes_profile || "default") === profile);
  const others = agents.filter((a) => !eligible.includes(a));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(eligible.filter(has).map((a) => a.slug)));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const users = agents.filter(has).map((a) => ({ slug: a.slug, name: a.name, color: a.color }));

  const changed = eligible.filter((a) => picked.has(a.slug) !== has(a));
  const save = async () => {
    setBusy(true);
    setMsg(null);
    const errors: string[] = [];
    for (const a of changed) {
      const cur = a.skills ?? [];
      const next = picked.has(a.slug) ? [...cur, skill.load_name] : cur.filter((x) => !keys.has(x));
      try {
        upsert(await api.updateAgent(a.slug, { skills: next }));
      } catch (e) {
        errors.push(`${a.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setBusy(false);
    setMsg(errors.length ? { tone: "bad", text: errors.join(" · ") } : { tone: "ok", text: tp(m, "updated_n", changed.length) });
    onChanged();
  };

  return (
    <section className="flex flex-col gap-3">
      <div>
        <SectionTitle>{t("used_by")}</SectionTitle>
        <AgentChips agents={users} onOpen={onOpenAgent} />
      </div>
      <div className="panel-soft p-3 flex flex-col gap-2">
        <SectionTitle>{t("assign")}</SectionTitle>
        {!skill.loadable ? (
          <p className="text-sm text-muted">{t("not_loadable")}</p>
        ) : eligible.length === 0 ? (
          <p className="text-sm text-muted">{t("no_eligible", { profile })}</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {eligible.map((a) => {
                const on = picked.has(a.slug);
                return (
                  <li key={a.slug}>
                    <label className={clsx("flex items-center gap-2.5 rounded-lg px-2 py-1.5 cursor-pointer hover:bg-panel", on && "bg-panel")}>
                      <input type="checkbox" className="h-4 w-4 accent-[var(--grass)]" aria-label={a.name} checked={on}
                        onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(a.slug)) n.delete(a.slug); else n.add(a.slug); return n; })} />
                      <span className="h-3 w-3 rounded-full border border-line shrink-0" style={{ background: a.color }} />
                      <span className="text-sm font-semibold flex-1 min-w-0 truncate">{a.name}</span>
                      {has(a) && <Badge tone="ok"><Check size={12} />{t("assigned")}</Badge>}
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="primary" icon={<UserPlus size={14} />} disabled={busy || !changed.length} onClick={save}>
                {busy ? t("saving") : changed.length ? tp(m, "save_n", changed.length) : t("save")}
              </Button>
              {msg && <span className={clsx("text-xs font-medium", msg.tone === "ok" ? "text-ok" : "text-bad")}>{msg.text}</span>}
            </div>
          </>
        )}
        {others.length > 0 && eligible.length > 0 && (
          <p className="text-xs text-muted">{tp(m, "others_hidden", others.length)}</p>
        )}
      </div>
    </section>
  );
}
