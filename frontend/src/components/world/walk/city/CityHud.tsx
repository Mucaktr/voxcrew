/**
 * yürüme HUD'unda şehir haritası parçaları:
 * - `CityChip` (WalkHud üst çubuğu, Çık düğmesinin yanında): ofiste "Şehre çık" kapısına yakınken giriş düğmesi; şehirde
 * "Şehir · semt" etiketi, pasaport düğmesi (sayaç), seyir noktası / yolculuk notu, Hızlı seyahat ve her zaman "Ofise dön".
 * - `CityPanel` (HUD `dock` yuvası): durakta hat ve hedefler ("Tramvay · Kule durağı"; kilitli semte giden hat kilit notuyla
 * kapalı), Hızlı seyahat listesi (yalnız ziyaret edilmiş duraklar), pasaportu (semtler: yüzde ve kilit kuralı; süresiz
 * görevler: ilerleme). Klavye: düğmeler sekmeyle, Esc paneli kapatır.
 * - gün batımı anı olan seyir noktasında kısa ipucu (akşam saatleri ya da Gece ışığı; geri sayım yok).
 * Animasyon yok (hareket azaltma); dokunma hedefi ≥ 44 px; 375 px'te üst çubukla birlikte sarılır; metinler `locales/city.ts`.
*/
import { clearPanelArrival } from "../../../../voxel/citymap/stopEntity"; // ARR-A: panel kapanınca bekleyen varış yönü düşer
import { Check, ChevronDown, Home, Lock, MapPinned, Navigation, SkipForward, Stamp, Sunset, TramFront, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useT } from "../../../../lib/i18n";
import { city as CM } from "../../../../locales/city";
import { cityForScene, cityIds, districtId, momentId, parseCityId, questProgress } from "../../../../voxel/citymap/catalog";
import { stopPanelMode } from "../../../../voxel/citymap/stopPanelMode";
import { designOf } from "../../../../voxel/citymap/designs";
import {
  ackNewStamps, boardLine, cityDoor, cityName, districtName, landmarkName, exitCity, fastTravel, questName, skipRideToStop, stopLines, stopName, unlockRule, useCity, vehicleName, visitedStops,
} from "../../../../voxel/citymap/store";
import { useWalkStore } from "../../../../voxel/walk/walkStore";
import { useInterior } from "../../../../voxel/interiors/store";
import { announceWalk } from "../announce";
import { InHudZone } from "../hudZones";
import { PanelShell } from "../PanelShell";
import { useEscLayer } from "../useEscLayer";
import { worldHasFocus } from "./stopPanelFocus";

const setFast = (fast: boolean) => useCity.setState({ fast, passport: false });
const setPassport = (passport: boolean) => useCity.setState({ passport, fast: false });

