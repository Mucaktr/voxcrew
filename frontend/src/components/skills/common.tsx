// Ekip S14: skill bileşenlerinin paylaştığı küçük yardımcılar (kaynak rozeti, uygulanma yolu rozeti, meter).
import clsx from "clsx";
import { AlertTriangle, FileCode2, Lock, Sparkles, Terminal } from "lucide-react";
import type { ReactNode } from "react";
import { fmtNumber, tx, useT } from "../../lib/i18n";
import type { SkillEntry, SkillHow, SkillSource } from "../../lib/skills";
import { skillsMsg as m } from "../../locales/skills";
import { Badge } from "../ui";

export const SOURCE_KEY: Record<SkillSource, "source_voxcrew" | "source_hermes" | "source_claude"> = {
  voxcrew: "source_voxcrew", hermes: "source_hermes", claude: "source_claude",
};
export const SOURCE_TONE: Record<SkillSource, string> = { voxcrew: "ok", hermes: "info", claude: "warn" };

export function sourceLabel(s: SkillSource): string {
  return tx(m, SOURCE_KEY[s]);
}

export function SourceBadge({ source, className }: { source: SkillSource; className?: string }) {
  const t = useT(m);
  const icon = source === "voxcrew" ? <Sparkles size={12} aria-hidden /> : source === "hermes" ? <Terminal size={12} aria-hidden /> : <FileCode2 size={12} aria-hidden />;
  return <Badge tone={SOURCE_TONE[source]} className={className}>{icon}{t(SOURCE_KEY[source])}</Badge>;
}

export function ReadonlyBadge({ readonly }: { readonly: boolean }) {
  const t = useT(m);
  return readonly ? <Badge title={t("readonly")}><Lock size={12} aria-hidden />{t("readonly")}</Badge> : <Badge tone="ok">{t("editable")}</Badge>;
}

/** Uygulanma yolu: -s bayrağı / istem / bulunamadı (+ kırpıldı / yalnızca katalog). */
export function HowBadge({ how, truncated, omitted }: { how: SkillHow; truncated?: boolean; omitted?: boolean }) {
  const t = useT(m);
  if (how === "missing") return <Badge tone="bad" title={t("how_missing_title")}><AlertTriangle size={12} aria-hidden />{t("how_missing_short")}</Badge>;
  if (how === "hermes_flag") return <Badge tone="info" title={t("how_flag_title")}><span className="font-mono">{t("how_flag_short")}</span></Badge>;
  return (
    <>
      <Badge tone="ok" title={t("how_prompt_title")}>{t("how_prompt_short")}</Badge>
      {truncated && <Badge tone="warn">{t("how_truncated_short")}</Badge>}
      {omitted && <Badge tone="warn">{t("how_omitted_short")}</Badge>}
    </>
  );
}

export function TokensBadge({ chars }: { chars: number }) {
  const t = useT(m);
  const n = Math.ceil(chars / 4);
  return <Badge title={t("lib_tokens_title")}>{t("tokens", { n: n >= 1000 ? `${fmtNumber(Math.round(n / 100) / 10)}K` : String(n) })}</Badge>;
}

/** Karakter bütçesi çubuğu (istem bağlamı). */
export function BudgetMeter({ value, max, label }: { value: number; max: number; label: string }) {
  const t = useT(m);
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = value >= max * 0.98;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>{label}</span>
        <span className={clsx("tabular-nums font-semibold", over ? "text-warn" : "text-ink-2")}>
          {t("as_chars", { n: fmtNumber(value), max: fmtNumber(max) })}
        </span>
      </div>
      <div className="h-2 rounded-full bg-panel-3 overflow-hidden" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}>
        <div className={clsx("h-full transition-all", over ? "bg-gold" : pct > 60 ? "bg-gold" : "bg-grass")} style={{ width: `${pct}%` }} />
      </div>
      {over && <span className="text-xs text-warn">{t("as_budget_over")}</span>}
    </div>
  );
}

export function LoadingRow({ label }: { label: string }) {
  return <div className="flex items-center justify-center py-8 text-sm text-muted" role="status">{label}</div>;
}

export function ErrorRow({ error, onRetry }: { error: string; onRetry?: () => void }) {
  const t = useT(m);
  return (
    <div className="rounded-lg border-2 tone-bad p-3 text-sm flex items-start gap-2" role="alert">
      <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
      <span className="flex-1 min-w-0 break-words">{error}</span>
      {onRetry && <button type="button" className="btn btn-sm btn-ghost" onClick={onRetry}>{t("retry")}</button>}
    </div>
  );
}

export function Note({ tone = "info", children, className }: { tone?: "info" | "warn" | "ok" | "bad" | "muted"; children: ReactNode; className?: string }) {
  return <div className={clsx("rounded-lg border-2 px-3 py-2 text-sm text-ink-2 leading-relaxed", `tone-${tone}`, className)}>{children}</div>;
}

/** Hermes kaynağı için profil rozeti vb. */
export function entryHint(e: SkillEntry): string | null {
  if (e.source === "hermes" && e.profiles?.length) return e.profiles.join(", ");
  if (e.source === "claude" && e.scope) return tx(m, e.scope === "project" ? "scope_project" : "scope_user");
  return null;
}
