// FAZB1 — Sistem sağlığı: veritabanı ve WAL boyutu, CDC okuyucu gecikmesi, olay hızı, son hatalar, koşu kuyruğu ve
// kapı benzeri denetimler. Veri /api/health/details'ten (yerel); masaüstü düzeni.
import { Activity, AlertTriangle, CheckCircle2, Database, GitCommitHorizontal, ListChecks, RefreshCw, ScrollText, Settings2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, PageHeader, Panel, Spinner } from "../components/ui";
import { fmtDate, fmtNumber, useT } from "../lib/i18n";
import { configActor, fetchHealth, fmtBytes, invariantText, type HealthDetails } from "../lib/health";
import { healthMsg as m } from "../locales/health";

const REFRESH_MS = 15000;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-soft p-3 flex flex-col gap-0.5 min-w-0">
      <span className="text-xs text-ink-2 font-semibold">{label}</span>
      <span className="font-display text-2xl font-bold num">{value}</span>
    </div>
  );
}

const n = (v: number | null | undefined) => (v == null ? "—" : fmtNumber(v));

export default function HealthPage() {
  const t = useT(m);
  const [data, setData] = useState<HealthDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await fetchHealth()); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    void load();
    const h = window.setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    return () => window.clearInterval(h);
  }, [load]);

  const bad = data?.invariants.filter((i) => !i.ok) ?? [];
  return (
    <div className="p-3 sm:p-5 flex flex-col gap-4 max-w-[1200px] mx-auto">
      <PageHeader title={t("title")} subtitle={t("subtitle")}
        meta={data ? t("updated", { time: fmtDate(data.at * 1000, { timeStyle: "medium" }) }) : undefined}
        actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void load()} disabled={busy}>{t("refresh")}</Button>} />
      {error && <p className="text-sm text-bad" role="alert">{t("load_error", { error })}</p>}
      {!data && !error && <Spinner />}
      {data && (
        <>
          <Panel title={t("checks")} icon={<ListChecks size={16} />}
            actions={bad.length ? <Badge tone="bad">{t("some_bad", { n: bad.length })}</Badge> : <Badge tone="ok">{t("all_good")}</Badge>}>
            <ul className="grid gap-1.5 md:grid-cols-2" aria-label={t("checks")}>
              {data.invariants.map((inv) => (
                <li key={inv.id} className="flex items-start gap-2 text-sm panel-soft px-3 py-2 min-w-0">
                  {inv.ok ? <CheckCircle2 size={16} className="text-ok shrink-0 mt-0.5" aria-label={t("ok")} />
                    : <AlertTriangle size={16} className="text-bad shrink-0 mt-0.5" aria-label={t("failing")} />}
                  <span className="min-w-0 break-words">{invariantText(inv)}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <section className="grid gap-2 grid-cols-4" aria-label={t("events")}>
            <Stat label={`${t("ev_bus")} · ${t("ev_1h")}`} value={n(data.events.bus_last_1h)} />
            <Stat label={`${t("ev_bus")} · ${t("ev_24h")}`} value={n(data.events.bus_last_24h)} />
            <Stat label={`${t("ev_graph")} · ${t("ev_1h")}`} value={n(data.events.graph_changes.last_1h)} />
            <Stat label={`${t("ev_graph")} · ${t("ev_24h")}`} value={n(data.events.graph_changes.last_24h)} />
          </section>
          <p className="text-xs text-muted -mt-2">{t("ev_since_start")}</p>

          <div className="grid gap-4 grid-cols-2">
            <Panel title={t("cdc")} icon={<GitCommitHorizontal size={16} />}>
              <p className="text-xs text-ink-2 mb-2">{t("cdc_hint")}</p>
              {data.cdc.length === 0 ? <p className="text-sm text-muted">{t("cdc_none")}</p> : (
                <ul className="flex flex-col gap-2">
                  {data.cdc.map((c) => (
                    <li key={c.consumer} className="panel-soft px-3 py-2 text-sm flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{c.consumer}</span>
                        <Badge tone={c.lag != null && c.lag > 0 ? "warn" : "ok"}>{t("cdc_lag", { n: n(c.lag) })}</Badge>
                      </div>
                      <span className="text-xs text-ink-2">
                        {t("cdc_done", { n: n(c.processed) })}{c.resyncs ? ` · ${t("cdc_resyncs", { n: n(c.resyncs) })}` : ""}
                      </span>
                      {c.last_error && <span className="text-xs text-bad break-words">{t("cdc_error", { error: c.last_error })}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={t("runs")} icon={<Activity size={16} />}>
              <div className="grid grid-cols-3 gap-2">
                <Stat label={t("runs_live")} value={n(data.runs.live)} />
                <Stat label={t("runs_waiting_human")} value={n(data.runs.awaiting_human)} />
                <Stat label={t("runs_queued")} value={n(data.runs.queued)} />
              </div>
              <ul className="mt-2 text-xs text-ink-2 flex flex-wrap gap-x-4 gap-y-1">
                {Object.entries(data.runs.slots).map(([name, s]) => (
                  <li key={name}>{t("slot", { name, free: n(s.free), waiting: n(s.waiting) })}</li>
                ))}
              </ul>
            </Panel>
          </div>

          <Panel title={t("databases")} icon={<Database size={16} />}
            actions={<span className="text-xs text-ink-2">{t("db_total", { size: fmtBytes(data.total_bytes), free: fmtBytes(data.disk_free_bytes) })}</span>}>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-ink-2">
                <th className="py-1 font-semibold">{t("db_name")}</th>
                <th className="py-1 font-semibold text-right">{t("db_size")}</th>
                <th className="py-1 font-semibold text-right">{t("db_wal")}</th>
              </tr></thead>
              <tbody>
                {data.databases.map((d) => (
                  <tr key={d.name} className="border-t border-line">
                    <td className="py-1 font-mono text-xs">{d.name}</td>
                    <td className="py-1 text-right num">{fmtBytes(d.bytes)}</td>
                    <td className="py-1 text-right num">{fmtBytes(d.wal_bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title={t("errors")} icon={<ScrollText size={16} />}
            actions={<span className="text-xs text-ink-2">{t("errors_hour", { n: n(data.errors.last_1h) })}</span>}>
            {data.errors.recent.length === 0 ? <p className="text-sm text-muted">{t("errors_none")}</p> : (
              <ul className="flex flex-col gap-1 text-xs">
                {data.errors.recent.map((e, i) => (
                  <li key={`${e.ts}-${i}`} className="panel-soft px-3 py-1.5 flex gap-3 min-w-0">
                    <span className="num text-ink-2 shrink-0">{fmtDate(e.ts * 1000, { timeStyle: "medium" })}</span>
                    <span className="font-mono text-ink-2 shrink-0">{e.logger}</span>
                    <span className="break-words min-w-0">{e.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={t("config")} icon={<Settings2 size={16} />}>
            <p className="text-xs text-ink-2 mb-2">{t("config_hint")}</p>
            {!data.config_changes?.length ? <p className="text-sm text-muted">{t("config_none")}</p> : (
              <ul className="flex flex-col gap-1 text-xs" aria-label={t("config")}>
                {data.config_changes.map((c) => (
                  <li key={c.id} className="panel-soft px-3 py-1.5 flex flex-wrap gap-x-3 gap-y-0.5 min-w-0">
                    <span className="num text-ink-2 shrink-0">{fmtDate(c.ts * 1000, { dateStyle: "short", timeStyle: "short" })}</span>
                    <span className="font-mono shrink-0">{c.file}</span>
                    <span className="shrink-0">{t(`config_op_${c.op}` as "config_op_update")}</span>
                    <span className="text-ink-2 shrink-0">{configActor(c.actor)}</span>
                    <span className="font-mono text-ink-2 break-all min-w-0">
                      {c.keys.slice(0, 6).join(", ")}{c.n_keys > 6 ? ` ${t("config_more", { n: c.n_keys - 6 })}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
