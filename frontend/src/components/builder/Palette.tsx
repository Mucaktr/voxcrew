/**
 * Dünya yapıcı — malzeme ve eşya paleti: kategoriye göre gruplu, aramalı. Öğe seçmek "Yerleştir / boya" aracını açar.
 * Klavye: 1–9 kategoriye atlar (sayfa kısayolu), öğeler düğmedir (aria-pressed).
 * CITY-PACKS: "Şehir paketleri" kategorisi; sahip olunmayan paketin öğesi seçilemez (nedeni aria-label'da), var olan
 * yerleştirme her zaman çizilir.
 */
import clsx from "clsx";
import { Lock, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ensureCityPacks, packOwned, useCityPacks } from "../../lib/citypacks";
import { useLocale, useT } from "../../lib/i18n";
import { PALETTE, PALETTE_CATS, useEditor, type PaletteCat, type PaletteItem } from "../../lib/builder";
import { builder as M } from "../../locales/builder";
import { spotlight as S } from "../../locales/game";
import { useDecorLocks } from "../../lib/game";
import { cityPacksMsg as CP } from "../../locales/citypacks";
import { nameOf, PACK_BY_ID } from "../../voxel/citypacks/catalog";
import { CITY_PALETTE_BY_ID } from "../../voxel/citypacks/palette";

function Chip({ item }: { item: PaletteItem }) {
  const kind = item.kind;
  if (kind === "station" || kind === "light") return <span aria-hidden className="h-4 w-4 shrink-0 rounded-full border-2 border-line" style={{ background: item.color }} />;
  if (kind === "spot") return <span aria-hidden className="h-3.5 w-3.5 shrink-0 rotate-45 border-2 border-line" style={{ background: item.color }} />;
  if (kind === "void") return <span aria-hidden className="h-4 w-4 shrink-0 rounded-[3px] border-2 border-dashed border-line-soft bg-panel-3" />;
  return <span aria-hidden className={clsx("h-4 w-4 shrink-0 border-2 border-line", kind === "floor" || kind === "water" || kind === "pond" ? "rounded-[3px]" : "rounded-md")}
    style={{ background: item.color }} />;
}

export function Palette({ cat, onCat }: { cat: PaletteCat; onCat: (c: PaletteCat) => void }) {
  const t = useT(M);
  const ts = useT(S);
  const tc = useT(CP);
  const lang = useLocale((s) => s.locale);
  const cityStore = useCityPacks((s) => s.store);
  useEffect(() => { void ensureCityPacks(); }, []);
  const label = (p: PaletteItem) => {
    const e = p.pack ? CITY_PALETTE_BY_ID.get(p.id) : undefined;
    return e ? nameOf(e.item, lang) : t(`item_${p.id}` as never);
  };
  const catLabel = (c: PaletteCat) => (c === "citypack" ? tc("tab") : t(`cat_${c}` as never));
  const packName = (p: PaletteItem) => { const pk = p.pack ? PACK_BY_ID.get(p.pack) : undefined; return pk ? nameOf(pk, lang) : ""; };
  const locks = useDecorLocks(); // S35: ofis seviyesiyle açılan dekor (oyun kapalı / yaratıcı modda hepsi açık)
  const item = useEditor((s) => s.item);
  const tool = useEditor((s) => s.tool);
  const setE = useEditor((s) => s.set);
  const [q, setQ] = useState("");
  const needle = q.trim().toLocaleLowerCase();
  const shown = useMemo(() => (needle
    ? PALETTE.filter((p) => `${label(p)} ${catLabel(p.cat)} ${p.id}`.toLocaleLowerCase().includes(needle))
    : PALETTE.filter((p) => p.cat === cat)), [needle, cat, t, tc, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="flex flex-col gap-2 min-w-0" aria-label={t("palette")}>
      <label className="relative block">
        <span className="sr-only">{t("search")}</span>
        <Search size={15} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input className="input !pl-8 w-full" type="search" value={q} placeholder={t("search_placeholder")} onChange={(e) => setQ(e.target.value)} />
      </label>
      {!needle && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("palette")}>
          {PALETTE_CATS.map((c, n) => (
            <button key={c} type="button" aria-pressed={c === cat} onClick={() => onCat(c)} title={`${n + 1}`}
              className="card-select px-2 py-1 text-xs font-semibold">{catLabel(c)}</button>
          ))}
        </div>
      )}
      <ul className="grid grid-cols-2 lg:grid-cols-1 gap-1">
        {shown.map((p) => {
          const lock = locks[p.id];
          const packLock = !!p.pack && !packOwned(cityStore, p.pack);
          return (
            <li key={p.id} className="min-w-0">
              <button type="button" aria-pressed={tool === "draw" && item === p.id} aria-disabled={lock || packLock ? true : undefined}
                onClick={() => { if (!lock && !packLock) setE({ item: p.id, tool: "draw", selected: null }); }}
                title={lock ? ts("prop_locked_title", { n: lock.unlock_level }) : packLock ? tc("palette_locked_title", { pack: packName(p) }) : undefined}
                aria-label={lock ? ts("prop_locked_aria", { name: label(p), n: lock.unlock_level })
                  : packLock ? tc("palette_locked_aria", { name: label(p), pack: packName(p) }) : undefined}
                className={clsx("card-select w-full px-2 py-1.5 min-h-[2.25rem] flex items-center gap-2 text-left text-sm font-medium", (lock || packLock) && "cursor-not-allowed")}>
                <Chip item={p} />
                <span className="min-w-0 truncate">{label(p)}</span>
                {lock && <span className="ml-auto chip tone-muted !px-1.5 shrink-0"><Lock size={11} aria-hidden />{ts("prop_locked", { n: lock.unlock_level })}</span>}
                {!lock && packLock && <span className="ml-auto chip tone-muted !px-1.5 shrink-0"><Lock size={11} aria-hidden />{tc("palette_locked")}</span>}
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="text-sm text-muted px-1 py-2">{t("search_none")}</li>}
      </ul>
    </section>
  );
}
