// bağlamsal tanıtım (upsell) kural motoru. Saf işlev, içe aktarma yok (node --test).
// Kurallar: oturumda en çok 1 tanıtım; görev çalışırken, onay bekleyen adım varken, sihirbaz ya da ders açıkken asla;
// kullanıcı kapattıysa ya da "tanıtımları gösterme" açıksa asla; susturulan konu 30 gün sessiz; engelleyici modal ve
// geri sayım yok (biçim çağıranda: satır içi kart, tek tıkla kapanır). Gerçek fiyat ve "ne vermediği" metinde yazılır.

export interface UpsellContext {
  running: boolean;          // çalışan görev var mı
  awaitingApproval: boolean; // onay bekleyen adım var mı
  wizardOpen: boolean;       // ilk kurulum sihirbazı ya da Akademi dersi açık mı
  optedOut: boolean;         // ayarlarda "tanıtımları gösterme"
  plan: string;              // etkin plan (free | plus | pro | founder | admin | unlimited)
  source: string;            // default | token | test | founder | admin
}

export interface UpsellMemo {
  shownThisSession: string | null;      // bu oturumda gösterilen tanıtım konusu
  dismissedThisSession: boolean;
  mutedUntil: Record<string, number>;   // konu → ms (Bir daha gösterme: 30 gün)
}

export const MUTE_DAYS = 30;
export const emptyUpsellMemo = (): UpsellMemo => ({ shownThisSession: null, dismissedThisSession: false, mutedUntil: {} });

/** Bu konu şimdi gösterilebilir mi? Aynı konu oturumda zaten gösteriliyorsa (yeniden çizim) true kalır. */
export function canShowUpsell(topic: string, ctx: UpsellContext, memo: UpsellMemo, now: number): boolean {
  if (ctx.running || ctx.awaitingApproval || ctx.wizardOpen || ctx.optedOut) return false;
  if (ctx.plan !== "free" || ctx.source === "admin" || ctx.source === "founder" || ctx.source === "test") return false;
  if (memo.dismissedThisSession) return false;
  if ((memo.mutedUntil[topic] ?? 0) > now) return false;
  return memo.shownThisSession === null || memo.shownThisSession === topic;
}

export function markShown(topic: string, memo: UpsellMemo): UpsellMemo {
  return memo.shownThisSession === topic ? memo : { ...memo, shownThisSession: topic };
}

export function dismiss(topic: string, memo: UpsellMemo, now: number, forever = false): UpsellMemo {
  const mutedUntil = forever ? { ...memo.mutedUntil, [topic]: now + MUTE_DAYS * 86_400_000 } : memo.mutedUntil;
  return { ...memo, dismissedThisSession: true, mutedUntil };
}

/** kurulum sihirbazı açık mı ya da açılış denetimi henüz bitmedi mi (taze kurulumda sihirbaz birazdan açılır;
 * o arada tanıtım görünüp sihirbazın altında kalmasın). Girdi `useOnboarding` deposunun iki alanı.*/
export function wizardBlocking(onboarding: { open: boolean; checked: boolean }): boolean {
  return onboarding.open || !onboarding.checked;
}

/** Çalışma durumundan bağlam: görev çalışıyor mu, onay bekleyen adım var mı. */
export function workState(runs: { status: string; steps?: { status: string }[] }[]): { running: boolean; awaitingApproval: boolean } {
  let running = false;
  let awaitingApproval = false;
  for (const r of runs) {
    if (r.status === "running" || r.status === "queued") running = true;
    if (r.status === "awaiting_approval" || r.status === "paused") awaitingApproval = true;
    for (const s of r.steps ?? []) {
      if (s.status === "awaiting_approval" || s.status === "awaiting_tool_approval") awaitingApproval = true;
    }
  }
  return { running, awaitingApproval };
}
