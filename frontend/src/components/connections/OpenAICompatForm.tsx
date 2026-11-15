// S29 → S37 — Model API'leri: aynı anda birden çok adlandırılmış bağlantı (LM Studio + Mistral + Claude API …).
// Liste → sağlayıcı seç (doğrulanmış ön ayarlar) → anahtar (maskeli; secrets.json) → /models listesinden varsayılan model.
// Teknik olmayan kullanıcı için: her satırda tek durum cümlesi, "Anahtar al" bağlantısı, uzak API'de veri uyarısı.
import clsx from "clsx";
import { ArrowLeft, CheckCircle2, Cloud, ExternalLink, HardDrive, Pencil, Play, Plus, RefreshCcw, Star, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  connectionsApi, endpointModels, publishOne, refreshConnections, type ConnectionState, type Endpoint, type EndpointApi, type Preset,
  type TestResult,
} from "../../lib/connections";
import { fmtNumber, useT } from "../../lib/i18n";
import { cx } from "../../locales/connections";
import { Badge, Button, Field, Modal, Segmented, Spinner, Toggle } from "../ui";

type Mode = { kind: "list" } | { kind: "pick" } | { kind: "edit"; id?: string; preset?: Preset; custom?: boolean; base_url?: string; label?: string };

const READY_TONE: Record<string, string> = { ok: "ok", needs_action: "warn", unavailable: "muted", checking: "info", soon: "muted" };

