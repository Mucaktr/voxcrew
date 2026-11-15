// Paket sayfası (/paket): şu anki paket, koltuk ölçeri, sınır başına kullanım, 3 sütunlu karşılaştırma,
// "Asla kısıtlanmayanlar", kaynaktan derleme notu (K5) ve SSS. Satın alma yok: düğmeler "Yakında".
import { FULL_PLAN_IDS } from "../full/planIds"; // EDITION1: free sürümde geliştirici planı yok
import { Check, Gem, Info, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FullEditionCard } from "../components/world/FullEditionCard"; // EDITION1: free sürümde "Yakında" listesi
import { ExportEverything } from "../components/plan/ExportEverything"; // iptal/düşürmede dışa aktar
import { LimitCardHost } from "../components/plan/LimitCard";
import { SeatRoster } from "../components/plan/SeatRoster";
import { FeaturePacks, MembershipChests } from "../full/ui"; // üyelik sandıkları ve özellik paketleri yalnız tam sürümde
import { Badge, Button, Empty, PageHeader, Panel, Spinner } from "../components/ui";
import { IS_FREE_EDITION } from "../lib/editionUpsell";
import { useT } from "../lib/i18n";
import { planApi, usePlan, wirePlanEvents, type CompareTable, type PlanSnapshot } from "../lib/plan";
import { meterPct } from "../lib/planLimit";
import { plan as m } from "../locales/plan";

type T = ReturnType<typeof useT<typeof m.tr>>;
/** Fiyat/satın alma anahtarları yalnız tam sürümde (full/planIds FULL_PLAN_SALES ile eklenir). */
type SalesKey = "per_month" | "per_year" | "free_price" | "buy_in_account" | "buy_hint" | "account_link" | "coming_soon_hint"
  | "faq_cancel_q" | "faq_cancel_a" | "faq_offline_licence";
const sales = (t: T, k: SalesKey, vars?: Parameters<T>[1]) => t(k as "coming_soon", vars);

function planName(t: T, id: string): string {
  const key = `plan_${id}` as const;
  return ["free", "plus", "pro", "founder", "admin", ...FULL_PLAN_IDS].includes(id) ? t(key as "plan_free") : id;
}

function Meter({ label, used, limit, t }: { label: string; used: number; limit: number | null; t: T }) {
  const pct = meterPct(used, limit);
  const text = limit === null ? `${used} · ${t("unlimited")}` : `${used}/${limit}`;
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-ink-2 truncate">{label}</span>
        <span className="num font-semibold shrink-0">{text}</span>
      </div>
      {pct !== null && <div className="h-2 rounded-full bg-panel-3 overflow-hidden" role="progressbar" aria-label={label}
        aria-valuemin={0} aria-valuemax={limit ?? undefined} aria-valuenow={used} aria-valuetext={text}>
        <div className={`h-full rounded-full ${pct !== null && pct >= 100 ? "bg-gold" : "bg-grass"}`}
          style={{ width: `${pct}%` }} />
      </div>}
    </div>
  );
}

