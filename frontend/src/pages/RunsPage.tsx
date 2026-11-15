// Görevler (koşular). S20: liste pencereli (yalnızca görünür kartlar çizilir), süzgeçler durum / köken / ajan / başlık;
// durum-ajan-başlık süzgeçleri sunucuda (/api/runs?status=&agent=&q=&limit=&offset=) çalışır, "daha fazla yükle" offset'le
// sayfalar; canlı durum güncellemeleri depodaki koşulardan alınır. Metinler i18n.
import clsx from "clsx";
import {
  AlertTriangle, ArrowLeft, Brain, ChevronDown, ChevronRight, Clock, FileText, Filter, Flag, GitMerge, Hand, Hash, ListChecks, RefreshCcw, ScrollText, Search, ShieldAlert, ShieldCheck, Split, Square, UserPlus, Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useRowSizer, useWindowRows } from "../components/agents/windowing";
import { OriginBadge } from "../components/connect/OriginBadge";
import { RunZoneBadge } from "../components/workzones/WorkZones"; // WORK-ZONES: görevin çalışma yeri
import { ApprovalHistory, InvocationLine, ToolApprovalCard } from "../components/gateway/ToolApprovalCard";
import { Markdown } from "../components/Markdown";
import { PixelFace } from "../components/PixelFace";
import type { DynStep } from "../components/office/hierarchy";
import { AskCard, BudgetBar, ForkedFromLink, ManifestDiffBanner, ResumeBanner, RunPauseResume, StepActions, StepCapBadge, StepRetryInfo } from "../components/runs/RunControls";
import { ErrorClassBadge } from "../components/runs/ErrorClassBadge";
import { RunMessagesPanel } from "../components/messages/RunMessagesPanel";
import { RunResultCard } from "../components/deliverables/RunResultCard";
import { ApprovalStepCard } from "../components/runs/ApprovalStepCard";
import { HireApprovalCard } from "../components/runs/HireApprovalCard";
import { isAskCard } from "../components/runs/runFormat";
import { SpanWaterfall } from "../components/trace/SpanWaterfall";
import { TraceView } from "../components/trace/TraceView";
import { Badge, Button, Empty, LoadError, Modal, NotFound, PageHeader, Panel, Segmented, Spinner, StatusPill, TabPanel, Tabs } from "../components/ui";
import { DailyBudgetBar } from "../components/runs/DailyBudgetBar";
import { AcceptanceBadge, AcceptancePanel, EstimateVsActual, RecipeStartButton, RecognitionStepChip } from "../full/ui"; // öngörü, tarif, takdir (ücretli sürüm)
import { byName } from "../lib/agents";
import { api, ApiError, bodyText, fetchApi } from "../lib/api";
import { between, duration, STATUS, timeAgo } from "../lib/format";
import { sendGameSignal } from "../lib/game";
import type { StepWithGateway } from "../lib/gateway";
import { currentLocale, fmtDate, fmtNumber, tp, useT } from "../lib/i18n";
import { useStudio } from "../lib/store";
import type { LiveRun, LiveStep } from "../lib/trace";
import type { Agent, Mood, Run, StepRun } from "../lib/types";
import { runsMsg as m } from "../locales/runs";
import { traceMsg } from "../locales/trace";

type Filter = "all" | "running" | "done" | "failed";
type OriginFilter = "" | "ui" | "goal" | "mcp";
const PROBLEM = ["failed", "rejected", "cancelled", "interrupted", "paused"];
const PAGE = 100;
const LIST_GAP = 8;

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Sunucu tarafı koşu listesi (S15 sayfalama parametreleri). Toplam `X-Total-Count` başlığında. */
async function listRuns(p: { status?: string; agent?: string; q?: string; limit: number; offset: number }, signal?: AbortSignal):
  Promise<{ items: Run[]; total: number }> {
  const qs = new URLSearchParams({ limit: String(p.limit), offset: String(p.offset) });
  if (p.status) qs.set("status", p.status);
  if (p.agent) qs.set("agent", p.agent);
  if (p.q) qs.set("q", p.q);
  const res = await fetchApi(`/api/runs?${qs}`, { headers: { "X-Studio-Lang": currentLocale() }, signal });
  if (!res.ok) throw new ApiError(res.status, bodyText(res.status, null));  // ham "500 Internal Server Error" yok
  const items = (await res.json()) as Run[];
  return { items, total: Number(res.headers.get("X-Total-Count") ?? items.length) || items.length };
}

/** Devretme ağacı: alt adımlar üst adımlarının hemen altında (derinlik sırasıyla) listelenir. */
function treeOrder(steps: StepRun[]): StepRun[] {
  const ids = new Set(steps.map((s) => s.id));
  const kids = new Map<string, StepRun[]>();
  const roots: StepRun[] = [];
  for (const s of steps) {
    const p = (s as DynStep).parent;
    if (p && ids.has(p)) kids.set(p, [...(kids.get(p) ?? []), s]);
    else roots.push(s);
  }
  const out: StepRun[] = [];
  const seen = new Set<string>();
  const walk = (s: StepRun) => {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    out.push(s);
    // işe alım onayları alt görevlerden önce, sentez en sonda
    const rank = (x: StepRun) => ((x as DynStep).kind === "hire" ? 0 : (x as DynStep).kind === "synthesis" ? 2 : 1);
    [...(kids.get(s.id) ?? [])].sort((a, b) => rank(a) - rank(b)).forEach(walk);
  };
  roots.forEach(walk);
  steps.forEach(walk);
  return out;
}

