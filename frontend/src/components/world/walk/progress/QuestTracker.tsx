/**
 * W4 (WALK-GAME-UI) — yürüme modunda görev izleyici: yürüme görevleri (`walk: true`) artı en
 * yakın günlük görev; mevcut görev panosu verisi (`GET /api/game/quests`). Katlanabilir (J). UIUX-OVERLAP: konumu WalkHud
 * ızgarası verir — üst çubuğun altındaki satırın başı (yuva "under"); dar bölümde tek satır çip olarak başlar, Yakındakiler
 * sığmazsa alt satıra sarılır. Oyun katmanları kapalıysa (oyunlaştırma kapalı ya da odak modu) görünmez.
 * dar ekranda (< 640 px) kapalıyken tek küçük çip (simge + ilerleme; başlık aria-label'da) — satırın tamamını kaplamaz.
*/
import clsx from "clsx";
import { ChevronDown, ChevronUp, Footprints, Gift, ScrollText } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { gameApi, useGame, useGameVisible, type Quest } from "../../../../lib/game";
import { useT } from "../../../../lib/i18n";
import { useWalkProgress } from "../../../../lib/walk";
import { walk as WM } from "../../../../locales/walk";
import { walkInfo as WIM } from "../../../../locales/walkInfo";
import { useMedia } from "../media";
import { useWalkPanel } from "../../../../voxel/walk/walkStore";
import { InHudZone } from "../hudZones";

export type WalkQuest = Quest & { walk?: boolean };

/** İzlenecekler: yürüme görevleri önce, sonra tamamlanmamış ilk günlük görev (en çok 3). */
export function trackedQuests(items: readonly WalkQuest[]): WalkQuest[] {
  const open = items.filter((q) => q.status !== "claimed");
  const walk = open.filter((q) => q.walk);
  const daily = open.find((q) => !q.walk && q.kind === "daily" && q.status === "active");
  return [...walk, ...(daily ? [daily] : [])].slice(0, 3);
}

const NONE: WalkQuest[] = [];
const OPEN_KEY = "vc-walk-quests-open";

