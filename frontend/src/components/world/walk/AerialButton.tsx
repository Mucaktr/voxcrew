/**
 * WALK-ZOOM — "Kuş bakışı" düğmesi (yürüme modu üst çubuğu): takip kamerasından şehre yukarıdan bakışa çıkar ve geri döner
 * (klavyede Z; tekerlek ve +/− kademeli). İç mekânda, taşıtta ve etkinlik kadrajında kuş bakışı yok → düğme devre dışı.
 * Durum WalkRig'den (`camera/walkZoom.ts`); `aria-pressed`, `aria-keyshortcuts`, dokunma hedefi ≥ 44 px.
 */
import { Bird } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useT } from "../../../lib/i18n";
import { walk as WM } from "../../../locales/walk";
import { Button } from "../../ui";
import { subscribeWalkZoom, walkZoom } from "../../../voxel/camera/walkZoom";

const onSnap = () => walkZoom.on;
const okSnap = () => walkZoom.allowed;

export function AerialButton({ onFocusWorld }: { onFocusWorld?: () => void }) {
  const t = useT(WM);
  const on = useSyncExternalStore(subscribeWalkZoom, onSnap, onSnap);
  const ok = useSyncExternalStore(subscribeWalkZoom, okSnap, okSnap);
  const label = t(on ? "aerial_off_aria" : "aerial_aria");
  return (
    <Button className="pointer-events-auto min-h-11 min-w-11" variant={on ? "primary" : undefined} aria-pressed={on} aria-keyshortcuts="Z"
      aria-label={label} title={label} disabled={!ok && !on}
      icon={<Bird size={16} aria-hidden="true" />}
      onClick={() => { walkZoom.toggle = true; onFocusWorld?.(); }}>
      <span className="hidden @4xl:inline">{t("aerial")}</span>
    </Button>
  );
}
