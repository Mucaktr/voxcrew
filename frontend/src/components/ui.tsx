import clsx from "clsx";
import { ChevronDown, ChevronLeft, ChevronRight, Cpu, Globe, Loader2, PlugZap, RefreshCcw, SearchX, Settings2, Sparkles, Terminal, X } from "lucide-react";
import {
  useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { STATUS } from "../lib/format";
import { tx } from "../lib/i18n";
import { common } from "../locales/common";
import { shell } from "../locales/shell";

type Variant = "default" | "primary" | "danger" | "gold" | "ghost";

/** `disabledReason` pasif düğmenin NEDENİNİ söyler: fare ipucu (title) ve ekran okuyucu için aria-describedby.
 * Sayfa ayrıca görünür bir not yazabilir (kritik formlarda yazar); düğme pasif değilse hiçbir şey eklenmez.*/
export function Button({ variant = "default", size, icon, children, className, disabledReason, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm"; icon?: ReactNode; disabledReason?: string | null }) {
  const rid = useId();
  const why = rest.disabled && disabledReason ? disabledReason : null;
  return (
    <>
      <button type="button" {...rest} title={why ?? rest.title} aria-describedby={why ? rid : rest["aria-describedby"]}
        className={clsx("btn", variant !== "default" && `btn-${variant}`, size === "sm" && "btn-sm",
          !children && icon && "btn-icon", className)}>
        {icon}
        {children}
      </button>
      {why && <span id={rid} className="sr-only">{why}</span>}
    </>
  );
}

export function Panel({ title, icon, actions, children, className, bodyClass }:
  { title?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={clsx("panel flex flex-col min-w-0", className)}>
      {(title || actions) && (
        <header className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 min-h-[3rem]">
          {icon && <span className="text-ink-2 shrink-0 flex">{icon}</span>}
          {title && <h2 className="panel-title flex-1 min-w-0 truncate">{title}</h2>}
          {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={clsx("px-4 pb-4 min-h-0", bodyClass)}>{children}</div>
    </section>
  );
}

export function Badge({ tone = "muted", children, className, title }:
  { tone?: string; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={clsx("chip", `tone-${tone}`, className)}>{children}</span>;
}

export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "muted" };
  return (
    <Badge tone={s.tone}>
      {status === "running" && <Loader2 size={12} className="animate-spin" />}
      {s.label}
    </Badge>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }:
  { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[]; className?: string }) {
  return (
    <div className={clsx("seg", className)} role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} disabled={o.disabled} title={o.title}
          className={clsx("disabled:opacity-40", o.disabled && "cursor-not-allowed")} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A11Y — anahtar ve onay kutusu için erişilebilir ad zorunludur. Tür düzeyinde: düz metin `label` ya da (etiket
 *  JSX ise) açık `aria-label` / `aria-labelledby` verilmeden derlenmez. Metin etiket, `aria-label` olarak da yazılır;
 *  böylece `aria-labelledby` çözmeyen araçlar da adı görür (görünen metinle birebir aynı, WCAG 2.5.3). */
export type ControlName =
  | { label: string; "aria-label"?: string; "aria-labelledby"?: string }
  | { label: ReactNode; "aria-label": string; "aria-labelledby"?: string }
  | { label?: ReactNode; "aria-label"?: string; "aria-labelledby": string };

function nameProps(id: string, n: ControlName, hasLabel: boolean) {
  const aria = n["aria-label"] ?? (typeof n.label === "string" && n.label.trim() ? n.label : undefined);
  return {
    "aria-label": n["aria-labelledby"] ? undefined : aria,
    "aria-labelledby": n["aria-labelledby"] ?? (aria ? undefined : hasLabel ? `${id}-l` : undefined),
  };
}

export function Toggle({ checked, onChange, hint, disabled, ...name }:
  { checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode; disabled?: boolean } & ControlName) {
  const id = useId();  // anahtarın erişilebilir adı etiketten, açıklaması ipucundan gelir
  const { label } = name;
  return (
    <label className={clsx("flex items-start gap-3 select-none", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        {...nameProps(id, name, label != null && label !== false)} aria-describedby={hint ? `${id}-h` : undefined}
        // 375 px'te dokunma hedefi ≥ 44 px (düğme yüksekliği 44; çizilen ray 24 px kalır, satır yüksekliği aynı)
        className="mt-0.5 relative h-6 w-11 shrink-0 max-sm:h-11 max-sm:-mt-2 max-sm:-mb-2.5 motion-reduce:[&_*]:transition-none">
        <span aria-hidden className={clsx("absolute inset-x-0 top-1/2 -translate-y-1/2 h-6 rounded-md border-2 border-line transition-colors",
          checked ? "bg-grass" : "bg-panel-3")}>
          <span className={clsx("absolute top-0.5 h-4 w-4 rounded-[4px] border-2 border-line bg-panel transition-all",
            checked ? "left-[22px]" : "left-0.5")} />
        </span>
      </button>
      {(label != null || hint) && (
        <span className="min-w-0">
          {label != null && <span id={`${id}-l`} className="block text-sm font-semibold">{label}</span>}
          {hint && <span id={`${id}-h`} className="block text-xs text-muted mt-0.5 leading-4">{hint}</span>}
        </span>
      )}
    </label>
  );
}

/** A11Y — adlandırılmış onay kutusu. `label` görünen metindir; satırda ek içerik (rozet, renk noktası, açıklama)
 *  `children` ile gelir ve ada karışmaz. Ad `ControlName` kuralıyla zorunludur. */
export function Checkbox({ checked, onChange, hint, disabled, className, inputClassName, labelClassName, title, children, ...name }:
  { checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode; disabled?: boolean; className?: string;
    inputClassName?: string; labelClassName?: string; title?: string; children?: ReactNode } & ControlName) {
  const id = useId();
  const { label } = name;
  return (
    <label title={title} className={clsx("flex items-center gap-2 min-w-0", disabled ? "cursor-not-allowed" : "cursor-pointer", className)}>
      <input type="checkbox" className={clsx("h-4 w-4 shrink-0 accent-[var(--grass)]", inputClassName)} checked={checked}
        disabled={disabled} onChange={(e) => onChange(e.target.checked)}
        {...nameProps(id, name, label != null)} aria-describedby={hint ? `${id}-h` : undefined} />
      {label != null && <span id={`${id}-l`} className={labelClassName}>{label}</span>}
      {children}
      {hint && <span id={`${id}-h`} className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  // S39: görünen etiket tek form alanına programatik olarak bağlanır (WCAG 1.3.1 / 4.1.2); birden çok alan ya da
  // düğme grubu varsa kapsayıcı "group" olur ve etiket grubun adıdır. Alanın kendi etiketi varsa dokunulmaz.
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const controls = el.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea');
    if (controls.length === 1) {
      const c = controls[0] as HTMLInputElement;
      el.removeAttribute("role"); el.removeAttribute("aria-labelledby");
      if (!c.hasAttribute("aria-label") && !c.hasAttribute("aria-labelledby") && !(c.labels && c.labels.length)) c.setAttribute("aria-labelledby", `${id}-l`);
      if (hint && !c.hasAttribute("aria-describedby")) c.setAttribute("aria-describedby", `${id}-h`);
    } else {
      el.setAttribute("role", "group"); el.setAttribute("aria-labelledby", `${id}-l`);
    }
  });
  return (
    <div ref={root} className={clsx("flex flex-col gap-1.5", className)}>
      <span id={`${id}-l`} className="label">{label}</span>
      {children}
      {hint && <span id={`${id}-h`} className="text-xs text-muted leading-4">{hint}</span>}
    </div>
  );
}

/** En üstteki kipli pencere mi? (Çekmece üstünde açılan onay penceresi gibi iç içe durumlarda yalnız o tepki verir.) */
function isTopDialog(el: HTMLElement | null): boolean {
  if (!el) return true;
  const all = document.querySelectorAll('[aria-modal="true"]');
  return all[all.length - 1] === el;
}

function useEscape(open: boolean, onClose: () => void, ref?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && isTopDialog(ref?.current ?? null)) onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose, ref]);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** S39 — kipli pencere odak yönetimi (WCAG 2.4.3): açılınca odak pencereye taşınır, Tab/Shift+Tab pencere içinde
 *  döner, kapanınca odak pencereyi açan öğeye geri verilir. Pencere kendi alanına odak verirse (ör. metin kutusu) o kalır. */
/**
 * UXF-E: kapanışta odak açan düğmeye döner. Düğme tıklamayla odak almamışsa (programatik `click`, bazı dokunmatik
 * tarayıcılar) `activeElement` body'dir → son tıklanan düğme/bağlantı yedek olarak kullanılır (Pazar ve Tarif çekmeceleri body'ye düşüyordu).
*/
let lastActivator: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const t = (e.target as Element | null)?.closest?.("button, a[href], [role=button], summary");
    lastActivator = t instanceof HTMLElement ? t : null;
  }, true);
}
/**
 * odak kayıp mı (`body`/yok) — pencere içeriği değişip odaktaki düğme söküldüğünde (onay → "Kapat" adımı)
 * tarayıcı odağı `body`'ye bırakır; kipli pencere açıkken bu, klavye kullanıcısını pencerenin dışına atar.
*/
export function dialogFocusLost(active: Element | null, body: Element | null): boolean {
  return !active || active === body;
}
/** Kayıp odağın gideceği yer: altbilgideki son etkin düğme (eylem adımının "Kapat"ı), yoksa pencerenin kendisi. */
export function dialogRescueTarget(box: HTMLElement): HTMLElement {
  const btns = [...box.querySelectorAll<HTMLElement>("footer button:not([disabled])")].filter((x) => x.getClientRects().length);
  return btns[btns.length - 1] ?? box;
}
/** Pencere kapanınca açan öğe yoksa odak ana içeriğe (`#icerik`, kabuk "İçeriğe geç" hedefi) döner; `body`'de bırakılmaz. */
export function focusMainContent(): boolean {
  const main = typeof document !== "undefined" ? document.getElementById("icerik") : null;
  if (!main || !dialogFocusLost(document.activeElement, document.body)) return false;
  main.focus({ preventScroll: true });
  return true;
}
function useDialogFocus(ref: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    if (!open) return;
    const act = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prev = act && act !== document.body ? act : (lastActivator && lastActivator.isConnected ? lastActivator : null);
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !el || !isTopDialog(el)) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.getClientRects().length);
      if (!items.length) { e.preventDefault(); el.focus(); return; }
      const first = items[0], last = items[items.length - 1], cur = document.activeElement;
      if (!el.contains(cur)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && (cur === first || cur === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    // içerik değişince odaktaki öğe sökülürse (İkram et → Kapat) odak pencerenin içinde kalır
    const mo = typeof MutationObserver !== "undefined" && el ? new MutationObserver(() => {
      if (el.isConnected && dialogFocusLost(document.activeElement, document.body) && isTopDialog(el)) dialogRescueTarget(el).focus({ preventScroll: true });
    }) : null;
    if (mo && el) mo.observe(el, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      mo?.disconnect();
      if (prev && prev.isConnected) prev.focus({ preventScroll: true });
      else window.setTimeout(() => { if (!document.querySelector('[aria-modal="true"]')) focusMainContent(); }, 0);
    };
  }, [open, ref]);
}

