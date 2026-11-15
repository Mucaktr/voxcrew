// Ekip S1: Profiller — model/sağlayıcı, skill sayısı, SOUL önizlemesi, bellek, oturumlar, cron, onaylı klonlama.
import clsx from "clsx";
import { AlarmClock, Brain, Copy, Feather, History, MessagesSquare, NotebookPen, PencilLine, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { hermesApi, PROFILE_NAME_RE, type HermesProfile } from "../../lib/hermes";
import { timeAgo } from "../../lib/format";
import { fmtDate, tp, useT } from "../../lib/i18n";
import { useStudio } from "../../lib/store";
import { hermesMsg as m } from "../../locales/hermes";
import { Badge, Button, Empty, Panel } from "../ui";
import { AgentChips, CharMeter, ConfirmDialog, ErrorBox, LoadingBlock, Note, Rich, useLoad } from "./common";
import { MemoryEditor, SoulEditor } from "./ProfileEditors";

export function ProfilesView({ profiles, profile, onProfile, onReload, initialEdit }: {
  profiles: HermesProfile[]; profile: string; onProfile: (p: string) => void; onReload: () => void; initialEdit?: "soul" | "memory" | null;
}) {
  const t = useT(m);
  const [edit, setEdit] = useState<"soul" | "memory" | null>(initialEdit ?? null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const current = profiles.find((p) => p.name === profile) ?? profiles[0];
  const selectAgent = useStudio((s) => s.selectAgent);
  useEffect(() => { if (initialEdit) setEdit(initialEdit); }, [initialEdit]);
  if (!current) return <Empty title={t("pv_not_found")} text={t("pv_not_found_text")} />;
  const applied = () => { setTick((n) => n + 1); onReload(); };

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3" aria-label={t("pv_profiles")}>
        {profiles.map((p) => (
          <li key={p.name}>
            <button type="button" aria-pressed={p.name === current.name} onClick={() => onProfile(p.name)}
              className="card-select w-full h-full p-3.5 flex flex-col gap-2 text-left">
              <span className="flex items-center gap-2">
                <span className="font-mono text-base font-semibold flex-1 min-w-0 truncate">{p.name}</span>
                {p.is_default && <Badge tone="info">{t("pv_root")}</Badge>}
              </span>
              <span className="text-sm text-ink-2 truncate"><Brain size={13} className="inline -mt-0.5 mr-1 text-muted" />
                <span className="font-mono">{p.model || t("pv_no_model")}</span> · {p.provider}</span>
              <span className="flex flex-wrap gap-1.5">
                <Badge><Sparkles size={12} />{tp(m, "pv_skills", p.skills)}</Badge>
                <Badge>{tp(m, "pv_toolsets", p.toolsets_cli.length)}</Badge>
                {p.sessions != null && <Badge><MessagesSquare size={12} />{tp(m, "pv_sessions", p.sessions)}</Badge>}
                {!p.has_soul && <Badge tone="warn">{t("pv_no_soul")}</Badge>}
              </span>
              <span className="text-xs text-ink-2 line-clamp-2 leading-relaxed">{p.soul_preview || t("pv_soul_empty_card")}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="section-title flex-1 min-w-0 break-words"><Rich text={t("pv_heading")} parts={{ name: <span className="font-mono">{current.name}</span> }} /></h2>
        <Button icon={<PencilLine size={15} />} onClick={() => setEdit("soul")}>{t("pv_edit_soul")}</Button>
        <Button icon={<NotebookPen size={15} />} onClick={() => setEdit("memory")}>{t("pv_edit_memory")}</Button>
        <Button icon={<Copy size={15} />} onClick={() => setCloneOpen(true)}>{t("pv_clone")}</Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <SoulPanel key={`soul-${current.name}-${tick}`} profile={current} onEdit={() => setEdit("soul")} onOpenAgent={selectAgent} />
        <MemoryPanel key={`mem-${current.name}-${tick}`} profile={current.name} onEdit={() => setEdit("memory")} />
        <SessionsPanel key={`ses-${current.name}`} profile={current.name} />
        <CronPanel key={`cron-${current.name}`} profile={current.name} />
      </div>

      <SoulEditor profile={current.name} open={edit === "soul"} onClose={() => setEdit(null)} onApplied={applied} />
      <MemoryEditor profile={current.name} open={edit === "memory"} onClose={() => setEdit(null)} onApplied={applied} />
      <CloneDialog open={cloneOpen} source={current.name} profiles={profiles} onClose={() => setCloneOpen(false)}
        onDone={(name) => { setCloneOpen(false); onReload(); onProfile(name); useStudio.getState().refreshAgents().catch(() => undefined); }} />
    </div>
  );
}

function SoulPanel({ profile, onEdit, onOpenAgent }: { profile: HermesProfile; onEdit: () => void; onOpenAgent: (slug: string) => void }) {
  const t = useT(m);
  const { data, error, loading, reload } = useLoad(() => hermesApi.soul(profile.name), [profile.name]);
  const [full, setFull] = useState(false);
  const text = data?.content ?? "";
  const long = text.length > 900;
  return (
    <Panel title={t("soul_panel")} icon={<Feather size={16} />}
      actions={<Button size="sm" variant="ghost" icon={<PencilLine size={14} />} onClick={onEdit}>{t("edit")}</Button>}>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <LoadingBlock /> : data && (
        <div className="flex flex-col gap-3">
          {text.trim() ? (
            <div className="panel-soft p-3">
              <p className="text-sm whitespace-pre-wrap leading-relaxed break-words">{full || !long ? text : `${text.slice(0, 900)}…`}</p>
              {long && <button type="button" className="text-xs text-link font-semibold mt-2 hover:underline underline-offset-2" onClick={() => setFull((f) => !f)}>
                {full ? t("show_less") : t("show_all")}</button>}
            </div>
          ) : <p className="text-sm text-muted">{t("pv_soul_empty")}</p>}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">{t("pv_agents_using")}</span>
            <AgentChips agents={data.agents} onOpen={onOpenAgent} empty={t("pv_no_agents")} />
          </div>
          <p className="text-xs text-muted tabular-nums">{tp(m, "chars_n", data.chars)}{data.updated_at ? t("pv_updated", { ago: timeAgo(data.updated_at) }) : ""}</p>
        </div>
      )}
    </Panel>
  );
}

function MemoryPanel({ profile, onEdit }: { profile: string; onEdit: () => void }) {
  const t = useT(m);
  const { data, error, loading, reload } = useLoad(() => hermesApi.memory(profile), [profile]);
  return (
    <Panel title={t("mem_panel")} icon={<NotebookPen size={16} />}
      actions={<Button size="sm" variant="ghost" icon={<PencilLine size={14} />} onClick={onEdit}>{t("edit")}</Button>}>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <LoadingBlock /> : data && (
        <div className="flex flex-col gap-4">
          {(["memory", "user"] as const).map((w) => {
            const f = data[w];
            return (
              <div key={w} className="flex flex-col gap-2">
                <CharMeter value={f.chars} limit={f.limit} label={w === "memory" ? t("which_memory") : t("which_user")} />
                {f.entries.length ? (
                  <ul className="flex flex-col gap-1">
                    {f.entries.slice(0, 4).map((e, i) => <li key={i} className="text-sm text-ink-2 panel-soft px-2.5 py-1.5 line-clamp-2">{e}</li>)}
                    {f.entries.length > 4 && <li className="text-xs text-muted">{tp(m, "more_entries", f.entries.length - 4)}</li>}
                  </ul>
                ) : <p className="text-sm text-muted">{t("mem_no_notes")}</p>}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function SessionsPanel({ profile }: { profile: string }) {
  const t = useT(m);
  const { data, error, loading, reload } = useLoad(() => hermesApi.sessions(profile, 20), [profile]);
  return (
    <Panel title={t("sessions_panel")} icon={<History size={16} />}>
      <p className="text-xs text-muted mb-2"><Rich text={t("sessions_ro")} parts={{ file: <code className="font-mono">state.db</code> }} /></p>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <LoadingBlock /> : data && (data.length === 0 ? (
        <p className="text-sm text-muted">{t("no_sessions")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {data.map((s) => (
            <li key={s.id} className="panel-soft px-3 py-2 flex flex-col gap-1">
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold flex-1 min-w-0 truncate">{s.title || t("untitled_session")}</span>
                <span className="text-xs text-muted shrink-0 num">{timeAgo(s.updated_at)}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                {s.source && <Badge>{s.source}</Badge>}
                {s.messages != null && <span className="tabular-nums">{tp(m, "n_messages", s.messages)}</span>}
                {s.model && <span className="font-mono truncate">{s.model}</span>}
                <span className="font-mono text-muted truncate">{s.id}</span>
              </span>
            </li>
          ))}
        </ul>
      ))}
    </Panel>
  );
}

function CronPanel({ profile }: { profile: string }) {
  const t = useT(m);
  const { data, error, loading, reload } = useLoad(() => hermesApi.cron(profile), [profile]);
  return (
    <Panel title={t("cron_panel")} icon={<AlarmClock size={16} />}>
      <Note tone="muted" className="mb-3">{t("cron_note")}</Note>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <LoadingBlock /> : data && (data.length === 0 ? (
        <p className="text-sm text-muted">{t("no_cron")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {data.map((j) => (
            <li key={j.id || j.name} className={clsx("panel-soft px-3 py-2 flex flex-col gap-1", !j.enabled && "opacity-70")}>
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold flex-1 min-w-0 truncate">{j.name}</span>
                <Badge tone={j.enabled ? "ok" : "muted"}>{j.enabled ? t("cron_on") : t("cron_paused")}</Badge>
              </span>
              <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                <span className="font-mono">{j.schedule}</span>
                {j.next_run && <span className="num">{t("cron_next", { when: fmtDate(j.next_run, { dateStyle: "short", timeStyle: "medium" }) })}</span>}
                {j.last_status && <span>{t("cron_last", { s: j.last_status })}</span>}
                {j.skills.length > 0 && <span>{t("cron_skills", { list: j.skills.join(", ") })}</span>}
              </span>
              {j.prompt && <span className="text-xs text-ink-2 line-clamp-2">{j.prompt}</span>}
            </li>
          ))}
        </ul>
      ))}
    </Panel>
  );
}

function CloneDialog({ open, source, profiles, onClose, onDone }: {
  open: boolean; source: string; profiles: HermesProfile[]; onClose: () => void; onDone: (name: string) => void;
}) {
  const t = useT(m);
  const [name, setName] = useState("");
  const [from, setFrom] = useState(source);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setFrom(source); setName(""); setAck(false); setError(null); } }, [open, source]);
  const valid = PROFILE_NAME_RE.test(name) && name !== "default";
  const exists = profiles.some((p) => p.name === name);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await hermesApi.createProfile(name, from);
      onDone(res.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog open={open} title={t("clone_title")} confirmLabel={t("clone_confirm")} busy={busy}
      disabled={!valid || exists || !ack} onConfirm={run} onClose={onClose}>
      <p><Rich text={t("clone_intro")} parts={{
        config: <b>config.yaml</b>, env: <b>.env</b>, soul: <b>SOUL.md</b>, dir: <code className="font-mono text-xs">~/.hermes/profiles</code>,
      }} /></p>
      <label className="flex flex-col gap-1.5">
        <span className="font-semibold text-ink">{t("clone_source")}</span>
        <select className="select" value={from} onChange={(e) => setFrom(e.target.value)}>
          {profiles.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-semibold text-ink">{t("clone_name")}</span>
        <input className="input font-mono" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder={t("clone_placeholder")}
          aria-invalid={!!name && (!valid || exists)} autoFocus />
        <span className={clsx("text-xs", name && (!valid || exists) ? "text-bad" : "text-muted")}>
          {exists ? t("clone_exists") : t("clone_rule")}
        </span>
      </label>
      <div className="panel-soft p-2.5">
        <span className="text-xs text-muted">{t("clone_cmd")}</span>
        <code className="block font-mono text-xs break-all mt-1">hermes profile create {name || t("clone_name_ph")} --clone-from {from} --no-alias</code>
      </div>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" className="h-4 w-4 mt-0.5 accent-[var(--grass)]" aria-label={t("clone_ack")} checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>{t("clone_ack")}</span>
      </label>
      {error && <ErrorBox error={error} />}
    </ConfirmDialog>
  );
}
