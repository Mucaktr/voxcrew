// CG2 — MCP bağlayıcı kataloğu (Bağlantılar sayfası): güvenilirlik ve doğrulama etiketli seçilmiş sunucular, birebir
// kurulum komutu ve değişiklik servisi üzerinden (önizle → onayla → yedek → geri al) yapılandırma. Kendiliğinden kurulum yok.
import { BadgeCheck, Check, Copy, ExternalLink, FileCog, Library, Plus, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import type { ChangePlan } from "../../lib/changes";
import { useT } from "../../lib/i18n";
import { mcpCatalogApi, type CatalogEntry, type CatalogList, type Reliability, type Verification } from "../../lib/mcpCatalog";
import { toolsApi } from "../../lib/tools";
import { mcpCatalogMsg as m } from "../../locales/mcpCatalog";
import { ChangeReviewModal } from "../ChangeReviewModal";
import { Badge, Button, Field, Panel, Segmented, Spinner } from "../ui";

type Target = "claude" | "codex" | "voxcrew";
const REL_TONE: Record<Reliability, string> = { resmi: "ok", topluluk: "info", deneysel: "warn" };
const VER_TONE: Record<Verification, string> = { verified: "ok", partial: "info", unverified: "warn" };

function CopyBtn({ text }: { text: string }) {
  const t = useT(m);
  const [ok, setOk] = useState(false);
  return (
    <Button size="sm" variant="ghost" icon={ok ? <Check size={14} /> : <Copy size={14} />}
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => undefined); }}>
      {ok ? t("copied") : t("copy")}
    </Button>
  );
}

