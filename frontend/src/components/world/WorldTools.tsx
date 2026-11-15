/**
 * Dünya araçları (S13): "Ajan bul" araması (ad/unvan; klavye ile ok tuşları + Enter) ve ekip filtresi
 * (seçilen ekip dışındakiler dünyada soluklaşır). Dar ekranda (375 px) alt alta sığar.
 * S33: ışık modu düğmesi (Otomatik → Gündüz → Gece); otomatik yerel saati izler, tercih bu tarayıcıda saklanır.
 * Etiket yoğunluğu: Minimal / Üzerine gelince (varsayılan) / Hepsi — tercih bu tarayıcıda saklanır.
 * S43: "Ortam canlılığı" (kuşlar, kediler, martılar…) açık/kapalı düğmesi — varsayılan açık, bu tarayıcıda saklanır.
 * S47: Etiketler, ışık, ortam ve eğlenceli hareketler tek bir "Görünüm" açılır panelinde (ViewMenu); tercihlerin anahtarları
 * değişmedi (viewSettings.ts). Satır: arama · Görünüm · ekip filtresi — geniş ekranda tek satır, 375 px'te de tek satır.
 * W2 (WALK-INT): "Yürü" düğmesi (insan simgesi; kısayol Y, dünya odaktayken) satırın başında; sahne önizlemesinde kapalı.
 * W5 (WALK-W5): satır sonunda "Diğer araçlar" (⋯) menüsü: "Avatarım (Ben)" editörü her genişlikte burada; `compact` (375 px
 * satırı) iken ekip filtresi de satırdan menüye taşınır — arama kutusu okunur genişlikte kalır, yatay taşma yok.
 */
import clsx from "clsx";
import { BadgeCheck, Ellipsis, Filter, PersonStanding, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useT } from "../../lib/i18n";
import { walk as WM } from "../../locales/walk";
import { world as M } from "../../locales/world";
import type { WorldTeam } from "../../voxel/World";
import { useWalkStore } from "../../voxel/walk/walkStore";
import { ViewMenu } from "./ViewMenu";
import "./world.css";

export interface FindableAgent { slug: string; name: string; title?: string | null; team?: string | null; color: string }

/** W2: Yürü düğmesi durumu (verilmezse düğme yok). */
export interface WalkToggle { on: boolean; disabled: boolean; onToggle: () => void }