function stepStatusLabel(status: string): string {
  return STATUS[status]?.label ?? status;
}

function StepStatusPill({ status }: { status: string }) {
  const t = useT(m);
  if (status === "awaiting_tool_approval")
    return <Badge tone="warn"><ShieldAlert size={12} />{STATUS[status]?.label ?? t("tool_approval_pending")}</Badge>;
  return <StatusPill status={status} />;
}

function originGroup(origin?: string | null): OriginFilter {
  if (!origin || origin === "ui") return "ui";
  if (origin === "goal") return "goal";
  if (origin.startsWith("mcp:")) return "mcp";
  return "ui";
}

export default function RunsPage() {
  const t = useT(m);
  const { id } = useParams();
  const runList = useStudio((s) => s.runList);
  const refreshRuns = useStudio((s) => s.refreshRuns);
  const agents = useStudio((s) => s.agents);
  const [filter, setFilter] = useState<Filter>("all");
  const [origin, setOrigin] = useState<OriginFilter>("");
  const [agent, setAgent] = useState("");
  const [q, setQ] = useState("");
  const [listError, setListError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => { refreshRuns().catch(() => undefined); }, [refreshRuns]);
  const reload = () => {
    setListError(null);
    refreshRuns().catch((e: unknown) => setListError(errText(e)));  // QA-m11
    setPage(null);
  };

  // ---- sunucu süzgeci: tekil durum (running/done), ajan ve başlık; "sorunlu" grubu ve köken istemcide süzülür
  const serverStatus = filter === "running" || filter === "done" ? filter : "";
  const needle = q.trim();
  const serverKey = serverStatus || agent || needle ? `${serverStatus}|${agent}|${needle}` : "";
  const [page, setPage] = useState<{ key: string; items: Run[]; total: number; offset: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchPage = (key: string, offset: number, signal?: AbortSignal) => {
    setLoading(true);
    setListError(null);
    return listRuns({ status: serverStatus || undefined, agent: agent || undefined, q: needle || undefined, limit: PAGE, offset }, signal)
      .then((r) => {
        if (signal?.aborted) return;
        setPage((p) => {
          const prev = p && p.key === key && offset > 0 ? p.items : [];
          const seen = new Set(prev.map((x) => x.id));
          return { key, items: [...prev, ...r.items.filter((x) => !seen.has(x.id))], total: r.total, offset: offset + r.items.length };
        });
      })
      .catch((e: unknown) => { if (!signal?.aborted) setListError(errText(e)); })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  };
  useEffect(() => {
    if (!serverKey) { setPage(null); setLoading(false); return; }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => { void fetchPage(serverKey, 0, ctrl.signal); }, needle ? 220 : 0);
    return () => { ctrl.abort(); window.clearTimeout(timer); };
  }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // depodaki canlı koşular (SSE ile güncellenir) sunucudan gelen sayfaların önünde tutulur
  const liveById = useMemo(() => new Map(runList.map((r) => [r.id, r])), [runList]);
  const base: Run[] = useMemo(() => {
    if (!serverKey) return page?.key === "" ? [...runList, ...page.items.filter((r) => !liveById.has(r.id))] : runList;
    if (!page || page.key !== serverKey) return [];
    const ids = new Set(page.items.map((r) => r.id));
    // sayfa yüklendikten sonra başlayan koşular da (süzgece uyuyorsa) en üstte görünsün
    const fresh = runList.filter((r) => !ids.has(r.id) && (!serverStatus || r.status === serverStatus)
      && (!agent || r.steps?.some((s) => s.agent === agent)) && (!needle || r.title.toLowerCase().includes(needle.toLowerCase())));
    return [...fresh, ...page.items.map((r) => liveById.get(r.id) ?? r)];
  }, [serverKey, page, runList, liveById, serverStatus, agent, needle]);
  const total = serverKey ? (page?.key === serverKey ? page.total : 0) : (page?.key === "" ? page.total : runList.length);
  const canMore = serverKey ? !!page && page.key === serverKey && page.offset < page.total : (!page || page.key !== "" ? runList.length >= 80 : page.offset < page.total);
  const loadMore = () => {
    const offset = serverKey ? (page?.offset ?? 0) : (page?.key === "" ? page.offset : runList.length);
    void fetchPage(serverKey, offset);
  };

  const list = useMemo(() => base.filter((r) =>
    (filter === "all" ? true : filter === "failed" ? PROBLEM.includes(r.status) : r.status === filter)
    && (!origin || originGroup(r.origin) === origin),
  ), [base, filter, origin]);
  const agentOptions = useMemo(() => agents.filter((a) => !a.hidden).sort(byName), [agents]);
  const anyFilter = filter !== "all" || !!origin || !!agent || !!needle;

  // ---- pencereli liste
  const listRef = useRef<HTMLDivElement>(null);
  const { rowHeight, observe } = useRowSizer(118);
  const win = useWindowRows(listRef, list.length, rowHeight + LIST_GAP, 3);
  const slice = list.slice(win.start, win.end);

  return (
    <div className="p-3 sm:p-5 flex flex-col gap-4 max-w-[1680px] mx-auto">
      <PageHeader title={t("page_title")} subtitle={t("page_subtitle")}
        actions={<><RecipeStartButton /><Button icon={<RefreshCcw size={15} />} onClick={reload}>{t("refresh")}</Button></>} />
      <DailyBudgetBar />
      {/* PROC2-FIX P3: açık koşu xl altında tam genişlik (onay kartındaki istem dar sütuna sıkışmaz); liste 2xl'de yanda */}
      <div className={clsx("grid gap-4", id ? "2xl:grid-cols-[380px_minmax(0,1fr)]" : "lg:grid-cols-[380px_minmax(0,1fr)]")}>
      <div className={clsx("flex flex-col gap-3 min-w-0", id && "hidden 2xl:flex")}>
        <div className="flex flex-col gap-2" role="search" aria-label={t("filters_label")}>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={filter} onChange={setFilter} className="self-start" options={[
              { value: "all", label: t("f_all") }, { value: "running", label: t("f_running") }, { value: "done", label: t("f_done") }, { value: "failed", label: t("f_failed") },
            ]} />
            <Button size="sm" variant="ghost" icon={<Filter size={14} />} aria-expanded={showFilters} aria-controls="kosu-filtreleri"
              onClick={() => setShowFilters((v) => !v)}>{t("f_origin")} / {t("f_agent")}</Button>
          </div>
          <label className="relative block">
            <span className="sr-only">{t("search_label")}</span>
            <Search size={15} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input className="input !pl-9 !py-1.5 text-sm" type="search" value={q} placeholder={t("search_placeholder")} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div id="kosu-filtreleri" className={clsx("grid grid-cols-2 gap-2", !showFilters && "hidden")}>
            <label className="flex flex-col gap-1 min-w-0">
              <span className="label">{t("f_origin")}</span>
              <select className="select !py-1.5 !text-sm" value={origin} onChange={(e) => setOrigin(e.target.value as OriginFilter)}>
                <option value="">{t("f_origin_all")}</option>
                <option value="ui">{t("f_origin_ui")}</option>
                <option value="goal">{t("f_origin_goal")}</option>
                <option value="mcp">{t("f_origin_mcp")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 min-w-0">
              <span className="label">{t("f_agent")}</span>
              <select className="select !py-1.5 !text-sm" value={agent} onChange={(e) => setAgent(e.target.value)}>
                <option value="">{t("f_agent_all")}</option>
                {agentOptions.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2 font-semibold num" role="status" aria-live="polite">
            {total > list.length ? t("showing_of", { n: list.length, total }) : tp(m, "showing", list.length)}
            {loading && <Spinner size={12} />}
            {anyFilter && <Button size="sm" variant="ghost" onClick={() => { setFilter("all"); setOrigin(""); setAgent(""); setQ(""); }}>{t("clear_filters")}</Button>}
          </div>
        </div>
        <div ref={listRef} className="flex flex-col" aria-label={t("list_label")} style={{ gap: LIST_GAP, paddingTop: win.padTop, paddingBottom: win.padBottom }}>
          {/* liste alınamadıysa "henüz görev yok" demek yanlış olur; hata kutusu ve Yeniden dene çıkar*/}
          {list.length === 0 && !loading && listError && <Panel><LoadError title={t("list_error_title")} text={listError} onRetry={reload} /></Panel>}
          {list.length === 0 && !loading && !listError && <Panel>{anyFilter
            ? <Empty icon={<ListChecks size={28} />} title={t("empty_filter")} />
            : <Empty icon={<ListChecks size={28} />} title={t("empty_none")} text={t("empty_none_text")} />}</Panel>}
          {slice.map((r) => (
            <div key={r.id} ref={observe} className="flex" style={{ minHeight: rowHeight }}>
              <Link to={`/gorevler/${r.id}`}
                className={clsx("panel p-3 flex-1 flex flex-col gap-2 transition-transform hover:-translate-y-0.5 min-w-0", r.id === id && "!bg-panel-2 outline-3 outline-amethyst")}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.kind === "delegation" ? "info" : "muted"}>
                    {r.kind === "delegation" && <Split size={12} />}{kindLabel(t, r.kind)}
                  </Badge>
                  <StatusPill status={r.status} />
                  <ErrorClassBadge value={r.error_class} status={r.status} />
                  {/* S39: "Çalışıyor" görünse de iş senin kararını bekliyorsa bunu listede de söyle */}
                  {(r.steps ?? []).some((s) => s.status === "awaiting_approval" || s.status === "awaiting_tool_approval") && (
                    // FOLLOWUP: duraklatılmış/kesilmiş koşuda karar verilemez → "Sürdürülmeli"
                    r.status === "running"
                      ? <Badge tone="warn"><Hand size={12} aria-hidden />{t("awaiting_you")}</Badge>
                      : <Badge tone="muted" title={t("needs_resume_hint")}><Hand size={12} aria-hidden />{t("needs_resume")}</Badge>
                  )}
                  <OriginBadge origin={r.origin} compact />
                  <span className="ml-auto text-xs text-muted num whitespace-nowrap">{timeAgo(r.started_at)}</span>
                </div>
                <div className="font-semibold text-sm line-clamp-2">{r.title}</div>
                <StepDots steps={r.steps ?? []} agents={agents} />
              </Link>
            </div>
          ))}
        </div>
        {canMore && (
          <Button size="sm" variant="ghost" className="self-center" disabled={loading} onClick={loadMore}>
            {loading ? t("loading") : t("load_more")}
          </Button>
        )}
      </div>
      <div className={clsx("min-w-0", !id && "hidden lg:block")}>
        {id ? <RunDetail id={id} /> : (
          <Panel className="h-full"><Empty icon={<ListChecks size={30} />} title={t("pick_title")} text={t("pick_text")} /></Panel>
        )}
      </div>
      </div>
    </div>
  );
}

type T = ReturnType<typeof useT<typeof m.tr>>;

/** adımın token sayısı BÜTÜN denemeleridir (koşu toplamı, tavan ve günlük sayımla aynı); yeniden denendiyse son
 * denemenin payı ayrıca yazılır.*/
function stepTokens(t: T, s: StepRun): string {
  const all = Number(s.spent?.tokens ?? 0);
  const last = Number(s.tokens?.total ?? 0);
  if (all > 0 && last > 0 && all > last && (s.attempt ?? 0) > 1)
    return t("step_tokens_all", { n: fmtNumber(all), last: fmtNumber(last) });
  return t("tokens", { n: fmtNumber(all || last) });
}

function kindLabel(t: T, kind: string): string {
  return kind === "task" ? t("kind_task") : kind === "workflow" ? t("kind_workflow") : kind === "delegation" ? t("kind_delegation") : kind;
}

function StepDots({ steps, agents }: { steps: StepRun[]; agents: Agent[] }) {
  const t = useT(m);
  // Kart listesinde yalnızca kök adımlar ve doğrudan alt görevleri (çok adımlı devretmede liste kısa kalsın)
  const shown = treeOrder(steps).filter((s) => ((s as DynStep).depth ?? 0) <= 1).slice(0, 24);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {shown.map((s, i) => {
        const a = agents.find((x) => x.slug === s.agent);
        const tone = STATUS[s.status]?.tone ?? (s.status === "awaiting_tool_approval" ? "warn" : "muted");
        return (
          <span key={s.id} className="flex items-center gap-1">
            {i > 0 && <span className="w-2 h-0.5 bg-line-soft" />}
            <span className={clsx("chip !px-1 !py-0.5", `tone-${tone}`)} title={t("step_dot_title", { title: s.title || s.id, status: stepStatusLabel(s.status) })}>
              {s.type === "approval" ? <Hand size={12} /> : a ? <PixelFace avatar={a.avatar} size={18} /> : <span className="w-4 h-4" />}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function RunDetail({ id }: { id: string }) {
  const t = useT(m);
  const run = useStudio((s) => s.runs[id]);
  const loadRun = useStudio((s) => s.loadRun);
  const agents = useStudio((s) => s.agents);
  const navigate = useNavigate();
  const [missing, setMissing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [view, setView] = useState<"steps" | "trace">("steps");
  const tt = useT(traceMsg);
  // PANO-FIX Pano'nun "Karar ver"i kararın kartına iner (`?karar=<adım>`, kabul için `?kabul=1`): adımlar sekmesi
  // açılır, kart ortalanır ve başlığına odak verilir (ekran okuyucu adım adını duyar); her hedefe bir kez
  const [params] = useSearchParams();
  const target = params.get("karar");
  const toAccept = params.get("kabul") === "1";
  const landed = useRef<string | null>(null);
  const hasRun = !!run;
  useEffect(() => {
    if (!hasRun || (!target && !toAccept)) return;
    const key = `${id}:${target ?? ""}:${toAccept}`;
    if (landed.current === key) return;
    if (target && view !== "steps") { setView("steps"); return; }
    const h = window.setTimeout(() => {
      const el = target ? document.getElementById(`adim-${target}`) : document.getElementById("kabul");
      if (!el) return;
      landed.current = key;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      const head = el.querySelector<HTMLElement>("h2, h3") ?? el;
      if (!head.hasAttribute("tabindex")) head.setAttribute("tabindex", "-1");
      head.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(h);
  }, [hasRun, id, target, toAccept, view]);

  useEffect(() => {
    setMissing(false);
    setActionError(null);
    loadRun(id).then((r) => { if (!r) setMissing(true); }).catch(() => setMissing(true));
  }, [id, loadRun]);

  const ordered = useMemo(() => (run ? treeOrder(run.steps) : []), [run]);

  if (missing) return <Panel><NotFound title={t("not_found")} backTo="/gorevler" backLabel={t("back_to_list")} /></Panel>;
  if (!run) return <div className="grid place-items-center py-20"><Spinner size={26} /></div>;

  // başlıktaki jeton = koşunun GERÇEK harcaması (durdurulan/yeniden oynatılan denemeler dahil; çubuk ve günlükle
  // aynı sayı). Eski kayıtta yoksa adımların güncel denemelerinin toplamı.
  const tokens = run.usage?.spent?.tokens ?? run.steps.reduce((acc, s) => acc + (s.tokens?.total ?? 0), 0);
  const elapsed = run.duration_ms ?? between(run.started_at, run.finished_at);
  const dyn = run.steps.filter((s) => (s as DynStep).parent).length;
  const hires = run.steps.filter((s) => (s as DynStep).kind === "hire" && s.status === "done").length;
  const awaiting = run.steps.find((s) => s.status === "awaiting_approval" || s.status === "awaiting_tool_approval");

  return (
    <div className="flex flex-col gap-4">
      <header className="panel p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" className="2xl:hidden" icon={<ArrowLeft size={16} />} onClick={() => navigate("/gorevler")} aria-label={t("back")} />
          <Badge tone={run.kind === "delegation" ? "info" : "muted"}>
            {run.kind === "delegation" && <Split size={12} />}
            {run.kind === "workflow" ? t("kind_workflow_named", { name: run.workflow ?? "" }) : kindLabel(t, run.kind)}
          </Badge>
          <StatusPill status={run.status} />
          <ErrorClassBadge value={run.error_class} status={run.status} />
          <AcceptanceBadge runId={run.id} />
          <OriginBadge origin={run.origin} />
          <RunZoneBadge run={run as unknown as { id: string } & Record<string, unknown>} />
          {run.goal && <Badge tone="warn" title={t("goal_title", { id: run.goal })}><Flag size={12} />{t("goal_run")}</Badge>}
          <ForkedFromLink run={run} />
          {!!run.attempts && <Badge tone="info">{tt("attempts_badge", { n: run.attempts })}</Badge>}
          <span className="ml-auto flex flex-wrap gap-2">
            <RunPauseResume run={run} onError={setActionError} />
            {run.status === "running" && (
              <Button size="sm" variant="danger" icon={<Square size={13} />}
                onClick={() => { setActionError(null); api.cancelRun(run.id).catch((e: unknown) => setActionError(errText(e))); }}>{t("stop")}</Button>
            )}
          </span>
        </div>
        {actionError && <p className="text-sm font-semibold text-bad" role="alert">{actionError}</p>}
        <h2 className="t-h3 break-words">{run.title}</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted font-medium num">
          <span className="flex items-center gap-1"><Clock size={13} />{t("started_ago", { ago: timeAgo(run.started_at) })}{elapsed != null && ` · ${duration(elapsed)}`}</span>
          {tokens > 0 && <span className="flex items-center gap-1"><Hash size={13} aria-hidden />{
            // koşu toplamı BÜTÜN denemelerdir (tavan, kart ve günlük sayımla aynı); yeniden deneme varsa söylenir
            Number(run.usage?.replayed?.tokens ?? 0) > 0 ? t("tokens_all", { n: fmtNumber(tokens) }) : t("tokens", { n: fmtNumber(tokens) })}</span>}
          {dyn > 0 && <span className="flex items-center gap-1"><Split size={13} />{t("dyn_steps", { n: dyn })}{hires ? t("hires", { n: hires }) : ""}</span>}
          <span className="font-mono break-all">{run.id}</span>
        </div>
        {Object.keys(run.inputs || {}).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(run.inputs).filter(([k]) => !k.startsWith("_")).map(([k, v]) => <span key={k} className="chip !whitespace-normal"><b>{k}:</b> {String(v).slice(0, 140)}</span>)}
          </div>
        )}
        {run.error && run.status !== "interrupted" && <div className="chip tone-bad !rounded-lg !whitespace-normal !items-start font-medium p-2.5 text-sm">{run.error}</div>}
        <BudgetBar run={run as LiveRun} />
      </header>
      <ResumeBanner run={run as LiveRun} />
      <ManifestDiffBanner run={run} />
      <RunResultCard runId={run.id} status={run.status} />
      <EstimateVsActual runId={run.id} status={run.status} />
      {awaiting && (
        <div role="status" className="panel-soft tone-warn p-3 flex flex-wrap items-center gap-2 text-sm font-semibold">
          <Hand size={16} aria-hidden className="shrink-0" />
          <span className="flex-1 min-w-[min(100%,14rem)]">{t("awaiting_banner", { step: awaiting.title || awaiting.id })}</span>
          <Button size="sm" variant="primary" onClick={() => {
            setView("steps");
            window.setTimeout(() => {
              const el = document.getElementById(`adim-${awaiting.id}`);
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
              el?.querySelector<HTMLElement>("textarea, button")?.focus({ preventScroll: true });
            }, 50);
          }}>{t("awaiting_go")}</Button>
        </div>
      )}
      <div id="kabul" className="scroll-mt-4 empty:hidden"><AcceptancePanel run={run} /></div>

      <Tabs id={`kosu-${run.id}`} value={view} onChange={setView} label={tt("tabs_label")}
        tabs={[{ value: "steps", label: tt("tab_steps") }, { value: "trace", label: tt("tab_trace") }]} />
      <TabPanel tabs={`kosu-${run.id}`} value={view} className="flex flex-col gap-4">
        {view === "steps" ? (<>
          <ol className="flex flex-col gap-0" aria-label={t("steps_label")}>
            {ordered.map((s, i) => (
              <StepCard key={s.id} run={run} step={s} agent={agents.find((a) => a.slug === s.agent)} agents={agents}
                last={i === ordered.length - 1} />
            ))}
          </ol>
          <RunMessagesPanel runId={run.id} />
          {!!run.events?.length && <EventLog run={run} />}
        </>) : (<>
          <TraceView runId={run.id} live={run.status === "running"} />
          <SpanWaterfall runId={run.id} live={run.status === "running"} />
        </>)}
      </TabPanel>
    </div>
  );
}

function stepMood(s: StepRun): Mood {
  if (s.status === "running") return s.output ? "working" : "thinking";
  if (s.status === "done") return "done";
  if (s.status === "failed") return "error";
  if (s.status === "awaiting_approval" || s.status === "awaiting_tool_approval") return "waiting";
  return "idle";
}

/** Devretme planı: alt görevler, atananlar, işe alım ve alt devretme işaretleri. */
function PlanList({ step, agents }: { step: DynStep; agents: Agent[] }) {
  const t = useT(m);
  const plan = step.plan ?? [];
  const d = step.delegate;
  return (
    <div className="flex flex-col gap-2">
      {d && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge tone="info"><Split size={12} />{t("level_of", { level: d.level, depth: d.depth })}</Badge>
          <Badge>{t("max_subtasks", { n: d.max_subtasks })}</Badge>
          <Badge tone={d.allow_hiring ? "ok" : "muted"}>
            {d.allow_hiring ? t("hiring_on", { mode: d.hiring_approval === "auto" ? t("hiring_auto") : t("hiring_ask"), left: d.hires_left }) : t("hiring_off")}
          </Badge>
        </div>
      )}
      {plan.length > 0 && (
        <ol className="flex flex-col gap-1 text-sm">
          {plan.map((p, i) => {
            const a = agents.find((x) => x.slug === p.assignee);
            return (
              <li key={p.step} className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="text-muted num w-5 text-right shrink-0">{i + 1}.</span>
                <PixelFace avatar={a?.avatar} size={22} ring={a?.color} />
                <span className="font-semibold min-w-0 break-words">{p.title}</span>
                <span className="text-ink-2">→ {p.assignee_name}</span>
                {p.hired && <Badge tone="info"><UserPlus size={12} />{t("plan_new")}</Badge>}
                {p.hire_rejected && <Badge tone="muted">{t("plan_hire_rejected")}</Badge>}
                {p.nested && <Badge tone="info"><Split size={12} />{t("plan_nested")}</Badge>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function StepCard({ run, step: s, agent, agents, last }: { run: Run; step: StepRun; agent?: Agent; agents: Agent[]; last: boolean }) {
  const t = useT(m);
  const [showThought, setShowThought] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const running = s.status === "running";
  const elapsed = between(s.started_at, s.finished_at);
  const gw = s as StepWithGateway;
  const ds = s as DynStep;
  const type = s.type as string;
  const depth = Math.min(ds.depth ?? 0, 4);
  const orchestrate = type === "orchestrate";
  const delegate = type === "delegate" || orchestrate;  // S24: orkestratör planı ve çıktısı devretme gibi gösterilir
  const hireStep = ds.kind === "hire" && !!ds.hire;
  const kind = (ds.kind ?? "") as string;
  const orch = (s as StepRun & { orchestrate?: { round?: number; replans?: number; max_replans?: number } }).orchestrate;

  // S5 "Kaputun Altı": adımın bağlamı/ayrıntısı açılınca oyun sinyali (oyun kapalıysa sunucu yok sayar)
  const opened = () => sendGameSignal("context.opened", { run: run.id, step: s.id });

  return (
    <li id={`adim-${s.id}`} className="flex gap-3 scroll-mt-4" style={depth ? { paddingLeft: depth * 14 } : undefined}>
      <div className={clsx("flex flex-col items-center pt-1", depth > 0 && "border-l-2 border-dashed border-line-soft pl-2")}>
        {s.type === "approval" ? (
          <span className={clsx("rounded-lg grid place-items-center border-2 border-line", hireStep ? "bg-sky text-panel" : "bg-gold text-ink",
            depth ? "h-9 w-9" : "h-11 w-11")}>
            {hireStep ? <UserPlus size={depth ? 17 : 20} /> : <ShieldCheck size={depth ? 17 : 20} />}
          </span>
        ) : (
          <PixelFace avatar={agent?.avatar} mood={stepMood(s)} size={depth ? 36 : 44} ring={agent?.color} />
        )}
        {!last && <span className="flex-1 w-[3px] bg-line-soft my-1 rounded" />}
      </div>
      <div className="panel flex-1 min-w-0 mb-4 p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="panel-title break-words">{s.title || s.id}</h3>
          {agent && <span className="text-sm text-muted">· {agent.name}</span>}
          <StepStatusPill status={s.status} />
          <ErrorClassBadge value={s.error_class} status={s.status} />
          {delegate && !orchestrate && <Badge tone="info"><Split size={12} />{t("badge_delegate")}</Badge>}
          {orchestrate && <Badge tone="info"><ListChecks size={12} />{t("badge_orchestrate")}</Badge>}
          {orchestrate && orch && !!orch.round && (
            <Badge>{t("orch_round", { round: orch.round, replans: orch.replans ?? 0, max: orch.max_replans ?? 0 })}</Badge>
          )}
          {kind === "plan" && <Badge tone="info"><ListChecks size={12} />{t("badge_plan_round")}</Badge>}
          {kind === "replan" && <Badge tone="warn"><RefreshCcw size={12} />{t("badge_replan_round")}</Badge>}
          {ds.kind === "subtask" && <Badge>{t("badge_subtask")}</Badge>}
          {ds.kind === "synthesis" && <Badge tone="ok"><GitMerge size={12} />{t("badge_synthesis")}</Badge>}
          {ds.assignee_hired && <Badge tone="info"><UserPlus size={12} />{t("badge_new_hire")}</Badge>}
          {ds.role && <Badge title={t("role_title")}>{t("role_badge", { role: ds.role })}</Badge>}
          {s.revise && <Badge tone="warn">{t("reviewer", { target: s.revise.target })}{s.rounds > 0 ? t("round", { n: s.rounds + 1 }) : ""}</Badge>}
          {!s.revise && s.rounds > 0 && <Badge tone="warn">{t("revised", { n: s.rounds })}</Badge>}
          <StepRetryInfo step={s as LiveStep} />
          <StepCapBadge step={s} />
          {/* adım başı onayın sonucu (rozet)*/}
          {s.gate ? (
            <Badge tone={s.gate.outcome === "approved" ? "ok" : s.gate.outcome === "rejected" ? "bad" : "warn"}
              title={s.gate.note ?? undefined}>
              <ShieldCheck size={12} aria-hidden />
              {s.gate.outcome === "pending" ? t(s.gate.phase === "after" ? "gate_pending_after" : "gate_pending_before")
                : t(s.gate.outcome === "approved" ? "gate_approved" : "gate_rejected")}
            </Badge>
          ) : (s.approval === "before" || s.approval === "after") && (
            <Badge><ShieldCheck size={12} aria-hidden />{t(s.approval === "after" ? "gate_mode_after" : "gate_mode_before")}</Badge>
          )}
          <RecognitionStepChip run={run} stepId={s.id} agent={s.agent} />
          <span className="ml-auto flex gap-2 text-xs text-muted font-medium num">
            {elapsed != null && <span>{duration(elapsed)}</span>}
            {!!(s.spent?.tokens || s.tokens?.total) && <span>{stepTokens(t, s)}</span>}
          </span>
        </div>
        {(s.route?.label || s.model) && (
          <div className="flex flex-wrap gap-1.5">
            {s.route?.label && <Badge tone="info" className="!whitespace-normal">{s.route.label}</Badge>}
            {s.model && s.model !== s.route?.model && <Badge className="!whitespace-normal break-all">{s.model}</Badge>}
            {gw.invocation?.transport && (
              <Badge tone={gw.invocation.transport === "api" ? "ok" : "muted"}
                title={gw.invocation.reason ?? undefined}>{gw.invocation.transport === "api" ? t("hermes_api") : t("cli")}</Badge>
            )}
          </div>
        )}
        <InvocationLine inv={gw.invocation} />
        {!!s.skills_used?.length && (
          // adımın istemine giren skill'ler (USED_SKILL): nasıl girdiği + sabitlenmiş sürüm (sha)
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs font-semibold text-muted">{t("skills_used")}</span>
            {s.skills_used.map((u) => (
              <Badge key={u.key} className="!whitespace-normal break-all" title={u.sha ? `sha ${u.sha.slice(0, 12)}` : undefined}>
                {u.key} · {u.how === "hermes_flag"
                  // HERMES-SKILL-EDGE: hermes -s ile verildi; ajan açtıysa "kullandı", yoksa yalnız "sunuldu"
                  ? t(u.status === "used" ? "skill_how_flag_used" : "skill_how_flag")
                  : t(u.how === "always" ? "skill_how_always" : u.how === "selected" ? "skill_how_selected" : "skill_how_catalog")}
              </Badge>
            ))}
          </div>
        )}

        {gw.pending_approval && s.status === "awaiting_tool_approval" && (
          // QA-m8: her yeni onay için kart yeniden kurulur (önceki "Gönderiliyor…" durumu taşınmaz)
          <ToolApprovalCard key={gw.pending_approval.approval_id} runId={run.id} req={gw.pending_approval} agentName={agent?.name} />
        )}
        {!!gw.approvals?.length && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted flex items-center gap-1"><ShieldCheck size={13} /> {t("approval_decisions")}</span>
            <ApprovalHistory items={gw.approvals} />
          </div>
        )}

        {hireStep && <HireApprovalCard run={run} step={s} hire={ds.hire!} manager={agents.find((a) => a.slug === ds.hire!.by)} />}

        {isAskCard(run, s) && <AskCard run={run} step={s} />}

        {s.type === "approval" && !hireStep && !isAskCard(run, s) && <ApprovalStepCard run={run} step={s} agents={agents} />}

        {delegate && <PlanList step={ds} agents={agents} />}

        {/* PROC2-FIX P1: adım sürerken bütçe sınırında durdurulan denemenin korunan yarım çıktısı */}
        {!!s.partial && (s.partial.chars > 0 || s.partial.tool_count > 0) && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-semibold text-muted break-words">
              {t("partial_kept", { n: s.partial.attempt, chars: fmtNumber(s.partial.chars), tools: fmtNumber(s.partial.tool_count) })}
            </summary>
            {!!s.partial.output && (
              <pre className="mt-1.5 text-xs font-mono whitespace-pre-wrap break-words text-ink-2 max-h-72 overflow-y-auto panel-soft p-2"
                tabIndex={0}>{s.partial.output}</pre>
            )}
          </details>
        )}

        {/* olası kaydedilmemiş istek — harcamaya sayılmaz, yalnız görünür not*/}
        {!!s.unrecorded_possible?.count && (
          <p className="chip tone-info !whitespace-normal !items-start break-words self-start" role="note">
            <AlertTriangle size={12} aria-hidden />{t("unrecorded_chip", { n: fmtNumber(s.unrecorded_possible.tokens_max),
              count: s.unrecorded_possible.count })}
          </p>
        )}

        {/* engellemeyen uyarı — adım, koşu sınırına bağlanan otomatik tavanını aştı*/}
        {!!s.runaway && (
          <p className="chip tone-warn !whitespace-normal !items-start break-words self-start" role="status">
            <AlertTriangle size={12} aria-hidden />{t("runaway_chip", { spent: fmtNumber(s.runaway.spent), cap: fmtNumber(s.runaway.would_be) })}
          </p>
        )}

        {!!s.recalled?.length && (
          <div>
            <button className="flex items-center gap-1.5 text-sm font-semibold text-accent" aria-expanded={showMemory}
              onClick={() => { if (!showMemory) opened(); setShowMemory((v) => !v); }}>
              {showMemory ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<Brain size={15} /> {t("recalled_n", { n: s.recalled.length })}
            </button>
            {showMemory && (
              <ul className="mt-2 flex flex-col gap-1">
                {s.recalled.map((r) => (
                  <li key={r.id} className="text-sm flex gap-2 items-start">
                    <Badge tone={r.type === "Fact" ? "info" : "warn"}>{r.type === "Fact" ? t("fact") : t("memory")}</Badge>
                    <span className="flex-1">{r.label}</span>
                    {r.via && <span className="text-xs text-muted shrink-0">{r.via}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!!s.tools?.length && (
          <div className="flex flex-wrap gap-1.5">
            {s.tools.slice(-24).map((tool, i) => (
              <span key={i} title={[tool.input, tool.output].filter(Boolean).join("\n→ ")}
                className={clsx("chip max-w-full", tool.ok === false ? "tone-bad" : tool.ok ? "tone-ok" : "tone-info",
                  tool.reused && "!whitespace-normal !items-start break-words")}>
                <Wrench size={12} />{tool.name}{tool.ok == null && <Spinner size={12} />}
                {tool.reused && <span className="font-normal">· {t("tool_reused")}</span>}
              </span>
            ))}
          </div>
        )}

        {!!s.thought && (
          <div>
            <button className="flex items-center gap-1.5 text-xs font-semibold text-muted" onClick={() => setShowThought((v) => !v)}>
              {showThought ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {t("thought_stream")}
            </button>
            {showThought && <pre className="mt-1.5 text-xs font-mono whitespace-pre-wrap text-muted max-h-48 overflow-y-auto panel-soft p-2">{s.thought}</pre>}
          </div>
        )}

        {!!s.prompt && (
          <div>
            <button className="flex items-center gap-1.5 text-xs font-semibold text-muted" aria-expanded={showContext}
              onClick={() => { if (!showContext) opened(); setShowContext((v) => !v); }}
              title={t("context_title")}>
              {showContext ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<ScrollText size={13} /> {t("context_sent", { n: fmtNumber(s.prompt.length) })}
            </button>
            {showContext && <pre className="mt-1.5 text-xs font-mono whitespace-pre-wrap text-ink-2 max-h-72 overflow-y-auto panel-soft p-2">{s.prompt}</pre>}
          </div>
        )}

        {(s.type === "agent" || delegate) && (s.output ? <Markdown text={s.output} live={running} /> :
          running ? <p className="text-sm text-muted flex items-center gap-2"><Spinner size={14} /> {delegate ? t("planning") : s.thought ? t("thinking") : t("starting")}</p> :
          s.status === "pending" ? <p className="text-sm text-muted">{t("waiting_turn")}</p> : null)}

        {!!s.artifacts?.length && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs font-semibold text-muted flex items-center gap-1"><FileText size={13} /> {t("artifacts")}</span>
            {s.artifacts.map((f) => (
              <button key={f.name} type="button" className="chip tone-ok hover:border-ink-2" onClick={() => setPreview(f.name)}>
                {f.new ? "+ " : "± "}{f.name}
              </button>
            ))}
          </div>
        )}
        {preview && <FilePreview path={preview} onClose={() => setPreview(null)} />}

        {gw.warning && (
          <div className="chip tone-warn !rounded-lg !whitespace-normal !items-start font-medium p-2.5 text-sm"><AlertTriangle size={14} className="shrink-0 mt-[3px]" />{gw.warning}</div>
        )}
        {s.error && <div className="chip tone-bad !rounded-lg !whitespace-normal !items-start font-medium p-2.5 text-sm">{s.error}</div>}
        <StepActions run={run} step={s} />
        {s.memory && !s.memory.skipped && (
          <div className="text-xs text-accent font-semibold flex items-center gap-1.5">
            <Brain size={13} /> {t("memory_written", { concepts: String(s.memory.concepts), facts: String(s.memory.facts), how: s.memory.extractor === "llm" ? t("extract_llm") : t("extract_heuristic") })}
          </div>
        )}
      </div>
    </li>
  );
}

function FilePreview({ path, onClose }: { path: string; onClose: () => void }) {
  const t = useT(m);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.file>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.file(path).then(setData).catch((e) => setError(String(e))); }, [path]);
  return (
    <Modal open onClose={onClose} title={path} width={860}>
      {error ? <p className="text-bad text-sm">{error}</p> : !data ? <Spinner /> :
        data.kind === "binary" ? <p className="text-sm text-muted">{t("binary_file", { n: fmtNumber(data.size) })}</p> :
        data.kind === "markdown" ? <Markdown text={data.text ?? ""} /> :
        <pre className="font-mono text-xs whitespace-pre-wrap panel-soft p-3 max-h-[65vh] overflow-auto">{data.text}</pre>}
      {data?.truncated && <p className="text-xs text-muted mt-2">{t("truncated")}</p>}
    </Modal>
  );
}

function EventLog({ run }: { run: Run }) {
  const t = useT(m);
  const [open, setOpen] = useState(false);
  return (
    <Panel title={<button className="flex items-center gap-1.5" onClick={() => setOpen((v) => !v)}>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}{t("event_log", { n: run.events!.length })}</button>}>
      {open && (
        <ol className="font-mono text-xs flex flex-col gap-0.5 max-h-80 overflow-y-auto">
          {run.events!.map((e) => (
            <li key={e.seq} className="flex gap-2">
              <span className="text-muted shrink-0 num">{fmtDate(e.ts * 1000, { timeStyle: "medium" })}</span>
              <span className="text-accent shrink-0">{e.type}</span>
              <span className="truncate text-ink-2">{[
                e.step && typeof e.step === "object" ? (e.step as { id?: string }).id : e.step, // step.added: adım nesnesi
                e.name, e.status, e.choice, e.command, e.message,
              ].filter(Boolean).map(String).join(" · ")}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
