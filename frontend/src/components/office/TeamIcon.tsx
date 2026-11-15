import {
  BarChart3, Building2, Code2, Compass, FileText, Megaphone, Palette, PenLine, Rocket, ShieldCheck, Target, Telescope, Users,
  type LucideIcon,
} from "lucide-react";
import { tx } from "../../lib/i18n";
import { inkOn } from "../../lib/office";
import { officeMsg } from "../../locales/office";

const ICONS: Record<string, LucideIcon> = {
  users: Users, target: Target, code: Code2, shield: ShieldCheck, palette: Palette, telescope: Telescope, pen: PenLine,
  compass: Compass, chart: BarChart3, file: FileText, megaphone: Megaphone, rocket: Rocket, building: Building2,
};

/** Ekip/şablon simge adı (backend'de düz metin) → lucide bileşeni + dil duyarlı etiket (getter). */
export const TEAM_ICONS: Record<string, { icon: LucideIcon; label: string }> = Object.fromEntries(
  Object.entries(ICONS).map(([k, icon]) => [k, Object.defineProperties({ icon } as { icon: LucideIcon; label: string }, {
    label: { enumerable: true, get: () => tx(officeMsg, `icon_${k}` as keyof typeof officeMsg.tr) },
  })]),
);

export const ICON_KEYS = Object.keys(TEAM_ICONS);

export function TeamIcon({ name, size = 16, className }: { name?: string | null; size?: number; className?: string }) {
  const Icon = TEAM_ICONS[name ?? ""]?.icon ?? Users;
  return <Icon size={size} className={className} aria-hidden />;
}

/** Ekip rengiyle dolu küçük simge kutusu. */
export function TeamBadge({ color, icon, size = 34 }: { color: string; icon?: string | null; size?: number }) {
  return (
    <span className="grid place-items-center shrink-0 rounded-lg border-2 border-line"
      style={{ width: size, height: size, background: color, color: inkOn(color), boxShadow: "0 2px 0 var(--shadow)" }}>
      <TeamIcon name={icon} size={Math.round(size * 0.5)} />
    </span>
  );
}
