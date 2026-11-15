// DASH-MVP DecisionPreview: karar satırının SALT OKUMA önizlemesi. 2–6
// özellik + açıklama notu. Onay/ret düğmesi YOK; karar her zaman görevin kendi onay adımında verilir (K1 tek onay yolu).
// Tembel yüklenir (Pano parça bütçesi §9).
// PANO-FIX satırın "Karar ver" düğmesi önizlemede tekrar edilmez (aynı hedefe iki ardışık düğme yoktu); bunun
// yerine istenen metin ve araç komutu (eşaralıklı, "Komutu kopyala" ile — geliştirici için gerçek zaman kazancı).
import { Check, Copy, Info } from "lucide-react";
import { useEffect, useState } from "react";
import type { DailyBudgetStatus } from "../../lib/dailyBudget";
import { useT } from "../../lib/i18n";
import type { Agent } from "../../lib/types";
import { boardDetailMsg } from "../../locales/boardDetail";
import type { Decision } from "./decisionModel";
import { metricPair, pct, usd, whyText } from "./boardFormat";

/** Salt okuma önizleme. Onay/ret düğmesi YOK. */
export function DecisionPreview({ d, agent, daily, tab }: { d: Decision; agent?: Agent; daily: DailyBudgetStatus | null; tab: number }) {
  const t = useT(boardDetailMsg);
  const rows: [string, string][] = [];
  if (d.runTitle) rows.push([t("pv_task"), d.stepIndex && d.stepCount ? t("pv_step_of", { title: d.runTitle, a: d.stepIndex, b: d.stepCount }) : d.runTitle]);
  if (d.stepTitle && d.stepTitle !== d.title && d.stepTitle !== d.runTitle) rows.push([t("pv_step"), d.stepTitle]);
  if (d.asked && !d.mono) rows.push([t("pv_asked"), d.asked]);
  if (d.kind === "message") rows.push([t("pv_from"), agent?.name ?? d.agent ?? "—"]);
  else if (agent) rows.push([t("pv_agent"), agent.name]);
  if (d.brain) rows.push([t("pv_brain"), d.brain]);
  if (d.why.key === "budget" || d.why.key === "budget_over") {
    rows.push([t("pv_budget"), `${metricPair(d.why.metric, d.why.used, d.why.cap)} · ${pct(d.why.pct)}`]);
  }
  if (d.kind === "budget" && daily?.effective.cost_usd != null) {
    rows.push([t("pv_today"), t("pv_today_val", { spent: usd(daily.spent.cost_usd ?? 0), cap: usd(daily.effective.cost_usd) })]);
  }
  if (d.kind === "paused" || d.kind === "acceptance") rows.push([d.kind === "acceptance" ? t("pv_checks") : t("pv_reason"), whyText(d.why)]);
  return (
    <>
      {d.mono && <CommandRow command={d.title} tab={tab} />}
      {!!rows.length && <dl>{rows.map(([k, v]) => <div key={k} className="contents"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      <p className="bd-note"><Info size={14} aria-hidden className="shrink-0 mt-px" />{t("dec_preview_note")}</p>
    </>
  );
}

function CommandRow({ command, tab }: { command: string; tab: number }) {
  const t = useT(boardDetailMsg);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const h = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(h);
  }, [copied]);
  const copy = () => {
    void navigator.clipboard?.writeText(command).then(() => setCopied(true), () => undefined);
  };
  return (
    <div className="bd-cmd">
      <span className="t-overline text-muted">{t("pv_command")}</span>
      <code>{command}</code>
      <button type="button" className="btn btn-sm btn-ghost btn-icon" tabIndex={tab} onClick={copy} aria-label={t("pv_copy")} title={t("pv_copy")}>
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
      <span className="sr-only" role="status">{copied ? t("pv_copied") : ""}</span>
    </div>
  );
}
