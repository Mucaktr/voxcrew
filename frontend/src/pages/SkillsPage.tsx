// Ekip S14 — /skiller ve /skiller/:id: birleşik skill kütüphanesi (VoxCrew · Hermes · Claude Code).
// G1-D — "Sabitleme ve onay" paneli: ajan başına sürüm (sha), kip (katalog / her zaman / kapalı), onay kartı
// (guard bulguları kırmızı, token, fark). Onay ve bağlama yalnız kullanıcıdan (sunucu MCP'yi 403 ile reddeder).
import { AlertTriangle, Plus, RefreshCcw, Search, ShieldCheck, Sparkles, Upload, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AssignDialog } from "../components/skills/AssignDialog";
import { ErrorRow, LoadingRow } from "../components/skills/common";
import { ImportDialog } from "../components/skills/ImportDialog";
import { SkillCard } from "../components/skills/SkillCard";
import { SkillDrawer } from "../components/skills/SkillDrawer";
import { SkillEditor } from "../components/skills/SkillEditor";
import { Badge, Button, Empty, Modal, PageHeader, Panel, Segmented } from "../components/ui";
import { defineMessages, fmtNumber, tp, useT } from "../lib/i18n";
import {
  encodeSkillId, foldText, matchesSkill, shortSha, skillsApi, useSkills, wireSkillsEvents,
  type AgentSkillItem, type AgentSkillView, type BindMode, type ImportPlanPreview, type SkillEntry, type SkillPin, type SkillSource,
} from "../lib/skills";
import { useStudio } from "../lib/store";
import { skillsMsg as m } from "../locales/skills";

const pm = defineMessages({
  pin_title: "Sabitleme ve onay",
  pin_hint: "Ajanlar skill'in onayladığın sürümünü kullanır. Kaynak değişirse ajan eski sürümde kalır; yeni sürüm yalnız sen onaylayınca devreye girer.",
  pin_agent: "Ajan",
  pin_pick: "Ajan seç…",
  pin_none: "Bu ajanın istemle giden skill ataması yok.",
  pin_legacy: "Sabitleme henüz etkin değil (göç açılışta yapılır).",
  mode_label: "Kip",
  mode_catalog: "Katalog",
  mode_always: "Her zaman",
  mode_never: "Kapalı",
  mode_catalog_hint: "İstemde yalnız ad ve açıklama; gövde görevle ilgiliyse yüklenir.",
  mode_always_hint: "Gövde her adımda isteme girer.",
  mode_never_hint: "Bu ajan için geçici olarak kapalı.",
  st_ok: "Sabit",
  st_pending: "Onay bekliyor",
  st_off: "Kapalı",
  st_legacy: "Canlı",
  st_blocked: "Yüklenmedi",
  st_blocked_text: "Diskteki içerik sabitlenen sürümle uyuşmuyor; bu skill isteme girmiyor. Kaynağı incele ve yeniden onayla.",
  st_pending_text: "Onaylanmış sürümü yok; onaylanana kadar isteme girmez.",
  update: "Güncelleme var",
  review: "İncele ve onayla",
  review_update: "Yeni sürümü incele",
  tokens: "katalog {c} · gövde {b} token",
  version: "Sürüm {sha}",
  card_title: "Skill onayı: {name}",
  card_loading: "Önizleme hazırlanıyor…",
  card_sha: "Yeni sürüm",
  card_prev: "Önceki onaylı sürüm",
  card_files: "Özete giren dosyalar",
  card_other: "Diğer dosyalar (özete girmez, asla çalıştırılmaz)",
  card_findings: "Güvenlik bulguları",
  card_findings_text: "Bu içerik ajana talimat vermeye ya da kendini kalıcı kural yapmaya çalışıyor olabilir. Onaylarsan isteme girer.",
  card_clean: "Enjeksiyon taraması temiz.",
  card_tokens: "Token: katalog {c} (her adım) · gövde {b} (yüklenirse)",
  card_diff: "Önceki sürüme göre fark",
  card_no_diff: "Önceki onaylı sürüm yok (ilk onay).",
  card_already: "Bu sürüm zaten onaylı; onaylamak ajanı bu sürüme bağlar.",
  card_accept: "Bulguları gördüm, yine de onaylıyorum",
  card_confirm: "Onayla ve bağla",
  card_cancel: "Vazgeç",
}, {
  pin_title: "Pinning and approval",
  pin_hint: "Agents use the version of a skill you approved. If the source changes, the agent stays on the old version; a new version takes effect only after you approve it.",
  pin_agent: "Agent",
  pin_pick: "Pick an agent…",
  pin_none: "This agent has no prompt-delivered skill assignments.",
  pin_legacy: "Pinning is not active yet (migration runs at startup).",
  mode_label: "Mode",
  mode_catalog: "Catalog",
  mode_always: "Always",
  mode_never: "Off",
  mode_catalog_hint: "Only name and description in the prompt; the body loads when the task needs it.",
  mode_always_hint: "The body enters the prompt on every step.",
  mode_never_hint: "Temporarily off for this agent.",
  st_ok: "Pinned",
  st_pending: "Awaiting approval",
  st_off: "Off",
  st_legacy: "Live",
  st_blocked: "Not loaded",
  st_blocked_text: "The content on disk does not match the pinned version; this skill is not in the prompt. Review the source and approve again.",
  st_pending_text: "No approved version; it stays out of the prompt until approved.",
  update: "Update available",
  review: "Review and approve",
  review_update: "Review new version",
  tokens: "catalog {c} · body {b} tokens",
  version: "Version {sha}",
  card_title: "Skill approval: {name}",
  card_loading: "Preparing preview…",
  card_sha: "New version",
  card_prev: "Previous approved version",
  card_files: "Files in the digest",
  card_other: "Other files (not in the digest, never executed)",
  card_findings: "Security findings",
  card_findings_text: "This content may be trying to instruct the agent or make itself a permanent rule. If you approve, it enters the prompt.",
  card_clean: "Injection scan is clean.",
  card_tokens: "Tokens: catalog {c} (every step) · body {b} (if loaded)",
  card_diff: "Diff against the previous version",
  card_no_diff: "No previous approved version (first approval).",
  card_already: "This version is already approved; approving binds the agent to it.",
  card_accept: "I have seen the findings and approve anyway",
  card_confirm: "Approve and bind",
  card_cancel: "Cancel",
});

