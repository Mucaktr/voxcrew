// Ekip S25 — "Zamanla" düğmesi: hedefi önceden doldurulmuş zamanlama oluşturma penceresini açar. Yeniden kullanılabilir
// (iş akışı / hedef / görev sayfalarına teknik lider bağlar).
import { CalendarClock } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "../../lib/i18n";
import type { Schedule, ScheduleKind } from "../../lib/schedule";
import { scheduleMsg as m } from "../../locales/schedule";
import { Button } from "../ui";
import { ScheduleDialog } from "./ScheduleDialog";

export type ScheduleButtonTarget =
  | { type: "workflow"; workflow: string }
  | { type: "goal"; goal_id: string }
  | { type: "task"; agent: string; prompt: string }
  | { type: "recipe"; recipe: string; trigger_input?: string };

export function ScheduleButton({ target, title, size, variant, onCreated, kind, cron, label }: {
  target: ScheduleButtonTarget;
  /** önerilen zamanlama başlığı */
  title?: string;
  /** CG2: önerilen tür (ör. tarifin tetikleyici önerisi) ve cron */
  kind?: ScheduleKind;
  cron?: string;
  /** düğme metni (varsayılan: "Zamanla") */
  label?: string;
  size?: "sm";
  variant?: "default" | "primary" | "ghost";
  onCreated?: (s: Schedule) => void;
}) {
  const t = useT(m);
  const [open, setOpen] = useState(false);
  const key = JSON.stringify(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prefill = useMemo(() => ({ target, title, kind, cron }), [key, title, kind, cron]);
  return (
    <>
      <Button size={size} variant={variant} icon={<CalendarClock size={size === "sm" ? 14 : 16} />} onClick={() => setOpen(true)}>
        {label ?? t("schedule_this")}
      </Button>
      <ScheduleDialog open={open} onClose={() => setOpen(false)} prefill={prefill} onSaved={onCreated} />
    </>
  );
}
