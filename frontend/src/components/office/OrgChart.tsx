// Ekip S3/S6 — rütbe katmanlı org şeması. S20 (100+ ajan): ekip düğümleri daraltılıp genişletilebilir (çok ajanlı
// ofiste ekipler başlangıçta daraltılır), araç çubuğunda yakınlaştır / uzaklaştır / sığdır ve "ajana git" araması.
import "@xyflow/react/dist/style.css";
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import clsx from "clsx";
import { ChevronsDownUp, ChevronsUpDown, Crown, Maximize2, Minus, Plus, Search, ShieldCheck, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { agentMood, byName } from "../../lib/agents";
import { fold } from "../../lib/hermes";
import { tp, useT } from "../../lib/i18n";
import { teamColor, type TeamInfo } from "../../lib/office";
import { useStudio } from "../../lib/store";
import type { Agent, Mood, Workflow } from "../../lib/types";
import { officeMsg as m } from "../../locales/office";
import { PixelFace } from "../PixelFace";
import { Button } from "../ui";
import { RANK_LABELS, isRank, rankIndex, type Rank } from "./hierarchy";
import { RankBadge } from "./RankBadge";

const NODE_W = 216;
const NODE_H = 96;
const GAP_X = 26;
const GAP_Y = 78;
const PAD = 14;
const ROW = NODE_H + GAP_Y;
export const HANDOFF_COLOR = "#7C5CE0";
const BAND_GUTTER = 150; // rütbe katmanı etiketleri için soldaki boşluk
/** Bu sayıdan çok ajanda ekipler başlangıçta daraltılmış gelir. */
const AUTO_COLLAPSE_AT = 60;
const TEAM_PREFIX = "team:";

type AgentNodeData = { agent: Agent; team?: TeamInfo; color: string; lead: boolean; mood: Mood; focused: boolean };
type TeamNodeData = { team: TeamInfo; count: number; faces: Agent[]; focused: boolean };
type ZoneNodeData = { team: TeamInfo; w: number; h: number };
type LabelNodeData = { text: string };
type YouNodeData = { gates: number };
type BandNodeData = { text: string; w: number; h: number; odd: boolean };

const handleCls = "!bg-ink !w-2.5 !h-2.5 !rounded-[3px] !border-0";
const hiddenHandle = "!opacity-0 !w-1 !h-1 !min-w-0 !min-h-0 !border-0";
const focusCls = "outline-3 outline-amethyst outline-offset-2";

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const t = useT(m);
  const { agent, team, color, lead, mood, focused } = data;
  return (
    <div className={clsx("rounded-xl border-2 border-line bg-panel overflow-hidden shadow-[0_4px_0_var(--shadow)] cursor-pointer transition-transform hover:-translate-y-0.5", focused && focusCls)}
      style={{ width: NODE_W }} title={agent.title ? t("node_title_with", { name: agent.name, title: agent.title }) : t("node_title", { name: agent.name })}>
      <Handle id="up" type="target" position={Position.Top} className={handleCls} />
      <Handle id="in" type="target" position={Position.Left} className={hiddenHandle} />
      <div className="h-[6px]" style={{ background: color }} />
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <PixelFace avatar={agent.avatar} size={46} ring={agent.color} mood={mood} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 min-w-0">
            <span className="font-semibold text-sm leading-tight truncate">{agent.name}</span>
            {lead && <Crown size={13} className="shrink-0 text-warn" aria-label={t("team_lead")} />}
            <RankBadge rank={agent.rank} short className="ml-auto shrink-0 !min-h-0 !py-0 !px-1.5" />
          </div>
          <div className="text-xs text-ink-2 leading-snug truncate">{agent.title || t("no_title")}</div>
          <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-[1px] text-xs font-semibold border truncate"
            style={{ borderColor: `color-mix(in srgb, ${color} 55%, transparent)`, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
            <span className="truncate">{team?.name ?? t("lobby")}</span>
          </span>
        </div>
      </div>
      <Handle id="down" type="source" position={Position.Bottom} className={handleCls} />
      <Handle id="out" type="source" position={Position.Right} className={hiddenHandle} />
    </div>
  );
}

/** Daraltılmış ekip: tek kart; tıklanınca genişler. */
function TeamNode({ data }: NodeProps<Node<TeamNodeData>>) {
  const t = useT(m);
  const { team, count, faces, focused } = data;
  return (
    <div className={clsx("rounded-xl border-2 border-dashed bg-panel overflow-hidden shadow-[0_4px_0_var(--shadow)] cursor-pointer transition-transform hover:-translate-y-0.5", focused && focusCls)}
      style={{ width: NODE_W, borderColor: team.color }} title={t("team_node_title", { name: team.name })}
      role="button" aria-label={t("expand_team", { name: team.name })}>
      <Handle id="up" type="target" position={Position.Top} className={handleCls} />
      <Handle id="in" type="target" position={Position.Left} className={hiddenHandle} />
      <div className="h-[6px]" style={{ background: team.color }} />
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <span className="grid place-items-center h-[46px] w-[46px] shrink-0 rounded-lg border-2 border-line" style={{ background: `color-mix(in srgb, ${team.color} 18%, transparent)` }}>
          <Users size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm leading-tight truncate">{team.name}</div>
          <div className="text-xs text-ink-2 leading-snug num">{tp(m, "team_node_members", count)}</div>
          <div className="mt-1 flex items-center gap-0.5">
            {faces.map((a) => <PixelFace key={a.slug} avatar={a.avatar} size={18} ring={a.color} />)}
            {count > faces.length && <span className="text-xs text-muted num ml-0.5">+{count - faces.length}</span>}
            <ChevronsUpDown size={13} className="ml-auto text-muted" aria-hidden />
          </div>
        </div>
      </div>
      <Handle id="down" type="source" position={Position.Bottom} className={handleCls} />
      <Handle id="out" type="source" position={Position.Right} className={hiddenHandle} />
    </div>
  );
}

function YouNode({ data }: NodeProps<Node<YouNodeData>>) {
  const t = useT(m);
  return (
    <div className="rounded-xl border-2 border-line bg-ink text-panel shadow-[0_4px_0_var(--shadow)] px-3 py-2.5 flex items-center gap-2.5"
      style={{ width: NODE_W }} title={t("you_title")}>
      <span className="grid place-items-center h-10 w-10 rounded-lg bg-gold text-[color:var(--on-gold)] border-2 border-line shrink-0"><Crown size={20} /></span>
      <div className="min-w-0">
        <div className="font-display font-semibold text-base leading-tight">{t("you")}</div>
        <div className="text-xs leading-snug flex items-center gap-1 num">
          <ShieldCheck size={12} className="shrink-0" />
          {data.gates ? t("you_gates", { n: data.gates }) : t("you_founder")}
        </div>
      </div>
      <Handle id="down" type="source" position={Position.Bottom} className={handleCls} />
    </div>
  );
}

function ZoneNode({ data }: NodeProps<Node<ZoneNodeData>>) {
  const t = useT(m);
  const { team, w, h } = data;
  return (
    <div className="relative rounded-2xl border-2 border-dashed pointer-events-none" style={{
      width: w, height: h, borderColor: `color-mix(in srgb, ${team.color} 55%, transparent)`,
      background: `color-mix(in srgb, ${team.color} 7%, transparent)`,
    }}>
      <span className="absolute -top-[12px] left-3 flex items-center gap-1 pl-1.5 pr-0.5 rounded-md text-xs leading-5 font-semibold bg-panel border-2 pointer-events-auto"
        style={{ borderColor: `color-mix(in srgb, ${team.color} 55%, transparent)` }}>
        {team.name}
        <button type="button" className="grid place-items-center h-5 w-5 rounded hover:bg-panel-2 text-ink-2" data-collapse={team.slug}
          aria-label={t("collapse_team", { name: team.name })} title={t("collapse_team", { name: team.name })}>
          <ChevronsDownUp size={12} aria-hidden />
        </button>
      </span>
    </div>
  );
}

function LabelNode({ data }: NodeProps<Node<LabelNodeData>>) {
  return <div className="label whitespace-nowrap pointer-events-none">{data.text}</div>;
}

/** Rütbe katmanı: aynı düzeydeki kartların arkasında soluk şerit ve solda rütbe etiketi. */
function BandNode({ data }: NodeProps<Node<BandNodeData>>) {
  return (
    <div className="relative rounded-xl pointer-events-none" style={{ width: data.w, height: data.h,
      background: data.odd ? "color-mix(in srgb, var(--line-soft) 22%, transparent)" : "transparent" }}>
      <span className="absolute left-2 top-1/2 -translate-y-1/2 label leading-tight" style={{ width: BAND_GUTTER - 24 }}>{data.text}</span>
    </div>
  );
}

const nodeTypes = { agent: AgentNode, team: TeamNode, you: YouNode, zone: ZoneNode, label: LabelNode, band: BandNode };

interface Placed { agent: Agent; x: number; y: number; layer: number }

/** Düzenli ağaç: yaprak = 1 yuva, düğüm alt ağacının ortasına; kökler yan yana; ekipsiz ve bağsızlar en altta (Lobi).
 *  Rütbe varsa dikey konum rütbe katmanıdır (aynı rütbe aynı satırda); ast her zaman yöneticisinin altındadır. */
function layoutTree(agents: Agent[], teams: TeamInfo[], includeLoose: boolean, top: number) {
  const bySlug = new Map(agents.map((a) => [a.slug, a]));
  const rank = new Map(teams.map((t, i) => [t.slug, i]));
  const children = new Map<string, Agent[]>();
  const roots: Agent[] = [];
  const loose: Agent[] = [];
  const bossOf = (a: Agent) => (a.reports_to && a.reports_to !== a.slug && bySlug.has(a.reports_to) ? a.reports_to : null);
  for (const a of agents) {
    const boss = bossOf(a);
    if (boss) children.set(boss, [...(children.get(boss) ?? []), a]);
  }
  for (const a of agents) {
    if (bossOf(a)) continue;
    if (!a.team && !children.has(a.slug)) loose.push(a);
    else roots.push(a);
  }
  const order = (a: Agent) => (a.team ? rank.get(a.team) ?? 900 : 999);
  const sort = (xs: Agent[]) => xs.sort((a, b) => order(a) - order(b) || byName(a, b));
  sort(roots);
  children.forEach((xs) => sort(xs));

  const slot = NODE_W + GAP_X;
  const width = new Map<string, number>();
  const measure = (a: Agent, seen: Set<string>): number => {
    if (seen.has(a.slug)) return 1;
    seen.add(a.slug);
    const kids = children.get(a.slug) ?? [];
    const w = Math.max(1, kids.reduce((s, k) => s + measure(k, seen), 0));
    width.set(a.slug, w);
    return w;
  };
  // rütbe katmanları: yalnızca şemada bulunan rütbeler sıkıştırılmış sırayla satır olur
  const present = [...new Set(agents.map((a) => rankIndex(a.rank)).filter((i) => i >= 0))].sort((x, y) => x - y);
  const rankLayer = (a: Agent): number | null => { const i = present.indexOf(rankIndex(a.rank)); return i >= 0 ? i : null; };
  const placed: Placed[] = [];
  const done = new Set<string>();
  let maxLayer = -1;
  const place = (a: Agent, left: number, parentLayer: number) => {
    if (done.has(a.slug)) return;
    done.add(a.slug);
    const layer = Math.max(rankLayer(a) ?? parentLayer + 1, parentLayer + 1);
    maxLayer = Math.max(maxLayer, layer);
    const w = width.get(a.slug) ?? 1;
    placed.push({ agent: a, x: left + (w * slot - slot) / 2, y: top + layer * ROW, layer });
    let cursor = left;
    for (const k of children.get(a.slug) ?? []) {
      place(k, cursor, layer);
      cursor += (width.get(k.slug) ?? 1) * slot;
    }
  };
  let cursor = 0;
  const measured = new Set<string>();
  for (const r of roots) {
    measure(r, measured);
    place(r, cursor, -1);
    cursor += (width.get(r.slug) ?? 1) * slot;
  }
  const treeW = Math.max(cursor - GAP_X, NODE_W);
  let looseRowY: number | null = null;
  if (includeLoose && loose.length) {
    looseRowY = top + (maxLayer + 1) * ROW + (placed.length ? 34 : 0);
    const total = loose.length * slot - GAP_X;
    const start = Math.max(0, (treeW - total) / 2);
    sort(loose).forEach((a, i) => placed.push({ agent: a, x: start + i * slot, y: looseRowY!, layer: maxLayer + 1 }));
  }
  return { placed, roots, treeW, looseRowY, ranked: present.length > 0 };
}

/** Katman başına rütbe etiketi ("Müdür", "Lider · Kıdemli Uzman"…). */
function bandLabel(agents: Agent[]): string | null {
  const ranks = [...new Set(agents.map((a) => a.rank).filter((r): r is Rank => isRank(r)))]
    .sort((a, b) => rankIndex(a) - rankIndex(b));
  if (!ranks.length) return null;
  const head = ranks.slice(0, 2).map((r) => RANK_LABELS[r]).join(" · ");
  return ranks.length > 2 ? `${head} +${ranks.length - 2}` : head;
}

/** Sprint akışındaki teslim yönleri: her ajan adımı, (onay kapılarının arkasındaki) bir önceki ajan adımlarından teslim alır. */
export function handoffPairs(wf: Workflow | null | undefined): [string, string][] {
  if (!wf) return [];
  const byId = new Map(wf.steps.map((s) => [s.id, s]));
  const givers = (id: string, seen: Set<string>): string[] => {
    const s = byId.get(id);
    if (!s || seen.has(id)) return [];
    seen.add(id);
    if (s.type === "agent" && s.agent) return [s.agent];
    return (s.depends_on ?? []).flatMap((d) => givers(d, seen));
  };
  const out = new Map<string, [string, string]>();
  for (const s of wf.steps) {
    if (s.type !== "agent" || !s.agent) continue;
    for (const d of s.depends_on ?? []) {
      for (const g of givers(d, new Set())) if (g !== s.agent) out.set(`${g}>${s.agent}`, [g, s.agent]);
    }
  }
  return [...out.values()];
}

/**
 * Daraltılmış ekipler tek düğüme iner: üyeler çıkar, yerine `team:<slug>` sahte ajanı girer. Ekibin dış yöneticisi
 * (ekip dışına raporlayan en üst rütbeli üyenin yöneticisi) ekip düğümünün yöneticisi olur; ekip üyesine raporlayan dış
 * ajanlar ekip düğümüne bağlanır.
 */
function collapseTeams(agents: Agent[], teams: TeamInfo[], collapsed: Set<string>): { list: Agent[]; groups: Map<string, Agent[]> } {
  const groups = new Map<string, Agent[]>();
  if (!collapsed.size) return { list: agents, groups };
  const memberTeam = new Map<string, string>();
  for (const a of agents) if (a.team && collapsed.has(a.team)) {
    groups.set(a.team, [...(groups.get(a.team) ?? []), a]);
    memberTeam.set(a.slug, a.team);
  }
  const nodeOf = (slug: string) => TEAM_PREFIX + slug;
  const list: Agent[] = [];
  for (const a of agents) {
    if (memberTeam.has(a.slug)) continue;
    const boss = a.reports_to && memberTeam.get(a.reports_to);
    list.push(boss ? { ...a, reports_to: nodeOf(boss) } : a);
  }
  for (const [slug, members] of groups) {
    const team = teams.find((x) => x.slug === slug);
    const sorted = [...members].sort((a, b) => rankIndex(a.rank) - rankIndex(b.rank) || byName(a, b));
    const top = sorted.find((a) => !a.reports_to || !memberTeam.has(a.reports_to) || memberTeam.get(a.reports_to) !== slug) ?? sorted[0];
    let boss = top.reports_to ?? null;
    if (boss && memberTeam.has(boss)) boss = memberTeam.get(boss) === slug ? null : nodeOf(memberTeam.get(boss)!);
    list.push({ ...top, slug: nodeOf(slug), name: team?.name ?? slug, team: slug, reports_to: boss, title: null, hidden: false } as Agent);
  }
  return { list, groups };
}

export function OrgChart(props: { agents: Agent[]; teams: TeamInfo[]; includeLoose: boolean; workflow?: Workflow | null; className?: string }) {
  return <ReactFlowProvider><OrgChartInner {...props} /></ReactFlowProvider>;
}

function OrgChartInner({ agents, teams, includeLoose, workflow, className = "h-[440px] sm:h-[560px]" }:
  { agents: Agent[]; teams: TeamInfo[]; includeLoose: boolean; workflow?: Workflow | null; className?: string }) {
  const t = useT(m);
  const states = useStudio((s) => s.states);
  const conns = useStudio((s) => s.connections);
  const select = useStudio((s) => s.selectAgent);
  const rf = useReactFlow();
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    (agents.length > AUTO_COLLAPSE_AT ? new Set(teams.filter((x) => agents.some((a) => a.team === x.slug)).map((x) => x.slug)) : new Set()));
  const [focus, setFocus] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);

  const teamsWithMembers = useMemo(() => teams.filter((x) => agents.some((a) => a.team === x.slug)), [teams, agents]);
  const toggleTeam = useCallback((slug: string, open?: boolean) => setCollapsed((s) => {
    const next = new Set(s);
    const willOpen = open ?? next.has(slug);
    if (willOpen) next.delete(slug); else next.add(slug);
    return next;
  }), []);

  const { nodes, edges, sig } = useMemo(() => {
    const { list, groups } = collapseTeams(agents, teams, collapsed);
    const hasTree = list.some((a) => a.team || list.some((b) => b.reports_to === a.slug));
    const top = hasTree ? ROW : 0;
    const { placed, roots, treeW, looseRowY, ranked } = layoutTree(list, teams, includeLoose, top);
    const pos = new Map(placed.map((p) => [p.agent.slug, p]));
    const leads = new Set(teams.filter((x) => x.lead).map((x) => `${x.lead}@${x.slug}`));
    const agentNodes: Node[] = placed.map(({ agent, x, y }) => {
      if (agent.slug.startsWith(TEAM_PREFIX)) {
        const team = teams.find((x) => x.slug === agent.team)!;
        const members = groups.get(team.slug) ?? [];
        const focused = !!focus && members.some((a) => a.slug === focus);
        return { id: agent.slug, type: "team", position: { x, y }, draggable: false, connectable: false,
          data: { team, count: members.length, faces: members.slice(0, 4), focused } satisfies TeamNodeData };
      }
      return { id: agent.slug, type: "agent", position: { x, y }, draggable: false, connectable: false,
        data: { agent, team: teams.find((x) => x.slug === agent.team), color: teamColor(agent.team, teams),
                lead: leads.has(`${agent.slug}@${agent.team}`), mood: agentMood(agent, states, conns), focused: focus === agent.slug } satisfies AgentNodeData };
    });
    const gates = workflow?.steps.filter((s) => s.type === "approval").length ?? 0;
    const you: Node[] = hasTree ? [{ id: "__sen", type: "you", position: { x: (treeW - NODE_W) / 2, y: 0 }, draggable: false,
      selectable: false, connectable: false, data: { gates } satisfies YouNodeData }] : [];

    // Ekip bölgeleri: üyeleri çevreleyen kutu başka ekibin düğümüyle çakışmıyorsa çizilir (daraltılmış ekipler hariç).
    const zones: Node[] = [];
    for (const team of teams) {
      if (collapsed.has(team.slug)) continue;
      const mine = placed.filter((p) => p.agent.team === team.slug);
      if (!mine.length) continue;
      const x0 = Math.min(...mine.map((p) => p.x)) - PAD, y0 = Math.min(...mine.map((p) => p.y)) - PAD - 6;
      const x1 = Math.max(...mine.map((p) => p.x)) + NODE_W + PAD, y1 = Math.max(...mine.map((p) => p.y)) + NODE_H + PAD;
      const clash = placed.some((p) => p.agent.team !== team.slug && p.x < x1 && p.x + NODE_W > x0 && p.y < y1 && p.y + NODE_H > y0);
      if (clash) continue;
      zones.push({ id: `zone:${team.slug}`, type: "zone", position: { x: x0, y: y0 }, zIndex: -1, draggable: false,
        selectable: false, focusable: false, connectable: false, data: { team, w: x1 - x0, h: y1 - y0 } satisfies ZoneNodeData });
    }
    const lobby = looseRowY != null ? placed.filter((p) => p.y === looseRowY) : [];
    const labels: Node[] = lobby.length
      ? [{ id: "label:lobi", type: "label", position: { x: Math.min(...lobby.map((p) => p.x)), y: looseRowY! - 26 },
           draggable: false, selectable: false, focusable: false, data: { text: t("lobby_label") } satisfies LabelNodeData }]
      : [];
    // Rütbe katmanları (S6): her satırın arkasında soluk şerit + rütbe etiketi
    const bands: Node[] = [];
    if (ranked) {
      const rows = new Map<number, Agent[]>();
      for (const p of placed) if (p.y !== looseRowY) rows.set(p.y, [...(rows.get(p.y) ?? []), p.agent]);
      [...rows.entries()].sort((a, b) => a[0] - b[0]).forEach(([y, xs], i) => {
        const text = bandLabel(xs);
        if (!text) return;
        bands.push({ id: `band:${y}`, type: "band", position: { x: -PAD - BAND_GUTTER, y: y - 22 }, zIndex: -2,
          draggable: false, selectable: false, focusable: false, connectable: false,
          data: { text, w: treeW + PAD * 2 + BAND_GUTTER, h: NODE_H + 30, odd: i % 2 === 0 } satisfies BandNodeData });
      });
    }

    const reportStyle = { stroke: "var(--ink-2)", strokeWidth: 2 };
    const reports: Edge[] = [
      ...(hasTree ? roots.filter((r) => pos.has(r.slug)).map((r) => ({
        id: `sen->${r.slug}`, source: "__sen", sourceHandle: "down", target: r.slug, targetHandle: "up",
        type: "smoothstep", style: reportStyle, focusable: false } as Edge)) : []),
      ...placed.filter((p) => p.agent.reports_to && pos.has(p.agent.reports_to)).map((p) => ({
        id: `${p.agent.reports_to}->${p.agent.slug}`, source: p.agent.reports_to!, sourceHandle: "down",
        target: p.agent.slug, targetHandle: "up", type: "smoothstep", style: reportStyle, focusable: false } as Edge)),
    ];
    // teslim çizgileri: daraltılmış ekip üyeleri ekip düğümüne eşlenir
    const memberNode = new Map<string, string>();
    for (const [slug, members] of groups) for (const a of members) memberNode.set(a.slug, TEAM_PREFIX + slug);
    const mapNode = (s: string) => memberNode.get(s) ?? s;
    const seenHand = new Set<string>();
    const handoffs: Edge[] = [];
    for (const [a0, b0] of handoffPairs(workflow)) {
      const a = mapNode(a0), b = mapNode(b0);
      if (a === b || !pos.has(a) || !pos.has(b) || seenHand.has(`${a}>${b}`)) continue;
      seenHand.add(`${a}>${b}`);
      handoffs.push({
        id: `teslim:${a}->${b}`, source: a, sourceHandle: "out", target: b, targetHandle: "in", type: "default", focusable: false,
        style: { stroke: HANDOFF_COLOR, strokeWidth: 1.75, strokeDasharray: "6 5", opacity: 0.85 },
        markerEnd: { type: MarkerType.ArrowClosed, color: HANDOFF_COLOR, width: 16, height: 16 },
      });
    }
    return { nodes: [...bands, ...zones, ...labels, ...you, ...agentNodes], edges: [...reports, ...handoffs],
             sig: placed.map((p) => `${p.agent.slug}:${p.agent.reports_to ?? ""}:${p.agent.team ?? ""}:${p.agent.rank ?? ""}`).join("|")
               + `#${workflow?.slug ?? ""}` };
  }, [agents, teams, includeLoose, workflow, states, conns, collapsed, focus, t]);

  // "Ajana git": ekip daraltılmışsa önce aç; şema yeniden kurulunca (sig değişince) düğüme sığdır.
  const nodeIdFor = useCallback((slug: string) => {
    const a = agents.find((x) => x.slug === slug);
    return a?.team && collapsed.has(a.team) ? TEAM_PREFIX + a.team : slug;
  }, [agents, collapsed]);
  const goTo = useCallback((slug: string) => {
    setFocus(slug);
    const a = agents.find((x) => x.slug === slug);
    if (a?.team && collapsed.has(a.team)) {
      pendingFocus.current = slug;
      toggleTeam(a.team, true);
    } else {
      void rf.fitView({ nodes: [{ id: slug }], duration: 400, maxZoom: 1.15, padding: 0.6 });
    }
  }, [agents, collapsed, rf, toggleTeam]);
  const initialFit = pendingFocus.current
    ? { nodes: [{ id: pendingFocus.current }], maxZoom: 1.15, padding: 0.6 }
    : { padding: 0.16, maxZoom: 1.05, minZoom: 0.5 }; // S39: 20+ ajanda şema okunmaz küçülmesin; gerisi sürükle/"Sığdır"
  useEffect(() => { pendingFocus.current = null; }, [sig]);

  const onNodeClick = (_: unknown, n: Node) => {
    if (n.type === "agent") { setFocus(n.id); select(n.id); }
    else if (n.type === "team") toggleTeam(n.id.slice(TEAM_PREFIX.length), true);
  };
  // bölge etiketindeki daraltma düğmesi (ZoneNode pointer-events-none; düğme kendi olayını yakalar)
  const onPaneClickCapture = (e: ReactMouseEvent) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-collapse]");
    if (btn?.dataset.collapse) { e.stopPropagation(); e.preventDefault(); toggleTeam(btn.dataset.collapse, false); }
  };

  return (
    <div className="flex flex-col gap-2">
      <ChartToolbar agents={agents} teamsWithMembers={teamsWithMembers} collapsed={collapsed} onCollapseAll={(all) => setCollapsed(all ? new Set(teamsWithMembers.map((x) => x.slug)) : new Set())}
        onGo={goTo} onZoom={(d) => (d > 0 ? rf.zoomIn({ duration: 200 }) : rf.zoomOut({ duration: 200 }))}
        onFit={() => rf.fitView({ padding: 0.16, maxZoom: 1.05, duration: 300 })} focusId={focus ? nodeIdFor(focus) : null} />
      <div className={`rounded-xl border-2 border-line-soft bg-panel-2 overflow-hidden ${className}`} onClickCapture={onPaneClickCapture}>
        <ReactFlow key={sig} nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={initialFit}
          minZoom={0.1} maxZoom={1.8} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
          zoomOnScroll={false} panOnScroll={false} preventScrolling={false} zoomOnDoubleClick={false} panOnDrag
          onNodeClick={onNodeClick} proOptions={{ hideAttribution: true }}>
          <Background gap={22} color="var(--line-soft)" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>
    </div>
  );
}