export function Modal({ open, onClose, title, children, width = 640, footer }:
  { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number; footer?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEscape(open, onClose, box);
  useDialogFocus(box, open);
  const titleId = useId();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 bg-black/45 backdrop-blur-[2px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} tabIndex={-1} className="panel anim-rise w-full max-h-[92vh] flex flex-col focus:outline-none" style={{ maxWidth: width }}
        role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="flex items-center gap-2 px-5 pt-4 pb-3 border-b-2 border-line-soft">
          <h2 id={titleId} className="t-h3 flex-1 min-w-0">{title}</h2>
          <Button variant="ghost" size="sm" icon={<X size={16} />} onClick={onClose} aria-label={tx(shell, "close")} />
        </header>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && <footer className="px-5 py-3 border-t-2 border-line-soft flex justify-end gap-2">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, children, width = 540, label }: { open: boolean; onClose: () => void; children: ReactNode; width?: number; label?: string }) {
  const box = useRef<HTMLElement>(null);
  useEscape(open, onClose, box);
  useDialogFocus(box, open);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside ref={box} tabIndex={-1} aria-label={label} className="anim-slide h-full w-full bg-panel border-l-2 border-line flex flex-col shadow-2xl focus:outline-none" style={{ maxWidth: width }}
        role="dialog" aria-modal="true">
        {children}
      </aside>
    </div>,
    document.body,
  );
}

