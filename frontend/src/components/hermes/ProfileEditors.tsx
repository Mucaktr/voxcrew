// Ekip S1: SOUL.md ve MEMORY.md/USER.md düzenleyicileri. Kaydet → plan (diff) → ChangeReviewModal → onaylı uygula.
import { Eye, Feather, Plus, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChangeEntry } from "../../lib/changes";
import { hermesApi, joinMemory, type MemoryInfo, type SoulInfo, type SoulPlan, type MemoryPlan } from "../../lib/hermes";
import { tp, useT } from "../../lib/i18n";
import { hermesMsg as m } from "../../locales/hermes";
import { ChangeReviewModal } from "../ChangeReviewModal";
import { Button, Modal, Segmented, Spinner } from "../ui";
import { CharMeter, ErrorBox, LoadingBlock, Note, Rich } from "./common";

// ====================================================================== SOUL.md
export function SoulEditor({ profile, open, onClose, onApplied }:
  { profile: string; open: boolean; onClose: () => void; onApplied?: (e: ChangeEntry) => void }) {
  const t = useT(m);
  const [soul, setSoul] = useState<SoulInfo | null>(null);
  const [text, setText] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<SoulPlan | null>(null);

  const load = () => {
    setLoadError(null);
    setSoul(null);
    hermesApi.soul(profile).then((s) => { setSoul(s); setText(s.content); }).catch((e) => setLoadError(String(e instanceof Error ? e.message : e)));
  };
  useEffect(() => { if (open) { setPlan(null); setError(null); load(); } }, [open, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = async () => {
    if (!soul) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(await hermesApi.planSoul(profile, text, soul.sha));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const dirty = !!soul && text !== soul.content;
  const others = soul?.agents ?? [];

  return (
    <>
      <Modal open={open && !plan} onClose={onClose} title={t("soul_title", { profile })} width={820}
        footer={<>
          <span className="mr-auto text-xs text-muted self-center tabular-nums">{tp(m, "chars_n", text.length)}</span>
          <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
          <Button variant="primary" icon={busy ? <Spinner size={14} /> : <Eye size={15} />} disabled={!dirty || busy} onClick={preview}>
            {t("preview_change")}
          </Button>
        </>}>
        <div className="flex flex-col gap-3">
          <Note tone="info" icon={<Feather size={15} />}>
            <Rich text={t("soul_note")} parts={{
              b: <b>{t("soul_note_b")}</b>, identity: <i>{t("tab_identity")}</i>, role: <i>{t("field_task_role")}</i>,
            }} />
          </Note>
          {others.length > 1 && (
            <Note tone="warn" icon={<Users size={15} />}>
              <Rich text={t("soul_affects")} parts={{ names: <b>{others.map((a) => a.name).join(", ")}</b> }} />
            </Note>
          )}
          {loadError && <ErrorBox error={loadError} onRetry={load} />}
          {!soul && !loadError ? <LoadingBlock /> : soul && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">{t("soul_content")}</span>
                <textarea className="textarea font-mono text-sm min-h-[45vh]" value={text} onChange={(e) => setText(e.target.value)}
                  spellCheck={false} placeholder={t("soul_placeholder")} />
              </label>
              <p className="text-xs text-muted font-mono break-all">{soul.path}{soul.exists ? "" : t("not_yet_file")}</p>
            </>
          )}
          {error && <ErrorBox error={error} />}
        </div>
      </Modal>
      <ChangeReviewModal plan={plan} title={t("soul_confirm_title")} onClose={() => setPlan(null)}
        onApplied={(e) => { setPlan(null); onApplied?.(e); onClose(); }} />
    </>
  );
}

// ====================================================================== MEMORY.md / USER.md
type Which = "memory" | "user";
const WHICH_KEY: Record<Which, "which_memory" | "which_user"> = { memory: "which_memory", user: "which_user" };

export function MemoryEditor({ profile, open, onClose, onApplied }:
  { profile: string; open: boolean; onClose: () => void; onApplied?: (e: ChangeEntry) => void }) {
  const t = useT(m);
  const [info, setInfo] = useState<MemoryInfo | null>(null);
  const [which, setWhich] = useState<Which>("memory");
  const [entries, setEntries] = useState<Record<Which, string[]>>({ memory: [], user: [] });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<MemoryPlan | null>(null);

  const load = () => {
    setLoadError(null);
    setInfo(null);
    hermesApi.memory(profile).then((m) => { setInfo(m); setEntries({ memory: [...m.memory.entries], user: [...m.user.entries] }); })
      .catch((e) => setLoadError(String(e instanceof Error ? e.message : e)));
  };
  useEffect(() => { if (open) { setPlan(null); setError(null); load(); } }, [open, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const file = info?.[which];
  const list = entries[which];
  const joined = joinMemory(list);
  const dirty = !!file && joined !== joinMemory(file.entries);
  const over = !!file && joined.length > file.limit;
  const setList = (fn: (l: string[]) => string[]) => setEntries((e) => ({ ...e, [which]: fn(e[which]) }));

  const preview = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(await hermesApi.planMemory(profile, which, list, file.sha));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={open && !plan} onClose={onClose} title={t("mem_title", { profile })} width={820}
        footer={<>
          <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
          <Button variant="primary" icon={busy ? <Spinner size={14} /> : <Eye size={15} />} disabled={!dirty || over || busy} onClick={preview}>
            {t("preview_change")}
          </Button>
        </>}>
        <div className="flex flex-col gap-3">
          <Segmented value={which} onChange={setWhich} className="flex-wrap self-start" options={[
            { value: "memory", label: t(WHICH_KEY.memory) }, { value: "user", label: t(WHICH_KEY.user) },
          ]} />
          <p className="text-sm text-ink-2">
            <Rich text={t("mem_intro")} parts={{ delim: <code className="font-mono text-xs">§</code> }} />
          </p>
          {loadError && <ErrorBox error={loadError} onRetry={load} />}
          {!info && !loadError ? <LoadingBlock /> : info && file && (
            <>
              {!info.enabled[which] && (
                <Note tone="warn">{t("mem_disabled", { what: t(which === "memory" ? "mem_what_memory" : "mem_what_user") })}</Note>
              )}
              <CharMeter value={joined.length} limit={file.limit} label={t(WHICH_KEY[which])} />
              {list.length === 0 && (
                <p className="panel-soft p-4 text-sm text-muted text-center">
                  {file.exists ? t("mem_empty_file") : t("mem_no_notes")} {t("mem_add_first")}
                </p>
              )}
              <ol className="flex flex-col gap-2">
                {list.map((entry, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-xs text-muted tabular-nums w-6 text-right pt-2.5 shrink-0">{i + 1}.</span>
                    <textarea className="textarea text-sm flex-1" rows={Math.min(6, Math.max(2, Math.ceil(entry.length / 70)))} value={entry}
                      aria-label={t("entry_n", { n: i + 1 })} onChange={(e) => setList((l) => l.map((x, j) => (j === i ? e.target.value : x)))} />
                    <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={t("entry_delete", { n: i + 1 })}
                      onClick={() => setList((l) => l.filter((_, j) => j !== i))} />
                  </li>
                ))}
              </ol>
              <div><Button size="sm" icon={<Plus size={14} />} onClick={() => setList((l) => [...l, ""])}>{t("add_entry")}</Button></div>
              <p className="text-xs font-mono break-all text-muted">{file.path}{file.exists ? "" : t("not_yet_file")}</p>
            </>
          )}
          {error && <ErrorBox error={error} />}
        </div>
      </Modal>
      <ChangeReviewModal plan={plan} title={t("mem_confirm_title")} onClose={() => setPlan(null)}
        onApplied={(e) => { setPlan(null); onApplied?.(e); onClose(); }} />
    </>
  );
}