export default function PlanPage() {
  const t = useT(m);
  const snapshot = usePlan((s) => s.snapshot);
  const error = usePlan((s) => s.error);
  const refresh = usePlan((s) => s.refresh);
  const [cmp, setCmp] = useState<CompareTable | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    wirePlanEvents();
    void refresh();
    planApi.compare().then(setCmp).catch(() => undefined);
  }, [refresh]);

  if (!snapshot) {
    return (
      <div className="p-3 sm:p-5 max-w-[1200px] mx-auto">
        <PageHeader title={t("page_title")} subtitle={t(IS_FREE_EDITION ? "page_subtitle_free" : "page_subtitle")} />
        {error ? (
          <Panel><Empty title={t("load_failed")} text={error}
            action={<Button icon={<RefreshCw size={15} />} onClick={() => void refresh()}>{t("retry")}</Button>} /></Panel>
        ) : <div className="flex justify-center p-8"><Spinner size={22} /></div>}
      </div>
    );
  }

  const s: PlanSnapshot = snapshot;
  const sourceText = s.source === "founder" ? t("source_founder", { n: s.founder.seats ?? 0 })
    : t(`source_${s.source}` as "source_default");
  const usageRows: { key: "workflows" | "schedules" | "worlds" | "api_connections"; label: string }[] = [
    { key: "workflows", label: t("usage_workflows") }, { key: "schedules", label: t("usage_schedules") },
    { key: "worlds", label: t("usage_worlds") }, { key: "api_connections", label: t("usage_api_connections") },
  ];
  const hist = s.limits.history_days;

  const setTest = async (value: string | null) => {
    setTestBusy(true);
    setTestError(null);
    try {
      await planApi.setTestPlan(value);
      await refresh();
    } catch (e) {
      setTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setTestBusy(false);
    }
  };

  return (
    <div className="p-3 sm:p-5 flex flex-col gap-4 max-w-[1200px] mx-auto min-w-0">
      <PageHeader title={t("page_title")} subtitle={t(IS_FREE_EDITION ? "page_subtitle_free" : "page_subtitle")}
        meta={<>
          <Badge tone="info"><Gem size={12} aria-hidden />{planName(t, s.plan)}</Badge>
          {s.seats.benched > 0 && <Badge tone="muted">{t("bench_count", { n: s.seats.benched })}</Badge>}
        </>}
        actions={<Button icon={<RefreshCw size={15} />} onClick={() => void refresh()} aria-label={t("retry")} title={t("retry")} />} />

      <LimitCardHost onRoster={() => document.getElementById("kadro")?.scrollIntoView({ behavior: "smooth", block: "start" })} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title={t("current")} icon={<Gem size={16} />}>
          <div className="flex flex-col gap-3">
            <div>
              <div className="font-display text-2xl font-bold">{planName(t, s.plan)}</div>
              <p className="text-sm text-ink-2 mt-0.5">{sourceText}</p>
            </div>
            <Meter t={t} label={t("seats")} used={s.seats.used} limit={s.seats.limit} />
          </div>
        </Panel>
        <Panel title={t("usage_title")}>
          <div className="flex flex-col gap-3">
            {usageRows.map((r) => (
              <Meter key={r.key} t={t} label={r.label} used={s.usage[r.key] ?? 0} limit={s.limits[r.key] ?? null} />
            ))}
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-ink-2">{t("usage_history")}</span>
              <span className="font-semibold">{hist == null ? t("history_all") : t("history_days", { n: hist })}</span>
            </div>
          </div>
        </Panel>
      </div>

      <SeatRoster />

      {cmp && (
        <Panel title={IS_FREE_EDITION ? t("compare_title_free") : t("compare_title")}>
          <div className="grid gap-3 md:grid-cols-3">
            {cmp.plans.map((p) => {
              const mine = p.id === s.base && s.source !== "admin";
              return (
                <article key={p.id} aria-label={planName(t, p.id)}
                  className={`rounded-xl border p-3 flex flex-col gap-2 min-w-0 ${mine ? "border-primary bg-panel-2" : "border-line"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-lg font-bold">{planName(t, p.id)}</h3>
                    {mine && <Badge tone="ok">{t("your_plan")}</Badge>}
                  </div>
                  {!IS_FREE_EDITION && <div className="text-sm">
                    <span className="font-semibold">{p.price_month ? sales(t, "per_month", { price: p.price_month }) : sales(t, "free_price")}</span>
                    {p.price_year > 0 && <span className="text-muted"> · {sales(t, "per_year", { price: p.price_year })}</span>}
                  </div>}
                  <p className="text-sm text-ink-2">{p.tagline}</p>
                  <dl className="text-sm flex flex-col gap-1 mt-1">
                    {cmp.rows.map((r) => (
                      <div key={r.key} className="flex justify-between gap-2 border-t border-line-soft pt-1">
                        <dt className="text-ink-2 min-w-0">{r.label}</dt>
                        <dd className="font-semibold text-right min-w-0 break-words">{r.values[p.id]}</dd>
                      </div>
                    ))}
                  </dl>
                  {p.id !== "free" && !mine && (s.purchase.available ? (
                    // satın alma hesap panelinde (bulut açık); fiyat bu kartta ve ödeme adımında görünür (İ5)
                    <Link to="/hesap" className="btn btn-primary mt-auto"
                      aria-describedby="plan-soon">{sales(t, "buy_in_account", { plan: planName(t, p.id), price: sales(t, "per_month", { price: p.price_month }) })}</Link>
                  ) : (
                    <Button disabled aria-describedby="plan-soon" className="mt-auto">{t("coming_soon")}</Button>
                  ))}
                </article>
              );
            })}
          </div>
          {/* free sürümde tablo yalnız Free'yi gösterir: satın alma notu ve hesap bağlantısı yok */}
          {cmp.plans.length > 1 && <p id="plan-soon" className="text-xs text-muted mt-3 flex items-start gap-1.5"><Info size={13} className="shrink-0 mt-0.5" aria-hidden />
            <span>{s.purchase.available ? sales(t, "buy_hint") : sales(t, "coming_soon_hint")}{" "}
              <Link to="/hesap" className="underline font-semibold">{sales(t, "account_link")}</Link></span></p>}
          {/* TRUST: paket fiyatına model ücreti dahil değil (STRATEGY §4.1 not 1) */}
          <p className="text-xs text-ink-2 mt-1.5 flex items-start gap-1.5"><Info size={13} className="shrink-0 mt-0.5" aria-hidden />
            <span>{t("model_cost_note")} <Link to="/baglantilar?ekle=model" className="underline font-semibold">{t("model_cost_link")}</Link></span></p>
        </Panel>
      )}

      <FullEditionCard />

      {/* 2026-10-19 üyelik: sandıklar (içerik açmadan önce belli) ve özellik paketleri */}
      <MembershipChests />
      {cmp && <FeaturePacks cmp={cmp} snapshot={s} />}
      <ExportEverything />

      {cmp && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={t("never_title")} icon={<ShieldCheck size={16} />}>
            <ul className="flex flex-col gap-1.5 text-sm">
              {cmp.never_gated.map((x) => (
                <li key={x} className="flex items-start gap-2"><Check size={15} className="text-ok shrink-0 mt-0.5" aria-hidden />{x}</li>
              ))}
            </ul>
          </Panel>
          <Panel title={t("source_note_title")}>
            <p className="text-sm text-ink-2">{cmp.source_note}</p>
          </Panel>
        </div>
      )}

      <Panel title={t("faq_title")}>
        <div className="flex flex-col gap-2">
          {/* free sürümde bırakılacak paket yok: "paketi bırakırsam" sorusu ve lisans notu yalnız tam sürümde */}
          {(IS_FREE_EDITION ? ["offline", "privacy"] as const : ["cancel", "offline", "privacy"] as const).map((k) => (
            <details key={k} className="rounded-lg border border-line-soft px-3 py-2">
              <summary className="font-semibold text-sm cursor-pointer">{k === "cancel" ? sales(t, "faq_cancel_q") : t(`faq_${k}_q`)}</summary>
              <p className="text-sm text-ink-2 mt-1">{k === "cancel" ? sales(t, "faq_cancel_a")
                : k === "offline" && !IS_FREE_EDITION ? `${t("faq_offline_a")} ${sales(t, "faq_offline_licence")}` : t(`faq_${k}_a`)}</p>
            </details>
          ))}
        </div>
      </Panel>

      {s.test_plan.available && (
        <Panel title={t("test_title")}>
          <div className="flex flex-col gap-2">
            <p className="text-xs text-ink-2">{s.admin.active ? t("test_hint") : t("test_need_admin")}</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("test_title")}>
              {[null, ...s.test_plan.options].map((o) => (
                <Button key={o ?? "none"} size="sm" variant={s.test_plan.value === o ? "primary" : "default"}
                  aria-pressed={s.test_plan.value === o} disabled={!s.admin.active || testBusy}
                  onClick={() => void setTest(o)}>
                  {o === null ? t("test_none") : planName(t, o)}
                </Button>
              ))}
            </div>
            {testError && <p className="text-sm text-bad" role="alert">{testError}</p>}
            <details className="text-xs text-ink-2">
              <summary className="cursor-pointer font-semibold">{t("checkpoints_title")}</summary>
              <ul className="mt-1 flex flex-col gap-1">
                {s.checkpoints.map((c) => (
                  <li key={c.id} className="flex flex-wrap gap-x-2">
                    <span className="font-semibold">{c.id} · {c.feature}</span>
                    <Badge tone={c.enforced ? "ok" : "muted"}>{c.enforced ? t("enforced") : t("declared")}</Badge>
                    <span className="text-muted">{c.note}</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </Panel>
      )}
    </div>
  );
}
