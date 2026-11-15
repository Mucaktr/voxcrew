// CITY-PACKS — "Şehir paketleri" mağaza sekmesi. Bayrak `store.cosmetics_enabled` arkasında; yönetici/test modunda önizleme.
// Parayla satış YOK (para fiyatı "satışta değil"; öneri fiyat yalnız yönetici/test modunda bilgi olarak). Aynı paket kazanılmış
// jetonla alınabilir (oyunun onaylı alım akışı). Kur/dönüşüm, geri sayım, "yeni!" rozeti ya da sıralama yoktur.
// 3D önizleme kaydedilmez; "Şehirde göster" tercihi yalnız bu tarayıcıdadır.
import clsx from "clsx";
import { Building2, Eye, FlaskConical, Lamp, Moon, Sparkles, Sun, Trees } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  buyCityPack, ensureCityPacks, packOwned, setShowInCity, showsInCity, useCityPackPrefs, useCityPacks, type CityPackView,
} from "../../lib/citypacks";
import { useGame } from "../../lib/game";
import { useLocale, useT } from "../../lib/i18n";
import { cityPacksMsg as M } from "../../locales/citypacks";
import { PACK_BY_ID, nameOf, type CityPack } from "../../voxel/citypacks/catalog";
import { packCities } from "../../voxel/citypacks/cityOverlay";
import { useReducedMotion } from "../../voxel/motion";
import { Button, Checkbox, Empty, Segmented, Spinner } from "../ui";
import { CoinAmount, GameDialog } from "./parts";

const PackStage = lazy(() => import("../../voxel/citypacks/PackStage"));

const KIND_ICON: Record<string, ReactNode> = {
  landmark: <Building2 size={20} aria-hidden />, furniture: <Lamp size={20} aria-hidden />,
  material: <Sparkles size={20} aria-hidden />, decor: <Trees size={20} aria-hidden />,
};
const KIND_TINT: Record<string, string> = { landmark: "#6B4E9B", furniture: "#2F6B4F", material: "#1F5F8B", decor: "#8A4B2A" };

function NotForSale() {
  const t = useT(M);
  return <span className="chip tone-muted" aria-label={t("not_for_sale_aria")}>{t("not_for_sale")}</span>;
}

function AdminFacts({ view }: { view: CityPackView }) {
  const t = useT(M);
  const plan = (k: string) => t(`plan_${view.plans_proposal[k] ?? "buy"}` as "plan_buy");
  return (
    <div className="panel-soft p-2 flex flex-col gap-1 text-xs text-ink-2">
      {view.price_proposal && <p>{t("admin_proposal", { p: view.price_proposal.usd.toFixed(2) })}</p>}
      <p>{t("admin_risk", { ip: view.ip_risk, c: view.culture_risk })}{view.legal_review_before_sale ? ` · ${t("admin_review")}` : ""}</p>
      <p>{t("admin_plans", { plus: plan("plus"), pro: plan("pro") })}</p>
    </div>
  );
}

function CityToggle({ view, admin }: { view: CityPackView; admin: boolean }) {
  const t = useT(M);
  const store = useCityPacks((s) => s.store);
  const prefs = useCityPackPrefs();
  if (!view.surfaces.includes("city")) return null;
  const owned = packOwned(store, view.id);
  if (!owned && !admin) return null;
  return (
    <Checkbox checked={showsInCity(store, prefs, view.id)} onChange={(v) => setShowInCity(view.id, v)}
      label={owned ? t("show_in_city") : t("preview_in_city")} hint={t("city_next")} labelClassName="text-xs font-semibold"
      className="!items-start flex-wrap" />
  );
}

