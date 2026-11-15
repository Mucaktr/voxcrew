// TRUST — saf yardımcılar (içe aktarma yok: node --test scripts/trust_check.test.mjs doğrudan yükler).

export interface AgeRecord { adult: boolean; at: string | null }

export interface ValueWords { yes: string; no: string; none: string; empty: string; min: string; tokens: string }

/** Önizleme/satır için değeri kısa metne çevirir. */
export function fmtValue(v: unknown, w: ValueWords): string {
  if (v === true) return w.yes;
  if (v === false) return w.no;
  if (v === null || v === undefined || v === "") return w.empty;
  if (Array.isArray(v)) return v.length ? v.join(", ") : w.empty;
  if (typeof v === "object") {
    const b = v as { cost_usd?: number | null; minutes?: number | null; tokens?: number | null; on_exceeded?: string };
    const parts: string[] = [];
    if (b.cost_usd != null) parts.push(`$${b.cost_usd}`);
    if (b.minutes != null) parts.push(`${b.minutes} ${w.min}`);
    if (b.tokens != null) parts.push(`${b.tokens} ${w.tokens}`);
    return parts.length ? `${parts.join(" · ")}${b.on_exceeded ? ` → ${b.on_exceeded}` : ""}` : w.none;
  }
  return String(v);
}

/** Yaş beyanı sorulmalı mı: kurulum tamamlanmış ama beyan yok (bir kerelik diyalog). */
export function needsAgeDialog(onboardingCompleted: boolean | undefined, age: AgeRecord | null | undefined): boolean {
  return onboardingCompleted === true && !age;
}

/** İlk kurulum sihirbazında yaş kapısı: beyan yoksa adımlar ve "Atla" kapalıdır; yalnız onay kutusu işaretliyken
 *  "Devam" açılır. 18 altı yanıtı da bir yanıttır (güvenli mod açılır, kimse dışarıda kalmaz). */
export function ageGate(age: AgeRecord | null | undefined, checked: boolean): { blocked: boolean; canContinue: boolean } {
  const answered = !!age;
  return { blocked: !answered, canContinue: answered || checked };
}
