/**
 * ACTIVITY-FEEL (B4/B6) — şehir rehberi paneli. Kioskta F ("Şehir rehberine bak") açar; o şehirde bir kez açıldıktan sonra HUD
 * eylem yuvasındaki "Rehber" düğmesi de açar (kiosk anlamlı kalır). Keşfedilenler tam; keşfedilmeyenler "???" + bilmece + semt.
 * "Yol göster" hedefe işaret ve yol noktaları koyar (`walk/waypoint.ts`); işi kendisi yapmaz, avatarı yürütmez.
 * Erişilebilirlik: Modal (odak tuzağı, Esc), başlıklı bölümler, her düğmede açık `aria-label`, 375 px'te tek sütun.
 */
import { Compass, MapPin, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Button, Modal } from "../../../ui";
import { tx, useT } from "../../../../lib/i18n";
import { pushWalkToast, useWalkProgress } from "../../../../lib/walk";
import { loadRitualBook, useRitualBook } from "../../../../lib/walkRituals";
import { cityGuide as GM } from "../../../../locales/cityGuide";
import { cityName, districtName, landmarkName, stopName, useCity } from "../../../../voxel/citymap/store";
import { closeCityGuide, guideCityNow, openCityGuide, useCityGuide } from "../../../../voxel/fun/cityGuide";
import { RITUALS_BY_CITY, isRitualCity, type RitualCity, type RitualDef } from "../../../../voxel/fun/rituals";
import { ritualAnchorsHere, ritualText } from "../../../../voxel/fun/ritualRuntime";
import { tx as tileX, tz as tileZ } from "../../../../voxel/scenes";
import { clearWaypoint, setWaypoint, useWaypoint } from "../../../../voxel/walk/waypoint";
import { useWalkStore, walkRuntime } from "../../../../voxel/walk/walkStore";
import { returnWorldFocusSoon } from "../../../../voxel/walk/worldFocus";
import { InHudZone } from "../hudZones";
import { useEscLayer } from "../useEscLayer"; // UXF-G
import { useCoarse } from "../media";
import { landmarkLabel } from "../progress/actions";
import { souvenirLayer } from "../progress/layer";
import { landmarkZones } from "../progress/logic";
import { buildGuide, type GuideItem } from "./guideModel";

/** Kartın semti: şehir haritası bağlantısı (durak > landmark > semt). */
function placeOf(def: RitualDef): string | null {
  const m = def.at.map?.[0];
  if (m?.stop) return stopName(def.city, m.stop);
  if (m?.landmark) return landmarkName(def.city, m.landmark);
  if (m?.district) return districtName(def.city, m.district);
  return null;
}

export function CityGuide() {
  const t = useT(GM);
  const coarse = useCoarse();
  const world = useWalkStore((s) => s.world);
  const mapCity = useCity((s) => s.view?.city ?? null);
  const open = useCityGuide((s) => s.open);
  const unlocked = useCityGuide((s) => s.unlocked);
  const ended = useWaypoint((s) => s.ended);
  const btn = useRef<HTMLButtonElement>(null);
  const city = mapCity ? (isRitualCity(mapCity) ? mapCity : null) : isRitualCity(world) ? world : null;
  // HQA-FIX: şehir haritasında kiosk yok — rehber orada hep açık (23 damgaya "Yol göster"); sahnede kiosk kilidi sürer
  const hud = !!city && (unlocked.includes(city) || !!mapCity);

  useEffect(() => { if (ended === "arrived") pushWalkToast({ kind: "info", title: tx(GM, "arrived") }); }, [ended]);
  useEffect(() => () => closeCityGuide(), []);

  const close = () => { closeCityGuide(); returnWorldFocusSoon(btn.current); };
  return (
    <>
      {hud && (
        <InHudZone zone="actions">
          <button ref={btn} type="button" className={coarse ? "btn pointer-events-auto min-h-12 min-w-12 !p-0 grid place-items-center" : "btn pointer-events-auto min-h-11 min-w-11"}
            aria-haspopup="dialog" aria-expanded={open} onClick={() => { const c = guideCityNow(); if (c) openCityGuide(c, !!mapCity); }}
            aria-label={t("open_aria")} title={t("open_aria")}>
            <Compass size={coarse ? 18 : 16} aria-hidden="true" />
            {!coarse && <span className="hidden @4xl:inline">{t("open")}</span>}
          </button>
        </InHudZone>
      )}
      {open && <GuideDialog onClose={close} />}
    </>
  );
}

