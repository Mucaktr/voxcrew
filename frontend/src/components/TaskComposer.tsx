import clsx from "clsx";
import { Brain, Globe, Search, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { agentAvailability, agentMood } from "../lib/agents";
import { isBenched, pickComposerAgent } from "../lib/composerPick";
import { connOf, endpointModels, endpointsOf, modelRef, useConnectionStates } from "../lib/connections";
import { decide, usePolicyView } from "../lib/modelPolicy";
import { useConsent } from "./connections/ConsentDialog";
import { CONNECTION_META } from "../lib/format";
import { tp, useT } from "../lib/i18n";
import { getLastProject, memoryApi, nsLabel, setLastProject, toNamespace, useNamespaces } from "../lib/memory";
import { useStudio } from "../lib/store";
import { memoryMsg } from "../locales/memory";
import { cx } from "../locales/connections";
import { shell } from "../locales/shell";
import { knownProjectKeys, ProjectField } from "./goals/ProjectField";
import { NotReadyHint } from "./connections/NotReadyHint";
import { PixelFace } from "./PixelFace";
import { EstimatePanel, ExpectedOutputField, TradeoffCard, type CapState } from "../full/composer"; // öngörü, iki yaklaşım, beklenen çıktı (ücretli sürüm)
import type { EstimateSpec } from "../full/data";
import { WorkZonePicker } from "./workzones/WorkZones"; // WORK-ZONES (plan §5 C2): çalışma yeri
import { Badge, Button, CONN_ICON, Field, Modal, Segmented, Toggle } from "./ui";

type Override = "agent" | "ollama" | "codex" | "claude" | "openai_compat";

export function TaskComposer() {
  const { open, agent: preset, prompt: presetPrompt, onStarted } = useStudio((s) => s.composer);
  const close = useStudio((s) => s.closeComposer);
  const allAgents = useStudio((s) => s.agents);
  const agents = useMemo(() => allAgents.filter((a) => !a.hidden), [allAgents]);
  const states = useStudio((s) => s.states);
  const conns = useStudio((s) => s.connections);
  const models = useStudio((s) => s.models);
  const navigate = useNavigate();
  const t = useT(shell);
  const tm = useT(memoryMsg);
  const tc = useT(cx);
  // S37: model API bağlantıları (uç nokta + model) görev bazında da seçilebilir
  const apiState = connOf(useConnectionStates(), "openai_compat");
  const endpoints = useMemo(() => endpointsOf(apiState), [apiState]);
  const [endpoint, setEndpoint] = useState("");
  // S37: model erişim politikası — izinsiz bağlantı/model seçilemez; uzak modelde bir kerelik onay
  const policy = usePolicyView();
  const { ensure, dialog } = useConsent();
  const dec = (c: string, m?: string | null) => decide(policy, c, m, { endpoints, defaultEndpoint: apiState?.extra.default_endpoint });
  const okEndpoints = endpoints.filter((e) => dec("openai_compat", modelRef(e.id, e.model)).allowed);
  const ep = okEndpoints.find((e) => e.id === endpoint) ?? okEndpoints.find((e) => e.is_default) ?? okEndpoints[0];
  const epModels = endpointModels(ep).filter((m) => !ep || dec("openai_compat", modelRef(ep.id, m)).allowed);

  const [agent, setAgent] = useState<string>("");
  // açan yer yedekteki bir ajanı istediyse (profildeki "Görev ver") adını söyle; sessizce başkasını seçme
  const [benchedPreset, setBenchedPreset] = useState<string | null>(null);
  // S39: çok ajanda (20–80) yatay şeritten seçmek zor — ad/unvan/ekip araması; seçili ajan her zaman başta görünür
  const [who, setWho] = useState("");
  const shownAgents = useMemo(() => {
    const needle = who.trim().toLocaleLowerCase();
    const sel = agents.find((a) => a.slug === agent);
    const rest = agents.filter((a) => a.slug !== agent && (!needle
      || [a.name, a.title, a.team, a.role].some((v) => (v ?? "").toLocaleLowerCase().includes(needle))));
    return sel ? [sel, ...rest] : rest;
  }, [agents, agent, who]);
  const [prompt, setPrompt] = useState("");
  // isteğe bağlı beklenen çıktı → kabul kaydında zorunlu manuel ölçüt (varsayılan ölçütler korunur)
  const [expected, setExpected] = useState("");
  // WORK-ZONES: çalışma yeri (şehir sahnesinde ofis binası; varsayılan "office" = bugünkü davranış)
  const scene = useStudio((s) => s.scene);
  const [zone, setZone] = useState("office");
  const [override, setOverride] = useState<Override>("agent");
  const [model, setModel] = useState("");
  const [memory, setMemory] = useState(true);
  const [remember, setRemember] = useState(true);
  // bellek ad alanı (proje anahtarı; "" = genel). Oturum başına son seçim hatırlanır.
  const [project, setProject] = useState("");
  const { list: namespaces } = useNamespaces(open);
  const known = useMemo(() => knownProjectKeys(namespaces), [namespaces]);
  const ns = toNamespace(project, known);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recall, setRecall] = useState<{ items: { id: string; type: string; label: string; agent?: string }[] } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    // yedekteki ajan önceden seçilmez; kadro değişimi (yedekle değiştir) sonrası liste de tazelenir
    const pick = pickComposerAgent(agents, preset);
    setAgent(pick.slug);
    setBenchedPreset(pick.presetBenched ? (agents.find((a) => a.slug === preset)?.name ?? preset ?? null) : null);
    void useStudio.getState().refreshAgents().catch(() => undefined);
    setWho("");
    setError(null);
    setExpected("");
    setOverride("agent");
    setProject(getLastProject());
    // W3: yürüme modundan çıktı teslimi metni ön doldurur (kullanıcı düzenleyip gönderir; kendiliğinden gönderilmez)
    if (presetPrompt) setPrompt(presetPrompt);
    setTimeout(() => textRef.current?.focus(), 50);
  }, [open, preset, presetPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

  // pencere açıkken seçili ajan yedeğe alınırsa (ya da tazelenen listede yedekte çıkarsa) etkin ajana geç
  useEffect(() => {
    if (!open || !agent) return;
    const cur = agents.find((a) => a.slug === agent);
    if (!cur || isBenched(cur)) setAgent(pickComposerAgent(agents, null, agent).slug);
  }, [open, agents, agent]);

  useEffect(() => {
    if (!open || !memory || !ns || prompt.trim().length < 6) { setRecall(null); return; }
    const id = window.setTimeout(() => {
      memoryApi.recall(prompt, agent || undefined, ns).then(setRecall).catch(() => setRecall(null));
    }, 450);
    return () => window.clearTimeout(id);
  }, [prompt, agent, memory, open, ns]);

  const current = agents.find((a) => a.slug === agent);
  const localModels = useMemo(() => models.filter((m) => m.local && decide(policy, "ollama", m.name, { ollamaRemote: false }).allowed), [models, policy]);
  // CG-COST: Gönder'den önce süre/jeton/maliyet öngörüsü ve isteğe bağlı bütçe tavanı (öngörü üst sınırı ×1,5)
  const [cap, setCap] = useState<CapState>({ enabled: false, cap: { tokens: null, cost_usd: null, on_exceeded: "ask" } });
  const chosenModel = override === "ollama" ? model || localModels[0]?.name
    : override === "openai_compat" && ep ? modelRef(ep.id, model && epModels.includes(model) ? model : ep.model) : undefined;
  const estSpec = useMemo<EstimateSpec | null>(() => (open && agent ? {
    kind: "task", agent, prompt: prompt.trim().slice(0, 8000),
    ...(override === "agent" ? {} : { connection: override }), ...(chosenModel ? { model: chosenModel } : {}),
  } : null), [open, agent, prompt, override, chosenModel]);

  const submit = async () => {
    if (!agent || !prompt.trim() || !ns) return;
    if (override === "openai_compat" && ep && !(await ensure(dec("openai_compat", modelRef(ep.id, model && epModels.includes(model) ? model : ep.model))))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await memoryApi.createTask({
        agent, prompt, memory, remember,
        ...(expected.trim() ? { expected_output: expected.trim().slice(0, 1000) } : {}),
        ...(zone !== "office" ? { work_zone: zone } : {}),
        connection: override === "agent" ? undefined : override,
        model: override === "ollama" ? model || localModels[0]?.name
          : override === "openai_compat" && ep ? modelRef(ep.id, model && epModels.includes(model) ? model : ep.model) : undefined,
        project: ns === "global" ? undefined : ns,
        // CG-COST: tavan koşuyla birlikte verilir (koşu ilk jetondan önce sınırlı; sonradan PATCH yarışı yok)
        ...(cap.enabled && (cap.cap.tokens || cap.cap.cost_usd) ? { budget: {
          on_exceeded: cap.cap.on_exceeded,
          ...(cap.cap.tokens ? { tokens: cap.cap.tokens } : {}), ...(cap.cap.cost_usd ? { cost_usd: cap.cap.cost_usd } : {}),
        } } : {}),
        // FIX-UX: yürüme modundan açılan pencere kökeni bildirir; sunucu `run_started`ı yalnızca origin "ui" koşuda sayar
        ...(onStarted ? { origin: "ui" as const } : {}),
      });
      setLastProject(project.trim().toLowerCase());
      setPrompt("");
      setExpected("");
      // FIX-UX: açan yer (yürüme modu kahve noktası) koşu kimliğini alır; hata görev akışını etkilemez
      try { onStarted?.(res.run_id); } catch { /* yok say */ }
      close();
      navigate(`/gorevler/${res.run_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitReason = busy ? null : !agent ? t("composer_need_agent") : !prompt.trim() ? t("composer_need_prompt") : null;

  return (
    <>
    {dialog}
    <Modal open={open} onClose={close} title={t("composer_title")} width={720}
      footer={<>
        {/* pasif düğmenin nedeni görünür*/}
        {submitReason
          ? <span className="mr-auto text-xs text-ink-2 font-semibold self-center" role="status">{submitReason}</span>
          : <span className="mr-auto text-xs text-muted self-center hidden sm:block">{t("composer_send_hint")}</span>}
        <Button variant="ghost" onClick={close}>{t("cancel")}</Button>
        <Button variant="primary" icon={<Send size={16} />} disabled={busy || !agent || !prompt.trim() || !ns} disabledReason={submitReason} onClick={submit}>
          {busy ? t("sending") : t("composer_submit")}
        </Button>
      </>}>
      <div className="flex flex-col gap-5">
        <Field label={t("composer_to")}>
          {agents.length > 8 && (
            <label className="relative block">
              <span className="sr-only">{t("composer_find")}</span>
              <Search size={14} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input type="search" className="input !pl-8" value={who} placeholder={t("composer_find")}
                onChange={(e) => setWho(e.target.value)} />
            </label>
          )}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {shownAgents.map((a) => {
              const av = agentAvailability(a, conns);
              const benched = isBenched(a);  // yedekteki ajan seçilemez (görev 409 ile reddedilirdi)
              return (
                <button key={a.slug} type="button" aria-pressed={a.slug === agent} disabled={benched}
                  onClick={() => setAgent(a.slug)} title={benched ? t("composer_benched_hint") : undefined}
                  className={clsx("card-select flex items-center gap-2 px-2.5 py-2 min-w-[180px] max-w-[240px] shrink-0",
                    benched && "opacity-60 cursor-not-allowed")}>
                  <PixelFace avatar={a.avatar} mood={agentMood(a, states, conns)} size={38} ring={a.slug === agent ? a.color : undefined} />
                  <span className="min-w-0">
                    <span className="block font-semibold text-sm truncate">{a.name}</span>
                    <span className={clsx("block text-xs truncate", benched || av.ok ? "text-muted" : "text-bad")}>
                      {benched ? t("composer_benched") : av.ok ? a.route?.label : av.reason}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {benchedPreset && (
            <p className="text-sm text-ink-2" role="status">{t("composer_preset_benched", { name: benchedPreset })}</p>
          )}
          {!agent && agents.length > 0 && <p className="text-sm text-ink-2" role="status">{t("composer_no_active")}</p>}
        </Field>

        <Field label={t("composer_what")}>
          <textarea ref={textRef} className="textarea min-h-[130px]" value={prompt} placeholder={t("composer_placeholder")}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(); }} />
        </Field>

        <ExpectedOutputField value={expected} onChange={setExpected} />

        {open && <WorkZonePicker scene={scene} value={zone} onChange={setZone} agent={agent || undefined} />}

        <div className="flex flex-col gap-4">
          <Field label={t("composer_brain")} hint={override === "agent" ? t("composer_agent_setting", { route: current?.route?.label ?? "—" }) : CONNECTION_META[override].desc}>
            <Segmented value={override} onChange={setOverride} options={[
              { value: "agent", label: t("composer_agents_own") },
              { value: "ollama", label: <span className="flex items-center gap-1">{CONN_ICON.ollama}Ollama</span> },
              { value: "codex", label: <span className="flex items-center gap-1">{CONN_ICON.codex}Codex</span>, disabled: !dec("codex").allowed },
              { value: "claude", label: <span className="flex items-center gap-1">{CONN_ICON.claude}Claude</span>, disabled: !dec("claude").allowed },
              ...(okEndpoints.length ? [{ value: "openai_compat" as const, label: <span className="flex items-center gap-1"><Globe size={15} />{CONNECTION_META.openai_compat.short}</span> }] : []),
            ]} />
            {override === "openai_compat" && ep && (
              <div className="grid gap-2 sm:grid-cols-2 mt-2">
                <select className="select" aria-label={tc("bp_endpoint")} value={ep.id} onChange={(e) => { setEndpoint(e.target.value); setModel(""); }}>
                  {endpoints.map((x) => {
                    const blocked = !okEndpoints.includes(x);
                    return <option key={x.id} value={x.id} disabled={blocked}>{x.label}{x.local ? "" : " · " + tc("online_badge")}{blocked ? " · " + tc("blocked_policy") : ""}</option>;
                  })}
                </select>
                <select className="select" aria-label={tc("bp_model")} value={model && epModels.includes(model) ? model : ep.model} onChange={(e) => setModel(e.target.value)}>
                  {epModels.length === 0 && <option value="">{t("default_lower")}</option>}
                  {epModels.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                {ep.ready !== "ok" && ep.problems?.[0] && <p role="status" className="text-xs text-warn sm:col-span-2">{ep.problems[0].message}</p>}
                {!ep.local && <p className="text-xs text-warn sm:col-span-2">{tc("remote_warn", { host: ep.host })}</p>}
              </div>
            )}
            {override === "ollama" && (
              <select className="select mt-2" value={model} onChange={(e) => setModel(e.target.value)}>
                {localModels.map((m) => (
                  <option key={m.name} value={m.name}>{m.name} · {m.parameter_size}{m.hermes_ready ? ` · ${t("hermes_ready")}` : ""}</option>
                ))}
              </select>
            )}
            {/* S29: seçilen beyin hazır değilse nedeni ve tek tık düzeltme burada (görev başlamadan) */}
            {override !== "agent" && override !== "openai_compat" && <NotReadyHint kind={override} className="mt-2" />}
          </Field>
          <TradeoffCard agent={agent} prompt={prompt} picked={override === "agent" ? null : override}
            allowed={(o) => (o.brain === "ollama" ? localModels.length > 0
              : o.brain === "openai_compat" ? okEndpoints.length > 0
              : o.brain === "claude" || o.brain === "codex" ? dec(o.brain).allowed : false)}
            onPick={(o) => {
              if (o.brain === "ollama") { setOverride("ollama"); setModel(o.model && localModels.some((m) => m.name === o.model) ? o.model : ""); }
              else if (o.brain === "claude" || o.brain === "codex" || o.brain === "openai_compat") setOverride(o.brain);
            }} />
          <EstimatePanel spec={estSpec} cap={cap} onCap={setCap}
            onCheaper={(c) => {
              if (c.brain === "ollama") { setOverride("ollama"); setModel(c.model ?? ""); }
              else if (c.brain === "claude" || c.brain === "codex") setOverride(c.brain);
            }} />
          <ProjectField value={project} onChange={setProject} namespaces={namespaces} />
          <div className="grid sm:grid-cols-2 gap-3">
            <Toggle checked={memory} onChange={setMemory} label={t("composer_memory")} hint={t("composer_memory_hint")} />
            <Toggle checked={remember} onChange={setRemember} label={t("composer_remember")} hint={t("composer_remember_hint")} />
          </div>
        </div>

        {memory && recall && (
          <div className="panel-soft p-3">
            <div className="flex items-center gap-2 mb-2 text-sm font-semibold num">
              <Brain size={15} className="text-accent" /> {recall.items.length ? tp(shell, "composer_recall", recall.items.length) : t("composer_recall_none")}
              <Badge className="ml-auto">{tm("recall_in", { ns: nsLabel(ns) })}</Badge>
            </div>
            <ul className="flex flex-col gap-1">
              {recall.items.slice(0, 5).map((i) => (
                <li key={i.id} className="flex items-center gap-2 text-sm">
                  <Badge tone={i.type === "Fact" ? "info" : "warn"}>{i.type === "Fact" ? t("recall_fact") : t("recall_episode")}</Badge>
                  <span className="truncate">{i.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <div className="chip tone-bad !rounded-lg !whitespace-normal !items-start font-medium p-3 text-sm">{error}</div>}
      </div>
    </Modal>
    </>
  );
}
