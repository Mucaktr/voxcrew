/**
 * W4 (WALK-GAME-UI) — Başarılar › Albüm sekmesi: sahne başına hatıralar (bulunan/5, eksikler
 * silüet), sahne başına simge vizeleri (şehir açmaz) ve mini oyun kartları (olta, masa, atış; jeton yok).
 * Veri: `GET /api/walk/state` (tüm sahneler) + `GET /api/walk/catalog`; kartlar `useCards` (sunucuyla eşitlenmiş yerel önbellek).
*/
import clsx from "clsx";
import { Bell, Check, Dices, Fish, Footprints, Lamp, Mail, Shell, Stamp, Target, Ticket, type LucideIcon } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useT } from "../../../lib/i18n";
import { ensureWalkProgress, useWalkProgress, walkApi, type WalkCatalog } from "../../../lib/walk";
import { walk as WM } from "../../../locales/walk";
import { FISH } from "../../../voxel/fun/minigameLogic";
import { useCards } from "../../../voxel/fun/minigames";
import { SCENE_ORDER } from "../../../voxel/scenes";
import { landmarkLabel, sceneLabel } from "../../world/walk/progress/actions";
import { albumRow, souvenirModel, SOUVENIRS_PER_SCENE, type SouvenirModel } from "../../world/walk/progress/logic";
import { Spinner } from "../../ui";
import { DiscoveryLog } from "../../world/walk/explore/DiscoveryLog";
import { useGameData } from "../useGameData";

export const SOUVENIR_ICON: Record<SouvenirModel, LucideIcon> = { lantern: Lamp, shell: Shell, ticket: Ticket, postcard: Mail, bell: Bell };

export function AlbumView() {
  const t = useT(WM);
  const loaded = useWalkProgress((s) => s.loaded);
  const error = useWalkProgress((s) => s.error);
  useEffect(() => { void ensureWalkProgress(); }, []);
  const { data: catalog } = useGameData<WalkCatalog>(() => walkApi.catalog(), []);

  if (!loaded) return <div className="grid place-items-center py-16"><Spinner size={24} /></div>;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="section-title">{t("album_title")}</h2>
        <p className="text-sm text-ink-2 max-w-3xl">{t("album_intro")}</p>
        {error && <p className="text-xs text-muted" role="status">{t("album_offline")}</p>}
      </div>
      <SouvenirSection catalog={catalog} />
      <VisaSection catalog={catalog} />
      {/* WALK-EXPLORE: keşif günlüğü (iç mekân, seyir noktası, bilgi noktası, gizli köşe, keşif parçası; sahne yüzdesi, unvan) */}
      <DiscoveryLog />
      <CardSection />
    </div>
  );
}

