/**
 * Bağlantılar → "Hermes API sunucusu" bölümü (Ekip S2).
 * Profil başına anahtar durumu, tek host gateway'in durumu, etkinleştirme önizlemesi (maskeli diff + yan etkiler)
 * ve elle Başlat/Durdur. Otomatik başlatma yok; her yazma/başlatma açık bir kullanıcı tıklamasıyla olur.
 */
import clsx from "clsx";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Eye, KeyRound, Play, RefreshCcw, ScrollText, Server, Square, Terminal, Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  gatewayApi, type GatewayOverview, type GatewayPreview, type GatewayProfileStatus, type GatewayState, type ProfileGatewayState,
} from "../../lib/gateway";
import { timeAgo } from "../../lib/format";
import { tx, useT } from "../../lib/i18n";
import { gatewayMsg as m } from "../../locales/gateway";
import { Rich } from "../hermes/common";
import { Badge, Button, Modal, Panel, SectionTitle, Spinner } from "../ui";
import { EnableReviewModal } from "./EnableReviewModal";

type MsgKey = keyof typeof m.tr;
/** Durum etiketleri şu anki dilde (getter); modül düzeyinde sabit metin üretilmez. */
const stateMeta = (labelKey: MsgKey, tone: string, hintKey?: MsgKey) => ({
  tone,
  get label() { return tx(m, labelKey); },
  get hint() { return hintKey ? tx(m, hintKey) : ""; },
});

const GATEWAY_STATE: Record<GatewayState, { label: string; tone: string }> = {
  stopped: stateMeta("gw_stopped", "muted"),
  starting: stateMeta("gw_starting", "info"),
  running: stateMeta("gw_running", "ok"),
  external: stateMeta("gw_external", "info"),
  error: stateMeta("gw_error", "bad"),
};

const PROFILE_STATE: Record<ProfileGatewayState, { label: string; tone: string; hint: string }> = {
  unconfigured: stateMeta("ps_unconfigured", "muted", "ps_unconfigured_hint"),
  configured: stateMeta("ps_configured", "info", "ps_configured_hint"),
  starting: stateMeta("gw_starting", "info", "ps_starting_hint"),
  running: stateMeta("gw_running", "ok", "ps_running_hint"),
  external: stateMeta("gw_external", "info", "ps_external_hint"),
  error: stateMeta("gw_error", "bad", "ps_error_hint"),
};

