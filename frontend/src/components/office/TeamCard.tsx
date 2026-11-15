// Ekip S3/S6 — ekip kartı ve Lobi kartı. S20: üye listeleri pencereli (yalnızca görünür satırlar çizilir),
// "Üye ekle" 300 ajanda da akıcı kalsın diye aramalı seçici; metinler i18n.
import { Crown, Pencil, Search, Trash2, UserMinus, UserPlus, Users, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { byName } from "../../lib/agents";
import { fold } from "../../lib/hermes";
import { tp, useT } from "../../lib/i18n";
import { officeApi, type TeamInfo } from "../../lib/office";
import type { Agent } from "../../lib/types";
import { officeMsg as m } from "../../locales/office";
import { useRowSizer, useWindowRows } from "../agents/windowing";
import { PixelFace } from "../PixelFace";
import { Button, Modal } from "../ui";
import { HiredBadge, RankBadge } from "./RankBadge";
import { TeamBadge } from "./TeamIcon";

const ROW_GAP = 2;
const PICKER_MAX = 12;

function MemberRow({ agent, lead, onOpen, onRemove, busy }:
  { agent: Agent; lead: boolean; onOpen: () => void; onRemove?: () => void; busy?: boolean }) {
  const t = useT(m);
  return (
    <>
      <button type="button" onClick={onOpen} className="flex items-center gap-2.5 min-w-0 flex-1 text-left p-1.5 rounded-lg"
        title={t("member_row_title")}>
        <PixelFace avatar={agent.avatar} size={36} ring={agent.color} />
        <span className="min-w-0">
          <span className="flex items-center gap-1 min-w-0">
            <span className="font-semibold text-sm truncate">{agent.name}</span>
            {lead && <Crown size={13} className="text-warn shrink-0" aria-label={t("lead")} />}
          </span>
          <span className="block text-xs text-ink-2 truncate">{agent.title || t("no_title_short")}</span>
          {(agent.rank || agent.hired_by) && (
            <span className="flex flex-wrap gap-1 mt-0.5">
              <RankBadge rank={agent.rank} />
              <HiredBadge by={agent.hired_by} />
            </span>
          )}
        </span>
      </button>
      {onRemove && (
        <Button size="sm" variant="ghost" icon={<UserMinus size={15} />} disabled={busy} onClick={onRemove}
          aria-label={t("remove_member", { name: agent.name })} title={t("remove_member_title")} />
      )}
    </>
  );
}

/** Pencereli üye listesi: kaydırılabilir kap, yalnızca görünür satırlar çizilir. */
function MemberList({ members, lead, busy, onOpen, onRemove, emptyText }:
  { members: Agent[]; lead: string | null; busy: boolean; onOpen: (a: Agent) => void; onRemove?: (a: Agent) => void; emptyText: string }) {
  const ref = useRef<HTMLUListElement>(null);
  const { rowHeight, observe } = useRowSizer(52);
  const win = useWindowRows(ref, members.length, rowHeight + ROW_GAP, 4);
  const slice = members.slice(win.start, win.end);
  return (
    <ul ref={ref} className="flex flex-col px-1.5 pt-2 max-h-80 overflow-y-auto" style={{ gap: ROW_GAP, paddingTop: 8 + win.padTop, paddingBottom: win.padBottom }}>
      {slice.map((a) => (
        <li key={a.slug} ref={observe} className="flex items-center gap-2 rounded-lg hover:bg-panel transition-colors" style={{ minHeight: rowHeight }}>
          <MemberRow agent={a} lead={lead === a.slug} busy={busy} onOpen={() => onOpen(a)} onRemove={onRemove ? () => onRemove(a) : undefined} />
        </li>
      ))}
      {!members.length && <li className="px-1.5 py-2 text-sm text-muted">{emptyText}</li>}
    </ul>
  );
}

/** Aramalı ajan seçici (300 ajanda `<select>` yerine): ilk {PICKER_MAX} eşleşme listelenir. */
export function AgentPicker({ id, candidates, disabled, placeholder, emptyLabel, onPick, suffix }:
  { id: string; candidates: Agent[]; disabled?: boolean; placeholder: string; emptyLabel: string; onPick: (slug: string) => void;
    suffix?: (a: Agent) => string }) {
  const t = useT(m);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const needle = fold(q.trim());
  const matches = useMemo(() => {
    const list = needle ? candidates.filter((a) => fold(`${a.name} ${a.title ?? ""} ${a.slug}`).includes(needle)) : candidates;
    return list.slice(0, PICKER_MAX + 1);
  }, [candidates, needle]);
  const shown = matches.slice(0, PICKER_MAX);
  if (!candidates.length) return <span className="text-sm text-muted">{emptyLabel}</span>;
  return (
    <div className="relative flex-1 min-w-0">
      <div className="relative">
        <Search size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input id={id} className="input !pl-8 !py-1.5 !text-sm" type="search" value={q} disabled={disabled} placeholder={placeholder}
          autoComplete="off" onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); (e.target as HTMLInputElement).blur(); } }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)} />
      </div>
      {open && (
        <ul role="listbox" aria-label={placeholder}
          className="absolute z-20 left-0 right-0 mt-1 panel p-1 flex flex-col gap-0.5 max-h-64 overflow-y-auto shadow-xl">
          {shown.length === 0 && <li className="text-sm text-muted px-2 py-1.5">{t("no_match")}</li>}
          {shown.map((a) => (
            <li key={a.slug}>
              <button type="button" role="option" aria-selected={false}
                className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-panel-2"
                onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(a.slug); setQ(""); setOpen(false); }}>
                <PixelFace avatar={a.avatar} size={22} ring={a.color} />
                <span className="truncate flex-1 min-w-0 font-semibold">{a.name}</span>
                <span className="text-xs text-muted truncate">{a.title ?? ""}{suffix?.(a) ?? ""}</span>
              </button>
            </li>
          ))}
          {matches.length > PICKER_MAX && (
            <li className="text-xs text-muted px-2 py-1">{t("more_matches", { n: candidates.length - PICKER_MAX })}</li>
          )}
        </ul>
      )}
    </div>
  );
}