// ------------------------------------------------------------------ hatıralar
function SouvenirSection({ catalog }: { catalog: WalkCatalog | null }) {
  const t = useT(WM);
  const found = useWalkProgress((s) => s.pickup.found);
  const scenes = useMemo(() => {
    const ids = catalog && Object.keys(catalog.scenes).length ? SCENE_ORDER.filter((s) => catalog.scenes[s]) : SCENE_ORDER;
    return ids.map((s) => albumRow(s, found));
  }, [catalog, found]);
  const total = scenes.length * SOUVENIRS_PER_SCENE;
  const n = scenes.reduce((a, r) => a + r.found, 0);
  return (
    <section aria-labelledby="album-souvenirs" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id="album-souvenirs" className="font-display font-semibold text-base text-ink">{t("album_souvenirs")}</h3>
        <span className="text-sm text-ink-2 num">{t("album_souvenirs_sum", { n, total })}</span>
      </div>
      {n === 0 && <p className="text-xs text-muted flex items-center gap-1.5"><Footprints size={13} aria-hidden="true" />{t("album_hint_walk")}</p>}
      <ul className="grid gap-2 grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {scenes.map((r) => (
          <li key={r.scene} className="min-w-0">
            <article className={clsx("panel p-2.5 flex flex-col gap-2 h-full", r.found === SOUVENIRS_PER_SCENE && "border-[color:var(--ok-fg)]")} aria-label={`${sceneLabel(r.scene)}: ${t("album_scene_count", { n: r.found, total: SOUVENIRS_PER_SCENE })}`}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-sm text-ink truncate flex-1">{sceneLabel(r.scene)}</span>
                {r.found === SOUVENIRS_PER_SCENE
                  ? <span className="chip tone-ok text-xs"><Check size={11} aria-hidden="true" />{t("album_complete")}</span>
                  : <span className="text-xs num text-ink-2">{t("album_scene_count", { n: r.found, total: SOUVENIRS_PER_SCENE })}</span>}
              </div>
              <ul className="flex gap-1.5" aria-label={t("album_souvenirs")}>
                {r.slots.map((on, k) => {
                  const model = souvenirModel(k + 1);
                  const Icon = SOUVENIR_ICON[model];
                  const name = t(`sv_${model}` as "sv_lantern");
                  return (
                    <li key={k} title={on ? name : t("album_slot_missing")}
                      className={clsx("grid place-items-center h-9 w-9 rounded-lg border-2", on ? "border-line bg-panel-2 text-ink" : "border-dashed border-line-soft text-muted")}>
                      <Icon size={17} aria-hidden="true" strokeWidth={on ? 2 : 1.5} />
                      <span className="sr-only">{on ? t("album_slot_found", { name }) : t("album_slot_missing")}</span>
                    </li>
                  );
                })}
              </ul>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ vizeler
/** Vizeler bölümü (albüm ve pasaport şeridi ortak). `compact`: yalnız sayı, not ve albüm bağlantısı. */
export function VisaSection({ catalog }: { catalog: WalkCatalog | null }) {
  const t = useT(WM);
  const visas = useWalkProgress((s) => s.visas);
  const rows = useMemo(() => {
    const out: { scene: string; ids: string[] }[] = [];
    if (catalog && Object.keys(catalog.scenes).length) {
      for (const s of SCENE_ORDER) { const l = catalog.scenes[s]?.landmarks ?? []; if (l.length) out.push({ scene: s, ids: l }); }
    } else {
      // katalog yoksa yalnızca kazanılmış vizeler
      const by = new Map<string, string[]>();
      for (const v of visas) { const s = v.slice(0, v.indexOf(":")); (by.get(s) ?? by.set(s, []).get(s)!).push(v); }
      for (const [scene, ids] of by) out.push({ scene, ids });
    }
    return out;
  }, [catalog, visas]);
  const total = rows.reduce((a, r) => a + r.ids.length, 0);
  const n = rows.reduce((a, r) => a + r.ids.filter((i) => visas.has(i)).length, 0);
  return (
    <section aria-labelledby="album-visas" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id="album-visas" className="font-display font-semibold text-base text-ink">{t("album_visas")}</h3>
        <span className="text-sm text-ink-2 num">{t("album_visas_sum", { n, total: Math.max(total, n) })}</span>
      </div>
      <p className="text-xs text-ink-2 flex items-start gap-1.5"><Stamp size={13} aria-hidden="true" className="shrink-0 mt-0.5" />{t("album_visas_note")}</p>
      {rows.length > 0 && (
        <ul className="grid gap-2 grid-cols-1 md:grid-cols-2">
          {rows.map((r) => (
            <li key={r.scene} className="panel p-2.5 min-w-0">
              <p className="text-sm font-semibold text-ink mb-1.5">{sceneLabel(r.scene)}
                <span className="ml-2 text-xs font-normal num text-ink-2">{r.ids.filter((i) => visas.has(i)).length}/{r.ids.length}</span></p>
              <ul className="flex flex-wrap gap-1.5">
                {r.ids.map((id) => {
                  const on = visas.has(id);
                  const name = landmarkLabel(id);
                  return (
                    <li key={id} className={clsx("chip text-xs max-w-full", on ? "tone-info" : "tone-muted border-dashed")}
                      aria-label={on ? t("album_visa_found", { name }) : t("album_visa_missing", { name })}>
                      {on ? <Stamp size={11} aria-hidden="true" /> : null}<span className="truncate">{name}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ kartlar
function CardSection() {
  const t = useT(WM);
  const cards = useCards((s) => s.cards);
  const groups: { key: "fish" | "board" | "toss"; icon: LucideIcon; label: string; items: { id: string; name: string }[] }[] = [
    { key: "fish", icon: Fish, label: t("album_cards_fish"), items: FISH.map((f) => ({ id: `fish:${f.id}`, name: t(`mg_fish_${f.id}` as "mg_fish_hamsi") })) },
    { key: "board", icon: Dices, label: t("album_cards_board"), items: [{ id: "board", name: t("mg_card_board") }] },
    { key: "toss", icon: Target, label: t("album_cards_toss"), items: [{ id: "toss", name: t("mg_card_toss") }] },
  ];
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  const n = groups.reduce((a, g) => a + g.items.filter((i) => (cards[i.id] ?? 0) > 0).length, 0);
  return (
    <section aria-labelledby="album-cards" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id="album-cards" className="font-display font-semibold text-base text-ink">{t("album_cards")}</h3>
        <span className="text-sm text-ink-2 num">{t("album_cards_sum", { n, total })}</span>
      </div>
      <div className="grid gap-2 grid-cols-1 md:grid-cols-3">
        {groups.map((g) => (
          <div key={g.key} className="panel p-2.5 min-w-0">
            <p className="text-sm font-semibold text-ink mb-1.5 flex items-center gap-1.5"><g.icon size={14} aria-hidden="true" className="text-ink-2" />{g.label}</p>
            <ul className="flex flex-wrap gap-1.5">
              {g.items.map((c) => {
                const k = cards[c.id] ?? 0;
                return (
                  <li key={c.id} className={clsx("chip text-xs", k ? "tone-ok" : "tone-muted border-dashed")}
                    aria-label={k ? `${c.name} ${t("album_card_count", { n: k })}` : `${c.name}: ${t("album_card_missing")}`}>
                    <span>{k ? c.name : "?"}</span>
                    {k > 0 && <span className="num">{t("album_card_count", { n: k })}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
