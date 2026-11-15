// DASH-MVP — Pano (Pano Görünümünde "/", her iki görünümde "/pano").; araştırma
// Tek iş: "Beni ne bekliyor, ne çalışıyor, ne kadar harcadım?" sorusunu tek
// bakışta, klavyeyle ve ekran okuyucuyla yanıtlamak.
// - Yalnız var olan uçlar: tam sürüm (kararlar + son çıktılar), budget/daily, metrics/summary, time-saved,
//   schedules, useStudio (koşular, ajanlar, canlı akış). Yeni onay yolu yok (kararlar derin bağlantı).
// - three / @react-three / voxel sahneleri İÇE AKTARILMAZ (board_bundle.test.mjs); PixelFace 2B tuvaldir.
// - Her bölüm kendi yükleniyor/boş/hata durumunu taşır; bir bölüm düşerse diğerleri çalışır.
// PANO-FIX:
// - kararlar sunucuda sıralanıp kesilir; özetin "en eskisi" kırpılmamış kümeden (decisionOldest).
// - "çalışan" yalnız gerçekten çalışanlar; kararını bekleyen görevler kuyrukta, canlı bölümde tek satır.
// - sade "Başlarken" kartı kuyruğun altında, kuyrukla aynı anda (düzen kayması yok).
// - /pano'da "Dünya Görünümüne geç" dünyayı açar ("/"); Dünya Görünümünde "Pano'yu açılış sayfası yap".
// - Pano, stüdyo genel verisi (overview) gelmeden çizilir; koşu ve ajan bölümleri o gelene dek iskelet.
// - ≥1000 px'te iki sütun: kararlar, canlı, çıktılar | ajanlar, zamanlamalar, etkinlik (sağda boşluk kalmaz).
import "../components/board/board.css";
import { Globe2, Keyboard, LayoutDashboard } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AgentsList, type AgentRow } from "../components/board/BoardLists";
import { BoardSection, LiveDot, useDelayed } from "../components/board/BoardParts";
import { START_WAIT_MS, useFirstSession } from "../components/board/useFirstSession";
import { DecisionQueue, QUEUE_LIMIT, type QueueHandle } from "../components/board/DecisionQueue";
import { KpiTiles, type WeekData } from "../components/board/KpiTiles";
import { UsageStrip, useUsageStrip } from "../components/metrics/UsageStrip";
import { LIVE_LIMIT, LiveRuns } from "../components/board/LiveRuns";
import { ageText, usd } from "../components/board/boardFormat";
import { buildDecisions, dailySpend, decisionOldest, decisionTotal, liveSplit } from "../components/board/decisionModel";
import { deriveWork, findRun, useElapsedTicker, useWorldFx } from "../components/world/activity";
import { Button } from "../components/ui";
import { agentAvailability, agentMood } from "../lib/agents";
import { dailyBudgetApi, type DailyBudgetStatus } from "../lib/dailyBudget";
import { selectRunsLoaded, useExternalAgents, useResumeFeed } from "../full/data";
import { savedHoursThisWeek } from "../full/more";
import { tp, useT } from "../lib/i18n";
import { metricsApi } from "../lib/metrics";
import { userRuns } from "../lib/runFilter";
import { useSchedules } from "../lib/schedule";
import { registerEventHandler, useStudio } from "../lib/store";
import type { Mood } from "../lib/types";
import { EDITION } from "../edition";
import { useMode, useUiMode } from "../lib/uiMode";
import { boardMsg } from "../locales/board";
import { viewMsg } from "../locales/view";

// kısayol penceresi yalnız açılınca yüklenir
const ShortcutSheet = lazy(() => import("../components/board/ShortcutSheet").then((m) => ({ default: m.ShortcutSheet })));
// ilk ekranın altındaki bölümler (çıktılar, zamanlamalar, etkinlik) ayrı parçada, Pano ile paralel yüklenir (§9)
const loadLower = () => import("../components/board/BoardLower");
const BoardLowerMain = lazy(() => loadLower().then((m) => ({ default: m.BoardLowerMain })));
const BoardLowerSide = lazy(() => loadLower().then((m) => ({ default: m.BoardLowerSide })));

