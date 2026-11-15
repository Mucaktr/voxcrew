// COS-B — "Kozmetik mağazası" sekmesi. Bayrak `store.cosmetics_enabled` arkasında; yönetici/
// test modunda önizleme. Parayla satış YOK (para fiyatı "satışta değil", para ile satın al düğmesi yok). Aynı set kazanılmış
// jetonla alınabilir (2026-10-19 gece kararı; oyunun onaylı alım akışı). Kur/dönüşüm, geri sayım, "yeni!" rozeti ya da sıralama yoktur.
// 3D deneme kaydedilmez ve pencere kapanınca geri döner; deneme davranışı hiçbir yere gönderilmez.
import clsx from "clsx";
import { Check, Eye, FlaskConical, PartyPopper, Shirt, Sparkles, Sun, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  applyWear, bare, buyWithCoins, ensureCosmetics, setEquip, syncCosmetics, useCosmetics, useEquip, type Equip,
} from "../../lib/cosmetics";
import { useT } from "../../lib/i18n";
import { useStudio } from "../../lib/store";
import type { Avatar } from "../../lib/types";
import { cosmeticsMsg as M, itemKey, setDescKey, setKey } from "../../locales/cosmetics";
import { DEFAULT_AVATAR, HUMAN_LOOKS, normalizeAvatar } from "../../voxel/avatar";
import { setCoverage } from "../../voxel/cosmetics/coverage";
import { COSMETIC_SETS, cosmeticItem, type CosmeticItem, type CosmeticSet, type Slot } from "../../voxel/cosmetics/registry";
import { TryOnStage } from "../../voxel/cosmetics/TryOnStage";
import { useReducedMotion } from "../../voxel/motion";
import { useMeLook } from "../../voxel/walk/me";
import { Button, Empty, Toggle } from "../ui";
import { useGame } from "../../lib/game";
import { CoinAmount, GameDialog } from "./parts";

const SLOT_ICON: Record<Slot, ReactNode> = {
  outfit: <Shirt size={12} aria-hidden />, desk: <Sparkles size={12} aria-hidden />, world: <Sun size={12} aria-hidden />,
  celebration: <PartyPopper size={12} aria-hidden />,
};
const SAMPLE: Avatar = HUMAN_LOOKS[3] ?? DEFAULT_AVATAR;
/** Vitrin bölümleri (HERO-PACKS): ofis setleri ve karakter/kostüm paketleri. Sıralama yok; kayıt defteri sırası. */
const GROUPS: { id: "office" | "costume"; sets: readonly CosmeticSet[] }[] = (["office", "costume"] as const)
  .map((id) => ({ id, sets: COSMETIC_SETS.filter((s) => (s.group ?? "office") === id) }))
  .filter((g) => g.sets.length > 0);

/** Fiyat yerine: satışta değil (gerçek para da jeton da gösterilmez). */
function NotForSale() {
  const t = useT(M);
  return <span className="chip tone-muted" aria-label={t("not_for_sale_aria")}>{t("not_for_sale")}</span>;
}

