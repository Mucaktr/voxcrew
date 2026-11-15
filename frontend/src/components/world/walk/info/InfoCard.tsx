/**
 * simge ve yer bilgi kartı. Modal değil: dünya görünür kalır,
 * yürüme sürer. Masaüstünde sağda yan panel (üst çubuğun altında), dar ekranda (< 640 px) alttan açılan sayfa (dokunmatikte
 * joystick alanının üstünde biter).
 *
 * İçerik (veri `voxel/citymap/landmarkInfo.ts`, metin `locales/landmarkInfo.ts`; kopya yok): ad ve tür çipi, esin satırı, kısa
 * metin ve küçük bilgi, ölçek notu (yalnız gerçek yapı), pasaport damgası durumu (sayı yok), kutsal alan notu, girilebilir
 * simgede kapı uzaklığı, en iyi görünüm ("Manzara (L)": manzara kipi, kamera simgeyi çerçeveler; şehirde ayrıca "Git":
 * seyir noktasına yürür) ve o yerin ritüelleri (en çok 3; "Başlat" oraya yürür ve varınca başlatır). Kartı olmayan simgede ad + ritüeller +
 * damga ("ayrıntı henüz yazılmadı").
 *
 * Erişilebilirlik: `role="dialog"` + `aria-modal="false"`, başlık `h2`; açılınca odak Kapat'a gelir; Tab sırası
 * Kapat → Manzara → Git → ritüeller; Esc ya da I kapatır ve odak açana döner. Hareket azaltmada geçiş yok (`motion-safe`).
*/
import { vpPrefer } from "../../../../voxel/citymap/vpAim";
import { Footprints, Landmark, Mountain, Sparkles, Stamp, VolumeX, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Badge, Button } from "../../../ui";
import { tp, useT, type Messages } from "../../../../lib/i18n";
import { useWalkProgress } from "../../../../lib/walk";
import { explore as EXM } from "../../../../locales/explore";
import { landmarkInfo as LIM } from "../../../../locales/landmarkInfo";
import { walk as WM } from "../../../../locales/walk";
import { walkInfo as WIM } from "../../../../locales/walkInfo";
import { useCity } from "../../../../voxel/citymap/store";
import { isRitualCity, RITUALS_BY_CITY } from "../../../../voxel/fun/rituals";
import { ritualEntities, ritualText } from "../../../../voxel/fun/ritualRuntime";
import { useWalkPose, walkRuntime } from "../../../../voxel/walk/walkStore";
import { announceWalk } from "../announce";
import { insetBottom, JOY_ZONE, useCoarse, useMedia } from "../media";
import { cardModel } from "./cardModel";
import { closeInfo, useInfoOpen } from "./infoStore";
import { infoName, type InfoTarget } from "./infoTargets";
import { worldX, worldZ } from "./infoLogic";
import { startLandmarkView, viewableTarget } from "../../../../voxel/walk/landmarkView";

/** Yakındakiler "git ve aç" ile aynı hedef biçimi (selection.go). */
export interface InfoGoItem { id: string; kind: "prop"; x: number; z: number; dist: number; steps: number; bearing: "front" }

type AnyMsg = Messages<Record<string, string>>;
const has = (m: AnyMsg, key: string) => key in m.tr;

export function InfoCard({ onGo, onWalkTo, onFocusWorld }: {
  onGo: (item: InfoGoItem, name: string) => void;
  onWalkTo: (x: number, z: number) => void;
  onFocusWorld?: () => void;
}) {
  const target = useInfoOpen();
  if (!target) return null;
  return <Card key={target.key} t={target} onGo={onGo} onWalkTo={onWalkTo} onFocusWorld={onFocusWorld} />;
}

