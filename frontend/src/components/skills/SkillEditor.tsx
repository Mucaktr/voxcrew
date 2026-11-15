// Ekip S14: VoxCrew skill düzenleyicisi — frontmatter alanları + SKILL.md gövdesi (yaz / önizle).
import { useMemo, useState } from "react";
import { useT } from "../../lib/i18n";
import { approxTokens, SKILL_ID_RE, skillsApi, slugifySkill, useSkills, type SkillDetail, type SkillDraft, type SkillEntry } from "../../lib/skills";
import { skillsMsg as m } from "../../locales/skills";
import { Markdown } from "../Markdown";
import { Button, Field, Modal, Segmented, Spinner } from "../ui";
import { ErrorRow } from "./common";

export function SkillEditor({ open, skill, onClose, onSaved }:
  { open: boolean; skill?: SkillDetail | null; onClose: () => void; onSaved: (e: SkillEntry) => void }) {
  return (
    <Modal open={open} onClose={onClose} title={skill ? <EditTitle /> : <NewTitle />} width={820}>
      {open && <EditorForm key={skill?.id ?? "new"} skill={skill ?? null} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function NewTitle() { const t = useT(m); return <>{t("editor_new_title")}</>; }
function EditTitle() { const t = useT(m); return <>{t("editor_edit_title")}</>; }

function EditorForm({ skill, onClose, onSaved }: { skill: SkillDetail | null; onClose: () => void; onSaved: (e: SkillEntry) => void }) {
  const t = useT(m);
  const permissions = useSkills((s) => s.sources?.permissions) ?? ["files:read", "files:write", "shell", "network", "browser", "mcp"];
  const [id, setId] = useState(skill?.key ?? "");
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [tags, setTags] = useState((skill?.tags ?? []).join(", "));
  const [version, setVersion] = useState(skill?.version ?? "");
  const [author, setAuthor] = useState(skill?.author ?? "");
  const [license, setLicense] = useState(skill?.license ?? "");
  const [category, setCategory] = useState(skill?.category ?? "");
  const [perms, setPerms] = useState<string[]>(skill?.permissions ?? []);
  const [body, setBody] = useState(skill?.body ?? "");
  const [view, setView] = useState<"write" | "preview">("write");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const effectiveId = id.trim() || slugifySkill(name);
  const idOk = !effectiveId || SKILL_ID_RE.test(effectiveId);
  const canSave = !!name.trim() && idOk && !busy;
  const stats = useMemo(() => ({ n: body.length, t: approxTokens(body.length) }), [body]);

  const save = async () => {
    if (!name.trim()) { setError(t("name_required")); return; }
    if (!idOk) { setError(t("id_invalid")); return; }
    setBusy(true);
    setError(null);
    const draft: SkillDraft = {
      name: name.trim(), description: description.trim(), body, category: category.trim() || null,
      tags: tags.split(",").map((x) => x.trim()).filter(Boolean), version: version.trim() || null,
      author: author.trim() || null, license: license.trim() || null, permissions: perms,
    };
    try {
      const saved = skill ? await skillsApi.update(skill.id, draft) : await skillsApi.create({ ...draft, id: effectiveId || undefined });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t("f_name")}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        <Field label={t("f_id")} hint={skill ? undefined : t("f_id_hint")}>
          <input className="input font-mono" value={skill ? skill.key : id} disabled={!!skill} placeholder={slugifySkill(name)}
            aria-invalid={!idOk || undefined} onChange={(e) => setId(e.target.value)} />
        </Field>
      </div>
      <Field label={t("f_description")} hint={t("f_description_hint")}>
        <textarea className="textarea" rows={2} maxLength={1024} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label={t("f_tags")}><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
        <Field label={t("f_version")}><input className="input font-mono" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" /></Field>
        <Field label={t("f_author")}><input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} /></Field>
        <Field label={t("f_license")}><input className="input" value={license} onChange={(e) => setLicense(e.target.value)} placeholder="MIT" /></Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t("f_category")}><input className="input" value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
        <Field label={t("f_permissions")} hint={t("f_permissions_hint")}>
          <div className="flex flex-wrap gap-1.5">
            {permissions.map((p) => {
              const on = perms.includes(p);
              return (
                <button key={p} type="button" aria-pressed={on} className={`chip ${on ? "tone-ok" : ""} cursor-pointer`}
                  onClick={() => setPerms((cur) => (on ? cur.filter((x) => x !== p) : [...cur, p]))}>
                  <span className="font-mono">{p}</span>
                </button>
              );
            })}
          </div>
        </Field>
      </div>
      <Field label={<span className="flex items-center justify-between gap-2 flex-wrap"><span>{t("f_body")}</span>
        <Segmented value={view} onChange={setView} options={[{ value: "write", label: t("write") }, { value: "preview", label: t("preview") }]} /></span>}
        hint={t("body_stats", { n: stats.n, t: stats.t })}>
        {view === "write" ? (
          <textarea className="textarea font-mono text-sm" rows={14} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("f_body_placeholder")} />
        ) : (
          <div className="panel-soft p-4 max-h-[50vh] overflow-y-auto"><Markdown text={body || t("body_empty")} /></div>
        )}
      </Field>
      {error && <ErrorRow error={error} />}
      <div className="flex justify-end gap-2 flex-wrap">
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button variant="primary" type="submit" disabled={!canSave} disabledReason={busy ? null : !name.trim() ? t("name_required") : !idOk ? t("id_invalid") : null} icon={busy ? <Spinner size={14} /> : undefined}>
          {busy ? t("saving") : skill ? t("save") : t("create")}
        </Button>
      </div>
    </form>
  );
}
