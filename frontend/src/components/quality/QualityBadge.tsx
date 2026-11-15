// CG-QUALITY — kalite rozeti: "Kalite 8/10 · 2 kaynaksız iddia". `onToggle` verilirse bulgu listesini açan düğmedir
// (aria-expanded); verilmezse durağan rozettir (ör. bir liste düğmesinin içinde — iç içe düğme olmaz).
import { Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Badge } from "../ui";
import { currentLocale, useT } from "../../lib/i18n";
import { badgeText, qualityTone, type QualityBadgeData } from "../../lib/quality";
import { qualityMsg as m } from "../../locales/quality";

export function QualityBadge({ quality, expanded, onToggle, controls }:
  { quality: QualityBadgeData | null | undefined; expanded?: boolean; onToggle?: () => void; controls?: string }) {
  const t = useT(m);
  if (!quality) return null;
  const lang = currentLocale();
  const text = badgeText(quality, lang);
  const tone = qualityTone(quality);
  const running = quality.reviewer === "running";
  const icon = running ? <Loader2 size={12} aria-hidden className="animate-spin motion-reduce:animate-none" />
    : tone === "bad" ? <ShieldAlert size={12} aria-hidden />
    : tone === "warn" ? <ShieldQuestion size={12} aria-hidden /> : <ShieldCheck size={12} aria-hidden />;
  const label = running ? `${text} · ${t("badge_running")}` : text;
  if (!onToggle) {
    return <Badge tone={tone} className="num" title={label}>{icon}{text}</Badge>;
  }
  return (
    <button type="button" onClick={onToggle} aria-expanded={!!expanded} aria-controls={controls}
      aria-label={t("badge_label", { text: label })}
      className={`chip tone-${tone} num cursor-pointer hover:brightness-95 focus-visible:outline-2`}>
      {icon}{text}
    </button>
  );
}
