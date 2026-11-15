/**
 * Dünya yapıcı — doğrulama listesi: hatalar (kaydı engeller) önce, uyarılar sonra. Karolu sorunda "Karoyu göster"
 * ızgarada karoyu vurgular, imleci oraya taşır ve oradaki eşyayı seçer.
 */
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useT } from "../../lib/i18n";
import { prefabAt, useEditor } from "../../lib/builder";
import { builder as M } from "../../locales/builder";
import type { Issue, WorldFile } from "../../voxel/worldFormat";

export type ShownIssue = Issue & { message?: string };

export function IssuesPanel({ issues, world }: { issues: ShownIssue[]; world: WorldFile }) {
  const t = useT(M);
  const setE = useEditor((s) => s.set);
  const errors = issues.filter((i) => i.level === "error"), warnings = issues.filter((i) => i.level === "warning");
  const text = (i: ShownIssue) => {
    if (i.message) return i.message;
    const p = i.params ?? {};
    const kind = typeof p.kind === "string" ? t(`kind_${p.kind}` as never) : "";
    return t(`issue_${i.code}` as never, { ...p, kind, i: i.tile?.[0], j: i.tile?.[1], prefab: i.prefab ?? p.prefab });
  };
  if (!issues.length) {
    return <p className="flex items-center gap-2 text-sm text-ok" role="status"><CheckCircle2 size={16} aria-hidden />{t("issues_ok")}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-ink-2" role="status">{t("issues_count", { e: errors.length, w: warnings.length })}</p>
      <ul className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1">
        {[...errors, ...warnings].map((i, k) => (
          <li key={k} className="flex items-start gap-2 text-sm">
            {i.level === "error"
              ? <XCircle size={16} className="mt-0.5 shrink-0 text-bad" aria-label={t("level_error")} />
              : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" aria-label={t("level_warning")} />}
            <span className="flex-1 min-w-0 break-words text-ink-2">{text(i)}</span>
            {i.tile && (
              <button type="button" className="btn btn-sm btn-ghost shrink-0" onClick={() => {
                const tile = i.tile!;
                setE({ focusTile: tile, cursor: tile, selected: i.prefab ?? prefabAt(world, tile[0], tile[1]) });
              }}>{t("issue_show")}</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
