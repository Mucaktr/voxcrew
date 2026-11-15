// Ekip S5 — SÖZLEŞME: App.tsx bunu bir kez, sayfa içeriğinin üstüne bağlar (kutlamalar, XP bildirimleri).
// Bildirim yığını ve kutlama kuyruğu araştırma C.6'ya uyar: en çok 3 görünür, gruplama, fareyle/odakla durma,
// tek polite canlı bölge (XP duyurulmaz, en sık 5 sn'de bir), aynı anda tek kutlama penceresi, onay penceresi açıkken
// ya da kullanıcı son 2 sn içinde yazarken kutlama kuyrukta bekler. Oyunlaştırma kapalıyken DOM'a hiçbir şey eklenmez.
import clsx from "clsx";
import { Coins, Star, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  ensureGameLoaded, handleGameEvent, prefersReducedMotion, RARITY_LABEL, scheduleGameRefresh, scheduleScoreRefresh,
  setGameCueHandler, setScoreEventSource, useGame, type Celebration, type GameToast,
} from "../../lib/game";
import { useLocale, useT } from "../../lib/i18n";
import { registerEventHandler, useStudio } from "../../lib/store";
import { game as m } from "../../locales/game";
import { Button } from "../ui";
import { CoinAmount, GameDialog, GameIcon, RarityChip, RarityFrame } from "./parts";
import { playGameCue } from "./sfx";
import { celebrationBlocked, useWalkPresence } from "../../lib/walkPresence";

export function GameLayer() {
  // S35: odak modunda oyun katmanı (bildirim, kutlama, patlama) hiç çizilmez; iş KPI'ları sayfalarda kalır
  const enabled = useGame((s) => !!s.profile?.enabled && !s.profile?.focus);
  useEffect(() => {
    void ensureGameLoaded();
    const off = registerEventHandler("game.", handleGameEvent);
    setGameCueHandler(playGameCue);
    // S35 skor tablosu: iş olayları (koşu bitti, adım başladı/bitti) ekip skorunu yeniler (oyundan bağımsız)
    setScoreEventSource((onEvent) => {
      const offs = ["run.finished", "step.started", "step.finished"].map((p) => registerEventHandler(p, onEvent));
      return () => offs.forEach((f) => f());
    });
    // SSE yeniden bağlanınca (kaçan game.* olayları için) profili tazele
    const unsub = useStudio.subscribe((s, prev) => {
      if (s.connected && !prev.connected) { scheduleGameRefresh(300); scheduleScoreRefresh(); }
    });
    // S39: rütbe, dekor ve görev adları sunucudan dile göre gelir — dil değişince profili tazele (EN'de "Girişimci" kalmasın)
    const unsubLocale = useLocale.subscribe((s, prev) => { if (s.locale !== prev.locale) scheduleGameRefresh(100); });
    return () => { off(); unsub(); unsubLocale(); setGameCueHandler(null); setScoreEventSource(null); };
  }, []);
  if (!enabled) return null;
  return (
    <>
      <ToastStack />
      <CelebrationHost />
      <Burst />
      <LiveRegion />
    </>
  );
}

// ------------------------------------------------------------------ bildirim yığını
const MAX_VISIBLE = 3;
const durationOf = (t: GameToast) =>
  t.kind === "xp" ? 3500 : 6000 + Math.ceil(((t.title?.length ?? 0) + (t.text?.length ?? 0)) / 120) * 1000;

/**
 * UXF-G ( gerilemesi): kipli pencere (sihirbaz, Görev ver, çekmece…) açıkken kartlar karartmanın altında kalıp okunmuyor
 * ve tıklanmıyordu → pencere kapanana dek kuyrukta bekler (süre işlemez); ekran okuyucu duyurusu (`LiveRegion`) etkilenmez.
*/
function useModalHeld(active: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active) { setHeld(false); return; }
    const check = () => setHeld(!!document.querySelector('[aria-modal="true"]'));
    check();
    const id = window.setInterval(check, 400);
    return () => window.clearInterval(id);
  }, [active]);
  return held;
}

