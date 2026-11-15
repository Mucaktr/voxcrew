// Ekip S50 — "Raporun hazır": koşu teslim edince masaüstü bildirimi (Zil düğmesiyle izin verildiyse; tıklayınca çıktı
// açılır) ve uygulama içi kısa bildirim kutusu (izin yoksa da görünür). Başarısız koşuda "Bir görev dikkat istiyor".
// Yeniden bağlanmada tekrar oynatılan eski olaylar bildirim üretmez. Yan menü rozeti: okunmamış çıktı sayısı.
// (Ç-6): stüdyonun TEK masaüstü bildirim kaynağı budur ve sıklığı kullanıcı seçer (Nerede kalmıştım? ekranı):
//   off → bildirim ve kutu yok (rozet kalır) · immediate → her teslimde (eski davranış) · daily → günde en çok bir özet.
// Günlük özet için arka plan servisi yok: var olan kancalar (açılış, `deliverable.ready`, yeniden bağlanma) yoklar.
import { AlertTriangle, FileCheck2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui";
import { onDeliverableEvent, refreshDeliverableUnread, useDeliverableUnread } from "../../lib/deliverables";
import { tx, useT } from "../../lib/i18n";
import { registerEventHandler } from "../../lib/store";
import { digestTitle, dueDigest, useNotifyPref } from "../../full/data";
import { deliverablesMsg as m } from "../../locales/deliverables";

const FRESH_S = 90;
const TOAST_MS = 9000;

interface Toast { key: string; title: string; body: string; to: string; failed: boolean }

export function DeliverableNotifier() {
  const t = useT(m);
  const navigate = useNavigate();
  const [toast, setToast] = useState<Toast | null>(null);

  const freq = useNotifyPref((s) => s.freq);
  const loaded = useNotifyPref((s) => s.loaded);
  useEffect(() => { refreshDeliverableUnread(); void useNotifyPref.getState().load(); }, []);

  // günlük özet: açılışta, her teslimde ve yeniden bağlanınca "bugün özet gösterildi mi?" denetlenir (en çok 1/gün)
  useEffect(() => {
    if (!loaded || freq !== "daily") return;
    let busy = false;
    const check = () => {
      if (busy) return;
      busy = true;
      dueDigest().then((d) => {
        if (!d) return;
        const title = digestTitle(d.count);
        const body = d.titles.join(" · ");
        desktop(title, body, "/ciktilar");
        setToast({ key: `digest:${d.as_of}`, title, body, to: "/ciktilar", failed: false });
      }).catch(() => undefined).finally(() => { busy = false; });
    };
    check();
    const offA = onDeliverableEvent((ev) => { if (ev.type === "deliverable.ready") window.setTimeout(check, 400); });
    const offB = registerEventHandler("resync.", () => window.setTimeout(check, 600));
    return () => { offA(); offB(); };
  }, [freq, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const desktop = (title: string, body: string, to: string) => {
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        const n = new Notification(title, { body, tag: "voxcrew" });
        n.onclick = () => { window.focus(); navigate(to); n.close(); };
      }
    } catch { /* desteklenmiyor */ }
  };

  useEffect(() => onDeliverableEvent((ev) => {
    if (ev.type !== "deliverable.ready") return;
    if (useNotifyPref.getState().freq !== "immediate") return; // kapalı ya da günlük özet
    const ts = typeof ev.ts === "number" ? ev.ts : Date.now() / 1000;
    if (Date.now() / 1000 - ts > FRESH_S) return; // tekrar oynatılan eski olay
    const failed = ev.status === "failed";
    const runId = String(ev.run_id ?? "");
    const primary = typeof ev.primary === "string" ? ev.primary : "";
    const to = failed ? `/gelen-kutusu/${encodeURIComponent(String(ev.message_id ?? ""))}`
      : primary ? `/ciktilar?d=${encodeURIComponent(primary)}` : `/gorevler/${encodeURIComponent(runId)}`;
    const title = failed ? tx(m, "notify_failed") : tx(m, "notify_ready");
    const body = String(ev.subject ?? ev.title ?? "");
    desktop(title, body, to);
    setToast({ key: `${runId}:${ev.status}:${ts}`, title, body, to, failed });
  }), [navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // UXF-A: kipli pencere (sihirbaz, görev penceresi…) açıkken kutu karartmanın altında kalıp okunmuyordu → pencere
  // kapanana kadar bekletilir (süre de o zaman başlar); masaüstü bildirimi etkilenmez
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!toast) return;
    const check = () => setHeld(modalOpen());
    check();
    const id = window.setInterval(check, 500);
    return () => window.clearInterval(id);
  }, [toast]);
  useEffect(() => {
    if (!toast || held) return;
    const h = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(h);
  }, [toast, held]);

  if (!toast || held) return null;
  return (
    <div role="status" aria-live="polite" key={toast.key}
      className="panel anim-rise fixed z-[45] right-2 left-2 sm:left-auto sm:right-4 sm:w-[22rem] p-3 flex items-start gap-2.5"
      style={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}>
      <span className={toast.failed ? "text-warn shrink-0 mt-0.5" : "text-ok shrink-0 mt-0.5"}>
        {toast.failed ? <AlertTriangle size={18} aria-hidden /> : <FileCheck2 size={18} aria-hidden />}
      </span>
      <div className="min-w-0 flex-1 flex flex-col gap-1.5">
        <span className="font-semibold text-sm">{toast.title}</span>
        {toast.body && <span className="text-xs text-ink-2 break-words line-clamp-2">{toast.body}</span>}
        <div><Button size="sm" variant="primary" onClick={() => { navigate(toast.to); setToast(null); }}>{t("result_open")}</Button></div>
      </div>
      <Button size="sm" variant="ghost" icon={<X size={14} />} aria-label={t("dismiss")} onClick={() => setToast(null)} />
    </div>
  );
}

/** Açık bir kipli pencere var mı (Modal/Drawer/yaş kapısı `aria-modal="true"`; Hoş geldin kartı kipli değildir). */
const modalOpen = (doc: Pick<Document, "querySelector"> | null = typeof document === "undefined" ? null : document): boolean =>
  !!doc?.querySelector('[aria-modal="true"]');

/** Yan menüde "Çıktılar" yanındaki okunmamış sayısı. */
export function DeliverablesBadge() {
  const t = useT(m);
  const count = useDeliverableUnread((s) => s.count);
  if (!count) return null;
  return (
    <span className="ml-auto chip tone-ok !px-1.5 num" title={t("badge_new", { n: count })} aria-label={t("badge_new", { n: count })}>
      {count}
    </span>
  );
}
