// DASH-MVP BudgetMeter: bullet bar (değer + %80 uyarı çentiği + tavan).
// Dolgu `--meter-ok/warn/bad` belirteçlerinden (iz `--track` üzerinde ≥ 3:1, §5.2); değer her zaman metinle de yazılır
// (renk tek başına bilgi taşımaz). Pano'daki KPI ve koşu kartları ile Görevler'deki günlük bütçe aynı metreyi kullanır.
import clsx from "clsx";
import { meterLevel, meterPct } from "./meter";

const FILL = { ok: "var(--meter-ok)", warn: "var(--meter-warn)", bad: "var(--meter-bad)" } as const;

export function BudgetMeter({ ratio, label, labelledBy, valueText, notchTitle, className, size = "md" }: {
  ratio: number; valueText: string; label?: string; labelledBy?: string; notchTitle?: string; className?: string; size?: "sm" | "md";
}) {
  const pct = meterPct(ratio);
  const level = meterLevel(ratio);
  return (
    <div className={clsx("relative rounded-full bg-[var(--track)]", size === "sm" ? "h-1.5" : "h-2", className)} role="progressbar"
      aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={pct} aria-valuetext={valueText} data-level={level}>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: FILL[level] }} />
      {/* %80 uyarı çentiği (Few'un nitel aralığı); dekoratif — eşik metinde ve renkte de var */}
      <span aria-hidden title={notchTitle} className="absolute -top-[3px] -bottom-[3px] left-[80%] w-0.5 -ml-px rounded-[1px] bg-ink-2 opacity-55" />
    </div>
  );
}