export function TeamCard({ team, agents, allAgents, onEdit, onMember, onChanged }:
  { team: TeamInfo; agents: Agent[]; allAgents: Agent[]; onEdit: () => void; onMember: (a: Agent) => void;
    onChanged: () => Promise<void> }) {
  const t = useT(m);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const members = useMemo(() => agents.filter((a) => a.team === team.slug), [agents, team.slug]);
  const candidates = useMemo(() => allAgents.filter((a) => !a.hidden && a.team !== team.slug).sort(byName), [allAgents, team.slug]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article id={`ekip-${team.slug}`} className="panel-soft flex flex-col min-w-0 scroll-mt-20"
      style={{ borderTopColor: team.color, borderTopWidth: 5 }}>
      <header className="flex items-start gap-3 p-3 pb-2">
        <TeamBadge color={team.color} icon={team.icon} />
        <div className="min-w-0 flex-1">
          <h3 className="panel-title leading-tight truncate">{team.name}</h3>
          <span className="text-xs text-muted flex items-center gap-1 mt-0.5 num"><Users size={12} />{tp(m, "members", members.length)}</span>
        </div>
        <Button size="sm" variant="ghost" icon={<Pencil size={15} />} onClick={onEdit} aria-label={t("edit_team", { name: team.name })} title={t("edit_team_title")} />
        <Button size="sm" variant="ghost" icon={<Trash2 size={15} />} onClick={() => setConfirm(true)} aria-label={t("delete_team", { name: team.name })} title={t("delete_team_title")} />
      </header>
      <p className={members.length || team.mission ? "px-3 text-sm text-ink-2 leading-relaxed" : "px-3 text-sm text-muted"}>
        {team.mission || t("no_mission")}
      </p>

      <div className="px-3 pt-3">
        <label className="label flex items-center gap-1 mb-1" htmlFor={`lider-${team.slug}`}><Crown size={13} />{t("lead")}</label>
        <select id={`lider-${team.slug}`} className="select !py-1.5 !text-sm" value={team.lead ?? ""} disabled={busy || !members.length}
          onChange={(e) => run(() => officeApi.updateTeam(team.slug, { lead: e.target.value || null }))}>
          <option value="">{members.length ? t("lead_none") : t("lead_add_first")}</option>
          {members.map((a) => <option key={a.slug} value={a.slug}>{a.name}{a.title ? ` — ${a.title}` : ""}</option>)}
        </select>
      </div>

      <MemberList members={members} lead={team.lead} busy={busy} onOpen={onMember} emptyText={t("team_empty")}
        onRemove={(a) => run(() => officeApi.assign(a.slug, { team: null }))} />

      <div className="p-3 pt-2 mt-auto">
        <label className="sr-only" htmlFor={`ekle-${team.slug}`}>{t("add_member_label", { name: team.name })}</label>
        <div className="flex items-center gap-2">
          <UserPlus size={16} className="text-ink-2 shrink-0" aria-hidden />
          <AgentPicker id={`ekle-${team.slug}`} candidates={candidates} disabled={busy} placeholder={candidates.length > PICKER_MAX ? t("add_member_search") : t("add_member")}
            emptyLabel={t("add_member_none")} suffix={(a) => (a.team ? t("move_from_team") : "")}
            onPick={(slug) => run(() => officeApi.assign(slug, { team: team.slug }))} />
        </div>
        {error && <p className="mt-2 text-xs font-semibold text-bad" role="alert">{error}</p>}
      </div>

      <Modal open={confirm} onClose={() => setConfirm(false)} width={440} title={t("delete_team_q")}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirm(false)}>{t("cancel")}</Button>
          <Button variant="danger" icon={<Trash2 size={15} />} disabled={busy}
            onClick={() => run(async () => { await officeApi.deleteTeam(team.slug); setConfirm(false); })}>{t("delete_team_btn")}</Button>
        </>}>
        <p className="text-sm leading-relaxed">
          <b>{t("delete_team_text", { name: team.name })}</b> {members.length ? t("delete_team_members", { n: members.length }) : t("delete_team_no_members")}
          {" "}{t("delete_team_note")}
        </p>
      </Modal>
    </article>
  );
}

