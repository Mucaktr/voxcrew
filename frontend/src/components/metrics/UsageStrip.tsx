// ana ekran kullanım şeridi: Maliyet · Token · Ajan süresi · Testler (dört kutu, ince dikey ayraçlar).
// Veri: GET /api/metrics/strip (var olan ölçüm defteri, koşu süreleri ve kalite kapısı raporu; yeni toplama yok).
// Kaynağı olmayan değer "—" + "henüz veri yok" (asla uydurma sıfır); yerel model "Ücretsiz", abonelik "Abonelik".
// Tazeleme: koşu bitince, kalite raporu ya da kabul gelince (mevcut SSE olayları). Sayı sayan animasyon yok.
import clsx from "clsx";
import { useEffect, useState, type ReactNode } from "react";
import { create } from "zustand";
import { currentLocale, tp, useT } from "../../lib/i18n";
import { metricsApi } from "../../lib/metrics";
import { registerEventHandler } from "../../lib/store";
import { fmtAgo, fmtDuration, fmtTokens, fmtUsd, sparkSummary, type StripData } from "../../lib/usageStrip";
import { usageStripMsg as m } from "../../locales/usageStrip";

const PREF_KEY = "vc-usage-window";
type Scope = "7d" | "all";
const readScope = (): Scope => { try { return localStorage.getItem(PREF_KEY) === "all" ? "all" : "7d"; } catch { return "7d"; } };

/** Dönem seçimi: Dünya ve Pano'daki yerleşimler aynı tercihi paylaşır. */
const useScope = create<{ scope: Scope; set: (s: Scope) => void }>((set) => ({
  scope: readScope(),
  set: (scope) => { set({ scope }); try { localStorage.setItem(PREF_KEY, scope); } catch { /* depolama kapalı olabilir */ } },
}));

/** shown: gerçekte gösterilen dönem — son 7 günde tur yoksa şerit kendiliğinden "Tümü"ne geçer (ürün sahibi 2026-11-11).*/
export interface UsageStripState { data: StripData | null; error: boolean; shown?: Scope }

/** Bir kez çağır, yerleşime ilet. */
export function useUsageStrip(): UsageStripState {
  const scope = useScope((s) => s.scope);
  const [st, setSt] = useState<UsageStripState>({ data: null, error: false });
  useEffect(() => {
    let live = true;
    const load = () => {
      metricsApi.strip(scope)
        .then((data) => (scope === "7d" && data.turns === 0
          ? metricsApi.strip("all").then((all) => (all.turns > 0 ? { data: all, shown: "all" as Scope } : { data, shown: scope }))
          : { data, shown: scope }))
        .then(({ data, shown }) => { if (live) setSt({ data, error: false, shown }); })
        .catch(() => { if (live) setSt((p) => ({ data: p.data, error: true })); });
    };
    load();
    const offs = [registerEventHandler("run.finished", load), registerEventHandler("deliverable.quality", load),
      registerEventHandler("acceptance.", load), registerEventHandler("resync.", load)];
    return () => { live = false; offs.forEach((off) => off()); };
  }, [scope]);
  return st;
}