const STATE_TONE: Record<SkillPin["status"], string> = { ok: "ok", pending: "warn", off: "muted", legacy: "info", blocked: "bad" };
const STATE_KEY = { ok: "st_ok", pending: "st_pending", off: "st_off", legacy: "st_legacy", blocked: "st_blocked" } as const;

function PinPanel() {
  const t = useT(pm);
  const agents = useStudio((s) => s.agents);
  const candidates = useMemo(() => agents.filter((a) => (a.skills?.length ?? 0) > 0), [agents]);
  const [slug, setSlug] = useState("");
  const [view, setView] = useState<AgentSkillView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<AgentSkillItem | null>(null);

  const load = useCallback(async (s: string) => {
    if (!s) { setView(null); return; }
    try { setView(await skillsApi.agent(s)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(slug); }, [slug, load]);

  const setMode = async (item: AgentSkillItem, mode: BindMode) => {
    setBusy(true);
    try { await skillsApi.bind({ agent: slug, key: item.key, mode }); await load(slug); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const items = (view?.items ?? []).filter((i) => i.pin);

  return (
    <Panel title={t("pin_title")} icon={<ShieldCheck size={16} />} bodyClass="flex flex-col gap-3">
      <p className="text-sm text-muted">{t("pin_hint")}</p>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{t("pin_agent")}</span>
        <select className="select !w-auto max-w-full" value={slug} onChange={(e) => setSlug(e.target.value)}>
          <option value="">{t("pin_pick")}</option>
          {candidates.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
        </select>
      </label>
      {error && <ErrorRow error={error} onRetry={() => void load(slug)} />}
      {view && view.pinning === false && <p className="text-sm text-muted">{t("pin_legacy")}</p>}
      {view && items.length === 0 && <p className="text-sm text-muted">{t("pin_none")}</p>}
      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((i) => {
            const pin = i.pin as SkillPin;
            return (
              <li key={i.key} className="rounded-lg border-2 border-line-soft p-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="font-mono text-sm break-all">{i.key}</b>
                  <Badge tone={STATE_TONE[pin.status]}>{pin.status === "blocked" && <AlertTriangle size={12} aria-hidden />}{t(STATE_KEY[pin.status])}</Badge>
                  {pin.sha && <Badge title={pin.sha}><span className="font-mono">{t("version", { sha: shortSha(pin.sha) })}</span></Badge>}
                  {pin.update_available && <Badge tone="info">{t("update")}</Badge>}
                  {pin.tokens && <Badge>{t("tokens", { c: fmtNumber(pin.tokens.catalog), b: fmtNumber(pin.tokens.body) })}</Badge>}
                </div>
                {pin.status === "blocked" && <p role="alert" className="text-sm tone-bad rounded px-2 py-1">{t("st_blocked_text")}</p>}
                {pin.status === "pending" && <p className="text-sm text-muted">{t("st_pending_text")}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted">{t("mode_label")}</span>
                  <Segmented<BindMode> value={pin.mode} onChange={(v) => { if (!busy && v !== pin.mode) void setMode(i, v); }} options={[
                    { value: "catalog", label: t("mode_catalog"), title: t("mode_catalog_hint"), disabled: busy },
                    { value: "always", label: t("mode_always"), title: t("mode_always_hint"), disabled: busy },
                    { value: "never", label: t("mode_never"), title: t("mode_never_hint"), disabled: busy },
                  ]} />
                  {i.entry && (pin.status !== "ok" || pin.update_available) && (
                    <Button size="sm" variant="primary" onClick={() => setReview(i)}>
                      {pin.update_available ? t("review_update") : t("review")}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ApprovalCard item={review} agent={slug} onClose={() => setReview(null)} onDone={() => { setReview(null); void load(slug); }} />
    </Panel>
  );
}

function ApprovalCard({ item, agent, onClose, onDone }: { item: AgentSkillItem | null; agent: string; onClose: () => void; onDone: () => void }) {
  const t = useT(pm);
  const [plan, setPlan] = useState<ImportPlanPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = item?.entry?.id ?? "";
  useEffect(() => {
    setPlan(null); setError(null); setAccept(false);
    if (!id) return;
    let live = true;
    skillsApi.importPlan(id).then((p) => { if (live) setPlan(p); }).catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [id]);
  const risky = (plan?.findings.length ?? 0) > 0;
  const confirm = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await skillsApi.importConfirm({ plan_id: plan.plan_id, confirm: true, accept_risk: risky ? accept : undefined, agents: agent ? [agent] : [] });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={!!item} onClose={onClose} width={820} title={t("card_title", { name: item?.entry?.name ?? item?.key ?? "" })}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("card_cancel")}</Button>
        <Button variant="primary" onClick={() => void confirm()} disabled={!plan || busy || (risky && !accept)}>{t("card_confirm")}</Button>
      </>}>
      {error && <ErrorRow error={error} />}
      {!plan && !error && <LoadingRow label={t("card_loading")} />}
      {plan && (
        <div className="flex flex-col gap-3 text-sm">
          {plan.description && <p>{plan.description}</p>}
          <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted">{t("card_sha")}</dt><dd className="font-mono break-all">{plan.sha}</dd>
            <dt className="text-muted">{t("card_prev")}</dt><dd className="font-mono break-all">{plan.previous_sha ?? "—"}</dd>
          </dl>
          {plan.already_approved && <p className="text-muted">{t("card_already")}</p>}
          <p><Badge>{t("card_tokens", { c: fmtNumber(plan.tokens.catalog), b: fmtNumber(plan.tokens.body) })}</Badge></p>
          {risky ? (
            <section role="alert" className="tone-bad rounded-lg p-3 flex flex-col gap-2" aria-label={t("card_findings")}>
              <b className="flex items-center gap-1"><AlertTriangle size={14} aria-hidden />{t("card_findings")}</b>
              <p>{t("card_findings_text")}</p>
              <ul className="list-disc pl-5">
                {plan.findings.map((f) => <li key={f.file}><span className="font-mono">{f.file}</span>: {f.patterns.join(", ")}</li>)}
              </ul>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" aria-label={t("card_accept")} checked={accept} onChange={(e) => setAccept(e.target.checked)} />
                <span>{t("card_accept")}</span>
              </label>
            </section>
          ) : <p className="tone-ok rounded px-2 py-1">{t("card_clean")}</p>}
          <div>
            <b>{t("card_files")}</b>
            <ul className="font-mono text-xs break-all">{plan.files.map((f) => <li key={f}>{f}</li>)}</ul>
            {plan.other_files.length > 0 && <>
              <b className="block mt-2">{t("card_other")}</b>
              <ul className="font-mono text-xs break-all">{plan.other_files.map((f) => <li key={f}>{f}</li>)}</ul>
            </>}
          </div>
          <div>
            <b>{t("card_diff")}</b>
            {plan.diff.length > 0
              ? <pre className="mt-1 max-h-72 overflow-auto rounded border-2 border-line-soft p-2 text-xs whitespace-pre-wrap break-all">{plan.diff.join("\n")}</pre>
              : <p className="text-muted">{t("card_no_diff")}</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}

type SourceTab = "all" | SkillSource;

export default function SkillsPage() {
  const t = useT(m);
  const navigate = useNavigate();
  const { id } = useParams();
  const openId = id ? decodeURIComponent(id) : null;
  const items = useSkills((s) => s.items);
  const sources = useSkills((s) => s.sources);
  const loaded = useSkills((s) => s.loaded);
  const loading = useSkills((s) => s.loading);
  const error = useSkills((s) => s.error);
  const refresh = useSkills((s) => s.refresh);
  const upsert = useSkills((s) => s.upsert);
  useEffect(() => { wireSkillsEvents(); if (!loaded) void refresh(); }, [loaded, refresh]);

  const [tab, setTab] = useState<SourceTab>("all");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [editorOpen, setEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const needle = foldText(query.trim());
  const filtered = useMemo(() => items.filter((e) =>
    (tab === "all" || e.source === tab) &&
    (!tag || e.tags.some((x) => foldText(x) === foldText(tag)) || foldText(e.category ?? "") === foldText(tag)) &&
    matchesSkill(e, needle)), [items, tab, tag, needle]);
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    items.filter((e) => tab === "all" || e.source === tab).forEach((e) => e.tags.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 40);
  }, [items, tab]);
  const counts = sources?.counts;
  const open = (e: SkillEntry) => navigate(`/skiller/${encodeSkillId(e.id)}`);
  const toggle = (sid: string) => setSelected((s) => { const n = new Set(s); if (n.has(sid)) n.delete(sid); else n.add(sid); return n; });
  const created = (e: SkillEntry) => { upsert(e); setEditorOpen(false); setImportOpen(false); void refresh(); navigate(`/skiller/${encodeSkillId(e.id)}`); };

  return (
    <div className="p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
      <PageHeader title={t("page_title")} subtitle={t("page_subtitle")}
        meta={counts && <>
          <Badge tone="ok">{t("source_voxcrew")} {counts.voxcrew}</Badge>
          <Badge tone="info">{t("source_hermes")} {counts.hermes}</Badge>
          <Badge tone="warn">{t("source_claude")} {counts.claude}</Badge>
        </>}
        actions={<>
          <Button icon={<RefreshCcw size={15} />} onClick={() => void refresh()} disabled={loading}>{t("refresh")}</Button>
          <Button icon={<Upload size={15} />} onClick={() => setImportOpen(true)}>{t("import")}</Button>
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditorOpen(true)}>{t("new_skill")}</Button>
        </>} />

      <Panel bodyClass="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={tab} className="flex-wrap" onChange={(v) => { setTab(v); setTag(""); }} options={[
            { value: "all", label: t("source_all") }, { value: "voxcrew", label: t("source_voxcrew"), title: t("source_voxcrew_hint") },
            { value: "hermes", label: t("source_hermes"), title: t("source_hermes_hint") }, { value: "claude", label: t("source_claude"), title: t("source_claude_hint") },
          ]} />
          <label className="relative flex-1 min-w-[12rem]">
            <span className="sr-only">{t("search_label")}</span>
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
            <input className="input !pl-9" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search_placeholder")} />
          </label>
          {tags.length > 0 && (
            <select className="select !w-auto max-w-[14rem]" value={tag} onChange={(e) => setTag(e.target.value)} aria-label={t("tags_label")}>
              <option value="">{t("tag_all")}</option>
              {tags.map(([x, n]) => <option key={x} value={x}>#{x} ({n})</option>)}
            </select>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p className="text-muted flex-1 min-w-[10rem]" aria-live="polite"><b className="text-ink tabular-nums">{tp(m, "showing", filtered.length)}</b></p>
          <Button size="sm" variant={selectMode ? "primary" : "default"} aria-pressed={selectMode}
            onClick={() => { setSelectMode((v) => !v); if (selectMode) setSelected(new Set()); }}>{t("select")}</Button>
          {selectMode && (
            <>
              <span className="text-xs text-muted tabular-nums">{t("selected_n", { n: selected.size })}</span>
              <Button size="sm" variant="ghost" disabled={!selected.size} onClick={() => setSelected(new Set())}>{t("clear_selection")}</Button>
              <Button size="sm" variant="primary" icon={<UserPlus size={14} />} disabled={!selected.size} onClick={() => setAssignOpen(true)}>{t("assign_to_agents")}</Button>
            </>
          )}
        </div>

        {error && <ErrorRow error={error} onRetry={() => void refresh()} />}
        {!loaded ? <LoadingRow label={t("loading")} /> : filtered.length === 0 ? (
          items.length === 0
            ? <Empty icon={<Sparkles size={28} />} title={t("empty_lib_title")} text={t("empty_lib_text")}
              action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditorOpen(true)}>{t("new_skill")}</Button>} />
            : <Empty icon={<Sparkles size={28} />} title={t("empty_title")} text={t("empty_text")} />
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
            {filtered.map((e) => (
              <li key={e.id}>
                <SkillCard skill={e} onOpen={() => open(e)} selectable={selectMode} selected={selected.has(e.id)} onToggle={() => toggle(e.id)} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <PinPanel />

      <SkillDrawer id={openId} onClose={() => navigate("/skiller")} onNavigate={(sid) => navigate(`/skiller/${encodeSkillId(sid)}`)} />
      <SkillEditor open={editorOpen} onClose={() => setEditorOpen(false)} onSaved={created} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={created} />
      <AssignDialog open={assignOpen} onClose={() => setAssignOpen(false)} initialSkills={[...selected]} onDone={() => void refresh()} />
    </div>
  );
}
