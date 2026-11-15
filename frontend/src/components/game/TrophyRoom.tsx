// Ekip S5 — Kupa odası: özet, filtre/sıralama, ok tuşlarıyla gezilen ızgara, detay penceresi, son kazanımlar.
// Kilitli başarımların koşulu her zaman açık yazılır; gizliler "???" ve ipucuyla görünür (araştırma B.9, C.3).
import clsx from "clsx";
import { Trophy } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { timeAgo } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { game as m } from "../../locales/game";
import { gameApi, RARITY_LABEL, type AchievementItem, type AchievementsData, type Rarity } from "../../lib/game";
import { Empty, Panel, Segmented, Spinner } from "../ui";
import { CoinAmount, GameDialog, RarityChip, RarityFrame } from "./parts";
import { useGameData } from "./useGameData";

type Show = "all" | "earned" | "locked" | "hidden";
type Sort = "recent" | "soon" | "rarity";
const RARITY_ORDER: Rarity[] = ["common", "rare", "epic", "legendary"];
type T = ReturnType<typeof useT<typeof m.tr>>;
const subjectLabel = (t: T, s: AchievementItem["subject"]) => t(`subject_${s}`);

export function TrophyRoom() {
  const t = useT(m);
  const { data, error, loading } = useGameData<AchievementsData>(() => gameApi.achievements(), []);
  const [show, setShow] = useState<Show>("all");
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [open, setOpen] = useState<AchievementItem | null>(null);

  useEffect(() => { void gameApi.markSeen().catch(() => undefined); }, []);

  const items = useMemo(() => {
    if (!data) return [];
    const list = data.items.filter((a) =>
      (cat === "all" || a.category === cat) &&
      (show === "all" || (show === "earned" ? a.best_tier > 0 : show === "locked" ? a.best_tier === 0 && !a.hidden : a.hidden)));
    const lastAt = (a: AchievementItem) => Math.max(0, ...a.earned.map((e) => e.unlocked_at));
    const ratio = (a: AchievementItem) => a.progress && a.progress.next ? a.progress.value / a.progress.next : a.best_tier ? -1 : 0;
    return [...list].sort((a, b) =>
      sort === "recent" ? lastAt(b) - lastAt(a) || b.best_tier - a.best_tier
        : sort === "soon" ? ratio(b) - ratio(a)
        : RARITY_ORDER.indexOf(b.tiers[b.tiers.length - 1].rarity) - RARITY_ORDER.indexOf(a.tiers[a.tiers.length - 1].rarity));
  }, [data, show, cat, sort]);

  if (loading && !data) return <div className="grid place-items-center py-16"><Spinner size={24} /></div>;
  if (error && !data) return <p className="text-sm text-bad" role="alert">{error}</p>;
  if (!data) return null;
  const s = data.summary;

  return (
    <div className="flex flex-col gap-4">
      <div className="panel-soft p-3 sm:p-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <p className="t-kpi">{s.earned}<span className="text-muted text-base font-medium">/{s.total}</span>
          <span className="sr-only">{t("tiers_sr")}</span></p>
        <span className="text-sm text-ink-2">{t("tiers_summary", { earned: s.kinds_earned, total: s.kinds_total })}</span>
        <ul className="flex flex-wrap gap-1.5 ml-auto" aria-label={t("by_rarity")}>
          {RARITY_ORDER.map((r) => (
            <li key={r} className="flex items-center gap-1"><RarityChip rarity={r} /><span className="text-xs num text-ink-2">{s.by_rarity[r] ?? 0}</span></li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<Show> value={show} onChange={setShow} options={[
            { value: "all", label: t("show_all") }, { value: "earned", label: t("show_earned") },
            { value: "locked", label: t("show_locked") }, { value: "hidden", label: t("show_hidden") }]} />
          <label className="flex items-center gap-2 ml-auto">
            <span className="text-xs font-semibold text-ink-2">{t("sort")}</span>
            <select className="select !w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="recent">{t("sort_recent")}</option>
              <option value="soon">{t("sort_soon")}</option>
              <option value="rarity">{t("sort_rarity")}</option>
            </select>
          </label>
        </div>
        <Segmented value={cat} onChange={setCat}
          options={[{ value: "all", label: t("all_categories") }, ...Object.entries(data.categories).map(([v, l]) => ({ value: v, label: l }))]} />
      </div>

      {items.length ? <TrophyGrid items={items} onOpen={setOpen} />
        : <Panel><Empty icon={<Trophy size={26} />} title={t("no_match")} /></Panel>}

      {data.recent.length > 0 && (
        <Panel title={t("recent_earned")} icon={<Trophy size={16} />}>
          <ul className="flex flex-col gap-1.5">
            {data.recent.map((r) => (
              <li key={`${r.id}-${r.tier}-${r.subject}`} className="flex flex-wrap items-center gap-2 text-sm min-w-0">
                <RarityChip rarity={r.rarity} />
                <span className="font-semibold">{r.name}</span>
                <span className="text-muted">· {r.who}</span>
                <span className="text-xs text-muted ml-auto">{timeAgo(r.unlocked_at * 1000)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {open && <AchievementDialog item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function TrophyGrid({ items, onOpen }: { items: AchievementItem[]; onOpen: (a: AchievementItem) => void }) {
  const t = useT(m);
  const grid = useRef<HTMLUListElement>(null);
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(e.key) || !grid.current) return;
    const buttons = Array.from(grid.current.querySelectorAll<HTMLButtonElement>("button[data-cell]"));
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const cols = getComputedStyle(grid.current).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowDown" ? i + cols
      : e.key === "ArrowUp" ? i - cols : e.key === "Home" ? 0 : buttons.length - 1;
    if (next >= 0 && next < buttons.length) { e.preventDefault(); buttons[next].focus(); }
  };
  return (
    <ul ref={grid} onKeyDown={onKey} aria-label={t("grid_label")}
      className="grid gap-3 grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {items.map((a) => <li key={a.id} className="min-w-0"><TrophyCard item={a} onOpen={() => onOpen(a)} /></li>)}
    </ul>
  );
}

function TrophyCard({ item: a, onOpen }: { item: AchievementItem; onOpen: () => void }) {
  const t = useT(m);
  const earned = a.best_tier > 0;
  const tier = a.tiers[Math.max(0, a.best_tier - 1)];
  const next = a.tiers[a.best_tier];
  const label = earned ? t("card_earned", { name: a.name, rarity: RARITY_LABEL[tier.rarity] }) : a.secret ? t("card_secret", { name: a.name }) : t("card_locked", { name: a.name });
  return (
    <button type="button" data-cell onClick={onOpen} aria-label={label}
      className={clsx("card-select w-full h-full p-3 flex items-start gap-3 text-left", !earned && "border-dashed")}>
      <RarityFrame rarity={earned ? tier.rarity : a.tiers[0].rarity} icon={a.icon} size={56} locked={!earned} secret={a.secret} />
      <span className="flex-1 min-w-0 flex flex-col gap-1">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="font-display font-semibold text-sm text-ink truncate">{earned ? tier.name : a.name}</span>
        </span>
        <span className="text-xs text-ink-2 leading-4 line-clamp-2">{a.secret ? t("hint", { text: a.description }) : a.description}</span>
        <span className="flex flex-wrap items-center gap-1.5 mt-0.5">
          {earned ? <RarityChip rarity={tier.rarity} /> : <span className="chip tone-muted">{a.secret ? t("secret") : t("locked")}</span>}
          <span className="text-xs text-muted">{subjectLabel(t, a.subject)}</span>
          {a.ownership != null && <span className="text-xs text-muted">{t("ownership", { n: a.ownership })}</span>}
        </span>
        {!a.secret && !earned && <span className="text-xs text-muted">{t("condition", { text: a.condition })}</span>}
        {a.progress && next && (
          <span className="flex items-center gap-2 mt-0.5">
            <span className="flex-1 h-1.5 rounded-full bg-panel-3 overflow-hidden" aria-hidden>
              <span className="block h-full bg-grass" style={{ width: `${Math.min(100, Math.round((a.progress.value / next.threshold) * 100))}%` }} />
            </span>
            <span className="text-xs num text-ink-2">{Math.min(a.progress.value, next.threshold)}/{next.threshold}</span>
          </span>
        )}
      </span>
    </button>
  );
}

function AchievementDialog({ item: a, onClose }: { item: AchievementItem; onClose: () => void }) {
  const t = useT(m);
  const tier = a.tiers[Math.max(0, a.best_tier - 1)];
  return (
    <GameDialog open onClose={onClose} title={a.secret ? t("secret_title") : a.name} width={520}
      footer={<button type="button" className="btn btn-primary" onClick={onClose} data-autofocus>{t("ok")}</button>}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <RarityFrame rarity={a.best_tier ? tier.rarity : a.tiers[0].rarity} icon={a.icon} size={72} locked={!a.best_tier} secret={a.secret} />
          <div className="min-w-0">
            <p className="text-sm text-ink-2">{a.secret ? t("hint", { text: a.description }) : a.description}</p>
            <p className="text-xs text-muted mt-1">{a.category_label} · {subjectLabel(t, a.subject)}{a.special ? t("special") : ""}</p>
          </div>
        </div>
        {!a.secret && (
          <div className="flex flex-col gap-1.5">
            <h3 className="panel-title">{t("tiers")}</h3>
            <ul className="flex flex-col gap-1.5">
              {a.tiers.map((tier) => (
                <li key={tier.tier} className={clsx("panel-soft px-3 py-2 flex flex-wrap items-center gap-2", a.best_tier >= tier.tier && "border-line")}>
                  <span className="font-semibold text-sm">{tier.name}</span>
                  <RarityChip rarity={tier.rarity} />
                  <span className="text-xs text-muted">{t("threshold", { n: tier.threshold })}</span>
                  <span className="ml-auto flex items-center gap-2 text-xs">
                    {!a.special && <><CoinAmount value={tier.coins} sign /><span className="num text-ink-2">+{tier.xp} XP</span></>}
                    {a.best_tier >= tier.tier ? <span className="chip tone-ok">{t("earned_chip")}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {a.reward_item && <p className="text-xs text-muted">{t("reward_item")}</p>}
            {a.progress && <p className="text-xs text-muted num">{t("progress", { value: a.progress.value })}{a.progress.next ? t("progress_of", { next: a.progress.next }) : ""}</p>}
          </div>
        )}
        {a.earned.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="panel-title">{t("earners")}</h3>
            <ul className="flex flex-col gap-1">
              {a.earned.map((e) => (
                <li key={`${e.subject}-${e.tier}`} className="flex items-center gap-2 text-sm">
                  <span className="font-semibold">{e.who}</span><span className="text-muted">· {e.name}</span>
                  <span className="text-xs text-muted ml-auto">{timeAgo(e.unlocked_at * 1000)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </GameDialog>
  );
}