function ToastStack() {
  const t = useT(m);
  const toasts = useGame((s) => s.toasts);
  const dismiss = useGame((s) => s.dismissToast);
  const [paused, setPaused] = useState(false);
  const held = useModalHeld(toasts.length > 0);
  const deadlines = useRef(new Map<number, number>());
  const pausedRef = useRef(false);
  pausedRef.current = paused || held;

  useEffect(() => {
    const now = Date.now();
    const live = new Set(toasts.map((t) => t.id));
    for (const t of toasts) {
      const want = t.ts + durationOf(t);
      const cur = deadlines.current.get(t.id);
      if (cur === undefined || t.ts > (cur - durationOf(t))) deadlines.current.set(t.id, Math.max(want, now + 1500));
    }
    for (const id of [...deadlines.current.keys()]) if (!live.has(id)) deadlines.current.delete(id);
  }, [toasts]);

  useEffect(() => {
    if (!toasts.length) return;
    let last = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const dt = now - last;
      last = now;
      for (const [tid, d] of deadlines.current) {
        if (pausedRef.current) deadlines.current.set(tid, d + dt); // duraklat: süre işlemez
        else if (now >= d) dismiss(tid);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [toasts.length, dismiss]);

  if (!toasts.length || held) return null;
  const visible = toasts.slice(0, MAX_VISIBLE);
  const more = toasts.length - visible.length;
  return (
    <section aria-label={t("toasts_label")} data-focus-hide=""
      className="fixed z-[45] top-16 right-2 left-2 sm:left-auto sm:right-4 sm:w-[22rem] lg:top-auto lg:bottom-4 flex flex-col gap-2 pointer-events-none"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      {visible.map((x) => <ToastCard key={x.id} toast={x} onClose={() => dismiss(x.id)} />)}
      {more > 0 && (
        <div className="pointer-events-auto self-end chip tone-muted">{t("more_toasts", { n: more })}</div>
      )}
    </section>
  );
}

function ToastCard({ toast: t, onClose }: { toast: GameToast; onClose: () => void }) {
  const tr = useT(m);
  const xp = t.kind === "xp";
  if (t.kind === "achievement" && t.rarity) {
    // S35 başarım kartı: nadirlik çerçevesi + kupa odasına bağlantı (kipsiz; odak çalmaz)
    return (
      <div className="pointer-events-auto panel anim-rise p-3 flex items-center gap-3 min-w-0">
        <RarityFrame rarity={t.rarity} icon={t.icon} size={48} />
        <div className="flex-1 min-w-0">
          <p className="t-overline text-muted">{tr("achievement_unlocked")}</p>
          <p className="font-display font-semibold text-sm text-ink leading-5 truncate">{t.title}</p>
          {t.text && <p className="text-xs text-muted leading-4 mt-0.5 line-clamp-2">{t.text}</p>}
          <Link to="/basarilar/kupalar" className="text-xs font-semibold text-link hover:underline underline-offset-2" onClick={onClose}>{tr("trophy_room")}</Link>
        </div>
        <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={onClose} aria-label={tr("close_toast")} className="-mr-1 self-start" />
      </div>
    );
  }
  return (
    <div className={clsx("pointer-events-auto panel anim-rise flex items-start gap-2.5 min-w-0", xp ? "px-3 py-2" : "p-3")}>
      <span className={clsx("shrink-0 grid place-items-center rounded-lg border-2 border-line-soft",
        xp ? "h-7 w-7 bg-ok-soft text-ok" : "h-9 w-9 bg-panel-2 text-ink-2")} aria-hidden>
        {xp ? <Star size={14} /> : t.kind === "quest" ? <Coins size={17} className="text-warn" /> : <GameIcon name={t.icon} size={17} />}
      </span>
      <div className="flex-1 min-w-0">
        <p className={clsx("font-semibold text-ink leading-5 truncate", xp ? "text-dense" : "text-sm")}>
          {xp && t.amount != null ? t.title.replace(/\+\d+ XP$/, `+${t.amount} XP`) : t.title}
          {!xp && t.count > 1 && <span className="text-muted font-medium">{tr("times", { n: t.count })}</span>}
        </p>
        {t.text && <p className="text-xs text-muted leading-4 mt-0.5 line-clamp-2">{t.text}</p>}
        {t.rarity && !xp && <RarityChip rarity={t.rarity} className="mt-1.5" />}
      </div>
      <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={onClose} aria-label={tr("close_toast")} className="-mr-1 -mt-0.5" />
    </div>
  );
}

// ------------------------------------------------------------------ canlı bölge (ekran okuyucu)
function LiveRegion() {
  const toasts = useGame((s) => s.toasts);
  const [text, setText] = useState("");
  const last = useRef(0);
  const seen = useRef(new Set<number>());
  const pending = useRef<string | null>(null);
  useEffect(() => {
    const fresh = toasts.filter((t) => t.kind !== "xp" && !seen.current.has(t.id));
    fresh.forEach((t) => seen.current.add(t.id));
    if (!fresh.length) return;
    const msg = fresh.map((t) => `${t.title}${t.text ? `. ${t.text}` : ""}`).join(" · ");
    const wait = Math.max(0, 5000 - (Date.now() - last.current));
    pending.current = msg;
    const id = window.setTimeout(() => {
      if (pending.current) { setText(pending.current); pending.current = null; last.current = Date.now(); }
    }, wait);
    return () => window.clearTimeout(id);
  }, [toasts]);
  return <div role="status" aria-live="polite" className="sr-only">{text}</div>;
}

// ------------------------------------------------------------------ kutlama penceresi (kuyruk)
let lastTyping = 0;
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) lastTyping = Date.now();
  }, true);
}

