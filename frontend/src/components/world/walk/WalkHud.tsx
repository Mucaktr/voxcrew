/**
 * W2 (WALK-INT) — yürüme modu HUD'u: Çık düğmesi (her zaman görünür), kamera görünümü (V),
 * kısa kontrol ipucu, "Yakındakiler" listesi (klavye ve ekran okuyucuyla oynanabilir: öğe seçilince avatar oraya yürür),
 * etkileşim ipucu "F: etkileşim" ve dokunmatikte joystick + Etkileşim düğmesi.
 * W3 (WALK-UX): F / Enter / Etkileşim → Konuş paneli (ajan) ya da nesne paneli (pano, kahve, oturma, olta, masa);
 * taşınan çıktı çipi (Bırak) ve WALK-FUN mini oyun HUD'u burada bağlanır. Esc önce paneli kapatır.
 * W5 (WALK-W5): "Ben" avatar editörü düğmesi, emote çarkı (G / uzun basma), fotoğraf modu (P; HUD gizlenir, tembel yükleme),
 * birinci şahıs nişangâhı, ekran okuyucu duyuruları, iki parmak döndür/kıstır jestleri; alt sayfalar joystick'i örtmez.
 * EXP (E1b): çevre arazisindeyken "Çevre · biyom" etiketi ve "Ofise dön" (ExpanseChip).
 *
 * Yakındakiler bölümlü ("Yapılacak · Gör · Çevre"), öncelik sıralı ve gruplu ("Su ×8" tek satır); ad iki satıra sarılır,
 * adım ve yön alt satırda. bilgi kartı (info/*: çip, I, dokunma, Yakındakiler, mini harita). dar ekranda
 * Yakındakiler ve kart alttan açılan sayfa, dokunmatik Etkileşim düğmesi tam adı (iki satır) gösterir.
 *
 * Seçiciler kararlı referans döndürür (walkStore hazır seçicileri); joystick React dışında `walkRuntime.joy`'a yazar.
 * 375 px'te tek sütun, yatay taşma yok; dokunma hedefleri ≥ 44 px; hareket azaltmada animasyon yok (geçiş kullanılmıyor).
*/
import clsx from "clsx";
import { Aperture, BadgeCheck, Camera, ChevronDown, ChevronUp, Footprints, Hand, Info, Keyboard, LogOut, ScrollText, Smile, Users, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { tp, useT } from "../../../lib/i18n";
import { walk as WM } from "../../../locales/walk";
import { walkInfo as WIM } from "../../../locales/walkInfo";
import type { NearbyItem } from "../../../voxel/walk/controller";
import { EMOTE_EVENT, HELP_EVENT, JOY_RADIUS_PX, JoystickModel } from "../../../voxel/walk/input";
import { bindPanelGuard } from "../../../voxel/walk/panelGuard";
import {
  parsePanel, useWalkCarry, useWalkEmoteWheel, useWalkFocus, useWalkNearby, useWalkPanel, useWalkPhoto, useWalkStore, useWalkView, walkRuntime,
} from "../../../voxel/walk/walkStore";
import { announceWalk, WalkAnnouncer } from "./announce";
import { useEscLayer } from "./useEscLayer";
import { doEmote } from "./emoteActions";
import { ExpanseChip } from "./ExpanseChip";
import { CityChip, CityPanel } from "./city/CityHud";
import { InteriorChip } from "./explore/ExploreHud";
import { EntityPanel } from "./EntityPanel";
import { KeysCard } from "./KeysCard";
import { AerialButton } from "./AerialButton"; // WALK-ZOOM
import { StuckButton } from "./StuckButton";
import { LightToggle } from "./LightToggle"; // UXF-G
import { JumpButton } from "./JumpButton";
import { MinigameHudBridge } from "./funBridge";
import { useWalkGestures } from "./gestures";
import { insetBottom, JOY_ZONE, useBottomInset, useCoarse, useMedia, useRevealOnEnter, useShort } from "./media";
import { shortTargetLabel } from "./hudLayout";
import { useWalkSelectedId, useWalkSelection } from "./selection";
import { groupNearby, nearbyCycleOrder, type NearbySection } from "./selectLogic";
import { TalkPanel } from "./TalkPanel";
import { InfoCard, type InfoGoItem } from "./info/InfoCard";
import { InfoLayer } from "./info/InfoLayer";
import { openInfo, useInfoOpen } from "./info/infoStore";
import { infoKeyForPoi, infoNameOf, infoTargetOf, isInfoId } from "./info/infoTargets";
import { hudZoneRef, InHudZone, useHudZoneAvoidLabel, useHudZoneFilled, useHudZoneFollowEnd } from "./hudZones";
import { useBuildStore } from "../../../voxel/build/store";
import { useCity } from "../../../voxel/citymap/store";
import { firstPersonOn } from "../../../voxel/walk/rideCut";
import { bindWorldFocus, returnWorldFocus, returnWorldFocusSoon } from "../../../voxel/walk/worldFocus";
import { WalkProgress } from "./progress/WalkProgress";
import { WelcomeCard } from "../../welcome/WelcomeCard";
import { useWelcome } from "../../welcome/welcomeStore";

const PhotoMode = lazy(() => import("./PhotoMode"));
/** dikey dokunmatik küme mini haritanın üstünde başlar (çipte 4,25 rem), ızgaranın alt dolgusu kümenin üstünde
 * biter (küme ≈ 2 × 48 px + 8 px).*/
const TOUCH_BOTTOM = "max(4.25rem, calc(var(--mm-h, 0px) + 1.25rem))";
const TOUCH_TOP = "max(11rem, calc(var(--mm-h, 0px) + 8.25rem))";
const EmoteWheel = lazy(() => import("./EmoteWheel").then((m) => ({ default: m.EmoteWheel })));

export interface WalkHudProps {
  /** id → görünen ad (ajan adı); bilinmiyorsa tür sözcüğü */
  nameOf: (item: Pick<NearbyItem, "id" | "kind">) => string;
  onExit: () => void;
  /** F / Etkileşim: hedefin kimliği */
  onInteract: (id: string) => void;
  /** Yakındakiler: oraya yürü (dünya koordinatı) */
  onWalkTo: (x: number, z: number) => void;
  /** W3: panel kapanınca klavye odağını dünya kabına geri ver (yürüme tuşları) */
  onFocusWorld?: () => void;
  /** W5: dünya bölümü (jestler ve fotoğraf modu tuval katmanları için) */
  host?: RefObject<HTMLElement | null>;
  /** FIX-UX: Yakındakiler tür adı (ajan unvanı, "hayvan" …); adla aynıysa yazılmaz */
  typeOf?: (item: Pick<NearbyItem, "id" | "kind">) => string;
  /** CORE-WALK: F isteminin eylemi ("Demo 3 ile konuş", "Otur", "Geçitten şehre geç"); yoksa ad */
  actionOf?: (item: Pick<NearbyItem, "id" | "kind">) => string;
}

export function WalkHud({ nameOf: nameOfPage, typeOf: typeOfPage, actionOf, onExit, onInteract: onInteractPage, onWalkTo, onFocusWorld, host }: WalkHudProps) {
  const t = useT(WM);
  const ti = useT(WIM);
  // `info:` (simge bilgi kartı) girdileri sayfaya gitmez — ad, tür ve etkileşim burada
  const nameOf = useCallback((it: Pick<NearbyItem, "id" | "kind">) => (isInfoId(it.id) && infoNameOf(it.id)) || nameOfPage(it), [nameOfPage]);
  const typeOf = useCallback((it: Pick<NearbyItem, "id" | "kind">) => (isInfoId(it.id) ? "" : typeOfPage?.(it) ?? ""), [typeOfPage]);
  const openCard = useCallback((id: string) => { const c = infoTargetOf(id); if (!c) return false; openInfo(c); return true; }, []);
  const onInteract = useCallback((id: string) => { if (!openCard(id)) onInteractPage(id); }, [openCard, onInteractPage]);
  const infoOpen = useInfoOpen();
  // dar ekranda (< 640 px) Yakındakiler alttan açılan sayfa
  const narrow = useMedia("(max-width: 639px)");
  const view = useWalkView();
  const riding = useCity((s) => !!s.ride);
  const nearby = useWalkNearby();
  const focusId = useWalkFocus();
  const coarse = useCoarse();
  const short = useShort(); // yatay telefon
  const photo = useWalkPhoto();
  const wheel = useWalkEmoteWheel();
  const listId = useId();
  // INTERIOR-VIEW (Yakındakiler yeniden tasarım): varsayılan kapalı — sayaçlı küçük çip; tıklama ya da N açar. Açık hâli dar, yarı
  // saydam, yana yaslı liste; avatar açıldığı yerden 2 karo uzaklaşınca kendiliğinden kapanır (odak listedeyse çipe döner).
  const [open, setOpen] = useState(false);
  const nearbyBtn = useRef<HTMLButtonElement>(null);
  const nearbyList = useRef<HTMLDivElement>(null);
  // UXF-A: katmanlar (Anı defteri, Hoş geldin, Yakındakiler, mini oyun) kapanınca odak dünyaya döner — ortak yardımcı
  useEffect(() => bindWorldFocus(onFocusWorld), [onFocusWorld]);
  useEffect(() => bindPanelGuard(), []); // ışınlanma / dünya değişiminde açık panel ve mini oyun kapanır
  // Yakındakiler hangi yoldan kapanırsa kapansın (N, çip, ✕, uzaklaşınca) odak listede/çipteyse ya da düştüyse dünyaya döner
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) returnWorldFocusSoon(nearbyBtn.current);
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "n" && e.key !== "N") || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!open) return;
    const at = useWalkStore.getState().pose?.tile ?? null;
    return useWalkStore.subscribe((s, prev) => {
      if (!at || !s.pose || s.pose === prev.pose) return;
      if (Math.max(Math.abs(s.pose.tile[0] - at[0]), Math.abs(s.pose.tile[1] - at[1])) < 2) return;
      setOpen(false); // UXF-A: odak dünyaya (yukarıdaki kapanış etkisi; eskiden çipe dönüyordu → F ölü)
    });
  }, [open]);
  // W5-POLISH: "?" ya da klavye düğmesi → kısayol kartı (Esc kapatır, odak dünyaya döner)
  const [keys, setKeys] = useState(false);
  const closeKeys = () => { setKeys(false); onFocusWorld?.(); };
  const panel = parsePanel(useWalkPanel());
  const carry = useWalkCarry();
  const closePanel = () => { useWalkStore.getState().setPanel(null); onFocusWorld?.(); };
  const focusItem = focusId ? nearby.find((n) => n.id === focusId) ?? null : null;
  const focusName = focusItem ? nameOf(focusItem) : "";
  // CORE-WALK: F istemi eylemle başlar (bilgi kartı adı kendi başlığıdır)
  const focusAction = focusItem ? (!isInfoId(focusItem.id) && actionOf?.(focusItem)) || focusName : "";
  const noHost = useRef<HTMLElement | null>(null);
  useWalkGestures(host ?? noHost, true);
  // FIX-UX: alttaki öğeler sabit mobil alt çubuğun üstünde (--walk-inset-b)
  useBottomInset(host);
  // W5-POLISH: dar ekranda girişte dünya bölümü görünür alana kayar
  useRevealOnEnter(host);
  // UIUX-OVERLAP: üst çubuk sarılabilir (1–3 satır). Alt kenarı (bölümün üstünden px) `--walk-top` olarak dünya bölümüne
  // yazılır; ızgara dışında kalan katmanlar (kısayol kartı, Konuş/nesne paneli) bu çizginin altında başlar.
  const bar = useRef<HTMLDivElement>(null);
  const [barH, setBarH] = useState(68);
  useEffect(() => {
    const el = bar.current, sec = host?.current ?? null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const top = Math.round(el.getBoundingClientRect().bottom - (sec?.getBoundingClientRect().top ?? 0));
      setBarH(top);
      sec?.style.setProperty("--walk-top", `${top}px`);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => { ro.disconnect(); sec?.style.removeProperty("--walk-top"); };
  }, [photo, host]);
  // E3: yapı paneli açıkken Yakındakiler/görev satırı gizli (alt panel dünyanın çoğunu kullanır; üst üste binmesin)
  const building = useBuildStore((s) => s.active);
  const welcomeOpen = useWelcome((s) => !!s.open);
  // FIX-UX: Tab seçer ve duyurur; Enter/F ya da Yakındakiler tıklaması oraya yürür ve paneli açar
  // bölümlü ve gruplu satırlar (öncelik → mesafe); bilgi kartı olan bilgi noktası kartın satırına katılır
  const world = useWalkStore((s) => s.world);
  const groups = useMemo(() => {
    const cards = new Set(nearby.filter((n) => isInfoId(n.id)).map((n) => n.id.slice(5)));
    const items = cards.size ? nearby.filter((n) => { const k = infoKeyForPoi(world, n.id); return !k || !cards.has(k); }) : nearby;
    return groupNearby(items, nameOf);
  }, [nearby, nameOf, world]);
  const rowCount = groups.reduce((n, g) => n + g.rows.length, 0);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const order = useCallback(() => nearbyCycleOrder(groupsRef.current), []);
  const [around, setAround] = useState(false);
  const sel = useWalkSelection({ nameOf, typeOf, onInteract, onWalkTo, host, order, intercept: openCard });
  const selId = useWalkSelectedId();
  // Esc yığını — Yakındakiler listesi açıkken ilk Esc listeyi kapatır; otomatik yürüyüş (tıkla-git, "git ve aç")
  // sürüyorsa sonraki Esc rotayı iptal eder; ancak ondan sonraki Esc yürüme modundan çıkar (eskiden liste + rota varken mod kapanıyordu)
  const openRef = useRef(open);
  openRef.current = open;
  const routing = useWalkStore((s) => !!s.target);
  useEscLayer(open, () => setOpen(false), { id: "nearby" });
  useEscLayer(routing, () => {
    if (openRef.current) { setOpen(false); return; }
    sel.cancel();
    useWalkStore.getState().setTarget(null);
    announceWalk(ti("route_cancel"));
  }, { id: "route" });
  const selItem = selId ? nearby.find((n) => n.id === selId) ?? null : null;
  const target = selItem ?? focusItem;
  const targetName = selItem ? nameOf(selItem) : focusName;
  const act = (n: NearbyItem) => (isInfoId(n.id) ? onInteract(n.id) : n.id === focusItem?.id && !selItem ? onInteract(n.id) : sel.go(n));
  // karttan ritüel başlat — oraya yürü ve varınca başlat (Yakındakiler "git ve aç" ile aynı yol)
  const goFromCard = useCallback((it: InfoGoItem) => { sel.go({ ...it, reach: undefined }); }, [sel]);
  // 1–6 (çark kapalıyken de) → emote; input.ts olay olarak yayar
  useEffect(() => {
    const on = (e: Event) => { const i = (e as CustomEvent<number>).detail; if (typeof i === "number") doEmote(i); };
    window.addEventListener(EMOTE_EVENT, on);
    return () => window.removeEventListener(EMOTE_EVENT, on);
  }, []);
  useEffect(() => {
    const on = () => setKeys((v) => !v);
    window.addEventListener(HELP_EVENT, on);
    return () => window.removeEventListener(HELP_EVENT, on);
  }, []);

  // CITY-HUD: orta yuva doluyken ızgara satırı en az bir tost kadar yer ayırır; yuva kayarsa en yeni bildirim görünür kalır
  const midFilled = useHudZoneFilled("middle");
  // dar bölümde dock paneli (durak hatları, pasaport, Hızlı seyahat) açıkken alt-üst satır gizlenir: dikey yer orta yuvaya kalır
  const dockFilled = useHudZoneFilled("dock");
  // tek satır durak çipi panel sayılmaz — Görevler/Yakındakiler durakta da görünür (yalnız açık panel gizler)
  const dockPanel = useHudZoneFilled("dock", "[data-dock-chip]");
  // dikey dokunmatikte durak paneli açıkken alt sayfa gibi davranır — eylem kümesi (Etkileşim zaten bu durak) ve köşe
  // satırı gizlenir, panel joystick alanının hemen üstüne iner; avatarı hâlâ örterse FrameLift kadrajı yukarı kaydırır
  const stopSheet = useCity((s) => !!s.view && !s.ride && !!s.stop && s.stopPanel && !s.fast && !s.passport) && coarse && !short;
  // dokunmatik eylem kümesi (Zıpla · emote · Etkileşim) bu yüzeyler açıkken gizli; emote üst çubuğa geçer (erişilebilir kalır)
  const touchHidden = !!(panel || infoOpen || (open && narrow) || stopSheet);
  useHudZoneFollowEnd("middle");
  useHudZoneAvoidLabel("middle"); // toast "Ben" etiketini örtmez (üstünde kal; yer yoksa yanına dar)
  // emote çarkı başka yüzey (panel, kart, kısayollar, durak/pasaport yuvası) açılınca ve telefon dönünce kapanır;
  // dışarıya dokunuş (Şehir menüsü dahil) EmoteWheel'de
  const sheetOpen = !!(panel || infoOpen || keys || dockPanel);
  useEffect(() => { if (sheetOpen) useWalkStore.getState().setEmoteWheel(false); }, [sheetOpen]);
  useEffect(() => { useWalkStore.getState().setEmoteWheel(false); }, [short, narrow]);

  if (photo) {
    return (
      <>
        <WalkAnnouncer nameOf={nameOf} />
        <Suspense fallback={null}><PhotoMode host={host?.current ?? null} onFocusWorld={onFocusWorld} /></Suspense>
      </>
    );
  }

  const first = firstPersonOn(view, false, riding); // yolculukta kamera 3. şahıs (WalkRig ile aynı) — nişangâh/1. şahıs ipucu yok
  const hint = first ? t("fp_hint") : coarse ? t("hint_touch") : t("hint_keys");
  // simge düğmesi 44 px kare (yatay dolgu 12 px) — dikey telefonda 6 düğme tek satıra sığar (üst çubuk ≤ 2 satır)
  const iconBtn = "btn pointer-events-auto min-h-11 min-w-11 !px-3 justify-center";
  // bölümlü liste — "Yapılacak" (ritüel, ajan, oyun; sonra oturma/kahve), "Gör" (bilgi, simge, kapı), "Çevre" (hayvan ve
  // süs; varsayılan kapalı). Ad iki satıra sarılır (kırpma yok), adım ve yön alt satırda; aynı adlı süsler tek satır (×n).
  const nearbyListEl = (
    <div ref={nearbyList} id={listId} role="group" aria-label={t("nearby")}
      className={clsx("flex flex-col gap-1 px-1 pb-1 min-h-0 overflow-y-auto overscroll-contain", narrow ? "" : "max-h-[34vh]")}>
      {rowCount === 0 && <p className="px-2 py-1.5 text-xs text-muted">{t("nearby_empty")}</p>}
      {groups.map((g) => {
        const shut = g.section === "around" && !around;
        const label = ti(`nb_${g.section}` as `nb_${NearbySection}`);
        return (
          <section key={g.section} aria-label={label} className="flex flex-col gap-0.5">
            {g.section === "around"
              ? (
                <button type="button" onClick={() => setAround((v) => !v)} aria-expanded={!shut} aria-label={ti("nb_around_toggle", { n: g.rows.length })}
                  className="flex w-full items-center gap-1.5 rounded-lg px-2 min-h-11 text-xs font-semibold text-ink-2 hover:bg-panel-2 focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus)]">
                  <span className="flex-1 text-left">{label}</span>
                  <span className="chip num text-xs">{g.rows.length}</span>
                  {shut ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
                </button>
              )
              : <h3 className="px-2 pt-1 text-xs font-semibold text-ink-2">{label}</h3>}
            {!shut && (
              <ul className="flex flex-col gap-0.5">
                {g.rows.map((r) => {
                  const n = r.item;
                  const steps = n.reach === false ? t("unreachable") : tp(WM, "steps", n.steps);
                  const picked = n.id === selId;
                  const info = isInfoId(n.id);
                  const desc = r.count > 1 ? `${sel.describe(n)} (${ti("nb_count", { n: r.count })})` : sel.describe(n);
                  // tıklama: bilgi kartı hemen açılır; öteki hedefe yürür ve varınca paneli açar (yakınsa hemen)
                  return (
                    <li key={r.key}>
                      <button type="button" onClick={() => {
                        // UXF-A ( C): hedef seçilince avatar yürür ve odak dünyaya geçer — "F: …" ve WASD hemen çalışır
                        void (info ? onInteract(n.id) : sel.go(n));
                        if (!info) returnWorldFocus([nearbyList.current, nearbyBtn.current]);
                      }} aria-current={picked ? "true" : undefined} data-walk-target={n.id}
                        aria-label={info ? `${desc}. ${ti("nb_info_aria", { name: r.name })}` : `${desc}. ${t("nearby_go", { name: r.name, action: sel.actionText(n) })}`}
                        className={clsx("flex w-full items-start gap-2 rounded-lg px-2 py-1 min-h-11 text-left text-sm hover:bg-panel-2",
                          "focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus)]",
                          (picked || (!selId && n.id === focusId)) && "bg-panel-2", picked && "ring-2 ring-[color:var(--focus)]")}>
                        {info
                          ? <Info size={14} aria-hidden="true" className="shrink-0 mt-1 text-info" />
                          : <Footprints size={14} aria-hidden="true" className="shrink-0 mt-1 text-ink-2" />}
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold leading-5 break-words [overflow-wrap:anywhere]">{r.name}</span>
                          <span className="block text-xs text-ink-2 num leading-4">{steps} · {t(`dir_${n.bearing}` as const)}</span>
                        </span>
                        {r.count > 1 && <span className="chip num text-xs shrink-0 mt-0.5">×{r.count}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
  return (
    <>
      <WalkAnnouncer nameOf={nameOf} />
      {/* CITY-HUD: fotoğraf modu düğmesi eylem yuvasında (ince işaretçide üst çubuk sağı, dokunmatikte Etkileşim'in üstü) */}
      <InHudZone zone="actions">
        <button type="button" className={coarse ? "btn pointer-events-auto min-h-12 min-w-12 !p-0 grid place-items-center" : iconBtn} aria-keyshortcuts="P"
          onClick={() => useWalkStore.getState().setPhoto(true)} aria-label={t("photo_open_aria")} title={t("photo_open_aria")}>
          <Aperture size={coarse ? 18 : 16} aria-hidden="true" />
          {!coarse && <span className="hidden @4xl:inline">{t("photo_open")}</span>}
        </button>
      </InHudZone>
      {/* durakta hatlar ve Hızlı seyahat listesi (HUD `dock` yuvasına portallanır)*/}
      <CityPanel onFocusWorld={onFocusWorld} />
      {/* UIUX-OVERLAP: HUD yerleşim ızgarası — üst (çubuk · ipucu · alt-üst satır), orta (tostlar, notlar), alt (yapı paneli;
          köşe: keşif izleyicisi ve İnşa · ortada etkileşim ipucu · sağda mini harita sütunu boş). Parçalar aynı akışta dizildiği
          için çubuk sarılsa, panel açılsa ya da bölüm daralsa da üst üste binmez; başka dosyalardaki parçalar hudZones.tsx
          yuvalarına portallanır. Dokunmatikte alt satır joystick ve Etkileşim düğmelerinin üstünde başlar. */}
      {/* CITY-HUD: tek sütun minmax(0,1fr) — sarılmayan çipler sütunu bölümden genişletemez (375 px'te sağ kenarda kırpılma
          yoktu ama sütun taşıyordu); dokunmatikte alt boşluk eylem kümesinin (Zıpla · emote · fotoğraf/Etkileşim) üstünde biter */}
      {/* UX-P2: orta yuva üst bandın hemen altında (avatar 3B görünümün ortasında, üst ve alt bandın arasında açık kalır);
          dar bölümde (< @md) tek bildirim boyu (3,5 rem), genişte 8 rem — fazlası kendi içinde kayar, en yenisi görünür*/}
      {/* ızgara dokunmatik eylem kümesinin ve joystick'in (z-20, DOM'da sonra) üstünde — Şehir menüsü açılınca
          öğeleri kümenin altında kalıyor, "Pasaport"a dokunuş Fotoğraf modunu açıyordu. Yatay telefonda alt satır joystick alanında biter;
          yan dolgu çentik (safe-area) payını alır*/}
      <div className={clsx("absolute inset-0 z-[21] pointer-events-none grid grid-cols-[minmax(0,1fr)] gap-2 px-3 [--hud-mid-max:3.5rem] @md:[--hud-mid-max:8rem]",
        midFilled ? "grid-rows-[auto_minmax(0,auto)_minmax(3.75rem,1fr)_auto] @md:grid-rows-[auto_minmax(3.75rem,auto)_minmax(0,1fr)_auto]" : "grid-rows-[auto_minmax(0,auto)_minmax(0,1fr)_auto]")}
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))", paddingLeft: "max(0.75rem, env(safe-area-inset-left))", paddingRight: "max(0.75rem, env(safe-area-inset-right))",
          paddingBottom: coarse ? insetBottom(short || stopSheet ? JOY_ZONE : panel ? "7.5rem" : TOUCH_TOP) : insetBottom("0.75rem") }}>
          <div ref={bar} data-hud-bar="" className="flex flex-col items-start gap-2">
            {/* üst çubuk: sol bölge (Çık + konum) · sağ bölge (eylemler); dar bölümde sağ bölge alt satıra sarılır */}
            <div className="flex w-full flex-wrap items-start gap-1.5">
              <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
                <button type="button" className="btn btn-primary pointer-events-auto min-h-11 min-w-11" onClick={onExit} aria-label={t("exit_aria")} title={t("exit_aria")}>
                  <LogOut size={16} aria-hidden="true" />{t("exit")}
                </button>
                {/* EXP (E1b): çevredeyken "Çevre · biyom" ve "Ofise dön" (Esc'nin yanında) */}
                <ExpanseChip onFocusWorld={onFocusWorld} />
                {/* "Şehre çık" (ofiste kapıya yakınken) · şehirde "Şehir · semt", pasaport, Hızlı seyahat, "Ofise dön"*/}
                <CityChip onFocusWorld={onFocusWorld} />
                {/* WALK-EXPLORE: iç mekândayken ad/kat, "Dışarı çık" ve "Ofise dön" */}
                <InteriorChip onFocusWorld={onFocusWorld} />
              </div>
              <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">
                <button type="button" className={iconBtn} onClick={() => useWalkStore.getState().toggleView()} aria-keyshortcuts="V"
                  aria-label={t("view_aria", { mode: first ? t("view_first") : t("view_third") })} title={t("view_aria", { mode: first ? t("view_first") : t("view_third") })}>
                  <Camera size={16} aria-hidden="true" /><span className="hidden @2xl:inline short:!hidden">{first ? t("view_first") : t("view_third")}</span>
                </button>
                <button type="button" className={iconBtn} onClick={() => useWalkStore.getState().setEditor(true)} aria-label={t("me_open_aria")} title={t("me_open_aria")}>
                  <BadgeCheck size={16} aria-hidden="true" /><span className="hidden @4xl:inline">{t("me_open")}</span>
                </button>
                {/* dokunmatikte emote alttaki eylem kümesinde — üst çubukta ikinci kopya satırı sardırıyordu*/}
                {(!coarse || touchHidden) && <button type="button" data-emote-toggle="" className={clsx(iconBtn, wheel && "btn-primary")} aria-expanded={wheel} aria-haspopup="menu" aria-keyshortcuts="G"
                  onClick={() => useWalkStore.getState().setEmoteWheel(!wheel)} aria-label={t("emote_open_aria")} title={t("emote_open_aria")}>
                  <Smile size={16} aria-hidden="true" /><span className="hidden @4xl:inline">{t("emote_open")}</span>
                </button>}
                {/* CITY-HUD: eylem yuvası (ince işaretçi) — fotoğraf düğmesi buraya portallanır; dokunmatikte yuva alttaki eylem kümesidir */}
                {!coarse && <div ref={hudZoneRef("actions")} data-hud-zone="actions" className="contents" />}
                {/* STUCK-FIX (WALK-STUCK-001): "Takıldım" — son güvenli noktaya dön (U) */}
                <AerialButton onFocusWorld={onFocusWorld} />{/* WALK-ZOOM */}
                <StuckButton onFocusWorld={onFocusWorld} />
                {/* UXF-G: gündüz/gece kestirmesi*/}
                <LightToggle onFocusWorld={onFocusWorld} />
                {/* dikey dokunmatikte emote üst çubuğa geçince (panel/durak açık) kısayol kartı düğmesi yer açar — 7. simge
                    çubuğu 3 satıra çıkarıyordu; kart klavye içindir, panel kapanınca düğme geri gelir*/}
                {!(coarse && touchHidden && !short) && <button type="button" className={clsx(iconBtn, keys && "btn-primary")} aria-keyshortcuts="?" aria-expanded={keys} aria-haspopup="dialog"
                  onClick={() => (keys ? closeKeys() : setKeys(true))} aria-label={t("keys_open_aria")} title={t("keys_open_aria")}>
                  <Keyboard size={16} aria-hidden="true" /><span className="hidden @5xl:inline">{t("keys_open")}</span>
                </button>}
                {/* W3: taşınan çıktı (parşömen) — bırakılabilir */}
                {carry && (
                  <span className="chip !bg-panel/95 pointer-events-auto shadow max-w-full min-h-11 !pr-1 gap-1.5" role="status">
                    <ScrollText size={15} aria-hidden="true" className="shrink-0" />
                    <span className="truncate max-w-[12rem] font-semibold">{t("carry_chip", { title: carry.title })}</span>
                    <button type="button" className="btn btn-ghost btn-sm min-h-11 min-w-11 !p-0 grid place-items-center" aria-label={t("carry_drop_aria", { title: carry.title })}
                      title={t("carry_drop")} onClick={() => useWalkStore.getState().setCarry(null)}><X size={14} aria-hidden="true" /></button>
                  </span>
                )}
              </div>
            </div>
            {/* kısa kontrol ipucu: tek satır, sığmazsa üç noktayla kısalır (tam metin title ve Kısayollar kartında); dar bölümde gizli */}
            <p className="hidden @3xl:block short:!hidden max-w-full truncate rounded-full border border-line-soft bg-panel/90 px-2 py-0.5 text-xs font-semibold text-ink-2" title={hint}>
              {hint}
            </p>
          </div>

          {/* alt-üst satır: başta görev izleyici (yuva "under"), sonda Yakındakiler; yapı panelinde gizli. CITY-HUD: her
              genişlikte tek satır (dar bölümde kapalı çipler yan yana sığar; açık liste sığmazsa alt satıra sarılır) — satır
              kısa kalır, orta yuvaya yer kalır. */}
          <div className={clsx("min-h-0 flex flex-row flex-wrap items-start content-start gap-2", building && "hidden", !building && dockPanel && "hidden @xl:flex short:!hidden",
            welcomeOpen && "short:!hidden" /* yatayda karşılama kartı bu satırın yerini alır*/)}>
            <div ref={hudZoneRef("under")} className="contents" />
            {/* Yakındakiler; W3: panel açıkken gizli (üst üste binmesin). bilgi kartı açıkken de gizli (aynı sağ sütun).
                dar ekranda açık liste alttan açılan sayfadır (aşağıda); burada yalnız aç/kapa çipi kalır*/}
            <div className={clsx("ml-auto self-start min-h-11 max-h-full flex flex-col items-end pointer-events-auto", open && !narrow ? "w-[min(16rem,100%)]" : "w-auto",
              (panel || wheel || keys || infoOpen) && "hidden")}>
              <div className={clsx("min-h-0 max-h-full flex flex-col rounded-xl border border-line-soft shadow", open && !narrow ? "w-full bg-panel/80 backdrop-blur-sm" : "bg-panel/95")}>
                <button ref={nearbyBtn} type="button" className="flex w-full items-center gap-1.5 px-2.5 min-h-11 text-sm font-semibold rounded-xl focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                  aria-expanded={open} aria-controls={listId} aria-keyshortcuts="N" title={ti("nb_rows", { n: rowCount })}
                  aria-label={ti("nb_rows", { n: rowCount })} onClick={() => setOpen((v) => !v)}>
                  <Users size={15} aria-hidden="true" className="text-ink-2 shrink-0" />
                  <span className={clsx("text-left", open && !narrow ? "flex-1" : "hidden @3xl:inline")}>{t("nearby")}</span>
                  <span className="chip num text-xs">{rowCount}</span>
                </button>
                {open && !narrow && nearbyListEl}
              </div>
            </div>
          </div>

        {/* orta: tostlar ve notlar üste yaslı (UX-P2). CITY-HUD: yuva en çok --hud-mid-max yüksekliğinde; sığmazsa kendi içinde kayar
            (kırpmaz, kapatma düğmeleri yapışkan) ve en yeni bildirim görünür kalır; doluyken satır en az bir tost kadar yer ayırır */}
        {/* UXF-D: Hoş geldin kartı açıkken orta yuva (tost, not, kat adı) gizli bekler — kartla aynı anda çıkmaz*/}
        {/* geniş bölümde (≥ @md) yuva 2. ızgara satırında — üst çubuğun hemen altında, görev/Yakındakiler satırının üstünde
            (eskiden o satırın altında, 1280×800'de y≈355'te avatarın başı üstündeydi); alt-üst satır kendiliğinden 3. satıra iner. Dar
            bölümde alt-üst satır tek sıra çiptir: tost onun altında kalır (üste alınca çipler "Ben" etiketine iniyordu)*/}
        <div ref={hudZoneRef("middle")} data-hud-zone="middle" hidden={welcomeOpen || undefined}
          className="@md:row-start-2 self-start min-h-0 max-h-[min(100%,var(--hud-mid-max),var(--hud-mid-cap,100vh))] overflow-x-hidden overflow-y-auto overscroll-contain flex flex-col items-center gap-1.5 [scrollbar-width:thin]" />

        {/* alt: yapı paneli, sonra köşe + etkileşim ipucu; sağda mini harita sütunu (--mm-w) boş kalır, satır en az harita
            yüksekliğinde (--mm-h): üstteki satırlar haritanın üstünde biter */}
        <div className="row-start-4 flex min-w-0 flex-col justify-end gap-2" /* alt satır hep son ızgara satırında — kart açıkken orta + "under" gizlenince 2. (auto) satıra kayıyor, kart dikey ekranda simge/avatar bandına biniyordu*/
          style={coarse ? undefined : { paddingRight: "calc(var(--mm-w, 2.25rem) + 0.5rem)", minHeight: "var(--mm-h, 0px)" }}>
          {/* yatay telefonda durak paneli solda (avatar ortada, panelin yanında kalır); köşe satırı o sırada gizli*/}
          <div ref={hudZoneRef("dock")} data-hud-zone="dock" className="flex flex-col items-center short:items-start empty:hidden" />
          {/* UXF-G: dar ekranda "F: …" ipucu 1 harflik sütuna çökmesin → satır sarılır, ipucu en az 8 rem*/}
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <div className={clsx("flex min-w-0 max-w-full flex-col items-start gap-2 empty:hidden", dockFilled && "short:!hidden", stopSheet && "hidden", welcomeOpen && "short:!hidden" /**/)}>
              <div ref={hudZoneRef("corner")} className="contents" />
              <div ref={hudZoneRef("cornerEnd")} className="contents" />
            </div>
            {/* etkileşim ipucu: ekran okuyucuya duyurulur; dokunmatikte düğme etiketi olur */}
            {/* FIX-UX: Tab seçimi varken ipucu seçili hedefi gösterir (duyuruyu announcer yapar; burada yalnızca görsel) */}
            <div className="flex-1 min-w-[min(8rem,100%)] flex justify-center" aria-live="polite" role="status">
              {/* dokunmatikte "Enter:" öneki yok (Etkileşim düğmesi aynı işi yapar)*/}
              {selItem && !panel && <span className="chip !bg-panel/95 font-semibold shadow max-w-full !whitespace-normal !rounded-xl py-1" aria-hidden="true"><span className="min-w-0 break-words [overflow-wrap:anywhere]">{t(coarse ? "sel_hint_touch" : "sel_hint", { name: targetName, action: sel.actionText(selItem) })}</span></span>}
              {!selItem && focusItem && !coarse && !panel && <span className="chip !bg-panel/95 font-semibold shadow max-w-full !whitespace-normal !rounded-xl py-1"><span className="min-w-0 break-words [overflow-wrap:anywhere]">{t("interact_named", { name: focusAction })}</span></span>}
              {!selItem && focusItem && coarse && <span className="sr-only">{t("interact_named", { name: focusAction })}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* W5: birinci şahıs nişangâhı (yalnız görsel; F bakılan hedefi seçer) */}
      {first && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none" aria-hidden="true">
          <span className={clsx("block h-3 w-3 rounded-full border-2", focusItem ? "border-white bg-primary" : "border-white/90 bg-black/30")}
            style={{ boxShadow: "0 0 0 1px rgba(0,0,0,.55)" }} />
        </div>
      )}

      {/* W3: Konuş paneli / nesne paneli (F, Enter ya da Etkileşim; yakınlıkla kendiliğinden açılmaz) */}
      {panel?.kind === "talk" && <TalkPanel key={panel.id} slug={panel.id} onClose={closePanel} />}
      {panel?.kind === "ent" && <EntityPanel key={panel.id} id={panel.id} onClose={closePanel} />}
      {MinigameHudBridge && <MinigameHudBridge onFocusWorld={onFocusWorld} />}
      {/* W4: hatıralar, simge keşfi, tostlar ve görev izleyici */}
      <WalkProgress />
      {/* şehre ilk girişte "Hoş geldin" kartı (panel yuvası, bir kez)*/}
      <WelcomeCard />
      {/* bilgi kartı tetikleri (çip, I, dokunma) ve kartın kendisi (modal değil)*/}
      <InfoLayer host={host} onFocusWorld={onFocusWorld} />
      {!panel && <InfoCard onGo={goFromCard} onWalkTo={onWalkTo} onFocusWorld={onFocusWorld} />}
      {/* dar ekranda Yakındakiler alttan açılan sayfa (dokunmatikte joystick alanının üstünde biter)*/}
      {open && narrow && !(panel || wheel || keys || infoOpen) && (
        <div role="region" aria-label={t("nearby")} data-walk-nearby-sheet=""
          className="absolute inset-x-0 z-30 flex flex-col panel !rounded-b-none !rounded-t-2xl shadow-2xl pointer-events-auto"
          style={coarse
            ? { bottom: insetBottom(JOY_ZONE), maxHeight: `calc(100% - ${JOY_ZONE} - 4.25rem - var(--walk-inset-b, 0px))` }
            : { bottom: "var(--walk-inset-b, 0px)", paddingBottom: "env(safe-area-inset-bottom)", maxHeight: "calc(60% - var(--walk-inset-b, 0px))" }}>
          <div className="flex items-center gap-2 px-3 pt-2 pb-1 border-b border-line">
            <Users size={16} aria-hidden="true" className="text-ink-2 shrink-0" />
            <h2 className="font-display font-semibold text-base flex-1 min-w-0">{t("nearby")}</h2>
            <button type="button" className="btn btn-ghost min-h-11 min-w-11 !p-0 grid place-items-center shrink-0" aria-label={ti("nb_close")} title={ti("nb_close")}
              onClick={() => setOpen(false)}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex flex-col overflow-hidden pt-1">{nearbyListEl}</div>
        </div>
      )}
      {/* W5-POLISH: kısayol kartı*/}
      {keys && !panel && <KeysCard coarse={coarse} top={barH} hint={hint} onClose={closeKeys} />}
      {/* W5: emote çarkı */}
      {wheel && <Suspense fallback={null}><EmoteWheel onFocusWorld={onFocusWorld} /></Suspense>}

      {coarse && (
        <>
          <Joystick label={t("joystick")} />
          {/* panel (alt sayfa) açıkken gizli: Etkileşim zaten kapalı, sayfanın kenarı düğmeleri örtmesin */}
          {/* FIX-UX: alt çubuğun (ve safe-area'nın) üstünde; seçim varsa Etkileşim seçili hedefe gider.
              INTERIOR-VIEW: mini harita sütununun (--mm-w) solunda — harita başlığı ve kat seçiciyle çakışmaz*/}
          {/* iki satır — üstte eylem yuvası (fotoğraf) + Zıpla + emote, altta Etkileşim tam adla (en çok iki satır, kırpma
              yok; tam ad aria-label'da da). Bilgi kartı ya da Yakındakiler alt sayfası açıkken gizli (sayfa düğmeleri örtmesin)*/}
          {/* yatay telefonda küme alt kenarda ve dar: avatar sütunu (orta) açık kalır*/}
          {/* dikeyde küme sağ kenara yaslı ve mini haritanın ÜSTÜNDE (--mm-h); eskiden haritanın solundaydı, açık
              haritada (--mm-w 168 px) sağa yaslı satır sola taşıyor, Fotoğraf (x=−91) ve Anı defteri (x=−35) ekran dışında kalıyordu.
              Yatayda harita solunda kalır, satır sarılır: küme avatar sütununa (orta) girmez*/}
          <div data-walk-touch="" className={clsx("absolute z-20 flex flex-col items-end gap-2", short ? "max-w-[calc(50%-var(--mm-w,2.25rem)-3rem)]" : "max-w-[calc(100%-1.5rem)]", touchHidden && "hidden")}
            style={short
              ? { bottom: insetBottom("0.75rem"), right: "calc(var(--mm-w, 2.25rem) + max(0.75rem, env(safe-area-inset-right)))" }
              : { bottom: insetBottom(TOUCH_BOTTOM), right: "max(0.75rem, env(safe-area-inset-right))" }}>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {/* CITY-HUD: eylem yuvası (dokunmatik): küme genişlemez, joystick ve köşe satırıyla çakışmaz */}
              <div ref={hudZoneRef("actions")} data-hud-zone="actions" className="flex flex-wrap items-center justify-end gap-2 empty:hidden" />
              {/* WALK-PHYS: Zıpla (Boşluk) */}
              <JumpButton label={t("jump_button")} />
              <button type="button" data-emote-toggle="" className={clsx("btn min-h-12 min-w-12 !p-0 grid place-items-center", wheel && "btn-primary")} aria-expanded={wheel} aria-haspopup="menu"
                onClick={() => useWalkStore.getState().setEmoteWheel(!wheel)} aria-label={t("emote_open_aria")}>
                <Smile size={18} aria-hidden="true" />
              </button>
            </div>
            <button type="button" disabled={!target || !!panel} onClick={() => target && act(target)}
              className="btn btn-primary min-h-12 min-w-12 max-w-full px-2.5 py-1 gap-1.5"
              aria-label={target ? t("interact_button_named", { name: targetName }) : t("interact_button")} title={target ? targetName : undefined}>
              <Hand size={18} aria-hidden="true" className="shrink-0" />
              {/*.btn nowrap'ı devralınca line-clamp hiç sarmıyor, ad kırpılıyordu ("Durak: Beyazıt (Kapalıçarş…") —
                  sarılır ve önek atılır ("Beyazıt (Kapalıçarşı)"); tam ad aria-label ve title'da*/}
              <span className="min-w-0 text-left text-sm leading-4 line-clamp-2 whitespace-normal break-words [overflow-wrap:anywhere]">{target ? shortTargetLabel(targetName) : t("interact_button")}</span>
            </button>
          </div>
        </>
      )}
    </>
  );
}

/** Sol alt sanal joystick: 60 px taban, 88 px dokunma alanı; ilk parmak sahiplenir (input.ts JoystickModel; W5 ölü bölge). */
function Joystick({ label }: { label: string }) {
  const model = useRef(new JoystickModel(JOY_RADIUS_PX));
  const knob = useRef<HTMLSpanElement>(null);
  const paint = () => {
    const k = knob.current, m = model.current;
    if (k) k.style.transform = `translate(${m.kx}px, ${m.ky}px)`;
    m.vector(walkRuntime.joy);
  };
  useEffect(() => () => { walkRuntime.joy.x = 0; walkRuntime.joy.y = 0; }, []);
  const centre = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  };
  return (
    <div role="img" aria-label={label} data-walk-joystick="" className="absolute z-20 h-[88px] w-[88px] grid place-items-center touch-none select-none"
      style={{ bottom: insetBottom("0.75rem"), left: "max(0.75rem, env(safe-area-inset-left))" }}
      onPointerDown={(e) => {
        const [cx, cy] = centre(e);
        if (!model.current.start(e.pointerId, cx, cy)) return;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* işaretçi zaten bırakıldı (sentetik/iptal edilen dokunuş) */ }
        model.current.move(e.pointerId, e.clientX, e.clientY);
        paint();
      }}
      onPointerMove={(e) => { if (model.current.move(e.pointerId, e.clientX, e.clientY)) paint(); }}
      onPointerUp={(e) => { if (model.current.end(e.pointerId)) paint(); }}
      onPointerCancel={(e) => { if (model.current.end(e.pointerId)) paint(); }}>
      <span className="grid h-[60px] w-[60px] place-items-center rounded-full border-2 border-line bg-panel/80 shadow" aria-hidden="true">
        <span ref={knob} className="block h-7 w-7 rounded-full border-2 border-line bg-ink-2" />
      </span>
    </div>
  );
}
