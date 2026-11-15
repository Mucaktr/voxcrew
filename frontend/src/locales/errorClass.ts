// hata taksonomisi (`error_class`) etiketleri. Sınıf kümesi backend/studio/workflow/error_class.py ile aynıdır.
import { defineMessages } from "../lib/i18n";

export const ERROR_CLASSES = ["contract", "plan", "handoff", "retrieval", "tool", "verification", "budget",
  "infrastructure", "interface", "unknown"] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

export const errorClassMsg = defineMessages({
  ec_contract: "sözleşme",
  ec_plan: "plan",
  ec_handoff: "devretme",
  ec_retrieval: "getirme",
  ec_tool: "araç",
  ec_verification: "doğrulama",
  ec_budget: "bütçe",
  ec_infrastructure: "altyapı",
  ec_interface: "arayüz",
  ec_unknown: "bilinmiyor",
  ec_badge_title: "Hata sınıfı: {label}",
  ec_partial_title: "Kısmen başarısız · hata sınıfı: {label}",
  ec_health_classes: "Hata sınıfları",
  ec_health_none: "Sınıflı hata yok",
}, {
  ec_contract: "contract",
  ec_plan: "plan",
  ec_handoff: "handoff",
  ec_retrieval: "retrieval",
  ec_tool: "tool",
  ec_verification: "verification",
  ec_budget: "budget",
  ec_infrastructure: "infrastructure",
  ec_interface: "interface",
  ec_unknown: "unknown",
  ec_badge_title: "Error class: {label}",
  ec_partial_title: "Partially failed · error class: {label}",
  ec_health_classes: "Error classes",
  ec_health_none: "No classified errors",
});

export function isErrorClass(v: unknown): v is ErrorClass {
  return typeof v === "string" && (ERROR_CLASSES as readonly string[]).includes(v);
}
