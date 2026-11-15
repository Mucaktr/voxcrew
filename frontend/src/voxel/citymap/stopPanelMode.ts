/**
 * durak paneli kipi (saf; React yok). Hatlı durakta varışta tek satır çip, çipe/F'ye basınca panel; hatsız durakta
 * (ör. İstanbul `sultanahmet`, hiçbir hatta yok) çip çıkmaz ama F / Yakındakiler ile açılırsa panel boş kalmaz, "hat yok" notu gösterir.
*/
export type StopPanelMode = "dialog" | "panel" | "chip" | "none";

export function stopPanelMode(nLines: number, stopPanel: boolean, hasStop: boolean, dialog: boolean): StopPanelMode {
  if (dialog) return "dialog";
  if (stopPanel && hasStop) return "panel";
  return nLines > 0 && hasStop ? "chip" : "none";
}
