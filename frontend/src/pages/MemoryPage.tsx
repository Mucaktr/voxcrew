// Bellek grafı (canlı bilgi grafı) ve dinamik ontoloji haritası. Tuval renkleri temadan okunur (açık/koyu);
// hareket azaltmada yerleşim önceden hesaplanır, parçacık ve kayan kamera yok.
import clsx from "clsx";
import { Ban, Eraser, Maximize2, Network, Pencil, Pin, PinOff, RefreshCcw, RotateCcw, Search, Share2, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { useSearchParams } from "react-router-dom";
import { alpha, pillLabel, TYPE_TR, useThemeVars } from "../components/memory/shared";
import { OntologyMap } from "../components/memory/OntologyMap";
import { ForgetDialog, ForgetHistory } from "../components/memory/ForgetDialog";
import { Badge, Button, Empty, PageHeader, SectionTitle, Spinner, TabPanel, Tabs } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { timeAgo } from "../lib/format";
import { currentLocale, tp, useT } from "../lib/i18n";
import { factClaim, memoryApi, nsLabel, useNamespaces } from "../lib/memory";
import { useStudio } from "../lib/store";
import type { GraphEdge, GraphNode, OntologyDef } from "../lib/types";
import { forgetMsg } from "../locales/forget";
import { memoryMsg } from "../locales/memory";
import { useReducedMotion } from "../voxel/motion";

const MEMORY_TYPES = ["Agent", "Episode", "Concept", "Fact", "Task", "Tool", "Model"];
const NO_COUNTS: Record<string, number> = {};
const NS_TYPES = new Set(["Episode", "Fact", "Concept"]);

/** bellek düğümünün ad alanı rozeti (Episode/Fact: namespace; Concept: namespaces listesi; eski → genel).*/
function nodeNamespaces(n: GraphNode): string[] {
  if (n.type === "Concept") {
    const list = n.props.namespaces;
    return Array.isArray(list) && list.length ? list.map(String) : ["global"];
  }
  return [typeof n.props.namespace === "string" && n.props.namespace ? n.props.namespace : "global"];
}

function NamespaceBadges({ node }: { node: GraphNode }) {
  const t = useT(memoryMsg);
  if (!NS_TYPES.has(node.type)) return null;
  return <>{nodeNamespaces(node).map((ns) => (
    <Badge key={ns} tone={ns === "global" ? "muted" : "info"}>
      {ns === "global" ? t("ns_badge_global") : t("ns_badge", { key: nsLabel(ns) })}
    </Badge>
  ))}</>;
}

type FNode = GraphNode & { x?: number; y?: number; deg?: number };
type FLink = { source: string | FNode; target: string | FNode; type: string; weight: number };
const endId = (v: string | FNode) => (typeof v === "string" ? v : v.id);
/** Katalog paragrafındaki **kalın** ve `kod` işaretlerini biçime çevirir. */
const rich = (text: string): ReactNode[] => text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
  part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b>
    : part.startsWith("`") && part.endsWith("`") ? <code key={i} className="font-mono text-xs">{part.slice(1, -1)}</code>
      : <Fragment key={i}>{part}</Fragment>);

export default function MemoryPage() {
  const t = useT(memoryMsg);
  const [params] = useSearchParams();
  const [tab, setTab] = useState<"graph" | "ontology">(params.get("gorunum") === "ontoloji" ? "ontology" : "graph");
  const [onto, setOnto] = useState<OntologyDef | null>(null);
  const [types, setTypes] = useState<string[]>(MEMORY_TYPES);
  const stats = useStudio((s) => s.stats);
  useEffect(() => { api.ontology().then(setOnto).catch(() => undefined); }, []); // S39 (C-18): istek düşerse işlenmeyen ret yok
  const tabsId = useId();
  return (
    <div className="p-3 sm:p-5 flex flex-col gap-4 max-w-[1680px] mx-auto">
      <PageHeader title={t("page_title")}
        subtitle={t("page_subtitle")}
        meta={stats && <>
          <Badge tone="info"><Network size={12} aria-hidden="true" />{tp(memoryMsg, "nodes_count", stats.nodes)}</Badge>
          <Badge>{tp(memoryMsg, "edges_count", stats.edges)}</Badge>
          {onto && <Badge>{tp(memoryMsg, "types_count", onto.entities.length)} · {tp(memoryMsg, "relations_count", onto.relations.length)}</Badge>}
        </>} />
      <div className="panel overflow-hidden">
        <Tabs id={tabsId} value={tab} onChange={setTab} tabs={[{ value: "graph", label: t("tab_graph") }, { value: "ontology", label: t("tab_ontology") }]} />
        <TabPanel tabs={tabsId} value={tab}>
          {tab === "graph" ? <GraphView onto={onto} types={types} setTypes={setTypes} />
            : onto ? <OntologyMap onto={onto} counts={stats?.by_type ?? NO_COUNTS} onShowInGraph={(t) => { setTypes([t]); setTab("graph"); }} />
              : <div className="p-10 grid place-items-center"><Spinner /></div>}
        </TabPanel>
      </div>
    </div>
  );
}

