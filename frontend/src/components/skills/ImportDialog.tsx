// Ekip S14: içe aktarma penceresi — SKILL.md yapıştır · klasör yolu · zip yükle (zip slip ve boyut sınırı sunucuda).
import { useId, useState } from "react";
import { useT } from "../../lib/i18n";
import { skillsApi, type SkillEntry } from "../../lib/skills";
import { skillsMsg as m } from "../../locales/skills";
import { Button, Field, Modal, Segmented, Spinner } from "../ui";
import { ErrorRow, Note } from "./common";

type Kind = "paste" | "folder" | "zip";

export function ImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (e: SkillEntry) => void }) {
  return (
    <Modal open={open} onClose={onClose} title={<Title />} width={720}>
      {open && <ImportForm onClose={onClose} onImported={onImported} />}
    </Modal>
  );
}

function Title() { const t = useT(m); return <>{t("import_title")}</>; }

function ImportForm({ onClose, onImported }: { onClose: () => void; onImported: (e: SkillEntry) => void }) {
  const t = useT(m);
  const [kind, setKind] = useState<Kind>("paste");
  const [content, setContent] = useState("");
  const [path, setPath] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileId = useId();

  const run = async () => {
    setError(null);
    setDone(null);
    try {
      let entry: SkillEntry;
      if (kind === "paste") {
        if (!content.trim()) { setError(t("imp_content_required")); return; }
        setBusy(true);
        entry = await skillsApi.importPaste(content, id.trim() || undefined);
      } else if (kind === "folder") {
        if (!path.trim()) { setError(t("imp_path_required")); return; }
        setBusy(true);
        entry = await skillsApi.importFolder(path.trim(), id.trim() || undefined);
      } else {
        if (!file) { setError(t("imp_file_required")); return; }
        setBusy(true);
        entry = await skillsApi.importZip(file, id.trim() || undefined);
      }
      setDone(t("imp_done", { name: entry.name }));
      onImported(entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void run(); }}>
      <Segmented value={kind} onChange={setKind} className="flex-wrap" options={[
        { value: "paste", label: t("imp_paste") }, { value: "folder", label: t("imp_folder") }, { value: "zip", label: t("imp_zip") },
      ]} />
      {kind === "paste" && (
        <Field label={t("imp_paste")} hint={t("imp_paste_hint")}>
          <textarea className="textarea font-mono text-sm" rows={12} value={content} onChange={(e) => setContent(e.target.value)}
            placeholder={t("imp_paste_placeholder")} />
        </Field>
      )}
      {kind === "folder" && (
        <Field label={t("imp_folder")} hint={t("imp_folder_hint")}>
          <input className="input font-mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder={t("imp_folder_placeholder")} />
        </Field>
      )}
      {kind === "zip" && (
        <Field label={t("imp_zip")} hint={t("imp_zip_hint")}>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={fileId} className="btn btn-sm cursor-pointer">{t("imp_choose_file")}</label>
            <input id={fileId} type="file" accept=".zip,application/zip" className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file && <span className="text-sm text-ink-2 break-all">{t("imp_file_chosen", { name: file.name, kb: Math.ceil(file.size / 1024) })}</span>}
          </div>
        </Field>
      )}
      <Field label={t("imp_id_optional")}>
        <input className="input font-mono" value={id} onChange={(e) => setId(e.target.value)} />
      </Field>
      {error && <ErrorRow error={error} />}
      {done && <Note tone="ok">{done}</Note>}
      <div className="flex justify-end gap-2 flex-wrap">
        <Button variant="ghost" onClick={onClose}>{done ? t("close") : t("cancel")}</Button>
        <Button variant="primary" type="submit" disabled={busy} icon={busy ? <Spinner size={14} /> : undefined}>{busy ? t("importing") : t("imp_run")}</Button>
      </div>
    </form>
  );
}
