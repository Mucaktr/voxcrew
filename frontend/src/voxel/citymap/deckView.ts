/**
 * seyir karosu (deck) birinci şahsa geçirir, ayrılınca oyuncunun önceki görünümü geri gelir. Ayrılış HER yoldan sayılır —
 * semt dışı karo (`districtAt` null: meydan, kanal kıyısı, ışınlanma) dahil; eskiden o dal `deck`i kapatıp görünümü 1. şahısta
 * bırakıyordu, sonraki seyir de "önceki görünüm = 1. şahıs" kaydedip kule/müze kapısında avatarı kaybettiriyordu (<city>).
 * Saf: CityRig her karo değişiminde çağırır; `scripts/deck_view.test.mjs`.
*/
import { useWalkStore, type WalkView } from "../walk/walkStore";

/** `onVp`: seyir karosunda mı; `wasDeck`: bir önceki karo seyir miydi; `cur`: şimdiki görünüm. Dönüş: olması gereken görünüm. */
export function deckViewStep(s: { deckView: WalkView | null }, onVp: boolean, wasDeck: boolean, cur: WalkView): WalkView {
  if (onVp) { if (!wasDeck) s.deckView = cur; return "first"; }
  const v = s.deckView ?? cur;
  s.deckView = null;
  return v;
}

/**
 * kararma başladı ve seyir kipi açık — kayıtlı görünüm hemen geri gelir (iç mekân girişte görünümü saklamadan önce).
 * Dönüş: seyirden çıkıldı mı (çağıran `deck` durumunu kapatır). Yürüme deposu burada okunur/yazılır.
*/
export function deckFadeLeave(s: { deckView: WalkView | null }, deck: boolean): boolean {
  if (!deck && !s.deckView) return false;
  const ws = useWalkStore.getState(), v = deckViewStep(s, false, deck, ws.view);
  if (ws.view !== v) ws.setView(v);
  return true;
}
