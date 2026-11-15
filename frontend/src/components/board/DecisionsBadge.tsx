// DASH-MVP — menüdeki karar sayısı rozeti (lead kararı 4: Pano Görünümünde "Pano" öğesinde, Dünya Görünümünde
// "Nerede kalmıştım?" öğesinde). Sayı Pano'daki karar listesiyle aynı kuraldan gelir (decisionModel). Rozet `tone-warn`
// (--warn-fg / --warn-bg; --attn asla metin zemini değil, §5.2). Ekran okuyucu bağlantı adında sayıyı duyar.
import clsx from "clsx";
import { useMemo } from "react";
import { tp } from "../../lib/i18n";
import { useResumeFeed } from "../../full/data";
import { useLocale } from "../../lib/i18n";
import { viewMsg } from "../../locales/view";
import { buildDecisions, decisionTotal } from "./decisionModel";

const NO_RUNS: never[] = [];

export function useDecisionCount(): number {
  const data = useResumeFeed((s) => s.data);
  return useMemo(() => decisionTotal(data, buildDecisions(data, NO_RUNS).length), [data]);
}

export function DecisionsBadge({ className }: { className?: string }) {
  const n = useDecisionCount();
  useLocale((s) => s.locale);
  if (!n) return null;
  return (
    <>
      <span className={clsx("ml-auto shrink-0 chip tone-warn !px-1.5 num", className)} aria-hidden>{n}</span>
      <span className="sr-only">, {tp(viewMsg, "badge", n)}</span>
    </>
  );
}
