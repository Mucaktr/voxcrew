// AUDIT-FIX #5: WorkZones.tsx'ten ayrıldı ve tembel yüklenir — voxel/scenes (bütün şehir kodu) giriş paketine girmez.
import { useMemo } from "react";
import { currentLocale, useT } from "../../lib/i18n";
import { useStudio } from "../../lib/store";
import { workZonesMsg } from "../../locales/workZones";
import { buildWorld, worldDemand } from "../../voxel/scenes";
import { parseZone, zoneName } from "../../voxel/workzones/registry";
import { officeSites, withOffices } from "../../voxel/workzones/world";

const lang = () => (currentLocale() === "en" ? "en" : "tr");

/** Seçili ofisin dünyadaki yeri (yaklaşık): modül kutuları + ana ofis + ofis. */
function useZoneMap(scene: string | null, zone: string): { boxes: { x: number; y: number; w: number; h: number; kind: "hq" | "office" | "other" }[]; w: number; h: number; dir: "left" | "right" | "front" | "back" } | null {
  const agents = useStudio((s) => s.agents);
  const n = agents.filter((a) => !a.hidden).length;
  return useMemo(() => {
    if (!scene || !parseZone(zone)) return null;
    try {
      const built = buildWorld(scene, n, withOffices(worldDemand(agents.filter((a) => !a.hidden).map(() => ({ team: null })), []), scene, [zone]));
      const site = officeSites(built).find((s) => s.zone === zone);
      const hq = built.modules.find((m) => m.base);
      if (!site || !hq) return null;
      const boxes = built.modules.map((m) => ({ x: m.i0, y: m.j0, w: m.w, h: m.d,
        kind: (m.base ? "hq" : m.i0 === site.i0 && m.j0 === site.j0 ? "office" : "other") as "hq" | "office" | "other" }));
      const dx = site.i0 + 6 - (hq.i0 + hq.w / 2), dz = site.j0 + 8 - (hq.j0 + hq.d / 2);
      const dir = Math.abs(dx) >= Math.abs(dz) ? (dx < 0 ? "left" : "right") : dz < 0 ? "back" : "front";
      return { boxes, w: built.width, h: built.depth, dir };
    } catch { return null; }
  }, [scene, zone, n]); // eslint-disable-line react-hooks/exhaustive-deps
}

export default function ZoneMiniMap({ scene, zone }: { scene: string | null; zone: string }) {
  const t = useT(workZonesMsg);
  const map = useZoneMap(scene, zone);
  if (!map) return null;
  const name = zoneName(zone, lang());
  return (
    <figure className="flex items-center gap-3 mt-2">
      <svg viewBox={`0 0 ${map.w} ${map.h}`} className="w-28 h-auto shrink-0 rounded-md border border-line-soft bg-panel-2" role="img"
        aria-label={t("map_label", { name, dir: t(`dir_${map.dir}` as const) })}>
        {map.boxes.map((b, k) => (
          <rect key={k} x={b.x + 0.6} y={b.y + 0.6} width={b.w - 1.2} height={b.h - 1.2} rx={1.5}
            className={b.kind === "office" ? "fill-accent" : b.kind === "hq" ? "fill-ink-2" : "fill-line-soft"} />
        ))}
      </svg>
      <figcaption className="text-xs text-muted">{t("map_label", { name, dir: t(`dir_${map.dir}` as const) })}<br />{t("map_hint")}</figcaption>
    </figure>
  );
}

