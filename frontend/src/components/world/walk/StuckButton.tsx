/**
 * STUCK-FIX (WALK-STUCK-001) — "Takıldım" düğmesi (yürüme modu üst çubuğu). Her zaman görünür ve çalışır: avatarı son güvenli
 * noktaya (yoksa katın girişine) kapı geçişiyle aynı kararma altında taşır (walk/safeRescue.ts). Klavyede U (input.ts
 * `UNSTUCK_EVENT`). Dokunma hedefi ≥ 44 px, `aria-keyshortcuts`, hareket azaltmada anlık (kararma yok).
 */
import { LifeBuoy } from "lucide-react";
import { useEffect } from "react";
import { useT } from "../../../lib/i18n";
import { walk as WM } from "../../../locales/walk";
import { Button } from "../../ui";
import { UNSTUCK_EVENT } from "../../../voxel/walk/input";
import { requestRescue } from "../../../voxel/walk/safeRescue";

export function StuckButton({ onFocusWorld }: { onFocusWorld?: () => void }) {
  const t = useT(WM);
  useEffect(() => {
    const on = () => requestRescue();
    window.addEventListener(UNSTUCK_EVENT, on);
    return () => window.removeEventListener(UNSTUCK_EVENT, on);
  }, []);
  return (
    <Button className="pointer-events-auto min-h-11 min-w-11" aria-keyshortcuts="U" aria-label={t("stuck_aria")} title={t("stuck_aria")}
      icon={<LifeBuoy size={16} aria-hidden="true" />}
      onClick={() => { requestRescue(); onFocusWorld?.(); }}>
      <span className="hidden @4xl:inline">{t("stuck")}</span>
    </Button>
  );
}
