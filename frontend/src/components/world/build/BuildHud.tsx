/**
 * E3 (BUILD-UX) — yapı modu HUD'u ( UX, §8; X11–X15). Yalnız yürüme modunda bağlanır
 * (WorldPage). Kapalıyken: "İnşa" düğmesi (B; dünyada parselin varken). Açıkken altta tek panel: parsel adı, deneme rozeti, sayaçlar,
 * Koy/Kır geçişi, Döndür, Geri al/Yinele, Kaydet, Bitir; yatay kaydırmalı palet; hayalet durumu ve kısayol ipucu.
 *
 * Erişilebilirlik: dokunma hedefleri ≥ 44 px; ekran okuyucu duyuruları `aria-live="polite"` (kat ve karo, konan/kırılan öğe,
 * kaydetme); kaydedilmemiş değişiklikle çıkışta onay penceresi; animasyon yok (hareket azaltma); 375 px'te panel sarılır, palet
 * kendi içinde kaydırılır (sayfa yatay taşmaz). Dokunmatikte panel joystick ve Etkileşim düğmesinin üstünde durur.
*/
import clsx from "clsx";
import { Check, Hammer, Pickaxe, Redo2, RotateCw, Save, Undo2, X } from "lucide-react";
import { useEffect } from "react";
import { exitBuild, installBuildUnloadGuard, otherEdits, redoBuild, requestExit, saveAndExit, saveBuild, undoBuild } from "../../../lib/build";
import { useT } from "../../../lib/i18n";
import { build as BM } from "../../../locales/build";
import { MAX_EDITS_TOTAL } from "../../../voxel/build/catalog";
import { useBuildStore } from "../../../voxel/build/store";
import { occupancy } from "../../../voxel/build/volume";
import { usePlotsFor } from "../../../voxel/expanse/plotStore";
import { useCoarse } from "../walk/media";
import { InHudZone } from "../walk/hudZones";
import { Button, Modal } from "../../ui";
import { BuildPalette } from "./Palette";

export function BuildHud({ world, swatch, onFocusWorld }: { world: string; swatch: string | null; onFocusWorld?: () => void }) {
  const t = useT(BM);
  const coarse = useCoarse();
  const plots = usePlotsFor(world);
  const active = useBuildStore((s) => s.active);
  const toggle = useBuildStore((s) => s.toggle);
  const announce = useBuildStore((s) => s.announce);
  const note = useBuildStore((s) => s.note);
  useEffect(() => { installBuildUnloadGuard(); }, []);

  const toastText = note ? t(`msg_${note.code}` as never, note.vars) : "";
  return (
    <>
      {/* ekran okuyucu: yapı modu duyuruları (her duyuruda yeni anahtar → yeniden okunur) */}
      <span className="sr-only" role="status" aria-live="polite" key={announce.seq}>{announce.text}</span>
      {!active && plots.length > 0 && (
        // UIUX-OVERLAP: yürüme HUD ızgarasının alt sol köşesi (keşif izleyicisinin altında, aynı akışta)
        <InHudZone zone="cornerEnd">
        <div className="pointer-events-none flex flex-col items-start gap-1.5 max-w-full">
          {note && (
            <span className={clsx("chip shadow pointer-events-auto max-w-full", note.tone === "warn" ? "tone-warn" : "!bg-panel/95")} role="status">
              <span className="truncate">{toastText}</span>
            </span>
          )}
          <button type="button" className="btn pointer-events-auto min-h-11 shadow" aria-keyshortcuts="B" aria-label={t("open_aria")} title={t("open_aria")}
            disabled={!toggle} onClick={() => { toggle?.(); onFocusWorld?.(); }}>
            <Hammer size={16} aria-hidden="true" />{t("open")}
          </button>
        </div>
        </InHudZone>
      )}
      {active && <BuildPanel swatch={swatch} coarse={coarse} onFocusWorld={onFocusWorld} />}
    </>
  );
}

