import clsx from "clsx";
import {
  AlertTriangle, ArrowRight, Check, CircleCheck, CircleDashed, Info, Layers, Rocket, ShieldCheck, Split, Workflow as WorkflowIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../lib/i18n";
import { prefixSlug, type OfficeTemplate } from "../../lib/office";
import { useStudio } from "../../lib/store";
import type { Agent } from "../../lib/types";
import { officeMsg as m } from "../../locales/office";
import { PixelFace } from "../PixelFace";
import { Badge, Button, Field, Modal, Spinner, Toggle } from "../ui";
import { RankBadge } from "./RankBadge";
import { TeamBadge } from "./TeamIcon";
import {
  STRATEGIES, hierarchyApi, type InstantiateResultX, type OfficeTemplateX, type Strategy, type TemplatePreview,
} from "./hierarchy";

const CONN_LABEL: Record<string, string> = { codex: "Codex", claude: "Claude Code", ollama: "Ollama", hermes: "Hermes" };

function stepStats(t: OfficeTemplate | OfficeTemplateX) {
  const steps = (t as OfficeTemplateX).workflow_steps ?? [];
  return {
    agentSteps: steps.filter((s) => s.type === "agent" || s.type === "delegate").length,
    gates: steps.filter((s) => s.type === "approval").length,
    delegates: steps.filter((s) => s.type === "delegate").length,
  };
}

/** Şablon kurulumu: beyin stratejisi (Tasarruf / Dengeli / Kalite) + canlı önizleme (QA-M5, M2, m10). */
export function InstantiateDialog({ template, agents, onClose, onDone }:
  { template: OfficeTemplate | null; agents: Agent[]; onClose: () => void; onDone: (r: InstantiateResultX) => Promise<void> | void }) {
  const t = useT(m);
  const models = useStudio((s) => s.models);
  const [strategy, setStrategy] = useState<Strategy>("balanced");
  const [profile, setProfile] = useState("");
  const [model, setModel] = useState("");
  const [prefix, setPrefix] = useState("");
  const [assignSkills, setAssignSkills] = useState(false);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InstantiateResultX | null>(null);
  const local = useMemo(() => models.filter((x) => x.local), [models]);
  const tpl = template as OfficeTemplateX | null;

  useEffect(() => {
    if (!template) return;
    setResult(null);
    setError(null);
    setPrefix("");
    setProfile("");
    setPreview(null);
    useStudio.getState().refreshModels().catch(() => undefined);
  }, [template]);

  const request = useMemo(() => ({
    strategy, prefix: prefix.trim() || undefined, hermes_profile: profile || undefined, model: model || undefined,
    assign_skills: assignSkills || undefined,
  }), [strategy, prefix, profile, model, assignSkills]);

  // Önizleme yazmaz; seçim değiştikçe (kısa gecikmeyle) yeniden hesaplanır.
  useEffect(() => {
    if (!template) return;
    let alive = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      hierarchyApi.preview(template.id, request)
        .then((p) => { if (alive) { setPreview(p); setError(null); } })
        .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (alive) setLoading(false); });
    }, 220);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [template, request]);

  if (!template || !tpl) return null;
  const pre = prefixSlug(prefix);
  const { gates, delegates } = stepStats(tpl);
  const teamName = (key: string) => tpl.teams.find((x) => x.key === key)?.name ?? key;
  const teamColor = (key: string) => tpl.teams.find((x) => x.key === key)?.color ?? "#94A3B8";
  const roleName = (key: string | null) => tpl.roles.find((r) => r.key === key)?.title ?? t("you_short");
  const existing = new Set(agents.map((a) => a.slug));
  const fresh = preview?.counts.new ?? tpl.roles.filter((r) => !existing.has(pre ? `${pre}-${r.key}` : r.key)).length;
  const avail = preview?.available;
  const usesOllama = !!preview?.roles.some((r) => r.brain.brain === "ollama");
  const hermesUsable = !!avail?.hermes && (preview?.profiles.length ?? 0) > 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await hierarchyApi.instantiate(template.id, request);
      setResult(res);
      await onDone(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Modal open onClose={onClose} width={560} title={t("office_ready")}
        footer={<>
          <Link to={`/akislar/${result.workflow.slug}`} className="btn" onClick={onClose}><WorkflowIcon size={16} />{t("open_flow")}</Link>
          <Button variant="primary" icon={<Check size={16} />} onClick={onClose}>{t("ok")}</Button>
        </>}>
        <div className="flex flex-col gap-3 text-sm">
          <p className="font-display font-semibold text-base">{result.message}</p>
          <ul className="flex flex-col gap-1.5">
            <li><b>{t("res_teams")}</b> {t("res_new", { n: result.teams.created.length })}{result.teams.skipped.length ? t("res_existing", { n: result.teams.skipped.length }) : ""}</li>
            {result.roles && <li><b>{t("res_roles")}</b> {t("res_new", { n: result.roles.created.length })}{result.roles.skipped.length ? t("res_existing", { n: result.roles.skipped.length }) : ""}</li>}
            <li><b>{t("res_agents")}</b> {t("res_new", { n: result.agents.created.length })}{result.agents.skipped.length ? t("res_existing_unchanged", { n: result.agents.skipped.length }) : ""}</li>
            <li><b>{t("res_workflow")}</b> {result.workflow.name} — {result.workflow.created ? t("res_wf_created") : t("res_wf_existing")}</li>
            {result.strategy && <li><b>{t("res_strategy")}</b> {STRATEGIES.find((s) => s.id === result.strategy)?.title}</li>}
          </ul>
          {!!result.warnings?.length && (
            <ul className="flex flex-col gap-1">
              {result.warnings.map((w) => <li key={w} className="text-xs text-warn flex items-start gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-px" />{w}</li>)}
            </ul>
          )}
          <p className="text-ink-2">{t("res_note")}</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} width={820} title={t("install_title", { name: template.name })}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button variant="primary" icon={<Rocket size={16} />} disabled={busy || loading || !preview} onClick={submit}>
          {busy ? t("installing") : fresh ? t("install_n", { n: fresh }) : t("install_missing")}
        </Button>
      </>}>
      <div className="flex flex-col gap-5">
        <Field label={t("strategy")} hint={t("strategy_hint")}>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("strategy")}>
            {STRATEGIES.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={strategy === s.id} aria-pressed={strategy === s.id}
                onClick={() => setStrategy(s.id)} className="card-select p-3 flex flex-col gap-1 min-w-0">
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-sm flex-1">{s.title}</span>
                  {s.id === "balanced" && <Badge tone="ok">{t("recommended")}</Badge>}
                </span>
                <span className="text-xs text-ink-2 leading-snug">{s.text}</span>
              </button>
            ))}
          </div>
        </Field>

        {avail && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label={t("found_conns")}>
            <span className="label mr-1">{t("conns_label")}</span>
            {(["codex", "claude", "ollama", "hermes"] as const).map((k) => (
              <Badge key={k} tone={avail[k] ? "ok" : "muted"}>
                {avail[k] ? <CircleCheck size={12} /> : <CircleDashed size={12} />}{CONN_LABEL[k]}{avail[k] ? "" : t("conn_missing")}
              </Badge>
            ))}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("hermes_profile")} hint={hermesUsable ? t("hermes_profile_hint") : t("hermes_missing_hint")}>
            <select className="select" value={profile || preview?.profile || ""} disabled={!preview?.profiles.length}
              onChange={(e) => setProfile(e.target.value)}>
              {!preview?.profiles.length && <option value="">{t("no_profile")}</option>}
              {preview?.profiles.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label={t("local_model")} hint={usesOllama ? (local.length ? t("local_model_hint") : t("local_model_none")) : t("local_model_unused")}>
            <select className="select" value={model} disabled={!local.length || !usesOllama} onChange={(e) => setModel(e.target.value)}>
              <option value="">{t("default_local")}</option>
              {local.map((x) => <option key={x.name} value={x.name}>{x.name}{x.parameter_size ? ` · ${x.parameter_size}` : ""}</option>)}
            </select>
          </Field>
          <Field label={t("prefix")} hint={pre ? t("prefix_hint_set", { pre }) : t("prefix_hint")}>
            <input className="input" value={prefix} maxLength={24} placeholder={t("prefix_placeholder")} onChange={(e) => setPrefix(e.target.value)} />
          </Field>
        </div>
        {hermesUsable && (
          <Toggle checked={assignSkills} onChange={setAssignSkills} label={t("assign_skills")} hint={t("assign_skills_hint")} />
        )}

        <div className="panel-soft p-3 flex flex-col gap-1.5 text-sm">
          <div className="flex flex-wrap items-center gap-2 font-semibold">
            <WorkflowIcon size={16} />{template.workflow_name}
            {loading && <Spinner size={14} />}
          </div>
          {preview?.step_summary && (
            <p className="text-sm num" aria-live="polite"><b>{t("est_label")}</b> {preview.step_summary}</p>
          )}
          <p className="text-xs flex items-start gap-1.5 num"><ShieldCheck size={14} className="shrink-0 mt-px text-ok" />
            {t("gates_text", { gates })}{delegates ? t("delegates_text", { n: delegates }) : ""}{t("gates_note")}</p>
          <p className="text-xs flex items-start gap-1.5"><Info size={14} className="shrink-0 mt-px text-info" />{t("hermes_untouched")}</p>
        </div>

        {!!preview?.warnings.length && (
          <ul className="flex flex-col gap-1">
            {preview.warnings.map((w) => (
              <li key={w} className="text-xs font-semibold text-warn flex items-start gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-px" />{w}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label flex-1">{t("roles_to_install")}</span>
            <Badge tone="ok">{t("new_count", { n: fresh })}</Badge>
            <Badge tone="muted">{t("existing_count", { n: tpl.roles.length - fresh })}</Badge>
          </div>
          <ul className="grid gap-1.5 lg:grid-cols-2">
            {tpl.roles.map((r) => {
              const pv = preview?.roles.find((x) => x.key === r.key);
              return (
                <li key={r.key} className={clsx("flex gap-2.5 rounded-lg border-2 border-line-soft p-2 min-w-0", pv?.exists && "border-dashed")}>
                  <PixelFace avatar={r.avatar} size={38} ring={r.color} className={clsx(pv?.exists && "opacity-60")} />
                  <div className="min-w-0 flex-1 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-semibold truncate">{r.name} · {r.title}</span>
                      {pv?.exists && <Badge tone="muted" className="shrink-0">{t("exists")}</Badge>}
                    </div>
                    <div className="text-xs text-ink-2 truncate flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: teamColor(r.team) }} />
                      {teamName(r.team)} · {t("reports_to_short", { name: roleName(r.reports_to) })}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <RankBadge rank={r.rank} />
                      {pv && <Badge tone="info" title={t("role_brain")}>{pv.brain.label}</Badge>}
                    </div>
                    {!!pv?.skills.length && (
                      <ul className="flex flex-wrap gap-1" aria-label={t("suggested_skills")}>
                        {pv.skills.map((s) => (
                          <li key={s.name} className={clsx("chip", s.installed ? "tone-ok" : "tone-muted")}
                            title={s.installed ? t("skill_installed") : preview?.skills_source ? t("skill_missing_in", { profile: preview.skills_source }) : t("skill_missing")}>
                            {s.installed ? <Check size={11} /> : null}{s.name}{s.installed ? "" : t("skill_missing_suffix")}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        {error && <p className="text-sm font-semibold text-bad" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

export function TemplateGallery({ templates, agents, onInstall }:
  { templates: OfficeTemplate[]; agents: Agent[]; onInstall: (t: OfficeTemplate) => void }) {
  const t = useT(m);
  const slugs = new Set(agents.map((a) => a.slug));
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {templates.map((tpl) => {
        const installed = tpl.roles.every((r) => slugs.has(r.key));
        const { agentSteps, gates, delegates } = stepStats(tpl);
        const levels = (tpl as OfficeTemplateX).levels;
        return (
          <article key={tpl.id} className="panel-soft p-4 flex flex-col gap-3 min-w-0">
            <header className="flex items-start gap-3">
              <TeamBadge color="#7C5CE0" icon={tpl.icon} size={40} />
              <div className="min-w-0 flex-1">
                <h3 className="panel-title leading-tight">{tpl.name}</h3>
                <span className="flex flex-wrap items-center gap-x-1 text-xs text-muted mt-0.5 num">
                  {t("n_roles_teams", { roles: tpl.roles.length, teams: tpl.teams.length })}
                  {levels ? <span className="inline-flex items-center gap-0.5">· <Layers size={12} aria-hidden />{t("n_levels", { n: levels })}</span> : null}
                </span>
              </div>
              {installed && <Badge tone="ok"><Check size={12} />{t("installed")}</Badge>}
            </header>
            <p className="text-sm text-ink-2 leading-relaxed">{tpl.description}</p>
            <ul className="flex flex-wrap gap-1.5" aria-label={t("roles_list")}>
              {tpl.roles.map((r) => (
                <li key={r.key} title={`${r.name} — ${r.title}`} className="flex flex-col items-center gap-0.5 w-[62px]">
                  <PixelFace avatar={r.avatar} size={44} ring={r.color} />
                  <span className="text-xs font-semibold text-ink-2 leading-tight text-center line-clamp-2">{r.title}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-1.5">
              {tpl.teams.map((tm) => (
                <span key={tm.key} className="chip"><span className="h-2 w-2 rounded-full" style={{ background: tm.color }} />{tm.name}</span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-auto pt-1">
              <span className="text-xs text-ink-2 flex flex-wrap items-center gap-1 flex-1 min-w-[13rem] num">
                <WorkflowIcon size={13} />{t("steps_summary", { name: tpl.workflow_name ?? "", steps: agentSteps, gates })}
                {delegates > 0 && <Badge tone="info" title={t("delegation_title")}><Split size={12} />{t("delegation")}</Badge>}
              </span>
              <Button variant={installed ? "default" : "primary"} className="ml-auto" icon={<ArrowRight size={15} />} onClick={() => onInstall(tpl)}>
                {installed ? t("reinstall") : t("install")}
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
