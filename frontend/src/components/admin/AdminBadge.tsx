// S40 — üst çubuk rozeti: yönetici / test modu açıkken her sayfada görünür ("TEST MODU" / "TEST MODE"), böylece
// ekran görüntüleri ve demolar normal modla karıştırılmaz. brand.ts adminModeAvailable false ise hiç çizilmez.
import clsx from "clsx";
import { FlaskConical } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ADMIN_MODE_AVAILABLE, useAdminActive, wireAdmin } from "../../lib/admin";
import { useT } from "../../lib/i18n";
import { adminMsg } from "../../locales/admin";

export function AdminBadge({ className }: { className?: string }) {
  if (!ADMIN_MODE_AVAILABLE) return null;
  return <AdminBadgeInner className={className} />;
}

function AdminBadgeInner({ className }: { className?: string }) {
  const t = useT(adminMsg);
  const active = useAdminActive();
  useEffect(() => { wireAdmin(); }, []);
  if (!active) return null;
  return (
    <Link to="/ayarlar" title={t("badge_title")} aria-label={t("badge_aria")}
      className={clsx("chip tone-warn shrink-0 font-semibold tracking-wide", className)}>
      <FlaskConical size={12} aria-hidden />{t("badge")}
    </Link>
  );
}
