// Ekip S27 — ajan çekmecesi "Araçlar" sekmesi: MCP sunucu ataması, izin/yasak/onaysız kalıpları, etkin araç listesi
// ve beyne göre uygulanma notu (Codex için "uygulanmaz" açıkça gösterilir).
import { AlertTriangle, Check, ShieldCheck, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../lib/i18n";
import { toolsApi, type AgentToolsView } from "../../lib/tools";
import { toolsMsg } from "../../locales/tools";
import { Badge, Button, Empty, SectionTitle, Spinner } from "../ui";
import { PatternList } from "./PatternList";

type Draft = { mcp: string[]; allow: string[]; deny: string[]; auto_approve: string[] };

function draftOf(v: AgentToolsView): Draft {
  const a = v.policy.agent;
  return { mcp: [...a.mcp], allow: [...a.allow], deny: [...a.deny], auto_approve: [...a.auto_approve] };
}

export function AgentTools({ slug }: { slug: string }) {
  const t = useT(toolsMsg);
  const [view, setView] = useState<AgentToolsView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  const load = useCallback(() => {
    setError(null);
    toolsApi.agent(slug).then((v) => { setView(v); setDraft(draftOf(v)); }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [slug]);
  useEffect(load, [load]);

  if (error && !view) {
    return <Empty icon={<AlertTriangle size={20} aria-hidden />} title={t("load_error", { error })}
      action={<Button size="sm" onClick={load}>{t("retry")}</Button>} />;
  }
  if (!view || !draft) return <div className="grid place-items-center py-10" role="status" aria-label={t("loading")}><Spinner /></div>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(view));
  const save = async () => {
    setState("saving");
    setError(null);
    try {
      const v = await toolsApi.saveAgent(slug, draft);
      setView(v);
      setDraft(draftOf(v));
      setState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setDraft((d) => (d ? { ...d, [k]: v } : d)); setState("idle"); };
  const toggleServer = (id: string, on: boolean) => set("mcp", on ? [...draft.mcp, id] : draft.mcp.filter((x) => x !== id));

  const connector = view.route.connector ?? "";
  const enforced = view.enforcement.enforced;
  const note = connector === "codex" ? t("not_enforced_codex") : connector === "hermes" ? t("not_enforced_hermes")
    : connector === "ollama" ? t("enforced_ollama") : connector === "claude" ? t("enforced_claude") : t("not_enforced_other");
  const servers = Array.from(new Set([...view.available_servers, ...draft.mcp.filter((m) => !/[*?[]/.test(m))]));
  const globalAllow = view.policy.allow.filter((p) => !view.policy.agent.allow.includes(p));
  const globalDeny = view.policy.deny.filter((p) => !view.policy.agent.deny.includes(p));

  return (
    <div className="flex flex-col gap-5">
      <div className={enforced ? "panel-soft p-3 flex gap-2.5 items-start" : "panel-soft p-3 flex gap-2.5 items-start border-warn"} role="note">
        {enforced ? <ShieldCheck size={18} className="text-ok shrink-0 mt-0.5" aria-hidden /> : <AlertTriangle size={18} className="text-warn shrink-0 mt-0.5" aria-hidden />}
        <div className="min-w-0 text-sm">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span className="font-semibold">{t("brain_label")}:</span>
            <Badge>{connector || "?"}{view.route.model ? ` · ${view.route.model}` : ""}</Badge>
            {!enforced && <Badge tone="warn">{connector === "codex" ? t("not_enforced") : t("enforced_no")}</Badge>}
          </div>
          <p className="text-ink-2">{note}</p>
          {view.notes.includes("model_no_tools") && <p className="text-warn mt-1">{t("model_no_tools")}</p>}
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <SectionTitle as="h3" size="sm" icon={<Wrench size={15} aria-hidden />}>{t("servers_title")}</SectionTitle>
        <p className="text-xs text-muted">{t("servers_hint")}</p>
        {servers.length === 0 ? (
          <p className="text-sm text-muted">{t("no_servers")} <Link to="/baglantilar" className="text-link font-semibold hover:underline underline-offset-2">{t("open_connections")}</Link></p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {servers.map((id) => {
              const on = draft.mcp.includes(id);
              const unknown = view.policy.unknown_servers.includes(id);
              return (
                <li key={id}>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" aria-label={id} checked={on} onChange={(e) => toggleServer(id, e.target.checked)} className="h-4 w-4 accent-[var(--grass)]" />
                    <span className="font-mono font-semibold">{id}</span>
                    {unknown && <Badge tone="bad">{t("status_disabled")}</Badge>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <PatternList label={t("allow_title")} hint={t("allow_hint")} value={draft.allow} onChange={(v) => set("allow", v)} tone="ok" />
      <PatternList label={t("deny_title")} hint={t("deny_hint")} value={draft.deny} onChange={(v) => set("deny", v)} tone="bad" />
      <PatternList label={t("auto_title")} hint={t("auto_hint")} value={draft.auto_approve} onChange={(v) => set("auto_approve", v)} tone="warn" />
      <p className="text-xs text-muted">{t("global_rules", { allow: globalAllow.join(", ") || t("none"), deny: globalDeny.join(", ") || t("none") })}</p>

      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={!dirty || state === "saving"} onClick={save}>{t("save")}</Button>
        <span className="text-xs text-muted flex items-center gap-1" aria-live="polite">
          {state === "saving" && <><Spinner size={13} /> {t("saving")}</>}
          {state === "saved" && <><Check size={13} className="text-ok" aria-hidden /> {t("saved")}</>}
          {error && <span className="text-bad" role="alert">{error}</span>}
        </span>
      </div>

      <section className="flex flex-col gap-2">
        <SectionTitle as="h3" size="sm">{t("effective_title")}</SectionTitle>
        <p className="text-xs text-muted">{t("effective_hint")}</p>
        {view.policy.unknown_servers.length > 0 && (
          <p className="text-xs text-warn">{t("unknown_servers", { list: view.policy.unknown_servers.join(", ") })}</p>
        )}
        {view.servers.filter((s) => !s.listed).map((s) => (
          <p key={s.id} className="text-xs text-muted">{t("not_probed", { server: s.id })}</p>
        ))}
        {view.tools.length > 0 && (
          <ul className="flex flex-col gap-1">
            {view.tools.map((tool) => (
              <li key={tool.name} className="panel-soft px-3 py-2 flex flex-wrap items-center gap-2 min-w-0">
                <span className="font-mono text-sm font-semibold break-all flex-1 min-w-0">{tool.name}</span>
                <Badge tone={tool.allowed ? "ok" : "bad"}>{tool.allowed ? t("allowed") : t("blocked")}</Badge>
                {tool.allowed && <Badge tone={tool.needs_approval ? "info" : "warn"}>{tool.needs_approval ? t("asks") : t("auto")}</Badge>}
                {tool.description && <p className="basis-full text-xs text-muted">{tool.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