/** Şema araç çubuğu: daralt/genişlet, yakınlaştır/uzaklaştır/sığdır, ajana git. */
function ChartToolbar({ agents, teamsWithMembers, collapsed, onCollapseAll, onGo, onZoom, onFit, focusId }:
  { agents: Agent[]; teamsWithMembers: TeamInfo[]; collapsed: Set<string>; onCollapseAll: (all: boolean) => void;
    onGo: (slug: string) => void; onZoom: (dir: 1 | -1) => void; onFit: () => void; focusId: string | null }) {
  const t = useT(m);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const needle = fold(q.trim());
  const matches = useMemo(() => (needle ? agents.filter((a) => fold(`${a.name} ${a.title ?? ""} ${a.slug}`).includes(needle)).slice(0, 8) : []), [agents, needle]);
  const allCollapsed = teamsWithMembers.length > 0 && teamsWithMembers.every((x) => collapsed.has(x.slug));
  const pick = (slug: string) => { onGo(slug); setQ(""); setOpen(false); };
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label={t("chart_toolbar")}>
      {teamsWithMembers.length > 0 && (
        <Button size="sm" icon={allCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />} onClick={() => onCollapseAll(!allCollapsed)}>
          {allCollapsed ? t("expand_all") : t("collapse_all")}
        </Button>
      )}
      <span className="seg" role="group">
        <button type="button" onClick={() => onZoom(-1)} aria-label={t("zoom_out")} title={t("zoom_out")}><Minus size={14} /></button>
        <button type="button" onClick={() => onZoom(1)} aria-label={t("zoom_in")} title={t("zoom_in")}><Plus size={14} /></button>
        <button type="button" onClick={onFit} aria-label={t("fit_view")} title={t("fit_view")}><Maximize2 size={14} /></button>
      </span>
      <div className="relative ml-auto flex-1 min-w-[12rem] max-w-xs">
        <label className="sr-only" htmlFor="org-goto">{t("goto_agent")}</label>
        <Search size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input id="org-goto" className="input !pl-8 !py-1.5 !text-sm" type="search" value={q} placeholder={t("goto_placeholder")} autoComplete="off"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) { e.preventDefault(); pick(matches[0].slug); } if (e.key === "Escape") setOpen(false); }} />
        {open && needle && (
          <ul role="listbox" aria-label={t("goto_results")} className="absolute z-20 left-0 right-0 mt-1 panel p-1 flex flex-col gap-0.5 max-h-64 overflow-y-auto shadow-xl">
            {matches.length === 0 && <li className="text-sm text-muted px-2 py-1.5">{t("goto_none")}</li>}
            {matches.map((a) => (
              <li key={a.slug}>
                <button type="button" role="option" aria-selected={focusId === a.slug} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(a.slug)}
                  className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-panel-2">
                  <PixelFace avatar={a.avatar} size={22} ring={a.color} />
                  <span className="truncate flex-1 min-w-0 font-semibold">{a.name}</span>
                  <span className="text-xs text-muted truncate">{a.title ?? ""}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