function BuildPanel({ swatch, coarse, onFocusWorld }: { swatch: string | null; coarse: boolean; onFocusWorld?: () => void }) {
  const t = useT(BM);
  const plotId = useBuildStore((s) => s.plotId);
  const draft = useBuildStore((s) => s.draft);
  const trial = useBuildStore((s) => s.trial);
  const dirty = useBuildStore((s) => s.dirty);
  const saving = useBuildStore((s) => s.saving);
  const tool = useBuildStore((s) => s.tool);
  const rot = useBuildStore((s) => s.rot);
  const canUndo = useBuildStore((s) => s.history.past.length > 0);
  const canRedo = useBuildStore((s) => s.history.future.length > 0);
  const ghost = useBuildStore((s) => s.ghost);
  const note = useBuildStore((s) => s.note);
  const confirm = useBuildStore((s) => s.confirmExit);
  const world = useBuildStore((s) => s.world);
  const plots = usePlotsFor(world);
  const plot = plots.find((p) => p.id === plotId) ?? null;
  const set = useBuildStore((s) => s.set);
  const back = () => onFocusWorld?.();
  const ground = draft ? occupancy(draft).groundCount : 0;
  const total = otherEdits(plotId) + (draft?.edits.length ?? 0);
  const plotName = plot ? (plot.name || `#${plot.slot + 1}`) : "";
  const ghostText = ghost
    ? ghost.code ? t("ghost_bad", { why: t(`code_${ghost.code}` as never) })
      : t(ghost.action === "place" ? "ghost_ok_place" : "ghost_ok_break", { y: ghost.cell[1] + 1, i: ghost.cell[0] + 1, j: ghost.cell[2] + 1 })
    : "";
  const iconBtn = "min-h-11 min-w-11";
  return (
    <>
      {/* UIUX-OVERLAP: yürüme HUD ızgarasının "dock" yuvası (alt satırın üstü, mini harita sütunu dışında) */}
      <InHudZone zone="dock">
      <section aria-label={t("title", { plot: plotName })}
        className="w-full max-w-[46rem] panel !rounded-xl shadow-lg p-2 flex flex-col gap-1.5 pointer-events-auto">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <h2 className="font-display font-bold text-sm min-w-0 truncate flex-1">{t("title", { plot: plotName })}</h2>
          {trial && <span className="chip tone-warn text-xs">{t("trial_badge")}</span>}
          <span className={clsx("chip text-xs", dirty ? "tone-warn" : "tone-muted")} role="status">
            {saving ? t("saving") : dirty ? t("unsaved") : t("saved")}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-0.5 sm:gap-1">
          {coarse ? (
            // dokunmatik: tek "Koy/Kır" geçiş düğmesi (plan §4.2) — 375 px'te araç satırı tek satırda kalır
            <Button className={clsx(iconBtn, "btn-primary !px-2")} icon={tool === "place" ? <Hammer size={16} aria-hidden="true" /> : <Pickaxe size={16} aria-hidden="true" />}
              aria-label={t("tool_aria", { tool: tool === "place" ? t("place") : t("break") })}
              onClick={() => { set({ tool: tool === "place" ? "break" : "place" }); back(); }}>{tool === "place" ? t("place") : t("break")}</Button>
          ) : (
            <>
              <Button className={clsx(iconBtn, tool === "place" && "btn-primary")} aria-pressed={tool === "place"} icon={<Hammer size={16} aria-hidden="true" />}
                onClick={() => { set({ tool: "place" }); back(); }}>{t("place")}</Button>
              <Button className={clsx(iconBtn, tool === "break" && "btn-primary")} aria-pressed={tool === "break"} icon={<Pickaxe size={16} aria-hidden="true" />}
                onClick={() => { set({ tool: "break" }); back(); }}>{t("break")}</Button>
            </>
          )}
          <Button className={iconBtn} icon={<RotateCw size={16} aria-hidden="true" />} aria-keyshortcuts="R" aria-label={t("rotate_aria", { deg: rot * 90 })}
            title={t("rotate_aria", { deg: rot * 90 })} onClick={() => { set({ rot: (rot + 1) & 3 }); back(); }}>
            {!coarse && <span className="hidden sm:inline">{t("rotate")}</span>}
          </Button>
          <Button className={iconBtn} icon={<Undo2 size={16} aria-hidden="true" />} disabled={!canUndo} aria-keyshortcuts="Control+Z"
            aria-label={t("undo_aria")} title={t("undo_aria")} onClick={() => { undoBuild(); back(); }} />
          <Button className={iconBtn} icon={<Redo2 size={16} aria-hidden="true" />} disabled={!canRedo} aria-keyshortcuts="Control+Y"
            aria-label={t("redo_aria")} title={t("redo_aria")} onClick={() => { redoBuild(); back(); }} />
          <span className="flex-1" />
          <Button variant="primary" className={iconBtn} icon={<Save size={16} aria-hidden="true" />} disabled={saving || (!dirty && !trial)}
            aria-keyshortcuts="Control+S" aria-label={t("save_aria")} title={t("save_aria")} onClick={() => { void saveBuild(); back(); }}>
            {!coarse && <span className="hidden sm:inline">{t("save")}</span>}
          </Button>
          <Button className={iconBtn} icon={<Check size={16} aria-hidden="true" />} aria-keyshortcuts="Escape" aria-label={t("close_aria")}
            title={t("close_aria")} onClick={() => { requestExit(); back(); }}>{!coarse && <span className="hidden sm:inline">{t("close")}</span>}</Button>
        </div>
        <BuildPalette swatch={swatch} onPicked={back} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-2 min-w-0">
          <span className="num">{t("counts", { edits: draft?.edits.length ?? 0, prefabs: draft?.prefabs.length ?? 0, ground })}</span>
          <span className={clsx("num hidden sm:inline", total > MAX_EDITS_TOTAL && "text-bad font-semibold")}>{t("world_total", { n: total })}</span>
          {ghost && <span className={clsx("font-semibold", ghost.code ? "text-bad" : "")} aria-hidden="true">{ghostText}</span>}
        </div>
        {note && <p className={clsx("text-xs", note.tone === "warn" ? "font-semibold" : "text-ink-2")} role="status">{t(`msg_${note.code}` as never, note.vars)}</p>}
        <p className="text-xs text-muted">{coarse ? t("keys_touch", { tool: tool === "place" ? t("place") : t("break") }) : t("keys")}</p>
      </section>
      </InHudZone>
      <Modal open={confirm} onClose={() => { set({ confirmExit: false }); back(); }} title={t("confirm_title")} width={480}
        footer={<div className="flex flex-wrap justify-end gap-2">
          <Button onClick={() => { set({ confirmExit: false }); back(); }}>{t("confirm_stay")}</Button>
          {!trial && <Button onClick={() => { exitBuild("discard"); back(); }}>{t("confirm_discard")}</Button>}
          <Button onClick={() => { exitBuild("keep"); back(); }} icon={<X size={15} aria-hidden="true" />}>{t("confirm_leave")}</Button>
          {!trial && <Button variant="primary" disabled={saving} onClick={() => { void saveAndExit().then(back); }}>{t("confirm_save")}</Button>}
        </div>}>
        <p className="text-sm text-ink-2">{trial ? t("confirm_body_trial") : t("confirm_body")}</p>
      </Modal>
    </>
  );
}
