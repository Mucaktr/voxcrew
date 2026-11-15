// Ekip S12: /ajanlar/:slug — tam ajan profili. Bölüm adres çubuğunda:
// ?tab=genel|kimlik|gorunum|beyin|yetenekler|skiller|boosterlar|kisilik|bellek|gecmis|takdir
// W1c: `takdir` sekmesi "Neyi takdir ettin", başlıkta "Teşekkür et / İkram et" ve keyif göstergesi.
// S20: `skiller` (S14 AgentSkills) ve `boosterlar` (S17 AgentBoosters) sekmeleri eklendi; metinler i18n.
import { ArrowLeft, Check, Eye, EyeOff, Send, Trash2, UserX } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { agentAvailability, agentMood, rankLabel } from "../../lib/agents";
import { MOOD_LABEL } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useOffice } from "../../lib/office";
import { useStudio } from "../../lib/store";
import type { Agent, Avatar } from "../../lib/types";
import { agentsMsg as m } from "../../locales/agents";
import { normalizeAvatar } from "../../voxel/avatar";
import { AvatarEditor } from "../AvatarEditor";
import { BrainPicker } from "../BrainPicker";
import { AgentLevelChip } from "../game/AgentLevelChip";
import { WeeklyPickBadge } from "../game/album/WeeklyPickBadge";
import { AgentCapabilities } from "../hermes/AgentCapabilities";
import { ConfirmDialog, Note } from "../hermes/common";
import { AgentSkills } from "../skills/AgentSkills";
import { Badge, Button, NotFound, Panel, Spinner, TabPanel, Tabs } from "../ui";
import { AgentStage } from "./AgentStage";
import { BrainBadge, HiddenBadge, HiredBadge, RankBadge, StatusBadge, TeamChip } from "./common";
import { CareerCard, OrgCard, RecentRunsCard } from "./ProfileAside";
import { AgentTools } from "../tools/AgentTools";  // S27: MCP araç politikası
import { ClaudeIsolationCard } from "./ClaudeIsolationCard";
import { CodexIsolationCard } from "./CodexIsolationCard";  // PROC-FIX
import { AgentBoosters, MoodIndicator, RecognitionTab, ThankButton, useRecognitionTabLabel } from "../../full/ui";
import { EDITION } from "../../edition";
import { GraphMemoryTab, HermesTab, HistoryTab, IdentityTab, OverviewTab, type ProfileTab } from "./ProfileTabs";

const ALL_TAB_KEYS: { value: ProfileTab; key: keyof typeof m.tr | "recognition" }[] = [
  { value: "genel", key: "tab_general" },
  { value: "kimlik", key: "tab_identity" },
  { value: "gorunum", key: "tab_look" },
  { value: "beyin", key: "tab_brain" },
  { value: "yetenekler", key: "tab_caps" },
  { value: "araclar", key: "tab_tools" },
  { value: "skiller", key: "tab_skills" },
  { value: "boosterlar", key: "tab_boosters" },
  { value: "kisilik", key: "tab_soul" },
  { value: "bellek", key: "tab_memory" },
  { value: "gecmis", key: "tab_history" },
  { value: "takdir", key: "recognition" },
];
// Ücretsiz sürümde booster ve takdir sekmeleri yok (içerikleri full/ui'dadır)
const TAB_KEYS = (EDITION as string) === "free" ? ALL_TAB_KEYS.filter((x) => x.value !== "boosterlar" && x.value !== "takdir") : ALL_TAB_KEYS;
const isTab = (v: string | null): v is ProfileTab => !!v && TAB_KEYS.some((t) => t.value === v);

export function AgentProfile({ slug }: { slug: string }) {
  const t = useT(m);
  const agents = useStudio((s) => s.agents);
  const agent = useMemo(() => agents.find((a) => a.slug === slug), [agents, slug]);
  if (!agent) {
    return (
      <div className="p-3 sm:p-5 max-w-[900px] mx-auto flex flex-col gap-4">
        <BackLink />
        {/* tek başlık (h1); ortak NotFound deseni*/}
        <Panel>
          <NotFound level="h1" title={t("not_found")} text={t("not_found_text", { slug })} backTo="/ajanlar" backLabel={t("all_agents")} />
        </Panel>
      </div>
    );
  }
  return <ProfileView key={agent.slug} agent={agent} />;
}

function BackLink() {
  const t = useT(m);
  return (
    <nav aria-label={t("breadcrumb")}>
      <Link to="/ajanlar" className="inline-flex items-center gap-1 text-sm text-link font-semibold hover:underline underline-offset-2">
        <ArrowLeft size={15} aria-hidden />{t("back")}
      </Link>
    </nav>
  );
}

