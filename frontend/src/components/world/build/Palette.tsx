/**
 * E3 (BUILD-UX) — yapı paleti ( "Erişilebilirlik", X12, X13).
 *
 * Tek satır, yatay kaydırmalı (375 px'te sayfa taşmaz): bloklar sahne zemin rengine göre sıralı, ardından parselde izinli eşyalar.
 * İlk 9 öğe 1–9 kısayoluyla seçilir (rozet). Kilitli dekor (S35 `useDecorLocks`: ışıklı blok, fener) seçilemez ve nedeni
 * `aria-label`'da yazar. Düğmeler ≥ 44 px, seçili öğe `aria-pressed`; renk yalnız işaret değildir (ad `title` ve ekran okuyucuda).
*/
import clsx from "clsx";
import { useEffect } from "react";
import { Lock } from "lucide-react";
import { itemName } from "../../../lib/build";
import { useDecorLocks } from "../../../lib/game";
import { useT } from "../../../lib/i18n";
import { PALETTE_BY_ID } from "../../../lib/builder";
import { build as BM } from "../../../locales/build";
import { usePlan } from "../../../lib/plan";
import { BLOCK_BY_ID, PACK_BUILDER, paletteOrder } from "../../../voxel/build/catalog";
import { useBuildStore } from "../../../voxel/build/store";

export function BuildPalette({ swatch, onPicked }: { swatch: string | null; onPicked?: () => void }) {
  const t = useT(BM);
  const locks = useDecorLocks();
  const item = useBuildStore((s) => s.item);
  // 2026-10-19 yapı malzemeleri paketi: paket etkinse 8 ek renk paletin sonunda (sunucu yine denetler)
  const withPack = usePlan((s) => !!s.snapshot?.features.packs?.includes(PACK_BUILDER)
    && s.snapshot.source !== "test" && s.snapshot.source !== "admin");
  useEffect(() => { if (!usePlan.getState().snapshot) void usePlan.getState().refresh(); }, []);
  const order = paletteOrder(swatch, withPack);
  return (
    <div role="group" aria-label={t("palette")} className="flex gap-1 overflow-x-auto overscroll-x-contain pb-1 min-w-0 [scrollbar-width:thin]">
      {order.map((id, n) => {
        const lock = locks[id];
        const block = BLOCK_BY_ID.get(id);
        const color = block?.color ?? PALETTE_BY_ID.get(id)?.color ?? "#9CA3AF";
        const name = itemName(id);
        const picked = item === id;
        return (
          <button key={id} type="button" aria-pressed={picked} aria-disabled={lock ? true : undefined}
            aria-label={lock ? t("locked_aria", { name, n: lock.unlock_level }) : name} title={name}
            aria-keyshortcuts={n < 9 ? String(n + 1) : undefined}
            onClick={() => {
              if (lock) return;
              useBuildStore.getState().set({ item: id, tool: "place" });
              onPicked?.();
            }}
            className={clsx("card-select relative shrink-0 min-h-11 min-w-11 px-1.5 flex flex-col items-center justify-center gap-0.5",
              lock && "cursor-not-allowed opacity-70", picked && "ring-2 ring-[color:var(--focus)]")}>
            <span aria-hidden="true" className={clsx("block h-5 w-5 border border-black/30", block ? "rounded-sm" : "rounded-full")} style={{ background: color }} />
            <span aria-hidden="true" className="text-xs leading-none max-w-[4.5rem] truncate">{name}</span>
            {n < 9 && <span aria-hidden="true" className="absolute top-0.5 left-1 text-xs leading-none text-muted num">{n + 1}</span>}
            {lock && <span aria-hidden="true" className="absolute top-0.5 right-0.5 text-muted"><Lock size={11} /></span>}
          </button>
        );
      })}
    </div>
  );
}