export function CityChip({ onFocusWorld }: { onFocusWorld?: () => void }) {
  const t = useT(CM);
  const view = useCity((s) => s.view);
  const nearDoor = useCity((s) => s.nearDoor);
  const district = useCity((s) => s.district);
  const deck = useCity((s) => s.deck);
  const deckVp = useCity((s) => s.deckVp);
  const ride = useCity((s) => s.ride);
  const found = useCity((s) => s.found);
  const world = useWalkStore((s) => s.world);
  // şehir landmarkının iç mekânında iç mekân çipi (ad, kat, "Dışarı çık", "Ofise dön" → şehirden de çıkar) yeter
  const inside = useInterior((s) => !!s.view);
  const doorCity = nearDoor && !view ? cityForScene(world) : null;
  const stamps = useMemo(() => {
    if (!view) return { n: 0, total: 0 };
    const ids = cityIds(view.city).filter((id) => !id.includes(":stop:"));
    return { n: ids.filter((id) => found.has(id)).length, total: ids.length };
  }, [view, found]);
  // gün batımı anı olan seyir noktası (henüz damgalanmamış)
  const moment = useMemo(() => {
    if (!view || !deck || !district || deckVp === null) return null;
    const m = designOf(view.city)?.moments?.[district]?.find((x) => x.vp === deckVp);
    return m && !found.has(momentId(view.city, district, m.id)) ? m : null;
  }, [view, deck, deckVp, district, found]);
  if (view && inside) return null;
  if (!view) {
    if (!doorCity) return null;
    const name = cityName(doorCity.id);
    return (
      <button type="button" className="btn btn-primary pointer-events-auto min-h-11" aria-label={t("door_aria", { city: name })} title={t("door_aria", { city: name })}
        onClick={() => { cityDoor.go?.(); onFocusWorld?.(); }}>
        <MapPinned size={16} aria-hidden="true" />{t("door")}
      </button>
    );
  }
  const cityLabel = cityName(view.city);
  const place = district ? districtName(view.city, district) : t(view.map.gate.kind === "pier" ? "gate_pier" : "gate_plaza");
  const passportLabel = t("passport_aria", { n: stamps.n, total: stamps.total }) + (moment ? `. ${t("sunset_hint")}` : "");
  return (
    <>
      <span className="chip !bg-panel/95 pointer-events-auto shadow min-h-11 max-w-full min-w-0 flex-[1_1_6rem] @md:flex-none" role="status" aria-label={t("chip_aria", { city: cityLabel, place })}>
        <MapPinned size={15} aria-hidden="true" className="shrink-0" />
        {/* dar bölümde ve yatay telefonda iki satıra sarılır (uzun şehir adı 83 px'te kesiliyordu)*/}
        <span className="line-clamp-2 whitespace-normal [overflow-wrap:anywhere] font-semibold max-w-[16rem] short:max-w-[9rem] text-xs leading-4 @md:text-sm @md:leading-5 short:!text-xs short:!leading-4">{t("chip", { city: cityLabel, place })}</span>
      </span>
      {/* şehir araçları (pasaport, hızlı seyahat, ofise dön) tek "Şehir" menüsünde — üst çubuk tek sırada kalır.
          Gün batımı ipucu varsa menü düğmesinde güneş simgesi; geniş bölümde ayrı not çipi*/}
      <CityMenu stamps={stamps} moment={!!moment} passportLabel={passportLabel} onFocusWorld={onFocusWorld} />
      {deck && <span className="chip tone-info pointer-events-auto min-h-11 text-xs max-w-full" role="note"><span className="truncate">{t("view_deck")}</span></span>}
      {moment && (
        <span className="chip tone-info pointer-events-auto min-h-11 text-xs max-w-full min-w-0 hidden @5xl:inline-flex" role="note" title={t("sunset_hint")}>
          <Sunset size={15} aria-hidden="true" /><span className="truncate">{t("sunset_hint")}</span>
        </span>
      )}
      {ride && (
        <span className="chip tone-info pointer-events-auto min-h-11 max-w-full" role="status">
          <TramFront size={15} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{t("ride_chip", { vehicle: vehicleName(ride.kind, ride.line), to: stopName(view.city, ride.to) })}</span>
        </span>
      )}
      {/* RIDE-UX: uzun yolculukta hızlandırma yok — "Durağa atla" kararma altında iniş durağına keser */}
      {ride && (
        <button type="button" className="btn pointer-events-auto min-h-11" aria-label={t("ride_skip_aria", { to: stopName(view.city, ride.to) })}
          title={t("ride_skip_aria", { to: stopName(view.city, ride.to) })} onClick={() => { skipRideToStop(); onFocusWorld?.(); }}>
          <SkipForward size={16} aria-hidden="true" /><span className="hidden sm:inline">{t("ride_skip")}</span>
        </button>
      )}
    </>
  );
}

/** CityMenu öğeleri arasında klavye hareketi (saf; node testi): ok tuşları döner, Home/End uçlara gider; başka tuş null. */
export function menuNav(key: string, i: number, n: number): number | null {
  if (n <= 0) return null;
  if (key === "ArrowDown") return (i + 1) % n;
  if (key === "ArrowUp") return (i - 1 + n) % n;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return null;
}

