// Ekip S11. SÖZLEŞME — S6 (Görevler) ve S7 (Dünya) içe aktarır; imzayı değiştirme.
import { Cable } from "lucide-react";
import { originInfo } from "../../lib/clients";
import { tx } from "../../lib/i18n";
import { connect as m } from "../../locales/connect";
import { Badge, CONN_ICON } from "../ui";

/** Koşunun kökeni "mcp:*" ise "Claude Code'dan" / "Codex'ten" / "<ad> üzerinden" rozeti; "ui", boş ya da
 *  başka bir köken için hiçbir şey çizmez. `compact`: dar yerler (Dünya, liste satırı) için kısa ad. */
export function OriginBadge(props: { origin?: string | null; compact?: boolean }) {
  const info = originInfo(props.origin);
  if (!info) return null;
  const icon = info.known === "claude-code" ? CONN_ICON.claude : info.known === "codex" ? CONN_ICON.codex : <Cable size={14} />;
  const title = tx(m, "origin_title", { client: info.short });
  return (
    <Badge tone="info" title={title} className="shrink-0 max-w-full">
      <span aria-hidden="true" className="flex">{icon}</span>
      <span className="truncate">{props.compact ? info.short : info.label}</span>
      <span className="sr-only">{` — ${title}`}</span>
    </Badge>
  );
}