function GraphView({ onto, types, setTypes }:
  { onto: OntologyDef | null; types: string[]; setTypes: (fn: (t: string[]) => string[]) => void }) {
  const t = useT(memoryMsg);
  const [params] = useSearchParams();
  const stats = useStudio((s) => s.stats);
  const vars = useThemeVars();
  const reduce = useReducedMotion();
  const [data, setData] = useState<{ nodes: FNode[]; links: FLink[] } | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  // "" = tüm graf (yönetici görünümü), "global" ya da "project:<k>" = yalnızca o bellek ad alanı
  const [project, setProject] = useState<string>(params.get("proje") ?? "");
  const { list: namespaces, isolation } = useNamespaces(true, stats?.nodes);
  const [focus, setFocus] = useState<string | null>(params.get("focus"));
  // unutma penceresindeki "okunur kalır" bağlantıları (/bellek?focus=…&proje=…) sayfa açıkken de odaklar
  useEffect(() => {
    const f = params.get("focus");
    const pr = params.get("proje");
    if (f) setFocus(f);
    if (pr !== null) setProject(pr);
  }, [params]);
  const [hover, setHover] = useState<string | null>(null);
  const [forgetProject, setForgetProject] = useState(false); // proje belleğini unut önizlemesi
  const tf = useT(forgetMsg);
  const wrap = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<FNode, FLink> | undefined>(undefined);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const colors = useMemo(() => Object.fromEntries((onto?.entities ?? []).map((e) => [e.name, e.color])), [onto]);
  const ms = reduce ? 0 : 600;

  const load = () => memoryApi.graph(types, 900, project || undefined).then((g) => {
    const deg: Record<string, number> = {};
    g.edges.forEach((e: GraphEdge) => { deg[e.src] = (deg[e.src] ?? 0) + 1; deg[e.dst] = (deg[e.dst] ?? 0) + 1; });
    setData({ nodes: g.nodes.map((n) => ({ ...n, deg: deg[n.id] ?? 0 })),
              links: g.edges.map((e) => ({ source: e.src, target: e.dst, type: e.type, weight: e.weight })) });
    // ad alanı süzgecinde sayılar süzülmüş görünümden (yüklenen düğümler), aksi hâlde tüm graftan
    if (project) {
      const by: Record<string, number> = {};
      g.nodes.forEach((n) => { by[n.type] = (by[n.type] ?? 0) + 1; });
      setCounts(by);
    } else setCounts(g.stats.by_type);
  });
  useEffect(() => { load(); }, [types.join(","), stats?.nodes, project]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const matches = useMemo(() => {
    const loc = currentLocale();
    const q = query.trim().toLocaleLowerCase(loc);
    return q && data ? new Set(data.nodes.filter((n) => n.label.toLocaleLowerCase(loc).includes(q)).map((n) => n.id)) : null;
  }, [query, data]);

  const active = hover ?? focus;
  const neighbors = useMemo(() => {
    if (!active || !data) return null;
    const s = new Set([active]);
    data.links.forEach((l) => {
      const a = endId(l.source), b = endId(l.target);
      if (a === active) s.add(b);
      if (b === active) s.add(a);
    });
    return s;
  }, [active, data]);
  const litLink = (l: FLink) => !!active && (endId(l.source) === active || endId(l.target) === active);
  const radius = (n: FNode) => 4.5 + Math.min(10, Math.sqrt(n.deg ?? 0) * 1.8) + (n.type === "Agent" ? 2.5 : 0);

  const centerOn = (id: string) => {
    setFocus(id);
    const n = data?.nodes.find((x) => x.id === id);
    if (n?.x != null && n.y != null) { fg.current?.centerAt(n.x, n.y, ms); fg.current?.zoom(2.4, ms); }
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const most = Math.max(1, ...Object.values(counts));

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col min-w-0">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b-2 border-line-soft">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input className="input !pl-9" placeholder={t("search_placeholder")} value={query} aria-label={t("search_label")}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && matches?.size) centerOn([...matches][0]); }} />
          </div>
          <Button size="sm" icon={<Maximize2 size={14} />} onClick={() => fg.current?.zoomToFit(ms, 50)} title={t("fit_graph")} aria-label={t("fit_graph")} />
          <Button size="sm" icon={<RefreshCcw size={14} />} onClick={load} title={t("refresh")} aria-label={t("refresh")} />
          <select className="select !w-auto max-w-full sm:max-w-64" value={project} aria-label={t("ns_filter_label")}
            title={t("ns_filter_hint")} onChange={(e) => { setFocus(null); setProject(e.target.value); }}>
            <option value="">{t("ns_all")}</option>
            {!namespaces.some((n) => n.namespace === "global") && <option value="global">{t("ns_global")}</option>}
            {project && project !== "global" && !namespaces.some((n) => n.namespace === project) &&
              <option value={project}>{nsLabel(project)}</option>}
            {namespaces.map((n) => (
              <option key={n.namespace} value={n.namespace}>
                {t("ns_option", { name: n.key ? n.name ?? n.key : t("ns_global"), episodes: n.episodes, facts: n.facts })}
              </option>
            ))}
          </select>
          {!isolation && <span className="chip tone-warn !whitespace-normal">{t("ns_isolation_off")}</span>}
          {project.startsWith("project:") && (
            <Button size="sm" variant="danger" icon={<Eraser size={14} />} title={tf("forget_project_title")}
              onClick={() => setForgetProject(true)}>{tf("forget_project")}</Button>
          )}
          <ForgetDialog open={forgetProject} onClose={() => setForgetProject(false)} scope="project" project={project}
            name={nsLabel(project)} onDone={() => { setFocus(null); load(); }} />
          {/* dar ekranda tek satır, yatay kayar; sm ve üstünde sarar */}
          <div className="w-full flex flex-nowrap sm:flex-wrap gap-1.5 overflow-x-auto sm:overflow-visible pb-1 sm:pb-0 [scrollbar-width:thin]"
            role="group" aria-label={t("shown_types")}>
            {(onto?.entities ?? []).map((e) => {
              const on = types.includes(e.name);
              return (
                <button key={e.name} type="button" aria-pressed={on} onClick={() => setTypes((t) => (on ? t.filter((x) => x !== e.name) : [...t, e.name]))}
                  className={clsx("chip shrink-0 min-h-6", !on && "border-dashed !text-muted")}>
                  <span className="h-2.5 w-2.5 rounded-full border-2" style={{ background: on ? e.color : "transparent", borderColor: on ? "var(--line)" : e.color }} />
                  {TYPE_TR[e.name] ?? e.name} <span className={on ? "text-ink-2" : undefined}>{counts[e.name] ?? 0}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div ref={wrap} className="relative h-[62vh] min-h-[420px] bg-panel-2 memory-canvas">
          {!data ? <div className="absolute inset-0 grid place-items-center"><Spinner /></div> :
            data.nodes.length === 0 ? (
              <Empty icon={<Network size={30} />} title={t("empty_title")}
                text={t("empty_text")} />
            ) : (
            <div role="img" aria-label={t("graph_aria", { nodes: data.nodes.length, edges: data.links.length })}
              className="absolute inset-0">
              <ForceGraph2D<FNode, FLink>
                ref={fg as never}
                graphData={data}
                width={size.w}
                height={size.h}
                backgroundColor="rgba(0,0,0,0)"
                warmupTicks={reduce ? 160 : 0}
                cooldownTicks={reduce ? 0 : 140}
                cooldownTime={4000}
                autoPauseRedraw={reduce || !active}
                onEngineStop={() => { if (!focus) fg.current?.zoomToFit(ms, 50); }}
                nodeRelSize={1}
                nodeVal={(n) => radius(n) ** 2}
                linkCurvature={0.12}
                linkColor={(l) => (litLink(l) ? vars.focus : alpha(vars["ink-2"], active ? 0.1 : 0.26))}
                linkWidth={(l) => (litLink(l) ? 2.2 : Math.min(3, 0.6 + Math.log2(1 + l.weight)))}
                linkDirectionalArrowLength={(l) => (litLink(l) ? 5 : 3)}
                linkDirectionalArrowRelPos={1}
                linkDirectionalArrowColor={(l) => (litLink(l) ? vars.focus : alpha(vars["ink-2"], active ? 0.12 : 0.4))}
                linkDirectionalParticles={(l) => (!reduce && litLink(l) ? 2 : 0)}
                linkDirectionalParticleWidth={2.6}
                linkDirectionalParticleSpeed={0.008}
                linkDirectionalParticleColor={() => vars.focus}
                onNodeHover={(n) => setHover(n?.id ?? null)}
                onNodeClick={(n) => centerOn(n.id)}
                onBackgroundClick={() => setFocus(null)}
                nodeCanvasObject={(n, ctx, scale) => {
                  const x = n.x!, y = n.y!, r = radius(n);
                  const dim = (matches && !matches.has(n.id)) || (neighbors && !neighbors.has(n.id));
                  const invalid = n.type === "Fact" && !!n.props.invalid_at;
                  const col = colors[n.type] ?? vars.muted;
                  ctx.globalAlpha = dim ? 0.16 : 1;
                  if (n.id === focus || n.id === hover || (matches?.has(n.id) ?? false)) {
                    ctx.beginPath(); ctx.arc(x, y, r + 5 / Math.min(1, scale), 0, Math.PI * 2); ctx.fillStyle = alpha(col, 0.28); ctx.fill();
                  }
                  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
                  ctx.fillStyle = invalid ? vars.panel : col;
                  ctx.fill();
                  if (invalid) ctx.setLineDash([3 / scale, 2 / scale]);
                  ctx.lineWidth = (n.id === focus ? 3 : 1.4) / scale;
                  ctx.strokeStyle = n.id === focus ? vars.focus : invalid ? vars.muted : vars.line;
                  ctx.stroke();
                  ctx.setLineDash([]);
                  if (invalid) { ctx.beginPath(); ctx.moveTo(x - r * 1.2, y); ctx.lineTo(x + r * 1.2, y); ctx.strokeStyle = vars["bad-fg"]; ctx.stroke(); }
                  if (n.props.pinned) {
                    ctx.beginPath(); ctx.arc(x + r * 0.75, y - r * 0.75, Math.max(2.5, r * 0.38), 0, Math.PI * 2);
                    ctx.fillStyle = vars.gold; ctx.fill(); ctx.strokeStyle = vars.line; ctx.stroke();
                  }
                  if (scale > 1.4 || n.id === focus || n.id === hover || (matches?.has(n.id) ?? false) || n.type === "Agent") {
                    const text = n.label.length > 42 ? `${n.label.slice(0, 40)}…` : n.label;
                    pillLabel(ctx, text, x, y + r + 2 / scale, 12 / scale, vars.ink, alpha(vars.panel, 0.92));
                  }
                  ctx.globalAlpha = 1;
                }}
                nodePointerAreaPaint={(n, color, ctx) => {
                  ctx.beginPath(); ctx.arc(n.x!, n.y!, radius(n) + 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
                }}
              />
            </div>
          )}
          {data && data.nodes.length > 0 && (
            <div className="absolute left-3 bottom-3 flex flex-wrap gap-1.5 pointer-events-none">
              <span className="chip">{tp(memoryMsg, "nodes_count", data.nodes.length)} · {tp(memoryMsg, "edges_count", data.links.length)}</span>
              <span className="chip hidden sm:inline-flex">{t("controls_hint")}</span>
            </div>
          )}
        </div>
      </div>
      <aside className="border-t-2 lg:border-t-0 lg:border-l-2 border-line-soft p-4 max-h-[75vh] overflow-y-auto">
        {focus ? <NodeDetail id={focus} colors={colors} project={project} onNavigate={centerOn} onClose={() => setFocus(null)} onChanged={load} /> : (
          <div className="flex flex-col gap-3 text-sm">
            <SectionTitle size="sm">{t("how_title")}</SectionTitle>
            <p className="text-ink-2">{rich(t("how_p1"))}</p>
            <p className="text-ink-2">{rich(t("how_p2"))}</p>
            <p className="text-ink-2">{rich(t("how_p3"))}</p>
            <ForgetHistory refreshKey={stats?.nodes} onChanged={load} />
            <SectionTitle as="h3" size="sm" className="mt-1">{t("by_type")} <span className="num text-muted font-medium">({total})</span></SectionTitle>
            <ul className="flex flex-col gap-1.5">
              {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, c]) => (
                <li key={t} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 rounded-full border border-line shrink-0" style={{ background: colors[t] }} />
                  <span className="font-semibold w-24 truncate">{TYPE_TR[t] ?? t}</span>
                  <span className="flex-1 h-2 rounded-full bg-panel-3 overflow-hidden" aria-hidden="true">
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(4, (c / most) * 100)}%`, background: colors[t] }} />
                  </span>
                  <span className="num w-8 text-right">{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

function NodeDetail({ id, colors, project, onNavigate, onClose, onChanged }: { id: string; colors: Record<string, string>; project: string; onNavigate: (id: string) => void; onClose: () => void; onChanged: () => void }) {
  const t = useT(memoryMsg);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.node>> | null>(null);
  const reload = () => api.node(id).then(setData).catch(() => undefined);
  useEffect(() => { setData(null); reload(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => { setActionError(null); }, [id]);
  const tf = useT(forgetMsg);
  const [forgetOpen, setForgetOpen] = useState(false); // bilgi/anı "Unut" önizlemesi
  const [forgotten, setForgotten] = useState(false);
  // iddia işlemleri yalnız kullanıcıdan; sürüm çatışmasında (409) düğüm yeniden yüklenir
  const run = async (op: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await op();
    } catch (e) {
      setActionError(e instanceof ApiError && e.status === 409 ? t("version_conflict")
        : t("action_failed", { msg: e instanceof Error ? e.message : String(e) }));
    }
    await reload();
    onChanged();
  };
  const factAction = (patch: { pinned?: boolean; invalid?: boolean; reason?: string }) =>
    run(() => memoryApi.factState(id, patch, project || undefined));  // süzgeç seçiliyse sunucu ad alanını denetler
  if (!data) return <Spinner />;
  const { node, neighbors } = data;
  const claim = node.type === "Fact" ? factClaim(node.props) : null;
  const current = !!claim && claim.lifecycle === "active" && !node.props.invalid_at;
  const fmtDate = (v: string | null) => (v ? v.slice(0, 10) : t("claim_bound_unknown"));
  const groups: Record<string, typeof neighbors> = {};
  neighbors.forEach((n) => { const k = `${n.dir === "out" ? "→" : "←"} ${n.edge.type}`; (groups[k] ??= []).push(n); });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <span className="mt-1 h-4 w-4 rounded-[4px] border-2 border-line shrink-0" style={{ background: colors[node.type] }} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1.5"><Badge>{TYPE_TR[node.type] ?? node.type}</Badge><NamespaceBadges node={node} /></div>
          <h2 className="t-h4 mt-1.5 break-words">{node.label}</h2>
          <p className="text-xs text-muted num mt-0.5">{t("created_ago", { ago: timeAgo(node.created_at) })}</p>
          {node.type === "Fact" && claim && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {node.props.pinned ? <Badge tone="warn"><Pin size={12} />{t("pinned_badge")}</Badge> : null}
              {node.props.invalid_at ? <Badge tone="bad" title={String(node.props.invalid_reason ?? "")}>{t("invalid_badge", { ago: timeAgo(String(node.props.invalid_at)) })}</Badge>
                : claim.lifecycle === "superseded" ? <Badge tone="warn">{t("claim_superseded")}</Badge>
                : <Badge tone="ok">{t("valid_badge")}</Badge>}
              {/* köken, epistemik durum, güven, görünürlük ve geçerlilik zamanı*/}
              <Badge title={t("claim_origin_title")}>{t(`claim_origin_${claim.origin}`)}</Badge>
              <Badge tone={claim.status === "verified" ? "ok" : claim.status === "disputed" ? "bad" : "muted"}>{t(`claim_status_${claim.status}`)}</Badge>
              {claim.status !== "verified" && claim.trust === "untrusted"
                ? <Badge tone="warn" title={t("claim_untrusted_title")}>{t("claim_untrusted")}</Badge>
                : <Badge tone="ok">{t("claim_trusted")}</Badge>}
              {claim.visibility === "private"
                ? <Badge tone="info" title={t("claim_private_title")}>{t("claim_private")}</Badge>
                : <Badge>{t("claim_shared")}</Badge>}
              <Badge>{claim.validFrom || claim.validTo
                ? t("claim_validity", { from: fmtDate(claim.validFrom), to: fmtDate(claim.validTo) })
                : t("claim_validity_unknown")}</Badge>
              {claim.confidence != null && <Badge title={t("model_estimate_title")}>{t("model_estimate", { v: claim.confidence.toFixed(2) })}</Badge>}
              {node.props.importance != null && <Badge title={t("model_estimate_title")}>{t("importance", { v: String(node.props.importance) })}</Badge>}
              {current && (
                <div className="w-full flex flex-wrap gap-1.5 mt-1">
                  {claim.status !== "verified" && (
                    <Button size="sm" icon={<ShieldCheck size={13} />} onClick={() => run(() => memoryApi.verifyFact(id, claim.version, project || undefined))}>{t("verify")}</Button>
                  )}
                  {claim.status !== "disputed" && (
                    <Button size="sm" icon={<TriangleAlert size={13} />} onClick={() => {
                      const reason = prompt(t("dispute_prompt"));
                      if (reason && reason.trim()) void run(() => memoryApi.disputeFact(id, reason.trim(), claim.version, project || undefined));
                    }}>{t("dispute")}</Button>
                  )}
                  <Button size="sm" icon={<Pencil size={13} />} onClick={() => {
                    const text = prompt(t("correct_prompt"), String(node.props.statement ?? node.label));
                    if (text && text.trim()) void run(() => memoryApi.correctFact(id, text.trim(), claim.version, project || undefined));
                  }}>{t("correct")}</Button>
                  {claim.visibility === "private" && (
                    <Button size="sm" icon={<Share2 size={13} />} onClick={() => run(() => memoryApi.promoteFact(id, project || undefined))}>{t("promote")}</Button>
                  )}
                </div>
              )}
              {actionError && <p role="alert" className="w-full text-xs text-bad">{actionError}</p>}
              <div className="w-full flex gap-1.5 mt-1">
                {!node.props.invalid_at && (
                  <Button size="sm" icon={node.props.pinned ? <PinOff size={13} /> : <Pin size={13} />} onClick={() => factAction({ pinned: !node.props.pinned })}>
                    {node.props.pinned ? t("unpin") : t("pin")}
                  </Button>
                )}
                {node.props.invalid_at
                  ? <Button size="sm" icon={<RotateCcw size={13} />} onClick={() => factAction({ invalid: false })}>{t("restore")}</Button>
                  : <Button size="sm" variant="danger" icon={<Ban size={13} />} onClick={() => {
                      const reason = prompt(t("invalid_reason_prompt")) ?? undefined;
                      factAction({ invalid: true, reason });
                    }}>{t("invalidate")}</Button>}
              </div>
            </div>
          )}
        </div>
        <Button size="sm" variant="ghost" icon={<X size={15} />} onClick={onClose} aria-label={t("close")} />
      </div>
      {(node.type === "Fact" || node.type === "Episode") && (
        <div className="flex">
          <Button size="sm" variant="danger" icon={<Eraser size={13} />} onClick={() => setForgetOpen(true)}>{tf("forget")}</Button>
          <ForgetDialog open={forgetOpen} scope={node.type === "Fact" ? "fact" : "episode"} id={node.id}
            project={project || undefined}
            onClose={() => { setForgetOpen(false); if (forgotten) onClose(); }}
            onDone={() => { setForgotten(true); onChanged(); }} />
        </div>
      )}
      <dl className="flex flex-col gap-1.5 text-dense">
        {Object.entries(node.props).filter(([k]) => !["avatar"].includes(k)).map(([k, v]) => (
          <div key={k} className="panel-soft px-2.5 py-1.5">
            <dt className="text-xs font-semibold text-muted font-mono">{k}</dt>
            <dd className="break-words whitespace-pre-wrap max-h-40 overflow-y-auto">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
          </div>
        ))}
      </dl>
      {Object.entries(groups).map(([rel, items]) => (
        <section key={rel}>
          <SectionTitle as="h3" size="sm" className="mb-1">{rel} <span className="num text-muted font-medium">({items.length})</span></SectionTitle>
          <ul className="flex flex-col gap-1">
            {items.slice(0, 25).map((n) => (
              <li key={n.edge.id}>
                <button type="button" onClick={() => onNavigate(n.node.id)} className="w-full text-left flex items-center gap-2 rounded-md px-2 py-1 hover:bg-panel-2 text-dense">
                  <span className="h-2.5 w-2.5 rounded-[3px] border border-line shrink-0" style={{ background: colors[n.node.type] }} />
                  <span className="truncate">{n.node.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
