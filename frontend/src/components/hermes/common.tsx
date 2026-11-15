// Ekip S1: Hermes sayfası ve ajan yetenek sekmesinin paylaştığı küçük yardımcı bileşenler.
import clsx from "clsx";
import { AlertTriangle, Archive, Ban, Clock3, MonitorX, Pin, RefreshCcw } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { HermesProfile, SkillInfo } from "../../lib/hermes";
import { fmtNumber, useT } from "../../lib/i18n";
import { hermesMsg as m } from "../../locales/hermes";
import { Badge, Button, Modal, Spinner } from "../ui";

/** Basit veri yükleme kancası: { data, error, loading, reload }. deps değişince yeniden yükler. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    run()
      .then((d) => { if (id === seq.current) setData(d); })
      .catch((e) => { if (id === seq.current) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (id === seq.current) setLoading(false); });
  }, [run]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export function LoadingBlock({ label }: { label?: string }) {
  const t = useT(m);
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted" role="status">
      <Spinner /> {label ?? t("loading")}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  const t = useT(m);
  return (
    <div className="rounded-lg border-2 tone-bad p-3 text-sm flex items-start gap-2" role="alert">
      <AlertTriangle size={16} className="shrink-0 mt-0.5" />
      <span className="flex-1 min-w-0 break-words">{error}</span>
      {onRetry && <Button size="sm" variant="ghost" icon={<RefreshCcw size={14} />} onClick={onRetry}>{t("retry")}</Button>}
    </div>
  );
}

export function Note({ tone = "info", icon, children, className }: { tone?: "info" | "warn" | "ok" | "bad" | "muted"; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={clsx("rounded-lg border-2 px-3 py-2 text-sm flex items-start gap-2", `tone-${tone}`, className)}>
      {icon && <span className="shrink-0 mt-0.5">{icon}</span>}
      <div className="min-w-0 text-ink-2 leading-relaxed">{children}</div>
    </div>
  );
}

/** Karakter sınırı göstergesi (MEMORY.md 2200 / USER.md 1375 vb.). */
export function CharMeter({ value, limit, label }: { value: number; limit: number; label?: string }) {
  const t = useT(m);
  const pct = limit > 0 ? Math.min(100, (value / limit) * 100) : 0;
  const over = value > limit;
  const tone = over ? "bg-red" : pct > 85 ? "bg-gold" : "bg-grass";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{label ?? t("chars")}</span>
        <span className={clsx("tabular-nums font-semibold", over ? "text-bad" : "text-ink-2")}>
          {fmtNumber(value)} / {fmtNumber(limit)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-panel-3 overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={value}
        aria-label={label ?? t("char_limit")}>
        <div className={clsx("h-full transition-all", tone)} style={{ width: `${pct}%` }} />
      </div>
      {over && <span className="text-xs text-bad">{t("over_limit")}</span>}
    </div>
  );
}

export function ProfileSelect({ profiles, value, onChange, id }: { profiles: HermesProfile[]; value: string; onChange: (p: string) => void; id?: string }) {
  const t = useT(m);
  return (
    <select id={id} className="select !w-auto min-w-[10rem]" value={value} onChange={(e) => onChange(e.target.value)} aria-label={t("profile_select_aria")}>
      {profiles.map((p) => (
        <option key={p.name} value={p.name}>{t("profile_option", { name: p.name })}{p.model ? ` · ${p.model}` : ""}</option>
      ))}
    </select>
  );
}

/** Skill durum rozetleri: aktif/eskimiş/arşiv, platform dışı, devre dışı, ortam koşulu. */
export function SkillStateBadges({ skill, compact }: { skill: SkillInfo; compact?: boolean }) {
  const t = useT(m);
  const out: ReactNode[] = [];
  if (!skill.platform_ok) out.push(<Badge key="p" tone="muted" title={`platforms: ${skill.platforms.join(", ")}`}><MonitorX size={12} />{t("st_off_platform")}</Badge>);
  if (skill.disabled) out.push(<Badge key="d" tone="bad" title="config.yaml → skills.disabled"><Ban size={12} />{t("st_disabled")}</Badge>);
  if (skill.state === "archived") out.push(<Badge key="a" tone="muted"><Archive size={12} />{t("st_archived")}</Badge>);
  else if (skill.state === "stale") out.push(<Badge key="s" tone="warn" title={t("st_stale_title")}><Clock3 size={12} />{t("st_stale")}</Badge>);
  else if (!compact && skill.loadable) out.push(<Badge key="ok" tone="ok">{t("st_active")}</Badge>);
  if (skill.pinned) out.push(<Badge key="pin" tone="info"><Pin size={12} />{t("st_pinned")}</Badge>);
  if (skill.platform_ok && !skill.env_ok) out.push(<Badge key="e" tone="warn" title={t("st_env_title")}>{t("st_env", { envs: skill.environments.join(", ") })}</Badge>);
  return <>{out}</>;
}

export function AgentChips({ agents, onOpen, empty }: { agents: { slug: string; name: string; color?: string }[]; onOpen?: (slug: string) => void; empty?: ReactNode }) {
  const t = useT(m);
  if (!agents.length) return <span className="text-sm text-muted">{empty ?? t("no_agents_yet")}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {agents.map((a) => (
        <button key={a.slug} type="button" onClick={() => onOpen?.(a.slug)} disabled={!onOpen}
          className="chip hover:border-ink-2 disabled:cursor-default" title={onOpen ? t("open_agent", { name: a.name }) : undefined}>
          <span className="h-2.5 w-2.5 rounded-full border border-line" style={{ background: a.color ?? "var(--muted)" }} />
          {a.name}
        </button>
      ))}
    </div>
  );
}

export function ConfirmDialog({ open, title, children, confirmLabel, danger, busy, disabled, onConfirm, onClose }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; disabled?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  const t = useT(m);
  return (
    <Modal open={open} onClose={onClose} title={title} width={560}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button variant={danger ? "danger" : "primary"} disabled={busy || disabled} onClick={onConfirm}
          icon={busy ? <Spinner size={14} /> : undefined}>{busy ? t("working") : confirmLabel}</Button>
      </>}>
      <div className="flex flex-col gap-3 text-sm text-ink-2 leading-relaxed">{children}</div>
    </Modal>
  );
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <h3 className="panel-title flex-1 min-w-0">{children}</h3>
      {actions}
    </div>
  );
}

/** Çeviri şablonundaki {ad} yer tutucularını React düğümleriyle doldurur (kalın, kod, italik parçalar için). */
export function Rich({ text, parts }: { text: string; parts: Record<string, ReactNode> }) {
  return (
    <>
      {text.split(/(\{\w+\})/g).map((seg, i) => {
        const k = /^\{(\w+)\}$/.exec(seg)?.[1];
        return <Fragment key={i}>{k && k in parts ? parts[k] : seg}</Fragment>;
      })}
    </>
  );
}
