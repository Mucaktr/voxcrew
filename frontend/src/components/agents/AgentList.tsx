// Ekip S12: /ajanlar — ajan ızgarası, arama, filtreler (bağlantı, ekip, rütbe, durum, işe alınan) ve sıralama.
// Filtreler adres çubuğunda tutulur (?q=&baglanti=&ekip=&rutbe=&durum=&alinan=1&sira=), paylaşılabilir ve geri tuşuyla korunur.
// S20 (100+ ajan): ızgara satır bazında pencerelenir (yalnızca görünür satırlar çizilir); arama ve ekip süzgeci sunucuda
// (/api/agents?q=&team=) çalışır, diğer süzgeçler istemcide uygulanır.
import clsx from "clsx";
import { BookOpen, Building2, FilterX, Search, SlidersHorizontal, UserPlus, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  agentAvailability, agentConnectionKinds, agentMood, byName, RANK_LABEL, rankIndex, rankLabel, RANKS, searchAgents, statusGroup,
} from "../../lib/agents";
import { CONNECTION_META } from "../../lib/format";
import { fold } from "../../lib/hermes";
import { tp, useT } from "../../lib/i18n";
import { useOffice } from "../../lib/office";
import { useStudio } from "../../lib/store";
import type { Agent, Mood } from "../../lib/types";
import { agentsMsg as m } from "../../locales/agents";
import { GiftDepotLink } from "../../full/ui";
import { Button, Empty, PageHeader, Panel, Spinner } from "../ui";
import { ShareButtons } from "../share/ShareButtons";
import { AgentCard } from "./AgentCard";
import { NewAgentDialog } from "./NewAgentDialog";
import { LimitCardHost } from "../plan/LimitCard";
import { SeatRoster } from "../plan/SeatRoster";
import { useColumns, useRowSizer, useWindowRows } from "./windowing";

const STATUS_VALUES = ["calisiyor", "bosta", "erisilemiyor", "gizli", "tumu"] as const;
const SORT_VALUES = ["rutbe", "ad", "ekip", "durum", "son", "yeni"] as const;
const STATUS_KEY = { calisiyor: "st_busy", bosta: "st_idle", erisilemiyor: "st_unavailable", gizli: "st_hidden", tumu: "st_all" } as const;
const SORT_KEY = { rutbe: "sort_rank", ad: "sort_name", ekip: "sort_team", durum: "sort_status", son: "sort_last", yeni: "sort_new" } as const;

const FILTER_KEYS = ["q", "baglanti", "ekip", "rutbe", "durum", "alinan"] as const;
const BUSY_ORDER: Record<Mood, number> = { working: 0, thinking: 0, waiting: 1, done: 2, idle: 3, error: 4, offline: 5 };
/** Bu sayının üstünde arama/ekip süzgeci sunucuya gider (küçük listelerde istemci yeter). */
const SERVER_SEARCH_MIN = 60;
const GRID_GAP = 12;
const MIN_CARD_W = 300;

interface Row { agent: Agent; index: number; mood: Mood; avail: { ok: boolean; reason?: string }; activity: string; last: number }

