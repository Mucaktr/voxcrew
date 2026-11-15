/**
 * şehre ilk girişte "Hoş geldin" kartı.
 *
 * Modal değil: dünya görünür kalır, yürüme sürer; kart HUD'un panel yuvasında (`dock`: alt satırın üstü, mini harita sütunu
 * dışı; UXF-D: yuvanın bitiş (sağ) yanında — avatarın önünü kapatmaz; açıkken tost ve notlar bekler, `holdWalkToasts`; yapı paneli ve şehir paneliyle aynı yer, UIUX-OVERLAP — orta yuva tost boyudur, avatarın önü açık kalır) üç öneri
 * gösterir (simge · yakında yapılacak bir şey · seyir noktası). Haritada her önerinin "Git" düğmesi oraya yürütür ve kartı
 * kapatır. Kart bir kez açılır (`welcomeStore`), × ya da Esc kapatır; "Bir daha gösterme" ayarı kapatır.
 *
 * Erişilebilirlik: `role="dialog"` + `aria-modal="false"`, başlık `h2`; açılışta odak çalınmaz (WASD yürüyüşü dünya kabında
 * sürer), açılış ekran okuyucuya duyurulur; düğmeler HUD sekme sırasındadır, en az 44 px. Esc (pencere, yakalama evresi) önce
 * kartı kapatır, sonraki Esc yürüme modundan çıkar; yazı alanında ya da modal açıkken Esc'e karışmaz. Hareket azaltmada geçiş
 * yok (`motion-safe`). ARRE: kart simgenin karşı yanında (simge sağda/ortada → sol-alt, solda → sağ-alt; `cityArrivalView.side`) (canlı ölçü); 375 px'te tam genişlikli kısa alt sayfa (satır başlıkları yalnız ekran okuyucuya). dar dikey ekranda kart en çok 9,5 rem (kayar, başlık + × yapışkan) — 284 px kart simgenin alt yarısını ve avatarı örtüyordu (<city>/igne %77).
 *
 * Bağlama: `WalkHud.tsx` içinde tek satır (`<WelcomeCard />`, `WalkProgress`'in yanında).
*/
import { Compass, Landmark, Mountain, Sparkles, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef } from "react";
import { tx, useLocale, useT } from "../../lib/i18n";
import { welcome as WM } from "../../locales/welcome";
import { useWalkStore } from "../../voxel/walk/walkStore";
import { isTypingTarget } from "../../voxel/walk/input";
import { announceWalk } from "../world/walk/announce";
import { InHudZone } from "../world/walk/hudZones";
import { welcomeModel, type WelcomeRow } from "./welcomeModel";
import { city as CM } from "../../locales/city";
import { cityDoorTile, goCityDoor } from "../../voxel/citymap/doorEntity";
import { CITY_MAPS } from "../../voxel/citymap/catalog";
import { cityArrivalView } from "../../voxel/citymap/arrivalView";
import { closeWelcome, setWelcomeEnabled, useWelcome, welcomeFocus, type WelcomeOpen } from "./welcomeStore";
import { holdWalkToasts } from "../../lib/walk";
import { infoTargetByKey } from "../world/walk/info/infoTargets";
import { openInfo } from "../world/walk/info/infoStore";
import { tileOfX, tileOfZ } from "../world/walk/info/infoLogic";
import { ritualEntities } from "../../voxel/fun/ritualRuntime";
import { walkRuntime } from "../../voxel/walk/walkStore";

