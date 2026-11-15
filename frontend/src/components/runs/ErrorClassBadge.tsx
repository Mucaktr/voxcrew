// hata sınıfı rozeti (koşu ve adım). Yalnız sınıf adı; hata metni ayrı gösterilir.
import { Tag } from "lucide-react";
import { useT } from "../../lib/i18n";
import { errorClassMsg, isErrorClass } from "../../locales/errorClass";
import { Badge } from "../ui";

export function ErrorClassBadge({ value, status }: { value?: string | null; status?: string }) {
  const t = useT(errorClassMsg);
  if (!value) return null;
  const cls = isErrorClass(value) ? value : "unknown";
  const label = t(`ec_${cls}`);
  const partial = status === "done" || status === "skipped";
  return (
    <Badge tone={partial ? "warn" : "bad"}
      title={partial ? t("ec_partial_title", { label }) : t("ec_badge_title", { label })}>
      <Tag size={12} aria-hidden /><span data-error-class={cls}>{label}</span>
    </Badge>
  );
}
