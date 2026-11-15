// Ekip S10 — tek hedef oluşturma / düzenleme (başlık, açıklama, düzey ve sahip, üst hedef, öncelik, son tarih, KR'ler).
import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  flattenGoals, GOAL_STATUS_META, GOAL_STATUSES, goalsApi, LEVEL_META, LEVELS, PRIORITIES, PRIORITY_META,
  type Goal, type GoalLevel, type GoalPriority, type GoalStatus, type KeyResultInput,
} from "../../lib/goals";
import { useT } from "../../lib/i18n";
import { keyOf, toNamespace, useNamespaces } from "../../lib/memory";
import { goalsMsg as m } from "../../locales/goals";
import { memoryMsg } from "../../locales/memory";
import { Button, Field, Modal, Segmented } from "../ui";
import type { OwnerLookup } from "./GoalBadges";
import { knownProjectKeys, ProjectField } from "./ProjectField";

interface KrDraft { id?: string; title: string; target: string; unit: string; current?: number; done?: boolean }

export function GoalFormDialog({ open, onClose, onSaved, goal, parent, goals, lookup }:
  { open: boolean; onClose: () => void; onSaved: (g: Goal) => void; goal?: Goal | null; parent?: Goal | null;
    goals: Goal[]; lookup: OwnerLookup }) {
  const t = useT(m);
  const tm = useT(memoryMsg);
  const editing = !!goal;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState<GoalLevel>("company");
  const [ownerTeam, setOwnerTeam] = useState("");
  const [ownerAgent, setOwnerAgent] = useState("");
  const [parentId, setParentId] = useState("");
  const [priority, setPriority] = useState<GoalPriority>("medium");
  const [due, setDue] = useState("");
  const [status, setStatus] = useState<GoalStatus>("active");
  const [progress, setProgress] = useState("0");
  const [krs, setKrs] = useState<KrDraft[]>([]);
  // hedefin bellek ad alanı (proje anahtarı; "" = genel). Alt hedef üst hedefin projesini önerir.
  const [project, setProject] = useState("");
  const { list: namespaces } = useNamespaces(open);
  const known = useMemo(() => knownProjectKeys(namespaces), [namespaces]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const src = goal ?? null;
    setTitle(src?.title ?? "");
    setDescription(src?.description ?? "");
    // alt hedef: üst hedefin düzeyini ve sahibini önerir
    const base = src ?? parent ?? null;
    setLevel(base?.level ?? "company");
    setOwnerTeam(base?.owner_team ?? "");
    setOwnerAgent(base?.owner_agent ?? "");
    setParentId(src ? src.parent ?? "" : parent?.id ?? "");
    setPriority(src?.priority ?? "medium");
    setDue(src?.due ?? "");
    setStatus(src?.status ?? "active");
    setProgress(String(Math.round((src?.progress ?? 0) * 100)));
    setKrs((src?.key_results ?? []).map((k) => ({ id: k.id, title: k.title, target: k.target == null ? "" : String(k.target),
      unit: k.unit ?? "", current: k.current, done: k.done })));
    setProject(keyOf((base as (Goal & { project?: string | null }) | null)?.project) ?? "");
    setError(null);
  }, [open, goal, parent]);

  const visibleAgents = useMemo(() => lookup.agents.filter((a) => !a.hidden || a.slug === ownerAgent), [lookup.agents, ownerAgent]);
  const blocked = useMemo(() => {
    // düzenlemede hedef kendisinin ya da alt ağacının altına taşınamaz
    const out = new Set<string>();
    if (!goal) return out;
    const all = flattenGoals(goals);
    out.add(goal.id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const { goal: g } of all) if (g.parent && out.has(g.parent) && !out.has(g.id)) { out.add(g.id); changed = true; }
    }
    return out;
  }, [goal, goals]);
  const parentOptions = useMemo(() => flattenGoals(goals).filter(({ goal: g }) => !blocked.has(g.id)), [goals, blocked]);
  const hasChildren = !!goal?.children?.length || flattenGoals(goals).some(({ goal: g }) => goal && g.parent === goal.id);
  const manualProgress = editing && !krs.length && !hasChildren;

  const save = async () => {
    if (!title.trim()) { setError(t("err_title_required")); return; }
    if (level === "team" && !ownerTeam) { setError(t("err_team_required")); return; }
    if (level === "agent" && !ownerAgent) { setError(t("err_agent_required")); return; }
    const keyResults: KeyResultInput[] = [];
    for (const [i, k] of krs.entries()) {
      if (!k.title.trim()) { setError(t("err_kr_title", { n: i + 1 })); return; }
      const target = k.target.trim() ? Number(k.target.replace(",", ".")) : null;
      if (target !== null && (!Number.isFinite(target) || target <= 0)) { setError(t("err_kr_target_num", { n: i + 1 })); return; }
      keyResults.push({ id: k.id, title: k.title.trim(), target, unit: k.unit.trim() || null, current: k.current ?? 0,
        done: target === null ? !!k.done : undefined });
    }
    const ns = toNamespace(project, known);
    if (!ns) { setError(tm("project_invalid")); return; }
    // boş sahip: düzenlemede null (temizle), oluştururken gönderilmez; ajan düzeyinde ekip ajanın ekibinden türetilir
    const clear = editing ? null : undefined;
    const data = {
      title: title.trim(), description: description.trim() || null, level,
      owner_team: level === "team" ? ownerTeam : clear,
      owner_agent: level === "agent" ? ownerAgent : clear,
      parent: parentId || null, priority, due: due || null, key_results: keyResults,
      ...(editing ? { status } : {}),
      ...(manualProgress ? { progress: Math.max(0, Math.min(100, Number(progress) || 0)) / 100 } : {}),
      // proje: düzenlemede "" (genel) da gönderilir ki temizlenebilsin; oluştururken yalnızca doluysa
      ...(ns !== "global" ? { project: ns } : editing ? { project: "" } : {}),
    };
    setBusy(true);
    setError(null);
    try {
      const saved = goal ? await goalsApi.update(goal.id, data) : await goalsApi.create(data);
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setKr = (i: number, patch: Partial<KrDraft>) => setKrs((list) => list.map((k, j) => (j === i ? { ...k, ...patch } : k)));

  return (
    <Modal open={open} onClose={onClose} width={640}
      title={editing ? t("edit_goal") : parent ? t("add_child_title") : t("new_goal")}
      footer={<>
        {!busy && !title.trim() && <span className="mr-auto text-xs text-ink-2 font-semibold self-center" role="status">{t("need_title")}</span>}
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button variant="primary" icon={<Save size={16} />} disabled={busy || !title.trim()} disabledReason={t("need_title")} onClick={save}>
          {editing ? t("save") : t("create_goal")}
        </Button>
      </>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {parent && !editing && <p className="text-sm text-ink-2">{t("parent_goal")}<strong>{parent.title}</strong></p>}
        <Field label={t("title")}>
          <input className="input" value={title} maxLength={200} autoFocus placeholder={t("title_placeholder")}
            onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t("description")} hint={t("description_hint")}>
          <textarea className="textarea" rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-3 items-end">
          <Field label={t("level")}>
            <Segmented value={level} onChange={setLevel} options={LEVELS.map((l) => ({ value: l, label: LEVEL_META[l].label }))} />
          </Field>
          {level === "team" && (
            <Field label={t("owner_team")} className="flex-1 basis-40 min-w-0">
              <select className="select" value={ownerTeam} onChange={(e) => setOwnerTeam(e.target.value)} aria-invalid={!ownerTeam}>
                <option value="">{t("pick_team")}</option>
                {lookup.teams.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
              </select>
            </Field>
          )}
          {level === "agent" && (
            <Field label={t("owner_agent")} hint={t("owner_agent_hint")} className="flex-1 basis-40 min-w-0">
              <select className="select" value={ownerAgent} onChange={(e) => setOwnerAgent(e.target.value)} aria-invalid={!ownerAgent}>
                <option value="">{t("pick_agent")}</option>
                {visibleAgents.map((a) => <option key={a.slug} value={a.slug}>{a.name}{a.title ? ` — ${a.title}` : ""}</option>)}
              </select>
            </Field>
          )}
        </div>
        <Field label={t("parent")}>
          <select className="select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{t("parent_none")}</option>
            {parentOptions.map(({ goal: g, depth }) => <option key={g.id} value={g.id}>{`${"— ".repeat(depth)}${g.title}`}</option>)}
          </select>
        </Field>
        <div className="flex flex-wrap gap-3 items-end">
          <Field label={t("priority")}>
            <Segmented value={priority} onChange={setPriority} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label }))} />
          </Field>
          <Field label={t("due")} className="basis-40">
            <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          {editing && (
            <Field label={t("status")} className="basis-40">
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value as GoalStatus)}>
                {GOAL_STATUSES.map((s) => <option key={s} value={s}>{GOAL_STATUS_META[s].label}</option>)}
              </select>
            </Field>
          )}
        </div>
        <ProjectField value={project} onChange={setProject} namespaces={namespaces} hint={tm("goal_project_hint")} />
        {manualProgress && (
          <Field label={t("progress_pct")} hint={t("progress_hint")}>
            <input className="input max-w-32" type="number" min={0} max={100} step={5} value={progress}
              onChange={(e) => setProgress(e.target.value)} />
          </Field>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="label mb-1.5">{t("key_results")}</legend>
          {krs.length === 0 && <p className="text-xs text-muted">{t("krs_hint")}</p>}
          {krs.map((k, i) => (
            <div key={i} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <input className="input flex-1 basis-full sm:basis-auto min-w-0" value={k.title} maxLength={200}
                placeholder={t("kr_title_placeholder")} aria-label={t("kr_title_label", { n: i + 1 })}
                onChange={(e) => setKr(i, { title: e.target.value })} />
              <input className="input w-24 shrink-0" inputMode="decimal" value={k.target} placeholder={t("kr_target")}
                aria-label={t("kr_target_label", { n: i + 1 })} onChange={(e) => setKr(i, { target: e.target.value })} />
              <input className="input w-24 shrink-0" value={k.unit} maxLength={30} placeholder={t("kr_unit")}
                aria-label={t("kr_unit_label", { n: i + 1 })} onChange={(e) => setKr(i, { unit: e.target.value })} />
              <Button variant="ghost" size="sm" icon={<Trash2 size={15} />} aria-label={t("kr_remove", { n: i + 1 })}
                onClick={() => setKrs((list) => list.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div>
            <Button size="sm" icon={<Plus size={14} />} disabled={krs.length >= 20}
              onClick={() => setKrs((list) => [...list, { title: "", target: "", unit: "" }])}>{t("add_kr")}</Button>
          </div>
        </fieldset>
        {error && <p className="text-sm font-semibold text-bad" role="alert">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
