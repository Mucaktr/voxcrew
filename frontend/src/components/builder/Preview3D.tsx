/**
 * Dünya yapıcı — 3B önizleme: taslak dünya geçici bir sahne kimliğiyle kaydedilir ve gerçek `World` renderer'ı ile
 * çizilir (aynı instanced bloklar; yeni render yolu yok). İki deneme ajanı istasyon, araç noktası ve dinlenme arasında
 * gidip gelir — yol bulma canlı denenir. Taslak değişince 400 ms sonra yeniden pişer (tuval yeniden kurulmaz).
 */
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../lib/i18n";
import { builder as M } from "../../locales/builder";
import { registerScene, unregisterScene, type WorldSceneId } from "../../voxel/scenes";
import { World, type WorldAgent } from "../../voxel/World";
import { worldSceneDef, type WorldFile } from "../../voxel/worldFormat";

const PREVIEW_ID = "w_onizleme";

const AGENTS: WorldAgent["agent"][] = [
  { slug: "onizleme-1", name: "Ada", color: "#3B82F6", avatar: { species: "human" } },
  { slug: "onizleme-2", name: "Can", color: "#F59E0B", avatar: { species: "fox" } },
];
/** Döngü: masada çalış → web aracı → dinlen. */
const PHASES: [WorldAgent["mood"], string | null][] = [["working", null], ["working", "web_search"], ["offline", null], ["working", "read_file"]];

export function Preview3D({ world }: { world: WorldFile }) {
  const t = useT(M);
  const [ver, setVer] = useState(0);
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const h = window.setTimeout(() => {
      registerScene({ ...worldSceneDef(world), id: PREVIEW_ID as WorldSceneId });
      setVer((v) => v + 1);
    }, ver === 0 ? 0 : 400);
    return () => window.clearTimeout(h);
  }, [world]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => unregisterScene(PREVIEW_ID), []);
  useEffect(() => {
    const h = window.setInterval(() => setPhase((p) => (p + 1) % PHASES.length), 6000);
    return () => window.clearInterval(h);
  }, []);
  const agents = useMemo<WorldAgent[]>(() => AGENTS.map((a, k) => {
    const [mood, tool] = PHASES[(phase + k * 2) % PHASES.length];
    return { agent: a, mood, activity: "", tool };
  }), [phase, ver]); // yeni dizi → World yeniden çizilir ve kayıtlı taslağı (sceneDef) yeniden pişirir
  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-[52vh] min-h-[320px] overflow-hidden rounded-lg border-2 border-line" role="img" aria-label={t("preview_aria")}>
        {ver > 0 && <World scene={PREVIEW_ID as WorldSceneId} agents={agents} selected={null} onSelect={() => undefined} />}
      </div>
      <p className="text-xs text-muted">{t("preview_hint")}</p>
    </div>
  );
}
