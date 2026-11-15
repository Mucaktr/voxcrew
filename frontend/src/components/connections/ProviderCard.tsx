// S29 — sağlayıcı kartı: durum kontrol listesi (kurulu / çalışıyor / oturum / model) + TEK birincil eylem + "Ayrıntılar".
import clsx from "clsx";
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight, Circle, Copy, Cpu, ExternalLink, Feather, HelpCircle, Play,
  Server, Sparkles, Star, Terminal, X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { checklist, PROVIDER_COLOR, type CheckKey, type ConnectionState, type Fix, type TestResult } from "../../lib/connections";
import { timeAgo } from "../../lib/format";
import { fmtNumber, useT } from "../../lib/i18n";
import { cx } from "../../locales/connections";
import { Badge, Button, DetailDrawer, Spinner } from "../ui";
import { primaryFix } from "./actions";

const ICON: Record<ConnectionState["kind"], ReactNode> = {
  hermes: <Feather size={18} />, ollama: <Cpu size={18} />, codex: <Sparkles size={18} />, claude: <Terminal size={18} />,
  openai_compat: <Server size={18} />, gemini: <Sparkles size={18} />,
};
const READY_TONE: Record<ConnectionState["ready"], string> = { ok: "ok", needs_action: "warn", unavailable: "muted", checking: "info", soon: "muted" };
const CHECK_LABEL: Record<CheckKey, "check_installed" | "check_running" | "check_session" | "check_models"> = {
  installed: "check_installed", running: "check_running", session: "check_session", models: "check_models",
};

function CheckChip({ value, label }: { value: boolean | null; label: string }) {
  const t = useT(cx);
  const state = value === true ? "ok" : value === false ? "bad" : "unknown";
  return (
    <span className={clsx("chip !gap-1", state === "ok" ? "tone-ok" : state === "bad" ? "tone-bad" : "tone-muted")}
      title={state === "unknown" ? t("unknown") : undefined}>
      {state === "ok" ? <Check size={12} aria-hidden /> : state === "bad" ? <X size={12} aria-hidden /> : <Circle size={10} aria-hidden />}
      {label}
      <span className="sr-only">: {state === "ok" ? "✓" : state === "bad" ? "✗" : t("unknown")}</span>
    </span>
  );
}

function CopyChip({ text }: { text: string }) {
  const t = useT(cx);
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="chip font-mono !text-xs hover:border-ink-2 max-w-full" title={t("copy")}
      onClick={() => { navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); }).catch(() => undefined); }}>
      <span className="truncate">{text}</span>{ok ? <CheckCircle2 size={12} className="text-ok" /> : <Copy size={12} />}
    </button>
  );
}

type CardProps = {
  c: ConnectionState;
  onAction: (c: ConnectionState, fix: Fix | null | undefined, action?: string) => void;
  busy: string | null;
  test?: TestResult;
  feedback?: { kind: "ok" | "warn" | "bad" | "info"; text: string } | null;
  compact?: boolean;
};

function Header({ c, quiet }: { c: ConnectionState; quiet?: boolean }) {
  const t = useT(cx);
  const readyLabel = t(`ready_${c.ready}` as "ready_ok");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
      <span className="h-10 w-10 rounded-lg grid place-items-center text-white border-2 border-line shrink-0" style={{ background: PROVIDER_COLOR[c.kind] }} aria-hidden>
        {ICON[c.kind]}
      </span>
      <div className="min-w-32 flex-1">
        <h3 className="panel-title flex flex-wrap items-baseline gap-x-1.5 min-w-0"><span className="truncate min-w-0">{c.name}</span>
          {c.optional && <span className="text-xs font-normal text-muted whitespace-nowrap">· {t("optional")}</span>}
        </h3>
        {!quiet && <p className="text-xs text-muted truncate">{c.subtitle}</p>}
      </div>
      <StatusChip c={c} label={readyLabel} />
    </div>
  );
}

export function StatusChip({ c, label }: { c: ConnectionState; label?: string }) {
  const t = useT(cx);
  return (
    <Badge tone={READY_TONE[c.ready]} className="shrink-0">
      {c.ready === "checking" || c.checking ? <Spinner size={12} /> : c.ready === "ok" ? <CheckCircle2 size={12} aria-hidden /> : c.ready === "needs_action" ? <AlertTriangle size={12} aria-hidden /> : null}
      {/* UXF-A: arka plan yeniden denetiminde bilinen durum kalır ("Kontrol ediliyor…" ✓ işaretleriyle çelişmesin)*/}
      {label ?? t(`ready_${c.ready}` as "ready_ok")}{c.checking && c.ready !== "checking" && <span className="sr-only"> · {t("ready_checking")}</span>}
    </Badge>
  );
}

