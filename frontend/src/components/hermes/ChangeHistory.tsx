// Ekip S1: Değişiklik geçmişi — /api/changes kayıtları ve onaylı "Geri al".
import { FileClock, RotateCcw, Undo2 } from "lucide-react";
import { useState } from "react";
import { changesApi, type ChangeEntry } from "../../lib/changes";
import { timeAgo } from "../../lib/format";
import { fmtDate, useT } from "../../lib/i18n";
import { hermesMsg as m } from "../../locales/hermes";
import { Badge, Button, Empty } from "../ui";
import { ConfirmDialog, ErrorBox, LoadingBlock, Note, Rich, useLoad } from "./common";

const KIND_KEY: Record<string, "kind_soul" | "kind_memory" | "kind_env" | "kind_text"> = {
  soul: "kind_soul", memory: "kind_memory", env: "kind_env", text: "kind_text",
};
const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "medium" };

export function ChangeHistory() {
  const t = useT(m);
  const { data, error, loading, reload } = useLoad(() => changesApi.history(100), []);
  const [target, setTarget] = useState<ChangeEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const entries = data ?? [];
  const undone = new Set(entries.filter((e) => e.undone).map((e) => e.id.replace(/:undo$/, "")));

  const undo = async () => {
    if (!target) return;
    setBusy(true);
    setUndoError(null);
    try {
      await changesApi.undo(target.id);
      setTarget(null);
      reload();
    } catch (e) {
      setUndoError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Note tone="info" icon={<FileClock size={15} />}>
        <Rich text={t("hist_note")} parts={{ bak: <code className="font-mono text-xs">{t("hist_bak")}</code> }} />
      </Note>
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={reload}>{t("refresh")}</Button>
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <LoadingBlock /> : entries.length === 0 ? (
        <Empty icon={<FileClock size={28} />} title={t("hist_empty_title")} text={t("hist_empty_text")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((e) => {
            const isUndo = e.undone;
            const wasUndone = undone.has(e.id);
            return (
              <li key={`${e.id}-${e.ts}`} className="panel-soft p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={isUndo ? "warn" : "info"}>{isUndo ? t("hist_undo_badge") : KIND_KEY[e.kind] ? t(KIND_KEY[e.kind]) : e.kind}</Badge>
                    {wasUndone && <Badge>{t("hist_undone")}</Badge>}
                    <span className="text-xs text-muted num">{timeAgo(e.ts * 1000)} · {fmtDate(e.ts * 1000, DATE_TIME)}</span>
                  </div>
                  <p className="text-sm font-semibold mt-1 break-words">{e.summary}</p>
                  <p className="text-xs text-muted font-mono break-all">{e.path}</p>
                  {e.backup && <p className="text-xs text-muted font-mono break-all">{t("hist_backup", { path: e.backup })}</p>}
                </div>
                {!isUndo && !wasUndone && (
                  <Button size="sm" icon={<Undo2 size={14} />} onClick={() => { setUndoError(null); setTarget(e); }}>{t("undo")}</Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog open={!!target} title={t("undo_title")} confirmLabel={t("undo_confirm")} danger busy={busy}
        onConfirm={undo} onClose={() => setTarget(null)}>
        {target && (
          <>
            <p><b>{target.summary}</b></p>
            <p className="font-mono text-xs break-all">{target.path}</p>
            <p>{target.backup ? t("undo_restore") : t("undo_delete")}
              {" "}{t("undo_conflict")}</p>
          </>
        )}
        {undoError && <ErrorBox error={undoError} />}
      </ConfirmDialog>
    </div>
  );
}
