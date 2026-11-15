/**
 * W3 (WALK-UX) — Konuş paneli. Yürürken F / Enter ile yakındaki ajana açılır;
 * ajan çekmecesinin yerini alır. Masaüstünde ajanın yanına yerleşir, dar ekranda alt sayfadır (PanelShell).
 *
 * Bölümler: Ne yapıyor? · Görev ver (+ taşınan çıktıyı teslim et) · Mesaj bırak · Onay bekliyor · Çıktılar ·
 * Teşekkür et / İkram et (+ ekip yemeği) · Ekibe al · Tepkiler · Profil.
 *
 * Güvenlik (§11): hiçbir eylem yakınlıkla tetiklenmez; her biri açık bir tık. Görev, mevcut TaskComposer üzerinden gerçek
 * koşudur (`origin: ui`, model politikası ve onay pencereleri aynen). Onay kartları Koşular sayfasındakilerin AYNISIDIR
 * (ToolApprovalCard, AskCard, ApprovalStepCard; D3 A). Ekip değişikliği ve ekip yemeği ayrı bir onay penceresi ister.
*/
import clsx from "clsx";
import { ExternalLink, Gift, Hand, Inbox, Send, ScrollText, ShieldAlert, Sparkles, Users, UtensilsCrossed } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { deliverablesApi, type Deliverable } from "../../../lib/deliverables";
import { messagesApi } from "../../../lib/messages";
import { officeApi, useOffice } from "../../../lib/office";
import { currentLocale, useT } from "../../../lib/i18n";
import { useAgentCostume } from "../../../lib/cosmetics";
import { useStudio } from "../../../lib/store";
import type { Agent, Run, StepRun } from "../../../lib/types";
import type { StepWithGateway } from "../../../lib/gateway";
import { walk as WM } from "../../../locales/walk";
import { useWalkCarry, useWalkStore } from "../../../voxel/walk/walkStore";
import { sceneLabel } from "./progress/actions";
import { PixelFace } from "../../PixelFace";
import { GIFTS_ENABLED, GiftDialog, GiftStrip, teamLunchUrl } from "../../../full/worldGifts"; // EDITION1: free sürümde takdir yok
import { DeliverButton } from "../../delivery/DeliverButton";
import { ToolApprovalCard } from "../../gateway/ToolApprovalCard";
import { ApprovalStepCard } from "../../runs/ApprovalStepCard";
import { HireApprovalCard, hireOf } from "../../runs/HireApprovalCard";
import { AskCard } from "../../runs/RunControls";
import { isAskCard } from "../../runs/runFormat";
import { Button, Modal, Spinner, TabPanel, Tabs } from "../../ui";
import { fun, type ReactionKind } from "./funBridge";
import { PanelShell } from "./PanelShell";
import { nearCoffeeSpot, requestId, walkDeliverableViewed, walkRunStarted, walkVisit } from "./walkEvents";

type Section = "status" | "task" | "message" | "approval" | "outputs" | "thanks" | "team" | "react";
/** Yürüme metinleri (tek tip; alt bileşenlere geçirilir). */
export const useWalkT = () => useT(WM);
export type T = ReturnType<typeof useWalkT>;

const LUNCH_PER = 15, LUNCH_MAX = 150;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ACTIVE = /running|awaiting|paused|pending|queued/;

/** Ajanın karar bekleyen adımları (kendi adımı ya da içinde yer aldığı koşunun onay adımı). */
function pendingFor(slug: string, runs: Record<string, Run>, runList: Run[]): { run: Run; step: StepRun }[] {
  const out: { run: Run; step: StepRun }[] = [];
  const seen = new Set<string>();
  for (const r0 of runList) {
    if (!ACTIVE.test(r0.status) || seen.has(r0.id)) continue;
    seen.add(r0.id);
    const r = runs[r0.id] ?? r0;
    if (!r.steps?.some((s) => s.agent === slug)) continue;
    for (const s of r.steps) {
      if (s.status === "awaiting_tool_approval" && s.agent === slug && (s as StepWithGateway).pending_approval) out.push({ run: r, step: s });
      else if (s.status === "awaiting_approval" && (s.agent === slug || s.type === "approval")) out.push({ run: r, step: s });
    }
  }
  return out;
}

