// Sihirbazın sahne adımı (OnboardingWizard tembel yükler; sahne kataloğu ana pakete girmesin).
import clsx from "clsx";
import { Check, Lock } from "lucide-react";
import { useState } from "react";
import { isUnlocked } from "../../lib/game";
import { useT } from "../../lib/i18n";
import { useStudio } from "../../lib/store";
import type { SceneId } from "../../lib/types";
import { shell } from "../../locales/shell";
import { SCENE_ORDER, SCENES } from "../../voxel/scenes";

export function SceneStep() {
  const scene = useStudio((s) => s.scene);
  const setScene = useStudio((s) => s.setScene);
  const [error, setError] = useState<string | null>(null);
  const t = useT(shell);
  const choose = async (id: string) => {
    setError(null);
    try { await setScene(id as SceneId); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-2">{t("ob_scene_intro")}</p>
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2" role="group" aria-label={t("ob_scene_group")}>
        {SCENE_ORDER.map((id) => {
          const def = SCENES[id];
          const open = isUnlocked(id);
          const active = scene === id;
          return (
            <button key={id} type="button" aria-pressed={active} disabled={!open} onClick={() => { void choose(id); }}
              className={clsx("card-select p-2.5 flex items-center gap-3 min-w-0", !open && "opacity-60 cursor-not-allowed")}>
              <span aria-hidden className="h-10 w-10 shrink-0 rounded-md border-2 border-line overflow-hidden grid grid-rows-2">
                <span style={{ background: def.swatch[1] }} /><span style={{ background: def.swatch[0] }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-semibold text-sm">
                  {def.label}
                  {active && <Check size={14} className="text-ok" aria-hidden />}
                  {!open && <Lock size={13} className="text-muted" aria-label={t("ob_locked")} />}
                </span>
                <span className="block text-xs text-muted truncate">{open ? def.hint : t("ob_scene_locked_hint")}</span>
              </span>
            </button>
          );
        })}
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </div>
  );
}
