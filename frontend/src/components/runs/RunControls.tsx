// Ekip S26 — koşu denetimleri: duraklat/devam, "Devam et" şeridi, bütçe çubuğu (yükselt), adım
// eylemleri (yeniden dene, düzenle ve çatalla) ve dinamik onay kartları (ask · effect · budget → mevcut /decision).
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Gauge, GitCompare, GitFork, Pause, Pencil, Play, PlugZap, RotateCcw, ShieldQuestion, Wallet, XCircle } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { BRAND } from "../../lib/brand";
import { raisePct } from "../../lib/budgetRaise";
import { STATUS } from "../../lib/format";
import { currentLocale, fmtNumber, useT } from "../../lib/i18n";
import { useStudio } from "../../lib/store";
import { runControls, type ForkEdit, type LiveRun, type LiveStep } from "../../lib/trace";
import type { CostBasis, ManifestChange, Run, RunBudget, RunEffect, StepAsk, StepRun } from "../../lib/types";
import { traceMsg as m } from "../../locales/trace";
import { Badge, Button, Modal, Segmented } from "../ui";

import { capSourceText, connectionLabel, fmtUsd, manifestChangeText, metricLabel, metricValue, stepAsk, type T } from "./runFormat";

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ------------------------------------------------------------------ başlık eylemleri
/** Duraklat (çalışırken) · Devam et (duraklatılmış/kesilmiş). Durdur düğmesi RunsPage'de kalır. */
export function RunPauseResume({ run, onError }: { run: Run; onError: (e: string | null) => void }) {
  const t = useT(m);
  const [busy, setBusy] = useState(false);
  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    onError(null);
    fn().catch((e: unknown) => onError(errText(e))).finally(() => setBusy(false));
  };
  if (run.status === "running" && run.pausing)  // zarif duraklatma sürüyor
    return <Button size="sm" disabled icon={<Pause size={14} />} title={t("pausing_title")} aria-label={t("pausing")}>{t("pausing")}</Button>;
  if (run.status === "running")
    return <Button size="sm" disabled={busy} icon={<Pause size={14} />} title={t("pause_title")} aria-label={t("pause")}
      onClick={() => act(() => runControls.pause(run.id))}>{t("pause")}</Button>;
  if ((run.status === "paused" || run.status === "interrupted") && run.resumable !== false)
    return <Button size="sm" variant="primary" disabled={busy} icon={<Play size={14} />}
      onClick={() => act(() => runControls.resume(run.id))}>{t("resume")}</Button>;
  return null;
}

export function ForkedFromLink({ run }: { run: Run }) {
  const t = useT(m);
  if (!run.forked_from) return null;
  return (
    <Link to={`/gorevler/${run.forked_from}`} className="chip tone-info hover:border-ink-2" title={t("forked_from", { id: run.forked_from })}>
      <GitFork size={12} aria-hidden />{t("forked_from", { id: run.forked_from.slice(0, 12) })}
    </Link>
  );
}

// ------------------------------------------------------------------ duraklatılmış koşuda onay kartı
/** Koşu duraklatılmış/kesilmiş mi: bu durumda onay kartı karar veremez (motor 409 "önce sürdür" döner). */
export function runSuspended(run: Pick<Run, "status">): boolean {
  return run.status === "paused" || run.status === "interrupted";
}

