import clsx from "clsx";
import { Ban, Check, EyeOff, Pin, PinOff, RotateCcw, Send, Trash2, X } from "lucide-react";
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { agentAvailability, agentMood } from "../lib/agents";
import { MOOD_LABEL, timeAgo } from "../lib/format";
import { useT } from "../lib/i18n";
import { useStudio } from "../lib/store";
import { agentsMsg } from "../locales/agents";
import { shell } from "../locales/shell";
import type { Agent, Avatar, GraphNode } from "../lib/types";
import { normalizeAvatar } from "../voxel/avatar";
import { BrainPicker } from "./BrainPicker";
import { AgentCapabilities, SoulExcerpt } from "./hermes/AgentCapabilities";
import { AgentTools } from "./tools/AgentTools";
import { toolsMsg } from "../locales/tools";
import { ConfirmDialog } from "./hermes/common";
import { PixelFace } from "./PixelFace";
import { AgentZoneLine } from "./workzones/WorkZones"; // WORK-ZONES: çalıştığı yer + varsayılan
import { Badge, Button, Drawer, Empty, Field, SectionTitle, Spinner, StatusPill, Swatches, TabPanel, Tabs, Toggle, Segmented } from "./ui";

type Tab = "look" | "brain" | "caps" | "tools" | "identity" | "memory" | "history";
const PALETTE = ["#7C5CFF", "#FF8A3D", "#10B981", "#EC4899", "#3B82F6", "#F59E0B", "#14B8A6", "#EF4444"];

// BUNDLE: görünüm sekmesi 3B avatar önizlemesi (three/R3F) içerir; yalnızca sekme açılınca yüklenir
const AvatarEditor = lazy(() => import("./AvatarEditor").then((m) => ({ default: m.AvatarEditor })));

export function AgentDrawer() {
  const slug = useStudio((s) => s.selectedAgent);
  const select = useStudio((s) => s.selectAgent);
  const agents = useStudio((s) => s.agents);
  const agent = agents.find((a) => a.slug === slug);
  return (
    <Drawer open={!!agent} onClose={() => select(null)} width={560} label={agent?.name}>
      {agent && <AgentPanel key={agent.slug} agent={agent} onClose={() => select(null)} />}
    </Drawer>
  );
}

