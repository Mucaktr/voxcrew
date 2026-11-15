/**
 * Dünya yapıcı (Faz 7a, S30) — `/dunya-yapici` (dünya listesi) ve `/dunya-yapici/:id` (editör).
 * Liste: kullanıcı dünyaları (düzenle, etkin sahne yap, kopyala, dışa aktar, sil), yerleşik 11 dünya ("Kopyasını
 * düzenle" → sunucuda kullanıcı kopyası), boş dünya, sürükle-bırak içe aktarma. Editör: palet | üstten ızgara / 3B
 * önizleme | ayrıntılar + doğrulama; geri al/yinele, güvenli taslak, doğrulamalı kaydet.
 * Bkz.
*/
import clsx from "clsx";
import { ArrowLeft, Copy, Download, Eraser, FilePlus2, Globe2, Hammer, Lock, MousePointer2, Paintbrush, Pencil, Play, Redo2, Save, Trash2, Undo2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { GridEditor } from "../components/builder/GridEditor";
import { Inspector } from "../components/builder/Inspector";
import { IssuesPanel, type ShownIssue } from "../components/builder/IssuesPanel";
import { Palette } from "../components/builder/Palette";
import { Preview3D } from "../components/builder/Preview3D";
import { Badge, Button, Empty, Modal, PageHeader, Panel, Segmented, Spinner, Toggle } from "../components/ui";
import {
  blankWorld, builtinRootOf, dropDraft, ensureWorld, isBuiltinId, isUserWorldId, PALETTE_CATS, readDraft, registerWorld,
  editableWorldFor, latestCopyOf, useEditor, useWorlds, WorldApiError, worldsApi, writeDraft, type PaletteCat, type WorldSummary,
} from "../lib/builder";
import { ensureGameLoaded, isUnlocked, useGameLocks } from "../lib/game";
import { fmtDate, useT } from "../lib/i18n";
import { useStudio } from "../lib/store";
import type { SceneId } from "../lib/types";
import { builder as M } from "../locales/builder";
import { SCENE_ORDER, SCENES, type WorldSceneId } from "../voxel/scenes";
import { bakeWorld, MAX_BLOCKS, validateWorld, type WorldFile } from "../voxel/worldFormat";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Swatch({ colors }: { colors: [string, string] | null }) {
  const [ground, sky] = colors ?? ["#9CA3AF", "#CBD5E1"];
  return (
    <span aria-hidden className="grid grid-rows-2 h-10 w-10 shrink-0 overflow-hidden rounded-md border-2 border-line">
      <span style={{ background: sky }} /><span style={{ background: ground }} />
    </span>
  );
}

// ------------------------------------------------------------------------------------------ liste
function WorldList() {
  const t = useT(M);
  const navigate = useNavigate();
  const list = useWorlds((s) => s.list);
  const loaded = useWorlds((s) => s.loaded);
  const refresh = useWorlds((s) => s.refresh);
  const scene = useStudio((s) => s.scene);
  const setScene = useStudio((s) => s.setScene);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string; link?: boolean } | null>(null);
  const [confirm, setConfirm] = useState<WorldSummary | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { refresh(); }, [refresh]);
  // kilitli yerleşik sahne kopyalanamaz; kopyası etkin yapılamaz ve çoğaltılamaz (sunucu da reddeder)
  useGameLocks(); // kilit tablosu değişince (satın alma, seviye) yeniden çiz
  const sceneLocked = (id: string) => !isUnlocked(`scene:${id}`);
  const copyLocked = (w: WorldSummary) => { const root = builtinRootOf(list, w); return !!root && sceneLocked(root); };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setNote(null);
    try { await fn(); } catch (e) { setNote({ tone: "bad", text: errText(e) }); } finally { setBusy(null); }
  };
  // Düzenle: senin sürümün varsa onu açar (düzenlemeler kaybolmaz); "Orijinalden yeni kopya" bilerek sıfırdan başlatır
  const editBuiltin = (id: WorldSceneId, fresh = false) => run(`${fresh ? "f" : "b"}:${id}`, async () => {
    const wid = await editableWorldFor(id, (n) => (n <= 1 ? t("copy_name", { name: SCENES[id].label }) : t("copy_name_n", { name: SCENES[id].label, n })), fresh, scene);
    navigate(`/dunya-yapici/${wid}`);
  });
  const newBlank = () => run("blank", async () => {
    const created = await worldsApi.create(blankWorld(t("blank_name")));
    await refresh();
    navigate(`/dunya-yapici/${created.id}`);
  });
  const activate = (w: WorldSummary) => run(`a:${w.id}`, async () => {
    await ensureWorld(w.id);
    await setScene(w.id as SceneId);
    setNote({ tone: "ok", text: t("made_active", { name: w.name }), link: true });
  });
  const importFile = (file: File | undefined) => file && run("import", async () => {
    let doc: unknown;
    try { doc = JSON.parse(await file.text()); } catch { throw new Error(t("import_bad_json")); }
    const created = await worldsApi.importDoc(doc);
    await refresh();
    setNote({ tone: "ok", text: t("imported", { name: created.meta.name }) });
    navigate(`/dunya-yapici/${created.id}`);
  });
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragOver(false); importFile(e.dataTransfer.files[0]); };

  return (
    <div className="p-3 sm:p-5 flex flex-col gap-4 max-w-[1280px] mx-auto"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
      <PageHeader title={t("title")} subtitle={t("subtitle")}
        actions={<>
          <Button icon={<Upload size={16} />} onClick={() => fileRef.current?.click()} disabled={busy === "import"}>{t("import")}</Button>
          <Button variant="primary" icon={busy === "blank" ? <Spinner /> : <FilePlus2 size={16} />} onClick={newBlank} disabled={!!busy}>{t("new_blank")}</Button>
        </>} />
      <input ref={fileRef} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden aria-label={t("import")}
        onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ""; }} />
      {note && (
        <div role={note.tone === "bad" ? "alert" : "status"} className={clsx("chip !rounded-lg !px-3 !py-2 flex flex-wrap items-center gap-2 text-sm", note.tone === "bad" ? "tone-bad" : "tone-ok")}>
          <span>{note.text}</span>
          {note.link && <Link to="/" className="btn btn-sm"><Globe2 size={14} aria-hidden />{t("go_world")}</Link>}
        </div>
      )}
      <button type="button" onClick={() => fileRef.current?.click()}
        className={clsx("rounded-xl border-2 border-dashed p-4 text-sm text-ink-2 text-center transition-colors", dragOver ? "border-primary bg-panel-2" : "border-line-soft")}>
        <Upload size={16} aria-hidden className="inline mr-1.5 -mt-0.5" />{t("import_drop")}
      </button>

      <Panel title={t("mine")} icon={<Hammer size={18} />}>
        {!loaded ? <Spinner /> : !list.length ? (
          <Empty icon={<Hammer size={22} />} title={t("mine_empty")} text={t("mine_empty_text")} />
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {list.map((w) => (
              <li key={w.id} className="panel-soft p-3 flex flex-col gap-2 min-w-0">
                <div className="flex items-center gap-3 min-w-0">
                  <Swatch colors={w.swatch} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink truncate">{w.name}</p>
                    <p className="text-xs text-muted truncate">
                      {t("n_stations", { n: w.stations })} · {t("n_prefabs", { n: w.prefabs })}{w.updated ? ` · ${t("updated", { when: fmtDate(w.updated, { dateStyle: "short", timeStyle: "short" }) })}` : ""}
                    </p>
                  </div>
                  {scene === w.id && <Badge tone="ok">{t("active")}</Badge>}
                </div>
                {copyLocked(w) && (
                  <p className="text-xs text-ink-2 flex items-start gap-1.5"><Lock size={13} className="shrink-0 mt-0.5" aria-hidden />{t("copy_locked_hint")}</p>
                )}
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("actions_for", { name: w.name })}>
                  <Link to={`/dunya-yapici/${w.id}`} className="btn btn-sm btn-primary"><Pencil size={14} aria-hidden />{t("edit")}</Link>
                  <Button size="sm" icon={<Play size={14} />} disabled={!!busy || scene === w.id || copyLocked(w)} onClick={() => activate(w)}>{t("make_active")}</Button>
                  <Button size="sm" icon={<Copy size={14} />} disabled={!!busy || copyLocked(w)} onClick={() => run(`d:${w.id}`, async () => { await worldsApi.duplicate(w.id); await refresh(); })}>{t("duplicate")}</Button>
                  <a href={worldsApi.exportUrl(w.id)} download={`${w.id}.voxcrew-world.json`} className="btn btn-sm"><Download size={14} aria-hidden />{t("export")}</a>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`${t("delete")}: ${w.name}`} disabled={!!busy} onClick={() => setConfirm(w)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t("builtin")} icon={<Globe2 size={18} />}>
        <p className="text-sm text-muted mb-3">{t("builtin_hint")}</p>
        <ul className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {SCENE_ORDER.map((id) => {
            const d = SCENES[id];
            const mine = latestCopyOf(list, id, scene);
            const locked = sceneLocked(id);
            return (
              <li key={id} className="panel-soft p-3 flex flex-col gap-2 min-w-0">
                <div className="flex items-center gap-3 min-w-0">
                  <Swatch colors={d.swatch} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink truncate">{d.label}</p>
                    <p className="text-xs text-muted line-clamp-2">{d.hint}</p>
                  </div>
                  {(scene === id || (mine && scene === mine.id)) && <Badge tone="ok">{t("active")}</Badge>}
                </div>
                {mine && (
                  <p className="text-xs text-ink-2 truncate">
                    {t("your_version", { name: mine.name })}{mine.updated ? ` · ${fmtDate(mine.updated, { dateStyle: "short", timeStyle: "short" })}` : ""}
                  </p>
                )}
                {locked && !mine && (
                  <p className="text-xs text-ink-2 flex items-start gap-1.5"><Lock size={13} className="shrink-0 mt-0.5" aria-hidden />{t("scene_locked_hint")}</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {locked && !mine ? (
                    <Button size="sm" icon={<Lock size={14} />} disabled aria-label={`${t("scene_locked")}: ${d.label}`}>{t("scene_locked")}</Button>
                  ) : (
                  <Button size="sm" variant={mine ? "primary" : "default"} icon={busy === `b:${id}` ? <Spinner size={13} /> : <Pencil size={14} />} disabled={!!busy}
                    onClick={() => editBuiltin(id)} aria-label={`${mine ? t("edit_yours") : t("edit_copy")}: ${d.label}`}>
                    {mine ? t("edit_yours") : t("edit_copy")}
                  </Button>
                  )}
                  {mine && !locked && (
                    <Button size="sm" variant="ghost" icon={busy === `f:${id}` ? <Spinner size={13} /> : <Copy size={14} />} disabled={!!busy}
                      onClick={() => editBuiltin(id, true)} title={t("fresh_copy_hint")}>
                      {t("fresh_copy")}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={t("delete")} width={440}
        footer={<>
          <Button onClick={() => setConfirm(null)}>{t("cancel")}</Button>
          <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => {
            const w = confirm!;
            setConfirm(null);
            run(`x:${w.id}`, async () => { await worldsApi.remove(w.id); dropDraft(w.id); await refresh(); });
          }}>{t("delete")}</Button>
        </>}>
        <p className="text-sm text-ink-2">{confirm ? t("delete_confirm", { name: confirm.name }) : ""}</p>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ editör
function Editor({ id }: { id: string }) {
  const t = useT(M);
  const world = useEditor((s) => s.world);
  const saved = useEditor((s) => s.saved);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const tool = useEditor((s) => s.tool);
  const load = useEditor((s) => s.load);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const setE = useEditor((s) => s.set);
  const markSaved = useEditor((s) => s.markSaved);
  const scene = useStudio((s) => s.scene);
  const setScene = useStudio((s) => s.setScene);
  const refreshList = useWorlds((s) => s.refresh);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ at: number; world: WorldFile } | null>(null);
  const [view, setView] = useState<"top" | "3d">("top");
  const [grid, setGrid] = useState(true);
  const [cat, setCat] = useState<PaletteCat>("floor");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string; link?: boolean } | null>(null);
  const [serverIssues, setServerIssues] = useState<ShownIssue[] | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null); setNote(null); setServerIssues(null);
    worldsApi.get(id).then((doc) => {
      if (!alive) return;
      load(doc);
      const d = readDraft(id);
      if (d && JSON.stringify(d.world) !== JSON.stringify(doc)) setDraft(d);
    }).catch((e) => alive && setError(errText(e)));
    return () => { alive = false; useEditor.getState().load(null as never); };
  }, [id, load]);

  const dirty = !!world && JSON.stringify(world) !== saved;
  // güvenli taslak: yalnızca tarayıcıda, değişiklikten 800 ms sonra
  useEffect(() => {
    if (!world || !dirty) return;
    const h = window.setTimeout(() => writeDraft(world), 800);
    return () => window.clearTimeout(h);
  }, [world, dirty]);

  const built = useMemo(() => (world ? bakeWorld(world) : null), [world]);
  const issues = useMemo(() => (world && built ? validateWorld(world, built) : []), [world, built]);
  const errors = issues.filter((i) => i.level === "error").length;
  const shownIssues: ShownIssue[] = serverIssues ?? issues;
  // taslak değişince sunucu sorunları ve eski hata notu düşer (yerel doğrulama canlıdır)
  useEffect(() => { setServerIssues(null); setNote((n) => (n?.tone === "bad" ? null : n)); }, [world]);

  const save = useCallback(async () => {
    const w = useEditor.getState().world;
    if (!w) return;
    if (errors) { setNote({ tone: "bad", text: t("save_blocked", { n: errors }) }); return; }
    setSaving(true); setNote(null);
    try {
      const out = await worldsApi.save(id, w);
      markSaved(out);
      registerWorld(out); // etkin sahneyse Dünya sayfası yeni hâli çizer
      // Etkin yerleşik dünyanın kopyasını düzenliyorsan ("mevcut dünyayı düzenle"), kayıttan sonra Dünya sayfası bu sürümü gösterir
      const cur = useStudio.getState().scene;
      if (out.meta.basedOn?.id === `scene:${cur}`) {
        await ensureWorld(id);
        await setScene(id as SceneId);
        setNote({ tone: "ok", text: t("saved_now_active", { name: SCENES[cur as WorldSceneId]?.label ?? cur }), link: true });
      } else {
        setNote({ tone: "ok", text: t("saved") });
      }
      refreshList();
    } catch (e) {
      if (e instanceof WorldApiError && e.issues.length) setServerIssues(e.issues);
      setNote({ tone: "bad", text: t("save_failed", { error: errText(e) }) });
    } finally {
      setSaving(false);
    }
  }, [errors, id, markSaved, refreshList, setScene, t]);

  // sayfa kısayolları (alan içindeyken yazmayı bölmez)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.closest("input, textarea, select, [contenteditable=true]"))) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
      if (mod && (e.key === "s" || e.key === "S")) { e.preventDefault(); save(); return; }
      if (mod || e.altKey) return;
      if (e.key === "v" || e.key === "V") setE({ tool: "select" });
      else if (e.key === "b" || e.key === "B") setE({ tool: "draw" });
      else if (e.key === "e" || e.key === "E") setE({ tool: "erase", selected: null });
      else if (/^[1-9]$/.test(e.key)) { setCat(PALETTE_CATS[Number(e.key) - 1]); setE({ tool: "draw" }); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [undo, redo, save, setE]);

  if (error) return <div className="p-5"><Empty title={t("load_failed", { error })} action={<Link className="btn" to="/dunya-yapici">{t("back")}</Link>} /></div>;
  if (!world || !built) return <div className="p-10 grid place-items-center"><Spinner size={24} /></div>;

  const activate = async () => {
    await ensureWorld(id);
    registerWorld(world);
    await setScene(id as SceneId);
    setNote({ tone: "ok", text: t("made_active", { name: world.meta.name }), link: true });
  };

  return (
    <div className="p-3 sm:p-5 flex flex-col gap-4 max-w-[1680px] mx-auto">
      <PageHeader eyebrow={<Link to="/dunya-yapici" className="inline-flex items-center gap-1 hover:underline"><ArrowLeft size={14} aria-hidden />{t("back")}</Link>}
        title={world.meta.name || t("title")}
        meta={<>
          {dirty ? <Badge tone="warn">{t("unsaved")}</Badge> : <Badge tone="ok">{t("saved")}</Badge>}
          {scene === id && <Badge tone="info">{t("active")}</Badge>}
          <span className="text-xs text-muted">{t("stats", { blocks: built.blocks.length, max: MAX_BLOCKS, prefabs: world.layers.prefabs.length, stations: world.nav.stations.length })}</span>
        </>}
        actions={<>
          <Button size="sm" icon={<Undo2 size={15} />} onClick={undo} disabled={!past} aria-label={t("undo")} title={`${t("undo")} (Ctrl+Z)`} />
          <Button size="sm" icon={<Redo2 size={15} />} onClick={redo} disabled={!future} aria-label={t("redo")} title={`${t("redo")} (Ctrl+Y)`} />
          {dirty
            ? <Button size="sm" icon={<Download size={14} />} disabled title={t("need_save")}>{t("export")}</Button>
            : <a href={worldsApi.exportUrl(id)} download={`${id}.voxcrew-world.json`} className="btn btn-sm"><Download size={14} aria-hidden />{t("export")}</a>}
          <Button size="sm" icon={<Play size={14} />} onClick={activate} disabled={dirty || scene === id || errors > 0} title={dirty ? t("need_save") : undefined}>{t("make_active")}</Button>
          <Button variant="primary" icon={saving ? <Spinner /> : <Save size={16} />} onClick={save} disabled={saving || !dirty}>{saving ? t("saving") : t("save")}</Button>
        </>} />

      {draft && (
        <div role="status" className="chip tone-info !rounded-lg !px-3 !py-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="flex-1 min-w-[12rem]">{t("draft_found", { when: fmtDate(draft.at, { dateStyle: "short", timeStyle: "short" }) })}</span>
          <Button size="sm" onClick={() => { useEditor.getState().apply(() => draft.world); setDraft(null); }}>{t("draft_restore")}</Button>
          <Button size="sm" variant="ghost" onClick={() => { dropDraft(id); setDraft(null); }}>{t("draft_discard")}</Button>
        </div>
      )}
      {note && (
        <div role={note.tone === "bad" ? "alert" : "status"} className={clsx("chip !rounded-lg !px-3 !py-2 flex flex-wrap items-center gap-2 text-sm", note.tone === "bad" ? "tone-bad" : "tone-ok")}>
          <span>{note.text}</span>
          {note.link && <Link to="/" className="btn btn-sm"><Globe2 size={14} aria-hidden />{t("go_world")}</Link>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[240px_minmax(0,1fr)_320px] items-start">
        <Panel title={t("palette")} className="order-2 lg:order-1" bodyClass="lg:max-h-[72vh] lg:overflow-y-auto">
          <Palette cat={cat} onCat={(c) => { setCat(c); }} />
        </Panel>

        <section className="panel p-3 flex flex-col gap-3 min-w-0 order-1 lg:order-2" aria-label={t("tools")}>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={tool} onChange={(v) => setE({ tool: v, ...(v === "erase" ? { selected: null } : {}) })} options={[
              { value: "select", label: <span className="inline-flex items-center gap-1"><MousePointer2 size={14} aria-hidden /><span className="sr-only sm:not-sr-only">{t("tool_select")}</span></span>, title: "V" },
              { value: "draw", label: <span className="inline-flex items-center gap-1"><Paintbrush size={14} aria-hidden /><span className="sr-only sm:not-sr-only">{t("tool_draw")}</span></span>, title: "B" },
              { value: "erase", label: <span className="inline-flex items-center gap-1"><Eraser size={14} aria-hidden /><span className="sr-only sm:not-sr-only">{t("tool_erase")}</span></span>, title: "E" },
            ]} />
            <Segmented value={view} onChange={setView} className="ml-auto" options={[
              { value: "top", label: t("view_top") }, { value: "3d", label: t("view_3d") },
            ]} />
          </div>
          {view === "top" ? <GridEditor world={world} issues={shownIssues} showGrid={grid} label={world.meta.name} /> : <Preview3D world={world} />}
          <div className="flex flex-wrap items-center gap-3 justify-between">
            {view === "top" && <Toggle checked={grid} onChange={setGrid} label={t("grid_lines")} />}
            <p className="text-xs text-muted">{t("keys_help")}</p>
          </div>
          <p className="text-xs text-muted">{t("draft_note")}</p>
        </section>

        <div className="grid gap-4 order-3 min-w-0 lg:col-span-2 lg:grid-cols-2 2xl:col-span-1 2xl:grid-cols-1">
          <Panel title={t("issues")}><IssuesPanel issues={shownIssues} world={world} /></Panel>
          <Panel title={t("inspector")}><Inspector world={world} /></Panel>
        </div>
      </div>
    </div>
  );
}

const copying = new Map<string, Promise<string>>();

/** Yerleşik bir dünyaya doğrudan gelindiyse: salt okunur → senin sürümünü (yoksa yeni kopyasını) editörde aç. */
function BuiltinRedirect({ id }: { id: WorldSceneId }) {
  const t = useT(M);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // StrictMode etkiyi iki kez çalıştırır: aynı kopya bir kez oluşturulsun
    let job = copying.get(id);
    if (!job) {
      // kilitli yerleşik sahnenin kopyası açılmaz (oyun profili yüklenince denetlenir; sunucu da reddeder)
      job = ensureGameLoaded().catch(() => undefined).then(() => {
        if (!isUnlocked(`scene:${id}`)) throw new Error(t("scene_locked_hint"));
        return editableWorldFor(id, (n) => (n <= 1 ? t("copy_name", { name: SCENES[id].label }) : t("copy_name_n", { name: SCENES[id].label, n })), false, useStudio.getState().scene);
      });
      copying.set(id, job);
      job.finally(() => window.setTimeout(() => copying.delete(id), 2000));
    }
    job.then((wid) => {
      if (alive) navigate(`/dunya-yapici/${wid}`, { replace: true });
    }).catch((e) => alive && setError(errText(e)));
    return () => { alive = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="p-10 grid place-items-center">{error ? <Empty title={t("load_failed", { error })} /> : <Spinner size={24} />}</div>;
}

export default function WorldBuilderPage() {
  const { id } = useParams();
  if (isUserWorldId(id)) return <Editor key={id} id={id} />;
  if (isBuiltinId(id)) return <BuiltinRedirect id={id} />;
  return <WorldList />;
}