export function TalkPanel({ slug, onClose }: { slug: string; onClose: () => void }) {
  const t = useT(WM);
  const agent = useStudio((s) => s.agents.find((a) => a.slug === slug));
  const runs = useStudio((s) => s.runs);
  const runList = useStudio((s) => s.runList);
  const pending = useMemo(() => pendingFor(slug, runs, runList), [slug, runs, runList]);
  const carry = useWalkCarry();
  const tabsId = useId().replace(/:/g, "");
  const [section, setSection] = useState<Section>(() => (pending.length ? "approval" : carry ? "task" : "status"));
  // FIX-UX: panel kullanıcının açık eylemiyle açıldı → ajan ziyareti (gün × ajan bir kez; aynı açılış tek istek kimliği)
  const [visitId] = useState(requestId);
  useEffect(() => { if (agent) void walkVisit(slug, visitId); }, [slug, visitId, !!agent]); // eslint-disable-line react-hooks/exhaustive-deps

  // karar bekleyen koşuların tam kaydı (AskCard / onay kartı tam koşuyu okur)
  const loadRun = useStudio((s) => s.loadRun);
  const pendingIds = pending.map((p) => p.run.id).join(",");
  useEffect(() => { pendingIds.split(",").filter(Boolean).forEach((id) => { if (!useStudio.getState().runs[id]) void loadRun(id); }); }, [pendingIds, loadRun]);

  if (!agent) {
    return (
      // CORE-WALK: ham kimlik (slug) gösterilmez — dostça yedek başlık ve açıklama
      <PanelShell label={t("talk_aria", { name: t("talk_unknown") })} title={<span className="font-semibold">{t("talk_unknown")}</span>} closeLabel={t("talk_close")} onClose={onClose}>
        <p className="text-sm text-muted">{t("talk_unknown_hint")}</p>
      </PanelShell>
    );
  }

  const tabs: { value: Section; label: React.ReactNode }[] = [
    { value: "status", label: t("tab_status") },
    { value: "task", label: t("tab_task") },
    { value: "message", label: t("tab_message") },
    { value: "approval", label: <>{t("tab_approval")}{pending.length > 0 && <span className="chip tone-warn num ml-1 !py-0 text-xs">{pending.length}</span>}</> },
    { value: "outputs", label: t("tab_outputs") },
    ...(GIFTS_ENABLED ? [{ value: "thanks" as const, label: t("tab_thanks") }] : []),
    { value: "team", label: t("tab_team") },
    { value: "react", label: t("tab_react") },
  ];

  return (
    <PanelShell label={t("talk_aria", { name: agent.name })} closeLabel={t("talk_close")} onClose={onClose}
      title={<AgentTitle agent={agent} t={t} />}
      actions={<Link to={`/ajanlar/${encodeURIComponent(agent.slug)}`} className="btn btn-ghost btn-sm min-h-11 shrink-0" aria-label={t("profile_aria", { name: agent.name })}>{t("profile")}</Link>}>
      <Tabs id={tabsId} value={section} onChange={setSection} tabs={tabs} label={t("talk_sections")} />
      <TabPanel tabs={tabsId} value={section} className="pt-2.5">
        {section === "status" && <StatusSection agent={agent} t={t} />}
        {section === "task" && <TaskSection agent={agent} t={t} />}
        {section === "message" && <MessageSection agent={agent} t={t} />}
        {section === "approval" && <ApprovalSection pending={pending} agentName={agent.name} t={t} />}
        {section === "outputs" && <OutputsSection agent={agent} t={t} />}
        {GIFTS_ENABLED && section === "thanks" && <ThanksSection agent={agent} t={t} />}
        {section === "team" && <TeamSection agent={agent} t={t} />}
        {section === "react" && <ReactSection agent={agent} t={t} />}
      </TabPanel>
    </PanelShell>
  );
}

function AgentTitle({ agent, t }: { agent: Agent; t: T }) {
  const st = useStudio((s) => s.states[agent.slug]);
  const mood = (st?.state ?? "idle") as string;
  const label = ["idle", "thinking", "working", "waiting", "done", "error", "offline"].includes(mood) ? t(`status_${mood}` as "status_idle") : mood;
  return (
    <span className="flex items-center gap-2 min-w-0">
      <PixelFace avatar={agent.avatar} size={32} ring={agent.color} />
      <span className="min-w-0 flex flex-col">
        <span className="flex items-center gap-1.5 min-w-0"><span className="font-display font-semibold truncate">{agent.name}</span>{agent.demo && <span className="chip tone-warn !py-0 text-xs shrink-0">{t("kind_test_agent")}</span>}</span>
        <span className="text-xs text-ink-2 truncate">{agent.title ? `${agent.title} · ` : ""}{label}</span>
      </span>
    </span>
  );
}

