// Ekip S50 — çıktı bileşenlerinin ortak parçaları: tür rozeti.
import { AppWindow, Archive, Clapperboard, Code2, Database, File, FileText, Image, NotebookText, Presentation, Sheet } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../ui";
import type { DeliverableKind } from "../../lib/deliverables";
import { useT } from "../../lib/i18n";
import { deliverablesMsg as m } from "../../locales/deliverables";

const TONE: Record<DeliverableKind, string> = {
  report: "ok", text: "muted", code: "info", data: "warn", image: "info", other: "muted",
  document: "ok", presentation: "info", sheet: "warn", media: "info", archive: "muted", app: "ok",
};
export const KIND_ICON: Record<DeliverableKind, ReactNode> = {
  report: <NotebookText size={12} aria-hidden />, text: <FileText size={12} aria-hidden />,
  code: <Code2 size={12} aria-hidden />, data: <Database size={12} aria-hidden />,
  image: <Image size={12} aria-hidden />, other: <File size={12} aria-hidden />,
  document: <FileText size={12} aria-hidden />, presentation: <Presentation size={12} aria-hidden />,
  sheet: <Sheet size={12} aria-hidden />, media: <Clapperboard size={12} aria-hidden />,
  archive: <Archive size={12} aria-hidden />, app: <AppWindow size={12} aria-hidden />,
};

export function KindBadge({ kind }: { kind: DeliverableKind }) {
  const t = useT(m);
  return <Badge tone={TONE[kind] ?? "muted"}>{KIND_ICON[kind] ?? KIND_ICON.other}{t(`kind_${kind}` as "kind_report")}</Badge>;
}