function SurfaceList({ item, cov }: { item: CosmeticItem; cov: ReturnType<typeof setCoverage> }) {
  const t = useT(M);
  const row = cov.items[`store:${item.id}`];
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t("surfaces")}>
      {item.surfaces.map((s) => {
        const ok = !!row?.surfaces[s]?.drawn && !!row?.surfaces[s]?.live;
        return (
          <li key={s} className={clsx("chip", ok ? "tone-ok" : "tone-bad")}>
            {ok ? <Check size={11} aria-hidden /> : <X size={11} aria-hidden />}
            {t(`surface_${s}` as "surface_avatar")}<span className="sr-only"> · {ok ? t("drawn_ok") : t("drawn_missing")}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Jeton teklifi (COS-A `coin_price` varsa): jeton fiyatı + "Jetonla al". Para fiyatı ayrı ve satışta değil; kur gösterilmez. */
function CoinOffer({ set, onBuy }: { set: CosmeticSet; onBuy: () => void }) {
  const t = useT(M);
  const store = useCosmetics((s) => s.store);
  const view = store?.sets.find((x) => x.id === set.id);
  const price = view?.coin_cost ?? view?.coin_price;
  if (!view || !price || price <= 0) return null;
  const open = store?.enabled === true && view.can_buy_coins === true;
  return (
    <>
      <span className="inline-flex items-center gap-1 text-xs text-ink-2"><span className="sr-only">{t("coin_price")}: </span><CoinAmount value={price} /></span>
      <Button size="sm" variant="gold" onClick={onBuy} disabled={!open} title={open ? undefined : t("buy_coins_off")}
        aria-label={t("buy_coins_aria", { name: t(setKey(set.id)) })}>
        {t("buy_coins")}
      </Button>
    </>
  );
}

/** İki adımlı jetonla alma onayı (sunucu `confirm: true` olmadan reddeder; yönetici/test modunda sunucu yazmaz). */
function CoinBuyDialog({ set, onClose }: { set: CosmeticSet; onClose: () => void }) {
  const t = useT(M);
  const view = useCosmetics((s) => s.store?.sets.find((x) => x.id === set.id));
  const price = view?.coin_cost ?? view?.coin_price ?? 0;
  const bal = useGame((s) => s.profile?.coins ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = t(setKey(set.id));
  const enough = bal >= price;
  const buy = async () => {
    setBusy(true);
    setError(null);
    try {
      await buyWithCoins(view?.store_id ?? `store:${set.id}`);
      await useGame.getState().refresh();
      onClose();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <GameDialog open onClose={onClose} title={t("buy_coins_q", { name })}
      footer={<>
        <Button onClick={onClose} data-autofocus>{t("cancel")}</Button>
        <Button variant="primary" onClick={buy} disabled={busy || !enough || price <= 0 || view?.can_buy_coins !== true}>
          {busy ? t("buying") : t("buy_coins")}
        </Button>
      </>}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">{t("buy_coins_note")}</p>
        <dl className="panel-soft p-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-2">{t("coin_price")}</dt><dd className="text-right"><CoinAmount value={price} /></dd>
          <dt className="text-ink-2">{t("your_balance")}</dt><dd className="text-right"><CoinAmount value={bal} /></dd>
          <dt className="text-ink-2">{t("after_buy")}</dt>
          <dd className={clsx("text-right", !enough && "text-bad")}><CoinAmount value={Math.max(0, bal - price)} /></dd>
        </dl>
        {!enough && <p className="text-sm text-ink-2" role="alert">{t("not_enough")}</p>}
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      </div>
    </GameDialog>
  );
}

function SetCard({ set, onTry, onBuy }: { set: CosmeticSet; onTry: () => void; onBuy: () => void }) {
  const t = useT(M);
  const slots = [...new Set(set.items.map((i) => i.slot))];
  const name = t(setKey(set.id));
  return (
    <li className="min-w-0">
      <article className="panel p-3 h-full flex flex-col gap-2.5" aria-label={name}>
        <div className="flex items-start gap-3 min-w-0">
          <span className="grid place-items-center rounded-lg border-2 border-line-soft shrink-0 size-11" style={{ background: set.tint }} aria-hidden>
            <Shirt size={20} className="text-white" />
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-semibold text-sm text-ink">{name}</h3>
            <p className="text-xs text-muted">{t(`bucket_${set.bucket}` as "bucket_small")} · {t("set_pieces", { n: set.items.length })}</p>
          </div>
        </div>
        <p className="text-xs text-ink-2 leading-4">{t(setDescKey(set.id))}</p>
        {set.seasonal && <p className="text-xs text-muted">{t(`seasonal_${set.seasonal}` as "seasonal_halloween")}</p>}
        <ul className="flex flex-wrap gap-1.5">
          {slots.map((s) => <li key={s} className="chip tone-info">{SLOT_ICON[s]}{t(`slot_${s}` as "slot_outfit")}</li>)}
        </ul>
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <NotForSale />
          <CoinOffer set={set} onBuy={onBuy} />
          <Button size="sm" variant="primary" className="ml-auto" icon={<Eye size={14} />} onClick={onTry} aria-label={t("try_on_aria", { name })}>
            {t("try_on")}
          </Button>
        </div>
      </article>
    </li>
  );
}

type Target = "me" | "sample" | `agent:${string}`;

/** Kaydedilmeyen 3D deneme: tüm durum bu bileşende; kapanınca kaybolur. */
function TryOnDialog({ set, onClose }: { set: CosmeticSet; onClose: () => void }) {
  const t = useT(M);
  const calm = useReducedMotion();
  const agents = useStudio((s) => s.agents);
  const me = useMeLook((s) => s.avatar);
  const [target, setTarget] = useState<Target>("me");
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(set.items.map((i) => [i.id, true])));
  const [celebrateAt, setCelebrateAt] = useState(0);
  const [calls, setCalls] = useState<number | null>(null);
  const cov = useMemo(() => setCoverage(set), [set]);
  const pick = <S extends Slot>(slot: S) => set.items.find((i) => i.slot === slot && on[i.id]) as Extract<CosmeticItem, { slot: S }> | undefined;
  const outfit = pick("outfit"), desk = pick("desk"), world = pick("world"), cel = pick("celebration");
  const base: Avatar = useMemo(() => (target === "me" ? me : target === "sample" ? SAMPLE
    : normalizeAvatar(agents.find((a) => `agent:${a.slug}` === target)?.avatar)), [target, me, agents]);
  const avatar = useMemo(() => applyWear(base, outfit), [base, outfit]);
  const name = t(setKey(set.id));
  const targetName = target === "me" ? t("me") : target === "sample" ? t("sample") : agents.find((a) => `agent:${a.slug}` === target)?.name ?? "";
  const signature = cosmeticItem(set.signature)?.item;
  // kutlama denemesi açılışta bir kez oynar (hareket azaltmada statik hâl)
  useEffect(() => { if (cel) setCelebrateAt(performance.now() + 400); }, [cel]);

  return (
    <GameDialog open onClose={onClose} width={720} title={t("tryon_title", { name })}
      footer={<><NotForSale /><Button onClick={onClose} data-autofocus>{t("close")}</Button></>}>
      <div className="flex flex-col gap-3 min-w-0">
        <TryOnStage avatar={avatar} badge={target === "me"} desk={desk} world={world} celebration={cel} celebrateAt={celebrateAt}
          height={260} label={t("canvas_label", { name, target: targetName })} onCalls={setCalls} />
        <p className="text-xs text-muted">{t("tryon_note")}{calls !== null && <> · <span className="num">{t("draw_calls", { n: calls })}</span></>}</p>
        <label className="flex flex-wrap items-center gap-2 text-sm text-ink-2 min-w-0">
          <span>{t("tryon_on")}</span>
          <select className="select !w-auto min-w-0 max-w-full" value={target} onChange={(e) => setTarget(e.target.value as Target)}>
            <option value="me">{t("me")}</option>
            {agents.map((a) => <option key={a.slug} value={`agent:${a.slug}`}>{a.name}</option>)}
            <option value="sample">{t("sample")}</option>
          </select>
        </label>
        <section aria-labelledby={`${set.id}-pieces`} className="flex flex-col gap-2">
          <h3 id={`${set.id}-pieces`} className="t-overline text-muted">{t("pieces_title")}</h3>
          <ul className="flex flex-col gap-2">
            {set.items.map((it) => (
              <li key={it.id} className="panel-soft p-2.5 flex flex-col gap-1.5 min-w-0">
                <label className="flex items-center gap-2 text-sm font-semibold text-ink min-w-0">
                  <input type="checkbox" checked={!!on[it.id]} aria-label={t("piece_toggle", { name: t(itemKey(it.id)) })}
                    onChange={(e) => setOn((o) => ({ ...o, [it.id]: e.target.checked }))} />
                  <span className="shrink-0 text-muted">{SLOT_ICON[it.slot]}</span>
                  <span className="min-w-0">{t(itemKey(it.id))}</span>
                </label>
                <SurfaceList item={it} cov={cov} />
              </li>
            ))}
          </ul>
        </section>
        {cel && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={<PartyPopper size={14} />} onClick={() => setCelebrateAt(performance.now())} disabled={!on[cel.id]}>
              {t("play_celebration")}
            </Button>
            {calm && <span className="text-xs text-muted">{t("calm_note")}</span>}
          </div>
        )}
        <p className="text-xs text-ink-2">{t("free_path", { piece: signature ? t(itemKey(signature.id)) : "—", n: set.free_after_months })}</p>
      </div>
    </GameDialog>
  );
}

/** Koleksiyon: sahip olunan parçalar, çizim durumu ve bu tarayıcıdaki "Kullan" seçimi (yalnız sahip olunan, giyilebilir). */
function Collection({ enabled }: { enabled: boolean }) {
  const t = useT(M);
  const owned = useCosmetics((s) => s.owned);
  const store = useCosmetics((s) => s.store);
  const pieces = useMemo(() => store?.sets.flatMap((x) => x.pieces) ?? [], [store]);
  const eq = useEquip();
  const agents = useStudio((s) => s.agents);
  const ownedIds = Object.keys(owned);
  if (!enabled) return <p className="text-sm text-muted">{t("collection_off")}</p>;
  if (!ownedIds.length) return <Empty title={t("collection_empty")} />;
  const isOn = (id: string, slot: Slot) => slot === "outfit" ? eq.me === id || Object.values(eq.agents).includes(id) : eq[slot as "desk"] === id;
  return (
    <ul className="grid gap-2 grid-cols-1 min-[560px]:grid-cols-2">
      {ownedIds.map((id) => {
        const hit = cosmeticItem(id);
        if (!hit) return null;
        const { item } = hit, wearable = owned[id];
        const srv = pieces.find((p) => bare(p.id) === id);
        const cov = setCoverage(hit.set);
        return (
          <li key={id} className="panel-soft p-2.5 flex flex-col gap-1.5 min-w-0">
            <p className="text-sm font-semibold text-ink flex items-center gap-1.5 min-w-0">
              <span className="text-muted shrink-0">{SLOT_ICON[item.slot]}</span><span className="min-w-0">{t(itemKey(id))}</span>
            </p>
            <SurfaceList item={item} cov={cov} />
            {srv?.temporarily_not_drawn && <p className="text-xs text-warn">{t("temporarily_not_drawn")}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {wearable ? <span className="chip tone-ok"><Check size={11} aria-hidden />{t("owned")}</span>
                : <span className="chip tone-muted">{t("unwearable")}</span>}
              {wearable && item.slot !== "outfit" && (isOn(id, item.slot)
                ? <Button size="sm" onClick={() => setEquip({ [item.slot]: undefined } as Partial<Equip>)}>{t("take_off")}</Button>
                : <Button size="sm" variant="primary" onClick={() => setEquip({ [item.slot]: id } as Partial<Equip>)}>{t("use")}</Button>)}
              {wearable && item.slot === "outfit" && (
                <label className="flex items-center gap-1.5 text-xs text-ink-2 min-w-0">
                  {t("wear_on")}
                  <select className="select !w-auto min-w-0 max-w-full text-xs" value={eq.me === id ? "me" : Object.entries(eq.agents).find(([, v]) => v === id)?.[0] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value, agentsNext = Object.fromEntries(Object.entries(eq.agents).filter(([, x]) => x !== id));
                      if (v && v !== "me") agentsNext[v] = id;
                      setEquip({ me: v === "me" ? id : eq.me === id ? undefined : eq.me, agents: agentsNext });
                    }}>
                    <option value="">—</option>
                    <option value="me">{t("me")}</option>
                    {agents.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** şehir sahnesinde ücretsiz yerel kostüm anahtarları (mağaza bayrağından bağımsız; satılmaz).*/
function LocalToggles() {
  const t = useT(M);
  const local = useEquip((s) => s.local !== false);
  const meLocal = useEquip((s) => s.meLocal === true);
  return (
    <fieldset className="panel-soft p-2.5 flex flex-col gap-1.5 min-w-0">
      <legend className="sr-only">{t("local_title")}</legend>
      <p className="text-sm font-semibold text-ink">{t("local_title")}</p>
      <p className="text-xs text-muted">{t("local_hint")}</p>
      <Toggle checked={local} onChange={(v) => setEquip({ local: v })} label={t("local_agents")} />
      <Toggle checked={meLocal} onChange={(v) => setEquip({ meLocal: v })} label={t("local_me")} />
    </fieldset>
  );
}

export function CosmeticStoreTab({ admin }: { admin?: boolean }) {
  const t = useT(M);
  const enabled = useCosmetics((s) => s.enabled);
  const [trying, setTrying] = useState<CosmeticSet | null>(null);
  const [buying, setBuying] = useState<CosmeticSet | null>(null);
  useEffect(() => { void ensureCosmetics(); }, []);
  // bayrak açıkken (yönetici/test modu değil) sahip olunan setleri envantere yansıt; yönetici modunda sunucu yalnız önizler
  useEffect(() => { if (enabled === true && !admin) void syncCosmetics(); }, [enabled, admin]);
  return (
    <div className="flex flex-col gap-4">
      <div className="panel-soft p-3 sm:p-4 flex flex-col gap-2">
        <p className="text-sm text-ink-2">{t("intro")}</p>
        {(admin || enabled !== true) && (
          <p className="text-xs text-muted flex flex-wrap items-center gap-2">
            <span className="chip tone-warn"><FlaskConical size={12} aria-hidden />{t("preview_mode")}</span>{t("preview_mode_hint")}
          </p>
        )}
      </div>
      {GROUPS.map((g) => (
        <section key={g.id} aria-labelledby={`cos-group-${g.id}`} className="flex flex-col gap-2">
          <h3 id={`cos-group-${g.id}`} className="font-display font-semibold text-ink flex flex-wrap items-baseline gap-x-2">
            {t(g.id === "costume" ? "group_costume" : "group_office")}{" "}
            <span className="text-xs font-normal text-muted">{t("group_count", { n: g.sets.length })}</span>
          </h3>
          {g.id === "costume" && <p className="text-xs text-muted">{t("group_costume_hint")}</p>}
          <ul className="grid gap-3 grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3">
            {g.sets.map((s) => <SetCard key={s.id} set={s} onTry={() => setTrying(s)} onBuy={() => setBuying(s)} />)}
          </ul>
        </section>
      ))}
      <section aria-labelledby="cos-collection" className="flex flex-col gap-2">
        <h3 id="cos-collection" className="font-display font-semibold text-ink">{t("collection")}</h3>
        <p className="text-xs text-muted">{t("collection_hint")}</p>
        <LocalToggles />
        <Collection enabled={enabled === true} />
      </section>
      {trying && <TryOnDialog set={trying} onClose={() => setTrying(null)} />}
      {buying && enabled === true && <CoinBuyDialog set={buying} onClose={() => setBuying(null)} />}
    </div>
  );
}

export default CosmeticStoreTab;
