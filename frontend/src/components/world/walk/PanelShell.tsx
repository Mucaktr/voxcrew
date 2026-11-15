/**
 * W3 (WALK-UX) — yürüme modu panel kabuğu (§8 "Konuş paneli"): masaüstünde hedefin (ajan ya da nesne) yanına yerleşir,
 * hedef görünmüyorsa sağa yaslanır; dar ekranda (< 640 px) alt sayfa olur (≤ %70 yükseklik). W5: dokunmatikte alt sayfa
 * joystick alanının üstünde biter (joystick ve Etkileşim düğmesi örtülmez).
 *
 * Erişilebilirlik: `role="dialog"`, ad (aria-label), açılınca ilk öğeye odak, Tab/Shift+Tab panel içinde döner (odak tuzağı),
 * Esc paneli kapatır (yürüme modundan çıkmaz; ikinci Esc dünya kabında moddan çıkar). Portal ile açılan pencereler
 * (TaskComposer, GiftDialog) panelin içinde sayılmaz: onların Esc'i onlara kalır.
 * Konum rAF ile doğrudan stile yazılır (React yeniden çizimi yok); hareket azaltmada da geçiş kullanılmaz.
 */
import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { isTypingTarget } from "../../../voxel/walk/input";
import { useWalkStore, walkRuntime } from "../../../voxel/walk/walkStore";
import { fun } from "./funBridge";
import { insetBottom, JOY_ZONE, useCoarse } from "./media";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const PANEL_W = 384; // 24rem
const GAP = 44;

function useNarrow(): boolean {
  const q = "(max-width: 639px)";
  const [on, setOn] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const f = () => setOn(mq.matches);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return on;
}

export interface PanelShellProps {
  label: string;
  title: ReactNode;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  /** başlık satırındaki ek öğeler (Profil bağlantısı vb.) */
  actions?: ReactNode;
}

export function PanelShell({ label, title, closeLabel, onClose, children, actions }: PanelShellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
  // W5: dokunmatikte alt sayfa joystick alanının üstünde biter (joystick ve Etkileşim düğmesi hiçbir zaman örtülmez)
  const coarse = useCoarse();

  // açılınca odak: içeriğin ilk odaklanabilir öğesi (yoksa başlık satırı)
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const b = body.current;
    const first = b?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? b?.querySelector<HTMLElement>(FOCUSABLE)
      ?? el.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el).focus({ preventScroll: true });
  }, []);

  // masaüstü: hedefin yanına yerleş (rAF; yalnızca değişince yaz)
  useEffect(() => {
    if (narrow) return;
    let raf = 0, lastL = -1, lastT = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = ref.current, host = el?.offsetParent as HTMLElement | null;
      if (!el || !host) return;
      const W = host.clientWidth, H = host.clientHeight, h = el.offsetHeight;
      const a = walkRuntime.anchor;
      // UIUX-OVERLAP: üst çubuğun (sarılmış olabilir) altında kal — WalkHud `--walk-top` yazar
      const barB = (parseFloat(host.style.getPropertyValue("--walk-top")) || 56) + 8;
      let left: number, top: number;
      if (a.ok) {
        left = a.x + GAP + PANEL_W <= W - 12 ? a.x + GAP : a.x - GAP - PANEL_W;
        top = a.y - 96;
      } else {
        left = W - PANEL_W - 12;
        top = barB;
      }
      left = Math.round(Math.max(12, Math.min(left, W - PANEL_W - 12)));
      top = Math.round(Math.max(barB, Math.min(top, H - h - 12)));
      if (left !== lastL || top !== lastT) { el.style.left = `${left}px`; el.style.top = `${top}px`; lastL = left; lastT = top; }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [narrow]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || !el.contains(e.target as Node)) return; // portal pencereleri
    if (e.key === "Escape") {
      if (e.defaultPrevented || fun.minigameActive()) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "Tab") {
      const list = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    // panel açıkken F panelin ana eylemine basar (olta yerinde "Oltayı at"); eskiden F panelde yutuluyordu
    if (e.code === "KeyF" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
      const main = body.current?.querySelector<HTMLButtonElement>('.btn-primary:not(:disabled):not([aria-disabled="true"])');
      if (main) { e.preventDefault(); main.click(); }
      else if (!useWalkStore.getState().panel) {
        // ana eylemi olmayan HUD paneli (Hızlı seyahat, pasaport): "F: …" istemi görünür kalır → F dünyaya (istemin eylemi)
        const w = document.querySelector<HTMLElement>("[role=application]");
        if (w) { e.preventDefault(); e.stopPropagation(); w.focus({ preventScroll: true }); w.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, code: e.code, bubbles: true, cancelable: true })); return; }
      }
    }
    // panel içindeki tuşlar dünyaya (yürüme) gitmez
    e.stopPropagation();
  };

  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}
      className={narrow
        ? "absolute inset-x-0 bottom-0 z-30 max-h-[70%] flex flex-col panel !rounded-b-none !rounded-t-2xl shadow-2xl pointer-events-auto"
        : "absolute z-30 w-[24rem] max-h-[calc(100%-var(--walk-top,56px)-1.25rem)] flex flex-col panel !rounded-xl shadow-2xl pointer-events-auto"}
      style={narrow
        // FIX-UX: alt sayfa sabit mobil alt çubuğun üstünde biter (--walk-inset-b, media.ts useBottomInset)
        ? coarse
          ? { bottom: insetBottom(JOY_ZONE), maxHeight: `calc(100% - ${JOY_ZONE} - 4.25rem - var(--walk-inset-b, 0px))` }
          : { bottom: "var(--walk-inset-b, 0px)", paddingBottom: "env(safe-area-inset-bottom)", maxHeight: "calc(70% - var(--walk-inset-b, 0px))" }
        : { left: "auto", right: 12, top: "calc(var(--walk-top, 56px) + 0.5rem)" }}>
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2 border-b border-line min-w-0">
        <div className="min-w-0 flex-1">{title}</div>
        {actions}
        <button type="button" onClick={onClose} aria-label={closeLabel} title={closeLabel}
          className="btn btn-ghost min-h-11 min-w-11 !p-0 grid place-items-center shrink-0">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div ref={body} className="min-h-0 overflow-y-auto px-3 py-2.5">{children}</div>
    </div>
  );
}