/** HQA-FIX: yürüme tuşları (kart odaktayken dünyaya iletilir).*/
const WALK_KEY = /^(KeyW|KeyA|KeyS|KeyD|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/;

function Card({ t: target, onGo, onWalkTo, onFocusWorld }: {
  t: InfoTarget; onGo: (item: InfoGoItem, name: string) => void; onWalkTo: (x: number, z: number) => void; onFocusWorld?: () => void;
}) {
  const t = useT(WIM);
  const tl = useT(LIM);
  const te = useT(EXM);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const narrow = useMedia("(max-width: 639px)");
  const coarse = useCoarse();
  const pose = useWalkPose();
  const found = useCity((s) => s.found);
  const visas = useWalkProgress((s) => s.visas);
  const name = infoName(target);

  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, []);

  // ---- içerik (bağlama saf: cardModel.ts)
  const m = useMemo(() => cardModel(target), [target]);
  const kind = m.kindKey ? tl(m.kindKey as "lmi_kind_tower") : "";
  const inspired = m.inspiredKey ? tl(m.inspiredKey as "lmi_inspired_public") : "";
  const text = m.text
    ? m.text.ns === "explore" ? (has(EXM as AnyMsg, m.text.key) ? te(m.text.key as "poi_istanbul_1") : "") : (has(LIM as AnyMsg, m.text.key) ? tl(m.text.key as "lmi_scale") : "")
    : "";
  const fact = m.factKey && has(LIM as AnyMsg, m.factKey) ? tl(m.factKey as "lmi_scale") : "";
  const scale = m.scaleM;
  const sacred = m.sacred;
  const stamped = m.stamp ? (m.stamp.kind === "city" ? found.has(m.stamp.id) : visas.has(m.stamp.id)) : false;
  const vp = m.viewpoint;
  const doorSteps = target.door && pose ? Math.abs(pose.tile[0] - target.door[0]) + Math.abs(pose.tile[1] - target.door[1]) : null;

  // ritüeller: o anda başlatılabilen en yakın bağlantı noktası (saat, sessiz bölge ve yolculuk kuralı ritualEntities'te)
  const rituals = useMemo(() => {
    if (!m.rituals.length || !isRitualCity(target.city)) return [];
    const defs = RITUALS_BY_CITY[target.city];
    const a = walkRuntime.avatar;
    const live = ritualEntities();
    return m.rituals.flatMap((id) => {
      const def = defs.find((d) => d.id === id);
      if (!def) return [];
      let best: InfoGoItem | null = null;
      for (const e of live) {
        if (e.ritual !== id) continue;
        const d = Math.hypot(e.x - a.x, e.z - a.z);
        if (!best || d < best.dist) best = { id: e.id, kind: "prop", x: e.x, z: e.z, dist: d, steps: Math.max(1, Math.round(d)), bearing: "front" };
      }
      return [{ id, label: ritualText(def, "label"), go: best }];
    });
    // pose: avatar yürüdükçe mesafe ve uygunluk yenilenir
  }, [m, target, pose]); // eslint-disable-line react-hooks/exhaustive-deps

  // HQA-FIX: kart kapanınca klavye odağı dünyaya döner (eskiden odak gövdede kalıyor, WASD dünyaya ulaşmıyordu)
  const close = () => { closeInfo(); onFocusWorld?.(); };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" || ((e.key === "i" || e.key === "I") && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey)) {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    // HQA-FIX: kart açılınca odak kapatma düğmesinde; yürüme tuşları (WASD/oklar) kartta yutuluyor, avatar simgeye
    // varınca 20 sn kıpırdamıyordu. Yürüme tuşu odağı dünyaya verir ve aynı tuşu dünyaya iletir (yürüyüş hemen başlar, kart açık kalır)
    if (WALK_KEY.test(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const world = document.querySelector<HTMLElement>("[role=application]");
      if (!world) return;
      e.preventDefault();
      onFocusWorld?.();
      if (document.activeElement !== world) world.focus({ preventScroll: true });
      world.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, code: e.code, shiftKey: e.shiftKey, repeat: e.repeat, bubbles: true, cancelable: true }));
    }
  };
  // "Manzara (L)" kamerayı simgeye çevirir (kart kapanır, odak dünyaya; duyuru InfoLayer'da); "Git" seyir noktasına yürür
  const canView = viewableTarget(target);
  const goView = () => {
    if (!startLandmarkView(target)) return;
    closeInfo(false);
    onFocusWorld?.();
  };
  const goViewpoint = () => {
    if (!vp) return;
    closeInfo(false);
    if (target.landmark) { vpPrefer.tile = `${target.city}:${vp[0]},${vp[1]}`; vpPrefer.key = `${target.city}:${target.district}:${target.landmark}`; } // varışta kartın simgesine bak
    onWalkTo(worldX(vp[0]), worldZ(vp[1]));
    announceWalk(t("view_going"));
    onFocusWorld?.();
  };
  const startRitual = (go: InfoGoItem, label: string) => {
    closeInfo(false);
    onGo(go, label);
    onFocusWorld?.();
  };

  const style = narrow
    ? coarse
      ? { bottom: insetBottom(JOY_ZONE), maxHeight: `calc(100% - ${JOY_ZONE} - 4.25rem - var(--walk-inset-b, 0px))` }
      : { bottom: "var(--walk-inset-b, 0px)", paddingBottom: "env(safe-area-inset-bottom)", maxHeight: "calc(65% - var(--walk-inset-b, 0px))" }
    : { top: "calc(var(--walk-top, 56px) + 0.5rem)", maxHeight: "calc(100% - var(--walk-top, 56px) - var(--mm-h, 0px) - 1.75rem)" };
  return (
    <div role="dialog" aria-modal="false" aria-labelledby={titleId} data-walk-info="" onKeyDown={onKey} style={style}
      className={narrow
        ? "absolute inset-x-0 z-30 flex flex-col panel !rounded-b-none !rounded-t-2xl shadow-2xl pointer-events-auto motion-safe:animate-[rise_.2s_ease-out]"
        : "absolute right-3 z-30 w-[22rem] max-w-[calc(100%-1.5rem)] flex flex-col panel !rounded-xl shadow-2xl pointer-events-auto motion-safe:animate-[rise_.2s_ease-out]"}>
      <div className="flex items-start gap-2 px-3 pt-2.5 pb-2 border-b border-line min-w-0">
        <Landmark size={18} aria-hidden="true" className="text-ink-2 shrink-0 mt-1" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-display font-semibold text-base text-ink leading-6 break-words">{name}</h2>
          {kind && <Badge tone="info" className="mt-0.5 text-xs">{kind}</Badge>}
        </div>
        <button ref={closeRef} type="button" onClick={close} aria-label={t("close")} title={t("close")} aria-keyshortcuts="Escape I"
          className="btn btn-ghost min-h-11 min-w-11 !p-0 grid place-items-center shrink-0">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto px-3 py-2.5 flex flex-col gap-2.5 text-sm">
        {inspired && <p className="text-xs text-ink-2 leading-4">{inspired}</p>}
        {text && <p className="text-ink leading-5">{text}</p>}
        {fact && (
          <p className="rounded-lg bg-panel-2 px-2.5 py-1.5 leading-5">
            <span className="flex items-center gap-1 text-xs font-semibold text-ink-2"><Sparkles size={13} aria-hidden="true" />{tl("lmi_fact_title")}</span>
            <span className="text-ink">{fact}</span>
          </p>
        )}
        {scale !== null && <p className="text-xs text-ink-2">{tl("lmi_scale", { m: scale })}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={stamped ? "ok" : "muted"} className="text-xs">
            <Stamp size={12} aria-hidden="true" />{stamped ? tl("lmi_stamp_got") : tl("lmi_stamp_open")}
          </Badge>
          {/* kapı rozeti kapıya yürür ("Git" seyir noktasına gider; kapı ayrı)*/}
          {doorSteps !== null && target.door && (
            <Button size="sm" className="min-h-11 text-xs" icon={<Footprints size={12} aria-hidden="true" />} aria-label={t("door_go_aria", { n: doorSteps })}
              onClick={() => { const d = target.door!; closeInfo(false); onWalkTo(worldX(d[0]), worldZ(d[1])); announceWalk(t("door_going")); onFocusWorld?.(); }}>
              {tl("lmi_door", { n: doorSteps })}
            </Button>
          )}
        </div>
        {sacred && (
          <p className="flex items-start gap-1.5 rounded-lg border border-line-soft px-2.5 py-1.5 text-ink">
            <VolumeX size={15} aria-hidden="true" className="shrink-0 mt-0.5 text-ink-2" />{tl("lmi_sacred")}
          </p>
        )}
        {/* iç mekân sergisinden açılan kartta şehir görünümü/yürüyüşü yok (koordinatlar şehrin)*/}
        {!target.inside && <section aria-label={tl("lmi_view_title")} className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-ink-2">{tl("lmi_view_title")}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Button className="min-h-11" icon={<Mountain size={15} aria-hidden="true" />} onClick={goView} disabled={!canView}
              aria-keyshortcuts="L" aria-label={canView ? t("view_aria", { name }) : t("view")} aria-describedby={canView || vp ? undefined : `${titleId}-vp`}>
              {t("view")}
            </Button>
            {vp && (
              <Button className="min-h-11" icon={<Footprints size={15} aria-hidden="true" />} onClick={goViewpoint} aria-label={t("view_go_aria")}>
                {t("view_go")}
              </Button>
            )}
            {!vp && !canView && <span id={`${titleId}-vp`} className="text-xs text-ink-2 flex-1 min-w-[10rem]">{t("view_none")}</span>}
          </div>
        </section>}
        <section aria-label={tl("lmi_todo_title")} className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-ink-2">{tl("lmi_todo_title")}</h3>
          {rituals.length === 0 && <p className="text-xs text-ink-2">{t("rit_none")}</p>}
          {rituals.length > 0 && (
            <ul className="flex flex-col gap-1">
              {rituals.map((r) => {
                const steps = r.go ? tp(WM, "steps", r.go.steps) : "";
                return (
                  <li key={r.id} className="flex items-center gap-2 rounded-lg bg-panel-2 px-2 py-1">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink leading-5 break-words">{r.label}</p>
                      <p className="text-xs text-ink-2 num">{r.go ? steps : t("rit_unavail")}</p>
                    </div>
                    <Button className="min-h-11 shrink-0" disabled={!r.go} onClick={() => r.go && startRitual(r.go, r.label)}
                      aria-label={r.go ? t("rit_start_aria", { name: r.label, steps }) : `${r.label}: ${t("rit_unavail")}`}>
                      {t("rit_start")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
