/**
 * Anı defteri: şehir sekmeli kart ızgarası.
 *
 * - Düğme HUD eylem yuvasında (fotoğraf düğmesinin yanında), yalnız ritüel şehrinde (sahne ya da şehir haritası).
 * - Kart: yapılmış anıda çizilmiş simge, ritüel adı, gerçek hayat notu, yer ve ilk günü; boş kartta YALNIZ "Henüz yok", ipucu
 * ve yer adı. Geri sayım, yüzde ve "kaçırma" dili yok; sekmelerde toplam/kalan sayısı yok.
 * - Fotoğraf ritüelinde kart çizilmiş bir simgedir (ekran görüntüsü saklanmaz).
 * - Modül yüklenince `installRitualMemory` ritüel bitişini anı kaydına bağlar (HUD fotoğraf modunda sökülse de etkin kalır).
*/
import clsx from "clsx";
import {
  BookHeart, Bird, BookOpen, Camera, Cat, Coffee, Fish, Hammer, Music, Sandwich, Sparkles, Squirrel, Sunset, type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Modal, Spinner, TabPanel, Tabs } from "../../../ui";
import { fmtDate, tp, tx, useT } from "../../../../lib/i18n";
import { pushWalkToast } from "../../../../lib/walk";
import { installRitualMemory, loadRitualBook, ritualMemoryHooks, useRitualBook, type RitualDoneRow } from "../../../../lib/walkRituals";
import { ritualBook as RB } from "../../../../locales/ritualBook";
import { cityName, districtName, landmarkName, stopName, useCity } from "../../../../voxel/citymap/store";
import { isRitualCity, RITUAL_CITIES, RITUAL_IDS, RITUALS, type RitualCity, type RitualDef } from "../../../../voxel/fun/rituals";
import { ritualText } from "../../../../voxel/fun/ritualRuntime";
import { useWalkStore } from "../../../../voxel/walk/walkStore";
import { returnWorldFocusSoon } from "../../../../voxel/walk/worldFocus";
import { InHudZone } from "../hudZones";
import { useCoarse } from "../media";

installRitualMemory();
ritualMemoryHooks.onTitle = (id) => pushWalkToast({ kind: "souvenir", title: tx(RB, "title_toast"), text: titleName(id) });

/** Şu anki ritüel şehri: şehir haritasında haritanın şehri, sahnede sahne kimliği; değilse null. */
function useRitualCity(): RitualCity | null {
  const world = useWalkStore((s) => s.world);
  const mapCity = useCity((s) => s.view?.city ?? null);
  if (mapCity) return isRitualCity(mapCity) ? mapCity : null;
  return isRitualCity(world) ? world : null;
}

export function RitualBook() {
  const t = useT(RB);
  const city = useRitualCity();
  const coarse = useCoarse();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  // UXF-A ( A): Modal kapanınca odağı açan düğmeye verir; yürürken o düğme çıkmaz sokak (WASD ölü) → dünyaya döner
  const close = () => { setOpen(false); returnWorldFocusSoon(btn.current); };
  if (!city && !open) return null;
  return (
    <>
      {city && (
        <InHudZone zone="actions">
          <button ref={btn} type="button" className={coarse ? "btn pointer-events-auto min-h-12 min-w-12 !p-0 grid place-items-center" : "btn pointer-events-auto min-h-11 min-w-11"}
            aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} aria-label={t("open_aria")} title={t("open_aria")}>
            <BookHeart size={coarse ? 18 : 16} aria-hidden="true" />
            {!coarse && <span className="hidden @4xl:inline">{t("open")}</span>}
          </button>
        </InHudZone>
      )}
      {open && <RitualBookDialog initial={city ?? RITUAL_CITIES[0]} onClose={close} />}
    </>
  );
}

const DEFS = new Map<string, RitualDef>(RITUALS.map((d) => [`${d.city}:${d.id}`, d]));
const defOf = (city: RitualCity, id: string): Pick<RitualDef, "city" | "locale"> & Partial<RitualDef> =>
  DEFS.get(`${city}:${id}`) ?? { city, locale: id };

