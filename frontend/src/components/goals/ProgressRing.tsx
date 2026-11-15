// Ekip S10 — hedef ilerleme halkası (SVG). Renk durumdan gelir; hareket azaltma tercihinde geçiş genel kuralla kapanır.
import type { GoalStatus } from "../../lib/goals";
import { pct } from "../../lib/goals";
import { fmtPercent, useT } from "../../lib/i18n";
import { goalsMsg as m } from "../../locales/goals";

const RING_COLOR: Partial<Record<GoalStatus, string>> = {
  done: "var(--grass)",
  blocked: "var(--red)",
  cancelled: "var(--line-field)",
  draft: "var(--line-field)",
};

export function ProgressRing({ value, status, size = 40, stroke, label, showValue = true }:
  { value: number; status?: GoalStatus; size?: number; stroke?: number; label?: string; showValue?: boolean }) {
  const t = useT(m);
  const p = pct(value);
  const sw = stroke ?? Math.max(4, Math.round(size / 9));
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const color = (status && RING_COLOR[status]) || "var(--sky)";
  const big = size >= 72;
  return (
    <span className="relative inline-grid place-items-center shrink-0" style={{ width: size, height: size }}
      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={label ?? t("ring_label", { pct: p })}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-soft)" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)}
          style={{ transition: "stroke-dashoffset 450ms ease, stroke 200ms ease" }} />
      </svg>
      {showValue && size >= 36 && (
        <span aria-hidden="true"
          className={big ? "absolute t-h3 tabular-nums text-ink" : "absolute text-xs font-semibold tabular-nums text-ink"}>
          {big ? fmtPercent(p) : p}
        </span>
      )}
    </span>
  );
}

/** Anahtar sonuç gibi satır içi ilerleme çubuğu. */
export function ProgressBar({ value, done, label }: { value: number; done?: boolean; label: string }) {
  const p = pct(value);
  return (
    <div className="h-2 w-full rounded-full bg-panel-3 overflow-hidden" role="progressbar" aria-valuemin={0}
      aria-valuemax={100} aria-valuenow={p} aria-label={label}>
      <div className="h-full rounded-full" style={{ width: `${p}%`, background: done ? "var(--grass)" : "var(--sky)",
        transition: "width 400ms ease" }} />
    </div>
  );
}
