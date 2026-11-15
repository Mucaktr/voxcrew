// bütçe kartındaki artış etiketi gerçek öneriden hesaplanır (sabit "+%50" değil).
// Motor varsayılanı ×1,5'tir (`Budget.raised(1.5)`); rezervasyon aşımında öneri en az harcananın ×1,1'i olur
// (`engine.py _budget_ask`), günlük tavanda en az sıradaki işin tahmini kadar yer açılır (`propose_raise`).
// Saf modül (içe aktarma yok): `node --test scripts/qa19_fix.test.mjs` doğrudan sınar.

/** Önerinin aşılan sınıra göre yüzde artışı (tam sayı); sınır yok/0 ya da öneri sınırdan büyük değilse null. */
export function raisePct(limit: number | null | undefined, proposal: number | null | undefined): number | null {
  if (typeof limit !== "number" || typeof proposal !== "number") return null;
  if (!Number.isFinite(limit) || !Number.isFinite(proposal) || limit <= 0 || proposal <= limit) return null;
  return Math.round((proposal / limit - 1) * 100);
}
