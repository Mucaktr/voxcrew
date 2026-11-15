/**
 * Görünüm menüsü satırı: "Yürürken sayfa panellerini gizle" (Gizle / Göster, varsayılan Gizle).
 * ViewMenu.tsx'teki `Row` ile aynı işaretleme ve sınıflar (vmenu-row, vmenu-label, vmenu-seg); ViewMenu yalnız bunu bağlar:
 * <FocusViewRow />
*/
import { Eye, EyeOff, Maximize } from "lucide-react";
import { useId } from "react";
import { useT } from "../../../lib/i18n";
import { walkFocus as M } from "../../../locales/walkFocus";
import { Segmented } from "../../ui";
import { useWalkFocusPref } from "./walkFocus";

export function FocusViewRow() {
  const t = useT(M);
  const id = useId();
  const on = useWalkFocusPref((s) => s.on);
  const setOn = useWalkFocusPref((s) => s.setOn);
  return (
    <div className="vmenu-row" role="group" aria-labelledby={`${id}-l`} aria-describedby={`${id}-h`} data-focus-row="">
      <div className="vmenu-label" title={t("focus_hint")}>
        <span aria-hidden="true" className="text-muted"><Maximize size={13} /></span>
        <span id={`${id}-l`}>{t("focus_label")}</span>
      </div>
      <Segmented<"on" | "off"> className="vmenu-seg" value={on ? "on" : "off"} onChange={(v) => setOn(v === "on")}
        options={[
          { value: "on", label: <span className="inline-flex items-center gap-1"><EyeOff size={13} aria-hidden="true" /><span>{t("focus_on")}</span></span> },
          { value: "off", label: <span className="inline-flex items-center gap-1"><Eye size={13} aria-hidden="true" /><span>{t("focus_off")}</span></span> },
        ]} />
      <span id={`${id}-h`} className="sr-only">{t("focus_hint")}</span>
    </div>
  );
}
