// Ekip S25 — seçili zamanlamanın ayrıntısı: politika, hedef, son koşular (koşu sayfasına bağlantı), webhook örneği.
import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { fmtDate, useT } from "../../lib/i18n";
import { whenLabel, type Schedule } from "../../lib/schedule";
import { scheduleMsg as m } from "../../locales/schedule";
import { Empty, Panel, StatusPill } from "../ui";
import { LastStatus, TriggerInfo, useTargetLabel } from "./ScheduleRow";
import { TokenReveal } from "./TokenReveal";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-sm min-w-0">
      <dt className="text-ink-2 min-w-[8rem]">{label}</dt>
      <dd className="font-semibold min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function ScheduleDetail({ s }: { s: Schedule }) {
  const t = useT(m);
  const targetLabel = useTargetLabel();
  const fmt = (v?: string | null) => (v ? fmtDate(v, { dateStyle: "medium", timeStyle: "short" }) : "—");
  const budget = s.policy?.budget;
  return (
    <Panel title={s.title} bodyClass="flex flex-col gap-4">
      <dl className="flex flex-col gap-1.5">
        <Row label={t("kind")}>{t(`kind_${s.kind}`)} · {whenLabel(s)}</Row>
        <Row label={t("target")}>{targetLabel(s)}</Row>
        {s.target?.type === "task" && <Row label={t("prompt")}><span className="font-normal whitespace-pre-wrap">{s.target.prompt}</span></Row>}
        <Row label={t("next_run")}>{s.enabled ? fmt(s.next_run_at) : t("disabled")}</Row>
        <Row label={t("last_run")}>{fmt(s.last_run_at)}</Row>
        <Row label={t("last_status")}><LastStatus status={s.last_status} /></Row>
        <Row label={t("approvals")}>{s.policy?.approvals === "deny" ? t("approvals_deny") : t("approvals_pause")}</Row>
        <Row label={t("concurrency")}>{s.policy?.concurrency === "queue" ? t("concurrency_queue") : t("concurrency_skip")}</Row>
        <Row label={t("catch_up")}>{s.policy?.catch_up === "skip" ? t("catch_up_skip") : t("catch_up_once")}</Row>
        {budget && (budget.tokens != null || budget.minutes != null) && (
          <Row label={t("budget")}>
            {[budget.tokens != null ? t("budget_tokens_v", { n: budget.tokens }) : null,
              budget.minutes != null ? t("budget_minutes_v", { n: budget.minutes }) : null].filter(Boolean).join(" · ")}
          </Row>
        )}
      </dl>
      <TriggerInfo s={s} />
      {s.kind === "webhook" && <TokenReveal id={s.id} />}
      <section className="flex flex-col gap-2" aria-label={t("recent_runs")}>
        <h3 className="panel-title">{t("recent_runs")}</h3>
        {s.recent_runs.length === 0 ? (
          <Empty title={t("no_runs")} text={t("no_runs_text")} />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {s.recent_runs.map((r) => (
              <li key={r.id} className="flex items-center gap-2 min-w-0 text-sm">
                <StatusPill status={r.status ?? "pending"} />
                <Link to={`/gorevler/${encodeURIComponent(r.id)}`} className="flex-1 min-w-0 truncate text-link hover:underline">
                  {r.title || r.id}
                </Link>
                <span className="text-xs text-muted shrink-0">{fmt(r.started_at)}</span>
                <ExternalLink size={13} className="text-muted shrink-0" aria-hidden="true" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </Panel>
  );
}