/** Küçük çubuk grafik (satır içi SVG, kitaplık yok): son tur vurgulu. */
function Spark({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(...values, 0);
  if (!(max > 0)) return null;
  const w = 4, gap = 2, h = 18;
  return (
    <svg role="img" aria-label={label} width={values.length * (w + gap) - gap} height={h} className="shrink-0 text-muted mb-1">
      {values.map((v, i) => {
        const bh = Math.max(2, Math.round((v / max) * h));
        return <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={1}
          fill="currentColor" opacity={i === values.length - 1 ? 1 : 0.55} />;
      })}
    </svg>
  );
}

function Cell({ label, value, sub, tone, spark }:
  { label: string; value: string; sub: string; tone?: "ok" | "warn" | "bad"; spark?: ReactNode }) {
  return (
    <div className="bg-[var(--panel)] min-w-0 px-3 py-2 flex flex-col gap-0.5">
      <dt className="text-xs text-muted truncate">{label}</dt>
      <dd className="flex items-end gap-2 min-w-0">
        <span className={clsx("font-display font-bold text-xl leading-7 num truncate",
          tone === "ok" && "text-[var(--ok-fg)]", tone === "warn" && "text-[var(--warn-fg)]", tone === "bad" && "text-[var(--bad-fg)]")}>{value}</span>
        {spark}
      </dd>
      <dd className="text-xs text-muted truncate" title={sub}>{sub}</dd>
    </div>
  );
}

export function UsageStrip({ state, className }: { state: UsageStripState; className?: string }) {
  const t = useT(m);
  const scope = useScope((s) => s.scope);
  const setScope = useScope((s) => s.set);
  const loc = currentLocale();
  const { data, error } = state;
  const shown = state.shown ?? scope;
  const none = t("none"), noData = t("no_data");
  let cells: ReactNode;
  if (!data) {
    cells = [t("cost"), t("tokens"), t("time"), t("tests")].map((l) => <Cell key={l} label={l} value={none} sub={error ? t("error") : "…"} />);
  } else {
    const c = data.cost;
    const free = c.basis === "local", plan = c.basis === "subscription";
    const costValue = c.usd != null ? fmtUsd(c.usd, loc) : free ? t("cost_free") : plan ? t("cost_sub_plan") : none;
    const costSub = c.usd != null
      ? (c.avg_usd != null && c.last_usd != null && c.spark.length > 1 ? t("cost_sub", { last: fmtUsd(c.last_usd, loc), avg: fmtUsd(c.avg_usd, loc) })
        : c.last_usd != null ? t("cost_sub_last", { last: fmtUsd(c.last_usd, loc) }) : noData)
      : free ? t("cost_free_sub") : plan ? t("cost_sub_plan_sub") : noData;
    const tk = data.tokens.total;
    const at = data.agent_time;
    const ts = data.tests;
    const tTone = ts.status === "passed" ? "ok" : ts.status === "warn" ? "warn" : ts.status === "failed" ? "bad" : undefined;
    cells = <>
      <Cell label={t("cost")} value={costValue} sub={costSub}
        spark={c.usd != null && c.spark.length > 1 ? <Spark values={c.spark} label={sparkSummary(c.spark, loc)} /> : undefined} />
      <Cell label={t("tokens")} value={tk != null ? fmtTokens(tk, loc) : none}
        sub={tk != null && data.turns > 0 ? tp(m, "turns", data.turns) : noData} />
      <Cell label={t("time")} value={at.seconds != null ? fmtDuration(at.seconds, loc) : none}
        sub={at.avg_seconds != null ? t("time_sub", { avg: fmtDuration(at.avg_seconds, loc) }) : noData} />
      <Cell label={t("tests")} tone={tTone}
        value={ts.status === "passed" ? t("t_passed") : ts.status === "warn" ? t("t_warn") : ts.status === "failed" ? t("t_failed") : t("t_none")}
        sub={ts.status && ts.at ? t("t_sub", { ago: fmtAgo(Date.now() - ts.at * 1000, loc) }) : t("t_none_sub")} />
    </>;
  }
  return (
    <section aria-label={t("aria")} className={clsx("flex flex-col gap-1 min-w-0", className)}>
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="t-overline text-muted">{t("title")}</span>
        <div role="group" aria-label={t("scope_aria")} className="inline-flex shrink-0 whitespace-nowrap text-xs">
          {(["7d", "all"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={shown === s} onClick={() => setScope(s)}
              className={clsx("min-h-6 px-2 rounded-md focus-visible:outline-2", shown === s ? "font-semibold text-ink underline underline-offset-4" : "text-muted hover:text-ink")}>
              {t(s === "7d" ? "scope_7d" : "scope_all")}
            </button>
          ))}
        </div>
      </div>
      {shown !== scope ? <p className="text-xs text-muted">{t("fell_back")}</p> : null}
      <div className="@container panel overflow-hidden" aria-busy={(!data && !error) || undefined}>
        <dl className="grid grid-cols-2 @[34rem]:grid-cols-4 gap-px bg-[var(--line-soft)]">{cells}</dl>
      </div>
    </section>
  );
}