function RitualBookDialog({ initial, onClose }: { initial: RitualCity; onClose: () => void }) {
  const t = useT(RB);
  const tabsId = useId();
  const [tab, setTab] = useState<RitualCity>(initial);
  const book = useRitualBook((s) => s.book);
  const loading = useRitualBook((s) => s.loading);
  const error = useRitualBook((s) => s.error);
  useEffect(() => { void loadRitualBook(); }, []);
  const tabs = useMemo(() => RITUAL_CITIES.map((c) => {
    const titled = !!book?.cities[c]?.title;
    return { value: c, label: <span className="inline-flex items-center gap-1">{cityName(c)}{titled && <BookHeart size={13} aria-hidden="true" className="text-warn" />}</span> };
  }), [book]);
  const cb = book?.cities[tab];
  const done = useMemo(() => new Map((cb?.done ?? []).map((d) => [d.id, d])), [cb]);
  const found = cb?.found ?? 0;
  return (
    <Modal open onClose={onClose} title={<span className="inline-flex items-center gap-2"><BookHeart size={18} aria-hidden="true" />{t("title")}</span>} width={720}>
      <p className="text-sm text-ink-2 mb-3">{t("intro")}</p>
      <Tabs id={tabsId} value={tab} onChange={setTab} tabs={tabs} label={t("tabs_label")} />
      <TabPanel tabs={tabsId} value={tab} className="pt-3">
        {!book && loading && <p className="flex items-center gap-2 text-sm text-ink-2" role="status"><Spinner />{t("loading")}</p>}
        {!book && !loading && error && (
          <div className="flex flex-wrap items-center gap-2 text-sm" role="alert">
            <span className="text-ink-2">{t("load_error")}</span>
            <Button size="sm" onClick={() => void loadRitualBook()}>{t("retry")}</Button>
          </div>
        )}
        {book && (
          <>
            <p className="text-sm text-ink-2 mb-2" aria-live="polite">
              {found ? tp(RB, "count", found) : t("count_none")}
              {cb?.title && <span className="chip tone-warn ml-2 align-middle">{t("title_earned", { title: titleName(cb.title) })}</span>}
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2" aria-label={t("grid_label", { city: cityName(tab) })}>
              {RITUAL_IDS[tab].map((id) => <RitualCard key={id} city={tab} id={id} row={done.get(id) ?? null} />)}
            </ul>
          </>
        )}
      </TabPanel>
    </Modal>
  );
}

function titleName(id: string): string {
  const key = `title_${id}`;
  return key in RB.tr ? tx(RB, key as keyof typeof RB.tr) : tx(RB, "title_generic"); // CORE-WALK: ham kimlik değil
}

/** Kartın yeri: şehir haritası bağlantısı (durak > landmark > semt), hayvana bağlıysa kedi, yoksa şehir. */
function placeOf(def: Partial<RitualDef> & { city: RitualCity }, t: (k: keyof typeof RB.tr) => string): string {
  const m = def.at?.map?.[0];
  if (m?.stop) return stopName(def.city, m.stop);
  if (m?.landmark) return landmarkName(def.city, m.landmark);
  if (m?.district) return districtName(def.city, m.district);
  if (def.at?.animal === "cat") return t("place_cat");
  return cityName(def.city);
}

/** Çizilmiş simge (fotoğraf ritüelinde kamera; ekran görüntüsü yok). */
function iconOf(def: Partial<RitualDef>): LucideIcon {
  if (def.photo) return Camera;
  const lure = def.react?.lure?.kinds[0];
  if (lure === "cat") return Cat;
  if (lure === "squirrel") return Squirrel;
  if (lure === "fish") return Fish;
  if (lure) return Bird;
  if (def.act?.motion === "dance" || def.react?.burst === "notes") return Music;
  if (def.act?.motion === "cheer" || def.when === "dusk") return Sunset;
  if (def.act?.motion === "read") return BookOpen;
  if (def.act?.held === "hammer") return Hammer;
  if (def.act?.motion === "sip") return def.act.held === "sandwich" || def.act.held === "meal" || def.act.held === "hotdog" ? Sandwich : Coffee;
  return Sparkles;
}

function RitualCard({ city, id, row }: { city: RitualCity; id: string; row: RitualDoneRow | null }) {
  const t = useT(RB);
  const def = defOf(city, id);
  const label = ritualText(def, "label");
  const place = placeOf(def, t);
  if (!row) {
    return (
      <li className="rounded-xl border-2 border-dashed border-line px-3 py-2.5 min-w-0">
        <p className="text-sm font-semibold text-ink-2">{t("empty")}</p>
        <p className="text-xs text-ink-2 leading-4 mt-0.5 break-words">{t("hint", { text: label })}</p>
        <p className="text-xs text-muted leading-4 mt-0.5 break-words">{t("place", { place })}</p>
      </li>
    );
  }
  const Icon = iconOf(def);
  const note = ritualText(def, "note");
  const day = row.day ? fmtDate(`${row.day}T12:00:00`) : "";
  return (
    <li className="rounded-xl border-2 border-line-soft bg-panel-2 px-3 py-2.5 min-w-0 flex items-start gap-2.5">
      <span className={clsx("shrink-0 grid place-items-center size-10 rounded-lg border-2 border-line-soft bg-panel text-ink-2", def.photo && "rotate-[-3deg]")}
        role="img" aria-label={def.photo ? t("photo_icon") : undefined} aria-hidden={def.photo ? undefined : true}>
        <Icon size={20} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink leading-5 break-words">{label}</p>
        {note && <p className="text-xs text-ink-2 leading-4 mt-0.5 break-words">{note}</p>}
        <p className="text-xs text-ink-2 leading-4 mt-1 break-words">
          {t("place", { place })}{row.scope === "map" ? ` · ${t("on_map")}` : ""}{day ? ` · ${t("first_day", { day })}` : ""}
        </p>
      </div>
    </li>
  );
}