/**
 * "Şehir" menüsü — pasaport, hızlı seyahat ve ofise dön tek düğmede (üst çubukta 12 düğme iki sıraya sarılıyordu).
 * Klavye: düğmede Enter/Boşluk/↓ açar ve ilk öğeye odaklanır; ↑/↓/Home/End gezinir; Esc kapatır ve odağı düğmeye verir (Esc yığını
 * `useEscLayer`: yürüme modundan çıkmaz); Tab menüyü kapatır; dışarı tıklama kapatır. Öğeler `role="menuitem"`, en az 44 px.
*/
function CityMenu({ stamps, moment, passportLabel, onFocusWorld }:
  { stamps: { n: number; total: number }; moment: boolean; passportLabel: string; onFocusWorld?: () => void }) {
  const t = useT(CM);
  const fast = useCity((s) => s.fast);
  const passport = useCity((s) => s.passport);
  const ride = useCity((s) => s.ride);
  const [open, setOpen] = useState(false);
  const [end, setEnd] = useState(false); // düğme sağ yarıdaysa (dikey telefonda Şehir 1. satırın sonunda) menü sağa yaslı açılır
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = (refocus = true) => { setOpen(false); if (refocus) btn.current?.focus({ preventScroll: true }); };
  useEscLayer(open, () => close(), { id: "citymenu" });
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const items = () => [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Tab") { setOpen(false); return; }
    const list = items();
    const to = menuNav(e.key, list.indexOf(document.activeElement as HTMLElement), list.length);
    if (to == null) return;
    e.preventDefault();
    list[to]?.focus({ preventScroll: true });
  };
  const run = (fn: () => void) => () => { setOpen(false); fn(); };
  const label = t("menu_aria", { n: stamps.n, total: stamps.total });
  const itemCls = "btn min-h-11 w-full justify-start";
  const place = () => setEnd((root.current?.getBoundingClientRect().left ?? 0) + Math.min(256, window.innerWidth - 24) > window.innerWidth - 8);
  return (
    <div ref={root} className="relative pointer-events-auto" data-city-menu="">
      <button ref={btn} type="button" className={`btn min-h-11${fast || passport || open ? " btn-primary" : ""}`} aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? menuId : undefined} aria-label={label + (moment ? `. ${t("sunset_hint")}` : "")} title={label}
        onClick={() => { place(); setOpen((v) => !v); }}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); place(); setOpen(true); } }}>
        <MapPinned size={16} aria-hidden="true" className="shrink-0" />
        <span className="font-semibold hidden @sm:inline">{t("menu")}</span>{/* dar bölümde yer konum çipine (ad aria-label'da)*/}
        <span className="tabular-nums hidden @md:inline">{stamps.n}/{stamps.total}</span>
        {moment && <Sunset size={15} aria-hidden="true" className="shrink-0 @5xl:hidden" data-sunset-hint="" />}
        <ChevronDown size={14} aria-hidden="true" className="shrink-0" />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={t("menu")} onKeyDown={onMenuKey}
          className={`panel !rounded-xl shadow-lg absolute ${end ? "right-0" : "left-0"} top-full mt-1 z-30 w-[min(16rem,calc(100vw-1.5rem))] p-1.5 flex flex-col gap-1`}>
          <button type="button" role="menuitem" className={`${itemCls}${passport ? " btn-primary" : ""}`} aria-label={passportLabel} title={passportLabel}
            aria-haspopup="dialog" onClick={run(() => setPassport(!passport))}>
            <Stamp size={15} aria-hidden="true" className="shrink-0" />
            <span className="truncate flex-1 text-left">{t("passport", { n: stamps.n, total: stamps.total })}</span>
          </button>
          <button type="button" role="menuitem" className={`${itemCls}${fast ? " btn-primary" : ""}`} aria-label={t("fast_aria")} title={t("fast_aria")}
            aria-haspopup="dialog" aria-disabled={!!ride || undefined} onClick={() => { if (ride) return; setOpen(false); setFast(!fast); }}>
            <Navigation size={16} aria-hidden="true" className="shrink-0" /><span className="truncate">{t("fast")}</span>
          </button>
          <button type="button" role="menuitem" className={itemCls} aria-label={t("home_aria")} title={t("home_aria")}
            onClick={run(() => { setFast(false); setPassport(false); exitCity(); onFocusWorld?.(); })}>
            <Home size={16} aria-hidden="true" className="shrink-0" /><span className="truncate">{t("home")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** yeni damganın okunur adı ("Semt · yer"). seyir noktası ve gizli köşe tür adıyla ("Seyir noktası 1",
 * "Gizli köşe 1") — ikisi de "#1" yazıyordu, satırlar birebir aynıydı.*/
function newStampName(city: string, id: string, t: (k: "new_gz" | "new_vp", v: { n: number }) => string): string {
  const p = parseCityId(id);
  if (!p?.district) return id;
  const where = districtName(city, p.district);
  const what = p.target ? landmarkName(city, p.target) : p.n ? t(p.kind === "gz" ? "new_gz" : "new_vp", { n: p.n }) : "";
  return what ? `${where} · ${what}` : where;
}

/** pasaport: semtler (damga yüzdesi, kilit kuralı) ve süresiz görevler.*/
function Passport({ city }: { city: string }) {
  const t = useT(CM);
  const found = useCity((s) => s.found);
  const locked = useCity((s) => s.locked);
  const view = useCity((s) => s.view);
  const rows = useMemo(() => {
    const ids = cityIds(city).filter((id) => !id.includes(":stop:"));
    return (view?.map.districts ?? []).map((d) => {
      const mine = ids.filter((id) => id === districtId(city, d.id) || id.startsWith(`${districtId(city, d.id)}:`));
      const got = mine.filter((id) => found.has(id)).length;
      return { id: d.id, got, total: mine.length, locked: locked.has(`${city}:${d.id}`), rule: unlockRule(city, d.id) };
    });
  }, [city, found, locked, view]);
  // kilitli semtin görevi sunucudaki gibi tamamlanmış görünmez
  const lockedHere = useMemo(() => new Set([...locked].filter((k) => k.startsWith(`${city}:`)).map((k) => k.slice(city.length + 1))),
    [city, locked]);
  const stale = useCity((s) => s.stale);
  const quests = useMemo(() => questProgress(city, found, lockedHere, stale), [city, found, lockedHere, stale]);
  const newIds = useCity((s) => s.newIds).filter((id) => id.startsWith(`city:${city}:`));
  return (
    <div className="flex flex-col gap-2 max-h-[min(60vh,28rem)] overflow-y-auto pr-1">
      {newIds.length > 0 && (
        <div role="status" className="panel !rounded-lg p-2 flex flex-col gap-1">
          <p className="text-sm font-semibold text-ink">{t("new_stamps", { n: newIds.length })}</p>
          <p className="text-xs text-ink-2">{t("new_stamps_note")}</p>
          <ul className="text-xs text-ink-2 list-disc pl-4">
            {newIds.map((id) => <li key={id}>{newStampName(city, id, t)}</li>)}
          </ul>
          <button type="button" className="btn min-h-11 self-start" onClick={() => ackNewStamps(city)}>{t("new_stamps_ack")}</button>
        </div>
      )}
      <h3 className="text-xs font-semibold text-ink-2 uppercase tracking-wide">{t("districts_title")}</h3>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-sm min-h-8">
            {r.locked ? <Lock size={14} aria-hidden="true" className="shrink-0 text-ink-2" /> : <Stamp size={14} aria-hidden="true" className="shrink-0 text-ink-2" />}
            <span className="truncate flex-1 text-ink">{districtName(city, r.id)}</span>
            {r.locked && r.rule
              ? <span className="text-xs text-ink-2 text-right">{t("locked_rule", { after: districtName(city, r.rule.after), level: r.rule.level })}</span>
              : <span className="tabular-nums text-ink-2" aria-label={t("district_aria", { got: r.got, total: r.total })}>{r.got}/{r.total}</span>}
          </li>
        ))}
      </ul>
      {quests.length > 0 && <>
        <h3 className="text-xs font-semibold text-ink-2 uppercase tracking-wide mt-1">{t("quests_title")}</h3>
        <ul className="flex flex-col gap-1">
          {quests.map(({ quest, got, done, locked: ql }) => (
            <li key={quest.id} className="flex items-center gap-2 text-sm min-h-8">
              {done ? <Check size={14} aria-hidden="true" className="shrink-0 text-ink" />
                : ql ? <Lock size={14} aria-hidden="true" className="shrink-0 text-ink-2" /> : <span className="w-3.5 shrink-0" aria-hidden="true" />}
              <span className="flex-1 text-ink">{questName(city, quest.id)}</span>
              <span className="tabular-nums text-ink-2" aria-label={done ? t("quest_done_aria")
                : t(ql ? "quest_locked_aria" : "quest_aria", { got, total: quest.need.length })}>{got}/{quest.need.length}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-2">{t("quests_note")}</p>
      </>}
    </div>
  );
}

/** Durakta hatlar + Hızlı seyahat listesi + pasaport (HUD `dock` yuvası). */
export function CityPanel({ onFocusWorld }: { onFocusWorld?: () => void }) {
  const t = useT(CM);
  const view = useCity((s) => s.view);
  const stop = useCity((s) => s.stop);
  const ride = useCity((s) => s.ride);
  const found = useCity((s) => s.found);
  const fast = useCity((s) => s.fast);
  const passport = useCity((s) => s.passport);
  const locked = useCity((s) => s.locked);
  const stopPanel = useCity((s) => s.stopPanel);
  const titleId = useId();
  const stopRef = useRef<HTMLElement>(null);
  const lockedStop = (s: string) => { const d = view?.map.stops.find((x) => x.id === s)?.district; return !!d && locked.has(`${view!.city}:${d}`); };
  // boş hat (kalan hedef yok) çip/panel açmaz; sayı VARIŞ sayısıdır, hat sayısı değil
  const allLines = view && stop && !ride ? stopLines(view.map, stop, lockedStop) : [];
  const lines = allLines.filter((l) => l.to.length);
  const dialog = fast || passport;
  // hatsız durak (ör. İstanbul `sultanahmet`) F / Yakındakiler ile açılınca boş kalmaz: not gösterilir; çip yine yalnız hatlı duraklarda
  const stopOpen = !!view && !ride && stopPanel && !dialog && lines.length > 0;
  // hatsız durak (ör. İstanbul `sultanahmet`) F / Yakındakiler ile açılınca boş kalmaz; çip yine yalnız hatlı duraklarda
  const noLineOpen = !!view && !ride && lines.length === 0 && stopPanelMode(0, stopPanel, !!stop, dialog) === "panel";
  const hideStop = () => { clearPanelArrival(); useCity.setState({ stopPanel: false }); onFocusWorld?.(); };
  useEscLayer(stopOpen, hideStop);
  useEscLayer(noLineOpen, hideStop); // Esc önce durak panelini kapatır, yürüme modundan çıkarmaz
  useEffect(() => { // açılınca odak ilk varışa (aksi halde odak gövdeye düşerdi) — odak dünyadaysa (F) yerinde kalır, panel duyurulur
    if (!stopOpen) return;
    if (!worldHasFocus(document.activeElement)) stopRef.current?.querySelector<HTMLElement>("[data-dest]")?.focus({ preventScroll: true });
    else announceWalk(t("stop_chip_aria", { stop: stopName(view!.city, stop!), n: lines.reduce((n, l) => n + l.to.length, 0) }));
  }, [stopOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!fast && !passport) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); useCity.setState({ fast: false, passport: false }); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [fast, passport]);
  if (!view || ride) return null;
  const visited = fast ? visitedStops(view.map, found).filter((s) => s !== stop) : [];
  if (noLineOpen) {
    return (
      <InHudZone zone="dock">
        <section className="panel !rounded-xl shadow-lg p-3 pointer-events-auto w-[min(22rem,100%)] flex flex-col gap-2" aria-labelledby={titleId} role="region">
          <div className="flex items-center gap-2">
            <h2 id={titleId} className="font-display text-sm font-semibold text-ink truncate flex-1">{t("stop_title", { stop: stopName(view.city, stop!) })}</h2>
            <button type="button" autoFocus className="btn min-h-11 min-w-11" aria-label={t("stop_hide")} title={t("stop_hide")} aria-expanded={true} onClick={hideStop}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <p className="text-sm text-ink-2">{t("stop_no_line")}</p>
        </section>
      </InHudZone>
    );
  }
  if (!lines.length && !dialog) return null;
  // durağa varınca (yolculuk, yürüyüş) hatlar paneli avatarın üstüne açılmaz — tek satır çip; tıklama,
  // F ya da Yakındakiler'den durak açar
  const nLines = lines.reduce((n, l) => n + l.to.length, 0);
  if (!dialog && !stopPanel) {
    return (
      <InHudZone zone="dock">
        <button type="button" data-dock-chip="" className="btn pointer-events-auto min-h-11 max-w-[min(22rem,100%)] justify-start shadow-lg" aria-expanded={false}
          aria-label={t("stop_chip_aria", { stop: stopName(view.city, stop!), n: nLines })} onClick={() => useCity.setState({ stopPanel: true })}>
          <TramFront size={16} aria-hidden="true" />
          <span className="truncate">{t("stop_chip", { stop: stopName(view.city, stop!), n: nLines })}</span>
        </button>
      </InHudZone>
    );
  }
  if (dialog) {
    // Hızlı seyahat ve pasaport kipli pencere — PanelShell (aria-modal, odak tuzağı, Esc) LiftPicker gibi
    return (
      <PanelShell label={passport ? t("passport_title") : t("fast")} closeLabel={t("close")} onClose={() => useCity.setState({ fast: false, passport: false })}
        title={<h2 className="font-display text-sm font-semibold text-ink truncate">{passport ? t("passport_title") : t("fast")}</h2>}>
        {passport && <Passport city={view.city} />}
        {fast && (visited.length ? (
          <ul className="flex flex-col gap-1.5" aria-label={t("fast_aria")}>
            {visited.map((s) => (
              <li key={s}>
                <button type="button" className="btn min-h-11 w-full justify-start" aria-label={t("fast_go", { stop: stopName(view.city, s) })}
                  onClick={() => { setFast(false); fastTravel(s); onFocusWorld?.(); }}>
                  <Navigation size={16} aria-hidden="true" /><span className="truncate">{stopName(view.city, s)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-2">{t("fast_none")}</p>)}
      </PanelShell>
    );
  }
  return (
    <InHudZone zone="dock">
      <section ref={stopRef} className="panel !rounded-xl shadow-lg p-3 short:p-2 pointer-events-auto w-[min(22rem,100%)] flex flex-col gap-2 short:gap-1.5 short:max-h-[calc(100dvh-11rem)] short:overflow-y-auto short:overscroll-contain" aria-labelledby={titleId}
        role="region">
        <div className="flex items-center gap-2">
          <h2 id={titleId} className="font-display text-sm font-semibold text-ink truncate flex-1">
            {t("stop_title", { stop: stopName(view.city, stop!) })}
          </h2>
          <button type="button" className="btn min-h-11 min-w-11" aria-label={t("stop_hide")} title={t("stop_hide")} aria-expanded={true} onClick={hideStop}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {/* yatay telefonda notlar yalnız ekran okuyucuda (panel sahne bandına sığsın)*/}
        {lines.some((l) => l.far.length) && <p className="text-xs text-ink-2 short:sr-only">{t("far_note")}</p>}
        {allLines.some((l) => l.line.stops.length - 1 > l.to.length) && <p className="text-xs text-ink-2 short:sr-only">{t("more_note")}</p>}
        {/* 3+ varışta dar bölümde ve yatay telefonda iki sütun (yatayda 4. hat kaydırma gerektiriyordu) — 4 hatlı Göreme panelinde (≈ 290 px) avatar panelin ardında kalıyordu*/}
        <div className="grid grid-cols-1 gap-2 short:gap-1.5 [&:has(>:nth-child(3))]:grid-cols-2 @md:[&:has(>:nth-child(3))]:grid-cols-1 short:[&:has(>:nth-child(3))]:!grid-cols-2">
        {lines.map(({ line, to, far }) => to.map((dest) => {
          const lock = lockedStop(dest);
          const fr = far.includes(dest) ? "_far" : "";
          const label = lock ? t("board_locked", { vehicle: vehicleName(line.kind, line.id), to: stopName(view.city, dest) })
            : t(`board${fr}_aria` as "board_aria", { vehicle: vehicleName(line.kind, line.id), to: stopName(view.city, dest) });
          return (
            <button key={`${line.id}:${dest}`} type="button" data-dest="" className={`btn min-h-11 justify-start${lock ? "" : " btn-primary"}`} aria-label={label} title={label}
              aria-disabled={lock} onClick={() => { if (boardLine(line.id, dest)) onFocusWorld?.(); }}>
              {lock ? <Lock size={16} aria-hidden="true" /> : <TramFront size={16} aria-hidden="true" />}
              <span className="min-w-0 text-left line-clamp-2 whitespace-normal [overflow-wrap:anywhere] leading-4">{t(`board${fr}` as "board", { vehicle: vehicleName(line.kind, line.id), to: stopName(view.city, dest) })}</span>
            </button>
          );
        }))}
        </div>
      </section>
    </InHudZone>
  );
}