function blocked(): boolean {
  // yürürken kutlama penceresi açılmaz (odağı dünyadan çalıyor, sonraki Esc yürüme modundan çıkarıyordu); yürüme bitince gösterilir
  return celebrationBlocked({ now: Date.now(), lastTyping, walking: useWalkPresence.getState().walking,
    otherModal: !!document.querySelector('[role="dialog"][aria-modal="true"]:not([data-game-dialog])') });
}

function CelebrationHost() {
  const t = useT(m);
  const queue = useGame((s) => s.celebrations);
  const pop = useGame((s) => s.popCelebration);
  const [shown, setShown] = useState<Celebration | null>(null);

  useEffect(() => {
    if (shown || !queue.length) return;
    const tryShow = () => { if (!blocked()) setShown(queue[0]); };
    tryShow();
    const id = window.setInterval(tryShow, 1000);
    return () => window.clearInterval(id);
  }, [queue, shown]);

  const close = () => { setShown(null); pop(); };
  if (!shown) return null;
  return (
    <GameDialog open onClose={close} width={420} title={shown.kind === "achievement" ? t("celebration_achievement") : shown.kind === "office" ? t("celebration_office") : t("celebration_default")}
      footer={<>
        {shown.kind === "achievement" && <Link to="/basarilar/kupalar" className="btn" onClick={close}>{t("trophy_room")}</Link>}
        <Button variant="primary" onClick={close} data-autofocus>{t("great")}</Button>
      </>}>
      <div className="flex flex-col items-center text-center gap-3">
        {shown.rarity ? <RarityFrame rarity={shown.rarity} icon={shown.icon} size={88} />
          : <span className="grid place-items-center h-20 w-20 rounded-2xl border-2 border-line bg-ok-soft text-ok"><GameIcon name={shown.icon} size={36} /></span>}
        <p className="t-h3">{shown.title}</p>
        {shown.text && <p className="text-sm text-ink-2 max-w-xs">{shown.text}</p>}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {shown.rarity && <RarityChip rarity={shown.rarity} />}
          {!!shown.coins && <span className="chip tone-warn"><CoinAmount value={shown.coins} sign /></span>}
        </div>
        {shown.rarity && <span className="sr-only">{t("rarity_sr", { r: RARITY_LABEL[shown.rarity] })}</span>}
      </div>
    </GameDialog>
  );
}

