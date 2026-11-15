/**
 * WALK-EXPLORE — Başarılar › Albüm: keşif günlüğü. Sahne başına keşif yüzdesi (keşif + hatıra + vize), unvan ve son keşifler.
 * Süre sınırı ve geri sayım yok; kaçırılan bir şey yok (etik liste: FOMO yok, seri yok).
 */
import { Binoculars, Compass, DoorOpen, Eye, Gem, Info } from "lucide-react";
import { useEffect, useMemo } from "react";
import { fmtNumber, fmtPercent, useT } from "../../../../lib/i18n";
import { explore as XM } from "../../../../locales/explore";
import { parseExploreId } from "../../../../voxel/interiors/catalog";
import { SCENE_ORDER } from "../../../../voxel/scenes";
import { sceneLabel } from "../progress/actions";
import { siteName } from "./actions";
import { ensureExplore, useExplore } from "./exploreStore";

const KIND_ICON = { in: DoorOpen, vp: Binoculars, k: Gem, poi: Info, gz: Eye } as const;

export function DiscoveryLog() {
  const t = useT(XM);
  const view = useExplore((s) => s.view);
  const loaded = useExplore((s) => s.loaded);
  const error = useExplore((s) => s.error);
  useEffect(() => { void ensureExplore(); }, []);
  const rows = useMemo(() => SCENE_ORDER.filter((s) => (view?.scenes[s]?.found ?? 0) > 0)
    .map((s) => ({ scene: s, p: view!.scenes[s].percent })), [view]);
  if (!loaded) return null;
  const title = view ? t(view.title.id as "title_none") : "";
  return (
    <section aria-labelledby="album-explore" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id="album-explore" className="font-display font-semibold text-base text-ink">{t("log_title")}</h3>
        {view && <span className="text-sm text-ink-2 num">{t("log_total", { n: fmtNumber(view.count), title })}</span>}
      </div>
      <p className="text-xs text-ink-2 max-w-3xl flex items-start gap-1.5"><Compass size={13} aria-hidden="true" className="shrink-0 mt-0.5" />{t("log_intro")}</p>
      {error && <p className="text-xs text-muted" role="status">{t("log_offline")}</p>}
      {view && view.count === 0 && <p className="text-xs text-muted">{t("log_empty")}</p>}
      {rows.length > 0 && (
        <ul className="grid gap-2 grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {rows.map((r) => (
            <li key={r.scene} className="panel p-2.5 flex flex-col gap-1.5 min-w-0" aria-label={t("log_scene_aria", { scene: sceneLabel(r.scene), p: r.p })}>
              <span className="text-sm font-semibold text-ink truncate">{t("log_scene_row", { scene: sceneLabel(r.scene), p: r.p })}</span>
              <div role="progressbar" aria-label={sceneLabel(r.scene)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.p} aria-valuetext={fmtPercent(r.p)}
                className="h-2 rounded-full border border-line-soft bg-panel-3 overflow-hidden">
                <div className="h-full bg-sky" style={{ width: `${r.p}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {view && view.log.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-semibold text-ink">{t("log_recent")}</h4>
          <ul className="flex flex-col gap-1">
            {view.log.slice(0, 12).map((row) => {
              const p = parseExploreId(row.id);
              if (!p) return null;
              const Icon = KIND_ICON[p.kind];
              const kind = t(`log_kind_${p.kind}` as "log_kind_in");
              const what = p.site ? siteName(p.scene, p.site) : sceneLabel(p.scene);
              return (
                <li key={row.id} className="flex items-center gap-2 text-sm min-w-0">
                  <Icon size={14} aria-hidden="true" className="shrink-0 text-ink-2" />
                  <span className="text-ink-2 shrink-0">{kind}</span>
                  <span className="truncate text-ink">{p.site ? `${what} · ${sceneLabel(p.scene)}` : what}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
