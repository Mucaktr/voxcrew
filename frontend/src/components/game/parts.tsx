// Ekip S5 — oyunlaştırma ortak parçaları: simge eşleme, nadirlik çerçevesi, seviye rozeti, XP çubuğu, jeton,
// erişilebilir oyun penceresi (odak tuzağı, Esc yalnızca bu pencereyi kapatır, odak geri döner).
import clsx from "clsx";
import {
  Anchor, Award, Building2, CalendarDays, Clock, Coins, Compass, Crown, DraftingCompass, Eraser, Feather, Flag,
  FlagTriangleRight, Flame, Gavel, Gem, GraduationCap, Hourglass, House, IdCard, Link as LinkIcon, Lock, LockOpen, Medal,
  Network, Package, PartyPopper, PawPrint, PenLine, Pin, Puzzle, Repeat, ScrollText, Search, Shirt, Sparkles, Sprout,
  Stamp, Star, Target, Trophy, UserPlus, Users, Wrench, X, Zap, HeartHandshake, Utensils, Fish, Grid3x3, Images, MapPinned, type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { RARITY_LABEL, type Rarity } from "../../lib/game";
import { fmtNumber, useT } from "../../lib/i18n";
import { game as m } from "../../locales/game";
import { Button } from "../ui";

const ICONS: Record<string, LucideIcon> = {
  anchor: Anchor, award: Award, "building-2": Building2, "calendar-days": CalendarDays, clock: Clock, coins: Coins,
  compass: Compass, crown: Crown, "drafting-compass": DraftingCompass, eraser: Eraser, feather: Feather, flag: Flag,
  "flag-triangle-right": FlagTriangleRight, flame: Flame, gavel: Gavel, gem: Gem, "graduation-cap": GraduationCap,
  hourglass: Hourglass, house: House, "id-card": IdCard, link: LinkIcon, lock: Lock, "lock-open": LockOpen, medal: Medal,
  network: Network, package: Package, "party-popper": PartyPopper, "paw-print": PawPrint, "pen-line": PenLine, pin: Pin,
  puzzle: Puzzle, repeat: Repeat, "scroll-text": ScrollText, search: Search, shirt: Shirt, sparkles: Sparkles,
  sprout: Sprout, stamp: Stamp, star: Star, target: Target, trophy: Trophy, "user-plus": UserPlus, users: Users,
  wrench: Wrench, zap: Zap,
  "heart-handshake": HeartHandshake, utensils: Utensils,  // W1b/W1c: ilk_tesekkur, ekip_yemegi
  // W4: hatira_avcisi, kasif, ilk_balik, ilk_galibiyet (award/medal/gem zaten var)
  images: Images, "map-pinned": MapPinned, fish: Fish, "grid-3x3": Grid3x3,
};

export function GameIcon({ name, size = 18, className }: { name?: string; size?: number; className?: string }) {
  const Icon = (name && ICONS[name]) || Trophy;
  return <Icon size={size} className={className} aria-hidden />;
}

/** Nadirlik yalnızca renkle değil şekil ve metinle de anlatılır: Yaygın daire, Nadir kare, Epik altıgen, Efsanevi yıldız. */
const SHAPE: Record<Rarity, string> = {
  common: "circle(50% at 50% 50%)",
  rare: "inset(6% round 18%)",
  epic: "polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0% 50%)",
  legendary: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
};
const RARITY_VAR: Record<Rarity, string> = {
  common: "var(--muted-fg)", rare: "var(--info-fg)", epic: "var(--accent-fg)", legendary: "var(--warn-fg)",
};
const RARITY_BG: Record<Rarity, string> = {
  common: "var(--muted-bg)", rare: "var(--info-bg)", epic: "color-mix(in srgb, var(--amethyst) 18%, var(--panel))",
  legendary: "var(--warn-bg)",
};

export function RarityFrame({ rarity, icon, size = 56, locked, secret }:
  { rarity: Rarity; icon?: string; size?: number; locked?: boolean; secret?: boolean }) {
  const color = locked ? "var(--muted)" : RARITY_VAR[rarity];
  return (
    <span className="relative inline-grid place-items-center shrink-0" style={{ width: size, height: size }} aria-hidden>
      <span className="absolute inset-0" style={{ clipPath: SHAPE[rarity], background: color }} />
      <span className="absolute inset-[3px]" style={{ clipPath: SHAPE[rarity], background: locked ? "var(--panel-3)" : RARITY_BG[rarity] }} />
      <span className="relative grid place-items-center" style={{ color, opacity: locked ? 0.75 : 1 }}>
        {secret ? <span className={clsx("font-display font-semibold", size >= 56 ? "text-xl" : "text-base")}>?</span>
          : <GameIcon name={icon} size={Math.round(size * (rarity === "legendary" ? 0.3 : 0.4))} />}
      </span>
      {locked && !secret && (
        <span className="absolute -bottom-0.5 -right-0.5 grid place-items-center h-5 w-5 rounded-full bg-panel border-2 border-line-soft text-muted">
          <Lock size={11} />
        </span>
      )}
    </span>
  );
}

export function RarityChip({ rarity, className }: { rarity: Rarity; className?: string }) {
  const tone = rarity === "common" ? "tone-muted" : rarity === "rare" ? "tone-info" : rarity === "legendary" ? "tone-warn" : "";
  return (
    <span className={clsx("chip", tone, className)}
      style={rarity === "epic" ? { color: "var(--accent-fg)", background: RARITY_BG.epic,
        borderColor: "color-mix(in srgb, var(--accent-fg) 35%, transparent)" } : undefined}>
      <span aria-hidden className="inline-block h-2 w-2" style={{ clipPath: SHAPE[rarity], background: "currentColor" }} />
      {RARITY_LABEL[rarity]}
    </span>
  );
}

/** Seviye rozeti: kalkan + sayı; kıdem bandına göre şerit/yıldız işareti (renk tek başına bilgi taşımaz). */
export function LevelBadge({ level, title, size = "md" }: { level: number; title?: string; size?: "sm" | "md" | "lg" }) {
  const t = useT(m);
  const dim = size === "lg" ? 52 : size === "sm" ? 28 : 38;
  const band = level >= 28 ? 6 : level >= 23 ? 5 : level >= 18 ? 4 : level >= 13 ? 3 : level >= 8 ? 2 : level >= 4 ? 1 : 0;
  return (
    <span className="relative inline-grid place-items-center shrink-0" style={{ width: dim, height: dim * 1.1 }}
      title={title ? t("badge_title", { level, title }) : t("badge_title_short", { level })}>
      <svg viewBox="0 0 40 44" width={dim} height={dim * 1.1} aria-hidden className="absolute inset-0">
        <path d="M20 2 L37 8 V22 C37 33 29 40 20 42 C11 40 3 33 3 22 V8 Z" fill="var(--panel)" stroke="var(--line)" strokeWidth="2.5" />
        <path d="M20 6 L33 10.5 V22 C33 30.5 27 36 20 38 C13 36 7 30.5 7 22 V10.5 Z"
          fill={band >= 4 ? "var(--warn-bg)" : band >= 2 ? "var(--info-bg)" : "var(--ok-bg)"} />
        {band >= 1 && band <= 3 && [0, 1, 2].slice(0, band).map((i) => (
          <rect key={i} x="11" y={30 + i * 3} width="18" height="1.8" rx="0.9" fill="var(--ink-2)" />
        ))}
        {band >= 4 && [0, 1, 2].slice(0, band - 3).map((i, _a, arr) => (
          <path key={i} transform={`translate(${20 - (arr.length - 1) * 4 + i * 8} 33) scale(0.32)`}
            d="M0 -9 L2.6 -2.8 L9 -2.8 L3.8 1.2 L5.6 8 L0 4 L-5.6 8 L-3.8 1.2 L-9 -2.8 L-2.6 -2.8 Z" fill="var(--ink-2)" />
        ))}
      </svg>
      <span className={clsx("relative num font-semibold text-ink leading-none -mt-1.5",
        size === "lg" ? "text-lg" : size === "sm" ? "text-xs" : "text-sm")}>
        <span className="sr-only">{t("level_sr")}</span>{level}
      </span>
    </span>
  );
}

export function XpBar({ into, need, xp, max, label, compact }:
  { into: number; need: number; xp: number; max?: boolean; label?: string; compact?: boolean }) {
  const t = useT(m);
  const pct = max || !need ? 100 : Math.max(0, Math.min(100, Math.round((into / need) * 100)));
  const text = max ? t("xp_max", { xp }) : t("xp_text", { into, need, left: need - into });
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={text}
        aria-label={label ?? t("xp_default")}
        className={clsx("w-full rounded-full border-2 border-line-soft bg-panel-3 overflow-hidden", compact ? "h-2" : "h-3")}>
        <div className="h-full bg-grass transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      {!compact && <span className="text-xs text-muted num">{text}</span>}
    </div>
  );
}