function PackCard({ pack, view, admin, onPreview, onBuy }:
  { pack: CityPack; view: CityPackView | undefined; admin: boolean; onPreview: () => void; onBuy: () => void }) {
  const t = useT(M);
  const lang = useLocale((s) => s.locale);
  const name = nameOf(pack, lang);
  const cities = packCities(pack.id);
  const esinli = pack.list.some((i) => i.esinli);
  return (
    <li className="min-w-0">
      <article className="panel p-3 h-full flex flex-col gap-2.5" aria-label={name}>
        <div className="flex items-start gap-3 min-w-0">
          <span className="grid place-items-center rounded-lg border-2 border-line-soft shrink-0 size-11 text-white" style={{ background: KIND_TINT[pack.kind] }} aria-hidden>
            {KIND_ICON[pack.kind]}
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-semibold text-sm text-ink">{name}</h3>
            <p className="text-xs text-muted">{t(`kind_${pack.kind}` as "kind_landmark")} · {t("items_n", { n: pack.list.length })}</p>
          </div>
        </div>
        {view?.description && <p className="text-xs text-ink-2 leading-4">{view.description}</p>}
        <ul className="flex flex-wrap gap-1.5" aria-label={t("items_title")}>
          {pack.list.map((it) => (
            <li key={it.key} className={clsx("chip", view?.items.find((x) => x.id === it.id)?.owned ? "tone-ok" : "tone-info")}>{nameOf(it, lang)}</li>
          ))}
        </ul>
        <p className="text-xs text-muted">
          {pack.surfaces.includes("city") && cities.length ? t("where_city") : t("where_builder")}
          {view?.seasonal ? ` · ${t("seasonal")}` : ""}
        </p>
        {esinli && <p className="text-xs text-ink-2"><span className="chip tone-warn mr-1.5">{t("esinli")}</span>{t("esinli_hint")}</p>}
        {admin && view && <AdminFacts view={view} />}
        <CityToggle view={view ?? ({ id: pack.id, surfaces: pack.surfaces } as CityPackView)} admin={admin} />
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {view?.owned ? <span className="chip tone-ok">{t("owned")}</span> : (
            <>
              <NotForSale />
              {view && view.owned_count > 0 && <span className="text-xs text-muted">{t("owned_partial", { n: view.owned_count, m: view.items.length })}</span>}
              {view && view.coin_price > 0 && (
                <>
                  <span className="inline-flex items-center gap-1 text-xs text-ink-2"><span className="sr-only">{t("coin_price")}: </span><CoinAmount value={view.coin_cost || view.coin_price} /></span>
                  <Button size="sm" variant="gold" onClick={onBuy} disabled={!view.can_buy_coins} title={view.can_buy_coins ? undefined : t("buy_coins_off")}
                    aria-label={t("buy_coins_aria", { name })}>{t("buy_coins")}</Button>
                </>
              )}
            </>
          )}
          <Button size="sm" variant="primary" className="ml-auto" icon={<Eye size={14} />} onClick={onPreview} aria-label={t("preview_aria", { name })}>
            {t("preview")}
          </Button>
        </div>
      </article>
    </li>
  );
}

function PreviewDialog({ pack, onClose }: { pack: CityPack; onClose: () => void }) {
  const t = useT(M);
  const lang = useLocale((s) => s.locale);
  const calm = useReducedMotion();
  const [pick, setPick] = useState<string>("all");
  const [night, setNight] = useState(false);
  const items = useMemo(() => (pick === "all" ? pack.list : pack.list.filter((i) => i.key === pick)), [pack, pick]);
  const name = nameOf(pack, lang);
  const live = pack.list.some((i) => i.boxes().some((b) => !["solid", "glass", "glow", "water"].includes(b[7])));
  return (
    <GameDialog open onClose={onClose} width={720} title={t("preview_title", { name })}
      footer={<><NotForSale /><Button onClick={onClose} data-autofocus>{t("close")}</Button></>}>
      <div className="flex flex-col gap-3 min-w-0">
        <Suspense fallback={<div className="grid place-items-center h-[260px]"><Spinner size={24} /></div>}>
          <PackStage items={items} night={night} height={260}
            label={t("canvas_label", { name, items: items.map((i) => nameOf(i, lang)).join(", ") })} />
        </Suspense>
        <p className="text-xs text-muted">{t("preview_note")}{live && calm ? ` ${t("calm_note")}` : ""}</p>
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <label className="flex flex-wrap items-center gap-2 text-sm text-ink-2 min-w-0">
            <span>{t("item_pick")}</span>
            <select className="select !w-auto min-w-0 max-w-full" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="all">{t("all_items")}</option>
              {pack.list.map((i) => <option key={i.key} value={i.key}>{nameOf(i, lang)}</option>)}
            </select>
          </label>
          <div role="group" aria-label={t("light_label")}>
            <Segmented<"day" | "night"> value={night ? "night" : "day"} onChange={(v) => setNight(v === "night")}
              options={[{ value: "day", label: t("day") }, { value: "night", label: t("night") }]} />
          </div>
          <span aria-hidden className="text-muted">{night ? <Moon size={14} /> : <Sun size={14} />}</span>
        </div>
        <ul className="grid gap-1.5 grid-cols-1 min-[480px]:grid-cols-2" aria-label={t("items_title")}>
          {pack.list.map((i) => (
            <li key={i.key} className="panel-soft px-2.5 py-1.5 text-xs text-ink-2 flex flex-wrap items-center gap-x-2 min-w-0">
              <span className="font-semibold text-ink">{nameOf(i, lang)}</span>
              <span className="text-muted num">{t("footprint", { w: i.w, d: i.d })}</span>
              {i.esinli && <span className="chip tone-warn">{t("esinli")}</span>}
            </li>
          ))}
        </ul>
      </div>
    </GameDialog>
  );
}