// ------------------------------------------------------------------ Ne yapıyor?
function StatusSection({ agent, t }: { agent: Agent; t: T }) {
  const st = useStudio((s) => s.states[agent.slug]);
  const runId = st?.run_id ?? null;
  const run = useStudio((s) => (runId ? s.runs[runId] ?? s.runList.find((r) => r.id === runId) : undefined));
  const loadRun = useStudio((s) => s.loadRun);
  useEffect(() => { if (runId && !useStudio.getState().runs[runId]) void loadRun(runId); }, [runId, loadRun]);
  const step = run ? run.steps.find((s) => s.id === st?.step_id) ?? run.steps.find((s) => s.agent === agent.slug && /running|awaiting/.test(s.status)) : undefined;
  const last = run ? [...run.steps].reverse().find((s) => s.agent === agent.slug && s.output) : undefined;
  // UXF-E: ajanın şu an giydiği yerel kostüm (ekran görüntüsünden ayırt edilemiyordu)
  const scene = useWalkStore((s) => s.world);
  const worn = useAgentCostume(agent, scene);
  const en = currentLocale() === "en";
  const costume = worn?.local ? t("status_costume_local", { name: en ? worn.en : worn.tr, city: sceneLabel(worn.city ?? scene ?? "") }) : null;
  const lastText = last?.output ? (last.output.length > 280 ? `${last.output.slice(0, 280)}…` : last.output) : "";
  return (
    <div className="flex flex-col gap-2 text-sm" aria-live="polite">
      {st?.activity && <Row k={t("status_activity")} v={st.activity} />}
      {costume && <Row k={t("status_costume")} v={costume} />}
      {!run && <p className="text-muted">{t("status_none")}</p>}
      {run && (
        <>
          <Row k={t("status_run")} v={run.title} />
          {step && <Row k={t("status_step")} v={step.title} />}
          {st?.tool && <Row k={t("status_tool")} v={st.tool} />}
          {lastText && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-ink-2">{t("status_last")}</span>
              <p className="panel-soft p-2 rounded-lg whitespace-pre-wrap break-words text-sm max-h-40 overflow-y-auto">{lastText}</p>
            </div>
          )}
          <Link to={`/gorevler/${encodeURIComponent(run.id)}`} className="btn btn-sm self-start min-h-11"><ExternalLink size={14} aria-hidden="true" />{t("open_run")}</Link>
        </>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <p className="flex gap-2 min-w-0"><span className="text-ink-2 shrink-0 w-20">{k}</span><span className="font-semibold min-w-0 break-words">{v}</span></p>
  );
}

// ------------------------------------------------------------------ Görev ver (+ çıktı teslimi)
function TaskSection({ agent, t }: { agent: Agent; t: T }) {
  const openComposer = useStudio((s) => s.openComposer);
  const carry = useWalkCarry();
  // FIX-UX: kahve noktasının yakınında açılan pencere gerçek bir koşu başlatırsa `run_started` (kafeden_gorev)
  const [atCoffee] = useState(() => nearCoffeeSpot());
  const started = () => (nearCoffeeSpot() || atCoffee ? { onStarted: (runId: string) => { void walkRunStarted(runId); } } : {});
  const deliver = () => {
    if (!carry) return;
    openComposer(agent.slug, { prompt: t("deliver_prompt", { title: carry.title, id: carry.deliverableId }), ...started() });
    // teslim edildi sayılmaz: kullanıcı pencerede gönderir; parşömen elde kalır, istenirse "Bırak" ile bırakılır
  };
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-2">{t("task_text")}</p>
      {atCoffee && <p className="text-xs text-ink-2" data-walk-coffee-note="">{t("task_coffee_note")}</p>}
      <Button variant="primary" className="self-start min-h-11" icon={<Send size={15} />} onClick={() => openComposer(agent.slug, started())}>{t("task_open")}</Button>
      {carry && (
        <div className="panel-soft p-2.5 rounded-lg flex flex-col gap-2">
          <span className="font-semibold flex items-center gap-1.5"><ScrollText size={15} aria-hidden="true" />{t("deliver_title")}</span>
          <p className="text-ink-2">{t("deliver_text", { title: carry.title, name: agent.name })}</p>
          <Button className="self-start min-h-11" icon={<ScrollText size={15} />} onClick={deliver}>{t("deliver_open")}</Button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Mesaj bırak
function MessageSection({ agent, t }: { agent: Agent; t: T }) {
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await messagesApi.sendToAgent(agent.slug, body);
      setText("");
      setMsg({ ok: true, text: t("msg_sent", { name: agent.name }) });
    } catch (e) {
      setMsg({ ok: false, text: t("msg_error", { error: errText(e) }) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 text-sm">
      <label htmlFor={id} className="font-semibold">{t("msg_label")}</label>
      <textarea id={id} className="textarea min-h-[90px]" maxLength={2000} value={text} placeholder={t("msg_placeholder")}
        aria-describedby={`${id}-hint`} onChange={(e) => setText(e.target.value)} />
      <span id={`${id}-hint`} className="text-xs text-ink-2">{t("msg_hint")}</span>
      <Button variant="primary" className="self-start min-h-11" icon={<Inbox size={15} />} disabled={busy || !text.trim()} onClick={send}>{t("msg_send")}</Button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={clsx("font-semibold", msg.ok ? "text-ok" : "text-bad")}>{msg.text}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ Onay bekliyor (aynı kartlar; D3 A)
function ApprovalSection({ pending, agentName, t }: { pending: { run: Run; step: StepRun }[]; agentName: string; t: T }) {
  const agents = useStudio((s) => s.agents);
  if (!pending.length) return <p className="text-sm text-muted">{t("appr_none")}</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-2 flex items-center gap-1"><ShieldAlert size={13} aria-hidden="true" />{t("appr_text")}</p>
      {pending.map(({ run, step }) => {
        const gw = step as StepWithGateway;
        // FIX-UX: işe alım onayı Koşular sayfasındaki AYNI kartla (rol, persona, rütbe, yerleşim, yönetici)
        const hire = hireOf(step);
        return (
          <section key={`${run.id}:${step.id}`} aria-label={`${run.title} · ${step.title}`} className="panel-soft p-2.5 rounded-lg flex flex-col gap-2">
            <span className="text-sm font-semibold break-words">{run.title} · {step.title}</span>
            {step.status === "awaiting_tool_approval" && gw.pending_approval
              ? <ToolApprovalCard key={gw.pending_approval.approval_id} runId={run.id} req={gw.pending_approval} agentName={agentName} />
              : hire ? <HireApprovalCard run={run} step={step} hire={hire} manager={agents.find((a) => a.slug === hire.by)} />
              : isAskCard(run, step) ? <AskCard run={run} step={step} />
              : <ApprovalStepCard run={run} step={step} agents={agents} />}
            <Link to={`/gorevler/${encodeURIComponent(run.id)}`} className="text-sm font-semibold text-accent self-start inline-flex items-center gap-1 min-h-11">
              <ExternalLink size={13} aria-hidden="true" />{t("appr_open_run")}
            </Link>
          </section>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Çıktılar (son 3)
function OutputsSection({ agent, t }: { agent: Agent; t: T }) {
  const [items, setItems] = useState<Deliverable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const carry = useWalkCarry();
  useEffect(() => {
    let alive = true;
    deliverablesApi.list({ agent: agent.slug, limit: 3 })
      .then((r) => { if (alive) setItems(r.items.slice(0, 3)); })
      .catch((e) => { if (alive) setError(errText(e)); });
    return () => { alive = false; };
  }, [agent.slug]);
  if (error) return <p role="alert" className="text-sm text-bad">{t("load_error", { error })}</p>;
  if (!items) return <p className="text-sm text-muted flex items-center gap-2"><Spinner />{t("loading")}</p>;
  if (!items.length) return <p className="text-sm text-muted">{t("out_none")}</p>;
  return <DeliverableList items={items} t={t} carryId={carry?.deliverableId ?? null} />;
}

export function DeliverableList({ items, t, carryId }: { items: Deliverable[]; t: T; carryId: string | null }) {
  const [shown, setShown] = useState<string | null>(null);
  // FIX-UX: çıktıya bakmak (burada önizleme ya da Aç) `deliverable_viewed` olayıdır (ziyaret_turu; günde bir kez)
  const view = (d: Deliverable) => { if (d.agent) void walkDeliverableViewed(d.id); };
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((d) => (
        <li key={d.id} className="panel-soft rounded-lg p-2 flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="min-w-0 flex-1 basis-[8rem]">
              <span className="block text-sm font-semibold truncate" title={d.title}>{d.title}</span>
              <span className="block text-xs text-ink-2 truncate">{d.kind}{d.run_title ? ` · ${d.run_title}` : ""}</span>
            </span>
            <span className="flex items-center gap-1.5 shrink-0">
              <Button size="sm" className="min-h-11" aria-expanded={shown === d.id} aria-controls={`out-prev-${d.id}`}
                aria-label={t("out_view_aria", { title: d.title })}
                onClick={() => { const next = shown === d.id ? null : d.id; setShown(next); if (next) view(d); }}>
                {shown === d.id ? t("out_hide") : t("out_view")}
              </Button>
              <Link to={`/ciktilar/${encodeURIComponent(d.id)}`} className="btn btn-sm min-h-11" aria-label={t("out_open_aria", { title: d.title })}
                onClick={() => view(d)}>{t("out_open")}</Link>
              <Button size="sm" className="min-h-11" aria-label={t("out_take_aria", { title: d.title })} aria-pressed={carryId === d.id}
                onClick={() => useWalkStore.getState().setCarry({ kind: "scroll", deliverableId: d.id, title: d.title })}>{t("out_take")}</Button>
              <DeliverButton item={d} compact className="min-h-11" />
            </span>
          </div>
          {shown === d.id && <DeliverablePreview id={d.id} summary={d.summary ?? ""} t={t} />}
        </li>
      ))}
    </ul>
  );
}

/** Çıktının kısa önizlemesi (ilk ~600 karakter); tam görünüm "Aç" ile çıktı sayfasında. */
function DeliverablePreview({ id, summary, t }: { id: string; summary: string; t: T }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    deliverablesApi.get(id)
      .then((r) => { if (alive) setText((r.content.text ?? "").trim() || summary.trim()); })
      .catch(() => { if (alive) setText(summary.trim()); });
    return () => { alive = false; };
  }, [id, summary]);
  return (
    <div id={`out-prev-${id}`} className="text-sm" data-walk-preview="">
      {text === null ? <p className="text-muted flex items-center gap-2"><Spinner />{t("loading")}</p>
        : text ? <p className="panel p-2 rounded-lg whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{text.length > 600 ? `${text.slice(0, 600)}…` : text}</p>
        : <p className="text-muted">{t("out_preview_empty")}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ Teşekkür et / İkram et (+ ekip yemeği)
function ThanksSection({ agent, t }: { agent: Agent; t: T }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-2">{t("thanks_text")}</p>
      <Button variant="primary" className="self-start min-h-11" icon={<Gift size={15} />} onClick={() => setOpen(true)}>{t("thanks_open")}</Button>
      <GiftDialog agent={agent} open={open} onClose={() => setOpen(false)} onGiven={(kind) => { fun.gift(agent.slug, kind); }} />
      <GiftStrip agent={agent} />
      <TeamLunch agent={agent} t={t} />
    </div>
  );
}

function TeamLunch({ agent, t }: { agent: Agent; t: T }) {
  const teams = useOffice((s) => s.teams);
  const allAgents = useStudio((s) => s.agents);
  const team = agent.team ? teams.find((x) => x.slug === agent.team) : undefined;
  const members = useMemo(() => (agent.team ? allAgents.filter((a) => a.team === agent.team && !a.hidden).map((a) => a.slug) : []), [allAgents, agent.team]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!agent.team) return <p className="text-xs text-muted">{t("lunch_no_team")}</p>;
  const teamName = team?.name ?? agent.team;
  const coins = Math.min(LUNCH_MAX, LUNCH_PER * members.length);
  const order = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const id = (() => { try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; } })();
      const res = await fetch(teamLunchUrl(agent.team!)!, {
        // W5 (QA): sunucu hatası (429 / 402) arayüz dilinde gelsin
        method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Lang": currentLocale() },
        body: JSON.stringify({ confirm: true, client_request_id: id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body?.detail === "string" ? body.detail : `${res.status}`);
      const got: string[] = Array.isArray(body?.members) ? body.members.map(String) : members;
      fun.meal(got);
      setMsg({ ok: true, text: t("lunch_done") });
      setConfirm(false);
    } catch (e) {
      setMsg({ ok: false, text: t("lunch_error", { error: errText(e) }) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel-soft p-2.5 rounded-lg flex flex-col gap-2">
      <span className="font-semibold flex items-center gap-1.5"><UtensilsCrossed size={15} aria-hidden="true" />{t("lunch_title")}</span>
      <p className="text-ink-2">{t("lunch_text", { team: teamName, n: members.length, coins })}</p>
      <Button className="self-start min-h-11" disabled={!members.length} onClick={() => setConfirm(true)}>{t("lunch_open")}</Button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={clsx("font-semibold", msg.ok ? "text-ok" : "text-bad")}>{msg.text}</p>}
      <Modal open={confirm} onClose={() => setConfirm(false)} title={t("lunch_confirm_title")} width={440}
        footer={<>
          <Button onClick={() => setConfirm(false)}>{t("cancel")}</Button>
          <Button variant="primary" disabled={busy} onClick={order}>{t("lunch_confirm", { coins })}</Button>
        </>}>
        <p className="text-sm">{t("lunch_confirm_text", { team: teamName, coins })}</p>
        {msg && !msg.ok && <p role="alert" className="text-sm font-semibold text-bad mt-2">{msg.text}</p>}
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ Ekibe al
function TeamSection({ agent, t }: { agent: Agent; t: T }) {
  const id = useId();
  const teams = useOffice((s) => s.teams);
  const refresh = useOffice((s) => s.refresh);
  const refreshAgents = useStudio((s) => s.refreshAgents);
  const [pick, setPick] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (!teams.length) void refresh(); }, [teams.length, refresh]);
  const current = agent.team ? teams.find((x) => x.slug === agent.team)?.name ?? agent.team : t("team_none");
  const choices = teams.filter((x) => x.slug !== agent.team);
  const target = teams.find((x) => x.slug === pick);
  const move = async () => {
    if (!target) return;
    setBusy(true);
    setMsg(null);
    try {
      await officeApi.assign(agent.slug, { team: target.slug });
      setMsg({ ok: true, text: t("team_done", { name: agent.name, team: target.name }) });
      setConfirm(false);
      void refresh();
      void refreshAgents();
    } catch (e) {
      setMsg({ ok: false, text: t("team_error", { error: errText(e) }) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-ink-2 flex items-center gap-1.5"><Users size={14} aria-hidden="true" />{t("team_current", { team: current })}</p>
      <label htmlFor={id} className="font-semibold">{t("team_pick")}</label>
      <select id={id} className="select min-h-11" value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">{t("team_pick")}</option>
        {choices.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
      </select>
      <Button className="self-start min-h-11" disabled={!target} onClick={() => setConfirm(true)}>{t("team_move")}</Button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={clsx("font-semibold", msg.ok ? "text-ok" : "text-bad")}>{msg.text}</p>}
      <Modal open={confirm && !!target} onClose={() => setConfirm(false)} title={t("team_confirm_title")} width={440}
        footer={<>
          <Button onClick={() => setConfirm(false)}>{t("cancel")}</Button>
          <Button variant="primary" disabled={busy} onClick={move}>{t("team_confirm")}</Button>
        </>}>
        <p className="text-sm">{t("team_confirm_text", { name: agent.name, team: target?.name ?? "" })}</p>
        {msg && !msg.ok && <p role="alert" className="text-sm font-semibold text-bad mt-2">{msg.text}</p>}
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ Tepkiler (kozmetik)
function ReactSection({ agent, t }: { agent: Agent; t: T }) {
  const st = useStudio((s) => s.states[agent.slug]);
  const busy = st?.state === "working" || st?.state === "thinking";
  const kinds: { k: ReactionKind; icon: React.ReactNode }[] = [
    { k: "wave", icon: <Hand size={15} /> }, { k: "clap", icon: <Sparkles size={15} /> }, { k: "highfive", icon: <Hand size={15} className="-scale-x-100" /> },
  ];
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-ink-2">{t("react_text")}</p>
      {busy && <p className="text-xs text-muted">{t("react_busy")}</p>}
      <div className="flex flex-wrap gap-2">
        {kinds.map(({ k, icon }) => (
          <Button key={k} className="min-h-11" icon={icon} onClick={() => fun.reaction(agent.slug, k)}>{t(`react_${k}` as const)}</Button>
        ))}
      </div>
    </div>
  );
}