/** Ekipsiz ajanlar: her biri bir seçiciyle bir ekibe atanır (liste pencereli). */
export function LobbyCard({ agents, teams, onMember, onChanged }:
  { agents: Agent[]; teams: TeamInfo[]; onMember: (a: Agent) => void; onChanged: () => Promise<void> }) {
  const t = useT(m);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const needle = fold(q.trim());
  const shown = useMemo(() => (needle ? agents.filter((a) => fold(`${a.name} ${a.title ?? ""} ${a.role ?? ""}`).includes(needle)) : agents), [agents, needle]);
  const ref = useRef<HTMLUListElement>(null);
  const { rowHeight, observe } = useRowSizer(48);
  const win = useWindowRows(ref, shown.length, rowHeight + 4, 4);
  const slice = shown.slice(win.start, win.end);
  const assign = async (slug: string, team: string) => {
    setBusy(slug);
    setError(null);
    try {
      await officeApi.assign(slug, { team });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <article className="panel-soft flex flex-col min-w-0 border-dashed">
      <header className="flex items-center gap-3 p-3 pb-2">
        <span className="grid place-items-center h-[34px] w-[34px] rounded-lg border-2 border-dashed border-line-soft text-ink-2"><Users size={17} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="panel-title leading-tight">{t("lobby")}</h3>
          <span className="block text-xs text-muted mt-0.5 num">{tp(m, "lobby_count", agents.length)}</span>
        </div>
      </header>
      {agents.length > PICKER_MAX && (
        <div className="px-3 pb-1 relative">
          <Search size={14} aria-hidden className="absolute left-5.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input className="input !pl-8 !py-1.5 !text-sm" type="search" value={q} placeholder={t("add_member_search")} aria-label={t("add_member_search")}
            onChange={(e) => setQ(e.target.value)} />
          {q && <button type="button" className="absolute right-5 top-1/2 -translate-y-1/2 text-muted" aria-label={t("cancel")} onClick={() => setQ("")}><X size={14} /></button>}
        </div>
      )}
      <ul ref={ref} className="flex flex-col px-1.5 pb-3 max-h-96 overflow-y-auto" style={{ gap: 4, paddingTop: win.padTop, paddingBottom: 12 + win.padBottom }}>
        {slice.map((a) => (
          <li key={a.slug} ref={observe} className="flex flex-wrap items-center gap-2 rounded-lg p-1.5 hover:bg-panel" style={{ minHeight: rowHeight }}>
            <button type="button" onClick={() => onMember(a)} className="flex items-center gap-2.5 min-w-0 flex-1 text-left">
              <PixelFace avatar={a.avatar} size={34} ring={a.color} />
              <span className="min-w-0">
                <span className="block font-semibold text-sm truncate">{a.name}</span>
                <span className="block text-xs text-ink-2 truncate">{a.title || a.role || t("no_title_short")}</span>
              </span>
            </button>
            <label className="sr-only" htmlFor={`lobi-${a.slug}`}>{t("lobby_team_for", { name: a.name })}</label>
            <select id={`lobi-${a.slug}`} className="select !w-auto !py-1 !text-xs max-w-[150px]" value="" disabled={busy === a.slug || !teams.length}
              onChange={(e) => { if (e.target.value) assign(a.slug, e.target.value); }}>
              <option value="">{teams.length ? t("assign_team") : t("no_teams")}</option>
              {teams.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
            </select>
          </li>
        ))}
        {!agents.length && <li className="px-1.5 py-2 text-sm text-muted">{t("lobby_empty")}</li>}
        {agents.length > 0 && !shown.length && <li className="px-1.5 py-2 text-sm text-muted">{t("no_match")}</li>}
      </ul>
      {error && <p className="px-3 pb-3 text-xs font-semibold text-bad" role="alert">{error}</p>}
    </article>
  );
}