function AgentPanel({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const states = useStudio((s) => s.states);
  const conns = useStudio((s) => s.connections);
  const models = useStudio((s) => s.models);
  const upsert = useStudio((s) => s.upsertAgent);
  const openComposer = useStudio((s) => s.openComposer);
  const [tab, setTab] = useState<Tab>("look");
  const tabsId = useId();
  const [avatar, setAvatar] = useState<Avatar>(() => normalizeAvatar(agent.avatar));
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const mood = agentMood(agent, states, conns);
  const avail = agentAvailability(agent, conns);
  const t = useT(shell);
  const ta = useT(agentsMsg);
  const tt = useT(toolsMsg);

  const patch = async (p: Partial<Agent>) => {
    setSaved("saving");
    setError(null);
    try {
      upsert(await api.updateAgent(agent.slug, p));
      setSaved("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaved("idle");
    }
  };

  const changeAvatar = (a: Avatar) => {
    setAvatar(a);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => patch({ avatar: a }), 450);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
      <header className="flex items-center gap-3 px-5 pt-5 pb-4">
        <PixelFace avatar={avatar} mood={mood} size={64} ring={agent.color} />
        <div className="min-w-0 flex-1">
          <h2 className="t-h3 truncate">{agent.name}</h2>
          <p className="text-sm text-muted truncate">{agent.role || t("no_role")}</p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <Badge tone={mood === "idle" ? "ok" : mood === "error" || mood === "offline" ? "bad" : "info"}>{MOOD_LABEL[mood]}</Badge>
            {agent.hermes_profile && <Badge>{t("profile_badge", { profile: agent.hermes_profile })}</Badge>}
            {!avail.ok && <Badge tone="bad" title={avail.reason}>{avail.reason}</Badge>}
          </div>
          <AgentZoneLine slug={agent.slug} />
          {/* S12: tam profil sayfası */}
          <Link to={`/ajanlar/${encodeURIComponent(agent.slug)}`} onClick={onClose}
            className="text-sm text-link font-semibold mt-1.5 inline-block hover:underline underline-offset-2">{t("open_full_profile")}</Link>
        </div>
        <Button variant="ghost" size="sm" icon={<X size={18} />} onClick={onClose} aria-label={t("close")} />
      </header>
      <Tabs id={tabsId} value={tab} onChange={setTab} label={t("agent_tabs")} tabs={[
        { value: "look", label: ta("tab_look") }, { value: "brain", label: ta("brain") }, { value: "caps", label: ta("tab_caps") }, { value: "tools", label: tt("tab") },
        { value: "identity", label: ta("tab_identity") }, { value: "memory", label: t("tab_memory") }, { value: "history", label: t("tab_history") },
      ]} />
      <TabPanel tabs={tabsId} value={tab} className="flex-1 overflow-y-auto p-5">
        {tab === "look" && <Suspense fallback={<div className="grid place-items-center py-10"><Spinner /></div>}><AvatarEditor value={avatar} onChange={changeAvatar} name={agent.name} /></Suspense>}
        {tab === "brain" && <BrainPicker agent={agent} conns={conns} models={models} onPatch={patch} />}
        {tab === "caps" && <AgentCapabilities agent={agent} onPatch={patch} />}
        {tab === "tools" && <AgentTools slug={agent.slug} />}
        {tab === "identity" && <Identity agent={agent} onSave={patch} />}
        {tab === "memory" && <AgentMemory slug={agent.slug} />}
        {tab === "history" && <History slug={agent.slug} />}
      </TabPanel>
      <footer className="px-5 py-3 border-t-2 border-line-soft flex items-center gap-2">
        <span className="text-xs text-muted flex items-center gap-1 mr-auto">
          {saved === "saving" && <><Spinner size={13} /> {ta("saving")}</>}
          {saved === "saved" && <><Check size={13} className="text-ok" /> {ta("saved")}</>}
          {error && <span className="text-bad">{error}</span>}
        </span>
        {agent.created_by === "hermes" ? (
          <Button size="sm" variant="ghost" icon={<EyeOff size={15} />} onClick={() => patch({ hidden: !agent.hidden })}>
            {agent.hidden ? ta("show_world") : ta("hide")}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon={<Trash2 size={15} />} onClick={() => setConfirmDelete(true)}>
            {ta("delete")}
          </Button>
        )}
        <Button variant="primary" icon={<Send size={15} />} onClick={() => openComposer(agent.slug)}>{t("give_task")}</Button>
      </footer>
      {/* S39: tarayıcının confirm() penceresi yerine uygulama içi onay (Ajan profili ile aynı metin) */}
      <ConfirmDialog open={confirmDelete} danger busy={deleting} title={ta("delete_q", { name: agent.name })} confirmLabel={ta("delete")}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await api.deleteAgent(agent.slug);
            setConfirmDelete(false); onClose(); useStudio.getState().refreshAgents();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e)); setConfirmDelete(false);
          } finally { setDeleting(false); }
        }}>
        <p>{ta("delete_text1")}</p>
      </ConfirmDialog>
    </>
  );
}

function Identity({ agent, onSave }: { agent: Agent; onSave: (p: Partial<Agent>) => void }) {
  const [form, setForm] = useState({ name: agent.name, role: agent.role, persona: agent.persona, color: agent.color,
    memory_enabled: agent.memory_enabled, memory_scope: agent.memory_scope });
  const dirty = JSON.stringify(form) !== JSON.stringify({ name: agent.name, role: agent.role, persona: agent.persona, color: agent.color,
    memory_enabled: agent.memory_enabled, memory_scope: agent.memory_scope });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const t = useT(shell);
  const ta = useT(agentsMsg);
  return (
    <div className="flex flex-col gap-4">
      <Field label={ta("name")}><input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
      <Field label={ta("role_field")} hint={t("role_hint_drawer")}>
        <textarea className="textarea" rows={2} value={form.role} onChange={(e) => set("role", e.target.value)} />
      </Field>
      <Field label={t("persona_field")} hint={t("persona_hint")}>
        <textarea className="textarea" rows={3} value={form.persona} onChange={(e) => set("persona", e.target.value)} />
      </Field>
      <SoulExcerpt agent={agent} />
      <Field label={ta("color")}><Swatches colors={PALETTE} value={form.color} onChange={(c) => set("color", c)} /></Field>
      <Toggle checked={form.memory_enabled} onChange={(v) => set("memory_enabled", v)} label={ta("gm_on")}
        hint={ta("gm_on_hint")} />
      <Field label={ta("gm_scope")} hint={ta("gm_scope_hint")}>
        <Segmented value={form.memory_scope} onChange={(v) => set("memory_scope", v)}
          options={[{ value: "shared", label: ta("gm_shared") }, { value: "private", label: ta("gm_private") }]} />
      </Field>
      <div><Button variant="primary" disabled={!dirty || !form.name.trim()} onClick={() => onSave(form)}>{ta("save")}</Button></div>
    </div>
  );
}

