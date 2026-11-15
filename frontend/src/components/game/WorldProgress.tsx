// Ekip S35 — Dünya sayfasında her zaman görünen ekip ilerlemesi.
//   variant="overlay": dünya kutusunun sol altında küçük kart (sm ve üstü; küçültülebilir, tercih bu cihazda saklanır)
//   variant="strip":   dar ekranda dünyanın üstünde akış içi tek satır (dünyanın üstünü örtmez)
// İçerik: ekip (ofis) seviyesi + XP çubuğu, bugün biten görev (iş KPI'sı, oyundan bağımsız), bu haftaki aktif gün
// (seri değil: kaçırılan gün bir şey kaybettirmez), açık günlük/haftalık görevlerden 1–3'ü (tıklayınca Görev panosu).
// Oyun kapalıyken hiçbir şey çizilmez; odak modunda yalnızca iş göstergeleri kalır. Hareket azaltmada "+XP" ve
// seviye atlama işareti hareketsiz görünür (index.css genel kuralı) ve 2,5 sn sonra kalkar; ekran okuyucuya
// GameLayer'ın canlı bölgesi zaten duyurur, burada tekrar duyurulmaz.
import clsx from "clsx";
import { CalendarDays, CheckCircle2, ChevronDown, ChevronUp, Gift, ScrollText, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { create } from "zustand";
import {
  gameApi, useFocusMode, useGame, useGameVisible, useSpotlight, useTeamScore, useWeekActiveDays, type Quest,
} from "../../lib/game";
import { fmtNumber, tp, useLocale, useT } from "../../lib/i18n";
import { spotlight as S } from "../../locales/game";
import { LevelRing } from "./AgentLevelChip";

// ------------------------------------------------------------------ açık görevler (paylaşılan, kısılmış yükleme)
const useQuestPeek = create<{ items: Quest[] | null }>(() => ({ items: null }));
let peekTimer: number | undefined;
let peekUsers = 0;
async function loadPeek() {
  try {
    const d = await gameApi.quests();
    const items = d.items.filter((q) => q.status !== "claimed");
    const prev = useQuestPeek.getState().items;
    if (JSON.stringify(prev) !== JSON.stringify(items)) useQuestPeek.setState({ items });
  } catch { /* son değer kalır */ }
}
function useOpenQuests(active: boolean): Quest[] | null {
  const pulse = useGame((s) => s.pulse);
  const locale = useLocale((s) => s.locale);
  useEffect(() => { if (active && peekUsers > 0) void loadPeek(); }, [locale, active]); // görev adları sunucudan, dile göre
  useEffect(() => {
    if (!active) return;
    peekUsers++;
    if (peekUsers === 1) void loadPeek();
    return () => { peekUsers--; };
  }, [active]);
  useEffect(() => {
    if (!active || !pulse) return;
    window.clearTimeout(peekTimer);
    peekTimer = window.setTimeout(() => { void loadPeek(); }, 1200);
  }, [pulse, active]);
  return useQuestPeek((s) => s.items);
}

/** Gösterilecek 1–3 görev: ödülü hazır olanlar önce, sonra en çok ilerlemiş olanlar; günlük önce. */
function pickQuests(items: Quest[] | null): Quest[] {
  if (!items) return [];
  return [...items].sort((a, b) =>
    (a.status === "done" ? 0 : 1) - (b.status === "done" ? 0 : 1)
    || (a.kind === "daily" ? 0 : 1) - (b.kind === "daily" ? 0 : 1)
    || b.progress / Math.max(1, b.target) - a.progress / Math.max(1, a.target)).slice(0, 3);
}

// ------------------------------------------------------------------ an (XP artışı, seviye atlaması)
function useMoment() {
  const n = useSpotlight((s) => s.n);
  const [moment, setMoment] = useState<{ key: number; text: string; level: boolean; until: number } | null>(null);
  const t = useT(S);
  useEffect(() => {
    if (!n) return;
    const s = useSpotlight.getState();
    const now = Date.now();
    const next = s.levelUp ? { key: n, level: true, until: now + 4000, text: t("ov_levelup", { who: s.levelUp.who, level: s.levelUp.level }) }
      : s.xp > 0 ? { key: n, level: false, until: now + 2500, text: t("ov_xp_gain", { n: s.xp }) } : null;
    if (!next) return;
    // seviye atlaması, süresi dolana kadar ardından gelen XP artışlarına ezilmez
    setMoment((cur) => (cur?.level && !next.level && cur.until > now ? cur : next));
  }, [n, t]);
  useEffect(() => {
    if (!moment) return;
    const id = window.setTimeout(() => setMoment((cur) => (cur === moment ? null : cur)), Math.max(0, moment.until - Date.now()));
    return () => window.clearTimeout(id);
  }, [moment]);
  return moment;
}

// ------------------------------------------------------------------ parçalar
function Hourly({ hourly, className }: { hourly: number[]; className?: string }) {
  const t = useT(S);
  const max = Math.max(1, ...hourly);
  return (
    <span role="img" aria-label={t("ov_hourly", { list: hourly.join(", ") })} title={t("ov_hourly", { list: hourly.join(", ") })}
      className={clsx("inline-flex items-end gap-px h-4", className)}>
      {hourly.map((v, i) => (
        <span key={i} aria-hidden className={clsx("w-1 rounded-[1px]", v ? "bg-grass" : "bg-line-soft")}
          style={{ height: `${Math.max(2, Math.round((v / max) * 16))}px` }} />
      ))}
    </span>
  );
}

function TeamBar({ progress }: { progress: number }) {
  const t = useT(S);
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div role="progressbar" aria-label={t("ov_xp_label")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
      aria-valuetext={t("ov_xp_text", { pct })} title={t("ov_xp_text", { pct })}
      className="h-2 w-full rounded-full border border-line-soft bg-panel-3 overflow-hidden">
      <div className="h-full bg-grass transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

function QuestRow({ q }: { q: Quest }) {
  const t = useT(S);
  const pct = Math.min(100, Math.round((q.progress / Math.max(1, q.target)) * 100));
  const ready = q.status === "done";
  return (
    <li className="flex flex-col gap-1 min-w-0">
      <span className="flex items-center gap-1.5 min-w-0 text-xs">
        {ready ? <Gift size={12} aria-hidden className="shrink-0 text-warn" /> : <ScrollText size={12} aria-hidden className="shrink-0 text-muted" />}
        <span className="truncate flex-1 text-ink-2">{q.title}</span>
        <span className="num text-muted shrink-0">{ready ? t("ov_quest_ready") : `${Math.min(q.progress, q.target)}/${q.target}`}</span>
      </span>
      <span aria-hidden className="h-1 w-full rounded-full bg-panel-3 overflow-hidden">
        <span className={clsx("block h-full", ready ? "bg-gold" : "bg-grass")} style={{ width: `${pct}%` }} />
      </span>
    </li>
  );
}

const COLLAPSE_KEY = "hs-world-progress";
function initialCollapsed(): boolean {
  try {
    const v = localStorage.getItem(COLLAPSE_KEY);
    if (v) return v === "collapsed";
  } catch { /* yok say */ }
  try { return !window.matchMedia("(min-width: 1280px)").matches; } catch { return false; } // dar dünya kutusunda küçük başla
}

// ------------------------------------------------------------------ bileşen
export function WorldProgress({ variant, className }: { variant: "overlay" | "strip"; className?: string }) {
  const t = useT(S);
  const visible = useGameVisible();
  const focus = useFocusMode();
  const score = useTeamScore();
  const weekDays = useWeekActiveDays();
  const office = useGame((s) => s.profile?.office ?? null);
  const quests = useOpenQuests(visible);
  const shown = useMemo(() => pickQuests(quests), [quests]);
  const moment = useMoment();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => setCollapsed((c) => {
    try { localStorage.setItem(COLLAPSE_KEY, c ? "open" : "collapsed"); } catch { /* yok say */ }
    return !c;
  });

  if (!visible && !focus) return null; // oyunlaştırma kapalı: eski görünüm
  const tasks = score?.tasksToday ?? 0;
  const active = score?.activeAgents ?? 0;
  const level = office?.level ?? score?.level ?? 1;
  const progress = office?.progress ?? score?.progress ?? 0;
  const todayText = tp(S, "ov_today", tasks);
  const ready = shown.filter((q) => q.status === "done").length;

  // odak modu: yalnızca iş göstergeleri
  if (!visible) {
    return (
      <div className={clsx(variant === "overlay" ? "panel px-2.5 py-1.5" : "panel-soft px-3 py-2", "flex items-center gap-2 min-w-0 text-xs", className)}
        aria-label={t("ov_focus")} role="group">
        <CheckCircle2 size={14} aria-hidden className="text-ok shrink-0" />
        <span className="font-semibold text-ink-2 truncate">{todayText}</span>
        {score && <Hourly hourly={score.hourly} />}
        {active > 0 && <span className="text-muted truncate hidden sm:inline">· {tp(S, "ov_active", active)}</span>}
        <span className="ml-auto chip tone-muted shrink-0" title={t("ov_focus_hint")}>{t("ov_focus")}</span>
      </div>
    );
  }

  const momentEl = moment && (
    <span key={moment.key} aria-hidden className={clsx("anim-rise chip min-w-0 truncate !px-1.5", moment.level ? "tone-warn" : "tone-ok")}>{moment.text}</span>
  );

  if (variant === "strip") {
    return (
      <div className={clsx("panel-soft px-3 py-2 flex flex-col gap-1.5 min-w-0", className)} role="group" aria-label={t("ov_label")}>
        <div className="flex items-center gap-2 min-w-0">
          <LevelRing level={level} progress={progress} size={28} label={t("ov_team_title", { n: level })} />
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <span className="flex items-center gap-1.5 min-w-0 text-xs">
              <span className="font-semibold text-ink shrink-0">{t("ov_team_lv", { n: level })}</span>
              {momentEl}
            </span>
            <TeamBar progress={progress} />
          </div>
          <Link to="/basarilar/gorevler" className="btn btn-sm shrink-0 max-sm:min-h-11 max-sm:min-w-11" aria-label={t("ov_quests_open")}>
            {ready ? <Gift size={14} aria-hidden className="text-warn" /> : <ScrollText size={14} aria-hidden />}
            <span className="num">{shown.length}</span>
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2 min-w-0">
          <span className="inline-flex items-center gap-1"><CheckCircle2 size={13} aria-hidden className="text-ok" />{todayText}</span>
          <span className="inline-flex items-center gap-1" title={t("ov_week_hint")}><CalendarDays size={13} aria-hidden />{t("ov_week", { n: weekDays })}</span>
        </div>
      </div>
    );
  }

  if (collapsed) {
    return (
      <button type="button" onClick={toggle} aria-expanded={false} aria-label={t("ov_expand")} title={t("ov_expand")}
        className={clsx("panel px-2 py-1.5 flex items-center gap-2 text-xs font-semibold text-ink hover:bg-panel-2", className)}>
        <LevelRing level={level} progress={progress} size={26} label={t("ov_team_title", { n: level })} />
        <span className="num">{t("ov_team_lv", { n: level })}</span>
        <span className="text-muted font-medium num inline-flex items-center gap-1"><CheckCircle2 size={13} aria-hidden className="text-ok" />{fmtNumber(tasks)}</span>
        {ready > 0 && <Gift size={13} aria-hidden className="text-warn" />}
        {momentEl}
        <ChevronUp size={14} aria-hidden className="text-muted" />
      </button>
    );
  }

  return (
    <section className={clsx("panel w-64 p-2.5 flex flex-col gap-2 min-w-0", className)} aria-label={t("ov_label")}>
      <div className="flex items-center gap-2 min-w-0">
        <LevelRing level={level} progress={progress} size={34} label={t("ov_team_title", { n: level })}
          className={clsx(moment?.level && "rounded-full ring-2 ring-[color:var(--gold)]")} />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="font-display font-semibold text-sm text-ink shrink-0">{t("ov_team_lv", { n: level })}</span>
            {momentEl}
          </span>
          <TeamBar progress={progress} />
        </div>
        <button type="button" onClick={toggle} aria-expanded aria-label={t("ov_collapse")} title={t("ov_collapse")}
          className="btn btn-sm btn-icon -mr-1 self-start"><ChevronDown size={14} aria-hidden /></button>
      </div>
      <div className="flex flex-col gap-1 text-xs text-ink-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <CheckCircle2 size={13} aria-hidden className="text-ok shrink-0" />
          <span className="truncate">{todayText}</span>
          {score && <Hourly hourly={score.hourly} className="ml-auto" />}
        </span>
        <span className="flex items-center gap-1.5 min-w-0" title={t("ov_week_hint")}>
          <CalendarDays size={13} aria-hidden className="shrink-0" />
          <span className="truncate">{t("ov_week", { n: weekDays })}</span>
          {active > 0 && <span className="ml-auto inline-flex items-center gap-1 text-muted shrink-0"><Users size={12} aria-hidden />{fmtNumber(active)}</span>}
        </span>
      </div>
      <Link to="/basarilar/gorevler" className="flex flex-col gap-1.5 rounded-lg border-2 border-line-soft p-2 hover:bg-panel-2 min-w-0"
        aria-label={`${t("ov_quests_open")}: ${shown.map((q) => t("ov_quest_progress", { title: q.title, p: Math.min(q.progress, q.target), t: q.target })).join("; ") || t("ov_no_quests")}`}>
        <span className="t-overline text-muted flex items-center gap-1"><ScrollText size={12} aria-hidden />{t("ov_quests")}</span>
        {shown.length ? (
          <ul className="flex flex-col gap-1.5" aria-hidden>{shown.map((q) => <QuestRow key={q.id} q={q} />)}</ul>
        ) : <span className="text-xs text-muted">{t("ov_no_quests")}</span>}
      </Link>
    </section>
  );
}
