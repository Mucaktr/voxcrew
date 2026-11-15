/**
 * W4 (WALK-GAME-UI) — "Haftanın çalışanı" rozeti (`haftanin_secimi` başarımı ve `weekly_pick`
 * akış kaydı): bu haftanın seçimi bu ajansa küçük bir çip. Seçim yalnızca kullanıcınındır; puan ve sıralama yok.
 * Haftalık seçim sayfa başına bir kez okunur (kart başına istek yok).
*/
import clsx from "clsx";
import { Award } from "lucide-react";
import { useEffect } from "react";
import { useT } from "../../../lib/i18n";
import { useRecognition } from "../../../full/more";
import { walk as WM } from "../../../locales/walk";

let asked = false;
export function WeeklyPickBadge({ slug, className }: { slug: string; className?: string }) {
  const t = useT(WM);
  const on = useRecognition((s) => !!slug && s.weekly?.agent === slug);
  useEffect(() => {
    if (asked || useRecognition.getState().weeklyLoaded) return;
    asked = true;
    void useRecognition.getState().loadWeekly();
  }, []);
  if (!on) return null;
  return (
    <span className={clsx("chip tone-warn text-xs", className)} title={t("weekly_badge")}>
      <Award size={12} aria-hidden="true" />{t("weekly_badge")}
    </span>
  );
}