function AgentMemory({ slug }: { slug: string }) {
  const [data, setData] = useState<{ episodes: GraphNode[]; facts: GraphNode[] } | null>(null);
  const ta = useT(agentsMsg);
  useEffect(() => { api.agentMemory(slug).then(setData).catch(() => setData({ episodes: [], facts: [] })); }, [slug]);
  if (!data) return <div className="grid place-items-center py-10"><Spinner /></div>;
  if (!data.episodes.length) return <Empty title={ta("gm_empty")} text={ta("gm_empty_text")} />;
  return (
    <div className="flex flex-col gap-4">
      <section>
        <SectionTitle as="h3" size="sm" className="mb-2">{ta("gm_episodes", { n: data.episodes.length })}</SectionTitle>
        <ul className="flex flex-col gap-2">
          {data.episodes.map((e) => (
            <li key={e.id} className="panel-soft p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="truncate flex-1">{String(e.props.title ?? e.label)}</span>
                <span className="text-xs text-muted font-medium num shrink-0">{timeAgo(String(e.props.created_at ?? e.created_at))}</span>
              </div>
              <p className="text-sm text-ink-2 mt-1">{String(e.props.summary ?? "")}</p>
              <Link to={`/bellek?focus=${e.id}`} className="text-xs text-link font-semibold mt-1.5 inline-block hover:underline underline-offset-2">{ta("gm_view_graph")}</Link>
            </li>
          ))}
        </ul>
      </section>
      {!!data.facts.length && (
        <section>
          <SectionTitle as="h3" size="sm" className="mb-2">{ta("gm_facts", { n: data.facts.length })}</SectionTitle>
          <ul className="flex flex-col gap-1.5">
            {data.facts.map((f) => {
              const invalid = !!f.props.invalid_at;
              const act = async (patch: { pinned?: boolean; invalid?: boolean }) => {
                const node = await api.factState(f.id, patch);
                setData((d) => d && { ...d, facts: d.facts.map((x) => (x.id === f.id ? { ...x, props: node.props } : x)) });
              };
              return (
                <li key={f.id} className={clsx("text-sm flex gap-2 items-start group", invalid && "opacity-50 line-through")}>
                  <span className={f.props.pinned ? "text-warn" : "text-accent"}>{f.props.pinned ? "📌" : "◆"}</span>
                  <span className="flex-1">{String(f.props.statement ?? f.label)}</span>
                  <span className="flex gap-0.5 shrink-0 opacity-60 group-hover:opacity-100">
                    {!invalid && <Button size="sm" variant="ghost" icon={f.props.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                      title={f.props.pinned ? ta("gm_unpin") : ta("gm_pin_title")} aria-label={f.props.pinned ? ta("gm_unpin") : ta("gm_pin")} onClick={() => act({ pinned: !f.props.pinned })} />}
                    <Button size="sm" variant="ghost" icon={invalid ? <RotateCcw size={13} /> : <Ban size={13} />}
                      title={invalid ? ta("gm_undo") : ta("gm_invalidate_title")} aria-label={invalid ? ta("gm_uninvalidate") : ta("gm_invalidate")} onClick={() => act({ invalid: !invalid })} />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function History({ slug }: { slug: string }) {
  const runList = useStudio((s) => s.runList);
  const runs = useMemo(() => runList.filter((r) => r.steps?.some((s) => s.agent === slug)), [runList, slug]);
  const ta = useT(agentsMsg);
  if (!runs.length) return <Empty title={ta("hist_empty")} />;
  return (
    <ul className="flex flex-col gap-1.5">
      {runs.map((r) => (
        <li key={r.id}>
          <Link to={`/gorevler/${r.id}`} className="flex items-center gap-2 panel-soft px-3 py-2 hover:border-ink-2">
            <span className="flex-1 min-w-0 truncate text-sm font-semibold">{r.title}</span>
            <span className="text-xs text-muted num shrink-0">{timeAgo(r.started_at)}</span>
            <StatusPill status={r.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