export function providerIcon(kind: ConnectionState["kind"]): ReactNode { return ICON[kind]; }

/** Kartın tüm ayrıntısı (kontrol listesi, uç noktalar, eylemler, sonuçlar, "Ayrıntılar"). Tam kartta ve ayrıntı çekmecesinde aynıdır. */
function ProviderBody({ c, onAction, busy, test, feedback, compact, defaultOpen }: CardProps & { defaultOpen?: boolean }) {
  const t = useT(cx);
  const [open, setOpen] = useState(!!defaultOpen);
  const primary = primaryFix(c);
  const isBusy = (action: string) => busy === `${c.kind}:${action}`;
  // UXF-A: kurulum sihirbazında (compact) isteğe bağlı araç hazır değilse kartın önünde teknik ileti (ortam değişkeni,
  // klasör yolu…) yerine "isteğe bağlı — şimdilik geç" durur; teknik ileti ve onarımı "Ayrıntılar" altında kalır
  const optionalQuiet = !!compact && c.optional && c.ready !== "ok" && c.ready !== "checking" && c.problems.length > 0;
  const secondary = c.problems.filter((p) => (p.fix && p.fix !== primary?.fix) || (optionalQuiet && p === c.problems[0]));
  const hint = c.kind === "ollama" ? t("test_hint_ollama") : c.kind === "hermes" ? t("test_hint_hermes") : c.kind === "codex" || c.kind === "claude" ? t("test_hint_sub") : "";
  // BRAINS-LIVE: Hermes testi seçili profille (varsayılan profil bu bilgisayarda olmayan bir bulut modeline bağlı olabilir)
  const profileRows = c.kind === "hermes" ? c.extra.profile_models ?? [] : [];
  const [testProfile, setTestProfile] = useState<string>("");
  const chosenProfile = testProfile || c.extra.test_profile || "default";

  return (
    <div className="flex flex-col gap-3 flex-1 min-w-0">
      {c.ready !== "soon" && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("details")}>
          {checklist(c).map((row) => <li key={row.key}><CheckChip value={row.value} label={t(row.value === false ? `${CHECK_LABEL[row.key]}_no` as const : CHECK_LABEL[row.key])} /></li>)}
        </ul>
      )}

      {c.kind === "openai_compat" && (c.extra.endpoints?.length ?? 0) > 0 && (
        <ul className="flex flex-col gap-1" aria-label={t("ep_list_label")}>
          {c.extra.endpoints!.slice(0, 4).map((ep) => (
            <li key={ep.id} className="flex items-center gap-2 text-xs min-w-0">
              <span aria-hidden className={clsx("h-2 w-2 rounded-sm shrink-0", ep.ready === "ok" ? "bg-grass" : ep.ready === "checking" ? "bg-panel-3" : "bg-gold")} />
              <span className="font-semibold truncate">{ep.label}</span>
              {ep.is_default && <Star size={11} aria-label={t("ep_default")} className="text-gold shrink-0" />}
              <span className="text-muted truncate">{ep.problems?.[0]?.message ?? (ep.model || ep.host)}</span>
              <span className="sr-only">{t(`ready_${ep.ready ?? "checking"}` as "ready_ok")}</span>
            </li>
          ))}
          {c.extra.endpoints!.length > 4 && <li className="text-xs text-muted">{t("ep_more", { n: c.extra.endpoints!.length - 4 })}</li>}
        </ul>
      )}

      <p className="text-sm text-ink-2 leading-snug break-words min-w-0">
        {optionalQuiet ? t("optional_skip") : c.problems[0]?.message ?? c.fit_for_task}
        {c.timeout && <span className="block text-xs text-warn mt-0.5">{t("timeout_note")}</span>}
      </p>

      {primary && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={primary.fix && primary.fix.kind === "button" ? "primary" : "default"}
            icon={isBusy(primary.action) ? <Spinner size={13} /> : primary.fix?.kind === "link" ? <ExternalLink size={13} /> : primary.fix?.kind === "command" ? <Copy size={13} /> : <Play size={13} />}
            disabled={!!busy} onClick={() => onAction(c, primary.fix ?? (c.kind === "hermes" && profileRows.length
              ? { kind: "button", label: primary.label, action: primary.action, args: { profile: chosenProfile } } : primary.fix), primary.action)}>
            {isBusy(primary.action) && primary.action.endsWith(".test") ? t("testing") : primary.label}
          </Button>
          {!primary.fix && profileRows.length > 1 && (
            <select className="select !w-auto max-w-full min-w-0 text-xs" aria-label={t("test_profile_label")} value={chosenProfile}
              disabled={!!busy} onChange={(e) => setTestProfile(e.target.value)}>
              {profileRows.map((r) => (
                <option key={r.profile} value={r.profile}>
                  {t("test_profile_opt", { p: r.profile, m: r.model || r.provider })}{r.cloud ? ` (${t("test_profile_cloud")})` : ""}
                </option>
              ))}
            </select>
          )}
          {!primary.fix && hint && <span className="text-xs text-muted">{hint}</span>}
          {c.kind === "openai_compat" && primary.action !== "openai_compat.pick" && (
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => onAction(c, { kind: "button", label: t("ep_add"), action: "openai_compat.pick", args: { add: true } })}>{t("ep_add")}</Button>
          )}
          {primary.fix && c.ready !== "ok" && c.installed && c.kind !== "gemini" && (
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => onAction(c, null, `${c.kind}.test`)}
              icon={isBusy(`${c.kind}.test`) ? <Spinner size={13} /> : undefined}>{t("test")}</Button>
          )}
        </div>
      )}

      {feedback && (
        <div role="status" className={clsx("rounded-lg border-2 px-2.5 py-1.5 text-xs break-words", `tone-${feedback.kind}`)}>{feedback.text}</div>
      )}
      {test && (
        <div role="status" className={clsx("rounded-lg border-2 p-2.5 text-sm", test.ok ? "tone-ok" : "tone-bad")}>
          <b>{test.ok ? t("test_ok") : t("test_fail")}</b><span className="num">{test.ms ? ` · ${fmtNumber(test.ms / 1000, { maximumFractionDigits: 1 })} s` : ""}</span>
          {(test.profile || test.model) && <span className="text-xs break-all"> · {[test.profile, test.model].filter(Boolean).join(" › ")}</span>}
          <div className="mt-1 break-words">{test.error || test.text}</div>
        </div>
      )}

      <button type="button" className={clsx("flex items-center gap-1 text-xs font-semibold text-muted self-start", !defaultOpen && "mt-auto")} aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}{open ? t("hide_details") : t("details")}
      </button>
      {open && (
        <div className="flex flex-col gap-2 text-xs text-ink-2">
          <div className="flex flex-wrap gap-1.5">
            {c.version && <Badge>{t("version", { v: c.version })}</Badge>}
            {c.last_check && <Badge title={new Date(c.last_check * 1000).toLocaleString()}>{t("last_check", { ago: timeAgo(c.last_check * 1000) })}</Badge>}
            {c.kind === "ollama" && c.extra.managed && <Badge tone="info">{t("ollama_managed")}</Badge>}
            {c.kind === "hermes" && (c.extra.profiles ?? []).map((p) => <Badge key={p} tone="info">{t("profile_badge", { p })}</Badge>)}
            {c.models_ready && <Badge>{t("models_badge", { n: c.models_ready.count })}</Badge>}
            {c.models_ready?.hermes_ready?.length ? <Badge tone="info">{t("ctx_hermes_ok")}: {c.models_ready.hermes_ready.length}</Badge> : null}
            {c.kind === "codex" && typeof c.extra.default_model === "string" && <Badge>{c.extra.default_model}</Badge>}
            {c.kind === "openai_compat" && c.extra.config?.api_key_masked && <Badge>{t("key_badge", { k: c.extra.config.api_key_masked })}</Badge>}
          </div>
          {c.install_path && <CopyChip text={c.install_path} />}
          {c.kind === "ollama" && c.extra.url && <div>{t("ollama_url")}: <span className="font-mono">{c.extra.url}</span></div>}
          {c.last_use && (
            <div className={clsx("rounded-lg border-2 px-2.5 py-1.5", c.last_use.ok ? "tone-ok" : "tone-bad")}>
              <b>{c.last_use.ok ? t("last_use_ok") : t("last_use_fail")}</b> · <span className="num">{timeAgo(c.last_use.ts * 1000)}</span>
              {!c.last_use.ok && c.last_use.error && <div className="mt-0.5 break-words">{c.last_use.error}</div>}
            </div>
          )}
          {c.warning && <div className="chip tone-warn !rounded-lg !whitespace-normal !items-start p-2"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{c.warning}</div>}
          {secondary.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {secondary.map((p) => (
                <li key={p.code} className="flex flex-wrap items-center gap-2">
                  <HelpCircle size={13} className="shrink-0 text-muted" aria-hidden />
                  <span className="flex-1 min-w-[12rem] [overflow-wrap:anywhere]">{p.message}</span>
                  {p.fix && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => onAction(c, p.fix)}>{p.fix.label}</Button>}
                </li>
              ))}
            </ul>
          )}
          {c.kind === "ollama" && c.extra.managed && (
            <Button size="sm" variant="ghost" className="self-start" disabled={!!busy} onClick={() => onAction(c, null, "ollama.stop")}>{t("stop")}</Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Tam kart: üst şerit + tüm ayrıntı (kurulum sihirbazı ve Hermes sayfası). Satırdaki kartlar eşit yükseklikte durur (`h-full`). */
export function ProviderCard(p: CardProps) {
  return (
    <section className={clsx("panel flex flex-col gap-3 min-w-0 h-full", p.compact ? "p-3" : "p-4")} aria-label={p.c.name}>
      <Header c={p.c} />
      <ProviderBody {...p} />
    </section>
  );
}

/** UI-CLARITY: özet kart — simge, ad, durum, tek satır amaç, birincil eylem ve "Ayrıntılar" (çekmece). Altlık hep kartın dibinde. */
export function ProviderSummaryCard({ c, onAction, busy, test, feedback, onOpen }: CardProps & { onOpen: () => void }) {
  const t = useT(cx);
  const primary = primaryFix(c);
  const isBusy = !!primary && busy === `${c.kind}:${primary.action}`;
  const profile = c.kind === "hermes" && (c.extra.profile_models ?? []).length ? c.extra.test_profile || "default" : null;
  const note = feedback?.text ?? (test ? (test.ok ? t("test_ok") : t("test_fail")) : null);
  const noteTone = feedback?.kind ?? (test ? (test.ok ? "ok" : "bad") : "info");
  return (
    <section className="panel flex flex-col gap-3 min-w-0 h-full p-4" aria-label={c.name}>
      <Header c={c} quiet />
      <p className="text-sm text-ink-2 leading-snug line-clamp-2 min-h-[2.5rem]">{c.subtitle}</p>
      {note && <p role="status" className={clsx("chip !rounded-lg !justify-start truncate", `tone-${noteTone}`)} title={note}><span className="truncate">{note}</span></p>}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        {primary && (
          <Button size="sm" variant={primary.fix && primary.fix.kind === "button" ? "primary" : "default"} disabled={!!busy}
            icon={isBusy ? <Spinner size={13} /> : primary.fix?.kind === "link" ? <ExternalLink size={13} /> : primary.fix?.kind === "command" ? <Copy size={13} /> : <Play size={13} />}
            onClick={() => onAction(c, primary.fix ?? (profile ? { kind: "button", label: primary.label, action: primary.action, args: { profile } } : primary.fix), primary.action)}>
            {isBusy && primary.action.endsWith(".test") ? t("testing") : primary.label}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" icon={<ChevronRight size={14} aria-hidden />} onClick={onOpen}
          aria-haspopup="dialog" aria-label={`${t("details")}: ${c.name}`}>{t("details")}</Button>
      </div>
    </section>
  );
}

/** Özet kartın "Ayrıntılar" çekmecesi: durum, kontrol listesi, uç noktalar, eylemler, sınama sonucu. */
export function ProviderDetailDrawer({ c, open, onClose, ...rest }: CardProps & { open: boolean; onClose: () => void }) {
  return (
    <DetailDrawer open={open} onClose={onClose} icon={ICON[c.kind]} title={c.name} subtitle={c.subtitle} status={<StatusChip c={c} />}>
      <ProviderBody c={c} {...rest} defaultOpen />
    </DetailDrawer>
  );
}
