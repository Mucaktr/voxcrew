// S29 — Model hazırlığı (Modelfile YOK): donanım özeti → önerilen modeller (tek tıkla indir, ilerleme) →
// Hermes için uzun bağlamlı kopya (/api/create ile from + num_ctx; donanıma göre 16K/32K/64K, 64K zorlanmaz).
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Cloud, Cpu, Download, HardDrive, MemoryStick, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connectionsApi, fmtGb, isCloudModel, OLLAMA_NAME_RE, refreshConnections, type CatalogItem, type ContextPlan, type InstalledModel, type Job, type Recommendation } from "../../lib/connections";
import { useT } from "../../lib/i18n";
import { cx } from "../../locales/connections";
import { Badge, Button, Field, Modal, Spinner } from "../ui";

function useJobs() {
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const timer = useRef<number | null>(null);
  const track = useCallback((job: Job) => setJobs((j) => ({ ...j, [job.id]: job })), []);
  const running = Object.values(jobs).some((j) => j.status === "running");
  useEffect(() => {
    if (!running) return;
    const tick = async () => {
      const ids = Object.values(jobs).filter((j) => j.status === "running").map((j) => j.id);
      const fresh = await Promise.all(ids.map((id) => connectionsApi.job(id).catch(() => null)));
      setJobs((cur) => { const next = { ...cur }; for (const f of fresh) if (f) next[f.id] = f; return next; });
      if (fresh.some((f) => f && f.status === "done")) await refreshConnections(true);
    };
    timer.current = window.setInterval(() => { void tick(); }, 1200);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [running, jobs]);
  return { jobs, track };
}

function JobBar({ job }: { job: Job }) {
  const t = useT(cx);
  const pct = Math.round((job.progress || 0) * 100);
  return (
    <div className="flex flex-col gap-1 text-xs" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono truncate">{job.kind === "pull" ? t("pulling") : t("ctx_creating")} {job.model}</span>
        <span className="num shrink-0">{job.status === "running" ? `${pct}%` : job.status === "done" ? t("job_done") : job.status === "cancelled" ? t("job_cancelled") : ""}</span>
      </div>
      {job.status === "running" && (
        <div className="h-2 rounded-full bg-panel-3 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={job.model}>
          <div className="h-full bg-grass transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
      {job.message && job.status === "running" && <span className="text-muted truncate">{job.message}</span>}
      {job.status === "failed" && <span className="text-bad break-words">{t("job_failed", { e: job.error ?? "" })}</span>}
    </div>
  );
}

function ContextOptions({ plan, value, onChange }: { plan: ContextPlan; value: number | null; onChange: (n: number) => void }) {
  const t = useT(cx);
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("ctx_title")}>
      {plan.options.map((o) => (
        <button key={o.num_ctx} type="button" aria-pressed={value === o.num_ctx} onClick={() => onChange(o.num_ctx)}
          className="card-select px-2.5 py-1.5 flex flex-col items-start gap-0.5 min-w-[7rem]">
          <span className="font-semibold text-sm flex items-center gap-1">{o.label}{o.num_ctx === plan.recommended && <Sparkles size={12} className="text-gold" aria-label={t("rec_recommended")} />}</span>
          <span className={clsx("text-xs", o.fits ? "text-muted" : "text-warn")}>{t("ctx_est", { gb: o.est_gb })} · {o.fits ? t("ctx_fits") : t("ctx_tight")}</span>
          <span className="text-xs text-muted">{o.hermes_ready ? t("ctx_hermes_ok") : t("ctx_hermes_partial")}</span>
        </button>
      ))}
    </div>
  );
}

function CatalogCard({ item, job, busy, onPull }: { item: CatalogItem; job?: Job; busy: string | null; onPull: (i: CatalogItem) => void }) {
  const t = useT(cx);
  return (
    <li className={clsx("panel-soft p-3 flex flex-col gap-2 min-w-0", item.recommended && "border-gold")}>
      <div className="flex items-center gap-2">
        <span className="font-mono font-semibold text-sm truncate flex-1">{item.name}</span>
        <span className="text-xs text-muted num shrink-0">~{item.size_gb} GB</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {item.recommended && <Badge tone="ok"><Sparkles size={11} aria-hidden />{t("rec_recommended")}</Badge>}
        {item.installed && <Badge tone="info"><CheckCircle2 size={11} aria-hidden />{t("rec_installed")}</Badge>}
        {!item.fits && <Badge tone="warn">{t("rec_heavy")}</Badge>}
        <Badge>{item.vendor}</Badge>
        <Badge tone={item.tools ? "ok" : "warn"}>{item.tools ? t("rec_tools") : t("rec_no_tools")}</Badge>
        <Badge>{t("rec_ctx", { k: Math.round(item.context_max / 1024) })}</Badge>
        <Badge title={t("rec_license", { l: item.license })}>{item.license}</Badge>
      </div>
      <p className="text-xs text-ink-2">{item.good_for}</p>
      {job ? <JobBar job={job} /> : (
        <div>
          <Button size="sm" variant={item.recommended && !item.installed ? "primary" : "default"} icon={busy === item.name ? <Spinner size={13} /> : <Download size={13} />}
            disabled={!!busy || item.installed} onClick={() => onPull(item)}>{t("pull")}</Button>
        </div>
      )}
    </li>
  );
}

export function ModelSetup({ onReady }: { onReady?: () => void }) {
  const t = useT(cx);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<CatalogItem | null>(null);
  const [ctxModel, setCtxModel] = useState<string>("");
  const [ctxValue, setCtxValue] = useState<number | null>(null);
  const [ctxName, setCtxName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [freeName, setFreeName] = useState("");
  const [freeConfirm, setFreeConfirm] = useState<string | null>(null);
  const { jobs, track } = useJobs();
  const freeValid = OLLAMA_NAME_RE.test(freeName.trim()) && !freeName.includes("..");

  const load = useCallback(() => connectionsApi.recommend().then((r) => { setRec(r); setError(null); }).catch((e) => setError(String(e))), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (Object.values(jobs).some((j) => j.status === "done")) void load(); }, [jobs, load]);

  const installed = rec?.installed ?? [];
  const target: InstalledModel | undefined = useMemo(() => installed.find((m) => m.name === ctxModel) ?? installed[0], [installed, ctxModel]);
  useEffect(() => {
    if (target && target.context.recommended && ctxValue == null) setCtxValue(target.context.recommended);
    if (target && !ctxName) setCtxName(`${target.name.split(":")[0]}-${Math.round((target.context.recommended ?? 32768) / 1024)}k`);
  }, [target, ctxValue, ctxName]);

  const pull = async (item: CatalogItem) => {
    setConfirm(null); setBusy(item.name);
    try { track(await connectionsApi.pull(item.name)); } catch (e) { setError(String(e)); } finally { setBusy(null); }
  };
  // katalog dışı model, serbest adla (sunucu adı yine doğrular)
  const pullFree = async (name: string) => {
    setFreeConfirm(null); setBusy(name);
    try { track(await connectionsApi.pull(name)); setFreeName(""); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const create = async () => {
    if (!target || !ctxValue) return;
    setBusy("create");
    try { track(await connectionsApi.create(target.name, ctxValue, ctxName.trim() || undefined)); onReady?.(); }
    catch (e) { setError(String(e)); } finally { setBusy(null); }
  };

  if (!rec) return error ? <p role="alert" className="text-sm text-bad">{error}</p> : <div className="py-4 grid place-items-center"><Spinner /></div>;
  const hw = rec.hardware;
  const visible = rec.items.filter((i) => !i.featured && (i.fits || i.recommended)).slice(0, 6);
  const featured = rec.items.filter((i) => i.featured);
  const jobFor = (name: string) => Object.values(jobs).find((j) => j.kind === "pull" && j.model === name);

  return (
    <div className="flex flex-col gap-5">
      {/* donanım */}
      <section className="panel-soft p-3 flex flex-col gap-2" aria-labelledby="hw-title">
        <h4 id="hw-title" className="panel-title flex items-center gap-1.5"><Cpu size={15} aria-hidden />{t("hw_title")}</h4>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge><MemoryStick size={12} aria-hidden />{t("hw_ram")}: {hw.ram_gb != null ? fmtGb(hw.ram_gb) : t("unknown")}</Badge>
          <Badge><HardDrive size={12} aria-hidden />{t("hw_gpu")}: {hw.gpus.length ? hw.gpus.map((g) => `${g.name} ${fmtGb(g.vram_bytes / 1024 ** 3)}`).join(", ") : hw.unified_memory ? t("hw_unified") : t("hw_gpu_unknown")}</Badge>
          {hw.cpu_count && <Badge>{t("hw_cpu", { n: hw.cpu_count })}</Badge>}
        </div>
        {hw.note && <p className="text-xs text-muted">{hw.note}</p>}
        <p className="text-sm text-ink-2">{rec.hint}</p>
      </section>

      {/* öneriler */}
      <section className="flex flex-col gap-2" aria-labelledby="rec-title">
        <h4 id="rec-title" className="panel-title">{t("rec_title")}</h4>
        <ul className="grid gap-2 sm:grid-cols-2">
          {visible.map((item) => <CatalogCard key={item.name} item={item} job={jobFor(item.name)} busy={busy} onPull={setConfirm} />)}
        </ul>
        <p className="text-xs text-muted">{t("rec_source", { s: rec.source })} · {t("rec_approx")}</p>
      </section>

      {/* S37 · Mistral AI modelleri öne çıkan ayrı bölüm*/}
      {featured.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="mistral-title">
          <h4 id="mistral-title" className="panel-title">{t("mistral_title")}</h4>
          <p className="text-sm text-ink-2">{t("mistral_intro")}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {featured.map((item) => <CatalogCard key={item.name} item={item} job={jobFor(item.name)} busy={busy} onPull={setConfirm} />)}
          </ul>
        </section>
      )}

      {/* adıyla indir (katalog dışı); bulut modeli uyarısı*/}
      <section className="panel-soft p-3 flex flex-col gap-2" aria-labelledby="free-pull-title">
        <h4 id="free-pull-title" className="panel-title">{t("free_pull_title")}</h4>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (freeValid) setFreeConfirm(freeName.trim()); }}>
          <input className="input font-mono !text-xs flex-1 min-w-[12rem]" aria-label={t("free_pull_title")} aria-invalid={!!freeName.trim() && !freeValid}
            value={freeName} onChange={(e) => setFreeName(e.target.value)} placeholder="magistral" spellCheck={false} autoCapitalize="off" />
          <Button type="submit" size="sm" icon={<Download size={13} />} disabled={!freeValid || !!busy}>{t("pull")}</Button>
        </form>
        <p className={clsx("text-xs", freeName.trim() && !freeValid ? "text-bad" : "text-muted")}>
          {freeName.trim() && !freeValid ? t("free_pull_invalid") : t("free_pull_hint")}
        </p>
        {freeValid && isCloudModel(freeName) && (
          <p role="status" className="text-xs text-warn flex items-start gap-1"><Cloud size={13} className="shrink-0 mt-0.5" aria-hidden />{t("cloud_warn")}</p>
        )}
        {Object.values(jobs).filter((j) => j.kind === "pull" && !rec.items.some((i) => i.name === j.model)).map((j) => <JobBar key={j.id} job={j} />)}
      </section>

      {/* uzun bağlam */}
      {installed.length > 0 && (
        <section className="panel-soft p-3 flex flex-col gap-3" aria-labelledby="ctx-title">
          <h4 id="ctx-title" className="panel-title">{t("ctx_title")}</h4>
          <p className="text-sm text-ink-2">{t("ctx_intro")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("ctx_pick_model")}>
              <select className="select" value={target?.name ?? ""} onChange={(e) => { setCtxModel(e.target.value); setCtxValue(null); setCtxName(""); }}>
                {installed.map((m) => <option key={m.name} value={m.name}>{m.name}{m.hermes_ready ? ` · ${t("ctx_hermes_ok")}` : ""}</option>)}
              </select>
            </Field>
            <Field label={t("ctx_name")}>
              <input className="input font-mono !text-xs" value={ctxName} onChange={(e) => setCtxName(e.target.value)} />
            </Field>
          </div>
          {target && (target.hermes_ready ? <p className="text-sm text-ok flex items-center gap-1"><CheckCircle2 size={14} aria-hidden />{t("ctx_already")}</p> : (
            <>
              <ContextOptions plan={target.context} value={ctxValue} onChange={setCtxValue} />
              {!target.context.known && <p className="text-xs text-warn flex items-start gap-1"><AlertTriangle size={13} className="shrink-0 mt-0.5" aria-hidden />{t("ctx_note_unknown")}</p>}
              {target.context.note && target.context.known && <p className="text-xs text-muted">{target.context.note}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" disabled={!ctxValue || !!busy} icon={busy === "create" ? <Spinner size={14} /> : undefined} onClick={create}>{t("ctx_create")}</Button>
                {ctxValue && <span className="text-sm text-ink-2">{t("ctx_question", { model: target.name, k: Math.round(ctxValue / 1024) })}</span>}
              </div>
            </>
          ))}
          {Object.values(jobs).filter((j) => j.kind === "create").map((j) => <JobBar key={j.id} job={j} />)}
        </section>
      )}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}

      {freeConfirm && (
        <Modal open onClose={() => setFreeConfirm(null)} title={t("pull")} width={480}
          footer={<><Button variant="ghost" onClick={() => setFreeConfirm(null)}>{t("cancel")}</Button>
            <Button variant="primary" icon={<Download size={15} />} onClick={() => pullFree(freeConfirm)}>{t("pull_yes")}</Button></>}>
          <p className="text-sm text-ink-2">{t("free_pull_confirm", { name: freeConfirm })}</p>
          {isCloudModel(freeConfirm) && (
            <div className="mt-3 rounded-lg border-2 tone-warn p-2.5 text-sm flex flex-col gap-1.5">
              <span className="flex items-start gap-1.5"><Cloud size={15} className="shrink-0 mt-0.5" aria-hidden />{t("cloud_warn")}</span>
              <span>{t("cloud_signin")} <code className="font-mono">ollama signin</code></span>
            </div>
          )}
        </Modal>
      )}
      {confirm && (
        <Modal open onClose={() => setConfirm(null)} title={t("pull")} width={480}
          footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>{t("cancel")}</Button>
            <Button variant="primary" icon={<Download size={15} />} onClick={() => pull(confirm)}>{t("pull_yes")}</Button></>}>
          <p className="text-sm text-ink-2">{t("pull_confirm", { name: confirm.name, gb: confirm.size_gb })}</p>
          <p className="text-xs text-muted mt-2">{t("rec_license", { l: confirm.license })} · {confirm.good_for}</p>
        </Modal>
      )}
    </div>
  );
}
