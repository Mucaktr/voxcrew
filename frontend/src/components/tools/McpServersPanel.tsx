// Ekip S27 — Bağlantılar sayfası: MCP araç sunucuları (ekle / düzenle / yokla / etkinleştir), araç sınırları,
// istem enjeksiyonu kipi ve beyinlere göre uygulanma tablosu. Hiçbir sunucu kullanıcı tıklaması olmadan başlamaz.
import { AlertTriangle, Pencil, Plug, Plus, Radar, Save, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { useT } from "../../lib/i18n";
import { registerEventHandler } from "../../lib/store";
import { toolsApi, type InjectionMode, type McpServer, type McpServerInput, type ToolClass, type ToolsOverview, type Transport } from "../../lib/tools";
import { toolsMsg } from "../../locales/tools";
import { Badge, Button, Empty, Field, Modal, Panel, SectionTitle, Segmented, Spinner, Toggle } from "../ui";
import { PatternList } from "./PatternList";

const STATUS_TONE: Record<string, string> = { ok: "ok", error: "bad", invalid: "bad", running: "info", probing: "info", disabled: "muted", unknown: "muted" };

export function McpServersPanel() {
  const t = useT(toolsMsg);
  const [data, setData] = useState<ToolsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<McpServer | "new" | null>(null);
  const [probing, setProbing] = useState<Record<string, boolean>>({});
  const [probeMsg, setProbeMsg] = useState<Record<string, { ok: boolean; text: string }>>({});

  const load = useCallback(() => {
    toolsApi.overview().then((d) => { setData(d); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    load();
    return registerEventHandler("tools.", load);  // başka sekmede yapılan değişiklikler/yoklamalar
  }, [load]);

  const run = async (fn: () => Promise<ToolsOverview>) => {
    setError(null);
    try { setData(await fn()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const probe = async (id: string) => {
    setProbing((p) => ({ ...p, [id]: true }));
    try {
      const r = await toolsApi.probe(id);
      setProbeMsg((m) => ({ ...m, [id]: r.ok ? { ok: true, text: t("probe_ok", { n: String(r.tools.length), ms: String(r.ms) }) }
                                            : { ok: false, text: t("probe_fail", { error: r.error ?? "?" }) } }));
    } catch (e) {
      setProbeMsg((m) => ({ ...m, [id]: { ok: false, text: t("probe_fail", { error: e instanceof Error ? e.message : String(e) }) } }));
    } finally {
      setProbing((p) => ({ ...p, [id]: false }));
      load();
    }
  };

  return (
    <Panel title={t("panel_title")} icon={<Plug size={16} aria-hidden />}
      actions={<Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={() => setEditing("new")}>{t("add_server")}</Button>}>
      <p className="text-sm text-muted mb-3">{t("panel_intro")}</p>
      {error && <p role="alert" className="text-sm text-bad mb-3">{error}</p>}
      {!data ? <div className="grid place-items-center py-6"><Spinner /></div> : (
        <div className="flex flex-col gap-5">
          {data.servers.length === 0 ? <Empty title={t("empty_title")} text={t("empty_text")} /> : (
            <ul className="grid gap-2 lg:grid-cols-2">
              {data.servers.map((s) => (
                <li key={s.id} className="panel-soft p-3 flex flex-col gap-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="font-mono font-semibold truncate">{s.id}</span>
                    {s.name && <span className="text-sm text-muted truncate">{s.name}</span>}
                    <Badge tone={STATUS_TONE[s.status] ?? "muted"}>{t(`status_${s.status}` as "status_ok")}</Badge>
                    <Badge>{s.transport}</Badge>
                    {s.tools.length > 0 && <Badge tone="info">{t("tools_n", { n: String(s.tools.length) })}</Badge>}
                    {s.stateless && <Badge>{t("stateless")}</Badge>}
                  </div>
                  <code className="text-xs text-ink-2 break-all">{s.transport === "http" ? s.url : [s.command, ...(s.args ?? [])].join(" ")}</code>
                  {(s.env_status?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap items-center gap-1 text-xs" aria-label={t("env_label")}>
                      <span className="font-semibold text-ink-2">{t("env_label")}:</span>
                      {s.env_status!.map((e) => (
                        <Badge key={e.name} tone={e.set ? "ok" : "warn"}>
                          <span className="font-mono">{e.name}</span> · {e.set ? t("env_set") : t("env_unset")}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {(s.invalid || s.error) && <p className="text-xs text-bad break-words">{s.invalid ?? s.error}</p>}
                  {probeMsg[s.id] && <p className={probeMsg[s.id].ok ? "text-xs text-ok" : "text-xs text-bad break-words"} aria-live="polite">{probeMsg[s.id].text}</p>}
                  {s.tools.length > 0 && (
                    <p className="text-xs text-muted break-words">{s.tools.slice(0, 12).map((x) => x.name).join(", ")}{s.tools.length > 12 ? " …" : ""}</p>
                  )}
                  {s.tools.length > 0 && <ToolClasses server={s} onSaved={setData} onError={setError} />}
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <Toggle checked={!!s.enabled} label={t("enabled")} onChange={(v) => run(() => toolsApi.updateServer(s.id, { enabled: v }))} />
                    <span className="flex-1" />
                    <Button size="sm" icon={probing[s.id] ? <Spinner size={13} /> : <Radar size={14} aria-hidden />}
                      disabled={!!probing[s.id] || !!s.invalid} onClick={() => probe(s.id)}>{probing[s.id] ? t("probing") : t("probe")}</Button>
                    <Button size="sm" variant="ghost" icon={<Pencil size={14} aria-hidden />} onClick={() => setEditing(s)} aria-label={`${t("edit")} ${s.id}`} />
                    <Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden />} aria-label={`${t("delete")} ${s.id}`}
                      onClick={() => { if (confirm(t("delete_confirm", { id: s.id }))) void run(() => toolsApi.deleteServer(s.id)); }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Limits data={data} onSaved={setData} />
          <EnforcementTable data={data} />
        </div>
      )}
      {editing && <ServerForm server={editing === "new" ? null : editing} onClose={() => setEditing(null)}
        onSaved={(d) => { setData(d); setEditing(null); }} />}
    </Panel>
  );
}

// araç başına yan etki sınıfı (yalnız kullanıcı; MCP 403). Salt okunur / idempotent araç baştan çalışan adımda
// yeniden yürür; yan etkili (ya da sınıfı bilinmeyen) aracın önceki başarılı çağrısı yeniden yürütülmez.
function ToolClasses({ server, onSaved, onError }: { server: McpServer; onSaved: (d: ToolsOverview) => void;
  onError: (e: string | null) => void }) {
  const t = useT(toolsMsg);
  const [busy, setBusy] = useState<string | null>(null);
  const label = (c: ToolClass | undefined) => t(c === "read" ? "class_read" : c === "idempotent" ? "class_idempotent" : "class_effect");
  const change = async (tool: string, value: string) => {
    setBusy(tool);
    onError(null);
    try {
      onSaved(await toolsApi.setToolClass(`${server.id}:${tool}`, value === "" ? null : (value as ToolClass)));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <details className="text-xs">
      <summary className="cursor-pointer font-semibold text-ink-2">{t("classes_title", { n: String(server.tools.length) })}</summary>
      <p className="mt-1.5 text-muted break-words">{t("classes_hint")}</p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {server.tools.map((x) => {
          // sınıf sunucunun sözü; çelişkili beyan yan etkili sayılır, beyan yoksa bunu açıkça söyle
          const declared: ToolClass = x.declared ?? (x.hints?.destructiveHint ? "effect" : x.hints?.readOnlyHint ? "read"
            : x.hints?.idempotentHint ? "idempotent" : "effect");  // destructiveHint önce gelir
          const byServer = x.declared_by_server ?? Boolean(x.hints);
          return (
            <li key={x.name} className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="font-mono truncate min-w-0 flex-1">{x.name}</span>
              <Badge tone={x.class === "effect" ? "warn" : "ok"}
                title={x.user_class ? t("class_user") : byServer ? t("class_from_server") : t("class_none_short")}>
                {label(x.class)}
              </Badge>
              <select className="input py-0.5 text-xs max-w-full" aria-label={t("class_label", { tool: x.name })}
                value={x.user_class ?? ""} disabled={busy === x.name} onChange={(e) => void change(x.name, e.target.value)}>
                <option value="">{byServer ? t("class_auto", { cls: label(declared) }) : t("class_none")}</option>
                <option value="read">{t("class_read")}</option>
                <option value="idempotent">{t("class_idempotent")}</option>
                <option value="effect">{t("class_effect")}</option>
              </select>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function ServerForm({ server, onClose, onSaved }: { server: McpServer | null; onClose: () => void; onSaved: (d: ToolsOverview) => void }) {
  const t = useT(toolsMsg);
  const [form, setForm] = useState<{ id: string; name: string; transport: Transport; command: string; args: string; url: string; env: string }>(() => ({
    id: server?.id ?? "", name: server?.name ?? "", transport: server?.transport ?? "stdio", command: server?.command ?? "",
    args: (server?.args ?? []).join("\n"), url: server?.url ?? "", env: (server?.env_refs ?? []).join("\n"),
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { id: useId(), name: useId(), command: useId(), args: useId(), url: useId(), transport: useId(), env: useId() };
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async () => {
    setBusy(true);
    setError(null);
    const refs = [...new Set(form.env.split(/[\n,]/).map((a) => a.trim()).filter(Boolean))];
    const body: McpServerInput = { id: form.id.trim(), name: form.name.trim() || undefined, transport: form.transport,
      ...(form.transport === "stdio"
        ? { command: form.command.trim(), args: form.args.split("\n").map((a) => a.trim()).filter(Boolean), env_refs: refs }
        : { url: form.url.trim() }) };
    // Karar 1: ad kümesi değiştiyse adları sayan açık onay (sunucu da aynı kümeyi ister; MCP hiç değiştiremez)
    const before = [...(server?.env_refs ?? [])].sort().join(",");
    if (form.transport === "stdio" && refs.length > 0 && [...refs].sort().join(",") !== before) {
      if (!confirm(t("env_confirm", { id: body.id, list: refs.join(", ") }))) { setBusy(false); return; }
      body.confirm_env = refs;
    }
    try {
      onSaved(server ? await toolsApi.updateServer(server.id, body) : await toolsApi.addServer({ ...body, enabled: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={server ? t("form_title_edit", { id: server.id }) : t("form_title_new")} width={560}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button variant="primary" icon={<Save size={14} aria-hidden />} disabled={busy || !form.id.trim()} onClick={submit}>{t("save")}</Button>
      </>}>
      <div className="flex flex-col gap-4">
        <Field label={<label htmlFor={ids.id}>{t("f_id")}</label>} hint={t("f_id_hint")}>
          <input id={ids.id} className="input font-mono" value={form.id} disabled={!!server} onChange={(e) => set("id", e.target.value)} autoComplete="off" />
        </Field>
        <Field label={<label htmlFor={ids.name}>{t("f_name")}</label>}>
          <input id={ids.name} className="input" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label={<span id={ids.transport}>{t("f_transport")}</span>}>
          <div role="group" aria-labelledby={ids.transport}>
            <Segmented value={form.transport} onChange={(v) => set("transport", v)}
              options={[{ value: "stdio", label: "stdio" }, { value: "http", label: "HTTP" }]} />
          </div>
        </Field>
        {form.transport === "stdio" ? (
          <>
            <Field label={<label htmlFor={ids.command}>{t("f_command")}</label>} hint={t("f_command_hint")}>
              <input id={ids.command} className="input font-mono" value={form.command} onChange={(e) => set("command", e.target.value)} autoComplete="off" />
            </Field>
            <Field label={<label htmlFor={ids.args}>{t("f_args")}</label>} hint={t("f_args_hint")}>
              <textarea id={ids.args} className="textarea font-mono" rows={3} value={form.args} onChange={(e) => set("args", e.target.value)} />
            </Field>
            <Field label={<label htmlFor={ids.env}>{t("f_env")}</label>} hint={t("f_env_hint")}>
              <textarea id={ids.env} className="textarea font-mono" rows={2} value={form.env} spellCheck={false} autoComplete="off"
                onChange={(e) => set("env", e.target.value.toUpperCase())} />
            </Field>
          </>
        ) : (
          <Field label={<label htmlFor={ids.url}>{t("f_url")}</label>} hint={t("f_url_hint")}>
            <input id={ids.url} className="input font-mono" type="url" value={form.url} onChange={(e) => set("url", e.target.value)} autoComplete="off" />
          </Field>
        )}
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </div>
    </Modal>
  );
}

function Limits({ data, onSaved }: { data: ToolsOverview; onSaved: (d: ToolsOverview) => void }) {
  const t = useT(toolsMsg);
  const initial = () => ({ max_rounds: data.settings.max_rounds, call_timeout_s: data.settings.call_timeout_s,
    injection: data.guard.injection, allow: data.settings.allow, deny: data.settings.deny });
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const ids = { rounds: useId(), timeout: useId(), inj: useId() };
  const dirty = JSON.stringify(form) !== JSON.stringify(initial());
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => { setForm((f) => ({ ...f, [k]: v })); setSaved(false); };
  const save = async () => {
    setError(null);
    try { onSaved(await toolsApi.saveSettings(form)); setSaved(true); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <section className="pt-4 border-t-2 border-line-soft flex flex-col gap-4">
      <SectionTitle as="h3" size="sm" icon={<ShieldCheck size={15} aria-hidden />}
        actions={<>{saved && <Badge tone="ok">{t("saved")}</Badge>}
          <Button size="sm" variant="primary" icon={<Save size={14} aria-hidden />} disabled={!dirty} onClick={save}>{t("save_limits")}</Button></>}>
        {t("limits_title")}
      </SectionTitle>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label={<label htmlFor={ids.rounds}>{t("max_rounds")}</label>}>
          <input id={ids.rounds} className="input" type="number" min={1} max={50} value={form.max_rounds}
            onChange={(e) => set("max_rounds", Number(e.target.value))} />
        </Field>
        <Field label={<label htmlFor={ids.timeout}>{t("call_timeout")}</label>}>
          <input id={ids.timeout} className="input" type="number" min={1} max={600} value={form.call_timeout_s}
            onChange={(e) => set("call_timeout_s", Number(e.target.value))} />
        </Field>
        <Field label={<span id={ids.inj}>{t("injection")}</span>} hint={t("injection_hint")}>
          <div role="group" aria-labelledby={ids.inj}>
            <Segmented<InjectionMode> value={form.injection} onChange={(v) => set("injection", v)} className="flex-wrap" options={[
              { value: "off", label: t("inj_off") }, { value: "warn", label: t("inj_warn") }, { value: "block", label: t("inj_block") },
            ]} />
          </div>
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <PatternList label={t("global_allow")} hint={t("allow_hint")} value={form.allow} onChange={(v) => set("allow", v)} tone="ok" />
        <PatternList label={t("global_deny")} hint={t("deny_hint")} value={form.deny} onChange={(v) => set("deny", v)} tone="bad" />
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </section>
  );
}

function EnforcementTable({ data }: { data: ToolsOverview }) {
  const t = useT(toolsMsg);
  const rows: { key: string; label: "brain_ollama" | "brain_claude" | "brain_codex" | "brain_hermes" }[] = [
    { key: "ollama", label: "brain_ollama" }, { key: "claude", label: "brain_claude" },
    { key: "codex", label: "brain_codex" }, { key: "hermes", label: "brain_hermes" },
  ];
  return (
    <section className="flex flex-col gap-2">
      <SectionTitle as="h3" size="sm">{t("enforcement_title")}</SectionTitle>
      <ul className="flex flex-wrap gap-2">
        {rows.map((r) => {
          const on = !!data.enforcement[r.key]?.enforced;
          return (
            <li key={r.key}>
              <Badge tone={on ? "ok" : "warn"}>
                {!on && <AlertTriangle size={12} aria-hidden />}
                {t(r.label)}: {on ? t("enforced_yes") : t("enforced_no")}
              </Badge>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">{t("not_enforced_codex")}</p>
    </section>
  );
}
