// Ekip S25 — zamanlama satırı: ne zaman, hedef, sonraki çalışma, son durum, aç/kapa, şimdi çalıştır, düzenle, sil.
import clsx from "clsx";
import { Pencil, Play, Trash2 } from "lucide-react";
import { useT, fmtDate } from "../../lib/i18n";
import { LAST_STATUS_TONE, TRIGGER_KINDS, whenLabel, type Schedule } from "../../lib/schedule";
import { triggersMsg } from "../../locales/triggers";
import { useStudio } from "../../lib/store";
import { scheduleMsg as m } from "../../locales/schedule";
import { Badge, Button } from "../ui";

export function useTargetLabel() {
  const t = useT(m);
  const agents = useStudio((s) => s.agents);
  return (s: Schedule): string => {
    const tg = s.target;
    if (!tg) return t("target_none");
    if (tg.type === "task") {
      const name = agents.find((a) => a.slug === tg.agent)?.name ?? tg.agent;
      return t("target_task_label", { agent: name });
    }
    if (tg.type === "workflow") return t("target_workflow_label", { workflow: tg.workflow });
    if (tg.type === "recipe") return t("target_recipe_label", { recipe: tg.recipe });
    return t("target_goal_label", { goal: tg.goal_id });
  };
}

/** CG2: olay tetikleyicisi bilgisi — son tetik, son/sonraki denetim ve son hata. */
export function TriggerInfo({ s, compact }: { s: Schedule; compact?: boolean }) {
  const tt = useT(triggersMsg);
  if (!TRIGGER_KINDS.includes(s.kind)) return null;
  const fmt = (v?: string | null) => (v ? fmtDate(v, { dateStyle: compact ? "short" : "medium", timeStyle: "short" }) : "—");
  return (
    <div className="flex flex-col gap-1 text-xs min-w-0">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-ink-2">
        <span>{tt("last_fired")}: <strong className="text-ink font-semibold">{fmt(s.last_fired_at)}</strong></span>
        <span>{tt("last_check")}: <strong className="text-ink font-semibold">{fmt(s.last_check_at)}</strong></span>
        {s.enabled && <span>{tt("next_check")}: <strong className="text-ink font-semibold">{fmt(s.next_check_at)}</strong></span>}
        {(s.waiting ?? 0) > 0 && <span title={tt("waiting_title")}><strong className="text-warn font-semibold">{tt("waiting", { n: s.waiting ?? 0 })}</strong></span>}
        {s.missed_offline && s.missed_offline.count > 0 && (
          <span title={tt(s.missed_offline.policy === "skip" ? "missed_skip_title" : "missed_once_title", { n: s.missed_offline.count })}>
            <strong className="text-ink font-semibold">{tt("missed_offline", { n: s.missed_offline.count })}</strong>
          </span>
        )}
      </div>
      {s.last_error && (
        <p className="text-bad font-semibold break-words" role="status">{tt("last_error")}: {s.last_error}</p>
      )}
    </div>
  );
}

export function LastStatus({ status }: { status?: string | null }) {
  const t = useT(m);
  if (!status) return <span className="text-xs text-muted">{t("never_ran")}</span>;
  const key = `status_${status}` as keyof typeof m.tr;
  const label = key in m.tr ? t(key) : status;
  return <Badge tone={LAST_STATUS_TONE[status] ?? "muted"}>{label}</Badge>;
}

export function ScheduleRow({ s, selected, busy, onSelect, onToggle, onRun, onEdit, onDelete }: {
  s: Schedule;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT(m);
  const targetLabel = useTargetLabel();
  return (
    <li className={clsx("panel-soft p-3 flex flex-col gap-2 min-w-0", selected && "ring-2 ring-primary")}
      aria-current={selected ? "true" : undefined}>
      <div className="flex items-start gap-2 min-w-0">
        <button type="button" onClick={onSelect} className="flex-1 min-w-0 text-left">
          <span className="block font-semibold truncate">{s.title}</span>
          <span className="block text-xs text-ink-2 truncate">{whenLabel(s)} · {targetLabel(s)}</span>
        </button>
        <button type="button" role="switch" aria-checked={s.enabled} disabled={busy}
          aria-label={t("toggle_named", { title: s.title })}
          onClick={() => onToggle(!s.enabled)}
          className={clsx("relative h-6 w-11 shrink-0 rounded-md border-2 border-line transition-colors disabled:opacity-50",
            s.enabled ? "bg-grass" : "bg-panel-3")}>
          <span className={clsx("absolute top-0.5 h-4 w-4 rounded-[4px] border-2 border-line bg-panel transition-all",
            s.enabled ? "left-[22px]" : "left-0.5")} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        <Badge tone="muted">{t(`kind_${s.kind}`)}</Badge>
        <span className="text-ink-2">
          {t("next_run")}:{" "}
          <strong className="text-ink font-semibold">
            {!s.enabled ? t("disabled") : s.next_run_at ? fmtDate(s.next_run_at, { dateStyle: "medium", timeStyle: "short" })
              : s.kind === "webhook" ? t("on_request") : TRIGGER_KINDS.includes(s.kind) ? t("on_change") : "—"}
          </strong>
        </span>
        <span className="inline-flex items-center gap-1.5 text-ink-2">{t("last_status")}: <LastStatus status={s.last_status} /></span>
      </div>
      <TriggerInfo s={s} compact />
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" icon={<Play size={14} />} disabled={busy} onClick={onRun}>{t("run_now")}</Button>
        <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={onEdit}>{t("edit")}</Button>
        <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} disabled={busy} onClick={onDelete}
          aria-label={t("delete_named", { title: s.title })}>{t("delete")}</Button>
      </div>
    </li>
  );
}
