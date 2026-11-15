/**
 * LIFTFLOOR (ürün sahibi 2026-11-01 "birkaç kat varsa asansöre binince katı seçelim") — çok katlı asansörde kat seçici. Asansör kapısında F:
 * kapı birden çok kata hizmet ediyorsa bu küçük panel açılır (`liftPick.ts`); tek hedefte seçici yoktur, doğrudan biner.
 * Kat adları TR/EN (`roomName`), bulunulan kat işaretli (`aria-current`, seçilemez). Klavye: ↑/↓ (Home/End) satır değiştirir,
 * Enter/Boşluk gider, rakam (1…9 = o kat) doğrudan gider, Esc vazgeçer; fare: satıra tıkla. Mevcut panel kabuğu (`PanelShell`):
 * `role="dialog"` + `aria-modal`, odak tuzağı, Esc yürüme modundan çıkarmadan paneli kapatır. Seçince mevcut metro geçişi
 * (asansör kapıları, `ExploreHud` LiftDoors) oynar ve avatar o kata varır (seyir katında manzaraya bakarak, `liftArrivalHeading`).
*/
import clsx from "clsx";
import { ArrowUpDown, Check } from "lucide-react";
import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { useT } from "../../../../lib/i18n";
import { explore as XM } from "../../../../locales/explore";
import { closeLiftPicker, liftChoices, useLiftPicker } from "../../../../voxel/interiors/liftPick";
import { useInterior } from "../../../../voxel/interiors/store";
import { returnWorldFocusSoon } from "../../../../voxel/walk/worldFocus";
import { announceWalk } from "../announce";
import { useCoarse } from "../media";
import { PanelShell } from "../PanelShell";
import { roomName, takeLiftDirect } from "./actions";

export function LiftPicker() {
  const open = useLiftPicker((s) => s.open);
  const plan = useInterior((s) => s.plan);
  const view = useInterior((s) => s.view);
  const busy = useInterior((s) => s.busy);
  const lv = view?.level ?? null;
  const valid = !!open && !!plan && !!lv && lv.key === open.levelKey;
  // başka kata/dışarıya geçildi ya da asansör çalışıyor → seçici kapanır
  useEffect(() => { if (open && (!valid || busy)) closeLiftPicker(); }, [open, valid, busy]);
  if (!open || !valid || !plan || !lv) return null;
  return <PickerPanel levelKey={lv.key} />;
}

function PickerPanel({ levelKey }: { levelKey: string }) {
  const t = useT(XM);
  const coarse = useCoarse();
  const open = useLiftPicker((s) => s.open)!;
  const plan = useInterior((s) => s.plan)!;
  const lv = useInterior((s) => s.view)!.level;
  const list = useRef<HTMLUListElement>(null);
  const choices = useMemo(() => liftChoices(plan, lv, open.stop), [plan, lv, open.stop]);
  const close = () => { closeLiftPicker(); returnWorldFocusSoon(null); };
  const go = (i: number) => {
    const c = choices.find((x) => x.index === i);
    if (c?.here) { announceWalk(t("lp_already")); return; } // Enter/rakam bulunulan katta sessiz kalmaz
    if (!c?.stop) return; // bu kapının gitmediği kat
    closeLiftPicker();
    takeLiftDirect(c.stop.id);
    returnWorldFocusSoon(null);
  };
  // açılışta odak: en üst kat (bulunulan kat değilse)
  useEffect(() => {
    const first = choices.find((c) => !c.here); // en üst kat (ürün sahibi: seyir katı) seçili başlar
    list.current?.querySelector<HTMLElement>(`[data-floor="${first?.index ?? ""}"]`)?.focus({ preventScroll: true });
  }, [levelKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (from: HTMLElement | null, d: number | "first" | "last") => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-floor]") ?? [])];
    if (!rows.length) return;
    const at = from ? rows.indexOf(from) : -1;
    const to = d === "first" ? 0 : d === "last" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, (at < 0 ? 0 : at) + d));
    rows[to].focus({ preventScroll: true });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-floor]");
    if (e.key === "ArrowUp") { e.preventDefault(); move(el, -1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); move(el, 1); }
    else if (e.key === "Home") { e.preventDefault(); move(el, "first"); }
    else if (e.key === "End") { e.preventDefault(); move(el, "last"); }
    else if (/^[1-9]$/.test(e.key)) { e.preventDefault(); go(Number(e.key) - 1); }
  };
  return (
    <PanelShell label={t("lp_aria")} closeLabel={t("lp_close")} onClose={close}
      title={<span className="font-display font-semibold truncate flex items-center gap-2"><ArrowUpDown size={16} aria-hidden="true" className="text-ink-2 shrink-0" />{t("lp_title")}</span>}>
      <ul ref={list} role="list" aria-label={t("floors")} data-lift-picker="" onKeyDown={onKeyDown} className="flex flex-col gap-1.5">
        {choices.map((c) => {
          const room = roomName(c.name, c.index), n = c.index + 1;
          return (
            <li key={c.index}>
              <button type="button" data-floor={c.index} aria-current={c.here ? "true" : undefined} aria-disabled={c.here ? "true" : undefined}
                aria-keyshortcuts={n <= 9 ? String(n) : undefined} aria-label={c.here ? t("lp_here_aria", { n, room }) : t("lp_go_aria", { n, room })}
                onClick={() => go(c.index)}
                className={clsx("btn w-full min-h-11 justify-start gap-3 text-left", c.here && "opacity-80 cursor-default")}>
                <span className="num chip !min-w-7 justify-center shrink-0" aria-hidden="true">{n}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{t("lp_floor", { n, room })}</span>
                {c.here && <span className="chip tone-info text-xs shrink-0"><Check size={12} aria-hidden="true" />{t("lp_here")}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted mt-2">{t(coarse ? "lp_hint_touch" : "lp_hint")}</p>
    </PanelShell>
  );
}
