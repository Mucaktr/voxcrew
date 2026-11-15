/**
 * yürüme HUD'unda tek düğmeyle tarayıcı tam ekranı (Fullscreen API). HUD'un "actions" yuvasına portallanır
 * (hudZones.tsx `InHudZone`; walk/* dosyalarına dokunmadan). Yalnız ince işaretçide ve tarayıcı tam ekranı destekliyorsa
 * çizilir; istek reddedilirse WorldPage "pencereye sığdır" görünümüne düşer (zarif geri dönüş). Dokunmatikte (375 px) eylem
 * kümesi kalabalıklaşmasın diye yok.
*/
import { Expand, Shrink } from "lucide-react";
import { useT } from "../../../lib/i18n";
import { walkFocus as M } from "../../../locales/walkFocus";
import { InHudZone } from "../walk/hudZones";
import { useCoarse } from "../walk/media";

export function FocusFullscreenButton({ full, onToggle }: { full: boolean; onToggle: () => void }) {
  const t = useT(M);
  const coarse = useCoarse();
  if (coarse || typeof document === "undefined" || !document.fullscreenEnabled) return null;
  const label = full ? t("fs_exit_aria") : t("fs_enter_aria");
  return (
    <InHudZone zone="actions">
      <button type="button" className="btn pointer-events-auto min-h-11 min-w-11" data-focus-fullscreen="" aria-pressed={full}
        onClick={onToggle} aria-label={label} title={label}>
        {full ? <Shrink size={16} aria-hidden="true" /> : <Expand size={16} aria-hidden="true" />}
        <span className="hidden @5xl:inline">{full ? t("fs_exit") : t("fs_enter")}</span>
      </button>
    </InHudZone>
  );
}
