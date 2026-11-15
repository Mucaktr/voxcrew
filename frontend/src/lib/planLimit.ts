// sınır kartı mantığı (saf; içe aktarma yok → `node --test scripts/plan_check.test.mjs` doğrudan sınar).
// Kurallar ():
// - Kart modal değildir; kullanıcının kendi eyleminden doğar; kapatılabilir.
// - Aynı sınır (özellik + neden) oturumda en çok BİR kez kendiliğinden açılır (dürtme yok).
// - Önce ücretsiz çözüm (yedekle değiştir, arşivle, duraklat…), sonra paket bağlantısı.
// - Paket bağlantısı oturumda en çok bir kez ve görev çalışırken hiç gösterilmez.

export interface PlanDecision {
  code?: "plan_limit";
  allowed: boolean;
  feature: string;
  reason: string | null;
  limit: number | null;
  used: number | null;
  plan: string;
  source: string;
  upgrade_to: string | null;
  alternatives: string[];
  message: string | null;
  agents?: string[];
}

export type FreeFix =
  | "bench_swap" | "merge_roles" | "edit_existing" | "archive" | "pause_other" | "local_model" | "single_agent"
  | "earn";

const FIX_ORDER: FreeFix[] = ["bench_swap", "pause_other", "edit_existing", "archive", "merge_roles", "local_model",
  "single_agent", "earn"];

/** 409 gövdesindeki `detail` bir paket kararı mı? */
export function asDecision(detail: unknown): PlanDecision | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Partial<PlanDecision>;
  if (d.code !== "plan_limit" || typeof d.feature !== "string") return null;
  return {
    code: "plan_limit", allowed: false, feature: d.feature, reason: d.reason ?? null, limit: d.limit ?? null,
    used: d.used ?? null, plan: d.plan ?? "free", source: d.source ?? "default", upgrade_to: d.upgrade_to ?? null,
    alternatives: Array.isArray(d.alternatives) ? d.alternatives.filter((x): x is string => typeof x === "string") : [],
    message: d.message ?? null, agents: Array.isArray(d.agents) ? d.agents : [],
  };
}

/** ApiError iletisi JSON olabilir (`{"detail": {...}}` ya da doğrudan karar). */
export function decisionFromMessage(message: string): PlanDecision | null {
  try {
    const j = JSON.parse(message) as unknown;
    return asDecision((j as { detail?: unknown })?.detail ?? j);
  } catch {
    return null;
  }
}

export function limitKey(d: Pick<PlanDecision, "feature" | "reason">): string {
  return `${d.feature}:${d.reason ?? "limit"}`;
}

/** Ücretsiz çözümler sabit sırayla; bilinmeyenler atılır. */
export function freeFixes(d: PlanDecision): FreeFix[] {
  const set = new Set(d.alternatives);
  return FIX_ORDER.filter((f) => set.has(f));
}

export interface SessionMemo {
  seen: string[];            // bu oturumda kendiliğinden açılmış sınır anahtarları
  upsellShown: boolean;      // paket bağlantısı bu oturumda gösterildi mi
}

export const emptyMemo = (): SessionMemo => ({ seen: [], upsellShown: false });

/** Kart kendiliğinden açılsın mı? `explicit`: kullanıcı açıkça "neden?" diye sordu (her zaman açılır). */
export function shouldOpen(d: PlanDecision, memo: SessionMemo, explicit = false): boolean {
  if (d.allowed) return false;
  if (explicit) return true;
  return !memo.seen.includes(limitKey(d));
}

export interface CardModel {
  key: string;
  fixes: FreeFix[];
  showUpgrade: boolean;       // paket bağlantısı (gerçek fiyatla) gösterilsin mi
  upgradeTo: string | null;
}

/** Kartın içeriği ve yeni oturum belleği. Çağıran `memo`yu saklar (sessionStorage). */
export function openCard(d: PlanDecision, memo: SessionMemo, ctx: { running: boolean }): { card: CardModel; memo: SessionMemo } {
  const key = limitKey(d);
  // admin/kurucu ya da üst paket yoksa bağlantı yok; görev çalışırken ve oturumda ikinci kez hiç yok
  const canUpsell = Boolean(d.upgrade_to) && !ctx.running && !memo.upsellShown && d.source !== "admin"
    && d.source !== "founder";
  return {
    card: { key, fixes: freeFixes(d), showUpgrade: canUpsell, upgradeTo: canUpsell ? d.upgrade_to : null },
    memo: { seen: memo.seen.includes(key) ? memo.seen : [...memo.seen, key], upsellShown: memo.upsellShown || canUpsell },
  };
}

/**
 * sınır kartındaki paket satırı. Satın alma kapalıyken (`purchase.available` false; gelir kararları açık,
 * hiçbir şey satışta değil) fiyat YOK: tarafsız "plan seçenekleri" cümlesi. Fiyat yalnız satış açıksa ve hedef paket
 * bilindiğinde gösterilir.
*/
export function upgradeCopy(feature: string, purchasable: boolean,
  target: { seats: number; price_month: number } | null): {
  key: "upgrade_line" | "upgrade_options_seats" | "upgrade_options"; seats?: number; price?: number;
} {
  if (purchasable && target && target.price_month > 0) {
    return { key: "upgrade_line", seats: target.seats, price: target.price_month };
  }
  return { key: feature === "seats" || feature === "run" ? "upgrade_options_seats" : "upgrade_options" };
}

/** Sayaç metni için yüzde (0–100; sınırsızsa null). */
export function meterPct(used: number, limit: number | null): number | null {
  if (limit === null || limit <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}
