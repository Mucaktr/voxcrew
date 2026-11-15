/**
 * bilgi kartı tetikleri (hiçbiri kendiliğinden kart açmaz):
 * - **Yaklaşma çipi**: simgeye yaklaşınca (sahne 3, şehir 4 karo) üst satırda "Galata Kulesi · Bilgi (I)" çipi; 6 sn sonra
 * küçülür ("Bilgi (I)"). Ekran okuyucuya oturumda simge başına bir kez kibar duyuru (WalkAnnouncer, aria-live polite).
 * - **Bakış çipi**: avatarın baktığı yönde 25 karo içindeki simgeye 1,2 sn bakınca aynı çip (duyurusuz; hareket azaltmada da).
 * - **I**: kartı aç/kapa (çipin simgesi, F hedefi, bakılan simge, yakındaki simge ya da şehirde semt kartı).
 * - **Dokunma / tıklama**: simgeye tıklayınca tıkla-git yerine kart (dünya tıklaması hedef karoyu yazar; bu katman hedefin
 * simge ayak izinde ya da ışının simge gövdesinde olduğunu görürse yürümeyi iptal edip kartı açar).
 * - Yakındakiler ("Gör" bölümü, `info:` satırları) ve mini harita (CityMiniMap) `openInfo` çağırır.
 * Hareket azaltmada çip geçişsiz; dokunma hedefi ≥ 44 px.
*/
import { Info, Mountain } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useT } from "../../../../lib/i18n";
import { walkInfo as WIM } from "../../../../locales/walkInfo";
import { useCity } from "../../../../voxel/citymap/store";
import { useWalkPhoto, useWalkPose, useWalkStore, walkRuntime } from "../../../../voxel/walk/walkStore";
import { announceWalk } from "../announce";
import { InHudZone } from "../hudZones";
import { closeInfo, infoFocus, openInfo, useInfo, useInfoChip, useInfoOpen } from "./infoStore";
import { districtTarget, infoName, infoTargetByKey, infoTargetOf, infoTargets, type InfoTarget } from "./infoTargets";
import { stopLandmarkView, useLandmarkView, type LandmarkViewState } from "../../../../voxel/walk/landmarkView";
import {
  APPROACH_CITY, APPROACH_SCENE, CHIP_SHRINK_MS, DWELL0, dwellStep, firstTime, LOOK_LINGER_MS, LOOK_RANGE, lookHit, nearestWithin, tapHit, tileOfX, tileOfZ,
  type Dwell, type Tile,
} from "./infoLogic";

/** Oturumda duyurulmuş simgeler (sayfa yenilenene dek). */
const announced = new Set<string>();
/**
 * UXF-B: yaklaşma çipi bu kadar ms sonra kalkar (6 sn'de küçülür, 12 sn'de gider); avatar o simgenin yaklaşma
 * menzilinden çıkana dek aynı simge için yeniden açılmaz (Boğaz Köprüsü çipi Sultanahmet'e kadar ekranda kalıyordu). I tuşu
 * çip olmadan da en yakın simgeyi açar.
*/
export const CHIP_HIDE_MS = 12000;
let restingKey: string | null = null;
/** Tuvalde basıştan sonra bu kadar ms içinde gelen tıkla-git hedefi "dokunma" sayılır (R3F onClick bırakışta gelir; sürükleme
 *  tıklama üretmez). */
const TAP_WINDOW_MS = 800;

const tileNow = (): Tile => [tileOfX(walkRuntime.avatar.x), tileOfZ(walkRuntime.avatar.z)];

/** `I` için hedef: çip → F hedefi (`info:`) → bakılan simge → en yakın simge (8 karo) → şehirde semt kartı. */
export function infoForKey(): InfoTarget | null {
  const chip = useInfo.getState().chip;
  if (chip) return chip.target;
  const focus = useWalkStore.getState().focusId;
  const f = focus ? infoTargetOf(focus) : null;
  if (f) return f;
  const list = infoTargets();
  const a = walkRuntime.avatar;
  return lookHit(a.x, a.z, a.heading, list, LOOK_RANGE) ?? nearestWithin(tileNow(), list, 8) ?? districtTarget();
}

export function toggleInfoKey(noneText: string): void {
  if (useInfo.getState().open) { closeInfo(); return; }
  const t = infoForKey();
  if (t) openInfo(t);
  else announceWalk(noneText);
}

