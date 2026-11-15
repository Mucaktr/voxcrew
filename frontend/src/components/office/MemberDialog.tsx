import { AlertTriangle, Save, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { byName } from "../../lib/agents";
import { useT } from "../../lib/i18n";
import { type TeamInfo } from "../../lib/office";
import { useStudio } from "../../lib/store";
import type { Agent } from "../../lib/types";
import { officeMsg as m } from "../../locales/office";
import { PixelFace } from "../PixelFace";
import { Button, Field, Modal } from "../ui";
import { HiredBadge } from "./RankBadge";
import { RANK_LABELS, RANKS, hierarchyApi, isRank, rankConflict, useHierarchy, type Rank } from "./hierarchy";

/** `slug`'ın yöneticisi `boss` olursa döngü oluşur mu? (sunucu da reddeder; burada seçeneği baştan kapatırız) */
export function wouldCycle(agents: Agent[], slug: string, boss: string): boolean {
  const bySlug = new Map(agents.map((a) => [a.slug, a]));
  const seen = new Set<string>();
  let cur: string | null | undefined = boss;
  while (cur) {
    if (cur === slug || seen.has(cur)) return true;
    seen.add(cur);
    cur = bySlug.get(cur)?.reports_to;
  }
  return false;
}

/** Üyenin unvanı, rütbesi, rolü, ekibi ve raporladığı kişi — seçicilerle (sürükle-bırak gerekmez). */
export function MemberDialog({ agent, teams, agents, onClose, onSaved }:
  { agent: Agent | null; teams: TeamInfo[]; agents: Agent[]; onClose: () => void; onSaved: () => Promise<void> | void }) {
  const t = useT(m);
  const roles = useHierarchy((s) => s.roles);
  const members = useHierarchy((s) => s.members);
  const [title, setTitle] = useState("");
  const [team, setTeam] = useState("");
  const [boss, setBoss] = useState("");
  const [rank, setRank] = useState<Rank | "">("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const currentRole = useMemo(() => (agent ? members.find((x) => x.slug === agent.slug)?.role_id ?? "" : ""), [members, agent]);

  useEffect(() => {
    if (!agent) return;
    setTitle(agent.title ?? "");
    setTeam(agent.team ?? "");
    setBoss(agent.reports_to ?? "");
    setRank(isRank(agent.rank) ? agent.rank : "");
    setError(null);
    setWarnings([]);
  }, [agent]);
  useEffect(() => { setRole(currentRole); }, [currentRole]);

  const bossOptions = useMemo(() => (agent ? agents.filter((a) => a.slug !== agent.slug && !a.hidden).sort(byName) : []), [agents, agent]);

  if (!agent) return null;
  const bossAgent = agents.find((a) => a.slug === boss);
  const conflict = rankConflict({ ...agent, rank: rank || null } as Agent, bossAgent);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await hierarchyApi.assignX(agent.slug, {
        title: title.trim() || null, team: team || null, reports_to: boss || null, rank: rank || null,
        ...(role !== currentRole ? { role_id: role || null } : {}),
      });
      await onSaved();
      await useHierarchy.getState().refresh();
      if (res.warnings?.length) {
        setWarnings(res.warnings); // kaydedildi; rütbe uyarısını göstermek için açık kalır
      } else {
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!agent} onClose={onClose} width={520} title={t("member_edit")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button variant="primary" icon={<Save size={16} />} disabled={busy} onClick={save}>{t("save")}</Button>
      </>}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <PixelFace avatar={agent.avatar} size={52} ring={agent.color} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="panel-title truncate">{agent.name}</span>
              <HiredBadge by={agent.hired_by} className="shrink-0" />
            </div>
            <div className="text-sm text-ink-2 line-clamp-2">{agent.role || t("no_role_text")}</div>
          </div>
          <Button size="sm" icon={<SlidersHorizontal size={14} />} onClick={() => { onClose(); useStudio.getState().selectAgent(agent.slug); }}>
            {t("agent_settings")}
          </Button>
        </div>
        <Field label={t("title")} hint={t("title_hint")}>
          <input className="input" value={title} maxLength={60} placeholder={t("title_placeholder")}
            onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("rank")} hint={t("rank_hint")}>
            <select className="select" value={rank} onChange={(e) => setRank(e.target.value as Rank | "")}>
              <option value="">{t("rank_none")}</option>
              {RANKS.map((r) => <option key={r} value={r}>{RANK_LABELS[r]}</option>)}
            </select>
          </Field>
          <Field label={t("role")} hint={t("role_hint")}>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">{t("role_none")}</option>
              {roles.map((r) => {
                const other = r.holder && r.holder !== agent.slug ? agents.find((a) => a.slug === r.holder)?.name ?? r.holder : null;
                return <option key={r.id} value={r.id}>{r.name}{other ? t("role_current", { name: other }) : ""}</option>;
              })}
            </select>
          </Field>
        </div>
        <Field label={t("team")}>
          <select className="select" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">{t("team_none")}</option>
            {teams.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
          </select>
        </Field>
        <Field label={t("reports_to")} hint={t("reports_to_hint")}>
          <select className="select" value={boss} onChange={(e) => setBoss(e.target.value)}>
            <option value="">{t("reports_top")}</option>
            {bossOptions.map((a) => {
              const cyc = wouldCycle(agents, agent.slug, a.slug);
              return (
                <option key={a.slug} value={a.slug} disabled={cyc}>
                  {a.name}{a.title ? ` — ${a.title}` : ""}{cyc ? t("cycle") : ""}
                </option>
              );
            })}
          </select>
        </Field>
        {conflict && !warnings.length && (
          <p className="text-xs font-semibold text-warn flex items-start gap-1.5">
            <AlertTriangle size={14} className="shrink-0 mt-px" />
            {t("rank_conflict", { name: bossAgent?.name ?? "" })}
          </p>
        )}
        {warnings.length > 0 && (
          <div className="chip tone-warn !rounded-lg !whitespace-normal !items-start p-2.5 text-sm" role="status">
            <AlertTriangle size={14} className="shrink-0 mt-[3px]" />
            <span>{t("saved_warnings", { warnings: warnings.join(" · ") })}</span>
          </div>
        )}
        {error && <p className="text-sm font-semibold text-bad" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