export function AgentList() {
  const t = useT(m);
  const agents = useStudio((s) => s.agents);
  const states = useStudio((s) => s.states);
  const conns = useStudio((s) => s.connections);
  const runList = useStudio((s) => s.runList);
  const openComposer = useStudio((s) => s.openComposer);
  const teams = useOffice((s) => s.teams);
  const officeLoaded = useOffice((s) => s.loaded);
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  // dar ekranda süzgeçler katlanır (375 px'te listeyi ekranın altına itmesin)
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => { if (!officeLoaded) void useOffice.getState().refresh(); }, [officeLoaded]);

  const q = params.get("q") ?? "";
  const conn = params.get("baglanti") ?? "";
  const team = params.get("ekip") ?? "";
  const rank = params.get("rutbe") ?? "";
  const status = params.get("durum") ?? "";
  const hired = params.get("alinan") === "1";
  const sort = params.get("sira") ?? "rutbe";

  const set = (key: string, value: string) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
  };
  const anyFilter = FILTER_KEYS.some((k) => params.has(k));
  const activeFilters = FILTER_KEYS.filter((k) => k !== "q" && params.has(k)).length;
  const clear = () => setParams((p) => {
    const next = new URLSearchParams(p);
    FILTER_KEYS.forEach((k) => next.delete(k));
    return next;
  }, { replace: true });

  const teamBySlug = useMemo(() => new Map(teams.map((t) => [t.slug, t])), [teams]);
  const teamOrder = useMemo(() => new Map(teams.map((t, i) => [t.slug, i])), [teams]);

  // ---- sunucu araması (q, team): büyük listelerde eşleşen slug kümesi sunucudan gelir (gecikmeli, iptal edilebilir)
  const needle = fold(q.trim());
  const serverTeam = team && team !== "_yok" ? team : "";
  const useServer = agents.length >= SERVER_SEARCH_MIN && (!!needle || !!serverTeam);
  const [server, setServer] = useState<{ key: string; slugs: Set<string>; total: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const serverKey = useServer ? `${q.trim()}|${serverTeam}` : "";
  useEffect(() => {
    if (!serverKey) { setSearching(false); return; }
    const ctrl = new AbortController();
    setSearching(true);
    const id = window.setTimeout(() => {
      searchAgents({ q: q.trim() || undefined, team: serverTeam || undefined, limit: 5000 }, ctrl.signal)
        .then((r) => { if (!ctrl.signal.aborted) setServer({ key: serverKey, slugs: new Set(r.items.map((a) => a.slug)), total: r.total }); })
        .catch(() => { /* sunucu yoksa istemci süzgeci kullanılır */ })
        .finally(() => { if (!ctrl.signal.aborted) setSearching(false); });
    }, 180);
    return () => { ctrl.abort(); window.clearTimeout(id); };
  }, [serverKey, q, serverTeam]);
  const serverSlugs = useServer && server?.key === serverKey ? server.slugs : null;

  // son etkinlik: ajanın runList'teki en yeni adım zamanı
  const lastActive = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of runList) for (const s of r.steps ?? []) {
      if (!s.agent) continue;
      const ts = Date.parse(s.finished_at ?? s.started_at ?? r.finished_at ?? r.started_at ?? "") || 0;
      if (ts > (map.get(s.agent) ?? 0)) map.set(s.agent, ts);
    }
    return map;
  }, [runList]);

  const rows = useMemo<Row[]>(() => agents.map((a, index) => ({
    agent: a, index, mood: agentMood(a, states, conns), avail: agentAvailability(a, conns),
    activity: (states[a.slug] ?? a.state)?.activity ?? "", last: lastActive.get(a.slug) ?? 0,
  })), [agents, states, conns, lastActive]);

  const visible = useMemo(() => {
    const out = rows.filter(({ agent: a, mood }) => {
      if (status === "gizli") { if (!a.hidden) return false; }
      else if (status !== "tumu" && a.hidden) return false;
      if (status === "calisiyor" && statusGroup(mood) !== "busy") return false;
      if (status === "bosta" && statusGroup(mood) !== "idle") return false;
      if (status === "erisilemiyor" && statusGroup(mood) !== "unavailable") return false;
      if (conn && !agentConnectionKinds(a).includes(conn)) return false;
      if (rank === "_yok" ? !!rankLabel(a.rank) : rank && a.rank !== rank) return false;
      if (hired && !a.hired_by) return false;
      if (team === "_yok" && !!a.team && teamBySlug.has(a.team)) return false;
      if (serverSlugs) return serverSlugs.has(a.slug);
      if (team && team !== "_yok" && a.team !== team) return false;
      if (needle) {
        const hay = fold([a.name, a.slug, a.title, a.role, rankLabel(a.rank), a.team ? teamBySlug.get(a.team)?.name : "",
          a.hermes_profile, ...(a.skills ?? [])].filter(Boolean).join(" "));
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const cmpName = (x: Row, y: Row) => byName(x.agent, y.agent);
    const teamIdx = (r: Row) => (r.agent.team && teamOrder.has(r.agent.team) ? teamOrder.get(r.agent.team)! : 999);
    out.sort((x, y) => {
      switch (sort) {
        case "ad": return cmpName(x, y);
        case "ekip": return teamIdx(x) - teamIdx(y) || rankIndex(x.agent.rank) - rankIndex(y.agent.rank) || cmpName(x, y);
        case "durum": return BUSY_ORDER[x.mood] - BUSY_ORDER[y.mood] || cmpName(x, y);
        case "son": return y.last - x.last || cmpName(x, y);
        case "yeni": return y.index - x.index;
        default: return rankIndex(x.agent.rank) - rankIndex(y.agent.rank) || teamIdx(x) - teamIdx(y) || cmpName(x, y);
      }
    });
    return out;
  }, [rows, needle, conn, team, rank, status, hired, sort, teamBySlug, teamOrder, serverSlugs]);

  const hiddenCount = useMemo(() => agents.filter((a) => a.hidden).length, [agents]);
  const busyCount = useMemo(() => rows.filter((r) => !r.agent.hidden && statusGroup(r.mood) === "busy").length, [rows]);
  // "x / y" oranında payda, seçili durumun kapsadığı küme (varsayılan: gizliler hariç)
  const total = status === "gizli" ? hiddenCount : status === "tumu" ? agents.length : agents.length - hiddenCount;

  // ---- pencereli ızgara
  const gridRef = useRef<HTMLUListElement>(null);
  const cols = useColumns(gridRef, MIN_CARD_W, 4, visible.length > 0);
  const { rowHeight, observe } = useRowSizer(236);
  const rowCount = Math.ceil(visible.length / cols);
  const win = useWindowRows(gridRef, rowCount, rowHeight + GRID_GAP, 2);
  const slice = visible.slice(win.start * cols, win.end * cols);

  return (
    <div className="p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
      <PageHeader title={t("page_title")} subtitle={t("page_subtitle")}
        meta={<>
          <span className="chip"><Users size={12} aria-hidden />{tp(m, "count_agents", agents.length - hiddenCount)}</span>
          {busyCount > 0 && <span className="chip tone-info">{t("count_busy", { n: busyCount })}</span>}
          {hiddenCount > 0 && <span className="chip">{t("count_hidden", { n: hiddenCount })}</span>}
        </>}
        actions={<>
          <Link to="/skiller" className="btn"><BookOpen size={16} aria-hidden />{t("skill_library")}</Link>
          <GiftDepotLink />
          <ShareButtons kinds={["agent"]} onImported={() => void useStudio.getState().refreshAgents()} />
          <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setCreating(true)}>{t("new_agent")}</Button>
        </>} />

      {/* sınır kartı (modal değil) ve kadro paneli (etkin / yedek)*/}
      <LimitCardHost onRoster={() => document.getElementById("kadro")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
      <SeatRoster />

      <Panel bodyClass="pt-4">
        <div className="flex flex-col gap-3" role="search" aria-label={t("search_region")}>
          <div className="flex flex-wrap items-end gap-2">
            <label className="relative flex-1 min-w-full sm:min-w-[16rem]">
              <span className="sr-only">{t("search_label")}</span>
              <Search size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input className="input !pl-9" type="search" value={q} placeholder={t("search_placeholder")}
                onChange={(e) => set("q", e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-ink-2 flex-1 min-w-0 sm:flex-none">
              <span className="shrink-0">{t("sort")}</span>
              <select className="select sm:!w-auto" value={sort} onChange={(e) => set("sira", e.target.value === "rutbe" ? "" : e.target.value)}>
                {SORT_VALUES.map((s) => <option key={s} value={s}>{t(SORT_KEY[s])}</option>)}
              </select>
            </label>
            <Button className="md:hidden" icon={<SlidersHorizontal size={16} />} aria-expanded={showFilters} aria-controls="ajan-filtreleri"
              onClick={() => setShowFilters((v) => !v)}>
              {activeFilters > 0 ? t("filters_n", { n: activeFilters }) : t("filters")}
            </Button>
          </div>
          <div id="ajan-filtreleri" className={clsx("grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2 items-end", !showFilters && "max-md:hidden")}>
            <FilterSelect label={t("f_conn")} value={conn} onChange={(v) => set("baglanti", v)} all={t("f_conn_all")}
              options={[{ value: "hermes", label: t("f_conn_hermes") }, { value: "ollama", label: CONNECTION_META.ollama.label },
                { value: "codex", label: CONNECTION_META.codex.label }, { value: "claude", label: CONNECTION_META.claude.label },
                { value: "profile", label: CONNECTION_META.profile.label }]} />
            <FilterSelect label={t("f_team")} value={team} onChange={(v) => set("ekip", v)} all={t("f_team_all")}
              options={[...teams.map((x) => ({ value: x.slug, label: x.name })), { value: "_yok", label: t("f_team_none") }]} />
            <FilterSelect label={t("f_rank")} value={rank} onChange={(v) => set("rutbe", v)} all={t("f_rank_all")}
              options={[...RANKS.map((r) => ({ value: r, label: RANK_LABEL[r] })), { value: "_yok", label: t("f_rank_none") }]} />
            <FilterSelect label={t("f_status")} value={status} onChange={(v) => set("durum", v)} all={t("f_status_all")}
              options={STATUS_VALUES.map((s) => ({ value: s, label: t(STATUS_KEY[s]) }))} />
            <label className="col-span-2 md:col-span-1 flex items-center gap-2 min-h-[2.5rem] rounded-[10px] border-2 border-line-soft bg-panel-2 px-3 text-sm font-semibold cursor-pointer">
              <input type="checkbox" className="h-4 w-4 accent-[var(--grass)]" checked={hired} aria-label={t("only_hired")}
                onChange={(e) => set("alinan", e.target.checked ? "1" : "")} />
              {t("only_hired")}
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span role="status" aria-live="polite" className="text-ink-2 font-semibold num flex items-center gap-2">
              {visible.length === total ? tp(m, "showing_all", visible.length) : t("showing_of", { n: visible.length, total })}
              {searching && <span className="text-muted font-medium flex items-center gap-1"><Spinner size={12} />{t("searching")}</span>}
            </span>
            {anyFilter && <Button size="sm" variant="ghost" icon={<FilterX size={14} />} onClick={clear}>{t("clear_filters")}</Button>}
          </div>
        </div>
      </Panel>

      {agents.length === 0 ? (
        <Panel>
          <Empty icon={<Users size={28} />} title={t("empty_title")} text={t("empty_text")}
            action={<div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setCreating(true)}>{t("new_agent")}</Button>
              <Link to="/ofis" className="btn"><Building2 size={16} aria-hidden />{t("empty_office")}</Link>
            </div>} />
        </Panel>
      ) : visible.length === 0 ? (
        <Panel>
          <Empty icon={<Search size={28} />} title={t("nomatch_title")}
            text={status === "gizli" ? t("nomatch_hidden") : t("nomatch_text")}
            action={anyFilter ? <Button icon={<FilterX size={16} />} onClick={clear}>{t("clear_filters")}</Button> : undefined} />
        </Panel>
      ) : (
        <ul ref={gridRef} className="grid" aria-label={t("grid_label")}
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GRID_GAP, paddingTop: win.padTop, paddingBottom: win.padBottom }}>
          {slice.map((r) => (
            <li key={r.agent.slug} ref={observe} className="flex min-w-0 [&>article]:flex-1" style={{ minHeight: rowHeight }}>
              <AgentCard agent={r.agent} mood={r.mood} avail={r.avail} activity={r.activity}
                team={r.agent.team ? teamBySlug.get(r.agent.team) : null} onTask={() => openComposer(r.agent.slug)} />
            </li>
          ))}
        </ul>
      )}

      <NewAgentDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, all }:
  { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; all: string }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="label">{label}</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