/**
 * UI-CLARITY — ayrıntı çekmecesi (kartın "ilk görünümü" sade kalır, ayrıntı tıklayınca burada açılır).
 * `Drawer` üzerine kurulur: Esc, dış tıklama, odak tuzağı ve odağı geri verme hazırdır.
 *   <DetailDrawer open={!!sel} onClose={() => setSel(null)} icon={<Cpu />} title="Ollama" subtitle="Yerel modeller"
 *                 status={<Badge tone="ok">Hazır</Badge>} footer={<Button variant="primary">Başlat</Button>}>…içerik…</DetailDrawer>
 * `title` (zorunlu) h2 olur ve çekmecenin erişilebilir adıdır; `label` yalnız başlık metin değilse gerekir.
 * `subtitle`/`status`/`icon` üst şeritte, `footer` altta sabit eylem şeridinde durur (yoksa çizilmez); `width` en çok px (varsayılan 520).
 * 375 px'te tam genişlik olur; gövde kendi içinde kayar.
 */
export function DetailDrawer({ open, onClose, title, subtitle, icon, status, footer, children, width = 520, label }:
  { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; status?: ReactNode;
    footer?: ReactNode; children: ReactNode; width?: number; label?: string }) {
  return (
    <Drawer open={open} onClose={onClose} width={width} label={label ?? (typeof title === "string" ? title : undefined)}>
      <header className="flex items-start gap-3 px-4 sm:px-5 pt-4 pb-3 border-b-2 border-line-soft">
        {icon && <span className="shrink-0 flex text-ink-2 mt-0.5" aria-hidden>{icon}</span>}
        <div className="flex-1 min-w-0">
          <h2 className="t-h3 break-words">{title}</h2>
          {subtitle && <p className="text-sm text-muted mt-0.5 break-words">{subtitle}</p>}
          {status && <div className="flex flex-wrap items-center gap-1.5 mt-2">{status}</div>}
        </div>
        <Button variant="ghost" size="sm" icon={<X size={16} />} onClick={onClose} aria-label={tx(shell, "close")} />
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 sm:px-5 py-4 flex flex-col gap-4">{children}</div>
      {footer && <footer className="px-4 sm:px-5 py-3 border-t-2 border-line-soft flex flex-wrap justify-end gap-2">{footer}</footer>}
    </Drawer>
  );
}

