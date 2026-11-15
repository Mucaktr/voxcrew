// Ekip S14: skill ayrıntı çekmecesi (/skiller/:id) — önizleme, ham, dosyalar, bilgiler, paket; düzenle / kopyala / sil / ata.
import { BookOpen, Copy, FileCode2, FileText, Pencil, Trash2, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fmtDate, fmtNumber, useT } from "../../lib/i18n";
import { skillsApi, useSkills, type SkillDetail, type SkillEntry } from "../../lib/skills";
import { useStudio } from "../../lib/store";
import { skillsMsg as m } from "../../locales/skills";
import { Markdown } from "../Markdown";
import { Badge, Button, Drawer, Modal, Segmented, Spinner } from "../ui";
import { AssignDialog } from "./AssignDialog";
import { ErrorRow, HowBadge, LoadingRow, Note, ReadonlyBadge, SourceBadge, TokensBadge } from "./common";
import { SkillEditor } from "./SkillEditor";

type View = "preview" | "raw" | "files" | "meta" | "package";

/** Basit veri yükleme kancası (deps değişince yeniden yükler; geç gelen eski yanıt yok sayılır). */
function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    run().then((d) => { if (id === seq.current) setData(d); })
      .catch((e) => { if (id === seq.current) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (id === seq.current) setLoading(false); });
  }, [run]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}

export function SkillDrawer({ id, onClose, onNavigate }: { id: string | null; onClose: () => void; onNavigate: (id: string) => void }) {
  return (
    <Drawer open={!!id} onClose={onClose} width={760}>
      {id && <SkillPanel key={id} id={id} onClose={onClose} onNavigate={onNavigate} />}
    </Drawer>
  );
}

