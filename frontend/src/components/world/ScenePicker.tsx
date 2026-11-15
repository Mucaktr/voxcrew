/**
 * Sahne seçici: tetik düğmesi + açılır ızgara. SP-W0: sahneler katman/pakete göre gruplanır (Çekirdek · Şehirler (paket
 * başına) · Premium; `SceneDef.tier`/`pack`). Kilitli sahneler (oyunlaştırma açık ve `isUnlocked("scene:<id>")` yanlışsa)
 * kilit simgesiyle görünür, seçilemez; tıklanınca kazanım yolu (seviye, jeton, pasaport damgası, başarım), "Önizle (20 sn)"
 * ve "Başarılar → Mağaza" bağlantısı çıkar. (SP-QA-03): not, tıklanan kartın satırının hemen altında açılır, görünür
 * alana kaydırılır (hareket azaltmada animasyonsuz) ve odak ona taşınır; kart `aria-expanded`/`aria-controls` ile bağlıdır.
 * Kazanım metni (jeton fiyatı, başarım adı, damga başına akış) mağaza kataloğundan (`GET /api/game/shop`) gelir. Önizleme sahne ayarını değiştirmez (scenePreview.ts). Yönetici/test modunda
 * (`locksOff`) her şey açıktır; şehir/premium kartlarında IP/kültür riski rozeti yalnız bu modda görünür.
 * Kök öğe dünya alanını kaplar (pointer-events yok) ki açılır panel 375 px'te ve kısa ekranda da sığsın.
*/
import clsx from "clsx";
import { ChevronDown, Eye, Hammer, Lock, Store, X } from "lucide-react";
import { FullEditionCard } from "./FullEditionCard";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ensureWorld, useWorlds } from "../../lib/builder";
import { gameApi, isUnlocked, prefersReducedMotion, useGame, useGameEnabled, useGameLocks, type LockedItem, type ShopData } from "../../lib/game";
import { useT } from "../../lib/i18n";
import { builder as BM } from "../../locales/builder";
import { world as M } from "../../locales/world";
import { sceneDef, sceneItemId, SCENE_ORDER, SCENES, type SceneTier, type WorldSceneId } from "../../voxel/scenes";
import { PREVIEW_MS, useScenePreview } from "./scenePreview";

function Swatch({ id, big }: { id: WorldSceneId; big?: boolean }) {
  const [ground, sky] = sceneDef(id).swatch; // kullanıcı dünyası (w_…) da olabilir
  return (
    <span aria-hidden="true" className={clsx("grid grid-rows-2 shrink-0 overflow-hidden border-2 border-line",
      big ? "h-8 w-8 rounded-md" : "h-4 w-4 rounded-[3px]")}>
      <span style={{ background: sky }} />
      <span style={{ background: ground }} />
    </span>
  );
}

const TIERS: SceneTier[] = ["core", "city", "premium"];
/** Arka uç kilit kaydı + SP-W0 alanları (game/service.py `_scene_fields`). */
type SceneLock = LockedItem & { tier?: SceneTier; pack?: string | null; earn?: "level" | "achievement" | "stamp" | "free" };

/** Mağaza kataloğu: kilit notu fiyatı, başarım adını ve damga başına akışı buradan okur, mağazayla aynı kalır.*/
type Catalog = ShopData & { passport?: { per_stamp?: number } };