function BuyDialog({ pack, view, onClose }: { pack: CityPack; view: CityPackView; onClose: () => void }) {
  const t = useT(M);
  const lang = useLocale((s) => s.locale);
  const bal = useGame((s) => s.profile?.coins ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const price = view.coin_cost || view.coin_price;
  const name = nameOf(pack, lang);
  const enough = bal >= price;
  const buy = async () => {
    setBusy(true); setError(null);
    try {
      await buyCityPack(view.store_id);
      await useGame.getState().refresh();
      onClose();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally { setBusy(false); }
  };
  return (
    <GameDialog open onClose={onClose} title={t("buy_coins_q", { name })}
      footer={<>
        <Button onClick={onClose} data-autofocus>{t("cancel")}</Button>
        <Button variant="primary" onClick={buy} disabled={busy || !enough || !view.can_buy_coins}>{busy ? t("buying") : t("buy_coins")}</Button>
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

export function CityPackStoreTab({ admin }: { admin?: boolean }) {
  const t = useT(M);
  const store = useCityPacks((s) => s.store);
  const error = useCityPacks((s) => s.error);
  const [preview, setPreview] = useState<CityPack | null>(null);
  const [buying, setBuying] = useState<CityPack | null>(null);
  useEffect(() => { void ensureCityPacks(true); }, []);
  const isAdmin = !!(admin || store?.admin);
  const viewOf = (id: string) => store?.packs.find((p) => p.id === id);
  if (!store && !error) return <div className="grid place-items-center py-16"><Spinner size={24} /></div>;
  return (
    <div className="flex flex-col gap-4">
      <div className="panel-soft p-3 sm:p-4 flex flex-col gap-2">
        <p className="text-sm text-ink-2">{t("intro")}</p>
        {(isAdmin || store?.enabled !== true) && (
          <p className="text-xs text-muted flex flex-wrap items-center gap-2">
            <span className="chip tone-warn"><FlaskConical size={12} aria-hidden />{t("preview_mode")}</span>{t("preview_mode_hint")}
          </p>
        )}
        {error && <p className="text-sm text-bad" role="alert">{t("error")}</p>}
      </div>
      {store ? (
        <ul className="grid gap-3 grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3">
          {[...PACK_BY_ID.values()].map((p) => (
            <PackCard key={p.id} pack={p} view={viewOf(p.id)} admin={isAdmin} onPreview={() => setPreview(p)} onBuy={() => setBuying(p)} />
          ))}
        </ul>
      ) : <Empty title={t("error")} />}
      {preview && <PreviewDialog pack={preview} onClose={() => setPreview(null)} />}
      {buying && viewOf(buying.id) && store?.enabled === true && (
        <BuyDialog pack={buying} view={viewOf(buying.id)!} onClose={() => setBuying(null)} />
      )}
    </div>
  );
}

export default CityPackStoreTab;
