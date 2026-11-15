// Ekip S20 — bağımlılıksız basit pencereleme (100+ ajan, uzun koşu listeleri).
// İki parça: `useRowSizer` satır yüksekliğini gerçek DOM'dan ölçer (en yüksek satır; satırlar ona hizalanır),
// `useWindowRows` kaydırma kabına (en yakın overflow-y:auto atası ya da pencere) göre görünür satır aralığını verir.
// Liste yalnızca [start, end) satırlarını çizer; üst ve alt boşluk `padTop` / `padBottom` ile korunur.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** En yakın kaydırma kabı; liste kendisi kaydırılıyorsa (overflow-y:auto) kendisi. */
function scrollParent(el: HTMLElement): HTMLElement | Window {
  let cur: HTMLElement | null = el;
  while (cur) {
    const o = getComputedStyle(cur).overflowY;
    if (o === "auto" || o === "scroll") return cur;
    cur = cur.parentElement;
  }
  return window;
}

export interface WindowRows { start: number; end: number; padTop: number; padBottom: number }

/**
 * Satır tabanlı pencere. `pitch` = satır yüksekliği + satır arası boşluk (px). `rows` toplam satır sayısı.
 * Kap, kaydırma alanının dışına çıktıkça yalnızca görünür satırlar (+overscan) döner.
 */
export function useWindowRows(ref: RefObject<HTMLElement | null>, rows: number, pitch: number, overscan = 2): WindowRows {
  const [range, setRange] = useState({ start: 0, end: Math.min(rows, 16) });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || pitch <= 0) return;
    const sp = scrollParent(el);
    let raf = 0;
    const update = () => {
      raf = 0;
      let offset: number, viewH: number;
      if (sp === el) { // liste kendi içinde kayıyor
        offset = el.scrollTop;
        viewH = el.clientHeight;
      } else {
        const viewTop = sp === window ? 0 : (sp as HTMLElement).getBoundingClientRect().top;
        viewH = sp === window ? window.innerHeight : (sp as HTMLElement).clientHeight;
        offset = viewTop - el.getBoundingClientRect().top; // kabın üstü görünür alanın ne kadar üstünde kaldı
      }
      const first = Math.max(0, Math.floor(offset / pitch) - overscan);
      const last = Math.max(first, Math.min(rows, Math.ceil((offset + viewH) / pitch) + overscan));
      setRange((p) => (p.start === first && p.end === last ? p : { start: first, end: last }));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    sp.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      sp.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, rows, pitch, overscan]);
  const end = Math.min(range.end, rows);
  const start = Math.min(range.start, end);
  return { start, end, padTop: start * pitch, padBottom: Math.max(0, rows - end) * pitch };
}

/**
 * Satır yüksekliği ölçer: çizilen her satır öğesine `observe` geri çağrı ref'i verilir; en yüksek doğal yükseklik
 * `rowHeight` olur (yalnızca büyür; satırlara `minHeight: rowHeight` verilince hepsi aynı hizaya gelir).
 */
export function useRowSizer(fallback: number): { rowHeight: number; observe: (el: HTMLElement | null) => void } {
  const [rowHeight, setRowHeight] = useState(fallback);
  const ro = useRef<ResizeObserver | null>(null);
  const seen = useRef(new WeakSet<Element>());
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    ro.current = new ResizeObserver((entries) => {
      let max = 0;
      for (const e of entries) max = Math.max(max, Math.round(e.target.getBoundingClientRect().height));
      if (max > 0) setRowHeight((p) => (max > p ? max : p));
    });
    return () => { ro.current?.disconnect(); ro.current = null; };
  }, []);
  const observe = useCallback((el: HTMLElement | null) => {
    if (!el || !ro.current || seen.current.has(el)) return;
    seen.current.add(el);
    ro.current.observe(el);
    const h = Math.round(el.getBoundingClientRect().height);
    if (h > 0) setRowHeight((p) => (h > p ? h : p));
  }, []);
  return { rowHeight, observe };
}

/** Kap genişliğinden sütun sayısı (ızgara için; Tailwind kırılımlarından bağımsız, kap tabanlı). */
export function useColumns(ref: RefObject<HTMLElement | null>, minCol: number, maxCols = 6, active = true): number {
  const [cols, setCols] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const calc = () => {
      const w = el.getBoundingClientRect().width || el.clientWidth;
      const n = Math.max(1, Math.min(maxCols, Math.floor((w + 12) / (minCol + 12))));
      setCols((p) => (p === n ? p : n));
    };
    calc();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, minCol, maxCols, active]);
  return cols;
}
