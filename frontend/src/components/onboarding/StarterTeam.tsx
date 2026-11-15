// Sihirbazın "Ekip" adımı: başlangıç ajanlarını yeniden adlandır, beynini değiştir, kaldır.
import { AlertTriangle, Building2, Check, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { useStudio } from "../../lib/store";
import type { Agent } from "../../lib/types";
import { shell } from "../../locales/shell";
import { PixelFace } from "../PixelFace";
import { Badge, Button, Field, Spinner } from "../ui";
import { brainOptions, brainPatch, brainValueOf } from "./onboarding";

const RANK_KEY: Record<string, "ob_rank_specialist" | "ob_rank_analyst"> = { specialist: "ob_rank_specialist", analyst: "ob_rank_analyst" };

function AgentRow({ agent }: { agent: Agent }) {
  const t = useT(shell);
  const conns = useStudio((s) => s.connections);
  const upsertAgent = useStudio((s) => s.upsertAgent);
  const refreshAgents = useStudio((s) => s.refreshAgents);
  const options = useMemo(() => brainOptions(conns), [conns]);
  const [name, setName] = useState(agent.name);
  const [busy, setBusy] = useState<"name" | "brain" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const current = brainValueOf(agent);
  const inputId = `ob-name-${agent.slug}`;
  const selectId = `ob-brain-${agent.slug}`;

  const run = async (kind: "name" | "brain" | "remove", fn: () => Promise<void>) => {
    setBusy(kind); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const saveName = () => {
    const next = name.trim();
    if (!next || next === agent.name) return;
    void run("name", async () => { upsertAgent(await api.updateAgent(agent.slug, { name: next })); });
  };
  const changeBrain = (value: string) =>
    run("brain", async () => { upsertAgent(await api.updateAgent(agent.slug, brainPatch(value) as Partial<Agent>)); });
  const remove = () => run("remove", async () => { await api.deleteAgent(agent.slug); await refreshAgents(); });

  return (
    <li className="panel-soft p-3 flex flex-col gap-3 min-w-0">
      <div className="flex items-center gap-3 min-w-0">
        <PixelFace avatar={agent.avatar} size={44} ring={agent.color} />
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold text-base truncate">{agent.name}</p>
          <p className="text-xs text-muted truncate">{agent.title || agent.role}</p>
        </div>
        {agent.rank && RANK_KEY[agent.rank] && <Badge tone="info">{t(RANK_KEY[agent.rank])}</Badge>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={<label htmlFor={inputId}>{t("ob_name")}</label>}>
          <div className="flex gap-1.5 min-w-0">
            <input id={inputId} className="input min-w-0 flex-1" value={name} maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveName(); }} />
            <Button size="sm" onClick={saveName} disabled={busy !== null || !name.trim() || name.trim() === agent.name}
              icon={busy === "name" ? <Spinner size={13} /> : <Check size={14} />} aria-label={t("ob_save_name", { name: agent.name })} />
          </div>
        </Field>
        <Field label={<label htmlFor={selectId}>{t("ob_brain")}</label>}>
          <select id={selectId} className="select" value={current} disabled={busy !== null}
            onChange={(e) => { void changeBrain(e.target.value); }}>
            {current === "" ? <option value="" disabled>{t("ob_pick_brain")}</option>
              : !options.some((o) => o.value === current) && <option value={current}>{current}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}{o.available ? "" : t("ob_not_found")}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2 min-w-0">
        {busy === "brain" ? <Spinner size={14} /> : agent.needs_brain ? (
          <span className="chip tone-warn !whitespace-normal !items-start">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" aria-hidden />
            <label htmlFor={selectId} className="cursor-pointer">{t("ob_no_brain")}</label>
          </span>
        ) : agent.route_error ? (
          <span className="chip tone-bad !whitespace-normal !items-start">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" aria-hidden />
            <span>{t("ob_route_error", { error: agent.route_error })}</span>
          </span>
        ) : agent.route ? <Badge tone="ok">{agent.route.label}</Badge> : null}
        <span className="ml-auto flex items-center gap-1.5">
          {confirmRemove ? (
            <>
              <span className="text-xs text-ink-2">{t("ob_remove_q")}</span>
              <Button size="sm" variant="danger" onClick={() => { void remove(); }} disabled={busy !== null}
                icon={busy === "remove" ? <Spinner size={13} /> : <Trash2 size={14} />}>{t("ob_remove")}</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>{t("cancel")}</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setConfirmRemove(true)}
              aria-label={t("ob_remove_aria", { name: agent.name })}>{t("ob_remove")}</Button>
          )}
        </span>
      </div>
      {error && <p role="alert" className="text-sm text-bad break-words">{error}</p>}
    </li>
  );
}

export function StarterTeam({ starterSlugs, onNavigate }: { starterSlugs: string[]; onNavigate: () => void }) {
  const agents = useStudio((s) => s.agents);
  const starters = useMemo(() => agents.filter((a) => starterSlugs.includes(a.slug))
    .sort((a, b) => starterSlugs.indexOf(a.slug) - starterSlugs.indexOf(b.slug)), [agents, starterSlugs]);
  const others = useMemo(() => agents.filter((a) => !a.hidden && !starterSlugs.includes(a.slug)).length,
    [agents, starterSlugs]);
  const t = useT(shell);

  return (
    <div className="flex flex-col gap-4">
      {starters.length > 0 ? (
        <>
          <p className="text-sm text-ink-2">
            {starters.some((a) => a.needs_brain) ? t("ob_team_intro_pick") : t("ob_team_intro")}
          </p>
          <ul className="flex flex-col gap-3" aria-label={t("ob_team_list")}>
            {starters.map((a) => <AgentRow key={a.slug} agent={a} />)}
          </ul>
        </>
      ) : (
        <div className="panel-soft p-3 flex items-start gap-3">
          <Users size={18} className="shrink-0 mt-0.5 text-ink-2" aria-hidden />
          <p className="text-sm text-ink-2">
            {others > 0
              ? <>{t("ob_team_exists_a")}<span className="num">{others}</span>{t("ob_team_exists_b")}</>
              : t("ob_team_removed")}
            {" "}
            <Link to="/ajanlar" className="underline" onClick={onNavigate}>{t("ob_go_agents")}</Link>
          </p>
        </div>
      )}

      <div className="panel-soft p-3 flex flex-wrap items-center gap-3">
        <Building2 size={18} className="shrink-0 text-ink-2" aria-hidden />
        <p className="text-sm text-ink-2 flex-1 min-w-[min(100%,220px)]">
          {t("ob_bigger_team")}
        </p>
        <Link to="/ofis" className="btn btn-sm" onClick={onNavigate}>{t("ob_office_templates")}</Link>
      </div>
    </div>
  );
}
