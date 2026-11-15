// TRUST — kabuk rozeti: güvenli mod açıkken her sayfada görünür ("Güvenli mod açık"); tıklayınca ayarına gider.
import clsx from "clsx";
import { ShieldCheck } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../lib/i18n";
import { useSafeMode, wireSafeMode } from "../../lib/safeMode";
import { safetyMsg } from "../../locales/safety";

export function SafeModeBadge({ className }: { className?: string }) {
  const t = useT(safetyMsg);
  const enabled = useSafeMode((s) => s.status?.enabled === true);
  useEffect(() => { wireSafeMode(); }, []);
  if (!enabled) return null;
  return (
    <Link to="/baglantilar#guvenli-mod" title={t("badge_title")}
      className={clsx("chip tone-ok shrink-0 font-semibold", className)}>
      {/* dar üst çubukta (375 px) yalnız simge görünür; ad ekran okuyucuda kalır */}
      <ShieldCheck size={12} aria-hidden /><span className="max-sm:sr-only">{t("badge")}</span>
    </Link>
  );
}
