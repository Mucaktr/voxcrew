// "İlk mesai" kartı ( A1). İlk oturumun sekiz adımını GERÇEK veriden gösterir:
// yaş → bağlantı → İkili ofis → ilk görev → ajanlar çalışır → teslim parşömeni → kabul → ödül (ilk_mesai + görev yuvası).
// Karar 4: `ilk_mesai` ilk kabul edilen teslimde açılır; kart kabul olayında hemen tazelenir, böylece başarım
// bildirimi ve "ödül" adımı birlikte görünür.
// Tanıtım, paket ya da fiyat yok. Kapatılabilir (yalnız bu tarayıcıda hatırlanır); daha önce kabul edilmiş işi olan
// kurulumlarda hiç görünmez.
import clsx from "clsx";
import { Check, Circle, PartyPopper, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../lib/i18n";
import { loopApi, type FirstSession, type FsStepId } from "../../lib/loop";
import { registerEventHandler } from "../../lib/store";
import { loopMsg } from "../../locales/loop";
import { openOnboarding } from "../onboarding/onboarding";
import { Button } from "../ui";

const HIDE_KEY = "voxcrew.firstSession.hidden";
// 4 sn → 15 sn (olaylar zaten anında tazeler; Pano kartıyla aynı aralık)
const POLL_MS = 15_000;

function readHidden(): boolean {
  try { return window.localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; }
}

export function FirstSessionCard({ className }: { className?: string }) {
  const t = useT(loopMsg);
  const [data, setData] = useState<FirstSession | null>(null);
  const [hidden, setHidden] = useState(readHidden);

  useEffect(() => {
    if (hidden) return;
    let live = true;
    let timer = 0;
    // tek yoklama zinciri — istek sürerken gelen olay yeni zincir açmaz (eskiden her olay ayrı bir 4 sn'lik zincir
    // başlatıyor, zincirler birikip saniyede 1–2 istek oluyordu); yanıt gelince bekleyen tazeleme bir kez yapılır
    let busy = false, again = false;
    const load = () => {
      if (busy) { again = true; return; }
      busy = true;
      window.clearTimeout(timer);
      loopApi.firstSession().then((d) => {
        if (!live) return;
        setData(d);
        if (!d.complete) timer = window.setTimeout(load, POLL_MS); // tamamlanınca yoklama durur
      }).catch(() => { if (live) timer = window.setTimeout(load, POLL_MS * 3); })
        .finally(() => { busy = false; if (live && again) { again = false; load(); } });
    };
    load();
    // kabul ya da başarım olayı: yoklamayı beklemeden tazele (ödül adımı bildirimle aynı anda)
    const refresh = () => { load(); };
    const offs = [registerEventHandler("acceptance.", refresh), registerEventHandler("game.achievement", refresh)];
    return () => { live = false; window.clearTimeout(timer); offs.forEach((f) => f()); };
  }, [hidden]);

  if (hidden || !data) return null;
  // daha önce (ilk oturum saatinden önce) kabul edilmiş iş varsa bu bir ilk oturum değildir
  if (data.complete && data.accepted_at != null && data.accepted_at < data.started_at) return null;
  const hide = () => {
    setHidden(true);
    try { window.localStorage.setItem(HIDE_KEY, "1"); } catch { /* depolama kapalı: yalnız bu oturumda gizli */ }
  };
  const done = data.steps.filter((s) => s.done).length;
  const titleId = "first-session-title";
  return (
    <section className={clsx("panel p-3 sm:p-4 flex flex-col gap-3 min-w-0", className)} aria-labelledby={titleId}>
      <div className="flex items-start gap-2 min-w-0">
        {data.complete ? <PartyPopper size={18} aria-hidden className="text-ok shrink-0 mt-0.5" />
          : <Circle size={18} aria-hidden className="text-info shrink-0 mt-0.5" />}
        <h2 id={titleId} className="t-h4 flex-1 min-w-0">{data.complete ? t("fs_done_title") : t("fs_title")}</h2>
        <span className="chip tone-muted num">{t("fs_progress", { done, total: data.steps.length })}</span>
        <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={hide} aria-label={t("fs_hide")} title={t("fs_hide")}
          className="-mr-1 -mt-1" />
      </div>
      <ol className="flex flex-wrap gap-1.5" aria-label={t("fs_region")}>
        {data.steps.map((s) => (
          <li key={s.id} aria-current={s.id === data.current ? "step" : undefined}
            className={clsx("chip !gap-1", s.done ? "tone-ok" : s.id === data.current ? "tone-info" : "tone-muted")}>
            {s.done ? <Check size={12} aria-hidden /> : null}
            <span>{t(`fs_step_${s.id}` as const)}</span>
            <span className="sr-only">{s.done ? " ✓" : ""}</span>
          </li>
        ))}
      </ol>
      {data.complete ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-ink-2 flex-1 min-w-[min(100%,220px)]">
            {t("fs_done_text")}{data.minutes_to_accept != null && <> {t("fs_done_time", { min: data.minutes_to_accept })}</>}
          </p>
          <Link to="/basarilar/gorevler" className="btn btn-sm btn-primary">{t("fs_go_quests")}</Link>
        </div>
      ) : data.current && <NextStep id={data.current} office={data.office} pendingRun={data.pending_run}
        localOnly={data.connection_hint === "local_model"} />}
    </section>
  );
}

function NextStep({ id, office, pendingRun, localOnly }:
  { id: FsStepId; office: string | null; pendingRun: string | null; localOnly?: boolean }) {
  const t = useT(loopMsg);
  const cta = (() => {
    switch (id) {
      case "age":
      case "office":
        return <Button size="sm" variant="primary" onClick={openOnboarding}>{t("fs_cta_wizard")}</Button>;
      case "connection":
        return <Link to="/baglantilar" className="btn btn-sm btn-primary">{t("fs_cta_connect")}</Link>;
      case "task":
        return office?.startsWith("ikili-")
          ? <Link to={`/akislar/${encodeURIComponent(office)}`} className="btn btn-sm btn-primary">{t("fs_cta_flow")}</Link>
          : <Button size="sm" variant="primary" onClick={openOnboarding}>{t("fs_cta_wizard")}</Button>;
      case "accepted":
        return <Link to={pendingRun ? `/gorevler/${encodeURIComponent(pendingRun)}` : "/gorevler"}
          className="btn btn-sm btn-primary">{t("fs_cta_review")}</Link>;
      default:
        return null;
    }
  })();
  return (
    <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
      <p className="text-sm text-ink-2 flex-1 min-w-[min(100%,220px)]">
        {id === "connection" && localOnly ? t("fs_hint_connection_local") : t(`fs_hint_${id}` as const)}</p>
      {cta}
    </div>
  );
}