function ProfileView({ agent }: { agent: Agent }) {
  const t = useT(m);
  const agents = useStudio((s) => s.agents);
  const states = useStudio((s) => s.states);
  const conns = useStudio((s) => s.connections);
  const models = useStudio((s) => s.models);
  const runList = useStudio((s) => s.runList);
  const upsert = useStudio((s) => s.upsertAgent);
  const openComposer = useStudio((s) => s.openComposer);
  const teams = useOffice((s) => s.teams);
  const officeLoaded = useOffice((s) => s.loaded);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: ProfileTab = isTab(raw) ? raw : "genel";
  const recognitionLabel = useRecognitionTabLabel();
  const tabs = useMemo(() => TAB_KEYS.map((x) => ({ value: x.value, label: x.key === "recognition" ? recognitionLabel : t(x.key) })), [t, recognitionLabel]);

  useEffect(() => { if (!officeLoaded) void useOffice.getState().refresh(); }, [officeLoaded]);
  // çekmece bu ajan için açıksa kapat (profil ve çekmece aynı anda düzenlemesin)
  useEffect(() => {
    if (useStudio.getState().selectedAgent === agent.slug) useStudio.getState().selectAgent(null);
  }, [agent.slug]);

  const setTab = (next: ProfileTab) => setParams((p) => {
    const q = new URLSearchParams(p);
    if (next === "genel") q.delete("tab"); else q.set("tab", next);
    return q;
  }, { replace: true });

  const mood = agentMood(agent, states, conns);
  const avail = agentAvailability(agent, conns);
  const st = states[agent.slug] ?? agent.state;
  const busy = mood === "thinking" || mood === "working" || mood === "waiting";
  const team = agent.team ? teams.find((x) => x.slug === agent.team) ?? null : null;

  // ---- kaydetme (çekmeceyle aynı yol: PATCH /api/agents/{slug})
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
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

  // ---- görünüm: canlı taslak + gecikmeli kayıt; dış güncellemede taslağı eşitle
  const [avatar, setAvatar] = useState<Avatar>(() => normalizeAvatar(agent.avatar));
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef(false);
  const avatarSig = JSON.stringify(agent.avatar ?? null);
  useEffect(() => { if (!pending.current) setAvatar(normalizeAvatar(agent.avatar)); }, [avatarSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const changeAvatar = (a: Avatar) => {
    setAvatar(a);
    pending.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void patch({ avatar: a }).finally(() => { pending.current = false; }); }, 450);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // ---- gizle / sil (onaylı)
  const [confirm, setConfirm] = useState<"hide" | "delete" | null>(null);
  const [acting, setActing] = useState(false);
  const studioMade = agent.created_by !== "hermes";
  const doHide = async () => {
    setActing(true);
    await patch({ hidden: true });
    setActing(false);
    setConfirm(null);
  };
  const doDelete = async () => {
    setActing(true);
    setError(null);
    try {
      await api.deleteAgent(agent.slug);
      await useStudio.getState().refreshAgents();
      void useOffice.getState().refresh();
      navigate("/ajanlar", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setActing(false);
      setConfirm(null);
    }
  };
  const giveTask = () => openComposer(agent.slug);
  const tabsId = useId();
  const reporting = agentsReportingTo(agents, agent.slug);

  return (
    <div className="p-3 sm:p-5 max-w-[1400px] mx-auto flex flex-col gap-4">
      <BackLink />

      <section className="panel p-4 sm:p-5 grid gap-4 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] md:items-center" aria-labelledby="ajan-adi">
        <AgentStage avatar={avatar} mood={mood} color={agent.color} height={260}
          label={t("stage_label", { name: agent.name, mood: MOOD_LABEL[mood] })} />
        <div className="min-w-0 flex flex-col gap-3">
          <div className="min-w-0">
            {rankLabel(agent.rank) && <div className="t-overline text-muted mb-1">{rankLabel(agent.rank)}</div>}
            <h1 id="ajan-adi" className="page-title break-words">{agent.name} <AgentLevelChip slug={agent.slug} size={26} className="align-middle ml-1" /> <WeeklyPickBadge slug={agent.slug} className="align-middle" /></h1>
            <p className="page-subtitle break-words">
              {agent.title || t("no_title")}{team ? ` · ${team.name}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge mood={mood} />
            <RankBadge rank={agent.rank} />
            <TeamChip team={team} />
            <BrainBadge agent={agent} />
            {(agent.skills?.length ?? 0) > 0 && <Badge tone="ok">{t("skills_n", { n: agent.skills!.length })}</Badge>}
            <HiredBadge agent={agent} />
            <HiddenBadge agent={agent} />
            <MoodIndicator slug={agent.slug} />
            {agent.created_by === "hermes" && <Badge title={t("hermes_profile_title")}>{t("hermes_profile_badge")}</Badge>}
          </div>
          {!avail.ok ? (
            <Note tone="bad">{avail.reason}. <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setTab("beyin")}>{t("change_brain")}</button></Note>
          ) : busy && st?.activity ? (
            <p className="text-sm text-ink-2 break-words">
              {t("now", { activity: st.activity })}
              {st.run_id && <> · <Link to={`/gorevler/${encodeURIComponent(st.run_id)}`} className="text-link font-semibold hover:underline underline-offset-2">{t("open_run")}</Link></>}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<Send size={16} />} onClick={giveTask} disabled={agent.hidden}
              title={agent.hidden ? t("hidden_no_task") : undefined}>{t("give_task")}</Button>
            <ThankButton agent={agent} />
            {agent.hidden ? (
              <Button icon={<Eye size={16} />} onClick={() => void patch({ hidden: false })}>{t("show_world")}</Button>
            ) : (
              <Button variant="ghost" icon={<EyeOff size={16} />} onClick={() => setConfirm("hide")}>{t("hide")}</Button>
            )}
            {studioMade && (
              <Button variant="ghost" icon={agent.hired_by ? <UserX size={16} /> : <Trash2 size={16} />} onClick={() => setConfirm("delete")}>
                {agent.hired_by ? t("fire") : t("delete")}
              </Button>
            )}
            <span role="status" aria-live="polite" className="text-xs text-muted flex items-center gap-1 min-w-0">
              {saved === "saving" && <><Spinner size={13} /> {t("saving")}</>}
              {saved === "saved" && !error && <><Check size={13} className="text-ok" /> {t("saved")}</>}
              {error && <span className="text-bad font-semibold break-words">{error}</span>}
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <section className="panel min-w-0 flex flex-col overflow-clip" aria-label={t("tabs_label")}>
          <div className="pt-1"><Tabs id={tabsId} value={tab} onChange={setTab} tabs={tabs} label={t("tabs_label")} /></div>
          <TabPanel tabs={tabsId} value={tab} className="p-4 sm:p-5 min-w-0">
            {tab === "genel" && <OverviewTab agent={agent} runList={runList} conns={conns} onTab={setTab} />}
            {tab === "kimlik" && <IdentityTab agent={agent} agents={agents} teams={teams} />}
            {tab === "gorunum" && <AvatarEditor value={avatar} onChange={changeAvatar} name={agent.name} />}
            {tab === "beyin" && (
              <>
                <BrainPicker agent={agent} conns={conns} models={models} onPatch={(p) => void patch(p)} />
                {/* Claude Code ajanının kişisel ~/.claude kurulumu (varsayılan yalıtılmış)*/}
                {(agent.route?.connection ?? agent.connection) === "claude" && <ClaudeIsolationCard slug={agent.slug} />}
                {/* PROC-FIX GPT Codex ajanının kişisel Codex kurulumu ve web araması (varsayılan yalıtılmış, kapalı)*/}
                {(agent.route?.connection ?? agent.connection) === "codex" && <CodexIsolationCard slug={agent.slug} />}
              </>
            )}
            {tab === "yetenekler" && <AgentCapabilities agent={agent} onPatch={patch} />}
            {tab === "araclar" && <AgentTools slug={agent.slug} />}
            {tab === "skiller" && <AgentSkills slug={agent.slug} />}
            {tab === "boosterlar" && <AgentBoosters slug={agent.slug} />}
            {tab === "kisilik" && <HermesTab agent={agent} conns={conns} onTab={setTab} />}
            {tab === "bellek" && <GraphMemoryTab agent={agent} onPatch={patch} />}
            {tab === "gecmis" && <HistoryTab agent={agent} runList={runList} onTask={giveTask} />}
            {tab === "takdir" && <RecognitionTab agent={agent} />}
          </TabPanel>
        </section>

        <aside className="flex flex-col gap-4 min-w-0" aria-label={t("aside_label")}>
          <CareerCard agent={agent} />
          <OrgCard agent={agent} agents={agents} teams={teams} runList={runList} onEdit={() => setTab("kimlik")} />
          <RecentRunsCard agent={agent} runList={runList} onAll={() => setTab("gecmis")} onTask={giveTask} />
        </aside>
      </div>

      <ConfirmDialog open={confirm === "hide"} title={t("hide_q", { name: agent.name })} confirmLabel={t("hide")} busy={acting}
        onConfirm={() => void doHide()} onClose={() => setConfirm(null)}>
        <p>{t("hide_text1")}</p>
        <p>{t("hide_text2_a")}<b>{t("hide_text2_b")}</b>{t("hide_text2_c")}</p>
      </ConfirmDialog>
      <ConfirmDialog open={confirm === "delete"} danger busy={acting}
        title={agent.hired_by ? t("fire_q", { name: agent.name }) : t("delete_q", { name: agent.name })}
        confirmLabel={agent.hired_by ? t("fire") : t("delete")}
        onConfirm={() => void doDelete()} onClose={() => setConfirm(null)}>
        <p>{t("delete_text1")}</p>
        {reporting > 0 && <Note tone="warn">{t("delete_reports", { n: reporting })}</Note>}
        <p>{t("delete_text2_a")}<b>{t("hide")}</b>{t("delete_text2_b")}</p>
      </ConfirmDialog>
    </div>
  );
}

function agentsReportingTo(agents: Agent[], slug: string): number {
  return agents.reduce((n, a) => n + (a.reports_to === slug ? 1 : 0), 0);
}
