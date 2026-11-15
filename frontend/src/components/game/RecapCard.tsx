// Ekip S35 — haftalık özet kartı (Dünya sayfası): ne bitti, kazanılan XP, haftanın ajanı ve aktif gün notu.
// Kapatılabilir (hafta başına bir kez; sunucuda saklanır). Etkinlik yoksa, oyun kapalıysa ya da odak modunda çizilmez.
// Seri dili yok: aktif gün sayısı övgüyle verilir, kaçırılan günler için uyarı ya da kayıp yoktur.
import { CalendarCheck, Star, Trophy, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { gameApi, useGame, useGameVisible, type RecapData } from "../../lib/game";
import { fmtNumber, tp, useT } from "../../lib/i18n";
import { spotlight as S } from "../../locales/game";
import { FunTrendLine } from "../../full/ui";
import { Button } from "../ui";

export function RecapCard({ className }: { className?: string }) {
  const t = useT(S);
  const visible = useGameVisible();
  const pulse = useGame((s) => s.pulse);
  const [data, setData] = useState<RecapData | null>(null);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    // ilk açılışta hemen, sonra oyun olaylarından 3 sn sonra (olay selinde tek istek)
    const id = window.setTimeout(() => {
      gameApi.recap().then((d) => { if (live) setData(d); }).catch(() => undefined);
    }, pulse ? 3000 : 0);
    return () => { live = false; window.clearTimeout(id); };
  }, [visible, pulse]);
  // S39: yalnızca XP varken (ör. ilk açılışta bir akademi dersi) "0 iş tamamlandı" özeti gösterilmez
  if (!visible || !data || data.dismissed || (!data.shipped && !data.achievements)) return null;
  const dismiss = () => {
    setData({ ...data, dismissed: true });
    gameApi.dismissRecap(data.week).catch(() => undefined);
  };
  const titleId = `ozet-${data.week}`;
  return (
    <section className={`panel p-3 sm:p-4 flex flex-col gap-2 min-w-0 ${className ?? ""}`} aria-labelledby={titleId}>
      <div className="flex items-start gap-2 min-w-0">
        <CalendarCheck size={18} aria-hidden className="text-ok shrink-0 mt-0.5" />
        <h2 id={titleId} className="t-h4 flex-1 min-w-0">{data.current ? t("recap_current") : t("recap_last")}
          <span className="sr-only"> · {t("recap_aria")}</span></h2>
        <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={dismiss} aria-label={t("recap_dismiss")} title={t("recap_dismiss")} className="-mr-1 -mt-1" />
      </div>
      <ul className="flex flex-wrap gap-1.5">
        <li className="chip tone-ok">{tp(S, "recap_shipped", data.shipped)}</li>
        <li className="chip tone-info"><Star size={12} aria-hidden />{t("recap_xp", { n: fmtNumber(data.xp) })}</li>
        {(data.achievements > 0 || data.quests > 0) && (
          <li className="chip tone-muted"><Trophy size={12} aria-hidden />{t("recap_extra", { a: data.achievements, q: data.quests })}</li>
        )}
      </ul>
      {data.titles.length > 0 && (
        <p className="text-sm text-ink-2 min-w-0 break-words line-clamp-2"><span className="font-semibold">{t("recap_titles")}</span> {data.titles.join(" · ")}</p>
      )}
      {data.weekly_pick && (
        <p className="text-sm text-ink-2 min-w-0 break-words">{t("recap_pick", { name: data.weekly_pick.name })}</p>
      )}
      <p className="text-xs text-muted">{t("recap_days", { n: data.active_days })}</p>
      {/* G2-D R-3: kişisel "eğlenceli miydi?" eğilimi (ücretli sürüm; ayar açıkken, yerel) */}
      <FunTrendLine visible={visible} />
      <Link to="/basarilar/kariyer" className="self-start text-sm font-semibold text-link hover:underline underline-offset-2">{t("recap_career")}</Link>
    </section>
  );
}
