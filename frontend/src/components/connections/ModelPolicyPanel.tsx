// S37 — Bağlantılar → "Model izinleri": kural (hepsi / yalnız yerel / izin listesi), hazır kurallar, çevrimiçi
// bağlantı başına anahtarlar, izin/engel kalıpları, uzak model onayları ve CANLI önizleme (taslak kurala göre).
// Kural sunucuda uygulanır (connections/policy.py); burası yalnızca düzenleme ve önizleme.
import clsx from "clsx";
import { CheckCircle2, Cloud, HardDrive, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { connOf, endpointsOf, useConnectionStates } from "../../lib/connections";
import { useT } from "../../lib/i18n";
import { matches, policyApi, useModelPolicy, usePolicyView, type ModelPolicy, type PolicyMode, type PreviewRow } from "../../lib/modelPolicy";
import { useStudio } from "../../lib/store";
import { cx } from "../../locales/connections";
import { Badge, Button, Field, Panel, Segmented, Spinner, Toggle } from "../ui";

const lines = (s: string) => s.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);

function rowState(p: ModelPolicy, consent: string[], r: PreviewRow): "allowed" | "blocked" | "consent" {
  const keys = r.connection === "ollama" && r.remote ? [r.ref, `${r.ref}:cloud`] : [r.ref];
  const local = !r.remote;
  if (p.deny.some((x) => matches(x, keys, local))) return "blocked";
  if (p.mode === "local_only" && !local) return "blocked";
  if (p.mode === "allowlist" && !p.allow.some((x) => matches(x, keys, local))) return "blocked";
  if (r.consent_key && p.require_consent_remote && !consent.includes(r.consent_key)) return "consent";
  return "allowed";
}