function GuideDialog({ onClose }: { onClose: () => void }) {
  const t = useT(GM);
  const city = useCityGuide((s) => s.city) as RitualCity | null;
  const just = useCityGuide((s) => s.justUnlocked);
  const book = useRitualBook((s) => s.book);
  const visas = useWalkProgress((s) => s.visas);
  const world = useWalkStore((s) => s.world);
  const wp = useWaypoint((s) => s.wp);
  useEscLayer(true, onClose, { modal: true, id: "city-guide" }); // UXF-G: Esc önce rehberi kapatır, yürüme modunu değil
  useEffect(() => { void loadRitualBook(); }, []);
  const items = useMemo<GuideItem[]>(() => {
    if (!city) return [];
    const done = new Set((book?.cities[city]?.done ?? []).map((d) => d.id));
    const b = souvenirLayer.built;
    const zones = world === city && b ? landmarkZones(world, b.zones, b.width, b.depth) : [];
    return buildGuide({
      defs: RITUALS_BY_CITY[city] ?? [], doneIds: done, zones, visas, avatar: { x: walkRuntime.avatar.x, z: walkRuntime.avatar.z },
      anchors: (d) => ritualAnchorsHere(d), toWorld: (i, j) => [tileX(i), tileZ(j)],
      ritualName: (d) => ritualText(d, "label"), ritualNote: (d) => ritualText(d, "note"), ritualPlace: placeOf, zoneName: (id) => landmarkLabel(id),
    });
  }, [city, book, visas, world]);
  if (!city) return null;
  const show = (it: GuideItem) => {
    if (!it.target || !world) return;
    const name = it.name ?? t("hidden_name");
    setWaypoint({ x: it.target.x, z: it.target.z, name, world });
    pushWalkToast({ kind: "info", title: t("shown", { name }) });
    onClose();
  };
  const section = (kind: "do" | "see") => items.filter((i) => i.kind === kind);
  return (
    <Modal open onClose={onClose} width={640}
      title={<span className="inline-flex items-center gap-2"><Compass size={18} aria-hidden="true" />{t("title", { city: cityName(city) })}</span>}
      footer={wp ? <Button variant="ghost" icon={<X size={14} aria-hidden="true" />} onClick={() => clearWaypoint("cleared")}>{t("clear")}</Button> : undefined}>
      <p className="text-sm text-ink-2 mb-3">{t("intro")}</p>
      {just && <p className="text-sm text-ink mb-3 chip tone-info" role="status">{t("unlocked")}</p>}
      {!items.length && <p className="text-sm text-ink-2">{t("empty")}</p>}
      {(["do", "see"] as const).map((k) => section(k).length > 0 && (
        <section key={k} className="mb-4" aria-labelledby={`guide-${k}`}>
          <h3 id={`guide-${k}`} className="font-display text-base font-semibold text-ink mb-2">{t(k === "do" ? "sec_do" : "sec_see")}</h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {section(k).map((it) => <GuideRow key={it.id} it={it} onShow={() => show(it)} />)}
          </ul>
        </section>
      ))}
    </Modal>
  );
}

function GuideRow({ it, onShow }: { it: GuideItem; onShow: () => void }) {
  const t = useT(GM);
  const name = it.name ?? t("unknown");
  const where = it.steps === null || !it.dir ? null : it.steps <= 2 ? t("here") : t("where", { dir: t(`dir_${it.dir}`), n: it.steps });
  return (
    <li className={it.found ? "rounded-xl border-2 border-line-soft bg-panel-2 px-3 py-2.5 min-w-0 flex flex-col gap-1" : "rounded-xl border-2 border-dashed border-line px-3 py-2.5 min-w-0 flex flex-col gap-1"}>
      <p className="text-sm font-semibold text-ink leading-5 break-words">{name}
        <span className="sr-only"> — {it.found ? t("found") : t("not_found")}</span></p>
      <p className="text-xs text-ink-2 leading-4 break-words">{it.found && it.note ? it.note : t(`hint_${it.hint}`)}</p>
      {(it.place || where) && (
        <p className="text-xs text-ink-2 leading-4 break-words inline-flex items-start gap-1">
          <MapPin size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{[it.place ? t("place", { place: it.place }) : null, where].filter(Boolean).join(" · ")}</span>
        </p>
      )}
      {it.target && (
        <div className="pt-1">
          <Button size="sm" onClick={onShow} aria-label={t("show_aria", { name: it.name ?? t("hidden_name") })}>{t("show")}</Button>
        </div>
      )}
    </li>
  );
}