export function QuestTracker() {
  const t = useT(WM);
  const ti = useT(WIM);
  const narrow = useMedia("(max-width: 639px)");
  const visible = useGameVisible();
  const panel = useWalkPanel();
  const listId = useId();
  const [items, setItems] = useState<WalkQuest[]>(NONE);
  // dar ekranda (375 px) her zaman tek satır çiple başlar (§8); masaüstünde son tercih hatırlanır
  const [open, setOpen] = useState(() => {
    const wide = typeof window === "undefined" || window.matchMedia?.("(min-width: 640px)").matches !== false;
    if (!wide) return false;
    try { const v = window.localStorage.getItem(OPEN_KEY); if (v) return v === "1"; } catch { /* yok */ }
    return true;
  });
  const toggle = useCallback(() => setOpen((v) => {
    try { window.localStorage.setItem(OPEN_KEY, v ? "0" : "1"); } catch { /* yok */ }
    return !v;
  }), []);

  // yükle; hatıra/vize/ödül değişince kısa gecikmeyle yeniden oku (sunucu ilerlemeyi yazar)
  const pickup = useWalkProgress((s) => s.pickup.found);
  const visas = useWalkProgress((s) => s.visas);
  const ready = useGame((s) => s.profile?.quests_ready ?? 0);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    const id = window.setTimeout(() => {
      gameApi.quests().then((d) => { if (live) setItems(trackedQuests(d.items as WalkQuest[])); }).catch(() => undefined);
    }, 600);
    return () => { live = false; window.clearTimeout(id); };
  }, [visible, pickup, visas, ready]);

  // J: aç/kapat (yazı alanında değilken)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "j" && e.key !== "J") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  if (!visible) return null;
  const head = items[0];
  if (narrow && !open) {
    const label = head ? ti("qt_chip_aria", { title: head.title, p: Math.min(head.progress, head.target), t: head.target }) : ti("qt_chip_empty_aria");
    return (
      <InHudZone zone="under">
        <button type="button" onClick={toggle} aria-expanded={false} aria-controls={listId} aria-keyshortcuts="J" aria-label={label} title={label}
          className={clsx("chip !bg-panel/95 pointer-events-auto shadow min-h-11 min-w-11 justify-center gap-1 !px-2.5 text-sm font-semibold text-ink",
            "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]", panel && "hidden")}>
          <ScrollText size={15} aria-hidden="true" className="text-ink-2 shrink-0" />
          {head && <span className="num">{Math.min(head.progress, head.target)}/{head.target}</span>}
        </button>
      </InHudZone>
    );
  }
  return (
    <InHudZone zone="under">
    <div className={clsx("pointer-events-auto flex flex-col gap-1 w-[min(15rem,100%)] max-h-full min-h-11", panel && "hidden @xl:flex")}>
      <div className="panel !rounded-xl shadow-lg min-h-0 flex flex-col">
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={listId} aria-keyshortcuts="J" title={t("qt_toggle")}
          className="flex w-full items-center gap-2 px-3 min-h-11 text-sm font-semibold rounded-xl focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]">
          <ScrollText size={15} aria-hidden="true" className="text-ink-2 shrink-0" />
          {/* görev adı iki satıra sarılır (yatayda "Bir onay kapısı kararına …" kesiliyordu)*/}
          <span className="flex-1 min-w-0 text-left line-clamp-2 whitespace-normal [overflow-wrap:anywhere] leading-4">
            {open || !head ? t("qt_title") : t("qt_progress", { title: head.title, p: Math.min(head.progress, head.target), t: head.target })}
          </span>
          {open ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
          <span className="sr-only">{t("qt_toggle")}</span>
        </button>
        {open && (
          <div id={listId} className="px-2 pb-2 flex flex-col gap-1.5 min-h-0 overflow-y-auto short:max-h-[20vh]">{/* yatayda açık liste köşe satırına (Keşif) taşıyordu*/}
            {items.length === 0 && <p className="px-1 text-xs text-muted">{t("qt_empty")}</p>}
            <ul className="flex flex-col gap-1.5">
              {items.map((q) => <TrackerRow key={q.id} q={q} />)}
            </ul>
            <Link to="/basarilar/gorevler" className="text-xs underline text-link px-1 self-start min-h-11 inline-flex items-center">{t("qt_board")}</Link>
          </div>
        )}
      </div>
    </div>
    </InHudZone>
  );
}

function TrackerRow({ q }: { q: WalkQuest }) {
  const t = useT(WM);
  const p = Math.min(q.progress, q.target);
  const pct = Math.min(100, Math.round((p / Math.max(1, q.target)) * 100));
  return (
    <li className="rounded-lg bg-panel-2 px-2 py-1.5">
      <div className="flex items-start gap-1.5">
        {q.walk ? <Footprints size={13} aria-hidden="true" className="shrink-0 mt-0.5 text-ink-2" /> : <ScrollText size={13} aria-hidden="true" className="shrink-0 mt-0.5 text-ink-2" />}
        <span className="flex-1 min-w-0 text-xs font-semibold text-ink leading-4">{q.title}</span>
        {q.walk && <span className="chip tone-info !px-1.5 text-xs shrink-0">{t("qt_walk")}</span>}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <div role="progressbar" aria-label={q.title} aria-valuemin={0} aria-valuemax={q.target} aria-valuenow={p} aria-valuetext={`${p} / ${q.target}`}
          className="flex-1 h-2 rounded-full border border-line-soft bg-panel-3 overflow-hidden">
          <div className="h-full bg-grass" style={{ width: `${pct}%` }} />
        </div>
        {q.status === "done"
          ? <span className="chip tone-warn !px-1.5 text-xs"><Gift size={11} aria-hidden="true" />{t("qt_ready")}</span>
          : <span className="text-xs num text-ink-2">{p}/{q.target}</span>}
      </div>
    </li>
  );
}
