// DASH-MVP LiveRunCard: başlık + yüzler, durum çipi, "Adım 3 / 5" + adım şeridi, bütçe metni + BudgetMeter,
// süre + Duraklat/Devam (RunControls.RunPauseResume ile aynı kural ve aynı uç: lib/trace runControls; RunControls dosyası
// 37 KB olduğu için içe aktarılmaz — Pano parça bütçesi §9) + iptal (ikinci tıkla onay).
// Tavan yoksa metre çizilmez, yalnız maliyet tabanı metni ("yerel · ücretsiz").
// PANO-FIX: kartlar yalnız çalışan ve duraklatılan görevler; kararını bekleyenler kuyruktadır, burada tek satır
// özet + "Kararlara git". Koşu listesi gelmeden sahte "çalışan görev yok" denmez, iskelet çizilir.
import { Clock, Pause, Play, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { fmtNumber, tp, useT } from "../../lib/i18n";
import type { Agent, Run } from "../../lib/types";
import { boardMsg } from "../../locales/board";
import { PixelFace } from "../PixelFace";
import { runControls } from "../../lib/trace";
import { fmtElapsed } from "../world/activity";
import { Button } from "../ui";
import { Empty, Sk, StepTrack, useDelayed } from "./BoardParts";
import { BudgetMeter } from "./BudgetMeter";
import { budgetFill, costOf, runProgress } from "./decisionModel";
import { costText, metricText, pct } from "./boardFormat";
import { meterLevel } from "./meter";

export const LIVE_LIMIT = 6;

const RUNNING_CHIP = { tone: "info", key: "run_running" } as const;
const PAUSED_CHIP = { tone: "muted", key: "run_paused" } as const;
const QUEUED_CHIP = { tone: "muted", key: "run_queued" } as const;

export function LiveRuns({ ready, runs, waiting, agents, queued, onCompose, onWaiting }: {
  ready: boolean; runs: Run[]; waiting: number; agents: Agent[]; queued: ReadonlySet<string>; onCompose: () => void; onWaiting: () => void;
}) {
  const t = useT(boardMsg);
  const skel = useDelayed(!ready);
  if (!ready) {
    return skel ? (
      <div className="bd-runs" aria-hidden>{[0, 1, 2].map((i) => (
        <div key={i} className="bd-run"><Sk w="70%" h={14} /><Sk w="30%" h={18} r={999} /><Sk h={6} /><Sk w="60%" h={10} /></div>
      ))}</div>
    ) : <span className="sr-only">{t("loading")}</span>;
  }
  const waitLine = waiting > 0 && (
    <p className="bd-waitline">
      <span>{tp(boardMsg, "live_waiting", waiting)}</span>
      <button type="button" className="bd-link" onClick={onWaiting}>{t("live_waiting_go")}</button>
    </p>
  );
  if (!runs.length) {
    return (
      <>
        <Empty tone="info" icon={<Send size={18} />} title={t("live_empty")} text={waiting ? undefined : t("live_empty_hint")}
          action={<Button size="sm" icon={<Send size={14} aria-hidden />} onClick={onCompose}>{t("give_task")}</Button>} />
        {waitLine}
      </>
    );
  }
  const shown = runs.slice(0, LIVE_LIMIT);
  return (
    <>
      <div className="bd-runs">{shown.map((r) => <LiveRunCard key={r.id} run={r} agents={agents} queued={queued.has(r.id)} />)}</div>
      {runs.length > shown.length && <Link to="/gorevler" className="bd-link bd-more">{t("live_more", { n: runs.length - shown.length })}</Link>}
      {waitLine}
    </>
  );
}

function LiveRunCard({ run, agents, queued }: { run: Run; agents: Agent[]; queued: boolean }) {
  const t = useT(boardMsg);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const h = window.setTimeout(() => setConfirm(false), 5000);
    return () => window.clearTimeout(h);
  }, [confirm]);
  const prog = runProgress(run);
  const slugs = [...new Set(run.steps.map((s) => s.agent).filter((x): x is string => !!x))].slice(0, 3);
  const faces = slugs.map((s) => agents.find((a) => a.slug === s)).filter((a): a is Agent => !!a);
  const fill = budgetFill(run);
  const chip = prog.state === "paused" ? PAUSED_CHIP : queued ? QUEUED_CHIP : RUNNING_CHIP;
  const started = run.started_at ? Date.parse(run.started_at) : NaN;
  const level = fill ? meterLevel(fill.used / fill.cap) : "ok";
  const budgetValue = fill
    ? t(fill.metric === "cost_usd" ? "budget_usd" : "budget_tokens", {
      used: fill.metric === "cost_usd" ? metricText("cost_usd", fill.used) : fmtNumber(Math.round(fill.used)),
      cap: fill.metric === "cost_usd" ? metricText("cost_usd", fill.cap) : fmtNumber(Math.round(fill.cap)), pct: pct(fill.pct) })
    : costText(costOf(run));
  const cancel = async () => {
    if (!confirm) { setConfirm(true); return; }
    setBusy(true);
    setError(null);
    try { await api.cancelRun(run.id); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); setConfirm(false); }
  };
  return (
    <article className="bd-run" aria-labelledby={`run-${run.id}`}>
      <div className="bd-run-top">
        <h3 id={`run-${run.id}`}><Link to={`/gorevler/${run.id}`}>{run.title}</Link></h3>
        {!!faces.length && (
          <span className="bd-faces" role="img" aria-label={t("agents_aria", { names: faces.map((a) => a.name).join(", ") })}>
            {faces.map((a) => <PixelFace key={a.slug} avatar={a.avatar} size={24} ring={a.color} />)}
          </span>
        )}
      </div>
      <span className={`chip tone-${chip.tone} self-start`}>{t(chip.key)}</span>
      <div className="bd-mrow"><span className="l">{t("step_label")}</span><span className="v num">{t("step_of", { a: prog.step, b: prog.steps })}</span></div>
      <StepTrack done={prog.done} current={prog.state === "paused" ? 0 : prog.step} total={prog.steps} />
      <div className="bd-mrow"><span className="l">{t("budget_label")}</span>
        <span className={`v num ${level === "warn" ? "is-warn" : level === "bad" ? "is-bad" : ""}`}>{budgetValue}</span></div>
      {fill && <BudgetMeter ratio={fill.used / fill.cap} label={t("budget_aria", { title: run.title })} valueText={budgetValue} className="bd-meter" />}
      <div className="bd-run-foot">
        <span className="bd-el" title={t("elapsed_aria")}>
          <Clock size={14} aria-hidden />
          {Number.isFinite(started)
            ? <time className="num" data-since={started} dateTime={run.started_at}>{fmtElapsed(Date.now() - started)}</time>
            : <span>—</span>}
        </span>
        <PauseResume run={run} onError={setError} />
        {confirm ? (
          <Button size="sm" variant="danger" disabled={busy} onClick={cancel} aria-label={t("cancel_confirm_aria", { title: run.title })}>
            {t("cancel_confirm")}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon={<X size={14} aria-hidden />} onClick={cancel} aria-label={t("cancel_aria", { title: run.title })} />
        )}
      </div>
      {error && <p role="alert" className="text-xs font-semibold text-bad break-words">{t("pause_error", { error })}</p>}
    </article>
  );
}

/** Duraklat (çalışırken) · Devam et (duraklatılmış/kesilmiş ve sürdürülebilir) — RunControls.RunPauseResume ile aynı kural. */
function PauseResume({ run, onError }: { run: Run; onError: (e: string | null) => void }) {
  const t = useT(boardMsg);
  const [busy, setBusy] = useState(false);
  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    onError(null);
    fn().catch((e: unknown) => onError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
  };
  if (run.status === "running" && run.pausing)
    return <Button size="sm" disabled icon={<Pause size={14} aria-hidden />}>{t("pausing")}</Button>;
  if (run.status === "running")
    return <Button size="sm" disabled={busy} icon={<Pause size={14} aria-hidden />} title={t("pause_title")}
      aria-label={t("pause_aria", { title: run.title })} onClick={() => act(() => runControls.pause(run.id))}>{t("pause")}</Button>;
  if ((run.status === "paused" || run.status === "interrupted") && run.resumable !== false)
    return <Button size="sm" variant="primary" disabled={busy} icon={<Play size={14} aria-hidden />}
      aria-label={t("resume_aria", { title: run.title })} onClick={() => act(() => runControls.resume(run.id))}>{t("resume")}</Button>;
  return null;
}
