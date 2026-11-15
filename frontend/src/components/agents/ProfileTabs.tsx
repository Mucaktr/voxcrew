// Ekip S12: tam profil sekmeleri — Genel, Kimlik (+ organizasyon), SOUL ve Hermes belleği, graf belleği, görev geçmişi.
// Görünüm / Beyin / Yetenekler sekmeleri mevcut AvatarEditor, BrainPicker ve AgentCapabilities bileşenlerini doğrudan kullanır.
import clsx from "clsx";
import {
  Ban, BookOpen, Brain, Database, Eye, Feather, ListChecks, Network, Pencil, Pin, PinOff, RotateCcw, Route as RouteIcon, Save, Send, Wrench,
} from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { hermesSwitch } from "../../lib/agentBrain";
import {
  agentAvailability, agentRuns, agentStepStats, byName, managerWouldCycle, RANK_LABEL, rankConflict, rankLabel, RANKS, type Rank,
} from "../../lib/agents";
import { CONNECTION_META, timeAgo } from "../../lib/format";
import { hermesApi, REASONING_LABELS } from "../../lib/hermes";
import { useT } from "../../lib/i18n";
import { officeApi, useOffice, type MemberPatch, type TeamInfo } from "../../lib/office";
import { useStudio } from "../../lib/store";
import type { Agent, ConnectionInfo, GraphNode, Run } from "../../lib/types";
import { agentsMsg as m } from "../../locales/agents";
import { GiftMemoryBadge } from "../../full/ui";
import { CharMeter, ErrorBox, LoadingBlock, Note, useLoad } from "../hermes/common";
import { MemoryEditor, SoulEditor } from "../hermes/ProfileEditors";
import { Badge, Button, Empty, Field, Segmented, SectionTitle, Spinner, Swatches, Toggle } from "../ui";
import { RunRows } from "./ProfileAside";

export type ProfileTab = "genel" | "kimlik" | "gorunum" | "beyin" | "yetenekler" | "araclar" | "skiller" | "boosterlar" | "kisilik" | "bellek" | "gecmis" | "takdir";
type Patch = (p: Partial<Agent>) => Promise<unknown> | unknown;

const PALETTE = ["#7C5CFF", "#FF8A3D", "#10B981", "#EC4899", "#3B82F6", "#F59E0B", "#14B8A6", "#EF4444"];
const linkCls = "text-sm text-link font-semibold hover:underline underline-offset-2";

function Block({ title, icon, action, children }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 min-w-0">
      <SectionTitle as="h3" size="sm" icon={icon} actions={action}>{title}</SectionTitle>
      {children}
    </section>
  );
}

/**
 * "Hermes'e geçir" — Hermes kurulu ve erişilebilirse Beyin sekmesine götürür; değilse düğme devre dışı, nedeni yazılı
 * ve Bağlantılar sayfasına bağlantı (çıkmaz yok; Hermes isteğe bağlı).
*/
function HermesSwitchAction({ conns, label, onGo, button }:
  { conns: ConnectionInfo[]; label: string; onGo: () => void; button?: boolean }) {
  const t = useT(m);
  const hs = hermesSwitch(conns);
  const id = useId();
  if (hs.enabled) {
    return button ? <Button onClick={onGo}>{label}</Button>
      : <button type="button" className={linkCls} onClick={onGo}>{label}</button>;
  }
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
      <Button size={button ? undefined : "sm"} disabled aria-describedby={id}>{label}</Button>
      <span id={id} className="text-xs text-muted break-words">
        {hs.reason === "unreachable" ? t("hermes_off_unreachable") : t("hermes_off_missing")}
      </span>
      <Link to="/baglantilar" className={linkCls}>{t("hermes_go_connections")}</Link>
    </span>
  );
}

