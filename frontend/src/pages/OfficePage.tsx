// Ekip S3 (Ofis) + S6 (Faz 3) — ekipler, rütbe katmanlı org şeması, roller, işe alınanlar, şablon galerisi
import { AlertTriangle, Building2, LayoutTemplate, Network, Plus, RefreshCw, UserCog, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { HiredPanel } from "../components/office/HiredPanel";
import { HANDOFF_COLOR, OrgChart } from "../components/office/OrgChart";
import { MemberDialog } from "../components/office/MemberDialog";
import { RolesPanel } from "../components/office/RolesPanel";
import { LobbyCard, TeamCard } from "../components/office/TeamCard";
import { TeamDialog } from "../components/office/TeamDialog";
import { WeeklyPickCard } from "../full/ui";
import { OfficeHealth } from "../components/game/OfficeHealth"; // ofis sağlığı (gerçek veri, sıralama yok)
import { InstantiateDialog, TemplateGallery } from "../components/office/TemplateGallery";
import { ensureHierarchySync, holderMap, resolveWorkflow, useHierarchy } from "../components/office/hierarchy";
import { Badge, Button, Empty, PageHeader, Panel, Segmented, Spinner } from "../components/ui";
import { LimitCardHost } from "../components/plan/LimitCard";
import { SeatRoster } from "../components/plan/SeatRoster";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { useOffice, type OfficeTemplate, type TeamInfo } from "../lib/office";
import { useStudio } from "../lib/store";
import type { Agent, Workflow } from "../lib/types";
import { officeMsg as m } from "../locales/office";

export default function OfficePage() {
  const t = useT(m);
  const agents = useStudio((s) => s.agents);
  // S39 (C-20): ayrı seçiciler — ofis deposunun ilgisiz alanları değişince sayfa yeniden çizilmesin
  const teams = useOffice((s) => s.teams);
  const templates = useOffice((s) => s.templates);
  const loaded = useOffice((s) => s.loaded);
  const error = useOffice((s) => s.error);
  const refresh = useOffice((s) => s.refresh);
  const roles = useHierarchy((s) => s.roles);
  const [scope, setScope] = useState<"teams" | "all" | "hired">("teams");
  const [actionError, setActionError] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [flow, setFlow] = useState<string | null>(null);
  const [editTeam, setEditTeam] = useState<TeamInfo | null | undefined>(undefined); // undefined: kapalı, null: yeni
  const [member, setMember] = useState<Agent | null>(null);
  const [installing, setInstalling] = useState<OfficeTemplate | null>(null);
  const gallery = useRef<HTMLDivElement>(null);

  const { hash } = useLocation();

  const loadWorkflows = useCallback(() => api.workflows().then(setWorkflows).catch(() => undefined), []);
  useEffect(() => {
    ensureHierarchySync();
    void refresh();
    void loadWorkflows();
    void useHierarchy.getState().refresh();
  }, [refresh, loadWorkflows]);
  // Dünyadaki tabelaya tıklanınca /ofis#ekip-<slug> → ilgili ekip kartına kaydır ve kısaca vurgula.
  useEffect(() => {
    if (!hash.startsWith("#ekip-") || !teams.length) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.animate([{ boxShadow: "0 0 0 4px var(--amethyst)" }, { boxShadow: "0 0 0 0 transparent" }], { duration: 1600, easing: "ease-out" });
  }, [hash, teams.length]);

  const visible = useMemo(() => agents.filter((a) => !a.hidden), [agents]);
  const { lobby, staffedAgents } = useMemo(() => {
    const slugs = new Set(teams.map((x) => x.slug));
    const inTeam = (a: Agent) => !!a.team && slugs.has(a.team);
    return { lobby: visible.filter((a) => !inTeam(a)), staffedAgents: visible.filter(inTeam) };
  }, [visible, teams]);
  const staffed = staffedAgents.length;
  // "İşe alınanlar" filtresi: işe alınan ajanlar ve onları işe alan yöneticiler (bağlam için)
  const hiredView = useMemo(() => {
    const hired = visible.filter((a) => a.hired_by);
    const bosses = new Set(hired.map((a) => a.hired_by!));
    return visible.filter((a) => a.hired_by || bosses.has(a.slug));
  }, [visible]);
  const hiredCount = useMemo(() => agents.filter((a) => a.hired_by).length, [agents]);
  const chartAgents = scope === "all" ? visible : scope === "hired" ? hiredView : staffedAgents;

  // Teslim çizgileri için akış: ekip üyelerini kullanan akışlar (rol adımları rol sahibine çözülür);
  // varsayılan, kurulu şablonun sprint akışı.
  const holders = useMemo(() => holderMap(roles), [roles]);
  const resolvedFlows = useMemo(() => workflows.map((w) => resolveWorkflow(w, holders)!).filter(Boolean), [workflows, holders]);
  const flowOptions = useMemo(() => {
    const slugs = new Set(visible.map((a) => a.slug));
    return resolvedFlows.filter((w) => !w.error && w.steps.filter((s) => s.type !== "approval" && s.agent && slugs.has(s.agent)).length >= 2);
  }, [resolvedFlows, visible]);
  useEffect(() => {
    if (flow !== null || !flowOptions.length || !loaded) return;
    const known = templates.map((x) => x.workflow);
    const staffedSet = new Set(staffedAgents.map((a) => a.slug));
    const score = (w: Workflow) => w.steps.filter((s) => s.agent && staffedSet.has(s.agent)).length;
    const preferred = flowOptions.find((w) => known.some((k) => w.slug === k || w.slug.endsWith(`-${k}`)) && score(w) > 0);
    const best = preferred ?? [...flowOptions].sort((a, b) => score(b) - score(a))[0];
    if (best && score(best) > 0) setFlow(best.slug);
  }, [flowOptions, templates, flow, loaded, staffedAgents]);
  const activeFlow = flowOptions.find((w) => w.slug === flow) ?? null;

  // Sırayla: sunucuda eşzamanlı graf okumaları güvenli değil (teknik lidere bildirildi), istekleri üst üste bindirme.
  const changed = useCallback(async () => {
    await useStudio.getState().refreshAgents();
    await refresh();
    await useHierarchy.getState().refresh();
  }, [refresh]);
  // QA-m11: düğme işleyicilerinde yakalanmayan söz reddi yerine görünür hata
  const reload = () => {
    setActionError(null);
    changed().catch((e: unknown) => setActionError(e instanceof Error ? e.message : String(e)));
    void loadWorkflows();
  };

  const openGallery = () => gallery.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (!loaded && !teams.length) {
    return <div className="p-10 grid place-items-center"><Spinner size={24} /></div>;
  }

  const galleryPanel = (
    <div ref={gallery} className="scroll-mt-4">
      <Panel title={t("templates")} icon={<LayoutTemplate size={16} />}
        actions={<span className="text-xs text-muted hidden sm:inline">{t("templates_hint")}</span>}>
        <TemplateGallery templates={templates} agents={agents} onInstall={setInstalling} />
      </Panel>
    </div>
  );

  return (
    <div className="p-3 sm:p-5 flex flex-col gap-4 max-w-[1500px] mx-auto">
      <PageHeader title={t("page_title")} subtitle={t("page_subtitle")}
        meta={<>
          <Badge tone="info"><Users size={12} />{t("n_teams", { n: teams.length })}</Badge>
          <Badge tone="ok">{t("n_staffed", { n: staffed })}</Badge>
          <Badge tone={lobby.length ? "warn" : "muted"}>{t("n_lobby", { n: lobby.length })}</Badge>
          {roles.length > 0 && <Badge tone="muted"><UserCog size={12} />{t("n_roles", { n: roles.length })}</Badge>}
          {hiredCount > 0 && <Badge tone="info"><UserPlus size={12} />{t("n_hired", { n: hiredCount })}</Badge>}
        </>}
        actions={<>
          <Button icon={<RefreshCw size={15} />} onClick={reload} aria-label={t("refresh")} title={t("refresh")} />
          <Button icon={<LayoutTemplate size={16} />} onClick={openGallery}>{t("from_template")}</Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditTeam(null)}>{t("create_team")}</Button>
        </>} />

      {error && <p className="panel-soft p-3 text-sm font-semibold text-bad flex items-start gap-2" role="alert"><AlertTriangle size={16} className="shrink-0 mt-0.5" />{t("office_error", { error })}</p>}
      {actionError && <p className="panel-soft p-3 text-sm font-semibold text-bad flex items-start gap-2" role="alert"><AlertTriangle size={16} className="shrink-0 mt-0.5" />{actionError}</p>}
      {/* sınır kartı (modal değil) — şablon kurulumu ve işe alımda koltuk dolarsa*/}
      <LimitCardHost onRoster={() => document.getElementById("kadro")?.scrollIntoView({ behavior: "smooth", block: "start" })} />

      {/* W1c: haftanın çalışanı — yalnızca kullanıcı seçer (aday önerisi ve sıralama yok) */}
      {agents.length > 0 && <WeeklyPickCard agents={agents} />}
      {agents.length > 0 && <OfficeHealth />}

      {!teams.length && (
        <>
          <Panel>
            <Empty icon={<Building2 size={30} />} title={t("no_office")} text={t("no_office_text")}
              action={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditTeam(null)}>{t("create_empty_team")}</Button>} />
          </Panel>
          {galleryPanel}
        </>
      )}

      {teams.length > 0 && (
        <Panel title={t("org_chart")} icon={<Network size={16} />}
          actions={<Segmented value={scope} onChange={setScope}
            options={[{ value: "teams", label: t("scope_teams") }, { value: "all", label: t("scope_all") },
                      { value: "hired", label: t("scope_hired"), disabled: !hiredCount,
                        title: hiredCount ? t("scope_hired_title") : t("scope_hired_none") }]} />}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-2 text-xs text-ink-2">
            <span className="flex items-center gap-1.5"><svg width="28" height="8" aria-hidden><line x1="0" y1="4" x2="28" y2="4" stroke="var(--ink-2)" strokeWidth="2" /></svg>{t("legend_reports")}</span>
            <span className="flex items-center gap-1.5">
              <svg width="28" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke={HANDOFF_COLOR} strokeWidth="2" strokeDasharray="5 4" /><path d="M22 0 L28 4 L22 8 Z" fill={HANDOFF_COLOR} /></svg>
              {t("legend_handoff")}
            </span>
            <label className="flex items-center gap-1.5 min-w-0">
              <span className="sr-only sm:not-sr-only">{t("flow_label")}</span>
              <select className="select !w-auto !py-1 !text-xs max-w-[220px]" value={flow ?? ""} onChange={(e) => setFlow(e.target.value)}>
                <option value="">{t("flow_hide")}</option>
                {flowOptions.map((w) => <option key={w.slug} value={w.slug}>{w.name}</option>)}
              </select>
            </label>
            <span className="ml-auto hidden md:inline text-muted">{t("click_hint")}</span>
          </div>
          {chartAgents.length ? (
            <OrgChart agents={chartAgents} teams={teams} includeLoose={scope !== "teams"} workflow={activeFlow} />
          ) : (
            <Empty title={t("chart_empty")} text={t("chart_empty_text")} />
          )}
          <p className="mt-2 text-xs text-muted">{t("bands_note")}</p>
        </Panel>
      )}

      {(teams.length > 0 || roles.length > 0) && (
        <Panel title={t("roles")} icon={<UserCog size={16} />}
          actions={<span className="text-xs text-muted hidden sm:inline">{t("roles_hint")}</span>}>
          <RolesPanel roles={roles} agents={agents} teams={teams} onChanged={changed} />
        </Panel>
      )}

      {hiredCount > 0 && (
        <Panel title={t("hired_panel")} icon={<UserPlus size={16} />}
          actions={<span className="text-xs text-muted hidden sm:inline">{t("hired_hint")}</span>}>
          <HiredPanel agents={agents} onChanged={changed} />
        </Panel>
      )}

      {teams.length > 0 && (
        <Panel title={t("teams")} icon={<Users size={16} />}
          actions={<Button size="sm" icon={<Plus size={14} />} onClick={() => setEditTeam(null)}>{t("team")}</Button>}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {teams.map((x) => (
              <TeamCard key={x.slug} team={x} agents={agents} allAgents={agents} onEdit={() => setEditTeam(x)}
                onMember={setMember} onChanged={changed} />
            ))}
            <LobbyCard agents={lobby} teams={teams} onMember={setMember} onChanged={changed} />
          </div>
        </Panel>
      )}

      {/* kadro (etkin / yedek); fazla ajan silinmez, yedekte bekler*/}
      <SeatRoster />

      {teams.length > 0 && galleryPanel}

      <TeamDialog open={editTeam !== undefined} team={editTeam ?? null} onClose={() => setEditTeam(undefined)} onSaved={changed} />
      <MemberDialog agent={member} teams={teams} agents={visible} onClose={() => setMember(null)} onSaved={changed} />
      <InstantiateDialog template={installing} agents={agents} onClose={() => setInstalling(null)}
        onDone={async () => { await changed(); await loadWorkflows(); setFlow(null); }} />
    </div>
  );
}
