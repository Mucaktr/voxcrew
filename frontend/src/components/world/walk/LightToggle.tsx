/**
 * UXF-G — yürüme HUD'unda gündüz/gece kestirmesi. Gece sahneleri koyu kalırsa kullanıcı moddan çıkıp Görünüm menüsünü
 * aramak zorunda kalmasın: tek tıkla Gündüz ↔ Gece (Görünüm → Işık ile aynı kalıcı ayar; "Otomatik" seçimi bu düğmeyle
 * açıkça gündüz/geceye sabitlenir, menüden yine Otomatik'e dönülür). Dokunma hedefi ≥ 44 px; simge + dar ekranda yalnız simge.
*/
import { Moon, Sun } from "lucide-react";
import { useT } from "../../../lib/i18n";
import { lightToggleMsg } from "../../../locales/lightToggle";
import { sceneDef } from "../../../voxel/scenes";
import { useLightMode } from "../../../voxel/props/daynight";
import { useSceneNight } from "../../../voxel/props/weather";
import { useWalkStore } from "../../../voxel/walk/walkStore";
import { Button } from "../../ui";

export function LightToggle({ onFocusWorld }: { onFocusWorld?: () => void }) {
  const t = useT(lightToggleMsg);
  const world = useWalkStore((s) => s.world);
  const night = useSceneNight(sceneDef(world));
  const setMode = useLightMode((s) => s.setMode);
  const label = night ? t("to_day") : t("to_night");
  const aria = night ? t("to_day_aria") : t("to_night_aria");
  return (
    <Button className="pointer-events-auto min-h-11 min-w-11" data-walk-light="" aria-label={aria} title={aria}
      icon={night ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
      onClick={() => { setMode(night ? "day" : "night"); onFocusWorld?.(); }}>
      <span className="hidden @4xl:inline">{label}</span>
    </Button>
  );
}
