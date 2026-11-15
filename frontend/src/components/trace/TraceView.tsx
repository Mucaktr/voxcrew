// Ekip S26 — iz görünümü: koşunun span ağacı zaman çizelgesi (waterfall) olarak. Denemeler kardeş
// satır, devretme alt adımları iç içe, onay bekleme ayrı span; satır açılınca ayrıntı (model, süreler, token, hata türü,
// istem hattı booster/skill kazancı, araç girdi/çıktısı, olaylar). Canlı koşuda birkaç saniyede bir tazelenir.
import clsx from "clsx";
import { Activity, ChevronDown, ChevronRight, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { duration, STATUS } from "../../lib/format";
import { fmtNumber, useT } from "../../lib/i18n";
import { fetchTrace, traceId, type RunManifest, type RunTrace, type TraceSpan, type TraceStats } from "../../lib/trace";
import { traceMsg as m } from "../../locales/trace";
import { connectionLabel, fmtUsd, metricLabel } from "../runs/runFormat";
import { Badge, Button, Empty, Segmented, Spinner } from "../ui";

type T = ReturnType<typeof useT<typeof m.tr>>;
type SpanFilter = "all" | "steps" | "tools" | "problems";
const PAGE = 300;
const PROBLEM = new Set(["failed", "rejected", "interrupted", "paused", "cancelled"]);

const KIND_BAR: Record<string, string> = {
  span: "bg-ink-2", agent: "bg-sky", tool: "bg-gold", retriever: "bg-diamond", guardrail: "bg-amethyst", generation: "bg-sky",
};

function kindLabel(t: T, kind: string): string {
  return ({ span: t("kind_span"), agent: t("kind_agent"), tool: t("kind_tool"), retriever: t("kind_retriever"),
    guardrail: t("kind_guardrail"), generation: t("kind_generation") } as Record<string, string>)[kind] ?? kind;
}

function spanName(t: T, s: TraceSpan): string {
  if (s.name === "prompt" && s.kind === "span" && s.id !== "run") return t("name_prompt");
  if (s.name === "memory.recall") return t("name_recall");
  if (s.name === "memory.consolidate") return t("name_consolidate");
  if (s.name === "tool approval") return t("name_tool_approval");
  return s.name;
}

function statusTone(status: string): string {
  return status === "done" ? "ok" : status === "failed" || status === "rejected" ? "bad"
    : status === "paused" || status === "interrupted" || status === "awaiting_approval" ? "warn" : status === "running" ? "info" : "muted";
}

function statusText(t: T, status: string): string {
  return status === "paused" ? t("st_paused") : status === "interrupted" ? t("st_interrupted") : status === "running" ? t("st_running")
    : STATUS[status]?.label ?? status;
}

// QA-F56: sunucudaki ham anahtarlar (input/output/total, resume) arayüz dilinde gösterilir
// AUDIT C-5: önbellek token'ları ayrı alanlar (girdi zaten onları içerir; yalnız bilgi)
const TOKEN_KEYS: Record<string, "tok_input" | "tok_output" | "tok_total" | "tok_cache_read" | "tok_cache_write"> = {
  input: "tok_input", output: "tok_output", total: "tok_total",
  cache_read_tokens: "tok_cache_read", cache_write_tokens: "tok_cache_write",
};

function reasonText(t: T, reason: string): string {
  return reason === "user" ? t("reason_user") : reason === "budget" ? t("reason_budget") : reason === "interrupted" ? t("st_interrupted")
    : reason === "resume" ? t("reason_resume") : reason;
}

export function TraceView({ runId, live }: { runId: string; live: boolean }) {
  const t = useT(m);
  const [trace, setTrace] = useState<RunTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<SpanFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const load = useCallback(() => {
    setLoading(true);
    fetchTrace(runId).then((tr) => { setTrace(tr); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [runId]);
  useEffect(() => { setTrace(null); setOpen(null); setLimit(PAGE); load(); }, [load]);
  // canlı koşu: sekme görünürken birkaç saniyede bir tazele
  useEffect(() => {
    if (!live && !trace?.live) return;
    const h = window.setInterval(() => { if (!document.hidden) load(); }, 3000);
    return () => window.clearInterval(h);
  }, [live, trace?.live, load]);

  const depth = useMemo(() => {
    const d = new Map<string, number>();
    for (const s of trace?.spans ?? []) d.set(s.id, s.parent ? (d.get(s.parent) ?? 0) + 1 : 0);
    return d;
  }, [trace]);
  const spans = useMemo(() => (trace?.spans ?? []).filter((s) =>
    filter === "all" ? true : filter === "steps" ? s.kind === "agent" || s.kind === "guardrail" || s.id === "run"
      : filter === "tools" ? s.kind === "tool" : PROBLEM.has(s.status) || !!s.attrs.error_class), [trace, filter]);

  if (!trace) {
    if (error) return <p className="panel-soft p-3 text-sm font-semibold text-bad" role="alert">{t("trace_error", { error })}</p>;
    return <div className="flex items-center gap-2 text-sm text-muted p-4" role="status"><Spinner size={16} />{t("trace_loading")}</div>;
  }
  const total = Math.max(1, trace.stats.duration_ms);
  const st = trace.stats;
  const shown = spans.slice(0, limit);

  return (
    <div className="@container flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Activity size={16} aria-hidden className="text-ink-2" />
        <span className="text-xs text-muted">{t("trace_id")}</span>
        <code className="font-mono text-xs break-all text-ink-2">{trace.trace_id}</code>
        {trace.live && <Badge tone="info">{t("trace_live")}</Badge>}
        {trace.export?.enabled && <Badge tone="muted">{t("export_on", { prompts: trace.export.send_prompts ? t("export_prompts") : "" })}</Badge>}
        <Button size="sm" variant="ghost" className="ml-auto" icon={loading ? <Spinner size={13} /> : <RefreshCcw size={14} />}
          onClick={load} disabled={loading}>{t("trace_refresh")}</Button>
      </div>
      {error && <p className="text-sm font-semibold text-bad" role="alert">{t("trace_error", { error })}</p>}

      <dl className="grid grid-cols-2 @xl:grid-cols-4 gap-2">
        <Stat label={t("stat_duration")} value={duration(st.duration_ms)} />
        <Stat label={t("stat_attempts")} value={`${fmtNumber(st.attempts)}${st.retries ? ` · ${t("stat_retries")} ${fmtNumber(st.retries)}` : ""}`} />
        <Stat label={t("stat_tools")} value={`${fmtNumber(st.tool_calls)}${st.tool_errors ? ` · ${t("stat_tool_errors", { n: st.tool_errors })}` : ""}`} />
        <Stat label={t("stat_approval_wait")} value={duration(st.approval_wait_ms)} />
        <Stat label={t("stat_tokens")} value={`${fmtNumber(st.tokens)}${st.cost_basis === "local" ? "" : st.cost_usd != null ? ` · ${st.cost_basis === "measured" ? "" : "≈"}${fmtUsd(st.cost_usd)}` : ""}`} />
        <Stat label={t("stat_saved")} value={st.saved_tokens_est ? t("stat_saved_val", { n: fmtNumber(st.saved_tokens_est) }) : "—"} />
        <Stat label={t("stat_effects")} value={Object.entries(st.effects).map(([k, n]) => `${effLabel(t, k)} ${n}`).join(" · ") || "—"} />
        <Stat label={t("attr_error_class")} value={Object.entries(st.error_classes).map(([k, n]) => `${k === "transient" ? t("err_transient") : t("err_permanent")} ${n}`).join(" · ") || "—"} />
        <TimeSplit stats={st} />
      </dl>

      {trace.markers.length > 0 && (
        <section className="flex flex-col gap-1" aria-label={t("markers_title")}>
          <h4 className="font-display text-xs font-semibold text-muted">{t("markers_title")}</h4>
          <ol className="flex flex-wrap gap-1.5">
            {trace.markers.map((mk, i) => (
              <li key={i} className={clsx("chip", mk.type.startsWith("budget.exceeded") ? "tone-bad" : mk.type === "run.paused" || mk.type.startsWith("budget.") || mk.type === "connection.degraded" ? "tone-warn" : "tone-info")}>
                <span className="num">{duration(mk.offset_ms)}</span> {markerText(t, mk.type, mk.data)}
              </li>
            ))}
          </ol>
        </section>
      )}

      <ManifestPanel manifest={trace.manifest ?? null} deadline={trace.deadline_at ?? null} />

      <Segmented value={filter} onChange={(v) => { setFilter(v); setLimit(PAGE); }} className="self-start" options={[
        { value: "all", label: t("f_all") }, { value: "steps", label: t("f_steps") },
        { value: "tools", label: t("f_tools") }, { value: "problems", label: t("f_problems") },
      ]} />

      {!spans.length ? <Empty title={t("trace_empty")} /> : (
        <div className="flex flex-col gap-1">
          <div className="hidden @xl:grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2 text-xs text-muted num" aria-label={t("axis_label")}>
            <span />
            <span className="flex justify-between"><span>0</span><span>{duration(total / 2)}</span><span>{duration(total)}</span></span>
          </div>
          <ol className="flex flex-col gap-0.5" aria-label={t("waterfall_label")}>
            {shown.map((s) => (
              <SpanRow key={s.id} span={s} depth={filter === "all" ? depth.get(s.id) ?? 0 : 0} total={total}
                expanded={open === s.id} onToggle={() => setOpen((o) => (o === s.id ? null : s.id))} />
            ))}
          </ol>
          {spans.length > limit && (
            <Button size="sm" variant="ghost" className="self-center" onClick={() => setLimit((l) => l + PAGE)}>
              {t("show_more", { n: Math.min(PAGE, spans.length - limit) })}
            </Button>
          )}
        </div>
      )}

      {trace.effects.length > 0 && (
        <section className="flex flex-col gap-1.5" aria-label={t("effects_title")}>
          <h4 className="font-display text-xs font-semibold text-muted">{t("effects_title")}</h4>
          <ul className="flex flex-col gap-1 text-sm">
            {trace.effects.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="num text-xs text-muted w-14 shrink-0">{duration(e.offset_ms)}</span>
                <Badge tone={e.status === "applied" || e.status === "acknowledged" ? "ok" : e.status === "unknown" ? "warn" : "info"}>{effLabel(t, String(e.status))}</Badge>
                <span className="font-semibold">{traceId(e.step, t("id_task"))}</span>
                <span className="text-ink-2 min-w-0 break-words">{e.kind}{e.detail ? ` · ${e.detail}` : ""}</span>
                {e.reused && <Badge>{t("eff_reused")}</Badge>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function effLabel(t: T, s: string): string {
  return s === "pending" ? t("eff_pending") : s === "applied" ? t("eff_applied") : s === "unknown" ? t("eff_unknown")
    : s === "acknowledged" ? t("eff_acknowledged") : s;
}

function markerText(t: T, type: string, d: Record<string, unknown>): string {
  const metric = metricLabel(t, String(d.metric ?? ""));
  switch (type) {
    case "run.paused": return t("mk_paused", { reason: reasonText(t, String(d.reason ?? "")) });
    case "run.resumed": return t("mk_resumed");
    case "run.forked": return t("mk_forked");
    case "budget.warning": return t("mk_budget_warning", { metric });
    case "budget.exceeded": return t("mk_budget_exceeded", { metric });
    case "budget.updated": return t("mk_budget_updated");
    case "connection.degraded": return t("mk_degraded", { kind: connectionLabel(t, String(d.kind ?? "")) });
    case "handoff": return t("mk_handoff", { from: String(d.from ?? ""), to: String(d.to ?? "") });
    default: return type;
  }
}

const WaitChip = ({ ms }: { ms: number }) => <span className="chip tone-warn !py-0 num">{duration(ms)}</span>;
const ProviderChip = ({ ms }: { ms: number }) => <span className="chip tone-info !py-0 num">{duration(ms)}</span>;

/** O-10/O-11 zaman dökümü: bekleme (hazır olma + kuyruk/kilit + geri çekilme) ile sağlayıcı süresi tek çubukta, ayrı renk
 *  ve yazıyla (yalnız renge dayanmaz). Sunucu alanları göndermiyorsa çizilmez. */
function TimeSplit({ stats: st }: { stats: TraceStats }) {
  const t = useT(m);
  const ready = st.ready_wait_ms ?? 0, queue = st.queue_wait_ms ?? 0, backoff = st.backoff_ms ?? 0, provider = st.provider_ms ?? 0;
  const wait = ready + queue + backoff;
  if (st.provider_ms == null && st.queue_wait_ms == null) return null;
  const sum = Math.max(1, wait + provider);
  const pct = (v: number) => `${Math.round((v / sum) * 100)}%`;
  return (
    <div className="panel-soft px-2.5 py-2 min-w-0 col-span-2 flex flex-col gap-1.5">
      <dt className="text-xs text-muted font-semibold">{t("stat_time_split")}</dt>
      <dd className="flex flex-col gap-1.5 min-w-0">
        <span className="flex h-2 w-full overflow-hidden rounded-full border border-line-soft bg-panel-3" aria-hidden>
          <span className="bg-gold" style={{ width: pct(wait) }} />
          <span className="bg-sky" style={{ width: pct(provider) }} />
        </span>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2 w-2 rounded-[2px] bg-gold border border-line" />
            {t("stat_wait")} <b className="num">{duration(wait)}</b>
            {(queue >= 500 || backoff >= 500) && <span className="text-muted num">({[queue >= 500 ? `${t("stat_queue")} ${duration(queue)}` : "", backoff >= 500 ? `${t("stat_backoff")} ${duration(backoff)}` : ""].filter(Boolean).join(" · ")})</span>}</span>
          <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2 w-2 rounded-[2px] bg-sky border border-line" />
            {t("stat_provider")} <b className="num">{duration(provider)}</b></span>
        </span>
      </dd>
    </div>
  );
}

// koşunun sürüm manifesti (model, istem öneki, skill sha, araç sürümü, akış özeti) ve mutlak bitiş zamanı
function ManifestPanel({ manifest, deadline }: { manifest: RunManifest | null; deadline: string | null }) {
  const t = useT(m);
  if (!manifest && !deadline) return null;
  const steps = Object.entries(manifest?.steps ?? {});
  const short = (v?: string | null) => (v ? v.slice(0, 12) : "—");
  return (
    <details className="panel-soft p-3">
      <summary className="cursor-pointer font-display text-xs font-semibold text-muted">{t("manifest_title")}</summary>
      <dl className="mt-2 grid gap-1 @xl:grid-cols-2">
        {manifest?.studio_version && <Row label={t("manifest_studio")}>{manifest.studio_version}</Row>}
        {manifest?.workflow && <Row label={t("manifest_workflow")}>{traceId(manifest.workflow, t("id_task"))} · <code className="font-mono">{short(manifest.workflow_sha)}</code></Row>}
        {manifest?.task_family && <Row label={t("manifest_family")}>{traceId(manifest.task_family, t("id_task"))}</Row>}
        {manifest?.prompt_layout_version && <Row label={t("manifest_layout")}><code className="font-mono">{manifest.prompt_layout_version}</code>{manifest.spec_version != null ? ` · ${t("manifest_spec", { n: manifest.spec_version })}` : ""}</Row>}
        {!!manifest?.models?.length && <Row label={t("manifest_models")}>{manifest.models.join(", ")}</Row>}
        {deadline && <Row label={t("manifest_deadline")}>{new Date(deadline).toLocaleString()}</Row>}
      </dl>
      {steps.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-xs" aria-label={t("manifest_steps")}>
          {steps.map(([sid, s]) => (
            <li key={sid} className="flex flex-wrap gap-x-2 min-w-0 break-words">
              <span className="font-semibold">{sid}</span>
              <span className="text-ink-2">{s.connector ?? "?"}/{s.model ?? t("manifest_default_model")}</span>
              {s.prefix_hash && <span className="text-muted">{t("manifest_prefix")} <code className="font-mono">{short(s.prefix_hash)}</code></span>}
              {!!s.skills?.length && <span className="text-muted">{t("manifest_skills")} {s.skills.map((k) => `${k.key ?? "?"}@${short(k.sha)}`).join(", ")}</span>}
              {s.tools && Object.keys(s.tools).length > 0 && <span className="text-muted">{t("manifest_tools")} {Object.entries(s.tools).map(([sv, v]) => `${sv}${v.version ? ` ${v.version}` : ""}${v.schema_sha ? ` #${v.schema_sha}` : ""}`).join(", ")}</span>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-soft px-2.5 py-2 min-w-0">
      <dt className="text-xs text-muted font-semibold">{label}</dt>
      <dd className="text-sm font-semibold num break-words">{value}</dd>
    </div>
  );
}

function SpanRow({ span: s, depth, total, expanded, onToggle }:
  { span: TraceSpan; depth: number; total: number; expanded: boolean; onToggle: () => void }) {
  const t = useT(m);
  const left = Math.min(100, (s.start_ms / total) * 100);
  const width = Math.max(0, Math.min(100 - left, (s.duration_ms / total) * 100));
  const name = spanName(t, s);
  const bad = s.status === "failed" || s.status === "rejected";
  const id = `span-${s.span_id}`;
  // PROC2-FIX P3: etiket model turu GÖNDEREN deneme sırasıdır (`attrs.try`); bütçe geçidinde model çağırmadan bekleyen
  // başlangıç numara almaz. Eski izlerde (`try` yok ama tur gönderilmiş) başlangıç sayısı gösterilir.
  const tryNo = s.kind !== "agent" ? null : typeof s.attrs.try === "number" ? s.attrs.try
    : s.attrs.queue_wait_ms != null && s.attempt != null && s.attempt > 0 ? s.attempt : null;
  return (
    <li className="flex flex-col">
      <button type="button" aria-expanded={expanded} aria-controls={id} onClick={onToggle}
        aria-label={`${name} · ${kindLabel(t, s.kind)} · ${statusText(t, s.status)} · ${duration(s.duration_ms)}`}
        className="grid grid-cols-1 @xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-1 @xl:gap-2 items-center text-left rounded-lg px-1.5 py-1 hover:bg-panel-2 min-w-0">
        <span className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: Math.min(depth, 6) * 12 }}>
          {expanded ? <ChevronDown size={13} className="shrink-0" aria-hidden /> : <ChevronRight size={13} className="shrink-0" aria-hidden />}
          <span className={clsx("truncate text-sm", s.kind === "agent" || s.id === "run" ? "font-semibold" : "text-ink-2")}>{name}</span>
          {tryNo != null && <span className="text-xs text-muted num shrink-0">#{tryNo}</span>}
          <span className={clsx("chip !py-0 !px-1.5 text-xs shrink-0", `tone-${statusTone(s.status)}`)}>{statusText(t, s.status)}</span>
          <span className="ml-auto text-xs text-muted num shrink-0">{duration(s.duration_ms)}</span>
        </span>
        <span className="relative h-3.5 rounded bg-panel-3 overflow-hidden" aria-hidden>
          <span className={clsx("absolute top-0 bottom-0 rounded-sm border border-line", bad ? "bg-red" : KIND_BAR[s.kind] ?? "bg-ink-2",
            (s.status === "paused" || s.status === "interrupted") && "opacity-60", s.open && "animate-pulse motion-reduce:animate-none")}
            style={{ left: `${left}%`, width: width > 0.4 ? `${width}%` : "3px" }} />
        </span>
      </button>
      {expanded && <SpanDetail id={id} span={s} />}
    </li>
  );
}

function Row({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="flex flex-wrap gap-x-2 min-w-0" title={title}>
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="text-xs text-ink min-w-0 break-words">{children}</dd>
    </div>
  );
}

function SpanDetail({ id, span: s }: { id: string; span: TraceSpan }) {
  const t = useT(m);
  const a = s.attrs as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const tokens = a.tokens as Record<string, number> | undefined;
  const usage = a.usage as { cost_usd?: number | null; cost_basis?: string } | undefined;
  const pre = (v: unknown) => <pre className="font-mono text-xs whitespace-pre-wrap break-words max-h-48 overflow-y-auto panel-soft p-2 mt-0.5">{String(v)}</pre>;
  return (
    <div id={id} className="ml-2 @xl:ml-6 mb-1.5 border-l-2 border-line-soft pl-3 py-1.5 flex flex-col gap-1.5" role="region" aria-label={t("span_details", { name: s.name })}>
      <dl className="grid gap-1 @xl:grid-cols-2">
        <Row label={s.step ? t("attr_step") : kindLabel(t, s.kind)}>{s.step ? traceId(s.step, t("id_task")) : s.id}{s.attempt ? ` · ${t("attr_attempt")} ${s.attempt}` : ""}</Row>
        {a.agent && <Row label={t("attr_agent")}>{String(a.agent)}</Row>}
        {(a.route_label || a.connection) && <Row label={t("attr_brain")}>{String(a.route_label || connectionLabel(t, a.connection))}</Row>}
        {a.model && <Row label={t("attr_model")}>{String(a.model)}</Row>}
        {a.ready_wait_ms != null && <Row label={t("attr_ready_wait")}>{duration(a.ready_wait_ms)}</Row>}
        {a.first_output_ms != null && <Row label={t("attr_first_output")} title={t("attr_first_output_hint")}>{duration(a.first_output_ms)}</Row>}
        {/* O-10/O-11: bekleme (sarı) ve sağlayıcı süresi (mavi) görsel olarak ayrı */}
        {a.queue_wait_ms != null && <Row label={t("attr_queue_wait")} title={t("attr_queue_wait_hint")}><WaitChip ms={a.queue_wait_ms} /></Row>}
        {a.lock_wait_ms != null && <Row label={t("attr_lock_wait")} title={t("attr_lock_wait_hint")}><WaitChip ms={a.lock_wait_ms} />{a.resource ? <span className="text-muted"> · {String(a.resource)}</span> : null}</Row>}
        {a.lock_wait_ms == null && a.resource && <Row label={t("attr_resource")}>{String(a.resource)}</Row>}
        {a.backoff_ms != null && <Row label={t("attr_backoff")} title={t("attr_backoff_hint")}><WaitChip ms={a.backoff_ms} /></Row>}
        {a.provider_ms != null && <Row label={t("attr_provider")} title={t("attr_provider_hint")}><ProviderChip ms={a.provider_ms} /></Row>}
        {a.provider_first_output_ms != null && <Row label={t("attr_provider_first")} title={t("attr_provider_first_hint")}><ProviderChip ms={a.provider_first_output_ms} /></Row>}
        {tokens && <Row label={t("attr_tokens")}>{Object.entries(tokens).map(([k, v]) => `${TOKEN_KEYS[k] ? t(TOKEN_KEYS[k]) : k} ${fmtNumber(v)}`).join(" · ")}</Row>}
        {usage && usage.cost_basis !== "local" && usage.cost_usd != null && (
          <Row label={t("attr_cost")}>{usage.cost_basis === "measured" ? "" : "≈"}{fmtUsd(usage.cost_usd)}</Row>
        )}
        {a.error_class && <Row label={t("attr_error_class")}>{a.error_class === "transient" ? t("err_transient") : t("err_permanent")}</Row>}
        {a.will_retry && <Row label={t("attr_will_retry")}>✓</Row>}
        {a.retry && <Row label={t("attr_retry")}>{reasonText(t, String(a.retry.reason ?? ""))}</Row>}
        {a.approved != null && <Row label={t("attr_decision")}>{a.approved ? t("approved") : t("rejected")}</Row>}
        {a.choice && <Row label={t("attr_decision")}>{String(a.choice)}</Row>}
        {a.count != null && <Row label={t("attr_items")}>{t("attr_count", { n: a.count })}</Row>}
        {Array.isArray(a.artifacts) && a.artifacts.length > 0 && <Row label={t("attr_artifacts")}>{a.artifacts.join(", ")}</Row>}
        {a.artifact && <Row label={t("attr_tool_artifact")} title={t("attr_tool_artifact_hint")}><code className="font-mono">{String(a.artifact)}</code>{a.artifact_size != null ? ` · ${t("attr_tool_artifact_size", { size: fmtNumber(Number(a.artifact_size)), inline: fmtNumber(Number(a.artifact_inline ?? 0)) })}` : ""}</Row>}
      </dl>
      {s.name === "prompt" && s.kind === "span" && <PromptDetail attrs={a} />}
      {a.error && <div><span className="text-xs font-semibold text-muted">{t("attr_error")}</span>{pre(a.error)}</div>}
      {a.message && <div><span className="text-xs font-semibold text-muted">{t("attr_message")}</span>{pre(a.message)}</div>}
      {a.note && <div><span className="text-xs font-semibold text-muted">{t("attr_note")}</span>{pre(a.note)}</div>}
      {a.input && <div><span className="text-xs font-semibold text-muted">{t("attr_input")}</span>{pre(a.input)}</div>}
      {a.command && <div><span className="text-xs font-semibold text-muted">{t("attr_input")}</span>{pre(a.command)}</div>}
      {a.output && <div><span className="text-xs font-semibold text-muted">{t("attr_output")}</span>{pre(a.output)}</div>}
      {Array.isArray(a.items) && a.items.length > 0 && (
        <ul className="text-xs list-disc pl-4">{a.items.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
      )}
      {s.events.length > 0 && (
        <div>
          <span className="text-xs font-semibold text-muted">{t("events_title")}</span>
          <ol className="text-xs flex flex-col gap-0.5 mt-0.5">
            {s.events.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-1.5">
                <span className="num text-muted">{duration(e.offset_ms)}</span>
                <span className="font-semibold">{evLabel(t, e.name)}</span>
                <span className="text-ink-2 break-words min-w-0">{Object.entries(e.attrs).filter(([, v]) => v != null && v !== "")
                  .map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function evLabel(t: T, name: string): string {
  return ({ error: t("ev_error"), retry_scheduled: t("ev_retry_scheduled"), effect: t("ev_effect"), round: t("ev_round"),
    warning: t("ev_warning"), plan: t("ev_plan") } as Record<string, string>)[name] ?? name;
}

function PromptDetail({ attrs }: { attrs: Record<string, unknown> }) {
  const t = useT(m);
  const stages = (attrs.stages as { stage: string; kind: string; saved_tokens_est?: number; injected?: string[] }[]) ?? [];
  const boosters = stages.filter((s) => s.kind === "booster");
  const skills = (attrs.skills as string[]) ?? [];
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-ink-2">{t("prompt_chars", { n: Number(attrs.chars ?? 0) })}
        {Number(attrs.saved_tokens_est) > 0 && <> · <b>{t("prompt_saved", { n: fmtNumber(Number(attrs.saved_tokens_est)) })}</b></>}</p>
      {!boosters.length && !skills.length && <p className="text-xs text-muted">{t("prompt_none")}</p>}
      {boosters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs font-semibold text-muted">{t("prompt_boosters")}</span>
          {boosters.map((b, i) => (
            <Badge key={i} tone={b.saved_tokens_est ? "ok" : "muted"}>{b.stage.replace(/^boost:/, "")}{b.saved_tokens_est ? ` −${fmtNumber(b.saved_tokens_est)}` : ""}</Badge>
          ))}
        </div>
      )}
      {skills.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs font-semibold text-muted">{t("prompt_skills")}</span>
          {skills.map((k) => <Badge key={k} tone="info">{k}</Badge>)}
        </div>
      )}
    </div>
  );
}