/** manzara hedefinin görünen adı (kart anahtarı ya da aynı ayak izli bilgi hedefi); bulunamazsa null.*/
function viewName(v: Pick<LandmarkViewState, "key" | "rect">): string | null {
  const byKey = v.key ? infoTargetByKey(v.key) : null;
  const r = v.rect;
  const hit = byKey ?? (r ? infoTargets().find((x) => x.rect.i0 === r.i0 && x.rect.j0 === r.j0) ?? null : null);
  return hit ? infoName(hit) : null;
}

export function InfoLayer({ host, onFocusWorld }: { host?: RefObject<HTMLElement | null>; onFocusWorld?: () => void }) {
  const t = useT(WIM);
  const pose = useWalkPose();
  const photo = useWalkPhoto();
  const city = useCity((s) => s.view);
  const chip = useInfoChip();
  const open = useInfoOpen();

  useEffect(() => { infoFocus.world = onFocusWorld ?? null; return () => { infoFocus.world = null; }; }, [onFocusWorld]);
  const viewing = useLandmarkView((s) => s.active);

  // ---- yaklaşma (karo değişince)
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    if (!pose) return;
    const list = infoTargets();
    const near = nearestWithin(pose.tile as Tile, list, city ? APPROACH_CITY : APPROACH_SCENE);
    const cur = useInfo.getState().chip;
    // UXF-B: süresi dolmuş çip menzilden çıkana dek yeniden açılmaz
    if (restingKey && near?.key !== restingKey) restingKey = null;
    if (near && near.key === restingKey) { if (cur?.via === "near") useInfo.setState({ chip: null }); return; }
    if (near) {
      if (cur?.target.key !== near.key || cur.via !== "near") useInfo.setState({ chip: { target: near, via: "near", at: performance.now() } });
      if (firstTime(announced, near.key)) announceWalk(tRef.current("chip_ann", { name: infoName(near) }));
    } else if (cur?.via === "near") useInfo.setState({ chip: null });
  }, [pose, city]);

  // ---- bakış (4 Hz): yaklaşma çipi yokken
  useEffect(() => {
    let dwell: Dwell = DWELL0, lastHit = 0;
    const id = window.setInterval(() => {
      const st = useWalkStore.getState();
      if (!st.active || st.photo) return;
      const cur = useInfo.getState().chip;
      if (cur?.via === "near") { dwell = DWELL0; return; }
      const a = walkRuntime.avatar, now = performance.now();
      const hit = lookHit(a.x, a.z, a.heading, infoTargets(), LOOK_RANGE);
      if (hit) lastHit = now;
      const r = dwellStep(dwell, hit?.key ?? null, now);
      dwell = r.next;
      if (r.fire && hit && cur?.target.key !== hit.key) useInfo.setState({ chip: { target: hit, via: "look", at: now } });
      else if (cur?.via === "look" && !hit && now - lastHit > LOOK_LINGER_MS) useInfo.setState({ chip: null });
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  // ---- manzara kipi duyurusu (kibar canlı bölge: "Manzara: Galata Kulesi. Esc ya da L ile dön.") ve hedef yok
  useEffect(() => useLandmarkView.subscribe((s, p) => {
    if (s.active && !p.active) { const name = viewName(s); announceWalk(name ? tRef.current("lv_on", { name }) : tRef.current("lv_on_any")); }
    else if (s.missAt !== p.missAt && s.missAt) announceWalk(tRef.current("lv_miss"));
  }), []);

  // ---- I: aç/kapa (yazı alanında değilken; kart içindeki I'yı kart kendisi işler)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "i" && e.key !== "I") || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const st = useWalkStore.getState();
      if (!st.active || st.photo || st.editor) return;
      toggleInfoKey(tRef.current("none"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- Esc: kart açıkken önce kartı kapatır (dünya kabındaki Esc yürüme modundan çıkmasın)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("[data-walk-info]")) return; // kartın kendi işleyicisi
      if (el?.closest?.('[role="dialog"]')) return; // başka panel
      e.preventDefault();
      e.stopPropagation();
      closeInfo();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  // ---- dokunma: dünya tıklaması tıkla-git hedefi yazınca simgeye mi tıklandı?
  useEffect(() => {
    const el = host?.current;
    if (!el) return;
    // kabarcık evresi (yakalama değil): dünya tıklamalarını hiçbir koşulda durdurmaz, yalnız tuvaldeki basışın anını not eder
    let clickAt = -1e9;
    const onDown = (e: PointerEvent) => { clickAt = (e.target as HTMLElement | null)?.tagName === "CANVAS" ? performance.now() : -1e9; };
    el.addEventListener("pointerdown", onDown);
    const unsub = useWalkStore.subscribe((s, prev) => {
      if (!s.target || s.target === prev.target || !s.active || s.photo || s.panel) return;
      if (performance.now() - clickAt > TAP_WINDOW_MS) return;
      clickAt = -1e9;
      const hit = tapHit(walkRuntime.avatar, s.target, infoTargets());
      if (!hit) return;
      // tıkla-git yerine kart: hedef avatarın kendi karosuna (şehir yeniden planlayıcısı hedefi unutur), sonra yok
      const here = tileNow();
      queueMicrotask(() => { const ws = useWalkStore.getState(); ws.setTarget(here); ws.setTarget(null); openInfo(hit); });
    });
    return () => { el.removeEventListener("pointerdown", onDown); unsub(); };
  }, [host]);

  // ---- çip küçülmesi (6 sn)
  const [, tick] = useState(0);
  useEffect(() => {
    if (!chip) return;
    const left = CHIP_SHRINK_MS - (performance.now() - chip.at);
    if (left <= 0) return;
    const id = window.setTimeout(() => tick((n) => n + 1), left + 20);
    return () => window.clearTimeout(id);
  }, [chip]);
  // UXF-B: yaklaşma çipi 12 sn sonra kalkar (bakış çipi kendi kuralıyla, bakış bitince)
  useEffect(() => {
    if (!chip || chip.via !== "near") return;
    const id = window.setTimeout(() => {
      const cur = useInfo.getState().chip;
      if (cur === chip) { restingKey = chip.target.key; useInfo.setState({ chip: null }); }
    }, Math.max(0, CHIP_HIDE_MS - (performance.now() - chip.at)));
    return () => window.clearTimeout(id);
  }, [chip]);

  // manzara kipinde çip yerine "Manzara · Dön (Esc)" (dokunmatikte de kipten çıkış; Esc/L klavyede)
  if (viewing && !photo) return (
    <InHudZone zone="under">
      <button type="button" data-walk-view-back="" onClick={() => { stopLandmarkView(); onFocusWorld?.(); }} aria-keyshortcuts="Escape L"
        aria-label={t("lv_back_aria")} title={t("lv_back_aria")}
        className="chip !bg-panel/95 !rounded-xl pointer-events-auto shadow min-h-11 min-w-11 gap-1.5 !px-2.5 font-semibold text-sm text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]">
        <Mountain size={15} aria-hidden="true" className="shrink-0 text-info" />
        {/* dokunmatikte "(Esc)" yok*/}
        <span className="min-w-0 break-words text-left leading-4 pointer-coarse:hidden">{t("lv_back")}</span>
        <span className="min-w-0 break-words text-left leading-4 hidden pointer-coarse:inline">{t("lv_back_touch")}</span>
      </button>
    </InHudZone>
  );
  if (!chip || photo || open?.key === chip.target.key) return null;
  const name = infoName(chip.target);
  const small = performance.now() - chip.at >= CHIP_SHRINK_MS;
  return (
    <InHudZone zone="under">
      <button type="button" data-walk-info-chip="" onClick={() => openInfo(chip.target)} aria-keyshortcuts="I"
        aria-label={t("chip_aria", { name })} title={t("chip_aria", { name })}
        className="chip !bg-panel/95 !whitespace-normal !rounded-xl pointer-events-auto shadow min-h-11 min-w-11 max-w-full gap-1.5 !px-2.5 font-semibold text-sm text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]">
        <Info size={15} aria-hidden="true" className="shrink-0 text-info" />
        {/* dokunmatikte "(I)" klavye ipucu yok*/}
        <span className="min-w-0 break-words text-left leading-4 pointer-coarse:hidden">{small ? t("chip_short") : t("chip", { name })}</span>
        <span className="min-w-0 break-words text-left leading-4 hidden pointer-coarse:inline">{small ? t("chip_short_touch") : t("chip_touch", { name })}</span>
      </button>
    </InHudZone>
  );
}