export function ModelPolicyPanel() {
  const t = useT(cx);
  const view = usePolicyView();
  const setView = useModelPolicy((s) => s.set);
  const endpoints = endpointsOf(connOf(useConnectionStates(), "openai_compat"));
  const remoteEps = endpoints.filter((e) => !e.local);
  const [draft, setDraft] = useState<ModelPolicy | null>(null);
  const [allowText, setAllowText] = useState("");
  const [denyText, setDenyText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // sayfa açılınca tazele (yeni eklenen bağlantılar önizlemeye girsin)
  useEffect(() => { void useModelPolicy.getState().load(); }, []);
  useEffect(() => {
    if (view && !draft) { setDraft(view.policy); setAllowText(view.policy.allow.join("\n")); setDenyText(view.policy.deny.join("\n")); }
  }, [view, draft]);

  const pol: ModelPolicy | null = useMemo(() => (draft ? { ...draft, allow: lines(allowText), deny: lines(denyText) } : null), [draft, allowText, denyText]);
  const consentKeys = useMemo(() => (view?.consent ?? []).map((c) => c.key), [view]);
  if (!view || !pol || !draft) return <Panel title={t("pol_title")} icon={<ShieldCheck size={16} />}><div className="py-3 grid place-items-center"><Spinner /></div></Panel>;

  const hasAllow = (p: string) => pol.allow.some((x) => x.toLowerCase() === p.toLowerCase());
  const toggleAllow = (pats: string[], on: boolean) => {
    const rest = pol.allow.filter((x) => !pats.some((p) => p.toLowerCase() === x.toLowerCase()));
    setAllowText((on ? [...rest, ...pats] : rest).join("\n"));
  };
  const applyPreset = (key: "local_only" | "local_plus" | "all") => {
    const pr = view.presets[key] ?? {};
    setDraft({ ...draft, mode: (pr.mode ?? "all") as PolicyMode });
    // "Yerel + seçili online": yerel her zaman; çevrimiçi olanlar aşağıdaki anahtarlarla seçilir (var olanlar korunur)
    if (key === "local_plus") setAllowText([...new Set(["local", ...pol.allow])].join("\n"));
    else setAllowText((pr.allow ?? []).join("\n"));
  };
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const v = await policyApi.save(pol);
      setView(v); setDraft(v.policy); setAllowText(v.policy.allow.join("\n")); setDenyText(v.policy.deny.join("\n"));
      await api.agents().then((agents) => useStudio.setState({ agents })).catch(() => undefined);
      setMsg({ ok: true, text: t("pol_saved") });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); }
  };
  const revoke = async (key: string) => { try { setView(await policyApi.revoke(key)); } catch { /* sonraki yüklemede görünür */ } };
  const allowMode = pol.mode === "allowlist";

  return (
    <Panel title={t("pol_title")} icon={<ShieldCheck size={16} />}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">{t("pol_intro")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("pol_mode")}>
            <Segmented value={pol.mode} onChange={(m: PolicyMode) => setDraft({ ...draft, mode: m })} options={[
              { value: "all", label: t("pol_mode_all") }, { value: "local_only", label: t("pol_mode_local") }, { value: "allowlist", label: t("pol_mode_allow") },
            ]} />
          </Field>
          <Field label={t("pol_presets")}>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" onClick={() => applyPreset("local_only")}>{t("pol_preset_local")}</Button>
              <Button size="sm" onClick={() => applyPreset("local_plus")}>{t("pol_preset_plus")}</Button>
              <Button size="sm" variant="ghost" onClick={() => applyPreset("all")}>{t("pol_preset_all")}</Button>
            </div>
          </Field>
        </div>

        {allowMode && (
          <section className="flex flex-col gap-2" aria-labelledby="pol-online">
            <h4 id="pol-online" className="panel-title">{t("pol_endpoints")}</h4>
            <p className="text-xs text-muted">{t("pol_endpoints_hint")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Toggle checked={hasAllow("local")} onChange={(v) => toggleAllow(["local"], v)} aria-label={t("ep_local")} label={<span className="flex items-center gap-1.5"><HardDrive size={14} aria-hidden />{t("ep_local")}</span>} />
              {remoteEps.map((ep) => (
                <Toggle key={ep.id} checked={hasAllow(`${ep.id}::*`)} onChange={(v) => toggleAllow([`${ep.id}::*`], v)} aria-label={ep.label}
                  label={<span className="flex items-center gap-1.5 min-w-0"><Cloud size={14} aria-hidden /><span className="truncate">{ep.label}</span></span>} hint={ep.host} />
              ))}
              <Toggle checked={hasAllow("ollama:*:cloud")} onChange={(v) => toggleAllow(["ollama:*:cloud"], v)} label={t("pol_cloud")} />
              <Toggle checked={hasAllow("codex:*") && hasAllow("claude:*")} onChange={(v) => toggleAllow(["codex:*", "claude:*"], v)} label={t("pol_cli")} />
            </div>
          </section>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t("pol_allow")} hint={allowMode ? t("pol_patterns_hint") : undefined}>
            <textarea className="textarea font-mono !text-xs min-h-[84px]" aria-label={t("pol_allow")} value={allowText} spellCheck={false}
              onChange={(e) => setAllowText(e.target.value)} disabled={pol.mode !== "allowlist"} />
          </Field>
          <Field label={t("pol_deny")} hint={!allowMode ? t("pol_patterns_hint") : undefined}>
            <textarea className="textarea font-mono !text-xs min-h-[84px]" aria-label={t("pol_deny")} value={denyText} spellCheck={false}
              onChange={(e) => setDenyText(e.target.value)} />
          </Field>
        </div>

        <Toggle checked={pol.require_consent_remote} onChange={(v) => setDraft({ ...draft, require_consent_remote: v })}
          label={t("pol_consent_toggle")} hint={t("pol_consent_hint")} />

        <section className="flex flex-col gap-2" aria-labelledby="pol-preview">
          <h4 id="pol-preview" className="panel-title">{t("pol_preview")}</h4>
          {view.preview.length === 0 ? <p className="text-sm text-muted">{t("pol_preview_empty")}</p> : (
            <ul className="grid gap-1.5 md:grid-cols-2">
              {view.preview.map((r) => {
                const st = rowState(pol, consentKeys, r);
                return (
                  <li key={r.ref} className="panel-soft px-2.5 py-1.5 flex items-center gap-2 min-w-0 text-sm">
                    {st === "blocked" ? <XCircle size={14} className="text-bad shrink-0" aria-hidden /> : <CheckCircle2 size={14} className={clsx("shrink-0", st === "allowed" ? "text-ok" : "text-warn")} aria-hidden />}
                    <span className="truncate flex-1 min-w-0" title={r.ref}>{r.label}</span>
                    {r.remote && <Badge tone="info">{t("online_badge")}</Badge>}
                    <Badge tone={st === "allowed" ? "ok" : st === "consent" ? "warn" : "bad"}>
                      {st === "allowed" ? t("pol_allowed") : st === "consent" ? t("pol_needs_consent") : t("pol_blocked")}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-1.5" aria-labelledby="pol-consents">
          <h4 id="pol-consents" className="panel-title">{t("pol_consents")}</h4>
          {view.consent.length === 0 ? <p className="text-sm text-muted">{t("pol_none")}</p> : (
            <ul className="flex flex-wrap gap-1.5">
              {view.consent.map((c) => (
                <li key={c.key} className="chip !gap-1.5">
                  <span className="font-mono text-xs">{c.key}</span>
                  <button type="button" className="text-xs font-semibold underline" onClick={() => revoke(c.key)}>{t("pol_revoke")}</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs text-muted">{t("pol_admin_note")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={busy} icon={busy ? <Spinner size={14} /> : undefined} onClick={save}>{t("pol_save")}</Button>
          {msg && <span role="status" className={clsx("text-sm", msg.ok ? "text-ok" : "text-bad")}>{msg.text}</span>}
        </div>
      </div>
    </Panel>
  );
}
