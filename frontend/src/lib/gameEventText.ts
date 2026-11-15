// DECB-FIX — oyun olayı bildirimlerinin saf yardımcıları (içe aktarma yok; node --test doğrudan çalıştırır).
// 1) Karar 5: Akademi dersi ödülünün olayları tanıtım kapısı kapalıyken bildirim üretmez (ödül yine verilir).
// 3) Başarım adı/açıklaması ve XP gerekçesi arayüz dilinde (sunucu olaya iki dili de koyar).

export type EventLike = { type?: string } & Record<string, unknown>;

const s = (v: unknown): string => (typeof v === "string" ? v : "");

/** Olay bir Akademi dersi ödülünden mi geliyor? (sunucu işareti; eski sunucuda XP gerekçesinden) */
export function isAcademyAward(ev: EventLike): boolean {
  if (ev.academy === true) return true;
  return ev.type === "game.xp" && s(ev.reason).startsWith("Akademi dersi:");
}

/** Tanıtım kapısı kapalıyken bu olayın bildirimi bekletilmeli mi? */
export function holdForIntro(ev: EventLike, gateOpen: boolean): boolean {
  return !gateOpen && isAcademyAward(ev);
}

/** Olay alanının arayüz dilindeki metni: `<alan>_<dil>` doluysa o, yoksa düz alan. */
export function localField(ev: EventLike, field: string, lang: string): string {
  return s(ev[`${field}_${lang}`]) || s(ev[field]);
}

/** Başarım olayının adı ve açıklaması (dil). */
export function achievementText(ev: EventLike, lang: string): { name: string; description: string } {
  return { name: localField(ev, "name", lang), description: localField(ev, "description", lang) };
}

/** XP olayının gerekçesi (dil); İngilizce yoksa sunucunun Türkçe metni. */
export function xpReason(ev: EventLike, lang: string): string {
  return localField(ev, "reason", lang);
}