// ====================================================================== Genel
export function OverviewTab({ agent, runList, conns, onTab }:
  { agent: Agent; runList: Run[]; conns: ConnectionInfo[]; onTab: (t: ProfileTab) => void }) {
  const t = useT(m);
  const stats = useMemo(() => agentStepStats(runList, agent.slug), [runList, agent.slug]);
  const avail = agentAvailability(agent, conns);
  const viaHermes = agent.runtime === "hermes";
  const skills = agent.skills ?? [];
  const toolsets = agent.toolsets ?? [];
  const conn = agent.route?.connection ?? agent.connection;
  const kpis: [string, ReactNode, boolean?][] = [
    [t("kpi_runs"), stats.runs],
    [t("kpi_done"), stats.done],
    [t("kpi_failed"), stats.failed],
    [t("kpi_last"), stats.last ? timeAgo(stats.last) : "—", true],
  ];
  const transportMode = agent.transport === "cli" ? "CLI" : agent.transport === "api" ? "API" : t("transport_auto");
  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t("numbers")} className="flex flex-col gap-1.5">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {kpis.map(([label, value, text]) => (
            <div key={label} className="panel-soft p-3 min-w-0">
              <dt className="text-xs text-muted font-medium truncate">{label}</dt>
              <dd className={text ? "t-h4 mt-1 break-words" : "t-kpi truncate"}>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted">{t("kpi_note")}</p>
      </section>

      <Block title={t("role_block")} icon={<Pencil size={15} />}
        action={<Button size="sm" variant="ghost" onClick={() => onTab("kimlik")}>{t("edit")}</Button>}>
        {agent.role || agent.persona ? (
          <div className="flex flex-col gap-2 text-sm">
            {agent.role && <p className="whitespace-pre-wrap break-words"><b className="text-ink-2">{t("role_label")}</b>{agent.role}</p>}
            {agent.persona && <p className="whitespace-pre-wrap break-words text-ink-2"><b>{t("persona_label")}</b>{agent.persona}</p>}
          </div>
        ) : <p className="text-sm text-muted">{t("role_empty")}</p>}
      </Block>

      <Block title={t("brain_block")} icon={<RouteIcon size={15} />}
        action={<Button size="sm" variant={agent.needs_brain ? "primary" : "ghost"} onClick={() => onTab("beyin")}>{agent.needs_brain ? t("pick_brain") : t("change")}</Button>}>
        <div className={clsx("rounded-lg border-2 p-3 text-sm flex flex-col gap-1", agent.needs_brain ? "tone-warn" : !avail.ok ? "tone-bad" : agent.route?.warning ? "tone-warn" : "tone-ok")}>
          <span className="font-semibold break-words">{agent.needs_brain ? t("no_brain_title") : agent.route_error ? t("route_unresolved") : agent.route?.label ?? CONNECTION_META[conn]?.label}</span>
          {agent.needs_brain ? <span className="text-xs break-words">{t("no_brain_hint")}</span> : (agent.route_error || agent.route?.warning || !avail.ok) && (
            <span className="text-xs break-words">{agent.route_error || (!avail.ok ? avail.reason : agent.route?.warning)}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge>{viaHermes ? t("via_hermes", { profile: agent.hermes_profile ?? "default" }) : t("direct")}</Badge>
          <Badge>{agent.permissions === "write" ? t("perm_write") : t("perm_read")}</Badge>
          {viaHermes && <Badge>{t("transport", { mode: transportMode })}</Badge>}
        </div>
      </Block>

      <Block title={t("caps_block")} icon={<BookOpen size={15} />}
        action={<Button size="sm" variant="ghost" onClick={() => onTab("yetenekler")}>{viaHermes ? t("load_skill") : t("details")}</Button>}>
        {!viaHermes ? (
          <div className="flex flex-col items-start gap-1.5">
            <p className="text-sm text-muted">{t("caps_hermes_only")}</p>
            <HermesSwitchAction conns={conns} label={t("switch_hermes")} onGo={() => onTab("beyin")} />
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted font-medium mr-1">{t("skills_label")}</span>
              {skills.length ? skills.slice(0, 12).map((s) => <Badge key={s} tone="ok"><span className="font-mono">{s}</span></Badge>)
                : <span className="text-muted">{t("no_skills")}</span>}
              {skills.length > 12 && <Badge>+{skills.length - 12}</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted font-medium mr-1"><Wrench size={12} className="inline -mt-0.5" aria-hidden /> {t("toolsets")}</span>
              {toolsets.length ? toolsets.map((x) => <Badge key={x}><span className="font-mono">{x}</span></Badge>)
                : <span className="text-muted">{t("profile_default")}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted font-medium mr-1"><Brain size={12} className="inline -mt-0.5" aria-hidden /> {t("reasoning")}</span>
              <Badge>{agent.reasoning ? REASONING_LABELS[agent.reasoning] ?? agent.reasoning : t("profile_default")}</Badge>
            </div>
          </div>
        )}
      </Block>
    </div>
  );
}

// ====================================================================== Kimlik + organizasyon
interface IdentityForm {
  name: string; title: string; role: string; persona: string; color: string;
  rank: Rank | ""; team: string; reports_to: string;
}
const formOf = (a: Agent): IdentityForm => ({
  name: a.name, title: a.title ?? "", role: a.role ?? "", persona: a.persona ?? "", color: a.color,
  rank: (a.rank ?? "") as Rank | "", team: a.team ?? "", reports_to: a.reports_to ?? "",
});
const same = (a: IdentityForm, b: IdentityForm) => (Object.keys(a) as (keyof IdentityForm)[]).every((k) => a[k] === b[k]);

export function IdentityTab({ agent, agents, teams }: { agent: Agent; agents: Agent[]; teams: TeamInfo[] }) {
  const t = useT(m);
  const upsert = useStudio((s) => s.upsertAgent);
  const initial = useMemo(() => formOf(agent), [agent]);
  const [base, setBase] = useState(initial);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // ajan dışarıdan güncellenirse (olay, başka sekme) ve form kirli değilse yeni değerleri al
  useEffect(() => {
    setForm((f) => (same(f, base) ? initial : f));
    setBase(initial);
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !same(form, base);
  const set = <K extends keyof IdentityForm>(k: K, v: IdentityForm[K]) => { setSaved(false); setForm((f) => ({ ...f, [k]: v })); };
  const bossOptions = useMemo(() => agents.filter((a) => a.slug !== agent.slug && (!a.hidden || a.slug === agent.reports_to))
    .sort(byName), [agents, agent.slug, agent.reports_to]);
  const manager = agents.find((a) => a.slug === form.reports_to);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const basic: Partial<Agent> = {};
      if (form.name !== base.name) basic.name = form.name.trim();
      if (form.role !== base.role) basic.role = form.role;
      if (form.persona !== base.persona) basic.persona = form.persona;
      if (form.color !== base.color) basic.color = form.color;
      if (form.rank !== base.rank) basic.rank = form.rank || null;
      const org: MemberPatch = {};
      if (form.title !== base.title) org.title = form.title.trim() || null;
      if (form.team !== base.team) org.team = form.team || null;
      if (form.reports_to !== base.reports_to) org.reports_to = form.reports_to || null;
      let latest: Agent | null = null;
      if (Object.keys(basic).length) latest = await api.updateAgent(agent.slug, basic);
      if (Object.keys(org).length) {
        // ofis API'si ekip liderliğini ve MEMBER_OF / REPORTS_TO kenarlarını birlikte günceller
        latest = (await officeApi.assign(agent.slug, org)) as unknown as Agent;
        void useOffice.getState().refresh();
      }
      if (latest) upsert(latest);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => { e.preventDefault(); if (dirty && form.name.trim()) void save(); }}>
      <Block title={t("identity_block")} icon={<Pencil size={15} />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("name")}><input className="input" value={form.name} maxLength={60} required onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label={t("title")} hint={t("title_hint")}>
            <input className="input" value={form.title} maxLength={60} placeholder={t("title_placeholder")}
              onChange={(e) => set("title", e.target.value)} />
          </Field>
        </div>
        <Field label={t("role_field")} hint={t("role_hint")}>
          <textarea className="textarea" rows={2} value={form.role} onChange={(e) => set("role", e.target.value)} />
        </Field>
        <Field label={t("persona_field")} hint={t("persona_hint")}>
          <textarea className="textarea" rows={4} value={form.persona} onChange={(e) => set("persona", e.target.value)} />
        </Field>
        <Field label={t("color")}><Swatches colors={PALETTE} value={form.color} onChange={(c) => set("color", c)} /></Field>
        {agent.runtime === "hermes" && (
          <Note tone="muted" icon={<Feather size={15} />}>
            {t("soul_note_a")}<i>{t("soul_note_b")}</i>{t("soul_note_c")}
          </Note>
        )}
      </Block>

      <Block title={t("org_block")} icon={<Network size={15} />}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("rank")}>
            <select className="select" value={form.rank} onChange={(e) => set("rank", e.target.value as Rank | "")}>
              <option value="">{t("rank_none")}</option>
              {RANKS.map((r) => <option key={r} value={r}>{RANK_LABEL[r]}</option>)}
            </select>
          </Field>
          <Field label={t("team")}>
            <select className="select" value={form.team} onChange={(e) => set("team", e.target.value)}>
              <option value="">{t("f_team_none")}</option>
              {teams.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
            </select>
          </Field>
          <Field label={t("manager")} hint={t("manager_hint")}>
            <select className="select" value={form.reports_to} onChange={(e) => set("reports_to", e.target.value)}>
              <option value="">{t("manager_top")}</option>
              {bossOptions.map((a) => {
                const cyc = managerWouldCycle(agents, agent.slug, a.slug);
                return (
                  <option key={a.slug} value={a.slug} disabled={cyc}>
                    {a.name}{rankLabel(a.rank) ? ` — ${rankLabel(a.rank)}` : a.title ? ` — ${a.title}` : ""}{cyc ? t("cycle") : ""}
                  </option>
                );
              })}
            </select>
          </Field>
        </div>
        {manager && rankConflict(form.rank, manager.rank) && (
          <Note tone="warn">{t("rank_conflict", { name: manager.name, rank: rankLabel(manager.rank) })}</Note>
        )}
      </Block>

      <div className="flex flex-wrap items-center gap-2 border-t-2 border-line-soft pt-4">
        <Button variant="primary" icon={busy ? <Spinner size={14} /> : <Save size={16} />} disabled={!dirty || busy || !form.name.trim()}
          onClick={() => void save()}>{t("save")}</Button>
        <Button variant="ghost" disabled={!dirty || busy} onClick={() => { setForm(base); setError(null); }}>{t("revert")}</Button>
        <span role="status" aria-live="polite" className="text-sm">
          {error ? <span className="text-bad font-semibold">{error}</span> : saved && !dirty ? <span className="text-ok font-semibold">{t("saved_ok")}</span>
            : dirty ? <span className="text-muted">{t("unsaved")}</span> : null}
        </span>
      </div>
    </form>
  );
}

// ====================================================================== SOUL ve Hermes belleği
export function HermesTab({ agent, conns, onTab }: { agent: Agent; conns: ConnectionInfo[]; onTab: (t: ProfileTab) => void }) {
  const t = useT(m);
  if (agent.runtime !== "hermes") {
    return (
      <div className="flex flex-col gap-3 items-start">
        <Note tone="info" icon={<Feather size={15} />}>
          {t("soul_direct_a")}<b>{t("soul_direct_b")}</b>{t("soul_direct_c")}
        </Note>
        <div className="flex flex-wrap gap-2">
          <HermesSwitchAction conns={conns} label={t("soul_switch")} onGo={() => onTab("beyin")} button />
          <Button variant="ghost" onClick={() => onTab("bellek")}>{t("soul_goto_graph")}</Button>
        </div>
      </div>
    );
  }
  return <HermesFiles profile={agent.hermes_profile || "default"} slug={agent.slug} />;
}

function HermesFiles({ profile, slug }: { profile: string; slug: string }) {
  const t = useT(m);
  const soul = useLoad(() => hermesApi.soul(profile), [profile]);
  const mem = useLoad(() => hermesApi.memory(profile), [profile]);
  const [edit, setEdit] = useState<"soul" | "memory" | null>(null);
  const text = soul.data?.content.trim() ?? "";
  const others = (soul.data?.agents ?? []).filter((a) => a.slug !== slug);

  return (
    <div className="flex flex-col gap-6">
      <Note tone="muted">
        {t("soul_profile_note_a")}<b>{t("soul_profile_note_b")}</b>{t("soul_profile_note_c")}<span className="font-mono">{profile}</span>{t("soul_profile_note_d")}
      </Note>

      <Block title={t("soul_block")} icon={<Feather size={15} />}
        action={<Button size="sm" icon={<Pencil size={14} />} disabled={!soul.data} onClick={() => setEdit("soul")}>{t("soul_edit")}</Button>}>
        {soul.error ? <ErrorBox error={soul.error} onRetry={soul.reload} /> : soul.loading && !soul.data ? <LoadingBlock label={t("soul_loading")} /> : soul.data && (
          <>
            {others.length > 0 && (
              <p className="text-xs text-warn font-semibold">{t("soul_shared", { names: others.map((a) => a.name).join(", ") })}</p>
            )}
            {text ? (
              <p className="text-sm whitespace-pre-wrap break-words leading-relaxed max-h-72 overflow-y-auto panel-soft p-3">
                {text.length > 2400 ? `${text.slice(0, 2400)}…` : text}
              </p>
            ) : <p className="text-sm text-muted panel-soft p-3">{t("soul_empty")}</p>}
            <p className="text-xs text-muted font-mono break-all">{soul.data.path}{soul.data.exists ? "" : t("soul_missing")}</p>
          </>
        )}
      </Block>

      <Block title={t("mem_block")} icon={<Database size={15} />}
        action={<Button size="sm" icon={<Pencil size={14} />} disabled={!mem.data} onClick={() => setEdit("memory")}>{t("mem_edit")}</Button>}>
        {mem.error ? <ErrorBox error={mem.error} onRetry={mem.reload} /> : mem.loading && !mem.data ? <LoadingBlock label={t("mem_loading")} /> : mem.data && (
          <div className="grid gap-4 md:grid-cols-2">
            {(["memory", "user"] as const).map((which) => {
              const f = mem.data![which];
              const label = which === "memory" ? t("mem_notes") : t("mem_user");
              return (
                <div key={which} className="panel-soft p-3 flex flex-col gap-2 min-w-0">
                  <CharMeter value={f.chars} limit={f.limit} label={label} />
                  {!mem.data!.enabled[which] && <span className="text-xs text-warn font-semibold">{t("mem_off")}</span>}
                  {f.entries.length === 0 ? <p className="text-sm text-muted">{t("mem_empty")}</p> : (
                    <ul className="flex flex-col gap-1 text-sm">
                      {f.entries.slice(0, 4).map((e, i) => <li key={i} className="line-clamp-2 break-words">• {e}</li>)}
                      {f.entries.length > 4 && <li className="text-xs text-muted">{t("mem_more", { n: f.entries.length - 4 })}</li>}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Block>

      <Link to={`/hermes/profiller?profil=${encodeURIComponent(profile)}`} className={linkCls}>{t("profile_link")}</Link>

      <SoulEditor profile={profile} open={edit === "soul"} onClose={() => setEdit(null)} onApplied={() => soul.reload()} />
      <MemoryEditor profile={profile} open={edit === "memory"} onClose={() => setEdit(null)} onApplied={() => mem.reload()} />
    </div>
  );
}

// ====================================================================== graf belleği
export function GraphMemoryTab({ agent, onPatch }: { agent: Agent; onPatch: Patch }) {
  const t = useT(m);
  const [data, setData] = useState<{ episodes: GraphNode[]; facts: GraphNode[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    api.agentMemory(agent.slug).then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(load, [agent.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (f: GraphNode, patch: { pinned?: boolean; invalid?: boolean }) => {
    try {
      const node = await api.factState(f.id, patch);
      setData((d) => d && { ...d, facts: d.facts.map((x) => (x.id === f.id ? { ...x, props: node.props } : x)) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Block title={t("gm_settings")} icon={<Brain size={15} />}>
        <Toggle checked={agent.memory_enabled} onChange={(v) => onPatch({ memory_enabled: v })} label={t("gm_on")} hint={t("gm_on_hint")} />
        <Field label={t("gm_scope")} hint={t("gm_scope_hint")}>
          <Segmented value={agent.memory_scope} onChange={(v) => onPatch({ memory_scope: v })}
            options={[{ value: "shared", label: t("gm_shared") }, { value: "private", label: t("gm_private") }]} />
        </Field>
      </Block>

      {error && <ErrorBox error={error} onRetry={load} />}
      {!data && !error ? <LoadingBlock label={t("gm_loading")} /> : data && (
        !data.episodes.length && !data.facts.length ? (
          <Empty icon={<Database size={24} />} title={t("gm_empty")} text={t("gm_empty_text")} />
        ) : (
          <>
            <Block title={t("gm_episodes", { n: data.episodes.length })}>
              <ul className="flex flex-col gap-2">
                {data.episodes.map((e) => (
                  <li key={e.id} className="panel-soft p-3 min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold min-w-0">
                      <span className="truncate flex-1">{String(e.props.title ?? e.label)}</span>
                      <GiftMemoryBadge source={String(e.props.source ?? "")} />
                      <span className="text-xs text-muted font-medium num shrink-0">{timeAgo(String(e.props.created_at ?? e.created_at ?? ""))}</span>
                    </div>
                    {!!e.props.summary && <p className="text-sm text-ink-2 mt-1 break-words">{String(e.props.summary)}</p>}
                    <Link to={`/bellek?focus=${encodeURIComponent(e.id)}`} className="text-xs text-link font-semibold mt-1.5 inline-block hover:underline underline-offset-2">{t("gm_view_graph")}</Link>
                  </li>
                ))}
              </ul>
            </Block>
            {data.facts.length > 0 && (
              <Block title={t("gm_facts", { n: data.facts.length })}>
                <ul className="flex flex-col gap-1.5">
                  {data.facts.map((f) => {
                    const invalid = !!f.props.invalid_at;
                    const pinned = !!f.props.pinned;
                    return (
                      <li key={f.id} className="text-sm flex gap-2 items-start">
                        <span className={clsx("mt-0.5 shrink-0", invalid ? "text-muted" : pinned ? "text-warn" : "text-accent")} aria-hidden>
                          {pinned ? <Pin size={14} /> : "◆"}
                        </span>
                        <span className={clsx("flex-1 min-w-0 break-words", invalid && "line-through text-muted")}>
                          {String(f.props.statement ?? f.label)}
                          {invalid && <span className="sr-only">{t("gm_invalid_sr")}</span>}
                          {pinned && <span className="sr-only">{t("gm_pinned_sr")}</span>}
                        </span>
                        <span className="flex gap-0.5 shrink-0">
                          {!invalid && <Button size="sm" variant="ghost" icon={pinned ? <PinOff size={14} /> : <Pin size={14} />}
                            title={pinned ? t("gm_unpin") : t("gm_pin_title")}
                            aria-label={pinned ? t("gm_unpin") : t("gm_pin")} onClick={() => void act(f, { pinned: !pinned })} />}
                          <Button size="sm" variant="ghost" icon={invalid ? <RotateCcw size={14} /> : <Ban size={14} />}
                            title={invalid ? t("gm_undo") : t("gm_invalidate_title")}
                            aria-label={invalid ? t("gm_uninvalidate") : t("gm_invalidate")} onClick={() => void act(f, { invalid: !invalid })} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Block>
            )}
          </>
        )
      )}
      <Link to={`/bellek`} className={linkCls}><Eye size={14} className="inline -mt-0.5" aria-hidden /> {t("gm_full_graph")}</Link>
    </div>
  );
}

// ====================================================================== görev geçmişi
export function HistoryTab({ agent, runList, onTask }: { agent: Agent; runList: Run[]; onTask: () => void }) {
  const t = useT(m);
  const runs = useMemo(() => agentRuns(runList, agent.slug), [runList, agent.slug]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted flex-1 min-w-[12rem]">{t("hist_summary", { name: agent.name, n: runs.length })}</p>
        {!agent.hidden && <Button variant="primary" size="sm" icon={<Send size={14} />} onClick={onTask}>{t("give_task")}</Button>}
        <Link to="/gorevler" className="btn btn-sm"><ListChecks size={14} aria-hidden />{t("all_runs")}</Link>
      </div>
      {runs.length === 0
        ? <Empty icon={<ListChecks size={24} />} title={t("hist_empty")} text={t("hist_empty_text")} />
        : <RunRows runs={runs} slug={agent.slug} />}
    </div>
  );
}
