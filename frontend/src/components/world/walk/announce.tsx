/**
 * W5 (WALK-W5) — yürüme modu ekran okuyucu duyuruları.
 *
 * Tek bir `aria-live="polite"` bölgesi (WalkHud içinde `<WalkAnnouncer />`): bölgeye giriş (bina içi/dışı, simge bölgesi),
 * hatıra bulundu, yakındakiler değişti (en yakın hedef; en çok 4 sn'de bir), hız sınırı (429), emote ve fotoğraf. Aynı metin
 * art arda gelirse sonuna görünmez bir boşluk eklenir ki ekran okuyucu yeniden okusun. Duyurular görsel değildir (sr-only).
*/
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { tp, useT } from "../../../lib/i18n";
import { walk as WM } from "../../../locales/walk";
import type { NearbyItem } from "../../../voxel/walk/controller";
import { useWalkIndoor, useWalkStore, walkRuntime } from "../../../voxel/walk/walkStore";
import { clearSaid } from "../../../voxel/fun/announce";
import { groupNearby } from "./selectLogic";
import { infoKeyForPoi, isInfoId } from "./info/infoTargets";

/**
 * UXF-B: Yakındakiler satır sayısı — rozetle (WalkHud `rowCount`) aynı kural: bilgi kartı olan bilgi noktası kartın
 * satırına katılır, aynı adlı süs/olta satırları tek satır. Duyurudaki "Yakında N hedef" ham öğe sayısını (24) değil bunu söyler.
*/
export function nearbyRowCount(nearby: readonly NearbyItem[], nameOf: (it: Pick<NearbyItem, "id" | "kind">) => string, world: string | null): number {
  const cards = new Set(nearby.filter((n) => isInfoId(n.id)).map((n) => n.id.slice(5)));
  const items = cards.size ? nearby.filter((n) => { const k = infoKeyForPoi(world, n.id); return !k || !cards.has(k); }) : nearby;
  return groupNearby(items, nameOf).reduce((n, g) => n + g.rows.length, 0);
}

interface AnnounceState { text: string; seq: number }
export const useWalkAnnounce = create<AnnounceState>(() => ({ text: "", seq: 0 }));

/** Duyuru (her yerden çağrılabilir; React dışı). */
let clearTimer = 0;
/** UXF-G: okunmuş duyuru canlı bölgede dakikalarca kalmasın (ritüel cümlesi başka semtte/taşıtta hâlâ `role=status`
 * içindeydi); bu süre sonra, araya yeni duyuru girmediyse bölge boşaltılır.*/
export const ANNOUNCE_CLEAR_MS = 8000;
export function announceWalk(text: string): void {
  if (!text) return;
  const s = useWalkAnnounce.getState();
  const seq = s.seq + 1;
  useWalkAnnounce.setState({ text: s.text === text ? `${text} ` : text, seq });
  if (typeof window === "undefined") return;
  window.clearTimeout(clearTimer);
  clearTimer = window.setTimeout(() => { if (useWalkAnnounce.getState().seq === seq) useWalkAnnounce.setState({ text: "" }); }, ANNOUNCE_CLEAR_MS);
}

// UXF-E: sahne değişince ya da yürüme açılıp kapanınca önceki sahnenin duyuruları (ritüel cümlesi dahil) temizlenir
useWalkStore.subscribe((s, prev) => {
  if (s.world === prev.world && s.active === prev.active) return;
  useWalkAnnounce.setState({ text: "" });
  clearSaid();
});

/** 429 (hız sınırı) gibi yürüme isteği hatalarını duyurur; diğer hatalar sessiz kalır. */
export function announceWalkError(e: unknown, rateText: string): void {
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 429) announceWalk(rateText);
}

const NEARBY_EVERY_MS = 4000;
/** FIX-UX: Tab seçimi ve "git ve aç" sırasında genel "en yakını…" duyurusu seçimin üstüne konuşmasın. */
let nearbyHoldUntil = 0;
export function holdNearbyAnnouncements(ms: number): void {
  nearbyHoldUntil = Math.max(nearbyHoldUntil, performance.now() + ms);
}

/** Canlı bölge + yakındakiler/bölge izleyicisi. `nameOf` WalkHud ile aynı (ajan adı, nesne türü). */
export function WalkAnnouncer({ nameOf }: { nameOf: (it: Pick<NearbyItem, "id" | "kind">) => string }) {
  const t = useT(WM);
  const text = useWalkAnnounce((s) => s.text);
  const indoor = useWalkIndoor();
  const first = useRef(true);
  const said = useRef(indoor);
  // bölge: bina içi / dışı (kesit durumu) — ilk değer duyurulmaz
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    // yolculukta (teleferik, çark) kabin çatısı/kesit geçişi "içeri girdin / dışarı çıktın" demez; yolculuk bitince de durum
    // yolculuk öncesine dönmüşse söylenmez (son SÖYLENEN durumla karşılaştırılır)
    if (walkRuntime.ride || said.current === indoor) return;
    said.current = indoor;
    announceWalk(indoor ? t("ann_indoor") : t("ann_outdoor"));
  }, [indoor, t]);
  // yakındakiler: en yakın hedef değişince (seyrek; aynı hedef tekrar okunmaz)
  const nameRef = useRef(nameOf);
  nameRef.current = nameOf;
  useEffect(() => {
    let lastId = "", lastAt = 0, lastCount = -1;
    return useWalkStore.subscribe((s, prev) => {
      if (s.nearby === prev.nearby || !s.active || s.photo) return;
      const now = performance.now();
      if (now - lastAt < NEARBY_EVERY_MS || now < nearbyHoldUntil) return;
      const top = s.nearby[0];
      const id = top?.id ?? "";
      if (id === lastId && s.nearby.length === lastCount) return;
      lastId = id; lastCount = s.nearby.length; lastAt = now;
      if (!top) { announceWalk(t("ann_nearby_none")); return; }
      announceWalk(t("ann_nearby", {
        name: nameRef.current(top), steps: top.reach === false ? t("unreachable") : tp(WM, "steps", top.steps), dir: t(`dir_${top.bearing}` as const), n: nearbyRowCount(s.nearby, nameRef.current, s.world),
      }));
    });
  }, [t]);
  return <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{text}</span>;
}