/** Onay kartının karar düğmeleri yerine: "Önce koşuyu sürdür" (sürdürünce kart yeniden açılır). */
export function ResumeFirst({ run }: { run: Run }) {
  const t = useT(m);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resume = () => {
    setBusy(true);
    setError(null);
    runControls.resume(run.id).catch((e: unknown) => setError(errText(e))).finally(() => setBusy(false));
  };
  return (
    <div className="flex flex-col gap-1.5" data-resume-first="">
      <p className="text-sm text-ink-2">{t("resume_first_text")}</p>
      {run.resumable !== false && (
        <div><Button size="sm" variant="primary" disabled={busy} icon={<Play size={14} />} onClick={resume}>{t("resume_first")}</Button></div>
      )}
      {error && <p className="text-sm font-semibold text-bad" role="alert">{error}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ "Devam et" şeridi
export function ResumeBanner({ run }: { run: LiveRun }) {
  const t = useT(m);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (run.status !== "paused" && run.status !== "interrupted") return null;
  const budget = run.status === "paused" && run.pause_reason === "budget";
  // onay adımında duraklatılan (gözetimsiz zamanlanmış) koşu kendi şeridini gösterir
  const approval = run.status === "paused" && run.pause_reason === "approval";
  // G4-REST: sürüm farkı onaylanmadı → koşu duraklatılmış kaldı
  const manifest = run.status === "paused" && run.pause_reason === "manifest";
  const title = run.status === "interrupted" ? t("banner_interrupted_title") : budget ? t("banner_budget_title")
    : approval ? t("banner_approval_title") : manifest ? t("banner_manifest_title") : t("banner_paused_title");
  const text = run.status === "interrupted" ? t("banner_interrupted_text", { brand: currentLocale() === "en" ? BRAND.nameEn : BRAND.name })
    : budget ? t("banner_budget_text") : approval ? t("banner_approval_text") : manifest ? t("banner_manifest_text")
    : t("banner_paused_text");
  const canResume = run.resumable !== false;
  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    fn().catch((e: unknown) => setError(errText(e))).finally(() => setBusy(false));
  };
  return (
    <section className="rounded-xl border-2 tone-warn p-3 sm:p-4 flex flex-col gap-2" role="status" aria-live="polite">
      <h3 className="font-display font-semibold text-sm flex items-center gap-2"><Pause size={16} aria-hidden />{title}</h3>
      <p className="text-sm text-ink">{canResume ? text : t("banner_not_resumable")}</p>
      {canResume && <p className="text-xs text-ink-2">{t("banner_effects_note")}</p>}
      <div className="flex flex-wrap gap-2">
        {canResume && (
          <Button variant="primary" disabled={busy} icon={<Play size={15} />} onClick={() => act(() => runControls.resume(run.id))}>{t("resume")}</Button>
        )}
        <Button variant="ghost" disabled={busy} icon={<XCircle size={15} />} onClick={() => act(() => api.cancelRun(run.id))}>{t("cancel_run")}</Button>
      </div>
      {error && <p className="text-sm font-semibold text-bad" role="alert">{error}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ bütçe çubuğu
const METRICS = ["tokens", "cost_usd", "minutes", "steps"] as const;
type Metric = (typeof METRICS)[number];

function Meter({ label, used, limit, value }: { label: string; used: number; limit: number; value: string }) {
  const ratio = limit > 0 ? used / limit : used > 0 ? 2 : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const tone = ratio > 1 ? "bg-red" : ratio >= 0.8 ? "bg-gold" : "bg-grass";
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-ink-2">{label}</span>
        <span className={clsx("num font-medium", ratio > 1 ? "text-bad" : ratio >= 0.8 ? "text-warn" : "text-ink")}>{value}</span>
      </div>
      <div className="h-2.5 rounded-full bg-panel-3 border border-line-soft overflow-hidden" role="progressbar" aria-label={label}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={value}>
        <div className={clsx("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function BudgetBar({ run }: { run: LiveRun }) {
  const t = useT(m);
  const [editing, setEditing] = useState(false);
  const budget = run.budget ?? {};
  const usage = run.usage ?? {};
  const basis = (usage.cost_basis ?? "unknown") as CostBasis;
  // abonelik (Claude Code / Codex oturumu) dolar harcamaz: $ ölçeri yerel gibi gösterilmez, tavanı işlemez
  const local = basis === "local" || basis === "subscription";
  const limited = METRICS.filter((k) => budget[k] != null);
  // çubuk GERÇEK harcamayı gösterir (durdurulan/yeniden oynatılan denemeler dahil): koşu tavanı, kart ve
  // "Bugünkü harcama" ile aynı sayı. Eski sunucu `spent` göndermezse güncel + yeniden oynatılan toplanır.
  const used = (k: Metric): number => {
    if (k === "steps") return Number(usage.steps ?? 0);
    const sp = usage.spent?.[k];
    if (sp != null) return Number(sp);
    return Number(usage[k] ?? 0) + Number(usage.replayed?.[k] ?? 0);
  };
  const costText = (): string => {
    if (basis === "subscription") return t("budget_subscription");
    if (local) return t("budget_local_free");
    if (usage.cost_usd == null) return t("budget_cost_unknown");
    const v = fmtUsd(used("cost_usd"));
    return basis === "estimated" ? `≈${v} · ${t("budget_cost_estimated")}` : basis === "mixed" ? `≈${v} · ${t("budget_cost_mixed")}` : v;
  };
  const label = (k: Metric) => k === "tokens" ? t("budget_tokens") : k === "cost_usd" ? t("budget_cost") : k === "minutes" ? t("budget_minutes") : t("budget_steps");
  // uyarı: kullanım/sınırdan türetilir (olayla gelen uyarı ayrıntı tazelenince kaybolmasın); yoksa son olay
  const derived = METRICS.filter((k) => budget[k] != null && Number(budget[k]) > 0 && !(k === "cost_usd" && local))
    .map((k) => ({ metric: k as string, ratio: used(k) / Number(budget[k]), exceeded: used(k) > Number(budget[k]) }))
    .filter((x) => x.ratio >= 0.8).sort((a, b) => b.ratio - a.ratio)[0];
  const alert = derived ?? run.budget_alert;
  const showRaise = run.status !== "done" && run.status !== "cancelled" && run.status !== "failed";
  const replayed = Number(usage.replayed?.tokens ?? 0);
  const estimated = Number(usage.estimated_unrecorded?.tokens ?? 0);
  return (
    <section className="@container panel-soft p-3 flex flex-col gap-2.5" aria-label={t("budget_title")}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-sm font-semibold flex items-center gap-1.5"><Wallet size={15} aria-hidden />{t("budget_title")}</h3>
        {!limited.length && <Badge>{t("budget_none")}</Badge>}
        {run.budget_auto?.source === "auto" && <Badge tone="info"><Gauge size={12} aria-hidden />{t("budget_auto")}</Badge>}
        {alert && (
          <Badge tone={alert.exceeded ? "bad" : "warn"}>
            <AlertTriangle size={12} aria-hidden />{t(alert.exceeded ? "budget_exceeded" : "budget_warning", { metric: metricLabel(t, alert.metric) })}
          </Badge>
        )}
        {showRaise && !editing && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing(true)}>{limited.length ? t("budget_raise") : t("budget_set")}</Button>
        )}
      </div>
      <div className="grid gap-2.5 grid-cols-2 @md:grid-cols-3">
        {(["tokens", "cost_usd", "minutes"] as const).map((k) => {
          const lim = budget[k];
          if (k === "cost_usd" && (local || lim == null))
            return <div key={k} className="flex flex-col gap-1 text-xs min-w-0"><span className="font-semibold text-ink-2">{label(k)}</span>
              <span className="num text-ink">{costText()}</span></div>;
          if (lim == null)
            return <div key={k} className="flex flex-col gap-1 text-xs min-w-0"><span className="font-semibold text-ink-2">{label(k)}</span>
              <span className="num text-ink">{t("budget_used_only", { used: metricValue(t, k, used(k)) })}</span></div>;
          const value = t("budget_of", { used: metricValue(t, k, used(k)), limit: metricValue(t, k, lim) })
            + (k === "cost_usd" && basis === "estimated" ? ` · ${t("budget_cost_estimated")}` : "");
          return <Meter key={k} label={label(k)} used={used(k)} limit={lim} value={value} />;
        })}
        {budget.steps != null && (
          <Meter label={label("steps")} used={used("steps")} limit={budget.steps}
            value={t("budget_of", { used: metricValue(t, "steps", used("steps")), limit: metricValue(t, "steps", budget.steps) })} />
        )}
      </div>
      {run.budget_auto?.source === "auto" && (
        <p className="text-xs text-ink-2">{t("budget_auto_hint", { estimate: fmtNumber(run.budget_auto.estimate) })}
          {run.budget_auto.raised ? ` ${t("budget_auto_raised")}` : run.budget_auto.topped_up ? ` ${t("budget_auto_topped")}` : ""}</p>
      )}
      {replayed > 0 && <p className="text-xs text-ink-2">{t("budget_replayed", { n: fmtNumber(replayed) })}</p>}
      {estimated > 0 && <p className="text-xs text-ink-2">{t("budget_estimated", { n: fmtNumber(estimated) })}</p>}
      {!!run.unrecorded_possible?.requests && (
        <p className="text-xs text-ink-2" role="note">{t("budget_unrecorded", { count: run.unrecorded_possible.requests,
          n: fmtNumber(run.unrecorded_possible.tokens_max) })}</p>
      )}
      {run.budget_clamp?.metrics && Object.keys(run.budget_clamp.metrics).length > 0 && (
        <p className="text-xs text-ink-2">{t("budget_safe_clamped", {
          metrics: Object.keys(run.budget_clamp.metrics).map((k) => metricLabel(t, k)).join(", ") })}</p>
      )}
      {run.degraded && (
        <p className="text-xs font-medium text-warn flex items-center gap-1.5"><PlugZap size={13} aria-hidden />
          {t("degraded", { kind: connectionLabel(t, run.degraded.kind), n: run.degraded.failures })}</p>
      )}
      {editing && <BudgetForm run={run} local={local} onClose={() => setEditing(false)} />}
    </section>
  );
}

function BudgetForm({ run, local, onClose }: { run: Run; local: boolean; onClose: () => void }) {
  const t = useT(m);
  const id = useId();
  const b = run.budget ?? {};
  const suggest = (v?: number | null, d?: number) => (v != null ? String(Math.round(v * 1.5 * 100) / 100) : d != null ? String(d) : "");
  const [vals, setVals] = useState<Record<string, string>>({
    tokens: suggest(b.tokens), cost_usd: suggest(b.cost_usd), minutes: suggest(b.minutes),
  });
  const [onEx, setOnEx] = useState<NonNullable<RunBudget["on_exceeded"]>>(b.on_exceeded ?? "pause");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields: { k: "tokens" | "cost_usd" | "minutes"; label: string }[] = [
    { k: "tokens", label: t("budget_tokens") },
    ...(local ? [] : [{ k: "cost_usd" as const, label: `${t("budget_cost")} (USD)` }]),
    { k: "minutes", label: `${t("budget_minutes")} (${t("budget_minutes_val", { n: "" }).trim()})` },
  ];
  const save = async () => {
    const patch: RunBudget = { on_exceeded: onEx };
    for (const f of fields) {
      const raw = vals[f.k]?.trim();
      if (raw) patch[f.k] = Number(raw);
    }
    setBusy(true);
    setError(null);
    try {
      await runControls.budget(run.id, patch);
      await useStudio.getState().loadRun(run.id);
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="flex flex-col gap-2 border-t-2 border-line-soft pt-2.5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="flex flex-wrap gap-2">
        {fields.map((f) => (
          <label key={f.k} className="flex flex-col gap-1 min-w-0 basis-28 grow" htmlFor={`${id}-${f.k}`}>
            <span className="label">{f.label}</span>
            <input id={`${id}-${f.k}`} className="input !py-1.5 !text-sm num" type="number" min={0} step="any" inputMode="decimal"
              value={vals[f.k] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f.k]: e.target.value }))} />
          </label>
        ))}
        <label className="flex flex-col gap-1 min-w-0 basis-32 grow" htmlFor={`${id}-on`}>
          <span className="label">{t("budget_on_exceeded")}</span>
          <select id={`${id}-on`} className="select !py-1.5 !text-sm" value={onEx} onChange={(e) => setOnEx(e.target.value as typeof onEx)}>
            <option value="pause">{t("budget_on_pause")}</option>
            <option value="ask">{t("budget_on_ask")}</option>
            <option value="stop">{t("budget_on_stop")}</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-ink-2">{t("budget_input_hint")}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>{t("budget_save")}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>{t("budget_cancel")}</Button>
      </div>
      {error && <p className="text-sm font-semibold text-bad" role="alert">{error}</p>}
    </form>
  );
}

// ------------------------------------------------------------------ G4-REST: manifest farkı şeridi ve adım tavanı
function ManifestChangeList({ changes }: { changes: ManifestChange[] }) {
  const t = useT(m);
  const agents = useStudio((s) => s.agents);  // ajan kimliği yerine görünen ad
  const nameOf = (slug: string) => agents.find((a) => a.slug === slug)?.name ?? slug;
  return (
    <ul className="text-sm list-disc pl-5 flex flex-col gap-0.5 break-words min-w-0">
      {changes.map((c, i) => (
        <li key={`${c.field}:${c.key ?? ""}:${c.attr ?? ""}:${i}`}>
          {manifestChangeText(t, c, nameOf)}{c.material && <span className="font-semibold text-warn"> · {t("mdiff_material")}</span>}
        </li>
      ))}
    </ul>
  );
}

/** "Koşu başladıktan sonra değişenler: …" — devamda başlangıç manifestinden farklar (önemliyse onay kartı da açılır). */
export function ManifestDiffBanner({ run }: { run: Run }) {
  const t = useT(m);
  const diff = run.manifest_diff;
  if (!diff || !diff.changes?.length) return null;
  const status = diff.status === "pending" ? t("mdiff_status_pending") : diff.status === "confirmed" ? t("mdiff_status_confirmed")
    : diff.status === "rejected" ? t("mdiff_status_rejected") : t("mdiff_status_warned");
  return (
    <section className={clsx("rounded-xl border-2 p-3 sm:p-4 flex flex-col gap-2", diff.material ? "tone-warn" : "border-line-soft")}
      role="status" aria-live="polite" data-manifest-diff={diff.status}>
      <h3 className="font-display font-semibold text-sm flex items-center gap-2"><GitCompare size={16} aria-hidden />{t("mdiff_title")}</h3>
      <ManifestChangeList changes={diff.changes} />
      <p className="text-xs text-ink-2">{status}</p>
    </section>
  );
}

/** Adımın etkin jeton tavanı ve kaynağı (rozet; ayrıntı ipucunda). */
export function StepCapBadge({ step }: { step: StepRun }) {
  const t = useT(m);
  const cap = step.cap;
  if (!cap || cap.tokens == null) return null;
  const detail = cap.source === "estimate"
    ? t("cap_title_estimate", { floor: fmtNumber(cap.floor ?? 0), ceiling: fmtNumber(cap.ceiling ?? 0) }) : undefined;
  // bu beyinde tavan nerede uygulanır (tur sınırında / yalnız adım bitince) — tavanın hemen yanında
  const enf = step.enforcement === "turn" ? t("enf_badge_turn") : step.enforcement === "step_end" ? t("enf_badge_step_end") : null;
  return (
    // uzun tavan metni 375 px'te kaydırma yaratmasın — rozet sarar, kapsayıcı genişliğini aşmaz
    <Badge title={detail} tone={cap.source === "estimate" ? "info" : undefined}
      className="whitespace-normal break-words max-w-full rounded-lg h-auto">
      <Gauge size={12} aria-hidden />{t("cap_badge", { n: fmtNumber(Math.round(cap.tokens)), src: capSourceText(t, cap) })}
      {enf ? ` · ${enf}` : ""}
    </Badge>
  );
}

// ------------------------------------------------------------------ adım eylemleri
export function StepRetryInfo({ step }: { step: LiveStep }) {
  const t = useT(m);
  const bits: ReactNode[] = [];
  // etiket model turu gönderen deneme sayısından (`tries`); bütçe geçidinde model çağırmadan duran başlangıç
  // "2. deneme" sayılmaz. Model turu olmayan adımlar (araç, onay) için başlangıç sayısı.
  const tries = typeof step.tries === "number" && (step.tries > 0 || step.route) ? step.tries : step.attempt ?? 0;
  if (tries > 1) bits.push(<Badge key="a" tone="info"><RotateCcw size={12} aria-hidden />{t("attempt_n", { n: tries })}</Badge>);
  if (step.soft_fail) bits.push(<Badge key="s" tone="warn">{t("soft_fail")}</Badge>);
  if (step.retry_at) {
    const s = Math.max(0, Math.round((step.retry_at - Date.now()) / 1000));
    bits.push(<Badge key="r" tone="warn" title={step.retry_reason ?? undefined}>{s > 0 ? t("retry_in", { s }) : t("retry_pending")}</Badge>);
  }
  return bits.length ? <>{bits}</> : null;
}

export function StepActions({ run, step }: { run: Run; step: StepRun }) {
  const t = useT(m);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  const top = !step.parent;
  const agentLike = step.type === "agent" || step.type === "delegate";
  // orkestratör de havuzlu yöneticidir: "Yeniden dene" ve "Baştan çalıştır" onda da var
  const pooled = step.type === "delegate" || step.type === "orchestrate";
  const canRetry = (agentLike || step.type === "orchestrate") && ["failed", "rejected", "cancelled", "skipped"].includes(step.status);
  const canFork = top && agentLike && (step.status === "done" || step.status === "failed" || step.status === "skipped");
  if (!canRetry && !canFork) return null;
  const running = run.status === "running";
  const retry = (fresh = false) => {
    setBusy(true);
    setError(null);
    runControls.retryStep(run.id, step.id, fresh).catch((e: unknown) => setError(errText(e))).finally(() => setBusy(false));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        {canRetry && (
          <Button size="sm" disabled={busy || running} icon={<RotateCcw size={14} />} title={running ? t("retry_running_hint") : t("retry_title")}
            onClick={() => retry()}>{t("retry_step")}</Button>
        )}
        {/* önceki denemenin yan etkili yürütmeleri varsayılan olarak tekrar kullanılır; bilinçli olarak
            yeniden yürütmek isteyen kullanıcı "baştan çalıştır" der (havuzsuz)*/}
        {canRetry && pooled && (
          <Button size="sm" variant="ghost" disabled={busy || running} icon={<RotateCcw size={14} />}
            title={t("retry_fresh_title")} onClick={() => retry(true)}>{t("retry_fresh")}</Button>
        )}
        {canFork && (
          <Button size="sm" variant="ghost" icon={<Pencil size={14} />} title={t("edit_fork_title")} onClick={() => setForking(true)}>{t("edit_fork")}</Button>
        )}
      </div>
      {running && canRetry && <p className="text-xs text-ink-2">{t("retry_running_hint")}</p>}
      {error && <p className="text-sm font-semibold text-bad" role="alert">{error}</p>}
      {forking && <ForkModal run={run} step={step} onClose={() => setForking(false)} />}
    </div>
  );
}

function ForkModal({ run, step, onClose }: { run: Run; step: StepRun; onClose: () => void }) {
  const t = useT(m);
  const navigate = useNavigate();
  const id = useId();
  const promptEditable = step.type !== "approval" && typeof step.prompt === "string";
  const [mode, setMode] = useState<"output" | "prompt">("output");
  const [text, setText] = useState(step.output ?? "");
  const [prompt, setPrompt] = useState(step.prompt ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async (body: { from_step?: string; edits?: Record<string, ForkEdit> }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await runControls.fork(run.id, body);
      onClose();
      navigate(`/gorevler/${res.run_id}`);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={t("fork_modal_title", { title: step.title || step.id })} width={760}
      footer={<>
        <Button variant="ghost" disabled={busy} icon={<RotateCcw size={15} />} title={t("fork_rerun_hint")}
          onClick={() => go({ from_step: step.id })}>{t("fork_rerun")}</Button>
        {mode === "output" ? (
          <Button variant="primary" disabled={busy || !text.trim()} icon={<GitFork size={15} />}
            onClick={() => go({ edits: { [step.id]: text } })}>{busy ? t("fork_busy") : t("fork_with_edit")}</Button>
        ) : (
          <Button variant="primary" disabled={busy || !prompt.trim()} icon={<GitFork size={15} />}
            onClick={() => go({ edits: { [step.id]: { prompt } } })}>{busy ? t("fork_busy") : t("fork_with_prompt")}</Button>
        )}
      </>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink">{t("fork_intro")}</p>
        {promptEditable && (
          <Segmented value={mode} onChange={setMode} options={[
            { value: "output", label: t("fork_mode_output") },
            { value: "prompt", label: t("fork_mode_prompt") },
          ]} />
        )}
        {mode === "output" ? (
          <label className="flex flex-col gap-1" htmlFor={`${id}-out`}>
            <span className="label">{t("fork_output_label")}</span>
            <textarea id={`${id}-out`} className="input font-mono text-sm min-h-[14rem]" value={text} onChange={(e) => setText(e.target.value)} />
          </label>
        ) : (
          <label className="flex flex-col gap-1" htmlFor={`${id}-prompt`}>
            <span className="label">{t("fork_prompt_label")}</span>
            <textarea id={`${id}-prompt`} className="input text-sm min-h-[14rem]" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
        )}
        <ul className="text-xs text-ink-2 flex flex-col gap-1 list-disc pl-4">
          <li>{mode === "output" ? t("fork_with_edit_hint") : t("fork_with_prompt_hint")}</li>
          <li>{t("fork_rerun_hint")}</li>
        </ul>
        {error && <p className="text-sm font-semibold text-bad" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ onay kartları (ask · effect · budget)
// koşunun gerçek harcaması (bütçe kutusuyla aynı kural: `spent`, yoksa güncel + yeniden oynatılan)
function runSpentTokens(run: Run): number {
  const u = run.usage ?? {};
  const sp = u.spent?.tokens;
  return sp != null ? Number(sp) : Number(u.tokens ?? 0) + Number(u.replayed?.tokens ?? 0);
}

function effectText(t: T, e: RunEffect): string {
  const detail = e.detail ?? "";
  if (e.kind === "tool") return t("effect_tool", { name: detail.replace(/^araç:\s*/, "") || "?" });
  if (e.kind === "file") return t("effect_file");
  if (e.kind === "workdir") return t("effect_workdir");
  if (e.kind === "hire") return t("effect_hire");
  if (e.kind === "message") return t("effect_message");
  return t("effect_other", { kind: e.kind });
}

/** koşu kartı sınırın otomatik koşu bütçesi olduğunu söyler (bilgi yalnız üstteki kutuda değil).*/
function AutoBudgetNote({ run, ask }: { run: Run; ask: StepAsk & { kind: "budget" } }) {
  const t = useT(m);
  const auto = run.budget_auto;
  if (!ask.auto_budget || !auto || auto.source !== "auto") return null;
  return <>
    <p className="text-xs text-ink-2 break-words">{t(auto.with_user?.length ? "budget_card_auto_with_user" : "budget_card_auto",
      { estimate: metricValue(t, "tokens", auto.estimate) })}</p>
    {/* süre / adım sınırı + duraklat / durdur koşusunun token ağı: tek soru, sonra kullanıcının eylemi*/}
    {(ask.net === "pause" || ask.net === "stop") && (
      <p className="text-xs text-ink-2 break-words">{t(ask.net === "pause" ? "budget_card_net_pause" : "budget_card_net_stop")}</p>
    )}
  </>;
}

/** para tavanının kutudaki metni yerel ondalık ayırıcıyla (TR "12,21", EN "12.21"); binlik ayırıcı yok.*/
export function decimalText(v: number, locale: string = currentLocale()): string {
  const txt = String(Math.round(v * 1e6) / 1e6);
  return locale === "tr" ? txt.replace(".", ",") : txt;
}

/** "12,21", "12.21", "1.234,50", "1,234.50", "$0,35" → sayı. İki ayırıcı varsa SONUNCUSU ondalıktır; tek
 * ayırıcı (nokta ya da virgül) ondalıktır. Okunamazsa NaN (kart "çok düşük" der, değer uygulanmaz).*/
export function parseDecimal(raw: string): number {
  const s = raw.replace(/[\s$\u00a0]/g, "");
  if (!/^[0-9.,]+$/.test(s)) return NaN;
  const dot = s.lastIndexOf("."), comma = s.lastIndexOf(",");
  let norm = s;
  if (dot >= 0 && comma >= 0) {
    const dec = Math.max(dot, comma);
    norm = s.slice(0, dec).replace(/[.,]/g, "") + "." + s.slice(dec + 1).replace(/[.,]/g, "");
  } else if (comma >= 0) {
    norm = (s.match(/,/g) ?? []).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length > 1) {
    norm = s.replace(/\./g, "");
  }
  return norm === "" || norm === "." ? NaN : Number(norm);
}

/** 3. koşu kartından itibaren her zaman "Bitene kadar devam et": düzenlenebilir mutlak tavan
 * (varsayılan bu kartın önerisi). yazılan değer aynen uygulanır; harcanan + uçuştaki turların altındaysa
 * sınır o taban olur (kart bunu önceden söyler).*/
function UntilDone({ ask, used, busy, decide }: { ask: StepAsk & { kind: "budget" }; used: number; busy: boolean;
  decide: (approved: boolean, note?: string) => Promise<void> }) {
  const t = useT(m);
  const id = useId();
  const def = typeof ask.until_done_cap === "number" ? ask.until_done_cap : null;
  // para metrikli koşu kartında tavan dolar cinsinden (ondalık); token kartında tam sayı
  const cost = ask.until_done_metric === "cost_usd";
  const metric = cost ? "cost_usd" : "tokens";
  // TR'de ondalık virgül ("12,21"); okuma iki ayırıcıyı da kabul eder
  const [val, setVal] = useState(def != null ? (cost ? decimalText(def) : String(Math.round(def))) : "");
  if (def == null || !(ask.choices ?? []).includes("until_done")) return null;
  const n = cost ? parseDecimal(val) : Number(val.replace(/[^0-9]/g, ""));
  const ok = Number.isFinite(n) && n > (used ?? 0);
  const floor = typeof ask.until_done_floor === "number" ? ask.until_done_floor : null;
  const floored = ok && floor != null && n < floor;
  return (
    <div className="flex flex-col gap-1.5 w-full min-w-0">
      <p className="text-xs text-ink-2 break-words">{t("budget_until_done_text", { value: metricValue(t, metric, def) })}</p>
      <div className="flex flex-wrap gap-2 items-end min-w-0">
        <label className="flex flex-col gap-1 min-w-0" htmlFor={`${id}-ud`}>
          <span className="label">{t(cost ? "budget_until_done_label_cost" : "budget_until_done_label")}</span>
          <input id={`${id}-ud`} className="input !py-1.5 !text-sm w-40 max-w-full" inputMode={cost ? "decimal" : "numeric"} value={val}
            aria-invalid={!ok} onChange={(e) => setVal(e.target.value)} />
        </label>
        <Button disabled={busy || !ok} icon={<Wallet size={15} />} onClick={() => decide(true, `until_done:${cost ? n : Math.round(n)}`)}
          className="whitespace-normal text-left max-w-full min-w-0">{t("budget_until_done")}</Button>
      </div>
      {!ok && <p className="text-xs text-bad" role="alert">{t("budget_until_done_low")}</p>}
      {floored && <p className="text-xs text-warn break-words" role="status">{t("budget_until_done_floor",
        { floor: metricValue(t, metric, floor) })}</p>}
    </div>
  );
}

/** kullanıcı aşımda duraklat / durdur seçmişti ama sınır henüz dolmadı ve işlerin boyutu bilinmiyor: kart neden
 * sorduğunu tek düz satırla söyler.*/
function AskedInstead({ ask }: { ask: StepAsk & { kind: "budget" } }) {
  const t = useT(m);
  if (ask.asked_instead_of !== "pause" && ask.asked_instead_of !== "stop") return null;
  return <p className="text-xs text-ink-2 break-words">{t(ask.asked_instead_of === "pause" ? "budget_asked_instead_pause"
    : "budget_asked_instead_stop")}</p>;
}

/** önerinin neden bu büyüklükte olduğu (tek düz satır) ve tavanla tutarlı beklenen maliyet (ayrı etiketli).*/
function ProposalBasis({ ask }: { ask: StepAsk & { kind: "budget" } }) {
  const t = useT(m);
  const b = ask.proposal_basis;
  const cap = ask.proposal?.tokens;
  if (!b) return null;
  const why = b.kind === "live"
    ? t("budget_basis_live", { r: fmtNumber(b.ratio ?? 1), m: fmtNumber(b.multiple ?? 1) })
    : b.kind === "spent" ? t("budget_basis_spent", { m: fmtNumber(b.multiple ?? 1) }) : t("budget_basis_history");
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <p className="text-xs text-ink-2 break-words">{why}</p>
      {typeof b.expected === "number" && b.expected > 0 && typeof cap === "number" && (
        <p className="text-xs text-ink-2 break-words">{t("budget_basis_expected_ceiling",
          { expected: metricValue(t, "tokens", b.expected), ceiling: metricValue(t, "tokens", cap) })}</p>
      )}
    </div>
  );
}

export function AskCard({ run, step }: { run: Run; step: StepRun }) {
  const t = useT(m);
  const connections = useStudio((s) => s.connections);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState("");
  const ask = stepAsk(run, step) as StepAsk;
  const waiting = step.status === "awaiting_approval";
  // açık koşu kartı bütçe kutusuyla AYNI sayıları gösterir (kart açıkken çalışan işler sürebilir)
  const liveRun = waiting && ask.kind === "budget" && ask.scope === "run" && ask.metric === "tokens";
  const liveUsed = liveRun ? runSpentTokens(run) : null;
  const liveLimit = liveRun && run.budget?.tokens != null ? Number(run.budget.tokens) : null;
  // bütçe kartı ölçtüğü işi adlandırır (ör. orkestratörün sentezi "Sentez · Şef"), kartı taşıyan adımı değil
  const subjectId = ask.kind === "budget" ? (ask.subject || ask.step) : ask.step;
  const target = run.steps.find((s) => s.id === subjectId);
  const title = (ask.kind === "budget" ? ask.subject_title : null) || target?.title || subjectId;
  const brains = useMemo(() => connections.filter((c) => c.available)
    .map((c) => (c.kind === "hermes" ? "profile" : (c.kind as string)))
    .filter((k) => k !== (ask.kind === "on_fail" ? ask.connection : "")), [connections, ask]);
  const decide = async (approved: boolean, note = "") => {
    setBusy(true);
    setError(null);
    try {
      await api.decide(run.id, step.id, approved, note);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  let head: ReactNode, body: ReactNode, actions: ReactNode;
  if (ask.kind === "on_fail") {
    head = t("ask_fail_title", { title });
    body = <>
      <p className="text-sm">{t("ask_fail_text", { n: ask.attempt ?? 1 })}</p>
      {ask.error && <p className="chip tone-bad !rounded-lg !whitespace-normal !items-start font-medium p-2 text-sm">{ask.error}</p>}
      {ask.degraded && <p className="text-sm text-warn font-medium">{t("ask_fail_degraded", { conn: connectionLabel(t, ask.connection) })}</p>}
    </>;
    actions = <>
      <Button variant="primary" disabled={busy} icon={<RotateCcw size={15} />} onClick={() => decide(true, "retry")}>{t("ask_retry")}</Button>
      <Button disabled={busy} onClick={() => decide(true, "skip")}>{t("ask_skip")}</Button>
      {brains.length > 0 && (
        <span className="flex gap-1.5 items-center min-w-0">
          <select className="select !py-1.5 !text-sm min-w-0" aria-label={t("ask_route_pick")} value={route} onChange={(e) => setRoute(e.target.value)}>
            <option value="">{t("ask_route_pick")}</option>
            {brains.map((b) => <option key={b} value={b}>{connectionLabel(t, b)}</option>)}
          </select>
          <Button disabled={busy || !route} icon={<PlugZap size={15} />} onClick={() => decide(true, `route:${route}`)}>{t("ask_route")}</Button>
        </span>
      )}
      <Button variant="danger" disabled={busy} icon={<XCircle size={15} />} onClick={() => decide(false)}>{t("ask_stop")}</Button>
    </>;
  } else if (ask.kind === "unknown_effect") {
    head = t("effect_title");
    body = <>
      <p className="text-sm">{t("effect_text", { title })}</p>
      <ul className="text-sm list-disc pl-5 flex flex-col gap-0.5">
        {(ask.effects ?? []).map((e) => <li key={e.id}>{effectText(t, e)}</li>)}
      </ul>
      <p className="text-sm text-ink-2">{t("effect_risk")}</p>
    </>;
    actions = <>
      <Button variant="primary" disabled={busy} icon={<CheckCircle2 size={15} />} onClick={() => decide(true)}>{t("effect_continue")}</Button>
      <Button variant="danger" disabled={busy} icon={<XCircle size={15} />} onClick={() => decide(false)}>{t("effect_skip")}</Button>
    </>;
  } else if (ask.kind === "manifest_diff") {
    // G4-REST: koşu başladıktan sonra beyin/model, akış tanımı ya da skill sürümü değişti
    const material = (ask.changes ?? []).filter((c) => c.material);
    head = t("mdiff_card_title");
    body = <>
      <p className="text-sm">{t("mdiff_card_text", { title })}</p>
      <ManifestChangeList changes={material.length ? material : ask.changes ?? []} />
      <p className="text-xs text-muted">{t("mdiff_user_only")}</p>
    </>;
    actions = <>
      <Button variant="primary" disabled={busy} icon={<CheckCircle2 size={15} />} onClick={() => decide(true)}>{t("mdiff_approve")}</Button>
      <Button variant="danger" disabled={busy} icon={<XCircle size={15} />} onClick={() => decide(false)}>{t("mdiff_reject")}</Button>
    </>;
  } else if (ask.kind === "step_approval") {
    // adım başı onay — before: gönderilecek istem (model çağrılmadı) · after: tutulan çıktı
    const before = ask.phase === "before";
    const text = (before ? ask.prompt : ask.output) ?? "";
    head = t(before ? "gate_before_title" : "gate_after_title", { title });
    body = <>
      <p className="text-sm">{t(before ? "gate_before_text" : "gate_after_text")}</p>
      {!!ask.route && <p className="text-sm text-ink-2">{t("gate_route", { route: ask.route })}</p>}
      {!!ask.skills?.length && <p className="text-sm text-ink-2 break-words">{t("gate_skills", { list: ask.skills.join(", ") })}</p>}
      <span className="text-xs font-semibold text-muted">{t(before ? "gate_prompt" : "gate_output", { n: fmtNumber(ask.chars ?? text.length) })}</span>
      <pre className="text-xs font-mono whitespace-pre-wrap break-words text-ink-2 max-h-72 overflow-y-auto panel-soft p-2" tabIndex={0}>{text}</pre>
      {before && !!ask.system && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-muted">{t("gate_system")}</summary>
          <pre className="mt-1.5 text-xs font-mono whitespace-pre-wrap break-words text-ink-2 max-h-48 overflow-y-auto panel-soft p-2">{ask.system}</pre>
        </details>
      )}
      {(ask.prompt_truncated || ask.output_truncated) && <p className="text-xs text-muted">{t("gate_truncated")}</p>}
      <p className="text-xs text-muted">{t("gate_user_only")}</p>
    </>;
    actions = <>
      <Button variant="primary" disabled={busy} icon={<CheckCircle2 size={15} />} onClick={() => decide(true)}>{t(before ? "gate_approve_before" : "gate_approve_after")}</Button>
      <Button variant="danger" disabled={busy} icon={<XCircle size={15} />} onClick={() => decide(false)}>{t("gate_reject")}</Button>
    </>;
  } else if (ask.kind === "budget" && (ask.group?.length ?? 0) > 1) {
    // aynı koşu tavanını paylaşan işler için TEK koşu kartı (durdurulan, çalışan, sırada bekleyen)
    const proposal = ask.metric === "cost_usd" ? ask.proposal?.cost_usd : ask.proposal?.tokens;
    // koşu genelindeki kartta henüz kurulmamış sentezler de adıyla ("Sentez · Şef") görünür
    const names = (ids?: string[]) => (ids ?? []).map((id) => ask.group_titles?.[id] || run.steps.find((x) => x.id === id)?.title || id).join(", ");
    const partialFirst = ask.primary === "accept_partial";
    const wrapBtn = "whitespace-normal text-left max-w-full min-w-0";
    const syntheses = ask.group_syntheses ?? (ask.group_synthesis ? [ask.group_synthesis] : []);
    // sınır dolmadı, kalan işler sığmıyor (rezervasyon): "doldu" denmez
    // token sınırı olmayan koşunun gruplanmış PARA kartı dolar cinsinden (harcanan, sınır, öneri, "bitene kadar")
    const gMetric = ask.metric === "cost_usd" ? "cost_usd" : "tokens";
    const gUsed = gMetric === "tokens" ? (liveUsed ?? ask.used_now ?? ask.used)
      : (waiting && run.usage?.spent?.cost_usd != null ? Number(run.usage.spent.cost_usd) : ask.used);
    const gLimit = gMetric === "tokens" ? (liveLimit ?? ask.limit)
      : (waiting && run.budget?.cost_usd != null ? Number(run.budget.cost_usd) : ask.limit);
    const gProjected = !!ask.projected && !(gLimit != null && gUsed >= gLimit);  // sınır doldu artık
    // "Çalışan" listesi canlı: kart açıldıktan sonra tur sınırında duran iş "Durdurulan"a geçer, biten düşer
    const stNow = (id: string) => run.steps.find((x) => x.id === id)?.status;
    const runningNow = (ask.group_running ?? []).filter((id) => waiting ? stNow(id) === "running" : true);
    const stoppedNow = [...(ask.group_stopped ?? []), ...(waiting ? (ask.group_running ?? []).filter((id) => {
      const s = stNow(id);
      return s !== "running" && s !== "done" && s !== "skipped" && s !== "failed" && s !== "cancelled";
    }) : [])];
    head = t(gProjected ? "budget_group_title_projected" : "budget_group_title");
    body = <>
      <p className="text-sm">{t(gProjected ? "budget_group_text_projected" : "budget_group_text", { n: fmtNumber(ask.group?.length ?? 0), used: metricValue(t, gMetric, gUsed),
        limit: metricValue(t, gMetric, gLimit) })}</p>
      <ul className="text-sm text-ink-2 break-words list-disc pl-5">
        {stoppedNow.length > 0 && <li>{t("budget_group_stopped", { list: names(stoppedNow) })}</li>}
        {runningNow.length > 0 && <li>{t("budget_group_running", { list: names(runningNow) })}</li>}
        {(ask.group_waiting?.length ?? 0) > 0 && <li>{t("budget_group_waiting", { list: names(ask.group_waiting) })}</li>}
        {syntheses.length === 1 && <li>{t("budget_group_synthesis")}</li>}
        {syntheses.length > 1 && <li>{t("budget_group_syntheses", { list: names(syntheses) })}</li>}
      </ul>
      {!ask.proposal_basis && typeof ask.expected?.tokens === "number" && ask.expected.tokens > 0 && (
        <p className="text-sm text-ink-2">{t("budget_group_expected", { value: metricValue(t, "tokens", ask.expected.tokens) })}</p>
      )}
      {/* önceki onaylı tam deneme de yetmediği için öneri büyütüldü*/}
      {typeof ask.growth === "number" && ask.growth > 1 && (
        <p className="text-xs text-ink-2 break-words">{t("budget_card_growth", { g: fmtNumber(ask.growth) })}</p>
      )}
      {proposal != null && <p className="text-sm text-ink-2">{t("budget_card_proposal_plain", { value: metricValue(t, gMetric, proposal) })}</p>}
      <ProposalBasis ask={ask} />
      <AskedInstead ask={ask} />
      {/* tek harcama rakamı (bütçe kutusuyla aynı, canlı)*/}
      {typeof gUsed === "number" && gUsed > 0 && (
        <p className="text-xs text-ink-2 break-words">{t("budget_card_absolute", { spent: metricValue(t, gMetric, gUsed) })}</p>
      )}
      <AutoBudgetNote run={run} ask={ask} />
      {!!ask.co_raise_steps && Object.keys(ask.co_raise_steps).length > 0 && (
        <p className="text-xs text-ink-2 break-words">{t("budget_group_co_raise", { n: fmtNumber(Object.keys(ask.co_raise_steps).length) })}</p>
      )}
      {!!ask.own_tools && !!ask.rerun && <p className="text-xs text-muted break-words">{t("budget_card_own_tools", { brain: ask.own_tools })}</p>}
      {partialFirst && (
        <p className="text-sm font-semibold break-words">{t("budget_group_partial_total", { n: fmtNumber(ask.approvals ?? 0),
          spent: metricValue(t, gMetric, gUsed ?? 0) })}</p>
      )}
      {partialFirst && typeof ask.partial_cap === "number" && (
        <p className="text-xs text-ink-2 break-words">{t("budget_group_partial_cap", { value: metricValue(t, "tokens", ask.partial_cap) })}</p>
      )}
    </>;
    actions = <>
      {partialFirst && (
        <Button variant="primary" disabled={busy} icon={<CheckCircle2 size={15} />} onClick={() => decide(true, "partial")} className={wrapBtn}>
          {t("budget_group_accept_partial")}
        </Button>
      )}
      <Button variant={partialFirst ? "default" : "primary"} disabled={busy} icon={<Wallet size={15} />} onClick={() => decide(true)} className={wrapBtn}>
        {partialFirst ? t("budget_card_raise_secondary") : t("budget_group_approve")}
      </Button>
      <UntilDone ask={ask} used={gUsed} busy={busy} decide={decide} />
      <Button variant="danger" disabled={busy} icon={<XCircle size={15} />} onClick={() => decide(false)}>{t("budget_group_stop")}</Button>
    </>;
  } else if (ask.scope === "kept") {
    // PROC-FIX biten adım kendi tavanını aştı; çıktısı korundu — tavan değişmez, yalnız devam / durdur
    head = t("budget_kept_title");
    body = <>
      <p className="text-sm">{t("budget_kept_text", { step: ask.overran_title ?? (ask.overran_step ? run.steps.find((x) => x.id === ask.overran_step)?.title : null) ?? ask.overran_step ?? "?", metric: metricLabel(t, ask.metric),
        used: metricValue(t, ask.metric, ask.used), limit: metricValue(t, ask.metric, ask.limit) })}</p>
      {/* PROC2-FIX sıradaki adımın beklenen maliyeti o adımın beyninden*/}
      {typeof ask.expected?.tokens === "number" && ask.expected.tokens > 0 && (
        <p className="text-sm text-ink-2">{t(ask.local ? "budget_card_expected_local" : "budget_card_expected",
          { value: metricValue(t, "tokens", ask.expected.tokens) })}</p>
      )}
      {/* aşan adımın beyni kullanımı yalnız adım sonunda bildirdiyse açıkça söylenir*/}
      {ask.enforcement && (
        <p className="text-xs text-muted break-words">{t(ask.enforcement === "turn" ? "budget_card_enf_turn" : "budget_card_enf_step_end")}</p>
      )}
    </>;
    actions = <>
      <Button variant="primary" disabled={busy} icon={<Wallet size={15} />} onClick={() => decide(true)}>{t("budget_kept_approve")}</Button>
      <Button variant="danger" disabled={busy} icon={<XCircle size={15} />} onClick={() => decide(false)}>{t("budget_card_stop")}</Button>
    </>;
  } else {
    const metric = ask.metric;
    const proposal = ask.proposal?.[metric];
    const daily = ask.scope === "daily";  // karar 13: günlük toplam tavan kartı (bugün için yükselt / durdur)
    // PROC-FIX rezervasyon kartında `used` öngörülen toplamdır; gerçek kullanılan `used_now`
    const used = liveUsed ?? (typeof ask.used_now === "number" ? ask.used_now : ask.used);
    const limitNow = liveLimit ?? ask.limit;
    const vars = { metric: metricLabel(t, metric), used: metricValue(t, metric, used), limit: metricValue(t, metric, limitNow) };
    const expected = ask.expected?.[metric === "steps" ? "tokens" : metric] ?? ask.expected?.tokens;
    const expectedMetric = ask.expected?.[metric === "steps" ? "tokens" : metric] != null ? metric : "tokens";
    // etiket gerçek öneriden (×1,5 ya da harcananın ×1,1'i / günlük en az yer açan artış); sabit "+%50" değil
    const pct = raisePct(ask.limit, proposal);
    // kart açıkken tavan elle yükseltildiyse onay o tavanla sürer; kart eski öneriyi göstermez
    const manual = !daily && typeof ask.manual_cap === "number" && proposal === ask.manual_cap;
    const proposalKey = daily ? (pct != null ? "budget_daily_proposal" : "budget_daily_proposal_plain")
      : manual ? "budget_card_manual" : (pct != null ? "budget_card_proposal" : "budget_card_proposal_plain");
    // sınır dolmadı, sıradaki adımın tahmini sığmıyor (rezervasyon) → "Bütçe doldu" denmez
    const projected = !daily && !!ask.projected && !(limitNow != null && used >= limitNow);
    // sınır henüz aşılmadı, sıradaki model turu (en az bağlamı kadar) aşacaktı; adım o turdan önce durdu
    const turn = !daily && !!ask.rerun && typeof ask.next_turn_min === "number" && ask.next_turn_min > 0;
    head = t(daily ? "budget_daily_title" : turn ? "budget_card_title_turn" : projected ? "budget_card_title_projected" : "budget_card_title");
    body = <>
      <p className="text-sm">{turn ? t("budget_card_text_turn", { ...vars, step: title, next: metricValue(t, "tokens", ask.next_turn_min ?? 0) })
        : t(daily ? "budget_daily_text" : projected ? "budget_card_text_projected" : "budget_card_text", { ...vars, step: title })}</p>
      {/* API araç döngüsü kaldığı yerden sürer; diğer beyinler baştan (öneri bir tam deneme)*/}
      {!daily && ask.rerun && <p className="text-sm font-semibold text-warn break-words">{ask.continue
        ? t("budget_card_continue", { step: title }) : t(turn ? "budget_card_rerun_turn" : "budget_card_rerun", { step: title })}</p>}
      {!daily && ask.rerun && !ask.continue && !!ask.full_attempt && (
        <p className="text-xs text-ink-2 break-words">{t("budget_card_full_attempt")}</p>
      )}
      {/* önceki onaylı tam deneme de yetmediği için öneri büyütüldü*/}
      {!daily && typeof ask.growth === "number" && ask.growth > 1 && (
        <p className="text-xs text-ink-2 break-words">{t("budget_card_growth", { g: fmtNumber(ask.growth) })}</p>
      )}
      {!daily && ask.rerun && !!ask.late_boundary && <p className="text-xs text-muted break-words">{t("budget_card_late")}</p>}
      {/* bu beyin araçlarını kendisi çalıştırır; yürütme defteri yalnız uygulamanın API araç döngüsünü kapsar*/}
      {!daily && ask.rerun && !ask.continue && !!ask.own_tools && (
        <p className="text-xs text-muted break-words">{t("budget_card_own_tools", { brain: ask.own_tools })}</p>
      )}
      {!daily && ask.primary === "accept_partial" && typeof ask.step_spent === "number" && (
        <p className="text-sm font-semibold break-words">{typeof ask.job_multiple === "number"
          ? t("budget_card_partial_total", { n: fmtNumber(ask.approvals ?? 0), spent: metricValue(t, "tokens", ask.step_spent),
              mult: fmtNumber(ask.job_multiple) })
          : t("budget_card_partial_total_plain", { n: fmtNumber(ask.approvals ?? 0), spent: metricValue(t, "tokens", ask.step_spent) })}</p>
      )}
      {/* kısmi çıktıyla devam seçilirse kalan işler (sentez dahil) için koşu sınırı bu kadar yükselir*/}
      {!daily && ask.primary === "accept_partial" && typeof ask.partial_cap === "number" && (
        <p className="text-xs text-ink-2 break-words">{t("budget_card_partial_cap", { value: metricValue(t, "tokens", ask.partial_cap) })}</p>
      )}
      {!daily && ask.primary === "accept_partial" && !!ask.plan_round && (
        <p className="text-xs text-ink-2 break-words">{t("budget_card_partial_plan")}</p>
      )}
      {!daily && ask.rerun && !!ask.kept_partial && (
        <p className="text-sm text-ink-2 break-words">{t("budget_card_partial", { chars: fmtNumber(ask.kept_partial.chars ?? 0),
          tools: fmtNumber(ask.kept_partial.tool_count ?? 0) })}
          {(ask.kept_partial.tools_stopped ?? 0) > 0 && ` ${t("budget_card_partial_stopped", { n: fmtNumber(ask.kept_partial.tools_stopped ?? 0) })}`}</p>
      )}
      {!daily && !ask.rerun && (ask.finished_steps ?? (ask.kept_output ? 1 : 0)) > 0 && (
        <p className="text-sm text-ink-2 break-words">{t("budget_card_kept", { step: title })}</p>
      )}
      {!daily && !ask.rerun && !!ask.kept_rounds?.length && (
        <p className="text-sm text-ink-2 break-words">{t("budget_card_kept_plan", { steps: ask.kept_rounds.join(", ") })}</p>
      )}
      {!daily && !ask.proposal_basis && typeof expected === "number" && expected > 0 && (
        <p className="text-sm text-ink-2">{t(ask.local ? "budget_card_expected_local" : "budget_card_expected", { value: metricValue(t, expectedMetric, expected) })}</p>
      )}
      {proposal != null && <p className="text-sm text-ink-2">{t(proposalKey, { value: metricValue(t, metric, proposal), pct: pct ?? 0 })}</p>}
      {!daily && <ProposalBasis ask={ask} />}
      {!daily && <AskedInstead ask={ask} />}
      {/* tek kalan çocuğun koşu kartı, ardından çalışacak yöneticinin sentezini de karşılar*/}
      {!daily && typeof ask.synth_extra === "number" && ask.synth_extra > 0 && (
        <p className="text-xs text-ink-2 break-words">{t("budget_card_synth_extra", { value: metricValue(t, "tokens", ask.synth_extra) })}</p>
      )}
      {/* koşu kartı ağacın kalan işini de karşılar (tek karar)*/}
      {!daily && typeof ask.rest_extra === "number" && ask.rest_extra > 0 && (
        <p className="text-xs text-ink-2 break-words">{t("budget_card_rest_extra", { n: fmtNumber(Math.max(1, (ask.rest_members?.length ?? 1) - (ask.synth_extra ? 1 : 0))),
          value: metricValue(t, "tokens", ask.rest_extra) })}</p>
      )}
      {/* onaylanan sınır harcananı içeren mutlak toplamdır (harcama sayacı sıfırlanmaz)*/}
      {!daily && proposal != null && metric !== "steps" && typeof used === "number" && used > 0 && (
        <p className="text-xs text-ink-2 break-words">{t("budget_card_absolute", { spent: metricValue(t, metric, used) })}</p>
      )}
      {!daily && !!ask.co_raise && (
        <p className="text-xs text-ink-2 break-words">{t(ask.co_raise.scope === "run" ? "budget_card_co_raise_run" : "budget_card_co_raise_step",
          { value: metricValue(t, "tokens", ask.co_raise.tokens) })}</p>
      )}
      {!daily && ask.scope === "run" && <AutoBudgetNote run={run} ask={ask} />}
      {/* bu beyinde tavan nerede uygulanır*/}
      {!daily && ask.enforcement && (
        <p className="text-xs text-muted break-words">{t(ask.enforcement === "turn" ? "budget_card_enf_turn" : "budget_card_enf_step_end")}</p>
      )}
    </>;
    // aynı adımda 2 onaydan sonra birincil eylem "adımı durdur, kısmi çıktıyla devam" (not: partial); yükseltmek
    // ikincil seçenek olarak kalır
    const partialFirst = !daily && ask.primary === "accept_partial";
    // uzun etiketler (TR/EN "kısmi çıktıyla devam") satır kırar; 375 px'te kart taşmaz
    const wrapBtn = "whitespace-normal text-left max-w-full min-w-0";
    actions = <>
      {partialFirst && (
        <Button variant="primary" disabled={busy} icon={<CheckCircle2 size={15} />} onClick={() => decide(true, "partial")}
          className={wrapBtn}>
          {t("budget_card_accept_partial")}
        </Button>
      )}
      <Button variant={partialFirst ? "default" : "primary"} disabled={busy} icon={<Wallet size={15} />} onClick={() => decide(true)}
        className={wrapBtn}>
        {partialFirst ? t("budget_card_raise_secondary") : daily ? t("budget_daily_approve") : manual ? t("budget_card_approve_manual")
          : pct != null ? t("budget_card_approve", { pct }) : t("budget_card_approve_plain")}
      </Button>
      {!daily && <UntilDone ask={ask} used={used} busy={busy} decide={decide} />}
      <Button variant="danger" disabled={busy} icon={<XCircle size={15} />} onClick={() => decide(false)}>{t(daily ? "budget_daily_stop" : "budget_card_stop")}</Button>
    </>;
  }
  return (
    <section className={clsx("rounded-xl border-2 p-3 sm:p-4 flex flex-col gap-2.5", waiting ? "tone-warn" : "border-line-soft")} aria-live="polite">
      <h4 className="font-display font-semibold text-sm flex items-center gap-2"><ShieldQuestion size={17} className="shrink-0" aria-hidden />{head}</h4>
      {body}
      {waiting && runSuspended(run) ? <ResumeFirst run={run} /> : waiting ? <div className="flex flex-wrap gap-2">{actions}</div> : (
        <p className="text-sm text-muted">{step.status === "done" ? t("card_done_ok") : step.status === "rejected" ? t("card_done_reject")
          : `${STATUS[step.status]?.label ?? step.status}`}</p>
      )}
      {error && <p className="text-sm font-semibold text-bad" role="alert">{error}</p>}
    </section>
  );
}