/** sahne satırının eylemi o anda yapılabilir mi — simge: kartı ya da "Şehre çık" kapısı var; ritüel: konumu şimdi uygun.*/
export type SceneRowDo = "info" | "city" | "ritual" | null;
export function sceneRowDo(row: WelcomeRow): SceneRowDo {
  const a = row.act;
  if (!a) return null;
  if (a.kind === "landmark") return infoTargetByKey(a.key) ? "info" : cityDoorTile() ? "city" : null;
  return nearestRitualTile(a.id) ? "ritual" : null;
}
/** Ritüelin avatara en yakın şu an uygun konumunun karosu; yoksa null. */
export function nearestRitualTile(id: string): [number, number] | null {
  const av = walkRuntime.avatar;
  let best: [number, number] | null = null, bd = Infinity;
  for (const e of ritualEntities()) {
    if (e.ritual !== id) continue;
    const d = Math.hypot(e.x - av.x, e.z - av.z);
    if (d < bd) { bd = d; best = [tileOfX(e.x), tileOfZ(e.z)]; }
  }
  return best;
}

const ICON = { landmark: Landmark, ritual: Sparkles, view: Mountain } as const;

/** WalkHud'da bağlanır; kart açıkken ve yürüme sürerken panel yuvasına (`dock`) portallanır. */
export function WelcomeCard() {
  const open = useWelcome((s) => s.open);
  const active = useWalkStore((s) => s.active);
  if (!open || !active) return null;
  return <InHudZone zone="dock"><Card key={open.seq} open={open} /></InHudZone>;
}