export function CoinAmount({ value, className, sign }: { value: number; className?: string; sign?: boolean }) {
  const t = useT(m);
  return (
    <span className={clsx("inline-flex items-center gap-1 num font-semibold", className)}>
      <Coins size={14} aria-hidden className="text-warn" />
      {sign && value > 0 ? "+" : ""}{fmtNumber(value)}
      <span className="sr-only">{t("coins_sr")}</span>
    </span>
  );
}

/** Oyun penceresi: aynı anda bir tane; odak tuzağı; Esc yalnızca bu pencereyi kapatır (alttaki çekmece açık kalır). */
export function GameDialog({ open, onClose, title, children, footer, width = 460, labelledIcon }:
  { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number;
    labelledIcon?: ReactNode }) {
  const t = useT(m);
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(box.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []);
    window.setTimeout(() => (box.current?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0])?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6 bg-black/45"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} data-game-dialog
        className="panel anim-rise w-full max-h-[92vh] flex flex-col" style={{ maxWidth: width }}>
        <header className="flex items-center gap-2 px-5 pt-4 pb-3 border-b-2 border-line-soft">
          {labelledIcon}
          <h2 id={titleId} className="t-h3 flex-1 min-w-0">{title}</h2>
          <Button variant="ghost" size="sm" icon={<X size={16} />} onClick={onClose} aria-label={t("close")} />
        </header>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && <footer className="px-5 py-3 border-t-2 border-line-soft flex flex-wrap justify-end gap-2">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