export function WorldTools({ agents, teams, focusTeam, onFocusTeam, onPick, className, walk, compact = false }: {
  agents: FindableAgent[];
  teams: WorldTeam[];
  focusTeam: string | null;
  onFocusTeam: (slug: string | null) => void;
  onPick: (slug: string) => void;
  className?: string;
  walk?: WalkToggle;
  /** W5: dar satır (375 px): ekip filtresi ⋯ menüsünde */
  compact?: boolean;
}) {
  const t = useT(M);
  const tw = useT(WM);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const byTeam = useMemo(() => new Map(teams.map((tm) => [tm.slug, tm])), [teams]);

  const results = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase();
    if (!needle) return [];
    const score = (a: FindableAgent) => {
      const n = a.name.toLocaleLowerCase(), tt = (a.title ?? "").toLocaleLowerCase();
      if (n.startsWith(needle)) return 0;
      if (n.includes(needle)) return 1;
      if (tt.includes(needle)) return 2;
      return 9;
    };
    return agents.map((a) => ({ a, s: score(a) })).filter((x) => x.s < 9).sort((x, y) => x.s - y.s || x.a.name.localeCompare(y.a.name)).slice(0, 8).map((x) => x.a);
  }, [agents, q]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);

  const pick = (slug: string) => { onPick(slug); setOpen(false); setQ(""); input.current?.blur(); };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { if (results[active]) { e.preventDefault(); pick(results[active].slug); } }
    else if (e.key === "Escape") { if (q) { setQ(""); setOpen(false); } else input.current?.blur(); }
  };

  const hasTeams = teams.length > 0;
  const filter = hasTeams && (
    <label className={clsx("wtools-filter", compact && "!flex-auto !max-w-none w-full")}>
      <Filter size={14} aria-hidden="true" className="shrink-0 text-muted" />
      <span className="sr-only">{t("tools_team_filter")}</span>
      <select className="wtools-select" value={focusTeam ?? ""} onChange={(e) => onFocusTeam(e.target.value || null)} aria-label={t("tools_team_filter")}>
        <option value="">{t("tools_team_all")}</option>
        {teams.map((tm) => <option key={tm.slug} value={tm.slug}>{tm.name}</option>)}
      </select>
    </label>
  );
  return (
    <div ref={root} className={clsx("wtools pointer-events-auto", className)}>
      {walk && (
        <button type="button" className={clsx("btn btn-sm shrink-0", walk.on && "btn-primary")} onClick={walk.onToggle} disabled={walk.disabled}
          aria-pressed={walk.on} aria-keyshortcuts="Y" data-wizard-return="" aria-label={walk.on ? tw("exit_aria") : tw("enter_aria")}
          title={walk.disabled ? tw("enter_disabled") : walk.on ? tw("exit_aria") : tw("enter_aria")}>
          <PersonStanding size={15} aria-hidden="true" />{walk.on ? tw("exit") : tw("enter")}
        </button>
      )}
      <div className="wtools-find">
        <Search size={14} aria-hidden="true" className="shrink-0 text-muted" />
        <input ref={input} type="search" className="wtools-input" value={q} role="combobox" aria-label={t("tools_find")} placeholder={t("tools_find_placeholder")}
          aria-expanded={open && results.length > 0} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${results[active].slug}` : undefined}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey} />
        {q && (
          <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={t("tools_clear")} onClick={() => { setQ(""); input.current?.focus(); }}>
            <X size={12} aria-hidden="true" />
          </button>
        )}
        {open && q.trim() && (
          <ul id={listId} role="listbox" className="wtools-list" aria-label={t("tools_find_results", { n: results.length })}>
            {results.length === 0 && <li className="wtools-empty" role="option" aria-selected={false}>{t("tools_find_empty")}</li>}
            {results.map((a, i) => (
              <li key={a.slug} id={`${listId}-${a.slug}`} role="option" aria-selected={i === active}
                className={clsx("wtools-item", i === active && "is-active")}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(a.slug)}>
                <span className="minimap-swatch" style={{ background: a.color }} aria-hidden="true" />
                <span className="truncate font-semibold">{a.name}</span>
                {(a.title || (a.team && byTeam.get(a.team))) && (
                  <span className="truncate text-muted">{[a.title, a.team ? byTeam.get(a.team)?.name : null].filter(Boolean).join(" · ")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <ViewMenu />
      {!compact && filter}
      <MoreMenu label={tw("tools_more")}>
        {compact && filter}
        <button type="button" className="btn btn-sm min-h-11 w-full justify-start" onClick={() => useWalkStore.getState().setEditor(true)}>
          <BadgeCheck size={15} aria-hidden="true" />{tw("tools_me")}
        </button>
      </MoreMenu>
    </div>
  );
}

/** W5: "Diğer araçlar" açılır paneli (ViewMenu ile aynı desen: dışarı tıklama ve Esc kapatır, odak düğmeye döner). */
function MoreMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    root.current?.querySelector<HTMLElement>(".vmenu select, .vmenu button")?.focus();
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div ref={root} className="vmenu-wrap">
      <button ref={btn} type="button" className={clsx("wtools-btn", open && "is-open")} aria-expanded={open} aria-controls={panelId} aria-haspopup="dialog"
        aria-label={label} title={label} onClick={() => setOpen((v) => !v)}>
        <Ellipsis size={14} aria-hidden="true" />
      </button>
      {open && <div id={panelId} role="dialog" aria-label={label} className="vmenu" onClick={(e) => { if ((e.target as Element).closest("button")) setOpen(false); }}>{children}</div>}
    </div>
  );
}