/** Izgaranın sütun sayısı (`grid-cols-2 sm:grid-cols-3`): kilit notu tıklanan kartın satırının sonuna eklenir. */
const SM_QUERY = "(min-width: 640px)";
function useGridCols(): number {
  const [cols, setCols] = useState(() => (typeof window !== "undefined" && window.matchMedia?.(SM_QUERY).matches ? 3 : 2));
  useEffect(() => {
    const mq = window.matchMedia?.(SM_QUERY);
    if (!mq) return;
    const on = () => setCols(mq.matches ? 3 : 2);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return cols;
}

interface Group { key: string; tier: SceneTier; pack: string | null; ids: WorldSceneId[] }
function groupScenes(): Group[] {
  const out: Group[] = [];
  for (const tier of TIERS) for (const id of SCENE_ORDER) {
    const d = SCENES[id];
    if ((d.tier ?? "core") !== tier) continue;
    const pack = tier === "city" ? d.pack ?? null : null;
    const key = `${tier}:${pack ?? ""}`;
    (out.find((g) => g.key === key) ?? out[out.push({ key, tier, pack, ids: [] }) - 1]).ids.push(id);
  }
  return out;
}

/** Önizleme şeridi: kalan süre, kapat. Seçici kapalıyken de görünür (kök öğe hep takılı). */
function PreviewBanner() {
  const t = useT(M);
  const id = useScenePreview((s) => s.id);
  const until = useScenePreview((s) => s.until);
  const stop = useScenePreview((s) => s.stop);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!id) return;
    setNow(Date.now());
    const h = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(h);
  }, [id]);
  if (!id) return null;
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <div role="status" className="pointer-events-auto mt-2 inline-flex max-w-full items-center gap-2 rounded-lg border-2 border-line bg-panel px-2.5 py-1.5 shadow">
      <Eye size={14} className="shrink-0 text-ink-2" aria-hidden="true" />
      <span className="text-sm text-ink truncate">{t("preview_banner", { name: sceneDef(id).label, n: Math.min(left, PREVIEW_MS / 1000) })}</span>
      <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={t("preview_close")} onClick={stop}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ScenePicker({ value, onPick, className }: { value: WorldSceneId; onPick: (id: WorldSceneId) => void; className?: string }) {
  const t = useT(M);
  const tb = useT(BM);
  const [open, setOpen] = useState(false);
  // Faz 7a (S30): "Dünyalarım" — kullanıcı dünyaları her zaman açıktır (mağaza/kilit dışı)
  const myWorlds = useWorlds((s) => s.list);
  const refreshWorlds = useWorlds((s) => s.refresh);
  useEffect(() => { if (open) refreshWorlds(); }, [open, refreshWorlds]);
  const [note, setNote] = useState<WorldSceneId | null>(null);
  const gameOn = useGameEnabled();
  const admin = useGame((s) => s.profile?.admin === true);
  const locks = useGameLocks(); // kilit tablosu değişince (satın alma, seviye) yeniden çiz
  const startPreview = useScenePreview((s) => s.start);
  const stopPreview = useScenePreview((s) => s.stop);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const noteId = useId();
  const noteTitleId = useId();
  const noteRef = useRef<HTMLDivElement>(null);
  const cols = useGridCols();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const groups = groupScenes(); // 13–30 sahne: her çizimde ucuz
  const locked = (id: WorldSceneId) => gameOn && !isUnlocked(sceneItemId(id));

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!root.current?.querySelector("[data-picker]")?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", esc); };
  }, [open]);
  useEffect(() => {
    if (open) root.current?.querySelector<HTMLElement>('[data-scene][aria-pressed="true"]')?.focus();
    else setNote(null);
  }, [open]);
  // kilit notu açılınca odağı ona taşı (klavye/ekran okuyucu)...
  useEffect(() => { if (note) noteRef.current?.focus({ preventScroll: true }); }, [note]);
  // ... ve görünür alana kaydır (hareket azaltmada anında); katalog gelip metin uzarsa yeniden
  useEffect(() => {
    if (note) noteRef.current?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [note, catalog]);
  // kazanım metni için mağaza kataloğu (seçici açılınca, oyun açıksa; satın alma/seviye değişince yenilenir)
  useEffect(() => {
    if (!open || !gameOn) return;
    let live = true;
    gameApi.shop().then((d) => { if (live) setCatalog(d as Catalog); }).catch(() => undefined);
    return () => { live = false; };
  }, [open, gameOn, locks]);
  // sahne gerçekten değişirse önizleme biter
  useEffect(() => { stopPreview(); }, [value, stopPreview]);

  const current = sceneDef(value);
  const lockInfo = (note ? locks[sceneItemId(note)] : undefined) as SceneLock | undefined;
  const noteDef = note ? SCENES[note] : null;
  const earn = lockInfo?.earn ?? (noteDef?.tier === "city" ? "stamp" : undefined);
  const shopItem = note ? catalog?.items.find((it) => it.id === sceneItemId(note)) : undefined;
  const price = shopItem?.price ?? lockInfo?.price ?? 0;
  const freeLevel = shopItem?.unlock_level ?? lockInfo?.unlock_level ?? 0;
  const achName = shopItem?.achievement_name ?? null;
  const hasAch = !!(shopItem?.achievement ?? lockInfo?.achievement);
  const perStamp = catalog?.passport?.per_stamp;
  const closeNote = (id: WorldSceneId) => {
    setNote(null);
    root.current?.querySelector<HTMLElement>(`[data-scene="${id}"]`)?.focus();
  };
  /** Kilit notunun kazanım cümlesi: şehir = damga ya da jeton; diğerleri = jeton, ayrıca ücretsiz yollar (seviye, başarım). */
  const unlockText = (): string => {
    if (earn === "stamp") {
      const head = price ? t("picker_unlock_stamp_coins", { n: price }) : t("picker_unlock_stamp");
      return head + (perStamp ? t("picker_stamp_how", { n: perStamp }) : t("picker_stamp_how_any"));
    }
    const head = price ? t("picker_unlock_coins", { n: price }) : t("picker_unlock_shop");
    const free = [
      freeLevel ? t("picker_free_level", { n: freeLevel }) : "",
      hasAch ? (achName ? t("picker_free_ach", { name: achName }) : t("picker_free_ach_any")) : "",
    ].filter(Boolean);
    return free.length ? head + t("picker_free", { paths: free.join(t("picker_free_or")) }) : head;
  };
  const renderNote = () => note && noteDef && (
    <div id={noteId} ref={noteRef} tabIndex={-1} role="region" aria-labelledby={noteTitleId}
      className="col-span-full flex flex-wrap items-center gap-2 rounded-lg border-2 border-line bg-panel-2 p-2.5 scroll-mt-2 scroll-mb-20 lg:scroll-mb-2">
      <Lock size={16} className="shrink-0 text-ink-2" aria-hidden="true" />
      <p className="flex-1 min-w-[11rem] text-sm text-ink-2">
        <strong id={noteTitleId} className="font-semibold text-ink">{t("picker_locked_title", { name: noteDef.label })}</strong>.{" "}
        {unlockText()}.
      </p>
      <button type="button" className="btn btn-sm" aria-label={t("picker_preview_aria", { name: noteDef.label })}
        onClick={() => { startPreview(note); setOpen(false); trigger.current?.focus(); }}>
        <Eye size={14} aria-hidden="true" />{t("picker_preview")}
      </button>
      <Link to="/basarilar/magaza" className="btn btn-sm btn-gold" onClick={() => setOpen(false)}>
        <Store size={14} aria-hidden="true" />{t("picker_shop_link")}
      </Link>
      <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={t("picker_close_note")} onClick={() => closeNote(note)}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
  const groupTitle = (g: Group) => (g.tier === "city" && g.pack ? `${t("tier_city")} · ${t(`pack_${g.pack}` as "tier_city")}` : t(`tier_${g.tier}` as "tier_core"));
  return (
    <div ref={root} className={clsx("pointer-events-none", className)}>
      <div data-picker className="relative h-full flex flex-col items-start">
        <button ref={trigger} type="button" className="btn btn-sm !gap-1.5 pointer-events-auto max-w-[calc(100%-3rem)]"
          aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
          <Swatch id={current.id} />
          <span className="truncate"><span className="hidden sm:inline font-medium text-muted">{t("picker_scene")}</span>{current.label}</span>
          <ChevronDown size={14} aria-hidden="true" className={clsx("transition-transform", open && "rotate-180")} />
        </button>
        {!open && <PreviewBanner />}
        {open && (
          <div id={panelId} role="group" aria-label={t("picker_pick")} data-popover=""
            className="panel anim-rise pointer-events-auto mt-2 p-2 w-[min(34rem,100%)] max-h-[calc(100%-2.75rem)] overflow-y-auto">
            {groups.map((g, gi) => (
              <section key={g.key} aria-label={groupTitle(g)} className={clsx(gi > 0 && "mt-2")}>
                {groups.length > 1 && <h3 className="t-overline text-muted mb-1">{groupTitle(g)}</h3>}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {g.ids.map((id, k) => {
                    const d = SCENES[id];
                    const lock = locked(id);
                    const risky = admin && (d.tier ?? "core") !== "core";
                    // not, tıklanan kartın satırının son kartından hemen sonra tam genişlikte açılır
                    const at = note ? g.ids.indexOf(note) : -1;
                    const noteHere = at >= 0 && k === Math.min(g.ids.length - 1, Math.floor(at / cols) * cols + cols - 1);
                    return (
                      <Fragment key={id}>
                      <button type="button" data-scene={id} aria-pressed={value === id} aria-disabled={lock || undefined}
                        aria-expanded={lock ? note === id : undefined} aria-controls={lock && note === id ? noteId : undefined}
                        title={lock ? t("picker_locked_title", { name: d.label }) : d.hint}
                        className={clsx("card-select p-2 flex items-center gap-2 min-w-0", lock && "border-dashed")}
                        onClick={() => {
                          if (lock) { if (note === id) closeNote(id); else setNote(id); return; }
                          onPick(id);
                          setOpen(false);
                          trigger.current?.focus();
                        }}>
                        <span className={clsx(lock && "opacity-60")}><Swatch id={id} big /></span>
                        <span className="min-w-0 flex-1">
                          <span className={clsx("block text-sm font-semibold leading-5 break-words", lock && "text-ink-2")}>{d.label}</span>
                          <span className="block text-xs text-muted truncate">{lock ? t("picker_locked") : d.hint}</span>
                          {risky && (
                            // SKY-FIX: etiket kartın içinde kalır (eski uzun metin nowrap ile kutudan taşıyordu)
                            <span className="chip tone-muted mt-0.5 max-w-full" title={t("picker_risk_title")}>
                              <span className="truncate">{t("picker_risk", { ip: d.ip_risk ?? "?", culture: d.culture_risk ?? "?" })}</span>
                            </span>
                          )}
                        </span>
                        {lock && <Lock size={14} className="shrink-0 text-muted" aria-hidden="true" />}
                        {lock && <span className="sr-only">{t("picker_locked_sr")}</span>}
                      </button>
                      {noteHere && renderNote()}
                      </Fragment>
                    );
                  })}
                </div>
              </section>
            ))}
            {/* EDITION1: free sürümde kaldırılan şehirler yerine tek kilitli kart (tam sürümde çizilmez) */}
            <FullEditionCard className="mt-2" />
            <div className="mt-2 flex items-center gap-2">
              <span className="t-overline text-muted flex-1">{tb("mine")}</span>
              <Link to="/dunya-yapici" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}><Hammer size={14} aria-hidden="true" />{tb("title")}</Link>
            </div>
            {myWorlds.length > 0 && (
              <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {myWorlds.map((w) => (
                  <button key={w.id} type="button" data-scene={w.id} aria-pressed={value === w.id} title={w.description || w.name}
                    className="card-select p-2 flex items-center gap-2 min-w-0"
                    onClick={() => {
                      ensureWorld(w.id).then(() => onPick(w.id as WorldSceneId));
                      setOpen(false);
                      trigger.current?.focus();
                    }}>
                    <span aria-hidden="true" className="grid grid-rows-2 shrink-0 overflow-hidden border-2 border-line h-8 w-8 rounded-md">
                      <span style={{ background: w.swatch?.[1] ?? "#CBD5E1" }} /><span style={{ background: w.swatch?.[0] ?? "#9CA3AF" }} />
                    </span>
                    <span className="min-w-0 flex-1 block text-sm font-semibold leading-5 break-words">{w.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
