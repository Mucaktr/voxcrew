import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Cloud, Globe, HardDrive, Plus, Route as RouteIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMemo } from "react";
import type { Agent, Connection, ConnectionInfo, OllamaModel } from "../lib/types";
import { bytes, CONNECTION_META, sameModel } from "../lib/format";
import { connOf, endpointModels, endpointsOf, isCloudModel, modelRef, parseModelRef, useConnectionStates, type ProviderKind } from "../lib/connections";
import { chosenConnection } from "../lib/agentBrain";
import { useT } from "../lib/i18n";
import { decide, usePolicyView } from "../lib/modelPolicy";
import { agentsMsg } from "../locales/agents";
import { cx } from "../locales/connections";
import { shell } from "../locales/shell";
import { useConsent } from "./connections/ConsentDialog";
import { NotReadyHint } from "./connections/NotReadyHint";
import { Badge, CONN_ICON, Field, Segmented } from "./ui";

interface Props {
  agent: Agent;
  conns: ConnectionInfo[];
  models: OllamaModel[];
  onPatch: (patch: Partial<Agent>) => void;
}

const CLAUDE_MODELS = [
  { value: "sonnet", label: "Sonnet" }, { value: "opus", label: "Opus" }, { value: "haiku", label: "Haiku" },
];

export function BrainPicker({ agent, conns, models, onPatch }: Props) {
  const t = useT(shell);
  const ta = useT(agentsMsg);
  const conn = (k: string) => conns.find((c) => c.kind === k);
  const hermes = conn("hermes");
  const profiles = useMemo(() => ["default", ...(hermes?.profiles ?? [])], [hermes]);
  const viaHermes = agent.runtime === "hermes" && !!agent.hermes_profile;
  // beyinsiz başlangıç ajanında (needs_brain) yer tutucu bağlantı seçili sayılmaz
  const selected = chosenConnection(agent);
  const local = models.filter((m) => m.local);
  // Ollama bulut modelleri de seçilebilir, ama "veri bu bilgisayardan çıkar" uyarısıyla
  const cloudModels = models.filter((m) => !m.local && (m.cloud ?? isCloudModel(m.name)));
  // FOLLOWUP: uzak Ollama sunucusundaki (bulut olmayan) modeller ayrı bölümde, "Uzak sunucu: <host>" etiketiyle
  const remoteModels = models.filter((m) => !m.local && !(m.cloud ?? isCloudModel(m.name)) && !!m.host);
  const remoteHosts = [...new Set(remoteModels.map((m) => m.host as string))];
  const tc = useT(cx);
  const navigate = useNavigate();

  // S29: hazır olma durumu tek bağlantı modelinden (oturum süresi dolmuşsa "kurulu" yetmez)
  const states = useConnectionStates();
  // S37: adlandırılmış model API bağlantıları (Mistral, Claude API, LM Studio…) — ajan başına uç nokta + model
  const apiState = connOf(states, "openai_compat");
  const endpoints = endpointsOf(apiState);
  const ref = parseModelRef(agent.connection === "openai_compat" ? agent.model : "");
  const currentEp = endpoints.find((e) => e.id === (ref.endpoint ?? apiState?.extra.default_endpoint)) ?? endpoints.find((e) => e.is_default);
  // S37: model erişim politikası — izinsiz seçenekler devre dışı (neden yazılı), izinsiz modeller gizli; uzak model
  // ilk kullanımda bir kerelik onay ister. Son söz sunucuda (rota denetimi).
  const policy = usePolicyView();
  const { ensure, dialog } = useConsent();
  const dec = (c: string, m: string | null | undefined, ollamaRemote?: boolean, ollamaHost?: string) =>
    decide(policy, c, m, { endpoints, defaultEndpoint: apiState?.extra.default_endpoint, ollamaRemote, ollamaHost });
  const decOllama = (m: OllamaModel) => dec("ollama", m.name, !m.local, m.host || undefined);
  const epDec = (id: string, m?: string) => dec("openai_compat", modelRef(id, m ?? endpoints.find((e) => e.id === id)?.model ?? ""));
  const epModels = endpointModels(currentEp).filter((m) => !currentEp || epDec(currentEp.id, m).allowed);
  const allowedLocal = local.filter((m) => dec("ollama", m.name, false).allowed);
  const allowedRemote = remoteModels.filter((m) => decOllama(m).allowed);
  const blockedKind = (k: Connection): boolean => {
    if (k === "ollama") {
      const all = [...local, ...cloudModels, ...remoteModels];
      return all.length > 0 && !all.some((m) => decOllama(m).allowed);
    }
    if (k === "openai_compat") return endpoints.length > 0 && !endpoints.some((e) => epDec(e.id).allowed);
    return !dec(k, null).allowed;
  };
  const notReady = (k: string) => { const st = connOf(states, k as ProviderKind); return !!st && st.ready !== "ok" && st.ready !== "checking"; };
  const failed = (k: string) => conn(k)?.last_use?.ok === false || notReady(k);
  const choices: { kind: Connection; avail: boolean; warn?: boolean }[] = [
    { kind: "ollama", avail: !!conn("ollama")?.available, warn: failed("ollama") },
    { kind: "codex", avail: viaHermes ? !!hermes?.available : !!conn("codex")?.available, warn: failed(viaHermes ? "hermes" : "codex") },
    { kind: "claude", avail: !!conn("claude")?.available, warn: failed("claude") },
    ...(!viaHermes || agent.connection === "openai_compat"
      ? [{ kind: "openai_compat" as Connection, avail: endpoints.length > 0, warn: !!apiState && apiState.ready !== "ok" && apiState.ready !== "checking" }]
      : []),
    ...(viaHermes ? [{ kind: "profile" as Connection, avail: !!hermes?.available }] : []),
  ];

  const pickConnection = async (kind: Connection) => {
    if (kind === selected || blockedKind(kind)) return;
    let model = "";
    if (kind === "ollama") {
      // yerel model yoksa uzak sunucudaki model (ilk kullanım onayıyla)
      const pool = allowedLocal.length ? allowedLocal : allowedRemote;
      const pick = (viaHermes ? pool.find((m) => m.hermes_ready) : undefined) ?? pool[0];
      if (pick && !pick.local && !(await ensure(decOllama(pick)))) return;
      model = pick?.name ?? "";
    }
    if (kind === "codex" && viaHermes && agent.profile_provider === "openai-codex") model = agent.profile_model ?? "";
    if (kind === "openai_compat") {
      const ok = endpoints.filter((e) => epDec(e.id).allowed);
      const ep = ok.find((e) => e.is_default) ?? ok[0];
      if (ep && !(await ensure(epDec(ep.id)))) return;
      model = ep ? modelRef(ep.id, ep.model) : "";
    }
    onPatch({ connection: kind, model });
  };
  const pickEndpointModel = async (id: string, m: string) => {
    const d = epDec(id, m || undefined);
    if (!d.allowed || !(await ensure(d))) return;
    onPatch({ model: modelRef(id, m) });
  };
  const pickOllama = async (name: string, remote: boolean, host?: string) => {
    const d = dec("ollama", name, remote, host);
    if (!d.allowed || !(await ensure(d))) return;
    onPatch({ model: name });
  };

  const codexSuggestions = [agent.profile_provider === "openai-codex" ? agent.profile_model : null, conn("codex")?.default_model, "gpt-5.6-luna"]
    .filter((x, i, arr): x is string => !!x && arr.indexOf(x) === i);

  return (
    <div className="flex flex-col gap-5">
      {dialog}
      <Field label={t("runtime")} hint={viaHermes
        ? t("runtime_hermes_hint", { profile: agent.hermes_profile })
        : t("runtime_direct_hint")}>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={agent.runtime} onChange={(v) => onPatch({ runtime: v, ...(v === "hermes" && !agent.hermes_profile ? { hermes_profile: profiles[1] ?? "default" } : {}),
            ...(v === "direct" && agent.connection === "profile" ? { connection: "ollama", model: local[0]?.name ?? "" } : {}) })}
            options={[{ value: "hermes", label: t("via_hermes"), disabled: !hermes?.available }, { value: "direct", label: t("direct") }]} />
          {agent.runtime === "hermes" && (
            <select className="select !w-auto" value={agent.hermes_profile ?? ""} onChange={(e) => onPatch({ hermes_profile: e.target.value })}
              disabled={agent.created_by === "hermes"} title={agent.created_by === "hermes" ? t("from_hermes_profile") : undefined}>
              {profiles.map((p) => <option key={p} value={p}>{t("profile_option", { profile: p })}</option>)}
            </select>
          )}
        </div>
      </Field>

      <Field label={t("brain_connection")}>
        <div className="grid grid-cols-2 gap-2">
          {choices.map(({ kind, avail, warn }) => {
            const meta = CONNECTION_META[kind];
            const blocked = blockedKind(kind) && selected !== kind;
            return (
              <button key={kind} type="button" aria-pressed={selected === kind} onClick={() => { void pickConnection(kind); }}
                disabled={blocked} title={blocked ? tc("blocked_policy") : undefined}
                className="card-select p-3 flex flex-col gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed">
                <span className="flex items-center gap-2">
                  <span className="h-7 w-7 rounded-md grid place-items-center text-white border-2 border-line" style={{ background: meta.color }}>
                    {CONN_ICON[kind] ?? <Globe size={15} />}
                  </span>
                  <span className="font-semibold text-sm">{meta.label}</span>
                  {selected === kind && <CheckCircle2 size={16} className="ml-auto text-ok" />}
                </span>
                <span className="text-xs text-muted">{meta.desc}</span>
                <span className={clsx("text-xs font-semibold flex items-center gap-1", blockedKind(kind) || !avail ? "text-bad" : warn ? "text-warn" : "text-ok")}>
                  <span className={clsx("h-2 w-2 rounded-sm", blockedKind(kind) || !avail ? "bg-red" : warn ? "bg-gold" : "bg-grass")} />
                  {blockedKind(kind) ? tc("blocked_policy") : !avail ? t("unreachable") : warn ? t("last_failed") : t("ready")}
                </span>
              </button>
            );
          })}
        </div>
        {/* SETUP: başka bir dil modeli eklemenin yeri — Bağlantılar → Model ekle (ön ayar galerisi) */}
        <button type="button" className="btn btn-sm btn-ghost mt-2" onClick={() => navigate("/baglantilar?ekle=model")}>
          <Plus size={14} aria-hidden />{tc("bp_add_model")}
        </button>
        {selected && selected !== "profile" && selected !== "openai_compat" && <NotReadyHint kind={(viaHermes && agent.connection === "codex" ? "hermes" : agent.connection) as ProviderKind} className="mt-2" />}
        {viaHermes && agent.connection !== "codex" && <NotReadyHint kind="hermes" className="mt-2" />}
      </Field>

      {selected === "ollama" && (
        <Field label={t("ollama_model")} hint={viaHermes ? t("ollama_hint_hermes") : t("ollama_hint_direct")}>
          {local.length === 0 && remoteModels.length === 0 && <NotReadyHint kind="ollama" />}
          <div className="flex flex-col gap-1.5">
            {local.map((m) => (
              <button key={m.name} type="button" aria-pressed={sameModel(agent.model, m.name)} onClick={() => { void pickOllama(m.name, false); }}
                disabled={!dec("ollama", m.name, false).allowed} title={dec("ollama", m.name, false).allowed ? undefined : tc("blocked_policy")}
                className="card-select p-2.5 flex items-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed">
                <HardDrive size={18} className="text-muted shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-sm truncate">{m.name}</span>
                  <span className="flex flex-wrap gap-1 mt-1">
                    <Badge tone="ok">{t("local_free")}</Badge>
                    {m.hermes_ready ? <Badge tone="info">{t("hermes_ready")}</Badge> : viaHermes ? <Badge tone="warn">{t("ctx_short")}</Badge> : null}
                    {m.parameter_size && <Badge>{m.parameter_size}</Badge>}
                    {m.quantization && <Badge>{m.quantization}</Badge>}
                    {m.capabilities.filter((c) => c !== "completion").map((c) => <Badge key={c}>{c === "tools" ? t("cap_tools") : c === "thinking" ? t("cap_thinking") : c === "vision" ? t("cap_vision") : c}</Badge>)}
                  </span>
                </span>
                <span className="text-xs text-muted text-right shrink-0 num">
                  {bytes(m.size_bytes)}<br />{m.num_ctx ? t("ctx_k", { n: Math.round(m.num_ctx / 1024) }) : t("ctx_default")}
                </span>
              </button>
            ))}
          </div>
        </Field>
      )}

      {selected === "ollama" && remoteModels.length > 0 && (
        <Field label={tc("remote_host_badge", { host: remoteHosts.join(", ") })} hint={tc("remote_host_warn", { host: remoteHosts.join(", ") })}>
          <div className="flex flex-col gap-1.5">
            {remoteModels.map((m) => {
              const d = decOllama(m);
              return (
                <button key={m.name} type="button" aria-pressed={sameModel(agent.model, m.name)} onClick={() => { void pickOllama(m.name, true, m.host); }}
                  disabled={!d.allowed} title={d.allowed ? undefined : tc("blocked_policy")}
                  className="card-select p-2.5 flex items-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed">
                  <Globe size={18} className="text-muted shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-sm truncate">{m.name}</span>
                    <span className="flex flex-wrap gap-1 mt-1">
                      <Badge tone="info">{tc("remote_host_badge", { host: m.host ?? "" })}</Badge>
                      {!d.allowed ? <Badge tone="bad">{tc("blocked_policy")}</Badge> : <Badge tone="warn">{tc("ep_remote")}</Badge>}
                      {m.parameter_size && <Badge>{m.parameter_size}</Badge>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </Field>
      )}

      {selected === "ollama" && cloudModels.length > 0 && (
        <Field label={tc("cloud_badge")} hint={tc("cloud_warn")}>
          <div className="flex flex-col gap-1.5">
            {cloudModels.map((m) => (
              <button key={m.name} type="button" aria-pressed={sameModel(agent.model, m.name)} onClick={() => { void pickOllama(m.name, true); }}
                disabled={!dec("ollama", m.name, true).allowed}
                className="card-select p-2.5 flex items-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed">
                <Cloud size={18} className="text-muted shrink-0" aria-hidden />
                <span className="font-semibold text-sm truncate flex-1 min-w-0">{m.name}</span>
                <Badge tone="info">{tc("online_badge")}</Badge>
                {!dec("ollama", m.name, true).allowed ? <Badge tone="bad">{tc("blocked_policy")}</Badge> : <Badge tone="warn">{tc("ep_remote")}</Badge>}
              </button>
            ))}
          </div>
        </Field>
      )}

      {agent.connection === "openai_compat" && (
        <>
          <Field label={tc("bp_endpoint")} hint={tc("bp_endpoint_hint")}>
            {endpoints.length === 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-warn">{tc("bp_no_endpoint")}</span>
                <button type="button" className="btn btn-sm" onClick={() => navigate("/baglantilar?ekle=model")}>{tc("bp_add_endpoint")}</button>
              </div>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2" role="group" aria-label={tc("bp_endpoint")}>
                {endpoints.map((ep) => (
                  <button key={ep.id} type="button" aria-pressed={currentEp?.id === ep.id} onClick={() => { void pickEndpointModel(ep.id, ep.model); }}
                    disabled={!epDec(ep.id).allowed && currentEp?.id !== ep.id}
                    className="card-select p-2.5 flex flex-col items-start gap-1 min-w-0 text-left disabled:opacity-60 disabled:cursor-not-allowed">
                    <span className="flex items-center gap-1.5 w-full min-w-0">
                      {ep.local ? <HardDrive size={14} className="text-muted shrink-0" aria-hidden /> : <Cloud size={14} className="text-muted shrink-0" aria-hidden />}
                      <span className="font-semibold text-sm truncate">{ep.label}</span>
                      {!ep.local && <Badge tone="info" className="shrink-0">{tc("online_badge")}</Badge>}
                      {currentEp?.id === ep.id && <CheckCircle2 size={15} className="ml-auto text-ok shrink-0" />}
                    </span>
                    <span className={clsx("text-xs flex items-center gap-1 min-w-0 w-full", ep.ready === "ok" ? "text-ok" : ep.ready === "checking" ? "text-muted" : "text-warn")}>
                      <span className={clsx("h-2 w-2 rounded-sm shrink-0", ep.ready === "ok" ? "bg-grass" : ep.ready === "checking" ? "bg-panel-3" : "bg-gold")} />
                      <span className="truncate">{!epDec(ep.id).allowed ? tc("blocked_policy") : ep.ready === "ok" ? t("ready") : ep.problems?.[0]?.message ?? tc("ready_checking")}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Field>
          {currentEp && (
            <Field label={tc("bp_model")} hint={tc("bp_model_hint")}>
              <input className="input font-mono" list={"bp-ep-models-" + currentEp.id} aria-label={tc("bp_model")}
                value={ref.model} placeholder={currentEp.model ? tc("bp_endpoint_default_model", { model: currentEp.model }) : t("default_lower")}
                onChange={(e) => onPatch({ model: modelRef(currentEp.id, e.target.value) })}
                onBlur={(e) => { const d = epDec(currentEp.id, e.target.value || undefined); if (d.allowed && d.needsConsent) void ensure(d); }} />
              <datalist id={"bp-ep-models-" + currentEp.id}>{epModels.map((m) => <option key={m} value={m} />)}</datalist>
              {epModels.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5" role="group" aria-label={tc("bp_model")}>
                  {epModels.slice(0, 10).map((m) => (
                    <button key={m} type="button" className="chip font-mono !text-xs hover:border-ink-2 max-w-full" aria-pressed={(ref.model || currentEp.model) === m}
                      onClick={() => { void pickEndpointModel(currentEp.id, m); }}><span className="truncate">{m}</span></button>
                  ))}
                </div>
              )}
              {!currentEp.local && <p className="text-xs text-warn mt-1.5">{tc("remote_warn", { host: currentEp.host })}</p>}
            </Field>
          )}
        </>
      )}

      {agent.connection === "codex" && (
        <Field label={t("codex_model")} hint={viaHermes ? t("codex_hint_hermes") : t("codex_hint_direct")}>
          <input className="input font-mono" list="codex-models" value={agent.model ?? ""} placeholder={conn("codex")?.default_model ?? t("default_lower")}
            onChange={(e) => onPatch({ model: e.target.value })} />
          <datalist id="codex-models">{codexSuggestions.map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
      )}

      {agent.connection === "claude" && (
        <Field label={t("claude_model")} hint={t("claude_hint")}>
          <Segmented value={agent.model ?? ""} onChange={(v) => onPatch({ model: v })} options={[{ value: "", label: t("claude_default") }, ...CLAUDE_MODELS]} />
        </Field>
      )}

      {agent.connection === "profile" && (
        <div className="panel-soft p-3 text-sm">
          {t("profile_own")} <b className="font-mono">{agent.profile_provider}</b> · <b className="font-mono">{agent.profile_model || "—"}</b>
        </div>
      )}

      <Field label={t("permission")} hint={t("permission_hint")}>
        <Segmented value={agent.permissions} onChange={(v) => onPatch({ permissions: v })}
          options={[{ value: "read", label: ta("perm_read") }, { value: "write", label: ta("perm_write") }]} />
      </Field>

      <div className={clsx("rounded-lg border-2 p-3 text-sm flex gap-2", agent.needs_brain ? "tone-warn" : agent.route_error ? "tone-bad" : agent.route?.warning ? "tone-warn" : "tone-ok")}>
        {agent.route_error || agent.route?.warning ? <AlertTriangle size={17} className="shrink-0" /> : <RouteIcon size={17} className="shrink-0" />}
        <div>
          <div className="font-semibold">{agent.needs_brain ? ta("no_brain_title") : agent.route_error ? ta("route_unresolved") : agent.route?.label}</div>
          {agent.needs_brain ? <div className="text-xs mt-0.5">{ta("no_brain_hint")}</div>
            : (agent.route_error || agent.route?.warning) && <div className="text-xs mt-0.5">{agent.route_error || agent.route?.warning}</div>}
        </div>
      </div>
    </div>
  );
}
