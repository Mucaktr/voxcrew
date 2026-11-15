/**
 * INTERIOR-VIEW — mini haritada kat seçici: çok katlı iç mekânda her kat bir alt sahne; düğme asansör gibi o kata götürür
 * (`liftTo` — bu katın o kata giden en yakın asansörüyle biner; kapılar + kabin yolculuğu, hedef katın asansör
 * kapısının önüne varış; asansörsüz kat atlaması yok). Bulunulan kat `aria-current`, geçiş
 * sürerken düğmeler kapalı. Mini harita başlık satırında başlığın yerine çizilir (yeni satır yok); tek katlı yerde ve dışarıda
 * başlık kalır. Boyut mini harita düğmeleriyle aynı (22 px, dokunmatikte 28 px); klavyeyle Tab + Enter.
*/
import clsx from "clsx";
import type { ReactNode } from "react";
import { useT } from "../../../../lib/i18n";
import { explore as XM } from "../../../../locales/explore";
import { liftTo, useInterior } from "../../../../voxel/interiors/store";
import { roomName } from "./actions";

/** `fallback`: iç mekân dışında ya da tek katlıda çizilen öğe (mini harita başlığı). */
export function FloorPicker({ fallback = null }: { fallback?: ReactNode }) {
  const t = useT(XM);
  const plan = useInterior((s) => s.plan);
  const index = useInterior((s) => s.index);
  const lifts = useInterior((s) => s.view?.level.lifts);
  const busy = useInterior((s) => s.busy);
  const inside = useInterior((s) => !!s.view);
  if (!inside || !plan || plan.levels.length < 2) return <>{fallback}</>;
  const total = plan.levels.length;
  return (
    <div className="minimap-floors" role="group" aria-label={t("floors")} data-floor-picker="">
      {plan.levels.map((lv) => {
        const here = lv.index === index, noLift = !here && !lifts?.some((l) => l.to === lv.index);
        const room = roomName(lv.name, lv.index);
        return (
          <button key={lv.key} type="button" disabled={busy || here || noLift} aria-current={here ? "true" : undefined}
            aria-label={here ? t("floor_here_aria", { n: lv.index + 1, total, room }) : t("floor_go_aria", { n: lv.index + 1, total, room })}
            title={`${t("floor_btn", { n: lv.index + 1 })} · ${room}`}
            className={clsx("minimap-floor num", here && "is-here")}
            onClick={() => { liftTo(lv.index); }}>
            {lv.index + 1}
          </button>
        );
      })}
    </div>
  );
}
