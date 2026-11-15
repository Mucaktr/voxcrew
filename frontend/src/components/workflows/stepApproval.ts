// WF-APPROVAL — ajan adımının adım başı onay kapısı (şema `approval: before | after | none`, yalnız ajan adımında).
// Saf yardımcılar; içe aktarma yok (node --test scripts/wf_approval.test.mjs doğrudan yükler).

export type StepApproval = "none" | "before" | "after";
export const STEP_APPROVAL_VALUES: readonly StepApproval[] = ["none", "before", "after"];

type ApprovalCarrier = { type?: string; approval?: string | null };

/** Adımın etkin onay modu: ajan adımı değilse ya da alan yok / tanınmıyorsa `none`. */
export function stepApproval(step: ApprovalCarrier | null | undefined): StepApproval {
  if (!step || step.type !== "agent") return "none";
  const v = typeof step.approval === "string" ? step.approval.trim().toLowerCase() : "";
  return v === "before" || v === "after" ? v : "none";
}

/** Adımda görünür onay kapısı var mı (tuval rozeti). */
export function hasApprovalGate(step: ApprovalCarrier | null | undefined): boolean {
  return stepApproval(step) !== "none";
}

/** Onay modunu yerinde yazar. `none` alanı kaldırır (kaydedilen YAML'da satır kalmaz; şema varsayılanı zaten yok). */
export function setStepApproval<T extends ApprovalCarrier>(step: T, value: StepApproval): T {
  if (value === "before" || value === "after") step.approval = value;
  else delete step.approval;
  return step;
}

/** Tür değişince: ajan dışı adımda `before`/`after` şema hatasıdır, alan temizlenir. */
export function clearApprovalUnlessAgent<T extends ApprovalCarrier>(step: T): T {
  if (step.type !== "agent") delete step.approval;
  return step;
}
