/**
 * WALK-EXPLORE — yürüme modunda keşif HUD'u:
 *  - `InteriorChip` (WalkHud üst çubuğunda, Çık düğmesinin yanında): iç mekân adı, oda, kat; "Dışarı çık" ve "Ofise dön";
 *    sessiz (kutsal) iç mekânda "Sessiz alan" notu.
 *  - `ExploreHud` (WorldPage, yürürken): geçiş kararması (hareket azaltmada yok), keşif izleyicisi (K; sahne yüzdesi, keşif
 *    görevleri, unvan) ve POI notu kartı. 375 px'te izleyici tek çip olarak başlar; dokunma hedefleri ≥ 44 px.
 *  - INTERIOR-VIEW: başlık çipi tek satır "Yer · Oda · Kat n/N" (üst çubukta, HUD ızgarasında); kat değişince orta yuvada kısa
 *    başlık kartı (alan türü ve kamera ipucu; hareket azaltmada geçişsiz) — duyuruyu InteriorRig yapar, kart ekran okuyucudan gizli.
 * Etik: görevlerin süresi yok (geri sayım, "son şans", seri yok); ajan sıralanmaz.
 */
import clsx from "clsx";
import { Check, ChevronDown, ChevronUp, Compass, DoorOpen, Home, Info, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { fmtPercent, useT } from "../../../../lib/i18n";
import { explore as XM } from "../../../../locales/explore";
import { LIFT_MS, useInterior } from "../../../../voxel/interiors/store";
import { useWalkPanel, useWalkStore } from "../../../../voxel/walk/walkStore";
import { sceneLabel } from "../progress/actions";
import { InHudZone, useHudZone } from "../hudZones";
import { returnWorldFocusSoon } from "../../../../voxel/walk/worldFocus";
import { useEscLayer } from "../useEscLayer"; // UXF-G
import { LiftPicker } from "./LiftPicker"; // LIFTFLOOR
import { closeExploreNote, hasRoomName, leaveToDoor, leaveToHome, roomName, siteName, useExploreNote } from "./actions";
import { ensureExplore, questTitle, useExplore, type ExploreQuest } from "./exploreStore";

/** Üst çubuk parçası: içerideyken ad, kat ve çıkış düğmeleri. */
export function InteriorChip({ onFocusWorld }: { onFocusWorld?: () => void }) {
  const t = useT(XM);
  const view = useInterior((s) => s.view);
  const busy = useInterior((s) => s.busy);
  // birden çok odalı katta (Topkapı iki avlu) oda adı avatarın bulunduğu odadan; tek odalıda katın adı (kararlı; yalnız oda değişince yeniden çizilir)
  const here = useWalkStore((s) => {
    const l = view?.level, t = s.pose?.tile;
    if (!l || !t || l.rooms.length < 2) return null;
    return l.rooms.find((r) => t[0] >= r.i0 && t[0] < r.i0 + r.w && t[1] >= r.j0 && t[1] < r.j0 + r.d)?.name ?? null;
  });
  if (!view) return null;
  const lv = view.level;
  const site = siteName(lv.scene, lv.site);
  const room = roomName(here && hasRoomName(here) ? here : lv.name);
  return (
    <>
      <span className="chip !bg-panel/95 pointer-events-auto shadow min-h-11 max-w-full" role="status"
        aria-label={t("chip_aria", { site, room, n: lv.index + 1, total: lv.count })}>
        <DoorOpen size={15} aria-hidden="true" className="shrink-0" />
        {/* INTERIOR-VIEW: "Galata Kulesi · Giriş holü · Kat 1/3" (tek katlıda kat yazılmaz) */}
        <span className="hidden @md:inline truncate font-semibold max-w-[20rem]" title={lv.count > 1 ? t("chip_title", { site, room, n: lv.index + 1, total: lv.count }) : t("chip_inside", { site, room })}>
          {lv.count > 1 ? t("chip_title", { site, room, n: lv.index + 1, total: lv.count }) : t("chip_inside", { site, room })}
        </span>
        {/* UX-P2: dar bölümde kısa ("Kat 1/3" ya da oda) — Çık, çip, Dışarı ve Ofise dön tek satırda; tam ad aria-label'da*/}
        <span className="@md:hidden truncate font-semibold" aria-hidden="true" title={lv.count > 1 ? t("chip_title", { site, room, n: lv.index + 1, total: lv.count }) : t("chip_inside", { site, room })}>
          {lv.count > 1 ? t("chip_short", { n: lv.index + 1, total: lv.count }) : room}
        </span>
      </span>
      {/* dar bölümde "Sessiz alan" simge çipi (metin title/aria-label'da) — üst çubuk 3 satıra çıkıyordu*/}
      {lv.quiet && <span className="chip tone-info pointer-events-auto min-h-11 min-w-11 justify-center text-xs" role="note" aria-label={t("quiet_note")} title={t("quiet_note")}>
        <VolumeX size={15} aria-hidden="true" className="shrink-0 @md:hidden" /><span className="hidden @md:inline">{t("quiet_note")}</span>
      </span>}
      <button type="button" className="btn pointer-events-auto min-h-11" disabled={busy} aria-label={t("leave_aria")} title={t("leave_aria")}
        onClick={() => { leaveToDoor(); onFocusWorld?.(); }}>
        <DoorOpen size={16} aria-hidden="true" /><span className="hidden sm:inline">{t("leave")}</span>
      </button>
      <button type="button" className="btn pointer-events-auto min-h-11" disabled={busy} aria-label={t("home_aria")} title={t("home_aria")}
        onClick={() => { leaveToHome(); onFocusWorld?.(); }}>
        <Home size={16} aria-hidden="true" /><span className="hidden md:inline">{t("home")}</span>
      </button>
    </>
  );
}

/**
 * Geçiş örtüsü — CITYLIFE (B1): kapıdan geçerken kısa **iris** (ortadaki ışıklı daire kapanır, karşı tarafta açılır; kenarında geçit
 * renginde ince parıltı), ardından kararma. Hareket azaltmada `fade` hiç 1 olmaz (store.ts): anlık geçiş.
 */
function FadeOverlay() {
  const fade = useInterior((s) => s.fade);
  const fx = useInterior((s) => s.fx);
  if (fx === "lift") return <LiftDoors closed={!!fade} />;
  return (
    <div aria-hidden="true" className={clsx("absolute inset-0 z-40 overflow-hidden pointer-events-none motion-safe:transition-opacity motion-safe:duration-200",
      fade ? "opacity-100" : "opacity-0")}>
      <div className="absolute left-1/2 top-1/2 rounded-full motion-safe:transition-all motion-safe:duration-200 motion-safe:ease-in"
        style={{ width: fade ? "0vmax" : "150vmax", height: fade ? "0vmax" : "150vmax", transform: "translate(-50%, -50%)",
          boxShadow: "0 0 0 200vmax #000, inset 0 0 2.5vmax 0.6vmax rgba(56, 225, 245, 0.85), 0 0 3vmax 1vmax rgba(167, 139, 250, 0.7)" }} />
    </div>
  );
}

/**
 * (ürün sahibi 2026-10-31 "metro gibi geçiş") — asansör geçişi: iki kapı kanadı ortada kapanır, üstte kat göstergesi yanar, kat
 * değişince kanatlar açılır (LIFT_MS). Hareket azaltmada kanatlar kaymaz; örtü yalnız saydamlıkla yumuşak kararır ve açılır.
*/
function LiftDoors({ closed }: { closed: boolean }) {
  const ride = useInterior((s) => s.liftRide);
  const leaf = "absolute inset-y-0 w-1/2 bg-gradient-to-b from-[#4A4F57] via-[#3A3E45] to-[#2A2D32] motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-in-out";
  return (
    <div aria-hidden="true" data-lift-doors="" className={clsx("absolute inset-0 z-40 overflow-hidden pointer-events-none transition-opacity duration-500",
      closed ? "opacity-100" : "opacity-0")}>
      <div className={clsx(leaf, "left-0 border-r-2 border-black/50", closed ? "translate-x-0" : "motion-safe:-translate-x-full")} />
      <div className={clsx(leaf, "right-0 border-l-2 border-black/50", closed ? "translate-x-0" : "motion-safe:translate-x-full")} />
      <div className="absolute left-1/2 top-[10%] -translate-x-1/2 h-1.5 w-16 rounded-full bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.8)]" />
      {closed && ride && <LiftCabin key={`${ride.from}-${ride.to}-${ride.ms}`} {...ride} />}
    </div>
  );
}

/**
 * ( ürün sahibi "en alt kattan gidilecek kata metrodaki gibi bir efekt ile çıksın") — kapılar kapalıyken kabin
 * yolculuğu: kapı aralığından kat ışıkları yolculuk yönünün tersine kayar (yükseliyor/iniyor hissi), üstte kat göstergesi çıkış katından
 * hedef kata sayar, ortada metro yolculuk çipi gibi hedef ("Asansör: Seyir galerisi"). Sahne örtülü: kamera bu sürede yeni kata oturur.
 * Hareket azaltmada ışıklar kaymaz; gösterge yine sayar.
*/
function LiftCabin({ from, to, ms }: { from: number; to: number; ms: number }) {
  const t = useT(XM);
  const plan = useInterior((s) => s.plan);
  const [floor, setFloor] = useState(from);
  useEffect(() => {
    const n = Math.abs(to - from), dir = Math.sign(to - from);
    if (!n) return;
    const ids: number[] = [];
    for (let k = 1; k <= n; k++) ids.push(window.setTimeout(() => setFloor(from + dir * k), LIFT_MS + ((ms - 120) * k) / n));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [from, to, ms]);
  const up = to > from, dest = plan?.levels[to];
  const Arrow = up ? ChevronUp : ChevronDown;
  return (
    <div data-lift-cabin={up ? "up" : "down"} className="absolute inset-0">
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-3 overflow-hidden">
        {[0, 1, 2].map((k) => (
          <div key={k} className={clsx("absolute inset-x-0 h-[22vh] bg-gradient-to-b from-transparent via-amber-200/70 to-transparent",
            up ? "motion-safe:animate-[liftpass_0.9s_linear_infinite]" : "motion-safe:animate-[liftpass_0.9s_linear_infinite_reverse]")}
            style={{ top: "-22vh", animationDelay: `${k * 0.3}s` }} />
        ))}
      </div>
      <div className="absolute left-1/2 top-[13%] -translate-x-1/2 flex items-center gap-1 rounded-lg bg-black/70 px-3 py-1 font-display text-2xl font-semibold tabular-nums text-amber-300 shadow-[0_0_14px_rgba(252,211,77,0.45)]">
        <Arrow size={22} aria-hidden="true" />{floor + 1}
      </div>
      {dest && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-[calc(100%-2rem)] panel !rounded-xl px-3 py-1.5 shadow-lg">
          <p className="text-sm font-semibold text-ink truncate">{t("lift_to", { room: roomName(dest.name, dest.index) })}</p>
        </div>
      )}
    </div>
  );
}

const OPEN_KEY = "vc-walk-explore-open";

/**
 * INTERIOR-VIEW: kat değişince orta yuvada kısa başlık kartı (2,8 sn; alan türü ipucu). HUD ızgarasının `middle` yuvasında
 * tostlarla aynı akışta: üst üste binmez. Hareket azaltmada geçiş yok (yalnız görünür/gizli).
 */
function TitleCard() {
  const t = useT(XM);
  const view = useInterior((s) => s.view);
  const fade = useInterior((s) => s.fade);
  const key = view?.level.key ?? "";
  const [shown, setShown] = useState("");
  const middle = useHudZone("middle");
  const [, bump] = useState(0);
  useEffect(() => {
    if (!middle || typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver(() => bump((n) => n + 1));
    mo.observe(middle, { childList: true });
    return () => mo.disconnect();
  }, [middle]);
  useEffect(() => {
    if (!key) { setShown(""); return; }
    setShown(key);
    const id = window.setTimeout(() => setShown(""), 2800);
    return () => window.clearTimeout(id);
  }, [key]);
  // orta yuvada başka bildirim (keşif tostu, not) varken kart çizilmez: yuva taşıp kırpmasın (aynı bilgiyi tost/duyuru verir)
  const busyZone = !!middle && [...middle.children].some((c) => !c.hasAttribute("data-interior-title"));
  if (!view || shown !== key || fade || busyZone) return null;
  const lv = view.level;
  const site = siteName(lv.scene, lv.site), room = roomName(lv.name);
  return (
    <InHudZone zone="middle">
      <div aria-hidden="true" data-interior-title=""
        className="panel !rounded-xl shadow-lg px-3 py-1 @md:px-4 @md:py-2 text-center pointer-events-none max-w-[min(24rem,100%)] motion-safe:animate-[rise_.25s_ease-out]">
        <p className="font-display text-base font-semibold text-ink leading-6 truncate">{room}</p>
        <p className="text-xs text-ink-2 leading-4 truncate">{lv.count > 1 ? t("chip_title", { site, room, n: lv.index + 1, total: lv.count }) : site}</p>
        <p className="hidden @md:block text-xs text-muted leading-4 truncate">{t(`space_${view.record.space}` as "space_room")}</p>
      </div>
    </InHudZone>
  );
}

export function ExploreHud() {
  const scene = useWalkStore((s) => s.world);
  useEffect(() => { void ensureExplore(); }, [scene]);
  return (
    <>
      <FadeOverlay />
      <LiftPicker /> {/* LIFTFLOOR */}
      <TitleCard />
      {scene && <ExploreTracker scene={scene} />}
      <NoteCard />
    </>
  );
}

function ExploreTracker({ scene }: { scene: string }) {
  const t = useT(XM);
  const listId = useId();
  const panel = useWalkPanel();
  const view = useExplore((s) => s.view);
  const sum = view?.scenes[scene];
  const quests = useMemo(() => (view?.quests ?? []).filter((q) => q.scene === scene), [view, scene]);
  const [open, setOpen] = useState(() => {
    const wide = typeof window === "undefined" || window.matchMedia?.("(min-width: 640px)").matches !== false;
    if (!wide) return false;
    try { const v = window.localStorage.getItem(OPEN_KEY); if (v) return v === "1"; } catch { /* yok */ }
    return false;
  });
  const toggle = useCallback(() => setOpen((v) => {
    try { window.localStorage.setItem(OPEN_KEY, v ? "0" : "1"); } catch { /* yok */ }
    return !v;
  }), []);
  // UXF-G: açıkken Esc önce izleyiciyi kapatır (yürüme modundan çıkmaz); ikinci Esc moddan çıkar. Odak dünya kabında kalır.
  const toggleBtn = useRef<HTMLButtonElement>(null);
  const closeByEsc = useCallback(() => {
    try { window.localStorage.setItem(OPEN_KEY, "0"); } catch { /* yok */ }
    setOpen(false);
    returnWorldFocusSoon(toggleBtn.current);
  }, []);
  const shown = !!sum && sum.total > 0;
  useEscLayer(open && shown, closeByEsc, { id: "explore" });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "k" && e.key !== "K") || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  if (!sum || sum.total === 0) return null;
  const label = sceneLabel(scene);
  const title = view ? t(view.title.id as "title_none") : "";
  // UIUX-OVERLAP: konumu WalkHud ızgarası verir (alt sol köşe yuvası; İnşa düğmesiyle aynı akışta, üst üste binmez)
  return (
    <InHudZone zone="corner">
    <div className={clsx("pointer-events-auto max-w-full", open ? "w-[min(15rem,100%)]" : "w-auto",
      panel && "hidden @xl:block")}>
      <div className="panel !rounded-xl shadow-lg">
        <button ref={toggleBtn} type="button" onClick={toggle} aria-expanded={open} aria-controls={listId} aria-keyshortcuts="K" title={t("tr_toggle")}
          className={clsx("flex w-full items-center min-h-11 text-sm font-semibold rounded-xl focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
            open ? "gap-2 px-3" : "gap-1.5 px-2.5 @md:gap-2 @md:px-3")}>
          <Compass size={15} aria-hidden="true" className="text-ink-2 shrink-0" />
          <span className="flex-1 min-w-0 text-left truncate">{open ? t("tr_title") : fmtPercent(sum.percent)}</span>
          {/* UX-P2: dar bölümde kapalı çip sıkı — ok simgesi gizli (aria-expanded durumu söyler)*/}
          {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronUp size={15} aria-hidden="true" className="hidden @md:block" />}
          <span className="sr-only">{t("tr_toggle")}</span>
        </button>
        {open && (
          /* uzun görev listesi kendi içinde kayar — dokunmatik araç satırının (Fotoğraf · Anı · Rehber) üstüne taşıyordu*/
          <div id={listId} className="px-2 pb-2 flex flex-col gap-1.5 max-h-[min(16rem,30vh)] short:max-h-[20vh] overflow-y-auto overscroll-contain">
            <div className="px-1">
              <div className="flex items-center justify-between gap-2 text-xs text-ink-2">
                <span className="truncate">{t("tr_percent", { scene: label, p: sum.percent })}</span>
              </div>
              <div role="progressbar" aria-label={t("tr_percent_aria", { scene: label })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={sum.percent}
                aria-valuetext={fmtPercent(sum.percent)} className="mt-1 h-2 rounded-full border border-line-soft bg-panel-3 overflow-hidden">
                <div className="h-full bg-sky" style={{ width: `${sum.percent}%` }} />
              </div>
              {view && <p className="mt-1 text-xs text-ink-2">{t("tr_title_current", { title })}
                {view.next_title ? ` · ${t("tr_title_next", { title: t(view.next_title.id as "title_none"), n: view.count, t: view.next_title.min })}` : ""}</p>}
            </div>
            <p className="px-1 text-xs font-semibold text-ink">{t("tr_quests")}</p>
            {quests.length === 0 && <p className="px-1 text-xs text-muted">{t("tr_none")}</p>}
            <ul className="flex flex-col gap-1">
              {quests.map((q) => <QuestRow key={q.id} q={q} />)}
            </ul>
          </div>
        )}
      </div>
    </div>
    </InHudZone>
  );
}

function QuestRow({ q }: { q: ExploreQuest }) {
  const t = useT(XM);
  const title = questTitle(q);
  const p = Math.min(q.progress, q.target);
  return (
    <li className="rounded-lg bg-panel-2 px-2 py-1.5">
      <div className="flex items-start gap-1.5">
        {q.done ? <Check size={13} aria-hidden="true" className="shrink-0 mt-0.5 text-ok-fg" /> : <Compass size={13} aria-hidden="true" className="shrink-0 mt-0.5 text-ink-2" />}
        <span className="flex-1 min-w-0 text-xs font-semibold text-ink leading-4">{title}</span>
        <span className="text-xs num text-ink-2 shrink-0">{p}/{q.target}</span>
      </div>
      {!q.done && <p className="mt-0.5 pl-5 text-xs text-ink-2">{t("q_reward", { n: q.reward_coins })}</p>}
    </li>
  );
}

/** POI notu / gizli köşe ipucu: küçük kart; kapat düğmesi, uzaklaşınca kendiliğinden kapanır (actions.ts). */
function NoteCard() {
  const t = useT(XM);
  const note = useExploreNote((s) => s.note);
  const inside = useInterior((s) => !!s.view);
  useEffect(() => { if (inside) closeExploreNote(); }, [inside]);
  if (!note) return null;
  // UIUX-OVERLAP: HUD ızgarasının orta yuvasında (tostlarla aynı akış)
  return (
    <InHudZone zone="middle">
    <div className="w-[min(22rem,100%)] shrink-0 pointer-events-none">
      <div className="panel !rounded-xl shadow-lg flex items-start gap-2 @md:gap-2.5 px-2.5 py-1 @md:px-3 @md:py-2 pointer-events-auto" role="note" aria-label={t("note_title")}>
        <Info size={18} aria-hidden="true" className="shrink-0 mt-0.5 text-info" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink leading-5">{note.title}</p>
          {note.text && <p className="text-xs text-ink-2 leading-4 mt-0.5">{note.text}</p>}
        </div>
        <button type="button" className="btn btn-ghost btn-sm min-h-11 min-w-11 !p-0 grid place-items-center shrink-0 sticky top-0" aria-label={t("note_close")}
          onClick={closeExploreNote}><X size={14} aria-hidden="true" /></button>
      </div>
    </div>
    </InHudZone>
  );
}
