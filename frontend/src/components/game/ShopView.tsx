// Ekip S5 — Mağaza ve satın alma onayı. Jeton yalnızca kozmetik, kutlama stili, sahne ve eğlencelik ikram açar;
// hiçbir işlev kilitlenmez. İndirim sayacı ya da "son fırsat" yoktur. Satın alma iki adımlıdır: fiyat ve kalan bakiye
// gösterilir, ardından açık onay istenir (sunucu `confirm: true` olmadan reddeder).
import clsx from "clsx";
import { Check, Coffee, FlaskConical, Lock, Map as MapIcon, PartyPopper, Shirt, Sparkles, Wand2 } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { cosmeticsTabVisible, ensureCosmetics, useCosmetics } from "../../lib/cosmetics";
import { cosmeticsMsg } from "../../locales/cosmetics";
import { cityPacksMsg } from "../../locales/citypacks";
import { celebrationStyle, CELEBRATION_STYLES, gameApi, setCelebrationStyle, useGame, type ShopData, type ShopItem } from "../../lib/game";
import { useT } from "../../lib/i18n";
import { adminMsg } from "../../locales/admin";
import type { Avatar } from "../../lib/types";
import { game as m } from "../../locales/game";
import { world as WM } from "../../locales/world";
import { PixelFace } from "../PixelFace";
import { Button, Empty, Segmented, Spinner } from "../ui";
import { CoinAmount, GameDialog, RarityChip } from "./parts";
import { useGameData } from "./useGameData";
import { VisaStrip } from "./album/VisaStrip";
import { FullEditionCard } from "../world/FullEditionCard"; // EDITION1: free sürümde pasaport yanında

// COS-B: kozmetik mağazası sekmesi (bayrak `store.cosmetics_enabled` ya da yönetici/test modu; satış yok, tembel yüklenir)
const CosmeticStoreTab = lazy(() => import("./CosmeticStoreTab"));
// CITY-PACKS: şehir paketleri sekmesi (aynı bayrak; satış yok, tembel yüklenir)
const CityPackStoreTab = lazy(() => import("./CityPackStoreTab"));

type Kind = "all" | ShopItem["kind"];
/** SP-W0: sahne öğelerinin arka uç alanları (game/service.py `_scene_fields`, `passport`). */
type SceneItem = ShopItem & { tier?: "core" | "city" | "premium"; pack?: string | null; earn?: string };
type Passport = { flows: number; available: number };
const TIER_ORDER = ["core", "city", "premium"] as const;
/** Sahne öğelerini katman → paket sırasıyla gruplar (Çekirdek · Şehirler/paket · Premium). */
function sceneGroups(items: SceneItem[]): { key: string; tier: string; pack: string | null; items: SceneItem[] }[] {
  const out: { key: string; tier: string; pack: string | null; items: SceneItem[] }[] = [];
  for (const tier of TIER_ORDER) for (const it of items) {
    if ((it.tier ?? "core") !== tier) continue;
    const pack = tier === "city" ? it.pack ?? null : null, key = `${tier}:${pack ?? ""}`;
    (out.find((g) => g.key === key) ?? out[out.push({ key, tier, pack, items: [] }) - 1]).items.push(it);
  }
  return out;
}
const KINDS: ShopItem["kind"][] = ["cosmetic", "celebration", "scene", "consumable"];
const SAMPLE: Partial<Avatar> = { species: "fox", skin: "#E8833A", hat: "none", glasses: "none" };

function ItemPreview({ item, avatar, size = 44 }: { item: Pick<ShopItem, "id" | "kind">; avatar?: Partial<Avatar>; size?: number }) {
  const [slot, name] = item.id.split(":");
  if (item.kind === "cosmetic" && (slot === "hat" || slot === "glasses"))
    return <PixelFace avatar={{ ...SAMPLE, ...avatar, [slot]: name }} size={size} />;
  const Icon = item.kind === "scene" ? MapIcon : item.kind === "celebration" ? Sparkles : item.kind === "consumable"
    ? (name === "coffee" ? Coffee : PartyPopper) : Shirt;
  return (
    <span className="grid place-items-center rounded-lg border-2 border-line-soft bg-panel-2 text-ink-2 shrink-0" style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.45)} aria-hidden />
    </span>
  );
}

