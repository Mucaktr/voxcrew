// Ekip S35 — ajan adının yanındaki küçük seviye halkası (listeler ve profil). Oyun kapalı ya da odak modunda çizilmez.
// Halka seviye içi ilerlemeyi gösterir; sayı her zaman metin olarak da vardır (renk tek başına bilgi taşımaz).
import clsx from "clsx";
import { useAgentLevelBadge } from "../../lib/game";
import { useT } from "../../lib/i18n";
import { spotlight as S } from "../../locales/game";

export function LevelRing({ level, progress, size = 22, label, className }:
  { level: number; progress?: number; size?: number; label: string; className?: string }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, progress ?? 0));
  return (
    <span className={clsx("relative inline-grid place-items-center shrink-0", className)} style={{ width: size, height: size }}
      role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 22 22" width={size} height={size} aria-hidden className="absolute inset-0 -rotate-90">
        <circle cx="11" cy="11" r={r} fill="var(--panel)" stroke="var(--line-soft)" strokeWidth="2.5" />
        {progress != null && pct > 0 && <circle cx="11" cy="11" r={r} fill="none" stroke="var(--grass)" strokeWidth="2.5"
          strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} />}
      </svg>
      <span aria-hidden className="relative num font-semibold text-ink leading-none text-xs">{level}</span>
    </span>
  );
}

/** `<AgentLevelChip slug="…" />` — ajan adının yanına; veri yoksa hiçbir şey çizmez. */
export function AgentLevelChip({ slug, size = 22, className }: { slug: string; size?: number; className?: string }) {
  const t = useT(S);
  const lv = useAgentLevelBadge(slug);
  if (!lv) return null;
  return <LevelRing level={lv.level} progress={lv.progress} size={size} className={className}
    label={t("badge_aria", { level: lv.level, title: lv.title })} />;
}
