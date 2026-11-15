// CG-DELIVER — "Teslim et" düğmesi + son teslim rozeti ("Teslim edildi: GitHub PR #12"). Pencere: DeliverDialog.
import { CheckCircle2, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button } from "../ui";
import { deliveryApi, onDeliveryEvent, type TargetId } from "../../lib/delivery";
import { useT } from "../../lib/i18n";
import { deliveryMsg as m } from "../../locales/delivery";
import { DeliverDialog, type DeliverItem } from "./DeliverDialog";

export interface DeliveredInfo { target?: string; label?: string | null; link?: string | null; ref?: string | null }

export function DeliverButton({ item, className, compact, defaultTarget }:
  { item: DeliverItem; className?: string; compact?: boolean; defaultTarget?: { target: TargetId; options?: Record<string, unknown> } }) {
  const t = useT(m);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="primary" icon={<Send size={14} />} className={className}
        aria-label={t("deliver_aria", { title: item.title })} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {compact ? undefined : t("deliver")}
      </Button>
      {open && <DeliverDialog open={open} onClose={() => setOpen(false)} item={item} defaultTarget={defaultTarget} />}
    </>
  );
}

/** Son başarılı teslim (liste kalemindeki `delivery` alanı; canlı `delivery.done` ile tazelenir). */
export function DeliveryBadge({ id, initial }: { id: string; initial?: DeliveredInfo | null }) {
  const t = useT(m);
  const [info, setInfo] = useState<DeliveredInfo | null>(initial ?? null);
  useEffect(() => { setInfo(initial ?? null); }, [id, initial]);
  useEffect(() => onDeliveryEvent((ev) => {
    if (ev.deliverable_id !== id || ev.ok !== true || ev.target === "clipboard" || ev.target === "download") return;
    deliveryApi.records(id).then((r) => {
      const last = r.items.find((x) => x.ok && x.target !== "clipboard" && x.target !== "download");
      if (last) setInfo({ target: last.target, label: last.label, link: last.link, ref: last.ref });
    }).catch(() => undefined);
  }), [id]);
  if (!info) return null;
  const text = t("done_badge", { label: info.label ?? info.target ?? "" });
  const link = info.link && /^https?:\/\//.test(info.link) ? info.link : null;
  return link ? (
    <a href={link} target="_blank" rel="noopener noreferrer" className="chip tone-ok hover:underline !whitespace-normal break-words">
      <CheckCircle2 size={12} aria-hidden />{text}
    </a>
  ) : <Badge tone="ok" className="!whitespace-normal break-words"><CheckCircle2 size={12} aria-hidden />{text}</Badge>;
}
