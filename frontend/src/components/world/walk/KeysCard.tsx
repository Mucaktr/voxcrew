/**
 * W5-POLISH ( "? Kısayol kartı") — yürüme modu kısayol kartı.
 * "?" tuşu (dünya kabı odaktayken; input.ts HELP_EVENT) ya da HUD'daki klavye düğmesi açar. 1024 px altında ipucu çipi
 * gizli olduğu için klavye yardımının tek yeri burasıdır; dokunmatikte jestler de listelenir.
 * "I" bilgi kartı satırı; "L" manzara kipi satırı (metinleri `locales/walkInfo.ts`).
 * Erişilebilirlik: `role="dialog"`, açılınca odak Kapat düğmesine gelir, Tab kartın içinde kalır, Esc kapatır ve odağı
 * dünya kabına geri verir. Hareket azaltmada da aynı (animasyon yok).
*/
import { Keyboard, X } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useT } from "../../../lib/i18n";
import { walk as WM } from "../../../locales/walk";
import { walkInfo as WIM } from "../../../locales/walkInfo";

type Key = keyof typeof WM.tr;
const KEYS: [string[], Key][] = [
  [["W A S D", "↑ ← ↓ →"], "k_move"],
  [["Shift"], "k_run"],
  [["Space"], "k_jump"],
  [["F", "Enter"], "k_interact"],
  [["Tab", "Shift+Tab"], "k_tab"],
  [["N"], "k_nearby"],
  [["Q", "E"], "k_rotate"],
  [["R", "C"], "k_pitch"],
  [["V"], "k_view"],
  [["+", "−"], "k_zoom"],
  [["Z"], "k_aerial"], // WALK-ZOOM
  [["G", "T"], "k_emote"],
  [["1–6"], "k_emote_n"],
  [["P"], "k_photo"],
  [["J"], "k_quests"],
  [["U"], "k_stuck"],
  [["Esc"], "k_exit"],
  [["?"], "k_help"],
];
const TOUCH: Key[] = ["k_joy", "k_hand", "k_tap", "k_two", "k_pinch"];

/** `top`: üst çubuğun alt kenarı (bölümün üstünden px; WalkHud ölçer). `hint`: HUD ipucu satırının tam metni (dar bölümde
 *  ipucu satırı gizlidir; burada her genişlikte okunur). */
export function KeysCard({ coarse, top = 68, hint, onClose }: { coarse: boolean; top?: number; hint?: string; onClose: () => void }) {
  const t = useT(WM);
  const ti = useT(WIM);
  const titleId = useId();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus({ preventScroll: true }); }, []);
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" || e.key === "?") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    // odak tuzağı: kartta tek odaklanabilir öğe var (Kapat)
    if (e.key === "Tab") { e.preventDefault(); close.current?.focus(); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKey}
      style={{ top: `calc(${top}px + 0.5rem)`, maxHeight: `calc(100% - ${top}px - 1.25rem)` }}
      className="absolute z-30 left-3 right-3 @xl:left-auto @xl:w-[22rem] overflow-y-auto panel !rounded-xl shadow-lg p-3 pointer-events-auto">
      <div className="flex items-center gap-2 mb-2">
        <Keyboard size={16} aria-hidden="true" className="text-ink-2" />
        <h2 id={titleId} className="font-display font-semibold text-base flex-1">{t("keys_title")}</h2>
        <button ref={close} type="button" className="btn btn-ghost min-h-11 min-w-11 !p-0 grid place-items-center" onClick={onClose}
          aria-label={t("keys_close_aria")} title={t("keys_close_aria")}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {hint && <p className="text-xs text-ink-2 mb-3">{hint}</p>}
      {coarse && (
        <>
          <h3 className="text-xs font-semibold text-ink-2 mb-1">{t("keys_touch")}</h3>
          <ul className="flex flex-col gap-1 mb-3 text-sm">
            {TOUCH.map((k) => <li key={k}>{t(k)}</li>)}
          </ul>
        </>
      )}
      <h3 className="text-xs font-semibold text-ink-2 mb-1">{t("keys_keyboard")}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {KEYS.map(([keys, label]) => (
          <div key={label} className="contents">
            <dt className="flex flex-wrap gap-1">{keys.map((k) => <kbd key={k} className="chip num text-xs !py-0">{k}</kbd>)}</dt>
            <dd className="min-w-0">{t(label)}</dd>
            {label === "k_nearby" && (
              <>
                <dt className="flex flex-wrap gap-1"><kbd className="chip num text-xs !py-0">I</kbd></dt>
                <dd className="min-w-0">{ti("k_info")}</dd>
                <dt className="flex flex-wrap gap-1"><kbd className="chip num text-xs !py-0">L</kbd></dt>
                <dd className="min-w-0">{ti("k_landmark")}</dd>
              </>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}
