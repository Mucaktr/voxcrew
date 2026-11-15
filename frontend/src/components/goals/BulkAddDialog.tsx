// Ekip S10 — toplu hedef ekleme: çok satırlı metin, canlı ayrıştırma önizlemesi, hatalı satır vurgusu, örnek metin.
import clsx from "clsx";
import { AlertTriangle, CalendarClock, Eraser, Flag, ListPlus, Sparkles } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  flattenGoals, formatDate, GoalApiError, goalsApi, LEVEL_META, parseBulk, PRIORITY_META, resolveBulk, sampleBulkText,
  type BulkResult, type Goal, type GoalLevel, type LineError, type ParsedGoal,
} from "../../lib/goals";
import { fmtPercent, useT } from "../../lib/i18n";
import { goalsMsg as m } from "../../locales/goals";
import { Badge, Button, Field, Modal, Segmented } from "../ui";
import { OwnerChip, type OwnerLookup } from "./GoalBadges";

const LINE_REM = 1.5; // satır yüksekliği (rem) — numara sütunu ile metin alanı aynı ritimde

export function BulkAddDialog({ open, onClose, onDone, goals, lookup, initialParent, initialSample }:
  { open: boolean; onClose: () => void; onDone: (r: BulkResult) => void; goals: Goal[]; lookup: OwnerLookup;
    initialParent?: string | null; initialSample?: boolean }) {
  const t = useT(m);
  const [text, setText] = useState("");
  const [level, setLevel] = useState<GoalLevel>("company");
  const [ownerTeam, setOwnerTeam] = useState("");
  const [ownerAgent, setOwnerAgent] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<{ text: string; message: string; errors: LineError[] } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const ids = { text: useId(), errors: useId(), help: useId(), status: useId() };

  const visibleAgents = useMemo(() => lookup.agents.filter((a) => !a.hidden), [lookup.agents]);
  const sample = () => sampleBulkText(lookup.teams[0]?.slug, visibleAgents[0]?.slug);

  useEffect(() => {
    if (!open) return;
    setText(initialSample ? sampleBulkText(lookup.teams[0]?.slug, visibleAgents[0]?.slug) : "");
    setLevel("company");
    setOwnerTeam("");
    setOwnerAgent("");
    setParent(initialParent ?? "");
    setServerError(null);
    setScrollTop(0);
  }, [open, initialParent, initialSample]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => {
    const agentSlugs = lookup.agents.map((a) => a.slug);
    const teamSlugs = lookup.teams.map((x) => x.slug);
    const res = parseBulk(text, { agents: agentSlugs, teams: teamSlugs });
    const agentTeam: Record<string, string | null> = {};
    lookup.agents.forEach((a) => { agentTeam[a.slug] = a.team ?? null; });
    const base = { level, owner_team: level === "team" ? ownerTeam || null : null, owner_agent: level === "agent" ? ownerAgent || null : null };
    const resolveErrors = resolveBulk(res.goals, base, agentTeam, new Set(teamSlugs)); // önizlemede sahipler hep görünsün
    // sahip seçilmemişse seçici zaten işaretli: her kök satır için aynı hatayı listeleme
    const ownerMissing = (level === "team" && !ownerTeam) || (level === "agent" && !ownerAgent);
    return { ...res, errors: [...res.errors, ...(ownerMissing ? [] : resolveErrors)] };
  }, [text, level, ownerTeam, ownerAgent, lookup.agents, lookup.teams]);

  const errors = useMemo(() => {
    const local = parsed.errors.filter((e) => e.line !== 0 || text.trim());
    if (serverError && serverError.text === text) return [...local, ...serverError.errors.filter((e) => !local.some((l) => l.line === e.line && l.message === e.message))];
    return local;
  }, [parsed.errors, serverError, text]);
  const errorLines = useMemo(() => new Set(errors.map((e) => e.line).filter((n): n is number => !!n)), [errors]);
  const lineCount = Math.max(1, text.split(/\r\n|\r|\n/).length);
  const parentOptions = useMemo(() => flattenGoals(goals), [goals]);
  const needOwner = (level === "team" && !ownerTeam) || (level === "agent" && !ownerAgent);
  const canSubmit = !!text.trim() && parsed.count > 0 && !errors.length && !needOwner && !busy;

  const focusLine = (line?: number) => {
    const ta = area.current;
    if (!ta || !line) return;
    const lines = ta.value.split("\n");
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    ta.focus();
    ta.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
    const lh = parseFloat(getComputedStyle(document.documentElement).fontSize) * LINE_REM;
    ta.scrollTop = Math.max(0, (line - 3) * lh);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setServerError(null);
    try {
      const result = await goalsApi.bulk({
        text, level,
        owner_team: level === "team" ? ownerTeam : undefined,
        owner_agent: level === "agent" ? ownerAgent : undefined,
        parent: parent || undefined,
      });
      onDone(result);
      onClose();
    } catch (e) {
      const err = e instanceof GoalApiError ? e : null;
      setServerError({ text, message: e instanceof Error ? e.message : String(e), errors: err?.errors ?? [] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={1040} title={t("bulk_title")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button variant="primary" icon={<ListPlus size={16} />} disabled={!canSubmit} onClick={submit}>
          {busy ? t("adding") : parsed.count ? t("add_n", { n: parsed.count }) : t("add")}
        </Button>
      </>}>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 min-w-0">
          <div className="flex flex-wrap gap-3 items-end">
            <Field label={t("root_level")}>
              <Segmented value={level} onChange={setLevel}
                options={(["company", "team", "agent"] as GoalLevel[]).map((l) => ({ value: l, label: LEVEL_META[l].label }))} />
            </Field>
            {level === "team" && (
              <Field label={t("owner_team")} className="min-w-0 flex-1 basis-40">
                <select className="select" value={ownerTeam} onChange={(e) => setOwnerTeam(e.target.value)} aria-invalid={!ownerTeam}>
                  <option value="">{t("pick_team")}</option>
                  {lookup.teams.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
                </select>
              </Field>
            )}
            {level === "agent" && (
              <Field label={t("owner_agent")} className="min-w-0 flex-1 basis-40">
                <select className="select" value={ownerAgent} onChange={(e) => setOwnerAgent(e.target.value)} aria-invalid={!ownerAgent}>
                  <option value="">{t("pick_agent")}</option>
                  {visibleAgents.map((a) => <option key={a.slug} value={a.slug}>{a.name}{a.title ? ` — ${a.title}` : ""}</option>)}
                </select>
              </Field>
            )}
          </div>
          {level === "team" && !lookup.teams.length && (
            <p className="text-xs text-warn font-semibold">{t("no_teams_yet")}</p>
          )}
          <Field label={t("parent_optional")}>
            <select className="select" value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">{t("parent_none_root")}</option>
              {parentOptions.map(({ goal, depth }) => (
                <option key={goal.id} value={goal.id}>{`${"— ".repeat(depth)}${goal.title}`}</option>
              ))}
            </select>
          </Field>

          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <label htmlFor={ids.text} className="label flex-1 min-w-40">{t("goals_label")}</label>
              <Button size="sm" variant="ghost" icon={<Sparkles size={14} />} onClick={() => setText(sample())}
                disabled={!!text.trim()} title={text.trim() ? t("clear_first") : undefined}>{t("sample_text")}</Button>
              <Button size="sm" variant="ghost" icon={<Eraser size={14} />} onClick={() => { setText(""); area.current?.focus(); }}
                disabled={!text}>{t("clear")}</Button>
            </div>
            <div className="relative min-w-0">
              <div aria-hidden="true" className="absolute overflow-hidden rounded-l-lg bg-panel-3 pointer-events-none select-none"
                style={{ left: 2, top: 2, bottom: 2, width: "2.75rem" }}>
                <div className="font-mono text-xs text-right tabular-nums" style={{ paddingTop: "0.5rem", transform: `translateY(${-scrollTop}px)` }}>
                  {Array.from({ length: lineCount }, (_, i) => (
                    <div key={i} className={clsx("pr-2", errorLines.has(i + 1) ? "bg-bad-soft text-bad font-semibold" : "text-muted")}
                      style={{ height: `${LINE_REM}rem`, lineHeight: `${LINE_REM}rem` }}>
                      {errorLines.has(i + 1) ? `!${i + 1}` : i + 1}
                    </div>
                  ))}
                </div>
              </div>
              <textarea id={ids.text} ref={area} className="textarea font-mono" rows={12} wrap="off" spellCheck={false}
                value={text} onChange={(e) => setText(e.target.value)} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                aria-invalid={errors.length > 0} aria-describedby={`${ids.help} ${ids.errors} ${ids.status}`}
                placeholder={t("bulk_placeholder")}
                style={{ paddingLeft: "3.5rem", lineHeight: `${LINE_REM}rem`, whiteSpace: "pre", overflowX: "auto", minHeight: "16rem" }} />
            </div>
            <details id={ids.help} className="text-xs text-ink-2 leading-5">
              <summary className="cursor-pointer font-semibold text-ink-2 w-fit">{t("syntax")}</summary>
              <ul className="mt-1.5 flex flex-col gap-1 list-disc pl-5">
                <li>{t("syntax_1a")}<code className="font-mono">- </code>{t("syntax_1b")}</li>
                <li>{t("syntax_2a")}<strong>{t("syntax_2b")}</strong>{t("syntax_2c")}</li>
                <li><code className="font-mono">KR:</code>{t("syntax_3a")}<code className="font-mono">= 10</code>{t("syntax_3b")}<code className="font-mono">= %80</code>{t("syntax_3c")}</li>
                <li>{t("syntax_4a")}<code className="font-mono">!high</code>{t("syntax_4b")}<code className="font-mono">due:2026-12-31</code>{t("syntax_4c")}<code className="font-mono">#team</code>, <code className="font-mono">@agent</code>{t("syntax_4d")}</li>
                <li>{t("syntax_5")}</li>
              </ul>
            </details>
          </div>

          {errors.length > 0 && (
            <div id={ids.errors} className="panel-soft p-3 flex flex-col gap-1.5 !border-bad">
              <p className="text-sm font-semibold text-bad flex items-center gap-1.5">
                <AlertTriangle size={15} aria-hidden="true" />
                {serverError && serverError.text === text && !serverError.errors.length ? serverError.message : t("n_line_errors", { n: errors.length })}
              </p>
              <ul className="flex flex-col gap-0.5">
                {errors.slice(0, 12).map((e, i) => (
                  <li key={i}>
                    {e.line ? (
                      <button type="button" className="text-left text-xs text-ink-2 hover:text-ink hover:underline underline-offset-2"
                        onClick={() => focusLine(e.line)}>
                        <span className="font-semibold text-bad">{t("line_n", { n: e.line })}</span> {e.message}
                      </button>
                    ) : <span className="text-xs text-ink-2">{e.message}</span>}
                  </li>
                ))}
                {errors.length > 12 && <li className="text-xs text-muted">{t("more_errors", { n: errors.length - 12 })}</li>}
              </ul>
            </div>
          )}
          {serverError && serverError.text === text && !errors.length && (
            <p role="alert" className="text-sm font-semibold text-bad">{serverError.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="label">{t("preview")}</span>
            <span id={ids.status} className="text-xs text-ink-2" aria-live="polite">
              {parsed.count ? t("preview_count", { goals: parsed.count, krs: parsed.krCount }) : t("preview_empty")}
              {errors.length > 0 && <span className="text-bad font-semibold">{t("n_errors", { n: errors.length })}</span>}
            </span>
          </div>
          <div className="panel-soft p-3 min-h-[12rem] max-h-[28rem] overflow-y-auto">
            {parsed.goals.length ? (
              <PreviewList goals={parsed.goals} lookup={lookup} errorLines={errorLines} depth={0} />
            ) : (
              <p className="text-sm text-muted py-6 text-center">{t("preview_hint")}</p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function PreviewList({ goals, lookup, errorLines, depth }:
  { goals: ParsedGoal[]; lookup: OwnerLookup; errorLines: Set<number>; depth: number }) {
  const t = useT(m);
  return (
    <ul className={clsx("flex flex-col gap-2 min-w-0", depth > 0 && "mt-2 ml-2 pl-3 border-l-2 border-line-soft")}>
      {goals.map((g) => {
        const bad = errorLines.has(g.line) || g.key_results.some((k) => errorLines.has(k.line));
        return (
          <li key={g.line} className="min-w-0">
            <div className={clsx("rounded-lg px-2 py-1.5", bad && "bg-bad-soft")}>
              <div className="flex items-start gap-2 min-w-0">
                <span className="font-mono text-xs text-muted tabular-nums pt-0.5 shrink-0" aria-label={t("line_label", { n: g.line })}>{g.line}</span>
                <span className="text-sm font-semibold text-ink break-words min-w-0">{g.title}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1 pl-6">
                {g.level && <OwnerChip goal={{ level: g.level, owner_team: g.owner_team, owner_agent: g.owner_agent }} lookup={lookup} />}
                {g.priority && g.priority !== "medium" && (
                  <Badge tone={PRIORITY_META[g.priority].tone}><Flag size={12} aria-hidden="true" />{PRIORITY_META[g.priority].label}</Badge>
                )}
                {g.due && <Badge><CalendarClock size={12} aria-hidden="true" />{formatDate(g.due)}</Badge>}
              </div>
              {g.key_results.length > 0 && (
                <ul className="mt-1.5 pl-6 flex flex-col gap-0.5">
                  {g.key_results.map((k) => (
                    <li key={k.line} className={clsx("text-xs flex gap-1.5", errorLines.has(k.line) ? "text-bad font-semibold" : "text-ink-2")}>
                      <span className="font-semibold text-accent shrink-0">KR</span>
                      <span className="break-words min-w-0">{k.title}{k.target !== null && <span className="text-muted"> → {k.unit === "%" ? fmtPercent(k.target) : `${k.target}${k.unit ? ` ${k.unit}` : ""}`}</span>}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {g.children.length > 0 && <PreviewList goals={g.children} lookup={lookup} errorLines={errorLines} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}