function Setup({ e, onDone }: { e: CatalogEntry; onDone: () => void }) {
  const t = useT(m);
  const id = useId();
  const [target, setTarget] = useState<Target>("claude");
  const [projectDir, setProjectDir] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const unverified = e.verification.status === "unverified";

  const preview = async () => {
    if (target === "voxcrew") return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await mcpCatalogApi.plan(e.id, target, { project_dir: target === "claude" ? projectDir : undefined, params });
      if (res.action === "keep" || res.plan.no_change) setNotice(t("keep"));
      else setPlan(res.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const addVoxcrew = async () => {
    if (!e.voxcrew_server) return;
    const refs = e.voxcrew_server.env_refs ?? [];
    // Karar 1: ortam değişkeni isteyen kayıt adları sayan açık onayla eklenir (sunucu aynı kümeyi ister)
    if (refs.length && !confirm(t("voxcrew_env_confirm", { id: e.voxcrew_server.id, list: refs.join(", ") }))) return;
    setBusy(true);
    setError(null);
    try {
      await toolsApi.addServer(refs.length ? { ...e.voxcrew_server, confirm_env: refs } : e.voxcrew_server);
      setNotice(t("voxcrew_added"));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const command = target === "voxcrew" ? null : e.commands[target];
  return (
    <div className="panel-soft p-3 flex flex-col gap-3 min-w-0">
      <Field label={t("target")}>
        <Segmented value={target} onChange={(v) => { setTarget(v); setError(null); setNotice(null); }} className="flex-wrap"
          options={[{ value: "claude", label: t("target_claude") }, { value: "codex", label: t("target_codex") },
            { value: "voxcrew", label: t("target_voxcrew") }]} />
      </Field>
      {command && (
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ink-2 flex-1">{t("command")}</span>
            <CopyBtn text={command} />
          </div>
          <pre className="font-mono text-xs panel !shadow-none p-2 whitespace-pre-wrap break-all">{command}</pre>
          <p className="text-xs text-muted">{t("never_auto")}</p>
        </div>
      )}
      {Object.entries(e.params).map(([k, label]) => target !== "voxcrew" && (
        <Field key={k} label={label}>
          <input className="input font-mono" value={params[k] ?? ""} aria-label={label} spellCheck={false}
            onChange={(ev) => setParams((p) => ({ ...p, [k]: ev.target.value }))} />
        </Field>
      ))}
      {target === "claude" && (
        <>
          <Field label={t("project_dir")} hint={t("project_dir_hint")}>
            <input id={`${id}-pd`} className="input font-mono" value={projectDir} spellCheck={false} aria-label={t("project_dir")}
              onChange={(ev) => setProjectDir(ev.target.value)} placeholder="~/Projeler/ornek" />
          </Field>
          <p className="text-xs text-ink-2">{t("claude_note")}</p>
        </>
      )}
      {target === "codex" && <p className="text-xs text-ink-2">{t("codex_note")}</p>}
      {target !== "voxcrew" && (
        unverified ? <p className="text-sm text-warn">{t("unverified_block")}</p> : (
          <div>
            <Button size="sm" variant="primary" icon={<FileCog size={14} />}
              disabled={busy || (target === "claude" && !projectDir.trim())} onClick={preview}>
              {busy ? t("planning") : t("plan_btn")}
            </Button>
          </div>
        )
      )}
      {target === "voxcrew" && (
        e.voxcrew_server ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-ink-2">{t("voxcrew_note")}</p>
            {(e.voxcrew_server.env_refs?.length ?? 0) > 0 && (
              <p className="text-xs text-ink-2">{t("voxcrew_env_note", { list: (e.voxcrew_server.env_refs ?? []).join(", ") })}</p>
            )}
            <pre className="font-mono text-xs panel !shadow-none p-2 whitespace-pre-wrap break-all">
              {JSON.stringify(e.voxcrew_server, null, 2)}
            </pre>
            <div>
              <Button size="sm" variant="primary" icon={<Plus size={14} />} disabled={busy || e.configured.includes("voxcrew")}
                onClick={addVoxcrew}>{t("voxcrew_add")}</Button>
            </div>
          </div>
        ) : <p className="text-sm text-ink-2">{t("voxcrew_unavailable")}</p>
      )}
      {notice && <p className="text-sm text-ok" role="status">{notice}</p>}
      {error && <p className="text-sm text-bad" role="alert">{t("error", { error })}</p>}
      <ChangeReviewModal plan={plan} title={t("review_title")} onClose={() => setPlan(null)}
        onApplied={() => { setNotice(t("applied")); onDone(); }} />
    </div>
  );
}

/** Karar 1: gerekli değişkenler tanımlı mı (değer asla gelmez) ve tanımlı değilse değersiz, işletim sistemine göre ipucu. */
function EnvStatus({ e }: { e: CatalogEntry }) {
  const t = useT(m);
  const status = e.env_status ?? [];
  if (!status.length) return null;
  const missing = status.filter((s) => !s.set).map((s) => s.name);
  const hint = e.env_hint;
  const lines = hint ? hint.lines.filter((line) => missing.some((n) => line.includes(` ${n}`))) : [];
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className="flex flex-wrap gap-1">
        {status.map((s) => (
          <Badge key={s.name} tone={s.set ? "ok" : "warn"}><span className="font-mono">{s.name}</span> · {s.set ? t("env_set") : t("env_unset")}</Badge>
        ))}
      </div>
      {missing.length > 0 && hint && (
        <div className="flex flex-col gap-1 min-w-0">
          <p className="text-xs text-ink-2">{t("env_missing", { list: missing.join(", ") })}</p>
          <p className="text-xs text-ink-2">{hint.platform === "windows" ? t("env_hint_windows") : t("env_hint_posix", { rc: hint.rc ?? "" })}</p>
          <div className="flex items-start gap-2 min-w-0">
            <pre className="font-mono text-xs panel !shadow-none p-2 whitespace-pre-wrap break-all flex-1 min-w-0">{lines.join("\n")}</pre>
            <CopyBtn text={lines.join("\n")} />
          </div>
          <p className="text-xs text-muted">{t("env_hint_after")}</p>
        </div>
      )}
    </div>
  );
}

function Entry({ e, onChanged }: { e: CatalogEntry; onChanged: () => void }) {
  const t = useT(m);
  const [open, setOpen] = useState(false);
  const trig = e.unlocks.triggers.map((x) => (x === "email_label" ? t("trig_email_label") : x === "meeting_end" ? t("trig_meeting_end") : x));
  return (
    <li className="panel-soft p-3 flex flex-col gap-2 min-w-0">
      <div className="flex flex-wrap items-start gap-2 min-w-0">
        <div className="flex-1 min-w-[min(100%,200px)]">
          <h3 className="font-display font-semibold">{e.name}</h3>
          <p className="text-sm text-ink-2">{e.purpose}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <span title={t(`rel_hint_${e.reliability}`)}><Badge tone={REL_TONE[e.reliability]}>{t(`rel_${e.reliability}`)}</Badge></span>
          <span title={t(`ver_hint_${e.verification.status}`)}>
            <Badge tone={VER_TONE[e.verification.status]}>
              {e.verification.status === "unverified" ? <ShieldAlert size={12} aria-hidden /> : <BadgeCheck size={12} aria-hidden />}
              {t(`ver_${e.verification.status}`)}
            </Badge>
          </span>
          {e.configured.includes("voxcrew") && <Badge tone="ok">{t("configured_voxcrew")}</Badge>}
          {e.configured.includes("codex") && <Badge tone="ok">{t("configured_codex")}</Badge>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs" aria-label={t("unlocks")}>
        {e.unlocks.delivery.length > 0 && <Badge tone="muted">{t("unlocks_delivery", { list: e.unlocks.delivery.join(", ") })}</Badge>}
        {trig.length > 0 && <Badge tone="muted">{t("unlocks_triggers", { list: trig.join(", ") })}</Badge>}
        {e.unlocks.recipes.length > 0 && <Badge tone="muted">{t("unlocks_recipes", { list: e.unlocks.recipes.join(", ") })}</Badge>}
      </div>
      <p className="text-xs text-ink-2">
        {e.env.length ? <>{t("env")}: <span className="font-mono">{e.env.join(", ")}</span></> : t("env_none")}
      </p>
      <EnvStatus e={e} />
      {(e.notes || e.verification.note) && (
        <p className="text-xs text-muted">{[e.notes, e.verification.note].filter(Boolean).join(" ")}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={open ? "ghost" : "default"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? t("close") : t("setup")}
        </Button>
        {e.verification.source && (
          <a href={e.verification.source} target="_blank" rel="noreferrer noopener" className="text-xs text-link inline-flex items-center gap-1">
            {t("source")}<ExternalLink size={12} aria-hidden />
          </a>
        )}
      </div>
      {open && <Setup e={e} onDone={onChanged} />}
    </li>
  );
}

export function McpCatalogPanel() {
  const t = useT(m);
  const [data, setData] = useState<CatalogList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    mcpCatalogApi.list().then((d) => { setData(d); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { load(); }, [load]);
  // Zamanlayıcıdaki "MCP kataloğunu aç" bağlantısı (#mcp-katalog) bu bölüme kaydırır
  useEffect(() => {
    if (data && typeof window !== "undefined" && window.location.hash === "#mcp-katalog") {
      document.getElementById("mcp-katalog")?.scrollIntoView({ block: "start" });
    }
  }, [data]);
  return (
    <section id="mcp-katalog" aria-label={t("title")}>
      <Panel title={t("title")} icon={<Library size={16} />}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-2">{t("intro")}</p>
          {data && <p className="text-xs text-muted">{t("checked", { date: data.checked_at })}</p>}
          {error && <p className="text-sm text-bad" role="alert">{t("load_error", { error })}</p>}
          {!data && !error ? <Spinner /> : (
            <ul className="grid gap-2 md:grid-cols-2">
              {data?.items.map((e) => <Entry key={e.id} e={e} onChanged={load} />)}
            </ul>
          )}
        </div>
      </Panel>
    </section>
  );
}
