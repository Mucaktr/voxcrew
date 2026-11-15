// Ekip S14: "Ajanlara ata" — çok ajan × çok skill. Ekip / rütbe / beyin filtresi, arama, pencereli liste (100+ ajan).
import clsx from "clsx";
import { Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { RANK_LABEL, RANKS } from "../../lib/agents";
import { tp, useT } from "../../lib/i18n";
import { useOffice } from "../../lib/office";
import { foldText, matchesSkill, skillsApi, useSkills, type AssignMode, type AssignResult, type SkillEntry } from "../../lib/skills";
import { useStudio } from "../../lib/store";
import type { Agent } from "../../lib/types";
import { skillsMsg as m } from "../../locales/skills";
import { Badge, Button, Modal, Segmented, Spinner } from "../ui";
import { ErrorRow, Note, SourceBadge } from "./common";

const ROW = 44;
const LIST_H = 320;

export function AssignDialog({ open, onClose, initialSkills = [], initialAgents = [], onDone }:
  { open: boolean; onClose: () => void; initialSkills?: string[]; initialAgents?: string[]; onDone?: (r: AssignResult) => void }) {
  return (
    <Modal open={open} onClose={onClose} title={<Title />} width={960}>
      {open && <AssignForm key={`${initialSkills.join(",")}|${initialAgents.join(",")}`} initialSkills={initialSkills}
        initialAgents={initialAgents} onClose={onClose} onDone={onDone} />}
    </Modal>
  );
}

function Title() { const t = useT(m); return <>{t("assign_title")}</>; }

function AssignForm({ initialSkills, initialAgents, onClose, onDone }:
  { initialSkills: string[]; initialAgents: string[]; onClose: () => void; onDone?: (r: AssignResult) => void }) {
  const t = useT(m);
  const items = useSkills((s) => s.items);
  const agents = useStudio((s) => s.agents);
  const refreshAgents = useStudio((s) => s.refreshAgents);
  const teams = useOffice((s) => s.teams);
  const officeLoaded = useOffice((s) => s.loaded);
  useEffect(() => { if (!officeLoaded) void useOffice.getState().refresh(); }, [officeLoaded]);

  const [skillIds, setSkillIds] = useState<string[]>(initialSkills);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initialAgents));
  const [mode, setMode] = useState<AssignMode>("add");
  const [skillQuery, setSkillQuery] = useState("");
  const [agentQuery, setAgentQuery] = useState("");
  const [team, setTeam] = useState("");
  const [rank, setRank] = useState("");
  const [brain, setBrain] = useState<"" | "hermes" | "direct">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AssignResult | null>(null);

  const byId = useMemo(() => new Map(items.map((e) => [e.id, e])), [items]);
  const chosen = skillIds.map((id) => byId.get(id)).filter((e): e is SkillEntry => !!e);
  const skillNeedle = foldText(skillQuery.trim());
  const skillOptions = useMemo(() => (skillNeedle
    ? items.filter((e) => !skillIds.includes(e.id) && e.loadable && matchesSkill(e, skillNeedle)).slice(0, 12) : []),
  [items, skillIds, skillNeedle]);

  const agentNeedle = foldText(agentQuery.trim());
  const visible = useMemo(() => agents.filter((a) =>
    !a.hidden &&
    (!team || (team === "__none" ? !a.team : a.team === team)) &&
    (!rank || a.rank === rank) &&
    (!brain || a.runtime === brain) &&
    (!agentNeedle || foldText(`${a.name} ${a.slug} ${a.title ?? ""} ${a.role}`).includes(agentNeedle))),
  [agents, team, rank, brain, agentNeedle]);
  const keys = useMemo(() => new Set(chosen.map((e) => e.key)), [chosen]);
  const hasAll = (a: Agent) => chosen.length > 0 && chosen.every((e) => (a.skills ?? []).includes(e.key));
  const hermesPicked = agents.some((a) => picked.has(a.slug) && a.runtime === "hermes") && chosen.some((e) => e.source !== "hermes");

  // pencereli liste
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const start = Math.max(0, Math.floor(scrollTop / ROW) - 3);
  const end = Math.min(visible.length, start + Math.ceil(LIST_H / ROW) + 6);

  const toggle = (slug: string) => setPicked((s) => { const n = new Set(s); if (n.has(slug)) n.delete(slug); else n.add(slug); return n; });
  const run = async () => {
    if (!picked.size || (!skillIds.length && mode !== "set")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await skillsApi.assign([...picked], skillIds, mode);
      setResult(r);
      await refreshAgents();
      onDone?.(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
        {/* skill'ler */}
        <section className="flex flex-col gap-2 min-w-0" aria-labelledby="assign-skills">
          <div className="flex items-center justify-between gap-2">
            <h3 id="assign-skills" className="panel-title">{t("assign_skills_label")}</h3>
            <span className="text-xs text-muted tabular-nums">{tp(m, "skills_selected", chosen.length)}</span>
          </div>
          <ul className="flex flex-wrap gap-1.5" aria-label={t("assign_skills_label")}>
            {chosen.map((e) => (
              <li key={e.id}>
                <span className="chip !pr-1 tone-ok">
                  <span className="font-mono">{e.key}</span>
                  <button type="button" className="rounded-full p-0.5 hover:bg-panel" aria-label={t("remove_from_selection", { name: e.name })}
                    onClick={() => setSkillIds((s) => s.filter((x) => x !== e.id))}><X size={12} /></button>
                </span>
              </li>
            ))}
          </ul>
          <label className="relative block">
            <span className="sr-only">{t("pick_skills_placeholder")}</span>
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
            <input className="input !pl-8" type="search" value={skillQuery} onChange={(e) => setSkillQuery(e.target.value)} placeholder={t("pick_skills_placeholder")} />
          </label>
          {skillOptions.length > 0 && (
            <ul className="panel-soft p-1 flex flex-col max-h-56 overflow-y-auto" role="listbox" aria-label={t("pick_skills_placeholder")}>
              {skillOptions.map((e) => (
                <li key={e.id}>
                  <button type="button" role="option" aria-selected={false} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-panel"
                    onClick={() => { setSkillIds((s) => [...s, e.id]); setSkillQuery(""); }}>
                    <span className="font-mono text-sm font-semibold truncate flex-1 min-w-0">{e.name}</span>
                    <SourceBadge source={e.source} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-1.5 mt-2">
            <span className="label">{t("assign_mode")}</span>
            <Segmented value={mode} onChange={setMode} className="flex-wrap" options={[
              { value: "add", label: t("assign_mode_add") }, { value: "remove", label: t("assign_mode_remove") }, { value: "set", label: t("assign_mode_set") },
            ]} />
          </div>
          {hermesPicked && <Note tone="warn">{t("assign_hermes_warn")}</Note>}
        </section>

        {/* ajanlar */}
        <section className="flex flex-col gap-2 min-w-0" aria-labelledby="assign-agents">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 id="assign-agents" className="panel-title">{t("assign_agents_label")}</h3>
            <span className="text-xs text-muted tabular-nums">{tp(m, "agents_selected", picked.size)}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="relative flex-1 min-w-[10rem]">
              <span className="sr-only">{t("search_agents")}</span>
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
              <input className="input !pl-8 !py-1.5 text-sm" type="search" value={agentQuery} onChange={(e) => setAgentQuery(e.target.value)} placeholder={t("search_agents")} />
            </label>
            <select className="select !w-auto" value={team} onChange={(e) => setTeam(e.target.value)} aria-label={t("filter_team")}>
              <option value="">{t("filter_team")}: {t("all_f")}</option>
              <option value="__none">{t("no_team")}</option>
              {teams.map((tm) => <option key={tm.slug} value={tm.slug}>{tm.name}</option>)}
            </select>
            <select className="select !w-auto" value={rank} onChange={(e) => setRank(e.target.value)} aria-label={t("filter_rank")}>
              <option value="">{t("filter_rank")}: {t("all_f")}</option>
              {RANKS.map((r) => <option key={r} value={r}>{RANK_LABEL[r]}</option>)}
            </select>
            <select className="select !w-auto" value={brain} onChange={(e) => setBrain(e.target.value as "" | "hermes" | "direct")} aria-label={t("filter_brain")}>
              <option value="">{t("filter_brain")}: {t("all_f")}</option>
              <option value="hermes">{t("brain_hermes")}</option>
              <option value="direct">{t("brain_direct")}</option>
            </select>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <Button size="sm" onClick={() => setPicked((s) => new Set([...s, ...visible.map((a) => a.slug)]))} disabled={!visible.length}>{t("select_visible")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())} disabled={!picked.size}>{t("deselect_all")}</Button>
          </div>
          <div ref={listRef} className="panel-soft overflow-y-auto" style={{ height: LIST_H }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            role="group" aria-label={t("agent_list_label")}>
            {visible.length === 0 ? <p className="text-sm text-muted p-4 text-center">{t("no_agents")}</p> : (
              <div style={{ height: visible.length * ROW, position: "relative" }}>
                {visible.slice(start, end).map((a, i) => {
                  const on = picked.has(a.slug);
                  const has = hasAll(a);
                  return (
                    <label key={a.slug} style={{ position: "absolute", top: (start + i) * ROW, height: ROW }}
                      className={clsx("left-0 right-0 flex items-center gap-2.5 px-3 cursor-pointer hover:bg-panel", on && "bg-panel")}>
                      <input type="checkbox" className="h-4 w-4 accent-[var(--grass)]" aria-label={a.name} checked={on} onChange={() => toggle(a.slug)} />
                      <span className="h-3 w-3 rounded-full border border-line shrink-0" style={{ background: a.color }} aria-hidden />
                      <span className="text-sm font-semibold flex-1 min-w-0 truncate">{a.name}</span>
                      {a.runtime === "hermes" && <Badge tone="info">{t("brain_hermes")}</Badge>}
                      {a.rank && <Badge>{RANK_LABEL[a.rank]}</Badge>}
                      {has && keys.size > 0 && <Badge tone="ok"><Check size={12} aria-hidden />{t("has_skill")}</Badge>}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {error && <ErrorRow error={error} />}
      {result && (
        <div className="flex flex-col gap-1.5">
          <Note tone={result.failed ? "warn" : "ok"}>{t("assign_result", { ok: result.ok, failed: result.failed })}</Note>
          {result.results.filter((r) => !r.ok).map((r) => (
            <p key={r.agent} className="text-xs text-bad break-words"><span className="font-mono">{r.agent}</span>: {r.error}</p>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2 flex-wrap">
        <Button variant="ghost" onClick={onClose}>{result ? t("close") : t("cancel")}</Button>
        <Button variant="primary" onClick={() => void run()} disabled={busy || !picked.size || (!skillIds.length && mode !== "set")}
          icon={busy ? <Spinner size={14} /> : undefined}>{busy ? t("assigning") : t("assign_run")}</Button>
      </div>
    </div>
  );
}
