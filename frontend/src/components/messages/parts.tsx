// Ekip S24 — mesaj bileşenlerinin ortak parçaları: tür rozeti, gönderen/alıcı satırı.
import { ArrowRight, Boxes, CornerDownLeft, FileCheck2, Info, MessageSquare, Send, Split } from "lucide-react";
import type { ReactNode } from "react";
import { PixelFace } from "../PixelFace";
import { Badge } from "../ui";
import { useT } from "../../lib/i18n";
import type { InboxMessage, MessageKind } from "../../lib/messages";
import type { Agent } from "../../lib/types";
import { messagesMsg as m } from "../../locales/messages";

const KIND_TONE: Record<MessageKind, string> = {
  assign: "info", answer: "ok", handoff: "muted", note: "warn", ask: "warn", system: "muted", deliverable: "ok",
};
const KIND_ICON: Record<MessageKind, ReactNode> = {
  assign: <Split size={12} aria-hidden />, answer: <CornerDownLeft size={12} aria-hidden />,
  handoff: <ArrowRight size={12} aria-hidden />, note: <MessageSquare size={12} aria-hidden />,
  ask: <MessageSquare size={12} aria-hidden />, system: <Info size={12} aria-hidden />,
  deliverable: <FileCheck2 size={12} aria-hidden />,
};

export function KindBadge({ kind }: { kind: MessageKind }) {
  const t = useT(m);
  return <Badge tone={KIND_TONE[kind] ?? "muted"}>{KIND_ICON[kind]}{t(`kind_${kind}` as "kind_note")}</Badge>;
}

/** Ajan adı (ve küçük yüz); "user" → "Sen". */
export function Party({ slug, agents, size = 20 }: { slug: string; agents: Agent[]; size?: number }) {
  const t = useT(m);
  if (slug === "user") return <span className="font-semibold inline-flex items-center gap-1"><Send size={12} aria-hidden />{t("from_user")}</span>;
  if (slug === "system") return <span className="font-semibold inline-flex items-center gap-1"><Boxes size={12} aria-hidden />{t("from_system")}</span>;
  const a = agents.find((x) => x.slug === slug);
  return (
    <span className="font-semibold inline-flex items-center gap-1 min-w-0">
      {a && <PixelFace avatar={a.avatar} size={size} ring={a.color} />}
      <span className="truncate">{a?.name ?? slug}</span>
    </span>
  );
}

export function FromTo({ msg, agents }: { msg: InboxMessage; agents: Agent[] }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0 flex-wrap">
      <Party slug={msg.from_agent} agents={agents} />
      <ArrowRight size={12} aria-hidden className="text-muted shrink-0" />
      <Party slug={msg.to_agent} agents={agents} />
    </span>
  );
}
