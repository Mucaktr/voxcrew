/**
 * W5 (WALK-W5) — emote çarkı ( G/T, §6.4). Altı düğme bir daire üzerinde; ortada kapat.
 *
 * Klavye: açılınca ilk düğme odakta; ←/→ (↑/↓) çark üzerinde dolaşır, 1–6 doğrudan oynatır, Enter/Boşluk seçer, Esc kapatır ve
 * odağı dünyaya verir. `role="menu"` + `menuitem`; her düğmenin adı ve kısayolu okunur. Simgeler durağandır (hareket yok).
 * Dokunmatikte dünya üzerinde uzun basma ya da HUD'daki emote düğmesi açar. Dokunma hedefleri 56 px.
*/
import clsx from "clsx";
import { Armchair, Hand, Laugh, Lightbulb, Music, PartyPopper, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useT } from "../../../lib/i18n";
import { walk as WM } from "../../../locales/walk";
import { EMOTES, type EmoteKind } from "../../../voxel/walk/emotes";
import { useWalkStore } from "../../../voxel/walk/walkStore";
import { doEmote } from "./emoteActions";

export const EMOTE_ICON: Record<EmoteKind, LucideIcon> = {
  wave: Hand, dance: Music, cheer: PartyPopper, sit: Armchair, laugh: Laugh, think: Lightbulb,
};

const R = 84; // düğme merkezlerinin yarıçapı (px)

export function EmoteWheel({ onFocusWorld }: { onFocusWorld?: () => void }) {
  const t = useT(WM);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => { refs.current[0]?.focus({ preventScroll: true }); }, []);
  // çarkın dışına dokunuş/tık (Şehir menüsü, joystick, başka panel) çarkı kapatır; aç/kapa düğmesi kendi işini yapar
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (box.current?.contains(el) || el?.closest?.("[data-emote-toggle]")) return;
      useWalkStore.getState().setEmoteWheel(false);
    };
    window.addEventListener("pointerdown", on, true);
    return () => window.removeEventListener("pointerdown", on, true);
  }, []);
  const close = () => { useWalkStore.getState().setEmoteWheel(false); onFocusWorld?.(); };
  const play = (i: number) => { useWalkStore.getState().setEmoteWheel(false); doEmote(i); onFocusWorld?.(); };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const idx = refs.current.findIndex((b) => b === document.activeElement);
    const move = (d: number) => { e.preventDefault(); refs.current[(Math.max(0, idx) + d + EMOTES.length) % EMOTES.length]?.focus(); };
    if (e.key === "Escape" || e.key === "g" || e.key === "G" || e.key === "t" || e.key === "T") { e.preventDefault(); close(); }
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(-1);
    else if (/^[1-6]$/.test(e.key)) { e.preventDefault(); play(Number(e.key) - 1); }
    else if (e.key === "Tab") {
      // odak çarkta döner (menü)
      e.preventDefault();
      move(e.shiftKey ? -1 : 1);
    }
    e.stopPropagation();
  };
  return (
    <div className="absolute inset-0 z-30 grid place-items-center pointer-events-none">
      <div ref={box} role="menu" aria-label={t("emote_wheel")} onKeyDown={onKeyDown}
        className="relative pointer-events-auto rounded-full panel !bg-panel/95 shadow-2xl"
        style={{ width: R * 2 + 76, height: R * 2 + 76 }}>
        {EMOTES.map((kind, i) => {
          const Icon = EMOTE_ICON[kind];
          const ang = -Math.PI / 2 + (i / EMOTES.length) * Math.PI * 2;
          const label = t(`emote_${kind}` as const);
          return (
            <button key={kind} ref={(el) => { refs.current[i] = el; }} type="button" role="menuitem"
              aria-keyshortcuts={String(i + 1)} aria-label={t("emote_item_aria", { emote: label, n: i + 1 })} title={label}
              onClick={() => play(i)}
              className={clsx("btn absolute grid place-items-center !p-0 h-14 w-14 rounded-full -translate-x-1/2 -translate-y-1/2",
                "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]")}
              style={{ left: `calc(50% + ${Math.round(Math.cos(ang) * R)}px)`, top: `calc(50% + ${Math.round(Math.sin(ang) * R)}px)` }}>
              <Icon size={20} aria-hidden="true" />
              {/* kısayol numarası dokunmatikte yok*/}
              <span className="absolute -bottom-1 right-0 chip num !px-1 !py-0 text-xs leading-4 pointer-coarse:hidden" aria-hidden="true">{i + 1}</span>
            </button>
          );
        })}
        <button type="button" onClick={close} aria-label={t("emote_close")} title={t("emote_close")}
          className="btn btn-ghost absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-12 w-12 !p-0 grid place-items-center rounded-full">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
