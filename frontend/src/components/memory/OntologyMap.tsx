// Dinamik ontoloji haritası: türler alanlarına göre kümelenen kuvvet yerleşimli düğümler, ilişkiler yönlü eğriler.
// Düğüm boyu ve içindeki sayı grafta o türden kaç kayıt olduğunu canlı gösterir (SSE ile güncellenen istatistik);
// sayı artınca düğüm kısa bir halka yayar. Hareket azaltmada yerleşim sabittir: simülasyon, parçacık ve halka yok.
import clsx from "clsx";
import { ArrowRight, Maximize2, Search, Shuffle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { currentLocale, fmtNumber, tp, tx, useT } from "../../lib/i18n";
import { inkOn } from "../../lib/office";
import type { OntologyDef } from "../../lib/types";
import { memoryMsg } from "../../locales/memory";
import { useReducedMotion } from "../../voxel/motion";
import { Badge, Button, SectionTitle, Segmented } from "../ui";
import {
  alpha, clusterForce, collideForce, DOMAIN_VAR, DOMAINS, domainOf, pillLabel, TYPE_TR, useThemeVars, type DomainId,
} from "./shared";

type Entity = OntologyDef["entities"][number];
interface ONode { id: string; e: Entity; domain: DomainId; count: number; x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number }
interface OLink { id: string; source: string | ONode; target: string | ONode; rel: string; desc: string; curvature: number; loop: number }

const idOf = (v: string | ONode) => (typeof v === "string" ? v : v.id);
const radius = (n: ONode) => 20 + Math.min(16, Math.log2(1 + n.count) * 4);
const SX = 430, SY = 310;
const DOMAIN_POS: Record<DomainId, [number, number]> = {
  org: [-1, -0.55], work: [0.95, -0.5], memory: [0.8, 0.9], infra: [-1, 0.8], external: [-0.05, 1.15], other: [0, 0],
};
const center = (d: DomainId) => ({ x: DOMAIN_POS[d][0] * SX, y: DOMAIN_POS[d][1] * SY });
const fmt = (n: number) => {
  if (n < 1000) return fmtNumber(n);
  const d = n >= 10000 ? 0 : 1;
  return tx(memoryMsg, "thousands", { n: fmtNumber(n / 1000, { minimumFractionDigits: d, maximumFractionDigits: d }) });
};
const domainLabel = (d: DomainId) => DOMAINS.find((x) => x.id === d)?.label ?? tx(memoryMsg, "domain_other");

/** Başlangıç yerleşimi: her alan kendi merkezinde halka (hareket azaltmada son yerleşim de budur). */
function seed(nodes: ONode[]) {
  const by = new Map<DomainId, ONode[]>();
  nodes.forEach((n) => by.set(n.domain, [...(by.get(n.domain) ?? []), n]));
  by.forEach((ms, d) => {
    const c = center(d), R = ms.length > 1 ? 50 + ms.length * 18 : 0;
    ms.forEach((n, k) => {
      const a = (k / ms.length) * Math.PI * 2 - Math.PI / 2;
      n.x = c.x + Math.cos(a) * R; n.y = c.y + Math.sin(a) * R;
    });
  });
}

function build(onto: OntologyDef): { nodes: ONode[]; links: OLink[] } {
  const nodes: ONode[] = onto.entities.map((e) => ({ id: e.name, e, domain: domainOf(e.name), count: 0 }));
  const raw = onto.relations.flatMap((r) => r.from.flatMap((f) => r.to.map((t) => ({ rel: r.name, desc: r.description, f, t }))));
  const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const total = new Map<string, number>();
  raw.forEach((x) => total.set(pair(x.f, x.t), (total.get(pair(x.f, x.t)) ?? 0) + 1));
  const seen = new Map<string, number>();
  const links: OLink[] = raw.map((x) => {
    const k = pair(x.f, x.t), i = seen.get(k) ?? 0, n = total.get(k) ?? 1;
    seen.set(k, i + 1);
    // aynı çiftteki ilişkiler farklı eğrilerde; öz-ilişki halka olarak çizilir
    const curvature = x.f === x.t ? 0.6 + i * 0.35 : n === 1 ? 0 : (i - (n - 1) / 2) * 0.32 * (x.f < x.t ? 1 : -1);
    return { id: `${x.rel}:${x.f}:${x.t}`, source: x.f, target: x.t, rel: x.rel, desc: x.desc, curvature, loop: x.f === x.t ? i : -1 };
  });
  seed(nodes);
  return { nodes, links };
}

export function OntologyMap({ onto, counts, onShowInGraph }:
  { onto: OntologyDef; counts: Record<string, number>; onShowInGraph: (type: string) => void }) {
  const t = useT(memoryMsg);
  const vars = useThemeVars();
  const reduce = useReducedMotion();
  const data = useMemo(() => build(onto), [onto]);
  const fg = useRef<ForceGraphMethods<ONode, OLink> | undefined>(undefined);
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverRel, setHoverRel] = useState<string | null>(null);
  const [selRel, setSelRel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<"domains" | "free">("domains");
  const [shown, setShown] = useState<Set<DomainId>>(() => new Set([...DOMAINS.map((d) => d.id), "other"] as DomainId[]));
  const flash = useRef<Record<string, number>>({});
  const prev = useRef<Record<string, number> | null>(null);
  /** kullanıcı yakınlaştırdı/kaydırdı/sürükledi: yerleşim oturdukça kendiliğinden sığdırma durur */
  const userMoved = useRef(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // canlı sayılar: düğüm boyu güncellenir; artan tür kısa bir halka yayar
  useEffect(() => {
    const now = performance.now();
    let changed = false;
    for (const n of data.nodes) {
      const c = counts[n.id] ?? 0;
      if (prev.current && c > (prev.current[n.id] ?? 0) && !reduce) flash.current[n.id] = now;
      if (c !== n.count) { n.count = c; changed = true; }
    }
    prev.current = { ...counts };
    if (changed && !reduce) fg.current?.d3ReheatSimulation();
  }, [counts, data, reduce]);

  // kuvvetler: alan kümeleri + çarpışma; hareket azaltmada başlangıç halkasına sabitlenir
  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    (g.d3Force("charge") as unknown as { strength?: (v: number) => unknown } | undefined)?.strength?.(-320);
    const link = g.d3Force("link") as unknown as { distance?: (v: number) => unknown; strength?: (f: (l: OLink) => number) => unknown } | undefined;
    link?.distance?.(150);
    // alan içi bağlar sıkı, alanlar arası gevşek: kümeler birbirine girmez
    link?.strength?.((l) => (domainOf(idOf(l.source)) === domainOf(idOf(l.target)) ? 0.3 : 0.03));
    g.d3Force("collide", collideForce<ONode>((n) => radius(n) + 30) as never);
    g.d3Force("cluster", (layout === "domains" ? clusterForce<ONode>((n) => center(n.domain), 0.2) : null) as never);
    if (reduce) {
      seed(data.nodes);
      data.nodes.forEach((n) => { n.fx = n.x; n.fy = n.y; });
    } else {
      data.nodes.forEach((n) => { n.fx = undefined; n.fy = undefined; });
      g.d3ReheatSimulation();
    }
  }, [layout, reduce, data]);

  const loc = currentLocale();
  const q = query.trim().toLocaleLowerCase(loc);
  const matches = useMemo(() => (q ? new Set(data.nodes.filter((n) =>
    n.id.toLowerCase().includes(q) || (TYPE_TR[n.id] ?? "").toLocaleLowerCase(loc).includes(q)).map((n) => n.id)) : null), [q, data, loc]);
  const relMatch = (rel: string) => !!q && rel.toLowerCase().includes(q);

  const hl = useMemo(() => {
    const nodeId = hover ?? selected;
    const relName = hoverRel ?? selRel;
    if (!nodeId && !relName && !q) return null;
    const nodes = new Set<string>(), links = new Set<string>();
    for (const l of data.links) {
      const a = idOf(l.source), b = idOf(l.target);
      const hit = (nodeId && (a === nodeId || b === nodeId)) || (relName && l.rel === relName) || relMatch(l.rel)
        || (!nodeId && !relName && matches?.has(a) && matches.has(b));
      if (hit) { links.add(l.id); nodes.add(a); nodes.add(b); }
    }
    if (nodeId) nodes.add(nodeId);
    if (!nodeId && !relName) matches?.forEach((m) => nodes.add(m));
    return { nodes, links };
  }, [hover, selected, hoverRel, selRel, data, matches, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const lit = (l: OLink) => !!hl?.links.has(l.id);
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data]);
  const visible = (n: ONode) => shown.has(n.domain);
  const visibleEnd = (v: string | ONode) => { const n = typeof v === "string" ? byId.get(v) : v; return !!n && shown.has(n.domain); };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const sel = selected ? data.nodes.find((n) => n.id === selected) ?? null : null;
  const animate = !reduce && (!!hl || Object.keys(flash.current).length > 0);

  const fit = (ms = reduce ? 0 : 500) => fg.current?.zoomToFit(ms, 64, visible);
  const relayout = () => {
    data.nodes.forEach((n) => { n.fx = undefined; n.fy = undefined; });
    seed(data.nodes);
    if (reduce) data.nodes.forEach((n) => { n.fx = n.x; n.fy = n.y; });
    else fg.current?.d3ReheatSimulation();
    userMoved.current = false;
    window.setTimeout(() => fit(), reduce ? 0 : 900);
  };
  const pick = (id: string | null) => { setSelected(id); setSelRel(null); };
  // ilk görünüm: başlangıç yerleşimi son hâline yakın; motor oturmasını beklemeden sığdır
  useEffect(() => {
    const id = window.setTimeout(() => { if (!userMoved.current) fit(0); }, 60);
    return () => window.clearTimeout(id);
  }, [size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col min-w-0">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b-2 border-line-soft">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input className="input !pl-9" placeholder={t("onto_search_placeholder")} value={query} aria-label={t("onto_search_label")}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && matches?.size) pick([...matches][0]); }} />
          </div>
          <Segmented value={layout} onChange={setLayout}
            options={[{ value: "domains", label: t("layout_domains") }, { value: "free", label: t("layout_free") }]} />
          <Button size="sm" icon={<Maximize2 size={14} />} onClick={() => { userMoved.current = false; fit(); }} title={t("fit_map")} aria-label={t("fit_map")} />
          <Button size="sm" icon={<Shuffle size={14} />} onClick={relayout} title={t("relayout")} aria-label={t("relayout")} />
        </div>
        <div ref={wrap} className="relative h-[66vh] min-h-[460px] bg-panel-2 memory-canvas"
          onWheel={() => { userMoved.current = true; }}
          onPointerMove={(e) => { if (e.buttons) userMoved.current = true; }}>
          <div role="img" aria-label={t("map_aria", { types: onto.entities.length, rels: onto.relations.length })}
            className="absolute inset-0">
            <ForceGraph2D<ONode, OLink>
              ref={fg as never}
              graphData={data}
              width={size.w}
              height={size.h}
              backgroundColor="rgba(0,0,0,0)"
              nodeRelSize={1}
              nodeVal={(n) => radius(n) ** 2}
              nodeVisibility={visible}
              linkVisibility={(l) => visibleEnd(l.source as string | ONode) && visibleEnd(l.target as string | ONode)}
              warmupTicks={reduce ? 0 : 40}
              cooldownTicks={reduce ? 0 : 180}
              cooldownTime={4000}
              d3VelocityDecay={0.35}
              autoPauseRedraw={!animate}
              minZoom={0.3}
              maxZoom={4}
              onEngineStop={() => { if (!userMoved.current) fit(); }}
              onNodeHover={(n) => setHover(n?.id ?? null)}
              onNodeClick={(n) => pick(n.id === selected ? null : n.id)}
              onNodeDragEnd={(n) => { n.fx = n.x; n.fy = n.y; }}
              onBackgroundClick={() => { pick(null); }}
              onLinkHover={(l) => setHoverRel(l?.rel ?? null)}
              onLinkClick={(l) => { setSelected(null); setSelRel(l.rel === selRel ? null : l.rel); }}
              linkCurvature={(l) => l.curvature}
              linkColor={(l) => (lit(l) ? vars.focus : alpha(vars["ink-2"], hl ? 0.12 : 0.32))}
              linkWidth={(l) => (lit(l) ? 2.6 : 1.2)}
              linkDirectionalArrowLength={(l) => (lit(l) ? 7 : 5)}
              linkDirectionalArrowRelPos={1}
              linkDirectionalArrowColor={(l) => (lit(l) ? vars.focus : alpha(vars["ink-2"], hl ? 0.15 : 0.45))}
              linkDirectionalParticles={(l) => (!reduce && lit(l) ? 2 : 0)}
              linkDirectionalParticleWidth={3.5}
              linkDirectionalParticleSpeed={0.007}
              linkDirectionalParticleColor={() => vars.focus}
              linkCanvasObjectMode={() => "after"}
              linkCanvasObject={(l, ctx, scale) => {
                if (!lit(l) && scale < 1.7) return;
                const s = l.source as ONode, t = l.target as ONode;
                if (s.x == null || t.x == null || s.y == null || t.y == null) return;
                const fs = 10 / Math.min(1, scale);
                let mx: number, my: number;
                if (s.id === t.id) { mx = s.x; my = s.y - radius(s) - 26 - l.loop * 22; }
                else {
                  const dx = t.x - s.x, dy = t.y - s.y, a = Math.atan2(dy, dx), d = Math.hypot(dx, dy) * l.curvature;
                  mx = (s.x + t.x) / 2 + 0.5 * d * Math.cos(a - Math.PI / 2);
                  my = (s.y + t.y) / 2 + 0.5 * d * Math.sin(a - Math.PI / 2);
                }
                pillLabel(ctx, l.rel, mx, my - fs * 0.72, fs, lit(l) ? vars.ink : vars["ink-2"], alpha(vars.panel, lit(l) ? 0.96 : 0.82));
              }}
              onRenderFramePre={(ctx, scale) => {
                if (layout !== "domains") return;
                for (const d of DOMAINS) {
                  if (!shown.has(d.id)) continue;
                  const ms = data.nodes.filter((n) => n.domain === d.id && n.x != null && n.y != null);
                  if (!ms.length) continue;
                  const cx = ms.reduce((a, n) => a + n.x!, 0) / ms.length, cy = ms.reduce((a, n) => a + n.y!, 0) / ms.length;
                  const R = Math.max(...ms.map((n) => Math.hypot(n.x! - cx, n.y! - cy) + radius(n) + 40));
                  const col = vars[DOMAIN_VAR[d.id]];
                  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
                  ctx.fillStyle = alpha(col, 0.08); ctx.fill();
                  ctx.setLineDash([7 / scale, 6 / scale]); ctx.lineWidth = 1.5 / scale; ctx.strokeStyle = alpha(col, 0.55); ctx.stroke(); ctx.setLineDash([]);
                  pillLabel(ctx, d.label.toLocaleUpperCase(loc), cx, cy - R - 9 / Math.min(1, scale), 11 / Math.min(1, scale), vars["ink-2"], alpha(vars.panel, 0.9));
                }
              }}
              nodeCanvasObject={(n, ctx, scale) => {
                const x = n.x!, y = n.y!, r = radius(n), col = n.e.color;
                const on = !hl || hl.nodes.has(n.id);
                ctx.globalAlpha = on ? 1 : 0.2;
                const f = flash.current[n.id];
                if (f) {
                  const k = (performance.now() - f) / 1600;
                  if (k >= 1) delete flash.current[n.id];
                  else { ctx.beginPath(); ctx.arc(x, y, r + 4 + k * 18, 0, Math.PI * 2); ctx.strokeStyle = alpha(col, 0.7 * (1 - k)); ctx.lineWidth = 3; ctx.stroke(); }
                }
                if (n.id === selected || n.id === hover) { ctx.beginPath(); ctx.arc(x, y, r + 9, 0, Math.PI * 2); ctx.fillStyle = alpha(col, 0.25); ctx.fill(); }
                ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
                const empty = n.count === 0;
                ctx.fillStyle = empty ? vars.panel : col;
                ctx.fill();
                if (empty) ctx.setLineDash([4, 3]);
                ctx.lineWidth = n.id === selected ? 3.5 : 2;
                ctx.strokeStyle = n.id === selected ? vars.focus : empty ? col : vars.line;
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.font = `700 ${Math.round(r * 0.62)}px "Inter Variable", "Segoe UI", sans-serif`;
                ctx.textAlign = "center"; ctx.textBaseline = "middle";
                ctx.fillStyle = empty ? vars.muted : inkOn(col);
                ctx.fillText(fmt(n.count), x, y + 1);
                const fs = 12 / Math.min(1, scale);
                pillLabel(ctx, TYPE_TR[n.id] ?? n.id, x, y + r + 5, fs, vars.ink, alpha(vars.panel, 0.94));
                if (scale > 1.3 || n.id === selected) {
                  ctx.font = `500 ${fs * 0.8}px "JetBrains Mono Variable", monospace`;
                  ctx.fillStyle = vars.muted;
                  ctx.fillText(n.id, x, y + r + 5 + fs * 1.45 + fs * 0.6);
                }
                ctx.globalAlpha = 1;
              }}
              nodePointerAreaPaint={(n, color, ctx) => {
                ctx.beginPath(); ctx.arc(n.x!, n.y!, radius(n) + 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
              }}
            />
          </div>
          <div className="absolute left-3 bottom-3 right-3 flex flex-wrap items-center gap-1.5 pointer-events-none">
            {DOMAINS.map((d) => {
              const on = shown.has(d.id);
              return (
                <button key={d.id} type="button" aria-pressed={on} className={clsx("chip pointer-events-auto", !on && "border-dashed !text-muted")}
                  onClick={() => setShown((s) => { const n = new Set(s); if (on) n.delete(d.id); else n.add(d.id); return n; })}>
                  <span className="h-2.5 w-2.5 rounded-full border border-line" style={{ background: on ? `var(--${DOMAIN_VAR[d.id]})` : "transparent" }} />
                  {d.label}
                </button>
              );
            })}
            <span className="chip ml-auto hidden sm:inline-flex">{t("controls_hint")}</span>
          </div>
        </div>
      </div>

      <aside className="border-t-2 lg:border-t-0 lg:border-l-2 border-line-soft p-4 max-h-[calc(66vh+3.75rem)] min-h-[460px] overflow-y-auto">
        {sel ? (
          <EntityDetail node={sel} data={data} counts={counts} onPick={pick} onClose={() => pick(null)} onShowInGraph={onShowInGraph} />
        ) : selRel ? (
          <RelationDetail name={selRel} onto={onto} onPick={pick} onClose={() => setSelRel(null)} />
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <SectionTitle size="sm">{t("map_title")}</SectionTitle>
              <p className="text-sm text-ink-2 mt-1">{t("map_intro")}</p>
            </div>
            <dl className="grid grid-cols-3 gap-2">
              {([[t("stat_types"), onto.entities.length], [t("stat_relations"), onto.relations.length], [t("stat_records"), total]] as [string, number][]).map(([k, v]) => (
                <div key={k} className="panel-soft p-2.5 min-w-0">
                  <dt className="text-xs text-muted font-medium">{k}</dt>
                  <dd className="t-h4 num">{fmt(v)}</dd>
                </div>
              ))}
            </dl>
            {DOMAINS.map((d) => {
              const ents = data.nodes.filter((n) => n.domain === d.id);
              if (!ents.length) return null;
              return (
                <section key={d.id} aria-label={t("domain_aria", { domain: d.label })}>
                  <h3 className="font-display text-xs font-semibold text-ink-2 flex items-center gap-1.5 mb-1">
                    <span className="h-2.5 w-2.5 rounded-full border border-line" style={{ background: `var(--${DOMAIN_VAR[d.id]})` }} />
                    {d.label}
                  </h3>
                  <ul className="grid grid-cols-2 gap-1">
                    {ents.map((n) => (
                      <li key={n.id} className="min-w-0">
                        <button type="button" onClick={() => pick(n.id)} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                          onFocus={() => setHover(n.id)} onBlur={() => setHover(null)}
                          className="w-full flex items-center gap-1.5 rounded-md px-2 py-1 text-dense hover:bg-panel-2 text-left min-w-0">
                          <span className="h-2.5 w-2.5 rounded-[3px] border border-line shrink-0" style={{ background: n.e.color }} />
                          <span className="truncate flex-1">{TYPE_TR[n.id] ?? n.id}</span>
                          <span className="text-xs text-muted num">{fmt(counts[n.id] ?? 0)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            <section aria-label={t("relations")}>
              <SectionTitle as="h3" size="sm" className="mb-1">{t("relations")} <span className="num text-muted font-medium">({onto.relations.length})</span></SectionTitle>
              <ul className="flex flex-col gap-1">
                {onto.relations.filter((r) => !q || relMatch(r.name)).map((r) => (
                  <li key={r.name}>
                    <button type="button" onClick={() => { setSelected(null); setSelRel(r.name); }}
                      onMouseEnter={() => setHoverRel(r.name)} onMouseLeave={() => setHoverRel(null)}
                      onFocus={() => setHoverRel(r.name)} onBlur={() => setHoverRel(null)}
                      className="w-full text-left rounded-md px-2 py-1.5 hover:bg-panel-2 min-w-0">
                      <span className="block font-mono text-xs font-semibold text-accent">{r.name}</span>
                      <span className="block text-xs text-ink-2 truncate">
                        {r.from.map((x) => TYPE_TR[x] ?? x).join(" / ")} → {r.to.map((x) => TYPE_TR[x] ?? x).join(" / ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <p className="text-xs text-muted">{t("onto_footer")}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function EntityDetail({ node, data, counts, onPick, onClose, onShowInGraph }:
  { node: ONode; data: { links: OLink[] }; counts: Record<string, number>; onPick: (id: string) => void; onClose: () => void; onShowInGraph: (t: string) => void }) {
  const t = useT(memoryMsg);
  const { e } = node;
  const out = data.links.filter((l) => idOf(l.source) === e.name);
  const inc = data.links.filter((l) => idOf(l.target) === e.name && idOf(l.source) !== e.name);
  const n = counts[e.name] ?? 0;
  const Rel = ({ l, dir }: { l: OLink; dir: "out" | "in" }) => {
    const other = dir === "out" ? idOf(l.target) : idOf(l.source);
    return (
      <li>
        <button type="button" onClick={() => onPick(other)} title={l.desc}
          className="w-full text-left flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-panel-2 text-dense min-w-0">
          {dir === "in" && <span className="truncate">{TYPE_TR[other] ?? other}</span>}
          <span className="font-mono text-xs font-semibold text-accent shrink-0">{l.rel}</span>
          {dir === "out" && <><ArrowRight size={13} className="shrink-0 text-muted" aria-hidden="true" /><span className="truncate">{TYPE_TR[other] ?? other}</span></>}
          {dir === "in" && <ArrowRight size={13} className="shrink-0 text-muted" aria-hidden="true" />}
        </button>
      </li>
    );
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-1 h-5 w-5 rounded-full border-2 border-line shrink-0" style={{ background: e.color }} />
        <div className="min-w-0 flex-1">
          <h2 className="t-h4 break-words">{TYPE_TR[e.name] ?? e.name}</h2>
          <p className="text-xs text-muted font-mono">{e.name}</p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <Badge>{domainLabel(node.domain)}</Badge>
            <Badge tone={n ? "ok" : "muted"}>{n ? tp(memoryMsg, "in_graph", n) : t("no_records")}</Badge>
          </div>
        </div>
        <Button size="sm" variant="ghost" icon={<X size={15} />} onClick={onClose} aria-label={t("close")} />
      </div>
      {e.description && <p className="text-sm text-ink-2">{e.description}</p>}
      <Button size="sm" icon={<ArrowRight size={14} />} onClick={() => onShowInGraph(e.name)} disabled={!n} className="self-start">
        {t("show_in_graph")}
      </Button>
      <section>
        <SectionTitle as="h3" size="sm" className="mb-1">{t("properties")} <span className="num text-muted font-medium">({e.properties.length})</span></SectionTitle>
        <ul className="flex flex-col gap-1">
          {e.properties.map((p) => (
            <li key={p.name} className="panel-soft px-2.5 py-1.5 text-dense flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
              <span className={clsx("font-mono font-semibold", p.name === e.key && "text-accent")}>{p.name}</span>
              <span className="font-mono text-xs text-muted">{p.type}</span>
              {p.name === e.key && <Badge tone="info">{t("key_badge")}</Badge>}
              {p.required && p.name !== e.key && <Badge>{t("required_badge")}</Badge>}
              {p.enum?.length ? <span className="w-full text-xs text-ink-2 break-words">{p.enum.join(" · ")}</span> : null}
            </li>
          ))}
        </ul>
      </section>
      {out.length > 0 && (
        <section>
          <SectionTitle as="h3" size="sm" className="mb-1">{t("outgoing")} <span className="num text-muted font-medium">({out.length})</span></SectionTitle>
          <ul className="flex flex-col gap-0.5">{out.map((l) => <Rel key={l.id} l={l} dir="out" />)}</ul>
        </section>
      )}
      {inc.length > 0 && (
        <section>
          <SectionTitle as="h3" size="sm" className="mb-1">{t("incoming")} <span className="num text-muted font-medium">({inc.length})</span></SectionTitle>
          <ul className="flex flex-col gap-0.5">{inc.map((l) => <Rel key={l.id} l={l} dir="in" />)}</ul>
        </section>
      )}
    </div>
  );
}

function RelationDetail({ name, onto, onPick, onClose }: { name: string; onto: OntologyDef; onPick: (id: string) => void; onClose: () => void }) {
  const t = useT(memoryMsg);
  const r = onto.relations.find((x) => x.name === name);
  if (!r) return null;
  const chip = (t: string) => (
    <button key={t} type="button" onClick={() => onPick(t)} className="chip hover:border-ink-2">{TYPE_TR[t] ?? t}</button>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="t-overline text-muted">{t("relation")}</p>
          <h2 className="font-mono font-semibold text-accent break-words">{r.name}</h2>
        </div>
        <Button size="sm" variant="ghost" icon={<X size={15} />} onClick={onClose} aria-label={t("close")} />
      </div>
      {r.description && <p className="text-sm text-ink-2">{r.description}</p>}
      <div className="flex flex-wrap items-center gap-1.5">{r.from.map(chip)}<ArrowRight size={14} className="text-muted" aria-hidden="true" />{r.to.map(chip)}</div>
    </div>
  );
}