/** UI-CLARITY — gelişmiş seçenekler için açılır bölüm (varsayılan kapalı). Düğme `aria-expanded` ve `aria-controls` taşır. */
export function Disclosure({ summary, children, defaultOpen = false, className }:
  { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={clsx("flex flex-col gap-3", className)}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}
        className="self-start inline-flex items-start gap-1.5 min-h-9 py-1.5 text-left text-sm font-semibold text-ink-2 hover:text-ink rounded-md focus-visible:outline-2">
        <ChevronDown size={15} aria-hidden className={clsx("mt-0.5 shrink-0 transition-transform", open && "rotate-180")} /><span className="min-w-0">{summary}</span>
      </button>
      <div id={id} hidden={!open} className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

const tabDomId = (base: string, value: string) => `${base}-tab-${value}`;
const tabPanelDomId = (base: string) => `${base}-panel`;
/** Seçili sekme kaydırılınca ok düğmesinin altında kalmasın (ok + solma genişliği). */
const TAB_EDGE = 48;

/**
 * Sekme şeridi. `id` aynı değerle bir `TabPanel`'e bağlanır (aria-controls / aria-labelledby).
 * Şerit taşarsa yalnızca taşan yönde kenar solması ve ok düğmeleri görünür; klavyede ←/→, Home/End.
 */
export function Tabs<T extends string>({ id, value, onChange, tabs, label }:
  { id: string; value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[]; label?: string }) {
  const list = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: false, end: false });
  // taşma ölçümü: kaydırma, kap boyutu ve sekme genişliği (rozet sayısı, font yüklenmesi) değişince
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      const start = el.scrollLeft > 1, end = el.scrollLeft < max - 1;
      setEdge((p) => (p.start === start && p.end === end ? p : { start, end }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [tabs.length]);
  // seçili sekme kaydırılan şeridin dışında kalmasın (yalnızca yatay kaydırma; sayfa dikey kaymaz)
  useEffect(() => {
    const el = list.current;
    const sel = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !sel) return;
    const c = el.getBoundingClientRect(), s = sel.getBoundingClientRect();
    if (s.left < c.left + TAB_EDGE) el.scrollLeft += s.left - c.left - TAB_EDGE;
    else if (s.right > c.right - TAB_EDGE) el.scrollLeft += s.right - c.right + TAB_EDGE;
  }, [value]);
  const page = (dir: 1 | -1) => {
    const el = list.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7), behavior: reduce ? "auto" : "smooth" });
  };
  const move = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = tabs.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i + n - 1) % n
      : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(tabs[to].value);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
  };
  return (
    <div className="tabs" data-start={edge.start || undefined} data-end={edge.end || undefined}>
      <div ref={list} className="tabs-list" role="tablist" aria-label={label}>
        {tabs.map((t, i) => (
          <button key={t.value} type="button" role="tab" id={tabDomId(id, t.value)} aria-controls={tabPanelDomId(id)}
            aria-selected={t.value === value} tabIndex={t.value === value ? 0 : -1}
            onClick={() => onChange(t.value)} onKeyDown={(e) => move(e, i)} className="tab">
            {t.label}
          </button>
        ))}
      </div>
      {/* yalnızca fare/dokunma için görsel ipucu: klavye ve ekran okuyucu sekmelere doğrudan ulaşır */}
      {edge.start && (
        <button type="button" className="tabs-arrow tabs-arrow-start" tabIndex={-1} aria-hidden="true" title={tx(shell, "tabs_prev")}
          onClick={() => page(-1)}><ChevronLeft size={16} /></button>
      )}
      {edge.end && (
        <button type="button" className="tabs-arrow tabs-arrow-end" tabIndex={-1} aria-hidden="true" title={tx(shell, "tabs_next")}
          onClick={() => page(1)}><ChevronRight size={16} /></button>
      )}
    </div>
  );
}