const MOOD_RANK: Record<Mood, number> = { waiting: 0, working: 1, thinking: 1, error: 2, offline: 3, done: 4, idle: 5 };
const QUEUED_RE = /^(sırada|queued)/i;

/** Süre metinleri için yavaş saat (30 sn; sekme gizliyken durur). */
function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => { if (!document.hidden) setNow(Date.now()); };
    const h = window.setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(h); document.removeEventListener("visibilitychange", tick); };
  }, [ms]);
  return now;
}

/** role=status metni en sık 5 sn'de bir değişir (art arda olaylar birleşir; GameLayer emsali). */
function useThrottled(text: string, ms = 5000): string {
  const [shown, setShown] = useState(text);
  const last = useRef(0);
  useEffect(() => {
    if (text === shown) return;
    const wait = Math.max(0, last.current + ms - Date.now());
    const h = window.setTimeout(() => { last.current = Date.now(); setShown(text); }, wait);
    return () => window.clearTimeout(h);
  }, [text, shown, ms]);
  return shown;
}

export default function BoardPage() {
  const t = useT(boardMsg);
  const tv = useT(viewMsg);
  const mode = useMode();
  useElapsedTicker();
  const now = useNow();
  const [keysOpen, setKeysOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const queue = useRef<QueueHandle>(null);
  const decHead = useRef<HTMLHeadingElement>(null);
  const liveHead = useRef<HTMLHeadingElement>(null);

  // ------------------------------------------------------------------ veri: stüdyo deposu
  const loaded = useStudio((s) => s.loaded);
  const runsLoaded = useStudio(selectRunsLoaded);
  const agentsAll = useStudio((s) => s.agents);
  const states = useStudio((s) => s.states);
  const conns = useStudio((s) => s.connections);
  const runList = useStudio((s) => s.runList);
  const runsMap = useStudio((s) => s.runs);
  const feed = useStudio((s) => s.feed);
  const openComposer = useStudio((s) => s.openComposer);
  const selectAgent = useStudio((s) => s.selectAgent);
  const saving = useWorldFx((s) => s.saving);
  const externals = useExternalAgents();
  const liveExternals = useMemo(() => externals.filter((e) => e.status !== "ended"), [externals]);
  const runs = useMemo(() => userRuns(runList).map((r) => runsMap[r.id] ?? r), [runList, runsMap]);
  const agents = useMemo(() => agentsAll.filter((a) => !a.hidden), [agentsAll]);
  // koşu listesi isteği düşerse iskelet sonsuza dek kalmasın: genel veri geldikten 10 sn sonra bilinen sayılır
  const [runsLate, setRunsLate] = useState(false);
  useEffect(() => {
    if (runsLoaded || !loaded) return;
    const h = window.setTimeout(() => setRunsLate(true), 10_000);
    return () => window.clearTimeout(h);
  }, [runsLoaded, loaded]);
  const runsReady = runsLoaded || runsLate;

  // ------------------------------------------------------------------ kararlar (paylaşılan "Nerede kalmıştım?" verisi)
  const resume = useResumeFeed((s) => s.data);
  const resumeError = useResumeFeed((s) => s.error);
  const resumeLoading = useResumeFeed((s) => s.loading);
  const reloadResume = useCallback(() => { void useResumeFeed.getState().load(); }, []);
  useEffect(() => { reloadResume(); }, [reloadResume]);
  const decisions = useMemo(() => buildDecisions(resume, runs), [resume, runs]);
  const total = decisionTotal(resume, decisions.length);
  // "Başlarken" kartı kuyruğun altında; alt bölümler onu en çok START_WAIT_MS bekler (sonra gelirse yine altta)
  const start = useFirstSession();
  const startWaitOver = useDelayed(!start.settled, START_WAIT_MS);
  const decState = resume ? "ready" : resumeError ? "error" : "loading";
  // CLS: kararların altındaki bölümler karar listesi (ve varsa altındaki "Başlarken" kartı) yerine oturunca çizilir — liste
  // ya da kart sonradan gelip onları itmez (yeni içerik eklemek kayma sayılmaz). Kararlar bunu BEKLEMEZ (ilk karar hemen);
  // en çok 2,5 sn sonra alt bölümler her durumda çizilir.
  const decLate = useDelayed(!(decState !== "loading" && (start.settled || startWaitOver)), 2500);
  const below = (decState !== "loading" && (start.settled || startWaitOver)) || decLate;
  // yeni gelen kararlar: ilk yüklemeden sonra görünenler 10 sn "Yeni" + kısa vurgu
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!resume) return;
    const keys = decisions.map((d) => d.key);
    if (seen.current === null) { seen.current = new Set(keys); return; }
    const added = keys.filter((k) => !seen.current!.has(k));
    keys.forEach((k) => seen.current!.add(k));
    if (!added.length) return;
    setFresh((cur) => new Set([...cur, ...added]));
    const h = window.setTimeout(() => setFresh((cur) => new Set([...cur].filter((k) => !added.includes(k)))), 10_000);
    return () => window.clearTimeout(h);
  }, [resume, decisions]);

  // ------------------------------------------------------------------ bugünkü harcama
  const [daily, setDaily] = useState<DailyBudgetStatus | null>(null);
  const [dailyError, setDailyError] = useState(false);
  useEffect(() => {
    const load = () => { dailyBudgetApi.status().then((s) => { setDaily(s); setDailyError(false); }).catch(() => setDailyError(true)); };
    load();
    const offs = [registerEventHandler("budget.", load), registerEventHandler("run.finished", load)];
    const h = window.setInterval(load, 60_000);
    return () => { offs.forEach((off) => off()); window.clearInterval(h); };
  }, []);

  // ------------------------------------------------------------------ bu hafta (kabul edilen iş + kazanılan zaman)
  const [week, setWeek] = useState<WeekData | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      void Promise.allSettled([metricsApi.summary("7d"), savedHoursThisWeek()]).then(([m, ts]) => {
        if (!live) return;
        setWeek({
          accepted: m.status === "fulfilled" ? m.value.accepted : null,
          costUsd: m.status === "fulfilled" ? m.value.cpa.cost_usd : null,
          hours: ts.status === "fulfilled" ? ts.value : null,
          failed: m.status === "rejected",
        });
      });
    };
    load();
    const off = registerEventHandler("acceptance.", load);
    return () => { live = false; off(); };
  }, []);
  const spend = useMemo(() => dailySpend(runs, now), [runs, now]);
  const usage = useUsageStrip();

  // ------------------------------------------------------------------ zamanlamalar
  const schedules = useSchedules((s) => s.items);
  const schedLoaded = useSchedules((s) => s.loaded);
  const schedError = useSchedules((s) => s.error);
  const schedEnabled = useSchedules((s) => s.enabled);
  useEffect(() => { void useSchedules.getState().refresh(); }, []);

  // ------------------------------------------------------------------ ajanlar ve canlı görevler
  const moods = useMemo(() => new Map(agents.map((a) => [a.slug, agentMood(a, states, conns)])), [agents, states, conns]);
  const agentRows = useMemo<AgentRow[]>(() => agents.map((a) => {
    const st = states[a.slug] ?? a.state;
    const sv = saving[a.slug];
    const av = agentAvailability(a, conns);
    return { a, mood: moods.get(a.slug) ?? "idle", avOk: av.ok, avReason: av.reason, activity: st?.activity,
      work: deriveWork(st, findRun(st?.run_id ?? sv?.run, runsMap, runList), sv) };
  }).sort((x, y) => MOOD_RANK[x.mood] - MOOD_RANK[y.mood]), [agents, states, saving, conns, moods, runsMap, runList]);
  const working = agentRows.filter((r) => r.mood === "working" || r.mood === "thinking").length;
  const idle = agentRows.filter((r) => r.mood === "idle").length;
  const split = useMemo(() => liveSplit(runs), [runs]);
  const { running, waiting: runsWaiting } = split;
  // koşu listesi özet taşır (kullanım, bütçe, adım kartı yok): gösterilen koşuların ayrıntısı bir kez istenir, sonra
  // canlı olaylar depoyu günceller (var olan GET /api/runs/{id})
  const requested = useRef(new Set<string>());
  useEffect(() => {
    const ids = [...split.cards.slice(0, LIVE_LIMIT).map((r) => r.id), ...decisions.slice(0, QUEUE_LIMIT).map((d) => d.runId)];
    for (const id of ids) {
      if (!id || runsMap[id] || requested.current.has(id)) continue;
      requested.current.add(id);
      void useStudio.getState().loadRun(id);
    }
  }, [split.cards, decisions, runsMap]);
  const queued = useMemo(() => new Set(split.cards.filter((r) => {
    const step = r.steps.find((s) => s.status === "running");
    const st = step?.agent ? states[step.agent] : undefined;
    return !!st && st.run_id === r.id && QUEUED_RE.test(st.activity ?? "");
  }).map((r) => r.id)), [split.cards, states]);
  const agentOfRun = useCallback((runId: string) => {
    const r = runs.find((x) => x.id === runId);
    const slug = r ? [...r.steps].reverse().find((s) => s.agent)?.agent : undefined;
    return slug ? agentsAll.find((a) => a.slug === slug) : undefined;
  }, [runs, agentsAll]);
  const pickAgent = useCallback((slug: string) => selectAgent(slug), [selectAgent]);
  const taskFor = useCallback((slug?: string) => openComposer(slug), [openComposer]);

  // ------------------------------------------------------------------ özet cümlesi (role=status, en sık 5 sn)
  const oldest = useMemo(() => decisionOldest(resume, decisions), [resume, decisions]);
  const capUsd = daily?.effective.cost_usd ?? null;
  const paidToday = (daily?.spent.cost_usd ?? 0) > 0;
  const summary = !resume && !resumeError ? t("sum_loading") : [
    !resume ? t("sum_unknown") : total ? tp(boardMsg, "sum_waiting", total, { age: oldest != null ? ageText(now - oldest) : t("age_now") }) : t("sum_none"),
    !runsReady ? "" : running ? tp(boardMsg, "sum_running", running) : t("sum_running_none"),
    runsReady && runsWaiting ? tp(boardMsg, "sum_run_waiting", runsWaiting) : "",
    // "$0,00" yalnız tavan varken ya da ücretli harcama olduysa yazılır (abonelik/yerel için anlamsız sıfır yok)
    daily && capUsd != null ? t("sum_spent_cap", { spent: usd(daily.spent.cost_usd ?? 0), cap: usd(capUsd) })
      : daily && paidToday ? t("sum_spent", { spent: usd(daily.spent.cost_usd ?? 0) }) : "",
  ].filter(Boolean).join(" ");
  const shownSummary = useThrottled(summary);

  const focusSection = (h: React.RefObject<HTMLHeadingElement | null>) => {
    h.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    h.current?.focus({ preventScroll: true });
  };
  const onWaiting = () => { if (!queue.current?.focusFirst()) focusSection(decHead); };
  const onRunning = () => focusSection(liveHead);
  // /pano'da Dünya'ya geçmek dünyayı açar; Dünya Görünümünde /pano'daki düğme Pano'yu açılış sayfası yapar (sayfa kalır)
  const onPano = pathname.replace(/\/+$/, "") === "/pano";
  const switchView = () => {
    const next = mode === "board" ? "world" : "board";
    void useUiMode.getState().setMode(next);
    if (next === "world" && onPano) navigate("/");
  };
  const switchLabel = mode === "board" ? tv("to_world") : onPano ? t("to_board_home") : tv("to_board");

  return (
    <div className="bd-wrap">
      <div className="bd-page">
        <header className="bd-head">
          <div className="min-w-0 flex-1 basis-[28rem]">
            <h1 className="page-title">{tv("title")}</h1>
            <p className="page-subtitle" role="status" aria-live="polite" aria-atomic="true">{shownSummary}</p>
          </div>
          <div className="bd-head-actions">
            <Button size="sm" variant="ghost" className="bd-keys-btn" icon={<Keyboard size={15} aria-hidden />} aria-haspopup="dialog" onClick={() => setKeysOpen(true)}>
              {t("shortcuts")}
            </Button>
            <Button size="sm" className="bd-view-btn" icon={mode === "board" ? <Globe2 size={15} aria-hidden /> : <LayoutDashboard size={15} aria-hidden />} onClick={switchView}>
              {switchLabel}
            </Button>
          </div>
        </header>

        <KpiTiles ready={!!resume || !!resumeError} waiting={resume ? total : null} oldest={oldest} runsReady={runsReady}
          running={running} queued={queued.size} runsWaiting={runsWaiting} working={working} idle={idle} daily={daily}
          dailyError={dailyError} week={week} spend={spend.values} paidRuns={spend.paidRuns} now={now} onWaiting={onWaiting}
          onRunning={onRunning} />
        <UsageStrip state={usage} />

        <div className="bd-grid">
          <div className="bd-col bd-col-main">
            <BoardSection id="bd-dec" area="bd-a-dec" title={t("dec_title")} count={resume ? total : null} countTone={total ? "warn" : "muted"}
              link={(EDITION as string) === "free" ? undefined : { to: "/nerede-kalmistim", label: t("dec_all") }} busy={resumeLoading && !!resume} headRef={decHead}>
              <DecisionQueue handle={queue} decisions={decisions} total={total} state={decState} error={resumeError} onRetry={reloadResume}
                agents={agentsAll} daily={daily} fresh={fresh} now={now} />
              {decState === "ready" && start.data && start.Card && <start.Card data={start.data} />}
            </BoardSection>

            {below && <>
            <BoardSection id="bd-live" area="bd-a-live" title={t("live_title")} icon={runsReady && running ? <LiveDot /> : undefined}
              link={{ to: "/gorevler", label: t("live_all") }} headRef={liveHead} busy={!runsReady}>
              <LiveRuns ready={runsReady} runs={split.cards} waiting={runsWaiting} agents={agentsAll} queued={queued}
                onCompose={() => openComposer()} onWaiting={onWaiting} />
            </BoardSection>

            <Suspense fallback={<LowerFallback areas={["bd-a-outs"]} />}>
              <BoardLowerMain resume={resume} resumeError={resumeError} onRetryResume={reloadResume} runAgent={agentOfRun} />
            </Suspense>
            </>}
          </div>

          {below && <div className="bd-col bd-col-side">
            <BoardSection id="bd-agents" area="bd-a-agents" title={t("agents_title")} link={{ to: "/ajanlar", label: t("agents_all") }} busy={!loaded}>
              <AgentsList ready={loaded} rows={agentRows} externals={liveExternals} onPick={pickAgent} onTask={taskFor} onAdd={() => navigate("/ajanlar")} />
            </BoardSection>

            <Suspense fallback={<LowerFallback areas={["bd-a-sched", "bd-a-feed"]} />}>
              <BoardLowerSide schedules={schedules} schedLoaded={schedLoaded} schedError={schedError} schedEnabled={schedEnabled}
                feed={feed} agents={agentsAll} now={now} />
            </Suspense>
          </div>}
        </div>
      </div>
      {keysOpen && <Suspense fallback={null}><ShortcutSheet open onClose={() => setKeysOpen(false)} /></Suspense>}
    </div>
  );
}

/** Alt sıra parçası gelene dek ızgara yerleşimi korunur (başlıksız boş paneller; ekran okuyucuya gizli). */
function LowerFallback({ areas }: { areas: string[] }) {
  return <>{areas.map((a) => <div key={a} aria-hidden className={`panel bd-sec ${a} min-h-24`} />)}</>;
}
