// STORE-VISUAL — Dünya ilk görünümü için ince, katlanır özet şeridi: bekleyen · çalışan · bugünkü harcama · bu hafta.
// Pano'nun KpiTiles verisini yeniden kullanır; yeni uç yok. Her kutu ilgili
// sayfaya gider. Geniş ekranda sağ sütunun başında durur (3B dünyadan yer almaz); dar ekranda dünyanın üstünde tek sıra.
// Değer bilinmiyorsa "—" (asla yanıltıcı "$0"); sayı sayan animasyon yok.
import clsx from "clsx";
import { Activity, CheckCircle2, ChevronDown, Hourglass, Wallet, type LucideIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { create } from "zustand";
import { EDITION } from "../../edition";
import { usd } from "../board/boardFormat";
import { dailyBudgetApi, type DailyBudgetStatus } from "../../lib/dailyBudget";
import { tp, useT } from "../../lib/i18n";
import { metricsApi } from "../../lib/metrics";
import { registerEventHandler } from "../../lib/store";
import { boardMsg } from "../../locales/board";
import { storeVisualMsg as sv } from "../../locales/storeVisual";

const PREF_KEY = "vc-world-stats";
const readOpen = (): boolean => { try { return localStorage.getItem(PREF_KEY) !== "closed"; } catch { return true; } };

/** Katlanma tercihi: iki yerleşim (dar üst şerit, geniş yan sütun) aynı durumu paylaşır. */
const usePref = create<{ open: boolean; toggle: () => void }>((set, get) => ({
  open: readOpen(),
  toggle: () => {
    const open = !get().open;
    set({ open });
    try { localStorage.setItem(PREF_KEY, open ? "open" : "closed"); } catch { /* depolama kapalı olabilir */ }
  },
}));

// EDITION1: free sürümde "nerede kalmıştım" ve "kazanılan zaman" sayfaları yok; döşemeler panoya gider
const FREE = (EDITION as string) === "free";
export interface WorldStatData { daily: DailyBudgetStatus | null; dailyError: boolean; accepted: number | null; weekFailed: boolean }

/** Bugünkü harcama ve haftalık kabul sayısı (Pano ile aynı uçlar, aynı tazeleme olayları). Bir kez çağır, iki yerleşime ilet. */
export function useWorldStatData(): WorldStatData {
  const [daily, setDaily] = useState<DailyBudgetStatus | null>(null);
  const [dailyError, setDailyError] = useState(false);
  const [week, setWeek] = useState<{ accepted: number | null; failed: boolean }>({ accepted: null, failed: false });
  useEffect(() => {
    const load = () => { dailyBudgetApi.status().then((s) => { setDaily(s); setDailyError(false); }).catch(() => setDailyError(true)); };
    load();
    const offs = [registerEventHandler("budget.", load), registerEventHandler("run.finished", load)];
    const h = window.setInterval(load, 60_000);
    return () => { offs.forEach((off) => off()); window.clearInterval(h); };
  }, []);
  useEffect(() => {
    let live = true;
    const load = () => {
      metricsApi.summary("7d").then((m) => { if (live) setWeek({ accepted: m.accepted, failed: false }); })
        .catch(() => { if (live) setWeek({ accepted: null, failed: true }); });
    };
    load();
    const off = registerEventHandler("acceptance.", load);
    return () => { live = false; off(); };
  }, []);
  return { daily, dailyError, accepted: week.accepted, weekFailed: week.failed };
}

function Tile({ to, icon: Icon, value, label, aria, title, attn }:
  { to: string; icon: LucideIcon; value: string; label: string; aria: string; title?: string; attn?: boolean }) {
  return (
    <Link to={to} aria-label={aria} title={title}
      className={clsx("panel-soft min-w-0 flex flex-col gap-0.5 px-2 py-1.5 xl:flex-row xl:items-center xl:gap-2 xl:px-2.5 hover:border-ink-2 transition-colors",
        attn && "tone-warn")}>
      <span className="flex items-center gap-1.5 min-w-0">
        <Icon size={15} aria-hidden className="shrink-0 max-[419px]:hidden" />
        <span className="font-display font-bold text-base leading-6 num truncate" aria-hidden>{value}</span>
      </span>
      <span className={clsx("text-xs truncate min-w-0", attn ? "" : "text-muted")} aria-hidden>{label}</span>
    </Link>
  );
}

export function WorldStatStrip({ waiting, running, stats, className }:
  { waiting: number | null; running: number; stats: WorldStatData; className?: string }) {
  const t = useT(boardMsg);
  const tv = useT(sv);
  const open = usePref((s) => s.open);
  const toggle = usePref((s) => s.toggle);
  const bodyId = useId();
  const { daily, dailyError, accepted, weekFailed } = stats;
  const capUsd = daily?.effective.cost_usd ?? null;
  const spent = daily?.spent.cost_usd ?? 0;
  const free = !!daily && capUsd == null && !(spent > 0);
  const unknown = tv("ws_unknown");
  const spendValue = daily ? (free ? tv("ws_free") : usd(spent)) : "—";
  const spendNote = daily ? (free ? t("spend_free") : capUsd != null ? t("spend_of", { cap: usd(capUsd) }) : "") : dailyError ? t("cost_unknown") : unknown;
  const waitingText = waiting == null ? unknown : tp(boardMsg, "kpi_waiting_unit", waiting, { n: waiting });
  const weekText = accepted == null ? (weekFailed ? unknown : "…") : tp(boardMsg, "kpi_week_unit", accepted, { n: accepted });
  const go = (label: string, value: string) => tv("ws_go", { label, value });
  const summary = tv("ws_collapsed", { waiting: waiting ?? "—", running });
  return (
    <section aria-label={tv("ws_aria")} className={clsx("flex flex-col gap-1.5 min-w-0", className)}>
      <div className="flex items-center gap-2 min-w-0">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={toggle}
          className="inline-flex items-center gap-1.5 min-h-11 sm:min-h-8 -ml-1 px-1.5 rounded-md text-sm font-semibold text-ink-2 hover:text-ink focus-visible:outline-2">
          <ChevronDown size={15} aria-hidden className={clsx("transition-transform", !open && "-rotate-90")} />
          <span className="t-overline">{tv("ws_title")}</span>
          <span className="sr-only">{open ? tv("ws_hide") : tv("ws_show")}</span>
        </button>
        {!open && <span className="text-xs text-muted truncate num" role="status">{summary}</span>}
      </div>
      <div id={bodyId} hidden={!open} className="grid grid-cols-4 xl:grid-cols-2 gap-2">
        <Tile to={FREE ? "/pano" : "/nerede-kalmistim"} icon={Hourglass} value={waiting == null ? "—" : String(waiting)} label={tv("ws_waiting_short")}
          aria={go(t("kpi_waiting"), waitingText)} attn={!!waiting} />
        <Tile to="/gorevler" icon={Activity} value={String(running)} label={tv("ws_running_short")}
          aria={go(t("kpi_running"), tp(boardMsg, "kpi_running_unit", running, { n: running }))} />
        <Tile to="/gorevler" icon={Wallet} value={spendValue} label={tv("ws_spend_short")} title={spendNote || undefined}
          aria={go(t("kpi_spend"), free ? t("spend_free") : spendValue === "—" ? (spendNote || unknown) : `${spendValue}${spendNote ? `, ${spendNote}` : ""}`)} />
        <Tile to={FREE ? "/pano" : "/kazanilan-zaman"} icon={CheckCircle2} value={accepted == null ? "—" : String(accepted)} label={tv("ws_week_short")}
          aria={go(t("kpi_week"), weekText)} />
      </div>
    </section>
  );
}