export function ShopView() {
  const t = useT(m);
  const tw = useT(WM);
  const ta = useT(adminMsg);
  const { data, error, loading, reload } = useGameData<ShopData>(() => gameApi.shop(), []);
  const [kind, setKind] = useState<Kind>("all");
  const [buying, setBuying] = useState<ShopItem | null>(null);
  const [stamping, setStamping] = useState<SceneItem | null>(null);
  const [style, setStyle] = useState(celebrationStyle);
  const tc = useT(cosmeticsMsg);
  const tcp = useT(cityPacksMsg);
  const [view, setView] = useState<"coins" | "cosmetics" | "city">("coins");
  const cosEnabled = useCosmetics((s) => s.enabled);
  useEffect(() => { void ensureCosmetics(); }, []);
  const items = useMemo(() => (data?.items ?? []).filter((i) => kind === "all" || i.kind === kind), [data, kind]);
  const plain = useMemo(() => items.filter((i) => i.kind !== "scene"), [items]);
  const scenes = useMemo(() => sceneGroups(items.filter((i) => i.kind === "scene") as SceneItem[]), [items]);
  const passport = (data as (ShopData & { passport?: Passport }) | null)?.passport;

  const card = (it: SceneItem) => {
    const styleId = it.kind === "celebration" ? CELEBRATION_STYLES.find((c) => c.item === it.id)?.id : undefined;
    return (
      <li key={it.id} className="min-w-0">
        <article className="panel p-3 h-full flex flex-col gap-2.5" aria-label={it.label}>
          <div className="flex items-start gap-3 min-w-0">
            <ItemPreview item={it} />
            <div className="flex-1 min-w-0">
              <h3 className="font-display font-semibold text-sm text-ink truncate">{it.label}</h3>
              <p className="text-xs text-muted">{t(`kind_${it.kind}`)}</p>
              <RarityChip rarity={it.rarity} className="mt-1" />
            </div>
          </div>
          {it.description && <p className="text-xs text-ink-2 leading-4">{it.description}</p>}
          <div className="mt-auto flex flex-wrap items-center gap-2">
            {it.owned ? (
              <>
                <span className="chip tone-ok"><Check size={12} />{t("owned")}</span>
                {styleId && (style === styleId
                  ? <span className="chip tone-info">{t("in_use")}</span>
                  : <Button size="sm" onClick={() => { setCelebrationStyle(styleId); setStyle(styleId); }}>{t("use")}</Button>)}
              </>
            ) : (
              <>
                <CoinAmount value={it.price} />
                {!it.level_ok && <span className="chip tone-muted"><Lock size={11} />{t("office_lv_req", { n: it.min_level })}</span>}
                {it.unlock_level > 0 && <span className="text-xs text-muted">{t("free_at_level", { n: it.unlock_level })}</span>}
                {it.achievement_name && <span className="text-xs text-muted">{t("free_with", { name: it.achievement_name })}</span>}
                {it.earn === "stamp" && <span className="text-xs text-muted">{t("earn_stamp")}</span>}
                {it.earn === "stamp" && !data?.admin && (passport?.available ?? 0) > 0 && (
                  <Button size="sm" variant="primary" onClick={() => setStamping(it)}>{t("stamp_unlock")}</Button>
                )}
                <Button size="sm" variant={it.can_buy ? "gold" : "default"} className="ml-auto" onClick={() => setBuying(it)}
                  aria-label={t("buy_aria", { label: it.label, action: it.kind === "consumable" ? t("buy") : t("unlock"), price: it.price })}>
                  {it.kind === "consumable" ? t("buy") : t("unlock")}
                </Button>
              </>
            )}
          </div>
        </article>
      </li>
    );
  };

  if (loading && !data) return <div className="grid place-items-center py-16"><Spinner size={24} /></div>;
  if (error && !data) return <p className="text-sm text-bad" role="alert">{error}</p>;
  if (!data) return null;
  const views = cosmeticsTabVisible(cosEnabled, data.admin) && (
    <div aria-label={tc("views_label")}>
      <Segmented<"coins" | "cosmetics" | "city"> value={view} onChange={setView} className="flex-wrap"
        options={[{ value: "coins", label: tc("tab_coins") }, { value: "cosmetics", label: tc("tab_store") }, { value: "city", label: tcp("tab") }]} />
    </div>
  );
  if (views && view === "city") return (
    <div className="flex flex-col gap-4">
      {views}
      <Suspense fallback={<div className="grid place-items-center py-16"><Spinner size={24} /></div>}>
        <CityPackStoreTab admin={data.admin} />
      </Suspense>
    </div>
  );
  if (views && view === "cosmetics") return (
    <div className="flex flex-col gap-4">
      {views}
      <Suspense fallback={<div className="grid place-items-center py-16"><Spinner size={24} /></div>}>
        <CosmeticStoreTab admin={data.admin} />
      </Suspense>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {views}
      <div className="panel-soft p-3 sm:p-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <p className="text-sm text-ink-2">{t("balance")} <CoinAmount value={data.balance} className="text-base text-ink" /></p>
        <p className="text-sm text-ink-2">{t("office_level")} <strong className="num font-semibold text-ink">{data.office_level}</strong></p>
        {data.creative && <span className="chip tone-info"><Wand2 size={12} />{t("creative_chip")}</span>}
        {data.admin && <span className="chip tone-warn" title={ta("toggle_hint")}><FlaskConical size={12} aria-hidden />{ta("shop_chip")}</span>}
        {passport && (passport.flows > 0 || passport.available > 0) && (
          <p className="text-sm text-ink-2" title={t("passport_hint")}>{t("passport", { n: passport.available, flows: passport.flows })}</p>
        )}
        <p className="text-xs text-muted w-full">{t("shop_hint")}</p>
        {/* W4: vizeler damgalardan ayrı; şehir açmaz */}
        <VisaStrip />
        <FullEditionCard className="w-full" />
      </div>
      <Segmented<Kind> value={kind} onChange={setKind} options={[{ value: "all", label: t("all") },
        ...KINDS.map((k) => ({ value: k, label: t(`kind_${k}`) }))]} />
      {items.length ? (
        <>
          {plain.length > 0 && <ul className="grid gap-3 grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{plain.map(card)}</ul>}
          {scenes.map((g) => (
            <section key={g.key} aria-label={g.tier === "city" && g.pack ? tw(`pack_${g.pack}` as "tier_city") : tw(`tier_${g.tier}` as "tier_core")}>
              <h3 className="t-overline text-muted mb-2">{t("scene_group", {
                name: g.tier === "city" && g.pack ? `${tw("tier_city")} · ${tw(`pack_${g.pack}` as "tier_city")}` : tw(`tier_${g.tier}` as "tier_core"),
                n: g.items.length })}</h3>
              <ul className="grid gap-3 grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{g.items.map(card)}</ul>
            </section>
          ))}
        </>
      ) : <Empty title={t("no_items")} />}
      {isCustomStyle(style) && (
        <p className="text-xs text-muted">{t("style_current", { name: CELEBRATION_STYLES.find((c) => c.id === style)?.label })}
          {" "}<button type="button" className="underline" onClick={() => { setCelebrationStyle("confetti"); setStyle("confetti"); }}>{t("back_to_confetti")}</button></p>
      )}
      {stamping && (
        <StampDialog item={stamping} left={passport?.available ?? 0} onClose={() => setStamping(null)}
          onDone={() => { setStamping(null); void reload(); }} />
      )}
      {buying && (
        <PurchaseDialog item={buying} balance={data.balance} officeLevel={data.office_level}
          onClose={() => setBuying(null)} onDone={() => { setBuying(null); void reload(); }} />
      )}
    </div>
  );
}

const isCustomStyle = (s: string) => s !== "confetti";

/** SP-W1: pasaport damgasıyla şehir açma onayı (sunucu `confirm: true` olmadan reddeder; MCP'den kapalı). */
function StampDialog({ item, left, onClose, onDone }: { item: SceneItem; left: number; onClose: () => void; onDone: () => void }) {
  const t = useT(m);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redeem = async () => {
    setBusy(true);
    setError(null);
    try {
      await gameApi.redeemStamp(item.id.slice(item.id.indexOf(":") + 1));
      await useGame.getState().refresh();
      onDone();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <GameDialog open onClose={onClose} title={t("stamp_q", { label: item.label })}
      footer={<>
        <Button onClick={onClose} data-autofocus>{t("cancel")}</Button>
        <Button variant="primary" onClick={redeem} disabled={busy || left < 1}>{busy ? t("opening") : t("stamp_unlock")}</Button>
      </>}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <ItemPreview item={item} size={64} />
          <div className="min-w-0">
            <p className="font-semibold text-ink">{item.label}</p>
            <p className="text-xs text-muted">{t("stamp_note")}</p>
          </div>
        </div>
        <p className="text-sm text-ink-2">{t("stamp_left", { n: left })}</p>
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      </div>
    </GameDialog>
  );
}

export interface PurchasableItem {
  id: string; label: string; price: number; kind: ShopItem["kind"] | string; min_level: number; unlock_level: number;
  achievement_name?: string | null;
}

/** İki adımlı satın alma onayı (AvatarEditor ve mağaza ortak). */
export function PurchaseDialog({ item, balance, officeLevel, avatar, onClose, onDone }:
  { item: PurchasableItem; balance?: number; officeLevel?: number; avatar?: Partial<Avatar>; onClose: () => void;
    onDone: (id: string) => void }) {
  const t = useT(m);
  const profile = useGame((s) => s.profile);
  const bal = balance ?? profile?.coins ?? 0;
  const level = officeLevel ?? profile?.office.level ?? 1;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const levelOk = level >= item.min_level;
  const enough = bal >= item.price;
  const consumable = item.kind === "consumable";

  const buy = async () => {
    setBusy(true);
    setError(null);
    try {
      await gameApi.buy(item.id);
      await useGame.getState().refresh();
      onDone(item.id);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <GameDialog open onClose={onClose} title={consumable ? t("buy_q", { label: item.label }) : t("unlock_q", { label: item.label })}
      footer={<>
        <Button onClick={onClose} data-autofocus>{t("cancel")}</Button>
        <Button variant="primary" onClick={buy} disabled={busy || !enough || !levelOk}>
          {busy ? t("opening") : consumable ? t("buy_for", { price: item.price }) : t("unlock_for", { price: item.price })}
        </Button>
      </>}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <ItemPreview item={{ id: item.id, kind: item.kind as ShopItem["kind"] }} avatar={avatar} size={64} />
          <div className="min-w-0">
            <p className="font-semibold text-ink">{item.label}</p>
            <p className="text-xs text-muted">{consumable ? t("consumable_note") : t("permanent_note")}</p>
          </div>
        </div>
        <dl className="panel-soft p-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-2">{t("price")}</dt><dd className="text-right"><CoinAmount value={item.price} /></dd>
          <dt className="text-ink-2">{t("your_balance")}</dt><dd className="text-right"><CoinAmount value={bal} /></dd>
          <dt className="text-ink-2">{t("after")}</dt>
          <dd className={clsx("text-right", !enough && "text-bad")}><CoinAmount value={Math.max(0, bal - item.price)} /></dd>
        </dl>
        {!levelOk && <p className="text-sm text-warn" role="alert">{t("level_required", { min: item.min_level, cur: level })}</p>}
        {levelOk && !enough && (
          <p className="text-sm text-ink-2" role="alert">{t("not_enough", { n: item.price - bal })}</p>
        )}
        {item.unlock_level > 0 && <p className="text-xs text-muted">{t("free_later", { level: item.unlock_level })}</p>}
        {item.achievement_name && <p className="text-xs text-muted">{t("free_ach", { name: item.achievement_name })}</p>}
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      </div>
    </GameDialog>
  );
}
