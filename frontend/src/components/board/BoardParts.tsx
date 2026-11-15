// DASH-MVP Pano'nun küçük yapı taşları: BoardSection (bölüm kabuğu + durum makinesi), LiveDot, StepTrack,
// SpendSparkline, Skeleton, gecikmeli iskelet kancası.; NN/g: iskelet
// yalnız ilk yüklemede ve 300 ms gecikmeyle (yanıp sönmesin); tazelemede eski veri kalır.
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../lib/i18n";
import { boardMsg } from "../../locales/board";
import { Button } from "../ui";

export type SectionState = "loading" | "ready" | "empty" | "error";

/** İlk yüklemede iskelet 300 ms sonra görünür; daha hızlı gelen veri hiç yanıp sönmez. */
export function useDelayed(on: boolean, ms = 300): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!on) { setShow(false); return; }
    const h = window.setTimeout(() => setShow(true), ms);
    return () => window.clearTimeout(h);
  }, [on, ms]);
  return show;
}

export function Sk({ w, h, r, className }: { w?: string; h: number; r?: number; className?: string }) {
  return <span aria-hidden className={`bd-sk ${className ?? ""}`} style={{ width: w ?? "100%", height: h, borderRadius: r }} />;
}

/** Bölüm hatası. `name` bölümün ADI ("Kararlar"), başlığı değil. açılışta birden çok bölüm aynı anda
 * düşebilir; her biri `role=alert` olursa okuyucu üç uyarıyı üst üste okur — kibar `status` yeterli (metin aynı).*/
export function SectionError({ name, detail, onRetry }: { name: string; detail?: string | null; onRetry?: () => void }) {
  const t = useT(boardMsg);
  return (
    <div className="bd-err" role="status">
      <span className="chip tone-bad"><AlertTriangle size={13} aria-hidden />{t("section_error", { section: name })}</span>
      {onRetry && <Button size="sm" icon={<RefreshCcw size={14} aria-hidden />} onClick={onRetry}>{t("retry")}</Button>}
      {detail && <details><summary className="cursor-pointer">{t("details")}</summary><code>{detail}</code></details>}
    </div>
  );
}

export function Empty({ icon, tone, title, text, action }: { icon: ReactNode; tone: "ok" | "info" | "muted"; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="bd-empty">
      <span aria-hidden className={`bd-empty-ic tone-${tone}`}>{icon}</span>
      <b>{title}</b>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

/** Bölüm kabuğu: `<section aria-labelledby>` + h2 + isteğe bağlı sayı çipi + sağda bağlantı; gövde durumu dışarıdan. */
export function BoardSection({ id, title, icon, count, countTone = "muted", link, area, busy, children, headRef }: {
  id: string; title: string; icon?: ReactNode; count?: number | null; countTone?: "warn" | "muted"; link?: { to: string; label: string };
  area: string; busy?: boolean; children: ReactNode; headRef?: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <section className={`panel bd-sec ${area}`} aria-labelledby={`${id}-h`} aria-busy={busy || undefined} id={id}>
      <div className="bd-sec-head">
        <h2 id={`${id}-h`} className="panel-title" tabIndex={-1} ref={headRef}>
          {icon}<span className="min-w-0 break-words">{title}</span>
          {count != null && <span className={`chip tone-${countTone} num !font-sans`}>{count}</span>}
        </h2>
        {link && <Link to={link.to} className="bd-link">{link.label}</Link>}
      </div>
      <div className="bd-sec-body">{children}</div>
    </section>
  );
}

/** Canlı noktası: dekoratif (yanında her zaman metin var). */
export function LiveDot() {
  return <span className="bd-live" aria-hidden />;
}

/** Adım şeridi: biten / şimdiki / kalan; dekoratif (aynı bilgi "Adım 3 / 5" metninde). */
export function StepTrack({ done, current, total }: { done: number; current: number; total: number }) {
  const n = Math.min(Math.max(total, 1), 12);
  return (
    <div className="bd-steps" aria-hidden>
      {Array.from({ length: n }, (_, i) => <i key={i} className={i < done ? "is-done" : i === current - 1 ? "is-now" : undefined} />)}
    </div>
  );
}

/** 7 günlük harcama çubukları (bugün tam renk). Ölçeksiz; tüm değerler aria-label'da. hiç harcama yoksa veri
 * varmış gibi eşit çubuklar değil, tek taban çizgisi + metin (`empty`).*/
export function SpendSparkline({ values, label, empty }: { values: number[]; label: string; empty: string }) {
  const max = Math.max(...values, 0);
  if (!(max > 0)) {
    return <span className="bd-spark is-empty" role="img" aria-label={empty}><i aria-hidden /></span>;
  }
  return (
    <span className="bd-spark" role="img" aria-label={label}>
      {values.map((v, i) => (
        <span key={i} className={i === values.length - 1 ? "is-today" : undefined}
          style={{ height: `${max > 0 ? Math.max(8, (v / max) * 100) : 8}%` }} />
      ))}
    </span>
  );
}

/** Pano bağlantı düğmesi (react-router Link + .btn görünümü). */
export function LinkButton({ to, children, primary, small = true, ariaLabel, tabIndex }: {
  to: string; children: ReactNode; primary?: boolean; small?: boolean; ariaLabel?: string; tabIndex?: number;
}) {
  return (
    <Link to={to} aria-label={ariaLabel} tabIndex={tabIndex}
      className={`btn ${small ? "btn-sm" : ""} ${primary ? "btn-primary" : ""}`}>{children}</Link>
  );
}
