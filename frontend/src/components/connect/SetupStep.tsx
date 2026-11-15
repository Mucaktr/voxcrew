// Ekip S11 — numaralı kurulum adımı.
import { Fragment, type ReactNode } from "react";

/** `{ad}` yer tutucularını React düğümleriyle doldurur (kod parçaları, kısayollar). */
export function Rich({ text, parts }: { text: string; parts: Record<string, ReactNode> }) {
  return (
    <>
      {text.split(/(\{\w+\})/g).map((chunk, i) => {
        const key = chunk.match(/^\{(\w+)\}$/)?.[1];
        return <Fragment key={i}>{key && key in parts ? parts[key] : chunk}</Fragment>;
      })}
    </>
  );
}

export function SetupStep({ n, title, badge, hint, children }:
  { n: number; title: ReactNode; badge?: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <section className="flex gap-3 min-w-0">
      <span aria-hidden="true"
        className="h-7 w-7 shrink-0 grid place-items-center rounded-md border-2 border-line-soft bg-panel-2 font-display text-sm font-semibold text-ink-2">
        {n}
      </span>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 min-h-7">
          <h3 className="panel-title">{title}</h3>
          {badge}
        </div>
        {hint && <p className="text-sm text-ink-2 leading-relaxed">{hint}</p>}
        {children}
      </div>
    </section>
  );
}