function Card({ open }: { open: WelcomeOpen }) {
  const t = useT(WM);
  const locale = useLocale((s) => s.locale);
  const titleId = useId();
  // UXF-A ( B): kapanışta odak kartın içindeyse dünyaya döner (welcomeStore `closeWelcome`)
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = root.current;
    welcomeFocus.host = el;
    return () => { if (welcomeFocus.host === el) welcomeFocus.host = null; };
  });
  // ARRE: kart simgenin karşı yanına yaslanır (simge sağdaysa sol-alt, soldaysa sağ-alt); simge yoksa/sahnede sol
  const lmMap = open.scope === "map" ? CITY_MAPS[open.city] : undefined;
  const cardEnd = lmMap ? cityArrivalView(lmMap).side === -1 : false;
  const model = useMemo(() => welcomeModel(open.city, open.scope), [open.city, open.scope, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  // UXF-D: kart açıkken tostlar bekler (WalkHud orta yuvayı da gizler); kart kapanınca sırayla gelir
  useEffect(() => { holdWalkToasts(true); return () => holdWalkToasts(false); }, []);

  // açılış duyurusu (odak çalınmaz)
  useEffect(() => {
    if (model) announceWalk(tx(WM, "open_ann", { city: model.title }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc: önce kart (yakalama evresi; dünya kabının "çık" işleyicisine ulaşmaz)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isTypingTarget(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      closeWelcome();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (!model) return null;
  // sahnede simge ve ritüel satırları da tıklanır
  const goScene = (row: WelcomeRow) => {
    const how = sceneRowDo(row);
    if (how === "info" && row.act?.kind === "landmark") {
      const tg = infoTargetByKey(row.act.key);
      if (!tg) return;
      closeWelcome();
      openInfo(tg);
      announceWalk(tx(WM, "info_ann", { name: row.name }));
    } else if (how === "city") {
      if (goCityDoor()) { announceWalk(tx(CM, "door_go_ann")); closeWelcome(); }
    } else if (how === "ritual" && row.act?.kind === "ritual") {
      const tile = nearestRitualTile(row.act.id);
      if (!tile) { announceWalk(tx(WM, "ritual_later")); return; }
      useWalkStore.getState().setTarget(tile);
      announceWalk(tx(WM, "go_ann", { name: row.name }));
      closeWelcome();
    }
  };
  const go = (row: WelcomeRow) => {
    // UXF-B: sahnede seyir noktası satırı → "Şehre çık" kapısına yürü
    if (row.door) { if (goCityDoor()) { announceWalk(tx(CM, "door_go_ann")); closeWelcome(); } return; }
    if (!row.target) { goScene(row); return; }
    useWalkStore.getState().setTarget(row.target);
    announceWalk(tx(WM, "go_ann", { name: row.name }));
    closeWelcome();
  };

  return (
    <section ref={root} role="dialog" aria-modal="false" aria-labelledby={titleId} data-welcome-card=""
      className={`panel !rounded-xl shadow-lg w-[min(22rem,100%)] ${cardEnd ? "self-end" : "self-start"} max-h-[55vh] max-sm:max-h-[9.5rem] [@media(max-height:30rem)]:max-h-[max(6.5rem,calc(100dvh-12rem))] [@media(max-height:30rem)]:fixed [@media(max-height:30rem)]:bottom-[7.5rem] [@media(max-height:30rem)]:w-[min(22rem,55%)] ${cardEnd ? "[@media(max-height:30rem)]:right-2" : "[@media(max-height:30rem)]:left-2"} overflow-y-auto overscroll-contain max-sm:snap-y max-sm:snap-mandatory max-sm:scroll-pt-[3.75rem] shrink-0 pointer-events-auto motion-safe:animate-[rise_.2s_ease-out]`}>
      {/* yatayda kart joystick (≤ 100 px) ve dokunmatik kümenin (≤ 116 px) üstünde başlar (7,5 rem; eskiden 4,25 rem'de
          joystick'i örtüyor, 104 px'te yalnız 1 satır görünüyordu); üst bandın altına kadar uzar (≥ 2 satır), Görevler/Yakındakiler satırı o sırada gizli*/}
      {/* kısa (yatay telefon) yükseklikte kart görünür bölmeye (alt sekme çubuğunun üstü, simgenin karşı yanı) sabitlenir, kayar; başlık + × yapışkan, kapatma hep erişilebilir*/}
      <div className="sticky top-0 z-10 bg-panel rounded-t-xl flex items-start gap-2 px-3 pt-2 pb-1.5 min-w-0">
        <Compass size={18} aria-hidden="true" className="text-info shrink-0 mt-1" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-display font-semibold text-base text-ink leading-6 break-words">{model.title}</h2>
          {/* dar bölümde (375 px) kart kısa kalsın: giriş cümlesi yalnız ekran okuyucuya */}
          <p className="sr-only @md:not-sr-only [@media(max-height:30rem)]:sr-only text-xs text-ink-2 leading-4">{t("lead")}</p>
        </div>
        <button type="button" onClick={closeWelcome} aria-label={t("close_aria")} title={t("close")}
          className="btn btn-ghost min-h-11 min-w-11 !p-0 grid place-items-center shrink-0 -mr-1 -mt-0.5">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <ul className="flex flex-col gap-1 px-3 pb-2">
        {model.rows.map((row) => {
          const Icon = ICON[row.kind];
          const how = row.target || row.door ? null : sceneRowDo(row);
          return (
            <li key={row.kind} className="flex items-center gap-2 rounded-lg bg-panel-2 px-2.5 py-1 max-sm:py-0 max-sm:snap-start @md:py-1.5 min-w-0">
              <Icon size={16} aria-hidden="true" className="text-ink-2 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="sr-only @md:not-sr-only [@media(max-height:30rem)]:sr-only text-xs font-semibold text-ink-2 leading-4">{row.label}</p>
                <p className="text-sm text-ink leading-5 break-words">{row.name}</p>
                {row.hint && <p className="hidden @md:block [@media(max-height:30rem)]:hidden text-xs text-ink-2 leading-4 break-words">{row.hint}</p>}
              </div>
              {(row.target || row.door || how) && (
                <button type="button" className="btn btn-sm min-h-11 min-w-11 shrink-0" onClick={() => go(row)}
                  aria-label={how === "info" ? t("info_aria", { name: row.name }) : t("go_aria", { name: row.name })}>
                  {how === "info" ? t("info") : t("go")}</button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end px-3 pb-2">
        <button type="button" className="btn btn-ghost btn-sm min-h-11 text-ink-2" aria-label={t("off_aria")}
          onClick={() => setWelcomeEnabled(false)}>{t("off")}</button>
      </div>
    </section>
  );
}
