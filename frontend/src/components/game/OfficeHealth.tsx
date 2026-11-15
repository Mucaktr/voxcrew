// Ofis sağlığı panosu. Gerçek veriden dürüst sinyaller; her sinyalin tek önerilen eylemi var.
// Ajanlar sıralanmaz ve adla karşılaştırılmaz (kullanıcı kararı C-02): yalnız sayılar ve süreler.
import { Activity, AlertTriangle, CheckCircle2, CircleDashed, Eye } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { fmtNumber, useT } from "../../lib/i18n";
import { loopApi, type HealthSignal, type HealthStatus, type OfficeHealthData } from "../../lib/loop";
import { loopMsg } from "../../locales/loop";
import { ERROR_CLASSES, errorClassMsg } from "../../locales/errorClass";
import { Badge, Panel, Spinner } from "../ui";
import { useGameData } from "./useGameData";

const TONE: Record<HealthStatus, string> = { ok: "ok", watch: "warn", act: "bad", none: "muted" };
const ICON: Record<HealthStatus, LucideIcon> = { ok: CheckCircle2, watch: Eye, act: AlertTriangle, none: CircleDashed };

const num = (v: unknown) => (typeof v === "number" ? v : 0);

export function OfficeHealth() {
  const t = useT(loopMsg);
  const { data, error, loading } = useGameData<OfficeHealthData>(() => loopApi.health(), []);
  return (
    <Panel title={t("oh_title")} icon={<Activity size={16} />}
      actions={data && (data.attention
        ? <Badge tone="bad">{t("oh_attention", { n: data.attention })}</Badge>
        : <Badge tone="ok">{t("oh_all_ok")}</Badge>)}>
      {loading && !data ? <div className="grid place-items-center py-8"><Spinner size={20} /></div>
        : error && !data ? <p className="text-sm text-bad" role="alert">{error}</p>
          : data ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-ink-2">{t("oh_intro")}</p>
              <p className="flex items-baseline gap-2">
                <span className="font-display font-semibold text-2xl num">{fmtNumber(data.wad)}</span>
                <span className="text-sm text-ink-2">{t("oh_wad")}</span>
              </p>
              <ul className="grid gap-2 sm:grid-cols-2" aria-label={t("oh_title")}>
                {data.signals.map((s) => <li key={s.id} className="min-w-0"><SignalCard s={s} /></li>)}
              </ul>
            </div>
          ) : null}
    </Panel>
  );
}

/** son penceredeki başarısız/kısmen başarısız koşuların hata sınıfı sayımı (puan ya da ceza yok).*/
function ErrorClassCounts({ counts }: { counts: Record<string, number> }) {
  const e = useT(errorClassMsg);
  const rows = ERROR_CLASSES.filter((c) => num(counts[c]) > 0);
  if (!rows.length) return <p className="text-xs text-muted">{e("ec_health_none")}</p>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={e("ec_health_classes")} data-error-classes="">
      {rows.map((c) => (
        <li key={c}><Badge tone="muted"><span data-error-class={c}>{e(`ec_${c}`)}</span>
          <span className="num font-semibold">{fmtNumber(num(counts[c]))}</span></Badge></li>
      ))}
    </ul>
  );
}

function SignalCard({ s }: { s: HealthSignal }) {
  const t = useT(loopMsg);
  const Icon = ICON[s.status];
  const title = t(`oh_sig_${s.id}` as const);
  const dur = (m: unknown) => (typeof m !== "number" ? "—"
    : m >= 120 ? t("oh_hours", { n: fmtNumber(Math.round(m / 60)) }) : t("oh_min", { n: fmtNumber(Math.round(m)) }));
  let value: string;
  let extra: string | null = null;
  let classes: Record<string, number> | null = null;  // hata sınıfı başına koşu sayısı (yalnız bilgi)
  switch (s.id) {
    case "approvals":
      value = num(s.gates) + num(s.deliveries)
        ? t("oh_v_approvals", { gates: num(s.gates), deliveries: num(s.deliveries), oldest: dur(s.oldest_min) })
        : t("oh_v_approvals_none");
      extra = s.avg_decision_min != null ? t("oh_v_approvals_avg", { avg: dur(s.avg_decision_min) }) : null;
      break;
    case "failures":
      value = t("oh_v_failures", { runs: num(s.runs), failed: num(s.failed), rejected: num(s.rejected) });
      classes = (s.classes && typeof s.classes === "object" ? s.classes : {}) as Record<string, number>;
      break;
    case "stuck":
      value = t("oh_v_stuck", { running: num(s.running), paused: num(s.paused) });
      break;
    case "budget":
      value = num(s.budgeted) ? t("oh_v_budget", { budgeted: num(s.budgeted), near: num(s.near), over: num(s.over) })
        : t("oh_v_budget_none");
      break;
    case "quality":
      value = num(s.total) ? t("oh_v_quality", { passed: num(s.passed), warn: num(s.warn), failed: num(s.failed) })
        : t("oh_v_quality_none");
      break;
    default:
      value = t("oh_v_bench", { active: num(s.active), bench: num(s.bench), idle: num(s.idle) });
  }
  const actionKey = `oh_a_${s.action.key}` as keyof typeof loopMsg.tr;
  const action = actionKey in loopMsg.tr ? t(actionKey) : s.action.key;
  return (
    <article className="panel-soft p-3 h-full flex flex-col gap-1.5 min-w-0" aria-label={title}>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold flex-1 min-w-0">{title}</h3>
        <Badge tone={TONE[s.status]}><Icon size={12} aria-hidden />{t(`oh_status_${s.status}` as const)}</Badge>
      </div>
      <p className="text-sm text-ink-2 break-words">{value}</p>
      {extra && <p className="text-xs text-muted">{extra}</p>}
      {classes && <ErrorClassCounts counts={classes} />}
      <Link to={s.action.to} className="text-sm underline text-link mt-auto self-start">{action}</Link>
    </article>
  );
}
