// Ekip S50 — Çıktılar (/ciktilar, /ciktilar/:id): koşuların teslim ettiği raporlar ve dosyalar tek kütüphanede.
// Süzgeçler: ajan, ekip, proje, hedef, tür, tarih, sabitlenen/okunmamış; başlık ve içerikte arama. Seçilen çıktı sağda
// okunabilir belge olarak açılır (DeliverableViewer). Canlı: `deliverable.*` olaylarında liste tazelenir.
import clsx from "clsx";
import { BookOpen, CheckCheck, FolderOutput, Pin, RefreshCcw, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { DeliverableViewer } from "../components/deliverables/DeliverableViewer";
import { ZipButton } from "../components/deliverables/ZipDialog";
import { KindBadge } from "../components/deliverables/parts";
import { QualityBadge } from "../components/quality/QualityBadge";
import { QualityPanel } from "../components/quality/QualityPanel";
import { QualitySettingsPanel } from "../components/quality/QualitySettingsPanel";
import { DeliverableThank } from "../full/ui";
import { DeliverButton, DeliveryBadge, type DeliveredInfo } from "../components/delivery/DeliverButton";
import { PixelFace } from "../components/PixelFace";
import { Badge, Button, Empty, Field, PageHeader, Panel, Spinner, Toggle } from "../components/ui";
import { timeAgo } from "../lib/format";
import {
  DELIVERABLE_KINDS, deliverablesApi, onDeliverableEvent, refreshDeliverableUnread,
  type Deliverable, type DeliverableKind, type DeliverableList,
} from "../lib/deliverables";
import { currentLocale, useT } from "../lib/i18n";
import { useStudio } from "../lib/store";
import { deliverablesMsg as m } from "../locales/deliverables";

type DateRange = "" | "today" | "week" | "month";
const PAGE = 60;

function sinceOf(range: DateRange): string | undefined {
  if (!range) return undefined;
  const d = new Date();
  if (range === "today") d.setHours(0, 0, 0, 0);
  else d.setDate(d.getDate() - (range === "week" ? 7 : 30));
  return d.toISOString().slice(0, 10);
}

export default function OutputsPage() {
  const t = useT(m);
  const { id: routeId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const run = params.get("run") ?? "";
  const id = routeId ?? (params.get("d") || undefined);  // DELIV-P0: derin bağlantı /ciktilar?d=<çıktı> (eski /ciktilar/:id de çalışır)
  const agents = useStudio((s) => s.agents);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [agent, setAgent] = useState("");
  const [team, setTeam] = useState("");
  const [project, setProject] = useState("");
  const [goal, setGoal] = useState("");
  const [kind, setKind] = useState<DeliverableKind | "">("");
  const [range, setRange] = useState<DateRange>("");
  const [pinned, setPinned] = useState(false);
  const [unread, setUnread] = useState(false);
  const [recipe, setRecipe] = useState("");  // FOLLOWUP: tarif süzgeci ("*" = herhangi bir tarif)
  const [limit, setLimit] = useState(PAGE);
  const [data, setData] = useState<DeliverableList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const h = window.setTimeout(() => setQ(qInput.trim()), 300);
    return () => window.clearTimeout(h);
  }, [qInput]);

  const query = useMemo(() => ({ q, agent, team, project, goal, kind, run, since: sinceOf(range), pinned, unread, limit, recipe }),
    [q, agent, team, project, goal, kind, run, range, pinned, unread, limit, recipe]);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    deliverablesApi.list(query)
      .then((res) => { if (mine === seq.current) { setData(res); setError(null); } })
      .catch((e: unknown) => { if (mine === seq.current) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, [query]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    let h: number | undefined;
    const off = onDeliverableEvent(() => { window.clearTimeout(h); h = window.setTimeout(reload, 250); });
    return () => { off(); window.clearTimeout(h); };
  }, [reload]);

  const filtered = !!(q || agent || team || project || goal || kind || range || pinned || unread || run || recipe);
  const clear = () => {
    setQInput(""); setQ(""); setAgent(""); setTeam(""); setProject(""); setGoal(""); setKind(""); setRange("");
    setPinned(false); setUnread(false); setRecipe("");
    if (run) setParams((p) => { const n = new URLSearchParams(p); n.delete("run"); return n; }, { replace: true });
  };
  const open = (did: string) => navigate(`/ciktilar?d=${encodeURIComponent(did)}${run ? `&run=${encodeURIComponent(run)}` : ""}`);
  const onChanged = useCallback((item: Deliverable) => {
    setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === item.id ? item : x)) } : d));
    refreshDeliverableUnread(100);
  }, []);
  const readAll = async () => {
    try { await deliverablesApi.readAll(); reload(); refreshDeliverableUnread(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const facets = data?.facets;
  const agentName = (slug?: string | null) => agents.find((a) => a.slug === slug)?.name ?? slug ?? "—";
  const projectLabel = (p: string) => (p === "global" ? t("project_global") : p.replace(/^project:/, ""));
  const opts = (rec?: Record<string, number>) => Object.entries(rec ?? {}).sort((a, b) => b[1] - a[1]);
  const recipeTitle = (rid: string) => { const r = data?.recipes?.[rid]; return (r ? (currentLocale() === "en" ? r.en : r.tr) : "") || rid; };
  const recipeOpts = opts(facets?.recipe);

  return (
    <div className="p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
      <PageHeader title={t("nav")} subtitle={t("page_subtitle")}
        meta={data && data.unread > 0 ? <Badge tone="ok">{t("unread_total", { n: data.unread })}</Badge> : undefined}
        actions={<>
          <Button icon={<RefreshCcw size={15} />} onClick={reload}>{t("refresh")}</Button>
          {!!data?.unread && <Button icon={<CheckCheck size={15} />} onClick={() => { void readAll(); }}>{t("mark_all_read")}</Button>}
        </>} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] items-start">
        <div className={clsx("flex flex-col gap-3 min-w-0", id && "hidden lg:flex")}>
          <Panel>
            <div role="group" aria-label={t("filters_label")} className="grid grid-cols-2 gap-2 pt-3">
              <Field label={t("search")} className="col-span-2">
                <span className="relative block">
                  <Search size={15} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                  <input className="input !pl-8 w-full" type="search" aria-label={t("search")} placeholder={t("search_placeholder")}
                    value={qInput} onChange={(e) => setQInput(e.target.value)} />
                </span>
              </Field>
              <Field label={t("filter_agent")}>
                <select className="select" aria-label={t("filter_agent")} value={agent} onChange={(e) => setAgent(e.target.value)}>
                  <option value="">{t("all")}</option>
                  {opts(facets?.agent).map(([slug, n]) => <option key={slug} value={slug}>{agentName(slug)} ({n})</option>)}
                </select>
              </Field>
              <Field label={t("filter_kind")}>
                <select className="select" aria-label={t("filter_kind")} value={kind} onChange={(e) => setKind(e.target.value as DeliverableKind | "")}>
                  <option value="">{t("all")}</option>
                  {DELIVERABLE_KINDS.map((k) => <option key={k} value={k}>{t(`kind_${k}` as "kind_report")}{facets?.kind[k] ? ` (${facets.kind[k]})` : ""}</option>)}
                </select>
              </Field>
              <Field label={t("filter_team")}>
                <select className="select" aria-label={t("filter_team")} value={team} onChange={(e) => setTeam(e.target.value)}>
                  <option value="">{t("all")}</option>
                  {opts(facets?.team).map(([slug, n]) => <option key={slug} value={slug}>{slug} ({n})</option>)}
                </select>
              </Field>
              <Field label={t("filter_project")}>
                <select className="select" aria-label={t("filter_project")} value={project} onChange={(e) => setProject(e.target.value)}>
                  <option value="">{t("all")}</option>
                  {opts(facets?.project).map(([p, n]) => <option key={p} value={p}>{projectLabel(p)} ({n})</option>)}
                </select>
              </Field>
              <Field label={t("filter_goal")}>
                <select className="select" aria-label={t("filter_goal")} value={goal} onChange={(e) => setGoal(e.target.value)}>
                  <option value="">{t("all")}</option>
                  {opts(facets?.goal).map(([g, n]) => <option key={g} value={g}>{data?.goals[g] ?? g} ({n})</option>)}
                </select>
              </Field>
              <Field label={t("filter_date")}>
                <select className="select" aria-label={t("filter_date")} value={range} onChange={(e) => setRange(e.target.value as DateRange)}>
                  <option value="">{t("date_any")}</option>
                  <option value="today">{t("date_today")}</option>
                  <option value="week">{t("date_week")}</option>
                  <option value="month">{t("date_month")}</option>
                </select>
              </Field>
              {recipeOpts.length > 0 && (
                <div className="col-span-2 flex flex-wrap gap-1.5" role="group" aria-label={t("filter_recipe")}>
                  <button type="button" className={clsx("chip", recipe === "*" ? "border-ink-2 font-semibold" : "hover:border-ink-2")}
                    aria-pressed={recipe === "*"} onClick={() => setRecipe(recipe === "*" ? "" : "*")}>
                    <BookOpen size={12} aria-hidden />{t("recipe_any")}
                  </button>
                  {recipeOpts.map(([rid, n]) => (
                    <button key={rid} type="button" className={clsx("chip", recipe === rid ? "border-ink-2 font-semibold" : "hover:border-ink-2")}
                      aria-pressed={recipe === rid} onClick={() => setRecipe(recipe === rid ? "" : rid)}>
                      {recipeTitle(rid)} <span className="num text-muted">({n})</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="col-span-2 flex flex-col gap-2">
                <Toggle checked={pinned} onChange={setPinned} label={t("only_pinned")} />
                <Toggle checked={unread} onChange={setUnread} label={t("only_unread")} />
              </div>
              {run && (
                <div className="col-span-2">
                  <button type="button" className="chip hover:border-ink-2 !whitespace-normal break-all" onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.delete("run"); return n; }, { replace: true })}>
                    {t("from_run", { title: run })}<X size={12} aria-hidden />
                  </button>
                </div>
              )}
            </div>
          </Panel>
          <QualitySettingsPanel />
          <Panel title={t("list_label")} icon={<FolderOutput size={16} aria-hidden />}
            actions={data ? <>{run && data.items.length > 0 && <ZipButton target={{ runId: run }} />}<span className="text-xs text-muted num">{t("count", { n: data.total })}</span></> : undefined}>
            <div className="max-h-[70vh] overflow-y-auto -mx-1 px-1">
              {error ? <p className="text-sm font-semibold text-bad p-3" role="alert">{t("load_error", { error })}</p>
                : loading && !data ? <div className="grid place-items-center py-10"><Spinner size={22} /></div>
                : !data?.items.length ? (
                  <Empty icon={<FolderOutput size={26} />} title={filtered ? t("empty_filtered") : t("empty_title")}
                    text={filtered ? undefined : t("empty_text")}
                    action={filtered ? <Button onClick={clear}>{t("clear_filters")}</Button> : undefined} />
                ) : (
                  <ul className="flex flex-col gap-1.5" aria-label={t("list_label")}>
                    {data.items.map((d) => {
                      const a = agents.find((x) => x.slug === d.agent);
                      return (
                        <li key={d.id}>
                          <button type="button" onClick={() => open(d.id)} aria-pressed={id === d.id}
                            className={clsx("card-select w-full text-left p-2.5 flex flex-col gap-1 min-w-0", d.unread && "border-ink-2")}>
                            <span className="flex items-center gap-1.5 min-w-0 text-sm">
                              {d.unread && <><span className="h-2 w-2 rounded-full bg-accent shrink-0" aria-hidden /><span className="sr-only">{t("unread_dot")}</span></>}
                              <KindBadge kind={d.kind} />
                              {d.pinned && <Pin size={13} className="text-warn shrink-0" aria-label={t("pinned")} />}
                              <span className="min-w-0 flex-1 truncate text-xs text-muted inline-flex items-center gap-1">
                                {a && <PixelFace avatar={a.avatar} size={16} ring={a.color} />}
                                <span className="truncate">{a?.name ?? d.agent ?? ""}</span>
                              </span>
                              <span className="text-xs text-muted shrink-0 num">{timeAgo(d.created_at)}</span>
                            </span>
                            <span className={clsx("text-sm break-words", d.unread ? "font-semibold" : "font-medium")}>{d.title}</span>
                            {d.source === "file" && d.run_title && <span className="text-xs text-muted truncate">{t("from_run", { title: d.run_title })}</span>}
                            {d.summary && <span className="text-xs text-muted line-clamp-2 break-words whitespace-pre-line">{d.summary}</span>}
                            {(d.quality || d.recipe) && (
                              <span className="flex flex-wrap gap-1">
                                {d.quality && <QualityBadge quality={d.quality} />}
                                {d.recipe && <Badge tone="info">{t("recipe_badge", { title: recipeTitle(d.recipe) })}</Badge>}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              {data && data.items.length < data.total && (
                <div className="pt-2 grid place-items-center">
                  <Button size="sm" onClick={() => setLimit((n) => n + PAGE)}>{t("load_more")}</Button>
                </div>
              )}
            </div>
          </Panel>
        </div>

        <div className={clsx("min-w-0", !id && "hidden lg:block")}>
          {id ? (
            <div className="flex flex-col gap-2 min-w-0">
              {/* W1c: çıktıya bağlı takdir */}
              <div className="flex flex-wrap items-center justify-end gap-2">
                {/* CG-DELIVER: teslim et + son teslim rozeti */}
                {(() => {
                  const sel = data?.items.find((x) => x.id === id) as (Deliverable & { delivery?: DeliveredInfo }) | undefined;
                  return sel ? <><DeliveryBadge key={`b-${id}`} id={id} initial={sel.delivery} /><DeliverButton key={`d-${id}`} item={sel} /></> : null;
                })()}
                <DeliverableThank key={id} id={id} item={data?.items.find((x) => x.id === id)} />
              </div>
              {/* CG-QUALITY: kalite rozeti + bulgular + kararlar */}
              <QualityPanel key={`q-${id}`} deliverableId={id} defaultOpen />
              <DeliverableViewer key={id} id={id} onChanged={onChanged}
                onBack={() => navigate(`/ciktilar${run ? `?run=${encodeURIComponent(run)}` : ""}`)} />
            </div>
          ) : (
            <Panel><Empty icon={<FolderOutput size={28} />} title={t("pick_title")} text={t("pick_text")} /></Panel>
          )}
        </div>
      </div>
    </div>
  );
}