function errText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export function GatewayPanel() {
  const t = useT(m);
  const [ov, setOv] = useState<GatewayOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [preview, setPreview] = useState<GatewayPreview | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "start" | "stop">(null);
  const [confirmStart, setConfirmStart] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const load = useCallback(async (force = false) => {
    try {
      const data = await gatewayApi.overview(force);
      setOv(data);
      setLoadError(null);
      // ilk yüklemede anahtarı olmayan adlandırılmış profilleri önceden seç
      setSelected((cur) => cur ?? new Set(data.profiles.filter((p) => p.profile !== "default" && !p.key_present).map((p) => p.profile)));
    } catch (e) {
      setLoadError(errText(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const state = ov?.gateway.state;
  const transient = state === "starting" || !!ov?.gateway.busy;
  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, transient ? 2000 : 15000);
    return () => window.clearInterval(timer);
  }, [load, transient]);

  const named = useMemo(() => ov?.profiles.filter((p) => p.profile !== "default") ?? [], [ov]);
  const adapters = useMemo(() => [...new Set(ov?.profiles.flatMap((p) => p.adapters) ?? [])], [ov]);
  const anyKey = ov?.profiles.some((p) => p.key_present) ?? false;

  const toggle = (name: string) => setSelected((cur) => {
    const next = new Set(cur ?? []);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const openPreview = async () => {
    setBusy("preview");
    setActionError(null);
    try {
      setPreview(await gatewayApi.preview([...(selected ?? [])]));
    } catch (e) {
      setActionError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    setConfirmStart(false);
    setBusy("start");
    setActionError(null);
    try {
      setOv(await gatewayApi.start());
    } catch (e) {
      setActionError(errText(e));
      void load(true);
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    setBusy("stop");
    setActionError(null);
    try {
      setOv(await gatewayApi.stop());
    } catch (e) {
      setActionError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const g = ov?.gateway;
  const gs = g ? GATEWAY_STATE[g.state] ?? GATEWAY_STATE.stopped : null;

  return (
    <Panel title={t("panel_title")} icon={<Server size={16} />}
      actions={<Button size="sm" variant="ghost" icon={<RefreshCcw size={15} />} aria-label={t("refresh_aria")} onClick={() => load(true)} />}>
      {!ov ? (
        loadError ? (
          <div className="chip tone-bad !rounded-lg !whitespace-normal !items-start font-medium p-3 text-sm">{t("load_failed", { e: loadError })}</div>
        ) : <div className="py-6 grid place-items-center"><Spinner size={20} /></div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-2 max-w-3xl">
            {t("intro")}{" "}
            <button type="button" className="font-semibold text-link inline-flex items-center gap-0.5" onClick={() => setShowHelp((v) => !v)}>
              {showHelp ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{t("cli_vs_api")}
            </button>
          </p>
          {showHelp && <TransportHelp />}

          {/* gateway durumu */}
          <div className="panel-soft p-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-sm">{t("gateway")}</span>
              {gs && <Badge tone={gs.tone}>{g!.state === "starting" && <Spinner size={12} />}{gs.label}</Badge>}
              <Badge>port {g!.port}</Badge>
              {g!.version && <Badge>{t("version", { v: g!.version })}</Badge>}
              {g!.managed && g!.pid && <Badge>pid {g!.pid}</Badge>}
              {g!.managed && g!.started_at && <span className="text-xs text-muted num">{t("started_ago", { ago: timeAgo(g!.started_at) })}</span>}
              <div className="ml-auto flex flex-wrap gap-2">
                {g!.can_stop ? (
                  <Button size="sm" variant="danger" icon={busy === "stop" ? <Spinner size={13} /> : <Square size={13} />}
                    disabled={!!busy} onClick={stop}>{busy === "stop" ? t("stopping") : t("stop")}</Button>
                ) : (
                  <Button size="sm" variant="primary" icon={busy === "start" ? <Spinner size={13} /> : <Play size={13} />}
                    disabled={!!busy || !g!.can_start} title={g!.start_blocker ?? undefined}
                    onClick={() => setConfirmStart(true)}>{busy === "start" ? t("starting") : t("start")}</Button>
                )}
              </div>
            </div>
            <div className="font-mono text-xs text-muted break-all">{g!.url} · {t("local_only")}</div>
            {!g!.can_start && !g!.running && g!.start_blocker && (
              <p className="text-xs text-ink-2 flex items-start gap-1.5"><KeyRound size={13} className="shrink-0 mt-0.5" />{g!.start_blocker}</p>
            )}
            {g!.state === "external" && (
              <p className="text-xs text-ink-2">{t("external_note")}</p>
            )}
            {g!.error && <div className="chip tone-bad !rounded-lg !whitespace-normal !items-start font-medium p-2.5 text-sm"><AlertTriangle size={14} className="shrink-0 mt-[3px]" />{g!.error}</div>}
            <div>
              <button type="button" className="flex items-center gap-1.5 text-xs font-semibold text-muted" onClick={() => setShowLog((v) => !v)}>
                {showLog ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<ScrollText size={13} /> {t("log_toggle")}
              </button>
              {showLog && <LogTail />}
            </div>
          </div>

          {/* profiller */}
          <div className="flex flex-col gap-2">
            <SectionTitle as="h3" size="sm">{t("profiles")}</SectionTitle>
            <ul className="flex flex-col gap-2">
              {ov.profiles.map((p) => (
                <ProfileRow key={p.profile} p={p} checked={p.profile === "default" || !!selected?.has(p.profile)}
                  onToggle={p.profile === "default" ? undefined : () => toggle(p.profile)} />
              ))}
            </ul>
          </div>

          {actionError && <div className="chip tone-bad !rounded-lg !whitespace-normal !items-start font-medium p-3 text-sm">{actionError}</div>}

          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <Button variant="primary" icon={busy === "preview" ? <Spinner size={14} /> : <Eye size={15} />} disabled={!!busy} onClick={openPreview}>
              {t("preview_btn")}
            </Button>
            <span className="text-xs text-muted">
              {t("preview_hint")}
              {named.length > 0 && t("selected", { list: ["default", ...(selected ?? [])].join(", ") })}
            </span>
          </div>
          {!anyKey && (
            <p className="text-xs text-muted flex items-center gap-1.5"><Zap size={13} /> {t("no_key")}</p>
          )}
        </div>
      )}

      {preview && (
        <EnableReviewModal preview={preview} onClose={() => setPreview(null)}
          onApplied={(r) => { setOv(r.status); setSelected(new Set()); }} />
      )}

      {confirmStart && g && (
        <Modal open onClose={() => setConfirmStart(false)} title={t("start_confirm_title")} width={560}
          footer={<>
            <Button variant="ghost" onClick={() => setConfirmStart(false)}>{t("cancel")}</Button>
            <Button variant="primary" icon={<Play size={15} />} onClick={start}>{t("start")}</Button>
          </>}>
          <div className="flex flex-col gap-3 text-sm">
            <div className="panel-soft p-2.5 font-mono text-xs break-all flex items-center gap-2"><Terminal size={14} className="shrink-0" />{g.command}</div>
            <ul className="list-disc pl-5 flex flex-col gap-1">
              <li>{t("sc_child")}</li>
              <li>{t("sc_listen", { port: String(g.port) })}</li>
              <li>{t("sc_cron")}</li>
              <li>{adapters.length ? t("sc_adapters", { list: adapters.join(", ") }) : t("sc_no_adapters")}</li>
              <li>{t("sc_api_bundle")}</li>
            </ul>
          </div>
        </Modal>
      )}
    </Panel>
  );
}

function ProfileRow({ p, checked, onToggle }: { p: GatewayProfileStatus; checked: boolean; onToggle?: () => void }) {
  const t = useT(m);
  const st = PROFILE_STATE[p.state] ?? PROFILE_STATE.unconfigured;
  return (
    <li className="panel-soft p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0">
      <label className={clsx("flex items-center gap-2 min-w-0 sm:w-48 shrink-0", onToggle ? "cursor-pointer" : "cursor-default")}
        title={onToggle ? t("row_include") : t("row_root_title")}>
        <input type="checkbox" aria-label={p.profile} checked={checked} disabled={!onToggle} onChange={() => onToggle?.()} />
        <span className="font-semibold text-sm truncate">{p.profile}</span>
        {!onToggle && <span className="text-xs text-muted">{t("root")}</span>}
      </label>
      <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
        <Badge tone={st.tone} title={st.hint}>{p.state === "running" && <CheckCircle2 size={12} />}{st.label}</Badge>
        <Badge tone={p.key_present ? "ok" : "muted"}><KeyRound size={12} />{p.key_present ? t("key_yes") : t("key_no")}</Badge>
        {p.enabled_in_env && <Badge>API_SERVER_ENABLED</Badge>}
        {p.adapters.map((a) => <Badge key={a} tone="warn" title={t("adapter_title")}>{a}</Badge>)}
      </div>
      <span className="font-mono text-xs text-muted truncate sm:max-w-[45%]" title={p.url}>{p.url}</span>
    </li>
  );
}

function LogTail() {
  const t = useT(m);
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    gatewayApi.logs(200).then((r) => { setLines(r.lines); setError(null); }).catch((e) => setError(errText(e)));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (error) return <p className="text-sm text-bad mt-2">{error}</p>;
  if (!lines) return <div className="mt-2"><Spinner /></div>;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <pre className="font-mono text-xs whitespace-pre-wrap break-all panel-soft p-2 max-h-72 overflow-y-auto">
        {lines.length ? lines.join("\n") : t("log_empty")}
      </pre>
      <Button size="sm" variant="ghost" className="self-start" icon={<RefreshCcw size={13} />} onClick={load}>{t("refresh")}</Button>
    </div>
  );
}

function TransportHelp() {
  const t = useT(m);
  return (
    <div className="grid gap-3 md:grid-cols-2 text-sm">
      <div className="panel-soft p-3 flex flex-col gap-1.5">
        <b className="flex items-center gap-1.5"><Terminal size={15} /> {t("help_cli_title")}</b>
        <span className="text-ink-2"><Rich text={t("help_cli")} parts={{ cmd: <code className="font-mono">hermes chat</code> }} /></span>
      </div>
      <div className="panel-soft p-3 flex flex-col gap-1.5">
        <b className="flex items-center gap-1.5"><Server size={15} /> {t("help_api_title")}</b>
        <span className="text-ink-2"><Rich text={t("help_api")} parts={{ ep: <code className="font-mono">/v1/runs</code> }} /></span>
      </div>
      <p className="md:col-span-2 text-xs text-muted">
        {t("help_auto")}
      </p>
    </div>
  );
}
