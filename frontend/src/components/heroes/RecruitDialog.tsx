// S44: "Ekibe kat" — önce plan (hiçbir şey yazılmaz), sonra onay. 3B önizleme yalnızca bu pencerede çizilir
// (galeride on ayrı WebGL bağlamı açmamak için).
import { CheckCircle2, ShieldCheck, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../lib/i18n";
import { BRAIN_LABEL, heroesApi, type Hero, type HeroPlan, type RecruitResult } from "../../lib/heroes";
import { useStudio } from "../../lib/store";
import { heroesMsg } from "../../locales/heroes";
import { AvatarPreview } from "../../voxel/AvatarPreview";
import { Badge, Button, Field, Modal, Spinner } from "../ui";
import { useHeroBrain } from "./brain";

export function RecruitDialog({ hero, onClose, onDone }: { hero: Hero; onClose: () => void; onDone: () => void }) {
  const t = useT(heroesMsg);
  const brain = useHeroBrain(hero.brain);
  const upsert = useStudio((s) => s.upsertAgent);
  const [plan, setPlan] = useState<HeroPlan | null>(null);
  const [name, setName] = useState(hero.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecruitResult | null>(null);

  useEffect(() => {
    let live = true;
    heroesApi.plan(hero.id).then((r) => { if (live) setPlan(r.plan); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [hero.id]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await heroesApi.recruit(hero.id, name.trim() || undefined);
      upsert(r.agent);
      setResult(r);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const footer = result
    ? <Button variant="primary" onClick={onClose}>{t("close")}</Button>
    : <>
      <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      <Button variant="primary" icon={busy ? <Spinner /> : <UserPlus size={16} />} disabled={busy || !plan} onClick={confirm}>
        {busy ? t("recruiting") : t("confirm")}
      </Button>
    </>;

  return (
    <Modal open onClose={onClose} width={860} footer={footer}
      title={result ? t("done_title", { name: result.agent.name }) : t("dialog_title", { name: hero.name })}>
      <div className="grid md:grid-cols-[280px_minmax(0,1fr)] gap-5">
        <div className="flex flex-col gap-2 min-w-0">
          <div className="rounded-lg overflow-hidden border-2 border-line-soft" style={{ background: `color-mix(in srgb, ${hero.color} 12%, transparent)` }}>
            <AvatarPreview avatar={hero.avatar} mood={result ? "done" : "idle"} motion={result ? "cheer" : "idle"} height={240} />
          </div>
          <p className="text-sm font-semibold">{hero.title}</p>
          <p className="text-xs text-muted"><span className="font-semibold text-ink-2">{t("origin")}:</span> {hero.origin}</p>
          <p className="text-xs text-muted italic">“{hero.catchphrase}”</p>
        </div>

        {result ? (
          <div className="flex flex-col gap-3 min-w-0" role="status">
            <p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={18} className="text-ok" aria-hidden />
              {t("done_title", { name: result.agent.name })}</p>
            <p className="text-sm">{t("done_body", { facts: result.memory.facts })}</p>
            <div className="flex flex-wrap gap-2">
              <Link className="btn btn-sm" to={`/ajanlar/${encodeURIComponent(result.agent.slug)}`} onClick={onClose}>{t("open_profile")}</Link>
              {result.workflow && <Link className="btn btn-sm" to={`/akislar/${encodeURIComponent(result.workflow)}`} onClick={onClose}>{t("open_workflow")}</Link>}
              <Link className="btn btn-sm" to="/bellek" onClick={onClose}>{t("open_memory")}</Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 min-w-0">
            <Field label={t("plan_agent_name")}>
              <input className="input w-full" aria-label={t("plan_agent_name")} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </Field>
            <h3 className="panel-title">{t("plan_title")}</h3>
            {!plan && !error && <p className="text-sm text-muted inline-flex items-center gap-2"><Spinner />{t("plan_loading")}</p>}
            {plan && (
              <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted">{t("plan_brain")}</dt>
                <dd className="min-w-0">
                  <Badge tone={brain.state === "ready" ? "ok" : brain.state === "blocked" ? "bad" : "warn"}>
                    {BRAIN_LABEL[brain.pick]} · {brain.state === "ready" ? t("brain_ready") : brain.state === "blocked" ? t("brain_blocked") : t("brain_setup")}
                  </Badge>
                  <span className="block text-xs text-muted mt-1">{t("brain_chain", { chain: brain.chain.map((k) => BRAIN_LABEL[k]).join(" → ") })}</span>
                </dd>
                <dt className="text-muted">{t("plan_skills")}</dt>
                <dd className="min-w-0">{plan.skills.map((s) => (
                  <span key={s.id} className="block break-words">{hero.skills.find((x) => x.id === s.id)?.name ?? s.id}
                    <span className="text-muted"> — {s.action === "install" ? t("plan_skill_install") : t("plan_skill_reuse")}</span></span>
                ))}</dd>
                <dt className="text-muted">{t("plan_memory")}</dt>
                <dd>{t("plan_memory_value", { n: plan.memory_nodes })}</dd>
                <dt className="text-muted">{t("plan_boosters")}</dt>
                <dd className="flex flex-wrap gap-1">{Object.entries(plan.boosters).filter(([, on]) => on).map(([b]) => <Badge key={b} tone="info">{b}</Badge>)}</dd>
                <dt className="text-muted">{t("plan_workflow")}</dt>
                <dd>{t("plan_workflow_value", { name: hero.workflow.name, approvals: hero.workflow.approvals })}</dd>
                <dt className="text-muted">{t("plan_permissions")}</dt>
                <dd>{plan.permissions === "read" ? t("perm_read") : t("perm_write")}
                  <span className="block text-xs text-muted mt-0.5">{hero.permissions_note}</span></dd>
              </dl>
            )}
            {hero.tools.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <h3 className="panel-title">{t("plan_tools")}</h3>
                <ul className="flex flex-col gap-1.5">
                  {hero.tools.map((tool) => (
                    <li key={tool.id} className="text-sm border-2 border-line-soft rounded-lg p-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold">{tool.label}</span>
                        <Badge tone="muted">{tool.access === "read" ? t("tool_access_read") : t("tool_access_write")}</Badge>
                        <Badge tone="warn">{t("tool_suggested")}</Badge>
                      </div>
                      <p className="text-xs text-muted mt-1">{tool.why}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-muted flex items-start gap-1.5"><ShieldCheck size={14} className="shrink-0 mt-0.5" aria-hidden />{t("plan_no_network")}</p>
            {error && <p role="alert" className="text-sm text-bad">{t("error", { msg: error })}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
