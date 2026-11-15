// DASH-MVP dört gösterge kutusu: Seni bekleyen · Çalışan · Bugünkü harcama · Bu hafta.
// §6.3. Sayı sayan animasyon yok; değer bilinmiyorsa "—" ve neden; asla yanıltıcı "$0" (abonelik ve yerel ayrı yazılır).
// Veri: var olan uçlar ve koşu listesi.
// PANO-FIX:
// - "Çalışan" yalnız gerçekten çalışan görevler; kararını bekleyenler alt satırda ("14 görev seni bekliyor").
// - koşu listesi gelmeden "0 görev" denmez (iskelet).
// - ücretli harcama ve tavan yoksa "$0,00" yerine "Ek ücret yok" + bugünkü token; yetim "·" yok.
// - erişilebilir ad görünür başlık + değerden (aria-labelledby), alt satır ve hedef açıklamada (aria-describedby);
//   EN çoğul doğru; "Bu hafta" bilinmezken "0" değil "—" + "yüklenemedi". harcama yoksa taban çizgisi.
// - canlı noktası metniyle birlikte kırılmaz.
import { Check, Clock } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { EDITION } from "../../edition";
import type { DailyBudgetStatus } from "../../lib/dailyBudget";
import { fmtNumber, useT, tp } from "../../lib/i18n";
import { boardMsg } from "../../locales/board";
import { LiveDot, Sk, SpendSparkline, useDelayed } from "./BoardParts";
import { BudgetMeter } from "./BudgetMeter";
import { ageText, clock, pct, usd } from "./boardFormat";

const NBSP = "\u00a0";

export interface WeekData { accepted: number | null; hours: number | null; costUsd: number | null; failed?: boolean }

/** Yer tutucu kutu: gerçek kutunun satır yükseklikleriyle (başlık, değer, çubuk, alt satır) — veri gelince altındaki
 *  ızgara kaymaz (CLS). Işıltılı iskelet çubukları yalnız 300 ms gecikmeden sonra. */
/** "Bu hafta" kutusu: tam sürümde kazanılan-zaman sayfasına bağlantı; ücretsiz sürümde o sayfa yok, düz kutu. */
function WeekTile({ ids, children }: { ids: { t: string; v: string; s: string; go: string }; children: ReactNode }) {
  if ((EDITION as string) === "free") return <div className="panel bd-kpi" role="group" aria-labelledby={`${ids.t} ${ids.v}`} aria-describedby={ids.s}>{children}</div>;
  return <Link to="/kazanilan-zaman" className="panel bd-kpi" aria-labelledby={`${ids.t} ${ids.v}`} aria-describedby={`${ids.s} ${ids.go}`}>{children}</Link>;
}

function KSkel({ bars }: { bars: boolean }) {
  return (
    <div className="panel bd-kpi bd-kpi-ph" aria-hidden>
      <span className="t-overline">{bars ? <Sk w="60%" h={12} /> : NBSP}</span>
      <span className="bd-kval"><span className="t-kpi">{bars ? <Sk w="40%" h={28} /> : NBSP}</span></span>
      <span className="bd-spark" />
      <span className="bd-ksub">{bars ? <Sk w="80%" h={10} /> : NBSP}</span>
    </div>
  );
}

