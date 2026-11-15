/**
 * EXP (E1b) — yürüme modu HUD'unda çevre etiketi ve "Ofise dön" ( UX, §11, X1).
 * Avatar yapılı dünyanın dışındayken görünür: "Çevre · {biyom}" (ekran okuyucuya bir kez duyurulur) ve doğma karosuna ışınlayan
 * düğme. Animasyon yok (hareket azaltma); dokunma hedefi ≥ 44 px; 375 px'te üst çubukla birlikte sarılır.
 * E2: avatar keşif sınırı halkasındayken ek "Keşif sınırı" etiketi (D2 A: yarıçap ofis seviyesiyle büyür).
*/
import { Home, Milestone, Trees } from "lucide-react";
import { useT } from "../../../lib/i18n";
import { expanse as XM } from "../../../locales/expanse";
import { useExpanseBiome, useExpanseEdge, useExpanseHome, useExpanseOutside } from "../../../voxel/expanse/hud";
import { expanseText as XT } from "./expanseText";

export function ExpanseChip({ onFocusWorld }: { onFocusWorld?: () => void }) {
  const t = useT(XT);
  const tm = useT(XM);
  const edge = useExpanseEdge();
  const outside = useExpanseOutside();
  const biome = useExpanseBiome();
  const home = useExpanseHome();
  if (!outside || !biome) return null;
  const name = t(`biome_${biome}` as const);
  return (
    <>
      <span className="chip !bg-panel/95 pointer-events-auto shadow min-h-11 max-w-full" role="status" aria-label={t("chip_aria", { biome: name })}>
        <Trees size={15} aria-hidden="true" className="shrink-0" />
        <span className="truncate font-semibold">{t("chip", { biome: name })}</span>
      </span>
      {edge && (
        <span className="chip tone-warn pointer-events-auto shadow min-h-11 max-w-full" role="status" aria-label={tm("edge_aria")}>
          <Milestone size={15} aria-hidden="true" className="shrink-0" />
          <span className="truncate font-semibold">{tm("edge")}</span>
        </span>
      )}
      {home && (
        <button type="button" className="btn pointer-events-auto min-h-11" aria-label={t("home_aria")} title={t("home_aria")}
          onClick={() => { home(); onFocusWorld?.(); }}>
          <Home size={16} aria-hidden="true" />{t("home")}
        </button>
      )}
    </>
  );
}