/** `Tabs` ile eşleşen sekme paneli: `tabs` sekme şeridinin `id`'si, `value` seçili sekme. Ad varsayılan olarak seçili sekmeden gelir. */
export function TabPanel({ tabs, value, label, className, children }:
  { tabs: string; value: string; label?: string; className?: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={tabPanelDomId(tabs)} aria-labelledby={label ? undefined : tabDomId(tabs, value)} aria-label={label}
      tabIndex={0} className={clsx("tabpanel", className)}>
      {children}
    </div>
  );
}

export function Empty({ icon, title, text, action, level }: { icon?: ReactNode; title: ReactNode; text?: ReactNode; action?: ReactNode; level?: "h1" | "h2" }) {
  const Title = level ?? "p";
  return (
    <div className="flex flex-col items-center text-center gap-2 py-8 px-4">
      {icon && (
        <div className="mb-1 grid place-items-center h-14 w-14 rounded-xl border-2 border-line-soft bg-panel-2 text-muted">{icon}</div>
      )}
      <Title className="font-display text-base font-semibold text-ink tracking-[-0.005em]">{title}</Title>
      {text && <p className="text-sm text-muted max-w-sm leading-relaxed">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** ekranın altındaki ağır paneller sayfa açılırken değil, görünmeye yaklaşınca (ya da boşta) bağlanır; ilk boyama hızlanır.
 * `minHeight` yer tutucu, kaydırma çubuğunun zıplamaması içindir. IntersectionObserver yoksa hemen bağlanır.*/
export function DeferMount({ children, minHeight = 160 }: { children: ReactNode; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (on || !ref.current) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setOn(true); io.disconnect(); } }, { rootMargin: "800px 0px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [on]);
  return on ? <>{children}</> : <div ref={ref} style={{ minHeight }} aria-hidden />;
}

/** ortak "yüklenemedi" durumu. Hata varken sayfa asla "henüz yok" boş durumunu göstermez; bunun yerine bu
 * kutu (anlaşılır ileti + Yeniden dene) çıkar. `text` verilmezse genel "sunucuya ulaşılamıyor" cümlesi yazılır.*/
export function LoadError({ title, text, onRetry }: { title?: ReactNode; text?: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert">
      <Empty icon={<PlugZap size={28} />} title={title ?? tx(common, "err_title")} text={text ?? tx(common, "err_text")}
        action={onRetry && <Button icon={<RefreshCcw size={15} />} onClick={onRetry}>{tx(common, "err_retry")}</Button>} />
    </div>
  );
}

/** ortak "bulunamadı" durumu (geçersiz ya da silinmiş kayıt). Tek başlık (h2), bir sonraki adım olarak
 * listeye dön bağlantısı. Yeniden denemek 404'ü düzeltmez, o yüzden Yeniden dene yok.*/
export function NotFound({ title, text, backTo, backLabel, level = "h2" }: { title?: ReactNode; text?: ReactNode; backTo?: string; backLabel?: ReactNode; level?: "h1" | "h2" }) {
  return (
    <div role="status">
      <Empty icon={<SearchX size={28} />} level={level} title={title ?? tx(common, "nf_title")} text={text ?? tx(common, "nf_text")}
        action={backTo && <Link to={backTo} className="btn">{backLabel ?? tx(common, "nf_back")}</Link>} />
    </div>
  );
}

/** Ortak sayfa başlığı: (isteğe bağlı üst etiket) · tek h1 · tek satır açıklama · (isteğe bağlı rozet satırı) · sağda birincil eylem(ler). */
export function PageHeader({ title, subtitle, actions, eyebrow, meta, className }:
  { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; meta?: ReactNode; className?: string }) {
  return (
    <header className={clsx("page-header", className)}>
      <div className="flex-1 min-w-[min(100%,280px)]">
        {eyebrow && <div className="t-overline text-muted mb-1">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
        {meta && <div className="flex flex-wrap items-center gap-1.5 mt-2.5">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Sayfa içi bölüm başlığı (Panel dışında kullanılan h2/h3). `size="sm"`: çekmece, yan sütun ve panel içi alt bölümler (16 px). */
export function SectionTitle({ children, icon, actions, hint, as = "h2", size = "md", className }:
  { children: ReactNode; icon?: ReactNode; actions?: ReactNode; hint?: ReactNode; as?: "h2" | "h3"; size?: "md" | "sm"; className?: string }) {
  const Tag = as;
  return (
    <div className={clsx("flex items-center gap-2 min-w-0", className)}>
      {icon && <span className="text-ink-2 shrink-0 flex">{icon}</span>}
      <div className="flex-1 min-w-0">
        <Tag className={clsx(size === "sm" ? "panel-title" : "section-title", "truncate")}>{children}</Tag>
        {hint && <p className="text-xs text-muted mt-0.5">{hint}</p>}
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-muted" />;
}

export const CONN_ICON: Record<string, ReactNode> = {
  ollama: <Cpu size={15} />,
  codex: <Sparkles size={15} />,
  claude: <Terminal size={15} />,
  profile: <Settings2 size={15} />,
  openai_compat: <Globe size={15} />, // S39 (C-12): model API / kendi anahtarınla bağlantı
};

export function Swatches({ colors, value, onChange }: { colors: string[]; value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {colors.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} aria-label={c} aria-pressed={c.toLowerCase() === value.toLowerCase()}
          className={clsx("h-7 w-7 rounded-md border-2 transition-transform hover:scale-110",
            c.toLowerCase() === value.toLowerCase() ? "border-line scale-110 shadow-[0_2px_0_var(--shadow)]" : "border-line-soft")}
          style={{ background: c }} />
      ))}
      <label className="h-7 w-7 rounded-md border-2 border-dashed border-line-soft grid place-items-center cursor-pointer text-xs text-muted" title={tx(shell, "custom_color")}>
        +
        <input type="color" className="sr-only" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

export function OptionGrid<T extends string>({ options, value, onChange, cols = 3, render }:
  { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; cols?: number; render?: (id: T) => ReactNode }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}
          className="card-select px-2 py-1.5 min-h-[2rem] text-xs font-semibold flex items-center gap-1.5 min-w-0">
          {render?.(o.id)}
          <span className="truncate">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