// ------------------------------------------------------------------ konfeti / balon / havai fişek (≤40 parçacık)
const COLORS = ["var(--grass)", "var(--gold)", "var(--sky)", "var(--amethyst)", "var(--diamond)"];
const KEYFRAMES = `
@keyframes gm-fall { 0% { transform: translate3d(0,-8vh,0) rotate(0deg); opacity: 1 } 100% { transform: translate3d(var(--dx),100vh,0) rotate(var(--rot)); opacity: .85 } }
@keyframes gm-rise { 0% { transform: translate3d(0,0,0); opacity: 1 } 100% { transform: translate3d(var(--dx),-112vh,0); opacity: .9 } }
@keyframes gm-spark { 0% { transform: translate(0,0) scale(1); opacity: 1 } 100% { transform: translate(var(--dx),var(--dy)) scale(.35); opacity: 0 } }
@media (prefers-reduced-motion: reduce) { .gm-p { display: none !important } }
`;

interface Particle { id: string; style: CSSProperties; shape: "rect" | "heart" | "balloon" | "dot" }

function makeParticles(style: string, big: boolean, n: number): Particle[] {
  const count = big ? 40 : 24;
  const out: Particle[] = [];
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  if (style === "fireworks") {
    const centers = big ? [[25, 30], [70, 22], [50, 40]] : [[50, 30]];
    const per = Math.floor(count / centers.length);
    centers.forEach(([cx, cy], ci) => {
      for (let i = 0; i < per; i++) {
        const a = (i / per) * Math.PI * 2;
        const r = rnd(70, 140);
        out.push({ id: `${n}-${ci}-${i}`, shape: "dot", style: {
          left: `${cx}%`, top: `${cy}%`, background: COLORS[(i + ci) % COLORS.length], width: 7, height: 7,
          animation: `gm-spark 1300ms ease-out ${ci * 250}ms forwards`,
          ["--dx" as string]: `${Math.cos(a) * r}px`, ["--dy" as string]: `${Math.sin(a) * r}px` } as CSSProperties });
      }
    });
    return out;
  }
  for (let i = 0; i < count; i++) {
    const color = COLORS[i % COLORS.length];
    if (style === "balloons") {
      out.push({ id: `${n}-${i}`, shape: "balloon", style: {
        left: `${rnd(4, 94)}%`, bottom: -60, background: color, width: 26, height: 32,
        animation: `gm-rise ${rnd(1800, 2400)}ms ease-in ${rnd(0, 300)}ms forwards`,
        ["--dx" as string]: `${rnd(-40, 40)}px` } as CSSProperties });
    } else {
      out.push({ id: `${n}-${i}`, shape: style === "hearts" ? "heart" : "rect", style: {
        left: `${rnd(2, 98)}%`, top: -20, background: color, width: style === "hearts" ? 14 : rnd(6, 10),
        height: style === "hearts" ? 13 : rnd(10, 14),
        animation: `gm-fall ${rnd(1100, 1500)}ms cubic-bezier(.3,.6,.5,1) ${rnd(0, 200)}ms forwards`,
        ["--dx" as string]: `${rnd(-80, 80)}px`, ["--rot" as string]: `${rnd(-540, 540)}deg` } as CSSProperties });
    }
  }
  return out;
}

const HEART = "polygon(50% 100%, 8% 58%, 0% 32%, 8% 10%, 28% 2%, 50% 18%, 72% 2%, 92% 10%, 100% 32%, 92% 58%)";

function Burst() {
  const burst = useGame((s) => s.burst);
  const celebrations = useGame((s) => !!s.profile?.celebrations);
  const [parts, setParts] = useState<Particle[]>([]);
  useEffect(() => {
    if (!burst.n || !celebrations || prefersReducedMotion()) return;
    setParts(makeParticles(burst.style, burst.big, burst.n));
    const id = window.setTimeout(() => setParts([]), 2800);
    return () => window.clearTimeout(id);
  }, [burst, celebrations]);
  if (!parts.length) return null;
  return (
    <div aria-hidden className="fixed inset-0 z-[44] pointer-events-none overflow-hidden">
      <style>{KEYFRAMES}</style>
      {parts.map((p) => (
        <span key={p.id} className="gm-p absolute block"
          style={{ ...p.style, borderRadius: p.shape === "balloon" ? "50% 50% 46% 46%" : p.shape === "dot" ? 999 : 2,
                   clipPath: p.shape === "heart" ? HEART : undefined }} />
      ))}
    </div>
  );
}