export function KpiTiles({ ready, waiting, oldest, runsReady, running, queued, runsWaiting, working, idle, daily, dailyError, week, spend,
  paidRuns, now, onWaiting, onRunning }: {
  ready: boolean; waiting: number | null; oldest: number | null; runsReady: boolean; running: number; queued: number; runsWaiting: number;
  working: number; idle: number; daily: DailyBudgetStatus | null; dailyError: boolean; week: WeekData | null; spend: number[];
  paidRuns: number; now: number; onWaiting: () => void; onRunning: () => void;
}) {
  const t = useT(boardMsg);
  const id = useId();
  const skel = useDelayed(!ready);
  if (!ready) return <section className="bd-kpis" aria-label={t("kpi_aria")} aria-busy>{[0, 1, 2, 3].map((i) => <KSkel key={i} bars={skel} />)}</section>;
  const capUsd = daily?.effective.cost_usd ?? null;
  const spent = daily?.spent.cost_usd ?? 0;
  const ratio = capUsd ? spent / capUsd : 0;
  const free = !!daily && capUsd == null && !(spent > 0);
  const ids = (k: string) => ({ t: `${id}-${k}-t`, v: `${id}-${k}-v`, s: `${id}-${k}-s`, go: `${id}-${k}-go` });
  const W = ids("w"), R = ids("r"), S = ids("s"), K = ids("k");
  return (
    <section className="bd-kpis" aria-label={t("kpi_aria")}>
      <button type="button" className={`panel bd-kpi ${waiting ? "is-attn" : ""}`} onClick={onWaiting}
        aria-labelledby={`${W.t} ${W.v}`} aria-describedby={`${W.s} ${W.go}`}>
        <span className="t-overline text-muted" id={W.t}>{t("kpi_waiting")}</span>
        <span className="bd-kval" id={W.v}>
          <span className="t-kpi">{waiting ?? "—"}</span>
          {waiting != null && <span className="bd-kunit">{tp(boardMsg, "kpi_waiting_unit", waiting)}</span>}
        </span>
        <span className="bd-ksub" id={W.s}>
          {waiting == null ? <span>{t("waiting_unknown")}</span> : waiting && oldest != null
            ? <span className="bd-nw"><Clock size={14} aria-hidden />{t("kpi_oldest", { age: ageText(now - oldest) })}</span>
            : <span className="bd-nw"><Check size={14} aria-hidden />{t("kpi_all_clear")}</span>}
        </span>
        <span className="sr-only" id={W.go}>{t("kpi_go_list")}</span>
      </button>

      <button type="button" className="panel bd-kpi" onClick={onRunning} aria-labelledby={`${R.t} ${R.v}`} aria-describedby={`${R.s} ${R.go}`}
        aria-busy={!runsReady || undefined}>
        <span className="t-overline text-muted" id={R.t}>{t("kpi_running")}</span>
        {runsReady ? (
          <>
            <span className="bd-kval" id={R.v}>
              <span className="t-kpi">{running}</span>
              <span className="bd-kunit">{tp(boardMsg, "kpi_running_unit", running)}{queued ? ` ${t("kpi_queued", { n: queued })}` : ""}</span>
            </span>
            <span className="bd-ksub" id={R.s}>
              {runsWaiting ? <span className="bd-nw">{tp(boardMsg, "kpi_run_waiting", runsWaiting)}</span>
                : working ? <span className="bd-nw"><LiveDot />{t("kpi_busy", { b: working, i: idle })}</span>
                : <span>{t("kpi_idle_all")}</span>}
            </span>
          </>
        ) : (
          <>
            {/* değerle aynı satır yükseklikleri: gelince düzen kaymaz */}
            <span className="bd-kval" id={R.v}><span className="t-kpi text-muted" aria-hidden>—</span><span className="sr-only">{t("loading")}</span></span>
            <span className="bd-ksub" id={R.s} aria-hidden>{NBSP}</span>
          </>
        )}
        <span className="sr-only" id={R.go}>{t("kpi_go_live")}</span>
      </button>

      <div className="panel bd-kpi">
        <span className="t-overline text-muted" id={S.t}>{t("kpi_spend")}</span>
        {daily && free ? (
          <>
            <span className="bd-kval"><span className="bd-kval-text">{t("spend_free")}</span></span>
            <span className="bd-ksub">
              <span>{daily.spent.tokens > 0 ? t("spend_free_tokens", { n: fmtNumber(Math.round(daily.spent.tokens)) }) : t("spend_free_none")}</span>
            </span>
          </>
        ) : daily ? (
          <>
            <span className="bd-kval">
              <span className="t-kpi">{usd(spent)}</span>
              {capUsd != null && <span className="bd-kunit">{t("spend_of", { cap: usd(capUsd) })}</span>}
            </span>
            {capUsd != null && (
              <BudgetMeter className="bd-meter" ratio={ratio} labelledBy={S.t} notchTitle={t("spend_threshold")}
                valueText={t("spend_aria", { spent: usd(spent), cap: usd(capUsd), pct: pct(ratio * 100) })} />
            )}
            <span className="bd-ksub">
              {capUsd == null && <span className="bd-nw">{t("spend_no_cap")} · <Link to="/gorevler">{t("spend_set")}</Link></span>}
              <span>{t("spend_note", { time: clock(daily.resets_at * 1000) })}</span>
            </span>
          </>
        ) : (
          <>
            <span className="bd-kval"><span className="t-kpi" aria-label={t("cost_unknown")}>—</span></span>
            <span className="bd-ksub">{dailyError ? t("section_error", { section: t("sec_spend") }) : t("cost_unknown")}</span>
          </>
        )}
      </div>

      <WeekTile ids={{ t: K.t, v: K.v, s: K.s, go: K.go }}>
        <span className="t-overline text-muted" id={K.t}>{t("kpi_week")}</span>
        <span className="bd-kval" id={K.v}>
          <span className="t-kpi">{week?.accepted ?? "—"}</span>
          {week?.accepted != null && <span className="bd-kunit">{tp(boardMsg, "kpi_week_unit", week.accepted)}</span>}
        </span>
        <SpendSparkline values={spend} empty={t("spark_empty")}
          label={t("spark_aria", { list: spend.map(usd).join(", "), today: usd(spend[spend.length - 1] ?? 0) })} />
        <span className="bd-ksub" id={K.s}>
          {week?.failed ? t("waiting_unknown") : [
            week?.hours ? t("week_saved", { h: week.hours }) : null,
            week?.costUsd ? t("week_spend", { usd: usd(week.costUsd) }) : paidRuns === 0 ? t("week_free") : null,
          ].filter(Boolean).join(" · ")}
        </span>
        {(EDITION as string) !== "free" && <span className="sr-only" id={K.go}>{t("kpi_go_week")}</span>}
      </WeekTile>
    </section>
  );
}