function SkillPanel({ id, onClose, onNavigate }: { id: string; onClose: () => void; onNavigate: (id: string) => void }) {
  const t = useT(m);
  const { data, error, loading, reload } = useLoad(() => skillsApi.get(id), [id]);
  const [view, setView] = useState<View>("preview");
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<"copy" | "delete" | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const selectAgent = useStudio((s) => s.selectAgent);
  const upsert = useSkills((s) => s.upsert);
  const drop = useSkills((s) => s.drop);
  const refresh = useSkills((s) => s.refresh);

  const copy = async () => {
    if (!data) return;
    setBusy("copy");
    setMsg(null);
    try {
      const e = await skillsApi.copy(data.id);
      upsert(e);
      setMsg({ tone: "ok", text: t("copied", { name: e.name }) });
      onNavigate(e.id);
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!data) return;
    setBusy("delete");
    try {
      await skillsApi.remove(data.id);
      drop(data.id);
      setConfirmDelete(false);
      void refresh();
      void useStudio.getState().refreshAgents();
      onClose();
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof Error ? err.message : String(err) });
      setConfirmDelete(false);
    } finally {
      setBusy(null);
    }
  };
  const saved = (e: SkillEntry) => { upsert(e); setEditing(false); reload(); void refresh(); };

  if (error) {
    return (
      <div className="p-5 flex flex-col gap-3">
        <div className="flex items-start gap-2"><h2 className="t-h3 flex-1">{t("not_found_title")}</h2>
          <Button variant="ghost" size="sm" icon={<X size={18} />} onClick={onClose} aria-label={t("close")} /></div>
        <p className="text-sm text-muted break-words">{t("not_found_text", { id })}</p>
        <ErrorRow error={error} onRetry={reload} />
      </div>
    );
  }
  if (loading && !data) return <LoadingRow label={t("loading")} />;
  if (!data) return null;
  const s = data;
  return (
    <>
      <header className="flex items-start gap-3 px-5 pt-5 pb-3 border-b-2 border-line-soft">
        <span className="h-10 w-10 rounded-lg grid place-items-center bg-amethyst text-white border-2 border-line shrink-0" aria-hidden><BookOpen size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-mono text-lg font-semibold break-all">{s.name}</h2>
          <p className="text-sm text-ink-2 mt-0.5 break-words">{s.description || t("lib_no_desc")}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <SourceBadge source={s.source} />
            <ReadonlyBadge readonly={s.readonly} />
            {s.version && <Badge>v{s.version}</Badge>}
            <TokensBadge chars={s.size_chars} />
            {s.has_scripts && <Badge tone="warn"><FileCode2 size={12} aria-hidden />{t("scripts_badge")}</Badge>}
            {!s.loadable && <Badge tone="bad">{t("unavailable")}</Badge>}
          </div>
        </div>
        <Button variant="ghost" size="sm" icon={<X size={18} />} onClick={onClose} aria-label={t("close")} />
      </header>

      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
        {s.reason && <Note tone="warn">{t("reason_prefix", { reason: s.reason })}</Note>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" icon={<UserPlus size={14} />} onClick={() => setAssigning(true)}>{t("assign_to_agents")}</Button>
          {s.readonly ? (
            <Button size="sm" icon={busy === "copy" ? <Spinner size={14} /> : <Copy size={14} />} disabled={!!busy} onClick={() => void copy()} title={t("copy_hint")}>
              {busy === "copy" ? t("copying") : t("copy_to_voxcrew")}
            </Button>
          ) : (
            <>
              <Button size="sm" icon={<Pencil size={14} />} onClick={() => setEditing(true)}>{t("edit")}</Button>
              <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => setConfirmDelete(true)}>{t("delete")}</Button>
            </>
          )}
        </div>
        {msg && <Note tone={msg.tone}>{msg.text}</Note>}
        <p className="text-xs text-muted">{s.source === "hermes" ? t("how_hermes_long") : t("how_prompt_long")}</p>

        <section className="flex flex-col gap-2">
          <h3 className="panel-title">{t("used_by")}</h3>
          {s.agents.length === 0 ? <p className="text-sm text-muted">{t("no_users")}</p> : (
            <ul className="flex flex-wrap gap-1.5">
              {s.agents.map((a) => (
                <li key={a.slug}>
                  <button type="button" className="chip hover:border-ink-2" onClick={() => { onClose(); selectAgent(a.slug); }} title={t("open_agent", { name: a.name })}>
                    <span className="h-2.5 w-2.5 rounded-full border border-line" style={{ background: a.color ?? "var(--muted)" }} aria-hidden />
                    {a.name}
                    <HowBadge how={a.how} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="panel-title flex-1">SKILL.md</h3>
            <Segmented value={view} onChange={setView} className="flex-wrap" options={[
              { value: "preview", label: t("tab_preview") }, { value: "raw", label: t("tab_raw") },
              { value: "files", label: `${t("tab_files")} (${s.files.length})` }, { value: "meta", label: t("tab_meta") },
              { value: "package", label: t("tab_package") },
            ]} />
          </div>
          {view === "preview" && (
            <div className="panel-soft p-4">
              <Markdown text={s.body || t("body_empty")} />
              {s.truncated && <p className="text-xs text-muted mt-2">{t("truncated_note")}</p>}
            </div>
          )}
          {view === "raw" && <pre className="panel-soft p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words max-h-[60vh] overflow-auto">{s.content}</pre>}
          {view === "files" && (
            s.files.length ? (
              <div className="flex flex-col gap-2">
                <ul className="panel-soft p-2 flex flex-col gap-0.5 font-mono text-xs">
                  <li className="flex items-center gap-2 px-2 py-1"><FileText size={13} className="text-accent" aria-hidden />SKILL.md</li>
                  {s.files.map((f) => <li key={f} className="flex items-center gap-2 px-2 py-1 break-all"><FileCode2 size={13} className="text-muted shrink-0" aria-hidden />{f}</li>)}
                </ul>
                {s.scripts.length > 0 && <Note tone="warn">{t("scripts_note")}</Note>}
              </div>
            ) : <p className="text-sm text-muted">{t("only_skill_md")}</p>
          )}
          {view === "meta" && <MetaTable s={s} />}
          {view === "package" && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted">{t("package_hint", { format: s.manifest.format })}</p>
              <pre className="panel-soft p-3 font-mono text-xs whitespace-pre-wrap break-words">{JSON.stringify(s.manifest, null, 2)}</pre>
            </div>
          )}
        </section>
      </div>

      <SkillEditor open={editing} skill={s} onClose={() => setEditing(false)} onSaved={saved} />
      <AssignDialog open={assigning} onClose={() => setAssigning(false)} initialSkills={[s.id]} onDone={() => { reload(); void refresh(); }} />
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t("delete_title")} width={520}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>{t("cancel")}</Button>
          <Button variant="danger" disabled={busy === "delete"} onClick={() => void remove()} icon={busy === "delete" ? <Spinner size={14} /> : <Trash2 size={14} />}>
            {busy === "delete" ? t("working") : t("delete")}
          </Button>
        </>}>
        <p className="text-sm text-ink-2 leading-relaxed">{t("delete_text", { name: s.name })}</p>
      </Modal>
    </>
  );
}

function MetaTable({ s }: { s: SkillDetail }) {
  const t = useT(m);
  const rows: [string, string][] = [
    [t("meta_key"), s.key], [t("meta_id"), s.id], [t("meta_source"), s.source], [t("meta_path"), s.path ?? t("dash")],
    [t("meta_version"), s.version ?? t("dash")], [t("meta_author"), s.author ?? t("dash")], [t("meta_license"), s.license ?? t("dash")],
    [t("meta_category"), s.category ?? t("dash")], [t("meta_tags"), s.tags.join(", ") || t("dash")],
    [t("meta_permissions"), s.permissions.join(", ") || t("dash")],
    [t("meta_size"), t("meta_chars", { n: fmtNumber(s.size_chars) })],
    [t("meta_updated"), s.updated_at ? fmtDate(s.updated_at, { dateStyle: "medium", timeStyle: "short" }) : t("dash")],
  ];
  if (s.profiles?.length) rows.push([t("meta_profiles"), s.profiles.join(", ")]);
  if (s.scope) rows.push([t("meta_scope"), t(s.scope === "project" ? "scope_project" : "scope_user")]);
  return (
    <div className="flex flex-col gap-3">
      <dl className="panel-soft divide-y-2 divide-line-soft text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-1 sm:grid-cols-[11rem_1fr] gap-x-3 gap-y-0.5 px-3 py-2">
            <dt className="text-muted">{k}</dt>
            <dd className="font-mono text-xs break-all self-center">{v}</dd>
          </div>
        ))}
      </dl>
      <details className="panel-soft p-3 text-xs">
        <summary className="cursor-pointer text-sm font-semibold">{t("raw_frontmatter")}</summary>
        <pre className="font-mono mt-2 whitespace-pre-wrap break-words">{JSON.stringify(s.frontmatter, null, 2)}</pre>
      </details>
    </div>
  );
}
