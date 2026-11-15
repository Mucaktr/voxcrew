/**
 * odak görünümü sayfa kancası (WorldPage bağlar). Yürürken ve ayar açıkken:
 * - kök öğeye `data-walk-focus` yazar → `focus.css` sayfa dışı balonları (`[data-focus-hide]`, akademi katmanı) gizler;
 * - lg ve üstünde bölüm pencereyi kapladığı için yan menü (`.shell-aside`) `inert` olur: Tab görünmeyen menüye kaçmaz.
 * Mod kapanınca (ya da sayfa sökülünce) geri alınır; yürümüyorken yan menü ve klavye erişimi aynen kalır;
 * - Esc: dünya kabı dışındaki odakta (HUD düğmeleri, sayfa) da çıkış yolu. Önce bütün işleyiciler çalışır (pencere yakalama
 * aşamasında anlık durum alınır, karar olay bittikten sonra verilir): kim işlediyse (preventDefault) o kazanır; açık kipli
 * pencere, bilgi kartı, şehir pasaportu / hızlı seyahat, yazı alanı ve tarayıcı tam ekranı Esc'yi kendine alır
 * (`focusEscape`). Çıkışta odak dünya kabına döner (World.walkExit).
*/
import { useEffect, useRef } from "react";
import { useCity } from "../../../voxel/citymap/store";
import { isTypingTarget } from "../../../voxel/walk/input";
import { useWalkStore } from "../../../voxel/walk/walkStore";
import { useInfo } from "../walk/info/infoStore";
import { useMedia } from "../walk/media";
import { focusEscape, focusRules, useWalkFocusPref } from "./walkFocus";
import "./focus.css";

export const FOCUS_WIDE_QUERY = "(min-width: 1024px)";

export function useWalkFocus(walkOn: boolean, onExit: () => void): boolean {
  const pref = useWalkFocusPref((s) => s.on);
  const wide = useMedia(FOCUS_WIDE_QUERY);
  const rules = focusRules(walkOn, pref, wide);
  const on = rules.banners;
  const inert = rules.sidebarInert;

  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    root.setAttribute("data-walk-focus", "");
    return () => root.removeAttribute("data-walk-focus");
  }, [on]);

  useEffect(() => {
    if (!inert) return;
    const els = [...document.querySelectorAll<HTMLElement>(".shell-aside")].filter((el) => !el.inert);
    for (const el of els) el.inert = true;
    return () => { for (const el of els) el.inert = false; };
  }, [inert]);

  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  useEffect(() => {
    if (!on) return;
    let timer = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.repeat) return;
      const city = useCity.getState();
      const snap = {
        typing: isTypingTarget(e.target), modalOpen: !!document.querySelector('[aria-modal="true"]'),
        infoOpen: !!useInfo.getState().open, cityOverlay: city.passport || city.fast, fullscreen: !!document.fullscreenElement,
      };
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const w = useWalkStore.getState();
        const act = focusEscape({ key: e.key, repeat: e.repeat, defaultPrevented: e.defaultPrevented, walkActive: w.active, ...snap,
          photo: w.photo, emoteWheel: w.emoteWheel, panel: !!w.panel });
        if (act === "close") w.escape();
        else if (act === "exit") exitRef.current();
      }, 0);
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.clearTimeout(timer); };
  }, [on]);

  return on;
}