export function OpenAICompatForm({ state, initial, onDone }: { state?: ConnectionState; initial?: Record<string, unknown>; onDone?: () => void }) {
  const t = useT(cx);
  const endpoints = state?.extra.endpoints ?? [];
  const [presets, setPresets] = useState<Preset[]>([]);
  const [mode, setMode] = useState<Mode>(() => {
    if (initial?.add) return { kind: "pick" };
    if (initial?.endpoint) return { kind: "edit", id: String(initial.endpoint) };
    if (initial?.base_url) return { kind: "edit", custom: true, base_url: String(initial.base_url), label: String(initial.label ?? "") };
    return endpoints.length ? { kind: "list" } : { kind: "pick" };
  });
  useEffect(() => { connectionsApi.presets().then(setPresets).catch(() => setPresets([])); }, []);
  // keşfedilen yerel sunucu için ön ayarı eşle (LM Studio, Jan…)
  useEffect(() => {
    if (mode.kind === "edit" && mode.custom && mode.base_url && presets.length) {
      const p = presets.find((x) => x.base_url && x.base_url.replace("localhost", "127.0.0.1") === mode.base_url?.replace(/\/$/, "").replace("localhost", "127.0.0.1"));
      if (p) setMode({ kind: "edit", preset: p });
    }
  }, [mode, presets]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2">{t("compat_intro")}</p>
      {state?.extra.discovered?.length && mode.kind === "list" ? (
        <div role="status" className="chip tone-info !rounded-lg !whitespace-normal p-2 text-sm flex flex-wrap items-center gap-2">
          <span className="flex-1 min-w-[10rem]">{t("compat_discovered", { label: state.extra.discovered[0].label })}</span>
          <Button size="sm" onClick={() => setMode({ kind: "edit", custom: true, base_url: state.extra.discovered![0].base_url, label: state.extra.discovered![0].label })}>{t("compat_use")}</Button>
        </div>
      ) : null}
      {mode.kind === "list" && <EndpointList endpoints={endpoints} onEdit={(id) => setMode({ kind: "edit", id })} onAdd={() => setMode({ kind: "pick" })} />}
      {mode.kind === "pick" && (
        <PresetPicker presets={presets} onBack={endpoints.length ? () => setMode({ kind: "list" }) : undefined}
          onPick={(p) => setMode(p ? { kind: "edit", preset: p } : { kind: "edit", custom: true })} />
      )}
      {mode.kind === "edit" && (
        <EndpointEditor key={mode.id ?? mode.preset?.id ?? "custom"} endpoint={endpoints.find((e) => e.id === mode.id)}
          preset={mode.preset ?? presets.find((p) => p.id === endpoints.find((e) => e.id === mode.id)?.preset)}
          initialUrl={mode.base_url} initialLabel={mode.label} first={!endpoints.length}
          onSaved={(id) => setMode({ kind: "edit", id })} onBack={() => setMode(endpoints.length ? { kind: "list" } : { kind: "pick" })} onDone={onDone} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ liste
function EndpointList({ endpoints, onEdit, onAdd }: { endpoints: Endpoint[]; onEdit: (id: string) => void; onAdd: () => void }) {
  const t = useT(cx);
  const [busy, setBusy] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [confirm, setConfirm] = useState<Endpoint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (key: string, fn: () => Promise<{ state: ConnectionState } | void>) => {
    setBusy(key); setError(null);
    try { const res = await fn(); if (res && "state" in res) publishOne(res.state); await refreshConnections(false); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const test = (ep: Endpoint) => act(`test:${ep.id}`, async () => {
    const res = await connectionsApi.test("openai_compat", { endpoint: ep.id });
    setTests((x) => ({ ...x, [ep.id]: res }));
    if (res.state) return { state: res.state };
  });

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2" aria-label={t("ep_list_label")}>
        {endpoints.map((ep) => {
          const problem = ep.problems?.[0];
          const res = tests[ep.id];
          return (
            <li key={ep.id} className="panel-soft p-3 flex flex-col gap-2 min-w-0">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="font-semibold text-sm truncate max-w-full">{ep.label}</span>
                {ep.is_default && <Badge tone="info"><Star size={11} aria-hidden />{t("ep_default")}</Badge>}
                <Badge tone={READY_TONE[ep.ready ?? "checking"]}>
                  {ep.ready === "checking" ? <Spinner size={11} /> : ep.ready === "ok" ? <CheckCircle2 size={11} aria-hidden /> : null}
                  {t(`ready_${ep.ready ?? "checking"}` as "ready_ok")}
                </Badge>
                {ep.local ? <Badge tone="ok"><HardDrive size={11} aria-hidden />{t("ep_local")}</Badge> : <Badge tone="warn"><Cloud size={11} aria-hidden />{t("ep_remote")}</Badge>}
              </div>
              <div className="text-xs text-muted flex flex-wrap gap-x-3 gap-y-1 min-w-0">
                <span className="font-mono truncate max-w-full">{ep.host}</span>
                {ep.model && <span className="font-mono truncate max-w-full">{ep.model}</span>}
                {ep.api_key_masked && <span>{t("key_badge", { k: ep.api_key_masked })}</span>}
                {(ep.models_live ?? ep.models).length > 0 && <span className="num">{t("ep_models_n", { n: (ep.models_live ?? ep.models).length })}</span>}
              </div>
              {problem && <p className={clsx("text-sm", problem.severity === "block" ? "text-warn" : "text-ink-2")}>{problem.message}</p>}
              {res && (
                <div role="status" className={clsx("rounded-lg border-2 p-2 text-xs break-words", res.ok ? "tone-ok" : "tone-bad")}>
                  <b>{res.ok ? t("test_ok") : t("test_fail")}</b><span className="num">{res.ms ? ` · ${fmtNumber(res.ms / 1000, { maximumFractionDigits: 1 })} s` : ""}</span>
                  <div className="mt-0.5">{res.error || res.text}</div>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" icon={busy === `test:${ep.id}` ? <Spinner size={12} /> : <Play size={12} />} disabled={!!busy} onClick={() => test(ep)}>
                  {busy === `test:${ep.id}` ? t("testing") : t("test")}
                </Button>
                <Button size="sm" variant="ghost" icon={<Pencil size={12} />} disabled={!!busy} onClick={() => onEdit(ep.id)}>{t("ep_edit")}</Button>
                {!ep.is_default && (
                  <Button size="sm" variant="ghost" icon={<Star size={12} />} disabled={!!busy} onClick={() => act(`def:${ep.id}`, () => connectionsApi.defaultEndpoint(ep.id))}>{t("ep_make_default")}</Button>
                )}
                <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} disabled={!!busy} onClick={() => setConfirm(ep)}>{t("ep_delete")}</Button>
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div><Button variant="primary" icon={<Plus size={14} />} onClick={onAdd}>{t("ep_add")}</Button></div>
      {confirm && (
        <Modal open onClose={() => setConfirm(null)} title={t("ep_delete")} width={460}
          footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>{t("cancel")}</Button>
            <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => { const ep = confirm; setConfirm(null); void act(`del:${ep.id}`, () => connectionsApi.deleteEndpoint(ep.id)); }}>{t("ep_delete_yes")}</Button></>}>
          <p className="text-sm text-ink-2">{t("ep_delete_confirm", { label: confirm.label })}</p>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ön ayar seçimi
function PresetPicker({ presets, onPick, onBack }: { presets: Preset[]; onPick: (p: Preset | null) => void; onBack?: () => void }) {
  const t = useT(cx);
  const groups = useMemo(() => (["local", "cloud"] as const).map((g) => ({ g, items: presets.filter((p) => p.group === g) })), [presets]);
  if (!presets.length) return <div className="py-4 grid place-items-center"><Spinner /></div>;
  return (
    <div className="flex flex-col gap-4">
      {onBack && <div><Button size="sm" variant="ghost" icon={<ArrowLeft size={14} />} onClick={onBack}>{t("ep_back")}</Button></div>}
      {groups.map(({ g, items }) => (
        <section key={g} className="flex flex-col gap-2" aria-labelledby={`preset-${g}`}>
          <h4 id={`preset-${g}`} className="panel-title flex items-center gap-1.5">
            {g === "local" ? <HardDrive size={15} aria-hidden /> : <Cloud size={15} aria-hidden />}{items[0]?.group_label}
          </h4>
          <ul className="grid gap-2 sm:grid-cols-2">
            {items.map((p) => (
              <li key={p.id} className="min-w-0 flex">
                <button type="button" disabled={!p.supported} onClick={() => onPick(p)}
                  className="card-select p-2.5 flex-1 min-w-0 flex flex-col items-start gap-1 text-left disabled:opacity-60 disabled:cursor-not-allowed">
                  <span className="flex items-center gap-1.5 w-full min-w-0">
                    <span className="font-semibold text-sm truncate">{p.label}</span>
                    {!p.supported && <Badge tone="muted" className="ml-auto shrink-0">{t("ep_unsupported")}</Badge>}
                  </span>
                  {p.base_url && <span className="font-mono text-xs text-muted truncate max-w-full">{p.base_url}</span>}
                  {p.note && <span className="text-xs text-ink-2">{p.note}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => onPick(null)}>{t("ep_custom")}</Button>
        <span className="text-xs text-muted">{t("ep_custom_hint")}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ ekle / düzenle
function EndpointEditor({ endpoint, preset, initialUrl, initialLabel, first, onSaved, onBack, onDone }: {
  endpoint?: Endpoint; preset?: Preset; initialUrl?: string; initialLabel?: string; first: boolean;
  onSaved: (id: string) => void; onBack: () => void; onDone?: () => void;
}) {
  const t = useT(cx);
  const [label, setLabel] = useState(endpoint?.label ?? initialLabel ?? preset?.label ?? "");
  const [baseUrl, setBaseUrl] = useState(endpoint?.base_url ?? initialUrl ?? preset?.base_url ?? "");
  const [api, setApi] = useState<EndpointApi>(endpoint?.api ?? preset?.api ?? "openai");
  const [model, setModel] = useState(endpoint?.model ?? "");
  // araç çağrısı; ön ayar "no" ise kapalı başlar, kullanıcı uç nokta başına kapatabilir
  const presetTools = preset?.tools ?? "try";
  const [tools, setTools] = useState<boolean>(endpoint ? endpoint.tools_mode !== "no" : presetTools !== "no");
  const toolsMode = !tools ? "no" : endpoint?.tools_mode && endpoint.tools_mode !== "no" ? endpoint.tools_mode : presetTools === "no" ? "try" : presetTools;
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [live, setLive] = useState<string[] | null>(null);
  const keyRequired = endpoint?.key_required ?? (preset?.key === "required");
  const keyOptional = !keyRequired && preset?.key !== "none";
  const remote = endpoint ? !endpoint.local : preset ? !preset.local : !/^https?:\/\/(127\.|localhost|\[::1\])/.test(baseUrl);
  const models = useMemo(() => [...new Set([...(live ?? []), ...endpointModels(endpoint), ...(preset?.suggested_models ?? [])])], [live, endpoint, preset]);
  const problem = endpoint?.problems?.[0];

  const refreshModels = async (id: string) => {
    try { const r = await connectionsApi.endpointModels(id); setLive(r.models); } catch { setLive(null); }
  };
  useEffect(() => { if (endpoint?.id && endpoint.ready === "ok") void refreshModels(endpoint.id); }, [endpoint?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy("save"); setError(null); setSaved(false);
    try {
      const body: Parameters<typeof connectionsApi.addEndpoint>[0] = { label: label.trim(), base_url: baseUrl.trim(), model: model.trim(), api,
        tools: tools ? (presetTools === "no" ? true : null) : false };
      if (clearKey) body.api_key = null; else if (key.trim()) body.api_key = key.trim();
      const res = endpoint
        ? await connectionsApi.updateEndpoint(endpoint.id, body)
        : await connectionsApi.addEndpoint({ ...body, preset: preset?.id, make_default: first });
      publishOne(res.state);
      setKey(""); setClearKey(false); setSaved(true);
      await refreshConnections(false);
      onSaved(res.endpoint.id);
      if (res.endpoint.ready === "ok" && res.endpoint.model && endpoint) onDone?.();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} />} onClick={onBack}>{t("ep_back")}</Button>
        <h4 className="panel-title truncate">{endpoint?.label ?? preset?.label ?? t("ep_custom")}</h4>
        {remote ? <Badge tone="warn"><Cloud size={11} aria-hidden />{t("ep_remote")}</Badge> : <Badge tone="ok"><HardDrive size={11} aria-hidden />{t("ep_local")}</Badge>}
      </div>
      {preset?.note && <p className="text-sm text-ink-2">{preset.note}</p>}
      {preset && (
        <p className="text-xs text-muted flex flex-wrap gap-x-2">
          <span>{t("ep_verified", { date: preset.verified })}</span>
          <a className="underline inline-flex items-center gap-0.5" href={preset.docs} target="_blank" rel="noopener noreferrer">{t("ep_docs")}<ExternalLink size={11} aria-hidden /></a>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("compat_label")}><input className="input" aria-label={t("compat_label")} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} /></Field>
        {!preset && (
          <Field label={t("ep_api_kind")}>
            <Segmented value={api} onChange={setApi} options={[{ value: "openai", label: t("ep_api_openai") }, { value: "anthropic", label: t("ep_api_anthropic") }]} />
          </Field>
        )}
        <Field label={t("compat_base_url")} className="sm:col-span-2">
          <input className="input font-mono !text-xs" aria-label={t("compat_base_url")} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:1234/v1" />
        </Field>
        {(keyRequired || keyOptional || endpoint?.has_key) && (
          <Field label={keyRequired ? t("ep_key_required_label") : t("compat_key")} className="sm:col-span-2"
            hint={endpoint?.has_key && !clearKey ? t("compat_key_keep", { masked: endpoint.api_key_masked ?? "••••" }) : keyRequired ? t("ep_key_needed") : undefined}>
            <div className="flex flex-wrap gap-2">
              <input className="input font-mono !text-xs flex-1 min-w-[10rem]" aria-label={keyRequired ? t("ep_key_required_label") : t("compat_key")} type="password" autoComplete="off"
                value={key} onChange={(e) => setKey(e.target.value)} disabled={clearKey} />
              {(endpoint?.key_url ?? preset?.key_url) && (
                <a className="btn btn-sm inline-flex items-center gap-1" href={endpoint?.key_url ?? preset?.key_url} target="_blank" rel="noopener noreferrer">
                  {t("ep_get_key")}<ExternalLink size={12} aria-hidden />
                </a>
              )}
              {endpoint?.has_key && <Button size="sm" variant="ghost" aria-pressed={clearKey} onClick={() => setClearKey((v) => !v)}>{t("compat_key_clear")}</Button>}
            </div>
          </Field>
        )}
        {(endpoint || models.length > 0) && (
          <Field label={t("ep_model_pick")} className="sm:col-span-2" hint={endpoint && !models.length ? t("ep_model_none") : t("bp_model_hint")}>
            <div className="flex flex-wrap gap-2">
              <input className="input font-mono !text-xs flex-1 min-w-[10rem]" aria-label={t("ep_model_pick")} list={`ep-models-${endpoint?.id ?? "new"}`}
                value={model} onChange={(e) => setModel(e.target.value)} />
              <datalist id={`ep-models-${endpoint?.id ?? "new"}`}>{models.map((m) => <option key={m} value={m} />)}</datalist>
              {endpoint && <Button size="sm" variant="ghost" icon={<RefreshCcw size={12} />} onClick={() => refreshModels(endpoint.id)}>{t("ep_models_refresh")}</Button>}
            </div>
            {models.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5" role="group" aria-label={t("ep_model_pick")}>
                {models.slice(0, 12).map((m) => (
                  <button key={m} type="button" className="chip font-mono !text-xs hover:border-ink-2 max-w-full" aria-pressed={model === m} onClick={() => setModel(m)}>
                    <span className="truncate">{m}</span>
                  </button>
                ))}
              </div>
            )}
          </Field>
        )}
      </div>
      <Toggle checked={tools} onChange={setTools} label={t("ep_tools")}
        hint={toolsMode === "yes" ? t("ep_tools_yes") : toolsMode === "try" ? t("ep_tools_try") : t("ep_tools_no")} />
      {remote && <p className="text-xs text-warn">{t("remote_warn", { host: endpoint?.host ?? (baseUrl.replace(/^https?:\/\//, "").split("/")[0] || "?") })}</p>}
      {problem && <p role="status" className={clsx("text-sm", problem.severity === "block" ? "text-warn" : "text-ink-2")}>{problem.message}</p>}
      {saved && !problem && endpoint?.ready === "ok" && <p role="status" className="text-sm text-ok">{t("ep_saved")}</p>}
      {error && <p role="alert" className="text-sm text-bad break-words">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={!!busy || !baseUrl.trim() || (keyRequired && !endpoint?.has_key && !key.trim())}
          icon={busy === "save" ? <Spinner size={14} /> : undefined} onClick={save}>
          {endpoint ? t("ep_save") : t("ep_save_add")}
        </Button>
      </div>
    </div>
  );
}
