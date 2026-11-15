/** W5: yürüme HUD'unun ortak ortam sorguları (dokunmatik, dar ekran). Değişince yeniden çizilir; SSR'de false. */
import { useEffect, useState } from "react";

export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const f = () => setOn(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [query]);
  return on;
}

/** `pointer: coarse` — joystick, Etkileşim ve emote düğmeleri yalnızca burada. */
export const useCoarse = () => useMedia("(pointer: coarse)");

/** yatay telefon — kısa görünüm. Yürürken dünya bölümü pencereyi kaplar (WorldPage `short:`), HUD sıkışık
 * düzende: dokunmatik eylem kümesi tek satır, alt satır joystick alanının üstünde biter. index.css `short` varyantıyla aynı sorgu.*/
export const SHORT_MQ = "(max-height: 480px) and (orientation: landscape)";
export const useShort = () => useMedia(SHORT_MQ);

/** Joystick alanının yüksekliği (alt kenardan; taban 88 px + 12 px boşluk): alt sayfalar bunun üstünde biter. */
export const JOY_ZONE = "6.5rem";

/**
 * FIX-UX (A11): dünya bölümünün alt kenarını örten şeyin yüksekliği (px) — sabit mobil alt çubuk
 * (`[data-mobile-nav]`, App.tsx; kendi safe-area dolgusu dahil) ya da görünür alanın altı. HUD'un alttaki öğeleri
 * (joystick, Etkileşim, alt sayfa, ipucu, fotoğraf araç çubuğu) `--walk-inset-b` kadar yukarı kayar.
 * Saf hesap: test edilebilir. `hostBottom`/`hostHeight` dünya bölümünün, `navTop` alt çubuğun (yoksa null) ekran konumu.
*/
export function bottomInset(hostBottom: number, hostHeight: number, viewportH: number, navTop: number | null): number {
  const floor = Math.min(viewportH, navTop ?? Infinity);
  const over = Math.max(0, hostBottom - floor);
  // HUD bölümün içinde kalsın: üstte en az ~220 px (Çık satırı + joystick) bırak
  return Math.round(Math.min(over, Math.max(0, hostHeight - 220)));
}

/** `--walk-inset-b` değişkenini dünya bölümüne yazar (kaydırma, boyut, alt çubuk değişince); söküldüğünde siler. */
export function useBottomInset(host: { current: HTMLElement | null } | undefined): void {
  useEffect(() => {
    const el = host?.current;
    if (!el || typeof window === "undefined") return;
    let last = -1, raf = 0;
    const measure = () => {
      raf = 0;
      // sabit öğede offsetParent hep null: görünürlük display ile (lg ve üstünde alt çubuk gizli)
      const nav = document.querySelector<HTMLElement>("[data-mobile-nav]");
      // "pencereye sığdır" / tam ekranda bölüm (z-35) alt çubuğun (z-30) üstündedir: örtme yok
      const above = getComputedStyle(el).position === "fixed";
      const nr = nav && !above && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect() : null;
      const r = el.getBoundingClientRect();
      const px = bottomInset(r.bottom, r.height, window.innerHeight, nr && nr.height > 0 ? nr.top : null);
      if (px !== last) { last = px; el.style.setProperty("--walk-inset-b", `${px}px`); }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("resize", schedule, { passive: true });
    document.addEventListener("scroll", schedule, { passive: true, capture: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(el);
    const nav = document.querySelector<HTMLElement>("[data-mobile-nav]");
    if (nav) ro?.observe(nav);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, { capture: true });
      ro?.disconnect();
      el.style.removeProperty("--walk-inset-b");
    };
  }, [host]);
}

/** Alttaki HUD öğelerinin `bottom` değeri: örten çubuk (yoksa safe-area) + boşluk. */
export const insetBottom = (gap: string) => `calc(max(var(--walk-inset-b, 0px), env(safe-area-inset-bottom)) + ${gap})`;

/**
 * W5-POLISH (QA önerisi a): dar ekranda yürüme moduna girince sayfa, dünya bölümü görünür alana (alt çubuğun üstüne)
 * oturacak kadar kaydırılır; bölüm alandan uzunsa üst kenarı hizalanır. Anında (kayma animasyonu yok; hareket azaltmaya uygun).
 * Saf hesap: kaydırılacak px (eksi = yukarı). `top`/`bottom` bölümün ekran konumu, `floor` örtülmeyen alanın alt sınırı.
*/
export function revealDelta(top: number, bottom: number, floor: number, margin = 8): number {
  if (bottom + margin <= floor && top >= 0) return 0;
  const toBottom = bottom + margin - floor;
  // bölüm sığmıyorsa üst kenarı görünür kalsın
  return top - toBottom < margin ? Math.max(0, top - margin) : toBottom;
}

export function useRevealOnEnter(host: { current: HTMLElement | null } | undefined): void {
  useEffect(() => {
    const el = host?.current;
    // UIUX-OVERLAP: lg altında yürürken bölüm büyür (WorldPage); orta genişlikte de kaydırılır
    if (!el || typeof window === "undefined" || window.innerWidth >= 1024) return;
    const reveal = () => {
      if (getComputedStyle(el).position === "fixed") return; // yatay telefonda bölüm pencereyi kaplar, kaydırılacak yer yok
      const nav = document.querySelector<HTMLElement>("[data-mobile-nav]");
      const nr = nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect() : null;
      const r = el.getBoundingClientRect();
      // UIUX-OVERLAP: sayfa `<main>` içinde kayar (pencere değil) — en yakın kaydırılabilir ata kaydırılır; hesap onun
      // görünür üst kenarına göredir (mobil üst çubuk main'in üstünde durur, bölümün üstü onun altına kaçmasın)
      let sc: HTMLElement | null = el.parentElement;
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
      const top0 = sc ? Math.max(0, sc.getBoundingClientRect().top) : 0;
      const floor = Math.min(window.innerHeight, nr && nr.height > 0 ? nr.top : Infinity);
      const d = revealDelta(r.top - top0, r.bottom - top0, floor - top0);
      if (d) (sc ?? window).scrollBy({ top: d, behavior: "auto" });
    };
    const id = requestAnimationFrame(reveal);
    // bölüm yüksekliği girişle aynı karede değişmeyebilir: ilk 1,5 sn içindeki boyut değişiminde yeniden hizala
    const t0 = performance.now();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { if (performance.now() - t0 < 1500) requestAnimationFrame(reveal); }) : null;
    ro?.observe(el);
    return () => { cancelAnimationFrame(id); ro?.disconnect(); };
  }, [host]);
}
