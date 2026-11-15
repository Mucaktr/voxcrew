// DASH-MVP "Görünüm" anahtarı (Dünya Görünümü / Pano Görünümü) ve geçiş sonrası "Geri al" bildirimi.
// yan menüde Tercihler'in üstünde, dar menüde dikey yığın ve ikonlu; aria-pressed.
// Geçiş sayfayı yenilemez; bildirim 8 sn "Geri al" sunar, Geri al ayarı eski değere yazar (game.focus eşlemesi dahil).
// Her sayfada yüklenir (App kabuğu): Pano sayfası parçasına bağlı değildir, yalnız locales/view.ts kullanır.
import clsx from "clsx";
import { Globe2, LayoutDashboard, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useT } from "../../lib/i18n";
import { useUiMode, type UiMode } from "../../lib/uiMode";
import { viewMsg } from "../../locales/view";

export function ViewSwitch({ className }: { className?: string }) {
  const t = useT(viewMsg);
  const mode = useUiMode((s) => s.mode);
  const saving = useUiMode((s) => s.saving);
  const error = useUiMode((s) => s.error);
  const id = useId();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // görünüm ana sayfanın (`/`) ne göstereceğini seçer; başka sayfadayken geçiş yalnız menü sayılarını değiştirip
  // sayfayı yerinde bırakıyordu. Görünüm gerçekten değişince ana sayfaya gidilir (Pano ya da Dünya hemen görünür).
  const pick = (m: UiMode) => {
    const changed = m !== useUiMode.getState().mode;
    void useUiMode.getState().setMode(m);
    if (changed && pathname !== "/") navigate("/");
  };
  const opts: { value: UiMode; label: string; icon: React.ReactNode }[] = [
    { value: "world", label: t("view_world"), icon: <Globe2 size={15} aria-hidden /> },
    { value: "board", label: t("view_board"), icon: <LayoutDashboard size={15} aria-hidden /> },
  ];
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      {/* kısa ekranda (yan menü sığsın) etiket yalnız ekran okuyucuya */}
      <span id={id} className="text-xs font-medium text-muted [@media(max-height:860px)]:sr-only">{t("view_label")}</span>
      <div className="seg !flex !w-full flex-col" role="group" aria-labelledby={id} aria-busy={saving || undefined}>
        {opts.map((o) => (
          <button key={o.value} type="button" aria-pressed={mode === o.value} onClick={() => pick(o.value)}
            className="!flex items-center gap-2 text-left min-h-8">
            {o.icon}<span className="truncate">{o.label}</span>
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-xs font-semibold text-bad break-words">{t("switch_failed", { error })}</p>}
    </div>
  );
}

/** Geçiş bildirimi: kalıcı role=status kabı (ekran okuyucu ilk işaretlemede görür), 8 sn "Geri al". Odak bildirimin
 *  içindeyken ya da fare üstündeyken kapanmaz (WCAG 2.2.1). */
export function ViewToast() {
  const t = useT(viewMsg);
  const note = useUiMode((s) => s.note);
  const dismiss = useUiMode((s) => s.dismiss);
  const [hold, setHold] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!note || hold) return;
    const h = window.setTimeout(() => { if (useUiMode.getState().note?.id === note.id) dismiss(); }, note.undo ? 4000 : 8000);
    return () => window.clearTimeout(h);
  }, [note, hold, dismiss]);
  const text = !note ? "" : note.undo ? t("undone") : note.to === "world" ? t("switched_world") : t("switched_board");
  return (
    <div className="fixed z-[45] right-3 left-3 sm:left-auto bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:bottom-4 lg:right-4 flex justify-end pointer-events-none"
      role="status" aria-live="polite" aria-atomic="true">
      {note && (
        <div ref={box} onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}
          onFocus={() => setHold(true)} onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) setHold(false); }}
          className="anim-rise pointer-events-auto flex items-center gap-2.5 max-w-[min(420px,100%)] rounded-[10px] bg-ink text-panel pl-3.5 pr-1.5 py-2 text-dense font-medium shadow-[0_6px_20px_rgb(0_0_0/0.18)]">
          <span className="flex-1 min-w-0">{text}</span>
          {!note.undo && (
            <button type="button" className="shrink-0 rounded-md px-2 py-1 min-h-8 font-semibold underline underline-offset-2 hover:bg-panel/15 focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus)]"
              onClick={() => { void useUiMode.getState().setMode(note.from, { undo: true }); }}>
              {t("undo")}
            </button>
          )}
          <button type="button" aria-label={t("close")} onClick={dismiss}
            className="shrink-0 grid place-items-center h-8 w-8 rounded-md hover:bg-panel/15 focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus)]">
            <X size={14} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
